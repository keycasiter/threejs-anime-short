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

1. **Lock the source contract.** Read the spatial register; confirm units, axes, origin, bounds, evidence/assumption labels and unresolved relations. Distinguish conservative bounds from occupied footprint, bearing/support footprint, traversable surface, overhead projection and distribution/clearance envelope wherever those regions differ. A route that visually touches an AABB may still miss the actual deck, doorway, landing or bearing. If no upstream register exists, create a minimum scene register from the brief before writing scene geometry: assign stable IDs, designed/inferred status, bounds/anchors, plan geometry where its role is ambiguous, terrain or support host, route points/width, ports, critical relations, camera envelope and unknowns. Do not silently invent high-impact placement, terrain or connections.
2. **Prove one source of truth.** Generate plan, sections, route geometry, supports and object placement from the register. Record the register path and renderer consumer. Change one nontrivial register value and verify the expected rendered geometry/diagram moves; hard-coded duplicate coordinates or an unused JSON file do not pass data integrity.
3. **Set composition targets before geometry expansion.** Name the primary spatial read, secondary read and environmental frame. For the target view, specify screen-space goals for the primary group, route legibility, negative space and intended crop; select a reasoned occupancy band for this scene rather than using a universal percentage. Check a no-label thumbnail and full frame. If terrain/environment bounds make focal assets too small, adjust camera/layout organization without shrinking away required landform or changing measured dimensions.
4. **Choose geometry representation.** For each terrain region and route, record the representation, input controls, downstream consumers and reason. Separate major landform guides (ridge, valley, shoreline, terrace, breakline) from low-amplitude surface variation.
5. **Construct the spatial skeleton.** Build the full terrain/water envelope, major support surfaces, object proxy volumes, routes, platforms, ports and camera envelope from the register. Project walkable/support geometry separately from overhead eaves, canopies and foliage envelopes. A proxy may omit small structure and finish, but every mapped high-salience silhouette, proportion, volume, connection, spatial relation and broad distribution must remain visibly represented. Use simplified custom contours/volumes where a box, cone, disk or point marker would erase the intended form or depth pattern. Use neutral materials. Keep the complete environment and its negative spaces; do not build a hero object in isolation.
6. **Make routes and supports consume the final host geometry.** After the host mesh is final, sample the path at its final geometry spacing and across its full width. Derive route elevations, local frames and support contacts from the actual host surface or an explicit bridge/deck rule. A matching endpoint or centerline alone is insufficient.
7. **Review and repair before middle forms.** Render the target framing and the applicable plan, sections and orbit envelope. Fix topology, terrain silhouette, route fit, scale hierarchy and occlusion before adding middle-form structure or fine detail. Freeze and review this neutral spatial-only build using the proxy-stage contract below. If a gate fails, continue the spatial pass or report the specific blocker; do not label the stage released.

### Freeze and release the spatial-proxy stage before formal assets

The spatial review must be verifiably earlier than formal asset construction. Do not call a detailed, shaded first build a “proxy” after the fact. Before implementing formal asset meshes, detailed surface materials, or high-frequency scatter:

1. Build the complete scene envelope from proxies: terrain/major volumes, routes, support regions, camera targets, and negative spaces. Simple proxy geometry may encode spatially important curvature or height breaks; it must not contain the final asset's small structural forms or material finish.
2. Force a neutral gray material override. Disable detailed material maps, lookdev lighting, ornamental geometry, and fine scatter generators. Record every major spatial component in `proxy-inventory.json` with a stable `id`, `role: "proxy"`, its proxy representation and the spatial feature IDs from `visual-build-map.json` that the proxy preserves; record zero formal assets, detailed materials, and detail generators. Spatial features are silhouette, proportion, volume, connection, distribution and spatial-relation. Material and fine-detail features are deferred to their later stages.
3. Freeze the exact source file used for this capture. In `spatial-gate.json`, record its path and SHA-256; use a stable `buildId` shared by the source inventory, review record, and composition evidence.
4. Capture the actual running proxy build at the target view, plan/sections as applicable, and the full declared orbit envelope. Store a SHA-256 for every view image. Review these images while still in the proxy stage. `proxy-review.json` records the same build/hash, the exact reviewed sample IDs, the review result, reviewer, and `formalAssetsStarted: false`; it also records one image-linked observation for every spatial feature from the visual-build map. Do not use the composition review as a substitute for feature-level checks: “ridge is present” does not prove the registered crest profile or layered mass is represented.
5. Run the scope gate: `python3 <skill-root>/scripts/validate_delivery.py <project-root>/delivery-manifest.json --through spatialProxy`. This invokes the register and spatial-gate validators against the current project evidence. Only a passing record releases formal asset work. If geometry/layout/camera envelope changes afterward, regenerate dependent proxy evidence and repeat the gate before continuing.

The inventory and review are evidence records, not self-proving claims: visually inspect the referenced proxy images and compare the frozen source against its inventory. A file called “proxy” that contains formal asset code, final materials, or finished details is not a spatial-only build. When the project uses version control, preserve the frozen snapshot as a commit or immutable archive as well as the hash.

Example `proxy-inventory.json`:

```json
{
  "stage": "spatial-proxy",
  "buildId": "proxy-v01",
  "sourceSha256": "<sha256 of the frozen source file>",
  "renderMode": "neutral",
  "formalAssetsStarted": false,
  "formalAssetCount": 0,
  "detailedMaterialCount": 0,
  "detailGeneratorCount": 0,
  "components": [
    {"id": "main-landform", "role": "proxy", "proxyRepresentation": "low-resolution asymmetric ridge surface with stepped edge profile", "visualFeatureIds": ["ridge-profile"]},
    {"id": "circulation-network", "role": "proxy", "proxyRepresentation": "continuous route ribbons with named landings", "visualFeatureIds": ["route-continuity"]},
    {"id": "primary-volume", "role": "proxy", "proxyRepresentation": "stacked massing preserving the outer silhouette and major openings", "visualFeatureIds": ["primary-silhouette"]}
  ]
}
```

Example `proxy-review.json`:

```json
{
  "result": "PASS",
  "buildId": "proxy-v01",
  "reviewedSourceSha256": "<same sha256 as proxy-inventory.json>",
  "reviewedSampleIds": ["target-main", "orbit-000", "orbit-045"],
  "reviewer": "reviewer name or role",
  "formalAssetsStarted": false,
  "featureChecks": [
    {"featureId":"ridge-profile", "status":"PASS", "observation":"The neutral proxy retains the asymmetric crest and its falloff.", "evidence":["qa/orbit-045.png"]},
    {"featureId":"route-continuity", "status":"PASS", "observation":"The route ribbon reaches both landing proxies and remains visible through the bend.", "evidence":["qa/target-main.png"]},
    {"featureId":"primary-silhouette", "status":"PASS", "observation":"The major roof mass and opening remain distinct from the secondary volume.", "evidence":["qa/target-main.png"]}
  ]
}
```

When the manifest includes `spatialProxy`, its stage inputs must hash the same `visualBuildMapPath` produced by `visualAnalysis`; `proxyStage.visualBuildMap` must point to that file. The gate matches each component's `visualFeatureIds` and each review `featureChecks` entry to the map. This catches omitted requirements and stale handoffs; it does not judge whether the captured shape truly resembles the feature, so the reviewer must inspect the linked render.

## 3. Run two separate acceptance passes

Every check is `PASS`, `FAIL`, or `NOT_RUN`. `NOT_APPLICABLE` is allowed only with a reason. A stage cannot pass while an applicable check is `FAIL` or `NOT_RUN`. A record must identify method and current-build evidence; a generic “checked” statement is not evidence.

When the source register declares `sharedDrivers`, `dataIntegrity.consumerCheck` must be JSON that tests every declared driver and consumer. Change one meaningful driver input while holding other design inputs fixed; freeze seed, camera, resolution, and all unrelated inputs in `renderContract`. For each listed consumer, save distinct before/after outputs from the running build, record their SHA-256 values, and describe the observed response. The validator checks register hash, driver/consumer coverage, input change, paired output hashes, and file existence. It does not determine whether the change is semantically correct; inspect the paired outputs against the driver's meaning. If the field is declared but unused, shared-data integrity fails.

Example `consumer-check.json`:

```json
{
  "sourceRegisterSha256": "<sha256 of the exact spatial-register.json>",
  "renderContract": {"seed": 7, "camera": "proxy-main", "resolution": [1280, 720], "otherInputsLocked": true},
  "driverChecks": [{
    "driverId": "wetness-field",
    "inputChange": {"before": 0.2, "after": 0.8, "reason": "moves the wetness boundary across the test area"},
    "consumers": [
      {
        "id": "bank-profile",
        "baselineOutputSha256": "<sha256 of bank-before.png>",
        "perturbedOutputSha256": "<sha256 of bank-after.png>",
        "evidence": ["qa/bank-before.png", "qa/bank-after.png"],
        "observedEffect": "wetness transition moves the bank profile"
      },
      {
        "id": "plant-density",
        "baselineOutputSha256": "<sha256 of plants-before.png>",
        "perturbedOutputSha256": "<sha256 of plants-after.png>",
        "evidence": ["qa/plants-before.png", "qa/plants-after.png"],
        "observedEffect": "wet areas receive denser plants"
      },
      {
        "id": "rock-roughness",
        "baselineOutputSha256": "<sha256 of rock-before.png>",
        "perturbedOutputSha256": "<sha256 of rock-after.png>",
        "evidence": ["qa/rock-before.png", "qa/rock-after.png"],
        "observedEffect": "roughness region follows the same boundary"
      }
    ]
  }]
}
```

| Check | Minimum method/evidence | What a pass means |
|---|---|---|
| Register integrity | Unique IDs; all required references resolve; coordinate/unit consistency; plan/sections distinguish occupied, support, walkable and overhead areas when they differ | Data is internally consistent, not that the rendered shapes look right |
| Shape and host surface | Gray terrain field/guide view; mesh bounds; critical cross-sections through each major landform change | Main silhouette, breaks, openings and supporting surfaces match the intended design without interpolation spikes or unexplained folds |
| Route fit | Resample final route after subdivision at final mesh spacing; sample centerline and both edges against the final host mesh; inspect route in longitudinal section and travel-direction view | No unexplained floating, tunneling, abrupt grade/cross-slope or route swallowed by terrain; bridges/decks satisfy explicit span and clearance rules |
| Support/contact | Check each support's actual contact region or bearing interval against its host; show support debug view at critical joints | Each support reaches the declared host and the contact is visible/plausible; a proxy-box overlap alone is only a preliminary check |
| Composition | Unlabeled full-scene graybox at target aspect and camera; inspect thumbnail and full frame against the declared screen-space goals; record primary group occupancy, route readability, negative space and crop | Main/mid/background hierarchy, negative space, focal read and intended scale cues are legible; a full frame of scenery with unreadably small focal elements fails |
| Viewing envelope | For orbiting scenes, review eight azimuths plus declared pitch and distance limits; record per view the readable content, occlusion and boundary condition | All promised accessible views show designed scene content; “no black screen” alone is not a pass |

For composition, set scene-specific goals before adjusting the camera: identify the primary read, its target screen-space share or range, the secondary read, route/circulation visibility, negative-space purpose and intended crop. Use projected bounds or target-view measurements as diagnostics, not as a universal score. Check a no-label thumbnail and full frame; if scenery fills the frame while focal relationships are hard to read, the composition fails regardless of object count.

**Check semantic and geometric contact independently.** A route may lie within a structure's conservative bounds while missing its walkable surface, or touch the plan outline while floating above it. Verify its declared landing/deck/entry region and the emitted world-space mesh. For terrain support, a route-height function tested against itself can report zero deviation while the emitted `BufferGeometry` still floats or cuts into the rendered terrain. Measure the final route mesh against the final host mesh (for example, downward `Raycaster` queries or a mesh-distance query), and derive support bounds from the emitted world-space geometry. Report centerline and both route edges at the same or finer sampling density as the final mesh. Keep construction samples and verification samples separate; a shared design source is useful, but it is not independent geometric evidence.

For a complex terrain, include a plan diagnostic that overlays terrain guides, routes, zones and object anchors, plus at least two cross-sections through distinct terrain changes. For a simple flat interior, these terrain diagnostics are not applicable; inspect floor/wall, route, doorway and camera-clearance interfaces instead. Tailor evidence to the spatial problem without skipping the corresponding relation checks.

### Bind view evidence to the promised camera domain

Create `camera-envelope.json` from the viewing mode and limits requested in the brief or production spec. The gate record must point to it; do not describe only the screenshots actually taken, because that can silently narrow the promise. The contract records `mode`, `request.source`, `request.mode`, requested azimuth/polar-angle/distance bounds, implemented bounds, and an explicit `requiredSamples` list. A fixed/director-camera deliverable uses `viewEnvelope: NOT_APPLICABLE`; if a user requested free orbit, a narrower implementation is not a passing view envelope until the scope is agreed.

For an interactive 360° orbit, cover the promised full azimuth at the representative viewing pitch/distance, both requested polar-angle limits at four cardinal azimuths, and the requested near/far distance endpoints at opposite cardinal azimuths. This is a 20-view starting matrix (8 horizontal + 8 pitch-limit + 4 distance-limit captures); add views for an underside, roof, transparent layer, narrow passage, or any other geometry likely to fail between those samples. If the contract allows different bounds, sample those exact limits. Each captured view has a stable `sampleId` and its actual `azimuthDeg`, `polarDeg`, `distance`, image evidence, readable content, occlusion and boundary findings. The numeric matrix proves coverage only; inspect images and operate the actual page separately under [交付验收](validation.md#交互相机验收).

`polarDeg` follows spherical camera convention: `0°` is directly above the target, `90°` is level, `180°` is directly below. Generate the base matrix from the brief's exact bounds and store every row in `requiredSamples`:

```js
const requiredSamples = [];
for (let azimuthDeg = 0; azimuthDeg < 360; azimuthDeg += 45) {
  requiredSamples.push({ id: `orbit-${azimuthDeg}`, azimuthDeg, polarDeg: 90, distance: representativeDistance });
}
for (const azimuthDeg of [0, 90, 180, 270]) {
  for (const polarDeg of [requestedPolarMin, requestedPolarMax]) {
    requiredSamples.push({ id: `pitch-${azimuthDeg}-${polarDeg}`, azimuthDeg, polarDeg, distance: representativeDistance });
  }
}
for (const azimuthDeg of [0, 180]) {
  for (const distance of [requestedDistanceMin, requestedDistanceMax]) {
    requiredSamples.push({ id: `distance-${azimuthDeg}-${distance}`, azimuthDeg, polarDeg: 90, distance });
  }
}
```

Set `representativeDistance` to an interior value from the requested range. If the requested polar range excludes `90°`, replace the representative pitch with a central allowed value. Do not alter requested limits just to make the matrix easier to pass.

### Fail-closed status

Keep structural, geometric and visual status separate, for example:

```json
{
  "dataIntegrity": {"status":"PASS", "sourceRegister":"spatial-register.json", "consumerCheck":"qa/register-consumer-check.json", "method":"change one register point and confirm the rendered path and plan move", "evidence":["qa/register-consumer-check.json"]},
  "proxyStage": {"status":"NOT_RUN", "reason":"frozen neutral proxy has not been reviewed before formal asset work"},
  "surfaceQuality": {"status":"PASS", "guideOverlay":"qa/terrain-guides.png", "sections":["qa/section-across.svg", "qa/section-along.svg"], "method":"compare guide lines and emitted-mesh sections against intended landform changes", "evidence":["qa/terrain-guides.png", "qa/section-across.svg", "qa/section-along.svg"]},
  "routeFit": {"status":"NOT_RUN", "reason":"final route mesh has not been sampled against host geometry"},
  "supportContact": {"status":"NOT_APPLICABLE", "reason":"this scene has no separate support-bearing structures"},
  "composition": {"status":"FAIL", "buildId":"proxy-v01", "viewMode":"neutral-proxy", "method":"unlabeled target-view thumbnail and full-frame review", "evidence":["qa/overview-gray.png"], "criteria":[{"criterion":"primary and secondary reads are distinguishable", "status":"FAIL"}]},
  "viewEnvelope": {"status":"NOT_RUN", "reason":"orbit sectors have not been reviewed"}
}
```

Do not display a combined “spatial pass” when any required geometric or visual check is missing. If only register IDs, endpoints and support proxy volumes were checked, call the result `data/connection checks passed; spatial quality not yet evaluated`. A PASS must point to existing files and the category-specific evidence below; a hand-typed status alone cannot release the stage.

| Category marked PASS | Required record fields |
|---|---|
| `proxyStage` | Frozen `sourceSnapshot` path and matching `sourceSha256`; `buildId`; valid `inventory` and `reviewRecord` JSON referencing that same build/hash; review includes unique `reviewedSampleIds`; neutral-only mode; zero formal assets, detailed materials, and detail generators; `formalAssetsStarted: false`; each major spatial component listed as a proxy |
| `dataIntegrity` | `sourceRegister` and `consumerCheck` file paths; if `sharedDrivers` exists, the consumer check is JSON with a matching register SHA-256, one meaningful perturbation per driver, every registered consumer, changed output hashes and paired evidence files |
| `surfaceQuality` | `guideOverlay` file path and at least two existing `sections` files for complex terrain; use `NOT_APPLICABLE` with reason for surfaces that do not need terrain analysis |
| `routeFit` | `samples` file path plus numeric `maxEdgeDeviation` and `minClearance` from final route geometry against the final host mesh |
| `supportContact` | `contactReport` file path covering all applicable bearing points/regions |
| `composition` | `viewMode: "neutral-proxy"`, matching proxy `buildId`, `unlabeledViews` file paths, and all six dimension records: `focus-and-hierarchy`, `environment-and-depth`, `negative-space-and-crop`, `critical-relations`, `scale-and-occupancy`, and `task-specific`; each PASS has its own current evidence image, and each NOT_APPLICABLE gives a reason |
| `viewEnvelope` | Same `buildId` as `proxyStage`; a valid `contract` JSON linked to the user's viewing request; each contract `requiredSample` captured with matching coordinates, image evidence plus matching SHA-256, readable content, occlusion and boundary result; all sample IDs appear in the proxy review record |

Use the optional record validator when producing a machine-readable gate record:

```sh
python3 <skill-root>/scripts/validate_spatial_gate.py <project-root>/qa/spatial-gate.json
```

The script checks coverage and status discipline; it does not inspect a mesh or replace visual review.

## 4. Handoff to middle-form modeling

Release only when the full scene's spatial relationships and declared viewing envelope pass. Hand off the exact register revision, geometry representation/source for each major surface, route/host sampling results, support/contact map, camera envelope, current rendered evidence and unresolved assumptions. Middle-form modeling may enrich volumes and interfaces, but must preserve accepted placement, silhouette, circulation, support and visibility constraints. If those constraints change, return to the register and regenerate dependent geometry and drawings.
