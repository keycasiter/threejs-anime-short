import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CSS2DObject,CSS2DRenderer} from 'three/addons/renderers/CSS2DRenderer.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {createSkyEnvironment,captureEnvironmentProbe} from '../../rendering/scene-environment.mjs';
import {createPostPipeline} from '../../rendering/post-pipeline.mjs';
import {buildSliderCrank} from '../slider-crank.mjs';

const canvas=document.querySelector('#scene'),renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.info.autoReset=false;
const scene=new T.Scene();scene.background=new T.Color('#202a31');
const camera=new T.PerspectiveCamera(36,innerWidth/innerHeight,.015,30);camera.position.set(.39,.24,.58);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(.045,.18,0);controls.enableDamping=true;controls.minDistance=.30;controls.maxDistance=1.25;controls.minPolarAngle=.22;controls.maxPolarAngle=1.53;controls.update();controls.saveState();
const labelRenderer=new CSS2DRenderer();labelRenderer.setSize(innerWidth,innerHeight);Object.assign(labelRenderer.domElement.style,{position:'fixed',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'1'});document.querySelector('#labels').append(labelRenderer.domElement);
const ownedGeometry=new Set(),ownedMaterials=new Set(),ownedTextures=new Set();
const materials={
  frame:new T.MeshPhysicalMaterial({color:'#2c383d',metalness:.72,roughness:.32,clearcoat:.5,clearcoatRoughness:.24}),
  wheel:new T.MeshPhysicalMaterial({color:'#444d51',metalness:.8,roughness:.27,clearcoat:.32}),
  steel:new T.MeshStandardMaterial({color:'#b3c0bd',metalness:.84,roughness:.24}),
  copper:new T.MeshStandardMaterial({color:'#b77848',metalness:.8,roughness:.28}),
  glass:new T.MeshPhysicalMaterial({color:'#9abec3',metalness:.18,roughness:.15,transparent:true,opacity:.17,depthWrite:false,clearcoat:1,clearcoatRoughness:.06}),
  dark:new T.MeshStandardMaterial({color:'#101719',metalness:.35,roughness:.31})
};
for(const m of Object.values(materials))ownedMaterials.add(m);
function mesh(name,g,m,pos,rotation=null){ownedGeometry.add(g);const o=new T.Mesh(g,m);o.name=name;o.position.set(...pos);if(rotation)o.rotation.set(...rotation);o.castShadow=true;o.receiveShadow=true;scene.add(o);return o;}
function box(name,size,pos,m){return mesh(name,new T.BoxGeometry(...size),m,pos);}
function makeStage(){
  const floor=mesh('studio-cyclorama-floor',new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:'#31383d',roughness:.68}),[0,-.122,-3],[-Math.PI/2,0,0]);ownedMaterials.add(floor.material);floor.receiveShadow=true;
  const wall=mesh('studio-back-wall',new T.PlaneGeometry(20,10),new T.MeshStandardMaterial({color:'#46515a',roughness:.82}),[0,4.87,-2.96]);ownedMaterials.add(wall.material);wall.receiveShadow=true;
  box('display-plinth',[.62,.10,.40],[.02,.01,0],materials.frame);
  box('plinth-foot',[.70,.035,.47],[.02,-.1025,0],materials.dark);
  box('plinth-inlay',[.625,.003,.405],[.02,.062,0],materials.copper);
  for(const x of [-.23,.27])for(const z of [-.15,.15])box(`plinth-support-${x}-${z}`,[.026,.16,.026],[x,-.04,z],materials.steel);
  return floor;
}
makeStage();
const key=new T.DirectionalLight('#ffe6bd',4.1);key.position.set(-.45,.85,.5);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-.55,right:.55,top:.55,bottom:-.55,near:.05,far:2});key.shadow.normalBias=.018;scene.add(key);
const fill=new T.DirectionalLight('#c8dce8',1.75);fill.position.set(.5,.48,.28);scene.add(fill);
const rim=new T.DirectionalLight('#dfad69',2.4);rim.position.set(.1,.62,-.55);scene.add(rim);scene.add(new T.HemisphereLight('#c3d6df','#383a36',.72));
const softboxMat=new T.MeshBasicMaterial({color:'#fff0d8',toneMapped:false});ownedMaterials.add(softboxMat);const cards=[];
for(const [i,p]of [[-.42,.66,.32],[.48,.47,-.28],[.12,.84,-.42]].entries()){
  const card=mesh(`studio-softbox-${i}`,new T.PlaneGeometry(.24,.3),softboxMat,p);card.lookAt(.05,.18,0);cards.push(card);
}
const assembly=buildSliderCrank(T,{materials,crankRadius:.035,rodLength:.145,period:2.4});assembly.root.position.set(0,.178,0);scene.add(assembly.root);
const sky=createSkyEnvironment(T,{renderer,radius:5,resolution:128,zenith:'#283743',horizon:'#a0a6a3',ground:'#51504a',sunDirection:[-.55,.72,.4],sunColor:'#ffe2b2',sunIntensity:1.1});scene.add(sky.root);sky.apply(scene);scene.environmentIntensity=.72;
scene.updateMatrixWorld(true);
const probe=captureEnvironmentProbe(T,{renderer,scene,position:[0,.18,.08],resolution:128,near:.03,far:8,exclude:[assembly.root]});
for(const material of [materials.frame,materials.wheel,materials.steel,materials.copper]){material.envMap=probe.texture;material.envMapIntensity=.78;material.needsUpdate=true;}
for(const card of cards)card.visible=false;
const post=createPostPipeline(T,{EffectComposer,RenderPass,OutputPass,GTAOPass,UnrealBloomPass,SMAAPass},
  {renderer,scene,camera,width:innerWidth,height:innerHeight,pixelRatio:renderer.getPixelRatio(),ao:true,bloom:true,bloomStrength:.08,bloomThreshold:1.4,smaa:true});
const period=assembly.readState().period,filmDuration=7.2;
let time=0,playing=false,lastWall=performance.now(),alive=true,frame=0;
const $=s=>document.querySelector(s),phaseInput=$('#phase'),playButton=$('#play');
function label(text,parent,offset){const el=document.createElement('div');el.className='callout';el.textContent=text;const obj=new CSS2DObject(el);obj.position.set(...offset);parent.add(obj);return obj;}
label('透明汽缸 / BORE',assembly.root,[.19,.065,.018]);
label('连杆 / CONROD',assembly.parts.rod,[0,.026,.012]);
const pinLabel=label('曲柄销 / CRANK PIN',assembly.parts['crank-pin'],[0,.013,.012]);
const pistonLabel=label('活塞 / PISTON',assembly.parts.piston,[0,.055,.018]);
const shots=[
  {t:0,p:[.39,.24,.58],q:[.045,.18,0]},
  {t:1.7,p:[-.12,.13,.30],q:[.015,.18,.0]},
  {t:3.5,p:[.19,.12,.34],q:[.15,.17,.0]},
  {t:5.35,p:[-.25,.25,-.39],q:[.03,.17,0]},
  {t:filmDuration,p:[.39,.24,.58],q:[.045,.18,0]}
];
const smooth=t=>t*t*(3-2*t);
function cameraAt(t){let i=0;while(i<shots.length-2&&t>shots[i+1].t)i++;const a=shots[i],b=shots[i+1],u=smooth(T.MathUtils.clamp((t-a.t)/(b.t-a.t),0,1));
  camera.position.fromArray(a.p).lerp(new T.Vector3(...b.p),u);controls.target.fromArray(a.q).lerp(new T.Vector3(...b.q),u);controls.update();}
function setTime(t,{shot=false}={}){if(!Number.isFinite(t)||t<0)throw new RangeError('time must be finite and nonnegative');time=t;const s=assembly.applyState(t);
  $('#angle').textContent=`${(s.angleDegrees%360).toFixed(1)}°`;
  $('#position').textContent=`${((assembly.readState().stroke-(s.pistonX-(s.rodLength-s.crankRadius)))*1000).toFixed(1)} mm`;
  $('#velocity').textContent=`${(s.velocity*1000).toFixed(1)} mm/s`;
  $('#rodLength').textContent=`${(s.rodLength*1000).toFixed(0)} mm`;
  $('#stroke').textContent=`${(s.stroke*1000).toFixed(0)} mm`;
  phaseInput.value=String(((t%period)+period)%period);
  if(shot)cameraAt(Math.min(t,filmDuration));return s;
}
function renderNow(){renderer.info.reset();post.render();labelRenderer.render(scene,camera);}
async function renderAt(t){setTime(t,{shot:true});renderNow();
  // WebGL commands are queued; the film exporter captures the browser viewport
  // immediately after this promise resolves. Present a full frame and drain the
  // context so screenshots cannot race ahead of the new GPU image.
  await new Promise(requestAnimationFrame);renderer.getContext().finish();renderNow();await new Promise(requestAnimationFrame);
  return {complete:true,time:t};}
phaseInput.addEventListener('input',e=>{playing=false;setTime(Number(e.target.value));});
playButton.addEventListener('click',()=>{playing=!playing;lastWall=performance.now();playButton.textContent=playing?'暂停':'播放';});
$('#stepBack').addEventListener('click',()=>{playing=false;setTime((time-period/12+period)%period);});
$('#stepForward').addEventListener('click',()=>{playing=false;setTime((time+period/12)%period);});
$('#reset').addEventListener('click',()=>{playing=false;setTime(0);camera.position.set(.39,.24,.58);controls.target.set(.045,.18,0);controls.update();controls.saveState();});
$('#load').classList.add('done');
window.__FILM={duration:filmDuration,fps:24,audio:'none',capture:{mode:'awaited',timeoutMs:30000}};
window.renderAt=renderAt;
window.filmMetrics=()=>({time,state:assembly.readState(),rotationSource:'stateAt(t)',filmDuration});
window.__MECHANISM__={renderer,scene,camera,controls,labelRenderer,assembly,stateAt:assembly.stateAt,renderAt,
  dispose(){if(!alive)return;alive=false;playing=false;controls.dispose();post.dispose();probe.dispose();sky.dispose();assembly.dispose();for(const g of ownedGeometry)g.dispose();for(const t of ownedTextures)t.dispose();for(const m of ownedMaterials)m.dispose();renderer.dispose();labelRenderer.domElement.remove();}};
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);labelRenderer.setSize(innerWidth,innerHeight);post.resize(innerWidth,innerHeight,renderer.getPixelRatio());});
function fail(error){window.__fatal=String(error);$('#error').hidden=false;$('#error').textContent=String(error);}
function loop(now){if(!alive)return;const renderMode=document.body.classList.contains('render-mode');controls.enabled=!renderMode;
  if(playing&&!renderMode){const dt=Math.max(0,(now-lastWall)/1000);lastWall=now;setTime((time+dt)%period);}else lastWall=now;
  controls.update();renderer.info.reset();post.render();labelRenderer.render(scene,camera);if((frame++%30)===0)$('#play').textContent=playing?'暂停':'播放';requestAnimationFrame(loop);}
try{await renderer.compileAsync(scene,camera);setTime(0);renderNow();window.__ready=true;requestAnimationFrame(loop);}catch(error){fail(error);throw error;}
