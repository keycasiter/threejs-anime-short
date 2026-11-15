# Terrain interface field

`compileTerrainInterfaceField` compiles one sampled connector between a protected terrain boundary and a target level-zone boundary. It emits bounded convex XZ constraints and a height callback for `createConstrainedTerrainGeometry`; it never creates a separate ramp mesh.

## Data contract

Each source/target sampler owns a stable revision string and returns `{height, normal, revision}`. Each station pairs one point on the source boundary with one point on the target boundary. Both boundaries must lie on the matching authorized polygon edges after Float32 conversion. The source polygon remains protected; the target polygon remains at its declared datum. Positive-area overlap into either polygon is rejected.

```js
import {compileTerrainInterfaceField} from './assets/environment/terrain-interface-field.mjs';
import {createConstrainedTerrainGeometry} from './assets/environment/constrained-terrain.mjs';
import {prepareTerrainRoadSupport, createTerrainRoadSource} from './assets/environment/terrain-roads.mjs';

const plan = compileTerrainInterfaceField({
  id: 'walkway-to-terrace',
  source: {
    id: 'existing-ground', revision: groundRevision,
    boundary: sourceEdge,
    protectedRegion: {id: 'existing-road', outline: roadOutline},
    sample: (x, z) => ({...sampleGround(x, z), revision: groundRevision}),
  },
  target: {
    id: 'terrace-support', revision: terraceRevision,
    boundary: targetEdge,
    zone: {id: 'terrace', outline: terraceOutline, targetHeight: terraceY},
    sample: (x, z) => ({...sampleTerraceSupport(x, z), revision: terraceRevision}),
  },
  stations: pairedCrossSections,
  limits: {
    maxBoundaryError: 0.002,
    maxProfileError: 0.01,
    maxLongitudinalGrade: designGradeLimit,
    maxCrossSlope: designCrossSlopeLimit,
    maxBoundaryStep: 0.002,
  },
  maxCells: 127,
});
if (plan.diagnostics.status !== 'ACCEPTED') {
  throw new Error(JSON.stringify(plan.diagnostics));
}

const refined = createConstrainedTerrainGeometry(THREE, {
  terrainGeometry: sourceTerrain,
  constraints: plan.constraints,
  protectedRegions: plan.protectedRegions,
  heightAt: plan.heightAt,
});
const support = prepareTerrainRoadSupport({
  terrainGeometry: refined.geometry,
  topology: 'triangulated',
});
const rebuiltRoad = createTerrainRoadSource(THREE, {
  terrainSupport: support,
  surfaces: [roadAndConnectorUnion],
});
```

The planner uses endpoint normals to derive boundary gradients, builds transverse cubic Hermite profiles, and doubles transverse sampling until measured midpoint/quarter-point profile error fits `maxProfileError`. Each strip cell is a convex constrained polygon. The target zone counts as one of the refiner's 128 total constraints, so a plan can emit at most 127 cells. Revisions are read at every sample; changing either source invalidates the plan.

## Qualification boundary

The planner reports its sampled plan metrics; it does not certify the final mesh. After compilation:

1. Run `createConstrainedTerrainGeometry` and `prepareTerrainRoadSupport({topology:'triangulated'})`; this proves the generated output is a queryable triangulated surface.
2. Measure longitudinal and cross slopes, boundary steps, source preservation, target datum error, and connector gaps from the emitted Float32 triangles. Do not use only the Hermite function or input JSON as evidence.
3. Rebuild roads and connectors from that exact support token, then check their complete top-surface joins and protected footprints.
4. Keep the previous world active until the entire candidate dependency group passes; on failure dispose only candidate-owned resources.

The current planner accepts one interface, explicit paired stations, one convex source protection polygon and one convex target zone. It rejects stale samples, station/boundary mismatches, flipped/collapsed cells, overlap into protected or target cores, grade/profile limits and cell-budget exhaustion. It does not infer station correspondence, handle multiple interfaces as one transaction, adapt station spacing along the boundary, solve retaining walls/bridges/caves/multi-layer surfaces, or prove complete-world visual quality. Route, walkability and final visible pavement seams remain separate qualifications.

Run the focused r187 tests with:

```sh
THREE_MODULE=/absolute/path/to/three@0.187.0/build/three.module.js \
  node --test scripts/tests/terrain-interface-field.test.mjs
```
