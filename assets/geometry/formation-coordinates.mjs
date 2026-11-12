// Caller-owned mesh geometry; one source unit is one metre unless converted by the matrix.
export const FORMATION_ATTRIBUTE = 'aFormationPosition';
const vertexLimit = 1048576;

// Shared with the static assembly contract. Renderer-owned names are never invariant metadata.
export function assertInvariantName(name) {
  if (typeof name !== 'string' || name.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      name in Object.prototype || /^(?:position|normal|tangent|color\d*|uv\d*|index|lineDistance|_?batchId)$/.test(name) ||
      /^(?:gl_|webgl_|_webgl_|skin|morph|instance|_previousInstance)/.test(name)) {
    throw new TypeError('Expected a custom invariant attribute name (1–128 characters)');
  }
}

// Return the checked data so the consumer copies exactly the storage it validated.
export function invariantArray(T, attribute, name, size, count) {
  const array=attribute?.array;
  if (!attribute?.isBufferAttribute || attribute.isInterleavedBufferAttribute || attribute.isInstancedBufferAttribute ||
      attribute.isGLBufferAttribute || attribute.isFloat16BufferAttribute || attribute.itemSize!==size ||
      attribute.count!==count || attribute.normalized!==false || attribute.gpuType!==T.FloatType ||
      !(array instanceof Float32Array) || array.length!==count*size) {
    throw new TypeError('Invalid invariant Float32 attribute layout: '+name);
  }
  return array;
}

export function writeFormationCoordinates(T, geometry, options={}) {
  if (!T?.BufferAttribute || !geometry?.isBufferGeometry || geometry.isInstancedBufferGeometry) {
    throw new TypeError('Formation coordinates require THREE and ordinary caller-owned BufferGeometry');
  }
  const {attributeName=FORMATION_ATTRIBUTE,geometryToFormation}=options;
  assertInvariantName(attributeName);
  let e;
  if (geometryToFormation!==undefined) {
    const elements=geometryToFormation?.elements;
    if (!geometryToFormation?.isMatrix4 || elements?.length!==16) throw new TypeError('Expected affine Matrix4');
    e=Array.from({length:16},(_,i)=>elements[i]);
    if (!e.every(Number.isFinite) || e[3]!==0 || e[7]!==0 || e[11]!==0 || e[15]!==1) {
      throw new RangeError('Expected finite affine Matrix4');
    }
  }
  const p=geometry.getAttribute('position'),count=p?.count;
  if (!(p?.isBufferAttribute || p?.isInterleavedBufferAttribute) || p.isGLBufferAttribute || p.isInstancedBufferAttribute ||
      p.data?.isInstancedInterleavedBuffer || p.itemSize!==3 || !Number.isSafeInteger(count) || count<1 || count>vertexLimit) {
    throw new RangeError('Expected 1–1048576 CPU-readable xyz positions');
  }
  const existing=geometry.getAttribute(attributeName);
  let target;
  if (existing!==undefined) {
    target=invariantArray(T,existing,attributeName,3,count);
    const shares=attribute=>attribute && (attribute.data?.array??attribute.array)?.buffer===target.buffer;
    if (Object.entries(geometry.attributes).some(([key,a])=>key!==attributeName && shares(a)) ||
        shares(geometry.index) || shares(geometry.indirect) || Object.values(geometry.morphAttributes).some(list=>list.some(shares))) {
      throw new TypeError('Formation destination shares a source buffer');
    }
  }
  const values=new Float32Array(count*3);
  for (let i=0;i<count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),j=3*i;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new RangeError('Expected finite source position');
    values[j]  =e ? e[0]*x+e[4]*y+e[8]*z+e[12] : x;
    values[j+1]=e ? e[1]*x+e[5]*y+e[9]*z+e[13] : y;
    values[j+2]=e ? e[2]*x+e[6]*y+e[10]*z+e[14] : z;
    if (!Number.isFinite(values[j]) || !Number.isFinite(values[j+1]) || !Number.isFinite(values[j+2])) {
      throw new RangeError('Formation coordinates exceed finite Float32 range');
    }
  }
  if (!target) {
    const attribute=new T.BufferAttribute(values,3);
    geometry.setAttribute(attributeName,attribute);
    return attribute;
  }
  target.set(values);existing.clearUpdateRanges();existing.needsUpdate=true;
  return existing;
}
