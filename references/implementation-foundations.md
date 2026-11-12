# 表示选择、数据接力与资源归属

视觉设计已经明确主要轮廓、负形、空间关系、材光与观看任务后，写生成器之前读本页。它将设计接到实际表示、消费者与生命周期；不增加新的生产阶段。已有生成器能表达目标时直接复用；尚未实现的算法按需开发，不把方法名当可调用API。

## 1 从可见特征选择表示

先回答：哪些特征改变轮廓/孔腔/连接，哪些只改变受光？最近景别需要看见什么？形态是否连续、可分解、会变形？答案决定表示；采样密度和性能策略随后选择。

| 结构条件 | 首选路线与输入 | 当前可用性 / 换路条件 |
|---|---|---|
| 规则体块、明确分件与刚性装配 | 直接构造几何；尺寸进入顶点，端口用局部刚性架 | 现有Three构造器、[装配器](../assets/scene/asset-assembly.mjs)、[端口连接](../assets/scene/anchor-connection.mjs)；连续形态不能靠堆积规则体替代 |
| 轴对称，内外壁由径向剖面定义 | 内/外`{r,y}`轮廓、折点、端环 | [createRevolvedShell](../assets/geometry/profile-surfaces.mjs)；内壁独立设计，不是法向等厚偏移；偏心、弯轴、侧孔转其他路线 |
| 沿路径连续，截面可用椭圆表达 | 中心站位、全宽/全深、滚转、采样 | [createSectionLoftSource](../assets/geometry/loft-source.mjs)给网格与侧面查询；非椭圆对应截面用[profile-loft](continuous-surfaces.md)，均不证明全局无自交 |
| 平板孔洞、凸域重复铺覆与端部 | 轮廓/孔/厚度，或完整单元与允许域求交 | [截面工具](profile-geometry.md)、[边界工具](visual-construction.md#2-重复单元先归属区域再裁完整轮廓)；任意实体布尔另实现 |
| 非轴对称自由曲面、复杂内腔/多开口 | 控制patch/壳；必要时实体布尔或隐式体提取 | [连续形体工具](continuous-surfaces.md)已有单Bezier双层封边壳与有界场MC；多patch/通用布尔/自适应等仍需实现，读[条件库](library-integration.md) |
| 一个XZ位置只有一个表面高度 | 高度场及梯度，同源生成地形与场查询 | [height-field](../assets/environment/height-field.mjs)；洞穴、悬挑、多层不适用，转多值网格/实体路线 |
| 分枝融合、柔性或连续变形 | 分级骨架+真实连接；或控制曲线/网格/蒙皮 | 读[自然方法](nature-methods.md)、[运动方法](motion-and-scale.md)；完整分叉/rig需开发，多个Tube相交不等于连续连接 |
| 世界是区域、路径、房间和用途关系 | 图/区域是布局表示；每个资产再选自己的几何表示 | [world-layout](world-layout.md)给道路并集/孔、区域足迹与层间连接；原corridor工具继续供单图/地块；房间/导航/世界美术另行组合 |

几何、表面和动态是可组合的表示选择：网格负责轮廓/负形；材质场负责颜色/粗糙度/微法线；动作选择刚性层级、解析位移或需要历史的模拟。共享源能生成实际表面时直接复用；无法给出正确接点时增加真实网格查询或实现对应接口。

### 选择结果如何进入代码

为当前对象记录一条简短决定即可：**目标特征→表示/已选生成器→关键输入→表达不到的部分与补法**。例如“需要独立宽深和弯轴→椭圆放样→站位/宽深/滚转→侧孔需独立开口方案”。这不是要求另写长审批文档。

运行[表示与接力样例](../assets/examples/foundation-lab/index.html)，其[工厂](../assets/examples/profile-relation.mjs)明确分开两种能力：回转壳有内腔且要求轴对称；放样有独立宽深/弯轴但为实心。改变高度或弯曲会重建真实网格和接点；不把改变表示误称为相同造型的质量升级。样例的比例/结构不是新作品的默认设计。

## 2 最小数据接力：谁产生，谁消费

| 边界 | 交付内容与责任 | 实际消费者 |
|---|---|---|
| 视觉设计→空间 | 统一单位/轴向，主要族、区域/连接/高差、观察尺度与目标特征；未知尺寸明确为设计 | 布局和摄影；宏观任务保留全部区域与全貌/区域/近景职责 |
| 空间→资产 | 稳定ID、用途/原型、局部尺寸/结构参数、宿主或端口；世界位置/朝向由布局持有 | 工厂只生成局部几何与本地端口；世界parent承担刚性放置 |
| 资产→邻件/材光/动作 | 真实root、已实现的表面/端口/材料区、静动边界、参数快照、相关更新与dispose | 邻件依附同源几何；材光读实际坐标/区域；动作读实际活动层级 |
| 组合→运行/交付 | 当前提交状态、时钟、相机模式、资源所有者、何时可取图 | 渲染/交互/导出；历史模拟另给reset/检查点，不靠补一个time字段假装可seek |

普通静态资产可只有`root/spec/anchors/dispose`；有表面查询才返回它，有动作才返回update。纯算法不必伪造root。多个参与者需要同一事实时共享源数据或由它派生，不各写一份近似公式。

### 坐标与接口

项目先确定米制或其他一致单位；随包构造例采用米制、+Y向上、单位根缩放。`anchors`为**资产局部**`Matrix4`快照，`placeAtAnchor`约定端口+Z向外、+Y为接口上方；`surfaceFrame`是**世界**框架，默认+Y贴表面法线，二者不能直接混用。接口变换见各模块说明。

几何局部点进入世界用`root.localToWorld`/`matrixWorld`，法线用normal matrix；世界框架进入parent用`inverse(parent.matrixWorld)*frame`。`createSurfaceSampler`查询实际Mesh并返回世界点/法线。根缩放不充当生成尺寸参数；现端口工具只接受单位刚性变换。

承托和连接按真实轮廓检查：中心线落在底座上不能证明整个截面落在底座上；转折、倾斜、厚度和端盖共同决定接口包络。样例为水平承托约束底部路径切向，再用实际顶点和射线验证；不要求所有对象底部都沿同一方向。

## 3 参数改变后，重建哪一段

| 改变 | 必须更新的消费者 | 可保持部分 |
|---|---|---|
| 局部结构/拓扑/表示 | 几何→表面/索引→端口→邻件/基部→包围体/查询；必要时UV、材料区、变形数据 | 世界ID/刚性放置、无关对象、可继续共享的材质 |
| 世界刚性位置/朝向 | parent矩阵与世界查询；依赖世界场的效果/空间索引 | 局部顶点、局部端口与局部关系 |
| 材质uniform/颜色/粗糙度 | 当前材质实际属性；shader路径改变按Three要求更新编译状态 | 几何和装配；程序纹理重烘焙另由其所有者替换/释放 |
| 绝对时间/姿态 | 活动层级/位移及法线、阴影、附着、拾取/bounds的相关消费者 | 静态结构；依赖历史的状态按模拟规则重建 |

先完成一段相互依赖的关系，再提交到场景。[createAssetSlot](../assets/runtime/asset-slot.mjs)提供同步的`构建→验证→挂载→提交→释放旧件`；结构失败时保留旧件。新几何与旧表面查询/旧端口不混用。

slot只保证**一个handle**的替换，不保证多个slot的组原子性。需要同时提交的主物/支撑/附属件放进同一工厂/root，并由一个slot替换。独立资产可以独立重建，不引入自动依赖图框架。

## 4 资源归属：创建时明确，销毁时显式

| 所有者 | 拥有什么 | 其他参与者如何使用 |
|---|---|---|
| 场景/更长生命周期的scope | renderer、controls、共享材质/纹理/调色板、环境/后期、子slot | 资产借用材质等；退出时先销毁子资产，再销毁共享提供者 |
| 资产工厂 | 自建几何、独占纹理/实例缓冲、内部源与临时构造资源 | 返回完整handle；由调用者登记handle整体；内部仍按自身契约释放 |
| slot | 当前候选scope及其root的挂载 | parent、相机、renderer由外部持有；slot不遍历场景猜测几何/材质所有者 |

使用[createResourceScope](../assets/runtime/resource-scope.mjs)：`own(value)`调用其dispose；`own(value,release)`使用显式释放器；`defer(fn)`撤销监听、挂载等非资源副作用。**只登记拥有的对象，借用无需登记。** 相同对象同scope去重，不同scope重复own会报错；工厂与内部资源的重叠归属需由构造者避免，工具不能透视工厂内部。

scope逆登记顺序清理、重复dispose无副作用；一次清理抛错仍尝试剩余项，最后抛AggregateError。失败项不会自动重试。它不做引用计数、自动纹理遍历或GC；Material.dispose不会释放其贴图，RenderTarget的附件由其owner释放，具体按原模块契约登记，避免登记两次。

### 可直接运行的组合代码

以下为项目根目录ESM；`three`需与完整入口同样锁定。两种样例结构均由现有工具产生，工厂源包含所有关键函数。

```js
import * as T from 'three';
import {createResourceScope} from './assets/runtime/resource-scope.mjs';
import {createAssetSlot} from './assets/runtime/asset-slot.mjs';
import {buildProfileRelation} from './assets/examples/profile-relation.mjs';

const scene = new T.Scene(), owner = createResourceScope();
const materials = {
  body: owner.own(new T.MeshStandardMaterial({color:'#b6d0ca'})),
  metal: owner.own(new T.MeshStandardMaterial({metalness:.6,roughness:.3})),
  support: owner.own(new T.MeshStandardMaterial({roughness:.8})),
};
const parent = new T.Group();parent.position.set(2,0,-1);scene.add(parent);
owner.defer(()=>parent.removeFromParent());
const slot = owner.own(createAssetSlot(parent));
let design = {id:'region/object-1',representation:'section-loft',
  height:3,width:1.9,depth:1.25,bend:.6};
function rebuild(patch) {
  const previous = slot.revision;
  try {
    slot.replace(candidate=>candidate.own(
      buildProfileRelation(T,{spec:{...design,...patch},materials})
    ));
  } finally {
    if(slot.revision!==previous) design=slot.current.spec;
  }
}
rebuild({});
rebuild({height:4}); // 真实网格、查询、端口和邻件一起替换。
materials.metal.roughness=.25; // 只改共享材质，不重建几何。
owner.dispose(); // slot先释放工厂，然后共享材质；renderer若借用不在此释放。
```

新候选的所有资源在创建时登记；中途抛错由候选scope清理，外部共享材质保持。旧件释放若在**提交后**抛错，新件已经有效：以`slot.current/revision`判断当前状态，记录清理错误，不能恢复已销毁的旧件。代码中的finally负责同步实际提交的参数快照。

slot不支持异步builder、worker取消或全世界事务。异步构建需要另做版本号/取消/迟到结果归属；此时仍可用scope登记资源，不能把Promise直接传给同步slot。

## 5 运行与检查

复制所需`assets`保持相对路径；在[foundation-lab](../assets/examples/foundation-lab/index.html)的`vendor/`下提供同一个r180包的`build/`、`examples/jsm/`及许可证，用本地HTTP打开。入口包含renderer、布光、360°环绕/缩放/复位、两种表示、独立结构控制、材质控制、失败注入、重复重建与退出清理，不需要预制模型。

| 检查 | 看实际消费者 |
|---|---|
| 结构改变 | 顶点/bounds、实际表面命中、端口与附属件随动；无关资产/相机/材质身份保持 |
| 材质改变 | 同一可见材质属性改变，几何UUID/revision保持 |
| 无效重建 | 旧几何/root/参数快照继续有效，候选资源被释放 |
| 多次重建/退出 | 真实dispose事件与renderer统计结合观察；预热后资源不持续增长，退出停循环/移监听/释放所有者 |

Node行为测试检查资源/替换/真实Three构造；浏览器检查接线、真实操作与渲染。它们不证明参考到设计的Agent遵循、自然动作或整场画质提升，后者进入相应方案与固定作品评测。
