/** Small consumer probes, not visual or aesthetic scores. Run without a competing
 * animation loop. apply/update must finish their actual scene work before resolving.
 */
function validEpsilon(epsilon) {
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new RangeError('epsilon must be finite and nonnegative');
}

async function restoring(run, restore) {
  let failed = false, failure;
  try {
    return await run();
  } catch (error) {
    failed = true; failure = error; throw error;
  } finally {
    try { await restore(); }
    catch (error) {
      if (failed) throw new AggregateError([failure, error], 'Probe failed and baseline restoration failed');
      throw error;
    }
  }
}

function numericSnapshot(values) {
  if (!Array.isArray(values) || values.length === 0 || ![...values].every(Number.isFinite)) {
    throw new TypeError('measure must return a nonempty finite numeric array');
  }
  return [...values];
}

/** measure must read the real consumer (geometry, material, pass, etc.), not the
 * requested parameter object. Same dimensions and units are required on both reads.
 * Only baseline is restored; callbacks own resets for accumulated simulations.
 */
export async function probeParameter({baseline, candidate, apply, measure, epsilon = 1e-8} = {}) {
  if (typeof apply !== 'function' || typeof measure !== 'function') throw new TypeError('apply and measure are required');
  validEpsilon(epsilon);
  return restoring(async () => {
    await apply(baseline);
    const before = numericSnapshot(await measure());
    await apply(candidate);
    const after = numericSnapshot(await measure());
    if (before.length !== after.length) throw new RangeError('measure array length must remain the same');
    return {before, after, changed:before.some((value, index) => Math.abs(value - after[index]) > epsilon)};
  }, () => apply(baseline));
}

function hierarchyVisible(root) {
  for (let node = root; node; node = node.parent) if (!node.visible) return false;
  return true;
}

function hasDrawableTriangles(geometry, material) {
  const available=geometry?.index?.count??geometry?.getAttribute('position')?.count??0;
  if(!geometry?.isBufferGeometry||!geometry.getAttribute('position')?.count||available<3)return false;
  const start=Math.max(0,geometry.drawRange.start),end=Math.min(available,geometry.drawRange.start+geometry.drawRange.count);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end-start<3)return false;
  if(!Array.isArray(material))return Boolean(material?.visible);
  return geometry.groups.some(group=>material[group.materialIndex]?.visible&&
    Math.min(end,group.start+group.count)-Math.max(start,group.start)>=3);
}

/** Samples world matrices of visible ordinary meshes with drawable geometry.
 * observed means an eligible mesh existed, NOT camera/frustum/pixel visibility.
 * No coverage of skinning, morphs, instancing, batching, shader-only deformation,
 * changed vertex buffers, materials, occlusion, or the meaning/quality of motion.
 * A hold is observed:true/changed:false; empty/hidden trees are unobserved.
 * update must seek/reset the real scene; restoring time cannot rewind history itself.
 */
export async function probeRigidMotion(T, {root, update, times, restoreTime = times?.[0], epsilon = 1e-8} = {}) {
  if (!T?.Matrix4 || !root?.isObject3D || typeof update !== 'function') {
    throw new TypeError('THREE, an Object3D root and update are required');
  }
  if (!Array.isArray(times) || times.length < 2 || ![...times].every(time => Number.isFinite(time) && time >= 0)) {
    throw new RangeError('times must contain at least two finite nonnegative samples');
  }
  if (!Number.isFinite(restoreTime) || restoreTime < 0) throw new RangeError('restoreTime must be finite and nonnegative');
  validEpsilon(epsilon);
  const firstMatrices = new Map(), changed = new Set();
  async function seek(time) {
    await update(time);
    // Include ancestors outside root, then descendants; stale parent matrices must
    // not turn real world motion into a false hold.
    root.updateWorldMatrix(true, true);
  }
  return restoring(async () => {
    for (const time of times) {
      await seek(time);
      if (!hierarchyVisible(root)) continue;
      root.traverseVisible(node => {
        if (!node.isMesh) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (!materials.some(material => material?.visible)) return;
        if (node.isSkinnedMesh || node.isInstancedMesh || node.isBatchedMesh ||
            Object.keys(node.geometry?.morphAttributes ?? {}).length || node.morphTargetInfluences?.length) {
          throw new TypeError('Rigid probe requires ordinary meshes; skinned, morph, instanced and batched meshes are unsupported');
        }
        if (!hasDrawableTriangles(node.geometry,node.material)) return;
        const matrix = [...node.matrixWorld.elements];
        if (!matrix.every(Number.isFinite)) throw new RangeError('Observed world matrix must be finite');
        const first = firstMatrices.get(node);
        if (first && first.some((value, index) => Math.abs(value - matrix[index]) > epsilon)) changed.add(node.uuid);
        if (!first) firstMatrices.set(node, matrix);
      });
    }
    const observed = firstMatrices.size > 0;
    return {observed, changed:changed.size > 0, observedMeshes:firstMatrices.size,
      changedMeshes:[...changed], reason:observed ? null : 'No visible ordinary mesh with drawable geometry was observed'};
  }, () => seek(restoreTime));
}

/** OrbitControls distance and polar limits in world units and radians.
 * Infinity is the valid unbounded maxDistance default. Orthographic zoom limits
 * and actual camera collision/occlusion are separate consumers.
 */
export function readOrbitLimits(controls) {
  if (!controls) throw new TypeError('controls with orbit limits are required');
  const {minDistance, maxDistance, minPolarAngle, maxPolarAngle} = controls;
  if (!Number.isFinite(minDistance) || minDistance < 0 ||
      !(Number.isFinite(maxDistance) || maxDistance === Infinity) || maxDistance < minDistance) {
    throw new RangeError('Invalid distance limits: require 0 <= finite minDistance <= maxDistance (Infinity allowed)');
  }
  if (!Number.isFinite(minPolarAngle) || !Number.isFinite(maxPolarAngle) ||
      minPolarAngle < 0 || maxPolarAngle > Math.PI || minPolarAngle > maxPolarAngle) {
    throw new RangeError('Invalid polar angle limits: require 0 <= minPolarAngle <= maxPolarAngle <= PI');
  }
  return {distance:{min:minDistance,max:maxDistance}, polarAngle:{min:minPolarAngle,max:maxPolarAngle}};
}

const TAU = Math.PI * 2;
const degrees = radians => radians * 180 / Math.PI;
const wrapRadians = angle => ((angle % TAU) + TAU) % TAU;

function wrappedDelta(next, previous) {
  let delta = (next - previous) % TAU;
  if (delta >= Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

/** Records actual OrbitControls change states for a manual horizontal sweep.
 * This measures angular coverage and supplies sampled camera poses for later
 * view audits; it does NOT prove that the scene is visible, attractive, or free
 * of occlusion. Disable autoRotate and keep per-event angular changes below
 * 180 degrees so wrapped samples cannot alias multiple turns into a short arc.
 */
export function createOrbitCoverageRecorder(controls, {
  sectorCount = 8,
  minCoverageDegrees = 359,
  maxSampleStepDegrees = 90,
  maxPolarDriftDegrees = 5,
  maxTargetDriftWorld = 1e-4
} = {}) {
  if (!controls || typeof controls.addEventListener !== 'function' ||
      typeof controls.removeEventListener !== 'function' ||
      typeof controls.getAzimuthalAngle !== 'function' ||
      typeof controls.getPolarAngle !== 'function' ||
      typeof controls.getDistance !== 'function' ||
      !controls.object?.position?.toArray || !controls.target?.toArray) {
    throw new TypeError('OrbitControls with camera object, target and angle/distance readers are required');
  }
  if (!Number.isInteger(sectorCount) || sectorCount < 4 || sectorCount > 64) {
    throw new RangeError('sectorCount must be an integer from 4 to 64');
  }
  if (!Number.isFinite(minCoverageDegrees) || minCoverageDegrees <= 0 || minCoverageDegrees > 360) {
    throw new RangeError('minCoverageDegrees must be finite and in (0, 360]');
  }
  if (!Number.isFinite(maxSampleStepDegrees) || maxSampleStepDegrees <= 0 || maxSampleStepDegrees >= 180) {
    throw new RangeError('maxSampleStepDegrees must be finite and in (0, 180)');
  }
  if (!Number.isFinite(maxPolarDriftDegrees) || maxPolarDriftDegrees < 0 || maxPolarDriftDegrees > 180) {
    throw new RangeError('maxPolarDriftDegrees must be finite and in [0, 180]');
  }
  if (!Number.isFinite(maxTargetDriftWorld) || maxTargetDriftWorld < 0) {
    throw new RangeError('maxTargetDriftWorld must be finite and nonnegative');
  }

  let samples = [], lastAngle = null, unwrappedAngle = 0;
  let minAngle = Infinity, maxAngle = -Infinity, totalTravel = 0, maxStep = 0;
  let minPolar = Infinity, maxPolar = -Infinity, baselineTarget = null, observedTargetDrift = 0;
  let largeStepObserved = false, disposed = false;

  function record() {
    if (disposed) return;
    const azimuth = controls.getAzimuthalAngle();
    const polar = controls.getPolarAngle();
    const distance = controls.getDistance();
    const position = controls.object.position.toArray();
    const target = controls.target.toArray();
    if (![azimuth, polar, distance, ...position, ...target].every(Number.isFinite) || distance < 0) {
      throw new RangeError('OrbitControls returned a nonfinite camera sample');
    }
    let step = 0;
    if (lastAngle === null) unwrappedAngle = azimuth;
    else {
      step = wrappedDelta(azimuth, lastAngle);
      const stepDegrees = Math.abs(degrees(step));
      totalTravel += Math.abs(step);
      maxStep = Math.max(maxStep, stepDegrees);
      if (stepDegrees >= maxSampleStepDegrees) largeStepObserved = true;
      unwrappedAngle += step;
    }
    lastAngle = azimuth;
    minAngle = Math.min(minAngle, unwrappedAngle);
    maxAngle = Math.max(maxAngle, unwrappedAngle);
    minPolar = Math.min(minPolar, polar); maxPolar = Math.max(maxPolar, polar);
    if (!baselineTarget) baselineTarget = [...target];
    else observedTargetDrift = Math.max(observedTargetDrift, Math.hypot(...target.map((value,index)=>value-baselineTarget[index])));
    const normalizedAzimuth = wrapRadians(azimuth);
    const sector = Math.floor((normalizedAzimuth + TAU * 1e-12) / TAU * sectorCount) % sectorCount;
    samples.push({azimuth, unwrappedAzimuth:unwrappedAngle, polar, distance, position, target, sector});
  }

  function reset() {
    samples = []; lastAngle = null; unwrappedAngle = 0;
    minAngle = Infinity; maxAngle = -Infinity; totalTravel = 0; maxStep = 0;
    minPolar = Infinity; maxPolar = -Infinity; baselineTarget = null; observedTargetDrift = 0;
    largeStepObserved = false;
    record();
  }

  function snapshot() {
    const visited = new Set(samples.map(sample => sample.sector));
    const missingSectors = Array.from({length:sectorCount},(_,index)=>index).filter(index=>!visited.has(index));
    const sectorSamples = Array.from({length:sectorCount},(_,sector)=>{
      const candidates = samples.filter(sample=>sample.sector===sector);
      if (!candidates.length) return null;
      const center = (sector + .5) * TAU / sectorCount;
      candidates.sort((a,b)=>Math.abs(wrappedDelta(a.azimuth,center))-Math.abs(wrappedDelta(b.azimuth,center)));
      return {...candidates[0],sector};
    });
    const angularSpanDegrees = samples.length ? degrees(maxAngle-minAngle) : 0;
    const polarSpanDegrees = samples.length ? degrees(maxPolar-minPolar) : 0;
    const targetStable = observedTargetDrift <= maxTargetDriftWorld;
    return {
      sampleCount:samples.length,
      signedTravelDegrees:samples.length ? degrees(unwrappedAngle-samples[0].unwrappedAzimuth) : 0,
      totalTravelDegrees:degrees(totalTravel),
      angularSpanDegrees,
      polarSpanDegrees,
      maxTargetDriftWorld:observedTargetDrift,
      targetStable,
      maxObservedStepDegrees:maxStep,
      largeStepObserved,
      sectorCount,
      visitedSectors:[...visited].sort((a,b)=>a-b),
      missingSectors,
      sectorSamples,
      angularSweepComplete:!largeStepObserved && angularSpanDegrees>=minCoverageDegrees && missingSectors.length===0 &&
        polarSpanDegrees<=maxPolarDriftDegrees && targetStable,
      limits:{minCoverageDegrees,maxSampleStepDegrees,maxPolarDriftDegrees,maxTargetDriftWorld}
    };
  }

  record();
  controls.addEventListener('change', record);
  return {
    snapshot,
    reset,
    dispose(){if(disposed)return;disposed=true;controls.removeEventListener('change',record);}
  };
}
