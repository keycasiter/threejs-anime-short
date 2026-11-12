import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {dirname, resolve} from 'node:path';
import {createAssetAssembly} from '../../assets/scene/asset-assembly.mjs';

const threeURL = process.env.THREE_MODULE
  ? pathToFileURL(resolve(process.env.THREE_MODULE)).href : import.meta.resolve('three');
const THREE = await import(threeURL);
const utilsURL = process.env.THREE_MODULE
  ? pathToFileURL(resolve(dirname(resolve(process.env.THREE_MODULE)), '../examples/jsm/utils/BufferGeometryUtils.js')).href
  : import.meta.resolve('three/addons/utils/BufferGeometryUtils.js');
const {mergeGeometries} = await import(utilsURL);
const assembly = () => createAssetAssembly(THREE, {mergeGeometries});
const material = () => new THREE.MeshStandardMaterial({vertexColors:true});
function triangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3));
  return g;
}
function near(actual, expected, tolerance=1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<tolerance, `${n} != ${expected[i]}`));
}

test('static transforms preserve asset dimensions and inverse transpose lighting normals without editing inputs',()=>{
  const a=assembly(), g=triangle(), m=material();
  g.setAttribute('normal', new THREE.Float32BufferAttribute([1,1,0, 1,1,0, 1,1,0],3));
  const matrix=new THREE.Matrix4().makeScale(2,1,3).setPosition(4,5,6);
  const before=[...g.attributes.position.array], normals=[...g.attributes.normal.array];
  a.add(g,m,{matrix});
  matrix.identity();
  const r=a.finish(), mesh=r.root.children[0];
  assert.equal(mesh.material,m);
  near(mesh.geometry.boundingBox.min.toArray(),[4,5,6]);
  near(mesh.geometry.boundingBox.max.toArray(),[6,6,6]);
  near([...mesh.geometry.attributes.normal.array].slice(0,3),[1/Math.sqrt(5),2/Math.sqrt(5),0]);
  assert.deepEqual([...g.attributes.position.array],before);
  assert.deepEqual([...g.attributes.normal.array],normals);
  near(mesh.position.toArray(),[0,0,0]);
  assert.equal(r.stats.staticInputs,1);
  assert.equal(r.stats.staticMeshes,1);
  assert.equal(r.stats.staticTriangles,1);
  r.dispose();
});

test('material identity, shadow flags and layer masks split buckets while compatible inputs merge',()=>{
  const a=assembly(), m=material(), other=m.clone(), g=triangle();
  a.add(g,m);a.add(g,m,{matrix:new THREE.Matrix4().makeTranslation(2,0,0)});
  a.add(g,other);a.add(g,m,{castShadow:false});a.add(g,m,{receiveShadow:false});a.add(g,m,{layers:4});
  const r=a.finish();
  assert.equal(r.root.children.length,5);
  assert.equal(r.root.children.filter(x=>x.material===m).length,4);
  const merged=r.root.children.find(x=>x.material===m&&x.castShadow&&x.receiveShadow&&x.layers.mask===1);
  assert.equal(merged.geometry.attributes.position.count,6);
  assert.ok(r.root.children.some(x=>x.layers.mask===4));
  assert.equal(r.stats.staticInputs,6);assert.equal(r.stats.staticTriangles,6);
  r.dispose();
});

test('mixed index states preserve all triangles, UVs, normalized colors and alpha with white missing colors',()=>{
  const a=assembly(), m=material(), indexed=triangle(), plain=triangle();
  indexed.setIndex([0,1,2]);
  indexed.setAttribute('uv',new THREE.Float32BufferAttribute([0,0, 1,0, 0,1],2));
  indexed.setAttribute('color',new THREE.Uint8BufferAttribute([255,0,0,128, 0,255,0,255, 0,0,255,255],4,true));
  a.add(indexed,m);a.add(plain,m,{matrix:new THREE.Matrix4().makeTranslation(3,0,0)});
  const r=a.finish(), g=r.root.children[0].geometry;
  assert.equal(g.attributes.position.count,6);
  near([...g.attributes.uv.array],[0,0,1,0,0,1, 0,0,0,0,0,0]);
  near([...g.attributes.color.array],[1,0,0,128/255,0,1,0,1,0,0,1,1, 1,1,1,1,1,1,1,1,1,1,1,1]);
  near([...g.attributes.normal.array].slice(0,3),[0,0,1]);
  assert.ok(indexed.index);assert.equal(plain.index,null);
  r.dispose();
});

test('dynamic trees keep object identity, authored transforms and hierarchy and are excluded from merging',()=>{
  const a=assembly(), rig=new THREE.Group(), arm=new THREE.Group(), hand=new THREE.Mesh(triangle(),material());
  rig.position.set(1,2,3);arm.rotation.z=.4;rig.add(arm);arm.add(hand);
  a.dynamic(rig);const r=a.finish();
  assert.equal(r.root.children[0],rig);assert.equal(hand.parent,arm);assert.equal(arm.parent,rig);
  near(rig.position.toArray(),[1,2,3]);assert.equal(arm.rotation.z,.4);
  for(const n of [rig,arm,hand]) assert.equal(n.userData.noMerge,true);
  assert.equal(r.stats.dynamicRoots,1);
  r.dispose();assert.equal(hand.parent,arm);
});

test('dynamic registration rejects owned or duplicate roots and rechecks ownership before finish',()=>{
  const a=assembly(), parent=new THREE.Group(), child=new THREE.Group();parent.add(child);
  assert.throws(()=>a.dynamic(child),/parent/i);assert.equal(child.parent,parent);
  const root=new THREE.Group();a.dynamic(root);assert.throws(()=>a.dynamic(root),/duplicate|already/i);
  parent.add(root);assert.throws(()=>a.finish(),/parent/i);assert.equal(root.parent,parent);
  parent.remove(root);assert.throws(()=>a.finish(),/failed|closed/i);
});

test('named anchors clone matrices in local space and reject duplicate names',()=>{
  const a=assembly(), matrix=new THREE.Matrix4().makeTranslation(1,2,3);
  a.anchor('tip',matrix);matrix.identity();assert.throws(()=>a.anchor('tip',matrix),/duplicate/i);
  const r=a.finish();assert.ok(r.anchors instanceof Map);near(r.anchors.get('tip').elements.slice(12,15),[1,2,3]);
  assert.equal(r.root.children.length,0);r.dispose();
});

test('dispose releases generated geometry once and preserves caller geometry, material and dynamic resources',()=>{
  const a=assembly(), input=triangle(), m=material(), dynamicGeometry=triangle(), rig=new THREE.Mesh(dynamicGeometry,m);
  let inputReleases=0, materialReleases=0, dynamicReleases=0, outputReleases=0;
  input.addEventListener('dispose',()=>inputReleases++);m.addEventListener('dispose',()=>materialReleases++);
  dynamicGeometry.addEventListener('dispose',()=>dynamicReleases++);
  a.add(input,m);a.dynamic(rig);const r=a.finish();
  r.root.children.find(x=>x!==rig).geometry.addEventListener('dispose',()=>outputReleases++);
  assert.equal(a.finish(),r);r.dispose();r.dispose();
  assert.deepEqual([inputReleases,materialReleases,dynamicReleases,outputReleases],[0,0,0,1]);
  assert.throws(()=>a.add(input,m),/finish|closed/i);assert.throws(()=>a.dynamic(new THREE.Group()),/finish|closed/i);
  assert.throws(()=>a.anchor('late',new THREE.Matrix4()),/finish|closed/i);
});

test('unsupported attributes, morphing, invalid triangles and malformed options fail before affecting later assembly',()=>{
  const a=assembly(), m=material();
  const bad=[];
  const extra=triangle();extra.setAttribute('tangent',new THREE.Float32BufferAttribute(new Array(12).fill(0),4));bad.push(extra);
  const skin=triangle();skin.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Array(12).fill(0),4));bad.push(skin);
  const morph=triangle();morph.morphAttributes.position=[morph.attributes.position.clone()];bad.push(morph);
  const incomplete=triangle();incomplete.setIndex([0,1]);bad.push(incomplete);
  const empty=triangle();empty.setIndex([]);bad.push(empty);
  const invalidIndex=triangle();invalidIndex.setIndex([0,1,9]);bad.push(invalidIndex);
  const nan=triangle();nan.attributes.position.array[0]=NaN;bad.push(nan);
  const partial=triangle();partial.setDrawRange(0,2);bad.push(partial);
  const wrongUV=triangle();wrongUV.setAttribute('uv',new THREE.Float32BufferAttribute([0,0],2));bad.push(wrongUV);
  const instanced=triangle();instanced.setAttribute('color',new THREE.InterleavedBufferAttribute(
    new THREE.InstancedInterleavedBuffer(new Float32Array(9).fill(1),3),3,0));bad.push(instanced);
  for(const g of bad) assert.throws(()=>a.add(g,m));
  for(const matrix of [new THREE.Matrix4().makeScale(-1,1,1),new THREE.Matrix4().makeScale(1,0,1),new THREE.Matrix4().makePerspective(-1,1,1,-1,.1,10)])
    assert.throws(()=>a.add(triangle(),m,{matrix}),/matrix|transform/i);
  assert.throws(()=>a.add(triangle(),[m]));assert.throws(()=>a.add(triangle(),m,{layers:1.5}));
  assert.throws(()=>a.add(triangle(),m,{castShadow:'yes'}));assert.throws(()=>a.anchor('',new THREE.Matrix4()));
  a.add(triangle(),m);const r=a.finish();assert.equal(r.stats.staticInputs,1);r.dispose();
});

test('a merge failure is explicit and terminal and never reparents dynamic objects',()=>{
  const a=createAssetAssembly(THREE,{mergeGeometries:()=>null}), rig=new THREE.Group();
  a.add(triangle(),material());a.dynamic(rig);
  assert.throws(()=>a.finish(),/merge/i);assert.equal(rig.parent,null);
  assert.throws(()=>a.finish(),/failed|closed/i);
});

test('later merge failure releases earlier generated geometry and all private snapshots without caller disposal',()=>{
  const generated=[], snapshots=[], input=triangle();let inputReleases=0, privateReleases=0, generatedReleases=0;
  input.addEventListener('dispose',()=>inputReleases++);
  const a=createAssetAssembly(THREE,{mergeGeometries:geometries=>{
    snapshots.push(...geometries);
    for(const g of geometries)g.addEventListener('dispose',()=>privateReleases++);
    if(generated.length) throw new Error('controlled merge failure');
    const g=mergeGeometries(geometries,false);generated.push(g);
    g.addEventListener('dispose',()=>generatedReleases++);return g;
  }});
  a.add(input,material());a.add(input,material());
  assert.throws(()=>a.finish(),/controlled merge failure/);
  assert.equal(snapshots.length,2);assert.equal(privateReleases,2);
  assert.equal(generatedReleases,1);assert.equal(inputReleases,0);
  assert.throws(()=>a.add(input,material()),/failed|closed/i);
});

test('aborting an unfinished assembly releases private snapshots without merging or disposing borrowed inputs',()=>{
 const privateGeometry=[],Runtime={...THREE,BufferGeometry:class extends THREE.BufferGeometry {constructor(){super();privateGeometry.push(this);}}};
 const input=triangle(),m=material(),rig=new THREE.Group();let sourceDisposed=0,materialDisposed=0,privateDisposed=0,merges=0;
 input.addEventListener('dispose',()=>sourceDisposed++);m.addEventListener('dispose',()=>materialDisposed++);
 const a=createAssetAssembly(Runtime,{mergeGeometries:(...args)=>{merges++;return mergeGeometries(...args);}});
 a.add(input,m);a.add(input,m);a.dynamic(rig);for(const g of privateGeometry)g.addEventListener('dispose',()=>privateDisposed++);
 assert.equal(typeof a.dispose,'function');a.dispose();a.dispose();
 assert.equal(privateDisposed,2);assert.equal(sourceDisposed,0);assert.equal(materialDisposed,0);assert.equal(merges,0);assert.equal(rig.parent,null);
 assert.throws(()=>a.finish(),/closed|disposed/i);assert.throws(()=>a.add(input,m),/closed|disposed/i);input.dispose();m.dispose();
});

test('assembly ownership may span construction and finish and releases generated geometry only once',()=>{
 const a=assembly(),input=triangle(),m=material();a.add(input,m);const result=a.finish();let generated=0,source=0;
 result.root.children[0].geometry.addEventListener('dispose',()=>generated++);input.addEventListener('dispose',()=>source++);
 assert.equal(typeof a.dispose,'function');a.dispose();a.dispose();result.dispose();assert.equal(generated,1);assert.equal(source,0);
 input.dispose();m.dispose();
});

test('explicit invariants survive indexed poses, schema mutation and source mutation; snapshots retain ownership',()=>{
  const schema={aMetres:3,aPhase:1,aPair:2,aWeights:4},m=material(),g=triangle(),idx=[2,0,1],expected={},disposed=[];
  const a=createAssetAssembly(THREE,{invariantAttributes:schema,mergeGeometries(gs,groups){for(const x of gs)x.addEventListener('dispose',()=>disposed.push(x));return mergeGeometries(gs,groups);}});
  for(const [k,size] of Object.entries(schema)){
    const data=Float32Array.from({length:3*size},(_,i)=>i+.25);g.setAttribute(k,new THREE.BufferAttribute(data,size));
    expected[k]=idx.flatMap(v=>[...data.slice(v*size,(v+1)*size)]);
  }
  schema.aPhase=4;g.setIndex(idx);a.add(g,m,{matrix:new THREE.Matrix4().makeRotationY(.7)});
  a.add(g,m,{matrix:new THREE.Matrix4().makeTranslation(5,0,0)});g.attributes.aMetres.array.fill(-10);g.index.array.fill(0);
  const r=a.finish(),out=r.root.children[0].geometry;assert.equal(disposed.length,2);
  for(const [k,values] of Object.entries(expected))assert.deepEqual([...out.attributes[k].array],[...values,...values]);
  assert.notDeepEqual(out.attributes.position.array.slice(0,9),out.attributes.position.array.slice(9));
  a.dispose();r.dispose();g.dispose();m.dispose();
});

test('invariant schemas and inputs must describe ordinary, finite, per-vertex Float32 metadata',()=>{
  const create=invariantAttributes=>createAssetAssembly(THREE,{mergeGeometries,invariantAttributes});
  for(const schema of [null,[],new Date(),{normal:3},{uv3:2},{skinIndex:4},{instanceMatrix:4},{tangent:4},{bad:0},{bad:5},{bad:2.5},{bad:'3'},{['__proto__']:1},{'x-y':2}])assert.throws(()=>create(schema));
  const a=create({aHint:1}),g=triangle(),m=material();assert.throws(()=>a.add(g,m),/aHint/);
  for(const value of [new THREE.Uint8BufferAttribute([0,1,2],1),new THREE.Float32BufferAttribute([0,1,2],1,true),
    new THREE.InstancedBufferAttribute(new Float32Array(3),1),new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Float32Array(3),1),1,0),
    new THREE.Float32BufferAttribute([0,1,Infinity],1),new THREE.Float32BufferAttribute([0,1],1),
    Object.assign(new THREE.Float32BufferAttribute([0,1,2],1),{gpuType:THREE.IntType})]){
    g.setAttribute('aHint',value);assert.throws(()=>a.add(g,m),/aHint/);
  }
  g.setAttribute('aHint',new THREE.Float32BufferAttribute([2,3,4],1));g.setAttribute('aUnknown',g.attributes.aHint);assert.throws(()=>a.add(g,m),/aUnknown/);
  g.deleteAttribute('aUnknown');a.add(g,m);const r=a.finish();assert.equal(r.stats.staticInputs,1);a.dispose();g.dispose();m.dispose();
});
