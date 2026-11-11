import {createAssetAssembly} from '../scene/asset-assembly.mjs';
import {createPerforatedPlate} from '../geometry/profile-surfaces.mjs';

/**
 * Original mechanism sample: metres, Y up, +Z front, asset origin at the base centre.
 * Dimensions describe the shell envelope; the front handle and open door extend beyond it.
 * Materials remain caller-owned. dispose() also releases this factory's dynamic geometry.
 */
export function buildHingedCabinet(THREE, {
  mergeGeometries, materials, width=1.2, height=1.8, depth=.6, open=0
} = {}) {
  for (const [name,value] of Object.entries({width,height,depth})) {
    if (!Number.isFinite(value) || value < .2 || value > 10) throw new RangeError(`${name} must be 0.2..10 metres`);
  }
  if (height < width*.65 || height > width*4 || depth < width*.2 || depth > width*1.25) {
    throw new RangeError('Cabinet proportions leave insufficient panel, hinge or internal clearance');
  }
  for (const name of ['shell','trim','interior']) {
    if (!materials?.[name]?.isMaterial) throw new TypeError(`materials.${name} must be a Three.js material`);
  }
  function validOpen(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('open must be a number in 0..1');
  }
  validOpen(open);
  const t=Math.min(width,height,depth)*.015, frame=4*t, gap=1.8*t, base=height*.05;
  const bodyHeight=height-base, doorWidth=width-2*(frame+gap), doorHeight=bodyHeight-2*(frame+gap);
  if (doorWidth < 20*t || doorHeight < 30*t || depth < 12*t) throw new RangeError('Panel and hardware clearances overlap');
  const a=createAssetAssembly(THREE,{mergeGeometries}), ownedDynamic=new Set();
  const pivot=new THREE.Group();pivot.name='door-pivot';
  pivot.position.set(-width/2+frame+gap,base+frame+gap,depth/2+t*.5);

  function metreUV(geometry) {
    const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
    // Face projection keeps one UV unit equal to one metre as panel dimensions change.
    for(let i=0;i<p.count;i++) {
      const x=Math.abs(n.getX(i)),y=Math.abs(n.getY(i)),z=Math.abs(n.getZ(i));
      if (z>=x && z>=y) uv.setXY(i,p.getX(i),p.getY(i));
      else if (x>=y) uv.setXY(i,p.getZ(i),p.getY(i));
      else uv.setXY(i,p.getX(i),p.getZ(i));
    }
    return geometry;
  }
  function staticBox(size,position,material) {
    const geometry=metreUV(new THREE.BoxGeometry(...size));
    try {a.add(geometry,material,{matrix:new THREE.Matrix4().makeTranslation(...position)});}
    finally {geometry.dispose();}
  }
  function movingMesh(geometry,material,name,position=[0,0,0]) {
    ownedDynamic.add(geometry);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;
    mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;pivot.add(mesh);
    return mesh;
  }
  function movingBox(size,position,name) {
    return movingMesh(metreUV(new THREE.BoxGeometry(...size)),materials.trim,name,position);
  }

  let finished;
  try {
    const shell=materials.shell,trim=materials.trim,interior=materials.interior;
    for(const sign of [-1,1])staticBox([t,bodyHeight,depth],[sign*(width-t)/2,base+bodyHeight/2,0],shell);
    for(const y of [base+t/2,height-t/2])staticBox([width-2*t,t,depth],[0,y,0],shell);
    staticBox([width-2*t,bodyHeight-2*t,t],[0,base+bodyHeight/2,-(depth-t)/2],shell);
    staticBox([width-4*t,t,depth-4*t],[0,base+bodyHeight*.48,-t*.5],interior);

    for(const sign of [-1,1])staticBox([frame,bodyHeight,2*t],[sign*(width-frame)/2,base+bodyHeight/2,depth/2-t],trim);
    for(const y of [base+frame/2,height-frame/2])staticBox([width-2*frame,frame,2*t],[0,y,depth/2-t],trim);
    staticBox([width,base*.55,depth],[0,base*.725,0],trim);
    for(const x of [-1,1])for(const z of [-1,1])staticBox(
      [frame*1.5,base*.45,frame*1.5],[x*(width/2-frame),base*.225,z*(depth/2-frame)],trim);

    const slotWidth=doorWidth*.55,slotHeight=doorHeight*.025;
    const holes=[.65,.72,.79].map(level=>[
      [(doorWidth-slotWidth)/2,doorHeight*level-slotHeight/2],
      [(doorWidth+slotWidth)/2,doorHeight*level-slotHeight/2],
      [(doorWidth+slotWidth)/2,doorHeight*level+slotHeight/2],
      [(doorWidth-slotWidth)/2,doorHeight*level+slotHeight/2]
    ]);
    const door=createPerforatedPlate(THREE,{
      outline:[[0,0],[doorWidth,0],[doorWidth,doorHeight],[0,doorHeight]],holes,depth:t,
      bevel:{size:t*.12,thickness:t*.12,segments:2}
    });
    movingMesh(metreUV(door),shell,'service-door');
    const handleX=doorWidth*.86,handleY=doorHeight*.45,standOff=4*t,handleSpan=doorHeight*.15;
    for(const sign of [-1,1])movingBox([2*t,2*t,standOff],[handleX,handleY+sign*handleSpan/2,t+standOff/2],`handle-post-${sign}`);
    movingBox([2*t,handleSpan+2*t,2*t],[handleX,handleY,t+standOff+t],'handle-grip');
    // Parent the live attachment to the door so consumers inherit opening and asset-root transforms.
    const serviceAnchor=new THREE.Object3D();serviceAnchor.name='service-anchor';
    serviceAnchor.position.set(handleX,handleY,t+standOff);pivot.add(serviceAnchor);

    for(const [index,level] of [.18,.5,.82].entries()) {
      const y=doorHeight*level,hingeHeight=doorHeight*.055;
      const barrel=new THREE.CylinderGeometry(1.3*t,1.3*t,hingeHeight,12);
      // Cylindrical wrap uses circumference rather than the primitive's normalized UV interval.
      const uv=barrel.getAttribute('uv'),normal=barrel.getAttribute('normal'),position=barrel.getAttribute('position');
      for(let i=0;i<uv.count;i++) {
        if(Math.abs(normal.getY(i))>.5)uv.setXY(i,position.getX(i),position.getZ(i));
        else uv.setXY(i,uv.getX(i)*Math.PI*2*1.3*t,uv.getY(i)*hingeHeight);
      }
      movingMesh(barrel,trim,`hinge-barrel-${index}`,[0,y,0]);
      movingBox([3*t,hingeHeight,t],[1.5*t,y,t*.5],`hinge-door-leaf-${index}`);
      staticBox([gap+2*t,hingeHeight,t],[pivot.position.x-gap/2,pivot.position.y+y,pivot.position.z-t],trim);
    }
    a.anchor('base',new THREE.Matrix4());
    a.anchor('hinge',new THREE.Matrix4().makeTranslation(...pivot.position.toArray()));
    // This asset-local snapshot is only for closed-door layout, never for moving attachments.
    a.anchor('serviceClosed',new THREE.Matrix4().makeTranslation(pivot.position.x+handleX,pivot.position.y+handleY,pivot.position.z+t+standOff));
    a.dynamic(pivot);finished=a.finish();
    let disposed=false;
    function setOpen(value) {
      if(disposed)throw new Error('Cabinet has been disposed');
      validOpen(value);pivot.rotation.y=-value*110*Math.PI/180;
    }
    setOpen(open);
    return {
      ...finished,parts:{doorPivot:pivot,serviceAnchor},setOpen,
      dispose() {
        if(disposed)return;
        disposed=true;finished.dispose();
        // The generic assembly preserves dynamic ownership; this factory created these geometries.
        for(const geometry of ownedDynamic)geometry.dispose();
      }
    };
  } catch(error) {
    // finish releases private static snapshots even when an injected merge operation fails.
    if(!finished){try{finished=a.finish();}catch{}}
    finished?.dispose();
    for(const geometry of ownedDynamic)geometry.dispose();
    throw error;
  }
}
