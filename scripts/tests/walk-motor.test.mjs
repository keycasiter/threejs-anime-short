import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createGroundedWalkMotor } from '../../assets/scene/walk-motor.mjs';

const THREE = await import(process.env.THREE_MODULE
  ? pathToFileURL(resolve(process.env.THREE_MODULE)).href
  : 'three');

function ground({ slopeX = 0, width = 20, depth = 20, x = 0, y = 0, z = 0 } = {}) {
  const geometry = new THREE.PlaneGeometry(width, depth, 32, 32);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) positions.setY(i, positions.getX(i) * slopeX);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function motor(groundRoots, options = {}) {
  return createGroundedWalkMotor(THREE, {
    groundRoots,
    eyeHeight: 1.65,
    maxSlopeDegrees: 32,
    isCandidateClear: () => true,
    ...options
  });
}

test('walks on a flat final surface and keeps eye height grounded', () => {
  const floor = ground();
  const controller = motor([floor]);
  const result = controller.move(new THREE.Vector3(0, 1.65, 0), new THREE.Vector3(1, 0, 2));
  assert.ok(Math.abs(result.position.x - 1) < 1e-6);
  assert.ok(Math.abs(result.position.z - 2) < 1e-6);
  assert.ok(Math.abs(result.position.y - 1.65) < 1e-6);
  assert.equal(result.blockedX, false);
  assert.equal(result.blockedZ, false);
  floor.geometry.dispose(); floor.material.dispose();
});

test('follows a walkable slope using the transformed surface height', () => {
  const ramp = ground({ slopeX: .2 });
  const controller = motor([ramp], { maxSlopeDegrees: 20 });
  const result = controller.move(new THREE.Vector3(0, 1.65, 0), new THREE.Vector3(2, 0, 0));
  assert.ok(Math.abs(result.position.x - 2) < 1e-6);
  assert.ok(Math.abs(result.position.y - 2.05) < 1e-4);
  ramp.geometry.dispose(); ramp.material.dispose();
});

test('rejects terrain steeper than the configured walkable slope', () => {
  const steep = ground({ slopeX: 1.2 });
  const controller = motor([steep], { maxSlopeDegrees: 25 });
  const result = controller.move(new THREE.Vector3(0, 1.65, 0), new THREE.Vector3(1, 0, 0));
  assert.ok(result.position.x < .01);
  assert.equal(result.blockedX, true);
  steep.geometry.dispose(); steep.material.dispose();
});

test('steps onto a small platform but rejects a step beyond the configured rise', () => {
  const floor = ground({ width: 20, depth: 20 });
  const platformGeo = new THREE.BoxGeometry(6, .2, 8);
  const platform = new THREE.Mesh(platformGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  platform.position.set(2, .1, 0); platform.updateMatrixWorld(true);
  const controller = motor([floor, platform], { maxStepUp: .25, maxStepDown: .4 });
  const small = controller.move(new THREE.Vector3(-.6, 1.65, 0), new THREE.Vector3(1, 0, 0));
  assert.ok(small.position.x > .39);
  assert.ok(Math.abs(small.position.y - 1.85) < 1e-5);

  const leftFloor = ground({ width: 10, depth: 8, x: -5 });
  const highFloor = ground({ width: 6, depth: 8, x: 3, y: 1.2 });
  const highStepMotor = motor([leftFloor, highFloor], { maxStepUp: .25 });
  const blocked = highStepMotor.move(new THREE.Vector3(-.6, 1.65, 0), new THREE.Vector3(2, 0, 0));
  assert.ok(blocked.position.x < .01);
  assert.equal(blocked.blockedX, true);
  floor.geometry.dispose(); floor.material.dispose();
  platform.geometry.dispose(); platform.material.dispose();
  leftFloor.geometry.dispose(); leftFloor.material.dispose();
  highFloor.geometry.dispose(); highFloor.material.dispose();
});

test('delegates capsule/body clearance and slides along the open axis', () => {
  const floor = ground();
  const controller = motor([floor], {
    isCandidateClear: ({ position }) => position.z <= .2
  });
  const result = controller.move(new THREE.Vector3(0, 1.65, 0), new THREE.Vector3(1, 0, 1));
  assert.ok(result.position.x > .99);
  assert.ok(result.position.z < .201);
  assert.equal(result.blockedZ, true);
  floor.geometry.dispose(); floor.material.dispose();
});

test('substeps stop at a gap instead of teleporting to a distant surface', () => {
  const nearFloor = ground({ width: 4, depth: 4, x: -3 });
  const farFloor = ground({ width: 4, depth: 4, x: 4 });
  const controller = motor([nearFloor, farFloor], { maxSegmentLength: .15 });
  const result = controller.move(new THREE.Vector3(-3, 1.65, 0), new THREE.Vector3(8, 0, 0));
  assert.ok(result.position.x < -.9);
  assert.equal(result.blockedX, true);
  nearFloor.geometry.dispose(); nearFloor.material.dispose();
  farFloor.geometry.dispose(); farFloor.material.dispose();
});

test('rejects missing blocker callback and invalid movement', () => {
  const floor = ground();
  assert.throws(() => createGroundedWalkMotor(THREE, { groundRoots: [floor] }), /isCandidateClear/);
  const controller = motor([floor]);
  assert.throws(() => controller.move(new THREE.Vector3(), new THREE.Vector3(NaN, 0, 0)), /finite/);
  floor.geometry.dispose(); floor.material.dispose();
});
