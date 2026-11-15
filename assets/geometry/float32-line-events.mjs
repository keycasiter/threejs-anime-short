const finite=Number.isFinite;
const SCALE=1n<<149n;
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const polygonArea=ring=>ring.length<3?0:ring.slice(1,-1).reduce((sum,p,i)=>sum+cross(ring[0],p,ring[i+2]),0)/2;

function float32Integer(value){
 if(!finite(value))throw new TypeError('line endpoints must be finite Float32 values');
 const view=new DataView(new ArrayBuffer(4));view.setFloat32(0,value,false);
 const bits=view.getUint32(0,false),sign=bits>>>31?-1n:1n,exponent=(bits>>>23)&255,mantissa=bits&0x7fffff;
 if(exponent===255)throw new TypeError('line endpoints must be finite Float32 values');
 if(exponent===0)return sign*BigInt(mantissa);
 return sign*BigInt(0x800000|mantissa)<<BigInt(exponent-1);
}
const trianglePredicateCache=new WeakMap();
function exactOrientSign(a,b,c){const value=(b.ix-a.ix)*(c.iz-a.iz)-(b.iz-a.iz)*(c.ix-a.ix);return value<0n?-1:value>0n?1:0;}
function orientSign(a,b,c){const abx=b.x-a.x,abz=b.z-a.z,acx=c.x-a.x,acz=c.z-a.z,left=abx*acz,right=abz*acx,det=left-right,error=(Math.abs(left)+Math.abs(right))*Number.EPSILON*8;if(Math.abs(det)>error)return det<0?-1:1;return exactOrientSign(a,b,c);}
function prepareFloat32Triangle(triangle,name){
 if(!Array.isArray(triangle)||triangle.length!==3||triangle.some(p=>!Array.isArray(p)||p.length!==2))throw new TypeError(`${name} must contain three Float32 [x,z] points`);
 let prepared=trianglePredicateCache.get(triangle);if(prepared&&prepared.points.every((p,i)=>p.x===triangle[i][0]&&p.z===triangle[i][1]))return prepared;
 const points=triangle.map(([x,z])=>{if(!finite(x)||Math.fround(x)!==x||!finite(z)||Math.fround(z)!==z)throw new TypeError('triangle predicate requires Float32-represented coordinates');return {x,z,ix:float32Integer(x),iz:float32Integer(z)};}),orientation=exactOrientSign(points[0],points[1],points[2]);if(!orientation)throw new Error(`${name} is degenerate at Float32 precision`);
 prepared={points,orientation,key:points.map(p=>`${p.x},${p.z}`).sort().join('|'),centroidX:points[0].ix+points[1].ix+points[2].ix,centroidZ:points[0].iz+points[1].iz+points[2].iz};trianglePredicateCache.set(triangle,prepared);return prepared;
}
function strictContains(container,point){for(let i=0;i<3;i++){const side=orientSign(container.points[i],container.points[(i+1)%3],point);if(side===0||side!==container.orientation)return false;}return true;}
function centroidStrictlyInside(container,pointTriangle){return container.points.every((a,i)=>{const b=container.points[(i+1)%3],side=(b.ix-a.ix)*(pointTriangle.centroidZ-3n*a.iz)-(b.iz-a.iz)*(pointTriangle.centroidX-3n*a.ix);return side!==0n&&(side<0n?-1:1)===container.orientation;});}
/** Exact positive-area overlap predicate for triangles whose vertices are final Float32 values. */
export function float32TriangleInteriorsOverlap(a,b){
 const A=prepareFloat32Triangle(a,'triangle A'),B=prepareFloat32Triangle(b,'triangle B');if(A.key===B.key)return true;
 if(A.points.some(point=>strictContains(B,point))||B.points.some(point=>strictContains(A,point)))return true;
 if(centroidStrictlyInside(A,B)||centroidStrictlyInside(B,A))return true;
 for(let i=0;i<3;i++)for(let j=0;j<3;j++){const a0=A.points[i],a1=A.points[(i+1)%3],b0=B.points[j],b1=B.points[(j+1)%3],s0=orientSign(a0,a1,b0),s1=orientSign(a0,a1,b1),t0=orientSign(b0,b1,a0),t1=orientSign(b0,b1,a1);if(s0*s1<0&&t0*t1<0)return true;}
 return false;
}
function gcd(a,b){a=a<0n?-a:a;b=b<0n?-b:b;while(b){const r=a%b;a=b;b=r;}return a;}

/** Exact line events for planar geometry whose inputs are represented as Float32.
 * Line equations are reduced integer triples, so reversed or differently-sized
 * collinear segments share an identity. Intersections are solved once per pair. */
export function createFloat32LineEventTable({maxLines=100000,maxEvents=1000000}={}){
 if(!Number.isSafeInteger(maxLines)||maxLines<1||maxLines>1000000)throw new Error('maxLines must be in 1..1000000');
 if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>8000000)throw new Error('maxEvents must be in 1..8000000');
 const lines=new Map(),events=new Map();let eventCount=0;
 function add(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==2||b.length!==2)throw new TypeError('line segments require two [x,z] endpoints');
  const ax=float32Integer(a[0]),az=float32Integer(a[1]),bx=float32Integer(b[0]),bz=float32Integer(b[1]);
  let A=(az-bz)*SCALE,B=(bx-ax)*SCALE,C=ax*bz-bx*az;
  if(A===0n&&B===0n)throw new Error('line segment collapses at Float32 precision');
  const divisor=gcd(gcd(A,B),C);A/=divisor;B/=divisor;C/=divisor;
  if(A<0n||A===0n&&B<0n){A=-A;B=-B;C=-C;}
  const key=`${A},${B},${C}`;let line=lines.get(key);
  if(!line){if(lines.size>=maxLines)throw new Error(`Float32 line event maxLines exceeded (${lines.size+1} > ${maxLines})`);line={key,A,B,C};lines.set(key,line);}
  return line;
 }
 function intersect(first,second){
  if(!first||!second||typeof first.key!=='string'||typeof second.key!=='string')throw new TypeError('intersections require lines returned by add');
  if(first===second||first.key===second.key)return null;
  const key=first.key<second.key?`${first.key}|${second.key}`:`${second.key}|${first.key}`;
  if(events.has(key))return events.get(key);
  const det=first.A*second.B-second.A*first.B;if(det===0n)return null;
  if(eventCount>=maxEvents)throw new Error(`Float32 line event maxEvents exceeded (${eventCount+1} > ${maxEvents})`);
  const xNum=first.B*second.C-second.B*first.C,zNum=first.C*second.A-second.C*first.A;
  const x=Number(xNum)/Number(det),z=Number(zNum)/Number(det),point=Object.freeze([x===0?0:x,z===0?0:z]);
  if(!point.every(finite))throw new Error('line intersection exceeds Float32 terrain coordinate range');
  eventCount++;events.set(key,point);return point;
 }
 function onSegment(point,line,first,second){
  const x=float32Integer(point[0]),z=float32Integer(point[1]),value=line.A*x+line.B*z+line.C*SCALE;
  if(value!==0n)return false;
  const p=[Math.fround(point[0]),Math.fround(point[1])],a=first.map(Math.fround),b=second.map(Math.fround);
  return p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
 }
 return Object.freeze({add,intersect,onSegment,get stats(){return Object.freeze({lineCount:lines.size,eventCount});}});
}

/** Convex intersection for Float32-authored polygons. The returned vertex ring
 * is accompanied internally by outgoing support-line IDs during every clip
 * pass. The incoming line is stored per emitted vertex; closing a duplicate
 * endpoint transfers the last incoming line onto the canonical first vertex. */
export function clipConvexPolygonWithFloat32Events(subject,boundary,table){
 if(!Array.isArray(subject)||!Array.isArray(boundary)||subject.length<3||boundary.length<3)throw new TypeError('clipping requires two polygons with at least three vertices');
 if(typeof table?.add!=='function'||typeof table?.intersect!=='function')throw new TypeError('clipping requires a Float32 line event table');
 const prepare=(input,name)=>{
  if(input.some(p=>!Array.isArray(p)||p.length!==2||!p.every(finite)))throw new TypeError(`${name} vertices must be finite [x,z] pairs`);
  const points=input.map(p=>[Math.fround(p[0]),Math.fround(p[1])]);
  if(points.some(p=>!p.every(finite))||Math.abs(polygonArea(points))===0)throw new Error(`${name} collapses at Float32 precision`);
  if(polygonArea(points)<0)points.reverse();
  const incoming=points.map((p,i)=>table.add(points[(i+points.length-1)%points.length],p));
  return {points,edgeLines:incoming.map((_,i)=>incoming[(i+1)%incoming.length])};
 };
 const clean=(points,incoming)=>{
  const p=[],lines=[];
  for(let i=0;i<points.length;i++){if(p.length&&p.at(-1)[0]===points[i][0]&&p.at(-1)[1]===points[i][1])continue;p.push(points[i]);lines.push(incoming[i]);}
  if(p.length>1&&p[0][0]===p.at(-1)[0]&&p[0][1]===p.at(-1)[1]){p.pop();lines[0]=lines.at(-1);lines.pop();}
  if(p.length<3||Math.abs(polygonArea(p))===0)return null;
  return {points:p,edgeLines:lines.map((_,i)=>lines[(i+1)%lines.length])};
 };
 let polygon=prepare(subject,'subject');const clip=prepare(boundary,'boundary');
 for(let i=0;i<clip.points.length&&polygon;i++){
  const a=clip.points[i],b=clip.points[(i+1)%clip.points.length],clipLine=clip.edgeLines[i],points=[],incoming=[];
  const add=(point,line)=>{if(points.length&&points.at(-1)[0]===point[0]&&points.at(-1)[1]===point[1])return;points.push(point);incoming.push(line);};
  for(let j=0;j<polygon.points.length;j++){
   const prev=polygon.points[(j+polygon.points.length-1)%polygon.points.length],cur=polygon.points[j],subjectLine=polygon.edgeLines[(j+polygon.points.length-1)%polygon.points.length],dp=subjectLine.key===clipLine.key?0:cross(a,b,prev),dc=subjectLine.key===clipLine.key?0:cross(a,b,cur),prevInside=dp>=0,curInside=dc>=0;
   if(prevInside!==curInside){const event=table.intersect(subjectLine,clipLine);if(!event)throw new Error('parallel supports disagree on Float32 clipping classification');add(event,prevInside?subjectLine:clipLine);}
   if(curInside)add(cur,subjectLine);
  }
  polygon=clean(points,incoming);
 }
 return polygon?.points??[];
}

/** Node existing Float32 ring vertices onto collinear ring edges, cancel exact
 * reverse sub-edges, and rebuild the resulting directed cycle(s). This removes
 * quantization-created zero-area backtracks without snapping or dropping area. */
export function nodeAndCancelFloat32Ring(input,table){
 if(!Array.isArray(input)||input.length<3||input.length>1024)throw new TypeError('ring requires 3..1024 vertices');
 if(typeof table?.add!=='function'||typeof table?.onSegment!=='function')throw new TypeError('ring noding requires a Float32 line event table');
 const ring=input.map(p=>{if(!Array.isArray(p)||p.length!==2||!p.every(finite))throw new TypeError('ring vertices must be finite [x,z] pairs');return [Math.fround(p[0]),Math.fround(p[1])];}),sourceArea=Math.abs(polygonArea(ring));
 const key=p=>`${p[0]},${p[1]}`,segments=new Map();
 for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length];if(key(a)===key(b))continue;
  const line=table.add(a,b),dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz,cuts=ring.filter(p=>table.onSegment(p,line,a,b)).map(p=>({p,t:((p[0]-a[0])*dx+(p[1]-a[1])*dz)/den})).sort((x,y)=>x.t-y.t);
  for(let j=0;j<cuts.length-1;j++){
   const p=cuts[j].p,q=cuts[j+1].p,pk=key(p),qk=key(q);if(pk===qk)continue;
   const forward=`${pk}>${qk}`,reverse=`${qk}>${pk}`,opposite=segments.get(reverse);
   if(opposite?.length){opposite.pop();if(!opposite.length)segments.delete(reverse);}
   else{const list=segments.get(forward)??[];list.push({a:p,b:q,ak:pk,bk:qk});segments.set(forward,list);}
  }
 }
 const edges=[...segments.values()].flat();if(!edges.length)return [];
 const outgoing=new Map(),incoming=new Map();
 for(const edge of edges){if(outgoing.has(edge.ak)||incoming.has(edge.bk))throw new Error('Float32 ring noding produced a branched boundary');outgoing.set(edge.ak,edge);incoming.set(edge.bk,edge);}
 for(const id of new Set([...outgoing.keys(),...incoming.keys()]))if(!outgoing.has(id)||!incoming.has(id))throw new Error('Float32 ring noding produced an unclosed boundary');
 const unused=new Set(edges),cycles=[];
 while(unused.size){const first=unused.values().next().value,cycle=[first.a];let edge=first,guard=0;while(true){if(!unused.delete(edge))throw new Error('Float32 ring noding revisited a directed edge');if(edge.bk===first.ak)break;cycle.push(edge.b);edge=outgoing.get(edge.bk);if(!edge||++guard>edges.length)throw new Error('Float32 ring noding failed to close a cycle');}if(cycle.length>=3&&polygonArea(cycle)!==0)cycles.push(polygonArea(cycle)>0?cycle:cycle.reverse());}
 const outputArea=cycles.reduce((sum,cycle)=>sum+Math.abs(polygonArea(cycle)),0),areaError=Math.abs(outputArea-sourceArea),areaBound=Number.EPSILON*Math.max(1,sourceArea)*ring.length*32;
 if(areaError>areaBound)throw new Error(`Float32 ring noding changed area by ${areaError} (bound ${areaBound})`);
 return cycles;
}

/** Add every represented vertex that lies on another ring's represented edge.
 * This makes adjacent clipped cells share identical subdivisions before their
 * triangles are assembled, without moving any vertex or changing ring area. */
export function nodeFloat32Rings(inputRings,table){
 if(!Array.isArray(inputRings)||inputRings.length>100000)throw new TypeError('rings must be an array within the finite ring budget');
 if(typeof table?.add!=='function'||typeof table?.onSegment!=='function')throw new TypeError('ring noding requires a Float32 line event table');
 const rings=inputRings.map((ring,index)=>{
  if(!Array.isArray(ring)||ring.length<3||ring.length>1024)throw new TypeError(`rings[${index}] requires 3..1024 vertices`);
  const points=ring.map(p=>{if(!Array.isArray(p)||p.length!==2||!p.every(finite))throw new TypeError(`rings[${index}] vertices must be finite [x,z] pairs`);return [Math.fround(p[0]),Math.fround(p[1])];});
  if(points.some(p=>!p.every(finite))||polygonArea(points)===0)throw new Error(`rings[${index}] collapses at Float32 precision`);
  return points;
 }),supports=new Map();
 for(const ring of rings)for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length],line=table.add(a,b),group=supports.get(line.key)??{line,points:new Map()};
  group.points.set(`${a[0]},${a[1]}`,a);group.points.set(`${b[0]},${b[1]}`,b);supports.set(line.key,group);
 }
 return rings.map((ring,index)=>{
  const output=[];
  for(let i=0;i<ring.length;i++){
   const a=ring[i],b=ring[(i+1)%ring.length],line=table.add(a,b),dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz;
   const cuts=[...supports.get(line.key).points.values()].filter(p=>table.onSegment(p,line,a,b)).map(p=>({p,t:((p[0]-a[0])*dx+(p[1]-a[1])*dz)/den})).sort((x,y)=>x.t-y.t);
   for(const cut of cuts.slice(0,-1))if(!output.length||output.at(-1)[0]!==cut.p[0]||output.at(-1)[1]!==cut.p[1])output.push(cut.p);
  }
  const sourceArea=Math.abs(polygonArea(ring)),resultArea=Math.abs(polygonArea(output)),bound=Number.EPSILON*Math.max(1,sourceArea)*output.length*32;
  if(Math.abs(sourceArea-resultArea)>bound)throw new Error(`rings[${index}] edge noding changed area`);
  return output;
 });
}

/** Insert exact shared-support vertices into every incident ring before those
 * vertices are independently rounded to Float32. `edgeLines[i]` is the support
 * identity for the outgoing edge points[i] -> points[i + 1]. */
export function nodeTaggedFloat32Rings(inputRings,{maxWorkUnits=1_000_000,onWork}={}){
 if(!Array.isArray(inputRings)||inputRings.length>100_000)throw new TypeError('rings must be an array within the finite ring budget');
 if(!Number.isSafeInteger(maxWorkUnits)||maxWorkUnits<1||maxWorkUnits>8_000_000)throw new Error('maxWorkUnits must be an integer in 1..8000000');
 if(onWork!==undefined&&typeof onWork!=='function')throw new TypeError('onWork must be a function when supplied');
 let work=0;const spend=()=>{if(++work>maxWorkUnits)throw new Error(`maxWorkUnits exceeded while noding tagged rings (${work} > ${maxWorkUnits})`);onWork?.();};
 const rings=inputRings.map((ring,index)=>{
  if(!ring||!Array.isArray(ring.points)||ring.points.length<3||ring.points.length>1024||!Array.isArray(ring.edgeLines)||ring.edgeLines.length!==ring.points.length)throw new TypeError(`rings[${index}] requires 3..1024 points and one outgoing edge line per point`);
  const points=ring.points.map((point,j)=>{if(!Array.isArray(point)||point.length!==2||!point.every(finite))throw new TypeError(`rings[${index}].points[${j}] must be finite [x,z]`);return [...point];});
  for(let i=0;i<ring.edgeLines.length;i++)if(typeof ring.edgeLines[i]?.key!=='string')throw new TypeError(`rings[${index}].edgeLines[${i}] must have a stable support key`);
  return {points,edgeLines:[...ring.edgeLines]};
 }),verticesBySupport=new Map();
 for(const ring of rings)for(let i=0;i<ring.points.length;i++){
  const point=ring.points[i],incoming=ring.edgeLines[(i+ring.points.length-1)%ring.points.length],outgoing=ring.edgeLines[i];
  for(const line of new Set([incoming,outgoing])){spend();const group=verticesBySupport.get(line.key)??new Map();group.set(`${point[0]},${point[1]}`,point);verticesBySupport.set(line.key,group);}
 }
 return rings.map((ring,index)=>{
  const output=[],edgeLines=[];
  for(let i=0;i<ring.points.length;i++){
   const a=ring.points[i],b=ring.points[(i+1)%ring.points.length],line=ring.edgeLines[i],dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
   if(!(length2>0))throw new Error(`rings[${index}] has a collapsed source edge`);
   output.push(a);const candidates=[];
   for(const point of verticesBySupport.get(line.key).values()){
    spend();if(point[0]===a[0]&&point[1]===a[1]||point[0]===b[0]&&point[1]===b[1])continue;
    const t=((point[0]-a[0])*dx+(point[1]-a[1])*dz)/length2;if(!(t>0&&t<1))continue;
    const scale=Math.max(1,Math.abs(a[0]),Math.abs(a[1]),Math.abs(b[0]),Math.abs(b[1]),Math.abs(point[0]),Math.abs(point[1])),crossError=Math.abs(dx*(point[1]-a[1])-dz*(point[0]-a[0]));
    if(crossError>Number.EPSILON*scale*Math.sqrt(length2)*32)throw new Error(`rings[${index}] vertex provenance disagrees with shared support ${line.key}`);
    candidates.push({point,t});
   }
   candidates.sort((x,y)=>x.t-y.t||x.point[0]-y.point[0]||x.point[1]-y.point[1]);
   let previous=a;
   for(const candidate of candidates){const point=candidate.point;if(point[0]===previous[0]&&point[1]===previous[1])continue;output.push(point);edgeLines.push(line);previous=point;}
   edgeLines.push(line);
  }
  const before=polygonArea(ring.points),after=polygonArea(output),bound=Number.EPSILON*Math.max(1,Math.abs(before))*output.length*64;
  if(Math.abs(before-after)>bound)throw new Error(`rings[${index}] shared-support noding changed area by ${after-before}`);
  return {points:output,edgeLines};
 });
}
