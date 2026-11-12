import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const THREE = process.env.THREE_MODULE ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href) : await import('three');
import { createProceduralPalette } from '../../assets/materials/procedural-palette.mjs';
const recipes = ['wood', 'stone', 'coated-metal'];
const pixel = (map, i, j) => Array.from(map.image.data.slice((j * map.image.width + i) * 4, (j * map.image.width + i + 1) * 4));
const normals = (material) => material.normalMap.image.data;
const near = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('exports a callable palette factory', () => assert.equal(typeof createProceduralPalette, 'function'));

test('cache shares materials and textures by complete normalized parameters', () => {
  const palette = createProceduralPalette(THREE, {resolution: 64, seed: 42});
  const a = palette.get('wood');
  assert.equal(a, palette.get('wood', {variant: 0, wetness: 0, tileSizeMeters: [.6, 1.2]}));
  assert.equal(a.map, palette.get('wood').map);
  for (const options of [{variant: 1}, {wetness: .5}, {tileSizeMeters: [1, 2]}]) assert.notEqual(a, palette.get('wood', options));
  assert.equal(palette.inspect().entries.length, 4);
  assert.deepEqual(a.userData.proceduralPalette.tileSizeMeters, [.6, 1.2]);
  assert.equal(a.roughness, 1);assert.equal(a.metalness, 1);
  palette.dispose();
});

test('baked channels match shared sampled fields, encode color sRGB, and scalar maps stay raw', () => {
  const palette = createProceduralPalette(THREE, {resolution: 64, seed: 9});
  for (const recipe of recipes) {
    const material = palette.get(recipe, {wetness: .4});
    for (const [i, j] of [[0, 0], [13, 19], [63, 63]]) {
      const sample = palette.sample(recipe, {u: (i + .5) / 64, v: (j + .5) / 64, wetness: .4});
      const c = sample.color.clone().convertLinearToSRGB();
      assert.deepEqual(pixel(material.map, i, j), [...c.toArray().map(n => Math.round(n * 255)), 255]);
      assert.deepEqual(pixel(material.roughnessMap, i, j), [0, Math.round(sample.roughness * 255), 0, 255]);
      assert.deepEqual(pixel(material.metalnessMap, i, j), [0, 0, Math.round(sample.metalness * 255), 255]);
    }
    assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
    for (const map of [material.roughnessMap, material.metalnessMap, material.normalMap]) assert.equal(map.colorSpace, THREE.NoColorSpace);
    for (const map of [material.map, material.roughnessMap, material.metalnessMap, material.normalMap]) {
      assert.equal(map.wrapS, THREE.RepeatWrapping);assert.equal(map.wrapT, THREE.RepeatWrapping);assert.equal(map.flipY, false);
    }
  }
  palette.dispose();
});

test('wetness darkens and smooths the SAME regions and reduces relief and normal slopes at production resolution', () => {
  const palette = createProceduralPalette(THREE, {resolution: 256});
  for (const recipe of recipes) {
    for (const [u, v] of [[.12, .34], [.79, .63], [.44, .11]]) {
      const dry = palette.sample(recipe, {u, v}), wet = palette.sample(recipe, {u, v, wetness: 1});
      for (let axis = 0; axis < 3; axis++) assert.ok(wet.color.toArray()[axis] < dry.color.toArray()[axis]);
      assert.ok(wet.roughness < dry.roughness);assert.ok(Math.abs(wet.height) < Math.abs(dry.height));
      assert.equal(wet.metalness, dry.metalness);assert.deepEqual(wet.features, dry.features);
    }
    const slopeEnergy = material => Array.from(normals(material)).reduce((sum, byte, k) => sum + (k % 4 < 2 ? (byte - 127.5) ** 2 : 0), 0);
    assert.ok(slopeEnergy(palette.get(recipe, {wetness: 1})) < slopeEnergy(palette.get(recipe)), recipe);
  }
  palette.dispose();
});

test('physical dimensions control finite-difference normals rather than scaling texture coordinates', () => {
  const palette = createProceduralPalette(THREE, {resolution: 256});
  const i = 18, j = 27, u = (i + .5) / 256, v = (j + .5) / 256;
  for (const tileSizeMeters of [[.6, 1.2], [2.4, 3.6]]) {
    const h = (du, dv) => palette.sample('wood', {u: u + du, v: v + dv, tileSizeMeters}).height;
    const dx = (h(1 / 256, 0) - h(-1 / 256, 0)) / (2 * tileSizeMeters[0] / 256);
    const dy = (h(0, 1 / 256) - h(0, -1 / 256)) / (2 * tileSizeMeters[1] / 256);
    const length = Math.hypot(dx, dy, 1), expected = [-dx / length, -dy / length, 1 / length];
    pixel(palette.get('wood', {tileSizeMeters}).normalMap, i, j).slice(0, 3).forEach((n, axis) => near(n / 255 * 2 - 1, expected[axis], 1 / 255 + 1e-12));
  }
  assert.ok(!Buffer.from(normals(palette.get('wood'))).equals(Buffer.from(normals(palette.get('wood', {tileSizeMeters: [2.4, 3.6]})))));
  palette.dispose();
});

test('seed and variant change relief topology deterministically, independent of call order', () => {
  const a = createProceduralPalette(THREE, {resolution: 64, seed: 123});
  const b = createProceduralPalette(THREE, {resolution: 64, seed: 123});
  const c = createProceduralPalette(THREE, {resolution: 64, seed: 124});
  for (const recipe of recipes) {
    b.get(recipe, {variant: 7});
    assert.deepEqual(normals(a.get(recipe)), normals(b.get(recipe)));
    assert.notDeepEqual(normals(a.get(recipe)), normals(a.get(recipe, {variant: 1})));
    assert.notDeepEqual(normals(a.get(recipe)), normals(c.get(recipe)));
  }
  a.dispose();b.dispose();c.dispose();
});

test('fields repeat exactly across UV tiles, including features and physical heights', () => {
  const palette = createProceduralPalette(THREE, {resolution: 64});
  for (const recipe of recipes) for (const [u, v] of [[.13, .79], [0, 0], [.998, .001]]) {
    const a = palette.sample(recipe, {u, v}), b = palette.sample(recipe, {u: u + 2, v: v - 3});
    near(a.height, b.height);near(a.roughness, b.roughness);near(a.metalness, b.metalness);
    a.color.toArray().forEach((c, i) => near(c, b.color.toArray()[i]));
  }
  palette.dispose();
});

test('wood stays directional, stone has mineral variation and explicit wear can expose metal', () => {
  const palette = createProceduralPalette(THREE, {resolution: 64, seed: 3});
  let across = 0, along = 0, stoneMin = Infinity, stoneMax = -Infinity, paint, exposed;
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
    const u = (i + .5) / 32, v = (j + .5) / 32;
    const wood = palette.sample('wood', {u, v});
    across += Math.abs(wood.height - palette.sample('wood', {u: u + 1 / 128, v}).height);
    along += Math.abs(wood.height - palette.sample('wood', {u, v: v + 1 / 128}).height);
    const stone = palette.sample('stone', {u, v});
    stoneMin = Math.min(stoneMin, stone.features.mineral);stoneMax = Math.max(stoneMax, stone.features.mineral);
    const metal = palette.sample('coated-metal', {u, v, wear: 1});
    if (!paint || metal.features.exposure < paint.features.exposure) paint = metal;
    if (!exposed || metal.features.exposure > exposed.features.exposure) exposed = metal;
  }
  assert.ok(across > along * 2, `${across} vs ${along}`);
  assert.ok(stoneMax - stoneMin > .25);
  assert.ok(paint.metalness < .1);assert.ok(exposed.metalness > .8);
  assert.ok(exposed.height < paint.height);
  palette.dispose();
});

test('clean paint remains dielectric; wear is opt-in, cached separately and spatially coherent', () => {
  const palette = createProceduralPalette(THREE, {resolution: 64});
  const clean = palette.get('coated-metal'), worn = palette.get('coated-metal', {wear: 1});
  assert.equal(clean, palette.get('coated-metal', {wear: 0}));assert.notEqual(clean, worn);
  assert.ok(Array.from(clean.metalnessMap.image.data).every((n, k) => k % 4 === 3 ? n === 255 : n === 0));
  let wornPixels = 0;
  for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
    const u = (i + .5) / 32, v = (j + .5) / 32;
    const a = palette.sample('coated-metal', {u, v}), b = palette.sample('coated-metal', {u, v, wear: 1});
    assert.equal(a.features.exposure, 0);assert.equal(a.metalness, 0);
    if (b.metalness > .5) {wornPixels++;assert.ok(b.height < a.height);assert.ok(b.roughness < a.roughness);}
  }
  assert.ok(wornPixels > 0 && wornPixels < 1024);palette.dispose();
});

test('default albedo variation stays restrained rather than forcing decorative stripes or cells', () => {
  const palette = createProceduralPalette(THREE, {resolution: 256});
  for (const [recipe, maxContrast] of [['wood', 1.6], ['stone', 1.35], ['coated-metal', 1.1]]) {
    const values = [];
    for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) {
      const {color} = palette.sample(recipe, {u: (i + .5) / 40, v: (j + .5) / 40});
      values.push(.2126 * color.r + .7152 * color.g + .0722 * color.b);
    }
    assert.ok(Math.max(...values) / Math.min(...values) < maxContrast, recipe);
  }
  palette.dispose();
});

test('dispose owns every cached resource exactly once and rejects use after disposal', () => {
  const palette = createProceduralPalette(THREE, {resolution: 64});
  const materials = [palette.get('wood'), palette.get('stone'), palette.get('coated-metal', {variant: 2})];
  const events = [];
  for (const material of materials) for (const resource of [material, material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
    const event = {count: 0};events.push(event);resource.addEventListener('dispose', () => event.count++);
  }
  palette.dispose();palette.dispose();assert.ok(events.every(e => e.count === 1));
  assert.equal(palette.inspect().disposed, true);assert.equal(palette.inspect().entries.length, 0);
  assert.throws(() => palette.get('wood'), /disposed/);
  assert.throws(() => palette.sample('wood', {u: 0, v: 0}), /disposed/);
});

test('rejects invalid dimensions, seeds, recipes and ambiguous or invalid recipe options before allocation', () => {
  for (const options of [{resolution: 0}, {resolution: 63.5}, {seed: NaN}, {seed: 1.5}, {seed: -1}, {seed: 2 ** 32}, {unexpected: true}]) assert.throws(() => createProceduralPalette(THREE, options));
  const palette = createProceduralPalette(THREE, {resolution: 64});
  for (const recipe of ['sand', '', '__proto__']) assert.throws(() => palette.get(recipe), /recipe/);
  for (const options of [{wetness: -1}, {wetness: 1.01}, {wetness: NaN}, {wear: .5}, {variant: -1}, {variant: .5}, {tileSizeMeters: [0, 1]}, {tileSizeMeters: [1]}, {tileSizeMeters: [1, Infinity]}, {tileSizeMeters: [1e-300, 1]}, {tileSizeMeters: [1e300, 1]}, {rougness: .5}]) assert.throws(() => palette.get('wood', options));
  for (const wear of [-1, 1.01, NaN]) assert.throws(() => palette.get('coated-metal', {wear}));
  for (const point of [{u: NaN, v: 0}, {u: 0}, {u: 0, v: Infinity}]) assert.throws(() => palette.sample('stone', point));
  assert.equal(palette.inspect().entries.length, 0);palette.dispose();
});
test('deep release continues across baked materials, maps and sibling recipes',()=>{
 const p=createProceduralPalette(THREE,{resolution:64}),a=p.get('wood'),b=p.get('stone');
 const counts=new Map(),items=[a,b,...[a,b].flatMap(m=>[m.map,m.metalnessMap,m.normalMap,m.roughnessMap])];
 for(const item of items)item.addEventListener('dispose',()=>counts.set(item,(counts.get(item)??0)+1));
 for(const item of [a,a.map,a.normalMap])item.addEventListener('dispose',()=>{throw Error(item.uuid);});
 assert.throws(()=>p.dispose(),AggregateError);p.dispose();assert.deepEqual(p.inspect().entries,[]);
 for(const item of items)assert.equal(counts.get(item),1,item.uuid);
});
