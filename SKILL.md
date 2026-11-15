---
name: threejs-anime-short
description: 用于制作、改编或打磨以 Three.js 渲染的动画短片、完整场景与交互式导览，交付可运行源码、HTML或视频；普通网页动效无需使用。
---

# Three.js 视觉作品制作

从目标画面反推设计与实现，以可复用生成器完成全场的形体、连接、表面、光影与动态。先做好一个完整代表关系，再依同一套规则扩展；主体、支撑和环境都达到各自目标景别。

**默认交付目标是完整的视觉作品，不是可运行白模。** 代理几何仅用于空间验证；代表对象族必须先通过[精修放行关卡](references/production-workflow.md#3-完整代表关系)，然后才扩场。扩展后，主体、支撑和环境各自按目标景别检查；全景、近景与互补方向实际未达到目标时，明确标为阶段版并继续修，不以完整流程、丰富代码或功能可用替代视觉完成。

新任务按六阶段接力，不跳到细节堆量：**视觉规格 → 全场灰盒 → 完整代表关系 → 接口闭合与区域扩建 → 全场材光/动态 → 实机验收**。每阶段都要有可供下一阶段实际消费的产物和放行证据；遇到视觉缺陷按画面关系、形体、接口、材光、细节的顺序定位。完整步骤与交接字段见[唯一生产流程](references/production-workflow.md)。

本分支以**代码生成三维**：Three.js构造器、自写网格/曲面/场、几何算法库与shader。图像用于视觉参考；预制模型及其压缩数组/base64形式不作为几何来源。最终交付可重新生成的源码与真实渲染结果。

随包当前可执行实现锁定`three@0.187.0`；项目固定Three与`examples/jsm` addons为同一精确版本。标明r180的设计快照、源码链接或历史验证仅描述其原始基线，不可当作当前运行依赖。

本分支的默认后端是r187 `WebGLRenderer`/WebGL2，配合同版官方addons与浏览器原生DOM、Canvas、Web Audio。先按[浏览器原生能力路由](references/native-capabilities-r187.md)复用已有工具，再决定是否新增局部shader或模拟器；不要把裸WebGL教学栈、WebGPU/TSL能力或未经目标设备验证的API混为同一路径。程序纹理需沿“字段→像素/颜色空间→UV尺度/采样→真实材质与光照→释放”接通；可运行示范见[程序纹理实验](assets/examples/procedural-texture-lab/index.html)。

## 从当前任务进入

| 请求 | 执行入口 |
|---|---|
| 新作品 | 先按[最终交付选择唯一主路线](references/task-routes.md)，再读[唯一生产流程](references/production-workflow.md)，按依赖完成设计、全场草案、完整代表关系、扩场、统一表现与交付 |
| 修改已有作品 | 打开当前入口和画面，按缺陷进入下表对应模块；保留仍有效的布局、生成器与参数 |
| 计划或局部机制 | 先按相应[主路线](references/task-routes.md)定位方法，保持请求范围并交付可执行方案/实验；未实施的函数与未检查的效果明确标注 |
| 研究参考实现 | 读[研究方法](references/research-methods.md)，沿输入→生成/更新→消费者→实际画面解释机制，再设计通用迁移方法 |

继承用户已选方向与约束。短需求由Agent补成具体设计，不把缺少长提示词当成省略环境、结构和细节的理由。自由交互场景默认水平360°环绕、合理俯仰、缩放与复位；影片使用导演相机，两者并存时分别管理状态。第一人称步行路线从最终可走地表推导出生点与眼高；第三人称角色控制要按[相机方法](references/camera-interaction.md#第三人称跟随相机臂扫掠绕障与平滑)将最终遮挡几何接入相机臂扫掠、净空和碰撞后的恢复。所有最终允许环绕的环境、物体或机制作品，都执行[跨路线观察覆盖接力](references/task-routes.md#非影片场景的观察覆盖接力)；360°是观看范围验收，不是把任务归类为交互导览的理由。

## 开工与最终交付门

新作品进入大规模建模前，先声明 CSS 参考视口：用户未指定时桌面采用 1280×720；作品支持窄屏时再选一个实际移动视口。锁定 Three.js/addons 版本、目标浏览器、预览入口、由谁实际打开页面以及证据保存位置。renderer 的尺寸、相机投影、几何占幅测试和浏览器截图都必须使用同一画布 CSS 矩形与 DPR；DOM 控件覆盖的区域也计入安全区。将此预检放入首个可运行切片，先在真实浏览器看见并操作代表关系，再扩展同类内容。若当前执行会话没有浏览器能力，将可访问的 localhost 预览入口交给具备 CUA 的调用端检查；macOS Codex Seatbelt 沙盒里不要从shell/Node/Playwright另起系统Chrome，按[浏览器执行通道](references/validation.md#浏览器执行通道与本地预览)使用现有CUA/内置浏览器。运行通道失败时先修复或切换本机检查路径，不用代码测试、HTML闭包或导出结果替代画面检查。可执行投影和安全区检查见[视口与画面接力](references/validation.md#视口契约与屏幕安全区)。

最终交付前，必须从准备交付的入口/文件实际运行当前构建；按任务检查完整空间与细节景别、承诺视向/状态、主要交互或完整编码影片，修复后复查受影响视图。留下绑定当前构建与目标视口的截图/片段及简明观察结论，并按[可复核证据记录](references/validation.md#可复核证据记录)关联稳定检查点、复现步骤、实际环境、观察结论和未解决问题。没有实际查看到的方向或状态明确记为未检查；未完成视觉/交互检查时可以交付可运行产物，但不能把它描述为已验收的最终视觉成品。技术通过与视觉结论分开报告。

## 按最终交付选择主路线

先依据用户最终要看的/操作的交付物选**一个主路线**，再按路线文档组合空间、构造、自然形态、材光、动态等责任模块。混合需求按“缺了哪种能力，成品就不成立”来确定主路线；同一任务不要并列启动多条完整流程。自然形态是可组合的形体/材质/动态模块，按场景尺度并入环境路线，或按对象展示路线。

| 最终交付的核心 | 主路线 |
|---|---|
| 多区域地点、城市、园林、地貌或完整环境 | [环境场景](references/task-routes.md#环境场景) |
| 单个主体及其支撑/展示空间 | [物体展示](references/task-routes.md#物体展示) |
| 零件或解剖结构随时间运动、需要解释状态关系 | [机制讲解](references/task-routes.md#机制讲解) |
| 固定时长、镜头和节奏控制的成片 | [导演短片](references/task-routes.md#导演短片) |
| 交互导航、空间/对象选择或状态操作本身是主要交付 | [交互导览](references/task-routes.md#交互导览) |

打开路线后，先建立路线指定的数据/状态契约和首个可运行切片，再按任务加入责任模块。详细顺序、当前可复用入口、验证命令和已知缺失项见[任务路由](references/task-routes.md)。环境路线的完整代码纵向样例是[山息之间](assets/examples/world-showcase/index.html)及其[场景工厂](assets/examples/environment-world.mjs)；物体路线是[精密相机影棚](assets/examples/product-showcase/index.html)及其[资产工厂](assets/examples/product-camera.mjs)；机制路线是[往复之间](assets/examples/mechanism-showcase/index.html)，交互控制与影片共用绝对时间状态。它们演示可迁移的实现接力，不规定新题材的美术风格。路线模板只是决策入口；示例实验台不是最终作品模板，不能把跑通实验称为完成作品。

选生成器、接模块或实现结构重建时，先读[实现基础](references/implementation-foundations.md)。写代码前，为每个关键对象留一行实现契约：**可见/功能特征 → 表示及换路条件 → 稳定输入/坐标架 → 真实消费者 → 参数变化后的重建范围 → 资源所有者/释放顺序**。输入必须实际控制生成器；表面、端口、附件和材质字段必须由真实几何/状态产生并交给明确消费者；共享资源标为借用，不重复释放。无需为这行契约另造一套JSON审批表或全局依赖图。指南中的[运行例](assets/examples/foundation-lab/index.html)把回转壳与弯轴放样接到真实网格、表面查询、附件、同步替换、失败回退和显式资源scope；先运行、再按当前对象替换设计参数。已有工具和待开发能力分开选择。涉及方向/坐标运算、扇区、静态面积、路径距离或旋转顺序时，读[空间操作](references/spatial-operations.md)的完整本地ESM，先核对度量空间和副作用。

制作任意截面/闭合凸边界口沿/曲壳/融合体、分层区域或统一PBR/分段受光时，读[核心三线接力](references/core-systems.md)，按视觉标尺进入对应真实生成器，并在[完整空间入口](assets/examples/core-lab/index.html)核对几何—世界—材光的消费链；原例的布局/数值只作方法演示。

世界范围很大或局部结构接近Float32精度时，不要把整场世界坐标直接写入网格。先按互相连接的空间块选择局部原点，在该块坐标中生成并验证相关几何，再用`Object3D.position`把局部网格放回场景；支承查询、标注和设计参数保持世界坐标契约。多个网格必须有可核对的共同空间变换，局部原点不能掩盖真实的轮廓塌缩或拓扑错误。地形/道路的可运行接力见[局部原点与浮点精度](references/terrain-roads.md#opt-in-constrained-triangulated-surface)。

开始写空间、资产、分布或动态函数时，进入[Three.js代码接力](references/code-guidance.md)对应小节：先把设计关系写成实际输入，再沿可运行配方接到网格、端口、材料或更新函数。随包[完整工厂](assets/examples/guided-assembly.mjs)和[运行入口](assets/examples/guided-world/index.html)展示主形/邻件/受光的同源实现；新题材替换设计和生成规则，保留适用接口。参数或动作接好即读回实际消费者，再扩展同族对象。

**首个场景切片必须先过真实运行门，再扩场。** 在目标浏览器加载实际入口、看到成功绘制的首帧，等待动画/异步资源稳定，检查页面错误与 Three.js/WebGL 控制台输出；再执行该作品核心控件并复查错误。没有首帧、画布空白、加载层未退出、未处理异常或着色器/上下文错误时，停在当前切片修复；静态语法和离线依赖通过不能替代运行放行。按[运行健康检查](references/validation.md#运行健康检查与放行门)记录可复现证据。

空间草案先按[观看与遮挡](references/visual-construction.md#1-先让关键部位能被看清)让目标部位和支撑/框架同时成立；重复铺覆、同族资产与近景曲面开工前，分别用该页的完整轮廓裁切、结构变体与采样配方。材料先在真实资产/邻件的同机位中校准再扩场；界面文字与合法近景共同设计。包含CSS2D标签或随相机移动的DOM说明时，在每个关键视图/时刻用[屏幕覆盖层审计](references/anchored-labels.md#屏幕空间审计与可见性检查)读回实际矩形，处理越界、互相遮挡和界面区冲突；该检查不能替代三维实体遮挡与画面可读性审查。工具定位具体损失，目标视图中的可读性与完成度决定是否进入下一段制作。

## 按责任读取

| 当前工作 | 方法 | 可执行能力 |
|---|---|---|
| 参考、宏微观拆解、短需求到规格 | [视觉设计](references/visual-design.md) | 总图/剖面、对象族、特征到构造与目标视图 |
| 构图、白模、完整世界与多尺度 | [空间搭建](references/scene-layout.md)；生成图/街区/房间时读[算法配方](references/algorithm-recipes.md#世界连接图与局部语法)；多区域用途需扩成完整目的地时读[活动组接力](references/world-methods.md#区域用途到完整活动组)；既有地形局部改形且需保留道路时读[约束地形](references/constrained-terrain.md)、[坡度接缝](references/terrain-interface-field.md) | 共享布局/表面、可调用连接图/地块、完整活动组候选分配与区域/近中远规则、地形/道路共形接力 |
| 主形、中层、厚度/开口、连接与资产工厂 | [构造方法](references/procedural-construction.md)；[几何配方](references/geometry-recipes.md) | [截面工具](references/profile-geometry.md)、[开间样件](assets/examples/procedural-bay.mjs)、端口/静态装配 |
| 群体与具体资产细节 | [分布方法](references/detail-distribution.md)；[表面方法](references/surface-detail.md) | 原型/实例、实际宿主/完整足迹、区域与米制通道 |
| 浏览器原生能力与r187边界 | [能力路由](references/native-capabilities-r187.md) | 复用Three.js管理的WebGL2渲染；DataTexture/CanvasTexture、官方后期/GPU计算按具体任务接入；WebAudio须由手势启动；WebGPU/TSL作为独立路径 |
| 材光、反射、后期与自写效果 | [渲染选择](references/rendering-choices.md)；[效果配方](references/effect-recipes.md)；部件/世界坐标驱动的渐变、有限扫带或径向响应读[坐标响应](references/coordinate-response.md) | 自定义多遍时再读[渲染契约](references/render-contracts.md) |
| 动作、资源、预算与交互 | [运行与规模](references/motion-and-scale.md)；[相机方法](references/camera-interaction.md)；涉及点击/选择/物体反馈时读[选择状态接力](references/selection-feedback.md)；需要空间标签时读[锚定标签](references/anchored-labels.md) | 绝对时间/历史重建、真实接触、稳定ID反馈；按尺寸语义选DOM或Sprite标签，明确批量渲染、遮挡与资源归属 |
| 复用现有模块或补算法 | [工具目录](references/production-toolkit.md)；[算法配方](references/algorithm-recipes.md)；[约束高程区与道路接力](references/terrain-grading.md)、[通用坡度接缝字段](references/terrain-interface-field.md)；[条件库接线](references/library-integration.md) | 随包实现与需适配方法分明，按结构、场、运动与规模选择 |
| 最终检查与交付 | [统一验收](references/validation.md)；运行异常检查使用[运行健康探针](assets/runtime/runtime-health-probe.mjs)；影片再读[导出方法](references/video-export.md) | HTML依赖、首帧/运行错误、真实操作、接触粗检、视频导出与独立后验 |

按需读相关小节，已有工具先确认输入输出与版本，未实现的项目函数不当作现成API。品质依据是目标与当前真实画面：字段齐全、工具通过或参考好看均不等于作品达标。只交用户要求的阶段或成品；制作时使用简明brief、共享数据、源码和问题/验证记录。

制作知识优先读取本地方法：空间图/约束见[空间算法](references/world-methods.md)，地形/枝条/散布见[自然形态](references/nature-methods.md)，波面/约束/群体见[水与运动](references/water-motion-methods.md)。按当前任务选择小节，包含计算与结束条件；[外部出处](references/source-notes.md)仅在核来源、具体依赖版本/授权或补充研究时读取，普通执行无需先打开外部教程。

从参考特征进入生成器前，按[参数设计](references/parameter-design.md)给主轮廓、内部分段与连接独立控制量，明确单位、实际消费者及更新依赖。先选能够表达目标的表示，再调结构与形成规则；段数、噪声层数和实例数负责采样/规模，不能替代美术设计。

修改或发布本Skill时读取[维护约定](AGENTS.md)。
