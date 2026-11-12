import {test} from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const page = await readFile(new URL('../../references/geometry-postprocess.md', import.meta.url), 'utf8').catch(()=> '');
assert.match(page, /```js\n([\s\S]*?)```/, 'executable geometry method must exist');
const code = page.match(/```js\n([\s\S]*?)```/)[1];
const directory=await mkdtemp(new URL('.geometry-method-',import.meta.url));
const file=pathToFileURL(directory+'/method.mjs');
let api;
try {await writeFile(file,code);api=await import(file.href);}
finally {await rm(directory,{recursive:true,force:true});}
const { THREE, utils, MikkTSpace, prepareGeometry } = api;
const { exampleEvidence } = api;
assert.ok(exampleEvidence, 'standalone ESM must execute caller-owned procedural Mikk example');
assert.equal(exampleEvidence.sourceDisposed,1); assert.equal(exampleEvidence.resultDisposed,1);
assert.equal(exampleEvidence.source.index.count,6); assert.equal(exampleEvidence.result.index,null);
assert.equal(exampleEvidence.result.attributes.tangent.itemSize,4);
for(let i=0;i<6;i++) { const t=exampleEvidence.result.attributes.tangent; assert.ok(Math.abs(t.getX(i)-1)<1e-6); assert.ok(Math.abs(t.getY(i))<1e-6); assert.equal(t.getW(i),-1); }
const plane = () => { const g=new THREE.PlaneGeometry(1,1); g.name='fixture'; g.userData={intent:'test'}; g.clearGroups(); g.addGroup(0,3,2); g.addGroup(3,3,4); g.setDrawRange(0,6); return g; };
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6, `${a} != ${b}`);
const snap=g=>JSON.stringify({attributes:Object.fromEntries(Object.entries(g.attributes).map(([k,a])=>[k,{raw:[...a.array],itemSize:a.itemSize,normalized:a.normalized,gpuType:a.gpuType}])),index:g.index?[...g.index.array]:null,groups:g.groups,name:g.name,userData:g.userData,drawRange:g.drawRange});
let g=plane(), before=snap(g);
let out=await prepareGeometry(g,{operation:'mikk',negateSign:false});
assert.equal(snap(g),before); assert.equal(g.index.count,6); assert.equal(out.index,null); assert.equal(out.name,'fixture'); assert.equal(out.userData.intent,g.userData.intent); assert.deepEqual(out.groups,g.groups); assert.ok(out.boundingBox && out.boundingSphere); assert.equal(out.userData.geometryQueries,'rebuild');
assert.equal(MikkTSpace.isReady,true); assert.ok(MikkTSpace.wasm.memory instanceof WebAssembly.Memory);
for(const mirrored of [false,true]) {
 g=plane(); if(mirrored) for(let i=0;i<g.attributes.uv.count;i++) g.attributes.uv.setX(i,-g.attributes.uv.getX(i));
 const a=await prepareGeometry(g,{operation:'mikk',negateSign:false}), b=await prepareGeometry(g,{operation:'mikk',negateSign:true});
 for(let i=0;i<a.attributes.position.count;i++) {const t=new THREE.Vector3().fromBufferAttribute(a.attributes.tangent,i), n=new THREE.Vector3().fromBufferAttribute(a.attributes.normal,i); near(t.length(),1); near(t.dot(n),0); near(t.x,mirrored?-1:1); near(t.y,0); near(t.z,0); near(a.attributes.tangent.getW(i),mirrored?-1:1); near(b.attributes.tangent.getW(i),-a.attributes.tangent.getW(i)); for(let k=0;k<3;k++) near(t.getComponent(k),b.attributes.tangent.getComponent(i,k)); }
}
g=plane(); assert.throws(()=>utils.computeMikkTSpaceTangents(g,{isReady:false}),/Initialized/); g.deleteAttribute('uv'); await assert.rejects(prepareGeometry(g,{operation:'mikk',negateSign:false}),/uv/);
const duplicate=()=>{ const g=plane().toNonIndexed(); g.setAttribute('color',new THREE.Uint8BufferAttribute(Array(g.attributes.position.count).fill([128,64,255]).flat(),3,true)); return g; };
g=duplicate(); before=snap(g); out=await prepareGeometry(g,{operation:'weld',tolerance:1e-4}); assert.notEqual(out,g); assert.equal(out.attributes.position.count,4); assert.equal(snap(g),before); assert.deepEqual([...out.attributes.color.array],[128,64,255,128,64,255,128,64,255,128,64,255]); near(out.attributes.color.getX(0),128/255);
g=duplicate(); g.setAttribute('signed',new THREE.Int8BufferAttribute(Array(6).fill(-128),1,true));
out=await prepareGeometry(g,{operation:'weld',tolerance:1e-4});
assert.equal(g.attributes.signed.array[0],-128); assert.equal(out.attributes.signed.array[0],-127);
near(g.attributes.signed.getX(0),-1); near(out.attributes.signed.getX(0),-1);
for(const name of ['uv','normal','formation']) {g=duplicate(); if(name==='formation')g.setAttribute(name,new THREE.Float32BufferAttribute([0,0,0,1,0,0],1)); else g.attributes[name].setX(3,0.37); out=await prepareGeometry(g,{operation:'weld',tolerance:1e-4}); assert.ok(out.attributes.position.count>4,name);}
for(const mutate of [g=>g.setDrawRange(3,3),g=>g.morphAttributes.position=[g.attributes.position.clone()],g=>g.setAttribute('extra',new THREE.Float32BufferAttribute(new Float32Array(20),5)),g=>g.attributes.position.setX(0,1e10),g=>g.setAttribute('extra',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Float32Array(12),3),3,0))]) {g=plane(); mutate(g); await assert.rejects(prepareGeometry(g,{operation:'weld',tolerance:1e-4}));}
const fold=(offset=0)=>{const r=Math.PI/6,g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,0,offset,0,0,-Math.cos(r)+offset,Math.sin(r),1,offset,0],3)); return g;};
for(const indexed of [false,true]) for(const angle of [20,40]) {g=fold(); if(indexed)g.setIndex([0,1,2,3,4,5]); const direct=g.clone(), native=utils.toCreasedNormals(direct,angle*Math.PI/180); assert.equal(native===direct,!indexed); out=await prepareGeometry(g,{operation:'crease',angle:angle*Math.PI/180,acceptPositionBuckets:true}); const n=new THREE.Vector3().fromBufferAttribute(out.attributes.normal,0); near(n.length(),1); near(n.y,angle===20?0:Math.sin(Math.PI/12)); near(n.z,angle===20?1:Math.cos(Math.PI/12));}
g=fold(.001); out=await prepareGeometry(g,{operation:'crease',angle:Math.PI/3,acceptPositionBuckets:true}); assert.ok(out.attributes.normal.getY(0)>.1,'disconnected shells blend'); await assert.rejects(prepareGeometry(g,{operation:'crease',angle:Math.PI/3}),/buckets/); await assert.rejects(prepareGeometry(g,{operation:'crease',angle:0,acceptPositionBuckets:true}),/angle/);
g=plane(); g.attributes.position.setXYZ(0,0,0,0); g.attributes.position.setXYZ(1,0,0,0); await assert.rejects(prepareGeometry(g,{operation:'crease',angle:1,acceptPositionBuckets:true}),/degenerate/);
// Independent hash-bucket intervention: close values can straddle a bucket.
g=duplicate(); g.setAttribute('formation',new THREE.Float32BufferAttribute([0,0,0,0.000049,0,0],1));
out=await prepareGeometry(g,{operation:'weld',tolerance:1e-4}); assert.equal(out.attributes.position.count,4);
g.attributes.formation.setX(3,0.000051); out=await prepareGeometry(g,{operation:'weld',tolerance:1e-4}); assert.equal(out.attributes.position.count,5);
// Native Mikk object identity and native morph collapse demonstrate distinct provider boundaries.
g=plane(); const nativeMikk=utils.computeMikkTSpaceTangents(g,MikkTSpace,false); assert.equal(nativeMikk,g); assert.equal(g.index,null);
g=duplicate(); g.morphAttributes.position=[g.attributes.position.clone()]; g.morphAttributes.position[0].setX(3,9); const mergedMorph=utils.mergeVertices(g,1e-4); assert.equal(mergedMorph.attributes.position.count,4); assert.equal(mergedMorph.morphAttributes.position[0].getX(mergedMorph.index.getX(3)),g.morphAttributes.position[0].getX(1));
// Cleanup after a late preparation failure; source and its ownership survive.
g=plane(); before=snap(g); let released=0;
const originalBounds=THREE.BufferGeometry.prototype.computeBoundingBox,originalDispose=THREE.BufferGeometry.prototype.dispose;
THREE.BufferGeometry.prototype.computeBoundingBox=function(){throw new Error('fixture late bounds failure');};
THREE.BufferGeometry.prototype.dispose=function(){assert.notEqual(this,g,'borrowed source survives late failure');released++;return originalDispose.call(this);};
try {await assert.rejects(prepareGeometry(g,{operation:'mikk',negateSign:false}),/late bounds/);assert.equal(released,1);assert.equal(snap(g),before);}
finally {THREE.BufferGeometry.prototype.computeBoundingBox=originalBounds;THREE.BufferGeometry.prototype.dispose=originalDispose;g.dispose();}
console.log('PASS geometry-postprocess exact document ESM: native WASM, weld/seams/layout, crease, ownership, metadata');

for(const operation of ['weld','crease','mikk']) test(`review I2 ${operation} preserves surviving GPU contracts through indexed and expanded input`,async()=>{
 for(const indexed of [true,false]) {
  const source=plane();source.setAttribute('region',new THREE.Uint16BufferAttribute([11,22,33,44],1));source.attributes.region.gpuType=THREE.IntType;
  source.attributes.normal.gpuType=THREE.IntType;
  source.setAttribute('tangent',new THREE.Float32BufferAttribute(Array(4).fill([1,0,0,1]).flat(),4));source.attributes.tangent.gpuType=THREE.IntType;
  const g=indexed?source:source.toNonIndexed();
  // toNonIndexed itself drops flags: model the actual caller's nondefault input contract.
  for(const name of ['region','normal','tangent'])g.attributes[name].gpuType=THREE.IntType;
  const before=snap(g),ids=g.index?[...g.index.array]:Array.from({length:g.attributes.position.count},(_,i)=>i);
  const spec=operation==='weld'?{operation,tolerance:1e-4}:operation==='crease'?{operation,angle:1,acceptPositionBuckets:true}:{operation,negateSign:false};
  let result;
  try {
   result=await prepareGeometry(g,spec);assert.equal(snap(g),before);
   const region=result.attributes.region;assert.equal(region.gpuType,THREE.IntType);assert.ok(region.array instanceof Uint16Array);assert.equal(region.normalized,false);
   const resultIds=result.index?[...result.index.array]:Array.from({length:region.count},(_,i)=>i);
   assert.deepEqual(resultIds.map(i=>region.getX(i)),ids.map(i=>g.attributes.region.getX(i)));
   assert.equal(result.attributes.normal.gpuType,operation==='crease'?THREE.FloatType:THREE.IntType);
   if(operation==='mikk')assert.equal(result.attributes.tangent.gpuType,THREE.FloatType,'new solver tangent keeps generated float contract');
   else assert.equal(result.attributes.tangent,undefined);
  } finally {result?.dispose();g.dispose();if(g!==source)source.dispose();}
 }
});
for(const operation of ['weld','crease','mikk']) test(`review I3 ${operation} prepared primitive round-trips actual payload through ObjectLoader`,async()=>{
 const g=new THREE.PlaneGeometry(3,2);g.name='non-unit procedural plane';g.userData={intent:'authored',nested:{keep:7}};g.addGroup(0,3,0);g.addGroup(3,3,0);
 g.setAttribute('region',new THREE.Uint16BufferAttribute([11,22,33,44],1));g.attributes.region.gpuType=THREE.IntType;
 const before=snap(g),spec=operation==='weld'?{operation,tolerance:1e-4}:operation==='crease'?{operation,angle:1,acceptPositionBuckets:true}:{operation,negateSign:false};
 let result,mesh,restored;
 try {
  result=await prepareGeometry(g,spec);mesh=new THREE.Mesh(result,new THREE.MeshBasicMaterial());
  restored=new THREE.ObjectLoader().parse(mesh.toJSON());const loaded=restored.geometry;
  assert.equal(loaded.type,'BufferGeometry');assert.equal(loaded.name,g.name);assert.deepEqual(loaded.groups,result.groups);assert.deepEqual(loaded.userData,result.userData);
  assert.deepEqual(loaded.index?[...loaded.index.array]:null,result.index?[...result.index.array]:null);
  assert.deepEqual(Object.keys(loaded.attributes).sort(),Object.keys(result.attributes).sort());
  for(const [name,a] of Object.entries(result.attributes)) {
   const b=loaded.attributes[name];assert.equal(b.itemSize,a.itemSize);assert.equal(b.normalized,a.normalized);assert.equal(b.array.constructor,a.array.constructor);assert.deepEqual([...b.array],[...a.array]);
  }
  loaded.computeBoundingBox();assert.deepEqual(loaded.boundingBox.getSize(new THREE.Vector3()).toArray(),[3,2,0]);
  if(operation==='mikk')assert.equal(loaded.attributes.tangent.itemSize,4);
  // Native r180 JSON omits gpuType: in-memory preservation is not transport preservation.
  assert.equal(result.attributes.region.gpuType,THREE.IntType);assert.equal(loaded.attributes.region.gpuType,THREE.FloatType);
  assert.equal(snap(g),before);assert.equal(g.type,'PlaneGeometry');assert.equal(g.parameters.width,3);
 } finally {restored?.geometry.dispose();restored?.material.dispose();mesh?.material.dispose();result?.dispose();g.dispose();}
});
test('review I4 native weld quantization collapse rejects output, disposes both private geometries and preserves source',async()=>{
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,.00004,0,0,0,1,0],3));g.name='thin authored triangle';g.addGroup(0,3,0);
 const before=snap(g),control=utils.mergeVertices(g,1e-4);assert.deepEqual([...control.index.array],[0,0,1]);control.dispose();
 const a=new THREE.Vector3().fromBufferAttribute(g.attributes.position,0),b=new THREE.Vector3().fromBufferAttribute(g.attributes.position,1),c=new THREE.Vector3().fromBufferAttribute(g.attributes.position,2);
 assert.ok(new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).lengthSq()>1e-20,'input passes area threshold independently');
 const oldDispose=THREE.BufferGeometry.prototype.dispose,disposed=[];
 THREE.BufferGeometry.prototype.dispose=function(){disposed.push(this);return oldDispose.call(this);};
 try {
  await assert.rejects(prepareGeometry(g,{operation:'weld',tolerance:1e-4}),/weld.*triangle 0.*degenerate/i);
  assert.equal(disposed.length,2);assert.equal(new Set(disposed).size,2);assert.ok(!disposed.includes(g));
  assert.ok(disposed.some(x=>x.index && JSON.stringify([...x.index.array])==='[0,0,1]'),'invalid result disposed');
  assert.equal(snap(g),before);
 } finally {THREE.BufferGeometry.prototype.dispose=oldDispose;g.dispose();}
});
