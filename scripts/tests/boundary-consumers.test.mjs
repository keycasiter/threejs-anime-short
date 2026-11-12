import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import {buildCoreWorld} from '../../assets/examples/core-world.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const addon=path=>process.env.THREE_MODULE?pathToFileURL(resolve(dirname(resolve(process.env.THREE_MODULE)),'../examples/jsm',path)).href:`three/addons/${path}`;
const {OrbitControls}=await import(addon('controls/OrbitControls.js'));
const {mergeGeometries}=await import(addon('utils/BufferGeometryUtils.js'));
const {MarchingCubes}=await import(addon('objects/MarchingCubes.js'));
const main=await readFile(new URL('../../assets/examples/core-lab/main.mjs',import.meta.url),'utf8');
function cameraHarness(tasks){
 const dom={style:{},addEventListener(){},removeEventListener(){},getRootNode(){return this;}};
 const camera=new T.PerspectiveCamera(41,16/9,.1,420),controls=new OrbitControls(camera,dom);
 const settings=main.split('\n').find(l=>l.startsWith('controls.minDistance='));
 new Function('controls',settings)(controls);
 const start=main.indexOf('function clearInertia()'),end=main.indexOf('const getWorld=',start);
 const state={view:'overview'},context=vm.createContext({T,camera,controls,state,slot:{current:{world:{viewTasks:tasks}}}});
 vm.runInContext(main.slice(start,end)+'\nglobalThis.setView=setView;',context);
 return {camera,controls,state,setView:context.setView};
}
test('actual r180 Orbit and production setView preserve every actual registered world pose',()=>{
 const material=new T.MeshStandardMaterial();let count=0;
 try{for(const configuration of ['grid','ring','terraced']){
  const world=buildCoreWorld(T,{configuration,mergeGeometries,MarchingCubes,materialFor:()=>material});
  try{const h=cameraHarness(world.viewTasks);try{for(const task of world.viewTasks){h.setView(task.id);assert.equal(h.state.view,task.id);assert.ok(h.camera.position.distanceTo(new T.Vector3(...task.position))<1e-8,`${configuration}/${task.id} camera was clamped`);assert.ok(h.controls.target.distanceTo(new T.Vector3(...task.target))<1e-8);count++;}}finally{h.controls.dispose();}}finally{world.dispose();}
 }}finally{material.dispose();}assert.ok(count>=24);
});
test('out-of-domain or invalid requested poses reject without claiming their names or changing valid pose',()=>{
 const tasks=[{id:'valid',position:[8,5,8],target:[0,1,0]},{id:'too-far',position:[200,1,0],target:[0,1,0]},{id:'nan-target',position:[8,5,8],target:[NaN,1,0]},{id:'sparse-target',position:[8,5,8],target:Array(3)}];
 const h=cameraHarness(tasks);try{h.setView('valid');const before=h.camera.position.clone();for(const id of ['too-far','nan-target','sparse-target','unknown']){assert.throws(()=>h.setView(id),/view|pose|distance|finite/i);assert.equal(h.state.view,'valid');assert.ok(h.camera.position.distanceTo(before)<1e-8);}}finally{h.controls.dispose();}
});

const {buildArchitecturalBay}=await import('../../assets/examples/procedural-bay.mjs');
const {buildRegionalArchitecture}=await import('../../assets/examples/region-programs.mjs');
const {createContourProfileSource}=await import('../../assets/geometry/contour-profile.mjs');
const frameProfile=(w=.1,h=.06)=>[[0,0],[w,0],[w,h*.35],[w*.82,h*.35],[w*.82,h],[w*.58,h],[w*.50,h*.8],[w*.18,h*.8],[w*.08,h*.55],[0,h*.55]];
const near=(a,b,e=2e-5)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const ray=(objects,origin,direction,far=Infinity)=>new T.Raycaster(origin,direction,0,far).intersectObjects(objects,true);
test('optional rect/arch profiles are live source geometry, open holes and finite wall/sill bearings',()=>{
 const wall=new T.MeshStandardMaterial(),trim=new T.MeshStandardMaterial(),frame=new T.MeshStandardMaterial();let borrowed=0;for(const m of [wall,trim,frame])m.addEventListener('dispose',()=>borrowed++);
 try{for(const variant of ['rect','arch'])for(const profile of [frameProfile(),[[0,0],[.1,0],[.1,.06],[0,.06]]]){
  const a=buildArchitecturalBay(T,{variant,frameProfile:profile,materials:{wall,trim,frame}});assert.equal(a.profileSources.length,1);const b=a.profileSources[0];assert.equal(b.part,a.parts.frame);assert.equal(b.source.geometry,b.part.geometry);assert.equal(b.part.material,frame);assert.equal(b.source.metadata.kind,'contour-profile');assert.deepEqual(b.source.metadata.contour,a.spec.opening.contour);assert.notDeepEqual(b.source.metadata.profile,[]);assert.ok(b.part.geometry.hasAttribute('aFormationPosition'));
  a.root.updateWorldMatrix(true,true);for(const sign of [-1,1])assert.equal(ray([a.root],new T.Vector3(0,1.5,sign*2),new T.Vector3(0,0,-sign),4).length,0);
  // Actual annular contact at three separated points along both straight jambs.
  for(const sign of [-1,1])for(const y of [.9,1.25,1.7]){const x=sign*.75;const f=ray([a.parts.frame],new T.Vector3(x,y,-1),new T.Vector3(0,0,1))[0],w=ray([a.parts.wall],new T.Vector3(x,y,1),new T.Vector3(0,0,-1))[0];assert.ok(f&&w);near(f.point.z,w.point.z);near(w.point.z,.12);}
  for(const x of [-.5,0,.5]){const f=ray([a.parts.frame],new T.Vector3(x,0,.13),new T.Vector3(0,1,0))[0],s=ray([a.parts.sill],new T.Vector3(x,1,.13),new T.Vector3(0,-1,0))[0];assert.ok(f&&s);near(f.point.y,s.point.y);}
  const sample=b.surfaceAt(.37,.31,'source');const hit=ray([b.part],sample.point.clone().applyMatrix4(b.part.matrixWorld).addScaledVector(sample.normal,.005),sample.normal.clone().negate(),.01)[0];assert.ok(hit);near(hit.distance,.005);
  const parent=new T.Group();parent.position.set(3,2,-4);parent.rotation.y=.7;parent.scale.set(1.2,.8,1.4);parent.add(a.root);a.root.rotation.y=.3;a.root.updateWorldMatrix(true,true);const world=b.surfaceAt(.37,.31,'world'),expected=sample.point.clone().applyMatrix4(b.part.matrixWorld);assert.ok(world.point.distanceTo(expected)<1e-7);assert.ok(world.normal.distanceTo(sample.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(b.part.matrixWorld)))<1e-7);
  const geometries=new Set(Object.values(a.parts).map(p=>p.geometry)),counts=new Map();for(const g of geometries)g.addEventListener('dispose',()=>counts.set(g,(counts.get(g)??0)+1));a.dispose();a.dispose();for(const g of geometries)assert.equal(counts.get(g),1);assert.throws(()=>b.surfaceAt(.3,.2),/disposed/i);
 }}finally{assert.equal(borrowed,0);for(const m of [wall,trim,frame])m.dispose();}
});
test('profile snapshots detach; invalid optional profiles/material reject and cleanup continues after one release fails',()=>{
 const material=new T.MeshStandardMaterial(),profile=frameProfile();const a=buildArchitecturalBay(T,{frameProfile:profile,materials:{wall:material,trim:material}});const b=buildArchitecturalBay(T,{frameProfile:profile,materials:{wall:material,trim:material}});profile[0][0]=91;assert.equal(a.profileSources[0].source.metadata.profile[0][0],0);a.profileSources[0].source.metadata.profile[0][0]=72;assert.equal(b.profileSources[0].source.metadata.profile[0][0],0);
 let released=0;for(const p of Object.values(a.parts))p.geometry.addEventListener('dispose',()=>released++);a.parts.frame.geometry.addEventListener('dispose',()=>{throw Error('release diagnostic');});assert.throws(()=>a.dispose(),/cleanup|release/i);assert.equal(released,Object.values(a.parts).length);b.dispose();
 for(const frameProfile of [[[0,0],[.1,0],[0,0]],[[0,0],[100,0],[100,.1],[0,.1]]])assert.throws(()=>buildArchitecturalBay(T,{frameProfile,materials:{wall:material,trim:material}}));assert.throws(()=>buildArchitecturalBay(T,{frameProfile:frameProfile(),materials:{wall:material,trim:material,frame:{}}}),/material/i);material.dispose();
});
test('three regional programs consume live boundary sources, real recessed trays/planters and matching complete bounds',()=>{
 const material=new T.MeshStandardMaterial();
 try{for(const program of ['gallery','workshop','courtyard'])for(const dimensions of [{},{width:4.8,depth:3.4,height:3,wallThickness:.12,roofOverhang:.1,courtyardRatio:.3},{width:18,depth:18,height:7,wallThickness:.45,roofOverhang:.8,courtyardRatio:.55}]){
  const a=buildRegionalArchitecture(T,{program,materialFor:()=>material,...dimensions});assert.ok(a.boundarySources.length>4);assert.ok(a.boundarySources.some(b=>b.part.name.includes('canopy')));assert.ok(a.boundarySources.some(b=>b.part.name==='bay.frame'));
  for(const b of a.boundarySources){assert.equal(b.source.geometry,b.part.geometry);assert.ok(a.materialBindings.some(m=>m.object===b.part&&m.slots.every(s=>s.options.maps===false)));const g=b.part.geometry;assert.ok(g.index&&g.groups.length);assert.ok(g.hasAttribute('aFormationPosition'));assert.equal(g.attributes.aFormationPosition.count,g.attributes.position.count);const s=b.surfaceAt(.2,.27,'world');assert.ok(s.point.toArray().every(Number.isFinite));}
  const bounds=new T.Box3().setFromObject(a.root);near(bounds.min.x,a.footprint.minX);near(bounds.max.z,a.footprint.maxZ);
  const canopy=a.boundarySources.find(b=>b.part.name.includes('canopy'));const cb=new T.Box3().setFromObject(canopy.part);near(cb.max.y-cb.min.y,.1);assert.ok(canopy.part.rotation.x<0);
  if(program==='gallery'||program==='courtyard'){const ring=a.boundarySources.find(b=>b.part.name.includes('roof')&&b.part.name.endsWith('.outer-edge'));assert.ok(ring);assert.equal(ray(a.parts.roofs,new T.Vector3(0,20,0),new T.Vector3(0,-1,0))[0]?.object.name.includes('lantern.cap')??false,program==='gallery');}
  for(const b of a.boundarySources.filter(b=>/tool-tray|planter.rim/.test(b.part.name))){const bounds=new T.Box3().setFromObject(b.part),c=bounds.getCenter(new T.Vector3()),category=b.part.name.includes('tray')?a.parts.furniture:a.parts.planting;const center=ray(category,new T.Vector3(c.x,bounds.max.y+.01,c.z),new T.Vector3(0,-1,0))[0];assert.ok(center);assert.ok(center.point.y<bounds.max.y-.025,'open rim must expose genuinely lower floor or soil');}
  const sources=a.boundarySources.map(b=>b.source);a.dispose();for(const source of sources)assert.throws(()=>source.surfaceAt(.2,.3),/disposed/i);
 }}finally{material.dispose();}
});
// Expand original indexed source vertices and inspect only actual emitted ranges.
function checkFinalFrameRanges(world,records=world.bakedBoundarySources){
 const objects=new Map(world.materialBindings.map(({object})=>[object.uuid,object]));let vertices=0;
 for(const record of records){
  assert.equal(Object.hasOwn(record,'formationPreserved'),false);assert.equal(Object.hasOwn(record,'bakedGeometryIds'),false);
  assert.equal(record.sourceSpace,'world-root-local');assert.ok(Array.isArray(record.sourceRanges)&&record.sourceRanges.length>0,'missing actual sourceRanges');
  const source=createContourProfileSource(T,{contour:record.metadata.contour,profile:record.metadata.profile});
  try{const p=source.geometry.attributes.position,index=source.geometry.index,matrix=new T.Matrix4().fromArray(record.sourceMatrix);let cursor=0;
   for(const range of record.sourceRanges){
    assert.equal(range.sourceId,record.id);const object=objects.get(range.objectId);assert.ok(object,'range object membership');assert.notEqual(object,world.parts.panel,'dynamic panel is not a frame output');assert.equal(object.geometry.uuid,range.geometryId,'actual geometry identity');
    const g=object.geometry,position=g.attributes.position,formation=g.attributes.aFormationPosition;assert.equal(g.index,null);assert.ok(formation&&formation.itemSize===3);assert.equal(formation.count,position.count);
    assert.ok(Number.isSafeInteger(range.vertexStart)&&range.vertexStart>=0&&range.vertexStart%3===0);assert.ok(Number.isSafeInteger(range.vertexCount)&&range.vertexCount>0&&range.vertexCount%3===0);assert.ok(range.vertexStart+range.vertexCount<=position.count);
    for(let i=0;i<range.vertexCount;i++){
     assert.ok(cursor<index.count,'extraneous output range');const original=index.getX(cursor++),local=new T.Vector3().fromBufferAttribute(p,original),placed=local.clone().applyMatrix4(matrix);
     for(let c=0;c<3;c++){assert.equal(formation.getComponent(range.vertexStart+i,c),p.getComponent(original,c),`${record.id} aFormationPosition mismatch at ${i}/${c}`);assert.equal(position.getComponent(range.vertexStart+i,c),Math.fround(placed.getComponent(c)),`${record.id} position mismatch at ${i}/${c}`);}vertices++;
    }
   }
   assert.equal(cursor,index.count,'complete indexed source coverage');assert.equal(record.triangleCount,index.count/3);
  }finally{source.dispose();}
 }return {sources:records.length,vertices,positionComponents:vertices*3,formationComponents:vertices*3};
}
function actualMainSnapshot(world){
 const camera=new T.PerspectiveCamera(),controls={target:new T.Vector3()},presentation={palettes:{pbr:{base:{entries:[]}},toon:{base:{entries:[]}}}};
 const context=vm.createContext({T,structuredClone,state:{ready:true},camera,controls,getWorld:()=>world,slot:{revision:1,current:{world,readState:()=>presentation,rig:{readState:()=>({})}}},renderer:{info:{programs:[],render:{},memory:{}}},owner:{inspect:()=>({})},coreViewLabel:()=>''});
 vm.runInContext(main.slice(main.indexOf('function readState()'),main.indexOf('function report()'))+'\nglobalThis.snapshot=readState;',context);return context.snapshot();
}
test('all world configurations map original indexed sources to exact actual final ranges and detached main DTOs',()=>{
 const material=new T.MeshStandardMaterial();
 try{for(const configuration of ['grid','ring','terraced']){
  const releases=new Map(),originalDispose=T.BufferGeometry.prototype.dispose;T.BufferGeometry.prototype.dispose=function(){releases.set(this.uuid,(releases.get(this.uuid)??0)+1);return originalDispose.call(this);};let world;
  try{world=buildCoreWorld(T,{configuration,mergeGeometries,MarchingCubes,materialFor:()=>material});assert.equal(world.regionalAssets.length,3);assert.equal(world.entrances.length,3);assert.equal(world.layout.connectionGraph.components.length,1);assert.ok(world.boundarySources.length>20);
   for(const b of world.boundarySources){assert.equal(b.part.geometry,b.source.geometry);assert.ok(world.materialBindings.some(m=>m.object===b.part));const p=b.surfaceAt(.3,.4,'world').point;assert.ok(new T.Box3().setFromObject(world.root).containsPoint(p));}
   assert.deepEqual(checkFinalFrameRanges(world),{sources:36,vertices:30720,positionComponents:92160,formationComponents:92160});
   for(const record of world.bakedBoundarySources)assert.equal(releases.get(record.sourceGeometryId),1,'temporary actual source geometry is retired once');
   if(configuration==='grid'){
    const wrong=structuredClone(world.bakedBoundarySources);wrong[0].sourceRanges.push({sourceId:wrong[0].id,objectId:world.parts.panel.uuid,geometryId:world.parts.panel.geometry.uuid,vertexStart:0,vertexCount:36});assert.throws(()=>checkFinalFrameRanges(world,wrong),/dynamic panel/);
    const badId=structuredClone(world.bakedBoundarySources);badId[0].sourceRanges[0].objectId='not-an-output';assert.throws(()=>checkFinalFrameRanges(world,badId),/membership/);
    const snapshot=actualMainSnapshot(world);assert.doesNotThrow(()=>JSON.stringify(snapshot));assert.deepEqual(snapshot.bakedBoundarySources,world.bakedBoundarySources);snapshot.bakedBoundarySources[0].sourceRanges[0].vertexStart=-1;assert.ok(world.bakedBoundarySources[0].sourceRanges[0].vertexStart>=0);
   }
  }finally{try{world?.dispose();}finally{T.BufferGeometry.prototype.dispose=originalDispose;}}
 }}finally{material.dispose();}
});
test('same final-range checker rejects corrupted native final merge formation coordinates',()=>{
 const material=new T.MeshStandardMaterial();let corruptions=0;
 const corruptMerge=(inputs,...rest)=>{const output=mergeGeometries(inputs,...rest);if(inputs.length===36&&output.attributes.position.count===30720){output.attributes.aFormationPosition.array.fill(0);corruptions++;}return output;};
 const world=buildCoreWorld(T,{mergeGeometries:corruptMerge,MarchingCubes,materialFor:()=>material});try{assert.equal(corruptions,1);assert.throws(()=>checkFinalFrameRanges(world),/aFormationPosition mismatch/);}finally{world.dispose();material.dispose();}
});

test('section recipes return independent numerical snapshots and reject nonphysical section sizes',async()=>{
 const {frameBoundaryProfile,solidBoundaryProfile,containerBoundaryProfile}=await import('../../assets/examples/boundary-profile-design.mjs');
 for(const recipe of [frameBoundaryProfile,solidBoundaryProfile,containerBoundaryProfile]){const first=recipe(.07,.04),second=recipe(.07,.04);first[0][0]=92;assert.notEqual(second[0][0],92);for(const args of [[0,.1],[.1,NaN],[-.1,.2],[.1,0]])assert.throws(()=>recipe(...args),/positive finite/);}
});
test('horizontal core shares the actual inset edge and containers rest on finite supporting bottom faces',()=>{
 const material=new T.MeshStandardMaterial();for(const program of ['gallery','workshop','courtyard']){
  const a=buildRegionalArchitecture(T,{program,materialFor:()=>material});try{
   const edge=a.boundarySources.find(b=>b.part.name.endsWith('entry.canopy.outer-edge')),core=a.parts.roofs.find(o=>o.name.endsWith('entry.canopy'));
   a.root.updateWorldMatrix(true,true);const p=core.geometry.attributes.position,edgeBox=edge.part.geometry.boundingBox,coreBox=core.geometry.boundingBox;
   near(coreBox.min.x,edgeBox.min.x+.08);near(coreBox.max.x,edgeBox.max.x-.08);near(coreBox.max.z,-.014);near(coreBox.min.z,-.1);
   // The geometry's local +Z is world +Y, including the finite core side.
   const worldAxis=new T.Vector3(0,0,1).transformDirection(edge.part.matrixWorld);assert.ok(worldAxis.distanceTo(new T.Vector3(0,1,0))<1e-8);
   for(const x of [coreBox.min.x,coreBox.max.x])for(const y of [coreBox.min.y*.6,0,coreBox.max.y*.6]){
    const point=new T.Vector3(x,y,-.05).applyMatrix4(core.matrixWorld),normal=new T.Vector3(Math.sign(x),0,0).transformDirection(core.matrixWorld);
    const hit=ray([core],point.clone().addScaledVector(normal,.005),normal.clone().negate(),.01)[0];assert.ok(hit);near(hit.distance,.005);
   }
   for(const b of a.boundarySources.filter(b=>/tool-tray|planter.rim/.test(b.part.name))){const box=new T.Box3().setFromObject(b.part),c=box.getCenter(new T.Vector3()),parts=b.part.name.includes('tray')?a.parts.furniture:a.parts.planting;const bottom=parts.find(o=>o.name.endsWith(b.part.name.includes('tray')?'tool-tray.bottom':'planter.bottom')&&Math.abs(o.position.x-c.x)<.001);assert.ok(bottom);const bb=new T.Box3().setFromObject(bottom);for(const fx of [-.45,0,.45])for(const fz of [-.45,0,.45]){const hit=ray([bottom],new T.Vector3(c.x+fx*(bb.max.x-bb.min.x),box.max.y+.01,c.z+fz*(bb.max.z-bb.min.z)),new T.Vector3(0,-1,0))[0];assert.ok(hit);near(hit.point.y,bb.max.y);}}
  }finally{a.dispose();}
 }material.dispose();
});
test('late allocation failure releases actual contour source geometry and leaves borrowed materials alive',()=>{
 const material=new T.MeshStandardMaterial(),created=[];let borrowed=0;material.addEventListener('dispose',()=>borrowed++);
 class TrackingGeometry extends T.BufferGeometry{constructor(){super();this.releases=0;created.push(this);this.addEventListener('dispose',()=>this.releases++);}}
 let calls=0;assert.throws(()=>buildRegionalArchitecture({...T,BufferGeometry:TrackingGeometry},{materialFor:()=>{if(++calls===12)throw Error('late boundary allocation failure');return material;}}),/allocation failure/);assert.ok(created.length>0);for(const g of created)assert.equal(g.releases,1);assert.equal(borrowed,0);material.dispose();
});
test('all original independent minimum/maximum regional dimension combinations remain buildable with measured envelopes',()=>{
 const material=new T.MeshStandardMaterial();let count=0;
 try{for(const program of ['gallery','workshop','courtyard'])for(const width of [4.8,18])for(const depth of [3.4,18])for(const height of [3,7])for(const wallThickness of [.12,.45])for(const roofOverhang of [.1,.8])for(const courtyardRatio of [.3,.55]){
  const a=buildRegionalArchitecture(T,{program,width,depth,height,wallThickness,roofOverhang,courtyardRatio,materialFor:()=>material});try{const b=new T.Box3().setFromObject(a.root);near(b.min.x,a.footprint.minX);near(b.max.x,a.footprint.maxX);near(b.min.z,a.footprint.minZ);near(b.max.z,a.footprint.maxZ);assert.ok(a.boundarySources.length>4);count++;}finally{a.dispose();}
 }}finally{material.dispose();}assert.equal(count,192);
});
test('custom frame sections reject missing finite wall or sill contact before presenting a live bay',()=>{
 const material=new T.MeshStandardMaterial();try{for(const profile of [
  [[0,.01],[.1,.01],[.1,.06],[0,.06]],
  [[0,0],[.04,0],[.1,.03],[.04,.06],[0,.06]]
 ])assert.throws(()=>buildArchitecturalBay(T,{frameProfile:profile,materials:{wall:material,trim:material}}),/finite.*contact|bearing/i);}finally{material.dispose();}
});
test('camera snapshots three fixed pose indices once and does not consume supplied iteration',()=>{
 const reads=[0,0,0],position=[8,5,8],target=[0,1,0],expected=[8,5,8];for(let i=0;i<3;i++)Object.defineProperty(position,i,{get(){reads[i]++;return expected[i];}});
 position[Symbol.iterator]=function*(){yield NaN;yield NaN;yield NaN;};target[Symbol.iterator]=function*(){yield 50;yield 50;yield 50;};
 const h=cameraHarness([{id:'indexed',position,target}]);try{h.setView('indexed');assert.deepEqual(reads,[1,1,1]);assert.ok(h.camera.position.distanceTo(new T.Vector3(8,5,8))<1e-8);assert.ok(h.controls.target.distanceTo(new T.Vector3(0,1,0))<1e-8);assert.equal(h.state.view,'indexed');}finally{h.controls.dispose();}
});
test('same semantic frame inputs preserve actual distinct material merge buckets',()=>{
 const materials=[];const world=buildCoreWorld(T,{mergeGeometries,MarchingCubes,materialFor:()=>{const material=new T.MeshStandardMaterial();materials.push(material);return material;}});
 try{assert.deepEqual(checkFinalFrameRanges(world),{sources:36,vertices:30720,positionComponents:92160,formationComponents:92160});const ids=new Set(world.bakedBoundarySources.flatMap(record=>record.sourceRanges.map(range=>range.geometryId)));assert.equal(ids.size,9);assert.ok(!ids.has(world.parts.panel.geometry.uuid));let releases=0;for(const material of materials)material.addEventListener('dispose',()=>releases++);world.dispose();assert.equal(releases,0);}finally{world.dispose();for(const material of materials)material.dispose();}
});
