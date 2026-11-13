// One bounded, rigid candidate. Geometry facts are measured upstream; this module
// checks those facts, never invents a surface or reads a rendering resource.
import { clipConvexPolygon } from '../geometry/bounded-profile.mjs';
import { rectanglesOverlap } from './corridor-layout.mjs';

const MIN=.015, CLEAR=.04, STEP=.008, TILT=.003, GRADE=.08;
const NUM=1e-11, CLIP=1e-13, MAX_CELLS=1000000;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const length=a=>Math.hypot(...a);
const distance=(a,b)=>length(sub(a,b));
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const area=r=>r.slice(1,-1).reduce((s,p,i)=>s+cross(sub(p,r[0]),sub(r[i+2],r[0])),0)/2;
const segments=r=>r.map((a,i)=>[a,r[(i+1)%r.length]]);
const edgeKey=(a,b)=>JSON.stringify([a,b].sort(cmp));
const bounds=r=>({x0:Math.min(...r.map(p=>p[0])),x1:Math.max(...r.map(p=>p[0])),z0:Math.min(...r.map(p=>p[1])),z1:Math.max(...r.map(p=>p[1]))});
const boxesMeet=(a,b)=>a.x1>=b.x0&&b.x1>=a.x0&&a.z1>=b.z0&&b.z1>=a.z0;
function invalid(message,range=false){const e=new (range?RangeError:TypeError)(`invalid-input: ${message}`);e.code='invalid-input';throw e;}
function object(x,name){if(!x||typeof x!=='object'||Array.isArray(x))invalid(`${name} object required`);return x;}
function plain(x,name){object(x,name);if(![Object.prototype,null].includes(Object.getPrototypeOf(x)))invalid(`${name} plain object required`);return x;}
function number(x,name,coordinate=true){if(!Number.isFinite(x)||coordinate&&Math.abs(x)>512)invalid(`${name} finite${coordinate?' within ±512':''} required`,true);return x;}
function id(x,name='id'){if(typeof x!=='string'||!x.length||x.length>128)invalid(`${name} string length 1..128 required`);return x;}
function array(x,name,min=0,max=Infinity,budget=null,owner){
 if(!Array.isArray(x)||x.length<min||x.length>max)invalid(`${name} array length ${min}..${max} required`,true);
 // Unbounded input must reserve its basic enumeration/allocation before even
 // scanning density or reading an element. Nested geometry is charged separately.
 if(budget)budget.take(x.length,owner);
 else if(max===Infinity)throw new Error('internal unbudgeted array');
 for(let i=0;i<x.length;i++)if(!Object.hasOwn(x,i))invalid(`${name} sparse array`);
 return x;
}
function point(x,n,name){array(x,name,n,n);return x.map(v=>number(v,name));}
function unique(xs,name){if(new Set(xs.map(x=>x.id)).size!==xs.length)invalid(`duplicate ${name} ID`);return xs.sort((a,b)=>cmp(a.id,b.id));}
function ids(xs,name,min=0){array(xs,name,min,128);const out=xs.map(x=>id(x,name)).sort(cmp);if(new Set(out).size!==out.length)invalid(`duplicate ${name}`);return out;}
function frozen(x){if(x&&typeof x==='object'){for(const v of Object.values(x))frozen(v);Object.freeze(x);}return x;}
function canonical(r){const p=r.map(v=>[...v]);if(area(p)<0)p.reverse();let k=0;for(let i=1;i<p.length;i++)if(p[i][0]<p[k][0]||p[i][0]===p[k][0]&&p[i][1]<p[k][1])k=i;return p.slice(k).concat(p.slice(0,k));}
function polygon(input,name,authored=false,budget,owner){
 const r=array(input,name,3,32,budget,owner).map(p=>point(p,2,name));
 for(let i=0;i<r.length;i++)for(let j=0;j<i;j++){
  budget.take(1,owner);
  if(distance(r[i],r[j])===0)invalid(`${name} duplicate vertices`,true);
 }
 let orientation=0;
 for(let i=0;i<r.length&&!orientation;i++){
  budget.take(1,owner);
  orientation=orientSign(r[i],r[(i+1)%r.length],r[(i+2)%r.length]);
 }
 if(!orientation)invalid(`${name} degenerate polygon`,true);
 for(let i=0;i<r.length;i++){
  const a=r[i],b=r[(i+1)%r.length];
  if(authored&&distance(a,b)<MIN)invalid(`${name} authored edge below .015m`,true);
  for(const vertex of r){
   budget.take(1,owner);
   if(orientSign(a,b,vertex)*orientation<0)invalid(`${name} must be convex, simple and unclosed`);
  }
 }
 const signedArea=area(r);
 if(!Number.isFinite(signedArea)||Math.abs(signedArea)<=NUM*NUM)fail('precision',owner??name,{polygon:r});
 return canonical(r);
}
function box(x,name){const b=point(x,6,name);if(b.slice(0,3).some((v,i)=>v>=b[i+3]))invalid(`${name} positive box extents required`,true);return b;}
function insideBox(p,b){return p.every((v,i)=>v>=b[i]&&v<=b[i+3]);}
function boxRing(b){return [[b[0],b[2]],[b[3],b[2]],[b[3],b[5]],[b[0],b[5]]];}
function overlapInterval(a,b,c,d){
 const u=sub(b,a),v=sub(d,c),len=length(u);
 if(Math.abs(cross(u,sub(c,a)))>NUM*len||Math.abs(cross(u,sub(d,a)))>NUM*len)return null;
 const den=dot(u,u),t0=dot(sub(c,a),u)/den,t1=dot(sub(d,a),u)/den;
 const lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(1,Math.max(t0,t1));return hi>lo+NUM/len?{lo,hi,reverse:dot(u,v)<0}:null;
}
// Exact sign for the rare ambiguous determinant. Binary floating point values
// are dyadic rationals, so BigInt can distinguish a real, however narrow, slit
// from a common source line without rounding unrelated geometry together.
function dyadic(value){
 const buffer=new ArrayBuffer(8),view=new DataView(buffer);view.setFloat64(0,value);
 const bits=view.getBigUint64(0),exponent=Number((bits>>52n)&2047n),fraction=bits&((1n<<52n)-1n),sign=bits>>63n?-1n:1n;
 return {n:sign*(exponent?(1n<<52n)|fraction:fraction),e:exponent?exponent-1075:-1074};
}
function rationalSub(a,b){const e=Math.min(a.e,b.e);return {n:(a.n<<BigInt(a.e-e))-(b.n<<BigInt(b.e-e)),e};}
function orientSign(a,b,c){
 const u=sub(b,a),v=sub(c,a),p=u[0]*v[1],q=u[1]*v[0],det=p-q;
 if(Math.abs(det)>8*Number.EPSILON*(Math.abs(p)+Math.abs(q)))return Math.sign(det);
 const ax=dyadic(a[0]),az=dyadic(a[1]),bx=rationalSub(dyadic(b[0]),ax),bz=rationalSub(dyadic(b[1]),az),cx=rationalSub(dyadic(c[0]),ax),cz=rationalSub(dyadic(c[1]),az);
 const exact=rationalSub({n:bx.n*cz.n,e:bx.e+cz.e},{n:bz.n*cx.n,e:bz.e+cx.e});return exact.n<0n?-1:exact.n>0n?1:0;
}
function sameLine(a,b,c,d){return orientSign(a,b,c)===0&&orientSign(a,b,d)===0;}
function onSegment(p,a,b){const d=sub(b,a),t=dot(sub(p,a),d)/dot(d,d);return Math.abs(cross(d,sub(p,a)))<=NUM*length(d)&&t>=-NUM/length(d)&&t<=1+NUM/length(d);}
class Failure extends Error{constructor(reason){super(reason.code);this.reason=reason;}}
function fail(code,ownerId,details={}){throw new Failure({code,ownerId,...details});}
class Budget{
 constructor(max,owner){this.max=max;this.owner=owner;this.spent=0;this.references=0;}
 take(n,ownerId=this.owner){if(!Number.isSafeInteger(n)||n<0||n>this.max-this.spent)fail('budget',ownerId,{value:this.spent,limit:this.max});this.spent+=n;}
 cells(n,ownerId){if(!Number.isSafeInteger(n)||n>MAX_CELLS-this.references)fail('budget',ownerId,{value:this.references,limit:MAX_CELLS});this.take(n,ownerId);this.references+=n;}
}
// Exact fractions certify source-edge features and complete ground/sill
// sections. They do not replace the shared convex geometry constructor.
function fraction(n,d=1n){
 if(d===0n)throw new RangeError('zero exact denominator');
 if(n===0n)return {n:0n,d:1n};
 if(d<0n){n=-n;d=-d;}
 let a=n<0n?-n:n,b=d;
 while(b){const r=a%b;a=b;b=r;}
 return {n:n/a,d:d/a};
}
function exactNumber(value){
 const q=dyadic(value);
 return q.e>=0?fraction(q.n<<BigInt(q.e)):fraction(q.n,1n<<BigInt(-q.e));
}
const qadd=(a,b)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const qsub=(a,b)=>fraction(a.n*b.d-b.n*a.d,a.d*b.d);
const qmul=(a,b)=>fraction(a.n*b.n,a.d*b.d);
const qdiv=(a,b)=>fraction(a.n*b.d,a.d*b.n);
const qcompare=(a,b)=>{const n=a.n*b.d-b.n*a.d;return n<0n?-1:n>0n?1:0;};
const QZERO={n:0n,d:1n},QONE={n:1n,d:1n};
const qcross=(a,b)=>qsub(qmul(a[0],b[1]),qmul(a[1],b[0]));
const qdot=(a,b)=>qadd(qmul(a[0],b[0]),qmul(a[1],b[1]));
const qpoint=p=>p.map(exactNumber);
const qvector=(a,b)=>a.map((v,i)=>qsub(v,b[i]));
function roundedFraction(q){
 if(q.n===0n)return 0;
 const negative=q.n<0n,n=negative?-q.n:q.n,d=q.d;
 let exponent=n.toString(2).length-d.toString(2).length;
 if(exponent>=0?n<(d<<BigInt(exponent)):(n<<BigInt(-exponent))<d)exponent--;
 const power=exponent>=-1022?52-exponent:1074;
 const numerator=power>=0?n<<BigInt(power):n;
 const denominator=power>=0?d:d<<BigInt(-power);
 let significand=numerator/denominator;
 const remainder=numerator%denominator;
 if(remainder*2n>denominator||remainder*2n===denominator&&(significand&1n))significand++;
 const value=Number(significand)*2**(-power);
 return negative?-value:value;
}
function exactCrossing(a,b,c,d){
 const p=qpoint(a),r=qvector(qpoint(b),p),q=qpoint(c),v=qvector(qpoint(d),q);
 const t=qdiv(qcross(qvector(q,p),v),qcross(r,v));
 return p.map((x,i)=>qadd(x,qmul(r[i],t)));
}
function insideExact(point,ring,budget,owner){
 for(let i=0;i<ring.length;i++){
  budget.take(1,owner);
  if(orientSign(ring[i],ring[(i+1)%ring.length],point)<0)return false;
 }
 return true;
}
function hasPositiveIntersection(a,b,budget,owner){
 // Strict separating-axis theorem on original binary coordinates. No temporary
 // edge array, predicate call, or nested candidate scan precedes its debit.
 for(let side=0;side<2;side++){
  const ring=side?b:a,peer=side?a:b;
  for(let i=0;i<ring.length;i++){
   let inward=false;
   for(const point of peer){
    budget.take(1,owner);
    if(orientSign(ring[i],ring[(i+1)%ring.length],point)>0){inward=true;break;}
   }
   if(!inward)return false;
  }
 }
 return true;
}
function intersectionFeatures(a,b,budget,owner){
 const features=[],vertices=new Set();
 for(let side=0;side<2;side++){
  const ring=side?b:a,peer=side?a:b;
  for(const point of ring){
   if(!insideExact(point,peer,budget,owner))continue;
   budget.take(1,owner);
   const key=JSON.stringify(point);
   if(!vertices.has(key)){vertices.add(key);features.push({vertex:point,point,exact:qpoint(point)});}
  }
 }
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
  budget.take(1,owner);
  const p=a[i],q=a[(i+1)%a.length],r=b[j],t=b[(j+1)%b.length];
  const ab0=orientSign(p,q,r),ab1=orientSign(p,q,t),cd0=orientSign(r,t,p),cd1=orientSign(r,t,q);
  if(ab0*ab1>=0||cd0*cd1>=0)continue;
  // Reserve the exact intersection and its representation before allocation.
  budget.take(1,owner);
  const exact=exactCrossing(p,q,r,t),point=exact.map(roundedFraction);
  if(!point.every(Number.isFinite))fail('precision',owner);
  features.push({point,exact});
 }
 return features;
}
function insideExactFraction(point,ring,budget,owner){
 for(let i=0;i<ring.length;i++){
  budget.take(1,owner);
  const a=qpoint(ring[i]),edge=qvector(qpoint(ring[(i+1)%ring.length]),a);
  if(qcross(edge,qvector(point,a)).n<0n)return false;
 }
 return true;
}
function positiveSourceOverlapInRequest(a,b,request,budget,owner){
 // Every extremal point of a finite convex halfplane intersection is an
 // original vertex or a crossing of two original boundary edges. Three exact,
 // non-collinear feasible points prove positive area without constructing a
 // rounded, potentially collapsed overlap polygon.
 let origin=null,direction=null;
 const rings=[a,b,request];
 for(let i=0;i<rings.length;i++)for(let j=0;j<i;j++){
  budget.take(1,owner);
  const features=intersectionFeatures(rings[i],rings[j],budget,owner);
  for(const feature of features){
   let feasible=true;
   for(const ring of rings)if(!insideExactFraction(feature.exact,ring,budget,owner)){feasible=false;break;}
   if(!feasible)continue;
   budget.take(1,owner);
   if(!origin){origin=feature.exact;continue;}
   const delta=qvector(feature.exact,origin);
   if(!direction){if(delta.some(q=>q.n!==0n))direction=delta;continue;}
   if(qcross(direction,delta).n!==0n)return true;
  }
 }
 return false;
}
function samePoint(a,b){return a[0]===b[0]&&a[1]===b[1];}
function representedCrossing(actual,expected,scale){
 // The shared constructor can round a computed line intersection differently
 // from exact rational division. This only matches an existing exact feature;
 // it cannot create/delete a corner or identify two neighbouring features.
 return actual.every((v,i)=>Math.abs(v-expected[i])<=8*Number.EPSILON*scale);
}
function certifyClip(result,a,b,budget,owner){
 const features=intersectionFeatures(a,b,budget,owner);
 const outline=withoutCollinear(result,budget,owner);
 if(outline.length!==features.length||outline.length<3)fail('precision',owner);
 budget.take(features.length,owner);
 const used=new Set();
 budget.take(a.length+b.length,owner);
 const scale=Math.max(1,...a.flat().map(Math.abs),...b.flat().map(Math.abs));
 for(const point of outline){
  // An unchanged original vertex that is outside the opposite halfplanes is
  // never rounding permission for a different, nearby intersection vertex.
  for(const [ring,peer]of [[a,b],[b,a]])for(const vertex of ring){
   budget.take(1,owner);
   if(samePoint(point,vertex)&&!insideExact(vertex,peer,budget,owner))fail('precision',owner);
  }
  let match=-1;
  for(let i=0;i<features.length;i++){
   budget.take(1,owner);
   const feature=features[i],equal=representedCrossing(point,feature.point,scale);
   if(equal){if(match!==-1)fail('precision',owner);match=i;}
  }
  if(match===-1||used.has(match))fail('precision',owner);
  used.add(match);
 }
 return outline;
}
function clip(a,b,budget,owner){
 budget.take(1,owner);
 const subject=withoutCollinear(a,budget,owner),boundary=withoutCollinear(b,budget,owner);
 if(!hasPositiveIntersection(subject,boundary,budget,owner))return [];
 try{
  const result=clipConvexPolygon(subject,boundary,{epsilon:CLIP});
  if(!result.length)fail('precision',owner);
  finiteRing(result,owner);
  return certifyClip(result,subject,boundary,budget,owner);
 }catch(error){
  if(error instanceof Failure)throw error;
  fail('precision',owner);
 }
}
function cells(b){const x0=Math.floor(b.x0/2),x1=Math.floor(b.x1/2),z0=Math.floor(b.z0/2),z1=Math.floor(b.z1/2);return {x0,x1,z0,z1,count:(x1-x0+1)*(z1-z0+1)};}
function makeIndex(hosts,budget){
 const buckets=new Map();
 for(const host of hosts)for(const face of host.faces){
  const c=cells(face.bounds);budget.cells(c.count,host.id);
  for(let x=c.x0;x<=c.x1;x++)for(let z=c.z0;z<=c.z1;z++){
   const k=`${x},${z}`;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(face);
  }
 }
 return {query(poly,hostIds,owner){
  const b=bounds(poly),c=cells(b);budget.take(c.count,owner);const wanted=new Set(hostIds),found=new Map();
  for(let x=c.x0;x<=c.x1;x++)for(let z=c.z0;z<=c.z1;z++)for(const f of buckets.get(`${x},${z}`)??[]){budget.take(1,owner);if(wanted.has(f.hostId)&&boxesMeet(b,f.bounds))found.set(f.key,f);}
  return [...found.values()].sort((a,b)=>cmp(a.key,b.key));
 }};
}
function normalizePort(p,name,prototype,budget){
 object(p,name);const position=point(p.position,3,`${name}.position`),servicePosition=point(p.servicePosition,3,`${name}.servicePosition`),normal=point(p.normal,3,`${name}.normal`);
 if(Math.abs(normal[1])>1e-12||Math.abs(Math.hypot(...normal)-1)>1e-6)invalid(`${name} unit horizontal normal required`);
 const width=number(p.width,`${name}.width`);if(width<=0)invalid(`${name} measured width must be positive`,true);
 if(!['serve','cross'].includes(p.kind))invalid(`${name} kind`);
 if(Math.hypot(position[0]-servicePosition[0],position[2]-servicePosition[2])>2e-5)invalid(`${name} anchor/service XZ mismatch`);
 const witness=array(p.witness,`${name}.witness`,2,32,budget,budget.owner).map(v=>point(v,3,name));
 const tangent=[normal[2],-normal[0]],projection=witness.map(v=>dot([v[0]-servicePosition[0],v[2]-servicePosition[2]],tangent));
 if(Math.min(...projection)>-width/2+NUM||Math.max(...projection)<width/2-NUM)invalid(`${name} witness does not span promised aperture`);
 if(witness.some(v=>Math.abs(dot([v[0]-servicePosition[0],v[2]-servicePosition[2]],[normal[0],normal[2]]))>2e-5))invalid(`${name} witness is not on the registered face plane`);
 budget.take(witness.length*(witness.length-1)/2);
 const centerYs=[];
 for(let i=0;i<witness.length;i++){
  if(projection[i]===0)centerYs.push(witness[i][1]);
  for(let j=0;j<i;j++)if(projection[i]!==projection[j]&&Math.min(projection[i],projection[j])<=0&&Math.max(projection[i],projection[j])>=0){
   const t=-projection[i]/(projection[j]-projection[i]);centerYs.push(witness[i][1]+t*(witness[j][1]-witness[i][1]));
  }
 }
 if(!centerYs.length||servicePosition[1]<Math.min(...centerYs)-NUM||servicePosition[1]>Math.max(...centerYs)+NUM)invalid(`${name} service center outside the face witness convex hull`);
 const out={id:id(p.id),position,servicePosition,normal,width,kind:p.kind,witness};
 if(prototype){
  if(position[1]!==0)invalid(`${name} local arrival anchor Y must be zero`);
  if(p.prototypeOwner!==prototype.prototypeOwner||'owner'in p)invalid(`${name} prototypeOwner identity mismatch / world value in local record`);
  const part=prototype.parts.find(x=>x.id===p.facePartId);if(!part)invalid(`${name} unknown facePartId`);
  if(!insideBox(position,prototype.envelope)||!insideBox(servicePosition,part.box)||witness.some(v=>!insideBox(v,part.box)))invalid(`${name} registered point outside envelope/face part`);
  out.facePartId=part.id;
 }
 return out;
}
function normalize(input,budget){
 plain(input,'input');id(input.id);const frame=plain(input.frame,'frame'),site=plain(input.site,'site'),recipe=plain(input.recipe,'recipe');
 object(site.owner,'site.owner');if(frame.owner!==site.owner)invalid('frame/site owner identity mismatch');
 if(['scale','shear','matrix'].some(k=>k in frame))invalid('frame must be rigid');
 const origin=point(frame.origin,2,'frame.origin'),yawRadians=number(frame.yawRadians,'frame.yawRadians',false),owner=site.owner;
 const level=id(site.level,'site.level');for(const k of ['groupId','edgeId','regionId'])id(site[k],`site.${k}`);if(site.lotId!==null)id(site.lotId,'site.lotId');
 if(!site.layout||typeof site.layout.footprintAllowed!=='function'||!Array.isArray(site.layout.levels)||!Array.isArray(site.layout.regions)||!site.layout.levels.some(l=>l.id===level))invalid('actual world layout / level required');
 if(!site.layout.regions.some(r=>r.id===site.regionId&&r.level===level))invalid('site region is not in world layout');
 const protos=unique(array(input.prototypes,'prototypes',1,Infinity,budget,input.id).map(raw=>{
  object(raw,'prototype');budget.take(1,input.id);object(raw.prototypeOwner,'prototypeOwner');if(raw.prototypeOwner===owner||'owner'in raw)invalid('prototype must have independent local identity');
  const p={id:id(raw.id),prototypeOwner:raw.prototypeOwner,envelope:box(raw.envelope,'envelope')};
  p.parts=unique(array(raw.parts,'parts',1,96,budget,input.id).map(v=>{
   object(v,'part');budget.take(1,input.id);if(v.prototypeOwner!==p.prototypeOwner||'owner'in v)invalid('part prototypeOwner identity mismatch');const b=box(v.box,'part.box');
   if(!insideBox(b.slice(0,3),p.envelope)||!insideBox(b.slice(3),p.envelope))invalid('part outside envelope');return {id:id(v.id),box:b};
  }),'part');
  p.bearings=array(raw.bearings,'bearings',1,16,budget,input.id).map(v=>{
   object(v,'bearing');budget.take(1,input.id);if(v.prototypeOwner!==p.prototypeOwner||'owner'in v)invalid('bearing prototypeOwner identity mismatch');const ring=polygon(v.ring,'bearing.ring',false,budget,input.id),bottomY=number(v.bottomY,'bearing.bottomY');
   if(ring.some(([x,z])=>!insideBox([x,bottomY,z],p.envelope)))invalid('bearing outside envelope');return {ring,bottomY};
  }).sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b)));
  const datumTolerance=2**-23*Math.max(1,Math.abs(p.envelope[1]),Math.abs(p.envelope[4]),p.envelope[4]-p.envelope[1]),bottoms=p.bearings.map(b=>b.bottomY);
  if(Math.max(...bottoms)-Math.min(...bottoms)>datumTolerance)invalid('bearings must share a flat datum within Float32 measurement quantization');
  if(p.parts.some(part=>part.box[1]<Math.min(...bottoms)-datumTolerance))invalid('known part extends below the declared bearing datum');
  p.ports=unique(array(raw.ports,'ports',0,8,budget,input.id).map(v=>{budget.take(1,input.id);return normalizePort(v,`prototype ${p.id} port`,p,budget);}),'port');return p;
 }),'prototype');
 let totalFaces=0;const hostInputs=array(site.hostFaces,'hostFaces',1,128,budget,input.id);
 for(const h of hostInputs){object(h,'host');totalFaces+=array(h.faces,'host.faces',1,150000,budget,input.id).length;if(totalFaces>300000)invalid('world face count >300000',true);}
 const hosts=unique(hostInputs.map(h=>{
  if(h.owner!==owner)invalid('host owner identity mismatch');const hostId=id(h.id),faces=h.faces;
  const fs=unique(faces.map(f=>{
   object(f,'face');const faceId=id(f.id);const p=array(f.p,'face.p',3,3).map(v=>point(v,3,'face point')),[a,b,c]=p;
   const ux=b[0]-a[0],uz=b[2]-a[2],vx=c[0]-a[0],vz=c[2]-a[2],ny=uz*vx-ux*vz;
   const orientation=orientSign([a[0],a[2]],[b[0],b[2]],[c[0],c[2]]);
   if(orientation>=0)invalid('host face must have positive Y normal and nonzero projection',true);
   if(!Number.isFinite(ny)||ny<=NUM*NUM)fail('precision',hostId,{peerId:faceId});
   const sy=((b[1]-a[1])*vz-(c[1]-a[1])*uz)/(-ny),sz=(ux*(c[1]-a[1])-vx*(b[1]-a[1]))/(-ny),ring=canonical(p.map(v=>[v[0],v[2]]));
   const key=JSON.stringify([hostId,faceId]);return {id:faceId,hostId,key,ring,vertices:p,bounds:bounds(ring),grade:Math.hypot(sy,sz),y:([x,z])=>a[1]+sy*(x-a[0])+sz*(z-a[2])};
  }),'face');return {id:hostId,faces:fs};
 }),'host');
 const hostMap=new Map(hosts.map(h=>[h.id,h])),scopes=ids(recipe.hostScopes,'hostScopes',1);for(const h of scopes)if(!hostMap.has(h))invalid('unknown scoped host');
 const authorize=(hs,name)=>{const out=ids(hs,name,1);if(out.some(h=>!hostMap.has(h)||!scopes.includes(h)))invalid(`${name} unknown or unauthorized host`);return out;};
 const members=unique(array(recipe.members,'members',1,16,budget,input.id).map(m=>{
  object(m,'member');id(m.prototypeId);const prototype=protos.find(p=>p.id===m.prototypeId);if(!prototype)invalid('unknown member prototype');
  const regionId=id(m.regionId);if(!site.layout.regions.some(r=>r.id===regionId&&r.level===level&&r.role!=='forbidden'))invalid('unknown member region');
  const bearingHost=id(m.bearingHost);authorize([bearingHost],'bearingHost');if(['scale','shear','matrix'].some(k=>k in m))invalid('member must be rigid');
  return {id:id(m.id),prototypeId:m.prototypeId,prototype,uv:point(m.uv,2,'member.uv'),yawRadians:number(m.yawRadians,'member.yaw',false),bearingHost,regionId};
 }),'member');
 const reserves=unique(array(recipe.reserves,'reserves',0,Infinity,budget,input.id).map(r=>{object(r,'reserve');const reserveId=id(r.id);budget.take(1,input.id);return {id:reserveId,polygon:polygon(r.polygon,'reserve.polygon',true,budget,reserveId),hostIds:authorize(r.hostIds,'reserve.hostIds')};}),'reserve');
 const blocks=unique(array(site.blocks,'blocks',0,Infinity,budget,input.id).map(b=>{
  object(b,'block');
  id(b.id);budget.take(1,input.id);if(b.owner!==owner)invalid('block owner identity mismatch');const yMin=number(b.yMin,'block.yMin'),yMax=number(b.yMax,'block.yMax');if(yMin>=yMax)invalid('block height interval',true);
  return {id:b.id,sourceKind:'site-block',polygon:polygon(b.polygon,'block.polygon',false,budget,b.id),yMin,yMax};
 }),'block');
 const solids=unique(array(site.reservedSolids,'reservedSolids',0,Infinity,budget,input.id).map(s=>{object(s,'reservedSolid');id(s.id);budget.take(1,input.id);if(s.owner!==owner)invalid('reservedSolid owner identity mismatch');return {id:s.id,polygon:polygon(s.polygon,'reservedSolid.polygon',false,budget,s.id)};}),'reservedSolid');
 const arrival=plain(site.arrival,'arrival');if(arrival.owner!==owner)invalid('arrival owner identity mismatch');
 for(const p of [arrival.sourcePort,arrival.gatePort])if(p?.owner!==owner)invalid('arrival port owner identity mismatch');
 const sourcePort=normalizePort(arrival.sourcePort,'sourcePort',null,budget),gatePort=normalizePort(arrival.gatePort,'gatePort',null,budget);
 const gateId=id(recipe.gateId),startId=id(arrival.startId);if(sourcePort.id!==startId||gatePort.id!==gateId||startId===gateId)invalid('arrival endpoint identity mismatch');
 const nodes=unique(array(recipe.nodes,'recipe.nodes',1,48,budget,input.id).map(n=>{
  object(n,'node');const out={id:id(n.id)};
  if('uv'in n){if('memberId'in n||'portId'in n)invalid('node must be uv or member port');out.uv=point(n.uv,2,'node.uv');}
  else{out.memberId=id(n.memberId);out.portId=id(n.portId);if(!members.some(m=>m.id===n.memberId&&m.prototype.ports.some(p=>p.id===n.portId)))invalid('unknown member port node');}
  return out;
 }),'node');if(!nodes.some(n=>n.id===gateId))invalid('recipe gate node missing');if(nodes.some(n=>n.id===startId))invalid('arrival source collides with recipe node');
 const arrivalNodes=unique(array(arrival.nodes,'arrival.nodes',0,46,budget,input.id).map(n=>{object(n,'arrival node');return {id:id(n.id),position:point(n.position,3,'arrival node.position')};}),'arrival node');
 if(arrivalNodes.some(n=>n.id===startId||nodes.some(m=>m.id===n.id)))invalid('arrival middle-node ID collides with endpoint/recipe');
 if(nodes.length+arrivalNodes.length+1>48)invalid('combined node count >48',true);
 const recipeIds=new Set(nodes.map(node=>node.id));
 const arrivalIds=new Set([startId,gateId,...arrivalNodes.map(node=>node.id)]);
 const normalizeEdges=(es,name,allowed)=>array(es,name,1,64,budget,input.id).map(e=>{
  object(e,'edge');
  const a=id(e.a),b=id(e.b);
  if(a===b||!allowed.has(a)||!allowed.has(b))invalid(`${name} has missing/equal/out-of-domain node references`);
  const width=number(e.width,'edge.width'),headroom=number(e.headroom??2.1,'edge.headroom');
  if(width<MIN||headroom<1.8||headroom>3)invalid('edge width/headroom out of range',true);
  return {a:cmp(a,b)<0?a:b,b:cmp(a,b)<0?b:a,key:edgeKey(a,b),width,headroom,hostIds:authorize(e.hostIds,'edge.hostIds')};
 });
 const recipeEdges=normalizeEdges(recipe.edges,'recipe.edges',recipeIds);
 const arrivalEdges=normalizeEdges(arrival.edges,'arrival.edges',arrivalIds);
 validateArrivalGraph(arrivalIds,arrivalEdges,startId,gateId,budget);
 const edges=[...recipeEdges,...arrivalEdges].sort((a,b)=>cmp(a.key,b.key));
 if(edges.length>64||new Set(edges.map(e=>e.key)).size!==edges.length)invalid('duplicate / >64 combined edges');
 const required=ids(recipe.requiredNodeIds,'requiredNodeIds',1);if(required.some(n=>!nodes.some(x=>x.id===n)))invalid('required node missing from recipe');
 return {id:input.id,frame:{origin,yawRadians},site,protos,hosts,scopes,members,reserves,blocks,solids,nodes,arrivalNodes,sourcePort,gatePort,gateId,startId,edges,required};
}

// Clipped pieces retain their exact source plane. Topology, overlap and every
// height extremum are checked separately; area is only a redundant checksum.
function cover(poly,hostIds,owner,index,budget,mode='walk',requestFirst=false){
 const pieces=[];let minY=Infinity,maxY=-Infinity,maxGrade=0,maxStep=0;
 for(const face of index.query(poly,hostIds,owner)){
  // A turn with additional cap extrema must retain them as clipping subjects
  // instead of reconstructing their shallow bend from nearly parallel lines.
  const ring=requestFirst?clip(poly,face.ring,budget,owner):clip(face.ring,poly,budget,owner);if(!ring.length)continue;
  const ys=ring.map(face.y);if(!ys.every(Number.isFinite))fail('precision',owner,{peerId:face.key});
  pieces.push({ring,face,bounds:bounds(ring)});minY=Math.min(minY,...ys);maxY=Math.max(maxY,...ys);maxGrade=Math.max(maxGrade,face.grade);
 }
 const gap=mode==='bearing'?'bearing-gap':'walk-gap',overlap=mode==='bearing'?'bearing-gap':'walk-overlap';
 if(!pieces.length)fail(gap,owner,{polygon:poly});
 if(mode==='walk'&&maxGrade>GRADE+NUM)fail('grade',owner,{value:maxGrade,limit:GRADE,polygon:poly});
 for(let i=0;i<pieces.length;i++)for(let j=0;j<i;j++){
  budget.take(1,owner);
  const a=pieces[i],b=pieces[j];
  if(!boxesMeet(a.face.bounds,b.face.bounds))continue;
  // Independent clipping can round a shared source edge in opposite directions.
  // Source-disjoint interiors remain disjoint: only a positive intersection of
  // the actual measured faces can establish physical double coverage.
  if(!hasPositiveIntersection(a.face.ring,b.face.ring,budget,owner))continue;
  if(positiveSourceOverlapInRequest(a.face.ring,b.face.ring,poly,budget,owner))fail(overlap,owner,{peerId:b.face.key,polygon:poly});
 }
 budget.take(pieces.reduce((sum,p)=>sum+p.ring.length*(1+p.face.ring.length+poly.length),0),owner);
 const exterior=segments(poly).map(([a,b])=>({a,b,ranges:[]}));
 const es=pieces.flatMap(piece=>segments(piece.ring).map(([a,b])=>{
  if(distance(a,b)<=NUM)fail('precision',owner,{polygon:[a,b]});
  const sources=segments(piece.face.ring).filter(([c,d])=>onSegment(a,c,d)&&onSegment(b,c,d));
  const boundaries=exterior.filter(ex=>onSegment(a,ex.a,ex.b)&&onSegment(b,ex.a,ex.b));
  // An input edge merely near a request boundary remains an input edge. It
  // cannot be reclassified as a clipping edge to hide a positive missing strip.
  const boundary=boundaries.filter(ex=>!sources.length||sources.some(([c,d])=>sameLine(c,d,ex.a,ex.b)));
  return {a,b,piece,sources,boundary,ts:[0,1],matches:[]};
 }));
 for(let i=0;i<es.length;i++)for(let j=0;j<i;j++){
  budget.take(1,owner);const e=es[i],f=es[j];if(e.piece===f.piece)continue;
  const x=overlapInterval(e.a,e.b,f.a,f.b);if(!x)continue;
  let common=false;for(const [a,b]of e.sources)for(const [c,d]of f.sources){budget.take(1,owner);if(sameLine(a,b,c,d))common=true;}if(!common)continue;
  const y=overlapInterval(f.a,f.b,e.a,e.b);if(!x.reverse)fail('precision',owner,{polygon:poly});
  e.ts.push(x.lo,x.hi);f.ts.push(y.lo,y.hi);e.matches.push({lo:x.lo,hi:x.hi,peer:f});f.matches.push({lo:y.lo,hi:y.hi,peer:e});
 }
 for(const e of es){
  budget.take(e.ts.length,owner);
  const cuts=[...new Set(e.ts)].sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++){
   budget.take(1,owner);const lo=cuts[i-1],hi=cuts[i];if(hi<=lo)continue;
   const a=lerp(e.a,e.b,lo),b=lerp(e.a,e.b,hi),middle=(lo+hi)/2,matched=[];
   for(const match of e.matches){
    budget.take(1,owner);
    if(middle>=match.lo-NUM&&middle<=match.hi+NUM)matched.push(match);
    if(matched.length>1)break;
   }
   if(matched.length>1)fail(overlap,owner,{polygon:poly});
   if(matched.length){
    const peer=matched[0].peer;budget.take(1,owner);const step=Math.max(Math.abs(e.piece.face.y(a)-peer.piece.face.y(a)),Math.abs(e.piece.face.y(b)-peer.piece.face.y(b)));maxStep=Math.max(maxStep,step);
    if(mode==='walk'&&step>STEP+NUM)fail('seam-step',owner,{peerId:peer.piece.face.key,value:step,limit:STEP,polygon:[a,b]});
   }else{
    let found=false;for(const ex of e.boundary){budget.take(1,owner);if(onSegment(a,ex.a,ex.b)&&onSegment(b,ex.a,ex.b)&&dot(sub(b,a),sub(ex.b,ex.a))>0){const d=sub(ex.b,ex.a),den=dot(d,d);ex.ranges.push([dot(sub(a,ex.a),d)/den,dot(sub(b,ex.a),d)/den]);found=true;break;}}
    if(!found)fail(gap,owner,{peerId:e.piece.face.key,polygon:[a,b]});
   }
  }
 }
 for(const ex of exterior){
  ex.ranges.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let end=0;for(const [lo,hi]of ex.ranges){budget.take(1,owner);if(lo>end+NUM)fail(gap,owner,{polygon:[ex.a,ex.b]});end=Math.max(end,hi);}if(end<1-NUM)fail(gap,owner,{polygon:[ex.a,ex.b]});
 }
 const sum=pieces.reduce((s,p)=>s+area(p.ring),0),target=area(poly),tolerance=Math.max(1e-6,2e-8*target);
 if(Math.abs(sum-target)>tolerance)fail('precision',owner,{value:sum,limit:target,polygon:poly});
 budget.take(1,owner);
 return {request:poly,pieces,minY,maxY,maxGrade,maxStep,faceIds:pieces.map(p=>({hostId:p.face.hostId,faceId:p.face.id}))};
}
function rigid(origin,yaw){const c=Math.cos(yaw),s=Math.sin(yaw);return p=>[origin[0]+c*p[0]+s*p[1],origin[1]-s*p[0]+c*p[1]];}
function worldPoint(transform,p,y){const [x,z]=transform([p[0],p[2]]);return [number(x,'world.x'),number(p[1]+y,'world.y'),number(z,'world.z')];}
// Preserve the closed set while removing only exact same-direction redundancy.
// This is shared by offset construction and clipping certification.
function withoutCollinear(ring,budget,owner){
 budget.take(ring.length*ring.length,owner);
 const result=ring.slice();
 let changed=true;
 while(changed&&result.length>3){
  changed=false;
  for(let i=0;i<result.length;i++){
   const a=result[(i+result.length-1)%result.length],b=result[i],c=result[(i+1)%result.length];
   if(orientSign(a,b,c)===0&&dot(sub(b,a),sub(c,b))>0){result.splice(i,1);changed=true;break;}
  }
 }
 return result;
}
function finiteRing(ring,owner){
 if(ring.length<3||ring.some(p=>p.length!==2||!p.every(Number.isFinite)))fail('precision',owner);
 return ring;
}
function expanded(poly,amount,exempt,budget,owner){
 const outline=withoutCollinear(poly,budget,owner);
 budget.take(outline.length*2,owner);
 const lines=segments(outline).map(([a,b])=>{
  const d=sub(b,a),len=length(d),normal=[d[1]/len,-d[0]/len];
  const skip=exempt&&dot(normal,[exempt.normal[0],exempt.normal[2]])>1-1e-6&&Math.abs(dot(normal,sub([exempt.servicePosition[0],exempt.servicePosition[2]],a)))<=2e-5;
  const shift=skip?0:amount;
  return {p:[a[0]+normal[0]*shift,a[1]+normal[1]*shift],d};
 });
 const result=lines.map((line,i)=>{
  const previous=lines[(i+lines.length-1)%lines.length],den=cross(previous.d,line.d);
  if(!Number.isFinite(den)||den===0)fail('precision',owner);
  const t=cross(sub(line.p,previous.p),line.d)/den;
  return [previous.p[0]+t*previous.d[0],previous.p[1]+t*previous.d[1]];
 });
 return canonical(finiteRing(result,owner));
}
function registeredExemption(obstacle,ports,budget,owner){
 if(obstacle.sourceKind!=='member-part'||typeof obstacle.memberId!=='string'||typeof obstacle.partId!=='string')return null;
 for(const port of ports){
  budget.take(1,owner);
  if(typeof port.memberId==='string'&&typeof port.facePartId==='string'&&port.memberId===obstacle.memberId&&port.facePartId===obstacle.partId)return port;
 }
 return null;
}
function registeredServeOutside(request,obstacle,port,budget,owner){
 // Sufficient source proof only: the measured finite face must span an
 // actual support edge, and the whole original request must stay outside it.
 if(port.witness.length!==2)return false;
 budget.take(3,owner);
 const [first,last]=port.witness.map(p=>[p[0],p[2]]);
 for(let i=0;i<obstacle.polygon.length;i++){
  budget.take(1,owner);
  const a=obstacle.polygon[i],b=obstacle.polygon[(i+1)%obstacle.polygon.length];
  if(!((samePoint(a,first)&&samePoint(b,last))||(samePoint(a,last)&&samePoint(b,first))))continue;
  for(const point of request){budget.take(1,owner);if(orientSign(a,b,point)>0)return false;}
  return true;
 }
 return false;
}
function obstruct(poly,proof,obstacles,hostIds,headroom,owner,budget,exemptions=[]){
 let minHeadroom=headroom;
 for(const obstacle of obstacles){
  budget.take(1,owner);const exemption=registeredExemption(obstacle,exemptions,budget,owner);
  const padded=expanded(obstacle.polygon,CLEAR,exemption,budget,owner);if(!boxesMeet(bounds(poly),bounds(padded)))continue;
  // Rounded host clips cannot establish intrusion when the original request
  // is separated by its registered source face AND the actual padded solid.
  if(exemption?.kind==='serve'&&registeredServeOutside(poly,obstacle,exemption,budget,owner)&&!hasPositiveIntersection(poly,padded,budget,owner))continue;
  for(const piece of proof.pieces){
   const r=clip(piece.ring,padded,budget,owner);if(!r.length)continue;
   const ys=r.map(piece.face.y),low=Math.min(...ys),high=Math.max(...ys);
   // Only the identified floor itself is allowed to meet feet from below.
   if(obstacle.sourceKind==='site-block'&&piece.face.hostId===obstacle.id&&Math.abs(obstacle.yMax-low)<=NUM&&Math.abs(obstacle.yMax-high)<=NUM)continue;
   // A registered cross interface can name its actual sill part. Its measured
   // top must coincide with the entire independently qualified walking piece;
   // this does not exempt any jamb, wall, column or header in the same member.
   if(exemption?.kind==='cross'&&Math.abs(exemption.servicePosition[1]-obstacle.yMax)<=NUM&&exemption.witness.every(p=>Math.abs(p[1]-obstacle.yMax)<=NUM)&&Math.abs(low-obstacle.yMax)<=NUM&&Math.abs(high-obstacle.yMax)<=NUM)continue;
   if(obstacle.yMax<low-CLEAR||obstacle.yMin>high+headroom+CLEAR)continue;
   const available=obstacle.yMin-high-CLEAR;minHeadroom=Math.min(minHeadroom,Math.max(0,available));
   if(obstacle.yMax>low-CLEAR&&available<headroom-NUM)fail('blocked-clearance',owner,{peerId:obstacle.id,polygon:r,value:Math.max(0,available),limit:headroom});
  }
 }
 return minHeadroom;
}
// Clip the requested segment against ORIGINAL source halfplanes. The rounded
// 2D clip used for area proof is not the source of a new section-width tolerance.
function sourceSegmentRange(section,ring,budget,owner){
 let loExact=QZERO,hiExact=QONE;
 for(let i=0;i<ring.length;i++){
  budget.take(1,owner);
  const a=qpoint(ring[i]),edge=qvector(qpoint(ring[(i+1)%ring.length]),a);
  const base=qcross(edge,qvector(section.origin,a)),slope=qcross(edge,section.direction);
  if(slope.n===0n){if(base.n<0n)return null;continue;}
  const at=qdiv(qsub(QZERO,base),slope);
  if(slope.n>0n){if(qcompare(at,loExact)>0)loExact=at;}
  else if(qcompare(at,hiExact)<0)hiExact=at;
  if(qcompare(loExact,hiExact)>0)return null;
 }
 return {loExact,hiExact};
}
function sourceSectionHeight(face,section,budget,owner){
 budget.take(1,owner);
 const [a,b,c]=face.vertices.map(qpoint);
 const origin=[a[0],a[2]],u=qvector([b[0],b[2]],origin),v=qvector([c[0],c[2]],origin);
 const denominator=qcross(u,v),dyU=qsub(b[1],a[1]),dyV=qsub(c[1],a[1]);
 if(denominator.n===0n)fail('precision',owner,{peerId:face.key});
 const heightAt=point=>{
  const w=qvector(point,origin);
  return qadd(a[1],qadd(qmul(qdiv(qcross(w,v),denominator),dyU),qmul(qdiv(qcross(u,w),denominator),dyV)));
 };
 // One affine function from this actual source triangle, never a fitted or
 // averaged surface. Exact evaluation also avoids cancellation on tiny spans.
 const from=heightAt(section.origin),to=heightAt(section.origin.map((q,i)=>qadd(q,section.direction[i]))),rise=qsub(to,from);
 return parameter=>roundedFraction(qadd(from,qmul(rise,parameter)));
}
function requireFullProfile(intervals,a,b,owner,budget,code,peerId){
 let end=QZERO;
 for(const interval of intervals){
  budget.take(1,owner);
  if(qcompare(interval.loExact,end)>0)fail(code,owner,{...(peerId?{peerId}:{}),polygon:[a,b]});
  if(qcompare(interval.hiExact,end)>0)end=interval.hiExact;
 }
 if(qcompare(end,QONE)<0)fail(code,owner,{...(peerId?{peerId}:{}),polygon:[a,b]});
}
function profile(a,b,proof,owner,budget){
 budget.take(1,owner);
 // The checked request is convex: both endpoints in it certify the whole cap.
 // A source triangle can extend beyond the area checked for support and clearance.
 if(!insideExact(a,proof.request,budget,owner)||!insideExact(b,proof.request,budget,owner))fail('walk-gap',owner,{polygon:[a,b]});
 const origin=qpoint(a),section={origin,direction:qvector(qpoint(b),origin)},out=[];
 for(const piece of proof.pieces){
  budget.take(1,owner);
  const range=sourceSegmentRange(section,piece.face.ring,budget,owner);
  if(!range||qcompare(range.hiExact,range.loExact)===0)continue;
  const lo=roundedFraction(range.loExact),hi=roundedFraction(range.hiExact);
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||!(hi>lo))fail('precision',owner,{peerId:piece.face.key});
  const heightAtExact=sourceSectionHeight(piece.face,section,budget,owner);
  budget.take(1,owner);
  out.push({...range,lo,hi,heightAtExact,key:piece.face.key});
 }
 out.sort((l,r)=>{budget.take(1,owner);return qcompare(l.loExact,r.loExact)||qcompare(l.hiExact,r.hiExact)||cmp(l.key,r.key);});
 requireFullProfile(out,a,b,owner,budget,'walk-gap');
 return out;
}
function compareProfiles(a,b,left,right,owner,budget){
 let maximum=0;
 for(const l of left)for(const r of right){
  budget.take(1,owner);
  const loExact=qcompare(l.loExact,r.loExact)>0?l.loExact:r.loExact;
  const hiExact=qcompare(l.hiExact,r.hiExact)<0?l.hiExact:r.hiExact;
  if(qcompare(hiExact,loExact)<=0)continue;
  const lo=roundedFraction(loExact),hi=roundedFraction(hiExact);
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||!(hi>lo))fail('precision',owner);
  const start=lerp(a,b,lo),end=lerp(a,b,hi);
  if(![...start,...end].every(Number.isFinite))fail('precision',owner);
  const heights=[profileHeight(l,loExact,budget,owner),profileHeight(r,loExact,budget,owner),profileHeight(l,hiExact,budget,owner),profileHeight(r,hiExact,budget,owner)];
  if(!heights.every(Number.isFinite))fail('precision',owner);
  const v=Math.max(Math.abs(heights[0]-heights[1]),Math.abs(heights[2]-heights[3]));
  if(!Number.isFinite(v))fail('precision',owner);
  maximum=Math.max(maximum,v);
  if(v>STEP+NUM)fail('seam-step',owner,{value:v,limit:STEP,polygon:[start,end]});
 }
 return maximum;
}
function atPoint(p,proof,owner,budget){
 const fs=[];for(const piece of proof.pieces){budget.take(1,owner);if(piece.face.ring.every((a,i)=>orientSign(a,piece.face.ring[(i+1)%piece.face.ring.length],p)>=0))fs.push(piece.face);}
 if(!fs.length)fail('walk-gap',owner,{polygon:[p]});fs.sort((a,b)=>cmp(a.key,b.key));const y=fs[0].y(p);if(fs.some(f=>Math.abs(f.y(p)-y)>STEP+NUM))fail('seam-step',owner,{polygon:[p]});return y;
}
function edgeSection(edge,node,budget){
 budget.take(1,node.id);
 return edge.sections[edge.a===node.id?0:1];
}
function finitePortSection(port,edge,node,budget){
 const {a,b}=edgeSection(edge,node,budget);
 budget.take(1,node.id);
 const origin=qpoint(a),direction=qvector(qpoint(b),origin),denominator=qdot(direction,direction),witnesses=[];
 for(const point of port.witness){
  budget.take(1,node.id);
  const delta=qvector(qpoint([point[0],point[2]]),origin),parameter=qdiv(qdot(delta,direction),denominator),t=roundedFraction(parameter);
  if(!Number.isFinite(t))fail('precision',node.id,{peerId:port.id});
  witnesses.push({parameter,t,y:point[1]});
 }
 witnesses.sort((l,r)=>{budget.take(1,node.id);return qcompare(l.parameter,r.parameter)||l.y-r.y;});
 if(qcompare(witnesses[0].parameter,QZERO)>0||qcompare(witnesses.at(-1).parameter,QONE)<0)fail('port-width',node.id,{peerId:port.id,polygon:[a,b]});
 return {a,b,witnesses};
}
function crossSillProfile(section,port,node,budget){
 const {witnesses}=section,intervals=[];
 for(let i=1;i<witnesses.length;i++){
  budget.take(1,node.id);
  const l=witnesses[i-1],r=witnesses[i],order=qcompare(l.parameter,r.parameter);
  if(order===0){
   if(Math.abs(r.y-l.y)>STEP+NUM)fail('seam-step',node.id,{peerId:port.id});
   continue;
  }
  const lower=qcompare(l.parameter,QZERO)<0?QZERO:l.parameter;
  const upper=qcompare(r.parameter,QONE)>0?QONE:r.parameter;
  if(qcompare(lower,upper)>=0)continue;
  const lo=roundedFraction(lower),hi=roundedFraction(upper);
  if(!(hi>lo)||!(r.t>l.t))fail('precision',node.id,{peerId:port.id});
  budget.take(1,node.id);
  const from=exactNumber(l.y),rise=qsub(exactNumber(r.y),from),span=qsub(r.parameter,l.parameter);
  const heightAtExact=parameter=>roundedFraction(qadd(from,qmul(rise,qdiv(qsub(parameter,l.parameter),span))));
  intervals.push({lo,hi,loExact:lower,hiExact:upper,heightAtExact});
 }
 // Full coverage is a prerequisite to comparison. Intersecting two incomplete
 // lists is never evidence that the requested physical cross-section exists.
 requireFullProfile(intervals,section.a,section.b,node.id,budget,'port-width',port.id);
 return intervals;
}
function profileHeight(profile,parameter,budget,owner){
 budget.take(1,owner);
 return profile.heightAtExact(parameter);
}
function validatePortUse(node,incident,budget){
 for(const port of node.ports){
  if(port.kind==='serve'&&incident.length!==1)fail('port-face',node.id,{peerId:port.id});
  let outside=false;for(const edge of incident){
   if(edge.width>port.width)fail('port-width',node.id,{peerId:port.id,value:edge.width,limit:port.width});
   const other=edge.a===node.id?edge.end:edge.start,d=sub(other,node.xz),unit=d.map(v=>v/length(d)),normal=[port.normal[0],port.normal[2]],alignment=dot(unit,normal);
   if(Math.abs(cross(unit,normal))>1e-6||port.kind==='serve'&&alignment<1-1e-6)fail('port-face',node.id,{peerId:port.id});
   edge.portSections.set(port,finitePortSection(port,edge,node,budget));
   if(alignment>1-1e-6)outside=true;
  }
  if(!outside)fail('port-face',node.id,{peerId:port.id});
 }
}
function validateArrivalGraph(nodeIds,edges,startId,gateId,budget){
 budget.take(nodeIds.size+edges.length,budget.owner);
 const adjacency=new Map([...nodeIds].map(nodeId=>[nodeId,[]]));
 for(const edge of edges){adjacency.get(edge.a).push(edge.b);adjacency.get(edge.b).push(edge.a);}
 const visited=new Set([startId]),queue=[startId];
 for(let i=0;i<queue.length;i++)for(const next of adjacency.get(queue[i])){
  budget.take(1,queue[i]);
  if(!visited.has(next)){visited.add(next);queue.push(next);}
 }
 for(const nodeId of [gateId,...[...nodeIds].sort(cmp)])if(!visited.has(nodeId))fail('disconnected',nodeId);
}
function qualifyFootprint(site,member,footprint,budget){
 budget.take(1,member.id);
 const min=site.layout.metadata?.minFeature;
 if(Number.isFinite(min)&&segments(footprint).some(([a,b])=>distance(a,b)<min))fail('precision',member.id,{polygon:footprint});
 let allowed;
 try{allowed=site.layout.footprintAllowed({level:site.level,regionId:member.regionId,polygon:footprint,clearance:CLEAR});}
 catch(error){
  if(error instanceof Error&&/^footprint:.*(short edge|zero area|self intersection)/.test(error.message))fail('precision',member.id,{polygon:footprint});
  throw error;
 }
 if(!allowed)fail('region',member.id,{polygon:footprint});
}
function solveMembers(n,index,frameTransform,budget){
 const {site}=n,obstacles=[...n.blocks],members=[];
 for(const m of n.members){
  const xz=frameTransform(m.uv),rotationY=n.frame.yawRadians+m.yawRadians,transform=rigid(xz,rotationY),footprint=canonical(boxRing(m.prototype.envelope).map(transform));footprint.flat().forEach(v=>number(v,'member world footprint'));
  qualifyFootprint(site,m,footprint,budget);
  for(const peer of members){budget.take(1,m.id);if(rectanglesOverlap(footprint,peer.footprint)||clip(footprint,peer.footprint,budget,m.id).length)fail('occupied',m.id,{peerId:peer.id,polygon:footprint});}
  for(const solid of n.solids){budget.take(1,m.id);if(clip(footprint,expanded(solid.polygon,CLEAR,null,budget,m.id),budget,m.id).length)fail('occupied',m.id,{peerId:solid.id,polygon:footprint});}
  let supportMinY=Infinity,supportMaxY=-Infinity,offsetMinY=Infinity,offsetMaxY=-Infinity;
  for(const bearing of m.prototype.bearings){
   const ring=canonical(bearing.ring.map(transform)),proof=cover(ring,[m.bearingHost],m.id,index,budget,'bearing');supportMinY=Math.min(supportMinY,proof.minY);supportMaxY=Math.max(supportMaxY,proof.maxY);
   offsetMinY=Math.min(offsetMinY,proof.minY-bearing.bottomY);offsetMaxY=Math.max(offsetMaxY,proof.maxY-bearing.bottomY);
  }
  if(offsetMaxY-offsetMinY>TILT+NUM)fail('bearing-tilt',m.id,{value:offsetMaxY-offsetMinY,limit:TILT,polygon:footprint});
  const y=number((offsetMinY+offsetMaxY)/2,'member world y');
  const envelope=m.prototype.envelope;
  number(y+envelope[1],'member world lower bound');number(y+envelope[4],'member world upper bound');
  for(const block of n.blocks){budget.take(1,m.id);if(block.id===m.bearingHost&&block.yMax<=supportMinY+NUM)continue;if(block.yMax>y+envelope[1]-CLEAR&&block.yMin<y+envelope[4]+CLEAR&&clip(footprint,expanded(block.polygon,CLEAR,null,budget,m.id),budget,m.id).length)fail('occupied',m.id,{peerId:block.id,polygon:footprint});}
  const worldPorts=m.prototype.ports.map(port=>({
   id:port.id,kind:port.kind,
   anchorPosition:worldPoint(transform,port.position,y),
   servicePosition:worldPoint(transform,port.servicePosition,y),
   standingPosition:null,
   witness:port.witness.map(point=>worldPoint(transform,point,y)),
   normal:worldPoint(rigid([0,0],rotationY),port.normal,0),
   width:port.width,facePartId:port.facePartId,memberId:m.id
  }));
  members.push({id:m.id,prototypeId:m.prototypeId,position:[xz[0],y,xz[1]],rotationY,footprint,worldPorts,bearingHost:m.bearingHost,supportMinY,supportMaxY});
  for(const part of m.prototype.parts)obstacles.push({id:JSON.stringify([m.id,part.id]),sourceKind:'member-part',memberId:m.id,partId:part.id,polygon:canonical(boxRing(part.box).map(transform)),yMin:y+part.box[1],yMax:y+part.box[4]});
 }
 for(const s of n.solids)obstacles.push({...s,sourceKind:'reserved-solid',yMin:-512,yMax:512});
 return {members,obstacles};
}
function makeWalkCandidate(n,members,frameTransform,budget){
 const nodes=n.nodes.map(node=>{
  if(node.uv){budget.take(1,node.id);return {id:node.id,uv:node.uv,xz:frameTransform(node.uv),ports:[]};}
  budget.take(members.length+n.members.length,node.id);
  const m=members.find(m=>m.id===node.memberId),source=n.members.find(m=>m.id===node.memberId);
  budget.take(m.worldPorts.length+source.prototype.ports.length+4,node.id);
  const p=m.worldPorts.find(p=>p.id===node.portId),local=source.prototype.ports.find(p=>p.id===node.portId);
  // Preserve the validated recipe-local source alongside the actual world
  // anchor and registered port. Arrival world measurements have no such UV.
  const uv=rigid(source.uv,source.yawRadians)([local.position[0],local.position[2]]);
  return {id:node.id,uv,xz:[p.anchorPosition[0],p.anchorPosition[2]],ports:[p]};
 });
 const gate=nodes.find(x=>x.id===n.gateId);if(distance(gate.xz,[n.gatePort.position[0],n.gatePort.position[2]])>2e-5)invalid('arrival gate and recipe gate XZ mismatch');
 gate.ports.push({...n.gatePort,anchorPosition:n.gatePort.position,declaredY:n.gatePort.position[1]});
 nodes.push({id:n.startId,xz:[n.sourcePort.position[0],n.sourcePort.position[2]],ports:[{...n.sourcePort,anchorPosition:n.sourcePort.position,declaredY:n.sourcePort.position[1]}]});
 for(const node of n.arrivalNodes)nodes.push({id:node.id,xz:[node.position[0],node.position[2]],ports:[],declaredY:node.position[1]});
 nodes.sort((a,b)=>cmp(a.id,b.id));nodes.forEach(n=>n.xz.forEach(v=>number(v,'node world coordinate')));const nodeMap=new Map(nodes.map(v=>[v.id,v]));
 budget.take(1,n.id);
 const rotate=rigid([0,0],n.frame.yawRadians);
 const adjacency=new Map(nodes.map(v=>[v.id,[]])),edges=n.edges.map(e=>{
  budget.take(1,e.key);
  const a=nodeMap.get(e.a),b=nodeMap.get(e.b),start=a.xz,end=b.xz,d=sub(end,start),len=length(d);
  if(len<MIN)invalid('authored physical edge length below .015m',true);
  let tangent,uvAxis=null;
  if(a.uv&&b.uv){
   // Equal-width collinear UV strips need identical caps even at different
   // lengths. Reduce to the same exact component ratio before rounding and yaw.
   uvAxis=qvector(qpoint(b.uv),qpoint(a.uv));
   const [ux,uz]=uvAxis,scale=qcompare(qmul(ux,ux),qmul(uz,uz))>=0?ux:uz;
   if(scale.n===0n)fail('precision',e.key);
   const sign=scale.n<0n?-1:1;
   const [x,z]=uvAxis.map(q=>sign*roundedFraction(qdiv(q,scale))),norm=Math.hypot(x,z);
   tangent=rotate([-z/norm,x/norm]);
  }else tangent=[-d[1]/len,d[0]/len];
  budget.take(2,e.key);
  const h=e.width/2,sections=[start,end].map(([x,z])=>({
   a:[x-tangent[0]*h,z-tangent[1]*h],b:[x+tangent[0]*h,z+tangent[1]*h]
  }));
  const [first,last]=sections,polygon=canonical([first.b,first.a,last.a,last.b]);polygon.flat().forEach(v=>number(v,'route world coordinate'));
  budget.take(1,e.key);
  const out={...e,start,end,tangent,uvAxis,sections,polygon,portSections:new Map()};adjacency.get(e.a).push(out);adjacency.get(e.b).push(out);return out;
 });
 return {nodes,nodeMap,edges,adjacency};
}
function qualifyStraightDomains(walk,index,obstacles,budget){
 const {nodes,nodeMap,edges,adjacency}=walk;
 for(const node of nodes)validatePortUse(node,adjacency.get(node.id),budget);
 for(const edge of edges){
  const proof=cover(edge.polygon,edge.hostIds,edge.key,index,budget),ports=[...nodeMap.get(edge.a).ports,...nodeMap.get(edge.b).ports];edge.proof=proof;
  edge.minHeadroom=obstruct(edge.polygon,proof,obstacles,edge.hostIds,edge.headroom,edge.key,budget,ports);
 }
}
// Only exact UV parallel/perpendicular incidence in this rigid frame establishes
// that the strip cap endpoints belong to the authored maximum-width turn square.
function authoredTurnAxes(incident,budget,owner){
 const axis=incident[0].uvAxis;if(!axis)return false;
 let turns=false;
 for(let i=1;i<incident.length;i++){
  budget.take(1,owner);
  const peer=incident[i].uvAxis;if(!peer)return false;
  if(qdot(axis,peer).n===0n)turns=true;
  else if(qcross(axis,peer).n!==0n)return false;
 }
 return turns;
}
// Monotone convex hull of the four square corners and their actual interfaces.
// Only represented extrema are kept; no offset or angular tolerance is applied.
function turnHull(square,incident,node,budget){
 budget.take(square.length+2*incident.length,node.id);
 const points=square.slice();
 for(const edge of incident){
  const {a,b}=edgeSection(edge,node,budget);points.push(a,b);
 }
 points.sort((a,b)=>{budget.take(1,node.id);return a[0]-b[0]||a[1]-b[1];});
 const chain=(start,step)=>{
  budget.take(points.length,node.id);
  const out=[];
  for(let i=start;i>=0&&i<points.length;i+=step){
   for(;out.length>=2;out.pop()){
    budget.take(1,node.id);
    if(orientSign(out.at(-2),out.at(-1),points[i])>0)break;
   }
   out.push(points[i]);
  }
  out.pop();return out;
 };
 const lower=chain(0,1),upper=chain(points.length-1,-1);
 budget.take(lower.length+upper.length,node.id);
 return lower.concat(upper);
}
function qualifyTurnDomains(walk,index,obstacles,budget){
 const {nodes,adjacency}=walk;
 // Turn squares are aligned with the actual incident directions, including a
 // world yaw. Their surface proof uses only the explicit incident host union.
 for(const node of nodes){
  const incident=adjacency.get(node.id);if(incident.length<2)continue;
  const directions=incident.map(e=>{const v=sub(e.a===node.id?e.end:e.start,node.xz);return v.map(x=>x/length(v));});
  for(let i=0;i<directions.length;i++)for(let j=0;j<i;j++){
   budget.take(1,node.id);const d=dot(directions[i],directions[j]);if(Math.abs(d)>1e-6&&Math.abs(d+1)>1e-6)fail('port-face',node.id,{peerId:incident[i].key,value:d});
  }
  const straight=incident.length===2&&Math.abs(dot(directions[0],directions[1])+1)<=1e-6&&incident[0].width===incident[1].width;
  let turn=null;
  if(!straight){
   budget.take(1,node.id);
   const authored=authoredTurnAxes(incident,budget,node.id);
   const width=Math.max(...incident.map(e=>e.width)),h=width/2,u=authored?incident[0].tangent:directions[0],v=[-u[1],u[0]];
   const square=canonical([[-h,-h],[h,-h],[h,h],[-h,h]].map(([a,b])=>[node.xz[0]+a*u[0]+b*v[0],node.xz[1]+a*u[1]+b*v[1]]));
   const poly=authored?turnHull(square,incident,node,budget):square;
   const hostIds=[...new Set(incident.flatMap(e=>e.hostIds))].sort(cmp),headroom=Math.max(...incident.map(e=>e.headroom));
   turn=cover(poly,hostIds,node.id,index,budget,'walk',poly.length>square.length);obstruct(poly,turn,obstacles,hostIds,headroom,node.id,budget);
  }
  for(const edge of incident){
   const {a,b}=edgeSection(edge,node,budget);
   const left=profile(a,b,edge.proof,node.id,budget),other=turn??incident.find(e=>e!==edge).proof,right=profile(a,b,other,node.id,budget);edge.proof.maxStep=Math.max(edge.proof.maxStep,compareProfiles(a,b,left,right,node.id,budget));
  }
 }
}
function qualifyStandingSections(walk,required,budget){
 const {nodes,adjacency}=walk;
 // Validate actual standing levels and cross-sill height over the whole width.
 for(const node of nodes){
  const incident=adjacency.get(node.id);if(!incident.length&&(node.ports.length||required.includes(node.id)))fail('disconnected',node.id);
  let firstY=null;
  for(const edge of incident){
   const standing=atPoint(node.xz,edge.proof,node.id,budget);if(firstY===null)firstY=standing;else if(Math.abs(firstY-standing)>STEP+NUM)fail('seam-step',node.id,{value:Math.abs(firstY-standing),limit:STEP});
   if(node.declaredY!==undefined&&Math.abs(node.declaredY-standing)>STEP+NUM)fail('seam-step',node.id,{value:Math.abs(node.declaredY-standing),limit:STEP});
   for(const port of node.ports){
    if(port.declaredY!==undefined&&Math.abs(port.declaredY-standing)>STEP+NUM)fail('seam-step',node.id,{peerId:port.id,value:Math.abs(port.declaredY-standing),limit:STEP});
    if(port.kind==='serve'){
     const relative=port.servicePosition[1]-standing;if(relative< -NUM||relative>2.1+NUM)fail('port-face',node.id,{peerId:port.id,value:relative,limit:2.1});
    }else{
     const section=edge.portSections.get(port),{a,b}=section;
     const actual=profile(a,b,edge.proof,node.id,budget),sill=crossSillProfile(section,port,node,budget);
     compareProfiles(a,b,actual,sill,node.id,budget);if(Math.abs(port.servicePosition[1]-standing)>STEP+NUM)fail('seam-step',node.id,{peerId:port.id,value:Math.abs(port.servicePosition[1]-standing),limit:STEP});
    }
    if(port.memberId){const y=port.standingPosition?.[1];if(y!==undefined&&Math.abs(y-standing)>STEP+NUM)fail('seam-step',node.id,{peerId:port.id});if(port.standingPosition===null)port.standingPosition=[node.xz[0],standing,node.xz[1]];}
   }
  }
 }
}
function qualifyReserves(n,index,frameTransform,obstacles,budget){
 const reserves=n.reserves.map(r=>{
  const polygon=canonical(r.polygon.map(frameTransform));polygon.flat().forEach(v=>number(v,'reserve world coordinate'));const proof=cover(polygon,r.hostIds,r.id,index,budget);obstruct(polygon,proof,obstacles,r.hostIds,2.1,r.id,budget);return {id:r.id,polygon,hostIds:r.hostIds};
 });
 return reserves;
}
function completeSnapshot(n,members,walk,reserves,budget){
 const {site}=n,{edges,adjacency}=walk;
 const from=new Map([[n.gateId,[]]]),queue=[n.gateId];for(let i=0;i<queue.length;i++){
  const k=queue[i];for(const edge of adjacency.get(k)){budget.take(1,k);const next=edge.a===k?edge.b:edge.a;if(!from.has(next)){from.set(next,[...from.get(k),edge.key]);queue.push(next);}}
 }
 for(const target of [n.startId,...n.required])if(!from.has(target))fail('disconnected',target);
 return {id:n.id,level:site.level,regionId:site.regionId,groupId:site.groupId,lotId:site.lotId,edgeId:site.edgeId,frame:n.frame,
  members:members.map(m=>({...m,worldPorts:m.worldPorts.map(({facePartId,memberId,...p})=>p)})),
  routes:edges.map(e=>({a:e.a,b:e.b,width:e.width,polygon:e.polygon,hostIds:e.hostIds,faceIds:e.proof.faceIds,minHeadroom:e.minHeadroom,maxGrade:e.proof.maxGrade,maxStep:e.proof.maxStep})),reserves,chains:n.required.map(nodeId=>({nodeId,fromGate:from.get(nodeId)})),linkEdges:edges.map(e=>e.key)};
}
function qualifyNormalized(n,budget){
 const index=makeIndex(n.hosts,budget);
 const frameTransform=rigid(n.frame.origin,n.frame.yawRadians);
 const {members,obstacles}=solveMembers(n,index,frameTransform,budget);
 const walk=makeWalkCandidate(n,members,frameTransform,budget);
 qualifyStraightDomains(walk,index,obstacles,budget);
 qualifyTurnDomains(walk,index,obstacles,budget);
 qualifyStandingSections(walk,n.required,budget);
 const reserves=qualifyReserves(n,index,frameTransform,obstacles,budget);
 return completeSnapshot(n,members,walk,reserves,budget);
}

export function qualifyActivityCourt(input){
 plain(input,'input');const limits=input.limits===undefined?{}:plain(input.limits,'limits');if(Reflect.ownKeys(limits).some(k=>k!=='maxPairs'))invalid('unknown runtime limit');
 const max=limits.maxPairs===undefined?1000000:limits.maxPairs;if(!Number.isInteger(max)||max<1||max>4000000)invalid('maxPairs integer in 1..4000000 required',true);
 const budget=new Budget(max,input.id);let identity=input.id;
 try{const n=normalize(input,budget);identity=n.id;const snapshot=qualifyNormalized(n,budget);return frozen({status:'complete',id:identity,snapshot,diagnostics:{spentPairs:budget.spent,reasons:[]}});}
 catch(error){if(!(error instanceof Failure))throw error;return frozen({status:'unsatisfied',id:identity,snapshot:null,diagnostics:{spentPairs:budget.spent,reasons:[error.reason]}});}
}
