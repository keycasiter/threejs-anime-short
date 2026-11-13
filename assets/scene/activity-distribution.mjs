import {rectanglesOverlap} from './corridor-layout.mjs';

const EPS=1e-8,MAX_GROUPS=256,MAX_CANDIDATES=16384,MAX_FOOTPRINTS=4096,MAX_PAIRS=1000000,MAX_PAYLOAD_NODES=65536;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const fail=message=>{throw new TypeError(`activity-distribution: ${message}`);};
const dense=(array,name)=>{for(let i=0;i<array.length;i++)if(!Object.hasOwn(array,i))fail(`${name} must be dense`);};
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;}
function clonePayload(value,budget,path='payload',active=new WeakSet(),depth=0){
 if(++budget.nodes>budget.max)fail(`${path} exceeds maxPayloadNodes (${budget.max})`);
 if(depth>64)fail(`${path} exceeds payload depth 64`);
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))fail(`${path} must contain finite numbers`);return value;}
 if(!value||typeof value!=='object')fail(`${path} must contain only JSON-like data`);
 if(active.has(value))fail(`${path} must not contain cycles`);
 active.add(value);
 try{
  if(Array.isArray(value)){
   if(value.length>MAX_CANDIDATES)fail(`${path} array exceeds ${MAX_CANDIDATES} entries`);
   dense(value,path);return value.map((item,i)=>clonePayload(item,budget,`${path}[${i}]`,active,depth+1));
  }
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)fail(`${path} must contain plain objects`);
  const keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=='string'))fail(`${path} keys must be strings`);
  const result={};
  for(const key of keys.sort(cmp)){
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))fail(`${path}.${key} must be an enumerable data property`);
   result[key]=clonePayload(descriptor.value,budget,`${path}.${key}`,active,depth+1);
  }
  return result;
 }finally{active.delete(value);}
}
const finite=(v,name,min=-Infinity,max=Infinity)=>{
 if(!Number.isFinite(v)||v<min||v>max)fail(`${name} must be finite in [${min}, ${max}]`);
 return v;
};
const identifier=(v,name)=>{
 if(typeof v!=='string'||v.length<1||v.length>128)fail(`${name} must be a nonempty string up to 128 characters`);
 return v;
};
function convexPolygon(input,name){
 if(!Array.isArray(input)||input.length<3||input.length>256)fail(`${name} requires 3..256 convex vertices`);
 dense(input,name);
 const polygon=input.map((p,i)=>{
  if(!Array.isArray(p)||p.length!==2)return fail(`${name}[${i}] must be [x,z]`);
  dense(p,`${name}[${i}]`);
  return p.map((v,k)=>finite(v,`${name}[${i}][${k}]`,-512,512));
 });
 let sign=0;
 for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length],c=polygon[(i+2)%polygon.length];
  const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
  if(Math.abs(cross)<=EPS)continue;
  if(sign&&Math.sign(cross)!==sign)fail(`${name} must be convex and nondegenerate`);
  sign=Math.sign(cross);
 }
 if(!sign)fail(`${name} must have positive area`);
 return polygon;
}
function normalize(groups,layout,limits){
 if(!layout||typeof layout.footprintAllowed!=='function')fail('compiled world layout required');
 if(!Array.isArray(groups)||groups.length>limits.maxGroups)fail(`groups must be an array of at most ${limits.maxGroups}`);
 dense(groups,'groups');
 const groupIds=new Set();let candidateCount=0,footprintCount=0;
 const records=groups.map((group,gi)=>{
  if(!group||typeof group!=='object'||Array.isArray(group))fail(`groups[${gi}] must be an object`);
  const id=identifier(group.id,`groups[${gi}].id`);if(groupIds.has(id))fail(`duplicate group id ${id}`);groupIds.add(id);
  const priority=finite(group.priority??0,`${id}.priority`),required=group.required!==false;
  if(!Array.isArray(group.candidates)||group.candidates.length<1)fail(`${id}.candidates must be nonempty`);
  dense(group.candidates,`${id}.candidates`);
  candidateCount+=group.candidates.length;if(candidateCount>limits.maxCandidates)fail(`maxCandidates exceeded (${candidateCount} > ${limits.maxCandidates})`);
  const candidateIds=new Set();
  const candidates=group.candidates.map((candidate,ci)=>{
   if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))fail(`${id}.candidates[${ci}] must be an object`);
   const candidateId=identifier(candidate.id,`${id}.candidates[${ci}].id`);if(candidateIds.has(candidateId))fail(`${id} has duplicate candidate id ${candidateId}`);candidateIds.add(candidateId);
   if(!Array.isArray(candidate.footprints)||candidate.footprints.length<1)fail(`${candidateId}.footprints must be nonempty`);
   dense(candidate.footprints,`${candidateId}.footprints`);
   footprintCount+=candidate.footprints.length;if(footprintCount>limits.maxFootprints)fail(`maxFootprints exceeded (${footprintCount} > ${limits.maxFootprints})`);
   const footprints=candidate.footprints.map((footprint,fi)=>{
    const path=`${candidateId}.footprints[${fi}]`;
    if(!footprint||typeof footprint!=='object'||Array.isArray(footprint))fail(`${path} must be an object`);
    const minY=finite(footprint.minY,`${path}.minY`,-512,512),maxY=finite(footprint.maxY,`${path}.maxY`,-512,512);
    if(!(maxY>minY))fail(`${path} requires maxY > minY`);
    return {id:identifier(footprint.id,`${path}.id`),level:identifier(footprint.level,`${path}.level`),regionId:identifier(footprint.regionId,`${path}.regionId`),polygon:convexPolygon(footprint.polygon,`${path}.polygon`),minY,maxY,clearance:finite(footprint.clearance??0,`${path}.clearance`,0,64),clearanceY:finite(footprint.clearanceY??0,`${path}.clearanceY`,0,64)};
   });
   return {id:candidateId,order:finite(candidate.order??ci,`${candidateId}.order`),...(Object.hasOwn(candidate,'payload')?{payload:candidate.payload}:{}),footprints};
  });
  candidates.sort((a,b)=>a.order-b.order||cmp(a.id,b.id));
  return {id,priority,required,candidates};
 });
 records.sort((a,b)=>b.priority-a.priority||cmp(a.id,b.id));
 return {records,candidateCount,footprintCount};
}
function conflicts(a,b){
 if(a.level!==b.level)return false;
 const verticalMargin=a.clearanceY+b.clearanceY;
 if(a.maxY+verticalMargin<=b.minY+EPS||b.maxY+verticalMargin<=a.minY+EPS)return false;
 if(a.clearance===0&&b.clearance===0)return rectanglesOverlap(a.polygon,b.polygon);
 const separate=(p,q,margin)=>{
  for(let i=0;i<p.length;i++){
   const a=p[i],b=p[(i+1)%p.length],axis=[-(b[1]-a[1]),b[0]-a[0]],length=Math.hypot(...axis);
   if(length<=EPS)continue;
   axis[0]/=length;axis[1]/=length;
   let p0=Infinity,p1=-Infinity,q0=Infinity,q1=-Infinity;
   for(const v of p){const d=v[0]*axis[0]+v[1]*axis[1];p0=Math.min(p0,d);p1=Math.max(p1,d);}
   for(const v of q){const d=v[0]*axis[0]+v[1]*axis[1];q0=Math.min(q0,d);q1=Math.max(q1,d);}
   if(p1+margin<=q0+EPS||q1+margin<=p0+EPS)return true;
  }
  return false;
 };
 return !(separate(a.polygon,b.polygon,a.clearance+b.clearance)||separate(b.polygon,a.polygon,a.clearance+b.clearance));
}

/**
 * Selects one pre-authored candidate for each activity group against a real
 * compiled world layout. It does not invent poses, measure meshes, or certify
 * routes; those are upstream responsibilities. A candidate supplies complete
 * convex physical/reserved envelopes and vertical ranges, then the chosen
 * payload can be passed to the geometry and activity qualification stages.
 * Required-group failure is transactional: no partial assignments are returned.
 */
export function allocateActivityGroups({layout,groups,limits={}}={}){
 const budget={maxGroups:limits.maxGroups??MAX_GROUPS,maxCandidates:limits.maxCandidates??MAX_CANDIDATES,maxFootprints:limits.maxFootprints??MAX_FOOTPRINTS,maxPairs:limits.maxPairs??MAX_PAIRS,maxPayloadNodes:limits.maxPayloadNodes??MAX_PAYLOAD_NODES};
 for(const [key,value]of Object.entries(budget))if(!Number.isSafeInteger(value)||value<1)fail(`${key} must be a positive integer`);
 const {records}=normalize(groups,layout,budget),accepted=[],assignments=[],unassignedGroupIds=[],diagnostics=[];let pairs=0;
 for(const group of records){
  let chosen=null;
  for(const candidate of group.candidates){
   let reason=null,conflictingGroupId=null;
   for(const footprint of candidate.footprints){
    if(!layout.footprintAllowed({level:footprint.level,regionId:footprint.regionId,polygon:footprint.polygon,clearance:footprint.clearance})){
     reason='outside-region';break;
    }
    for(const prior of accepted){
     for(const occupied of prior.footprints){
      pairs++;if(pairs>budget.maxPairs)fail(`maxPairs exceeded (${pairs} > ${budget.maxPairs})`);
      if(conflicts(footprint,occupied)){reason='group-overlap';conflictingGroupId=prior.groupId;break;}
     }
     if(reason)break;
    }
    if(reason)break;
   }
   if(reason){diagnostics.push({groupId:group.id,candidateId:candidate.id,code:reason,...(conflictingGroupId?{conflictingGroupId}:{})});continue;}
   chosen=candidate;break;
  }
  if(!chosen){unassignedGroupIds.push(group.id);if(group.required)diagnostics.push({groupId:group.id,code:'required-group-unassigned'});continue;}
  const selected={groupId:group.id,candidateId:chosen.id,...(chosen.payload===undefined?{}:{payload:clonePayload(chosen.payload,{nodes:0,max:budget.maxPayloadNodes},`${group.id}/${chosen.id}.payload`)}),footprints:chosen.footprints.map(({id,level,regionId,polygon,minY,maxY,clearance,clearanceY})=>({id,level,regionId,polygon:polygon.map(p=>[...p]),minY,maxY,clearance,clearanceY}))};
  assignments.push(selected);accepted.push({groupId:group.id,footprints:chosen.footprints});
 }
 const failed=unassignedGroupIds.some(id=>records.find(g=>g.id===id)?.required);
 return deepFreeze({status:failed?'unsatisfied':'complete',assignments:failed?[]:assignments,unassignedGroupIds,diagnostics,stats:{groups:records.length,candidates:records.reduce((n,g)=>n+g.candidates.length,0),footprints:records.reduce((n,g)=>n+g.candidates.reduce((m,c)=>m+c.footprints.length,0),0),pairs}});
}
