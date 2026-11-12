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
| 任意对应截面沿程变化 | [profile-loft](../assets/geometry/profile-loft.mjs)；[连续形体](continuous-surfaces.md) | 网格、凹轮廓cap与真实三角查询；输入环明确对应，不证明全局无自交 |
| 非轴对称单patch双层壳 | [bezier-shell](../assets/geometry/bezier-shell.mjs)；同上 | 控制网→内外壁/四封边/材料组/实际查询；不是任意多patch布尔或制造等厚证明 |
| 融合体/负形的网格 | [implicit-surface](../assets/geometry/implicit-surface.mjs)；同上 | 同版MC、负内正外场、采样/容量/退化检查；场可非SDF，有限采样不保证所有薄特征 |
| 无叠面道路与分层区域 | [world-layout](../assets/scene/world-layout.mjs)；[空间生成](world-layout.md) | 并集/孔、完整足迹、显式层间连接；不自动设计城市、房间或导航 |
| PBR与分段受光材料 | [look-palette](../assets/materials/look-palette.mjs)；[材光接力](look-development.md) | 程序材料/Toon梯度、独立基色、缓存/归属；复杂透明/体积/GI另选方案 |
| 同源直射灯与影区 | [lighting-rig](../assets/rendering/lighting-rig.mjs)；同上 | 方向/Box3派生主辅光/target/阴影；反射环境另接原[天空/PMREM](../assets/rendering/scene-environment.mjs) |
| 近远与观察任务 | [projected-detail](../assets/runtime/projected-detail.mjs)、[observation-view](../assets/scene/observation-view.mjs) | 投影尺度/迟滞、真实样点的候选机位排序；不是完整HLOD或自动构图评分 |
| 用途进入真实结构程序 | [区域程序](region-programs.md)；[工厂](../assets/examples/region-programs.mjs) | 展陈/作业/围合的不同开口、屋盖、内部和配套；是建筑构造方法，不是所有题材的默认三分法 |
| 地表与保留场地连续接力 | [constrained-height-field](../assets/environment/constrained-height-field.mjs) | 矩形保留面、平滑过渡及解析导数；网格/法线/落点共用，悬挑/洞穴另选表示 |

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
  bindings.forEach((b,i)=>{
    b.object.material=candidate[i].length===1?candidate[i][0]:candidate[i];
    if(b.object.geometry!==geometry[i]) throw Error('Look change rebuilt geometry');
  });
}
```

完整renderer、PMREM、灯、相机/交互与释放见[main.mjs](../assets/examples/core-lab/main.mjs)。直接输出只做一次颜色/色调转换；使用Composer时按其OutputPass契约接线。

分段受光也需要间接亮度/补光与材料身份；看暗部里的结构，不以黑影面积证明体积。金属反射需要真实环境。柔影、AO或Bloom按目标接现工具，保留少变量对照。

引擎的cap/side默认组只说明构造步骤，不说明屋面、底面或包边。先给真实面定义材料语义；[assignMaterialRegions](../assets/materials/material-regions.mjs)从实际三角的几何法线/位置分区，完整匹配成功后才替换groups，保留顶点/索引与顺序。规则冲突或缺失会拒绝；连续组增加的draw calls纳入预算。程序配方已有色素时默认中性乘色；独立浅基色用baseColor，不叠加不明的二次压暗。

静态合并同时保留语义身份和渲染状态：`role + 规范化options`标明原材料区，材质实例、投影标志等决定绘制兼容。多个区在灰模阶段可以借用同一Material；`material.uuid`相同不代表它们以后都是木材或涂层。合并时按语义分桶或保留真实组区间，切换look读取原槽；用共享灰模→差异材质与直接差异材质构建对照，检查实际三角分布和几何身份。

灯架可选`hemisphereIntensity/skyColor/groundColor`提供真实天空/地面半球补光。把主光照亮的面、朝天暗面和朝地暗面分开检查；这不是GI，也不替代接触阴影。近场阴影bounds覆盖必要投影者/受影者，远景地形不与近景共享无限扩大的拟合区。远层投影策略显式决定，避免增加场景后阴影精度随之消失。

## 5 规模、观看与上下文

`selectProjectedDetail`读取直径、相机空间正深度、视口、FOV及该对象上次level，以前侧深度估尺寸并加迟滞；包络内选最高细节。例中只切次级紧固件，主轮廓、洞/道路/基部与身份保持。不是隐藏主要族满足预算，也不保证复杂曲面屏幕误差。

`selectObservationView`接收设计者给定的候选相机、真实表面点及遮挡物，以原可见性工具排序；在构建/切视图时用，不逐帧跑全世界射线。它不发明焦点、不判断美感，最高样点可见率也可能构图差。保留互补视图并审图；层间/入口/负形另有观察任务。

样点按相关可见面与任务选取；只取同一侧的点会把某个朝向的偏好藏进分数。需要比较互补方向时采样相应表面，候选顺序保留设计者的构图偏好；近景仍查看界面遮挡、画幅裁切和整体负形。

关键接口用`requiredFeatures:[{id,points,minVisibleFraction}]`分别检查，不能让大量主体样点补偿一个消失的落点。`frameBounds`只检查整个叙述包络是否入画，`marginPixels`保留画幅边距；包围盒不参与表面可见性替代。所有候选都不满足时仍返回真实未满足状态，需要重新设计机位或上游空间，不能将最高分当通过。页面遮挡同时影响关键feature比例。

互补面由观察集合接力：给真实表面样点稳定ID并注明所属构件/端部/朝向，每个视图承担能同时看见的关系，再核对视图集合的联合覆盖。正面与背面互补的目标不应被写成单张图全部可见；也不能通过降低总比例掩盖具体缺失项。局部机位检查连接双方，整场反向机位另检查上下文，二者职责明确。

局部机位的前进、侧移和抬高沿对象的实际法线/水平切向/+Y构造，再转入世界坐标。资产转向道路后，硬加世界X可能变成向前推近并裁掉包络；用真实变换后的完整bounds复核全部近景与背向任务。

场域内外用同一地表源：先保留承托面，再平滑接回外围场；实际资产完整足迹决定保留面。`landscape-context`展示同族几何在多个距离层的组合与静态合并，但完整世界还要有区域邻接、道路到达与组团节奏；散布更多建筑不能替代这些关系。

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
