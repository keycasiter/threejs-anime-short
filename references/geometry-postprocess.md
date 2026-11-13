# 按需几何后处理

保留程序生成器的解析法线、UV 和语义接缝。只有明确需要属性等价焊接、角度法线或与烘焙器一致的 Mikk 切线时才选对应操作；三个操作互不默认串联。现有 `computeTangents()` 路径仍适用于自己的切线约定。

| 操作 | 对象与数据语义 | 使用边界 |
|---|---|---|
| `mergeVertices` | 返回新 indexed clone；按所有普通属性的量化桶合并，不是欧氏距离测试；morph 不参与哈希，只复制首个值 | 同一 tolerance 影响 position、UV、normal、语义属性；不得删掉接缝属性来强行焊接。限制哈希数值范围以避免 signed-32-bit 回绕 |
| `toCreasedNormals` | indexed 输入返回新 nonindexed 对象；nonindexed 原地返回；严格 `dot > cos(angle)` 累加单位面法线 | 固定约 0.01 **局部单位**的位置桶，无拓扑、group、UV 隔离，也不按面积加权。断开近面仍可能混合；调用者必须先检查尺度/分壳并明确接受桶行为 |
| `computeMikkTSpaceTangents` | `await MikkTSpace.ready` 后修改并返回同一对象；indexed 数据会去索引，产生 tangent4 | xyz 切线与 w 符号都需核对；r187 的副切线为 `cross(normal,tangent.xyz)*w`。`negateSign` 由烘焙器/贴图约定决定 |

下面是唯一完整 ESM。Three.js 与 addons 固定同一 `three@0.187.0` 包。独立项目安装该版本；Node 可将 `THREE_MODULE` 设置为该包实际 `build/three.module.js` 文件 URL 或绝对路径。浏览器使用支持包导入的构建器；此示例的路径解析入口面向 Node。

方法只接受完整 drawRange 的普通静态三角 geometry；partial range 先在调用方提取成独立完整几何，否则拒绝。支持普通 `BufferAttribute` 的 1–4 分量及 normalized 整数属性；所有操作在私有 plain `BufferGeometry` 上处理，避免 PlaneGeometry 等 primitive 的构造配方覆盖实际处理结果。幸存源属性的 `gpuType` 在复制、去索引或焊接后恢复；crease 的新 normal、Mikk 的新 tangent 保留生成属性自己的 GPU 类型。已验证 normalized Uint8 color 在本夹具中保留 raw/logical 值。r187 的 `mergeVertices` 对 normalized Int8 的 -128 保留 raw 编码（逻辑值仍为 -1）；不要把 r180 的边界值重编码结果视为跨版本保证。r187 的 `BufferAttribute.toJSON()` 将 `gpuType` 写入 JSON，`ObjectLoader` 往返保留整数绑定类型；迁移旧版缓存时仍需确认旧 JSON 是否含该字段。若原始整数编码另有语义，调用方须另外设计无损映射，不能依赖此焊接路径；本方法不适配 interleaved、instanced、GL、Float16、morph 或特殊子类布局，尽管个别 native 操作可能支持其中一部分。几何前置条件/UV 退化由代码检查；近面混合仍需资产层检查。输入必须是调用者拥有的程序网格，不提供导入资产许可。

```js
import { pathToFileURL } from 'node:url';
const moduleURL = process.env.THREE_MODULE
  ? (process.env.THREE_MODULE.startsWith('file:') ? process.env.THREE_MODULE : pathToFileURL(process.env.THREE_MODULE).href)
  : import.meta.resolve('three');
export const THREE = await import(moduleURL);
if (THREE.REVISION !== '187') throw new Error('requires three@0.187.0');
export const utils = await import(new URL('../examples/jsm/utils/BufferGeometryUtils.js', moduleURL));
export const MikkTSpace = await import(new URL('../examples/jsm/libs/mikktspace.module.js', moduleURL));

export async function prepareGeometry(source, spec) {
  const fail = message => { throw new Error(message); };
  const { operation } = spec;
  if (!['weld', 'crease', 'mikk'].includes(operation)) fail('explicit operation required');
  const p = source.getAttribute('position');
  if (!p || p.itemSize !== 3 || Object.keys(source.morphAttributes).length) fail('position3/static nonmorph required');
  const count = source.index ? source.index.count : p.count;
  if (!count || count % 3 || source.drawRange.start !== 0 ||
      !(source.drawRange.count === Infinity || source.drawRange.count === count)) fail('full triangle drawRange required');
  if (operation === 'weld' && !(Number.isFinite(spec.tolerance) && spec.tolerance > 0)) fail('positive tolerance required');
  if (operation === 'crease' && !(Number.isFinite(spec.angle) && spec.angle > 0 && spec.angle < Math.PI)) fail('angle must be between zero and pi');
  if (operation === 'crease' && spec.acceptPositionBuckets !== true) fail('inspect disconnected shells and accept position buckets');
  for (const a of Object.values(source.attributes)) {
    if (!a.isBufferAttribute || a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute || a.isGLBufferAttribute || a.isFloat16BufferAttribute || ![1,2,3,4].includes(a.itemSize) || a.count !== p.count || !ArrayBuffer.isView(a.array)) fail('unsupported attribute layout');
    if (![THREE.BufferAttribute, THREE.Float32BufferAttribute, THREE.Float64BufferAttribute, THREE.Int8BufferAttribute, THREE.Uint8BufferAttribute, THREE.Uint8ClampedBufferAttribute, THREE.Int16BufferAttribute, THREE.Uint16BufferAttribute, THREE.Int32BufferAttribute, THREE.Uint32BufferAttribute].includes(a.constructor)) fail('unsupported attribute subclass');
    for (let i=0;i<a.count;i++) for(let k=0;k<a.itemSize;k++) {
      const v=a.getComponent(i,k);
      if (!Number.isFinite(v)) fail('nonfinite attribute');
      if (operation==='weld' && Math.abs(v / spec.tolerance + 0.5) >= 2147483647) fail('weld hash overflow');
      if (operation==='crease' && a===p && Math.abs(v*100.00000001)>=2147483647) fail('crease hash overflow');
    }
  }
  if (source.index) {
    const ix=source.index;
    if (!ix.isBufferAttribute || ix.normalized || ix.itemSize!==1) fail('ordinary index required');
    for (let i=0;i<count;i++) if (!Number.isInteger(ix.getX(i)) || ix.getX(i)<0 || ix.getX(i)>=p.count) fail('invalid index');
  }
  for (const g of source.groups) if (![g.start,g.count,g.materialIndex].every(Number.isInteger) || g.start<0 || g.count<0 || g.start%3 || g.count%3 || g.start+g.count>count || g.materialIndex<0) fail('invalid triangle group');
  const n=source.getAttribute('normal'), uv=source.getAttribute('uv');
  if(operation==='mikk' && (!n || n.itemSize!==3 || !uv || uv.itemSize!==2 || typeof spec.negateSign!=='boolean')) fail('mikk requires normal3/uv2 and explicit negateSign');
  const vertex=i=>source.index ? source.index.getX(i) : i;
  for(let i=0;i<count;i+=3) {
    const ids=[vertex(i),vertex(i+1),vertex(i+2)];
    const [a,b,c]=ids.map(j=>new THREE.Vector3().fromBufferAttribute(p,j));
    const areaSq=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).lengthSq();
    if(!Number.isFinite(areaSq) || areaSq<=1e-20) fail('degenerate triangle');
    if(operation==='mikk') {
      for(const j of ids) if(Math.abs(new THREE.Vector3().fromBufferAttribute(n,j).length()-1)>1e-5) fail('unit normals required');
      const [u,v,w]=ids.map(j=>new THREE.Vector2().fromBufferAttribute(uv,j));
      if(Math.abs((v.x-u.x)*(w.y-u.y)-(v.y-u.y)*(w.x-u.x))<=1e-12) fail('degenerate uv');
    }
  }
  const name=source.name, userData=structuredClone(source.userData), groups=source.groups.map(g=>({...g}));
  // A primitive clone retains its constructor recipe; own a plain payload geometry.
  let prepared = new THREE.BufferGeometry().copy(source);
  try {
    if(operation==='weld' || operation==='crease') {
      const next=operation==='weld' ? utils.mergeVertices(prepared,spec.tolerance) : utils.toCreasedNormals(prepared,spec.angle);
      if(next!==prepared) { prepared.dispose(); prepared=next; }
      prepared.deleteAttribute('tangent'); // changed split/normal invalidates any previous frame
    } else {
      await MikkTSpace.ready;
      utils.computeMikkTSpaceTangents(prepared,MikkTSpace,spec.negateSign);
    }
    // Native deindex/weld rebuild attributes and drop gpuType. Restore surviving semantics.
    for (const [name,attribute] of Object.entries(source.attributes)) {
      if ((operation==='crease' && name==='normal') || (operation==='mikk' && name==='tangent')) continue;
      const target=prepared.getAttribute(name);
      if (target) target.gpuType=attribute.gpuType;
    }
    // Quantization can collapse an initially valid thin face; never return silent face loss.
    const positions=prepared.getAttribute('position'), index=prepared.index;
    if ((index ? index.count : positions.count)!==count) fail(`${operation} changed triangle count`);
    for (let i=0;i<count;i+=3) {
      const ids=[0,1,2].map(k=>index ? index.getX(i+k) : i+k);
      if (ids.some(j=>!Number.isInteger(j) || j<0 || j>=positions.count)) fail(`${operation} triangle ${i/3}: invalid output index`);
      const [a,b,c]=ids.map(j=>new THREE.Vector3().fromBufferAttribute(positions,j));
      const areaSq=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).lengthSq();
      if (!Number.isFinite(areaSq) || areaSq<=1e-20) fail(`${operation} triangle ${i/3}: degenerate output; adjust tolerance/source`);
    }
    prepared.name=name;
    prepared.userData={...userData, geometryQueries:'rebuild'};
    prepared.groups=groups;
    prepared.setDrawRange(0,count);
    prepared.computeBoundingBox(); prepared.computeBoundingSphere();
    return prepared;
  } catch(error) { prepared.dispose(); throw error; }
}

// Caller owns this procedural source and the prepared result separately.
// The selected operation is Mikk only; no implicit welding or smoothing.
const exampleSource = new THREE.PlaneGeometry(1, 1);
export const exampleEvidence = { source: exampleSource, result: null, sourceDisposed: 0, resultDisposed: 0 };
exampleSource.addEventListener('dispose', () => exampleEvidence.sourceDisposed++);
let exampleResult;
try {
  exampleResult = await prepareGeometry(exampleSource, { operation: 'mikk', negateSign: true });
  exampleEvidence.result = exampleResult;
  exampleResult.addEventListener('dispose', () => exampleEvidence.resultDisposed++);
  // Attach exampleResult to the intended mesh here and rebuild its queries.
  // This standalone numerical example has no renderer; it releases immediately.
} finally {
  exampleResult?.dispose();
  exampleSource.dispose();
}

```

焊接后重新检查实际输出三角形的有限面积与非退化条件；量化使薄面塌缩时抛出带操作和面序号的错误，释放私有准备件，保留源与 groups，不删面或宣称修复。

plain `BufferGeometry` 的 Mesh/ObjectLoader JSON 往返保留实际 attribute/index/tangent、尺寸、name/groups/userData；这不包含全部 GPU 合同：r187 原生 attribute JSON 不写 `gpuType`。非默认整数 shader 绑定跨 JSON 传输时，调用方须随属性名另存并恢复实际标记；内存中保留标记不能证明传输后仍保留。

调用者在成功返回后才替换 mesh.geometry；失败时源仍归调用者，准备件释放。结果、源的释放分别由所有者负责。重建基于 index/顶点编号的查询、采样器、BVH 和稳定 ID 映射；`geometryQueries` 是显式失效标记，不是自动重建器。焊接或重算法线后如需 Mikk，可把返回件显式传给第二次调用，再释放中间件。没有需要就不执行这一步。

CPU 数值检查只能证明此方法的几何、所有权和 provider 接线；实际 normal-map 坡向、镜像接缝、硬边与完整镜头观感仍需同贴图/相机/灯光的真实渲染对照。Mikk 内部 solver/WASM 仍由 provider 委托，未声称深读或证明其全部算法。

来源：[r187 BufferGeometryUtils](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/utils/BufferGeometryUtils.js)、[Mikk provider](https://github.com/mrdoob/three.js/blob/r187/examples/jsm/libs/mikktspace.module.js)。
