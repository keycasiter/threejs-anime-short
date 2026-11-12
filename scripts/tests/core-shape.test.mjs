import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
const threePath=resolve(process.env.THREE_MODULE||'../threejs-r68-quality-analysis-20261112/runtime/three/build/three.module.js');
const T=await import(pathToFileURL(threePath));
const {MarchingCubes}=await import(pathToFileURL(resolve(dirname(threePath),'../examples/jsm/objects/MarchingCubes.js')));
const load=async name=>import(`../../assets/geometry/${name}.mjs`).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const loft=await load('profile-loft'),shell=await load('bezier-shell'),implicit=await load('implicit-surface');
const create=(m,key,...args)=>{assert.equal(typeof m[key],'function',`${key} API missing`);return m[key](T,...args);};
const profile=[[-1,-1],[1,-1],[1,.3],[.2,.3],[.2,1],[-1,1]];
const stations=()=>[{center:[0,0,0],profile:structuredClone(profile)},{center:[0,2,0],profile:profile.map(([x,y])=>[x*.8,y*1.2]),rollRadians:.3},{center:[.4,5,.2],profile:profile.map(([x,y])=>[x*.6,y*.7]),rollRadians:-.1}];
const controls=()=>Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>[i-1.5,j-1.5,.15*i*j+.12*(i%2)]));
const getLoft=o=>create(loft,'createProfileLoftSource',o||{stations:stations()});
const getShell=o=>create(shell,'createBezierPatchShell',o||{controlPoints:controls(),thickness:.12,segmentsU:7,segmentsV:5});
const bounds={min:[-2,-1.5,-1],max:[2,1.5,1]};
const getImplicit=o=>create(implicit,'createImplicitSurfaceSource',{MarchingCubes},{field:(x,y,z)=>Math.hypot(x,y,z)-.65,bounds,resolution:24,...o});
function verts(g,id){return [0,1,2].map(k=>new T.Vector3().fromBufferAttribute(g.attributes.position,g.index?g.index.getX(id*3+k):id*3+k));}
function hit(source,u,v,layer){const h=source.surfaceAt(u,v,layer),tri=new T.Triangle(...verts(source.geometry,h.triangleIndex));assert.ok(tri.closestPointToPoint(h.point,new T.Vector3()).distanceTo(h.point)<1e-7);assert.ok(tri.getNormal(new T.Vector3()).distanceTo(h.normal)<1e-8);return h;}
function healthy(g){for(const name of ['position','normal','uv']){assert.ok(g.attributes[name]);assert.ok([...g.attributes[name].array].every(Number.isFinite));}for(let i=0;i<(g.index?.count??g.attributes.position.count)/3;i++){const tri=new T.Triangle(...verts(g,i));assert.ok(tri.getArea()>1e-14,`degenerate triangle ${i}`);}assert.ok(g.boundingBox);}
function closed(g){const edges=new Map(),p=g.attributes.position;const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].join(',');for(let i=0;i<(g.index?.count??p.count);i+=3){const ids=[0,1,2].map(k=>key(g.index?g.index.getX(i+k):i+k));for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3],e=[a,b].sort().join('|');const prev=edges.get(e)||[0,0];prev[0]++;prev[1]+=a<b?1:-1;edges.set(e,prev);}}for(const [e,[n,dir]]of edges){assert.equal(n,2,e);assert.equal(dir,0,e);}}
function owns(source){let n=0;source.geometry.addEventListener('dispose',()=>n++);source.dispose();source.dispose();assert.equal(n,1);if(source.surfaceAt)assert.throws(()=>source.surfaceAt(.3,.3),/dispos/i);}

test('arbitrary concave profile loft: real triangles, closed caps, metric UV, mutation isolation',()=>{const opts={stations:stations(),uvMeters:.5},s=getLoft(opts);healthy(s.geometry);closed(s.geometry);for(const u of [0,.15,.4,.9,1])for(const v of [0,.02,.19,.6,.99,1])hit(s,u,v);assert.ok(hit(s,.2,0).point.distanceTo(hit(s,.2,1).point)<1e-9);const p=hit(s,.3,.1).point;opts.stations[0].profile[0][0]=900;assert.ok(p.distanceTo(hit(s,.3,.1).point)<1e-9);assert.ok(Math.max(...s.geometry.attributes.uv.array)>5);owns(s);});
test('profile winding supports CW or CCW consistently and outward faces',()=>{for(const reverse of [false,true]){const p=[[-1,-1],[1,-1],[1,1],[-1,1]];if(reverse)p.reverse();const s=getLoft({stations:[{center:[0,0,0],profile:p},{center:[0,2,0],profile:p}]});for(const v of [.1,.3,.6,.9]){const h=hit(s,.5,v);assert.ok(h.normal.dot(new T.Vector3(h.point.x,0,h.point.z))>0);}closed(s.geometry);s.dispose();}});
test('loft rejects self-crossing, incompatible rings, cusps and Float32 collapse',()=>{for(const modify of [s=>s[0].profile=[[0,0],[1,1],[0,1],[1,0]],s=>s[1].profile.pop(),s=>s[1].profile.reverse(),s=>s[2].center=[0,0,0]]){const st=stations();modify(st);assert.throws(()=>getLoft({stations:st}),/profile|correspond|winding|cusp|revers/i);}assert.throws(()=>getLoft({stations:[{center:[1e9,0,1e9],profile},{center:[1e9,1,1e9],profile}]}),/collaps|degenerate|precision/i);});
test('Bezier non-axisymmetric patch has two real offset layers, four closed walls, material groups',()=>{const s=getShell();healthy(s.geometry);closed(s.geometry);assert.equal(s.geometry.groups.length,6);assert.deepEqual(s.geometry.groups.map(g=>g.materialIndex),[0,1,2,2,2,2]);for(const u of [0,.12,.4,.9,1])for(const v of [0,.03,.5,.99,1]){hit(s,u,v,'outer');hit(s,u,v,'inner');}const o=hit(s,0,0,'outer'),i=hit(s,0,0,'inner');assert.ok(Math.abs(o.point.distanceTo(i.point)-.12)<1e-6);assert.ok(o.normal.dot(i.normal)<-.9);owns(s);});
test('Bezier queries use emitted triangles rather than analytic curved evaluation',()=>{const s=getShell({controlPoints:controls(),thickness:.1,segmentsU:1,segmentsV:1});for(const layer of ['outer','inner']){const h=hit(s,.3,.8,layer);const [a,b,c]=verts(s.geometry,h.triangleIndex);assert.ok(h.point.distanceTo(a.multiplyScalar(.2).addScaledVector(b,layer==='outer'?.3:.5).addScaledVector(c,layer==='outer'?.5:.3))<1e-7);}assert.throws(()=>s.surfaceAt(.2,.2,'wall'),/layer/i);assert.throws(()=>s.surfaceAt(-1,.3),/u/i);s.dispose();});
test('Bezier validates Jacobian, thickness, input and Float32 offset collapse',()=>{const flat=controls().map(row=>row.map(()=>[0,0,0]));assert.throws(()=>getShell({controlPoints:flat,thickness:.1}),/jacobian|degenerate/i);assert.throws(()=>getShell({controlPoints:controls(),thickness:0}),/thickness/i);const big=controls().map(row=>row.map(([x,y,z])=>[x,y,z+1e9]));assert.throws(()=>getShell({controlPoints:big,thickness:.001}),/collaps|precision|degenerate/i);});
test('official MC extraction is cropped, outward, anisotropic-world correct, owned independently',()=>{const s=getImplicit();healthy(s.geometry);assert.equal(s.geometry.attributes.position.count,s.metadata.triangles*3);assert.ok(s.metadata.samples>=24**3);const p=s.geometry.attributes.position,n=s.geometry.attributes.normal;for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i),normal=new T.Vector3().fromBufferAttribute(n,i);assert.ok(Math.abs(v.length()-.65)<.025);assert.ok(v.clone().normalize().dot(normal)>.98);}for(let i=0;i<p.count/3;i++){const tri=new T.Triangle(...verts(s.geometry,i)),center=tri.getMidpoint(new T.Vector3());assert.ok(tri.getNormal(new T.Vector3()).dot(center)>0);}owns(s);});
test('MC supports non-SDF smooth fusion and nonzero iso; rejects empty/cut/nonfinite/overflow',()=>{const s=getImplicit({field:(x,y,z)=>(x*x+y*y+z*z)-.4,isoValue:.04});assert.ok(s.metadata.triangles>0);s.dispose();for(const opts of [{field:()=>1},{field:x=>x},{field:()=>NaN},{maxTriangles:1},{resolution:3}])assert.throws(()=>getImplicit(opts),/empty|boundary|truncat|finite|capacity|triangle|resolution/i);});

test('Bezier planar layers have outward front/back normals and four oriented wall boundaries',()=>{
 const controlPoints=Array.from({length:4},(_,u)=>Array.from({length:4},(_,v)=>[u,v,0]));
 const s=getShell({controlPoints,thickness:.2,segmentsU:2,segmentsV:3,uvMeters:.5});
 assert.ok(hit(s,.3,.7,'outer').normal.z>.999);assert.ok(hit(s,.3,.7,'inner').normal.z<-.999);
 assert.equal(hit(s,.3,.7,'outer').point.z,0);assert.ok(Math.abs(hit(s,.3,.7,'inner').point.z+.2)<1e-7);closed(s.geometry);s.dispose();
});
test('loft caps triangulate a concave ring with the true polygon area and separate normals',()=>{
 const s=getLoft({stations:[{center:[0,0,0],profile},{center:[0,3,0],profile}]});
 const cap=s.geometry.groups[1];let area=0;
 for(let i=cap.start/3;i<(cap.start+cap.count)/3;i++){const tri=new T.Triangle(...verts(s.geometry,i));area+=tri.getArea();assert.ok(tri.getNormal(new T.Vector3()).y<-.999);}
 let expected=0;for(let i=0;i<profile.length;i++){const a=profile[i],b=profile[(i+1)%profile.length];expected+=a[0]*b[1]-a[1]*b[0];}
 assert.ok(Math.abs(area-Math.abs(expected)/2)<1e-6);s.dispose();
});
test('non-SDF polynomial union produces a connected fusion rather than disconnected overlapping meshes',()=>{
 const smoothMin=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
 const s=getImplicit({field:(x,y,z)=>smoothMin((x+.35)**2+y*y+z*z-.2,(x-.35)**2+y*y+z*z-.2,.18)});
 const p=s.geometry.attributes.position;let waist=0;
 for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))<.1&&Math.hypot(p.getY(i),p.getZ(i))>.2)waist++;
 assert.ok(waist>10);assert.ok(s.metadata.triangles>100);s.dispose();
});
test('MC temporary geometry and material release on success and overflow',()=>{
 for(const options of [{},{maxTriangles:1}]){
   const instances=[];class ObservedMC extends MarchingCubes{constructor(...args){super(...args);this.released=0;this.materialReleased=0;this.geometry.addEventListener('dispose',()=>this.released++);this.material?.addEventListener('dispose',()=>this.materialReleased++);instances.push(this);}}
   let source;try{source=create(implicit,'createImplicitSurfaceSource',{MarchingCubes:ObservedMC},{field:(x,y,z)=>Math.hypot(x,y,z)-.65,bounds,resolution:24,...options});}catch(e){assert.match(e.message,/capacity/);}
   assert.equal(instances.length,1);assert.ok(instances[0].material instanceof T.Material);assert.equal(instances[0].released,1);assert.equal(instances[0].materialReleased,1);
   if(source){assert.notEqual(source.geometry,instances[0].geometry);source.dispose();}
 }
});
