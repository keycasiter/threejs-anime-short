# Skill执行、正确性与画质测评

用于维护Skill或用户明确要求版本比较。普通作品制作继续走[生产流程](production-workflow.md)，不自动启动本页的多项目实验。制作代码入口见[代码接力](code-guidance.md)。

## 四类证据分别判断

| 层次 | 问题 | 实际证据 |
|---|---|---|
| 执行 | 短需求补全、表示选择、代表关系与扩场是否完成 | 设计数据、真实调用、主要族与区域视图；不按术语命中计画质分 |
| 正确性 | 参数、静动、连接、法线与随机依赖是否真实成立 | 正反例、数值消费者、必要运行图；原模块通过不代替项目接线 |
| 视觉 | 当前风格下构图、空间、中层、细节与材光是否改善 | 目标参考、同景别匿名配对、连续片段与具体差距 |
| 交付 | 当前包与目标平台是否可用、稳定 | 实际操作/边界/持续运行、解压包重载、构建绑定及媒体播放 |

## 从失败样例证明探针有意义

先确认检测器能区分真实消费者与伪接线，再用于应用。下面完整函数只建立测试对象，无renderer：第一组故意仅写配置，第二组改变实际Mesh变换；第三组只有空节点时钟，第四组有实际可见子件。返回结果用于机制检查，不是美术评分。

```js
async function runConsumerExamples(T,{probeParameter,probeRigidMotion}) {
  const geometry=new T.BoxGeometry(1,1,1),material=new T.MeshBasicMaterial();
  const mesh=new T.Mesh(geometry,material),config={width:1};
  const measure=()=>{mesh.updateWorldMatrix(true,false);return [mesh.matrixWorld.elements[0]];};
  try{
    const configOnly=await probeParameter({baseline:1,candidate:1.6,
      apply:value=>{config.width=value;},measure});
    const actualTransform=await probeParameter({baseline:1,candidate:1.6,
      apply:value=>{config.width=value;mesh.scale.x=value;},measure});
    const emptyRoot=new T.Group();
    const empty=await probeRigidMotion(T,{root:emptyRoot,
      update:t=>{emptyRoot.userData.time=t;},times:[0,1]});
    const pivot=new T.Group();mesh.position.x=1;pivot.add(mesh);
    const moving=await probeRigidMotion(T,{root:pivot,
      update:t=>{pivot.rotation.y=t*.2;},times:[0,1],restoreTime:0});
    return {configOnly,actualTransform,empty,moving};
  }finally{geometry.dispose();material.dispose();}
}
```

调用时从`assets/runtime/scene-probes.mjs`导入两个真实探针，再`await runConsumerExamples(T,{probeParameter,probeRigidMotion})`。配置组应changed=false；真实变换组changed=true；空节点observed=false；普通可见子件observed/changed=true。保持段可以observed=true/changed=false。shader、实例、蒙皮和buffer形变另选实际消费者，不能用该刚性矩阵检查器代替。

| 其他易错机制 | 正例/反例与不变量 |
|---|---|
| 参数与随机流 | 结构参数更新发出顶点/矩阵；仅调纹理采样数量，结构落位不变；有意联动单列 |
| 接点与坐标 | 从真实网格/路径采样；测间隙或插入量；固定状态只转相机，重构世界法线不变，高光像素允许正常变化 |
| 材料/反射 | 同一形成区接到需要的实际通道；改反射物后，按声明的实时或重捕获方式影响消费者 |
| 边界与成本 | 读取实际controls边界；区分普通近景与局部放大；统计注明主遍或全帧，rAF不代替GPU计时 |

## 视觉标尺与取证

五项各0–3分：构图、空间、形体/中层、细节/分布、材光。提前选定匹配风格、景别和运行约束的图像标尺：0为关键内容/关系失败，1为代理表达或明显粗糙，2为完整可读但有重要差距，3为在承诺视图达到所选高品质基准的关键关系。逐项给证据和差距，总分不掩盖严重缺陷。

### 跨题材评分锚点

| 维度 | 0：关系失败 | 1：可辨主体，主要依赖代理 | 2：完整可读，仍有明显缺口 | 3：目标关系在整组视图成立 |
|---|---|---|---|---|
| 构图 | 主体/关键区域被裁掉、互相遮挡，或焦点无法辨认 | 主体能找到但占幅、重心或留白失衡；画面空洞/拥挤 | 焦点与主次可读；局部遮挡、间距或视觉节奏仍削弱关键内容 | 主体、支撑/陪衬和负形有明确层级；全貌与互补视向均保住目标关系 |
| 空间 | 地面、对象或区域互不相接/悬浮，整体关系无法解释 | 核心物件落在空背景/单一地坪，或只有正面成立 | 通路、区域和前中远层可读，但承诺视向中的转折、过渡或局部区域仍有明显空缺 | 所有承诺查看方向（包含360°时的完整环绕）中，区域身份、入口/路径、承托与远近层级互相吻合；局部观察没有暴露空幕/断链 |
| 形体/中层 | 关键轮廓、负形、开口或连接关系错误/缺失 | 主形可认但主要依赖基础体块；厚度、内腔、转折/接头缺席 | 主形、开口、主要厚度和中尺度构件成立；部分接头、背面、曲率或承托显薄/断裂 | 主形—中层—边缘有清楚层级；截面变化、厚度、背面、负形、连接与支撑在目标近景均成立 |
| 细节/分布 | 没有支撑识别/用途的次级关系，或分布与结构冲突 | 细节是同一基础几何重复、随机撒布、尺度失配，或远景出现噪点 | 次级内容有用途与尺度；密度、重复、区域过渡或近远退场仍有明显问题 | 细节由宿主、用途、结构、距离共同控制；组团节奏与留白成立，远景不闪乱、近景不空薄 |
| 材光 | 明暗/色彩输出使关键面消失，或材质/光照关系互相矛盾 | 主要靠纯色区分；体积和接触弱，光照泛白/平涂/颜色污染明显 | 主要材质身份和体积可读；仍有局部过曝、死黑、反射/粗糙尺度不合或邻面混淆 | 目标材质的颜色、粗糙/高光、反射、阴影、接触与局部光区相互支持；近中远和背面保持可读 |

评分单位是**一个作品版本的一整组预定观察任务**，不是单张截图。评审先逐视图记录可见证据，再按该维度在整组中的稳定程度给0–3；全貌优秀不能抵消背面/连接/关键区域失效。只有次要视图有局部弱点且主要关系仍稳定时，才可给2；3要求所有规定主视图和相关互补视图都没有关键关系失败。分数旁必须写对象/区域ID、视向或时间点、具体证据与未满足关系。

出现以下硬缺陷时，对应维度不得高于1：主要对象/区域缺失或被遮蔽；宣称360°查看但后半空间未建/穿空；关键构件不接触/无承托；关键活动无法到达；目标材质在主要观察范围失去身份。这些是通用可见/结构事实，不替代项目自己的尺寸、法规或物理阈值。一个维度较弱不能通过其他维度加分抵消。

该表从本版本起用于新评测。既有评分仍保留其当时的原始口径；要按新表比较历史项目，必须重新对同一原始视图匿名复评，不能从旧总分推算。

全貌看焦点/区域/连接，区域看用途与层次，近景看截面/连接/材料；灰材质/侧光揭示体积，连续片段单独验证动态。默认全貌误切与正常局部观察裁切分别判断。8方位主环、实际距离/俯仰端点及有风险组合是起点，按问题补图，不把截图数量当覆盖质量。

不同设计使用同样的观察任务、视口与相对尺度，不硬套同一世界XYZ。评审只看匿名题目、图像/片段和共同标尺；版本、源码、过程与其他评审隐藏，左右顺序独立随机。先保存各自评分再汇总；明显分歧由预先约定的第三评审/人工复核，保留分歧原因。

## 从机制到完整作品

### 材质/视觉效果的配对证据

要判断颜色场、粗糙度、法线或反射开关有没有实际收益，固定同一几何、相机、灯光/环境、曝光、renderer和视口，A/B仅改变一个待测通道。每个预登记视图同时保留完整画面和提前定义的语义ROI（例如由同一对象/material ID生成的像素mask）：完整画面回答作品整体是否更好，ROI帮助判断变化是否落在目标表面。不能从看过差异的截图里事后圈选ROI，也不能只用ROI结论代替全画面判断。

像素指标只用于发现变化是否发生、变化落在哪里、变化是否集中；RGB变化小可能完全不可见，变化很大也可能是退化。下面函数只比较同尺寸、同显示输出链的`ImageData`样本；如果比较的是透明离屏目标，调用者应先以相同背景合成。mask是每个像素一个0/非0值，须在A/B查看前由稳定语义对象或同一个几何ID通道登记。全帧和ROI各计算一次。

```js
function measureImagePair(a, b, {mask = null, threshold8 = 8} = {}) {
  if (a.width !== b.width || a.height !== b.height ||
      a.data.length !== b.data.length || a.data.length !== a.width * a.height * 4) {
    throw new TypeError('A/B must be same-size RGBA ImageData');
  }
  const pixels = a.width * a.height;
  if (mask !== null && mask.length !== pixels) throw new TypeError('mask length must equal pixel count');
  if (!Number.isFinite(threshold8) || threshold8 < 0) throw new RangeError('threshold8 must be >= 0');
  let count = 0, sum = 0, changed = 0, above = 0, max = 0;
  for (let p = 0; p < pixels; p++) {
    if (mask !== null && !mask[p]) continue;
    const i = p * 4;
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const peak = Math.max(dr, dg, db);
    sum += dr + dg + db; count++;
    if (peak > 0) changed++;
    if (peak > threshold8) above++;
    if (peak > max) max = peak;
  }
  if (count === 0) throw new RangeError('ROI mask selects no pixels');
  return {
    pixels: count,
    meanAbsRGB8: sum / (count * 3),
    changedPixelFraction: changed / count,
    overThresholdPixelFraction: above / count,
    maxChannelDelta8: max
  };
}
```

固定材质开关的结果还需匿名审看完整场景；记录每个审阅者的偏好/并列和具体视图。单评审结果是方向性证据，不给统计置信；多名评审仍不能把多视图当成独立作品样本。像素RGB不是感知色差，也不跨不同renderer/曝光比较。

| 实验 | 控制条件 | 可支持结论 |
|---|---|---|
| 机制/模块对照 | 相同参考和上游数据，固定非测试变量 | 当前计算、接线或构造方法是否有效 |
| 完整端到端对照 | 同题/范围、模型/推理档、工具权限、依赖与资源上限；每次独立从零 | Skill及随包能力能否稳定提高完整交付 |

自主制作两版都可在同权限与预算下获取参考；只给新版额外优质输入时另记变量。新版若同时增加文档和工具，先称整体收益；归因其中某项需抽样消融。可按预定预算自查迭代，但盲评后不替换为定向打磨结果，失败和超时保留在分母。

建议先4题材×2版本×2独立重复=16个完整项目筛查；需要确认泛化时，用8个未参与调规则的题材×2版本×短/详细2条件×2重复=64项目，按资源分批。这是可选评测设计，不是每次制作的必要工作量。题材覆盖宏观城市、院落/园林、室内、地貌、植被、机械、连续有机体和透明反射等不同难点；不复制历史作品。短/详细条件保持同题、同范围和核心约束。

## 结果如何解释

| 指标 | 记录方式 |
|---|---|
| 正确性与交付 | 按项目记录断链、缺区域、资源/交互/输出失败，与美术评分分列 |
| 画质与稳定性 | 每题配对五项/总分差、胜平负、具体改进位置、重复波动与最弱样例 |
| 短需求与宏观 | 同题详细−短需求差距及短需求绝对质量；预定区域/地标/连接与多尺度覆盖 |
| 成本与外推 | 工具/生成/渲染预算、目标设备运行成本；题材与模型未覆盖范围 |

置信分析以题材为单位，重复生成和多机位不冒充更多独立题材。小样本给逐题结果，样本与分布允许时按题材聚类重采样给区间；两名同体系AI评审仍可能共享偏好。

确认轮开始前登记判据。可试行：已知硬错误回归通过；8个题材至少6个得到配对审图多数偏好；严重退化单列；短需求提升不靠缩范围或降低详细版质量；成本符合事先约定。该数字不是行业标准，未观察完整结果前不能声称方法保证满分。
