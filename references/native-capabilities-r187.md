# Three.js r187 与浏览器原生配套能力

本页用于把“零外部模型/贴图/音频/CDN”的目标映射到可维护的 Three.js 工程。默认使用锁定的`three@0.187.0`、同版`examples/jsm`、浏览器原生 JavaScript/DOM/Canvas/Web Audio；项目依赖随本地交付包提供并记录版本/许可证。本Skill的程序纹理实验使用精简的本地r187运行时和OrbitControls，位于`assets/vendor/three-r187/`。它不是要求手写一个裸WebGL引擎，也不要求每个作品实现下表全部功能。

## 路由表

| 需求 | r187默认路线 | 条件/边界 |
|---|---|---|
| 顶点、材质、混合、深度和阴影 | `BufferGeometry`/内置材质/Three renderer；只在真实外观差异需要时用`ShaderMaterial`、`onBeforeCompile`或Node材质 | 让Three管理程序、VAO/VBO、状态和生命周期。不要为普通资产重写shader compiler、MVP矩阵、VAO缓存或通用WebGL封装 |
| 程序网格和形态算法 | 当前坐标/截面/轮廓/地形/连接生产器与`BufferGeometry`；用可复现参数构建，交给实际Mesh、碰撞/拾取或材质消费者 | 几何属性、UV、法线、bounds、drawRange/material groups及Float32最终网格都属于契约。SDF可用来生成网格或局部效果；默认主体需实体深度、拾取、阴影和接触时优先真实网格 |
| 程序纹理/环境 | `DataTexture`用于数值像素；`CanvasTexture`用于程序绘制和文字；`CubeTexture`/`CubeCamera`/`PMREMGenerator`用于环境采样；继续用材质和光照显示实际结果 | 区分sRGB颜色图和`NoColorSpace`标量图；先定义UV/物理尺度/方向/色彩空间，再定wrap、filter、mipmap、精度与预算。纹理不是几何位移，也不能修复轮廓。看[完整程序表面实验](../assets/examples/procedural-texture-lab/index.html)和[表面场实现](../assets/materials/surface-fields.mjs) |
| 相机、矩阵、拾取 | Three `Vector*`/`Matrix*`/`Quaternion`、`PerspectiveCamera`/`OrthographicCamera`、官方OrbitControls、Raycaster | 复用已有数学。手写只覆盖输入输出明确的局部算法，如米制距离、交点/约束或采样；不要重建gl-matrix/相机框架 |
| FBO与后期 | `WebGLRenderTarget`与官方`EffectComposer`/Pass；保留唯一输出转换和renderer状态归还 | 先由画面问题选择AO、Bloom、抗锯齿等，不堆齐暗角/DOF/色差/SSR清单。后期不能替代接触、形状和材质 |
| SDF/Raymarch | 默认由SDF/隐式场提取网格；仅对烟雾、辉光或抽象背景等确实适合全屏pass的效果考虑内联raymarch | 全屏pass需要显式深度、拾取、阴影、相交、抗锯齿、性能和多遍合成契约，不自动成为可交互Mesh |
| CPU/GPU粒子与模拟 | 固定seed和绝对时间可解析计算时优先CPU/实例化；r187 WebGL后端可按需用官方`GPUComputationRenderer`做浮点纹理片元pass ping-pong | 它不是SSBO/compute shader。按设备检查浮点纹理渲染能力、资源和重置/seek策略。TSL storage/compute与`StorageInstancedBufferAttribute`走独立`WebGPURenderer`路线，不能和WebGLRenderer API混作同一默认实现 |
| 音频 | 当前Web Audio模块提供`OscillatorNode`旋律/音调和固定seed噪声`AudioBuffer`；经Gain包络、Filter和HRTF Panner接至真实输出 | `AudioContext`必须由用户手势启动；场景事件可映射到`AudioContext.currentTime`安排；包含静音、暂停/恢复、瞬态声部上限、关闭与资源释放。Convolver/算法IR可按具体声音目标再扩展，不是当前模块能力。只在声音是交付目标时纳入验收。见[小型生成音频模块](../assets/audio/procedural-audio.mjs) |
| 碰撞、软体、流体 | 解析接触、射线/包围体、局部弹簧或场查询按可见任务实现；成熟专用库仅在工程明确允许且收益足够时选择 | 刚体、布料、NS流体、LBM不是Three.js功能，也不是所有视觉作品的默认能力。自写物理前先列出真实状态、误差容限、dt、重建/seek与性能需求 |
| 噪声、随机、颜色 | 复用现有seeded random、Value noise/fBm、颜色/插值工具，并让同一场控制布局、材质与环境 | 不为名词清单重复实现Perlin/Simplex/FBM套件。只有视觉信号或性能比较证明收益时才加新算法 |
| 输入、UI、动画与调试 | 官方OrbitControls/Three对象状态，加原生DOM控件、Pointer/Keyboard、RAF、Stats/工作台 | 监听、RAF、AudioContext、几何/材质/纹理、RT、PMREM等明确所有者及销毁顺序；可访问文本与按钮不依赖画布点击 |
| 离线交付/兼容 | 默认本地模块工程+本地静态服务；使用离线检查与浏览器断网重载 | r187`WebGLRenderer`基于WebGL2；WebGL1自r163起已不支持，因此不要承诺自动回退。单文件HTML是独立打包档；`file://`模块限制、内联体积与许可证需单独验证。必须使用Three与“绝不含第三方库”是互斥要求，先选兼容目标 |

## 纹理从设计场到实际受光

新纹理不是“生成噪声→贴上去”就完成。按下面的接口链逐段核对：

```text
可见材料差异与目标景别
  → 参数化物理场 (x/y、单位、频率、周期/边界)
  → 采样为像素数组或Canvas
  → 明确纹理格式、颜色空间、flipY、UV朝向、wrap、filter/mipmap
  → 将UV映射到有声明尺度的最终几何/切线架
  → 绑定颜色/roughness/metalness/normal等真实材质通道
  → 用指定灯光/环境、曝光和近远景渲染检查
  → 释放仅由当前材质句柄拥有的纹理和材质
```

当前`createRegionMaterial`已生成sRGB颜色与`NoColorSpace`标量贴图，将区域颜色、粗糙度、金属度和物理高度合并为实际`MeshStandardMaterial`；`createSurfaceMaps`把米制高度导数烘焙进切线空间法线。两者均须遵守其TBN/UV/带限和色彩通道边界。不得把非周期字段硬设Repeat后称为无缝，也不要对已编码相同起伏同时叠normal与bump。地图通道的读取见[运行示例](../assets/examples/procedural-texture-lab/main.mjs)。

验收分成两个问题：**技术接线**检查实际Texture/Mesh/material、UV、采样器、尺寸、颜色空间和dispose；**画面响应**检查在目标近/中/远景下是否形成正确材料身份、方向和尺度。像素发生变化只证明通道被消费，不证明质感更好。

## GPU、噪声和历史状态的分岔

- WebGL2核心不提供通用compute shader/SSBO。官方`GPUComputationRenderer`把一组RGBA浮点纹理作为状态，以片元shader计算并在两组render target间交换；它要求真实renderable float texture能力。位置/速度/寿命状态必须一起重置或重放，`time` uniform无法恢复历史。
- Three的TSL storage属性与compute节点属于WebGPU/`WebGPURenderer`路线。它有单独renderer、材质和后期接线，当前仍需单独评估目标设备和能力，不能用一个WebGL2探针代表所有机器。
- `GPUComputationRenderer`和WebGPU都不是默认答案。少量/可解析运动用CPU；只有数据量或同步吞吐说明CPU路线不足时，再测GPU路线。应记录缓冲尺寸、精度、每步读写、无效状态、资源回收和真实帧耗时。
- 体积流体、路径追踪、完整软体和大规模物理不属于“安装Three即拥有”。把算法作为独立、可测的任务适配层；限制对象、尺度、时间步、可观察误差与预算，再决定自写或采用兼容库。

## 可运行示例与范围

| 示例 | 展示内容 | 不证明 |
|---|---|---|
| [程序纹理实验](../assets/examples/procedural-texture-lab/index.html) | r187 WebGLRenderer、CPU生成DataTexture、线性/sRGB/标量通道、周期/边界采样、分辨率、UV物理tile、mipmap与实际PBR场景；还含用户手势启动/静音/暂停、空间音调与可复现噪声提示音 | 任意曲面切线正确、所有材质的通用纹理、视觉品质提升或不同设备上的音质 |
| [场景环境](../assets/rendering/scene-environment.mjs) | 程序天空、可见太阳方向、PMREM和真实材质反射 | 物理大气、动态多次反射或所有HDR环境 |
| [GPU计算官方addon](../assets/vendor/three-r187/examples/jsm/misc/GPUComputationRenderer.js) | 随包r187官方纹理计算实现 | WebGL2核心compute、TSL或任意GPU兼容性 |

所有实验使用代码生成最终纹理/几何；离线参考图不进入运行场景。每项能力的可观察演示只证明样例契约，完整作品仍按[统一验收](skill-evaluation.md)检查。
