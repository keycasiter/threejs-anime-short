import { createRegionMaterial } from './surface-fields.mjs';

/** Original deterministic material recipes; no images, geometry or renderer.
 *
 * createProceduralPalette(THREE,{resolution=256,seed=1}) owns all resources.
 * get(recipe,{variant=0,wetness=0,wear=0,tileSizeMeters=recipeDefault}) returns a SHARED
 * MeshStandardMaterial. Do not mutate/dispose it or its maps per object: set a
 * geometry's UVs once and reuse the material. Distinct parameter sets bake once.
 * sample(recipe,{u,v,...sameOptions}) returns linear Color, scalar roughness /
 * metalness, height in meters and named feature weights. It allocates no maps.
 * inspect() returns detached metadata; dispose() releases owned resources once.
 *
 * UV [0,1]^2 spans tileSizeMeters along orthogonal tangent X/Y. Fields repeat;
 * they describe a fixed UV pattern with millimeter/submillimeter relief. Changing
 * tile size stretches that pattern and changes its physical slope. Caller must
 * supply a matching physical UV chart and checked unit orthonormal shader TBN
 * (see surface-fields.mjs); arbitrary UV repeats/nonuniform scaling are not fixed
 * automatically. Use computed tangents where applicable. Wood grain runs along V.
 *
 * Resolution 64..2048, seed/variant uint32. Tile lengths .001..1000 meters.
 * Wetness 0..1 is an art-directed shared field parameter: darker color, smoother
 * roughness and shallower relief. It is not a layered water film or fluid model.
 * Wear 0..1 is opt-in coating loss for coated-metal only; clean paint is dielectric.
 * Nonzero wear on other recipes is rejected. Finish is procedural, not measured.
 * Variant changes spatial structure, not just hue. All color maps are sRGB;
 * roughness G / metalness B / tangent normals are raw data. No displacement,
 * geometric wear, silhouette changes, anisotropic BRDF, normal-variance roughness
 * compensation or texture antialiasing beyond sampling/mipmaps is provided.
 * Increase bake resolution for sharp mineral/wear boundaries or close-up shots;
 * lattice octaves are capped at resolution/4, so lower resolutions deliberately
 * coarsen the sampled field. RGB8 can flatten very shallow relief at coarse bakes.
 * No finite resolution guarantees alias-free detail. Palette cache is unbounded:
 * use discrete variants/wetness levels and dispose the palette with the scene.
 */
export function createProceduralPalette(THREE, options = {}) {
  checkKeys(options, ['resolution', 'seed']);
  const {resolution = 256, seed = 1} = options;
  if (!Number.isInteger(resolution) || resolution < 64 || resolution > 2048) throw new Error('resolution must be an integer in [64,2048]');
  uint32(seed, 'seed');
  const defaults = {wood: [.6, 1.2], stone: [1, 1], 'coated-metal': [.8, .8]};
  const cache = new Map(), fields = new Map();
  let disposed = false;
  const assertLive = () => {if (disposed) throw new Error('procedural palette is disposed');};
  function normalize(recipe, opts = {}, sampling = false) {
    assertLive();
    if (!Object.hasOwn(defaults, recipe)) throw new Error(`Unknown recipe: ${String(recipe)}`);
    checkKeys(opts, sampling ? ['u', 'v', 'variant', 'wetness', 'wear', 'tileSizeMeters'] : ['variant', 'wetness', 'wear', 'tileSizeMeters']);
    const {variant = 0, wetness = 0, wear = 0, tileSizeMeters = defaults[recipe]} = opts;
    uint32(variant, 'variant');
    if (!Number.isFinite(wetness) || wetness < 0 || wetness > 1) throw new Error('wetness must be in [0,1]');
    if (!Number.isFinite(wear) || wear < 0 || wear > 1 || (wear !== 0 && recipe !== 'coated-metal')) throw new Error('wear must be in [0,1], and nonzero wear requires coated-metal');
    if (!Array.isArray(tileSizeMeters) || tileSizeMeters.length !== 2 || tileSizeMeters.some(n => !Number.isFinite(n) || n < .001 || n > 1000)) throw new Error('tileSizeMeters must contain two lengths in [.001,1000] meters');
    return {recipe, variant, wetness, wear, tileSizeMeters: [...tileSizeMeters]};
  }
  function evaluator(config) {
    const key = `${config.recipe}:${config.variant}`;
    if (!fields.has(key)) fields.set(key, fieldFor(config.recipe, config.variant));
    const field = fields.get(key);
    return (u, v) => {
      const result = field(fract(u), fract(v), config.wear), wet = config.wetness;
      result.color.multiplyScalar(1 - .3 * wet);
      result.roughness = result.roughness * (1 - .75 * wet) + .14 * .75 * wet;
      result.height *= 1 - .7 * wet;
      return result;
    };
  }
  function fieldFor(recipe, variant) {
    const recipeSalt = {wood: 1009, stone: 3001, 'coated-metal': 7001}[recipe];
    const random = n => hash(seed ^ hash(variant) ^ recipeSalt ^ hash(n)) / 4294967296;
    const cx = random(2), cy = random(3), band = n => Math.min(n, Math.floor(resolution / 4));
    // Quintic-interpolated toroidal value fields. Independent seeds/octaves avoid
    // a single visible carrier or a regular cellular border. At least four bake
    // samples span each finest lattice interval; warps stay broad and restrained.
    const noise = (u, v, nx, ny, salt) => {
      nx = band(nx);ny = band(ny);
      const x = fract(u) * nx, y = fract(v) * ny, i = Math.floor(x), j = Math.floor(y);
      const fade = t => t * t * t * (t * (t * 6 - 15) + 10), a = fade(x - i), b = fade(y - j);
      const value = (dx, dy) => random(salt + ((i + dx) % nx) * 71 + ((j + dy) % ny) * 1999);
      return mix(mix(value(0, 0), value(1, 0), a), mix(value(0, 1), value(1, 1), a), b);
    };
    const color = (a, b, t) => new THREE.Color().setRGB(...a).lerp(new THREE.Color().setRGB(...b), t);
    if (recipe === 'wood') return (u, v) => {
      const knot = Math.exp(-((Math.sin(Math.PI * (u - cx)) / .3) ** 2 + (Math.sin(Math.PI * (v - cy)) / .75) ** 2));
      const bend = .07 * (noise(u, v, 3, 3, 100) - .5) + .12 * knot * Math.sin(TAU * (v - cy));
      const growth = noise(u + bend, v, 6, 2, 800);
      const grain = .65 * noise(u + bend, v, 26 + variant % 4, 3, 1200) + .35 * growth;
      return {color: color([.24, .115, .043], [.34, .18, .075], .15 + .7 * grain).multiplyScalar(1 - .08 * knot),
        roughness: .61 + .08 * grain + .025 * knot, metalness: 0,
        height: .00012 + .0002 * grain + .000025 * growth + .000025 * knot, features: {grain, knot, growth}};
    };
    if (recipe === 'stone') {
      return (u, v) => {
        const warp = .06 * (noise(u, v, 3, 3, 200) - .5);
        const mineral = noise(u + warp, v - warp, 7, 6, 600);
        const aggregate = noise(u, v, 23, 21, 1200), fine = noise(u, v, 43, 41, 1800);
        return {color: color([.28, .29, .27], [.34, .35, .32], .7 * mineral + .3 * aggregate).multiplyScalar(.985 + .03 * fine),
          roughness: .76 + .07 * aggregate + .03 * fine, metalness: 0,
          height: .00035 + .00034 * mineral + .00015 * aggregate + .00005 * fine, features: {mineral, aggregate, fine}};
      };
    }
    return (u, v, wear) => {
      const damage = .6 * noise(u, v, 5, 6, 500) + .4 * noise(u, v, 13, 15, 900);
      const exposure = wear * smooth(.88 - .65 * wear, 1 - .65 * wear, damage);
      const finish = noise(u, v, 47, 43, 1400);
      return {color: color([.035, .13, .16], [.42, .46, .5], exposure).multiplyScalar(.97 + .06 * finish),
        roughness: .42 + .07 * finish - .16 * exposure, metalness: .92 * exposure,
        height: .00004 + .0002 * (1 - exposure) + .00014 * finish, features: {exposure, finish}};
    };
  }
  return {
    get(recipe, opts = {}) {
      const config = normalize(recipe, opts), key = JSON.stringify(config);
      if (!cache.has(key)) {
        const at = evaluator(config);
        const baked = createRegionMaterial(THREE, {width: resolution, height: resolution,
          physicalSize: config.tileSizeMeters, wrapU: 'repeat', wrapV: 'repeat', regionAt: ({u, v}) => at(u, v)});
        baked.material.name = `procedural:${recipe}:${config.variant}`;
        const metadata = {...config, seed, resolution, units: 'meters', heightUnits: 'meters'};
        baked.material.userData.proceduralPalette = structuredClone(metadata);
        cache.set(key, {baked, metadata});
      }
      return cache.get(key).baked.material;
    },
    sample(recipe, opts = {}) {
      const config = normalize(recipe, opts, true);
      if (!Number.isFinite(opts.u) || !Number.isFinite(opts.v)) throw new Error('sample u and v must be finite');
      return evaluator(config)(opts.u, opts.v);
    },
    inspect() {
      return {disposed, seed, resolution, units: 'meters',
        recipes: Object.entries(defaults).map(([recipe, tileSizeMeters]) => ({recipe, tileSizeMeters: [...tileSizeMeters]})),
        entries: Array.from(cache.values(), ({metadata}) => structuredClone(metadata)),
        ownership: 'palette owns shared materials and maps; dispose the palette once; do not mutate per object'};
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const {baked} of cache.values()) baked.dispose();
      cache.clear();fields.clear();
    }
  };
}

const TAU = 2 * Math.PI;
const fract = n => n - Math.floor(n);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {const t = Math.max(0, Math.min(1, (x - a) / (b - a)));return t * t * (3 - 2 * t);};
function hash(n) {n = Math.imul(n ^ n >>> 16, 0x21f0aaad);n = Math.imul(n ^ n >>> 15, 0x735a2d97);return (n ^ n >>> 15) >>> 0;}
function uint32(n, name) {if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`${name} must be a uint32`);}
function checkKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('options must be an object');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown option: ${key}`);
}
