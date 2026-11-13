---
name: threejs-anime-short
description: 用于制作、改编或打磨以 Three.js 渲染的动画短片、完整场景与交互式导览，交付可运行源码、HTML或视频；普通网页动效无需使用。
---

# Three.js 视觉作品制作

从目标画面反推设计与实现，以可复用生成器完成全场的形体、连接、表面、光影与动态。先做好一个完整代表关系，再依同一套规则扩展；主体、支撑和环境都达到各自目标景别。

本分支以**代码生成三维**：Three.js构造器、自写网格/曲面/场、几何算法库与shader。图像用于视觉参考；预制模型及其压缩数组/base64形式不作为几何来源。最终交付可重新生成的源码与真实渲染结果。

## 从当前任务进入

| 请求 | 执行入口 |
|---|---|
| 新作品 | 读[唯一生产流程](references/production-workflow.md)，按依赖完成设计、全场草案、完整代表关系、扩场、统一表现与交付 |
| 修改已有作品 | 打开当前入口和画面，按缺陷进入下表对应模块；保留仍有效的布局、生成器与参数 |
| 计划或局部机制 | 交付请求范围的可执行方案/实验；未实施的函数与未检查的效果明确标注 |
| 研究参考实现 | 读[研究方法](references/research-methods.md)，沿输入→生成/更新→消费者→实际画面解释机制，再设计通用迁移方法 |

继承用户已选方向与约束。短需求由Agent补成具体设计，不把缺少长提示词当成省略环境、结构和细节的理由。自由交互场景默认水平360°环绕、合理俯仰、缩放与复位；影片使用导演相机，两者并存时分别管理状态。

选生成器、接模块或实现结构重建时，先读[实现基础](references/implementation-foundations.md)。写代码前，为每个关键对象留一行实现契约：**可见/功能特征 → 表示及换路条件 → 稳定输入/坐标架 → 真实消费者 → 参数变化后的重建范围 → 资源所有者/释放顺序**。输入必须实际控制生成器；表面、端口、附件和材质字段必须由真实几何/状态产生并交给明确消费者；共享资源标为借用，不重复释放。无需为这行契约另造一套JSON审批表或全局依赖图。指南中的[运行例](assets/examples/foundation-lab/index.html)把回转壳与弯轴放样接到真实网格、表面查询、附件、同步替换、失败回退和显式资源scope；先运行、再按当前对象替换设计参数。已有工具和待开发能力分开选择。涉及方向/坐标运算、扇区、静态面积、路径距离或旋转顺序时，读[空间操作](references/spatial-operations.md)的完整本地ESM，先核对度量空间和副作用。

制作任意截面/闭合凸边界口沿/曲壳/融合体、分层区域或统一PBR/分段受光时，读[核心三线接力](references/core-systems.md)，按视觉标尺进入对应真实生成器，并在[完整空间入口](assets/examples/core-lab/index.html)核对几何—世界—材光的消费链；原例的布局/数值只作方法演示。

开始写空间、资产、分布或动态函数时，进入[Three.js代码接力](references/code-guidance.md)对应小节：先把设计关系写成实际输入，再沿可运行配方接到网格、端口、材料或更新函数。随包[完整工厂](assets/examples/guided-assembly.mjs)和[运行入口](assets/examples/guided-world/index.html)展示主形/邻件/受光的同源实现；新题材替换设计和生成规则，保留适用接口。参数或动作接好即读回实际消费者，再扩展同族对象。

空间草案先按[观看与遮挡](references/visual-construction.md#1-先让关键部位能被看清)让目标部位和支撑/框架同时成立；重复铺覆、同族资产与近景曲面开工前，分别用该页的完整轮廓裁切、结构变体与采样配方。材料先在真实资产/邻件的同机位中校准再扩场；界面文字与合法近景共同设计。工具定位具体损失，目标视图中的可读性与完成度决定是否进入下一段制作。

## 按责任读取

| 当前工作 | 方法 | 可执行能力 |
|---|---|---|
| 参考、宏微观拆解、短需求到规格 | [视觉设计](references/visual-design.md) | 总图/剖面、对象族、特征到构造与目标视图 |
| 构图、白模、完整世界与多尺度 | [空间搭建](references/scene-layout.md)；生成图/街区/房间时读[算法配方](references/algorithm-recipes.md#世界连接图与局部语法) | 共享布局/表面、可调用连接图/地块、区域与近中远规则 |
| 主形、中层、厚度/开口、连接与资产工厂 | [构造方法](references/procedural-construction.md)；[几何配方](references/geometry-recipes.md) | [截面工具](references/profile-geometry.md)、[开间样件](assets/examples/procedural-bay.mjs)、端口/静态装配 |
| 群体与具体资产细节 | [分布方法](references/detail-distribution.md)；[表面方法](references/surface-detail.md) | 原型/实例、实际宿主/完整足迹、区域与米制通道 |
| 材光、反射、后期与自写效果 | [渲染选择](references/rendering-choices.md)；[效果配方](references/effect-recipes.md) | 自定义多遍时再读[渲染契约](references/render-contracts.md) |
| 动作、资源、预算与交互 | [运行与规模](references/motion-and-scale.md)；[相机方法](references/camera-interaction.md) | 绝对时间/历史重建、真实接触、交互与观看范围 |
| 复用现有模块或补算法 | [工具目录](references/production-toolkit.md)；[算法配方](references/algorithm-recipes.md)；[条件库接线](references/library-integration.md) | 随包实现与需适配方法分明，按结构、场、运动与规模选择 |
| 最终检查与交付 | [统一验收](references/validation.md)；影片再读[导出方法](references/video-export.md) | HTML依赖、真实操作、接触粗检、视频导出与独立后验 |

按需读相关小节，已有工具先确认输入输出与版本，未实现的项目函数不当作现成API。品质依据是目标与当前真实画面：字段齐全、工具通过或参考好看均不等于作品达标。只交用户要求的阶段或成品；制作时使用简明brief、共享数据、源码和问题/验证记录。

制作知识优先读取本地方法：空间图/约束见[空间算法](references/world-methods.md)，地形/枝条/散布见[自然形态](references/nature-methods.md)，波面/约束/群体见[水与运动](references/water-motion-methods.md)。按当前任务选择小节，包含计算与结束条件；[外部出处](references/source-notes.md)仅在核来源、具体依赖版本/授权或补充研究时读取，普通执行无需先打开外部教程。

从参考特征进入生成器前，按[参数设计](references/parameter-design.md)给主轮廓、内部分段与连接独立控制量，明确单位、实际消费者及更新依赖。先选能够表达目标的表示，再调结构与形成规则；段数、噪声层数和实例数负责采样/规模，不能替代美术设计。

修改或发布本Skill时读取[维护约定](AGENTS.md)。
