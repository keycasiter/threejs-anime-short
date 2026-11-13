# 原生PBR通道与单位（r187）

选择 Standard/Physical 表达涂层、纤维、金属或体积透射时，先把目标信号落实到下表的实际消费者，再制作程序数据。这里是锁定 r187 WebGLRenderer 的内置约定；Toon 和自写 ShaderMaterial 依自己的接口工作。参数启用、有效 UV/切线、光源/环境及最终景别共同决定效果，存在某个字段不等于相应材料已经成立。

## 基础表面

| 信号 | 实际输入与通道 | 制作含义 |
|---|---|---|
| 颜料与自发光颜色 | `map.rgb`、`emissiveMap.rgb` 为颜色；通常标 `SRGBColorSpace`，由输入链解码 | 与对应color/emissive及强度相乘，黑色emissive不会因贴图自动发光；高光/投影/AO分别处理，uniform Color已在工作空间时不再解码 |
| 粗糙与金属比例 | `roughness * roughnessMap.g`、`metalness * metalnessMap.b`，数据图 `NoColorSpace` | 标量是乘数；图有变化而标量为0时该输入仍为0，BRDF还会施加自身下限/几何粗糙度 |
| 间接遮蔽 | `aoMap.r`，强度1时 R=1不遮蔽、R=0全遮蔽间接项 | 不把镜像教材中相反的白黑解释带入实现；不改变轮廓或替代真实接触阴影 |
| 覆盖/不透明度 | 颜色图 alpha 与 `alphaMap.g` 乘到表面alpha；alphaMap是数据图 | `alphaMap`读取G，不能凭名称只写A；混合、alphaTest、深度写和排序另按[透明契约](rendering-choices.md#薄层与透射先选一种表示)选择 |
| 微法线与高度 | normal图 RGB 编码方向，`normalMapType`决定切线/对象空间；bump图R为高度信号 | 坐标/度量/TBN按[表面场](surface-detail.md)校准。native bumpScale不是自动几何厚度；需要米制形成高度时用[形成响应](formation-response.md)，主层与clearcoat法线分别处理 |

## Physical 的独立层

### 涂层、薄膜与镜面

| 层 | 实际输入 | 边界 |
|---|---|---|
| clearcoat | `clearcoatMap.r`调强度；`clearcoatRoughnessMap.g`调粗糙；独立`clearcoatNormalMap.rgb` | 主表面法线变化不自动进入涂层法线，分别设计两层凹凸；强度/粗糙标量仍相乘 |
| dielectric specular | `specularColorMap.rgb`为颜色；`specularIntensityMap.a`为原始数据 | `reflectivity`与`ior`有关，二者不是互相独立的高光旋钮；metalness为1时介质reflectivity不控制金属反射 |
| iridescence | `iridescenceMap.r`调强度；`iridescenceThicknessMap.g`在厚度区间两端之间插值 | 薄膜厚度按nm约定，r187相位计算乘`1e-9`；不是下节mesh-space的体积thickness，也不是增加几何薄壳 |

### 纤维与方向性

| 层 | 实际输入 | 制作条件 |
|---|---|---|
| sheen | `sheenColorMap.rgb`为颜色；`sheenRoughnessMap.a`为数据 | 颜色图与粗糙图使用不同解码；sheen是光学层，不生成绒毛几何 |
| anisotropy | `anisotropyMap.rg * 2 - 1`给切平面方向，B调强度；再与旋转/强度组合 | 需要有效的表面方向架。RG不要编码成零向量；旋转纹样不等于改变BRDF方向，也不能给无参数曲面只开字段就认定方向正确 |

### 透射与体积

| 输入 | 单位/通道 | 实际作用 |
|---|---|---|
| transmission | `transmissionMap.r`乘强度，数据图 | 启用时按内置路径使用`opacity:1`；完整薄层/反射/排序见[透明与体积](rendering-choices.md#薄层与透射先选一种表示) |
| thickness | `thicknessMap.g * thickness`，mesh坐标单位 | shader再按modelMatrix轴尺度近似形成透射射线；不会从任意封闭模型自动解真实背面厚度，非均匀缩放和复杂内腔需另校准 |
| attenuation | `attenuationDistance`用世界单位，须大于0；Infinity表示不做该距离吸收；`attenuationColor`是到该距离后的白光颜色 | 米制场景中distance才对应米；缩放对象后不要把mesh厚度和世界吸收距离一起随意乘同一数。基色也参与透射乘色，避免多处重复压暗 |

同一ORM数据图可按R/G/B分别供AO/roughness/metalness，但UV、权重与采样设置须满足每个实际消费者。A可以存另一个兼容数据通道，不能因此默认它是透明度；每个map的绑定决定读取哪个通道。

## 完整程序数据例：把粗糙度写到A

在项目根执行以下ESM。安装`three@0.187.0`，或令`THREE_MODULE`指向该版本的`build/three.module.js`。例子连接真实Physical材质；CPU检查只证明字段/数据与归属，最终受光仍需在实际场景验证。

```js
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T=process.env.THREE_MODULE
  ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href)
  : await import('three');
const roughnessData=new T.DataTexture(new Uint8Array([0,0,0,153]),1,1,T.RGBAFormat);
roughnessData.colorSpace=T.NoColorSpace;roughnessData.needsUpdate=true;
const material=new T.MeshPhysicalMaterial({color:0xd8c8b8,roughness:.6,
  sheen:1,sheenColor:0x965749,sheenRoughness:1,sheenRoughnessMap:roughnessData});
const geometry=new T.SphereGeometry(.4,24,16),mesh=new T.Mesh(geometry,material);
try {
  assert.equal(mesh.material.sheenRoughnessMap,roughnessData);
  assert.equal(roughnessData.image.data[3]/255,.6);
  assert.equal(roughnessData.colorSpace,T.NoColorSpace);
  console.log({channel:'A',inputRoughness:material.sheenRoughness*.6});
} finally {
  // 材质dispose不会替你释放借用图；这里三个对象都由本例拥有。
  material.dispose();roughnessData.dispose();geometry.dispose();
}
```

通道与单位已核对同版原生 ShaderChunk：`lights_physical_fragment`、`transmission_fragment/pars`、`aomap_fragment`、`alphamap_fragment`及独立涂层法线路径。[网站API来源](https://www.webgl3d.cn/threejs/docs/api/en/materials/MeshPhysicalMaterial.html)保留出处；本页采用上述锁版消费者，不拼接各译文的旧接口。动态输入、压缩格式、颜色管理变更或不同后端仍需核对其真实管线。
