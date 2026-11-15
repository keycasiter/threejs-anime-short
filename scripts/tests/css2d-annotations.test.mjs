import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createCSS2DAnnotation} from '../../assets/interaction/css2d-annotations.mjs';

const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
function makeDocument(){
 const document={createElement(tag){
  const listeners=new Map();return {tagName:tag.toUpperCase(),style:{},dataset:{},attributes:{},children:[],parentNode:null,textContent:'',tabIndex:-1,addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);},dispatch(type,event={}){listeners.get(type)?.({preventDefault(){},stopPropagation(){},...event});},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k]??null;},appendChild(child){child.parentNode=this;this.children.push(child);return child;},remove(){if(!this.parentNode)return;const p=this.parentNode;p.children=p.children.filter(c=>c!==this);this.parentNode=null;}};}};return document;
}
class CSS2DObject extends T.Object3D{constructor(element){super();this.element=element;this.isCSS2DObject=true;}}

test('DOM annotation binds one accessible element to a real anchor and supports selection/close',()=>{
 const scene=new T.Scene(),anchor=new T.Group(),document=makeDocument();scene.add(anchor);anchor.position.set(3,2,-1);let selected=0,closed=0;
 const label=createCSS2DAnnotation(T,{CSS2DObject,scene,anchor,document,text:'West gate',offset:[0,1,0],onSelect:()=>selected++,onClose:()=>closed++});
 assert.equal(label.object.parent,anchor);assert.equal(label.element.getAttribute('role'),'group');assert.equal(label.element.getAttribute('aria-label'),'West gate');assert.equal(label.element.children[0].type,'button');assert.equal(label.element.children[0].getAttribute('aria-label'),'West gate');assert.equal(label.element.children[0].textContent,'West gate');
 label.content.dispatch('click');assert.equal(selected,1);label.closeButton.dispatch('click');assert.equal(label.readState().visible,false);assert.equal(closed,1);label.show();assert.equal(label.readState().visible,true);
 label.setText('North gate');assert.equal(label.content.getAttribute('aria-label'),'North gate');assert.equal(label.element.children[0].textContent,'North gate');label.dispose();assert.equal(label.object.parent,null);assert.equal(label.element.parentNode,null);
});

test('optional leader line tracks anchor and label in actual world coordinates',()=>{
 const scene=new T.Scene(),anchor=new T.Group(),document=makeDocument();scene.add(anchor);anchor.position.set(2,1,4);
 const label=createCSS2DAnnotation(T,{CSS2DObject,scene,anchor,document,text:'Dock',offset:[1,2,0],leaderLine:true});
 label.update();const p=label.leader.geometry.getAttribute('position');assert.deepEqual([p.getX(0),p.getY(0),p.getZ(0)],[2,1,4]);assert.deepEqual([p.getX(1),p.getY(1),p.getZ(1)],[3,3,4]);
 anchor.position.x=5;label.object.position.x=2;label.update();assert.equal(p.getX(0),5);assert.equal(p.getX(1),7);
 label.dispose();assert.equal(label.leader.parent,null);
});

test('DOM annotation validation and idempotent disposal leave renderer and borrowed materials alone',()=>{
 const scene=new T.Scene(),anchor=new T.Group(),document=makeDocument();scene.add(anchor);const material=new T.LineBasicMaterial();let disposed=0;material.addEventListener('dispose',()=>disposed++);
 assert.throws(()=>createCSS2DAnnotation(T,{CSS2DObject,scene,anchor,document,text:''}),/non-empty/i);
 const label=createCSS2DAnnotation(T,{CSS2DObject,scene,anchor,document,text:'Marker',leaderLine:true,lineMaterial:material});
 label.dispose();label.dispose();assert.equal(disposed,0);assert.throws(()=>label.update(),/disposed/i);material.dispose();assert.equal(disposed,1);
});
