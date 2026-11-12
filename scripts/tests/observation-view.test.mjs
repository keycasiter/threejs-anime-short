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
 assert.deepEqual(selected.candidates[0].visibleSampleIndices,[]);assert.deepEqual(selected.candidates[1].visibleSampleIndices,[0,1]);
 g.dispose();m.dispose();
});
test('offscreen target samples cannot win through a false unblocked fraction',()=>{
 const selected=choose({candidates:[{position:[0,0,5],target:[100,0,0]},{position:[0,0,-5],target:[0,0,0]}]});
 assert.equal(selected.index,1);assert.equal(selected.candidates[0].visibleSampleCount,0);
});
test('invalid observation tasks are rejected rather than inventing a camera',()=>{
 for(const patch of [{candidates:[]},{points:[]},{fovDegrees:180},{near:1,far:.5},{candidates:[{position:[0,0,0],target:[0,0,0]}]}])assert.throws(()=>choose(patch));
});

test('framing the required relation envelope outranks a cropped view with identical point visibility',()=>{
 const selected=choose({candidates:[{position:[0,0,3],target:[0,0,0]},{position:[0,0,12],target:[0,0,0]}],points:[[0,0,0]],frameBounds:new T.Box3(new T.Vector3(-2,-2,-1),new T.Vector3(2,2,1)),marginPixels:30});
 assert.equal(selected.index,1);assert.equal(selected.candidates[0].envelopeInside,false);assert.equal(selected.candidates[1].envelopeInside,true);
});

test('independent feature requirements keep a small interface from disappearing behind abundant body samples',()=>{
 const selected=choose({candidates:[{position:[0,0,5],target:[0,0,0]},{position:[0,0,12],target:[0,0,0]}],points:[[0,0,0]],requiredFeatures:[{id:'body',points:[[0,0,0],[.1,0,0],[-.1,0,0]],minVisibleFraction:1},{id:'interface',points:[[4.2,0,0]],minVisibleFraction:1}]});
 assert.equal(selected.index,1);assert.equal(selected.candidates[0].satisfiedFeatureCount,1);assert.equal(selected.candidates[1].satisfiedFeatureCount,2);
 assert.equal(selected.inspection.features[1].id,'interface');
});

test('unmet authored view constraints are reported without inventing successful coverage',()=>{
 const selected=choose({candidates:[{position:[0,0,5],target:[0,0,0]}],points:[[0,0,0]],frameBounds:new T.Box3(new T.Vector3(-50,-50,-1),new T.Vector3(50,50,1)),requiredFeatures:[{id:'outside',points:[[100,0,0]],minVisibleFraction:1}]});
 assert.equal(selected.inspection.envelopeInside,false);assert.equal(selected.inspection.satisfiedFeatureCount,0);
});

test('ambiguous feature IDs, invalid framing margins and invalid envelopes are rejected',()=>{
 for(const patch of [{requiredFeatures:[{id:'x',points:[],minVisibleFraction:1}]},{requiredFeatures:[{id:'x',points:[[0,0,0]]},{id:'x',points:[[1,0,0]]}]},{requiredFeatures:[{id:'x',points:[[0,0,0]],minVisibleFraction:2}]},{frameBounds:new T.Box3()},{marginPixels:-1},{marginPixels:4000}])assert.throws(()=>choose(patch));
});

test('a required feature behind a page overlay cannot satisfy its visible fraction',()=>{
 const selected=choose({candidates:[{position:[0,0,5],target:[0,0,0]},{position:[0,0,10],target:[0,0,0]}],points:[[0,0,0]],requiredFeatures:[{id:'joint',points:[[1,0,0]],minVisibleFraction:1}],overlays:[{id:'panel',left:790,top:300,width:100,height:120}]});
 assert.equal(selected.index,1);assert.equal(selected.candidates[0].satisfiedFeatureCount,0);
});
