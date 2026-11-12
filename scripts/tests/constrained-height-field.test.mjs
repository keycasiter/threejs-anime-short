import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
let api={};try{api=await import('../../assets/environment/constrained-height-field.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const base={sample(x,z){return {height:2+.1*x+.2*z,dx:.1,dz:.2};}};
function make(options={}){assert.equal(typeof api.createPlateauHeightField,'function');return api.createPlateauHeightField({field:base,bounds:[-4,-3,4,3],height:.5,falloff:6,...options});}
test('reserved surface is exact and transitions back to the same terrain source',()=>{
 const field=make();for(const [x,z]of [[0,0],[-4,1],[3,3],[-4,-3]])assert.deepEqual(field.sample(x,z),{height:.5,dx:0,dz:0});
 assert.deepEqual(field.sample(20,20),base.sample(20,20));assert.equal(field.heightAt(0,0),.5);assert.deepEqual(field.normalAt(0,0),[0,1,0]);
});
test('analytic transition slopes match numerical derivatives including rounded rectangle corners',()=>{
 const field=make(),h=1e-4;for(const [x,z]of [[4.01,0],[6,0],[7,5],[-5,-4],[10,3],[4,3]]){
  const s=field.sample(x,z);for(const [key,a,b]of [['dx',field.heightAt(x+h,z),field.heightAt(x-h,z)],['dz',field.heightAt(x,z+h),field.heightAt(x,z-h)]])assert.ok(Math.abs(s[key]-(a-b)/(2*h))<1e-5,`${x},${z} ${key}`);
 }
});
test('actual emitted mesh and placement queries share the reserved height and unit normals',async()=>{
 const {createHeightFieldGeometry}=await import('../../assets/environment/height-field.mjs');const field=make(),g=createHeightFieldGeometry(T,field,{sizeX:20,sizeZ:16,segmentsX:20,segmentsZ:16});
 const p=g.attributes.position,n=g.attributes.normal;
 for(let i=0;i<p.count;i++){assert.ok(Math.abs(p.getY(i)-field.heightAt(p.getX(i),p.getZ(i)))<1e-5);assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-6);}
 g.dispose();
});
test('invalid constraints and invalid source samples fail explicitly while input is detached',()=>{
 for(const patch of [{field:null},{bounds:[0,0,0,1]},{bounds:[0,1,2,0]},{bounds:[0,0,NaN,1]},{falloff:0},{height:Infinity}])assert.throws(()=>make(patch));
 const bounds=[-4,-3,4,3],field=make({bounds});bounds[2]=999;assert.equal(field.heightAt(10,0),base.sample(10,0).height);
 assert.throws(()=>field.sample(NaN,0));assert.throws(()=>make({field:{sample(){return {height:0,dx:NaN,dz:0};}}}).sample(5,0));
});
