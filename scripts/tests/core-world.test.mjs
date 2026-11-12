import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createLookPalette} from '../../assets/materials/look-palette.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const addon=path=>process.env.THREE_MODULE?pathToFileURL(resolve(dirname(resolve(process.env.THREE_MODULE)),'../examples/jsm',path)).href:`three/addons/${path}`;
const {mergeGeometries}=await import(addon('utils/BufferGeometryUtils.js'));
const {MarchingCubes}=await import(addon('objects/MarchingCubes.js'));
let api={};try{api=await import('../../assets/examples/core-world.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
function setup(options={}){
 assert.equal(typeof api.buildCoreWorld,'function','a complete world must consume the three core capability lines');
 const materials=new Map();function materialFor(role,opts={}){const key=JSON.stringify([role,opts]);if(!materials.has(key))materials.set(key,new T.MeshStandardMaterial({color:opts.color??0xbbc7b8,metalness:role==='metal'?.75:0,roughness:.55}));return materials.get(key);}
 const a=api.buildCoreWorld(T,{mergeGeometries,MarchingCubes,materialFor,...options});
 return {a,materials,dispose(){a.dispose();for(const m of materials.values())m.dispose();}};
}
test('all spatial configurations include the three geometry representations and complete view tasks',()=>{
 for(const configuration of ['grid','ring','terraced']){
  const c=setup({configuration});const {a}=c;
  assert.ok(a.root.isGroup);assert.equal(a.spec.configuration,configuration);
  for(const name of ['curvedRoof','profileBeam','implicitJoint'])assert.ok(a.parts[name].geometry.attributes.position.count>0,name);
  assert.ok(a.viewTasks.length>=4);assert.ok(a.layout.levels.length>=1);assert.ok(a.materialBindings.length>10);
  assert.ok(a.stats.regionCount>=3);assert.ok(a.stats.buildingCount>=3);
  assert.ok(a.stats.pathSurfaceCount>0);assert.equal(a.root.scale.x,1);c.dispose();
 }
});
test('all principal assets consume the same full-footprint region and road constraints',()=>{
 for(const configuration of ['grid','ring','terraced']){
  const c=setup({configuration});assert.ok(c.a.placements.length>=4);
  for(const p of c.a.placements)assert.equal(c.a.layout.footprintAllowed({...p,clearance:.1}),true,p.id);
  c.dispose();
 }
});
test('roof parameter changes actual roof and its dependent edge/attachment without changing unrelated layout',()=>{
 const a=setup({roofLift:0}),b=setup({roofLift:.6});
 assert.notDeepEqual([...a.a.parts.curvedRoof.geometry.attributes.position.array],[...b.a.parts.curvedRoof.geometry.attributes.position.array]);
 assert.notDeepEqual(a.a.anchors.get('roof-service').elements,b.a.anchors.get('roof-service').elements);
 assert.deepEqual(a.a.layout.snapshot,b.a.layout.snapshot);a.dispose();b.dispose();
});
test('absolute motion is seekable and moves actual visible panel geometry',()=>{
 const c=setup(),a=c.a;const state=t=>{a.update(t);a.root.updateMatrixWorld(true);return a.parts.panel.matrixWorld.toArray();};
 const first=state(2);assert.notDeepEqual(first,state(5));assert.deepEqual(first,state(2));c.dispose();
});
test('the full moving attachment stays outside its host interface and the extracted support meets its real base',()=>{
 const c=setup(),a=c.a,port=a.anchors.get('roof-service');
 const origin=new T.Vector3().setFromMatrixPosition(port),normal=new T.Vector3().setFromMatrixColumn(port,2);
 for(const t of [0,2,5,8]){a.update(t);a.root.updateMatrixWorld(true);const p=a.parts.panel.geometry.attributes.position;
  for(let i=0;i<p.count;i++){
   const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(a.parts.panel.matrixWorld);
   assert.ok(v.sub(origin).dot(normal)>.01,'an attachment origin on the host is insufficient; its entire moving volume must clear it');
  }
 }
 assert.ok(a.parts.foundation,'actual extracted geometry must determine the bearing height');
 const joint=new T.Box3().setFromObject(a.parts.bearingInterface),base=new T.Box3().setFromObject(a.parts.foundation);
 assert.ok(base.max.y-joint.min.y>.015&&base.max.y-joint.min.y<.03);
 const vertices=a.parts.bearingInterface.geometry.attributes.position,foot=[];
 for(let i=0;i<vertices.count;i++)if(Math.abs(vertices.getY(i)-a.parts.bearingInterface.geometry.boundingBox.min.y)<1e-4)foot.push([vertices.getX(i),vertices.getZ(i)]);
 assert.ok(foot.length>=6,'bearing needs a finite face, not just a rounded minimum point');
 assert.ok(Math.max(...foot.map(p=>p[0]))-Math.min(...foot.map(p=>p[0]))>.25);
 const shaft=new T.Box3().setFromObject(a.parts.implicitJoint);assert.ok(joint.intersectsBox(shaft),'the explicit interface and continuous body must overlap as designed');
 c.dispose();
});
test('published look guidance consumes the real factory bindings without rebuilding or moving geometry',async()=>{
 const c=setup(),seen=new Map();c.a.root.traverse(o=>{if(o.geometry)seen.set(o,o.geometry);});
 for(const binding of c.a.materialBindings){assert.ok(binding.object.isMesh);assert.ok(binding.slots.length>0);for(const s of binding.slots)assert.ok(['stone','coating','metal','wood'].includes(s.role));}
 const guide=await readFile(new URL('../../references/core-systems.md',import.meta.url),'utf8'),block=[...guide.matchAll(/```js\n([\s\S]*?)```/g)][0][1];
 const applyLook=new Function(block+'\nreturn applyLook;')(),palette=createLookPalette(T,{mode:'toon',resolution:64});
 applyLook(palette,c.a.materialBindings);let toon=0,metal=0;
 for(const [object,g] of seen){assert.equal(object.geometry,g);for(const material of Array.isArray(object.material)?object.material:[object.material]){toon+=material.isMeshToonMaterial?1:0;metal+=material.isMeshStandardMaterial&&material.metalness>.5?1:0;}}
 assert.ok(toon>0&&metal>0);c.dispose();palette.dispose();
});
test('normal-mapped world consumers carry finite unit tangent frames on emitted geometry',()=>{
 const palette=createLookPalette(T,{mode:'pbr',resolution:64}),a=api.buildCoreWorld(T,{mergeGeometries,MarchingCubes,materialFor:palette.get});let checked=0;
 for(const b of a.materialBindings){const ms=Array.isArray(b.object.material)?b.object.material:[b.object.material];if(!ms.some(m=>m.normalMap))continue;
  const g=b.object.geometry,t=g.attributes.tangent,n=g.attributes.normal;assert.ok(t,'normal-map consumer needs an actual chart frame');
  for(const material of ms.filter(m=>m.normalMap))assert.deepEqual(material.userData.lookPalette.tileSizeMeters,[1,1],'the emitted chart measures one metre per UV unit');
  for(let i=0;i<t.count;i++){const tangent=new T.Vector3(t.getX(i),t.getY(i),t.getZ(i)),normal=new T.Vector3().fromBufferAttribute(n,i);
   assert.ok(Number.isFinite(tangent.length())&&Math.abs(tangent.length()-1)<1e-4);assert.ok(Math.abs(tangent.dot(normal))<1e-4);checked++;
  }
 }
 assert.ok(checked>100);a.dispose();palette.dispose();
});
test('terraced links are consumed as actual connecting structure',()=>{
 const c=setup({configuration:'terraced'});assert.ok(c.a.layout.links.length>0);assert.ok(c.a.parts.levelConnections.children.length>0);
 assert.ok(c.a.viewTasks.some(v=>v.id==='level-link'),'the distinct connection needs its own observation task');c.dispose();
});
test('peripheral family retains real openings and wall thickness when viewed from either side',()=>{
 const c=setup(),ray=new T.Raycaster();c.a.root.updateMatrixWorld(true);
 ray.set(new T.Vector3(-15,1.2,-12),new T.Vector3(0,0,-1));
 assert.equal(ray.intersectObject(c.a.root,true).length,0,'an opening must not be backed by a solid proxy');
 ray.set(new T.Vector3(-14.2,1.2,-12),new T.Vector3(0,0,-1));
 assert.ok(ray.intersectObject(c.a.root,true).length>0,'the neighboring wall must remain actual geometry');
 c.dispose();
});
test('principal enclosed regions have actual floor-level entrance ports and clear doorway volumes',()=>{
 const c=setup(),a=c.a;a.root.updateMatrixWorld(true);assert.equal(a.entrances.length,3);
 for(const entrance of a.entrances){
  const p=new T.Vector3(...entrance.point),n=new T.Vector3(...entrance.normal),ray=new T.Raycaster(p.clone().addScaledVector(n,.45),n.clone().negate(),0,.65);
  assert.equal(ray.intersectObject(a.root,true).length,0,'a named entrance must not still contain a window sill or backing wall');
 }
 c.dispose();
});
test('world disposal releases generated geometry once while preserving borrowed materials',()=>{
 const c=setup(),geometries=new Set();let n=0,m=0;c.a.root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});
 for(const g of geometries)g.addEventListener('dispose',()=>n++);for(const x of c.materials.values())x.addEventListener('dispose',()=>m++);
 c.a.dispose();c.a.dispose();assert.equal(n,geometries.size);assert.equal(m,0);assert.throws(()=>c.a.update(1),/disposed/i);
 for(const x of c.materials.values())x.dispose();
});
test('invalid configuration or structural input fails before construction',()=>{
 for(const options of [{configuration:'city-name'},{roofLift:NaN},{roofLift:3}])assert.throws(()=>setup(options));
});
