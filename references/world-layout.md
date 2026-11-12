# 分层路径面与完整占用检查

输入minFeature是最低检查尺度，不保证并集的所有内部边都有同样尺度：圆角近切线仍可能形成更细的边并被显式拒绝。例如部分亚毫米单路虽高于输入下限仍会拒绝；需要此尺度时统一局部原点/单位后验证，或采用适用的稳健几何库，不能把拒绝结果当可用表面。常规场地尺度与制造CAD精度分别核验。

## 已核对的接口与边界

| 确定结论 | 代码 / 验证依据 | 不确定项 / 适用边界 |
|---|---|---|
| 路面来自道路矩形和节点24边圆角域的二维边界并集；保留内部孔 | `assets/scene/world-layout.mjs` 的 `polygonUnion`；`scripts/tests/world-layout.test.mjs` 的面积、独立占用与真实Three三角化测试 | 圆弧是24段近似；未宣称精确圆弧布尔或任意规模GIS求解 |
| 可选openEnds只开放度数1节点；端面来自实际邻边，且必须完整暴露于最终并集边界 | `endpointPorts`、`exposedPort`；端帽面积、斜向世界端面、遮挡拒绝、净距及真实Three三角化测试 | 只省略指定端点圆角域；不自动裁切其他道路或高阶路口 |
| 每层独立编译，只有显式link建立层间图边 | `compileWorldLayout`、`connections`；分层/link测试 | 不生成坡度限制、梯段或无障碍规范；由消费方决定构造 |
| 足迹检查整条边界、包围的孔/禁区、道路及最小欧氏净距 | `contained`、`overlap`、`ringDistance`、`footprintAllowed`；凹域、包孔、道路、禁区测试 | 输入为平面完整足迹；不计算三维悬挑、车辆转弯或竖向净空 |

本模块用于已设计的分层空间数据；不会按题材生成城市或建筑。它复用 [corridor-layout.mjs](../assets/scene/corridor-layout.mjs) 的节点、边及显式交点规则，输出可被道路网格、占用、入口、坡道和设施工厂共同消费的数据。

## API

```js
import { compileWorldLayout } from '../assets/scene/world-layout.mjs';
const world = compileWorldLayout({ levels, regions, links: [] });
```

所有水平点均为米制 `[x,z]`，层高及link端点为世界Y坐标。输入环为不重复首点的简单多边形，支持顺逆绕序；输出外环CCW、孔CW。

| 输入 | 字段 |
|---|---|
| level | `{id, y, nodes:[{id,x,z}], edges:[{id,from,to,width}], openEnds?:[nodeId,...]}` |
| region | `{id, level, outline:[[x,z],...], holes?:[[[x,z],...],...], role}` |
| link | `{id, fromLevel, fromNode, toLevel, toNode, width}` |

ID是非空字符串；level、region、link各自在自己的集合中唯一，节点/边ID在本层唯一。同层中心线交叉须先切分成共享节点；原走廊图会拒绝未切分交叉及重叠中心线。不同层可在XZ相交，互不产生隐式节点。link必须连接不同层存在的节点；不同层允许相同高度。

`openEnds`省略或为空数组时保留全部默认圆帽。显式数组中的节点ID必须唯一、存在且恰有一条关联边；非数组、重复、未知、孤立或高阶节点均抛错。开放仅省略该节点的24边圆角域，邻边矩形和其他节点域保持原形。若另一条路或邻节点圆角域覆盖了拟开放端面，使整条端面不再是最终并集的朝外边界，则明确抛错；不会静默返回虚构接口，也不会隐式裁切周围道路。

`role:'forbidden'` 表示禁区；其余非空role均为可容纳足迹的用途标签。孔必须严格位于自身外环内，彼此不能交叉、相切或嵌套；有孔禁区仅阻挡实际实心部分。

| 返回值 | 含义 |
|---|---|
| `levels` | 按ID排序的 `{id,y,nodes,edges,junctions,components,openEnds,ports,surfaces}`；原走廊图字段平铺在层上 |
| `level.surfaces` | `[{outer:[[x,z],...], holes:[[[x,z],...],...]}]`；每个面是独立连通外环及其孔，无叠加路口quad |
| `ports` / `level.ports` | 实际开放端口；全局按level ID、node ID排序，层内按node ID排序 |
| `regions` | 归一、复制并按ID排序的区域 |
| `links` | 归一link，额外包含 `start:[x,y,z]`、`end:[x,y,z]`，可直接生成坡道或阶梯接口 |
| `connectionGraph` | `{nodes,edges,components}`，包含原道路图和显式层间边 |
| `snapshot` | 归一后的 `{levels,regions,links,ports}` 快照；层含openEnds，ports为派生结果；可传回编译器重算，不含函数、运行对象或三角网格 |
| `metadata` | 实际 `roundSegments`、`epsilon`、`minFeature`、`maxCoordinate` |
| `footprintAllowed(...)` | 完整足迹资格，返回布尔值；非法查询抛错 |

连接图节点是 `{id,level,nodeId,position:[x,y,z]}`，其ID为 `JSON.stringify([levelId,nodeId])`，避免分隔符碰撞。边为 `{id,from,to,kind:'corridor'|'link',width}`；components含上述节点ID。图遵循显式节点关系；路面宽度相交不会自动补逻辑图边。

端口结构为 `{id,level,nodeId,edgeId,center:[x,y,z],normal:[nx,0,nz],width,left:[x,y,z],right:[x,y,z]}`。`id`同样使用`JSON.stringify([levelId,nodeId])`；`center`为节点世界坐标，`normal`为从唯一邻节点指向开放节点的单位水平外法线，`width`取该真实邻边宽度。left/right以站在路内、沿外法线看向外侧且世界+Y朝上为准：`left = center + [nz,0,-nx] * width/2`，`right = center - [nz,0,-nx] * width/2`。例如朝+X开放时，left在-Z侧。两点连接的是最终路面的实际端面线段；开放不会改变图节点degree或原junction.radius，渲染消费者应使用surfaces而非重建全部圆帽。

消费者可用`world.ports.find(p => p.level === levelId && p.nodeId === nodeId)`解析端面。link仍允许引用任何合法图节点，不要求端点已开放；link.width独立于道路端口宽度，start/end仍为图节点中心。需要无缝连接的消费者必须主动核对双方端口方向、宽度和高程，再构造连接几何；此模块不代替坡道、侧墙或三维体积的接缝验证。

输出数据递归冻结，与输入数组及对象分离。函数不创建或拥有Three材质、纹理、几何、renderer或GPU资源。

## 可运行例

在项目根目录保存为 `world-example.mjs` 后运行 `node world-example.mjs`：

```js
import { compileWorldLayout } from './assets/scene/world-layout.mjs';
const world = compileWorldLayout({
  levels: [
    {id:'ground',y:0,nodes:[{id:'a',x:-10,z:0},{id:'b',x:10,z:0}],
      edges:[{id:'main',from:'a',to:'b',width:3}],openEnds:['b']},
    {id:'deck',y:3,nodes:[{id:'a',x:10,z:0},{id:'b',x:10,z:10}],
      edges:[{id:'walk',from:'a',to:'b',width:2}],openEnds:['b']}
  ],
  regions: [{id:'work',level:'ground',role:'workshop',
    outline:[[-16,-12],[16,-12],[16,12],[-16,12]],
    holes:[[[-14,7],[-12,7],[-12,9],[-14,9]]]}],
  links:[{id:'ramp',fromLevel:'ground',fromNode:'b',
    toLevel:'deck',toNode:'b',width:2}]
});
console.log(world.levels.map(l=>[l.id,l.surfaces.length]));
console.log(world.links[0].start,world.links[0].end);
console.log(world.ports.find(p=>p.level==='ground'&&p.nodeId==='b'));
console.log(world.footprintAllowed({level:'ground',regionId:'work',
  polygon:[[-5,4],[-1,4],[-1,7],[-5,7]],clearance:.5})); // true
```

消费方用同一link的start/end建立坡道中心线、支撑和两端接口；宽度取link.width。layer高差、水平长度和坡度可直接从端点求得。仅保存link而不实际生成连接几何，不能构成完整分层场景。

以下函数将每个已求并集的面三角化一次。传入项目锁定的Three命名空间；外环与孔必须一起传给ShapeUtils，不能逐边quad重建路口。XZ平面的CCW在三维中指向-Y，因此根据每个三角实际绕序生成朝+Y的顶面。

```js
function createRoadGeometry(T, level) {
  const positions=[], indices=[];
  for(const surface of level.surfaces) {
    const outer=surface.outer.map(p=>new T.Vector2(...p));
    const holes=surface.holes.map(h=>h.map(p=>new T.Vector2(...p)));
    const triangles=T.ShapeUtils.triangulateShape(outer,holes);
    const points=[...outer,...holes.flat()], offset=positions.length/3;
    for(const p of points)positions.push(p.x,level.y,p.y);
    for(const [a,b,c] of triangles) {
      const p=points[a],q=points[b],r=points[c];
      const crossXZ=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
      indices.push(...(crossXZ>0?[a,c,b]:[a,b,c]).map(i=>i+offset));
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry; // 消费方负责dispose
}
```

## 占用语义

`world.footprintAllowed({level,polygon,regionId,clearance=0})` 首先验证整个简单多边形被目标区域容纳，再检查区域孔、同层道路及禁区。道路障碍直接使用已求并集的`level.surfaces`，因此openEnds改变的平端面同时改变道路网格边界、占用和净距判断。省略regionId时，必须有一个同层非禁区完整容纳足迹；不会拼接多个区域绕过区域边界。没有可容纳区域时返回false。

凹边界检查将每条足迹边按所有边界交点分段，逐段验证，能发现“顶点均在域内但边穿过凹口”。孔/障碍检查同时检测边界相交、足迹在障碍内、障碍被足迹包住，能发现只检测角点遗漏的内部障碍。

clearance是与区域边界、孔、道路和禁区边界的最小欧氏距离；检查全部线段之间的距离。零净距允许接触可用区域外边界，但接触孔、道路或禁区会拒绝。足迹完整位于道路环内部孔时可通过，仍需满足该孔边界的道路净距。未找到层、错误层的regionId、禁区regionId、负净距或非法多边形会抛错，不以false掩盖输入错误。

## 算法与限制

1. 每条道路生成完整宽度矩形；每个连接节点以关联最大半宽生成24边圆角域，默认端点同样圆封口；openEnds省略指定度数1端点域，并验证最终端面完整暴露。不等宽节点采用最大半宽交汇域，属于明确的设计形状。
2. 将全部凸域边求两两交点，含共线重叠端点；各边按参数切成原子线段。对原子线段中点两侧作凸域半平面分类，保留“并集内/外”发生变化的边，并统一内部朝左。该分类使用符号方向判断，不用栅格或有限偏移采样模拟布尔。
3. 对保留边去重并按端点缝合有向闭环；移除共线分点，以有向面积区分外环/孔并按包含关系归属。边界不是多个相交面，后续可直接三角化而不产生共面重叠。

计算以有界双精度浮点进行。坐标/高程/宽度绝对值上限100000；宽度、道路长度及输入环边长最小0.00001；边界判定/端点归一容差0.00000001。面积用相对环首点的坐标计算，减少大偏移小轮廓的消减误差。此容差不等于所有接近机器精度输入的拓扑保证。

规模上限为16层、每层64节点/128边/2048条原始域边、128区域、每个区域32孔、每环256顶点、128link。交点求解为边数平方级；适合设计空间、工厂、园区及室内路径的有界布局。超限、重复ID、自交/退化输入、未知端点、未切分中心线交点、接近容差而导致无法闭合或一点相切的非流形边界均明确抛错。极小间隙、几乎重合或近乎平行交点应先放大尺度/合并/清理；它不是精确算术布尔内核。不包含通用偏移、曲线精确布尔、自动交点建图或三维导航求解。

## 验证

```bash
THREE_MODULE=/path/to/locked/three/build/three.module.js \
  node --test scripts/tests/world-layout.test.mjs
```

行为测试覆盖T、十字、斜交不等宽路口，独立原始域占用对照，已知胶囊面积，多连通面/环孔，真实Three带孔三角面积与三角中心归属，分层及显式link，凹域边越界、包孔、包禁区、道路及净距，稳定快照/输入不变，大坐标小足迹以及非法输入。开放端口专项覆盖默认兼容、单/双端面积、斜向法线与左右端点、边反向不变、分层ID、快照重放与递归冻结、真实端面三角化、平端净距、非法openEnds及被其他道路域遮挡的端面拒绝。数值测试证明这些覆盖范围内的空间事实，不代替整场运行画面、真实坡道几何及视觉验收。
