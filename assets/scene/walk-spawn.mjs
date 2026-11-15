/**
 * Resolve a first-person spawn from final, walkable Three.js surfaces.
 * Collision clearance beyond the ground/slope checks is delegated to the
 * caller because each project has different body and blocker semantics.
 */
export function findWalkableSpawn(THREE, {
  x,
  z,
  groundRoots,
  eyeHeight = 1.65,
  maxSlopeDegrees = 32,
  rayTop = 200,
  rayBottom = -200,
  isCandidateClear,
} = {}) {
  const finite = Number.isFinite;
  if (!THREE?.Vector3 || !THREE?.Raycaster || !THREE?.Matrix3) {
    throw new TypeError('Pass the active THREE namespace (Vector3, Raycaster, Matrix3).');
  }
  if (!finite(x) || !finite(z)) throw new TypeError('x and z must be finite world coordinates.');
  if (!Array.isArray(groundRoots) || groundRoots.length === 0) {
    throw new TypeError('groundRoots must contain the final walkable surface roots.');
  }
  if (groundRoots.some((root) => !root?.isObject3D)) {
    throw new TypeError('Every ground root must be a Three.js Object3D.');
  }
  if (!finite(eyeHeight) || eyeHeight <= 0) throw new RangeError('eyeHeight must be greater than zero.');
  if (!finite(maxSlopeDegrees) || maxSlopeDegrees < 0 || maxSlopeDegrees >= 90) {
    throw new RangeError('maxSlopeDegrees must be in [0, 90).');
  }
  if (!finite(rayTop) || !finite(rayBottom) || rayTop <= rayBottom) {
    throw new RangeError('rayTop must be greater than rayBottom.');
  }
  if (isCandidateClear !== undefined && typeof isCandidateClear !== 'function') {
    throw new TypeError('isCandidateClear must be a function when supplied.');
  }

  for (const root of groundRoots) root?.updateWorldMatrix?.(true, true);
  const up = new THREE.Vector3(0, 1, 0);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(x, rayTop, z),
    new THREE.Vector3(0, -1, 0),
    0,
    rayTop - rayBottom,
  );
  const minUpDot = Math.cos(THREE.MathUtils.degToRad(maxSlopeDegrees));
  const visible = (object) => {
    for (let current = object; current; current = current.parent) if (!current.visible) return false;
    return true;
  };

  for (const hit of raycaster.intersectObjects(groundRoots, true)) {
    if (!hit.face || !visible(hit.object) || hit.object.userData?.walkable === false) continue;
    const normal = hit.face.normal.clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .normalize();
    if (normal.dot(up) < minUpDot) continue;

    const groundPoint = hit.point.clone();
    const position = groundPoint.clone().addScaledVector(up, eyeHeight);
    const slopeDegrees = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(normal.dot(up), -1, 1)));
    const candidate = { position, groundPoint, surfaceNormal: normal, slopeDegrees, eyeHeight, hit };
    if (isCandidateClear && !isCandidateClear(candidate)) continue;
    return candidate;
  }
  return null;
}
