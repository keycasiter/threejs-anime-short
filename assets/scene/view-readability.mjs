/**
 * Diagnose caller-supplied surface samples; this is not an object silhouette,
 * coverage measurement, readability pass/fail, or an artistic quality score.
 *
 * points: finite world-space THREE.Vector3 values or [x,y,z] arrays. Sample the
 * actual feature surface upstream; this function never substitutes AABB corners.
 * viewport and overlay rectangles: canvas-relative CSS pixels, origin top-left.
 * Overlay edges are inclusive. overlaySampleCount counts distinct onscreen
 * samples inside at least one rectangle, independently of geometric occlusion.
 * sampleBoundsPx bounds only the supplied onscreen samples, not the object.
 *
 * occluders: explicit triangle Mesh/proxy objects or group roots. Only Mesh
 * descendants are raycast; Lines/Points/sprites are not triangle occluders.
 * Material side and camera layers follow Three.js raycasting. Hidden objects,
 * ancestors, materials, and ignore subtrees are excluded. Transparent materials
 * still block: the caller chooses an opaque/proxy set. Ray intersections do not
 * reproduce alphaTest/texture alpha, transmission, shader displacement, clipping
 * planes, postprocessing, or rasterization. Supply suitable proxies when needed.
 * Existing CPU raycast deformation/bounds are used; this function does not bake
 * shaders, rebuild deformed geometry, or refresh stale instance/geometry bounds.
 *
 * Ordinary-depth WebGL PerspectiveCamera and OrthographicCamera only. WebGPU
 * coordinates and camera.reversedDepth are rejected. In r180 WebGLRenderer can
 * enable reversedDepth while coordinateSystem remains WebGL; reversed projection
 * uses near NDC z=1 and far z=0, incompatible with this function's near z=-1 and
 * [-w,w] depth clip interval. Custom projection matrices must also retain the
 * ordinary WebGL depth convention; projection metadata must reflect their state.
 * Refresh projectionMatrix upstream after editing settings. World matrices refresh;
 * poses, geometry, material properties, layers and projection settings are not
 * edited. epsilon is a nonnegative WORLD distance subtracted from the ray far
 * distance. Include the target owner if its own surfaces can occlude samples;
 * epsilon handles front-surface self hits without excluding the whole owner.
 *
 * Counts partition: total = onscreen + clippedOrOffscreen;
 * onscreen = visible + occluded; clippedOrOffscreen = clipped + offscreen.
 * Depth/behind-camera clipping takes precedence over lateral offscreen status.
 * visibleFraction = visible / total (null for no samples), while
 * unblockedOnscreenFraction = visible / onscreen (null for none onscreen).
 * Thus an entirely offscreen feature with samples has visibleFraction 0, never 1.
 * samples[].pixel is CSS {x,y} for a finite projection in front of the camera,
 * including out-of-view projections, otherwise null. blocker is null or contains
 * the actual Three Object3D, instanceId (null for ordinary Mesh), world hit point
 * and distance from the near-clip ray origin, not from the camera center.
 */
export function inspectFeatureVisibility(T, {
  camera, points, occluders = [], ignore = [], viewport, overlays = [], epsilon = 1e-5
} = {}) {
  if (!T?.Vector3 || !T?.Vector4 || !T?.Raycaster) throw new TypeError('T must provide the Three.js vector and raycaster API');
  if (!camera?.isCamera || !(camera.isPerspectiveCamera || camera.isOrthographicCamera)) {
    throw new TypeError('camera must be a PerspectiveCamera or OrthographicCamera');
  }
  if (camera.coordinateSystem !== T.WebGLCoordinateSystem) throw new TypeError('camera must use the WebGL coordinate system');
  if (camera.reversedDepth === true) throw new TypeError('camera reversedDepth is unsupported; use ordinary depth WebGL projection');
  if (!Array.isArray(points)) throw new TypeError('points must be an array of finite world Vector3 or [x,y,z] samples');
  const worldPoints = points.map((point, index) => {
    const xyz = point?.isVector3 ? [point.x, point.y, point.z] : point;
    if (!Array.isArray(xyz) || xyz.length !== 3 || !xyz.every(Number.isFinite)) {
      throw new TypeError(`points[${index}] must be a finite world Vector3 or [x,y,z]`);
    }
    return new T.Vector3(...xyz);
  });
  if (!viewport || !Number.isFinite(viewport.width) || viewport.width <= 0 ||
      !Number.isFinite(viewport.height) || viewport.height <= 0) throw new TypeError('viewport width/height must be positive finite CSS pixels');
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new TypeError('epsilon must be a finite nonnegative world distance');
  for (const [name, list] of [['occluders', occluders], ['ignore', ignore]]) {
    if (!Array.isArray(list) || list.some(object => !object?.isObject3D)) throw new TypeError(`${name} must be an Object3D array`);
  }
  if (!Array.isArray(overlays)) throw new TypeError('overlays must be an array of CSS rectangles');
  const ids = new Set();
  for (const overlay of overlays) {
    if (!overlay || typeof overlay.id !== 'string' || !overlay.id.length || ids.has(overlay.id) ||
        !['left','top','width','height'].every(key => Number.isFinite(overlay[key])) ||
        overlay.width < 0 || overlay.height < 0) throw new TypeError('overlay requires a unique nonempty string id and finite CSS rectangle with nonnegative width/height');
    ids.add(overlay.id);
  }

  camera.updateWorldMatrix(true, false);
  for (const matrix of [camera.matrixWorld, camera.projectionMatrix, camera.projectionMatrixInverse]) {
    if (!matrix.elements.every(Number.isFinite) || matrix.determinant() === 0) throw new TypeError('camera matrices must be finite and invertible');
  }
  const ignored = new Set(ignore), meshes = new Set();
  function eligible(object) {
    for (let ancestor = object; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible || ignored.has(ancestor)) return false;
    }
    return true;
  }
  for (const root of occluders) {
    root.updateWorldMatrix(true, true);
    root.traverse(object => { if (object.isMesh && eligible(object)) meshes.add(object); });
  }
  const raycaster = new T.Raycaster();
  raycaster.layers.mask = camera.layers.mask;
  const targets = [...meshes];
  const result = {
    totalSampleCount: points.length, onscreenSampleCount: 0, visibleSampleCount: 0,
    occludedSampleCount: 0, clippedSampleCount: 0, offscreenSampleCount: 0,
    clippedOrOffscreenSampleCount: 0, visibleFraction: null,
    unblockedOnscreenFraction: null, sampleBoundsPx: null,
    overlaySampleCount: 0, samples: []
  };
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const worldPoint of worldPoints) {
    const clip = new T.Vector4(worldPoint.x, worldPoint.y, worldPoint.z, 1)
      .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    const inFront = clip.w > 0;
    const nx = clip.x / clip.w, ny = clip.y / clip.w;
    const pixel = inFront && Number.isFinite(nx) && Number.isFinite(ny)
      ? {x:(nx+1)*viewport.width/2, y:(1-ny)*viewport.height/2} : null;
    const sample = {pixel, status:'visible', blocker:null, overlays:[]};
    if (!inFront || clip.z < -clip.w || clip.z > clip.w) {
      sample.status = 'clipped'; result.clippedSampleCount++;
    } else if (clip.x < -clip.w || clip.x > clip.w || clip.y < -clip.w || clip.y > clip.w) {
      sample.status = 'offscreen'; result.offscreenSampleCount++;
    } else {
      result.onscreenSampleCount++;
      minX=Math.min(minX,pixel.x); minY=Math.min(minY,pixel.y);
      maxX=Math.max(maxX,pixel.x); maxY=Math.max(maxY,pixel.y);
      sample.overlays = overlays.filter(rect => pixel.x >= rect.left && pixel.x <= rect.left+rect.width &&
        pixel.y >= rect.top && pixel.y <= rect.top+rect.height).map(rect => rect.id);
      if (sample.overlays.length) result.overlaySampleCount++;
      const origin = new T.Vector3(nx, ny, -1).unproject(camera);
      const direction = worldPoint.clone().sub(origin), distance = direction.length();
      if (distance > epsilon) {
        raycaster.set(origin, direction.multiplyScalar(1/distance));
        raycaster.near=0; raycaster.far=distance-epsilon;
        const hit = raycaster.intersectObjects(targets, false).find(intersection => {
          const materials=intersection.object.material;
          const material=Array.isArray(materials) ? materials[intersection.face?.materialIndex ?? 0] : materials;
          return material && material.visible !== false;
        });
        if (hit) {
          sample.status='occluded';
          sample.blocker={object:hit.object, instanceId:hit.instanceId ?? null, distance:hit.distance, point:hit.point.clone()};
        }
      }
      if (sample.status === 'occluded') result.occludedSampleCount++;
      else result.visibleSampleCount++;
    }
    result.samples.push(sample);
  }
  result.clippedOrOffscreenSampleCount=result.clippedSampleCount+result.offscreenSampleCount;
  if (points.length) result.visibleFraction=result.visibleSampleCount/points.length;
  if (result.onscreenSampleCount) {
    result.unblockedOnscreenFraction=result.visibleSampleCount/result.onscreenSampleCount;
    result.sampleBoundsPx={left:minX,top:minY,width:maxX-minX,height:maxY-minY};
  }
  return result;
}
