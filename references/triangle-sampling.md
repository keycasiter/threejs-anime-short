# 静态三角宿主的面积候选

需要覆盖已知静态三角曲面时，可用同版 `MeshSurfaceSampler` 生成候选，再走[分布与实际宿主资格链](detail-distribution.md#3-让生成器输出可核对的真实结果)。未指定权重时按几何局部面积选面；指定 attribute 时，选面概率正比于 `area × (w0.x + w1.x + w2.x)`，随后在该面内均匀取重心坐标。它不是连续顶点密度采样；顶点梯度若需要在同一面内改变密度，需有意义的细分或另行验证的密度拒绝策略。`groups`、材质可见性和 `drawRange` 不会替你筛面，先提取真正允许参与的三角形。

| 边界 | 接入规则 |
|---|---|
| 输入与失败 | 普通静态三角 Mesh；完整 triplet、合法 index、有限 position、非退化三角形。缺名权重会静默回退成面积采样，故先检查；权重 x 必须有限非负，总加权面积必须正。下例还拒绝 Float32 CDF 溢出、下溢或正面权重消失；宽动态范围仍有量化误差，应拆域/重标定，不承诺精确浮点概率 |
| 坐标与面积 | 原生输出是几何局部点/法线；点乘 `matrixWorld`，法线乘 normal matrix 并归一化。非均匀世界缩放会改变不同朝向面的相对面积，单纯变换输出不能修正概率；需要世界面积时由 logical getter 读取源坐标，以 JS number 精度完成世界变换，再把最终世界点写入私有 Float32 position，校验实际存储的三角形/CDF；在单位变换下采样，不再变换两次 |
| CPU 法线契约 | 世界面积模式只改变选面概率；同一三角形、同一重心坐标的点与 CPU 插值法线在两种模式下保持一致（允许浮点误差）。有 normal 时先插值原始系数，再用 normal matrix 变换并归一化；快照存线性变换后的未归一化系数，让原生 sampler 最后归一化。无 normal 时分别从原三角形或世界快照三角形求几何法线，不混用 shading normal。这些都不保证朝外或适合附着，仍要检查真实宿主；CPU 等价不证明 GPU shading 等价 |
| 静态范围 | 下例拒绝镜像/奇异变换及直接输入的蒙皮、morph、实例宿主；任意 shader 位移也不被求值。此类曲面要先提供明确当前姿态的 CPU 快照并与真实资格宿主保持一致。公开 API 不返回持久 face/barycentric anchor，不能据此绑定变形 |
| 失效与归属 | position/index/density 原位修改后重建分布；geometry 或捕获的 position/index/normal/color/uv/density attribute 换对象后重建 sampler，单独 `build()` 不会重新捕获引用。采样期间冻结姿态/变换，变化后先验证再重建；世界快照也随之重建。sampler 借用几何、无 `dispose()`；断开旧引用，创建方释放自己的快照，保留借入宿主 |

`normal` 存在时，CPU 目标场为 `normalize(N × Σ bi ni)`，其中 `N` 是 normal matrix、`bi` 为重心系数。`BufferGeometry.applyMatrix4` 会逐顶点归一化法线，非均匀缩放下不能直接把它的结果当作该场；下面在私有快照上改存 `N × ni` 的 Float32 系数，原生 sampler 插值后才归一化。这些系数只供 CPU 采样，不作为可直接渲染的法线资产或 GPU 结论。

世界快照先在 JS number 精度完成源点的世界变换，再首次写入 Float32。较大的局部坐标可能通过平移回到可精确存储的小世界坐标，不能在变换前提前量化。最终世界存储若仍塌缩或溢出，必须拒绝；已丢失的源精度也不会恢复。CPU 快照正确不证明原大坐标宿主的 GPU 精度正确，渲染网格仍需自己的原点或重定位设计。

## 可运行技术夹具

下面是可原样运行的 Node ESM 技术夹具，不是对象、数量或外观模板。从本 Skill 根目录运行，复制代码为 `/tmp/surface-candidates-example.mjs`；设置 `THREE_MODULE` 为已安装 **three@0.180.0** 的 `build/three.module.js` 绝对路径后执行 `node /tmp/surface-candidates-example.mjs`。未设置时从当前项目解析 `three`；addon 从同一个包定位。本例只借入既有随机、资格和坐标架 helper，自己创建的演示资源由一个 scope 释放。

```mjs
// surface-candidates-example.mjs
import {resolve} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const requireHere = createRequire(pathToFileURL(resolve('package.json')));
const threeURL = pathToFileURL(process.env.THREE_MODULE
  ? resolve(process.env.THREE_MODULE) : requireHere.resolve('three'));
export const THREE = await import(threeURL.href);
if (THREE.REVISION !== '180') throw new Error('Use three@0.180.0 and its matching addons');
const {MeshSurfaceSampler} = await import(new URL('../examples/jsm/math/MeshSurfaceSampler.js', threeURL));
const helper = name => import(pathToFileURL(resolve('assets', name)).href);
const {createRandomStreams} = await helper('runtime/random-streams.mjs');
const {createResourceScope} = await helper('runtime/resource-scope.mjs');
const {createSurfacePatchSampler, surfaceFrame} = await helper('scene/surface-anchors.mjs');

export function checkedRandom(random) {
  return () => {const r = random(); if (!Number.isFinite(r) || r < 0 || r >= 1) throw new Error('RNG must return [0,1)'); return r;};
}
export function validateSurfaceInput(mesh, densityName = null) {
  if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh) throw new Error('Ordinary static Mesh required');
  const g = mesh.geometry, p = g.getAttribute('position'), index = g.index;
  if (Object.values(g.morphAttributes).some(a => a.length)) throw new Error('Bake morph pose explicitly');
  if (!p || p.itemSize !== 3 || !p.count) throw new Error('Nonempty position required');
  for (let i=0; i<p.count; i++) if (![p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite)) throw new Error('Finite position required');
  const count = index ? index.count : p.count;
  if (count % 3 || !count || (index && index.itemSize !== 1)) throw new Error('Complete triangle triplets required');
  if (index) for (let i=0; i<count; i++) if (!Number.isInteger(index.getX(i)) || index.getX(i)<0 || index.getX(i)>=p.count) throw new Error('Invalid index');
  const weight = densityName ? g.getAttribute(densityName) : null;
  if (densityName && (!weight || weight.count !== p.count)) throw new Error('Missing/mismatched density attribute');
  if (weight) for (let i=0; i<weight.count; i++) if (!Number.isFinite(weight.getX(i)) || weight.getX(i)<0) throw new Error('Finite nonnegative weight.x required');
  const normal = g.getAttribute('normal');
  if (normal) {
    if (normal.itemSize!==3 || normal.count!==p.count) throw new Error('Matching normal required');
    for (let i=0; i<normal.count; i++) {const n=new THREE.Vector3().fromBufferAttribute(normal,i);if (!n.toArray().every(Number.isFinite) || n.lengthSq()===0) throw new Error('Finite nonzero normal required');}
  }
  mesh.updateWorldMatrix(true,false);
  if (!mesh.matrixWorld.elements.every(Number.isFinite) || !(mesh.matrixWorld.determinant()>0)) throw new Error('Finite nonsingular orientation-preserving transform required');
  const triangle = new THREE.Triangle(); let total=0, previous=0;
  for (let i=0; i<count; i+=3) {
    const ids=[0,1,2].map(k => index ? index.getX(i+k) : i+k);
    [triangle.a,triangle.b,triangle.c].forEach((v,k)=>v.fromBufferAttribute(p,ids[k]));
    const area=triangle.getArea();if (!(area>0) || !Number.isFinite(area)) throw new Error('Nondegenerate triangle required');
    const mass=area*(weight ? ids.reduce((sum,j)=>sum+weight.getX(j),0) : 1), stored=Math.fround(mass);
    total+=stored;const next=Math.fround(total);
    if (!Number.isFinite(next) || (mass>0 && (!(stored>0) || next<=previous))) throw new Error('Float32 CDF range loses a positive face; split/rescale domain');
    previous=next;
  }
  if (!(total>0)) throw new Error('Positive total weighted area required');
}

const scope = createResourceScope();
const hostGeometry = scope.own(new THREE.BufferGeometry());
// Two disjoint +Y triangles: local areas 1 and 3, no named scene semantics.
hostGeometry.setAttribute('position',new THREE.Float32BufferAttribute([
  0,0,0, 0,0,2, 1,0,0, 4,0,0, 4,0,2, 7,0,0
],3));
hostGeometry.setAttribute('density',new THREE.Float32BufferAttribute([1,1,1,3,3,3],1));
const material = scope.own(new THREE.MeshBasicMaterial());
export const host = new THREE.Mesh(hostGeometry,material);
const hostParent = new THREE.Group();hostParent.position.set(2,1,-3);hostParent.rotation.y=.3;hostParent.scale.set(1.2,1,.8);hostParent.add(host);
export const instanceRoot = new THREE.Group();instanceRoot.position.set(-1,.5,2);instanceRoot.rotation.y=-.4;instanceRoot.scale.set(1.3,.9,1.1);
const baseGeometry = scope.own(new THREE.BoxGeometry(.06,.025,.06).translate(0,.0125,0));
const bodyGeometry = scope.own(new THREE.BoxGeometry(.025,.1,.025).translate(0,.075,0));
let sampler = null, snapshot = null, worldSpace = false;
function dropCandidates() {sampler=null; if (snapshot) {snapshot.dispose();snapshot=null;}}
scope.defer(dropCandidates);
export function rebuildCandidates({worldArea=false,densityName='density',random=createRandomStreams(73).stream('fixture','surface-candidates')}={}) {
  dropCandidates();validateSurfaceInput(host,densityName);
  let input=host;worldSpace=worldArea;
  if (worldArea) {
    snapshot=host.geometry.clone();
    // Transform logical coordinates before their first Float32 store (including rebasing).
    const sourcePositions=host.geometry.getAttribute('position');
    const positions=new THREE.Float32BufferAttribute(new Float32Array(sourcePositions.count*3),3), point=new THREE.Vector3();
    for (let i=0; i<sourcePositions.count; i++) {
      point.fromBufferAttribute(sourcePositions,i).applyMatrix4(host.matrixWorld);
      positions.setXYZ(i,point.x,point.y,point.z);
    }
    snapshot.setAttribute('position',positions); // already world-space: do not transform twice
    const sourceNormals=host.geometry.getAttribute('normal');
    if (sourceNormals) {
      // Preserve normalize(N * sum(b_i*n_i)); do NOT normalize each coefficient.
      const normalMatrix=new THREE.Matrix3().getNormalMatrix(host.matrixWorld);
      const coefficients=new Float32Array(sourceNormals.count*3), n=new THREE.Vector3();
      for (let i=0; i<sourceNormals.count; i++) {
        n.fromBufferAttribute(sourceNormals,i).applyMatrix3(normalMatrix);
        n.toArray(coefficients,i*3);
      }
      snapshot.setAttribute('normal',new THREE.Float32BufferAttribute(coefficients,3));
    } // Without normal attributes the native sampler computes world geometric normals.
    input=new THREE.Mesh(snapshot,host.material); // private world-space geometry, identity matrix
    try {validateSurfaceInput(input,densityName);} catch(error) {dropCandidates();throw error;}
    if (snapshot.boundingBox) snapshot.computeBoundingBox();
    if (snapshot.boundingSphere) snapshot.computeBoundingSphere();
  }
  sampler=new MeshSurfaceSampler(input).setRandomGenerator(checkedRandom(random));
  if (densityName) sampler.setWeightAttribute(densityName); // null explicitly selects area only
  sampler.build(); // New object also rebinds replaced attributes.
}
export const getSamplingGeometry = () => snapshot ?? host.geometry;
export function candidateWorld() {
  if (!sampler) throw new Error('Build candidates first');
  const point=new THREE.Vector3(),normal=new THREE.Vector3();sampler.sample(point,normal);
  if (!worldSpace) {
    host.updateWorldMatrix(true,false);point.applyMatrix4(host.matrixWorld);
    normal.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(host.matrixWorld));
  }
  if (!point.toArray().every(Number.isFinite) || !normal.toArray().every(Number.isFinite) || normal.lengthSq()===0) throw new Error('Invalid sampled point/normal');
  return {point,normal}; // candidates, never an attachment pass
}
export function collectPlacements() {
  const qualify=createSurfacePatchSampler(THREE,host), accepted=[];
  const stats={candidates:0,accepted:0,patchChecks:0,rejected:{}};
  const reject=reason=>{stats.rejected[reason]=(stats.rejected[reason]??0)+1;};
  host.updateWorldMatrix(true,false);const inverseHost=host.matrixWorld.clone().invert();
  for (let candidateId=0; candidateId<48; candidateId++) {
    stats.candidates++;const c=candidateWorld(), local=c.point.clone().applyMatrix4(inverseHost);
    // Replace these fixture predicates with actual allowed polygons/holes and clearances.
    if (local.x<.08) {reject('outside-allowed');continue;}
    if (local.x>4.8 && local.x<5.2) {reject('clearance');continue;}
    if (accepted.some(r=>r.anchorWorld.distanceTo(c.point)<.08)) {reject('spacing');continue;}
    stats.patchChecks++;
    const patch=qualify({origin:c.point,normal:c.normal,footprint:[[-.03,-.03],[.03,-.03],[.03,.03],[-.03,.03],[0,0]],above:.15,below:.15,maxOffset:.001,maxNormalAngleDeg:5});
    if (patch.status!=='ACCEPT') {reject(patch.reason);continue;}
    accepted.push({id:`fixture:${candidateId}`,candidateId,zoneId:'fixture-zone',variantId:'fixture-parts',anchorWorld:c.point.clone(),normalWorld:c.normal.clone(),scale:1,frameWorld:surfaceFrame(THREE,c)});
  }
  stats.accepted=accepted.length;return {accepted,stats}; // bounded attempts; no silent target count
}
export function emitParts(records) {
  const parts=[baseGeometry,bodyGeometry].map(g=>new THREE.InstancedMesh(g,material,records.length));
  for (const part of parts) {
    instanceRoot.add(part);part.updateWorldMatrix(true,false);
    const inverse=part.matrixWorld.clone().invert();
    records.forEach((record,i)=>part.setMatrixAt(i,new THREE.Matrix4().multiplyMatrices(inverse,record.frameWorld)));
    part.instanceMatrix.needsUpdate=true;part.computeBoundingBox();part.computeBoundingSphere();
    scope.defer(()=>{part.removeFromParent();part.dispose();}); // buffers owned here; shared geometry/material owned above
  }
  return parts;
}
export const releaseExample = () => {scope.dispose();host.removeFromParent();};
rebuildCandidates();
export const result = collectPlacements();
export const parts = emitParts(result.accepted);
console.log(JSON.stringify(result.stats));
// App use: keep resources while displayed; standalone CLI needs only CPU evidence.
if (import.meta.url.startsWith('file:') && process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) releaseExample();
```

这里的允许区/净空谓词、离散足迹与次数仅用于可计算夹具；实际制作仍从当前布局、宿主 ID 和真实基部提取它们。接受记录只生成一次，两个部件使用同一条世界架，父级逆矩阵直接转实例局部，不做可能丢失 shear 的 TRS 分解。调整位置、密度或快照后必须重跑全部资格；离散足迹通过不等于连续支承，也不等于 GPU 已绘制或画质改善。应用结束时调用 `releaseExample()`；生产接入时只释放自己创建的资源，借入宿主不注册到本 scope。

原理与原生接口来源：[MeshSurfaceSampler](https://threejs.org/docs/#examples/en/math/MeshSurfaceSampler)；[已审计的提供方源码](https://www.webgl3d.cn/threejs/examples/jsm/math/MeshSurfaceSampler.js)。制作时本地规则和接线已完整给出，无需重新阅读网站。
