// A local sampling estimate, not a mesher or a visual-quality certificate.
// Distances/features/curvature use WORLD units (curvature is 1 / world unit).
// Use it at relevant near-view surface points, then verify the emitted geometry.
export function estimateSamplingStep(T, {
  camera, worldPoint, viewportHeight, maxErrorPx = .75,
  curvatureBound, minFeatureSize, samplesPerFeature = 8,
  maxStep, maxNormalTurn = .2,
} = {}) {
  if (!T?.Vector3 || !(camera?.isPerspectiveCamera || camera?.isOrthographicCamera))
    throw new TypeError('THREE and a perspective or orthographic camera required');
  const positive = (value, name) => {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
  };
  positive(viewportHeight, 'viewportHeight');positive(maxErrorPx, 'maxErrorPx');
  positive(maxNormalTurn, 'maxNormalTurn');
  if (maxNormalTurn > Math.PI / 2) throw new RangeError('maxNormalTurn must be <= PI/2 radians');
  if (!Number.isInteger(samplesPerFeature) || samplesPerFeature < 3)
    throw new RangeError('samplesPerFeature must be an integer >= 3');
  if (curvatureBound !== undefined && (!Number.isFinite(curvatureBound) || curvatureBound < 0))
    throw new RangeError('curvatureBound must be finite and nonnegative');
  if (minFeatureSize !== undefined) positive(minFeatureSize, 'minFeatureSize');
  if (maxStep !== undefined) positive(maxStep, 'maxStep');
  const p = worldPoint?.isVector3 ? worldPoint.clone() :
    Array.isArray(worldPoint) && worldPoint.length === 3 ? new T.Vector3(...worldPoint) : null;
  if (!p || !p.toArray().every(Number.isFinite)) throw new TypeError('finite worldPoint required');
  camera.updateWorldMatrix(true, false);
  const m = camera.matrixWorld.elements;
  const axes = [0, 4, 8].map(i => new T.Vector3(m[i], m[i + 1], m[i + 2]));
  if (axes.some(a => Math.abs(a.lengthSq() - 1) > 1e-6) ||
      Math.abs(axes[0].dot(axes[1])) > 1e-6 || Math.abs(axes[0].dot(axes[2])) > 1e-6 ||
      Math.abs(axes[1].dot(axes[2])) > 1e-6)
    throw new RangeError('camera world transform must be rigid: scaled/sheared cameras unsupported');
  const depth = -p.applyMatrix4(camera.matrixWorldInverse).z;
  if (!Number.isFinite(depth) || depth <= 0 || depth < camera.near || depth > camera.far)
    throw new RangeError('worldPoint must lie at positive depth inside camera near/far');
  // Read the current projection: zoom and view offsets are already in m[5].
  // Caller updates projectionMatrix after changing lens/viewport settings.
  const py = Math.abs(camera.projectionMatrix.elements[5]);positive(py, 'projection vertical scale');
  const worldUnitsPerPixel = 2 * (camera.isPerspectiveCamera ? depth : 1) / (py * viewportHeight);
  const errorWorld = worldUnitsPerPixel * maxErrorPx;
  const curvatureStep = curvatureBound > 0 ? Math.min(
    Math.sqrt(8 * errorWorld / curvatureBound), maxNormalTurn / curvatureBound
  ) : Infinity;
  const featureStep = minFeatureSize === undefined ? Infinity : minFeatureSize / samplesPerFeature;
  const step = Math.min(curvatureStep, featureStep, maxStep ?? Infinity);
  if (!Number.isFinite(step) || step <= 0)
    throw new RangeError('provide a positive curvatureBound, minFeatureSize or finite maxStep');
  return {
    step, depth, worldUnitsPerPixel, errorWorld,
    curvatureStep: Number.isFinite(curvatureStep) ? curvatureStep : null,
    featureStep: Number.isFinite(featureStep) ? featureStep : null,
    estimatedChordErrorPx: curvatureBound === undefined ? null :
      curvatureBound * step * step / (8 * worldUnitsPerPixel),
  };
}

// sqrt(8*error/curvature) is a local small-arc chord estimate with an additional
// normal-turn bound. It assumes the declared curvature bound is valid along the
// sampled section. Pixel scale is measured in the view plane at one depth:
// off-axis motion, large depth variation, implicit-field error, triangulation,
// sharp joins and shader displacement still need independent surface checks.
// A wavelength/feature-size input describes GEOMETRIC detail. Surface-only
// frequencies belong in an appropriately filtered shader/texture instead.
