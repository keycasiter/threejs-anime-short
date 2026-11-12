# 条件空间运算：先定坐标，再选度量

需要按方向移动、判断前后/扇区、核对静态三角面积、测路径偏离或组合旋转时读本页。以下是可复制到项目的局部方法示例，不是随包注册的新工具；不需要模型或图片。

- [选择输入与边界](#选择输入与边界)
- [可运行ESM](#可运行esm)

## 选择输入与边界

| 问题 | 输入与处理 | 结果含义 |
|---|---|---|
| 沿方向移动 | `normalize()`会修改接收者，保留输入用`clone()`；零方向拒绝。`position.add(delta)`的delta属于父空间；`translateOnAxis(unitAxis,d)`先用对象自身quaternion转轴，再加到position | 后者沿自身局部轴；有缩放父级时，d不能直接当实际世界距离。世界位移先经父级逆线性变换，再加position |
| 前/后与扇区 | 双方位置和前向必须同属世界空间；从实际`matrixWorld`变换作者约定的局部前轴（示例−Z）。非均匀/剪切父级下，不把自身quaternion或分解出的旋转当完整世界方向 | dot正/负只分前后半空间；边界与同点单列。XZ扇区忽略高度，半径与角度同时满足；不证明遮挡、视锥内或屏幕可见 |
| 面积 | 静态Float32基础position，完整Uint8/16/32索引或连续三顶点；两条局部边应用实际世界矩阵的线性3×3（保留缩放/剪切，不归一化）后叉积 | 平方世界单位；非均匀缩放、剪切、反射均按实际边算；不先加世界平移，避免大坐标抵消边长。全三角流面积不等于drawRange、材质裁剪或可见像素面积，也不证明封闭实体 |
| 点到路径 | `t=(AP·AB)/(AB·AB)`；无限直线保留t，有限段clamp到[0,1]；距离取残差`AP−t·AB`的长度 | 直线零AB拒绝；零长线段退化为点A。输入必须同空间同单位 |
| 旋转组合 | `q.multiply(r)`写入`q*r`，`q.premultiply(r)`写入`r*q`；均修改接收者 | 对向量右侧先作用；自身姿态右乘是局部追加，左乘是父空间追加。只有父架与世界一致时，左乘才可称世界轴旋转 |

纯旋转父链可写`qWorld = qParent.clone().multiply(qLocal)`：向量先受qLocal、再受qParent作用。世界轴增量应左乘qWorld，再用父旋转的逆变回qLocal；存在非均匀缩放或剪切时，这套四元数关系不能代替实际matrixWorld轴与仿射变换。

已有[材料分区](../assets/materials/material-regions.mjs)在真实分区消费者中返回局部基础面积，应继续复用。它要求非空regions，成功后会`clearGroups/addGroup`替换geometry.groups，不能借一次虚构分区调用把它当纯测量；本页面积例仅只读测量。蒙皮、morph、实例、多重实例、位移贴图、Shader/NodeMaterial与自定义顶点改形需要另取对应姿态的实际顶点，本例直接拒绝可识别的这些输入，包括BatchedMesh、InstancedBufferGeometry及按实例推进的position；普通Float32交错position可用。未声明的运行时改形也不属于静态CPU测量域。

## 可运行ESM

将下面完整代码保存为`spatial-example.mjs`。已有项目安装并锁定`three@0.180.0`后运行`node spatial-example.mjs`；无裸包解析时，可指定同版本地模块URL：`THREE_MODULE=file:///absolute/path/three/build/three.module.js node spatial-example.mjs`。显式路径优先，不自动改用其他版本；完整build依赖与LICENSE随所选Three包保留。示例仅需Node，不创建WebGL上下文。

数值约定：输入与中间结果须有限；方向长度/平方长度须可表示且非零。父变换须仿射且可可靠求逆；移动对象由position/quaternion/scale管理，祖先可用手写剪切矩阵，但世界矩阵由Three更新。判定的cos容差为`1e-12`；扇区半径闭边界容差为`1e-10`世界单位，同点按XZ重合处理并纳入扇区（包括半径0）。非法heading即使同点也拒绝。全角允许[0,2π]；0角仅含前射线的数值容差，2π含整个圆盘。

```js
const T = await import(process.env.THREE_MODULE || 'three');
if (T.REVISION !== '180') throw Error('Use the complete three@0.180.0 package');
const COS_EPS = 1e-12, DIST_EPS = 1e-10;
function vector(v) {
  if (!v?.isVector3 || !v.toArray().every(Number.isFinite)) throw Error('finite Vector3 required');
  return v;
}
function unit(v) {
  const n = vector(v).length();
  if (!Number.isFinite(n) || n === 0) throw Error('nonzero representable direction required');
  return vector(v.clone().normalize()); // normalize mutates only this clone.
}
function affine(m) {
  const e = m?.elements;
  if (!m?.isMatrix4 || !e.every(Number.isFinite) || e[3] || e[7] || e[11] || e[15] !== 1)
    throw Error('finite affine Matrix4 required');
  return m;
}
function worldMatrix(object) {
  if (!object?.isObject3D) throw Error('Object3D required');
  for (let p = object; p; p = p.parent)
    if (!p.matrixWorldAutoUpdate) throw Error('automatic world-matrix updates required');
  object.updateWorldMatrix(true, false);
  return affine(object.matrixWorld);
}
function moveWorldDelta(object, delta) {
  vector(delta);
  if (!object?.matrixAutoUpdate) throw Error('TRS-managed moving object required');
  worldMatrix(object);
  let parentDelta = delta.clone();
  if (object.parent) {
    const m = worldMatrix(object.parent), e = m.elements;
    const lengths = [0, 4, 8].map(i => Math.hypot(e[i], e[i+1], e[i+2]));
    const relativeDet = m.determinant() / (lengths[0]*lengths[1]*lengths[2]);
    if (!Number.isFinite(relativeDet) || Math.abs(relativeDet) < 1e-12)
      throw Error('invertible, well-conditioned parent required');
    const inverse = m.clone().invert();
    if (!inverse.elements.every(Number.isFinite)) throw Error('parent inverse exceeds numeric range');
    parentDelta.applyMatrix3(new T.Matrix3().setFromMatrix4(inverse)); // vectors: no translation.
  }
  const next = vector(object.position.clone().add(vector(parentDelta)));
  object.position.copy(next);
  object.updateWorldMatrix(false, false);
}
function worldPose(object, localForward = new T.Vector3(0, 0, -1)) {
  const m = worldMatrix(object);
  return {
    origin: vector(new T.Vector3().setFromMatrixPosition(m)),
    forward: unit(unit(localForward).applyMatrix3(new T.Matrix3().setFromMatrix4(m)))
  };
}
function frontBack(origin, forward, target) {
  const f = unit(forward), d = vector(vector(target).clone().sub(vector(origin)));
  if (d.equals(new T.Vector3())) return 'coincident';
  const cosine = f.dot(unit(d));
  return cosine > COS_EPS ? 'front' : cosine < -COS_EPS ? 'back' : 'boundary';
}
function inXZSector(origin, heading, target, radius, fullAngle) {
  vector(origin); vector(heading); vector(target);
  if (!Number.isFinite(radius) || radius < 0 || !Number.isFinite(fullAngle) || fullAngle < 0 || fullAngle > 2*Math.PI)
    throw Error('finite radius >= 0 and full angle in [0, 2π] required');
  const f = unit(new T.Vector3(heading.x, 0, heading.z));
  const d = vector(new T.Vector3(target.x-origin.x, 0, target.z-origin.z));
  const length = d.length();
  if (!Number.isFinite(length)) throw Error('distance exceeds numeric range');
  if (length > radius + DIST_EPS) return false;
  if (length === 0) {
    if (!d.equals(new T.Vector3())) throw Error('projected distance underflow');
    return true;
  }
  return f.dot(unit(d)) + COS_EPS >= Math.cos(fullAngle/2);
}
function pointDistance(p, a, b, finiteSegment) {
  if (typeof finiteSegment !== 'boolean') throw Error('choose line(false) or segment(true)');
  vector(p); vector(a); vector(b);
  const ab = vector(b.clone().sub(a)), ap = vector(p.clone().sub(a)), length2 = ab.lengthSq();
  if (!Number.isFinite(length2)) throw Error('AB exceeds numeric range');
  if (length2 === 0) {
    if (!ab.equals(new T.Vector3())) throw Error('AB squared length underflow');
    if (!finiteSegment) throw Error('zero AB does not define an infinite line');
    const distance = ap.length();
    if (!Number.isFinite(distance)) throw Error('distance exceeds numeric range');
    return distance;
  }
  let t = ap.dot(ab)/length2;
  if (!Number.isFinite(t)) throw Error('projection exceeds numeric range');
  if (finiteSegment) t = T.MathUtils.clamp(t, 0, 1);
  const distance = vector(ap.addScaledVector(ab, -t)).length();
  if (!Number.isFinite(distance)) throw Error('distance exceeds numeric range');
  return distance;
}
function staticWorldArea(mesh) {
  if (!mesh?.isMesh || mesh.type !== 'Mesh' || mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.isBatchedMesh)
    throw Error('ordinary static Mesh required');
  const g = mesh.geometry, p = g?.getAttribute('position'), index = g?.getIndex();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (!g?.isBufferGeometry || g.isInstancedBufferGeometry || Object.values(g.morphAttributes).some(a => a.length) ||
      materials.length === 0 || materials.some(m => !m?.isMaterial || m.isShaderMaterial || m.isNodeMaterial ||
        m.displacementMap || m.onBeforeCompile !== T.Material.prototype.onBeforeCompile))
    throw Error('static base geometry and unmodified built-in materials required');
  if (!p || p.isInstancedBufferAttribute || p.data?.isInstancedInterleavedBuffer || p.itemSize !== 3 || p.normalized || !((p.array || p.data?.array) instanceof Float32Array) ||
      !Number.isSafeInteger(p.count) || p.count === 0) throw Error('nonempty Float32 xyz positions required');
  const count = index ? index.count : p.count;
  if (!Number.isSafeInteger(count) || count === 0 || count%3 ||
      (index && (index.itemSize !== 1 || index.normalized ||
        !(index.array instanceof Uint8Array || index.array instanceof Uint16Array || index.array instanceof Uint32Array))))
    throw Error('complete indexed/nonindexed triangle stream required');
  if (g.drawRange.start !== 0 || !(g.drawRange.count === Infinity || g.drawRange.count === count))
    throw Error('full drawRange required; this is not rendered-area measurement');
  const linear = new T.Matrix3().setFromMatrix4(worldMatrix(mesh));
  for (let i = 0; i < p.count; i++) vector(new T.Vector3().fromBufferAttribute(p, i));
  if (index) for (let i = 0; i < count; i++) {
    const n = index.getX(i);
    if (!Number.isSafeInteger(n) || n < 0 || n >= p.count) throw Error('invalid index');
  }
  let total = 0;
  for (let i = 0; i < count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => vector(new T.Vector3()
      .fromBufferAttribute(p, index ? index.getX(i+k) : i+k)));
    const ab = vector(b.sub(a).applyMatrix3(linear)), ac = vector(c.sub(a).applyMatrix3(linear));
    const cross = vector(ab.cross(ac));
    total += .5 * Math.hypot(cross.x, cross.y, cross.z);
    if (!Number.isFinite(total)) throw Error('area exceeds numeric range');
  }
  return total; // Never clears groups or writes attributes/index/drawRange.
}
// Noncommuting rotations: on a vector qX*qY applies qY first, then qX.
const qX = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI/2);
const qY = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI/2);
const v = new T.Vector3(0, 0, 1);
const right = v.clone().applyQuaternion(qX.clone().multiply(qY)); // ≈ (1,0,0)
const left = v.clone().applyQuaternion(qX.clone().premultiply(qY)); // ≈ (0,-1,0)
const parent = new T.Group(), actor = new T.Object3D();
parent.scale.set(2, 3, 4); parent.add(actor);
moveWorldDelta(actor, new T.Vector3(1, 0, 0)); // actual world displacement (1,0,0).
const pose = worldPose(actor);
const geometry = new T.BufferGeometry().setAttribute('position',
  new T.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3));
const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
parent.add(mesh);
console.log({revision:T.REVISION, worldX:actor.getWorldPosition(new T.Vector3()).x,
  relation:frontBack(pose.origin, pose.forward, new T.Vector3(1,0,-2)),
  sector:inXZSector(pose.origin, pose.forward, new T.Vector3(1,5,-2), 3, Math.PI/2),
  line:pointDistance(new T.Vector3(2,1,0), new T.Vector3(), new T.Vector3(1,0,0), false),
  segment:pointDistance(new T.Vector3(2,1,0), new T.Vector3(), new T.Vector3(1,0,0), true),
  worldArea:staticWorldArea(mesh), right:right.toArray(), left:left.toArray()});
geometry.dispose(); mesh.material.dispose();
```

示例的已知值为：世界位移X=1；前方、扇区命中；无限直线距离1、有限段距离√2；世界面积3；两种旋转分别约(1,0,0)与(0,−1,0)。实际场景先把目标位置通过`getWorldPosition`取到同一架，再调用分类；模型若以+Z或其他轴为前，传实际作者轴。

CPU检查应覆盖旋转/缩放/剪切父级下的位移与真实轴、斜向扇区的半径和角边界、退化AB、索引/非索引面积一致、非均匀与反射面积以及测量前后groups/attributes/index不变。WebGL可见性、变形姿态、GPU消费、视觉质量和性能需要各自的运行证据；这些数学结果不能替代它们。
