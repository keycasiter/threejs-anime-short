/** Raycast actual support meshes and construct world-space attachment frames.
 * Inject the scene's THREE namespace. Y-up/+Z-forward is the asset convention,
 * not a restriction on the support surface. Verified with Three r180.
 * This locates a point; it does not solve footprint support, collision or IK.
 */
export function createSurfaceSampler(THREE, objects) {
  const supports = Array.isArray(objects) ? objects : [objects];
  const ray = new THREE.Raycaster();
  const instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  return function sample(origin, direction, {near = 0, far = Infinity} = {}) {
    if (direction.lengthSq() === 0) throw new Error('Surface ray direction must be nonzero');
    if (near < 0 || far < near) throw new Error('Invalid surface ray interval');
    for (const support of supports) support.updateWorldMatrix(true, true);
    ray.set(origin, direction.clone().normalize());
    ray.near = near; ray.far = far;
    const hit = ray.intersectObjects(supports, true)[0];
    if (!hit || !hit.face) return null;
    world.copy(hit.object.matrixWorld);
    if (hit.instanceId !== undefined) {
      hit.object.getMatrixAt(hit.instanceId, instance);
      world.multiply(instance);
    }
    normalMatrix.getNormalMatrix(world);
    return {
      point: hit.point.clone(),
      normal: hit.face.normal.clone().applyNormalMatrix(normalMatrix),
      distance: hit.distance,
      object: hit.object,
      instanceId: hit.instanceId,
      uv: hit.uv?.clone()
    };
  };
}

/** Right-handed WORLD matrix: local +Y=up, +Z=projected forward.
 * Defaults to the geometric surface normal. Pass gravity up for upright assets.
 * offset is along the surface normal, in world units. Parallel forward uses a
 * deterministic fallback, not parallel transport for a deforming path.
 * For a parented root use inverse(parent.matrixWorld) * this matrix; retain the
 * matrix directly if nonuniform parent scaling introduces shear.
 */
export function surfaceFrame(THREE, hit, {
  up = hit.normal, forward = new THREE.Vector3(0, 0, 1), offset = 0
} = {}) {
  if (up.lengthSq() === 0 || hit.normal.lengthSq() === 0) throw new Error('Surface frame normal/up must be nonzero');
  const y = up.clone().normalize();
  const z = forward.clone().addScaledVector(y, -forward.dot(y));
  if (z.lengthSq() < 1e-12) {
    const axis = Math.abs(y.x) < .8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    z.copy(axis).addScaledVector(y, -axis.dot(y));
  }
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const point = hit.point.clone().addScaledVector(hit.normal.clone().normalize(), offset);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(point);
}
