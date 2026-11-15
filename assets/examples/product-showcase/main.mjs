import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {createSkyEnvironment,captureEnvironmentProbe} from '../../rendering/scene-environment.mjs';
import {createPostPipeline} from '../../rendering/post-pipeline.mjs';
import {buildProductCamera} from '../product-camera.mjs';

const canvas=document.querySelector('#scene')??document.createElement('canvas');
const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.info.autoReset=false;
const scene=new T.Scene();scene.background=new T.Color('#202831');
const camera=new T.PerspectiveCamera(34,innerWidth/innerHeight,.01,80);camera.position.set(.30,.255,.39);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.17,0);controls.enableDamping=true;
controls.minDistance=.23;controls.maxDistance=1.05;controls.minPolarAngle=.22;controls.maxPolarAngle=1.52;controls.update();controls.saveState();
const ownedGeometry=new Set(),ownedMaterials=new Set(),ownedTextures=new Set();
function makeFinish(hex,{metalness=0,roughness=.4,clearcoat=0,seed=1,grain=.07}={}){
  const c=document.createElement('canvas');c.width=c.height=256;const cx=c.getContext('2d'),base=new T.Color(hex).getHex(T.SRGBColorSpace);
  const baseRGB=[(base>>16&255)/255,(base>>8&255)/255,(base&255)/255];
  const image=cx.createImageData(256,256),rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<image.data.length;i+=4){const n=(rand()-.5)*grain,shade=(1+n)*255;image.data[i]=Math.max(0,Math.min(255,baseRGB[0]*shade));image.data[i+1]=Math.max(0,Math.min(255,baseRGB[1]*shade));image.data[i+2]=Math.max(0,Math.min(255,baseRGB[2]*shade));image.data[i+3]=255;}
  cx.putImageData(image,0,0);const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.repeat.set(2,2);map.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);ownedTextures.add(map);
  const mat=new T.MeshPhysicalMaterial({color:'#ffffff',map,metalness,roughness,clearcoat,clearcoatRoughness:.2});ownedMaterials.add(mat);return mat;
}
const screenCanvas=document.createElement('canvas');screenCanvas.width=512;screenCanvas.height=256;
const sc=screenCanvas.getContext('2d'),gradient=sc.createLinearGradient(0,0,512,256);gradient.addColorStop(0,'#17282d');gradient.addColorStop(1,'#283b3d');sc.fillStyle=gradient;sc.fillRect(0,0,512,256);
sc.strokeStyle='#d1ba8a';sc.lineWidth=2;sc.strokeRect(16,16,480,224);sc.fillStyle='#e6dbbf';sc.font='600 22px ui-monospace,monospace';sc.fillText('LUMEN  /  35',32,58);sc.font='16px ui-monospace,monospace';sc.fillStyle='#9fb7b0';sc.fillText('ISO  400        1/125',32,102);sc.fillText('F  2.8           0.8m',32,136);sc.fillStyle='#d2a963';sc.fillRect(32,170,265,4);sc.fillRect(32,182,194,3);
const screenTexture=new T.CanvasTexture(screenCanvas);screenTexture.colorSpace=T.SRGBColorSpace;ownedTextures.add(screenTexture);
const mats={
  shell:makeFinish('#22292a',{metalness:.72,roughness:.28,clearcoat:.7,seed:39,grain:.08}),
  trim:makeFinish('#aa8953',{metalness:.86,roughness:.23,clearcoat:.4,seed:81,grain:.035}),
  rubber:makeFinish('#121515',{metalness:.04,roughness:.78,seed:115,grain:.16}),
  glass:new T.MeshPhysicalMaterial({color:'#b2d7dd',metalness:.15,roughness:.07,clearcoat:1,clearcoatRoughness:.045,reflectivity:.9,ior:1.5}),
  screen:new T.MeshPhysicalMaterial({color:'#ffffff',map:screenTexture,metalness:.08,roughness:.22,emissive:'#16272a',emissiveIntensity:.45}),
  marking:new T.MeshStandardMaterial({color:'#e4d8b9',metalness:.2,roughness:.38}),
  dark:new T.MeshStandardMaterial({color:'#080c0d',metalness:.28,roughness:.25})
};
for(const m of Object.values(mats))ownedMaterials.add(m);

// Seamless floor-to-wall cyclorama: a sampled quarter-round profile rather
// than two planes meeting at a visible horizon.
function makeCyclorama(){
  const profile=[];for(let i=0;i<=20;i++)profile.push([8-i*.45,0]);
  for(let i=1;i<=16;i++){const a=(i/16)*Math.PI/2;profile.push([-1-Math.sin(a),1-Math.cos(a)]);}
  for(let i=1;i<=16;i++)profile.push([-2,1+i*.5]);
  const positions=[],indices=[],width=20;
  for(const [z,y]of profile){positions.push(-width/2,y,z,width/2,y,z);}
  for(let i=0;i<profile.length-1;i++){const a=i*2;indices.push(a,a+1,a+3,a,a+3,a+2);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();ownedGeometry.add(g);return g;
}
const cyclorama=new T.Mesh(makeCyclorama(),new T.MeshStandardMaterial({color:'#59616a',roughness:.82,metalness:.03,side:T.DoubleSide}));
ownedMaterials.add(cyclorama.material);cyclorama.name='continuous-studio-cyclorama';cyclorama.receiveShadow=true;scene.add(cyclorama);

const key=new T.DirectionalLight('#fff0d4',4.2);key.position.set(-.45,.8,.55);key.castShadow=true;key.shadow.mapSize.set(2048,2048);
Object.assign(key.shadow.camera,{left:-.42,right:.42,top:.42,bottom:-.42,near:.05,far:2});key.shadow.normalBias=.018;key.shadow.bias=-.00008;scene.add(key);
const fill=new T.DirectionalLight('#c4d6e5',1.8);fill.position.set(.55,.4,.15);scene.add(fill);
const rim=new T.DirectionalLight('#e2bd7b',3.0);rim.position.set(.12,.55,-.5);scene.add(rim);
scene.add(new T.HemisphereLight('#c5d6df','#34383c',.72));
const softboxMat=new T.MeshBasicMaterial({color:'#fff3dc',toneMapped:false});ownedMaterials.add(softboxMat);
const softboxes=[];
for(const [i,p]of [[-.42,.62,.36],[.48,.5,-.22],[0,.8,-.48]].entries()){
  const card=new T.Mesh(new T.PlaneGeometry(.24,.32),softboxMat);ownedGeometry.add(card.geometry);card.position.set(...p);card.lookAt(0,.15,0);card.name=`studio-softbox-${i}`;scene.add(card);softboxes.push(card);
}
// Dark, tiered pedestal with machined edge rings grounds the object in space.
function cyl(name,r,h,y,material,segments=96){const g=new T.CylinderGeometry(r,r,h,segments,1);ownedGeometry.add(g);const m=new T.Mesh(g,material);m.name=name;m.position.y=y;m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;}
const podiumMat=makeFinish('#252a2c',{metalness:.68,roughness:.34,seed:191,grain:.06});
cyl('pedestal-foot',.105,.025,.031,podiumMat);cyl('pedestal-neck',.009,.052,.069,mats.dark,48);cyl('turntable',.096,.009,.099,podiumMat);
const stageRing=new T.Mesh(new T.TorusGeometry(.091,.0012,8,128),mats.trim);stageRing.name='turntable-machined-rim';stageRing.rotation.x=Math.PI/2;stageRing.position.y=.104;stageRing.castShadow=true;scene.add(stageRing);ownedGeometry.add(stageRing.geometry);
const product=buildProductCamera(T,{materials:mats});product.root.position.y=.104;scene.add(product.root);product.setFocus(.28);
const sky=createSkyEnvironment(T,{renderer,radius:8,resolution:128,zenith:'#283443',horizon:'#929ba0',ground:'#474c4f',sunDirection:[-.5,.7,.4],sunColor:'#ffe0ae',sunIntensity:1.3});scene.add(sky.root);sky.apply(scene);
scene.environmentIntensity=.72;
scene.updateMatrixWorld(true);
const probe=captureEnvironmentProbe(T,{renderer,scene,position:[0,.17,.08],resolution:128,near:.02,far:8,exclude:[product.root]});
for(const material of [mats.shell,mats.trim,mats.glass]){material.envMap=probe.texture;material.envMapIntensity=material===mats.glass?1.35:.8;material.needsUpdate=true;}
// Probe capture reads the cards, while the finished camera view keeps the
// physical emitters out of frame. Their light contribution remains explicit.
for(const card of softboxes)card.visible=false;
const post=createPostPipeline(T,{EffectComposer,RenderPass,OutputPass,GTAOPass,UnrealBloomPass,SMAAPass},
  {renderer,scene,camera,width:innerWidth,height:innerHeight,pixelRatio:renderer.getPixelRatio(),ao:true,bloom:true,bloomStrength:.09,bloomThreshold:1.35,smaa:true});

const views={
  hero:{position:[.30,.255,.39],target:[0,.17,0]},
  front:{position:[-.02,.18,.31],target:[-.01,.16,.035]},
  rear:{position:[-.04,.18,-.30],target:[0,.16,-.015]},
  top:{position:[.12,.50,.28],target:[0,.15,0]}
};
function setView(name){const v=views[name];if(!v)throw new RangeError(`unknown view ${name}`);camera.position.fromArray(v.position);controls.target.fromArray(v.target);controls.update();}
setView('hero');controls.saveState();
const stats=document.querySelector('#stats');
function drawStats(){const info=renderer.info;stats.textContent=`部件网格：${Object.keys(product.parts).length}\n三角面：${info.render.triangles.toLocaleString()}\n绘制调用：${info.render.calls}\n焦点行程：${(product.readState().focusTravel*1000).toFixed(1)} mm\n环境探针：静态局部 PMREM · 128²\n后期：AO + 低强度 Bloom + SMAA`;}
document.querySelector('#focus').addEventListener('input',e=>product.setFocus(Number(e.target.value)));
document.querySelector('#view').addEventListener('change',e=>setView(e.target.value));
document.querySelector('#reset').addEventListener('click',()=>{controls.reset();document.querySelector('#view').value='hero';});
document.querySelector('#load').classList.add('done');
let alive=true,frame=0;
function render(){if(!alive)return;controls.update();renderer.info.reset();post.render();if((frame++%20)===0)drawStats();requestAnimationFrame(render);}
function fail(error){window.__fatal=String(error);const el=document.querySelector('#error');el.hidden=false;el.textContent=String(error);}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);post.resize(innerWidth,innerHeight,renderer.getPixelRatio());});
try{await renderer.compileAsync(scene,camera);renderer.render(scene,camera);window.__ready=true;requestAnimationFrame(render);}catch(error){fail(error);throw error;}
window.__PRODUCT_SHOWCASE__={renderer,scene,camera,controls,product,probe,post,
  dispose(){if(!alive)return;alive=false;controls.dispose();post.dispose();probe.dispose();sky.dispose();product.dispose();for(const g of ownedGeometry)g.dispose();for(const t of ownedTextures)t.dispose();for(const m of ownedMaterials)m.dispose();renderer.dispose();}};
