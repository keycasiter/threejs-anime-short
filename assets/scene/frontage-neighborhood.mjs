// Mixed measured prototypes along a compiled road graph. No Three/WebGL resources.
import {rectanglesOverlap} from './corridor-layout.mjs';
import {createRandomStreams} from '../runtime/random-streams.mjs';
const LIMIT=100000,MIN=1e-5,EPS=1e-8;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function value(x,name,min=-LIMIT,max=LIMIT){if(!Number.isFinite(x)||x<min||x>max)throw new Error(`${name}: finite value in ${min}..${max} required`);return x;}
function integer(x,name,min,max){value(x,name,min,max);if(!Number.isInteger(x))throw new Error(`${name}: integer required`);return x;}
function id(x,name='id'){if(typeof x!=='string'||!x.trim()||x.length>512)throw new Error(`${name}: nonempty string <=512 characters required`);return x;}
function array(x,name,min,max){if(!Array.isArray(x)||x.length<min||x.length>max)throw new Error(`${name}: dense array of ${min}..${max} items required`);for(let i=0;i<x.length;i++)if(!Object.hasOwn(x,i))throw new Error(`${name}: sparse array unsupported`);return x;}
function unique(xs,name){if(new Set(xs).size!==xs.length)throw new Error(`duplicate ${name} ID`);}
function vector(x,name){return array(x,name,3,3).map(v=>value(v,name));}
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
function copySpec(input){let count=0;const seen=new Set();function copy(x,depth){if(++count>4096||depth>12)throw new Error('spec exceeds 4096 values / depth 12');if(x===null||typeof x==='string'||typeof x==='boolean')return x;if(typeof x==='number')return value(x,'spec number');if(!x||typeof x!=='object'||seen.has(x))throw new Error('spec must be acyclic JSON data');seen.add(x);let out;if(Array.isArray(x))out=array(x,'spec array',0,4096).map(v=>copy(v,depth+1));else{if(Object.getPrototypeOf(x)!==Object.prototype&&Object.getPrototypeOf(x)!==null)throw new Error('spec must contain plain objects');out=Object.fromEntries(Object.entries(x).map(([k,v])=>[k,copy(v,depth+1)]));}seen.delete(x);return out;}return copy(input,0);}
function normalizePrototype(p){
 id(p?.id,'prototype id');const f=p.footprint;if(!f||typeof f!=='object')throw new Error('prototype footprint required');
 const footprint=Object.fromEntries(['minX','maxX','minZ','maxZ'].map(k=>[k,value(f[k],`footprint.${k}`)]));
 const frontage=footprint.maxX-footprint.minX,depth=footprint.maxZ-footprint.minZ;value(frontage,'frontage',MIN,LIMIT);value(depth,'depth',MIN,LIMIT);
 const position=vector(p.entrance?.position,'entrance.position'),normal=vector(p.entrance?.normal,'entrance.normal');
 if(normal[0]!==0||normal[1]!==0||normal[2]!==1)throw new Error('entrance.normal must be local +Z [0,0,1]');
 if(position[0]<footprint.minX||position[0]>footprint.maxX||position[2]<footprint.minZ||position[2]>footprint.maxZ)throw new Error('entrance must lie within the complete XZ footprint');
 return {id:p.id,footprint,frontage,depth,entrance:{position,normal},...(p.spec===undefined?{}:{spec:copySpec(p.spec)})};
}
const bounds=polygon=>({minX:Math.min(...polygon.map(p=>p[0])),maxX:Math.max(...polygon.map(p=>p[0])),minZ:Math.min(...polygon.map(p=>p[1])),maxZ:Math.max(...polygon.map(p=>p[1]))});
const aabbOverlap=(a,b)=>a.minX<b.maxX-EPS&&a.maxX>b.minX+EPS&&a.minZ<b.maxZ-EPS&&a.maxZ>b.minZ+EPS;
// Mirror only the two numerical ring gates exposed by world minFeature. A rigid
// transform at the inclusive local minimum can round a world edge below that gate.
// Measure the unchanged world polygon; never expand/round geometry to force a fit.
function precisionFailure(polygon,minFeature){
 let minEdgeLength=Infinity,twiceArea=0;const origin=polygon[0];
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length];
  minEdgeLength=Math.min(minEdgeLength,Math.hypot(b[0]-a[0],b[1]-a[1]));
  twiceArea+=(a[0]-origin[0])*(b[1]-origin[1])-(a[1]-origin[1])*(b[0]-origin[0]);
 }
 const area=Math.abs(twiceArea/2);
 if(minEdgeLength<minFeature||area<minFeature*minFeature)return {reason:minEdgeLength<minFeature?'short-edge':'zero-area',minEdgeLength,area,minFeature};
 return null;
}
function neighborIndex(cellSize){
 const cells=new Map();
 function keys(b){const out=[];for(let x=Math.floor(b.minX/cellSize);x<=Math.floor(b.maxX/cellSize);x++)for(let z=Math.floor(b.minZ/cellSize);z<=Math.floor(b.maxZ/cellSize);z++)out.push(`${x}/${z}`);return out;}
 return {overlap(p,b){const checked=new Set();for(const k of keys(b))for(const item of cells.get(k)??[]){if(checked.has(item))continue;checked.add(item);if(aabbOverlap(b,item.bounds)&&rectanglesOverlap(p,item.polygon))return true;}return false;},add(polygon,b){const item={polygon,bounds:b};for(const k of keys(b)){if(!cells.has(k))cells.set(k,[]);cells.get(k).push(item);}}};
}
function poseCandidate({region,edge,side,slot,group,prototype:p,t,y,setback}){
 const ux=(edge.end[0]-edge.start[0])/edge.length,uz=(edge.end[1]-edge.start[1])/edge.length;
 const ox=-uz*side,oz=ux*side,fx=-ox,fz=-oz,xx=fz,xz=-fx,f=p.footprint;
 const centerX=(f.minX+f.maxX)/2,offset=edge.width/2+setback+f.maxZ;
 const position=[edge.start[0]+ux*t+ox*offset-xx*centerX,y,edge.start[1]+uz*t+oz*offset-xz*centerX];
 const transform=([x,localY,z])=>[position[0]+xx*x+fx*z,position[1]+localY,position[2]+xz*x+fz*z];
 const footprint=[[f.minX,0,f.minZ],[f.maxX,0,f.minZ],[f.maxX,0,f.maxZ],[f.minX,0,f.maxZ]].map(v=>{const w=transform(v);return [w[0],w[2]];});
 const entrancePosition=transform(p.entrance.position),projection=(entrancePosition[0]-edge.start[0])*ux+(entrancePosition[2]-edge.start[1])*uz;
 const roadPoint=[edge.start[0]+ux*projection+ox*edge.width/2,y,edge.start[1]+uz*projection+oz*edge.width/2];
 return {id:JSON.stringify([region.level,region.id,edge.id,side,slot]),regionId:region.id,role:region.role,prototypeId:p.id,edgeId:edge.id,side,slot,groupId:JSON.stringify([region.level,region.id,edge.id,side,group]),pose:{position,rotationY:Math.atan2(fx,fz)},footprint,frontage:p.frontage,depth:p.depth,entrance:{position:entrancePosition,normal:[fx,0,fz],roadPoint,distance:Math.hypot(entrancePosition[0]-roadPoint[0],entrancePosition[2]-roadPoint[2])},...(p.spec===undefined?{}:{spec:p.spec})};
}

/**
 * Finite greedy frontage pass, not a coverage/visual-quality guarantee.
 * layout must be actual compileWorldLayout output. Footprints include all overhangs.
 * groupGap is extra spacing between groups, in addition to gap between slots.
 */
export function compileFrontageNeighborhood({layout,level,prototypes,familiesByRole,seed=1,gap=1,setback=1,endClearance=3,maxCandidates=4096,groupSizeRange=[2,3],groupGap=gap}={}){
 // Validate all public freedoms before building lanes or attempting qualification.
 value(gap,'gap',0);value(setback,'setback',0);value(endClearance,'endClearance',0);integer(maxCandidates,'maxCandidates',1,16384);
 array(groupSizeRange,'groupSizeRange',2,2);const groupMin=integer(groupSizeRange[0],'groupSizeRange minimum',1,64),groupMax=integer(groupSizeRange[1],'groupSizeRange maximum',groupMin,64);value(groupGap,'groupGap',0);
 const streams=createRandomStreams(seed);id(level,'level');
 if(!layout||typeof layout.footprintAllowed!=='function')throw new Error('actual compileWorldLayout output required');
 array(layout.levels,'layout.levels',1,16);array(layout.regions,'layout.regions',0,128);
 const minFeature=value(layout.metadata?.minFeature,'layout.metadata.minFeature',Number.MIN_VALUE,LIMIT);
 unique(layout.levels.map(l=>id(l?.id,'layout level')),'level');unique(layout.regions.map(r=>id(r?.id,'layout region')),'region');
 const selected=layout.levels.find(l=>l.id===level);if(!selected)throw new Error('unknown level');value(selected.y,'level.y');array(selected.edges,'level edges',0,128);
 unique(selected.edges.map(e=>id(e?.id,'edge')),'edge');
 for(const e of selected.edges){array(e.start,'edge.start',2,2).forEach(v=>value(v,'edge.start'));array(e.end,'edge.end',2,2).forEach(v=>value(v,'edge.end'));value(e.length,'edge.length',MIN,2*LIMIT*Math.SQRT2);value(e.width,'edge.width',MIN);if(Math.abs(Math.hypot(e.end[0]-e.start[0],e.end[1]-e.start[1])-e.length)>EPS*Math.max(1,e.length))throw new Error('edge length disagrees with endpoints');}
 const ps=array(prototypes,'prototypes',1,128).map(normalizePrototype).sort((a,b)=>cmp(a.id,b.id));unique(ps.map(p=>p.id),'prototype');const prototypeMap=new Map(ps.map(p=>[p.id,p]));
 if(!familiesByRole||typeof familiesByRole!=='object'||Array.isArray(familiesByRole)||![Object.prototype,null].includes(Object.getPrototypeOf(familiesByRole)))throw new Error('familiesByRole must be a plain role map');
 const entries=Object.entries(familiesByRole);if(entries.length>128)throw new Error('familiesByRole supports <=128 roles');
 const families=new Map(entries.map(([role,ids])=>{id(role,'role');array(ids,`family ${role}`,1,128);const sorted=ids.map(p=>id(p,'family prototype')).sort(cmp);unique(sorted,'family prototype');for(const p of sorted)if(!prototypeMap.has(p))throw new Error(`unknown prototype ${p}`);return [role,sorted];}));
 const regions=layout.regions.filter(r=>r.level===level&&r.role!=='forbidden').sort((a,b)=>cmp(a.id,b.id));
 const skippedRegions=regions.filter(r=>!families.has(r.role)).map(r=>({regionId:r.id,role:r.role,reason:'unmapped-role'}));
 const edges=[...selected.edges].sort((a,b)=>cmp(a.id,b.id)),lanes=[];
 for(const region of regions)if(families.has(region.role))for(const edge of edges)for(const side of [-1,1])lanes.push({region,edge,side});
 const lots=[],residual=[],precisionFailures=[],rejections={regionOrRoad:0,neighbor:0,coordinate:0,precision:0},neighbors=neighborIndex(Math.max(...ps.map(p=>Math.max(p.frontage,p.depth))));let candidates=0,exhausted=false;
 for(const lane of lanes){
  const {region,edge,side}=lane,key=JSON.stringify([level,region.id,edge.id,side]);
  const order=[...families.get(region.role)],selection=streams.stream(key,'prototype-order'),rhythm=streams.stream(key,'group-rhythm');
  for(let i=order.length-1;i>0;i--){const j=Math.floor(selection()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  let cursor=endClearance,slot=0,group=0,groupRemaining=0,laneExhausted=false;
  const end=edge.length-endClearance;
  while(cursor<end-EPS){
   if(groupRemaining===0){if(slot){cursor+=groupGap;group++;}groupRemaining=groupMin+Math.floor(rhythm()*(groupMax-groupMin+1));}
   const prototype=prototypeMap.get(order[group%order.length]);
   if(cursor+prototype.frontage>end+EPS)break;
   // A nonfitting tail is complete even when the preceding candidate used the budget.
   if(candidates>=maxCandidates){exhausted=true;laneExhausted=true;break;}
   // No retry/jitter loop; every attempted full envelope consumes the global budget.
   candidates++;
   const lot=poseCandidate({...lane,slot,group,prototype,t:cursor+prototype.frontage/2,y:selected.y,setback});
   const b=bounds(lot.footprint),precision=precisionFailure(lot.footprint,minFeature);
   if([...lot.pose.position,...lot.footprint.flat(),...lot.entrance.position,...lot.entrance.roadPoint].some(x=>!Number.isFinite(x)||Math.abs(x)>LIMIT))rejections.coordinate++;
   else if(precision){rejections.precision++;precisionFailures.push({id:lot.id,regionId:lot.regionId,edgeId:lot.edgeId,side:lot.side,slot:lot.slot,prototypeId:lot.prototypeId,footprint:lot.footprint,...precision});}
   else if(!layout.footprintAllowed({level,regionId:region.id,polygon:lot.footprint,clearance:setback}))rejections.regionOrRoad++;
   else if(neighbors.overlap(lot.footprint,b))rejections.neighbor++;
   else{lots.push(lot);neighbors.add(lot.footprint,b);}
   cursor+=prototype.frontage+gap;slot++;groupRemaining--;
  }
  residual.push({regionId:region.id,edgeId:edge.id,side,remainingLength:Math.max(0,end-cursor),reason:laneExhausted?'budget':'end'});
 }
 return freeze({level,lots,diagnostics:{status:exhausted?'budget-exhausted':'complete',candidates,accepted:lots.length,rejections,precisionFailures,residual,skippedRegions,maxCandidates}});
}
