import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSelectionFeedback} from '../../assets/interaction/selection-feedback.mjs';

const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const rect={left:20,top:10,width:200,height:100};
function setup(){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(45,2,.1,50);camera.position.set(0,0,8);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const outlinePass={selectedObjects:[]},selection=createSelectionFeedback(T,{scene,camera,outlinePass});
 const mesh=(z,material=new T.MeshBasicMaterial())=>{const m=new T.Mesh(new T.BoxGeometry(2,2,1),material);m.position.z=z;scene.add(m);return m;};
 return {scene,camera,outlinePass,selection,mesh};
}

test('nearest visible unregistered surface occludes selectable object behind it',()=>{
 const {outlinePass,selection,mesh}=setup(),behind=mesh(0),blocker=mesh(3);
 selection.register('behind',behind);
 assert.deepEqual(selection.pick(120,60,rect).id,null);
 assert.equal(outlinePass.selectedObjects.length,0);
 blocker.visible=false;
 assert.equal(selection.pick(120,60,rect).id,'behind');
 assert.deepEqual(outlinePass.selectedObjects,[behind]);
});

test('hidden ancestors and invisible material slots do not intercept selection',()=>{
 const {scene,selection,mesh}=setup(),target=mesh(0),hidden=mesh(3,new T.MeshBasicMaterial({visible:false}));
 selection.register('target',target);
 assert.equal(selection.pick(120,60,rect).id,'target');
 const parent=new T.Group();scene.add(parent);parent.add(hidden);parent.visible=false;
 assert.equal(selection.pick(120,60,rect).id,'target');
});

test('fully transparent materials do not become visible occluders',()=>{
 const {selection,mesh}=setup(),target=mesh(0),ghost=mesh(3,new T.MeshBasicMaterial({transparent:true,opacity:0}));
 selection.register('target',target);
 assert.equal(selection.pick(120,60,rect).id,'target');
 ghost.material.opacity=.4;
 assert.equal(selection.pick(120,60,rect).id,null);
});

test('semantic ids are unique, explicit selection is validated, and unregister clears outline',()=>{
 const {selection,outlinePass,mesh}=setup(),root=mesh(0),release=selection.register('beacon:body',root);
 assert.throws(()=>selection.register('beacon:body',mesh(2)),/duplicate/);
 assert.throws(()=>selection.register('other',root),/already registered/);
 assert.throws(()=>selection.select('missing'),/unknown selection id/);
 assert.equal(selection.select('beacon:body'),'beacon:body');assert.deepEqual(outlinePass.selectedObjects,[root]);
 assert.equal(release(),true);assert.equal(selection.readState().selectedId,null);assert.deepEqual(outlinePass.selectedObjects,[]);
 assert.equal(release(),false);
});

test('one semantic root groups nested meshes under a single stable id',()=>{
 const {scene,selection,outlinePass}=setup(),root=new T.Group(),part=new T.Mesh(new T.BoxGeometry(2,2,1),new T.MeshBasicMaterial());
 scene.add(root);root.add(part);root.userData.entityId='asset:assembled';selection.register(root.userData.entityId,root);
 assert.equal(selection.pick(120,60,rect).id,root.userData.entityId);
 assert.deepEqual(outlinePass.selectedObjects,[root]);
});

test('pointer outside the CSS viewport clears state and malformed rectangles fail explicitly',()=>{
 const {selection,mesh}=setup(),root=mesh(0);selection.register('target',root);selection.select('target');
 assert.deepEqual(selection.pick(500,60,rect),{id:null,hit:null});
 assert.throws(()=>selection.pick(1,2,{left:0,top:0,width:0,height:1}),/positive CSS rect/);
});

test('dispose clears outline and prevents further operations',()=>{
 const {selection,outlinePass,mesh}=setup();selection.register('target',mesh(0));selection.select('target');selection.dispose();selection.dispose();
 assert.deepEqual(outlinePass.selectedObjects,[]);assert.deepEqual(selection.readState(),{selectedId:null,registered:0,disposed:true});
 assert.throws(()=>selection.clear(),/disposed/);
});
