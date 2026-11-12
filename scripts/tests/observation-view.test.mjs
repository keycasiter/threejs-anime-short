import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
let api={};try{api=await import('../../assets/scene/observation-view.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
function choose(options={}){assert.equal(typeof api.selectObservationView,'function');return api.selectObservationView(T,{candidates:[{position:[0,0,5],target:[0,0,0]},{position:[0,0,-5],target:[0,0,0]},{position:[0,0,-6],target:[0,0,0]}],points:[[-.1,-.1,-.5],[.1,.1,-.5]],viewport:{width:1280,height:720},...options});}
test('actual target-surface occlusion selects the clearer authored camera and preserves tie order',()=>{
 const g=new T.BoxGeometry(),m=new T.MeshBasicMaterial(),object=new T.Mesh(g,m);
 const selected=choose({occluders:[object]});assert.equal(selected.index,1);assert.equal(selected.inspection.visibleSampleCount,2);
 assert.equal(selected.candidates[0].visibleSampleCount,0);assert.equal(selected.candidates[2].visibleSampleCount,2);
 g.dispose();m.dispose();
});
test('offscreen target samples cannot win through a false unblocked fraction',()=>{
 const selected=choose({candidates:[{position:[0,0,5],target:[100,0,0]},{position:[0,0,-5],target:[0,0,0]}]});
 assert.equal(selected.index,1);assert.equal(selected.candidates[0].visibleSampleCount,0);
});
test('invalid observation tasks are rejected rather than inventing a camera',()=>{
 for(const patch of [{candidates:[]},{points:[]},{fovDegrees:180},{near:1,far:.5},{candidates:[{position:[0,0,0],target:[0,0,0]}]}])assert.throws(()=>choose(patch));
});
