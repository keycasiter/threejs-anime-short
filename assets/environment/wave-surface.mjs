/**
 * Analytic multi-wave displacement, not a fluid solver or water shading system.
 * x/z are REST (Lagrangian) parameters in the root's local frame, in metres;
 * time is absolute seconds. Each wave reads the same undisplaced parameters.
 * A fixed rest anchor follows horizontal displacement too. This is NOT height
 * sampling at fixed world XZ: that requires inverting the horizontal mapping.
 *
 * sampleRest includes waterLevel in local Y. If root is transformed, callers
 * convert positions with localToWorld and normals with its normal matrix.
 * Single-point attachment does not model buoyancy or a large object's support.
 * Samples agree with mesh vertices; between vertices the rendered triangles
 * linearly approximate the analytic curve, with larger errors on coarse grids.
 * No reflection, refraction, foam, micro-normal or shoreline model is included.
 *
 * Factory owns geometry only, borrows the REQUIRED material, and copies waves.
 * Position and analytic normal buffers share one evaluator. Absolute-time seeks
 * and setters update existing buffers and actual bounds without integration.
 */
const TAU = 2 * Math.PI;
const finite = (value, name) => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
};

function prepareWaves(waves) {
  if (!Array.isArray(waves)) throw new TypeError('waves must be an array');
  let steepness = 0;
  return waves.map(w => {
    if (!w || !Array.isArray(w.direction) || w.direction.length !== 2 || !w.direction.every(Number.isFinite)) throw new TypeError('finite xz direction required');
    const length = Math.hypot(...w.direction), A = w.amplitude, wavelength = w.wavelength, Q = w.q ?? 0;
    if (!(length > 0 && Number.isFinite(length) && Number.isFinite(A) && A >= 0 && Number.isFinite(wavelength) && wavelength > 0 && Number.isFinite(Q))) throw new RangeError('invalid wave');
    const k = TAU / wavelength, omega = w.omega ?? Math.sqrt(9.81 * k), phase = w.phase ?? 0;
    const ak = A * k, qak = Q * ak, qa = Q * A;
    if (![k, omega, phase, ak, qak, qa].every(Number.isFinite)) throw new RangeError('invalid wave phase/frequency or scale');
    steepness += Math.abs(qak);
    if (steepness >= 1) throw new RangeError('horizontal wave mapping may fold');
    return {ux: w.direction[0] / length, uz: w.direction[1] / length, A, k, omega, phase, ak, qak, qa};
  });
}

const result = () => ({position: [0, 0, 0], dx: [1, 0, 0], dz: [0, 0, 1], normal: [0, 1, 0]});
function evaluate(x, z, time, waves, out) {
  const p = out.position, dx = out.dx, dz = out.dz, n = out.normal;
  p[0] = x; p[1] = 0; p[2] = z;
  dx[0] = 1; dx[1] = 0; dx[2] = 0;
  dz[0] = 0; dz[1] = 0; dz[2] = 1;
  for (const w of waves) {
    // Reduce each temporal phase before multiplying to avoid overflow on seeks.
    const temporal = w.omega === 0 ? 0 : (time % (TAU / Math.abs(w.omega))) * w.omega;
    const theta = w.k * (w.ux * x + w.uz * z) - temporal + w.phase;
    finite(theta, 'computed wave phase');
    const s = Math.sin(theta), c = Math.cos(theta);
    p[0] += w.qa * w.ux * c; p[1] += w.A * s; p[2] += w.qa * w.uz * c;
    dx[0] -= w.qak * w.ux * w.ux * s; dx[1] += w.ak * w.ux * c; dx[2] -= w.qak * w.ux * w.uz * s;
    dz[0] -= w.qak * w.ux * w.uz * s; dz[1] += w.ak * w.uz * c; dz[2] -= w.qak * w.uz * w.uz * s;
  }
  // Total derivatives first, THEN dz cross dx: flat surface has +Y normal.
  n[0] = dz[1] * dx[2] - dz[2] * dx[1];
  n[1] = dz[2] * dx[0] - dz[0] * dx[2];
  n[2] = dz[0] * dx[1] - dz[1] * dx[0];
  const length = Math.hypot(...n);
  if (!(length > 0 && Number.isFinite(length)) || !p.every(Number.isFinite)) throw new RangeError('degenerate or nonfinite wave surface');
  for (let i = 0; i < 3; i++) n[i] = n[i] === 0 ? 0 : n[i] / length;
  return out;
}

/** Returns fresh {position, dx, dz, normal} XYZ arrays, with baseline Y = 0. */
export function sampleWaveSurface(x, z, time, waves) {
  finite(x, 'rest x'); finite(z, 'rest z'); finite(time, 'time');
  return evaluate(x, z, time, prepareWaves(waves), result());
}

/** One centred CPU grid. Dimensions are metres; tessellation counts are cells. */
export function createWaveSurface(T, {
  width = 10, depth = 10, segmentsX = 32, segmentsZ = 32,
  waves = [], waterLevel = 0, material,
} = {}) {
  for (const [name, value] of [['width', width], ['depth', depth]]) {
    finite(value, name);
    if (value <= 0 || value > 1e6) throw new RangeError(`${name} must be in (0, 1000000]`);
  }
  for (const [name, value] of [['segmentsX', segmentsX], ['segmentsZ', segmentsZ]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  }
  const count = (segmentsX + 1) * (segmentsZ + 1);
  if (!Number.isSafeInteger(count) || count > 1000000) throw new RangeError('wave grid must have at most 1000000 vertices');
  finite(waterLevel, 'waterLevel');
  if (!material?.isMaterial) throw new TypeError('material is required and borrowed');
  let prepared = prepareWaves(waves), time = 0, level = waterLevel, disposed = false;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const rest = new Float64Array(count * 2), indices = [];
  for (let iz = 0; iz <= segmentsZ; iz++) for (let ix = 0; ix <= segmentsX; ix++) {
    const index = iz * (segmentsX + 1) + ix;
    rest[index * 2] = width * (ix / segmentsX - .5);
    rest[index * 2 + 1] = depth * (iz / segmentsZ - .5);
    if (ix < segmentsX && iz < segmentsZ) {
      const a = index, b = a + 1, c = a + segmentsX + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new T.BufferGeometry();
  const positionAttribute = new T.BufferAttribute(positions, 3), normalAttribute = new T.BufferAttribute(normals, 3);
  positionAttribute.setUsage(T.DynamicDrawUsage); normalAttribute.setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute); geometry.setAttribute('normal', normalAttribute); geometry.setIndex(indices);
  const mesh = new T.Mesh(geometry, material), root = new T.Group();
  root.name = 'WaveSurface'; mesh.name = 'WaveSurfaceMesh'; root.add(mesh);
  const scratch = result();
  function assertLive() { if (disposed) throw new Error('wave surface is disposed'); }
  function render() {
    for (let i = 0; i < count; i++) {
      const s = evaluate(rest[i * 2], rest[i * 2 + 1], time, prepared, scratch);
      for (let j = 0; j < 3; j++) {
        const value = s.position[j] + (j === 1 ? level : 0);
        if (!Number.isFinite(Math.fround(value))) throw new RangeError('wave position exceeds Float32 geometry range');
        positions[i * 3 + j] = value; normals[i * 3 + j] = s.normal[j];
      }
    }
    positionAttribute.needsUpdate = true; normalAttribute.needsUpdate = true;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  }
  function update(nextTime) {
    assertLive(); finite(nextTime, 'time');
    const previous = time; time = nextTime;
    try { render(); } catch (error) { time = previous; render(); throw error; }
  }
  function sampleRest(x, z, atTime = time) {
    assertLive(); finite(x, 'rest x'); finite(z, 'rest z'); finite(atTime, 'time');
    const s = evaluate(x, z, atTime, prepared, result()); s.position[1] += level; return s;
  }
  function setWaves(next) {
    assertLive(); const nextPrepared = prepareWaves(next), previous = prepared;
    prepared = nextPrepared;
    try { render(); } catch (error) { prepared = previous; render(); throw error; }
  }
  function setWaterLevel(next) {
    assertLive(); finite(next, 'waterLevel');
    const previous = level; level = next;
    try { render(); } catch (error) { level = previous; render(); throw error; }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; root.visible = false; root.removeFromParent(); geometry.dispose();
  }
  try { render(); } catch (error) { dispose(); throw error; }
  return {root, mesh, sampleRest, update, setWaves, setWaterLevel, dispose};
}
