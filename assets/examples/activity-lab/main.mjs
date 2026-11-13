import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import design from '../activity-design.json' with {type:'json'};
import {buildActivityRelation,createActivityLabController} from '../activity-relations.mjs';
import {createResourceScope} from '../../runtime/resource-scope.mjs';
import {createAssetSlot} from '../../runtime/asset-slot.mjs';
import {createLookPalette} from '../../materials/look-palette.mjs';
import {createFormationPalette} from '../../materials/formation-palette.mjs';
import {createLightingRig} from '../../rendering/lighting-rig.mjs';
import {createSkyEnvironment} from '../../rendering/scene-environment.mjs';

const D=design.render,F=design.localFixture.complementaryCameras,owner=createResourceScope(),scene=new T.Scene();let disposed=false,frame,rig;
const renderer=owner.own(new T.WebGLRenderer({antialias:D.renderer.antialias}));renderer.setPixelRatio(D.renderer.pixelRatio);renderer.setSize(...D.renderer.viewport);renderer.outputColorSpace=T[D.renderer.outputColorSpace];renderer.toneMapping=T[D.renderer.toneMapping];renderer.shadowMap.enabled=true;renderer.shadowMap.type=T[D.renderer.shadowMapType];document.body.prepend(renderer.domElement);owner.defer(()=>renderer.domElement.remove());
const camera=new T.PerspectiveCamera(F.FOV,D.renderer.viewport[0]/D.renderer.viewport[1],D.cameraClip.near,D.cameraClip.far),controls=owner.own(new OrbitControls(camera,renderer.domElement));
Object.assign(controls,{enableDamping:true,minDistance:D.orbit.minDistance,maxDistance:D.orbit.maxDistance,minPolarAngle:D.orbit.minPolarAngle,maxPolarAngle:D.orbit.maxPolarAngle});
const sky=owner.own(createSkyEnvironment(T,{renderer,...D.environment.skyOptions}));scene.add(sky.root);sky.apply(scene);scene.environmentIntensity=D.environment.intensity;scene.fog=new T.FogExp2(D.environment.fog.color,D.environment.fog.density);
const providers={};for(const mode of ['pbr','toon']){
 const base=owner.own(createLookPalette(T,{mode,seed:D.seed,resolution:D.paletteResolution}));
 const profiles=Object.fromEntries(Object.entries(D.formationProfiles[mode]).map(([role,p])=>[role,{...p,parameters:{...p.parameters,frameMatrix:new T.Matrix4().fromArray(p.parameters.frameMatrix)}}]));
 providers[mode]=owner.own(createFormationPalette(T,{basePalette:base,profiles,applyWhen:'unmapped'}));
}
const clay=owner.own(new T.MeshStandardMaterial({color:D.looks.clay.material.color,roughness:D.looks.clay.material.roughness,metalness:D.looks.clay.material.metalness}));
const depth=owner.own(new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking})),slot=owner.own(createAssetSlot(scene));
const state={kind:'exchange',look:'pbr',view:'overview',pressFrontOffset:0,islandHoleExtra:0,error:null,ready:false},el=id=>document.getElementById(id);
const controller=createActivityLabController({slot,state,providers,clay,depth,build:next=>buildActivityRelation(T,{...next,mergeGeometries,materialFor:(role,options)=>providers.pbr.get(role,options)})});
function alive(){if(disposed)throw new Error('Activity lab disposed');}
function lighting(mode){const data=D.looks[mode==='clay'?'pbr':mode];renderer.toneMappingExposure=D.looks[mode].exposure;rig.key.intensity=data.key;rig.fill.intensity=data.fill;rig.ambient.intensity=data.ambient;rig.hemisphere.intensity=data.hemisphere;rig.hemisphere.color.set(data.skyColor);rig.hemisphere.groundColor.set(data.groundColor);}
function assignLook(mode){controller.assignLook(mode);el('look').value=mode;lighting(mode);}
function syncUI(){el('relation').value=state.kind;el('structureLabel').textContent=state.kind==='exchange'?'工作台前缘偏移 / m':'岛内低填面扩宽 / m';el('structure').max=state.kind==='exchange'?'.3':'1.5';el('structure').value=state.kind==='exchange'?state.pressFrontOffset:state.islandHoleExtra;}
function rebuild(patch={}){alive();controller.rebuild(patch);syncUI();return readState();}
function clearInertia(){const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;}
function setView(id){alive();const view=slot.current.viewTasks.find(v=>v.id===id);if(!view)throw new Error('Unknown activity view');clearInertia();camera.position.set(...view.position);controls.target.set(...view.target);controls.update();controls.saveState();state.view=id;el('view').value=id;}
function readState(){
 if(disposed)return {disposed:true,ready:false,scope:owner.inspect()};
 return structuredClone({ready:state.ready,revision:slot.revision,state:{...state},activity:slot.current?.readState()??null,camera:{position:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov,near:camera.near,far:camera.far},render:{...renderer.info.render},memory:{...renderer.info.memory,programs:renderer.info.programs?.length??null},rig:rig?.readState(),geometryIds:slot.current?.materialBindings.map(b=>b.object.geometry.uuid)??[],materialTypes:[...new Set(slot.current?.materialBindings.flatMap(b=>(Array.isArray(b.object.material)?b.object.material:[b.object.material]).map(m=>m.type))??[])],scope:owner.inspect()});
}
function getRuntime(){alive();const relation=slot.current,live=relation.getRuntime();return {renderer,scene,camera,controls,relation,materialBindings:live.materialBindings,sourceRanges:live.sourceRanges,owner:live.owner,revision:slot.revision,relationRevision:live.revision,submission:live.submission,qualification:live.qualification};}
function report(){el('status').textContent=JSON.stringify({relation:state.kind,look:state.look,revision:slot.revision,error:state.error},null,2);}
function run(action){try{action();state.error=null;}catch(error){state.error=error.message;console.warn(error);}syncUI();report();}
function listen(target,type,callback){target.addEventListener(type,callback);owner.defer(()=>target.removeEventListener(type,callback));}
function dispose(){if(disposed)return;disposed=true;owner.dispose();el('status').textContent='已退出，几何和渲染资源已释放';}
// Frozen rig uses the complete fixture bounds, with no new light or world probe.
const initial=controller.rebuild();
rig=owner.own(createLightingRig(T,{bounds:initial.shadowBounds,keyDirection:D.keyDirection,keyIntensity:D.looks.pbr.key,fillIntensity:D.looks.pbr.fill,ambientIntensity:D.looks.pbr.ambient,hemisphereIntensity:D.looks.pbr.hemisphere,skyColor:D.looks.pbr.skyColor,groundColor:D.looks.pbr.groundColor,shadowMapSize:D.shadowMapSize}));scene.add(rig.root);assignLook('pbr');setView('overview');syncUI();
listen(el('relation'),'change',e=>run(()=>rebuild({kind:e.target.value,pressFrontOffset:0,islandHoleExtra:0})));
listen(el('look'),'change',e=>run(()=>assignLook(e.target.value)));
listen(el('view'),'change',e=>run(()=>setView(e.target.value)));
listen(el('structure'),'change',e=>run(()=>rebuild({[state.kind==='exchange'?'pressFrontOffset':'islandHoleExtra']:Number(e.target.value)})));
listen(el('invalid'),'click',()=>run(()=>rebuild({failAfterBake:true})));
listen(el('cycle'),'click',()=>run(()=>{for(let i=0;i<20;i++)rebuild();}));
listen(el('reset'),'click',()=>run(()=>{clearInertia();controls.reset();}));
listen(el('clean'),'click',()=>document.body.classList.add('clean'));
listen(window,'keydown',e=>{if(e.key==='Escape')document.body.classList.remove('clean');});
listen(el('exit'),'click',dispose);listen(window,'pagehide',dispose);
owner.defer(()=>cancelAnimationFrame(frame));
function draw(){if(disposed)return;controls.update();camera.updateMatrixWorld();sky.follow(camera.position);renderer.render(scene,camera);state.ready=true;frame=requestAnimationFrame(draw);}
frame=requestAnimationFrame(draw);report();
window.__ACTIVITY_TEST__={readState,getRuntime,rebuild,setView,setLook:mode=>{alive();if(!['pbr','toon','clay'].includes(mode))throw new Error('Unknown activity look');assignLook(mode);report();},reset:()=>{alive();clearInertia();controls.reset();},dispose};
