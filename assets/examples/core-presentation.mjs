import {buildCoreWorld} from './core-world.mjs';
import {createLookPalette} from '../materials/look-palette.mjs';
import {createFormationPalette} from '../materials/formation-palette.mjs';
import {createLightingRig} from '../rendering/lighting-rig.mjs';
import {captureEnvironmentProbe,snapshotProbePosition} from '../rendering/scene-environment.mjs';
import {captureRendererState,restoreRendererState} from '../rendering/renderer-state.mjs';
import {createResourceScope} from '../runtime/resource-scope.mjs';

const looks=['pbr','toon'],modes=['sky','world'],environmentIntensity=.8;
const fail=message=>{throw new RangeError('CorePresentation: '+message);};
function choice(value,values,label){if(!values.includes(value))fail('invalid '+label);}
function boolean(value,label){if(typeof value!=='boolean')fail(label+' requires boolean');}
function record(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function keys(value,allowed,label){if(!record(value))fail(label+' requires record');for(const key of Reflect.ownKeys(value))if(!allowed.includes(key))fail('unknown '+label+' field '+String(key));}
function uint(value,max,label){if(!Number.isInteger(value)||value<0||value>max)fail('invalid '+label);}
function hash(n){n=Math.imul(n^n>>>16,0x21f0aaad);n=Math.imul(n^n>>>15,0x735a2d97);return(n^n>>>15)>>>0;}

// Replaceable design data for this complete example, in metres. The frame is
// authored in the existing source-coordinate axes: wood fibres run along z.
// These recipes neither infer an axis from merged bounds nor inspect asset IDs.
function profiles(T,look,seed){
 const data={
  stone:['aggregate',[.28,.09,.23],[.90,.92,.94],[1.08,1.06,1.04],.0012,.5,.16,101],
  coating:['aggregate',[.006,.006,.006],[.97,.97,.97],[1.03,1.03,1.03],.00008,.25,.10,211],
  wood:['fibres',[.024,.08,1.5],[.75,.72,.65],[1.12,1.10,1.05],.0003,.4,.18,307],
  metal:['bands',[.01,.3,.15],[.96,.96,.96],[1.04,1.04,1.04],.00002,.08,.12,401]
 };
 return Object.fromEntries(Object.entries(data).map(([role,[pattern,wavelengths,colorLow,colorHigh,heightAmplitude,warp,roughness,salt]])=>[role,
  {pattern,space:'attached',parameters:{wavelengths,colorLow,colorHigh,heightAmplitude,warp,roughnessAmplitude:look==='toon'&&role!=='metal'?0:roughness,
   seed:hash(seed^salt),frameMatrix:new T.Matrix4()}}]));
}

/** Owns one complete candidate, including private base/formed materials and two
 * static world captures. Renderer and skyTexture are borrowed. The detached
 * root can be committed by createAssetSlot only after this factory succeeds.
 * Inject the same Three r180 namespace/addons as the renderer and world.
 */
export function buildCorePresentation(T,options={}){
 keys(options,['renderer','mergeGeometries','MarchingCubes','skyTexture','configuration','roofLift','look','formationEnabled','environmentMode','seed','resolution','shadowMapSize','time','probePosition','diagnostics'],'options');
 const {renderer,mergeGeometries,MarchingCubes,skyTexture,configuration='grid',roofLift=0,look='pbr',formationEnabled=true,environmentMode='world',seed=42,resolution=128,shadowMapSize=2048,time=2,probePosition,diagnostics={}}=options;
 if(String(T?.REVISION)!=='180')fail('requires Three r180');
 if(!renderer?.isWebGLRenderer||!renderer.debug||!renderer.shadowMap)fail('WebGLRenderer required');
 // r180 PMREM packs power-of-two faces down to 16, plus six 16px roughness levels.
 const image=skyTexture?.image,faceSize=image?.height/4;
 if(!skyTexture?.isTexture||skyTexture.mapping!==T.CubeUVReflectionMapping||skyTexture.isCubeTexture||
    skyTexture.isData3DTexture||skyTexture.isDataArrayTexture||skyTexture.isCompressedArrayTexture||skyTexture.isDepthTexture||
    !Number.isSafeInteger(image?.height)||!Number.isSafeInteger(image?.width)||faceSize<16||
    2**Math.floor(Math.log2(faceSize))!==faceSize||image.width!==3*Math.max(faceSize,16*7)||
    Math.max(image.width,image.height)>(renderer.capabilities?.maxTextureSize??Infinity))fail('skyTexture requires a usable r180 CubeUV PMREM atlas');
 if(typeof mergeGeometries!=='function'||typeof MarchingCubes!=='function')fail('matching addons required');
 choice(look,looks,'look');choice(environmentMode,modes,'environmentMode');boolean(formationEnabled,'formationEnabled');choice(configuration,['grid','ring','terraced'],'configuration');
 uint(seed,0xffffffff,'seed');if(!Number.isInteger(resolution)||resolution<64||resolution>1024)fail('resolution must be 64..1024');
 if(!Number.isInteger(shadowMapSize)||shadowMapSize<128||shadowMapSize>4096||(shadowMapSize&(shadowMapSize-1)))fail('invalid shadowMapSize');
 if(!Number.isFinite(time)||time<0)fail('time must be finite and nonnegative');
 const explicitPosition=probePosition===undefined?null:snapshotProbePosition(probePosition);
 keys(diagnostics,['failAfterCapture'],'diagnostics');const failAfterCapture=diagnostics.failAfterCapture??0;uint(failAfterCapture,2,'failAfterCapture');
 const scope=createResourceScope(),environments=scope.own(createResourceScope()),root=new T.Group(),palettes={},tables={},captures={};
 const current={look,formationEnabled,environmentMode};let world,rig,disposed=false,captureInfo=null;
 root.name='core-presentation';
 function alive(){if(disposed)fail('disposed presentation');}
 function lighting(mode){
  const pbr=mode==='pbr';rig.key.intensity=pbr?3.6:1.7;rig.fill.intensity=pbr?.65:.35;rig.ambient.intensity=pbr?.12:.19;rig.hemisphere.intensity=pbr?.85:.65;
  rig.hemisphere.color.set(pbr?0xd8ece7:0xe1e5d4);rig.hemisphere.groundColor.set(pbr?0x8f9274:0xa3a287);
 }
 function assign(mode,formed){
  const table=tables[mode][formed?'formed':'base'];
  world.materialBindings.forEach((binding,i)=>{const list=table[i];binding.object.material=list.length===1?list[0]:list;});
  lighting(mode);
 }
 const unique=table=>[...new Set(table.flat())];
 const originalIntensities=new Map();
 function bindEnvironment(mode){
  const texture=current.environmentMode==='world'?captures[mode].texture:skyTexture;
  for(const material of new Set([...unique(tables[mode].base),...unique(tables[mode].formed)]))if('envMap' in material){
   if(!originalIntensities.has(material))originalIntensities.set(material,material.envMapIntensity);
   // Explicit envMap bypasses Scene.environmentIntensity in Three r180.
   const changed=material.envMap!==texture;material.envMap=texture;material.envMapIntensity=originalIntensities.get(material)*environmentIntensity;
   if(changed)material.needsUpdate=true;
  }
 }
 try{
  // LIFO retirement: lights/world -> wrappers -> base materials/maps -> targets.
  for(const mode of looks){
   const base=scope.own(createLookPalette(T,{mode,seed,resolution}));
   const formed=scope.own(createFormationPalette(T,{basePalette:base,profiles:profiles(T,mode,seed),applyWhen:'unmapped'}));
   palettes[mode]={base,formed};
  }
  const provider=palettes[look].formed;
  world=scope.own(buildCoreWorld(T,{mergeGeometries,MarchingCubes,configuration,roofLift,materialFor:(role,opts)=>provider.get(role,opts)}));
  world.update(time);world.root.updateWorldMatrix(true,true);
  rig=scope.own(createLightingRig(T,{bounds:world.shadowBounds,keyDirection:[-.65,.85,.5],keyIntensity:3.6,fillIntensity:.65,ambientIntensity:.12,hemisphereIntensity:.85,skyColor:0xd8ece7,groundColor:0x8f9274,shadowMapSize}));
  root.add(world.root,rig.root);scope.defer(()=>root.removeFromParent());
  const qualification={};
  for(const mode of looks){
   // Resolve the complete candidate before changing any live binding. Every
   // initial/switch/capture lookup uses the same role/options and providers.
   const formed=world.materialBindings.map(b=>b.slots.map(s=>palettes[mode].formed.get(s.role,s.options)));
   const base=world.materialBindings.map(b=>b.slots.map(s=>palettes[mode].base.get(s.role,s.options)));
   let responses=0,passthroughMaterialCount=0;
   world.materialBindings.forEach((b,i)=>{
    const n=b.slots.length,prior=Array.isArray(b.object.material)?b.object.material:[b.object.material];
    // Existing context roads bind one identical Material across three semantic
    // side/top/bottom slots. Expand the table, without rewriting their groups.
    const validPrior=prior.length===n||(prior.length===1&&b.slots.every(s=>provider.get(s.role,s.options)===prior[0]));
    // Single-material geometry ignores groups in Three (e.g. BoxGeometry faces).
    if(!n||!validPrior||formed[i].length!==n||base[i].length!==n||(n>1&&b.object.geometry.groups.some(g=>!Number.isInteger(g.materialIndex)||g.materialIndex<0||g.materialIndex>=n)))fail('material slots/groups mismatch');
    const result=palettes[mode].formed.validateMesh(b.object,formed[i]);responses+=result.responses.length;passthroughMaterialCount+=result.passthroughMaterialCount;
   });
   tables[mode]={formed,base};qualification[mode]={meshes:formed.length,responses,passthroughMaterialCount};
  }
  const bounds=new T.Box3().setFromObject(world.root),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
  const position=explicitPosition??[center.x,bounds.max.y+Math.max(.25,size.y*.08),center.z];
  let far=0;for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])far=Math.max(far,new T.Vector3(x,y,z).distanceTo(new T.Vector3(...position)));
  far+=Math.max(1,far*.05);const near=.05;
  if(!Number.isFinite(far)||far<=near)fail('capture bounds are not finite');
  captureInfo={position,near,far,resolution,time,count:0,type:'CubeCamera -> PMREM; whole-world static approximation',positionSource:explicitPosition?'explicit override':'complete world bounds center XZ, above maxY',bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};
  const captureScene=new T.Scene();captureScene.background=skyTexture;captureScene.environment=skyTexture;captureScene.backgroundIntensity=1;captureScene.environmentIntensity=environmentIntensity;
  const oldRenderer=captureRendererState(T,renderer),debug=renderer.debug,oldCheck=debug.checkShaderErrors,oldCallback=debug.onShaderError,oldShadow=rig.key.shadow.autoUpdate;
  let shaderError=null;
  try{
   debug.checkShaderErrors=true;debug.onShaderError=function(...args){
    shaderError=new Error('CorePresentation: shader compilation failed during capture');
    // Preserve the chained callback, but defer its exception until the probe's
    // output is returned into this candidate's environment owner.
    if(typeof oldCallback==='function')try{oldCallback.apply(this,args);}catch(error){shaderError=new AggregateError([shaderError,error],'CorePresentation: shader compilation and chained shader callback failed');}
   };
   renderer.shadowMap.autoUpdate=true;rig.key.shadow.autoUpdate=true;captureScene.add(root);
   for(const mode of looks){
    assign(mode,true);
    captures[mode]=environments.own(captureEnvironmentProbe(T,{renderer,scene:captureScene,position,resolution,near,far}));captureInfo.count++;
    if(shaderError)throw shaderError;
    if(captureInfo.count===failAfterCapture)throw Error('CorePresentation: diagnostic failure after capture '+captureInfo.count);
   }
  }finally{
   root.removeFromParent();captureScene.background=null;captureScene.environment=null;
   rig.key.shadow.autoUpdate=oldShadow;debug.checkShaderErrors=oldCheck;debug.onShaderError=oldCallback;restoreRendererState(renderer,oldRenderer);
  }
  for(const mode of looks)bindEnvironment(mode);
  assign(look,formationEnabled);
  return {root,world,rig,
   setLook(mode){alive();choice(mode,looks,'look');assign(mode,current.formationEnabled);current.look=mode;},
   setFormationEnabled(enabled){alive();boolean(enabled,'formationEnabled');assign(current.look,enabled);current.formationEnabled=enabled;},
   setEnvironmentMode(mode){alive();choice(mode,modes,'environmentMode');current.environmentMode=mode;for(const look of looks)bindEnvironment(look);},
   readState(){return structuredClone({...current,disposed,roles:Object.fromEntries(['stone','coating','wood','metal'].map(role=>[role,world.materialBindings.reduce((n,b)=>n+b.slots.filter(s=>s.role===role).length,0)])),
    materialCounts:Object.fromEntries(looks.map(mode=>[mode,{base:unique(tables[mode].base).length,formed:unique(tables[mode].formed).length}])),qualification,
    palettes:Object.fromEntries(looks.map(mode=>[mode,{base:palettes[mode].base.inspect(),formed:palettes[mode].formed.inspect()}])),
    environments:Object.fromEntries(looks.map(mode=>[mode,[...new Set([...unique(tables[mode].base),...unique(tables[mode].formed)])].filter(m=>'envMap' in m).map(m=>({materialUuid:m.uuid,textureUuid:m.envMap?.uuid??null,intensity:m.envMapIntensity}))])),
    capture:{...captureInfo,textures:Object.fromEntries(looks.map(mode=>[mode,captures[mode].texture.uuid]))},scope:scope.inspect()});},
   dispose(){if(disposed)return;disposed=true;scope.dispose();}
  };
 }catch(error){disposed=true;try{scope.dispose();}catch(cleanupError){throw new AggregateError([error,cleanupError],'CorePresentation build and cleanup failed');}throw error;}
}
