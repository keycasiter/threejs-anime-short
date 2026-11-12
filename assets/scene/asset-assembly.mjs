/**
 * Assemble asset-local static geometry without taking ownership of caller resources.
 * Inject THREE and its matching BufferGeometryUtils.mergeGeometries to avoid mixing runtimes.
 * `layers` is a Layers.mask bitmask; anchors are a Map of asset-local Matrix4 snapshots.
 */
export function createAssetAssembly(THREE, {mergeGeometries} = {}) {
  if (!THREE?.BufferGeometry || !THREE?.Matrix4 || !THREE?.Group || typeof mergeGeometries !== 'function') {
    throw new TypeError('THREE and matching mergeGeometries are required');
  }
  const buckets = new Map(), dynamicRoots = [], anchors = new Map();
  let state = 'open', result, staticInputs = 0, staticTriangles = 0;

  function requireOpen() {
    if (state !== 'open') throw new Error(`Asset assembly is closed (${state}); finish prevents further changes`);
  }

  function matrixSnapshot(matrix = new THREE.Matrix4()) {
    if (!matrix?.isMatrix4 || matrix.elements.length !== 16 || !matrix.elements.every(Number.isFinite)) {
      throw new TypeError('matrix must be a finite Matrix4');
    }
    const e = matrix.elements;
    if (e[3] !== 0 || e[7] !== 0 || e[11] !== 0 || e[15] !== 1) {
      throw new RangeError('matrix must be an affine asset-local transform');
    }
    const volume = Math.hypot(e[0],e[1],e[2]) * Math.hypot(e[4],e[5],e[6]) * Math.hypot(e[8],e[9],e[10]);
    const determinant = matrix.determinant();
    // Relative volume catches nearly collapsed bases without rejecting uniformly tiny assets.
    if (!Number.isFinite(volume) || !Number.isFinite(determinant) || volume === 0 || determinant / volume <= 1e-12) {
      throw new RangeError('matrix is mirrored or degenerate; explicitly repair winding or transform before assembly');
    }
    return matrix.clone();
  }

  function geometrySnapshot(source, matrix) {
    if (!source?.isBufferGeometry || source.isInstancedBufferGeometry) throw new TypeError('Expected ordinary BufferGeometry');
    if (Object.keys(source.morphAttributes).length || source.morphTargetsRelative) throw new TypeError('Morph geometry cannot be statically merged');
    const sizes = {position:[3], normal:[3], uv:[2], color:[3,4]};
    const position = source.getAttribute('position');
    if (!position || position.count < 3) throw new TypeError('Geometry needs triangle positions');
    for (const [name, attribute] of Object.entries(source.attributes)) {
      if (!sizes[name]) throw new TypeError(`Unsupported static attribute: ${name}`);
      if (attribute.isInstancedBufferAttribute || attribute.data?.isInstancedInterleavedBuffer || attribute.isGLBufferAttribute ||
          !sizes[name].includes(attribute.itemSize) || attribute.count !== position.count) {
        throw new TypeError(`Unsupported attribute layout: ${name}`);
      }
      for (let i=0; i<attribute.count; i++) for (let component=0; component<attribute.itemSize; component++) {
        if (!Number.isFinite(attribute.getComponent(i,component))) throw new TypeError(`Nonfinite attribute: ${name}`);
      }
    }
    const index = source.index, count = index ? index.count : position.count;
    if (index && (index.itemSize !== 1 || index.normalized)) throw new TypeError('Invalid triangle index layout');
    if (count < 3 || count % 3 !== 0) throw new RangeError('Triangle element count must be positive and divisible by three');
    if (source.drawRange.start !== 0 || (source.drawRange.count !== Infinity && source.drawRange.count !== count)) {
      throw new RangeError('Partial drawRange must be extracted before assembly');
    }
    if (index) for (let i=0; i<count; i++) {
      const vertex = index.getX(i);
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) throw new RangeError('Triangle index is out of bounds');
    }
    const clone = new THREE.BufferGeometry();
    try {
      // Nonindexed float attributes preserve mixed index layouts and normalized integer colors.
      // RGBA keeps authored alpha; white/default UVs make absent optional attributes mergeable.
      for (const [name, size] of Object.entries({position:3, normal:3, uv:2, color:4})) {
        const attribute = source.getAttribute(name);
        if (name === 'normal' && !attribute) continue;
        const values = new Float32Array(count * size);
        for (let i=0; i<count; i++) {
          const vertex = index ? index.getX(i) : i;
          for (let c=0; c<size; c++) values[i*size+c] = attribute && c<attribute.itemSize
            ? attribute.getComponent(vertex,c) : name === 'color' ? 1 : 0;
        }
        clone.setAttribute(name,new THREE.BufferAttribute(values,size));
      }
      if (!clone.hasAttribute('normal')) clone.computeVertexNormals();
      clone.applyMatrix4(matrix);
      for (const attribute of Object.values(clone.attributes)) {
        if (!attribute.array.every(Number.isFinite)) throw new RangeError('Transformed attributes exceed finite Float32 range');
      }
      clone.computeBoundingBox();clone.computeBoundingSphere();
      if (!Number.isFinite(clone.boundingSphere.radius)) throw new RangeError('Geometry bounds are not finite');
      return clone;
    } catch (error) {
      clone.dispose();throw error;
    }
  }

  function add(geometry, material, {matrix, castShadow=true, receiveShadow=true, layers=1} = {}) {
    requireOpen();
    if (!material?.isMaterial || typeof material.uuid !== 'string') throw new TypeError('A single Three.js material is required');
    if (typeof castShadow !== 'boolean' || typeof receiveShadow !== 'boolean') throw new TypeError('Shadow flags must be boolean');
    if (!Number.isInteger(layers) || layers < 0 || layers > 0xffffffff) throw new RangeError('layers must be an unsigned 32-bit mask');
    const snapshot = geometrySnapshot(geometry, matrixSnapshot(matrix));
    const key = JSON.stringify([material.uuid, castShadow, receiveShadow, layers]);
    if (!buckets.has(key)) buckets.set(key,{material,castShadow,receiveShadow,layers,geometries:[]});
    buckets.get(key).geometries.push(snapshot);
    staticInputs++;staticTriangles += snapshot.getAttribute('position').count / 3;
    return api;
  }

  function dynamic(object) {
    requireOpen();
    if (!object?.isObject3D) throw new TypeError('dynamic requires Object3D');
    if (object.parent) throw new Error('Dynamic root already has a parent; detach explicitly before registration');
    if (dynamicRoots.includes(object)) throw new Error('Duplicate dynamic root');
    dynamicRoots.push(object);return api;
  }

  function anchor(name, matrix) {
    requireOpen();
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Anchor name must be nonempty');
    if (anchors.has(name)) throw new Error(`Duplicate anchor: ${name}`);
    anchors.set(name,matrixSnapshot(matrix));return api;
  }

  function releaseSnapshots() {
    for (const bucket of buckets.values()) for (const geometry of bucket.geometries) geometry.dispose();
    buckets.clear();
  }

  function finish() {
    if (state === 'finished') return result;
    requireOpen();state = 'finishing';
    const root = new THREE.Group(), generated = new Set();
    try {
      for (const object of dynamicRoots) if (object.parent) throw new Error('Dynamic root acquired a parent before finish');
      for (const bucket of buckets.values()) {
        const geometry = mergeGeometries(bucket.geometries, false);
        if (!geometry?.isBufferGeometry || bucket.geometries.includes(geometry)) {
          throw new Error('mergeGeometries did not produce independent merged geometry');
        }
        generated.add(geometry);
        geometry.computeBoundingBox();geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry,bucket.material);
        mesh.castShadow=bucket.castShadow;mesh.receiveShadow=bucket.receiveShadow;mesh.layers.mask=bucket.layers;
        root.add(mesh);
      }
      // Attach only after every merge succeeds so a failed static build cannot steal dynamic roots.
      for (const object of dynamicRoots) {
        object.traverse(node=>{node.userData.noMerge=true;});root.add(object);
      }
      let disposed = false;
      result = {
        root,
        anchors:new Map([...anchors].map(([name,matrix])=>[name,matrix.clone()])),
        stats:Object.freeze({staticInputs,staticMeshes:generated.size,staticTriangles,dynamicRoots:dynamicRoots.length}),
        dispose() {
          if (disposed) return;
          disposed=true;
          // Materials and dynamic subtrees retain caller ownership, including their GPU resources.
          for (const geometry of generated) geometry.dispose();
        }
      };
      state='finished';return result;
    } catch (error) {
      state='failed';
      for (const geometry of generated) geometry.dispose();
      throw error;
    } finally {
      releaseSnapshots();
    }
  }

  // Own the builder from creation when a multi-asset build can abort before
  // finish(). Caller materials, source geometry and dynamic subtrees are borrowed.
  function dispose() {
    if (state === 'disposed') return;
    if (state === 'finishing') throw new Error('Cannot dispose an assembly during merge');
    state = 'disposed';
    releaseSnapshots();
    result?.dispose();
    anchors.clear();dynamicRoots.length = 0;
  }

  const api = {add,dynamic,anchor,finish,dispose};
  return api;
}
