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

test('required features can declare a minimum projected pixel size for readable views',()=>{
 const selected=choose({
  candidates:[{position:[0,0,5],target:[0,0,0]},{position:[0,0,15],target:[0,0,0]}],
  points:[[0,0,0]],
  requiredFeatures:[{id:'middle-scale-joint',points:[[-1,0,0],[0,0,0],[1,0,0]],
   minVisibleFraction:1,minProjectedBoundsPx:{width:300,height:0}}]
 });
 assert.equal(selected.index,0);
 assert.equal(selected.candidates[0].features[0].projectedSizeSatisfied,true);
 assert.equal(selected.candidates[1].features[0].projectedSizeSatisfied,false);
 assert.ok(selected.candidates[0].features[0].projectedBoundsPx.width>=300);
 assert.ok(selected.candidates[1].features[0].projectedBoundsPx.width<300);
});

test('projected-size requirements validate their contract and remain opt-in',()=>{
 for(const minProjectedBoundsPx of [{width:-1,height:1},{width:1,height:Infinity},{width:0,height:0},{}])
  assert.throws(()=>choose({requiredFeatures:[{id:'joint',points:[[0,0,0]],minProjectedBoundsPx}]}));
 const legacy=choose({requiredFeatures:[{id:'joint',points:[[0,0,0]],minVisibleFraction:1}]});
 assert.equal(legacy.candidates[0].features[0].projectedSizeSatisfied,true);
 assert.equal(legacy.candidates[0].features[0].projectedBoundsPx.width,0);
});

test('an authored view set unions complementary feature coverage without treating views as samples',()=>{
 assert.equal(typeof api.auditObservationSet,'function');
 const wall=new T.Mesh(new T.BoxGeometry(.1,8,8),new T.MeshBasicMaterial());
 const result=api.auditObservationSet(T,{
  views:[{id:'east',position:[5,0,0],target:[0,0,0]},{id:'west',position:[-5,0,0],target:[0,0,0]}],
  features:[{id:'opposing-faces',points:[[2,0,0],[-2,0,0]],minCoverageFraction:1}],
  occluders:[wall],viewport:{width:800,height:600}
 });
 assert.equal(result.features[0].coverageFraction,1);
 assert.deepEqual(result.features[0].coveredSampleIndices,[0,1]);
 assert.deepEqual(result.viewResults.map(v=>v.features[0].visibleSampleIndices),[[0],[1]]);
 assert.equal(result.features[0].satisfied,true);
 wall.geometry.dispose();wall.material.dispose();
});

test('a feature hidden by overlays or below its declared pixel bounds remains uncovered',()=>{
 const result=api.auditObservationSet(T,{
  views:[
   {id:'covered-by-hud',position:[0,0,5],target:[0,0,0]},
   {id:'too-distant',position:[0,0,30],target:[0,0,0]}
  ],
  features:[{id:'small-interface',points:[[-1,0,0],[1,0,0]],minCoverageFraction:1,
   minProjectedBoundsPx:{width:300,height:0}}],
  viewport:{width:800,height:600},
  overlays:[{id:'panel',left:0,top:0,width:800,height:600}]
 });
 assert.equal(result.features[0].coverageFraction,0);
 assert.deepEqual(result.features[0].uncoveredSampleIndices,[0,1]);
 assert.equal(result.viewResults[0].features[0].overlaySampleCount,2);
 assert.equal(result.viewResults[1].features[0].projectedSizeSatisfied,false);
 assert.equal(result.features[0].satisfied,false);
});

test('view-set audit rejects duplicate identities and impossible coverage thresholds',()=>{
 assert.equal(typeof api.auditObservationSet,'function');
 const base={views:[{id:'front',position:[0,0,5],target:[0,0,0]}],
  features:[{id:'body',points:[[0,0,0]]}],viewport:{width:800,height:600}};
 for(const patch of [
  {views:[...base.views,...base.views]},
  {features:[...base.features,...base.features]},
  {features:[{id:'body',points:[[0,0,0]],minCoverageFraction:0}]},
  {features:[{id:'body',points:[[0,0,0]],minProjectedBoundsPx:{width:0,height:0}}]}
 ])assert.throws(()=>api.auditObservationSet(T,{...base,...patch}));
});
