/** Assign geometry-local triangle semantics without rebuilding or reordering buffers.
 * Predicates receive a read-only base-position sample, not world/deformed vertices.
 * All groups are replaced only after the complete stream has validated and matched.
 */
export function assignMaterialRegions(T, options) {
  if(!options||typeof options!=='object'||Array.isArray(options))throw Error('options must be an object');
  for(const key of Object.keys(options))if(!['geometry','regions','fallback'].includes(key))throw Error(`Unknown option: ${key}`);
  const {geometry,regions,fallback}=options;
  if(!geometry?.isBufferGeometry)throw Error('geometry must be a THREE.BufferGeometry');
  if(!Array.isArray(regions)||regions.length===0)throw Error('regions must be a nonempty array');
  const ids=new Set(),validId=id=>typeof id==='string'&&id.trim().length>0;
  const rules=regions.map(region=>{
    if(!region||typeof region!=='object'||Array.isArray(region)||Object.keys(region).some(k=>!['id','match'].includes(k))||!validId(region.id)||typeof region.match!=='function')throw Error('each region needs a nonempty id and match function');
    if(ids.has(region.id))throw Error(`Duplicate region id: ${region.id}`);
    ids.add(region.id);return {id:region.id,match:region.match};
  });
  if(fallback!==undefined){
    if(!validId(fallback)||ids.has(fallback))throw Error('fallback must be a distinct nonempty region id');
    ids.add(fallback);
  }
  const position=geometry.getAttribute('position'),index=geometry.getIndex();
  if(!position||position.itemSize!==3||!Number.isSafeInteger(position.count)||position.count===0)throw Error('position must contain xyz vertices');
  for(let i=0;i<position.count;i++)if(![position.getX(i),position.getY(i),position.getZ(i)].every(Number.isFinite))throw Error(`Nonfinite position at vertex ${i}`);
  if(index&&(index.itemSize!==1||index.normalized||!Number.isSafeInteger(index.count)))throw Error('index must be an unnormalized scalar triangle index');
  const count=index?index.count:position.count;
  if(!Number.isSafeInteger(count)||count===0||count%3!==0)throw Error('geometry must contain complete triangles');
  if(index)for(let i=0;i<count;i++)if(!Number.isSafeInteger(index.getX(i))||index.getX(i)<0||index.getX(i)>=position.count)throw Error(`Invalid index at ${i}`);
  if(geometry.drawRange.start!==0||!(geometry.drawRange.count===Infinity||geometry.drawRange.count===count))throw Error('partial or excessive drawRange is ambiguous; provide the full triangle stream');
  const triangleCount=count/3,source=new Array(triangleCount).fill(undefined);
  if(geometry.groups.length){
    for(const group of geometry.groups){
      const {start,count:groupCount,materialIndex}=group;
      if(!Number.isSafeInteger(start)||start<0||start%3!==0||!Number.isSafeInteger(groupCount)||groupCount<=0||groupCount%3!==0||start+groupCount>count||!Number.isSafeInteger(materialIndex)||materialIndex<0)throw Error('source groups must cover complete triangles with valid material indices');
      for(let i=start/3;i<(start+groupCount)/3;i++){
        if(source[i]!==undefined)throw Error('source groups overlap');
        source[i]=materialIndex;
      }
    }
    if(source.some(materialIndex=>materialIndex===undefined))throw Error('source groups leave triangles uncovered');
  }else source.fill(0);
  const slots=[...ids].map((id,materialIndex)=>({id,materialIndex,triangleCount:0,area:0})),groups=[];
  let totalArea=0;
  for(let triangleIndex=0;triangleIndex<triangleCount;triangleIndex++){
    const start=triangleIndex*3,indices=[0,1,2].map(offset=>index?index.getX(start+offset):start+offset);
    const vertices=indices.map(i=>new T.Vector3(position.getX(i),position.getY(i),position.getZ(i)));
    const [a,b,c]=vertices,normal=new T.Vector3().subVectors(b,a).cross(new T.Vector3().subVectors(c,a));
    const length=Math.hypot(normal.x,normal.y,normal.z),area=length*.5;
    // Divide each term before adding to keep finite centroids for large coordinates.
    const centroid=new T.Vector3(a.x/3+b.x/3+c.x/3,a.y/3+b.y/3+c.y/3,a.z/3+b.z/3+c.z/3);
    if(!Number.isFinite(area)||!centroid.toArray().every(Number.isFinite))throw Error(`Triangle ${triangleIndex} exceeds numeric range`);
    // Vector3.divideScalar multiplies by 1/length, which overflows for subnormals.
    if(area>0)normal.set(normal.x/length,normal.y/length,normal.z/length);else normal.set(0,0,0);
    vertices.forEach(Object.freeze);Object.freeze(normal);Object.freeze(centroid);
    const sample=Object.freeze({triangleIndex,indices:Object.freeze(indices),vertices:Object.freeze(vertices),centroid,normal,area,sourceMaterialIndex:source[triangleIndex]});
    let materialIndex=-1;
    for(let i=0;i<rules.length;i++){
      const matched=rules[i].match(sample);
      if(typeof matched!=='boolean')throw Error(`Region ${rules[i].id} must return a boolean for triangle ${triangleIndex}`);
      if(matched){if(materialIndex!==-1)throw Error(`Conflicting regions at triangle ${triangleIndex}`);materialIndex=i;}
    }
    if(materialIndex===-1){
      if(fallback===undefined)throw Error(`No region matched triangle ${triangleIndex}`);
      materialIndex=slots.length-1;
    }
    const slot=slots[materialIndex];slot.triangleCount++;slot.area+=area;totalArea+=area;
    if(!Number.isFinite(totalArea)||!Number.isFinite(slot.area))throw Error('Accumulated triangle area exceeds numeric range');
    const last=groups[groups.length-1];
    if(last?.materialIndex===materialIndex)last.count+=3;else groups.push({start,count:3,materialIndex});
  }
  geometry.clearGroups();
  for(const {start,count:groupCount,materialIndex} of groups)geometry.addGroup(start,groupCount,materialIndex);
  return {slots,triangleCount,area:totalArea,groupCount:groups.length};
}
