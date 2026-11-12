/** Original environment helpers. Inject the SAME THREE namespace as the scene.
 * Gradient sky is art-directed, not an atmosphere/cloud simulation. Capture has
 * no solar disk: use a matching DirectionalLight for direct solar illumination.
 * PMREM/IBL is not a realtime mirror or screen-space reflection.
 */
import {captureRendererState as saveRenderer,restoreRendererState as restoreRenderer} from './renderer-state.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';
const finiteVector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
// Snapshot one caller-owned vector before acquiring any render resources.
export function snapshotProbePosition(v) {
  if(!Array.isArray(v)||v.length!==3)throw Error('finite position required (xyz)');
  const xyz=[v[0],v[1],v[2]];
  if(!xyz.every(Number.isFinite))throw Error('finite position required (xyz)');
  return xyz;
}
function positive(n, label) { if (!Number.isFinite(n) || n <= 0) throw Error(`${label} must be positive`); }

// Pinned r180 ownership boundary for sky/world native cubemap conversion. The
// allocator initializes LOD/ping-pong/blur state and returns BEFORE any output
// rendering. Register that return immediately, without duplicating PMREM code or
// changing a global prototype. An explicit target alone skips fresh-generator
// initialization. Sky also uses the owned cube path, avoiding fromScene's
// private transient background mesh, whose cleanup is skipped on renderer errors.
function ownedPMREM(T,generator,owner,resolution,render){
  if(String(T?.REVISION)!=='180')throw Error('PMREM ownership requires Three r180');
  if(typeof generator._setSize!=='function'||typeof generator._allocateTargets!=='function')throw Error('Unsupported r180 PMREM ownership protocol');
  const descriptor=Object.getOwnPropertyDescriptor(generator,'_allocateTargets'),allocate=generator._allocateTargets;
  if(descriptor&&!descriptor.configurable)throw Error('Unsupported r180 PMREM allocator descriptor');
  let allocated=null;
  Object.defineProperty(generator,'_allocateTargets',{configurable:true,writable:true,value:function(...args){
    const target=owner.own(allocate.apply(this,args));allocated=target;
    const cubeSize=2**Math.floor(Math.log2(resolution)),width=3*Math.max(cubeSize,16*7),height=4*cubeSize,texture=target.texture;
    const validOutput=target.isRenderTarget&&target.width===width&&target.height===height&&target.depthBuffer===false&&
      texture?.mapping===T.CubeUVReflectionMapping&&texture.type===T.HalfFloatType&&texture.format===T.RGBAFormat&&texture.colorSpace===T.LinearSRGBColorSpace&&
      texture.minFilter===T.LinearFilter&&texture.magFilter===T.LinearFilter&&texture.generateMipmaps===false;
    const initialized=this._cubeSize===cubeSize&&this._lodMax===Math.floor(Math.log2(resolution))&&this._lodPlanes?.length&&this._sizeLods?.length&&this._sigmas?.length&&
      this._blurMaterial?.isShaderMaterial&&this._pingPongRenderTarget?.isRenderTarget&&this._pingPongRenderTarget.width===width&&this._pingPongRenderTarget.height===height;
    if(!validOutput||!initialized)throw Error('Unsupported r180 PMREM allocation protocol');
    return target;
  }});
  try{
    const result=render();
    if(result!==allocated||!allocated){if(result?.dispose)owner.own(result);throw Error('Unsupported r180 PMREM output identity');}
    return result;
  }finally{if(descriptor)Object.defineProperty(generator,'_allocateTargets',descriptor);else delete generator._allocateTargets;}
}

export function createSkyEnvironment(T, {renderer, radius=180, resolution=128,
  zenith='#365d87', horizon='#b4cdd2', ground='#62605a',
  sunDirection=[-.6,.7,.3], sunColor='#ffe2b0', sunIntensity=3}={}) {
  if (!renderer?.isWebGLRenderer) throw Error('WebGLRenderer required');
  positive(radius,'radius');
  if (!Number.isInteger(resolution)||resolution<16||resolution>1024) throw Error('resolution must be 16..1024');
  if (!finiteVector(sunDirection,3)||Math.hypot(...sunDirection)<1e-8) throw Error('nonzero sunDirection required');
  if (!Number.isFinite(sunIntensity)||sunIntensity<0) throw Error('sunIntensity must be nonnegative');
  const geometry=new T.SphereGeometry(radius,40,20), sun=new T.Vector3(...sunDirection).normalize();
  const material=new T.ShaderMaterial({side:T.BackSide, depthWrite:false, toneMapped:true,
    uniforms:{zenith:{value:new T.Color(zenith)},horizon:{value:new T.Color(horizon)},
      ground:{value:new T.Color(ground)},sun:{value:sun},sunColor:{value:new T.Color(sunColor)},
      sunIntensity:{value:sunIntensity},capture:{value:0}},
    vertexShader:'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec3 direction;
      uniform vec3 zenith,horizon,ground,sun,sunColor; uniform float sunIntensity,capture;
      void main(){vec3 d=normalize(direction);float y=d.y;
        vec3 c=y>=0.?mix(horizon,zenith,pow(y,.5)):mix(horizon,ground,pow(-y,.35));
        float facing=max(0.,dot(d,sun));c+=sunColor*pow(facing,32.)*.12;
        c+=sunColor*sunIntensity*smoothstep(.99985,.99997,facing)*(1.-capture);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const root=new T.Mesh(geometry,material); root.name='procedural-sky'; root.frustumCulled=false;
  root.renderOrder=-1000;
  const captureScene=new T.Scene(), captureMaterial=material.clone();
  // Shared colors/direction; separate solar-disk flag.
  for (const key of ['zenith','horizon','ground','sun','sunColor','sunIntensity']) captureMaterial.uniforms[key]=material.uniforms[key];
  captureMaterial.uniforms.capture.value=1;
  captureScene.add(new T.Mesh(geometry,captureMaterial));
  const appliedScenes=new Set();let target=null,disposed=false,captures=0;
  function alive(){if(disposed)throw Error('sky disposed');}
  const api={root,
    get texture(){return target?.texture??null;},
    capture(){alive();
      // The source sphere stays at origin with capture=1. The borrowed visible
      // root may follow the viewer; it never enters this private capture scene.
      const next=captureEnvironmentProbe(T,{renderer,scene:captureScene,position:[0,0,0],resolution,near:.1,far:radius*2});
      const prior=target;target=next;captures++;
      for(const scene of appliedScenes)if(!prior||scene.environment===prior.texture)scene.environment=target.texture;
      prior?.dispose();return target.texture;
    },
    apply(scene){alive();if(!scene?.isScene)throw Error('Scene required');if(!target)api.capture();scene.environment=target.texture;appliedScenes.add(scene);return target.texture;},
    setSun(direction){alive();if(!finiteVector(direction,3)||Math.hypot(...direction)<1e-8)throw Error('nonzero sunDirection required');sun.set(...direction).normalize();},
    follow(position){alive();root.position.copy(position);},
    readState(){return {disposed,captures,resolution,sunDirection:sun.toArray(),environmentUuid:target?.texture.uuid??null,
      captureExcludesSolarDisk:true,type:'art-directed gradient sky and static PMREM'};},
    dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const scene of appliedScenes)if(scene.environment===target?.texture)scene.environment=null;appliedScenes.clear();
      const errors=[];for(const release of [()=>target?.dispose(),()=>geometry.dispose(),()=>material.dispose(),()=>captureMaterial.dispose()])try{release();}catch(error){errors.push(error);}
      if(errors.length)throw new AggregateError(errors,'Sky cleanup failed');}
  };return api;
}

/** One explicit local capture AFTER geometry/lights exist. Caller assigns the
 * returned texture to the intended materials; it is never silently global.
 * Hide receiver/other probes via exclude. Capture is static until rebuilt.
 */
export function captureEnvironmentProbe(T,{renderer,scene,position=[0,1,0],resolution=128,
  near=.1,far=150,exclude=[]}={}) {
  if(String(T?.REVISION)!=='180')throw Error('Probe PMREM ownership requires Three r180');
  if(!renderer?.isWebGLRenderer||!scene?.isScene)throw Error('renderer and scene required');
  const xyz=snapshotProbePosition(position);
  if(!Number.isInteger(resolution)||resolution<16||resolution>1024)throw Error('resolution must be 16..1024');
  positive(near,'near');positive(far,'far');if(far<=near)throw Error('far must exceed near');
  if(!Array.isArray(exclude)||exclude.some(o=>!o?.isObject3D))throw Error('exclude must be Object3D[]');
  const temporary=createResourceScope(),output=createResourceScope(),old=saveRenderer(T,renderer),visibility=exclude.map(o=>[o,o.visible]);
  let target,disposed=false;
  // Scope cleanup attempts every release, including renderer restoration. An
  // error in temporary cleanup also rejects the capture and releases its output.
  temporary.defer(()=>restoreRenderer(renderer,old));
  temporary.defer(()=>{for(const[o,v]of visibility)o.visible=v;});
  try {
    const cube=temporary.own(new T.WebGLCubeRenderTarget(resolution,{type:T.HalfFloatType})),camera=new T.CubeCamera(near,far,cube);
    const generator=temporary.own(new T.PMREMGenerator(renderer));
    for(const[o]of visibility)o.visible=false;renderer.xr.enabled=false;renderer.setScissorTest(false);
    // A new cube has no previous color/depth/stencil contents to preserve.
    // The caller may have disabled clears for multipass final rendering.
    renderer.autoClear=true;renderer.autoClearColor=true;renderer.autoClearDepth=true;renderer.autoClearStencil=true;
    camera.position.set(...xyz);camera.update(renderer,scene);
    target=ownedPMREM(T,generator,output,resolution,()=>generator.fromCubemap(cube.texture));
    temporary.dispose();
  }catch(error){
    const errors=[error];for(const scope of [temporary,output])try{scope.dispose();}catch(cleanupError){errors.push(cleanupError);}
    if(errors.length>1)throw new AggregateError(errors,'Probe capture and cleanup failed');throw error;
  }
  return {texture:target.texture,readState:()=>({position:[...xyz],resolution,disposed,type:'static local PMREM probe'}),
    dispose(){if(disposed)return;disposed=true;output.dispose();}};
}
