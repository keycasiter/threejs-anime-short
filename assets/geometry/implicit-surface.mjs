/** Bounded negative-inside scalar field extraction using injected official MC.
 * The field may be an SDF or any continuous scalar field; isoValue defaults to 0.
 * resolution is the total padded grid size. Authored bounds map to indices
 * 1..resolution-2, with one extra gradient sample outside on each face.
 * Boundary lattice samples must be strictly outside. No finite lattice can prove
 * that an arbitrary callback lacks sub-voxel components or crossings between samples.
 */
export function createImplicitSurfaceSource(T,{MarchingCubes}={}, {field,bounds,resolution=32,isoValue=0,maxTriangles=100000}={}) {
  if(typeof MarchingCubes!=='function')throw new TypeError('Inject the same-version official MarchingCubes addon');
  if(typeof field!=='function')throw new TypeError('field must be a finite scalar function');
  if(!bounds||!['min','max'].every(k=>Array.isArray(bounds[k])&&bounds[k].length===3&&bounds[k].every(Number.isFinite))||bounds.min.some((v,i)=>v>=bounds.max[i]))throw new TypeError('bounds needs finite ordered min/max xyz');
  if(!Number.isInteger(resolution)||resolution<8||resolution>64)throw new RangeError('resolution must be integer 8..64 (bounded temporary extraction memory)');
  if(!Number.isFinite(isoValue))throw new RangeError('isoValue must be finite');
  if(!Number.isInteger(maxTriangles)||maxTriangles<1||maxTriangles>2000000)throw new RangeError('maxTriangles must be integer 1..2000000');
  const min=[...bounds.min],max=[...bounds.max],n=resolution,step=min.map((v,i)=>(max[i]-v)/(n-3)),samples=new Float32Array(n**3);
  if(!step.every(v=>Number.isFinite(v)&&v>0))throw new RangeError('bounds sampling step exceeds numeric range');
  let minimum=Infinity,maximum=-Infinity;
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const value=field(min[0]+(x-1)*step[0],min[1]+(y-1)*step[1],min[2]+(z-1)*step[2]);
    if(!Number.isFinite(value)||!Number.isFinite(Math.fround(isoValue-value)))throw new RangeError(`field must be finite in Float32 range at grid ${x},${y},${z}`);
    const f=Math.fround(isoValue-value); // Official MC positive-inside convention.
    samples[z*n*n+y*n+x]=f;minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);
    // MC extracts only cells 1..n-3. Require a closed exterior lattice shell.
    if(x>=1&&x<=n-2&&y>=1&&y<=n-2&&z>=1&&z<=n-2&&(x===1||y===1||z===1||x===n-2||y===n-2||z===n-2)&&f>=0)throw new RangeError('Surface touches/crosses sampled bounds boundary; expand bounds to avoid truncation');
  }
  // At most 5 MC triangles/cell: allocate this proven bound, never let the addon
  // silently overrun its arrays. Check the caller's output budget after extraction.
  // At resolution 64 this temporary buffer is ~82MB; callers needing more should
  // tile with explicit overlap and seam policy rather than exhaust browser memory.
  const capacity=5*(n-3)**3,material=new T.MeshBasicMaterial();let mc,geometry;
  try{
    mc=new MarchingCubes(n,material,false,false,capacity);
    if(!(mc.geometry instanceof T.BufferGeometry))throw new TypeError('MarchingCubes must use the same THREE runtime');
    mc.isolation=0;mc.field.set(samples);mc.update();
    if(mc.count===0)throw new RangeError('Empty sampled implicit surface; expand bounds or increase resolution for unsampled features');
    if(!Number.isInteger(mc.count)||mc.count%3||mc.count/3>capacity)throw new RangeError('MarchingCubes capacity contract violated');
    if(mc.count/3>maxTriangles)throw new RangeError(`Triangle capacity exceeded: ${mc.count/3} > maxTriangles ${maxTriangles}`);
    const rawP=mc.geometry.attributes.position.array,rawN=mc.geometry.attributes.normal.array,positions=new Float32Array(mc.count*3),normals=new Float32Array(mc.count*3),uvs=new Float32Array(mc.count*2);
    for(let i=0;i<mc.count;i++){
      const normal=new T.Vector3();
      for(let axis=0;axis<3;axis++){
        // MC local p=(gridIndex-n/2)/(n/2), then map into caller bounds.
        positions[i*3+axis]=min[axis]+((rawP[i*3+axis]+1)*n/2-1)*step[axis];
        normal.setComponent(axis,rawN[i*3+axis]/step[axis]);
      }
      if(!normal.toArray().every(Number.isFinite)||normal.lengthSq()===0)throw new RangeError('Degenerate implicit gradient; revise field or sampling');
      normal.normalize();normals.set(normal.toArray(),i*3);uvs[i*2]=positions[i*3];uvs[i*2+1]=positions[i*3+2];
    }
    if(!positions.every(Number.isFinite))throw new RangeError('Implicit positions exceed Float32 precision');
    // Official output can contain zero-area triangles when iso exactly hits grid
    // vertices. Reject explicitly instead of returning invalid attachment geometry.
    for(let i=0;i<mc.count;i+=3){const a=new T.Vector3().fromArray(positions,i*3),b=new T.Vector3().fromArray(positions,(i+1)*3).sub(a),c=new T.Vector3().fromArray(positions,(i+2)*3).sub(a),scale=b.lengthSq()*c.lengthSq();if(scale===0||b.clone().cross(c).lengthSq()<=scale*1e-24)throw new RangeError('Degenerate or Float32-collapsed implicit triangle; revise resolution or isoValue');}
    geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));geometry.setAttribute('normal',new T.BufferAttribute(normals,3));geometry.setAttribute('uv',new T.BufferAttribute(uvs,2));geometry.computeBoundingBox();geometry.computeBoundingSphere();
    let disposed=false;
    return {geometry,metadata:{kind:'implicit-surface',algorithm:'official-MarchingCubes',resolution:n,samples:n**3,triangles:mc.count/3,isoValue,bounds:{min,max},step,fieldRange:[minimum,maximum],boundaryPolicy:'reject-nonpositive-boundary-lattice',temporaryTriangleCapacity:capacity,uvProjection:'world-xz'},dispose(){if(!disposed){disposed=true;geometry.dispose();}}};
  }catch(error){geometry?.dispose();throw error;}finally{mc?.geometry.dispose();material.dispose();}
}
