import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createContourRelation} from '../contour-relations.mjs';
import {createResourceScope} from '../../runtime/resource-scope.mjs';
import {createAssetSlot} from '../../runtime/asset-slot.mjs';
import {createLightingRig} from '../../rendering/lighting-rig.mjs';
import {createSkyEnvironment} from '../../rendering/scene-environment.mjs';
const $=id=>document.getElementById(id),owner=createResourceScope();
let disposed=false,renderCount=0,error=null,replacementStatus='committed',slot,renderer,controls,sky,rig,camera;
const parameters={spanX:1,spanY:1,sectionWidth:1,sectionHeight:1};
let selected={id:'opening-bearing',mode:'profile'},viewName='front';
const design=await fetch('../contour-relations-design.json').then(r=>{if(!r.ok)throw Error(`Design HTTP ${r.status}`);return r.json();});
const contract=design.renderContract;
if(String(T.REVISION)!=='187')throw Error('Contour lab requires Three/addons r187');
const scene=new T.Scene(),materials={};
try{
 // Parse the frozen recipes before allocation. Providers are owned before
 // dependents so reverse cleanup releases materials while renderer state lives.
 const recipes=Object.entries(contract.materials).map(([role,recipe])=>{
  const match=recipe.match(/(#[a-f0-9]{6}) roughness([.\d]+) metalness([.\d]+)/i);
  if(!match)throw Error(`Unrecognized registered material ${role}`);
  return {role,color:match[1],roughness:Number(match[2]),metalness:Number(match[3])};
 });
 renderer=owner.own(new T.WebGLRenderer({antialias:true}));renderer.setPixelRatio(contract.DPR);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;
 renderer.toneMappingExposure=contract.lighting.exposure;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.prepend(renderer.domElement);
 owner.defer(()=>renderer.domElement.remove());owner.defer(()=>renderer.setAnimationLoop(null));
 for(const {role,...recipe}of recipes)materials[role]=owner.own(new T.MeshStandardMaterial(recipe));
 // This scene has only opaque rigid meshes: no displacement, skin or morph.
 // The renderer's default shadow material has no public owner release path.
 const rigidDepth=owner.own(new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking}));
 const match=contract.camera.match(/FOV([\d.]+) near([\d.]+) far([\d.]+)/);if(!match)throw Error('Unrecognized registered camera');
 camera=new T.PerspectiveCamera(...[Number(match[1]),innerWidth/innerHeight,Number(match[2]),Number(match[3])]);
 controls=owner.own(new OrbitControls(camera,renderer.domElement));controls.enableDamping=false;controls.minDistance=.7;controls.maxDistance=12;controls.minPolarAngle=0;controls.maxPolarAngle=Math.PI;controls.enablePan=true;
 // Fit once to the union of actual default geometry. Never refit between A/B.
 const fixedBounds=new T.Box3();
 for(const example of design.examples)for(const mode of ['plain','profile']){
  const temporary=createContourRelation(T,{design,id:example.id,mode,materials});try{fixedBounds.union(new T.Box3().setFromObject(temporary.root));}finally{temporary.dispose();}
 }
 const {keyDirection,keyColor,keyIntensity,fillColor,fillIntensity,ambientIntensity,shadowMapSize}=contract.lighting;
 rig=owner.own(createLightingRig(T,{bounds:fixedBounds,keyDirection,keyColor,keyIntensity,fillColor,fillIntensity,ambientIntensity,shadowMapSize}));scene.add(rig.root);
 // The helper's native gradient defaults are source-bound. One private sky-only
 // capture is retained through every structural/mode replacement; no world probe.
 sky=owner.own(createSkyEnvironment(T,{renderer,radius:camera.far*.5,sunDirection:keyDirection,sunColor:keyColor,sunIntensity:keyIntensity}));scene.add(sky.root);sky.apply(scene);
 slot=owner.own(createAssetSlot(scene));
 const listen=(element,event,callback)=>{element.addEventListener(event,callback);owner.defer(()=>element.removeEventListener(event,callback));};
 function status(){const s=slot.current?.readState();$('status').textContent=disposed?'已退出；渲染、监听、资源已释放':`${s?.id} / ${s?.mode}\nrevision ${slot.revision} · ${s?.triangles} triangles\n${viewName==='custom'?'自由镜头':viewName} · ${isFrozen()?'登记默认参数':'自定义结构/材质'}${error?`\n${replacementStatus==='committed-with-cleanup-error'?'已提交新版本，旧资源清理报错':'候选失败，保留上一版本'}：${error}`:''}`;}
 function isFrozen(){return Object.values(parameters).every(v=>v===1)&&materials.frame.roughness===initialRoughness;}
 const initialRoughness=materials.frame.roughness;
 function sync(){
  $('relation').value=selected.id;$('mode').value=selected.mode;
  for(const [key,value]of Object.entries(parameters)){
   const input=$(key);input.step='any';if(value<Number(input.min))input.min=String(value);if(value>Number(input.max))input.max=String(value);input.value=value;$(`${key}-value`).value=value.toFixed(2);
  }
  $('roughness').value=materials.frame.roughness;$('roughness-value').value=String(materials.frame.roughness);
 }
 function rebuild(change={}){
  if(disposed)throw Error('Contour lab is disposed');
  const next={...selected,...change},beforeRevision=slot.revision,previousId=slot.current?.readState().id;
  let failure=null;
  try{
   const patch=change.parameters??{};if(typeof patch!=='object'||Array.isArray(patch))throw new TypeError('parameters must be an object');
   const keys=Reflect.ownKeys(patch);for(const key of keys)if(typeof key!=='string'||!Object.hasOwn(parameters,key))throw new RangeError(`Unknown structural parameter: ${String(key)}`);
   const nextParams={...parameters,...Object.fromEntries(keys.map(key=>[key,patch[key]]))};
   slot.replace(scope=>{
    const asset=scope.own(createContourRelation(T,{design,id:next.id,mode:next.mode,parameters:nextParams,materials}));
    asset.root.traverse(node=>{if(node.isMesh&&node.castShadow)node.customDepthMaterial=rigidDepth;});
    return asset;
   });
  }
  catch(caught){failure=caught;}
  // The slot commits BEFORE retiring its prior scope. A cleanup exception does
  // not roll back the new asset. Derive UI state from its authoritative handle.
  const committed=slot.revision!==beforeRevision,current=slot.current?.readState();
  if(current){selected={id:current.id,mode:current.mode};Object.assign(parameters,current.parameters);}
  if(committed&&current.id!==previousId)viewName='custom';
  replacementStatus=committed?(failure?'committed-with-cleanup-error':'committed'):'rejected';
  error=failure?String(failure.message):null;
  // DOM failures must never be reported as a geometry build rollback.
  viewOptions();sync();status();return committed;
 }
 function setView(name){
  if(disposed)throw Error('Contour lab is disposed');const views=design.examples.find(x=>x.id===selected.id).camera,pose=Object.hasOwn(views,name)?views[name]:null;if(!pose)throw Error(`Unknown registered view ${name}`);
  camera.position.set(...pose.position);controls.target.set(...pose.target);controls.update();
  const difference=Math.max(camera.position.distanceTo(new T.Vector3(...pose.position)),controls.target.distanceTo(new T.Vector3(...pose.target)));
  if(difference>1e-8){viewName='custom';$('view').value='custom';status();throw Error(`Registered camera was changed by controls: ${difference} m`);}
  viewName=name;$('view').value=name;status();
 }
 function viewOptions(){const views=design.examples.find(x=>x.id===selected.id).camera;$('view').replaceChildren(Object.assign(document.createElement('option'),{value:'custom',textContent:'自由镜头',disabled:true}),...Object.keys(views).map(name=>Object.assign(document.createElement('option'),{value:name,textContent:name})));$('view').value=viewName;}
 function reset(){if(disposed)throw Error('Contour lab is disposed');materials.frame.roughness=initialRoughness;rebuild({id:'opening-bearing',mode:'profile',parameters:{spanX:1,spanY:1,sectionWidth:1,sectionHeight:1}});viewOptions();setView('front');}
 function dispose(){if(disposed)return;disposed=true;renderer.setAnimationLoop(null);owner.dispose();document.querySelectorAll('aside input,aside select,aside button').forEach(x=>x.disabled=true);status();}
 listen($('relation'),'change',()=>{if(rebuild({id:$('relation').value}))setView(Object.keys(design.examples.find(x=>x.id===selected.id).camera)[0]);});
 listen($('mode'),'change',()=>rebuild({mode:$('mode').value}));listen($('view'),'change',()=>{if($('view').value!=='custom')setView($('view').value);});
 for(const key of Object.keys(parameters))listen($(key),'input',()=>rebuild({parameters:{[key]:Number($(key).value)}}));
 listen($('roughness'),'input',()=>{materials.frame.roughness=Number($('roughness').value);sync();status();});
 listen($('reset'),'click',reset);listen($('camera-reset'),'click',()=>setView(Object.keys(design.examples.find(x=>x.id===selected.id).camera)[0]));
 listen($('invalid'),'click',()=>rebuild({parameters:{sectionWidth:0}}));listen($('repeat'),'click',()=>{for(let i=0;i<10;i++)rebuild();});listen($('exit'),'click',dispose);
 listen(controls,'change',()=>{viewName='custom';$('view').value='custom';status();});
 const resize=()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();};listen(window,'resize',resize);listen(window,'pagehide',dispose);resize();
 window.__CONTOUR_LAB__={
  readState(){return {disposed,renderCount,revision:slot.revision,error,replacementStatus,selected:{...selected},parameters:{...parameters},frozenParameters:isFrozen(),view:viewName,
   asset:slot.current?.readState()??null,camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:controls.target.toArray(),fov:camera.fov,near:camera.near,far:camera.far,aspect:camera.aspect},
   controls:{minDistance:controls.minDistance,maxDistance:controls.maxDistance,minPolarAngle:controls.minPolarAngle,maxPolarAngle:controls.maxPolarAngle},
   materials:Object.fromEntries(Object.entries(materials).map(([role,m])=>[role,{uuid:m.uuid,color:m.color.getHexString(),roughness:m.roughness,metalness:m.metalness}])),
   renderer:{width:renderer.domElement.width,height:renderer.domElement.height,dpr:renderer.getPixelRatio(),exposure:renderer.toneMappingExposure,memory:{...renderer.info.memory},calls:renderer.info.render.calls,programs:renderer.info.programs.length},
   shadowDepth:{uuid:rigidDepth.uuid,depthPacking:rigidDepth.depthPacking},
   lighting:rig.readState(),sky:sky.readState(),owner:owner.inspect()};},
  reset,rebuild,setView,dispose,
  setUIVisible(visible){document.body.classList.toggle('ui-hidden',!visible);},
  setRoughness(value){if(disposed)throw Error('Contour lab is disposed');if(!Number.isFinite(value)||value<0||value>1)throw Error('roughness must be [0,1]');materials.frame.roughness=value;sync();status();}
 };
 reset();renderer.setAnimationLoop(()=>{if(disposed)return;sky.follow(camera.position);renderer.render(scene,camera);renderCount++;});
}catch(failure){error=String(failure.stack??failure);try{owner.dispose();}catch(cleanup){error+=`\nCleanup: ${cleanup}`;}$('status').textContent=error;throw failure;}
