# 坐标场与有限空间响应

当颜色或出射光要由部件坐标、资产共同坐标或世界位置控制，且需要梯度、局部带或可反向 seek 的扫过效果时，读本页。它是[材质扩展桥](material-shader-bridge.md)上的一个具名配方，复用稳定 uniform、原生材质光照与输出链；不另建 Composer、动画时钟或资源框架。

本地模块为[createCoordinateResponse](../assets/materials/coordinate-response.mjs)。仅支持 Three.js r180 WebGLRenderer 中普通 Mesh、普通 BufferGeometry 和原生 Standard / Physical / Toon 材质。Mesh、geometry、base material 与纹理由调用方持有；响应器仅拥有其派生材质。实例化、蒙皮、morph、位移贴图、材质数组、用户 shader hook 与其他版本明确不在此实现范围。

## 先定坐标，再选消费者

| 需求 | `space` / `axis` | 稳定数据来自哪里 | 适合的 `consumer` |
|---|---|---|---|
| 图案随源部件移动，跨静态合批仍保持部件上的位置 | `attached` + `x/y/z` | 装配前写入 `aFormationPosition`；共享资产架用装配前变换到该资产架 | `base`；输入基色在原生光照前变化 |
| 灯光/特效固定在场景位置，经过不同父级的对象仍命中同一条空间带 | `world` + `x/y/z` 或 `xyRadius` | 每顶点的实际 `modelMatrix * position`，先更新世界矩阵再校验 | `outgoing`；受光完成后调制已有出射光，不会在全黑处凭空发光 |
| 静态由低至高渐变 | 任一坐标空间 + `x/y/z`，`kind:'gradient'`，`range:[low,high]` | 同一顶点/片元坐标链 | 通常 `base`；范围外钳制到端点 |
| 有宽度的线性扫带、多个固定偏移带或绕原点的径向带 | `kind:'band'`，`axis:'xyRadius'` 可用于径向带 | `motion:{start,velocity,epoch,period?}`；中心从绝对秒计算，径向距离相对 `origin` 的 XY 平面计算 | `base` 或 `outgoing`，由视觉含义决定 |

`attached` 不是读取摆放后的 `position`：它要求在 `geometry` 上有和 position 同顶点数、同序、独立 Float32 xyz 的 `aFormationPosition`。在装配/合批前用 [writeFormationCoordinates](../assets/geometry/formation-coordinates.mjs) 捕获。不能从合批后的单一 `modelMatrix` 反推出每个源部件的坐标。`world` 则在顶点着色器应用当前 `modelMatrix`，对象移动后扫带跟随空间坐标变化；父级或位置改变后调用 `validate()` 更新其数值边界。

坐标空间、颜色语义区和生命周期是三条不同的数据：coordinate field 只给出每个片元的标量，`low/high` 是颜色乘数，不能代替 UV、材质分区或对象所有权。相同事实只保留一个源，几何/装配、效果和时间更新读取其真实消费者。

## 可运行接线

以下片段假设当前页面已有锁定 r180 的 `THREE`、`scene`、`renderer` 和相机。`geometry` 的位置是以米计的部件局部坐标；如有源部件共同架，应把 `geometryToFormation` 设置为真实的 mesh→资产架变换。

```js
import {createResourceScope} from './assets/runtime/resource-scope.mjs';
import {writeFormationCoordinates} from './assets/geometry/formation-coordinates.mjs';
import {createCoordinateResponse} from './assets/materials/coordinate-response.mjs';

const owner=createResourceScope();
const geometry=owner.own(new THREE.PlaneGeometry(2,8,1,32));
writeFormationCoordinates(THREE,geometry); // 当前几何局部架就是部件附着架。
const base=owner.own(new THREE.MeshStandardMaterial({color:0xffffff,roughness:.7}));
const mesh=new THREE.Mesh(geometry,base);
scene.add(mesh);
owner.defer(()=>mesh.removeFromParent());

const response=createCoordinateResponse(THREE,mesh,{
  space:'attached', axis:'y', kind:'gradient', consumer:'base',
  range:[-4,4], low:[.18,.42,.62], high:[1,.72,.3]
});
mesh.material=response.material;
owner.defer(()=>response.dispose());  // 只释放派生材质；base/geometry仍归owner。
owner.defer(()=>{mesh.material=base;});

// 若改用有限扫带，创建时替换选项；每帧用绝对秒赋值，可反向拖动与复现。
// const sweep=createCoordinateResponse(THREE,mesh,{
//   space:'world',axis:'y',kind:'band',consumer:'outgoing',
//   width:1.2,feather:.25,power:2,high:[.35,.8,.55],
//   motion:{start:-2,velocity:1.5,epoch:0}
// });
// sweep.seek(performance.now()/1000);

// 退出顺序：先停止/撤销外部渲染循环，再关闭 owner；owner 逆序释放响应器、Mesh挂载、base、geometry。
// owner.dispose();
```

销毁响应器不会释放原材质、geometry、纹理或 renderer，也不会猜测调用方的引用关系。纹理仍由创建它的 scope 持有；材质使用该纹理不转移所有权。若换 geometry，应从新几何重建响应器，而不是让旧的坐标范围继续沿用；若材质被外部替换，先拆除旧响应器并按新材质重新创建。

## 数据域和更新规则

| 字段 | 语义与约束 |
|---|---|
| `space` | `attached` 或 `world`。世界模式要求有限、可逆的仿射 mesh 变换。 |
| `axis` | `x/y/z` 为线性投影；`xyRadius` 为相对 `origin` 的 XY 平面半径，仅给带使用。 |
| `kind:'gradient'` | 必须有有限且 Float32 可表示的 `[low,high]` 正跨度 `range`；标量 clamp 到 0…1。 |
| `kind:'band'` | `width` 是完整宽度；`feather` 是内侧羽化宽度，范围 0…width/2；`power>0`；`offsets` 为 1…32 个固定偏移并取最大并集。 |
| `motion` | `start` 为 `epoch` 时的中心，`velocity` 是每秒坐标单位，`epoch` 是绝对秒，可选正周期。`seek(t)` 直接从 `t` 计算中心，因此倒序、重复和隐藏期间赋值可复现，不依赖帧累加。 |
| `low/high` | RGB乘数，分量非负；band 的 `low` 固定为中性白，以保证带外响应回到原始结果。alpha不改写。 |
| `consumer` | `base` 在 `color_fragment` 后调制 `diffuseColor.rgb`，继续接受原生光照；`outgoing` 在 `opaque_fragment` 前调制 `outgoingLight`，保留已有光照贡献。 |

几何替换、顶点数变化、坐标属性改布局或新材质结构改变时，销毁并重建对应响应器。只改uniform值时不改程序结构，不重编译；对象移动或改父级后调用 `validate()` 检查当前世界坐标范围。当前实现拒绝非有限/Float32溢出的输入，不静默把坏数据送进 shader。

## 复现和验证

[像素实验页](../assets/examples/coordinate-response-lab/index.html)包含原生 r180 可运行入口；将同版本 Three.js `build/` 与 `examples/jsm/` 复制到 `vendor/`，在 skill 根目录运行 `python3 -m http.server 8000` 后打开 `http://localhost:8000/assets/examples/coordinate-response-lab/`。页面会显示 JSON 检查结果；检查不通过时会显示具体失败项。它比较真实 GPU 像素与原生材质参照，覆盖附着梯度、普通输出及单次 OutputPass、未修改邻件、原生受光、双父级世界扫带、绝对时间反向 seek、实际材质重编译、出射光不自发光、XY径向带、不同Z位置和alpha保留。

Node 行为检查使用与 skill 示例相同的已安装 Three.js r180：

```sh
THREE_MODULE=/path/to/three@0.180.0/build/three.module.js \
  node --test scripts/tests/coordinate-response.test.mjs
```

CPU测试证明输入验证、shader接线、稳定uniform和处置边界；浏览器像素实验只证明列出的运行环境与像素关系。它们不验证美术风格、场景完整度、所有GPU/浏览器或其他Three.js版本，也不证明整场作品画质提升。新项目仍须在真实入口检查其实际坐标源、材质输出链和退出路径。
