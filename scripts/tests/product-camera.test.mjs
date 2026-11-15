import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildProductCamera} from '../../assets/examples/product-camera.mjs';

const threeUrl=process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three';
const T=await import(threeUrl);
const materials=()=>({
  shell:new T.MeshPhysicalMaterial({color:'#222a2b',metalness:.72,roughness:.27,clearcoat:.6}),
  trim:new T.MeshStandardMaterial({color:'#9f8150',metalness:.83,roughness:.24}),
  rubber:new T.MeshStandardMaterial({color:'#101313',roughness:.78}),
  glass:new T.MeshPhysicalMaterial({color:'#7aabb2',metalness:.18,roughness:.08,clearcoat:1}),
  screen:new T.MeshPhysicalMaterial({color:'#294248',metalness:.12,roughness:.22,emissive:'#07191d',emissiveIntensity:.6}),
  marking:new T.MeshStandardMaterial({color:'#dfd7bf',metalness:.18,roughness:.42}),
  dark:new T.MeshStandardMaterial({color:'#070b0c',metalness:.15,roughness:.2})
});

test('product camera is a detailed closed assembly with real focus state and explicit geometry ownership',()=>{
  const camera=buildProductCamera(T,{materials:materials()});
  assert.equal(camera.root.isGroup,true);
  for(const key of ['body','topPlate','lensBarrel','frontGlass','focusRing','display','shutter'])assert.ok(camera.parts[key],`missing part ${key}`);
  let meshes=0,instanced=0;camera.root.traverse(o=>{if(o.isMesh)meshes++;if(o.isInstancedMesh)instanced+=o.count;});
  assert.ok(meshes>=30,`only ${meshes} meshes`);
  assert.ok(instanced>=48,`only ${instanced} repeated knurl elements`);
  camera.root.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(camera.root),size=bounds.getSize(new T.Vector3());
  assert.ok(size.x>.14&&size.x<.18,`body width ${size.x}`);
  assert.ok(size.y>.09&&size.y<.14,`body height ${size.y}`);
  assert.ok(size.z>.07&&size.z<.13,`body depth ${size.z}`);
  const z0=camera.parts.lensBarrel.position.z;
  camera.setFocus(.8);
  assert.ok(camera.parts.lensBarrel.position.z>z0);
  assert.equal(camera.readState().focus,.8);
  assert.throws(()=>camera.setFocus(1.1),RangeError);
  let disposed=0;camera.root.traverse(o=>o.geometry?.addEventListener('dispose',()=>disposed++));
  camera.dispose();camera.dispose();
  assert.ok(disposed>0,'owned geometry was not disposed');
  assert.throws(()=>camera.setFocus(.2),/disposed/);
});
