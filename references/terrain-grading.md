# 约束高程区与最终地形接力

当场景需要若干可承托的水平/定坡区域，同时必须保留既有道路、建筑基础或指定地表时，用高程区规划器把“目标地坪、过渡带、不能改动的区域”编译成同一高度函数，再交给受约束网格生成器。它解决高程规则和冲突检测；不替设计者决定各区域用途或视觉构图。

## 数据合同

| 输入 | 字段 | 含义 |
|---|---|---|
| 高程区 | 稳定`id`、凸`outline`（XZ）、绝对`targetHeight`、`transitionWidth` | 核心轮廓内达到指定世界高程；轮廓外以五次smoothstep在指定距离内回到原地形 |
| 受保护区 | 稳定`id`、凸`outline`、`transitionWidth` | 区内原地形精确保留；可选过渡宽度把附近整地影响逐渐衰减到零 |
| 实际源地形 | `createConstrainedTerrainGeometry`传入的最终规则网格 | 高程回调消费源三角面的piecewise-linear `baseHeight`，不能改用另一个未对齐的解析场 |

两个不同高程区的过渡包络重叠，或整平区进入受保护区/过渡边界，会返回`UNSAT`；不静默挑一块优先、不移动原道路、不放宽平整误差。若某个定高过渡带到达保护区，保护区必须有非零`transitionWidth`，在保护边界渐隐至源面；未声明渐隐的保护区只能在定高过渡包络以外使用，避免出现坡面突跳。相同高程的区域允许合并。输入环在Float32世界坐标中复核；区域边界为凸多边形，凹区先拆成设计上独立的凸面。几何仍是单值XZ高度场，无法表达洞穴、悬挑或多层地面。

## 完整接线：规划 → 共形地形 → 重建道路

```js
import * as THREE from 'three';
import {createFractalHeightField, createHeightFieldGeometry} from './assets/environment/height-field.mjs';
import {compileTerrainGradeField} from './assets/environment/constrained-height-field.mjs';
import {createConstrainedTerrainGeometry} from './assets/environment/constrained-terrain.mjs';
import {prepareTerrainRoadSupport, createTerrainRoadSource, samplePreparedTerrainSurface} from './assets/environment/terrain-roads.mjs';

const sourceField = createFractalHeightField({seed:17,baseHeight:0,amplitude:2,baseFrequency:.035,octaves:4});
const source = createHeightFieldGeometry(THREE,sourceField,{sizeX:160,sizeZ:120,segmentsX:160,segmentsZ:120});
const grading = compileTerrainGradeField({
  zones:[
    {id:'viewing-pad',outline:[[-18,-12],[10,-12],[10,14],[-18,14]],targetHeight:2.4,transitionWidth:8},
  ],
  protectedRegions:[
    {id:'existing-road',outline:[[-55,33],[55,33],[55,47],[-55,47]],transitionWidth:3},
    {id:'existing-foundation',outline:[[-32,-24],[-20,-24],[-20,-10],[-32,-10]],transitionWidth:1},
  ],
});
if(grading.diagnostics.status!=='ACCEPTED') throw new Error(JSON.stringify(grading.diagnostics));

// The polygon rings become real mesh boundaries. Protected regions preserve
// source heights exactly. The source mesh is borrowed and remains immutable.
const refined = createConstrainedTerrainGeometry(THREE,{
  terrainGeometry:source,
  constraints:grading.constraints,
  protectedRegions:grading.protectedRegions,
  heightAt:grading.heightAt,
});
const terrainSupport=prepareTerrainRoadSupport({terrainGeometry:refined.geometry,topology:'triangulated'});
const road=createTerrainRoadSource(THREE,{
  terrainSupport,
  surfaces:[{outer:[[-50,36],[50,36],[50,44],[-50,44]],holes:[]}],
  thickness:.35,
});

// Qualification samples the emitted mesh, not the source field or design JSON.
const pad=samplePreparedTerrainSurface(terrainSupport,0,0);
if(!pad || Math.abs(pad.height-2.4)>2e-5) throw new Error('pad does not meet its target datum');

// Retire in dependency order after atomically replacing the scene owner:
road.dispose(); terrainSupport.dispose(); refined.dispose(); source.dispose();
```

In an application, source ownership outlives the derived candidate until a successful world replacement; on failure, dispose only the candidate and keep the previous world active. Do not dispose shared geometry/materials through a child label or road owner. Rebuild all roads, connectors, pad trims, support queries and placement indexes from the same accepted `refined.geometry` revision.

## Sampling and geometric quality

The planner computes quintic distance transitions. The emitted geometry still samples this function at source vertices and constraint intersections; it does not adaptively subdivide based on curvature, projected error or maximum slope. Choose source spacing from the smallest transition and the target camera scale, then inspect the actual mesh. A useful starting check is several source intervals across every transition, followed by a measured maximum grade/slope and silhouette/crack review; do not treat a fixed interval count as a universal quality standard.

Check the full chain in the **emitted Float32 geometry**:

1. Every level zone reaches its target height across the full footprint, not only at the center; inspect polygon edges, corners and zone intersections.
2. Transition heights return to the exact source surface beyond their declared width and remain continuous at both ends; measure maximum slope and check for sharp shoulders.
3. Every protected road/occupied footprint retains source height and geometry support; query multiple points across width, including joints and triangle diagonals.
4. New roads and connectors are rebuilt from one prepared support token over the refined terrain; compare old/new road top surfaces and complete support footprints.
5. Unequal overlapping zones, zone/protection collisions, missing terrain coverage, invalid Float32 topology and budget exhaustion fail explicitly. No stale support token or pre-grade road may be reused after geometry changes.

CPU tests in `scripts/tests/terrain-grading.test.mjs` verify datum/transition behavior, overlap rejection, protected-region fades, emitted geometry and rebuilt road support with Three.js r187. These prove the bounded algorithm and the tested geometry chain only; visual plausibility, all-scene grading feasibility, route walkability and final art quality require their own scene-wide checks.

## Limits and ownership

`compileTerrainGradeField` owns only detached design records and returns `heightAt`, `constraints`, `protectedRegions` and diagnostics. `createConstrainedTerrainGeometry` borrows the source and owns the refined geometry. `prepareTerrainRoadSupport` borrows that geometry and owns its immutable query snapshot. Each road owns its output geometry. Dispose roads, then support, then refined terrain; release source terrain only at its original owner's boundary. The current mesh refiner accepts only indexed regular Float32 height grids, convex constraints and a bounded work budget. It does not solve arbitrary CAD, retain arbitrary source attributes, or adaptively tessellate the grade field.
