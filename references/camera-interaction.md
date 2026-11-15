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

### 第一人称连续贴地移动与净空接线

出生点正确不代表移动正确。持续移动必须从最终可走表面重新取高程，并按角色身体碰撞检查每一步；否则角色会在斜坡漂浮/陷地、穿过立面或跨过实际断层。低速导览可用[`createGroundedWalkMotor`](../assets/scene/walk-motor.mjs)：它将水平位移分段，逐轴尝试以支持沿墙滑动；每段从最终walkable roots向下求交，按世界法线限制坡度，并用`maxStepUp`/`maxStepDown`拒绝不可跨越的高差。它只处理“已站在可走面上的水平行走”，不实现重力、跌落、跳跃和身体碰撞。`isCandidateClear`必须接入项目自己的角色胶囊/净空查询；不能用始终返回`true`的占位回调验收成品。

对于自由物理/FPS游戏，r187随包官方addon更合适：[`PointerLockControls`](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/controls/PointerLockControls.js)只负责视线锁定与方向读取；[`Capsule`](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/math/Capsule.js)+[`Octree`](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/math/Octree.js)负责动态角色与静态三角网格碰撞。三者必须从同一精确版本的`three@0.187.0`加载。Octree应只由静态碰撞网格构建；重复、透明或动画渲染对象应有经核验的简化碰撞体，而不是把整场所有视觉网格盲目塞入碰撞树。官方 [`games_fps`](https://github.com/mrdoob/three.js/blob/r187/examples/games_fps.html)按`capsuleIntersect()`的法线/深度修正角色，并用固定小步处理以降低高速穿透风险。若选用此物理路径，不再同时以ground motor改写相同Y坐标：必须有唯一的位置/速度所有者。

纯贴地导览的最小接线如下；地面采样和角色净空来自同一套最终空间数据：

```js
import { findWalkableSpawn } from './assets/scene/walk-spawn.mjs';
import { createGroundedWalkMotor } from './assets/scene/walk-motor.mjs';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Octree } from 'three/addons/math/Octree.js';

const eyeHeight = 1.65, radius = 0.28;
const controls = new PointerLockControls(camera, renderer.domElement);
const worldOctree = new Octree().fromGraphNode(staticCollisionRoot);
const playerCapsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), radius);
function isCandidateClear({ position }) {
  const footY = position.y - eyeHeight;
  playerCapsule.start.set(position.x, footY + radius, position.z);
  playerCapsule.end.set(position.x, position.y - radius, position.z);
  const hit = worldOctree.capsuleIntersect(playerCapsule);
  return !hit || hit.depth < 1e-4; // 接触地面可接受；有穿透时拒绝此候选
}

const spawn = findWalkableSpawn(THREE, {
  x: routeStart.x, z: routeStart.z,
  groundRoots: finalWalkableRoots, eyeHeight, maxSlopeDegrees: 28,
  isCandidateClear
});
if (!spawn) throw new Error('No clear walkable spawn on final terrain.');
camera.position.copy(spawn.position);

const motor = createGroundedWalkMotor(THREE, {
  groundRoots: finalWalkableRoots, eyeHeight,
  maxSlopeDegrees: 28, maxStepUp: 0.28, maxStepDown: 0.36,
  maxSegmentLength: 0.18, isCandidateClear
});
const forward = new THREE.Vector3(), right = new THREE.Vector3();
function moveOnFrame(dt, inputX, inputY) {
  controls.getDirection(forward); forward.y = 0; forward.normalize();
  right.crossVectors(forward, camera.up).normalize();
  const displacement = forward.multiplyScalar(inputY).addScaledVector(right, inputX);
  if (displacement.lengthSq() > 1) displacement.normalize();
  displacement.multiplyScalar(walkSpeed * dt);
  camera.position.copy(motor.move(camera.position, displacement).position);
}
```

示例中的`PointerLockControls`只旋转相机；调用其`moveForward()`/`moveRight()`会绕开ground motor和净空回调，所以行走位置由`moveOnFrame`单独持有。若需要跳跃、跌落、推挤或高速运动，改由Capsule+Octree物理更新统一拥有角色位置，再逐帧把胶囊端点映射到相机；勿叠加两套位移更新。可运行的贴地斜坡/台阶/门洞测试页见[第一人称行走前向样例](../evals/current-candidate-pilot/first-person-walk-forward-r1/index.html)（评测产物不随Skill包发布）。验收至少覆盖平地、目标坡度边界、上/下台阶阈值、门洞/窄通道、墙角滑动、断面边缘与复位；记录首帧、移动后相机/脚底高度、阻挡状态和实屏视图。

### 第三人称跟随：相机臂扫掠、绕障与平滑

角色移动不等于相机跟随正确。相机目标点、期望端点和路径间的净空必须与最终世界几何一起检查；只从角色到相机打一条中心射线，会漏掉视锥附近的小杆件，直接把被挡距离硬截断也会产生贴脸跳变。对运行中的第三人称相机，使用[`createFollowCameraSolver`](../assets/scene/follow-camera.mjs)在默认相机臂及少量项目验证过的备选偏移间做五射线截面扫掠。它返回安全机位和阻挡信息，不移动角色、不更新障碍物矩阵，也不负责时间平滑或材质淡出。

```js
import { createFollowCameraSolver } from './assets/scene/follow-camera.mjs';

// blockers只收集真实可能挡住相机的最终网格；不要把跟随角色放进去。
const cameraSolver = createFollowCameraSolver(THREE, {
  occluders: cameraBlockerMeshes,
  volumeRadius: 0.24,       // 相机/取景余量，使用场景单位
  skin: 0.18,               // 命中面前的安全间距
  minDistance: 0.7,          // 小于该值时显式报告空间不足
  detours: [                 // 世界坐标候选；按本项目的实际净空验证后配置
    [0, 0.9, 0], [0, 1.6, 0], [0.7, 0, 0], [-0.7, 0, 0]
  ]
});

const pivot = new THREE.Vector3();
const desiredEndpoint = new THREE.Vector3();
const smoothedPosition = new THREE.Vector3();
const cameraUp = new THREE.Vector3(0, 1, 0);

function updateFollowCamera(dt) {
  // 先更新角色、动画、程序形变和会移动的遮挡物，再求相机。
  scene.updateMatrixWorld(true);
  pivot.copy(actor.position).add(new THREE.Vector3(0, actorEyeHeight, 0));
  desiredEndpoint.copy(pivot).add(desiredBoomOffset); // 期望臂偏移由相机方位/俯仰/距离算出
  const solved = cameraSolver.solve(pivot, desiredEndpoint);

  // 碰撞时立刻拉近；空间变开后再平滑移远，避免插值穿过刚避开的几何。
  if (smoothedPosition.lengthSq() === 0 || solved.position.distanceTo(pivot) < smoothedPosition.distanceTo(pivot)) {
    smoothedPosition.copy(solved.position);
  } else {
    smoothedPosition.lerp(solved.position, 1 - Math.exp(-dt * 5));
  }
  camera.position.copy(smoothedPosition);
  camera.up.copy(cameraUp);
  camera.lookAt(pivot);

  if (solved.tooClose) showCameraClearanceWarning();
  setCameraStatus({ blocked: solved.blocked, detoured: solved.detoured,
    distance: solved.actualDistance, obstacle: solved.primaryObstacle ?? solved.obstacle });
  // 若产品允许淡出挡镜物体，在独立回调里管理材质克隆/还原与dispose。
}
```

候选`detours`是世界XYZ偏移，不是自动找到的全空间路径规划。先根据角色可走区、顶棚、树冠与门洞净空选少量候选，并确保候选不会把主体关系、地平线或操作区域移出画面；分数优先保留清晰且接近期望的原路径，备选只在确实改善安全距离时采用。对象含透明面、实例、蒙皮或Shader位移时，登记与实际可见遮挡一致的碰撞代理并在该状态下人工核对。障碍Mesh必须在调用`solve`前更新世界矩阵。若`tooClose`为真，应暂停/限速角色、改走候选相机侧位或提示空间不足；不可把机位强行推过墙体。相机内插、淡出状态及其克隆材质由调用端拥有，结束时需恢复原材质并释放克隆。

跟随相机要分别验收：初始构图/转向后主体占幅；无遮挡时保持期望臂；窄口或横梁处不穿模、不跳脸并能恢复；所有备选镜位仍看清角色和当前路径；复位、拖动和缩放状态均可用。五射线只是低成本近似，不能证明连续相机体积无碰撞，结果仍须在目标浏览器操作并查看实际画面。

在目标视口实际运行后检查第一人称出生画面：入口/主焦点可读、前进方向有落脚空间，首帧没有地表穿屏或山体遮罩。移动更新也必须消费同一地形高度/碰撞源；只在初始化时修正眼高而不更新步行位置，仍会很快穿地或漂浮。第三人称相机还要独立校验跟随距离/相机臂与最终地形、树木和建筑的交叉；环绕作品则根据主体关系选 `target`，检查控制器 `update()` 后实际位置与完整取景。不要把第一人称眼高直接用作跟随/环绕机位。

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
