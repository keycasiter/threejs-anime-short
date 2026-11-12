import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T=await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href);
const loaded=await import('../../assets/materials/formation-response.mjs').catch(()=>({}));
const make=(extra={})=>loaded.createFormationResponse(T,{baseMaterial:new T.MeshStandardMaterial(),...extra});
test('formation response API exists',()=>assert.equal(typeof loaded.createFormationResponse,'function'));
for(const C of [T.MeshStandardMaterial,T.MeshPhysicalMaterial,T.MeshToonMaterial]) test(C.name+' actual shader, ownership and stable atomic uniforms',()=>{
 const texture=new T.Texture(),base=new C({normalMap:texture,opacity:.4});const r=make({baseMaterial:base});
 assert.equal(r.material.normalMap,texture);assert.equal(r.material.opacity,.4);
 const lib=T.ShaderLib[C===T.MeshToonMaterial?'toon':'physical'];const s={vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader,uniforms:T.UniformsUtils.clone(lib.uniforms)};
 r.material.onBeforeCompile(s,{});const key=r.material.customProgramCacheKey(),u=s.uniforms.frWavelengths,v=u.value;
 r.setParameters({wavelengths:[.2,.3,.4],seed:42});assert.equal(s.uniforms.frWavelengths,u);assert.equal(u.value,v);assert.deepEqual(v.toArray(),[.2,.3,.4]);assert.equal(r.material.customProgramCacheKey(),key);
 const before=r.inspect();assert.throws(()=>r.setParameters({heightAmplitude:.002,wavelengths:[0,1,1]}));assert.deepEqual(r.inspect(),before);
 assert.throws(()=>r.setParameters({wat:2}));assert.throws(()=>r.setParameters({frameMatrix:new T.Matrix4().makeScale(2,1,1)}));
 if(C===T.MeshToonMaterial)assert.throws(()=>r.setParameters({roughnessAmplitude:.1}));
 assert.ok(s.fragmentShader.indexOf('frBaseNormal = normal')<s.fragmentShader.indexOf('#include <normal_fragment_maps>'));
 assert.ok(s.fragmentShader.includes('diffuseColor.rgb *= mix'));assert.ok(s.fragmentShader.includes('frExistingGradient'));
 const dto=r.inspect();dto.parameters.wavelengths[0]=900;assert.equal(r.inspect().parameters.wavelengths[0],.2);
 let own=0,borrow=0;r.material.addEventListener('dispose',()=>own++);base.addEventListener('dispose',()=>borrow++);texture.addEventListener('dispose',()=>borrow++);r.dispose();r.dispose();assert.equal(own,1);assert.equal(borrow,0);assert.throws(()=>r.setParameters({seed:1}));
});
test('actual Mesh attached/world domain, deformation rejection and source preservation',()=>{
 const g=new T.BoxGeometry(1,1,1);g.setAttribute('aFormationPosition',g.attributes.position.clone());const mesh=new T.Mesh(g,new T.MeshStandardMaterial());const parent=new T.Group();parent.scale.set(2,3,4);parent.position.set(10,0,0);parent.add(mesh);parent.updateMatrixWorld(true);
 const a=make({parameters:{wavelengths:[1,1,1]}}),w=make({space:'world',parameters:{wavelengths:[1,1,1]}});const uuid=g.uuid,material=mesh.material;
 assert.deepEqual(a.validateMesh(mesh).domain.min,[-.5,-.5,-.5]);assert.deepEqual(w.validateMesh(mesh).domain.max,[11,1.5,2]);assert.equal(g.uuid,uuid);assert.equal(mesh.material,material);
 g.deleteAttribute('aFormationPosition');assert.throws(()=>a.validateMesh(mesh));assert.doesNotThrow(()=>w.validateMesh(mesh));parent.position.x=9000;parent.updateMatrixWorld(true);assert.throws(()=>w.validateMesh(mesh));assert.throws(()=>w.validateMesh(new T.InstancedMesh(g,material,2)));
 parent.position.x=0;parent.updateMatrixWorld(true);g.morphAttributes.position=[g.attributes.position.clone()];assert.throws(()=>w.validateMesh(mesh));
});
test('structure identity, input snapshots and upstream hooks',()=>{
 const keys=new Set();for(const pattern of ['bands','fibres','aggregate'])for(const space of ['attached','world'])keys.add(make({pattern,space}).material.customProgramCacheKey());assert.equal(keys.size,6);
 let reads=0;const r=make({parameters:{get seed(){reads++;return 1;}}});assert.equal(reads,1);r.setParameters({get seed(){reads++;return 2;}});assert.equal(reads,2);
 const base=new T.MeshStandardMaterial();let called=0;base.onBeforeCompile=()=>called++;assert.throws(()=>make({baseMaterial:base}));const b=make({baseMaterial:base,upstreamProgramKey:'test'});const lib=T.ShaderLib.physical;b.material.onBeforeCompile({vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader,uniforms:{}},{});assert.equal(called,1);
});
test('invalid geometry, budgets, finite values, rigid frame and bounds are enforced before mutation',()=>{
 const r=make(),g=new T.BufferGeometry(),mesh=new T.Mesh(g,new T.MeshStandardMaterial());
 const p=new T.BufferAttribute(new Float32Array([0,0,0]),3);g.setAttribute('position',p);g.setAttribute('aFormationPosition',p.clone());
 assert.equal(r.validateMesh(mesh).vertexCount,1);
 for(const patch of [{seed:-1},{seed:2**32},{heightAmplitude:.021},{colorHigh:[1,2,3]},{wavelengths:new Float32Array([1,1,1])},{frameMatrix:new T.Matrix4().makeScale(-1,1,1)}])assert.throws(()=>r.setParameters(patch));
 p.count=1048577;assert.throws(()=>r.validateMesh(mesh));p.count=1;p.setX(0,NaN);assert.throws(()=>r.validateMesh(mesh));p.setX(0,0);
 const a=g.attributes.aFormationPosition;a.setX(0,NaN);assert.throws(()=>r.validateMesh(mesh));a.setX(0,0);mesh.matrixWorld.makeScale(0,1,1);assert.throws(()=>r.validateMesh(mesh));mesh.matrixWorld.identity();
 g.setAttribute('aFormationPosition',new T.BufferAttribute(new Float32Array(6),3));assert.throws(()=>r.validateMesh(mesh));
});
test('native two-sided height orientation preserves the common two-axis metric',()=>{
 const r=make(),lib=T.ShaderLib.physical,s={vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader,uniforms:{}};r.material.onBeforeCompile(s,{});
 // Evaluate the actual emitted scalar divisor, not a duplicate corrected formula.
 // Vector arithmetic here models planar derivatives; root renderer tests are the GPU proof.
 const expr=s.fragmentShader.match(/vec3 frHeightGradient=\([^;]+\)\/([^;]+);/)[1];
 const divisor=new Function('frDet','faceDirection','return '+expr);
 for(const scale of [[1,1],[2,3]]){
  function sample(face){const n=new T.Vector3(0,0,face),common=Math.max(...scale),x=new T.Vector3(scale[0]/common,0,0),y=new T.Vector3(0,scale[1]/common,0),rx=new T.Vector3().crossVectors(y,n),ry=new T.Vector3().crossVectors(n,x),det=x.dot(rx);
   const gradient=rx.multiplyScalar(.1*scale[0]/common).add(ry.multiplyScalar(.07*scale[1]/common)).divideScalar(divisor(det,face));return n.sub(gradient).normalize();}
  const front=sample(1),back=sample(-1);assert.ok(front.x<0&&front.y<0);assert.ok(back.distanceTo(front.clone().negate())<1e-12);
  assert.ok(front.distanceTo(new T.Vector3(-.1,-.07,1).normalize())<1e-12);
 }
});
test('xyz snapshots ignore iterators, read each component once and reject invalid setters atomically',()=>{
 const r=make();
 for(const key of ['wavelengths','colorLow','colorHigh']){
  let iterations=0;const reads=[0,0,0],a=[.2,.3,.4];for(let i=0;i<3;i++)Object.defineProperty(a,i,{get(){reads[i]++;return [.2,.3,.4][i];}});
  a[Symbol.iterator]=function*(){iterations++;yield .2;yield .3;yield .4;yield 999;};
  r.setParameters({[key]:a});assert.equal(iterations,0);assert.deepEqual(reads,[1,1,1]);assert.deepEqual(r.inspect().parameters[key],[.2,.3,.4]);
  const before=r.inspect(),invalid=[.1,NaN,.3];invalid[Symbol.iterator]=function*(){yield .1;yield .2;yield .3;};
  assert.throws(()=>r.setParameters({heightAmplitude:.002,[key]:invalid}));assert.deepEqual(r.inspect(),before);
 }
 const a=[.1,.2,.3];a[Symbol.iterator]=()=>{throw new Error('iterator must never run');};assert.doesNotThrow(()=>make({parameters:{wavelengths:a,colorLow:a,colorHigh:a}}));
});
test('direct factory and setters reject all unknown own keys without partial writes',()=>{
 const r=make(),before=r.inspect();
 for(const key of ['typo',Symbol('unknown')]){
  const bad=Object.defineProperty({seed:23},key,{value:1});assert.throws(()=>r.setParameters(bad),/unknown/i);assert.deepEqual(r.inspect(),before);
  const options=Object.defineProperty({baseMaterial:new T.MeshStandardMaterial()},key,{value:true});assert.throws(()=>loaded.createFormationResponse(T,options),/unknown/i);
 }assert.throws(()=>make({paramaters:{warp:0}}),/unknown/i);r.dispose();
});
test('derivatives sample only unfiltered position inputs',()=>{
 const s={...T.ShaderLib.physical,uniforms:{}};make().material.onBeforeCompile(s,{});
 const operands=[...s.fragmentShader.matchAll(/\b(dFdx|dFdy|fwidth)\(([^()]*)\)/g)].map(m=>m[1]+':'+m[2]).sort();
 assert.deepEqual(operands,['dFdx:-vViewPosition','dFdx:frQ','dFdy:-vViewPosition','dFdy:frQ']);
});
