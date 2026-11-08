# Three.js 代码化制作SOP

本指南适用于所有题材的 Three.js 动画制作。目标是把视觉、空间、结构、材料和运动要求转为可维护的代码，再由 Three.js 真实构建并渲染场景。

```text
需求/事实参考/生成式视觉参考
  → 可观察特征与场景规格
  → Three.js资产生成函数、材质、动画和特效代码
  → 运行时几何/着色/姿态数据
  → 目标相机和灯光渲染
  → 图像检查与根因迭代
```

**图像生成模型的输出默认仅为参考。** 不把它作为最终背景平面、sprite、贴图、视频层、DOM图像或导出帧。要做2.5D时也用代码创建有空间关系的几何卡片/层和程序化材质。只有用户明确要求使用图像素材进入成片时才允许例外；此时在规格与交付说明中标明该素材和它替代的代码建模部分。

## 1. 先建可执行规格，不直接照图堆对象

为场景建立一个可读规格。区分已知事实、从视觉参考观察到的特征和美术设定；生成图本身不证明真实比例、背面、连接或尺度。

| 规格项 | 需要写下的内容 | 进入代码的位置 |
|---|---|---|
| 场景坐标 | 世界单位、原点、上方向、主体前向、地面/水面高度 | `Group.position`、局部坐标与锚点 |
| 镜头 | 画幅、机位、焦距/FOV、主体占幅、景深关系 | `PerspectiveCamera`/`OrthographicCamera`、景别参数 |
| 主体形体 | 总宽高深、截面/关键轮廓、识别性特征 | 生成函数参数、几何顶点、部件层级 |
| 结构关系 | 哪些连续、分件、搭接、留空或支撑 | 几何连接、父子层级、遮挡和接触点 |
| 颜色与材料 | 主色、材料分区、粗糙/金属/透光/自发光差异 | 材质实例、shader uniforms、代码化纹理 |
| 环境 | 地形/建筑/水雾的范围、重复节奏和深度层 | 参数曲面、实例规则、环境 shader/粒子 |
| 动作 | 起中止姿势、轨迹、速度变化、环境反馈 | `stateAt(t)`、锚点函数、uniform/实例状态 |

把图像参考转成映射表，再写几何：

| 观察到的参考特征 | 可量化/可编码规格 | Three.js消费者 | 验收方法 |
|---|---|---|---|
| 主体剪影与轮廓转折 | 归一化宽高比、截面点、顶部/底部形状 | `Shape`/`BufferGeometry`/组合体 | 黑色剪影、侧视与目标机位 |
| 重复结构和节奏 | 数量区间、间距、尺寸变化和随机种子 | `InstancedMesh`、参数化布局函数 | 远景轮廓、重复节奏和遮挡 |
| 连接、厚度与空腔 | 厚度、搭接顺序、支撑/空腔关系 | 独立有厚度网格、截面、父子层级 | 近景旋转、掠射光和穿插检查 |
| 颜色与受光 | 色板、材料边界、主光方向/软硬 | `Material`、光源、shader | 灰度/色彩图对照、材质响应 |
| 水/雾/光迹 | 起点、方向、尺度、持续/衰减方式 | 曲面、shader、实例粒子与锚点 | 事件前中后帧、静帧和连续播放 |

将尺寸归一化到一个稳定标尺（如主体高度=1或场地宽度=10），先用低细节模型确认相机、比例和相对位置，再按最近景别提高结构密度。不要从生成图直接描像素轮廓后把一个平面当成模型。

## 2. 选择最能表达形体的代码表示

| 对象/效果 | 优先考虑 | 不适合的情况 |
|---|---|---|
| 方正物件、建筑块面、机械盒体 | `BoxGeometry`、`ExtrudeGeometry`、有厚度的独立面板 | 关键曲面和轮廓不能被方盒准确表达 |
| 轴对称器物、柱体、轮胎、灯罩 | `LatheGeometry`或绕轴构造`BufferGeometry` | 非轴对称或截面方向不断变化 |
| 船体、动物长体、弯管、枝干 | 分段截面 loft、`TubeGeometry`、沿曲线扫掠 | 只用一条固定半径管无法表达腹/背、收分和宽深变化 |
| 岩石、地形、布面、水面 | 参数曲面/高度场/位移网格或顶点 shader | 洞穴、倒扣等不能由单值高度场表达时需换表示 |
| 窗、鳞片、叶、灯等大量重复件 | `InstancedMesh`加受控变化种子 | 每个实例需要独立拓扑/复杂骨骼变形 |
| 角色或可弯曲对象 | 连续网格加骨骼/脊柱、IK和必要修形 | 刚性零件拼装不能代表软组织变形 |
| 雾、火花、飞尘、水花、尾迹 | 低面数体积、shader、`Points`/实例粒子及空间锚点 | 粒子不能替代主要体积或主体几何 |
| 花纹、噪声、色带和细小表面变化 | 从确定性函数绘制`CanvasTexture`，或编写shader | 纹理无法修复错误轮廓、厚度和结构 |

混合表示很常见。对每个重要对象说明哪种表示负责主形、中层连接和表面信息；可见轮廓、受力/搭接和动态接触必须由实际几何或可验证的空间数据承担。

## 3. 组织资产生成代码

每个重要资产用独立函数/模块生成，参数集中、坐标局部化、随机数可复现。子对象按结构命名，返回根节点、包围盒和语义锚点，便于布局、动画、FX和接触共用。

```js
function buildAsset(spec, mats) {
  const root = new THREE.Group();
  root.name = spec.id;
  // 每个组件先在root局部坐标中建立，再用命名子组表达结构。
  const body = new THREE.Mesh(buildBodyGeometry(spec), mats.body);
  body.name = 'body';
  root.add(body);
  addStructuralParts(root, spec, mats);

  root.updateMatrixWorld(true);
  return {
    root,
    bounds: new THREE.Box3().setFromObject(root),
    anchors: {
      origin: () => root.localToWorld(new THREE.Vector3(0, 0, 0)),
      top: () => root.localToWorld(new THREE.Vector3(0, spec.height, 0)),
    },
  };
}
```

该示例展示接口，不是把所有对象都做成`body`盒子。`buildBodyGeometry`应按规格选择基本体、截面扫掠、回转或自定义网格。相机、对象、效果不要分别硬编码一套互不相干的尺寸；共享规范参数和锚点。

### 用基础体表达结构

用基础体做布局/代理，也可用于最终设计中的平面、机械件和有意的硬边风格。通过尺寸、局部位置、圆角/倒角、层级和真实连接组成设计对象；避免无差别堆盒。金属折板用实际厚度和边界，开口用形状轮廓/内外壁，不要用一块薄贴片假装孔洞或面板。

### 用截面生成连续曲面

船体、果实、头部、岩层、枝干等通常需要沿主轴定义多个截面。每个截面包含中心、宽度和上下/左右轮廓；沿轴插值截面，再绕截面采样生成顶点、UV和三角面，端部加封盖，最后求/校正法线。

```js
const positions = [], uvs = [], indices = [];
for (let j = 0; j <= axialSegments; j++) {
  const u = j / axialSegments;
  const section = sampleSection(profile, u); // center, width, height...
  for (let i = 0; i <= radialSegments; i++) {
    const v = i / radialSegments;
    const p = sectionPoint(section, v);      // 截面轮廓来自设计规格
    positions.push(p.x, p.y, p.z);
    uvs.push(u, v);
    if (j < axialSegments && i < radialSegments) {
      const a = j * (radialSegments + 1) + i;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
geometry.setIndex(indices);
geometry.computeVertexNormals();
```

此代码是网格拓扑骨架，`profile`和`sectionPoint`必须按目标形体设计。实际使用时检查绕序和正反面、封口、退化三角形、接缝法线、UV方向、有限值和目标机位厚度。不要把轮廓失真归咎于缺少细分。

轴对称对象可用`LatheGeometry(profilePoints, segments)`：每个`Vector2(x,y)`是半径与高度。需要不同内外壁时单独设计闭合截面。弯曲但截面固定的物件可沿样条构造框架并扫掠截面；沿线变化宽度/旋转时显式插值，不能只拉伸一根直管。

### 用实例与确定性规则建重复场景

重复对象先定义结构家族，再从参数区间生成位置、尺度、旋转和材料差异。用固定种子产生稳定变化，并保留可以验证的空间锚点。大量同拓扑静态/简单实例用`InstancedMesh`；重复件需要不同几何或独立动画时拆成少量家族，而不是一个网格无止尽随机变形。

```js
const inst = new THREE.InstancedMesh(geometry, material, count);
const dummy = new THREE.Object3D();
for (let i = 0; i < count; i++) {
  const p = layoutAt(i, seed); // 可重复、受约束的空间规则
  dummy.position.set(p.x, p.y, p.z);
  dummy.rotation.set(p.rx, p.ry, p.rz);
  dummy.scale.set(p.sx, p.sy, p.sz);
  dummy.updateMatrix();
  inst.setMatrixAt(i, dummy.matrix);
}
inst.instanceMatrix.needsUpdate = true;
```

变化范围须服从构造和布局，不使用随机数掩盖相同剪影/间距。查看实例群整体轮廓、近景实例质量、相互遮挡和阴影；数量多不等于复杂度合理。

## 4. 编写材质、灯光与环境效果

先使用Three.js标准材质建立基础响应，再按实际缺口自定义shader。颜色、几何高度、法线、粗糙度、自发光和轮廓线是不同控制项，分别由可见证据决定。检查颜色空间、tone mapping和输出空间；不要把参考图上烘焙好的光照误当成模型表面颜色。

需要程序化纹理时，用代码从参数化图案生成CanvasTexture，例如网格/条纹/斑点；固定种子与对象UV，让纹理能重复构建且随对象保持位置。普通颜色纹理设为`sRGBColorSpace`；normal、roughness、mask等数据纹理不能当sRGB颜色解码。纹理草图由图像模型生成时，它仍是参考，必须重新编码/绘制，除非用户明确授权直接使用。

环境效果按其物理/美术角色选择代码：

| 效果 | 建议编码路线 | 必须与之共享的数据 |
|---|---|---|
| 连续水面/布/地表 | 网格位移或顶点shader；法线和颜色跟随同一波场/高度函数 | 世界坐标、频率/振幅、主光、相机视距 |
| 反射/高光/涟漪 | shader或可复现的投影带；随表面变形与视角衰减 | 水面坐标、发光物体位置、时间 |
| 烟雾/雾带 | 体积层、透明网格或shader；设置密度、边缘和深度顺序 | 风向、源点、寿命、相机/深度 |
| 火花/水花/碎屑 | 有初始位置、速度、寿命、尺寸的粒子/实例 | 事件时间、世界空间发射锚点、重建状态 |
| glow/泛光/描边 | 明确输入纹理/深度/法线与后处理输出 | 渲染分辨率、曝光、采样及最终合成 |

材质与光照的代码仍须在目标画面中验证。对水等动态材质先以静帧看形体和反射，再看动画中波纹的时间稳定性；shader能运行不表示效果正确。

## 5. 用同一时钟实现动画

定义完整的绝对时间状态，供实时预览和离线逐帧渲染共用。每次调用都覆盖所有动画属性，不依赖上一次渲染状态：

```js
function stateAt(t) {
  const u = THREE.MathUtils.clamp(t / duration, 0, 1);
  const move = smoothstep(0, 1, u);
  return {
    rootPosition: start.clone().lerp(end, move),
    bob: amplitude * Math.sin(2 * Math.PI * frequency * t),
    effectOpacity: envelopeAt(t),
    camera: cameraStateAt(t),
  };
}

function renderAt(t) {
  const s = stateAt(t);
  root.position.copy(s.rootPosition);
  root.position.y += s.bob;
  effect.material.opacity = s.effectOpacity;
  applyCamera(camera, s.camera);
  renderer.render(scene, camera);
}
```

给物体、手持物、阴影/反射、粒子发射器和字幕提供共用锚点；接触和环境反馈从最终变形后的锚点求值。累积粒子/物理若不能任意seek，必须用确定性初始化+时间步进/快照重建，不能只接上`t`就假定状态成立。

## 6. 按逐级证据迭代，而不是只检查代码能运行

| 检查 | 方法 | 暴露的问题 |
|---|---|---|
| 构图/代理模型 | 目标分辨率渲染，少量主形，正侧/目标机位 | 占幅、遮挡、空间关系、视线重心 |
| 剪影/灰模 | 关纹理、关特效和颜色干扰 | 身份、主形比例、连接、厚度和支撑 |
| Lookdev | 最终材质、主辅光、环境与阴影 | 材料差异、受光方向、深度层级 |
| 最终原尺寸 | 在实际输出分辨率看关键资产/区域 | 像素过密、空面、锯齿、材质噪声和细节退场 |
| 关键时间和连续片段 | 起/中/止，重要事件前中后，随机seek | 穿插、漂移、接触、闪烁、重复模式和时间不一致 |

每轮只修当前最影响焦点的一层：规格/构图→几何/结构→动画/锚点→材质/光照→FX/渲染。静帧漂亮不能证明动画通过；浏览器无错误或有非空Geometry也不能证明造型通过。每个关键结果必须来自当前Three.js代码和当前交付渲染，不能拿参考图或上一次旧渲染代替。

## 完成门槛

- 生产代码能说明主要画面对象由哪些Three.js几何/实例/材质/着色器生成。
- 图像生成参考没有被加载到最终场景；按获准例外使用的图片资源逐一记录。
- 重要资产在目标机位的轮廓、厚度/层次、颜色/受光和动画锚点都有可见验证。
- 可复现的代码和依赖随源码工程交付；离线HTML/MP4来自同一版本的Three.js场景。
- 交付说明讲清是全3D还是代码化2.5D，列出生成代码、非代码资产和未覆盖检查。
