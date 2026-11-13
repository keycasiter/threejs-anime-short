// Independent procedural response; native r187 lighting/output remain in the bridge.
import {createMaterialShaderBridge} from './material-shader-bridge.mjs';
import {invariantArray} from '../geometry/formation-coordinates.mjs';
const fail=m=>{throw new RangeError('FormationResponse: '+m);};
const fields=['wavelengths','frameMatrix','colorLow','colorHigh','roughnessAmplitude','heightAmplitude','warp','seed'];
const record=x=>x!==null&&typeof x==='object'&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const glsl=`
uniform vec3 frWavelengths, frColorLow, frColorHigh;
uniform mat4 frFrame;
uniform float frRoughness, frHeight, frWarp, frSeed;
varying vec3 frPosition;
float frHash(vec3 p) { p = mod(p, 289.0); return fract(sin(dot(p,vec3(17.13,91.71,43.37))+frSeed)*4375.8543); }
// Value in w; xyz is the gradient with respect to the input coordinates.
vec4 frNoise(vec3 p) {
 vec3 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f), du=6.0*f*(1.0-f);
 float a=frHash(i), b=frHash(i+vec3(1,0,0)), c=frHash(i+vec3(0,1,0)), d=frHash(i+vec3(1,1,0));
 float e=frHash(i+vec3(0,0,1)), g=frHash(i+vec3(1,0,1)), h=frHash(i+vec3(0,1,1)), j=frHash(i+vec3(1,1,1));
 float ab=mix(a,b,u.x), cd=mix(c,d,u.x), eg=mix(e,g,u.x), hj=mix(h,j,u.x);
 float lo=mix(ab,cd,u.y), hi=mix(eg,hj,u.y);
 return vec4(du*vec3(mix(mix(b-a,d-c,u.y),mix(g-e,j-h,u.y),u.z),mix(cd-ab,hj-eg,u.z),hi-lo),mix(lo,hi,u.z));
}
float frVisibility(vec3 footprint,float frequency) { return 1.0-smoothstep(0.15,0.65,max(max(footprint.x,footprint.y),footprint.z)*frequency); }
// Returns (value, derivative along pixel x, derivative along pixel y).
// Filter weights are held fixed in this local first-order approximation.
vec3 frField(vec3 q,vec3 qx,vec3 qy) {
 vec3 footprint=abs(qx)+abs(qy);
 float warp=frWarp*frVisibility(footprint,0.5);
 vec4 b0=frNoise(q*0.5), b1=frNoise(q*0.5+vec3(13,7,3)), b2=frNoise(q*0.5+vec3(2,17,11));
 vec3 p=q+warp*(vec3(b0.w,b1.w,b2.w)-0.5);
 // The three bend gradients are rows of the warp Jacobian. Its 0.5 is
 // the chain rule for the noise input q*0.5.
 vec3 px=qx+0.5*warp*vec3(dot(b0.xyz,qx),dot(b1.xyz,qx),dot(b2.xyz,qx));
 vec3 py=qy+0.5*warp*vec3(dot(b0.xyz,qy),dot(b1.xyz,qy),dot(b2.xyz,qy));
 vec3 fp=max(footprint,abs(px)+abs(py));
 float w1=frVisibility(fp,1.0),w3=frVisibility(fp,3.0);
 const float tau=6.28318530718;
 #if FR_PATTERN == 0
 float phase=tau*p.x;
 float value=0.5+0.5*sin(phase)*w1;
 vec3 grad=vec3(0.5*tau*cos(phase)*w1,0,0);
 #elif FR_PATTERN == 1
 float z=p.z*1.57079632679;
 float coarse=tau*(p.x+0.15*sin(z)),fine=tau*(p.x*3.0+p.y*0.25);
 float value=0.5+0.35*sin(coarse)*w1+0.15*sin(fine)*w3;
 vec3 grad=0.35*tau*cos(coarse)*w1*vec3(1,0,0.15*1.57079632679*cos(z))
          +0.15*tau*cos(fine)*w3*vec3(3,0.25,0);
 #else
 vec4 coarse=frNoise(p),fine=frNoise(p*3.0+vec3(5,3,7));
 float value=0.5+(coarse.w-0.5)*0.7*w1+(fine.w-0.5)*0.3*w3;
 vec3 grad=coarse.xyz*(0.7*w1)+fine.xyz*(3.0*0.3*w3);
 #endif
 return vec3(value,dot(grad,px),dot(grad,py));
}
`;
const normal=`
// -vViewPosition is actual view-space surface position (metres).
vec3 frDx=dFdx(-vViewPosition), frDy=dFdy(-vViewPosition);
float frScale=max(length(frDx),length(frDy));
vec2 frHd=frSample.yz*frHeight;
if(frScale>1e-12) {
 vec3 frX=frDx/frScale, frY=frDy/frScale;
 vec3 frRx=cross(frY,frBaseNormal), frRy=cross(frBaseNormal,frX);
 float frDet=dot(frX,frRx);
 float frAlignment=dot(normal,frBaseNormal);
 if(abs(frDet)>1e-7 && frAlignment>1e-4) {
  // Invert n' = normalize(n - gradient); retain the native normal-map/bump result.
  vec3 frExistingGradient=frBaseNormal-normal/frAlignment;
  vec3 frHeightGradient=(frHd.x/frScale*frRx+frHd.y/frScale*frRy)/(frDet*faceDirection);
  normal=normalize(frBaseNormal-frExistingGradient-frHeightGradient);
 }
}
`;
export function createFormationResponse(T,options={}) {
 if(!record(options))fail('options require a plain record');
 const allowed=['baseMaterial','pattern','space','programKey','upstreamProgramKey','parameters'];
 for(const key of Reflect.ownKeys(options))if(!allowed.includes(key))fail('unknown option '+String(key));
 const {baseMaterial,pattern='bands',space='attached',programKey='formation-response/187/v1',upstreamProgramKey}=options;
 if(!['bands','fibres','aggregate'].includes(pattern)||!['attached','world'].includes(space))fail('invalid pattern or space');
 const toon=baseMaterial?.type==='MeshToonMaterial';
 function checked(input,previous) {
  if(!record(input))fail('parameters require a plain record');
  const patch={};for(const key of Reflect.ownKeys(input)){if(!fields.includes(key))fail('unknown parameter '+String(key));patch[key]=input[key];}
  const c={...previous,...patch};
  for(const [key,lo,hi] of [['wavelengths',.0001,1000],['colorLow',0,2],['colorHigh',0,2]]){
   const a=c[key];if(!Array.isArray(a)||a.length!==3)fail(key+' requires an ordinary xyz array');
   const copy=[a[0],a[1],a[2]];if(!copy.every(x=>Number.isFinite(x)&&x>=lo&&x<=hi))fail('invalid '+key);c[key]=copy;
  }
  for(const [key,max]of [['roughnessAmplitude',1],['heightAmplitude',.02],['warp',2]])if(!Number.isFinite(c[key])||c[key]<0||c[key]>max)fail('invalid '+key);
  if(toon&&c.roughnessAmplitude!==0)fail('Toon has no roughness consumer');
  if(!Number.isInteger(c.seed)||c.seed<0||c.seed>4294967295)fail('seed requires uint32');
  if(!(c.frameMatrix instanceof T.Matrix4))fail('frameMatrix requires THREE.Matrix4');
  const m=c.frameMatrix.clone(),e=m.elements;if(!e.every(Number.isFinite)||e[3]!==0||e[7]!==0||e[11]!==0||e[15]!==1)fail('frame must be finite affine');
  const axes=[new T.Vector3().fromArray(e,0),new T.Vector3().fromArray(e,4),new T.Vector3().fromArray(e,8)];
  if(axes.some(a=>Math.abs(a.lengthSq()-1)>1e-6)||Math.abs(axes[0].dot(axes[1]))>1e-6||Math.abs(axes[0].dot(axes[2]))>1e-6||Math.abs(axes[1].dot(axes[2]))>1e-6||Math.abs(m.determinant()-1)>1e-6)fail('frame must be unit rigid det+1');c.frameMatrix=m;return c;
 }
 let state=checked(options.parameters??{},{wavelengths:[.12,.12,.12],frameMatrix:new T.Matrix4(),colorLow:[.85,.85,.85],colorHigh:[1.15,1.15,1.15],roughnessAmplitude:toon?0:.15,heightAmplitude:.0004,warp:.25,seed:0});
 const uniforms={frWavelengths:{value:new T.Vector3()},frColorLow:{value:new T.Vector3()},frColorHigh:{value:new T.Vector3()},frFrame:{value:new T.Matrix4()},frRoughness:{value:0},frHeight:{value:0},frWarp:{value:0},frSeed:{value:0}};
 function upload(){for(const[k,n]of [['wavelengths','frWavelengths'],['colorLow','frColorLow'],['colorHigh','frColorHigh']])uniforms[n].value.fromArray(state[k]);uniforms.frFrame.value.copy(state.frameMatrix);for(const[k,n]of [['roughnessAmplitude','frRoughness'],['heightAmplitude','frHeight'],['warp','frWarp']])uniforms[n].value=state[k];uniforms.frSeed.value=state.seed%65521;}
 upload();
 const patches=[
 {stage:'vertex',anchor:'#include <common>',after:`varying vec3 frPosition;\n${space==='attached'?'attribute vec3 aFormationPosition;':''}`},
 {stage:'vertex',anchor:'#include <project_vertex>',before:`frPosition = ${space==='attached'?'aFormationPosition':'(modelMatrix * vec4(transformed,1.0)).xyz'};`},
 {stage:'fragment',anchor:'#include <common>',after:glsl},
 {stage:'fragment',anchor:'#include <color_fragment>',after:'vec3 frQ=(frFrame*vec4(frPosition,1.0)).xyz/frWavelengths;\nvec3 frSample=frField(frQ,dFdx(frQ),dFdy(frQ));\nfloat frValue=frSample.x;\ndiffuseColor.rgb *= mix(frColorLow,frColorHigh,frValue);'},
 {stage:'fragment',anchor:'#include <normal_fragment_begin>',after:'vec3 frBaseNormal = normal;'},
 {stage:'fragment',anchor:'#include <normal_fragment_maps>',after:normal}
 ];
 if(!toon)patches.push({stage:'fragment',anchor:'#include <roughnessmap_fragment>',after:'roughnessFactor=clamp(roughnessFactor+(frValue-0.5)*frRoughness,0.0,1.0);'});
 const bridge=createMaterialShaderBridge(T,{baseMaterial,programKey,upstreamProgramKey,uniforms,defines:{FR_PATTERN:['bands','fibres','aggregate'].indexOf(pattern)},patches});let disposed=false;
 const alive=()=>{if(disposed)fail('disposed response');};
 return {material:bridge.material,
 setParameters(patch){alive();const next=checked(patch,state);state=next;upload();},
 validateMesh(mesh){alive();
  if(!mesh?.isMesh||mesh.isInstancedMesh||mesh.isSkinnedMesh||mesh.isBatchedMesh)fail('requires ordinary rigid Mesh');
  const g=mesh.geometry,p=g?.getAttribute('position'),count=p?.count;
  if(!g?.isBufferGeometry||g.isInstancedBufferGeometry||!(p?.isBufferAttribute||p?.isInterleavedBufferAttribute)||p.isGLBufferAttribute||p.isInstancedBufferAttribute||p.data?.isInstancedInterleavedBuffer||p.itemSize!==3||!Number.isSafeInteger(count)||count<1||count>1048576)fail('requires 1–1048576 readable xyz vertices');
  if(Object.values(g.morphAttributes).some(a=>a.length))fail('morph deformation unsupported');
  let source=p;if(space==='attached'){source=g.getAttribute('aFormationPosition');invariantArray(T,source,'aFormationPosition',3,count);}
  const world=mesh.matrixWorld.clone(),e=world.elements;if(!e.every(Number.isFinite)||e[3]!==0||e[7]!==0||e[11]!==0||e[15]!==1||!Number.isFinite(world.determinant())||world.determinant()===0)fail('invalid matrixWorld');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],v=new T.Vector3(),pos=new T.Vector3(),wavelengths=new T.Vector3().fromArray(state.wavelengths);
  for(let i=0;i<count;i++){
   pos.fromBufferAttribute(p,i);if(!pos.toArray().every(Number.isFinite))fail('nonfinite position');v.fromBufferAttribute(source,i);if(!v.toArray().every(Number.isFinite))fail('nonfinite formation position');if(space==='world')v.applyMatrix4(world);v.applyMatrix4(state.frameMatrix).divide(wavelengths);
   const xyz=v.toArray();if(!xyz.every(x=>Number.isFinite(x)&&Math.abs(x)<=8192))fail('pattern domain exceeds 8192');for(let k=0;k<3;k++){min[k]=Math.min(min[k],xyz[k]);max[k]=Math.max(max[k],xyz[k]);}
  }return {vertexCount:count,domain:{min,max}};
 },
 inspect(){return {pattern,space,disposed,parameters:{...state,wavelengths:[...state.wavelengths],colorLow:[...state.colorLow],colorHigh:[...state.colorHigh],frameMatrix:state.frameMatrix.toArray()},consumers:toon?['color','mainNormal']:['color','roughness','mainNormal'],units:'metres',filter:'derivative fade; approximate'};},
 dispose(){if(!disposed){disposed=true;bridge.dispose();}}
 };
}
