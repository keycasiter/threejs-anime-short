# Scope-aware delivery contract

The production workflow uses a small JSON manifest to record which stages were performed, which exact artifacts they consumed and produced, and which build was reviewed. Run the validator at the relevant handoff, not only at the end. The manifest prevents a delivery from being labeled complete when required stages or evidence are absent; it cannot determine whether a picture is beautiful or a declared observation is truthful.

## Choose the requested scope

Start with the user's requested deliverable. Do not force a full production when the user requested only analysis or a spatial handoff.

| `mode` | Required stages | Use when |
|---|---|---|
| `mechanism-test` | `mechanismTest` | Testing one geometry, material, camera, animation, export or rendering behavior |
| `analysis-only` | `direction`, `visualAnalysis` | Delivering a visual analysis package only |
| `spatial-handoff` | `direction`, `visualAnalysis`, `runtimePreflight`, `spatialProxy` | Delivering a validated spatial plan and neutral Three.js proxy |
| `full-production` | all eleven stages | Delivering a finished Three.js scene, interactive page, animation, or film |

Use `../assets/templates/delivery-manifest.template.json` as the starting point for full production, `../assets/templates/asset-ledger.template.json` for the per-family review inventory, and `../assets/templates/visual-review.template.json` for the final review record. Replace every example ID and observation with evidence from the current build. Remove stages outside the chosen mode. The user may define a narrower deliverable explicitly; record that scope and validate its matching mode.

## Stage order and handoff rules

The ordered stage IDs are:

1. `direction` — selected target, visual brief, format and viewing mode.
2. `visualAnalysis` — image-backed visual reference index, visual-to-build map, object/relationship register, dimensions, coordinate frame, plan/sections and unknowns. In `analysis-only`, `spatial-handoff` and `full-production`, `sceneRegisterPath`, `visualReferenceIndexPath`, `visualBuildMapPath` and `diagramReviewReportPath` point to machine-readable artifacts and this stage hashes them as evidence. The diagram review report binds each register-derived plan/section source file to a rendered PNG preview and a concrete visual inspection observation; start from `../assets/templates/diagram-review.template.json`. The index must contain distinct global views, a plan/section view, and a focused reference for each renderable object/route; the map converts reference observations into constraints and Three.js construction plans for every renderable object/route. Image files and hashes must be present in the project.
3. `runtimePreflight` — a minimal running Three.js page verifies the target browser, WebGL backend, dependency source and server path before scene implementation. It records a real canvas capture, browser/version, backend, dependency strategy, errors and failed requests.
4. `spatialProxy` — frozen neutral Three.js proxy, asset inventory, review record, camera contract and spatial gate. `spatialGatePath` points to the gate; its proxy stage must precede formal asset work.
5. `middleForms` — actual major geometry and connection methods, with representative renders or geometric checks. Before scaling the full asset set, capture and review one representative of every distinct asset morphology against its visual-build-map features. `assetLedgerPath` points to a machine-readable ledger grouping every renderable scene-register object and route into reviewable asset families. Each family names its priority, mapped feature IDs, representative target/component, the hashed source file and declared builder symbol that produce it, prototype capture and feature-level review, plus final visual checks. The source file must be evidence for the same `middleForms` build; a prose label such as “roof and trim construction” is not a component trace. This stage hashes the ledger, implementation source and each prototype capture as evidence. A passing proxy or complete code inventory cannot substitute for a rendered representative form.
6. `detailDistribution` — constrained placement and scale/density evidence for detail families.
7. `lookdev` — material/light setup and fixed-view comparisons on the current build.
8. `cameraMotion` — final camera domain, animation/interactivity samples and control behavior.
9. `runtime` — runtime report for the exact final build and target Three.js/browser versions.
10. `visualReview` — visual inspection of every runtime sample across required dimensions.
11. `delivery` — final runnable output, source, dependencies and run instructions.

Each stage record contains `id`, `status`, its own `buildId`, `inputs`, and `evidence`. Every evidence item is a project-relative `{ "path": "...", "sha256": "..." }`. Inputs must be the same path and hash as an artifact produced by an earlier stage. The stage order must follow the sequence above. Stage-specific build IDs reflect the real progression from design to proxy to finished scene. The top-level manifest `buildId` identifies the final deliverable build; `runtime`, `visualReview`, and `delivery` must match it. The `spatialProxy` stage ID must match the frozen build recorded inside its spatial gate. When a later edit changes geometry, materials, cameras or runtime code, update the affected stage IDs and regenerate downstream evidence.

Stage status must be `PASS` for the selected scope. `FAIL` and `NOT_RUN` remain visible as blockers. A scope decision belongs in `mode`, not in a false `PASS` for work that was skipped.

## Gates and commands

Complete visual analysis, render and visually inspect the registered plan/sections, and validate the register first. Record diagram source/preview hashes and the review in `diagramReviewReportPath`; `validate_delivery.py` blocks missing previews and invalid PNG signatures/sizes; the reviewer must also confirm that drawing content is actually legible. Then run the runtime preflight before scene implementation. Run the delivery validator through the neutral proxy before making formal assets; that command also runs the scene-register and spatial-gate validators. Then validate the full manifest before delivery.

The preflight report records `status`, its stage `buildId`, `threeVersion`, `browser`, initialized `renderer`, `dependencyStrategy`, empty `consoleErrors`/`failedRequests`, and a hashed capture of the minimal Three.js canvas. Start from `../assets/templates/runtime-preflight.template.json`. Choose the dependency strategy from the requested environment: local bundle/vendor files for offline delivery, or a pinned remote module only when network availability is part of the target. The preflight must resolve the same source/version and addon family planned for the scene. For native ESM, vendor the complete transitive import graph or bundle it into the selected entry; a copied `three.module.js` may still import sibling core/addon files. Preserve the package license. Run `validate_offline_html.mjs` to check local markup resources and statically discoverable module imports, then run the actual preflight in the target browser: computed fetch paths, workers and renderer initialization require runtime evidence.

```bash
python3 <skill-root>/scripts/validate_scene_register.py <project-root>/design/scene-register.json
python3 <skill-root>/scripts/validate_delivery.py <project-root>/delivery-manifest.json --through spatialProxy
python3 <skill-root>/scripts/validate_delivery.py <project-root>/delivery-manifest.json
```

For an analysis-only or spatial handoff, run the final command with its matching mode. The `--through STAGE_ID` option checks only the required prefix through that stage, which lets a full-production manifest release the proxy before downstream stages exist. Resolve `<skill-root>` from the invoked Skill package and keep `<project-root>` at the directory containing the manifest; do not assume the scene project and Skill package share a working directory.

The validator checks file existence, project-relative paths, SHA-256 values, stage order, stage-specific build IDs, prior-stage input provenance, required scope coverage, the preflight report, scene register, spatial gate, complete asset-family mapping, final runtime error/request status, camera-sample coverage, per-family review coverage and final deliverable hashes. It checks that each prototype's named builder symbol is declared in its hashed source file, but this does not prove the function is called, visible, or responsible for the reviewed feature. It prints `DELIVERY_PASS` only when the selected structural contract is complete. It does not launch the browser or judge visual quality; it validates the captured runtime and human-review records supplied by the producer. Inspect the actual captures and geometry before marking visual checks PASS.

## Runtime and review evidence

`runtimeReport` points to JSON with this minimum shape; `cameraContractPath` points to the exact contract produced by `cameraMotion` and consumed as an input by `runtime`:

```json
{
  "status": "PASS",
  "buildId": "scene-v01",
  "threeVersion": "0.180.0",
  "browser": "Chromium 140",
  "consoleErrors": [],
  "failedRequests": [],
  "captures": [
    {"id": "orbit-000", "azimuthDeg": 0, "polarDeg": 90, "distance": 5,
     "path": "qa/orbit-000.png", "sha256": "<sha256>"}
  ]
}
```

Use the actual bundled/imported Three.js version and browser. Every capture ID must match a declared `requiredSamples` ID and include its image hash; when sample coordinates are present, the capture coordinates must match. The snippet shows one capture record; list every required capture in the report. A full 360-degree contract requires at least 20 envelope samples: eight roughly even azimuths, pitch endpoints at four cardinal azimuths, and near/far distance endpoints. Extra views are required for undersides, backs, transparent elements, narrow passages and other scene-specific risks. A capture list establishes sampling coverage, not visual quality.

`visualReviewReport` points to JSON with the same `buildId`, a named reviewer, the exact set of runtime `reviewedSampleIds`, and concrete observations for each dimension: `composition`, `spatial-depth`, `middle-form`, `detail-distribution`, `material-lighting`, `orbit-coverage`, and `interaction`. Applicable checks need a concrete PASS observation. A fixed-camera delivery may mark `orbit-coverage` and `interaction` `NOT_APPLICABLE` with a reason; an interactive-orbit delivery must pass both. Review images remain linked by the runtime capture IDs and hashes.

The review must also contain a `familyReviews` entry for every family in the asset ledger. Each entry names runtime sample IDs that visibly include that family and records a concrete PASS observation for every required check in that family. Review the pixels first, then trace a feature claim through the named source symbol to the rendered mesh/instance/material and confirm the same build ID. Do not infer successful implementation from an existing function, visible ID, nonzero pixel delta or status authored by the producer. All priorities share the same minimum integrity checks: silhouette, volume transition, connections/support, material response, spatial relation and detail scale. Priority determines where pixel density and refinement effort go; it does not excuse incomplete geometry, floating parts, broken connections or unreadable material behavior. Group repeated instances only when they share a form/production method and can be meaningfully inspected together; do not group unlike components to hide omissions. The gate verifies ID coverage and evidence structure, while the reviewer judges whether the object actually meets the criterion.

## Scope limits

For a fixed-camera film, mark the free-orbit criterion not applicable in the review and explain the chosen camera mode; do not create artificial orbit requirements. When the user requests 360-degree viewing, orbit coverage and interaction checks apply. A technical prototype may be delivered as a prototype only when that scope is explicit, using the corresponding limited mode; it cannot pass as a full production artifact.

## Stop branch for a blocked gate

If runtime preflight or the proxy release returns `BLOCKED`, `FAIL`, or `NOT_RUN`, do not continue into middle-form assets, detail systems, or final lookdev. First fix the smallest upstream cause: launch the permitted browser/runtime path, resolve the selected dependency strategy, repair the proxy, or complete missing evidence; then rerun the same gate. If the environment cannot be made usable, preserve the preflight/space-handoff artifacts and report the full-production deliverable as blocked at that stage. Source scaffolding written for diagnosis is not a substitute for permission to proceed into the next production stage.
