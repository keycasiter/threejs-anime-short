import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { qualifyActivityCourt as qualify } from '../../assets/scene/activity-court.mjs';
import { compileWorldLayout } from '../../assets/scene/world-layout.mjs';

const T=await import(pathToFileURL(process.env.THREE_MODULE));
assert.equal(T.REVISION,'180','CPU fixtures use the locked real Three r180');
const rect=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]];
const approx=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const vector=(a,b)=>b.forEach((v,i)=>approx(a[i],v));
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2);
const key=(a,b)=>JSON.stringify([a,b].sort());

// Fixture-only traversal: actual indexed Box/Extrude triangles, no renderer or A helpers.
function triangles(geometry,up=true){
 const p=geometry.attributes.position,idx=geometry.index,out=[];
 for(let i=0;i<(idx?.count??p.count);i+=3){
  const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,idx?idx.getX(i+k):i+k));
  const ny=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).y;
  if(up?ny>1e-12:ny< -1e-12)out.push({id:`t${i/3}`,p:v.map(x=>x.toArray())});
 }
 return out;
}
function floorFaces(holes=[]){
 const s=new T.Shape();s.moveTo(-20,-20);s.lineTo(20,-20);s.lineTo(20,20);s.lineTo(-20,20);s.closePath();
 for(const r of holes){const h=new T.Path();h.moveTo(...r[0]);for(const p of r.slice(1))h.lineTo(...p);h.closePath();s.holes.push(h);}
 const g=new T.ExtrudeGeometry(s,{depth:.1,bevelEnabled:false});g.rotateX(Math.PI/2);
 const faces=triangles(g);g.dispose();return faces;
}
function boxPrototype(){
 const prototypeOwner=Object.freeze({}),g=new T.BoxGeometry(2,1,1);g.translate(0,.5,0);
 const bearings=triangles(g,false).map(f=>({prototypeOwner,ring:f.p.map(p=>[p[0],p[2]]),bottomY:0}));g.dispose();
 return {id:'p',prototypeOwner,envelope:[-1,0,-.5,1,1,.5],parts:[{id:'body',prototypeOwner,box:[-1,0,-.5,1,1,.5]}],bearings,
  ports:[{id:'front',prototypeOwner,position:[0,0,-.5],servicePosition:[0,.8,-.5],normal:[0,0,-1],width:1.2,kind:'serve',facePartId:'body',witness:[[-.6,.8,-.5],[.6,.8,-.5]]}]};
}
function realBlock(owner,id,[x0,y0,z0,x1,y1,z1]){
 const g=new T.BoxGeometry(x1-x0,y1-y0,z1-z0);g.translate((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);g.computeBoundingBox();
 const {min,max}=g.boundingBox,result={owner,id,polygon:rect(min.x,min.z,max.x,max.z),yMin:min.y,yMax:max.y};g.dispose();return result;
}
function measuredFeet(f,heights,lift=0){
 const p=f.prototypes[0],token=p.prototypeOwner;p.parts[0].box=[-1,.2,-.5,1,Math.max(1,...heights),.5];p.bearings=[];
 heights.forEach((height,i)=>{
  const x=i? .8:-.8,g=new T.BoxGeometry(.2,height,1);g.translate(x,height/2+(i?lift:0),0);g.computeBoundingBox();const b=g.boundingBox;
  p.parts.push({id:`foot${i}`,prototypeOwner:token,box:[...b.min.toArray(),...b.max.toArray()]});
  p.bearings.push(...triangles(g,false).map(t=>({prototypeOwner:token,ring:t.p.map(v=>[v[0],v[2]]),bottomY:t.p[0][1]})));g.dispose();
 });
 p.envelope=[-1,Math.min(...p.parts.map(v=>v.box[1])),-.5,1,Math.max(...p.parts.map(v=>v.box[4])),.5];return f;
}
function crossFixture(){
 const f=fixture(),token=Object.freeze({}),parts=[],bearings=[],floor=[];
 for(const [id,w,h,d,x,y,z]of [['sill',2,.125,1,0,-.0625,0],['left',.25,2.25,1,-.875,1.125,0],['right',.25,2.25,1,.875,1.125,0],['lintel',2,.25,1,0,2.375,0]]){
  const g=new T.BoxGeometry(w,h,d);g.translate(x,y,z);g.computeBoundingBox();parts.push({id,prototypeOwner:token,box:[...g.boundingBox.min.toArray(),...g.boundingBox.max.toArray()]});
  if(id==='sill'){
   bearings.push(...triangles(g,false).map(t=>({prototypeOwner:token,ring:t.p.map(v=>[v[0],v[2]]),bottomY:-.125})));
   floor.push(...triangles(g).map(t=>({...t,p:t.p.map(([x,y,z])=>[x,y,z+3])})));
  }g.dispose();
 }
 f.prototypes=[{id:'p',prototypeOwner:token,envelope:[-1,-.125,-.5,1,2.5,.5],parts,bearings,ports:[{id:'front',prototypeOwner:token,position:[0,0,-.5],servicePosition:[0,0,-.5],witness:[[-.625,0,-.5],[.625,0,-.5]],normal:[0,0,-1],width:1.25,kind:'cross',facePartId:'sill'}]}];
 f.site.hostFaces[0].faces=flatRect(-20,-20,20,2.5);f.site.hostFaces.push({owner:f.site.owner,id:'under',faces:flatRect(-1,2.5,1,3.5,-.125)},{owner:f.site.owner,id:'sill-floor',faces:floor});f.recipe.hostScopes.push('under','sill-floor');f.recipe.members[0].bearingHost='under';
 f.recipe.nodes.push({id:'inside',uv:[0,3]});f.recipe.edges.push({a:'end',b:'inside',width:1.2,hostIds:['sill-floor']});f.recipe.requiredNodeIds=['inside'];return f;
}
function fixture(){
 const owner=Object.freeze({});
 const port=(id,z,normal)=>({owner,id,position:[0,0,z],servicePosition:[0,0,z],normal,width:1.2,kind:'cross',witness:[[-.6,0,z],[.6,0,z]]});
 const layout=compileWorldLayout({levels:[{id:'g',y:17,nodes:[],edges:[]}],regions:[{id:'yard',level:'g',role:'buildable',outline:rect(-20,-20,20,20)}]});
 return {id:'court',frame:{owner,origin:[0,0],yawRadians:0},prototypes:[boxPrototype()],
  recipe:{members:[{id:'m',prototypeId:'p',uv:[0,3],yawRadians:0,bearingHost:'floor',regionId:'yard'}],nodes:[{id:'gate',uv:[0,0]},{id:'end',memberId:'m',portId:'front'}],edges:[{a:'gate',b:'end',width:1.2,hostIds:['floor']}],gateId:'gate',requiredNodeIds:['end'],reserves:[],hostScopes:['floor']},
  site:{owner,layout,level:'g',groupId:'grp',lotId:null,edgeId:'street',regionId:'yard',hostFaces:[{owner,id:'floor',faces:floorFaces()}],blocks:[],reservedSolids:[],arrival:{owner,startId:'source',sourcePort:port('source',-2,[0,0,1]),gatePort:port('gate',0,[0,0,-1]),nodes:[],edges:[{a:'source',b:'gate',width:1.2,headroom:2.1,hostIds:['floor']}]}}};
}
const reject=(f,code)=>{const r=qualify(f);assert.equal(r.status,'unsatisfied');assert.equal(r.snapshot,null);assert.equal(r.diagnostics.reasons[0].code,code);assert.ok(r.diagnostics.reasons[0].ownerId);return r;};
function flatRect(x0,z0,x1,z1,y=0,prefix='f'){
 return [{id:`${prefix}0`,p:[[x0,y,z0],[x0,y,z1],[x1,y,z1]]},{id:`${prefix}1`,p:[[x0,y,z0],[x1,y,z1],[x1,y,z0]]}];
}
function transformFixture(f,origin,yaw){
 const c=Math.cos(yaw),s=Math.sin(yaw),p=([x,y,z])=>[origin[0]+c*x+s*z,y,origin[1]-s*x+c*z];
 f.frame.origin=origin;f.frame.yawRadians=yaw;
 for(const port of [f.site.arrival.sourcePort,f.site.arrival.gatePort]){port.position=p(port.position);port.servicePosition=p(port.servicePosition);port.witness=port.witness.map(p);const [x,y,z]=port.normal;port.normal=[c*x+s*z,y,-s*x+c*z];}
 return f;
}

// A center-only implementation, nominal level.y, or a metadata receipt fails these literals.
test('one real candidate derives member poses, distinct port facts, complete widths and stable graph',()=>{
 const f=fixture(),before=JSON.stringify(f),r=qualify(f);
 assert.equal(r.status,'complete');assert.equal(JSON.stringify(f),before);
 const s=r.snapshot,m=s.members[0],p=m.worldPorts[0];
 vector(m.position,[0,0,3]);assert.equal(m.rotationY,0);approx(area(m.footprint),2);
 vector(p.anchorPosition,[0,0,2.5]);vector(p.servicePosition,[0,.8,2.5]);vector(p.standingPosition,[0,0,2.5]);
 approx(m.supportMinY,0);approx(m.supportMaxY,0);assert.equal(s.routes.length,2);
 const route=s.routes.find(x=>key(x.a,x.b)===key('end','gate'));approx(area(route.polygon),3);assert.equal(route.minHeadroom,2.1);approx(route.maxGrade,0);approx(route.maxStep,0);assert.ok(route.faceIds.length);
 assert.deepEqual(s.chains,[{nodeId:'end',fromGate:[key('end','gate')]}]);assert.deepEqual(s.linkEdges,[key('end','gate'),key('gate','source')].sort());
 assert.ok(Object.isFrozen(s)&&Object.isFrozen(p.witness));assert.throws(()=>{p.witness[0][0]=10;},TypeError);
 assert.ok(!JSON.stringify(s).includes('prototypeOwner'));f.prototypes[0].ports[0].servicePosition[1]=.9;approx(p.servicePosition[1],.8);
});

test('rigid 90 degree and oblique frames follow independent numerical poses and preserve world arrival facts',()=>{
 const right=qualify(transformFixture(fixture(),[7,9],Math.PI/2));assert.equal(right.status,'complete');
 vector(right.snapshot.members[0].position,[10,0,9]);vector(right.snapshot.members[0].worldPorts[0].servicePosition,[9.5,.8,9]);
 const slant=qualify(transformFixture(fixture(),[5,6],Math.PI/3));assert.equal(slant.status,'complete');
 vector(slant.snapshot.members[0].position,[7.598076211353316,0,7.5]);
 vector(slant.snapshot.members[0].worldPorts[0].normal,[-.8660254037844386,0,-.5]);
});

test('all author input orders normalize identically and calls do not cache old host elevations',()=>{
 const f=fixture(),a=qualify(f),b=fixture();
 b.recipe.members.reverse();b.recipe.nodes.reverse();b.recipe.edges.reverse();b.site.hostFaces.reverse();b.site.hostFaces[0].faces.reverse();b.prototypes[0].parts.reverse();b.prototypes[0].bearings.reverse();
 assert.deepEqual(qualify(b).snapshot,a.snapshot);
 b.site.hostFaces[0].faces.forEach(f=>f.p.forEach(p=>p[1]+=.001));for(const p of [b.site.arrival.sourcePort,b.site.arrival.gatePort]){p.position[1]=.001;p.servicePosition[1]=.001;p.witness.forEach(v=>v[1]=.001);}
 const moved=qualify(b);assert.equal(moved.status,'complete');approx(moved.snapshot.members[0].position[1],.001);approx(a.snapshot.members[0].position[1],0);
});

test('region holes hidden inside full footprint and rotated complete envelope excursions reject',()=>{
 const f=fixture();f.site.layout=compileWorldLayout({levels:[{id:'g',y:0,nodes:[],edges:[]}],regions:[{id:'yard',level:'g',role:'buildable',outline:rect(-20,-20,20,20),holes:[rect(.2,2.8,.3,2.9)]}]});reject(f,'region');
 const g=fixture();g.prototypes[0].envelope=[-1,0,-.5,21,1,.5];reject(g,'region');
});

test('real Extrude hole under one bearing and a tiny fragment are not hidden by minFeature',()=>{
 const f=fixture();f.site.hostFaces[0].faces=floorFaces([rect(.35,2.85,.355,2.9)]);reject(f,'bearing-gap');
 const g=fixture();g.site.hostFaces[0].faces=floorFaces([rect(-.005,.9,.005,1)]);reject(g,'walk-gap');
});

test('full bearing extrema catch an internal ridge and multiple supporting layers',()=>{
 const f=fixture();f.site.hostFaces[0].faces=flatRect(-20,-20,20,20);
 // The foot interior contains a real high fan vertex, while its corners remain at zero.
 const ring=[[-1,2.5],[1,2.5],[1,3.5],[-1,3.5]],center=[.4,.004,3.1];
 f.site.hostFaces[0].faces=floorFaces([ring]).concat(ring.map((p,i)=>({id:`ridge${i}`,p:[[p[0],0,p[1]],center,[...ring[(i+1)%4].slice(0,1),0,ring[(i+1)%4][1]]]})));
 // Ensure positive Y winding independently.
 for(const t of f.site.hostFaces[0].faces){const [a,b,c]=t.p;if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<0)t.p.reverse();}
 reject(f,'bearing-tilt');
 const g=fixture();g.site.hostFaces[0].faces.push(...flatRect(-1,2.5,1,3.5,.01,'upper'));reject(g,'bearing-gap');
});

test('walking proof rejects internal cracks, point contacts, and equal missing plus duplicated area',()=>{
 for(const gap of [.02,.000001]){const f=fixture();f.site.hostFaces[0].faces=floorFaces([rect(-1,1,1,1+gap)]);reject(f,'walk-gap');}
 const f=fixture();f.site.hostFaces[0].faces=floorFaces([rect(-.6,.5,0,1.5)]).concat(flatRect(0,.5,.6,1.5,0,'dup'));reject(f,'walk-overlap');
 const g=fixture();g.site.hostFaces[0].faces=flatRect(-20,-20,0,1).concat(flatRect(0,1,20,20,0,'other'));reject(g,'bearing-gap');
});

test('a representable positive slit smaller than matching tolerance never receives coverage',()=>{
 const f=fixture();f.site.hostFaces[0].faces=flatRect(-20,-20,20,1,0,'a').concat(flatRect(-20,1+1e-12,20,20,0,'b'));
 const r=qualify(f);assert.equal(r.status,'unsatisfied');assert.ok(['walk-gap','precision'].includes(r.diagnostics.reasons[0].code));
});

test('full seams reject a high middle segment even with correct outer endpoints',()=>{
 const f=fixture();f.site.hostFaces[0].faces=flatRect(-20,-20,20,1,0,'south').concat(flatRect(-20,1,-.2,20,0,'left'),flatRect(.2,1,20,20,0,'right'),flatRect(-.2,1,.2,2,.03,'bump'),flatRect(-.2,2,.2,20,0,'north'));reject(f,'seam-step');
});

test('grade is evaluated on every intersecting face, not just route centers',()=>{
 const f=fixture();f.site.hostFaces[0].faces.forEach(t=>t.p.forEach(p=>p[1]=p[2]*.081));reject(f,'bearing-tilt');
 const g=fixture();g.site.hostFaces.push({owner:g.site.owner,id:'walk',faces:flatRect(-20,-20,20,20).map(t=>({...t,p:t.p.map(([x,y,z])=>[x,.081*z,z])}))});g.recipe.hostScopes.push('walk');g.recipe.edges[0].hostIds=['walk'];g.site.arrival.edges[0].hostIds=['walk'];reject(g,'grade');
});

test('clearance checks edge pillars, low beams and permits a genuinely high eave',()=>{
 for(const [polygon,yMin,yMax,code]of [[rect(.58,.5,.7,1),0,3,'blocked-clearance'],[rect(-1,.5,1,1),2.05,2.3,'blocked-clearance'],[rect(-1,.5,1,1),2.20,2.3,null]]){
  const f=fixture();f.site.blocks.push({owner:f.site.owner,id:'obstacle',polygon,yMin,yMax});if(code)reject(f,code);else assert.equal(qualify(f).status,'complete');
 }
});

test('the same 2.08 actual aperture passes 2.00 and fails explicit or default 2.10',()=>{
 for(const [headroom,complete]of [[2,true],[2.1,false],[undefined,false]]){
  const f=fixture();f.site.blocks.push(realBlock(f.site.owner,'beam',[-1,2.08,-1.8,1,2.4,-.2]));f.site.arrival.edges[0].headroom=headroom??2.1;
  if(complete){const r=qualify(f);assert.equal(r.status,'complete');assert.equal(r.snapshot.routes.find(x=>x.a==='gate'&&x.b==='source').minHeadroom,2);}else reject(f,'blocked-clearance');
 }
 const f=fixture();f.site.blocks.push({owner:f.site.owner,id:'beam',polygon:rect(-1,.5,1,1),yMin:2.08,yMax:2.4});reject(f,'blocked-clearance');
 f.recipe.edges[0].headroom=2;assert.equal(qualify(f).status,'complete');
});

test('service source height remains distinct from the actual walking standing host',()=>{
 const f=fixture();f.site.hostFaces.push({owner:f.site.owner,id:'lower',faces:flatRect(-1,2.5,1,3.5,-.1,'low')});f.recipe.hostScopes.push('lower');f.recipe.members[0].bearingHost='lower';
 const r=qualify(f);assert.equal(r.status,'complete');const p=r.snapshot.members[0].worldPorts[0];vector(p.anchorPosition,[0,-.1,2.5]);vector(p.servicePosition,[0,.7,2.5]);vector(p.standingPosition,[0,0,2.5]);
});

test('width, facing direction, service through traffic and incorrect cross sill heights reject',()=>{
 const narrow=fixture();narrow.prototypes[0].ports[0].width=1.1;reject(narrow,'port-width');
 const back=fixture();back.prototypes[0].ports[0].normal=[0,0,1];reject(back,'port-face');
 const thru=fixture();thru.recipe.nodes.push({id:'after',uv:[0,4]});thru.recipe.edges.push({a:'end',b:'after',width:1,hostIds:['floor']});reject(thru,'port-face');
 const sill=fixture();sill.site.arrival.sourcePort.witness.splice(1,0,[0,.03,-2]);reject(sill,'seam-step');
 const wrongY=fixture();wrongY.site.arrival.sourcePort.position[1]=.03;reject(wrongY,'seam-step');
});

test('unused measured ports have null standingPosition without inventing a floor',()=>{
 const f=fixture(),p=f.prototypes[0].ports[0];f.prototypes[0].ports.push({...p,id:'unused'});const r=qualify(f);assert.equal(r.status,'complete');assert.equal(r.snapshot.members[0].worldPorts.find(p=>p.id==='unused').standingPosition,null);
});

test('an orthogonal bend proves its complete turn square and all declared loop edges',()=>{
 const f=fixture();f.recipe.nodes.splice(1,0,{id:'junction',uv:[0,.75]},{id:'bend',uv:[2,.75]},{id:'side',uv:[2,1.5]},{id:'last',uv:[0,1.5]});
 f.recipe.edges=[{a:'gate',b:'junction',width:1.2,hostIds:['floor']},{a:'junction',b:'bend',width:1.2,hostIds:['floor']},{a:'bend',b:'side',width:1.2,hostIds:['floor']},{a:'side',b:'last',width:1.2,hostIds:['floor']},{a:'last',b:'junction',width:1.2,hostIds:['floor']},{a:'last',b:'end',width:1.2,hostIds:['floor']}];
 const r=qualify(f);assert.equal(r.status,'complete');assert.equal(r.snapshot.linkEdges.length,7);
 f.site.hostFaces[0].faces=floorFaces([rect(2.1,.35,2.15,.4)]);const turn=reject(f,'walk-gap');assert.equal(turn.diagnostics.reasons[0].ownerId,'bend');
 f.site.hostFaces[0].faces=floorFaces([rect(1.85,1.1,2.15,1.2)]);reject(f,'walk-gap');
 const g=fixture();g.recipe.nodes.push({id:'slope',uv:[1,1]});g.recipe.edges.push({a:'gate',b:'slope',width:1,hostIds:['floor']});reject(g,'port-face');
});

test('negative space has a complete floor and clearance even when it overlaps a route',()=>{
 const f=fixture();f.recipe.reserves=[{id:'pause',polygon:rect(-2,.5,2,1.5),hostIds:['floor']}];assert.equal(qualify(f).status,'complete');
 f.site.blocks.push({owner:f.site.owner,id:'edge',polygon:rect(1.5,1,1.6,1.1),yMin:0,yMax:1});reject(f,'blocked-clearance');
 const g=fixture();g.site.reservedSolids.push({owner:g.site.owner,id:'kept',polygon:rect(-.1,2.9,.1,3.1)});reject(g,'occupied');
});

test('owner identity, complete envelopes, sparse nonfinite arrays, references and runtime limit schema are checked',()=>{
 const invalid=[f=>f.frame.owner={},f=>f.site.hostFaces[0].owner={},f=>f.site.arrival.sourcePort.owner={},f=>f.prototypes[0].parts[0].prototypeOwner={},f=>f.prototypes[0].envelope[3]=.5,f=>f.frame.origin[0]=NaN,f=>f.frame.origin=new Array(2),f=>f.recipe.edges[0].hostIds=['missing'],f=>f.site.hostFaces[0].faces[0].p.reverse(),f=>f.recipe.nodes[0].uv=[0,513],f=>f.limits={headroom:2},f=>f.limits={maxPairs:{default:1,max:2}},f=>f.limits={maxPairs:Infinity},f=>f.limits={maxPairs:1.5},f=>f.site.arrival.nodes.push({id:'source',position:[0,0,-2]})];
 for(const mutate of invalid){const f=fixture();mutate(f);assert.throws(()=>qualify(f),e=>(e instanceof TypeError||e instanceof RangeError)&&e.code==='invalid-input');}
});

test('work budget debits before combinations and before allocating a vast or dense bucket index',()=>{
 const f=fixture();f.limits={maxPairs:1};const b=reject(f,'budget');assert.ok(b.diagnostics.spentPairs<=1);
 const g=fixture();g.site.hostFaces[0].faces=Array.from({length:10},(_,i)=>({id:`huge${i}`,p:[[-512,0,-512],[-512,0,512],[512,0,512]]}));const r=reject(g,'budget');assert.ok(r.diagnostics.spentPairs<=1000000);
 const h=fixture();h.limits={maxPairs:100};h.site.hostFaces[0].faces=Array.from({length:500},(_,i)=>({id:`dense${i}`,p:[[0,0,0],[0,0,1],[1,0,1]]}));assert.ok(reject(h,'budget').diagnostics.spentPairs<=100);
});

test('runtime null is not an integer budget and measured ports cannot carry an old world owner',()=>{
 for(const mutate of [f=>f.limits={maxPairs:null},f=>f.prototypes[0].ports[0].owner={}]){const f=fixture();mutate(f);assert.throws(()=>qualify(f),e=>e.code==='invalid-input');}
});

test('a physically measured sub-minFeature aperture is retained and fails the requested width',()=>{
 const f=fixture(),p=f.prototypes[0].ports[0];p.width=.01;p.witness=[[-.005,.8,-.5],[.005,.8,-.5]];reject(f,'port-width');
});

test('both real sole plates matter independently of their bounding rectangle',()=>{
 const f=fixture(),p=f.prototypes[0],token=p.prototypeOwner;
 p.parts[0].box=[-1,.5,-.5,1,1,.5];p.bearings=[];
 for(const [id,x]of [['left',-.8],['right',.8]]){
  const g=new T.BoxGeometry(.2,.2,1);g.translate(x,.1,0);
  p.parts.push({id,prototypeOwner:token,box:[x-.1,0,-.5,x+.1,.2,.5]});
  p.bearings.push(...triangles(g,false).map(t=>({prototypeOwner:token,ring:t.p.map(v=>[v[0],v[2]]),bottomY:0})));g.dispose();
 }
 const result=qualify(f);assert.equal(result.status,'complete',JSON.stringify(result.diagnostics));f.site.hostFaces[0].faces=floorFaces([rect(.72,2.9,.725,3.1)]);reject(f,'bearing-gap');
});

test('only the expressly named host can support a gap; lower unrelated ground never patches it',()=>{
 const f=fixture();f.site.hostFaces[0].faces=floorFaces([rect(-1,.9,1,1.1)]);f.site.hostFaces.push({owner:f.site.owner,id:'ground',faces:flatRect(-20,-20,20,20,-.1,'below')});f.recipe.hostScopes.push('ground');reject(f,'walk-gap');
});

test('separate authorized hosts join across full width at .008m and reject a .009m step',()=>{
 for(const height of [.008,.009]){
  const f=fixture();f.site.hostFaces=[{owner:f.site.owner,id:'floor',faces:flatRect(-20,-20,20,0,0,'south')},{owner:f.site.owner,id:'upper',faces:flatRect(-20,0,20,20,height,'north')}];f.recipe.hostScopes.push('upper');f.recipe.members[0].bearingHost='upper';f.recipe.edges[0].hostIds=['upper'];
  if(height===.009)reject(f,'seam-step');else{const r=qualify(f);assert.equal(r.status,'complete');approx(r.snapshot.routes[0].maxStep,.008);}
 }
});

test('a hand-derived .05 plane supplies grade and standing Y without moving the flat-bearing member',()=>{
 const f=fixture();f.site.hostFaces.push({owner:f.site.owner,id:'incline',faces:flatRect(-20,-20,20,20).map(t=>({...t,p:t.p.map(([x,y,z])=>[x,.05*z,z])}))});f.recipe.hostScopes.push('incline');f.recipe.edges[0].hostIds=['incline'];f.site.arrival.edges[0].hostIds=['incline'];
 const p=f.site.arrival.sourcePort;p.position[1]=-.1;p.servicePosition[1]=-.1;p.witness.forEach(v=>v[1]=-.1);
 const r=qualify(f);assert.equal(r.status,'complete');const m=r.snapshot.members[0];approx(m.position[1],0);vector(m.worldPorts[0].standingPosition,[0,.125,2.5]);vector(m.worldPorts[0].servicePosition,[0,.8,2.5]);r.snapshot.routes.forEach(r=>approx(r.maxGrade,.05));
});

test('perturbing member pose, service facts, host, region and reserve changes the actual candidate or rejects',()=>{
 const moved=fixture();moved.recipe.members[0].uv=[1,3];moved.recipe.nodes.splice(1,0,{id:'a',uv:[0,1]},{id:'b',uv:[1,1]});moved.recipe.edges=[{a:'gate',b:'a',width:1.2,hostIds:['floor']},{a:'a',b:'b',width:1.2,hostIds:['floor']},{a:'b',b:'end',width:1.2,hostIds:['floor']}];const r=qualify(moved);assert.equal(r.status,'complete');vector(r.snapshot.members[0].position,[1,0,3]);vector(r.snapshot.members[0].worldPorts[0].standingPosition,[1,0,2.5]);
 const raised=fixture();raised.prototypes[0].ports[0].servicePosition[1]=.9;raised.prototypes[0].ports[0].witness.forEach(p=>p[1]=.9);const p=qualify(raised);assert.equal(p.status,'complete');approx(p.snapshot.members[0].worldPorts[0].servicePosition[1],.9);
 const bad=fixture();bad.prototypes[0].parts[0].box[4]=3;bad.prototypes[0].envelope[4]=3;bad.prototypes[0].ports[0].servicePosition[1]=2.2;bad.prototypes[0].ports[0].witness.forEach(p=>p[1]=2.2);reject(bad,'port-face');
});

test('complete member envelopes reject neighbors even when their open parts would not collide',()=>{
 const f=fixture();f.recipe.members.push({...f.recipe.members[0],id:'second',uv:[1.99,3]});reject(f,'occupied');
 const g=fixture();g.recipe.members.push({...g.recipe.members[0],id:'second',uv:[3,3]});assert.equal(qualify(g).status,'complete');
});

test('world intermediate Y and actual source/gate identity cannot be nominal substitutes',()=>{
 const f=fixture();f.site.arrival.nodes=[{id:'middle',position:[0,.02,-1]}];f.site.arrival.edges=[{a:'source',b:'middle',width:1.2,headroom:2.1,hostIds:['floor']},{a:'middle',b:'gate',width:1.2,headroom:2.1,hostIds:['floor']}];reject(f,'seam-step');
 const g=fixture();g.site.arrival.gatePort.id='elsewhere';assert.throws(()=>qualify(g),e=>e.code==='invalid-input');
});

test('unsupported oblique junction is attributed to the actual interior node',()=>{
 const f=fixture();f.recipe.nodes.splice(1,0,{id:'j',uv:[0,1]},{id:'k',uv:[1,1.2]},{id:'l',uv:[0,1.5]});f.recipe.edges=[['gate','j'],['j','k'],['k','l'],['l','end']].map(([a,b])=>({a,b,width:1.2,hostIds:['floor']}));const r=reject(f,'port-face');assert.equal(r.diagnostics.reasons[0].ownerId,'j');
});

test('proof output is finite, deterministic, detached, and not sensitive to semantic-looking names',()=>{
 const f=fixture();f.id='configuration-exchange';f.recipe.members[0].id='exhibit';f.recipe.nodes[1].memberId='exhibit';f.prototypes[0].id='gallery';f.recipe.members[0].prototypeId='gallery';const a=qualify(f),b=qualify(f);assert.equal(a.status,'complete');assert.deepEqual(a,b);
 function scan(x){if(typeof x==='number')assert.ok(Number.isFinite(x));else if(x&&typeof x==='object')Object.values(x).forEach(scan);}scan(a);
});

test('point-connected walk triangles do not provide the requested full width',()=>{
 const f=fixture();f.site.hostFaces.push({owner:f.site.owner,id:'pinch',faces:[...flatRect(-.6,-3,.6,0,0,'s'),...flatRect(-.6,2,.6,3,0,'n'),{id:'tip0',p:[[-.6,0,0],[0,0,1],[.6,0,0]]},{id:'tip1',p:[[0,0,1],[-.6,0,2],[.6,0,2]]}]});f.recipe.hostScopes.push('pinch');f.recipe.edges[0].hostIds=['pinch'];f.site.arrival.edges[0].hostIds=['pinch'];reject(f,'walk-gap');
});

test('malformed record objects fail with the stable contract code rather than native incidental errors',()=>{
 for(const mutate of [f=>f.recipe.reserves=[null],f=>f.site.blocks=[null],f=>f.site.reservedSolids=[null],f=>f.site.arrival.nodes=[null],f=>f.recipe.edges=[null]]){const f=fixture();mutate(f);assert.throws(()=>qualify(f),e=>e.code==='invalid-input');}
});

test('Float32 bottoms from different actual Box heights solve one rigid pose without replacing the measured datum',()=>{
 const f=measuredFeet(fixture(),[.2,.33]),r=qualify(f);assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));
 // IEEE-754 Float32 Box positions after the real .10/.165 translations.
 const measured=[-1.4901161415892261e-9,-6.556510889765832e-9];
 f.prototypes[0].bearings.forEach((b,i)=>approx(b.bottomY,measured[Math.floor(i/2)],1e-20));
 const y=r.snapshot.members[0].position[1];approx(y,4.023313515677529e-9,1e-12);
 for(const b of f.prototypes[0].bearings)assert.ok(Math.abs(y+b.bottomY)<=.0015);
 approx(r.snapshot.members[0].supportMinY,0);approx(r.snapshot.members[0].supportMaxY,0);
});

test('datum equivalence scales with actual envelope quantization and rejects genuinely unequal flat soles',()=>{
 const scaled=measuredFeet(fixture(),[12.3,32.7]),r=qualify(scaled);assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));
 for(const b of scaled.prototypes[0].bearings)assert.ok(Math.abs(r.snapshot.members[0].position[1]+b.bottomY)<=.0015);
 const unequal=measuredFeet(fixture(),[.2,.33],.00001);assert.throws(()=>qualify(unequal),e=>e.code==='invalid-input');
});

test('a real measured cross sill permits its own floor while its jambs and lintel retain clearance duties',()=>{
 const f=crossFixture(),r=qualify(f);assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));vector(r.snapshot.members[0].worldPorts[0].standingPosition,[0,0,2.5]);
 const low=crossFixture();low.prototypes[0].parts.find(p=>p.id==='lintel').box[1]=2.05;reject(low,'blocked-clearance');
 const pillar=crossFixture();pillar.prototypes[0].parts.find(p=>p.id==='left').box[3]=-.55;reject(pillar,'blocked-clearance');
});

test('world bounds apply to derived roofs and rotated reserve corners as well as input points',()=>{
 const tall=fixture();tall.site.hostFaces[0].faces.forEach(f=>f.p.forEach(p=>p[1]=1));for(const p of [tall.site.arrival.sourcePort,tall.site.arrival.gatePort]){p.position[1]=1;p.servicePosition[1]=1;p.witness.forEach(v=>v[1]=1);}tall.prototypes[0].parts[0].box[4]=512;tall.prototypes[0].envelope[4]=512;assert.throws(()=>qualify(tall),e=>e.code==='invalid-input');
 const wide=fixture();wide.recipe.reserves=[{id:'beyond',polygon:rect(510,0,512,2),hostIds:['floor']}];wide.frame.origin=[1,0];wide.site.arrival.gatePort.position[0]=1;wide.site.arrival.gatePort.servicePosition[0]=1;wide.site.arrival.gatePort.witness.forEach(v=>v[0]+=1);wide.site.arrival.sourcePort.position[0]=1;wide.site.arrival.sourcePort.servicePosition[0]=1;wide.site.arrival.sourcePort.witness.forEach(v=>v[0]+=1);assert.throws(()=>qualify(wide),e=>e.code==='invalid-input');
});

test('fixed count caps cannot be relaxed through runtime limits',()=>{
 const mutations=[f=>f.recipe.members=Array.from({length:17},(_,i)=>({...f.recipe.members[0],id:`m${i}`})),f=>f.prototypes[0].parts=Array.from({length:97},(_,i)=>({...f.prototypes[0].parts[0],id:`p${i}`})),f=>f.prototypes[0].bearings=Array.from({length:17},()=>f.prototypes[0].bearings[0]),f=>f.prototypes[0].ports=Array.from({length:9},(_,i)=>({...f.prototypes[0].ports[0],id:`p${i}`})),f=>f.recipe.nodes=Array.from({length:49},(_,i)=>({id:`n${i}`,uv:[i,0]})),f=>f.recipe.edges=Array.from({length:65},()=>f.recipe.edges[0]),f=>f.site.hostFaces=Array.from({length:129},(_,i)=>({...f.site.hostFaces[0],id:`h${i}`})),f=>f.site.hostFaces[0].faces=Array(150001).fill(f.site.hostFaces[0].faces[0])];
 for(const mutate of mutations){const f=fixture();f.limits={maxPairs:4000000};mutate(f);assert.throws(()=>qualify(f),e=>e.code==='invalid-input');}
});

test('a service center cannot be invented at a different height from its complete face witness',()=>{
 const f=fixture();f.prototypes[0].ports[0].witness.forEach(v=>v[1]=.2);assert.throws(()=>qualify(f),e=>e.code==='invalid-input');
});

test('one long source edge and two short opposite source edges prove a complete T subdivision',()=>{
 const f=fixture();f.site.hostFaces[0].faces=flatRect(-20,-20,20,1,0,'south').concat(flatRect(-20,1,0,20,0,'left'),flatRect(0,1,20,20,0,'right'));
 const r=qualify(f);assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));vector(r.snapshot.members[0].position,[0,0,3]);
 const route=r.snapshot.routes.find(e=>key(e.a,e.b)===key('end','gate'));approx(area(route.polygon),3);assert.equal(route.maxStep,0);assert.ok(route.faceIds.length>=3);
});

// Fix round 1: independent review counterexamples. These assertions must fail
// if a positive geometric feature is discarded or an input contract is merged.
function notComplete(f,codes){
 const result=qualify(f);
 assert.equal(result.status,'unsatisfied',JSON.stringify(result));
 assert.equal(result.snapshot,null);
 assert.ok(codes.includes(result.diagnostics.reasons[0].code),JSON.stringify(result.diagnostics));
 return result;
}

test('C1 a 1e-14 half-plane cut cannot disappear from the full-width corner',()=>{
 const f=fixture();
 const delta=1e-14;
 f.site.hostFaces.push({owner:f.site.owner,id:'trimmed',faces:[{
  id:'diagonal',p:[[-10,0,9.4+delta],[10,0,20],[10,0,-10.6+delta]]
 }]});
 f.recipe.hostScopes.push('trimmed');
 f.recipe.edges[0].hostIds=['trimmed'];
 notComplete(f,['walk-gap','precision']);
});

test('C1 an extra supporting layer with a 1e-14 intrusion is never an empty intersection',()=>{
 const f=fixture();
 f.site.hostFaces.push({owner:f.site.owner,id:'intruder',faces:[{
  id:'tip',p:[[.6-1e-14,.1,1],[1.6,.1,1.5],[1.6,.1,.5]]
 }]});
 f.recipe.hostScopes.push('intruder');
 f.recipe.edges[0].hostIds.push('intruder');
 notComplete(f,['walk-overlap','precision']);
});

test('C1 a positive 1e-14 member overlap is not allowed by SAT tolerance',()=>{
 const f=fixture();
 f.recipe.members.push({...f.recipe.members[0],id:'second',uv:[2-1e-14,3]});
 notComplete(f,['occupied','precision']);
});

test('C2 a collinear intermediate vertex preserves a low beam and reserved solid',()=>{
 for(const intermediate of [false,true]){
  const f=fixture();
  const polygon=rect(-.2,.5,.2,1);
  if(intermediate)polygon.splice(1,0,[0,.5]);
  f.site.blocks.push({owner:f.site.owner,id:'beam',polygon,yMin:1.4,yMax:1.7});
  reject(f,'blocked-clearance');

  const solid=fixture();
  const footprint=rect(-.2,2.8,.2,3.1);
  if(intermediate)footprint.splice(1,0,[0,2.8]);
  solid.site.reservedSolids.push({owner:solid.site.owner,id:'solid',polygon:footprint});
  reject(solid,'occupied');
 }
});

test('C3 an unrelated source-side wall stays blocking after source ID ordering changes',()=>{
 for(const sourceId of ['source','A']){
  const f=fixture();
  f.site.arrival.sourcePort.id=sourceId;
  f.site.arrival.startId=sourceId;
  f.site.arrival.edges[0].a=sourceId;
  f.site.blocks.push({owner:f.site.owner,id:'wall',polygon:rect(-.3,-2.5,.3,-2),yMin:.4,yMax:1.5});
  reject(f,'blocked-clearance');
 }
});

test('C3 an unregistered same-height solid cannot impersonate the registered cross sill',()=>{
 const f=fixture();
 f.site.blocks.push({owner:f.site.owner,id:'unregistered',polygon:rect(-.2,.5,.2,1),yMin:-.125,yMax:0});
 reject(f,'blocked-clearance');
});

test('I1 recipe and arrival edge namespaces cannot substitute for each other',()=>{
 const f=fixture();
 f.recipe.edges[0].headroom=2.1;
 [f.recipe.edges,f.site.arrival.edges]=[f.site.arrival.edges,f.recipe.edges];
 assert.throws(()=>qualify(f),e=>e.code==='invalid-input');
});

test('I1 every declared arrival middle node must belong to its source-to-gate component',()=>{
 const f=fixture();
 f.site.arrival.nodes.push({id:'bad',position:[0,432,-1]});
 reject(f,'disconnected');
});

test('I2 a shifted finite cross witness must cover the whole final anchored section',()=>{
 for(const shift of [1e-5,1e-14,2**-52]){
  const f=fixture();
  const port=f.site.arrival.sourcePort;
  port.servicePosition[0]+=shift;
  port.witness.forEach(point=>point[0]+=shift);
  reject(f,'port-width');
 }
});

test('I2 a shifted finite serve face must cover the whole final anchored section',()=>{
 for(const shift of [1e-5,1e-14,2**-52]){
  const f=fixture();
  const port=f.prototypes[0].ports[0];
  port.servicePosition[0]+=shift;
  port.witness.forEach(point=>point[0]+=shift);
  reject(f,'port-width');
 }
});

test('I3 exhausted budget stops before reading any unbounded reserve polygon getter',()=>{
 const f=fixture();
 let reads=0;
 f.limits={maxPairs:6};
 f.recipe.reserves=Array.from({length:24},(_,i)=>({
  id:`reserve${i}`,hostIds:['floor'],
  get polygon(){reads++;return rect(-2,.5,2,1.5);}
 }));
 reject(f,'budget');
 assert.equal(reads,0,'unpaid reserve work must never be read');
});

test('I3 an unbounded catalogue cannot read element getters before reserving its input work',()=>{
 const f=fixture();
 let reads=0;
 const original=f.prototypes[0];
 f.limits={maxPairs:1};
 f.prototypes=Array(100);
 for(let i=0;i<100;i++)Object.defineProperty(f.prototypes,i,{get(){reads++;return {...original,id:`p${i}`};}});
 reject(f,'budget');
 assert.equal(reads,0,'array length must be checked against budget before map reads');
});

test('I4 malformed face IDs fail before precision diagnostics and never freeze caller state',()=>{
 const f=fixture();
 const callerOwned={callerOwned:'unfrozen'};
 f.site.hostFaces[0].faces=[{id:callerOwned,p:[[0,0,0],[0,0,1e-12],[1e-12,0,0]]}];
 assert.throws(()=>qualify(f),e=>e.code==='invalid-input');
 assert.equal(Object.isFrozen(callerOwned),false);
 assert.equal(Object.isFrozen(f.site.hostFaces[0].faces[0]),false);
});

test('I5 a measured 8 micrometre footprint receives a stable precision result at the old layout boundary',()=>{
 const f=fixture();
 const p=f.prototypes[0];
 p.envelope=[-4e-6,0,-.5,4e-6,1,.5];
 p.parts[0].box=[...p.envelope];
 p.bearings=[
  {prototypeOwner:p.prototypeOwner,ring:[[-4e-6,-.5],[4e-6,-.5],[4e-6,.5]],bottomY:0},
  {prototypeOwner:p.prototypeOwner,ring:[[-4e-6,-.5],[4e-6,.5],[-4e-6,.5]],bottomY:0}
 ];
 p.ports[0].width=4e-6;
 p.ports[0].witness=[[-2e-6,.8,-.5],[2e-6,.8,-.5]];
 const result=reject(f,'precision');
 assert.equal(result.diagnostics.reasons[0].ownerId,'m');
});

test('I6 local arrival anchors require Y zero while world port Y remains an actual measurement',()=>{
 const f=fixture();
 f.prototypes[0].ports[0].position[1]=.5;
 assert.throws(()=>qualify(f),e=>e.code==='invalid-input');
 const world=fixture();
 world.site.arrival.sourcePort.position[1]=.5;
 reject(world,'seam-step');
});

test('C1 exact line and point contacts remain genuine zero-area contacts',()=>{
 const touching=fixture();
 touching.recipe.members.push({...touching.recipe.members[0],id:'second',uv:[2,3]});
 assert.equal(qualify(touching).status,'complete');
 const point=fixture();
 point.site.hostFaces.push({owner:point.site.owner,id:'touch',faces:[{
  id:'tip',p:[[.6,.1,1],[1.6,.1,1.5],[1.6,.1,.5]]
 }]});
 point.recipe.hostScopes.push('touch');
 point.recipe.edges[0].hostIds.push('touch');
 assert.equal(qualify(point).status,'complete');
});

test('I3 a fixed-size face page still reserves work before reading its element getters',()=>{
 const f=fixture();
 let reads=0;
 const face=f.site.hostFaces[0].faces[0];
 const faces=Array(1000);
 for(let i=0;i<faces.length;i++)Object.defineProperty(faces,i,{get(){reads++;return {...face,id:`f${i}`};}});
 f.site.hostFaces[0].faces=faces;
 f.limits={maxPairs:200};
 reject(f,'budget');
 assert.equal(reads,0,'the fixed hard cap does not pay for reading its entire page');
});

test('C1 physical overlap of full source pieces is classified before rounded intersection construction',()=>{
 for(const delta of [0,2**-50,2**-55]){
  const f=fixture();
  f.site.hostFaces.push(
   {owner:f.site.owner,id:'left',faces:flatRect(-20,-20,.125,20,0,'left')},
   {owner:f.site.owner,id:'right',faces:flatRect(.125-delta,-20,20,20,0,'right')}
  );
  f.recipe.hostScopes.push('left','right');
  f.recipe.edges[0].hostIds=['left','right'];
  f.site.arrival.edges[0].hostIds=['left','right'];
  if(delta===0)assert.equal(qualify(f).status,'complete');
  else reject(f,'walk-overlap');
 }
});


test('C1 unrepresentable positive source area is precision failure rather than malformed geometry',()=>{
 const host=fixture();
 host.site.hostFaces[0].faces=[{id:'subnormal-area',p:[[0,0,0],[0,0,1e-200],[1e-200,0,0]]}];
 reject(host,'precision');
 const bearing=fixture();
 const prototype=bearing.prototypes[0];
 prototype.bearings=[{prototypeOwner:prototype.prototypeOwner,ring:[[0,0],[1e-200,0],[0,1e-200]],bottomY:0}];
 reject(bearing,'precision');
});

// Fix round 2: diagnostic text is not source identity, and a positive section
// interval retains its endpoint heights regardless of its physical width.
function collidingHostFixture(memberId){
 const f=fixture(),owner=f.site.owner,prototypeOwner=Object.freeze({});
 const hostId=JSON.stringify(['q','body']);
 f.prototypes.push({
  id:'slab',prototypeOwner,
  envelope:[-.2,-.125,-.2,.2,0,.2],
  parts:[{id:'body',prototypeOwner,box:[-.2,-.125,-.2,.2,0,.2]}],
  bearings:[{prototypeOwner,bottomY:-.125,ring:rect(-.2,-.2,.2,.2)}],
  ports:[]
 });
 f.recipe.members.push({id:memberId,prototypeId:'slab',uv:[0,1],yawRadians:0,bearingHost:'under',regionId:'yard'});
 f.site.hostFaces.push(
  {id:hostId,owner,faces:flatRect(-20,-20,20,20)},
  {id:'under',owner,faces:flatRect(-20,-20,20,20,-.125)}
 );
 f.recipe.hostScopes.push(hostId,'under');
 f.recipe.edges[0].hostIds=[hostId];
 return f;
}
function sourceSillFixture(half,height){
 const f=fixture(),x=.25;
 f.site.arrival.sourcePort.witness.splice(1,0,
  [x-half,0,-2],[x,height,-2],[x+half,0,-2]
 );
 return f;
}

test('R2 C3 member diagnostic ID collision never inherits host-floor exemption',()=>{
 for(const memberId of ['q','other']){
  const r=reject(collidingHostFixture(memberId),'blocked-clearance');
  assert.equal(r.diagnostics.reasons[0].peerId,JSON.stringify([memberId,'body']));
 }
});

test('R2 C3 actual host blocks retain self exemption with legal JSON tuple IDs',()=>{
 const f=fixture(),hostId=JSON.stringify(['q','body']);
 f.site.hostFaces[0].id=hostId;
 f.recipe.hostScopes=[hostId];
 f.recipe.members[0].bearingHost=hostId;
 f.recipe.edges[0].hostIds=[hostId];
 f.site.arrival.edges[0].hostIds=[hostId];
 f.site.blocks.push({owner:f.site.owner,id:hostId,polygon:rect(-20,-20,20,20),yMin:-.125,yMax:0});
 const r=qualify(f);
 assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));
 assert.equal(JSON.stringify(r.snapshot).includes('sourceKind'),false);
});

test('R2 N1 full-width source sill retains an off-centre 1e-12 wide 3cm peak',()=>{
 const r=reject(sourceSillFixture(1e-12,.03),'seam-step');
 assert.equal(r.diagnostics.reasons[0].ownerId,'source');
 assert.ok(r.diagnostics.reasons[0].value>.029);
});

test('R2 N1 the same narrow full section permits flat and sub-step low controls',()=>{
 for(const height of [0,.005]){
  const r=qualify(sourceSillFixture(1e-12,height));
  assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));
 }
});

test('R2 N1 a wider off-centre 3cm source sill peak still fails the same step limit',()=>{
 const r=reject(sourceSillFixture(1e-4,.03),'seam-step');
 assert.equal(r.diagnostics.reasons[0].ownerId,'source');
});

test('R2 N1 actual zero-length flat witness contacts remain admissible',()=>{
 const r=qualify(sourceSillFixture(0,0));
 assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));
});

// Fix round 3: the whole source -> section producer -> comparison boundary.
// Five exactly joined triangles cover the same 1.2 x 2 rectangle. Only the
// middle source face's cap width changes; the physical sill never changes.
function sourceFanFixture(middleWidth,height){
 const f=sourceSillFixture(1e-12,height),x=.25,tip=[x,0,0];
 const perimeter=[[-.6,0,0],[-.6,0,-2],[x-middleWidth/2,0,-2],
  [x+middleWidth/2,0,-2],[.6,0,-2],[.6,0,0]];
 const faces=perimeter.slice(1).map((b,i)=>({id:`fan${i}`,p:[tip,b,perimeter[i]]}));
 f.site.hostFaces.push({id:'fan',owner:f.site.owner,faces});
 f.recipe.hostScopes.push('fan');
 f.site.arrival.edges[0].hostIds=['fan'];
 return f;
}
for(const [name,middleWidth,height]of [
 ['narrow source fan with flat sill',1.1e-11,0],
 ['wide source fan with flat sill',1e-3,0],
 ['narrow source fan with off-centre 3cm peak',1.1e-11,.03],
 ['wide source fan with off-centre 3cm peak',1e-3,.03]
])test(`R3 N1 ${name}`,()=>{
 const f=sourceFanFixture(middleWidth,height),before=JSON.stringify(f);
 const faces=f.site.hostFaces.at(-1).faces;
 approx(faces.reduce((sum,face)=>sum+area(face.p.map(p=>[p[0],p[2]])),0),2.4,1e-14);
 assert.ok(faces[2].p[1][0]>faces[2].p[2][0],'the middle cap interval is actually positive');
 if(height===0){
  const r=qualify(f);
  assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));
 }else{
  const r=reject(f,'seam-step');
  assert.equal(r.diagnostics.reasons[0].ownerId,'source');
  assert.ok(r.diagnostics.reasons[0].value>.029);
 }
 assert.equal(JSON.stringify(f),before);
});

function joinedStripFixture(offset){
 const f=fixture();
 f.site.hostFaces[0].faces=flatRect(-20,-20,20,20);
 f.recipe.members[0].uv[0]=offset;
 f.recipe.nodes.push({id:'j1',uv:[0,.5]},{id:'j2',uv:[offset,1]},{id:'j3',uv:[offset,1.5]});
 f.recipe.edges=[['gate','j1'],['j1','j2'],['j2','j3'],['j3','end']]
  .map(([a,b])=>({a,b,width:1.2,hostIds:['floor']}));
 return f;
}

test('R4 N2 an offset strip cannot borrow the flat host beyond its checked cap',()=>{
 const offset=.00025,f=joinedStripFixture(offset);
 // The next strip starts in d·(p−j1) >= 0, d=(offset,.5).
 // At p=(-.6,.5) the incoming cap lies about .000300m outside it.
 const signedDistance=-.6*offset/Math.hypot(offset,.5);
 assert.ok(signedDistance<-.000299 && signedDistance>-.000301);
 const r=reject(f,'walk-gap');
 assert.equal(r.diagnostics.reasons[0].ownerId,'j1');
});

test('R4 N2 collinear strips share the entire checked 1.2m cap on the same host',()=>{
 const r=qualify(joinedStripFixture(0));
 assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));
 for(const [a,b] of [['gate','j1'],['j1','j2']]){
  const route=r.snapshot.routes.find(e=>key(e.a,e.b)===key(a,b));
  const cap=route.polygon.filter(([,z])=>z===.5).map(([x])=>x).sort((x,y)=>x-y);
  assert.deepEqual(cap,[-.6,.6]);
 }
});

function rotatedStripFixture(offset){
 const f=joinedStripFixture(offset),port=f.prototypes[0].ports[0];
 // Give the independent terminal service face margin: its width must not
 // reject the case before the interior joint can be checked.
 port.width=1.25;port.witness=[[-.625,.8,-.5],[.625,.8,-.5]];
 f.site.hostFaces[0].faces=[{id:'flat',p:[[-40,0,-40],[0,0,40],[40,0,-40]]}];
 return transformFixture(f,[5,6],Math.PI/3);
}
test('R4 N2 a 60 degree rigid frame preserves an authored collinear full cap',()=>{
 const r=qualify(rotatedStripFixture(0));
 assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));
 const poly=(a,b)=>r.snapshot.routes.find(e=>key(e.a,e.b)===key(a,b)).polygon;
 const first=poly('gate','j1'),next=poly('j1','j2');
 const common=first.filter(p=>next.some(q=>p[0]===q[0]&&p[1]===q[1]));
 assert.equal(common.length,2);
 approx(Math.hypot(common[0][0]-common[1][0],common[0][1]-common[1][1]),1.2);
});
test('R4 N2 the same rigid frame preserves the real offset at the interior joint',()=>{
 const r=reject(rotatedStripFixture(.00025),'walk-gap');
 assert.equal(r.diagnostics.reasons[0].ownerId,'j1');
});
test('R4 N2 rigid rotation keeps the original collinear floor and exact-width service face',()=>{
 const r=qualify(transformFixture(joinedStripFixture(0),[5,6],Math.PI/3));
 assert.equal(r.status,'complete',JSON.stringify(r.diagnostics));
});
