import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {dirname,resolve} from 'node:path';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const utils=process.env.THREE_MODULE?pathToFileURL(resolve(dirname(resolve(process.env.THREE_MODULE)),'../examples/jsm/utils/BufferGeometryUtils.js')).href:'three/addons/utils/BufferGeometryUtils.js';
const {mergeGeometries}=await import(utils);
let api={};try{api=await import('../../assets/examples/guided-assembly.mjs')}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
function materials(){return {stone:new T.MeshStandardMaterial({color:0xaba894}),coat:new T.MeshStandardMaterial({color:0xd5c5a4,roughness:.4}),metal:new T.MeshStandardMaterial({color:0x52676b,metalness:.8}),glass:new T.MeshPhysicalMaterial({transmission:.8,roughness:.1}),accent:new T.MeshStandardMaterial({color:0xc27445})};}
function build(options={}){assert.equal(typeof api.buildGuidedAssembly,'function','a runnable guided assembly factory must exist');return api.buildGuidedAssembly(T,{mergeGeometries,materials:materials(),...options});}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('guided source drives the visible main mesh and a real surface attachment',()=>{
 const a=build();assert.ok(a.root.isGroup);assert.equal(a.parts.body.geometry,a.source.geometry);
 assert.ok(a.anchors instanceof Map);const s=a.source.surfaceAt(.62,.12);
 a.root.updateMatrixWorld(true);const expected=a.root.localToWorld(s.point.clone()),actual=a.parts.mount.getWorldPosition(new T.Vector3());near(expected.distanceTo(actual),0);
 let visible=0;a.parts.pivot.traverse(o=>{if(o.isMesh)visible++});assert.ok(visible>=5,'moving node owns the actual frame and glazing');
 a.dispose();
});
test('span rebuild changes emitted body geometry and its dependent attachment',()=>{
 const a=build({span:4}),b=build({span:8});
 assert.notDeepEqual([...a.parts.body.geometry.attributes.position.array],[...b.parts.body.geometry.attributes.position.array]);
 assert.ok(a.parts.mount.position.distanceTo(b.parts.mount.position)>.05);
 a.dispose();b.dispose();
});
test('absolute update moves visible glazing and is reproducible after unordered times',()=>{
 const a=build(),root=new T.Group();root.position.set(3,2,-1);root.rotation.y=.7;root.add(a.root);
 function pose(t){a.update(t);root.updateMatrixWorld(true);return a.parts.glazing.matrixWorld.toArray();}
 const p=pose(2);assert.notDeepEqual(p,pose(7));assert.deepEqual(p,pose(2));
 a.dispose();
});
test('surface-only variation changes instance color without moving their structure',()=>{
 const a=build({seed:19,surfaceVariant:0}),b=build({seed:19,surfaceVariant:1}),c=build({seed:20,surfaceVariant:0});
 assert.deepEqual([...a.parts.instances.instanceMatrix.array],[...b.parts.instances.instanceMatrix.array]);
 assert.notDeepEqual([...a.parts.instances.instanceColor.array],[...b.parts.instances.instanceColor.array]);
 assert.notDeepEqual([...a.parts.instances.instanceMatrix.array],[...c.parts.instances.instanceMatrix.array]);
 a.dispose();b.dispose();c.dispose();
});
test('static merge preserves UVs and its physical visible construction',()=>{
 const a=build();assert.ok(a.stats.staticInputs>=10);assert.ok(a.stats.staticMeshes>=2);
 const meshes=a.root.children.filter(o=>o.isMesh&&o!==a.parts.body&&o!==a.parts.instances);
 for(const mesh of meshes){assert.ok(mesh.geometry.attributes.uv);assert.ok(mesh.geometry.attributes.normal);assert.ok(mesh.geometry.attributes.position.count>0);}
 a.dispose();
});
test('dispose releases owned geometry and instance buffers once and preserves borrowed materials',()=>{
 const m=materials(),a=build({materials:m}),geometries=new Set();let released=0,materialsReleased=0,instancesReleased=0;
 a.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry)});
 for(const g of geometries)g.addEventListener('dispose',()=>released++);
 for(const x of Object.values(m))x.addEventListener('dispose',()=>materialsReleased++);
 a.parts.instances.addEventListener('dispose',()=>instancesReleased++);
 a.dispose();a.dispose();assert.equal(released,geometries.size);assert.equal(instancesReleased,1);assert.equal(materialsReleased,0);
 assert.throws(()=>a.update(2),/disposed/i);for(const x of Object.values(m))x.dispose();
});
test('invalid dimensions and material roles are rejected before construction',()=>{
 for(const span of [0,-1,NaN,Infinity,30])assert.throws(()=>build({span}));
 assert.throws(()=>build({materials:{}}));assert.throws(()=>build({surfaceVariant:NaN}));
});
