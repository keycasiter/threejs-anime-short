import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {compileCorridorGraph} from '../../assets/scene/corridor-layout.mjs';
import {createHeightFieldGeometry} from '../../assets/environment/height-field.mjs';
import {createRandomStreams} from '../../assets/runtime/random-streams.mjs';
import {probeParameter,probeRigidMotion} from '../../assets/runtime/scene-probes.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
async function recipe(name,file='code-guidance.md'){let text='';try{text=await readFile(new URL('../../references/'+file,import.meta.url),'utf8')}catch(e){if(e.code!=='ENOENT')throw e;}const block=[...text.matchAll(/```js\n([\s\S]*?)```/g)].map(x=>x[1]).find(x=>x.includes(`function ${name}(`));assert.ok(block,`complete executable recipe ${name} must exist`);return vm.runInNewContext(`${block};${name}`);}
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
test('guide corridor recipe emits upward road triangles at actual shared graph coordinates',async()=>{
 const build=await recipe('buildCorridorSurface'),graph=compileCorridorGraph({nodes:[{id:'a',x:-4,z:0},{id:'b',x:4,z:0},{id:'c',x:4,z:7}],edges:[{id:'ab',from:'a',to:'b',width:2},{id:'bc',from:'b',to:'c',width:1.5}]}),material=new T.MeshBasicMaterial(),r=build(T,graph,material);
 r.root.updateMatrixWorld(true);for(const edge of graph.edges){const [x,z]=[(edge.start[0]+edge.end[0])/2,(edge.start[1]+edge.end[1])/2];assert.ok(new T.Raycaster(new T.Vector3(x,5,z),new T.Vector3(0,-1,0)).intersectObject(r.root,true).length);}
 r.root.traverse(o=>{if(o.isMesh){const n=o.geometry.attributes.normal;for(let i=0;i<n.count;i++)assert.ok(n.getY(i)>.99);}});r.dispose();material.dispose();
});
test('guide ridge and valley controls change emitted meso geometry and derivatives consistently',async()=>{
 const make=await recipe('createRidgeValleyField'),a=make({ridgeHeight:3,ridgeWidth:2.4,valleyDepth:1.1}),b=make({ridgeHeight:5,ridgeWidth:2.4,valleyDepth:1.1}),x=.7,z=-1.3,e=1e-5,s=a.sample(x,z);
 near(s.dx,(a.sample(x+e,z).height-a.sample(x-e,z).height)/(2*e));near(s.dz,(a.sample(x,z+e).height-a.sample(x,z-e).height)/(2*e));
 const ga=createHeightFieldGeometry(T,a,{sizeX:12,sizeZ:12,segmentsX:20,segmentsZ:20}),gb=createHeightFieldGeometry(T,b,{sizeX:12,sizeZ:12,segmentsX:20,segmentsZ:20});assert.notDeepEqual([...ga.attributes.position.array],[...gb.attributes.position.array]);
 assert.throws(()=>make({ridgeWidth:0}));ga.dispose();gb.dispose();
});
test('guide cluster recipe preserves a designed opening and host frame using stable structure streams',async()=>{
 const build=await recipe('buildClusterInstances'),geometry=new T.IcosahedronGeometry(.08,0),material=new T.MeshBasicMaterial(),frame=new T.Matrix4().makeRotationY(.6).setPosition(2,3,-1),clusters=[{id:'north',frame,radii:[1.2,.7,1],count:40,opening:[0,0,1],openingCosine:.6}];
 const a=build(T,{clusters,geometry,material,streams:createRandomStreams(18)}),b=build(T,{clusters,geometry,material,streams:createRandomStreams(18)});assert.deepEqual([...a.root.instanceMatrix.array],[...b.root.instanceMatrix.array]);assert.equal(a.stats.accepted,40);assert.equal(a.stats.requested,40);
 const inverse=frame.clone().invert(),pose=new T.Matrix4();for(let i=0;i<a.root.count;i++){a.root.getMatrixAt(i,pose);const p=new T.Vector3().setFromMatrixPosition(pose).applyMatrix4(inverse);assert.ok(p.z/p.length()<=.6+1e-6);assert.ok((p.x/1.2)**2+(p.y/.7)**2+p.z**2<=1+1e-6);}
 let gr=0,mr=0;geometry.addEventListener('dispose',()=>gr++);material.addEventListener('dispose',()=>mr++);a.dispose();b.dispose();assert.equal(gr,0);assert.equal(mr,0);geometry.dispose();material.dispose();
});
test('evaluation code rejects metadata-only parameters and empty-node animation while observing real consumers',async()=>{
 const run=await recipe('runConsumerExamples','skill-evaluation.md');
 const r=await run(T,{probeParameter,probeRigidMotion});assert.equal(r.configOnly.changed,false);assert.equal(r.actualTransform.changed,true);assert.equal(r.empty.observed,false);assert.equal(r.moving.observed,true);assert.equal(r.moving.changed,true);
});
