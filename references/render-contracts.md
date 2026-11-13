# 自定义渲染与多遍合成的数据契约

只在需要自定义绘画、描线、深度雾、阴影/反射或多遍处理时使用。PBR、MatCap和烘焙路线按 [渲染选择](rendering-choices.md) 建立自己的契约；下面的通道布局是可选设计，不是Three.js通用接口。

## 三层职责与五项核对

基础renderer负责投影与GPU执行；对象材质负责表面颜色和受光；后期负责选择性描绘、合成及显示输出。同用Three.js不表示使用相同shader、缓冲或后期，不能把所有外观差异归结为模型参数。

每项效果记录：数据源、单位/坐标、何时绑定、实际消费者、可见检查。声明了uniform或写了公式，但未正确绑定的功能不可记为已实现。不同模块的writeOut签名、alpha含义和pass状态不一致时先统一或适配，不能凭同名函数混用。

## 屏幕 / 窗口坐标实测校准

先写清着色器读的是哪一种坐标：模型/世界坐标描述物体位置，裁剪坐标是透视除法前的齐次坐标，窗口坐标是当前framebuffer的像素坐标，`gl_PointCoord`是单个点图元内部的局部坐标。它们不能共用同一组“画布宽高”。

在 WebGL/GLSL 中，`gl_FragCoord` 是 `vec4` 窗口坐标：默认原点在左下角，左下像素中心为`(0.5,0.5)`；`.xy`已经包含活动 framebuffer viewport 的像素偏移。它不等于CSS坐标、NDC或`gl_PointCoord`。`gl_PointCoord`用于粒子/点精灵内部的0..1裁形，不表示画布位置。

Three.js r187 的画布 viewport API以逻辑像素传入，并乘当前 pixel ratio；render target 则直接使用 target 自己的像素 viewport/scissor，target pixel ratio 为1。画布用`renderer.getDrawingBufferSize()`读取真实输出尺寸，用`renderer.getCurrentViewport(new THREE.Vector4())`读取已换算的活动 viewport；RT使用当前 target 的 viewport。resize、DPR、分屏和离屏pass切换后，必须同步更新对应shader uniform，不得固定写死`800×600`或误用CSS宽高。

最小着色器应把活动窗口像素换算成当前 viewport 的局部比例：

```glsl
uniform vec4 uViewportPixels; // x, y, width, height：当前 framebuffer 像素
void main() {
  vec2 localPixels = gl_FragCoord.xy - uViewportPixels.xy;
  vec2 uv = localPixels / uViewportPixels.zw;
  outColor = vec4(uv, 0.0, 1.0);
}
```

uniform须在实际绘制前从活动输出读取，而不是由上层重复推算：

```js
const viewportPixels = renderer.getCurrentViewport(new THREE.Vector4());
material.uniforms.uViewportPixels.value.copy(viewportPixels);
renderer.render(scene, camera);
```

如果调用方自己绑定 target 或 viewport，应由那个 pass 显式传入其像素矩形；恢复renderer状态不能代替坐标正确性。局部0..1映射还须决定是否减半像素/是否使用pixel center；不要靠视觉微调掩盖半像素偏差。

校准至少包含一条真实像素链：非零viewport原点、目标右上区域、viewport外像素、scissor裁边；画布路径覆盖DPR1/2与resize，离屏路径覆盖target真实尺寸。用`readRenderTargetPixels`或同一帧内`gl.readPixels`比较GPU结果与理论像素中心值。查看状态和uniform数值只证明输入接线，不能证明GPU采用了同一坐标。可运行的r187探针：[窗口坐标校准实验](../assets/examples/screen-coordinate-lab/index.html)与[材质构造器](../assets/rendering/screen-coordinate-probe.mjs)。

## 可选G-buffer

| 信息 | 消费方式与约束 |
|---|---|
| 场景颜色 | 明确scene-linear/显示编码；浮点HDR与后期的输入输出保持一致 |
| 绘画/主体mask | 区分可滤波背景与应保留硬边的主体；mask不是普通透明度 |
| 视空间法线 | 约定编码/解码；双面、非均匀缩放和实例法线正确；强凹凸不必污染描线 |
| 正线性视深度 | 例如`-viewPosition.z`，不同于深度buffer的0..1值或欧式距离 |
| 部位/风格身份 | 决定相邻结构的内部线与免描线类别；编号由项目约定，不给每粒水滴随机身份 |

深度与身份使用足够精度，数据采样避免边界插值出不存在的身份。内部渲染尺寸与最终输出尺寸分开，屏幕坐标取样使用当前target实际尺寸。透明覆盖层的混合不应覆盖主场景身份数据。

## 选择性绘画、描线与输出

绘画滤波仅处理允许的像素，邻域保护重要轮廓；笔触半径随尺度变化须有真实深度绑定，距离半径变小不等于自动跨深度安全。描述效果时核对开关残留，例如半径为零仍可能保留纸纹。

描线可来自身份变化、深度跳变和法线转折；水/雾与角色可以采用不同边界策略。手工设计的表情线、衣褶与标识需要相应曲线/纹理/几何输入，自动边缘检测不能决定这些设计。线宽与细节按目标像素控制，保持运动中的稳定。

在初始化/协议变化且无通过证据时检查必要校准物：颜色、非均匀缩放、前后遮挡、身份边界和相关透明交界。纯研究阶段只解释已存在的证据；同配置已有证据可沿用，不每次重建探针。

## 软相交雾与透明反馈

覆盖雾片输出自身正线性视深度，读取同空间场景深度：

```glsl
float sceneDepth = texture(uSceneData, gl_FragCoord.xy / uRes).b;
float soft = clamp((sceneDepth - vDepth) / uSoft, 0.0, 1.0);
float alpha = mask * opacity * soft;
```

绑定正确的数据附件与分辨率；uSoft采用相同世界单位。实例billboard和普通plane的顶点输入不同，不能只换材质定义。关depthTest不代表无须遮挡，depthWrite通常关闭以免软边遮住后续透明元素。

在前景物之前、之后和交界处核对：后方被挡、相交柔和、前方仍可见。公式本身不证明遮挡通过。

## 阴影、反射与共享状态

阴影选择必要投射对象、收紧相机范围，再处理bias与法线偏移。接触漂浮、自阴影条纹和未接阴影是不同故障；灰模/关纹理诊断不能用最终截图去色代替。

平面反射水位为w时，相机Y镜像为`2w-y`，视线/up相应镜像，投影参数一致；用反射矩阵投影采样，排除水面自身并按约定裁剪。反射与阴影均在消费者读取前更新，不读写同一个target；用try/finally恢复visible、target、pass与颜色/环境状态。

主水面、水帘和飞沫共享水色、泡沫与事件，流速沿真实流向组织；反射扰动过大和高频纹理都可能破坏材料观感。每个pass说明是否处理透明、是否重复tone mapping、资源由谁释放。

## 定位与放行

轮廓/厚度错先修几何；无重量先修姿态/支撑；图案游动先查坐标；雾遮挡错先查深度链；全片发灰先查光色和输出转换；缺对象先查初始化/显隐/错误门禁。一次干预回答一个问题，结果按 [验收](validation.md) 分别记录，技术通过不替代画质或交互。
