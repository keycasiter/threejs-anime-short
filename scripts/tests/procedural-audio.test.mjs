import test from 'node:test';
import assert from 'node:assert/strict';
import {createProceduralAudio} from '../../assets/audio/procedural-audio.mjs';

class Param {
  constructor(value=0){this.value=value;this.calls=[];}
  cancelScheduledValues(time){this.calls.push(['cancel',time]);}
  setTargetAtTime(value,time,ramp){this.value=value;this.calls.push(['target',value,time,ramp]);}
  setValueAtTime(value,time){this.value=value;this.calls.push(['set',value,time]);}
  exponentialRampToValueAtTime(value,time){this.value=value;this.calls.push(['ramp',value,time]);}
}
class Node {
  constructor(){this.connections=[];this.disconnected=0;this.gain=new Param(1);this.frequency=new Param(0);
    this.positionX=new Param(0);this.positionY=new Param(0);this.positionZ=new Param(0);}
  connect(target){this.connections.push(target);return target;}
  disconnect(){this.disconnected++;}
  start(time){this.started=true;this.startTime=time;}
  stop(){this.stopped=true;}
}
class FakeAudioContext {
  static instances=[];
  constructor(){this.state='suspended';this.currentTime=2;this.sampleRate=100;this.destination=new Node();this.nodes=[];this.buffers=[];FakeAudioContext.instances.push(this);}
  node(){const value=new Node();this.nodes.push(value);return value;}
  createGain(){return this.node();}
  createBiquadFilter(){return this.node();}
  createOscillator(){return this.node();}
  createPanner(){return this.node();}
  createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));const buffer={duration:length/rate,getChannelData:i=>data[i]};this.buffers.push(buffer);return buffer;}
  createBufferSource(){return this.node();}
  async resume(){this.state='running';}
  async suspend(){this.state='suspended';}
  async close(){this.state='closed';}
}

test('creates no AudioContext before an explicit user action',async()=>{
  FakeAudioContext.instances=[];
  const sound=createProceduralAudio({AudioContextCtor:FakeAudioContext});
  assert.equal(FakeAudioContext.instances.length,0);
  assert.equal(sound.readState().contextState,'not-created');
  const state=await sound.start();
  assert.equal(FakeAudioContext.instances.length,1);
  assert.equal(state.contextState,'running');
  assert.equal(state.started,true);
  await sound.dispose();
});

test('spatial cue uses an envelope, HRTF panner and bounded node cleanup',async()=>{
  const sound=createProceduralAudio({AudioContextCtor:FakeAudioContext});
  const cue=await sound.trigger({frequency:392,duration:.3,gain:.1,position:[2,1,-3]});
  assert.deepEqual(cue.position,[2,1,-3]);
  const context=FakeAudioContext.instances.at(-1);
  const panner=context.nodes.find(node=>node.panningModel==='HRTF');
  assert.ok(panner);
  assert.deepEqual([panner.positionX.value,panner.positionY.value,panner.positionZ.value],[2,1,-3]);
  const envelope=context.nodes.find(node=>node.gain.calls.some(call=>call[0]==='ramp'));
  assert.ok(envelope);
  assert.equal(sound.readState().activeNodes,3);
  await sound.dispose();
  assert.equal(context.state,'closed');
  await assert.rejects(sound.start(),/disposed/);
});

test('noise cue is seeded, filtered, spatialized and scheduled on the audio clock',async()=>{
  const sound=createProceduralAudio({AudioContextCtor:FakeAudioContext});
  const cue=await sound.triggerNoise({duration:.2,seed:42,position:[1,0,-2],when:2.5});
  const context=FakeAudioContext.instances.at(-1),source=context.nodes.find(node=>node.buffer);
  assert.equal(cue.audioTime,2.5);assert.equal(cue.samples,20);assert.equal(source.startTime,2.5);
  const samples=Array.from(context.buffers[0].getChannelData(0));
  await sound.triggerNoise({duration:.2,seed:42,position:[1,0,-2],when:2.5});
  assert.deepEqual(Array.from(context.buffers[1].getChannelData(0)),samples,'same seed gives repeatable noise');
  assert.ok(context.nodes.some(node=>node.type==='lowpass'&&node.frequency.value===1400));
  assert.ok(context.nodes.some(node=>node.panningModel==='HRTF'));
  await assert.rejects(sound.trigger({when:1}),/past/);
  await sound.dispose();
});

test('mute, pause and resume update the actual audio graph/context',async()=>{
  const sound=createProceduralAudio({AudioContextCtor:FakeAudioContext});
  await sound.start();
  sound.setMuted(true);
  const context=FakeAudioContext.instances.at(-1);
  assert.equal(context.nodes[0].gain.value,0);
  sound.setMuted(false);
  assert.equal(context.nodes[0].gain.value,.7);
  await sound.pause();assert.equal(context.state,'suspended');
  await sound.resume();assert.equal(context.state,'running');
  await sound.dispose();
});

test('transient voices are bounded and released when playback ends',async()=>{
  const sound=createProceduralAudio({AudioContextCtor:FakeAudioContext,maxVoices:1});
  await sound.trigger({frequency:220});
  const context=FakeAudioContext.instances.at(-1),source=context.nodes.find(node=>node.frequency.value===220);
  assert.equal(sound.readState().activeVoices,1);
  await assert.rejects(sound.triggerNoise(),/voice limit/);
  source.onended();assert.equal(sound.readState().activeVoices,0);
  await sound.triggerNoise();assert.equal(sound.readState().activeVoices,1);
  await sound.dispose();
});

test('rejects invalid cue parameters and unavailable Web Audio',async()=>{
  const sound=createProceduralAudio({AudioContextCtor:FakeAudioContext});
  await assert.rejects(sound.trigger({position:[NaN,0,0]}),/Invalid cue settings/);
  await sound.dispose();
  const unavailable=createProceduralAudio({AudioContextCtor:null});
  await assert.rejects(unavailable.start(),/unavailable/);
});
