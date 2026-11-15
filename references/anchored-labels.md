# 场景锚定标签

把标签当作场景语义与屏幕阅读之间的可维护接力。标签必须绑定实际`Object3D`锚点，内容使用安全文本赋值，几何位置和DOM/精灵尺寸分开定义。不要为每个对象各建一个渲染器，也不要把屏幕投影误称为遮挡检测。

## 先按可见信号选表示

| 需求 | 表示 | 尺寸/变换语义 | 使用限制 |
|---|---|---|---|
| 可读的说明文字、可关闭卡片、键盘操作、选择回调 | `CSS2DObject` + 共享`CSS2DRenderer` | CSS像素；随锚点投影，标签本身保持屏幕朝向 | 不受三维遮挡深度自动裁切；需为大量对象考虑标签预算与避碰 |
| 世界内标记、图标、总是朝向相机的短文字 | `THREE.Sprite`，可用程序Canvas贴图 | 世界米制尺寸或固定视口比例，二者分开实现 | 透明深度排序与画面尺寸必须实际检查；sprite geometry是Three共享资源 |
| 真正具有透视厚度/旋转的空间文字 | `CSS3DObject` 或真实文字网格 | CSS3D按世界变换；网格使用实际几何 | 不把它当作CSS2D标签；分别核对缩放、背面、字体/几何成本 |

先确定内容是否需要点击、是否必须被实体遮挡、是否应随距离变小、标签密度和离屏规则，再选表示。若只是数十个语义名称，DOM文字通常更容易访问；若是世界内的重复标记，Sprite批次更直接。屏幕固定比例的Sprite仍需每帧根据相机投影更新尺度。

## Canvas / Sprite：真实锚点与两种尺度

```js
import { createAnchoredCanvasLabel } from './assets/interaction/anchored-labels.mjs';

const handle = createAnchoredCanvasLabel(THREE, {
  scene,
  anchor: beacon.userData.labelAnchor, // 必须属于当前scene中的实际对象树
  text: '北侧观测点',
  sizeMode: 'world',                 // 'world' 或 'view'
  worldHeight: 0.42,                 // 世界单位；只在world模式读取
  // viewHeight: 0.045,              // 画布CSS视口高度的比例，范围0..1
  offset: [0, 0.8, 0],               // anchor局部坐标，不继承anchor缩放
  center: [0.5, 0],                  // 标签底边中心对齐锚点上方
  font: '600 28px system-ui, sans-serif',
  pixelRatio: 2,
  depthTest: true,
});

// render loop：world模式也更新位置；view模式必须交入当前活动相机。
handle.update(camera);
renderer.render(scene, camera);

// 文本、字体或字号变化后重新测量Canvas；离场时释放本标签拥有的资源。
handle.setText('南侧入口');
handle.dispose();
```

`worldHeight`是世界高度而不是CSS像素；helper依据`measureText`结果保持宽高比，使用sRGB CanvasTexture和共享Sprite几何。`viewHeight`按相机投影矩阵`elements[5]`将视口比例换算成世界尺度，因此需在相机投影更新后每帧调用`update(camera)`。Sprite跟随世界锚点但不继承其缩放。材质默认`depthTest:true`、`depthWrite:false`；改成始终置顶会改变遮挡语义，必须明确标示并在目标GPU上审阅。

此模块拥有CanvasTexture与SpriteMaterial；借用scene、anchor和Three.js共享Sprite geometry。dispose不销毁共享几何，也不销毁锚点或场景。

## HTML / CSS2D：共享渲染器和事件归属

```js
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createCSS2DAnnotation } from './assets/interaction/css2d-annotations.mjs';

const labelRenderer = new CSS2DRenderer();
labelHost.appendChild(labelRenderer.domElement); // 与canvas处于同一定位容器
const annotation = createCSS2DAnnotation(THREE, {
  CSS2DObject, scene, anchor: door.userData.labelAnchor, document,
  id: 'door:north', text: '北侧入口', offset: [0.5, 1.2, 0],
  leaderLine: true,
  onSelect: ({ id }) => setSelectedId(id),
  onClose: ({ id }) => setSelectedId(null),
});

function resize() {
  const rect = canvas.getBoundingClientRect();
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
  labelRenderer.setSize(rect.width, rect.height); // CSS像素，不乘DPR
}
const observer = new ResizeObserver(resize);
observer.observe(canvas.parentElement);

function frame() {
  requestAnimationFrame(frame);
  controls.update();
  annotation.update(); // 有引导线时，从真实锚点更新端点
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera); // 所有标签共享这一次render
}
```

外层标签层设`pointer-events:none`让拖拽/滚轮到达canvas；真正可交互的标签根及子控件设`pointer-events:auto`。关闭控件要阻止事件继续冒泡，并且不能触发选择回调。CSS2DObject使用CSS像素定位，不把`devicePixelRatio`乘进其尺寸；同一容器的CSS布局尺寸驱动camera、WebGL renderer和CSS2DRenderer同步更新。只监听`window.resize`无法覆盖面板开合等容器尺寸改变。

模块会把DOM文本写入`textContent`，并提供选择/关闭、显示/隐藏和可选的真实世界引导线。它拥有DOM节点、引导线几何及默认引导线材质；scene、anchor、渲染器和显式传入的线材质由调用者拥有。退出时先断开ResizeObserver与事件，再逐个`dispose()`标注，最后移除CSS2DRenderer并释放WebGL资源。

## 屏幕空间审计与可见性检查

CSS2D投影后，使用[屏幕覆盖层审计器](../assets/interaction/screen-overlay-audit.mjs)检查真实DOM框，而不是凭标签锚点估计是否入画。每个承诺相机/动画时刻，在`cssRenderer.render(scene,camera)`之后测量容器、标签和会遮挡文字的标题/控制卡片；坐标都用同一CSS像素视口：

```js
import { auditScreenOverlays } from './assets/interaction/screen-overlay-audit.mjs';

function auditLabels() {
  const viewport = labelLayer.getBoundingClientRect();
  const items = annotations
    .filter(a => a.readState().visible)
    .map(a => ({ id: a.element.dataset.annotationId, rect: a.element.getBoundingClientRect() }));
  const reserved = [titleElement, controlPanel]
    .filter(Boolean)
    .map((element, i) => ({ id: `ui-${i}`, rect: element.getBoundingClientRect() }));
  return auditScreenOverlays({
    viewport,
    items,
    reserved,
    safeInsets: { left: 16, top: 16, right: 16, bottom: 16 },
  });
}

cssRenderer.render(scene, camera);
const layout = auditLabels(); // FAIL时修正标签锚点/相机/界面留白后复测
```

审计报告逐项列出视口外溢、安全区越界、标签矩形相交和与保留界面区相交；只有明确设计为重叠的标签对才填入`allowOverlap`，并记录视觉理由。它不挪动标签、不判断三维实体遮挡、不证明文字本身可读；碰撞后仍须看真实画面。当前两两比较适合一组可见语义标签，不用于粒子或数千个重复标记；高密度标记先按语义/可见性筛选或聚类。函数和行为回归可用`node --test scripts/tests/screen-overlay-audit.test.mjs`检查。

动画/导览按每个关键状态分别取框并保存结果，不能只检查静态首帧；滚动相机轨迹也须覆盖端点与靠近边界的时刻。三维样点被实体挡住仍按实际Mesh射线/深度证据检查，不与DOM矩形审计混为一谈。

CSS2DRenderer只做投影，不做实体深度遮挡、标签避碰、空间密度预算或焦点排序。`CSS2DObject.visible`和投影位置属于几何/相机状态；是否隐藏或裁剪需由项目按真实Mesh射线、语义优先级或屏幕预算显式决定。Sprite的深度测试由GPU执行，但透明排序、边缘、背面/视锥行为仍需实渲染审查。可选引导线只连接锚点与标签世界位置，不自动生成箭头头部，也不处理多个标签互相绕让。

每次提交至少检查：

1. 一个近锚点与一个远锚点，旋转/缩放相机后仍绑定正确对象；world标签随距离变小，view标签保持约定的画面高度。
2. 目标画布不是全屏：容器偏移、面板开合和纯容器resize后，canvas、相机和CSS2D投影仍对齐；DPR变化不改变DOM CSS像素尺寸。
3. 在实际几何前后移动锚点，确认DOM遮挡策略与Sprite深度策略符合预期；离视锥对象按约定隐藏或裁剪。
4. 点击标签、关闭控件、canvas拖动/滚轮；控件不误触发选择，标签区域外的输入能到达OrbitControls。
5. 更新长短文本、批量加入/移除并重复重建；检查边界、投影、重复监听、材质/纹理/线几何释放及控制台异常。

随包可运行例见[锚定标签实验](../assets/examples/anchored-label-lab/index.html)，资源生命周期边界及方法测试见`assets/interaction/anchored-labels.mjs`、`assets/interaction/css2d-annotations.mjs`、`assets/interaction/screen-overlay-audit.mjs`和`node --test scripts/tests/anchored-labels.test.mjs scripts/tests/css2d-annotations.test.mjs scripts/tests/screen-overlay-audit.test.mjs`。例子证明模块级r187接线，不证明拥挤场景自动避让或完整作品画质。
