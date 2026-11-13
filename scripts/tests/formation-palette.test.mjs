import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createLookPalette} from '../../assets/materials/look-palette.mjs';
const T=await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href);
const loaded=await import('../../assets/materials/formation-palette.mjs').catch(()=>({}));
const make=(profiles={},extra={})=>loaded.createFormationPalette(T,{basePalette:{get:()=>base},profiles,...extra});
const base=new T.MeshStandardMaterial();
const mesh=()=>{const g=new T.BoxGeometry(1,1,1);g.setAttribute('aFormationPosition',g.attributes.position.clone());return new T.Mesh(g,base);};
test('formation palette API exists',()=>assert.equal(typeof loaded.createFormationPalette,'function'));
test('role/base identity, candidate validation and separate snapshots',()=>{
 const p=make({a:{pattern:'bands'},b:{pattern:'fibres'},plain:null});const a=p.get('a'),b=p.get('b');assert.equal(a,p.get('a'));assert.notEqual(a,b);
 const m=mesh(),g=m.geometry;const dto=p.validateMesh(m,[a,b,p.get('plain')]);assert.equal(dto.responses.length,2);assert.equal(dto.passthroughMaterialCount,1);assert.equal(dto.responses[0].vertexCount,24);assert.equal(m.material,base);assert.equal(m.geometry,g);
 dto.responses[0].domain.min[0]=99;const snap=p.inspect();snap.entries[0].response.parameters.wavelengths[0]=99;assert.equal(p.inspect().entries[0].response.parameters.wavelengths[0],.12);
 assert.throws(()=>p.validateMesh(m,new T.MeshStandardMaterial()));assert.throws(()=>p.validateMesh(m,[]));g.deleteAttribute('aFormationPosition');assert.throws(()=>p.validateMesh(m,a));p.dispose();assert.throws(()=>p.get('a'));assert.throws(()=>p.validateMesh(m,a));assert.equal(p.inspect().entries.length,0);
});
test('actual surface maps skip; environment and Toon ramp do not skip',()=>{
 for(const slot of ['map','normalMap','bumpMap','roughnessMap','metalnessMap','displacementMap','alphaMap','aoMap','lightMap','emissiveMap','clearcoatNormalMap']){const b=new T.MeshPhysicalMaterial();b[slot]=new T.Texture();const p=make({a:{}},{basePalette:{get:()=>b}});assert.equal(p.get('a'),b);assert.equal(p.validateMesh(mesh(),b).passthroughMaterialCount,1);p.dispose();}
 for(const b of [new T.MeshStandardMaterial({envMap:new T.Texture()}),new T.MeshToonMaterial({gradientMap:new T.Texture()})]){const p=make({a:{}},{basePalette:{get:()=>b}});assert.notEqual(p.get('a'),b);p.dispose();}
 const b=new T.MeshStandardMaterial({normalMap:new T.Texture()});const p=make({a:{}},{applyWhen:'all',basePalette:{get:()=>b}});assert.equal(p.get('a').normalMap,b.normalMap);p.dispose();
});
test('configuration validation and fixed-index snapshots precede use',()=>{
 for(const config of [{wat:1},{profiles:[]},{applyWhen:'maybe'},{profiles:{a:{wat:1}}},{profiles:{a:{parameters:{wat:1}}}},{profiles:Object.fromEntries(Array.from({length:33},(_,i)=>['r'+i,{}]))}])assert.throws(()=>loaded.createFormationPalette(T,{basePalette:{get:()=>base},...config}));
 let iter=0;const wavelengths=[.2,.3,.4];wavelengths[Symbol.iterator]=function*(){iter++;throw Error('iterator');};const frameMatrix=new T.Matrix4(),profile={parameters:{wavelengths,frameMatrix}};const p=make({a:profile});wavelengths[0]=9;frameMatrix.makeScale(3,3,3);profile.pattern='bad';p.get('a');assert.equal(iter,0);assert.deepEqual(p.inspect().entries[0].response.parameters.wavelengths,[.2,.3,.4]);p.dispose();
 const bad=make({a:{parameters:{wavelengths:[0,1,1]}}});assert.throws(()=>bad.get('a'));assert.equal(bad.inspect().entries.length,0);bad.dispose();
});
test('different base variants and delegated role/options rejection',()=>{
 const variants=[new T.MeshStandardMaterial(),new T.MeshStandardMaterial()];let calls=0;const p=make({a:{}},{basePalette:{get(role,o){calls++;if(role!=='a'||o.bad)throw Error('base rejection');return variants[o.variant??0];}}});assert.notEqual(p.get('a'),p.get('a',{variant:1}));assert.throws(()=>p.get('unknown'));assert.throws(()=>p.get('a',{bad:true}));assert.equal(calls,4);p.dispose();
});
test('release continuation, borrowing and disposed indexes',()=>{
 let borrowed=0,released=0;const tex=new T.Texture(),b=new T.MeshStandardMaterial({envMap:tex});b.addEventListener('dispose',()=>borrowed++);tex.addEventListener('dispose',()=>borrowed++);const p=make({a:{},b:{}},{basePalette:{get:()=>b,dispose(){borrowed++;}}});p.get('a').addEventListener('dispose',()=>{released++;throw Error('release failure');});p.get('b').addEventListener('dispose',()=>released++);assert.throws(()=>p.dispose(),AggregateError);assert.equal(released,2);assert.equal(borrowed,0);assert.equal(p.inspect().disposed,true);assert.equal(p.inspect().entries.length,0);p.dispose();
});
test('real LookPalette PBR/Toon compatibility and upstream identity',()=>{
 for(const mode of ['pbr','toon']){const bp=createLookPalette(T,{mode,resolution:64});const p=loaded.createFormationPalette(T,{basePalette:bp,profiles:{stone:{},metal:{},wood:{parameters:{roughnessAmplitude:.1}}}});assert.notEqual(p.get('stone',{maps:false}),bp.get('stone',{maps:false}));assert.equal(p.get('metal',{maps:false}).type,'MeshStandardMaterial');if(mode==='toon')assert.throws(()=>p.get('wood',{maps:false}));p.dispose();bp.dispose();}
 const b=new T.MeshStandardMaterial();let calls=0;b.onBeforeCompile=()=>calls++;const p=make({a:{upstreamProgramKey:'upstream/v1'}},{basePalette:{get:()=>b}});const m=p.get('a');m.onBeforeCompile({vertexShader:T.ShaderLib.physical.vertexShader,fragmentShader:T.ShaderLib.physical.fragmentShader,uniforms:{}},{});assert.equal(calls,1);p.dispose();
});

test('actual world domain rejection leaves candidate binding unchanged',()=>{
 const p=make({a:{space:'world',parameters:{wavelengths:[1,1,1]}}});const m=mesh(),a=p.get('a'),prior=m.material;m.position.x=9000;m.updateMatrixWorld(true);assert.throws(()=>p.validateMesh(m,a));assert.equal(m.material,prior);p.dispose();
});

test('exact documented ESM binds every triangle to an existing semantic candidate',()=>{
 const method=readFileSync(new URL('../../references/formation-palette.md',import.meta.url),'utf8').split('```js\n')[1].split('```')[0];
 const check=`
 assert.equal(geometry.index.count,36);
 const coverage=new Array(geometry.index.count).fill(0);
 for(const group of geometry.groups){
   assert.ok(mesh.material[group.materialIndex]?.isMaterial,'rendered group requires existing candidate');
   for(let i=group.start;i<group.start+group.count;i++)coverage[i]++;
 }
 assert.ok(coverage.every(count=>count===1),'all triangles retained exactly once');
 `;
 const result=spawnSync(process.execPath,['--input-type=module'],{input:method.replace('mesh.material=candidates;', `const record=palette.inspect().entries.find(entry=>entry.role==='wood').response.parameters;
   const axis=new T.Vector3(1,0,0).transformDirection(new T.Matrix4().fromArray(record.frameMatrix));
   assert.ok(axis.distanceTo(new T.Vector3(0,0,1))<1e-12,'member X must become fibre Z');mesh.material=candidates;`)+check,encoding:'utf8',cwd:fileURLToPath(new URL('../..',import.meta.url)),env:process.env});
 assert.equal(result.status,0,result.stderr||String(result.error));
});

test('explicit recipes partition one base while default and undefined retain role identity',()=>{
 const b=new T.MeshStandardMaterial(),options={maps:false},calls=[];
 const p=make({wood:{pattern:'fibres'},'dressed-stock':{pattern:'fibres',parameters:{wavelengths:[.034,.12,.12],roughnessAmplitude:.1}}},{basePalette:{get(...args){calls.push(args);return b;}}});
 try{
  const original=p.get('wood',options),dressed=p.get('wood',options,'dressed-stock');
  assert.notEqual(dressed,original);assert.notEqual(dressed,b);
  assert.equal(p.get('wood',options,'dressed-stock'),dressed);
  assert.equal(p.get('wood',options),original);assert.equal(p.get('wood',options,undefined),original);assert.equal(p.get('wood',options,'wood'),original);
  const trim=p.get('trim',options,'dressed-stock');assert.notEqual(trim,dressed);
  assert.equal(p.get('unknown',options),b);assert.equal(p.get('unknown',options,undefined),b);
  assert.ok(calls.every(args=>args.length===2&&args[1]===options));
  const entries=p.inspect().entries;
  assert.deepEqual(entries.map(({role,profileKey,baseMaterialUuid,materialUuid,passthrough})=>({role,profileKey,baseMaterialUuid,materialUuid,passthrough})),[
   {role:'wood',profileKey:'wood',baseMaterialUuid:b.uuid,materialUuid:original.uuid,passthrough:false},
   {role:'wood',profileKey:'dressed-stock',baseMaterialUuid:b.uuid,materialUuid:dressed.uuid,passthrough:false},
   {role:'trim',profileKey:'dressed-stock',baseMaterialUuid:b.uuid,materialUuid:trim.uuid,passthrough:false},
   {role:'unknown',profileKey:'unknown',baseMaterialUuid:b.uuid,materialUuid:b.uuid,passthrough:true}
  ]);
  entries[0].profileKey='changed';assert.equal(p.inspect().entries[0].profileKey,'wood');
  const m=mesh();try{assert.equal(p.validateMesh(m,[original,dressed]).responses.length,2);}finally{m.geometry.dispose();}
 }finally{p.dispose();b.dispose();}
});

test('numeric recipe differences keep native uniforms and the same structural program key',()=>{
 const p=make({wood:{pattern:'fibres'},'dressed-stock':{pattern:'fibres',parameters:{wavelengths:[.034,.12,.12],roughnessAmplitude:.1,warp:.18}}});
 try{
  const a=p.get('wood'),b=p.get('wood',{},'dressed-stock');assert.notEqual(a,b);
  assert.equal(a.customProgramCacheKey(),b.customProgramCacheKey());assert.deepEqual(a.defines,b.defines);
  const compile=material=>{const shader={vertexShader:T.ShaderLib.physical.vertexShader,fragmentShader:T.ShaderLib.physical.fragmentShader,uniforms:{}};material.onBeforeCompile(shader,{});return shader;};
  const sa=compile(a),sb=compile(b);assert.equal(sa.vertexShader,sb.vertexShader);assert.equal(sa.fragmentShader,sb.fragmentShader);
  assert.deepEqual(sa.uniforms.frWavelengths.value.toArray(),[.12,.12,.12]);assert.deepEqual(sb.uniforms.frWavelengths.value.toArray(),[.034,.12,.12]);
  assert.equal(sa.uniforms.frRoughness.value,.15);assert.equal(sb.uniforms.frRoughness.value,.1);assert.equal(sb.uniforms.frWarp.value,.18);
  assert.notEqual(sa.uniforms.frWavelengths,sb.uniforms.frWavelengths);
 }finally{p.dispose();}
});

test('explicit profile keys require exact registered names and reject malformed keys without cache pollution',()=>{
 const long='x'.repeat(128),p=make({wood:{},plain:null,x:{},[long]:{},'__proto__':null});
 try{
  const prior=p.get('wood'),before=p.inspect();
  for(const key of [null,'',' ','x'.repeat(129),0,false,{},[],Symbol('wood'),'missing',' wood ','toString','__proto__'])assert.throws(()=>p.get('wood',{},key),/profile/i);
  assert.deepEqual(p.inspect(),before);assert.equal(p.get('wood'),prior);assert.notEqual(p.get('wood',{},long),prior);assert.notEqual(p.get('wood',{},'x'),prior);
 }finally{p.dispose();}
 const profiles=Object.create(null);profiles.__proto__={};const q=make(profiles);try{assert.notEqual(q.get('wood',{},'__proto__'),base);}finally{q.dispose();}
});

test('base variants remain distinct and UUID collisions cannot hide behind another profile',()=>{
 const first=new T.MeshStandardMaterial(),second=new T.MeshStandardMaterial();let current=first;
 const p=make({wood:{},alternate:{parameters:{warp:.1}}},{basePalette:{get:()=>current}});
 try{
  const a=p.get('wood'),b=p.get('wood',{},'alternate');assert.notEqual(a,b);
  current=second;const secondMaterial=p.get('wood',{},'alternate');assert.notEqual(secondMaterial,b);
  second.uuid=first.uuid;const before=p.inspect();
  assert.throws(()=>p.get('wood'),/uuid collision/i);assert.throws(()=>p.get('wood',{},'alternate'),/uuid collision/i);
  assert.throws(()=>p.get('trim',{},'alternate'),/uuid collision/i);assert.throws(()=>p.get('unknown'),/uuid collision/i);assert.deepEqual(p.inspect(),before);
  current=first;assert.equal(p.get('wood'),a);assert.equal(p.get('wood',{},'alternate'),b);
 }finally{p.dispose();first.dispose();second.dispose();}
});

test('registered null and mapped recipes share borrowed passthrough qualification',()=>{
 const texture=new T.Texture(),b=new T.MeshStandardMaterial({map:texture});let borrowed=0;
 b.addEventListener('dispose',()=>borrowed++);texture.addEventListener('dispose',()=>borrowed++);
 const profiles={wood:{},alternate:{parameters:{warp:.1}},plain:null};const p=make(profiles,{basePalette:{get:()=>b,dispose(){borrowed++;}}});
 const m=mesh();
 try{
  for(const key of ['wood','alternate','plain'])assert.equal(p.get('wood',{},key),b);
  assert.equal(p.get('unknown'),b);assert.deepEqual(p.validateMesh(m,[b,b]),{responses:[],passthroughMaterialCount:2});
  assert.deepEqual(p.inspect().entries.map(entry=>[entry.role,entry.profileKey,entry.passthrough]),[['wood','wood',true],['wood','alternate',true],['wood','plain',true],['unknown','unknown',true]]);
 }finally{p.dispose();m.geometry.dispose();}
 assert.equal(borrowed,0);
 const all=make(profiles,{applyWhen:'all',basePalette:{get:()=>b}});try{assert.equal(all.get('wood',{},'plain'),b);const a=all.get('wood'),c=all.get('wood',{},'alternate');assert.notEqual(a,c);assert.equal(a.map,texture);assert.equal(c.map,texture);}finally{all.dispose();}
 assert.equal(borrowed,0);b.dispose();texture.dispose();
});

test('failed explicit Toon and numeric recipes preserve prior derived entries and candidate binding',()=>{
 for(const mode of ['pbr','toon']){
  const bp=createLookPalette(T,{mode,resolution:64}),p=loaded.createFormationPalette(T,{basePalette:bp,profiles:{wood:{},badNumber:{parameters:{wavelengths:[0,1,1]}},badToon:{parameters:{roughnessAmplitude:.1}}}});
  const m=mesh();
  try{
   const a=p.get('wood',{maps:false}),before=p.inspect(),prior=m.material;
   assert.throws(()=>p.get('wood',{maps:false},'badNumber'),/wavelengths/i);
   if(mode==='toon')assert.throws(()=>p.get('wood',{maps:false},'badToon'),/roughness/i);
   assert.deepEqual(p.inspect(),before);assert.equal(p.get('wood',{maps:false}),a);assert.equal(m.material,prior);assert.equal(p.validateMesh(m,a).responses.length,1);
  }finally{p.dispose();bp.dispose();m.geometry.dispose();}
 }
});

test('failed partial copy is released once and retry does not poison a live profile cache',()=>{
 const texture=new T.Texture(),b=new T.MeshStandardMaterial({envMap:texture});let allocations=0,releases=0,borrowed=0;
 const tracked={...T,MeshStandardMaterial:new Proxy(T.MeshStandardMaterial,{construct(C,args){allocations++;const material=Reflect.construct(C,args);material.addEventListener('dispose',()=>releases++);return material;}})};
 b.addEventListener('dispose',()=>borrowed++);texture.addEventListener('dispose',()=>borrowed++);
 const p=loaded.createFormationPalette(tracked,{basePalette:{get:()=>b},profiles:{wood:{},alternate:{parameters:{warp:.1}}}});
 try{
  const a=p.get('wood'),before=p.inspect();b.userData.self=b.userData;
  assert.throws(()=>p.get('wood',{},'alternate'),/circular/i);assert.deepEqual([allocations,releases,borrowed],[2,1,0]);assert.deepEqual(p.inspect(),before);assert.equal(p.get('wood'),a);
  delete b.userData.self;const c=p.get('wood',{},'alternate');assert.notEqual(c,a);assert.equal(p.get('wood',{},'alternate'),c);assert.deepEqual([allocations,releases,borrowed],[3,1,0]);
 }finally{delete b.userData.self;p.dispose();}
 assert.deepEqual([allocations,releases,borrowed],[3,3,0]);p.dispose();assert.equal(releases,3);b.dispose();texture.dispose();
});

test('explicit responses release independently through errors and reload with fresh owned identities',()=>{
 const texture=new T.Texture(),b=new T.MeshStandardMaterial({envMap:texture}),profiles={wood:{},alternate:{parameters:{warp:.1}},plain:null};let owned=0,borrowed=0;
 b.addEventListener('dispose',()=>borrowed++);texture.addEventListener('dispose',()=>borrowed++);
 const p=make(profiles,{basePalette:{get:()=>b}}),a=p.get('wood'),c=p.get('wood',{},'alternate');p.get('wood',{},'plain');
 assert.notEqual(a,c);a.addEventListener('dispose',()=>{owned++;throw Error('release failure');});c.addEventListener('dispose',()=>owned++);
 assert.throws(()=>p.dispose(),AggregateError);assert.deepEqual([owned,borrowed],[2,0]);assert.deepEqual(p.inspect().entries,[]);assert.deepEqual(p.inspect().profiles,[]);assert.throws(()=>p.get('wood',{},'alternate'),/disposed/i);assert.throws(()=>p.validateMesh(null,c),/disposed/i);p.dispose();assert.equal(owned,2);
 const q=make(profiles,{basePalette:{get:()=>b}});try{const d=q.get('wood',{},'alternate');assert.notEqual(d,c);assert.notEqual(d,b);assert.equal(q.get('wood',{},'alternate'),d);}finally{q.dispose();}
 assert.equal(borrowed,0);b.dispose();texture.dispose();
});


test('a failed first recipe does not reserve its borrowed UUID or replace a live material',()=>{
 const live=new T.MeshStandardMaterial(),failed=new T.MeshStandardMaterial(),replacement=new T.MeshStandardMaterial();replacement.uuid=failed.uuid;let current=live;
 const p=make({wood:{},invalid:{parameters:{wavelengths:[0,1,1]}}},{basePalette:{get:()=>current}}),m=mesh();
 try{
  const a=p.get('wood'),before=p.inspect();m.material=a;current=failed;
  assert.throws(()=>p.get('wood',{},'invalid'),/wavelengths/i);assert.deepEqual(p.inspect(),before);assert.equal(m.material,a);
  current=replacement;const c=p.get('wood');assert.notEqual(c,a);assert.equal(p.get('wood'),c);assert.equal(p.validateMesh(m,a).responses.length,1);
  current=live;assert.equal(p.get('wood'),a);
 }finally{p.dispose();m.geometry.dispose();live.dispose();failed.dispose();replacement.dispose();}
});
