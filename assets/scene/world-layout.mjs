// Bounded planar arrangement; pure data, no Three/WebGL resources.
import { compileCorridorGraph } from './corridor-layout.mjs';
const LIMIT=100000, MIN=1e-5, EPS=1e-8, ROUND_SEGMENTS=24;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const dist=(a,b)=>Math.hypot(...sub(a,b));
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const area=r=>r.reduce((s,p,i)=>s+cross(sub(p,r[0]),sub(r[(i+1)%r.length],r[0])),0)/2;
const segments=r=>r.map((p,i)=>[p,r[(i+1)%r.length]]);
function number(x,name){if(!Number.isFinite(x)||Math.abs(x)>LIMIT)throw new Error(`${name}: finite coordinate/value within ±${LIMIT} required`);return x;}
function id(x){if(typeof x!=='string'||!x.length)throw new Error('nonempty string id required');return x;}
function width(x){number(x,'width');if(x<MIN)throw new Error(`width must be >= ${MIN}`);return x;}
function unique(xs,name){if(new Set(xs.map(x=>x.id)).size!==xs.length)throw new Error(`duplicate ${name} id`);}
function freeze(x){if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
function pointSegment(p,a,b){const v=sub(b,a),t=Math.max(0,Math.min(1,(sub(p,a)[0]*v[0]+sub(p,a)[1]*v[1])/(v[0]*v[0]+v[1]*v[1])));return dist(p,lerp(a,b,t));}
// All intersection parameters on AB, including collinear overlap endpoints.
function cuts(a,b,c,d){const r=sub(b,a),s=sub(d,c),q=sub(c,a),den=cross(r,s),lr=dist(a,b),ls=dist(c,d);
 if(Math.abs(den)>EPS*lr*ls){const t=cross(q,s)/den,u=cross(q,r)/den;return t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS?[Math.max(0,Math.min(1,t))]:[];}
 if(Math.abs(cross(q,r))>EPS*lr)return [];
 const rr=r[0]*r[0]+r[1]*r[1],t0=(q[0]*r[0]+q[1]*r[1])/rr,t1=t0+(s[0]*r[0]+s[1]*r[1])/rr;
 const lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(1,Math.max(t0,t1));return lo<=hi+EPS?[Math.max(0,lo),Math.min(1,hi)]:[];
}
function location(p,r){if(segments(r).some(([a,b])=>pointSegment(p,a,b)<=EPS))return 0;let inside=false;for(const [a,b]of segments(r))if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;return inside?1:-1;}
function canonical(r,ccw){let out=r.map(p=>[...p]);if((area(out)>0)!==ccw)out.reverse();let k=0;for(let i=1;i<out.length;i++)if(out[i][0]<out[k][0]||out[i][0]===out[k][0]&&out[i][1]<out[k][1])k=i;return [...out.slice(k),...out.slice(0,k)];}
function ring(input,name,ccw=true){if(!Array.isArray(input)||input.length<3||input.length>256)throw new Error(`${name}: 3..256 unclosed polygon vertices required`);const r=input.map(p=>{if(!Array.isArray(p)||p.length!==2)throw new Error(`${name}: [x,z] points required`);return p.map(v=>number(v,name));});
 for(let i=0;i<r.length;i++){if(dist(r[i],r[(i+1)%r.length])<MIN)throw new Error(`${name}: repeated/short edge`);for(let j=0;j<i;j++){if(j===i-1||i===r.length-1&&j===0)continue;if(cuts(r[i],r[(i+1)%r.length],r[j],r[(j+1)%r.length]).length)throw new Error(`${name}: self intersection`);}}
 if(Math.abs(area(r))<MIN*MIN)throw new Error(`${name}: zero area`);return canonical(r,ccw);
}
function ringDistance(a,b){let best=Infinity;for(const [p,q]of segments(a))for(const [r,s]of segments(b)){if(cuts(p,q,r,s).length)return 0;best=Math.min(best,pointSegment(p,r,s),pointSegment(q,r,s),pointSegment(r,p,q),pointSegment(s,p,q));}return best;}
function overlap(a,b){return ringDistance(a,b)<=EPS||location(a[0],b)>=0||location(b[0],a)>=0;}
function contained(a,b){if(a.some(p=>location(p,b)<0))return false;for(const [p,q]of segments(a)){const ts=[0,1,...segments(b).flatMap(([r,s])=>cuts(p,q,r,s))].sort((a,b)=>a-b);for(let i=1;i<ts.length;i++)if(location(lerp(p,q,(ts[i-1]+ts[i])/2),b)<0)return false;}return true;}
function normalizeRegion(r,levels){id(r.id);if(!levels.has(r.level))throw new Error(`region ${r.id}: unknown level`);id(r.role);if(r.holes!==undefined&&(!Array.isArray(r.holes)||r.holes.length>32))throw new Error('region holes must be an array of <=32 rings');const outline=ring(r.outline,`region ${r.id}`),holes=(r.holes??[]).map((h,i)=>ring(h,`region ${r.id} hole ${i}`,false));
 for(let i=0;i<holes.length;i++){if(!contained(holes[i],outline)||ringDistance(holes[i],outline)<=EPS)throw new Error(`region ${r.id}: hole must be strictly inside outline`);for(let j=0;j<i;j++)if(overlap(holes[i],holes[j]))throw new Error(`region ${r.id}: overlapping/nested holes`);}
 holes.sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b)));return {id:r.id,level:r.level,outline,holes,role:r.role};
}
// Exact infinitesimal side classification for convex CCW primitives. This avoids
// offset probes skipping narrow slivers. Coordinates closer than EPS are rejected
// if they make a non-manifold boundary; no rasterization or stacked junction faces.
function onSide(p,d,poly,sign){for(const [a,b]of segments(poly)){const v=sub(b,a),value=cross(v,sub(p,a)),tol=EPS*Math.hypot(...v);if(value < -tol)return false;if(Math.abs(value)<=tol&&cross(v,[-d[1]*sign,d[0]*sign]) < -EPS*Math.hypot(...v)*Math.hypot(...d))return false;}return true;}
function polygonUnion(polys){if(!polys.length)return [];const edges=polys.flatMap(p=>segments(p).map(([a,b])=>({a,b,ts:[0,1]})));if(edges.length>2048)throw new Error('road arrangement exceeds 2048 primitive edges');
 for(let i=0;i<edges.length;i++)for(let j=0;j<i;j++){const a=edges[i],b=edges[j];a.ts.push(...cuts(a.a,a.b,b.a,b.b));b.ts.push(...cuts(b.a,b.b,a.a,a.b));}
 const key=p=>p.map(x=>Math.round(x/EPS)).join(','),vertices=new Map(),boundary=new Map();
 const intern=p=>{const k=key(p);if(!vertices.has(k))vertices.set(k,p);return k;};
 for(const e of edges){const ts=[...new Set(e.ts)].sort((a,b)=>a-b);for(let i=1;i<ts.length;i++){const a=lerp(e.a,e.b,ts[i-1]),b=lerp(e.a,e.b,ts[i]);if(dist(a,b)<=EPS)continue;const mid=lerp(a,b,.5),d=sub(b,a),left=polys.some(p=>onSide(mid,d,p,1)),right=polys.some(p=>onSide(mid,d,p,-1));if(left===right)continue;const p=left?a:b,q=left?b:a,k=intern(p),l=intern(q);if(k===l)throw new Error('unstable road boundary below precision');boundary.set(`${k}/${l}`,{a:k,b:l});}}
 const outgoing=new Map(),incoming=new Map();for(const e of boundary.values()){if(outgoing.has(e.a)||incoming.has(e.b))throw new Error('non-manifold/tangent road boundary; separate or overlap features');outgoing.set(e.a,e.b);incoming.set(e.b,e.a);}
 for(const k of outgoing.keys())if(!incoming.has(k))throw new Error('unstable unclosed road union boundary');
 const loops=[];while(outgoing.size){const first=outgoing.keys().next().value,r=[];let k=first;do{r.push(vertices.get(k));const next=outgoing.get(k);if(next===undefined)throw new Error('unclosed road union');outgoing.delete(k);k=next;}while(k!==first&&r.length<=boundary.size);if(k!==first||r.length<3||Math.abs(area(r))<MIN*MIN)throw new Error('degenerate road union');
  // Remove only collinear boundary subdivision vertices.
  let changed=true;while(changed&&r.length>3){changed=false;for(let i=0;i<r.length;i++){const a=r[(i+r.length-1)%r.length],b=r[i],c=r[(i+1)%r.length];if(Math.abs(cross(sub(b,a),sub(c,b)))<=EPS*dist(a,c)){r.splice(i,1);changed=true;break;}}}loops.push(r);
 }
 const surfaces=loops.filter(r=>area(r)>0).map(r=>({outer:canonical(r,true),holes:[]}));for(const h of loops.filter(r=>area(r)<0)){const candidates=surfaces.filter(s=>location(h[0],s.outer)>0).sort((a,b)=>area(a.outer)-area(b.outer));if(!candidates.length)throw new Error('unassigned road hole');candidates[0].holes.push(canonical(h,false));}
 for(const s of surfaces)s.holes.sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b)));return surfaces.sort((a,b)=>cmp(JSON.stringify(a.outer),JSON.stringify(b.outer)));
}
function roadSurfaces(graph){const polys=graph.edges.map(e=>canonical(e.quad,true));for(const n of graph.junctions)if(n.radius>0)polys.push(Array.from({length:ROUND_SEGMENTS},(_,i)=>[n.x+n.radius*Math.cos(i*2*Math.PI/ROUND_SEGMENTS),n.z+n.radius*Math.sin(i*2*Math.PI/ROUND_SEGMENTS)]));return polygonUnion(polys);}
const graphId=(level,node)=>JSON.stringify([level,node]);
function connections(levels,links){const nodes=levels.flatMap(l=>l.nodes.map(n=>({id:graphId(l.id,n.id),level:l.id,nodeId:n.id,position:[n.x,l.y,n.z]}))),edges=levels.flatMap(l=>l.edges.map(e=>({id:JSON.stringify(['corridor',l.id,e.id]),from:graphId(l.id,e.from),to:graphId(l.id,e.to),kind:'corridor',width:e.width}))).concat(links.map(l=>({id:JSON.stringify(['link',l.id]),from:graphId(l.fromLevel,l.fromNode),to:graphId(l.toLevel,l.toNode),kind:'link',width:l.width})));
 const adj=new Map(nodes.map(n=>[n.id,[]]));for(const e of edges){adj.get(e.from).push(e.to);adj.get(e.to).push(e.from);}const visited=new Set(),components=[];for(const n of nodes)if(!visited.has(n.id)){const stack=[n.id],part=[];visited.add(n.id);while(stack.length){const k=stack.pop();part.push(k);for(const next of adj.get(k))if(!visited.has(next)){visited.add(next);stack.push(next);}}components.push(part.sort(cmp));}return {nodes,edges,components};
}
export function compileWorldLayout({levels,regions,links=[]}={}){
 if(!Array.isArray(levels)||!levels.length||levels.length>16||!Array.isArray(regions)||regions.length>128||!Array.isArray(links)||links.length>128)throw new Error('levels (1..16), regions (<=128), links (<=128) arrays required');
 const compiled=levels.map(l=>{id(l.id);number(l.y,'level.y');if(!Array.isArray(l.nodes)||l.nodes.length>64||!Array.isArray(l.edges)||l.edges.length>128)throw new Error('level supports <=64 nodes / <=128 edges');for(const n of l.nodes){number(n.x,'node.x');number(n.z,'node.z');}for(const e of l.edges)width(e.width);const graph=compileCorridorGraph(l);for(const e of graph.edges)if(e.length<MIN)throw new Error('road length below supported precision');return {id:l.id,y:l.y,...graph,surfaces:roadSurfaces(graph)};}).sort((a,b)=>cmp(a.id,b.id));unique(compiled,'level');const map=new Map(compiled.map(l=>[l.id,l]));
 const rs=regions.map(r=>normalizeRegion(r,map)).sort((a,b)=>cmp(a.id,b.id));unique(rs,'region');
 const ls=links.map(l=>{id(l.id);const from=map.get(l.fromLevel),to=map.get(l.toLevel),a=from?.nodes.find(n=>n.id===l.fromNode),b=to?.nodes.find(n=>n.id===l.toNode);if(!a||!b)throw new Error(`link ${l.id}: unknown level/node endpoint`);if(from.id===to.id)throw new Error(`link ${l.id}: cross-level link required`);return {id:l.id,fromLevel:from.id,fromNode:a.id,toLevel:to.id,toNode:b.id,width:width(l.width),start:[a.x,from.y,a.z],end:[b.x,to.y,b.z]};}).sort((a,b)=>cmp(a.id,b.id));unique(ls,'link');
 const snapshot={levels:compiled.map(l=>({id:l.id,y:l.y,nodes:l.nodes.map(n=>({...n})),edges:l.edges.map(e=>({id:e.id,from:e.from,to:e.to,width:e.width}))})),regions:rs,links:ls.map(({start,end,...l})=>l)};
 const connectionGraph=connections(compiled,ls);freeze(compiled);freeze(rs);freeze(ls);freeze(snapshot);freeze(connectionGraph);
 function footprintAllowed({level,polygon,regionId,clearance=0}={}){if(!map.has(level))throw new Error('footprint: unknown level');number(clearance,'clearance');if(clearance<0)throw new Error('clearance must be nonnegative');const p=ring(polygon,'footprint');let candidates=rs.filter(r=>r.level===level&&r.role!=='forbidden');if(regionId!==undefined){const r=rs.find(r=>r.id===regionId);if(!r||r.level!==level||r.role==='forbidden')throw new Error('footprint: unknown/wrong-level/forbidden regionId');candidates=[r];}
  const fits=r=>contained(p,r.outline)&&(clearance===0||ringDistance(p,r.outline)+EPS>=clearance)&&r.holes.every(h=>!overlap(p,h)&&ringDistance(p,h)+EPS>=clearance);
  if(!candidates.some(fits))return false;
  const blocked=rs.filter(r=>r.level===level&&r.role==='forbidden').map(r=>({outer:r.outline,holes:r.holes})).concat(map.get(level).surfaces);
  for(const s of blocked){if(s.holes.some(h=>contained(p,h)&&ringDistance(p,h)>EPS&&ringDistance(p,h)+EPS>=clearance))continue;if(overlap(p,s.outer)||ringDistance(p,s.outer)<clearance-EPS)return false;}
  return true;
 }
 return Object.freeze({levels:compiled,regions:rs,links:ls,connectionGraph,snapshot,metadata:freeze({roundSegments:ROUND_SEGMENTS,epsilon:EPS,minFeature:MIN,maxCoordinate:LIMIT}),footprintAllowed});
}
