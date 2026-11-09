import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createSurfaceMaps } from '../../assets/materials/surface-fields.mjs';
const THREE = process.env.THREE_MODULE ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href) : await import('three');
const pixel = (texture, i, j) => Array.from(texture.image.data.slice((j * texture.image.width + i) * 4, (j * texture.image.width + i + 1) * 4));
const unitNormal = (dx, dy) => {const length = Math.hypot(dx, dy, 1);return [-dx / length, -dy / length, 1 / length];};
// A normalized component encoded in 8 bits has at most 1/255 decoded error.
const normalNear = (texture, i, j, expected) => pixel(texture, i, j).slice(0, 3).forEach((value, axis) => assert.ok(Math.abs(value / 255 * 2 - 1 - expected[axis]) <= 1 / 255 + 1e-12, `normal axis ${axis}: ${value / 255 * 2 - 1} vs ${expected[axis]}`));

test('constant physical slope gives the analytic signed normal, including all clamp edges', () => {
  const maps = createSurfaceMaps(THREE, {width: 7, height: 5, physicalSize: [2, 3], heightAt: ({x, y}) => .25 * x - .5 * y + 7});
  for (let j = 0; j < 5; j++) for (let i = 0; i < 7; i++) normalNear(maps.normalMap, i, j, unitNormal(.25, -.5));
  maps.dispose();
});

test('physical tile size changes slope even when UV field and resolution stay identical', () => {
  const options = {width: 9, height: 5, heightAt: ({u, v}) => .4 * u + .3 * v};
  const a = createSurfaceMaps(THREE, {...options, physicalSize: [1, 1]});
  const b = createSurfaceMaps(THREE, {...options, physicalSize: [4, 3]});
  normalNear(a.normalMap, 4, 2, unitNormal(.4, .3));
  normalNear(b.normalMap, 4, 2, unitNormal(.1, .1));
  assert.notDeepEqual(pixel(a.normalMap, 4, 2), pixel(b.normalMap, 4, 2));
  a.dispose();b.dispose();
});

test('flat height encodes +Z and constant roughness is in G with independent material scalar', () => {
  const maps = createSurfaceMaps(THREE, {width: 3, height: 2, heightAt: () => 13, roughnessAt: () => .4});
  for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) {
    assert.deepEqual(pixel(maps.normalMap, i, j), [128, 128, 255, 255]);
    assert.deepEqual(pixel(maps.roughnessMap, i, j), [0, 102, 0, 255]);
  }
  const material = new THREE.MeshStandardMaterial({roughness: .6, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap});
  assert.equal(material.roughness, .6);
  assert.equal(material.roughness * pixel(material.roughnessMap, 0, 0)[1] / 255, .24);
  assert.equal(material.normalMapType, THREE.TangentSpaceNormalMap);
  assert.deepEqual(material.normalScale.toArray(), [1, 1]);
  material.dispose();maps.dispose();
});

test('samples callbacks once at pixel centers, with low V in the first stored row', () => {
  const heights = [], roughnesses = [];
  const maps = createSurfaceMaps(THREE, {width: 2, height: 3, physicalSize: [4, 9], heightAt: p => {heights.push({...p});return p.y * .1;}, roughnessAt: p => {roughnesses.push({...p});return p.v;}});
  const expected = Array.from({length: 6}, (_, k) => ({u: ((k % 2) + .5) / 2, v: (Math.floor(k / 2) + .5) / 3, x: ((k % 2) + .5) * 2, y: (Math.floor(k / 2) + .5) * 3}));
  assert.deepEqual(heights, expected);assert.deepEqual(roughnesses, expected);
  assert.equal(pixel(maps.roughnessMap, 0, 0)[1], 43);
  assert.equal(pixel(maps.roughnessMap, 0, 2)[1], 213);
  normalNear(maps.normalMap, 0, 0, unitNormal(0, .1));
  maps.dispose();
});

test('periodic neighbors preserve analytic periodic derivative and both tile seams', () => {
  const width = 32, height = 24, sx = 2, sy = 3;
  const maps = createSurfaceMaps(THREE, {width, height, physicalSize: [sx, sy], wrapU: 'repeat', wrapV: 'repeat', heightAt: ({u, v}) => .1 * Math.sin(2 * Math.PI * u) + .15 * Math.sin(2 * Math.PI * v)});
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const dx = .1 * Math.cos(2 * Math.PI * (i + .5) / width) * Math.sin(2 * Math.PI / width) / (sx / width);
    const dy = .15 * Math.cos(2 * Math.PI * (j + .5) / height) * Math.sin(2 * Math.PI / height) / (sy / height);
    normalNear(maps.normalMap, i, j, unitNormal(dx, dy));
  }
  for (let j = 0; j < height; j++) assert.deepEqual(pixel(maps.normalMap, 0, j), pixel(maps.normalMap, width - 1, j));
  for (let i = 0; i < width; i++) assert.deepEqual(pixel(maps.normalMap, i, 0), pixel(maps.normalMap, i, height - 1));
  maps.dispose();
});

test('clamp uses one-sided boundary differences without halving edge slope', () => {
  const maps = createSurfaceMaps(THREE, {width: 4, height: 3, physicalSize: [4, 3], heightAt: ({x, y}) => x * x + .5 * y * y});
  // Samples x=.5,1.5,2.5,3.5: secant edge slopes 2 and 6; interior 3 and 5.
  const dx = [2, 3, 5, 6], dy = [1, 1.5, 2];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) normalNear(maps.normalMap, i, j, unitNormal(dx[i], dy[j]));
  maps.dispose();
});

test('maps explicitly use raw RGBA8 linear data, linear filtering and per-axis wrapping', () => {
  const maps = createSurfaceMaps(THREE, {width: 5, height: 3, wrapU: 'repeat', wrapV: 'clamp'});
  for (const texture of [maps.normalMap, maps.roughnessMap]) {
    assert.ok(texture instanceof THREE.DataTexture);assert.ok(texture.image.data instanceof Uint8Array);
    assert.equal(texture.image.data.length, 5 * 3 * 4);assert.equal(texture.format, THREE.RGBAFormat);assert.equal(texture.type, THREE.UnsignedByteType);
    assert.equal(texture.colorSpace, THREE.NoColorSpace);assert.equal(texture.flipY, false);assert.equal(texture.unpackAlignment, 1);
    assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);assert.equal(texture.magFilter, THREE.LinearFilter);assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.wrapS, THREE.RepeatWrapping);assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);assert.equal(texture.premultiplyAlpha, false);
    assert.ok(texture.version > 0);
  }
  assert.equal(maps.metadata.roughnessChannel, 'g');
  assert.equal(maps.metadata.roughnessCombination, 'material.roughness * roughnessMap.g');
  assert.deepEqual(maps.metadata.physicalSize, [1, 1]);assert.deepEqual(maps.metadata.texelSize, [.2, 1 / 3]);
  maps.dispose();
});

test('finite fields spanning roughness endpoints remain bounded and deterministic', () => {
  const options = {width: 8, height: 7, physicalSize: [.2, .3], heightAt: ({x, y}) => .001 * Math.sin(31 * x) * Math.cos(17 * y), roughnessAt: ({u}) => u < .5 ? 0 : 1};
  const a = createSurfaceMaps(THREE, options), b = createSurfaceMaps(THREE, options);
  for (const key of ['normalMap', 'roughnessMap']) {
    assert.deepEqual(a[key].image.data, b[key].image.data);
    for (const value of a[key].image.data) assert.ok(Number.isFinite(value) && value >= 0 && value <= 255);
  }
  assert.deepEqual(a.metadata.roughnessRange, [0, 1]);
  assert.equal(pixel(a.roughnessMap, 0, 0)[1], 0);assert.equal(pixel(a.roughnessMap, 7, 0)[1], 255);
  a.dispose();b.dispose();
});

test('rejects invalid sizes, nonfinite fields, out-of-range roughness and derivative overflow', () => {
  for (const invalid of [{width: 1}, {height: 2.5}, {physicalSize: [0, 1]}, {physicalSize: [1, Infinity]}, {physicalSize: [1]}, {physicalSize: [Number.MIN_VALUE, 1]}, {wrapU: 'mirror'}, {wrapV: 0}, {heightAt: 2}, {roughnessAt: null}]) assert.throws(() => createSurfaceMaps(THREE, invalid));
  for (const height of [NaN, Infinity, -Infinity, '0', undefined]) assert.throws(() => createSurfaceMaps(THREE, {width: 2, height: 2, heightAt: () => height}), /heightAt/);
  for (const roughness of [NaN, Infinity, -.001, 1.001, '0', undefined]) assert.throws(() => createSurfaceMaps(THREE, {width: 2, height: 2, roughnessAt: () => roughness}), /roughnessAt/);
  assert.throws(() => createSurfaceMaps(THREE, {width: 2, height: 2, heightAt: ({u}) => u < .5 ? -Number.MAX_VALUE : Number.MAX_VALUE}), /derivative/);
});

test('dispose releases both owned textures once and does not dispose attached material', () => {
  const maps = createSurfaceMaps(THREE, {width: 2, height: 2});
  const material = new THREE.MeshStandardMaterial({normalMap: maps.normalMap, roughnessMap: maps.roughnessMap});
  const events = {normal: 0, roughness: 0, material: 0};
  maps.normalMap.addEventListener('dispose', () => events.normal++);maps.roughnessMap.addEventListener('dispose', () => events.roughness++);material.addEventListener('dispose', () => events.material++);
  maps.dispose();maps.dispose();assert.deepEqual(events, {normal: 1, roughness: 1, material: 0});material.dispose();
});
