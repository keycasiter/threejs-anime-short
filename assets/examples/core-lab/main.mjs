import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {MarchingCubes} from 'three/addons/objects/MarchingCubes.js';
import {coreViewLabel} from '../core-world.mjs';
import {buildCorePresentation} from '../core-presentation.mjs';
import {createSkyEnvironment} from '../../rendering/scene-environment.mjs';
import {createResourceScope} from '../../runtime/resource-scope.mjs';
import {createAssetSlot} from '../../runtime/asset-slot.mjs';
import {selectProjectedDetail} from '../../runtime/projected-detail.mjs';

const owner=createResourceScope(),renderer=owner.own(new T.WebGLRenderer({antialias:true}));
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
document.body.prepend(renderer.domElement);owner.defer(()=>renderer.domElement.remove());
const scene=new T.Scene(),camera=new T.PerspectiveCamera(41,innerWidth/innerHeight,.1,420);
camera.position.set(27,23,31);
const controls=owner.own(new OrbitControls(camera,renderer.domElement));controls.target.set(0,1,0);controls.enableDamping=true;
controls.minDistance=3;controls.maxDistance=95;controls.minPolarAngle=0;controls.maxPolarAngle=Math.PI;controls.update();
const state={configuration:'grid',roofLift:0,look:'pbr',formationEnabled:true,environmentMode:'world',view:'overview',time:2,playing:true,error:null,ready:false};
const keyDirection=[-.65,.85,.5],sky=owner.own(createSkyEnvironment(T,{renderer,resolution:128,radius:190,
  zenith:'#9fbebf',horizon:'#e7e7cf',ground:'#6b7569',sunDirection:keyDirection}));
scene.add(sky.root);sky.apply(scene);scene.environmentIntensity=.8;scene.fog=new T.FogExp2(0xdbe2ce,.006);
const slot=owner.own(createAssetSlot(scene));
function applyOutput(){renderer.toneMappingExposure=state.look==='pbr'?1.1:1.05;}
function rebuild(patch={}){
  const revision=slot.revision;
  try{
    slot.replace(candidate=>candidate.own(buildCorePresentation(T,{renderer,mergeGeometries,MarchingCubes,skyTexture:sky.texture,
      configuration:state.configuration,roofLift:state.roofLift,look:state.look,formationEnabled:state.formationEnabled,environmentMode:state.environmentMode,time:state.time,...patch})));
  }finally{
    if(slot.revision!==revision){
      const presentation=slot.current.readState();
      Object.assign(state,slot.current.world.spec,{look:presentation.look,formationEnabled:presentation.formationEnabled,environmentMode:presentation.environmentMode});applyOutput();
      document.querySelector('#configuration').value=state.configuration;document.querySelector('#look').value=state.look;
      document.querySelector('#formation').checked=state.formationEnabled;document.querySelector('#environment').value=state.environmentMode;document.querySelector('#roofLift').value=state.roofLift;
      const views=slot.current.world.viewTasks;if(!views.some(v=>v.id===state.view))state.view='overview';
      const viewSelect=document.querySelector('#view');
      viewSelect.replaceChildren(...views.map(v=>{const option=document.createElement('option');option.value=v.id;option.textContent=coreViewLabel(v);return option;}));viewSelect.value=state.view;
    }
  }
}
function setLook(mode){
  slot.current.setLook(mode);state.look=mode;applyOutput();document.querySelector('#look').value=mode;
}
function setFormationEnabled(enabled){slot.current.setFormationEnabled(enabled);state.formationEnabled=enabled;document.querySelector('#formation').checked=enabled;}
function setEnvironmentMode(mode){slot.current.setEnvironmentMode(mode);state.environmentMode=mode;document.querySelector('#environment').value=mode;}
function clearInertia(){const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;}
function setView(id){
  const task=slot.current.world.viewTasks.find(v=>v.id===id);if(!task)throw Error('Unknown view task');
  const poseVector=p=>{
    if(!Array.isArray(p)||p.length!==3)throw Error('View pose must contain finite position and target');
    const values=[p[0],p[1],p[2]];
    if(!values.every(Number.isFinite))throw Error('View pose must contain finite position and target');
    return new T.Vector3(...values);
  };
  const position=poseVector(task.position),target=poseVector(task.target),distance=position.distanceTo(target);
  if(distance<controls.minDistance||distance>controls.maxDistance)throw Error('View pose distance is outside controls limits');
  clearInertia();const previousPosition=camera.position.clone(),previousTarget=controls.target.clone();
  camera.position.copy(position);controls.target.copy(target);controls.update();
  if(camera.position.distanceTo(position)>1e-8||controls.target.distanceTo(target)>1e-8){
    camera.position.copy(previousPosition);controls.target.copy(previousTarget);controls.update();
    throw Error('View pose was not accepted by controls');
  }
  controls.saveState();state.view=id;
}
const getWorld=()=>slot.current.world;
function readState(){
  if(!slot.current)return structuredClone({disposed:true,scope:owner.inspect(),ready:false});
  const world=getWorld(),presentation=slot.current.readState();world.root.updateMatrixWorld(true);
  const count=Array.isArray(renderer.info.programs)?renderer.info.programs.length:null;
  return structuredClone({ready:state.ready,revision:slot.revision,state:{...state},spec:world.spec,
    geometryIds:world.materialBindings.map(b=>b.object.geometry.uuid),
    materialTypes:[...new Set(world.materialBindings.flatMap(b=>(Array.isArray(b.object.material)?b.object.material:[b.object.material]).map(m=>m.type)))],
    roofBounds:(world.parts.curvedRoof.geometry.boundingBox??(world.parts.curvedRoof.geometry.computeBoundingBox(),world.parts.curvedRoof.geometry.boundingBox)).max.toArray(),
    service:world.anchors.get('roof-service').toArray(),stats:world.stats,
    materialRegionStats:world.materialRegionStats,
    context:{sites:world.context.sites.map(({route,...site})=>({...site,route:route?{start:[...route.start],end:[...route.end],width:route.width,geometryId:route.mesh.geometry.uuid}:null})),
      stats:world.context.stats,topology:world.context.design.topology,graphComponents:world.context.layout.connectionGraph.components,
      neighborhood:world.context.neighborhood.diagnostics,roads:world.context.roads.stats,gateways:world.context.gateways},
    boundarySources:world.boundarySources.map(({source,part,assetId})=>({assetId,partName:part.name,geometryId:part.geometry.uuid,metadata:source.metadata,worldMatrix:part.matrixWorld.toArray(),slots:world.materialBindings.find(b=>b.object===part)?.slots})),
    bakedBoundarySources:world.bakedBoundarySources.map(record=>({...record,sourceRanges:record.sourceRanges.map(({sourceId,objectId,geometryId,vertexStart,vertexCount})=>({sourceId,objectId,geometryId,vertexStart,vertexCount}))})),
    regionalAssets:world.regionalAssets.map(({id,program,regionId})=>({id,program,regionId})),
    observationSets:world.observationSets,
    viewTasks:world.viewTasks.map(({id,program,regionId,direction,inspection,sampleIds,position,target})=>({id,program,regionId,direction,label:coreViewLabel({id,program,direction}),inspection,sampleIds,position:[...position],target:[...target]})),
    ports:world.layout.ports,placements:world.placements,layoutComponents:world.layout.connectionGraph.components,
    panelMatrix:world.parts.panel.matrixWorld.toArray(),camera:{position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov},
    detail:world.detailGroups.map(g=>({id:g.id,level:g.level,visible:g.root.visible})),
    lighting:slot.current.rig.readState(),render:{...renderer.info.render},memory:{...renderer.info.memory,programs:count},
    presentation,paletteEntries:{pbr:presentation.palettes.pbr.base.entries.length,toon:presentation.palettes.toon.base.entries.length}});
}
function report(){document.querySelector('#status').textContent=JSON.stringify({configuration:state.configuration,look:state.look,formation:state.formationEnabled,environment:state.environmentMode,revision:slot.revision,
  calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,error:state.error},null,2);}
function run(action){try{action();state.error=null;}catch(e){state.error=e.message;console.warn(e);}report();}
function listen(target,event,callback){target.addEventListener(event,callback);owner.defer(()=>target.removeEventListener(event,callback));}
listen(document.querySelector('#configuration'),'change',e=>run(()=>{rebuild({configuration:e.target.value});setView(state.view);}));
listen(document.querySelector('#look'),'change',e=>run(()=>setLook(e.target.value)));
listen(document.querySelector('#formation'),'change',e=>run(()=>setFormationEnabled(e.target.checked)));
listen(document.querySelector('#environment'),'change',e=>run(()=>setEnvironmentMode(e.target.value)));
listen(document.querySelector('#view'),'change',e=>run(()=>setView(e.target.value)));
listen(document.querySelector('#roofLift'),'change',e=>run(()=>rebuild({roofLift:Number(e.target.value)})));
listen(document.querySelector('#reset'),'click',()=>{clearInertia();controls.reset();report();});
listen(document.querySelector('#play'),'click',e=>{state.playing=!state.playing;e.target.textContent=state.playing?'暂停':'播放';});
listen(document.querySelector('#invalid'),'click',()=>run(()=>rebuild({roofLift:-1})));
listen(document.querySelector('#captureFail1'),'click',()=>run(()=>rebuild({diagnostics:{failAfterCapture:1}})));
listen(document.querySelector('#captureFail2'),'click',()=>run(()=>rebuild({diagnostics:{failAfterCapture:2}})));
listen(document.querySelector('#cycle'),'click',()=>run(()=>{for(let i=0;i<10;i++)rebuild();}));
listen(window,'resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
let frame,last=null;
function draw(now){
  if(last!==null&&state.playing)state.time+=Math.min(.1,(now-last)/1000);last=now;
  const world=getWorld();world.update(state.time);controls.update();camera.updateMatrixWorld();
  for(const group of world.detailGroups){
    const center=group.center.clone().applyMatrix4(world.root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    const choice=selectProjectedDetail({diameter:group.diameter,viewDepth:-center.z,viewportHeight:innerHeight,fovDegrees:camera.fov,previousLevel:group.level});
    group.level=choice.level;group.root.visible=choice.level<2;
  }
  sky.follow(camera.position);renderer.render(scene,camera);state.ready=true;
  frame=requestAnimationFrame(draw);
}
owner.defer(()=>cancelAnimationFrame(frame));
rebuild();setView('overview');frame=requestAnimationFrame(draw);report();
window.__CORE_TEST__={readState,setView,setLook,setFormationEnabled,setEnvironmentMode,rebuild,seek(t){state.playing=false;state.time=t;getWorld().update(t);},dispose:()=>owner.dispose()};
listen(window,'pagehide',()=>owner.dispose());
