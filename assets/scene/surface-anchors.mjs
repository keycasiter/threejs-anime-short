/** Raycast actual support meshes and construct world-space attachment frames.
 * Inject the scene's THREE namespace. Y-up/+Z-forward is the asset convention,
 * not a restriction on the support surface. Verified with Three r187.
 * Point sampling, finite patch qualification and attachment frames are separate
 * operations. None establishes continuous footprint support, collision or IK.
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

/** Qualify supplied local XZ footprint samples against a finite world-space patch.
 * All lengths/offsets are world units. The caller chooses the reference plane,
 * sampling density and design limits; this neither fits nor deforms an asset.
 * The frame's +Y follows the chosen normal. Give the body its own growth/mounting
 * frame when that differs. First exposed hits are used, including instance normals.
 */
export function createSurfacePatchSampler(THREE, objects) {
  const hosts = Array.isArray(objects) ? objects : [objects];
  if (!hosts.length || hosts.some(o => !o?.isObject3D)) throw new Error('Actual host objects required');
  const sample = createSurfaceSampler(THREE, hosts);
  const finiteVector = v => !!v?.isVector3 && v.toArray().every(Number.isFinite);
  return function patch({origin, normal, footprint, above, below, maxOffset, maxNormalAngleDeg, forward = new THREE.Vector3(0,0,1)}) {
    if (!finiteVector(origin) || !finiteVector(normal) || normal.lengthSq() === 0 || !finiteVector(forward) || forward.lengthSq() === 0) throw new Error('Finite origin, nonzero normal and forward required');
    if (![above,below,maxOffset,maxNormalAngleDeg].every(Number.isFinite) || above <= 0 || below <= 0 || maxOffset < 0 || maxNormalAngleDeg < 0 || maxNormalAngleDeg >= 90) throw new Error('Explicit finite patch limits required');
    if (!Array.isArray(footprint) || !footprint.length || footprint.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) throw new Error('Finite local XZ footprint samples required');
    const n = normal.clone().normalize(), matrix = surfaceFrame(THREE, {point:origin, normal:n}, {forward});
    const tangent = new THREE.Vector3().setFromMatrixColumn(matrix,0), bitangent = new THREE.Vector3().setFromMatrixColumn(matrix,2);
    const frame = {matrix, origin:origin.clone(), normal:n, tangent, bitangent}, contacts = [];
    const direction = n.clone().negate(), minDot = Math.cos(THREE.MathUtils.degToRad(maxNormalAngleDeg));
    let maxAbsOffset = 0, maxNormalDeviationDeg = 0;
    const finish = (status, reason) => ({status, reason, contacts, maxAbsOffset, maxNormalDeviationDeg, frame,
      scope:'Supplied finite footprint samples only; not continuous support, allowed-region, clearance, deformation or visual acceptance.'});
    for (const [x,z] of footprint) {
      const expected = origin.clone().addScaledVector(tangent,x).addScaledVector(bitangent,z);
      const hit = sample(expected.clone().addScaledVector(n,above), direction, {near:0, far:above+below});
      if (!hit) return finish('REJECT','missing-footprint');
      const dot = THREE.MathUtils.clamp(hit.normal.dot(n),-1,1), normalOffset = hit.point.clone().sub(expected).dot(n);
      const angle = THREE.MathUtils.radToDeg(Math.acos(dot));
      contacts.push({...hit, offsetXZ:[x,z], normalOffset});
      maxAbsOffset = Math.max(maxAbsOffset,Math.abs(normalOffset));
      maxNormalDeviationDeg = Math.max(maxNormalDeviationDeg,angle);
      if (dot < minDot) return finish('REJECT','normal-mismatch');
      if (Math.abs(normalOffset) > maxOffset) return finish('REJECT','excess-offset');
    }
    return finish('ACCEPT','qualified-local-footprint');
  };
}

/** Y-up bearing construction from actual lower and upper meshes.
 * Supply both footprint offset sets; center-only defaults locate a span, not an
 * area bearing. Missing rays and overlapping hosts are errors, never short piles.
 * Explicit embed/inset describe intentional penetrations; verify emitted support
 * faces independently afterward. Nonvertical joints use surfaceFrame instead.
 */
export function createVerticalBearingSampler(THREE, lowerObjects, upperObjects) {
  const lowerSample = createSurfaceSampler(THREE, lowerObjects);
  const upperSample = createSurfaceSampler(THREE, upperObjects);
  return function bearing({ x, z, minY, maxY, lowerOffsets = [[0, 0]], upperOffsets = [[0, 0]], embed = 0, headInset = 0, minClearance = 0 }) {
    if (![x,z,minY,maxY,embed,headInset,minClearance].every(Number.isFinite) || maxY <= minY || Math.min(embed,headInset,minClearance) < 0) throw new Error('Invalid bearing range or offsets');
    function cast(offsets, sampler, y, direction) {
      if (!Array.isArray(offsets) || !offsets.length || offsets.some(v => !Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite))) throw new Error('Bearing footprint requires finite xz offsets');
      return offsets.map(([dx,dz]) => {
        const hit = sampler(new THREE.Vector3(x+dx,y,z+dz), direction, { far: maxY-minY });
        if (!hit) throw new Error('Bearing footprint missed a host surface');
        return hit.point.y;
      });
    }
    const lower = cast(lowerOffsets, lowerSample, maxY, new THREE.Vector3(0,-1,0));
    const upper = cast(upperOffsets, upperSample, minY, new THREE.Vector3(0,1,0));
    const clearance = Math.min(...upper)-Math.max(...lower);
    if (clearance <= 0 || clearance < minClearance) throw new Error('Bearing hosts overlap or have insufficient clearance');
    const bottomY = Math.min(...lower)-embed, topY = Math.max(...upper)+headInset;
    return { bottomY, topY, height: topY-bottomY, centerY: (topY+bottomY)/2, clearance, lowerRangeY: [Math.min(...lower),Math.max(...lower)], upperRangeY: [Math.min(...upper),Math.max(...upper)] };
  };
}
