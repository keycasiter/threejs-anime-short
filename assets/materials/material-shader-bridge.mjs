// Three.js r180 WebGLRenderer only. See references/material-shader-bridge.md.
const stages = ['vertex', 'fragment'];
const types = ['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshToonMaterial'];
// r180 WebGLRenderer.setProgram, WebGLMorphtargets.update and the batched multi-draw fallback
// upload these independently of ShaderLib.uniforms. Clipping is attached after onBeforeCompile.
const rendererUniforms = new Set([
  'toneMappingExposure', 'projectionMatrix', 'viewMatrix', 'cameraPosition', 'logDepthBufFC', 'isOrthographic',
  'modelViewMatrix', 'normalMatrix', 'modelMatrix', 'receiveShadow', 'clippingPlanes',
  'bindMatrix', 'bindMatrixInverse', 'boneTexture', 'batchingTexture', 'batchingIdTexture', 'batchingColorTexture',
  '_gl_DrawID', 'morphTexture', 'morphTargetBaseInfluence', 'morphTargetInfluences', 'morphTargetsTexture', 'morphTargetsTextureSize'
]);
const fail = message => { throw new Error('MaterialShaderBridge: ' + message); };
const own = (object, name) => Object.hasOwn(object, name);
const record = object => object !== null && typeof object === 'object' &&
  (Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null);
const identifier = name => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) && !(name in Object.prototype);
function identity(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) fail(field + ' requires 1–1024 characters');
  return value;
}
function table(input, field, validate) {
  if (!record(input)) fail(field + ' requires a plain record');
  const entries = [];
  for (const name in input) {
    if (!own(input, name)) continue;
    if (entries.length === 128) fail(field + ' exceeds 128 entries');
    if (!identifier(name)) fail(field + ' invalid identifier: ' + name.slice(0, 128));
    const value = input[name];
    if (!validate(value)) fail(field + ' invalid value for ' + name);
    entries.push([name, value]);
  }
  return Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : 1));
}
function compilePatches(input) {
  const count = Array.isArray(input) ? input.length : -1;
  if (!Number.isInteger(count) || count < 0 || count > 64) fail('patches requires an array of at most 64 patches');
  const patches = [];
  let total = 0;
  for (let index = 0; index < count; index++) {
    const p = input[index];
    if (!record(p)) fail('patch ' + index + ' requires a plain record');
    const {stage, anchor} = p;
    if (!stages.includes(stage)) fail('patch ' + index + ' requires a vertex/fragment stage');
    if (typeof anchor !== 'string' || !anchor.trim() || anchor.length > 1024) fail(stage + ' patch ' + index + ': invalid anchor');
    const at = stage + ' anchor ' + JSON.stringify(anchor);
    const item = {stage, anchor, before: null, after: null, replace: null};
    for (const field of ['before', 'after', 'replace']) {
      if (!own(p, field)) continue;
      const value = p[field];
      if (typeof value !== 'string' || value.length > 16384) fail(at + ': invalid ' + field + ' source');
      total += value.length;
      item[field] = value;
    }
    if ((item.replace !== null) === (item.before !== null || item.after !== null)) fail(at + ': use before/after or replace exclusively');
    total += anchor.length;
    if (total > 65536) fail(at + ': total patch text exceeds 65536 code units');
    patches.push(item);
  }
  return patches;
}
function editStage(stage, source, patches) {
  if (typeof source !== 'string' || source.length > 262144) fail(stage + ' shader source missing or exceeds 262144 code units');
  const edits = [];
  for (const p of patches) {
    if (p.stage !== stage) continue;
    const at = stage + ' anchor ' + JSON.stringify(p.anchor);
    const start = source.indexOf(p.anchor);
    if (start === -1) fail(at + ': missing');
    if (source.indexOf(p.anchor, start + 1) !== -1) fail(at + ': repeated');
    const text = p.replace ?? [p.before, p.anchor, p.after].filter(x => x !== null).join('\n');
    edits.push({start, end: start + p.anchor.length, text, at});
  }
  if (!edits.length) return source;
  edits.sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const [i, edit] of edits.entries()) {
    if (edit.start < cursor) fail(edit.at + ': overlaps ' + edits[i - 1].at);
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  return parts.join('') + source.slice(cursor);
}

export function createMaterialShaderBridge(T, options = {}) {
  if (T?.REVISION !== '180') fail('requires Three.js REVISION 180');
  const {baseMaterial: base, programKey, upstreamProgramKey = null} = options;
  const type = types.find(name => base && Object.getPrototypeOf(base) === T[name]?.prototype && base.type === name);
  if (!type) fail('baseMaterial must be an exact r180 MeshStandardMaterial, MeshPhysicalMaterial or MeshToonMaterial');
  identity(programKey, 'programKey');
  const hook = base.onBeforeCompile, upstreamCache = base.customProgramCacheKey;
  if (typeof hook !== 'function' || typeof upstreamCache !== 'function') fail('base material compile/cache hooks must be functions');
  const customCache = upstreamCache !== T.Material.prototype.customProgramCacheKey;
  if (upstreamProgramKey !== null || customCache || hook !== T.Material.prototype.onBeforeCompile)
    identity(upstreamProgramKey, 'upstreamProgramKey');
  const uniforms = Object.freeze(table(options.uniforms ?? {}, 'uniforms', v => v !== null && typeof v === 'object' && 'value' in v));
  const uniformNames = Object.freeze(Object.keys(uniforms));
  const validDefine = v => typeof v === 'boolean' || Number.isFinite(v) ||
    (typeof v === 'string' && v.length <= 1024 && !/[\r\n]/.test(v));
  const defines = table({...table(base.defines ?? {}, 'base defines', validDefine),
    ...table(options.defines ?? {}, 'defines', validDefine)}, 'merged defines', validDefine);
  const patches = compilePatches(options.patches);
  const structuralKey = JSON.stringify(['material-shader-bridge/180/v1', type, programKey, upstreamProgramKey, patches, defines, uniformNames]);
  // Material.clone() allocates then calls copy(). Keep the new object reachable if copy throws.
  const material = new T[type]();
  let disposed = false;
  try {
    material.copy(base);
    material.defines = defines;
    material.customProgramCacheKey = function () {
      if (!customCache) return structuralKey;
      const live = upstreamCache.call(this);
      if (typeof live !== 'string' || live.length > 1048576) fail('upstream customProgramCacheKey result must be a string of at most 1048576 code units');
      return structuralKey + ':' + live.length + ':' + live;
    };
    material.onBeforeCompile = function (shader, renderer) {
      if (disposed) fail('cannot compile a disposed bridge');
      hook.call(this, shader, renderer);
      const vertex = editStage('vertex', shader.vertexShader, patches);
      const fragment = editStage('fragment', shader.fragmentShader, patches);
      const target = shader.uniforms;
      if (!record(target)) fail('shader.uniforms must be a plain record');
      for (const name of uniformNames)
        if (name in target || rendererUniforms.has(name)) fail('shader.uniforms collision: ' + name);
      if (uniformNames.length && !Object.isExtensible(target)) fail('shader.uniforms is not extensible');
      // r180 passes plain parameters with own writable data fields; upstream may have changed them.
      for (const field of ['vertexShader', 'fragmentShader'])
        if (!Object.getOwnPropertyDescriptor(shader, field)?.writable) fail(field + ' must be writable');
      Object.assign(target, uniforms);
      shader.vertexShader = vertex;
      shader.fragmentShader = fragment;
    };
  } catch (error) {
    material.dispose();
    throw error;
  }
  return {
    material, uniforms,
    inspect: () => ({materialType: type, programKey, patchCount: patches.length, uniformNames, disposed}),
    dispose() { if (!disposed) { disposed = true; material.dispose(); } }
  };
}
