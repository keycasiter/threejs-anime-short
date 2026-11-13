import {prepareTerrainRoadSupport} from './terrain-roads.mjs';

const finite=Number.isFinite,EPS=1e-10;
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const signedArea=poly=>{if(poly.length<3)return 0;const origin=poly[0];let twiceArea=0;for(let i=1;i<poly.length-1;i++)twiceArea+=cross(origin,poly[i],poly[i+1]);return twiceArea/2;};
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
function clean(poly){
 const out=[];for(const p of poly){if(!out.length||!same(out.at(-1),p))out.push(p);}
 if(out.length>1&&same(out[0],out.at(-1)))out.pop();
 return out.length>=3&&Math.abs(signedArea(out))>EPS?out:[];
}
function clipHalfPlane(poly,a,b,inside){
 if(!poly.length)return [];
 const out=[];let prev=poly.at(-1),dp=cross(a,b,prev),prevIn=inside?dp>=0:dp<=0;
 for(const cur of poly){const dc=cross(a,b,cur),curIn=inside?dc>=0:dc<=0;
  if(prevIn!==curIn){let p,q;if(cmpPoint(prev,cur)<=0){p=prev;q=cur;}else{p=cur;q=prev;}
   const da=cross(a,b,p),db=cross(a,b,q),t=da/(da-db);out.push([Math.fround(p[0]+(q[0]-p[0])*t),Math.fround(p[1]+(q[1]-p[1])*t)]);
  }
  if(curIn)out.push(cur);prev=cur;prevIn=curIn;
 }
 return clean(out);
}
function partitionByConvex(poly,ring,spend){
 let remainder=poly;const pieces=[];
 for(let i=0;i<ring.length&&remainder.length;i++){
  spend();const a=ring[i],b=ring[(i+1)%ring.length],outside=clipHalfPlane(remainder,a,b,false),inside=clipHalfPlane(remainder,a,b,true);
  if(outside.length)pieces.push(outside);remainder=inside;
 }
 if(remainder.length)pieces.push(remainder);
 return pieces.length?pieces:[poly];
}
function pointOnSegment(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz;if(len2===0)return false;const t=((p[0]-a[0])*dx+(p[1]-a[1])*dz)/len2;return t>EPS&&t<1-EPS&&Math.abs(cross(a,b,p))<=1e-8*Math.sqrt(len2);}
function splitSourceTriangleAtConstraints(tri,rings,spend){
 const edges=[];for(const ring of rings)for(let i=0;i<ring.length;i++)edges.push([ring[i],ring[(i+1)%ring.length]]);
 const polygon=[];
 for(let i=0;i<3;i++){
  const a=[tri[i][0],tri[i][2]],b=[tri[(i+1)%3][0],tri[(i+1)%3][2]],lo=cmpPoint(a,b)<=0?a:b,hi=lo===a?b:a,dx=hi[0]-lo[0],dz=hi[1]-lo[1],length2=dx*dx+dz*dz,cuts=new Map();
  for(const [c,d]of edges){spend();
   if(pointOnSegment(c,lo,hi))cuts.set(`${Math.fround(c[0])},${Math.fround(c[1])}`,[Math.fround(c[0]),Math.fround(c[1])]);
   if(pointOnSegment(d,lo,hi))cuts.set(`${Math.fround(d[0])},${Math.fround(d[1])}`,[Math.fround(d[0]),Math.fround(d[1])]);
   const sx=d[0]-c[0],sz=d[1]-c[1],den=dx*sz-dz*sx;if(Math.abs(den)<=EPS)continue;
   const t=((c[0]-lo[0])*sz-(c[1]-lo[1])*sx)/den,u=((c[0]-lo[0])*dz-(c[1]-lo[1])*dx)/den;
   if(t>EPS&&t<1-EPS&&u>=-EPS&&u<=1+EPS){const p=[Math.fround(lo[0]+dx*t),Math.fround(lo[1]+dz*t)];if(pointOnSegment(p,lo,hi))cuts.set(`${p[0]},${p[1]}`,p);}
  }
  const ordered=[...cuts.values()].map(p=>({p,t:((p[0]-lo[0])*dx+(p[1]-lo[1])*dz)/length2})).sort((x,y)=>x.t-y.t);if(lo!==a)ordered.reverse();const along=[a,...ordered.map(v=>v.p),b];
  polygon.push(...along.slice(0,-1));
 }
 return clean(polygon);
}
function barycentric(p,tri){const [a,b,c]=tri.map(v=>[v[0],v[2]]),den=cross(a,b,c);return [cross(b,c,p)/den,cross(c,a,p)/den,cross(a,b,p)/den];}
function conformIndex(T,positions,uvs,normals,index,maxVertices,spend){
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
  for(let k=0;k<unique.length;k++){conforming.push(id,unique[k],unique[(k+1)%unique.length]);triangles++;}
 }
 return {index:conforming,triangles};
}

/**
 * Inserts convex constraint boundaries into a verified regular terrain mesh.
 * New heights are sampled from one world-space callback; protected regions
 * retain the original piecewise-linear surface exactly. The source geometry
 * is borrowed and never mutated. This is a mesh refiner, not a terrain design
 * solver: the caller supplies all constraints and the final height function.
 */
export function createConstrainedTerrainGeometry(T,{
 terrainGeometry,constraints=[],protectedRegions=[],heightAt,
 maxSourceTriangles=262144,maxOutputTriangles=1000000,maxOutputVertices=524288,maxWorkUnits=4000000
}={}){
 if(!T?.BufferGeometry||!T?.Float32BufferAttribute||!T?.Uint32BufferAttribute||!T?.Uint16BufferAttribute)throw new Error('inject the same THREE namespace used by the terrain consumer');
 if(typeof heightAt!=='undefined'&&typeof heightAt!=='function')throw new TypeError('heightAt must be a function when supplied');
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
  for(const name of Object.keys(terrainGeometry.attributes))if(!['position','uv','normal'].includes(name))throw new Error(`source terrain attribute ${name} cannot be interpolated safely`);
  if(uv&&(!uv.isBufferAttribute||uv.itemSize!==2||uv.count!==position.count))throw new Error('source uv must be a noninterleaved vec2 attribute matching positions');
  if(normal&&(!normal.isBufferAttribute||normal.itemSize!==3||normal.count!==position.count))throw new Error('source normal must be a noninterleaved vec3 attribute matching positions');
  let work=0,outputTriangles=0,splitSourceTriangles=0;
  const spend=()=>{if(++work>maxWorkUnits)throw new Error(`maxWorkUnits exceeded (${work} > ${maxWorkUnits})`);};
  const original=[...position.array],uvOriginal=uv?[...uv.array]:Array.from({length:position.count},(_,i)=>[position.getX(i),position.getZ(i)]).flat();
  const positions=[...original],uvs=[...uvOriginal],normals=normal?[...normal.array]:[],vertexMap=new Map(),baseMap=new Map(),outputIndex=[],sourceTriangleCount=index.count/3;
  if(sourceTriangleCount>maxSourceTriangles)throw new Error('maxSourceTriangles exceeded');
  if(position.count>maxOutputVertices)throw new Error(`maxOutputVertices exceeded by source mesh (${position.count} > ${maxOutputVertices})`);
  const preserve=point=>{for(let r=constraints.length;r<splits.length;r++){let within=true;const ring=splits[r];for(let i=0;i<ring.length;i++){spend();if(cross(ring[i],ring[(i+1)%ring.length],point)<-1e-7){within=false;break;}}if(within)return true;}return false;};
  const splitRings=splits;
  const xs=[...new Set(Array.from({length:position.count},(_,i)=>position.getX(i)))].sort((a,b)=>a-b),zs=[...new Set(Array.from({length:position.count},(_,i)=>position.getZ(i)))].sort((a,b)=>a-b),nx=xs.length-1,nz=zs.length-1,ringBounds=splits.map(bounds2),ringBins=Array.from({length:nx*nz},()=>[]);
  for(let r=0;r<ringBounds.length;r++){
   const b=ringBounds[r],x0=Math.max(0,lowerBound(xs,b.minX)-1),x1=Math.min(nx-1,lowerBound(xs,b.maxX)),z0=Math.max(0,lowerBound(zs,b.minZ)-1),z1=Math.min(nz-1,lowerBound(zs,b.maxZ));if(x0>x1||z0>z1)continue;
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){spend();ringBins[z*nx+x].push(r);}
  }
  for(let i=0;i<position.count;i++){spend();const x=position.getX(i),z=position.getZ(i),key=`${x},${z}`;if(vertexMap.has(key))throw new Error('source terrain has duplicate XZ vertices');vertexMap.set(key,i);const base=position.getY(i);baseMap.set(key,base);if(heightAt&&!preserve([x,z])){spend();const y=heightAt({x,z,baseHeight:base});if(!finite(y)||Math.abs(y)>100000)throw new Error('heightAt must return a finite height within ±100000');positions[i*3+1]=Math.fround(y);}}
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
   return id;
  };
  for(let i=0;i<index.count;i+=3){
   const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)],tri=ids.map(id=>[position.getX(id),position.getY(id),position.getZ(id),id]),minX=Math.min(...tri.map(p=>p[0])),maxX=Math.max(...tri.map(p=>p[0])),minZ=Math.min(...tri.map(p=>p[2])),maxZ=Math.max(...tri.map(p=>p[2])),cx=Math.min(nx-1,lowerBound(xs,minX)),cz=Math.min(nz-1,lowerBound(zs,minZ)),candidateIds=ringBins[cz*nx+cx].filter(r=>{spend();const b=ringBounds[r];return b.maxX>=minX&&b.minX<=maxX&&b.maxZ>=minZ&&b.minZ<=maxZ;}),localRings=candidateIds.map(r=>splitRings[r]),ring=splitSourceTriangleAtConstraints(tri,localRings,spend);let pieces=[ring];
   for(const r of candidateIds){const constraint=splitRings[r],next=[];for(const piece of pieces){spend();next.push(...partitionByConvex(piece,constraint,spend));if(next.length>maxOutputTriangles)throw new Error('maxOutputTriangles exceeded during constraint partition');}pieces=next;}
   if(pieces.length>1)splitSourceTriangles++;
   const expected=Math.abs(signedArea(ring)),actual=pieces.reduce((sum,p)=>sum+Math.abs(signedArea(p)),0),tol=Math.max(1e-8,expected*2e-6);if(Math.abs(actual-expected)>tol)throw new Error(`constraint partition failed source-triangle coverage at face ${i/3}: expected ${expected}, got ${actual}, tolerance ${tol}`);
   for(const piece of pieces){const idsOut=piece.map(p=>vertexFor(p,tri)),orientation=Math.sign(signedArea(ring));
    const emit=(a,b,c)=>{const area=cross([positions[a*3],positions[a*3+2]],[positions[b*3],positions[b*3+2]],[positions[c*3],positions[c*3+2]]);if(Math.abs(area)<=1e-12)throw new Error('constraint triangulation collapsed at Float32 precision');if(Math.sign(area)!==orientation)throw new Error('constraint split changed source triangle winding');if(++outputTriangles>maxOutputTriangles)throw new Error(`maxOutputTriangles exceeded (${outputTriangles} > ${maxOutputTriangles})`);outputIndex.push(a,b,c);};
    if(idsOut.length===3)emit(idsOut[0],idsOut[1],idsOut[2]);
    else{
     let twiceArea=0,cx=0,cz=0;for(let j=0;j<piece.length;j++){const a=piece[j],b=piece[(j+1)%piece.length],v=a[0]*b[1]-b[0]*a[1];twiceArea+=v;cx+=(a[0]+b[0])*v;cz+=(a[1]+b[1])*v;}
     const center=[Math.fround(cx/(3*twiceArea)),Math.fround(cz/(3*twiceArea))];for(let j=0;j<piece.length;j++){const a=piece[j],b=piece[(j+1)%piece.length],side=cross(a,b,center)*orientation;if(!(side>1e-12))throw new Error('constraint polygon has no representable strict interior fan point');}
     const centerId=vertexFor(center,tri);for(let j=0;j<idsOut.length;j++)emit(centerId,idsOut[j],idsOut[(j+1)%idsOut.length]);
    }
   }
  }
  const conformed=conformIndex(T,positions,uvs,normals,outputIndex,maxOutputVertices,spend);if(conformed.triangles>maxOutputTriangles)throw new Error(`maxOutputTriangles exceeded while conforming mesh (${conformed.triangles} > ${maxOutputTriangles})`);outputIndex.length=conformed.index.length;for(let i=0;i<conformed.index.length;i++)outputIndex[i]=conformed.index[i];outputTriangles=conformed.triangles;
  if(vertexMap.size>maxOutputVertices)throw new Error('maxOutputVertices exceeded');
  const geometry=new T.BufferGeometry();try{
   geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
   if(heightAt||!normal)geometry.computeVertexNormals();else geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
   geometry.setIndex(positions.length/3>65535?new T.Uint32BufferAttribute(outputIndex,1):new T.Uint16BufferAttribute(outputIndex,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  }catch(error){geometry.dispose();throw error;}
  return {geometry,stats:Object.freeze({sourceTriangles:sourceTriangleCount,outputTriangles,outputVertices:positions.length/3,splitSourceTriangles,constraintCount:constraints.length,protectedRegionCount:protectedRegions.length,workUnits:work}),dispose(){geometry.dispose();}};
 }finally{sourceSupport.dispose();}
}
