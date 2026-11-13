import test from 'node:test';
import {targetState} from './fixtures/r187-target-state.mjs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createAssetSlot} from '../../assets/runtime/asset-slot.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const addon=path=>process.env.THREE_MODULE?pathToFileURL(resolve(dirname(resolve(process.env.THREE_MODULE)),'../examples/jsm',path)).href:`three/addons/${path}`;
const {mergeGeometries}=await import(addon('utils/BufferGeometryUtils.js'));
const {MarchingCubes}=await import(addon('objects/MarchingCubes.js'));
const api=await import('../../assets/examples/core-presentation.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
// Only GPU work is replaced. Geometry, source fields, palettes, scopes and slots are real.
function setup({shaderFailure=false,captureFailure=false,pmremFailure=null,priorCallbackThrows=false,requireRigidDepth=false}={}){
 const captures=[],targets=[],events=[],watched=new Set(),debug={checkShaderErrors:false,onShaderError(){events.push('prior-shader-callback');if(priorCallbackThrows)throw Error('prior shader callback threw');}};
 const renderer={isWebGLRenderer:true,xr:{enabled:true},shadowMap:{autoUpdate:false,needsUpdate:false},debug,autoClear:false,autoClearColor:false,autoClearDepth:false,autoClearStencil:false,
  toneMapping:T.ACESFilmicToneMapping,toneMappingExposure:1.27,outputColorSpace:T.SRGBColorSpace,
  compile(){},...targetState(T)};
 const snapshot=()=>({target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),viewport:renderer.getViewport(new T.Vector4()).toArray(),scissor:renderer.getScissor(new T.Vector4()).toArray(),scissorTest:renderer.getScissorTest(),
  active:[renderer.getCurrentViewport(new T.Vector4()).toArray(),renderer.getContext().getParameter(0x0c10),renderer.getContext().isEnabled(0x0c11)],
  xr:renderer.xr.enabled,shadow:renderer.shadowMap.autoUpdate,pendingShadow:renderer.shadowMap.needsUpdate,
  clear:[renderer.autoClear,renderer.autoClearColor,renderer.autoClearDepth,renderer.autoClearStencil],tone:renderer.toneMapping,exposure:renderer.toneMappingExposure,color:renderer.outputColorSpace,
  check:debug.checkShaderErrors,callback:debug.onShaderError});
 const watch=(value,type)=>{if(watched.has(value))return;watched.add(value);const id=value.uuid??value.texture?.uuid;assert.ok(id);value.addEventListener('dispose',()=>events.push(type+':'+id));};
 class CubeCamera extends T.Group{update(r,scene){
  assert.equal(scene.children.length,1);assert.equal(scene.background,sky);assert.equal(scene.environment,sky);assert.equal(scene.environmentIntensity,.8);
  assert.deepEqual([r.autoClear,r.autoClearColor,r.autoClearDepth,r.autoClearStencil],[true,true,true,true]);assert.equal(r.debug.checkShaderErrors,true);assert.equal(r.shadowMap.autoUpdate,true);
  if(requireRigidDepth){let count=0,depth=null;scene.traverse(o=>{if(!o.isMesh||!o.castShadow)return;count++;assert.ok(o.customDepthMaterial?.isMeshDepthMaterial,'shadow depth must be supplied before first CubeCamera render');depth??=o.customDepthMaterial;assert.equal(o.customDepthMaterial,depth);assert.equal(depth.depthPacking,T.RGBADepthPacking);assert.ok(!o.isSkinnedMesh);assert.equal(Object.keys(o.geometry.morphAttributes).length,0);for(const m of Array.isArray(o.material)?o.material:[o.material]){assert.equal(m.transparent,false);assert.equal(m.alphaTest,0);assert.ok(!m.alphaMap&&!m.displacementMap);}});assert.ok(count>100);watch(depth,'depth');}
  const materials=[];scene.traverse(o=>{if(o.isMesh){watch(o.geometry,'geometry');for(const m of Array.isArray(o.material)?o.material:[o.material]){watch(m,'material');for(const key of ['map','normalMap','roughnessMap','metalnessMap','gradientMap'])if(m[key])watch(m[key],'texture');materials.push(m);}}});
  captures.push({scene,root:scene.children[0],materials,position:this.position.toArray(),key:scene.getObjectByName('lighting-key').intensity});
  r.shadowMap.needsUpdate=false;r.setRenderTarget(null,5,1);r.setViewport(new T.Vector4(0,0,10,10));r.autoClear=false;r.toneMapping=T.NoToneMapping;r.toneMappingExposure=9;
  if(shaderFailure)r.debug.onShaderError(r,{}, {}, {});if(captureFailure)throw Error('fake GPU capture failure');
 }}
 class WebGLCubeRenderTarget extends T.WebGLCubeRenderTarget{constructor(...args){super(...args);watch(this,'cube');}}
 class PMREMGenerator extends T.PMREMGenerator{
  _allocateTarget(){const rt=super._allocateTarget();targets.push(rt);watch(rt,'target');return rt;}
  _textureToCubemap(texture){assert.equal(texture.isCubeTexture,true);assert.ok(this._cubeSize>=16);renderer.setRenderTarget(targets.at(-1),4,1);
   if(pmremFailure==='conversion')throw Error('PMREM conversion failure');
   if(pmremFailure==='callback'){renderer.debug.onShaderError(renderer,{}, {}, {});events.push('conversion-finished-after-callback');}}
  _applyPMREM(){if(pmremFailure==='blur')throw Error('PMREM internal blur failure');}
  dispose(){super.dispose();events.push('generator');}
 }
 const sky=new T.WebGLCubeRenderTarget(64).texture;sky.isPMREMTexture=true;let skyDisposed=0;sky.addEventListener('dispose',()=>skyDisposed++);
 function build(options={}){assert.equal(typeof api.buildCorePresentation,'function');return api.buildCorePresentation({...T,CubeCamera,PMREMGenerator,WebGLCubeRenderTarget},{renderer,mergeGeometries,MarchingCubes,skyTexture:sky,resolution:64,shadowMapSize:128,...options});}
 return {build,renderer,snapshot,captures,targets,events,sky,setPMREMFailure(mode,throwPrior=false){pmremFailure=mode;priorCallbackThrows=throwPrior;},get skyDisposed(){return skyDisposed;}};
}
test('presentation API exists',()=>assert.equal(typeof api.buildCorePresentation,'function'));
test('actual three configurations preserve source fields/groups and use private two-look capture tables',()=>{
 for(const configuration of ['grid','ring','terraced']){
  const options=configuration==='ring'?{look:'toon',formationEnabled:false,environmentMode:'sky',time:5,probePosition:[3,15,7]}:{};
  const h=setup(),before=h.snapshot(),p=h.build({configuration,...options}),s=p.readState();
  assert.equal(p.root.parent,null);assert.equal(s.look,options.look??'pbr');assert.equal(s.formationEnabled,options.formationEnabled??true);assert.equal(s.environmentMode,options.environmentMode??'world');assert.equal(h.captures.length,2);
  assert.deepEqual(h.captures.map(c=>c.key),[3.6,1.7]);assert.deepEqual(h.snapshot(),before);assert.equal(s.capture.count,2);assert.equal(s.capture.time,options.time??2);assert.ok(s.qualification.pbr.responses>0);assert.ok(s.qualification.toon.responses>0);
  if(options.probePosition)assert.deepEqual(s.capture.position,options.probePosition);else assert.ok(s.capture.position[1]>s.capture.bounds.max[1]);
  for(const x of [s.capture.bounds.min[0],s.capture.bounds.max[0]])for(const y of [s.capture.bounds.min[1],s.capture.bounds.max[1]])for(const z of [s.capture.bounds.min[2],s.capture.bounds.max[2]])assert.ok(new T.Vector3(x,y,z).distanceTo(new T.Vector3(...s.capture.position))<s.capture.far);
  p.setLook('pbr');p.setFormationEnabled(true);p.setEnvironmentMode('world');
  const geometry=p.world.materialBindings.map(b=>b.object.geometry),initial=p.world.materialBindings.map(b=>b.object.material);
  for(const b of p.world.materialBindings){assert.ok(b.object.geometry.hasAttribute('aFormationPosition'));const n=b.slots.length;assert.equal(Array.isArray(b.object.material)?b.object.material.length:1,n);if(n>1)for(const g of b.object.geometry.groups)assert.ok(g.materialIndex<n);}
  assert.deepEqual(p.world.materialBindings.flatMap(b=>Array.isArray(b.object.material)?b.object.material:[b.object.material]).map(m=>m.uuid).sort(),h.captures[0].materials.map(m=>m.uuid).sort());
  p.setLook('toon');assert.equal(p.rig.key.intensity,1.7);assert.deepEqual(p.world.materialBindings.flatMap(b=>Array.isArray(b.object.material)?b.object.material:[b.object.material]).map(m=>m.uuid).sort(),h.captures[1].materials.map(m=>m.uuid).sort());
  p.setFormationEnabled(false);p.setEnvironmentMode('sky');
  for(const b of p.world.materialBindings)for(const m of Array.isArray(b.object.material)?b.object.material:[b.object.material])if('envMap' in m){assert.equal(m.envMap,h.sky);assert.equal(m.envMapIntensity,.8);}else assert.equal(Object.hasOwn(m,'envMap'),false);
  for(let i=0;i<3;i++){p.setLook('pbr');p.setEnvironmentMode('world');p.setFormationEnabled(true);p.setEnvironmentMode('sky');p.setLook('toon');}
  p.setLook('pbr');p.setEnvironmentMode('world');assert.deepEqual(p.world.materialBindings.map(b=>b.object.material),initial);assert.deepEqual(p.world.materialBindings.map(b=>b.object.geometry),geometry);
  for(const entry of p.readState().environments.pbr)assert.equal(entry.intensity,.8);
  const detached=p.readState();detached.palettes.pbr.base.entries.length=0;assert.ok(p.readState().palettes.pbr.base.entries.length>0);assert.doesNotThrow(()=>JSON.stringify(p.readState()));
  const unchanged=p.readState();for(const action of [()=>p.setLook('bad'),()=>p.setFormationEnabled(1),()=>p.setEnvironmentMode('bad')])assert.throws(action);assert.deepEqual(p.readState(),unchanged);
  if(configuration==='terraced'){
   h.targets[1].addEventListener('dispose',()=>{throw Error('intentional target release failure');});
   assert.throws(()=>p.dispose(),/cleanup failed/,'one owner failure must still release the other environment target');
  }else p.dispose();
  p.dispose();assert.equal(p.readState().disposed,true);assert.equal(h.events.filter(e=>e.startsWith('target:')).length,2);assert.equal(h.events.filter(e=>e.startsWith('cube:')).length,2);assert.equal(h.skyDisposed,0);assert.throws(()=>p.setLook('pbr'),/disposed/);
  const released=h.events.filter(e=>/^(geometry|material|texture|target|cube):/.test(e));assert.equal(new Set(released).size,released.length,'observed owned resources dispose once, including maps shared by base/formed palettes');
 }
});
test('candidate palettes are private and late failure leaves the old slot/material/environment/camera intact',()=>{
 const h=setup(),scene=new T.Scene(),slot=createAssetSlot(scene),old=slot.replace(scope=>scope.own(h.build())),camera=new T.PerspectiveCamera();camera.position.set(7,8,9);
 const material=old.world.materialBindings.map(b=>b.object.material),state=old.readState(),geometry=old.world.materialBindings.map(b=>b.object.geometry.uuid),before=h.snapshot();
 for(const failAfterCapture of [1,2]){
  const start=h.events.length,from=h.captures.length;assert.throws(()=>slot.replace(scope=>scope.own(h.build({diagnostics:{failAfterCapture}}))),/diagnostic/);
  assert.equal(slot.current,old);assert.equal(slot.revision,1);assert.deepEqual(old.readState(),state);assert.deepEqual(old.world.materialBindings.map(b=>b.object.material),material);assert.deepEqual(old.world.materialBindings.map(b=>b.object.geometry.uuid),geometry);assert.deepEqual(camera.position.toArray(),[7,8,9]);assert.deepEqual(h.snapshot(),before);
  const newEvents=h.events.slice(start),failed=h.captures.slice(from);assert.equal(newEvents.filter(e=>e.startsWith('target:')).length,failAfterCapture);assert.ok(newEvents.some(e=>e.startsWith('geometry:')));assert.ok(newEvents.some(e=>e.startsWith('material:')));
  assert.ok(newEvents.findLastIndex(e=>e.startsWith('material:'))<newEvents.findIndex(e=>e.startsWith('target:')),'materials retire before environment targets');
  for(const c of failed){assert.equal(c.scene.children.length,0);assert.equal(c.root.parent,null);for(const m of c.materials)assert.ok(!material.flat().includes(m));}
 }
 assert.throws(()=>h.build({roofLift:-1}),/roofLift/);assert.equal(slot.current,old);slot.dispose();assert.equal(h.skyDisposed,0);
});
test('shader errors and capture exceptions restore debug and output state while cleaning candidates',()=>{
 for(const options of [{shaderFailure:true},{captureFailure:true}]){const h=setup(options),before=h.snapshot();assert.throws(()=>h.build(),/shader|capture/);assert.deepEqual(h.snapshot(),before);assert.ok(h.events.some(e=>e.startsWith('geometry:')));assert.ok(h.events.some(e=>e.startsWith('material:')));assert.equal(h.events.filter(e=>e.startsWith('cube:')).length,1);assert.equal(h.captures[0].scene.children.length,0);if(options.shaderFailure)assert.ok(h.events.includes('prior-shader-callback'));}
});
test('validation rejects invalid options before allocating or capturing',()=>{
 const h=setup();for(const options of [{look:'bad'},{formationEnabled:0},{environmentMode:'bad'},{time:NaN},{probePosition:[0,Infinity,0]},{diagnostics:{failAfterCapture:3}},{unknown:true}])assert.throws(()=>h.build(options));assert.equal(h.captures.length,0);
});
test('pre-return PMREM conversion/blur/chained callback failures free outputs and retain the real old slot',()=>{
 const h=setup(),scene=new T.Scene(),slot=createAssetSlot(scene),old=slot.replace(scope=>scope.own(h.build())),camera=new T.PerspectiveCamera();camera.position.set(3,4,5);
 const state=old.readState(),materials=old.world.materialBindings.map(b=>b.object.material),geometry=old.world.materialBindings.map(b=>b.object.geometry.uuid),before=h.snapshot();
 for(const phase of ['conversion','blur','callback']){
  h.setPMREMFailure(phase,phase==='callback');const start=h.events.length,outputs=h.targets.length;
  assert.throws(()=>slot.replace(scope=>scope.own(h.build())),/conversion|blur|shader/);
  const released=h.events.slice(start);assert.equal(h.targets.length-outputs,1);assert.equal(released.filter(e=>e.startsWith('target:')).length,1,'pre-return output freed');assert.equal(released.filter(e=>e.startsWith('cube:')).length,1);assert.ok(released.some(e=>e.startsWith('geometry:')));assert.ok(released.some(e=>e.startsWith('material:')));
  if(phase==='callback')assert.ok(released.includes('conversion-finished-after-callback'),'chained callback exception is deferred until returned output is owned');
  assert.equal(slot.current,old);assert.equal(slot.revision,1);assert.deepEqual(old.readState(),state);assert.deepEqual(old.world.materialBindings.map(b=>b.object.material),materials);assert.deepEqual(old.world.materialBindings.map(b=>b.object.geometry.uuid),geometry);assert.deepEqual(camera.position.toArray(),[3,4,5]);assert.deepEqual(h.snapshot(),before);
 }
 slot.dispose();assert.equal(h.skyDisposed,0);
});
test('chained shader callback thrown inside native PMREM cannot orphan its output',()=>{
 const h=setup({pmremFailure:'callback',priorCallbackThrows:true}),before=h.snapshot();
 assert.throws(()=>h.build(),/shader/);assert.equal(h.targets.length,1);assert.equal(h.events.filter(e=>e.startsWith('target:')).length,1);
 assert.ok(h.events.includes('conversion-finished-after-callback'));assert.deepEqual(h.snapshot(),before);
});
test('bound target and logical rectangles, face/mip, pending shadow survive both exits',()=>{
 for(const fail of [false,true])for(const override of [false,true]){
  const h=setup({captureFailure:fail}),r=h.renderer,t=r.getRenderTarget();r.shadowMap.needsUpdate=!override;
  if(override){r.setViewport(new T.Vector4(3,4,12,13));r.setScissor(new T.Vector4(5,6,7,8));r.setScissorTest(false);}
  const before=h.snapshot(),properties=[t.viewport.clone(),t.scissor.clone(),t.scissorTest];
  if(fail)assert.throws(()=>h.build(),/capture failure/);else h.build().dispose();
  assert.deepEqual(h.snapshot(),before);assert.deepEqual([t.viewport,t.scissor,t.scissorTest],properties);
 }
});
test('reject incompatible sky input before constructing the candidate',()=>{
 const h=setup();for(const [mapping,width,height] of [[T.UVMapping,336,256],[T.CubeReflectionMapping,336,256],[T.EquirectangularReflectionMapping,336,256],[T.CubeUVReflectionMapping,384,256],[T.CubeUVReflectionMapping,336,32],[T.CubeUVReflectionMapping,336,192],[T.CubeUVReflectionMapping,336,NaN]]){
  const texture=new T.Texture({width,height},mapping);
  assert.throws(()=>h.build({skyTexture:texture,mergeGeometries(){assert.fail('allocated world before checking sky');}}),/skyTexture/);
 }assert.equal(h.captures.length,0);
});
test('explicit position consumes three fixed indices once and ignores supplied iteration',()=>{
 const h=setup(),xyz=[4,13,7],reads=[0,0,0],input=[0,0,0];for(let i=0;i<3;i++)Object.defineProperty(input,i,{get(){reads[i]++;return xyz[i];}});
 input.every=()=>true;input[Symbol.iterator]=function*(){yield 55;yield 33;yield 22;};
 const p=h.build({probePosition:input});try{xyz.fill(91);assert.deepEqual(reads,[1,1,1]);assert.deepEqual(p.readState().capture.position,[4,13,7]);for(const c of h.captures)assert.deepEqual(c.position,[4,13,7]);}finally{p.dispose();}
});
test('candidate retires every base sibling, mapped texture, ramp and private target after early base failure',()=>{
 const h=setup(),p=h.build({look:'toon',formationEnabled:false,environmentMode:'sky'});
 const bases=[...new Set(p.world.materialBindings.flatMap(b=>b.object.material))],items=new Set([...bases,...h.targets]);
 for(const m of bases)for(const k of ['map','normalMap','roughnessMap','metalnessMap','gradientMap'])if(m[k])items.add(m[k]);
 assert.ok(bases.some(m=>m.gradientMap));assert.ok(bases.some(m=>m.normalMap));const counts=new Map();
 for(const v of items)v.addEventListener('dispose',()=>counts.set(v,(counts.get(v)??0)+1));
 const first=p.readState().palettes.toon.base.entries[0].materialUuid;
 bases.find(m=>m.uuid===first).addEventListener('dispose',()=>{throw Error('early base listener');});
 assert.throws(()=>p.dispose(),AggregateError);p.dispose();assert.equal(p.readState().palettes.toon.base.entries.length,0);
 for(const item of items)assert.equal(counts.get(item),1,item.name||item.uuid);assert.equal(h.skyDisposed,0);
});

test('rigid shadow owner exists before both captures and retires once after replacement or failure',()=>{
 const h=setup({requireRigidDepth:true}),slot=createAssetSlot(new T.Scene());
 slot.replace(s=>s.own(h.build()));const depth=slot.current.world.materialBindings.find(b=>b.object.castShadow).object.customDepthMaterial;
 for(const look of ['pbr','toon']){slot.current.setLook(look);slot.current.world.root.traverse(o=>{if(o.isMesh&&o.castShadow)assert.equal(o.customDepthMaterial,depth);});}
 slot.replace(s=>s.own(h.build()));assert.equal(h.events.filter(e=>e==='depth:'+depth.uuid).length,1);
 for(const failAfterCapture of [1,2]){const n=h.events.filter(e=>e.startsWith('depth:')).length;assert.throws(()=>h.build({diagnostics:{failAfterCapture}}),/diagnostic/);assert.equal(h.events.filter(e=>e.startsWith('depth:')).length,n+1);}
 slot.dispose();slot.dispose();const ids=h.events.filter(e=>e.startsWith('depth:'));assert.equal(ids.length,4);assert.equal(new Set(ids).size,ids.length);
});

test('actual two-look stock responses share their old base yet remain separate through captures, toggles and rebuilds',()=>{
 const h=setup();
 for(let rebuild=0;rebuild<2;rebuild++){
  const p=h.build();try{
   const targets=p.world.materialBindings.filter(b=>b.slots.some(s=>s.profileKey==='dressed-stock'));assert.ok(targets.length>5,'full world carries actual target slots');
   const geometry=targets.map(b=>b.object.geometry),formed={};
   for(const look of ['pbr','toon']){
    p.setLook(look);p.setFormationEnabled(true);const state=p.readState(),entries=state.palettes[look].formed.entries;
    const frame=entries.filter(e=>e.profileKey==='dressed-stock');assert.ok(frame.length>=2);
    for(const e of frame){const original=entries.find(x=>x.profileKey==='wood'&&x.baseMaterialUuid===e.baseMaterialUuid);assert.ok(original,'same original wood base');assert.notEqual(e.materialUuid,original.materialUuid);const r=e.response;assert.deepEqual(r.parameters.wavelengths,[.034,.08,1.5]);assert.deepEqual(r.parameters.colorLow,[.8684,.8416,.778]);assert.deepEqual(r.parameters.colorHigh,[1.0016,.9784,.922]);assert.equal(r.parameters.heightAmplitude,.00012);assert.equal(r.parameters.warp,.18);assert.equal(r.parameters.roughnessAmplitude,look==='pbr'?.10:0);assert.equal(r.parameters.seed,2941836582);assert.deepEqual(r.parameters.frameMatrix,new T.Matrix4().toArray());}
    formed[look]=targets.map(b=>b.object.material);
    for(const b of targets)assert.ok(frame.some(e=>e.materialUuid===b.object.material.uuid));
    p.setEnvironmentMode('sky');for(const m of formed[look])if('envMap' in m)assert.equal(m.envMap,h.sky);
    p.setFormationEnabled(false);for(let i=0;i<targets.length;i++){const e=frame.find(e=>e.materialUuid===formed[look][i].uuid);assert.equal(targets[i].object.material.uuid,e.baseMaterialUuid);}
    p.setFormationEnabled(true);p.setEnvironmentMode('world');assert.deepEqual(targets.map(b=>b.object.material),formed[look]);for(const m of formed[look])if('envMap' in m)assert.equal(m.envMap.uuid,state.capture.textures[look]);
   }
   p.setLook('pbr');assert.deepEqual(targets.map(b=>b.object.material),formed.pbr);assert.deepEqual(targets.map(b=>b.object.geometry),geometry);
  }finally{p.dispose();}
 }
 assert.equal(h.captures.length,4);
});
