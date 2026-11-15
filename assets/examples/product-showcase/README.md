# 精密相机：物体展示完整纵向样例

适用于“单个主体是视觉焦点，且需要支撑空间、材光、细节和环绕观察”的任务。示例使用 Three.js r187、代码生成几何、CanvasTexture程序微表面、静态局部PMREM、软箱照明、AO/低强度Bloom/SMAA与OrbitControls；没有外部模型、图片或网络素材。

## 文件职责

- [`../product-camera.mjs`](../product-camera.mjs)：主体工厂；米制尺寸、Y向上、镜头沿+Z；材料由调用方提供并负责释放，工厂创建的所有几何由`dispose()`释放。
- [`main.mjs`](main.mjs)：影棚、主体装配、照明、反射探针、观察视角、焦点滑块与运行资源所有权。
- [`index.html`](index.html)：完整交互入口和本地r187导入映射。

## 可迁移做法

外壳使用圆角挤出而非整机单盒；镜筒拆成法兰、筒节、滚花环、光圈叶片和曲面玻璃；背部屏幕、取景器、热靴和操控件属于同一个坐标契约。焦点参数同时驱动镜筒轴向位移和对焦环状态。示例把重复滚花/刻度合为实例网格，避免逐件绘制开销。

影棚的地面和背景连续弯折，模型落在真实支撑台上；软箱只参与静态局部探针捕获，不作为最终视野中的道具。程序纹理为CanvasTexture，材质按粗糙度、金属度和清漆层区分。探针捕获后不随灯光/模型动画更新；如果任务中环境会改变，必须改用实时或分区捕获策略并核算代价。

## 运行与检查

将 Three.js `0.187.0` 的`build/`与`examples/jsm/`放在本目录`vendor/`，从Skill仓库根目录启动本机静态服务，再打开`assets/examples/product-showcase/index.html`。本仓库批量离线闭包验证的入口为：

```sh
THREE_ROOT=/absolute/path/to/three node scripts/verify-example-suite.mjs
THREE_MODULE=/absolute/path/to/three/build/three.module.js node --test scripts/tests/product-camera.test.mjs
```

测试覆盖组件存在、包络尺度、重复细节实例、焦点参数真实消费者、非法输入与几何资源释放。它不验证浏览器GPU、实际像素效果或产品设计正确性。运行页面后至少查看默认三分之四视图、镜头近景、背屏、顶部和连续拖拽环绕；真实视觉验收需要当前浏览器中的最终画面。

固定的相机造型、影棚颜色、光源功率和细节分布仅是演示参数，不是其它产品或题材的美术模板。
