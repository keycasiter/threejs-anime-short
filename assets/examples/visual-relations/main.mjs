import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBoundedProfileGeometry} from '../../geometry/bounded-profile.mjs';
import {estimateSamplingStep} from '../../geometry/projected-sampling.mjs';
import {createSectionLoftSource} from '../../geometry/loft-source.mjs';
import {inspectFeatureVisibility} from '../../scene/view-readability.mjs';

// The whole scene is an instructional fixture. No animation races the comparisons.
const stage=document.querySelector('#stage');
const scene=new T.Scene();scene.background=new T.Color('#f1f2ef');
const camera=new T.PerspectiveCamera(38,1,.1,100);
const homeTarget=new T.Vector3(-.12,1.35,0);
const homeDirection=new T.Vector3(1.2,2.55,9.5).normalize();
const homePosition=homeTarget.clone().addScaledVector(homeDirection,10);
camera.position.copy(homePosition);camera.lookAt(homeTarget);
const renderer=new T.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
stage.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(homeTarget);
controls.minDistance=5;controls.maxDistance=25;controls.maxPolarAngle=Math.PI*.76;
controls.enableDamping=false;controls.update();
scene.add(new T.HemisphereLight('#ffffff','#9aaba0',2.2));
const key=new T.DirectionalLight('#ffffff',4);key.name='lighting.key';key.position.set(-3,7,6);scene.add(key);
const rim=new T.DirectionalLight('#e5eee8',2.2);rim.name='lighting.rim';rim.position.set(5,3,-4);scene.add(rim);
const neutral=new T.MeshStandardMaterial({color:'#8c9b8d',roughness:.7,metalness:.08});
const frameworkMaterial=new T.MeshStandardMaterial({color:'#6d7870',roughness:.75,metalness:.1});
const profileMaterial=new T.MeshStandardMaterial({color:'#b9c5b7',roughness:.64,metalness:.08});
const baseMaterial=new T.MeshStandardMaterial({color:'#7f968a',roughness:.85,metalness:.22});
const candidateMaterial=baseMaterial.clone();candidateMaterial.roughness=.24;
const floorMaterial=new T.MeshStandardMaterial({color:'#e5e8e1',roughness:1});
const state={structure:'dense',material:'base'};
const triangleCount=g=>(g.index?.count??g.attributes.position.count)/3;
function identify(mesh,id){mesh.name=id;mesh.userData.stableId=id;return mesh;}
function box(id,size,position,material=frameworkMaterial,parent=scene){
  const mesh=identify(new T.Mesh(new T.BoxGeometry(...size),material),id);
  mesh.position.set(...position);parent.add(mesh);return mesh;
}
function bar(id,start,end,radius,material,parent=scene){
  const a=new T.Vector3(...start),b=new T.Vector3(...end),d=b.clone().sub(a);
  const mesh=identify(new T.Mesh(new T.CylinderGeometry(radius,radius,d.length(),8),material),id);
  mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());parent.add(mesh);return mesh;
}
for(const [id,x,width] of [['boundary',-4.1,3.65],['visibility',0,2.8],['family',4.05,3.2]]){
  box(`plinth.${id}`,[width,.1,2.7],[x,.05,0],floorMaterial);
}
function resize(){const r=stage.getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}
resize();

// 01. The clipping domain owns all six footprints. Profiles use explicit units.
const owner=new T.Group();owner.name='boundary.owner';owner.position.set(-4.1,1.45,0);owner.rotation.x=-.32;scene.add(owner);
const boundary=[[-1.55,-1.05],[1.5,-1.05],[.88,1.05],[-1.55,1.05]];
const amplitude=.12,profileWidth=.30,profileSpanWorld=profileWidth;
const samplingPoint=owner.localToWorld(new T.Vector3(1.2,-.85,amplitude));
const samplingInput={worldPoint:samplingPoint.toArray(),viewportHeight:stage.clientHeight,maxErrorPx:.6,
  curvatureBound:amplitude*(Math.PI/profileWidth)**2,minFeatureSize:profileWidth*2,samplesPerFeature:12,maxNormalTurn:.2};
let samplingOutput=estimateSamplingStep(T,{camera,...samplingInput});
let profileSegments=Math.max(2,Math.ceil(profileSpanWorld/samplingOutput.step));
const parts=[];
for(let i=0;i<6;i++){
  const center=-.875+i*.35;
  const footprint=[[-1.9,center-profileWidth/2],[1.8,center-profileWidth/2],[1.8,center+profileWidth/2],[-1.9,center+profileWidth/2]];
  const part=createBoundedProfileGeometry(T,{boundary,footprint,thickness:.055,segments:profileSegments,
    heightAt:v=>amplitude*Math.cos((v-center)*Math.PI/profileWidth)});
  if(!part)throw new Error('Expected a nonempty teaching strip');
  const mesh=identify(new T.Mesh(part.geometry,profileMaterial),`boundary.strip.${i}`);owner.add(mesh);
  parts.push({id:mesh.name,part,mesh,footprint,center});
}
for(let i=0;i<boundary.length;i++){
  const a=boundary[i],b=boundary[(i+1)%boundary.length];
  bar(`boundary.edge.${i}`,[...a,-.065],[...b,-.065],.035,frameworkMaterial,owner);
}
bar('boundary.support.left',[-1.35,-1.1,-.11],[-1.35,1.1,-.11],.045,frameworkMaterial,owner);
bar('boundary.support.right',[.65,-1.1,-.11],[.65,1.1,-.11],.045,frameworkMaterial,owner);

// 02. The target is the actual rendered side surface, not a bounding box proxy.
const featureSource=createSectionLoftSource(T,{radialSegments:48,caps:false,stations:[
  {center:[0,.28,0],width:1.15,depth:.9},{center:[-.12,.85,0],width:1.4,depth:1.1},
  {center:[.1,1.55,0],width:1.15,depth:.8},{center:[0,2.42,0],width:.7,depth:.65}
]});
const feature=identify(new T.Mesh(featureSource.geometry,baseMaterial),'visibility.surface');scene.add(feature);
const frame=new T.Group();frame.name='visibility.frame';scene.add(frame);
const permanent=[];
for(const x of [-1.0,1.0])for(const z of [-.73,.73]){
  permanent.push(box(`frame.post.${x<0?'L':'R'}.${z<0?'back':'front'}`,[.085,2.65,.085],[x,1.425,z],frameworkMaterial,frame));
}
for(const y of [.16,2.72]){
  for(const z of [-.73,.73])permanent.push(box(`frame.boundary.x.${y}.${z}`,[2.085,.085,.085],[0,y,z],frameworkMaterial,frame));
  for(const x of [-1,1])permanent.push(box(`frame.boundary.z.${y}.${x}`,[.085,.085,1.46],[x,y,0],frameworkMaterial,frame));
}
const rhythm=[];
for(const side of ['front','back'])for(let i=0;i<6;i++){
  rhythm.push({i,side,mesh:box(`frame.rhythm.${side}.${i}`,[1.94,.09,.085],[0,0,side==='front'?.73:-.73],frameworkMaterial,frame)});
}
const rhythms={dense:[.49,.86,1.23,1.60,1.97,2.34],open:[.40,.53,.66,2.17,2.30,2.43]};
// Equal topology and all front/back members remain: only authored station spacing changes.
function setStructure(id){
  if(!rhythms[id])throw new RangeError('structure must be dense or open');
  state.structure=id;for(const rail of rhythm)rail.mesh.position.y=rhythms[id][rail.i];
  for(const key of ['dense','open'])document.querySelector(`#${key}`).setAttribute('aria-pressed',String(key===id));
  update();return readState();
}
function setMaterial(id){
  if(!['base','candidate'].includes(id))throw new RangeError('material must be base or candidate');
  state.material=id;feature.material=id==='base'?baseMaterial:candidateMaterial;
  for(const key of ['base','candidate'])document.querySelector(`#${key}`).setAttribute('aria-pressed',String(key===id));
  update();return readState();
}

// 03. Same endpoints and scale; internal stations are independent structural inputs.
const families=[
  {id:'family.tapered',x:3.35,middle:[{center:[0,.85,0],width:1.0,depth:.8},{center:[0,1.55,0],width:.7,depth:.55}]},
  {id:'family.offset',x:4.85,middle:[{center:[.19,.85,0],width:.62,depth:1.0},{center:[-.14,1.55,0],width:1.02,depth:.46}]}
].map(spec=>{
  const stations=[{center:[0,.2,0],width:.76,depth:.66},...spec.middle,{center:[0,2.35,0],width:.46,depth:.38}];
  const source=createSectionLoftSource(T,{stations,radialSegments:32,caps:false});
  const mesh=identify(new T.Mesh(source.geometry,neutral),spec.id);mesh.position.x=spec.x;scene.add(mesh);
  // Small rings make the authored internal section levels legible without changing scale.
  const stationLines=new T.Group();stationLines.name=`${spec.id}.stations`;scene.add(stationLines);
  for(let i=0;i<stations.length;i++){
    const points=[],position=source.geometry.attributes.position;
    for(let j=0;j<=32;j++)points.push(new T.Vector3().fromBufferAttribute(position,i*33+j).add(mesh.position));
    const line=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#59685e'}));line.name=`${spec.id}.station.${i}`;stationLines.add(line);
  }
  return {...spec,stations,source,mesh};
});

// Stable samples are triangle centroids, on the exact current emitted geometry.
const featureTriangleIds=[];
for(let segment=0;segment<3;segment++)for(let cell=2;cell<23;cell+=2){featureTriangleIds.push((segment*48+cell)*2);}
function surfaceSamples(){
  feature.updateWorldMatrix(true,false);const g=feature.geometry,p=g.attributes.position;
  return featureTriangleIds.map(id=>{
    const point=new T.Vector3();for(let k=0;k<3;k++)point.add(new T.Vector3().fromBufferAttribute(p,g.index.getX(id*3+k)));
    return feature.localToWorld(point.multiplyScalar(1/3));
  });
}
let visibility;
function inspect(){
  scene.updateMatrixWorld(true);const rect=renderer.domElement.getBoundingClientRect();
  return inspectFeatureVisibility(T,{camera,points:surfaceSamples(),occluders:[frame,feature],viewport:{width:rect.width,height:rect.height},epsilon:.001});
}
function positionSignature(geometry){
  const p=geometry.attributes.position.array;let hash=2166136261;
  // Hash actual Float32 position bytes, not the station recipe or object name.
  for(const byte of new Uint8Array(p.buffer,p.byteOffset,p.byteLength)){hash^=byte;hash=Math.imul(hash,16777619);}
  return `float32-fnv1a:${(hash>>>0).toString(16).padStart(8,'0')}`;
}
function geometryData(g){return {uuid:g.uuid,triangles:triangleCount(g),vertexCount:g.attributes.position.count,
  indexCount:g.index?.count??0,positionSignature:positionSignature(g),positions:Array.from(g.attributes.position.array),indices:g.index?Array.from(g.index.array):null};}
function materialFields(m){return {type:m.type,color:`#${m.color.getHexString()}`,roughness:m.roughness,metalness:m.metalness,opacity:m.opacity,transparent:m.transparent,side:m.side};}
function visibilityData(v){
  const {samples,...counts}=v;const hits={};
  const rows=samples.map((sample,i)=>{const blockerId=sample.blocker?.object.userData.stableId??sample.blocker?.object.name??null;
    if(blockerId)(hits[blockerId]??=[]).push(`surface.sample.${i}`);
    return {id:`surface.sample.${i}`,triangleId:featureTriangleIds[i],worldPoint:surfaceSamplesCached[i].toArray(),status:sample.status,pixel:sample.pixel,
      blocker:sample.blocker?{id:blockerId,instanceId:sample.blocker.instanceId,point:sample.blocker.point.toArray(),distance:sample.blocker.distance}:null};});
  return {...counts,hits,samples:rows};
}
let surfaceSamplesCached=surfaceSamples();
// Diagnostic dots are drawn above depth solely to locate blocked sample positions.
// They never participate in the explicitly supplied triangle-occluder set.
const sampleGeometry=new T.BufferGeometry().setFromPoints(surfaceSamplesCached);
sampleGeometry.setAttribute('color',new T.Float32BufferAttribute(new Float32Array(featureTriangleIds.length*3),3));
const markers=new T.Points(sampleGeometry,new T.PointsMaterial({size:.055,vertexColors:true,depthTest:false,depthWrite:false}));
markers.name='visibility.sample-markers';markers.renderOrder=5;scene.add(markers);
function readState(){
  surfaceSamplesCached=surfaceSamples();const v=inspect();const meshes=[];
  scene.traverse(object=>{if(object.isMesh)meshes.push({id:object.userData.stableId??object.name,triangles:triangleCount(object.geometry),visible:object.visible});});
  return {ready:true,threeRevision:T.REVISION,structure:state.structure,material:state.material,
    totalTriangles:meshes.reduce((sum,m)=>sum+m.triangles,0),meshes,
    boundary:{id:owner.name,boundary,parts:parts.map(({id,part,footprint,mesh})=>({id,footprint,outline:part.outline,geometry:geometryData(mesh.geometry)}))},
    sampling:{id:'boundary.profile.sampling',scope:'local estimate at the recorded construction view; not a nearest-view guarantee',input:{...samplingInput,pixelUnits:'CSS pixels',cameraMatrixWorldAtBuild:samplingCameraMatrix},output:samplingOutput,profileSpanWorld,segments:profileSegments},
    visibility:{id:'visibility.surface.samples',ownerId:feature.name,...visibilityData(v)},
    frame:{permanentIds:permanent.map(m=>m.name),rhythm:rhythm.map(({mesh,side,i})=>({id:mesh.name,side,index:i,position:mesh.position.toArray(),visible:mesh.visible}))},
    variants:families.map(({id,mesh,stations})=>({id,stations,scale:mesh.scale.toArray(),geometry:geometryData(mesh.geometry)})),
    materialFields:materialFields(feature.material),camera:{position:camera.position.toArray(),target:controls.target.toArray(),minDistance:controls.minDistance,maxDistance:controls.maxDistance,home:homeFit,currentProjection:projectedSceneBounds()},
    lighting:{keyPosition:key.position.toArray(),keyIntensity:key.intensity,rimPosition:rim.position.toArray(),rimIntensity:rim.intensity,exposure:renderer.toneMappingExposure}};
}
// Calibrate framing with actual emitted Mesh vertices, including every plinth,
// boundary and support. The saved direction/fov determine perspective first;
// distance then fits a symmetric safe frame. No AABB replaces the mesh surface.
function projectedSceneBounds(){
  camera.updateWorldMatrix(true,false);scene.updateMatrixWorld(true);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,minDepth=Infinity;
  const point=new T.Vector3();
  scene.traverse(object=>{
    if(!object.isMesh||!object.visible)return;
    const positions=object.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      minDepth=Math.min(minDepth,-point.z);point.applyMatrix4(camera.projectionMatrix);
      minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);
    }
  });
  return {ndc:{minX,minY,maxX,maxY},widthFraction:(maxX-minX)/2,heightFraction:(maxY-minY)/2,minDepth,
    fullyInside:minDepth>=camera.near&&minX>=-1&&maxX<=1&&minY>=-1&&maxY<=1};
}
function fitHomeView(){
  let low=3,high=60;
  for(let i=0;i<30;i++){
    const distance=(low+high)/2;camera.position.copy(homeTarget).addScaledVector(homeDirection,distance);camera.lookAt(homeTarget);
    const b=projectedSceneBounds();
    if(b.minDepth>camera.near&&Math.max(Math.abs(b.ndc.minX),Math.abs(b.ndc.maxX))<=.84&&Math.max(Math.abs(b.ndc.minY),Math.abs(b.ndc.maxY))<=.82)high=distance;
    else low=distance;
  }
  homePosition.copy(homeTarget).addScaledVector(homeDirection,high);
  camera.position.copy(homePosition);controls.target.copy(homeTarget);
  controls.minDistance=high*.72;controls.maxDistance=high*2.2;controls.update();
  return {position:homePosition.toArray(),target:homeTarget.toArray(),direction:homeDirection.toArray(),distance:high,fov:camera.fov,
    fitLimit:{widthFraction:.84,heightFraction:.82},projection:projectedSceneBounds()};
}
const homeFit=fitHomeView();
// Build-time sampling now uses that fitted camera. Orbit/reset never rebuilds it.
samplingOutput=estimateSamplingStep(T,{camera,...samplingInput});
profileSegments=Math.max(2,Math.ceil(profileSpanWorld/samplingOutput.step));
for(const entry of parts){
  const replacement=createBoundedProfileGeometry(T,{boundary,footprint:entry.footprint,thickness:.055,segments:profileSegments,
    heightAt:v=>amplitude*Math.cos((v-entry.center)*Math.PI/profileWidth)});
  entry.mesh.geometry=replacement.geometry;entry.part.dispose();entry.part=replacement;
}
const samplingCameraMatrix=camera.matrixWorld.toArray();
function update(){
  visibility=inspect();
  const colors=sampleGeometry.attributes.color;
  visibility.samples.forEach((sample,i)=>{const color=new T.Color(sample.status==='visible'?'#23865b':sample.status==='occluded'?'#aa6246':'#8a918b');colors.setXYZ(i,color.r,color.g,color.b);});
  colors.needsUpdate=true;renderer.render(scene,camera);
  const blockers=new Map();visibility.samples.forEach((s,i)=>{if(s.blocker){const id=s.blocker.object.name;if(!blockers.has(id))blockers.set(id,[]);blockers.get(id).push(i);}});
  document.querySelector('#sampling-info').textContent=`每块 ${profileSegments} 段 · 目标 ${samplingInput.maxErrorPx} CSS px\nstep ${samplingOutput.step.toFixed(4)} 世界单位 · 厚度 0.055\n${parts.reduce((n,{mesh})=>n+triangleCount(mesh.geometry),0)} 个实际三角形（含顶 / 底 / 侧 / 端盖）`;
  const first=[...blockers].slice(0,2).map(([id,ids])=>`${id.replace('frame.rhythm.','横档 ')} → ${ids.map(i=>`S${i}`).join(', ')}`).join('\n');
  document.querySelector('#visibility-info').textContent=`${visibility.totalSampleCount} 样点：可见 ${visibility.visibleSampleCount} / 遮挡 ${visibility.occludedSampleCount} / 出画 ${visibility.clippedOrOffscreenSampleCount}\n${first||'当前样点没有命中遮挡者'}\n样点比例只用于定位，不是画质分`;
  document.querySelector('#variant-info').textContent=`内部站位独立 · ${families.map(f=>triangleCount(f.mesh.geometry)).join(' / ')} 三角形\n框架 ${rhythm.length} 根节奏横档 + ${permanent.length} 个完整边界构件\n中央 roughness ${feature.material.roughness.toFixed(2)} · metalness ${feature.material.metalness.toFixed(2)}`;
}
function resetView(){camera.position.copy(homePosition);controls.target.copy(homeTarget);controls.update();update();return readState();}
for(const id of ['dense','open'])document.querySelector(`#${id}`).addEventListener('click',()=>setStructure(id));
for(const id of ['base','candidate'])document.querySelector(`#${id}`).addEventListener('click',()=>setMaterial(id));
document.querySelector('#reset').addEventListener('click',resetView);
controls.addEventListener('change',update);
new ResizeObserver(()=>{resize();update();}).observe(stage);
window.__RELATIONS_TEST__={readState,setStructure,setMaterial,resetView,context:{T,scene,camera,renderer,controls}};
window.readState=readState;
setStructure('dense');
