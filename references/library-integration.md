# 几何、查询与渲染库的选择和接线

本分支以原生Three.js、官方addons和自有代码为基础。可引入解决实际算法缺口的库，几何仍由项目参数与代码生成；不通过库的模型加载器、资产预设或隐藏数据包导入预制3D模型。

## 先确认缺口，再选依赖

| 可见需求 | 优先路径与可选库 | 接入条件与实际消费者 |
|---|---|---|
| 板件上的贯穿洞/内壁 | 优先已有`Shape.holes`/带孔挤出；复杂实体布尔才评估[three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | `Brush`/`Evaluator`读取本工程生成几何；更新世界矩阵，输出网格的内面、法线、UV和groups真实渲染；共面/退化及非封闭输入有数值边界 |
| 复杂宿主贴合、拾取、遮雨与接触 | 先用已有采样器；高密查询时评估[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | 为最终几何建树，Raycaster/射线命中实际驱动位置、姿态或遮蔽；形变后按拓扑变化refit或重建，坐标和命中语义由项目负责 |
| 成套后期与效果组合 | 优先已有HDR链；[postprocessing](https://github.com/pmndrs/postprocessing)是可选替代链 | 同一锁定Three与后端，明确颜色/深度输入、透明、曝光及一次显示输出；实际pass开关进入工作台，测GPU成本与伪影 |
| 镜头与时间编排 | 现有OrbitControls/绝对时钟足够则沿用；复杂过渡可用[camera-controls](https://github.com/yomotsu/camera-controls)、[GSAP](https://gsap.com/docs/v3/GSAP/Timeline/) | 相机只有一个控制者；控制器需适配snapshot/restore，时间线从绝对时间求值，不能把必要状态只放触发回调 |
| 需要可见碰撞/关节/堆叠 | 解析运动优先；确需动力学时评估[Rapier](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) | 代码创建刚体与碰撞体，固定步长后同步真实mesh；暂停、重置和历史重放明确，WASM与worker纳入依赖 |
| React工程中的组合助手 | 仅既有React项目按需使用[R3F](https://r3f.docs.pmnd.rs/getting-started/introduction)/[Drei](https://github.com/pmndrs/drei) | 使用相机/光照/交互助手，不启用预制模型加载路线；React/Fiber/Three配套锁定，避免双循环与共享资源误释放 |

高质量静帧/专门渲染分支可研究[three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)，但其不同版本/入口涉及WebGL与WebGPU、Three/BVH peer范围和采样成本。不能按新README直接接入当前已验证r180链。先锁可安装版本，核对对应源码、后端、场景更新与资源支持，再单独验证；不自动升级整个项目或把渐进静帧结果称为实时动态通过。

GUI只负责调参入口；同一值必须写到真实几何、材料、uniform或pass。已有工作台满足需要时不为库数量增加依赖。以上外部库是选择方向，Skill没有随包提供这些库的完整适配器或验证所有版本组合。

## 接线SOP

1. **写出具体缺口与候选算法。** 例如“带倒扣的实体切口需要可见内壁”，而不是“加高级建模库”。简单Shape挤出已能成立时保留它。
2. **锁实际运行组合。** 核对已安装版本、peer dependencies、renderer后端、模块实例及官方对应版本文档；依赖代码/wasm可用不代表某个API或后端可用。
3. **明确输入与输出。** 几何/坐标/单位/材料槽/时间由谁提供，输出如何进入Mesh/Material/真实状态；库只处理声明的责任层。
4. **做一个完整代表关系。** 包含真实几何、邻接对象、材料和目标受光；连接尺寸可变时实际扰动参数，确认对象间接口仍正确。
5. **再决定缓存、预算和扩展。** 静态布尔在构造时计算，BVH按真实变更更新；不把昂贵算法无条件放进帧循环。测创建/更新时间与运行画面，失败记录明确。

## 两个接线轮廓

下面是外部库API的调用轮廓，需在锁定依赖的小样中补齐并验证，不是当前Skill已实现的工厂：

```js
// 复杂布尔：两份输入均由当前工程代码创建。
const a = new Brush(authoredSolidGeometry, solidMaterial);
const b = new Brush(authoredCutGeometry);
a.updateMatrixWorld(true); b.updateMatrixWorld(true);
const result = new Evaluator().evaluate(a, b, SUBTRACTION);
scene.add(result); // 继续检查内面、UV、groups、边缘与资源归属。
```

```js
// BVH：命中必须进入真实摆放，不能仅把distance写进userData。
target.geometry.computeBoundsTree(); // 按库文档安装扩展或显式建树。
const hit = raycaster.intersectObject(target, true)[0];
if (hit) attachment.position.copy(hit.point); // 此处假设attachment父坐标为世界坐标。
```

非世界父级需转换到parent局部；方向/足迹/厚度另按对象规则求解，命中一个点不能证明整个底面被支承。输入、构建方式或版本变更后重新核对调用与像素，不能把轮廓代码当成已测试能力。

## 与参考学习的关系

射击参考的可迁移能力是构造语法、同源字段、批次/资源、环境与动作的组织。通用库可以承接其中的算法工作，美术与空间设计仍由新题材决定。复用第三方代码保留许可；参考中的模型数据、贴图资产或专用场景代码不因公开展示就成为本分支的素材。
