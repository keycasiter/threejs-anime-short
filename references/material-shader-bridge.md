# 保留内置光照的材质扩展

需要改变基色、粗糙度或受光法线，同时保留 Three.js 自带光照时，用 [material-shader-bridge.mjs](../assets/materials/material-shader-bridge.mjs) 为材质生成独立变体。只支持 Three.js **r180 WebGLRenderer** 的原生 MeshStandardMaterial、MeshPhysicalMaterial 和 MeshToonMaterial；不接受子类、其他版本或 WebGPU 节点材质。

| 想改变什么 | 在片元着色器插在哪里 | 实际消费者 |
|---|---|---|
| 基色 | `#include <color_fragment>` 后（见下例） | 改 `diffuseColor.rgb`；保留贴图、顶点颜色和已有 alpha，后面的光照读取此颜色 |
| 微表面粗糙度 | `#include <roughnessmap_fragment>` 后 | 改 `roughnessFactor`，由后面的 Physical/Standard BRDF 读取；Toon 无此锚点 |
| 光照用微法线 | `#include <normal_fragment_maps>` 后 | 在**视空间**正确组合、归一化 `normal`；不自动改变 clearcoat 独立法线、几何、描边或阴影 |
| 出射光 | `#include <opaque_fragment>` 前 | 改 `outgoingLight`；此时已算完光照。之后仍由原着色器处理 alpha、色调映射、色彩空间、雾和预乘 |

位置决定含义。雾或预乘之后再改 `gl_FragColor`，改的是已合成的输出。在 canvas 与线性中间目标上，颜色域取决于实际目标、renderer 和末端 OutputPass。桥不添加颜色转换。调用方若提供 `replace`，必须自行保留仍需要的光照、alpha 与输出步骤。表面变化不代表实例、骨骼、顶点位移、阴影或 CPU 接触同步。

**运行一个最小例。** 在 skill 根目录执行下列 ESM（Node：`node --input-type=module` 从标准输入读取；安装 `three@0.180.0` 或将 `THREE_MODULE` 指向同版的本地 `three.module.js`）。它将变体装到真实 Mesh 上，再按 r180 的真实选择，用 ShaderLib.physical 模拟 Standard 的编译参数。Physical 也选 physical；Toon 选 toon。浏览器项目直接复用项目已有的 THREE 实例，在自己的渲染循环绘制该 Mesh；不需要手动调用编译回调。

```js
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createMaterialShaderBridge } from './assets/materials/material-shader-bridge.mjs';
const T = process.env.THREE_MODULE
  ? await import(pathToFileURL(resolve(process.env.THREE_MODULE)).href)
  : await import('three');

const base = new T.MeshStandardMaterial({color: 0x997658, roughness: 0.72});
const bridge = createMaterialShaderBridge(T, {
  baseMaterial: base,
  programKey: 'timber.tint.v1',
  uniforms: {uTimberTint: {value: 1}},
  patches: [
    {stage: 'fragment', anchor: '#include <common>', after: 'uniform float uTimberTint;'},
    {stage: 'fragment', anchor: '#include <color_fragment>', after: 'diffuseColor.rgb *= uTimberTint;'}
  ]
});
const mesh = new T.Mesh(new T.BoxGeometry(), bridge.material);
try {
  bridge.uniforms.uTimberTint.value = 0.8; // 第一次可见前也可写
  const {vertexShader, fragmentShader, uniforms} = T.ShaderLib.physical;
  const shader = {vertexShader, fragmentShader, uniforms: T.UniformsUtils.clone(uniforms)};
  mesh.material.onBeforeCompile(shader, undefined); // 仅用于本例 CPU 检查
  if (shader.uniforms.uTimberTint !== bridge.uniforms.uTimberTint ||
      !shader.fragmentShader.includes('diffuseColor.rgb *= uTimberTint;')) throw Error('bridge not connected');
  console.log(mesh.material.type, shader.uniforms.uTimberTint.value);
} finally {
  mesh.geometry.dispose(); bridge.dispose(); base.dispose();
}
```

**结构、更新及所有权。**

| 输入或返回值 | 约定 |
|---|---|
| `baseMaterial`、`defines` | 按实际类走 r180 的构造与 copy，保留贴图引用，独立复制材质参数。可选 defines 覆盖同名 base define；结果按名称排序传给 renderer。值限有限数、布尔或单行字符串。 |
| `patches` | 必填数组，取初始长度，按下标读取；每个字段读取一次，同一快照用于检查和编译。`stage` 为 vertex 或 fragment。每个 anchor 是上游修改后、展开 include 前的唯一精确**子串**；包括空白和大小写。before/after 可合写，分别自动换行；replace 独占，可传空串删除。不同 patch 必须定位互不重叠的原始区间，不可依赖同批新插入的锚点。 |
| `programKey`、`upstreamProgramKey` | 必填非空 programKey 标识用途；若 base 有自定义 onBeforeCompile 或 customProgramCacheKey，必须额外给上游稳定身份。结构键同时含实际 GLSL、patch 数组顺序、材质类型、合并后的 defines 和 uniform 名称；后两组按名称排序。上游自定义 cache hook 的字符串结果也参与实时取键。闭包隐藏的结构变化须由上游键准确表述，不能用函数文本代替。 |
| `material`、`uniforms` | 桥拥有新材质；在创建时固定结构与包装对象表（省略 uniforms 为空表）。每个传入的 `{value: …}` 与着色器读取的是同一对象。只改 value，无须 needsUpdate。结构变化创建新桥；不要再次 clone 已扩展材质来复制 hook。 |
| `inspect()`、`dispose()` | inspect 返回 materialType、programKey、patchCount、uniformNames、disposed。替换时先验证候选，再切换 Mesh 引用；失败时释放候选。dispose 幂等，只释放新材质，不释放 base、借用 Texture、uniform 的值或调用方的几何。 |

编译先以新材质为 `this` 执行借用的上游 callback，传入实际 renderer；自定义 cache hook 也使用新材质作接收者。上游数据应放在可被 Three.js 复制的属性或自己的闭包中。两阶段源码与所有新增 uniform 通过检查后一起写入 r180 的普通编译参数对象，保留上游 uniforms 表及包装对象。与已有 uniform 重名即拒绝，包括 Standard 实际收到的 `clearcoat`。renderer 另行上传或接管的名称同样保留：曝光、相机/物体矩阵、裁切和接收阴影，以及蒙皮、形变与批绘制输入。例如 `toneMappingExposure`、`projectionMatrix` 和 `viewMatrix` 即使不在 ShaderLib.uniforms 也不能复用；具体变体是否启用这些 uniform 不改变命名规则。自定义名称宜用独有前缀；GLSL 语法仍由 GPU 编译器检查。上游 JavaScript 本身已做的修改和外部副作用不提供回滚或沙箱。

普通材质变体应从同一个原始 base 创建为兄弟桥。若有意让桥 B 以桥 A 的材质为 base，B 会借用 A 的编译回调；须保持 A 存活至所有下游桥释放，并先释放下游、再释放上游。

每桥最多 64 个 patch、128 个 uniform 和 128 个合并 define；每个 anchor 至多 1024 个 UTF-16 单元，每段插入/替换文本至多 16384，总 patch 文本至多 65536，每阶段输入源码至多 262144。该例和 [聚焦测试](../scripts/tests/material-shader-bridge.test.mjs) 验证 CPU 侧接线；真实 GPU 的程序编译、可见性切换和 canvas/OutputPass 像素需在应用入口分别验证。
