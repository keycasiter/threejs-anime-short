import {createFormationResponse} from './formation-response.mjs';
const fail=message=>{throw new RangeError('FormationPalette: '+message);};
const record=x=>x!==null&&typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const parameterKeys=['wavelengths','frameMatrix','colorLow','colorHigh','roughnessAmplitude','heightAmplitude','warp','seed'];
// Surface textures use material UV channels. Environment and lighting ramps do not.
const surfaceMaps=['map','normalMap','bumpMap','roughnessMap','metalnessMap','displacementMap','alphaMap','aoMap','lightMap','emissiveMap','clearcoatMap','clearcoatRoughnessMap','clearcoatNormalMap','sheenColorMap','sheenRoughnessMap','transmissionMap','thicknessMap','specularMap','specularIntensityMap','specularColorMap','iridescenceMap','iridescenceThicknessMap','anisotropyMap'];
function keys(value,allowed,label){if(!record(value))fail(label+' requires a plain record');for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||!allowed.includes(key))fail('unknown '+label+' field '+String(key));}
export function createFormationPalette(T,options={}) {
 keys(options,['basePalette','profiles','applyWhen'],'options');
 const {basePalette,profiles={},applyWhen='unmapped'}=options;
 if(String(T?.REVISION)!=='180')fail('requires Three r180');
 if(typeof basePalette?.get!=='function')fail('basePalette requires get');
 if(!['unmapped','all'].includes(applyWhen))fail('invalid applyWhen');
 if(!record(profiles))fail('profiles requires a plain dictionary');
 const names=Reflect.ownKeys(profiles);if(names.length>32)fail('profiles exceeds 32 roles');
 const fixed=new Map();
 for(const role of names){
  if(typeof role!=='string'||!role.trim()||role.length>128)fail('role requires 1–128 characters');
  const source=profiles[role];if(source===null){fixed.set(role,null);continue;}
  keys(source,['pattern','space','parameters','programKey','upstreamProgramKey'],'profile');
  const profile={};for(const key of ['pattern','space','programKey','upstreamProgramKey'])if(Object.hasOwn(source,key))profile[key]=source[key];
  if(profile.pattern!==undefined&&!['bands','fibres','aggregate'].includes(profile.pattern))fail('invalid pattern');
  if(profile.space!==undefined&&!['attached','world'].includes(profile.space))fail('invalid space');
  for(const key of ['programKey','upstreamProgramKey'])if(Object.hasOwn(profile,key)&&(typeof profile[key]!=='string'||!profile[key].trim()||profile[key].length>1024))fail('invalid '+key);
  if(Object.hasOwn(source,'parameters')){
   const input=source.parameters;keys(input,parameterKeys,'parameters');profile.parameters={};
   for(const key of Reflect.ownKeys(input)){
    const value=input[key];
    if(['wavelengths','colorLow','colorHigh'].includes(key)){
     if(!Array.isArray(value)||value.length!==3)fail(key+' requires an ordinary xyz array');
     profile.parameters[key]=[value[0],value[1],value[2]];
    }else if(key==='frameMatrix'){
     if(!(value instanceof T.Matrix4))fail('frameMatrix requires THREE.Matrix4');
     // Read bounded numeric indices; never invoke a caller-owned iterator or clone override.
     const matrix=new T.Matrix4();for(let i=0;i<16;i++)matrix.elements[i]=value.elements[i];profile.parameters[key]=matrix;
    }else {if(typeof value!=='number')fail(key+' requires a number');profile.parameters[key]=value;}
   }
  }
  fixed.set(role,profile);
 }
 const entries=new Map(),returned=new Map(),bases=new Map();let disposed=false;
 const alive=()=>{if(disposed)fail('disposed palette');};
 function dto(entry){return {role:entry.role,profileKey:entry.profileKey,baseMaterialUuid:entry.base.uuid,materialUuid:entry.material.uuid,passthrough:!entry.response,response:entry.response?.inspect()??null};}
 return {
  get(role,options={},profileKey){
   alive();
   if(profileKey!==undefined&&(typeof profileKey!=='string'||!profileKey.trim()||profileKey.length>128||!fixed.has(profileKey)))fail('profileKey requires a registered 1–128 character name');
   const effectiveProfileKey=profileKey===undefined?role:profileKey;
   const base=basePalette.get(role,options);
   if(!base?.isMaterial||typeof base.uuid!=='string')fail('basePalette returned invalid Material');
   if(bases.has(base.uuid)&&bases.get(base.uuid)!==base)fail('base uuid collision');
   const profile=fixed.get(effectiveProfileKey);let byBase=entries.get(role),byProfile=byBase?.get(base.uuid);const existing=byProfile?.get(effectiveProfileKey);
   if(existing)return existing.material;
   let response=null;
   if(profile&&!(applyWhen==='unmapped'&&surfaceMaps.some(key=>base[key]!=null)))response=createFormationResponse(T,{...profile,baseMaterial:base});
   const entry={role,profileKey:effectiveProfileKey,base,response,material:response?.material??base};
   // Publish identity only after a complete response (or borrowed passthrough) exists.
   if(!byBase){byBase=new Map();entries.set(role,byBase);}
   if(!byProfile){byProfile=new Map();byBase.set(base.uuid,byProfile);}byProfile.set(effectiveProfileKey,entry);bases.set(base.uuid,base);
   // A shared passthrough material can be returned by several roles; its qualification is identical.
   returned.set(entry.material,entry);return entry.material;
  },
  validateMesh(mesh,materialOrArray=mesh?.material){
   alive();const list=Array.isArray(materialOrArray)?materialOrArray:[materialOrArray];
   if(!list.length)fail('requires a Material or nonempty Material array');
   const candidates=[];for(let i=0;i<list.length;i++){const entry=returned.get(list[i]);if(!entry)fail('material was not returned by this palette');candidates.push(entry);}
   const responses=[];let passthroughMaterialCount=0;
   for(const entry of candidates)if(entry.response)responses.push({materialUuid:entry.material.uuid,...entry.response.validateMesh(mesh)});else passthroughMaterialCount++;
   return {responses,passthroughMaterialCount};
  },
  inspect(){return {disposed,applyWhen,profiles:[...fixed].map(([role,profile])=>({role,enabled:profile!==null,pattern:profile?.pattern??'bands',space:profile?.space??'attached',validation:'numeric/base compatibility checked on first derived get'})),entries:[...entries.values()].flatMap(group=>[...group.values()].flatMap(profiles=>[...profiles.values()].map(dto)))};},
  dispose(){
   if(disposed)return;disposed=true;const errors=[];
   try{for(const group of entries.values())for(const profiles of group.values())for(const entry of profiles.values())if(entry.response)try{entry.response.dispose();}catch(error){errors.push(error);}}
   finally{entries.clear();returned.clear();bases.clear();fixed.clear();}
   if(errors.length)throw new AggregateError(errors,'FormationPalette: response disposal failed');
  }
 };
}
