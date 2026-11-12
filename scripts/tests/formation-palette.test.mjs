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
