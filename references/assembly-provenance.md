# 静态合批后的来源与真实顶点范围

多个源合入同一Mesh，或一个源因材质/阴影/layer分成多个Mesh时，按材质反查不能识别原对象。需要选择、追溯或核对形成坐标时，用现有[装配器](../assets/scene/asset-assembly.mjs)在真实合并处记录来源；普通合批可不启用。

## 输入与产物

`assembly.add(geometry, material, {sourceId, matrix, castShadow, receiveShadow, layers})` 中，`sourceId`是可选非空字符串。它不改变原分桶键，也不改变`add`返回自身的链式接口；同一ID可以跨多个输入组与输出桶。

`finish().sourceRanges`返回`{sourceId,object,geometry,vertexStart,vertexCount}`。object/geometry是实际成品的借用handle；范围指**非索引成品顶点**，起点/数量均对齐三角形，包含此前无ID输入占用的偏移。它不是原始index或drawRange。此契约采用同版原生`mergeGeometries`按输入顺序拼接；不能换成重排顶点的实现后沿用旧范围。

需要JSON时投影为`sourceId/object.uuid/geometry.uuid/vertexStart/vertexCount`等分离数据。位置已应用传入的装配矩阵；声明为不变的形成字段保留源值。实际世界点还需乘成品Mesh的matrixWorld，不能把源架、装配根架与世界架混用。

## 完整可执行ESM

复制`assets/`保持目录树；依赖为同一Three r180。以下可从项目根目录执行，已安装`three`时无需环境变量；也可设置`THREE_MODULE`为该版本的实际`build/three.module.js`。它以两个真实位置合批同一个代码源，退休源后仍可射线识别来源，并逐分量读取实际成品字段；不需要模型、图片或WebGL上下文。

```js
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {createResourceScope} from './assets/runtime/resource-scope.mjs';
import {createAssetAssembly} from './assets/scene/asset-assembly.mjs';
import {createContourProfileSource} from './assets/geometry/contour-profile.mjs';
import {FORMATION_ATTRIBUTE,writeFormationCoordinates} from './assets/geometry/formation-coordinates.mjs';
const modulePath=process.env.THREE_MODULE;
const T=await import(modulePath?pathToFileURL(resolve(modulePath)).href:'three');
const addon=modulePath?pathToFileURL(resolve(dirname(resolve(modulePath)),'../examples/jsm/utils/BufferGeometryUtils.js')).href:'three/addons/utils/BufferGeometryUtils.js';
const {mergeGeometries}=await import(addon);
const owner=createResourceScope(),inputs=createResourceScope();
try {
  const material=owner.own(new T.MeshStandardMaterial({color:0xb4bca8}));
  const assembly=owner.own(createAssetAssembly(T,{mergeGeometries,
    invariantAttributes:{[FORMATION_ATTRIBUTE]:3}}));
  const source=inputs.own(createContourProfileSource(T,{
    contour:[[-1,-.5],[1,-.5],[1,.5],[-1,.5]],
    profile:[[0,0],[.12,0],[.12,.08],[0,.08]],
  }));
  // 此例将源Y作为形成Z；形成参考系与几何摆放分别设计。
  writeFormationCoordinates(T,source.geometry,{
    geometryToFormation:new T.Matrix4().makeRotationX(Math.PI/2),
  });
  const g=source.geometry,index=g.index,field=g.getAttribute(FORMATION_ATTRIBUTE);
  const expected=new Float32Array(index.count*3);
  for(let i=0;i<index.count;i++)for(let c=0;c<3;c++)
    expected[i*3+c]=field.getComponent(index.getX(i),c);
  const sample=source.surfaceAt(1/6,.65);
  assembly.add(g,material,{sourceId:'edge/first',matrix:new T.Matrix4().makeTranslation(3,1,-2)});
  assembly.add(g,material,{sourceId:'edge/second',matrix:new T.Matrix4().makeTranslation(-3,1,-2)});
  const result=assembly.finish();
  owner.defer(()=>{result.root.removeFromParent();result.root.clear();});
  inputs.dispose(); // 成品有独立快照，source查询此后关闭。
  if(result.stats.staticMeshes!==1||result.sourceRanges.length!==2)
    throw new Error('Unexpected actual assembly outputs');
  for(const range of result.sourceRanges){
    const actual=range.geometry.getAttribute(FORMATION_ATTRIBUTE);
    if(range.vertexCount*3!==expected.length)throw new Error('Unexpected source range');
    for(let i=0;i<range.vertexCount;i++)for(let c=0;c<3;c++)
      if(actual.getComponent(range.vertexStart+i,c)!==expected[i*3+c])
        throw new Error('Final formation coordinate mismatch');
  }
  result.root.updateMatrixWorld(true);
  const point=sample.point.clone().add(new T.Vector3(3,1,-2));
  const ray=new T.Raycaster(point.clone().addScaledVector(sample.normal,.5),sample.normal.clone().negate());
  const hit=ray.intersectObject(result.root,true)[0];
  if(!hit)throw new Error('Missing actual merged surface');
  const vertex=hit.faceIndex*3;
  const range=result.sourceRanges.find(r=>r.object===hit.object&&
    vertex>=r.vertexStart&&vertex+3<=r.vertexStart+r.vertexCount);
  if(range?.sourceId!=='edge/first')throw new Error('Wrong logical source');
  console.log({sourceId:range.sourceId,geometryId:range.geometry.uuid,
    vertexStart:range.vertexStart,vertexCount:range.vertexCount});
} finally {
  try {inputs.dispose();} finally {owner.dispose();}
}
```

先按实际遮挡取得最近hit，再在这个hit上解析来源；无来源的最近实体仍然遮挡，不能越过它去选后面的对象。同版普通Mesh的faceIndex对应三角序号；实例、动态变形或自写拾取需要各自的来源表示。

## 更新与归属

改变输入/拓扑后重新构建，来源范围与本次成品一起提交；不可复用旧geometry UUID/范围。修改材质不会自动改变逻辑来源。装配器拥有快照和成品几何，源/材料/动态子树保持调用者所有权；范围不增加第二个所有者。只登记整个assembly，不再重复登记它的结果或成品geometry。

[完整世界](../assets/examples/core-world.mjs)展示源组→真实装配→范围DTO，临时源在组复制后关闭，实际成品仍由装配器持有。验证使用原始indexed源与成品对应范围逐分量比较位置/形成字段，并以破坏最终属性的负对照检查辨别力；字段存在、临时复制正确或某条射线命中都不能代替它。上面的Node示例只证明源接力与实际CPU网格；GPU消费、交互与画质另做真实运行验证。
