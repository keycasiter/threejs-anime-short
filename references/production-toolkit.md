# 可调用的制作工具

在运行基础、完整代表关系与表现校准阶段按目标选择模块。主体几何按[构造配方](procedural-construction.md)从代码产生，复杂算法库的版本/接线条件见[库选择](library-integration.md)。先确认目标镜头需要看见的信号，再使用对应能力；整体质量仍取决于空间组织、结构与表面共同完成。下列是实际源码，不是要求执行者重新发明的接口。

## 选择与接入

| 可见目标 / 条件 | 已有工具 | 实际输出与限制 |
|---|---|---|
| 木纹、矿物区、涂层/金属露底需要共同控制表面通道 | [程序材质目录](../assets/materials/procedural-palette.mjs) | 三类原创配方，输出真实Standard材质及颜色/roughness/metalness/normal；有限参考配方，需按美术目标扩展 |
| 自写基色/粗糙度/微法线但保留内置受光 | [材质扩展桥](material-shader-bridge.md) | r187原生Standard/Physical/Toon独立变体、结构cache key与稳定uniform；Toon没有PBR粗糙度锚点，输出转换沿用原链 |
| 变换/静态合批后仍需源部件米制坐标 | [形成坐标与装配](formation-coordinates.md) | 实际BufferAttribute和显式不变schema；按同一索引快照，不重复应用pose；不自动建立材料方向/UV/TBN |
| 无UV曲面或合批部件需要连续层纹、沿向纤维、聚集微表面 | [形成响应](formation-response.md)：`createFormationResponse` | 同一米制场接基色、PBR粗糙度和主层微法线，按屏幕微分退场；保留原生光照，普通静态Mesh先验证，非任意材料/变形/clearcoat同步 |
| 多个真实材料语义槽共享形成规律 | [形成palette](formation-palette.md)：`createFormationPalette` | 按角色和实际base身份缓存，候选校验后绑定；借用base/贴图，拥有派生响应；默认保留已有UV表面图 |
| 背景天空与物体环境受光需要一致 | [天空与环境捕获](../assets/rendering/scene-environment.mjs) | 同一美术天空生成可见穹顶与PMREM；太阳盘不进入捕获，主光单独按同方向设置；不是物理大气/云模拟 |
| 局部室内/遮蔽空间需要反射自身环境 | 同模块 `captureEnvironmentProbe` | 实际CubeCamera→PMREM，完成几何/灯后显式捕获；调用者给目标材质赋envMap；不是实时动态镜像 |
| 平面需要清晰场景镜像 | [平面反射适配器](../assets/rendering/planar-reflection.mjs) | 复用注入的官方Reflector，加入排除/防递归与状态恢复；输出镜面Mesh与纹理，非PBR粗糙湿地反射/多水位水体 |
| 目标天气确实需要可见雨丝 | [视觉雨场](../assets/environment/weather-field.mjs) | 有界LineSegments、绝对时间、风速/落速、实际强度与屋顶查询；非流体、体积雾、水花或自动湿润反馈 |
| 需要接触AO、有限高亮扩散与正确输出 | [后期链](../assets/rendering/post-pipeline.mjs) | 半浮点线性HDR→可选GTAO→可选Bloom→一次Output→可选SMAA；不含体积光、自适应曝光、物体运动模糊 |
| 需要定位质量责任层、复现镜头/时间、切换真实效果 | [场景工作台](../assets/runtime/scene-workbench.mjs) | 相机/target/FOV、绝对时钟、消费者开关、真实统计、可选DOM；历史模拟需额外reset，不能自动保证像素确定 |

注入**同一锁定版本**的 `THREE` 与官方addons，已验证路径为r187/WebGLRenderer。WebGPU、其他版本、XR、多相机rig需要另外验证。适配器不复制标杆的应用shader。新任务需要表中未覆盖的能力时，显式设计扩展并先做小样，不把近似能力命名成完整能力。

## 几何与关系工具

| 任务 | 实际模块/API | 返回与使用边界 |
|---|---|---|
| 闭合凸边界的台肩、回折、口沿与连续截面 | [轮廓截面](contour-profile.md)：`createContourProfileSource` | 严格凸XY轮廓×简单闭合outset/Z截面、真实Float32三角查询/材料带/折边；有限miter与内缩/净距拒绝，不是任意CAD或布尔 |
| 厚壁回转、内腔、环口、真实带孔板 | [profile-surfaces](../assets/geometry/profile-surfaces.mjs)，接口见[截面方法](profile-geometry.md) | 实际BufferGeometry/UV与组；复杂自由曲面需项目生成器 |
| 真实窗洞、厚度、框与端口 | [buildArchitecturalBay](../assets/examples/procedural-bay.mjs)，用法见[构造方法](procedural-construction.md) | root/parts/spec/anchors/dispose；只支持所列居中矩形/半圆拱，非整楼/门洞生成器 |
| 静件分桶、动件层级与端口连接 | [asset-assembly](../assets/scene/asset-assembly.mjs)、[placeAtAnchor](../assets/scene/anchor-connection.mjs) | 前者合并适用静件；后者对齐真实局部端口，要求单位刚性变换与世界矩阵自动更新；均不自动检查支撑/美观 |
| 合批后追溯、选择与核对源部件 | [装配来源](assembly-provenance.md)：可选`sourceId` / `sourceRanges` | 实际成品Mesh及非索引顶点范围；不改材质/阴影/layer分桶与原fluent接口，范围不新增资源所有者 |
| 宿主命中、局部朝向与有限足迹 | [surface-anchors](../assets/scene/surface-anchors.mjs)：`createSurfaceSampler`/`surfaceFrame`/`createSurfacePatchSampler` | 前者求实际点/法线和实例框架，后者资格检查离散足迹并返回ACCEPT/REJECT；不自动生成基部或求碰撞/IK |
| 两侧宿主间的竖直承托 | 同模块`createVerticalBearingSampler(T,lower,upper)` | 给x/z、minY/maxY、上下XZ足迹偏移，有限射线输出bottomY/topY/clearance等；漏点/交叠失败，不是任意斜向接头生成器 |
| 宽深/偏心/滚转独立的连续主形 | [section-loft](../assets/geometry/section-loft.mjs)：`createSectionLoftGeometry(T,{stations,...})`，用法见[放样配方](algorithm-recipes.md#随包工具宽深独立的沿程放样) | 椭圆环/传输架、实际端盖、米制UV/接缝法线；不含分枝、内壁、任意截面或防自交 |
| 已设计连接图与沿边地块 | [corridor-layout](../assets/scene/corridor-layout.mjs)：`compileCorridorGraph`/`generateFrontageLots`，见[世界配方](algorithm-recipes.md#世界连接图与局部语法) | 真实宽度矩形、节点/分量与接受地块；道路厚度、地形基础/门口和任意路口需项目构造，不是自动城市 |
| 区域用途、混合完整原型与真实入口共同布局 | [frontage-neighborhood](frontage-neighborhood.md)：`compileFrontageNeighborhood` | 纯数据、完整足迹/净距/邻件资格、组间节奏及预算诊断；不是最密填充或自动世界美术 |
| 道路并集贴合实际地表三角 | [terrain-roads](terrain-roads.md)：`createTerrainRoadSource` | 最终规则XZ网格、厚度/底面/边壁和实际query；借用地表，拥有道路几何，限单值地表 |
| 连续高度与共享世界梯度 | [height-field](../assets/environment/height-field.mjs)：`createFractalHeightField`/`createHeightFieldGeometry`，见[场配方](algorithm-recipes.md#地形水系与侵蚀) | 原创value-noise fBm、归一振幅、解析导数和单值上表面；非侵蚀/完整地貌，接触用最终三角网格 |
| 发出网格的无效/退化/朝向检查 | [auditTriangles](../assets/geometry/audit-triangles.mjs)，调用见[几何配方](geometry-recipes.md) | 独立方向或逐顶点参考；不检查全部自交、水密、曲率或构图 |
| 重复铺覆的完整轮廓与封边 | [bounded-profile](../assets/geometry/bounded-profile.mjs)：`clipConvexPolygon` / `createBoundedProfileGeometry`，见[边界代码](visual-construction.md#2-重复单元先归属区域再裁完整轮廓) | 凸域交集、局部XY、一维profile与Z厚度的闭合网格；非通用CSG/曲面贴合；角点在epsilon内归并采样层，真正Float32塌缩拒绝 |
| 关键表面被谁遮挡、HUD样点冲突 | [view-readability](../assets/scene/view-readability.mjs)：`inspectFeatureVisibility`，见[观看代码](visual-construction.md#1-先让关键部位能被看清) | 实际世界样点、三角遮挡/命中实体与CSS矩形；仅普通深度WebGL透视/正交；不是可见面积或美术评分 |
| 最近景别的曲率/特征采样估计 | [projected-sampling](../assets/geometry/projected-sampling.mjs)：`estimateSamplingStep`，见[采样代码](visual-construction.md#4-按最近目标景别分配采样) | 当前投影/zoom、世界尺度与局部step；不是自适应网格器、全局误差保证或成本自动优化器 |

## 最短可执行入口

需要任意对应截面、Bezier双层壳、隐式网格、道路面并集/层间接口或完整PBR/分段受光时，进入[核心三线](core-systems.md)。[core-lab](../assets/examples/core-lab/index.html)与[同源工厂](../assets/examples/core-world.mjs)展示三种空间结构和两种look；API和限制分别在[连续形体](continuous-surfaces.md)、[空间生成](world-layout.md)、[材光接力](look-development.md)维护。不等于通用CAD、自动城市、完整HLOD或GI。

选择几何表示或搭建模块生命周期时，读[实现基础](implementation-foundations.md)，运行[foundation-lab](../assets/examples/foundation-lab/index.html)及其[源码](../assets/examples/foundation-lab/main.mjs)。它复用现回转壳/放样与真实表面/端口，分别验证结构重建、无关对象保持、共享材质与释放；不是新的完整形体算法库或成品画质模板。

| 公共基础 | 已实现API | 所有权与范围 |
|---|---|---|
| 显式资源/监听清理 | [createResourceScope](../assets/runtime/resource-scope.mjs)：own/defer/dispose/inspect | 逆序、去重、跨scope重复所有权拒绝、清理异常聚合；借用不登记，无递归/引用计数 |
| 候选构建与提交 | [createAssetSlot](../assets/runtime/asset-slot.mjs)：replace/current/revision/dispose | 同步builder；失败释放候选并保留旧件；提交后旧件清理错误仍保留新件；只保证单handle |
| 表示与完整接力 | [buildProfileRelation](../assets/examples/profile-relation.mjs) | 厚壁轴对称或独立宽深弯轴实心，真实表面接口/附属件/支撑；借用材料、拥有生成资源，尺寸域为样例约束 |

将设计写成生产代码时，先按[代码接力](code-guidance.md)选择当前小节。[完整构造工厂](../assets/examples/guided-assembly.mjs)与[全场接线入口](../assets/examples/guided-world/index.html)把真实面附着、动件、材料、独立实例变化、波面和消费者检查连接起来。示例的弯曲主体与水槽是教学设计，不能作为新作品默认造型。

| 当前关系 | 已实现入口 | 范围 |
|---|---|---|
| 沿程主形与实际侧面接点 | [createSectionLoftSource](../assets/geometry/loft-source.mjs) | 原loft同源网格/侧面三角形重心/frame；不含端盖、融合或自交修复 |
| 按身份/用途分离随机流 | [createRandomStreams](../assets/runtime/random-streams.mjs) | uint32根seed与稳定字符串ID；每次stream返回新游标，非加密 |
| 多波网格/法线与参数附着 | [createWaveSurface](../assets/environment/wave-surface.mjs) | CPU解析波、当前位置/法线/bounds；局部rest参数，不是固定worldXZ或流体 |
| 项目消费者的参数/刚体/相机读回 | [scene-probes](../assets/runtime/scene-probes.mjs) | 有限数字数组、普通Mesh世界矩阵、真实controls边界；不评美学或像素遮挡 |

[组合诊断场景](../assets/examples/production-lab/index.html)和[完整接线源码](../assets/examples/production-lab/main.mjs)同时调用上述模块、现有设备箱工厂和同一材质目录，包含完整关系/结构样件/材质样片视图。

1. 将需要的`assets`源码按原相对结构复制到项目。可从组合例删除不适用的模块，也可把import路径改到项目模块目录。
2. 将锁定的官方Three.js包`build/`与`examples/jsm/`放到组合例的`vendor/`下，保留许可证；入口importmap已定义`three`和`three/addons/`。用本地HTTP服务打开，模块不能依赖双击file协议运行。
3. 先保留一个有结构、邻接表面和真实受光的代表区域；用工作台固定时间和机位，再调结构、UV/法线度量、表面区域、受光与反射，最后决定AO/Bloom。

这是机制诊断例。其亭架、样片、镜面和雨天不是新作品的场景或风格模板。

另有[算法诊断样件](../assets/examples/algorithm-lab/index.html)及[源码](../assets/examples/algorithm-lab/main.mjs)：三种模式分别运行连接图/沿边地块、变截面与共享高度/梯度，面板改值真正重建几何/摆放，保留完整环绕/缩放/复位。Three包同样复制到该例`vendor/`。它使用代理体检查生成机制，不是成品美术模板或最终画质评测。

## 程序表面：同源通道、实际尺度和复用

```js
import {createProceduralPalette} from './assets/materials/procedural-palette.mjs';
const palette = createProceduralPalette(THREE, {resolution:256, seed:37});
const wood = palette.get('wood', {
  variant:0, wetness:.4, tileSizeMeters:[.6,1.2]
});
mesh.material = wood;
```

`wood/stone/coated-metal`配方用同一结构区域产生线性颜色、roughness、metalness、米制高度，再通过已有烘焙器生成法线。`sample(recipe,{u,v,...})`返回同一场的样本；`inspect()`读回缓存参数。涂层露底区域同时影响颜色、金属度、粗糙度和高度，variant改变图案结构。涂层默认`wear:0`是洁净非金属漆面；只有显式`wear:0..1`才生成露底，其他配方不接受非零wear。湿润参数使颜色较暗、粗糙度下降、表面起伏变浅，是静态美术近似。

UV的一个tile必须对应`tileSizeMeters`。盒面投影用局部米制坐标除以tile；适合的索引网格`computeTangents()`，检查正交单位TBN。非均匀缩放、任意UV拉伸与复杂曲面不会被自动修正；细节闪烁先检查采样密度/物理尺度。读[表面细节](surface-detail.md)。程序纹理不会改变轮廓、真实厚度或开口。

现有装配器拒绝输入tangent并输出非索引几何。法线贴图需要显式切线时，先完成装配，再为输出顶点添加保持原分裂边界的顺序index并`computeTangents()`；不要焊接UV/硬法线接缝。组合例的设备箱使用1米UV tile并这样生成切线。复杂曲面不适用该简单面投影时保留独立资产路径，按其真实UV度量处理。

材质/纹理按全部参数缓存并由palette所有。实例共享，变体使用离散参数；不要每帧用连续wetness反复烘焙。动态湿润需另做已验证的uniform路径或有限状态混合。场景释放时`palette.dispose()`，对象不要单独释放共享材质。各模块的`dispose()`只回收其声明所有的资源，外部几何/材料由调用者管理。

## 环境、反射与后期：读回真实消费者

```js
const sky = createSkyEnvironment(THREE, {renderer, sunDirection:[-.6,.7,.3]});
scene.add(sky.root); sky.apply(scene);
// 每帧可跟随相机；修改太阳后按预算显式重捕获，不每帧做PMREM。
sky.follow(camera.position);
sky.setSun([-.3,.8,.2]); sky.capture();
```

与主方向光共享太阳方向和色系。`capture()`自动替换已apply场景的旧环境，释放旧目标；scene.environment后来由其他机制接管时保留该变更。动态对象需要场景镜像时才选平面反射；粗糙金属通常先用PMREM。

```js
const probe = captureEnvironmentProbe(THREE, {
  renderer, scene, position:[0,1.5,0], exclude:[receiver]
});
receiver.material.envMap = probe.texture;
const mirror = createPlanarReflection(THREE, {Reflector}, {
  geometry:planeGeometry, width:512, height:512, exclude:[rainRoot]
});
scene.add(mirror.root); // 几何局部+Z是反射面正向
```

探针完成后再赋材质；重捕获后要把新句柄接给真实材料并释放旧句柄。平面适配器在反射遍排除其他Reflector和显式对象，正常与异常都会恢复visibility、XR、shadow更新及renderer目标/viewport/scissor。`setEnabled(false)`隐藏反射面，基材由场景另建；纹理不能直接当作任意PBR材质的envMap。多平面互相反射不在此适配器范围。

后期构造器注入`EffectComposer/RenderPass/OutputPass`及需要的`GTAOPass/UnrealBloomPass/SMAAPass`。`setEnabled(name,bool)`控制实际pass，`setExposure`写renderer曝光，`resize(w,h,dpr)`重配buffer。链由适配器独占，销毁时恢复借用的renderer颜色设置；不要另叠一套tone mapping。中间半浮点buffer需要设备支持；不支持时显式走forward并说明缺失能力。

## 天气、共享场与工作台

`createWeatherField(THREE,{extent:[24,14,24],shelterHeightAt})`返回真实`root`。每帧`update(time,{anchor:[x,y,z]})`，位置由seed和绝对时间解析；`setIntensity`改变实际drawRange，`setEnabled`控制真实可见性。遮蔽查询返回世界屋顶高度或null，雨丝沿线采样三处；窄小/倾斜结构需要保守屋顶查询，不能声称逐三角精确遮雨。

雨量、表面湿润、水位、风和遮蔽是不同状态。只共享确有消费者的字段；例如`environmentState.wetness`进入材质选择，`rainIntensity`进入雨场，屋顶查询同时供分布与遮蔽。停雨不意味着地面瞬间变干。需要雨环、水花、排水或声音时另外实现与这些字段/事件的真实连接。

```js
const clock = createSceneClock();
const bench = createSceneWorkbench(THREE, {
  renderer, camera, controls, clock, onTime:updateScene,
  effects:{ao:{get:()=>post.passes.ao.enabled,
               set:value=>post.setEnabled('ao',value)}},
  modes:{asset:showSameAssetFactory, scene:showFullScene}
});
bench.setTime(12); // freeze并调用真实updateScene
const shot = bench.snapshot();
bench.setEffect('ao',false); // 调setter后读回真实状态
bench.restore(shot); // 相机/target/效果恢复，时间冻结
// 可选诊断UI：bench.mount(document.body)
```

工作台支持无parent的PerspectiveCamera及可选OrbitControls。恢复前清空OrbitControls惯性；动画若是累计模拟，`onTime`必须重建/复位其历史。`snapshot.stats`注明最后一次renderer调用或自上次reset以来的累计范围；组合例设`renderer.info.autoReset=false`并每帧reset一次，统计包含反射与后期多遍，不是持续GPU耗时。

## 从调用到效果成立

固定镜头、结构、时间、状态和曝光，复取基线后一次改变一个责任层：

| 机制 | 核对消费者 | 实际图像判断 |
|---|---|---|
| 表面 | map的颜色空间、roughness G/metalness B、normalScale、UV/切线度量 | 材料身份和区域是否可读，变化是否符合尺度/美术目标 |
| 环境/探针 | 当前scene.environment或material.envMap指向实际捕获texture | 金属/玻璃是否反映对应环境，室内是否避免错误天空高亮 |
| 平面反射 | 实际RT/镜像相机、排除对象、面方向 | 移动/换色物体能否改变镜中内容，遮挡和裁切是否合理 |
| 天气 | 实际position/drawRange/roof查询 | 轨迹、尺度与空间一致，遮蔽区和环绕方向是否成立 |
| 后期 | 实际pass.enabled、输出顺序、曝光 | AO是否帮助接触而非涂黑；Bloom是否保留高亮结构 |
| 共享结构 | 接口/锚点实际进入附件位置 | 结构尺寸变化后连接仍对齐，不能只在metadata里存在 |

像素差能证明开关影响画面，不能证明更美。完整作品至少在目标近景和互补方向看一次；若结构、负形或组团不成立，返回对应生成器/布局，后期不承担修补职责。

## 方法适用范围

现有配方、雨场、镜像与诊断场景各自只覆盖表中范围。新题材按自身形态、空间和光照目标选择；复杂有机网格、粗糙湿地反射、体积光和全场天气需要另行实现并实际验证。参考学习见[研究方法](research-methods.md)。

官方算法边界可核对：Reflector、OutputPass、PMREMGenerator。
