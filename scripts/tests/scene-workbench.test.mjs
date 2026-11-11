import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSceneClock,createSceneWorkbench} from '../../assets/runtime/scene-workbench.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');

test('absolute freeze, seek and resumed clock ignore wall-clock gaps',()=>{
  const clock=createSceneClock();assert.equal(clock.tick(100).time,0);assert.equal(clock.tick(103).time,3);
  clock.freeze(7);assert.deepEqual(clock.tick(999),{time:7,dt:0,paused:true});
  clock.freeze(2);assert.equal(clock.readState().time,2);
  clock.resume();assert.equal(clock.tick(5000).time,2);assert.equal(clock.tick(5001).time,3);
  assert.throws(()=>clock.tick(NaN));assert.throws(()=>clock.freeze(-1));
});

test('workbench effects call real consumer and snapshots restore camera and frozen time',()=>{
  const camera=new T.PerspectiveCamera(40,1,.1,100);camera.position.set(4,5,6);camera.lookAt(0,1,0);
  let actual=false,updates=[];const clock=createSceneClock();
  const bench=createSceneWorkbench(T,{camera,clock,effects:{rain:{get:()=>actual,set:v=>{actual=v;}}},onTime:t=>updates.push(t)});
  bench.setTime(12);bench.setEffect('rain',true);const shot=bench.snapshot();
  camera.position.set(10,20,30);bench.setTime(99);bench.setEffect('rain',false);
  bench.restore(shot);assert.deepEqual(camera.position.toArray(),[4,5,6]);assert.equal(actual,true);
  assert.equal(clock.readState().time,12);assert.equal(clock.readState().paused,true);assert.equal(updates.at(-1),12);
  assert.deepEqual(bench.snapshot().camera.quaternion,shot.camera.quaternion);
  assert.throws(()=>bench.setEffect('missing',true));assert.throws(()=>bench.setEffect('rain',1));
  const corrupt=structuredClone(shot);corrupt.camera.position[0]=NaN;assert.throws(()=>bench.restore(corrupt));
  assert.deepEqual(camera.position.toArray(),[4,5,6]);bench.dispose();bench.dispose();assert.throws(()=>bench.setTime(3));
});

test('disconnected consumer fails readback rather than recording requested metadata',()=>{
  const camera=new T.PerspectiveCamera();const bench=createSceneWorkbench(T,{camera,effects:{ao:{get:()=>false,set:()=>{}}}});
  assert.throws(()=>bench.setEffect('ao',true),/readback/);assert.equal(bench.snapshot().effects.ao,false);bench.dispose();
});
