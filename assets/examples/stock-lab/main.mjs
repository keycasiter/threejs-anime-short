import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import design from '../stock-relations-design.json' with {type:'json'};
import {buildStockRelation,createStockProfiles,createStockController} from '../stock-relations.mjs';
import {createLookPalette} from '../../materials/look-palette.mjs';
import {createFormationPalette} from '../../materials/formation-palette.mjs';
import {createResourceScope} from '../../runtime/resource-scope.mjs';
import {createLightingRig} from '../../rendering/lighting-rig.mjs';
import {createSkyEnvironment} from '../../rendering/scene-environment.mjs';
const $=id=>document.getElementById(id),owner=createResourceScope(),scene=new T.Scene();
const contract=design.renderConditions,common=design.cameraCommon,ownedpalettes={},rigs={};
let renderer,camera,controls,sky,controller,depth,disposed=false,renderCount=0,view='near',error=null,activeRig=null,replacementStatus='committed';
const alive=()=>{if(disposed)throw new Error('Stock lab is disposed');};
try{
 if(String(T.REVISION)!=='180')throw new Error('Stock lab requires the same Three/addons r180');
 // Renderer is the longest-lived provider and is released last by the LIFO owner.
 renderer=owner.own(new T.WebGLRenderer({antialias:true}));renderer.setPixelRatio(common.DPR);renderer.setSize(...common.viewport,false);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;document.body.prepend(renderer.domElement);owner.defer(()=>renderer.domElement.remove());
 sky=owner.own(createSkyEnvironment(T,{renderer,...contract.sky}));scene.add(sky.root);sky.apply(scene);scene.environmentIntensity=contract.environmentIntensity;scene.fog=null;
 for(const look of common.looks){
  const base=owner.own(createLookPalette(T,{mode:look,seed:contract.sceneSeed,resolution:contract.mapsResolution}));
  const formed=owner.own(createFormationPalette(T,{basePalette:base,profiles:createStockProfiles(T,look),applyWhen:'unmapped'}));ownedpalettes[look]={base,formed};
 }
 depth=owner.own(new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking}));
 camera=new T.PerspectiveCamera(common.fovYDegrees,common.viewport[0]/common.viewport[1],common.nearM,common.farM);
 controls=owner.own(new OrbitControls(camera,renderer.domElement));controls.enableDamping=false;controls.enablePan=true;controls.minDistance=.25;controls.maxDistance=12;controls.minPolarAngle=0;controls.maxPolarAngle=Math.PI;
 // Same frozen, actual relation bounds for both looks. Rigs are retained so a
 // numeric recipe change never recreates lighting or shadow storage.
 for(const kind of ['B1','B2']){
  const temp=buildStockRelation(T,{kind,materialFor:(r,o,k)=>ownedpalettes.pbr.formed.get(r,o,k)});let bounds;try{bounds=new T.Box3().setFromObject(temp.root);}finally{temp.dispose();}
  for(const look of common.looks){
   const [keyIntensity,fillIntensity,ambientIntensity,hemisphereIntensity]=contract.rig[look];
   const rig=owner.own(createLightingRig(T,{bounds,keyDirection:contract.rig.keyDirection,keyIntensity,fillIntensity,ambientIntensity,hemisphereIntensity,skyColor:contract.rig[look==='pbr'?'skyColorPbr':'skyColorToon'],groundColor:contract.rig[look==='pbr'?'groundColorPbr':'groundColorToon'],shadowMapSize:contract.rig.shadowMapSize}));rig.root.visible=false;scene.add(rig.root);rigs[kind+':'+look]=rig;
  }
 }
 controller=owner.own(createStockController(T,{scene,palettes:ownedpalettes}));
 function bindDepth(){for(const {object}of controller.current.materialBindings)object.customDepthMaterial=depth;}
 function lighting(){const {kind,look}=controller.readState();activeRig=rigs[kind+':'+look];for(const rig of Object.values(rigs))rig.root.visible=rig===activeRig;renderer.toneMappingExposure=common.exposures[look];}
 function status(){
  const s=controller.readState();$('kind').value=s.kind;$('look').value=s.look;$('coordinates').value=s.asset?.coordinateMode??'stock';
  $('status').textContent=disposed?'已退出；渲染、监听与资源已释放':`${s.kind} · ${s.look} · ${view}\nrevision ${s.revision}${error?'\n操作报错：'+error:''}`;
 }
 function views(){
  $('view').replaceChildren(Object.assign(document.createElement('option'),{value:'custom',textContent:'自由镜头',disabled:true}),...controller.current.viewTasks.map(v=>Object.assign(document.createElement('option'),{value:v.id,textContent:{near:'正面 / 近',mid:'同物 / 中',far:'同物 / 远',grazing:'掠视',reverse:'背面',joint:'实体接头'}[v.id]??v.id})));$('view').value=view;
 }
 function setView(id){
  alive();const pose=controller.current.viewTasks.find(v=>v.id===id);if(!pose)throw new RangeError('Unknown frozen view');
  camera.position.fromArray(pose.position);controls.target.fromArray(pose.target);controls.update();camera.updateMatrixWorld(true);
  if(camera.position.distanceTo(new T.Vector3(...pose.position))>1e-8||controls.target.distanceTo(new T.Vector3(...pose.target))>1e-8)throw new Error('Orbit controls changed frozen camera pose');
  view=id;$('view').value=view;status();
 }
 function rebuild(options={}){
  alive();const before=controller.readState();let failure;
  try{controller.rebuild(options);}catch(e){failure=e;}
  const current=controller.readState(),committed=current.revision!==before.revision;replacementStatus=committed?(failure?'committed-with-cleanup-error':'committed'):'rejected';
  bindDepth();lighting();if(current.kind!==before.kind)view='custom';views();status();if(failure)throw failure;return current;
 }
 function setLook(look){alive();controller.setLook(look);lighting();status();}
 function setCalibrationStep(step){alive();try{controller.setCalibrationStep(step);}finally{bindDepth();status();}}
 function setNeutral(value){alive();controller.setNeutral(value);status();}
 function reset(){alive();setLook('pbr');setNeutral(false);setCalibrationStep(6);rebuild({kind:'B1'});setView('near');error=null;status();}
 // Every listener and animation stop is registered after scene resources so it
 // is removed before those resources; explicit stop precedes owner disposal too.
 const listen=(target,event,fn)=>{target.addEventListener(event,fn);owner.defer(()=>target.removeEventListener(event,fn));};
 const action=fn=>()=>{try{fn();error=null;}catch(e){error=String(e.message);}status();};
 function dispose(){if(disposed)return;disposed=true;renderer.setAnimationLoop(null);try{owner.dispose();}finally{document.querySelectorAll('aside select,aside button').forEach(x=>x.disabled=true);status();}}
 listen($('kind'),'change',action(()=>{rebuild({kind:$('kind').value});setView('near');}));
 listen($('look'),'change',action(()=>setLook($('look').value)));
 listen($('coordinates'),'change',action(()=>setCalibrationStep($('coordinates').value==='legacy'?0:6)));
 listen($('view'),'change',action(()=>setView($('view').value)));
 listen($('camera-reset'),'click',action(()=>setView('near')));listen($('rebuild'),'click',action(()=>rebuild()));listen($('reset'),'click',action(reset));listen($('exit'),'click',dispose);
 listen(controls,'change',()=>{view='custom';$('view').value=view;status();});
 const resize=()=>{const width=Math.min(innerWidth,innerHeight*camera.aspect);renderer.domElement.style.width=width+'px';renderer.domElement.style.height=width/camera.aspect+'px';};
 listen(window,'resize',resize);listen(window,'pagehide',dispose);owner.defer(()=>controls.disconnect());owner.defer(()=>renderer.setAnimationLoop(null));resize();bindDepth();lighting();views();setView('near');
 window.__STOCK_TEST__={
  readState(){return {disposed,renderCount,error,view,replacementStatus,...controller.readState(),camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:controls.target.toArray(),fov:camera.fov,near:camera.near,far:camera.far,aspect:camera.aspect},controls:{minDistance:controls.minDistance,maxDistance:controls.maxDistance,minPolarAngle:controls.minPolarAngle,maxPolarAngle:controls.maxPolarAngle},renderer:{three:T.REVISION,width:renderer.domElement.width,height:renderer.domElement.height,dpr:renderer.getPixelRatio(),exposure:renderer.toneMappingExposure,outputColorSpace:renderer.outputColorSpace,toneMapping:renderer.toneMapping,shadowMapType:renderer.shadowMap.type,memory:{...renderer.info.memory},programs:renderer.info.programs.length,calls:renderer.info.render.calls},lighting:activeRig.readState(),sky:sky.readState(),palettes:Object.fromEntries(Object.entries(ownedpalettes).map(([k,p])=>[k,{base:p.base.inspect(),formed:p.formed.inspect()}])),owner:owner.inspect()};},
  getRuntime(){alive();return {T,renderer,scene,camera,controls,...controller.getRuntime(),ownedpalettes,rig:activeRig,sky,root:controller.current.root};},
  rebuild,setLook,setView,setCalibrationStep,setNeutral,reset,dispose,
  setUIVisible(visible){document.body.classList.toggle('ui-hidden',!visible);}
 };
 renderer.setAnimationLoop(()=>{if(disposed)return;sky.follow(camera.position);renderer.render(scene,camera);renderCount++;});
}catch(failure){error=String(failure.stack??failure);renderer?.setAnimationLoop(null);try{owner.dispose();}catch(cleanup){error+='\nCleanup: '+cleanup;}$('status').textContent=error;throw failure;}
