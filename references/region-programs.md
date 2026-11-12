# Regional architectural programs

## Evidence and scope

| Confirmed behavior | Source | Boundary |
| --- | --- | --- |
| Three programs change roofs, circulation and interior construction | `assets/examples/region-programs.mjs`, `scripts/tests/region-programs.test.mjs` | These are reusable small-building programs, not universal scene categories. |
| Windows have actual holes and thick reveals on four sides | `buildArchitecturalBay` in `assets/examples/procedural-bay.mjs`; regional ray tests | Open lights and mullions are modeled; no glass is supplied. |
| Entrance clears the finished floor | Regional doorway ray tests | Open door leaves are static; no collision or door animation system. |
| Every mesh exposes borrowed material slots; all generated geometry is owned | Regional lifecycle and failure tests | Materials/textures remain caller-owned. |
| Courtyard has no roof across its center | Regional downward-ray tests | Ground/gravel remains below the open court. |
| Dimensions affect real construction and measured footprint | Regional dimension tests | Image quality is not established by geometry tests. |
| Workshop stair-width arrival clears the guardrail; remaining front edge stays guarded | Regional stair-arrival rays across five dimensional cases | Static modeled circulation; no collision controller. |
| Workshop trusses meet actual side-wall bearings and the pitched-roof underside | Regional wall rays, tie/bearing contact and rafter cross-section tests across five dimensional cases | Geometric support contacts; no structural-load simulation. |
| Both courtyard planters meet actual gravel; rims, soil and stems retain a shared datum | Regional planter ground/contact tests across five dimension/ratio cases | Ground level is local to the gravel court. |

## Factory and placement

```js
import {buildRegionalArchitecture} from './assets/examples/region-programs.mjs';

const building = buildRegionalArchitecture(THREE, {
  program: 'workshop',
  width: 8, depth: 6, height: 4,
  materialFor,
  wallThickness: .24,
  roofOverhang: .35,
  courtyardRatio: .44
});
scene.add(building.root);
building.root.position.set(siteX, floorY, siteZ);
building.root.rotation.y = facing;
building.root.updateMatrixWorld(true);
const entrance = building.entrances[0];
const point = new THREE.Vector3(...entrance.position)
  .applyMatrix4(building.root.matrixWorld);
const normal = new THREE.Vector3(...entrance.normal)
  .transformDirection(building.root.matrixWorld);
```

Local units are metres; +Y is up, +Z faces the entrance, and the finished floor is y=0. Root scale is one. Use dimensions to change the building rather than scaling a finished asset. The caller controls site coordinates and orientation. `height` is the eave height; pitched roofs and lanterns extend above it.

| Input | Supported range | Actual consumer |
| --- | --- | --- |
| `program` | `gallery`, `workshop`, `courtyard` | Roof/floor topology, supports and fixtures |
| `width` | 4.8–18 m | Wall spans, bay counts, entry, roof, furniture and supports |
| `depth` | 3.4–18 m | Wall spans, roof, interior circulation and fixtures |
| `height` | 3–7 m | Walls/openings, eaves, trusses, mezzanine and columns |
| `wallThickness` | .12–.45 m | Wall solids, real reveals and gable thickness |
| `roofOverhang` | .1–.8 m | Roof dimensions and resulting footprint |
| `courtyardRatio` | .3–.55 | Courtyard program's central void and colonnade |
| `materialFor(role, options)` | Required callback returning a Three Material | Borrowed surface materials |

`materialFor` receives only `stone`, `coating`, `wood`, `metal`. All options explicitly use `maps:false`, `baseColor` for the surface color and neutral `color`. The scalar policy intentionally avoids claiming metric UV/tangent mapping on uncharted gables, solids and rotated fixtures. Window bays retain their own physical UV/tangent construction. Adding mapped materials elsewhere requires a real metric chart and tangent frame first.

## Structural programs

| Program | Roof and spatial topology | Interior/use |
| --- | --- | --- |
| Gallery | Flat roof ring around a genuine central aperture; raised lantern cap, piers and open clerestory lights | Freestanding display screens, two-sided reliefs, sculptural plinth, bench and roof joists |
| Workshop | Two thick pitched roof leaves, extruded gables, triangulated trusses and ridge vents | Larger entry, worktables with shelves, supported mezzanine, guardrail, stair treads/stringers and storage |
| Courtyard | Thick roof and floor rings around a real open center; inner colonnade and beams | Arcade benches, gravel court and open-rim planters with restrained planting |

All four exterior sides are complete. Window holes and frame profiles come from `buildArchitecturalBay`; mullions remain separate geometry and no backing plane closes the light. A separate thick jamb/header doorway reaches y=0; raised-sill window constraints are not weakened to create an entry. Planters use independent bottom/rim/soil components rather than a filled decorative block.

Workshop truss ties reach both side-wall centers just below the wall head. Short vertical bearings join those ties to rafters whose axes follow the actual underside of the rotated .18 m roof leaves, including their vertical thickness. Finite member radii overlap at the joints. The mezzanine guardrail and its balusters stop around a .8 m stair-arrival opening; the stair handrail meets the opening's right edge. Courtyard planters place every bottom, rim, soil layer, stem and leaf relative to the gravel's finished top at y=-.06 m.

## Return contract and ownership

| Field | Contract |
| --- | --- |
| `root` | Group with local construction, unit scale and no prescribed site transform |
| `spec` | Frozen dimensions/program, scalar mapping policy and window center/normal/width/height records |
| `parts` | Arrays: `walls`, `windows`, `doors`, `floors`, `roofs`, `structure`, `furniture`, `planting`; `windows` contains bay Groups, other arrays contain actual meshes |
| `footprint` | Local `{minX,maxX,minZ,maxZ,width,depth}`, measured from all generated geometry, including overhangs, canopy and entry deck |
| `entrances` | Local array of `{position:[x,0,z],normal:[0,0,1],width,height}`; position lies on the outer wall face |
| `materialBindings` | One `{object,slots:[{role,options}]}` per actual Mesh; array slots match material array order |
| `dispose()` | Idempotently releases owned geometry, removes/clears root; never disposes or mutates borrowed material/texture |

Some mesh references intentionally appear in both a bay Group and `parts.walls`; `parts` is an observation interface, not a disposal list. `materialBindings` contains each Mesh exactly once. The owner must call `dispose()` for a successful asset; construction failure performs the same cleanup automatically, including already-created bays. This contract can be owned by the existing resource scope without creating a separate resource framework.

For site containment, transform all four corners of the local footprint through the root matrix; rotating only the footprint center loses overhang clearance. Convert entrances using the root world matrix before connecting paths. `spec.windows` describes structural clear openings before the separate mullion detail. Courtyard center sky openness refers to the roof void, not absence of the ground below.

## Verification

```sh
THREE_MODULE=/absolute/path/to/three.module.js node --test scripts/tests/region-programs.test.mjs
```

The tests inspect actual ray intersections, finite wall reveals, roof-center voids, program-specific constructed fixtures, changed dimensions, complete envelope containment, per-mesh semantic slots, successful disposal and cleanup after a throwing material callback. Contact/circulation regressions additionally cover the full .66 m stair width, retained guarding, wall-bearing tie ends, rafter/roof thickness intersection and both planter ground contacts. These include independently mixed width, depth, height, wall thickness, overhang and courtyard ratio limits. Rendered close views and site/path placement remain integration verification responsibilities.
