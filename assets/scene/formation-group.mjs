import {FORMATION_ATTRIBUTE,invariantArray} from '../geometry/formation-coordinates.mjs';

// Extract one semantic group for the core/context bake. The source tangent is
// deliberately omitted: these paths use scalar materials or rebuild final tangents.
const sizes=new Map([['position',3],['normal',3],['uv',2],[FORMATION_ATTRIBUTE,3]]);
export function copyFormationGroup(T,source,{start,count}) {
  const p=source.getAttribute('position'),index=source.index,elements=index?.count??p.count;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start<0 || start%3 || count<3 ||
      count%3 || start+count>elements) throw new RangeError('Invalid triangle group range');
  for (const name of Object.keys(source.attributes)) {
    if (name!=='tangent' && !sizes.has(name)) throw new TypeError('Unsupported group attribute: '+name);
  }
  const copy=new T.BufferGeometry();
  try {
    const fields=[];
    for (const [name,size] of sizes) {
      const attr=source.getAttribute(name);
      const data=name===FORMATION_ATTRIBUTE?invariantArray(T,attr,name,size,p.count):null;
      if (!attr) continue;
      if (attr.itemSize!==size || attr.count!==p.count) throw new TypeError('Invalid group attribute layout: '+name);
      const out=new T.BufferAttribute(new Float32Array(count*size),size);
      copy.setAttribute(name,out);fields.push({attr,size,data,output:out.array});
    }
    for (let i=0;i<count;i++) {
      const v=index?index.getX(start+i):start+i;
      if (!Number.isSafeInteger(v) || v<0 || v>=p.count) throw new RangeError('Group index out of bounds');
      for (const {attr,size,data,output} of fields) for (let c=0;c<size;c++) {
        output[i*size+c]=data ? data[v*size+c] : attr.getComponent(v,c);
      }
    }
    return copy;
  } catch (error) {copy.dispose();throw error;}
}
