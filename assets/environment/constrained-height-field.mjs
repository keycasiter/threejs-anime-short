import {clipConvexPolygon} from '../geometry/bounded-profile.mjs';

/** Reserve one axis-aligned rectangular plateau in a differentiable height field.
 * The quintic transition follows Euclidean distance outside the rectangle; its
 * analytic derivatives feed both normals and placement. This is a height field,
 * not an overhang/cave solver. The supplied field remains a borrowed live source.
 */
export function createPlateauHeightField({field,bounds,height=0,falloff=10}={}) {
  if(typeof field?.sample!=='function')throw new TypeError('field.sample(x,z) is required');
  if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[2]<=bounds[0]||bounds[3]<=bounds[1])throw new TypeError('bounds must be [minX,minZ,maxX,maxZ] with positive extents');
  if(!Number.isFinite(height)||!Number.isFinite(falloff)||falloff<=0)throw new TypeError('height must be finite and falloff positive');
  const box=[...bounds],config=Object.freeze({bounds:Object.freeze([...box]),height,falloff});
  function sample(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z))throw new TypeError('sample coordinates must be finite');
    const dx=x<box[0]?x-box[0]:x>box[2]?x-box[2]:0,dz=z<box[1]?z-box[1]:z>box[3]?z-box[3]:0;
    const distance=Math.hypot(dx,dz);
    if(distance===0)return {height,dx:0,dz:0};
    const base=field.sample(x,z);
    if(!base||![base.height,base.dx,base.dz].every(Number.isFinite))throw new TypeError('source sample must contain finite height/dx/dz');
    if(distance>=falloff)return {height:base.height,dx:base.dx,dz:base.dz};
    const t=distance/falloff,w=t*t*t*(t*(t*6-15)+10),dw=30*t*t*(t-1)*(t-1)/falloff;
    return {height:height+(base.height-height)*w,dx:base.dx*w+(base.height-height)*dw*dx/distance,dz:base.dz*w+(base.height-height)*dw*dz/distance};
  }
  return Object.freeze({config,sample,heightAt:(x,z)=>sample(x,z).height,normalAt:(x,z)=>{
    const p=sample(x,z),length=Math.hypot(p.dx,1,p.dz);return [p.dx===0?0:-p.dx/length,1/length,p.dz===0?0:-p.dz/length];
  }});
}

const finite=Number.isFinite;
const smooth=t=>{const x=Math.max(0,Math.min(1,t));return x*x*x*(x*(x*6-15)+10);};
const orient=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const area=ring=>{let sum=0;for(let i=1;i<ring.length-1;i++)sum+=orient(ring[0],ring[i],ring[i+1]);return sum/2;};
function normalizedRing(input,name,epsilon){
 if(!Array.isArray(input)||input.length<3||input.length>256)throw new TypeError(`${name} requires 3..256 convex [x,z] vertices`);
 const ring=input.map((p,i)=>{if(!Array.isArray(p)||p.length!==2||!p.every(v=>finite(v)&&Math.abs(v)<=100000))throw new TypeError(`${name}[${i}] must be finite [x,z] within ±100000`);return [Math.fround(p[0]),Math.fround(p[1])];});
 for(let i=0;i<ring.length;i++)for(let j=i+1;j<ring.length;j++)if(Math.hypot(ring[i][0]-ring[j][0],ring[i][1]-ring[j][1])<=epsilon)throw new Error(`${name} has duplicate or Float32-collapsed vertices`);
 if(Math.abs(area(ring))<=epsilon*epsilon)throw new Error(`${name} has zero area at Float32 precision`);
 if(area(ring)<0)ring.reverse();
 for(let i=0;i<ring.length;i++)for(const p of ring)if(orient(ring[i],ring[(i+1)%ring.length],p)<-epsilon*Math.hypot(ring[(i+1)%ring.length][0]-ring[i][0],ring[(i+1)%ring.length][1]-ring[i][1]))throw new Error(`${name} must be convex and simple`);
 return ring;
}
function signedDistance(point,ring){
 let inside=true,minimum=Infinity,distance=Infinity;
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),side=orient(a,b,point)/len;
  minimum=Math.min(minimum,side);if(side<0)inside=false;
  const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(len*len)));
  distance=Math.min(distance,Math.hypot(point[0]-(a[0]+t*dx),point[1]-(a[1]+t*dz)));
 }
 return inside?minimum:-distance;
}
function pointSegmentDistance(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);}
function segmentsIntersect(a,b,c,d,epsilon){
 const ab1=orient(a,b,c),ab2=orient(a,b,d),cd1=orient(c,d,a),cd2=orient(c,d,b);
 if(ab1*ab2<0&&cd1*cd2<0)return true;
 const on=(p,x,y)=>Math.abs(orient(x,y,p))<=epsilon*Math.hypot(y[0]-x[0],y[1]-x[1])&&p[0]>=Math.min(x[0],y[0])-epsilon&&p[0]<=Math.max(x[0],y[0])+epsilon&&p[1]>=Math.min(x[1],y[1])-epsilon&&p[1]<=Math.max(x[1],y[1])+epsilon;
 return on(c,a,b)||on(d,a,b)||on(a,c,d)||on(b,c,d);
}
function polygonDistance(a,b,epsilon){
 if(clipConvexPolygon(a,b,{epsilon}).length)return 0;
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(segmentsIntersect(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length],epsilon))return 0;
 let d=Infinity;
 for(const p of a)for(let j=0;j<b.length;j++)d=Math.min(d,pointSegmentDistance(p,b[j],b[(j+1)%b.length]));
 for(const p of b)for(let j=0;j<a.length;j++)d=Math.min(d,pointSegmentDistance(p,a[j],a[(j+1)%a.length]));
 return d;
}

/**
 * Compile multiple convex, levelled terrain zones into one bounded piecewise
 * height callback. Different target levels may not have overlapping transition
 * envelopes; rejecting that ambiguity keeps every hard pad and its boundary
 * continuous. Protected regions and their fade margins suppress grading.
 * Returned rings can be passed to createConstrainedTerrainGeometry so the hard
 * pad/protection boundaries are represented by actual mesh edges.
 */
export function compileTerrainGradeField({zones=[],protectedRegions=[],epsilon=1e-7,maxZones=128,maxProtectedRegions=128}={}){
 if(!Array.isArray(zones)||zones.length>maxZones)throw new TypeError(`zones must be an array with at most ${maxZones} entries`);
 if(!Array.isArray(protectedRegions)||protectedRegions.length>maxProtectedRegions)throw new TypeError(`protectedRegions must be an array with at most ${maxProtectedRegions} entries`);
 if(!Number.isSafeInteger(maxZones)||maxZones<1||maxZones>128||!Number.isSafeInteger(maxProtectedRegions)||maxProtectedRegions<1||maxProtectedRegions>128)throw new TypeError('maxZones and maxProtectedRegions must be integers in 1..128');
 if(!finite(epsilon)||epsilon<=0)throw new TypeError('epsilon must be positive and finite');
 const ids=new Set();
 const uniqueId=(id,name)=>{if(typeof id!=='string'||!id.trim()||ids.has(id))throw new Error(`${name} requires a unique non-empty id`);ids.add(id);return id;};
 const compiledZones=zones.map((zone,i)=>{
  if(!zone||typeof zone!=='object')throw new TypeError(`zones[${i}] must be an object`);
  const id=uniqueId(zone.id,`zones[${i}]`),outline=normalizedRing(zone.outline,`zones[${i}].outline`,epsilon);
  if(!finite(zone.targetHeight)||Math.abs(zone.targetHeight)>100000)throw new TypeError(`zones[${i}].targetHeight must be finite within ±100000`);
  if(!finite(zone.transitionWidth)||zone.transitionWidth<=0||zone.transitionWidth>100000)throw new TypeError(`zones[${i}].transitionWidth must be in (0,100000]`);
  return Object.freeze({id,outline:Object.freeze(outline.map(p=>Object.freeze(p))),targetHeight:Math.fround(zone.targetHeight),transitionWidth:zone.transitionWidth});
 });
 const compiledProtected=protectedRegions.map((region,i)=>{
  if(!region||typeof region!=='object')throw new TypeError(`protectedRegions[${i}] must be an object`);
  const id=uniqueId(region.id,`protectedRegions[${i}]`),outline=normalizedRing(region.outline,`protectedRegions[${i}].outline`,epsilon),transitionWidth=region.transitionWidth??0;
  if(!finite(transitionWidth)||transitionWidth<0||transitionWidth>100000)throw new TypeError(`protectedRegions[${i}].transitionWidth must be in [0,100000]`);
  return Object.freeze({id,outline:Object.freeze(outline.map(p=>Object.freeze(p))),transitionWidth});
 });
 const conflicts=[];
 for(let i=0;i<compiledZones.length;i++)for(let j=i+1;j<compiledZones.length;j++){
  const a=compiledZones[i],b=compiledZones[j],different=a.targetHeight!==b.targetHeight,distance=polygonDistance(a.outline,b.outline,epsilon);
  if(different&&distance<a.transitionWidth+b.transitionWidth-epsilon)conflicts.push({kind:'overlapping-grade-transitions',ids:[a.id,b.id],distance,requiredSeparation:a.transitionWidth+b.transitionWidth});
 }
 for(const zone of compiledZones)for(const region of compiledProtected){
  const distance=polygonDistance(zone.outline,region.outline,epsilon);
  if(distance<region.transitionWidth+epsilon)conflicts.push({kind:'grade-core-intersects-protected-envelope',ids:[zone.id,region.id],distance,requiredSeparation:region.transitionWidth});
  else if(region.transitionWidth===0&&distance<zone.transitionWidth+epsilon)conflicts.push({kind:'grade-transition-meets-unfaded-protected-region',ids:[zone.id,region.id],distance,requiredSeparation:zone.transitionWidth});
 }
 const diagnostics=Object.freeze({status:conflicts.length?'UNSAT':'ACCEPTED',zoneCount:compiledZones.length,protectedRegionCount:compiledProtected.length,conflicts:Object.freeze(conflicts.map(c=>Object.freeze({...c,ids:Object.freeze([...c.ids])})))});
 function heightAt({x,z,baseHeight}){
  if(![x,z,baseHeight].every(finite))throw new TypeError('grade samples require finite x, z and baseHeight');
  if(conflicts.length)throw new Error('cannot sample an UNSAT terrain grade plan');
  const p=[x,z];
  if(compiledProtected.some(region=>signedDistance(p,region.outline)>=0))return baseHeight;
  const cores=compiledZones.filter(zone=>signedDistance(p,zone.outline)>=0);
  if(cores.length)return cores[0].targetHeight; // Overlapping cores were required to agree.
  let complement=1,weighted=0,total=0;
  for(const zone of compiledZones){
   const signed=signedDistance(p,zone.outline);if(signed>=0)continue;
   const distance=-signed;if(distance>=zone.transitionWidth)continue;
   let weight=smooth(1-distance/zone.transitionWidth);
   for(const region of compiledProtected){
    if(region.transitionWidth===0)continue;
    const d=signedDistance(p,region.outline);if(d>=0){weight=0;break;}
    weight*=smooth(-d/region.transitionWidth);
   }
   if(weight<=0)continue;complement*=1-weight;weighted+=weight*zone.targetHeight;total+=weight;
  }
  if(total===0)return baseHeight;
  const strength=1-complement,target=weighted/total;
  return baseHeight+(target-baseHeight)*strength;
 }
 return Object.freeze({diagnostics,constraints:Object.freeze(compiledZones.map(z=>z.outline)),protectedRegions:Object.freeze(compiledProtected.map(r=>r.outline)),heightAt});
}
