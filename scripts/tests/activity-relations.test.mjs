import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import design from '../../assets/examples/activity-design.json' with {type:'json'};
const T=await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href);
const {mergeGeometries}=await import(pathToFileURL(resolve(dirname(process.env.THREE_MODULE),'../examples/jsm/utils/BufferGeometryUtils.js')).href);
let api={},geometry={};
try{api=await import('../../assets/examples/activity-relations.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
try{geometry=await import('../../assets/examples/activity-geometry.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const material=new T.MeshStandardMaterial();
const build=(kind,patch={})=>{assert.equal(typeof api.buildActivityRelation,'function','rebuildable real activity factory');return api.buildActivityRelation(T,{kind,mergeGeometries,materialFor:()=>material,...patch});};
test('activity design locks to the same Three revision as its executable renderer',()=>{
 assert.equal(design.render.three,T.REVISION);
});
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

// Task3 fix round 1: real source/draw/material counterexamples, not source-text assertions.
const attrDigest=async g=>{const {createHash}=await import('node:crypto'),a=g.attributes.position.array;return createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');};
test('I1 all final site carriers must retain their actual visible full draws',async()=>{
 const base=build('exhibit'),targets=new Map();try{
  const s=base.readState();for(const id of ['deck','connector','street','pad','fill']){const source=id==='deck'?s.sourceDoor.sourceIds.deck:id+'/0';const r=base.sourceRanges.find(r=>r.sourceId.startsWith(source+'@'));assert.ok(r,id);targets.set(id,await attrDigest(r.geometry));}
 }finally{base.dispose();}
 const {createHash}=await import('node:crypto');
 for(const [id,digest]of targets){let cut=0;const merged=(...args)=>{const g=mergeGeometries(...args),a=g.attributes.position.array,h=createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');if(h===digest){cut++;g.setDrawRange(0,0);}return g;};
  assert.throws(()=>build('exhibit',{mergeGeometries:merged}),/final.*draw|draw.*identity/,'missing final '+id+' draw was accepted');assert.equal(cut,1,id);
 }
});
class ActualSplitRail extends T.BoxGeometry{
 constructor(w,h,d,...rest){super(w,h,d,...rest);if(w!==3.84||h!==.18||d!==.20)return;this.dispose();const ends=[-1,1].map(sign=>{const b=new T.BoxGeometry(.2,h,d),g=b.toNonIndexed();b.dispose();const p=g.attributes.position;for(let i=0;i<p.count;i++)if(p.getY(i)>0&&p.getX(i)*sign<0)p.setY(i,p.getY(i)-.02);g.translate(sign*1.82,0,0);g.computeVertexNormals();return g;});const out=mergeGeometries(ends,false);ends.forEach(g=>g.dispose());return out;}
}
test('I2 an actual split receiving rail cannot certify a service span through air',()=>{
 let a;try{assert.throws(()=>{a=api.buildActivityRelation({...T,BoxGeometry:ActualSplitRail},{kind:'exchange',mergeGeometries,materialFor:()=>material});},/service.*(gap|continu|edge)|adjoining/);}finally{a?.dispose();}
});
function clippedRailGap(triangles,beam){const zs=[];for(const t of triangles)for(let j=0;j<3;j++){const p=t.p[j],q=t.p[(j+1)%3];if(p[1]>=beam[1]&&p[1]<=beam[4])zs.push(p[2]);for(const y of [beam[1],beam[4]])if(p[1]<y&&q[1]>y||p[1]>y&&q[1]<y)zs.push(p[2]+(y-p[1])/(q[1]-p[1])*(q[2]-p[2]));}return Math.min(...zs)-beam[5];}
function convexSectionArea(row,y,rectangle){
 let poly=rectangle.map(p=>[p[0],y,p[1]]);const pts=row.triangles.flatMap(t=>t.p),centre=[0,1,2].map(k=>pts.reduce((n,p)=>n+p[k],0)/pts.length);
 for(const t of row.triangles){const [a,b,c]=t.p,n=new T.Vector3().subVectors(new T.Vector3(...b),new T.Vector3(...a)).cross(new T.Vector3().subVectors(new T.Vector3(...c),new T.Vector3(...a))).toArray();if(n.every(v=>v===0))continue;let side=p=>n.reduce((s,v,k)=>s+v*(p[k]-a[k]),0);if(side(centre)>0){const old=side;side=p=>-old(p);}const out=[];
  for(let j=0;j<poly.length;j++){const p=poly[j],q=poly[(j+1)%poly.length],dp=side(p),dq=side(q);if(dp<=0)out.push(p);if(dp<0&&dq>0||dp>0&&dq<0){const u=dp/(dp-dq);out.push(p.map((v,k)=>v+u*(q[k]-v)));}}poly=out;if(!poly.length)return 0;
 }return Math.abs(poly.reduce((n,p,j)=>{const q=poly[(j+1)%poly.length];return n+p[0]*q[2]-q[0]*p[2];},0))/2;
}
test('I3 receiving rail has two actual finite-area relays into the original trestles',()=>{
 const p=geometry.buildActivityPrototype(T,{id:'feedCradle',materialFor:()=>material});try{
  const rows=geometry.scanActivityDraws(T,p.root,{space:'local'}),row=id=>rows.find(r=>r.object===p.units.find(u=>u.id===id)?.object),rail=row('receiving-rail'),trestles=[row('trestle/-1.5'),row('trestle/1.5')],links=p.units.filter(u=>u.id.startsWith('rail-seat/')).map(u=>rows.find(r=>r.object===u.object));
  assert.ok(trestles.every(r=>clippedRailGap(r.triangles,rail.box)>.096),'original floating gap must remain detectable');assert.equal(links.length,2,'no physical relay crosses the measured original rail/trestle gap');
  links.forEach((link,j)=>{const b=link.box,y=(b[1]+b[4])/2,rect=[[b[0],b[2]],[b[3],b[2]],[b[3],b[5]],[b[0],b[5]]];assert.ok(convexSectionArea(rail,y,rect)>0,'no finite rail contact');assert.ok(convexSectionArea(trestles[j],y,rect)>0,'no finite trestle contact');});
  assert.equal(geometry.measureActivityPrototype(T,p).bearings.length,4);
 }finally{p.dispose();}
});
test('I4 determinant-one source scale is rejected as non-rigid',()=>{
 const g=new T.BoxGeometry(),m=new T.Mesh(g,material);m.scale.set(2,.5,1);try{assert.throws(()=>geometry.scanActivityDraws(T,m),/rigid|basis|unit/);}finally{g.dispose();}
});
test('I4 manual parent rejection preserves every original matrix before submission',()=>{
 const a=build('exhibit');let idx;try{const rt=a.getRuntime();idx=geometry.createActivitySubmissionIndex(T,{root:a.root,ranges:a.sourceRanges,members:[...rt.submission.members.values()],owner:rt.owner,revision:1});const parent=idx.members.values().next().value.carriers.values().next().value.parent;parent.matrixAutoUpdate=false;parent.matrix.makeTranslation(1,0,0);a.root.updateWorldMatrix(true,true);const objects=[];a.root.traverse(o=>objects.push(o));const before=objects.map(o=>[o.matrix.toArray(),o.matrixWorld.toArray()]);let error;
  try{geometry.submitActivityQualification(T,{root:a.root,index:idx,qualification:rt.qualification,owner:rt.owner,revision:1});}catch(e){error=e;}
  assert.deepEqual(objects.map(o=>[o.matrix.toArray(),o.matrixWorld.toArray()]),before,'validation overwrote an unsupported manual transform');assert.match(error?.message??'',/manual|unit frame/);
 }finally{idx?.dispose();a.dispose();}
});
async function labControllerForTest(args){
 if(api.createActivityLabController)return api.createActivityLabController(args);
 // Execute the legacy page's actual functions until the shared consumer exists.
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../../assets/examples/activity-lab/main.mjs',import.meta.url),'utf8');
 const assign=source.slice(source.indexOf('function assignLook('),source.indexOf('function syncUI(')),rebuild=source.slice(source.indexOf('function rebuild('),source.indexOf('function clearInertia('));
 return new Function('slot','state','providers','clay','buildActivityRelation','T','mergeGeometries','depth','alive','syncUI','readState','el','lighting',assign+rebuild+';return {assignLook,rebuild};')(args.slot,args.state,args.providers,args.clay,api.buildActivityRelation,T,mergeGeometries,args.depth,()=>{},()=>{},()=>{},()=>({value:''}),()=>{});
}
for(const operation of ['rebuild-get','rebuild-validate','switch-get','switch-validate'])test('I5 '+operation+' preserves old relation and materials',async()=>{
 const {createAssetSlot}=await import('../../assets/runtime/asset-slot.mjs');
 {
  const parent=new T.Group(),slot=createAssetSlot(parent),toon=new T.MeshStandardMaterial(),state={kind:'exchange',look:operation.startsWith('switch')?'pbr':'toon',pressFrontOffset:0,islandHoleExtra:0},controls={target:[1,2,3],position:[4,5,6],saved:[7,8,9]};let armed=false,calls=0;
  const provider={get(){if(armed&&operation.endsWith('get')&&++calls===2)throw new Error('actual look getter failure');return toon;},validateMesh(){if(armed&&operation.endsWith('validate')&&++calls===2)throw new Error('actual look validation failure');}};
  const providers={pbr:{get:()=>material,validateMesh(){}},toon:provider};
  try{const first=slot.replace(s=>s.own(build('exchange')));for(const b of first.materialBindings)b.object.material=operation.startsWith('switch')?material:toon;const oldObjects=first.materialBindings.map(b=>b.object),before={root:first.root,revision:slot.revision,materials:oldObjects.map(o=>o.material),state:structuredClone(state),controls:structuredClone(controls)};
   const controller=await labControllerForTest({slot,state,providers,clay:toon,depth:null,build:next=>build(next.kind,next)});armed=true;assert.throws(()=>operation.startsWith('rebuild')?controller.rebuild({kind:'exhibit'}):controller.assignLook('toon'),/actual look/);
   assert.ok(slot.current.root===before.root,'failed look retired old root');assert.equal(slot.revision,before.revision);assert.deepEqual(oldObjects.map(o=>o.material),before.materials);assert.deepEqual(state,before.state);assert.deepEqual(controls,before.controls);assert.deepEqual(parent.children,[before.root]);
  }finally{slot.dispose();toon.dispose();}
 }
});
test('I6 actual narrowed building reveals return a specific aperture mismatch',()=>{
 class NarrowReveal extends T.BoxGeometry{constructor(w,h,d,...rest){super(w===.065&&h>2?w+.04:w,h,d,...rest);}}
 let caught;try{const a=api.buildActivityRelation({...T,BoxGeometry:NarrowReveal},{kind:'exchange',mergeGeometries,materialFor:()=>material});a.dispose();}catch(e){caught=e;}
 assert.match(caught?.message??'',/aperture.*mismatch/);assert.equal(caught?.code,'ACTIVITY_APERTURE_MISMATCH','actual aperture rejection must identify the contract failure');assert.ok(caught.actualWidth<caught.declaredWidth);
});

test('I2 continuous subdivided real edges pass; absent top or front faces reject',()=>{
 for(const damage of ['subdivide','top','front']){
  class RailFaces extends T.BoxGeometry{constructor(w,h,d,...rest){super(w,h,d,...(w===3.84&&h===.18&&d===.20&&damage==='subdivide'?[4,1,1]:rest));if(w!==3.84||h!==.18||d!==.20||damage==='subdivide')return;const skip=this.groups[damage==='top'?2:5],idx=Array.from(this.index.array).filter((_,i)=>i<skip.start||i>=skip.start+skip.count);this.setIndex(idx);}}
  let a;try{if(damage==='subdivide'){a=api.buildActivityRelation({...T,BoxGeometry:RailFaces},{kind:'exchange',mergeGeometries,materialFor:()=>material});assert.equal(a.readState().qualification.status,'complete');const adj=a.readState().members.find(m=>m.id==='feed').measurement.portSection.adjacency;assert.ok(adj.topIntervals.length>1);assert.equal(adj.commonIntervals.length,1);}else assert.throws(()=>{a=api.buildActivityRelation({...T,BoxGeometry:RailFaces},{kind:'exchange',mergeGeometries,materialFor:()=>material});},/service.*(registration|gap|coverage)/);}finally{a?.dispose();}
 }
});
test('I1 hidden final host and later missing host draw never pass actual submission replay',async()=>{
 const base=build('exchange'),range=base.sourceRanges.find(r=>r.sourceId.startsWith('pad/')),digest=await attrDigest(range.geometry);base.dispose();const {createHash}=await import('node:crypto');
 class HiddenFinal extends T.Mesh{constructor(g,m){super(g,m);if(g.userData.hiddenFinal)this.visible=false;}}
 const merge=(...args)=>{const g=mergeGeometries(...args),a=g.attributes.position.array;if(createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex')===digest)g.userData.hiddenFinal=true;return g;};
 assert.throws(()=>api.buildActivityRelation({...T,Mesh:HiddenFinal},{kind:'exchange',mergeGeometries:merge,materialFor:()=>material}),/final.*visibility/);
 const a=build('exhibit');try{const rt=a.getRuntime(),pad=a.sourceRanges.find(r=>r.sourceId.startsWith('pad/'));pad.geometry.setDrawRange(0,0);assert.throws(()=>geometry.verifyActivitySubmission(T,{root:a.root,index:rt.submission,qualification:rt.qualification,owner:rt.owner,revision:rt.revision}),/final.*draw/);}finally{a.dispose();}
});
test('I5 successful look and relation changes borrow materials and preserve controls',async()=>{
 const {createAssetSlot}=await import('../../assets/runtime/asset-slot.mjs'),slot=createAssetSlot(new T.Group()),toon=new T.MeshStandardMaterial(),clay=new T.MeshStandardMaterial(),state={kind:'exchange',look:'pbr',pressFrontOffset:0,islandHoleExtra:0},controls=new T.Vector3(1,2,3),saved=controls.clone();let borrowed=0;toon.addEventListener('dispose',()=>borrowed++);clay.addEventListener('dispose',()=>borrowed++);
 const providers={pbr:{get:()=>material,validateMesh(){}},toon:{get:()=>toon,validateMesh(){}}},controller=api.createActivityLabController({slot,state,providers,clay,build:next=>build(next.kind,next)});
 try{controller.rebuild();controller.assignLook('toon');assert.ok(slot.current.materialBindings.every(b=>b.object.material===toon));const before=slot.revision;controller.rebuild({kind:'exhibit'});assert.equal(slot.revision,before+1);assert.equal(state.kind,'exhibit');assert.ok(slot.current.materialBindings.every(b=>b.object.material===toon));controller.assignLook('clay');assert.ok(slot.current.materialBindings.every(b=>b.object.material===clay));assert.deepEqual(controls,saved);slot.dispose();assert.equal(borrowed,0);}finally{slot.dispose();toon.dispose();clay.dispose();}
});
test('I6 false declared door width and source-double/final-float seam are actual failures',async()=>{
 const {buildRegionalArchitecture}=await import('../../assets/examples/region-programs.mjs'),a=build('exchange'),source=buildRegionalArchitecture(T,{program:'workshop',width:7,depth:4.8,height:3.4,materialFor:()=>material});try{
  const s=a.readState(),rt=a.getRuntime();source.root.position.set(...s.lot.pose.position);source.root.rotation.y=s.lot.pose.rotationY;const rows=geometry.scanActivityDraws(T,source.root,{prefix:'old-source'});source.entryBinding.port.width-=.04;
  assert.throws(()=>api.measureActivityEntrance(T,{rows,binding:source.entryBinding,sourceRoot:source.root}),e=>e.code==='ACTIVITY_APERTURE_MISMATCH'&&e.actualWidth>e.declaredWidth);
  const deck=rows.find(r=>r.object===source.entryBinding.deck),faces=geometry.captureActivityTop(deck),{qualifyActivityCourt}=await import('../../assets/scene/activity-court.mjs'),i=rt.qualificationInput;
  assert.notEqual(deck.box[5],s.sourceDoor.deckZ);const wrong={...i,site:{...i.site,hostFaces:i.site.hostFaces.map(h=>h.id==='deck'?{...h,faces}:h)}},q=qualifyActivityCourt(wrong);
  assert.equal(q.status,'unsatisfied');assert.ok(q.diagnostics.reasons.some(r=>r.code==='walk-gap'),'mixed double/F32 deck seam must not qualify');
 }finally{source.dispose();a.dispose();}
});

test('I1 a byte-equal foreign geometry cannot supply facts for another final carrier',async()=>{
 const {createAssetAssembly}=await import('../../assets/scene/asset-assembly.mjs'),asset=geometry.buildActivityPrototype(T,{id:'partsRack',materialFor:()=>material}),assembly=createAssetAssembly(T,{mergeGeometries,invariantAttributes:{aFormationPosition:3}});let clone;
 try{const rows=geometry.scanActivityDraws(T,asset.root),records=geometry.addActivityDraws(T,{rows,assemblyFor:()=>assembly,slotsFor:()=>({role:'wood',options:{maps:false}})}),out=assembly.finish(),ranges=out.sourceRanges.map(r=>({...r}));clone=ranges[0].geometry.clone();ranges[0].geometry=clone;assert.throws(()=>geometry.verifyActivityRanges(T,records,ranges),/source.*geometry.*identity/);}finally{clone?.dispose();asset.dispose();assembly.dispose();}
});
