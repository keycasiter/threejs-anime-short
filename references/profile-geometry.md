# 截面、厚壁与贯穿孔的代码方法

适用于回转壳体、环套、漏斗，以及沿一条直轴挤出的板件/支架；当前实现以Three 0.180.0执行验证。使用[可复制模块](../assets/geometry/profile-surfaces.mjs)；它负责几何生成，造型、材质和装配关系仍由资产规格决定。现有扫掠/自由曲面方法见[代码SOP](threejs-code-sop.md#用截面生成连续曲面)。

## 从参考到结构参数

先画局部剖面：外轮廓、内腔、端口和折边；把轮廓转折放在实际空间坐标上。标出哪些边是光滑转折、哪些是加工折线，以及哪些空白必须能从另一面看穿。让安装面、转轴和附件从同一规格计算位置，而不是在渲染后逐个移动到“看起来差不多”。

| 可见关系 | 生成方式 | 目标视口确认 |
|---|---|---|
| 连续收分、台肩、边缘与内腔 | 内外剖面分别定义，绕局部Y轴回转；转折以轮廓控制点表达 | 正侧轮廓、掠射反射带、开口内壁和口沿厚度 |
| 薄板、贯穿槽、窗孔与支架 | XY外轮廓加孔轮廓，沿Z挤出；倒角形成有宽度的受光带 | 正面能穿过孔，侧面有厚度，背面也成立 |
| 连接/转动 | 资产局部组、轴套/接触面及共享锚点 | 装配间隙、接触阴影和需要的运动极限 |

中层由截面和关系解释。优先设计一两个关键转折，使它们在目标像素下有体积和受光；再分配细分，增加环数不会替代缺少的台肩/内壁。需要真实工程尺寸时另查可靠资料，视觉参考推测尺寸应写为设计设定。

## 内外剖面回转

将模块复制到作品源码，注入项目同一份THREE：

```js
import * as THREE from 'three';
import { createRevolvedShell, createPerforatedPlate } from './profile-surfaces.mjs';

const outer = [
  { r: .30, y: 0 }, { r: .32, y: .10, crease: true },
  { r: .62, y: .78 }, { r: .65, y: .84 }
];
const inner = [
  { r: .25, y: 0 }, { r: .27, y: .10, crease: true },
  { r: .57, y: .78 }, { r: .60, y: .84 }
];
const shellGeometry = createRevolvedShell(THREE, {
  outer, inner, radialSegments: 64,
  endConnections: { start: true, end: true },
  materialIndices: { outer: 0, inner: 1, start: 2, end: 2 }
});
const shell = new THREE.Mesh(shellGeometry, [outside, inside, rim]);
```

`r`是正半径，`y`是高度，沿+Y非递减；同高度的不同半径点表达径向台肩。外/内剖面需同起止高度且全程有净距，可用不同数量的控制点。它们是**独立设计的内外表面**，不承诺自动生成固定法向壁厚；坡度变化明显时从剖面量取实际最小壁厚。

`endConnections`默认连接内外端环，形成环形口沿，轴向孔保持开放；它不会把中空通道封成实心圆盘。启用端环时，剖面端部向端环覆盖区域折回的同高台肩会被拒绝，以避免零厚度共面重叠；改用不重叠的剖面或明确开放该端。适合通孔壳体，封底容器应另外设计底部及过渡，不能把口沿参数当封底。`crease:true`使该剖面点两侧保留折边法线，其余连接平滑；角向UV 0/1有独立顶点且法线相同。保留生成法线，不再全局`computeVertexNormals()`覆盖折边选择。侧面UV沿圆周/剖面弧长归一化，端环v按内外半径0/1映射，实际纹理密度由对象尺寸和纹理repeat决定。

## 真实孔洞与倒角板

```js
const plateGeometry = createPerforatedPlate(THREE, {
  outline: [[-1,-.4], [1,-.4], [1,.4], [-1,.4]],
  holes: [[[-.35,-.12], [.35,-.12], [.35,.12], [-.35,.12]]],
  depth: .16,
  bevel: { enabled: true, size: .025, thickness: .025, segments: 3 },
  materialIndices: { faces: 0, edges: 1 }
});
const plate = new THREE.Mesh(plateGeometry, [faceMaterial, edgeMaterial]);
```

轮廓为不重复首点的有限`[x,y]`数组；曲线先按最终像素采样成折线。孔严格处于外轮廓内部，互不相交/相切/嵌套。无倒角可用简单凹轮廓；启用倒角要求每个环为凸多边形，模块按实际偏移环检查塌缩/自交及孔间净距，不按网格最短边限制倒角宽度；复杂凹角圆角/自由曲面布尔改用相应建模路线。

`depth`为包含倒角的成品总厚度，局部Z范围为0到depth；输入外轮廓约束最大XY包络，倒角向内收面。`size`是平面内退让，`thickness`是Z方向高度，后者小于depth/2；段数控制边缘采样，不能解决过大的倒角和孔间净距。孔口随倒角展开，直壁段保留贯穿孔。`faces`对应前后端面，`edges`对应外侧、孔壁与倒角面；需要同一材料可使用单个Material或把索引设为相同值。

## 把方法用到完整资产

先以少量主要截面确定轮廓、腔体和连接，用侧背视角核对；再按目标景别细分和做材料变化。孔在灰模与斜后视仍应成立，厚边要有真实遮挡和投影。代码内的剖面/孔数据同时用于附件定位、碰撞近似和检查尺寸，避免每层另写一份数字。

这些helper返回Geometry，只占资产生成器的一层；组合后的底座、连接、材料和支撑环境仍需达到各自质量目标。静态结构成立后再加动作，承重/铰接关系以共享枢轴和锚点验证。局部开孔或倒角成功不能替代[完整代表镜头审图](validation.md#核心镜头放行标准)。

维护模块时运行`THREE_MODULE=/path/to/three/build/three.module.js node --test scripts/tests/profile-surfaces.test.mjs`；依赖能以包名解析时可省略环境变量。输出用于Three.js渲染，多孔端面的共线T交接不保证逐边焊接的制造网格，制造/后续实体布尔需另做拓扑整理。
