import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const T = await import(process.env.THREE_MODULE ? pathToFileURL(resolve(process.env.THREE_MODULE)).href : 'three');
const api = await import('../../assets/scene/view-readability.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('view-readability.mjs')) return {};
  throw error;
});
function inspect(options) {
  assert.equal(typeof api.inspectFeatureVisibility, 'function', 'inspectFeatureVisibility must expose sample visibility diagnostics');
  return api.inspectFeatureVisibility(T, {camera:camera(), points:[[0,0,0]], viewport:{width:800,height:600}, ...options});
}
function camera(orthographic=false) {
  const c=orthographic ? new T.OrthographicCamera(-4,4,3,-3,1,20) : new T.PerspectiveCamera(90,4/3,1,20);
  c.position.z=5; return c;
}
function box(x=0,y=0,z=2,width=1,height=1,depth=.5) {
  const m=new T.Mesh(new T.BoxGeometry(width,height,depth),new T.MeshBasicMaterial());
  m.position.set(x,y,z); return m;
}
function conserved(r) {
  assert.equal(r.totalSampleCount,r.onscreenSampleCount+r.clippedOrOffscreenSampleCount);
  assert.equal(r.onscreenSampleCount,r.visibleSampleCount+r.occludedSampleCount);
  assert.equal(r.clippedOrOffscreenSampleCount,r.clippedSampleCount+r.offscreenSampleCount);
}

test('real triangle blockers occlude only sampled rays and report nearest object',()=>{
  const near=box(), far=box(0,0,1);
  const r=inspect({points:[new T.Vector3(0,0,0),[3,0,0]],occluders:[far,near]});
  assert.equal(r.totalSampleCount,2);assert.equal(r.visibleSampleCount,1);assert.equal(r.occludedSampleCount,1);
  assert.equal(r.visibleFraction,.5);assert.equal(r.unblockedOnscreenFraction,.5);
  assert.equal(r.samples[0].status,'occluded');assert.equal(r.samples[0].blocker.object,near);
  assert.equal(r.samples[0].blocker.instanceId,null);assert.ok(r.samples[0].blocker.distance>0);
  assert.deepEqual(r.samples[0].pixel,{x:400,y:300});assert.equal(r.samples[1].blocker,null);conserved(r);
  assert.equal('pass' in r,false);assert.equal('score' in r,false);
});
test('actual gaps remain visible instead of treating a group bounding box as solid',()=>{
  const root=new T.Group();root.add(box(-1,0,2,.5),box(1,0,2,.5));
  assert.equal(inspect({occluders:[root]}).samples[0].status,'visible');
});
test('offscreen and near/far clipped samples remain in the visibility denominator',()=>{
  const r=inspect({points:[[0,0,0],[100,0,0],[0,0,4.5],[0,0,-20],[0,0,6]]});
  assert.deepEqual(r.samples.map(p=>p.status),['visible','offscreen','clipped','clipped','clipped']);
  assert.equal(r.visibleFraction,.2);assert.equal(r.unblockedOnscreenFraction,1);
  assert.deepEqual(r.sampleBoundsPx,{left:400,top:300,width:0,height:0});conserved(r);
  const none=inspect({points:[[100,0,0],[0,0,6]]});
  assert.equal(none.visibleFraction,0);assert.equal(none.unblockedOnscreenFraction,null);assert.equal(none.sampleBoundsPx,null);conserved(none);
  const empty=inspect({points:[]});assert.equal(empty.visibleFraction,null);assert.equal(empty.unblockedOnscreenFraction,null);
});
test('orthographic projection uses the same pixel and triangle visibility contract',()=>{
  const r=inspect({camera:camera(true),points:[[0,0,0],[2,1.5,0],[5,0,0]],occluders:[box()]});
  assert.deepEqual(r.samples[1].pixel,{x:600,y:150});
  assert.deepEqual(r.samples.map(s=>s.status),['occluded','visible','offscreen']);
  assert.deepEqual(r.sampleBoundsPx,{left:400,top:150,width:200,height:150});conserved(r);
});
test('refreshes camera and occluder ancestors without changing pose, points or geometry',()=>{
  const cp=new T.Group(), c=camera();cp.position.x=10;cp.add(c);
  const mp=new T.Group(), m=box();mp.position.x=10;mp.add(m);
  const point=new T.Vector3(10,0,0),array=[12,0,0],before=Array.from(m.geometry.attributes.position.array);
  const r=inspect({camera:c,points:[point,array],occluders:[m]});
  assert.deepEqual(r.samples.map(s=>s.status),['occluded','visible']);assert.deepEqual(r.samples[0].pixel,{x:400,y:300});
  assert.deepEqual(point.toArray(),[10,0,0]);assert.deepEqual(array,[12,0,0]);assert.deepEqual(c.position.toArray(),[0,0,5]);
  assert.deepEqual(mp.position.toArray(),[10,0,0]);assert.deepEqual(Array.from(m.geometry.attributes.position.array),before);
});
test('hidden objects, hidden ancestors and hidden materials never block',()=>{
  const self=box();self.visible=false;
  const parent=new T.Group(),child=box();parent.visible=false;parent.add(child);
  const mat=box();mat.material.visible=false;
  const arrayMat=box();arrayMat.material=Array.from({length:6},()=>new T.MeshBasicMaterial({visible:false}));
  for(const m of [self,child,mat,arrayMat])assert.equal(inspect({occluders:[m]}).visibleSampleCount,1);
});
test('material array visibility is filtered per hit face rather than per mesh',()=>{
  const m=box();m.material=Array.from({length:6},()=>new T.MeshBasicMaterial());m.material[4].visible=false;
  assert.equal(inspect({occluders:[m]}).visibleSampleCount,1);
  m.material[4].visible=true;assert.equal(inspect({occluders:[m]}).occludedSampleCount,1);
});
test('ignore applies to an entire specified subtree, including ancestors above declared roots',()=>{
  const root=new T.Group(),m=box();root.add(m);
  for(const ignore of [[root],[m]])assert.equal(inspect({occluders:[m],ignore}).visibleSampleCount,1);
  assert.equal(inspect({occluders:[root, m],ignore:[]}).occludedSampleCount,1);
});
test('raycaster respects camera layers independently from group layers',()=>{
  const root=new T.Group(),m=box();root.add(m);m.layers.set(2);
  assert.equal(inspect({occluders:[root]}).visibleSampleCount,1);
  const c=camera();c.layers.set(2);assert.equal(inspect({camera:c,occluders:[root]}).occludedSampleCount,1);
});
test('near-clip origin excludes geometry in front of the near plane, in both projections',()=>{
  for(const orthographic of [false,true]){
    const c=camera(orthographic), preNear=box(0,0,4.5,2,2,.1);
    assert.equal(inspect({camera:c,occluders:[preNear]}).visibleSampleCount,1);
    assert.equal(inspect({camera:c,occluders:[preNear,box(0,0,3.5)]}).occludedSampleCount,1);
  }
});
test('near-clip origin follows an off-axis sample ray instead of the camera center',()=>{
  const c=camera();c.near=2;c.updateProjectionMatrix();
  const preNear=box(.6,0,4,2,1,.1);
  assert.equal(inspect({camera:c,points:[[3,0,0]],occluders:[preNear]}).visibleSampleCount,1);
});
test('surface epsilon avoids self hits without ignoring the target owner back surfaces',()=>{
  const target=box(0,0,0,2,2,2);
  assert.equal(inspect({points:[[0,0,1]],occluders:[target]}).visibleSampleCount,1);
  assert.equal(inspect({points:[[0,0,-1]],occluders:[target]}).occludedSampleCount,1);
});
test('transparent declared proxies still block and instanced blockers preserve instanceId',()=>{
  const proxy=box();proxy.material.transparent=true;proxy.material.opacity=.1;
  assert.equal(inspect({occluders:[proxy]}).occludedSampleCount,1);
  const m=new T.InstancedMesh(new T.BoxGeometry(),new T.MeshBasicMaterial(),2);
  m.setMatrixAt(0,new T.Matrix4().makeTranslation(10,0,2));m.setMatrixAt(1,new T.Matrix4().makeTranslation(0,0,2));
  const r=inspect({occluders:[m]});assert.equal(r.samples[0].blocker.object,m);assert.equal(r.samples[0].blocker.instanceId,1);
});
test('HUD overlap counts distinct onscreen samples independently of geometric blocking',()=>{
  const r=inspect({camera:camera(true),points:[[0,0,0],[2,0,0],[10,0,0]],occluders:[box()],overlays:[
    {id:'title',left:390,top:290,width:30,height:30},{id:'badge',left:400,top:300,width:200,height:20}
  ]});
  assert.equal(r.overlaySampleCount,2);assert.equal(r.visibleSampleCount,1);assert.equal(r.occludedSampleCount,1);
  assert.deepEqual(r.samples.map(s=>s.overlays),[['title','badge'],['badge'],[]]);conserved(r);
});
test('custom projection changes clipping without mutating camera projection settings',()=>{
  const c=camera();c.setViewOffset(800,600,400,0,400,600);
  const before=c.projectionMatrix.toArray();const r=inspect({camera:c,points:[[2,0,0],[-2,0,0]],viewport:{width:400,height:600}});
  assert.deepEqual(r.samples.map(s=>s.status),['visible','offscreen']);assert.deepEqual(c.projectionMatrix.toArray(),before);
});
for (const orthographic of [true,false]) {
  const projection=orthographic ? 'orthographic' : 'perspective';
  for (const scenario of ['blocked surface','beyond-far sample']) {
    test(`rejects actual reversed-depth ${projection} projection for a ${scenario}`,()=>{
      const c=camera(orthographic);c.position.set(0,0,0);
      const blocker=new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshBasicMaterial());blocker.position.z=-3;
      const points=scenario==='blocked surface' ? [[0,0,-5]] : [[0,0,-30]];
      // Ordinary depth keeps both its blocker ray and far-clip behavior.
      assert.equal(inspect({camera:c,points,occluders:[blocker]}).samples[0].status,
        scenario==='blocked surface' ? 'occluded' : 'clipped');
      // r187's public reversedDepth is getter-only. This is the real state change
      // WebGLRenderer performs before updateProjectionMatrix(), not a mocked flag.
      c._reversedDepth=true;c.updateProjectionMatrix();c.updateMatrixWorld();
      assert.equal(c.reversedDepth,true);assert.equal(c.coordinateSystem,T.WebGLCoordinateSystem);
      assert.ok(Math.abs(new T.Vector3(0,0,-1).project(c).z-1)<1e-12);
      assert.ok(Math.abs(new T.Vector3(0,0,-20).project(c).z)<1e-12);
      const before=c.projectionMatrix.toArray();
      assert.throws(()=>inspect({camera:c,points,occluders:[blocker]}),/reversed.?depth|ordinary depth/i);
      assert.equal(c.reversedDepth,true);assert.deepEqual(c.projectionMatrix.toArray(),before);
    });
  }
}
test('rejects malformed inputs instead of returning a reassuring visibility number',()=>{
  for(const patch of [{camera:null},{camera:new T.Object3D()},{points:null},{points:[[1,2]]},{points:[[NaN,0,0]]},
    {points:[{x:0,y:0,z:0}]},{viewport:{width:0,height:600}},{viewport:{width:800,height:Infinity}},
    {epsilon:-1},{epsilon:NaN},{occluders:[{}]},{ignore:[{}]},{overlays:[{id:'x',left:0,top:0,width:-1,height:1}]},
    {overlays:[{id:'x',left:0,top:0,width:1,height:1},{id:'x',left:1,top:1,width:1,height:1}]}])assert.throws(()=>inspect(patch),/camera|point|viewport|epsilon|occlud|ignore|overlay/i);
  const gpu=camera();gpu.coordinateSystem=T.WebGPUCoordinateSystem;assert.throws(()=>inspect({camera:gpu}),/WebGL|coordinate/i);
});
