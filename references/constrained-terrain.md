# Constrained terrain production

Use this when a locally constrained terrain edit must keep the existing broad surface and stay compatible with roads built on the final terrain. The producer accepts a validated regular height-field mesh, cuts convex XZ constraints into its triangles, samples one shared height function, and emits a conforming indexed mesh. Roads then consume that final mesh through the strict `triangulated` support path in [terrain-roads](terrain-roads.md).

This is a bounded mesh refiner, not a terrain designer or general triangulator. It does not create the initial landscape, solve arbitrary grading, add bridges/caves, or merge overlapping roads. Constraints and protected areas are convex polygons; split concave designs into disjoint convex regions before calling it. The source must be a complete regular XZ grid and the output must remain a single-valued surface over its rectangular bounds.

## Data handoff

| Stage | Input | Output passed forward |
|---|---|---|
| Existing terrain | Final regular indexed `BufferGeometry` | Borrowed surface; source geometry is never changed or disposed |
| Constraint producer | Convex `[x,z]` regions, optional global `heightAt`, protected corridors | Owned, conforming indexed `BufferGeometry` plus bounded work/triangle/vertex counts |
| Road consumer | Final terrain geometry, explicit `topology: 'triangulated'`, union surfaces | Road top/underside/walls and support query derived from exactly that final terrain |
| Scene owner | Terrain result, support handle, road result | Dispose roads first, then support handle, then generated terrain; dispose original terrain only at its original owner's boundary |

`constraints` insert boundaries and split triangles; they do not limit where `heightAt` runs. The callback is evaluated over every terrain vertex and generated split point. To make an edit local, return `baseHeight` outside the intended edit footprint. `protectedRegions` take priority and retain the source piecewise-linear surface there, including where a constraint overlaps them. Use a road corridor wide enough to include all road support that must not move.

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

This example shows the handoff, not a universal pad profile. Fit constraint polygons and height transition width to the actual road, foundations, retaining edges and camera views. If a protected corridor crosses a grade edit, preserve the source under the corridor and design the transition outside it.

## Checks before passing the result on

- Let `prepareTerrainRoadSupport({terrainGeometry: refined.geometry, topology: 'triangulated'})` validate the exact output; do not weaken the validator to make a producer pass.
- Sample source and output at points outside protected/edited domains to ensure the original piecewise-linear surface is retained. Check the edited profile and road corridor separately.
- Build the roads from the final terrain support, not from the source or a separately reconstructed height function. Confirm road top height against the emitted terrain at the road's actual vertices.
- Record `sourceTriangles`, `outputTriangles`, `outputVertices`, `splitSourceTriangles` and `workUnits`. Refuse before rendering when any configured budget is exceeded.
- Inspect whole-scene and near-ground views for cracks, z-fighting, floating foundations and abrupt grade changes. Mesh validity alone does not establish a plausible landscape or a good composition.

## Limits

The producer accepts non-instanced indexed `Float32` position grids with optional matching `Float32` UVs and normals. It rejects morph/deformation, material groups and noninterpolable attributes. Each constraint/protected polygon must be convex, contain 3–256 vertices and use finite world XZ coordinates; at most 128 polygons are accepted. Work, output triangle and vertex budgets are hard failures, not simplification requests. Large or dense edits may need a purpose-built constrained triangulator with different limits. The resulting mesh is generated and owned by this call; terrain input is borrowed.
