const finite=Number.isFinite;
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
function signedArea(points){
 const origin=points[0];let twice=0;
 for(let i=1;i<points.length-1;i++)twice+=orient(origin,points[i],points[i+1]);
 return twice/2;
}
function onSegment(p,a,b){return orient(a,b,p)===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);}
function intersects(a,b,c,d){
 const abC=orient(a,b,c),abD=orient(a,b,d),cdA=orient(c,d,a),cdB=orient(c,d,b);
 if((abC>0&&abD<0||abC<0&&abD>0)&&(cdA>0&&cdB<0||cdA<0&&cdB>0))return true;
 return abC===0&&onSegment(c,a,b)||abD===0&&onSegment(d,a,b)||cdA===0&&onSegment(a,c,d)||cdB===0&&onSegment(b,c,d);
}
function pointInTriangle(p,a,b,c,winding){
 return winding*orient(a,b,p)>=0&&winding*orient(b,c,p)>=0&&winding*orient(c,a,p)>=0;
}
function diagonalClear(points,ring,prev,next,spend){
 const a=points[prev],b=points[next];
 for(let i=0;i<ring.length;i++){
  spend();const u=ring[i],v=ring[(i+1)%ring.length];
  if(u===prev||u===next||v===prev||v===next)continue;
  if(intersects(a,b,points[u],points[v]))return false;
 }
 return true;
}

/**
 * Triangulate a simple 2D polygon using the positions that Float32 will store.
 * Input boundary vertices are retained (including collinear subdivision points)
 * so adjacent constrained faces can share the same edge segmentation.
 *
 * The deterministic ear search is bounded by maxWorkUnits. It rejects a ring
 * whose represented Float32 boundary is collapsed, repeated, self-crossing,
 * or too numerically ambiguous to triangulate; it never snaps points together.
 */
export function triangulateFloat32Ring(input,{maxWorkUnits=1_000_000,onWork,assumeConvexInput=false}={}){
 if(!Array.isArray(input)||input.length<3||input.length>1024)throw new Error('Float32 ring requires 3..1024 vertices');
 if(!Number.isSafeInteger(maxWorkUnits)||maxWorkUnits<1||maxWorkUnits>8_000_000)throw new Error('maxWorkUnits must be an integer in 1..8000000');
 if(onWork!==undefined&&typeof onWork!=='function')throw new TypeError('onWork must be a function when supplied');
 if(typeof assumeConvexInput!=='boolean')throw new TypeError('assumeConvexInput must be a boolean');
 const points=[];
 for(let i=0;i<input.length;i++){
  const p=input[i];if(!Array.isArray(p)||p.length!==2)throw new Error(`ring[${i}] must be an [x,y] pair`);
  const x=Math.fround(p[0]),y=Math.fround(p[1]);if(!finite(x)||!finite(y))throw new Error(`ring[${i}] exceeds finite Float32 coordinates`);
  if(points.length&&same(points.at(-1),[x,y]))throw new Error(`Float32 ring has a collapsed edge at vertex ${i}`);
  points.push([x,y]);
 }
 if(same(points[0],points.at(-1)))throw new Error('Float32 ring repeats its closing vertex');
 const unique=new Set(points.map(p=>`${p[0]},${p[1]}`));if(unique.size!==points.length)throw new Error('Float32 ring has duplicate vertices');
 let work=0;const spend=()=>{if(++work>maxWorkUnits)throw new Error(`maxWorkUnits exceeded while triangulating Float32 ring (${work} > ${maxWorkUnits})`);onWork?.();};
 const ringArea=signedArea(points),winding=Math.sign(ringArea);
 if(!finite(ringArea)||winding===0)throw new Error('Float32 ring has zero or nonfinite area');
 const finish=triangles=>{const triangleArea=triangles.reduce((sum,[a,b,c])=>sum+orient(points[a],points[b],points[c])/2,0),areaTolerance=Math.max(1e-12,Math.abs(ringArea)*1e-12);if(Math.abs(triangleArea-ringArea)>areaTolerance)throw new Error(`Float32 triangulation failed signed-area conservation: ring ${ringArea}, triangles ${triangleArea}, tolerance ${areaTolerance}`);return Object.freeze({points:Object.freeze(points.map(p=>Object.freeze(p))),triangles:Object.freeze(triangles.map(t=>Object.freeze(t))),area:ringArea,workUnits:work});};
 let convex=true;for(let i=0;i<points.length;i++){spend();if(winding*orient(points[i],points[(i+1)%points.length],points[(i+2)%points.length])<0){convex=false;break;}}
 if(!assumeConvexInput||!convex)for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
  spend();if(j===i+1||i===0&&j===points.length-1)continue;
  if(intersects(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length]))throw new Error(`Float32 ring is not simple: edges ${i}/${j} intersect`);
 }
 if(convex){let anchor=-1,bestScore=-Infinity;for(let i=0;i<points.length;i++){let score=Infinity;for(let j=1;j<points.length-1;j++){spend();score=Math.min(score,winding*orient(points[i],points[(i+j)%points.length],points[(i+j+1)%points.length]));}if(score>bestScore){bestScore=score;anchor=i;}}if(bestScore>0){const triangles=[];for(let j=1;j<points.length-1;j++)triangles.push([anchor,(anchor+j)%points.length,(anchor+j+1)%points.length]);return finish(triangles);}}
 const ring=points.map((_,i)=>i),triangles=[];
 while(ring.length>3){
  let selected=-1,selectedQuality=-Infinity;
  for(let i=0;i<ring.length;i++){
   spend();const prev=ring[(i+ring.length-1)%ring.length],current=ring[i],next=ring[(i+1)%ring.length],a=points[prev],b=points[current],c=points[next],turn=winding*orient(a,b,c);
   if(!(turn>0)||!diagonalClear(points,ring,prev,next,spend))continue;
   let contains=false;
   for(const candidate of ring){
    spend();if(candidate===prev||candidate===current||candidate===next)continue;
    if(pointInTriangle(points[candidate],a,b,c,winding)){contains=true;break;}
   }
   if(contains)continue;
   const ab=(a[0]-b[0])**2+(a[1]-b[1])**2,bc=(b[0]-c[0])**2+(b[1]-c[1])**2,ca=(c[0]-a[0])**2+(c[1]-a[1])**2,quality=turn/(ab+bc+ca);
   if(quality>selectedQuality){selected=i;selectedQuality=quality;}
  }
  if(selected<0)throw new Error('Float32 ring has no provably simple positive-area ear');
  const prev=ring[(selected+ring.length-1)%ring.length],current=ring[selected],next=ring[(selected+1)%ring.length];
  triangles.push([prev,current,next]);ring.splice(selected,1);
 }
 const last=ring.map(i=>points[i]),lastArea=winding*orient(last[0],last[1],last[2]);
 if(!(lastArea>0))throw new Error('Float32 ring leaves a collapsed final triangle');
 triangles.push([...ring]);
 return finish(triangles);
}
