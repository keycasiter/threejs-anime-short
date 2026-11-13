import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const {createScreenCoordinateProbe}=await import('../../assets/rendering/screen-coordinate-probe.mjs');

test('diagnostic shader encodes viewport-local window pixels from the actual rectangle',()=>{
  const viewport=[8,6,32,24],material=createScreenCoordinateProbe(T,{viewportPixels:viewport});
  assert.equal(material.isRawShaderMaterial,true);assert.equal(material.glslVersion,T.GLSL3);
  assert.deepEqual(material.uniforms.uViewportPixels.value.toArray(),viewport);
  assert.match(material.fragmentShader,/gl_FragCoord\.xy\s*-\s*uViewportPixels\.xy/);
  assert.match(material.fragmentShader,/localPixels\s*\/\s*uViewportPixels\.zw/);
  assert.equal(material.toneMapped,false);assert.equal(material.depthTest,false);assert.equal(material.depthWrite,false);
  let disposed=0;material.addEventListener('dispose',()=>disposed++);material.dispose();assert.equal(disposed,1);
});

test('diagnostic shader rejects malformed rectangles and non-r187 Three namespaces',()=>{
  for(const viewportPixels of [undefined,[0,0,0,10],[0,0,10,-1],[0,0,Infinity,10],[0,0,10],{x:0,y:0,z:10,w:10}])
    assert.throws(()=>createScreenCoordinateProbe(T,{viewportPixels}),/viewportPixels/);
  assert.throws(()=>createScreenCoordinateProbe({...T,REVISION:'186'},{viewportPixels:[0,0,1,1]}),/r187/);
});
