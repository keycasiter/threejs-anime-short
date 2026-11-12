# 让米制坐标跟随源部件

同一根梁摆到两个位置，梁上同一处的附着坐标应相同，最终顶点的世界位置则不同。在变换和静态合并之前，用 [writeFormationCoordinates](../assets/geometry/formation-coordinates.mjs) 把源坐标写进独立的 `aFormationPosition`；[装配器](../assets/scene/asset-assembly.mjs) 按同一索引展开属性，仅对位置和法线应用装配变换。

| 需要的参考系 | 如何取值 | 跨部件、跨实例的含义 |
|---|---|---|
| 部件自身 | 米制几何直接取 position，变换默认 identity；厘米源可显式给 `new T.Matrix4().makeScale(.01,.01,.01)`。 | 每个部件按自己的原点、轴向计量；实例刚性摆放不改数值。 |
| 资产共同参考系 | 先 `asset.updateWorldMatrix(true,true)`。asset 是资产根 Object3D，mesh 是它的后代。传入 `asset.matrixWorld.clone().invert().multiply(mesh.matrixWorld)`，要求根变换可逆、资产单位为米。 | 包含嵌套子部件的偏移和旋转；排除资产根在地块上的刚性摆放。已经共享的 geometry 若在不同子节点需要不同值，应先克隆并分配所有者。 |
| 场景中的固定位置 | 使用实际渲染位置及其世界变换。 | 物体移动后要重新取世界位置；已合并 mesh 的单一 modelMatrix 无法恢复各原型的旧参考系。 |

**可执行例。** 在 skill 根目录用 `node --input-type=module` 从标准输入执行，安装 `three@0.180.0` 或把 `THREE_MODULE` 指向本地 r180 的 `build/three.module.js`（相邻目录保留该发行版的 examples/jsm）。下例两次使用同一份几何，再从真正合并的属性读回两个顶点。

```js
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {FORMATION_ATTRIBUTE,writeFormationCoordinates} from './assets/geometry/formation-coordinates.mjs';
import {createAssetAssembly} from './assets/scene/asset-assembly.mjs';
const local=process.env.THREE_MODULE;
const T=await import(local?pathToFileURL(resolve(local)).href:'three');
const {mergeGeometries}=await import(local
  ? pathToFileURL(resolve(dirname(resolve(local)),'../examples/jsm/utils/BufferGeometryUtils.js')).href
  : 'three/addons/utils/BufferGeometryUtils.js');

const part=new T.BoxGeometry(2,1,1), material=new T.MeshStandardMaterial();
const assembly=createAssetAssembly(T,{mergeGeometries,invariantAttributes:{[FORMATION_ATTRIBUTE]:3}});
try {
  const source=writeFormationCoordinates(T,part);
  assembly.add(part,material,{matrix:new T.Matrix4().makeTranslation(4,0,0)});
  assembly.add(part,material,{matrix:new T.Matrix4().makeRotationY(Math.PI/2).setPosition(-6,0,0)});
  const out=assembly.finish().root.children[0].geometry;
  const position=out.getAttribute('position'), attached=out.getAttribute(FORMATION_ATTRIBUTE);
  const read=(a,i)=>new T.Vector3().fromBufferAttribute(a,i).toArray();
  const next=part.index.count, original=read(source,part.index.getX(0));
  assert.deepEqual(read(attached,0),original);
  assert.deepEqual(read(attached,next),original);
  assert.notDeepEqual(read(position,0),read(position,next));
  console.log({sourceMetres:original,firstPose:read(position,0),secondPose:read(position,next)});
} finally {
  assembly.dispose();part.dispose();material.dispose();
}
```

**写入与更新。** `writeFormationCoordinates(T,geometry,{attributeName,geometryToFormation})` 返回实际 BufferAttribute。调用方必须拥有可写几何；输入为 1 到 1,048,576 个 CPU 可读的 xyz 顶点，通过 position 的分量访问器取值。变换须为 16 个有限数构成的仿射 Matrix4。首次创建独立的非归一化 Float32 xyz 属性，由 geometry 的所有者一并释放；兼容更新保持属性对象和数组身份，清除旧的局部更新范围并标记整段需要上传。变换结果先写临时数组，遇到非有限数或 Float32 溢出时，已有值与版本保持原状。既有目标不能与该几何的其他属性、索引或 morph 数据共用底层 buffer。每个 xyz 属性占 12 字节/顶点，更新还需要同等大小的临时数组。顶点数或布局不兼容会报错；拓扑重排、换尺寸或更换参考系时，调用方须按对应源重新生成数据，不应继续复用旧映射。

**静态装配。** `invariantAttributes` 默认为空；传普通对象，例如 `{aFormationPosition:3,aPhase:1}`。创建时固定 schema，最多 16 个字段、每个 1–4 分量。名称为 1–128 个字符的 ASCII 标识符；避开原型键和引擎特殊属性（position、normal、tangent、UV、顶点色、蒙皮、形变、实例化等）。每个输入几何都必须含同顶点数、同分量数、有限值的非交错、非实例化、非归一化普通 Float32 BufferAttribute，gpuType 为 FloatType；缺字段、未知字段和不兼容布局会报错。add 时按当下真实索引快照，后续移动或释放源原型不改快照。装配器释放自己的快照和最终几何；借用材质和输入几何由调用方释放。

## 接到真实材质

最终网格用[材质扩展桥](material-shader-bridge.md)读取同一属性。以下是完整ESM的坐标显色诊断，沿用上述Node依赖约定；浏览器直接使用项目的同版THREE和真实渲染循环。它保留内置输出链，不是石材/木材的美术模板。值超出可见颜色范围时先定义诊断映射，不能把任意米制坐标直接当最终颜色。

```js
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeFormationCoordinates} from './assets/geometry/formation-coordinates.mjs';
import {createMaterialShaderBridge} from './assets/materials/material-shader-bridge.mjs';
const T=await import(process.env.THREE_MODULE?pathToFileURL(resolve(process.env.THREE_MODULE)).href:'three');
const geometry=new T.PlaneGeometry(1,1),base=new T.MeshStandardMaterial();
writeFormationCoordinates(T,geometry);
const bridge=createMaterialShaderBridge(T,{baseMaterial:base,programKey:'formation-diagnostic-v1',uniforms:{uGain:{value:1}},patches:[
  {stage:'vertex',anchor:'#include <common>',after:'attribute vec3 aFormationPosition; varying vec3 vFormation;'},
  {stage:'vertex',anchor:'#include <begin_vertex>',after:'vFormation=aFormationPosition;'},
  {stage:'fragment',anchor:'#include <common>',after:'varying vec3 vFormation; uniform float uGain;'},
  {stage:'fragment',anchor:'#include <opaque_fragment>',after:'gl_FragColor.rgb=vec3((vFormation.x+0.5)*uGain,(vFormation.y+0.5)*uGain,0.0);'}
]});
const mesh=new T.Mesh(geometry,bridge.material);
try {
  // 浏览器把mesh加入scene，由WebGLRenderer调用编译；Node这里只核对接线。
  const lib=T.ShaderLib.physical;
  const shader={vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader,uniforms:T.UniformsUtils.clone(lib.uniforms)};
  mesh.material.onBeforeCompile(shader,undefined);
  if(!shader.vertexShader.includes('vFormation=aFormationPosition;') || shader.uniforms.uGain!==bridge.uniforms.uGain) throw Error('missing coordinate consumer');
  bridge.uniforms.uGain.value=.5; // 稳定wrapper，不重建几何或程序。
  console.log(mesh.material.type,geometry.getAttribute('aFormationPosition').count,shader.uniforms.uGain.value);
} finally {
  geometry.dispose();bridge.dispose();base.dispose(); // 桥拥有派生材质，base仍由调用者持有。
}
```

core 和 context 示例在部件作者给出的局部米制坐标下捕获属性。材质分组单独按原索引展开，语义槽与几何字段一起抵达最终网格。附着坐标不提供材料方向、UV 标尺或切线，也不表示任意源布局可直接上传 GPU。聚焦测试覆盖CPU数据链；真实r180/WebGL诊断另验证三种内置材质中的合批属性读取、就地上传、uniform及重新编译。该诊断不证明最终材料外观、OutputPass、骨骼/实例变形或成片画质。新项目仍须在其真实入口验证。见[坐标与分组测试](../scripts/tests/formation-coordinates.test.mjs)和[装配测试](../scripts/tests/asset-assembly.test.mjs)。
