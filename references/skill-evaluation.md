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

全貌看焦点/区域/连接，区域看用途与层次，近景看截面/连接/材料；灰材质/侧光揭示体积，连续片段单独验证动态。默认全貌误切与正常局部观察裁切分别判断。8方位主环、实际距离/俯仰端点及有风险组合是起点，按问题补图，不把截图数量当覆盖质量。

不同设计使用同样的观察任务、视口与相对尺度，不硬套同一世界XYZ。评审只看匿名题目、图像/片段和共同标尺；版本、源码、过程与其他评审隐藏，左右顺序独立随机。先保存各自评分再汇总；明显分歧由预先约定的第三评审/人工复核，保留分歧原因。

## 从机制到完整作品

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
