import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const module=await import('../../assets/materials/material-regions.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
function assign(options){assert.equal(typeof module.assignMaterialRegions,'function');return module.assignMaterialRegions(T,options);}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
function fixture(indexed=true){
 const g=new T.BufferGeometry();
 // Two +Z triangles of area 1, then a +Y triangle of area 2.
 g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,2,0,0,0,1,0,2,1,0,0,0,2],3));
 g.setIndex([0,1,2,1,3,2,0,4,1]);
 g.addGroup(0,6,4);g.addGroup(6,3,9);
 return indexed?g:g.toNonIndexed();
}

test('indexed and nonindexed samples use actual winding, centroids, area and source groups',()=>{
 for(const indexed of [true,false]){
  const geometry=fixture(indexed),samples=[];
  const result=assign({geometry,regions:[{id:'roof',match:s=>{samples.push(s);return s.normal.y>.9;}},{id:'wall',match:s=>s.normal.z>.9}]});
  assert.deepEqual(geometry.groups,[{start:0,count:6,materialIndex:1},{start:6,count:3,materialIndex:0}]);
  assert.deepEqual(result,{slots:[{id:'roof',materialIndex:0,triangleCount:1,area:2},{id:'wall',materialIndex:1,triangleCount:2,area:2}],triangleCount:3,area:4,groupCount:2});
  assert.deepEqual(samples.map(s=>s.sourceMaterialIndex),[4,4,9]);
  assert.deepEqual(samples[0].normal.toArray(),[0,0,1]);assert.deepEqual(samples[2].normal.toArray(),[0,1,0]);
  near(samples[0].centroid.x,2/3);near(samples[0].centroid.y,1/3);near(samples[2].area,2);
  assert.deepEqual(samples[2].vertices.map(v=>v.toArray()),[[0,0,0],[0,0,2],[2,0,0]]);
  assert.deepEqual(samples[2].indices,indexed?[0,4,1]:[6,7,8]);geometry.dispose();
 }
});

test('repeated semantic regions emit contiguous runs without reordering any geometry buffers',()=>{
 const geometry=fixture(),position=geometry.attributes.position,index=geometry.index;
 const custom=new T.Float32BufferAttribute([1,2,3,4,5],1);geometry.setAttribute('custom',custom);
 const indices=Array.from(index.array),positions=Array.from(position.array);
 const result=assign({geometry,regions:[{id:'ends',match:s=>s.triangleIndex!==1}],fallback:'middle'});
 assert.deepEqual(geometry.groups,[{start:0,count:3,materialIndex:0},{start:3,count:3,materialIndex:1},{start:6,count:3,materialIndex:0}]);
 assert.equal(result.groupCount,3);assert.deepEqual(result.slots.map(s=>s.triangleCount),[2,1]);
 assert.equal(geometry.index,index);assert.equal(geometry.attributes.position,position);assert.equal(geometry.attributes.custom,custom);
 assert.deepEqual(Array.from(index.array),indices);assert.deepEqual(Array.from(position.array),positions);geometry.dispose();
});

test('late unmatched, conflicting or throwing predicates leave original groups untouched',()=>{
 for(const kind of ['unmatched','conflict','throw','nonboolean']){
  const geometry=fixture(),groups=geometry.groups,before=structuredClone(groups);
  const regions=[{id:'a',match:s=>{if(s.triangleIndex===2&&kind==='throw')throw Error('classifier failed');return s.triangleIndex!==2||kind==='conflict'?true:kind==='nonboolean'?1:false;}}];
  if(kind==='conflict')regions.push({id:'b',match:s=>s.triangleIndex===2});
  assert.throws(()=>assign({geometry,regions}),kind==='throw'?/classifier failed/:undefined);
  assert.equal(geometry.groups,groups);assert.deepEqual(geometry.groups,before);geometry.dispose();
 }
});

test('fallback handles unassigned degenerate triangles with zero area and zero normal',()=>{
 const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,2,0,0],3));
 let sample;const result=assign({geometry,regions:[{id:'surface',match:s=>{sample=s;return s.area>0;}}],fallback:'degenerate'});
 assert.equal(sample.area,0);assert.deepEqual(sample.normal.toArray(),[0,0,0]);assert.equal(sample.sourceMaterialIndex,0);
 assert.deepEqual(result.slots,[{id:'surface',materialIndex:0,triangleCount:0,area:0},{id:'degenerate',materialIndex:1,triangleCount:1,area:0}]);
 assert.deepEqual(geometry.groups,[{start:0,count:3,materialIndex:1}]);geometry.dispose();
});

test('ambiguous source groups and partial draw ranges reject before invoking match',()=>{
 const mutations=[g=>g.setDrawRange(3,6),g=>g.setDrawRange(0,6),g=>g.setDrawRange(0,12),
  g=>{g.groups[0].count=3;},g=>g.addGroup(3,3,1),g=>{g.groups[1].start=5;},g=>{g.groups[1].count=4;},g=>{g.groups[1].materialIndex=-1;}];
 for(const mutate of mutations){const geometry=fixture();mutate(geometry);const groups=structuredClone(geometry.groups);let calls=0;
  assert.throws(()=>assign({geometry,regions:[{id:'all',match:()=>{calls++;return true;}}]}));assert.equal(calls,0);assert.deepEqual(geometry.groups,groups);geometry.dispose();}
 const geometry=fixture();geometry.setDrawRange(0,9);geometry.groups.reverse();
 const result=assign({geometry,regions:[{id:'source9',match:s=>s.sourceMaterialIndex===9}],fallback:'other'});assert.equal(result.slots[0].triangleCount,1);geometry.dispose();
});

test('invalid triangle streams and nonfinite positions reject without group mutation',()=>{
 const mutations=[g=>g.setIndex([0,1]),g=>g.setIndex([0,1,99]),g=>g.setIndex([0,1,-1]),g=>g.setIndex(new T.Float32BufferAttribute([0,1,1.5],1)),
  g=>g.setAttribute('position',new T.Float32BufferAttribute([0,0,NaN,1,0,0,0,1,0],3)),g=>g.setAttribute('position',new T.Float32BufferAttribute([0,0,1,0,0,1],2)),
  g=>{g.setIndex(null);g.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0],3));},g=>g.deleteAttribute('position')];
 for(const mutate of mutations){const geometry=fixture();mutate(geometry);const groups=structuredClone(geometry.groups);
  assert.throws(()=>assign({geometry,regions:[{id:'all',match:()=>true}]}));assert.deepEqual(geometry.groups,groups);geometry.dispose();}
});

test('region schema rejects ambiguous identities, empty rules and accidental options',()=>{
 const geometry=fixture(),rule={id:'one',match:()=>true};
 for(const options of [null,{}, {geometry,regions:[]},{geometry,regions:[rule,rule]},{geometry,regions:[{id:'',match:()=>true}]},{geometry,regions:[{id:'one'}]},
  {geometry,regions:[rule],fallback:'one'},{geometry,regions:[rule],fallback:''},{geometry,regions:[rule],unknown:1},{geometry:{},regions:[rule]}])assert.throws(()=>assign(options));
 geometry.dispose();
});

test('interleaved position attributes are sampled using accessor values without conversion',()=>{
 const geometry=new T.BufferGeometry(),data=new T.InterleavedBuffer(new Float32Array([7,0,0,0,7,2,0,0,7,0,1,0]),4);
 const position=new T.InterleavedBufferAttribute(data,3,1);geometry.setAttribute('position',position);
 const result=assign({geometry,regions:[{id:'front',match:s=>s.normal.z===1&&s.area===1}]});
 assert.equal(result.area,1);assert.equal(geometry.attributes.position,position);geometry.dispose();
});

test('real BoxGeometry cap area is derived from triangles rather than constructor group numbers',()=>{
 const geometry=new T.BoxGeometry(2,3,4);
 const result=assign({geometry,regions:[{id:'top',match:s=>s.normal.y>.99}],fallback:'walls-and-base'});
 assert.deepEqual(result.slots,[{id:'top',materialIndex:0,triangleCount:2,area:8},{id:'walls-and-base',materialIndex:1,triangleCount:10,area:44}]);
 assert.equal(result.area,52);assert.equal(result.groupCount,3);geometry.dispose();
});

test('small representable triangle area still produces a finite unit geometric normal',()=>{
 const geometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float64Array([0,0,0,1e-155,0,0,0,1e-155,0]),3));
 let sample;assign({geometry,regions:[{id:'all',match:s=>{sample=s;return true;}}]});
 assert.deepEqual(sample.normal.toArray(),[0,0,1]);assert.ok(sample.area>0&&sample.area<1e-300);geometry.dispose();
});

test('numeric overflow and attempted sample mutation fail atomically',()=>{
 const huge=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float64Array([0,0,0,1e308,0,0,0,1e308,0]),3));
 assert.throws(()=>assign({geometry:huge,regions:[{id:'all',match:()=>true}]}));assert.deepEqual(huge.groups,[]);huge.dispose();
 const geometry=fixture(),groups=geometry.groups;
 assert.throws(()=>assign({geometry,regions:[{id:'all',match:s=>{s.normal.y=0;return true;}}]}),TypeError);
 assert.equal(geometry.groups,groups);geometry.dispose();
});
