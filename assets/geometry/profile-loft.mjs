// Inject the caller's THREE runtime. Coordinates and UV scale are in caller units.
// Helpers are shared by the Bezier shell so both query exactly their emitted mesh.
export function finalizeSurfaceGeometry(T, positions, uvs, indices, groups=[]) {
  const p=Float32Array.from(positions);
  if(!p.every(Number.isFinite)||!uvs.every(Number.isFinite))throw new RangeError('Geometry exceeds Float32 precision');
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
  for(let i=0;i<indices.length;i+=3){
    a.fromArray(p,indices[i]*3);b.fromArray(p,indices[i+1]*3).sub(a);c.fromArray(p,indices[i+2]*3).sub(a);
    const scale=b.lengthSq()*c.lengthSq(),area=b.clone().cross(c).lengthSq();
    if(!Number.isFinite(scale)||scale===0||area<=scale*1e-24)throw new RangeError(`Degenerate or Float32-collapsed triangle ${i/3}`);
  }
  const geometry=new T.BufferGeometry();
  try{
    geometry.setAttribute('position',new T.BufferAttribute(p,3));
    geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
    for(const g of groups)geometry.addGroup(g.start,g.count,g.materialIndex);
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
  }catch(error){geometry.dispose();throw error;}
}
export function sampleSurfaceTriangle(T,geometry,triangleIndex,weights,axis) {
  const vertices=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(geometry.attributes.position,geometry.index.getX(triangleIndex*3+k)));
  const [a,b,c]=vertices, normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const point=new T.Vector3();vertices.forEach((p,i)=>point.addScaledVector(p,weights[i]));
  const tangent=axis.clone().addScaledVector(normal,-axis.dot(normal));
  if(tangent.lengthSq()<1e-24){tangent.copy(b).sub(a).addScaledVector(normal,-b.clone().sub(a).dot(normal));}
  tangent.normalize();const x=tangent.clone().cross(normal).normalize();tangent.copy(normal).cross(x).normalize();
  return {point,normal,tangent,frame:new T.Matrix4().makeBasis(x,tangent,normal).setPosition(point),triangleIndex};
}
export function validateSurfaceParameters(u,v) {
  for(const [name,n]of [['u',u],['v',v]])if(!Number.isFinite(n)||n<0||n>1)throw new RangeError(`${name} must be finite in [0,1]`);
}
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function validateProfile(input) {
  if(!Array.isArray(input)||input.length<3||input.length>2048||input.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw new TypeError('profile needs 3..2048 finite 2D points without repeated closing point');
  const p=input.map(x=>[...x]),extent=Math.max(...p.flat().map(Math.abs)),eps=Math.max(extent*1e-12,1e-15);
  const on=(a,b,p)=>Math.abs(orient(a,b,p))<=eps*Math.hypot(b[0]-a[0],b[1]-a[1])&&p[0]>=Math.min(a[0],b[0])-eps&&p[0]<=Math.max(a[0],b[0])+eps&&p[1]>=Math.min(a[1],b[1])-eps&&p[1]<=Math.max(a[1],b[1])+eps;
  for(let i=0;i<p.length;i++){
    const a=p[i],b=p[(i+1)%p.length];
    if(Math.hypot(a[0]-b[0],a[1]-b[1])<=eps)throw new RangeError('profile has duplicate or degenerate edge');
    if(Math.abs(orient(p[(i+p.length-1)%p.length],a,b))<=eps*eps)throw new RangeError('profile has degenerate collinear corner');
    for(let j=i+1;j<p.length;j++){
      if(j===i+1||(i===0&&j===p.length-1))continue;
      const c=p[j],d=p[(j+1)%p.length],abC=orient(a,b,c),abD=orient(a,b,d),cdA=orient(c,d,a),cdB=orient(c,d,b);
      if((abC*abD<0&&cdA*cdB<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw new RangeError('profile self-intersection or touching edges');
    }
  }
  let area=0;for(let i=1;i<p.length-1;i++)area+=orient(p[0],p[i],p[i+1]);
  if(!Number.isFinite(area)||Math.abs(area)<=eps*eps)throw new RangeError('profile has degenerate area');
  return {points:p,sign:Math.sign(area)};
}

/** Corresponding arbitrary simple profile rings on a parallel-transport frame.
 * u = normalized centerline chord arc; v = vertex-number parameter, v=1 wraps.
 * Query returns actual side-triangle points/normals. Caps use concave ear clipping.
 * Rejects sampled degeneracy; does NOT prove the whole loft is self-intersection free.
 * Owns geometry only. Do not mutate its attributes before querying or disposing.
 */
export function createProfileLoftSource(T,{stations,reference=[1,0,0],caps=true,uvMeters=1}={}) {
  if(!Array.isArray(stations)||stations.length<2||stations.length>4096)throw new TypeError('At least two stations required (maximum 4096)');
  if(!Number.isFinite(uvMeters)||uvMeters<=0)throw new RangeError('uvMeters must be positive');
  if(typeof caps!=='boolean')throw new TypeError('caps must be boolean');
  const rings=stations.map(s=>validateProfile(s.profile)),count=rings[0].points.length,sign=rings[0].sign;
  if(rings.some(r=>r.points.length!==count||r.sign!==sign))throw new RangeError('Corresponding profiles need identical point counts and winding');
  const centers=stations.map(s=>{if(!Array.isArray(s.center)||s.center.length!==3||!s.center.every(Number.isFinite)||!Number.isFinite(s.rollRadians??0))throw new TypeError('station center and rollRadians must be finite');return new T.Vector3(...s.center);});
  const arcs=[0],directions=centers.slice(1).map((p,i)=>{const d=p.clone().sub(centers[i]),len=d.length();if(!Number.isFinite(len)||len<=1e-12)throw new RangeError('spine stations need distinct finite centers');arcs.push(arcs.at(-1)+len);return d.divideScalar(len);});
  const tangents=centers.map((_,i)=>{if(!i)return directions[0].clone();if(i===centers.length-1)return directions.at(-1).clone();if(directions[i-1].dot(directions[i])<-.999)throw new RangeError('Reversing spine cusp needs a new path');return directions[i-1].clone().add(directions[i]).normalize();});
  if(!Array.isArray(reference)||reference.length!==3||!reference.every(Number.isFinite))throw new TypeError('reference must be finite xyz');
  let side=new T.Vector3(...reference);side.addScaledVector(tangents[0],-side.dot(tangents[0]));if(side.lengthSq()<1e-20)throw new RangeError('reference must not parallel first tangent');side.normalize();
  const positions=[],uvs=[],indices=[],row=count+1,frames=[];
  for(let i=0;i<centers.length;i++){
    if(i){side.applyQuaternion(new T.Quaternion().setFromUnitVectors(tangents[i-1],tangents[i]));side.addScaledVector(tangents[i],-side.dot(tangents[i])).normalize();}
    const w=side.clone().applyAxisAngle(tangents[i],stations[i].rollRadians??0),d=w.clone().cross(tangents[i]).normalize();frames.push({w,d});let perimeter=0;
    for(let j=0;j<=count;j++){
      const p=rings[i].points[j%count];if(j){const q=rings[i].points[j-1];perimeter+=Math.hypot(p[0]-q[0],p[1]-q[1]);}
      positions.push(...centers[i].clone().addScaledVector(w,p[0]).addScaledVector(d,p[1]).toArray());uvs.push(perimeter/uvMeters,arcs[i]/uvMeters);
    }
  }
  const tri=(a,b,c)=>indices.push(...(sign>0?[a,b,c]:[a,c,b]));
  for(let i=0;i<centers.length-1;i++)for(let j=0;j<count;j++){const a=i*row+j,b=a+row,c=a+1,d=b+1;tri(a,b,d);tri(a,d,c);}
  const sideIndices=indices.length,groups=[{start:0,count:sideIndices,materialIndex:0}];
  if(caps)for(const i of [0,centers.length-1]){
    const start=positions.length/3,ring=rings[i].points,first=indices.length;
    for(const [x,y]of ring){positions.push(...centers[i].clone().addScaledVector(frames[i].w,x).addScaledVector(frames[i].d,y).toArray());uvs.push(x/uvMeters,y/uvMeters);}
    const triangles=T.ShapeUtils.triangulateShape(ring.map(p=>new T.Vector2(...p)),[]);
    if(triangles.length!==count-2)throw new RangeError('profile cap triangulation failed');
    for(const t of triangles){const [a,b,c]=t.map(k=>new T.Vector3().fromArray(positions,(start+k)*3)),n=b.sub(a).cross(c.sub(a));const desired=tangents[i].clone().multiplyScalar(i===0?-1:1);indices.push(...(n.dot(desired)>0?t:[t[0],t[2],t[1]]).map(k=>start+k));}
    groups.push({start:first,count:indices.length-first,materialIndex:1});
  }
  const geometry=finalizeSurfaceGeometry(T,positions,uvs,indices,groups),normals=geometry.attributes.normal;
  for(let i=0;i<centers.length;i++){const a=i*row,b=a+count,n=new T.Vector3().fromBufferAttribute(normals,a).add(new T.Vector3().fromBufferAttribute(normals,b)).normalize();normals.setXYZ(a,n.x,n.y,n.z);normals.setXYZ(b,n.x,n.y,n.z);}
  let disposed=false;
  return {geometry,metadata:{kind:'profile-loft',stations:centers.length,profilePoints:count,arcLength:arcs.at(-1),caps,sideTriangles:sideIndices/3,uvMeters},surfaceAt(u,v){
    if(disposed)throw new Error('Profile loft is disposed');validateSurfaceParameters(u,v);
    const distance=u*arcs.at(-1);let low=0,high=arcs.length-1;while(low+1<high){const m=(low+high)>>>1;if(arcs[m]<=distance)low=m;else high=m;}
    const s=(distance-arcs[low])/(arcs[low+1]-arcs[low]),around=(v===1?0:v)*count,j=Math.min(Math.floor(around),count-1),t=around-j,first=t<=s;
    let weights=first?[1-s,s-t,t]:[1-t,s,t-s];if(sign<0)weights=[weights[0],weights[2],weights[1]];
    return {...sampleSurfaceTriangle(T,geometry,(low*count+j)*2+(first?0:1),weights,directions[low]),segmentIndex:low};
  },dispose(){if(!disposed){disposed=true;geometry.dispose();}}};
}
