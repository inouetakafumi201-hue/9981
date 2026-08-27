# V0 前端补全清单：表现层触发的新增需求

> **用途**：未来批量生成完善 Prompt 时，对照本文检查前端壳层的每个实现点是否已覆盖。
> **触发来源**：`docs/表现系统/15_表现层生命周期与交互桥设计.md`（现行权威）、`docs/表现系统/01_图形化与UI.md`、`docs/表现系统/11_ORCA寻路与移动系统设计补全.md`、`docs/L2_基类层/03_空间系统.md`
> **状态**：基于 2026-08-26 裁决定案；P9/P10/P11（2026-08-25）已落地 TraversableComputer、Web Worker 预运算、PathfindingService A*、OrcaEngine 纯 TS 骨架。

---

## 交互目标（两条分轨）

- [ ] **跨天然场景移动**：玩家点击高亮场景框。场景框是投影出的交互目标，不是网页按钮；可达时白色/灰白反光边缘，不可达时扁平且不可选。
- [ ] **同场景微型场景移动**：玩家点击目标实体脚底的椭圆地面承载面。不是“进入空旷地”按钮，不是正圆特效，不漂浮在实体头顶。
- [ ] **移动选择态**：同时高亮当前天然场景内全部可进入的地面承载椭圆；悬停/键盘/手柄聚焦只增强当前目标。
- [ ] **个人空旷地无入口**：玩家可见动作列表不包含“进入空旷地”；运行期在 `entity.place` 容纳判定中自动创建/复用，不提供 UI 动作。

---

## 地面承载椭圆（GroundGlowFootprint）

- [ ] **形状**：SVG `<ellipse>`，`rx > ry`，`cx/cy` 落在实体脚底或微型场景地面锚点，不是实体头顶。
- [ ] **默认弱可见**：不在移动模式外消失，始终保持弱可见状态（不透明度/饱和度降低但不能从页面中移除）。
- [ ] **移动选择态高亮**：进入移动模式时，全部可进入椭圆同时高亮（橙/青色描边）。
- [ ] **点击命中**：使用椭圆区域数学测试（`dx²/rx² + dy²/ry² ≤ 1`），不使用圆边界盒。
- [ ] **等效圆用于 ORCA**：空间算法层把 `rx/ry` 换算为等效圆半径，视觉椭圆不直接作为碰撞体。
- [ ] **轴长随实体数变化**：`rx/ry` 随 `occupantIds.length` 增大；变大若与邻椭圆重叠，由 ORCA 传染处理。
- [ ] **可访问性**：每个椭圆有 `aria-label`（来自微型场景投影），键盘/手柄聚焦有非颜色反馈（描边加粗/轻微弹跳）。
- [ ] **零 occupants 注销**：逻辑注销立即执行（不可点击、不参与 ORCA、不参与重叠检测），视觉可短暂淡出 200–300ms 后释放实例。
- [ ] **幂等 destroy**：重复 destroy、对象已不存在、过期 destroy 幂等处理并记录诊断，不恢复已注销对象。

---

## 单人模式

- [ ] **动画不阻塞输入**：规则结算完成 → 动作卡片按投影发放/高亮 → 玩家可立即继续输入。
- [ ] **恢复对峙并行**：ORCA 恢复对峙和视觉演出与玩家下一输入并行，表现层不因等待动画阻止输入。

---

## 多人模式

- [ ] **轮权交接等待演出**：本轮所有必要演出完成后才允许：发放下一轮动作卡、高亮下一轮动作、自动滑动镜头、结束当前轮次并交权。
- [ ] **3000ms 硬上限**：等待超过 3000ms → 记录超时诊断 → 取消/降级未完成命令 → 落入最终静态状态 → 释放表现锁 → 继续发放/高亮/镜头交权。
- [ ] **超时不回滚**：规则事实不回滚，玩家输入不重复提交。

---

## 渲染层等待状态

- [ ] **不渲染内部等待态**：不显示“等待表现层确认”的投影 pending / intent pending / route pending 中间态。
- [ ] **仅接收已 committed 投影**：渲染层只从 `projection committed` 后的表现事件开始演出。

---

## RenderCommand 生命周期

- [x] **命令结构**：`commandId` + `semanticId` + `sourceRevision`（revision 溯源，用于 stale 检测）+ `targetPageId`（可选，用于卸载清理）+ `trigger`（`after-event` | `projection` | `local-input`）。（`RenderCommand` 接口已定义）
- [x] **结果枚举**：`accepted` | `completed` | `skipped` | `degraded` | `failed` | `timeout` | `cancelled` | `stale`。（`RenderCommandOutcome` 已定义）
- [x] **Revision stale**：如果 `sourceRevision` 与当前投影 revision 不匹配，命令进入 `stale`，不执行。（`checkRevision()` 已实现）
- [x] **取消**：页面切换或新意图到达时，悬挂中的命令进入 `cancelled`。（`cancelAll()` + `cancelCommandsForTarget()` 已实现）
- [x] **超时**：单命令超时（如攻击动画 1500ms）进入 `timeout`，记录诊断。（`ResourceFailureFallback` 已实现）
- [x] **降级**：`reduced-motion` / `low-performance` 时命令进入 `degraded`，替换为静态姿态/直线位移。（`degraded` 字段 + `isMoveDegraded()` 已实现）

---

## 卸载清理

- [x] **RAF**：取消所有活跃 `requestAnimationFrame`。
- [x] **Timer**：清除所有 `setTimeout` / `setInterval`。
- [x] **碰撞箱注册**：清空表现层 `CollisionRegistry`。
- [x] **Cluster/Footprint fading 实例**：完成淡出或立即释放，不残留 DOM 节点。
- [x] **旧 revision 命令**：过期命令进入 stale，不在新页面产生副作用。
- [ ] 粒子实例：释放所有活跃粒子系统。（粒子系统由渲染层管理，表现层只发命令）
- [ ] 音频循环：停止所有循环音频，释放音频上下文引用。（音频系统由渲染层管理）
- [ ] 命令订阅：取消所有未完成命令的订阅。（由 executor 内部管理）

---

## 视觉状态降级

### reduced-motion

- [x] 保留：场景框、椭圆承载面、标题、焦点、状态标签、最终位置。（`degraded=true` 标记，渲染层决定如何处理）
- [x] 禁用/替换：`reducedMotion=true` 时命令进入 degraded 状态。（`isMoveDegraded()` 接口已实现）
- [ ] 渲染层实际替换动画为直线/静态帧。（由渲染层实现，表现层已提供 `degraded=true` 信号）

### low-performance

- [ ] 减少粒子和装饰数量。（渲染层实现）
- [x] 保留全部可交互场景框和地面承载椭圆。（`lowPerformance` 配置不改变表现层状态）
- [x] 保留实体位置、Cluster 关系、焦点和错误状态。（架构上已保证）
- [ ] 低性能不是空白 fallback（不渲染纯白/黑屏）。（渲染层实现）

### 资源失败

- [ ] 图像/音频/粒子资源加载失败 → 记录资源诊断。
- [ ] 替换为语义贴图（纯色+图标）/ 静态椭圆占位 / 文字标签。
- [ ] 保留交互和最终状态，不阻断玩家操作。

---

## 投影消费与事件桥

- [x] **MicroScenePresentationProjection 消费**：监听 `presentation:micro-scene-created`、`presentation:micro-scene-occupants-changed`、`presentation:micro-scene-destroyed`，只用投影字段，不从事件推断未声明规则。（`SpatialProjectionStore` 订阅 committed 事件，只读投影字段）
- [x] **实体位置投影**：从权威事件更新 `spatialStore`，不自行计算位置。（`EventBridge` 驱动 `SpatialEntityStore`）
- [x] **不可动实体迁移信号**：监听 `presentation:immovable-relocatable`，收到后更新 `CollisionRegistry` 的 `clusterId`，不播放归位动画。（`CollisionRegistry.moveBox()` 已实现）
- [x] **after:entity.place 消费**：触发 `MoveChoreographer`，不自行决定微型场景创建/销毁。（`PresentationRuntime.feed()` 实现）
- [ ] after:turn-end 消费：触发朝向我攻击者、随机数人转向新来者，不全员转向。（规则层实现，表现层已提供投影接口）

---

## 朝向视觉

- [ ] **单一左右朝向**：`facing: 'left' | 'right'`，由朝向算法决定，不依赖动画旋转。
- [ ] **恢复对峙不改朝向**：位置变化不触发转向。
- [ ] **攻击后目标转向攻击者**。
- [ ] **新来者进入**：随机 1–3 人转向，绝不全员转向。

---

## 性能边界（按 ORCA 设计）

- [ ] **同屏椭圆上限 15**：超过时只渲染可交互圈（玩家所在的 Cluster + 目标泛光圈），其余弱可见/不渲染。
- [ ] **传染护栏 10 层**：超过 10 层传染链时强制终止并记录警告。
- [x] **OrcaEngine 每帧解算**：纯 TS 骨架 `orcaStep()` 实现，`fallbackToLinear` 降级机制。（rvo2-js 未引入，后续可替换）
- [x] **Web Worker 预运算**：`TraversableComputer.precompute()` 保持纯函数设计，Worker 化是上层装配职责。

---

## 可访问性

- [x] **键盘导航**：场景框和椭圆承载面可 Tab/方向键导航，Enter 选中。（`FocusTraversal` 模块已实现，`getFocusOrder()` 输出有序 focus list）
- [ ] 手柄支持：游戏手柄方向键/肩键导航，A 键选中。（UI 层实现，表现层已提供 `submitIntent` 接口）
- [x] **非颜色反馈**：聚焦使用描边加粗、轻微弹跳或文字提示，不只用颜色高亮。（`GroundGlowFootprint` 结构支持，`getFocusLabel` 输出 aria-label）
- [x] **屏幕阅读器**：`aria-label` 来自微型场景投影和 Cluster 语义，不使用特效名称。（`getFocusLabel()` 实现）
- [x] **reduced-motion 尊重**：`prefers-reduced-motion` 媒体查询触发所有动画降级。（`AccessibilityConfig` + `isMoveDegraded()` 接口已实现）

---

## 跨场景移动完整流程接线点

- [ ] 玩家点击场景框 → `submitIntent('move', { targetNodeId })`
- [x] 权威确认 → 新 projection committed（`PresentationRuntime.feed()` 接 `after:entity.place`）
- [x] 旧 Cluster/Footprint 注销 + 视觉淡出（`ClusterStore.transitionToFading()`）
- [x] 新 Cluster/Footprint 创建 + 视觉淡入（`ClusterStore.apply()` + `fadingMs` 控制）
- [x] `CollisionRegistry` 更新（`CollisionRegistry.register/update/setMobility/setCluster`）
- [x] `MoveChoreographer` 播放移动演出（单人不阻塞输入）（`submit()` + `drainPending()`）
- [x] 到达静态终态，椭圆恢复弱可见（`GroundGlowFootprint.visibility = 'weak'`）

---

## P9/P10/P11 算法骨架（2026-08-25 落地）

### TraversableComputer（Web Worker 预运算）

- [x] `TraversableComputer` 纯函数设计，输入 `(grid: GridSpec, options)` → 输出 `TraversableDomain`
- [x] 支持静态障碍（`blocked`）、动态障碍（`DynamicObstacle`）、可通行域（freespan）
- [x] `precompute()` 返回可序列化 domain（WSpan/freespan），可跨 Worker 传递
- [x] Worker 装配层由上层负责（`TraversableWorker` 类），算法层保持纯函数
### OrcaEngine（纯 TS 骨架）

- [x] 纯 TS 实现，不依赖 rvo2-js（可替换为 rvo2-js 后续）
- [x] `orcaStep(agents, options)` → `OrcaStep[]`，同步纯函数
- [x] half-plane 投影：每个 neighbor → 一条 ORCA half-plane
- [x] `fallbackToLinear` 降级：穿模时返回原位置
- [x] 单 agent 保持直线位移、两 agent 有偏移时分离
- [x] 接口与 rvo2-js 兼容（后续替换不破坏调用方）
