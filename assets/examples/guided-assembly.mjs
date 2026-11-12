import {createSectionLoftSource} from '../geometry/loft-source.mjs';
import {createAssetAssembly} from '../scene/asset-assembly.mjs';
import {placeAtAnchor} from '../scene/anchor-connection.mjs';
import {createRandomStreams} from '../runtime/random-streams.mjs';

/** A complete construction relation, not a universal art style.
 * Metres, +Y up. span changes the emitted spine AND the attached service frame.
 * Borrowed materials retain caller ownership; generated geometry belongs here.
 */
export function buildGuidedAssembly(T,{
  mergeGeometries,materials,span=6,seed=381,surfaceVariant=0,
}={}) {
  if(!Number.isFinite(span)||span<3||span>9)throw new RangeError('span must be in 3..9 metres');
  if(!Number.isInteger(surfaceVariant)||surfaceVariant<0||surfaceVariant>65535)throw new RangeError('surfaceVariant must be an integer in 0..65535');
  for(const role of ['stone','coat','metal','glass','accent'])if(!materials?.[role]?.isMaterial)throw new TypeError(`materials.${role} is required`);
  const streams=createRandomStreams(seed),owned=new Set(),assembly=createAssetAssembly(T,{mergeGeometries});
  // Internal station ratios express the bend/neck independently of tessellation.
  const stations=[
    {center:[-span*.45,.52,0],width:.9,depth:.72},
    {center:[-span*.45,1.5,0],width:.85,depth:.68},
    {center:[-span*.4,2.5,.05],width:.7,depth:.6},
    {center:[-span*.22,3.2,.25],width:.58,depth:.52},
    {center:[span*.08,3.5,.2],width:.48,depth:.5},
    {center:[span*.4,3.35,.15],width:.35,depth:.35},
  ];
  const source=createSectionLoftSource(T,{stations,radialSegments:32,reference:[0,0,1],uvMeters:1});
  function staticGeometry(g,role,position=[0,0,0],rotation=[0,0,0]){
    const o=new T.Object3D();o.position.set(...position);o.rotation.set(...rotation);o.updateMatrix();
    try{assembly.add(g,materials[role],{matrix:o.matrix});}finally{g.dispose();}
  }
  function staticBox(size,position,role){
    const g=new T.BoxGeometry(...size),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    // One UV unit is one metre; preserve these coordinates through batching.
    for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i));uv.setXY(i,nx>.5?p.getZ(i):p.getX(i),ny>.5?p.getZ(i):p.getY(i));}
    staticGeometry(g,role,position);
  }
  function staticBeam(a,b,r,role){
    const start=new T.Vector3(...a),end=new T.Vector3(...b),o=new T.Object3D();
    o.position.copy(start).add(end).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.clone().sub(start).normalize());o.updateMatrix();
    const g=new T.CylinderGeometry(r,r,start.distanceTo(end),10);
    try{assembly.add(g,materials[role],{matrix:o.matrix});}finally{g.dispose();}
  }
  const footX=stations[0].center[0];
  staticBox([1.8,.18,1.35],[footX,.09,0],'stone');
  staticGeometry(new T.CylinderGeometry(.57,.65,.34,32),'metal',[footX,.35,0]);
  for(let i=0;i<8;i++){const a=i*Math.PI/4;staticGeometry(new T.CylinderGeometry(.055,.055,.11,6),'accent',[footX+Math.cos(a)*.66,.235,Math.sin(a)*.5]);}
  // Bands are sampled around the SAME emitted side triangles, not a second curve.
  for(const u of [.16,.35,.54,.75,.91]){
    const points=[];for(let i=0;i<32;i++){const s=source.surfaceAt(u,i/32);points.push(s.point.clone().addScaledVector(s.normal,.025));}
    staticGeometry(new T.TubeGeometry(new T.CatmullRomCurve3(points,true),64,.025,5,true),'metal');
  }
  // A second bearing meets the actual underside of the final bent body.
  let underside;for(let i=0;i<32;i++){const s=source.surfaceAt(.84,i/32);if(!underside||s.point.y<underside.point.y)underside=s;}
  staticBox([.9,.18,.9],[underside.point.x,.09,underside.point.z],'stone');
  staticBeam([underside.point.x,.18,underside.point.z],underside.point.toArray(),.105,'metal');

  // Static attachment interface; local +Z of its frame is the outward surface normal.
  const service=source.surfaceAt(.62,.12),anchors=new Map([['service',service.frame.clone()]]);
  const mount=new T.Group(),pivot=new T.Group();mount.name='service-mount';pivot.name='service-pivot';mount.add(pivot);
  function movingMesh(g,role,position=[0,0,0]){owned.add(g);const m=new T.Mesh(g,materials[role]);m.position.set(...position);m.castShadow=true;m.receiveShadow=true;pivot.add(m);return m;}
  const sleeve=movingMesh(new T.CylinderGeometry(.14,.18,.7,16),'metal',[0,0,.35]);sleeve.rotation.x=Math.PI/2;
  const rim=movingMesh(new T.TorusGeometry(.25,.035,6,24),'accent');
  for(const y of [-.55,.55])movingMesh(new T.BoxGeometry(1.8,.09,.1),'coat',[0,y,.85]);
  for(const x of [-.85,.85])movingMesh(new T.BoxGeometry(.09,1.1,.1),'coat',[x,0,.85]);
  const glazing=movingMesh(new T.BoxGeometry(1.57,.91,.035),'glass',[0,0,.85]);glazing.name='service-glazing';glazing.castShadow=false;
  // The entire attachment is excluded from static batching before it has a parent.
  assembly.dynamic(mount);
  const assembled=assembly.finish(),root=assembled.root;
  const body=new T.Mesh(source.geometry,materials.coat);body.name='shared-source-body';body.castShadow=true;body.receiveShadow=true;root.add(body);
  placeAtAnchor(T,{
    host:{root,anchors},hostAnchor:'service',
    guest:{root:mount,anchors:new Map([['base',new T.Matrix4().makeRotationY(Math.PI)]])},guestAnchor:'base',parent:root,
  });
  // Environmental repeaters: structure and surface consume different named streams.
  const instanceGeometry=new T.CylinderGeometry(.12,.16,1,8),count=16;
  const instances=new T.InstancedMesh(instanceGeometry,materials.accent,count),pose=new T.Object3D();owned.add(instanceGeometry);
  for(let i=0;i<count;i++){
    const id=`boundary/${i}`,shape=streams.stream(id,'structure'),surface=streams.stream(id,`surface/${surfaceVariant}`);
    const h=.35+shape()*.45,x=-5.8+(i%8)*.88+(shape()-.5)*.2,z=-3.2-Math.floor(i/8)*.8+(shape()-.5)*.16;
    pose.position.set(x,h/2,z);pose.rotation.y=shape()*Math.PI;pose.scale.set(1,h,1);pose.updateMatrix();instances.setMatrixAt(i,pose.matrix);
    instances.setColorAt(i,new T.Color().setHSL(.075+surface()*.035,.35,.5+surface()*.15));
  }
  instances.instanceMatrix.needsUpdate=true;instances.instanceColor.needsUpdate=true;instances.computeBoundingSphere();instances.castShadow=true;instances.receiveShadow=true;root.add(instances);
  let disposed=false;
  function update(t){if(disposed)throw new Error('guided assembly disposed');if(!Number.isFinite(t))throw new TypeError('time must be finite');pivot.rotation.y=.25*Math.sin(t*.7);root.updateWorldMatrix(true,true);}
  update(0);
  return {root,source,anchors,parts:{body,mount,pivot,glazing,rim,instances},spec:{span,seed,surfaceVariant},stats:assembled.stats,update,
    dispose(){if(disposed)return;disposed=true;root.visible=false;root.removeFromParent();assembled.dispose();source.dispose();instances.dispose();for(const g of owned)g.dispose();}
  };
}
