import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createProceduralPalette} from '../../materials/procedural-palette.mjs';
import {createSkyEnvironment,captureEnvironmentProbe} from '../../rendering/scene-environment.mjs';
import {createPlanarReflection} from '../../rendering/planar-reflection.mjs';
import {createPostPipeline} from '../../rendering/post-pipeline.mjs';
import {createWeatherField} from '../../environment/weather-field.mjs';
import {createSceneClock,createSceneWorkbench} from '../../runtime/scene-workbench.mjs';
import {buildHingedCabinet} from '../hinged-cabinet.mjs';

// This is a mechanism study, not a universal scene style or a finished artwork.
const renderer=new T.WebGLRenderer({canvas:document.querySelector('#scene'),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
renderer.info.autoReset=false; // Reset once per frame, including reflection and post passes.
const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,innerWidth/innerHeight,.1,250);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1,0);camera.position.set(12,9,15);
controls.enableDamping=true;controls.minDistance=7;controls.maxDistance=32;controls.minPolarAngle=.3;controls.maxPolarAngle=1.4;
controls.update();controls.saveState();
const clock=createSceneClock(),palette=createProceduralPalette(T,{seed:37,resolution:256});
const state={wet:true,normals:true,environment:true},registered=[];
const recipeOptions={wood:{tileSizeMeters:[.6,1.2]},stone:{tileSizeMeters:[1,1]},'coated-metal':{tileSizeMeters:[.8,.8]}};
function surface(recipe){const mat=palette.get(recipe,{...recipeOptions[recipe],wetness:state.wet?.65:0});mat.normalScale.setScalar(state.normals?1:0);return mat;}
function box(size,position,recipe,parent=scene){
  const geometry=new T.BoxGeometry(...size),p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
  const [tileU,tileV]=recipeOptions[recipe].tileSizeMeters;
  for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i));
    const u=nx>.5?p.getZ(i):p.getX(i),v=ny>.5?p.getZ(i):p.getY(i);uv.setXY(i,u/tileU,v/tileV);}
  geometry.computeTangents();const mesh=new T.Mesh(geometry,surface(recipe));mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;
  parent.add(mesh);registered.push({mesh,recipe});return mesh;
}
const key=new T.DirectionalLight('#ffe2b0',3);key.position.set(-9,14,6);key.castShadow=true;key.shadow.mapSize.set(2048,2048);
Object.assign(key.shadow.camera,{left:-10,right:10,top:10,bottom:-10,near:1,far:35});key.shadow.normalBias=.025;scene.add(key);
scene.add(new T.HemisphereLight('#b8d3de','#4a4738',.5));
const sky=createSkyEnvironment(T,{renderer,radius:190,resolution:128,sunDirection:key.position.toArray()});scene.add(sky.root);sky.apply(scene);
scene.environmentIntensity=.65;
box([15,.38,11],[0,-.2,0],'stone');
const pavilion=new T.Group();scene.add(pavilion);
box([6,.22,4.6],[-1,.1,-.7],'stone',pavilion);
for(const x of [-3.6,1.6])for(const z of [-2.5,1.1]){
  box([.24,3.2,.24],[x,1.8,z],'wood',pavilion);
  box([.38,.18,.38],[x,.32,z],'coated-metal',pavilion);
  box([.34,.14,.34],[x,3.25,z],'coated-metal',pavilion);
}
for(const z of [-2.5,1.1])box([5.7,.3,.22],[-1,3.4,z],'wood',pavilion);
for(const x of [-3.6,1.6])box([.24,.28,4],[x,3.45,-.7],'wood',pavilion);
// Roof layers and joints create an actual opening/interior; no closed box shell.
for(let i=0;i<10;i++)box([.12,.17,4],[-3.55+i*.57,3.6,-.7],'wood',pavilion);
for(let i=0;i<18;i++)box([5.7,.06,.2],[-1,3.72,-2.55+i*.218],'wood',pavilion);
for(const z of [-1.6,-1.25,-.9])box([3.5,.09,.19],[-1.25,.78,z],'wood',pavilion);
for(const x of [-2.65,.1])box([.14,.65,.6],[x,.43,-1.25],'coated-metal',pavilion);
for(let i=0;i<5;i++)box([.9,.05,.58],[-3.2+i*.9,.03,2.4],'stone');
function cabinetSurface(recipe){const m=palette.get(recipe,{tileSizeMeters:[1,1],wetness:state.wet?.65:0});m.normalScale.setScalar(state.normals?1:0);return m;}
const cabinet=buildHingedCabinet(T,{mergeGeometries,materials:{shell:cabinetSurface('coated-metal'),trim:cabinetSurface('coated-metal'),interior:cabinetSurface('wood')},width:1.2,height:1.8,depth:.6,open:.65});
cabinet.root.traverse(o=>{if(o.isMesh){const g=o.geometry;if(!g.index)g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));g.computeTangents();}});
cabinet.root.position.set(.3,.25,-2.05);pavilion.add(cabinet.root);
const samples=new T.Group();scene.add(samples);
for(const[i,recipe]of ['wood','stone','coated-metal'].entries())box([1.05,1.4,1.05],[4,.68,-2.25+i*1.7],recipe,samples);
// Dynamic reflection target: two colored faces make a real scene mirror testable.
const marker=new T.Group();scene.add(marker);
const red=new T.MeshStandardMaterial({color:'#c55d35',roughness:.23,metalness:.25});
const beacon=new T.Mesh(new T.BoxGeometry(.55,1.25,.55),red);beacon.name='reflection-marker';beacon.position.set(2.4,.65,2.8);beacon.castShadow=true;marker.add(beacon);
const lampMat=new T.MeshStandardMaterial({color:'#ffe7bd',emissive:'#ffd09c',emissiveIntensity:4});
const lamp=new T.Mesh(new T.BoxGeometry(1.8,.08,.12),lampMat);lamp.position.set(-1,3.2,-1.4);pavilion.add(lamp);
const lampLight=new T.PointLight('#ffd09c',10,5,2);lampLight.position.copy(lamp.position).add(new T.Vector3(0,-.18,0));pavilion.add(lampLight);
const reflection=createPlanarReflection(T,{Reflector},{geometry:new T.PlaneGeometry(4.1,2.2),width:768,height:512,color:0xbac4bf});
reflection.root.rotation.x=-Math.PI/2;reflection.root.position.set(.6,.015,3.1);scene.add(reflection.root);
// Static local probe, captured after the actual frame, lights and surfaces exist.
const probeSphere=new T.Mesh(new T.SphereGeometry(.5,40,24),new T.MeshStandardMaterial({color:'#cbd4d2',roughness:.12,metalness:1}));
probeSphere.position.set(-1,1.6,-1.05);pavilion.add(probeSphere);
scene.updateMatrixWorld(true);
const probe=captureEnvironmentProbe(T,{renderer,scene,position:probeSphere.getWorldPosition(new T.Vector3()).toArray(),resolution:128,exclude:[probeSphere,reflection.root]});
probeSphere.material.envMap=probe.texture;probeSphere.material.envMapIntensity=1;
const weather=createWeatherField(T,{seed:18,count:550,extent:[19,13,17],wind:[1.2,.2],opacity:.18,
  shelterHeightAt:(x,z)=>x>=-3.9&&x<=1.9&&z>=-2.8&&z<=1.4?3.78:null});scene.add(weather.root);
const post=createPostPipeline(T,{EffectComposer,RenderPass,OutputPass,GTAOPass,UnrealBloomPass,SMAAPass},
  {renderer,scene,camera,width:innerWidth,height:innerHeight,pixelRatio:renderer.getPixelRatio(),ao:true,bloom:true,bloomStrength:.16,bloomThreshold:1.2});
function update(t){cabinet.setOpen(.55+.35*Math.sin(t*.35));beacon.rotation.y=t*.4;weather.update(t,{anchor:[0,5,0]});sky.follow(camera.position);}
function refreshSurfaces(){for(const{mesh,recipe}of registered)mesh.material=surface(recipe);
  // Cabinet receives the same shared palette objects; switches update its consumers too.
  const shell=cabinetSurface('coated-metal'),wood=cabinetSurface('wood');cabinet.root.traverse(o=>{if(o.isMesh&&o.material?.name?.startsWith('procedural:'))o.material=o.material.name.includes(':wood:')?wood:shell;});}
const effects={
  '程序法线':{get:()=>state.normals,set:v=>{state.normals=v;refreshSurfaces();}},
  '湿润配方':{get:()=>state.wet,set:v=>{state.wet=v;refreshSurfaces();}},
  '天空环境':{get:()=>state.environment,set:v=>{state.environment=v;scene.environment=v?sky.texture:null;}},
  '局部探针':{get:()=>probeSphere.material.envMap===probe.texture,set:v=>{probeSphere.material.envMap=v?probe.texture:null;probeSphere.material.needsUpdate=true;}},
  '平面反射':{get:()=>reflection.readState().enabled,set:v=>reflection.setEnabled(v)},
  '视觉雨':{get:()=>weather.readState().enabled,set:v=>weather.setEnabled(v)},
  '接触AO':{get:()=>post.passes.ao.enabled,set:v=>post.setEnabled('ao',v)},
  '高亮Bloom':{get:()=>post.passes.bloom.enabled,set:v=>post.setEnabled('bloom',v)}
};
const modes={
  '完整关系':()=>{pavilion.visible=samples.visible=marker.visible=true;controls.target.set(0,1,0);camera.position.set(12,9,15);controls.update();},
  '结构样件':()=>{pavilion.visible=true;samples.visible=marker.visible=false;controls.target.set(-1,1.8,-.7);camera.position.set(5,4.5,7);controls.update();},
  '材质样片':()=>{pavilion.visible=false;samples.visible=true;marker.visible=false;controls.target.set(4,.9,-.5);camera.position.set(7,3.3,4);controls.update();}
};
const workbench=createSceneWorkbench(T,{renderer,camera,controls,clock,effects,modes,onTime:update});workbench.mount();
workbench.setMode('完整关系');workbench.setTime(12);
document.querySelector('#reset').onclick=()=>{workbench.setMode('完整关系');};
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);post.resize(innerWidth,innerHeight,renderer.getPixelRatio());});
let alive=true;function render(){if(!alive)return;const {time,dt}=clock.tick(performance.now()/1000);controls.update();update(time);renderer.info.reset();post.render(dt);requestAnimationFrame(render);}
window.__lab={THREE:T,renderer,scene,camera,controls,workbench,palette,sky,probe,reflection,weather,post,registered,update,
  dispose(){if(!alive)return;alive=false;workbench.dispose();controls.dispose();weather.dispose();reflection.dispose();reflection.root.geometry.dispose();probe.dispose();sky.dispose();post.dispose();cabinet.dispose();cabinet.root.removeFromParent();
    const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material&&!o.material.name?.startsWith('procedural:'))materials.add(o.material);});
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();palette.dispose();renderer.dispose();}};
try{await renderer.compileAsync(scene,camera);render();window.__ready=true;}
catch(error){window.__fatal=String(error);document.querySelector('#error').hidden=false;document.querySelector('#error').textContent=String(error);throw error;}
