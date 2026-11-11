# Three.js 代码化制作SOP

本页负责实现方法；完整生产顺序见[生产流程](production-workflow.md)，放行标准见[统一验收](validation.md)。按当前问题读取相应章节。

| 当前问题 | 章节 |
|---|---|
| 规格、相机包络、细节预算与生成规则 | 第1节 |
| 几何表示与资产生成代码 | 第2–4节 |
| 材质、灯光、环境shader和粒子 | 第5节 |
| 基础绝对时间动画 | 第6节 |
| 画面诊断与迭代 | 第7节 |

## 技术片段的适用条件

本文件中的 Three.js 代码是特定表示或管线的工作范例，不等于所有项目的统一模板。采用前先对照当前 Three.js 版本、renderer/backend、模块实例与导入方式，再确认该做法的几何假设、坐标/时间输入、GPU消费者、更新/资源生命周期、目标设备成本和目标镜头。条件不满足时换相邻表示或先做最小验证；不要为了复用示例而改变对象设计。涉及动态数据时，分别确认 CPU 数据、GPU buffer、包围体、阴影/反射和拾取是否同步；静态资产不必增加无用的逐帧更新逻辑。

本指南适用于所有题材的 Three.js 动画制作。目标是把视觉、空间、结构、材料和运动要求转为可维护的代码，再由 Three.js 真实构建并渲染场景。

```text
需求/事实参考/生成式视觉参考
  → 可观察特征与场景规格
  → Three.js资产生成函数、材质、动画和特效代码
  → 运行时几何/着色/姿态数据
  → 目标相机和灯光渲染
  → 图像检查与根因迭代
```

**图像生成模型的输出默认仅为参考。** 不把它作为最终背景平面、sprite、贴图、视频层、DOM图像或导出帧。要做2.5D时也用代码创建有空间关系的几何卡片/层和程序化材质。只有用户明确要求使用图像素材进入成片时才允许例外；此时在规格与交付说明中标明该素材和它替代的代码建模部分。

Three.js里可见的网格由`Geometry + Material + Object3D变换 + Camera + Renderer`共同产生。模型代码生成顶点/索引/UV/实例变换，材质代码决定颜色与光响应，场景代码管理父子关系/灯光/相机，时间函数更新对象状态，最后由renderer输出画面。制作应沿这条数据链定位，不把“调用了Three.js”或“页面有canvas”当作实现完成。

常用项目可分成下面几层；短片可以合并文件，但功能边界仍要清楚：

```text
src/
  main.js                 初始化 renderer、camera、scene 和 renderAt(t)
  scene/buildScene.js     灯光、环境、主体布局、相机轨迹
  assets/build-*.js       每种可程序化资产的几何生成函数
  materials/*.js          共用材质和 shader
  effects/*.js            水、雾、粒子、接触/尾迹反馈
  animation/stateAt.js    从绝对时间求出所有姿态与FX状态
```

一个静帧先跑通最小场景：

```js
const width = 1280, height = 720;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(1); // 离线逐帧导出使用明确的目标像素尺寸
renderer.setSize(width, height, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#203044');
const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
camera.position.set(0, 4, 12);
camera.lookAt(0, 2, 0);
scene.add(new THREE.HemisphereLight('#b9c9e9', '#172233', 1.1));
const key = new THREE.DirectionalLight('#ffe0b0', 2.2);
key.position.set(-4, 8, 5);
scene.add(key);
document.body.appendChild(renderer.domElement);

function renderStill() { renderer.render(scene, camera); }
```

新场景用此入口或工程既有入口运行代理几何，完成全场景与目标机位，按[生产流程阶段2](production-workflow.md#2-场景资产设计与方案选择)保存真实取帧与审图结论。随后才把决定识别度的部位替换为正式资产。后续用相同目标视口、曝光和相机比较；最小入口成功本身不代表构图成立。已有场景保留真实渲染入口，按[生产流程阶段2](production-workflow.md#2-场景资产设计与方案选择)判断哪些同目标通过证据可继承、哪些相机/布局/形体需重选，不另建一套渲染管线。

## 1. 先建可执行规格，不直接照图堆对象

为场景建立一个可读规格。区分已知事实、从视觉参考观察到的特征和美术设定；生成图本身不证明真实比例、背面、连接或尺度。

| 规格项 | 需要写下的内容 | 进入代码的位置 |
|---|---|---|
| 场景坐标 | 世界单位、原点、上方向、主体前向、地面/水面高度 | `Group.position`、局部坐标与锚点 |
| 镜头 | 画幅、机位、焦距/FOV、主体占幅、景深关系 | `PerspectiveCamera`/`OrthographicCamera`、景别参数 |
| 主体形体 | 总宽高深、截面/关键轮廓、识别性特征 | 生成函数参数、几何顶点、部件层级 |
| 结构关系 | 哪些连续、分件、搭接、留空或支撑 | 几何连接、父子层级、遮挡和接触点 |
| 颜色与材料 | 主色、材料分区、粗糙/金属/透光/自发光差异 | 材质实例、shader uniforms、代码化纹理 |
| 环境 | 地形/建筑/水雾的范围、重复节奏和深度层 | 参数曲面、实例规则、环境 shader/粒子 |
| 动作 | 起中止姿势、轨迹、速度变化、环境反馈 | `stateAt(t)`、锚点函数、uniform/实例状态 |

把图像参考转成映射表，再写几何：

| 观察到的参考特征 | 可量化/可编码规格 | Three.js消费者 | 验收方法 |
|---|---|---|---|
| 主体剪影与轮廓转折 | 归一化宽高比、截面点、顶部/底部形状 | `Shape`/`BufferGeometry`/组合体 | 黑色剪影、侧视与目标机位 |
| 重复结构和节奏 | 数量区间、间距、尺寸变化和随机种子 | `InstancedMesh`、参数化布局函数 | 远景轮廓、重复节奏和遮挡 |
| 连接、厚度与空腔 | 厚度、搭接顺序、支撑/空腔关系 | 独立有厚度网格、截面、父子层级 | 近景旋转、掠射光和穿插检查 |
| 颜色与受光 | 色板、材料边界、主光方向/软硬 | `Material`、光源、shader | 灰度/色彩图对照、材质响应 |
| 水/雾/光迹 | 起点、方向、尺度、持续/衰减方式 | 曲面、shader、实例粒子与锚点 | 事件前中后帧、静帧和连续播放 |

### 场景构图、参考映射与相机包络

相机、布局与主体中层的设计步骤统一见[构图与形体方法](composition-and-form.md)：从屏幕关系决定观看方式，用完整代理选择空间关系，再按结构节点生成截面、厚度、开口与承接。该页含世界锚点到视口的实际投影代码。下面负责相机模式与覆盖；几何实现按第2–4节选择，不把基本体或噪声作为所有对象的统一答案。

相机模式必须在制作规格里明确：导演镜头、时间轴播放页、自由环绕场景或固定点全景。360°环绕的3D场景不是360°全景图/视频。仅有播放/暂停/拖动控件不代表场景可浏览。

影片与自由查看并存时，分离导演相机和交互相机状态：`cameraStateAt(t)`还原影片机位；自由模式下，时间函数仍更新场景和效果，但不得覆盖用户相机。页面提供清晰的模式切换/复位；导出时确定性地使用影片相机。先定义环绕中心、水平范围、俯仰上下限、最近/最远距离与缩放边界，并让地形/地面/天空/地平线、远景、物体背面、透明面和阴影反射覆盖相机包络。

提供完整环绕时，实际拖动完成一整圈并检查至少8个方位，再看可达俯仰和近远端点。验证背景和地平线连续、地面/水面不露边、背面不空、没有穿模/裁切、透明排序和阴影不会因转向消失。失败处回到场景覆盖或控制范围修复；不能用黑幕、遮罩或过度限制隐藏。固定镜头交付则明确写固定/导演相机，不把“页面能拖”称作无死角浏览。

相机轨道可能经过地形、建筑或其他不透明表面时，在每个代表方位及俯仰/远近端点核对两项不同问题：**相机位置是否与最终承载几何相交**，以及**预期可读的焦点/场景区域是否被中间表面遮挡**。地形优先用最终网格射线命中，规则高度场可用与输出三角划分一致的采样；仅查看目标点高度或上游解析场不够。记录请求机位、实际机位、最小安全间隙，并为每个视向抽查通往其关键可见锚点的首个射线命中；按设计允许遮挡，但不能把焦点被坡面挡住或画面只剩无信息近景当作视角通过。若控制器会抬高/推开相机，复核实际构图和观看范围仍符合规格。仅当地下/内部视点是有意设计且内容已建模时，才接受相机与表面相交。负间隙、无效命中或关键视线意外受阻，应回到相机/场景空间设计处理，不能留给视觉审图猜测。

### 资产开工前的质量预排：把常见失败变成可计算约束

在写细节几何之前，先用最终相机、目标分辨率和画风做一份短的“资产实现计划”。它是代码设计输入，不是对渲染不满意后再补的修图单。

| 开工前确定 | 写下或计算 | 对应的 Three.js 做法与预防检查 |
|---|---|---|
| 投影轮廓与负形 | 目标视口占幅、宽高比、轮廓层级、必须保留的空隙/开口、近中远细节尺度 | 以目标相机检查草图/代理轮廓；给前中后层分别规定可辨认形体，不能等到铺满细节后才发现剪影读不出来 |
| 形体与结构覆盖 | 把识别特征列成主形、中层结构、表面信息；对分件/分枝/分层/关节对象，记录父子关系、锚点、接触、搭接/穿入与可见边界 | 每项映射到几何生成器或材质职责；子件从结构上有效的父件/承载面建立连接，不能只放在附近。单体连续形状不必虚构父子锚点 |
| 重复几何预算（有重复项时） | 实例/粒子/重复构件的计划数、LOD密度和性能上限 | 先对生成计划求和，再创建 `InstancedMesh`或所选批处理结构；容量不足时先按目标像素调整密度/LOD并重算，禁止静默丢弃剩余项。矩阵/颜色写入后标记相应attribute更新；实例布局变化后按需要刷新包围体 |
| 自定义网格约束（手工生成 BufferGeometry 时） | 截面/中心线段数、局部坐标架、可见端面、UV、法线、包围盒，以及需要的碰撞/变形锚点 | sweep/loft 可用连续局部基底（如 `computeFrenetFrames`）；只有表面跨UV边界时才处理接缝顶点；仅在端口可见或封闭体需要时生成端盖；计算法线/包围盒并检查退化三角形、绕序和反面 |
| 可见边界与覆盖 | 哪些端部、开口、接缝、遮挡边或裁切边需要收尖、封口、内壁、搭接、覆盖或有意保持裸露 | 用适合对象的边界清单逐项核对；例如管件端口、建筑开口、枝条终端采用不同处理，不能把某一类对象的覆盖法则套给所有资产 |
| 材质细节来源 | 大/中/小尺度分别由几何、顶点色、UV纹理、程序纹理或 shader 哪一层负责 | 使用UV纹理时核对UV密度和接缝；颜色贴图设 `SRGBColorSpace`，数据贴图使用数据色彩空间；没有相应坐标/属性的几何不能假设材质特征会正确显示 |

**先验证自定义网格原型，再调形和扩展。** 对手写索引的生成器，先输出一个中性、单面材质的样件，核对实际顶点/索引的有效性、退化面与预期朝向，再调整轮廓、噪声、灯光或实例数量。`computeVertexNormals()`只计算现有绕序对应的法线，不会修复反向索引。可复制[三角形审计工具](../assets/geometry/audit-triangles.mjs)，直接检查已发出的BufferGeometry：

```js
import { auditTriangles } from './geometry/audit-triangles.mjs'; // 复制到项目后按实际路径导入
const report = auditTriangles({
  positions: geometry.attributes.position.array,
  indices: geometry.index?.array,
  expectedDirection: [0, 1, 0], // 仅适用于单值高度场的上表面
});
// invalid / degenerate / opposed 非零时，先定位三角形构造。
```

预期朝向由表面语义决定：高度场上表面可用+Y；端盖、侧壁分组检查；封闭体、折叠面和倒扣不能全局套用+Y；有独立局部参考场时使用下述expectedDirections，否则省略朝向参数，仅检查有效性/退化，再用外法线设计与单面环绕样件确认。工具检查普通position BufferAttribute的局部坐标，使用尺度相对的退化阈值；交错属性先按getter展开xyz，负缩放/镜像实例另查世界变换和单面视图。工具不检查自交、水密或构图。极点/收尖处应生成单极点扇形连接，不把整圈顶点压到同一点后仍保留零面积面。若双面材质使缺面消失，用它定位背面剔除问题后修正绕序，再恢复目标材质。固定seed、形状和机位比较修复前后，确认可见表面恢复；随后才判断形状是否达标。

做实体/导入网格的拓扑诊断时，显式记录顶点等价关系。硬法线、UV或材料边界可以拆分属性顶点；内核提供的拓扑合并信息应随导出保留。分别检查原生拓扑与实际渲染坐标：按位置焊接后的多用边可能来自不同闭合壳体的重合接触，不能直接称为开边，也不能仅凭原生拓扑通过忽略接触、自交或可见伪影。用一个属性接缝样件和一个相接闭合体样件核对诊断含义；边界、多用边、面朝向和自交各有不同范围，容差与坐标精度随报告记录。

### 给转向与局部形变保留足够空间

设计扫掠/形变时，先共同配置截面尺寸、中心线/过渡长度和沿程转向，不将宽截面在短距离里强行旋转。若厚壁局部翻入，优先延长过渡、先收小截面再转向、设计独立接头或改用合适的体积表示；改变表示后保持功能接口。由解析映射生成时可推导其局部变化界限或Jacobian符号；采样检查只覆盖所采区域，不能代替全局自交检查。

在生成器第一次发出变形网格时，同时保留独立参考方向。厚壁可从同参数的外/内采样点得到`F(outer) - F(inner)`；它与发出的position使用同一坐标系，不能拿输出三角形重新算出的法线充当独立参考。对适用的外壁索引执行：

```js
const facing = auditTriangles({
  positions: geometry.attributes.position.array,
  indices: outerFaceIndices,
  expectedDirections: mappedThicknessDirections // 每个position顶点对应一个xyz
});
// 该参考场成立的前提下，opposed说明局部朝向违反了外壁厚度语义。
```

`expectedDirections`与全局`expectedDirection`二选一；数组长度须与position一致，参与检查的参考向量应有限、非零，且三角形内不相互抵消。内壁、口沿和有意双面薄片按各自语义另查，不套用外壁参考。闭合索引、总体积为正和重算法线都不能单独排除局部翻入。固定几何与机位，分别切换收影和显示侧可区分阴影与表面缺陷；修正几何后恢复目标状态，再看真实材料与互补视角。

实例预算的标准写法是由布局计划推导容量并校验完整写入，不在生成循环里截断。此段以静态、同拓扑对象为例；动态变更时还需决定如何回收槽位、更新相关attribute和维护包围体：

```js
const plannedCount = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
if (plannedCount > instanceBudget) {
  throw new Error(`Planned ${plannedCount} instances exceeds budget ${instanceBudget}`);
}
const instances = new THREE.InstancedMesh(geometry, material, plannedCount);
let written = 0;
for (const cluster of clusters) {
  for (let i = 0; i < cluster.count; i++) {
    // 从确定性布局规则求位置、朝向和尺度，再写入实例矩阵。
    instances.setMatrixAt(written++, matrixFor(cluster, i));
  }
}
if (written !== plannedCount) {
  throw new Error(`Instance plan mismatch: planned ${plannedCount}, wrote ${written}`);
}
instances.count = written;
instances.instanceMatrix.needsUpdate = true;
instances.computeBoundingBox();
instances.computeBoundingSphere();
```

`instanceBudget` 是性能上限，不是目标数量。若重复项计划超限，依据目标视口的可读性和LOD有意降低/合并数量，再重新计算；不能让遍历顺序决定哪些区域或类别被丢掉。该容量检查适用于实例/粒子等计数型生成，不适用于单件网格；其他表示也要对其实际资源预算做相应检查。

将尺寸归一化到一个稳定标尺（如主体高度=1或场地宽度=10），先用低细节模型确认相机、比例和相对位置，再按最近景别提高结构密度。不要从生成图直接描像素轮廓后把一个平面当成模型。

### 细节规格、像素预算与高品质资产配方

细节要把对象做得更可辨认、更有结构、更能受光，而不是只增加网格数。进入资产编码前，为前景/焦点对象制作“视觉细节规格表”；背景可以按镜头缩减层数，但必须说明删减依据。小项目可把表格直接写入 brief 或镜头表。

| 对象 | 镜头占幅/距离 | 专属剪影与大形 | 中层结构 | 表面与受光 | 动态/空间关系 | 代码表示 | 目标视口验收 |
|---|---|---|---|---|---|---|---|
| 主焦点资产 | 预计像素宽高和景别 | 能与同类对象区分的轮廓、比例和负形 | 需要辨认的连接、分段、接缝、空腔或层级 | 材质分区、粗糙/透光差异、局部变化 | 适用的锚点、支撑、遮挡、运动 | 自定义几何/截面扫掠/组合网格/实例 | 缩略图剪影、原尺寸、近景裁切 |
| 支撑资产 | 预计可见尺寸和焦点等级 | 形态家族与远景边界 | 影响识别的主要结构 | 与焦点有区别的明暗/色温 | 与地面、主体和镜头的关系 | 参数化生成器/InstancedMesh | 目标机位重复节奏和遮挡 |
| 环境层 | 前/中/远景位置 | 场地与群体对象的层次轮廓 | 地貌、岸线、构件群、道路或立面节奏等场景特征 | 随距离变化的明度、色相和雾化 | 视差、运动场、光照与焦点关系 | 高度场/曲面/分层几何/程序化材质 | 建立镜头、全景和运动中纵深 |

对有装配或关节语义的对象，在规格中补一张“结构关系”清单：每个子件的父级与连接锚点、是否承重/搭接/穿入、关节枢轴与允许运动范围、会变形的区域和对应控制锚点。建筑写支撑和开口的深度，机械写转轴/限位，生物写骨骼或软组织的连接与变形；参考不足时将数值标成设计设定，并在模型或动作测试中验证。有关节的对象还要检查运动范围两端的干涉和净空。仅列零件名字和面数不能说明结构成立。

#### 把对象拆成可实现的形体层级

| 对象类别 | 代码建造顺序 | 需要表达的细节 |
|---|---|---|
| 车辆、机械和可装配物 | 主要包络/承载骨架 → 动力/运动部件 → 外壳与操作界面 → 接缝、倒角、标记 → 运动与受力检查 | 轴、铰链、滑轨等需真实运动就使用可验证的局部枢轴与限位；静态装饰不必虚构机构 |
| 角色、动物和软硬混合体 | 整体比例与姿势轮廓 → 骨架/体积 → 关节和变形区 → 皮肤/服装/表面特征 → 接触与表演 | 区分刚性附属件和连续表面；检查极限姿态的体积保持、穿插、支撑与视角识别 |
| 树木、花草和有机植被 | 树种/形态规格 → 根部与主干中心线 → 沿曲线收分的枝干层级 → 按物种定义不对称树冠 → 表面叶片/花簇实例 → 地面落叶与遮挡过渡 | 主干粗细随高度变化；枝条从正确锚点分叉且有等级；树冠不能退化为若干相同球体；叶片密度遵循冠层体积、朝向和光色分区 |
| 山体、地面和道路 | 大尺度坡面/山脊 → 中尺度沟谷、坡肩和平台 → 按地形高度采样的路径曲线 → 变化宽度的道路/铺石 → 路肩、碎石、植被和冲刷痕 | 路面贴合坡面；道路边缘与地表有过渡；远山保留多层轮廓和明度差；不能用平面或竖墙代替连续地形 |
| 建筑、亭台和器物 | 占地/体量与独特外轮廓 → 承重或装配层级 → 屋檐/梁柱/窗洞/接缝等可识别结构 → 倒角、厚度和表面材料 → 实际受光与投影 | 每层结构有厚度、连接和遮挡逻辑；门窗是开口或有内壁的凹入结构；屋顶/檐口由截面和层级构建，不靠单片薄面贴图 |
| 石头、岩层和地表碎屑 | 轮廓和主截面 → 受地形/重力影响的堆叠关系 → 顶点形变和局部断面 → 色带、粗糙度与接触阴影 | 变化不能只是随机缩放同一个球；相邻石块要有尺寸族、朝向、压叠和缝隙节奏 |
| 群体/抽象构成 | 整体节奏与负形 → 可复用形态家族 → 受权重/路径/规则控制的布局 → 焦点对比与局部变化 | 规则要服务整体构图；重复变化不能造成随机噪声，也不要求具象对象式的装配或接地 |
| 水、雾、烟和风 | 确定范围、边界、流向及空间锚点 → 曲面/体积轮廓 → 频率分层与材质响应 → 从绝对时间求值的扰动和消退 | 效果随视距、光线、表面和事件变化；粒子不能代替主要体积，噪声不能代替结构 |

**分枝结构的代码落实。** 将主干和枝条保存为带父级、连接锚点和枝级的骨架图；半径按枝级与沿程收细。Three.js可用端点间的[`CylinderGeometry`](https://threejs.org/docs/pages/CylinderGeometry.html)配合[`Quaternion.setFromUnitVectors()`](https://threejs.org/docs/pages/Quaternion.html#method:setFromUnitVectors)快速定向，或用沿中心线变化截面的扫掠网格提升弯曲和截面控制；枝根交汇需几何搭接或专用节点体，不能只让线段端点相碰。再按物种/设计包络，把叶片、针叶簇或其他表面体量沿有效枝条布置，控制它们共同填充树冠而保留有意空隙。静态形态族可合并网格或复用实例并以固定seed改变枝角、长度、密度和冠幅；不要把分枝骨架直接当成完成资产，也不要只堆同尺寸球/锥。验收目标机位及侧背剪影：冠层既不能稀成裸架，也不能糊成无结构团块；近景细节和中远景体量按投影尺度分配。

### 从主形到中层的多遍生成

表面需要经过多种形成过程时，不要把各类变化揉成一个 `noise(position)`。将上游形状、受限区域和后续消费者连成一条可追踪的数据链；这些是职责，不是固定节点数，也不要求每种资产都使用噪声或体素。

| 遍次 | 输入与操作 | 产物及检查 |
|---|---|---|
| 主形 | 轮廓/截面、中心路径或承载约束；先定义范围、重心、主轴、脊谷和必要负形 | 低频连续几何；目标剪影、主要空隙和落地关系成立 |
| 区域与引导 | 从位置、方向、坡度、曲率、承载、已有结构或设计区域产生有限权重；对权重平滑、扩张/收缩或组合 | 语义明确的命名场，例如 `ridgeMask`、`contactMask`、`weatheringMask`；检查实际非零区域与过渡范围 |
| 中层结构 | 按形成原因依序操作，例如大折面→压实/切削→次级断层；把位移幅度、方向、频率与影响范围分别绑定到区域场 | 新顶点和可读转折；单独关闭每遍可确认它改变了哪条轮廓、负形或接触 |
| 拓扑/属性修整 | 只在布尔、融合、体积重建或形变确实产生问题时清理；按需要重新投射/生成法线、UV与属性 | 连通片、边界、法线与细节损失可检查；修整前后的范围/轮廓、UV等保留需求有记录 |
| 下游派生 | 由同一稳定空间字段采样路径、承载、材料区域和实例点；需要变体时用有界参数与固定种子生成 | 网格/材质/散布指向实际使用的共同数据；相邻构件有承接，密度随坡度/区域/视线调整 |

编码前先画清字段依赖：`主形/承载 → 区域与方向场 → 中层几何 → 修整后的表面 → 材质、路径与布局`。字段名本身不会产生视觉效果：每个消费者必须将其读入顶点位置、采样坐标、材质通道或实例变换。若三个组件各自重新随机一遍，它们不会自动对齐。动态修改场或网格时再同步包围体、法线、UV和阴影/反射消费者；静态生成则不要添加无用的逐帧重建。

**先定义相交特征的优先级，再组合字段。** 两条引导线各自进入几何，不代表它们相遇后仍形成正确结构。将脊线、沟槽、道路、平台、接触区等相交处标为“连续穿越、汇合、分隔、跨越或让位”；决定由哪个特征保持主轮廓，另一个通过遮罩抑制、改道、形成鞍部/支撑，或采用桥接等专门过渡。避免把多个高度项简单相加/取最大值后就认为空间关系成立。至少选一个代表交汇处，在最终网格上沿两条特征各取中心与侧翼剖面；断言主形/支撑没有被意外削弱，次级形变在预期范围内，再检查灰模中的连续轮廓。没有相交的设计关系时不必强加此检查。

**依附最终网格的元素要从最终网格取样。** 上游解析高度场只在它与输出网格使用相同的三角划分和插值时，才能保证道路、溪流、台阶、散布物等贴合。若最终地表经过离散网格化、形变或分块，优先从最终几何做射线命中；需要沿中心线密集取样时，可复用它的顶点、索引和同一三角形插值规则。取样中心线之外，还要检查路径两侧、物体底面和相邻块边缘；按目标关系使用命中法线、边界过渡与接触阴影。陡坡上的贴合偏移应沿支撑面法线或局部框架计算，不能默认只增加世界Y。解析场仍可作为生成输入，但不能替代最终承载面的贴合验证。

**以地形为例。** 先设计山体占位、山脊/谷地和地平线开口，再放入坡肩、沟槽和分层平台；只在经掩码选择的区域做侵蚀/崩蚀，再按坡度、高度、距离水线等派生材料和实例密度。高度场适合单值地形表面；洞穴、悬挑、垂直断面与倒扣需另用完整曲面/实体，或混合表示。整体噪声只是在已有结构上添变化，不能替代这些结构。侵蚀式迭代可借鉴HeightField的多步过程，但应先在Three.js选定的表示中做小范围函数/几何更新；不用虚构Houdini节点API，也不要求安装特定DCC。

**以岩石为例。** 先做有承载面的主轮廓，再分开控制大块面、小转折、层理/凹切和受压底部；每遍记录方向、尺度、幅度及局部权重。法线只跟随最终几何用于受光；光滑法线不能掩盖断裂表面或修复交叠。清理后确认碎片和薄片是否符合设计；不要默认删掉所有小连通部件。细节图/置换若仅提供实时近似，应与实际轮廓及边界检查分开。

**其他类型沿用同一职责法。** 建筑把墙体开口/楼层轴线作为共源约束，让窗框、窗洞侧壁和玻璃共用；枝叶按分枝骨架与冠层区域生长；机械重复件沿安装轴/孔位布局，并保留连接与限位。共同的是依赖和分层，具体几何算法仍由对象决定。

如果用DCC生成，保留源节点网/参数版本/seed/缓存帧，并明确轴向、单位、原点、材质名、UV和属性交接；导出支持不等于全部程序网络或渲染器效果都进入Three.js。先导出一个最难的代表关系，在目标Three.js版本实际加载、布光、转动并核对材质/边界，再决定批量生成。纯代码路线同样按同一代表关系确认生成器输入、实际网格和画面一致。

#### 通用：沿路径构造可变截面

中心线控制弯曲，截面控制沿程收放，坐标架控制截面方向。连续路径先包含需要的接触/离面和转向段；从同源路径/框架派生附件与反馈锚点。不同对象的截面、分枝/装配、端部和材料区域由当前目标决定，不能只用整体缩放制造形态族。

下面是可改编的收分扫掠核心：用样条表达弯曲中心线，用半径函数表达沿程变化。它假定截面近似圆形、拓扑连续、路径可平滑参数化；适用于树干/藤蔓、弯管、缆索、肢体等类似结构。若截面非圆、宽深独立变化、存在尖角或拓扑分叉，应改用截面 loft、分件连接或专用网格，而不是继续增加 TubeGeometry 分段。`sectionShape(u, angle)`返回相对半径变化，且同一`u`下的首尾角值必须相同，否则会在接缝处裂开；不需要截面细节时保持默认零函数。

```js
function buildTaperedSweep(points, radiusAt, radialSegments = 10, steps = 18, sectionShape = () => 0) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  // Frenet frames keep the cross-section orientation continuous along a curved centerline.
  const frames = curve.computeFrenetFrames(steps, false);
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const center = curve.getPointAt(u);
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    const radius = Math.max(0.001, radiusAt(u));
    // Optional cross-section variation must be periodic across angle 0..2π to close the UV seam.
    for (let j = 0; j <= radialSegments; j++) {
      const a = j / radialSegments * Math.PI * 2;
      const localRadius = radius * Math.max(0.1, 1 + sectionShape(u, a));
      const p = center.clone()
        .addScaledVector(normal, Math.cos(a) * localRadius)
        .addScaledVector(binormal, Math.sin(a) * localRadius);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radialSegments, u);
      if (i < steps && j < radialSegments) {
        const row = radialSegments + 1, k = i * row + j;
        indices.push(k, k + 1, k + row, k + 1, k + row + 1, k + row);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The UV seam needs two vertex records (u=0/1), but one smooth surface normal.
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i <= steps; i++) {
    const a = i * (radialSegments + 1), b = a + radialSegments;
    const n = new THREE.Vector3().fromBufferAttribute(normals, a)
      .add(new THREE.Vector3().fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, n.x, n.y, n.z);
    normals.setXYZ(b, n.x, n.y, n.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
```

调用时把半径函数、截面变化和分段数写进资产规格。UV首尾保留独立顶点与0/1坐标，但同一光滑表面的法线需一致；`computeVertexNormals()`不会跨重复顶点自动平均。上例只修该接缝，不把倒角、端盖或设计硬边全局平滑。此 helper 只生成侧壁；只有端面可见或截面应封闭时才添加端盖。若动画、碰撞或附件依赖路径位置，锚点应从同一条中心线和坐标架导出，避免另算一套近似位置。其他类型的重复附属结构用其真实支撑面和布局规则分布；仅在使用实例/粒子时才套用前述容量预算。

#### 程序化材质如何增加有效细节

- 用**大尺度色块**表达材质分区、光照与环境影响；用**中尺度变化**表达材料结构、构件分组或局部形态；用**小尺度变化**补粗糙度和细微色差。具体特征随资产种类更换；每种频率承担不同信息，不能用单一高频噪声覆盖所有尺度。
- CanvasTexture 使用固定种子绘制可平铺纹理；UV 密度应与世界尺寸匹配，接缝和 mipmap 在最终视口检查。颜色纹理设置 SRGBColorSpace，粗糙度、法线、遮罩等数据纹理使用数据色彩空间。
- shader 只承担材质内部细节、受光变化或连续表面运动。改变轮廓、结构连接或接触关系时改几何/锚点，不能让 shader 噪声承担本应由模型表达的形体。
- 反复贴同一纹理、同一色值或同一尺寸会暴露复制。给变化建立受控区间、权重、空间分布和种子，并在同一目标镜头确认变化形成层次而非脏噪点。

材质坐标按职责选择：随物体固定的纹样用rest/UV或局部坐标，跨物体环境场用world坐标，流体用沿程/横向flow坐标。可用`max(length(dFdx(P)), length(dFdy(P)))`估计每像素表面尺度，让高频纹样、凹凸与高光随视距退场。非均匀缩放或实例变换须使用正确法线变换；几何、照明、描线和阴影偏移法线各有职责。

#### 按最终像素而不是源码规模分配细节

以目标分辨率和目标机位检查每项细节。主轮廓要在缩略图中仍然成立；焦点对象在原尺寸下要读出承载身份的中层结构。单个细节低于约 2 像素时通常应合并到簇、顶点色或材质响应中，避免独立几何产生闪烁；约 2–6 像素的重复细节优先使用实例或有层次的簇；近景中占据更大像素的部件再承担可辨认的截面、厚度和连接。数值是起始判断，最终以目标画风、运动速度和采样结果校正。

- **近景焦点：**独立剪影、大/中形结构、可见厚度/连接、材质响应和少量可辨表面细节。
- **中景支撑：**自定义轮廓、主要结构分组、受控色差和遮挡节奏；微细结构成簇出现。
- **远景背景：**轮廓族、色带、冠层/建筑群体和大气透视；省去不会进入像素的独立小件。
- 不把同一细节密度铺到全场。细节依对象的功能区域、材质状态、运动/流向和镜头组织；焦点之外的背景区域主动降低频率。

#### 低质量信号、代码根因与预防

| 画面信号 | 常见代码/数据根因 | 编码前预防与定位 |
|---|---|---|
| 识别对象读成基础体拼贴 | 轮廓、负形或中层装配未写成几何职责 | 做目标相机剪影与结构关系图；明确每个 BufferGeometry/部件负责哪项识别特征 |
| 计划中的重复件缺失、局部突然变稀 | 批次容量/实例数小于布局计划、循环静默截断，或分块包围体/裁剪排除了可见对象 | 比较计划数、生成数和可见数；先对计划求和再分配容量，并按动态状态刷新对应bounds。`InstancedMesh`只是常见实例方案之一 |
| 轮廓有意外尖刺、缺口或未处理的端部 | 终端/边界未定义，封口、收尖、覆盖、裁切或连接缺失；覆盖只布在少数锚点 | 编码前为可见边界声明预期状态（收尖、封闭、被遮挡、连接或裸露）；按实际表面/路径检查覆盖连续性 |
| 连接处像粗桥接块、断开或互相穿插 | 子件没有按父件/承载面定位，尺寸层级突变，接合/遮挡顺序错误或阴影过重 | 先灰模核对结构层级和负形；定义连接位置、截面/厚度过渡及承载关系，近景复核接合与遮挡 |
| 材料细节不显示、方向怪或像脏噪声 | 缺UV/接缝重复，UV密度与世界尺寸不匹配，颜色/数据贴图色彩空间错 | 在材质开发前确认网格有UV；用棋盘格或单色调试材质检查方向/接缝，再贴细节图 |
| 地面/背景出现突然切边或比例塌陷 | 环境范围按物体局部设定，未覆盖目标相机视锥/运动路径 | 根据相机包围范围和运动补边计算环境尺寸，在首帧和末帧检查边界与大气融合 |
| 细节很多却脏、闪或糊成块 | 频率超过目标像素能力，实例尺度/密度与镜头速度不匹配 | 在缩略图、原尺寸、近景裁切和运动中分别检查；合并低于采样能力的细节，控制高频对比 |

#### 有证据的返修循环

迭代用于检验规格和几何假设，不用来替代前置设计。每轮按同一目标相机、尺寸、随机种子和时间点工作：

1. **记录可见差异。** 写明画面位置、目标尺度以及它与质量规格的差异，例如“主体外轮廓完整，但规格要求的中央开口比目标窄”，不写“看起来怪”。
2. **定位负责层。** 在设计/相机、主轮廓/拓扑、结构/接触、实例布局/容量、材质/UV、灯光/阴影、像素/采样中选一个根因层；用实例数、包围盒、投影边界、锚点或UV检查辅助验证。
3. **改生成规则。** 修改负责的几何生成函数、布局数据或材质参数；不要用新装饰件遮挡缺陷，也不要让随机种子改变掩盖原因。
4. **同条件复核。** 重新输出相同帧、相同尺寸的总图与局部裁切；只在预期差异出现且相关不变量仍通过时接受修改。
5. **把反复问题前移。** 同类问题再次出现时，在资产实现计划中增加对应的预算、关系字段或断言，使下一个资产在首次渲染前能发现它。

如果连续两轮改动都没有在预期区域形成可见改善，暂停加细节，回到特征规格/表示选择/相机投影，重新判断几何是否选错或空间覆盖是否漏项。


## 2. 选择最能表达形体的代码表示

| 对象/效果 | 优先考虑 | 不适合的情况 |
|---|---|---|
| 方正物件、建筑块面、机械盒体 | `BoxGeometry`、`ExtrudeGeometry`、有厚度的独立面板 | 关键曲面和轮廓不能被方盒准确表达 |
| 轴对称器物、柱体、轮胎、灯罩 | `LatheGeometry`或绕轴构造`BufferGeometry` | 非轴对称或截面方向不断变化 |
| 船体、动物长体、弯管、枝干 | 分段截面 loft、`TubeGeometry`、沿曲线扫掠 | 只用一条固定半径管无法表达腹/背、收分和宽深变化 |
| 岩石、地形、布面、水面 | 参数曲面/高度场/位移网格或顶点 shader | 洞穴、倒扣等不能由单值高度场表达时需换表示 |
| 窗、鳞片、叶、灯等大量重复件 | `InstancedMesh`加受控变化种子 | 每个实例需要独立拓扑/复杂骨骼变形 |
| 角色或可弯曲对象 | 连续网格加骨骼/脊柱、IK和必要修形 | 刚性零件拼装不能代表软组织变形 |
| 雾、火花、飞尘、水花、尾迹 | 低面数体积、shader、`Points`/实例粒子及空间锚点 | 粒子不能替代主要体积或主体几何 |
| 花纹、噪声、色带和细小表面变化 | 从确定性函数绘制`CanvasTexture`，或编写shader | 纹理无法修复错误轮廓、厚度和结构 |
| 复杂、独特、需要高形体精度的静态/角色资产 | 经过人工检查的GLB/glTF网格（可由DCC制作或AI候选经人工修整），由Three.js加载并参与最终场景渲染 | 核对来源/许可、比例/朝向、网格、UV、材质、动画和目标镜头；不合格时修模或换路线 |

混合表示很常见。表中的代码几何是可用路线，不是所有资产必须纯代码生成的限制。按目标画面选择程序化几何、经修整的模型资产或混合方式；最终场景仍由Three.js组装、布光、动画和渲染。对每个重要对象说明哪种表示负责主形、中层连接和表面信息；可见轮廓、受力/搭接和动态接触必须由实际几何或可验证的空间数据承担。

这些模式提供通用起点，不替代对象专属结构设计。连续皮肤/有机体、中层与接触锚点读[资产设计与生成](asset-craft.md)；IK、脊柱变形与状态/规模边界读[动画与场景规模](motion-and-scale.md)；自定义缓冲/后期消费者读[渲染契约](render-contracts.md)。

## 3. 技术实现的依赖与诊断顺序

下表帮助分解实现依赖和定位故障，不另设生产放行标准。先让上游数据与消费者可用，再整合下游；画面是否可扩展统一按[核心镜头标准](validation.md#核心镜头放行标准)，交付按生产流程阶段5。

| 顺序 | Three.js实现 | 本层技术检查 |
|---|---|---|
| 1. 可运行场景 | renderer、颜色空间、相机、灯光、一个代理物体 | 目标视口有画面、相机看得到代理、浏览器无错误 |
| 2. 布局和尺度 | 原点/地面/主体锚点、占幅、前中后景 | 目标构图缩略图和黑色剪影可读 |
| 3. 主体形体 | 每个重要主体的独立几何生成函数和层级 | 关键轮廓/厚度/连接在目标机位成立 |
| 4. 中层结构 | 面板、窗口、关节、枝杈、立面节奏等 | 主体不像通用基础体拼贴，局部结构能解释形体 |
| 5. 材质和灯光 | 材料分区、主辅光、阴影、环境响应 | 灰模与彩图都成立，材料靠受光可区分 |
| 6. 次级细节 | 程序化纹理、实例、微观结构 | 最终分辨率可读且没有过密/闪烁 |
| 7. 完整动画和FX整合 | `stateAt(t)`、锚点、环境响应；必要最小动作按生产阶段3前置验证 | 起/中/止和任意seek稳定，FX因果关系清楚 |
| 8. 最终渲染 | 固定源码、资产、视口、fps和输出 | 实际成片属性正确，关键帧和连续动作已审看 |

本层检查用于确认数据链可用，不能由其通过数量推定画质。发现缺陷时回到负责的几何/参数/结构；与目标板的品质差距继续按统一验收处理。

## 4. 组织资产生成代码

每个重要资产用独立函数/模块生成，参数集中、坐标局部化、随机数可复现。子对象按结构命名，返回根节点、包围盒和语义锚点，便于布局、动画、FX和接触共用。

```js
function buildAsset(spec, mats) {
  const root = new THREE.Group();
  root.name = spec.id;
  // 每个组件先在root局部坐标中建立，再用命名子组表达结构。
  const body = new THREE.Mesh(buildBodyGeometry(spec), mats.body);
  body.name = 'body';
  root.add(body);
  addStructuralParts(root, spec, mats);

  root.updateMatrixWorld(true);
  return {
    root,
    bounds: new THREE.Box3().setFromObject(root),
    anchors: {
      origin: () => root.localToWorld(new THREE.Vector3(0, 0, 0)),
      top: () => root.localToWorld(new THREE.Vector3(0, spec.height, 0)),
    },
  };
}
```

该示例展示接口，不是把所有对象都做成`body`盒子。`buildBodyGeometry`应按规格选择基本体、截面扫掠、回转或自定义网格。相机、对象、效果不要分别硬编码一套互不相干的尺寸；共享规范参数和锚点。

### 用基础体表达结构

用基础体做布局/代理，也可用于最终设计中的平面、机械件和有意的硬边风格。通过尺寸、局部位置、圆角/倒角、层级和真实连接组成设计对象；避免无差别堆盒。金属折板用实际厚度和边界，开口用形状轮廓/内外壁，不要用一块薄贴片假装孔洞或面板。

让每个部件由统一小函数创建，避免到处散落匿名数字：

```js
function addPart(parent, name, geometry, material, { position, rotation, scale } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const materials = {
  dark: new THREE.MeshStandardMaterial({ color: '#303b45', roughness: .58, metalness: .2 }),
  paint: new THREE.MeshStandardMaterial({ color: '#617c8b', roughness: .4, metalness: .12 }),
};
const root = new THREE.Group();
addPart(root, 'base', new THREE.CylinderGeometry(.7, .9, .18, 32), materials.dark,
  { position: [0, .09, 0] });
addPart(root, 'column', new THREE.CylinderGeometry(.16, .22, 1.6, 20), materials.paint,
  { position: [0, .98, 0] });
```

以上仅说明部件组织。最终比例从场景规格传入，部件的相交、端点和厚度在相机前检查；不要把通用灯具、人物、建筑等都照此组合成同一种“柱子+圆盘”造型。

闭合二维轮廓需要厚度时用`Shape`与`ExtrudeGeometry`，并为倒角/侧壁设置目标像素可读的分段；旋转件可用`LatheGeometry`：

```js
const outline = new THREE.Shape();
outline.moveTo(-.8, -.4);
outline.lineTo(.5, -.4);
outline.lineTo(.8, .25);
outline.lineTo(0, .7);
outline.lineTo(-.65, .25);
outline.closePath();
const solidProfile = new THREE.ExtrudeGeometry(outline, {
  depth: .16, steps: 1,
  bevelEnabled: true, bevelSegments: 2,
  bevelSize: .025, bevelThickness: .02,
});
```

这里的轮廓点由当前资产规格给出，示范如何把二维轮廓转为带侧壁的实体；更复杂的开孔通过`outline.holes`添加`Path`，多个结构面要有真实搭接顺序。

```js
const profile = [
  new THREE.Vector2(.18, 0), new THREE.Vector2(.3, .08),
  new THREE.Vector2(.32, .65), new THREE.Vector2(.52, .82),
  new THREE.Vector2(.54, .9), new THREE.Vector2(.08, .9),
];
const shade = new THREE.Mesh(
  new THREE.LatheGeometry(profile, 48),
  new THREE.MeshStandardMaterial({ color: '#d6bd8a', roughness: .42, metalness: .18 }),
);
```

profile里的`x`是半径、`y`是高度。截面点的顺序决定内外表面和开口；要做薄壳、内壁或顶部孔洞时，明确设计闭合剖面，不只靠增加分段。

制作回转壳体、内腔或带孔板件前，先读取[截面与厚壁方法](profile-geometry.md)：显式内外剖面、环形口沿、光滑/折边法线、真实贯穿孔、成品厚度及倒角包络。该模块可随作品复制；上述短片段仍用于理解原生API。

### 从实际承载面建立布局和接口

把组中心、形态族和人工落点放在共同布局数据中；在组内选择变体后，从实际承载面求位置。复制[表面锚点模块](../assets/scene/surface-anchors.mjs)，注入场景使用的同一THREE。以下约定资产根的局部原点为支撑点，局部+Y向上、+Z为功能前向；动画写内部子组，放置根保留布局矩阵。

```js
import {createSurfaceSampler, surfaceFrame} from './surface-anchors.mjs';

const sampleSupport = createSurfaceSampler(THREE, supportMeshes);
for (const group of layout.groups) {
  for (const placement of group.placements) {
    const hit = sampleSupport(
      new THREE.Vector3(placement.x, layout.rayTop, placement.z),
      new THREE.Vector3(0, -1, 0), {far: layout.rayDepth}
    );
    if (!hit) throw new Error(`No support for ${group.id}`);
    const asset = buildFamily(group.family, placement.variant);
    const world = surfaceFrame(THREE, hit, {
      up: new THREE.Vector3(0, 1, 0), // 重力直立；随面贴合时使用hit.normal
      forward: new THREE.Vector3(...placement.front),
      offset: placement.offset ?? 0
    });
    scene.add(asset.root);
    scene.updateWorldMatrix(true, false);
    asset.root.matrixAutoUpdate = false;
    asset.root.matrix.copy(scene.matrixWorld).invert().multiply(world);
    asset.root.updateWorldMatrix(false, true);
  }
}
```

`supportMeshes`只传实际承载对象，不包含待放置物。模块返回实际交点/几何法线、对象及instanceId，命中失败返回null；支持父级非均匀变换及实例框架。实例矩阵变更后由调用方更新相关包围体。rayTop/rayDepth按场景尺度选择，也可直接传任意世界射线。模块不负责碰撞/IK或物体整体支撑；路径/大接触面需采样边界与多个点，再用这些点构建底/侧承接或连续变形，不能把所有点简单抬到最高处。

**起伏地形上的大占地结构要验证整圈承接。** 建筑、台地、桥台或平台先明确采用顺坡铺设、水平基座加挡土构造，还是分级过渡；不要用一个中心高度放置完整平板。沿实际占地边界按最终承载网格细分采样，依据每段地面高程与法线生成连续底面、侧壁/基础、分段挡墙或地形回填；转角、入口和相邻坡面也要收口。记录整圈支撑底缘的最大悬空/嵌入、上缘与主体的搭接，再看沿坡剖面和周向视角。单点、单侧墙或数值全通过仍不代表结构与环境在画面中自然连成一体；若高差使挡墙成为主视觉，应返回总平面和地形设计，不能只加高墙体遮缺口。

`surfaceFrame`给出世界矩阵。父级有变换时乘其逆矩阵；非均匀父级可能产生局部剪切，应保留矩阵而非强拆TRS。功能前向与重力轴分别决定；静态框架的平行回退不替代曲线的连续传输坐标架。接触/反馈从最终变形后的锚点取得，见[动画与规模](motion-and-scale.md)。

### 局部前向与内容锚点

有开口、展示内容或操作面的资产，在自己的局部坐标声明面向使用者的法线`frontLocal`和该面上的`anchorLocal`；网格与两者共用父级变换。布局时朝向使用区，实际取景时再核对内容可见性。下面只返回相机在哪一侧；`THREE`由当前工程导入：

```js
function facingSide(asset, frontLocal, anchorLocal, camera) {
  asset.updateWorldMatrix(true, false);
  if (asset.matrixWorld.determinant() === 0) throw Error('singular asset transform');
  const normal = frontLocal.clone().applyMatrix3(
    new THREE.Matrix3().getNormalMatrix(asset.matrixWorld)
  ).normalize();
  const anchor = asset.localToWorld(anchorLocal.clone());
  const towardCamera = camera.getWorldPosition(new THREE.Vector3()).sub(anchor);
  if (towardCamera.lengthSq() === 0) return null;
  return normal.dot(towardCamera.normalize()); // 正：前侧；负：背侧；接近0：掠视。
}
```

`frontLocal`为非零法线，相机与锚点重合返回`null`；正值不保证内容在画内或未被遮挡。用[锚点投影](composition-and-form.md#把世界锚点投影到目标视口)判断取景；有必要时用第一遮挡射线定位自身背板、外壳和场景遮挡，再审实际画面。实例/骨骼/shader形变使用最终实例/变形锚点；中心射线不等于整面可见率。此片段适用可逆仿射Object3D变换，法线按[逆转置矩阵](https://threejs.org/docs/pages/Matrix3.html#method:getNormalMatrix)变换，不能只把局部向量当世界方向。

### 用截面生成连续曲面

船体、果实、头部、岩层、枝干等通常需要沿主轴定义多个截面。每个截面包含中心、宽度和上下/左右轮廓；沿轴插值截面，再绕截面采样生成顶点、UV和三角面，端部加封盖，最后求/校正法线。

可把“二维参数坐标(u,v)映射到三维点”的过程封装成通用网格函数。它用于地表、截面扫掠、壳体、连续有机体或程序化平面；轮廓规则由具体资产函数传入：

```js
function buildGridGeometry({ rows, columns, pointAt, reverseWinding = false }) {
  if (!Number.isInteger(rows) || rows < 1) throw new Error('rows must be >= 1');
  if (!Number.isInteger(columns) || columns < 1) throw new Error('columns must be >= 1');
  const positions = [], uvs = [], indices = [];

  for (let j = 0; j <= rows; j++) {
    const u = j / rows;
    for (let i = 0; i <= columns; i++) {
      const v = i / columns;
      const p = pointAt(u, v); // 必须返回 THREE.Vector3
      if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error(`non-finite vertex at ${u}, ${v}`);
      positions.push(p.x, p.y, p.z);
      uvs.push(v, u);
    }
  }

  const stride = columns + 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const a = j * stride + i, b = a + stride;
    const c = a + 1, d = b + 1;
    if (reverseWinding) indices.push(a, c, b, b, c, d);
    else indices.push(a, b, c, b, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
```

以下以Y方向为轴，演示**关键截面→实际顶点**。`u`为沿程参数，`halfWidth/halfDepth`为半尺寸；中心、宽、深与截面扭角分别可改。数值仅演示控制关系，按当前目标重设：

```js
const sections = [
  {u: 0,    y: -1.5, x: 0,    z: 0,   halfWidth: .28, halfDepth: .22, twist: 0},
  {u: .25,  y: -.65, x: -.10, z: 0,   halfWidth: .72, halfDepth: .43, twist: 0},
  {u: .50,  y: 0,    x: 0,    z: .10, halfWidth: .48, halfDepth: .62, twist: .12},
  {u: .75,  y: .65,  x: .12,  z: 0,   halfWidth: .81, halfDepth: .35, twist: .08},
  {u: 1,    y: 1.5,  x: 0,    z: 0,   halfWidth: .23, halfDepth: .18, twist: 0},
];
function sectionAt(u) {
  // 有效规格：u严格递增，首尾0/1，半尺寸为正；网格须采到关键层位。
  const k = Math.max(1, sections.findIndex(s => s.u >= u));
  const a = sections[k - 1], b = sections[k];
  const t = (u - a.u) / (b.u - a.u);
  const s = {};
  for (const key of ['x', 'y', 'z', 'halfWidth', 'halfDepth', 'twist']) {
    s[key] = THREE.MathUtils.lerp(a[key], b[key], t);
  }
  return s;
}
const geometry = buildGridGeometry({
  rows: 40, columns: 32, // 本例关键u均被采到；任意层位须显式纳入采样行。
  pointAt: (u, v) => {
    const s = sectionAt(u), angle = 2 * Math.PI * v;
    const x = Math.cos(angle) * s.halfWidth, z = Math.sin(angle) * s.halfDepth;
    const c = Math.cos(s.twist), n = Math.sin(s.twist);
    return new THREE.Vector3(s.x + c*x + n*z, s.y, s.z - n*x + c*z);
  },
});
const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
  color: '#789078', roughness: .78, metalness: .02,
}));
```

先改一个层位的宽/深/偏心，确认该处与相邻过渡确实改变，其他控制点保留。上例用分段线性插值，转折处可见曲率变化；需要连续圆滑时设计切向/Hermite或增加有意截面，并检查插值过冲及净空。沿弯曲路径改用路径框架，分枝/洞口另设计拓扑；这个简单loft不是任意结构的成品生成器。

`pointAt`决定实际形状：换控制截面即可改变腹背、肩部、端部和偏心。上例是开口表面模板，不包含端盖；正式封闭资产需要生成端盖或连接独立几何。闭合截面在`v=0`和`v=1`位置重复顶点以获得UV接缝，因此普通`computeVertexNormals()`可能在接缝处出现法线断层；要平滑闭合时需焊接位置相同顶点后计算/复制法线，或手工对接缝两侧平均法线。检查`reverseWinding`是否符合外向法线，必要时在调试材质中开启`THREE.DoubleSide`定位方向，但交付时应修正绕序。

网格生成后依次核对：顶点与索引均有限、三角形没有零面积、包围盒尺寸与规格相符、正反面与法线方向正确、截面接缝和端盖闭合、UV连续、目标相机下厚度可读。不要把轮廓失真归咎于缺少细分。

轴对称对象可用`LatheGeometry(profilePoints, segments)`：每个`Vector2(x,y)`是半径与高度。需要不同内外壁时单独设计闭合截面。弯曲但截面固定的物件可沿样条构造框架并扫掠截面；沿线变化宽度/旋转时显式插值，不能只拉伸一根直管。

### 用实例与确定性规则建重复场景

重复对象先定义结构家族，再从参数区间生成位置、尺度、旋转和材料差异。用固定种子产生稳定变化，并保留需要的空间映射。大量同拓扑且变换相对简单的对象可用`InstancedMesh`。拓扑、变形、独立剔除或频繁变更需求若与单一批次冲突，比较分组网格、`InstancedBufferGeometry`、合并网格或槽位复用；动态增删本身不自动排除实例化，需按目标更新频率和CPU/GPU成本选择。

```js
const inst = new THREE.InstancedMesh(geometry, material, count);
const dummy = new THREE.Object3D();
for (let i = 0; i < count; i++) {
  const p = layoutAt(i, seed); // 可重复、受约束的空间规则
  dummy.position.set(p.x, p.y, p.z);
  dummy.rotation.set(p.rx, p.ry, p.rz);
  dummy.scale.set(p.sx, p.sy, p.sz);
  dummy.updateMatrix();
  inst.setMatrixAt(i, dummy.matrix);
}
inst.instanceMatrix.needsUpdate = true;
// 若实例布局改变后要做视锥裁剪或拾取，按当前版本的接口刷新实例包围体。
inst.computeBoundingBox();
inst.computeBoundingSphere();
```

变化范围须服从构造和布局，不使用随机数掩盖相同剪影/间距。查看实例群整体轮廓、近景实例质量、相互遮挡和阴影；数量多不等于复杂度合理。

### 共享语义场：让形体、布置与材质共用规则

当多个对象受同一地形、流向、磨损或生长规律影响时，先定义纯函数式的场采样接口，再由不同生成器读取它。不要让地形、植被、材料边界和水岸各自生成互不相关的噪声。

先列出当前题材真正需要的字段及其消费者。地形可用高度、法线/坡度、曲率、距水线、流向与地貌区权重；建筑场地可用承载面、朝向、日照和功能区。字段应保留共同坐标、单位、固定 seed 与明确语义；只保留会被几何、实例、材质或环境效果实际读取的字段。

按形成尺度构造：先确定宏观轮廓和主方向，再生成顺应主方向的中层脊、沟、台阶、分枝、支撑与边界，最后添加低幅表面细节。mask/权重限制每种变化出现的位置与强度；侵蚀、沉积或磨损等过程可使用不同尺度和作用区的连续 pass。高品质地形依赖有方向的断面与连接，不能用全表面白噪声代替。

散布先从布局/曲线候选点取样，再用密度权重、坡度/承载条件和排除区筛选；随后读取实际支撑面及法线，确定方向、家族变体和尺度。固定 seed 保持复现，显著的主礁、树、路径转折等仍可手工落点。相同区域字段可同时驱动几何过渡、颜色/粗糙度分区及浪沫/植被/雾等反馈，但每个消费者都要按其物理或设计含义解释该字段。

**先验证布局可行性，再锁定每组数量。** 以实际候选点和最终场数据运行一次轻量预演，记录每个设计组的候选数、通过全部掩码/坡度/承载/净距条件后的可用数、各拒绝原因计数及目标数；画出同一坐标范围内的资格区、排除区、候选点和已落位点。逐组判断目标数量、疏密和边界是否可实现。若目标未达到，先分辨是布局足迹放错、可用区域估计错误、间距/密度与目标冲突，还是组内确实应更稀；再调整分组范围、分布策略或设计目标并重新预演。道路净空、承载、视线等硬约束只能依据设计重新评审后修改，不能为凑总数而静默放宽；全场总数通过也不能掩盖单组空缺。最终生成后，用相同字段和约束复查实际落位，再从目标相机检查组团轮廓、空隙与遮挡。

```js
const sample = siteField.sample(x, z); // 固定世界/局部坐标约定，返回同一套语义字段
geometryPosition.y = sample.height;   // 主形和中层几何读取高度/断面规则
if (sample.scatterDensity > 0 && sample.slope <= slopeLimit) {
  placeOnSupport(point, sample.normal, chooseFamily(seed, pointId));
}
material.roughness = roughnessFor(sample.regionWeights, sample.wetness);
```

这是数据流示意：`siteField`、`placeOnSupport` 和 `chooseFamily` 必须由当前场景实现，字段与材质映射也要依题材定义；不要直接复制这些示例名当作 Three.js API。开发时可把单一字段临时映射为颜色、画出采样点/区域边界，检查几何、摆放和材质是否在同一位置同步变化。再恢复最终材光与完整相机复核；字段图通过不能代替成片审图。

对地表、海岸、河谷等由平面场驱动的连续形体，除点采样外，必须把**整张平面场**按同一坐标范围做俯视诊断图，并叠加轮廓、主脊/沟线、路径、区界和关键对象锚点；从实际生成网格取至少两条穿过关键地形变化的横断面，查看高度与坡度是否形成预期的缓滩、陡崖、鞍部、凹口或承接。单点符号正确、中心线距离为零或消费者读到了字段，只能证明局部数据链；不能证明凹湾开口、崖段范围、地貌分区和场景整体轮廓在空间上成立。二维分区/断面通过后，再回到目标斜视与完整相机环检查实际几何和景别。

#### 将可设计的轮廓/路径变成可调空间场

当场景有明确的地块边界、山脊/沟槽、道路、磨损带或生长轴时，先用少量引导点定义这些特征，再从点集派生连续距离场。把设计输入和表面残余变化分开：轮廓与主轴决定形体，受限区域决定哪里能改变，低幅噪声只打破过度平滑。没有明确引导特征的对象不必硬套这套做法。

```js
function distanceToSegment(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

function polylineDistance(x, z, points, closed = false) {
  let d = Infinity;
  const edgeCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    d = Math.min(d, distanceToSegment(x, z, points[i], points[(i + 1) % points.length]));
  }
  return d;
}

// Positive values are inside the polygon; negative values are outside.
function signedPolygonDistance(x, z, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j], b = outline[i];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  const edgeDistance = polylineDistance(x, z, outline, true);
  return inside ? edgeDistance : -edgeDistance;
}

const coast = [[-18,-9],[-21,-3],[-20,5],[-16,13],[-9,17],[-1,18],[7,16],[13,12],[18,6],[20,0],[18,-7],[13,-13],[6,-17],[-2,-19],[-10,-16],[-15,-12]];
const crest = [[-14,5],[-10,1],[-7,-1],[-3,-3],[1,-4],[6,-3],[10,-1],[14,2]];
const channel = [[-17,10],[-13,7],[-10,5],[-6,2],[-2,1],[2,4],[8,7],[14,10],[20,11]];
const smooth01 = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const field = (x, z) => {
  const shoreDistance = signedPolygonDistance(x, z, coast);
  const crestDistance = polylineDistance(x, z, crest);
  const channelDistance = polylineDistance(x, z, channel);
  const land = smooth01(-1.2, .65, shoreDistance);
  const ridge = 1 - smooth01(1.4, 5.8, crestDistance);
  const channelMask = 1 - smooth01(1.2, 4.7, channelDistance);
  const height = -4 + land * (4.9 + ridge * 3.8) - channelMask * 2.8;
  return { height, shoreDistance, crestDistance, channelDistance, land, ridge, channelMask };
};
```

Point lists above only demonstrate the representation; derive their shape and scale from the current composition, not from the sample coordinates. The closed outline must be an ordered, simple XZ polygon without duplicate adjacent points; define additional loops for holes. Add path, strata, basin or vegetation guides only when the scene calls for them. Keep each field's meaning and units explicit; do not reuse a variable named `mask` for unrelated regions. Build final terrain vertices from the field, then derive slope from its height or from the final mesh. Place paths and instances by sampling the final mesh so the guides do not drift from the rendered surface.

Before scattering or adding material detail, expose one field at a time as false color and draw its source guide/zero contour. Sample known points on both sides of every boundary and at the guide centerline; assert expected inside/outside, high/low and exclusion results. Inspect the resulting **main-form mesh** in gray material from the target camera and a side view. If the visible ridge, channel or plateau does not match its guide, fix the guide, signed-distance convention, falloff or geometry sampling before adding noise and assets. Passing field values alone is not visual acceptance.

**确认引导线真的驱动了几何。** 逐条追踪“设计引导 → 距离/遮罩/控制场 → 最终顶点或实体构造 → 渲染网格”；仅绘制在诊断叠层、写进审计数据或用于摆放对象的线，不会自动塑造地表。检查代码引用和字段消费者时，要确认控制场实际进入最终几何高度/位置公式。对每条主脊、沟槽、岸线或建筑控制线，在中心线和两侧固定样点比较最终网格高度/宽度/轮廓，断言变化方向和最低幅度符合设计；然后隐藏叠线看灰模。数值探针通过但完整网格没有可见形体响应时仍判失败，回到引导线与几何生成的连接处，不用材质、阴影或散布掩盖断链。

**曲线贴附要在细分后采样。** 先在平面定义道路、河道、岸线或铺装中心线，再把路径细分到最终几何采样密度；不要只给稀疏控制点取地形高度后，在三维曲线上插值Y值，因为中间曲段可能穿地、悬空或越过邻接台地。每个最终横截面按对象角色取高程：道路两侧贴合承载网格并处理坡度过渡；水面使用连续水位/河床中心线高程，检查边缘与河床、岸坡的相交；桥面等跨越物明确端点和净空。逐顶点比较生成曲线与最终承载面的距离，沿全线采样最高/最低偏差；路径进入平台、建筑占地或其他不同高程区时，先明确谁是空间主导并重做路线/交界，再做材质。中心控制点吻合不等于整条曲线贴合。

**通行路径的纵坡与台阶要由路线功能决定。** 对人行或车行路径，沿最终路径计算高程剖面、纵坡和横坡，并记录项目采用的可接受范围；两端接上但中间坡度突变或过陡，仍判不通过。可用平缓坡道时，按实际水平长度构造并核对两端搭接；空间不够时改成折返/平台或有真实踏面、踢面与落地平台的阶梯，不要把总高差压进短段后仅线性插值Y值。踏步的级高、踏宽、路径宽度、转角和上下端高程应共用同一条路线数据，并在侧视剖面与行进方向视角检查连续性；非通行的装饰路径则按其设计语义定义并验证。

路径涉及角色、车辆或装置通过时，先按[功能路径与实际通行体积](spatial-blockout.md#design-physical-routes-from-their-occupants)选择路面、中心轨迹与扫掠体的表示，再生成网格。引导线粗细不能代替通行净空；多个路径的端点相同也不能代替平台上的接口布局。

## 5. 编写材质、灯光与环境效果

先使用Three.js标准材质建立基础响应，再按实际缺口自定义shader。颜色、几何高度、法线、粗糙度、自发光和轮廓线是不同控制项，分别由可见证据决定。检查颜色空间、tone mapping和输出空间；不要把参考图上烘焙好的光照误当成模型表面颜色。

先建立少量材料类型，再让不同物体共享经过确认的材料，而不是每个对象临时造一套互相冲突的参数。`color`主要负责底色；`metalness`和`roughness`控制反射响应；`emissive`只表示自身发光，不应拿来补主光不足。

```js
const materials = {
  paintedMetal: new THREE.MeshStandardMaterial({
    color: '#476276', metalness: .28, roughness: .38,
  }),
  rubber: new THREE.MeshStandardMaterial({
    color: '#20252a', metalness: 0, roughness: .86,
  }),
  warmLamp: new THREE.MeshStandardMaterial({
    color: '#ffd28a', emissive: '#ff9c42', emissiveIntensity: 1.4,
    metalness: 0, roughness: .3,
  }),
};

const fill = new THREE.HemisphereLight('#b8c9e7', '#29313a', .8);
const key = new THREE.DirectionalLight('#ffe0b4', 2.0);
key.position.set(-5, 8, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
scene.add(fill, key);
```

灯光量要结合曝光与tone mapping校准。主光用来揭示形体转折，填充光保持暗部层次；避免把所有材质加亮到自发光效果。阴影发脏/漂浮时检查shadow camera范围、bias、接收面和法线，不要统一把阴影调黑。

先按[响应数据链](rendering-choices.md#从目标响应接到实际消费者)选择实际消费者与渲染状态；程序化表面再定形成规律、材料坐标、实际尺度和目标像素，分别编码颜色、高度/法线与粗糙度。需要数据场、方向纹理、磨损分区或排查规则波纹时，先读取[表面细节方法](surface-detail.md)：用物理尺度高度求法线，以独立粗糙度场控制反射；可复制对应数据图模块。颜色图可用确定性的Canvas绘制并标sRGB，数据图不做颜色解码。两者都应随所属表面保持坐标关系。

该方法不替代轮廓、凹陷、厚度或宏观褶皱；先用低频材料和实际光区校准，再分配中/微尺度。表面频率与对比超过目标像素时先合并/带限，别让均匀条纹或高频噪声成为默认细节。

环境效果按其物理/美术角色选择代码：

| 效果 | 建议编码路线 | 必须与之共享的数据 |
|---|---|---|
| 连续水面/布/地表 | 网格位移或顶点shader；法线和颜色跟随同一波场/高度函数 | 世界坐标、频率/振幅、主光、相机视距 |
| 反射/高光/涟漪 | shader或可复现的投影带；随表面变形与视角衰减 | 水面坐标、发光物体位置、时间 |
| 烟雾/雾带 | 体积层、透明网格或shader；设置密度、边缘和深度顺序 | 风向、源点、寿命、相机/深度 |
| 火花/水花/碎屑 | 有初始位置、速度、寿命、尺寸的粒子/实例 | 事件时间、世界空间发射锚点、重建状态 |
| glow/泛光/描边 | 明确输入纹理/深度/法线与后处理输出 | 渲染分辨率、曝光、采样及最终合成 |

材质与光照的代码仍须在目标画面中验证。对水等动态材质先以静帧看形体和反射，再看动画中波纹的时间稳定性；shader能运行不表示效果正确。

### 按变形区域分配控制网格

先在需要凹陷、鼓起、折转的区域布置顶点，再施加位移。总面数与细分参数不说明顶点位于哪里；有些圆角生成器将新增采样集中在倒角，大平面中央仍跨很长的三角形。先看局部线框和相邻顶点间距，使最窄的目标起伏跨过多个样本；中央不足时改用覆盖整面的网格/曲面控制域，而不是继续提高边缘细分。

以下只生成局部XY参数域上的单值曲面，`heightAt(x,y)`返回局部Z、与width/height同单位，适用于可以由一个高度描述的局部面：

```js
function deformPatch(THREE, {width, height, cols, rows, heightAt}) {
  const geometry = new THREE.PlaneGeometry(width, height, cols, rows);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, heightAt(p.getX(i), p.getY(i)));
  }
  p.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
```

调用方按起伏宽度、曲率和目标像素选择cols/rows；用连续的鼓起、受力凹陷与转折控制形体，材料只补更小的表面响应。此例是开口面：需要实体时生成背面与连续侧边，共用边界；折叠、倒扣或多值关系改用控制网格、截面/体积或DCC。CPU改顶点后更新法线及包围体；shader位移还要同步其光照/阴影表示。相同机位比较起伏深度输入改变前后，确认对应区域的顶点与受光真正变化。

### 表面位移与受光法线

岩石等表面可用三维场构造几何，再通过高度场的切向梯度扰动照明法线；以下是机制示意，不是所有材质的默认方案：

```glsl
float h = heightField(P);
vec3 g = vec3(heightField(P+vec3(e,0,0))-h,
              heightField(P+vec3(0,e,0))-h,
              heightField(P+vec3(0,0,e))-h) / e;
g -= N * dot(g, N);
vec3 shadedNormal = normalize(N - strength*g);
```

它是一种可迁移方法，不是所有材料的默认shader。高度场的方向、频率、强度要对应材料形成方式，微细层随像素尺度退场。金属更依赖有设计的折面、硬反射带、边缘与表面分区；皮肤也不能套用岩石凿刻。

几何法线、光照法线和描线法线可以有不同职责。阴影的接收点偏移与斜率bias通常使用几何法线；直接用强凹凸法线偏移可能将采样点推入真实表面，造成条纹或自阴影错误。把高频凹凸直接写入用于墨线的缓冲，可能将整面材质变成碎黑线。先确认哪种尺度应影响轮廓、受光与墨线。


### shader的实现顺序

先把效果拆成CPU侧参数、顶点阶段和片元阶段三部分：

1. 定义uniform及单位，例如`uTime`用秒、`uAmplitude`用世界单位、`uColor`用线性颜色。
2. 顶点shader只处理确实要影响轮廓/法线的几何位移；算出位移后的空间位置，并更新局部法线。
3. 片元shader按坐标/法线/视角算底色、粗糙亮度、透明度或光带。把高频纹理限制在材质内部，不让它无差别污染整个轮廓。
4. CPU每次从绝对`t`完整写入uniform；再采样起始/中段/结束和目标机位，不依赖帧间累计。
5. 明确shader读取的每个属性/纹理以及它进入最终`gl_FragColor`/输出节点的路径；未被消费者读取的数据没有视觉作用。

下面是代码生成的波面示例，演示顶点形变和时间控制；它是简化风格化表面，不是物理反射模拟：

```js
const waterMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    uniform float uTime;
    varying vec2 vUv;
    varying float vWave;
    void main() {
      vUv = uv;
      vec3 p = position;
      float w1 = sin(p.x * 1.25 + uTime * 1.1) * 0.055;
      float w2 = sin(p.y * 0.82 - uTime * 0.72 + p.x * 0.23) * 0.035;
      vWave = w1 + w2;
      p.z += vWave;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vUv;
    varying float vWave;
    void main() {
      vec3 deep = vec3(0.018, 0.055, 0.12);
      vec3 shallow = vec3(0.055, 0.18, 0.28);
      vec3 color = mix(deep, shallow, clamp(vUv.y, 0.0, 1.0));
      float ripple = sin(vUv.x * 105.0 + vUv.y * 37.0 + uTime * 1.5 + vWave * 9.0);
      float glint = smoothstep(0.91, 0.99, ripple) * smoothstep(0.25, 0.8, vUv.y);
      color += vec3(0.52, 0.33, 0.16) * glint;
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(24, 18, 160, 120), waterMaterial);
water.rotation.x = -Math.PI / 2; // 本地XY平面转为XZ水面，local z位移转成world y
water.position.y = 0;
scene.add(water);

function setWaterTime(t) {
  waterMaterial.uniforms.uTime.value = t; // 从绝对时间写入，支持任意seek
}
```

如果波浪要有可见高光方向，应由位移函数推导法线或用`normal`/`derivative`计算；只改顶点高度却使用始终朝上的法线，侧光下不会得到正确波面响应。`ShaderMaterial`还要检查材质正反面、透明顺序、颜色空间、设备精度和目标GPU；编译通过只证明语法/链接成功。

### shader数值稳定性：按真实输入范围设计

写公式前估算单位与极值：世界尺度、频率×深度、最远视距、时间跨度和零长度向量。检查除零、负底数非整数`pow`、负数`sqrt`、`normalize(0)`与指数溢出。按数学定义处理退化和饱和，不把任意clamp当通用修复；`highp`和编译成功都不保证所有后端的中间结果有限。

例如正域大输入的双曲函数可用负指数形式避免构造很大的正指数；小输入另检查相消误差，负域另定义对称扩展。选择稳定式时验证原式的单位、定义域和可接受误差。不要将一个场景的限制值复制成所有shader的阈值。

出现无报错的黑面/花屏时，先固定机位、时间、几何和灯光，逐层输出参数/中间值；必要时用目标后端的1像素浮点render target读回极值，并用`isnan/isinf`标志交叉检查。记录实际backend和precision；CPU数组有限或JS计算正确不能代替GPU执行。修复后回到原完整材质确认画面，保留原问题帧。离线完成等待与颜色累积见[渲染选择](rendering-choices.md)。

### 粒子/碎屑要有起点、速度和寿命

少量独立物体用Mesh，数量较大且外形简单的粒子用`Points`或`InstancedMesh`。运动状态从绝对时间计算：先用固定索引生成起点/速度/相位，再按`t`算粒子年龄、位置和透明度。下面示例用确定性初值和CPU更新顶点，适合数百到数千个轻量点；更多粒子再考虑GPU模拟。

```js
const count = 180, life = 2.4;
const position = new Float32Array(count * 3);
const opacity = new Float32Array(count);
const origin = [], velocity = [], phase = [];
for (let i = 0; i < count; i++) {
  const s = Math.sin(i * 127.1 + 9.2) * 43758.5453;
  const fract = s - Math.floor(s);
  const angle = i * 2.399963;
  origin.push(new THREE.Vector3(0, 0, 0)); // 可替换为事件锚点
  velocity.push(new THREE.Vector3(Math.cos(angle) * (.2 + fract), .6 + fract * 1.5, Math.sin(angle) * (.2 + fract)));
  phase.push(fract * life);
}
const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
particleGeometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacity, 1).setUsage(THREE.DynamicDrawUsage));
const particleMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  vertexShader: `attribute float aOpacity; varying float vOpacity;
    void main(){ vOpacity=aOpacity; gl_PointSize=3.0;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying float vOpacity;
    void main(){ vec2 p=gl_PointCoord-0.5; float edge=1.0-smoothstep(0.16,0.25,length(p));
      gl_FragColor=vec4(0.72,0.86,1.0,edge*vOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment> }`,
});
const particles = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particles);

function updateParticles(t, eventOrigin) {
  for (let i = 0; i < count; i++) {
    const age = (t + phase[i]) % life;
    const u = age / life;
    const p = origin[i].copy(eventOrigin);
    position[i * 3] = p.x + velocity[i].x * age;
    position[i * 3 + 1] = p.y + velocity[i].y * age - 0.5 * 0.7 * age * age;
    position[i * 3 + 2] = p.z + velocity[i].z * age;
    opacity[i] = Math.sin(Math.PI * u) * (1 - u * .25);
  }
  particleGeometry.attributes.position.needsUpdate = true;
  particleGeometry.attributes.aOpacity.needsUpdate = true;
}
```

每次调用都覆盖所有点，故正向播放、倒序抽帧和随机seek得到同一状态。示例用循环相位让粒子持续出现；单次爆发时还要增加发射时间范围/关闭循环，超过寿命后透明度归零。若粒子要碰撞、受风或改变方向，补充可重建的时间步进，不能只用上一帧位置累加。

## 6. 用同一时钟实现动画

定义完整的绝对时间状态，供实时预览和离线逐帧渲染共用。每次调用都覆盖所有动画属性，不依赖上一次渲染状态：

```js
const duration = 8;
const start = new THREE.Vector3(-3, 0, 0);
const end = new THREE.Vector3(3, 0, 0);
const root = new THREE.Group();
scene.add(root);
const effectMaterial = new THREE.MeshBasicMaterial({ color: '#e9bd82', transparent: true });
const effect = new THREE.Mesh(new THREE.SphereGeometry(.2, 12, 8), effectMaterial);
root.add(effect);
const lookAt = new THREE.Vector3(0, 1, 0);

function smooth01(x) {
  const u = THREE.MathUtils.clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
}
function envelopeAt(t) {
  return smooth01(t / .6) * (1 - smooth01((t - 6.8) / 1.2));
}
function cameraStateAt(t) {
  return new THREE.Vector3(0, 3.5 + .12 * Math.sin(t * .4), 11);
}

function stateAt(t) {
  const u = THREE.MathUtils.clamp(t / duration, 0, 1);
  const move = smooth01(u);
  return {
    rootPosition: start.clone().lerp(end, move),
    bob: .08 * Math.sin(2 * Math.PI * .8 * t),
    effectOpacity: envelopeAt(t),
    cameraPosition: cameraStateAt(t),
  };
}

function renderAt(t) {
  const s = stateAt(t);
  root.position.copy(s.rootPosition);
  root.position.y += s.bob;
  effect.material.opacity = s.effectOpacity;
  camera.position.copy(s.cameraPosition);
  camera.lookAt(lookAt);
  renderer.render(scene, camera);
}
```

当动画、特效、阴影/反射或字幕需要跨模块跟随同一位置时，为相关对象提供共用语义锚点，并说明坐标空间与更新顺序；不参与这些关系的静态对象不必添加空锚点。接触和环境反馈从最终变形后的表面/锚点求值。累积粒子/物理若不能任意seek，必须用确定性初始化+时间步进/快照重建，不能只接上`t`就假定状态成立。

## 7. 按逐级证据迭代，而不是只检查代码能运行

| 检查 | 方法 | 暴露的问题 |
|---|---|---|
| 构图/代理模型 | 目标分辨率渲染，少量主形，正侧/目标机位 | 占幅、遮挡、空间关系、视线重心 |
| 剪影/灰模 | 关纹理、关特效和颜色干扰 | 身份、主形比例、连接、厚度和支撑 |
| Lookdev | 最终材质、主辅光、环境与阴影 | 材料差异、受光方向、深度层级 |
| 最终原尺寸 | 在实际输出分辨率看关键资产/区域 | 像素过密、空面、锯齿、材质噪声和细节退场 |
| 关键时间和连续片段 | 起/中/止，重要事件前中后，随机seek | 穿插、漂移、接触、闪烁、重复模式和时间不一致 |

遇到常见故障时先检查对应数据链：

| 现象 | 先查 | 修复方向 |
|---|---|---|
| 画面全空/模型不见 | `renderer.render`入口、scene/camera、near/far、对象可见性、包围盒、相机朝向 | 先用彩色`BoxGeometry`确认相机和曝光，再逐个恢复复杂对象 |
| 网格黑面/只看到内侧 | 索引绕序、法线、材质`side`、负缩放是否翻面 | 修网格法线/绕序；`DoubleSide`只作为排错或确有薄片双面需求 |
| 曲面像硬折纸或有黑斑 | 顶点法线、重复顶点接缝、退化面、非均匀缩放及扫掠/形变的局部翻入 | 分开检查收影与显示侧；按独立局部参考检查实际面，再修表示、拓扑/平滑边组或法线矩阵 |
| 材料都像同一种塑料 | 金属/粗糙度、环境反射、主光面积/方向、色彩空间和tone mapping | 让每个材料有明确的反射/高光/透光差异，并在中性校准物上调光 |
| 细节消失或闪烁 | 屏幕像素尺寸、几何分段、mipmap、透明深度和相机距离 | 控制频率、加LOD/抗锯齿、调整透明排序或移除不可见的高频噪声 |
| 粒子/反射在seek后跳变 | `Math.random()`、累计delta、独立RAF、上一帧残留状态 | 固定seed，按绝对t重算，或增加可重建的物理步进/快照 |
| 水面有形变但无光感 | 顶点法线是否同步更新、坐标空间、材质/色彩输出 | 由同一波场求法线；再核对视角/主光与高光消费者 |

调试shader时先输出单一uniform/颜色/UV/法线为灰度或纯色，逐个确认输入，再恢复完整着色；不要同时改光照、曝光、法线和噪声。

每轮只修当前最影响焦点的一层：规格/构图→几何/结构→动画/锚点→材质/光照→FX/渲染。静帧漂亮不能证明动画通过；浏览器无错误或有非空Geometry也不能证明造型通过。每个关键结果必须来自当前Three.js代码和当前交付渲染，不能拿参考图或上一次旧渲染代替。

## 实现完整性检查

- 生产代码能说明主要画面对象由哪些Three.js几何/实例/材质/着色器生成。
- 图像生成参考没有被加载到最终场景；按获准例外使用的图片资源逐一记录。
- 重要资产在目标机位的轮廓、适用的厚度/层次、颜色/受光均有可见验证；需要动画、接触或FX连接时再验证相应锚点与更新顺序。
- 可复现的代码和依赖随源码工程交付；离线HTML/MP4来自同一版本的Three.js场景。
- 交付说明讲清是全3D还是代码化2.5D，列出生成代码、非代码资产和未覆盖检查。

上述检查确认实现链与交付资源齐备；视觉品质还须按[统一验收](validation.md)对照项目选定的视觉目标板判断，不能把完整性检查的通过数量换算为画质。
