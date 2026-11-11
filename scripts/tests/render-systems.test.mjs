import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createPlanarReflection} from '../../assets/rendering/planar-reflection.mjs';
import {createPostPipeline} from '../../assets/rendering/post-pipeline.mjs';
import {createSkyEnvironment,captureEnvironmentProbe} from '../../assets/rendering/scene-environment.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
function renderer(){let target={name:'caller-target'},viewport=new T.Vector4(2,3,50,60),scissor=new T.Vector4(4,5,20,30),test=true;
 return {isWebGLRenderer:true,xr:{enabled:false},shadowMap:{autoUpdate:true},autoClear:true,autoClearColor:true,autoClearDepth:true,autoClearStencil:true,toneMapping:T.ACESFilmicToneMapping,outputColorSpace:T.SRGBColorSpace,toneMappingExposure:.7,
  getRenderTarget:()=>target,getActiveCubeFace:()=>2,getActiveMipmapLevel:()=>1,
  setRenderTarget(v){target=v;},getViewport:v=>v.copy(viewport),setViewport:v=>{viewport.copy(v);},getScissor:v=>v.copy(scissor),setScissor:v=>{scissor.copy(v);},getScissorTest:()=>test,setScissorTest:v=>{test=v;},};}
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
 class PMREMGenerator{fromScene(s){seenCapture=s.children[0].material.uniforms.capture.value===1;if(fail){r.setRenderTarget(null);r.setScissorTest(false);r.autoClear=false;r.toneMapping=T.NoToneMapping;throw Error('capture failure');}const rt=new T.WebGLRenderTarget(32,32);rt.released=0;rt.addEventListener('dispose',()=>rt.released++);targets.push(rt);return rt;}dispose(){}}
 const sky=createSkyEnvironment({...T,PMREMGenerator},{renderer:r}),scene=new T.Scene(),before=state(r);sky.apply(scene);const prior=scene.environment;
 sky.setSun([1,2,3]);sky.capture();assert.notEqual(scene.environment,prior);assert.equal(scene.environment,sky.texture);assert.equal(targets[0].released,1);assert.equal(seenCapture,true);
 fail=true;assert.throws(()=>sky.capture(),/failure/);assert.deepEqual(state(r),before);assert.equal(sky.texture,targets[1].texture);
 sky.dispose();sky.dispose();assert.equal(targets[1].released,1);assert.equal(scene.environment,null);assert.throws(()=>sky.capture(),/disposed/);
});

test('probe restores visibility and render target on capture failure',()=>{
 const r=renderer(),scene=new T.Scene(),receiver=new T.Group();scene.add(receiver);let seen=false,released=0;
 class CubeCamera extends T.Group{update(rr){seen=!receiver.visible;rr.setRenderTarget(null);throw Error('probe failure');}}
 class PMREMGenerator{dispose(){released++;}}
 const before=state(r);assert.throws(()=>captureEnvironmentProbe({...T,CubeCamera,PMREMGenerator},{renderer:r,scene,exclude:[receiver]}),/probe failure/);
 assert.equal(seen,true);assert.equal(receiver.visible,true);assert.deepEqual(state(r),before);assert.equal(released,1);
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
