import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {MarchingCubes} from 'three/addons/objects/MarchingCubes.js';
import {buildCoreWorld,coreViewLabel} from '../core-world.mjs';
import {createLookPalette} from '../../materials/look-palette.mjs';
import {createLightingRig} from '../../rendering/lighting-rig.mjs';
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
controls.minDistance=3;controls.maxDistance=95;controls.minPolarAngle=.15;controls.maxPolarAngle=1.48;controls.update();
const palettes={pbr:owner.own(createLookPalette(T,{mode:'pbr',seed:42,resolution:128})),toon:owner.own(createLookPalette(T,{mode:'toon',seed:42,resolution:128}))};
const state={configuration:'grid',roofLift:0,look:'pbr',view:'overview',time:2,playing:true,error:null,ready:false};
const keyDirection=[-.65,.85,.5],sky=owner.own(createSkyEnvironment(T,{renderer,resolution:128,radius:190,
  zenith:'#9fbebf',horizon:'#e7e7cf',ground:'#6b7569',sunDirection:keyDirection}));
scene.add(sky.root);sky.apply(scene);scene.environmentIntensity=.8;scene.fog=new T.FogExp2(0xdbe2ce,.006);
const slot=owner.own(createAssetSlot(scene));
function applyLighting(){const rig=slot.current?.rig;if(!rig)return;
  rig.key.intensity=state.look==='pbr'?3.6:1.7;rig.fill.intensity=state.look==='pbr'?.65:.35;rig.ambient.intensity=state.look==='pbr'?.12:.19;rig.hemisphere.intensity=state.look==='pbr'?.85:.65;
  rig.hemisphere.color.set(state.look==='pbr'?0xd8ece7:0xe1e5d4);rig.hemisphere.groundColor.set(state.look==='pbr'?0x8f9274:0xa3a287);
  renderer.toneMappingExposure=state.look==='pbr'?1.1:1.05;
}
function rebuild(patch={}){
  const revision=slot.revision;
  try{
    slot.replace(candidate=>{
      const world=candidate.own(buildCoreWorld(T,{mergeGeometries,MarchingCubes,configuration:state.configuration,roofLift:state.roofLift,...patch,
        materialFor:(role,opts)=>palettes[state.look].get(role,opts)}));
      world.root.updateWorldMatrix(true,true);
      const rig=candidate.own(createLightingRig(T,{bounds:world.shadowBounds,keyDirection,keyIntensity:3.6,hemisphereIntensity:.85,skyColor:0xd8ece7,groundColor:0x8f9274,shadowMapSize:2048}));
      const root=new T.Group();root.add(world.root,rig.root);return {root,world,rig};
    });
  }finally{
    if(slot.revision!==revision){
      Object.assign(state,slot.current.world.spec);applyLighting();
      const views=slot.current.world.viewTasks;if(!views.some(v=>v.id===state.view))state.view='overview';
      const viewSelect=document.querySelector('#view');
      viewSelect.replaceChildren(...views.map(v=>{const option=document.createElement('option');option.value=v.id;option.textContent=coreViewLabel(v);return option;}));viewSelect.value=state.view;
    }
  }
}
function setLook(mode){
  const palette=palettes[mode];if(!palette)throw Error('Unknown look');
  const bindings=slot.current.world.materialBindings;
  const resolved=bindings.map(b=>b.slots.map(s=>palette.get(s.role,s.options)));
  bindings.forEach((b,i)=>{b.object.material=resolved[i].length===1?resolved[i][0]:resolved[i];});
  state.look=mode;applyLighting();
}
function clearInertia(){const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;}
function setView(id){
  const task=slot.current.world.viewTasks.find(v=>v.id===id);if(!task)throw Error('Unknown view task');
  clearInertia();camera.position.fromArray(task.position);controls.target.fromArray(task.target);controls.update();controls.saveState();state.view=id;
}
const getWorld=()=>slot.current.world;
function readState(){
  if(!slot.current)return {disposed:true,scope:owner.inspect(),ready:false};
  const world=getWorld();world.root.updateMatrixWorld(true);
  const count=Array.isArray(renderer.info.programs)?renderer.info.programs.length:null;
  return {ready:state.ready,revision:slot.revision,state:{...state},spec:world.spec,
    geometryIds:world.materialBindings.map(b=>b.object.geometry.uuid),
    materialTypes:[...new Set(world.materialBindings.flatMap(b=>(Array.isArray(b.object.material)?b.object.material:[b.object.material]).map(m=>m.type)))],
    roofBounds:(world.parts.curvedRoof.geometry.boundingBox??(world.parts.curvedRoof.geometry.computeBoundingBox(),world.parts.curvedRoof.geometry.boundingBox)).max.toArray(),
    service:world.anchors.get('roof-service').toArray(),stats:world.stats,
    materialRegionStats:world.materialRegionStats,context:{sites:world.context.sites,stats:world.context.stats},regionalAssets:world.regionalAssets.map(({id,program,regionId})=>({id,program,regionId})),
    observationSets:structuredClone(world.observationSets),
    viewTasks:world.viewTasks.map(({id,program,regionId,direction,inspection,sampleIds,position,target})=>({id,program,regionId,direction,label:coreViewLabel({id,program,direction}),inspection,sampleIds,position:[...position],target:[...target]})),
    ports:world.layout.ports,placements:world.placements,layoutComponents:world.layout.connectionGraph.components,
    panelMatrix:world.parts.panel.matrixWorld.toArray(),camera:{position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov},
    detail:world.detailGroups.map(g=>({id:g.id,level:g.level,visible:g.root.visible})),
    lighting:slot.current.rig.readState(),render:{...renderer.info.render},memory:{...renderer.info.memory,programs:count},
    paletteEntries:{pbr:palettes.pbr.inspect().entries.length,toon:palettes.toon.inspect().entries.length}};
}
function report(){document.querySelector('#status').textContent=JSON.stringify({configuration:state.configuration,look:state.look,revision:slot.revision,
  calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,error:state.error},null,2);}
function run(action){try{action();state.error=null;}catch(e){state.error=e.message;console.warn(e);}report();}
function listen(target,event,callback){target.addEventListener(event,callback);owner.defer(()=>target.removeEventListener(event,callback));}
listen(document.querySelector('#configuration'),'change',e=>run(()=>{rebuild({configuration:e.target.value});setView(state.view);}));
listen(document.querySelector('#look'),'change',e=>run(()=>setLook(e.target.value)));
listen(document.querySelector('#view'),'change',e=>run(()=>setView(e.target.value)));
listen(document.querySelector('#roofLift'),'change',e=>run(()=>rebuild({roofLift:Number(e.target.value)})));
listen(document.querySelector('#reset'),'click',()=>{clearInertia();controls.reset();report();});
listen(document.querySelector('#play'),'click',e=>{state.playing=!state.playing;e.target.textContent=state.playing?'暂停':'播放';});
listen(document.querySelector('#invalid'),'click',()=>run(()=>rebuild({roofLift:-1})));
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
window.__CORE_TEST__={readState,setView,setLook,rebuild,seek(t){state.playing=false;state.time=t;getWorld().update(t);},dispose:()=>owner.dispose()};
listen(window,'pagehide',()=>owner.dispose());
