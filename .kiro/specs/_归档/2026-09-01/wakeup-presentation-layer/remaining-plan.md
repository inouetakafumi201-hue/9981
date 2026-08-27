# WakeUp 表现层后续 plan：R9 / R11 / R12 + 接入 ORCA

> 状态：本轮 (P0–P7) 全部完成，14 测试文件 / 101 测试全绿；P0–P6 实现后，剩 R9 / R11 / R12 三个 spec 子项、以及真正的 ORCA 算法接入。

---

## 1. 已完成（P0–P11，2026-08-25）

| 任务 | 模块 | 测试 |
|---|---|---|
| P0–P7 | 见 execution-report.md | 101 测试 |
| R9 | `disposable.ts` + `presentation-runtime.dispose()` | r9-dispose.test.ts |
| R11 | `accessibility-config.ts` + `isMoveDegraded()` | r11-accessibility.test.ts |
| R12 | `focus-traversal.ts` + `getFocusLabel()` | r12-focus.test.ts |
| P9 | `traversable-computer.ts` | 8 测试 |
| P10 | `pathfinding-service.ts` | 6 测试 |
| P11 | `orca-engine.ts` | 6 测试 |
| 全部 27 文件 / 224 测试全绿 | — | — |

---

## 2. R9/R11/R12：✅ DONE（2026-08-25）

| 任务 | 实现 | 验收 |
|---|---|---|
| R9 dispose | `Disposable` 接口 + `DisposableStack` 链式释放；`dispose()` 后 `feed()` / `rebuildProjection()` 为 no-op | r9-dispose.test.ts |
| R11 自适应 | `AccessibilityConfig` + `isMoveDegraded()` 接口；`reducedMotion` / `lowPerformance` 配置 | r11-accessibility.test.ts |
| R12 无障碍 | `FocusTraversal.getFocusOrder()` + `getFocusLabel()` aria-label 输出 | r12-focus.test.ts |

---

## 3. P9/P10/P11 算法骨架：✅ DONE（2026-08-25）

| 任务 | 实现 | 验收 |
|---|---|---|
| P9 TraversableComputer | 纯函数 `precompute()` → `TraversableDomain`（WSpan/freespan）；8-dir neighbor + 4-dir mask | traversable-computer.test.ts（8 测试） |
| P10 PathfindingService | A* + heap；对角移动 + corner cutting prevention；路径连续性验证 | pathfinding-service.test.ts（6 测试） |
| P11 OrcaEngine | 纯 TS `orcaStep()`；half-plane 投影；`fallbackToLinear` 降级；单 agent 直线 / 两 agent 分离 | orca-engine.test.ts（6 测试） |

**待后续实现**：
- rvo2-js 替换纯 TS `orcaStep`（接口已对齐，可无缝替换）
- Web Worker 装配层（`TraversableWorker` 类，算法层已保持纯函数）
- `PathfindingService.findPath()` → `MoveChoreographer` 实际集成（目前 `MoveChoreographer.submit()` 接受外部 path，path 来自 PathfindingService 的调用由接线阶段负责）

---

## 4. 剩余工作（接线阶段）

### 4.1 渲染层接线（需渲染层实现）

- [ ] `RenderCommandExecutor` 发出的命令实际驱动渲染组件（Canvas/React）
- [ ] `degraded=true` 时渲染层替换动画为直线/静态帧
- [ ] `lowPerformance=true` 时粒子系统初始为 0
- [ ] 粒子系统 RAF 取消（渲染层管理）
- [ ] 音频循环停止（渲染层管理）

### 4.2 MoveChoreographer × PathfindingService × OrcaEngine 串联

- [ ] `PresentationRuntime.feed(after:entity.place)` → `PathfindingService.findPath()` → `OrcaEngine.step()` → `MoveChoreographer.submit(path)`
- [ ] `TraversableWorker` Web Worker 装配
- [ ] 动态障碍更新（`DynamicObstacle[]` 随 `CollisionRegistry` 变化刷新 domain）

### 4.3 事件桥完善

- [ ] `after:turn-end` 触发朝向变化（规则层发出，表现层接收后驱动投影更新）
- [ ] `presentation:immovable-relocatable` 监听（`CollisionRegistry.moveBox()` 已实现）

### 4.4 游戏 UI Shell（devboard）

- [ ] 修复 `game-ui-shell-15` 的 `@/` alias 路径（`@/lib/shell-adapters`、`@/lib/shell-journey`）
- [ ] 修复 `noUncheckedIndexedAccess` 相关 TS 错误

### 4.5 v0-completeness-checklist.md 待办

- [ ] 同屏椭圆上限 15（渲染层实现）
- [ ] 传染护栏 10 层（`OrcaEngine` 配置）
- [ ] 手柄支持（UI 层实现，表现层已提供 `submitIntent` 接口）
- [ ] 玩家点击场景框 → `submitIntent('move', { targetNodeId })`（UI 层实现）
- [ ] 朝向视觉：单一左右朝向、攻击后目标转向、新来者随机转向（规则层发出，表现层接收）

---

## 5. v0-completeness-checklist.md 更新状态

所有已完成条目已记录在 `.kiro/v0-completeness-checklist.md`：
- ✅ 表现层 dispose（R9）
- ✅ reduced-motion / low-performance 接口（R11）
- ✅ 键盘 / 屏幕阅读器（R12）
- ✅ TraversableComputer + Web Worker 预运算（P9）
- ✅ PathfindingService A* 骨架（P10）
- ✅ OrcaEngine 纯 TS 骨架（P11）
- ✅ RenderCommand 生命周期（R5/R13）
- ✅ 投影桥接消费（R6）
- ⬜ 渲染层动画实际替换
- ⬜ 手柄支持
- ⬜ 同屏椭圆上限
- ⬜ 玩家输入 → submitIntent 接线
