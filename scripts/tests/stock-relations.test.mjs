import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createAssetSlot} from '../../assets/runtime/asset-slot.mjs';
import {createLookPalette} from '../../assets/materials/look-palette.mjs';
import {createFormationPalette} from '../../assets/materials/formation-palette.mjs';
const T=await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href);
const design=JSON.parse(await readFile(new URL('../../assets/examples/stock-relations-design.json',import.meta.url),'utf8'));
let api;try{api=await import('../../assets/examples/stock-relations.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const vec=(a,b,e)=>a.forEach((v,i)=>near(v,b[i],e));
const borrowed=new T.MeshStandardMaterial();
function build(kind='B1',coordinateMode='stock',materialFor=()=>borrowed){assert.equal(typeof api?.buildStockRelation,'function','Missing complete stock-relation builder');return api.buildStockRelation(T,{kind,coordinateMode,materialFor});}
const ray=(mesh,origin,direction)=>{mesh.updateWorldMatrix(true,false);return new T.Raycaster(new T.Vector3(...origin),new T.Vector3(...direction).normalize()).intersectObject(mesh,false);};
function data(g){return {position:Array.from(g.attributes.position.array),normal:Array.from(g.attributes.normal.array),uv:Array.from(g.attributes.uv.array),index:g.index?Array.from(g.index.array):null,groups:g.groups};}
function volume(g){let v=0;const p=g.attributes.position,i=g.index;for(let k=0;k<(i?.count??p.count);k+=3){const q=[0,1,2].map(n=>new T.Vector3().fromBufferAttribute(p,i?i.getX(k+n):k+n));v+=q[0].dot(q[1].cross(q[2]))/6;}return v;}
function corners(g){const out=new Map();for(let k=0;k<g.index.count;k++){const i=g.index.getX(k),p=new T.Vector3().fromBufferAttribute(g.attributes.position,i).toArray(),q=new T.Vector3().fromBufferAttribute(g.attributes.aFormationPosition,i).toArray(),key=p.map(x=>x.toFixed(7)).join(',');if(!out.has(key))out.set(key,[]);out.get(key).push({i,p,q});}return out;}
for(const mode of ['stock','legacy']){
 test(`B1 ${mode}: solid board, actual four-edge bearing, open moulding and true back/side`,()=>{
  const h=build('B1',mode),{panel,frame}=h.parts;
  assert.equal(h.sources.length,1);assert.equal(frame.geometry,h.sources[0].geometry);assert.equal(ray(frame,[0,0,1],[0,0,-1]).length,0);
  near(volume(panel.geometry),.842*.462*.026,1e-8);near(ray(panel,[0,0,1],[0,0,-1])[0].point.z,0);near(ray(panel,[0,0,-1],[0,0,1])[0].point.z,-.026);
  near(ray(panel,[1,0,-.013],[-1,0,0])[0].point.x,.421);near(ray(frame,[0,-.255,1],[0,0,-1])[0].point.z,.0256);
  // Independently read emitted triangle/ray contact, all four 1 mm bearing strips.
  for(const xy of [[.4205,0],[-.4205,0],[0,.2305],[0,-.2305]]){
   near(ray(panel,[...xy,1],[0,0,-1])[0].point.z,0);
   near(ray(frame,[...xy,-1],[0,0,1])[0].point.z,0);
  }
  const g=panel.geometry;for(let i=0;i<g.attributes.position.count;i++)vec([g.attributes.aFormationPosition.getX(i),g.attributes.aFormationPosition.getY(i),g.attributes.aFormationPosition.getZ(i)],[g.attributes.position.getY(i),g.attributes.position.getZ(i),g.attributes.position.getX(i)]);
  assert.equal(h.materialBindings.length,2);h.dispose();
 });
 test(`B2 ${mode}: fitted solid polygon body, physical keeper and two radial bolt heads`,()=>{
  const h=build('B2',mode),{hoop,body,keeper,bolt0,bolt1}=h.parts;
  assert.equal(hoop.geometry,h.sources[0].geometry);assert.equal(ray(hoop,[0,0,1],[0,0,-1]).length,0);
  near(ray(body,[0,0,1],[0,0,-1])[0].point.z,.042);near(ray(body,[0,0,-1],[0,0,1])[0].point.z,-.016);
  assert.ok(volume(body.geometry)>.016,'body is a solid extrusion, not a ring');
  // Midpoint of a real polygon side: both physical surfaces meet at r=.3*cos(pi/40).
  const a=Math.PI/40,dir=[Math.cos(a),Math.sin(a),0],inside=ray(hoop,[0,0,.007],dir)[0],outside=ray(body,[dir[0],dir[1],.007],dir.map(x=>-x))[0];vec(inside.point.toArray(),outside.point.toArray());near(Math.hypot(inside.point.x,inside.point.y),.3*Math.cos(a));
  near(ray(keeper,[1,0,.013],[-1,0,0])[0].point.x,.340);
  const edge=ray(hoop,[1,.02,.006],[-1,0,0])[0].point.x;assert.ok(edge>.328&&edge<.340,'keeper actually penetrates outer hoop at both sides of joint');
  for(const [bolt,y]of [[bolt0,-.022],[bolt1,.022]]){near(ray(bolt,[1,y,.013],[-1,0,0])[0].point.x,.344);near(new T.Box3().setFromObject(bolt).min.x,.338);}
  assert.equal(h.materialBindings.length,5);h.dispose();
 });
}
test('frozen member cut lengths and emitted coordinate seams only at four real miter joints',()=>{
 const h=build(),g=h.parts.frame.geometry,records=corners(g);assert.equal(h.sources[0].metadata.contour.length,4);
 const q=g.attributes.aFormationPosition,p=g.attributes.position;
 // Distances measured on each actual outer rear edge: literal long/short cut lengths.
 for(const [a,b,expected] of [[[ -.47,-.28,0],[.47,-.28,0],.94],[[.47,-.28,0],[.47,.28,0],.56],[[.47,.28,0],[-.47,.28,0],.94],[[-.47,.28,0],[-.47,-.28,0],.56]]){
  const select=pt=>[...records.values()].find(v=>v[0].p.every((x,i)=>Math.abs(x-pt[i])<1e-7));const va=select(a),vb=select(b);assert.ok(va&&vb);near(new T.Vector3(...va[0].p).distanceTo(new T.Vector3(...vb[0].p)),expected);
 }
 let discontinuities=0;
 for(const list of records.values()){
  const values=[...new Map(list.map(x=>[x.q.map(v=>v.toFixed(6)).join(','),x])).values()];
  if(values.length>1){discontinuities++;for(const x of values)near(Math.abs(Math.abs(x.p[0])-.42),Math.abs(Math.abs(x.p[1])-.23));}
 }
 assert.ok(discontinuities>0);
 // An interior bottom-rail actual vertex measures z=x+.445 and across=-y-.255.
 let checked=0;for(let i=0;i<p.count;i++)if(p.getY(i)<-.23&&p.getX(i)>.4&&p.getX(i)<.46&&q.getZ(i)>.8){near(q.getZ(i),p.getX(i)+.445);near(q.getX(i),p.getY(i)+.255);checked++;}assert.ok(checked);h.dispose();
});
test('40-segment single rail uses 1.983756m developed station and exactly one covered seam',()=>{
 const h=build('B2'),g=h.parts.hoop.geometry,q=g.attributes.aFormationPosition;assert.equal(h.sources[0].metadata.contour.length,40);
 let seams=0;for(const list of corners(g).values()){
  const values=[...new Map(list.map(x=>[x.q.map(v=>v.toFixed(6)).join(','),x])).values()];
  if(values.length>1){seams++;assert.ok(values.every(x=>x.p[0]>.299&&Math.abs(x.p[1])<1e-7));const zs=values.map(x=>x.q[2]);near(Math.max(...zs)-Math.min(...zs),1.983756482203791,1e-6);}
 }
 assert.ok(seams>0);near(Math.min(...Array.from({length:q.count},(_,i)=>q.getZ(i))),0);near(Math.max(...Array.from({length:q.count},(_,i)=>q.getZ(i))),1.983756482203791);
 // At quarter turn all repeated profile corners share station 0.49593912, no per-face restart.
 let seen=0;for(let i=0;i<q.count;i++)if(Math.abs(g.attributes.position.getX(i))<1e-7&&g.attributes.position.getY(i)>.299){near(q.getZ(i),.49593912055);seen++;}assert.ok(seen>10);h.dispose();
});
for(const kind of ['B1','B2'])test(`${kind}: coordinate modes keep bit-identical shape, indices, groups and actual source queries`,()=>{
 const a=build(kind,'stock'),b=build(kind,'legacy');assert.deepEqual(Object.keys(a.parts),Object.keys(b.parts));for(const name of Object.keys(a.parts)){assert.deepEqual(data(a.parts[name].geometry),data(b.parts[name].geometry));}
 for(const u of [.023,.26,.53,.97])for(const v of [.017,.33,.76]){const x=a.sources[0].surfaceAt(u,v),y=b.sources[0].surfaceAt(u,v);vec(x.point.toArray(),y.point.toArray(),1e-12);vec(x.normal.toArray(),y.normal.toArray(),1e-12);assert.equal(x.triangleIndex,y.triangleIndex);}
 const target=kind==='B1'?'frame':'hoop';assert.notDeepEqual([...a.parts[target].geometry.attributes.aFormationPosition.array],[...b.parts[target].geometry.attributes.aFormationPosition.array]);
 const g=b.parts[target].geometry;assert.deepEqual([...g.attributes.position.array],[...g.attributes.aFormationPosition.array]);a.dispose();b.dispose();
});
test('material routing borrows actual instances with explicit base options/profile, non-targets remain original',()=>{
 const calls=[],m=new Map(),forMaterial=(role,options,key)=>{calls.push({role,options:structuredClone(options),key});const id=JSON.stringify([role,options,key]);if(!m.has(id))m.set(id,new T.MeshStandardMaterial());return m.get(id);};
 for(const kind of ['B1','B2']){const h=build(kind,'stock',forMaterial);for(const b of h.materialBindings){assert.ok(b.object.isMesh);assert.equal(b.slots.length,1);const s=b.slots[0];assert.equal(b.object.material,forMaterial(s.role,s.options,s.profileKey));if(s.role==='wood'){assert.equal(s.profileKey,'dressed-stock');assert.equal(s.options.baseColor,0xa88e65);}else{assert.equal(s.profileKey,undefined);assert.ok(['coating','metal'].includes(s.role));assert.deepEqual([...b.object.geometry.attributes.aFormationPosition.array],[...b.object.geometry.attributes.position.array]);}}h.dispose();}
 for(const material of m.values())material.dispose();assert.ok(calls.every(c=>!Object.hasOwn(c.options,'profileKey')));
});
test('every fixed camera ray hits actual target triangle, with live source and detached state',()=>{
 for(const kind of ['B1','B2']){const h=build(kind);for(const v of h.viewTasks){const c=new T.PerspectiveCamera(41,1280/720,.1,420);c.position.fromArray(v.position);c.lookAt(new T.Vector3(...v.target));c.updateMatrixWorld();const r=new T.Raycaster();r.setFromCamera(new T.Vector2(),c);const hit=r.intersectObject(h.root,true)[0];assert.ok(hit);assert.equal(hit.object.name,v.id==='joint'?'keeper':kind==='B1'?'frame':'hoop');assert.ok(Number.isInteger(hit.faceIndex));}
 const s=h.readState();s.kind='corrupt';assert.equal(h.readState().kind,kind);assert.doesNotThrow(()=>JSON.stringify(h.readState()));h.dispose();assert.throws(()=>h.sources[0].surfaceAt(.2,.3),/disposed/);}
});
test('invalid kind/mode/material and late lookup failures keep prior slot and release partial geometry',()=>{
 const parent=new T.Group(),slot=createAssetSlot(parent),old=slot.replace(s=>s.own(build()));
 for(const [kind,mode]of [['wrong','stock'],['B1','wrong']]){assert.throws(()=>slot.replace(s=>s.own(build(kind,mode))));assert.equal(slot.current,old);}
 const original=T.BufferGeometry.prototype.dispose,released=[];T.BufferGeometry.prototype.dispose=function(){released.push(this.uuid);return original.call(this);};
 try{assert.throws(()=>slot.replace(s=>s.own(build('B2','stock',role=>{if(role==='metal')throw Error('lookup missing');return borrowed;}))),/lookup missing/);assert.ok(released.length>=2);assert.equal(new Set(released).size,released.length);assert.throws(()=>build('B1','stock',()=>null),/material/i);}finally{T.BufferGeometry.prototype.dispose=original;}
 assert.equal(slot.current,old);assert.equal(slot.revision,1);assert.equal(parent.children.length,1);slot.dispose();
});
test('20 replacements and exit release each geometry exactly once, retain borrowed palette materials',()=>{
 const slot=createAssetSlot(new T.Group()),counts=new Map();let disposedMaterials=0;borrowed.addEventListener('dispose',()=>disposedMaterials++);
 for(let i=0;i<20;i++){const h=slot.replace(s=>s.own(build(i%2?'B1':'B2',i%3?'stock':'legacy')));for(const m of Object.values(h.parts)){assert.ok(!counts.has(m.geometry.uuid));counts.set(m.geometry.uuid,0);m.geometry.addEventListener('dispose',()=>counts.set(m.geometry.uuid,counts.get(m.geometry.uuid)+1));}}
 slot.dispose();slot.dispose();assert.equal(disposedMaterials,0);assert.ok([...counts.values()].every(n=>n===1));
});
test('single-factor profiles preserve old values and fixed midpoint; native A2 separates same base',()=>{
 assert.equal(typeof api?.createStockProfiles,'function');
 for(const look of ['pbr','toon']){const profiles=api.createStockProfiles(T,look),old=profiles.wood.parameters;assert.ok(Object.keys(profiles).length<=32);assert.deepEqual(old.wavelengths,[.024,.08,1.5]);assert.equal(old.heightAmplitude,.0003);assert.equal(old.warp,.4);
 const keys=['wood','lambda-x','color-gain','roughness','height','dressed-stock'];let prior=profiles[keys[0]].parameters;
 const fields=['wavelengths','colorLow,colorHigh','roughnessAmplitude','heightAmplitude','warp'];for(let i=1;i<keys.length;i++){const p=profiles[keys[i]].parameters;for(const name of ['wavelengths','colorLow','colorHigh','roughnessAmplitude','heightAmplitude','warp','seed'])if(!fields[i-1].split(',').includes(name))assert.deepEqual(p[name],prior[name]);assert.equal(p.seed,2941836582);assert.deepEqual(p.frameMatrix.elements,new T.Matrix4().elements);prior=p;}
 assert.deepEqual(profiles['dressed-stock'].parameters.colorLow,[.8684,.8416,.778]);assert.equal(profiles['dressed-stock'].parameters.roughnessAmplitude,look==='pbr'?.1:0);assert.equal(prior.heightAmplitude,.00012);assert.equal(prior.warp,.18);
 const neutral=profiles.neutral.parameters;assert.deepEqual(neutral.colorLow,[.935,.91,.85]);assert.deepEqual(neutral.colorLow,neutral.colorHigh);assert.equal(neutral.heightAmplitude,0);assert.equal(neutral.roughnessAmplitude,0);
 const base=createLookPalette(T,{mode:look,seed:42,resolution:128}),formed=createFormationPalette(T,{basePalette:base,profiles});const h=build('B2','stock',(r,o,k)=>formed.get(r,o,k));for(const b of h.materialBindings)assert.doesNotThrow(()=>formed.validateMesh(b.object));const o=h.materialBindings[0].slots[0].options;const m0=formed.get('wood',o),m6=formed.get('wood',o,'dressed-stock');assert.notEqual(m0,m6);const entries=formed.inspect().entries.filter(x=>x.role==='wood');assert.equal(new Set(entries.map(x=>x.baseMaterialUuid)).size,1);h.dispose();formed.dispose();base.dispose();
 }
});
test('public design is exact frozen input without changing source oracle records',()=>{
 assert.deepEqual(design.exactBRelations.map(x=>x.id),['B1','B2']);assert.deepEqual(design.exactBRelations[0].frame.charts.pieces.map(x=>x.stations.at(-1).s),[.89,.51,.89,.51]);assert.equal(design.exactBRelations[1].hoop.charts.pieces[0].segmentCount,40);assert.equal(design.renderConditions.fog,null);assert.equal(design.renderConditions.rig.shadowMapSize,1024);
});

test('native diagnostic controller: stages 1–6 and look/neutral swap materials on same geometry; 0↔1 replaces equal shape',()=>{
 assert.equal(typeof api?.createStockController,'function');
 const palettes=Object.fromEntries(['pbr','toon'].map(look=>{const base=createLookPalette(T,{mode:look,seed:42,resolution:128});return [look,{base,formed:createFormationPalette(T,{basePalette:base,profiles:api.createStockProfiles(T,look)})}];}));
 const scene=new T.Scene(),c=api.createStockController(T,{scene,palettes});try{
  assert.equal(c.readState().calibrationStep,6);assert.equal(c.readState().look,'pbr');const h=c.current;const uuids=h.readState().geometryUuids;
  c.setCalibrationStep(1);const s1=c.current;for(const step of [2,3,4,5,6]){c.setCalibrationStep(step);assert.equal(c.current,s1);assert.deepEqual(c.current.readState().geometryUuids,uuids);assert.equal(c.readState().calibrationStep,step);}
  c.setLook('toon');assert.equal(c.current,s1);c.setNeutral(true);assert.equal(c.current,s1);assert.equal(c.readState().neutral,true);assert.equal(c.readState().effectiveBindings[0].slots[0].effectiveProfileKey,'neutral');c.setNeutral(false);
  const fingerprint=c.readState().shapeHash;c.setCalibrationStep(0);assert.notEqual(c.current,s1);assert.equal(c.current.readState().coordinateMode,'legacy');assert.equal(c.readState().shapeHash,fingerprint);const zero=c.current;c.setCalibrationStep(1);assert.notEqual(c.current,zero);assert.equal(c.readState().shapeHash,fingerprint);
  c.rebuild({kind:'B2'});const body=c.current.parts.body,metal=c.current.parts.keeper,m0=metal.material,b0=body.material;for(const step of [2,3,4,5,6])c.setCalibrationStep(step);assert.equal(c.current.parts.body,body);assert.equal(body.material,b0);assert.equal(metal.material,m0);
  const prior=c.current,revision=c.readState().revision;assert.throws(()=>c.rebuild({kind:'bad'}));assert.equal(c.current,prior);assert.equal(c.readState().revision,revision);assert.throws(()=>c.setCalibrationStep(7));assert.equal(c.current,prior);assert.throws(()=>c.setLook('clay'));assert.equal(c.current,prior);
  // A missing effective profile fails all-slot qualification before replacing materials or geometry.
  const get=palettes.toon.formed.get;palettes.toon.formed.get=(role,o,k)=>{if(role==='metal')throw Error('candidate lookup');return get(role,o,k);};
  c.setLook('pbr');const stableMaterials=c.current.materialBindings.map(b=>b.object.material);assert.throws(()=>c.setLook('toon'),/candidate lookup/);assert.deepEqual(c.current.materialBindings.map(b=>b.object.material),stableMaterials);assert.equal(c.readState().look,'pbr');assert.equal(c.current,prior);palettes.toon.formed.get=get;
  assert.equal(scene.children.length,1);c.dispose();assert.equal(scene.children.length,0);assert.throws(()=>c.setCalibrationStep(1),/disposed/);assert.throws(()=>c.getRuntime(),/disposed/);
 }finally{c.dispose();for(const p of Object.values(palettes)){p.formed.dispose();p.base.dispose();}}
});

test('retirement cleanup errors preserve S01 committed new asset identity and diagnostic state',()=>{
 assert.equal(typeof api?.createStockController,'function');const palettes=Object.fromEntries(['pbr','toon'].map(look=>{const base=createLookPalette(T,{mode:look,seed:42,resolution:128});return [look,{base,formed:createFormationPalette(T,{basePalette:base,profiles:api.createStockProfiles(T,look)})}];}));const c=api.createStockController(T,{scene:new T.Scene(),palettes});
 try{c.current.parts.frame.geometry.addEventListener('dispose',()=>{throw Error('retirement probe');});assert.throws(()=>c.rebuild({kind:'B2'}),/cleanup/i);assert.equal(c.current.readState().kind,'B2');assert.equal(c.readState().kind,'B2');assert.equal(c.readState().revision,2);}finally{c.dispose();for(const p of Object.values(palettes)){p.formed.dispose();p.base.dispose();}}
});
