/** Inspect emitted local-space triangle data before refining or distributing a generator.
 * expectedDirection is valid only when every inspected face has that intended facing
 * (for example, +Y for a single-valued heightfield). Split caps/walls into separate
 * audits. For a curved/deformed patch, expectedDirections supplies one xyz reference
 * per vertex in emitted space. Derive it independently from the face winding/normals,
 * e.g. a mapped inner-to-outer thickness displacement. Audit only applicable faces.
 * Neither mode certifies watertightness, self-intersection or visual quality.
 */
export function auditTriangles({ positions, indices = null, expectedDirection = null, expectedDirections = null, relativeAreaTolerance = 1e-10 }) {
  if (!positions || positions.length % 3 || (indices && indices.length % 3)) throw new Error('Triangle arrays require complete xyz vertices and index triplets');
  if (!Number.isFinite(relativeAreaTolerance) || relativeAreaTolerance < 0) throw new Error('relativeAreaTolerance must be finite and nonnegative');
  if (expectedDirections !== null && expectedDirection !== null) throw new Error('Choose a global direction or per-vertex expectedDirections');
  if (expectedDirections !== null && expectedDirections.length !== positions.length) throw new Error('expectedDirections must contain one xyz vector per vertex');
  let direction = null;
  if (expectedDirection) {
    const length = Math.hypot(...expectedDirection);
    if (expectedDirection.length !== 3 || !Number.isFinite(length) || length === 0) throw new Error('expectedDirection must be a finite nonzero xyz vector');
    direction = expectedDirection.map(value => value / length);
  }
  const vertexCount = positions.length / 3;
  if (!indices && vertexCount % 3) throw new Error('Nonindexed data requires three vertices per triangle');
  const count = indices ? indices.length / 3 : vertexCount / 3;
  const result = { triangles: count, valid: 0, invalid: 0, degenerate: 0, aligned: 0, opposed: 0, tangent: 0 };
  for (let triangle = 0; triangle < count; triangle++) {
    const ids = [0, 1, 2].map(corner => indices ? indices[triangle * 3 + corner] : triangle * 3 + corner);
    if (ids.some(id => !Number.isInteger(id) || id < 0 || id >= vertexCount)) { result.invalid++; continue; }
    const [a, b, c] = ids.map(id => Array.from(positions.slice(id * 3, id * 3 + 3)));
    if ([...a, ...b, ...c].some(value => !Number.isFinite(value))) { result.invalid++; continue; }
    const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    const maxEdgeSquared = Math.max(u.reduce((sum, value) => sum + value * value, 0), v.reduce((sum, value) => sum + value * value, 0), c.reduce((sum, value, axis) => sum + (value - b[axis]) ** 2, 0));
    if (length <= relativeAreaTolerance * maxEdgeSquared) { result.degenerate++; continue; }
    let faceDirection = direction;
    if (expectedDirections !== null) {
      const sum = [0, 0, 0];
      for (const id of ids) {
        const ref = Array.from(expectedDirections.slice(id * 3, id * 3 + 3));
        const refLength = Math.hypot(...ref);
        if (!Number.isFinite(refLength) || refLength === 0) throw new Error('Referenced expectedDirections must be finite nonzero vectors');
        ref.forEach((value, axis) => { sum[axis] += value; });
      }
      const refLength = Math.hypot(...sum);
      if (!Number.isFinite(refLength) || refLength === 0) throw new Error('Triangle reference directions cancel; refine or reconsider this patch');
      faceDirection = sum.map(value => value / refLength);
    }
    result.valid++;
    if (faceDirection) {
      const dot = n.reduce((sum, value, axis) => sum + value / length * faceDirection[axis], 0);
      if (dot > 1e-8) result.aligned++;
      else if (dot < -1e-8) result.opposed++;
      else result.tangent++;
    }
  }
  return result;
}
