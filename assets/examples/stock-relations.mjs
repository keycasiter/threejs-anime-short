import design from './stock-relations-design.json' with {type:'json'};
import {createContourProfileSource} from '../geometry/contour-profile.mjs';
import {writeFormationCoordinates} from '../geometry/formation-coordinates.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';
import {createAssetSlot} from '../runtime/asset-slot.mjs';
const copy=value=>structuredClone(value);

/** Example recipes only: A2 owns the response and cache. All original role
 * recipes stay source-bound; only explicit dressed-stock slots use the sequence. */
export function createStockProfiles(T,look){
 if(!['pbr','toon'].includes(look))throw new RangeError('look must be pbr or toon');
 const profiles=copy(design.originalFormationProfiles[look]);
 const old=profiles.wood,target=design.targetFinish.parameters;
 let current=copy(old);
 for(const [key,changes]of [
  ['lambda-x',{wavelengths:target.wavelengths}],
  ['color-gain',{colorLow:target.colorLow,colorHigh:target.colorHigh}],
  ['roughness',{roughnessAmplitude:look==='pbr'?target.roughnessAmplitudePBR:target.roughnessAmplitudeToonDielectric}],
  ['height',{heightAmplitude:target.heightAmplitude}],
  ['dressed-stock',{warp:target.warp}]
 ]){current=copy(current);Object.assign(current.parameters,copy(changes));profiles[key]=current;}
 profiles.neutral=copy(profiles['dressed-stock']);Object.assign(profiles.neutral.parameters,{colorLow:copy(design.targetFinish.meanMultiplierLinearRGB),colorHigh:copy(design.targetFinish.meanMultiplierLinearRGB),roughnessAmplitude:0,heightAmplitude:0});
 for(const profile of Object.values(profiles))profile.parameters.frameMatrix=new T.Matrix4().fromArray(profile.parameters.frameMatrix);
 return profiles;
}

// Oracle station/frame metadata remains in the design, outside A1's strict API.
function chartsFor(shape){const {referenceOutsetM,depthDatumM,closedSeam,pieces}=shape.charts;return {referenceOutsetM,depthDatumM,closedSeam,pieces:pieces.map(({firstSegment,segmentCount,mode})=>({firstSegment,segmentCount,mode}))};}

/** Frozen complete B examples. Each source owns its own geometry; this scope
 * owns neighbor geometry exactly once. Materials are borrowed and never mutated.
 * Legacy and stock build the same source path, differing only in material metres. */
export function buildStockRelation(T,{kind='B1',materialFor,coordinateMode='stock'}={}){
 if(String(T?.REVISION)!=='180')throw new TypeError('Stock relations require Three r180');
 if(!['B1','B2'].includes(kind))throw new RangeError('Unknown stock relation kind');
 if(!['stock','legacy'].includes(coordinateMode))throw new RangeError('coordinateMode must be stock or legacy');
 if(typeof materialFor!=='function')throw new TypeError('Borrowed materialFor required');
 const input=design.exactBRelations.find(x=>x.id===kind),shape=input.frame??input.hoop;
 const scope=createResourceScope(),root=new T.Group(),parts={},sources=[],materialBindings=[];root.name=kind;let disposed=false;
 scope.defer(()=>{root.removeFromParent();root.clear();});
 const wood={role:'wood',options:{maps:false,color:0xffffff,baseColor:0xa88e65},profileKey:'dressed-stock'};
 function mesh(name,geometry,slot){
  const material=materialFor(slot.role,copy(slot.options),slot.profileKey);
  if(!material?.isMaterial)throw new TypeError('materialFor must return an actual borrowed Material');
  const object=new T.Mesh(geometry,material);object.name=name;object.castShadow=true;object.receiveShadow=true;root.add(object);parts[name]=object;
  materialBindings.push({object,slots:[copy(slot)]});return object;
 }
 function geometry(g,matrix){scope.own(g);writeFormationCoordinates(T,g,matrix?{geometryToFormation:matrix}:{});g.computeBoundingBox();g.computeBoundingSphere();return g;}
 try{
  const source=scope.own(createContourProfileSource(T,{contour:copy(shape.contourXYm),profile:copy(shape.sectionOutsetZm),...(coordinateMode==='stock'?{formationCharts:chartsFor(shape)}:{})}));sources.push(source);
  if(coordinateMode==='legacy')writeFormationCoordinates(T,source.geometry);
  mesh(kind==='B1'?'frame':'hoop',source.geometry,wood);
  if(kind==='B1'){
   const panel=input.panel;mesh('panel',geometry(new T.BoxGeometry(...panel.sizeM),new T.Matrix4().fromArray(panel.partToStockMatrixColumnMajor)),wood).position.fromArray(panel.centerM);
  }else{
   const body=input.body,keeper=input.keeper,bolts=input.bolts;
   const bodyShape=new T.Shape(shape.contourXYm.map(xy=>new T.Vector2(...xy)));
   mesh('body',geometry(new T.ExtrudeGeometry(bodyShape,body.options)),{role:body.role,options:{maps:body.maps,color:0xffffff,baseColor:Number.parseInt(body.baseColor.slice(1),16)}}).position.fromArray(body.translation);
   const metal={role:keeper.role,options:{maps:keeper.maps,color:0xffffff,baseColor:Number.parseInt(keeper.baseColor.slice(1),16)}};
   mesh('keeper',geometry(new T.BoxGeometry(...keeper.sizeM)),metal).position.fromArray(keeper.centerM);
   bolts.centers.forEach((center,i)=>{const bolt=mesh('bolt'+i,geometry(new T.CylinderGeometry(bolts.radiusTopM,bolts.radiusBottomM,bolts.lengthM,bolts.radialSegments)),metal);bolt.rotation.z=-Math.PI/2;bolt.position.fromArray(center);});
  }
  root.updateMatrixWorld(true);
  const viewTasks=copy([...input.cameraTargets,...(input.keeperCamera?[input.keeperCamera]:[])]);
  return {root,parts,sources,materialBindings,viewTasks,
   readState(){return {kind,coordinateMode,disposed,rootUuid:root.uuid,geometryUuids:Object.fromEntries(Object.entries(parts).map(([n,m])=>[n,m.geometry.uuid])),materialSlots:materialBindings.map(b=>({object:b.object.name,materialUuid:b.object.material.uuid,slots:copy(b.slots)})),sourceMetadata:sources.map(s=>copy(s.metadata)),owner:scope.inspect()};},
   dispose(){if(disposed)return;disposed=true;scope.dispose();}
  };
 }catch(error){disposed=true;try{scope.dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Stock construction and cleanup failed');}throw error;}
}

function shapeRecords(asset){return Object.entries(asset.parts).map(([name,m])=>({name,position:Array.from(m.geometry.attributes.position.array),normal:Array.from(m.geometry.attributes.normal.array),uv:Array.from(m.geometry.attributes.uv.array),index:m.geometry.index?Array.from(m.geometry.index.array):null,groups:m.geometry.groups,positionM:m.position.toArray(),quaternion:m.quaternion.toArray(),scale:m.scale.toArray()}));}
function shapeHash(asset){let h=2166136261;for(const c of JSON.stringify(shapeRecords(asset)))h=Math.imul(h^c.charCodeAt(0),16777619);return 'fnv1a32:'+((h>>>0).toString(16).padStart(8,'0'));}
const stageKeys=['wood','wood','lambda-x','color-gain','roughness','height','dressed-stock'];

/** Small B diagnostic state, not a general preset system. The scene and both
 * native palette pairs are borrowed. Lookup and validate every slot before any
 * live material assignment; only crossing legacy/stock rebuilds geometry. */
export function createStockController(T,{scene,palettes,kind='B1',look='pbr'}={}){
 if(!scene?.isObject3D)throw new TypeError('Stock controller requires an Object3D scene');
 for(const mode of ['pbr','toon'])if(typeof palettes?.[mode]?.formed?.get!=='function'||typeof palettes[mode].formed.validateMesh!=='function')throw new TypeError('Both native formation palettes are required');
 if(!['pbr','toon'].includes(look))throw new RangeError('look must be pbr or toon');
 const slot=createAssetSlot(scene);let disposed=false,step=6,neutral=false;
 const alive=()=>{if(disposed)throw new Error('Stock controller is disposed');};
 function effective(s,nextStep=step,nextNeutral=neutral){return s.profileKey==='dressed-stock'?(nextNeutral?'neutral':stageKeys[nextStep]):s.profileKey;}
 function provider(nextLook,nextStep,nextNeutral){return (role,options,profileKey)=>palettes[nextLook].formed.get(role,options,effective({profileKey},nextStep,nextNeutral));}
 function qualify(asset,nextLook,nextStep,nextNeutral){
  const get=provider(nextLook,nextStep,nextNeutral);
  return asset.materialBindings.map(({object,slots})=>{const list=slots.map(s=>get(s.role,s.options,s.profileKey));const material=Array.isArray(object.material)?list:list[0];palettes[nextLook].formed.validateMesh(object,material);return {object,material};});
 }
 function rebuild({kind:nextKind=kind,calibrationStep:nextStep=step,neutral:nextNeutral=neutral}={}){
  alive();if(!Number.isInteger(nextStep)||nextStep<0||nextStep>6)throw new RangeError('calibrationStep must be integer 0–6');if(typeof nextNeutral!=='boolean')throw new TypeError('neutral must be boolean');
  const prior=slot.current;
  const revision=slot.revision;
  try{return slot.replace(scope=>{
   const candidate=scope.own(buildStockRelation(T,{kind:nextKind,coordinateMode:nextStep===0?'legacy':'stock',materialFor:provider(look,nextStep,nextNeutral)}));
   qualify(candidate,look,nextStep,nextNeutral);
   if(prior&&nextKind===kind&&JSON.stringify(shapeRecords(prior))!==JSON.stringify(shapeRecords(candidate)))throw new Error('Coordinate replacement changed actual geometry');
   return candidate;
  });}finally{
   // S01 commits before retiring the previous scope; cleanup failure cannot
   // pretend the dead prior asset is still live. Derive state from the slot.
   if(slot.revision!==revision){kind=slot.current.readState().kind;step=nextStep;neutral=nextNeutral;}
  }
 }
 function materials(nextLook,nextStep,nextNeutral){
  const assignments=qualify(slot.current,nextLook,nextStep,nextNeutral);
  for(const {object,material}of assignments)object.material=material;
  look=nextLook;step=nextStep;neutral=nextNeutral;
 }
 const api={
  get current(){return slot.current;},rebuild,
  setCalibrationStep(value){alive();if(!Number.isInteger(value)||value<0||value>6)throw new RangeError('calibrationStep must be integer 0–6');if((value===0)!==(step===0))rebuild({calibrationStep:value});else materials(look,value,neutral);},
  setLook(value){alive();if(!['pbr','toon'].includes(value))throw new RangeError('look must be pbr or toon');materials(value,step,neutral);},
  setNeutral(value){alive();if(typeof value!=='boolean')throw new TypeError('neutral must be boolean');materials(look,step,value);},
  readState(){return {disposed,kind,look,calibrationStep:step,neutral,revision:slot.revision,shapeHash:slot.current?shapeHash(slot.current):null,asset:slot.current?.readState()??null,effectiveBindings:slot.current?.materialBindings.map(({object,slots})=>({object:object.name,materialUuid:object.material.uuid,slots:slots.map(s=>({...copy(s),effectiveProfileKey:effective(s)??s.role}))}))??[]};},
  getRuntime(){alive();return {currentmaterialBindings:slot.current.materialBindings,sources:slot.current.sources};},
  dispose(){if(disposed)return;disposed=true;slot.dispose();}
 };
 try{rebuild();return api;}catch(error){api.dispose();throw error;}
}
