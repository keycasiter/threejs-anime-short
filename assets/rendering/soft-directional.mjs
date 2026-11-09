/** Owned offline direct-light integrator. THREE injected; tested with r180 WebGLRenderer.
 * No GI, denoising, blur, scene edits or light-intensity scaling. Does not drive animation.
 * Caller freezes scene/camera/time and must not render concurrently while awaiting.
 * Only built-in material/color pipeline; XR, Composer and custom material shaders excluded.
 */
async function gpuComplete(gl) {
  const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  if(!fence)throw Error('WebGL2 completion fence unavailable');
  gl.flush();const start=performance.now();
  try{for(;;){const state=gl.clientWaitSync(fence,0,0);
    if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED)return;
    if(state===gl.WAIT_FAILED||gl.isContextLost())throw Error('WebGL2 completion fence failed');
    if(performance.now()-start>120000)throw Error('WebGL2 GPU sample completion timeout');
    await new Promise(resolve=>setTimeout(resolve,2));
  }}finally{gl.deleteSync(fence);}
}
export async function renderSoftDirectional({THREE:T, renderer, scene, camera, light,
  samples=32, angularRadius=0.075, seed=20261109, width, height,
  onSample, yieldEvery=4}={}) {
  if (!renderer?.isWebGLRenderer || T.REVISION!=='180') throw Error('Verified path: THREE r180 WebGLRenderer only');
  if(renderer.getRenderTarget()!==null)throw Error('Verified scope: call from the default framebuffer only');
  if (!light?.isDirectionalLight || renderer.xr.enabled) throw Error('Requires DirectionalLight and XR disabled');
  let extraShadowLight=false;scene.traverseVisible(object=>{if(object.isLight&&object!==light&&object.castShadow)extraShadowLight=true;});
  if(extraShadowLight)throw Error('Verified scope: the key is the only visible castShadow light');
  if (!Number.isInteger(samples)||samples<1||samples>256) throw Error('samples must be integer 1..256');
  if (!Number.isFinite(angularRadius)||angularRadius<0||angularRadius>0.25) throw Error('angularRadius must be radians 0..0.25');
  if (!renderer.extensions.has('EXT_color_buffer_float')) throw Error('Float color attachment unsupported');
  const size=renderer.getDrawingBufferSize(new T.Vector2());
  width??=size.x; height??=size.y;
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1) throw Error('Positive integer dimensions required');
  const old={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),
    viewport:renderer.getViewport(new T.Vector4()),scissor:renderer.getScissor(new T.Vector4()),scissorTest:renderer.getScissorTest(),
    autoClear:renderer.autoClear,autoClearColor:renderer.autoClearColor,autoClearDepth:renderer.autoClearDepth,autoClearStencil:renderer.autoClearStencil,
    clearColor:renderer.getClearColor(new T.Color()),clearAlpha:renderer.getClearAlpha(),toneMapping:renderer.toneMapping,
    exposure:renderer.toneMappingExposure,output:renderer.outputColorSpace,
    shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeds:renderer.shadowMap.needsUpdate,
    lightPosition:light.position.clone(),targetPosition:light.target.position.clone(),shadowAutoLight:light.shadow.autoUpdate,
    shadowNeedsLight:light.shadow.needsUpdate,shadowMap:light.shadow.map,shadowPass:light.shadow.mapPass,
    shadowCamera:light.shadow.camera.clone(),shadowMatrix:light.shadow.matrix.clone()};
  const resources=[];
  const makeTarget=(msaa=0)=>{const r=new T.WebGLRenderTarget(width,height,{type:T.FloatType,format:T.RGBAFormat,
    colorSpace:T.LinearSRGBColorSpace,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:msaa>0,samples:msaa});resources.push(r);return r;};
  const vertex='varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const blendMat=new T.ShaderMaterial({uniforms:{prior:{value:null},current:{value:null},count:{value:1}},vertexShader:vertex,
    fragmentShader:'varying vec2 vUv; uniform sampler2D prior; uniform sampler2D current; uniform float count; void main(){vec4 c=texture2D(current,vUv);gl_FragColor=count<1.5?c:mix(texture2D(prior,vUv),c,1.0/count);}',
    depthTest:false,depthWrite:false,toneMapped:false});
  const outputMat=new T.ShaderMaterial({uniforms:{image:{value:null}},vertexShader:vertex,
    fragmentShader:'varying vec2 vUv; uniform sampler2D image; void main(){gl_FragColor=texture2D(image,vUv);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    depthTest:false,depthWrite:false,toneMapped:true});
  const geom=new T.PlaneGeometry(2,2),quad=new T.Mesh(geom,blendMat),screen=new T.Scene(),screenCamera=new T.Camera();
  screen.add(quad);resources.push(blendMat,outputMat,geom);
  let completed=0,started=performance.now(),privateMap=null,privatePass=null;
  try {
    // Keep caller's shadow-map storage untouched, including when a sample throws.
    light.shadow.map=null;light.shadow.mapPass=null;
    renderer.autoClear=true;renderer.autoClearColor=true;renderer.autoClearDepth=true;renderer.autoClearStencil=true;
    renderer.shadowMap.autoUpdate=true;light.shadow.autoUpdate=true;
    const sample=makeTarget(Math.min(4,renderer.capabilities.maxSamples)),a=makeTarget(),b=makeTarget();
    scene.updateMatrixWorld(true);light.target.updateWorldMatrix(true,false);light.updateWorldMatrix(true,false);
    const target=light.target.getWorldPosition(new T.Vector3()),source=light.getWorldPosition(new T.Vector3());
    const offset=source.sub(target),distance=offset.length();
    if(distance<1e-8)throw Error('DirectionalLight coincides with its target');
    const n=offset.normalize(),basis=new T.Vector3(Math.abs(n.y)<0.9?0:1,Math.abs(n.y)<0.9?1:0,0),u=new T.Vector3().crossVectors(basis,n).normalize(),v=new T.Vector3().crossVectors(n,u);
    let state=seed>>>0;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
    const turn=random()*Math.PI*2,tan=Math.tan(angularRadius);let prior=a,next=b;
    for(let i=0;i<samples;i++){
      // Equal-area stratified disk; deterministic rotation. N=1 is the original direction.
      const radius=samples===1?0:Math.sqrt((i+0.5)/samples)*tan,angle=turn+i*Math.PI*(3-Math.sqrt(5));
      const p=n.clone().addScaledVector(u,radius*Math.cos(angle)).addScaledVector(v,radius*Math.sin(angle)).normalize().multiplyScalar(distance).add(target);
      if(light.parent)light.parent.worldToLocal(p);light.position.copy(p);light.updateMatrixWorld(true);
      renderer.shadowMap.needsUpdate=true;light.shadow.needsUpdate=true;
      renderer.setRenderTarget(sample);renderer.setScissorTest(false);renderer.clear();renderer.render(scene,camera);
      privateMap=light.shadow.map;privatePass=light.shadow.mapPass;
      blendMat.uniforms.prior.value=prior.texture;blendMat.uniforms.current.value=sample.texture;blendMat.uniforms.count.value=i+1;
      quad.material=blendMat;renderer.setRenderTarget(next);renderer.clear();renderer.render(screen,screenCamera);
      [prior,next]=[next,prior];await gpuComplete(renderer.getContext());completed++;
      if(onSample)await onSample({completed,samples});
      if(yieldEvery>0&&completed%yieldEvery===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    outputMat.uniforms.image.value=prior.texture;quad.material=outputMat;
    renderer.setRenderTarget(null);renderer.setViewport(0,0,size.x/renderer.getPixelRatio(),size.y/renderer.getPixelRatio());renderer.setScissorTest(false);renderer.clear();renderer.render(screen,screenCamera);
    // WebGL submission is asynchronous: this barrier makes completion refer to actual GPU work.
    await gpuComplete(renderer.getContext());
    return {requestedSamples:samples,completedSamples:completed,angularRadius,seed,width,height,milliseconds:performance.now()-started,
      type:'direct-light disk sampling; no GI',accumulation:'Float32 linear HDR online mean',output:'one renderer toneMapping/output conversion',completion:'WebGL2 fenceSync after each sample and final output'};
  } finally {
    privateMap??=light.shadow.map;privatePass??=light.shadow.mapPass;
    light.position.copy(old.lightPosition);light.target.position.copy(old.targetPosition);light.updateMatrixWorld(true);light.target.updateMatrixWorld(true);
    light.shadow.map=old.shadowMap;light.shadow.mapPass=old.shadowPass;light.shadow.camera.copy(old.shadowCamera,false);light.shadow.matrix.copy(old.shadowMatrix);
    light.shadow.autoUpdate=old.shadowAutoLight;light.shadow.needsUpdate=old.shadowNeedsLight;
    renderer.shadowMap.autoUpdate=old.shadowAuto;renderer.shadowMap.needsUpdate=old.shadowNeeds;
    renderer.autoClear=old.autoClear;renderer.autoClearColor=old.autoClearColor;renderer.autoClearDepth=old.autoClearDepth;renderer.autoClearStencil=old.autoClearStencil;
    renderer.toneMapping=old.toneMapping;renderer.toneMappingExposure=old.exposure;renderer.outputColorSpace=old.output;
    renderer.setClearColor(old.clearColor,old.clearAlpha);renderer.setRenderTarget(old.target,old.face,old.mip);
    renderer.setViewport(old.viewport);renderer.setScissor(old.scissor);renderer.setScissorTest(old.scissorTest);
    if(privateMap&&privateMap!==old.shadowMap)privateMap.dispose();if(privatePass&&privatePass!==old.shadowPass)privatePass.dispose();
    for(const r of resources)r.dispose();
  }
}
