# THE BIG ONE 与 LEVIATHAN：源码全链路审计

## 审计范围与结论口径

核对仓库固定提交：THE BIG ONE `081fca87bcff74220a762b8ac64e4057b4e823fa`（Three.js `^0.170.0`）；LEVIATHAN `f12b3460fc5a74281170a873e17817d761d2d44d`（Three.js `0.170.0`）。范围覆盖两仓库自写的 `src/`、`tools/`、播放器、README/制作合同、依赖与最终交付形态。第三方 `vendor/`、`node_modules/` 和打包后单体文件按其来源和交付作用核对，不逐行复述第三方实现。

以下区分四种结论：

- **源码事实**：可在固定提交的文件、调用点或配置中直接核对。
- **仓库自述**：README/PLAYBOOK/CONTRACT 的制作者陈述，不等同于独立验证。
- **观感判断**：对实际画面和镜头的视觉解释，不当作单一源码事实。
- **迁移建议**：对新题材有效的因果原则；不是要求复制旧片设计或参数。

## 一、两条制作路线的共性与区别

两个仓库都不是“下载模型、放入场景、加灯、输出视频”的简单流程。它们将故事、镜头、可见几何、材质输出、动画状态、环境反馈、声音和离线交付组织成完整制作系统。两者均大量使用代码建模，也都将最终画面逐帧输出；但其最终 HTML 采用不同播放机制。

| 维度 | THE BIG ONE | LEVIATHAN |
|---|---|---|
| 叙事与镜头 | 39 秒，13 镜；`shots.js` 给 cue 与 shot，`director.js` 按全片时间求角色、场景、相机和特效状态 | 83 秒，39 镜；`shots.js` 建立 cue 与镜头归属，`cams/*.js` 分部门提供每镜相机和 look，`main.js` 求出每帧状态 |
| 场景组织 | 单一场景世界与一组时间驱动对象；水面上/水下由 director 与环境状态切换 | world、archer、leviathan、ships、under、energy、splash、tether 分部门建立，统一通过 `ctx`、锚点和更新顺序协作 |
| 建模侧重 | 小机器人、巨型海兽、渔船、海面、云、鱼群和海鸟；参数曲面、几何雕刻、程序化水云与实例对象 | 装甲弓手、巨兽脊柱、集装箱船、海岸/港口/水下地形、箭和能量/水体特效；专用 mesh builder、shader 材质和镜头部门 |
| 渲染 | main MRT → 背景绘画滤镜 → cel 像素描线 → 水/大气/overlay → bloom/grade/grain | 阴影深度 → 反射 → main MRT → paint → ink → screen-space water → atmosphere/overlay → bloom/grade；增加专用反射、阴影、不同材质 pass 状态 |
| 声音 | JavaScript 离线合成完整立体声音轨；实时播放器先合成，再以 Web Audio 时钟驱动画面 | 多模块生成配乐/音效，离线渲染与混音；MP4 再封装进最终播放器 |
| 最终 HTML | 打包 Three.js 和 `renderAt` 运行代码，离线 HTML 实时渲染 | `build-player.mjs` 将已渲染 MP4 分块 base64 后由视频播放器播放；实时编辑入口仍是源码工作台 |

**关键判断**：相同的“Three.js 纯代码”标签不代表相同的渲染实现或视觉结果。LEVIATHAN 的最终 HTML 是预渲染视频播放器，并非在观看端重新运行整套 Three.js 场景。

## 二、THE BIG ONE：从时间输入到画面/声音

### 1. 入口与状态流

`src/main.js` 建 renderer、`scene`、单独的 `overlay` 和 camera，并初始化 sky、ocean、world。`renderAt(t)` 限制时间范围，设置全局着色器时间，调用 `director.direct(t, world, camera)` 取得这一刻的状态，再更新 sky/ocean/world、执行 `engine.render`、画标题。播放器和导出器调用同一个入口。

```text
shots.js: FPS / DURATION / CUES / SHOTS
    ↓
director.js: direct(t) → 相机、姿势、道具、表情、环境、FX 状态
    ↓
main.js: renderAt(t) → uniforms → sky/ocean/world → Engine.render
    ├─ audio.js: renderScore(sampleRate)
    ├─ player.js: audio clock / seek / pause / replay
    └─ tools/render.mjs: 逐帧捕获 → ffmpeg
```

`util.js` 提供带种子 RNG、插值、时间轨道、kick 和 on-twos/on-threes。导演状态从绝对时间计算，角色和水 FX 可用不同抽帧率；播放主时钟仍连续。随机访问一帧不应依赖此前播放过的帧。

### 2. 角色、道具与环境

| 文件 | 实际职责与可迁移机制 |
|---|---|
| `robot.js` | 自写曲面生成器、super-ellipsoid、lathe、hose、两骨 IK、角色装配和表情 shader。头部眼睛、眼睑/瞳孔/脸部反应是可被时间表驱动的表演状态；道具/手部依赖锚点。是机械角色方法，不是写实人体皮肤方案。 |
| `lord.js` | 巨兽以长度截面曲线确定静态主形，在截面上雕刻头、背脊、侧棱、腹部、鳃/唇/下颌等；网格带 rest 坐标和部位身份，顶点 shader 沿脊柱姿态变形；材质 shader 负责表面纹样、凹凸、轮廓/明暗、受湿状态和局部效果。GPU 变形降低 CPU 逐点操作成本，但 CPU 世界锚点需要和 shader 公式保持一致。 |
| `boat.js` | `hullGeo`/`deckGeo` 和自写形体函数直接构造船壳、甲板、软倒角盒、曲线管件、缆绳、细节；结构跟随船体曲面和尺度，不是简单 primitive 堆叠。 |
| `ocean.js` | 用若干方向/波长/振幅的解析波和 GLSL 计算海面高度，CPU 查询高度也复用波模型，便于船体/浪尖/动作接触落在同一水面。 |
| `sky.js` | 云不是许多互相独立受光的白球；云团作为云塔的组成形状，shader 用整体宏观法线统一光照，再保留局部团块轮廓。避免重复月牙形亮暗。 |
| `world.js` | 场景道具、渔具/钓竿、环境组、标题绘制与对象更新的组合入口。 |
| `gulls.js`、`school.js` | 各自定义鸟/鱼几何和群体放置/动画；它们补足环境生命，而非只用雪粒/粒子填充画面。 |
| `fx.js` | 对水、雾、泡泡等效果设容量/批次并组织更新，控制大量元素在生产镜头中的成本。 |

`director.js` 的主体不只是“换相机”。它按 cue 组织拖船轨迹、巨兽上升/潜水/翻身、嘴部开合、帽子离开/回收、钓竿与手目标、摇晃和浪高，再让角色/场景/特效读取共同状态。这样物体相对位置和故事事件能够一致。

### 3. 材质和画面管线

`glsl.js` 定义共用 uniforms、噪声、世界/视图坐标辅助、MRT 输出契约。`materials.js` 将 cel 主体与 overlay 材质分开。`engine.js` 的流程不是后加一个全屏滤镜，而是先把场景写入颜色与数据附件，再让后续 pass 根据像素类别处理：

```text
主场景 MRT（color + normal/depth/material identity）
  → PAINT：仅处理标为绘画背景的区域
  → INK：按材质身份、深度变化、法线变化描 cel 轮廓/内部线
  → ATMOS：雾、水下透视、光束/闪光
  → overlay FX
  → bloom
  → final：grade、vignette、grain、速度线与缩放输出
```

主体验收的关键是**对象身份贯穿整个管线**：角色 cel 边缘要清晰，远山/云可接受绘画处理，水面和 overlay 有专门合成；所有像素不能一律做同一强度的模糊和黑边。

### 4. 声音、播放器和生产工具

`audio.js` 是总音轨生成入口；`audio-music.js` 写乐段/和声节奏，`audio-sfx.js` 写剧情音效，`audio-inst.js`/`audio-sfxlib.js` 提供合成器、乐器/声源与音效原语，`audio-dsp.js` 提供采样、滤波、包络、声像和 WAV 编码，`audio-master.js` 提供混响、EQ、动态处理、限幅等母带工具。声音数据与视觉 cue 同时间轴，写成可重复生成的音频，而不是播放过程中随机拼音。

`tools/` 各司其职：`browser.mjs` 定位/启动 Chrome；`build.mjs` 用 esbuild 将 Three 和源码内嵌为单文件 HTML；`render.mjs` 逐帧将 `renderAt` 结果送给 ffmpeg；`render-audio.mjs` 生成 WAV/电平报告；`snap.mjs` 抽取时间/镜头静帧；`covers.mjs` 生成封面；`pops.mjs` 扫描帧间突变并排除切镜；`perf.mjs` 观测帧性能；`serve.mjs` 提供本地服务。这些脚本的存在证明设计意图，某次成片是否通过仍要看实际运行记录。

## 三、LEVIATHAN：部门系统、场景与数据契约

### 1. 主入口和跨部门状态

`main.js` 动态注册 `cams/{archer,monster,ships,world,under}.js` 的 `CAMS/LOOKS`，构造 `ctx` 后依次加载 `world`、`archer`、`leviathan`、`ships`、`under`、`energy`、`splash`、`tether`。`shots.js` 的 `evalFrame(frame)` 产出当前 `shot/set/cue/look/camera` 状态；入口应用 look、相机和全局 uniforms，按固定 `ORDER` 更新部门，再调用 `Engine.render`。镜头拥有者维护自己的相机和 look，跨部门通过 API、锚点与 `ctx` 通信。

`CONTRACT.md` 规定尺度、坐标、set 可见性、部门文件所有权、更新先后、角色/物件锚点和 FX 数据约定。`archer.anchor()`/`leviathan.anchor()` 给特效和跨镜头飞行道具提供实际世界坐标。FX 通过这些点对齐手、箭、巨兽嘴/背/腹/尾/爪等部位，而不是单独写另一组近似轨迹。

`dept()` 的错误会 catch 后退回 `NOOP`，可让工作台继续运行；因此 `FILM_READY` 不能单独证明角色或效果存在。导出工具的错误门禁要检查必需模块是否真的建立。

### 2. 几何、材质和角色

| 文件组 | 构造方法与工作分工 |
|---|---|
| `archer-geo.js`, `archer-model.js` | `tube` 以分段截面定义身体曲面；`solid` 生成皮肤/基础网格；`patch` 将有厚度、倒角、起脊、鼓起的表面板片贴在曲面上；`hull/cbox/extrude` 补关节、装甲和异形件。`Kit` 按关节合并 geometry，保留 vertex color、material flags、ink ID 等属性，控制 draw calls。 |
| `archer.js`, `archer-pose.js`, `archer-bow.js`, `arrow.js` | 关节层级、弓/箭、动作姿态、手脚目标和两骨 IK；脚有支撑目标，躯干分 pelvis/waist/chest，弓弦/手/箭头以可查世界锚点关联。弓手是巨大机械弓手，不宜当作真人脸或软组织体型范本。 |
| `lev-body.js`, `lev-limbs.js`, `lev-spine.js`, `lev-anim.js`, `lev-whale.js`, `leviathan.js` | 巨兽静止曲面按长度截面生成，独立构造下颌、眼、肢/鳍、背刺/纹理；脊柱骨架经 Catmull-Rom/四元数插值在 GPU 变形，CPU 同步查询变形后的 anchor；动画按每镜轨迹组织弓背、breach、roll、游动/爬行和鳍尾摆动。 |
| `lev-mat.js`, `archer-mat.js`, `ships-mat.js`, `materials.js` | 每类对象有定制 shader 和材质数据通道：cel 分带光、硬高光/反射、磨损/纹理、材质身份、局部细节和特效受光；并非一个标准材质给所有对象。 |
| `ships-model.js`, `ships-bridge.js`, `ships-deck.js`, `ships-s16.js`, `ships-swell.js`, `ships-tex.js`, `ships.js` | `Batch` 将盒/圆柱/管等组件变换并合入网格，船体本身按截面生成；甲板/桥楼/栏杆/系固架/集装箱有分级细节和颜色随机布局；`ships-swell.js` 还把船体姿态与浪面高度相连。 |

### 3. 世界、FX 与跨对象反馈

| 文件组 | 实际职责 |
|---|---|
| `world-coast.js`、`world-flight.js`、`world-planet.js`、`world-port.js`、`world-sea.js`、`world-sky.js`、`world-ocean-glsl.js`、`world.js`、`bgmaterials.js` | 按 coast/flight/orbit/port/ocean 等镜头环境建立地形/道具、飞行轨迹、星球/云海、海面、天空和专用背景材质。多个 set 可以共存于坐标系中，但非当前 set 要隐藏。地形采用噪声/高度和专用材质，近景轮廓与远景色面分层。 |
| `under-env.js`、`under-life.js`、`under-rock.js`、`under-sets.js`、`under-stage.js`、`under.js` | 水下独立有环境色、雾幕/光柱、海底生物、岩石和 canyon/arena set。舞台控制哪些地形/特效显示，并与主场景的水位/镜头状态协作。 |
| `fx-energy*.js` | 把箭的蓝光、蓄能、闪电、光束、天空撕裂、再入火焰、水下放电分成几何批次/材质/部门，直接读角色、箭、巨兽锚点。overlay 能按场景深度重照明角色而不将角色画面冲成白块。 |
| `fx-splash*.js` | 水花核心网格、粒子喷发、大片水墙/泡沫、海上冲击、水下效果分别建模/渲染；以共享的水体材质语言和事件时间组织，不把每个水滴各自描边。 |
| `tether*.js` | 箭绳/缆索 ribbon、harpoon tether 等连接物按两端锚点/曲线更新，并从所属角色/道具获得坐标。 |
| `tex-foliage.js`、`textures.js`、`bgmaterials.js` | 生成 foliage/detail atlas、角色面板/程序纹理和背景专用材质。图案带静止位置或投影坐标，以免变形/镜头移动时滑动。 |

### 4. 相机、色彩、渲染与音画

`cams/*.js` 将 camera 与 LOOK 分镜头分别组织；`look.js` 将太阳方向/强度、主光、雾、色调、水位、描线宽度、笔刷半径、阴影和反射参数应用到统一全局状态。它允许镜头各自构图，同时沿一套可追踪色彩机制保持片内一致。

`engine.js` 建立双附件 main target（color + data）、深度纹理、独立阴影 target、反射 target、绘画/描线中间 target 和 bloom 金字塔。pass 顺序会消费前序结果；材质必须遵从 `uPass`、`writeOut(...)`、物体 ID、阴影/反射排除标记等契约。LEVIATHAN 与 THE BIG ONE 的 `writeOut` 参数签名、空间/状态约定并不相同，不能混用。

声音模块与 THE BIG ONE 类似按功能拆成 `audio-dsp/inst/music/sfx/sfxlib/master/audio.js`；`tools/render-audio.mjs` 负责试听/检查/输出 WAV，画面 cue 与音频合成中的节拍对应。实际听感仍须对最终混音监听。

### 5. 生成工具和观看产物

- `tools/snap.mjs` 按帧/时间/shot 抓图并生成 contact sheet；`probe.mjs` 支持相机/时间探针；`check.mjs` 检查页面运行错误。
- `tools/render.mjs` 逐帧/分段渲染，可记录输入 hash、帧范围、失败状态并从有效片段恢复；成功退出需检查 manifest 与最终视频。
- `tools/build-player.mjs` 检查视频/帧与 poster 对应，按需要压缩 web 版，再把 MP4 分块内嵌到单文件播放器；`player/player.html` 从嵌入内容构造 video source；`player/test-player.mjs` 测播放器行为。
- `dist/leviathan_lite.html` 是约 26.6MB 的预渲染成片播放器。实时场景开发入口仍是 `index.html`/`src/main.js`。

## 四、两仓库共有的质感因果链

观感判断依据：实片画面、镜头表和上述源码。质感来自多层共同作用，不应归因于某个“魔法 shader”。

1. **轮廓与体积先成立**：模型的截面、姿势和物件连接先在纯色/灰模下成立；高细节不能救扁平轮廓。
2. **表面细节有材料理由**：装甲缝、布料折叠、磨损、鱼皮/岩石纹理、船体结构区分材料；细节密度跟最近景别匹配。
3. **光照为形体服务**：硬 cel 明暗、冷暖分层、背光、反射/湿润高光与环境色共享统一 look；避免默认均匀环境光把所有东西照平。
4. **空间按景别分层**：前景遮挡、中景主体、远山/云/海色面、尺度参照和深度雾建立远近；大尺度主体不能脱离地面、水线和反应物。
5. **画风对不同像素分别处理**：物体/像素身份让背景绘画、角色墨线、水面、雾和光效分别保持合适边缘；全屏同质化会冲掉设计。
6. **动作能显示重量和意图**：预备、支撑、发力、迟滞、回弹、眼神/手部表演、道具接触和环境反应由同一时间 cue 管理。
7. **镜头揭示细节**：景别变化、取景尺度和动作节拍刻意安排；每个关键模型都要在最终镜头中被看见，wide 能读 silhouette，close-up 才有表面细节。
8. **声音/环境与事件同步**：浪、泡沫、雪、雾、脚步、光效、音乐在事件前后响应，静帧质感因此扩展为影片质感。

## 五、比较新项目时的诊断顺序

先读取目标项目当前入口、资产生成、材质/后期、动作与实际画面；仓库研究记录不能代表当前实现。依次核对：设计规格是否明确，主形与连接是否成立，姿态/接触是否连续，材质输出是否被消费者读取，光照/机位是否揭示结构，交付能否播放。将症状定位到最早失效的层；不凭题材/文件名推断“只有基础体”“未接MRT”或“已达到参考”。具体项目结论只写入项目自己的审片记录。

## 六、从参考迁移到新片的顺序

1. **建立证据**：固定 commit、Three 版本、许可、入口、实时/最终播放器区别；沿 `输入 → 状态函数/生成器 → mesh/material/buffer 消费者 → 最终画面` 跟踪机制。
2. **选一镜定目标**：以目标景别和已知画风锁主体屏幕面积、轮廓、关键色块、焦点/运动、接触点、背景层次；不先做全片环境。
3. **灰模检形**：人体/机械/生物选合适表示；验证正侧轮廓、构图与关节极限。近景主体不能停在未解决结构的blockout；规则形道具、远景或有明确二维最终表达的代理体可以使用基本体。
4. **设计材质数据**：明确哪类对象用连续光照/赛璐珞/背景绘画/透明 FX；给每个 pass 定义输入、空间、颜色空间、ID、深度和失效状态。
5. **补表演与环境反馈**：建立支撑/世界锚点，核对 GPU 变形后位置；所有更新从绝对时间求值并按故事事件联动。
6. **逐步接后期**：灰度/颜色/法线/深度/ID 调试图确认后再接绘画、墨线、雾、反射和 bloom；逐项做 on/off 对照，审画面实际受益和成本。
7. **锁住导出**：关键帧随机 seek 可复现；预热 shaders；首帧、特写、切镜、遮挡、末帧和无声/有声播放均覆盖；区分实时 3D 与预渲染视频交付。
8. **讲清迁移边界**：源码方式、实际接入、画质验收、性能验证分别记载；不能把“研究过”“构建成功”写成“效果已达到”。

## 七、完整模块地图

下列清单用于按需回到固定提交查源码，不意味着每次制作都要加载每个文件。

### THE BIG ONE

- **叙事/主循环**：`src/main.js`、`shots.js`、`director.js`、`player.js`、`util.js`。
- **渲染/材质**：`engine.js`、`glsl.js`、`materials.js`。
- **角色/物件**：`robot.js`、`lord.js`、`boat.js`、`gulls.js`、`school.js`。
- **自然环境/特效**：`sky.js`、`ocean.js`、`world.js`、`fx.js`。
- **声音**：`audio.js`、`audio-dsp.js`、`audio-inst.js`、`audio-master.js`、`audio-music.js`、`audio-sfx.js`、`audio-sfxlib.js`。
- **工具/交付/说明**：`tools/browser.mjs`、`build.mjs`、`covers.mjs`、`perf.mjs`、`pops.mjs`、`render-audio.mjs`、`render.mjs`、`serve.mjs`、`snap.mjs`；模板 `src/template.html`；依赖 `package.json`/`src/package.json`；根目录生成交付 `the_big_one.html`；说明 `README.md`、`docs/PLAYBOOK.md`、`docs/PROMPT.md`、`THIRD_PARTY_NOTICES.md`。

### LEVIATHAN

- **主循环/叙事/色彩**：`src/main.js`、`shots.js`、`look.js`、`util.js`、`cams/{archer,monster,ships,under,world}.js`。
- **引擎/材质/环境 shader**：`engine.js`、`glsl.js`、`materials.js`、`passes-env.js`、`bgmaterials.js`。
- **弓手/箭**：`archer.js`、`archer-geo.js`、`archer-model.js`、`archer-mat.js`、`archer-pose.js`、`archer-bow.js`、`arrow.js`、`tether.js`、`tether-harpoon.js`、`tether-ribbon.js`。
- **巨兽/鲸**：`leviathan.js`、`lev-anim.js`、`lev-body.js`、`lev-limbs.js`、`lev-mat.js`、`lev-spine.js`、`lev-whale.js`。
- **船**：`ships.js`、`ships-model.js`、`ships-mat.js`、`ships-tex.js`、`ships-bridge.js`、`ships-deck.js`、`ships-s16.js`、`ships-swell.js`。
- **世界/水下**：`world.js`、`world-coast.js`、`world-flight.js`、`world-planet.js`、`world-port.js`、`world-sea.js`、`world-sky.js`、`world-ocean-glsl.js`、`under.js`、`under-env.js`、`under-life.js`、`under-rock.js`、`under-sets.js`、`under-stage.js`。
- **FX**：`fx-energy.js`、`fx-energy-charge.js`、`fx-energy-core.js`、`fx-energy-flight.js`、`fx-energy-mat.js`、`fx-energy-sky.js`、`fx-energy-under.js`；`fx-splash.js`、`fx-splash-big.js`、`fx-splash-core.js`、`fx-splash-emit.js`、`fx-splash-mesh.js`、`fx-splash-sea.js`、`fx-splash-under.js`。
- **纹理/声音/工具/观看**：`tex-foliage.js`、`textures.js`、`audio.js` 及 `audio-dsp/inst/master/music/sfx/sfxlib.js`；`tools/build-player.mjs`、`check.mjs`、`env.mjs`、`probe.mjs`、`render-audio.mjs`、`render.mjs`、`sheet.mjs`、`snap.mjs`；`player/player.html`、`player/test-player.mjs`；入口 `index.html`/`audio.html`，依赖 `package.json`，生成交付 `dist/leviathan_lite.html`；说明 `CONTRACT.md`、`README.md`、`LICENSE`。

## 八、核对边界与风险

- 两仓库同为 Three r170，迁移到不同 Three 版本仍须实际构建、shader 编译和 target 兼容验证。
- 两套 MRT `writeOut` 参数、数据通道、pass 状态并不兼容；迁移应以校准场景证明颜色/法线/深度/ID，不要逐文件复制。
- LEVIATHAN 的 `passes-env.js` 绘画 pass 的深度依赖在对应 uniforms 绑定上需要再检查；源码存在深度自适应公式，不足以单独证明所有镜头都启用了正确深度 LOD。
- 文档声称、注释、API 成功、浏览器 READY、MP4 存在是不同证据等级；以输入来源、运行状态、生成画面、视频流和实际观看分别证明。
- MIT 只覆盖相应仓库源码及其声明的范围；参考片的故事、镜头、设计、图片/音频和第三方资产仍单独遵循各自许可。
