import * as T from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {createCoordinateResponse} from '../../materials/coordinate-response.mjs';
import {writeFormationCoordinates} from '../../geometry/formation-coordinates.mjs';

const output=document.querySelector('#result'),canvas=document.querySelector('#view');
const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:false,preserveDrawingBuffer:true,premultipliedAlpha:false});
renderer.setPixelRatio(1);renderer.setSize(512,384,false);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.NoToneMapping;
const gl=renderer.getContext(),records=[],dispose=[];
const fail=message=>{throw new Error(message);};
const check=(condition,message,detail)=>{if(!condition)fail(message);records.push({check:message,...(detail??{})});};
const camera=new T.OrthographicCamera(-6,6,4.5,-4.5,.1,50);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
const lights=scene=>{scene.add(new T.HemisphereLight(0xffffff,0x28313a,.45));const key=new T.DirectionalLight(0xffffff,2.4);key.position.set(-2,3,8);scene.add(key);return key;};
const render=scene=>{renderer.setRenderTarget(null);renderer.clear(true,true,true);renderer.render(scene,camera);gl.finish();const error=gl.getError();if(error!==gl.NO_ERROR)fail('WebGL error 0x'+error.toString(16));};
const readPixel=world=>{
  const p=world.clone().project(camera),x=Math.max(0,Math.min(canvas.width-1,Math.floor((p.x*.5+.5)*canvas.width))),y=Math.max(0,Math.min(canvas.height-1,Math.floor((p.y*.5+.5)*canvas.height)));
  const rgba=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return {rgba:Array.from(rgba),x,y};
};
const pixel=(world,scene)=>{render(scene);return readPixel(world);};
const pixelThroughOutputPass=(world,scene)=>{
  const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));composer.addPass(new OutputPass());
  try{composer.render();gl.finish();const error=gl.getError();if(error!==gl.NO_ERROR)fail('OutputPass WebGL error 0x'+error.toString(16));return readPixel(world);}
  finally{composer.dispose();renderer.setRenderTarget(null);}
};
const maxDiff=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
const color=(rgb)=>new T.Color().setRGB(rgb[0],rgb[1],rgb[2],T.LinearSRGBColorSpace);
const baseMaterial=()=>new T.MeshStandardMaterial({color:0xffffff,roughness:.82,metalness:0});
const makePlane=(size=4)=>new T.PlaneGeometry(size,size);
const makeGradientWorld=()=>{
  const scene=new T.Scene();scene.background=new T.Color(0x111820);const key=lights(scene);
  const base=baseMaterial(),neighbor=new T.Mesh(makePlane(3),base);neighbor.position.set(2.5,0,0);scene.add(neighbor);
  const geometry=new T.PlaneGeometry(3.5,8),position=geometry.getAttribute('position'),attached=position.clone();
  for(let i=0;i<attached.count;i++)attached.setY(i,attached.getY(i)+4);geometry.setAttribute('aFormationPosition',attached);
  const subject=new T.Mesh(geometry,base);subject.position.x=-2.2;scene.add(subject);
  const low=[.2,.55,.8],high=[.9,.35,.12],response=createCoordinateResponse(T,subject,{space:'attached',axis:'y',kind:'gradient',consumer:'base',range:[0,8],low,high});
  dispose.push(()=>{response.dispose();geometry.dispose();neighbor.geometry.dispose();base.dispose();});
  return {scene,key,base,neighbor,subject,geometry,response,low,high};
};
function compareGradientAndLighting(){
  const w=makeGradientWorld(),mainPoint=new T.Vector3(-2.2,0,.01),neighborPoint=new T.Vector3(2.5,0,.01);
  const neighborBefore=pixel(neighborPoint,w.scene).rgba;
  w.subject.material=w.response.material;
  const got=pixel(mainPoint,w.scene),pixelY=got.y,worldY=camera.bottom+(pixelY+.5)/canvas.height*(camera.top-camera.bottom),t=Math.max(0,Math.min(1,(worldY+4)/8));
  const expected=color(w.low).lerp(color(w.high),t),native=w.subject.material;w.subject.material=new T.MeshStandardMaterial({color:expected,roughness:.82,metalness:0});
  const reference=pixel(mainPoint,w.scene).rgba;w.subject.material.dispose();w.subject.material=native;
  check(maxDiff(got.rgba,reference)<=2,'attached gradient matches same-path native reference',{actual:got.rgba,reference,t});
  const responseOutput=pixelThroughOutputPass(mainPoint,w.scene).rgba;w.subject.material=new T.MeshStandardMaterial({color:expected,roughness:.82,metalness:0});
  const outputReference=pixelThroughOutputPass(mainPoint,w.scene).rgba;w.subject.material.dispose();w.subject.material=native;
  check(maxDiff(responseOutput,outputReference)<=2,'linear intermediate plus one OutputPass matches its native reference',{actual:responseOutput,reference:outputReference,t});
  const neighborAfter=pixel(neighborPoint,w.scene).rgba;
  check(maxDiff(neighborBefore,neighborAfter)===0,'unmodified neighbor pixel remains unchanged',{before:neighborBefore,after:neighborAfter});
  const lit=pixel(mainPoint,w.scene).rgba;w.key.intensity=0;const dark=pixel(mainPoint,w.scene).rgba;w.key.intensity=2.4;
  check(maxDiff(lit,dark)>4,'native lighting still changes the gradient response',{lit,dark});
  const oldParent=new T.Group();oldParent.position.set(1,2,0);oldParent.rotation.z=.4;oldParent.scale.set(1.4,.8,1);oldParent.add(w.subject);oldParent.updateWorldMatrix(true,true);w.response.validate();oldParent.remove(w.subject);
}

function makeSweepWorld(){
  const scene=new T.Scene();scene.background=new T.Color(0x111820);lights(scene);
  const parentA=new T.Group(),parentB=new T.Group();parentA.position.x=-2.15;parentB.position.x=2.15;parentB.rotation.z=Math.PI/2;scene.add(parentA,parentB);
  const geometryA=makePlane(4),geometryB=makePlane(4),baseA=baseMaterial(),baseB=baseMaterial();
  const a=new T.Mesh(geometryA,baseA),b=new T.Mesh(geometryB,baseB);a.visible=false;b.visible=false;parentA.add(a);parentB.add(b);
  const options={space:'world',axis:'y',kind:'band',consumer:'outgoing',width:.8,feather:.2,power:2,high:[.3,.8,.6],motion:{start:-1,velocity:2,epoch:0}};
  const ra=createCoordinateResponse(T,a,options),rb=createCoordinateResponse(T,b,options);a.material=ra.material;b.material=rb.material;
  ra.seek(1);rb.seek(1);a.visible=true;b.visible=true;
  dispose.push(()=>{ra.dispose();rb.dispose();geometryA.dispose();geometryB.dispose();baseA.dispose();baseB.dispose();});
  return {scene,a,b,ra,rb};
}
function compareWorldSweeps(){
  const w=makeSweepWorld(),sampleA=new T.Vector3(-2.15,1,.01),sampleB=new T.Vector3(2.15,1,.01),outsideA=new T.Vector3(-2.15,0,.01);
  w.ra.seek(1);w.rb.seek(1);const activeA=pixel(sampleA,w.scene).rgba,activeB=pixel(sampleB,w.scene).rgba;
  w.ra.seek(0);w.rb.seek(0);const offTime=pixel(sampleA,w.scene).rgba;
  check(maxDiff(activeA,offTime)>8,'absolute-time window moves across actual pixels',{activeA,offTime});
  check(maxDiff(activeA,activeB)<=2,'same world band reaches differently parented meshes',{activeA,activeB});
  w.ra.seek(2);w.rb.seek(2);pixel(sampleA,w.scene);
  w.ra.seek(1);w.rb.seek(1);const reverseSeek=pixel(sampleA,w.scene).rgba;
  check(maxDiff(activeA,reverseSeek)<=1,'reverse and repeated absolute-time seek reproduces pixels',{activeA,reverseSeek});
  const noBand=pixel(outsideA,w.scene).rgba;
  check(maxDiff(noBand,offTime)<=2,'outside band returns to the original outgoing light',{noBand,offTime});
  const originalSide=w.ra.material.side;w.ra.material.side=T.DoubleSide;w.ra.material.needsUpdate=true;w.ra.seek(1);
  const changedVariant=pixel(sampleA,w.scene).rgba;w.ra.material.side=originalSide;w.ra.material.needsUpdate=true;
  check(maxDiff(changedVariant,activeA)<=1,'new native program variant retains the band and its uniforms',{changedVariant});
  const darkScene=new T.Scene();darkScene.background=new T.Color(0x111820);const darkMesh=new T.Mesh(makePlane(),new T.MeshStandardMaterial({color:0xffffff,roughness:1}));darkScene.add(darkMesh);
  const original=darkMesh.material,blackResponse=createCoordinateResponse(T,darkMesh,{...{space:'world',axis:'y',kind:'band',consumer:'outgoing',width:2,feather:0,power:1,high:[.2,.2,.2],motion:{start:0,velocity:0,epoch:0}}});
  darkMesh.material=blackResponse.material;const blackKey=new T.DirectionalLight(0xffffff,0);darkScene.add(blackKey);const black=pixel(new T.Vector3(0,0,.01),darkScene).rgba;
  check(black[0]<=2&&black[1]<=2&&black[2]<=2,'outgoing-light window does not create light in a dark scene',{black});
  blackResponse.dispose();darkMesh.geometry.dispose();original.dispose();
}

function compareRadialDepth(){
  const scene=new T.Scene();scene.background=new T.Color(0x111820);lights(scene);
  const geometry0=makePlane(5),geometry1=makePlane(5),base0=baseMaterial(),base1=baseMaterial();
  const a=new T.Mesh(geometry0,base0),b=new T.Mesh(geometry1,base1);b.position.z=1;scene.add(a,b);
  const options={space:'world',axis:'xyRadius',kind:'band',consumer:'base',origin:[0,0,0],width:.7,feather:.2,power:1,high:[.25,.7,.45],motion:{start:1.4,velocity:0,epoch:0}};
  const ra=createCoordinateResponse(T,a,options),rb=createCoordinateResponse(T,b,options);a.material=ra.material;b.material=rb.material;
  try{
    b.visible=false;const ringA=pixel(new T.Vector3(1.4,0,.01),scene).rgba,center=pixel(new T.Vector3(0,0,.01),scene).rgba,outer=pixel(new T.Vector3(2.1,0,.01),scene).rgba;
    b.visible=true;a.visible=false;const ringB=pixel(new T.Vector3(1.4,0,1.01),scene).rgba;
    check(maxDiff(ringA,center)>8&&maxDiff(ringA,outer)>8,'radial window has an interior ring and a clear center/exterior',{ring:ringA,center,outer});
    check(maxDiff(ringA,ringB)<=2,'XY radius is invariant to world z depth',{near:ringA,far:ringB});
  }finally{ra.dispose();rb.dispose();geometry0.dispose();geometry1.dispose();base0.dispose();base1.dispose();}
}

function checkAlpha(){
  const scene=new T.Scene(),geometry=makePlane(),base=new T.MeshPhysicalMaterial({color:0xffffff,transparent:true,opacity:.375,blending:T.NoBlending});
  writeFormationCoordinates(T,geometry);
  const mesh=new T.Mesh(geometry,base);scene.add(mesh);
  const response=createCoordinateResponse(T,mesh,{space:'attached',axis:'y',kind:'gradient',consumer:'base',range:[-2,2],low:[.5,.5,.5],high:[1,1,1]});mesh.material=response.material;
  try{
    renderer.setClearColor(0x000000,0);const sample=pixel(new T.Vector3(0,0,.01),scene).rgba;
    check(Math.abs(sample[3]-Math.round(.375*255))<=1,'native output preserves unblended opacity alpha',{rgba:sample});
  }finally{renderer.setClearColor(0x111820,1);response.dispose();geometry.dispose();base.dispose();}
}

try{
  compareGradientAndLighting();compareWorldSweeps();compareRadialDepth();checkAlpha();
  output.dataset.status='PASS';output.textContent=JSON.stringify({status:'PASS',three:T.REVISION,renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),outputColorSpace:renderer.outputColorSpace,programs:renderer.info.programs?.length??null,glError:gl.getError(),checks:records.length,records},null,2);
}catch(error){output.dataset.status='FAIL';output.textContent=JSON.stringify({status:'FAIL',message:error?.stack??String(error),three:T.REVISION,renderer:gl.getParameter(gl.RENDERER),glError:gl.getError(),checks:records},null,2);}
finally{for(const release of dispose.reverse())try{release();}catch{}renderer.dispose();}
