# LEVIATHAN：完整制作体系参考

## 来源与核对范围

- 仓库：https://github.com/0xCodez/leviathan
- 已下载提交：`f12b3460fc5a74281170a873e17817d761d2d44d`，核对日期：2026-11-07。
- 工作区参考副本：`reference-repos/leviathan`。Skill 使用时根据当前工作区定位；该目录不是运行 Skill 的硬依赖。
- 已核对 README、CONTRACT、入口、渲染与材质相关实现、弓手关键建模/姿态、脊柱解算、水体网格、色彩配置、导出/播放器实现；查看了 docs 中弓手与海浪静帧。
- 已从仓库最终 HTML 提取内嵌成片，ffprobe 确认 83 秒、1920×1040、24 fps、1992 视频帧及 AAC；按每五秒抽帧审看，核对近景装甲、中远景尺度、水体与水下层次。这份初次成片核对未完整运行实时工作台、重渲染原片或完成音频听感验收；内嵌影片的画面不证明所有实时声明都生效。其后另有原r170源码35.5–40.5秒120帧导出、接触表与关键帧原尺寸核对及乱序seek抽查；这仍不是全片重渲染或音频验收。

## 先区分两条交付路径

| 路径 | 真实实现 | 使用场景 |
|---|---|---|
| 实时制作入口 | `index.html` 加载 `src/main.js`；`FILM.renderFrame(n)`、`FILM.capture()`；主入口还依赖源文件及 vendor | 改机位、材质、角色和逐帧调试 |
| 最终单文件成片 | `tools/build-player.mjs` 把已渲染 MP4 编成 base64，写入 text/plain reel；`player/player.html` 转为 Blob URL 后交给 video 播放 | 离线观看、稳定声画、降低观看设备 GPU 负担 |

`dist/leviathan_lite.html` 属于第二条路径，约 26.6 MB。不能因为它“纯代码制作”就认定最终 HTML 仍实时执行 Three.js。THE BIG ONE 则采用运行 JS 渲染影片的离线 HTML；两种方式都可以制作纯代码动画，交付特点不同。

## 证据表与可迁移能力

| 已确认能力 | 源码位置 | 决策价值 | 接入条件/限制 |
|---|---|---|---|
| 制作约定覆盖尺度、坐标、角色/道具锚点、镜头归属和更新顺序 | `CONTRACT.md`；`main.js` 的 ctx、ORDER；`archer.js` 的 anchors | 先统一手、弓弦、箭和特效使用的世界位置，减少各自写轨迹造成的脱离 | 小短片可保留轻量约定，无需照搬部门数量或并行代理 |
| 弓手有多段躯干与关节，手脚使用两段 IK，双脚保持支撑 | `archer.js` 的 solve2/pose；`archer-pose.js` 的 pelvisR、waistR、chestR、FOOT | 角色重量来自支撑和分段运动，局部零件之外要检查姿势关系 | 机械分件仍不是人体皮肤变形方案 |
| 曲面装甲有厚度、倒角、起脊，局部面板细节按表面投射 | `archer-geo.js` 的 hull/tube/patch/solid；`archer-model.js`；`archer-mat.js` | 先用连续基础形体确定大形，再覆盖有设计的细节 | 需要法线、投影坐标、材质属性完整匹配 |
| 怪物 GPU 沿脊柱变形，CPU 保留等价点变换 | `lev-spine.js` 的 spineGLSL、Spine.at、toWorld、fromPath/fromCurl | 特效、相机、接触锚点能随变形后的身体运动 | 插值、四元数方向与横截面缩放需和 GPU 一致 |
| 多遍渲染增加专用阴影、镜像反射及水面合成 | `engine.js` 的 setupShadow、updateReflection、render；`passes-env.js` 的 WATER_FS | 明确角色支撑、反射和水面遮挡关系 | 额外成本须实测；材质必须处理 uPass、noShadow/noReflect，不能只复制一个 pass |
| 绘画笔触深度公式（绑定缺口） | `passes-env.js` 的 PAINT_FS，rad 由 tData 深度调整 | 设计意图是近粗远细；该提交的 ENV_UNIFORMS.paint.tData 初值 null，核对 src 未找到赋值 | 迁移需补齐绑定；不能宣称参考默认路径已生效，详见 render-contracts.md |
| 雾、喷溅覆盖层与场景深度作软相交 | `materials.js` 的 overlayMaterial；`engine.js` 给 uSceneData/uRes 赋值 | 雾靠近岩石时能柔和消隐，避免无条件覆盖前景 | 原实现为带 aSprite 的实例化 billboard；接入当前非实例雾时改造顶点输入与深度取值 |
| 立起的水体与水平海面共用色板和泡沫语言 | `fx-splash-mesh.js` 的 seaMeshMaterial/SeaMesh；`passes-env.js` | 瀑布水帘、潭水、白沫应属于同一种水；aF 表示沿流线与横向坐标 | 原方案按海洋米制大尺度调参，瀑布需要重新标定频率、流速和落点过渡 |
| 表面纹理按可见像素大小退细节 | `lev-mat.js` 的 mpp/lod1/lod2；`materials.js` 的 aRest 与局部投影 | 减少远处鳞片/划痕闪烁，纹理随着形变保持稳定 | 正确选择静止坐标、局部坐标和屏幕导数，避免图案随视角游动 |
| 每镜既有 CAMS，也有 LOOKS，与统一色彩脚本混合 | `src/cams/*.js`；`look.js` 的 PRESETS/applyLook | 同时控制构图、主光、雾、绘画半径、描线和水色 | 服务故事需要的变化，不将参考的高饱和晴天硬套到中国山水 |
| 开发入口允许单模块失败回退，导出默认阻止严重加载错误 | `main.js` 的 dept/NOOP；`tools/render.mjs` 的 fatal 检查 | READY 只说明初始化流程走完，不证明模型和特效齐全 | 交付前核对所需模块与 error/pageerror/crash，不能悄悄导出缺角影片 |
| 导出按段缓存，保存源码 hash 与范围 manifest | `tools/render.mjs` 的 sourceHash/segments；`build-player.mjs` 的 poster 映射 | 中断可恢复，修改过源码的片段不会默认混入旧成片 | 源码缓存键要包含当前项目真正的资源与配置；某些脚本旧注释仍称 Sunshower，以实际参数为准 |

## 与 THE BIG ONE 的接入边界

两者共享一类多遍绘画理念，接口并不兼容。例如 LEVIATHAN 的 `writeOut(col, a, normal, depth, id)` 为五参；THE BIG ONE 为 `writeOut(col, normal, depth, id)` 四参。LEVIATHAN 另有 uPass、独立反射/阴影状态、环境模块与纹理属性依赖。适配时从最小代表镜头核对输出与相机空间，再迁移目标能力，避免替换单个 shader 后整片失效。

参考关系：LEVIATHAN 的 CONTRACT 说明其引擎来自早期 Sunshower 制作体系；THE BIG ONE 的 THIRD_PARTY_NOTICES 又列出从 LEVIATHAN 学习/适配的云和脊柱技术。当前两个仓库不能代表 Sunshower 未提供文件的完整内容。

## 可迁移的环境组合

| 目标 | 方法与接入边界 |
|---|---|
| 连续水体与附属FX | 主体、泡沫和喷雾共享色板与事件锚点；横向/沿流线坐标适应当前水体形态，不复制海洋尺度参数 |
| 深度分层 | 雾与场景深度软相交；背景滤波按目标管线的数据绑定和镜头尺度验证 |
| 镜头与照明联动 | 每镜主光、环境、雾和水色由统一LOOK求值，检查过渡中间态而非只看首尾 |
| 稳定观看 | 根据交付需求保留实时入口或另导出MP4，视频型HTML与实时3D明确区分 |

以上描述为技术选择依据，项目是否接入以该项目构建与审片记录为准。源码说明不能替代案例验收。

## 许可

仓库 LICENSE 为 MIT，版权为 2026 Beyond Dev，末尾明确仅覆盖源码；其故事、镜头和设计跟随 AHMII 的参考短片，未被同一声明覆盖。复用代码应保留声明；新题材应自行设计故事、镜头和角色。没有复制旧片的许可不能从源码 MIT 推导出来。
