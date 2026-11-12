# 混合原型沿街组团

## 证据与适用范围

| 确定行为 | 实现或验证来源 | 边界 |
|---|---|---|
| 区域用途决定允许原型，真实完整局部包络决定进深、面宽与刚性位置 | `assets/scene/frontage-neighborhood.mjs` | 原型包络由实体工厂实测，包含deck、挑檐等；不能用通用地块尺寸代替 |
| 完整多边形通过指定区域、洞、禁区和道路并集检查 | `assets/scene/world-layout.mjs` 的 `footprintAllowed` | 沿用单层平面占用；不自动创建跨层连接或重新解释道路 |
| 不同道路/不同区域的已接受件统一做SAT防重叠 | `assets/scene/corridor-layout.mjs` 的 `rectanglesOverlap` | `gap`约束同一沿街序列；跨序列保证不交叠，不保证相同间距 |
| 路向、偏心原点、完整deck和入口使用同一刚性变换 | `scripts/tests/frontage-neighborhood.test.mjs` | 实Three矩阵及生成mesh/Box3测量验证；尚不代表画面美术合格 |
| 随机流按level、region、edge、side和用途独立 | `assets/runtime/random-streams.mjs` | 相同输入与种子稳定；输入记录或family列表重排不改变结果 |

## 调用与数据

`compileFrontageNeighborhood(options)` 是无Three依赖的纯数据工具，返回冻结且与可变输入分离的数据。`layout`必须是实际`compileWorldLayout`返回值，保留它的`footprintAllowed`函数。

| 输入 | 类型、默认值与限制 |
|---|---|
| `layout`, `level` | 编译世界及其中的level ID；沿用世界的16层、128区域、单层128道路边等限制 |
| `prototypes` | 1–128条、唯一非空ID；每条为`{id,footprint:{minX,maxX,minZ,maxZ},entrance:{position:[x,y,z],normal:[0,0,1]},spec?}` |
| `familiesByRole` | 普通对象，最多128种role，每种1–128个已知原型ID；family内不重复。未映射role进入`skippedRegions`，`forbidden`始终不生成 |
| `seed` | uint32，默认1 |
| `gap`, `setback`, `endClearance` | 默认1、1、3；有限非负数，最大100000 |
| `groupSizeRange`, `groupGap` | 默认`[2,3]`、`gap`；组大小为1–64整数闭区间，额外组间距离为0–100000 |
| `maxCandidates` | 默认4096，1–16384整数；进入资格判定前检查全局预算 |

局部+Z为入口正向，入口XZ须位于完整包络内。包络坐标在±100000内，两轴尺寸各为0.00001–100000。所有数组必须稠密。`spec`可选，支持有限数字、字符串、布尔、null、数组及普通对象；最多4096个值、12层，不接受循环或函数。ID长度最多512。无缩放、俯仰或自动修正原点。局部尺寸的下限是输入门槛；刚性变换后，世界多边形仍须满足`layout.metadata.minFeature`规定的最短边和最小面积（其平方）。浮点平移或转向可能使恰为下限的局部尺寸略低于世界门槛：只拒绝该候选并记录`precisionFailures`，保留其他合法结果，不扩大包络、抖动坐标或隐藏缩减支持范围。

输出为`{level,lots,diagnostics}`。每个lot包含以下共享消费数据：

| 字段 | 含义 |
|---|---|
| `id`, `regionId`, `role`, `prototypeId`, `edgeId`, `side`, `slot`, `groupId` | 稳定的原型、区域、道路、组身份；ID用JSON元组编码，避免拼接歧义 |
| `pose:{position:[x,y,z],rotationY}` | 原型局部原点的世界位置、绕+Y的弧度角；y取世界level高度 |
| `footprint` | 四个实际世界`[x,z]`角点，包含偏心、完整尺寸及刚性转向 |
| `frontage`, `depth` | 原型局部X、Z完整尺寸 |
| `entrance:{position,normal,roadPoint,distance}` | 转换后的入口、朝向、该道路边实际半宽边界上的垂足及水平距离 |
| `spec` | 可选原型工厂规格的分离副本 |

实例消费者直接执行`object.position.set(...lot.pose.position)`与`object.rotation.y=lot.pose.rotationY`；不得再次按地块中心归零。`footprint`交给地表保留面和占用消费者；入口交给到达链消费者。`roadPoint`是几何目标，入口至该点的路径仍须检查其他对象、地表承托和通达性。

## 生成规则与诊断

依次遍历排序后的区域、道路边和两侧。每个序列的原型列表经独立随机流洗牌，组依次轮换不同原型；组内使用该原型的完整面宽、可变进深，组大小由另一随机流决定。组之间增加`groupGap`，普通相邻槽之间保留`gap`。即使某槽资格失败，它仍占本次遍历的序列长度；本工具不执行无限重试或自动最密填充。

完整足迹前缘与该道路边相隔`setback`。同一值还传给`footprintAllowed`作为区域外边界、洞、禁区、完整道路并集的最低净距；路口其他边也参加检查。零setback不增加隐藏偏移：若足迹恰触道路，按世界占用规则拒绝。跨序列先做网格/AABB筛选，再对真实旋转矩形做SAT。

`diagnostics.candidates`为实际完整包络尝试次数，等于接受数与四类拒绝数之和。`rejections`包括`regionOrRoad`、`neighbor`、`coordinate`、`precision`。`precisionFailures`最多`maxCandidates`条，保存候选`id/regionId/edgeId/side/slot/prototypeId`、未经修改的世界`footprint`、实测`minEdgeLength/area`、源`minFeature`及`reason:'short-edge'|'zero-area'`；这些记录未获资格，不能作为接受地块消费。`residual`逐序列记录`regionId/edgeId/side/remainingLength/reason`，长度表示末尾未遍历部分，不含中途被拒绝的槽；`skippedRegions`记录无family用途。

`status:'complete'`仅表示有限贪心遍历结束，不表示空间填满、每种用途都有接受件或视觉目标达标。先计算下一组间距和完整面宽是否可容纳，再检查是否还有候选预算；预算恰好足够且余尾放不下下一件时仍为`complete/end`。确有下一候选而预算先耗尽时返回`'budget-exhausted'`，`reason:'budget'`标记未处理序列，保留已接受记录。狭窄区域、较大净距或零setback均可能得到空结果；消费者须检查诊断。

## 可运行示例

在仓库根目录执行`node --input-type=module`，输入下面代码；无需Three、浏览器或额外包。

```js
import {compileWorldLayout} from './assets/scene/world-layout.mjs';
import {compileFrontageNeighborhood} from './assets/scene/frontage-neighborhood.mjs';

const layout=compileWorldLayout({
  levels:[{id:'ground',y:0,
    nodes:[{id:'west',x:-40,z:0},{id:'east',x:40,z:0}],
    edges:[{id:'street',from:'west',to:'east',width:4}]}],
  regions:[
    {id:'terrace',level:'ground',role:'stay',outline:[[-42,2],[42,2],[42,22],[-42,22]]},
    {id:'yard',level:'ground',role:'gather',outline:[[-42,-22],[42,-22],[42,-2],[-42,-2]]}
  ]
});
// These bounds represent measurements of each complete local factory output.
const prototypes=[
  {id:'compact',footprint:{minX:-2,maxX:2,minZ:-4,maxZ:1},
    entrance:{position:[0,0,1],normal:[0,0,1]},spec:{rooms:1}},
  {id:'deck',footprint:{minX:-2,maxX:5,minZ:-4,maxZ:3},
    entrance:{position:[1,0,2],normal:[0,0,1]},spec:{rooms:2,deck:true}},
  {id:'pavilion',footprint:{minX:-4,maxX:4,minZ:-5,maxZ:2},
    entrance:{position:[0,0,2],normal:[0,0,1]},spec:{openSides:3}}
];
const result=compileFrontageNeighborhood({layout,level:'ground',prototypes,
  familiesByRole:{stay:['compact','deck'],gather:['pavilion']},seed:72,
  gap:1,setback:1,endClearance:4,groupSizeRange:[2,4],groupGap:3,maxCandidates:256});
console.log(result.diagnostics.status,result.lots.length,
  [...new Set(result.lots.map(lot=>lot.prototypeId))].sort());
if(!result.lots.length)throw new Error('No accepted frontage');
for(const lot of result.lots){
  if(!layout.footprintAllowed({level:result.level,regionId:lot.regionId,
    polygon:lot.footprint,clearance:1}))throw new Error(`Invalid lot ${lot.id}`);
}
```

窄测命令：`THREE_MODULE=/absolute/path/to/locked/three.module.js node --test scripts/tests/frontage-neighborhood.test.mjs`。测试使用真实Three进行矩阵、mesh和Box3验证，生产模块保持纯数据。
