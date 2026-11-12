import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHeightFieldGeometry} from '../../assets/environment/height-field.mjs';
import {clipConvexPolygon} from '../../assets/geometry/bounded-profile.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
let api={};try{api=await import('../../assets/environment/terrain-roads.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const rectangle=[[-3,-3],[3,-3],[3,3],[-3,3]];
function terrain(sample=(x,z)=>({height:Math.sin(x*1.5)*2+Math.cos(z*1.2),dx:3*Math.cos(x*1.5),dz:-1.2*Math.sin(z*1.2)}),segments=8){return createHeightFieldGeometry(T,{sample},{sizeX:8,sizeZ:8,segmentsX:segments,segmentsZ:segments});}
function make(g,options={}){assert.equal(typeof api.createTerrainRoadSource,'function');return api.createTerrainRoadSource(T,{terrainGeometry:g,surfaces:[{outer:rectangle,holes:[]}],...options});}
function mesh(g,side=T.FrontSide){return new T.Mesh(g,new T.MeshBasicMaterial({side}));}
function down(g,x,z,side=T.FrontSide){const m=mesh(g,side),hits=new T.Raycaster(new T.Vector3(x,30,z),new T.Vector3(0,-1,0)).intersectObject(m);m.material.dispose();return hits;}
function up(g,x,z){const m=mesh(g),hits=new T.Raycaster(new T.Vector3(x,-30,z),new T.Vector3(0,1,0)).intersectObject(m);m.material.dispose();return hits;}
const near=(a,b,t=2e-5)=>assert.ok(Math.abs(a-b)<t,`${a} vs ${b}`);
function triangles(g,group){const p=g.attributes.position,result=[];for(let i=group.start;i<group.start+group.count;i+=3)result.push([0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]));return result;}
const area=r=>Math.abs(r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-a[1]*b[0];},0))/2;
test('drapes the rendered undulating triangles, supplies an actual underside, and leaves a hole empty',()=>{
 const g=terrain(),hole=[[-.8,-.8],[-.8,.8],[.8,.8],[.8,-.8]],road=make(g,{surfaces:[{outer:rectangle,holes:[hole]}],thickness:.2});
 assert.deepEqual(road.geometry.groups.map(g=>g.materialIndex),[0,1,2]);
 assert.ok(road.stats.topTriangles>0);assert.equal(road.stats.topTriangles,road.stats.undersideTriangles);assert.equal(road.stats.outputTriangles,road.stats.topTriangles+road.stats.undersideTriangles+road.stats.wallTriangles);
 for(let x=-2.91;x<3;x+=.43)for(let z=-2.87;z<3;z+=.47){if(Math.abs(x)<.8&&Math.abs(z)<.8){assert.equal(road.query(x,z),null);assert.equal(down(road.geometry,x,z).length,0);continue;}
  const ground=down(g,x,z)[0],top=down(road.geometry,x,z)[0],bottom=up(road.geometry,x,z)[0];assert.ok(top&&bottom&&ground);near(top.point.y,ground.point.y+.2);near(bottom.point.y,ground.point.y);near(road.query(x,z).height,ground.point.y);near(road.query(x,z).topHeight,top.point.y);assert.ok(top.face.normal.y>0);assert.ok(bottom.face.normal.y<0);
 }
 // Analytic source is deliberately nonlinear: mesh-plane interpolation is authoritative.
 const hit=down(g,-2.65,1.37)[0];assert.ok(Math.abs(hit.point.y-(Math.sin(-2.65*1.5)*2+Math.cos(1.37*1.2)))>.05);
 road.dispose();g.dispose();
});
test('non-axis union top has exact area, no positive-area overlaps, no valley-spanning caps or internal walls',()=>{
 const g=terrain(),outer=[[-3,-2],[-1,-2],[-1,-3],[1,-3],[1,-1],[3,1],[2,2],[0,0],[-3,0]],road=make(g,{surfaces:[{outer,holes:[]}]});
 const tops=triangles(road.geometry,road.geometry.groups[0]);let sum=0;
 for(let i=0;i<tops.length;i++){const p=tops[i].map(p=>[p[0],p[2]]);sum+=area(p);for(let j=0;j<i;j++){const q=tops[j].map(p=>[p[0],p[2]]);if(Math.max(...p.map(p=>p[0]))<=Math.min(...q.map(p=>p[0]))||Math.min(...p.map(p=>p[0]))>=Math.max(...q.map(p=>p[0]))||Math.max(...p.map(p=>p[1]))<=Math.min(...q.map(p=>p[1]))||Math.min(...p.map(p=>p[1]))>=Math.max(...q.map(p=>p[1])))continue;assert.ok(area(clipConvexPolygon(p,q,{epsilon:1e-7}))<2e-6);}
  const c=[0,1,2].map(k=>tops[i].reduce((s,p)=>s+p[k],0)/3);near(c[1],down(g,c[0],c[2])[0].point.y+.12);
 }
 near(sum,area(outer),5e-5);
 const walls=triangles(road.geometry,road.geometry.groups[2]);for(const tri of walls){const c=[0,2].map(k=>tri.reduce((s,p)=>s+p[k],0)/3);assert.ok(outer.some((a,i)=>{const b=outer[(i+1)%outer.length],cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);return Math.abs(cross)<1e-5&&c[0]>=Math.min(a[0],b[0])-1e-5&&c[0]<=Math.max(a[0],b[0])+1e-5&&c[1]>=Math.min(a[1],b[1])-1e-5&&c[1]<=Math.max(a[1],b[1])+1e-5;}));}
 road.dispose();g.dispose();
});
test('outer and hole walls are finite physical outward-facing boundaries, including terrain diagonal crossings',()=>{
 const g=terrain((x,z)=>({height:.3*x+.2*z,dx:.3,dz:.2})),road=make(g,{surfaces:[{outer:rectangle,holes:[[[-1,-1],[-1,1],[1,1],[1,-1]]]}],thickness:.25}),m=mesh(road.geometry);
 for(const [x,z,dx,dz,nx,nz]of [[-3.5,.37,1,0,-1,0],[3.5,.37,-1,0,1,0],[.37,-3.5,0,1,0,-1],[.37,3.5,0,-1,0,1],[0,.37,1,0,-1,0],[0,.37,-1,0,1,0]]){
  const targetX=dx? (x===0?Math.sign(dx):Math.sign(x)*3):x,targetZ=dz?Math.sign(z)*3:z,y=.3*targetX+.2*targetZ+.125;
  const ray=new T.Raycaster(new T.Vector3(x,y,z),new T.Vector3(dx,0,dz),0,1.1),hits=ray.intersectObject(m);assert.ok(hits.length,`${x},${z}`);near(hits[0].face.normal.x,nx);near(hits[0].face.normal.z,nz);
 }
 assert.equal(new T.Raycaster(new T.Vector3(-3.5,.3*-3+.2*.37+.5,.37),new T.Vector3(1,0,0),0,.6).intersectObject(m).length,0);
 m.material.dispose();road.dispose();g.dispose();
});
test('actual opposite cell diagonal and shuffled triangle index order are honored',()=>{
 const g=terrain((x,z)=>({height:x*z,dx:z,dz:x}),2),idx=[];for(let j=0;j<2;j++)for(let i=0;i<2;i++){const a=j*3+i,b=a+1,c=a+3,d=c+1;idx.unshift(a,c,d,a,d,b);}g.setIndex(idx);const road=make(g);
 for(const [x,z]of [[-2.7,-2.2],[-1.1,2.3],[2.1,1.2],[.4,-1.3]])near(down(road.geometry,x,z)[0].point.y,down(g,x,z)[0].point.y+.12);
 road.dispose();g.dispose();
});
test('ownership is detached, disposal idempotent, bad inputs and budgets reject without touching borrowed terrain',()=>{
 const g=terrain(),before=[...g.attributes.position.array],index=[...g.index.array],surfaces=[{outer:rectangle.map(p=>[...p]),holes:[]}];let terrainDisposals=0;g.addEventListener('dispose',()=>terrainDisposals++);const road=make(g,{surfaces});let disposals=0;road.geometry.addEventListener('dispose',()=>disposals++);surfaces[0].outer[0][0]=999;assert.ok(road.query(-2.5,-2.5));road.dispose();road.dispose();assert.equal(disposals,1);assert.equal(terrainDisposals,0);assert.deepEqual([...g.attributes.position.array],before);assert.deepEqual([...g.index.array],index);
 for(const patch of [{thickness:0},{thickness:NaN},{epsilon:0},{maxCandidatePairs:1},{maxOutputTriangles:1},{maxTerrainTriangles:1},{maxRoadVertices:3},{maxCandidatePairs:Infinity},{surfaces:[{outer:[[0,0],[2,2],[0,2],[2,0]],holes:[]}]},{surfaces:[{outer:rectangle,holes:[[[2,2],[4,2],[4,4],[2,4]]]}]},{surfaces:[{outer:rectangle},{outer:[[-1,-1],[2,-1],[2,2],[-1,2]]}]},{surfaces:[{outer:[[-5,-1],[0,-1],[0,1],[-5,1]]}]}])assert.throws(()=>make(g,patch));
 assert.equal(terrainDisposals,0);assert.deepEqual([...g.attributes.position.array],before);
 const irregular=g.clone();irregular.attributes.position.setX(1,-2.9);assert.throws(()=>make(irregular),/regular|grid/i);irregular.dispose();
 const broken=g.clone();broken.index.setX(0,broken.index.getX(1));assert.throws(()=>make(broken),/triang|grid|cell/i);broken.dispose();
 assert.throws(()=>make(new T.Mesh(g)),/BufferGeometry|mesh/i);
 const morphed=g.clone();morphed.morphAttributes.position=[g.attributes.position.clone()];assert.throws(()=>make(morphed),/morph|deform/i);morphed.dispose();g.dispose();
});
test('allocation failure disposes the generated geometry and never the borrowed geometry',()=>{
 const g=terrain();let own=0,borrowed=0;g.addEventListener('dispose',()=>borrowed++);
 class BrokenGeometry extends T.BufferGeometry{constructor(){super();this.addEventListener('dispose',()=>own++);}setAttribute(){throw new Error('deliberate upload failure');}}
 assert.equal(typeof api.createTerrainRoadSource,'function');assert.throws(()=>api.createTerrainRoadSource({...T,BufferGeometry:BrokenGeometry},{terrainGeometry:g,surfaces:[{outer:rectangle}]}),/deliberate/);assert.equal(own,1);assert.equal(borrowed,0);g.dispose();
});
test('queries are build-time snapshots with geometric face normals, and refuse use after disposal',()=>{
 const g=terrain((x,z)=>({height:.3*x+.2*z,dx:17,dz:-19})),road=make(g,{thickness:.4}),q=road.query(1.3,.7);
 near(q.height,.53);near(q.topHeight,.93);near(q.normal[0],-.3/Math.sqrt(1.13));near(q.normal[1],1/Math.sqrt(1.13));near(q.normal[2],-.2/Math.sqrt(1.13));
 g.attributes.position.array.fill(0);g.index.array.fill(0);assert.deepEqual(road.query(1.3,.7),q);near(down(road.geometry,1.3,.7)[0].point.y,.93);
 q.normal.fill(99);assert.ok(road.query(1.3,.7).normal[1]<1);assert.throws(()=>road.query(NaN,0));road.dispose();assert.throws(()=>road.query(1.3,.7),/disposed/i);g.dispose();
});
test('boundary walls and top/underside share exact Float32 seam vertices and internal seams have matching edges',()=>{
 const g=terrain(),outer=[[-2.91,-2.73],[2.83,-2.51],[2.61,2.77],[-2.67,2.93]],road=make(g,{surfaces:[{outer,holes:[[[0,-1.27],[-1.13,.17],[.31,1.21],[1.39,-.11]]]}]});
 const key=p=>p.join(','),tops=triangles(road.geometry,road.geometry.groups[0]),bottoms=triangles(road.geometry,road.geometry.groups[1]),topPoints=new Set(tops.flat().map(key)),bottomPoints=new Set(bottoms.flat().map(key));
 for(const tri of triangles(road.geometry,road.geometry.groups[2]))for(const p of tri)assert.ok(topPoints.has(key(p))||bottomPoints.has(key(p)),`unshared wall vertex ${p}`);
 const counts=new Map();for(const tri of tops)for(let i=0;i<3;i++){const edge=[key(tri[i]),key(tri[(i+1)%3])].sort().join('/');counts.set(edge,(counts.get(edge)??0)+1);}
 const walls=new Set();for(const tri of triangles(road.geometry,road.geometry.groups[2]))for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3];if(topPoints.has(key(a))&&topPoints.has(key(b)))walls.add([key(a),key(b)].sort().join('/'));}
 for(const [edge,count]of counts){assert.ok(count===1||count===2);if(count===1)assert.ok(walls.has(edge),`open internal edge ${edge}`);}
 road.dispose();g.dispose();
});
test('road island inside another component hole remains a disjoint supported union',()=>{
 const g=terrain(),road=make(g,{surfaces:[{outer:rectangle,holes:[[[-2,-2],[-2,2],[2,2],[2,-2]]]},{outer:[[-1,-1],[1,-1],[1,1],[-1,1]]}]});
 assert.equal(down(road.geometry,1.5,.3).length,0);near(down(road.geometry,.3,.2)[0].point.y,down(g,.3,.2)[0].point.y+.12);assert.ok(road.query(.3,.2));road.dispose();g.dispose();
});
test('world-layout oblique junction and loop-hole union is consumed directly without stacked rectangles',async()=>{
 const {compileWorldLayout}=await import('../../assets/scene/world-layout.mjs');
 for(const [nodes,edges]of [
  [[{id:'a',x:-2.5,z:-2},{id:'b',x:2.5,z:-1},{id:'c',x:2,z:2.5},{id:'d',x:-2.3,z:2}], [['a','b'],['b','c'],['c','d'],['d','a']]],
  [[{id:'o',x:0,z:0},{id:'a',x:-2.7,z:-1.8},{id:'b',x:2.5,z:-2},{id:'c',x:.3,z:2.5}], [['o','a'],['o','b'],['o','c']]]
 ]){
  const world=compileWorldLayout({levels:[{id:'ground',y:0,nodes,edges:edges.map(([from,to],i)=>({id:`road-${i}`,from,to,width:.7}))}],regions:[]}),surfaces=world.levels[0].surfaces,g=terrain(),road=make(g,{surfaces});
  const expected=surfaces.reduce((sum,s)=>sum+area(s.outer)-s.holes.reduce((sum,h)=>sum+area(h),0),0),actual=triangles(road.geometry,road.geometry.groups[0]).reduce((sum,t)=>sum+area(t.map(p=>[p[0],p[2]])),0);near(actual,expected,5e-5);
  for(let x=-3.17;x<3.2;x+=.21)for(let z=-3.19;z<3.2;z+=.23){const q=road.query(x,z);if(q)near(down(road.geometry,x,z)[0].point.y,down(g,x,z)[0].point.y+.12);else assert.equal(down(road.geometry,x,z).length,0);}
  road.dispose();g.dispose();
 }
});

// Frozen R72 world-layout union: three district branches + campus-mouth hole.
// Several Earcut bridge triangles lie on z=±1.7 within floating-point roundoff.
const districtUnion=[{"outer":[[-91.7,2.220446049250313e-16],[-91.64207390469142,-0.4399923766742853],[-91.6,-0.5415677680023062],[-91.6,-82],[-91.54548132206251,-82.41411047216404],[-91.38564064605511,-82.8],[-91.13137084989847,-83.13137084989847],[-90.8,-83.38564064605511],[-90.41411047216403,-83.54548132206251],[-90,-83.6],[-89.58588952783597,-83.54548132206251],[-89.2,-83.38564064605511],[-88.86862915010153,-83.13137084989847],[-88.6143593539449,-82.8],[-88.45451867793749,-82.41411047216404],[-88.4,-82],[-88.4,-1.6999999999999886],[-63.60000000000001,-1.7],[-63.6,-56],[-63.54548132206251,-56.41411047216403],[-63.3856406460551,-56.8],[-63.131370849898474,-57.131370849898474],[-62.8,-57.3856406460551],[-62.41411047216403,-57.54548132206251],[-62,-57.6],[-61.58588952783597,-57.54548132206251],[-61.2,-57.3856406460551],[-60.868629150101526,-57.131370849898474],[-60.6143593539449,-56.8],[-60.45451867793749,-56.41411047216403],[-60.4,-56],[-60.4,-1.7],[-36.4,-1.7],[-36.4,-30],[-36.3522961568047,-30.36234666314353],[-36.212435565298215,-30.7],[-35.989949493661165,-30.989949493661165],[-35.7,-31.212435565298215],[-35.362346663143526,-31.352296156804695],[-35,-31.4],[35,-31.4],[35.362346663143526,-31.352296156804695],[35.7,-31.212435565298215],[35.989949493661165,-30.989949493661168],[36.212435565298215,-30.7],[36.3522961568047,-30.36234666314353],[36.4,-30],[36.4,-1.6999999999999993],[60.4,-1.7],[60.4,-54.4],[0,-54.4],[-0.414110472164033,-54.45451867793749],[-0.7999999999999997,-54.6143593539449],[-1.131370849898476,-54.868629150101526],[-1.385640646055102,-55.2],[-1.5454813220625092,-55.58588952783597],[-1.6,-56],[-1.5454813220625094,-56.41411047216403],[-1.3856406460551023,-56.8],[-1.1313708498984767,-57.131370849898474],[-0.8000000000000007,-57.3856406460551],[-0.414110472164033,-57.54548132206251],[0,-57.6],[62,-57.6],[62.41411047216403,-57.54548132206251],[62.8,-57.3856406460551],[63.131370849898474,-57.131370849898474],[63.3856406460551,-56.8],[63.54548132206251,-56.41411047216403],[63.6,-56],[63.6,-1.7],[88.4,-1.7000000000000002],[88.4,-80.4],[0,-80.4],[-0.414110472164033,-80.45451867793749],[-0.7999999999999997,-80.61435935394489],[-1.131370849898476,-80.86862915010153],[-1.385640646055102,-81.2],[-1.5454813220625092,-81.58588952783596],[-1.6,-82],[-1.5454813220625094,-82.41411047216404],[-1.3856406460551023,-82.8],[-1.1313708498984767,-83.13137084989847],[-0.8000000000000007,-83.38564064605511],[-0.414110472164033,-83.54548132206251],[0,-83.6],[90,-83.6],[90.41411047216403,-83.54548132206251],[90.8,-83.38564064605511],[91.13137084989847,-83.13137084989847],[91.3856406460551,-82.8],[91.54548132206251,-82.41411047216404],[91.6,-82],[91.6,-0.5415677680022952],[91.64207390469142,-0.43999237667428664],[91.7,0],[91.64207390469142,0.43999237667428526],[91.6,0.5415677680023062],[91.6,82],[91.54548132206251,82.41411047216403],[91.38564064605511,82.8],[91.13137084989847,83.13137084989847],[90.8,83.38564064605511],[90.41411047216403,83.54548132206251],[90,83.6],[89.58588952783597,83.54548132206251],[89.2,83.38564064605511],[88.86862915010153,83.13137084989847],[88.61435935394489,82.8],[88.45451867793749,82.41411047216404],[88.4,82],[88.4,1.6999999999999886],[63.60000000000001,1.7],[63.6,56],[63.54548132206251,56.41411047216403],[63.3856406460551,56.8],[63.131370849898474,57.131370849898474],[62.8,57.3856406460551],[62.41411047216403,57.54548132206251],[62,57.6],[61.58588952783597,57.54548132206251],[61.2,57.3856406460551],[60.868629150101526,57.131370849898474],[60.6143593539449,56.8],[60.45451867793749,56.41411047216403],[60.4,56],[60.4,1.7],[36.4,1.7],[36.4,30],[36.3522961568047,30.36234666314353],[36.212435565298215,30.7],[35.989949493661165,30.989949493661165],[35.7,31.212435565298215],[35.362346663143526,31.352296156804695],[35,31.4],[-35,31.4],[-35.362346663143526,31.352296156804695],[-35.7,31.212435565298215],[-35.989949493661165,30.989949493661168],[-36.212435565298215,30.7],[-36.3522961568047,30.36234666314353],[-36.4,30],[-36.4,1.6999999999999993],[-60.4,1.7],[-60.4,54.4],[0,54.4],[0.4141104721640325,54.45451867793749],[0.8000000000000003,54.6143593539449],[1.1313708498984758,54.868629150101526],[1.3856406460551014,55.2],[1.545481322062509,55.58588952783597],[1.6,56],[1.5454813220625094,56.41411047216403],[1.385640646055102,56.8],[1.1313708498984762,57.131370849898474],[0.8000000000000003,57.3856406460551],[0.4141104721640332,57.54548132206251],[0,57.6],[-62,57.6],[-62.41411047216403,57.54548132206251],[-62.8,57.3856406460551],[-63.131370849898474,57.131370849898474],[-63.3856406460551,56.8],[-63.54548132206251,56.41411047216403],[-63.6,56],[-63.6,1.7],[-88.4,1.7000000000000002],[-88.4,80.4],[0,80.4],[0.4141104721640325,80.45451867793749],[0.8000000000000003,80.61435935394489],[1.1313708498984758,80.86862915010153],[1.3856406460551014,81.2],[1.545481322062509,81.58588952783596],[1.6,82],[1.5454813220625094,82.41411047216403],[1.385640646055102,82.8],[1.1313708498984762,83.13137084989847],[0.8000000000000003,83.38564064605511],[0.4141104721640332,83.54548132206251],[0,83.6],[-90,83.6],[-90.41411047216403,83.54548132206251],[-90.8,83.38564064605511],[-91.13137084989847,83.13137084989847],[-91.38564064605511,82.8],[-91.54548132206251,82.41411047216404],[-91.6,82],[-91.6,0.5415677680022952],[-91.64207390469142,0.4399923766742857]],"holes":[[[-33.6,-28.6],[-33.6,-1.3],[-18,-1.3],[-18,1.3],[-33.6,1.3],[-33.6,28.6],[33.6,28.6],[33.6,1.3],[18,1.3],[18,-1.3],[33.6,-1.3],[33.6,-28.6]]]}];
test('district union collinear triangulation bridges retain source area, holes and full-width mesh support',()=>{
 const g=createHeightFieldGeometry(T,{sample:(x,z)=>({height:3*Math.sin(x*.1)+Math.cos(z*.2),dx:.3*Math.cos(x*.1),dz:-.2*Math.sin(z*.2)})},{sizeX:240,sizeZ:240,segmentsX:160,segmentsZ:160});
 const road=make(g,{surfaces:districtUnion,maxCandidatePairs:4000000,maxValidationPairs:8000000});
 const tops=triangles(road.geometry,road.geometry.groups[0]),actual=tops.reduce((sum,t)=>sum+area(t.map(p=>[p[0],p[2]])),0),expected=districtUnion.reduce((sum,s)=>sum+area(s.outer)-s.holes.reduce((sum,h)=>sum+area(h),0),0);near(actual,expected,.005);
 for(const [x,z]of [[0,0],[10,0],[-10,0],[0,20],[0,-20]]){assert.equal(road.query(x,z),null);assert.equal(down(road.geometry,x,z).length,0);}
 for(const [x,z]of [[50,0],[75,0],[-50,0],[-75,0],[35,-25],[35,25],[62,-40],[62,40],[90,-65],[90,65],[20,30],[-20,-30]])for(const across of [-1.1,0,1.1]){const xx=x+across,q=road.query(xx,z);assert.ok(q,`${xx},${z}`);near(down(road.geometry,xx,z)[0].point.y,down(g,xx,z)[0].point.y+.12,4e-5);near(up(road.geometry,xx,z)[0].point.y,down(g,xx,z)[0].point.y,4e-5);}
 const topEdges=new Map(),topPoints=new Set(tops.flat().map(p=>p.join(','))),wallEdges=new Set();
 for(const tri of tops)for(let i=0;i<3;i++){const edge=[tri[i].join(','),tri[(i+1)%3].join(',')].sort().join('/');topEdges.set(edge,(topEdges.get(edge)??0)+1);}
 for(const tri of triangles(road.geometry,road.geometry.groups[2]))for(let i=0;i<3;i++){const a=tri[i].join(','),b=tri[(i+1)%3].join(',');if(topPoints.has(a)&&topPoints.has(b))wallEdges.add([a,b].sort().join('/'));}
 for(const [edge,count]of topEdges){assert.ok(count===1||count===2);if(count===1)assert.ok(wallEdges.has(edge),`unmatched district top edge ${edge}`);}
 road.dispose();g.dispose();
});

function shellAudit(geometry){
 const p=geometry.attributes.position,incidence=new Map();let topInverted=0,topVertical=0;
 for(let i=0;i<p.count;i+=3){const tri=[0,1,2].map(k=>[p.getX(i+k),p.getY(i+k),p.getZ(i+k)]);if(i<geometry.groups[0].count){const d=(tri[1][0]-tri[0][0])*(tri[2][2]-tri[0][2])-(tri[1][2]-tri[0][2])*(tri[2][0]-tri[0][0]);topInverted+=d>0;topVertical+=d===0;}for(let k=0;k<3;k++){const a=tri[k].join(','),b=tri[(k+1)%3].join(','),key=[a,b].sort().join('/'),[count,balance]=incidence.get(key)??[0,0];incidence.set(key,[count+1,balance+(a<b?1:-1)]);}}
 return {topInverted,topVertical,badEdges:[...incidence.values()].filter(([n,b])=>n!==2||b!==0).length};
}
function translatedTerrain(segments=8,offset=90000,sample=(x,z)=>({height:Math.sin(x)+Math.cos(z),dx:0,dz:0})){const g=createHeightFieldGeometry(T,{sample},{sizeX:8,sizeZ:8,segmentsX:segments,segmentsZ:segments,center:[offset,offset]}),index=[];for(let j=0;j<segments;j++)for(let i=0;i<segments;i++){const a=j*(segments+1)+i,b=a+1,c=a+segments+1,d=c+1;index.push(...((i+j)%2?[a,c,d,a,d,b]:[a,c,b,c,d,b]));}g.setIndex(index);return g;}
test('wide near-grid rectangles have a closed conforming shell instead of epsilon cracks',()=>{
 for(const z of [7.5e-8,-2.5e-8]){const g=translatedTerrain(8,0,()=>({height:0,dx:0,dz:0})),road=make(g,{surfaces:[{outer:[[-2.633,z],[2.78,z],[2.78,2.68],[-2.633,2.68]]}]});assert.deepEqual(shellAudit(road.geometry),{topInverted:0,topVertical:0,badEdges:0});for(const x of [-2.4,.31,2.6]){assert.ok(road.query(x,z+2e-8));assert.ok(down(road.geometry,x,z+2e-8)[0]);}road.dispose();g.dispose();}
});
test('thin valid input either has represented positive top support or explicitly rejects precision',()=>{
 const g=translatedTerrain(8,0,()=>({height:0,dx:0,dz:0})),d=1.5e-8,outer=[[-3,.2],[3,.2+d],[0,.2+2*d]];let road;
 try{road=make(g,{surfaces:[{outer}]});}catch(error){assert.match(error.message,/precision|represent|degenerat/i);g.dispose();return;}
 assert.ok(road.stats.topTriangles>0);assert.deepEqual(shellAudit(road.geometry),{topInverted:0,topVertical:0,badEdges:0});const q=road.query(.51,.2+d*1.25);if(q)assert.ok(down(road.geometry,.51,.2+d*1.25)[0]);road.dispose();g.dispose();
});
test('translated coherent inputs cannot succeed with inverted, vertical or overlapping projected caps',()=>{
 const outer=[[90000.967,89997.435],[90003.184,89998.738],[90001.904,90002.28],[89998.374,90001.59],[89997.864,89998.83]],g=translatedTerrain();let road;
 try{road=make(g,{surfaces:[{outer}]});}catch(error){assert.match(error.message,/precision|represent|project|degenerat/i);g.dispose();return;}
 assert.deepEqual(shellAudit(road.geometry),{topInverted:0,topVertical:0,badEdges:0});const tops=triangles(road.geometry,road.geometry.groups[0]);for(let i=0;i<tops.length;i++){const p=tops[i].map(v=>[v[0]-90000,v[2]-90000]);for(let j=0;j<i;j++){const q=tops[j].map(v=>[v[0]-90000,v[2]-90000]);assert.ok(area(clipConvexPolygon(p,q,{epsilon:1e-10}))<1e-10);}}road.dispose();g.dispose();
});
test('steep translated plane heights are evaluated at the represented Float32 XZ',()=>{
 const o=90000,g=translatedTerrain(1,o,(x,z)=>({height:50*(x-o),dx:50,dz:0})),road=make(g,{surfaces:[{outer:[[o+.005,o+.25],[o+2.005,o+.25],[o+2.005,o+3],[o+.005,o+3]]}]});
 assert.deepEqual(shellAudit(road.geometry),{topInverted:0,topVertical:0,badEdges:0});const p=road.geometry.attributes.position;for(let i=0;i<road.geometry.groups[0].count;i++)near(p.getY(i),50*(p.getX(i)-o)+.12,2e-5);
 const material=new T.MeshBasicMaterial(),ray=new T.Raycaster(new T.Vector3(o+.025,1000,o+.27),new T.Vector3(0,-1,0)),ground=ray.intersectObject(new T.Mesh(g,material))[0],top=ray.intersectObject(new T.Mesh(road.geometry,material))[0];assert.ok(top&&ground);near(top.point.y,ground.point.y+.12,2e-5);near(road.query(o+.025,o+.27).topHeight,top.point.y,2e-5);material.dispose();road.dispose();g.dispose();
});
test('query uses the represented footprint with strict outer/hole exclusion and no epsilon expansion',()=>{
 const g=terrain(()=>({height:0,dx:0,dz:0})),road=make(g,{surfaces:[{outer:rectangle,holes:[[[-1,-1],[-1,1],[1,1],[1,-1]]]}]});for(const [x,z]of [[3+4e-8,.232],[-3-4e-8,.232],[.232,3+4e-8],[.232,-3-4e-8],[1-4e-8,.232],[-1+4e-8,.232]]){assert.equal(road.query(x,z),null);assert.equal(down(road.geometry,x,z).length,0);}for(const [x,z]of [[3-4e-8,.232],[1+4e-8,.232]]){assert.ok(road.query(x,z));assert.ok(down(road.geometry,x,z)[0]);}road.dispose();g.dispose();
});
test('terrain index must be a nonnormalized scalar unsigned element layout',()=>{
 const g=terrain(),raw=[...g.index.array];for(const invalid of [new T.Uint16BufferAttribute(raw.flatMap(id=>[id,0]),2),new T.Float32BufferAttribute(raw,1),new T.Int16BufferAttribute(raw,1),new T.Uint16BufferAttribute(raw,1,true)]){const bad=g.clone();bad.setIndex(invalid);assert.throws(()=>make(bad),/index|element|unsigned|scalar/i);bad.dispose();}g.dispose();
});

test('coherent translated road polygons remain supported without rebasing the shared coordinate frame',()=>{
 const o=90000,g=translatedTerrain(),outer=[[.213,-2.565],[2.43,-1.262],[1.15,2.28],[-2.38,1.59],[-2.89,-1.17]].map(p=>p.map(v=>v+o)),road=make(g,{surfaces:[{outer}]});assert.deepEqual(shellAudit(road.geometry),{topInverted:0,topVertical:0,badEdges:0});assert.ok(road.geometry.boundingBox.min.x>89990);const q=road.query(o+.51,o+.2);assert.ok(q);near(q.topHeight,down(road.geometry,o+.51,o+.2)[0].point.y);road.dispose();g.dispose();
});

test('sign-changing support has one realizable affine error bound rather than a smaller interior pointwise claim',()=>{
 const g=createHeightFieldGeometry(T,{sample:(x,z)=>({height:x*50000,dx:50000,dz:0})},{sizeX:2,sizeZ:2,segmentsX:1,segmentsZ:1}),road=make(g,{surfaces:[{outer:[[-1,-1],[1,-1],[1,1],[-1,1]]}],thickness:.12}),material=new T.MeshBasicMaterial();
 for(const [x,z]of [[0,.125],[.000002,.125],[-.000002,.125],[.41,-.31]]){const ray=new T.Raycaster(new T.Vector3(x,100000,z),new T.Vector3(0,-1,0)),ground=ray.intersectObject(new T.Mesh(g,material))[0].point.y,top=ray.intersectObject(new T.Mesh(road.geometry,material))[0].point.y,q=road.query(x,z);assert.ok(q);assert.ok(Number.isFinite(q.supportTolerance)&&q.supportTolerance>0&&q.supportTolerance<=.12/4);assert.ok(Math.abs(top-ground-.12)<=q.supportTolerance);near(q.topHeight,top,1e-8);}
 assert.ok(road.stats.maxSupportError<=road.stats.maxSupportTolerance);assert.ok(road.stats.maxSupportTolerance<=.12/4);material.dispose();road.dispose();g.dispose();
});
test('encountered unsigned fixed-restart values reject and widening the same real grid remains valid',()=>{
 for(const [segments,Narrow,Wide]of [[15,T.Uint8BufferAttribute,T.Uint16BufferAttribute],[255,T.Uint16BufferAttribute,T.Uint32BufferAttribute]]){
  const g=createHeightFieldGeometry(T,{sample:()=>({height:0,dx:0,dz:0})},{sizeX:8,sizeZ:8,segmentsX:segments,segmentsZ:segments}),raw=[...g.index.array],outer=[[3.9,3.9],[4,3.9],[4,4],[3.9,4]];g.setIndex(new Narrow(raw,1));assert.throws(()=>make(g,{surfaces:[{outer}]}),/restart/i);g.setIndex(new Wide(raw,1));const road=make(g,{surfaces:[{outer}]});assert.ok(road.query(3.97,3.97));assert.ok(down(road.geometry,3.97,3.97)[0]);assert.deepEqual(shellAudit(road.geometry),{topInverted:0,topVertical:0,badEdges:0});road.dispose();g.dispose();
 }
 const g=terrain(),raw=[...g.index.array];raw[0]=4294967295;g.setIndex(new T.Uint32BufferAttribute(raw,1));assert.throws(()=>make(g),/restart/i);g.dispose();
});
test('actual plateau context constructs and roads retain measured terrain support near the former rejected diagonal',async()=>{
 const threeURL=pathToFileURL(resolve(process.env.THREE_MODULE)),{mergeGeometries}=await import(new URL('../examples/jsm/utils/BufferGeometryUtils.js',threeURL)),{buildLandscapeContext}=await import('../../assets/examples/landscape-context.mjs'),material=new T.MeshStandardMaterial();let context;
 try{context=buildLandscapeContext(T,{mergeGeometries,materialFor:()=>material,configuration:'grid',siteBounds:[-25,-25,25,25]});assert.ok(context.sites.length>0);const roadMesh=new T.Mesh(context.roads.geometry,material),terrainMesh=context.terrain,thickness=-context.prototypes[0].measuredBounds.minY;assert.ok(context.roads.stats.maxSupportError<=context.roads.stats.maxSupportTolerance);
  for(const [x,z]of [[36.046455356299134,26.953544643700866],[35,25],[62,-40],[90,65],[50,0],[-50,0]]){const q=context.roads.query(x,z),ray=new T.Raycaster(new T.Vector3(x,100,z),new T.Vector3(0,-1,0)),ground=ray.intersectObject(terrainMesh)[0],top=ray.intersectObject(roadMesh)[0];assert.ok(q&&ground&&top,`${x},${z}`);assert.ok(q.supportTolerance<=thickness/4);assert.ok(Math.abs(top.point.y-ground.point.y-thickness)<=q.supportTolerance+1e-10);near(q.topHeight,top.point.y,1e-8);}
 }finally{context?.dispose();material.dispose();}
});

test('prepared terrain snapshot is immutable and isolated; failed and disposed borrowers do not release siblings',()=>{
 const g=terrain(()=>({height:2,dx:0,dz:0})),options={surfaces:[{outer:rectangle}]};
 assert.equal(typeof api.prepareTerrainRoadSupport,'function');
 const old=api.prepareTerrainRoadSupport({terrainGeometry:g});
 assert.ok(Object.isFrozen(old));const build=(terrainSupport,extra)=>api.createTerrainRoadSource(T,{...options,terrainSupport,...extra});
 const a=build(old);for(let i=0;i<g.attributes.position.count;i++)g.attributes.position.setY(i,7);
 const next=api.prepareTerrainRoadSupport({terrainGeometry:g}),b=build(old),c=build(next);
 near(a.query(0,0).height,2);near(b.query(0,0).height,2);near(c.query(0,0).height,7);
 assert.throws(()=>build(old,{maxOutputTriangles:1}),/maxOutputTriangles/);assert.throws(()=>build(old,{maxTerrainTriangles:1}),/maxTerrainTriangles/);
 assert.throws(()=>build(old,{epsilon:1e-4}),/epsilon/);assert.throws(()=>build(old,{terrainGeometry:g}),/exactly one|exclusive/i);
 a.dispose();near(b.query(0,0).height,2);
 old.dispose();old.dispose();assert.throws(()=>b.query(0,0),/disposed/i);assert.throws(()=>build(old),/disposed/i);
 near(c.query(0,0).height,7);b.dispose();c.dispose();next.dispose();g.dispose();
});
test('Float64 positions fail upfront even when CPU mesh reads could succeed',()=>{
 const g=terrain(),p=new T.BufferAttribute(new Float64Array(g.attributes.position.array),3);let reads=0;
 const read=p.getX.bind(p);p.getX=i=>{reads++;return read(i);};g.setAttribute('position',p);
 assert.throws(()=>make(g),/position.*Float32/i);assert.equal(reads,0);g.dispose();
});
test('Float32 positions must use the float GPU binding, not an integer pointer',()=>{
 const g=terrain();g.attributes.position.gpuType=T.IntType;
 assert.throws(()=>make(g),/position.*float/i);g.dispose();
});
