import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createRegionMaterial} from '../../assets/materials/surface-fields.mjs';
const THREE = process.env.THREE_MODULE ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href) : await import('three');

test('two authored regions share boundaries across color, roughness and metalness and are connected to the material',()=>{
  let calls=0;const color = new THREE.Color(.25,.5,.75);
  const result=createRegionMaterial(THREE,{width:4,height:2,physicalSize:[2,1],regionAt:p=>{calls++;return {color:p.u<.5?color:new THREE.Color(1,0,0),roughness:p.u<.5?.8:.2,metalness:p.u<.5?0:1,height:0};}});
  assert.equal(calls,8,'one authored sample per texel');
  const {material, maps}=result;
  assert.equal(material.map,maps.map);assert.equal(material.normalMap,maps.normalMap);
  assert.equal(material.roughnessMap,maps.roughnessMap);assert.equal(material.metalnessMap,maps.metalnessMap);
  assert.deepEqual([material.color.r,material.color.g,material.color.b,material.roughness,material.metalness],[1,1,1,1,1]);
  assert.deepEqual([...maps.roughnessMap.image.data.filter((_,i)=>i%4===1)],[204,204,51,51,204,204,51,51]);
  assert.deepEqual([...maps.metalnessMap.image.data.filter((_,i)=>i%4===2)],[0,0,255,255,0,0,255,255]);
  // Known IEC sRGB encoding of linear .25/.5/.75, within one 8-bit quantization.
  const expected=[137,188,225,255];expected.forEach((n,i)=>assert.ok(Math.abs(maps.map.image.data[i]-n)<=1));
  assert.deepEqual(color.toArray(),[.25,.5,.75],'caller colors remain linear/unmodified');
  assert.equal(maps.map.colorSpace,THREE.SRGBColorSpace);
  for (const m of [maps.normalMap,maps.roughnessMap,maps.metalnessMap]) assert.equal(m.colorSpace,THREE.NoColorSpace);
  result.dispose();
});

test('physical height ramp gives the expected tangent normal independently of color and shared texture settings survive',()=>{
  const r=createRegionMaterial(THREE,{width:4,height:4,physicalSize:[2,1],wrapU:'clamp',wrapV:'repeat',regionAt:p=>({color:new THREE.Color(1,1,1),roughness:1,metalness:0,height:.1*p.x})});
  const n=r.maps.normalMap.image.data;
  for(let i=0;i<n.length;i+=4){assert.ok(Math.abs((n[i]/255*2-1)-(-.1/Math.sqrt(1.01)))<.009);assert.ok(Math.abs(n[i+1]/255*2-1)<.009);}
  for(const m of Object.values(r.maps)){assert.equal(m.wrapS,THREE.ClampToEdgeWrapping);assert.equal(m.wrapT,THREE.RepeatWrapping);assert.equal(m.flipY,false);assert.equal(m.generateMipmaps,true);}
  let releases=0;for(const m of Object.values(r.maps))m.addEventListener('dispose',()=>releases++);
  r.dispose();r.dispose();assert.equal(releases,4);
});

test('scratch Color or entire region object can be reused without overwriting earlier texels',()=>{
  for(const reuseObject of [false,true]){
    const color=new THREE.Color(), scratch={color,height:0,roughness:0,metalness:0};
    const r=createRegionMaterial(THREE,{width:4,height:2,regionAt:p=>{
      color.setRGB(p.u<.5?1:0,0,p.u<.5?0:1);
      Object.assign(scratch,{roughness:p.u<.5?.8:.2,metalness:p.u<.5?0:1});
      return reuseObject?scratch:{...scratch};
    }});
    const c=r.maps.map.image.data,m=r.maps.metalnessMap.image.data;
    assert.deepEqual([...c.slice(0,4)],[255,0,0,255]);
    assert.deepEqual([...c.slice(12,16)],[0,0,255,255]);
    assert.equal(m[2],0);assert.equal(m[14],255);
    r.dispose();
  }
});

test('malformed scalar/color regions fail rather than baking silent invalid PBR data',()=>{
  const base={color:new THREE.Color(1,1,1),roughness:.5,metalness:0,height:0};
  for(const change of [{metalness:2},{color:new THREE.Color(-1,0,0)},{height:NaN},{roughness:-1}]){
    assert.throws(()=>createRegionMaterial(THREE,{width:2,height:2,regionAt:()=>({...base,...change})}));
  }
});
