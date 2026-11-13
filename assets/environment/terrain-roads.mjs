import {clipConvexPolygon} from '../geometry/bounded-profile.mjs';

const finite=Number.isFinite;
const FLOAT_GPU_TYPE=1015; // THREE.FloatType in the pinned r187 attribute contract.
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area=r=>r.slice(1,-1).reduce((s,p,i)=>s+cross(r[0],p,r[i+2]),0)/2;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const edges=r=>r.map((a,i)=>[a,r[(i+1)%r.length]]);
function limit(value,name,ceiling){if(!Number.isInteger(value)||value<1||value>ceiling)throw new Error(`${name} must be an integer in 1..${ceiling}`);return value;}
function pointOn(p,a,b,epsilon){const l=distance(a,b);return Math.abs(cross(a,b,p))<=epsilon*l&&p[0]>=Math.min(a[0],b[0])-epsilon&&p[0]<=Math.max(a[0],b[0])+epsilon&&p[1]>=Math.min(a[1],b[1])-epsilon&&p[1]<=Math.max(a[1],b[1])+epsilon;}
function location(p,r,epsilon){let inside=false;for(const [a,b]of edges(r)){if(pointOn(p,a,b,epsilon))return 0;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<a[0]+(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]))inside=!inside;}return inside?1:-1;}
function touching(a,b,c,d,epsilon){
 if(Math.max(a[0],b[0])+epsilon<Math.min(c[0],d[0])||Math.max(c[0],d[0])+epsilon<Math.min(a[0],b[0])||Math.max(a[1],b[1])+epsilon<Math.min(c[1],d[1])||Math.max(c[1],d[1])+epsilon<Math.min(a[1],b[1]))return false;
 if(pointOn(a,c,d,epsilon)||pointOn(b,c,d,epsilon)||pointOn(c,a,b,epsilon)||pointOn(d,a,b,epsilon))return true;
 return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
}
const filled=(p,s,epsilon)=>location(p,s.outer,epsilon)>=0&&!s.holes.some(h=>location(p,h,epsilon)>=0);
function ring(input,ccw,epsilon,spend){
 const r=input.map(p=>{if(!Array.isArray(p)||p.length!==2||!p.every(x=>finite(x)&&Math.abs(x)<=100000))throw new Error('road rings require finite [x,z] coordinates within ±100000');return [...p];});
 for(let i=0;i<r.length;i++){
  if(distance(r[i],r[(i+1)%r.length])<=epsilon*8)throw new Error('road ring has repeated/short edge; omit closing vertex');
  for(let j=0;j<i;j++){spend();if(j===i-1||i===r.length-1&&j===0)continue;if(touching(r[i],r[(i+1)%r.length],r[j],r[(j+1)%r.length],epsilon))throw new Error('road ring self intersection');}
 }
 if(Math.abs(area(r))<=epsilon*epsilon)throw new Error('road ring has zero area');
 if((area(r)>0)!==ccw)r.reverse();return r;
}
function disjointBoundaries(a,b,epsilon,spend){for(const r of a)for(const s of b)for(const [p,q]of edges(r))for(const [u,v]of edges(s)){spend();if(touching(p,q,u,v,epsilon))throw new Error('road boundaries touch or intersect; provide already-unioned disjoint surfaces');}}
function upper(xs,x){let a=0,b=xs.length;while(a<b){const m=(a+b)>>1;if(xs[m]<=x)a=m+1;else b=m;}return a;}
function gridTerrain(g,epsilon,maxTriangles){
 if(!g?.isBufferGeometry||g.isInstancedBufferGeometry)throw new Error('terrainGeometry must be a non-instanced BufferGeometry, not a transformed Mesh');
 if(Object.values(g.morphAttributes??{}).some(v=>v.length))throw new Error('morphed/deformed terrain is unsupported');
 const p=g.getAttribute('position'),idx=g.getIndex();
 if(!idx||idx.itemSize!==1||idx.normalized||idx.isInterleavedBufferAttribute||idx.isInstancedBufferAttribute||!(idx.array instanceof Uint8Array||idx.array instanceof Uint16Array||idx.array instanceof Uint32Array))throw new Error('terrain index requires a scalar unsigned element BufferAttribute');
 // Deliberately narrow: this geometry's CPU samples and r187 WebGL positions
 // must represent the same values, without normalization or integer shader inputs.
 if(!p?.isBufferAttribute||p.itemSize!==3||p.normalized||p.gpuType!==FLOAT_GPU_TYPE||p.isInstancedBufferAttribute||!(p.array instanceof Float32Array))throw new Error('terrain position requires a nonnormalized, noninterleaved Float32 xyz BufferAttribute with float GPU binding');
 if(idx.count%3||idx.count/3>maxTriangles||p.count>maxTriangles*2+4)throw new Error('indexed regular grid terrain required within maxTerrainTriangles');
 const restart=idx.array instanceof Uint8Array?255:idx.array instanceof Uint16Array?65535:4294967295;for(let i=0;i<idx.count;i++)if(idx.array[i]===restart)throw new Error(`terrain index contains WebGL2 fixed primitive restart value ${restart}; widen the unsigned element type or split the grid`);
 if(g.drawRange.start!==0||g.drawRange.count!==Infinity&&g.drawRange.count!==idx.count)throw new Error('partial terrain drawRange is unsupported');
 const vertices=[],xset=new Set(),zset=new Set();
 for(let i=0;i<p.count;i++){const v=[p.getX(i),p.getY(i),p.getZ(i)];if(!v.every(x=>finite(x)&&Math.abs(x)<=100000))throw new Error('terrain positions must be finite within ±100000');vertices.push(v);xset.add(v[0]);zset.add(v[2]);}
 const xs=[...xset].sort((a,b)=>a-b),zs=[...zset].sort((a,b)=>a-b),nx=xs.length-1,nz=zs.length-1;
 if(nx<1||nz<1||xs.length*zs.length!==p.count||nx*nz*2!==idx.count/3)throw new Error('terrain must be a complete regular XZ grid with two triangles per cell');
 for(const values of [xs,zs]){const step=(values.at(-1)-values[0])/(values.length-1);if(step<=epsilon*16)throw new Error('regular grid spacing below epsilon precision');for(let i=0;i<values.length;i++)if(Math.abs(values[i]-(values[0]+i*step))>Math.max(epsilon,Math.max(Math.abs(values[0]),Math.abs(values.at(-1)))*1.3e-7))throw new Error('irregular XZ grid is unsupported');}
 const xm=new Map(xs.map((x,i)=>[x,i])),zm=new Map(zs.map((z,i)=>[z,i])),lookup=new Array(p.count),slots=new Set(),cells=Array.from({length:nx*nz},()=>[]);
 for(let i=0;i<vertices.length;i++){const v=vertices[i],x=xm.get(v[0]),z=zm.get(v[2]),key=z*xs.length+x;if(slots.has(key))throw new Error('regular grid has duplicate XZ vertices');slots.add(key);lookup[i]=[x,z];}
 for(let i=0;i<idx.count;i+=3){
  const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];if(ids.some(id=>!Number.isInteger(id)||id<0||id>=vertices.length)||new Set(ids).size!==3)throw new Error('invalid terrain triangle index');
  const coords=ids.map(id=>lookup[id]),x=Math.min(...coords.map(v=>v[0])),z=Math.min(...coords.map(v=>v[1]));
  if(Math.max(...coords.map(v=>v[0]))!==x+1||Math.max(...coords.map(v=>v[1]))!==z+1)throw new Error('terrain triangle must occupy exactly one regular grid cell');
  const pts=ids.map(id=>vertices[id]),xz=pts.map(v=>[v[0],v[2]]),den=cross(...xz);if(den>=0)throw new Error('terrain triangles require upward +Y winding');
  const u=pts[1].map((v,k)=>v-pts[0][k]),v=pts[2].map((v,k)=>v-pts[0][k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
  const tri={ids,pts,xz,den,normal:n.map(v=>v/len)};cells[z*nx+x].push(tri);
 }
 for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
  const pair=cells[z*nx+x];if(pair.length!==2)throw new Error('regular grid needs two terrain triangles per cell');
  const shared=pair[0].ids.filter(id=>pair[1].ids.includes(id));
  if(shared.length!==2||new Set(pair.flatMap(t=>t.ids)).size!==4)throw new Error('duplicate or missing terrain cell triangle');
  const [a,b]=shared.map(id=>lookup[id]);if(Math.abs(a[0]-b[0])!==1||Math.abs(a[1]-b[1])!==1)throw new Error('terrain cell triangles must share an actual cell diagonal');
  pair.diagonal=shared.map(id=>[vertices[id][0],vertices[id][2]]);
 }
 const weights=(p,t)=>[cross(t.xz[1],t.xz[2],p)/t.den,cross(t.xz[2],t.xz[0],p)/t.den,cross(t.xz[0],t.xz[1],p)/t.den];
 const evaluate=(p,t)=>{const w=weights(p,t);return {height:w.reduce((s,v,i)=>s+v*t.pts[i][1],0),normal:[...t.normal]};};
 const cell=(x,z)=>cells[Math.max(0,Math.min(nz-1,upper(zs,z)-1))*nx+Math.max(0,Math.min(nx-1,upper(xs,x)-1))];
 function sample(p){const pair=cell(...p);return evaluate(p,pair.find(t=>weights(p,t).every(w=>w>=-1e-10))??pair[0]);}
 function range(a,b,values){return [Math.max(0,Math.min(values.length-2,upper(values,a)-1)),Math.max(0,Math.min(values.length-2,upper(values,b)-1))];}
 return {xs,zs,nx,nz,cells,cell,sample,evaluate,range};
}

// Private data is keyed only by the explicit owner token, never by mutable
// caller geometry. Deleting an entry drops the index even if handles live on.
const supportGrids=new WeakMap();
function validateEpsilon(epsilon){if(!finite(epsilon)||epsilon<1e-10||epsilon>1e-4)throw new Error('epsilon must be finite in 1e-10..1e-4');}
function requireGrid(support){const grid=supportGrids.get(support);if(!grid)throw new Error('terrainSupport is invalid or disposed');return grid;}
function makeSupportHandle(epsilon,terrainTriangles){const handle=Object.freeze({epsilon,terrainTriangles,dispose(){supportGrids.delete(handle);}});return handle;}
function makeSupport(grid,epsilon){
 const support=makeSupportHandle(epsilon,grid.nx*grid.nz*2);
 supportGrids.set(support,grid);return support;
}
/** Prepare the final terrain once. The caller owns this immutable CPU snapshot;
 * road builders borrow it. Dispose borrowers, then the support, then the terrain. */
export function prepareTerrainRoadSupport({terrainGeometry,epsilon=1e-7,maxTerrainTriangles=262144}={}){
 validateEpsilon(epsilon);limit(maxTerrainTriangles,'maxTerrainTriangles',262144);
 return makeSupport(gridTerrain(terrainGeometry,epsilon,maxTerrainTriangles),epsilon);
}

/** Drape already-unioned simple XZ surfaces (outer + holes) onto FINAL rendered
 * regular indexed terrain triangles. Shared geometry space, +Y up. Thickness is
 * vertical, not a constant normal offset. Geometry only; terrain is borrowed.
 * No Mesh, morph/instance deformation, bridge, overhang or irregular triangulation.
 * groups: top=0, underside=1, external/hole walls=2. Use a scalar MeshStandardMaterial
 * or three materials. UV is planar XZ for top/bottom, per-segment distance/height for
 * walls; no verified normal-map/tangent chart is promised.
 */
export function createTerrainRoadSource(T,{
 surfaces,terrainGeometry,terrainSupport,thickness=.12,epsilon=terrainSupport?.epsilon??1e-7,
 maxTerrainTriangles=262144,maxRoadVertices=4096,maxCandidatePairs=1000000,
 maxOutputTriangles=500000,maxValidationPairs=1000000
}={}){
 if(!T?.BufferGeometry||!T?.Float32BufferAttribute||!T?.ShapeUtils?.triangulateShape||!T?.Vector2)throw new Error('inject the same THREE namespace as the terrain consumer');
 for(const [key,value,ceiling]of [['maxTerrainTriangles',maxTerrainTriangles,262144],['maxRoadVertices',maxRoadVertices,8192],['maxCandidatePairs',maxCandidatePairs,4000000],['maxOutputTriangles',maxOutputTriangles,1000000],['maxValidationPairs',maxValidationPairs,8000000]])limit(value,key,ceiling);
 if(!finite(thickness)||thickness<=0||thickness>10000)throw new Error('thickness must be finite in (0,10000]');
 validateEpsilon(epsilon);
 if(!Array.isArray(surfaces)||surfaces.length>128)throw new Error('surfaces must be an array of <=128 union components');
 let vertexCount=0;
 for(const s of surfaces){if(!s||!Array.isArray(s.outer)||s.holes!==undefined&&(!Array.isArray(s.holes)||s.holes.length>128))throw new Error('surface requires outer and optional holes arrays');for(const r of [s.outer,...(s.holes??[])]){if(!Array.isArray(r)||r.length<3)throw new Error('road rings need >=3 unclosed vertices');vertexCount+=r.length;if(vertexCount>maxRoadVertices)throw new Error('maxRoadVertices exceeded');}}
 if((terrainGeometry===undefined)===(terrainSupport===undefined))throw new Error('provide exactly one of terrainGeometry or terrainSupport');
 const owned=terrainSupport===undefined,support=owned?prepareTerrainRoadSupport({terrainGeometry,epsilon,maxTerrainTriangles}):terrainSupport;
 try{
  const grid=requireGrid(support);
  if(support.epsilon!==epsilon)throw new Error('epsilon must match the prepared terrainSupport');
  if(support.terrainTriangles>maxTerrainTriangles)throw new Error('prepared support exceeds maxTerrainTriangles');
  return buildRoad(T,{surfaces,thickness,epsilon,maxCandidatePairs,maxOutputTriangles,maxValidationPairs,vertexCount},support,owned,grid);
 }catch(error){if(owned)support.dispose();throw error;}
}
function buildRoad(T,{surfaces,thickness,epsilon,maxCandidatePairs,maxOutputTriangles,maxValidationPairs,vertexCount},support,owned,grid){
 let validationPairs=0,candidatePairs=0,outputTriangles=0,wallSegments=0,discardedCollinearTriangles=0;
 const spend=()=>{if(++validationPairs>maxValidationPairs)throw new Error('maxValidationPairs exceeded; simplify road boundaries or increase the finite budget');};
 const numericEpsilon=Math.max(1e-13,Math.max(...[grid.xs[0],grid.xs.at(-1),grid.zs[0],grid.zs.at(-1)].map(Math.abs))*Number.EPSILON*32);
 const quantizedRing=(r,ccw)=>{const original=ring(r,ccw,epsilon,spend);try{return ring(original.map(p=>p.map(Math.fround)),ccw,numericEpsilon,spend);}catch(error){throw new Error(`Float32 precision cannot represent road boundary: ${error.message}`);}};
 const roads=surfaces.map(s=>({outer:quantizedRing(s.outer,true),holes:(s.holes??[]).map(h=>quantizedRing(h,false))}));
 for(let i=0;i<roads.length;i++){
  const s=roads[i];for(const r of [s.outer,...s.holes])for(const [x,z]of r)if(x<grid.xs[0]||x>grid.xs.at(-1)||z<grid.zs[0]||z>grid.zs.at(-1))throw new Error('road surface outside terrain grid bounds');
  for(let h=0;h<s.holes.length;h++){
   disjointBoundaries([s.outer],[s.holes[h]],epsilon,spend);if(location(s.holes[h][0],s.outer,epsilon)!==1)throw new Error('road hole must be strictly inside its outer ring');
   for(let k=0;k<h;k++){disjointBoundaries([s.holes[h]],[s.holes[k]],epsilon,spend);if(location(s.holes[h][0],s.holes[k],epsilon)>=0||location(s.holes[k][0],s.holes[h],epsilon)>=0)throw new Error('nested/overlapping road holes');}
  }
  for(let j=0;j<i;j++){const other=roads[j];disjointBoundaries([s.outer,...s.holes],[other.outer,...other.holes],epsilon,spend);if(filled(s.outer[0],other,epsilon)||filled(other.outer[0],s,epsilon))throw new Error('overlapping road surfaces; supply world-layout union surfaces');}
 }
 const positions=[],normals=[],uvs=[],groups=[],pointCache=new Map(),topFaces=[];
 const anchors=[grid.xs,grid.zs].map((values,axis)=>[...new Set([...values,...roads.flatMap(s=>[s.outer,...s.holes].flatMap(r=>r.map(p=>p[axis])))])].sort((a,b)=>a-b));
 const snap=(value,axis)=>{for(const values of [[grid.xs,grid.zs][axis],anchors[axis]]){const i=upper(values,value);for(const j of [i-1,i])if(j>=0&&j<values.length&&Math.abs(values[j]-value)<=numericEpsilon)return values[j];}return value;};
 const takeCandidates=n=>{if(candidatePairs+n>maxCandidatePairs)throw new Error('maxCandidatePairs exceeded');candidatePairs+=n;};
 function point(p){
  // XZ rounding is part of the representation. Sample the final terrain at
  // those exact coordinates, never at the pre-quantized clipping intersection.
  const xz=p.map((v,axis)=>Math.fround(snap(v,axis))),key=xz.join(','),roundingX=Math.abs(xz[0]-p[0]),roundingZ=Math.abs(xz[1]-p[1]);if(pointCache.has(key)){const result=pointCache.get(key);result.roundingX=Math.max(result.roundingX,roundingX);result.roundingZ=Math.max(result.roundingZ,roundingZ);return result;}
  const sample=grid.sample(xz),bottom=[xz[0],Math.fround(sample.height),xz[1]],top=[xz[0],Math.fround(sample.height+thickness),xz[1]];
  if(!bottom.every(finite)||!top.every(finite)||top[1]===bottom[1])throw new Error('road thickness/position exceeds Float32 precision');
  const result={xz,key,bottom,top,roundingX,roundingZ};pointCache.set(key,result);return result;
 }
 function triangle(a,b,c,uv){
  const u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
  if(!finite(len)||len===0)throw new Error('road triangle degenerates at Float32 precision');
  if(++outputTriangles>maxOutputTriangles)throw new Error('maxOutputTriangles exceeded');positions.push(...a,...b,...c);for(let i=0;i<3;i++)normals.push(...n.map(v=>v/len));uvs.push(...uv.flat());
 }
 function splitEdges(polygon,candidates){
  const result=[];
  for(const [a,b]of edges(polygon)){
   result.push(a);const len=distance(a,b),dx=b[0]-a[0],dz=b[1]-a[1],cuts=[];
   for(const p of candidates){spend();if(!pointOn(p,a,b,numericEpsilon))continue;const t=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(len*len);if(t>numericEpsilon/len&&t<1-numericEpsilon/len)cuts.push({t,p});}
   cuts.sort((a,b)=>a.t-b.t);for(const cut of cuts)if(distance(result.at(-1),cut.p)>numericEpsilon)result.push(cut.p);
  }
  return result;
 }
 function cap(r){
  const face=r.map(point),projection=cross(...face.map(p=>p.xz));
  if(!(projection<0))throw new Error('Float32 precision cannot represent a strictly upward projected road cap');
  if((topFaces.length+1)*2>maxOutputTriangles)throw new Error('maxOutputTriangles exceeded');topFaces.push(face);
 }
 for(const s of roads){
  const all=[s.outer,...s.holes].flat(),faces=T.ShapeUtils.triangulateShape(s.outer.map(p=>new T.Vector2(...p)),s.holes.map(r=>r.map(p=>new T.Vector2(...p))));
  let sum=0;for(const ids of faces){
   let r=ids.map(i=>all[i]);if(area(r)<0)r=[r[0],r[2],r[1]];
   const triangleArea=area(r),longest=Math.max(...edges(r).map(([a,b])=>distance(a,b))),magnitude=Math.max(1,...r.flat().map(Math.abs));
   if(triangleArea<=Number.EPSILON*magnitude*longest*16){discardedCollinearTriangles++;continue;}
   sum+=triangleArea;
   const [loX,hiX]=grid.range(Math.min(...r.map(p=>p[0])),Math.max(...r.map(p=>p[0])),grid.xs),[loZ,hiZ]=grid.range(Math.min(...r.map(p=>p[1])),Math.max(...r.map(p=>p[1])),grid.zs);
   const edgeVertices=all.filter(p=>edges(r).some(([a,b])=>{spend();return pointOn(p,a,b,numericEpsilon);}));
   takeCandidates((hiX-loX+1)*(hiZ-loZ+1)*2);
   for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++)for(const t of grid.cells[z*grid.nx+x]){
    const clipped=clipConvexPolygon(r,t.xz,{epsilon:numericEpsilon});if(!clipped.length)continue;
    const raw=splitEdges(clipped,edgeVertices),piece=[];
    for(const p of raw){const q=point(p);if(!piece.length||piece.at(-1).key!==q.key)piece.push(q);}
    if(piece.length>1&&piece[0].key===piece.at(-1).key)piece.pop();
    const projected=piece.map(p=>p.xz),signed=piece.length>=3?area(projected):0;
    // A clipped fragment may collapse entirely after XZ quantization. It is
    // omitted here, then complete source-boundary coverage is mandatory below.
    if(signed===0)continue;if(signed<0||new Set(piece.map(p=>p.key)).size!==piece.length)throw new Error('Float32 precision folded a clipped road polygon');
    for(let i=0;i<piece.length;i++)for(let j=0;j<i;j++){spend();if(j===i-1||i===piece.length-1&&j===0)continue;if(touching(piece[i].xz,piece[(i+1)%piece.length].xz,piece[j].xz,piece[(j+1)%piece.length].xz,0))throw new Error('Float32 precision crossed a clipped road polygon');}
    // Ear removal in the final represented polygon retains every boundary
    // subdivision without introducing an unrepresentable interior fan center.
    const pending=[...piece];
    while(pending.length>3){let found=false;for(let i=0;i<pending.length;i++){
     spend();const a=pending[(i+pending.length-1)%pending.length],b=pending[i],c=pending[(i+1)%pending.length];if(cross(a.xz,b.xz,c.xz)<=0)continue;
     const blocked=pending.some(p=>{if(p===a||p===b||p===c)return false;spend();return cross(a.xz,b.xz,p.xz)>=0&&cross(b.xz,c.xz,p.xz)>=0&&cross(c.xz,a.xz,p.xz)>=0;});
     if(blocked)continue;cap([a.xz,c.xz,b.xz]);pending.splice(i,1);found=true;break;
    }if(!found)throw new Error('Float32 precision cannot triangulate represented road boundary');}
    cap([pending[0].xz,pending[2].xz,pending[1].xz]);
   }
  }
  const expected=area(s.outer)+s.holes.reduce((a,r)=>a+area(r),0);if(Math.abs(sum-expected)>Math.max(numericEpsilon*numericEpsilon*vertexCount*8,expected*1e-10))throw new Error('road triangulation coverage mismatch at numeric precision');
 }
 // Positive projected caps + oppositely paired internal edges + a simple,
 // fully covered source boundary give winding number one throughout the road.
 // Walls and underside are constructed from this SAME represented top mesh.
 const incidence=new Map();
 for(const face of topFaces)for(let i=0;i<3;i++){
  const a=face[i],b=face[(i+1)%3],key=[a.key,b.key].sort().join('/');const entries=incidence.get(key)??[];entries.push({a,b});incidence.set(key,entries);
  if(entries.length>2)throw new Error('Float32 precision produced non-manifold projected road edges');
 }
 const boundary=[];
 for(const entries of incidence.values()){
  if(entries.length===1)boundary.push(entries[0]);
  else if(entries[0].a!==entries[1].b||entries[0].b!==entries[1].a)throw new Error('Float32 precision produced overlapping or misoriented road caps');
 }
 const outgoing=new Map(),incoming=new Map();
 for(const e of boundary){if(outgoing.has(e.a.key)||incoming.has(e.b.key))throw new Error('Float32 precision produced a branched road boundary');outgoing.set(e.a.key,e);incoming.set(e.b.key,e);}
 for(const key of outgoing.keys())if(!incoming.has(key))throw new Error('Float32 precision produced an unclosed road boundary');
 const sourceEdges=roads.flatMap(s=>[s.outer,...s.holes].flatMap(r=>edges(r).map(([a,b])=>({a,b,length:distance(a,b),intervals:[]}))));
 const segmentDistance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));return distance(p,[a[0]+dx*t,a[1]+dz*t]);};
 const coordinateTolerance=p=>Math.max(numericEpsilon*4,Math.max(Math.abs(p[0]),Math.abs(p[1]))*2**-23);
 for(const e of boundary){
  let best=null,bestError=Infinity;const tolerance=Math.max(coordinateTolerance(e.a.xz),coordinateTolerance(e.b.xz));
  for(const source of sourceEdges){spend();const error=Math.max(segmentDistance(e.a.xz,source.a,source.b),segmentDistance(e.b.xz,source.a,source.b));if(error<=tolerance&&error<bestError){const dx=source.b[0]-source.a[0],dz=source.b[1]-source.a[1],parameter=p=>((p[0]-source.a[0])*dx+(p[1]-source.a[1])*dz)/(source.length*source.length),a=parameter(e.a.xz),b=parameter(e.b.xz);if(a>b){best={source,a,b,tolerance:tolerance/source.length};bestError=error;}}}
  if(!best)throw new Error('Float32 precision lost source coverage or created an internal boundary');best.source.intervals.push(best);
 }
 for(const source of sourceEdges){
  if(!source.intervals.length)throw new Error('Float32 precision removed a road component or source boundary');source.intervals.sort((a,b)=>a.b-b.b);let end=0;
  for(const interval of source.intervals){if(Math.abs(interval.b-end)>interval.tolerance*2)throw new Error('Float32 precision left a boundary coverage gap/overlap');end=interval.a;}
  if(Math.abs(end-1)>Math.max(coordinateTolerance(source.a),coordinateTolerance(source.b))/source.length*2)throw new Error('Float32 precision left incomplete source coverage');
 }
 // Check simple represented boundaries with the terrain grid as a broadphase.
 // This is geometric validation, not just 3D edge incidence (which misses folds).
 const boundaryCells=new Map(),checked=new Set();
 for(let i=0;i<boundary.length;i++){
  const e=boundary[i],[loX,hiX]=grid.range(Math.min(e.a.xz[0],e.b.xz[0]),Math.max(e.a.xz[0],e.b.xz[0]),grid.xs),[loZ,hiZ]=grid.range(Math.min(e.a.xz[1],e.b.xz[1]),Math.max(e.a.xz[1],e.b.xz[1]),grid.zs);
  for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++){
   spend();const key=z*grid.nx+x,list=boundaryCells.get(key)??[];
   for(const j of list){const pair=`${j}/${i}`;if(checked.has(pair))continue;checked.add(pair);spend();const other=boundary[j];if(e.a===other.b||e.b===other.a)continue;if(touching(e.a.xz,e.b.xz,other.a.xz,other.b.xz,0))throw new Error('Float32 precision produced intersecting projected road boundaries');}
   list.push(i);boundaryCells.set(key,list);
  }
 }
 const queryCells=new Map();
 let supportChecks=0,maxSupportError=0,maxSupportTolerance=0,maxSupportYErrorBound=0,maxSupportXZErrorBound=0;
 for(const face of topFaces){
  const r=face.map(p=>p.xz),deltaX=Math.max(...face.map(p=>p.roundingX)),deltaZ=Math.max(...face.map(p=>p.roundingZ));
  const [loX,hiX]=grid.range(Math.min(...r.map(p=>p[0]))-deltaX,Math.max(...r.map(p=>p[0]))+deltaX,grid.xs),[loZ,hiZ]=grid.range(Math.min(...r.map(p=>p[1]))-deltaZ,Math.max(...r.map(p=>p[1]))+deltaZ,grid.zs);
  takeCandidates((hiX-loX+1)*(hiZ-loZ+1)*2);
  // The pre-quantized cap was contained in one actual terrain plane. Rounding
  // XZ can cross a cell/diagonal. A local height-field Lipschitz bound covers
  // both moving its vertices and moving their interpolated point: 2 * L * δ.
  // Include the original-to-represented envelope when finding those slopes.
  let slopeX=0,slopeZ=0;
  for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++)for(const terrain of grid.cells[z*grid.nx+x]){slopeX=Math.max(slopeX,Math.abs(terrain.normal[0]/terrain.normal[1]));slopeZ=Math.max(slopeZ,Math.abs(terrain.normal[2]/terrain.normal[1]));}
  const xzRoundingBound=2*(slopeX*deltaX+slopeZ*deltaZ);face.supportTolerance=0;
  for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++){
   const cell=z*grid.nx+x,list=queryCells.get(cell)??[];list.push(face);queryCells.set(cell,list);
   for(const terrain of grid.cells[cell]){
    const clipped=clipConvexPolygon(r,terrain.xz,{epsilon:numericEpsilon});if(!clipped.length)continue;
    const values=clipped.map(p=>{supportChecks++;spend();const w=barycentric(p,face),ground=grid.evaluate(p,terrain).height,bottom=w.reduce((s,v,i)=>s+v*face[i].bottom[1],0),top=w.reduce((s,v,i)=>s+v*face[i].top[1],0);return {p,ground,bottom,top,bottomError:Math.abs(bottom-ground),topError:Math.abs(top-ground-thickness)};});
    // Both cap errors are affine on this intersection. Their maximum absolute
    // error is attained at a vertex, so ONE uniform bound covers its interior,
    // including locations where ground height changes sign or becomes zero.
    const yRoundingBound=Math.max(1e-7,...values.flatMap(v=>[Math.abs(v.ground)*2**-23,Math.abs(v.ground+thickness)*2**-23]));
    const tolerance=yRoundingBound+xzRoundingBound,worst=values.reduce((a,b)=>Math.max(a.bottomError,a.topError)>=Math.max(b.bottomError,b.topError)?a:b),errorMagnitude=Math.max(worst.bottomError,worst.topError);
    if(tolerance>thickness/4||errorMagnitude>tolerance){const details={reason:tolerance>thickness/4?'thickness-relative precision cap':'affine support error',face:face.map(p=>p.top),terrain:terrain.pts,intersection:worst.p,ground:worst.ground,bottom:worst.bottom,top:worst.top,bottomError:worst.bottomError,topError:worst.topError,tolerance,yRoundingBound,xzRoundingBound,deltaXZ:[deltaX,deltaZ],slopeXZ:[slopeX,slopeZ],thickness};const error=new Error(`Float32 precision cannot preserve road support/thickness across an actual terrain plane: ${JSON.stringify(details)}`);error.details=details;throw error;}
    face.supportTolerance=Math.max(face.supportTolerance,tolerance);maxSupportError=Math.max(maxSupportError,errorMagnitude);maxSupportTolerance=Math.max(maxSupportTolerance,tolerance);maxSupportYErrorBound=Math.max(maxSupportYErrorBound,yRoundingBound);maxSupportXZErrorBound=Math.max(maxSupportXZErrorBound,xzRoundingBound);
   }
  }
  if(!face.supportTolerance)throw new Error('Float32 precision left a represented road cap without terrain support');
 }
 for(const top of [true,false]){const start=positions.length/3;for(const face of topFaces){const r=top?face:[face[0],face[2],face[1]];triangle(...r.map(p=>p[top?'top':'bottom']),r.map(p=>p.xz));}groups.push({start,count:positions.length/3-start,materialIndex:top?0:1});}
 const wallStart=positions.length/3;
 for(const {a,b}of boundary){const length=distance(a.xz,b.xz);wallSegments++;triangle(a.top,a.bottom,b.bottom,[[0,thickness],[0,0],[length,0]]);triangle(a.top,b.bottom,b.top,[[0,thickness],[length,0],[length,thickness]]);}
 groups.push({start:wallStart,count:positions.length/3-wallStart,materialIndex:2});
 let geometry;
 try{geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));for(const group of groups)geometry.addGroup(group.start,group.count,group.materialIndex);geometry.computeBoundingBox();geometry.computeBoundingSphere();}catch(error){geometry?.dispose();throw error;}
 return roadHandle(geometry,Object.freeze({terrainTriangles:grid.nx*grid.nz*2,roadVertices:vertexCount,validationPairs,candidatePairs,outputTriangles,topTriangles:groups[0].count/3,undersideTriangles:groups[1].count/3,wallTriangles:groups[2].count/3,wallSegments,discardedCollinearTriangles,supportChecks,maxSupportError,maxSupportTolerance,maxSupportYErrorBound,maxSupportXZErrorBound}),queryCells,support,owned);
}
const barycentric=(p,face)=>{const r=face.map(v=>v.xz),den=cross(...r);return [cross(r[1],r[2],p)/den,cross(r[2],r[0],p)/den,cross(r[0],r[1],p)/den];};
// A retained handle owns only its road-cell references and optional private
// terrain token. No build scratch or direct reference to the full grid escapes.
function roadHandle(geometry,stats,queryCells,support,owned){
 return {geometry,stats,query(x,z){
  if(!support)throw new Error('terrain road source is disposed');const grid=requireGrid(support);if(!finite(x)||!finite(z))throw new Error('query x,z must be finite');if(x<grid.xs[0]||x>grid.xs.at(-1)||z<grid.zs[0]||z>grid.zs.at(-1))return null;
  const ix=Math.min(grid.nx-1,upper(grid.xs,x)-1),iz=Math.min(grid.nz-1,upper(grid.zs,z)-1);
  for(const face of queryCells.get(iz*grid.nx+ix)??[]){const w=barycentric([x,z],face);if(!w.every(v=>v>=0))continue;return {height:w.reduce((s,v,i)=>s+v*face[i].bottom[1],0),topHeight:w.reduce((s,v,i)=>s+v*face[i].top[1],0),normal:grid.sample([x,z]).normal,supportTolerance:face.supportTolerance};}return null;
 },dispose(){if(!support)return;queryCells.clear();if(owned)support.dispose();support=null;geometry.dispose();}};
}
