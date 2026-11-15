import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CSS2DObject,CSS2DRenderer} from 'three/addons/renderers/CSS2DRenderer.js';
import {createAnchoredCanvasLabel} from '../../interaction/anchored-labels.mjs';
import {createCSS2DAnnotation} from '../../interaction/css2d-annotations.mjs';
import {auditScreenOverlays} from '../../interaction/screen-overlay-audit.mjs';

const canvas=document.querySelector('#scene'),labelLayer=document.querySelector('#labels'),status=document.querySelector('#status');
const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
const scene=new T.Scene();scene.background=new T.Color('#182126');scene.fog=new T.Fog('#182126',22,58);
const camera=new T.PerspectiveCamera(42,1,.1,100);camera.position.set(12,14,28);
const controls=new OrbitControls(camera,canvas);controls.target.set(0,3,0);controls.enableDamping=true;controls.minDistance=10;controls.maxDistance=50;controls.update();controls.saveState();
scene.add(new T.HemisphereLight('#d8e4e9','#343a34',1.8));const sun=new T.DirectionalLight('#ffe0bd',3.2);sun.position.set(-8,14,9);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);scene.add(sun);
const floor=new T.Mesh(new T.BoxGeometry(22,.5,18),new T.MeshStandardMaterial({color:'#35413b',roughness:.9}));floor.position.y=-.25;floor.receiveShadow=true;scene.add(floor);
function box(name,color,position,size){const m=new T.Mesh(new T.BoxGeometry(...size),new T.MeshStandardMaterial({color,roughness:.43,metalness:.08}));m.name=name;m.position.set(...position);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;}
function station(name,color,x,z,height){const pedestal=box(`${name}-pedestal`,color,[x,height/2,z],[1.2,height,1.2]);const cap=box(`${name}-cap`,'#c9baa0',[x,height+.12,z],[1.5,.24,1.5]);const anchor=new T.Group();anchor.name=`${name}-anchor`;anchor.position.set(x,height+.22,z);scene.add(anchor);return {name,pedestal,cap,anchor};}
const near=station('Near station','#4e9a90',-4,-1,2.2),far=station('Far station','#c7834e',3.2,-5,5.8),middle=station('Relay point','#697f9b',4.2,3,3.5);
const sprites=[
 createAnchoredCanvasLabel(T,{scene,anchor:near.anchor,text:'WORLD · 0.48 m',worldHeight:.48,fontSize:22,font:'600 22px system-ui, sans-serif',padding:8,maxTextWidth:240,lineHeight:28,pixelRatio:2,offset:[0,.2,0],background:'#14251fe8',foreground:'#e4fff0',border:'#8dc8aa'}),
 createAnchoredCanvasLabel(T,{scene,anchor:far.anchor,text:'WORLD · 0.48 m',worldHeight:.48,fontSize:22,font:'600 22px system-ui, sans-serif',padding:8,maxTextWidth:240,lineHeight:28,pixelRatio:2,offset:[0,.2,0],background:'#2b1a12e8',foreground:'#fff0dc',border:'#e6a86e'}),
 createAnchoredCanvasLabel(T,{scene,anchor:near.anchor,text:'VIEW · 4.5%',sizeMode:'view',viewHeight:.045,fontSize:20,font:'600 20px system-ui, sans-serif',padding:7,maxTextWidth:240,lineHeight:25,pixelRatio:2,offset:[0,.95,0],background:'#1a2034e8',foreground:'#e6eaff',border:'#97a9ed'}),
 createAnchoredCanvasLabel(T,{scene,anchor:far.anchor,text:'VIEW · 4.5%',sizeMode:'view',viewHeight:.045,fontSize:20,font:'600 20px system-ui, sans-serif',padding:7,maxTextWidth:240,lineHeight:25,pixelRatio:2,offset:[0,.95,0],background:'#302019e8',foreground:'#fff0dc',border:'#e6a86e'})
];
for(const label of sprites){label.sprite.material.depthTest=true;label.sprite.material.fog=false;}
const cssRenderer=new CSS2DRenderer();cssRenderer.domElement.className='css2d-renderer';cssRenderer.domElement.style.position='absolute';cssRenderer.domElement.style.inset='0';cssRenderer.domElement.style.pointerEvents='none';labelLayer.appendChild(cssRenderer.domElement);
const annotations=[];
annotations.push(createCSS2DAnnotation(T,{CSS2DObject,scene,anchor:near.anchor,document,text:'Near station · selectable',id:'near',offset:[.3,2.2,.1],leaderLine:true,lineColor:'#9fd4bd',onSelect:({id})=>report(`Selected ${id}`),onClose:({id})=>report(`Closed ${id}`)}));
annotations.push(createCSS2DAnnotation(T,{CSS2DObject,scene,anchor:far.anchor,document,text:'Far station · shared renderer',id:'far',offset:[.95,1.9,0],leaderLine:true,lineColor:'#e6b17c',onSelect:({id})=>report(`Selected ${id}`),onClose:({id})=>report(`Closed ${id}`)}));
annotations.push(createCSS2DAnnotation(T,{CSS2DObject,scene,anchor:middle.anchor,document,text:'Relay point · batch member',id:'relay',offset:[.3,1.7,0],leaderLine:false,onSelect:({id})=>report(`Selected ${id}`),onClose:({id})=>report(`Closed ${id}`)}));
function resize(){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderer.setSize(r.width,r.height,false);cssRenderer.setSize(r.width,r.height);}
const observer=new ResizeObserver(resize);observer.observe(canvas.parentElement);resize();
document.querySelector('#toggle-sprites').addEventListener('click',()=>{const show=sprites.some(x=>x.sprite.visible===false);for(const label of sprites)label.sprite.visible=show;report(show?'Sprite labels shown':'Sprite labels hidden');});
document.querySelector('#toggle-html').addEventListener('click',()=>{const show=annotations.some(x=>x.readState().visible===false);for(const label of annotations)(show?label.show:label.hide)();report(show?'HTML labels shown':'HTML labels hidden');});
function auditLayout(){
 const bounds=labelLayer.getBoundingClientRect();
 const result=auditScreenOverlays({viewport:bounds,items:annotations.filter(a=>a.readState().visible).map(a=>({id:a.element.dataset.annotationId,rect:a.element.getBoundingClientRect()})),safeInsets:{left:12,top:12,right:12,bottom:12}});
 status.dataset.status=result.status;status.textContent=JSON.stringify({message:'Measured visible CSS2D label rectangles in the stage viewport',...result},null,2);return result;
}
document.querySelector('#audit-layout').addEventListener('click',auditLayout);
document.querySelector('#reset').addEventListener('click',()=>{controls.reset();report('Camera reset');});
function report(message='Running'){status.dataset.status='INFO';status.textContent=JSON.stringify({message,threeRevision:T.REVISION,canvasLabels:sprites.length,htmlLabels:annotations.map(x=>x.readState()),css2dRendererShared:true,sizeModes:['world-meters','viewport-height-fraction']},null,2);}
let disposed=false;function frame(){if(disposed)return;requestAnimationFrame(frame);controls.update();for(const label of sprites)label.update(camera);for(const label of annotations)label.update();renderer.render(scene,camera);cssRenderer.render(scene,camera);}
frame();report();
window.__ANCHORED_LABEL_LAB__={sprites,annotations,renderer,cssRenderer,auditLayout,dispose(){if(disposed)return;disposed=true;observer.disconnect();controls.dispose();for(const label of sprites)label.dispose();for(const label of annotations)label.dispose();cssRenderer.domElement.remove();renderer.dispose();}};
window.addEventListener('beforeunload',()=>window.__ANCHORED_LABEL_LAB__?.dispose(),{once:true});
