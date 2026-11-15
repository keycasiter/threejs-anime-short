import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { findWalkableSpawn } from '../../assets/scene/walk-spawn.mjs';

const THREE = await import(process.env.THREE_MODULE
  ? pathToFileURL(resolve(process.env.THREE_MODULE)).href
  : 'three');

function walkPlane(y = 0, slopeDegrees = 0) {
  const geometry = new THREE.PlaneGeometry(30, 30);
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateZ(THREE.MathUtils.degToRad(slopeDegrees));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.y = y;
  return mesh;
}

test('spawn eye position derives from the actual translated ground surface and normalized world normal', () => {
  const ground = walkPlane();
  const parent = new THREE.Group();
  parent.position.set(0, 4, 0);
  parent.rotation.z = 0.25;
  parent.scale.set(2, 0.5, 1.5);
  parent.add(ground);
  const spawn = findWalkableSpawn(THREE, { x: 0, z: 0, groundRoots: [parent], eyeHeight: 1.7 });
  assert.ok(spawn);
  assert.ok(Math.abs(spawn.groundPoint.y - 4) < 1e-5);
  assert.ok(Math.abs(spawn.position.y - 5.7) < 1e-5);
  const expectedWorldNormal = new THREE.Vector3(-Math.sin(0.25), Math.cos(0.25), 0);
  assert.ok(spawn.surfaceNormal.distanceTo(expectedWorldNormal) < 1e-5);
  ground.geometry.dispose();
  ground.material.dispose();
});

test('steep, invisible, and explicitly non-walkable surfaces are skipped', () => {
  const steep = walkPlane(8, 55);
  const tagged = walkPlane(5);
  tagged.userData.walkable = false;
  const hiddenParent = new THREE.Group();
  hiddenParent.visible = false;
  hiddenParent.add(walkPlane(3));
  const ground = walkPlane(0);
  const spawn = findWalkableSpawn(THREE, {
    x: 0, z: 0, groundRoots: [steep, tagged, hiddenParent, ground], maxSlopeDegrees: 35,
  });
  assert.ok(spawn);
  assert.equal(spawn.hit.object, ground);
  ground.geometry.dispose(); ground.material.dispose();
  for (const mesh of [steep, tagged, hiddenParent.children[0]]) { mesh.geometry.dispose(); mesh.material.dispose(); }
});

test('caller collision contract can reject a candidate and continue to a safer ground layer', () => {
  const upper = walkPlane(6);
  const lower = walkPlane(1);
  const spawn = findWalkableSpawn(THREE, {
    x: 0, z: 0, groundRoots: [upper, lower], eyeHeight: 1.6,
    isCandidateClear: ({ groundPoint }) => groundPoint.y < 2,
  });
  assert.ok(spawn);
  assert.equal(spawn.groundPoint.y, 1);
  assert.equal(spawn.position.y, 2.6);
  upper.geometry.dispose(); upper.material.dispose(); lower.geometry.dispose(); lower.material.dispose();
});

test('invalid inputs and locations without a walkable hit fail explicitly', () => {
  const ground = walkPlane();
  assert.throws(() => findWalkableSpawn(THREE, { x: NaN, z: 0, groundRoots: [ground] }));
  assert.throws(() => findWalkableSpawn(THREE, { x: 0, z: 0, groundRoots: [ground], eyeHeight: 0 }));
  assert.throws(() => findWalkableSpawn(THREE, { x: 0, z: 0, groundRoots: [ground], rayTop: -1, rayBottom: 1 }));
  assert.equal(findWalkableSpawn(THREE, { x: 100, z: 100, groundRoots: [ground] }), null);
  ground.geometry.dispose(); ground.material.dispose();
});
