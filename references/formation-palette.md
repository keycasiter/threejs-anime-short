# Formation palette

`createFormationPalette(T, {basePalette, profiles={}, applyWhen='unmapped'})` is an r180 role/base identity cache over the actual FormationResponse. It owns only newly created responses. The external owner retains the base palette, all base materials and textures, meshes and geometry; consumers borrow shared returned materials and must not mutate or dispose them individually.

Profiles are plain dictionaries with at most 32 roles (nonblank strings, at most 128 characters). A value is `null` for passthrough, or `{pattern, space, parameters, programKey?, upstreamProgramKey?}`. Defaults and numeric limits come from FormationResponse. Unknown fields are rejected, including unknown parameter fields. Three-element arrays and Matrix4 numeric elements are copied at construction using fixed indices; caller iterators are not consumed. The fixed profiles cannot be updated. Numeric limits and material-specific compatibility are checked by the actual response on first derived `get`; unused and skipped recipes have not passed that validation. Toon has no roughness consumer, so explicit nonzero `roughnessAmplitude` fails when deriving Toon; reflective metal from LookPalette remains PBR.

`get(role, options={})` always delegates base lookup and option validation to `basePalette.get`. Missing/null profiles return the base directly. `unmapped` also preserves any actual UV surface texture (color, normal, bump, roughness, metalness, displacement, alpha, AO, light, emissive and supported physical surface maps). `envMap` and Toon `gradientMap` do not trigger preservation. `all` explicitly permits combining surface maps with formation response; native normal/bump composition is inherited from FormationResponse. Responses cache separately for each role and actual base UUID, with collision checks. Uniform values do not become shader identity; declared upstream program identity is forwarded to the bridge.

`validateMesh(mesh, materialOrArray=mesh.material)` accepts only materials previously returned by this palette. Nonempty arrays retain slot counts, including duplicates. It returns `{responses:[{materialUuid,vertexCount,domain:{min,max}}],passthroughMaterialCount}`. Actual response validation checks the candidate against the current mesh pose and geometry without assigning `mesh.material`. Passthrough slots are counted only: they have no formation-field qualification. This CPU check is neither GPU compilation nor visual approval. Mesh transforms and field values must be finalized before validation and revalidated after relevant changes.

`inspect()` returns detached role/profile metadata, entries and actual response snapshots, never Materials or response handles. `dispose()` is idempotent, attempts every owned response release, clears indexes even if a release throws, and reports release errors in AggregateError. After disposal, get/validate fail. Borrowed materials/textures remain usable.

## Executable ESM method

Install Three r180 in a dependency directory (for example `npm install three@0.180.0` in your project). Save this block as `formation-palette-example.mjs` in the package root. Set `THREE_MODULE` to the installed absolute `three/build/three.module.js` path, then run from the package root:

```sh
THREE_MODULE=/absolute/path/to/node_modules/three/build/three.module.js node formation-palette-example.mjs
```

```js
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createLookPalette} from './assets/materials/look-palette.mjs';
import {createFormationPalette} from './assets/materials/formation-palette.mjs';
import {assignMaterialRegions} from './assets/materials/material-regions.mjs';
const T=await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href);
const basePalette=createLookPalette(T,{mode:'pbr',resolution:64});
// Sampling frame: local member +X maps into longitudinal pattern +Z.
const woodFrame=new T.Matrix4().makeRotationY(-Math.PI/2);
assert.ok(new T.Vector3(1,0,0).transformDirection(woodFrame).distanceTo(new T.Vector3(0,0,1))<1e-12);
const palette=createFormationPalette(T,{
  basePalette,
  profiles:{wood:{pattern:'fibres',space:'attached',parameters:{
    wavelengths:[.08,.3,.3],frameMatrix:woodFrame,
    colorLow:[.8,.85,.9],colorHigh:[1.1,1.05,1],
    roughnessAmplitude:.12,heightAmplitude:.0003,warp:.2,seed:7
  }},metal:null}
});
const geometry=new T.BoxGeometry(.6,.3,.2);
// The field is authored in metres before object placement.
geometry.setAttribute('aFormationPosition',geometry.attributes.position.clone());
// Design: a wood member runs along local X; metal caps cover its two ends.
const originalIndices=Array.from(geometry.index.array);
const partition=assignMaterialRegions(T,{
  geometry,regions:[{id:'metal',match:({normal})=>Math.abs(normal.x)>.9}],fallback:'wood'
});
assert.equal(partition.triangleCount,originalIndices.length/3);
assert.deepEqual(Array.from(geometry.index.array),originalIndices);
const original=basePalette.get('wood',{maps:false});
const mesh=new T.Mesh(geometry,original);
mesh.position.set(2,0,0);mesh.updateMatrixWorld(true);
try {
  // The partition owns slot order; role resolution follows its actual slot table.
  const candidates=partition.slots.map(({id})=>palette.get(id,{maps:false}));
  const coverage=new Array(originalIndices.length).fill(0);
  for(const group of geometry.groups){
    assert.ok(candidates[group.materialIndex]?.isMaterial);
    for(let i=group.start;i<group.start+group.count;i++)coverage[i]++;
  }
  assert.ok(coverage.every(count=>count===1));
  const checked=palette.validateMesh(mesh,candidates);
  assert.equal(mesh.material,original);
  assert.equal(checked.responses.length,1);
  assert.equal(checked.passthroughMaterialCount,1);
  // Bind only after every candidate passes; geometry groups remain caller-owned.
  mesh.material=candidates;
  console.log(JSON.stringify({checked,partition,groups:geometry.groups,coveredTriangles:coverage.length/3}));
} finally {
  // Always try each owner cleanup, even if an earlier disposal fails.
  try { palette.dispose(); }
  finally { try { basePalette.dispose(); } finally { geometry.dispose(); } }
}
```

This generic example preserves the complete triangle stream and assigns semantic end/body regions before resolving candidate slots. The explicit group coverage assertions establish CPU material-slot binding; FormationPalette validation itself remains formation qualification. It demonstrates candidate resolution, validation and ownership. It creates no renderer or environment and does not establish a visual result.
