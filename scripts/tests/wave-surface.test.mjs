import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const THREE = await import(process.env.THREE_MODULE ? pathToFileURL(resolve(process.env.THREE_MODULE)).href : 'three');
let api;
try { api = await import('../../assets/environment/wave-surface.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const behavior = (name, fn) => test(name, {skip: !api}, fn);
const near = (actual, expected, tolerance = 2e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
const vectorNear = (actual, expected, tolerance) => actual.forEach((v, i) => near(v, expected[i], tolerance));
const waves = () => [
  {direction: [3, 4], amplitude: .28, wavelength: 5, q: .35, omega: 1.3, phase: .4},
  {direction: [-2, 1], amplitude: .16, wavelength: 3, q: .2, omega: 2.1, phase: -.7},
];
const make = (options = {}) => api.createWaveSurface(THREE, {width: 6, depth: 4, segmentsX: 6, segmentsZ: 4, waves: waves(), material: new THREE.MeshStandardMaterial(), ...options});
const snapshot = s => Array.from(s.mesh.geometry.attributes.position.array);

test('exports callable analytic sampler and CPU mesh factory', () => {
  assert.equal(typeof api?.sampleWaveSurface, 'function', 'missing sampleWaveSurface API');
  assert.equal(typeof api?.createWaveSurface, 'function', 'missing createWaveSurface API');
});

// Catches adding the base once per wave, dropping normalized direction, or time sign errors.
behavior('a hand-derived single wave has the expected displaced position and derivatives', () => {
  const s = api.sampleWaveSurface(0, 0, 0, [{direction: [2, 0], amplitude: .5, wavelength: 2 * Math.PI, q: .5, omega: 2, phase: 0}]);
  vectorNear(s.position, [.25, 0, 0]); vectorNear(s.dx, [1, .5, 0]); vectorNear(s.dz, [0, 0, 1]);
  vectorNear(s.normal, [-1 / Math.sqrt(5), 2 / Math.sqrt(5), 0]);
  vectorNear(api.sampleWaveSurface(0, 0, Math.PI / 4, [{direction: [2, 0], amplitude: .5, wavelength: 2 * Math.PI, q: .5, omega: 2}]).position, [0, -.5, 0]);
});

// Catches missing horizontal derivative terms and summing per-wave unit normals.
behavior('total derivatives agree with finite differences and define a unit upward normal', () => {
  const h = 1e-5;
  for (const [x, z, t] of [[.3, -.6, 0], [-1.2, .7, 2.5], [2, 1, -4]]) {
    const s = api.sampleWaveSurface(x, z, t, waves());
    const xp = api.sampleWaveSurface(x + h, z, t, waves()), xm = api.sampleWaveSurface(x - h, z, t, waves());
    const zp = api.sampleWaveSurface(x, z + h, t, waves()), zm = api.sampleWaveSurface(x, z - h, t, waves());
    vectorNear(s.dx, xp.position.map((v, i) => (v - xm.position[i]) / (2 * h)), 1e-9);
    vectorNear(s.dz, zp.position.map((v, i) => (v - zm.position[i]) / (2 * h)), 1e-9);
    near(Math.hypot(...s.normal), 1, 1e-12);
    near(s.normal.reduce((sum, v, i) => sum + v * s.dx[i], 0), 0, 1e-12);
    near(s.normal.reduce((sum, v, i) => sum + v * s.dz[i], 0), 0, 1e-12);
    assert.ok(s.normal[1] > 0);
  }
});

behavior('empty waves and zero amplitude remain exactly flat while q zero retains vertical motion', () => {
  const flat = {position: [2, 0, -3], dx: [1, 0, 0], dz: [0, 0, 1], normal: [0, 1, 0]};
  assert.deepEqual(api.sampleWaveSurface(2, -3, 19, []), flat);
  assert.deepEqual(api.sampleWaveSurface(2, -3, 19, [{direction: [1, 0], amplitude: 0, wavelength: 2, q: 8}]), flat);
  const s = api.sampleWaveSurface(0, 0, 0, [{direction: [1, 0], amplitude: .3, wavelength: 4, q: 0, phase: Math.PI / 2}]);
  vectorNear(s.position, [0, .3, 0]);
});

behavior('invalid waves and folding horizontal maps fail before producing corrupt geometry', () => {
  const valid = waves()[0];
  for (const bad of [null, {}, {...valid, direction: [0, 0]}, {...valid, direction: [1, Infinity]}, {...valid, amplitude: -1}, {...valid, wavelength: 0}, {...valid, omega: NaN}, {...valid, phase: Infinity}, {...valid, q: Infinity}, {...valid, amplitude: 1, wavelength: 1, q: 1}, {...valid, wavelength: Number.MIN_VALUE}]) assert.throws(() => api.sampleWaveSurface(0, 0, 0, [bad]));
  assert.throws(() => api.sampleWaveSurface(0, 0, 0, null));
  for (const p of [[NaN, 0, 0], [0, Infinity, 0], [0, 0, NaN]]) assert.throws(() => api.sampleWaveSurface(...p, []));
});

// Catches stale position/normal buffers, displaced-coordinate feedback and incorrect water level.
behavior('mesh vertices and normals consume the same rest-coordinate sampler and current water level', () => {
  const s = make({waterLevel: 2.75}); s.update(1.2);
  const geometry = s.mesh.geometry, positions = geometry.attributes.position, normals = geometry.attributes.normal;
  assert.ok(s.root.isObject3D && s.mesh.isMesh);
  for (let iz = 0; iz <= 4; iz++) for (let ix = 0; ix <= 6; ix++) {
    const index = iz * 7 + ix, sample = s.sampleRest(ix - 3, iz - 2, 1.2);
    const analytic = api.sampleWaveSurface(ix - 3, iz - 2, 1.2, waves());
    vectorNear(Array.from(positions.array.slice(index * 3, index * 3 + 3)), sample.position);
    vectorNear(Array.from(normals.array.slice(index * 3, index * 3 + 3)), sample.normal);
    near(sample.position[1], analytic.position[1] + 2.75);
  }
  assert.ok(positions.version > 0 && normals.version > 0);
  s.dispose(); s.mesh.material.dispose();
});

behavior('flat mesh triangle winding points upward and bounds enclose the updated actual vertices', () => {
  const s = make({waves: [], waterLevel: 4});
  const g = s.mesh.geometry, p = g.attributes.position, index = g.index;
  for (let i = 0; i < index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, index.getX(i)), b = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 1)), c = new THREE.Vector3().fromBufferAttribute(p, index.getX(i + 2));
    assert.ok(b.sub(a).cross(c.sub(a)).y > 0);
  }
  s.setWaves(waves()); s.update(7.3); s.setWaterLevel(-8);
  const actualBox = new THREE.Box3().setFromBufferAttribute(p);
  assert.ok(g.boundingBox.equals(actualBox));
  for (let i = 0; i < p.count; i++) assert.ok(g.boundingSphere.containsPoint(new THREE.Vector3().fromBufferAttribute(p, i)));
  s.dispose(); s.mesh.material.dispose();
});

behavior('setters immediately change real buffers at the last time and copy caller wave inputs', () => {
  const input = waves(), s = make({waves: input}); s.update(2.3); const original = snapshot(s);
  input[0].amplitude = 100; input[0].direction[0] = 100; input.push({}); s.update(2.3); assert.deepEqual(snapshot(s), original);
  const next = [{direction: [1, 0], amplitude: .2, wavelength: 4, q: .4, omega: .6, phase: .1}];
  s.setWaves(next); const changed = snapshot(s); assert.notDeepEqual(changed, original);
  const sample = api.sampleWaveSurface(-3, -2, 2.3, next); vectorNear(changed.slice(0, 3), sample.position);
  next[0].amplitude = 20; next[0].direction[0] = -8; s.update(2.3); assert.deepEqual(snapshot(s), changed);
  s.setWaterLevel(5); const raised = snapshot(s);
  for (let i = 0; i < changed.length; i++) near(raised[i] - changed[i], i % 3 === 1 ? 5 : 0);
  const beforeInvalid = snapshot(s); assert.throws(() => s.setWaves([{...waves()[0], wavelength: 0}])); assert.throws(() => s.setWaterLevel(Infinity)); assert.deepEqual(snapshot(s), beforeInvalid);
  s.dispose(); s.mesh.material.dispose();
});

behavior('arbitrary absolute-time seeks reproduce full buffers without replacing resources', () => {
  const a = make(), b = make(); a.update(4.25); const wanted = snapshot(a), wantedNormals = Array.from(a.mesh.geometry.attributes.normal.array);
  const geometry = a.mesh.geometry, position = geometry.attributes.position, normal = geometry.attributes.normal, array = position.array;
  for (const time of [70, -8, 0, 4.25]) a.update(time); b.update(4.25);
  assert.deepEqual(snapshot(a), wanted); assert.deepEqual(snapshot(b), wanted); assert.deepEqual(Array.from(normal.array), wantedNormals);
  assert.equal(a.mesh.geometry, geometry); assert.equal(geometry.attributes.position, position); assert.equal(position.array, array); assert.equal(geometry.attributes.normal, normal);
  a.dispose(); b.dispose(); a.mesh.material.dispose(); b.mesh.material.dispose();
});

behavior('factory validates finite dimensions, integer tessellation, material and times', () => {
  for (const bad of [{width: 0}, {depth: NaN}, {segmentsX: 0}, {segmentsZ: 1.5}, {segmentsX: 1000000}, {waterLevel: NaN}, {material: null}]) {
    const material = new THREE.MeshStandardMaterial(); assert.throws(() => make({material, ...bad})); material.dispose();
  }
  const s = make(); assert.throws(() => s.update(Infinity)); assert.throws(() => s.sampleRest(0, 0, NaN)); s.dispose(); s.mesh.material.dispose();
});

behavior('dispose detaches and frees only the owned geometry exactly once', () => {
  const material = new THREE.MeshStandardMaterial(), s = make({material}), scene = new THREE.Scene(); scene.add(s.root);
  let geometryDisposals = 0, materialDisposals = 0;
  s.mesh.geometry.addEventListener('dispose', () => geometryDisposals++); material.addEventListener('dispose', () => materialDisposals++);
  s.dispose(); s.dispose(); assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 0); assert.equal(s.root.parent, null); assert.equal(s.root.visible, false);
  for (const act of [() => s.update(0), () => s.setWaves([]), () => s.setWaterLevel(1), () => s.sampleRest(0, 0, 0)]) assert.throws(act, /disposed/);
  material.dispose();
});

// Catches setters leaving a changed model behind after a finite but unrenderable input.
behavior('failed Float32-range setters preserve the last renderable wave model and bounds', () => {
  const s = make(); s.update(.8); const before = snapshot(s), sampled = s.sampleRest(.2, -.3), bounds = s.mesh.geometry.boundingBox.clone();
  assert.throws(() => s.setWaterLevel(Number.MAX_VALUE));
  assert.deepEqual(snapshot(s), before); assert.deepEqual(s.sampleRest(.2, -.3), sampled); assert.ok(s.mesh.geometry.boundingBox.equals(bounds));
  assert.throws(() => s.setWaves([{direction: [1, 0], amplitude: 1e100, wavelength: 2 * Math.PI, q: 0, phase: .7}]));
  assert.deepEqual(snapshot(s), before); assert.deepEqual(s.sampleRest(.2, -.3), sampled); assert.ok(s.mesh.geometry.boundingBox.equals(bounds));
  s.dispose(); s.mesh.material.dispose();
});
