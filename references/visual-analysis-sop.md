# Visual-analysis SOP: scene evidence to buildable spatial handoff

## Purpose

Convert a creative brief and visual references into an auditable scene description that the next spatial-blockout stage can build without inventing core placement and connection relationships. This stage specifies **what occupies the scene, where it sits, what it touches/connects to, what evidence supports it, and what remains a design assumption**. It does not create the final Three.js scene or claim engineering dimensions.

## 1. Lock the brief and coordinate contract

1. Restate the deliverable, viewing mode, subject, and any hard constraints. Separate user-fixed facts from creative choices.
2. Choose one world convention before taking measurements. Example: `X=east/right`, `Y=up/elevation`, `Z=north/up-page`; state units and origin. Keep it through plans, sections, JSON, and Three.js.
3. Establish a bounded site envelope from the reference or explicitly mark it as a normalized design envelope. Use human/object scale only as an estimate unless sourced.
4. Label each statement `Observed`, `Inferred`, `Designed`, or `Unknown`. A generated concept image is visual evidence for composition, not proof of factual geometry or dimension.

## 2. Build an evidence set that answers questions

Do not target a fixed number of images. Add views until each high-impact uncertainty has evidence or a recorded assumption. Each view must have a purpose and map to one or more questions.

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

Stage 1 hands off the brief, evidence index, relationship register, shared spatial JSON, dimensioned plan/elevations/sections, uncertainty list, and checks for Stage 2. Stage 2 builds a neutral Three.js whitebox from that exact JSON and reports objective failures: missing IDs, unresolved endpoints, unsupported objects, route gaps, terrain intersections, clearance violations, inconsistent levels, and orbit-view holes. Any failure on a high-impact relationship returns to Stage 1 for evidence or an explicit design decision.

The next production stages consume the same IDs and spatial source:

`Stage 2 whitebox placement/support → Stage 3 middle-form volume and interfaces → Stage 4 asset detail and distribution → Stage 5 material/light response`

Stage 3 may change geometry within the chosen bounds but must preserve named interfaces, supports, circulation and silhouette constraints. Stage 4 distributes detail using host surfaces, slope/height/distance and exclusion zones from the register. Stage 5 maps mood to light/material signals without moving the scene. If a downstream stage changes a relation or core placement, update the source register and regenerated drawings; do not let two “truths” drift.

## 8. Deliver and gate

A Stage 1 package is ready only when:

- Every dominant mass and high-impact relation has a source view or explicit design assumption.
- The view set covers global composition, plan/adjacency, important elevations/sections, major-object form, and critical joints; duplicate views are justified or removed.
- All major objects have stable IDs, placement/scale/orientation, support/host, and important ports/connections.
- Route endpoints, grade/steps, supports, terrain samples, and section stations are explicit where applicable.
- Drawings and register agree; axes, units, dimensions and statuses are unambiguous.
- Unknowns/conflicts remain visible and identify what decision or evidence would resolve them.
- Stage 2 can construct the whitebox without inventing any high-impact location or connection.

If the user requested only visual analysis, stop at this handoff. Do not make the Three.js scene unless asked. A passing Stage 1 package is not proof of final visual quality; it is a reliable input contract for subsequent stages.

Before handoff, run the structural validator on the actual register:

```bash
python3 <skill-root>/scripts/validate_scene_register.py <project-root>/design/scene-register.json
```

`SCENE_REGISTER_PASS` confirms ID/reference/provenance and coordinate-interface consistency. It does **not** prove the visual interpretation is true, the design is attractive, code can render every shape, engineering is safe, or the diagrams are faithful unless those diagrams were generated from the register. A structural failure blocks handoff and must be resolved at source; do not suppress it by changing only the report.
