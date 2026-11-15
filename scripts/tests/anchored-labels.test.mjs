import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createAnchoredCanvasLabel} from '../../assets/interaction/anchored-labels.mjs';

const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
function canvasFactory(){
 const context={font:'',textAlign:'',textBaseline:'',fillStyle:'',strokeStyle:'',lineWidth:1,measureText(s){const size=Number(this.font.match(/([\d.]+)px/)?.[1]??16);return {width:[...s].length*size*.55};},setTransform(){},clearRect(){},fillRect(){},strokeRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},arcTo(){},closePath(){},fill(){},stroke(){}};
 return {width:0,height:0,getContext(kind){assert.equal(kind,'2d');return context;},context};
}

test('world-sized label follows its real anchor without inheriting anchor scale',()=>{
 const scene=new T.Scene(),anchor=new T.Group(),canvas=canvasFactory();scene.add(anchor);anchor.position.set(2,3,4);anchor.scale.set(3,2,.5);
 const label=createAnchoredCanvasLabel(T,{scene,anchor,text:'Gate 12',canvasFactory:()=>canvas,worldHeight:.8,pixelRatio:2});
 assert.equal(label.sprite.isSprite,true);assert.equal(label.sprite.parent,scene);assert.equal(label.sprite.material.sizeAttenuation,true);
 assert.equal(label.sprite.scale.y,.8);assert.ok(Math.abs(label.sprite.scale.x-.8*canvas.width/canvas.height)<1e-12);
 assert.equal(label.texture.colorSpace,T.SRGBColorSpace);assert.equal(label.texture.generateMipmaps,false);
 anchor.position.x=5;label.update();assert.ok(Math.abs(label.sprite.position.x-5)<1e-9);assert.ok(Math.abs(label.sprite.position.y-3)<1e-9);assert.ok(Math.abs(label.sprite.position.z-4)<1e-9);
 label.dispose();assert.equal(label.sprite.parent,null);scene.clear();
});

test('view-sized label keeps its viewport-height fraction across perspective depth',()=>{
 const scene=new T.Scene(),anchor=new T.Group(),canvas=canvasFactory(),camera=new T.PerspectiveCamera(50,1.5,.1,100);scene.add(anchor);camera.updateProjectionMatrix();
 const label=createAnchoredCanvasLabel(T,{scene,anchor,text:'North',canvasFactory:()=>canvas,sizeMode:'view',viewHeight:.08,pixelRatio:1});
 assert.equal(label.sprite.material.sizeAttenuation,false);label.update(camera);
 const expected=.16/camera.projectionMatrix.elements[5];assert.ok(Math.abs(label.sprite.scale.y-expected)<1e-10);
 camera.fov=70;camera.updateProjectionMatrix();label.update(camera);assert.ok(Math.abs(label.sprite.scale.y-.16/camera.projectionMatrix.elements[5])<1e-10);
 label.dispose();
});

test('text updates redraw the owned canvas and dispose only label-owned resources',()=>{
 const scene=new T.Scene(),anchor=new T.Group(),canvas=canvasFactory();scene.add(anchor);const label=createAnchoredCanvasLabel(T,{scene,anchor,text:'A',canvasFactory:()=>canvas,worldHeight:.5});
 let textureDisposals=0,materialDisposals=0;label.texture.addEventListener('dispose',()=>textureDisposals++);label.sprite.material.addEventListener('dispose',()=>materialDisposals++);
 label.setText('A longer label');assert.ok(label.texture.version>1);assert.ok(label.sprite.scale.x>.5);
 const sharedGeometry=label.sprite.geometry;label.dispose();label.dispose();assert.equal(textureDisposals,1);assert.equal(materialDisposals,1);assert.equal(sharedGeometry.disposed,undefined);
 assert.throws(()=>label.update(),/disposed/i);assert.throws(()=>label.setText('again'),/disposed/i);
});

test('invalid dimensions, missing canvas, and detached scene owners fail explicitly',()=>{
 const scene=new T.Scene(),anchor=new T.Group();scene.add(anchor);
 assert.throws(()=>createAnchoredCanvasLabel(T,{scene,anchor,text:'x',canvasFactory:()=>canvasFactory(),worldHeight:0}),/worldHeight/i);
 assert.throws(()=>createAnchoredCanvasLabel(T,{scene,anchor,text:'x',canvasFactory:()=>canvasFactory(),sizeMode:'view',viewHeight:1.1}),/viewHeight/i);
 assert.throws(()=>createAnchoredCanvasLabel(T,{scene,anchor,text:'x',canvasFactory:()=>null,worldHeight:1}),/canvas/i);
 assert.throws(()=>createAnchoredCanvasLabel(T,{scene:new T.Scene(),anchor,text:'x',canvasFactory:()=>canvasFactory(),worldHeight:1}),/attached/i);
});
