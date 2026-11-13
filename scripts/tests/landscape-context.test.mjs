import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createResourceScope} from '../../assets/runtime/resource-scope.mjs';
const T=await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href);
const {mergeGeometries}=await import(pathToFileURL(resolve(dirname(resolve(process.env.THREE_MODULE)),'../examples/jsm/utils/BufferGeometryUtils.js')).href);
const api=await import('../../assets/examples/landscape-context.mjs');
const {buildRegionalArchitecture}=await import('../../assets/examples/region-programs.mjs');
function setup(configuration='grid'){
 const material=new T.MeshStandardMaterial();let materialDisposals=0;material.addEventListener('dispose',()=>materialDisposals++);
 const context=api.buildLandscapeContext(T,{mergeGeometries,materialFor:()=>material,configuration});
 return {context,material,get materialDisposals(){return materialDisposals;},dispose(){context.dispose();material.dispose();}};
}
test('context is compiled from connected road regions and measured real architectural prototypes',()=>{
 assert.equal(typeof api.createLandscapeContextDesign,'function');
 for(const configuration of ['grid','ring','terraced']){
  const c=setup(configuration),a=c.context;
  try{
   assert.equal(a.layout.connectionGraph.components.length,1);assert.ok(a.neighborhood.lots.length>=12);
   assert.deepEqual(new Set(a.sites.map(s=>s.tier)),new Set(['near','regional','distant']));
   assert.deepEqual(new Set(a.sites.map(s=>s.program)),new Set(['gallery','workshop','courtyard']));
   assert.ok(new Set(a.sites.map(s=>s.prototypeId)).size>=9,'measured compact and long programs must reach real consumers');
   const groupSizes=new Map();for(const s of a.sites)groupSizes.set(s.groupId,(groupSizes.get(s.groupId)??0)+1);
   assert.ok([...groupSizes.values()].filter(n=>n>=2).length>=4,'accepted buildings must form actual repeated groups');
   const ray=new T.Raycaster();a.root.updateMatrixWorld(true);
   for(const prototype of a.prototypes){const asset=buildRegionalArchitecture(T,{...prototype.spec,materialFor:()=>c.material});try{assert.deepEqual(asset.footprint,prototype.footprint);assert.equal(new T.Box3().setFromObject(asset.root).min.y,prototype.measuredBounds.minY);}finally{asset.dispose();}}
   for(const site of a.sites){
    const lot=a.neighborhood.lots.find(l=>l.id===site.id),prototype=a.prototypes.find(p=>p.id===lot.prototypeId);
    assert.deepEqual(site.footprint,lot.footprint);assert.equal(site.program,prototype.spec.program);
    assert.equal(a.layout.footprintAllowed({level:'context',regionId:lot.regionId,polygon:lot.footprint,clearance:.1}),true);
    assert.ok(site.partCounts.windows>0&&site.partCounts.furniture>0&&site.partCounts.roofs>0);
    assert.equal(site.measuredBounds.minY+site.baseY,site.groundY);
    assert.ok(site.route.surface.outer.length===4);assert.ok(a.roads.query(...site.route.roadCenter));
    const start=new T.Vector3(...site.route.start),end=new T.Vector3(...site.route.end),direction=end.clone().sub(start).normalize(),side=new T.Vector3(direction.z,0,-direction.x);
    for(const t of [.01,.5,.99])for(const f of [-.49,0,.49]){
     const p=start.clone().lerp(end,t).addScaledVector(side,site.route.width*f);p.y=site.baseY+.02;
     ray.set(p,new T.Vector3(0,-1,0));ray.far=.05;const hits=ray.intersectObject(a.root,true).filter(h=>Math.abs(h.point.y-site.baseY)<1e-5);
     assert.equal(new Set(hits.map(h=>h.object)).size,1,'arrival must have exactly one full-width supporting top');
    }
   }
   assert.ok(a.roads.stats.outputTriangles>0);assert.equal(a.gateways.length,2);
   for(const g of a.gateways)for(const f of [-.49,0,.49]){const hit=a.roads.query(g.center[0]+g.normal[0]*.01,g.center[2]+f*g.width);assert.ok(hit);assert.ok(Math.abs(hit.topHeight-(g.center[1]+.16))<1e-6);}
  }finally{c.dispose();}
 }
});
test('context topology changes spatial organization and owns geometry while borrowing material semantics',()=>{
 const g=setup('grid'),r=setup('ring');try{
  assert.notDeepEqual(g.context.layout.snapshot,r.context.layout.snapshot);
  assert.notEqual(g.context.design.topology,r.context.design.topology);
  assert.notDeepEqual(g.context.sites.map(s=>s.position),r.context.sites.map(s=>s.position),'topology must change actual accepted district placements');
  const roles=new Set(g.context.materialBindings.flatMap(b=>b.slots.map(s=>s.role)));assert.deepEqual(roles,new Set(['stone','coating','wood','metal']));
  const owned=new Set();g.context.root.traverse(o=>{if(o.geometry)owned.add(o.geometry);});let count=0;
  for(const x of owned)x.addEventListener('dispose',()=>count++);
  g.context.dispose();g.context.dispose();assert.equal(count,owned.size);assert.equal(g.materialDisposals,0);
 }finally{g.dispose();r.dispose();}
});

// Instrument ownership, not elapsed GC timing: run the real factory and real
// resource scopes, observing the source registration and source-map lifetimes.
async function trackedFactory(){
 const url=new URL('../../assets/examples/landscape-context.mjs',import.meta.url),scopes=[],maps=[],supports=[],roads=[],released=[],sourceGeometry=new Map(),seenMaps=new WeakSet(),key=`r72-source-lifecycle-${Math.random()}`;
 const isSource=v=>v?.root?.name?.startsWith('regional-')&&v.parts?.floors;
 class TrackedMap extends Map{set(k,v){if(isSource(v)&&!seenMaps.has(this)){seenMaps.add(this);maps.push(new WeakRef(this));}return super.set(k,v);}}
 globalThis[key]={Map:TrackedMap,createResourceScope(){const inner=createResourceScope(),record={inspect:inner.inspect,sources:0};scopes.push(record);return {...inner,own(value,...args){
   if(value?.terrainTriangles&&typeof value.dispose==='function'){supports.push(value);return inner.own(value,v=>{released.push(v);v.dispose();});}
   if(value?.geometry&&typeof value.query==='function'){roads.push(value);return inner.own(value,v=>{released.push(v);v.dispose();});}
   if(isSource(value)){record.sources++;value.root.traverse(o=>{if(o.geometry&&!sourceGeometry.has(o.geometry)){sourceGeometry.set(o.geometry,0);o.geometry.addEventListener('dispose',()=>sourceGeometry.set(o.geometry,sourceGeometry.get(o.geometry)+1));}});}return inner.own(value,...args);}};}};
 let text=await readFile(url,'utf8');text=text.replace("import {createResourceScope} from '../runtime/resource-scope.mjs';",`const {createResourceScope,Map}=globalThis[${JSON.stringify(key)}];`);
 text=text.replace(/from '([^']+)'/g,(match,path)=>path.startsWith('.')?`from '${new URL(path,url).href}'`:match);
 const module=await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
 return {build:module.buildLandscapeContext,scopes,maps,supports,roads,released,sourceGeometry,close(){delete globalThis[key];}};
}
test('temporary source prototypes release their owning scope and map before a successful context is returned',async()=>{
 const probe=await trackedFactory(),material=new T.MeshStandardMaterial();let borrowedDisposals=0;material.addEventListener('dispose',()=>borrowedDisposals++);let context;
 try{
  context=probe.build(T,{mergeGeometries,materialFor:()=>material});
  const sourceOwners=probe.scopes.filter(s=>s.sources);assert.equal(sourceOwners.length,1);assert.equal(sourceOwners[0].sources,18);
  assert.deepEqual(sourceOwners[0].inspect(),{state:'disposed',owned:0,cleanups:0},'temporary source ownership must end before the usable scene is returned');
  assert.ok(probe.scopes.some(s=>!s.sources&&s.inspect().state==='open'&&s.inspect().owned>0),'final terrain, roads and batches need their own live scope');
  assert.equal(probe.maps.length,1);for(const ref of probe.maps)assert.ok(!ref.deref()||ref.deref().size===0,'the temporary source map must release its strong references');
  assert.ok(probe.sourceGeometry.size>100);assert.ok([...probe.sourceGeometry.values()].every(n=>n===1),'source geometry is disposed once immediately after its last bake');
  const finalGeometry=new Map();context.root.traverse(o=>{if(o.geometry){assert.equal(probe.sourceGeometry.has(o.geometry),false);if(!finalGeometry.has(o.geometry)){finalGeometry.set(o.geometry,0);o.geometry.addEventListener('dispose',()=>finalGeometry.set(o.geometry,finalGeometry.get(o.geometry)+1));}}});
  assert.ok([...finalGeometry.values()].every(n=>n===0));assert.equal(borrowedDisposals,0);context.dispose();context.dispose();assert.ok([...finalGeometry.values()].every(n=>n===1));assert.ok([...probe.sourceGeometry.values()].every(n=>n===1));assert.equal(borrowedDisposals,0);
 }finally{context?.dispose();probe.close();material.dispose();}
});
test('failed context construction closes temporary source ownership and clears its source map',async()=>{
 const probe=await trackedFactory(),material=new T.MeshStandardMaterial();let borrowedDisposals=0;material.addEventListener('dispose',()=>borrowedDisposals++);
 try{
  assert.throws(()=>probe.build(T,{mergeGeometries,materialFor(role,options){if(options?.baseColor===0x88957b)throw Error('injected terrain material failure');return material;}}),/injected terrain material failure/);
  assert.equal(probe.scopes.filter(s=>s.sources).reduce((n,s)=>n+s.sources,0),18);
  assert.ok(probe.scopes.length>=2,'source and final ownership must be separate even when construction fails');
  for(const scope of probe.scopes)assert.deepEqual(scope.inspect(),{state:'disposed',owned:0,cleanups:0});
  assert.equal(probe.maps.length,1);for(const ref of probe.maps)assert.ok(!ref.deref()||ref.deref().size===0,'failure must also clear the source map');
  assert.ok([...probe.sourceGeometry.values()].every(n=>n===1));assert.equal(borrowedDisposals,0);
 }finally{probe.close();material.dispose();}
});

const {compileWorldLayout}=await import('../../assets/scene/world-layout.mjs');
const diagonalCampus=()=>compileWorldLayout({levels:[{id:'ground',y:0,nodes:[{id:'west',x:-18,z:0},{id:'mid',x:0,z:18},{id:'east',x:18,z:0}],edges:[{id:'w',from:'mid',to:'west',width:2.6},{id:'e',from:'mid',to:'east',width:2.6}],openEnds:['west','east']}],regions:[]});
test('oblique true campus ports keep opposite normals and swapped full-width endpoints, with a supported mouth',()=>{
 const campus=diagonalCampus(),design=api.createLandscapeContextDesign({gateways:campus.ports}),layout=compileWorldLayout(design);
 for(const port of campus.ports){const peer=layout.ports.find(p=>p.center.every((v,i)=>v===port.center[i])),v=a=>new T.Vector3(...a);
  assert.ok(peer);assert.ok(Math.abs(v(peer.normal).dot(v(port.normal))+1)<1e-10);assert.ok(v(peer.left).distanceTo(v(port.right))<1e-8);assert.ok(v(peer.right).distanceTo(v(port.left))<1e-8);
 }
 const material=new T.MeshStandardMaterial();let context;try{
  context=api.buildLandscapeContext(T,{gateways:campus.ports,mergeGeometries,materialFor:()=>material});const road=new T.Mesh(context.roads.geometry,material);
  for(const port of campus.ports)for(const t of [.02,1,3.95])for(const w of [-.499,0,.499]){
   const n=new T.Vector3(...port.normal),p=new T.Vector3(...port.center).addScaledVector(n,t).addScaledVector(new T.Vector3(n.z,0,-n.x),w*port.width);
   const ray=new T.Raycaster(p.setY(2),new T.Vector3(0,-1,0)),top=ray.intersectObject(road)[0],ground=ray.intersectObject(context.terrain)[0],q=context.roads.query(p.x,p.z);assert.ok(top&&ground&&q);
   assert.ok(Math.abs(top.point.y-.16)<1e-5);assert.ok(Math.abs(ground.point.y-(.16+context.prototypes[0].measuredBounds.minY))<1e-5);assert.ok(Math.abs(q.height-ground.point.y)<1e-6);
  }
 }finally{context?.dispose();material.dispose();}
});
test('gateway eligibility rejects malformed, off-level and physically unplaceable mouths',()=>{
 const [p,q]=diagonalCampus().ports;
 for(const bad of [{normal:[0,1,0]},{normal:[0,0,0]},{normal:[1,0,1]},{normal:[1,0]},{center:[0,3,0]},{center:[35,0,0]},{width:Infinity},{center:[0,0]}]){
  assert.throws(()=>api.createLandscapeContextDesign({gateways:[{...p,...bad},q]}),/gateway/i);
 }
});
test('one complete terrain position scan serves the street and every actual entrance',async t=>{
 const url=new URL('../../assets/examples/landscape-context.mjs',import.meta.url),key='terrain-reads-'+Math.random();
 const {createHeightFieldGeometry}=await import('../../assets/environment/height-field.mjs');
 const {writeFormationCoordinates}=await import('../../assets/geometry/formation-coordinates.mjs');
 const {prepareTerrainRoadSupport,createTerrainRoadSource}=await import('../../assets/environment/terrain-roads.mjs');
 const scans={formation:[],support:[]},borrowers=new Map();
 let terrain,support,active,ctx;
 function traceScan(kind,run){
  const previous=active;active=new Set();scans[kind].push(active);
  try{return run();}finally{active=previous;}
 }
 // Only the actual terrain position getter is observed. Each producer must visit
 // every vertex once; road construction or other unclassified reads cannot hide in either count.
 const hooks={
  createHeightFieldGeometry(...args){
   assert.equal(terrain,undefined);terrain=createHeightFieldGeometry(...args);
   const p=terrain.attributes.position,get=p.getX.bind(p);
   p.getX=i=>{assert.ok(active,'unexpected terrain scan outside formation/support');
    assert.ok(Number.isInteger(i)&&i>=0&&i<p.count&&!active.has(i),'each terrain vertex must be read once per scan');
    active.add(i);return get(i);};
   return terrain;
  },
  writeFormationCoordinates(runtime,g,...rest){
   const run=()=>writeFormationCoordinates(runtime,g,...rest);
   return g===terrain?traceScan('formation',run):run();
  },
  prepareTerrainRoadSupport(options){
   assert.equal(options.terrainGeometry,terrain);
   return support=traceScan('support',()=>prepareTerrainRoadSupport(options));
  },
  createTerrainRoadSource(runtime,options){
   assert.ok(support);assert.equal(options.terrainSupport,support);assert.equal(options.terrainGeometry,undefined);
   const road=createTerrainRoadSource(runtime,options);borrowers.set(road.geometry,road);return road;
  }
 };
 globalThis[key]=hooks;
 const source=(await readFile(url,'utf8')).replace(/import \{([^}]+)\} from '([^']+)';/g,(_,list,path)=>{
  const names=list.split(',').map(s=>s.trim()),wrapped=names.filter(n=>Object.hasOwn(hooks,n)),other=names.filter(n=>!wrapped.includes(n));
  return (other.length?'import {'+other.join(',')+'} from '+JSON.stringify(new URL(path,url).href)+';':'')+
    (wrapped.length?'const {'+wrapped.join(',')+'}=globalThis['+JSON.stringify(key)+'];':'');
 });
 const material=new T.MeshStandardMaterial();
 try{
  const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  ctx=module.buildLandscapeContext(T,{mergeGeometries,materialFor:()=>material});
  assert.equal(ctx.terrain.geometry,terrain);const count=terrain.attributes.position.count;
  for(const kind of ['formation','support'])assert.deepEqual(scans[kind].map(s=>s.size),[count],kind+' must scan the entire terrain once');
  assert.deepEqual(terrain.attributes.aFormationPosition.array,terrain.attributes.position.array);
  assert.ok(ctx.sites.length>1);assert.equal(borrowers.get(ctx.roads.geometry),ctx.roads);
  assert.equal(borrowers.size,1+ctx.sites.length);
  for(const site of ctx.sites)assert.ok(borrowers.has(site.route.mesh.geometry),site.id);
  t.diagnostic('distinct terrain vertices: formation='+scans.formation[0].size+', support='+scans.support[0].size+
   '; shared support: 1 street + '+ctx.sites.length+' entrances');
 }finally{ctx?.dispose();delete globalThis[key];material.dispose();}
});

test('late context failure releases all road borrowers before the one terrain owner even when handles are retained',async()=>{
 const probe=await trackedFactory(),material=new T.MeshStandardMaterial();
 try{
  let arrivals=0;assert.throws(()=>probe.build(T,{mergeGeometries,materialFor(role,options){
   if(options?.baseColor===0xbcb49d&&++arrivals===4)throw Error('injected fourth road material failure');return material;
  }}),/injected fourth road material failure/);
  assert.equal(probe.roads.length,4);assert.equal(probe.supports.length,1);assert.deepEqual(probe.released,[...probe.roads].reverse().concat(probe.supports));
  for(const road of probe.roads)assert.throws(()=>road.query(0,0),/disposed/);
  const {createTerrainRoadSource}=await import('../../assets/environment/terrain-roads.mjs');
  assert.throws(()=>createTerrainRoadSource(T,{terrainSupport:probe.supports[0],surfaces:[]}),/disposed/);
 }finally{probe.close();material.dispose();}
});
test('context design accepts north/south and unequal oblique horizontal components',()=>{
 for(const [dx,dz]of [[0,1],[.8,.6]]){const gateways=[-1,1].map(sign=>({center:[0,0,sign*12],normal:[sign*dx,0,sign*dz],width:2.6}));
  const design=api.createLandscapeContextDesign({gateways}),layout=compileWorldLayout(design);for(const g of gateways){const p=layout.ports.find(p=>p.center[2]===g.center[2]);assert.ok(p);assert.ok(Math.abs(new T.Vector3(...p.normal).dot(new T.Vector3(...g.normal))+1)<1e-10);}
 }
});

test('formation data tracks one measured source part through two real context lot poses and one shared clay',()=>{
 const c=setup(),ctx=c.context,table=Map.groupBy(ctx.sites,s=>s.prototypeId);
 let asset;
 try{
  for(const {object} of ctx.materialBindings){const g=object.geometry,a=g.attributes.aFormationPosition;
   assert.equal(a?.count,g.attributes.position.count,object.name||'merged settlement group');assert.equal(a.itemSize,3);}
  const pair=[...table.values()].find(sites=>sites.some(s=>s.rotation!==sites[0].rotation))??[...table.values()].find(sites=>sites.length>1);assert.ok(pair);
  const proto=ctx.prototypes.find(p=>p.id===pair[0].prototypeId);
  asset=buildRegionalArchitecture(T,{...proto.spec,materialFor:()=>c.material});
  const deck=asset.parts.floors.find(o=>o.name.endsWith('entry.deck')),g=deck.geometry;
  const local=new T.Vector3().fromBufferAttribute(g.attributes.position,g.index.getX(g.groups[1].start+2));
  const slot=asset.materialBindings.find(b=>b.object===deck).slots[0];
  const outputs=ctx.materialBindings.filter(b=>b.slots.length===1&&b.slots[0].role===slot.role&&b.slots[0].options.baseColor===slot.options.baseColor);
  const peer=pair.find(s=>s.rotation!==pair[0].rotation)??pair[1];assert.notDeepEqual(pair[0].position,peer.position);
  for(const site of [pair[0],peer]){
   asset.root.position.fromArray(site.position);asset.root.rotation.y=site.rotation;asset.root.updateMatrixWorld(true);const world=deck.localToWorld(local.clone());
   const v=new T.Vector3();assert.ok(outputs.some(({object})=>{
    const {position,aFormationPosition}=object.geometry.attributes;
    for(let i=0;i<position.count;i++)if(v.fromBufferAttribute(position,i).distanceTo(world)<1e-5&&v.fromBufferAttribute(aFormationPosition,i).distanceTo(local)<1e-6)return true;
    return false;
   }),'same source vertex and semantic bucket must survive independently at each lot');
  }
 }finally{asset?.dispose();c.dispose();}
});

test('context inherits explicit frame slots and preserves actual per-lot frame source ranges after prototype retirement',()=>{
 const cache=new Map(),materialFor=(role,options,key)=>{const id=JSON.stringify([role,options,key]);if(!cache.has(id))cache.set(id,new T.MeshStandardMaterial());return cache.get(id);};
 const a=api.buildLandscapeContext(T,{mergeGeometries,materialFor});try{
  assert.ok(a.bakedBoundarySources?.length>100,'actual source identities survive prototype disposal');
  const slots=a.materialBindings.filter(b=>b.slots.some(s=>s.profileKey==='dressed-stock'));assert.ok(slots.length);
  const frames=a.bakedBoundarySources.filter(s=>s.semantic.profileKey==='dressed-stock');assert.ok(frames.length>100);
  for(const source of a.bakedBoundarySources){assert.ok(a.sites.some(s=>s.id===source.siteId));assert.ok(a.prototypes.some(p=>p.id===source.prototypeId));let vertices=0;for(const r of source.sourceRanges){const b=a.materialBindings.find(b=>b.object.uuid===r.objectId);assert.ok(b);assert.equal(b.object.geometry.uuid,r.geometryId);assert.equal(b.object.material,materialFor(source.semantic.role,source.semantic.options,source.semantic.profileKey));assert.ok(r.vertexStart+r.vertexCount<=b.object.geometry.attributes.position.count);vertices+=r.vertexCount;}assert.equal(vertices,source.triangleCount*3);}
  assert.equal(new Set(a.bakedBoundarySources.map(s=>s.id)).size,a.bakedBoundarySources.length);
  assert.ok(a.materialBindings.some(b=>b.slots.some(s=>s.role==='wood'&&s.profileKey===undefined)),'ordinary regional wood stays separate');
 }finally{a.dispose();for(const m of cache.values())m.dispose();}
});
