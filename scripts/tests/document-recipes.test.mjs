import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
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
