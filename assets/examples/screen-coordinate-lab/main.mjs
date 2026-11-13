import * as T from 'three';
import {createScreenCoordinateProbe} from '../../rendering/screen-coordinate-probe.mjs';
import {captureRendererState,restoreRendererState} from '../../rendering/renderer-state.mjs';

const output=document.querySelector('#result');
const rows=[];
const near=(a,b,e=2/255)=>Math.abs(a-b)<=e;
function expect(ok,message){if(!ok)throw new Error(message);}
function sceneFor(viewport){
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);
  camera.position.z=1;camera.lookAt(0,0,0);
  const geometry=new T.PlaneGeometry(2,2),material=createScreenCoordinateProbe(T,{viewportPixels:viewport});
  scene.add(new T.Mesh(geometry,material));return {scene,camera,geometry,material};
}
function readTarget(renderer,target,x,y){const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,x,y,1,1,pixel);return [...pixel].map(v=>v/255);}
function checkPixel(pixel,viewport,x,y,label){
  const ex=(x+.5-viewport[0])/viewport[2],ey=(y+.5-viewport[1])/viewport[3];
  expect(near(pixel[0],ex),`${label} red channel ${pixel[0]} != ${ex}`);
  expect(near(pixel[1],ey),`${label} green channel ${pixel[1]} != ${ey}`);
  return {pixel,expected:[ex,ey]};
}
function runTarget(renderer){
  const W=64,H=48,before=captureRendererState(T,renderer),target=new T.WebGLRenderTarget(W,H,{
    format:T.RGBAFormat,type:T.UnsignedByteType,minFilter:T.NearestFilter,magFilter:T.NearestFilter,
    depthBuffer:false,stencilBuffer:false,generateMipmaps:false
  });
  const {scene,camera,geometry,material}=sceneFor([0,0,W,H]);
  try{
    renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setViewport(0,0,W,H);
    renderer.setClearColor(0x000000,1);renderer.clear(true,true,true);
    target.viewport.set(10,8,32,24);target.scissor.set(14,10,20,16);target.scissorTest=true;
    renderer.setRenderTarget(null);renderer.setRenderTarget(target);
    const active=renderer.getCurrentViewport(new T.Vector4()),vp=active.toArray();
    material.uniforms.uViewportPixels.value.copy(active);
    renderer.render(scene,camera);
    const inside=checkPixel(readTarget(renderer,target,15,11),vp,15,11,'target inside scissor');
    const other=checkPixel(readTarget(renderer,target,33,25),vp,33,25,'target far inside scissor');
    const outside=readTarget(renderer,target,13,11);
    expect(outside.slice(0,3).every(v=>v===0)&&outside[3]===1,`scissor leaked into pixel [13,11]: ${outside}`);
    return {name:'render target: offset viewport + scissor',status:'PASS',buffer:[W,H],viewport:vp,scissor:[14,10,20,16],inside,other,outside};
  }finally{
    geometry.dispose();material.dispose();target.dispose();restoreRendererState(renderer,before);
  }
}
function runCanvas(renderer,{dpr,width,height,label}){
  const before=captureRendererState(T,renderer),{scene,camera,geometry,material}=sceneFor([0,0,1,1]);
  try{
    renderer.setRenderTarget(null);renderer.setPixelRatio(dpr);renderer.setSize(width,height,false);
    renderer.setViewport(4,3,Math.floor(width/2),Math.floor(height/2));renderer.setScissorTest(false);
    renderer.setClearColor(0x000000,1);renderer.clear(true,true,true);
    const buffer=new T.Vector2();renderer.getDrawingBufferSize(buffer);
    const active=renderer.getCurrentViewport(new T.Vector4()),vp=active.toArray();
    material.uniforms.uViewportPixels.value.copy(active);
    renderer.render(scene,camera);renderer.getContext().finish();
    const x=vp[0]+Math.floor(vp[2]/2),y=vp[1]+Math.floor(vp[3]/2),pixel=new Uint8Array(4);
    renderer.getContext().readPixels(x,y,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,pixel);
    const checked=checkPixel([...pixel].map(v=>v/255),vp,x,y,label);
    expect(buffer.x===width*dpr&&buffer.y===height*dpr,`${label} drawing buffer ${buffer.toArray()} != ${width*dpr}x${height*dpr}`);
    expect(vp[0]===4*dpr&&vp[1]===3*dpr&&vp[2]===Math.floor(width/2)*dpr&&vp[3]===Math.floor(height/2)*dpr,
      `${label} active viewport ${vp} does not match DPR-scaled logical viewport`);
    return {name:label,status:'PASS',cssSize:[width,height],dpr,buffer:buffer.toArray(),viewport:vp,sample:{x,y,...checked}};
  }finally{geometry.dispose();material.dispose();restoreRendererState(renderer,before);}
}
let renderer=null;
try{
  expect(T.REVISION==='187',`expected r187; received ${T.REVISION}`);
  renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
  renderer.toneMapping=T.NoToneMapping;
  rows.push(runTarget(renderer));
  rows.push(runCanvas(renderer,{dpr:1,width:32,height:24,label:'canvas: DPR 1'}));
  rows.push(runCanvas(renderer,{dpr:2,width:32,height:24,label:'canvas: DPR 2'}));
  rows.push(runCanvas(renderer,{dpr:2,width:40,height:30,label:'canvas: resize at DPR 2'}));
  const result={threeRevision:T.REVISION,status:'PASS',cases:rows};
  window.__SCREEN_COORDINATE_RESULT__=structuredClone(result);
  output.dataset.status='PASS';output.textContent=JSON.stringify(result,null,2);
}catch(error){
  const result={threeRevision:T.REVISION,status:'FAIL',error:error.stack??error.message,cases:rows};
  window.__SCREEN_COORDINATE_RESULT__=structuredClone(result);
  output.dataset.status='FAIL';output.textContent=JSON.stringify(result,null,2);
}finally{renderer?.dispose();}
