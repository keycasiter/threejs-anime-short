import test from 'node:test';
import {targetState} from './fixtures/r180-target-state.mjs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createPlanarReflection} from '../../assets/rendering/planar-reflection.mjs';
import {createPostPipeline} from '../../assets/rendering/post-pipeline.mjs';
import {createSkyEnvironment,captureEnvironmentProbe} from '../../assets/rendering/scene-environment.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
function renderer(){return {isWebGLRenderer:true,xr:{enabled:false},shadowMap:{autoUpdate:true,needsUpdate:false},autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,toneMapping:T.ACESFilmicToneMapping,outputColorSpace:T.SRGBColorSpace,toneMappingExposure:.7,
 compile(){},...targetState(T)};}
function state(r){return{target:r.getRenderTarget(),viewport:r.getViewport(new T.Vector4()).toArray(),scissor:r.getScissor(new T.Vector4()).toArray(),test:r.getScissorTest(),xr:r.xr.enabled,shadow:r.shadowMap.autoUpdate,autoClear:r.autoClear,toneMapping:r.toneMapping};}

test('reflection callback hides peer mirrors/exclusions and recovers caller state on thrown render',()=>{
 const r=renderer(),scene=new T.Scene(),excluded=new T.Group(),peer=new T.Group();peer.isReflector=true;scene.add(excluded,peer);
 let seen=false,disposed=0;
 class Reflector extends T.Mesh{constructor(g){super(g,new T.MeshBasicMaterial());this.isReflector=true;this.rt=new T.WebGLRenderTarget(32,32);this.onBeforeRender=function(rr){seen=!excluded.visible&&!peer.visible;this.visible=false;rr.xr.enabled=true;rr.shadowMap.autoUpdate=false;rr.setRenderTarget(this.rt);rr.setViewport(new T.Vector4(0,0,1,1));throw Error('injected render failure');};}getRenderTarget(){return this.rt;}dispose(){disposed++;this.rt.dispose();this.material.dispose();}}
 const g=new T.PlaneGeometry(3,2),reflection=createPlanarReflection(T,{Reflector},{geometry:g,exclude:[excluded]});scene.add(reflection.root);
 const before=state(r);assert.throws(()=>reflection.root.onBeforeRender(r,scene,new T.PerspectiveCamera()),/injected/);
 assert.equal(seen,true);assert.equal(excluded.visible,true);assert.equal(peer.visible,true);assert.equal(reflection.root.visible,true);assert.deepEqual(state(r),before);
 reflection.setEnabled(false);assert.equal(reflection.root.visible,false);reflection.root.onBeforeRender(r,scene,new T.PerspectiveCamera());assert.deepEqual(state(r),before);
 reflection.setEnabled(true);scene.overrideMaterial=new T.MeshNormalMaterial();assert.doesNotThrow(()=>reflection.root.onBeforeRender(r,scene,new T.PerspectiveCamera()));scene.overrideMaterial.dispose();scene.overrideMaterial=null;
 reflection.resize(100,150);assert.equal(reflection.root.getRenderTarget().width,100);assert.equal(reflection.readState().height,150);
 let inputDisposed=false;g.addEventListener('dispose',()=>inputDisposed=true);reflection.dispose();reflection.dispose();assert.equal(disposed,1);assert.equal(inputDisposed,false);assert.throws(()=>reflection.setEnabled(true),/disposed/);g.dispose();
});

test('sky recapture replaces real applied texture, excludes solar disk and frees each owned target once',()=>{
 const r=renderer(),targets=[];let fail=false,seenCapture=false;
 class CubeCamera extends T.Group{update(rr,s){seenCapture=s.children[0].material.uniforms.capture.value===1;if(fail){r.setRenderTarget(null);r.setScissorTest(false);r.autoClear=false;r.toneMapping=T.NoToneMapping;throw Error('capture failure');}}}
 class PMREMGenerator extends T.PMREMGenerator{
  _allocateTargets(){const rt=super._allocateTargets();rt.released=0;rt.addEventListener('dispose',()=>rt.released++);targets.push(rt);return rt;}
  fromScene(){assert.fail('sky must use owned cube capture, not native fromScene');}
  _textureToCubeUV(){}_applyPMREM(){}
 }
 const sky=createSkyEnvironment({...T,CubeCamera,PMREMGenerator},{renderer:r}),scene=new T.Scene(),before=state(r);sky.apply(scene);const prior=scene.environment;
 sky.setSun([1,2,3]);sky.capture();assert.notEqual(scene.environment,prior);assert.equal(scene.environment,sky.texture);assert.equal(targets[0].released,1);assert.equal(seenCapture,true);
 fail=true;assert.throws(()=>sky.capture(),/failure/);assert.deepEqual(state(r),before);assert.equal(sky.texture,targets[1].texture);
 sky.dispose();sky.dispose();assert.equal(targets[1].released,1);assert.equal(scene.environment,null);assert.throws(()=>sky.capture(),/disposed/);
});

test('sky owned cube path retains old state on allocation/conversion/blur/callback failure and retries without native scene capture',()=>{
 const r=renderer(),outputs=[],cubes=[],generators=[];let phase=null,generatorReleased=0,captureMaterial;
 const oldCallback=()=>{if(phase==='callback')throw Error('sky old callback failure');};r.debug={checkShaderErrors:true,onShaderError:oldCallback};
 class WebGLCubeRenderTarget extends T.WebGLCubeRenderTarget{constructor(...args){super(...args);this.released=0;this.addEventListener('dispose',()=>this.released++);cubes.push(this);}}
 class CubeCamera extends T.Group{update(rr,s){
  assert.equal(s.children.length,1);assert.equal(s.children[0].geometry.type,'SphereGeometry');captureMaterial=s.children[0].material;assert.equal(captureMaterial.uniforms.capture.value,1);assert.deepEqual(this.position.toArray(),[0,0,0]);
  if(phase==='cube'){r.xr.enabled=true;r.autoClear=false;throw Error('sky cube failure');}
 }}
 class PMREMGenerator extends T.PMREMGenerator{
  constructor(...args){super(...args);this.released=0;generators.push(this);}
  _allocateTargets(){if(phase==='allocation')throw Error('sky allocation failure');const rt=super._allocateTargets();rt.released=0;rt.addEventListener('dispose',()=>rt.released++);outputs.push(rt);return rt;}
  fromScene(){assert.fail('native _sceneToCubeUV hidden transient path must never run');}
  _textureToCubeUV(){r.setRenderTarget(outputs.at(-1));r.autoClear=false;if(phase==='conversion')throw Error('sky conversion failure');if(phase==='callback')r.debug.onShaderError();}
  _applyPMREM(){if(phase==='blur')throw Error('sky blur failure');}
  dispose(){super.dispose();this.released++;generatorReleased++;}
 }
 const sky=createSkyEnvironment({...T,CubeCamera,WebGLCubeRenderTarget,PMREMGenerator},{renderer:r}),scene=new T.Scene(),before=state(r);
 assert.equal(generators.length,0,'sky retains no unused persistent PMREM generator');sky.apply(scene);const prior=sky.texture;
 for(const failure of ['cube','allocation','conversion','blur','callback']){
  phase=failure;const count=outputs.length,cubeCount=cubes.length;assert.throws(()=>sky.capture(),new RegExp('sky .*'+failure+'|sky '+failure));
  const allocates=!['cube','allocation'].includes(failure);assert.equal(outputs.length,count+(allocates?1:0));if(allocates)assert.equal(outputs.at(-1).released,1);
  assert.equal(cubes.length,cubeCount+1);assert.equal(cubes.at(-1).released,1);assert.equal(generators.at(-1).released,1);assert.equal(Object.hasOwn(generators.at(-1),'_allocateTargets'),false);
  assert.equal(sky.texture,prior);assert.equal(scene.environment,prior);assert.equal(sky.readState().captures,1);assert.equal(outputs[0].released,0);assert.equal(r.debug.onShaderError,oldCallback);assert.equal(r.debug.checkShaderErrors,true);assert.deepEqual(state(r),before);
 }
 phase=null;sky.capture();assert.equal(sky.readState().captures,2);assert.equal(outputs[0].released,1);assert.equal(scene.environment,outputs.at(-1).texture);assert.equal(generators.length,7);assert.equal(generatorReleased,7);assert.deepEqual(state(r),before);
 let geometryReleased=0,materialReleased=0,captureReleased=0;sky.root.geometry.addEventListener('dispose',()=>geometryReleased++);sky.root.material.addEventListener('dispose',()=>materialReleased++);captureMaterial.addEventListener('dispose',()=>captureReleased++);
 outputs.at(-1).addEventListener('dispose',()=>{throw Error('intentional sky output release failure');});
 assert.throws(()=>sky.dispose(),/Sky cleanup failed/);assert.equal(outputs.at(-1).released,1);assert.equal(generatorReleased,7);assert.equal(geometryReleased,1);assert.equal(materialReleased,1);assert.equal(captureReleased,1);assert.equal(scene.environment,null);sky.dispose();
});

test('probe restores visibility and render target on capture failure',()=>{
 const r=renderer(),scene=new T.Scene(),receiver=new T.Group();scene.add(receiver);let seen=false,released=0;
 class CubeCamera extends T.Group{update(rr){seen=!receiver.visible;rr.setRenderTarget(null);throw Error('probe failure');}}
 class PMREMGenerator{dispose(){released++;}}
 const before=state(r);assert.throws(()=>captureEnvironmentProbe({...T,CubeCamera,PMREMGenerator},{renderer:r,scene,exclude:[receiver]}),/probe failure/);
 assert.equal(seen,true);assert.equal(receiver.visible,true);assert.deepEqual(state(r),before);assert.equal(released,1);
});

test('probe forces full clear for a new cube and restores all clear flags on success and failure',()=>{
 for(const fail of [false,true]){
  const r=renderer(),scene=new T.Scene();for(const key of ['autoClear','autoClearColor','autoClearDepth','autoClearStencil'])r[key]=false;
  const before=[r.autoClear,r.autoClearColor,r.autoClearDepth,r.autoClearStencil];let seen=0,released=0;
  class CubeCamera extends T.Group{update(rr){seen++;assert.deepEqual([rr.autoClear,rr.autoClearColor,rr.autoClearDepth,rr.autoClearStencil],[true,true,true,true]);if(fail)throw Error('clear failure');}}
  class PMREMGenerator extends T.PMREMGenerator{_textureToCubeUV(){}_applyPMREM(){}dispose(){super.dispose();released++;}}
  if(fail)assert.throws(()=>captureEnvironmentProbe({...T,CubeCamera,PMREMGenerator},{renderer:r,scene}),/clear failure/);
  else captureEnvironmentProbe({...T,CubeCamera,PMREMGenerator},{renderer:r,scene}).dispose();
  assert.equal(seen,1);assert.equal(released,1);assert.deepEqual([r.autoClear,r.autoClearColor,r.autoClearDepth,r.autoClearStencil],before);
 }
});

test('r180 probe owns native PMREM output before conversion or blur can throw',()=>{
 for(const [phase,releaseThrows] of [['conversion',false],['blur',false],['conversion',true]]){
  const r=renderer(),scene=new T.Scene(),before=state(r),outputs=[];let generatorReleased=0,cubeReleased=0;
  class CubeCamera extends T.Group{update(){}}
  class WebGLCubeRenderTarget extends T.WebGLCubeRenderTarget{constructor(...args){super(...args);this.addEventListener('dispose',()=>cubeReleased++);}}
  class PMREMGenerator extends T.PMREMGenerator{
   _allocateTargets(){const output=super._allocateTargets();output.released=0;output.addEventListener('dispose',()=>{output.released++;if(releaseThrows)throw Error('intentional failed output release');});outputs.push(output);return output;}
   _textureToCubeUV(texture,output){assert.ok(this._lodPlanes.length);assert.ok(this._pingPongRenderTarget.isRenderTarget);assert.ok(this._blurMaterial.isMaterial);assert.equal(output,outputs[0]);r.setRenderTarget(output);r.autoClear=false;if(phase==='conversion')throw Error('allocated conversion failure');}
   _applyPMREM(){throw Error('allocated blur failure');}
   dispose(){super.dispose();generatorReleased++;}
  }
  assert.throws(()=>captureEnvironmentProbe({...T,CubeCamera,WebGLCubeRenderTarget,PMREMGenerator},{renderer:r,scene,resolution:128}),releaseThrows?/capture and cleanup failed/:new RegExp(phase+' failure'));
  assert.equal(outputs.length,1);assert.equal(outputs[0].released,1,'native output must stay reachable for cleanup before fromCubemap returns');assert.equal(generatorReleased,1);assert.equal(cubeReleased,1);assert.deepEqual(state(r),before);
 }
});

test('first r180 probe native allocation initializes LOD/ping-pong and restores the instance method',()=>{
 const r=renderer(),scene=new T.Scene(),outputs=[];let generator,allocator;
 class CubeCamera extends T.Group{update(){}}
 class PMREMGenerator extends T.PMREMGenerator{
  constructor(...args){super(...args);generator=this;allocator=this._allocateTargets;}
  _allocateTargets(){const output=super._allocateTargets();outputs.push(output);return output;}
  _textureToCubeUV(texture,output){assert.notEqual(this._allocateTargets,allocator);assert.equal(output,outputs[0]);assert.ok(this._lodPlanes.length);assert.ok(this._pingPongRenderTarget);assert.ok(this._blurMaterial);}_applyPMREM(){}
 }
 const probe=captureEnvironmentProbe({...T,CubeCamera,PMREMGenerator},{renderer:r,scene,resolution:150});
 const output=outputs[0];assert.equal(outputs.length,1);assert.equal(probe.texture,output.texture);assert.equal(output.width,384);assert.equal(output.height,512);assert.equal(output.depthBuffer,false);
 assert.equal(output.texture.mapping,T.CubeUVReflectionMapping);assert.equal(output.texture.type,T.HalfFloatType);assert.equal(output.texture.format,T.RGBAFormat);assert.equal(output.texture.colorSpace,T.LinearSRGBColorSpace);assert.equal(output.texture.generateMipmaps,false);assert.equal(generator._allocateTargets,allocator);assert.equal(Object.hasOwn(generator,'_allocateTargets'),false);probe.dispose();
});
test('probe ownership adapter rejects another revision or missing native protocol without fallback',()=>{
 const r=renderer(),scene=new T.Scene();let conversions=0;
 class CubeCamera extends T.Group{update(){}}
 class PMREMGenerator extends T.PMREMGenerator{_textureToCubeUV(){conversions++;}_applyPMREM(){}}
 assert.throws(()=>captureEnvironmentProbe({...T,REVISION:'179',CubeCamera,PMREMGenerator},{renderer:r,scene}),/r180/);
 class Unsupported extends PMREMGenerator{constructor(...args){super(...args);this._setSize=undefined;}}
 assert.throws(()=>captureEnvironmentProbe({...T,CubeCamera,PMREMGenerator:Unsupported},{renderer:r,scene}),/protocol/);assert.equal(conversions,0);
});

test('post toggles installed real passes, scales render buffers and preserves borrowed resources',()=>{
 const r=renderer(),scene=new T.Scene(),camera=new T.PerspectiveCamera();let disposed=0;
 class Pass{constructor(){this.enabled=true;}dispose(){disposed++;}}
 class EffectComposer{constructor(rr,target){this.target=target;this.passes=[];this.renders=0;}addPass(p){this.passes.push(p);}setPixelRatio(v){this.ratio=v;}setSize(w,h){this.target.setSize(w*this.ratio,h*this.ratio);}render(){this.renders++;}dispose(){this.target.dispose();}}
 const addons={EffectComposer,RenderPass:Pass,OutputPass:Pass,GTAOPass:Pass,UnrealBloomPass:Pass,SMAAPass:Pass};
 const post=createPostPipeline(T,addons,{renderer:r,scene,camera,width:100,height:50,pixelRatio:2,ao:true,bloom:false});
 assert.deepEqual(post.readState().order,['scene','ao','output','smaa']);assert.equal(post.composer.target.width,200);
 post.setEnabled('bloom',true);post.setEnabled('ao',false);assert.equal(post.passes.bloom.enabled,true);assert.equal(post.passes.ao.enabled,false);
 post.setExposure(1.7);assert.equal(r.toneMappingExposure,1.7);post.resize(120,80,1.5);assert.equal(post.composer.target.width,180);post.render();assert.equal(post.composer.renders,1);
 assert.throws(()=>post.setEnabled('output',false));assert.throws(()=>post.resize(0,1));post.dispose();post.dispose();assert.equal(disposed,5);assert.equal(r.toneMapping,T.ACESFilmicToneMapping);assert.equal(r.toneMappingExposure,.7);assert.throws(()=>post.render(),/disposed/);
});

test('failed post pass restores framebuffer and viewport so a caller can render again',()=>{
 const r=renderer(),scene=new T.Scene(),camera=new T.PerspectiveCamera();
 class Pass{constructor(){this.enabled=true;}dispose(){}}
 class EffectComposer{constructor(rr,target){this.target=target;}addPass(){}setPixelRatio(){}setSize(){}render(){r.setRenderTarget(this.target);r.setViewport(new T.Vector4(0,0,1,1));r.setScissorTest(false);r.autoClear=false;scene.overrideMaterial=new T.MeshNormalMaterial();throw Error('post render failure');}dispose(){this.target.dispose();}}
 const post=createPostPipeline(T,{EffectComposer,RenderPass:Pass,OutputPass:Pass},{renderer:r,scene,camera,smaa:false});
 const before=state(r);assert.throws(()=>post.render(),/post render failure/);assert.deepEqual(state(r),before);assert.equal(scene.overrideMaterial,null);post.dispose();
});
test('standalone probe owns exactly the finite numeric indices used by its camera and DTO',()=>{
 const r=renderer(),scene=new T.Scene(),xyz=[2,7,5],input=[0,0,0],reads=[0,0,0];let view;
 for(let i=0;i<3;i++)Object.defineProperty(input,i,{get(){reads[i]++;return xyz[i];}});
 input.every=()=>true;input[Symbol.iterator]=function*(){yield 20;yield 30;yield 40;};
 class CubeCamera extends T.Group{update(){view=this.position.toArray();}}
 class PMREMGenerator extends T.PMREMGenerator{_textureToCubeUV(){}_applyPMREM(){}}
 const ns={...T,CubeCamera,PMREMGenerator},probe=captureEnvironmentProbe(ns,{renderer:r,scene,position:input});
 try{xyz.fill(NaN);assert.deepEqual(view,[2,7,5]);assert.deepEqual(probe.readState().position,[2,7,5]);assert.deepEqual(reads,[1,1,1]);
  assert.throws(()=>captureEnvironmentProbe(ns,{renderer:r,scene,position:input}),/finite position/);
 }finally{probe.dispose();}
});
