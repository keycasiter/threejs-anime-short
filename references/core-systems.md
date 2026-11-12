# 形体、空间、材光：从视觉标尺到完整实现

视觉设计已明确主要轮廓、空间和观看任务，准备组合生成器时读本页。沿既有六阶段推进，不增加并列流程。[完整源码入口](../assets/examples/core-lab/index.html)调用同一套生成器；参考图用于判断效果。

## 1 开工前固定的视觉关系

| 线 | 先取得的依据 | 实现中控制 | 目标画面的检查 |
|---|---|---|---|
| 形体 | 全形/截面、转折前后、内外壁、端部与连接两侧；未知侧背明确设计 | 截面对应、控制网、曲率/厚度、实体场与真实接口 | 灰模有主次曲率/负形；近景有口沿/洞壁/承托；活动包络成立 |
| 空间 | 总图/剖面、用途、路径/入口、高差、前中远与互补视图 | 同源图/区域/占用、资产族、层间连接与观看任务 | 全场有主次/用途；近看仍有完成内容；路口/孔/阶梯与边界一致 |
| 材光 | 同风格/景别的材料、受光/暗部、反射来源、接触与输出目标 | 形成区/物理UV、基色/BRDF、同向灯/IBL、分段受光 | 材料可辨，暗部仍读结构；反射带揭示曲率；多方向/曝光不靠死黑/过曝掩盖问题 |

标尺描述当前作品的关系；参考的题材、颜色、固定比例或构件数不是通用配方。PBR与风格化分别对照自身目标。先完成决定身份的代表关系及邻件，再扩场；近端配角和反向内容也有其目标景别。

## 2 真实能力与权威说明

| 任务 | 实现 | 输出与边界 |
|---|---|---|
| 闭合凸边界的设计截面与真实接面 | [contour-profile](contour-profile.md) | 环向连续台肩/回折/孔边、独立折边/材料带与真实三角查询；不替代任意凹域偏移或实体布尔 |
| 任意对应截面沿程变化 | [profile-loft](../assets/geometry/profile-loft.mjs)；[连续形体](continuous-surfaces.md) | 网格、凹轮廓cap与真实三角查询；输入环明确对应，不证明全局无自交 |
| 非轴对称单patch双层壳 | [bezier-shell](../assets/geometry/bezier-shell.mjs)；同上 | 控制网→内外壁/四封边/材料组/实际查询；不是任意多patch布尔或制造等厚证明 |
| 融合体/负形的网格 | [implicit-surface](../assets/geometry/implicit-surface.mjs)；同上 | 同版MC、负内正外场、采样/容量/退化检查；场可非SDF，有限采样不保证所有薄特征 |
| 无叠面道路与分层区域 | [world-layout](../assets/scene/world-layout.mjs)；[空间生成](world-layout.md) | 并集/孔、完整足迹、显式层间连接；不自动设计城市、房间或导航 |
| 真实原型沿街组团 | [frontage-neighborhood](frontage-neighborhood.md) | 用途/完整包络/入口→混合组团pose与诊断；不自动设计用途或保证填满 |
| 道路贴合最终地表 | [terrain-roads](terrain-roads.md) | 并集/孔×实际规则地表三角→有厚度网格/查询；单值地表，非桥洞/多层 |
| PBR与分段受光材料 | [look-palette](../assets/materials/look-palette.mjs)；[材光接力](look-development.md) | 程序材料/Toon梯度、独立基色、缓存/归属；复杂透明/体积/GI另选方案 |
| 同源直射灯与影区 | [lighting-rig](../assets/rendering/lighting-rig.mjs)；同上 | 方向/Box3派生主辅光/target/阴影；反射环境另接原[天空/PMREM](../assets/rendering/scene-environment.mjs) |
| 近远与观察任务 | [projected-detail](../assets/runtime/projected-detail.mjs)、[observation-view](../assets/scene/observation-view.mjs) | 投影尺度/迟滞、真实样点的候选机位排序；不是完整HLOD或自动构图评分 |
| 用途进入真实结构程序 | [区域程序](region-programs.md)；[工厂](../assets/examples/region-programs.mjs) | 展陈/作业/围合的不同开口、屋盖、内部和配套；是建筑构造方法，不是所有题材的默认三分法 |
| 地表与保留场地连续接力 | [constrained-height-field](../assets/environment/constrained-height-field.mjs) | 矩形保留面、平滑过渡及解析导数；网格/法线/落点共用，悬挑/洞穴另选表示 |

实际开口边、平台/屋面边和开放容器由同一[轮廓截面](contour-profile.md)接到局部结构、邻件和实测包络；临时来源随真实group进入[装配范围](assembly-provenance.md)，形成坐标在摆放前保存。截面配方属于当前设计数据，复杂边缘不会自动改善区域用途、主次或材料可读性。

详细参数/限制只在对应方法页和源码维护。轴对称仍用原回转工具，简单椭圆路径仍可用原loft；目标不需要的复杂能力不用加载。

## 3 完整代码例的输入输出与接力

[core-world工厂](../assets/examples/core-world.mjs)消费空间配置、结构参数、可选design、同版addons及`materialFor(role,options)`，返回root/parts、layout、placements、entrances/approaches、regionalAssets、局部anchors、materialBindings/materialRegionStats、detailGroups、viewTasks/observationSets、context/shadowBounds、解析update和dispose。工厂借用材料并拥有生成资源；应用拥有renderer、palette和相机。

`createCoreWorldDesign(configuration)`给出可编辑的同源设计。每个hall用稳定`id/regionId`关联真实用途区，尺寸与位置进入资产；`approachEdge`关联实际道路，决定入口朝向和到达面。程序读区域role，任务及`coreViewLabel(task)`读实际program/direction，改变记录顺序不改变用途。示例的区域名称与三种建筑程序是设计选择；新题材替换其设计关系。`placementTolerance`仅允许0–1米局部沿路微调，先验证并限制为最多21候选；不是让无界搜索替代布局。

到达面连接真实入口deck外缘和路面边界；道路边界包括outer与holes。连接段与邻面共边，避免同高叠面；旋转段没有物理chart时明确使用scalar材料。把通路、完整占用、入口、材质区和视图标签视为同一事实的不同消费者，逐一验证实际输出。

| 上游事实 | 实际消费者 | 改变后 |
|---|---|---|
| level/区域/图/link | 道路并集、完整足迹、区域放置、实际阶梯/栏杆 | 世界几何和相关接口一起替换 |
| 截面/控制网/场 | 主体、内外壁、边界、实际接点及邻件 | 新网格/查询/端口提交到同一handle |
| 材料绑定 | 应用逐槽选择PBR/Toon | 先解析完整候选材料表，再更新绑定；geometry/相机保持 |
| 真实特征样点与关系 | 全貌/区域/连接/背面及独特接口视图 | 样点/机位随形体变，不只复用英雄机位 |
| 绝对时间 | 可见动件层级 | 暂停/seek/导出同源求值，无累积偏移 |

原例以一个生成链运行轴网、环路和分层空间。新作品替换区域、原型参数和观看任务，保留适用算法；其中的建筑、布局和颜色不是默认模板。

区域用途先改变实际构造，再决定成员：展陈需要采光/展示/停留关系，作业需要工作面/通达/承托，围合需要中央负形/环向结构。工厂给完整局部footprint和入口，布局对它们做世界变换，再检查整轮廓退线；不是先放代理矩形、最后才发现屋檐/入口越界。

`world-layout`的`level.openEnds`只标明度数1且端面完整暴露的节点，输出`world.ports`包含中心、外法线、宽度及左右端点。连接体读取两端真实轮廓，而不是另算一个近似中心；层间link仍是图连接，不能单靠它证明实体无缝。高阶节点先设计分支/过渡面；方向不兼容的端口另做连接方案，不靠圆帽重叠遮住断口。

### 连接覆盖完整体积

端口+Z向外；附件全部有体积部分及开合区间应位于设计允许域。先确定本地轴、厚度和姿态范围，再检查实际角点/表面与邻件，原点对齐不等于装配成立。区分无意穿出与有意嵌入。

提取/采样改变真实边界：承托高度、包络与接头从最终网格派生，不沿用理想场/中心线近似。支承自身的形状、材料与边缘也要在近景完成；包围体只证明它实际覆盖的条件，不替代曲面贴合。

承压还需要有限接触面：圆底最低点接到基座不等于形成承压面。让显式回转/放样接口件负责平整端面、套接/法兰，连续部分保留适合的场网格。场与半空间相交可定义切平意图，但有限采样/插值不保证精确平面或足够面积；需要时使用明确的网格裁切/接口表示。顶部按实际接收面求位置/法线，再设计嵌入或接头；分别检查上下接触和中间过渡。

## 4 材光接到实际几何

未建立物理UV的曲壳/隐式体可先选`maps:false`。无贴图`baseColor`独立控制基色；`color`仍是乘色，深色配方乘浅色不会变成浅色材料。需要图案时建立合适坐标表示，而非给无UV模型强加纹理。

有法线贴图时同时检查UV周期对应的世界米数与切线架：**单位切线只证明方向，不证明物理尺度**。一UV单位为一米的面，烘焙tile也设为`[1,1]`。曲面/挤出斜边不共享同一正交chart时，分材料区或另建度量，不能只调用computeTangents追认正确。

```js
// 工厂给真实绑定，createLookPalette提供palette；所有输入均有消费者。
function applyLook(palette, bindings) {
  const geometry=bindings.map(b=>b.object.geometry);
  const candidate=bindings.map(b=>b.slots.map(s=>palette.get(s.role,s.options)));
  // Formation providers validate the actual source coordinates before mutation;
  // the original base palette has no validateMesh method and stays compatible.
  if(typeof palette.validateMesh==='function')bindings.forEach((b,i)=>palette.validateMesh(b.object,candidate[i]));
  bindings.forEach((b,i)=>{
    b.object.material=candidate[i].length===1?candidate[i][0]:candidate[i];
    if(b.object.geometry!==geometry[i]) throw Error('Look change rebuilt geometry');
  });
}
```

完整入口由[buildCorePresentation(T, options)](../assets/examples/core-presentation.mjs)拥有每个候选的world、PBR/Toon base与formation palettes、灯架及两份静态PMREM。初始`materialFor`和切换表读取同一候选provider；真实`materialBindings`完成两look/formed/base候选解析、实际source坐标验证后再赋值。`formation-palette`只在无表面贴图时叠加响应，已有物理UV贴图保留原路线；Toon非金属仍没有roughness消费者。石材aggregate、涂层aggregate、木材z向fibres和金属bands的米制参数是此完整例可替换的设计数据，形成基元不承担几何中层造型或全部真实材料。

| 组合输入或操作 | 实际消费者与边界 |
|---|---|
| `renderer / mergeGeometries / MarchingCubes / skyTexture` | 借用同版r180 renderer/addons与无太阳盘天空PMREM。天空必须使用二维 CubeUVReflectionMapping 图集：面边长 N 为不小于 16 的 2 的幂，宽 3×max(N,112)、高 4N，且不超过设备纹理上限；无太阳盘和预过滤内容由调用方保证。每候选独立材料，贴图只在其base palette内共享 |
| `configuration / roofLift / seed / resolution / shadowMapSize / time` | 原world结构、稳定role种子、材料及捕获分辨率（64..1024）、原灯影区和源世界解析时间；不修改布局/观察任务 |
| `look / formationEnabled / environmentMode` | 默认`pbr / true / world`；返回的`setLook`、`setFormationEnabled`、`setEnvironmentMode`选择已解析材料表/灯光/显式反射纹理，保持几何、相机和时钟 |
| `probePosition` | 可选有限xyz；默认由完整world bounds中心XZ与maxY上方得到；near/far覆盖完整源世界 |
| `diagnostics: {failAfterCapture: 0\|1\|2}` | 默认0；第1或第2个真实target完成后抛错，供slot验证迟失败回收；不进入world设计 |
| `readState / dispose` | 分离的palette/资格/实际envMap UUID及强度、捕获位置/时间/类型DTO；dispose幂等，异常时继续清理所有已登记资源 |

捕获只在临时私有Scene中放当前候选world与灯架，PBR和Toon各以formed材料/相应灯光执行一次`CubeCamera → PMREM`；背景/间接环境来自无太阳盘天空，背景强度1、环境强度0.8。捕获后脱离私有Scene，恢复请求的look/形成开关，返回无parent的root，才由slot提交。该probe是全场静态近似，不能提供分区、视差修正或动态反射。`environmentMode='sky'`与`'world'`对base和formed表都生效；支持IBL的材料显式envMap强度按原值乘一次0.8，切换不累计乘；Toon非金属不添加不存在的envMap属性。

候选捕获暂时启用完整color/depth/stencil清除、shadow更新和shader错误检查，并在成功/失败后还原 renderer target/face/mip、逻辑 viewport/scissor 与绑定目标的实际像素裁剪和测试开关、clear、XR、shadowMap.autoUpdate/needsUpdate、输出与 debug 回调。有绑定目标时读取 GL 当前 scissor 状态，可能产生同步开销；返回后目标自身的矩形属性保持原值。旧`onShaderError`仍被调用，其外部副作用无法由候选沙箱撤销；检测到编译失败会拒绝候选。候选失败保留旧slot世界；退役时world/灯、formation wrappers和base材料先于环境targets释放，每个 base palette、烘焙材质和贴图组合均尝试释放其所有子资源，汇总异常；借用 sky/renderer 不释放。

天空与世界probe共用显式拥有资源的`CubeCamera → PMREM.fromCubemap`路径。天空的私有源Scene只有原Sphere与`capture=1`材料，仍排除太阳盘；可见天空随相机移动，源Sphere保持原点。该路径避开native `fromScene`在渲染异常时无法回收的私有背景网格；天空不再保留闲置generator，每次尝试的cube、generator与内部资源均由临时owner清理。失败保留旧纹理、已应用场景和计数，可继续重试。相较直接`fromScene`，多一次拥有明确归属的cube捕获，天空采样路线与成本可能变化，须以实际GPU画面/资源比较核对，不保证字节相同。

PMREM输出使用锁版r180归属边界：同步调用期间只临时包装当前generator实例的native `_allocateTargets`，native完成LOD、ping-pong与blur初始化后立即登记/校验返回的输出，再继续原`fromCubemap`转换/模糊。成功或失败都还原实例方法，不修改全局原型、不复制PMREM算法。只给fresh generator传显式target会跳过必要初始化；版本/接口不符明确拒绝，升级Three必须重新核对并验证此私有协议。输出释放异常不跳过其它已登记清理。旧shader回调异常延迟到输出归属安全后拒绝候选，回调本身的外部副作用仍不回滚。

相机/交互/时钟与最终输出见[main.mjs](../assets/examples/core-lab/main.mjs)。工作台的形成开关和天空/世界反射选择用于固定几何/机位比较；两种迟捕获失败按钮用于资源与保留旧世界检查。主Scene继续保留天空环境供外部物体使用；直接输出只做一次ACES/sRGB转换，PBR/Toon最终曝光仍为1.1/1.05。使用Composer时按其OutputPass契约接线。CPU真实world与显式fake GPU hooks的测试不替代真实WebGL、原参考同景别审图或资源测量。

分段受光也需要间接亮度/补光与材料身份；看暗部里的结构，不以黑影面积证明体积。金属反射需要真实环境。柔影、AO或Bloom按目标接现工具，保留少变量对照。

引擎的cap/side默认组只说明构造步骤，不说明屋面、底面或包边。先给真实面定义材料语义；[assignMaterialRegions](../assets/materials/material-regions.mjs)从实际三角的几何法线/位置分区，完整匹配成功后才替换groups，保留顶点/索引与顺序。规则冲突或缺失会拒绝；连续组增加的draw calls纳入预算。程序配方已有色素时默认中性乘色；独立浅基色用baseColor，不叠加不明的二次压暗。

静态合并同时保留语义身份和渲染状态：`role + 规范化options`标明原材料区，材质实例、投影标志等决定绘制兼容。多个区在灰模阶段可以借用同一Material；`material.uuid`相同不代表它们以后都是木材或涂层。合并时按语义分桶或保留真实组区间，切换look读取原槽；用共享灰模→差异材质与直接差异材质构建对照，检查实际三角分布和几何身份。

当前core/context在源部件自有几何上写入`aFormationPosition`，经真实材质组提取和静态装配交给所有materialBindings；写入时排除lot的刚性摆放。读取方式、共同资产frame和借用边界见[形成坐标](formation-coordinates.md)。完整入口默认由[形成palette](formation-palette.md)将字段交给[形成响应](formation-response.md)，关闭形成开关则切回同一候选的base表；自定义其它场时再用[材质扩展桥](material-shader-bridge.md)。字段存在、通过校验和实际受光可见分别核对，完整效果仍与原目标审图比较。

灯架可选`hemisphereIntensity/skyColor/groundColor`提供真实天空/地面半球补光。把主光照亮的面、朝天暗面和朝地暗面分开检查；这不是GI，也不替代接触阴影。近场阴影bounds覆盖必要投影者/受影者，远景地形不与近景共享无限扩大的拟合区。远层投影策略显式决定，避免增加场景后阴影精度随之消失。

## 5 规模、观看与上下文

`selectProjectedDetail`读取直径、相机空间正深度、视口、FOV及该对象上次level，以前侧深度估尺寸并加迟滞；包络内选最高细节。例中只切次级紧固件，主轮廓、洞/道路/基部与身份保持。不是隐藏主要族满足预算，也不保证复杂曲面屏幕误差。

`selectObservationView`接收设计者给定的候选相机、真实表面点及遮挡物，以原可见性工具排序；在构建/切视图时用，不逐帧跑全世界射线。它不发明焦点、不判断美感，最高样点可见率也可能构图差。保留互补视图并审图；层间/入口/负形另有观察任务。

样点按相关可见面与任务选取；只取同一侧的点会把某个朝向的偏好藏进分数。需要比较互补方向时采样相应表面，候选顺序保留设计者的构图偏好；近景仍查看界面遮挡、画幅裁切和整体负形。

关键接口用`requiredFeatures:[{id,points,minVisibleFraction}]`分别检查，不能让大量主体样点补偿一个消失的落点。`frameBounds`只检查整个叙述包络是否入画，`marginPixels`保留画幅边距；包围盒不参与表面可见性替代。所有候选都不满足时仍返回真实未满足状态，需要重新设计机位或上游空间，不能将最高分当通过。页面遮挡同时影响关键feature比例。

互补面由观察集合接力：给真实表面样点稳定ID并注明所属构件/端部/朝向，每个视图承担能同时看见的关系，再核对视图集合的联合覆盖。正面与背面互补的目标不应被写成单张图全部可见；也不能通过降低总比例掩盖具体缺失项。局部机位检查连接双方，整场反向机位另检查上下文，二者职责明确。

局部机位的前进、侧移和抬高沿对象的实际法线/水平切向/+Y构造，再转入世界坐标。资产转向道路后，硬加世界X可能变成向前推近并裁掉包络；用真实变换后的完整bounds复核全部近景与背向任务。

### 区域、原型、宿主与道路的接力

[上下文工厂](../assets/examples/landscape-context.mjs)按同一条生成链组织场域内外。两种空间组织来自编辑的区域/道路图，原型和用途由设计决定；距离层、用途名称和数量都是例中的可替换数据。

| 顺序 / 共享源 | 传给下游的内容 | 完成条件 |
|---|---|---|
| 区域与道路图 | 连通分量、用途、实际道路并集及暴露端口 | 主场/外围端口朝向、全宽、高程和行走净空一致；图连通还需实体通路验证 |
| 正式原型工厂 | 真实完整包络、入口、结构规格和局部地面基准 | 包络包括屋檐/deck；变体改变实际内部结构/体量，材料身份独立 |
| [混合沿街组团](frontage-neighborhood.md) | `prototypeId/regionId/edgeId/groupId`、世界pose、完整足迹、入口和诊断 | 全轮廓资格与邻件防重叠成立；检查用途覆盖、组间留白与预算余项，再实例化 |
| 最终地形与[贴地道路](terrain-roads.md) | 保留面→最终网格→同一份地形三角索引→各自的道路/入口查询 | 场景在网格定稿后调用一次 `prepareTerrainRoadSupport({terrainGeometry})`；街网和入口用 `terrainSupport` 借用该索引。先释放道路，再释放共享索引及网格 |
| 实例与静态合并 | 真实原型/pose、语义材料槽、观察数据与资源handle | 材质共享仍保留语义；全貌/区域/入口/侧背分别读图，重复数量不代表世界丰富度 |

示例接收两个地面端口：`center` 在当前道路层（Y=0），`normal` 是指向主场外的水平单位向量，`width` 是完整净宽。用法线确定首段走向，用水平横向量确定端面左右边；两端连接时，中心重合、法线相反、左边对应对端右边。近圈街道内须能容纳整宽端面、4 个场景单位的直行段及转向空间；两条路线还须通过平面图不交叉、并集端面完整暴露和网格精度检查。端口平台跟随同一局部方向，并为实际地形网格单元留出支承余量。此例不推断任意主场的障碍物或自动寻找绕行路线。

支承表记录实际宿主及其有限表面/高程，所有站立家具与通路构件从该记录派生。高层平台、地面道路和室内地板是不同宿主；改变其中一个高程应更新所属的全部消费者，而不是抬高单个摆件。检查实际基部和承托上下关系：道路顶面连通还须验证底部支承，路口整宽能落脚还须用水平净空射线核对路缘/立物。采样不能代替任意碰撞或承压证明。

以下项目根目录ESM直接调用完整工厂；`three`及addons使用与入口相同的锁定版本。灰模借用一个材料，但各真实语义槽仍保留，后续可按槽切换look。

```js
import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createResourceScope} from './assets/runtime/resource-scope.mjs';
import {buildLandscapeContext} from './assets/examples/landscape-context.mjs';

const owner=createResourceScope(), scene=new T.Scene();
const clay=owner.own(new T.MeshStandardMaterial({color:0xb8b6ac,roughness:.8}));
try {
  const context=owner.own(buildLandscapeContext(T,{
    mergeGeometries, materialFor:()=>clay, configuration:'ring'
  }));
  scene.add(context.root);
  console.log(context.design.topology,context.sites.length,
    context.neighborhood.diagnostics.status,context.roads.stats.topTriangles);
  const snapshot={sites:context.sites.map(site=>({
    id:site.id,prototypeId:site.prototypeId,regionId:site.regionId,
    position:[...site.position],rotation:site.rotation
  })),stats:context.stats};
  console.log(JSON.stringify(snapshot));
} finally {
  owner.dispose(); // context先释放生成几何/挂载，再释放共享clay。
}
```

完整renderer/材光/实际操作仍由[core-lab](../assets/examples/core-lab/index.html)提供。上述CPU构造与JSON检查不替代浏览器或视觉验收。

静态装配可能中途放弃时，从创建就由scope拥有`createAssetAssembly`的builder，完成后借用其finish结果；builder.dispose同时覆盖未finish的私有快照和已finish的生成几何。材质/源几何/动态子树保持借用；不要再把同一生成几何登记给第二个owner。

外围族按近景同一开口/边缘/材料规则生成，再依目标景别简化；环绕/缩放后仍有围合、支承与背面。扩场依用途和结构族变化，噪声/颜色随机不承担中层造型。

## 6 验证与交付

| 层 | 判断 | 不能据此声称 |
|---|---|---|
| 算法 | 拓扑/属性、真实命中、边界、资源及失败 | 画面好看 |
| 完整组合 | 主要族/层间接口/材光/时钟/所有者接通 | Agent必然选对方法 |
| 视觉 | 按目标看全貌/区域/接点/互补方向，记录最弱图与差距 | 截图数等于独立样本数 |
| Agent/完整作品 | 冻结任务，同条件新旧版从零，匿名审图和成本；短/详细输入同范围 | 一个手写例足以证明泛化收益 |

先登记参考、任务、版本/视口、参数/机位与口径；原视图/失败保留，不删弱项换通过。发现独特关系可增加补充视图，补图不能冒充独立作品。

复制所需assets并保留相对结构；在core-lab/vendor放同一个r180的build/、examples/jsm/与LICENSE，用HTTP打开。源码/包与真实渲染绑定版本，解包实际验证依赖/操作/退出。内核与示例只证明所测范围，完整作品仍按[统一验收](validation.md)交付。
