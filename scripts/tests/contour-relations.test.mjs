import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createAssetSlot} from '../../assets/runtime/asset-slot.mjs';
const T=await import(pathToFileURL(process.env.THREE_MODULE).href);
const design=JSON.parse(await readFile(new URL('../../assets/examples/contour-relations-design.json',import.meta.url),'utf8'));
const {createContourRelation}=await import('../../assets/examples/contour-relations.mjs');
const materials=()=>Object.fromEntries(['frame','panelDeck','attachment'].map(k=>[k,new T.MeshStandardMaterial()]));
const build=(id='opening-bearing',mode='profile',parameters={},m=materials())=>createContourRelation(T,{design,id,mode,parameters,materials:m});
const near=(a,b,e=2e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const vector=(a,b)=>a.forEach((v,i)=>near(v,b[i]));
function ray(mesh,origin,direction){mesh.updateWorldMatrix(true,false);return new T.Raycaster(new T.Vector3(...origin),new T.Vector3(...direction).normalize()).intersectObject(mesh,false);}
function bounds(mesh){mesh.geometry.computeBoundingBox();return mesh.geometry.boundingBox;}
function volume(g){const p=g.attributes.position,idx=g.index;let sum=0;for(let i=0;i<(idx?.count??p.count);i+=3){const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,idx?idx.getX(i+k):i+k));sum+=v[0].dot(v[1].cross(v[2]))/6;}return sum;}
for(const mode of ['plain','profile']){
 test(`B1 ${mode}: real through hole, finite panel/frame bearing, closed neighbor`,()=>{
  const h=build('opening-bearing',mode);const {frame,panel}=h.parts;
  assert.equal(ray(frame,[0,0,2],[0,0,-1]).length,0);assert.equal(ray(panel,[0,0,2],[0,0,-1]).length,0);
  assert.ok(ray(frame,[0,-.58,2],[0,0,-1]).length);assert.ok(ray(frame,[0,-.58,-2],[0,0,1]).length);
  assert.ok(ray(panel,[1.35,0,2],[0,0,-1]).length);assert.ok(ray(panel,[1.35,0,-2],[0,0,1]).length);
  near(bounds(panel).max.z,bounds(frame).min.z);near(volume(panel.geometry),(3*1.95-2)*.12);
  const hit=ray(panel,[0,-.58,1],[0,0,-1])[0];near(hit.point.z,-.1);
  const back=h.ports.query({contourSegment:0,t:.5,profileBand:0,s:.5});near(back.point.z,hit.point.z);
  assert.equal(frame.material,h.materialBindings[0].material);assert.equal(frame.material.side,T.FrontSide);h.dispose();
 });
 test(`B2 ${mode}: deck exactly meets inner boundary, actual recess and rotated underside`,()=>{
  const h=build('support-recess',mode),{frame,deck}=h.parts;
  near(bounds(deck).min.x,-.9);near(bounds(deck).max.y,.55);near(bounds(deck).max.z,-.035);near(bounds(frame).max.z-bounds(deck).max.z,.06);
  assert.ok(volume(deck.geometry)>0);assert.equal(ray(frame,[0,2,0],[0,-1,0]).length,0);
  const top=ray(deck,[0,2,0],[0,-1,0])[0],bottom=ray(deck,[0,-2,0],[0,1,0])[0];near(top.point.y,-.035);near(bottom.point.y,-.085);
  const side=ray(deck,[2,-.06,0],[-1,0,0])[0];near(side.point.x,.9);
  const q=h.ports.query({contourSegment:2,t:.5,profileBand:mode==='plain'?3:6,s:.5});near(q.point.x,.9);assert.ok(Math.abs(q.normal.x)>.99);h.dispose();
 });
}
test('plain/profile preserve envelope and neighbors; contact identity follows actual branch',()=>{
 const m=materials(),a=build('opening-bearing','plain',{},m),b=build('opening-bearing','profile',{},m);
 vector(bounds(a.parts.frame).min.toArray(),bounds(b.parts.frame).min.toArray());vector(bounds(a.parts.frame).max.toArray(),bounds(b.parts.frame).max.toArray());
 assert.deepEqual([...a.parts.panel.geometry.attributes.position.array],[...b.parts.panel.geometry.attributes.position.array]);
 assert.notEqual(a.parts.frame.geometry.attributes.position.count,b.parts.frame.geometry.attributes.position.count);
 assert.equal(a.readState().anchors.attachment.id,b.readState().anchors.attachment.id);near(a.readState().anchors.attachment.point[2],.08);near(b.readState().anchors.attachment.point[2],.065);
 assert.equal(a.parts.frame.material,b.parts.frame.material);a.dispose();b.dispose();
});
test('actual triangle query and full asset-root/world composition place attachment base',()=>{
 const h=build(),spec=design.examples[0].attachment,q=h.ports.query(spec,'source');
 const p=ray(h.parts.frame,q.point.clone().addScaledVector(q.normal,.1).toArray(),q.normal.clone().negate().toArray())[0];vector(p.point.toArray(),q.point.toArray());
 h.root.position.set(2,3,-1);h.root.rotation.set(.31,.52,-.2);h.root.scale.set(1.2,.8,1.1);h.root.updateMatrixWorld(true);
 const actual=h.ports.query(spec,'world'),expected=q.point.clone().applyMatrix4(h.root.matrixWorld);vector(actual.point.toArray(),expected.toArray());
 const normal=q.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(h.root.matrixWorld));vector(actual.normal.toArray(),normal.toArray());
 const base=new T.Vector3(0,0,-h.readState().attachmentHeight/2).applyMatrix4(h.parts.attachment.matrixWorld);vector(base.toArray(),expected.toArray());
 const expectedFrame=new T.Matrix4().multiplyMatrices(h.root.matrixWorld,q.frame);vector(actual.frame.toArray(),expectedFrame.toArray());
 const b2=build('support-recess');b2.root.position.set(3,-2,1);b2.root.rotation.set(.2,.4,.1);b2.root.updateMatrixWorld(true);
 const spec2={contourSegment:0,t:.4,profileBand:4,s:.5},s=b2.ports.query(spec2,'source'),w=b2.ports.query(spec2,'world');
 vector(w.point.toArray(),s.point.clone().applyMatrix4(b2.parts.axes.matrixWorld).toArray());vector(w.frame.toArray(),new T.Matrix4().multiplyMatrices(b2.parts.axes.matrixWorld,s.frame).toArray());h.dispose();b2.dispose();
});
test('independent structural parameters alter actual geometry; snapshots cannot change consumers',()=>{
 const h=build('opening-bearing','profile',{spanX:1.2,spanY:.8,sectionWidth:1.3,sectionHeight:1.4});
 near(bounds(h.parts.frame).max.x,1.2+.16*1.3);near(bounds(h.parts.frame).max.y,.5*.8+.16*1.3);near(bounds(h.parts.panel).max.z,-.1*1.4);
 const state=h.readState(),before=h.ports.query(design.examples[0].attachment).point.toArray();state.parameters.spanX=9;state.contour[0][0]=9;state.anchors.attachment.point[0]=999;
 assert.equal(h.readState().parameters.spanX,1.2);vector(h.ports.query(design.examples[0].attachment).point.toArray(),before);assert.doesNotThrow(()=>JSON.stringify(h.readState()));h.dispose();
});
test('failed candidates retain live slot, release partial resources and borrow shared materials',()=>{
 const parent=new T.Group(),slot=createAssetSlot(parent),m=materials();let materialDisposals=0;Object.values(m).forEach(x=>x.addEventListener('dispose',()=>materialDisposals++));
 const initial=slot.replace(scope=>scope.own(build('opening-bearing','profile',{},m))),oldId=initial.parts.frame.geometry.uuid;
 assert.throws(()=>slot.replace(scope=>scope.own(build('opening-bearing','profile',{sectionWidth:0},m))));assert.equal(slot.revision,1);assert.equal(slot.current.parts.frame.geometry.uuid,oldId);
 let geometries=0;const dispose=T.BufferGeometry.prototype.dispose;T.BufferGeometry.prototype.dispose=function(){geometries++;return dispose.call(this);};
 try{const invalid=structuredClone(design);invalid.examples[0].attachment.expectNormal=[0,0,-1];assert.throws(()=>createContourRelation(T,{design:invalid,materials:m}));}finally{T.BufferGeometry.prototype.dispose=dispose;}
 assert.ok(geometries>=2,'late failure releases generated source and panel');
 for(let i=0;i<10;i++)slot.replace(scope=>scope.own(build('support-recess',i%2?'profile':'plain',{},m)));
 assert.equal(parent.children.length,1);slot.dispose();slot.dispose();assert.equal(parent.children.length,0);assert.equal(materialDisposals,0);
});
test('disposal owns every generated geometry exactly once and closes actual queries',()=>{
 const h=build(),counts=new Map();for(const p of Object.values(h.parts))if(p.isMesh){counts.set(p.geometry.uuid,0);p.geometry.addEventListener('dispose',()=>counts.set(p.geometry.uuid,counts.get(p.geometry.uuid)+1));}
 h.dispose();h.dispose();assert.ok([...counts.values()].every(n=>n===1));assert.throws(()=>h.ports.query(design.examples[0].attachment),/disposed/);assert.equal(h.readState().disposed,true);
});
test('finite fixture rejects narrow positive section and short contour combinations before slot commit',()=>{
 const parent=new T.Group(),slot=createAssetSlot(parent),m=materials();const old=slot.replace(s=>s.own(build('opening-bearing','profile',{},m)));
 for(const parameters of [{sectionWidth:.2},{spanX:.001,sectionWidth:.5},{spanX:.05,spanY:.05,sectionWidth:2}]){
  assert.throws(()=>slot.replace(s=>s.own(build('opening-bearing','profile',parameters,m))),/finite|bearing|footprint/i);
  assert.equal(slot.current,old);assert.equal(slot.revision,1);
 }
 slot.dispose();
});
test('accepted finite fixture footprints contact actual frame at all corners across both branches',()=>{
 for(const mode of ['plain','profile'])for(const parameters of [{},{sectionWidth:.5,spanX:.2,spanY:.5},{sectionWidth:1.2,spanX:1.3,sectionHeight:.6}]){
  const h=build('opening-bearing',mode,parameters),a=h.parts.attachment,q=h.ports.query(mode==='plain'?design.examples[0].controlAttachment:design.examples[0].attachment,'source');
  for(const x of [-.009,.009])for(const y of [-.0125,.0125]){
   const corner=new T.Vector3(x,y,-h.readState().attachmentHeight/2).applyMatrix4(a.matrix);
   const hit=ray(h.parts.frame,corner.clone().addScaledVector(q.normal,.2).toArray(),q.normal.clone().negate().toArray())[0];
   assert.ok(hit);vector(hit.point.toArray(),corner.toArray());
  }
  h.dispose();
 }
});
test('parameter own-key validation rejects constructor and nonenumerable/symbol unknowns',()=>{
 for(const parameters of [{constructor:1},Object.defineProperty({},'unregistered',{value:1}),{[Symbol('unregistered')]:1}])assert.throws(()=>build('opening-bearing','profile',parameters),/Unknown structural parameter/);
});
