import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const addon=await import(new URL('../examples/jsm/math/MeshSurfaceSampler.js',process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)):import.meta.resolve('three')));
const {MeshSurfaceSampler}=addon;
const guide=await readFile(new URL('../../references/triangle-sampling.md',import.meta.url),'utf8');
const code=[...guide.matchAll(/```mjs\n([\s\S]*?)```/g)].map(m=>m[1]).find(s=>s.startsWith('// surface-candidates-example.mjs'));
const load=async()=>{
 assert.ok(code,'complete original surface-candidates ESM exists');
 // File-backed package scope lets the unchanged document resolve installed Three.
 const directory=await mkdtemp(new URL('.surface-method-',import.meta.url));
 const file=pathToFileURL(directory+'/method.mjs');
 try {await writeFile(file,code);return await import(file.href);}
 finally {await rm(directory,{recursive:true,force:true});}
};
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const vec=(a,b)=>a.toArray().forEach((v,i)=>near(v,b.getComponent(i)));
const cycle=values=>{let i=0;return()=>values[i++%values.length];};
function geometry({indexed=false,equal=false,oriented=false}={}){
 const g=new T.BufferGeometry();
 g.setAttribute('position',new T.Float32BufferAttribute(oriented?[0,0,0, 0,0,2, 1,0,0, 4,0,0, 4,2,0, 4,0,1]:[0,0,0, 0,0,2, 1,0,0, 4,0,0, 4,0,2, equal?5:7,0,0],3));
 if(indexed)g.setIndex([0,1,2,3,4,5]);
 return g;
}
function sample(api,mesh,q,{weight=null,uv=[.2,.3]}={}){
 api.validateSurfaceInput(mesh,weight);
 const s=new MeshSurfaceSampler(mesh).setRandomGenerator(api.checkedRandom(cycle([q,...uv])));
 if(weight)s.setWeightAttribute(weight);s.build();const p=new T.Vector3(),n=new T.Vector3();s.sample(p,n);return {p,n,s};
}
test('A1 real native area 1:3, indexed parity, and groups/drawRange do not mask triangles',async()=>{
 const api=await load();try{
  for(const indexed of [false,true]){const g=geometry({indexed}),m=new T.Mesh(g);g.addGroup(0,3,0);g.setDrawRange(0,3);
   g.setAttribute('color',new T.Float32BufferAttribute(Array(18).fill(1000),3));
   for(const [q,x,z] of [[.2,.5,.6],[.3,5.5,.6]]){const r=sample(api,m,q);near(r.p.x,x);near(r.p.z,z);vec(r.n,new T.Vector3(0,1,0));}
   const fallback=new MeshSurfaceSampler(m).setWeightAttribute('absent').setRandomGenerator(cycle([.3,.2,.3])).build();const p=new T.Vector3();fallback.sample(p);near(p.x,5.5);
   g.dispose();m.material.dispose();
  }
 }finally{api.releaseExample();}
});
test('A2 only weight.x controls face choice; gradient does not bias within-face barycentrics',async()=>{
 const api=await load(),g=geometry({equal:true}),m=new T.Mesh(g);try{
  g.setAttribute('density',new T.Float32BufferAttribute([1,100,-8, 1,200,-9, 1,300,-10, 3,0,90, 3,-200,80, 3,7,70],3));
  near(sample(api,m,.2,{weight:'density'}).p.x,.5);near(sample(api,m,.3,{weight:'density'}).p.x,4.5);
  const d=g.getAttribute('density');for(let i=0;i<d.count;i++){d.setY(i,-9000+i);d.setZ(i,9000-i);}
  near(sample(api,m,.3,{weight:'density'}).p.x,4.5);
  const one=new T.BufferGeometry();one.setAttribute('position',new T.Float32BufferAttribute([0,0,0, 0,0,2, 1,0,0],3));one.setAttribute('density',new T.Float32BufferAttribute([0,0,3],1));const oneMesh=new T.Mesh(one);
  const r=sample(api,oneMesh,.4,{weight:'density',uv:[.9,.05]});near(r.p.x,.05);near(r.p.z,.1);
  const reflected=sample(api,oneMesh,.4,{weight:'density',uv:[.9,.3]});near(reflected.p.x,.2);near(reflected.p.z,1.4);
  one.dispose();oneMesh.material.dispose();
 }finally{g.dispose();m.material.dispose();api.releaseExample();}
});
test('preflight rejects bad domains, weights, normals, transforms, RNG and CDF precision loss',async()=>{
 const api=await load();try{
  const check=(change,rx)=>{const g=geometry({indexed:true}),m=new T.Mesh(g);change(g,m);assert.throws(()=>api.validateSurfaceInput(m,'density'),rx);g.dispose();m.material.dispose();};
  check(()=>{},/density/);
  for(const value of [0,-1,NaN,Infinity])check(g=>g.setAttribute('density',new T.Float32BufferAttribute(Array(6).fill(value),1)),/weight|total/);
  const valid=g=>g.setAttribute('density',new T.Float32BufferAttribute(Array(6).fill(1),1));
  check(g=>{valid(g);g.index.setX(2,999);},/index/);
  check(g=>{valid(g);g.getAttribute('position').setX(1,NaN);},/position/);
  check(g=>{valid(g);g.index.setX(2,1);},/degenerate/);
  check(g=>{valid(g);g.setIndex([0,1]);},/triplet/);
  check(g=>{valid(g);g.setAttribute('position',new T.Float32BufferAttribute([],3));},/position/);
  check(g=>{valid(g);g.morphAttributes.position=[g.getAttribute('position').clone()];},/morph/);
  check(g=>{valid(g);g.setAttribute('normal',new T.Float32BufferAttribute(Array(18).fill(0),3));},/normal/);
  check((g,m)=>{valid(g);m.scale.x=-1;},/transform/);
  check((g,m)=>{valid(g);m.scale.y=0;},/transform/);
  check(g=>g.setAttribute('density',new T.Float32BufferAttribute([1e20,1e20,1e20,1,1,1],1)),/Float32/);
  for(const r of [-1,1,NaN,Infinity])assert.throws(()=>api.checkedRandom(()=>r)(),/RNG/);
  const g=geometry(),m=new T.Mesh(g);g.setAttribute('density',new T.Float32BufferAttribute([0,0,0,1,1,1],1));assert.doesNotThrow(()=>api.validateSurfaceInput(m,'density'));g.dispose();m.material.dispose();
 }finally{api.releaseExample();}
});
test('A3 original rebuild handles in-place changes and replaces captured position/index/density/geometry references',async()=>{
 const a=await load();try{
  a.host.parent.position.set(0,0,0);a.host.parent.rotation.set(0,0,0);a.host.parent.scale.set(1,1,1);
  a.rebuildCandidates({densityName:null,random:cycle([.3,.2,.3])});assert.ok(a.candidateWorld().point.x>4);
  const p=a.host.geometry.getAttribute('position');p.setX(5,4.1);
  assert.ok(a.candidateWorld().point.x>4,'stale area CDF intentionally remains until rebuild');
  a.rebuildCandidates({densityName:null,random:cycle([.3,.2,.3])});near(a.candidateWorld().point.x,.5);
  const replacement=geometry({indexed:true});a.host.geometry=replacement;
  a.rebuildCandidates({densityName:null,random:cycle([.3,.2,.3])});near(a.candidateWorld().point.x,5.5);
  replacement.setAttribute('position',geometry({equal:true}).getAttribute('position'));
  a.rebuildCandidates({densityName:null,random:cycle([.3,.2,.3])});near(a.candidateWorld().point.x,.5);
  replacement.index.setX(0,3);replacement.index.setX(1,4);replacement.index.setX(2,5);replacement.index.setX(3,0);replacement.index.setX(4,1);replacement.index.setX(5,2);
  a.rebuildCandidates({densityName:null,random:cycle([.3,.2,.3])});near(a.candidateWorld().point.x,4.5);
  replacement.setIndex([3,4,5,0,1,2]);
  a.rebuildCandidates({densityName:null,random:cycle([.3,.2,.3])});near(a.candidateWorld().point.x,4.5);
  replacement.setAttribute('density',new T.Float32BufferAttribute([10,10,10,1,1,1],1));
  a.rebuildCandidates({random:cycle([.3,.2,.3])});near(a.candidateWorld().point.x,.5);
  for(let i=0;i<6;i++)replacement.getAttribute('density').setX(i,i<3?1:10);
  a.rebuildCandidates({random:cycle([.3,.2,.3])});near(a.candidateWorld().point.x,4.5);
  replacement.setAttribute('density',new T.Float32BufferAttribute([1,1,1,10,10,10],1));
  a.rebuildCandidates({random:cycle([.3,.2,.3])});near(a.candidateWorld().point.x,4.5);
  replacement.setAttribute('normal',new T.Float32BufferAttribute(Array.from({length:6},()=>[0,1,0]).flat(),3));
  a.rebuildCandidates({random:cycle([.3,.2,.3])});vec(a.candidateWorld().normal,new T.Vector3(0,1,0));
  replacement.setAttribute('normal',new T.Float32BufferAttribute(Array.from({length:6},()=>[1,1,0]).flat(),3));
  a.rebuildCandidates({random:cycle([.3,.2,.3])});vec(a.candidateWorld().normal,new T.Vector3(1,1,0).normalize());
  replacement.dispose();
 }finally{a.releaseExample();}
});
test('A4 actual world-area snapshot changes oriented-face probabilities and transforms points/normals once',async()=>{
 const a=await load(),g=geometry({oriented:true});try{
  a.host.geometry=g;const parent=a.host.parent;parent.position.set(2,3,-4);parent.rotation.set(.2,.5,.3);parent.scale.set(4,2,1);parent.updateMatrixWorld(true);
  const local=new T.Vector3(.5,0,.6),expected=local.clone().applyMatrix4(a.host.matrixWorld);
  const expectedN=new T.Vector3(0,1,0).applyNormalMatrix(new T.Matrix3().getNormalMatrix(a.host.matrixWorld));
  a.rebuildCandidates({densityName:null,random:cycle([.6,.2,.3])});
  const localChoice=a.candidateWorld();const second=new T.Vector3(4,.6,.5).applyMatrix4(a.host.matrixWorld);vec(localChoice.point,second);
  a.rebuildCandidates({worldArea:true,densityName:null,random:cycle([.6,.2,.3])});
  const worldChoice=a.candidateWorld();vec(worldChoice.point,expected);vec(worldChoice.normal,expectedN);
  const worldArea=ids=>{const v=ids.map(i=>new T.Vector3().fromBufferAttribute(g.getAttribute('position'),i).applyMatrix4(a.host.matrixWorld));return new T.Triangle(...v).getArea();};near(worldArea([0,1,2]),4);near(worldArea([3,4,5]),2);
  // Local conversion uses the normal matrix too, not the position matrix.
  a.rebuildCandidates({densityName:null,random:cycle([.2,.2,.3])});vec(a.candidateWorld().normal,expectedN);
  const tilted=new T.Vector3(1,1,1).normalize();g.setAttribute('normal',new T.Float32BufferAttribute(Array.from({length:6},()=>tilted.toArray()).flat(),3));
  const tiltedExpected=tilted.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(a.host.matrixWorld));
  assert.ok(tiltedExpected.distanceTo(tilted.clone().transformDirection(a.host.matrixWorld))>.2,'fixture distinguishes normal matrix from direction transform');
  a.rebuildCandidates({densityName:null,random:cycle([.2,.2,.3])});vec(a.candidateWorld().normal,tiltedExpected);
  a.rebuildCandidates({worldArea:true,densityName:null,random:cycle([.2,.2,.3])});vec(a.candidateWorld().normal,tiltedExpected);
  let snapshotDisposed=0,hostDisposed=0;g.addEventListener('dispose',()=>hostDisposed++);
  a.rebuildCandidates({worldArea:true,densityName:null});const first=a.getSamplingGeometry();assert.notEqual(first,g);first.addEventListener('dispose',()=>snapshotDisposed++);
  a.rebuildCandidates({worldArea:true,densityName:null});assert.equal(snapshotDisposed,1);const secondSnapshot=a.getSamplingGeometry();assert.notEqual(first,secondSnapshot);secondSnapshot.addEventListener('dispose',()=>snapshotDisposed++);
  a.rebuildCandidates({densityName:null});assert.equal(snapshotDisposed,2);assert.equal(hostDisposed,0);
  a.releaseExample();a.releaseExample();assert.equal(snapshotDisposed,2);assert.equal(hostDisposed,0);
 }finally{a.releaseExample();g.dispose();}
});
test('I1 world-area selection preserves varied-vertex CPU normal interpolation at the same barycentric point',async()=>{
 const a=await load(),g=geometry({oriented:true});try{
  a.host.geometry=g;const parent=a.host.parent;parent.position.set(0,0,0);parent.rotation.set(0,0,0);parent.scale.set(4,2,1);parent.updateMatrixWorld(true);
  const normals=new T.Float32BufferAttribute([Math.SQRT1_2,Math.SQRT1_2,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0],3);g.setAttribute('normal',normals);const before=[...normals.array];
  const barycentric=[.2,.3,.5],normalMatrix=new T.Matrix3().getNormalMatrix(a.host.matrixWorld);
  const interpolated=new T.Vector3();barycentric.forEach((b,i)=>interpolated.addScaledVector(new T.Vector3().fromBufferAttribute(normals,i),b));
  const expected=interpolated.clone().applyNormalMatrix(normalMatrix);
  near(expected.x,.07489956);near(expected.y,.99719108);
  a.rebuildCandidates({densityName:null,random:cycle([.2,.2,.3])});const localMode=a.candidateWorld();vec(localMode.normal,expected);
  a.rebuildCandidates({worldArea:true,densityName:null,random:cycle([.2,.2,.3])});const worldMode=a.candidateWorld();
  vec(worldMode.point,localMode.point);vec(worldMode.normal,expected);vec(worldMode.normal,localMode.normal);
  const snapshotNormals=a.getSamplingGeometry().getAttribute('normal');
  for(let i=0;i<normals.count;i++)vec(new T.Vector3().fromBufferAttribute(snapshotNormals,i),new T.Vector3().fromBufferAttribute(normals,i).applyMatrix3(normalMatrix));
  assert.deepEqual([...normals.array],before,'borrowed source normal coefficients stay unchanged');
  // No normal attribute is a separate geometric-normal contract, not a shading fallback value.
  g.deleteAttribute('normal');
  const worldVertices=[0,1,2].map(i=>new T.Vector3().fromBufferAttribute(g.getAttribute('position'),i).applyMatrix4(a.host.matrixWorld));
  const geometricExpected=new T.Triangle(...worldVertices).getNormal(new T.Vector3());
  for(const worldArea of [false,true]){a.rebuildCandidates({worldArea,densityName:null,random:cycle([.2,.2,.3])});const geometric=a.candidateWorld();vec(geometric.point,localMode.point);vec(geometric.normal,geometricExpected);assert.ok(geometric.normal.distanceTo(expected)>.07);}
 }finally{a.releaseExample();g.dispose();}
});
test('A5 accepted records drive both actual parts under transformed parent; same seed repeats, density reruns qualification',async()=>{
 const a=await load();try{
  const run=()=>{a.rebuildCandidates();const r=a.collectPlacements();const parts=a.emitParts(r.accepted);return {...r,parts};};
  const x=run(),y=run();assert.ok(x.accepted.length>0);assert.deepEqual(x.accepted,y.accepted);for(let part=0;part<2;part++)assert.deepEqual([...x.parts[part].instanceMatrix.array],[...y.parts[part].instanceMatrix.array]);
  assert.equal(x.stats.candidates,x.stats.accepted+Object.values(x.stats.rejected).reduce((s,n)=>s+n,0));assert.ok(x.stats.patchChecks>0);assert.ok(x.stats.rejected['missing-footprint']>0);
  for(let i=0;i<x.accepted.length;i++){const record=x.accepted[i];assert.equal(record.id,`fixture:${record.candidateId}`);for(const part of x.parts){assert.ok(part.isInstancedMesh);assert.equal(part.count,x.accepted.length);const local=new T.Matrix4();part.getMatrixAt(i,local);const actual=part.matrixWorld.clone().multiply(local);actual.elements.forEach((v,j)=>near(v,record.frameWorld.elements[j],2e-6));}}
  const d=a.host.geometry.getAttribute('density');for(let i=0;i<3;i++)d.setX(i,100);for(let i=3;i<6;i++)d.setX(i,0);
  const z=run();assert.ok(z.stats.patchChecks>0);assert.notDeepEqual(z.accepted.map(r=>r.anchorWorld.toArray()),x.accepted.map(r=>r.anchorWorld.toArray()));assert.notDeepEqual([...z.parts[0].instanceMatrix.array],[...x.parts[0].instanceMatrix.array]);
  let released=0;a.parts[0].geometry.addEventListener('dispose',()=>released++);a.releaseExample();a.releaseExample();assert.equal(released,1);
  for(const r of [x,y,z])for(const part of r.parts)assert.equal(part.parent,null);
 }finally{a.releaseExample();}
});

// Final-review I1: integer storage is valid input, not permission to quantize world coordinates.
test('review I1 packed integer source uses logical Float32 world positions without mutating source',async()=>{
 const api=await load();
 try {
  for(const normalized of [false,true]) for(const indexed of [false,true]) {
   const g=new T.BufferGeometry();
   const p=new T.Int16BufferAttribute([0,0,0,0,0,2,2,0,0],3,normalized);
   g.setAttribute('position',p);if(indexed)g.setIndex([0,1,2]);
   const before=Buffer.from(p.array.buffer).toString('hex');api.host.geometry=g;
   const parent=api.host.parent;parent.position.set(.5,0,0);parent.rotation.set(0,0,0);parent.scale.set(1,1,1);
   api.rebuildCandidates({densityName:null,random:cycle([0,.2,.3])});const local=api.candidateWorld();
   api.rebuildCandidates({worldArea:true,densityName:null,random:cycle([0,.2,.3])});const world=api.candidateWorld();
   vec(world.point,local.point);vec(world.normal,local.normal);
   if(!normalized){near(world.point.x,1.5);near(world.point.z,.6);}
   assert.ok(api.getSamplingGeometry().attributes.position.array instanceof Float32Array);
   assert.equal(g.attributes.position,p);assert.equal(Buffer.from(p.array.buffer).toString('hex'),before);
   assert.equal(g.index?.count,indexed?3:undefined);g.dispose();
  }
 } finally {api.releaseExample();}
});
test('review I1 validates actual Float32 snapshot triangles and CDF before use',async()=>{
 const api=await load(),g=geometry();api.host.geometry=g;
 try {
  const parent=api.host.parent;parent.rotation.set(0,0,0);parent.scale.set(1,1,1);parent.position.set(16777216,0,0);
  assert.throws(()=>api.rebuildCandidates({worldArea:true,densityName:null}),/Nondegenerate/);
  parent.position.set(0,0,0);parent.scale.set(1e30,1e30,1e30);
  assert.throws(()=>api.rebuildCandidates({worldArea:true,densityName:null}),/Float32 CDF/);
  parent.scale.set(1,1,1);parent.position.set(1e40,0,0);
  assert.throws(()=>api.rebuildCandidates({worldArea:true,densityName:null}),/Finite position/);
 } finally {api.releaseExample();g.dispose();}
});

// R1: rebasing must happen before narrowing otherwise representable world coordinates.
test('review R1 Uint32 rebasing transforms logical coordinates before the first Float32 store',async()=>{
 const api=await load();
 try {
  for(const indexed of [false,true]) {
   const g=new T.BufferGeometry(),p=new T.Uint32BufferAttribute([16777217,0,0,16777217,0,2,16777221,0,0],3);
   g.setAttribute('position',p);if(indexed)g.setIndex([0,1,2]);
   g.computeBoundingBox();g.computeBoundingSphere();
   const index=g.index,positionBytes=Buffer.from(p.array.buffer).toString('hex'),indexBytes=index?Buffer.from(index.array.buffer).toString('hex'):null;
   let sourceDisposed=0;g.addEventListener('dispose',()=>sourceDisposed++);api.host.geometry=g;
   try {
    const parent=api.host.parent;parent.position.set(-16777216,0,0);parent.rotation.set(0,0,0);parent.scale.set(1,1,1);
    api.rebuildCandidates({densityName:null,random:cycle([0,.2,.3])});const local=api.candidateWorld();
    vec(local.point,new T.Vector3(3,0,.6));
    api.rebuildCandidates({worldArea:true,densityName:null,random:cycle([0,.2,.3])});const world=api.candidateWorld();
    vec(world.point,local.point);vec(world.normal,local.normal);
    const snapshot=api.getSamplingGeometry(),stored=snapshot.attributes.position;
    assert.ok(stored.array instanceof Float32Array);assert.notEqual(stored,p);
    assert.deepEqual([...stored.array],[1,0,0,1,0,2,5,0,0],'store final world vertices once, without premature rounding or double transform');
    assert.deepEqual(snapshot.boundingBox.min.toArray(),[1,0,0]);assert.deepEqual(snapshot.boundingBox.max.toArray(),[5,0,2]);
    assert.equal(g.boundingBox.min.x,16777217);assert.equal(g.boundingBox.max.x,16777221);
    assert.equal(g.attributes.position,p);assert.equal(Buffer.from(p.array.buffer).toString('hex'),positionBytes);
    assert.equal(g.index,index);assert.equal(index?Buffer.from(index.array.buffer).toString('hex'):null,indexBytes);
    assert.equal(sourceDisposed,0);
   } finally {g.dispose();}
  }
 } finally {api.releaseExample();}
});
