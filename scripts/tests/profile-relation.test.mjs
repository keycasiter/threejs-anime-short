import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createAssetSlot} from '../../assets/runtime/asset-slot.mjs';
import {createResourceScope} from '../../assets/runtime/resource-scope.mjs';
const T = await import(process.env.THREE_MODULE ? pathToFileURL(resolve(process.env.THREE_MODULE)).href : 'three');
let api = {}; try {api = await import('../../assets/examples/profile-relation.mjs');} catch(e) {if(e.code !== 'ERR_MODULE_NOT_FOUND') throw e;}
const spec = {id:'region/asset-1',representation:'revolved-shell',height:3,width:2,depth:2,bend:0,wallThickness:.12};
function setup(input = spec) {
  assert.equal(typeof api.buildProfileRelation, 'function', 'shared design must drive a runnable profile relation');
  const materials = {body:new T.MeshStandardMaterial(),metal:new T.MeshStandardMaterial(),support:new T.MeshStandardMaterial()};
  return {a:api.buildProfileRelation(T,{spec:input,materials}), materials};
}
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-5, `${a} != ${b}`);
const clear = ({a,materials}) => {a.dispose();Object.values(materials).forEach(m=>m.dispose());};

test('both selected representations emit actual surfaces with UVs, normals, support and a real mounted fixture', () => {
  for(const input of [spec,{...spec,representation:'section-loft',depth:1.3,bend:.6}]) {
    const context = setup(input), {a} = context;
    assert.equal(a.spec.id, input.id); assert.equal(a.parts.body.material, context.materials.body);
    for(const key of ['position','normal','uv']) assert.ok(a.parts.body.geometry.getAttribute(key)?.count > 0);
    a.root.updateWorldMatrix(true,true);
    const anchorPoint = new T.Vector3().setFromMatrixPosition(a.anchors.get('service'));
    const fixturePoint = a.parts.fixture.getWorldPosition(new T.Vector3()); close(anchorPoint.distanceTo(fixturePoint),0);
    const z = new T.Vector3().setFromMatrixColumn(a.anchors.get('service'),2);
    const hit = a.sampleSurface(anchorPoint.clone().addScaledVector(z,.2),z.clone().negate());
    assert.ok(hit); close(hit.point.distanceTo(anchorPoint),0); assert.ok(hit.normal.dot(z)>.999);
    close(a.parts.body.geometry.boundingBox.min.y,.18);
    close(a.parts.pedestal.geometry.parameters.height,.18); clear(context);
  }
});
test('changing structural dimensions rebuilds real vertices and dependent attachment while preserving input snapshot', () => {
  const input={...spec}, first=setup(input), second=setup({...spec,height:4,width:2.6,depth:2.6});
  const positions = a => [...a.parts.body.geometry.attributes.position.array];
  assert.notDeepEqual(positions(first.a),positions(second.a));
  const p = a => new T.Vector3().setFromMatrixPosition(a.anchors.get('service'));
  assert.ok(p(first.a).distanceTo(p(second.a))>.3);
  input.height=9; assert.equal(first.a.spec.height,3); assert.ok(Object.isFrozen(first.a.spec));
  close(second.a.parts.body.geometry.boundingBox.max.y,4.18);
  clear(first);clear(second);
});
test('actual surface queries and ports remain valid after world placement', () => {
  const context=setup(), {a}=context, parent=new T.Group(); parent.position.set(7,2,-3);parent.rotation.y=.7;parent.add(a.root);parent.updateWorldMatrix(true,true);
  const port=a.root.matrixWorld.clone().multiply(a.anchors.get('service'));
  const point=new T.Vector3().setFromMatrixPosition(port),normal=new T.Vector3().setFromMatrixColumn(port,2);
  const hit=a.sampleSurface(point.clone().addScaledVector(normal,.3),normal.clone().negate());
  assert.ok(hit); close(hit.point.distanceTo(point),0);
  close(a.parts.fixture.getWorldPosition(new T.Vector3()).distanceTo(point),0);clear(context);
});
test('representation constraints reject false symmetry and unsupported topology before constructing', () => {
  const m={body:new T.MeshStandardMaterial(),metal:new T.MeshStandardMaterial(),support:new T.MeshStandardMaterial()};
  assert.equal(typeof api.buildProfileRelation,'function');
  for(const bad of [{representation:'implicit'},{depth:1.2},{bend:.5},{wallThickness:1},{height:NaN},{id:''}]) {
    assert.throws(()=>api.buildProfileRelation(T,{materials:m,spec:{...spec,...bad}}));
  }
  Object.values(m).forEach(x=>x.dispose());
});
test('factory releases each generated geometry once without disposing its borrowed materials', () => {
  const context=setup(),geometries=new Set(),materials=new Set(Object.values(context.materials));let n=0,m=0;
  context.a.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});
  geometries.forEach(g=>g.addEventListener('dispose',()=>n++));materials.forEach(g=>g.addEventListener('dispose',()=>m++));
  context.a.dispose();context.a.dispose();assert.equal(n,geometries.size);assert.equal(m,0);
  assert.throws(()=>context.a.sampleSurface(new T.Vector3(),new T.Vector3(0,0,1)),/disposed/i);
  materials.forEach(x=>x.dispose());
});
test('slot rebuild failure retains actual geometry and shared material edits do not require reconstruction', () => {
  const context=setup(), parent=new T.Group(), slot=createAssetSlot(parent), {materials}=context;
  context.a.dispose();const first=slot.replace(s=>s.own(api.buildProfileRelation(T,{spec,materials})));
  const geometry=first.parts.body.geometry; materials.body.roughness=.23;
  assert.equal(first.parts.body.material.roughness,.23);assert.equal(slot.current.parts.body.geometry,geometry);
  assert.throws(()=>slot.replace(s=>s.own(api.buildProfileRelation(T,{spec:{...spec,depth:1},materials}))));
  assert.equal(slot.current,first);assert.equal(first.root.parent,parent);assert.equal(slot.revision,1);
  slot.dispose();Object.values(materials).forEach(x=>x.dispose());
});
test('the published ESM guidance runs real construction and releases both generations and shared materials', async () => {
  const doc=await readFile(new URL('../../references/implementation-foundations.md',import.meta.url),'utf8');
  const block=[...doc.matchAll(/```js\n([\s\S]*?)```/g)][0][1].replace(/^import .+;\n/gm,'');
  let disposedGeometry=0,disposedMaterial=0,builds=0;
  function observedScope(){
    const s=createResourceScope(),own=s.own;
    s.own=(value,release)=>{if(value.isMaterial)value.addEventListener('dispose',()=>disposedMaterial++);return own(value,release);};return s;
  }
  function observedBuild(runtime,options){
    builds++;const a=api.buildProfileRelation(runtime,options);
    a.parts.body.geometry.addEventListener('dispose',()=>disposedGeometry++);return a;
  }
  const run=new Function('T','createResourceScope','createAssetSlot','buildProfileRelation',block+'\nreturn {scene,slot,design};');
  const result=run(T,observedScope,createAssetSlot,observedBuild);
  assert.equal(builds,2);assert.equal(disposedGeometry,2);assert.equal(disposedMaterial,3);
  assert.equal(result.design.height,4);assert.equal(result.slot.current,null);assert.equal(result.scene.children.length,0);
});
