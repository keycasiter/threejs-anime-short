/** Place a code-generated guest using actual asset-local interface frames.
 * Each asset is {root:Object3D,anchors:Map<string,Matrix4>}. Frame local +Z
 * is outward, local +Y is interface up. Opposed connections rotate 180deg
 * around port Y, making outward normals oppose while preserving interface up.
 *
 * Requires rigid, unit-scale, positive-handed world/parent/anchor transforms;
 * generate dimensions in geometry rather than stretching UVs via root scale.
 * Automatic world-matrix updates must remain enabled throughout the host/parent
 * ancestry and guest subtree; caller-managed world matrices are unsupported.
 * Updates matrices, validates before mutation, then reparents the guest into
 * parent and writes its local TRS. Does not create/release geometry or materials.
 * Aligning interfaces does not establish support, collision or visual quality.
 */
export function placeAtAnchor(T,{host,hostAnchor,guest,guestAnchor,parent=host?.root?.parent,opposed=true}={}) {
  if(!host?.root?.isObject3D||!guest?.root?.isObject3D||host.root===guest.root||!parent?.isObject3D)throw Error('distinct host/guest roots and a parent are required');
  if(typeof opposed!=='boolean')throw Error('opposed must be boolean');
  for(let p=parent;p;p=p.parent)if(p===guest.root)throw Error('cyclic guest parent');
  for(let p=host.root;p;p=p.parent)if(p===guest.root)throw Error('host cannot descend from guest');
  const checked=new Set();
  for(const root of [host.root,parent])for(let p=root;p;p=p.parent)checked.add(p);
  guest.root.traverse(p=>checked.add(p));
  for(const p of checked)if(!p.matrixWorldAutoUpdate)throw Error('automatic world matrix updates are required');
  function rigid(matrix,label){
    if(!matrix?.isMatrix4||!matrix.elements.every(Number.isFinite))throw Error(`${label} must be a finite Matrix4`);
    const e=matrix.elements,axis=[new T.Vector3(e[0],e[1],e[2]),new T.Vector3(e[4],e[5],e[6]),new T.Vector3(e[8],e[9],e[10])];
    if(Math.abs(e[3])+Math.abs(e[7])+Math.abs(e[11])+Math.abs(e[15]-1)>1e-6||
      axis.some(a=>Math.abs(a.length()-1)>1e-6)||Math.abs(axis[0].dot(axis[1]))+Math.abs(axis[0].dot(axis[2]))+Math.abs(axis[1].dot(axis[2]))>1e-6||Math.abs(matrix.determinant()-1)>1e-6)throw Error(`${label} must be rigid with unit scale`);
    return matrix;
  }
  const a=rigid(host.anchors?.get(hostAnchor),'host anchor'),b=rigid(guest.anchors?.get(guestAnchor),'guest anchor');
  host.root.updateWorldMatrix(true,false);parent.updateWorldMatrix(true,false);
  rigid(host.root.matrixWorld,'host world');rigid(parent.matrixWorld,'parent world');
  const local=parent.matrixWorld.clone().invert().multiply(host.root.matrixWorld).multiply(a);
  if(opposed)local.multiply(new T.Matrix4().makeRotationY(Math.PI));
  local.multiply(b.clone().invert());rigid(local,'guest placement');
  // Complete validation before either reparenting or changing local transform.
  const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();local.decompose(p,q,s);
  parent.add(guest.root);guest.root.position.copy(p);guest.root.quaternion.copy(q);guest.root.scale.copy(s);
  guest.root.updateMatrix();guest.root.updateWorldMatrix(false,true);return guest.root;
}
