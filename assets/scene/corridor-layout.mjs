// Original planar corridor graph and deterministic frontage packing; no Three dependency.
const finite=(n,name)=>{if(!Number.isFinite(n))throw new Error(`${name} must be finite`);return n;};
const positive=(n,name)=>{finite(n,name);if(n<=0)throw new Error(`${name} must be positive`);return n;};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const pointOn=(a,b,p)=>Math.abs(cross(a,b,p))<1e-8&&p[0]>=Math.min(a[0],b[0])-1e-8&&p[0]<=Math.max(a[0],b[0])+1e-8&&p[1]>=Math.min(a[1],b[1])-1e-8&&p[1]<=Math.max(a[1],b[1])+1e-8;
function intersects(a,b,c,d){return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||pointOn(a,b,c)||pointOn(a,b,d)||pointOn(c,d,a)||pointOn(c,d,b);}
function identity(x){if(typeof x!=='string'||!x.length)throw new Error('nonempty string id required');return x;}
export function compileCorridorGraph({nodes,edges}={}){
 if(!Array.isArray(nodes)||!Array.isArray(edges))throw new Error('nodes and edges arrays required');
 const ns=nodes.map(n=>({id:identity(n.id),x:finite(n.x,'node.x'),z:finite(n.z,'node.z')})).sort((a,b)=>a.id.localeCompare(b.id));
 const map=new Map(ns.map(n=>[n.id,n]));if(map.size!==ns.length)throw new Error('duplicate node id');
 const seen=new Set(),adj=new Map(ns.map(n=>[n.id,new Set()]));
 const es=edges.map(e=>{
  identity(e.id);if(seen.has(e.id))throw new Error('duplicate edge id');seen.add(e.id);
  const a=map.get(e.from),b=map.get(e.to);if(!a||!b)throw new Error('edge endpoint node missing');
  const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<1e-8)throw new Error('edge endpoints must be distinct');positive(e.width,'edge.width');
  const u=[dx/length,dz/length],v=[-u[1],u[0]],h=e.width/2;
  adj.get(a.id).add(b.id);adj.get(b.id).add(a.id);
  return {id:e.id,from:a.id,to:b.id,width:e.width,length,headingRadians:Math.atan2(dz,dx),start:[a.x,a.z],end:[b.x,b.z],quad:[[a.x+v[0]*h,a.z+v[1]*h],[b.x+v[0]*h,b.z+v[1]*h],[b.x-v[0]*h,b.z-v[1]*h],[a.x-v[0]*h,a.z-v[1]*h]]};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 for(let i=0;i<es.length;i++)for(let j=0;j<i;j++){
  const a=es[i],b=es[j],shared=a.from===b.from||a.from===b.to||a.to===b.from||a.to===b.to;
  if(shared){
   const collinear=Math.abs(cross(a.start,a.end,b.start))/a.length<1e-8&&Math.abs(cross(a.start,a.end,b.end))/a.length<1e-8;
   if(collinear){const dx=(a.end[0]-a.start[0])/a.length,dz=(a.end[1]-a.start[1])/a.length,projection=p=>(p[0]-a.start[0])*dx+(p[1]-a.start[1])*dz,lo=Math.min(projection(b.start),projection(b.end)),hi=Math.max(projection(b.start),projection(b.end));if(Math.min(a.length,hi)-Math.max(0,lo)>1e-8)throw new Error(`overlapping edges ${a.id} and ${b.id}; split or remove overlap`);}
   continue;
  }
  if(intersects(a.start,a.end,b.start,b.end))throw new Error(`unsplit intersection between ${a.id} and ${b.id}; split edges at a shared node`);
 }
 const visited=new Set(),components=[];
 for(const n of ns)if(!visited.has(n.id)){const pending=[n.id],component=[];visited.add(n.id);while(pending.length){const id=pending.pop();component.push(id);for(const x of adj.get(id))if(!visited.has(x)){visited.add(x);pending.push(x);}}components.push(component.sort());}
 const junctions=ns.map(n=>({...n,radius:es.reduce((r,e)=>(e.from===n.id||e.to===n.id)?Math.max(r,e.width/2):r,0),degree:adj.get(n.id).size}));
 return {nodes:ns,edges:es,junctions,components};
}
// SAT for convex rectangles. Touching boundaries are allowed (zero intersection area).
export function rectanglesOverlap(a,b){
 for(const ring of [a,b])for(let i=0;i<ring.length;i++){
  const p=ring[i],q=ring[(i+1)%ring.length],axis=[-(q[1]-p[1]),q[0]-p[0]],len=Math.hypot(...axis);if(!len)throw new Error('degenerate rectangle');axis[0]/=len;axis[1]/=len;
  const project=r=>r.map(v=>v[0]*axis[0]+v[1]*axis[1]),pa=project(a),pb=project(b);
  if(Math.max(...pa)<=Math.min(...pb)+1e-8||Math.max(...pb)<=Math.min(...pa)+1e-8)return false;
 }
 return true;
}
export function generateFrontageLots(graph,{frontage=5,depth=6,gap=1,setback=1,endClearance=3,acceptFootprint=()=>true}={}){
 positive(frontage,'frontage');positive(depth,'depth');for(const [key,v] of Object.entries({gap,setback,endClearance})){finite(v,key);if(v<0)throw new Error(`${key} must be nonnegative`);}
 const accepted=[];
 for(const e of [...graph.edges].sort((a,b)=>a.id.localeCompare(b.id))){
  const u=[(e.end[0]-e.start[0])/e.length,(e.end[1]-e.start[1])/e.length],v=[-u[1],u[0]],count=Math.max(0,Math.floor((e.length-2*endClearance+gap)/(frontage+gap))),used=count*frontage+Math.max(0,count-1)*gap;
  for(const side of [-1,1])for(let slot=0;slot<count;slot++){
   const t=(e.length-used)/2+frontage/2+slot*(frontage+gap),off=side*(e.width/2+setback+depth/2),center=[e.start[0]+u[0]*t+v[0]*off,e.start[1]+u[1]*t+v[1]*off];
   const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>[center[0]+a*u[0]*frontage/2+b*v[0]*depth/2,center[1]+a*u[1]*frontage/2+b*v[1]*depth/2]);
   const lot={id:`${e.id}/${side}/${slot}`,edgeId:e.id,side,slot,center,corners,frontage,depth,headingRadians:e.headingRadians};
   if(!acceptFootprint(corners,lot)||graph.edges.some(road=>rectanglesOverlap(corners,road.quad))||accepted.some(other=>rectanglesOverlap(corners,other.corners)))continue;
   accepted.push(lot);
  }
 }
 return accepted;
}
