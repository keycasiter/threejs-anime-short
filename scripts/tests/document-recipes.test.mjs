import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {compileCorridorGraph,generateFrontageLots} from '../../assets/scene/corridor-layout.mjs';
import {createSectionLoftGeometry} from '../../assets/geometry/section-loft.mjs';
import {createFractalHeightField,createHeightFieldGeometry} from '../../assets/environment/height-field.mjs';
const THREE=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');

test('document particle recipe remains visible after the emitter moves into another camera view',async()=>{
 const source=await readFile(new URL('../../references/effect-recipes.md',import.meta.url),'utf8');
 const code=[...source.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]).find(b=>b.includes('function updateParticles('));
 assert.ok(code,'callable particle recipe');
 const scene=new THREE.Scene(),api=vm.runInNewContext(`${code}\n;({particles,particleGeometry,particleMaterial,updateParticles})`,{THREE,scene});
 const camera=new THREE.PerspectiveCamera(40,1,.1,50);
 function visibleAt(x){camera.position.set(x,1,8);camera.lookAt(x,1,0);camera.updateMatrixWorld(true);scene.updateMatrixWorld(true);const f=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));return f.intersectsObject(api.particles);}
 try {
  api.updateParticles(.4,new THREE.Vector3());assert.ok(visibleAt(0));
  api.updateParticles(.4,new THREE.Vector3(100,0,0));assert.ok(visibleAt(100),'updated particles should enter the new frustum');assert.equal(visibleAt(0),false,'old frustum should no longer contain this emitter');
  const p=api.particleGeometry.attributes.position,s=api.particleGeometry.boundingSphere;
  for(let i=0;i<p.count;i++)assert.ok(s.center.distanceTo(new THREE.Vector3().fromBufferAttribute(p,i)) <= s.radius + 1e-12*Math.max(1,s.radius),'bounds cover current emitted vertices within floating-point roundoff');
 } finally {api.particleGeometry.dispose();api.particleMaterial.dispose();}
});

test('algorithm document road recipe emits upward real geometry and accepted lots',async()=>{
 const source=await readFile(new URL('../../references/algorithm-recipes.md',import.meta.url),'utf8');
 const blocks=[...source.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]);
 const code=blocks.find(b=>b.includes('const layout = compileCorridorGraph'))?.replace(/^import .*;\n/gm,'');assert.ok(code);
 const scene=new THREE.Scene(),api=vm.runInNewContext(`${code}\n;({layout,lots,roadGeometry})`,{THREE,scene,compileCorridorGraph,generateFrontageLots});
 assert.equal(api.layout.components.length,1);assert.ok(api.lots.length>0);assert.equal(scene.children.length,1);assert.equal(api.roadGeometry.index.count,6);
 for(let i=0;i<api.roadGeometry.attributes.normal.count;i++)assert.ok(api.roadGeometry.attributes.normal.getY(i)>.99);
 scene.children[0].geometry.dispose();scene.children[0].material.dispose();
});
test('algorithm document loft recipe changes an interior section without scaling endpoints',async()=>{
 const source=await readFile(new URL('../../references/algorithm-recipes.md',import.meta.url),'utf8');const code=[...source.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]).find(b=>b.includes('const geometry=createSectionLoftGeometry'))?.replace(/^import .*;\n/gm,'');assert.ok(code);
 const scene=new THREE.Scene(),api=vm.runInNewContext(`${code}\n;({geometry,mesh})`,{THREE,scene,createSectionLoftGeometry});assert.equal(api.mesh.geometry,api.geometry);assert.ok(api.geometry.index.count>0);assert.ok(api.geometry.attributes.position.count>4*25);
 assert.equal(api.mesh.scale.x,1);api.geometry.dispose();api.mesh.material.dispose();
});
test('algorithm document field recipe uses the same world derivatives as its mesh normals',async()=>{
 const source=await readFile(new URL('../../references/algorithm-recipes.md',import.meta.url),'utf8');const code=[...source.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]).find(b=>b.includes('const field=createFractalHeightField'))?.replace(/^import .*;\n/gm,'');assert.ok(code);
 const scene=new THREE.Scene(),api=vm.runInNewContext(`${code}\n;({field,groundGeometry,normal,slope})`,{THREE,scene,createFractalHeightField,createHeightFieldGeometry});assert.equal(api.field.config.baseFrequency,.06);assert.ok(Number.isFinite(api.slope));assert.ok(Math.abs(Math.hypot(...api.normal)-1)<1e-12);assert.ok(api.groundGeometry.boundingSphere.radius>30);api.groundGeometry.dispose();scene.children[0].material.dispose();
});
