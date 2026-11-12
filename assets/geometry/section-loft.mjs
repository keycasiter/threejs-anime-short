// Original elliptical section loft. Units match the caller's world; no embedded model data.
export function createSectionLoftGeometry(T, {
  stations, radialSegments=24, caps=true, reference=[1,0,0], uvMeters=1,
}={}) {
  if(!Array.isArray(stations)||stations.length<2)throw new Error('At least two stations required');
  if(!Number.isInteger(radialSegments)||radialSegments<3||radialSegments>512)throw new Error('radialSegments must be an integer in 3..512');
  if(!(Number.isFinite(uvMeters)&&uvMeters>0))throw new Error('uvMeters must be positive');
  const points=stations.map(s=>{
    if(!Array.isArray(s.center)||s.center.length!==3||!s.center.every(Number.isFinite))throw new Error('station center must be finite xyz');
    for(const key of ['width','depth'])if(!(Number.isFinite(s[key])&&s[key]>0))throw new Error(`${key} must be positive`);
    if(!Number.isFinite(s.rollRadians??0))throw new Error('rollRadians must be finite');
    return new T.Vector3(...s.center);
  });
  const directions=points.slice(1).map((p,i)=>{
    const v=p.clone().sub(points[i]);if(v.lengthSq()<1e-16)throw new Error('spine centers must be distinct');return v.normalize();
  });
  const tangents=points.map((p,i)=>{
    if(i===0)return directions[0].clone();if(i===points.length-1)return directions.at(-1).clone();
    if(directions[i-1].dot(directions[i])<-.999)throw new Error('reversing spine cusp needs a new path');
    return directions[i-1].clone().add(directions[i]).normalize();
  });
  if(!Array.isArray(reference)||reference.length!==3||!reference.every(Number.isFinite))throw new Error('reference must be finite xyz');
  let side=new T.Vector3(...reference).addScaledVector(tangents[0],-new T.Vector3(...reference).dot(tangents[0]));
  if(side.lengthSq()<1e-12)throw new Error('reference must not be parallel to first spine tangent');
  side.normalize();
  const position=[],uv=[],index=[],arc=[0],frames=[];
  for(let i=1;i<points.length;i++)arc.push(arc.at(-1)+points[i].distanceTo(points[i-1]));
  for(let i=0;i<points.length;i++){
    if(i){side.applyQuaternion(new T.Quaternion().setFromUnitVectors(tangents[i-1],tangents[i]));side.addScaledVector(tangents[i],-side.dot(tangents[i])).normalize();}
    const w=side.clone().applyAxisAngle(tangents[i],stations[i].rollRadians??0),d=w.clone().cross(tangents[i]).normalize();
    frames.push({w,d});let perimeter=0,prev;
    for(let j=0;j<=radialSegments;j++){
      const a=j===radialSegments?0:2*Math.PI*j/radialSegments;
      const local=w.clone().multiplyScalar(Math.cos(a)*stations[i].width/2).addScaledVector(d,Math.sin(a)*stations[i].depth/2);
      if(prev)perimeter+=local.distanceTo(prev);prev=local.clone();const v=local.add(points[i]);
      position.push(...v.toArray());uv.push(perimeter/uvMeters,arc[i]/uvMeters);
    }
  }
  const row=radialSegments+1;
  for(let i=0;i<points.length-1;i++)for(let j=0;j<radialSegments;j++){
    const a=i*row+j,b=a+row,c=a+1,d=b+1;index.push(a,b,d,a,d,c);
  }
  if(caps)for(const stationIndex of [0,points.length-1]){
    const start=position.length/3,center=points[stationIndex],f=frames[stationIndex];
    position.push(...center.toArray());uv.push(0,0);
    for(let j=0;j<radialSegments;j++){
      const a=2*Math.PI*j/radialSegments,x=Math.cos(a)*stations[stationIndex].width/2,z=Math.sin(a)*stations[stationIndex].depth/2;
      position.push(...center.clone().addScaledVector(f.w,x).addScaledVector(f.d,z).toArray());uv.push(x/uvMeters,z/uvMeters);
    }
    for(let j=0;j<radialSegments;j++){
      const a=start+1+j,b=start+1+(j+1)%radialSegments;
      index.push(...(stationIndex===0?[start,a,b]:[start,b,a]));
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(position,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();
  const normals=g.attributes.normal;
  for(let i=0;i<points.length;i++){
    const a=i*row,b=a+radialSegments,n=new T.Vector3().fromBufferAttribute(normals,a).add(new T.Vector3().fromBufferAttribute(normals,b)).normalize();normals.setXYZ(a,n.x,n.y,n.z);normals.setXYZ(b,n.x,n.y,n.z);
  }
  g.computeBoundingBox();g.computeBoundingSphere();return g;
}
