# 原理与成熟生产流程研究

适用于先学习优秀成品/行业流程、解释质感来源、选择实现路线的任务。保持研究阶段：读已有作品、帧、源码和一手制作资料，不新建试片、不修改产品代码、不启动试渲染。用户在该阶段说“继续”时继续研究；明确转入制作后才应用生产步骤。

## 学习对象的选择

按目标区分电影成片质量、Web实时约束、技术机制与公开生产流程。优先选能看到过程或实现的少量案例。SOTA作为用户的质量目标时，明确对应画风/题材/平台；不把论文新颖性、官方demo或成品截图当成统一的全行业排名。

| 一手入口 | 可学习内容 | 证据边界 |
|---|---|---|
| [Disney Look Development](https://www.disneyanimation.com/process/look-development/) | 参考与明确形状进入外观开发，形体/颜色/反射分层 | 没有专有工程，不推测完整工具实现 |
| [Disney SIGGRAPH 2024 Pipeline](https://www.disneyanimation.com/publications/a-pipeline-for-effective-and-extensible-stylization/) | 最终风格的早期预览、风格集中管理 | 摘要与完整论文/讲义分开记录 |
| [Imageworks Spider-Verse](https://www.imageworks.com/our-craft/feature-animation/movies/spider-man-spider-verse) | 艺术线条、绑定、动画节奏与FX共同设计 | 专有系统不是可直接复制的开源库 |
| [Paperman 原论文](https://media.disneyanimation.com/uploads/production/publication_asset/122/asset/pman.pdf) | 3D运动场传播2D笔触、时间一致性 | 成熟原理参考，不把年代较早的技术称为最新SOTA |
| [Blender Gold建模记录](https://studio.blender.org/blog/gold-modelling-the-boat/) | 真实参考、设计批注、曲率、按景别分配细节、实例与UV交接 | 公开说明不等于已获得全部资产 |
| [Blender Gold 笔触云层](https://studio.blender.org/blog/painting-clouds-with-brushstrokes/) 与 [破碎工具工作流](https://studio.blender.org/blog/shattered-mikassa-using-the-tools/) | 手工笔触和节点工具结合；变形边界需要debug、bake和覆盖检查 | Studio受限内容/项目生产版本与公开演示版本需分开说明 |
| [Disney《Wish》角色风格化](https://www.disneyanimation.com/publications/character-stylization-in-disney-s-wish/) | 角色造型、外观、简化几何、groom及最终合成共同承载风格 | 只读公开摘要时不声称掌握讲义细节 |
| [Blender动画流程](https://studio.blender.org/tools/pipeline-overview/shot-production/animation) 与 [Asset Pipeline](https://studio.blender.org/tools/addons/asset_pipeline) | 准备好的rig/shot、blocking/polish、任务层和发布资产 | 受限内容不绕过访问；可读索引与工程核对分别记录 |

这些入口用于定向阅读，须核对当次可访问内容；不是每次全部加载的固定资料清单。Web实现可从已有 `demo-source-atlas.md` 按目标选择，避免重复收集链接。

## 一项机制要解释到哪里

围绕“原理→作品证据→输入数据→作者工具/代码→消费者→适用条件”形成结论。先识别质量来自美术设计、资产、绑定/修形、摄影、材质或合成的哪一层；再判断哪些代码在消费这些已存在的输入。

程序化应表达可辨认的结构和设计规则。骨架、UV、材质ID、控制曲线和风格预设承载的是设计信息；函数名、顶点数量或滤镜数量不能证明信息充分。复杂模型也不必总用高密度几何：若最终表达由明确的二维绘制承担，简单三维代理也可合理；需追到最终贡献。

行业流程中的资产发布、镜头装配和评审阶段用于减少依赖反复变化。为目标任务写清各阶段需要的输入、形成的结果、消费者和判断依据。小项目可以合并岗位，仍应解决形体、表演和视觉方向这些不同问题。

行业也会迭代。区分有明确设计问题的评审与未经定位的整镜反复调参；研究任务不因此自动获得制作或实验授权。

## 从研究进入生产

阶段输入、交付物和退回规则统一见 [生产阶段](production-workflow.md#生产阶段与放行)。Lookdev要尽早供上游查看；特效消费稳定的表面/接触/时间数据；设计未定时先补输入。Three.js/GLB属于实现与资源交付选择，不能替代造型、表演和摄影。

## 建议采用的研究交付

先给证据表：确定结论、出处/函数、实际阅读范围、未知项。再解释精选案例的实现关系、路线取舍和目标题材缺口。对作者未公开的中间过程保持未知；不从运行代码推测整个DCC流程。

研究结论需要能回答：为什么该表示能表达目标形体；为什么动作/表面信息能在时间上稳定；为什么资产与镜头能复用；哪些设计输入仍未具备。若这些尚未明确，继续查源码与生产资料，不通过另造一个case来填空。

进入制作后，先以可见的设计基准和准备好的资产组织镜头，再使用 `production-workflow.md` 的生产与验收步骤。技术运行、视觉完成与跨题材能力始终分别记载。
