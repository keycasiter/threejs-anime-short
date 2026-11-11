# Shader与有界效果代码

在标准材质/现有工具不能表达目标时使用。具体材料通道与尺度读[表面方法](surface-detail.md)，深度/透明/多遍契约读[渲染契约](render-contracts.md)。本页不是水面/布料/粒子的统一美术模板。

## 实现数据链

先写出CPU输入的单位、有效范围与时间源，再实现顶点形变、法线和必要的深度/阴影表示，最后实现片元响应。每项属性、uniform、纹理都要有真实消费者。变形范围要进入包围体；接触/拾取需要等价求值。初版先用UV、法线或单个标量显示输入，再恢复完整着色。

## 表面位移与受光法线

岩石等表面可用三维场构造几何，再通过高度场的切向梯度扰动照明法线；以下是机制示意，不是所有材质的默认方案：

```glsl
float h = heightField(P);
vec3 g = vec3(heightField(P+vec3(e,0,0))-h,
              heightField(P+vec3(0,e,0))-h,
              heightField(P+vec3(0,0,e))-h) / e;
g -= N * dot(g, N);
vec3 shadedNormal = normalize(N - strength*g);
```

它是一种可迁移方法，不是所有材料的默认shader。高度场的方向、频率、强度要对应材料形成方式，微细层随像素尺度退场。金属更依赖有设计的折面、硬反射带、边缘与表面分区；皮肤也不能套用岩石凿刻。

几何法线、光照法线和描线法线可以有不同职责。阴影的接收点偏移与斜率bias通常使用几何法线；直接用强凹凸法线偏移可能将采样点推入真实表面，造成条纹或自阴影错误。把高频凹凸直接写入用于墨线的缓冲，可能将整面材质变成碎黑线。先确认哪种尺度应影响轮廓、受光与墨线。

## shader数值稳定性：按真实输入范围设计

写公式前估算单位与极值：世界尺度、频率×深度、最远视距、时间跨度和零长度向量。检查除零、负底数非整数`pow`、负数`sqrt`、`normalize(0)`与指数溢出。按数学定义处理退化和饱和，不把任意clamp当通用修复；`highp`和编译成功都不保证所有后端的中间结果有限。

例如正域大输入的双曲函数可用负指数形式避免构造很大的正指数；小输入另检查相消误差，负域另定义对称扩展。选择稳定式时验证原式的单位、定义域和可接受误差。不要将一个场景的限制值复制成所有shader的阈值。

出现无报错的黑面/花屏时，先固定机位、时间、几何和灯光，逐层输出参数/中间值；必要时用目标后端的1像素浮点render target读回极值，并用`isnan/isinf`标志交叉检查。记录实际backend和precision；CPU数组有限或JS计算正确不能代替GPU执行。修复后回到原完整材质确认画面，保留原问题帧。离线完成等待与颜色累积见[渲染选择](rendering-choices.md)。

## 粒子/碎屑要有起点、速度和寿命

少量独立物体用Mesh，数量较大且外形简单的粒子用`Points`或`InstancedMesh`。运动状态从绝对时间计算：先用固定索引生成起点/速度/相位，再按`t`算粒子年龄、位置和透明度。下面示例用确定性初值和CPU更新顶点，适合数百到数千个轻量点；更多粒子再考虑GPU模拟。

```js
const count = 180, life = 2.4;
const position = new Float32Array(count * 3);
const opacity = new Float32Array(count);
const origin = [], velocity = [], phase = [];
for (let i = 0; i < count; i++) {
  const s = Math.sin(i * 127.1 + 9.2) * 43758.5453;
  const fract = s - Math.floor(s);
  const angle = i * 2.399963;
  origin.push(new THREE.Vector3(0, 0, 0)); // 可替换为事件锚点
  velocity.push(new THREE.Vector3(Math.cos(angle) * (.2 + fract), .6 + fract * 1.5, Math.sin(angle) * (.2 + fract)));
  phase.push(fract * life);
}
const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
particleGeometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacity, 1).setUsage(THREE.DynamicDrawUsage));
const particleMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  vertexShader: `attribute float aOpacity; varying float vOpacity;
    void main(){ vOpacity=aOpacity; gl_PointSize=3.0;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying float vOpacity;
    void main(){ vec2 p=gl_PointCoord-0.5; float edge=1.0-smoothstep(0.16,0.25,length(p));
      gl_FragColor=vec4(0.72,0.86,1.0,edge*vOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment> }`,
});
const particles = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particles);

function updateParticles(t, eventOrigin) {
  for (let i = 0; i < count; i++) {
    const age = (t + phase[i]) % life;
    const u = age / life;
    const p = origin[i].copy(eventOrigin);
    position[i * 3] = p.x + velocity[i].x * age;
    position[i * 3 + 1] = p.y + velocity[i].y * age - 0.5 * 0.7 * age * age;
    position[i * 3 + 2] = p.z + velocity[i].z * age;
    opacity[i] = Math.sin(Math.PI * u) * (1 - u * .25);
  }
  particleGeometry.attributes.position.needsUpdate = true;
  particleGeometry.attributes.aOpacity.needsUpdate = true;
  particleGeometry.computeBoundingSphere(); // CPU位置改变后刷新实际剔除范围。
}
```

本例逐次重算包围球，适合所示小规模CPU点集；大规模效果可推导覆盖整个运动/发射器包络的保守边界，并在包络变化时更新，不能沿用旧发射点的包围体。`eventOrigin`与写入position均处于粒子对象局部坐标，世界锚点应先转换；本例粒子根保持恒等变换。

每次调用都覆盖所有点，故正向播放、倒序抽帧和随机seek得到同一状态。示例用循环相位让粒子持续出现；单次爆发时还要增加发射时间范围/关闭循环，超过寿命后透明度归零。若粒子要碰撞、受风或改变方向，补充可重建的时间步进，不能只用上一帧位置累加。
