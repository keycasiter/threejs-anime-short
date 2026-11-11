import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createWeatherField } from '../../assets/environment/weather-field.mjs';
const THREE = process.env.THREE_MODULE ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href) : await import('three');
const snapshot = field => Array.from(field.root.geometry.attributes.position.array);
const near = (actual, expected, tolerance = 2e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);

// Catches incremental integration, reseeding during update, and time-reset drift.
test('absolute time produces identical geometry across instances and out-of-order seeks', () => {
  const options = {seed: 19, count: 64, extent: [12, 10, 8]};
  const a = createWeatherField(THREE, options), b = createWeatherField(THREE, options);
  a.update(3.25); const expected = snapshot(a);
  for (const time of [90, -12, 0, 3.25]) a.update(time);
  b.update(3.25);
  assert.deepEqual(snapshot(a), expected); assert.deepEqual(snapshot(b), expected);
  const c = createWeatherField(THREE, {...options, seed: 20}); c.update(3.25);
  assert.notDeepEqual(snapshot(c), expected);
  a.dispose(); b.dispose(); c.dispose();
});

// Catches wind that only changes a shader uniform or streak tilt, and wrong fall sign.
test('wind and fall move actual particle positions by elapsed seconds away from wraps', () => {
  const field = createWeatherField(THREE, {count: 80, extent: [100, 100, 100], wind: [2, -3], fallSpeed: 5});
  field.update(0); const before = snapshot(field); field.update(.01); const after = snapshot(field);
  for (let i = 0; i < before.length; i += 6) {
    if (Math.abs(before[i]) > 49 || Math.abs(before[i + 1]) > 49 || Math.abs(before[i + 2]) > 49) continue;
    near(after[i] - before[i], .02, 4e-6); near(after[i + 1] - before[i + 1], -.05, 4e-6); near(after[i + 2] - before[i + 2], -.03, 4e-6);
  }
  field.dispose();
});

// Catches world-coordinate geometry double translation and update-time buffer rebuilding.
test('anchor moves the volume without allocating replacement resources', () => {
  const field = createWeatherField(THREE, {count: 25});
  field.update(4); const before = snapshot(field);
  const geometry = field.root.geometry, material = field.root.material, attribute = geometry.attributes.position, array = attribute.array;
  field.update(4, {anchor: [21, 8, -14]});
  assert.deepEqual(field.root.position.toArray(), [21, 8, -14]); assert.deepEqual(snapshot(field), before);
  for (let i = 0; i < 50; i++) field.update(i / 3, {anchor: [i, 0, -i]});
  assert.equal(field.root.geometry, geometry); assert.equal(field.root.material, material); assert.equal(geometry.attributes.position, attribute); assert.equal(attribute.array, array);
  assert.equal(field.root.isLineSegments, true); field.dispose();
});

// Catches intensity-as-opacity and toggles that keep submitting all vertices.
test('intensity and enablement control the real draw range and preserve deterministic rain', () => {
  const field = createWeatherField(THREE, {count: 100}); field.update(2); const full = snapshot(field);
  field.setIntensity(.25); assert.equal(field.root.geometry.drawRange.count, 50); assert.equal(field.readState().activeCount, 25);
  field.setIntensity(0); assert.equal(field.root.geometry.drawRange.count, 0);
  field.setIntensity(2); assert.equal(field.root.geometry.drawRange.count, 200); assert.deepEqual(snapshot(field), full);
  field.setEnabled(false); assert.equal(field.root.visible, false); assert.equal(field.root.geometry.drawRange.count, 0);
  field.update(4); field.setEnabled(true); assert.equal(field.root.visible, true); assert.equal(field.root.geometry.drawRange.count, 200);
  field.setIntensity(-1); assert.equal(field.root.geometry.drawRange.count, 0); field.dispose();
});

// Catches roof callbacks receiving local coordinates and below-roof streak leakage.
test('flat shelter clips crossing streaks and culls rain below the world-space roof', () => {
  let queriedWorld = false;
  const field = createWeatherField(THREE, {count: 600, extent: [10, 10, 10], wind: [0, 0], fallSpeed: 10, shelterHeightAt: (x, z) => {queriedWorld ||= x > 15 && z < -15; return 22;}});
  field.update(1, {anchor: [20, 20, -20]});
  assert.equal(queriedWorld, true); assert.ok(field.readState().visibleCount > 0 && field.readState().visibleCount < 600);
  const p = field.root.geometry.attributes.position.array, count = field.root.geometry.drawRange.count;
  let clipped = false;
  for (let i = 0; i < count * 3; i += 6) {assert.ok(p[i + 1] + 20 >= 22 - 1e-6); assert.ok(p[i + 4] + 20 >= 22 - 1e-6); clipped ||= Math.abs(p[i + 1] - 2) < 1e-6;}
  assert.equal(clipped, true); field.dispose();
  const blocked = createWeatherField(THREE, {count: 20, shelterHeightAt: () => 1000}); assert.equal(blocked.root.geometry.drawRange.count, 0); blocked.dispose();
  const unoccluded = createWeatherField(THREE, {count: 20, shelterHeightAt: () => null}); assert.equal(unoccluded.root.geometry.drawRange.count, 40); unoccluded.dispose();
});

// Catches applying a roof outside its caller-defined footprint, and stale compacted vertices.
test('shelter footprints leave outside rain visible and seeking restores the complete compacted buffer', () => {
  const field = createWeatherField(THREE, {count: 200, wind: [0, 0], shelterHeightAt: x => x > 0 ? 100 : null});
  field.update(2); const expected = snapshot(field), expectedCount = field.root.geometry.drawRange.count;
  assert.ok(expectedCount > 0 && expectedCount < 400);
  for (let i = 0; i < expectedCount * 3; i += 3) assert.ok(expected[i] <= 0);
  field.update(7, {anchor: [-30, 0, 0]}); assert.equal(field.root.geometry.drawRange.count, 400);
  field.update(2, {anchor: [0, 0, 0]}); assert.equal(field.root.geometry.drawRange.count, expectedCount); assert.deepEqual(snapshot(field), expected);
  field.dispose();
});

// Catches long streaks crossing wrap seams, nonfinite large-time math, and unbounded buffers.
test('all submitted vertices remain finite inside the fixed volume at extreme and negative times', () => {
  const field = createWeatherField(THREE, {count: 40, extent: [2, 3, 4], wind: [1000, -700], fallSpeed: 600});
  for (const time of [-1e200, -1, 0, 1e200]) {
    field.update(time); const positions = field.root.geometry.attributes.position.array;
    assert.equal(positions.length, 240);
    for (let i = 0; i < field.root.geometry.drawRange.count * 3; i++) assert.ok(Number.isFinite(positions[i]) && Math.abs(positions[i]) <= [1, 1.5, 2][i % 3] + 1e-6);
  }
  field.dispose();
});

test('invalid inputs fail clearly and snapshots cannot mutate internal anchor state', () => {
  for (const options of [{count: -1}, {count: 1.2}, {count: 100001}, {seed: NaN}, {extent: [0, 1, 2]}, {wind: [Infinity, 0]}, {fallSpeed: 0}, {opacity: 2}, {shelterHeightAt: 2}]) assert.throws(() => createWeatherField(THREE, options));
  const field = createWeatherField(THREE, {count: 0});
  assert.throws(() => field.update(NaN), /time/); assert.throws(() => field.update(0, {anchor: [0, Infinity, 0]}), /anchor/); assert.throws(() => field.setIntensity(NaN), /intensity/);
  const state = field.readState(); state.anchor[0] = 99; assert.deepEqual(field.readState().anchor, [0, 0, 0]); assert.equal(field.root.geometry.drawRange.count, 0); field.dispose();
  assert.throws(() => createWeatherField(THREE, {count: 1, shelterHeightAt: () => NaN}), /shelterHeightAt/);
});

// Catches leaking owned GPU resources and scene nodes, or double-disposal.
test('dispose detaches the field and releases its owned geometry and material exactly once', () => {
  const field = createWeatherField(THREE, {count: 5}), scene = new THREE.Scene(); scene.add(field.root);
  let geometryDisposals = 0, materialDisposals = 0;
  field.root.geometry.addEventListener('dispose', () => geometryDisposals++); field.root.material.addEventListener('dispose', () => materialDisposals++);
  field.dispose(); field.dispose(); assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1); assert.equal(field.root.parent, null);
  assert.equal(field.readState().disposed, true); assert.equal(field.root.visible, false); assert.equal(field.root.geometry.drawRange.count, 0);
  assert.throws(() => field.update(0), /disposed/);
});
