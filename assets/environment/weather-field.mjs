/**
 * Deterministic, bounded visual rain; this is not a fluid or volumetric simulation.
 * Exposure, wetness and material response are external shared fields. Pass the same
 * roof query used by those systems when consistent shelter behavior is required.
 *
 * extent is the full [width, height, depth] centered on anchor (world units).
 * wind is [x, z] velocity and fallSpeed is positive downward velocity, units/sec.
 * Absolute time supports negative time and arbitrary seeks without integration.
 * One fixed LineSegments geometry/material is owned; update creates no resources.
 *
 * Shelter receives world x/z and returns a world roof y, or null outside its
 * footprint. Three samples per streak clip to the highest sampled roof. Uniform
 * horizontal roofs are exact; narrow footprints between samples may be missed.
 * Fine/sloping roofs require a conservative query. This does not raycast roofs,
 * occlude fog, or make splashes. Numeric seeds are reduced to unsigned 32 bits.
 */
const EMPTY_UPDATE = Object.freeze({});
const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
};
const vector = (value, size, name, minimum, maximum) => {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== size) throw new TypeError(`${name} must have ${size} components`);
  for (let i = 0; i < size; i++) {
    finite(value[i], name);
    if (value[i] < minimum || value[i] > maximum) throw new RangeError(`${name} components must be in [${minimum}, ${maximum}]`);
  }
};
const wrap = (value, span) => ((value % span) + span) % span;
// Reduce time before multiplication so even very large finite seek times stay bounded.
const travel = (time, speed, span) => speed === 0 ? 0 : (time % (span / Math.abs(speed))) * speed;

export function createWeatherField(THREE, {
  seed = 1, count = 1200, extent = [24, 14, 24], wind = [1.5, .4],
  fallSpeed = 12, color = 0xc6dbe5, opacity = .35, shelterHeightAt = null,
} = {}) {
  if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer');
  if (!Number.isInteger(count) || count < 0 || count > 100000) throw new RangeError('count must be an integer in [0, 100000]');
  vector(extent, 3, 'extent', .0001, 1000000);
  vector(wind, 2, 'wind', -1000000, 1000000);
  finite(fallSpeed, 'fallSpeed');
  if (fallSpeed <= 0 || fallSpeed > 1000000) throw new RangeError('fallSpeed must be in (0, 1000000]');
  finite(opacity, 'opacity');
  if (opacity < 0 || opacity > 1) throw new RangeError('opacity must be in [0, 1]');
  if (shelterHeightAt !== null && typeof shelterHeightAt !== 'function') throw new TypeError('shelterHeightAt must be a function or null');
  const sx = extent[0], sy = extent[1], sz = extent[2], hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const vx = wind[0], vz = wind[1];
  const positions = new Float32Array(count * 6), origins = new Float64Array(count * 3);
  let randomState = seed >>> 0;
  function random() {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let n = randomState;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  }
  for (let i = 0; i < origins.length; i++) origins[i] = random();
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  // Geometry stays local to the anchor; the fixed sphere avoids per-frame bounds work.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(hx, hy, hz));
  const material = new THREE.LineBasicMaterial({color, opacity, transparent: true, depthWrite: false});
  const root = new THREE.LineSegments(geometry, material);
  root.name = 'WeatherFieldRain';
  let time = 0, ax = 0, ay = 0, az = 0, intensity = 1, enabled = true, disposed = false;
  let activeCount = count, visibleCount = 0;
  // A short physical exposure interval gives rain direction without texture assets.
  const tx = -vx * .045, ty = fallSpeed * .045, tz = -vz * .045;
  function assertLive() {if (disposed) throw new Error('weather field is disposed');}
  function roofAt(x, z) {
    const roof = shelterHeightAt(x + ax, z + az);
    if (roof !== null) finite(roof, 'shelterHeightAt result');
    return roof === null ? -Infinity : roof - ay;
  }
  function render() {
    activeCount = Math.floor(count * intensity);
    visibleCount = 0;
    if (enabled) {
      const dx = travel(time, vx, sx), dy = travel(time, -fallSpeed, sy), dz = travel(time, vz, sz);
      for (let i = 0; i < activeCount; i++) {
        const origin = i * 3;
        let x = wrap(origins[origin] * sx + dx, sx) - hx;
        let y = wrap(origins[origin + 1] * sy + dy, sy) - hy;
        let z = wrap(origins[origin + 2] * sz + dz, sz) - hz;
        // Clip the tail to the local volume rather than drawing across a wrap seam.
        let fraction = Math.min(1, (hy - y) / ty);
        if (tx > 0) fraction = Math.min(fraction, (hx - x) / tx);
        else if (tx < 0) fraction = Math.min(fraction, (-hx - x) / tx);
        if (tz > 0) fraction = Math.min(fraction, (hz - z) / tz);
        else if (tz < 0) fraction = Math.min(fraction, (-hz - z) / tz);
        const tailX = x + tx * fraction, tailY = y + ty * fraction, tailZ = z + tz * fraction;
        if (shelterHeightAt) {
          const roof = Math.max(roofAt(x, z), roofAt((x + tailX) / 2, (z + tailZ) / 2), roofAt(tailX, tailZ));
          if (roof >= tailY) continue;
          if (roof > y) {
            const cut = (roof - y) / (tailY - y);
            x += (tailX - x) * cut; z += (tailZ - z) * cut; y = roof;
          }
        }
        const offset = visibleCount * 6;
        positions[offset] = x; positions[offset + 1] = y; positions[offset + 2] = z;
        positions[offset + 3] = tailX; positions[offset + 4] = tailY; positions[offset + 5] = tailZ;
        visibleCount++;
      }
    }
    // Clear the unused suffix too: whole buffers remain identical after arbitrary seeks.
    positions.fill(0, visibleCount * 6);
    geometry.setDrawRange(0, visibleCount * 2);
    position.needsUpdate = true;
    root.visible = enabled;
    root.position.set(ax, ay, az);
  }
  function update(nextTime, options = EMPTY_UPDATE) {
    assertLive(); finite(nextTime, 'time');
    const anchor = options.anchor;
    if (anchor !== undefined) {
      vector(anchor, 3, 'anchor', -10000000, 10000000);
      ax = anchor[0]; ay = anchor[1]; az = anchor[2];
    }
    time = nextTime; render();
  }
  function setEnabled(value) {
    assertLive();
    if (typeof value !== 'boolean') throw new TypeError('enabled must be a boolean');
    enabled = value; render();
  }
  function setIntensity(value) {
    assertLive(); finite(value, 'intensity'); intensity = Math.min(1, Math.max(0, value)); render();
  }
  function readState() {
    return {seed, count, extent: [sx, sy, sz], wind: [vx, vz], fallSpeed, time, anchor: [ax, ay, az], intensity, enabled, activeCount, visibleCount, disposed, model: 'visual-rain', exposureAndWetness: 'external'};
  }
  function dispose() {
    if (disposed) return;
    disposed = true; enabled = false; visibleCount = 0;
    root.visible = false; geometry.setDrawRange(0, 0); root.removeFromParent();
    geometry.dispose(); material.dispose();
  }
  try {render();} catch (error) {dispose(); throw error;}
  return {root, update, setEnabled, setIntensity, readState, dispose};
}
