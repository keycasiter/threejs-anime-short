import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSectionLoftSource} from '../../assets/geometry/loft-source.mjs';
import {createBoundedProfileGeometry} from '../../assets/geometry/bounded-profile.mjs';
import {estimateSamplingStep} from '../../assets/geometry/projected-sampling.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const text=await readFile(new URL('../../references/visual-construction.md',import.meta.url),'utf8');
const blocks=[...text.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]);
function block(needle){const b=blocks.find(b=>b.includes(needle));assert.ok(b,`document recipe ${needle} exists`);return b;}
function recipe(name){return vm.runInNewContext(`${block(`function ${name}(`)};${name}`);}
test('surface patch recipe samples emitted indexed triangles under transformed parents',()=>{
 const fn=recipe('sampleTrianglePatch'),geometry=new T.PlaneGeometry(2,2),material=new T.MeshBasicMaterial();
 const parent=new T.Group();parent.position.set(4,1,-2);parent.rotation.y=.6;parent.scale.set(2,1,.8);
 const mesh=new T.Mesh(geometry,material);parent.add(mesh);mesh.position.y=2;
 const points=fn(T,mesh,[0]),p=geometry.attributes.position,index=geometry.index;
 assert.equal(points.length,4);
 const expected=[0,1,2].map(i=>mesh.localToWorld(new T.Vector3().fromBufferAttribute(p,index.getX(i))));
 for(let i=0;i<3;i++)assert.ok(points[i].distanceTo(expected[i])<1e-10);
 const center=expected.reduce((a,b)=>a.add(b),new T.Vector3()).multiplyScalar(1/3);assert.ok(points[3].distanceTo(center)<1e-10);
 assert.throws(()=>fn(T,mesh,[999]));assert.throws(()=>fn(T,new T.InstancedMesh(geometry,material,1),[0]));
 geometry.dispose();material.dispose();
});
test('regional offsets move actual selected geometry while preserving outside domain, topology and source',()=>{
 const fn=recipe('applyRegionalOffsets'),source=new T.PlaneGeometry(4,4,16,16),old=[...source.attributes.position.array];
 source.setAttribute('tangent',new T.Float32BufferAttribute(new Float32Array(source.attributes.position.count*4),4));
 const result=fn(T,source,[{center:[0,0,0],radii:[1,1,1],offset:[0,0,.4]}]),p=result.attributes.position;
 let moved=0,unchanged=0;
 for(let i=0;i<p.count;i++){
  const x=old[i*3],y=old[i*3+1];
  if(x*x+y*y>=1){assert.equal(p.getZ(i),0);unchanged++;}else if(p.getZ(i)>0)moved++;
 }
 assert.ok(moved>5&&unchanged>5);assert.deepEqual([...source.attributes.position.array],old);
 assert.deepEqual([...source.index.array],[...result.index.array]);assert.equal(result.attributes.tangent,undefined);assert.ok(source.attributes.tangent);
 result.computeBoundingBox();assert.ok(result.boundingBox.max.z>.39);assert.ok([...result.attributes.normal.array].every(Number.isFinite));
 assert.throws(()=>fn(T,source,[{center:[0,0,0],radii:[0,1,1],offset:[0,0,1]}]));
 source.dispose();result.dispose();
});
test('material comparison observes real material and restores after success and capture failure',async()=>{
 const fn=recipe('captureMaterialCandidate'),a=new T.MeshStandardMaterial({roughness:.9}),b=a.clone();b.roughness=.2;
 const mesh=new T.Mesh(new T.SphereGeometry(1,8,6),a);let count=0;
 const answer=await fn(mesh,b,async()=>{assert.equal(mesh.material,b);count++;return mesh.material.roughness;});
 assert.equal(answer,.2);assert.equal(mesh.material,a);assert.equal(count,1);
 await assert.rejects(()=>fn(mesh,b,async()=>{assert.equal(mesh.material,b);throw new Error('capture failed');}),/capture failed/);
 assert.equal(mesh.material,a);mesh.geometry.dispose();a.dispose();b.dispose();
});
test('documented full-footprint caller emits real closed profile geometry in the owner frame',()=>{
 const parent=new T.Group(),coverMaterial=new T.MeshStandardMaterial(),ownerFrame=new T.Matrix4().makeRotationX(-Math.PI/2);
 const code=block('const boundary=').replace(/^import .*;\n/gm,'');
 const out=vm.runInNewContext(code+';({part});',{T,parent,coverMaterial,ownerFrame,createBoundedProfileGeometry});
 assert.ok(out.part);assert.equal(parent.children.length,1);assert.ok(parent.children[0].geometry.attributes.position.count>20);
 assert.equal(parent.children[0].matrixAutoUpdate,false);out.part.dispose();coverMaterial.dispose();
});
test('documented structure variants change internal vertices and retain common endpoint heights',()=>{
 const code=block('const familySpecs=').replace(/^import .*;\n/gm,'');
 const family=vm.runInNewContext(code+';family;',{T,createSectionLoftSource});
 const a=family.get('tapered').geometry,b=family.get('offset').geometry;
 assert.notDeepEqual([...a.attributes.position.array],[...b.attributes.position.array]);
 for(const g of [a,b]){g.computeBoundingBox();assert.equal(g.boundingBox.min.y,0);assert.equal(g.boundingBox.max.y,3);}
 for(const source of family.values())source.dispose();
});
test('documented sampling caller produces a finite actual subdivision count',()=>{
 const camera=new T.PerspectiveCamera(45,1,.1,100);camera.position.z=8;camera.updateMatrixWorld(true);
 const code=block('const amplitude=').replace(/^import .*;\n/gm,'');
 const out=vm.runInNewContext(code+';({sampling,segments});',{T,camera,criticalWorldPoint:new T.Vector3(),profileSpanWorld:2,estimateSamplingStep});
 assert.ok(Number.isInteger(out.segments)&&out.segments>4);assert.ok(out.sampling.step>0&&Number.isFinite(out.sampling.step));
});
test('caption recipe follows camera distance with hysteresis and restores prior hidden state',()=>{
 const bind=recipe('bindCaptionDistance'),controls=new T.EventDispatcher();let d=15;controls.getDistance=()=>d;
 const a={hidden:false},b={hidden:true},cleanup=bind(controls,[a,b],{enter:10,exit:12});
 assert.equal(a.hidden,false);assert.equal(b.hidden,true);
 d=9;controls.dispatchEvent({type:'change'});assert.equal(a.hidden,true);
 d=11;controls.dispatchEvent({type:'change'});assert.equal(a.hidden,true);
 d=12;controls.dispatchEvent({type:'change'});assert.equal(a.hidden,false);assert.equal(b.hidden,true);
 d=11;controls.dispatchEvent({type:'change'});assert.equal(a.hidden,false);
 d=9;controls.dispatchEvent({type:'change'});assert.equal(a.hidden,true);cleanup();assert.equal(a.hidden,false);assert.equal(b.hidden,true);
 d=8;controls.dispatchEvent({type:'change'});assert.equal(a.hidden,false);
 assert.throws(()=>bind(controls,[a],{enter:10,exit:9}));
});
