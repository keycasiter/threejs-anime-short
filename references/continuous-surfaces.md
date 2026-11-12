# Continuous surfaces: representation, topology and real attachments

Choose a representation from the topology you need. A higher segment count cannot turn a closed solid into a hollow wall or make separate intersecting meshes into a fused junction.

| Required shape | Generator and input | Result and verified boundary |
|---|---|---|
| Corresponding noncircular cross-sections, taper and authored twist | `createProfileLoftSource(T,{stations,reference,caps,uvMeters})` in `assets/geometry/profile-loft.mjs` | Parallel-transport frames; actual triangle queries; concave ear-clipped caps. Simple 2D rings and equal correspondence counts/winding are checked. Global 3D intersections remain unproven. |
| A curved sheet with visible underside, thickness and an open space beneath it | `createBezierPatchShell(T,{controlPoints,thickness,segmentsU,segmentsV,uvMeters})` in `assets/geometry/bezier-shell.mjs` | General bicubic patch, normal-offset inner layer, four explicit thickness walls and six material groups. Sampled Jacobians and emitted Float32 triangles are checked. Offset self-intersection between samples remains unproven. |
| A fused branch, blended support or changing topology | `createImplicitSurfaceSource(T,{MarchingCubes},{field,bounds,resolution,isoValue,maxTriangles})` in `assets/geometry/implicit-surface.mjs` | Injected official same-version MarchingCubes; world-space positions/gradient normals, independent cropped output. Nonfinite values, nonexterior sampled boundaries, empty extraction and capacity overflow fail explicitly. Subvoxel features remain unproven. |

The code and `scripts/tests/core-shape.test.mjs` are the evidence for these API statements. The test uses real Three.js geometry and the official addon: triangle barycentrics/winding, concave cap area, welded edge incidence, metric UVs, nonuniform bounds, fusion, failures and disposal events. These checks establish local construction behavior; they do not certify global intersection freedom or final visual quality.

## Profile loft

```js
const source=createProfileLoftSource(T,{
  stations:[
    {center:[0,0,0],profile:[[-1,-.6],[1,-.6],[.7,.8],[-.5,1]]},
    {center:[0,1.8,0],profile:[[-.8,-.7],[.9,-.5],[.5,.9],[-.6,.7]],rollRadians:.35},
    {center:[.3,3.5,.2],profile:[[-.5,-.5],[.6,-.4],[.4,.5],[-.4,.6]],rollRadians:-.15},
  ],reference:[1,0,0],caps:true,uvMeters:.5,
});
const hit=source.surfaceAt(.42,.3);
// hit.point, normal, tangent, frame, segmentIndex, triangleIndex
```

Each `profile` is an unclosed simple array of `[x,y]` coordinates in world units. Concavity is allowed. Omit a repeated closing point; duplicate edges, collinear corners, self-crossing/touching edges, inconsistent winding and inconsistent point counts fail. CW or CCW is accepted when every station agrees. Vertex `j` must describe the same feature at every station: the code can check counts and winding, not the semantic correspondence selected by the author.

The first `reference` projects into the plane perpendicular to the first centerline tangent. It must not be parallel to that tangent. Subsequent frames use minimum-rotation parallel transport; station `rollRadians` is an authored absolute roll relative to that transported frame, not an accumulating rotation. The second profile axis is `w × tangent`. A reversing cusp is rejected.

The centerline is the authored polyline, not a fitted spline. `u∈[0,1]` follows its normalized chord arc length; exact internal joints select the outgoing segment. `v∈[0,1]` advances by corresponding vertex number; `v=1` wraps to `v=0`. The UV first coordinate follows each ring's cumulative perimeter, and the second follows centerline arc, both divided by `uvMeters`. The parameter `v` is therefore different from the UV perimeter coordinate.

Side cells use one fixed diagonal and `surfaceAt` evaluates its actual Float32 triangle with barycentric weights. The returned `normal` is the face normal, while geometry normals are smooth across side vertices and the duplicated UV seam. `frame` is right-handed, with +Z normal and +Y tangent; it is suitable for a mounting flange. Optional caps have separate vertices and normals. Material slot 0 is the side; slot 1 is both caps. `metadata` records the station count, profile-point count, chord arc, side triangle count and UV scale.

Sharp bends, excessive roll, large profiles and changing concavity can produce intersecting or inward-folded 3D side faces despite valid input rings. Check several sides and grazing views; revise the centerline or add corresponding stations. This implementation does not perform collision detection, global Jacobian analysis or boolean fusion.

## Bicubic patch shell

```js
const controlPoints=Array.from({length:4},(_,u)=>
  Array.from({length:4},(_,v)=>[
    (u/3-.5)*3.4,
    2.5+.65*Math.sin(Math.PI*u/3)+.18*v,
    (v/3-.5)*2.6,
  ]));
const source=createBezierPatchShell(T,{
  controlPoints,thickness:.12,segmentsU:24,segmentsV:20,uvMeters:.5,
});
const underside=source.surfaceAt(.35,.65,'inner');
```

The 4×4 tensor grid is indexed `controlPoints[u][v]`. Bernstein basis evaluation and analytic partial derivatives produce `B`, `du`, `dv`, and `n=normalize(du×dv)`. The outer layer is `B`; the inner layer is `B-thickness*n`. The control-point order therefore determines which side is outer. In the example, `du×dv` points mostly downward; reverse the `v` columns if the top should be outer.

Both U and V sample counts are integers 1..512, defaulting to 24. `thickness` and `uvMeters` must be finite and positive. UV coordinates integrate sampled row/column chord lengths in each layer; curved arcs between samples are approximated. Four edge strips use edge chord length and thickness for UVs.

The single returned geometry has six disjoint index groups in this order: outer, inner, edge 1, edge 2, edge 3, edge 4. Material indices are `[0,1,2,2,2,2]`; use an array of three borrowed materials on the mesh. Edge vertices are duplicated for sharp wall normals but coincide exactly with the layer boundary. The material boundary is watertight after positional welding.

`surfaceAt(u,v,layer='outer')` accepts `outer` or `inner`; both parameters are inclusive `[0,1]` without wrapping. It returns the actual selected triangle's `point`, `normal`, `tangent`, `frame`, `triangleIndex`, `layer`, `cellU` and `cellV`. It does not return an analytic point hovering above a coarse triangle, and it does not query walls. Change the segment count only after evaluating silhouette and attachment accuracy.

A thick curved sheet bounds the material volume between its layers. It preserves the negative space beneath/inside the sheet; it does not fill that space down to a base. A monolithic closed loft or implicit solid has different topology. A vessel with a separate base and open rim requires an explicit patch assembly with compatible shared edges; one square patch is not an automatic arbitrary hollow-vessel constructor. Adjacent patches need a seam policy for shared positions, normals and material groups.

Degenerate Jacobians at lattice vertices and cell centers, collapsed layer thickness and degenerate emitted Float32 triangles fail before a geometry is returned. These finite checks cannot exclude an unsampled singularity, offset inversion, a tight-radius collision or global self-intersection. A necessary local design check is thickness smaller than relevant curvature radii; it is not a sufficient global proof.

## Bounded scalar fields and the official extractor

```js
import {MarchingCubes} from 'three/addons/objects/MarchingCubes.js';
const smoothMin=(a,b,k)=>{
  const h=Math.max(k-Math.abs(a-b),0)/k;
  return Math.min(a,b)-.25*k*h*h;
};
const source=createImplicitSurfaceSource(T,{MarchingCubes},{
  // Continuous squared-distance fields; these values are NOT distances in meters.
  field:(x,y,z)=>smoothMin(
    (x+.35)**2+y*y+z*z-.2,
    (x-.35)**2+y*y+z*z-.2,.18),
  bounds:{min:[-1.4,-1,-1],max:[1.4,1,1]},
  resolution:32,isoValue:0,maxTriangles:12000,
});
```

Use the addon from the same exact Three package as `T`; the function checks the temporary geometry's runtime identity. It uses the official extractor and lookup tables through that constructor. It does not embed a second marching-cubes table or substitute a browser-global version.

The field convention is negative inside and positive outside; `isoValue` defaults to 0. The adapter stores `isoValue-field` for the official positive-inside convention, maps extracted coordinates into nonuniform bounds, and transforms gradients by inverse axis scale before normalization. This maintains outward winding and normals for valid smooth fields. It does not estimate distances by taking absolute field values. Hard min/max, smooth min/max and polynomial fields can change gradient magnitude; smoothing a union does not preserve an exact SDF.

`resolution` is the total grid dimension, an integer 8..64, default 32. Authored `bounds.min/max` map to grid indices 1 and `resolution-2`; the usable interval count is `resolution-3`. One extra sample per face lies outside the authored bounds for central-difference normals. The callback must therefore remain finite at those padding coordinates. `metadata.step` gives the three physical sample spacings.

Every sampled point on the authored six-face boundary must be strictly outside after Float32 conversion. A contact/crossing fails with an instruction to expand bounds; it does not silently clip and return an open cut. An empty extraction also fails. This policy catches sampled cuts, not oscillations between lattice points or tiny disconnected components missed by the grid. Choose resolution from the smallest intended feature and compare two resolutions when topology matters.

`maxTriangles` is a positive output budget, default 100000, bounded at 2000000. The adapter first allocates the proven official maximum of five triangles per usable cell, extracts, checks the actual count, then copies exactly the used position/normal values into an independent nonindexed geometry. There is no unused tail in output attributes. This avoids the addon's warning-only array-overflow behavior. The worst temporary position/normal allocation at resolution 64 is about 82 MB, plus field/cache arrays and final output. `maxTriangles` does not cap that temporary memory. The explicit resolution ceiling bounds this synchronous helper; larger datasets require a separately designed tiling/overlap/seam strategy.

Temporary extractor geometry and its material are released on success and on extraction failure. Output zero-area triangles, zero/nonfinite sampled gradients and Float32 position collapse fail explicitly; for an exact iso-to-lattice coincidence, revise `isoValue` or sampling rather than accept an invalid face. Generated UVs use world XZ planar projection and may overlap on vertical regions: use a triplanar shader or a separate unwrap for seam-sensitive textures. Metadata includes sample count, actual triangle count, iso, bounds, spacing, sampled range, temporary capacity and boundary policy. The result has no `surfaceAt`; attach to an implicit mesh with an actual raycast, not an invented analytic parameterization.

## A shared assembly with real interfaces

This root-relative module runs with a standard Three import map and the modules above. Its materials are caller-owned. It combines a varied-section support, an open curved canopy, a fused branch, explicit base plates and a real queried attachment; it leaves the renderer, world layout, light rig and camera with the application.

```js
import * as T from 'three';
import {MarchingCubes} from 'three/addons/objects/MarchingCubes.js';
import {createProfileLoftSource} from './assets/geometry/profile-loft.mjs';
import {createBezierPatchShell} from './assets/geometry/bezier-shell.mjs';
import {createImplicitSurfaceSource} from './assets/geometry/implicit-surface.mjs';
import {createResourceScope} from './assets/runtime/resource-scope.mjs';

export function createContinuousAssembly(materials){
  const root=new T.Group(),scope=createResourceScope(),parts=[];
  function add(name,source,material,position=[0,0,0]){
    scope.own(source);
    const mesh=new T.Mesh(source.geometry,material);
    mesh.name=name;mesh.position.fromArray(position);
    mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
    const part={name,mesh,source};parts.push(part);return part;
  }
  function box(name,size,position,material){
    const geometry=scope.own(new T.BoxGeometry(...size));
    const mesh=new T.Mesh(geometry,material);mesh.name=name;
    mesh.position.fromArray(position);mesh.castShadow=true;
    mesh.receiveShadow=true;root.add(mesh);return mesh;
  }
  try{
    const ring=[[-.3,-.25],[.3,-.25],[.22,.25],[-.18,.3]];
    const support=add('varying-support',createProfileLoftSource(T,{
      stations:[
        {center:[0,0,0],profile:ring},
        {center:[.08,1.2,.02],profile:ring.map(([x,y])=>[x*.8,y]),rollRadians:.15},
        {center:[0,2.55,0],profile:ring.map(([x,y])=>[x*1.3,y*.9]),rollRadians:-.1},
      ],uvMeters:.4,
    }),[materials.coating,materials.metal],[-1,0,0]);
    const controls=Array.from({length:4},(_,u)=>
      Array.from({length:4},(_,v)=>[(u/3-.5)*3.5,
        2.6+.6*Math.sin(Math.PI*u/3)+.1*v,(.5-v/3)*2.4]));
    add('open-canopy',createBezierPatchShell(T,{
      controlPoints:controls,thickness:.12,segmentsU:24,segmentsV:20,uvMeters:.5,
    }),[materials.coating,materials.wood,materials.metal]);
    const capsule=(p,a,b,r)=>{
      const ab=b.clone().sub(a),q=p.clone().sub(a);
      const t=T.MathUtils.clamp(q.dot(ab)/ab.lengthSq(),0,1);
      return q.addScaledVector(ab,-t).length()-r;
    };
    const smoothMin=(a,b,k)=>{
      const h=Math.max(k-Math.abs(a-b),0)/k;
      return Math.min(a,b)-.25*k*h*h;
    };
    const origin=new T.Vector3(0,.2,0),joint=new T.Vector3(0,1.8,0);
    const left=new T.Vector3(-.45,2.5,0),right=new T.Vector3(.45,2.5,0);
    add('fused-branch',createImplicitSurfaceSource(T,{MarchingCubes},{
      field:(x,y,z)=>{
        const p=new T.Vector3(x,y,z);
        return smoothMin(capsule(p,origin,joint,.22),smoothMin(
          capsule(p,joint,left,.18),capsule(p,joint,right,.18),.2),.18);
      },bounds:{min:[-1,-.2,-.7],max:[1,2.9,.7]},
      resolution:32,maxTriangles:15000,
    }),materials.stone,[.9,0,0]);
    for(const x of [-1,.9])box('base-plate',[.9,.15,.8],[x,.075,0],materials.metal);
    for(const x of [.45,1.35])box('upper-seat',[.28,.12,.45],[x,2.57,0],materials.metal);
    const hit=support.source.surfaceAt(.55,.15);
    const clamp=box('surface-clamp',[.16,.2,.07],[0,0,0],materials.metal);
    support.mesh.add(clamp);clamp.matrixAutoUpdate=false;clamp.matrix.copy(hit.frame);
    root.updateMatrixWorld(true);
    const anchors={clamp:support.mesh.localToWorld(hit.point.clone())};
    return {root,parts,anchors,dispose(){root.removeFromParent();scope.dispose();}};
  }catch(error){scope.dispose();throw error;}
}
```

Place this assembly on a real receiving surface with enough area around its bases; provide a background and views that reveal the canopy underside, support seats and branch junction. A smooth implicit union expresses continuous material; the separate metal base plates and seats deliberately express assembly interfaces. Use a shared material palette for their identities and check the same geometry under both intended lighting styles.

All `surfaceAt` points and frames are geometry-local. Transform a point with `mesh.localToWorld`; transform normals with `new T.Matrix3().getNormalMatrix(mesh.matrixWorld)` and normalize. Nonuniform parent scaling changes the geometry's physical thickness and frame interpretation. Recompute a world orthonormal attachment basis from transformed tangent/normal if needed.

Register each source itself with a resource scope, or its geometry, never both. These sources own only the geometry they generate; borrowed materials, renderer and injected Three runtime remain caller-owned. Keep generated attributes/topology intact while querying. Each source's `dispose()` is idempotent and prevents further surface queries.
