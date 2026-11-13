# 从材料形成规律到可见表面

用于程序材质、木/金属/石/涂层/织物等表面细节，以及规则波纹、塑料感、纹理漂移和远景闪烁的定位。几何轮廓与中层先按[构造方法](procedural-construction.md)确定；色彩/IBL/后期遵守[渲染选择](rendering-choices.md)。本页提供形成方法，不提供适用于所有对象的噪声预设；现有模块烘焙程序场，不包含任意高低网格之间的通用投射烘焙器。

## 1. 在写纹理前确定规律、坐标和尺度

每个重要材料族写明形成原因、主方向、区域和典型尺寸，再分给相应消费者。同一资产上的涂层、裸露基底和氧化区可有不同响应；不要把整个对象混成平均材质。

| 形成关系 | 宏观/中观由什么表达 | 表面场负责什么 |
|---|---|---|
| 加工、刷磨、划伤 | 有厚度的边缘、台阶与加工面；方向随构件坐标 | 沿加工方向的低幅高度/粗糙度变化，接触区或边缘的磨损mask；不是覆盖全物体的交叉正弦 |
| 木材生长、切面与装配 | 板宽、端面、拼缝和倒角 | 顺纤维且空间相关的细纹与反射差别；不同切面另定义方向，不能所有面用同一横条纹 |
| 铸造、涂层、釉面 | 体积交接、圆角、壳体厚度 | 低幅微起伏与宽尺度粗糙度分区；漆层通常是介质表层，露底区才体现基底 |
| 石材、侵蚀、沉积 | 层理、断面、沟槽和接触关系 | 低对比色/粗糙变化与小尺度颗粒；明显沟槽和轮廓不交给normal贴图 |
| 织物 | 厚度、折叠、受力与接触 | 顺经纬的微细响应；线宽/间距从材料尺度与镜头像素分配，织纹不能替代折痕 |

先定义统一单位，建立局部/rest/UV材料坐标及一块纹理覆盖的实际尺寸。颜色、粗糙度、高度可以共享区域mask，保留各自幅度与职责。静止纹样跟随物体；风、湿度等环境场才使用世界坐标。若UV在曲面上明显拉伸，用分区/重新参数化或相应空间表示修复，不靠增大图片掩盖。

形成方向优先写入字段的采样坐标，再从该高度求梯度；尽量保持输出normal图的默认旋转。烘焙后再改texture.rotation/repeat时，需按实际TBN消费者核对向量方向与尺度，不能只旋转采样图。

按目标景别估算一个表面特征占多少像素：小于可稳定采样的细节合并为平均反射/粗糙变化，降低其对比和频率。字段在烘焙前就应带限；mipmap只能改善后续缩小，无法恢复已混叠的场。提高分辨率之前先确认方向、尺度和形成规律正确。

## 2. 用独立数据通道表达受光

颜色说明颜色，不应把参考上的高光和阴影画进albedo；高度扰动受光法线，不改变轮廓；roughness决定反射扩散，不能用颜色噪声代替。

启用Physical的涂层、sheen、各向异性或体积层时，先按[原生通道与单位](physical-material-channels.md)接到实际R/G/B/A及长度消费者。需要无UV的三维形成场或合批后附着纹样时，用[形成响应](formation-response.md)；角色共享及候选材质验证用[形成palette](formation-palette.md)，纹样架由源资产定义。

### 让同一区域进入实际PBR通道

先为材料定区域边界：由构件端面/边缘距离、接触磨耗、受潮高度、流向或手工设计mask得到位置相关的权重；再选择各区响应。形体边界来自网格/UV/局部坐标，不能对每个通道各造一套无关随机斑。空间变化先低频分区与方向，再补中小尺度。

需要同时烘焙颜色、金属、粗糙与微表面时，复制[表面场模块](../assets/materials/surface-fields.mjs)并使用`createRegionMaterial`。下面的A/B为当前设计的两种材料响应，`regionWeightAt(p)`由对象形成规律提供；示例混合方式不规定所有材料必须只有两区。

```js
import {createRegionMaterial} from './surface-fields.mjs';

const surface = createRegionMaterial(THREE, {
  width: 256, height: 256, physicalSize: spec.tileSize,
  regionAt: p => {
    const w = THREE.MathUtils.clamp(regionWeightAt(p), 0, 1);
    return {
      color: regionA.color.clone().lerp(regionB.color, w),
      roughness: THREE.MathUtils.lerp(regionA.roughness, regionB.roughness, w),
      metalness: THREE.MathUtils.lerp(regionA.metalness, regionB.metalness, w),
      height: materialHeightAt(p, w) // 与tileSize相同单位
    };
  }
});
representativeMesh.material = surface.material;
// 最终不再使用时surface.dispose()释放自己创建的材质和四张图。
```

该函数每texel仅取一次区域，创建实际连接到MeshStandardMaterial的map、roughnessMap、metalnessMap和normalMap。输入color为Three线性工作空间的Color（0–1）；输出颜色编码sRGB，roughness写原始G，metalness写原始B。标量color白、roughness/metalness为1，避免无意再次乘色/衰减；有意修改时仍按乘法语义。数据图默认flipY=false、线性过滤与mipmap，继承下方物理UV/TBN及带限约束。

区域权重、响应值和高低尺度由当前对象决定；该工具不自动创造旧木、氧化或皮肤。高度仍不改变轮廓；需要厚涂层、崩边、压痕和实际接触时由几何负责。金属/介质边界和湿润亮带要在最终光照检查，单张“看起来很脏”的颜色图无法替代它们。

### 仅需要高度与粗糙度数据时

需要从物理尺度高度/粗糙度场生成数据图时，使用同模块的`createSurfaceMaps`，注入同一份THREE。模块以Three 0.187.0验证；字段本身由当前材料设计提供。

```js
import { createSurfaceMaps } from './surface-fields.mjs';

const maps = createSurfaceMaps(THREE, {
  width: 256, height: 256,
  physicalSize: [spec.tileWidth, spec.tileHeight],
  heightAt: ({ u, v, x, y }) => materialHeightAt(x, y, u, v),
  roughnessAt: ({ u, v, x, y }) => materialRoughnessAt(x, y, u, v),
  wrapU: 'repeat', wrapV: 'repeat'
});
const material = new THREE.MeshStandardMaterial({
  color: spec.baseColor, metalness: spec.metalness,
  roughness: 1, // 此处选择让字段直接给出roughness输入因子
  normalMap: maps.normalMap,
  roughnessMap: maps.roughnessMap
});
// 对象/材料不再使用这些图后，由所有者调用 maps.dispose()。
```

| 输入/输出 | 实际契约 |
|---|---|
| `heightAt` | 像素中心采样一次，返回与`physicalSize`同单位的有限高度；默认0，不注入随机数 |
| `roughnessAt` | 返回0–1的数据乘数；默认1。输入因子为`material.roughness * roughnessMap.g`，标量不是被贴图替代；BRDF随后还可施加下限和几何粗糙度 |
| `physicalSize` | 一个UV tile的正交切线X/Y长度；x沿u、y沿v。直接使用还需实际shader提供单位正交TBN。r187无tangent时，仅正交不够，UV两轴需等物理比例；支持的indexed position/normal/uv几何可先`computeTangents()`并核对方向。曲面度量、非均匀UV/世界缩放和repeat变化由调用方处理 |
| `normalMap` | 对物理x/y求差分，编码`normalize(-dh/dx,-dh/dy,1)`；TangentSpaceNormalMap、normalScale=(1,1)。不推导几何切线或改变顶点 |
| 数据存储 | 两图均RGBA8、NoColorSpace、flipY=false，首行是低v；roughness只写G。RGB8法线有量化，平坦XY为128，存在很小的不可避免偏斜 |
| 边界/过滤 | clamp边缘用单边差分，repeat用周期邻居且要求输入真正周期；默认生成mipmap并使用线性缩小过滤，不补偿微法线方差到粗糙度 |

仅在需要属性等价焊接、角度法线或匹配烘焙器的 Mikk 切线时，使用[按需几何后处理](geometry-postprocess.md)；先保留原有解析法线与接缝，并按对象归属、完整 drawRange 和切线约定逐项检查。

UV度量沿面变化时，先分区/参数化并提供正确切线框架；或采用[三维局部场与表面梯度](effect-recipes.md#表面位移与受光法线)的着色路线。一个平均tile尺寸不能保证整张曲面具有精确物理高度。

不要再把同一个高度同时挂到bumpMap叠算。只有数据通道确实需要颜色含义时才解码sRGB；normal、roughness、mask保持数据语义。Canvas绘制的颜色图可单独生成并标sRGB，概念参考图仍不进入纹理。

## 3. 先校准材料，再回到完整镜头

实际资产上的材料目标、固定变量、对照与消费者校准见[渲染选择](rendering-choices.md#在实际资产上校准材质与灯光)。本节说明如何制作代表材料与表面场；校准结果仍要回到完整场景和要求的观看视角复核。

第一批只完成决定效果的代表材料小样：保留一个干净、低频的基线，在实际资产代表面上真实渲染材料响应，并保留当时源码/图。选定后才把配置扩展到整镜；已有连贯的材料与光区先继承，新表面场和新反射场分开比较。主光揭示体积，环境提供有意的宽窄反射带，曝光固定；不同光位检查纹样是否贴体、金属反射是否压过结构、涂层是否读成裸金属。中性校准之外，还要回到最终环境确认色温与层次。

材料变化先落实大区域与方向，再加入低幅中层，最后分配微细场。近景看纹理尺度/接缝，整镜看主次和材料区别，相邻时刻看闪烁。若出现网状高光或规则波纹，按实际问题分别关闭高度/粗糙/颜色层，固定几何、光与相机找责任层；不是默认执行四套渲染。

需要解释细节的收益时，保留相同几何/机位的前后图和实际参数消费者。局部可见变化与整体更好分别判断；图层数、贴图分辨率或数据测试通过都不是美观分数。

## 学习与版本核对

UV与表面坐标、PBR金属/粗糙度、环境反射、阴影覆盖与分辨率可用于理解数据关系。教程的默认值、编码字段和软影方法需按实际版本/后端核对；本页实现与验证采用当前项目安装包，不将旧教程直接拼进现代输出链。
