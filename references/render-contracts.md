# B/L绘画MRT：渲染迁移接口与故障定位

用于迁移THE BIG ONE/LEVIATHAN的自定义缓冲协议。下列编码、ID范围与接入顺序属于该绘画管线；PBR、烘焙或其他后端选择先读 [rendering-choices.md](rendering-choices.md)，不将此协议视为Three.js通用要求。

## 核对实现链，而非只核对声明

对每个迁移能力记录五件事：数据在哪里生成、单位和坐标是什么、哪一帧绑定、谁消费、用什么画面证明确实发生。shader 中有公式但 uniform 仍是 null，能力没有接通。

真实例子：LEVIATHAN `f12b346` 的 `passes-env.js:PAINT_FS` 从 `tData.b` 求深度半径，`ENV_UNIFORMS.paint.tData` 初值 null；`engine.js` 的 mPaint 引入它，但核对 src 未找到给该 uniform 赋主 MRT 数据的调用。结论仅为“实现了公式，默认连接缺口”，不能写“已观察到距离自适应笔触”。迁移到新项目需显式赋值并作远近 A/B 验证。

## G-buffer 协议（两个参考的共同骨架）

| 位置 | 内容 | 消费者 / 约束 |
|---|---|---|
| rtMain color RGB | 线性场景颜色 | paint/ink/atmos/bloom；不要中途重复 sRGB 转换 |
| rtMain color A | painted mask：ID≤.5 为1，其余0 | 不是透明度；cel 的0不能按普通 alpha 合成主场景 |
| rtMain data RG | view normal XY * .5 + .5 | 描线；数据纹理最近邻，避免边界混出不存在的材质 ID |
| rtMain data B | 正线性视深度 `-viewPosition.z` | 雾/水/深度边界；不是 gl_FragCoord.z 的0..1值，也非欧式距离 |
| rtMain data A | ID：0绘画，1..99描线cel，100+免描线cel | ID 既是风格分类也参与边界，给每个小零件不同ID会制造黑线噪声 |

主 MRT 使用支持浮点的格式；深度/ID 不能塞进8位归一化颜色再期待米制比较。确认渲染尺寸 IW/IH 与最终输出 W/H，soft overlay 的 gl_FragCoord 必须除当前合成目标实际尺寸。

B `writeOut(col, normal, depth, id)` 四参；L `writeOut(col, a, normal, depth, id)` 五参，**该版本 a 实际未参与输出**，alpha 仍是 painted mask。不要据参数名将它当透明通道。迁移应保留一份协议，明确适配器，而非在不同材质中混两套签名。

## 推荐最小接入序列

仅用于已授权的实现或验证任务；纯研究阶段记录数据链与未知项。已有项目通过的相同协议无需无条件重建校准场景。

1. 主 MRT：用不同 ID 的校准物检查颜色、线条和法线；WebGL FBO、GLSL 编译/链接错误为阻塞项。
2. paint/ink：确认 painted mask 分流；paint 读 rtMain color+data，ink 保留原 data；距离半径缩小不等于跨深度边界安全，必要时过滤邻域深度。
3. atmos：从 inverseProjection/cameraWorld 重建视线，使用相同线性深度；为空白天空约定远深度并保持全视锥覆盖。
4. overlay：用下面的 soft depth。透明特效自己的混合不能改写主 ID 数据。
5. reflection/shadow：增加 pass 之前确认材质覆盖、隐藏标记及恢复流程；最后再调 bloom/grade。

## 非实例深度雾适配例

参考 L `materials.js:overlayMaterial`，其原顶点依赖 `instanceMatrix/aSprite`；普通 Plane 不具备这些属性。可用 camera-facing 面片的 `modelViewMatrix`，输出 `vDepth=-mv.z`：

```glsl
float sceneDepth = texture(uSceneData, gl_FragCoord.xy / uRes).b;
float soft = clamp((sceneDepth - vDepth) / uSoft, 0.0, 1.0);
float alpha = radialMask * opacity * soft;
```

引擎每帧在 overlay 前绑定 `uSceneData=rtMain.textures[1]`、`uRes=(IW,IH)`；材质 transparent=true、depthWrite=false。关 depthTest 是因为合成目标没有等价场景深度，不代表不要遮挡。`uSoft` 用世界单位：太大雾凭空消失，太小出现硬交线。

可见验收：同一雾片分别位于前景岩石之前、之后和相交处；后方被挡，相交柔和，前方仍可见。不把正确公式当遮挡已经通过。

## 水面反射与流水统一

镜面水位 y=w 时，相机 y'=2w-y；视线及 up 的 y 分量镜像，FOV/aspect/near/far 一致，更新 matrixWorldInverse。反射矩阵 `bias * projection * reflectedView`，水面顶点世界位置投影后做 `xy/w` 采样。排除水面自身与不适用的 FX，用 try/finally 恢复 visible/pass 状态；水位以下几何按约定裁剪。

共享 `deep/shallow/foam` uniform 对象，水帘/潭水/飞沫从同一 LOOK 更新。流水坐标是横向和沿流线的米制参数；沿流向 advect 多频噪声，按坡度/下落位置选择泡沫。大形水体需要网格，泡沫可用图案，喷雾用 soft sprite；不能用粒子堆满来遮住水源断开。

反射较低分辨率、受波纹扰动；warp 过强会把树反射拉成蛇。水纹的可见屏幕频率也需要 LOD。采样位置、波速、瀑布源与落点要由共享锚点决定，不独立手写近似值。

## 故障定位表

| 可见问题 | 先查什么 | 最早应修的层 |
|---|---|---|
| 人物像玩具/拼装体 | 中性光轮廓、比例、连续关节 | 几何/姿态 |
| 岩体像有纹理的纸片 | 侧面厚度、剪影、视角变化 | 体积与法线 |
| 天空黑矩形、远景直立切边 | 各镜头视锥覆盖；sky 与相机关系 | 背景几何/相机，非曝光 |
| 峰顶针刺、UV接缝暗线 | 收口位置一致性、首尾法线 | 拓扑 |
| 雾盖住所有前景 | tData绑定、尺寸、深度单位 | 缓冲数据链 |
| 水像布帘/条码 | 坐标方向、频率、采样、重复形状 | 水材质与曲面 |
| 全场噪声细节闪烁 | rest坐标、屏幕导数和最小像素 | 材质LOD |
| 远近都灰、主体不清 | LOOK联动、灰度关系、雾深度尺度 | 光色与镜头 |
| shader正常但成片缺部件 | required模块、NOOP、错误门禁 | 初始化和导出 |
| 导出后 UI 标题错时 | DOM/Canvas 是否由 t 决定 | 时间系统 |

## 能力验收记录

每个能力允许这些结论：已连接且可见验证、只有数值验证、源码确认未实测、未实现、未覆盖。完整“效果对齐”还须整片审看，不由技术模块的勾选自动得出。对比相似景别的轮廓层次、细节密度、色彩/材质一致、动作重量与成片可靠性；不同题材不能直接按截图相似度打分。
