import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../../assets/runtime/random-streams.mjs').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;
});
function create(seed) {
  assert.equal(typeof module.createRandomStreams,'function','createRandomStreams API is missing');
  return module.createRandomStreams(seed);
}
const draw=(fn,count=16)=>Array.from({length:count},()=>fn());

test('same uint32 seed, identity and purpose reproduce a fresh independent stream',()=>{
  for(const seed of [0,1,12345678,0xffffffff]) {
    const a=create(seed),b=create(seed),first=draw(a.stream('branch-7','layout'));
    assert.deepEqual(first,draw(b.stream('branch-7','layout')));
    assert.deepEqual(first,draw(a.stream('branch-7','layout')));
    assert.ok(first.every(x=>Number.isFinite(x)&&x>=0&&x<1));
    assert.ok(new Set(first).size>8);
  }
});

test('identity, purpose, Unicode and tuple boundaries select separate streams',()=>{
  const r=create(907), tuples=[['a','bc'],['ab','c'],['a:b','c'],['a','b:c'],['树枝','位置'],['🌿','位置'],['🌿','颜色']];
  const seeds=tuples.map(([id,purpose])=>r.deriveSeed(id,purpose));
  assert.equal(new Set(seeds).size,seeds.length);
  assert.ok(seeds.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff));
  assert.equal(new Set(tuples.map(([a,b])=>JSON.stringify(draw(r.stream(a,b))))).size,tuples.length);
});

test('changing texture iteration count cannot move the layout or another object',()=>{
  function scene(textureIterations,reverse) {
    const r=create(321),ids=reverse?['twig-2','twig-1']:['twig-1','twig-2'],result={};
    for(const id of ids) {
      const layout=r.stream(id,'layout'),texture=r.stream(id,'texture');
      result[id]=[];
      for(let k=0;k<5;k++) {draw(texture,textureIterations);result[id].push(layout());}
    }
    return result;
  }
  assert.deepEqual(scene(2,false),scene(501,true));
});

test('deriving seeds does not consume stream state and no shared Math.random cursor is used',()=>{
  const r=create(41),a=r.stream('leaf','layout'),b=r.stream('leaf','layout');
  assert.equal(a(),b());
  for(let k=0;k<50;k++) {r.deriveSeed('leaf','layout');draw(r.stream('other','texture'));Math.random();}
  assert.deepEqual(draw(a),draw(b));
});

test('seeds use the full uint32 range rather than truncating or accepting coercion',()=>{
  assert.notEqual(create(0).deriveSeed('x','layout'),create(0x80000000).deriveSeed('x','layout'));
  assert.notDeepEqual(draw(create(1).stream('x','layout')),draw(create(2).stream('x','layout')));
  for(const seed of [-1,0x100000000,.5,NaN,Infinity,'1',null,undefined,1n]) assert.throws(()=>create(seed),/seed|uint32|unsigned/i);
});

test('empty or non-string identities and purposes are rejected by both APIs',()=>{
  const r=create(1);
  for(const value of ['', '   ',null,undefined,42,{},[]]) for(const method of ['stream','deriveSeed']) {
    assert.throws(()=>r[method](value,'layout'),/id|identity|string|empty/i);
    assert.throws(()=>r[method]('branch',value),/purpose|string|empty/i);
  }
});
