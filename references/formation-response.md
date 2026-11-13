# 米制形成响应（Three r187 / WebGLRenderer）

`createFormationResponse(T, options)` 为原生、精确类型的 Standard、Physical、Toon 派生独立材质。部署时保持 `assets/materials` 与 `assets/geometry` 的相对目录树；不要只复制本模块而漏掉桥和坐标校验依赖。基础材质、贴图、Mesh 和 geometry 均由调用者持有。返回的 `material` 由 response 持有，`dispose()` 只释放它自身。

| 输入 | 含义与默认值 |
|---|---|
| `pattern` | `bands` 连续层纹（默认）、`fibres` 沿向弯曲纤维、`aggregate` 三维聚集变化；都是通用形成基元 |
| `space` | `attached` 默认，读取匹配的 `aFormationPosition`；`world` 使用实际 `transformed/modelMatrix` |
| `parameters.wavelengths` | 普通三元素数组，默认 `[.12,.12,.12]` 米，每轴 `.0001…1000` |
| `frameMatrix` | 默认单位 `T.Matrix4`；有限、单位刚性 affine、det +1，把所选米制坐标送入纹样架 |
| `colorLow / colorHigh` | 默认 `[.85,.85,.85] / [1.15,1.15,1.15]`，线性基色乘子，每分量 0…2；不改 alpha |
| `roughnessAmplitude` | PBR 默认 `.15`，范围 0…1；在原粗糙度贴图结果上增加 `(field-.5)*amplitude` 并 clamp；Toon 默认 0 且拒绝非零 |
| `heightAmplitude` | 默认 `.0004` 米，范围 0…`.02`，形成标量对应的峰谷高度差；仅主受光微法线，无几何位移 |
| `warp / seed` | 无量纲扰动默认 `.25`，范围 0…2；uint32 seed 默认 0，经固定模数映射到有限 GPU 哈希，存在种子碰撞，不是密码随机数 |

长度与方向从形成规律确定：层面间隔决定 bands 的 x 波长；`frameMatrix` 把形成坐标变到纹样坐标，其第一行与位置作点积，决定 bands 的层面法向。若设计提供的是纹样架到形成架的放置矩阵，先求逆再传入；不能直接把物体放置矩阵当成这里的采样变换。纤维主延伸沿 z，横截面密度由 x/y 尺度决定，沿向弯曲速率由 z 决定。聚集体三个尺度表达三轴团块大小。不应给不同形成过程统一复制一组数值。`bands + warp:0` 是可解析正弦控制。frame 平移单位是米，不能用带缩放 frame 偷换波长。

波长按所选参考系计量：`attached`使用源形成/rest坐标，随对象缩放一起拉伸；`world`使用实际世界位置，保持世界尺度。微高度则用当前view-space表面微分求斜率；米制场景与刚性相机下对应世界米数。选择前先明确要随材料拉伸还是固定在环境中。

## 消费与过滤

一个片元场复用到颜色、PBR 粗糙度和微高度。场在 pattern 坐标上按每层自身频率的导数足迹退向 `.5`；只对未过滤的纹样坐标和视空间位置取一阶屏幕导数。三线性插值噪声同时给出值和解析梯度；由三个弯曲分量的局部 Jacobian 将两条像素轴映射到扰动坐标。逐轴取扰动前后足迹的较大值，再按层过滤。求微高度斜率时固定当前像素的过滤权重，用噪声或相位的解析梯度沿两条扰动轴投影；不对过滤权重或斜率再求屏幕导数。此为有界近似，不是精确像素积分、EWA、法线方差补偿或材质全频谱模型，极端各向异性仍需真实 GPU 检查。

主法线在 native `normal_fragment_begin` 保存基准，在 `normal_fragment_maps` 后把已有 normalMap/bump 结果换成相对基准的表面梯度，再与米制高度梯度合成。使用 `-vViewPosition` 的真实两轴微分，共用一个数值尺度稳定化，同时缩放高度微分；保留两轴物理比例。高度梯度的分母显式乘 r187 `faceDirection`，与已翻面的基准法线配合，使双面材质的背面高度斜率方向也随 native bump 约定翻转；原有 normalMap/bump 的相对梯度保持原生方向。退化微分和近切平面的既有法线保留 native 结果；独立 clearcoat 法线、几何、阴影轮廓不改。保留原生 BRDF 与唯一输出转换。

## 前置校验和生命周期

显式调用 `validateMesh(mesh)`，它不赋值材质、不更新 matrixWorld，也不占有 Mesh。先由调用者更新世界矩阵。支持普通静态 Mesh 与刚性层级，包括可逆的非均匀父缩放；拒绝实例、骨骼、Batched、morph，且不覆盖实际顶点位移。检查可读有限 xyz、附着属性真实布局与数量、有限可逆世界矩阵；先检查 1…1,048,576 顶点预算，再检查 frame/波长后的每轴绝对域不超过 8192。返回分离的 `{vertexCount,domain:{min,max}}`。CPU 合格不代表 GPU 画质正确。坐标、frame、波长或世界变换变化后须重验；大世界细纹使用局部原点。

直接工厂选项和 `setParameters(patch)` 均拒绝未知的自有字段（含 symbol 和不可枚举键），xyz 数组按最初三个索引各读一次形成有界快照，不调用自定义迭代器；对完整候选先校验再写入稳定 uniform wrapper 和 Vector/Matrix；失败无半写，数值更新不改变程序身份。`pattern/space` 改变需创建兄弟变体。`inspect()` 返回分离 DTO。上游存在自定义编译/cache hook 时必须显式提供 `upstreamProgramKey`；可选 `programKey` 不替代桥中实际源码身份。释放后不能更新、校验或编译，释放幂等。

## 可直接运行的 ESM

从仓库根运行，设置 `THREE_MODULE` 为实际 Three r187 模块路径；以下代码保存在根目录 `formation-response-example.mjs` 时可原样执行。

```js
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeFormationCoordinates} from './assets/geometry/formation-coordinates.mjs';
import {createFormationResponse} from './assets/materials/formation-response.mjs';
const T=await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href);
const geometry=new T.BoxGeometry(1,.4,.3);
writeFormationCoordinates(T,geometry);
const base=new T.MeshPhysicalMaterial({color:0xb8a084,roughness:.55});
const response=createFormationResponse(T,{baseMaterial:base,pattern:'bands',space:'attached',parameters:{wavelengths:[.08,.12,.12],warp:0,heightAmplitude:.0003}});
const mesh=new T.Mesh(geometry,base);
mesh.updateMatrixWorld(true);
console.log(response.validateMesh(mesh));
mesh.material=response.material;
response.setParameters({wavelengths:[.06,.12,.12],seed:17});
console.log(response.validateMesh(mesh));
const lib=T.ShaderLib.physical;
const shader={vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader,uniforms:T.UniformsUtils.clone(lib.uniforms)};
response.material.onBeforeCompile(shader,{});
if(!shader.uniforms.frWavelengths)throw new Error('missing formation uniforms');
// This exercises native ShaderLib patching; only WebGLRenderer can prove GPU compilation.
mesh.material=base;
response.dispose();
base.dispose();
geometry.dispose();
```

## 数学依据与来源边界

- [Mikkelsen 2020, Surface Gradient Based Bump Mapping Framework](https://jcgt.org/published/0009/03/04/paper-lowres.pdf)：公式 4–7 与梯度组合的数学依据。此处独立推导/实现，不复制论文 shader。
- [PBRT: Solid and Procedural Texturing](https://www.pbr-book.org/3ed-2018/Texture/Solid_and_Procedural_Texturing)：三维程序坐标与采样过滤责任的背景；不复制 C++ 实现。
- 本地 r187 ShaderLib/ShaderChunk 与 `material-shader-bridge.mjs` 为实际插点、材质和生命周期契约。当前模块不宣称 WebGPU、变形网格、切线/clearcoat 法线全链同步或 GPU 视觉验收已完成。
