# 把算法接成可见的空间与形体

在设计已确定、准备实现生成器时使用。按当前缺口选一节；参数单位、依赖和候选比较读[参数设计](parameter-design.md)。这里区分**随包可调用工具**和**需项目实现/外部适配的方法**，算法产出仍由代码形成三维。

导航：[世界与语法](#世界连接图与局部语法) · [截面与实体](#截面连续体与实体) · [地形与侵蚀](#地形水系与侵蚀) · [植被与散布](#分枝冠层与受约束散布) · [表面与水](#同源场表面与水) · [运动与规模](#运动导航与规模)

## 世界：连接图与局部语法

### 从用途与连接生成空间

先固定决定身份的地标、主要空隙、边界和主关系，再选择区域生成方式。图中的节点是有尺度/用途的地方，边是有宽高/方向的连接；用同一图生成真实通道、排除域、入口和附属内容。自然水系也可用有向图，流向/汇流与道路的通行语义分别处理。

| 拓扑与目标 | 具体步骤 | 主要控制量 | 交给几何的内容 |
|---|---|---|---|
| 沿线空间、街区、园路 | 设计主连接图→拆交点→给主次宽度→沿边分配用途与地块→保留广场/视廊 | 节点坐标、边宽、退界、临街宽/纵深、节点间距 | 图、通道边界、地块、入口朝向；再做道路/台地/建筑 |
| 规则/放射/顺势混合路网 | 区域方向场→分级流线或生长提议→局部碰撞/吸附→显式交点图→闭环/退界 | 场方向/影响半径、主次间距、积分步长、吸附距离 | 路网与地块多边形；道路带宽和路口另建 |
| 房间与连续通道 | 分割区域或放房间→门与走廊连接→指定用途→增环/删无用支路→可达检查 | 房间尺度、开敞率、走廊宽、环路数、入口出口 | 二维网格/房间与连接数据；竖向楼层另建图 |
| 已规划区块的局部模块 | 定义自有语义模块与接口→固定出入口/边界→传播邻接约束→有界求解→检查完成与可达 | 模块权重、允许旋转、局部模式尺寸、重试/步数预算 | 模块ID与变换→本项目墙/屋顶/铺装工厂 |

可参考[MapGenerator方向场/地块](https://github.com/ProbableTrain/MapGenerator)、[道路生长](https://github.com/josauder/procedural_city_generation)、[ROT房间/走廊](https://github.com/ondras/rot.js)、[MarkovJunior分阶段重写](https://github.com/mxgmn/MarkovJunior)、[WFC](https://github.com/mxgmn/WaveFunctionCollapse)/[JS port](https://github.com/kchapelier/wavefunctioncollapse)。这是条件来源，不是随包依赖。WFC保证的是所编码的局部兼容；全局连通、用途和构图由上层图承担。求解返回值要区分失败、步数耗尽和完整输出。

### 随包工具：走廊图与沿边地块

复制[ corridor-layout.mjs ](../assets/scene/corridor-layout.mjs)，无需额外库。`compileCorridorGraph({nodes,edges})`按稳定ID排序，生成各边的实际宽度矩形`quad`、长度/朝向、节点`junctions`和连通分量`components`；所有距离使用同一世界单位，平面是XZ。

```js
import {compileCorridorGraph, generateFrontageLots} from './assets/scene/corridor-layout.mjs';
const layout = compileCorridorGraph({
  nodes:[{id:'entry',x:-20,z:0},{id:'square',x:0,z:0},{id:'gate',x:0,z:25}],
  edges:[{id:'main',from:'entry',to:'square',width:4},
         {id:'rise',from:'square',to:'gate',width:3}]
});
const lots = generateFrontageLots(layout, {
  frontage:5, depth:6, gap:1, setback:1, endClearance:3,
  acceptFootprint: corners => corners.every(([x,z]) => x>=-30&&x<=30&&z>=-25&&z<=35)
});
// 直接生成一条路带；quad以相同索引进入顶点，不重新随机。
const edge=layout.edges[0], positions=[];
for(const [x,z] of edge.quad) positions.push(x,0,z);
const roadGeometry=new THREE.BufferGeometry();
roadGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
roadGeometry.setIndex([0,1,2,0,2,3]);roadGeometry.computeVertexNormals();
scene.add(new THREE.Mesh(roadGeometry,new THREE.MeshStandardMaterial({color:0x7b7469})));
```

示例路面为Y=0薄面。正式地形道路沿长度细分后逐截面求最终宿主两侧高程，补路肩/厚度；节点需建路口。`junctions.radius`仅是相连边半宽最大值，可辅助圆形节点过渡，不是完整道路布尔。桥、曲路、纵坡/阶梯和多层交叉由项目继续实现。

`generateFrontageLots`两侧打包矩形，固定顺序检查路带占用、先前已接受地块和`acceptFootprint`，返回真正接受的`id/edgeId/center/corners/frontage/depth/headingRadians`。角度由世界+X向+Z计，Three绕Y旋转时通常使用负值。该例仅用凸矩形场地；有洞、多边形或曲面时回调需检查完整多边形与边界/孔洞相交、宿主及净空，四角合格不证明中间不跨洞。平面地块不证明落地可用，之后按[实际宿主](scene-layout.md#5-从实际宿主求接触与净空)资格与构造基础。

图不自动修交点：无共享节点的相交边拒绝输入，先拆分；桥式跨越应分层处理。连通分量只认节点ID；邻近、画上交叉或合并网格不等于相通。输出稳定排序不保证编辑拓扑后所有地块ID不变，需保持内容身份时由项目维护地块ID。此工具是受控布局底座，不是自动城市设计器。

在起伏宿主上先按[资格预演](detail-distribution.md#3-让生成器输出可核对的真实结果)统计可用地块与拒绝原因，再确定建筑密度。若基础高度/入口坡度限制拒绝大部分地块，调整路线、分级台地或地块尺度，得到可建区域后再扩场；保留平面候选与最终可用结果的区别。

## 截面、连续体与实体

### 随包工具：宽深独立的沿程放样

复制[section-loft.mjs](../assets/geometry/section-loft.mjs)。适合用椭圆截面表达的弯曲/收放连续体：每站明确`center`、**全宽**`width`、**全深**`depth`与`rollRadians`，让转折前后邻域都参与。沿相邻站直线连接并传输坐标架，roll相对未滚转的传输架施加。

```js
import {createSectionLoftGeometry} from './assets/geometry/section-loft.mjs';
const geometry=createSectionLoftGeometry(THREE, {
  stations:[
    {center:[0,0,0],width:3.2,depth:2.0},
    {center:[0,2,0],width:4.4,depth:1.3},
    {center:[.5,4,.2],width:2.6,depth:1.8,rollRadians:.12},
    {center:[1.2,6,.5],width:1.2,depth:.8}
  ], radialSegments:24, caps:true, reference:[1,0,0], uvMeters:1
});
const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xc5b9a4,roughness:.65}));
scene.add(mesh);
```

输出真实索引BufferGeometry，侧壁UV按各环弦长和中心线弧长计，端盖单独平面UV/法线，光滑周向接缝法线一致，包围体已更新。`uvMeters`是每UV单位对应的世界长度；输入米制时默认1米。近景轮廓平滑需先插入有设计意义的中心/宽深站位，再按曲率加密；`radialSegments`只加周向采样。

限制：无内壁/分枝拓扑/任意截面/自动倒角/防自交；端部不能将宽深压成0生成极点。reference应不平行首段，急回转、急滚转与宽截面可能折叠。需要平面和圆角独立控制时用显式截面多边形；需要空壳用内外剖面；需要融合分枝用控制网格或实体场。适当延长转折/缩小截面，按[几何诊断](geometry-recipes.md#给转向与局部形变保留足够空间)看真实网格，不能以平滑法线替代正确曲率。

### 分枝、开口与隐式实体的选择

| 目标 | 生成步骤 | 参数与边界 |
|---|---|---|
| 装配体 | 主壳截面→独立结构段→内外边界/洞壁→共源端口与附件 | 主尺寸、分段比例、局部突出/深度、壁厚/净空；沿[构造配方](procedural-construction.md)实现 |
| 连续分枝/有机体 | 父子骨架→连接邻域控制笼/融合场→保留分叉凹部→网格提取→组织分区 | 分枝半径与父段相关、融合半径不能吞洞/分叉间隙；阴影/拾取需要实际面 |
| 复杂实体负形 | 先闭合有效操作数→固定矩阵→静态布尔→检查切口/内壁/材质槽 | 复杂时评估[three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg)；简单墙洞沿用Shape.holes |
| SDF实体 | 定义每个语义体与合成方式→有界采样/提取→法线/材质/端口 | [Manifold](https://github.com/elalish/manifold)的levelSet正值为内部；edgeLength控制采样尺度。不要混用其他SDF的符号约定 |

实体场、CSG与任意控制笼不是本模块内置能力。实体运算放在构建/worker或缓存层，保留源参数；网格完成后材料、连接和目标受光仍需完成。官方[参数曲面](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/geometries/ParametricGeometry.js)和[函数形体](https://github.com/hofk/THREEf.js)可学表示自由度；旧模块的Three版本需适配。

## 地形、水系与侵蚀

先画脊线、谷地、海岸、断面和平台/通路优先级，再决定区域间形成规律。平地上叠很多octave不能自动得到有身份的山体。已有完整宿主生成器时保留它；需要基础连续扰动与梯度时才用下述随包模块。

### 随包工具：共享高度与解析导数

[height-field.mjs](../assets/environment/height-field.mjs)提供原创**五次平滑value-noise fBm**，不是Simplex/Perlin，也不是侵蚀模型。参数用`baseHeight/amplitude`世界长度、`baseFrequency`世界长度倒数；`persistence`每层振幅倍率，`lacunarity`每层频率倍率，`octaves`整数1..16，seed为整数。振幅按权重和归一，输出在`baseHeight±amplitude`范围。

```js
import {createFractalHeightField, createHeightFieldGeometry} from './assets/environment/height-field.mjs';
const field=createFractalHeightField({seed:71,baseHeight:0,amplitude:3,baseFrequency:.06,octaves:4,persistence:.5,lacunarity:2});
const groundGeometry=createHeightFieldGeometry(THREE,field,{sizeX:80,sizeZ:60,segmentsX:160,segmentsZ:120});
const ground=new THREE.Mesh(groundGeometry,new THREE.MeshStandardMaterial({color:0x75836a,roughness:.9}));
scene.add(ground);
const {height,dx,dz}=field.sample(5,7); // 导数已经是世界空间dh/dx与dh/dz
const normal=field.normalAt(5,7);      // 单位xyz数组，+Y为上
const slope=Math.atan(Math.hypot(dx,dz)); // 弧度；进入生境/材料规则
```

场对象不可变；修改结构参数创建新场并重建受影响消费者。mesh为单值上表面，无侧壁/底面/洞穴。UV为世界XZ长度。解析法线与同一场一致，但粗网格在顶点之间是分片三角形；接地/接触仍查询最终mesh，不能用field高度声称零误差。frequency×最高层频率与网格间距共同决定可表示特征；按目标像素降低过细层，不能无限提高octaves。

### 添加有形成原因的地貌

| 层 | 原子操作 | 输出与验证 |
|---|---|---|
| 设计主形 | 用距离/断面/控制网格确定脊谷海岸与高差；处理相交优先级 | 主形网格与剖面，正确方向/谷口/平台关系 |
| 水系与生境 | 有向下游/汇流→降雨/湿度→河宽或生态区域 | 同源地形、水道、湿区、群落域；先改完地形再接道路/建筑 |
| 水蚀/沉积 | 在高度格上取梯度→水滴走向→更新携沙容量→侵蚀/沉积→蒸发/终止 | height数组真正写回顶点，重算法线与查询；看冲沟和沉积，保留主形 |
| 岩层/崖壁 | 主断面→层间错台/崩积→局部裂隙；倒扣由完整表面承担 | 中层轮廓/负形先存在，微纹理只补表面 |

参考[Mapgen4](https://github.com/redblobgames/mapgen4)、[THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain)、[Beyer水蚀](https://github.com/tessapower/hydraulic-erosion)、[SebLague水蚀](https://github.com/SebLague/Hydraulic-Erosion)。水蚀半径可能是格点而非米，`minSlope`要查公式是否真为坡角；滴数按面积/目标尺度取值，避免主线程长时间阻塞。跨库的frequency/persistence不能按名字共享预设。以上高级地貌管线需项目适配，随包field只提供连续场底座。

## 分枝、冠层与受约束散布

植物先完成结构原型，再做群体；完整分布链读[分布方法](detail-distribution.md)。

1. 定主干/主枝/次枝/末梢的长度、半径、分枝起点、方向和数量，按代际分别控制；冠层包络和透光空隙作为设计输入。
2. 按目标选递归分枝/L-system，或在冠层内放吸引点做space-colonization：找影响半径内最近枝段→汇聚方向→推进→移除到达点→有限迭代。吸引半径、到达半径和步长共用世界尺度。
3. 从骨架生成收分枝干；分叉用实际承接/连续面，末梢叶片/花簇依附最终枝条。法线方向和透光关系设计后，再按高度/枝级加入风权重。
4. 生成有结构差异的少量原型，检查互补方向；群体先簇中心和生境，再做簇内间距、净空与完整足迹，最终矩阵只生成一次。

可参考[ez-tree](https://github.com/dgreenheck/ez-tree)的分级参数与叶片法线、[proctree](https://github.com/supereggbert/proctree.js)的分叉环、[CodingTrain](https://github.com/CodingTrain/Coding-Challenges)的生长推导、[vegetation](https://github.com/yomotsu/vegetation)的岩块凸包/风化/LOD；它们不是随包依赖。ez-tree当前angle用度，默认无叶纹理会暴露矩形；需程序生成alpha叶形。教程骨架线不等于成品树，随机缩放也不等于结构原型。

散布可用[Poisson](https://github.com/kchapelier/poisson-disk-sampling)提供最小间距/变密度点。先定义区域/簇/方向，再采点与邻域拒绝；密度函数0..1的端点含义按所用实现核对。均匀Poisson只解决间距，生态层次、冠层空隙和焦点让位由规则决定。地块内部落点可参考[polylabel](https://github.com/mapbox/polylabel)，区域邻接参考[d3-delaunay](https://github.com/d3/d3-delaunay)；最大内接圆中心也不能证明整个资产足迹成立。

## 同源场、表面与水

### 让变化真正共源

形成区先控制需要的通道：例如湿区同时影响颜色/roughness与合适的分布，几何起伏与其法线共用函数。材料原型读[表面细节](surface-detail.md)；Three原生PBR/PMREM已经承担BRDF与环境预滤，只有具体缺口需要自写。

对于`h(x,z)=A*n(f*x,f*z)`，世界梯度是`A*f*gradient(n)`；多层相加时每层各带自己的幅度/频率。domain warp还需乘扭曲映射Jacobian，不能只取扭曲后位置的噪声梯度。CPU和shader分别实现时比对固定输入点，再验证可见位移、法线和相关阴影/锚点。

参考[psrdnoise](https://github.com/stegu/psrdnoise)/[webgl-noise](https://github.com/stegu/webgl-noise)的解析梯度、[LearnOpenGL](https://github.com/JoeyDeVries/LearnOpenGL)的材光推导。新psrdnoise `alpha`是弧度，旧版本`rot`可为圈数。fBM是场组合，SDF是空间表示，二者都不自动给出材料身份。[LYGIA](https://github.com/patriciogonzalezvivo/lygia)与[Book of Shaders](https://github.com/patriciogonzalezvivo/thebookofshaders)可辅助理解组合/教学，当前授权需另核，不按MIT整包复制。

### 按水体需要选择表示

| 目标 | 算法与必要消费者 | 控制量与失败定位 |
|---|---|---|
| 安静湖面/平水反射 | 真实水域mesh+适合的反射/法线/水深 | 反射RT不是粗糙水材质；几何岸线/水底先成立 |
| 可见大波轮廓 | 解析Gerstner叠加；总位移偏导形成法线；CPU锚点读同一波组 | 方向、波长米、幅度米、时间秒、相位弧度、陡峭度；控制水平翻折 |
| 风驱宽频海浪 | 初始波谱→相位→XYZ频域位移→二维IFFT→位移纹理/法线→材质 | patch边长/风速/FFT状态分辨率/显示网格分辨率分开，先核浮点RT与周期重复 |
| 局部扰动池水 | 高度与速度历史缓冲→波动更新→法线→深度/折射/焦散 | 固定步长、边界、扰动事件与完整重置；不是一个time uniform即可seek |

Gerstner单波以水平基点`p=(x,z)`计算`theta=k*dot(d,p)-omega*t+phase`，`k=2π/wavelength`，`d`归一。位移为`[Q*A*d.x*cos(theta), A*sin(theta), Q*A*d.z*cos(theta)]`；每个波都从同一个未变形基点求值。总位置加一次基点，总偏导加一次单位基方向，再以`normalize(dP/dz × dP/dx)`求向上法线。深水色、Fresnel、场景反射、岸边/波峰泡沫和透明深度分别接入，不能由白色条纹代替整套关系。

可参考[dli/waves](https://github.com/dli/waves)、[tuxalin/water-shader](https://github.com/tuxalin/water-shader)、[webgl-water](https://github.com/evanw/webgl-water)、[FFT-Ocean](https://github.com/gasgiant/FFT-Ocean)。它们需要Three封装或跨语言适配；旧[jbouny/ocean](https://github.com/jbouny/ocean)不提供FFT几何浪。Three r180 Water和随包平面镜像均不自动提供波浪位移、粗糙反射与岸线反馈。选定目标后按[效果配方](effect-recipes.md)完成所需层，不统一强加全部水效。

## 运动、导航与规模

| 需要的可见行为 | 方法选择与接线 | 参数与边界 |
|---|---|---|
| 确定机构/摆动/循环 | 解析关系或FK，真实端点驱动连杆/支点/反馈 | 长度、幅度、周期、相位；只动主件不算机构连通 |
| 长链/闭链达到目标 | FABRIK、CCD或闭链求解，关节范围与目标共同作用 | 链长、角限、容差、迭代预算；可达不等于自然姿势 |
| 群集/避让/流动 | 意图→期望速度→转向限幅→固定秒制积分→实例变换 | 最大速度/加速度、邻域半径、分离/聚合权重；邻域分桶 |
| 布、绳、柔体 | 预测位置→距离/弯曲/体积约束→接触→重建速度→更新mesh | dt、子步、compliance；旧位置/速度/约束与事件均需复位 |
| 刚体碰撞/堆叠 | 对应代码几何的碰撞体→固定step→同步mesh | 尺度、质量、摩擦/恢复、CCD；先证明确需动力学 |
| 导览与相机 | 可走面/节点图→寻路/平滑→实体净空；相机单独检测阻挡 | 使用者尺寸、路径宽高、镜头近裁面与平滑时间 |
| 大世界运行 | 按空间分块→共享原型/材质→可见性与LOD→有瓶颈再BVH/worker/GPU | 世界稳定ID、切换距离/滞回、帧与内存预算；不重排世界身份 |

运动方法参考[Nature of Code](https://github.com/nature-of-code/noc-book-2)、[fullik](https://github.com/lo-th/fullik)、[closed-chain-ik](https://github.com/gkjohnson/closed-chain-ik-js)、[Matthias教学](https://github.com/matthias-research/pages)、[Verlet](https://github.com/subprotocol/verlet-js)、[Cannon](https://github.com/pmndrs/cannon-es)、[Rapier](https://github.com/dimforge/rapier)。教学软体例子中的预制tetMesh不能导入本分支，应程序生成所需网格。物理库和演示源码不是随包功能，历史/随机seek按[运行方法](motion-and-scale.md)落实。

导航/规模可选[Yuka](https://github.com/Mugen87/yuka)、[three-pathfinding](https://github.com/donmccurdy/three-pathfinding)、[Recast](https://github.com/isaac-mason/recast-navigation-js)、[camera-controls](https://github.com/yomotsu/camera-controls)、[BVH](https://github.com/gkjohnson/three-mesh-bvh)、[RBush](https://github.com/mourner/rbush)/[Flatbush](https://github.com/mourner/flatbush)、[WebGL2数据流教学](https://github.com/gfxfundamentals/webgl2-fundamentals)。区分图查询、二维宽相位、三角形精查与可见性；工具不能互相替代。当前[instanced-mesh](https://github.com/agargaro/instanced-mesh)要求Three≥0.186且仅WebGLRenderer，不直接接入r180；可学习每实例LOD策略。接第三方库先读[库接线](library-integration.md)，不要为算法升级破坏已有渲染链。
