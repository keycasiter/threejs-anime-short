import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {estimateSamplingStep} from '../../assets/geometry/projected-sampling.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function perspective(){const c=new T.PerspectiveCamera(60,1,.1,100);c.position.z=10;c.lookAt(0,0,0);c.updateMatrixWorld(true);return c;}
const base=camera=>({camera,worldPoint:[0,0,0],viewportHeight:1000,maxErrorPx:.75,curvatureBound:.1});
test('sampling uses actual projected depth, zoom and world units',()=>{
 const camera=perspective(),a=estimateSamplingStep(T,base(camera));
 near(a.worldUnitsPerPixel,20*Math.tan(Math.PI/6)/1000);
 camera.position.z=5;const b=estimateSamplingStep(T,base(camera));
 near(b.curvatureStep/a.curvatureStep,Math.sqrt(.5));
 camera.zoom=2;camera.updateProjectionMatrix();const c=estimateSamplingStep(T,base(camera));near(c.worldUnitsPerPixel,b.worldUnitsPerPixel/2);
});
test('feature bandwidth and explicit maxStep independently limit geometry spacing',()=>{
 const camera=perspective();
 const a=estimateSamplingStep(T,{...base(camera),minFeatureSize:.8,samplesPerFeature:8});near(a.step,.1);
 const b=estimateSamplingStep(T,{...base(camera),maxStep:.04});near(b.step,.04);
 const c=estimateSamplingStep(T,{...base(camera),curvatureBound:0,maxStep:2});near(c.step,2);near(c.estimatedChordErrorPx,0);
});
test('orthographic sampling is distance independent and respects its projection zoom',()=>{
 const camera=new T.OrthographicCamera(-5,5,5,-5,.1,100);camera.position.z=10;
 const a=estimateSamplingStep(T,base(camera));near(a.worldUnitsPerPixel,.01);
 camera.position.z=20;const b=estimateSamplingStep(T,base(camera));near(a.step,b.step);
 camera.zoom=2;camera.updateProjectionMatrix();near(estimateSamplingStep(T,base(camera)).worldUnitsPerPixel,.005);
});
test('a high curvature estimate also limits turning rather than trusting chord approximation alone',()=>{
 const r=estimateSamplingStep(T,{...base(perspective()),curvatureBound:20,maxNormalTurn:.15});
 assert.ok(r.step<=.15/20);assert.ok(r.estimatedChordErrorPx<=.75);
});
test('actual frontward view depth works under camera rotation and does not change pose or projection',()=>{
 const camera=perspective();camera.position.set(10,0,0);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
 const p=camera.position.toArray(),q=camera.quaternion.toArray(),projection=camera.projectionMatrix.toArray();
 const r=estimateSamplingStep(T,{...base(camera),worldPoint:new T.Vector3()});near(r.depth,10);
 assert.deepEqual(camera.position.toArray(),p);assert.deepEqual(camera.quaternion.toArray(),q);assert.deepEqual(camera.projectionMatrix.toArray(),projection);
});
test('sampling rejects unobservable points, missing constraints and invalid units',()=>{
 const camera=perspective(),opts=base(camera);
 for(const patch of [{worldPoint:[0,0,11]},{worldPoint:[0,0,9.99]},{worldPoint:[0,0,NaN]},{viewportHeight:0},{maxErrorPx:0},{curvatureBound:-1},{minFeatureSize:0},{samplesPerFeature:2},{maxStep:Infinity},{maxNormalTurn:0}])assert.throws(()=>estimateSamplingStep(T,{...opts,...patch}));
 assert.throws(()=>estimateSamplingStep(T,{camera,worldPoint:[0,0,0],viewportHeight:1000}));
 camera.scale.x=2;assert.throws(()=>estimateSamplingStep(T,opts),/rigid/);
});
