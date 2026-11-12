import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const doc=await readFile(new URL('../../references/wide-lines.md',import.meta.url),'utf8').catch(()=> '');
const source=doc.match(/```mjs\n([\s\S]*?)```/)?.[1];
test('document supplies executable native method',()=>assert.ok(source,'missing complete ESM'));
if(source){
const directory=await mkdtemp(new URL('.wide-line-method-',import.meta.url));
const file=pathToFileURL(directory+'/method.mjs');
let m;
try {await writeFile(file,source);m=await import(file.href);}
finally {await rm(directory,{recursive:true,force:true});}
const {THREE,createWideLine,prepareView,pickWideLine,editSegment,replacePositions,setWidthMode,closeWideLine}=m;
console.log('ESM SHA256',createHash('sha256').update(source).digest('hex'));
const camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,100);camera.position.z=5;camera.updateProjectionMatrix();
const view={left:0,top:0,width:400,height:400};
const pick=(l,x,y=0,v=view,range={})=>pickWideLine(l,camera,{clientX:v.left+v.width/2+x,clientY:v.top+v.height/2-y},v,range);
test('connected vs independent endpoints, live edits, bounds and local distances',()=>{
 const a=createWideLine({positions:[0,0,0,1,0,0,1,2,0]});
 const b=createWideLine({positions:[0,0,0,1,0,0,3,0,0,3,2,0],segments:true});
 assert.equal(a.geometry.instanceCount,2);assert.equal(b.geometry.instanceCount,2);
 assert.equal(a.geometry.attributes.instanceEnd.getX(0),1);assert.equal(a.geometry.attributes.instanceEnd.getY(1),2);assert.equal(a.geometry.attributes.instanceStart.getX(1),1);assert.equal(b.geometry.attributes.instanceStart.getX(1),3);
 const version=b.geometry.attributes.instanceStart.data.version;
 editSegment(b,1,[4,0,0],[4,3,0]);
 assert.ok(b.geometry.attributes.instanceStart.data.version>version);
 assert.equal(b.geometry.attributes.instanceEnd.getY(1),3);
 assert.equal(b.geometry.attributes.instanceDistanceEnd.getX(1),4);
 assert.ok(b.geometry.boundingBox.containsPoint(new THREE.Vector3(4,3,0)));
 assert.ok(b.geometry.boundingSphere.containsPoint(new THREE.Vector3(4,3,0)));
 a.geometry.setPositions([0,0,0,0,4,0]);a.computeLineDistances();assert.equal(a.geometry.attributes.instanceDistanceEnd.getX(0),4);
 closeWideLine(a);closeWideLine(b);
});
test('fixed-count live edits preserve endpoint and distance buffer identities; replacement disposes attached old buffers',()=>{
 const l=createWideLine({positions:[0,0,0,1,0,0,1,2,0]});
 const old=l.geometry, endpoints=old.attributes.instanceStart.data;
 const distances=old.attributes.instanceDistanceStart.data, version=distances.version;
 for(const length of [3,4,5]) {
  editSegment(l,1,[1,0,0],[1,length,0]);
  assert.equal(l.geometry,old);
  assert.equal(old.attributes.instanceStart.data,endpoints);
  assert.equal(old.attributes.instanceEnd.data,endpoints);
  assert.equal(old.attributes.instanceDistanceStart.data,distances,'must not orphan uploaded distance buffer');
  assert.equal(old.attributes.instanceDistanceEnd.data,distances);
  assert.equal(old.attributes.instanceDistanceStart.getX(1),1);
  assert.equal(old.attributes.instanceDistanceEnd.getX(1),1+length);
 }
 assert.ok(distances.version>=version+3);
 let disposed=0;
 old.addEventListener('dispose',()=>{
  disposed++;
  assert.equal(old.attributes.instanceStart.data,endpoints,'old endpoints still attached at release');
  assert.equal(old.attributes.instanceDistanceStart.data,distances,'old distances still attached at release');
 });
 replacePositions(l,[0,0,0,0,2,0,3,2,0,3,6,0]);
 assert.equal(disposed,1);assert.notEqual(l.geometry,old);
 assert.equal(l.geometry.instanceCount,3);assert.equal(l.geometry.attributes.instanceDistanceEnd.getX(2),9);
 assert.ok(l.geometry.boundingBox.containsPoint(new THREE.Vector3(3,6,0)));
 const current=l.geometry;
 assert.throws(()=>replacePositions(l,[0,0,0,0,0,0]));assert.equal(l.geometry,current);
 closeWideLine(l);
});
test('pre-render active view resolution, 4/6 CSS pixels and stale/DPR counterexamples',()=>{
 const l=createWideLine({positions:[0,-1,0,0,1,0],width:10});
 for(const width of [400,800])for(const dpr of [1,2]){
  const v={...view,left:31,top:17,width};
  assert.equal(pick(l,4,0,v).length,1);assert.equal(pick(l,6,0,v).length,0);
  assert.deepEqual(l.material.resolution.toArray(),[width,400]);
  // DPR changes backing pixels, not this logical view contract.
  // The renderer backing extent can change independently of the supplied CSS rect.
  assert.equal(width*dpr/dpr,l.material.resolution.x);
 }
 prepareView(l,view);const ray=new THREE.Raycaster();camera.updateWorldMatrix(true,false);l.updateWorldMatrix(true,false);
 ray.setFromCamera(new THREE.Vector2(6/800*2,0),camera);ray.params.Line2={threshold:0};
 assert.equal(ray.intersectObject(l,false).length,1,'stale 400 resolution falsely accepts 6px in 800 view');
 assert.equal(pick(l,6,0,{...view,width:800}).length,0);
 ray.setFromCamera(new THREE.Vector2(4/800*2,0),camera);
 assert.equal(ray.intersectObject(l,false).length,1);
 l.material.resolution.set(1600,800);assert.equal(ray.intersectObject(l,false).length,0);
 assert.equal(pick(l,4,0,{...view,width:800}).length,1);
 l.visible=false;assert.equal(pick(l,4).length,1,'explicit hidden query prepares resolution');
 assert.equal(pick(l,6,0,view,{threshold:4}).length,1,'threshold adds to full width');
 assert.equal(pick(l,0,0,view,{near:6}).length,0);assert.equal(pick(l,0,0,view,{far:4}).length,0);
 closeWideLine(l);
});
test('world scalar width, parent transforms, hit anchors and define invalidation',()=>{
 const l=createWideLine({positions:[.3,-1,0,.3,1,0],width:.2,worldUnits:true});const p=new THREE.Group();p.add(l);
 for(const scale of [1,2]){p.scale.setScalar(scale);p.updateWorldMatrix(true,true);
  const center=.3*scale*100;const hit=pick(l,center+9)[0];assert.ok(hit);assert.equal(pick(l,center+11).length,0);
  assert.ok(Math.abs(hit.pointOnLine.x-.3*scale)<1e-6);assert.ok(hit.point.distanceTo(hit.pointOnLine)>.08);
 }
 const v=l.material.version;setWidthMode(l,false,10);assert.ok(l.material.version>v);assert.equal(l.material.worldUnits,false);
 closeWideLine(l);assert.equal(p.children.length,0);
});
test('native dash gap still picked; object scaling keeps geometry-local distance',()=>{
 const l=createWideLine({positions:[0,-1,0,0,1,0],width:10,dashed:true});
 l.material.dashSize=.5;l.material.gapSize=.5;
 const hit=pick(l,0,-25)[0];assert.ok(hit);const localD=hit.pointOnLine.y+1;
 assert.ok(localD%1>.5,'known shader gap');
 assert.equal(l.geometry.attributes.instanceDistanceEnd.getX(0),2);l.scale.setScalar(2);l.updateWorldMatrix(true,false);
 assert.equal(l.geometry.attributes.instanceDistanceEnd.getX(0),2);closeWideLine(l);
});
test('invalid inputs and disposal ownership',()=>{
 for(const positions of [[0,0,0],[0,0,0,0,0,0],[0,0,0,NaN,1,0]])assert.throws(()=>createWideLine({positions}));
 assert.throws(()=>createWideLine({positions:[0,0,0,1,0,0],width:0}));
 assert.throws(()=>createWideLine({positions:[0,0,0,1,0,0,2,0,0],segments:true}));
 const l=createWideLine({positions:[0,0,0,1,0,0]});let g=0,mat=0;l.geometry.addEventListener('dispose',()=>g++);l.material.addEventListener('dispose',()=>mat++);
 closeWideLine(l);assert.equal(g,1);assert.equal(mat,1);assert.equal(l.visible,false);
});
// Rejected edits/replacements must not mutate a single live identity or value.
const lineState=line=>{
 const g=line.geometry;
 return {g,attributes:{...g.attributes},data:Object.fromEntries(Object.entries(g.attributes).map(([k,a])=>[k,a.data??a])),
  values:JSON.stringify(Object.fromEntries(Object.entries(g.attributes).map(([k,a])=>[k,{array:[...(a.data??a).array],version:(a.data??a).version}]))),
  box:g.boundingBox.clone(),sphere:g.boundingSphere.clone(),instanceCount:g.instanceCount};
};
const sameLineState=(line,s)=>{
 assert.equal(line.geometry,s.g);assert.equal(line.geometry.instanceCount,s.instanceCount);
 for(const [k,a] of Object.entries(s.attributes)){assert.equal(line.geometry.attributes[k],a);assert.equal(a.data??a,s.data[k]);}
 assert.equal(lineState(line).values,s.values);assert.deepEqual(line.geometry.boundingBox,s.box);assert.deepEqual(line.geometry.boundingSphere,s.sphere);
};
test('review M1 endpoint arguments are exact triples before any live edit',()=>{
 const l=createWideLine({positions:[0,0,0,1,0,0]});let disposed=0;l.geometry.addEventListener('dispose',()=>disposed++);
 try {
  for(const [start,end] of [[[0,0],[1,2,3,4]],[[0,0,0,1],[1,2]],[[0,0,0],[1,2,3,4]],[[0,0],[1,2,3]]]) {
   const before=lineState(l);assert.throws(()=>editSegment(l,0,start,end),/endpoint/);sameLineState(l,before);assert.equal(disposed,0);
  }
 } finally {closeWideLine(l);}
});
for(const path of ['create','edit','replace']) for(const [reason,positions] of [
 ['Float32 collapse',[16777216,0,0,16777217,0,0]],
 ['Float32 overflow',[0,0,0,1e40,0,0]]
]) test(`review M1 ${path} rejects ${reason} before touching geometry`,()=>{
 for(const segments of [false,true]) {
  if(path==='create'){assert.throws(()=>createWideLine({positions,segments}),/endpoint|zero-length/);continue;}
  const l=createWideLine({positions:[0,0,0,1,0,0],segments});let disposed=0;l.geometry.addEventListener('dispose',()=>disposed++);
  try {const before=lineState(l);assert.throws(()=>path==='edit'?editSegment(l,0,positions.slice(0,3),positions.slice(3)):replacePositions(l,positions),/endpoint|zero-length/);sameLineState(l,before);assert.equal(disposed,0);}
  finally {closeWideLine(l);}
 }
});
test('review M1 typed coordinates are canonicalized consistently on all three paths',()=>{
 for(const segments of [false,true]) {
  const l=createWideLine({positions:new Float64Array([.1,0,0,1.1,0,0]),segments});
  try {
   assert.equal(l.geometry.attributes.instanceStart.getX(0),Math.fround(.1));
   const endpoints=l.geometry.attributes.instanceStart.data,distances=l.geometry.attributes.instanceDistanceStart.data;
   editSegment(l,0,new Float64Array([.2,0,0]),new Int16Array([2,0,0]));
   assert.equal(l.geometry.attributes.instanceStart.getX(0),Math.fround(.2));
   assert.equal(l.geometry.attributes.instanceStart.data,endpoints);assert.equal(l.geometry.attributes.instanceDistanceStart.data,distances);
   replacePositions(l,new Float64Array([.3,0,0,2.3,0,0]));
   assert.equal(l.geometry.attributes.instanceStart.getX(0),Math.fround(.3));assert.equal(l.geometry.attributes.instanceEnd.getX(0),Math.fround(2.3));
  } finally {closeWideLine(l);}
 }
});

}
