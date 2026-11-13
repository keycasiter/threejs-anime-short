// Bounded coordinate fields and absolute-time bands for native r187 materials.
// A method owns only its derived material; the Mesh, base material and geometry are borrowed.
import {createMaterialShaderBridge} from './material-shader-bridge.mjs';
import {invariantArray} from '../geometry/formation-coordinates.mjs';

const fail=message=>{throw new RangeError('CoordinateResponse: '+message);};
const object=value=>value!==null&&typeof value==='object'&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const f32=value=>{
  if(typeof value!=='number'||!Number.isFinite(value))fail('expected a finite number');
  const result=Math.fround(value);
  if(!Number.isFinite(result))fail('value exceeds finite Float32 range');
  return result;
};
const vector3=(value,name)=>{
  if(!Array.isArray(value)||value.length!==3)fail(name+' must be an xyz array');
  return value.map(f32);
};
const uniform=value=>({value});
const allowedTop=new Set(['space','axis','kind','consumer','origin','low','high','range','width','feather','power','offsets','motion','programKey']);
const MAX_OFFSETS=32;

function checkedRecord(value,allowed,name){
  if(!object(value))fail(name+' must be a plain object');
  for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||!allowed.has(key))fail(name+' has unsupported field '+String(key));
}

function centerAt(clock,time){
  if(!Number.isFinite(time))fail('time must be finite seconds');
  let elapsed=time-clock.epoch;
  if(!Number.isFinite(elapsed))fail('elapsed time is not finite');
  if(clock.period!==undefined){
    elapsed%=clock.period;
    if(elapsed<0)elapsed+=clock.period;
    if(elapsed===clock.period)elapsed=0;
  }
  return f32(clock.start+clock.velocity*elapsed);
}

function checkedMaterial(mesh,T){
  if(!mesh?.isMesh||mesh.isSkinnedMesh||mesh.isInstancedMesh||mesh.geometry?.isInstancedBufferGeometry||!mesh.geometry?.isBufferGeometry)
    fail('expected an ordinary non-skinned Mesh with BufferGeometry');
  const material=mesh.material;
  if(!material||Array.isArray(material)||material.onBeforeCompile!==T.Material.prototype.onBeforeCompile||
      material.customProgramCacheKey!==T.Material.prototype.customProgramCacheKey||material.displacementMap)
    fail('expected one stock r187 material without displacement or custom shader hooks');
  if(![T.MeshStandardMaterial,T.MeshPhysicalMaterial,T.MeshToonMaterial].some(C=>Object.getPrototypeOf(material)===C.prototype))
    fail('base material must be an exact MeshStandardMaterial, MeshPhysicalMaterial or MeshToonMaterial');
  return material;
}

export function createCoordinateResponse(T,mesh,options){
  if(T?.REVISION!=='187')fail('requires Three.js r187');
  checkedRecord(options,allowedTop,'options');
  const {space,axis,kind,consumer,range,width,feather=0,power=1,offsets=[0],motion,
    origin=[0,0,0],low=[1,1,1],high=[1,1,1],programKey='coordinate-response/187/v1'}=options;
  if(!['attached','world'].includes(space)||!['x','y','z','xyRadius'].includes(axis)||
      !['gradient','band'].includes(kind)||!['base','outgoing'].includes(consumer))fail('invalid space, axis, kind or consumer');
  if(kind==='gradient'&&['width','feather','power','offsets','motion'].some(key=>Object.hasOwn(options,key)))
    fail('gradient options cannot contain band fields');
  if(kind==='band'&&Object.hasOwn(options,'range'))fail('band options cannot contain a gradient range');
  if(kind==='gradient'&&axis==='xyRadius')fail('a gradient requires a linear axis');
  if(typeof programKey!=='string'||!programKey.trim())fail('programKey must be nonempty');
  const base=checkedMaterial(mesh,T),geometry=mesh.geometry;
  const O=vector3(origin,'origin'),L=vector3(low,'low'),H=vector3(high,'high');
  if([...L,...H].some(x=>x<0))fail('color multipliers must be nonnegative');
  if(kind==='band'&&L.some(x=>x!==1))fail('band low color must be neutral white');

  const values={cwOrigin:uniform(new T.Vector3(...O)),cwLow:uniform(new T.Vector3(...L)),cwHigh:uniform(new T.Vector3(...H))};
  const declaration=[];
  let clock=null,bandOffsets=null,initialCenter=null;
  if(kind==='gradient'){
    if(!Array.isArray(range)||range.length!==2)fail('gradient range must contain [low, high]');
    const lo=f32(range[0]),hi=f32(range[1]),span=f32(hi-lo);
    if(!(span>0))fail('gradient range must have a positive Float32 span');
    values.cwLo=uniform(lo);values.cwSpan=uniform(span);
    declaration.push('uniform float cwLo,cwSpan;');
  }else{
    const fullWidth=f32(width),half=f32(fullWidth*.5),edge=f32(feather),curve=f32(power);
    if(!(half>0)||edge<0||edge>half||!(curve>0))fail('invalid full width, inner feather or power');
    if(edge>0&&f32(half-edge)===half)fail('inner feather collapses at this Float32 width');
    if(!Array.isArray(offsets)||offsets.length<1||offsets.length>MAX_OFFSETS)fail('expected 1..32 band offsets');
    bandOffsets=offsets.map(f32);
    checkedRecord(motion,new Set(['start','velocity','epoch','period']),'motion');
    clock={start:f32(motion.start),velocity:f32(motion.velocity),epoch:motion.epoch,period:motion.period};
    if(typeof clock.epoch!=='number'||!Number.isFinite(clock.epoch))fail('motion epoch must be finite absolute seconds');
    if(clock.period!==undefined&&(!(typeof clock.period==='number')||!Number.isFinite(clock.period)||!(clock.period>0)))fail('motion period must be positive finite seconds');
    initialCenter=centerAt(clock,clock.epoch);
    for(const offset of bandOffsets)f32(initialCenter+offset);
    values.cwHalf=uniform(half);values.cwEdge=uniform(edge);values.cwPow=uniform(curve);
    values.cwCenter=uniform(initialCenter);values.cwOffsets=uniform(new Float32Array(bandOffsets));
    declaration.push(`uniform float cwHalf,cwEdge,cwPow,cwCenter,cwOffsets[${bandOffsets.length}];`);
    declaration.push(`float cwBand(float s,float c){
 float d=abs(s-c);
 if(d>=cwHalf)return 0.0;
 if(cwEdge==0.0)return 1.0;
 float u=clamp((d-(cwHalf-cwEdge))/cwEdge,0.0,1.0);
 return 1.0-pow(u,cwPow);
}`);
  }

  let bridge,disposed=false,coordinateBounds=null;
  function validate(){
    if(disposed)fail('method is disposed');
    if(mesh.geometry!==geometry)fail('Mesh geometry changed; create a new method for the new geometry');
    if(mesh.material!==base&&mesh.material!==bridge?.material)fail('Mesh material changed outside this method');
    const position=geometry.getAttribute('position');
    if(!position||position.count<1||!Number.isSafeInteger(position.count))fail('geometry needs CPU-readable xyz positions');
    const p=invariantArray(T,position,'position',3,position.count);
    const source=space==='attached'?invariantArray(T,geometry.getAttribute('aFormationPosition'),'aFormationPosition',3,position.count):p;
    let matrix=null;
    if(space==='world'){
      mesh.updateWorldMatrix(true,false);matrix=mesh.matrixWorld;const e=matrix.elements;
      if(!e.every(x=>Number.isFinite(Math.fround(x)))||e[3]!==0||e[7]!==0||e[11]!==0||e[15]!==1||
          !Number.isFinite(matrix.determinant())||matrix.determinant()===0)fail('world coordinates require a finite invertible affine Mesh transform');
    }
    const point=new T.Vector3();let min=Infinity,max=-Infinity;
    for(let i=0;i<source.length;i+=3){
      point.fromArray(source,i);
      if(matrix)point.applyMatrix4(matrix);
      const x=f32(f32(point.x)-O[0]),y=f32(f32(point.y)-O[1]),z=f32(f32(point.z)-O[2]);
      const scalar=axis==='xyRadius'?f32(Math.hypot(x,y)):f32(({x,y,z})[axis]);
      min=Math.min(min,scalar);max=Math.max(max,scalar);
      if(kind==='gradient')f32(scalar-values.cwLo.value);
    }
    coordinateBounds={min,max};
    return coordinateBounds;
  }
  validate();
  const validateBandCenter=center=>{
    for(const offset of bandOffsets){const value=f32(center+offset);f32(coordinateBounds.min-value);f32(coordinateBounds.max-value);}
  };
  if(kind==='band')validateBandCenter(initialCenter);

  const cwPoint=space==='attached'?'aFormationPosition':'(modelMatrix * vec4(transformed,1.0)).xyz';
  const cwScalar=axis==='xyRadius'?'length(cwD.xy)':'cwD.'+axis;
  const cwMask=kind==='gradient'
    ?'float cwMask=clamp((cwS-cwLo)/cwSpan,0.0,1.0);'
    :'float cwMask=0.0;for(int i=0;i<'+bandOffsets.length+';++i){cwMask=max(cwMask,cwBand(cwS,cwCenter+cwOffsets[i]));}';
  const patch=`vec3 cwD=cwPoint-cwOrigin;
float cwS=${cwScalar};
${cwMask}
${consumer==='base'?'diffuseColor.rgb':'outgoingLight'}*=mix(cwLow,cwHigh,cwMask);`;
  const patches=[
    {stage:'vertex',anchor:'#include <common>',after:(space==='attached'?'attribute vec3 aFormationPosition;\n':'')+'varying vec3 cwPoint;'},
    {stage:'vertex',anchor:'#include <project_vertex>',before:'cwPoint='+cwPoint+';'},
    {stage:'fragment',anchor:'#include <common>',after:'varying vec3 cwPoint;\nuniform vec3 cwOrigin,cwLow,cwHigh;\n'+declaration.join('\n')},
    consumer==='base'
      ?{stage:'fragment',anchor:'#include <color_fragment>',after:patch}
      :{stage:'fragment',anchor:'#include <opaque_fragment>',before:patch}
  ];
  try{
    bridge=createMaterialShaderBridge(T,{baseMaterial:base,programKey,uniforms:values,patches});
  }catch(error){throw error;}
  const live=()=>{if(disposed)fail('method is disposed');};
  return {
    material:bridge.material,
    uniforms:bridge.uniforms,
    validate(){live();return validate();},
    seek(time){
      live();if(kind!=='band')fail('static gradient has no time input');
      const center=centerAt(clock,time);validateBandCenter(center);
      values.cwCenter.value=center;return center;
    },
    dispose(){if(!disposed){disposed=true;bridge.dispose();}}
  };
}
