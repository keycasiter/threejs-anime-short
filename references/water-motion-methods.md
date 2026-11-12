# 波面、约束与运行的本地实现方法

需要位移水面、浮物共源、柔性约束或群体行为时按节读取。已有时间/资源规则见[运行与规模](motion-and-scale.md)，渲染链见[效果配方](effect-recipes.md)。本页公式与原创JS片段可本地阅读/执行；不以教程默认参数代替美术设计。

导航：[解析波面](#多波面与浮物共源) · [频谱与池水](#频谱海浪与局部池水) · [约束绳布](#距离约束与绳布更新) · [群体与IK](#转向群体与关节链)

## 多波面与浮物共源

每波输入`direction=[dx,dz]`、`amplitude`米、`wavelength`米、`q`无量纲水平位移倍率、`omega`弧度/秒、`phase`弧度。各波都用同一个未位移XZ求值，总位置只加一次基点。q=0仍有竖向波；若用深水关系`omega=sqrt(g*k)`，明确米/秒和深水假设，小池/浅岸可另给设计周期。

下面返回总位移位置、两偏导与向上法线，可用于CPU几何、浮物锚点或核对shader等价实现。为保持水平映射不折叠，示例采用保守的`sum(abs(q*A*k))<1`条件；这不是自动获得漂亮波形的参数预设。

```js
function sampleWaveSurface(x,z,t,waves){
  if(![x,z,t].every(Number.isFinite))throw Error('finite position/time required');
  const position=[x,0,z],dx=[1,0,0],dz=[0,0,1];let steepness=0;
  for(const w of waves){
    if(!Array.isArray(w.direction)||w.direction.length!==2||!w.direction.every(Number.isFinite))throw Error('finite xz direction required');
    const length=Math.hypot(...w.direction),A=w.amplitude,k=2*Math.PI/w.wavelength,Q=w.q??0;
    if(!(length>0&&Number.isFinite(A)&&A>=0&&Number.isFinite(w.wavelength)&&w.wavelength>0&&Number.isFinite(Q)))throw Error('invalid wave');
    const ux=w.direction[0]/length,uz=w.direction[1]/length,omega=w.omega??Math.sqrt(9.81*k),phase=w.phase??0;
    if(![omega,phase].every(Number.isFinite))throw Error('invalid phase/frequency');
    steepness+=Math.abs(Q*A*k);if(steepness>=1)throw Error('horizontal wave mapping may fold');
    const theta=k*(ux*x+uz*z)-omega*t+phase,s=Math.sin(theta),c=Math.cos(theta),ak=A*k,qak=Q*ak;
    position[0]+=Q*A*ux*c;position[1]+=A*s;position[2]+=Q*A*uz*c;
    dx[0]-=qak*ux*ux*s;dx[1]+=ak*ux*c;dx[2]-=qak*ux*uz*s;
    dz[0]-=qak*ux*uz*s;dz[1]+=ak*uz*c;dz[2]-=qak*uz*uz*s;
  }
  const normal=[dz[1]*dx[2]-dz[2]*dx[1],dz[2]*dx[0]-dz[0]*dx[2],dz[0]*dx[1]-dz[1]*dx[0]],l=Math.hypot(...normal);
  if(!(l>0))throw Error('degenerate wave normal');
  return {position,dx,dz,normal:normal.map(n=>n===0?0:n/l)};
}
```

### 接入Three和浮物

水域网格保留原始XZ参数坐标。CPU路径每帧从原始坐标调用上例，把position写入position属性、normal写入normal属性，置needsUpdate并维护包围体；不在上帧位移后的顶点上继续加波。GPU路径把相同波组、时间与原始位置传入顶点shader，片元使用变形后法线，并匹配所需阴影/反射和CPU锚点。

浮物若沿**拉格朗日基点**随波流动，可直接读取固定基点的position和normal，世界位置加水位，姿态从法线与设计前向共同建架。若物体固定世界XZ，必须反求水平映射：以目标XZ初始化p，迭代用2×2水平Jacobian（上例dx/dz的XZ分量）解`J*delta=surfaceXZ(p)-targetXZ`，令`p-=delta`；残差达容差时再取高度/法线。设置迭代预算，Jacobian退化或不收敛时报告失败；不能把参数坐标高度误当固定世界坐标水位。大船/筏在多个支承点采样，单点normal不表示整块接触或浮力动力学。

### 法线与材光的接力

所有波的总偏导先累加再叉积；不能把逐波单位normal相加当总位移的精确法线。若振幅乘岸线mask，导数同时包含`A*gradient(mask)`项。世界/观察空间变换与法线逆转置按实际材质消费者处理。

几何浪、微法线、反射、折射/水底、深度吸收和泡沫各有独立责任。平面反射只提供所反射场景的RT，波面采样还需正确投影坐标/扰动及遮挡策略。用真实水深调颜色/吸收与浅岸反馈；波峰泡沫可由曲率、压缩或设计阈值驱动，岸边泡沫由水深/接触驱动；白条纹不能代替它们。透明与显示输出沿用[渲染选择](rendering-choices.md)。

## 频谱海浪与局部池水

### FFT海浪的数据链

适合需要宽频风浪且预算允许多遍计算的场景。输入物理patch边长L、2幂FFT分辨率N、风向/风速、波谱强度/截断、水平choppiness与固定随机源。显示网格分辨率与模拟纹理N是两个量。

| 步骤 | 具体计算/状态 | 实际输出 |
|---|---|---|
| 初始波谱 | 频率格`k=2π*(i-N/2,j-N/2)/L`，由非负能量谱P(k)与固定高斯随机数建立复数h0；k=0单独置0 | 频域初态复数纹理/数组 |
| 时间求值 | `h(k,t)=h0(k)*exp(i*omega*t)+conj(h0(-k))*exp(-i*omega*t)`，保持共轭对称以得到实值高度 | 当前频域高度；深水omega取sqrt(g*abs(k))时说明假设 |
| 水平位移/导数 | 频域乘`±i*kComponent/abs(k)`得到水平位移，再由choppiness缩放；符号与FFT约定统一 | XYZ位移、可选导数谱 |
| IFFT | 行列各做一次复数IFFT；可用bit-reversal+蝶形，逆变换使用正指数并总归一N²，或实现无bit-reversal的Stockham | 时域位移纹理；中心频率布局需对应移位/棋盘符号 |
| 法线/网格 | 从总XYZ位移的偏导或相邻位移叉积构造法线，显示网格读取位移/normal | 真正波浪轮廓和一致受光 |
| 扩展表现 | 由水平Jacobian压缩等生成波峰反馈，多尺度patch降低周期重复 | 材质/泡沫/远景采样；海岸交互仍另外实现 |

每次蝶形从独立读目标取复数对a/b与旋转因子，写`a+w*b`、`a-w*b`；stage跨度每次翻倍，行/列阶段间交换读写纹理，不能同一RT边读边写。先对单频谱验证预期正弦/幅度、共轭和归一，再接完整海浪；状态格式/浮点RT/过滤按设备能力确认。FFT链本地可按这些步骤实现，但Skill未捆绑完整GPU海洋求解器；不需要该频带时沿用解析波。

先采用明确的离散系数约定，避免只有“P(k)”符号却不知道振幅：令S(k)为每个格点初始复系数的期望模平方，可用设计频带表给非负权重；取两次独立标准高斯`xiR/xiI`，`h0(k)=sqrt(S(k)/2)*(xiR+i*xiI)`。标准高斯可由固定随机源Box–Muller生成：`r=sqrt(-2*log(max(u1,epsilon)))`、`angle=2π*u2`，输出`r*cos(angle)`/`r*sin(angle)`。连续谱密度需先乘频率格面积`(2π/L)²`转成每格能量；采用归一IFFT时，系数与时域目标振幅还需按该约定配套N²尺度。先用唯一共轭频率对校准：若想得到振幅a的余弦，送给归一二维IFFT的两系数各为`a*N²/2`。改变N/L后重做这一检查，不能假设相同谱常数仍表示相同米制浪高。方向风谱的具体型号是额外设计选择，未选择时先用可控频带测试，不把任意高斯频带称为物理海洋谱。

### 局部池水的历史更新

可选一个明确的二维线性波动离散：网格间距dx/dz，传播速度c（世界长度/秒），保存当前高度H与速度V以及独立输出缓冲。`lap=(Hleft-2H+Hright)/dx²+(Hdown-2H+Hup)/dz²`；先`Vnext=V+dt*c²*lap`，再`Hnext=H+dt*Vnext`，最后交换缓冲。对这套无阻尼标准离散，稳定条件为`c*dt*sqrt(1/dx²+1/dz²)<=1`，设计时留数值余量；方格为`c*dt/dx<=1/sqrt(2)`。阻尼可给Vnext乘`exp(-dampingPerSecond*dt)`，它不能代替满足稳定条件。

边界采用固定高程/零法向梯度或专门吸收层，邻域读取规则始终一致，不能一侧越界读零、另一侧偶然环绕。扰动事件明确是位移还是速度增量，保存时间/位置/强度，从初态固定步重放。法线从当前高度梯度求，深度/折射/焦散的渲染另接。这条是历史模拟，不能只改time重现任意过去状态。

## 距离约束与绳布更新

每粒子保存位置、速度、逆质量，固定点逆质量0；每约束保存端点索引、静长、compliance与当前子步的lambda。初始网格/绳由代码生成，约束边从自身拓扑建立。

### 一次完整固定步

1. 以固定dt分成明确子步h；保存子步起始位置，按重力/外力更新速度并预测位置，固定点保持锚点。
2. 每子步开始把各约束lambda设0；对子步内的多次投影迭代保留lambda。距离、弯曲/剪切和接触分别求解，不把单一距离约束称为完整布料。
3. 按下例投影距离；其他约束各有自己的C与梯度。检查接触/固定锚点，按选定求解顺序处理。
4. 从投影后位置差除h重建速度，必要时应用物理/美术阻尼；最后更新真实绳/布网格与法线、边界和相关碰撞数据。

下例是可直接本地执行的距离约束投影，输入a/b是会被修改的xyz数组，wa/wb为非负逆质量；dt是当前**子步**。它不含重力、外层积分、碰撞、自碰撞或弯曲，调用者按上面的完整步组织。

```js
function projectDistance({a,b,wa,wb,rest,dt,compliance=0,lambda=0}){
  if(![wa,wb,rest,dt,compliance,lambda,...a,...b].every(Number.isFinite)||wa<0||wb<0||rest<0||dt<=0||compliance<0)throw Error('invalid distance constraint');
  const d=b.map((x,i)=>x-a[i]),length=Math.hypot(...d),weight=wa+wb;
  if(length<1e-12||weight===0)return {lambda,solved:false};
  const alpha=compliance/(dt*dt),delta=(-(length-rest)-alpha*lambda)/(weight+alpha);
  for(let i=0;i<3;i++){const n=d[i]/length;a[i]-=wa*n*delta;b[i]+=wb*n*delta;}
  return {lambda:lambda+delta,solved:true};
}
```

compliance=0是刚性距离约束，数值增大更软；质量/长度/时间约定共同决定其有效量级。重合但静长非0时方向未定义，应修初态或提供已知参考方向；不能normalize零向量。子步变多通常改善稳定性，但不应被当成改变材料软硬的唯一控制。重置包含位置、速度、约束lambda、外力/交互事件及相关历史；仅重置顶点会留下错误速度。

## 转向、群体与关节链

### 转向与群体

对目标或流场求期望速度vDesired，再以`acceleration=clampLength((vDesired-v)/responseTime,maxAcceleration)`得到秒制转向；积分`v+=a*dt`并限速，`p+=v*dt`。这里responseTime是秒，maxAcceleration是米/秒²；不要把p5每帧的maxforce直接当Newton。

邻域内分别计算分离（朝远离近邻方向）、对齐（平均速度）、聚合（平均位置作为追寻目标），加各自权重后再次限幅。障碍/路线/生境约束独立处理，邻域用空间格而非全员两两检查。行为状态进入真实Object3D或实例矩阵，不只更新一个调试向量。

### FABRIK关节链

保存关节点位置p0..pn和固定段长L0..Ln-1。目标距离大于总长时，链沿根到目标方向展开；可达时先将末端放目标，反向逐点按段长推前点，再将根放回固定位置，正向逐点按段长推后点。重复至末端误差小于容差或迭代预算耗尽。零距离段用保存的合法方向；角限/弯曲平面在每次重定位时施加，并再次核段长/末端误差。

生成的是骨架姿态；实际网格需由枢轴/蒙皮或沿程截面消费，附件取最终架。闭环、多分支与碰撞需更完整约束；可达解也不保证重心、支撑与表演自然。解析运动足以表达的机械，不必引入历史物理。
