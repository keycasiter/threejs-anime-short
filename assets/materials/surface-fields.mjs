/** Bake authored fields into Three.js PBR maps, optionally composing a material.
 * Inject the scene's THREE namespace (verified with r180). createSurfaceMaps
 * creates data maps only; createRegionMaterial also owns a standard material.
 * Neither creates a renderer, geometry, random field or external image.
 */

// Dispose only this owner's explicit children. Shared/borrowed references on
// a material never enter the list; a listener failure cannot skip a sibling.
export function disposeMaterialResources(children,label) {
  const errors=[];
  for(const child of children)try{child.dispose();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,label+' cleanup failed');
}

/**
 * heightAt({u,v,x,y}) returns height in the SAME unit as physicalSize.
 * roughnessAt({u,v,x,y}) returns a multiplier in [0,1]. Each is sampled once per
 * pixel center; u,v increase along +x,+y. Row 0 stores the LOW-v row, flipY=false.
 * physicalSize describes one UV tile's orthogonal tangent-space X/Y lengths;
 * x=u*physicalSize[0], y=v*physicalSize[1]. A checked unit orthonormal shader tangent frame and the
 * default tangent-space normalMapType/normalScale=(1,1) are assumed. In r180,
 * the derivative fallback is not unit in both axes for unequal UV/world scales;
 * supported indexed geometry can computeTangents(), then verify its chart. UV repeats,
 * nonuniform UV/world scaling or complex curved charts need caller-side metric
 * handling; this helper does not derive geometry tangents or displace silhouettes.
 *
 * Normal = normalize(-dh/dx,-dh/dy,1), encoded RGB8 in NoColorSpace, with at most
 * 1/255 decoded component error. Roughness uses G only (R=B=0, A=255), also raw
 * data: input roughnessFactor = material.roughness * roughnessMap.g. Keep scalar
 * roughness independent; do not also apply this height as bumpMap (double detail).
 *
 * repeat uses wrapped central differences and requires a genuinely periodic
 * field; it cannot make nonperiodic input seamless. clamp uses central interior
 * differences and one-sided secants at the first/last pixel centers. Height and
 * roughness fields must be band-limited for the chosen bake resolution. Generated
 * mipmaps improve minification, but cannot recover detail already aliased during
 * baking and do not compensate normal variance into roughness.
 *
 * Assign returned maps to a caller-owned material; dispose() releases only these
 * two textures, once. No color map, displacement, material or lighting is implied.
 */
export function createSurfaceMaps(THREE, {
  width = 256, height = 256, physicalSize = [1, 1],
  heightAt = () => 0, roughnessAt = () => 1, wrapU = 'clamp', wrapV = 'clamp'
} = {}) {
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 2) throw new Error('width and height must be integers >= 2');
  if (!Array.isArray(physicalSize) || physicalSize.length !== 2 || physicalSize.some(n => !Number.isFinite(n) || n <= 0)) throw new Error('physicalSize must contain two finite positive lengths');
  const [sizeX, sizeY] = physicalSize, stepX = sizeX / width, stepY = sizeY / height;
  if (!(stepX > 0) || !(stepY > 0)) throw new Error('physicalSize per texel is too small');
  if (![wrapU, wrapV].every(wrap => wrap === 'clamp' || wrap === 'repeat')) throw new Error('wrapU and wrapV must be clamp or repeat');
  if (typeof heightAt !== 'function' || typeof roughnessAt !== 'function') throw new Error('heightAt and roughnessAt must be functions');

  const count = width * height, heights = new Float64Array(count);
  const normalData = new Uint8Array(count * 4), roughnessData = new Uint8Array(count * 4);
  let minHeight = Infinity, maxHeight = -Infinity, minRoughness = Infinity, maxRoughness = -Infinity, maxSlope = 0;
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const u = (i + .5) / width, v = (j + .5) / height;
    const point = {u, v, x: u * sizeX, y: v * sizeY}, h = heightAt(point), r = roughnessAt(point), k = j * width + i;
    if (!Number.isFinite(h)) throw new Error(`heightAt must return a finite number at texel (${i},${j})`);
    if (!Number.isFinite(r) || r < 0 || r > 1) throw new Error(`roughnessAt must return a number in [0,1] at texel (${i},${j})`);
    heights[k] = h;roughnessData[k * 4 + 1] = Math.round(r * 255);roughnessData[k * 4 + 3] = 255;
    minHeight = Math.min(minHeight, h);maxHeight = Math.max(maxHeight, h);
    minRoughness = Math.min(minRoughness, r);maxRoughness = Math.max(maxRoughness, r);
  }
  function derivative(i, j, alongU) {
    const index = alongU ? i : j, size = alongU ? width : height;
    const wrap = alongU ? wrapU : wrapV, step = alongU ? stepX : stepY;
    const before = wrap === 'repeat' ? (index + size - 1) % size : Math.max(0, index - 1);
    const after = wrap === 'repeat' ? (index + 1) % size : Math.min(size - 1, index + 1);
    const a = alongU ? heights[j * width + before] : heights[before * width + i];
    const b = alongU ? heights[j * width + after] : heights[after * width + i];
    const intervals = wrap === 'repeat' ? 2 : after - before;
    // Divide by the interval count before the physical step to avoid 2*step overflow.
    return ((b - a) / intervals) / step;
  }
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const dx = derivative(i, j, true), dy = derivative(i, j, false), k = (j * width + i) * 4;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error(`Height derivative is nonfinite at texel (${i},${j}); rescale physical units or height`);
    const length = Math.hypot(dx, dy, 1);
    // Math.hypot may exceed Float64 even for two finite slopes. Scale first.
    const scale = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const norm = Number.isFinite(length) ? [-dx / length, -dy / length, 1 / length]
      : (() => {const l = Math.hypot(dx / scale, dy / scale, 1 / scale);return [-dx / scale / l, -dy / scale / l, 1 / scale / l];})();
    for (let axis = 0; axis < 3; axis++) normalData[k + axis] = Math.round((norm[axis] * .5 + .5) * 255);
    normalData[k + 3] = 255;maxSlope = Math.max(maxSlope, Math.hypot(dx, dy));
  }
  function texture(data) {
    const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    map.colorSpace = THREE.NoColorSpace;map.flipY = false;map.unpackAlignment = 1;map.premultiplyAlpha = false;
    map.wrapS = wrapU === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    map.wrapT = wrapV === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    map.magFilter = THREE.LinearFilter;map.minFilter = THREE.LinearMipmapLinearFilter;map.generateMipmaps = true;
    map.needsUpdate = true;return map;
  }
  const normalMap = texture(normalData), roughnessMap = texture(roughnessData);
  const metadata = {
    width, height, physicalSize: [sizeX, sizeY], texelSize: [stepX, stepY], wrapU, wrapV,
    coordinates: 'pixel centers; x=u*physicalSize[0], y=v*physicalSize[1]; row 0 is low v; flipY=false',
    normalConvention: 'tangent-space normalize(-dh/dx,-dh/dy,1); RGB8 UNORM; NoColorSpace',
    derivative: 'central; periodic neighbors for repeat; one-sided secants on clamp edges',
    roughnessChannel: 'g', roughnessCombination: 'material.roughness * roughnessMap.g',
    heightRange: [minHeight, maxHeight], roughnessRange: [minRoughness, maxRoughness], maxSlope,
    sampling: 'band-limit fields before baking; mipmaps only help subsequent minification',
    limits: 'checked unit orthonormal shader TBN and physical UV chart required; no color, displacement, silhouette, tangents or normal-variance roughness compensation'
  };
  let disposed = false;
  return {normalMap, roughnessMap, metadata, dispose() {
    if (disposed) return;
    disposed = true;disposeMaterialResources([normalMap,roughnessMap],'Surface maps');
  }};
}

/** Optional PBR composition of a caller-designed regional field.
 * regionAt({u,v,x,y}) -> {color: THREE.Color in linear working space,
 * roughness: 0..1, metalness: 0..1, height: physical units}.
 * Each region is sampled once per texel, so all four channels share boundaries.
 * Color is encoded sRGB in map; scalar data remain raw (roughness G, metalness B).
 * Inherits createSurfaceMaps' physical UV/TBN, filtering and band-limit limits.
 * This supplies no wear/noise preset and does not create geometric edges.
 */
export function createRegionMaterial(THREE, {regionAt, ...options} = {}) {
  if (typeof regionAt !== 'function') throw new Error('regionAt must be a function');
  const cache = new Map();
  function region(p) {
    const key = `${p.u},${p.v}`;
    if (!cache.has(key)) {
      const value = regionAt(p);
      // Callers may reuse a scratch object/Color; preserve this texel's values.
      cache.set(key, {height: value.height, roughness: value.roughness,
        metalness: value.metalness, color: value.color?.isColor ? value.color.clone() : value.color});
    }
    return cache.get(key);
  }
  const surface = createSurfaceMaps(THREE, {
    ...options,
    heightAt: p => region(p).height,
    roughnessAt: p => region(p).roughness
  });
  const {width, height, physicalSize} = surface.metadata;
  const colors = new Uint8Array(width * height * 4), metals = new Uint8Array(colors.length);
  try {
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const u = (i + .5) / width, v = (j + .5) / height;
      const r = region({u, v, x: u * physicalSize[0], y: v * physicalSize[1]});
      if (!r.color?.isColor || !r.color.toArray().every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Region color must be a linear THREE.Color with components in [0,1]');
      if (!Number.isFinite(r.metalness) || r.metalness < 0 || r.metalness > 1) throw new Error('Region metalness must be in [0,1]');
      const c = r.color.clone().convertLinearToSRGB(), k = (j * width + i) * 4;
      colors[k] = Math.round(c.r * 255);colors[k+1] = Math.round(c.g * 255);colors[k+2] = Math.round(c.b * 255);colors[k+3] = 255;
      metals[k+2] = Math.round(r.metalness * 255);metals[k+3] = 255;
    }
  } catch (error) {surface.dispose();throw error;}
  cache.clear();
  function texture(data, colorSpace) {
    const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = colorSpace;t.flipY = false;
    t.wrapS = surface.normalMap.wrapS;t.wrapT = surface.normalMap.wrapT;
    t.magFilter = THREE.LinearFilter;t.minFilter = THREE.LinearMipmapLinearFilter;t.generateMipmaps = true;
    t.needsUpdate = true;return t;
  }
  const map = texture(colors, THREE.SRGBColorSpace), metalnessMap = texture(metals, THREE.NoColorSpace);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 1,
    map, roughnessMap: surface.roughnessMap, normalMap: surface.normalMap, metalnessMap
  });
  let disposed = false;
  return {material, maps: {map, metalnessMap, roughnessMap: surface.roughnessMap, normalMap: surface.normalMap},
    metadata: {...surface.metadata, regionChannels: 'sRGB color; raw roughness G / metalness B; height -> normal',
      limits: 'caller-designed regional field; physical UV/unit TBN and band-limited fields required; no geometry, displacement, lighting or normal-variance compensation'},
    dispose() {if (disposed) return;disposed = true;disposeMaterialResources([material,map,metalnessMap,surface],'Region material');}
  };
}
