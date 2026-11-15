/**
 * Reusable third-person follow-camera boom solver for Three.js r187.
 * It tests the requested boom plus caller-selected safe detours against final
 * world-space occluder meshes. It does not move the actor or smooth the camera.
 */
export function createFollowCameraSolver(THREE, {
  occluders,
  up = [0, 1, 0],
  volumeRadius = 0.2,
  skin = 0.24,
  minDistance = 0.8,
  detours = []
} = {}) {
  if (String(THREE?.REVISION) !== '187') throw new Error('Follow camera solver requires Three.js r187');
  if (!Array.isArray(occluders) || occluders.some(o => !o?.isObject3D)) throw new Error('occluders must be Object3D[]');
  for (const [value, name] of [[volumeRadius, 'volumeRadius'], [skin, 'skin'], [minDistance, 'minDistance']]) {
    if (!Number.isFinite(value) || value < 0 || (name === 'minDistance' && value === 0)) throw new Error(`${name} is invalid`);
  }
  if (!Array.isArray(up) || up.length !== 3 || !up.every(Number.isFinite) || Math.hypot(...up) < 1e-8) throw new Error('up must be a nonzero xyz vector');
  if (!Array.isArray(detours) || detours.some(v => !Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite))) throw new Error('detours must be finite xyz offsets');

  const upAxis = new THREE.Vector3(...up).normalize();
  const offsets = [new THREE.Vector3(), ...detours.map(v => new THREE.Vector3(...v))];
  const raycaster = new THREE.Raycaster();
  const hits = [];
  const pivotV = new THREE.Vector3(), desiredV = new THREE.Vector3(), endpoint = new THREE.Vector3();
  const direction = new THREE.Vector3(), candidateDirection = new THREE.Vector3(), rayDirection = new THREE.Vector3(), right = new THREE.Vector3(), cameraUp = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3(), sampleEndpoint = new THREE.Vector3(), candidatePosition = new THREE.Vector3();
  const result = {
    position: new THREE.Vector3(),
    requestedDistance: 0,
    actualDistance: 0,
    candidateIndex: 0,
    blocked: false,
    detoured: false,
    tooClose: false,
    obstacle: null,
    primaryObstacle: null
  };

  function sweep(pivot, cameraEndpoint) {
    pivotV.copy(pivot); desiredV.copy(cameraEndpoint);
    const requestedDistance = pivotV.distanceTo(desiredV);
    if (!Number.isFinite(requestedDistance) || requestedDistance < minDistance) throw new Error('desired boom is shorter than minDistance');
    let best = null, primaryObstacle = null;

    for (let candidateIndex = 0; candidateIndex < offsets.length; candidateIndex++) {
      endpoint.copy(desiredV).add(offsets[candidateIndex]);
      direction.subVectors(endpoint, pivotV);
      const length = direction.length();
      if (length < 1e-8) continue;
      direction.multiplyScalar(1 / length);
      candidateDirection.copy(direction);
      right.crossVectors(upAxis, direction);
      if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
      else right.normalize();
      cameraUp.crossVectors(direction, right).normalize();
      let safeDistance = length, obstacle = null;

      // Five parallel rays approximate the camera's swept cross-section.
      for (const [side, vertical] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        rayOrigin.copy(pivotV).addScaledVector(right, side * volumeRadius).addScaledVector(cameraUp, vertical * volumeRadius);
        sampleEndpoint.copy(endpoint).addScaledVector(right, side * volumeRadius).addScaledVector(cameraUp, vertical * volumeRadius);
        rayDirection.subVectors(sampleEndpoint, rayOrigin).normalize();
        raycaster.set(rayOrigin, rayDirection);
        raycaster.near = 0;
        raycaster.far = length;
        hits.length = 0;
        raycaster.intersectObjects(occluders, true, hits);
        const hit = hits[0];
        if (hit && hit.distance < safeDistance) {
          safeDistance = Math.max(0, hit.distance - skin);
          obstacle = hit.object;
        }
      }

      if (candidateIndex === 0) {
        primaryObstacle = obstacle;
      }
      const offsetPenalty = endpoint.distanceTo(desiredV) * 1.2;
      const score = Math.min(safeDistance, requestedDistance) - offsetPenalty;
      if (!best || score > best.score) {
        candidatePosition.copy(pivotV).addScaledVector(candidateDirection, safeDistance);
        best = { score, safeDistance, candidateIndex, obstacle, position: candidatePosition.clone(), length };
      }
    }

    if (!best) throw new Error('no valid follow-camera boom candidate');
    result.position.copy(best.position);
    result.requestedDistance = requestedDistance;
    result.actualDistance = best.safeDistance;
    result.candidateIndex = best.candidateIndex;
    result.blocked = best.safeDistance < best.length - 1e-4;
    result.detoured = best.candidateIndex > 0;
    result.tooClose = best.safeDistance < minDistance;
    result.obstacle = best.obstacle;
    result.primaryObstacle = primaryObstacle;
    return result;
  }

  return { solve: sweep };
}
