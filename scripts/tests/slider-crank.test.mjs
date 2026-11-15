import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildSliderCrank} from '../../assets/examples/slider-crank.mjs';

const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const makeMaterials=()=>Object.fromEntries(['frame','wheel','steel','copper','glass','dark'].map((name,i)=>[
  name,new T.MeshStandardMaterial({color:['#273139','#46535b','#a9b5b5','#b5794a','#8eb8c4','#111719'][i],metalness:i===5?.12:.7,roughness:i===3?.3:.38,transparent:name==='glass',opacity:name==='glass'?.18:1,depthWrite:name!=='glass',side:name==='glass'?T.DoubleSide:T.FrontSide})
]));

test('slider crank uses one deterministic state source and preserves exact rod geometry',()=>{
  const assembly=buildSliderCrank(T,{materials:makeMaterials(),crankRadius:.035,rodLength:.145});
  const period=assembly.readState().period;
  assert.ok(assembly.parts.flywheel&&assembly.parts['crank-pin']&&assembly.parts.piston&&assembly.parts.rod&&assembly.parts['cylinder-window']);
  const zero=assembly.stateAt(0),half=assembly.stateAt(period/2),quarter=assembly.stateAt(period/4),repeat=assembly.stateAt(period);
  assert.ok(Math.abs(zero.pistonX-(.145+.035))<1e-12);
  assert.ok(Math.abs(half.pistonX-(.145-.035))<1e-12);
  assert.ok(Math.abs(quarter.pistonX-Math.sqrt(.145**2-.035**2))<1e-12);
  assert.ok(Math.abs(repeat.pistonX-zero.pistonX)<1e-12);
  assert.throws(()=>assembly.stateAt(-1),RangeError);
  assert.throws(()=>assembly.stateAt(NaN),RangeError);
  assembly.applyState(period*.371);assembly.root.updateMatrixWorld(true);
  const pin=assembly.parts['crank-pin'].getWorldPosition(new T.Vector3());
  const piston=assembly.parts.piston.getWorldPosition(new T.Vector3());
  assert.ok(Math.abs(pin.distanceTo(piston)-.145)<1e-6,`rod length ${pin.distanceTo(piston)}`);
  const applied=assembly.readState();assert.equal(applied.time,period*.371);assert.ok(Number.isFinite(applied.velocity));
  let disposed=0;assembly.root.traverse(o=>o.geometry?.addEventListener('dispose',()=>disposed++));
  assembly.dispose();assembly.dispose();assert.ok(disposed>0);
  assert.throws(()=>assembly.applyState(0),/disposed/);
});
