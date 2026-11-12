import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createResourceScope} from '../../runtime/resource-scope.mjs';
import {createAssetSlot} from '../../runtime/asset-slot.mjs';
import {buildProfileRelation} from '../profile-relation.mjs';

// Only consumer-required plain data: unit convention, stable identity, geometry,
// world placement and presentation. No imaginary automatic brief parser.
const design = {units:'m',assets:[
  {id:'profile/axisymmetric',representation:'revolved-shell',position:[-2,0,0],yaw:0,height:3,bend:0,width:1.9,depth:1.9,wallThickness:.14},
  {id:'profile/along-path',representation:'section-loft',position:[2,0,0],yaw:-.25,height:3,bend:.6,width:1.9,depth:1.25},
]};
const scope=createResourceScope();
const renderer=scope.own(new T.WebGLRenderer({antialias:true}));renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.prepend(renderer.domElement);
scope.defer(()=>renderer.domElement.remove());
const scene=new T.Scene();scene.background=new T.Color('#dfe9e7');
const camera=new T.PerspectiveCamera(39,innerWidth/innerHeight,.1,120);camera.position.set(9,7.5,12);
const controls=scope.own(new OrbitControls(camera,renderer.domElement));controls.target.set(0,1.5,0);controls.enableDamping=true;
controls.minDistance=4;controls.maxDistance=27;controls.minPolarAngle=.15;controls.maxPolarAngle=1.48;controls.saveState();
const materials={body:scope.own(new T.MeshStandardMaterial({color:'#b6d0ca',roughness:.45})),
  metal:scope.own(new T.MeshStandardMaterial({color:'#b99b5f',metalness:.65,roughness:.3})),
  support:scope.own(new T.MeshStandardMaterial({color:'#748982',roughness:.85}))};
const floorGeometry=scope.own(new T.CircleGeometry(10,96)),floorMaterial=scope.own(new T.MeshStandardMaterial({color:'#c6d0bf',roughness:.9}));
const floor=new T.Mesh(floorGeometry,floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.y=-.015;floor.receiveShadow=true;scene.add(floor);
const key=new T.DirectionalLight('#fff2d8',3.2);key.position.set(-5,10,6);key.castShadow=true;key.shadow.mapSize.set(1024,1024);
Object.assign(key.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:1,far:30});key.shadow.normalBias=.025;scene.add(key);
// DirectionalLight.dispose owns its shadow target. It is not covered by renderer.dispose.
scope.own(key);
const fill=new T.DirectionalLight('#c4def5',1.7);fill.position.set(6,4,-5);scene.add(fill);
scene.add(new T.HemisphereLight('#edf5ff','#7a8270',1.3));
// Per-region parent carries world placement. Geometry and ports stay asset-local.
const entries=design.assets.map(asset=>{
  const parent=new T.Group();parent.position.fromArray(asset.position);parent.rotation.y=asset.yaw;scene.add(parent);
  scope.defer(()=>parent.removeFromParent());
  return {asset,parent,slot:scope.own(createAssetSlot(parent))};
});
let ready=false,lastError=null;
function rebuild(entry,patch={}){
  // Register the factory as a whole, not each of the geometry objects it owns.
  const previousRevision=entry.slot.revision;
  try{entry.slot.replace(candidate=>candidate.own(buildProfileRelation(T,{spec:{...entry.asset,...patch},materials})));}
  finally{
    // Retirement can throw after commit. The live handle, not the exception alone,
    // determines whether the authoritative design snapshot has advanced.
    if(entry.slot.revision!==previousRevision)Object.assign(entry.asset,entry.slot.current.spec);
  }
}
function readState(){
  scene.updateMatrixWorld(true);
  return {ready,revision:entries.map(e=>e.slot.revision),height:entries[0].asset.height,bend:entries[1].asset.bend,lastError,
    materials:{roughness:materials.metal.roughness,uuid:materials.metal.uuid},
    assets:entries.map(e=>{
      const a=e.slot.current;if(!a)return null;
      const g=a.parts.body.geometry,port=a.root.matrixWorld.clone().multiply(a.anchors.get('service'));
      const portPoint=new T.Vector3().setFromMatrixPosition(port),fixture=a.parts.fixture.getWorldPosition(new T.Vector3());
      const normal=new T.Vector3().setFromMatrixColumn(port,2),hit=a.sampleSurface(portPoint.clone().addScaledVector(normal,.2),normal.clone().negate());
      return {id:a.spec.id,spec:a.spec,geometryUUID:g.uuid,geometrySignature:Array.from(g.attributes.position.array.slice(0,30)),
        port:portPoint.toArray(),fixture:fixture.toArray(),contactError:hit?hit.point.distanceTo(portPoint):null,
        materialUUID:a.parts.body.material.uuid,metalUUID:materials.metal.uuid,triangles:g.index.count/3};
    }),camera:{position:camera.position.toArray(),target:controls.target.toArray()},
    memory:{...renderer.info.memory},scope:scope.inspect()};
}
function report(){document.querySelector('#status').textContent=JSON.stringify({revision:entries.map(e=>e.slot.revision),lastError,
  geometries:renderer.info.memory.geometries,materialsOwnedBy:'scene',generatedResourcesOwnedBy:'asset'},null,2);}
function run(action){try{action();lastError=null;}catch(e){lastError=e.message;console.warn(e.message);}report();}
function listen(target,type,fn){target.addEventListener(type,fn);scope.defer(()=>target.removeEventListener(type,fn));}
listen(document.querySelector('#height'),'change',e=>run(()=>rebuild(entries[0],{height:Number(e.target.value)})));
listen(document.querySelector('#bend'),'change',e=>run(()=>rebuild(entries[1],{bend:Number(e.target.value)})));
listen(document.querySelector('#roughness'),'input',e=>{materials.metal.roughness=Number(e.target.value);report();});
listen(document.querySelector('#invalid'),'click',()=>{
  try{rebuild(entries[0],{height:-1});}catch(e){lastError=e.message;}report();
});
listen(document.querySelector('#cycle'),'click',()=>run(()=>{for(let i=0;i<10;i++)for(const entry of entries)rebuild(entry);}));
listen(document.querySelector('#reset'),'click',()=>{
  // r180 reset() calls update() with any remaining damping delta. Drain it using
  // public APIs before restoring the saved state, so the view cannot drift again.
  const damping=controls.enableDamping;
  try{controls.enableDamping=false;controls.update();controls.reset();}
  finally{controls.enableDamping=damping;}
  report();
});
listen(window,'resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
let frame;
function draw(){controls.update();renderer.render(scene,camera);ready=true;frame=requestAnimationFrame(draw);}
scope.defer(()=>cancelAnimationFrame(frame));
for(const entry of entries)rebuild(entry);draw();report();
window.__FOUNDATION_TEST__={readState,dispose:()=>scope.dispose()};
listen(window,'pagehide',()=>scope.dispose());
