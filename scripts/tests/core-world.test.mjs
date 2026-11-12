import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {inspectFeatureVisibility} from '../../assets/scene/view-readability.mjs';
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
test('regional uses generate distinct structural programs and retain actual local assets and placements',()=>{
 for(const configuration of ['grid','ring','terraced']){
  const c=setup({configuration}),a=c.a;assert.equal(a.regionalAssets.length,3);
  assert.equal(new Set(a.regionalAssets.map(r=>r.program)).size,3);
  for(const region of a.regionalAssets){assert.ok(region.asset.parts.roofs.length);assert.ok(region.asset.parts.furniture.length);assert.ok(a.placements.some(p=>p.id===region.id));assert.ok(a.viewTasks.some(v=>v.id===region.id));}
  c.dispose();
 }
});
test('near, regional and distant context consumes one terrain field without floating foundations',()=>{
 const c=setup(),context=c.a.context;assert.ok(context.terrain.isMesh);assert.ok(context.sites.length>=6);
 assert.ok(new Set(context.sites.map(s=>s.tier)).size>=2);
 const p=context.terrain.geometry.attributes.position;for(let i=0;i<p.count;i+=47)assert.ok(Math.abs(p.getY(i)-context.field.heightAt(p.getX(i),p.getZ(i)))<1e-4);
 for(const site of context.sites){for(const [x,z]of site.footprint)assert.ok(Math.abs(context.field.heightAt(x,z)-site.groundY)<1e-5);assert.ok(site.baseY>site.groundY);}
 assert.ok(c.a.shadowBounds.getSize(new T.Vector3()).length()<100,'distant terrain must not dilute the near shadow map');c.dispose();
});
test('terraced connection consumes two exposed full-width ports',()=>{
 const c=setup({configuration:'terraced'}),a=c.a;assert.equal(a.layout.ports.length,2);
 for(const link of a.layout.links)for(const end of [link.start,link.end])assert.ok(a.layout.ports.some(p=>new T.Vector3(...p.center).distanceTo(new T.Vector3(...end))<1e-7));
 assert.equal(a.parts.levelConnections.userData.portPairs.length,1);c.dispose();
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
 ray.set(new T.Vector3(-15,1.2,-12),new T.Vector3(0,0,-1));ray.far=2.8;
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
test('regional placement metadata encloses every actual mesh and complementary views frame each complete asset',()=>{
 for(const configuration of ['grid','ring','terraced']){
  const c=setup({configuration}),a=c.a;
  for(const region of a.regionalAssets){
   const placement=a.placements.find(p=>p.id===region.id),xs=placement.polygon.map(p=>p[0]),zs=placement.polygon.map(p=>p[1]),bounds=new T.Box3().setFromObject(region.asset.root);
   assert.ok(Math.abs(Math.min(...xs)-bounds.min.x)<1e-5&&Math.abs(Math.max(...xs)-bounds.max.x)<1e-5);
   assert.ok(Math.abs(Math.min(...zs)-bounds.min.z)<1e-5&&Math.abs(Math.max(...zs)-bounds.max.z)<1e-5);
   for(const id of [region.id,region.id+'/reverse']){
    const view=a.viewTasks.find(v=>v.id===id);assert.ok(view);
    const camera=new T.PerspectiveCamera(41,1280/720,.1,420);camera.position.fromArray(view.position);camera.lookAt(new T.Vector3(...view.target));camera.updateMatrixWorld();
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
     const p=new T.Vector3(x,y,z).project(camera);assert.ok(Math.abs(p.x)<.95&&Math.abs(p.y)<.95&&p.z>-1&&p.z<1,`${configuration}/${id}: complete envelope must fit`);
    }
   }
  }
  c.dispose();
 }
});
test('level connector meshes carry the entire width at both declared port mouths',()=>{
 const c=setup({configuration:'terraced'}),a=c.a;a.root.updateMatrixWorld(true);
 const link=a.layout.links[0],start=new T.Vector3(...link.start),end=new T.Vector3(...link.end),direction=end.clone().sub(start);direction.y=0;direction.normalize();
 const side=new T.Vector3(direction.z,0,-direction.x),ray=new T.Raycaster();
 for(const [center,inset]of [[start,.015],[end,-.015]])for(const fraction of [-.49,0,.49]){
  const p=center.clone().addScaledVector(direction,inset).addScaledVector(side,link.width*fraction);p.y+=4;
  ray.set(p,new T.Vector3(0,-1,0));ray.far=5;
  assert.ok(ray.intersectObject(a.parts.levelConnections,true).length>0,'connector tread must meet the whole actual port cross-section');
 }
 c.dispose();
});
test('assembled peripheral roofs consume actual triangle material regions with nonempty weather, soffit and edge areas',()=>{
 const c=setup(),stats=c.a.materialRegionStats;assert.equal(stats.length,9);
 for(const roof of stats){assert.ok(roof.triangleCount>0&&roof.area>0);assert.deepEqual(roof.slots.map(s=>s.id),['weather-face','soffit','cut-edge']);for(const s of roof.slots)assert.ok(s.area>0&&s.triangleCount>0);assert.equal(roof.slots.reduce((n,s)=>n+s.triangleCount,0),roof.triangleCount);}
 const ctx=c.a.context;assert.ok(ctx.stats.staticMeshes<ctx.sites.length*2,'context must consume the static assembly, not retain hundreds of per-building draw calls');
 for(const site of ctx.sites){assert.ok(site.partCounts.windows>0&&site.partCounts.roofs>0&&site.partCounts.furniture>0);}
 c.dispose();
});

test('regional purposes come from authored zones and survive hall record reordering',()=>{
 assert.equal(typeof api.createCoreWorldDesign,'function');
 for(const configuration of ['grid','ring','terraced']){
  const design=api.createCoreWorldDesign(configuration),expected=new Map(design.halls.map(h=>[h.id,design.regions.find(r=>r.id===h.regionId).role]));
  const first=setup({configuration,design}),reordered=setup({configuration,design:{...design,halls:[...design.halls].reverse()}});
  try{
   assert.deepEqual(new Set(expected.values()),new Set(['gallery','workshop','courtyard']));
   for(const {a} of [first,reordered])for(const region of a.regionalAssets){
    const p=a.placements.find(p=>p.id===region.id),zone=a.layout.regions.find(r=>r.id===p.regionId);
    assert.equal(region.program,expected.get(region.id));assert.equal(region.program,zone.role);
    assert.equal(p.regionId,design.halls.find(h=>h.id===region.id).regionId);
    assert.equal(region.asset.spec.program,zone.role);
    for(const suffix of ['', '/reverse'])assert.equal(a.viewTasks.find(v=>v.id===region.id+suffix).program,zone.role);
   }
  }finally{first.dispose();reordered.dispose();}
 }
});
test('upper workshop has a supported full-width road-to-threshold approach',()=>{
 const c=setup({configuration:'terraced'}),a=c.a;
 try{
  const r=a.regionalAssets.find(r=>r.program==='workshop'),e=a.entrances.find(e=>e.id===r.id+'/entrance'),door=new T.Vector3(...e.point),normal=new T.Vector3(...e.normal);
  const level=a.layout.levels.find(l=>l.id===a.placements.find(p=>p.id===r.id).level),edge=level.edges.find(e=>e.id==='upper-axis'),nodes=new Map(level.nodes.map(n=>[n.id,n]));
  const from=nodes.get(edge.from),to=nodes.get(edge.to),v=new T.Vector3(to.x-from.x,0,to.z-from.z),start=new T.Vector3(from.x,level.y+.16,from.z),t=T.MathUtils.clamp(door.clone().sub(start).dot(v)/v.lengthSq(),0,1),road=start.addScaledVector(v,t),delta=road.clone().sub(door);delta.y=0;
  assert.ok(normal.dot(delta.clone().normalize())>.999,'threshold must face its authored road');
  const side=new T.Vector3(normal.z,0,-normal.x),ray=new T.Raycaster();a.root.updateMatrixWorld(true);
  for(let i=0;i<=40;i++)for(const fraction of [-.49,-.25,0,.25,.49]){
   const p=door.clone().lerp(road,i/40).addScaledVector(side,e.width*fraction);p.y=level.y+.24;
   ray.set(p,new T.Vector3(0,-1,0));ray.far=.3;
   const hit=ray.intersectObject(a.root,true)[0];assert.ok(hit,'entire approach width requires actual supporting triangles');
   assert.ok(Math.abs(hit.point.y-(level.y+.16))<.025,`road-to-door must remain level: ${hit.point.y}`);
  }
 }finally{c.dispose();}
});
for(const [klass,where] of [['BoxGeometry','addStatic'],['CylinderGeometry','beam']])test(`static ${where} owns its source before borrowed material lookup can throw`,()=>{
 const gs=new Map(),borrowed=new T.MeshStandardMaterial();let materialDisposals=0;borrowed.addEventListener('dispose',()=>materialDisposals++);
 class Track extends T[klass]{constructor(...args){super(...args);gs.set(this,0);this.addEventListener('dispose',()=>gs.set(this,gs.get(this)+1));}}
 const materialFor=()=>{if(new Error().stack.split('\n').some(s=>s.includes('at '+where+' (')&&s.includes('/core-world.mjs:')))throw Error('injected '+where);return borrowed;};
 try{
  assert.throws(()=>api.buildCoreWorld({...T,[klass]:Track},{materialFor,MarchingCubes,mergeGeometries}),new RegExp('injected '+where));
  assert.ok(gs.size>0);assert.ok([...gs.values()].every(n=>n===1),`all ${gs.size} allocated ${klass} inputs need exactly one disposal: ${[...gs.values()].filter(n=>n!==1)}`);
  assert.equal(materialDisposals,0,'materials remain borrowed on abort');
 }finally{borrowed.dispose();}
});
test('complementary pavilion observations cover every column face and both sampled ends with actual visibility',()=>{
 for(const configuration of ['grid','ring','terraced']){
  const c=setup({configuration}),a=c.a;
  try{
   const set=a.observationSets?.find(s=>s.id==='profile-sections');assert.ok(set,'store the real complementary observation responsibility');
   assert.equal(set.samples.length,16);assert.equal(new Set(set.samples.map(s=>s.id)).size,16);
   assert.equal(new Set(set.samples.map(s=>s.columnId)).size,4);assert.deepEqual(new Set(set.samples.map(s=>s.end)),new Set(['lower','upper']));
   const covered=new Set();
   for(const viewId of set.viewIds){
    const view=a.viewTasks.find(v=>v.id===viewId);assert.ok(view);assert.ok(view.sampleIds.length>0);assert.equal(view.inspection.envelopeInside,true);
    assert.ok(view.inspection.features.every(f=>f.satisfied&&f.minVisibleFraction===1));
    const camera=new T.PerspectiveCamera(41,1280/720,.1,250);camera.position.fromArray(view.position);camera.lookAt(new T.Vector3(...view.target));camera.updateMatrixWorld();
    const samples=view.sampleIds.map(id=>set.samples.find(s=>s.id===id));assert.ok(samples.every(Boolean));
    const actual=inspectFeatureVisibility(T,{camera,points:samples.map(s=>s.point),occluders:[a.root],viewport:{width:1280,height:720},epsilon:1e-4});
    assert.equal(actual.visibleSampleCount,samples.length,`${configuration}/${viewId}: every assigned face/end must really be visible`);
    for(const s of samples)covered.add(s.id);
   }
   assert.equal(covered.size,16);assert.equal(set.coverage.complete,true);assert.deepEqual(new Set(set.coverage.coveredSampleIds),covered);
   assert.ok(set.viewIds.includes('region')&&set.viewIds.includes('region/reverse'));
  }finally{c.dispose();}
 }
});
test('shared clay material retains every static semantic triangle for later differentiated looks',()=>{
 const direct=setup(),clay=new T.MeshStandardMaterial(),shared=setup({materialFor:()=>clay});
 function distribution(a){
  const totals=new Map();a.root.updateMatrixWorld(true);
  for(const {object,slots} of a.materialBindings){const g=object.geometry,p=g.attributes.position,groups=g.groups.length?g.groups:[{start:0,count:g.index?.count??p.count,materialIndex:0}];
   for(const group of groups){const binding=slots[group.materialIndex]??slots[0],key=JSON.stringify([binding.role,Object.entries(binding.options).sort(([a],[b])=>a.localeCompare(b)),object.castShadow,object.receiveShadow,object.layers.mask]),value=totals.get(key)??{triangles:0,area:0};
    for(let i=group.start;i<group.start+group.count;i+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,g.index?g.index.getX(i+j):i+j).applyMatrix4(object.matrixWorld));value.triangles++;value.area+=v[1].sub(v[0]).cross(v[2].sub(v[0])).length()/2;}totals.set(key,value);
   }
  }return totals;
 }
 try{
  const expected=distribution(direct.a),actual=distribution(shared.a);assert.deepEqual(new Set(actual.keys()),new Set(expected.keys()));
  for(const [key,value] of expected){assert.equal(actual.get(key).triangles,value.triangles,key);assert.ok(Math.abs(actual.get(key).area-value.area)<1e-5,key);}
  const before=new Map(shared.a.materialBindings.map(b=>[b.object,b.object.geometry])),palette=createLookPalette(T,{mode:'toon',resolution:64});
  try{for(const {object,slots} of shared.a.materialBindings){const materials=slots.map(s=>palette.get(s.role,s.options));object.material=materials.length===1?materials[0]:materials;assert.equal(object.geometry,before.get(object));}assert.deepEqual(distribution(shared.a),actual);}finally{palette.dispose();}
 }finally{direct.dispose();shared.dispose();clay.dispose();}
});
test('regional task labels follow the actual program and viewing direction in every layout',()=>{
 assert.equal(typeof api.coreViewLabel,'function');
 const names={gallery:{front:'展廊与天窗',reverse:'展廊背面'},workshop:{front:'工坊与夹层',reverse:'工坊背面'},courtyard:{front:'庭院与柱廊',reverse:'庭院背面'}};
 assert.equal(api.coreViewLabel({id:'hall/99',program:'courtyard',direction:'reverse'}),'庭院背面');
 for(const configuration of ['grid','ring','terraced']){
  const c=setup({configuration});try{for(const r of c.a.regionalAssets)for(const [suffix,direction] of [['','front'],['/reverse','reverse']]){
   const task=c.a.viewTasks.find(v=>v.id===r.id+suffix);assert.equal(task.program,r.program);assert.equal(task.direction,direction);assert.equal(api.coreViewLabel(task),names[r.program][direction]);
  }}finally{c.dispose();}
 }
});
test('upper approach shares deck and road boundaries without overlapping top triangles or false metric maps',()=>{
 const c=setup({configuration:'terraced'}),a=c.a,workshop=a.regionalAssets.find(r=>r.program==='workshop'),entrance=a.entrances.find(e=>e.id===workshop.id+'/entrance'),p=new T.Vector3(...entrance.point),n=new T.Vector3(...entrance.normal),side=new T.Vector3(n.z,0,-n.x),ray=new T.Raycaster();a.root.updateMatrixWorld(true);
 try{
  const floorY=p.y-.25;
  for(const distance of [.29,.61,1.17,1.93,2.22])for(const fraction of [-.37,0,.37]){
   const origin=p.clone().addScaledVector(n,distance).addScaledVector(side,entrance.width*fraction);origin.y=floorY+.02;
   ray.set(origin,new T.Vector3(0,-1,0));ray.far=.05;
   const hits=ray.intersectObject(a.root,true).filter(h=>Math.abs(h.point.y-floorY)<1e-5),objects=new Set(hits.map(h=>h.object));
   assert.equal(objects.size,1,'deck, approach and road may meet at a shared edge, never cover the same top area');
  }
  const approach=a.approaches.find(v=>v.id===workshop.id+'/approach'),middle=new T.Vector3(...approach.start).lerp(new T.Vector3(...approach.end),.5);middle.y=floorY+.02;
  ray.set(middle,new T.Vector3(0,-1,0));ray.far=.05;const hit=ray.intersectObject(a.root,true)[0],binding=a.materialBindings.find(b=>b.object===hit.object);
  assert.equal(binding.slots[hit.face.materialIndex??0]?.options.maps,false,'rotated connection must either emit measured metric UVs or explicitly use scalar material');
 }finally{c.dispose();}
});
test('all nine near peripheral roof surfaces retain cast and receive shadow state',()=>{
 const c=setup(),a=c.a,ray=new T.Raycaster();a.root.updateMatrixWorld(true);
 try{for(let i=0;i<9;i++){
  ray.set(new T.Vector3(-15+i*3.8+.37,8,-13.8+.19),new T.Vector3(0,-1,0));ray.far=8;
  const hit=ray.intersectObject(a.root,true)[0];assert.ok(hit);assert.equal(hit.object.castShadow,true,`perimeter/${i} roof must cast`);assert.equal(hit.object.receiveShadow,true,`perimeter/${i} roof must receive`);
 }}finally{c.dispose();}
});
test('authored placement tolerance rejects unbounded input before building or sampling',()=>{
 for(const invalid of [Infinity,-.1,NaN,1.01,1e9]){
  const design=api.createCoreWorldDesign('grid');let reads=0,materials=0;
  Object.defineProperty(design.halls[0],'placementTolerance',{get(){if(++reads>501)throw Error('probe stopped unsafe repeated reads');return invalid;}});
  assert.throws(()=>api.buildCoreWorld(T,{design,mergeGeometries,MarchingCubes,materialFor(){materials++;return new T.MeshStandardMaterial();}}),/placement tolerance/i);
  assert.equal(materials,0,'input validation precedes geometry and material construction');assert.ok(reads<=2,'a single validated tolerance snapshot bounds sampling');
 }
});
test('rotated approach uses an honest scalar-material chart contract',()=>{
 const c=setup({configuration:'terraced'}),a=c.a;try{
  const approach=a.approaches.find(v=>v.level==='upper'),p=new T.Vector3(...approach.start).lerp(new T.Vector3(...approach.end),.5);p.y+=.02;
  const ray=new T.Raycaster(p,new T.Vector3(0,-1,0),0,.05);a.root.updateMatrixWorld(true);const hit=ray.intersectObject(a.root,true)[0],binding=a.materialBindings.find(b=>b.object===hit.object);
  assert.equal(binding.slots[hit.face.materialIndex??0].options.maps,false,'unmeasured rotated UVs must not claim one physical metre per UV');
 }finally{c.dispose();}
});
test('ring approaches join the real inner road boundaries across their full width',()=>{
 const c=setup({configuration:'ring'}),a=c.a,ray=new T.Raycaster();a.root.updateMatrixWorld(true);
 try{for(const approach of a.approaches){const start=new T.Vector3(...approach.start),end=new T.Vector3(...approach.end),direction=end.clone().sub(start).normalize(),side=new T.Vector3(direction.z,0,-direction.x);
  for(const t of [.01,.25,.5,.75,.99])for(const f of [-.49,0,.49]){const p=start.clone().lerp(end,t).addScaledVector(side,approach.width*f);p.y+=.02;ray.set(p,new T.Vector3(0,-1,0));ray.far=.05;const hits=ray.intersectObject(a.root,true).filter(h=>Math.abs(h.point.y-start.y)<1e-5);assert.equal(new Set(hits.map(h=>h.object)).size,1,'inner boundary approach must have exactly one supporting top surface');}
 }}finally{c.dispose();}
});
