import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {compileWorldLayout} from '../../assets/scene/world-layout.mjs';
import {rectanglesOverlap} from '../../assets/scene/corridor-layout.mjs';
let implementation;
try { implementation=await import('../../assets/scene/frontage-neighborhood.mjs'); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }
const compile=x=>{assert.equal(typeof implementation?.compileFrontageNeighborhood,'function','compileFrontageNeighborhood must exist');return implementation.compileFrontageNeighborhood(x);};
const square=(x,z,X,Z)=>[[x,z],[X,z],[X,Z],[x,Z]];
const proto=(id,minX,maxX,minZ,maxZ)=>({id,footprint:{minX,maxX,minZ,maxZ},entrance:{position:[(minX+maxX)/2,.2,maxZ-.1],normal:[0,0,1]},spec:{kind:id}});
const prototypes=[proto('small',-1,2,-3,1),proto('wide',-4,3,-2,4),proto('hall',-3,3,-6,2)];
function world({diagonal=false,reverse=false,blocked=false,length=100}={}) {
 const nodes=[{id:'a',x:0,z:0},{id:'b',x:length,z:diagonal?length*.6:0}];
 const regions=[{id:'north',level:'g',role:'homes',outline:square(-20,2,length+20,length+20)},{id:'south',level:'g',role:'public',outline:square(-20,-30,length+20,-2)}];
 if(blocked)regions.push({id:'reserve',level:'g',role:'forbidden',outline:square(22,3,42,12)});
 return compileWorldLayout({levels:[{id:'g',y:3,nodes:reverse?nodes.toReversed():nodes,edges:[{id:'street',from:'a',to:'b',width:4}]}],regions:reverse?regions.toReversed():regions});
}
const options=(overrides={})=>({layout:world(),level:'g',prototypes,familiesByRole:{homes:['wide','small'],public:['hall']},seed:48,gap:1,setback:1,endClearance:4,...overrides});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≠ ${b}`);

// Centering every model at its origin or ignoring its deck breaks these actual transforms.
test('measured asymmetric envelopes and entrance transform exactly with real Three rigid poses',async()=>{
 const T=await import(pathToFileURL(process.env.THREE_MODULE));
 for(const diagonal of [false,true]){
  const layout=world({diagonal}),result=compile(options({layout}));assert.ok(result.lots.length>8);
  for(const lot of result.lots){
   const p=prototypes.find(p=>p.id===lot.prototypeId),f=p.footprint;
   const matrix=new T.Matrix4().makeRotationY(lot.pose.rotationY);matrix.setPosition(...lot.pose.position);
   const local=[[f.minX,0,f.minZ],[f.maxX,0,f.minZ],[f.maxX,0,f.maxZ],[f.minX,0,f.maxZ]];
   local.forEach((v,i)=>{const w=new T.Vector3(...v).applyMatrix4(matrix);near(w.x,lot.footprint[i][0]);near(w.z,lot.footprint[i][1]);});
   const entry=new T.Vector3(...p.entrance.position).applyMatrix4(matrix);[entry.x,entry.y,entry.z].forEach((v,i)=>near(v,lot.entrance.position[i]));
   const normal=new T.Vector3(0,0,1).transformDirection(matrix);[normal.x,normal.y,normal.z].forEach((v,i)=>near(v,lot.entrance.normal[i]));
   const arrival=new T.Vector3(...lot.entrance.roadPoint).sub(entry);arrival.y=0;arrival.normalize();near(arrival.dot(normal),1);
   near(lot.frontage,f.maxX-f.minX);near(lot.depth,f.maxZ-f.minZ);near(lot.pose.position[1],3);
  }
 }
});

test('region purpose selects structural prototypes and groups change widths and rhythm',()=>{
 const result=compile(options()),north=result.lots.filter(l=>l.regionId==='north'),south=result.lots.filter(l=>l.regionId==='south');
 assert.deepEqual(new Set(north.map(l=>l.prototypeId)),new Set(['wide','small']));assert.deepEqual(new Set(south.map(l=>l.prototypeId)),new Set(['hall']));
 assert.ok(new Set(north.map(l=>l.frontage)).size===2);assert.ok(new Set(north.map(l=>l.depth)).size===2);
 const first=north.filter(l=>l.side===1);assert.ok(first.length>6);assert.ok(first.some((l,i)=>i&&l.groupId===first[i-1].groupId));assert.ok(first.some((l,i)=>i&&l.groupId!==first[i-1].groupId));
 assert.equal(new Set(result.lots.map(l=>l.id)).size,result.lots.length);
});

test('complete bounds respect real road union, forbidden areas, holes and every accepted neighbor',()=>{
 const layout=world({blocked:true}),result=compile(options({layout}));assert.ok(result.diagnostics.rejections.regionOrRoad>0);
 for(const l of result.lots){assert.equal(layout.footprintAllowed({level:'g',regionId:l.regionId,polygon:l.footprint,clearance:1}),true);for(const road of layout.levels[0].edges)assert.equal(rectanglesOverlap(l.footprint,road.quad),false);}
 for(let i=0;i<result.lots.length;i++)for(let j=0;j<i;j++)assert.equal(rectanglesOverlap(result.lots[i].footprint,result.lots[j].footprint),false);
 const a=compile(options()),b=compile(options({setback:3,gap:4,endClearance:12}));assert.notDeepEqual(a.lots.map(l=>l.pose.position),b.lots.map(l=>l.pose.position));assert.ok(a.lots.length>b.lots.length);
});

test('ordering never changes results; independent streams are repeatable and seed changes structure',()=>{
 const base=options(),saved=JSON.stringify(base.prototypes),a=compile(base);
 const b=compile(options({layout:world({reverse:true}),prototypes:prototypes.toReversed(),familiesByRole:{public:['hall'],homes:['small','wide']}}));
 assert.deepEqual(a,b);assert.deepEqual(a,compile(base));assert.notDeepEqual(a.lots,compile(options({seed:91})).lots);assert.equal(JSON.stringify(base.prototypes),saved);
 const other=compileWorldLayout({...base.layout.snapshot,regions:[...base.layout.snapshot.regions,{id:'zz-unrelated',level:'g',role:'unused',outline:square(-20,130,120,140)}]});
 assert.deepEqual(a.lots,compile(options({layout:other})).lots,'unmapped region cannot consume another region random stream');
});

test('budget is checked before candidate work and exhaustion reports unprocessed frontage',()=>{
 let calls=0;const actual=world(),layout={...actual,footprintAllowed:arg=>{calls++;return actual.footprintAllowed(arg);}};
 const result=compile(options({layout,maxCandidates:3}));assert.equal(result.diagnostics.status,'budget-exhausted');assert.equal(result.diagnostics.candidates,3);assert.equal(calls,3);assert.ok(result.diagnostics.residual.some(r=>r.reason==='budget'&&r.remainingLength>0));
 const complete=compile(options());assert.equal(complete.diagnostics.status,'complete');assert.equal(complete.diagnostics.accepted,complete.lots.length);assert.ok(complete.diagnostics.candidates<=complete.diagnostics.maxCandidates);
});

test('malformed, duplicate, sparse and excessive freedoms fail before expensive qualification',()=>{
 assert.equal(typeof implementation?.compileFrontageNeighborhood,'function');
 const sparse=new Array(2);sparse[0]=prototypes[0];
 const cases=[{groupSizeRange:[0,2]},{groupSizeRange:[3,2]},{groupSizeRange:[1,65]},{groupSizeRange:new Array(2)},{groupGap:Infinity},{groupGap:-1},{gap:NaN},{gap:-1},{setback:Infinity},{endClearance:100001},{maxCandidates:0},{maxCandidates:16385},{maxCandidates:1.5},{seed:-1},{level:'missing'},{prototypes:sparse},{prototypes:[prototypes[0],prototypes[0]]},{prototypes:[proto('bad',1,1,0,2)]},{prototypes:[proto('bad',0,100001,0,2)]},{familiesByRole:{homes:['unknown']}},{familiesByRole:{homes:['small','small']}},{familiesByRole:{homes:new Array(2)}},{prototypes:[{...prototypes[0],entrance:{position:[0,0,0],normal:[1,0,0]}}]}];
 for(const patch of cases)assert.throws(()=>compile(options(patch)),undefined,JSON.stringify(patch));
});

// Group input must reach world placement, not only metadata.
test('group size and group gap affect placement with finite bounds',()=>{
 const a=compile(options({groupSizeRange:[1,1],groupGap:8})),b=compile(options({groupSizeRange:[4,4],groupGap:0}));
 const an=a.lots.filter(l=>l.regionId==='north'&&l.side===1),bn=b.lots.filter(l=>l.regionId==='north'&&l.side===1);
 assert.equal(new Set(an.map(l=>l.groupId)).size,an.length);assert.ok(new Set(bn.map(l=>l.groupId)).size<bn.length);
 assert.notDeepEqual(an.map(l=>l.pose.position),bn.map(l=>l.pose.position));assert.ok(a.lots.length<b.lots.length);
});

// Complete measurements must come from generated geometry, including an offset deck.
test('real generated mesh envelope includes offset deck and consumer applies unchanged rigid pose',async()=>{
 const T=await import(pathToFileURL(process.env.THREE_MODULE)),group=new T.Group();
 const body=new T.Mesh(new T.BoxGeometry(3,4,4)),deck=new T.Mesh(new T.BoxGeometry(7,.4,3));body.position.set(2,2,-1);deck.position.set(3,-.2,2.5);group.add(body,deck);group.updateMatrixWorld(true);
 const box=new T.Box3().setFromObject(group),p={id:'actual-factory',footprint:{minX:box.min.x,maxX:box.max.x,minZ:box.min.z,maxZ:box.max.z},entrance:{position:[2,0,1],normal:[0,0,1]}};
 const result=compile(options({prototypes:[p],familiesByRole:{homes:[p.id],public:[p.id]}}));assert.ok(result.lots.length>10);
 for(const lot of result.lots){group.position.set(...lot.pose.position);group.rotation.y=lot.pose.rotationY;group.updateMatrixWorld(true);const measured=new T.Box3().setFromObject(group);near(measured.min.x,Math.min(...lot.footprint.map(p=>p[0])));near(measured.max.x,Math.max(...lot.footprint.map(p=>p[0])));near(measured.min.z,Math.min(...lot.footprint.map(p=>p[1])));near(measured.max.z,Math.max(...lot.footprint.map(p=>p[1])));}
 body.geometry.dispose();deck.geometry.dispose();body.material.dispose();deck.material.dispose();
});

test('holes, concave target regions and diagonal junctions qualify whole envelopes and reject neighboring lanes',()=>{
 const layout=compileWorldLayout({levels:[{id:'g',y:0,nodes:[{id:'a',x:-40,z:0},{id:'o',x:0,z:0},{id:'b',x:40,z:0},{id:'c',x:30,z:20}],edges:[{id:'a',from:'a',to:'o',width:4},{id:'b',from:'o',to:'b',width:4},{id:'c',from:'o',to:'c',width:4}]}],regions:[{id:'yard',level:'g',role:'homes',outline:[[-50,-30],[50,-30],[50,35],[10,35],[10,25],[-10,25],[-10,35],[-50,35]],holes:[square(-25,4,-15,12)]}]});
 const result=compile(options({layout,endClearance:0}));assert.ok(result.lots.length>10);assert.ok(result.diagnostics.rejections.regionOrRoad>0);assert.ok(result.diagnostics.rejections.neighbor>0);
 for(const lot of result.lots)assert.equal(layout.footprintAllowed({level:'g',regionId:'yard',polygon:lot.footprint,clearance:1}),true);
 for(let i=0;i<result.lots.length;i++)for(let j=0;j<i;j++)assert.equal(rectanglesOverlap(result.lots[i].footprint,result.lots[j].footprint),false);
 const counts=result.diagnostics;assert.equal(counts.candidates,result.lots.length+Object.values(counts.rejections).reduce((a,b)=>a+b,0));
});

test('minimum supported envelopes at large offsets stay bounded without invalid ring exceptions',()=>{
 const layout=compileWorldLayout({levels:[{id:'g',y:0,nodes:[{id:'a',x:80000,z:0},{id:'b',x:90000,z:0}],edges:[{id:'long',from:'a',to:'b',width:2}]}],regions:[{id:'r',level:'g',role:'homes',outline:square(79000,1,91000,100)}]});
 const tiny={...proto('tiny',0,.00001,0,.00001),entrance:{position:[.000005,0,.00001],normal:[0,0,1]}},result=compile(options({layout,prototypes:[tiny],familiesByRole:{homes:['tiny']},gap:0,groupGap:0,maxCandidates:7}));
 assert.equal(result.diagnostics.candidates,7);assert.equal(result.diagnostics.status,'budget-exhausted');
});

const boundaryWorld=(x=0,dz=0,length=10)=>compileWorldLayout({
 levels:[{id:'g',y:0,nodes:[{id:'a',x,z:0},{id:'b',x:x+length,z:dz}],edges:[{id:'edge',from:'a',to:'b',width:2}]}],
 regions:[{id:'region',level:'g',role:'homes',outline:square(x-10,-20,x+length+20,30)}]
});
const boundaryOptions=layout=>({layout,level:'g',prototypes:[proto('p',0,2,0,2)],familiesByRole:{homes:['p']},endClearance:1,gap:1,setback:1,groupGap:0,groupSizeRange:[1,1]});

// Inclusive local MIN must not become an uncaught world-ring error after translation.
test('source precision failures reject only the exact transformed candidate and keep bounded diagnostics',()=>{
 const offsetTiny={...proto('p',0,.00001,0,.00001),entrance:{position:[.000005,0,.00001],normal:[0,0,1]}};
 assert.doesNotThrow(()=>compile({...boundaryOptions(boundaryWorld(1,0)),prototypes:[offsetTiny],gap:0,maxCandidates:7}));
 for(const x of [0,1,10,1000,80000])for(const dz of [0,3]){
  const layout=boundaryWorld(x,dz),tiny={...proto('p',0,.00001,0,.00001),entrance:{position:[.000005,0,.00001],normal:[0,0,1]}};
  const result=compile({...boundaryOptions(layout),prototypes:[tiny],gap:0,maxCandidates:7});
  assert.equal(result.diagnostics.candidates,7);assert.equal(result.diagnostics.status,'budget-exhausted');
  assert.equal(result.diagnostics.precisionFailures.length,result.diagnostics.rejections.precision);
  assert.equal(result.lots.length+Object.values(result.diagnostics.rejections).reduce((a,b)=>a+b,0),7);
  assert.ok(result.lots.length+result.diagnostics.rejections.precision>0);
  for(const lot of result.lots)assert.equal(layout.footprintAllowed({level:'g',regionId:lot.regionId,polygon:lot.footprint,clearance:1}),true);
  for(const failure of result.diagnostics.precisionFailures){
   assert.equal(failure.prototypeId,'p');assert.equal(failure.regionId,'region');assert.equal(failure.edgeId,'edge');assert.equal(failure.minFeature,layout.metadata.minFeature);
   const lengths=failure.footprint.map((p,i)=>{const q=failure.footprint[(i+1)%4];return Math.hypot(q[0]-p[0],q[1]-p[1]);});
   assert.equal(failure.minEdgeLength,Math.min(...lengths));
   assert.throws(()=>layout.footprintAllowed({level:'g',regionId:failure.regionId,polygon:failure.footprint,clearance:1}),/footprint: (repeated\/short edge|zero area)/);
   assert.ok(failure.minEdgeLength<failure.minFeature||failure.area<failure.minFeature**2);
   assert.equal(failure.reason,failure.minEdgeLength<failure.minFeature?'short-edge':'zero-area');
   assert.ok(!result.lots.some(l=>l.id===failure.id));
  }
  if(x===1&&dz===0)assert.ok(result.diagnostics.rejections.precision>0,'ordinary offset reproduces the source threshold boundary');
  const roomy={...tiny,footprint:{minX:0,maxX:.0000101,minZ:0,maxZ:.0000101}};
  const useful=compile({...boundaryOptions(layout),prototypes:[roomy],gap:0,maxCandidates:7});
  assert.equal(useful.lots.length,7,'near-minimum supported geometry remains useful at every tested offset and heading');
  assert.equal(useful.diagnostics.rejections.precision,0);
 }
});

test('exactly sufficient budget equals uncapped completion after width and group-gap feasibility',()=>{
 for(const [length,groupGap,groupSizeRange]of [[9,0,[1,1]],[10,2,[1,1]],[12,1,[2,2]]]){
  const source={...boundaryOptions(boundaryWorld(0,0,length)),groupGap,groupSizeRange};
  const full=compile(source),capped=compile({...source,maxCandidates:full.diagnostics.candidates});
  assert.equal(full.diagnostics.status,'complete');assert.ok(full.lots.length>0);assert.deepEqual(capped.lots,full.lots);
  const {maxCandidates:fullBudget,...fullDiagnostics}=full.diagnostics,{maxCandidates:cappedBudget,...cappedDiagnostics}=capped.diagnostics;
  assert.deepEqual(cappedDiagnostics,fullDiagnostics);assert.ok(capped.diagnostics.residual.every(r=>r.reason==='end'));
  const short=compile({...source,maxCandidates:full.diagnostics.candidates-1});assert.equal(short.diagnostics.status,'budget-exhausted');assert.ok(short.diagnostics.residual.some(r=>r.reason==='budget'));
 }
});
