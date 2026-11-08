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

Three.js里可见的网格由`Geometry + Material + Object3D变换 + Camera + Renderer`共同产生。模型代码生成顶点/索引/UV/实例变换，材质代码决定颜色与光响应，场景代码管理父子关系/灯光/相机，时间函数更新对象状态，最后由renderer输出画面。制作应沿这条数据链定位，不把“调用了Three.js”或“页面有canvas”当作实现完成。

常用项目可分成下面几层；短片可以合并文件，但功能边界仍要清楚：

```text
src/
  main.js                 初始化 renderer、camera、scene 和 renderAt(t)
  scene/buildScene.js     灯光、环境、主体布局、相机轨迹
  assets/build-*.js       每种可程序化资产的几何生成函数
  materials/*.js          共用材质和 shader
  effects/*.js            水、雾、粒子、接触/尾迹反馈
  animation/stateAt.js    从绝对时间求出所有姿态与FX状态
```

一个静帧先跑通最小场景：

```js
const width = 1280, height = 720;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(1); // 离线逐帧导出使用明确的目标像素尺寸
renderer.setSize(width, height, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#203044');
const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
camera.position.set(0, 4, 12);
camera.lookAt(0, 2, 0);
scene.add(new THREE.HemisphereLight('#b9c9e9', '#172233', 1.1));
const key = new THREE.DirectionalLight('#ffe0b0', 2.2);
key.position.set(-4, 8, 5);
scene.add(key);
document.body.appendChild(renderer.domElement);

function renderStill() { renderer.render(scene, camera); }
```

这是可运行的基础设施，不是成片构图。下一步先放代理几何并调机位，再把占主体面积、决定识别度的对象替换为正式资产。用同一个目标视口、曝光和相机检查后续改动。

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

这些模式提供通用起点，不替代对象专属结构设计。连续皮肤/有机体、中层与接触锚点读[资产设计与生成](asset-craft.md)；IK、脊柱变形、曲面环境和FX尺度读[程序化制作机制](procedural-systems.md)；自定义缓冲/后期消费者读[渲染契约](render-contracts.md)。

## 3. 按顺序实现并设阶段门

不要同时从空白项目写完模型、shader、动画和后期。用下表逐层交付；一个阶段过门后再加下一层，缺陷能对应到具体代码层：

| 顺序 | Three.js实现 | 过门条件 |
|---|---|---|
| 1. 可运行场景 | renderer、颜色空间、相机、灯光、一个代理物体 | 目标视口有画面、相机看得到代理、浏览器无错误 |
| 2. 布局和尺度 | 原点/地面/主体锚点、占幅、前中后景 | 目标构图缩略图和黑色剪影可读 |
| 3. 主体形体 | 每个重要主体的独立几何生成函数和层级 | 关键轮廓/厚度/连接在目标机位成立 |
| 4. 中层结构 | 面板、窗口、关节、枝杈、立面节奏等 | 主体不像通用基础体拼贴，局部结构能解释形体 |
| 5. 材质和灯光 | 材料分区、主辅光、阴影、环境响应 | 灰模与彩图都成立，材料靠受光可区分 |
| 6. 次级细节 | 程序化纹理、实例、微观结构 | 最终分辨率可读且没有过密/闪烁 |
| 7. 动画和FX | `stateAt(t)`、锚点、环境响应 | 起/中/止和任意seek稳定，FX因果关系清楚 |
| 8. 最终渲染 | 固定源码、资产、视口、fps和输出 | 实际成片属性正确，关键帧和连续动作已审看 |

任何阶段不过门，先回到该阶段重做几何/参数/结构，不用后期和下游细节掩盖问题。视觉层不达标时禁止把“代码无报错/能导出”当作完成。

## 4. 组织资产生成代码

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

让每个部件由统一小函数创建，避免到处散落匿名数字：

```js
function addPart(parent, name, geometry, material, { position, rotation, scale } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const materials = {
  dark: new THREE.MeshStandardMaterial({ color: '#303b45', roughness: .58, metalness: .2 }),
  paint: new THREE.MeshStandardMaterial({ color: '#617c8b', roughness: .4, metalness: .12 }),
};
const root = new THREE.Group();
addPart(root, 'base', new THREE.CylinderGeometry(.7, .9, .18, 32), materials.dark,
  { position: [0, .09, 0] });
addPart(root, 'column', new THREE.CylinderGeometry(.16, .22, 1.6, 20), materials.paint,
  { position: [0, .98, 0] });
```

以上仅说明部件组织。最终比例从场景规格传入，部件的相交、端点和厚度在相机前检查；不要把通用灯具、人物、建筑等都照此组合成同一种“柱子+圆盘”造型。

闭合二维轮廓需要厚度时用`Shape`与`ExtrudeGeometry`，并为倒角/侧壁设置目标像素可读的分段；旋转件可用`LatheGeometry`：

```js
const outline = new THREE.Shape();
outline.moveTo(-.8, -.4);
outline.lineTo(.5, -.4);
outline.lineTo(.8, .25);
outline.lineTo(0, .7);
outline.lineTo(-.65, .25);
outline.closePath();
const solidProfile = new THREE.ExtrudeGeometry(outline, {
  depth: .16, steps: 1,
  bevelEnabled: true, bevelSegments: 2,
  bevelSize: .025, bevelThickness: .02,
});
```

这里的轮廓点由当前资产规格给出，示范如何把二维轮廓转为带侧壁的实体；更复杂的开孔通过`outline.holes`添加`Path`，多个结构面要有真实搭接顺序。

```js
const profile = [
  new THREE.Vector2(.18, 0), new THREE.Vector2(.3, .08),
  new THREE.Vector2(.32, .65), new THREE.Vector2(.52, .82),
  new THREE.Vector2(.54, .9), new THREE.Vector2(.08, .9),
];
const shade = new THREE.Mesh(
  new THREE.LatheGeometry(profile, 48),
  new THREE.MeshStandardMaterial({ color: '#d6bd8a', roughness: .42, metalness: .18 }),
);
```

profile里的`x`是半径、`y`是高度。截面点的顺序决定内外表面和开口；要做薄壳、内壁或顶部孔洞时，明确设计闭合剖面，不只靠增加分段。

### 用截面生成连续曲面

船体、果实、头部、岩层、枝干等通常需要沿主轴定义多个截面。每个截面包含中心、宽度和上下/左右轮廓；沿轴插值截面，再绕截面采样生成顶点、UV和三角面，端部加封盖，最后求/校正法线。

可把“二维参数坐标(u,v)映射到三维点”的过程封装成通用网格函数。它用于地表、截面扫掠、壳体、连续有机体或程序化平面；轮廓规则由具体资产函数传入：

```js
function buildGridGeometry({ rows, columns, pointAt, reverseWinding = false }) {
  if (!Number.isInteger(rows) || rows < 1) throw new Error('rows must be >= 1');
  if (!Number.isInteger(columns) || columns < 1) throw new Error('columns must be >= 1');
  const positions = [], uvs = [], indices = [];

  for (let j = 0; j <= rows; j++) {
    const u = j / rows;
    for (let i = 0; i <= columns; i++) {
      const v = i / columns;
      const p = pointAt(u, v); // 必须返回 THREE.Vector3
      if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error(`non-finite vertex at ${u}, ${v}`);
      positions.push(p.x, p.y, p.z);
      uvs.push(v, u);
    }
  }

  const stride = columns + 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const a = j * stride + i, b = a + stride;
    const c = a + 1, d = b + 1;
    if (reverseWinding) indices.push(a, c, b, b, c, d);
    else indices.push(a, b, c, b, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
```

例如，以Y轴为主轴生成具有椭圆截面和两端收窄的有机体：

```js
const geometry = buildGridGeometry({
  rows: 40, columns: 32,
  pointAt: (u, v) => {
    const angle = 2 * Math.PI * v;
    const taper = Math.max(0.025, Math.sin(Math.PI * u) ** 0.72);
    const centerX = 0.08 * Math.sin(Math.PI * u);
    return new THREE.Vector3(
      centerX + Math.cos(angle) * 0.72 * taper,
      THREE.MathUtils.lerp(-1.8, 1.8, u),
      Math.sin(angle) * 0.46 * taper,
    );
  },
});
const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
  color: '#789078', roughness: 0.78, metalness: 0.02,
}));
```

`pointAt`决定实际形状：换控制截面即可改变腹背、肩部、端部和偏心。上例是开口表面模板，不包含端盖；正式封闭资产需要生成端盖或连接独立几何。闭合截面在`v=0`和`v=1`位置重复顶点以获得UV接缝，因此普通`computeVertexNormals()`可能在接缝处出现法线断层；要平滑闭合时需焊接位置相同顶点后计算/复制法线，或手工对接缝两侧平均法线。检查`reverseWinding`是否符合外向法线，必要时在调试材质中开启`THREE.DoubleSide`定位方向，但交付时应修正绕序。

网格生成后依次核对：顶点与索引均有限、三角形没有零面积、包围盒尺寸与规格相符、正反面与法线方向正确、截面接缝和端盖闭合、UV连续、目标相机下厚度可读。不要把轮廓失真归咎于缺少细分。

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

## 5. 编写材质、灯光与环境效果

先使用Three.js标准材质建立基础响应，再按实际缺口自定义shader。颜色、几何高度、法线、粗糙度、自发光和轮廓线是不同控制项，分别由可见证据决定。检查颜色空间、tone mapping和输出空间；不要把参考图上烘焙好的光照误当成模型表面颜色。

先建立少量材料类型，再让不同物体共享经过确认的材料，而不是每个对象临时造一套互相冲突的参数。`color`主要负责底色；`metalness`和`roughness`控制反射响应；`emissive`只表示自身发光，不应拿来补主光不足。

```js
const materials = {
  paintedMetal: new THREE.MeshStandardMaterial({
    color: '#476276', metalness: .28, roughness: .38,
  }),
  rubber: new THREE.MeshStandardMaterial({
    color: '#20252a', metalness: 0, roughness: .86,
  }),
  warmLamp: new THREE.MeshStandardMaterial({
    color: '#ffd28a', emissive: '#ff9c42', emissiveIntensity: 1.4,
    metalness: 0, roughness: .3,
  }),
};

const fill = new THREE.HemisphereLight('#b8c9e7', '#29313a', .8);
const key = new THREE.DirectionalLight('#ffe0b4', 2.0);
key.position.set(-5, 8, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
scene.add(fill, key);
```

灯光量要结合曝光与tone mapping校准。主光用来揭示形体转折，填充光保持暗部层次；避免把所有材质加亮到自发光效果。阴影发脏/漂浮时检查shadow camera范围、bias、接收面和法线，不要统一把阴影调黑。

需要程序化纹理时，用代码从参数化图案生成CanvasTexture，例如网格/条纹/斑点；固定种子与对象UV，让纹理能重复构建且随对象保持位置。普通颜色纹理设为`sRGBColorSpace`；normal、roughness、mask等数据纹理不能当sRGB颜色解码。纹理草图由图像模型生成时，它仍是参考，必须重新编码/绘制，除非用户明确授权直接使用。

确定性Canvas纹理示例：用固定公式画一块可平铺的色带纹理；同一参数每次生成相同像素：

```js
function makeStripeTexture({ size = 256, stripeCount = 8, colors }) {
  if (!Array.isArray(colors) || colors.length < 2) throw new Error('colors needs at least two entries');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, size, size);
  const band = size / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = colors[(i % (colors.length - 1)) + 1];
    const inset = (i % 2) * band * .16;
    ctx.fillRect(i * band + inset, 0, band * .48, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1);
  texture.needsUpdate = true;
  return texture;
}
```

这只生成颜色纹理，不会改变网格轮廓/法线。用于重复表面前检查UV比例、接缝、mipmap和最近景别；纹理过小或对比过高会闪烁，单靠提高分辨率不一定解决，应降低频率/对比或改用解析shader。

环境效果按其物理/美术角色选择代码：

| 效果 | 建议编码路线 | 必须与之共享的数据 |
|---|---|---|
| 连续水面/布/地表 | 网格位移或顶点shader；法线和颜色跟随同一波场/高度函数 | 世界坐标、频率/振幅、主光、相机视距 |
| 反射/高光/涟漪 | shader或可复现的投影带；随表面变形与视角衰减 | 水面坐标、发光物体位置、时间 |
| 烟雾/雾带 | 体积层、透明网格或shader；设置密度、边缘和深度顺序 | 风向、源点、寿命、相机/深度 |
| 火花/水花/碎屑 | 有初始位置、速度、寿命、尺寸的粒子/实例 | 事件时间、世界空间发射锚点、重建状态 |
| glow/泛光/描边 | 明确输入纹理/深度/法线与后处理输出 | 渲染分辨率、曝光、采样及最终合成 |

材质与光照的代码仍须在目标画面中验证。对水等动态材质先以静帧看形体和反射，再看动画中波纹的时间稳定性；shader能运行不表示效果正确。

### shader的实现顺序

先把效果拆成CPU侧参数、顶点阶段和片元阶段三部分：

1. 定义uniform及单位，例如`uTime`用秒、`uAmplitude`用世界单位、`uColor`用线性颜色。
2. 顶点shader只处理确实要影响轮廓/法线的几何位移；算出位移后的空间位置，并更新局部法线。
3. 片元shader按坐标/法线/视角算底色、粗糙亮度、透明度或光带。把高频纹理限制在材质内部，不让它无差别污染整个轮廓。
4. CPU每次从绝对`t`完整写入uniform；再采样起始/中段/结束和目标机位，不依赖帧间累计。
5. 明确shader读取的每个属性/纹理以及它进入最终`gl_FragColor`/输出节点的路径；未被消费者读取的数据没有视觉作用。

下面是代码生成的波面示例，演示顶点形变和时间控制；它是简化风格化表面，不是物理反射模拟：

```js
const waterMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    uniform float uTime;
    varying vec2 vUv;
    varying float vWave;
    void main() {
      vUv = uv;
      vec3 p = position;
      float w1 = sin(p.x * 1.25 + uTime * 1.1) * 0.055;
      float w2 = sin(p.y * 0.82 - uTime * 0.72 + p.x * 0.23) * 0.035;
      vWave = w1 + w2;
      p.z += vWave;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vUv;
    varying float vWave;
    void main() {
      vec3 deep = vec3(0.018, 0.055, 0.12);
      vec3 shallow = vec3(0.055, 0.18, 0.28);
      vec3 color = mix(deep, shallow, clamp(vUv.y, 0.0, 1.0));
      float ripple = sin(vUv.x * 105.0 + vUv.y * 37.0 + uTime * 1.5 + vWave * 9.0);
      float glint = smoothstep(0.91, 0.99, ripple) * smoothstep(0.25, 0.8, vUv.y);
      color += vec3(0.52, 0.33, 0.16) * glint;
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(24, 18, 160, 120), waterMaterial);
water.rotation.x = -Math.PI / 2; // 本地XY平面转为XZ水面，local z位移转成world y
water.position.y = 0;
scene.add(water);

function setWaterTime(t) {
  waterMaterial.uniforms.uTime.value = t; // 从绝对时间写入，支持任意seek
}
```

如果波浪要有可见高光方向，应由位移函数推导法线或用`normal`/`derivative`计算；只改顶点高度却使用始终朝上的法线，侧光下不会得到正确波面响应。`ShaderMaterial`还要检查材质正反面、透明顺序、颜色空间、设备精度和目标GPU；编译通过只证明语法/链接成功。

### 粒子/碎屑要有起点、速度和寿命

少量独立物体用Mesh，数量较大且外形简单的粒子用`Points`或`InstancedMesh`。运动状态从绝对时间计算：先用固定索引生成起点/速度/相位，再按`t`算粒子年龄、位置和透明度。下面示例用确定性初值和CPU更新顶点，适合数百到数千个轻量点；更多粒子再考虑GPU模拟。

```js
const count = 180, life = 2.4;
const position = new Float32Array(count * 3);
const opacity = new Float32Array(count);
const origin = [], velocity = [], phase = [];
for (let i = 0; i < count; i++) {
  const s = Math.sin(i * 127.1 + 9.2) * 43758.5453;
  const fract = s - Math.floor(s);
  const angle = i * 2.399963;
  origin.push(new THREE.Vector3(0, 0, 0)); // 可替换为事件锚点
  velocity.push(new THREE.Vector3(Math.cos(angle) * (.2 + fract), .6 + fract * 1.5, Math.sin(angle) * (.2 + fract)));
  phase.push(fract * life);
}
const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
particleGeometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacity, 1).setUsage(THREE.DynamicDrawUsage));
const particleMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  vertexShader: `attribute float aOpacity; varying float vOpacity;
    void main(){ vOpacity=aOpacity; gl_PointSize=3.0;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying float vOpacity;
    void main(){ vec2 p=gl_PointCoord-0.5; float edge=1.0-smoothstep(0.16,0.25,length(p));
      gl_FragColor=vec4(0.72,0.86,1.0,edge*vOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment> }`,
});
const particles = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particles);

function updateParticles(t, eventOrigin) {
  for (let i = 0; i < count; i++) {
    const age = (t + phase[i]) % life;
    const u = age / life;
    const p = origin[i].copy(eventOrigin);
    position[i * 3] = p.x + velocity[i].x * age;
    position[i * 3 + 1] = p.y + velocity[i].y * age - 0.5 * 0.7 * age * age;
    position[i * 3 + 2] = p.z + velocity[i].z * age;
    opacity[i] = Math.sin(Math.PI * u) * (1 - u * .25);
  }
  particleGeometry.attributes.position.needsUpdate = true;
  particleGeometry.attributes.aOpacity.needsUpdate = true;
}
```

每次调用都覆盖所有点，故正向播放、倒序抽帧和随机seek得到同一状态。示例用循环相位让粒子持续出现；单次爆发时还要增加发射时间范围/关闭循环，超过寿命后透明度归零。若粒子要碰撞、受风或改变方向，补充可重建的时间步进，不能只用上一帧位置累加。

## 6. 用同一时钟实现动画

定义完整的绝对时间状态，供实时预览和离线逐帧渲染共用。每次调用都覆盖所有动画属性，不依赖上一次渲染状态：

```js
const duration = 8;
const start = new THREE.Vector3(-3, 0, 0);
const end = new THREE.Vector3(3, 0, 0);
const root = new THREE.Group();
scene.add(root);
const effectMaterial = new THREE.MeshBasicMaterial({ color: '#e9bd82', transparent: true });
const effect = new THREE.Mesh(new THREE.SphereGeometry(.2, 12, 8), effectMaterial);
root.add(effect);
const lookAt = new THREE.Vector3(0, 1, 0);

function smooth01(x) {
  const u = THREE.MathUtils.clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
}
function envelopeAt(t) {
  return smooth01(t / .6) * (1 - smooth01((t - 6.8) / 1.2));
}
function cameraStateAt(t) {
  return new THREE.Vector3(0, 3.5 + .12 * Math.sin(t * .4), 11);
}

function stateAt(t) {
  const u = THREE.MathUtils.clamp(t / duration, 0, 1);
  const move = smooth01(u);
  return {
    rootPosition: start.clone().lerp(end, move),
    bob: .08 * Math.sin(2 * Math.PI * .8 * t),
    effectOpacity: envelopeAt(t),
    cameraPosition: cameraStateAt(t),
  };
}

function renderAt(t) {
  const s = stateAt(t);
  root.position.copy(s.rootPosition);
  root.position.y += s.bob;
  effect.material.opacity = s.effectOpacity;
  camera.position.copy(s.cameraPosition);
  camera.lookAt(lookAt);
  renderer.render(scene, camera);
}
```

给物体、手持物、阴影/反射、粒子发射器和字幕提供共用锚点；接触和环境反馈从最终变形后的锚点求值。累积粒子/物理若不能任意seek，必须用确定性初始化+时间步进/快照重建，不能只接上`t`就假定状态成立。

## 7. 按逐级证据迭代，而不是只检查代码能运行

| 检查 | 方法 | 暴露的问题 |
|---|---|---|
| 构图/代理模型 | 目标分辨率渲染，少量主形，正侧/目标机位 | 占幅、遮挡、空间关系、视线重心 |
| 剪影/灰模 | 关纹理、关特效和颜色干扰 | 身份、主形比例、连接、厚度和支撑 |
| Lookdev | 最终材质、主辅光、环境与阴影 | 材料差异、受光方向、深度层级 |
| 最终原尺寸 | 在实际输出分辨率看关键资产/区域 | 像素过密、空面、锯齿、材质噪声和细节退场 |
| 关键时间和连续片段 | 起/中/止，重要事件前中后，随机seek | 穿插、漂移、接触、闪烁、重复模式和时间不一致 |

遇到常见故障时先检查对应数据链：

| 现象 | 先查 | 修复方向 |
|---|---|---|
| 画面全空/模型不见 | `renderer.render`入口、scene/camera、near/far、对象可见性、包围盒、相机朝向 | 先用彩色`BoxGeometry`确认相机和曝光，再逐个恢复复杂对象 |
| 网格黑面/只看到内侧 | 索引绕序、法线、材质`side`、负缩放是否翻面 | 修网格法线/绕序；`DoubleSide`只作为排错或确有薄片双面需求 |
| 曲面像硬折纸或有黑斑 | 顶点法线、重复顶点接缝、退化三角形、非均匀缩放 | 修拓扑/平滑边组/法线矩阵和接缝，别用加亮材质遮盖 |
| 材料都像同一种塑料 | 金属/粗糙度、环境反射、主光面积/方向、色彩空间和tone mapping | 让每个材料有明确的反射/高光/透光差异，并在中性校准物上调光 |
| 细节消失或闪烁 | 屏幕像素尺寸、几何分段、mipmap、透明深度和相机距离 | 控制频率、加LOD/抗锯齿、调整透明排序或移除不可见的高频噪声 |
| 粒子/反射在seek后跳变 | `Math.random()`、累计delta、独立RAF、上一帧残留状态 | 固定seed，按绝对t重算，或增加可重建的物理步进/快照 |
| 水面有形变但无光感 | 顶点法线是否同步更新、坐标空间、材质/色彩输出 | 由同一波场求法线；再核对视角/主光与高光消费者 |

调试shader时先输出单一uniform/颜色/UV/法线为灰度或纯色，逐个确认输入，再恢复完整着色；不要同时改光照、曝光、法线和噪声。

每轮只修当前最影响焦点的一层：规格/构图→几何/结构→动画/锚点→材质/光照→FX/渲染。静帧漂亮不能证明动画通过；浏览器无错误或有非空Geometry也不能证明造型通过。每个关键结果必须来自当前Three.js代码和当前交付渲染，不能拿参考图或上一次旧渲染代替。

## 完成门槛

- 生产代码能说明主要画面对象由哪些Three.js几何/实例/材质/着色器生成。
- 图像生成参考没有被加载到最终场景；按获准例外使用的图片资源逐一记录。
- 重要资产在目标机位的轮廓、厚度/层次、颜色/受光和动画锚点都有可见验证。
- 可复现的代码和依赖随源码工程交付；离线HTML/MP4来自同一版本的Three.js场景。
- 交付说明讲清是全3D还是代码化2.5D，列出生成代码、非代码资产和未覆盖检查。
