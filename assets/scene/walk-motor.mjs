import { findWalkableSpawn } from './walk-spawn.mjs';

/**
 * Grounded horizontal motor for first-person walking on final Three.js surfaces.
 * It steps movement, follows walkable height, rejects excessive steps/slopes,
 * and delegates body clearance to the caller's collision system.
 * It does not implement gravity, falling, jumping, or capsule collision.
 */
export function createGroundedWalkMotor(THREE, {
  groundRoots,
  eyeHeight = 1.65,
  maxSlopeDegrees = 32,
  maxStepUp = 0.32,
  maxStepDown = 0.48,
  maxSegmentLength = 0.22,
  isCandidateClear
} = {}) {
  if (String(THREE?.REVISION) !== '187') throw new Error('Grounded walk motor requires Three.js r187');
  if (!Array.isArray(groundRoots) || groundRoots.length === 0 || groundRoots.some(root => !root?.isObject3D)) {
    throw new TypeError('groundRoots must contain final walkable Object3D roots');
  }
  for (const [value, name] of [[eyeHeight, 'eyeHeight'], [maxSegmentLength, 'maxSegmentLength']]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be greater than zero`);
  }
  for (const [value, name] of [[maxSlopeDegrees, 'maxSlopeDegrees'], [maxStepUp, 'maxStepUp'], [maxStepDown, 'maxStepDown']]) {
    if (!Number.isFinite(value) || value < 0 || (name === 'maxSlopeDegrees' && value >= 90)) {
      throw new RangeError(`${name} is outside its valid range`);
    }
  }
  if (typeof isCandidateClear !== 'function') throw new TypeError('isCandidateClear must be the project body-clearance function');

  const candidate = new THREE.Vector3();
  const step = new THREE.Vector3();
  const result = {
    position: new THREE.Vector3(),
    movedDistance: 0,
    blockedX: false,
    blockedZ: false,
    acceptedSteps: 0,
    attemptedSteps: 0
  };

  function move(currentPosition, horizontalDisplacement) {
    if (!currentPosition?.isVector3 || !horizontalDisplacement?.isVector3 ||
        ![currentPosition.x, currentPosition.y, currentPosition.z,
          horizontalDisplacement.x, horizontalDisplacement.y, horizontalDisplacement.z].every(Number.isFinite)) {
      throw new TypeError('move requires finite Three.js Vector3 position and displacement');
    }
    const dx = horizontalDisplacement.x, dz = horizontalDisplacement.z;
    const distance = Math.hypot(dx, dz);
    const segmentCount = Math.max(1, Math.ceil(distance / maxSegmentLength));
    if (segmentCount > 10000) throw new RangeError('requested movement is too large for one update');

    candidate.copy(currentPosition);
    result.blockedX = false;
    result.blockedZ = false;
    result.acceptedSteps = 0;
    result.attemptedSteps = 0;

    function attempt(axis, delta) {
      if (Math.abs(delta) < 1e-10) return;
      result.attemptedSteps++;
      step.copy(candidate);
      if (axis === 'x') step.x += delta;
      else step.z += delta;

      const footY = candidate.y - eyeHeight;
      const spawn = findWalkableSpawn(THREE, {
        x: step.x,
        z: step.z,
        groundRoots,
        eyeHeight,
        maxSlopeDegrees,
        rayTop: footY + maxStepUp + 0.01,
        rayBottom: footY - maxStepDown - 0.01,
        isCandidateClear
      });
      if (!spawn) {
        if (axis === 'x') result.blockedX = true;
        else result.blockedZ = true;
        return;
      }
      candidate.copy(spawn.position);
      result.acceptedSteps++;
    }

    for (let index = 0; index < segmentCount; index++) {
      const fraction = 1 / segmentCount;
      attempt('x', dx * fraction);
      attempt('z', dz * fraction);
    }

    result.position.copy(candidate);
    result.movedDistance = Math.hypot(candidate.x - currentPosition.x, candidate.z - currentPosition.z);
    return result;
  }

  return { move };
}
