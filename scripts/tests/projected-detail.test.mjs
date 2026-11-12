import test from 'node:test';
import assert from 'node:assert/strict';
let api={};try{api=await import('../../assets/runtime/projected-detail.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
function choose(options={}){assert.equal(typeof api.selectProjectedDetail,'function');return api.selectProjectedDetail({diameter:2,viewDepth:11,viewportHeight:1000,fovDegrees:90,...options});}
test('detail follows perspective projection with a conservative front-depth size',()=>{
  const a=choose();assert.ok(Math.abs(a.pixels-100)<1e-9);assert.equal(a.level,1);
  assert.equal(choose({viewDepth:3}).level,0);assert.equal(choose({viewDepth:40}).level,2);
  assert.equal(choose({viewDepth:.8}).level,0);assert.equal(choose({viewDepth:.8}).pixels,Infinity);
});
test('detail hysteresis resists oscillation and permits crossing multiple levels',()=>{
  assert.equal(choose({viewDepth:7,previousLevel:1}).level,1);
  assert.equal(choose({viewDepth:6,previousLevel:1}).level,0);
  assert.equal(choose({viewDepth:9,previousLevel:0}).level,1);
  assert.equal(choose({viewDepth:21,previousLevel:1}).level,1);
  assert.equal(choose({viewDepth:20,previousLevel:2}).level,2);
  assert.equal(choose({viewDepth:15,previousLevel:2}).level,1);
  assert.equal(choose({viewDepth:50,previousLevel:0}).level,2);
});
test('invalid projection and threshold inputs fail before producing a level',()=>{
  for(const patch of [{diameter:0},{viewDepth:NaN},{viewportHeight:0},{fovDegrees:180},{thresholds:[50,160]},
    {thresholds:[]},{hysteresis:1},{previousLevel:4}])assert.throws(()=>choose(patch));
});
