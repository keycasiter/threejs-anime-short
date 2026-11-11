/** Original environment helpers. Inject the SAME THREE namespace as the scene.
 * Gradient sky is art-directed, not an atmosphere/cloud simulation. Capture has
 * no solar disk: use a matching DirectionalLight for direct solar illumination.
 * PMREM/IBL is not a realtime mirror or screen-space reflection.
 */
import {captureRendererState as saveRenderer,restoreRendererState as restoreRenderer} from './renderer-state.mjs';
const finiteVector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
function positive(n, label) { if (!Number.isFinite(n) || n <= 0) throw Error(`${label} must be positive`); }

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
  const pmrem=new T.PMREMGenerator(renderer), appliedScenes=new Set(); let target=null, disposed=false, captures=0;
  function alive(){if(disposed)throw Error('sky disposed');}
  const api={root,
    get texture(){return target?.texture??null;},
    capture(){alive();const old=saveRenderer(T,renderer);let next;
      try {renderer.xr.enabled=false;renderer.setScissorTest(false);
        next=pmrem.fromScene(captureScene,0,.1,radius*2,{size:resolution});
      } finally {restoreRenderer(renderer,old);}
      const prior=target;target=next;captures++;
      for(const scene of appliedScenes)if(!prior||scene.environment===prior.texture)scene.environment=target.texture;
      prior?.dispose();return target.texture;
    },
    apply(scene){alive();if(!scene?.isScene)throw Error('Scene required');if(!target)api.capture();scene.environment=target.texture;appliedScenes.add(scene);return target.texture;},
    setSun(direction){alive();if(!finiteVector(direction,3)||Math.hypot(...direction)<1e-8)throw Error('nonzero sunDirection required');sun.set(...direction).normalize();},
    follow(position){alive();root.position.copy(position);},
    readState(){return {disposed,captures,resolution,sunDirection:sun.toArray(),environmentUuid:target?.texture.uuid??null,
      captureExcludesSolarDisk:true,type:'art-directed gradient sky and static PMREM'};},
    dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const scene of appliedScenes)if(scene.environment===target?.texture)scene.environment=null;appliedScenes.clear();target?.dispose();pmrem.dispose();geometry.dispose();material.dispose();captureMaterial.dispose();}
  };return api;
}

/** One explicit local capture AFTER geometry/lights exist. Caller assigns the
 * returned texture to the intended materials; it is never silently global.
 * Hide receiver/other probes via exclude. Capture is static until rebuilt.
 */
export function captureEnvironmentProbe(T,{renderer,scene,position=[0,1,0],resolution=128,
  near=.1,far=150,exclude=[]}={}) {
  if(!renderer?.isWebGLRenderer||!scene?.isScene)throw Error('renderer and scene required');
  if(!finiteVector(position,3))throw Error('finite position required');
  if(!Number.isInteger(resolution)||resolution<16||resolution>1024)throw Error('resolution must be 16..1024');
  positive(near,'near');positive(far,'far');if(far<=near)throw Error('far must exceed near');
  if(!Array.isArray(exclude)||exclude.some(o=>!o?.isObject3D))throw Error('exclude must be Object3D[]');
  const cube=new T.WebGLCubeRenderTarget(resolution,{type:T.HalfFloatType}),camera=new T.CubeCamera(near,far,cube);
  const generator=new T.PMREMGenerator(renderer), old=saveRenderer(T,renderer), visibility=exclude.map(o=>[o,o.visible]);
  let target,disposed=false;
  try {for(const[o]of visibility)o.visible=false;renderer.xr.enabled=false;renderer.setScissorTest(false);
    camera.position.set(...position);camera.update(renderer,scene);target=generator.fromCubemap(cube.texture);
  } finally {for(const[o,v]of visibility)o.visible=v;restoreRenderer(renderer,old);generator.dispose();cube.dispose();}
  return {texture:target.texture,readState:()=>({position:[...position],resolution,disposed,type:'static local PMREM probe'}),
    dispose(){if(disposed)return;disposed=true;target.dispose();}};
}
