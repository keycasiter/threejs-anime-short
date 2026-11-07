# 渲染、材质与成品表达的技术选择

用于灯光/材质升级、渲染器迁移、产品镜头或参考demo拆解。来源及固定提交见 [demo-source-atlas.md](demo-source-atlas.md)。下列API是2026-11研究快照，接入时仍以目标项目锁文件、实际安装包和能力探针为准。

## 先确定画面依赖什么，再选引擎能力

| 路线 | 成品表达依靠什么 | 适用条件与代价 |
|---|---|---|
| 烘焙场景 + unlit | 外部建模、UV、离线照明已写入颜色贴图；运行时只负责展示与局部动画 | 静态布景成本低；移动物体的动态投影、反射和受光必须另做。TSL sandbox的portal源码确实采用baked贴图，不代表所有Bruno作品都如此 |
| MatCap/风格材质 | 受控法线、材质族、定制明暗和专门阴影 | Folio 2019的MatCap与地面阴影是例子；相机空间MatCap不会自然响应真实世界光位 |
| PBR + IBL | 资产比例与边缘、合理roughness/metalness、环境反射带、接触阴影 | 适合多视角和真实材质；环境贴图不会修复缺少倒角、厚度或错误法线的模型 |
| 自定义节点/绘画管线 | 把主明暗、环境反弹色、雾、水线、描绘规则组织为统一材质/缓冲契约 | Folio 2025将地面反弹色、核心阴影与投射阴影接进材质；不能仅复制一个shader后宣称整套画风成立 |
| 路径追踪 | 多次反射、折射、间接光及累积采样 | 可用于慢速离线关键镜头；耗时、噪声、动态场景更新、收敛和导出协议均不同于实时光栅 |

路线可以混合，但需明确每层贡献。研究阶段从已有证据解释贡献；实施诊断时根据症状选择灰模、固定材质转灯或固定灯光换材质中能回答当前问题的最少干预，不固定执行整套实验。成品的主体层级、留白、反射带和细节尺度需有设计；添加更多库不会自动改善它们。

## 后端与版本是接入约束

迁移前记录：Three精确版本/单一模块实例、renderer类、实际backend、材质类型、自定义GLSL、MRT布局、后期栈、深度/透明约定、目标设备及输出格式。addons、类型包、R3F/drei、postprocessing和BVH的peer范围要逐项核对，不能把`@types/three`或devDependencies当运行版本。

| 环境 | 已确认的边界 | 实施方式 |
|---|---|---|
| 传统WebGLRenderer + GLSL | 保留已有ShaderMaterial、RawShaderMaterial、onBeforeCompile与自定义MRT契约 | 新效果先在原栈做小探针；不能把TSL compute直接放进旧GLSL链 |
| WebGPURenderer | 由`three/webgpu`导入，异步初始化；可用WebGPU或WebGL2后端 | `await renderer.init()`后检查实际backend；WebGL2回退不等于旧WebGLRenderer，也不保证任意计算节点可用 |
| 节点/TSL桥接 | r187官方示例通过`renderer.setNodesHandler(new WebGLNodesHandler())`让WebGLRenderer使用节点材质 | 这是特定版本桥接能力；不推断r180已有，不推断旧GLSL/MRT/全部TSL功能可无缝混合 |
| WebGPU后期 | 研究快照使用`RenderPipeline`、`pass`和节点输出；旧教程可能仍写`PostProcessing` | 跟随对应版本迁移指南，不能拼接不同代API；TSL旧`tslFn/timerGlobal`示例应迁移为安装版接口 |

已有成片升级时，先保留可运行基线。为新后端建立独立入口，验证初始化、一个真实材质、一个MRT消费者、一个目标效果和导出。比较输出及成本后再迁移主项目；仅初始化成功不能证明整条管线兼容。

## 色彩、曝光与后期：记录数值所处空间

常规PBR链：颜色输入解码 → Linear-sRGB工作空间 → HDR光照/合成 → 需要的tone mapping → 输出颜色空间。baseColor/emissive颜色贴图通常标sRGB；normal、roughness、metalness、AO、mask等数据贴图不做颜色解码。HDR与渲染目标按真实编码处理，不给所有texture统一设置sRGB。glTFLoader已处理多项语义，勿再覆盖。

Three原生EffectComposer中，线性中间结果通常由末端OutputPass完成tone mapping和输出转换。pmndrs/postprocessing是另一套契约：按其版本配置renderer输出、HDR buffer和ToneMappingEffect；不能机械地再塞Three的OutputPass。自定义绘画管线若有自己的曝光/输出编码，先读已有契约。

区分scene-linear效果和display-space效果：HDR阈值bloom通常需要映射前亮度，文字/颗粒可能需要显示空间；明确每个pass的输入输出。不要因某参考写了`renderOutput`就再统一追加转换。透明离屏捕获也要防止先tone map再主合成而重复映射。

最小探针：无光照纯灰色、固定曝光与分辨率，比较直出与完整后期，分别移除/重复末端转换作负对照。研究实验在r187原生composer中测得#808080直出128、正确一次转换128、缺失55、重复188；此结果验证该探针，不是所有管线都照此加pass的规则。

## PBR/环境表达与资产准备

优先把可见质量落实在资产：有读得出的轮廓、边缘厚度与法线；UV/切线正确；同一材质族的粗糙度、细节尺度、纹理密度一致。近景检查掠射反射，远景检查主次；用高roughness、单色环境和无后期版本定位问题。

`scene.background`决定看见的背景，`scene.environment`影响环境照明/反射，两者不能互相替代。光栅PBR的环境需正确预过滤（如PMREM；也可能由renderer自动处理，按版本确认），否则粗糙表面反射不成立。设计大面积亮暗反射带和主辅光关系，再调曝光；清漆、各向异性、transmission分别有额外计算与资产要求，按镜头需要启用。

读取glTF、解码器、压缩纹理、动画及资源生命周期的完整流程见 [motion-and-scale.md](motion-and-scale.md)。代码许可和HDRI/模型/纹理许可分别核对；开源展示不自动授予所有资产复用权。

## 软阴影、玻璃与反射的成本不是一个参数

| 机制 | 数据链与可迁移用途 | 失败条件及验收 |
|---|---|---|
| ContactShadows | 俯视深度捕获 → 模糊 → 地面叠加；便于建立贴地关系 | 捕获near/far、范围、分辨率影响形态；有限frames会冻结。检查移动后位置、物体离地高度和帧跳转；不替代任意场景的物理软阴影 |
| AccumulativeShadows | 多个扰动光位反复更新lightmap，形成柔和阴影 | 有历史状态；seek/换姿势后clear/reset并按固定种子重采样。temporal渐进不能直接取第一帧；动态阴影不能沿用旧姿势的累积 |
| 动态Environment | CubeCamera捕获虚拟场景供反射/照明 | drei默认frames=1可冻结；移动内容需更新策略。六向捕获有成本，避免自身反馈和错误层；离线按镜头确定更新时机 |
| 屏幕/缓冲透射 | scene捕获 → 折射投影采样；drei材料可另做背面和主buffer | 多个额外scene render；屏幕外、遮挡与多层玻璃存在信息缺口。检查厚度/IOR/法线、前后排序、重叠玻璃、相机切换和HDR；质量差时先区分几何与屏幕信息限制 |
| 平面反射 | 镜像虚拟相机 + 裁剪面 → texture投影/模糊/深度混合 | 适合近似平面，不等于任意曲面真实反射；材质类本身不自动完成相机与捕获更新。计算额外相机的draw calls，切镜后刷新 |

drei是R3F组件，`@pmndrs/vanilla`提供部分非React实现；移植时要同时适配生命周期、scene捕获和资源释放，不能只复制材质定义。多遍渲染必须保存并恢复render target、visibility、background、tone mapping等状态，失败或早退也要恢复。

## 路径追踪与异步导出

本页API和实验均为历史固定版本记录，不因技能被读取就代表重新核验。研究版本`three-gpu-pathtracer`保留根入口WebGLPathTracer和`/webgpu`入口WebGPUPathTracer；README主推新后端不代表旧入口消失。二者API、支持材质/特性和更新路径不能混用。下面为研究快照的WebGPU流程，接入仍需核对版本与支持列表。

场景在`setScene`时被捕获。相机变化调用`updateCamera`；仅对象矩阵变化调用`updateTransforms`；材质/灯光/环境变化调用对应`update*`。蒙皮、morph等实际顶点变化需按该版本重建几何场景，不能当作矩阵变化；`reset()`仅清累积，不能同步旧的几何快照。大场景可考虑`setSceneAsync`的worker BVH构建，不能只把同步调用包一层Promise。

每个输出帧的契约：

```text
absoluteTime → 完整求值姿势/矩阵 → 同步对应场景数据并使累积失效
→ 固定种子/采样预算 → 持续渲染至全部像素达标
→ 等待附加denoiser完成 → 捕获 → 才允许前进到下一帧
```

设有限`maxSamples`；该WebGPU API的`complete`包括全部像素达标和附加降噪结束，平均sample数或某次draw完成都不等于complete。无限采样时complete不会成立。等待需有超时、取消、GPU错误与失败重试边界；稳定噪声也不保证跨设备位级一致。比较几帧的单帧耗时、闪烁、折射细节、降噪残影和可接受噪声后再估全片成本。

现有`scripts/render_film.mjs`使用同步`renderAt(t)`并立即截图，**没有等待渐进收敛的协议**。路径追踪、累计阴影或异步GPU读回需要另做可await的逐帧适配器，先证明“求值→重置→收敛→捕获”完成，不能直接宣称现有导出器支持。原项目线性录制示例的`mixer.update(dt)`还需改为可随机取帧的姿势求值。
