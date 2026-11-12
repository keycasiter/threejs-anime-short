# Three.js代码接力：从设计输入到真实消费者

这是生产流程的代码入口，按当前工项读对应小节。构图、比例、材质与复杂度仍由当前题材的参考决定；示例演示构造关系，不指定新作品使用同一造型或风格。全部几何由代码生成，图像用于设计参考。

## 从哪里开始

| 当前动作 | 读/运行什么 | 实际可迁移关系 |
|---|---|---|
| 选择表示、接入工厂或重建结构 | [实现基础](implementation-foundations.md)；[运行例](../assets/examples/foundation-lab/index.html) | 特征→已有/待建表示；局部/世界接力；显式资源归属与失败保留旧件 |
| 组合曲面/负形、分层区域与统一材光 | [核心三线](core-systems.md)；[完整入口](../assets/examples/core-lab/index.html) | 几何/接口→世界/完整足迹→材料绑定/环境→观察与更新 |
| 将短需求或宏观范围变成空间 | [空间代码](#1-空间由共享关系生成) | 区域/路线/地貌→真实网格；全貌、区域、近景各承担用途 |
| 写主形、中层与连接 | [构造代码](#2-主形转折与真实接点)；[完整工厂](../assets/examples/guided-assembly.mjs) | 分段宽深/转折→同源网格→实际接点→附属件 |
| 扩展群体并留出空隙 | [组团代码](#3-先结构组团再分布成员) | 有身份的簇/包络/开口→稳定实例；结构与表面随机流独立 |
| 做材料、动画和波面 | [表现接线](#4-表面受光和位移一起接线) | 材料形成区/实际环境→PBR；同一位移→位置/法线/附着物 |
| 调参数、看动作与控制成本 | [消费者检查](#5-写完当前关系就读回消费者) | 参数→真实顶点/矩阵；合法保持与空节点有区别 |
| 构造存在但目标读不清、重复件收口或近景粗糙 | [视觉构造代码](visual-construction.md) | 实际表面样点/遮挡、完整足迹裁切、内部原型、采样预算与材料响应 |

完整可运行入口为[代码接力场景](../assets/examples/guided-world/index.html)，[main.mjs](../assets/examples/guided-world/main.mjs)包含renderer、光照、工厂、材质、波面、交互和释放。复制`assets`目录及锁定Three包到项目；在该例`vendor/`放Three的`build/`和`examples/jsm/`，保留LICENSE，用本地HTTP打开。下列片段假设项目根有同一`assets`目录；`T/scene/renderer/camera`等上下文由完整入口建立。

## 1 空间由共享关系生成

先把场地拆成区域、连接、承托和观察任务，再写几何。短需求由Agent完成这份设计；宏观范围保留主要区域、连接、地标和区域差异，分别取全貌/区域/近景。参考图数量随未知增加，全貌不能代替接口和材料近景。

### 连接图真正生成路面

先用[compileCorridorGraph](../assets/scene/corridor-layout.mjs)得到带真实宽度、共享节点和quad的图，再调用下面完整函数。这里输入为米制XZ，输出为Y=.02的薄路面；它不生成道路厚度、复杂路口、坡面承托或建筑。对应对象另按实际宿主构造。

```js
function buildCorridorSurface(T, graph, material) {
  const root = new T.Group(), owned = [];
  for (const edge of graph.edges) {
    const positions = edge.quad.flatMap(([x,z]) => [x,.02,z]);
    const g = new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    g.setIndex([0,1,2,0,2,3]);
    g.computeVertexNormals();
    const mesh = new T.Mesh(g,material);mesh.receiveShadow=true;
    root.add(mesh);owned.push(g);
  }
  let disposed=false;
  return {root,dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const g of owned)g.dispose();}};
}
```

路带、地块、入口和分布禁区读取同一个编译图；不要从图上抄一遍坐标再各自绘制。地块接线与完整图例见[算法代码](algorithm-recipes.md#世界连接图与局部语法)。复杂承托查询用[宿主工具](production-toolkit.md#几何与关系工具)。

### 地貌先有脊谷结构，再增加微细变化

下面字段具有独立的脊高/宽、谷深/宽和脊走向；偏导来自同一高度公式。它展示中层形态如何进入顶点，不是完整地貌或侵蚀模拟。单值高度场不能表达悬挑和洞穴；这些形态选择显式网格或体积表示。

```js
function createRidgeValleyField({ridgeHeight=3,ridgeWidth=2.4,
  ridgeZ=-2,valleyDepth=1.1,valleyWidth=1.6,valleyX=2}={}) {
  const values=[ridgeHeight,ridgeWidth,ridgeZ,valleyDepth,valleyWidth,valleyX];
  if(!values.every(Number.isFinite)||ridgeHeight<0||valleyDepth<0||ridgeWidth<=0||valleyWidth<=0)
    throw new RangeError('finite heights and positive widths required');
  function sample(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z))throw new TypeError('finite xz required');
    const center=ridgeZ+.4*Math.sin(x*.32),centerDx=.128*Math.cos(x*.32);
    const d=z-center,v=x-valleyX;
    const ridge=ridgeHeight*Math.exp(-d*d/(ridgeWidth*ridgeWidth));
    const valley=valleyDepth*Math.exp(-v*v/(valleyWidth*valleyWidth));
    return {height:ridge-valley,
      dx:2*ridge*d*centerDx/(ridgeWidth*ridgeWidth)+2*valley*v/(valleyWidth*valleyWidth),
      dz:-2*ridge*d/(ridgeWidth*ridgeWidth)};
  }
  return {sample};
}
```

```js
import {createHeightFieldGeometry} from './assets/environment/height-field.mjs';
const field=createRidgeValleyField({ridgeHeight:4,ridgeWidth:2.8,valleyDepth:1.2});
const terrainGeometry=createHeightFieldGeometry(T,field,{
  sizeX:24,sizeZ:18,segmentsX:120,segmentsZ:90
});
const terrain=new T.Mesh(terrainGeometry,new T.MeshStandardMaterial({color:0x8a947b,roughness:.9}));
scene.add(terrain);
```

脊谷、台地和断面按参考的方向与层级设计；残余噪声放在它们之后。植物/基础要贴当前发出的三角网格，使用surface sampler或射线；解析场在网格内部一般不等于线性三角面高度。看实际剖面、侧光灰模和完整区域，不以颜色条纹冒充几何层理。

## 2 主形转折与真实接点

### 从主比例到内部站位

为身份轮廓、内部转折、开口/壁厚和连接分别设置输入。[完整工厂](../assets/examples/guided-assembly.mjs)将`span`分配到六个内部站位，生成弯折/收分，并从发出网格派生支撑、束带和附属框；它返回真实`root/source/anchors/parts/update/dispose`。主形与邻件由同一个工厂构建，样件和全场调用同一函数。

```js
import {createSectionLoftSource} from './assets/geometry/loft-source.mjs';
const source=createSectionLoftSource(T,{
  stations:[
    {center:[0,0,0],width:1.2,depth:.8},
    {center:[0,2,0],width:1.6,depth:.9},
    {center:[1.2,3,.2],width:.8,depth:.5},
    {center:[2.8,3.6,.3],width:.4,depth:.3}
  ],radialSegments:32,reference:[0,0,1],uvMeters:1
});
const body=new T.Mesh(source.geometry,new T.MeshStandardMaterial({color:0xabc3b3,roughness:.5}));
scene.add(body);
const site=source.surfaceAt(.62,.12);
// site.point lies on an emitted side triangle; site.frame +Z is its face normal.
const marker=new T.Mesh(new T.SphereGeometry(.06,12,8),new T.MeshBasicMaterial({color:0xcc7744}));
marker.position.copy(site.point);body.add(marker);
```

`u`按站位折线弧长0..1，`v`按径向顶点参数0..1，不是椭圆周长；frame的+Y尽量沿纵向，+Z为实际三角面法线。采样在geometry局部，body变换后用`localToWorld()`和normal matrix；端盖、融合、自交检查不在此API范围。保留采样geometry的拓扑和位置，重建时重新采样；急弯宽截面先设计过渡站位，避免折叠。

有装配关系时，把`site.frame`存为真实局部端口，用[placeAtAnchor](../assets/scene/anchor-connection.mjs)放置来件；来件接口方向和有意留缝/插入量必须定义。自然分枝还需设计接合体积、收分和曲率，点落在表面不代表已形成连续分枝。详见完整工厂的`service`与`base`锚点。

### 动件在合批前独立建根

```js
import {createAssetAssembly} from './assets/scene/asset-assembly.mjs';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const assembly=createAssetAssembly(T,{mergeGeometries});
const plateGeometry=new T.BoxGeometry(2,.2,1);
const borrowedMaterial=new T.MeshStandardMaterial({color:0x8ba6a0});
assembly.add(plateGeometry,borrowedMaterial); // static snapshot
plateGeometry.dispose();
const pivot=new T.Group(); // parentless when registered
const movingGeometry=new T.BoxGeometry(.3,1.1,.3);
const visiblePart=new T.Mesh(movingGeometry,borrowedMaterial);
pivot.add(visiblePart);assembly.dynamic(pivot);
const built=assembly.finish();scene.add(built.root);
function updateRigid(time){pivot.rotation.y=.4*Math.sin(time);}
updateRigid(1); // the actual visible mesh keeps its pivot ancestor
// Release: built.dispose(); movingGeometry.dispose(); borrowedMaterial.dispose();
```

静件按照材质/阴影/图层分桶；所需UV/normal保留。现有装配器不接受输入tangent，法线贴图需显式切线时在最终几何按真实UV重建，方法见[工具契约](production-toolkit.md#程序表面同源通道实际尺度和复用)。自写批处理同样保留声明动件的可见子树与更新句柄。

## 3 先结构组团再分布成员

先设计骨架/构造原型，再给成员包络、透空、密度和宿主。下面函数仅布成员中心：输入是已经设计好的簇和真实局部frame，可用于枝团、岩组或陈设群；完整足迹与碰撞资格另由当前对象定义。无骨架的点簇不能替代树枝或承托。

```js
function buildClusterInstances(T,{clusters,geometry,material,streams}) {
  if(!Array.isArray(clusters)||!geometry?.isBufferGeometry||!material?.isMaterial||!streams?.stream)
    throw new TypeError('clusters, borrowed geometry/material and named streams required');
  const ids=new Set(),placements=[];let requested=0,candidates=0;
  for(const c of [...clusters].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
    if(typeof c.id!=='string'||!c.id||ids.has(c.id))throw new Error('unique cluster id required');ids.add(c.id);
    if(!c.frame?.isMatrix4||!c.frame.elements.every(Number.isFinite)||!Array.isArray(c.radii)||c.radii.length!==3||!c.radii.every(x=>Number.isFinite(x)&&x>0)||!Number.isInteger(c.count)||c.count<0||c.count>100000)
      throw new RangeError('finite frame, positive radii and bounded integer count required');
    const opening=new T.Vector3(...(c.opening??[0,0,1]));
    const cosine=c.openingCosine??.7;
    if(!Number.isFinite(opening.length())||opening.length()===0||!Number.isFinite(cosine)||cosine<=-1||cosine>1)throw new RangeError('opening direction and cosine invalid');
    opening.normalize();requested+=c.count;let accepted=0;
    const shape=streams.stream(c.id,'structure'),pose=new T.Object3D();
    for(let attempt=0;attempt<c.count*12&&accepted<c.count;attempt++){
      candidates++;const az=shape()*Math.PI*2,y=shape()*2-1,r=Math.cbrt(shape()),q=Math.sqrt(1-y*y);
      const p=new T.Vector3(Math.cos(az)*q*r*c.radii[0],y*r*c.radii[1],Math.sin(az)*q*r*c.radii[2]);
      if(p.lengthSq()===0||p.clone().normalize().dot(opening)>cosine)continue;
      pose.position.copy(p);pose.rotation.set(shape(),shape()*Math.PI*2,shape());pose.scale.setScalar(.7+shape()*.5);pose.updateMatrix();
      placements.push(c.frame.clone().multiply(pose.matrix));accepted++;
    }
  }
  const root=new T.InstancedMesh(geometry,material,placements.length);
  placements.forEach((m,i)=>root.setMatrixAt(i,m));root.instanceMatrix.needsUpdate=true;
  root.computeBoundingSphere();let disposed=false;
  return {root,stats:{requested,accepted:placements.length,candidates},dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.dispose();}};
}
```

输入frame可定义旋转/缩放；包络和opening在该frame局部。程序返回实际接受数量，未达到计划时回看允许域和候选预算；不以requested冒充覆盖。共享geometry/material由调用者释放，实例buffer由`dispose()`释放。实例形状本身超出中心包络时需按完整尺寸另做资格检查。

[独立随机流](../assets/runtime/random-streams.mjs)从稳定ID与用途派生，布局不消耗材料的游标：

```js
import {createRandomStreams} from './assets/runtime/random-streams.mjs';
const streams=createRandomStreams(381);
const shape=streams.stream('region/asset-17','structure');
const surface=streams.stream('region/asset-17','surface');
const position=[shape()*3,0,shape()*2];
// A larger procedural texture only consumes surface(), never shape().
const pixels=Array.from({length:256},()=>surface());
```

每次`stream(id,purpose)`返回新序列起点；需要连续消费时保存该函数。ID来自布局身份，不随数组顺序改变。32位派生允许哈希碰撞，非加密随机。完整工厂的`surfaceVariant`确实进入实例颜色，`structure`控制矩阵；两者有真实消费者。

## 4 表面受光和位移一起接线

### 材料信号进入所需的PBR通道

先确定表面形成区、方向与米制尺度，再用[现有程序材质](../assets/materials/procedural-palette.mjs)或[字段烘焙](surface-detail.md)连接颜色/roughness/metalness/normal。统一材质可保持低频，材料身份和受光应在当前形体上成立。

```js
import {createProceduralPalette} from './assets/materials/procedural-palette.mjs';
const palette=createProceduralPalette(T,{seed:381,resolution:128});
const wetStone=palette.get('stone',{wetness:.65,tileSizeMeters:[1,1]});
const dryStone=palette.get('stone',{wetness:0,tileSizeMeters:[1,1]});
const glass=new T.MeshPhysicalMaterial({color:0xffffff,metalness:0,roughness:.1,
  transmission:.82,thickness:.035,ior:1.46});
```

程序配方的UV tile要与物理尺寸匹配；不要把全部面按默认0..1UV直接套用。完整入口的box函数为各面生成米制UV，合并后为需要normalMap的最终网格建立切线。静态wetness配方在离散变化时烘焙/缓存，不逐帧创建材质；动态湿润另写已验证的uniform混合路径。

玻璃需要真实几何厚度/曲率和窗后内容，参数不是完整光学效果。反射来源按当前画面选择天空PMREM或实际场景探针；[完整入口](../assets/examples/guided-world/main.mjs)在真实世界建好后捕获局部环境，再赋给玻璃。该探针是静态的，改变场景后需要显式重捕获，不能当实时镜像；平面与粗糙水反射按[工具边界](production-toolkit.md#环境反射与后期读回真实消费者)另选。

### 同一波面生成位置、法线与附着物

[wave-surface](../assets/environment/wave-surface.mjs)将已验证波组落实为CPU网格；所有波在同一静止参数XZ求值，总偏导累加后计算法线，交由Three材质正常变换到受光空间。

```js
import {createWaveSurface} from './assets/environment/wave-surface.mjs';
const waterMaterial=new T.MeshPhysicalMaterial({color:0xb6d3ca,metalness:0,roughness:.2});
const water=createWaveSurface(T,{width:6,depth:4,segmentsX:48,segmentsZ:32,
  waves:[{direction:[1,.3],amplitude:.08,wavelength:3,q:.25,omega:1.3}],
  waterLevel:.2,material:waterMaterial});
scene.add(water.root);
const buoy=new T.Mesh(new T.SphereGeometry(.1,12,8),new T.MeshStandardMaterial({color:0xbc7445}));
water.root.add(buoy);
function updateWater(time){
  water.update(time);
  const s=water.sampleRest(0,0,time); // same REST vertex at grid centre
  buoy.position.fromArray(s.position);buoy.position.y+=.1;
}
updateWater(2);
water.setWaves([{direction:[1,.3],amplitude:.12,wavelength:3,q:.25,omega:1.3}]);
```

`sampleRest()`返回root局部、含水位的拉格朗日参数点，会随水平波移移动。固定世界XZ需要反求映射；大对象多支点/浮力、泡沫、反射、折射和岸线不在该模块中。网格顶点之间是线性近似，不能用解析曲面点声称任意位置都与粗三角网格零误差。`update/setWaves/setWaterLevel`真实更新位置、法线和bounds，失败setter恢复前一状态。

高密水面转GPU时，沿[波面代码](water-motion-methods.md#多波面与浮物共源)迁移同一函数及全部偏导；在顶点阶段设置物体空间法线并走实际normalMatrix链，或明确生成正确的视图空间法线。不得把由物体坐标计算的偏移直接加到视图空间normal。自写位移同时处理适用阴影和CPU锚点。

## 5 写完当前关系就读回消费者

### 参数改变真实几何，动作改变真实可见子件

[scene-probes](../assets/runtime/scene-probes.mjs)提供三项可调用检查。运行前冻结或暂停竞争更新；`apply/update`必须在实际工作完成后返回/resolve。

```js
import {probeParameter,probeRigidMotion,readOrbitLimits} from './assets/runtime/scene-probes.mjs';
import {buildGuidedAssembly} from './assets/examples/guided-assembly.mjs';
// T/scene/materials/mergeGeometries are from the complete runtime entry.
let model;
function applySpan(span){
  const next=buildGuidedAssembly(T,{mergeGeometries,materials,span,seed:381});
  scene.add(next.root);const old=model;model=next;old?.root.removeFromParent();old?.dispose();
}
const geometryCheck=await probeParameter({baseline:6,candidate:8,apply:applySpan,
  measure:()=>{model.parts.body.geometry.computeBoundingBox();return [
    model.parts.body.geometry.boundingBox.max.x,model.parts.mount.position.x
  ];}});
const motionCheck=await probeRigidMotion(T,{root:model.parts.pivot,
  update:time=>model.update(time),times:[0,2,7],restoreTime:0});
const limits=readOrbitLimits(controls);
```

参数探针比较真实消费者读回的有限数字数组，并在finally恢复baseline；`changed`只说明有变化，设计方向与联动仍需看图。刚性运动探针检查普通Mesh世界矩阵，区分有对象的保持段与空/隐藏子树；不检查相机遮挡、蒙皮、实例、shader或顶点形变，也不评动作语义。使用这些路径时另读实际buffer/状态和连续画面。

相机边界从controls读回：distance是米，polarAngle是弧度；取实际近远与高低端，并另检查水平环、风险组合和真实鼠标操作。`Infinity`是合法无界值，应先为作品设计有限观看范围，不能拿Infinity构造截图距离。完整入口已经绑定真实UI，按钮调用和浏览器真实操作分别验证。

### 从像素决定细节表示

透视近轴估算为`pixels≈worldSize*viewportHeight/(2*depth*tan(fov/2))`，fov为弧度、depth为相机前向深度。它不处理强透视倾斜、遮挡或跨near面；用实际投影复核。亚像素细管可以转为低频表面或按近景分级，先保轮廓、负形和接点。

按资产族记录实际网格与draw/影图/反射成本；`renderer.info`默认可能在主遍前重置，整帧统计需要明确reset位置。成本与最终画面一起比较，减少三角形不自动意味着更美。相同材质的静态小件合批，同形实例复用；保留所需UV/normal、活动层级和局部分块。

完整入口提供全场、接点和灰模视图，并将参数、动件、波面与实例稳定性接到可观察对象。它是可复制的教学接线，机制通过不代表新作品达到高品质；完整作品继续执行[生产流程](production-workflow.md)与[统一验收](validation.md)。
