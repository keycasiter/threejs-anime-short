# 几何、查询与渲染库的选择和接线

本分支以原生Three.js、官方addons和自有代码为基础。可引入解决实际算法缺口的库，几何仍由项目参数与代码生成；不通过库的模型加载器、资产预设或隐藏数据包导入预制3D模型。

下列选型与接线在本地交代必需知识；包的获取、已安装版本和设备支持仍按环境确认。只有核对具体版本/许可或扩展未覆盖API时再读[可选出处](source-notes.md)，普通生成方法按[本地算法](algorithm-recipes.md)执行。

## 先确认缺口，再选依赖

| 可见需求 | 优先路径与可选库 | 接入条件与实际消费者 |
|---|---|---|
| 板件上的贯穿洞/内壁 | 优先已有`Shape.holes`/带孔挤出；复杂实体布尔才评估three-bvh-csg | `Brush`/`Evaluator`读取本工程生成几何；更新世界矩阵，输出网格的内面、法线、UV和groups真实渲染；共面/退化及非封闭输入有数值边界 |
| 复杂宿主贴合、拾取、遮雨与接触 | 先用已有采样器；高密查询时评估three-mesh-bvh | 为最终几何建树，Raycaster/射线命中实际驱动位置、姿态或遮蔽；形变后按拓扑变化refit或重建，坐标和命中语义由项目负责 |
| 成套后期与效果组合 | 优先已有HDR链；postprocessing是可选替代链 | 同一锁定Three与后端，明确颜色/深度输入、透明、曝光及一次显示输出；实际pass开关进入工作台，测GPU成本与伪影 |
| 镜头与时间编排 | 现有OrbitControls/绝对时钟足够则沿用；复杂过渡可用camera-controls、GSAP | 相机只有一个控制者；控制器需适配snapshot/restore，时间线从绝对时间求值，不能把必要状态只放触发回调 |
| 需要可见碰撞/关节/堆叠 | 解析运动优先；确需动力学时评估Rapier | 代码创建刚体与碰撞体，固定步长后同步真实mesh；暂停、重置和历史重放明确，WASM与worker纳入依赖 |
| React工程中的组合助手 | 仅既有React项目按需使用R3F/Drei | 使用相机/光照/交互助手，不启用预制模型加载路线；React/Fiber/Three配套锁定，避免双循环与共享资源误释放 |

高质量静帧/专门渲染分支可研究three-gpu-pathtracer，但其不同版本/入口涉及WebGL与WebGPU、Three/BVH peer范围和采样成本。不能按新README直接接入当前已验证r187链。先锁可安装版本，核对对应源码、后端、场景更新与资源支持，再单独验证；不自动升级整个项目或把渐进静帧结果称为实时动态通过。

GUI只负责调参入口；同一值必须写到真实几何、材料、uniform或pass。已有工作台满足需要时不为库数量增加依赖。以上外部库是选择方向，Skill没有随包提供这些库的完整适配器或验证所有版本组合。

路网/局部语法、分枝/实体、侵蚀/散布、水面与运动的选型和参数读[算法配方](algorithm-recipes.md)，真实参数更新读[参数设计](parameter-design.md)。优先使用当前随包实现或最小适配；不将历史教学工程、完整游戏、样本模型/图块、DCC模块资产与算法本身一并迁入。Three版本、shader后端与许可按实际采用的固定版本核对。

## 接线SOP

1. **写出具体缺口与候选算法。** 例如“带倒扣的实体切口需要可见内壁”，而不是“加高级建模库”。简单Shape挤出已能成立时保留它。
2. **锁实际运行组合。** 核对已安装版本、peer dependencies、renderer后端、模块实例及官方对应版本文档；依赖代码/wasm可用不代表某个API或后端可用。
3. **明确输入与输出。** 几何/坐标/单位/材料槽/时间由谁提供，输出如何进入Mesh/Material/真实状态；库只处理声明的责任层。
4. **做一个完整代表关系。** 包含真实几何、邻接对象、材料和目标受光；连接尺寸可变时实际扰动参数，确认对象间接口仍正确。
5. **再决定缓存、预算和扩展。** 静态布尔在构造时计算，BVH按真实变更更新；不把昂贵算法无条件放进帧循环。测创建/更新时间与运行画面，失败记录明确。

## 实体布尔的最小接线

three-bvh-csg的主要对象是`Brush`（带几何/材料的操作数）、`Evaluator`与运算常量。已查0.0.18要求Three≥0.179与匹配BVH；此处为该API族的接线说明，未随Skill安装/运行全部版本。先以代码创建有效闭合操作数，简单墙洞继续使用已有Shape.holes。

```js
import {Brush,Evaluator,SUBTRACTION} from 'three-bvh-csg';
// authored*和材料由本项目代码提供；克隆避免操作数缓存影响共享原型。
const a = new Brush(authoredSolidGeometry.clone(), solidMaterial);
const b = new Brush(authoredCutGeometry.clone(), cutMaterial);
a.updateMatrixWorld(true); b.updateMatrixWorld(true);
const result = new Evaluator().evaluate(a, b, SUBTRACTION);
scene.add(result);
// 退出时由拥有者释放结果及操作数自有geometry；借用material保留。
```

操作数先在明确局部/世界架中放置，缩放与退化面可能影响求交；结果需检查切口、内面、UV、材质groups、共面薄片与单面朝向。改变操作数几何要使库缓存失效或重建操作数，不能只改一个尺寸标签。静态对象构建时求解并缓存，真实活动件保持独立。布尔不自动生成漂亮倒角、材料接缝或功能端口。

## BVH查询的最小接线

已有Three.Raycaster可直接查真实mesh，不需要先给geometry调用一个未安装的方法。高密反复查询才引入three-mesh-bvh；下面显式建树并在该目标上替换raycast，不要求修改全局prototype。已查0.9.18的peer支持Three≥0.159；构建策略/叶大小等优化按实际版本读包，先使用默认行为。

```js
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
// target为本项目静态Mesh；共享geometry需要先明确树与index的所有权。
const previousRaycast=target.raycast;
target.geometry.boundsTree=new MeshBVH(target.geometry);
target.raycast=acceleratedRaycast;
scene.updateMatrixWorld(true);
const hit=raycaster.intersectObject(target,false)[0];
if(hit){
  const local=hit.point.clone(); // Raycaster命中点是世界坐标。
  attachment.parent.updateWorldMatrix(true,false);
  attachment.parent.worldToLocal(local);attachment.position.copy(local);
}
// 顶点改变且拓扑未变：target.geometry.boundsTree.refit();
// index/拓扑改变：重建树；退出时恢复previousRaycast并释放/移除自有树引用。
```

例中attachment需要已有parent且父变换可逆；实例、蒙皮或shader形变分别核对所用版本查询能力。命中驱动的姿态、足迹和接触厚度仍按对象求解，一个点不能证明整个底面被支承。拓扑变更后仅refit不足，树引用存在也不证明与当前几何一致。

## 其他条件库的本地使用边界

| 能力 | 最小实施顺序 | 需要按已安装版本确认的部分 |
|---|---|---|
| 后期组合 | 准备线性颜色/深度→Render类pass→效果→唯一显示输出→resize/dispose；先用已有HDR模块 | 第三方composer/effect接口、深度纹理与透明、Three peer；不要与现有composer叠出第二次tone mapping |
| 相机/时间线 | 保留一个相机写入者，显式目标/位置/阻挡/平滑；snapshot/restore含目标与惯性；时间线按绝对时刻求值 | camera-controls平滑时间以秒计，colliderMeshes默认空；四角射线限透视路线且非完整体积碰撞。回调驱动的历史不能靠seek恢复 |
| 刚体 | 初始化WASM/世界→代码生成刚体/碰撞体→固定步累积器→step→位置/四元数同步mesh；记录输入并完整reset重放 | 包的init/类型与npm版本、碰撞体支持、CCD/尺度/事件。多个渲染帧不得重复消费同一物理步 |
| React助手 | 既有React工程内组合相机/灯光/生命周期，保留唯一帧循环与资源所有权 | Fiber/Drei/Three版本配套；不引入示例模型或让助手隐式接管相机 |
| 渐进路径追踪 | 单独分支建立场景表示→累计样本→改变相机/材质/几何时重置累计→记录采样与完成状态 | renderer后端、包版本/peer、动态材质与透明支持、收敛成本；不把静帧累计称为实时动画 |

输入/构建方式或版本变化后检查实际消费者与目标画面；上述接法是本地指导，第三方集成的运行结论只来自本项目真实小样。

## 与参考学习的关系

射击参考的可迁移能力是构造语法、同源字段、批次/资源、环境与动作的组织。通用库可以承接其中的算法工作，美术与空间设计仍由新题材决定。复用第三方代码保留许可；参考中的模型数据、贴图资产或专用场景代码不因公开展示就成为本分支的素材。
