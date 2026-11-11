# 视频导出与成品后验

`render_film.mjs` 仅用于渲染自己有权制作的离线影片源码；不是网站浏览或 CUA 权限回退工具。依赖 Node 22+、本机 Chrome；`--video`导出和最终MP4证据校验需要 ffmpeg/ffprobe。通过 `CHROME` 指定其他平台的可执行文件。

```sh
node <skill-root>/scripts/render_film.mjs --html /absolute/film.html --out /absolute/review
node <skill-root>/scripts/render_film.mjs --html /absolute/film.html --out /absolute/export --video
```

适用接口及页面约定：

| 接口/条件 | 契约 |
|---|---|
| `window.__ready === true` | 必需资产、字体和渲染准备完成后置true；不是吞掉模块错误后的占位状态 |
| `window.__FILM={duration,fps}` | 时长为秒，两者均为有限正数；省略`--times`时取0、duration/2、duration，显式时间须位于此区间 |
| `window.renderAt(seconds)` | 默认同步、完整地求值并绘制该时刻，包括canvas、DOM标题/字幕与FX；未声明awaited时返回Promise会失败。有限采样/异步渲染采用下述显式完成协议 |
| `body.render-mode`及`?still=1` | 页面进入静帧导出状态：只保留目标画面，暂停独立RAF、CSS墙钟动画/过渡等，所有可见状态由`t`确定。不得依赖某个canvas ID；支持多个canvas及DOM合成 |
| 音频与可选统计 | `__FILM.audio="none"`输出无音轨MP4，不调用WAV入口；`"wav"`要求同步`renderWav(22050)`返回WAV Uint8Array。未声明时兼容旧作品：存在WAV入口则用它，否则无音轨；可选`filmMetrics()`提供项目可解释的统计 |

异步作品显式设置`__FILM.capture={mode:'awaited',timeoutMs:120000}`。`renderAt(t)`必须在姿势求值、累积重置、固定预算采样及所需GPU/降噪完成后，返回`{complete:true,time:t}`；固定采样实现同时返回正整数`completedSamples`与`requiredSamples`，两者必须相等。导出器await并校验报告后才截图，超时、时间不符或预算未完成即失败，不生成本轮manifest。报告是应用的完成信号，不能代替内部正确的GPU等待或证明视觉已收敛。具体适配见[渲染选择](rendering-choices.md#路径追踪与异步导出)。

默认视口1280×720、deviceScaleFactor=1，可传`--width/--height`。页面依据该视口与`render-mode`确定布局；导出器添加该class并兼容隐藏旧`#start`入口，但影片自己的控制层由页面负责清理。字体在READY前准备，导出器也等待当前`document.fonts.ready`；按时间才发起的资源加载也必须在该帧完成信号前结束。

脚本检查页面异常、console.error、浏览器错误日志、READY、声明的渲染完成入口和随机访问图像一致性。导出与比较使用同一目标视口PNG，包含canvas及DOM；不依赖canvas.toDataURL。manifest记录源HTML SHA256、样本帧哈希、`determinism.scope="viewport"`、方法和复取样本，MP4模式另含媒体探测信息、实际音频模式及MP4文件路径/哈希；导出成功前必须核对成片尺寸、fps、帧数、时长和音轨/采样率与声明值一致。编码完成后从MP4重新解码代表帧（开场、25%、中点、75%、最后一个编码帧）以及请求时间点；`videoSamples`记录实际抽帧时间、PNG路径、尺寸和SHA-256，不能复用编码前浏览器帧冒充成片证据。`captureContract`记录模式、超时和awaited调用的完成/预算报告。

复用输出目录时，开始渲染前撤销旧manifest，只有本轮成功才重新生成；失败目录里的旧帧或视频不能作为本轮完成证据。

样本保留精确时间与独立文件名，毫秒舍入重名时附加序号；以manifest的时间/文件/hash对应关系追溯。MP4按本轮`ceil(duration*fps)`帧编码，旧frames目录里多余的尾帧不参与本轮视频；视频帧网格的时长为该帧数除以fps。

确定性比较要求本次固定浏览器/视口/质量档下，同一时刻复取的PNG SHA256完全相同，没有像素容差。它覆盖指定样本时间的最终可见画面，不证明所有时刻、屏幕外状态或跨设备位级一致。噪声与随机源固定；差异时先查状态、字体和动画时钟，不通过放宽阈值掩盖未解释的变化。

脚本不验证姿态、美感、完整离线依赖、听感或播放器输入。导出后完整播放最终编码文件，实际检查构图/文字、压缩伪影、动作连续与结尾；有声音再试听同步、混音与失真。画面和声音结论绑定当前成片，不需要另一套阶段表。

## 独立检查已有导出

```sh
node <skill-root>/scripts/verify_video.mjs <export-dir>/manifest.json
```

对`render_film.mjs`成功生成的报告重新检查实际MP4哈希与ffprobe属性，并将已存PNG及同时间点从最终MP4重新解码的PNG与报告哈希核对。它以导出报告和现有视频/样本为输入；源HTML及离线包由[统一验收](validation.md)单独核对。需要本机Node、ffmpeg和ffprobe，接口/支持字段以脚本为准。该工具只核对报告与现有文件是否一致，不证明审图/试听发生，不判断美观。headless逐帧耗时不是实时FPS。

小片逐帧全量导出即可。该脚本没有实现分段恢复；长片需按源码/资产hash、完成标记和帧范围校验实现缓存。不能把源码 hash 字段称为已具备断点续渲染。

支持 `--query 'study=clay'` 等查询参数并将其记录到manifest；诊断状态必须由影片自身实现，导出器不会自动将场景变成灰模。确定性检查在正序采样后先跳到不属于样本集合的时间，再逆序逐项比较；manifest记录`seekProbe`，保证单采样点也实际离开该时刻。灰模应在渲染阶段去掉材质细节与特效，不能只把最终截图去色。

导出器修改后运行真实浏览器回归：`node --test <skill-root>/scripts/tests/render_film.test.mjs`。测试验证接口、最终视口确定性和错误门禁；它们不是影片画质或播放器交互验收。
