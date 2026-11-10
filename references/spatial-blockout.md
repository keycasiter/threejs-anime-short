# Spatial blockout: build and release gate

Use this procedure for the scene-wide placement/support stage between visual analysis and middle-form modeling. It is a spatial construction contract, not a style or final-detail pass. Keep the delivered scene rendered in Three.js. Choose other authoring tools only when they solve a demonstrated geometry or measurement problem.

## 1. Select representation and tools from the spatial problem

First classify each major surface and connection. Do not default every shape to a height function or every problem to a DCC.

| Need | Suitable route | Use when | Evidence still required in Three.js |
|---|---|---|---|
| Parametric objects, layout, paths, simple single-valued ground | Three.js `BufferGeometry`, shared layout data, surface sampling | Geometry follows explicit points, sections, bounds and stable rules; rendered interaction is the target | Target-camera graybox, mesh/route sampling, sections and orbit views |
| Measured footprint, site plan, alignment or surveyed elevation | CAD/GIS source plus a documented coordinate/unit conversion | Authoritative real-world coordinates or dimensions affect placement | Register-to-source alignment check, vertical sections, Three.js render |
| Hand-shaped irregular surface or manual topology repair | Blender or equivalent mesh editor | Shape needs direct sculpting, patching, cleanup or topology control that is costly to express parametrically | Exported mesh loaded in Three.js; bounds, contact, path and orbit checks |
| Rule-driven terrain, erosion-like forms, repeated procedural layout | Houdini or equivalent procedural DCC | Many related surfaces/variants must follow control curves, masks, height/slope fields or repeatable generation | Exposed controls/provenance, export check, and all spatial relations checked in Three.js |

A tool name alone is not a solution. State the bottleneck it addresses, the data exchanged, and how its output returns to the Three.js scene. For a designed/fictional site without survey constraints, CAD is optional; start with the simplest representation that can express its intended landform. If a height field cannot express an overhang, cliff face, cave or multi-valued surface, change representation instead of forcing it.

## 2. Build the whitebox in dependency order

1. **Lock the source contract.** Read the spatial register; confirm units, axes, origin, bounds, evidence/assumption labels and unresolved relations. If no upstream register exists, create a minimum scene register from the brief before writing scene geometry: assign stable IDs, designed/inferred status, bounds/anchors, terrain or support host, route points/width, ports, critical relations, camera envelope and unknowns. Do not silently invent high-impact placement, terrain or connections.
2. **Prove one source of truth.** Generate plan, sections, route geometry, supports and object placement from the register. Record the register path and renderer consumer. Change one nontrivial register value and verify the expected rendered geometry/diagram moves; hard-coded duplicate coordinates or an unused JSON file do not pass data integrity.
3. **Set composition targets before geometry expansion.** Name the primary spatial read, secondary read and environmental frame. For the target view, specify screen-space goals for the primary group, route legibility, negative space and intended crop; select a reasoned occupancy band for this scene rather than using a universal percentage. Check a no-label thumbnail and full frame. If terrain/environment bounds make focal assets too small, adjust camera/layout organization without shrinking away required landform or changing measured dimensions.
4. **Choose geometry representation.** For each terrain region and route, record the representation, input controls, downstream consumers and reason. Separate major landform guides (ridge, valley, shoreline, terrace, breakline) from low-amplitude surface variation.
5. **Construct the spatial skeleton.** Build the full terrain/water envelope, major support surfaces, object proxy volumes, routes, platforms, ports and camera envelope from the register. Use neutral materials. Keep the complete environment and its negative spaces; do not build a hero object in isolation.
6. **Make routes and supports consume the final host geometry.** After the host mesh is final, sample the path at its final geometry spacing and across its full width. Derive route elevations, local frames and support contacts from the actual host surface or an explicit bridge/deck rule. A matching endpoint or centerline alone is insufficient.
7. **Review and repair before middle forms.** Render the target framing and the applicable plan, sections and orbit envelope. Fix topology, terrain silhouette, route fit, scale hierarchy and occlusion before adding middle-form structure or fine detail. If a gate fails, continue the spatial pass or report the specific blocker; do not label the stage released.

## 3. Run two separate acceptance passes

Every check is `PASS`, `FAIL`, or `NOT_RUN`. `NOT_APPLICABLE` is allowed only with a reason. A stage cannot pass while an applicable check is `FAIL` or `NOT_RUN`. A record must identify method and current-build evidence; a generic “checked” statement is not evidence.

| Check | Minimum method/evidence | What a pass means |
|---|---|---|
| Register integrity | Unique IDs; all required references resolve; coordinate/unit consistency; plan/sections match the register | Data is internally consistent, not that the rendered shapes look right |
| Shape and host surface | Gray terrain field/guide view; mesh bounds; critical cross-sections through each major landform change | Main silhouette, breaks, openings and supporting surfaces match the intended design without interpolation spikes or unexplained folds |
| Route fit | Resample final route after subdivision at final mesh spacing; sample centerline and both edges against the final host mesh; inspect route in longitudinal section and travel-direction view | No unexplained floating, tunneling, abrupt grade/cross-slope or route swallowed by terrain; bridges/decks satisfy explicit span and clearance rules |
| Support/contact | Check each support's actual contact region or bearing interval against its host; show support debug view at critical joints | Each support reaches the declared host and the contact is visible/plausible; a proxy-box overlap alone is only a preliminary check |
| Composition | Unlabeled full-scene graybox at target aspect and camera; inspect thumbnail and full frame against the declared screen-space goals; record primary group occupancy, route readability, negative space and crop | Main/mid/background hierarchy, negative space, focal read and intended scale cues are legible; a full frame of scenery with unreadably small focal elements fails |
| Viewing envelope | For orbiting scenes, review eight azimuths plus declared pitch and distance limits; record per view the readable content, occlusion and boundary condition | All promised accessible views show designed scene content; “no black screen” alone is not a pass |

For composition, set scene-specific goals before adjusting the camera: identify the primary read, its target screen-space share or range, the secondary read, route/circulation visibility, negative-space purpose and intended crop. Use projected bounds or target-view measurements as diagnostics, not as a universal score. Check a no-label thumbnail and full frame; if scenery fills the frame while focal relationships are hard to read, the composition fails regardless of object count.

**Make the check independent of the generator.** A route-height function tested against itself can report zero deviation while the emitted `BufferGeometry` still floats or cuts into the rendered terrain. Measure the final route mesh against the final host mesh (for example, downward `Raycaster` queries or a mesh-distance query), and derive support bounds from the emitted world-space geometry. Report centerline and both route edges at the same or finer sampling density as the final mesh. Keep construction samples and verification samples separate; a shared design source is useful, but it is not independent geometric evidence.

For a complex terrain, include a plan diagnostic that overlays terrain guides, routes, zones and object anchors, plus at least two cross-sections through distinct terrain changes. For a simple flat interior, these terrain diagnostics are not applicable; inspect floor/wall, route, doorway and camera-clearance interfaces instead. Tailor evidence to the spatial problem without skipping the corresponding relation checks.

### Fail-closed status

Keep structural, geometric and visual status separate, for example:

```json
{
  "dataIntegrity": {"status":"PASS", "sourceRegister":"spatial-register.json", "consumerCheck":"qa/register-consumer-check.json", "method":"change one register point and confirm the rendered path and plan move", "evidence":["qa/register-consumer-check.json"]},
  "surfaceQuality": {"status":"PASS", "guideOverlay":"qa/terrain-guides.png", "sections":["qa/section-across.svg", "qa/section-along.svg"], "method":"compare guide lines and emitted-mesh sections against intended landform changes", "evidence":["qa/terrain-guides.png", "qa/section-across.svg", "qa/section-along.svg"]},
  "routeFit": {"status":"NOT_RUN", "reason":"final route mesh has not been sampled against host geometry"},
  "supportContact": {"status":"NOT_APPLICABLE", "reason":"this scene has no separate support-bearing structures"},
  "composition": {"status":"FAIL", "method":"unlabeled target-view thumbnail and full-frame review", "evidence":["qa/overview-gray.png"], "criteria":[{"criterion":"primary and secondary reads are distinguishable", "status":"FAIL"}]},
  "viewEnvelope": {"status":"NOT_RUN", "reason":"orbit sectors have not been reviewed"}
}
```

Do not display a combined “spatial pass” when any required geometric or visual check is missing. If only register IDs, endpoints and support proxy volumes were checked, call the result `data/connection checks passed; spatial quality not yet evaluated`. A PASS must point to existing files and the category-specific evidence below; a hand-typed status alone cannot release the stage.

| Category marked PASS | Required record fields |
|---|---|
| `dataIntegrity` | `sourceRegister` and `consumerCheck` file paths; the consumer check demonstrates the renderer/drawings use the source |
| `surfaceQuality` | `guideOverlay` file path and at least two existing `sections` files for complex terrain; use `NOT_APPLICABLE` with reason for surfaces that do not need terrain analysis |
| `routeFit` | `samples` file path plus numeric `maxEdgeDeviation` and `minClearance` from final route geometry against the final host mesh |
| `supportContact` | `contactReport` file path covering all applicable bearing points/regions |
| `composition` | `unlabeledViews` file path and nonempty `criteria` recording the declared composition goals and observed result |
| `viewEnvelope` | `scope` and eight `views`, each with azimuth, evidence file, readable content, occlusion and boundary result |

Use the optional record validator when producing a machine-readable gate record:

```sh
python3 scripts/validate_spatial_gate.py path/to/spatial-gate.json
```

The script checks coverage and status discipline; it does not inspect a mesh or replace visual review.

## 4. Handoff to middle-form modeling

Release only when the full scene's spatial relationships and declared viewing envelope pass. Hand off the exact register revision, geometry representation/source for each major surface, route/host sampling results, support/contact map, camera envelope, current rendered evidence and unresolved assumptions. Middle-form modeling may enrich volumes and interfaces, but must preserve accepted placement, silhouette, circulation, support and visibility constraints. If those constraints change, return to the register and regenerate dependent geometry and drawings.
