import {finalizeSurfaceGeometry,sampleSurfaceTriangle,validateSurfaceParameters} from './profile-loft.mjs';
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function ring(input,max,name,e,convex=false){
 if(!Array.isArray(input)||input.length<3||input.length>max||input.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw new TypeError(`${name} needs finite 2D points`);
 const p=input.map(p=>p.slice()),n=p.length,arcs=[0];let area=0;
 const on=(a,b,c)=>Math.abs(cross(a,b,c))<=e*Math.hypot(b[0]-a[0],b[1]-a[1])&&c.every((x,k)=>x>=Math.min(a[k],b[k])-e&&x<=Math.max(a[k],b[k])+e);
 for(let i=0;i<n;i++){const a=p[i],b=p[(i+1)%n],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<=e||!Number.isFinite(len))throw new RangeError(`${name} zero edge`);arcs.push(arcs.at(-1)+len);area+=cross(p[0],a,b);
 for(let j=i+1;j<n;j++){if(j===i+1||(i===0&&j===n-1))continue;const c=p[j],d=p[(j+1)%n];if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw new RangeError(`${name} intersects or touches`);}}
 if(!Number.isFinite(area)||Math.abs(area)<=e*e)throw new RangeError(`${name} area`);const sign=Math.sign(area);
 for(let i=0;i<n;i++){const turn=cross(p[(i+n-1)%n],p[i],p[(i+1)%n]);if(convex&&turn*sign<=e*arcs[i+1]-e*arcs[i])throw new RangeError('contour must be strictly convex');if(!convex&&Math.abs(turn)<=e*e){const a=p[(i+n-1)%n],b=p[i],c=p[(i+1)%n];if((b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])<0)throw new RangeError('profile reverses at vertex');}}
 return {p,n,arcs,sign};
}
/** Strict convex XY contour × simple (outset,Z) profile. Smooth normals are
 * equal-weight reachable quad unit normals; materials do not introduce creases.
 * UV uses each offset ring's actual arc and profile arc: miter cells may shear.
 * Owns geometry only; callers must not mutate geometry while querying. */
export function createContourProfileSource(T,{contour,profile,contourCreases,profileCreases,bandMaterialIndices,uvMeters=1,miterLimit=4,epsilon=1e-9,maxTriangles=250000}={}){
 if(!Number.isFinite(epsilon)||epsilon<=0||!Number.isFinite(uvMeters)||uvMeters<=0||!Number.isFinite(miterLimit)||miterLimit<1||!Number.isSafeInteger(maxTriangles)||maxTriangles<=0)throw new RangeError('Invalid numeric options');
 const C=ring(contour,2048,'contour',epsilon,true),P=ring(profile,256,'profile',epsilon),N=C.n,M=P.n;
 if(2*N*M>maxTriangles)throw new RangeError('Triangle budget exceeded');
 const creases=(v,n)=>{if(v===undefined)return Array(n).fill(true);if(!Array.isArray(v)||v.length!==n||Array.from(v).some(x=>typeof x!=='boolean'))throw new TypeError('Creases need matching boolean array');return v.slice();};
 const cc=creases(contourCreases,N),pc=creases(profileCreases,M),materials=bandMaterialIndices===undefined?Array(M).fill(0):(Array.isArray(bandMaterialIndices)?bandMaterialIndices.slice():null);
 if(!Array.isArray(materials)||materials.length!==M||Array.from(materials).some(x=>!Number.isSafeInteger(x)||x<0))throw new TypeError('Invalid band materials');
 const edges=C.p.map((p,i)=>{const q=C.p[(i+1)%N],l=C.arcs[i+1]-C.arcs[i];return [(q[0]-p[0])/l,(q[1]-p[1])/l];}),out=edges.map(([x,y])=>[C.sign*y,-C.sign*x]);
 const miters=out.map((n,i)=>{const prev=out[(i+N-1)%N],den=1+n[0]*prev[0]+n[1]*prev[1];if(den<=epsilon)throw new RangeError('Miter singularity');const m=[(n[0]+prev[0])/den,(n[1]+prev[1])/den];if(Math.hypot(...m)>miterLimit)throw new RangeError('Miter limit exceeded');return m;});
 const rings=P.p.map(([d,z])=>C.p.map((p,i)=>[p[0]+d*miters[i][0],p[1]+d*miters[i][1],z]));
 for(let j=0;j<M;j++)for(let i=0;i<N;i++){const a=rings[j][i],b=rings[j][(i+1)%N];if((b[0]-a[0])*edges[i][0]+(b[1]-a[1])*edges[i][1]<=epsilon)throw new RangeError('Offset edge collapsed or reversed');for(let k=0;k<N;k++){const q=C.p[k],n=out[k];if((a[0]-q[0])*n[0]+(a[1]-q[1])*n[1]>P.p[j][0]+epsilon)throw new RangeError('Offset outside half-plane');}}
 // A conservative clearance certificate for this 2D offset family. Quantized
 // points move by at most quantizationError, so nonadjacent profile bands need
 // more than twice that clearance. This deliberately rejects unresolved gaps.
 let quantizationError=0;
 for(const r of rings)for(const point of r){
  quantizationError=Math.max(quantizationError,Math.hypot(...point.map(x=>Math.fround(x)-x)));
 }
 function pointSegmentDistance(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
 }
 for(let j=0;j<M;j++)for(let k=j+1;k<M;k++){
  if(k===j+1||(j===0&&k===M-1))continue;
  const a=P.p[j],b=P.p[(j+1)%M],c=P.p[k],d=P.p[(k+1)%M];
  const clearance=Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
  if(clearance<=2*quantizationError)throw new RangeError('Float32 nonadjacent profile clearance lost');
 }
 const arcs=rings.map(r=>{const a=[0];for(let i=0;i<N;i++)a.push(a.at(-1)+Math.hypot(r[(i+1)%N][0]-r[i][0],r[(i+1)%N][1]-r[i][1]));return a;});
 const positions=[],uvs=[],indices=[],groups=[],bands=[],flip=C.sign*P.sign<0;
 function emitCell(i,j){
  const nextBand=(j+1)%M,nextContour=(i+1)%N,base=positions.length/3;
  const corners=[
   [j,i,arcs[j][i],P.arcs[j]],
   [j,nextContour,arcs[j][i+1],P.arcs[j]],
   [nextBand,nextContour,arcs[nextBand][i+1],P.arcs[j+1]],
   [nextBand,i,arcs[nextBand][i],P.arcs[j+1]]
  ];
  for(const [r,c,u,v]of corners){
   positions.push(...rings[r][c]);
   uvs.push(u/uvMeters,v/uvMeters);
  }
  for(const triangle of [[0,1,2],[0,2,3]]){
   const ordered=flip?[triangle[0],triangle[2],triangle[1]]:triangle;
   indices.push(...ordered.map(index=>base+index));
  }
 }
 function emitBand(j){
  const start=indices.length;
  for(let i=0;i<N;i++)emitCell(i,j);
  const count=indices.length-start,materialIndex=materials[j];
  bands.push({profileBand:j,materialIndex,triangleStart:start/3,triangleCount:count/3});
  const last=groups.at(-1);
  if(last?.materialIndex===materialIndex)last.count+=count;
  else groups.push({start,count,materialIndex});
 }
 for(let j=0;j<M;j++)emitBand(j);
 const geometry=finalizeSurfaceGeometry(T,positions,uvs,indices,groups);
 try{
 const pos=geometry.attributes.position,normal=geometry.attributes.normal,cellNormals=[];
 // Validate emitted Float32 edge direction before normals: quantization must not
 // reverse an offset edge or an entire cell while leaving triangles nonzero.
 for(let j=0;j<M;j++)for(let i=0;i<N;i++){const base=(j*N+i)*4,a=new T.Vector3().fromBufferAttribute(pos,base),b=new T.Vector3().fromBufferAttribute(pos,base+1);if(b.clone().sub(a).dot(new T.Vector3(...edges[i],0))<=0)throw new RangeError('Float32 offset edge reversed');const ideal=new T.Vector3(...rings[j][(i+1)%N]).sub(new T.Vector3(...rings[j][i])).cross(new T.Vector3(...rings[(j+1)%M][(i+1)%N]).sub(new T.Vector3(...rings[j][i]))),actual=b.sub(a).cross(new T.Vector3().fromBufferAttribute(pos,base+2).sub(a));if(actual.dot(ideal)<=0)throw new RangeError('Float32 cell winding reversed');}
 for(let c=0;c<N*M;c++){const vs=[0,1,2,3].map(k=>new T.Vector3().fromBufferAttribute(pos,c*4+k));const n=vs[1].clone().sub(vs[0]).cross(vs[2].clone().sub(vs[0])).normalize().multiplyScalar(flip?-1:1),n2=vs[2].clone().sub(vs[0]).cross(vs[3].clone().sub(vs[0])).normalize().multiplyScalar(flip?-1:1);if(n.dot(n2)<1-1e-6)throw new RangeError('Float32 cell folded or nonplanar');cellNormals.push(n);}
 for(let j=0;j<M;j++)for(let i=0;i<N;i++)for(let corner=0;corner<4;corner++){const vi=(i+(corner===1||corner===2?1:0))%N,vj=(j+(corner>=2?1:0))%M,is=cc[vi]?[i]:[(vi+N-1)%N,vi],js=pc[vj]?[j]:[(vj+M-1)%M,vj],sum=new T.Vector3();for(const y of js)for(const x of is)sum.add(cellNormals[y*N+x]);if(sum.length()<=epsilon)throw new RangeError('Smooth normal cancellation');sum.normalize();normal.setXYZ((j*N+i)*4+corner,sum.x,sum.y,sum.z);}
 if(!geometry.attributes.uv.array.every(Number.isFinite)||!Number.isFinite(geometry.boundingSphere.radius))throw new RangeError('Float32 bounds or UV overflow');
 let disposed=false;
 function locateArc(arcs,parameter){
  const value=parameter===1?0:parameter,total=arcs.at(-1);
  let segment=0;
  while(segment<arcs.length-2&&arcs[segment+1]/total<=value)segment++;
  const start=arcs[segment]/total,end=arcs[segment+1]/total;
  return [segment,(value-start)/(end-start)];
 }
 function querySurface(u,v){
  if(disposed)throw new Error('Contour profile is disposed');
  validateSurfaceParameters(u,v);
  const [i,t]=locateArc(C.arcs,u),[j,s]=locateArc(P.arcs,v),first=s<=t;
  let weights=first?[1-t,t-s,s]:[1-s,t,s-t];
  if(flip)weights=[weights[0],weights[2],weights[1]];
  const cellStart=(j*N+i)*4;
  const axis=new T.Vector3().fromBufferAttribute(pos,cellStart+1)
   .sub(new T.Vector3().fromBufferAttribute(pos,cellStart));
  const sample=sampleSurfaceTriangle(T,geometry,(j*N+i)*2+(first?0:1),weights,axis);
  return {...sample,contourSegment:i,profileBand:j,materialIndex:materials[j]};
 }

 return {geometry,metadata:{kind:'contour-profile',contour:C.p.map(p=>p.slice()),profile:P.p.map(p=>p.slice()),contourArcLengths:C.arcs.slice(),profileArcLengths:P.arcs.slice(),offsetArcLengths:arcs.map(a=>a.slice()),bands,miterRatios:miters.map(m=>Math.hypot(...m)),triangleCount:2*N*M,uvMeters,uvApproximation:'Offset-ring arcs and profile arcs; miter cells may be nonorthogonal'},surfaceAt:querySurface,dispose(){if(!disposed){disposed=true;geometry.dispose();}}};
 }catch(error){geometry.dispose();throw error;}
}
