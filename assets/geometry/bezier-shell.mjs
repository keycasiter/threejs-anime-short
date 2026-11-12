import {finalizeSurfaceGeometry,sampleSurfaceTriangle,validateSurfaceParameters} from './profile-loft.mjs';
const bernstein=t=>[(1-t)**3,3*t*(1-t)**2,3*t*t*(1-t),t**3];
const derivative=t=>[-3*(1-t)**2,3*(1-t)*(1-3*t),3*t*(2-3*t),3*t*t];

/** Bicubic tensor patch, indexed as controlPoints[u][v]. Outer=B, inner=B-h*n,
 * n=normalize(du x dv). All four domain edges are closed by explicit wall strips.
 * Material slots: outer 0, inner 1, walls 2. Coordinates and UVs are metric.
 * surfaceAt samples actual emitted layer triangles, not the analytic patch.
 * A normal offset is not a globally collision-free shell for arbitrary curvature.
 */
export function createBezierPatchShell(T,{controlPoints,thickness,segmentsU=24,segmentsV=24,uvMeters=1}={}) {
  if(!Array.isArray(controlPoints)||controlPoints.length!==4||controlPoints.some(r=>!Array.isArray(r)||r.length!==4||r.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))))throw new TypeError('controlPoints must be 4 x 4 finite xyz');
  if(!Number.isFinite(thickness)||thickness<=0)throw new RangeError('thickness must be positive');
  if(!Number.isFinite(uvMeters)||uvMeters<=0)throw new RangeError('uvMeters must be positive');
  for(const [name,n]of [['segmentsU',segmentsU],['segmentsV',segmentsV]])if(!Number.isInteger(n)||n<1||n>512)throw new RangeError(`${name} must be an integer in 1..512`);
  const controls=controlPoints.map(r=>r.map(p=>new T.Vector3(...p)));
  function evaluate(u,v){
    const bu=bernstein(u),bv=bernstein(v),du=derivative(u),dv=derivative(v),point=new T.Vector3(),a=new T.Vector3(),b=new T.Vector3();
    for(let i=0;i<4;i++)for(let j=0;j<4;j++){point.addScaledVector(controls[i][j],bu[i]*bv[j]);a.addScaledVector(controls[i][j],du[i]*bv[j]);b.addScaledVector(controls[i][j],bu[i]*dv[j]);}
    const normal=a.clone().cross(b),scale=a.lengthSq()*b.lengthSq();
    if(!Number.isFinite(scale)||scale===0||normal.lengthSq()<=scale*1e-20)throw new RangeError(`Degenerate Bezier Jacobian at ${u},${v}`);
    return {point,normal:normal.normalize(),du:a};
  }
  const rows=segmentsV+1,layerSize=(segmentsU+1)*rows,positions=[],uvs=[],indices=[],groups=[],grids=[];
  for(const layer of ['outer','inner']){
    const grid=[];
    for(let i=0;i<=segmentsU;i++)for(let j=0;j<=segmentsV;j++){
      const sample=evaluate(i/segmentsU,j/segmentsV),p=sample.point.clone();if(layer==='inner')p.addScaledVector(sample.normal,-thickness);
      const f=p.toArray().map(Math.fround);if(!f.every(Number.isFinite))throw new RangeError('Bezier positions exceed Float32 precision');
      if(layer==='inner'&&f.every((x,k)=>x===positions[(i*rows+j)*3+k]))throw new RangeError('Bezier thickness is below Float32 position precision');
      grid.push(new T.Vector3(...f));positions.push(...f);
    }
    grids.push(grid);
    for(let i=0;i<=segmentsU;i++)for(let j=0;j<=segmentsV;j++){
      let a=0,b=0;for(let k=1;k<=i;k++)a+=grid[k*rows+j].distanceTo(grid[(k-1)*rows+j]);for(let k=1;k<=j;k++)b+=grid[i*rows+k].distanceTo(grid[i*rows+k-1]);uvs.push(a/uvMeters,b/uvMeters);
    }
    const start=indices.length,base=layer==='inner'?layerSize:0;
    for(let i=0;i<segmentsU;i++)for(let j=0;j<segmentsV;j++){
      const a=base+i*rows+j,b=a+rows,c=a+1,d=b+1;
      // Check centers too; lattice-only checks miss an interior zero Jacobian.
      evaluate((i+.5)/segmentsU,(j+.5)/segmentsV);
      indices.push(...(layer==='outer'?[a,b,d,a,d,c]:[a,d,b,a,c,d]));
    }
    groups.push({start,count:indices.length-start,materialIndex:layer==='outer'?0:1});
  }
  const edges=[Array.from({length:segmentsU+1},(_,i)=>i*rows),Array.from({length:segmentsV+1},(_,j)=>segmentsU*rows+j),Array.from({length:segmentsU+1},(_,i)=>(segmentsU-i)*rows+segmentsV),Array.from({length:segmentsV+1},(_,j)=>segmentsV-j)];
  for(const edge of edges){
    const start=indices.length,base=positions.length/3;let arc=0;
    for(let i=0;i<edge.length;i++){
      if(i)arc+=grids[0][edge[i]].distanceTo(grids[0][edge[i-1]]);
      positions.push(...grids[0][edge[i]].toArray(),...grids[1][edge[i]].toArray());uvs.push(arc/uvMeters,0,arc/uvMeters,thickness/uvMeters);
    }
    for(let i=0;i<edge.length-1;i++){const a=base+i*2,b=a+2;indices.push(b,a,a+1,b,a+1,b+1);}
    groups.push({start,count:indices.length-start,materialIndex:2});
  }
  const geometry=finalizeSurfaceGeometry(T,positions,uvs,indices,groups);let disposed=false;
  return {geometry,metadata:{kind:'bezier-shell',segmentsU,segmentsV,thickness,uvMeters,materialSlots:{outer:0,inner:1,wall:2}},surfaceAt(u,v,layer='outer'){
    if(disposed)throw new Error('Bezier shell is disposed');validateSurfaceParameters(u,v);if(!['outer','inner'].includes(layer))throw new RangeError('layer must be outer or inner');
    const x=u*segmentsU,y=v*segmentsV,i=Math.min(Math.floor(x),segmentsU-1),j=Math.min(Math.floor(y),segmentsV-1),s=x-i,t=y-j,first=t<=s;
    let weights=first?[1-s,s-t,t]:[1-t,s,t-s];if(layer==='inner')weights=[weights[0],weights[2],weights[1]];
    const id=((i*segmentsV+j)*2+(first?0:1))+(layer==='inner'?segmentsU*segmentsV*2:0);
    return {...sampleSurfaceTriangle(T,geometry,id,weights,evaluate(u,v).du),layer,cellU:i,cellV:j};
  },dispose(){if(!disposed){disposed=true;geometry.dispose();}}};
}
