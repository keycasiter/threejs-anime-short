# Constrained terrain production

Use this when a locally constrained terrain edit must keep the existing broad surface and stay compatible with roads built on the final terrain. For multiple flat/level zones with protected corridors and explicit conflict handling, start from the higher-level [terrain-grading method](terrain-grading.md). The producer described here accepts a validated regular height-field mesh, cuts convex XZ constraints into its triangles, samples one shared height function, and emits a conforming indexed mesh. Roads then consume that final mesh through the strict `triangulated` support path in [terrain-roads](terrain-roads.md).

This is a bounded mesh refiner, not a terrain designer or general triangulator. It does not create the initial landscape, solve arbitrary grading, add bridges/caves, or merge overlapping roads. Constraints and protected areas are convex polygons; split concave designs into disjoint convex regions before calling it. The source must be a complete regular XZ grid and the output must remain a single-valued surface over its rectangular bounds.

## Data handoff

| Stage | Input | Output passed forward |
|---|---|---|
| Existing terrain | Final regular indexed `BufferGeometry` | Borrowed surface; source geometry is never changed or disposed |
| Constraint producer | Convex `[x,z]` regions, optional global `heightAt`, protected corridors | Owned, conforming indexed `BufferGeometry` plus bounded work/triangle/vertex counts |
| Road consumer | Final terrain geometry, explicit `topology: 'triangulated'`, union surfaces | Road top/underside/walls and support query derived from exactly that final terrain |
| Scene owner | Terrain result, support handle, road result | Dispose roads first, then support handle, then generated terrain; dispose original terrain only at its original owner's boundary |

`constraints` insert boundaries and split triangles; they do not limit where `heightAt` runs. The callback is evaluated over every terrain vertex and generated split point. To make an edit local, return `baseHeight` outside the intended edit footprint. `protectedRegions` take priority and retain the source piecewise-linear surface there, including where a constraint overlaps them. Use a road corridor wide enough to include all road support that must not move.

Custom vertex attributes require an explicit `attributeResolvers` callback. The source must be a matching, nonnormalized `Float32BufferAttribute` with 1–4 components. The resolver receives `name`, `stage` (`source-vertex`, `split-vertex`, or `conform-center`), the final output `position`, the source position, source attribute vectors, interpolation weights, and source vertex indices. It must return a finite vector of the same size. For a deformation-coupled local coordinate that must follow the emitted terrain point, an explicit resolver can be `aFormationPosition: ({position}) => position`. Do not copy or interpolate a semantic attribute by name alone; derive its value from the source contract. Unsupported integer, normalized, interleaved, instanced or morph attributes still fail explicitly.

Constraint intersections and road/terrain triangle intersections use `createFloat32LineEventTable` from `assets/geometry/float32-line-events.mjs`. It converts represented Float32 endpoints to exact dyadic integers, reduces each infinite support line to a stable equation, and caches one intersection per unordered line pair. The terrain splitter carries that line identity on every polygon edge through outside/inside partitions; the road consumer uses `clipConvexPolygonWithFloat32Events`, which carries incoming edge identity around each output ring and repairs the first vertex's incoming edge when a closing duplicate is removed. Keep event coordinates in Float64 during planar partitioning and round only when a vertex enters output geometry. Do not identify distinct lines by rounded angle/distance bins: that can merge parallel features. Parallel supports have no event; if clipping classifications imply a crossing between parallel support lines, reject as a precision conflict.

`assets/geometry/float32-triangulation.mjs` triangulates each represented Float32 output ring. It retains collinear boundary vertices, uses deterministic ear clipping for simple concave rings, has a convex fan fast path, verifies signed-area conservation, and enforces a finite work budget. The terrain producer may set `assumeConvexInput: true` only when its upstream clipping/partition operation guarantees a convex ring; the helper still checks the represented turns and falls back to simple-ring validation and ear clipping when that guarantee is not borne out. Keep the interior-center fan where the represented center lies strictly inside every edge half-plane: it preserves interior height samples for warped source faces. Use ring triangulation for pieces without a valid interior kernel. Neither path alone proves global neighbor conformity; the strict downstream mesh consumer remains required.

Protected-region membership is queried through the terrain's existing XZ cell bins. Each generated vertex checks only protected polygons whose bounds overlap its local cell, rather than rescanning every protected edge. The bins are a candidate filter only: point-in-convex tests still decide membership. When a spatial support snapshots a triangulated mesh, its triangle budget must report actual indexed faces, not the number of cells/buckets used to accelerate queries.

**Known topology gap:** the current `conformIndex` stage still groups final mesh edges by rounded direction/offset keys. Those keys are not exact event identities. A Float32 ring audit found near-collinear shared-edge candidates only `4.65e-8m` apart receiving different keys, so the conformity pass can leave T-junctions. Do not increase bin width as a general fix; provenance from source-triangle edges, constraint edges and generated diagonals must drive shared-edge reconstruction, with precision conflicts rejected explicitly. The `prepareTerrainRoadSupport` strict consumer remains the acceptance gate.

Before returning split-source triangles, the producer also compares each emitted Float32 triangle pair in XZ. A positive-area intersection larger than `max(1e-12, sourceTriangleArea * 5e-10)` rejects the candidate with source/output face IDs and coordinates in `error.details`. This is a local overlap guard, not a complete coverage proof: it detects overlaps, but cannot by itself detect all gaps, cross-source-face overlaps, unmatched boundaries or T-junctions. Keep the strict downstream terrain consumer as an independent gate. `collectTopologyDiagnostics: true` additionally records emitted-vs-partition area deltas for diagnosis; it does not relax acceptance.

For diagnosis only, `collectTopologyDiagnostics: true` adds exact indexed-edge counts before/after `conformIndex` and tests final unmatched-edge midpoints against the pre-conform mesh. It has additional CPU and memory cost proportional to the mesh and sampled boundary edges. This can localize whether a coverage defect existed before conformity; it does not establish zero overlap or make an invalid mesh acceptable.

The event table has finite line/event ceilings; terrain work is bounded by `maxWorkUnits`, and road clipping caps its line/event budgets by `maxValidationPairs`. Source support lines are created only for source faces whose bounds overlap candidate constraints. Output triangulation first tries a represented interior center; when Float32 puts that center on the boundary, a positive-area boundary fan is used. Any collapsed face, invalid winding, lost area, nonmanifold edge, self-crossing road clip, unsupported road surface or malformed outer boundary must still reject. Event identity improves intersection repeatability, but it cannot represent a feature below Float32 spacing or establish final mesh validity by itself.

The producer carries XZ positions as `Float32`. Its per-source-triangle area guard first uses a `2e-6` relative base tolerance. When the measured partition delta exceeds that, it estimates the area uncertainty from half-ULP coordinate error at generated intersections; the estimate may expand tolerance only up to a hard `3e-5` relative cap. If the estimate exceeds that cap, or the measured delta exceeds the estimate, generation rejects. This bound does not move or expand constraints. The emitted mesh must still pass `prepareTerrainRoadSupport`'s strict triangulated-surface validation. The producer's area check alone is not evidence that roads, pads or other consumers are supported.

## Runnable ESM example

```js
import * as THREE from 'three';
import {createFractalHeightField, createHeightFieldGeometry} from './assets/environment/height-field.mjs';
import {createConstrainedTerrainGeometry} from './assets/environment/constrained-terrain.mjs';
import {prepareTerrainRoadSupport, createTerrainRoadSource} from './assets/environment/terrain-roads.mjs';

const heightField = createFractalHeightField({seed: 17, baseHeight: 0, amplitude: 2, baseFrequency: .035, octaves: 4});
const originalTerrain = createHeightFieldGeometry(THREE, heightField, {
  sizeX: 160, sizeZ: 120, segmentsX: 160, segmentsZ: 120
});
const activityPad = [[-18,-12], [10,-12], [10,14], [-18,14]];
const protectedRoad = [[-55,33], [55,33], [55,47], [-55,47]];
const refined = createConstrainedTerrainGeometry(THREE, {
  terrainGeometry: originalTerrain,
  constraints: [activityPad],
  protectedRegions: [protectedRoad],
  heightAt: ({x, z, baseHeight}) => {
    // Smoothly raise a localized pad. A project-specific profile may instead
    // blend toward a designed datum; outside this footprint the base is kept.
    const edge = Math.max(Math.abs((x + 4) / 24), Math.abs((z - 1) / 22));
    const t = Math.max(0, Math.min(1, 1 - edge));
    const blend = t * t * (3 - 2 * t);
    return baseHeight + 4 * blend;
  },
  maxSourceTriangles: 262144,
  maxOutputTriangles: 1000000,
  maxOutputVertices: 524288,
  maxWorkUnits: 4000000
});

const terrainSupport = prepareTerrainRoadSupport({
  terrainGeometry: refined.geometry,
  topology: 'triangulated'
});
const roadSurfaces = [{outer:[[-50,36], [50,36], [50,44], [-50,44]], holes:[]}];
const road = createTerrainRoadSource(THREE, {
  terrainSupport,
  surfaces: roadSurfaces,
  thickness: .35
});

// Keep the source terrain as a separate owner. On scene replacement:
road.dispose();
terrainSupport.dispose();
refined.dispose();
// originalTerrain.dispose() remains with the owner that created it.
```

This example shows the handoff, not a universal pad profile. Fit constraint polygons and height transition width to the actual road, foundations, retaining edges and camera views. If a protected corridor crosses a grade edit, preserve the source under the corridor and design the transition outside it. When the input terrain has a custom Float32 coordinate field that must follow deformation, pass its resolver explicitly:

```js
const refinedWithAttachedField = createConstrainedTerrainGeometry(THREE, {
  terrainGeometry: terrainWithFormationPosition,
  constraints: [activityPad],
  protectedRegions: [protectedRoad],
  heightAt,
  attributeResolvers: {
    aFormationPosition: ({position}) => position,
  },
});
```

The example mirrors the emitted vertex position because that is the declared meaning of this terrain's attached field. Other attributes need their own semantic resolver.

## Checks before passing the result on

- Let `prepareTerrainRoadSupport({terrainGeometry: refined.geometry, topology: 'triangulated'})` validate the exact output; do not weaken the validator to make a producer pass.
- Treat the producer's per-source-face overlap check as an early local guard only. The final triangulated consumer is responsible for the global Float32 proof across source faces: complete domain area, no positive-area projected overlaps, outer-only one-use boundary edges, manifold opposite winding and finite spatial-index budgets. Preserve and record its frozen `support.audit` result with the handoff.
- For translated or large-world layouts, include at least one constrained test near the largest expected XZ coordinates; compare target heights and protected road surfaces from the emitted mesh.
- Sample source and output at points outside protected/edited domains to ensure the original piecewise-linear surface is retained. Check the edited profile and road corridor separately.
- Build the roads from the final terrain support, not from the source or a separately reconstructed height function. Confirm road top height against the emitted terrain at the road's actual vertices.
- Record `sourceTriangles`, `outputTriangles`, `outputVertices`, `splitSourceTriangles` and `workUnits`. Refuse before rendering when any configured budget is exceeded.
- When tracing a rejected terrain, enable `collectTopologyDiagnostics` and compare `beforeConform` with `afterConform`; use it only to locate the defective stage, then keep `prepareTerrainRoadSupport` as the final geometry gate.
- Inspect whole-scene and near-ground views for cracks, z-fighting, floating foundations and abrupt grade changes. Mesh validity alone does not establish a plausible landscape or a good composition.

## Limits

The producer accepts non-instanced indexed `Float32` position grids with optional matching `Float32` UVs and normals. Custom matching nonnormalized Float32 attributes need one explicit resolver each. It rejects morph/deformation, material groups and unsupported attribute layouts. Each constraint/protected polygon must be convex, contain 3–256 vertices and use finite world XZ coordinates; at most 128 polygons are accepted. Work, output triangle and vertex budgets are hard failures, not simplification requests. Large or dense edits may need a purpose-built constrained triangulator with different limits. The resulting mesh is generated and owned by this call; terrain input is borrowed.
