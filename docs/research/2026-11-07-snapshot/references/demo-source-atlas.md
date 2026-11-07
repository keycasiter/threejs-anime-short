# Three.js优秀demo与实现能力图谱

用于按能力选择源码。研究快照：2026-11；13个源码来源固定到提交，包含成品、技术demo与支持库，不能统称为13部成片。选取的174个代码/说明文件做了完整性校验；选读范围见下表，不表示每个文件或全部模块均已审查。未完整运行这些原demo，也未验收其全部画质/设备兼容性。

## 从目标进入源码

| 目标 | 优先入口 | 观察重点 |
|---|---|---|
| 整场景成品表达 | Folio 2019/2025、portal | 资产准备、材质族、构图、环境反馈和运行成本如何协同；分清烘焙/MatCap/动态节点路线 |
| 产品和真实材料 | 官方physical示例、drei、pathtracer | 环境反射带、几何厚度、接触阴影、透射信息来源与采样成本 |
| 大规模自然环境 | Folio草场、al-ro草场、SimonDev地形 | 共享高度/颜色/密度场、近远景表示、风场、LOD接缝和边界同步 |
| 人物/模拟/交互 | 官方skinning/compute、glTF viewer、BVH | 资产语义、姿势求值、历史状态、世界空间锚点、查询结构更新 |

## 固定来源与实际选读

### 官方语义与最小机制 — [mrdoob/three.js](https://github.com/mrdoob/three.js)

- 固定提交：`a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de`。dev快照package为0.187.0；实验另用npm 0.187.0。
- 实现入口：[examples/webgl_tsl_instancing.html](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/examples/webgl_tsl_instancing.html)；[src/animation/AnimationMixer.js](https://github.com/mrdoob/three.js/blob/a75739a7ae5f2c08d1d9f3e2e4ac27fdceee83de/src/animation/AnimationMixer.js)。
- 机制与边界：核对渲染后端、色彩、compute、动画与实例实现；dev提交不是稳定发行承诺。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

### 完整场景的风格一致性 — [brunosimon/folio-2019](https://github.com/brunosimon/folio-2019)

- 固定提交：`540f13573a6da282eae942a4c67335b97cd18970`。package three ^0.164.1。
- 实现入口：[src/javascript/World/Materials.js](https://github.com/brunosimon/folio-2019/blob/540f13573a6da282eae942a4c67335b97cd18970/src/javascript/World/Materials.js)；[src/javascript/World/Shadows.js](https://github.com/brunosimon/folio-2019/blob/540f13573a6da282eae942a4c67335b97cd18970/src/javascript/World/Shadows.js)。
- 机制与边界：MatCap/材质组织、地面专用阴影、实时物理；作品名称中的2019不能当依赖版本。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

### 整场景节点表达与分档 — [brunosimon/folio-2025](https://github.com/brunosimon/folio-2025)

- 固定提交：`70764a94756cc4de564e493c8ba46c4b5fe03ed1`。package three ^0.187.0。
- 实现入口：[sources/Game/Materials/MeshDefaultMaterial.js](https://github.com/brunosimon/folio-2025/blob/70764a94756cc4de564e493c8ba46c4b5fe03ed1/sources/Game/Materials/MeshDefaultMaterial.js)；[sources/Game/World/Grass.js](https://github.com/brunosimon/folio-2025/blob/70764a94756cc4de564e493c8ba46c4b5fe03ed1/sources/Game/World/Grass.js)。
- 机制与边界：追踪地面反弹/核心阴影/投射阴影及共享地形采样；Rendering、资源缓存与质量分支一并核对。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

### 烘焙布景与GPU流场 — [brunosimon/three.js-tsl-sandbox](https://github.com/brunosimon/three.js-tsl-sandbox)

- 固定提交：`29e13a8b832b127bc019882134a2a84ce4ae17d8`。选读子项目 three ^0.167.1；各目录独立。
- 实现入口：[portal-scene/src/script.js](https://github.com/brunosimon/three.js-tsl-sandbox/blob/29e13a8b832b127bc019882134a2a84ce4ae17d8/portal-scene/src/script.js)；[particles-flow-field/src/script.js](https://github.com/brunosimon/three.js-tsl-sandbox/blob/29e13a8b832b127bc019882134a2a84ce4ae17d8/particles-flow-field/src/script.js)。
- 机制与边界：前者baked颜色贴图/unlit，后者storage状态积分；旧TSL接口、issue复现目录不能直接当新版本成品模板。
- 许可：未发现根目录许可；仅研究机制，复制代码或资产前另核对；模型、贴图、字体、音频与decoder另核对。

### 产品布光/阴影/透射及生命周期 — [pmndrs/drei](https://github.com/pmndrs/drei)

- 固定提交：`bf6f4addf47467d3885de272d94ca5127f6ef68f`。peer three >=0.159，React19/R3F9；dev three ^0.159并非所有环境保证。
- 实现入口：[src/core/MeshTransmissionMaterial.tsx](https://github.com/pmndrs/drei/blob/bf6f4addf47467d3885de272d94ca5127f6ef68f/src/core/MeshTransmissionMaterial.tsx)；[src/core/AccumulativeShadows.tsx](https://github.com/pmndrs/drei/blob/bf6f4addf47467d3885de272d94ca5127f6ef68f/src/core/AccumulativeShadows.tsx)。
- 机制与边界：选读ContactShadows、Environment、useAnimations、Instances、PerformanceMonitor；提取捕获/累积/状态恢复，而非要求项目改成React。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

### 非React材质与示例装配 — [pmndrs/drei-vanilla](https://github.com/pmndrs/drei-vanilla)

- 固定提交：`28978f680f9071e4f4794611781c19f46de48e35`。包名 @pmndrs/vanilla；与drei不是同一接口。
- 实现入口：[src/materials/MeshReflectorMaterial.ts](https://github.com/pmndrs/drei-vanilla/blob/28978f680f9071e4f4794611781c19f46de48e35/src/materials/MeshReflectorMaterial.ts)；[.storybook/stories/MeshReflectorMaterial.stories.ts](https://github.com/pmndrs/drei-vanilla/blob/28978f680f9071e4f4794611781c19f46de48e35/.storybook/stories/MeshReflectorMaterial.stories.ts)。
- 机制与边界：反射材质之外还需镜像相机、裁剪、FBO与更新；选读透射/累计阴影实现和装配示例。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

### HDR后期合并与输出协议 — [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing)

- 固定提交：`a1f103559d15cf56cbcbb15d4373711b09418f3f`。package 6.39.6；独立于Three原生composer。
- 实现入口：[src/passes/EffectPass.js](https://github.com/pmndrs/postprocessing/blob/a1f103559d15cf56cbcbb15d4373711b09418f3f/src/passes/EffectPass.js)；[src/effects/ToneMappingEffect.js](https://github.com/pmndrs/postprocessing/blob/a1f103559d15cf56cbcbb15d4373711b09418f3f/src/effects/ToneMappingEffect.js)。
- 机制与边界：选读composer、bloom、selective bloom；合并compatible effects减少全屏pass，仍需核对颜色空间和帧缓冲类型。
- 许可：Zlib；模型、贴图、字体、音频与decoder另核对。

### 离线多次反射/折射与逐帧收敛 — [gkjohnson/three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)

- 固定提交：`6dcc5bee5d98824c65c883507ae0a0df1e1853f3`。package 0.0.28；当前WebGPU路线peer three >=0.187。
- 实现入口：[src/webgpu/API.md](https://github.com/gkjohnson/three-gpu-pathtracer/blob/6dcc5bee5d98824c65c883507ae0a0df1e1853f3/src/webgpu/API.md)；[example/renderVideo.js](https://github.com/gkjohnson/three-gpu-pathtracer/blob/6dcc5bee5d98824c65c883507ae0a0df1e1853f3/example/renderVideo.js)。
- 机制与边界：同时检查根WebGL与/webgpu导出、场景快照/update*、complete和denoiser；蒙皮示例与录制不能直接替代随机seek适配。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

### 查询加速与动态边界 — [gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)

- 固定提交：`7b383401ed0f57ee17ef7dc934d915330a9c1bcc`。package 0.9.18；实验使用同版本npm包。
- 实现入口：[src/core/SkinnedMeshBVH.js](https://github.com/gkjohnson/three-mesh-bvh/blob/7b383401ed0f57ee17ef7dc934d915330a9c1bcc/src/core/SkinnedMeshBVH.js)；[example/skinnedMesh.js](https://github.com/gkjohnson/three-mesh-bvh/blob/7b383401ed0f57ee17ef7dc934d915330a9c1bcc/example/skinnedMesh.js)。
- 机制与边界：静态MeshBVH与新SkinnedMeshBVH/ObjectBVH分开；选读坐标契约、refit与StaticGeometryGenerator。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

### 程序造型中的布尔结构 — [gkjohnson/three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg)

- 固定提交：`7f00d37cf6cf67ac73c3f770815d2e72636946a6`。package 0.0.18。
- 实现入口：[src/core/Evaluator.js](https://github.com/gkjohnson/three-bvh-csg/blob/7f00d37cf6cf67ac73c3f770815d2e72636946a6/src/core/Evaluator.js)；[src/core/Brush.js](https://github.com/gkjohnson/three-bvh-csg/blob/7f00d37cf6cf67ac73c3f770815d2e72636946a6/src/core/Brush.js)。
- 机制与边界：选读Evaluator/Brush与README输入限制；封闭二流形、属性、groups、矩阵和数值误差，未实测复杂布尔可靠性。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

### 真实资产的加载/检查链 — [donmccurdy/three-gltf-viewer](https://github.com/donmccurdy/three-gltf-viewer)

- 固定提交：`e10c599170ae0552fd74660bce15fbbe93f7f11a`。package 1.5.1，three ^0.176.0。
- 实现入口：[src/viewer.js](https://github.com/donmccurdy/three-gltf-viewer/blob/e10c599170ae0552fd74660bce15fbbe93f7f11a/src/viewer.js)；[src/environments.js](https://github.com/donmccurdy/three-gltf-viewer/blob/e10c599170ae0552fd74660bce15fbbe93f7f11a/src/environments.js)。
- 机制与边界：Draco/KTX2/Meshopt、包围盒构图、环境PMREM、mixer和资源释放；源码选读未等同资产加载压力测试。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

### 大规模草场的形变与透光 — [al-ro/al-ro.github.io](https://github.com/al-ro/al-ro.github.io)

- 固定提交：`820d1b16e1a3e7418d87bef77f362dc834d08551`。草场HTML固定three 0.147.0。
- 实现入口：[projects/grass/grass.js](https://github.com/al-ro/al-ro.github.io/blob/820d1b16e1a3e7418d87bef77f362dc834d08551/projects/grass/grass.js)；[projects/grass/index.html](https://github.com/al-ro/al-ro.github.io/blob/820d1b16e1a3e7418d87bef77f362dc834d08551/projects/grass/index.html)。
- 机制与边界：实例属性、四元数风、根部地形、背面法线与透光；旧色彩pow及旧API需迁移，素材不可推定授权。
- 许可：grass目录未发现专属许可，根目录未发现许可；纹理另有来源，不能推定可复用；模型、贴图、字体、音频与decoder另核对。

### 分块地形与LOD接缝 — [simondevyoutube/ProceduralTerrain_Part10](https://github.com/simondevyoutube/ProceduralTerrain_Part10)

- 固定提交：`09448f7cf6fa98a624cb50999109cafd378295a8`。源码CDN导入three@0.125。
- 实现入口：[src/terrain.js](https://github.com/simondevyoutube/ProceduralTerrain_Part10/blob/09448f7cf6fa98a624cb50999109cafd378295a8/src/terrain.js)；[src/terrain-builder-threaded-worker.js](https://github.com/simondevyoutube/ProceduralTerrain_Part10/blob/09448f7cf6fa98a624cb50999109cafd378295a8/src/terrain-builder-threaded-worker.js)。
- 机制与边界：四叉树邻接关系→边界顶点/法线插值→局部重建，worker分工；教程方法选读，不是当前可直接安装的工程模板。
- 许可：MIT；模型、贴图、字体、音频与decoder另核对。

## 如何把demo变成可迁移能力

沿“入口与版本 → 资源生成/编码 → 每帧更新 → 材质/缓冲消费者 → 状态失效 → 输出/释放”追踪。每项记录：为什么产生可见差异、哪些输入控制它、换题材需要哪些资产、在哪些条件会失败。UI包装、模型、后期、纹理和离线制作的贡献分别辨认，不能从截图反推全部技术。

研究阶段形成可迁移解释与未知项；明确获准验证/制作后，才针对尚不确定的机制采用改变尺度或输入的最小验证，再接核心镜头；不自动另造题材试片。先证明机制成立，再以实际关键帧审画质；demo原参数、随机种子、角色、配色、地形轮廓和叙事留在项目，不成为Skill默认配方。

## 已做的机制实验与范围

以npm Three 0.187.0、three-mesh-bvh 0.9.18进行8组最小实验：AnimationMixer时钟负对照；独立骨架克隆/最终蒙皮顶点/SkinnedMeshBVH.refit；实例移动包围体；静态BVH.refit；原生composer颜色转换负对照；WebGLNodesHandler节点材质；WebGPURenderer强制WebGL回退；原生WebGPU storage重置与重放。

GPU实验为自有极简场景的headless Chrome运行与数值读回，没有用生成图或目标站点截图代替运行。它们验证局部机制，未证明整部影片的画质、所有TSL节点的回退能力、真实glTF大资产、完整草场性能或pathtracer/denoiser实际导出。路径追踪等建议为固定源码分析所得，接入时需要自己的运行验证。

渲染路线与失效边界见 [rendering-choices.md](rendering-choices.md)，资产/动画/规模见 [motion-and-scale.md](motion-and-scale.md)。版本变化时重新核对入口、导出、peer与示例；旧项目日期、README最新主推路线、声明存在或单次初始化均不足以证明完整兼容。
