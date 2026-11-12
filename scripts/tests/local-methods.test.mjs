import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
async function recipe(name){let text='';try{text=await readFile(new URL('../../references/water-motion-methods.md',import.meta.url),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 const block=[...text.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]).find(c=>c.includes(`function ${name}(`));assert.ok(block,`local executable recipe ${name} must exist`);return vm.runInNewContext(`${block};${name}`);}
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} ≈ ${b}`);
const waves=[{direction:[1,.3],amplitude:.2,wavelength:8,q:.4,omega:1.2,phase:.1},{direction:[-.2,1],amplitude:.08,wavelength:3,q:.2,omega:1.6,phase:2}];
test('local multi-wave method differentiates the full displaced surface in world units',async()=>{
 const sample=await recipe('sampleWaveSurface'),x=2.37,z=-4.12,t=1.9,s=sample(x,z,t,waves),e=1e-5;
 const a=sample(x+e,z,t,waves),b=sample(x-e,z,t,waves),c=sample(x,z+e,t,waves),d=sample(x,z-e,t,waves);
 for(let i=0;i<3;i++){near(s.dx[i],(a.position[i]-b.position[i])/(2*e));near(s.dz[i],(c.position[i]-d.position[i])/(2*e));}
 near(Math.hypot(...s.normal),1);near(s.normal.reduce((v,n,i)=>v+n*s.dx[i],0),0);near(s.normal.reduce((v,n,i)=>v+n*s.dz[i],0),0);assert.ok(s.normal[1]>0);
});
test('wave method handles flat/zero amplitude, preserves caller inputs and rejects invalid definitions',async()=>{
 const sample=await recipe('sampleWaveSurface'),before=JSON.stringify(waves);
 const flat=sample(3,4,9,[]);assert.equal(JSON.stringify(flat.position),'[3,0,4]');assert.equal(JSON.stringify(flat.normal),'[0,1,0]');
 const zero=sample(3,4,9,[{direction:[1,0],amplitude:0,wavelength:2,q:1}]);assert.equal(JSON.stringify(zero.position),'[3,0,4]');sample(1,2,3,waves);assert.equal(JSON.stringify(waves),before);
 for(const w of [{direction:[0,0],amplitude:1,wavelength:1},{direction:[1,0],amplitude:1,wavelength:0}])assert.throws(()=>sample(0,0,0,[w]));
});
test('distance constraint fixes a stretched rope segment while keeping the pinned endpoint fixed',async()=>{
 const project=await recipe('projectDistance'),a=[0,0,0],b=[3,0,0];const result=project({a,b,wa:0,wb:1,rest:2,dt:1/60});near(b[0],2);near(a[0],0);assert.ok(result.solved);
});
test('compliance and accumulated lambda are distinct from iteration count or frame dt',async()=>{
 const project=await recipe('projectDistance'),a=[0,0,0],b=[3,0,0];const first=project({a,b,wa:1,wb:1,rest:2,dt:.1,compliance:.01}),distance=b[0]-a[0];assert.ok(distance>2&&distance<3);
 project({a,b,wa:1,wb:1,rest:2,dt:.1,compliance:.01,lambda:first.lambda});near(b[0]-a[0],distance);
 const p=[1,0,0],q=[1,0,0],r=project({a:p,b:q,wa:1,wb:1,rest:1,dt:.1});assert.equal(r.solved,false);assert.ok([...p,...q].every(Number.isFinite));
 assert.throws(()=>project({a:[0,0,0],b:[1,0,0],wa:1,wb:1,rest:1,dt:0}));
});
test('local picking recipe uses the canvas rectangle and respects the nearest semantic occluder',async()=>{
 const THREE=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
 const doc=await readFile(new URL('../../references/camera-interaction.md',import.meta.url),'utf8'),code=[...doc.matchAll(/```js\n([\s\S]*?)```/g)].map(m=>m[1]).find(c=>c.includes('function pickEntity('));assert.ok(code,'local pickEntity recipe must exist');
 const pick=vm.runInNewContext(`${code};pickEntity`,{THREE}),camera=new THREE.PerspectiveCamera(45,2,.1,100);camera.position.z=10;camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const scene=new THREE.Scene(),entity=new THREE.Group(),box=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial());entity.userData.entityId='target';entity.add(box);scene.add(entity);scene.updateMatrixWorld(true);
 const canvas={getBoundingClientRect:()=>({left:100,top:40,width:400,height:200})};assert.equal(pick({clientX:300,clientY:140},canvas,camera,[scene]).entityId,'target');
 const blocker=new THREE.Mesh(new THREE.BoxGeometry(3,3,1),box.material);blocker.position.z=4;scene.add(blocker);scene.updateMatrixWorld(true);assert.equal(pick({clientX:300,clientY:140},canvas,camera,[scene]),null,'do not select through unlabeled occluders');
 blocker.visible=false;assert.equal(pick({clientX:300,clientY:140},canvas,camera,[scene]).entityId,'target','hidden objects must not occlude picking');
 blocker.visible=true;const hiddenGroup=new THREE.Group();hiddenGroup.visible=false;scene.add(hiddenGroup);hiddenGroup.add(blocker);scene.updateMatrixWorld(true);assert.equal(pick({clientX:300,clientY:140},canvas,camera,[scene]).entityId,'target','hidden ancestor must not occlude picking');
 box.geometry.dispose();blocker.geometry.dispose();box.material.dispose();
});
