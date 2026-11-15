import {prepareTerrainRoadSupport} from './terrain-roads.mjs';
import {createFloat32LineEventTable,nodeTaggedFloat32Rings} from '../geometry/float32-line-events.mjs';
import {clipConvexPolygon} from '../geometry/bounded-profile.mjs';
import {triangulateFloat32Ring} from '../geometry/float32-triangulation.mjs';

const finite=Number.isFinite,EPS=1e-10;
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const signedArea=poly=>{if(poly.length<3)return 0;const origin=poly[0];let twiceArea=0;for(let i=1;i<poly.length-1;i++)twiceArea+=cross(origin,poly[i],poly[i+1]);return twiceArea/2;};
const FLOAT32_MAX_RELATIVE_AREA_ERROR=3e-5;
function float32HalfUlp(value){const v=Math.abs(Math.fround(value));if(!finite(v))return Infinity;if(v===0)return 2**-150;return 2**(Math.floor(Math.log2(v))-24);}
function float32AreaQuantizationBound(poly,exactVertices){
 if(poly.length<3)return 0;const origin=poly[0],local=poly.map(p=>[p[0]-origin[0],p[1]-origin[1]]),errors=poly.map(p=>exactVertices.has(`${p[0]},${p[1]}`)?0:Math.hypot(float32HalfUlp(p[0]),float32HalfUlp(p[1])));let bound=0;
 for(let i=0;i<poly.length;i++){const j=(i+1)%poly.length,a=local[i],b=local[j],edge=Math.hypot(b[0]-a[0],b[1]-a[1]);bound+=.5*(errors[i]+errors[j])*edge+errors[i]*errors[j]*.5;}
 return bound;
}
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
const cmpPoint=(a,b)=>a[0]-b[0]||a[1]-b[1];
function positiveLimit(v,name,max){if(!Number.isSafeInteger(v)||v<1||v>max)throw new Error(`${name} must be an integer in 1..${max}`);return v;}
function lowerBound(values,target){let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>1;if(values[mid]<target)lo=mid+1;else hi=mid;}return lo;}
function bounds2(ring){return {minX:Math.min(...ring.map(p=>p[0])),maxX:Math.max(...ring.map(p=>p[0])),minZ:Math.min(...ring.map(p=>p[1])),maxZ:Math.max(...ring.map(p=>p[1]))};}
function convexRing(input,name){
 if(!Array.isArray(input)||input.length<3||input.length>256)throw new Error(`${name} requires 3..256 convex [x,z] vertices`);
 const ring=input.map((p,i)=>{if(!Array.isArray(p)||p.length!==2||!p.every(v=>finite(v)&&Math.abs(v)<=100000))throw new Error(`${name}[${i}] must be finite [x,z] within ±100000`);return [Math.fround(p[0]),Math.fround(p[1])];});
 if(ring.some((p,i)=>same(p,ring[(i+1)%ring.length])))throw new Error(`${name} has a repeated or Float32-collapsed edge`);
 let sign=0;for(let i=0;i<ring.length;i++){const v=cross(ring[i],ring[(i+1)%ring.length],ring[(i+2)%ring.length]);if(Math.abs(v)<=EPS)continue;if(sign&&Math.sign(v)!==sign)throw new Error(`${name} must be convex`);sign=Math.sign(v);}
 if(!sign||Math.abs(signedArea(ring))<=EPS)throw new Error(`${name} must have positive area`);
 if(signedArea(ring)<0)ring.reverse();return ring;
}
function cleanTagged(points,incomingLines){
 const cleanPoints=[],cleanIncoming=[];
 for(let i=0;i<points.length;i++){
  if(cleanPoints.length&&same(cleanPoints.at(-1),points[i]))continue;
  cleanPoints.push(points[i]);cleanIncoming.push(incomingLines[i]);
 }
 if(cleanPoints.length>1&&same(cleanPoints[0],cleanPoints.at(-1))){cleanPoints.pop();cleanIncoming[0]=cleanIncoming.at(-1);cleanIncoming.pop();}
 if(cleanPoints.length<3||Math.abs(signedArea(cleanPoints))<=EPS)return null;
 return {points:cleanPoints,edgeLines:cleanIncoming.map((_,i)=>cleanIncoming[(i+1)%cleanIncoming.length])};
}
function uniqueRing(ids){const result=[];for(const id of ids)if(result.at(-1)!==id)result.push(id);if(result.length>1&&result[0]===result.at(-1))result.pop();return result;}
function clipHalfPlane(poly,a,b,clipLine,lineEvents,inside){
 if(!poly)return null;
 const out=[],incoming=[];
 const add=(point,line)=>{if(out.length&&same(out.at(-1),point))return;out.push(point);incoming.push(line);};
 for(let i=0;i<poly.points.length;i++){
  const prev=poly.points[(i+poly.points.length-1)%poly.points.length],cur=poly.points[i],subjectLine=poly.edgeLines[(i+poly.points.length-1)%poly.points.length],dp=subjectLine.key===clipLine.key?0:cross(a,b,prev),dc=subjectLine.key===clipLine.key?0:cross(a,b,cur),prevIn=inside?dp>=0:dp<=0,curIn=inside?dc>=0:dc<=0;
  if(prevIn!==curIn){const event=lineEvents.intersect(subjectLine,clipLine);if(!event)throw new Error('Float32 precision conflict: crossing segment has parallel support lines');add(event,prevIn?subjectLine:clipLine);}
  if(curIn)add(cur,subjectLine);
 }
 return cleanTagged(out,incoming);
}
function partitionByConvex(poly,ring,ringLines,lineEvents,spend){
 let remainder=poly;const pieces=[];
 for(let i=0;i<ring.length&&remainder;i++){
  spend();const a=ring[i],b=ring[(i+1)%ring.length],line=ringLines[i],outside=clipHalfPlane(remainder,a,b,line,lineEvents,false),inside=clipHalfPlane(remainder,a,b,line,lineEvents,true);
  if(outside)pieces.push(outside);remainder=inside;
 }
 if(remainder)pieces.push(remainder);
 return pieces.length?pieces:[poly];
}
function pointOnSegment(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz;if(len2===0)return false;const t=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/len2;return t>EPS&&t<1-EPS&&Math.abs(cross(a,b,p))<=1e-8*Math.sqrt(len2);}
function splitSourceTriangleAtConstraints(tri,rings,sourceLines,ringLines,lineEvents,spend){
 const edges=[];for(let r=0;r<rings.length;r++)for(let i=0;i<rings[r].length;i++)edges.push([rings[r][i],rings[r][(i+1)%rings[r].length],ringLines[r][i]]);
 const polygon=[],edgeLines=[];
 for(let i=0;i<3;i++){
  const a=[tri[i][0],tri[i][2]],b=[tri[(i+1)%3][0],tri[(i+1)%3][2]],lo=cmpPoint(a,b)<=0?a:b,hi=lo===a?b:a,dx=hi[0]-lo[0],dz=hi[1]-lo[1],length2=dx*dx+dz*dz,cuts=new Map();
  for(const [c,d,line]of edges){spend();
   if(pointOnSegment(c,lo,hi))cuts.set(`${Math.fround(c[0])},${Math.fround(c[1])}`,[Math.fround(c[0]),Math.fround(c[1])]);
   if(pointOnSegment(d,lo,hi))cuts.set(`${Math.fround(d[0])},${Math.fround(d[1])}`,[Math.fround(d[0]),Math.fround(d[1])]);
   const event=lineEvents.intersect(sourceLines[i],line);if(!event)continue;const t=((event[0]-lo[0])*dx+(event[1]-lo[1])*dz)/length2,sx=d[0]-c[0],sz=d[1]-c[1],u=sx!==0?(event[0]-c[0])/sx:sz!==0?(event[1]-c[1])/sz:-1;
   if(t>EPS&&t<1-EPS&&u>=-EPS&&u<=1+EPS){const key=`${Math.fround(event[0])},${Math.fround(event[1])}`;if(!cuts.has(key))cuts.set(key,event);}
  }
  const ordered=[...cuts.values()].map(p=>({p,t:((p[0]-lo[0])*dx+(p[1]-lo[1])*dz)/length2})).sort((x,y)=>x.t-y.t);if(lo!==a)ordered.reverse();const along=[a,...ordered.map(v=>v.p),b];
  polygon.push(...along.slice(0,-1));for(let j=0;j<along.length-1;j++)edgeLines.push(sourceLines[i]);
 }
 const tagged=cleanTagged(polygon,edgeLines.map((_,i)=>edgeLines[(i+edgeLines.length-1)%edgeLines.length]));
 return tagged;
}
function barycentric(p,tri){const [a,b,c]=tri.map(v=>[v[0],v[2]]),den=cross(a,b,c);return [cross(b,c,p)/den,cross(c,a,p)/den,cross(a,b,p)/den];}
function conformIndex(T,positions,uvs,normals,customAttributes,index,maxVertices,spend){
 const groups=new Map(),keyFor=p=>`${p[0]},${p[1]}`;
 for(let i=0;i<index.length;i+=3)for(let k=0;k<3;k++){
  spend();
  const a=index[i+k],b=index[i+(k+1)%3],ax=positions[a*3],az=positions[a*3+2],bx=positions[b*3],bz=positions[b*3+2],dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz);if(!(len>0))throw new Error('degenerate output edge');
  let ux=dx/len,uz=dz/len;if(ux<0||ux===0&&uz<0){ux=-ux;uz=-uz;}const offset=ux*az-uz*ax,key=`${Math.round(ux*1e7)},${Math.round(uz*1e7)},${Math.round(offset*1e6)}`;
  let group=groups.get(key);if(!group){group={ux,uz,points:new Map(),edges:[]};groups.set(key,group);}for(const id of [a,b]){const x=positions[id*3],z=positions[id*3+2];group.points.set(keyFor([x,z]),{id,s:x*group.ux+z*group.uz,x,z});}group.edges.push([a,b]);
 }
 const cuts=new Map();for(const group of groups.values()){
  const points=[...group.points.values()].sort((a,b)=>a.s-b.s||a.x-b.x||a.z-b.z);
  for(const [a,b]of group.edges){const ax=positions[a*3],az=positions[a*3+2],bx=positions[b*3],bz=positions[b*3+2],lo=Math.min(ax*group.ux+az*group.uz,bx*group.ux+bz*group.uz),hi=Math.max(ax*group.ux+az*group.uz,bx*group.ux+bz*group.uz);let left=0,right=points.length;while(left<right){const mid=(left+right)>>1;if(points[mid].s<lo-EPS)left=mid+1;else right=mid;}
   const edgeCuts=[];for(let j=left;j<points.length&&points[j].s<=hi+EPS;j++){spend();const p=points[j],t=((p.x-ax)*(bx-ax)+(p.z-az)*(bz-az))/((bx-ax)**2+(bz-az)**2);if(t<=EPS||t>=1-EPS)continue;if(Math.abs(cross([ax,az],[bx,bz],[p.x,p.z]))>1e-7*Math.hypot(bx-ax,bz-az))continue;edgeCuts.push({id:p.id,t});}
   edgeCuts.sort((x,y)=>x.t-y.t);cuts.set(`${a}/${b}`,edgeCuts);
  }
 }
 const conforming=[];let triangles=0;
 for(let i=0;i<index.length;i+=3){const tri=[index[i],index[i+1],index[i+2]],ring=[];for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3],forward=cuts.get(`${a}/${b}`),reverse=cuts.get(`${b}/${a}`),ordered=forward??(reverse??[]).slice().reverse();ring.push(a,...ordered.map(v=>v.id));}
  const unique=ring.filter((id,j)=>id!==ring[(j+ring.length-1)%ring.length]);if(unique.length===3){conforming.push(...unique);triangles++;continue;}
  const center=unique.reduce((v,id)=>[v[0]+positions[id*3]/unique.length,v[1]+positions[id*3+1]/unique.length,v[2]+positions[id*3+2]/unique.length],[0,0,0]),id=positions.length/3;if(id>=maxVertices)throw new Error(`maxOutputVertices exceeded while conforming mesh (${id+1} > ${maxVertices})`);positions.push(...center);
  const centerUv=[0,1].map(k=>unique.reduce((s,v)=>s+uvs[v*2+k]/unique.length,0));uvs.push(...centerUv);if(normals.length){const n=[0,1,2].map(k=>unique.reduce((s,v)=>s+normals[v*3+k]/unique.length,0)),len=Math.hypot(...n);if(!(len>0))throw new Error('conforming output normal is degenerate');normals.push(...n.map(v=>v/len));}
  for(const [name,entry] of customAttributes){const values=unique.map(vertex=>entry.values.slice(vertex*entry.itemSize,(vertex+1)*entry.itemSize)),weights=unique.map(()=>1/unique.length),resolved=entry.resolve({name,stage:'conform-center',sourceValues:values,weights,position:center,sourcePosition:null,sourceVertexIndices:[...unique]}),floatValues=Array.from(resolved??[],Math.fround);if((!Array.isArray(resolved)&&!ArrayBuffer.isView(resolved))||resolved.length!==entry.itemSize||floatValues.some(v=>!finite(v)))throw new Error(`attributeResolvers.${name} must return ${entry.itemSize} finite Float32 values at conform-center`);entry.values.push(...floatValues);}
  for(let k=0;k<unique.length;k++){conforming.push(id,unique[k],unique[(k+1)%unique.length]);triangles++;}
 }
 return {index:conforming,triangles};
}

function indexedTopologySnapshot(index,positions){
 const vertices=positions.length/3;let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(let i=0;i<vertices;i++){minX=Math.min(minX,positions[i*3]);maxX=Math.max(maxX,positions[i*3]);minZ=Math.min(minZ,positions[i*3+2]);maxZ=Math.max(maxZ,positions[i*3+2]);}const edges=new Map();
 for(let i=0;i<index.length;i+=3)for(let k=0;k<3;k++){const a=index[i+k],b=index[i+(k+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`,entry=edges.get(key)??{a,b,count:0,balance:0,firstFace:i/3};entry.count++;entry.balance+=a<b?1:-1;edges.set(key,entry);}
 let interiorBoundaryEdges=0,outerBoundaryEdges=0,nonManifoldEdges=0,inconsistentWindingEdges=0;const samples=[];
 for(const edge of edges.values()){if(edge.count>2)nonManifoldEdges++;else if(edge.count===2&&edge.balance!==0)inconsistentWindingEdges++;if(edge.count!==1)continue;const ax=positions[edge.a*3],az=positions[edge.a*3+2],bx=positions[edge.b*3],bz=positions[edge.b*3+2],onBounds=ax===minX&&bx===minX||ax===maxX&&bx===maxX||az===minZ&&bz===minZ||az===maxZ&&bz===maxZ;if(onBounds)outerBoundaryEdges++;else{interiorBoundaryEdges++;if(samples.length<24)samples.push({edge:[[ax,az],[bx,bz]],face:edge.firstFace});}}
 return Object.freeze({edgeCount:edges.size,interiorBoundaryEdges,outerBoundaryEdges,nonManifoldEdges,inconsistentWindingEdges,samples});
}
function locateIndexedMeshPoints(index,positions,queries,sourceTriangleIds){
 const results=[];for(const point of queries){const faces=[],sources=new Set();for(let i=0;i<index.length;i+=3){const a=index[i]*3,b=index[i+1]*3,c=index[i+2]*3,ax=positions[a],az=positions[a+2],bx=positions[b],bz=positions[b+2],cx=positions[c],cz=positions[c+2],den=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);if(Math.abs(den)<=1e-20)continue;const u=((point[0]-ax)*(cz-az)-(point[1]-az)*(cx-ax))/den,v=((bx-ax)*(point[1]-az)-(bz-az)*(point[0]-ax))/den,w=1-u-v;if(u>=-1e-7&&v>=-1e-7&&w>=-1e-7){faces.push(i/3);if(sourceTriangleIds)sources.add(sourceTriangleIds[i/3]);}}results.push({point,coveringFaces:faces.length,preConformFaceIds:faces.slice(0,16),sourceTriangleIds:[...sources].slice(0,16)});}return results;
}

/**
 * Inserts convex constraint boundaries into a verified regular terrain mesh.
 * New heights are sampled from one world-space callback; protected regions
 * retain the original piecewise-linear surface exactly. The source geometry
 * is borrowed and never mutated. This is a mesh refiner, not a terrain design
 * solver: the caller supplies all constraints and the final height function.
 */
export function createConstrainedTerrainGeometry(T,{
 terrainGeometry,constraints=[],protectedRegions=[],heightAt,attributeResolvers={},
 maxSourceTriangles=262144,maxOutputTriangles=1000000,maxOutputVertices=524288,maxWorkUnits=4000000,collectTopologyDiagnostics=false
}={}){
 if(!T?.BufferGeometry||!T?.Float32BufferAttribute||!T?.Uint32BufferAttribute||!T?.Uint16BufferAttribute)throw new Error('inject the same THREE namespace used by the terrain consumer');
 if(typeof heightAt!=='undefined'&&typeof heightAt!=='function')throw new TypeError('heightAt must be a function when supplied');
 if(typeof collectTopologyDiagnostics!=='boolean')throw new TypeError('collectTopologyDiagnostics must be a boolean');
 positiveLimit(maxSourceTriangles,'maxSourceTriangles',262144);positiveLimit(maxOutputTriangles,'maxOutputTriangles',1000000);positiveLimit(maxOutputVertices,'maxOutputVertices',1048576);positiveLimit(maxWorkUnits,'maxWorkUnits',8000000);
 if(!Array.isArray(constraints)||constraints.length>128||!Array.isArray(protectedRegions)||protectedRegions.length>128)throw new Error('constraints and protectedRegions must be arrays of at most 128 polygons');
 const splits=[...constraints.map((p,i)=>convexRing(p,`constraints[${i}]`)),...protectedRegions.map((p,i)=>convexRing(p,`protectedRegions[${i}]`))];
 let sourceSupport;
 try{sourceSupport=prepareTerrainRoadSupport({terrainGeometry,topology:'regular-grid',maxTerrainTriangles:maxSourceTriangles});}
 catch(error){throw new Error(`constrained terrain source must be a verified regular XZ grid: ${error.message}`,{cause:error});}
 try{
  const position=terrainGeometry.getAttribute('position'),index=terrainGeometry.getIndex(),uv=terrainGeometry.getAttribute('uv'),normal=terrainGeometry.getAttribute('normal');
  if(terrainGeometry.groups.length)throw new Error('terrain groups are unsupported; provide one homogeneous surface geometry');
  if(Object.values(terrainGeometry.morphAttributes??{}).some(v=>v.length))throw new Error('morphed/deformed source terrain is unsupported');
  if(!attributeResolvers||typeof attributeResolvers!=='object'||Array.isArray(attributeResolvers))throw new TypeError('attributeResolvers must map custom attribute names to explicit resolver functions');
  const customAttributes=new Map();
  for(const name of Object.keys(terrainGeometry.attributes))if(!['position','uv','normal'].includes(name)){
   const attribute=terrainGeometry.getAttribute(name),resolve=attributeResolvers[name];
   if(typeof resolve!=='function')throw new Error(`source terrain attribute ${name} requires an explicit attributeResolvers.${name} function`);
   if(!attribute?.isBufferAttribute||attribute.isInterleavedBufferAttribute||attribute.count!==position.count||attribute.itemSize<1||attribute.itemSize>4||attribute.normalized||!(attribute.array instanceof Float32Array)||attribute.gpuType!==T.FloatType)throw new Error(`source terrain attribute ${name} must be a matching nonnormalized Float32 BufferAttribute with itemSize 1..4 and float GPU binding`);
   customAttributes.set(name,{attribute,resolve,itemSize:attribute.itemSize,values:[]});
  }
  for(const name of Object.keys(attributeResolvers))if(!customAttributes.has(name))throw new Error(`attributeResolvers.${name} does not match a custom source terrain attribute`);
  if(uv&&(!uv.isBufferAttribute||uv.itemSize!==2||uv.count!==position.count))throw new Error('source uv must be a noninterleaved vec2 attribute matching positions');
  if(normal&&(!normal.isBufferAttribute||normal.itemSize!==3||normal.count!==position.count))throw new Error('source normal must be a noninterleaved vec3 attribute matching positions');
  let work=0,outputTriangles=0,splitSourceTriangles=0;
  const spend=()=>{if(++work>maxWorkUnits)throw new Error(`maxWorkUnits exceeded (${work} > ${maxWorkUnits})`);};
  const original=[...position.array],uvOriginal=uv?[...uv.array]:Array.from({length:position.count},(_,i)=>[position.getX(i),position.getZ(i)]).flat();
  const positions=[...original],uvs=[...uvOriginal],normals=normal?[...normal.array]:[],vertexMap=new Map(),baseMap=new Map(),outputIndex=[],outputSourceTriangleIds=collectTopologyDiagnostics?[]:undefined,sourceTriangleDiagnostics=collectTopologyDiagnostics?[]:undefined,sourceTriangleCount=index.count/3;
  if(sourceTriangleCount>maxSourceTriangles)throw new Error('maxSourceTriangles exceeded');
  if(position.count>maxOutputVertices)throw new Error(`maxOutputVertices exceeded by source mesh (${position.count} > ${maxOutputVertices})`);
  let preserve=()=>false;
  const splitRings=splits;
  const xs=[...new Set(Array.from({length:position.count},(_,i)=>position.getX(i)))].sort((a,b)=>a-b),zs=[...new Set(Array.from({length:position.count},(_,i)=>position.getZ(i)))].sort((a,b)=>a-b),nx=xs.length-1,nz=zs.length-1,ringBounds=splits.map(bounds2),ringBins=Array.from({length:nx*nz},()=>[]);
  const ringLineCount=splits.reduce((sum,ring)=>sum+ring.length,0),lineEvents=createFloat32LineEventTable({maxLines:Math.min(1000000,sourceTriangleCount*3+ringLineCount),maxEvents:maxWorkUnits}),ringLines=splits.map(ring=>ring.map((point,i)=>{spend();return lineEvents.add(point,ring[(i+1)%ring.length]);}));
  for(let r=0;r<ringBounds.length;r++){
   const b=ringBounds[r],x0=Math.max(0,lowerBound(xs,b.minX)-1),x1=Math.min(nx-1,lowerBound(xs,b.maxX)),z0=Math.max(0,lowerBound(zs,b.minZ)-1),z1=Math.min(nz-1,lowerBound(zs,b.maxZ));if(x0>x1||z0>z1)continue;
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){spend();ringBins[z*nx+x].push(r);}
  }
  preserve=point=>{
   const xCell=Math.max(0,Math.min(nx-1,lowerBound(xs,point[0])-1)),zCell=Math.max(0,Math.min(nz-1,lowerBound(zs,point[1])-1));
   for(const r of ringBins[zCell*nx+xCell]){
    if(r<constraints.length)continue;
    const ring=splits[r];let within=true;
    for(let i=0;i<ring.length;i++){spend();if(cross(ring[i],ring[(i+1)%ring.length],point)<-1e-7){within=false;break;}}
    if(within)return true;
   }
   return false;
  };
  for(let i=0;i<position.count;i++){spend();const x=position.getX(i),z=position.getZ(i),key=`${x},${z}`;if(vertexMap.has(key))throw new Error('source terrain has duplicate XZ vertices');vertexMap.set(key,i);const base=position.getY(i);baseMap.set(key,base);if(heightAt&&!preserve([x,z])){spend();const y=heightAt({x,z,baseHeight:base});if(!finite(y)||Math.abs(y)>100000)throw new Error('heightAt must return a finite height within ±100000');positions[i*3+1]=Math.fround(y);}
   const finalPosition=[positions[i*3],positions[i*3+1],positions[i*3+2]],sourcePosition=[x,base,z];
   for(const [name,entry] of customAttributes){const sourceValues=[Array.from({length:entry.itemSize},(_,k)=>entry.attribute.getComponent(i,k))],resolved=entry.resolve({name,stage:'source-vertex',sourceValues,weights:[1],position:finalPosition,sourcePosition,sourceVertexIndices:[i]}),floatValues=Array.from(resolved??[],Math.fround);if((!Array.isArray(resolved)&&!ArrayBuffer.isView(resolved))||resolved.length!==entry.itemSize||floatValues.some(v=>!finite(v)))throw new Error(`attributeResolvers.${name} must return ${entry.itemSize} finite Float32 values at source-vertex`);entry.values.push(...floatValues);}
  }
  const vertexFor=(point,sourceTri)=>{
   const x=Math.fround(point[0]),z=Math.fround(point[1]),key=`${x},${z}`,weights=barycentric([x,z],sourceTri),base=weights.reduce((sum,w,i)=>sum+w*sourceTri[i][1],0);
   if(baseMap.has(key)&&Math.abs(baseMap.get(key)-base)>1e-5)throw new Error('source terrain height is discontinuous at a shared XZ point');
   let y=baseMap.get(key);
   if(y===undefined){y=Math.fround(base);baseMap.set(key,y);}
   if(vertexMap.has(key))return vertexMap.get(key);
   let nextY=y;
   if(heightAt&&!preserve([x,z]))nextY=heightAt({x,z,baseHeight:y});
   if(!finite(nextY)||Math.abs(nextY)>100000)throw new Error('heightAt must return a finite height within ±100000');
   nextY=Math.fround(nextY);const id=positions.length/3;if(id>=maxOutputVertices)throw new Error(`maxOutputVertices exceeded (${id+1} > ${maxOutputVertices})`);
   positions.push(x,nextY,z);vertexMap.set(key,id);
   if(uv){const w=weights.reduce((sum,v)=>sum+v,0);if(!finite(w)||Math.abs(w-1)>1e-5)throw new Error('constraint intersection left its source triangle');uvs.push(...[0,1].map(k=>weights.reduce((sum,v,i)=>sum+v*uv.getComponent(sourceTri[i][3],k),0)));}
   else uvs.push(x,z);
   if(normal){const n=[0,0,0];for(let i=0;i<3;i++)for(let k=0;k<3;k++)n[k]+=weights[i]*normal.getComponent(sourceTri[i][3],k);const len=Math.hypot(...n);if(!(len>0))throw new Error('interpolated source normal is degenerate');normals.push(...n.map(v=>v/len));}
   for(const [name,entry] of customAttributes){const sourceValues=sourceTri.map(vertex=>Array.from({length:entry.itemSize},(_,k)=>entry.attribute.getComponent(vertex[3],k))),resolved=entry.resolve({name,stage:'split-vertex',sourceValues,weights,position:[x,nextY,z],sourcePosition:[x,base,z],sourceVertexIndices:sourceTri.map(vertex=>vertex[3])}),floatValues=Array.from(resolved??[],Math.fround);if((!Array.isArray(resolved)&&!ArrayBuffer.isView(resolved))||resolved.length!==entry.itemSize||floatValues.some(v=>!finite(v)))throw new Error(`attributeResolvers.${name} must return ${entry.itemSize} finite Float32 values at split-vertex`);entry.values.push(...floatValues);}
   return id;
  };
  for(let i=0;i<index.count;i+=3){
   const sourceOutputTriangleStart=outputIndex.length/3,sourceFacePieceRecords=[],ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],tri=ids.map(id=>[position.getX(id),position.getY(id),position.getZ(id),id]),minX=Math.min(...tri.map(p=>p[0])),maxX=Math.max(...tri.map(p=>p[0])),minZ=Math.min(...tri.map(p=>p[2])),maxZ=Math.max(...tri.map(p=>p[2])),cx=Math.min(nx-1,lowerBound(xs,minX)),cz=Math.min(nz-1,lowerBound(zs,minZ)),candidateIds=ringBins[cz*nx+cx].filter(r=>{spend();const b=ringBounds[r];return b.maxX>=minX&&b.minX<=maxX&&b.maxZ>=minZ&&b.minZ<=maxZ;}),localRings=candidateIds.map(r=>splitRings[r]),localLines=candidateIds.map(r=>ringLines[r]);
   let ring,pieces;
   if(candidateIds.length){const sourceLines=ids.map((_,k)=>{spend();return lineEvents.add([tri[k][0],tri[k][2]],[tri[(k+1)%3][0],tri[(k+1)%3][2]]);});ring=splitSourceTriangleAtConstraints(tri,localRings,sourceLines,localLines,lineEvents,spend);pieces=[ring];
    for(let j=0;j<candidateIds.length;j++){const constraint=localRings[j],constraintLines=localLines[j],next=[];for(const piece of pieces){spend();next.push(...partitionByConvex(piece,constraint,constraintLines,lineEvents,spend));if(next.length>maxOutputTriangles)throw new Error('maxOutputTriangles exceeded during constraint partition');}pieces=next;}
   }else{ring={points:tri.map(p=>[p[0],p[2]]),edgeLines:[]};pieces=[ring];}
   if(candidateIds.length)pieces=nodeTaggedFloat32Rings(pieces,{maxWorkUnits:8000000,onWork:spend});
   if(pieces.length>1)splitSourceTriangles++;
   const exactVertices=new Set([...tri.map(p=>[p[0],p[2]]),...localRings.flat()].map(p=>`${p[0]},${p[1]}`)),expected=Math.abs(signedArea(ring.points)),actual=pieces.reduce((sum,p)=>sum+Math.abs(signedArea(p.points)),0),delta=Math.abs(actual-expected),baseTolerance=Math.max(1e-8,expected*2e-6);
   if(pieces.length>1){const bounds=pieces.map(piece=>({minX:Math.min(...piece.points.map(p=>p[0])),maxX:Math.max(...piece.points.map(p=>p[0])),minZ:Math.min(...piece.points.map(p=>p[1])),maxZ:Math.max(...piece.points.map(p=>p[1]))})),overlapTolerance=Math.max(1e-12,expected*1e-12);for(let a=0;a<pieces.length;a++)for(let b=a+1;b<pieces.length;b++){spend();const x=bounds[a],y=bounds[b];if(x.maxX<=y.minX||y.maxX<=x.minX||x.maxZ<=y.minZ||y.maxZ<=x.minZ)continue;let intersection;try{intersection=clipConvexPolygon(pieces[a].points,pieces[b].points,{epsilon:1e-10});}catch(error){throw new Error(`constraint partition produced an uncheckable polygon pair at source face ${i/3}, pieces ${a}/${b}: ${error.message}`,{cause:error});}const overlapArea=Math.abs(signedArea(intersection));if(overlapArea>overlapTolerance)throw new Error(`constraint partition pieces overlap at source face ${i/3}, pieces ${a}/${b}: area ${overlapArea} exceeds ${overlapTolerance}`);}}
   if(delta>baseTolerance){const quantizationBound=float32AreaQuantizationBound(ring.points,exactVertices)+pieces.reduce((sum,p)=>sum+float32AreaQuantizationBound(p.points,exactVertices),0),maxQuantizationError=expected*FLOAT32_MAX_RELATIVE_AREA_ERROR;if(quantizationBound>maxQuantizationError)throw new Error(`Float32 area precision budget exceeded at face ${i/3}: bound ${quantizationBound}, cap ${maxQuantizationError}, area ${expected}, observed partition delta ${delta}`);if(delta>quantizationBound)throw new Error(`constraint partition failed source-triangle coverage at face ${i/3}: expected ${expected}, got ${actual}, tolerance ${quantizationBound} (base tolerance ${baseTolerance})`);}
   for(let pieceIndex=0;pieceIndex<pieces.length;pieceIndex++){const piece=pieces[pieceIndex],pieceOutputFaces=[],idsOut=uniqueRing(piece.points.map(p=>vertexFor(p,tri))),orientation=Math.sign(signedArea(ring.points));if(idsOut.length<3)throw new Error('constraint polygon collapsed below three Float32 vertices');
    const emit=(a,b,c)=>{const area=cross([positions[a*3],positions[a*3+2]],[positions[b*3],positions[b*3+2]],[positions[c*3],positions[c*3+2]]);if(Math.abs(area)<=1e-12)throw new Error('constraint triangulation collapsed at Float32 precision');if(Math.sign(area)!==orientation)throw new Error('constraint split changed source triangle winding');if(++outputTriangles>maxOutputTriangles)throw new Error(`maxOutputTriangles exceeded (${outputTriangles} > ${maxOutputTriangles})`);pieceOutputFaces.push(outputIndex.length/3-sourceOutputTriangleStart);outputIndex.push(a,b,c);if(outputSourceTriangleIds)outputSourceTriangleIds.push(i/3);};
    const points=idsOut.map(id=>[positions[id*3],positions[id*3+2]]),triangulation=triangulateFloat32Ring(points,{maxWorkUnits:8000000,onWork:spend,assumeConvexInput:true}),origin=points[0];let twiceArea=0,cx=0,cz=0;
    for(let j=1;j<points.length-1;j++){const a=points[j],b=points[j+1],ax=a[0]-origin[0],az=a[1]-origin[1],bx=b[0]-origin[0],bz=b[1]-origin[1],weight=ax*bz-bx*az;twiceArea+=weight;cx+=(ax+bx)*weight;cz+=(az+bz)*weight;}
    const center=[Math.fround(origin[0]+cx/(3*twiceArea)),Math.fround(origin[1]+cz/(3*twiceArea))],centerInKernel=points.every((a,j)=>cross(a,points[(j+1)%points.length],center)*orientation>1e-12);
    if(centerInKernel){const centerId=vertexFor(center,tri);for(let j=0;j<idsOut.length;j++)emit(centerId,idsOut[j],idsOut[(j+1)%idsOut.length]);}
    else for(const [a,b,c] of triangulation.triangles)emit(idsOut[a],idsOut[b],idsOut[c]);
    sourceFacePieceRecords.push({pieceIndex,sourceRing:piece.points,sourceEdgeSupports:piece.edgeLines.map(line=>line?.key??null),representedRing:points,triangulation:centerInKernel?'center-fan':'ear',center,outputLocalFaces:pieceOutputFaces});
   }
   if(outputIndex.length/3-sourceOutputTriangleStart>1){const emittedTriangles=[];for(let face=sourceOutputTriangleStart;face<outputIndex.length/3;face++){const triangle=[0,1,2].map(k=>{const id=outputIndex[face*3+k];return [positions[id*3],positions[id*3+2]];});emittedTriangles.push(triangle);}let maxOverlapArea=0,overlapPairs=0;const overlapTolerance=Math.max(1e-12,expected*5e-10);for(let a=0;a<emittedTriangles.length;a++)for(let b=a+1;b<emittedTriangles.length;b++){spend();const x=emittedTriangles[a],y=emittedTriangles[b],xb={minX:Math.min(...x.map(p=>p[0])),maxX:Math.max(...x.map(p=>p[0])),minZ:Math.min(...x.map(p=>p[1])),maxZ:Math.max(...x.map(p=>p[1]))},yb={minX:Math.min(...y.map(p=>p[0])),maxX:Math.max(...y.map(p=>p[0])),minZ:Math.min(...y.map(p=>p[1])),maxZ:Math.max(...y.map(p=>p[1]))};if(xb.maxX<=yb.minX||yb.maxX<=xb.minX||xb.maxZ<=yb.minZ||yb.maxZ<=xb.minZ)continue;const intersection=clipConvexPolygon(x,y,{epsilon:1e-10}),overlapArea=Math.abs(signedArea(intersection));if(overlapArea>overlapTolerance){const localFaces=[a,b],pieceRecords=localFaces.map(localFace=>sourceFacePieceRecords.find(record=>record.outputLocalFaces.includes(localFace)));const error=new Error(`constraint triangulation overlaps within source face ${i/3}, output faces ${sourceOutputTriangleStart+a}/${sourceOutputTriangleStart+b}: area ${overlapArea} exceeds ${overlapTolerance}; triangles=${JSON.stringify([x,y])}`);error.details={sourceFace:i/3,outputFaces:[sourceOutputTriangleStart+a,sourceOutputTriangleStart+b],overlapArea,overlapTolerance,triangles:[x,y],pieceRecords};throw error;}}if(collectTopologyDiagnostics){const emittedArea=emittedTriangles.reduce((sum,face)=>sum+Math.abs(signedArea(face)),0),pieceArea=pieces.reduce((sum,p)=>sum+Math.abs(signedArea(p.points)),0),areaDelta=emittedArea-pieceArea;if(overlapPairs||Math.abs(areaDelta)>Math.max(1e-9,expected*1e-7))sourceTriangleDiagnostics.push({sourceTriangle:i/3,pieceCount:pieces.length,triangleCount:emittedTriangles.length,pieceArea,emittedArea,areaDelta,overlapPairs,maxOverlapArea});}}
  }
  const preConformIndex=collectTopologyDiagnostics?outputIndex.slice():undefined,preConformTopology=collectTopologyDiagnostics?indexedTopologySnapshot(preConformIndex,positions):undefined,conformed=conformIndex(T,positions,uvs,normals,customAttributes,outputIndex,maxOutputVertices,spend);if(conformed.triangles>maxOutputTriangles)throw new Error(`maxOutputTriangles exceeded while conforming mesh (${conformed.triangles} > ${maxOutputTriangles})`);outputIndex.length=conformed.index.length;for(let i=0;i<conformed.index.length;i++)outputIndex[i]=conformed.index[i];outputTriangles=conformed.triangles;const afterConformTopology=collectTopologyDiagnostics?indexedTopologySnapshot(outputIndex,positions):undefined,preConformCoverage=collectTopologyDiagnostics?locateIndexedMeshPoints(preConformIndex,positions,afterConformTopology.samples.map(({edge})=>[(edge[0][0]+edge[1][0])/2,(edge[0][1]+edge[1][1])/2]),outputSourceTriangleIds):undefined,topologyDiagnostics=collectTopologyDiagnostics?Object.freeze({beforeConform:preConformTopology,afterConform:afterConformTopology,postBoundaryMidpointCoverageBeforeConform:preConformCoverage,sourceTriangleDiagnostics}):undefined;
  if(vertexMap.size>maxOutputVertices)throw new Error('maxOutputVertices exceeded');
  const geometry=new T.BufferGeometry();try{
   geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
   for(const [name,entry] of customAttributes)geometry.setAttribute(name,new T.Float32BufferAttribute(entry.values,entry.itemSize));
   if(heightAt||!normal)geometry.computeVertexNormals();else geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
   geometry.setIndex(positions.length/3>65535?new T.Uint32BufferAttribute(outputIndex,1):new T.Uint16BufferAttribute(outputIndex,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  }catch(error){geometry.dispose();throw error;}
  return {geometry,stats:Object.freeze({sourceTriangles:sourceTriangleCount,outputTriangles,outputVertices:positions.length/3,splitSourceTriangles,constraintCount:constraints.length,protectedRegionCount:protectedRegions.length,workUnits:work,...(topologyDiagnostics?{topologyDiagnostics}:{})}),dispose(){geometry.dispose();}};
 }finally{sourceSupport.dispose();}
}
