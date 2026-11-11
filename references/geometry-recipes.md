# 几何、表面接口与共享场代码配方

用于已确定形体后的具体实现。先按[构造方法](procedural-construction.md)选择表示，再只读当前需要的小节。下述项目函数/变量是调用示意，现成可调用模块见[工具目录](production-toolkit.md)。

导航：[网格有效性](#自定义网格与局部朝向) · [扫掠](#通用沿路径构造可变截面) · [承载面](#从实际承载面建立布局和接口) · [前向](#局部前向与内容锚点) · [截面](#用截面生成连续曲面) · [共享场](#共享语义场让形体布置与材质共用规则) · [局部变形](#按变形区域分配控制网格)

使用条件：同一锁定Three模块；明确单位、局部/世界坐标、法线/UV与资源所有权。CPU更新顶点/实例后刷新对应buffer及包围体；shader变形另同步阴影、拾取和接触表示。以下数值是局部例子，不是各题材共同的设计参数。

## 自定义网格与局部朝向

**先验证自定义网格原型，再调形和扩展。** 对手写索引的生成器，先输出一个中性、单面材质的样件，核对实际顶点/索引的有效性、退化面与预期朝向，再调整轮廓、噪声、灯光或实例数量。`computeVertexNormals()`只计算现有绕序对应的法线，不会修复反向索引。可复制[三角形审计工具](../assets/geometry/audit-triangles.mjs)，直接检查已发出的BufferGeometry：

```js
import { auditTriangles } from './geometry/audit-triangles.mjs'; // 复制到项目后按实际路径导入
const report = auditTriangles({
  positions: geometry.attributes.position.array,
  indices: geometry.index?.array,
  expectedDirection: [0, 1, 0], // 仅适用于单值高度场的上表面
});
// invalid / degenerate / opposed 非零时，先定位三角形构造。
```

预期朝向由表面语义决定：高度场上表面可用+Y；端盖、侧壁分组检查；封闭体、折叠面和倒扣不能全局套用+Y；有独立局部参考场时使用下述expectedDirections，否则省略朝向参数，仅检查有效性/退化，再用外法线设计与单面环绕样件确认。工具检查普通position BufferAttribute的局部坐标，使用尺度相对的退化阈值；交错属性先按getter展开xyz，负缩放/镜像实例另查世界变换和单面视图。工具不检查自交、水密或构图。极点/收尖处应生成单极点扇形连接，不把整圈顶点压到同一点后仍保留零面积面。若双面材质使缺面消失，用它定位背面剔除问题后修正绕序，再恢复目标材质。固定seed、形状和机位比较修复前后，确认可见表面恢复；随后才判断形状是否达标。

做生成实体网格的拓扑诊断时，显式记录顶点等价关系。硬法线、UV或材料边界可以拆分属性顶点；内核提供的拓扑合并信息应随导出保留。分别检查原生拓扑与实际渲染坐标：按位置焊接后的多用边可能来自不同闭合壳体的重合接触，不能直接称为开边，也不能仅凭原生拓扑通过忽略接触、自交或可见伪影。用一个属性接缝样件和一个相接闭合体样件核对诊断含义；边界、多用边、面朝向和自交各有不同范围，容差与坐标精度随报告记录。

## 给转向与局部形变保留足够空间

设计扫掠/形变时，先共同配置截面尺寸、中心线/过渡长度和沿程转向，不将宽截面在短距离里强行旋转。若厚壁局部翻入，优先延长过渡、先收小截面再转向、设计独立接头或改用合适的体积表示；改变表示后保持功能接口。由解析映射生成时可推导其局部变化界限或Jacobian符号；采样检查只覆盖所采区域，不能代替全局自交检查。

在生成器第一次发出变形网格时，同时保留独立参考方向。厚壁可从同参数的外/内采样点得到`F(outer) - F(inner)`；它与发出的position使用同一坐标系，不能拿输出三角形重新算出的法线充当独立参考。对适用的外壁索引执行：

```js
const facing = auditTriangles({
  positions: geometry.attributes.position.array,
  indices: outerFaceIndices,
  expectedDirections: mappedThicknessDirections // 每个position顶点对应一个xyz
});
// 该参考场成立的前提下，opposed说明局部朝向违反了外壁厚度语义。
```

`expectedDirections`与全局`expectedDirection`二选一；数组长度须与position一致，参与检查的参考向量应有限、非零，且三角形内不相互抵消。内壁、口沿和有意双面薄片按各自语义另查，不套用外壁参考。闭合索引、总体积为正和重算法线都不能单独排除局部翻入。固定几何与机位，分别切换收影和显示侧可区分阴影与表面缺陷；修正几何后恢复目标状态，再看真实材料与互补视角。

## 通用：沿路径构造可变截面

中心线控制弯曲，截面控制沿程收放，坐标架控制截面方向。连续路径先包含需要的接触/离面和转向段；从同源路径/框架派生附件与反馈锚点。不同对象的截面、分枝/装配、端部和材料区域由当前目标决定，不能只用整体缩放制造形态族。

下面是可改编的收分扫掠核心：用样条表达弯曲中心线，用半径函数表达沿程变化。它假定截面近似圆形、拓扑连续、路径可平滑参数化；适用于树干/藤蔓、弯管、缆索、肢体等类似结构。若截面非圆、宽深独立变化、存在尖角或拓扑分叉，应改用截面 loft、分件连接或专用网格，而不是继续增加 TubeGeometry 分段。`sectionShape(u, angle)`返回相对半径变化，且同一`u`下的首尾角值必须相同，否则会在接缝处裂开；不需要截面细节时保持默认零函数。

```js
function buildTaperedSweep(points, radiusAt, radialSegments = 10, steps = 18, sectionShape = () => 0) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  // Frenet frames keep the cross-section orientation continuous along a curved centerline.
  const frames = curve.computeFrenetFrames(steps, false);
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const center = curve.getPointAt(u);
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    const radius = Math.max(0.001, radiusAt(u));
    // Optional cross-section variation must be periodic across angle 0..2π to close the UV seam.
    for (let j = 0; j <= radialSegments; j++) {
      const a = j / radialSegments * Math.PI * 2;
      const localRadius = radius * Math.max(0.1, 1 + sectionShape(u, a));
      const p = center.clone()
        .addScaledVector(normal, Math.cos(a) * localRadius)
        .addScaledVector(binormal, Math.sin(a) * localRadius);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radialSegments, u);
      if (i < steps && j < radialSegments) {
        const row = radialSegments + 1, k = i * row + j;
        indices.push(k, k + 1, k + row, k + 1, k + row + 1, k + row);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The UV seam needs two vertex records (u=0/1), but one smooth surface normal.
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i <= steps; i++) {
    const a = i * (radialSegments + 1), b = a + radialSegments;
    const n = new THREE.Vector3().fromBufferAttribute(normals, a)
      .add(new THREE.Vector3().fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, n.x, n.y, n.z);
    normals.setXYZ(b, n.x, n.y, n.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
```

调用时把半径函数、截面变化和分段数写进资产规格。UV首尾保留独立顶点与0/1坐标，但同一光滑表面的法线需一致；`computeVertexNormals()`不会跨重复顶点自动平均。上例只修该接缝，不把倒角、端盖或设计硬边全局平滑。此 helper 只生成侧壁；只有端面可见或截面应封闭时才添加端盖。若动画、碰撞或附件依赖路径位置，锚点应从同一条中心线和坐标架导出，避免另算一套近似位置。其他类型的重复附属结构用其真实支撑面和布局规则分布；仅在使用实例/粒子时才套用前述容量预算。

## 从实际承载面建立布局和接口

把组中心、形态族和人工落点放在共同布局数据中；在组内选择变体后，从实际承载面求位置。复制[表面锚点模块](../assets/scene/surface-anchors.mjs)，注入场景使用的同一THREE。以下约定资产根的局部原点为支撑点，局部+Y向上、+Z为功能前向；动画写内部子组，放置根保留布局矩阵。

```js
import {createSurfaceSampler, surfaceFrame} from './surface-anchors.mjs';

const sampleSupport = createSurfaceSampler(THREE, supportMeshes);
for (const group of layout.groups) {
  for (const placement of group.placements) {
    const hit = sampleSupport(
      new THREE.Vector3(placement.x, layout.rayTop, placement.z),
      new THREE.Vector3(0, -1, 0), {far: layout.rayDepth}
    );
    if (!hit) throw new Error(`No support for ${group.id}`);
    const asset = buildFamily(group.family, placement.variant);
    const world = surfaceFrame(THREE, hit, {
      up: new THREE.Vector3(0, 1, 0), // 重力直立；随面贴合时使用hit.normal
      forward: new THREE.Vector3(...placement.front),
      offset: placement.offset ?? 0
    });
    scene.add(asset.root);
    scene.updateWorldMatrix(true, false);
    asset.root.matrixAutoUpdate = false;
    asset.root.matrix.copy(scene.matrixWorld).invert().multiply(world);
    asset.root.updateWorldMatrix(false, true);
  }
}
```

`supportMeshes`只传实际承载对象，不包含待放置物。模块返回实际交点/几何法线、对象及instanceId，命中失败返回null；支持父级非均匀变换及实例框架。实例矩阵变更后由调用方更新相关包围体。rayTop/rayDepth按场景尺度选择，也可直接传任意世界射线。模块不负责碰撞/IK或物体整体支撑；路径/大接触面需采样边界与多个点，再用这些点构建底/侧承接或连续变形，不能把所有点简单抬到最高处。

**起伏地形上的大占地结构要验证整圈承接。** 建筑、台地、桥台或平台先明确采用顺坡铺设、水平基座加挡土构造，还是分级过渡；不要用一个中心高度放置完整平板。沿实际占地边界按最终承载网格细分采样，依据每段地面高程与法线生成连续底面、侧壁/基础、分段挡墙或地形回填；转角、入口和相邻坡面也要收口。记录整圈支撑底缘的最大悬空/嵌入、上缘与主体的搭接，再看沿坡剖面和周向视角。单点、单侧墙或数值全通过仍不代表结构与环境在画面中自然连成一体；若高差使挡墙成为主视觉，应返回总平面和地形设计，不能只加高墙体遮缺口。

`surfaceFrame`给出世界矩阵。父级有变换时乘其逆矩阵；非均匀父级可能产生局部剪切，应保留矩阵而非强拆TRS。功能前向与重力轴分别决定；静态框架的平行回退不替代曲线的连续传输坐标架。接触/反馈从最终变形后的锚点取得，见[动画与规模](motion-and-scale.md)。

需要一块有限接触区时，用同模块的`createSurfacePatchSampler`检查实际足迹与局部参考平面的偏离和法线一致性；按[基部/主体构造方法](detail-distribution.md#分开附着基部与主体方向)分别构建附着架与生长/安装架。点命中、足迹资格和最终基部网格接触是三个不同结果。

## 局部前向与内容锚点

有开口、展示内容或操作面的资产，在自己的局部坐标声明面向使用者的法线`frontLocal`和该面上的`anchorLocal`；网格与两者共用父级变换。布局时朝向使用区，实际取景时再核对内容可见性。下面只返回相机在哪一侧；`THREE`由当前工程导入：

```js
function facingSide(asset, frontLocal, anchorLocal, camera) {
  asset.updateWorldMatrix(true, false);
  if (asset.matrixWorld.determinant() === 0) throw Error('singular asset transform');
  const normal = frontLocal.clone().applyMatrix3(
    new THREE.Matrix3().getNormalMatrix(asset.matrixWorld)
  ).normalize();
  const anchor = asset.localToWorld(anchorLocal.clone());
  const towardCamera = camera.getWorldPosition(new THREE.Vector3()).sub(anchor);
  if (towardCamera.lengthSq() === 0) return null;
  return normal.dot(towardCamera.normalize()); // 正：前侧；负：背侧；接近0：掠视。
}
```

`frontLocal`为非零法线，相机与锚点重合返回`null`；正值不保证内容在画内或未被遮挡。用[锚点投影](scene-layout.md#把实际世界锚点投影到视口)判断取景；有必要时用第一遮挡射线定位自身背板、外壳和场景遮挡，再审实际画面。实例/骨骼/shader形变使用最终实例/变形锚点；中心射线不等于整面可见率。此片段适用可逆仿射Object3D变换，法线按[逆转置矩阵](https://threejs.org/docs/pages/Matrix3.html#method:getNormalMatrix)变换，不能只把局部向量当世界方向。

## 用截面生成连续曲面

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

以下以Y方向为轴，演示**关键截面→实际顶点**。`u`为沿程参数，`halfWidth/halfDepth`为半尺寸；中心、宽、深与截面扭角分别可改。数值仅演示控制关系，按当前目标重设：

```js
const sections = [
  {u: 0,    y: -1.5, x: 0,    z: 0,   halfWidth: .28, halfDepth: .22, twist: 0},
  {u: .25,  y: -.65, x: -.10, z: 0,   halfWidth: .72, halfDepth: .43, twist: 0},
  {u: .50,  y: 0,    x: 0,    z: .10, halfWidth: .48, halfDepth: .62, twist: .12},
  {u: .75,  y: .65,  x: .12,  z: 0,   halfWidth: .81, halfDepth: .35, twist: .08},
  {u: 1,    y: 1.5,  x: 0,    z: 0,   halfWidth: .23, halfDepth: .18, twist: 0},
];
function sectionAt(u) {
  // 有效规格：u严格递增，首尾0/1，半尺寸为正；网格须采到关键层位。
  const k = Math.max(1, sections.findIndex(s => s.u >= u));
  const a = sections[k - 1], b = sections[k];
  const t = (u - a.u) / (b.u - a.u);
  const s = {};
  for (const key of ['x', 'y', 'z', 'halfWidth', 'halfDepth', 'twist']) {
    s[key] = THREE.MathUtils.lerp(a[key], b[key], t);
  }
  return s;
}
const geometry = buildGridGeometry({
  rows: 40, columns: 32, // 本例关键u均被采到；任意层位须显式纳入采样行。
  pointAt: (u, v) => {
    const s = sectionAt(u), angle = 2 * Math.PI * v;
    const x = Math.cos(angle) * s.halfWidth, z = Math.sin(angle) * s.halfDepth;
    const c = Math.cos(s.twist), n = Math.sin(s.twist);
    return new THREE.Vector3(s.x + c*x + n*z, s.y, s.z - n*x + c*z);
  },
});
const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
  color: '#789078', roughness: .78, metalness: .02,
}));
```

先改一个层位的宽/深/偏心，确认该处与相邻过渡确实改变，其他控制点保留。上例用分段线性插值，转折处可见曲率变化；需要连续圆滑时设计切向/Hermite或增加有意截面，并检查插值过冲及净空。沿弯曲路径改用路径框架，分枝/洞口另设计拓扑；这个简单loft不是任意结构的成品生成器。

`pointAt`决定实际形状：换控制截面即可改变腹背、肩部、端部和偏心。上例是开口表面模板，不包含端盖；正式封闭资产需要生成端盖或连接独立几何。闭合截面在`v=0`和`v=1`位置重复顶点以获得UV接缝，因此普通`computeVertexNormals()`可能在接缝处出现法线断层；要平滑闭合时需焊接位置相同顶点后计算/复制法线，或手工对接缝两侧平均法线。检查`reverseWinding`是否符合外向法线，必要时在调试材质中开启`THREE.DoubleSide`定位方向，但交付时应修正绕序。

网格生成后依次核对：顶点与索引均有限、三角形没有零面积、包围盒尺寸与规格相符、正反面与法线方向正确、截面接缝和端盖闭合、UV连续、目标相机下厚度可读。不要把轮廓失真归咎于缺少细分。

轴对称对象可用`LatheGeometry(profilePoints, segments)`：每个`Vector2(x,y)`是半径与高度。需要不同内外壁时单独设计闭合截面。弯曲但截面固定的物件可沿样条构造框架并扫掠截面；沿线变化宽度/旋转时显式插值，不能只拉伸一根直管。

## 共享语义场：让形体、布置与材质共用规则

当多个对象受同一地形、流向、磨损或生长规律影响时，先定义纯函数式的场采样接口，再由不同生成器读取它。不要让地形、植被、材料边界和水岸各自生成互不相关的噪声。

先列出当前题材真正需要的字段及其消费者。地形可用高度、法线/坡度、曲率、距水线、流向与地貌区权重；建筑场地可用承载面、朝向、日照和功能区。字段应保留共同坐标、单位、固定 seed 与明确语义；只保留会被几何、实例、材质或环境效果实际读取的字段。

按形成尺度构造：先确定宏观轮廓和主方向，再生成顺应主方向的中层脊、沟、台阶、分枝、支撑与边界，最后添加低幅表面细节。mask/权重限制每种变化出现的位置与强度；侵蚀、沉积或磨损等过程可使用不同尺度和作用区的连续 pass。高品质地形依赖有方向的断面与连接，不能用全表面白噪声代替。

散布先从布局/曲线候选点取样，再用密度权重、坡度/承载条件和排除区筛选；随后读取实际支撑面及法线，确定方向、家族变体和尺度。固定 seed 保持复现，显著的主礁、树、路径转折等仍可手工落点。相同区域字段可同时驱动几何过渡、颜色/粗糙度分区及浪沫/植被/雾等反馈，但每个消费者都要按其物理或设计含义解释该字段。

**先验证布局可行性，再锁定每组数量。** 以实际候选点和最终场数据运行一次轻量预演，记录每个设计组的候选数、通过全部掩码/坡度/承载/净距条件后的可用数、各拒绝原因计数及目标数；画出同一坐标范围内的资格区、排除区、候选点和已落位点。逐组判断目标数量、疏密和边界是否可实现。若目标未达到，先分辨是布局足迹放错、可用区域估计错误、间距/密度与目标冲突，还是组内确实应更稀；再调整分组范围、分布策略或设计目标并重新预演。道路净空、承载、视线等硬约束只能依据设计重新评审后修改，不能为凑总数而静默放宽；全场总数通过也不能掩盖单组空缺。最终生成后，用相同字段和约束复查实际落位，再从目标相机检查组团轮廓、空隙与遮挡。

```js
const sample = siteField.sample(x, z); // 固定世界/局部坐标约定，返回同一套语义字段
geometryPosition.y = sample.height;   // 主形和中层几何读取高度/断面规则
if (sample.scatterDensity > 0 && sample.slope <= slopeLimit) {
  placeOnSupport(point, sample.normal, chooseFamily(seed, pointId));
}
material.roughness = roughnessFor(sample.regionWeights, sample.wetness);
```

这是数据流示意：`siteField`、`placeOnSupport` 和 `chooseFamily` 必须由当前场景实现，字段与材质映射也要依题材定义；不要直接复制这些示例名当作 Three.js API。开发时可把单一字段临时映射为颜色、画出采样点/区域边界，检查几何、摆放和材质是否在同一位置同步变化。再恢复最终材光与完整相机复核；字段图通过不能代替成片审图。

对地表、海岸、河谷等由平面场驱动的连续形体，除点采样外，必须把**整张平面场**按同一坐标范围做俯视诊断图，并叠加轮廓、主脊/沟线、路径、区界和关键对象锚点；从实际生成网格取至少两条穿过关键地形变化的横断面，查看高度与坡度是否形成预期的缓滩、陡崖、鞍部、凹口或承接。单点符号正确、中心线距离为零或消费者读到了字段，只能证明局部数据链；不能证明凹湾开口、崖段范围、地貌分区和场景整体轮廓在空间上成立。二维分区/断面通过后，再回到目标斜视与完整相机环检查实际几何和景别。

### 将可设计的轮廓/路径变成可调空间场

当场景有明确的地块边界、山脊/沟槽、道路、磨损带或生长轴时，先用少量引导点定义这些特征，再从点集派生连续距离场。把设计输入和表面残余变化分开：轮廓与主轴决定形体，受限区域决定哪里能改变，低幅噪声只打破过度平滑。没有明确引导特征的对象不必硬套这套做法。

```js
function distanceToSegment(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

function polylineDistance(x, z, points, closed = false) {
  let d = Infinity;
  const edgeCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    d = Math.min(d, distanceToSegment(x, z, points[i], points[(i + 1) % points.length]));
  }
  return d;
}

// Positive values are inside the polygon; negative values are outside.
function signedPolygonDistance(x, z, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j], b = outline[i];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  const edgeDistance = polylineDistance(x, z, outline, true);
  return inside ? edgeDistance : -edgeDistance;
}

const coast = [[-18,-9],[-21,-3],[-20,5],[-16,13],[-9,17],[-1,18],[7,16],[13,12],[18,6],[20,0],[18,-7],[13,-13],[6,-17],[-2,-19],[-10,-16],[-15,-12]];
const crest = [[-14,5],[-10,1],[-7,-1],[-3,-3],[1,-4],[6,-3],[10,-1],[14,2]];
const channel = [[-17,10],[-13,7],[-10,5],[-6,2],[-2,1],[2,4],[8,7],[14,10],[20,11]];
const smooth01 = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const field = (x, z) => {
  const shoreDistance = signedPolygonDistance(x, z, coast);
  const crestDistance = polylineDistance(x, z, crest);
  const channelDistance = polylineDistance(x, z, channel);
  const land = smooth01(-1.2, .65, shoreDistance);
  const ridge = 1 - smooth01(1.4, 5.8, crestDistance);
  const channelMask = 1 - smooth01(1.2, 4.7, channelDistance);
  const height = -4 + land * (4.9 + ridge * 3.8) - channelMask * 2.8;
  return { height, shoreDistance, crestDistance, channelDistance, land, ridge, channelMask };
};
```

Point lists above only demonstrate the representation; derive their shape and scale from the current composition, not from the sample coordinates. The closed outline must be an ordered, simple XZ polygon without duplicate adjacent points; define additional loops for holes. Add path, strata, basin or vegetation guides only when the scene calls for them. Keep each field's meaning and units explicit; do not reuse a variable named `mask` for unrelated regions. Build final terrain vertices from the field, then derive slope from its height or from the final mesh. Place paths and instances by sampling the final mesh so the guides do not drift from the rendered surface.

Before scattering or adding material detail, expose one field at a time as false color and draw its source guide/zero contour. Sample known points on both sides of every boundary and at the guide centerline; assert expected inside/outside, high/low and exclusion results. Inspect the resulting **main-form mesh** in gray material from the target camera and a side view. If the visible ridge, channel or plateau does not match its guide, fix the guide, signed-distance convention, falloff or geometry sampling before adding noise and assets. Passing field values alone is not visual acceptance.

**确认引导线真的驱动了几何。** 逐条追踪“设计引导 → 距离/遮罩/控制场 → 最终顶点或实体构造 → 渲染网格”；仅绘制在诊断叠层、写进审计数据或用于摆放对象的线，不会自动塑造地表。检查代码引用和字段消费者时，要确认控制场实际进入最终几何高度/位置公式。对每条主脊、沟槽、岸线或建筑控制线，在中心线和两侧固定样点比较最终网格高度/宽度/轮廓，断言变化方向和最低幅度符合设计；然后隐藏叠线看灰模。数值探针通过但完整网格没有可见形体响应时仍判失败，回到引导线与几何生成的连接处，不用材质、阴影或散布掩盖断链。

**曲线贴附要在细分后采样。** 先在平面定义道路、河道、岸线或铺装中心线，再把路径细分到最终几何采样密度；不要只给稀疏控制点取地形高度后，在三维曲线上插值Y值，因为中间曲段可能穿地、悬空或越过邻接台地。每个最终横截面按对象角色取高程：道路两侧贴合承载网格并处理坡度过渡；水面使用连续水位/河床中心线高程，检查边缘与河床、岸坡的相交；桥面等跨越物明确端点和净空。逐顶点比较生成曲线与最终承载面的距离，沿全线采样最高/最低偏差；路径进入平台、建筑占地或其他不同高程区时，先明确谁是空间主导并重做路线/交界，再做材质。中心控制点吻合不等于整条曲线贴合。

**通行路径的纵坡与台阶要由路线功能决定。** 对人行或车行路径，沿最终路径计算高程剖面、纵坡和横坡，并记录项目采用的可接受范围；两端接上但中间坡度突变或过陡，仍判不通过。可用平缓坡道时，按实际水平长度构造并核对两端搭接；空间不够时改成折返/平台或有真实踏面、踢面与落地平台的阶梯，不要把总高差压进短段后仅线性插值Y值。踏步的级高、踏宽、路径宽度、转角和上下端高程应共用同一条路线数据，并在侧视剖面与行进方向视角检查连续性；非通行的装饰路径则按其设计语义定义并验证。

路径涉及角色、车辆或装置通过时，先按[功能路径与实际通行体积](scene-layout.md#由使用者定义通路)选择路面、中心轨迹与扫掠体的表示，再生成网格。引导线粗细不能代替通行净空；多个路径的端点相同也不能代替平台上的接口布局。

## 按变形区域分配控制网格

先在需要凹陷、鼓起、折转的区域布置顶点，再施加位移。总面数与细分参数不说明顶点位于哪里；有些圆角生成器将新增采样集中在倒角，大平面中央仍跨很长的三角形。先看局部线框和相邻顶点间距，使最窄的目标起伏跨过多个样本；中央不足时改用覆盖整面的网格/曲面控制域，而不是继续提高边缘细分。

以下只生成局部XY参数域上的单值曲面，`heightAt(x,y)`返回局部Z、与width/height同单位，适用于可以由一个高度描述的局部面：

```js
function deformPatch(THREE, {width, height, cols, rows, heightAt}) {
  const geometry = new THREE.PlaneGeometry(width, height, cols, rows);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, heightAt(p.getX(i), p.getY(i)));
  }
  p.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
```

调用方按起伏宽度、曲率和目标像素选择cols/rows；用连续的鼓起、受力凹陷与转折控制形体，材料只补更小的表面响应。此例是开口面：需要实体时生成背面与连续侧边，共用边界；折叠、倒扣或多值关系改用控制网格、截面放样或显式体积场网格。CPU改顶点后更新法线及包围体；shader位移还要同步其光照/阴影表示。相同机位比较起伏深度输入改变前后，确认对应区域的顶点与受光真正变化。
