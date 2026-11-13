import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
const T=await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href);
const {mergeGeometries}=await import(pathToFileURL(resolve(dirname(process.env.THREE_MODULE),'../examples/jsm/utils/BufferGeometryUtils.js')).href);
let api={},geometry={};
try{api=await import('../../assets/examples/activity-relations.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
try{geometry=await import('../../assets/examples/activity-geometry.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const material=new T.MeshStandardMaterial();
const build=(kind,patch={})=>{assert.equal(typeof api.buildActivityRelation,'function','rebuildable real activity factory');return api.buildActivityRelation(T,{kind,mergeGeometries,materialFor:()=>material,...patch});};
for(const kind of ['exchange','exhibit'])test(`${kind}: complete measured original relation, real entry and final provenance`,()=>{
 const a=build(kind);try{const s=a.readState();assert.equal(s.qualification.status,'complete');assert.equal(s.members.length,3);assert.equal(s.snapshot.members.length,3);assert.equal(s.snapshot.routes.length,kind==='exchange'?9:14);
 assert.equal(s.recipe.edges.length,kind==='exchange'?6:11);assert.equal(s.recipe.edges.length-s.recipe.nodes.length+1,kind==='exchange'?0:1);
 assert.ok(s.sourceRanges.length>100);assert.equal(s.provenance.every(r=>r.finalVerified),true);assert.equal(s.resources.source.state,'disposed');
 assert.equal(s.sourceDoor.width>1.67&&s.sourceDoor.width<1.69,true);assert.ok(s.sourceDoor.headroom>2.20);assert.ok(s.snapshot.routes.every(r=>r.minHeadroom>=2.1));
 assert.deepEqual(a.viewTasks.map(v=>v.id),['overview','workingFace','reverse','gradeView']);assert.equal(a.root.scale.x,1);
 assert.ok(a.materialBindings.length>=4);assert.ok(s.members.every(m=>m.bearings.length>0&&m.drawTriangles>24));
 if(kind==='exhibit'){assert.equal(s.hosts.find(h=>h.id==='fill').maxY,Math.fround(-.1));assert.equal(s.recipe.edges.filter(e=>e.a==='nw'||e.b==='nw').length,2);}
 }finally{a.dispose();}assert.equal(a.readState().disposed,true);assert.throws(()=>a.getRuntime(),/disposed/);
});
test('six prototypes are actual distinct construction units and keep authored dimensions',()=>{
 assert.equal(typeof geometry.buildActivityPrototype,'function');
 const ids=['feedCradle','partsRack','coveredPress','foldScreen','restSeat','foldIsland'];
 const dims=[[4,1.52,1.5],[2.3,2.05,.9],[4.2,3.2,2.82],[2.7,2.34,1.3],[2.6,.85,.94],[2.6,2.54,1.35]];
 ids.forEach((id,i)=>{const p=geometry.buildActivityPrototype(T,{id,materialFor:()=>material});try{const f=geometry.measureActivityPrototype(T,p);assert.equal(f.parts.length,p.units.length);assert.ok(f.parts.length<=96);assert.ok(f.bearings.length<=16);const e=f.envelope;for(let k=0;k<3;k++)assert.ok(Math.abs((e[k+3]-e[k])-dims[i][k])<2e-6,`${id} dimension ${k}`);assert.ok(f.ports[0].servicePosition[1]>0);assert.equal(f.ports[0].kind,'serve');assert.ok(f.ports[0].witness.length>=2);}finally{p.dispose();}});
});
test('actual draw semantics: indexed scalar groups, array slots, drawRange and omitted triangle detection',()=>{
 assert.equal(typeof geometry.scanActivityDraws,'function');const g=new T.BoxGeometry(),root=new T.Group(),m=new T.Mesh(g,material);root.add(m);
 try{assert.equal(geometry.scanActivityDraws(T,root).reduce((n,r)=>n+r.triangles.length,0),12);m.material=[material,material,material,material,material,material];assert.equal(geometry.scanActivityDraws(T,root)[0].triangles.length,12);g.setDrawRange(0,6);assert.equal(geometry.scanActivityDraws(T,root)[0].triangles.length,2);g.setDrawRange(1,6);assert.throws(()=>geometry.scanActivityDraws(T,root),/triangle/);}finally{g.dispose();}
});
test('source coverage rejects missing eave, missing foot, wrong physical face and stale source',()=>{
 assert.equal(typeof geometry.measureActivityPrototype,'function');for(const damage of ['eave','foot','face','width','triangle']){const p=geometry.buildActivityPrototype(T,{id:'coveredPress',materialFor:()=>material});try{if(damage==='eave')p.units.splice(p.units.findIndex(u=>u.id==='roof'),1);if(damage==='foot')p.bearingBindings.pop();if(damage==='face')p.portBinding.object=p.units.find(u=>u.id==='roof').object;if(damage==='width')p.portBinding.width=9;if(damage==='triangle')p.units.find(u=>u.id==='roof').object.geometry.setDrawRange(0,3);assert.throws(()=>geometry.measureActivityPrototype(T,p),/coverage|bearing|service|face|aperture/);}finally{p.dispose();}}
 const p=geometry.buildActivityPrototype(T,{id:'partsRack',materialFor:()=>material});p.dispose();assert.throws(()=>geometry.measureActivityPrototype(T,p),/disposed/);
});
test('actual structure and true hole perturbations rebuild measured members or reject complete relation',()=>{
 const base=build('exchange');try{const s=base.readState();const moved=build('exchange',{pressFrontOffset:.12});try{assert.notDeepEqual(moved.readState().members.find(m=>m.id==='work').ports,s.members.find(m=>m.id==='work').ports);assert.deepEqual(moved.readState().members.find(m=>m.id==='feed'),s.members.find(m=>m.id==='feed'));}finally{moved.dispose();}
 assert.throws(()=>build('exchange',{pressFootOffset:.7}),/unsatisfied/);
 assert.throws(()=>build('exhibit',{islandHoleExtra:1.2}),/unsatisfied/);
 }finally{base.dispose();}
});
test('transaction failure keeps old actual slot; twenty rebuilds and dispose release geometry only',async()=>{
 const {createAssetSlot}=await import('../../assets/runtime/asset-slot.mjs');const parent=new T.Group(),slot=createAssetSlot(parent);let made=0,released=0;
 class Tracking extends T.BufferGeometry{constructor(...args){super(...args);made++;this.addEventListener('dispose',()=>released++);}}
 const TT={...T,BufferGeometry:Tracking};const create=(kind,failAfterBake=false)=>api.buildActivityRelation(TT,{kind,failAfterBake,mergeGeometries,materialFor:()=>material});
 assert.equal(typeof api.buildActivityRelation,'function');const one=slot.replace(s=>s.own(create('exchange'))),revision=slot.revision;assert.throws(()=>slot.replace(s=>s.own(create('exchange',true))),/injected/);assert.equal(slot.current,one);assert.equal(slot.revision,revision);assert.equal(parent.children.length,1);
 for(let i=0;i<20;i++)slot.replace(s=>s.own(create('exchange')));slot.dispose();assert.equal(parent.children.length,0);assert.ok(made>0);assert.equal(released,made);
});

test('final source ranges reject wrong source identity, encoded position, formation, and lost triangles',async()=>{
 const {createAssetAssembly}=await import('../../assets/scene/asset-assembly.mjs');const {FORMATION_ATTRIBUTE}=await import('../../assets/geometry/formation-coordinates.mjs');
 for(const damage of ['identity','pose','formation','triangle']){
  const asset=geometry.buildActivityPrototype(T,{id:'partsRack',materialFor:()=>material}),assembly=createAssetAssembly(T,{mergeGeometries,invariantAttributes:{[FORMATION_ATTRIBUTE]:3}});let out;
  try{const rows=geometry.scanActivityDraws(T,asset.root,{space:'local'}),slots=new Map(asset.materialBindings.map(b=>[b.object,b.slots]));const records=geometry.addActivityDraws(T,{rows,assemblyFor:()=>assembly,slotsFor:(o,i)=>slots.get(o)[i]});out=assembly.finish();geometry.verifyActivityRanges(T,records,out.sourceRanges);
   if(damage==='identity')out.sourceRanges[0].sourceId='wrong';
   if(damage==='pose')out.sourceRanges[0].geometry.attributes.position.array[0]+=.5;
   if(damage==='formation')out.sourceRanges[0].geometry.attributes[FORMATION_ATTRIBUTE].array[0]+=.5;
   if(damage==='triangle')out.sourceRanges[0].vertexCount-=3;
   assert.throws(()=>geometry.verifyActivityRanges(T,records,out.sourceRanges),/source|formation/);
  }finally{asset.dispose();assembly.dispose();}
 }
});


// P is authored geometry; Q must be applied to the actual exclusive carriers.
test('qualification Y is consumed by the real press carriers before publication',()=>{
 const a=build('exchange');try{
  const s=a.readState(),m=s.members.find(m=>m.id==='work'),q=s.snapshot.members.find(m=>m.id==='work');
  const objects=new Set(a.sourceRanges.filter(r=>r.sourceId.startsWith('member/work/')).map(r=>r.object));
  assert.equal(objects.size,4);const delta=q.position[1]-m.pose.position[1];assert.notEqual(delta,0);
  for(const o of objects){o.updateWorldMatrix(true,false);assert.equal(o.matrixWorld.elements[13],delta,'actual carrier ignored qualification Y');}
  assert.deepEqual(m.authorPose,m.pose);assert.deepEqual(m.measurementFrame.translation,m.pose.position);
  assert.deepEqual(m.qualificationPose.position,q.position);assert.deepEqual(m.submittedCarrierDelta,[0,delta,0]);
 }finally{a.dispose();}
});

async function finalFrameFixture({yaw=90}={}){
 const {createAssetAssembly}=await import('../../assets/scene/asset-assembly.mjs');
 const asset=geometry.buildActivityPrototype(T,{id:'restSeat',materialFor:()=>material}),assembly=createAssetAssembly(T,{mergeGeometries,invariantAttributes:{aFormationPosition:3}});
 asset.root.position.set(4.55,0,2.7);asset.root.rotation.y=yaw*Math.PI/180;
 const rows=geometry.scanActivityDraws(T,asset.root,{prefix:'actual'}),slots=new Map(asset.materialBindings.map(b=>[b.object,b.slots]));
 const records=geometry.addActivityDraws(T,{rows,assemblyFor:()=>assembly,slotsFor:(o,i)=>slots.get(o)[i]});const out=assembly.finish();
 const final=geometry.verifyActivityRanges(T,records,out.sourceRanges).rows;
 const options={asset,rows:final,memberId:'sample',authorPose:{position:[4.55,0,2.7],rotationY:Math.PI/2},frame:{origin:[0,0],yawRadians:0},recipe:{nodes:[{id:'serve',memberId:'sample',portId:'front'},{id:'prev',uv:[2.68,2.7]}],edges:[{a:'prev',b:'serve',width:1.1}]}};
 return {asset,out,final,options,dispose(){asset.dispose();assembly.dispose();}};
}

test('final frame requires a measured cardinal support edge and identity recipe frame',async()=>{
 assert.equal(typeof geometry.measureActivityFinalMember,'function','formal final-frame adapter required');
 for(const damage of ['yaw','frame','axis','span','incidence']){
  const f=await finalFrameFixture({yaw:damage==='yaw'?89.99:90});try{
   const o=f.options;
   if(damage==='frame')o.frame.yawRadians=.1;
   if(damage==='axis')o.recipe.nodes[1].uv[1]+=.01;
   if(damage==='span')o.recipe.edges[0].width=9;
   if(damage==='incidence')o.recipe.edges.push({a:'serve',b:'prev',width:1.1});
   assert.throws(()=>geometry.measureActivityFinalMember(T,o),/edge|frame|axis|aperture|incidence|support/);
  }finally{f.dispose();}
 }
 const f=await finalFrameFixture();try{const m=geometry.measureActivityFinalMember(T,f.options);assert.equal(m.evidence.residualYaw,0);assert.equal(m.pointRows.length,f.final.length);assert.equal(m.evidence.worldBoxesAndWitnessesExact,true);}finally{f.dispose();}
});

test('submission rejects mixed carrier ownership, wrong owner/revision and non-unit parent',async()=>{
 assert.equal(typeof geometry.createActivitySubmissionIndex,'function','indexed carrier ownership required');
 assert.equal(typeof geometry.submitActivityQualification,'function');
 const f=await finalFrameFixture();try{
  const m=geometry.measureActivityFinalMember(T,f.options),owner=Object.freeze({}),member={id:'sample',...m},ranges=f.out.sourceRanges;
  const make=(members=[member])=>geometry.createActivitySubmissionIndex(T,{root:f.out.root,ranges,members,owner,revision:1});
  assert.throws(()=>make([{...member,pointRows:member.pointRows.slice(0,1)},{...member,id:'neighbour',pointRows:member.pointRows.slice(1)}]),/mixed|exclusive/);
  assert.throws(()=>make([member,{...member,id:'neighbour'}]),/source|ownership/);
  const q={status:'complete',snapshot:{members:[{id:'sample',prototypeId:m.facts.id,position:[4.55,0,2.7],rotationY:0,worldPorts:[]}]}},index=make();
  assert.throws(()=>geometry.submitActivityQualification(T,{root:f.out.root,index,qualification:q,owner:{},revision:1}),/owner/);
  assert.throws(()=>geometry.submitActivityQualification(T,{root:f.out.root,index,qualification:q,owner,revision:2}),/revision/);
  f.out.root.scale.setScalar(2);
  assert.throws(()=>geometry.submitActivityQualification(T,{root:f.out.root,index,qualification:q,owner,revision:1}),/frame|unit/);
 }finally{f.dispose();}
});

test('all final world points, closed unit extrema, feet and services replay Q from actual matrices',()=>{
 assert.equal(typeof geometry.verifyActivitySubmission,'function','actual matrix replay required');
 for(const kind of ['exchange','exhibit']){
  const a=build(kind);try{
   const rt=a.getRuntime(),s=a.readState();assert.equal(rt.owner,rt.submission.owner);assert.equal(rt.revision,1);
   const proof=geometry.verifyActivitySubmission(T,{root:a.root,index:rt.submission,qualification:rt.qualification,owner:rt.owner,revision:rt.revision});
   assert.equal(proof.length,3);for(const p of proof){assert.equal(p.mismatches,0);assert.ok(p.components>0);assert.ok(p.bottomTriangles>0);assert.equal(p.witnessPoints,2);}
   assert.ok(s.members.every(m=>m.qualificationPose.rotationY===0));
   const cloned=a.readState();cloned.members[0].measurementFrame.translation[0]=99;assert.notEqual(a.readState().members[0].measurementFrame.translation[0],99);
   if(kind==='exchange'){
    const work=rt.submission.members.get('work'),carrier=work.carriers.values().next().value,delta=carrier.position.y;carrier.position.y=0;
    assert.throws(()=>geometry.verifyActivitySubmission(T,{root:a.root,index:rt.submission,qualification:rt.qualification,owner:rt.owner,revision:1}),/world|matrix|point/);
    carrier.position.y=delta;
   }
  }finally{a.dispose();}
 }
});

test('source/range ownership index rejects missing draw, wrong source and foreign geometry',async()=>{
 const f=await finalFrameFixture();try{
  const measured=geometry.measureActivityFinalMember(T,f.options),owner=Object.freeze({}),member={id:'sample',...measured};
  for(const damage of ['missing','source','geometry','overlap']){
   const ranges=f.out.sourceRanges.map(r=>({...r}));
   if(damage==='missing')ranges.pop();
   if(damage==='source')ranges[0].sourceId='foreign@0';
   if(damage==='geometry')ranges[0].geometry=new T.BufferGeometry();
   if(damage==='overlap')ranges[1].vertexStart=ranges[0].vertexStart;
   try{assert.throws(()=>geometry.createActivitySubmissionIndex(T,{root:f.out.root,ranges,members:[member],owner,revision:1}),/range|source|carrier|exclusive/);}finally{if(damage==='geometry')ranges[0].geometry.dispose();}
  }
 }finally{f.dispose();}
});

test('court pair and independent measurement budgets pass at n and reject n minus one',()=>{
 for(const kind of ['exchange','exhibit']){
  const a=build(kind);let pairs,work;try{const s=a.readState();pairs=s.qualification.diagnostics.spentPairs;work=s.measurementBudget.spent;assert.ok(work>0&&work<2000000);}finally{a.dispose();}
  const exact=build(kind,{measurementLimit:work,qualificationLimits:{maxPairs:pairs}});try{assert.equal(exact.readState().measurementBudget.spent,work);}finally{exact.dispose();}
  assert.throws(()=>build(kind,{measurementLimit:work-1}),e=>e.code==='ACTIVITY_MEASUREMENT_BUDGET');
  assert.throws(()=>build(kind,{qualificationLimits:{maxPairs:pairs-1}}),e=>e.code==='ACTIVITY_UNSATISFIED'&&e.evidence.qualification.diagnostics.reasons[0].code==='budget');
 }
});

test('both qualified relations retire final handles once and borrow the shared material',()=>{
 let materials=0;const disposed=()=>materials++;material.addEventListener('dispose',disposed);
 try{for(const kind of ['exchange','exhibit']){
  const a=build(kind),rt=a.getRuntime(),counts=new Map(a.materialBindings.map(b=>[b.object.geometry,0]));
  for(const g of counts.keys())g.addEventListener('dispose',()=>counts.set(g,counts.get(g)+1));
  a.dispose();a.dispose();assert.ok([...counts.values()].every(n=>n===1));assert.equal(rt.submission.disposed,true);assert.equal(rt.submission.members.size,0);
  assert.throws(()=>geometry.verifyActivitySubmission(T,{root:a.root,index:rt.submission,qualification:rt.qualification,owner:rt.owner,revision:1}),/disposed/);
 }assert.equal(materials,0);}finally{material.removeEventListener('dispose',disposed);}
});
