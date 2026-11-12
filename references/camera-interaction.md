# 相机设计、观看覆盖与真实输入

交互3D默认完整水平环绕、合理俯仰、缩放与复位；导演影片只覆盖约定视锥/运镜。模式并存时分开保存相机，场景时钟不能覆盖用户视角。固定点全景与绕物三维分别交付。

## 从屏幕指针到语义对象

指针先从页面坐标减去canvas实际CSS矩形，再归一成NDC；不是除以整个窗口，也不乘DPR。以下使用当前Three、真实相机和要参与遮挡/拾取的roots；它读取最近命中，沿父链寻找`userData.entityId`。未标记的最近实体作为遮挡，不透过它选后方物体。

```js
function pickEntity(event,canvas,camera,roots){
  const rect=canvas.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return null;
  const x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;
  if(x<0||x>1||y<0||y>1)return null;
  camera.updateWorldMatrix(true,false);for(const root of roots)root.updateWorldMatrix(true,true);
  const ray=new THREE.Raycaster();ray.layers.mask=camera.layers.mask;ray.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),camera);
  const hit=ray.intersectObjects(roots,true).find(h=>{
    for(let o=h.object;o;o=o.parent)if(!o.visible)return false;
    const m=Array.isArray(h.object.material)?h.object.material[h.face?.materialIndex??0]:h.object.material;
    return m?.visible!==false;
  });if(!hit)return null;
  for(let o=hit.object;o;o=o.parent)if(o.userData.entityId!==undefined)return {entityId:o.userData.entityId,entity:o,hit};
  return null;
}
```

将地面/道具等实际遮挡物纳入roots；需要选择穿透时显式设计另一种模式。复杂透明、alpha裁边、实例、蒙皮和shader形变需匹配实际可见/交互语义：CPU三角形命中不自动知道shader裁掉的像素，instanceId也需映射到稳定实体。拖动Orbit与点击选择使用明确阈值或指针状态区分，避免拖完即误选。

需要可控粗细的路径/标注时，条件读取[宽线方法](wide-lines.md)，按活动逻辑视口准备 resolution、补宽线距离过滤并声明虚线选择策略；仍保留上述最近遮挡与语义归属。

## 空间草案时确定包络

定义target、方位、俯仰、距离、FOV与near/far。全场围绕这个实际可达域建设承托、侧背、远景与天空；把8个水平代表方向各自需要读出的主体关系、环境层次及允许遮挡写入布局。每角度可以看同一主体，但不能只剩无信息背墙、黑幕或场地外壳。

构图/占幅按[空间方法](scene-layout.md)选择，不自动用全场AABB把主体缩小。相机边界来自内容和查看任务；限定地下/非设计内部合理，缩窄水平范围掩盖缺失场景不算完整360°。

相机可能接近地形/建筑时分别查两件事：

| 问题 | 核对方法 |
|---|---|
| 相机位置是否进入实体/被裁切 | 最终网格/等价几何查询，记录实际机位与安全间隙；near/far与包围体一起看 |
| 预期场景关系是否被遮住 | 向关键锚点/连接段射线查第一遮挡，再看实际画面；正净空不保证焦点可读 |

控制器自动推开/抬高后，重新检查实际构图与查看范围。透明排序、反射、阴影和细件按侧背/掠射角补测，不只测试正面。

页面存在标题/说明时，按[模型与界面代码](visual-construction.md#6-近景同时设计模型与界面)统一canvas投影与DOM坐标，为合法近景设计折叠/留白；模型不穿体与页面读得清分别检查。

## 最终入口的实际操作

1. 记录初始相机位置/target、azimuth、polar、distance，保存目标视口。
2. 用鼠标/触摸实际拖动一整圈，跨±π正确unwrap累计角度，读回真实OrbitControls/实际相机状态；至少观察8方位，完整水平轨迹应达到约359°以上。鼠标像素位移和脚本设机位不是实际角度证据。
3. 用滚轮/双指缩放，检查近/远端；再检查承诺的俯仰端点，看穿模、裁切、地平线/地面露边、空白侧背和信息遮挡。
4. 点击实际复位入口，等待阻尼稳定，核对position/target/方位/俯仰/距离回到设计容差；影片/自由模式来回切换也检查状态。

用可用浏览器自动化或CUA/MCP操作最终构建。保存入口/版本、实际输入、相机读回、当前页面图和观察结论；页面改动后重测受影响状态。静态包络图解释内容，真实输入解释操作，各自说明范围。若只能设机位，交互仍未验收。

## 调用与更新

使用同一锁定Three/addons，统一相机写入权；动画帧先求场景状态再更新控制器并绘制。按需渲染时，`change`回调只绘制：在该回调内再次`controls.update()`可能递归触发change。需要阻尼则在帧循环更新。现成[工作台](production-toolkit.md)使用无parent的PerspectiveCamera与OrbitControls，其余控制器需自己的snapshot/restore适配，不能假定同名接口兼容。
