/** Small geometry builders. Inject the caller's THREE namespace (verified with r180).
 * Coordinates/lengths must use one consistent unit. No renderer or external assets.
 */
const finite = Number.isFinite;
function material(value, fallback) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < 0) throw new Error('Material index must be a nonnegative integer');
  return n;
}
function profile(points, name) {
  if (!Array.isArray(points) || points.length < 2) throw new Error(`${name} profile needs at least two points`);
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[i - 1];
    if (!p || !finite(p.r) || p.r <= 0 || !finite(p.y) ||
      (q && (p.y < q.y || (p.y === q.y && p.r === q.r)))) {
      throw new Error(`${name} profile requires positive radius, finite coordinates and nondecreasing y without duplicate points`);
    }
  }
  if (!(points.at(-1).y > points[0].y)) throw new Error(`${name} profile needs positive height`);
  // A horizontal shoulder may have several points, but cannot double back on itself.
  for (let i = 2; i < points.length; i++) {
    const a = points[i - 2], b = points[i - 1], c = points[i];
    if (a.y === b.y && b.y === c.y && (b.r - a.r) * (c.r - b.r) < 0) throw new Error(`${name} profile intersects itself`);
  }
}
function radiiAt(points, y) {
  const radii = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (y < a.y || y > b.y) continue;
    if (a.y === b.y) radii.push(a.r, b.r);
    else radii.push(a.r + (b.r - a.r) * (y - a.y) / (b.y - a.y));
  }
  return radii;
}

/** Revolve independently designed outer/inner piecewise-linear profiles about +Y.
 * Profile: [{r,y,crease?}, ...], y nondecreasing, r>0; equal y makes a shoulder.
 * Both profiles span the same y interval and must stay strictly separated.
 * Set crease:true on a profile vertex to retain a hard fold; other joins are smooth.
 * Inner profile is NOT an automatic constant-normal-thickness offset.
 * endConnections connects each pair of endpoint rings, leaving the axial bore open.
 * Same-height endpoint shoulders may adjoin an end ring, but may not fold back
 * over its annular area. Disable that end connection for an explicitly open end.
 * UV u=0/1 is duplicated with identical analytic normals. Do not call
 * computeVertexNormals(): it would replace these intentional smoothing decisions.
 */
export function createRevolvedShell(THREE, {
  outer, inner, radialSegments = 64, endConnections = {}, materialIndices = {}
} = {}) {
  profile(outer, 'outer'); profile(inner, 'inner');
  if (!Number.isInteger(radialSegments) || radialSegments < 3 || radialSegments > 4096) throw new Error('radialSegments must be integer 3..4096');
  if (outer[0].y !== inner[0].y || outer.at(-1).y !== inner.at(-1).y) throw new Error('Inner and outer profile endpoints must share y');
  for (const y of new Set([...outer, ...inner].map(p => p.y))) {
    if (!(Math.min(...radiiAt(outer, y)) > Math.max(...radiiAt(inner, y)))) throw new Error('Inner and outer profiles intersect or have no clearance');
  }
  // The connector annulus must adjoin, not overlap, a same-height shoulder.
  // At either endpoint an outer return or inner return would double-cover an
  // annular patch with opposite winding (zero-thickness flange).
  for (const key of ['start', 'end']) {
    if (endConnections[key] === false) continue;
    const a = outer[key === 'start' ? 0 : outer.length - 1], b = inner[key === 'start' ? 0 : inner.length - 1];
    if (a.r > Math.min(...radiiAt(outer, a.y)) || b.r < Math.max(...radiiAt(inner, b.y))) {
      throw new Error(`${key} end connection overlaps a return shoulder; redesign the endpoint or disable this end connection`);
    }
  }
  const geometry = new THREE.BufferGeometry(), positions = [], normals = [], uvs = [], indices = [];
  const emit = (r, y, j, n, v) => {
    // Exact seam position and normal, rather than relying on sin(2π) roundoff.
    const angle = j === radialSegments ? 0 : j / radialSegments * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    positions.push(r * c, y, r * s); normals.push(n[0] * c, n[1], n[0] * s); uvs.push(j / radialSegments, v);
  };
  const triangle = (a, b, c, reverse) => indices.push(...(reverse ? [a, c, b] : [a, b, c]));
  function side(points, inward, materialIndex) {
    const start = indices.length, arc = [0], slopes = [];
    for (let i = 1; i < points.length; i++) {
      const dr = points[i].r - points[i - 1].r, dy = points[i].y - points[i - 1].y;
      const len = Math.hypot(dr, dy); arc.push(arc.at(-1) + len); slopes.push([dy / len, -dr / len]);
    }
    const normalAt = (point, band) => {
      let n = slopes[band];
      if (point > 0 && point < points.length - 1 && !points[point].crease) {
        const a = slopes[point - 1], b = slopes[point], length = Math.hypot(a[0] + b[0], a[1] + b[1]);
        if (!length) throw new Error('Profile reverses direction at smooth join');
        n = [(a[0] + b[0]) / length, (a[1] + b[1]) / length];
      }
      return inward ? [-n[0], -n[1]] : n;
    };
    for (let i = 0; i < points.length - 1; i++) {
      const base = positions.length / 3;
      for (let row = 0; row < 2; row++) {
        const k = i + row, p = points[k], n = normalAt(k, i);
        for (let j = 0; j <= radialSegments; j++) emit(p.r, p.y, j, n, arc[k] / arc.at(-1));
      }
      for (let j = 0; j < radialSegments; j++) {
        const a = base + j, b = a + 1, c = a + radialSegments + 1, d = c + 1;
        triangle(a, c, b, inward); triangle(b, c, d, inward);
      }
    }
    geometry.addGroup(start, indices.length - start, materialIndex);
  }
  side(outer, false, material(materialIndices.outer, 0));
  side(inner, true, material(materialIndices.inner, 1));
  for (const [key, index, sign] of [['start', 0, -1], ['end', outer.length - 1, 1]]) {
    if (endConnections[key] === false) continue;
    const start = indices.length, base = positions.length / 3;
    const a = outer[index], b = inner[key === 'start' ? 0 : inner.length - 1];
    for (const [r, v] of [[a.r, 1], [b.r, 0]]) for (let j = 0; j <= radialSegments; j++) emit(r, a.y, j, [0, sign], v);
    for (let j = 0; j < radialSegments; j++) {
      const o = base + j, n = o + radialSegments + 1;
      triangle(o, n, o + 1, sign < 0); triangle(o + 1, n, n + 1, sign < 0);
    }
    geometry.addGroup(start, indices.length - start, material(materialIndices[key], 2));
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a, b, p) => cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function contains(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function ringEdges(ring, fn) {for (let i = 0; i < ring.length; i++) fn(ring[i], ring[(i + 1) % ring.length], i);}
function validateRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3 || ring.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(finite))) throw new Error('Polygon needs at least three finite [x,y] points');
  let area = 0;
  ringEdges(ring, (a, b, i) => {
    if (a[0] === b[0] && a[1] === b[1]) throw new Error('Polygon duplicate consecutive point; omit repeated closing point');
    if (cross(ring[(i + ring.length - 1) % ring.length], a, b) === 0) throw new Error('Polygon collinear corner; simplify the contour');
    area += a[0] * b[1] - b[0] * a[1];
    ringEdges(ring, (c, d, j) => {if (j > i + 1 && !(i === 0 && j === ring.length - 1) && intersects(a, b, c, d)) throw new Error('Polygon self intersection');});
  });
  if (!area) throw new Error('Polygon zero area');
}
function signedArea(ring) {
  return ring.reduce((sum, a, i) => {const b = ring[(i + 1) % ring.length];return sum + a[0] * b[1] - b[0] * a[1];}, 0) / 2;
}
function validateLayout(rings) {
  for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
    ringEdges(rings[i], (a, b) => ringEdges(rings[j], (c, d) => {
      if (intersects(a, b, c, d)) throw new Error('Hole intersects another hole or outline');
    }));
    if (i === 0 ? !contains(rings[0], rings[j][0]) : contains(rings[i], rings[j][0]) || contains(rings[j], rings[i][0])) throw new Error('Hole must be strictly inside outline and disjoint from other holes');
  }
}
// CCW ring offset, positive distance moves inward. Formula matches r180's
// adjacent parallel-line intersection and sqrt(2) spike limit for convex rings.
function offsetConvex(ring, distance) {
  return ring.map((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length];
    const l0 = Math.hypot(p[0] - prev[0], p[1] - prev[1]), l1 = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const n0 = [-(p[1] - prev[1]) / l0, (p[0] - prev[0]) / l0], n1 = [-(next[1] - p[1]) / l1, (next[0] - p[0]) / l1];
    const denominator = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    let x = (n0[0] + n1[0]) / denominator, y = (n0[1] + n1[1]) / denominator;
    const shrink = Math.max(1, Math.hypot(x, y) / Math.SQRT2); x /= shrink; y /= shrink;
    return [p[0] + distance * x, p[1] + distance * y];
  });
}

/** Solid polygon plate in XY, finished z=0..depth (bevel included).
 * outline/holes: simple, non-touching, unclosed arrays of [x,y] corners.
 * No-bevel accepts simple concave rings. Bevel is restricted to convex rings,
 * with actual offset contour/clearance validation; use a DCC/CAD route for arbitrary
 * offsets, fillets, curved profiles or complex near-touching topology.
 * Input outline is the maximum XY silhouette; bevel recesses the face contour,
 * expands the hole mouths and leaves a constant bore through the straight body.
 * faces material = front/back; edges = all outer/inner sides AND bevel faces.
 */
export function createPerforatedPlate(THREE, {
  outline, holes = [], depth, bevel = {}, materialIndices = {}
} = {}) {
  if (!finite(depth) || depth <= 0) throw new Error('Plate depth must be positive');
  if (!Array.isArray(holes)) throw new Error('holes must be an array');
  const inputRings = [outline, ...holes]; inputRings.forEach(validateRing);
  validateLayout(inputRings);
  // Normalize every ring independently: r180 only normalizes hole winding when
  // it also reverses the outline. Caller ring orientation must not change a bore.
  const rings = inputRings.map(r => signedArea(r) < 0 ? [...r].reverse() : [...r]);
  const enabled = bevel.enabled ?? true;
  const size = bevel.size ?? depth * .08, thickness = bevel.thickness ?? depth * .08, segments = bevel.segments ?? 3;
  if (enabled) {
    if (!finite(size) || size <= 0 || !finite(thickness) || thickness <= 0 || thickness >= depth / 2 || !Number.isInteger(segments) || segments < 1 || segments > 32) throw new Error('Bevel needs positive size/thickness, thickness < depth/2 and integer segments 1..32');
    for (const ring of rings) ringEdges(ring, (a, b, i) => {
      if (cross(a, b, ring[(i + 2) % ring.length]) <= 0) throw new Error('Bevel currently requires convex polygon rings');
    });
    const offset = rings.map((ring, i) => offsetConvex(ring, i === 0 ? size : -size));
    try {
      offset.forEach(validateRing);
      for (let k = 0; k < offset.length; k++) {
        const before = rings[k], after = offset[k];
        if (!(signedArea(after) > 0)) throw new Error('offset inverted');
        ringEdges(after, (a, b, i) => {
          const c = before[i], d = before[(i + 1) % before.length];
          if (!((b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1]) > 0)) throw new Error('offset edge collapsed');
        });
      }
      validateLayout(offset);
    } catch (error) {throw new Error(`Bevel offset collapses or intersects: ${error.message}`);}
  }

  const path = (ring, Type) => {const p = new Type();p.moveTo(...ring[0]);for (const xy of ring.slice(1)) p.lineTo(...xy);p.closePath();return p;};
  const shape = path([...rings[0]].reverse(), THREE.Shape); shape.holes = rings.slice(1).map(r => path(r, THREE.Path));
  const g = new THREE.ExtrudeGeometry(shape, {depth: enabled ? depth - 2 * thickness : depth, steps: 1,
    bevelEnabled: enabled, bevelSize: size, bevelThickness: thickness, bevelSegments: segments, bevelOffset: -size});
  if (enabled) g.translate(0, 0, thickness);
  for (const group of g.groups) group.materialIndex = group.materialIndex === 0 ? material(materialIndices.faces, 0) : material(materialIndices.edges, 1);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
