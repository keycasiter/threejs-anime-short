import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCoordinateResponse} from '../../assets/materials/coordinate-response.mjs';

const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const shaderFor=material=>{
  const lib=material.isMeshToonMaterial?T.ShaderLib.toon:T.ShaderLib.physical;
  const shader={vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader,uniforms:T.UniformsUtils.clone(lib.uniforms)};
  material.onBeforeCompile(shader,undefined);
  return shader;
};
const meshFor=(material=new T.MeshStandardMaterial())=>{
  const geometry=new T.PlaneGeometry(2,8);
  const position=geometry.getAttribute('position'),attached=position.clone();
  for(let i=0;i<attached.count;i++)attached.setY(i,attached.getY(i)+4);
  geometry.setAttribute('aFormationPosition',attached);
  return {mesh:new T.Mesh(geometry,material),geometry,material};
};
const gradient={space:'attached',axis:'y',kind:'gradient',consumer:'base',range:[0,8],high:[1,0,0]};
const sweep={space:'world',axis:'y',kind:'band',consumer:'outgoing',width:4,feather:2,power:2,high:[1,1,0],motion:{start:20.5,velocity:3,epoch:5,period:4}};

test('attached bounded gradient reaches native base color before lighting and keeps stable uniforms',()=>{
  const {mesh,geometry,material}=meshFor(),response=createCoordinateResponse(T,mesh,gradient);
  try {
    mesh.material=response.material;
    const a=shaderFor(response.material),b=shaderFor(response.material);
    assert.ok(a.vertexShader.includes('cwPoint=aFormationPosition;'));
    assert.ok(a.fragmentShader.includes('clamp((cwS-cwLo)/cwSpan,0.0,1.0)'));
    const edit=a.fragmentShader.indexOf('diffuseColor.rgb*=mix(cwLow,cwHigh,cwMask);');
    assert.ok(edit>a.fragmentShader.indexOf('#include <color_fragment>'));
    assert.ok(edit<a.fragmentShader.indexOf('#include <lights_fragment_begin>'));
    assert.equal(a.uniforms.cwLo.value,0);assert.equal(a.uniforms.cwSpan.value,8);
    assert.equal(a.uniforms.cwHigh.value.x,1);assert.equal(a.uniforms.cwHigh.value.y,0);
    assert.equal(a.uniforms.cwHigh,b.uniforms.cwHigh,'recompiles reuse the same uniform objects');
    assert.equal(response.material.opacity,material.opacity);
  } finally {response.dispose();geometry.dispose();material.dispose();}
});

test('absolute-time bands support reverse seek, periodic endpoints, hidden-first assignment and radial world coordinates',()=>{
  const {mesh,geometry,material}=meshFor(),parent=new T.Group();parent.add(mesh);mesh.visible=false;
  const response=createCoordinateResponse(T,mesh,{...sweep,axis:'xyRadius'});
  try {
    const centers=[9,6,4,5,8,6].map(t=>response.seek(t));
    assert.deepEqual(centers,[20.5,23.5,29.5,20.5,29.5,23.5]);
    mesh.material=response.material;
    const shader=shaderFor(response.material);
    assert.ok(shader.vertexShader.includes('(modelMatrix * vec4(transformed,1.0)).xyz'));
    assert.ok(shader.fragmentShader.includes('float cwS=length(cwD.xy)'));
    assert.ok(shader.fragmentShader.indexOf('length(cwD.xy)')>shader.fragmentShader.indexOf('varying vec3 cwPoint;'));
    assert.equal(shader.uniforms.cwCenter.value,23.5);
    assert.equal(shader.uniforms.cwOffsets.value.length,1);
    assert.ok(response.material.customProgramCacheKey().includes('coordinate-response'));
    parent.position.set(5,-2,7);parent.rotation.z=Math.PI/2;parent.scale.set(2,3,1);
    response.validate();
    assert.throws(()=>response.seek(Infinity),/finite|seconds/i);
    assert.equal(shader.uniforms.cwCenter.value,23.5,'invalid time leaves last valid value intact');
  } finally {response.dispose();geometry.dispose();material.dispose();}
});

test('finite windows define full width, inner feather and max-union offsets without changing alpha',()=>{
  const {mesh,geometry,material}=meshFor(new T.MeshPhysicalMaterial({transparent:true,opacity:.375}));
  const response=createCoordinateResponse(T,mesh,{...sweep,offsets:[0,20,40,60]});
  try {
    const shader=shaderFor(response.material),fragment=shader.fragmentShader;
    assert.ok(fragment.includes('float d=abs(s-c);'));
    assert.ok(fragment.includes('if(d>=cwHalf)return 0.0;'));
    assert.ok(fragment.includes('1.0-pow(u,cwPow)'));
    assert.ok(fragment.includes('cwMask=max(cwMask,cwBand(cwS,cwCenter+cwOffsets[i]));'));
    assert.ok(fragment.indexOf('outgoingLight*=mix(cwLow,cwHigh,cwMask);')<fragment.indexOf('#include <opaque_fragment>'));
    assert.equal(response.material.opacity,.375);
    assert.equal(shader.uniforms.cwHalf.value,2);assert.equal(shader.uniforms.cwEdge.value,2);
    assert.deepEqual(Array.from(shader.uniforms.cwOffsets.value),[0,20,40,60]);
  } finally {response.dispose();geometry.dispose();material.dispose();}
});

test('unsupported domains and nonrepresentable float ranges are rejected before material ownership',()=>{
  const {mesh,geometry,material}=meshFor();
  const failures=[
    {...gradient,range:[1,1]},
    {...gradient,range:[1,1+1e-9]},
    {...gradient,width:1},
    {...gradient,axis:'xyRadius'},
    {...sweep,width:0},
    {...sweep,feather:3},
    {...sweep,power:0},
    {...sweep,offsets:[]},
    {...sweep,offsets:Array(33).fill(0)},
    {...sweep,motion:{...sweep.motion,period:0}},
    {...sweep,range:[0,1]},
    {...sweep,high:[1,Infinity,0]},
    {...sweep,unexpected:true}
  ];
  try {for(const options of failures)assert.throws(()=>createCoordinateResponse(T,mesh,options));}
  finally {geometry.dispose();material.dispose();}
});

test('method owns only its derived material and disposal is idempotent',()=>{
  const {mesh,geometry,material}=meshFor(),response=createCoordinateResponse(T,mesh,gradient);
  let derivedDisposed=0,baseDisposed=0;
  response.material.addEventListener('dispose',()=>derivedDisposed++);
  material.addEventListener('dispose',()=>baseDisposed++);
  response.dispose();response.dispose();
  assert.equal(derivedDisposed,1);assert.equal(baseDisposed,0);
  assert.throws(()=>response.validate(),/disposed/i);
  geometry.dispose();material.dispose();
});

test('geometry replacement invalidates the handoff instead of reusing stale coordinate bounds',()=>{
  const {mesh,geometry,material}=meshFor(),replacement=new T.BoxGeometry(1,1,1),response=createCoordinateResponse(T,mesh,sweep);
  try {mesh.geometry=replacement;assert.throws(()=>response.validate(),/geometry changed/i);}
  finally {response.dispose();mesh.geometry=geometry;replacement.dispose();geometry.dispose();material.dispose();}
});
