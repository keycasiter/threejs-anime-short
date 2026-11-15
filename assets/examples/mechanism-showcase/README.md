# 往复之间：交互机构与影片共源样例

适用于需要让观众理解零件运动、连接关系及状态变化，并希望交互演示与短片共用同一场景/运动状态的任务。场景由 Three.js r187 代码生成；没有外部模型、图片或网络资源。

## 文件职责

- [`../slider-crank.mjs`](../slider-crank.mjs)：米制曲柄滑块机构工厂，Y向上、运动平面为XY、前方为+Z；纯函数`stateAt(t)`计算角度/活塞位置/速度，`applyState(t)`将同一状态写入飞轮、销、连杆、活塞和标注锚点。材料由调用方拥有，工厂创建的几何由`dispose()`释放。
- [`main.mjs`](main.mjs)：完整影棚、透明剖视缸体、承载台、灯光/探针/后期、CSS2D标注、播放/步进/复位、轨道相机和影片绝对时间镜头。
- [`index.html`](index.html)：交互演示入口；影片模式下统一隐藏交互面板和加载层，保留机构、目标视图和结构标注。

## 状态与数据接力

`stateAt(t)`以曲柄半径`r`、连杆长度`L`、周期`P`解析求值：`θ=2π(t mod P)/P`，`x=r cosθ+√(L²-r²sin²θ)`。它不依赖帧累计，能够随机时间定位；同一`applyState(t)`更新实体几何，交互滑块和影片导出均调用`renderAt(t)`。测试检查行程极值、周期复现、连杆长度、输入边界与资源释放。影片镜头另外按绝对时间求值，不能把机构循环相位误当作相机时间。

模型使用透视真实的间隙/接头：带厚度的曲柄销、实体圆柱连杆、活塞环、开口透明缸筒、导轨、螺栓和可读承载台。半透明窗口主要服务于结构解释；若目标是产品照片或工程仿真，应按目标重新设计透明度、剖切和几何精度。当前机构是理想刚体运动学，不模拟摩擦、接触冲击、热力学、弹性或制造公差。

## 本地运行与验证

将 Three.js `0.187.0` 的`build/`与`examples/jsm/`放在本目录`vendor/`，从Skill仓库根目录运行：

```sh
THREE_MODULE=/absolute/path/to/three/build/three.module.js node --test scripts/tests/slider-crank.test.mjs
node scripts/render_film.mjs --html "$PWD/assets/examples/mechanism-showcase/index.html" --out /absolute/output --video
node scripts/verify_video.mjs /absolute/output/manifest.json
```

影片导出使用标准 `__FILM` / `renderAt(t)` 接口，并声明 awaited 呈现协议，确保WebGL新帧完成呈现后再截取。当前示例已用本机Chrome导出7.2秒、24fps、1280×720的173帧MP4，并通过最终编码帧抽样校验。每项新任务仍需按真实画面检查初始/极值/中间状态、标注遮挡、结构可读性、镜头切换和影片全片；程序测试与MP4契约不是视觉评分。
