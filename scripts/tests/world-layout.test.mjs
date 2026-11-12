import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
let compileWorldLayout;
try { ({compileWorldLayout}=await import('../../assets/scene/world-layout.mjs')); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }
const compile=input=>{assert.equal(typeof compileWorldLayout,'function','compileWorldLayout must exist');return compileWorldLayout(input);};
const n=(id,x,z)=>({id,x,z});
const edge=(id,from,to,width=2)=>({id,from,to,width});
const level=(id,nodes,edges,y=0)=>({id,nodes,edges,y});
const area=r=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2;
const surfaceArea=s=>s.reduce((a,p)=>a+area(p.outer)+p.holes.reduce((s,h)=>s+area(h),0),0);
const square=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]];
const hub=(arms)=>({levels:[level('ground',[n('o',0,0),...arms.map((p,i)=>n(`n${i}`,...p))],arms.map((p,i)=>edge(`e${i}`,'o',`n${i}`,i?2:4)))],regions:[]});
function inside(p,r){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
const inSurface=(p,s)=>s.some(x=>inside(p,x.outer)&&!x.holes.some(h=>inside(p,h)));

test('T, cross and oblique unequal-width junctions form one non-overlaid polygon',()=>{
 for(const arms of [[[-8,0],[8,0],[0,8]],[[-8,0],[8,0],[0,-8],[0,8]],[[-8,0],[8,0],[5,7],[-3,-9]]]){
  const w=compile(hub(arms)),surfaces=w.levels[0].surfaces;
  assert.equal(surfaces.length,1);assert.equal(surfaces[0].holes.length,0);assert.ok(area(surfaces[0].outer)>0);
  for(const p of [[0,0],...arms.map(p=>p.map(x=>x*.6))])assert.ok(inSurface(p,surfaces));
  // Dense independent cell integration of capsules (24-gon junctions are within 0.018 r).
  let measured=0;const step=.04;
  for(let x=-10;x<10;x+=step)for(let z=-11;z<10;z+=step)if(inSurface([x+step/2,z+step/2],surfaces))measured+=step*step;
  assert.ok(Math.abs(measured-surfaceArea(surfaces))<.2);
 }
});

test('single road union has known capsule area and no duplicate boundaries',()=>{
 const w=compile({levels:[level('l',[n('a',0,0),n('b',10,0)],[edge('ab','a','b',2)])],regions:[]});
 const s=w.levels[0].surfaces;const circleArea=12*Math.sin(Math.PI/12);
 assert.ok(Math.abs(surfaceArea(s)-(20+circleArea))<1e-7);
 const keys=s[0].outer.map((p,i)=>JSON.stringify([p,s[0].outer[(i+1)%s[0].outer.length]]));assert.equal(new Set(keys).size,keys.length);
});

test('closed road loop retains its hole and triangulates with real Three ShapeUtils',async()=>{
 const w=compile({levels:[level('l',[n('a',0,0),n('b',12,0),n('c',12,12),n('d',0,12)],[edge('ab','a','b'),edge('bc','b','c'),edge('cd','c','d'),edge('da','d','a')])],regions:[]});
 const s=w.levels[0].surfaces;assert.equal(s.length,1);assert.equal(s[0].holes.length,1);assert.ok(Math.abs(area(s[0].holes[0])+100)<1e-7);assert.equal(inSurface([6,6],s),false);
 const modulePath=process.env.THREE_MODULE;
 assert.ok(modulePath,'THREE_MODULE must point at locked real Three module');
 const T=await import(pathToFileURL(modulePath));
 for(const p of s){const outer=p.outer.map(v=>new T.Vector2(...v)),holes=p.holes.map(h=>h.map(v=>new T.Vector2(...v))),points=[...outer,...holes.flat()];const faces=T.ShapeUtils.triangulateShape(outer,holes);let sum=0;for(const face of faces){const tri=face.map(i=>points[i]);sum+=Math.abs(area(tri.map(v=>[v.x,v.y])));assert.equal(inSurface(tri.reduce((v,p)=>[v[0]+p.x/3,v[1]+p.y/3],[0,0]),s),true);}assert.ok(Math.abs(sum-surfaceArea(s))<1e-7);}
});

test('levels remain independent; explicit links alone connect their graph components',()=>{
 const data={levels:[level('g',[n('a',-5,0),n('b',5,0)],[edge('ab','a','b')]),level('u',[n('c',0,-5),n('d',0,5)],[edge('cd','c','d')],4)],regions:[]};
 const separate=compile(data);assert.equal(separate.connectionGraph.components.length,2);assert.deepEqual(separate.levels.map(l=>l.y),[0,4]);
 const joined=compile({...data,links:[{id:'ramp',fromLevel:'g',fromNode:'b',toLevel:'u',toNode:'d',width:2}]});assert.equal(joined.connectionGraph.components.length,1);assert.deepEqual(joined.links[0].start,[5,0,0]);assert.deepEqual(joined.links[0].end,[0,4,5]);
});

test('complete footprints reject concave excursions, enclosed holes, roads and forbidden regions',()=>{
 const regions=[{id:'yard',level:'g',outline:[[0,0],[20,0],[20,20],[12,20],[12,8],[8,8],[8,20],[0,20]],holes:[square(2,2,4,4)],role:'buildable'},{id:'keep',level:'g',outline:square(14,2,16,4),role:'forbidden'}];
 const w=compile({levels:[level('g',[n('a',1,6),n('b',19,6)],[edge('ab','a','b',1)])],regions});
 const allowed=polygon=>w.footprintAllowed({level:'g',regionId:'yard',polygon});
 assert.equal(allowed(square(5,1,7,3)),true);
 assert.equal(allowed([[6,10],[14,10],[10,4]]),false,'all vertices inside but edge crosses concave notch');
 assert.equal(allowed(square(1,1,5,5)),false,'footprint surrounds hole without intersecting its edge');
 assert.equal(allowed(square(5,4,7,7)),false,'road crosses footprint');
 assert.equal(allowed(square(13,1,17,5)),false,'enclosed forbidden polygon');
 assert.equal(w.footprintAllowed({level:'g',regionId:'yard',polygon:square(5,.1,7,2),clearance:.2}),false);
 assert.equal(w.footprintAllowed({level:'g',regionId:'yard',polygon:square(5,1,7,3),clearance:.5}),true);
 assert.equal(w.footprintAllowed({level:'g',regionId:'yard',polygon:square(5,6.6,7,7.1),clearance:.2}),false,'road clearance');
});

test('snapshots and IDs are deterministic, detached from mutable inputs',()=>{
 const input=hub([[-8,0],[8,0],[3,7]]),saved=JSON.stringify(input),a=compile(input);
 const b=compile({...input,levels:[{...input.levels[0],nodes:[...input.levels[0].nodes].reverse(),edges:[...input.levels[0].edges].reverse()}]});
 assert.equal(JSON.stringify(input),saved);assert.deepEqual(a.levels,b.levels);assert.deepEqual(a.snapshot,b.snapshot);
 input.levels[0].nodes[0].x=999;assert.equal(a.levels[0].nodes.find(n=>n.id==='o').x,0);assert.ok(Object.isFrozen(a.levels[0].surfaces));
});

test('invalid polygons, identifiers, unstable scales and unknown/coplanar links fail explicitly',()=>{
 const base={levels:[level('g',[],[])],regions:[]};
 for(const input of [{...base,levels:[...base.levels,...base.levels]},{...base,regions:[{id:'bad',level:'g',role:'buildable',outline:[[0,0],[2,2],[0,2],[2,0]]}]},{...base,regions:[{id:'bad',level:'missing',role:'buildable',outline:square(0,0,2,2)}]},{levels:[level('g',[n('a',0,0),n('b',1,0)],[edge('tiny','a','b',1e-12)])],regions:[]},{...base,links:[{id:'l',fromLevel:'g',fromNode:'a',toLevel:'g',toNode:'b',width:1}]}])assert.throws(()=>compile(input));
 const w=compile(base);assert.throws(()=>w.footprintAllowed({level:'missing',polygon:square(0,0,1,1)}));assert.throws(()=>w.footprintAllowed({level:'g',polygon:square(0,0,1,1),clearance:-1}));
});

test('union matches independent primitive membership for diagonal roads and disconnected components',()=>{
 const input=hub([[-8,0],[8,0],[5,7],[-3,-9]]);input.levels[0].nodes.push(n('u',20,20),n('v',24,22));input.levels[0].edges.push(edge('uv','u','v',3));
 const w=compile(input),l=w.levels[0];assert.equal(l.surfaces.length,2);
 const primitives=[...l.edges.map(e=>e.quad),...l.junctions.filter(n=>n.radius).map(n=>Array.from({length:24},(_,i)=>[n.x+n.radius*Math.cos(i*Math.PI/12),n.z+n.radius*Math.sin(i*Math.PI/12)]))];
 for(let x=-10.013;x<27;x+=.131)for(let z=-11.017;z<25;z+=.197)assert.equal(inSurface([x,z],l.surfaces),primitives.some(p=>inside([x,z],p)),`union occupancy at ${x},${z}`);
});

test('small polygons at large offsets retain area and valid complete footprints',()=>{
 const w=compile({levels:[level('g',[],[])],regions:[{id:'r',level:'g',role:'buildable',outline:square(99999,99999,99999.001,99999.001)}]});
 assert.equal(w.footprintAllowed({level:'g',regionId:'r',polygon:square(99999.0002,99999.0002,99999.0004,99999.0004)}),true);
});

test('holes are bounded arrays, cannot touch outer rings, or overlap each other',()=>{
 const base={levels:[level('g',[],[])],regions:[]},reg={id:'r',level:'g',role:'buildable',outline:square(0,0,10,10)};
 for(const holes of [{},Array.from({length:33},()=>square(1,1,2,2)),[square(0,1,2,2)],[square(1,1,4,4),square(3,3,5,5)]])assert.throws(()=>compile({...base,regions:[{...reg,holes}]}));
});
