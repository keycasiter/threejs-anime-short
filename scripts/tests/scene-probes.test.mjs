import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const threeURL = process.env.THREE_MODULE ? pathToFileURL(resolve(process.env.THREE_MODULE)).href : 'three';
const T = await import(threeURL);
const {OrbitControls} = await import(process.env.THREE_MODULE
  ? new URL('../examples/jsm/controls/OrbitControls.js', threeURL).href : 'three/addons/controls/OrbitControls.js');
const probes = await import('../../assets/runtime/scene-probes.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('scene-probes.mjs')) return {};
  throw error;
});
function probe(name) {
  assert.equal(typeof probes[name], 'function', `${name} must provide the scene consumer probe`);
  return probes[name];
}
function fixture() {
  const root = new T.Group();
  const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  root.add(mesh);
  return {root, mesh};
}

test('parameter probe measures real consumer values in sequence and awaits baseline restoration', async () => {
  const run = probe('probeParameter');
  const {mesh} = fixture();
  const events = [];
  const result = await run({baseline: 1, candidate: 3,
    apply: async value => {await Promise.resolve(); mesh.scale.x = value; events.push(`apply:${value}`);},
    measure: async () => {await Promise.resolve(); events.push(`read:${mesh.scale.x}`); return [mesh.scale.x];}});
  assert.deepEqual(result, {before:[1], after:[3], changed:true});
  assert.deepEqual(events, ['apply:1', 'read:1', 'apply:3', 'read:3', 'apply:1']);
  assert.equal(mesh.scale.x, 1);
});

test('parameter probe detects disconnected metadata setters and snapshots reused measurement arrays', async () => {
  const run = probe('probeParameter');
  const {mesh} = fixture();
  const params = {scale:1};
  const sample = [0];
  const unchanged = await run({baseline:1, candidate:9, apply:value => {params.scale = value;},
    measure:() => [mesh.scale.x]});
  assert.equal(unchanged.changed, false);
  assert.equal(params.scale, 1);
  const changed = await run({baseline:1, candidate:2, apply:value => {mesh.scale.x = value;},
    measure:() => {sample[0] = mesh.scale.x; return sample;}});
  assert.deepEqual(changed, {before:[1], after:[2], changed:true});
});

test('parameter probe restores baseline after apply or measure failure, including asynchronous work', async () => {
  const run = probe('probeParameter');
  for (const failure of ['baseline', 'candidate', 'measure']) {
    const {mesh} = fixture();
    let first = true;
    await assert.rejects(run({baseline:1, candidate:2,
      apply:async value => {
        await Promise.resolve(); mesh.scale.x = value;
        if ((failure === 'baseline' && first) || (failure === 'candidate' && value === 2)) {
          first = false; throw new Error(failure);
        }
      },
      measure:() => {if (failure === 'measure') throw new Error('measure'); return [mesh.scale.x];}
    }), new RegExp(failure));
    assert.equal(mesh.scale.x, 1);
  }
});

test('parameter probe rejects nonnumeric, nonfinite and incompatible measurements and restores state', async () => {
  const run = probe('probeParameter');
  for (const invalid of [[], [NaN], [Infinity], ['1'], {value:1}, 1]) {
    let value;
    await assert.rejects(run({baseline:0, candidate:1, apply:v => {value=v;}, measure:() => invalid}), /finite|array|numeric/i);
    assert.equal(value, 0);
  }
  let value;
  await assert.rejects(run({baseline:0, candidate:1, apply:v => {value=v;}, measure:() => value ? [1,2] : [0]}), /length|dimension/i);
  assert.equal(value, 0);
  await assert.rejects(run({baseline:0, candidate:1, apply:() => {}, measure:() => [1], epsilon:-1}), /epsilon/);
});

test('parameter probe reports restore failures and preserves both failures when sampling also fails', async () => {
  const run = probe('probeParameter');
  let calls=0;
  await assert.rejects(run({baseline:1, candidate:2, apply:() => {if (++calls === 3) throw new Error('restore failed');},
    measure:() => [1]}), /restore failed/);
  calls=0;
  await assert.rejects(run({baseline:1, candidate:2, apply:() => {if (++calls === 2) throw new Error('restore failed');},
    measure:() => {throw new Error('sample failed');}}), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(item => item.message), ['sample failed', 'restore failed']);
    return true;
  });
});

test('rigid probe samples real world transforms and awaits explicit restoreTime', async () => {
  const run = probe('probeRigidMotion');
  const {root, mesh} = fixture();
  const times = [];
  const result = await run(T, {root, times:[0,1,2], restoreTime:0.5,
    update:async time => {await Promise.resolve(); times.push(time); mesh.position.x=time;}});
  assert.equal(result.observed, true);
  assert.equal(result.changed, true);
  assert.equal(result.observedMeshes, 1);
  assert.deepEqual(result.changedMeshes, [mesh.uuid]);
  assert.deepEqual(times, [0,1,2,0.5]);
  assert.equal(mesh.matrixWorld.elements[12], 0.5);
});

test('rigid probe refreshes nondefault ancestor world transforms above the requested root', async () => {
  const run = probe('probeRigidMotion');
  const {root, mesh} = fixture();
  const parent = new T.Group(); parent.position.x=10; parent.rotation.z=Math.PI/2; parent.scale.setScalar(2);
  parent.add(root); root.position.y=3;
  const result = await run(T, {root, times:[0,2], update:time => {parent.position.x=10+time;}});
  assert.equal(result.changed, true);
  assert.equal(mesh.matrixWorld.elements[12], 4);
  assert.equal(parent.matrixWorld.elements[12], 10);
});

test('rigid probe reports an observed legal hold as unchanged, ignoring elapsed clock metadata', async () => {
  const run = probe('probeRigidMotion');
  const {root} = fixture();
  let clock=0;
  const result = await run(T, {root, times:[2,3,5], update:time => {clock=time; root.userData.clock=time;}});
  assert.equal(result.observed, true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.changedMeshes, []);
  assert.equal(clock, 2);
});

test('rigid probe explicitly reports empty groups and hidden subtrees as unobserved', async () => {
  const run = probe('probeRigidMotion');
  const hidden = fixture(); const ancestor = new T.Group(); ancestor.visible=false; ancestor.add(hidden.root);
  const selfHidden = fixture(); selfHidden.mesh.visible=false;
  const materialHidden = fixture(); materialHidden.mesh.material.visible=false;
  const emptyMesh = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
  for (const root of [new T.Group(), hidden.root, selfHidden.root, materialHidden.root, emptyMesh]) {
    const result = await run(T, {root, times:[0,1], update:time => {root.position.x=time;}});
    assert.equal(result.observed, false);
    assert.equal(result.changed, false);
    assert.equal(result.observedMeshes, 0);
    assert.match(result.reason, /no visible ordinary mesh/i);
  }
});

test('rigid probe rejects visible nonrigid or instanced geometry instead of claiming action coverage', async () => {
  const run = probe('probeRigidMotion');
  const skinned = new T.SkinnedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  const morph = fixture(); morph.mesh.geometry.morphAttributes.position=[morph.mesh.geometry.attributes.position.clone()];
  const instanced = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial(), 1);
  for (const root of [skinned, morph.root, instanced]) {
    const updates=[];
    await assert.rejects(run(T, {root, times:[0,1], update:time => {updates.push(time);}}), /skinned|morph|instanc|ordinary/i);
    assert.equal(updates.at(-1), 0);
  }
});

test('rigid probe requires an actual drawable drawRange and visible material-group intersection',async()=>{
  const run=probe('probeRigidMotion');
  const pastEnd=fixture();pastEnd.mesh.geometry.setDrawRange(9999,3);
  const shortTail=fixture();shortTail.mesh.geometry.setDrawRange(shortTail.mesh.geometry.index.count-2,100);
  const noGroups=fixture();noGroups.mesh.material=[noGroups.mesh.material];noGroups.mesh.geometry.clearGroups();
  const hiddenGroup=fixture();hiddenGroup.mesh.material=[new T.MeshBasicMaterial({visible:false}),new T.MeshBasicMaterial()];hiddenGroup.mesh.geometry.clearGroups();hiddenGroup.mesh.geometry.addGroup(0,6,0);
  const missedGroup=fixture();missedGroup.mesh.material=[missedGroup.mesh.material];missedGroup.mesh.geometry.clearGroups();missedGroup.mesh.geometry.addGroup(0,3,0);missedGroup.mesh.geometry.setDrawRange(9,3);
  const negativeEmpty=fixture();negativeEmpty.mesh.geometry.setDrawRange(-3,3);
  for(const f of [pastEnd,shortTail,noGroups,hiddenGroup,missedGroup,negativeEmpty]){
    const r=await run(T,{root:f.root,times:[0,1],update:t=>{f.root.rotation.y=t;}});assert.equal(r.observed,false);assert.equal(r.changed,false);
  }
  const good=fixture();good.mesh.material=[good.mesh.material];good.mesh.geometry.clearGroups();good.mesh.geometry.addGroup(3,9,0);good.mesh.geometry.setDrawRange(6,6);
  const r=await run(T,{root:good.root,times:[0,1],update:t=>{good.root.rotation.y=t;}});assert.equal(r.observed,true);assert.equal(r.changed,true);
});

test('rigid probe restores state after asynchronous update failure and rejects invalid samples', async () => {
  const run = probe('probeRigidMotion');
  const {root,mesh} = fixture();
  await assert.rejects(run(T, {root, times:[0,1], update:async time => {
    await Promise.resolve(); mesh.position.x=time; if (time===1) throw new Error('update failed');
  }}), /update failed/);
  assert.equal(mesh.position.x, 0);
  assert.equal(mesh.matrixWorld.elements[12], 0);
  await assert.rejects(run(T, {root, times:[0,1], update:time => {mesh.position.x=time?NaN:0;}}), /finite/);
  assert.equal(mesh.position.x, 0);
  for (const times of [[], [0], [0,NaN], [0,-1]]) {
    await assert.rejects(run(T, {root, times, update:() => {}}), /times/);
  }
});

test('rigid probe honors numerical epsilon and repeated sample times', async () => {
  const run = probe('probeRigidMotion');
  const {root,mesh} = fixture();
  const result = await run(T, {root, times:[0,0,1], epsilon:0.01, update:time => {mesh.position.x=time*0.001;}});
  assert.equal(result.observed, true);
  assert.equal(result.changed, false);
});

test('orbit limits read the real controller defaults and custom ranges without invented multipliers', () => {
  const read = probe('readOrbitLimits');
  const controls = new OrbitControls(new T.PerspectiveCamera());
  assert.deepEqual(read(controls), {distance:{min:0,max:Infinity}, polarAngle:{min:0,max:Math.PI}});
  controls.minDistance=7; controls.maxDistance=9;
  controls.minPolarAngle=0.25; controls.maxPolarAngle=1.2;
  assert.deepEqual(read(controls), {distance:{min:7,max:9}, polarAngle:{min:0.25,max:1.2}});
});

test('orbit limits reject reversed, missing, NaN, negative and invalid angular boundaries', () => {
  const read = probe('readOrbitLimits');
  const defaults={minDistance:0,maxDistance:Infinity,minPolarAngle:0,maxPolarAngle:Math.PI};
  assert.throws(() => read(null), /controls|limits/i);
  assert.throws(() => read({}), /distance|limit/i);
  for (const patch of [{minDistance:-1}, {minDistance:NaN}, {minDistance:Infinity}, {maxDistance:-1},
    {minDistance:4,maxDistance:2}, {minPolarAngle:-0.1}, {maxPolarAngle:Math.PI+0.1},
    {minPolarAngle:1,maxPolarAngle:0.5}, {maxPolarAngle:Infinity}]) {
    assert.throws(() => read({...defaults,...patch}), /distance|polar|angle|limit/i);
  }
});

function fakeOrbitControls(initialAngle=0) {
  const listeners=new Set(),target=new T.Vector3(),object={position:new T.Vector3()};
  const controls={
    angle:initialAngle,polar:Math.PI/2,distance:5,object,target,
    addEventListener(type,listener){if(type==='change')listeners.add(listener);},
    removeEventListener(type,listener){if(type==='change')listeners.delete(listener);},
    getAzimuthalAngle(){return this.angle;},getPolarAngle(){return this.polar;},getDistance(){return this.distance;},
    setAngle(angle,{polar=this.polar,distance=this.distance}={}){
      this.angle=angle;this.polar=polar;this.distance=distance;
      object.position.set(distance*Math.sin(polar)*Math.sin(angle),distance*Math.cos(polar),distance*Math.sin(polar)*Math.cos(angle));
      for(const listener of listeners)listener({type:'change'});
    },listenerCount(){return listeners.size;}
  };
  controls.setAngle(initialAngle);
  return controls;
}

test('orbit coverage recorder unwraps the ±PI seam without inventing a full sweep',()=>{
  const record=probe('createOrbitCoverageRecorder'),controls=fakeOrbitControls(170*Math.PI/180);
  const recorder=record(controls);
  for(const angle of [179,-179,-170].map(value=>value*Math.PI/180))controls.setAngle(angle);
  const result=recorder.snapshot();
  assert.ok(Math.abs(result.signedTravelDegrees-20)<1e-8);
  assert.ok(Math.abs(result.angularSpanDegrees-20)<1e-8);
  assert.equal(result.angularSweepComplete,false);
  recorder.dispose();
});

test('orbit coverage recorder requires near-full angular span and every authored sector',()=>{
  const record=probe('createOrbitCoverageRecorder'),controls=fakeOrbitControls(0),recorder=record(controls);
  for(let degrees=45;degrees<=360;degrees+=45)controls.setAngle(degrees*Math.PI/180);
  const result=recorder.snapshot();
  assert.equal(result.angularSweepComplete,true);
  assert.equal(result.missingSectors.length,0);
  assert.ok(Math.abs(result.angularSpanDegrees-360)<1e-8);
  assert.equal(result.sectorSamples.length,8);
  assert.ok(result.sectorSamples.every(sample=>sample&&Array.isArray(sample.position)&&Array.isArray(sample.target)));
  recorder.dispose();
});

test('orbit coverage recorder reads actual Three.js r187 OrbitControls updates',()=>{
  const record=probe('createOrbitCoverageRecorder'),camera=new T.PerspectiveCamera();
  camera.position.set(0,0,5);
  const controls=new OrbitControls(camera);controls.update();
  const recorder=record(controls);
  for(let degrees=45;degrees<=360;degrees+=45){
    const angle=degrees*Math.PI/180;
    camera.position.set(Math.sin(angle)*5,0,Math.cos(angle)*5);
    controls.update();
  }
  assert.equal(recorder.snapshot().angularSweepComplete,true);
  recorder.dispose();
});

test('orbit coverage recorder supports custom controllers through readState and explicit sampling',()=>{
  const record=probe('createOrbitCoverageRecorder');
  let angle=0;
  const navigation={read(){return {azimuth:angle,polar:Math.PI/2,
    position:[5*Math.sin(angle),0,5*Math.cos(angle)],target:[0,0,0]};}};
  const recorder=record(navigation,{readState:source=>{
    const state=source.read();
    return {azimuth:state.azimuth,polar:state.polar,position:state.position,target:state.target};
  }});
  for(let degrees=45;degrees<=360;degrees+=45){angle=degrees*Math.PI/180;recorder.record();}
  const result=recorder.snapshot();
  assert.equal(result.angularSweepComplete,true);
  assert.equal(result.sectorSamples.length,8);
  assert.ok(result.sectorSamples.every(sample=>Math.abs(sample.distance-5)<1e-8));
  recorder.dispose();
  const count=recorder.snapshot().sampleCount;angle=Math.PI*1.5;recorder.record();
  assert.equal(recorder.snapshot().sampleCount,count);
});

test('orbit coverage recorder custom subscription and read contract clean up on dispose',()=>{
  const record=probe('createOrbitCoverageRecorder');
  let angle=0,listener=null,removed=false;
  const source={read(){return {azimuth:angle,polar:Math.PI/2,position:[Math.sin(angle),0,Math.cos(angle)],target:[0,0,0]};}};
  const recorder=record(source,{readState:value=>value.read(),subscribe:onSample=>{listener=onSample;return ()=>{removed=true;listener=null;};}});
  angle=Math.PI/4;listener();assert.equal(recorder.snapshot().sampleCount,2);
  recorder.dispose();assert.equal(removed,true);assert.equal(listener,null);
  assert.throws(()=>record(source,{readState:()=>({azimuth:0,polar:1,position:[0,0,0],target:[0,0,0]})}),/distance|sample/i);
  assert.throws(()=>record(source,{readState:value=>value.read(),subscribe:()=>undefined}),/unsubscribe/i);
});

test('orbit coverage recorder rejects a partial or reversing arc as full angular coverage',()=>{
  const record=probe('createOrbitCoverageRecorder'),controls=fakeOrbitControls(0),recorder=record(controls);
  for(const degrees of [45,90,135,180,135,90,45,0])controls.setAngle(degrees*Math.PI/180);
  const result=recorder.snapshot();
  assert.equal(result.angularSweepComplete,false);
  assert.equal(result.angularSpanDegrees,180);
  assert.ok(result.missingSectors.length>0);
  recorder.dispose();
});

test('orbit coverage recorder flags sparsely sampled large steps instead of trusting aliased angle data',()=>{
  const record=probe('createOrbitCoverageRecorder'),controls=fakeOrbitControls(0),recorder=record(controls,{maxSampleStepDegrees:90});
  for(const degrees of [100,200,300,360])controls.setAngle(degrees*Math.PI/180);
  const result=recorder.snapshot();
  assert.equal(result.largeStepObserved,true);
  assert.equal(result.angularSweepComplete,false);
  assert.ok(result.maxObservedStepDegrees>=90);
  recorder.dispose();
});

test('orbit coverage recorder does not pass a full azimuth sweep with changing polar angle or target',()=>{
  const record=probe('createOrbitCoverageRecorder'),controls=fakeOrbitControls(0),recorder=record(controls);
  for(let degrees=45;degrees<=360;degrees+=45)controls.setAngle(degrees*Math.PI/180);
  controls.setAngle(2*Math.PI,{polar:Math.PI/2+8*Math.PI/180});
  const tilted=recorder.snapshot();
  assert.ok(tilted.polarSpanDegrees>5);
  assert.equal(tilted.angularSweepComplete,false);
  recorder.reset();
  for(let degrees=45;degrees<=360;degrees+=45)controls.setAngle(degrees*Math.PI/180);
  controls.target.x=.01;controls.setAngle(2*Math.PI);
  const panned=recorder.snapshot();
  assert.equal(panned.targetStable,false);
  assert.equal(panned.angularSweepComplete,false);
  recorder.dispose();
});

test('orbit coverage recorder reset re-baselines to the current pose and dispose detaches its listener',()=>{
  const record=probe('createOrbitCoverageRecorder'),controls=fakeOrbitControls(0),recorder=record(controls);
  controls.setAngle(Math.PI/2);recorder.reset();controls.setAngle(Math.PI);
  assert.equal(recorder.snapshot().sampleCount,2);
  assert.ok(Math.abs(recorder.snapshot().signedTravelDegrees-90)<1e-8);
  assert.equal(controls.listenerCount(),1);recorder.dispose();recorder.dispose();
  assert.equal(controls.listenerCount(),0);
  controls.setAngle(3*Math.PI/2);assert.equal(recorder.snapshot().sampleCount,2);
});

test('orbit coverage recorder validates required OrbitControls readers and thresholds',()=>{
  const record=probe('createOrbitCoverageRecorder'),controls=fakeOrbitControls();
  assert.throws(()=>record(null),/OrbitControls/i);
  for(const options of [{sectorCount:3},{sectorCount:65},{minCoverageDegrees:0},{minCoverageDegrees:361},
    {maxSampleStepDegrees:180},{maxPolarDriftDegrees:181},{maxTargetDriftWorld:-1}])
    assert.throws(()=>record(controls,options),/sectorCount|minCoverage|maxSampleStep|maxPolar|maxTarget/i);
  controls.angle=NaN;assert.throws(()=>record(controls),/finite/i);
});
