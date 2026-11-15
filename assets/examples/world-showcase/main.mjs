import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildEnvironmentWorld} from '../environment-world.mjs';
import {createSkyEnvironment,captureEnvironmentProbe} from '../../rendering/scene-environment.mjs';

const renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.65));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.prepend(renderer.domElement);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(48,innerWidth/innerHeight,.2,700),world=buildEnvironmentWorld(T,{mergeGeometries,seed:381,configuration:'grid'});
scene.add(world.root);scene.fog=new T.FogExp2('#b7c4c0',.00155);scene.environmentIntensity=.78;
const key=new T.DirectionalLight('#ffe4b8',2.65);key.position.set(-95,145,112);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-148,right:148,top:148,bottom:-148,near:5,far:430});key.shadow.bias=-.00016;key.shadow.normalBias=.028;scene.add(key);
scene.add(new T.HemisphereLight('#c8dce7','#59634f',1.05));
const sky=createSkyEnvironment(T,{renderer,radius:520,resolution:128,zenith:'#506f86',horizon:'#d1d0bb',ground:'#707262',sunDirection:key.position.toArray(),sunIntensity:2.4});scene.add(sky.root);sky.apply(scene);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.055;controls.enablePan=false;controls.minPolarAngle=world.cameraContract.minPolarAngle;controls.maxPolarAngle=world.cameraContract.maxPolarAngle;controls.minDistance=world.cameraContract.minDistance;controls.maxDistance=world.cameraContract.maxDistance;
let viewId='overview',alive=true,paused=false,elapsed=0,lastFrame=performance.now(),probe=null;
function setView(id){const task=world.observationTasks[id];if(!task)throw new Error(`Unknown observation task: ${id}`);controls.enableDamping=false;camera.position.fromArray(task.position);controls.target.fromArray(task.target);controls.update();controls.saveState();controls.enableDamping=true;viewId=id;document.querySelector('#view').value=id;document.querySelector('#stats').textContent=statsText();}
function reset(){setView('overview');}
function showError(error){const panel=document.querySelector('#error');panel.hidden=false;panel.textContent=String(error?.stack||error);window.__ENV_FATAL__=String(error);}
function statsText(){const s=world.readState();return `sites       ${s.siteCount}\nroof tiles  ${s.roofTileInstances.toLocaleString()}\npines       ${s.treeCount}\nboulders    ${s.rockCount}\nstreet lamps ${s.lampCount}\nwater mesh  1 animated surface\nseed        ${s.seed} · r187\nview        ${viewId}`;}
document.querySelector('#view').addEventListener('change',e=>{try{setView(e.target.value);}catch(error){showError(error);}});
document.querySelector('#steam').addEventListener('input',e=>{try{world.setSteamStrength(Number(e.target.value));}catch(error){showError(error);}});
document.querySelector('#play').addEventListener('click',e=>{paused=!paused;e.currentTarget.textContent=paused?'继续动画':'暂停动画';});
document.querySelector('#reset').addEventListener('click',reset);
document.querySelector('#panelToggle').addEventListener('click',()=>{document.querySelector('#panel').classList.add('closed');document.querySelector('#showPanel').hidden=false;});
document.querySelector('#showPanel').addEventListener('click',()=>{document.querySelector('#panel').classList.remove('closed');document.querySelector('#showPanel').hidden=true;});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

function render(now){if(!alive)return;const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;if(!paused)elapsed+=dt;controls.update();if(!paused)world.update(elapsed);sky.follow(camera.position);renderer.render(scene,camera);requestAnimationFrame(render);}

try{
 reset();
 // One static local probe makes the spring read the authored buildings and
 // pavilion. It excludes the water surface being shaded; it is not screen-space reflection.
 probe=captureEnvironmentProbe(T,{renderer,scene,position:[0,2,0],resolution:64,near:.1,far:420,exclude:[world.water.mesh]});
 world.water.mesh.material.envMap=probe.texture;world.water.mesh.material.envMapIntensity=1.15;world.water.mesh.material.needsUpdate=true;
 await renderer.compileAsync(scene,camera);world.update(0);renderer.render(scene,camera);window.__ENV_WORLD__={ready:true,renderer,scene,camera,controls,world,sky,probe,
  readState:()=>({...world.readState(),camera:{position:camera.position.toArray(),target:controls.target.toArray(),azimuth:controls.getAzimuthalAngle(),polar:controls.getPolarAngle(),distance:camera.position.distanceTo(controls.target)},render:{...renderer.info.render},memory:{...renderer.info.memory}}),
  dispose(){if(!alive)return;alive=false;probe?.dispose();world.dispose();sky.dispose();controls.dispose();renderer.dispose();}};
 document.querySelector('#load').classList.add('done');requestAnimationFrame(render);
}catch(error){showError(error);document.querySelector('#load').classList.add('done');throw error;}
