import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createMaterialShaderBridge as bridge } from '../../assets/materials/material-shader-bridge.mjs';

const T = process.env.THREE_MODULE ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href) : await import('three');
// WebGLPrograms.shaderIDs maps both Standard and Physical to ShaderLib.physical in r180.
const source = (type = 'MeshStandardMaterial') => {
  const id = {MeshStandardMaterial: 'physical', MeshPhysicalMaterial: 'physical', MeshToonMaterial: 'toon'}[type];
  const lib = T.ShaderLib[id];
  return { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: T.UniformsUtils.clone(lib.uniforms) };
};
const color = '#include <color_fragment>';
const decl = '#include <common>';
const tint = {stage: 'fragment', anchor: color, after: 'diffuseColor.rgb *= uTint;'};
const options = (extra = {}) => ({
  baseMaterial: new T.MeshStandardMaterial(), programKey: 'tint.v1', uniforms: {uTint: {value: .5}},
  patches: [{stage: 'fragment', anchor: decl, after: 'uniform float uTint;'}, tint], ...extra
});

for (const [id, C] of [['standard', T.MeshStandardMaterial], ['physical', T.MeshPhysicalMaterial], ['toon', T.MeshToonMaterial]]) {
  test(id + ': real material copy, borrowed map, actual shader and alpha/output chain', () => {
    const map = new T.Texture();
    const base = new C({map, opacity: .6, transparent: true});
    const builtin = T.Material.prototype.onBeforeCompile;
    const originalDefines = {...base.defines};
    base.defines.BASE = 2;
    const b = bridge(T, options({baseMaterial: base, defines: {VARIANT: 3}}));
    assert.notEqual(b.material, base);
    assert.equal(b.material.constructor, C);
    assert.deepEqual(b.material.defines, {...originalDefines, BASE: 2, VARIANT: 3});
    assert.deepEqual(base.defines, {...originalDefines, BASE: 2});
    assert.equal(b.material.map, map);
    assert.equal(b.material.opacity, .6);
    assert.equal(b.material.transparent, true);
    const s = source(base.type), original = s.fragmentShader, oldVertex = s.vertexShader;
    b.material.onBeforeCompile(s, {});
    assert.equal(s.fragmentShader, original.replace(decl, decl + '\nuniform float uTint;').replace(color, color + '\n' + tint.after));
    assert.equal(s.vertexShader, oldVertex);
    assert.equal(T.Material.prototype.onBeforeCompile, builtin);
    let baseReleased = 0, mapReleased = 0, cloneReleased = 0;
    base.addEventListener('dispose', () => baseReleased++);
    map.addEventListener('dispose', () => mapReleased++);
    b.material.addEventListener('dispose', () => cloneReleased++);
    b.dispose(); b.dispose();
    assert.deepEqual([cloneReleased, baseReleased, mapReleased], [1, 0, 0]);
    assert.equal(b.inspect().disposed, true);
  });
}

test('uniform wrappers survive first use / recompile; value and input edits do not alter structural identity', () => {
  const o = options(), initialWrapper = o.uniforms.uTint;
  const b = bridge(T, o), key = b.material.customProgramCacheKey(), version = b.material.version;
  initialWrapper.value = .2;
  o.patches[1] = {...tint, after: 'bad input edit'};
  o.uniforms.uTint = {value: 91};
  for (const value of [.2, .8]) {
    const s = source();
    b.uniforms.uTint.value = value;
    b.material.onBeforeCompile(s, {});
    assert.equal(s.uniforms.uTint, initialWrapper);
    assert.equal(s.uniforms.uTint.value, value);
    assert.ok(s.fragmentShader.includes(tint.after));
    assert.equal(b.material.customProgramCacheKey(), key);
    assert.equal(b.material.version, version);
  }
  b.dispose();
});

test('cache differentiates actual GLSL, patch order, define values, names and explicit identity; record order is canonical', () => {
  const key = extra => { const b = bridge(T, options(extra)); try {return b.material.customProgramCacheKey();} finally {b.dispose();} };
  const k = key({}), p = options().patches;
  for (const change of [{patches: [p[0], {...tint, after: 'diffuseColor.rgb += uTint;'}]}, {patches: [...p].reverse()}, {defines: {MODE: 1}}, {uniforms: {uOther: {value: 1}}}, {programKey: 'other'}, {upstreamProgramKey: 'up.v1'}]) assert.notEqual(key(change), k);
  assert.notEqual(key({defines: {MODE: 1}}), key({defines: {MODE: 2}}));
  assert.equal(key({defines: {A: 1, B: 2}, uniforms: {uX: {value: 0}, uY: {value: 1}}}),
    key({defines: {B: 2, A: 1}, uniforms: {uY: {value: 3}, uX: {value: 4}}}));
});

test('composition runs upstream first with the clone and renderer; calls the actual upstream cache hook', () => {
  const base = new T.MeshStandardMaterial(), calls = [], upstreamAnchor = '// upstream-tint';
  base.userData.mode = 'A';
  base.onBeforeCompile = function (s, r) {
    calls.push([this, r]); s.fragmentShader = s.fragmentShader.replace(color, color + '\n' + upstreamAnchor);
  };
  base.customProgramCacheKey = function () {return this.userData.mode;};
  const b = bridge(T, options({baseMaterial: base, upstreamProgramKey: 'up.v2', patches: [
    {stage: 'fragment', anchor: upstreamAnchor, before: '// before', after: '// after'},
    {stage: 'vertex', anchor: decl, replace: decl + '\n// vertex'}]}));
  const renderer = {}, s = source(), a = b.material.customProgramCacheKey();
  b.material.userData.mode = 'B';
  assert.notEqual(b.material.customProgramCacheKey(), a);
  b.material.onBeforeCompile(s, renderer);
  assert.deepEqual(calls, [[b.material, renderer]]);
  assert.ok(s.fragmentShader.includes('// before\n// upstream-tint\n// after'));
  assert.ok(s.vertexShader.includes(decl + '\n// vertex'));
  b.dispose();
});

test('unsupported materials, invalid descriptors and ambiguous upstream hooks are refused before allocating a clone', () => {
  class Child extends T.MeshStandardMaterial {}
  for (const [T0, base, extra, error] of [
    [{...T, REVISION: '181'}, new T.MeshStandardMaterial(), {}, /180/],
    [T, new T.MeshBasicMaterial(), {}, /material/i], [T, new Child(), {}, /material/i],
    [T, new T.MeshStandardMaterial(), {programKey: ' '}, /programKey/],
    [T, new T.MeshStandardMaterial(), {patches: [{...tint, replace: 'x'}]}, /fragment.*color_fragment/],
    [T, new T.MeshStandardMaterial(), {uniforms: {uX: {}}}, /uX/],
    [T, new T.MeshStandardMaterial(), {patches: Array(10000).fill(tint)}, /patch/i],
    [T, new T.MeshStandardMaterial(), {patches: [{...tint, after: 'x'.repeat(300000)}]}, /fragment.*color_fragment/],
    [T, Object.assign(new T.MeshToonMaterial(), {onBeforeCompile() {}}), {}, /upstreamProgramKey/],
    [T, Object.assign(new T.MeshPhysicalMaterial(), {customProgramCacheKey() {return '1';}}), {}, /upstreamProgramKey/]
  ]) {
    let clones = 0;
    base.clone = () => {clones++; throw Error('unexpected clone');};
    assert.throws(() => bridge(T0, options({baseMaterial: base, ...extra})), error);
    assert.equal(clones, 0);
  }
});

test('missing, repeated and overlapping anchors are diagnosed on original post-hook sources; no partial bridge writes', () => {
  const v = {stage: 'vertex', anchor: decl, after: '// staged vertex'};
  for (const [tail, prepare, error] of [
    [[{...tint, anchor: 'NO_SUCH_ANCHOR'}], () => {}, /fragment.*NO_SUCH_ANCHOR/],
    [[tint], s => {s.fragmentShader += '\n' + color;}, /fragment.*color_fragment/],
    [[tint, {...tint, anchor: 'color_fragment>'}], () => {}, /fragment.*color_fragment/],
    [[tint, {...tint, after: '// duplicate descriptor'}], () => {}, /fragment.*color_fragment/],
    [[{...tint, after: 'fresh-anchor'}, {...tint, anchor: 'fresh-anchor'}], () => {}, /fragment.*fresh-anchor/],
    [[{...tint, anchor: 'aaa'}], s => {s.fragmentShader += 'aaaa';}, /fragment.*aaa/]
  ]) {
    const b = bridge(T, options({patches: [v, ...tail]})), s = source();
    prepare(s);
    const old = {...s}, names = Object.keys(s.uniforms);
    assert.throws(() => b.material.onBeforeCompile(s, {}), error);
    assert.deepEqual([s.vertexShader, s.fragmentShader, Object.keys(s.uniforms)], [old.vertexShader, old.fragmentShader, names]);
    b.dispose();
  }
});

test('uniform collision after upstream and renderer-owned clippingPlanes are refused without overwriting any wrapper or shader', () => {
  for (const name of ['diffuse', 'clippingPlanes', 'upTint']) {
    const base = new T.MeshStandardMaterial(), upstream = {value: 2}, s = source(), original = s.fragmentShader;
    base.onBeforeCompile = p => { p.uniforms.upTint = upstream; };
    const b = bridge(T, options({baseMaterial: base, upstreamProgramKey: 'up.v1', uniforms: {uNew: {value: 3}, [name]: {value: 9}}}));
    const diffuse = s.uniforms.diffuse;
    assert.throws(() => b.material.onBeforeCompile(s, {}), new RegExp(name));
    assert.equal(s.fragmentShader, original);
    assert.equal(s.uniforms.diffuse, diffuse);
    assert.equal(s.uniforms.upTint, upstream);
    assert.equal(Object.hasOwn(s.uniforms, 'uNew'), false);
    b.dispose();
  }
});

test('allocation failure releases only the owned partial copy; upstream may return an empty cache component', () => {
  const o = options(), texture = new T.Texture(); o.baseMaterial.map = texture;
  let allocations = 0, disposals = 0, borrowedDisposals = 0;
  o.baseMaterial.addEventListener('dispose', () => borrowedDisposals++);
  texture.addEventListener('dispose', () => borrowedDisposals++);
  const tracked = {...T, MeshStandardMaterial: new Proxy(T.MeshStandardMaterial, {
    construct(constructor, args) {
      allocations++;
      const material = Reflect.construct(constructor, args);
      material.addEventListener('dispose', () => disposals++);
      return material;
    }
  })};
  assert.throws(() => bridge(tracked, {...o, patches: [{stage: 'vertex', anchor: 'tag'}]}), /vertex.*tag/);
  assert.equal(allocations, 0);
  o.baseMaterial.userData.self = o.baseMaterial.userData;
  assert.throws(() => bridge(tracked, o), /circular/i);
  assert.deepEqual([allocations, disposals, borrowedDisposals], [1, 1, 0]);
  delete o.baseMaterial.userData.self;
  o.baseMaterial.customProgramCacheKey = () => '';
  const b = bridge(tracked, {...o, upstreamProgramKey: 'empty.v1'});
  try { assert.equal(typeof b.material.customProgramCacheKey(), 'string'); }
  finally { b.dispose(); }
  assert.deepEqual([allocations, disposals, borrowedDisposals], [2, 2, 0]);
});

test('a custom upstream hook can capture the uniforms table; frozen source fields fail atomically', () => {
  let captured;
  const base = new T.MeshStandardMaterial();
  base.onBeforeCompile = s => {captured = s.uniforms;};
  const b = bridge(T, options({baseMaterial: base, upstreamProgramKey: 'capture.v1'})), s = source();
  b.material.onBeforeCompile(s, {});
  assert.equal(captured, s.uniforms);
  assert.equal(captured.uTint, b.uniforms.uTint);
  const other = source(), oldVertex = other.vertexShader;
  Object.defineProperty(other, 'fragmentShader', {writable: false});
  assert.throws(() => b.material.onBeforeCompile(other, {}), /fragmentShader/);
  assert.equal(other.vertexShader, oldVertex);
  assert.equal(Object.hasOwn(other.uniforms, 'uTint'), false);
  b.dispose();
});

test('patches use the bounded array indices, ignoring values supplied by a custom iterator', () => {
  let iteratorCalls = 0;
  const patches = [];
  patches[Symbol.iterator] = function* () { iteratorCalls++; for (let i = 0; i < 65; i++) yield tint; };
  const b = bridge(T, options({patches}));
  try {
    assert.equal(b.inspect().patchCount, 0);
    assert.equal(iteratorCalls, 0);
  } finally {b.dispose();}
});

test('one read per descriptor field: the validated source is the compiled source', () => {
  const reads = {stage: 0, anchor: 0, after: 0};
  const patch = {
    get stage() {reads.stage++; return 'fragment';},
    get anchor() {reads.anchor++; return color;},
    get after() {return ++reads.after <= 3 ? '// first read' : 'x'.repeat(16385);}
  };
  const b = bridge(T, options({patches: [patch]}));
  try {
    const s = source(); b.material.onBeforeCompile(s, {});
    assert.deepEqual(reads, {stage: 1, anchor: 1, after: 1});
    assert.ok(s.fragmentShader.includes(color + '\n// first read'));
  } finally {b.dispose();}
});

test('Standard uses the physical ShaderLib uniforms and preserves clearcoat on collision', () => {
  const s = source(), existing = s.uniforms.clearcoat;
  assert.ok(existing && !Object.hasOwn(T.ShaderLib.standard.uniforms, 'clearcoat'));
  const b = bridge(T, options({uniforms: {clearcoat: {value: 7}, uTail: {value: 1}}}));
  const initial = {...s};
  try {
    assert.throws(() => b.material.onBeforeCompile(s, {}), /collision: clearcoat/);
    assert.equal(s.uniforms.clearcoat, existing);
    assert.equal(s.fragmentShader, initial.fragmentShader);
    assert.equal(Object.hasOwn(s.uniforms, 'uTail'), false);
  } finally {b.dispose();}
});

test('direct renderer uniforms absent from ShaderLib still reject the whole batch', () => {
  for (const name of ['toneMappingExposure', 'projectionMatrix', 'viewMatrix', 'cameraPosition', 'normalMatrix',
    'receiveShadow', 'boneTexture', 'morphTargetsTextureSize', 'batchingIdTexture', '_gl_DrawID']) {
    const s = source(), before = s.fragmentShader;
    assert.equal(Object.hasOwn(s.uniforms, name), false);
    const b = bridge(T, options({uniforms: {uCandidate: {value: 3}, [name]: {value: 0}}}));
    try {
      assert.throws(() => b.material.onBeforeCompile(s, {}), new RegExp('collision: ' + name));
      assert.equal(s.fragmentShader, before);
      assert.equal(Object.hasOwn(s.uniforms, name) || Object.hasOwn(s.uniforms, 'uCandidate'), false);
    } finally {b.dispose();}
  }
});
