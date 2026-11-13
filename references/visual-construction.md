# 从“已经生成”到“在目标画面成立”的代码方法

在空间草案和主要资产开工时选对应分支，把观看任务、边界、内部结构和材料响应接到真实消费者。代码工具定位几何/投影问题；最终选择仍看同景别图像。示例尺度是设计值，不是所有题材的品质阈值。

导航：[观看与遮挡](#1-先让关键部位能被看清) · [完整边界](#2-重复单元先归属区域再裁完整轮廓) · [中层与变体](#3-同族差异进入内部结构) · [采样](#4-按最近目标景别分配采样) · [材料响应](#5-让材料响应在真实关系中成立) · [界面留白](#6-近景同时设计模型与界面)

## 1 先让关键部位能被看清

草案就给每个观察任务指定：需要读出的形体/连接、实际表面样点、承托/框架的结构角色、允许遮挡或裁切的内容、对应视图。比如“看清凹入与外壁厚度”比“物体入镜”更能指导构造。主要构件形成轮廓，次级构件的间距/厚度/位置留出阅读窗口；自由环绕时各方向可承担不同关系。

先比较布局/对象方向，再选择相机。保留完整结构，调整主次构件节奏、空间错位或观察方向；有明确展示需求时另设可切换剖视。默认镜头、合法近端和高低端分别看无标签画面，判断框景是否仍服务目标，而非只证明四面存在。

普通、未变形Mesh可从实际三角形取样：

```js
function sampleTrianglePatch(T, mesh, triangleIds) {
  if(!mesh?.isMesh||mesh.isInstancedMesh||mesh.isSkinnedMesh||mesh.morphTargetInfluences)
    throw new TypeError('ordinary undeformed Mesh required');
  mesh.updateWorldMatrix(true,false);
  const g=mesh.geometry,p=g.getAttribute('position'),index=g.index;
  const count=(index?.count??p.count)/3,points=[];
  for(const id of triangleIds){
    if(!Number.isInteger(id)||id<0||id>=count)throw new RangeError('triangle id out of range');
    const vertices=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,index?index.getX(id*3+k):id*3+k));
    const center=vertices.reduce((sum,v)=>sum.add(v),new T.Vector3()).multiplyScalar(1/3);
    for(const v of [...vertices,center])points.push(mesh.localToWorld(v.clone()));
  }
  return points;
}
```

`triangleIds`来自工厂保留的关键表面区，不任取全体背面或AABB角点。索引是当前geometry的三角形编号，合批/重建后重新映射；有drawRange/groups时选实际绘制的表面。实例、蒙皮、shader形变使用各自最终求值或匹配的诊断proxy。

```js
import {inspectFeatureVisibility} from './assets/scene/view-readability.mjs';
// T、camera、featureMesh、featureTriangleIds、opaqueStructure由当前项目建立。
const points=sampleTrianglePatch(T,featureMesh,featureTriangleIds);
const result=inspectFeatureVisibility(T,{camera,points,
  occluders:opaqueStructure,viewport:{width:1440,height:900},epsilon:.001});
console.table(result.samples.map((s,i)=>({sample:i,status:s.status,
  blocker:s.blocker?.object.name??null,instanceId:s.blocker?.instanceId??null,
  x:s.pixel?.x,y:s.pixel?.y})));
```

传当前可见的三角网格或等价proxy，按不透明结构/透明层的实际目标分别处理。工具尊重当前layers、祖先visible、材质visible及near/far；支持普通WebGL透视/正交，明确拒绝reversedDepth与WebGPU深度约定。不要把目标所有者整个排除：目标自身也可能挡住连接，前表面自命中由世界单位epsilon处理。合批前保留构件ID或诊断映射；未加入渲染Scene的proxy保持自身visible，并同步真实世界变换。

返回的是**样点**可见比例、入镜样点界和命中者。空样本比例为null，全出画为0；这些不是物体可见面积、光栅遮挡或构图评分。alpha裁边、透射、shader形变和自定义裁剪需匹配proxy。按结果定位具体构件，再看无标记全幅与近景；细线密集、空隙太窄或负形难读可能没有单点命中，仍要审图。

## 2 重复单元先归属区域，再裁完整轮廓

给铺覆、鳞片、条板、格栅等重复构件建立**内场、边缘、交汇**职责。每块先归属一个真实宿主面/区域，使用该区域局部坐标与有向边界；中心可落下不表示完整单元合法。选择边界处保留整块、裁短、裁形或有意搭接，并让接缝/边框的覆盖量反向约束普通单元。

凸域、单方向拱起/肋纹可直接用[完整轮廓工具](../assets/geometry/bounded-profile.mjs)：

```js
import {createBoundedProfileGeometry} from './assets/geometry/bounded-profile.mjs';
const boundary=[[-2,-1],[2,-1],[1.2,1],[-2,1]];
const footprint=[[-2.2,-.2],[2.2,-.2],[2.2,.2],[-2.2,.2]];
const part=createBoundedProfileGeometry(T,{boundary,footprint,thickness:.04,
  heightAt:v=>.08*Math.cos(v*Math.PI/.4),segments:20});
if(part){
  const mesh=new T.Mesh(part.geometry,coverMaterial);
  // ownerFrame是宿主相对于当前parent的局部Matrix4；+Z为表面外向。
  mesh.matrixAutoUpdate=false;mesh.matrix.copy(ownerFrame);parent.add(mesh);
  // 移除：parent.remove(mesh);part.dispose();材料由调用者管理。
}
```

先求完整footprint与boundary交集，再沿实际左右界发出顶/底/侧/端盖，边界角点参与采样；空交集返回null。曲拱只依赖局部v，厚度沿局部Z，**不是恒法向厚度或通用实体布尔**。支持CW/CCW凸多边形；凹域先分为有明确拥有者的凸面片，跨洞/复杂曲面用相应拓扑/实体裁切并处理接缝。Float32容差下核对实际发出顶点；过大坐标引起厚度/层距塌缩时改局部坐标尺度。

边界件另由同一分区生成：确定其实际宽度、厚度、插入与覆盖量，保留露出的收边面；转角处用专门端件或相邻面共同裁切。`clipConvexPolygon()`提供纯2D交集，`part.outline`为裁后轮廓，可传给边框/装配生成器。封边正确仍可能粗糙：在最近合法视图看截面比例、曲率、接缝层次和相邻件，不将“水密/不越界”当美术完成。

扩场前完成“内场→边界→转角/邻面”的完整关系。检查实际足迹、闭合/有意开口和覆盖净距；再用同一工厂扩展。仅给中心采高度、用固定长度单元跨过所有边界、最后加一根线都不能生成这些关系。

## 3 同族差异进入内部结构

先按用途/生境/构造选择少量结构原型，再让位置、姿态、整体尺度和配色作次级变化。每个主要可见族都做一个对应景别的完整代表关系，包括承托、连接、表面与受光；主对象的精细样件不能替代配角族。

| 对象关系 | 进入生成器的独立结构量 | 输出中应能看到什么 |
|---|---|---|
| 连续体/壳体 | 内部截面站位、宽深、偏心、台肩/凹入深度、过渡长度 | 同样总bounds下，中段转折/负形/厚度不同 |
| 分枝/群落 | 主轴与枝级、分叉方向、叶序/叶面曲率、通光空隙 | 枝与末端真实承接，组的剪影与孔隙有区别 |
| 装配/开间 | 入口/接口布置、开口比例、层深、支撑关系、终止类型 | 结构和用途形成差异，边界仍可装配 |
| 连续自然表面 | 主要断面、定向凹入/台肩/裂区、影响范围和过渡 | 灰模侧背有计划中的起伏，细纹位于这些区域之上 |

下面使用现有放样工厂改变**内部站位**；端点与总高度不变，整体scale保持1：

```js
import {createSectionLoftSource} from './assets/geometry/loft-source.mjs';
const familySpecs=[
  {id:'tapered',middle:[{center:[0,1,0],width:.9,depth:.7},{center:[0,2,0],width:.65,depth:.5}]},
  {id:'offset',middle:[{center:[.25,1,0],width:.6,depth:.95},{center:[-.2,2,0],width:.9,depth:.45}]}
];
const family=new Map(familySpecs.map(spec=>[spec.id,createSectionLoftSource(T,{
  stations:[{center:[0,0,0],width:.7,depth:.6},{center:[0,.2,0],width:.7,depth:.6},
    ...spec.middle,{center:[0,2.8,0],width:.4,depth:.35},
    {center:[0,3,0],width:.4,depth:.35}],radialSegments:24,caps:false
})]));
// 从区域/用途选择真实variantId；各Mesh读family.get(id).geometry。
// 共享源最后统一释放：for(const source of family.values())source.dispose();
```

这是侧壁结构配方，不自动生成端盖、分枝或任意岩/植物。拓扑身份不同时换对应生成器；现有[自然方法](nature-methods.md)、[构造方法](procedural-construction.md)负责其具体规律。用同一尺度灰模比较剪影、内部转折与接点后，再赋材质和实例化。随机流按稳定ID/用途分开，几何缓存键包含结构输入；相同几何只改颜色不登记为结构原型。

### 已有连续网格的局部转折

已经选对拓扑、需要局部台肩/收陷时，将影响域与方向写成独立输入；以下完整函数在**几何局部坐标**中施加紧支撑位移，区域外严格不变。它保留拓扑，不会自动生成洞穴、分叉或侵蚀。

```js
function applyRegionalOffsets(T,geometry,regions) {
  if(!geometry?.isBufferGeometry||!geometry.getAttribute('position')||
    geometry.getAttribute('skinIndex')||Object.values(geometry.morphAttributes).some(a=>a.length))
    throw new TypeError('ordinary static BufferGeometry required');
  if(!Array.isArray(regions)||regions.some(r=>
    !['center','radii','offset'].every(k=>Array.isArray(r[k])&&r[k].length===3&&r[k].every(Number.isFinite))||
    r.radii.some(x=>x<=0)))throw new TypeError('finite center/offset and positive radii required');
  const result=geometry.clone(),p=result.getAttribute('position');
  for(let i=0;i<p.count;i++){
    const origin=[p.getX(i),p.getY(i),p.getZ(i)],delta=[0,0,0];
    for(const r of regions){
      const q=origin.reduce((s,x,k)=>s+((x-r.center[k])/r.radii[k])**2,0);
      if(q<1){const weight=(1-q)**3;for(let k=0;k<3;k++)delta[k]+=r.offset[k]*weight;}
    }
    const next=origin.map((x,k)=>x+delta[k]);
    if(!next.every(x=>Number.isFinite(Math.fround(x)))){result.dispose();throw new RangeError('displacement exceeds Float32 range');}
    p.setXYZ(i,...next);
  }
  p.needsUpdate=true;result.deleteAttribute('tangent');
  result.computeVertexNormals();result.computeBoundingBox();result.computeBoundingSphere();
  return result;
}
```

`center/radii`定义各自三维影响域，`offset`是有方向的局部位移，均来自主断面设计；改变一域后固定其他域比较真实顶点/灰模。若位移吃掉薄壁、净空或制造折叠，缩小幅度、增加过渡范围或换控制网格/实体表示；提高细分不保证不自交。最近邻采样仍须覆盖影响域，UV尺度与切线按新表面复查。

返回新几何由调用者释放，旧geometry不变。替换生产网格后重建表面查询、附件与碰撞/阴影表示；旧放样源的`surfaceAt()`仍描述旧几何，不能继续用于新形体。拓扑需要变化时选择实体/控制网格路线，并把主要正侧背断面与窄特征交给第4节采样，表面细纹随后添加。

## 4 按最近目标景别分配采样

先决定哪些变化改变轮廓/遮挡，哪些只属表面微响应。为曲线、实体提取和曲面profile写出最小几何特征尺度，再按最近目标视图估计屏幕误差。渲染总面数高并不保证关键洞缘/折转有足够分段。

```js
import {estimateSamplingStep} from './assets/geometry/projected-sampling.mjs';
const amplitude=.03,period=.45; // 世界单位，已设计的几何起伏
const sampling=estimateSamplingStep(T,{camera,worldPoint:criticalWorldPoint,
  viewportHeight:900,maxErrorPx:.75,minFeatureSize:period,samplesPerFeature:8,
  curvatureBound:amplitude*(2*Math.PI/period)**2});
const segments=Math.ceil(profileSpanWorld/sampling.step);
```

`worldPoint`取近端关键表面，`curvatureBound`单位为1/世界单位，输入需覆盖整段且包含缩放影响；上式只为这条已知正弦截面提供上界。工具从当前投影矩阵读取zoom/视口变化，用实际前向深度估像素尺度，透视/正交分别处理；相机世界变换须刚性。`viewportHeight`与`maxErrorPx`使用同一目标像素单位，区分CSS像素、设备像素与离屏输出尺寸。修改镜头后先更新projectionMatrix。

输出step同时受曲率弦误差、法线转角、最小特征采样和可选maxStep约束。这是局部估计；大深度变化、偏轴运动、锐交界与隐式场不自动获得误差保证。沿弧长递归细分时除中点还查多处内部点，避免高频在端点/中点恰好重合而漏检。

对体积提取，独立测发出三角形的边中点/内部点场残差，比较至少两档采样的轮廓、法线转角与近景；原场不是精确SDF时，`|F|`不能当米制距离。保留有意硬边；几何更平滑不一定更符合目标。局部加密需共享边界/过渡拓扑，分块独立提取可能裂缝。

估成本后再选择实现：三维均匀网格点数约`∏(ceil(sizeAxis/step)+1)`。预算不足时重分局部区域、换显式边界/截面，或把不影响轮廓的细频移到带限材质；目标误差和剩余损失仍记录。提高normal平滑或纹理分辨率不会补回几何轮廓。

## 5 让材料响应在真实关系中成立

在扩同族前，为当前风格写出可识别的材料信号：实际曲面、邻件/背后对象、反射来源、通道尺度和目标视图。PBR类名、不同roughness数值或微纹理存在只证明配置；实际身份由受光后的画面判断。

| 材料/关系 | 先完成的实际信号 | 有区分力的检查 |
|---|---|---|
| 粗糙介质、木/石/叶 | 加工/生长方向、形体与表面尺度，颜色与高度分别进入正确通道 | 固定光和曝光关闭一种通道，查看方向、曲率和尺度；颜色斑点不直接当所有材料的高度 |
| 金属、涂层与湿面 | 材料区、曲率反射带、粗糙区、真实环境内容 | 同一环境对比材料；再固定材料比较反射源；干湿变化遵循同一形成区 |
| 薄层/透射 | 玻璃可识别且目标内景可读，前后与掠视的关系成立 | 按目标选择alpha或Physical透射；薄玻璃可无实体厚度，多层透射另查捕获限制 |
| 静水/液体 | 容器/宿主、水位与水线、底/壁深度、透见与反射内容 | 用真实周边对象检查反射，阴影和透见分别看；静水可无运动，波纹不替代深度关系 |

固定当前资产、镜头、时间、灯/环境、曝光及视口，只切一个能解释问题的材料候选：

```js
async function captureMaterialCandidate(mesh,candidate,capture) {
  const previous=mesh.material;
  try {mesh.material=candidate;return await capture();}
  finally {mesh.material=previous;}
}
```

```js
// capture必须真正绘制/取图，且期间冻结动画与竞争更新。
const candidate=currentMaterial.clone();candidate.roughness=.3;
try {await captureMaterialCandidate(actualMesh,candidate,captureCurrentView);}
finally {candidate.dispose();} // clone共享的纹理由其原所有者释放
```

`captureCurrentView`是项目已有的实际渲染/截图回调，不是Three内置API。保留原图与候选原尺寸图，说明哪个信号改善及相邻损失；选择后才推广到相同材料角色。环境/曝光不足时另做固定材质对照，不在同轮同时调所有输入。具体色彩、米制通道、透明与反射API继续用[渲染选择](rendering-choices.md)和[表面方法](surface-detail.md)，不再叠一套通用参数表。

## 6 近景同时设计模型与界面

将标题/说明作为可折叠信息层，交互控件保持可用。默认留白成立不等于缩放后的页面成立；合法近端先指定可裁掉的外围内容与必须保留的目标关系。

调用第1节工具时可加入真实DOM矩形，坐标与投影统一为canvas相对CSS像素：

```js
const canvasRect=canvas.getBoundingClientRect();
const overlays=[...document.querySelectorAll('[data-scene-caption]')]
  .filter(e=>{
    if(getComputedStyle(e).visibility!=='visible')return false;
    for(let n=e;n;n=n.parentElement){
      const s=getComputedStyle(n);
      if(s.display==='none'||Number(s.opacity)===0)return false;
    }
    const r=e.getBoundingClientRect();return r.width>0&&r.height>0;
  })
  .map((e,i)=>{const r=e.getBoundingClientRect();return {id:e.id||`caption-${i}`,
    left:r.left-canvasRect.left,top:r.top-canvasRect.top,width:r.width,height:r.height};});
// inspectFeatureVisibility(...,{viewport:{width:canvasRect.width,height:canvasRect.height},overlays})
// overlaySampleCount独立于三角遮挡，不能当DOM实际覆盖面积。
```

该矩形粗筛适用于轴对齐canvas；CSS旋转、复杂裁剪/遮罩或多层合成另取等价区域，并查看真实页面。

按查看任务给出显式“查看细节/显示说明”切换，或用已审过的距离区间折叠非交互文字。自动模式使用进入/退出两个距离作滞回，避免阈值闪烁；它由相机状态触发，不由刚隐藏后缩小的DOM矩形反复切换。不要为避字每帧擅自推移用户相机。检查完整页面的近远/高低端与控件操作，诊断特写不代替合法用户近景。

下面为透视OrbitControls的距离驱动实现。`elements`只传可折叠说明，不含控件；`enter/exit`来自该场景已审过的查看任务，单位与controls距离一致：

```js
function bindCaptionDistance(controls,elements,{enter,exit}) {
  if(!Number.isFinite(enter)||!Number.isFinite(exit)||enter<=0||exit<=enter)
    throw new RangeError('positive enter < exit required');
  const saved=elements.map(node=>({node,hidden:node.hidden}));
  let compact=controls.getDistance()<=enter;
  function update(){
    const distance=controls.getDistance();
    if(compact&&distance>=exit)compact=false;
    else if(!compact&&distance<=enter)compact=true;
    for(const item of saved)item.node.hidden=item.hidden||compact;
  }
  controls.addEventListener('change',update);update();
  return ()=>{controls.removeEventListener('change',update);
    for(const item of saved)item.node.hidden=item.hidden;};
}
```

保留折叠状态的单一写入者，项目退出调用返回的清理函数。正交缩放不改变相机距离，应改用zoom或实际投影占幅作为状态输入；同样保留进入/退出滞回，不直接套距离阈值。

## 使用与完成

可运行组合入口见[视觉关系样件](../assets/examples/visual-relations/index.html)。该例接通完整轮廓、局部采样、样点遮挡、内部站位和材质单变量切换；区域位移、异步取图恢复、说明折叠按项目另选接入。它不是新题材的造型模板或画质标杆。先解决当前代表关系，再进入扩场；记录“已观察到什么、仍差在哪、该改哪个输入”。最终按[统一验收](validation.md)分别给出观看质量、工程正确性与交付结论。

运行该例：保持`assets/`相对目录，在项目根`vendor/`放锁定Three r187的`build/`和`examples/jsm/`及许可，通过本地HTTP打开`assets/examples/visual-relations/`。本例importmap指向项目根vendor，未随Skill提交运行依赖。已验证后端为WebGLRenderer；新版本/后端另核接口和效果。
