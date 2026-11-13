# Roads on the final height-field mesh

`createTerrainRoadSource` in `assets/environment/terrain-roads.mjs` turns the **union surfaces** from `compileWorldLayout(...).levels[n].surfaces` into one road geometry. Each road polygon triangle is intersected with the actual terrain triangles before it is lifted. Junctions have one top surface; holes stay empty. Only outer and hole boundaries receive walls.

The terrain must be the final indexed, single-valued regular XZ grid, such as the output of `createHeightFieldGeometry`. Terrain, road surfaces and generated road share one coordinate space with +Y up. The grid may have varying heights, either diagonal in each cell, and reordered vertices/triangles. The function validates the complete grid and actual cell diagonals. Use a noninstanced, nonnormalized, noninterleaved xyz `BufferAttribute` (itemSize 3) backed by `Float32Array`, with its default `gpuType: THREE.FloatType`. This helper deliberately accepts that subset of r187 WebGL position formats; convert other encodings before preparation. In particular, `Float64Array` can be read on the CPU but cannot be uploaded by the r187 WebGL attribute path. The element index must be a nonnormalized, noninterleaved scalar unsigned `Uint8Array`, `Uint16Array` or `Uint32Array` attribute; itemSize 2 and floating/signed element layouts reject. Encountered fixed primitive-restart values (`255`, `65535`, `4294967295` for the respective element type) also reject, because WebGL2 treats them as restart markers rather than vertices. Widen a Uint8/Uint16 element buffer to the next supported unsigned type when the grid needs that index; split geometry when Uint32 cannot represent it. It accepts a `BufferGeometry`, not a `Mesh`; transformed mesh objects, partial draw ranges, instanced/morphed geometry, irregular triangulations, bridges, caves and overhangs are unsupported. Apply scene placement to terrain and road together after construction.

```js
import * as THREE from 'three';
import {compileWorldLayout} from './assets/scene/world-layout.mjs';
import {createHeightFieldGeometry} from './assets/environment/height-field.mjs';
import {prepareTerrainRoadSupport, createTerrainRoadSource} from './assets/environment/terrain-roads.mjs';

const world = compileWorldLayout({
  levels: [{
    id: 'ground', y: 0,
    nodes: [{id: 'west', x: -8, z: 0}, {id: 'east', x: 8, z: 0},
            {id: 'north', x: 0, z: 8}, {id: 'hub', x: 0, z: 0}],
    edges: [{id: 'west-hub', from: 'west', to: 'hub', width: 2},
            {id: 'hub-east', from: 'hub', to: 'east', width: 2},
            {id: 'hub-north', from: 'hub', to: 'north', width: 2}]
  }],
  regions: []
});
const field = {
  sample(x, z) {
    return {height: .5 * Math.sin(x * .3) + .2 * z,
            dx: .15 * Math.cos(x * .3), dz: .2};
  }
};
const terrainGeometry = createHeightFieldGeometry(THREE, field, {
  sizeX: 24, sizeZ: 24, segmentsX: 32, segmentsZ: 32
});
const terrainSupport = prepareTerrainRoadSupport({terrainGeometry});
const road = createTerrainRoadSource(THREE, {
  terrainSupport, // reuse this same token for each separate entry/road on this mesh
  surfaces: world.levels[0].surfaces,
  thickness: .12
});
const terrainMaterial = new THREE.MeshStandardMaterial({color: 0x52654a});
const roadMaterial = new THREE.MeshStandardMaterial({color: 0x827766, roughness: .9});
const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
const roadMesh = new THREE.Mesh(road.geometry, roadMaterial);
// Add both meshes to the same scene/group without relative transforms.
const scene = new THREE.Scene();
scene.add(terrainMesh, roadMesh);
const arrival = road.query(0, 0); // {height, topHeight, normal}, or null off-road
console.log(arrival.topHeight, road.stats.outputTriangles);

// Remove consumers before releasing their geometry/materials.
scene.remove(terrainMesh, roadMesh);
road.dispose();                       // generated geometry and road query cells
terrainSupport.dispose();             // shared CPU index, after its last borrower
terrainGeometry.dispose();            // caller owns the borrowed terrain
terrainMaterial.dispose();
roadMaterial.dispose();
```

`thickness` is the positive **vertical +Y distance** from terrain to desired road top, not a constant distance along a sloping normal. Road boundary XZ coordinates are converted to Float32 before triangulation. Every generated vertex is sampled at its final representable Float32 XZ, then its underside/top Y are converted to Float32. Consequently the emitted footprint can differ from the supplied doubles by Float32 coordinate precision. There is no silent local-origin rebase; callers can supply terrain and roads in a shared local frame and place them together when smaller world features require it.

Top triangles must have strictly positive upward XZ projection after quantization. Internal edges must pair in opposite directions; the actual remaining top boundary must be simple and fully cover the quantized source boundary. The underside and external/hole walls are derived from those same top vertices and boundary edges, so they share exact seams. Zero-area quantized clipping fragments can be removed only when the final boundary/coverage checks still pass. A whole lost component or boundary coverage gap rejects. Earcut source bridges and clipped polygon subdivisions are triangulated without introducing an interior point that might collapse at Float32 precision.

Every emitted cap is intersected against the actual terrain triangles again. Support is checked with **one uniform height-error bound for each cap/terrain intersection**, rather than a bound that becomes smaller at interior points where height crosses zero:

| Term | Definition |
| --- | --- |
| `δx`, `δz` | Maximum actual absolute XZ displacement from a clipped vertex to its represented Float32 vertex, over the cap's vertices; a shared vertex retains the largest encountered displacement. |
| `Lx`, `Lz` | Maximum absolute terrain-plane height derivatives in the cap's original-to-represented XZ envelope. The represented cap bounds are expanded by `δx`, `δz` to include adjacent cells/diagonals reached by rounding. |
| `By` | `max(1e-7, max_vertex(abs(groundHeight), abs(groundHeight + thickness)) * 2^-23)` over this intersection's vertices: a uniform Float32 Y rounding allowance in height units. |
| `Bxz` | `2 * (Lx * δx + Lz * δz)`: height allowance for moving the terrain samples and the cap's interpolated point across XZ quantization. Gradients are height per XZ length; displacement is XZ length. |
| `B` | `By + Bxz`, the uniform absolute support-error limit throughout this intersection. |

The underside-minus-terrain error and top-minus-terrain-minus-thickness error are affine on each intersection. Their maximum absolute values occur at its vertices. The constructor measures both errors there and rejects if either exceeds `B` or if `B > thickness / 4`. This verifies the uniform bound throughout the intersection, including zero crossings; it does not promise the smaller pointwise value obtained by substituting an interior height into `By`. The Y rounding and XZ-induced support-plane change are separate error sources. No tolerance constant is fitted to a particular scene.

Thin/crossed/degenerate features that cannot meet projected coverage, manifoldness or support checks throw an explicit precision error. Support failures include numerical details (cap/terrain vertices, worst intersection, both errors, `By`, `Bxz`, displacements, slopes and thickness). A successful shell always has a represented positive top when its source contains roads.

Geometry groups use material indices `0` for top, `1` for underside and `2` for walls. A single scalar `MeshStandardMaterial` works for every group; a three-material array can distinguish them. Top/underside UVs use represented XZ coordinates. Each boundary wall segment uses its own `0..segmentLength` and vertical-height coordinates; wall U resets at each segment. Normal-map scale, tangent continuity and a metric normal-map chart have not been verified.

`query(x, z)` tests the **emitted Float32 top footprint**, without epsilon expansion. It returns `null` outside that footprint and in hole interiors. Represented top edges are included when the exact barycentric test selects them; points near a nominal double-precision input edge follow the represented mesh. `height` and `topHeight` interpolate the emitted underside and top, so the query agrees with their solid geometry to arithmetic precision rather than evaluating an independent analytic offset. `normal` is the unit **geometric terrain face normal**, not the analytic field normal or an interpolation of shading normals; it may differ slightly from the quantized cap normal. Cell/diagonal boundary normals use the deterministic selected neighboring terrain face. `supportTolerance` is the maximum verified uniform `B` over the selected cap's terrain intersections; it bounds either emitted-cap support error across that cap and is at most `thickness / 4`.

Choose one terrain input per road:

| Caller | Input and owner | Lifetime |
| --- | --- | --- |
| One independent road | Pass `terrainGeometry` directly. The road snapshots the geometry and owns its private terrain index. | `road.dispose()` clears both its query cells and private index, and releases the generated geometry. |
| Many roads on one final mesh | Call `prepareTerrainRoadSupport({terrainGeometry, epsilon, maxTerrainTriangles})` once; give every road the same `terrainSupport`. The scene owns the frozen token; the terrain grid is private. | Dispose the road borrowers first, then the token. Disposing one borrower or failing to construct another leaves the shared index live for its siblings. Disposing the token invalidates further builds and queries that depend on it. |

The prepared source snapshots the actual mesh positions and indices. Mutating or disposing the input geometry does not update existing snapshots; they are never cached by geometry identity. After changing the terrain, prepare a new source and rebuild the corresponding roads. Road surface arrays are copied at construction. A road inherits its support's `epsilon`; an explicit value must match. Its own `maxTerrainTriangles` must admit the prepared triangle count. Other budgets still apply per road. Shared preparation avoids a second full-terrain scan; each road retains its own emitted geometry and bounded footprint-query cells.

Queries reject nonfinite coordinates and calls after disposal. All disposals are idempotent. Terrain geometry, materials and textures remain caller-owned. Use a resource scope or `finally` to release a successful shared preparation if a later build fails; a failed standalone build drops its private snapshot. Geometry allocation failures release generated geometry before throwing.

## Input and work bounds

Surfaces must already be disjoint unions, with simple unclosed `outer` rings and optional `holes` arrays. Either winding is accepted. Holes must be strictly contained and mutually disjoint; touching/intersecting boundaries and overlapping components reject. An independent island inside another component's hole is supported. Every boundary vertex must be inside the terrain extent; clipping roads to the terrain edge is not automatic. No input is mutated.

| Option | Default | Accepted range |
| --- | ---: | --- |
| `thickness` | `.12` | finite `(0, 10000]` |
| `epsilon` | `1e-7` | finite `1e-10..1e-4` |
| `maxTerrainTriangles` | `262144` | integer `1..262144` |
| `maxRoadVertices` | `4096` | integer `1..8192`, total outer/hole vertices |
| `maxCandidatePairs` | `1000000` | integer `1..4000000`, road/terrain triangle candidates |
| `maxOutputTriangles` | `500000` | integer `1..1000000`, all top/underside/wall triangles |
| `maxValidationPairs` | `1000000` | integer `1..8000000`, boundary/subdivision/coverage/support checks |

There are at most 128 surface components and 128 holes per component. All position components are finite and within ±100000. Input ring edges must exceed `8 * epsilon`; grid spacing must exceed `16 * epsilon`. Regular grid coordinates allow the normal Float32 rounding tolerance. Near-coincident features can still collapse at Float32 precision. Epsilon controls input short-edge/grid validation; it is not a road expansion or a clipping bin. Internal clipping uses a much smaller, coordinate-scaled double-precision tolerance. Quantized geometry is independently checked for projection, coverage, closed boundaries and support. A scene needing finer detail should use a shared local coordinate frame and rebuild both terrain and roads there.

All budget settings are validated before geometry allocation. Candidate work is checked for each road triangle's local grid range and for emitted-cap terrain support verification before intersection; output and validation work have hard counters. Exceeding a budget throws with its option name instead of returning a partial road. `stats` reports successful `terrainTriangles`, `roadVertices`, `validationPairs`, `candidatePairs`, `outputTriangles`, `topTriangles`, `undersideTriangles`, `wallTriangles`, `wallSegments`, `discardedCollinearTriangles`, `supportChecks`, `maxSupportError`, `maxSupportTolerance`, `maxSupportYErrorBound` and `maxSupportXZErrorBound`. The four support statistics are independent maxima over the checked intersections; their maxima need not come from the same intersection. Large oblique polygons can require many candidates even when their area is small; simplify or partition the source union, or increase a budget within its supported range.

The 202-vertex R72 district uses approximately 1.21 million validation checks with these post-quantization invariants, so it sets `maxValidationPairs: 8000000`; the default one-million budget intentionally rejects that workload. The finite limits bound operations and output counts, not elapsed time or GPU memory.
