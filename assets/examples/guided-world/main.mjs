import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildGuidedAssembly} from '../guided-assembly.mjs';
import {createWaveSurface} from '../../environment/wave-surface.mjs';
import {createProceduralPalette} from '../../materials/procedural-palette.mjs';
import {createSkyEnvironment,captureEnvironmentProbe} from '../../rendering/scene-environment.mjs';
import {createSceneClock,createSceneWorkbench} from '../../runtime/scene-workbench.mjs';
import {probeParameter,probeRigidMotion,readOrbitLimits} from '../../runtime/scene-probes.mjs';

// Authoritative scene input. These are design values for this teaching example.
const design={seed:381,span:6,surfaceVariant:0,amplitude:.08,waterLevel:.22,
  basin:{position:[4.5,0,0],width:3,depth:7},camera:{position:[13,10,16],target:[0,1.1,0]}};
const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.prepend(renderer.domElement);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,innerWidth/innerHeight,.1,180);
camera.position.fromArray(design.camera.position);const controls=new OrbitControls(camera,renderer.domElement);controls.target.fromArray(design.camera.target);
controls.enableDamping=true;controls.enablePan=false;controls.minDistance=5;controls.maxDistance=36;controls.minPolarAngle=.2;controls.maxPolarAngle=1.42;controls.update();
const clock=createSceneClock(),palette=createProceduralPalette(T,{seed:design.seed,resolution:128});
const materials={stone:palette.get('stone',{tileSizeMeters:[1,1],wetness:.15}),
  coat:new T.MeshStandardMaterial({color:'#dfd1b4',roughness:.34,metalness:0}),
  metal:new T.MeshStandardMaterial({color:'#314b50',roughness:.26,metalness:.82}),
  glass:new T.MeshPhysicalMaterial({color:'#ffffff',transmission:.82,thickness:.035,ior:1.46,roughness:.1,metalness:0}),
  accent:new T.MeshStandardMaterial({color:'#b87545',roughness:.38,metalness:.55})};
const waterMaterial=new T.MeshPhysicalMaterial({color:'#a7c7bf',roughness:.2,metalness:0,transmission:.42,thickness:.4,ior:1.333});
const neutral=new T.MeshStandardMaterial({color:'#b9c2b3',roughness:.85});
const key=new T.DirectionalLight('#fff0cb',3);key.position.set(-8,15,9);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-13,right:13,top:13,bottom:-13,near:1,far:45});key.shadow.normalBias=.025;scene.add(key);
scene.add(new T.HemisphereLight('#ccdeec','#666b53',.8));
const sky=createSkyEnvironment(T,{renderer,resolution:128,radius:140,zenith:'#b1c9c7',horizon:'#e7e7d8',ground:'#778570',sunDirection:key.position.toArray()});scene.add(sky.root);sky.apply(scene);scene.environmentIntensity=.65;
const staticGeometry=new Set();
function box(size,pos,material){
  const g=new T.BoxGeometry(...size),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
  for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i));uv.setXY(i,nx>.5?p.getZ(i):p.getX(i),ny>.5?p.getZ(i):p.getY(i));}
  if(material.normalMap)g.computeTangents();staticGeometry.add(g);const m=new T.Mesh(g,material);m.position.set(...pos);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;
}
box([15,.3,11],[0,-.15,0],materials.stone);
// Basin support, border and water all read the same width/depth/position.
const b=design.basin;
box([b.width+.4,.12,b.depth+.4],[b.position[0],.06,b.position[2]],materials.stone);
for(const s of [-1,1]){
  box([.14,.4,b.depth+.3],[b.position[0]+s*(b.width/2+.1),.2,b.position[2]],materials.coat);
  box([b.width+.3,.4,.14],[b.position[0],.2,b.position[2]+s*(b.depth/2+.1)],materials.coat);
}
function waveDefinitions(){return [{direction:[1,.25],amplitude:design.amplitude,wavelength:3.6,q:.25,omega:1.3},{direction:[-.2,1],amplitude:design.amplitude*.4,wavelength:2.2,q:.15,omega:1.8,phase:.8}];}
const water=createWaveSurface(T,{width:b.width,depth:b.depth,segmentsX:24,segmentsZ:56,waves:waveDefinitions(),waterLevel:design.waterLevel,material:waterMaterial});
water.root.position.fromArray(b.position);scene.add(water.root);water.mesh.receiveShadow=true;
const buoy=new T.Mesh(new T.SphereGeometry(.14,16,10),materials.accent);water.root.add(buoy);buoy.castShadow=true;
let asset;
function prepareAssetTangents(next){next.root.traverse(o=>{if(!o.isMesh||!o.material.normalMap)return;const g=o.geometry;if(!g.index)g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));g.computeTangents();});}
function rebuild(){
  // Build successfully before removing the old relation. Material ownership is shared.
  const next=buildGuidedAssembly(T,{mergeGeometries,materials,span:design.span,seed:design.seed,surfaceVariant:design.surfaceVariant});
  prepareAssetTangents(next);const previous=asset;asset=next;scene.add(next.root);previous?.root.removeFromParent();previous?.dispose();
}
rebuild();
// Local scene content, captured after actual geometry and lights exist. Static only.
let reflection;
function refreshReflection(){
  scene.updateMatrixWorld(true);const position=asset.parts.glazing.getWorldPosition(new T.Vector3());
  const next=captureEnvironmentProbe(T,{renderer,scene,position:position.toArray(),resolution:64,exclude:[asset.parts.glazing,water.mesh]});
  const previous=reflection;reflection=next;materials.glass.envMap=next.texture;previous?.dispose();
}
refreshReflection();
function update(time){asset.update(time);water.update(time);const s=water.sampleRest(0,0,time);buoy.position.fromArray(s.position);buoy.position.y+=.14;sky.follow(camera.position);}
function setSpan(value){if(!Number.isFinite(value)||value<3||value>9)throw new RangeError('span outside 3..9');const old=design.span;design.span=value;try{rebuild()}catch(e){design.span=old;throw e;}document.querySelector('#span').value=String(value);update(clock.readState().time);refreshReflection();}
function setAmplitude(value){if(!Number.isFinite(value)||value<0||value>.18)throw new RangeError('amplitude outside 0...18');const old=design.amplitude;design.amplitude=value;try{water.setWaves(waveDefinitions())}catch(e){design.amplitude=old;throw e;}document.querySelector('#amplitude').value=String(value);update(clock.readState().time);}
function setSurfaceVariant(value){const old=design.surfaceVariant;design.surfaceVariant=value;try{rebuild()}catch(e){design.surfaceVariant=old;throw e;}update(clock.readState().time);refreshReflection();}
function fullView(){scene.overrideMaterial=null;controls.target.fromArray(design.camera.target);camera.position.fromArray(design.camera.position);controls.update();}
const bench=createSceneWorkbench(T,{camera,controls,renderer,clock,onTime:update,modes:{
  '全场':fullView,
  '接点':()=>{scene.overrideMaterial=null;const p=asset.parts.mount.getWorldPosition(new T.Vector3());controls.target.copy(p);camera.position.copy(p).add(new T.Vector3(3,2.1,4));controls.update();},
  '灰模':()=>{fullView();scene.overrideMaterial=neutral;},
}});
let alive=true,probing=false;
async function checkConsumers(){
  if(probing)throw new Error('probe already running');probing=true;const shot=bench.snapshot();clock.freeze(shot.clock.time);
  try{
    const parameter=await probeParameter({baseline:design.span,candidate:design.span<7?8:4,apply:setSpan,
      measure:()=>{asset.parts.body.geometry.computeBoundingBox();return [asset.parts.body.geometry.boundingBox.max.x,asset.parts.mount.position.x,asset.parts.mount.position.y];}});
    const motion=await probeRigidMotion(T,{root:asset.parts.pivot,update,times:[0,2,7],restoreTime:shot.clock.time});
    const p=water.sampleRest(0,0,shot.clock.time),limits=readOrbitLimits(controls);
    const result={parameter,motion,limits,waveNormal:p.normal,scope:'Real geometry/matrices; not a visual quality score'};document.querySelector('#result').textContent=JSON.stringify(result,null,2);return result;
  }finally{bench.restore(shot);if(!shot.clock.paused)clock.resume();probing=false;}
}
document.querySelector('#span').onchange=e=>setSpan(Number(e.target.value));document.querySelector('#amplitude').onchange=e=>setAmplitude(Number(e.target.value));
document.querySelector('#view').onchange=e=>bench.setMode(e.target.value);document.querySelector('#reset').onclick=()=>{bench.setMode('全场');document.querySelector('#view').value='全场';};
document.querySelector('#play').onclick=()=>{if(clock.readState().paused)clock.resume();else clock.freeze();};
document.querySelector('#probe').onclick=()=>checkConsumers().catch(showError);
function showError(error){window.__fatal=String(error);const p=document.querySelector('#error');p.hidden=false;p.textContent=String(error);}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
function render(now){if(!alive)return;if(!probing){controls.update();update(clock.tick(now/1000).time);}renderer.render(scene,camera);document.querySelector('#play').textContent=clock.readState().paused?'播放':'暂停';requestAnimationFrame(render);}
window.__CODE_GUIDE__={get ready(){return window.__ready===true},renderer,scene,camera,controls,bench,water,buoy,materials,get asset(){return asset},setSpan,setAmplitude,setSurfaceVariant,checkConsumers,
  dispose(){if(!alive)return;alive=false;bench.dispose();controls.dispose();asset.dispose();water.dispose();buoy.geometry.dispose();for(const g of staticGeometry)g.dispose();reflection.dispose();sky.dispose();neutral.dispose();waterMaterial.dispose();for(const [role,m]of Object.entries(materials))if(role!=='stone')m.dispose();palette.dispose();renderer.dispose();}};
try{update(0);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);window.__ready=true;requestAnimationFrame(render);}catch(e){showError(e);throw e;}
