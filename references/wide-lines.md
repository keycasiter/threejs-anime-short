# 宽线：活动视口、端点与拾取

仅在标注/路径需要可控粗细或宽线拾取时使用；普通语义拾取仍按[相机与输入](camera-interaction.md)的最近遮挡规则。这里用 WebGL 的 Three r187（`three@0.187.0`）及同包 addons；不是实体管道，也不承诺导出为实体网格。

## 单位与接线

| 项目 | 合同 |
|---|---|
| 连续/独立 | `LineGeometry` 的 n 个点产生 n−1 条连接段；`LineSegmentsGeometry` 每六个数是一对独立端点。示例数据仅为可替换技术夹具。 |
| 屏幕宽度 | `worldUnits=false` 的 linewidth 是全宽 CSS/逻辑像素。普通 canvas 使用当前 view 的逻辑宽高；不乘 DPR。双视口每次分别设置 resolution。 |
| 世界宽度 | `worldUnits=true` 的 linewidth 是全宽世界单位；parent/object scale 改变中心线端点，不乘这个标量宽度。CPU 正交射线可测此合同；GPU 世界宽度仅对实测 PerspectiveCamera 条件取得资格。 |
| 视口生命周期 | 原生 onBeforeRender 从 renderer.getViewport 更新 resolution；首次 render 前、resize 后、隐藏对象的主动查询及切换 view 时均需显式 prepareView。共享材质每次读写当前 view；以下独占材质避免跨 view 状态混淆。RT/XR 必须另定 view 单位合同及更新 hook。 |
| 宽度模式切换 | worldUnits 改 define 后显式 needsUpdate；r187 setter 不自动触发。 |

偏轴 OrthographicCamera 的原生世界宽线不能承诺精确居中或精确光栅宽度：r187 shader 的挤出方向及片元距离依赖相机原点射线。实测理想中心 279.5px，实际 277.5px，保留为原生限制。正交屏幕宽模式已在 DPR1/2、resize、双视口取得实测资格；世界宽模式实测使用 PerspectiveCamera，并比较相同世界端点的 parent 变换与烘焙结果。CPU 命中不能替代这些渲染证据。

## 可直接执行的 ESM

保存以下完整块为 `wide-lines.mjs`。Node 22 下先安装锁定 `three@0.187.0`，或设置 `THREE_MODULE` 为该包实际 `build/three.module.js` 的绝对路径；addons 从同一包定位，不依赖工作区研究路径。该块不创建 DOM/WebGL，导出的真实对象交给调用方场景与渲染循环。

```mjs
import { pathToFileURL } from 'node:url';
const moduleURL = process.env.THREE_MODULE
  ? pathToFileURL(process.env.THREE_MODULE).href
  : import.meta.resolve('three');
export const THREE = await import(moduleURL);
const addon = name => new URL(`../examples/jsm/lines/${name}.js`, moduleURL).href;
const { Line2 } = await import(addon('Line2'));
const { LineGeometry } = await import(addon('LineGeometry'));
const { LineSegments2 } = await import(addon('LineSegments2'));
const { LineSegmentsGeometry } = await import(addon('LineSegmentsGeometry'));
const { LineMaterial } = await import(addon('LineMaterial'));

function checkedPositions(positions, segments) {
  const stride = segments ? 6 : 3;
  if (!positions || positions.length < 6 || positions.length % stride ||
      !Array.from(positions).every(Number.isFinite)) throw new Error('invalid endpoints');
  const stored = new Float32Array(positions);
  if (!stored.every(Number.isFinite)) throw new Error('nonfinite Float32 endpoints');
  const step = segments ? 6 : 3;
  for (let i=0; i<stored.length-3; i+=step) {
    if (stored[i]===stored[i+3] && stored[i+1]===stored[i+4] &&
        stored[i+2]===stored[i+5]) throw new Error('zero-length segment in Float32 storage');
  }
  return stored;
}
export function createWideLine({positions, segments=false, width=10, worldUnits=false, dashed=false}) {
  const stored=checkedPositions(positions, segments);
  if (!Number.isFinite(width) || width<=0) throw new Error('invalid full width');
  const geometry = segments ? new LineSegmentsGeometry() : new LineGeometry();
  geometry.setPositions(stored);
  const material = new LineMaterial({linewidth:width, worldUnits, dashed});
  const line = segments ? new LineSegments2(geometry,material) : new Line2(geometry,material);
  line.computeLineDistances();
  return line;
}
export function prepareView(line, view) {
  if (!(view.width>0 && view.height>0) ||
      ![view.left,view.top,view.width,view.height].every(Number.isFinite)) throw new Error('invalid logical view');
  line.material.resolution.set(view.width,view.height);
}
export function setWidthMode(line, worldUnits, width) {
  if (!Number.isFinite(width) || width<=0) throw new Error('invalid full width');
  const material=line.material;
  if (material.worldUnits!==worldUnits) { material.worldUnits=worldUnits; material.needsUpdate=true; }
  material.linewidth=width;
}
export function editSegment(line, index, start, end) {
  if (start?.length!==3 || end?.length!==3) throw new Error('endpoints must be exact triples');
  const stored=checkedPositions([...start,...end],true);
  const g=line.geometry, a=g.attributes.instanceStart, b=g.attributes.instanceEnd;
  if (!Number.isInteger(index) || index<0 || index>=a.count) throw new Error('invalid segment');
  a.setXYZ(index,stored[0],stored[1],stored[2]); b.setXYZ(index,stored[3],stored[4],stored[5]);
  a.data.needsUpdate=true; // start/end share this actual interleaved buffer
  g.computeBoundingBox(); g.computeBoundingSphere();
  // Keep uploaded distance-buffer identity: native computeLineDistances allocates replacements.
  const ds=g.attributes.instanceDistanceStart, de=g.attributes.instanceDistanceEnd;
  let distance=0;
  for (let i=0;i<a.count;i++) {
    ds.setX(i,distance);
    distance+=Math.hypot(b.getX(i)-a.getX(i),b.getY(i)-a.getY(i),b.getZ(i)-a.getZ(i));
    de.setX(i,distance);
  }
  ds.data.needsUpdate=true;
}
export function replacePositions(line, positions) {
  // Exclusive geometry ownership only. Build/validate first; invalid input preserves live geometry.
  const segments=!line.geometry.isLineGeometry;
  const stored=checkedPositions(positions,segments);
  const next=segments ? new LineSegmentsGeometry() : new LineGeometry();
  next.setPositions(stored);
  const previous=line.geometry;
  previous.dispose(); // renderer releases ALL old buffers while old attributes remain attached
  line.geometry=next;
  line.computeLineDistances(); // new geometry, not uploaded yet: allocate distances once
}
export function pickWideLine(line, camera, event, view, {near=0,far=Infinity,threshold=0}={}) {
  prepareView(line,view); // also before render/when hidden; hidden query is deliberate
  const x=(event.clientX-view.left)/view.width, y=(event.clientY-view.top)/view.height;
  if (x<0 || x>1 || y<0 || y>1) return [];
  camera.updateWorldMatrix(true,false); line.updateWorldMatrix(true,false);
  const ray=new THREE.Raycaster(); ray.layers.mask=camera.layers.mask;
  ray.near=near; ray.far=far; ray.params.Line2={threshold};
  ray.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),camera);
  return ray.intersectObject(line,false).filter(h=>h.distance>=near && h.distance<=far);
}
export function closeWideLine(line) {
  line.visible=false; line.removeFromParent(); line.geometry.dispose(); line.material.dispose();
}
// Minimal consumer: a real orthographic camera and Line2, queried before any render.
export const camera = new THREE.OrthographicCamera(-2,2,2,-2,0.1,100);
camera.position.z=5; camera.updateProjectionMatrix();
const example=createWideLine({positions:[0,-1,0,0,1,0]});
const view={left:0,top:0,width:400,height:400};
prepareView(example,view); // call again before each ordinary canvas view render
export const exampleHits=pickWideLine(example,camera,{clientX:204,clientY:200},view);
closeWideLine(example);
```

每个 view render 前先设置 renderer viewport/scissor（逻辑单位）及 prepareView，再 render。`view.left/top` 是该 view 在页面中的 CSS 起点，可由 canvas 的实际矩形加子视口偏移得到；不能用整个 window 尺寸。相机投影/宽高比由调用者按活动 view 更新；上例正交范围由调用者定义。

## 几何更改与交互语义

初次构造可用 `setPositions` 与一次 computeLineDistances；两者都会分配新属性。上传后不要在同一 geometry 反复调用它们覆盖旧属性：renderer 释放 geometry 时只能看到仍附着的属性，已替换的上传缓冲可能失去释放入口。

创建、修改和替换都先转成私有 Float32 坐标，检查实际存储的有限性与非零段；有限 JS 数值若溢出或两个端点舍入重合也拒绝。`editSegment` 的 start/end 各须恰好三个分量；失败发生在接触现有 geometry、bounds、距离或上传版本之前。普通数组及数值 TypedArray 使用相同存储合同。

固定段数用 `editSegment`：操作真实 interleaved 端点、标记共享 data 上传、重算 box/sphere；累计局部距离写回现有 distance 属性并标记其共享 data，不替换端点或距离缓冲身份。不能改普通 position 代替。该函数按独立段修改；连续折线共享拐点时同时改相邻段。

整条点列/段数变化用 `replacePositions`：先验证并构造新 geometry，再于旧属性仍附着时 dispose 旧 geometry，切换到新 geometry，首次生成距离。方法保持原连续/独立模式，仅适用于独占 geometry；共享 geometry 必须先由其所有者协调全部消费者，不能逐线释放。实际 render 前完成一次替换，不能在中途使用已释放的旧 geometry。

`pointOnLine` 是变换后中心线锚点，`point` 在拾取射线上；`faceIndex` 是段序号。r187 原生宽线不落实 Raycaster near/far，示例明确按 hit.distance 过滤。`params.Line2.threshold` 加到全宽，单位随宽度模式；它不是普通 Line 的 threshold。世界宽 CPU 命中不证明位于相机视锥内。

示例采用**整条标注可选**：即使虚线 gap 也可命中。computeLineDistances 的累计距离是 geometry-local；shader 比较 `(dashScale*dLocal+dashOffset) mod (dashSize+gapSize)`。worldUnits=false 不会把虚线长度转成 CSS 像素，缩放对象也不重算距离。若要世界长度虚线，先烘焙世界端点到 identity 对象；屏幕长度虚线需独立投影适配。可见 dash、alpha 裁边、shader 裁切等逐像素拾取须另做策略，当前方法不是 visible-pixel picker。

集成语义选择时保留原 pickEntity 的最近命中/未标记遮挡及祖先可见性规则：在同一次 roots 查询前对其中宽线准备当前 view，查询后对宽线补 distance 过滤，再执行原有最近可见命中与父链 entityId 解析。不能先只选宽线再绕过前方遮挡物。隐藏拾取是单独的主动查询，不改变普通可见性语义。

closeWideLine 只适用于本例新建且独占 geometry/material 的对象；借用共享材质由更长生命周期所有者释放，不能逐线 dispose。调用方关闭事件监听与帧循环并移除所属场景节点。

## 验证边界

Node 专项验证连续/独立端点、原地更新与 bounds、4/6 CSS 像素正交拾取、距离过滤、世界宽 parent scale 与锚点、gap 反例及局部距离；不证明图像宽度、MSAA 或画质。实际目标 renderer 另验 near-plane 穿越、急转弯、端帽/深度、退化投影方向和 alpha-to-coverage（需多采样目标）。现有实测近裁剪/急转弯仅确认可见覆盖；RT/XR、全部驱动、MSAA 和通用艺术质量仍未取得资格。

来源：[Line2](https://threejs.org/docs/#examples/en/lines/Line2)、[LineMaterial](https://threejs.org/docs/#examples/en/lines/LineMaterial)。以同包 r187 addon 实现为版本核对基准。
