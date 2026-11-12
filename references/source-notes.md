# 可选出处与版本查证

本页是来源目录，制作时优先读取本地方法，不把本页作为算法教学入口。需要核对作者、特定依赖版本/API、许可或继续研究时才打开外链。

## 本地制作入口

| 所需内容 | 本地指导 |
|---|---|
| 世界图、方向场、交点/地块、房间、WFC、导航 | [空间方法](world-methods.md) |
| 地貌/侵蚀、分级枝条、冠层、Poisson/生境 | [自然形态](nature-methods.md) |
| 多波求值/浮物、FFT数据链、约束绳布、群体/IK | [水与运动](water-motion-methods.md) |
| 可调用工具/参数/第三方适配 | [工具](production-toolkit.md)、[参数](parameter-design.md)、[接线](library-integration.md) |
| 材质/光照/反射/后期 | [表面](surface-detail.md)、[渲染](rendering-choices.md)、[效果](effect-recipes.md) |

## 来源与适用范围

以下保留原有74个不同链接的出处。算法研究中已核过的实现以固定提交/本地原始证据为依据，专题是原创归纳，没有镜像上游全文、模型或受限代码。动态主页及历史教程链接不代表对当前发布版本的重新运行验证；实际引库时核对锁定版本和安装包，r180/WebGL与新TSL/WebGPU分别处理。

LYGIA与Book of Shaders的当前授权不按MIT处理，只作阅读/方法出处；WFC示例图块、软体tetMesh与完整游戏的模型/贴图不属于本分支的几何来源。许可随实际复用代码处理，不因存在链接就取得资产复用权。

| 原始来源 | 本地方法落点 |
|---|---|
| [lil-gui](https://github.com/georgealways/lil-gui) | [parameter-design](parameter-design.md) |
| [Tweakpane](https://github.com/cocopon/tweakpane) | [parameter-design](parameter-design.md) |
| [UV与表面坐标 / UV](https://www.webgl3d.cn/pages/71e307/) | [surface-detail](surface-detail.md)、[research-methods](research-methods.md) |
| [PBR金属/粗糙度 / PBR](https://www.webgl3d.cn/pages/ca9079/) | [surface-detail](surface-detail.md)、[research-methods](research-methods.md) |
| [环境反射](https://www.webgl3d.cn/pages/780376/) | [surface-detail](surface-detail.md)、[research-methods](research-methods.md) |
| [阴影覆盖与分辨率](https://www.webgl3d.cn/pages/547403/) | [surface-detail](surface-detail.md) |
| [Material状态](https://threejs.org/docs/pages/Material.html) | [rendering-choices](rendering-choices.md) |
| [官方材质说明](https://threejs.org/docs/pages/MeshPhysicalMaterial.html#transmission) | [rendering-choices](rendering-choices.md) |
| [MapGenerator方向场/地块](https://github.com/ProbableTrain/MapGenerator) | [algorithm-recipes](algorithm-recipes.md) |
| [道路生长](https://github.com/josauder/procedural_city_generation) | [algorithm-recipes](algorithm-recipes.md) |
| [ROT房间/走廊](https://github.com/ondras/rot.js) | [algorithm-recipes](algorithm-recipes.md) |
| [MarkovJunior分阶段重写](https://github.com/mxgmn/MarkovJunior) | [algorithm-recipes](algorithm-recipes.md) |
| [WFC](https://github.com/mxgmn/WaveFunctionCollapse) | [algorithm-recipes](algorithm-recipes.md) |
| [JS port](https://github.com/kchapelier/wavefunctioncollapse) | [algorithm-recipes](algorithm-recipes.md) |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | [algorithm-recipes](algorithm-recipes.md)、[library-integration](library-integration.md) |
| [Manifold](https://github.com/elalish/manifold) | [algorithm-recipes](algorithm-recipes.md) |
| [参数曲面](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/geometries/ParametricGeometry.js) | [algorithm-recipes](algorithm-recipes.md) |
| [函数形体](https://github.com/hofk/THREEf.js) | [algorithm-recipes](algorithm-recipes.md) |
| [Mapgen4](https://github.com/redblobgames/mapgen4) | [algorithm-recipes](algorithm-recipes.md) |
| [THREE.Terrain](https://github.com/IceCreamYou/THREE.Terrain) | [algorithm-recipes](algorithm-recipes.md) |
| [Beyer水蚀](https://github.com/tessapower/hydraulic-erosion) | [algorithm-recipes](algorithm-recipes.md) |
| [SebLague水蚀](https://github.com/SebLague/Hydraulic-Erosion) | [algorithm-recipes](algorithm-recipes.md) |
| [ez-tree](https://github.com/dgreenheck/ez-tree) | [algorithm-recipes](algorithm-recipes.md) |
| [proctree](https://github.com/supereggbert/proctree.js) | [algorithm-recipes](algorithm-recipes.md) |
| [CodingTrain](https://github.com/CodingTrain/Coding-Challenges) | [algorithm-recipes](algorithm-recipes.md) |
| [vegetation](https://github.com/yomotsu/vegetation) | [algorithm-recipes](algorithm-recipes.md) |
| [Poisson](https://github.com/kchapelier/poisson-disk-sampling) | [algorithm-recipes](algorithm-recipes.md) |
| [polylabel](https://github.com/mapbox/polylabel) | [algorithm-recipes](algorithm-recipes.md) |
| [d3-delaunay](https://github.com/d3/d3-delaunay) | [algorithm-recipes](algorithm-recipes.md) |
| [psrdnoise](https://github.com/stegu/psrdnoise) | [algorithm-recipes](algorithm-recipes.md) |
| [webgl-noise](https://github.com/stegu/webgl-noise) | [algorithm-recipes](algorithm-recipes.md) |
| [LearnOpenGL](https://github.com/JoeyDeVries/LearnOpenGL) | [algorithm-recipes](algorithm-recipes.md) |
| [LYGIA](https://github.com/patriciogonzalezvivo/lygia) | [algorithm-recipes](algorithm-recipes.md) |
| [Book of Shaders](https://github.com/patriciogonzalezvivo/thebookofshaders) | [algorithm-recipes](algorithm-recipes.md) |
| [dli/waves](https://github.com/dli/waves) | [algorithm-recipes](algorithm-recipes.md) |
| [tuxalin/water-shader](https://github.com/tuxalin/water-shader) | [algorithm-recipes](algorithm-recipes.md) |
| [webgl-water](https://github.com/evanw/webgl-water) | [algorithm-recipes](algorithm-recipes.md) |
| [FFT-Ocean](https://github.com/gasgiant/FFT-Ocean) | [algorithm-recipes](algorithm-recipes.md) |
| [jbouny/ocean](https://github.com/jbouny/ocean) | [algorithm-recipes](algorithm-recipes.md) |
| [Nature of Code](https://github.com/nature-of-code/noc-book-2) | [algorithm-recipes](algorithm-recipes.md) |
| [fullik](https://github.com/lo-th/fullik) | [algorithm-recipes](algorithm-recipes.md) |
| [closed-chain-ik](https://github.com/gkjohnson/closed-chain-ik-js) | [algorithm-recipes](algorithm-recipes.md) |
| [Matthias教学](https://github.com/matthias-research/pages) | [algorithm-recipes](algorithm-recipes.md) |
| [Verlet](https://github.com/subprotocol/verlet-js) | [algorithm-recipes](algorithm-recipes.md) |
| [Cannon](https://github.com/pmndrs/cannon-es) | [algorithm-recipes](algorithm-recipes.md) |
| [Rapier](https://github.com/dimforge/rapier) | [algorithm-recipes](algorithm-recipes.md) |
| [Yuka](https://github.com/Mugen87/yuka) | [algorithm-recipes](algorithm-recipes.md) |
| [three-pathfinding](https://github.com/donmccurdy/three-pathfinding) | [algorithm-recipes](algorithm-recipes.md) |
| [Recast](https://github.com/isaac-mason/recast-navigation-js) | [algorithm-recipes](algorithm-recipes.md) |
| [camera-controls](https://github.com/yomotsu/camera-controls) | [algorithm-recipes](algorithm-recipes.md)、[library-integration](library-integration.md) |
| [BVH / three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | [algorithm-recipes](algorithm-recipes.md)、[library-integration](library-integration.md) |
| [RBush](https://github.com/mourner/rbush) | [algorithm-recipes](algorithm-recipes.md) |
| [Flatbush](https://github.com/mourner/flatbush) | [algorithm-recipes](algorithm-recipes.md) |
| [WebGL2数据流教学](https://github.com/gfxfundamentals/webgl2-fundamentals) | [algorithm-recipes](algorithm-recipes.md) |
| [instanced-mesh](https://github.com/agargaro/instanced-mesh) | [algorithm-recipes](algorithm-recipes.md) |
| [逆转置矩阵](https://threejs.org/docs/pages/Matrix3.html#method:getNormalMatrix) | [geometry-recipes](geometry-recipes.md) |
| [样条控制点](https://www.webgl3d.cn/pages/717f0f/) | [research-methods](research-methods.md) |
| [截面沿路径扫描](https://www.webgl3d.cn/pages/a06aed/) | [research-methods](research-methods.md) |
| [Raycaster](https://www.webgl3d.cn/pages/a448b6/) | [research-methods](research-methods.md) |
| [场景层级拾取](https://www.webgl3d.cn/pages/dd2774/) | [research-methods](research-methods.md) |
| [Mesh数量](https://www.webgl3d.cn/pages/6f7d51/) | [research-methods](research-methods.md) |
| [纹理像素规模](https://www.webgl3d.cn/pages/d5e3f0/) | [research-methods](research-methods.md) |
| [Saltline固定源码](https://github.com/realcodebear/saltline-fable-5.2/blob/09c51774cd77aad750bd2d6c42af2b1020cb668d/index.html) | [research-methods](research-methods.md) |
| [Claude of Duty上游建筑](https://github.com/mshumer/Claude-of-Duty/blob/main/src/world/buildings.js) | [research-methods](research-methods.md) |
| [构造kit](https://github.com/mshumer/Claude-of-Duty/blob/main/src/world/kit.js) | [research-methods](research-methods.md) |
| [Reflector](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/objects/Reflector.js) | [production-toolkit](production-toolkit.md) |
| [OutputPass](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/postprocessing/OutputPass.js) | [production-toolkit](production-toolkit.md) |
| [PMREMGenerator](https://github.com/mrdoob/three.js/blob/r180/src/extras/PMREMGenerator.js) | [production-toolkit](production-toolkit.md) |
| [postprocessing](https://github.com/pmndrs/postprocessing) | [library-integration](library-integration.md) |
| [GSAP](https://gsap.com/docs/v3/GSAP/Timeline/) | [library-integration](library-integration.md) |
| [Rapier](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) | [library-integration](library-integration.md) |
| [R3F](https://r3f.docs.pmnd.rs/getting-started/introduction) | [library-integration](library-integration.md) |
| [Drei](https://github.com/pmndrs/drei) | [library-integration](library-integration.md) |
| [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) | [library-integration](library-integration.md) |
