# Visual-analysis SOP: scene evidence to buildable spatial handoff

## Purpose

Convert a creative brief and visual references into an auditable scene description that the next spatial-blockout stage can build without inventing core placement and connection relationships. This stage specifies **what occupies the scene, where it sits, what it touches/connects to, what evidence supports it, and what remains a design assumption**. It does not create the final Three.js scene or claim engineering dimensions.

## Contents

- [Lock the brief](#1-lock-the-brief-and-coordinate-contract)
- [Build the evidence set](#2-build-an-evidence-set-that-answers-questions)
- [Extract features into build constraints](#extract-visual-features-into-build-constraints)
- [Decompose site to interface](#3-decompose-from-site-to-object-to-interface)
- [Create the spatial source](#4-produce-a-single-spatial-source-of-truth)
- [Drawings and handoff](#5-create-cad-like-drawings-from-the-register)

## 1. Lock the brief and coordinate contract

1. Restate the deliverable, viewing mode, subject, and any hard constraints. Separate user-fixed facts from creative choices.
2. Choose one world convention before taking measurements. Example: `X=east/right`, `Y=up/elevation`, `Z=north/up-page`; state units and origin. Keep it through plans, sections, JSON, and Three.js.
3. Establish a bounded site envelope from the reference or explicitly mark it as a normalized design envelope. Use human/object scale only as an estimate unless sourced.
4. Label each statement `Observed`, `Inferred`, `Designed`, or `Unknown`. A generated concept image is visual evidence for composition, not proof of factual geometry or dimension.

## 2. Build an evidence set that answers questions

Do not target a fixed number of images. Add views until each high-impact uncertainty has evidence or a recorded design decision. Each view must have a purpose and map to one or more questions. Preserve the selected image files under the project and record them in `design/visual-reference-index.json`; the image index is a Stage 1 handoff artifact, not an informal inspiration folder.

### Build the visual reference packet

1. **Use the user's material first.** Inventory every supplied image/video/frame and note its actual view, visible coverage, and unresolved sides. Search for factual references when identity or construction depends on real-world evidence. Do not replace reliable facts with generated guesses.
2. **Fill missing visual decisions deliberately.** If there is no usable image reference, use the available image-generation tool to make design proposals: first a scene-wide composition, then alternate global elevations/azimuths, then isolated views for each major object, critical joint, surface family, and material/light response that affects the target. Reuse the chosen master design as a visual anchor in follow-up prompts; ask for one view per image when a contact sheet would make scale or details unreadable. There is no maximum image count. Stop only when the questions needed by the next stage are answered or explicitly recorded as designed/unknown.
3. **Prompt for inspectable structure.** Hold identity, palette, lighting intent, and normalized scale cues constant across a set; vary only the camera or the part being examined. Ask for uncluttered silhouette, visible support/contact, exposed underside/back where orbiting matters, and useful scale cues. Do not ask a generated image to prove dimensions, hidden construction, or geographic truth.
4. **Separate scene views from object views.** A global beauty view establishes composition and depth, not the exact shape of every participant. Add plan/section or axonometric views for layout and level changes, full views of major objects from sides they must expose, then close details for openings, joints, edges, and material transitions. For free-orbit work, include the far side, top, and relevant underside where the camera can reach them.
5. **Annotate, compare, and freeze.** For every file record its source or generation prompt, direction/coverage, the question it answers, target object/route IDs, what it cannot prove, and confidence. Mark generated images as design proposals. Resolve disagreements by selecting one design or recording the remaining uncertainty; do not silently combine conflicting dimensions or shapes. Hash the reference index as visual-analysis evidence. Use `assets/templates/visual-reference-index.template.json` and set `visualReferenceIndexPath` in the manifest.

### Extract visual features into build constraints

The image index proves that images exist and are locatable. It does not explain which visible properties the model must preserve or how Three.js will create them. Before handoff, create `design/visual-build-map.json` from `assets/templates/visual-build-map.template.json` and record it as `visualBuildMapPath` in the manifest.

Create one entry for every renderable registered object and route. Extract the features that define recognition and quality; avoid generic descriptions such as “detailed, realistic, cinematic.” Choose the feature families that apply:

| Feature | Convert the observation into |
|---|---|
| Silhouette / proportion | Relative width, height, taper, curvature, overhang, voids and dominant profile stations |
| Volume / construction | Primary masses, cross-sections, thickness, panel breaks, transitions, recesses and openings |
| Connection / support | Named attachment points, bearing faces, brace direction, embedment, clearance and visible contact |
| Material | Separate material regions, grain/roughness scale, edge wear, translucency, metal response and their locations |
| Distribution / relation | Host surface, clustering rule, density gradient, scale variation, exclusion zones and relation to focal forms |
| Detail | Repeated unit, physical scale, orientation, placement rule and distance where it must remain readable |

For each feature, record `referenceId → visible observation → design constraint → confidence`. A constraint tells the next stage what to preserve and how to check it. For example, “the shell narrows through its upper third and the lower rim projects beyond it” becomes “keep an upper taper and a projecting rim in front and three-quarter views”; it does not become “add more cylinders.” Include dimensions only when sourced or clearly label them as design estimates.

Specify a concrete Three.js construction for each object/route: named component function, geometry representation (such as a lathe profile, custom `BufferGeometry`, swept tube, layered shell, truss or instanced family), construction order, parameters, material regions and the view that exposes the result. Pick a representation because it can express the observed form and transitions. A group of unrelated `BoxGeometry`, `SphereGeometry` and `CylinderGeometry` primitives is not an adequate plan for a form whose identity depends on continuous curvature, custom openings, layered edges or articulated joints.

Record intentional changes separately from observed features. Later stages may refine the implementation, but must not silently discard high-salience silhouette, material breakup, joints, density or spatial relations. A deliberate deviation names its reason, affected views and the replacement feature that preserves the design intent.

The map validator checks IDs, source references, target coverage and plan fields. It cannot decide whether an observation is correct or a form is attractive; later rendered prototypes and final review compare the actual image against these constraints.

Reference images are for analysis and design. The final asset remains code/model geometry assembled, lit, animated, and rendered by Three.js unless the user explicitly requests image planes or image textures.

| View family | Questions it must resolve |
|---|---|
| Global establishing views from distinct azimuth/elevation | Overall silhouette, dominant mass, foreground/midground/background, occlusion, horizon and open voids; alternate views must reveal genuinely new relations |
| Top/plan or axonometric | Footprints, orientation, spacing, routes, shoreline/terrain boundaries, adjacency and missing pieces behind the hero view |
| Front/side elevation and terrain sections | Height tiers, embedded/cantilevered parts, supports, cliff profile, level changes, clearance and contact with ground/water |
| Full views of each major object from useful sides | Complete silhouette and whether it is freestanding, attached, nested, open, or enclosed |
| Joint/port/detail views | How pieces meet: bearing surface, fastener/support direction, seam, opening, transfer, or fluid/energy route |
| Scale/material cues | Repeated units, human/door/rail scale, weathering zones and material boundaries; do not infer exact dimensions from perspective alone |

For each reference, record source, view direction, coverage, what it proves, what it cannot prove, and confidence. Mark duplicated coverage, perspective distortion, hidden faces, contradictions, and unsupported guesses. If a design image is generated to fill a gap, label it as a design proposal and do not treat it as source truth.

## 3. Decompose from site to object to interface

Use a hierarchy that survives handoff:

`site envelope → terrain/water masses → spatial zones/platforms → paths and circulation → major assets → subassemblies → interfaces/ports → repeated detail families`

For every major item, give a stable ID and a role. Describe bounding form and orientation, not just appearance. Distinguish:

- **Placement:** center/anchor, footprint or bounds, heading, base/top elevation, and level.
- **Support:** what bears it, where support contacts occur, whether it is embedded, perched, suspended, or floating.
- **Connection:** start/end IDs and named ports, port coordinates/directions, connection type, and continuity requirements.
- **Adjacency/clearance:** required neighbor, side, gap, access corridor, opening, or exclusion zone.
- **Occlusion/visibility:** intended reveal direction and faces that must exist for orbiting views.
- **Evidence:** reference/view ID and status (`observed`, `inferred`, `designed`, `unknown`) with confidence.

Do not use vague relations such as “near”, “along”, “connected” or “on the cliff” without naming the actual pair and spatial/structural relation.

## 4. Produce a single spatial source of truth

Create one machine-readable scene register (JSON/YAML/CSV) consumed by the plan, sections, and later Three.js whitebox. Minimum schema:

```json
{
  "world": {"units":"m (design estimate)","up":"Y","origin":"site center","axes":{"x":"east","z":"north"}},
  "evidence": {
    "view-id": {"status":"Observed","source":"reference view URL or local file"},
    "water-edge-view": {"status":"Observed","source":"reference detail URL or local file"}
  },
  "objects": [{
    "id":"asset-id", "kind":"platform", "status":"Designed", "evidence":["view-id"],
    "anchor":{"space":"world","xyz":[0,0,0]}, "headingDeg":0,
    "geometryRole":"solid",
    "bounds":{"size":[1,1,1],"center":"anchor"}, "baseY":-0.5,"topY":0.5,
    "ports":[{"id":"out","space":"world","at":[0,0,0],"direction":[0,0,1],"role":"route-start","evidence":["view-id"]}],
    "fieldEvidence":{"anchor":{"status":"Designed","sourceIds":["view-id"],"confidence":"high"}},
    "relations":[]
  }, {
    "id":"other-id", "kind":"platform", "status":"Designed", "evidence":["view-id"],
    "anchor":{"space":"world","xyz":[1,0,3]}, "headingDeg":0,
    "geometryRole":"solid",
    "bounds":{"size":[1,1,1],"center":"anchor"}, "baseY":-0.5,"topY":0.5,
    "ports":[{"id":"in","space":"world","at":[1,0,3],"direction":[0,0,-1],"role":"route-end","evidence":["view-id"]}],
    "fieldEvidence":{"anchor":{"status":"Designed","sourceIds":["view-id"],"confidence":"high"}},
    "relations":[]
  }],
  "routes": [{"id":"route-id","kind":"walkway","status":"Designed","evidence":["view-id"],"coordinateSpace":"world","width":1.5,"points":[[0,0,0],[1,0,3]],"ports":[{"id":"start","space":"world","at":[0,0,0],"evidence":["view-id"]},{"id":"end","space":"world","at":[1,0,3],"evidence":["view-id"]}],"connects":["asset-id.out","other-id.in"]}],
  "sections": [{"id":"section-id","plane":"vertical","station":"x=0","points":[[0,0,0],[0,0,1]],"objectIds":["asset-id"]}],
  "sharedDrivers": [{
    "id":"wetness-field", "meaning":"distance-decayed wetness from the water edge",
    "coordinateSpace":"world", "units":"unitless",
    "producer":{"kind":"function","ref":"terrain-fields.mjs","symbol":"wetnessAt(x,z)"},
    "evidence":["water-edge-view"],
    "consumers":[
      {"id":"bank-profile","system":"geometry","output":"shoreline profile"},
      {"id":"plant-density","system":"distribution","output":"instance density"},
      {"id":"rock-roughness","system":"material","output":"roughness region"}
    ]
  }],
  "unknowns": [{"id":"unknown-door","question":"Is the far-side opening passable?","impact":"Determines the circulation route.","proposedAssumption":"Treat as closed until a plan view confirms otherwise."}]
}
```

Keep confidence and source provenance attached to the field or relationship they support, not only in a closing paragraph. Never silently convert a visual estimate into measured truth. Use explicit `null`/unknown where unresolved.

Declare a `sharedDriver` when one designed/observed spatial field or layout value is intended to drive two or more downstream systems. Name its producer and every intended consumer by stable ID, system, and observable output. Do not add a shared field merely to make the register look technical; if geometry, placement, and material are independent hand-authored decisions, record those inputs separately. When a shared driver is declared, Stage 2 must perturb it and show that every declared consumer changes; a field name or code comment is not evidence of data flow.

### Coordinate and connection semantics

- `anchor.xyz` is the **center of the object's axis-aligned bounds** in the declared world coordinate system. `bounds.size` is a positive full extent in X/Y/Z; `baseY` and `topY` must equal `anchor.y ± bounds.size[1]/2` within a small numeric tolerance. For non-box or asymmetric objects, keep this as a conservative envelope and add a separately named placement datum or profile; do not overload the anchor to mean both center and base.
- Every object or route port has a stable local ID and a finite world-space coordinate. A route's `connects` lists its start and end targets in path order. Each target uses `ownerId.portId`, where owner can be an object or another route. The first/last route point must coincide with those ports within the declared tolerance; a visually close endpoint is not a connection.
- If a route joins another route at an interior junction, declare a named route port at the exact sampled point. Do not invent `.start`, `.end`, or junction port names only inside a sentence.
- Every high-impact modeled field, port, and relation carries `status`, `sourceIds`, and confidence. Sources must resolve to the evidence index. A generated design reference may support a `Designed` proposal, but cannot support a claim that a hidden object or dimension was observed.
- Object IDs are globally unique across object and route collections. `hostSurfaceId`, `supportIds`, relation targets, route references, ports, section member IDs, and evidence IDs must all resolve to the correct entity type.
- Declare whether each spatial record is renderable geometry or only a constraint envelope. A vegetation spread, clearance volume, excavation allowance, or visibility zone must carry `geometryRole: "distribution-envelope"` or `"clearance-envelope"`; downstream code must not instantiate that full bound as a solid object. Use `solid`, `surface`, or `path` for actual modeled content, with the semantic `kind` and form/profile describing its constructible shape.

## 5. Create CAD-like drawings from the register

Provide a dimensioned plan, at least one cross-section through the most important vertical relation, and a longitudinal section whenever terrain/path grade or a long connection matters. Add sections at enough stations to reveal changing cliff/ground profile; one section cannot prove an entire route is supported. Annotate IDs, axes, level/elevation, dimensions as measured/estimated/designed, support points, port endpoints, visibility arrows, and evidence IDs.

Use actual CAD only when available and useful. Otherwise generate clean SVG/PDF drawings from the same spatial register and label them **design/blockout diagrams, not engineering CAD**. Do not manually redraw numbers independently of the register. Avoid making an unlabeled beauty sketch stand in for a plan or section.

The generator must read coordinates, extents, object IDs, section stations, and route samples from the register. A hand-drawn illustrative section is not accepted as a measured view of the registered scene. Each section must name the plane/station and list intersected objects or sampled route IDs. If a diagram deliberately simplifies geometry, label it as a schematic and retain a separate projected view from the register so the receiver can distinguish explanation from spatial evidence.

## 6. Specify continuous terrain and routes

For terrain that carries objects or paths, define a surface/mass envelope and sampled profiles, not a single picturesque silhouette. For each route/path/bridge/stair/dock:

- Record ordered centerline points with elevations and orientation; define width, clearances, landing/turn points and endpoints.
- State longitudinal grade or step/riser strategy and cross-slope where relevant.
- Attach every endpoint to a named platform/port; identify its host surface and supports at turns, spans and ends.
- For bridges/docks/cantilevers, show bearings/supports and what spans clear. For stairs, show top/bottom landings and elevation change.
- Require multiple terrain sections along complex or winding paths, including key turns, attachments, crossings and unsupported-looking spans.

## 7. Make the handoff executable by the next stage

Stage 1 hands off the brief, image index, visual-build map, relationship register, shared spatial JSON, dimensioned plan/elevations/sections, uncertainty list, and checks for Stage 2. Stage 2 builds a neutral Three.js whitebox from that exact JSON and reports objective failures: missing IDs, unresolved endpoints, unsupported objects, route gaps, terrain intersections, clearance violations, inconsistent levels, and orbit-view holes. Any failure on a high-impact relationship returns to Stage 1 for evidence or an explicit design decision.

The next production stages consume the same IDs and spatial source:

`Stage 2 whitebox placement/support → Stage 3 representative-asset prototype gate → Stage 3 middle-form volume and interfaces → Stage 4 asset detail and distribution → Stage 5 material/light response`

Before expanding the full asset set, Stage 3 builds one complete representative asset for every distinct asset family: characteristic profile, major transition, a real connection, material regions and the context needed to judge scale. Capture an actual close view at the target output size and compare it with the mapped reference features. Record capture IDs, feature-by-feature observations, gaps and a PASS/BLOCK decision. A blocked feature returns to form design or its geometry representation, not generic detail accumulation. Expand only after focal/supporting families and each distinct ambient morphology have readable prototypes. Stage 3 may change geometry within the chosen bounds but must preserve named interfaces, supports, circulation and silhouette constraints. Stage 4 distributes detail using host surfaces, slope/height/distance and exclusion zones from the register. Stage 5 maps mood to light/material signals without moving the scene. If a downstream stage changes a relation or core placement, update the source register and regenerated drawings; do not let two “truths” drift.

## 8. Deliver and gate

A Stage 1 package is ready only when:

- Every dominant mass and high-impact relation has a source view or explicit design assumption.
- The view set covers global composition, plan/adjacency, important elevations/sections, major-object form, and critical joints; duplicate views are justified or removed.
- All major objects have stable IDs, placement/scale/orientation, support/host, and important ports/connections.
- Route endpoints, grade/steps, supports, terrain samples, and section stations are explicit where applicable.
- Drawings and register agree; axes, units, dimensions and statuses are unambiguous.
- Unknowns/conflicts remain visible and identify what decision or evidence would resolve them.
- Stage 2 can construct the whitebox without inventing any high-impact location or connection.
- Every renderable object/route has reference-linked observations, explicit design constraints and a technically plausible Three.js construction plan in `visual-build-map.json`.

If the user requested only visual analysis, stop at this handoff. Do not make the Three.js scene unless asked. A passing Stage 1 package is not proof of final visual quality; it is a reliable input contract for subsequent stages.

Before handoff, run the structural validator on the actual register:

```bash
python3 <skill-root>/scripts/validate_scene_register.py <project-root>/design/scene-register.json
```

`SCENE_REGISTER_PASS` confirms ID/reference/provenance and coordinate-interface consistency. It does **not** prove the visual interpretation is true, the design is attractive, code can render every shape, engineering is safe, or the diagrams are faithful unless those diagrams were generated from the register. A structural failure blocks handoff and must be resolved at source; do not suppress it by changing only the report.
