/**
 * Compile a bounded, conforming height-field connector between two sampled
 * boundaries. The returned convex cells are consumed by
 * createConstrainedTerrainGeometry; this module never creates a floating mesh.
 * Coordinates are world XZ metres and heights are world Y metres.
 */
const finite=Number.isFinite;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area=ring=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function point(p,name){if(!Array.isArray(p)||p.length!==2||!p.every(v=>finite(v)&&Math.abs(v)<=100000))throw new TypeError(`${name} must be finite [x,z] within ±100000`);return [Math.fround(p[0]),Math.fround(p[1])];}
function ring(input,name){
 if(!Array.isArray(input)||input.length<3||input.length>256)throw new TypeError(`${name} must have 3..256 vertices`);
 const out=input.map((p,i)=>point(p,`${name}[${i}]`));
 for(let i=0;i<out.length;i++)if(distance(out[i],out[(i+1)%out.length])<=1e-7)throw new Error(`${name} has a zero-length Float32 edge`);
 let sign=0;for(let i=0;i<out.length;i++){const c=cross(out[i],out[(i+1)%out.length],out[(i+2)%out.length]);if(Math.abs(c)<=1e-9)continue;if(sign&&Math.sign(c)!==sign)throw new Error(`${name} must be convex`);sign=Math.sign(c);}
 if(!sign||Math.abs(area(out))<=1e-9)throw new Error(`${name} has zero area`);if(area(out)<0)out.reverse();return out;
}
function inside(p,poly,eps=1e-6){for(let i=0;i<poly.length;i++)if(cross(poly[i],poly[(i+1)%poly.length],p)<-eps)return false;return true;}
function bary(p,a,b,c){const d=cross(a,b,c);if(Math.abs(d)<1e-10)return null;const u=cross(p,b,c)/d,v=cross(a,p,c)/d,w=1-u-v;return [u,v,w];}
function sampleSurface(surface,p,name){
 let value;try{value=surface.sample(p[0],p[1]);}catch(error){throw new Error(`${name}.sample failed: ${error.message}`,{cause:error});}
 if(!value||!finite(value.height)||Math.abs(value.height)>100000)throw new Error(`${name}.sample must return a finite height`);
 if(value.revision!==surface.revision)throw new Error(`${name}.sample revision is stale or does not match its declared snapshot`);
 const normal=value.normal;
 if(!Array.isArray(normal)||normal.length!==3||!normal.every(finite)||normal[1]<=1e-5)throw new Error(`${name}.sample must return an upward finite normal [x,y,z]`);
 const n=Math.hypot(...normal),ny=normal[1]/n;if(ny<=1e-5)throw new Error(`${name}.sample normal is vertical or degenerate`);
 return {point:p,height:Math.fround(value.height),gx:-normal[0]/normal[1],gz:-normal[2]/normal[1]};
}
const hermite=(a,b,u,width)=>{const u2=u*u,u3=u2*u,dx=b.point[0]-a.point[0],dz=b.point[1]-a.point[1],d0=a.gx*dx+a.gz*dz,d1=b.gx*dx+b.gz*dz;return (2*u3-3*u2+1)*a.height+(u3-2*u2+u)*d0+(-2*u3+3*u2)*b.height+(u3-u2)*d1;};
function convexQuad(q,name){
 const ringed=ring(q,name);if(ringed.length!==4)throw new Error(`${name} collapsed after Float32 quantization`);
 for(let i=0;i<4;i++)if(cross(ringed[i],ringed[(i+1)%4],ringed[(i+2)%4])<=1e-9)throw new Error(`${name} is folded or degenerate`);
 return ringed;
}

/**
 * @param {object} options
 * @param {{id:string,boundary:[number,number][],sample:(x:number,z:number)=>{height:number,normal:number[]},revision:string}} options.source
 * @param {{id:string,boundary:[number,number][],sample:(x:number,z:number)=>{height:number,normal:number[]},revision:string}} options.target
 * @param {{stations:{from:[number,number],to:[number,number]}[],maxBoundaryError:number,maxProfileError:number,maxLongitudinalGrade:number,maxCrossSlope:number,maxBoundaryStep:number}} options
 */
export function compileTerrainInterfaceField({id,source,target,stations,limits={},maxCells=127,maxProfileSegments=32,epsilon=1e-5}={}){
 if(typeof id!=='string'||!id.trim())throw new TypeError('id must be a non-empty string');
 for(const [name,surface] of [['source',source],['target',target]])if(!surface||typeof surface.id!=='string'||typeof surface.revision!=='string'||!surface.revision||typeof surface.sample!=='function'||!Array.isArray(surface.boundary))throw new TypeError(`${name} requires id, stable revision, boundary and sample(x,z)`);
 if(!source.protectedRegion?.id||!Array.isArray(source.protectedRegion.outline))throw new TypeError('source.protectedRegion requires id and a convex outline');
 if(!target.zone?.id||!Array.isArray(target.zone.outline)||!finite(target.zone.targetHeight))throw new TypeError('target.zone requires id, convex outline and targetHeight');
 if(!Array.isArray(stations)||stations.length<2||stations.length>129)throw new TypeError('stations must contain 2..129 explicit paired cross-sections');
 const required=['maxBoundaryError','maxProfileError','maxLongitudinalGrade','maxCrossSlope','maxBoundaryStep'];for(const key of required)if(!finite(limits[key])||limits[key]<0)throw new TypeError(`limits.${key} must be finite and non-negative`);
 if(!Number.isSafeInteger(maxCells)||maxCells<1||maxCells>127||!Number.isSafeInteger(maxProfileSegments)||maxProfileSegments<1||maxProfileSegments>32)throw new TypeError('maxCells must be 1..127 (plus one target-zone constraint) and maxProfileSegments 1..32');
 if(!finite(epsilon)||epsilon<=0)throw new TypeError('epsilon must be positive');
 const fromBoundary=source.boundary.map((p,i)=>point(p,`source.boundary[${i}]`)),toBoundary=target.boundary.map((p,i)=>point(p,`target.boundary[${i}]`)),protectedOutline=ring(source.protectedRegion.outline,'source.protectedRegion.outline'),zoneOutline=ring(target.zone.outline,'target.zone.outline');
 if(fromBoundary.length<2||toBoundary.length<2)throw new Error('source and target boundaries require at least two points');
 const boundaryError=(p,poly)=>Math.min(...poly.slice(0,-1).map((a,i)=>{const b=poly[i+1],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);}),distance(p,poly.at(-1)),distance(p,poly[0]));
 const src=[],dst=[],conflicts=[];
 for(let i=0;i<stations.length;i++){
  const s=stations[i],from=point(s?.from,`stations[${i}].from`),to=point(s?.to,`stations[${i}].to`);
  if(boundaryError(from,fromBoundary)>epsilon||boundaryError(to,toBoundary)>epsilon)conflicts.push({kind:'station-not-on-declared-boundary',station:i});
  if(boundaryError(from,protectedOutline)>epsilon||boundaryError(to,zoneOutline)>epsilon)conflicts.push({kind:'station-not-on-authorized-shared-edge',station:i});
  src.push(sampleSurface(source,from,`source station ${i}`));dst.push(sampleSurface(target,to,`target station ${i}`));
  const targetError=Math.abs(dst[i].height-Math.fround(target.zone.targetHeight));if(targetError>limits.maxBoundaryError+epsilon)conflicts.push({kind:'target-boundary-error',station:i,measured:targetError,limit:limits.maxBoundaryError});if(targetError>limits.maxBoundaryStep+epsilon)conflicts.push({kind:'boundary-step-exceeded',station:i,measured:targetError,limit:limits.maxBoundaryStep});
 }
 let direction=0;for(let i=1;i<stations.length;i++){
  const ds=distance(src[i-1].point,src[i].point),dt=distance(dst[i-1].point,dst[i].point);
  if(ds<=epsilon||dt<=epsilon)conflicts.push({kind:'collapsed-longitudinal-station',station:i});
  const sx=src[i].point[0]-src[i-1].point[0],sz=src[i].point[1]-src[i-1].point[1],tx=dst[i].point[0]-dst[i-1].point[0],tz=dst[i].point[1]-dst[i-1].point[1],dot=sx*tx+sz*tz;
  if(dot<=0)conflicts.push({kind:'boundary-direction-mismatch',station:i});
  const gs=Math.abs(src[i].height-src[i-1].height)/Math.max(ds,epsilon),gt=Math.abs(dst[i].height-dst[i-1].height)/Math.max(dt,epsilon);
  if(Math.max(gs,gt)>limits.maxLongitudinalGrade+epsilon)conflicts.push({kind:'longitudinal-grade-exceeded',station:i,measured:Math.max(gs,gt),limit:limits.maxLongitudinalGrade});
 }
 const widthAt=i=>distance(src[i].point,dst[i].point);
 let transverseSegments=1,profileError=Infinity;
 while(transverseSegments<=maxProfileSegments){profileError=0;for(let i=0;i<src.length;i++){const w=widthAt(i);for(let j=0;j<transverseSegments;j++){const u0=j/transverseSegments,u1=(j+1)/transverseSegments,y0=hermite(src[i],dst[i],u0,w),y1=hermite(src[i],dst[i],u1,w);for(const f of [.25,.5,.75]){const actual=hermite(src[i],dst[i],u0+(u1-u0)*f,w),linear=y0+(y1-y0)*f;profileError=Math.max(profileError,Math.abs(actual-linear));}}}if(profileError<=limits.maxProfileError)break;transverseSegments*=2;}
 if(profileError>limits.maxProfileError+epsilon)conflicts.push({kind:'profile-error-exceeded',measured:profileError,limit:limits.maxProfileError});
 const cellCount=(stations.length-1)*transverseSegments;if(cellCount>maxCells)conflicts.push({kind:'cell-budget-exceeded',measured:cellCount,limit:maxCells});
 const grid=[];let maxCrossSlope=0;for(let i=0;i<src.length;i++){const row=[];for(let j=0;j<=transverseSegments;j++){const u=j/transverseSegments,a=src[i],b=dst[i],p=[Math.fround(a.point[0]+(b.point[0]-a.point[0])*u),Math.fround(a.point[1]+(b.point[1]-a.point[1])*u)],y=Math.fround(hermite(a,b,u,widthAt(i)));row.push({p,y});if(j){const prev=row[j-1],slope=Math.abs(y-prev.y)/Math.max(distance(p,prev.p),epsilon);maxCrossSlope=Math.max(maxCrossSlope,slope);}}grid.push(row);}
 if(maxCrossSlope>limits.maxCrossSlope+epsilon)conflicts.push({kind:'cross-slope-exceeded',measured:maxCrossSlope,limit:limits.maxCrossSlope});
 const protectedArea=Math.abs(area(clipConvexPolygon(protectedOutline,[[...src[0].point],[...src.at(-1).point],[...dst.at(-1).point],[...dst[0].point]],{epsilon})))||0;
 if(protectedArea>epsilon*epsilon)conflicts.push({kind:'interface-enters-protected-region',measuredArea:protectedArea});
 const zoneArea=Math.abs(area(clipConvexPolygon(zoneOutline,[[...src[0].point],[...src.at(-1).point],[...dst.at(-1).point],[...dst[0].point]],{epsilon})))||0;
 if(zoneArea>epsilon*epsilon)conflicts.push({kind:'interface-enters-target-core',measuredArea:zoneArea});
 const panels=[],constraints=[];if(!conflicts.length){for(let i=0;i<stations.length-1;i++)for(let j=0;j<transverseSegments;j++){
  let q=convexQuad([grid[i][j].p,grid[i+1][j].p,grid[i+1][j+1].p,grid[i][j+1].p],`${id}.cell[${i},${j}]`);
  // Preserve the correspondence order: reversal indicates a folded strip.
  if(area(q)<=0)throw new Error(`${id}.cell[${i},${j}] winding is reversed`);
  const points=[grid[i][j],grid[i+1][j],grid[i+1][j+1],grid[i][j+1]];panels.push(Object.freeze({outline:Object.freeze(q.map(p=>Object.freeze(p))),points:Object.freeze(points)}));constraints.push(q);
 }}
 for(let i=0;i<panels.length;i++)for(let j=i+1;j<panels.length;j++){
  const overlap=clipConvexPolygon(panels[i].outline,panels[j].outline,{epsilon});if(Math.abs(area(overlap))>epsilon*epsilon)conflicts.push({kind:'interface-cells-overlap',cells:[i,j],area:Math.abs(area(overlap))});
 }
 const diagnostics=Object.freeze({status:conflicts.length?'UNSAT':'ACCEPTED',id,sourceRevision:source.revision,targetRevision:target.revision,stationCount:stations.length,transverseSegments,cellCount:conflicts.length?cellCount:panels.length,profileError,maxCrossSlope,conflicts:Object.freeze(conflicts.map(c=>Object.freeze(c)))});
 function heightAt({x,z,baseHeight}){
  if(![x,z,baseHeight].every(finite))throw new TypeError('interface height samples require finite x, z and baseHeight');if(conflicts.length)throw new Error('cannot sample an UNSAT terrain interface plan');
  const p=[x,z];if(inside(p,protectedOutline,epsilon))return baseHeight;if(inside(p,zoneOutline,epsilon))return Math.fround(target.zone.targetHeight);for(const panel of panels){if(!inside(p,panel.outline,epsilon))continue;const [a,b,c,d]=panel.points;let weights=bary(p,a.p,b.p,c.p);if(weights&&weights.every(v=>v>=-epsilon))return weights[0]*a.y+weights[1]*b.y+weights[2]*c.y;weights=bary(p,a.p,c.p,d.p);if(weights&&weights.every(v=>v>=-epsilon))return weights[0]*a.y+weights[1]*c.y+weights[2]*d.y;}
  return baseHeight;
 }
 return Object.freeze({diagnostics,constraints:Object.freeze([Object.freeze(zoneOutline.map(p=>Object.freeze(p))),...constraints.map(q=>Object.freeze(q.map(p=>Object.freeze(p))))]),protectedRegions:Object.freeze([Object.freeze(protectedOutline.map(p=>Object.freeze(p)))]),heightAt,dispose(){}});
}
import {clipConvexPolygon} from '../geometry/bounded-profile.mjs';
