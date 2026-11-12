# 材料身份、分段受光与同源灯光

适用：锁定 Three.js r180、米制场景、已有形体和空间结构。材光可读性由真实曲面、光源、反射环境和输出链共同决定；程序纹理不会补出厚度、接点或轮廓。

## 已确认接口与边界

| 确定结论 | 代码证据 | 待验证项 / 使用范围 |
|---|---|---|
| 木、石、涂层字段可共用采样边界生成颜色与表面通道 | [procedural-palette.mjs](../assets/materials/procedural-palette.mjs) | 图案为原创程序配方，无实测材质标定 |
| 颜色贴图编码 sRGB；粗糙度 G、金属度 B、切线法线为原始数据 | [surface-fields.mjs](../assets/materials/surface-fields.mjs) | 需要匹配物理尺度的 UV 与单位正交 TBN；曲壳/隐式体默认采用无贴图响应 |
| 材料缓存与风格切换不需要重建几何 | [look-palette.mjs](../assets/materials/look-palette.mjs) | Mesh 材质组与绑定由场景明确提供；实际画面仍需浏览器检查 |
| 主光、target 和正交阴影投影从同一方向和 Box3 求得 | [lighting-rig.mjs](../assets/rendering/lighting-rig.mjs) | Box3 必须覆盖相关投影者、受影者和所需影区；移动后需重新拟合 |
| 方向可直接供渐变天空与 PMREM 使用 | [scene-environment.mjs](../assets/rendering/scene-environment.mjs) | 静态环境捕获不提供动态镜面或全局光照 |

## 算法与实际 API

`createLookPalette(T,{mode='pbr',seed=1,resolution=256})` 创建一个资源所有者。`mode` 仅支持 `pbr` / `toon`；分辨率是 64–2048 的整数，seed 是 uint32。`get(role,options)` 返回共享材质，role 仅为 `stone` / `coating` / `metal` / `wood`。

| options | 实际作用与缓存身份 |
|---|---|
| `variant=0` | uint32；有贴图时改变程序结构，无贴图时改变轻微基色响应 |
| `wetness=0` | 0–1；压暗色、降低 PBR 粗糙度和贴图起伏。Toon 实际消费颜色/法线变化，不声称有水膜反射 |
| `tileSizeMeters` | 一个 UV 周期的两个米制长度；默认石 `[1,1]`、涂层 `[.8,.8]`、金属 `[.5,.5]`、木 `[.6,1.2]`。改变法线物理斜率，不自动改变几何 UV 或图案密度 |
| `color=0xffffff` | uint24 sRGB 乘色，通过 Three ColorManagement 转成工作空间后乘以当前基色；保留既有乘色行为 |
| `baseColor=null` | 仅 `maps:false`：null 保留角色原配方；uint24 则独立指定 sRGB 基色，再依次消费 variant、wetness 与 color 乘色。PBR 粗糙度/金属度仍由角色决定。`maps:true` 时显式传入任何 baseColor（包括 null）均拒绝 |
| `maps=true` | false 时不绑定颜色、法线、粗糙度或金属度贴图；保留角色基色、PBR 粗糙度/金属度，以及 Toon 受光梯度。无贴图时显式传入 tileSizeMeters 会被拒绝 |

指定浅色表面时，使用 `{maps:false,baseColor:0xf1eadb}`。这会替换角色原有的暗基色，不会把浅色继续乘进暗配方；variant 会保留约 ±2% 的轻微颜色变化，wetness 继续压暗。该分支独立控制无贴图基色，不会替换程序贴图中的区域颜色。

所有有效参数都参与标准化缓存；默认值与显式同值共享一个材质。同角色不同乘色复用表面贴图。未知参数与非法数值直接拒绝，不会默默忽略 `roughness`、`wear` 或 renderer 等字段。缓存没有 LRU，连续滑块值会创建新条目；采用离散状态并在场景退出时销毁。

PBR 的木/石/涂层复用已有程序字段，金属通过 `createRegionMaterial` 烘焙连续周期字段，四角色具有不同的颜色、起伏和粗糙度。金属使用高金属度及中等粗糙度；它需要有效 PMREM 才能呈现环境反射。配方中的细小表面变化不是几何破损，也不是各向异性 BRDF。低分辨率 RGB8 法线可能量化掉浅起伏。

Toon 的木/石/涂层实际创建 `MeshToonMaterial`。8×1 的 `RedFormat` DataTexture 储存原始光照乘数，`NearestFilter` 且不生成 mipmap。r180 的渐变坐标为 `NdotL*.5+.5`，没有再乘 `max(NdotL,0)`：前四格设0，后四格为受光四阶，避免背光曲面得到直射光后显露密集自阴影条纹。需要非物理包裹光的风格应另行设计并检查阴影，不能误把整个渐变宽度当成正半球。

暗部由间接亮度/补光单独设计；把负半球直射清零只修正光照归属，不保证暗面已经可读。它仍使用 Three 的灯光和阴影路径；不会烘焙一张固定明暗贴图。环境光和多个直射灯叠加会软化分段对比，需要按画面调节。金属继续使用 `MeshStandardMaterial` 响应 PMREM，因此此模式是分段漫反射与 PBR 金属反射的混合风格。

`createLightingRig(T,{bounds,keyDirection,keyColor,keyIntensity,fillColor,fillIntensity,ambientIntensity,shadowMapSize})` 返回 `{root,key,fill,ambient,readState,dispose}`。bounds 是有限、非空、有有效尺度的 `T.Box3`，允许平面受影区域。keyDirection 接受 xyz 数组或 Vector3，表示从目标指向光源，默认 `[-.6,.8,.35]`。颜色接受 uint24、`#rrggbb` 或 Color；强度是有限非负值。默认主光强度 3、补光 .65、白色环境光 .12，都是起点，须按固定输出检查。

拟合顺序是：Box3 中心作为 target → 沿标准化方向放主光 → 选不平行的相机 up → 将八角变换到光空间 → 用横纵极值加边距设置阴影相机 → 用深度极值求 near/far。顶光、侧光和场景平移均使用同一算法。影图尺寸为 128–4096 的二次幂，默认 2048；`readState().shadow.texelSize` 是横纵世界米数/实际影图像素。缩小 bounds 会提高局部精度，但不得裁掉应存在的影区。

## 完整接线

先完成几何，再由几何求一次世界 bounds。下例绑定表由场景显式创建，支持单材质及多组材质；options 按每个 role 一一对应。仅给已核实物理 UV/TBN 的平板或墙板设置 `maps:true`；其余默认 false。root 灯架直接加到没有额外变换的 Scene。

```js
import {createLookPalette} from './assets/materials/look-palette.mjs';
import {createLightingRig} from './assets/rendering/lighting-rig.mjs';
import {createSkyEnvironment} from './assets/rendering/scene-environment.mjs';

// renderer、camera 和 worldRoot 由应用拥有；绑定与core-world的object/slots一致。
const bindings = [
  {object:shellMesh,slots:[{role:'coating',options:{maps:false,baseColor:0xf1eadb}}]},
  {object:supportMesh,slots:[{role:'stone',options:{maps:false}},{role:'metal',options:{maps:false}}]},
  // 此木板 UV 0..1 对应 .6 × 1.2 米，且已核实 tangent chart。
  {object:boardMesh,slots:[{role:'wood',options:{maps:true,tileSizeMeters:[.6,1.2]}}]}
];
worldRoot.updateWorldMatrix(true,true);
const bounds = new T.Box3().setFromObject(worldRoot);
const rig = createLightingRig(T,{bounds,keyDirection:[-.6,.8,.35]});
scene.add(rig.root);
const sky = createSkyEnvironment(T,{
  renderer, sunDirection:rig.readState().keyDirection, resolution:128
});
scene.add(sky.root);
sky.apply(scene); // 真正捕获并绑定 PMREM；仅加 sky.root 不提供环境反射。
const palettes = {
  pbr:createLookPalette(T,{mode:'pbr',seed:17,resolution:256}),
  toon:createLookPalette(T,{mode:'toon',seed:17,resolution:256})
};
const originalMaterials = bindings.map(({object})=>object.material);
const geometryIds = bindings.map(({object})=>object.geometry.uuid);
function setMode(mode) {
  const palette = palettes[mode];
  if(!palette) throw Error('Unknown mode');
  // 先解析完整候选材质表，成功后再更新所有绑定。
  const candidate = bindings.map(({slots})=>slots.map(s=>palette.get(s.role,s.options)));
  bindings.forEach(({object},i)=>{object.material=candidate[i].length===1?candidate[i][0]:candidate[i];});
  if(bindings.some(({object},i)=>object.geometry.uuid!==geometryIds[i])) throw Error('Geometry changed');
}
setMode('pbr');
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
worldRoot.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
// 直接输出路径：一次 tone mapping / sRGB 输出；有 Composer 时改用其 OutputPass 路径。
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.render(scene,camera);
// 切换 setMode('toon') 后原位渲染：相机、geometry UUID 和结构参数不变。
function disposeLook() {
  bindings.forEach(({object},i)=>{object.material=originalMaterials[i];});
  palettes.pbr.dispose();palettes.toon.dispose();
  sky.dispose();rig.dispose();
}
```

绑定表必须覆盖实际可见的所有材料槽。不要保留刚被销毁的 palette 材质继续绘制。对结构替换，先构造并验证候选 geometry 和角色，再求其 bounds、重建灯架并重新绑定；材光切换只更新绑定，无需重建几何。已有后期可继续使用 [post-pipeline.mjs](../assets/rendering/post-pipeline.mjs)，AO/Bloom 根据目标选择并保留开关对照；不要在 OutputPass 后再手动应用 gamma 或重复 tone mapping。

## 归属、误用与验证

palette 拥有所返材质、共享程序贴图及渐变；借用者不应修改或单独 dispose。PBR 的内部基础材质与输出克隆共享贴图，由统一所有者一次释放；Toon 不使用的原始粗糙度/金属度图也随基础配方释放。`inspect()` 返回脱离内部状态的参数与 UUID，dispose 幂等，销毁后的 get 抛错。

灯架只拥有灯、target 和灯的阴影存储。它不持有 renderer，不释放借用的几何、材质、环境；`dispose()` 将 root 从场景移除并释放影图。`readState()` 可在销毁后读取状态。外部修改 key、target、root 变换或 shadow camera 会破坏冻结拟合；不要把灯架挂到非单位缩放父节点。bounds 只有物体包围盒时，长投影可能超出范围；扩大到所需受影区域，而不是仅把 shadow far 调大。

[行为测试](../scripts/tests/look-development.test.mjs) 使用真实 r180，覆盖角色通道、参数与缓存、颜色空间、渐变过滤、无贴图模式与独立浅色基色、角色 BRDF 保留、共享释放、异常输入、不同方向的完整 bounds 投影，以及光线在受影平面的同 UV/递增深度关系。运行：

```sh
THREE_MODULE=/path/to/three/build/three.module.js node --test scripts/tests/look-development.test.mjs
```

这些测试验证 CPU 侧真实 Three 资源和投影语义。最终验收还需同一几何下检查 PBR/Toon 的全貌与接点、主光/环境方向、接触阴影、金属反射源、输出曝光，以及反复切换后的 geometry/texture/program 统计。节点测试本身不证明实际 GPU 着色或视觉质量达标。
