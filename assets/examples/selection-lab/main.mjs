import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {OutlinePass} from 'three/addons/postprocessing/OutlinePass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {createPostPipeline} from '../../rendering/post-pipeline.mjs';
import {createSelectionFeedback} from '../../interaction/selection-feedback.mjs';

const canvas=document.querySelector('#scene'),status=document.querySelector('#status');
const renderer=new T.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
const scene=new T.Scene();scene.background=new T.Color('#18242a');scene.fog=new T.Fog('#18242a',20,42);
const camera=new T.PerspectiveCamera(40,1,.1,100);camera.position.set(8,6,11);
const controls=new OrbitControls(camera,canvas);controls.target.set(0,1,0);controls.enableDamping=true;controls.minDistance=5;controls.maxDistance=24;controls.update();controls.saveState();
scene.add(new T.HemisphereLight('#d6e4ec','#34362f',2));
const key=new T.DirectionalLight('#ffe0af',3);key.position.set(-5,9,6);scene.add(key);
const ground=new T.Mesh(new T.CircleGeometry(9,64),new T.MeshStandardMaterial({color:'#34413d',roughness:.9}));ground.rotation.x=-Math.PI/2;ground.position.y=-.08;ground.receiveShadow=true;scene.add(ground);
function box(name,color,pos,size,parent=scene){const m=new T.Mesh(new T.BoxGeometry(...size),new T.MeshStandardMaterial({color,roughness:.36,metalness:.08}));m.name=name;m.position.set(...pos);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
const targetRoot=new T.Group();targetRoot.name='beacon-root';scene.add(targetRoot);
const target=box('selectable-beacon','#df8c4e',[-1,1,0],[1.35,2,1.35],targetRoot);
const secondary=box('selectable-marker','#64aeb3',[2,.7,-2],[1.2,1.4,1.2]);
const occluder=box('unselectable-occluder','#566c72',[0,0,0],[2.4,2.8,.3]);
camera.updateMatrixWorld(true);occluder.quaternion.copy(camera.quaternion);
occluder.position.copy(target.getWorldPosition(new T.Vector3())).addScaledVector(camera.getWorldDirection(new T.Vector3()),-3);
const post=createPostPipeline(T,{EffectComposer,RenderPass,OutputPass,OutlinePass,SMAAPass},{renderer,scene,camera,width:1,height:1,pixelRatio:renderer.getPixelRatio(),outline:true,smaa:true});
post.passes.outline.visibleEdgeColor.set('#ffe4a8');post.passes.outline.hiddenEdgeColor.set('#bc805d');
const selection=createSelectionFeedback(T,{scene,camera,outlinePass:post.passes.outline});
selection.register('beacon:main',targetRoot);selection.register('marker:east',secondary);
function resize(){const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderer.setSize(r.width,r.height,false);post.resize(r.width,r.height,renderer.getPixelRatio());}
const observer=new ResizeObserver(resize);observer.observe(canvas.parentElement);resize();
let down=null;canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
canvas.addEventListener('pointercancel',()=>{down=null;});
canvas.addEventListener('pointerup',e=>{if(!down)return;const moved=Math.hypot(e.clientX-down[0],e.clientY-down[1]);down=null;if(moved>5)return;selection.pick(e.clientX,e.clientY,canvas.getBoundingClientRect());report();});
document.querySelector('#toggle-occluder').addEventListener('click',()=>{occluder.visible=!occluder.visible;report();});
document.querySelector('#clear').addEventListener('click',()=>{selection.clear();report();});
document.querySelector('#reset').addEventListener('click',()=>{controls.reset();selection.clear();report();});
function report(){status.dataset.status='PASS';status.textContent=JSON.stringify({...selection.readState(),outlineObjects:post.passes.outline.selectedObjects.map(o=>o.name),occluderVisible:occluder.visible},null,2);}
let disposed=false;function frame(){if(disposed)return;requestAnimationFrame(frame);controls.update();post.render();}frame();report();
window.__SELECTION_LAB__={selection,post,occluder,dispose(){if(disposed)return;disposed=true;observer.disconnect();controls.dispose();selection.dispose();post.dispose();renderer.dispose();}};
window.addEventListener('beforeunload',()=>window.__SELECTION_LAB__?.dispose(),{once:true});
