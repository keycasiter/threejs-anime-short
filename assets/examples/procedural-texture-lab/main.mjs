import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createSkyEnvironment} from '../../rendering/scene-environment.mjs';
import {createResourceScope} from '../../runtime/resource-scope.mjs';
import {createRegionMaterial} from '../../materials/surface-fields.mjs';
import {createProceduralAudio} from '../../audio/procedural-audio.mjs';

const owner=createResourceScope();
const renderer=owner.own(new T.WebGLRenderer({antialias:true}));
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);owner.defer(()=>renderer.domElement.remove());
const scene=new T.Scene();scene.background=new T.Color('#202a2c');
const camera=new T.PerspectiveCamera(38,innerWidth/innerHeight,.1,100);camera.position.set(8.5,7.3,10.5);
const controls=owner.own(new OrbitControls(camera,renderer.domElement));controls.target.set(0,.2,0);controls.enableDamping=true;controls.minDistance=5;controls.maxDistance=24;controls.maxPolarAngle=Math.PI*.49;controls.update();
const sky=owner.own(createSkyEnvironment(T,{renderer,resolution:96,radius:80,zenith:'#637b82',horizon:'#d4bd93',ground:'#39413c',sunDirection:[-.65,.82,.42]}));
scene.add(sky.root);sky.apply(scene);scene.environmentIntensity=.8;
scene.add(new T.HemisphereLight(0xe7f0e8,0x303b39,1.1));
const key=new T.DirectionalLight(0xffd7a1,3.2);key.position.set(-4,8,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-8;key.shadow.camera.right=8;key.shadow.camera.top=8;key.shadow.camera.bottom=-8;scene.add(key);
const fill=new T.DirectionalLight(0x9ab7d0,1.15);fill.position.set(5,4,-3);scene.add(fill);

function makePlaneGeometry() {
  const g=new T.PlaneGeometry(6,6,1,1),uv=g.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*6,uv.getY(i)*6);
  uv.needsUpdate=true;g.rotateX(-Math.PI/2);g.computeVertexNormals();g.computeBoundingSphere();return owner.own(g);
}
const plateGeometry=makePlaneGeometry();
const plate=new T.Mesh(plateGeometry,new T.MeshStandardMaterial({color:0x777777,roughness:1}));plate.position.y=.08;plate.receiveShadow=true;scene.add(plate);
const calibration=new T.Group();scene.add(calibration);
function addSphere(x,z,color,roughness,metalness,radius=.36){
  const material=new T.MeshStandardMaterial({color,roughness,metalness});owner.own(material);
  const mesh=new T.Mesh(owner.own(new T.SphereGeometry(radius,48,32)),material);mesh.position.set(x,.08+radius,z);mesh.castShadow=true;mesh.receiveShadow=true;calibration.add(mesh);return mesh;
}
addSphere(-2.1,-2.05,'#c28a58',.24,.84);addSphere(-1.15,-2.05,'#9caa9b',.79,.05);addSphere(-.2,-2.05,'#6d9292',.43,.5);
const baseMaterial=owner.own(new T.MeshStandardMaterial({color:'#323b3a',roughness:.86,metalness:.08}));
const base=owner.own(new T.Mesh(new T.BoxGeometry(6.3,.3,6.3),baseMaterial));base.position.y=-.075;base.receiveShadow=true;base.castShadow=true;scene.add(base);
const state={resolution:256,sampling:'mipmap',wrap:'repeat',error:null,rebuilds:0,audioEnabled:false,muted:false,audioPaused:false};
let currentSurface=null,activeMaterial=plate.material;
owner.defer(()=>currentSurface?.dispose());

function smooth(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
function surfaceField(p){
  const {x,y,u,v}=p;
  const grain=Math.sin(2*Math.PI*(.31*y+.075*Math.sin(2*Math.PI*.23*x)));
  const pores=Math.sin(2*Math.PI*(1.7*x+1.3*y))*Math.sin(2*Math.PI*(1.1*x-1.9*y));
  const oxideBand=.5+.5*Math.sin(2*Math.PI*(.19*x+.14*y)+.65*Math.sin(2*Math.PI*.16*x));
  const oxidation=smooth(.54,.79,oxideBand+.1*grain);
  const copper=new T.Color('#aa6d3f'),patina=new T.Color('#4f8b7b');
  const color=copper.lerp(patina,oxidation).multiplyScalar(.94+.06*pores);
  const height=.012*grain+.004*pores+.018*(oxidation-.5);
  const roughness=Math.max(.16,Math.min(.9,.27+.48*oxidation+.035*pores));
  const metalness=.88-.58*oxidation;
  return {color,roughness,metalness,height};
}
function applySampling(surface,mode){
  const minFilter=mode==='mipmap'?T.LinearMipmapLinearFilter:mode==='nearest'?T.NearestFilter:T.LinearFilter;
  const magFilter=mode==='nearest'?T.NearestFilter:T.LinearFilter;
  for(const texture of Object.values(surface.maps)){texture.minFilter=minFilter;texture.magFilter=magFilter;texture.generateMipmaps=mode==='mipmap';texture.needsUpdate=true;}
}
function buildSurface(){
  const next=createRegionMaterial(T,{width:state.resolution,height:state.resolution,physicalSize:[1,1],wrapU:state.wrap,wrapV:state.wrap,regionAt:surfaceField});
  try{applySampling(next,state.sampling);}catch(error){next.dispose();throw error;}
  const previous=currentSurface;currentSurface=next;activeMaterial=next.material;plate.material=activeMaterial;previous?.dispose();state.rebuilds++;
  report();
}
const status=document.querySelector('#status');
function report(){
  status.textContent=JSON.stringify({renderer:'Three.js r187 WebGLRenderer',webgl2:renderer.getContext() instanceof WebGL2RenderingContext,
    geometry:{worldMeters:[6,6],uvRepeats:[6,6]},texture:currentSurface?{...currentSurface.metadata,resolution:`${state.resolution}²`,sampling:state.sampling,
      colorSpace:currentSurface.maps.map.colorSpace,roughnessChannel:'G / NoColorSpace',metalnessChannel:'B / NoColorSpace',wrap:state.wrap,
      minFilter:currentSurface.maps.map.minFilter,magFilter:currentSurface.maps.map.magFilter,mipmaps:currentSurface.maps.map.generateMipmaps}:null,
    rebuilds:state.rebuilds,audio:audio.readState(),error:state.error},null,2);
}
const audio=createProceduralAudio();
function run(action){try{const result=action();state.error=null;if(result?.then)result.then(report).catch(error=>{state.error=error.message;console.error(error);report();});}catch(error){state.error=error.message;console.error(error);}report();}
function listen(element,event,callback){element.addEventListener(event,callback);owner.defer(()=>element.removeEventListener(event,callback));}
listen(document.querySelector('#resolution'),'change',event=>{state.resolution=Number(event.target.value);run(buildSurface);});
listen(document.querySelector('#sampling'),'change',event=>{state.sampling=event.target.value;run(()=>{if(!currentSurface)buildSurface();else applySampling(currentSurface,state.sampling);});});
listen(document.querySelector('#wrap'),'change',event=>{state.wrap=event.target.value;run(buildSurface);});
listen(document.querySelector('#rebuild'),'click',()=>run(buildSurface));
listen(document.querySelector('#reset'),'click',()=>{controls.reset();});
listen(document.querySelector('#audioStart'),'click',()=>run(async()=>{await audio.start();state.audioEnabled=true;}));
listen(document.querySelector('#audioPause'),'click',()=>run(async()=>{
  if(audio.readState().contextState==='not-created')await audio.start();
  state.audioEnabled=true;
  state.audioPaused=!state.audioPaused;
  if(state.audioPaused)await audio.pause();else await audio.resume();
  document.querySelector('#audioPause').textContent=state.audioPaused?'恢复音频':'暂停音频';
}));
listen(document.querySelector('#audioCue'),'click',()=>run(async()=>{await audio.trigger({frequency:392,duration:.34,gain:.1,position:[2,1,-2],wave:'triangle'});}));
listen(document.querySelector('#audioNoise'),'click',()=>run(async()=>{await audio.triggerNoise({duration:.28,gain:.08,position:[-2,.5,-1],seed:1701,when:undefined});}));
listen(document.querySelector('#audioMute'),'click',()=>run(()=>{state.muted=!state.muted;audio.setMuted(state.muted);document.querySelector('#audioMute').textContent=state.muted?'取消静音':'静音';}));
listen(window,'resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
owner.defer(()=>audio.dispose());
let frame;function draw(){controls.update();sky.follow(camera.position);renderer.render(scene,camera);frame=requestAnimationFrame(draw);}
owner.defer(()=>cancelAnimationFrame(frame));
buildSurface();frame=requestAnimationFrame(draw);
window.__PROCEDURAL_TEXTURE_LAB__={readState:()=>JSON.parse(status.textContent),getRuntime:()=>({renderer,scene,camera,controls,plate,currentSurface}),dispose:()=>owner.dispose()};
listen(window,'pagehide',()=>owner.dispose());
