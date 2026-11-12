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
