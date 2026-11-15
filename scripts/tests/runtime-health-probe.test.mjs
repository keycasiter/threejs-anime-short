import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeHealthProbe} from '../../assets/runtime/runtime-health-probe.mjs';

class FakeTarget{
  listeners=new Map();
  addEventListener(type,fn,options){const list=this.listeners.get(type)??[];list.push({fn,options});this.listeners.set(type,list);}
  removeEventListener(type,fn,options){this.listeners.set(type,(this.listeners.get(type)??[]).filter(item=>item.fn!==fn||item.options!==options));}
  dispatch(type,event={}){for(const item of this.listeners.get(type)??[])item.fn(event);}
  count(type){return (this.listeners.get(type)??[]).length;}
}

test('runtime health is pending before a real render marker and records draw calls after it',()=>{
  const target=new FakeTarget(),canvas=new FakeTarget();let time=10;
  const probe=createRuntimeHealthProbe({target,canvas,now:()=>time++});
  assert.equal(target.__threeRuntimeProbe,probe);
  assert.equal(probe.snapshot().status,'pending');
  const snapshot=probe.markFrame({info:{render:{calls:7}}});
  assert.equal(snapshot.status,'clear');
  assert.equal(snapshot.frames,1);
  assert.equal(snapshot.drawCalls,7);
  assert.ok(snapshot.firstRenderAt>snapshot.startedAt);
  probe.dispose();
  assert.equal(target.__threeRuntimeProbe,undefined);
  assert.equal(target.count('error'),0);
});

test('runtime health records uncaught errors and promise rejections without swallowing them',()=>{
  const target=new FakeTarget(),probe=createRuntimeHealthProbe({target,canvas:new FakeTarget(),now:()=>1});
  target.dispatch('error',{message:'ReferenceError: missing is not defined',filename:'scene.mjs',lineno:17,colno:3});
  target.dispatch('unhandledrejection',{reason:new Error('async failure')});
  const snapshot=probe.snapshot();
  assert.equal(snapshot.status,'issue');
  assert.deepEqual(snapshot.errors.map(item=>item.kind),['error','unhandledrejection']);
  assert.match(snapshot.errors[0].message,/ReferenceError/);
  assert.equal(snapshot.errors[0].file,'scene.mjs');
  assert.match(snapshot.errors[1].message,/async failure/);
  probe.dispose();
});

test('runtime health records WebGL context loss and removes listeners when disposed',()=>{
  const target=new FakeTarget(),canvas=new FakeTarget();
  const probe=createRuntimeHealthProbe({target,canvas,now:()=>4});
  canvas.dispatch('webglcontextlost');
  assert.equal(probe.snapshot().contextLost,true);
  assert.equal(probe.snapshot().status,'issue');
  assert.equal(canvas.count('webglcontextlost'),1);
  probe.dispose();
  assert.equal(canvas.count('webglcontextlost'),0);
  assert.equal(target.count('error'),0);
  assert.equal(target.count('unhandledrejection'),0);
});

test('runtime health caps retained errors without reporting a clean status',()=>{
  const target=new FakeTarget(),probe=createRuntimeHealthProbe({target,canvas:new FakeTarget(),now:()=>0});
  for(let i=0;i<105;i++)target.dispatch('error',{message:`failure ${i}`});
  const snapshot=probe.snapshot();
  assert.equal(snapshot.errors.length,100);
  assert.equal(snapshot.droppedErrors,5);
  assert.equal(snapshot.status,'issue');
  probe.dispose();
});

test('runtime health validates its browser event target and clock',()=>{
  assert.throws(()=>createRuntimeHealthProbe({target:{}}),/event target/);
  assert.throws(()=>createRuntimeHealthProbe({target:new FakeTarget(),now:1}),/now/);
});
