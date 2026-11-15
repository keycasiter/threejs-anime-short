# 相机设计、观看覆盖与真实输入

交互3D默认完整水平环绕、合理俯仰、缩放与复位；导演影片只覆盖约定视锥/运镜。模式并存时分开保存相机，场景时钟不能覆盖用户视角。固定点全景与绕物三维分别交付。

## 从屏幕指针到语义对象

指针先从页面坐标减去canvas实际CSS矩形，再归一成NDC；不是除以整个窗口，也不乘DPR。以下使用当前Three、真实相机和要参与遮挡/拾取的roots；它读取最近命中，沿父链寻找`userData.entityId`。未标记的最近实体作为遮挡，不透过它选后方物体。

```js
function pickEntity(event,canvas,camera,roots){
  const rect=canvas.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return null;
  const x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;
  if(x<0||x>1||y<0||y>1)return null;
  camera.updateWorldMatrix(true,false);for(const root of roots)root.updateWorldMatrix(true,true);
  const ray=new THREE.Raycaster();ray.layers.mask=camera.layers.mask;ray.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),camera);
  const hit=ray.intersectObjects(roots,true).find(h=>{
    for(let o=h.object;o;o=o.parent)if(!o.visible)return false;
    const m=Array.isArray(h.object.material)?h.object.material[h.face?.materialIndex??0]:h.object.material;
    return m?.visible!==false;
  });if(!hit)return null;
  for(let o=hit.object;o;o=o.parent)if(o.userData.entityId!==undefined)return {entityId:o.userData.entityId,entity:o,hit};
  return null;
}
```

将地面/道具等实际遮挡物纳入roots；需要选择穿透时显式设计另一种模式。复杂透明、alpha裁边、实例、蒙皮和shader形变需匹配实际可见/交互语义：CPU三角形命中不自动知道shader裁掉的像素，instanceId也需映射到稳定实体。拖动Orbit与点击选择使用明确阈值或指针状态区分，避免拖完即误选。

静态合批后一个Mesh可对应多个逻辑对象。需要源级选择时，按[装配来源](assembly-provenance.md)把最近hit的faceIndex映射到实际成品顶点范围；继续保留最近遮挡语义，不按材质或全世界同色网格猜身份。

需要可控粗细的路径/标注时，条件读取[宽线方法](wide-lines.md)，按活动逻辑视口准备 resolution、补宽线距离过滤并声明虚线选择策略；仍保留上述最近遮挡与语义归属。

## 空间草案时确定包络

定义target、方位、俯仰、距离、FOV与near/far。全场围绕这个实际可达域建设承托、侧背、远景与天空；把8个水平代表方向各自需要读出的主体关系、环境层次及允许遮挡写入布局。每角度可以看同一主体，但不能只剩无信息背墙、黑幕或场地外壳。

构图/占幅按[空间方法](scene-layout.md)选择，不自动用全场AABB把主体缩小。相机边界来自内容和查看任务；限定地下/非设计内部合理，缩窄水平范围掩盖缺失场景不算完整360°。

### 第一人称出生点从最终地表求，不从场景原点猜

第一人称玩家的地面出生点/眼高，与环绕 `target/distance/polar`、第三人称跟随相机的角色点/相机臂端点，是不同状态。第一人称起点应落在实际可走表面上；先选路径入口的候选 `(x,z)`，再从最终地形/地面网格向下取样。只把可走面传入 `groundRoots`，水面、屋顶、装饰石和不可走边坡不要混入。坡度过滤后按世界竖直方向加眼高，并用项目的胶囊/角色碰撞检查确认身体和头顶净空。出生点在地形外、落入山体、悬空、位于水面或被屋檐/树干占据时，换候选点，不要只抬高相机掩盖空间错位。

[`findWalkableSpawn`](../assets/scene/walk-spawn.mjs)提供地表命中、父级变换后的世界法线、最大坡度过滤和可接入的占位净空回调。它不实现角色碰撞；没有传入 `isCandidateClear` 时，结果只证明找到了可走表面，不能证明出生点不被墙、树或屋顶占据。

```js
import { findWalkableSpawn } from './assets/scene/walk-spawn.mjs';

const spawn = findWalkableSpawn(THREE, {
  x: routeEntrance.x,
  z: routeEntrance.z,
  groundRoots: [walkableTerrain, walkablePlatforms], // 最终可走网格，不含道具/水面
  eyeHeight: 1.65,                                  // 使用场景单位
  maxSlopeDegrees: 32,
  isCandidateClear: ({ position, eyeHeight }) =>
    characterCapsuleIsClear(position, { radius: 0.32, eyeHeight }, finalBlockerMeshes)
});
if (!spawn) throw new Error('No safe walkable spawn candidate at the route entrance.');

camera.position.copy(spawn.position);
const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), routeEntrance.yaw);
camera.lookAt(spawn.position.clone().add(forward)); // 眼平线方向；仰俯角另设并限制
```

在目标视口实际运行后检查出生画面：入口/主焦点可读、前进方向有落脚空间，首帧没有地表穿屏或山体遮罩。移动更新也必须消费同一地形高度/碰撞源；只在初始化时修正眼高而不更新步行位置，仍会很快穿地或漂浮。第三人称相机还要独立校验跟随距离/相机臂与最终地形、树木和建筑的交叉；环绕作品则根据主体关系选 `target`，检查控制器 `update()` 后实际位置与完整取景。不要把第一人称眼高直接用作跟随/环绕机位。

相机可能接近地形/建筑时分别查两件事：

| 问题 | 核对方法 |
|---|---|
| 相机位置是否进入实体/被裁切 | 最终网格/等价几何查询，记录实际机位与安全间隙；near/far与包围体一起看 |
| 预期场景关系是否被遮住 | 向关键锚点/连接段射线查第一遮挡，再看实际画面；正净空不保证焦点可读 |

登记机位先确认控制器可接收其距离/俯仰；update后读回实际position/target，核对成立再保存或命名。只保存设计position字段会漏掉控制器限位改写。控制器自动推开/抬高后，重新检查实际构图与查看范围。透明排序、反射、阴影和细件按侧背/掠射角补测，不只测试正面。

页面存在标题/说明时，按[模型与界面代码](visual-construction.md#6-近景同时设计模型与界面)统一canvas投影与DOM坐标，为合法近景设计折叠/留白；模型不穿体与页面读得清分别检查。

## 最终入口的实际操作

1. 记录初始相机位置/target、azimuth、polar、distance，保存目标视口。
2. 用鼠标/触摸实际拖动一整圈，读回真实控制器/实际相机状态；至少观察8方位，完整水平轨迹应达到约359°以上。鼠标像素位移和脚本设机位不是实际角度证据。可用[`createOrbitCoverageRecorder`](../assets/runtime/scene-probes.mjs)记录OrbitControls真实的`change`事件、跨±π解包后的方位角、俯仰/距离和各方位代表机位：

```js
import { createOrbitCoverageRecorder } from './assets/runtime/scene-probes.mjs';

controls.autoRotate = false;        // 只测用户输入，不混入自动旋转
controls.update();                  // 先让真实控制器收敛到当前机位
const sweep = createOrbitCoverageRecorder(controls, {
  sectorCount: 8,
  minCoverageDegrees: 359,
  maxSampleStepDegrees: 90
});

// 此处由测试者实际拖动一整圈；应用现有帧循环继续调用 controls.update()。
// 松手后等待阻尼产生的 change 事件结束，再读取结果。
const trace = sweep.snapshot();
console.log(trace.angularSweepComplete, trace.visitedSectors, trace.missingSectors);
const measuredViews = trace.sectorSamples.filter(Boolean).map((sample, index) => ({
  id: `orbit-sector-${index}`,
  position: sample.position,
  target: sample.target
}));
sweep.dispose();
```

`angularSweepComplete`还要求采样点的俯仰变化和观察目标漂移处于配置容差内；它不表示目标可见、画面无遮挡或视觉质量通过。将`measuredViews`交给[`auditObservationSet`](core-systems.md)做真实特征/遮挡合同检查，并在浏览器逐方位查看画面。单次采样若跨过180°会产生角度别名；若`largeStepObserved`为`true`，降低手势速度并重测。自动旋转期间、控制器更新之前采样，或既无事件订阅也未手动调用`record()`时，不能用此结果证明用户环绕覆盖。

项目使用自定义相机控制器时，传入真实状态读回函数，并在控制器更新后、实际手势进行期间手动调用`record()`；也可以为实现`EventTarget`的控制器提供事件订阅函数自动采样。不要按拖动像素估角，也不要在更新控制器之前采样：

```js
const sweep = createOrbitCoverageRecorder(navigation, {
  readState: () => {
    const state = navigation.read();
    return { azimuth: state.azimuth, polar: state.polar, distance: state.distance,
      position: state.position, target: state.target };
  },
  // 可选：仅当控制器发出真实相机变化事件时使用；必须返回清理函数。
  subscribe: onChange => {
    navigation.addEventListener('change', onChange);
    return () => navigation.removeEventListener('change', onChange);
  }
});

// 在逐帧更新中：先消费相机输入，再读取真实相机状态。
function frame(dt) {
  navigation.update(dt);
  if (manualOrbitGestureActive) sweep.record();
  renderer.render(scene, camera);
}
```

自定义控制器必须能读回以世界+Z为方位零方向、向上为极角零方向的`azimuth`/`polar`，以及实际相机`position`和`target`；若项目采用其它角度约定，应在适配器中先转换到该约定。`subscribe`必须返回解绑监听器的函数；没有事件接口时用手动`record()`。帧循环未采样时会漏掉手势中经过的扇区；若控制器带阻尼，在阻尼结束前继续采样。

将角度路径与场景可见性接成同一份结果时，用[`auditOrbitObservations`](../assets/scene/observation-view.mjs)传入记录快照、关键表面样点和最终遮挡物；`requiredSectors`声明该特征必须读出的方位，`minVisibleFractionPerView`声明每个指定方位的最低无遮挡样点比例。例子里的sector 0/4来自实测环绕样本，并非预设镜头：

```js
import { auditOrbitObservations } from './assets/scene/observation-view.mjs';

const orbitAudit = auditOrbitObservations(THREE, {
  trace: sweep.snapshot(),
  features: [
    { id: 'scene-landmarks', points: landmarkSurfaceSamples,
      minCoverageFraction: 0.8 },
    { id: 'bridge-to-river-relation', points: bridgeRiverSamples,
      minCoverageFraction: 1,
      requiredSectors: [0, 1, 7],
      minVisibleFractionPerView: 0.8 }
  ],
  occluders: [finalWorldRoot],
  viewport: { width: 1280, height: 720 },
  overlays: [] // 若HUD覆盖画布中的锚点，传入其canvas-relative CSS矩形
});

console.table(orbitAudit.perFeatureSectorChecks);
if (!orbitAudit.complete) console.warn(orbitAudit.missingSectors, orbitAudit.failedSectorChecks);
```

`landmarkSurfaceSamples`/`bridgeRiverSamples`必须来自实际几何表面，`finalWorldRoot`必须覆盖会遮挡视线的最终Mesh；不要拿整个包围盒代替锚点，也不要漏掉树冠、屋檐等中层遮挡物。`minCoverageFraction`检查所有测量视图的并集；指定`requiredSectors`后再逐方位应用`minVisibleFractionPerView`，既能表达“总有一个方向能看清”，也能表达“这一关系在这些方位必须保留”。缺少目标扇区、角度路径不完整、几何合同失败都会让`complete`为false。该审计是CPU三角射线与投影检查，仍需逐扇区看浏览器实际画面；透明裁切、shader位移、反射、后期、构图与美术质量不由它证明。
3. 用滚轮/双指缩放，检查近/远端；再检查承诺的俯仰端点，看穿模、裁切、地平线/地面露边、空白侧背和信息遮挡。
4. 点击实际复位入口，等待阻尼稳定，核对position/target/方位/俯仰/距离回到设计容差；影片/自由模式来回切换也检查状态。

用可用浏览器自动化或CUA/MCP操作最终构建。保存入口/版本、实际输入、相机读回、当前页面图和观察结论；页面改动后重测受影响状态。静态包络图解释内容，真实输入解释操作，各自说明范围。若只能设机位，交互仍未验收。

## 调用与更新

使用同一锁定Three/addons，统一相机写入权；动画帧先求场景状态再更新控制器并绘制。按需渲染时，`change`回调只绘制：在该回调内再次`controls.update()`可能递归触发change。需要阻尼则在帧循环更新。现成[工作台](production-toolkit.md)使用无parent的PerspectiveCamera与OrbitControls，其余控制器需自己的snapshot/restore适配，不能假定同名接口兼容。
