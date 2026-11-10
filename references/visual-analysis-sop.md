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
  "objects": [{
    "id":"asset-id", "parentId":"zone-id", "kind":"terrain|platform|building|path|prop",
    "status":"observed|inferred|designed|unknown", "evidence":["view-id"],
    "anchor":{"x":0,"y":0,"z":0}, "headingDeg":0,
    "bounds":{"x":1,"y":1,"z":1}, "baseY":0,"topY":1,
    "hostSurfaceId":"terrain-id", "supportIds":["support-id"],
    "ports":[{"id":"in","at":[0,0,0],"direction":[0,0,1],"role":"path-start"}],
    "relations":[{"type":"connects-to","targetId":"other-id","via":"in → out"}]
  }],
  "routes": [{"id":"route-id","kind":"walkway","width":1.5,"points":[[0,0,0],[1,-2,3]],"gradeLimit":"design check","connects":["port-a","port-b"]}],
  "sections": [{"id":"section-id","axis":"...","stations":[[0,0,0],[1,0,1]]}],
  "unknowns": [{"question":"...","impact":"...","proposedAssumption":"..."}]
}
```

Keep confidence and source provenance attached to the field or relationship they support, not only in a closing paragraph. Never silently convert a visual estimate into measured truth. Use explicit `null`/unknown where unresolved.

## 5. Create CAD-like drawings from the register

Provide a dimensioned plan, at least one cross-section through the most important vertical relation, and a longitudinal section whenever terrain/path grade or a long connection matters. Add sections at enough stations to reveal changing cliff/ground profile; one section cannot prove an entire route is supported. Annotate IDs, axes, level/elevation, dimensions as measured/estimated/designed, support points, port endpoints, visibility arrows, and evidence IDs.

Use actual CAD only when available and useful. Otherwise generate clean SVG/PDF drawings from the same spatial register and label them **design/blockout diagrams, not engineering CAD**. Do not manually redraw numbers independently of the register. Avoid making an unlabeled beauty sketch stand in for a plan or section.

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
