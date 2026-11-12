# 从视觉特征到可调参数

在参考拆解后、生成器开工前使用；对应算法读[算法配方](algorithm-recipes.md)。参数的目的，是让Agent能直接改变目标特征，并保持结构、附件和画面之间的因果关系。

## 先给特征真正的自由度

| 层 | 从目标提取的输入 | 实际责任 |
|---|---|---|
| 世界身份 | 区域、焦点/留白、地标、连接图、主高差与视域 | 主方向和空间关系；先设计，再有边界地生成 |
| 结构 | 分段站位、宽/深、偏心/方向、开间/枝级、开口/壁厚、连接 | 改变实际轮廓、负形、转折或承接；不能只有整体scale |
| 表面与表现 | 材料形成区、米制纹理、roughness/透射、太阳/环境、波组 | 表面身份与受光；不替代缺失的结构 |
| 运行与采样 | 段数/网格间距、实例批、LOD、RT、dt/子步 | 表达误差、稳定性和成本；不是美术细节本身 |

例如同一个“更饱满”可能指中段截面变宽、背侧厚度增加或冠层包络改变。先从目标与互补视图决定是哪一种，再暴露能直接控制它的参数。若两个候选只改变全局曲率，却都没有目标分段，增加分段输入或换表示。

每个决定身份的待实现特征，把下列信息就近写到实际参数定义/生成器文档中，不另造全场强制JSON协议：

| 内容 | 例子 |
|---|---|
| 含义、单位、空间与来源 | `depth:1.8`是该站全深，米，局部截面；参考透视估计为设计值 |
| 有效域与联动 | 正壁厚且小于局部半径；IK杆长满足可达；零振幅时避免除零 |
| 计算与消费者 | 宽深→截面顶点→侧面/端盖；同站端口→连接件；不是只写userData |
| 更新及成本 | 拓扑改变重建几何；uniform变更就地更新；历史模拟重置/重放；旧自有资源释放 |
| 观察与失败 | 固定镜头看侧背厚度与口沿；急弯翻入先调过渡范围，而不是加光 |

参数名不能替代查公式。同名persistence可能是振幅倍率或指数；roughness可能指几何不规则度或材质微表面粗糙度；minSlope可能实际取高度差下限。默认值、教程示例值、当前设计选择和未确认单位分别标注。

## 把依赖写成实际更新顺序

使用一个权威设计对象；派生值在构建函数里计算，不把同一位置在多处硬编码。结构seed按稳定对象ID/用途派生，改纹理不重排全场。

| 修改 | 重算范围 | 保留范围 |
|---|---|---|
| 连接图/路宽 | 路带/节点、地块、入口/基础、占用与导航 | 未受影响区的身份与原型 |
| 截面站位/宽深 | 实际网格/边界、对应端口与附属件、接触与加速结构 | 材料身份；UV仍核对实际度量 |
| 地形/水位 | 地面/河道、真实宿主查询、基础/分布/湿区消费者 | 独立区域的手工焦点，不随随机流漂移 |
| 材料或灯光 | 需要的纹理/uniform、阴影/探针或预热 | 已成立的布局与几何 |
| dt、事件或历史初态 | 完整模拟状态/检查点/双缓冲、按固定输入重放 | 静态生成内容 |

这些是按实际依赖选择的责任，不要求所有项目实现全量更新框架。先完成一次正确build，再给确实要探索的控制量提供更新入口。重建时先生成成功的新对象，再替换场景并释放旧自有几何；共享材料/纹理由其所有者管理。

## 用最少候选解释参数因果

1. 固定seed、镜头、时间、材质/曝光与其他结构输入，先取当前基准。
2. 选择能回答当前未知的少量候选，改变一个直接特征参数或一组有明确联动的参数。例如扩大中段width时保留depth和两端站位；不要同时改镜头和灯。
3. 从真实顶点、实例、uniform或状态读回变化，再看目标特征与相邻结构。数值变化正确而轮廓仍不对，返回表示/设计输入。
4. 选定后在完整上下文及互补视角复查，记录最终配方与仍存在的差距，再扩展同族内容。

候选数量由未知问题与成本决定，不要求所有参数扫描。确定的结构不用重复试；参数微调不能补不存在的拓扑。超细表面在远景低于采样尺度时降低频率/对比或换表示，不能仅提高resolution。

## 工作台接线

已有[场景工作台](production-toolkit.md#天气共享场与工作台)负责相机、时间与效果快照。结构参数优先按下例用原生表单；若工程已有lil-gui，可用`gui.add(design,key,min,max,step).onChange(updateUniform)`处理轻量变化，昂贵重建用`.onFinishChange(rebuild)`，`save()/load()`只保存/恢复输入，仍需实际消费者回调。Tweakpane是同类替代，v4为ESM，按已安装API绑定值与监测。保留一套面板；诊断UI可折叠/隐藏，最终产品只保留对用户有意义的控件。

下面是不依赖GUI库的真实DOM接线：`THREE`与`scene`由项目提供，材料由调用者所有，先导入随包loft模块。例子只调一个中段全宽，端点不动。

```js
import {createSectionLoftGeometry} from './assets/geometry/section-loft.mjs';
const design={middleWidth:4.4};
const material=new THREE.MeshStandardMaterial({color:0xb8c3a6,roughness:.65});
const mesh=new THREE.Mesh();scene.add(mesh);mesh.material=material;
function rebuild(){
  const next=createSectionLoftGeometry(THREE,{stations:[
    {center:[0,0,0],width:2,depth:1.5},
    {center:[0,3,0],width:design.middleWidth,depth:1.2},
    {center:[.5,6,0],width:1.4,depth:.8}
  ]});
  const old=mesh.geometry;mesh.geometry=next;old.dispose();
}
const input=document.createElement('input');
input.type='range';input.min='2';input.max='6';input.step='.1';input.value=String(design.middleWidth);
input.setAttribute('aria-label','中段全宽（米）');
const onCommit=()=>{design.middleWidth=Number(input.value);rebuild();};
input.addEventListener('change',onCommit);document.body.append(input);rebuild();
// 项目退出：input.removeEventListener('change',onCommit); input.remove();
// scene.remove(mesh); mesh.geometry.dispose(); material.dispose();
```

滑动中的低成本uniform可用input/onChange，昂贵重建用change/onFinishChange或有界节流；保存设计值时同时保存seed/生成器版本。面板值只是输入：geom.parameters记录、标签或回调触发都不能代替真实几何/消费者变化。随包[算法诊断样件](../assets/examples/algorithm-lab/index.html)展示布局、截面和场的实际接线，适用范围见[工具目录](production-toolkit.md)。
