import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createFollowCameraSolver } from '../../assets/scene/follow-camera.mjs';

const THREE = await import(process.env.THREE_MODULE
  ? pathToFileURL(resolve(process.env.THREE_MODULE)).href
  : 'three');

const wall = (x, y, z, sx, sy, sz) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z); mesh.updateMatrixWorld(true); return mesh;
};

test('clear boom retains the requested follow composition', () => {
  const solver = createFollowCameraSolver(THREE, { occluders: [], detours: [[0, 3, 0]] });
  const pivot = new THREE.Vector3(0, 1, 0), desired = new THREE.Vector3(0, 3, 10);
  const result = solver.solve(pivot, desired);
  assert.equal(result.detoured, false);
  assert.equal(result.blocked, false);
  assert.equal(result.primaryObstacle, null);
  assert.ok(result.position.distanceTo(desired) < 1e-6);
});

test('wall clamps the swept camera volume before the hit surface', () => {
  const obstacle = wall(0, 2, 5, 8, 8, .2);
  const solver = createFollowCameraSolver(THREE, { occluders: [obstacle], skin: .3, minDistance: .8 });
  const result = solver.solve(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2, 10));
  assert.equal(result.blocked, true);
  assert.equal(result.detoured, false);
  assert.equal(result.primaryObstacle, obstacle);
  assert.ok(result.actualDistance > 3 && result.actualDistance < 5);
  assert.ok(result.position.z < 4.9);
  obstacle.geometry.dispose(); obstacle.material.dispose();
});

test('side rays detect a narrow obstacle beside the boom centerline', () => {
  const obstacle = wall(.4, 1.6, 5, .18, 2, .4);
  const solver = createFollowCameraSolver(THREE, { occluders: [obstacle], volumeRadius: .35, skin: .2 });
  const result = solver.solve(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 10));
  assert.equal(result.blocked, true);
  assert.equal(result.primaryObstacle, obstacle);
  obstacle.geometry.dispose(); obstacle.material.dispose();
});

test('safe vertical detour preserves distance when a low crossbar blocks the default boom', () => {
  const obstacle = wall(0, 1.9, 5, 8, .8, .25);
  const solver = createFollowCameraSolver(THREE, {
    occluders: [obstacle], skin: .2, minDistance: .8, detours: [[0, 4, 0]]
  });
  const result = solver.solve(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2, 10));
  assert.equal(result.detoured, true);
  assert.equal(result.blocked, false);
  assert.equal(result.primaryObstacle, obstacle);
  assert.ok(result.actualDistance > 9);
  assert.ok(result.position.y > 5);
  obstacle.geometry.dispose(); obstacle.material.dispose();
});

test('blocked space shorter than the requested minimum is reported instead of silently forced through', () => {
  const obstacle = wall(0, 1.5, 1.1, 8, 8, .5);
  const solver = createFollowCameraSolver(THREE, { occluders: [obstacle], skin: .2, minDistance: 1.2 });
  const result = solver.solve(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 8));
  assert.equal(result.blocked, true);
  assert.equal(result.tooClose, true);
  assert.ok(result.actualDistance < 1.2);
  obstacle.geometry.dispose(); obstacle.material.dispose();
});

test('rejects incompatible camera mode inputs and malformed detours', () => {
  assert.throws(() => createFollowCameraSolver({ REVISION: '180' }, { occluders: [] }), /r187/);
  assert.throws(() => createFollowCameraSolver(THREE, { occluders: [], detours: [[0, NaN, 1]] }), /detours/);
  const solver = createFollowCameraSolver(THREE, { occluders: [] });
  assert.throws(() => solver.solve(new THREE.Vector3(), new THREE.Vector3()), /shorter than minDistance/);
});
