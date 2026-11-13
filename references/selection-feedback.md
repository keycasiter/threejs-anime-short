# 选择状态与可见反馈

选择由三段数据接力组成：CSS指针位置→相机射线命中→稳定语义ID；ID再映射到可描边的`Object3D`范围。拾取与表现分开：`Raycaster`决定谁在最前，OutlinePass只显示当前ID对应的轮廓。不要用轮廓Pass的视觉结果反向猜测选择对象。

## 实现步骤

1. 为可选择的实体分配稳定、非空且不重复的ID，例如`beacon:main`；为一个语义对象登记一个真实`Object3D`根节点。根节点可以是多个子Mesh组成的Group。
2. 射线对完整场景查询，而不是只查可选对象。按最近的可见命中决定结果：可选择的命中映射到注册根；未注册的实体命中视为遮挡并清空选择；空命中也清空选择。这样不可选装饰物仍能挡住后方目标。
3. 拖动相机不触发点击。只在pointerdown与pointerup位移低于阈值时拾取；坐标用canvas的`getBoundingClientRect()`转换为CSS局部坐标，再传给选择控制器。
4. 把选中根节点写入`OutlinePass.selectedObjects`，未选中时传空数组。OutlinePass只处理对象范围，不能靠`faceIndex`描出合批Mesh内部的独立业务部位。
5. 对一个Mesh内部需要分别选取的部位，按语义拆成子Mesh，或另建实际GPU ID缓冲/三角语义映射；不要给同一个OutlinePass对象伪造多个稳定ID。
6. 对象移除时调用注册返回的释放函数；整套选择控制器退出时清空OutlinePass、注册表和监听/控制器。OutlinePass由后期管线所有，选择控制器只借用它。

## 可运行配方

```js
import {createSelectionFeedback} from './assets/interaction/selection-feedback.mjs';

const selection=createSelectionFeedback(THREE,{scene,camera,outlinePass:post.passes.outline});
const unregister=selection.register('beacon:main',beaconRoot);
post.passes.outline.visibleEdgeColor.set('#ffe4a8');
post.passes.outline.hiddenEdgeColor.set('#bc805d');
let pointerDown=null;
canvas.addEventListener('pointerdown',event=>{pointerDown=[event.clientX,event.clientY];});
canvas.addEventListener('pointercancel',()=>{pointerDown=null;});
canvas.addEventListener('pointerup',event=>{
  if(!pointerDown)return;
  const moved=Math.hypot(event.clientX-pointerDown[0],event.clientY-pointerDown[1]);pointerDown=null;
  if(moved<5)selection.pick(event.clientX,event.clientY,canvas.getBoundingClientRect());
});
// Removed asset: unregister();  Scene teardown: selection.dispose();
```

`createPostPipeline`在OutlinePass存在时将它放在场景/AO/Bloom之后、OutputPass之前；只有请求`outline:true`才默认开启。未提供OutlinePass构造器时，明确启用描边会失败。例子见[选择实验](../assets/examples/selection-lab/index.html)和[后期实现](../assets/rendering/post-pipeline.mjs)。

GLTF加载完成后，`gltf.scene`本身就是可登记的Object3D根；如数据源提供稳定业务键，可在加载边界验证并传入该根。不要以加载顺序或`Object3D.id`代替跨重载稳定的业务ID。

```js
const modelRoot=gltf.scene;
const entityId=modelRoot.userData.entityId;
if(typeof entityId!=='string'||!entityId)throw new Error('GLTF root needs a stable entityId');
const unregister=selection.register(entityId,modelRoot);
```

OutlinePass只依赖加载后真实Object3D树；本方法不要求或封装`GLTFLoader`，加载与业务键校验归资产入口所有。一个根节点下的多Mesh可共享一个选择ID；要对其内部部件独立选择，必须有独立子树或使用对象级OutlinePass之外的局部mask方案。

## 验收矩阵

| 情况 | 通过条件 |
|---|---|
| 前后遮挡 | 后方目标前有未注册可见物体时，选择为空；遮挡物隐藏后，后方目标可选 |
| 隐藏对象 | 隐藏Mesh或隐藏祖先不截断射线；不可见材质面不成为目标 |
| 业务ID | 重复ID、重复根和未知ID明确报错；点击可复现同一ID |
| 点击与拖动 | CSS视口内点击可选；拖动Orbit不误触发；画布外/空处清除选择 |
| 真实反馈 | 选择改变OutlinePass的实际`selectedObjects`；取消/移除后无残留轮廓 |
| 生命周期 | resize使用新canvas矩形；场景卸载后OutlinePass与选择控制器分别释放各自拥有资源 |

本实现默认处理普通Mesh/Group的对象级选择；透明叠层穿透、实例ID选择、GPU picking、大量对象加速和键盘可访问性需按产品交互单独决定，不能由对象级OutlinePass推断已支持。
