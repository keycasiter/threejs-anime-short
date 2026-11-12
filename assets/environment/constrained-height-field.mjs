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
