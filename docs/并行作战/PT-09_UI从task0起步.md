## 任务：PT-09 — wakeup-ui-animation 从 task 0 起步（绿地）

### 1. 背景与意图
`wakeup-ui-animation` 是干净绿地：`src/ui/` 尚不存在，其依赖的上游（`src/l2/model`、`src/l2/adapters`、只读投影）已冻结（`attackShape` 已按 2026-08-08 删除）。本任务从 tasks.md 的 task 0 起，按序建立 UI 投影层——它是纯消费/投影层，**不触碰规则、不写状态**。对应主状态板/全局报告 §三 UI 断点。

### 2. 权威依据（先读）
- `.kiro/specs/wakeup-ui-animation/design.md`（组件表、端口、State_Revision、Rule_Event_Projection、Interaction_Intent 形状）
- `.kiro/specs/wakeup-ui-animation/requirements.md` 与 `tasks.md`（任务 0–9 顺序）
- 上游冻结件：`src/l2/model/{projection,family-contracts,constitution}.ts`、`src/l2/adapters/`、`src/l2/registry/read-only-projection.ts`
- `docs/访谈决策记录.md`（`attackShape` 已删；`NODE_CONNECTION_BOUND=5` 等常量取自 `constitution.ts`）

### 3. 就绪确认
- 依赖已闭合：所有上游端口/模型已存在且冻结（37 l2 测试绿佐证）。
- 冻结：本任务只在 `src/ui` 内建投影/交互/演出层，读上游只读端口，不改上游。

### 4. 允许改动的目录（白名单）
- `src/ui/**`（新建：model/ ports/ 投影消费/ 描述符校验/ 交互意图/ 演出编排/ 诊断汇/ 组合根）
- 渲染层 lint 边界配置（tasks task 0：把 `src/ui/**` 纳入 lint）——**若与 PT-06 冲突需协调**：PT-06 负责测试目录纳入，本任务只负责 `src/ui` 源码纳入 lint；改 `.eslintrc.cjs` 前先看 PT-06 是否在跑，避免同文件竞写（就绪门 §5）。

### 5. 禁止触碰（黑名单）
- **不改 `src/l2/**`、`src/core/**`、`src/play/**`、`src/class/**`**（UI 是纯下游消费者；若需上游改动写交接项）。
- **不写任何规则/状态写入**：UI 层禁止调用 `OpRegistry.invoke`，禁止发明语义（无字段名/颜色/文件名/标签启发式）。
- 玩家可见数值严格 1–5；内部度量（修订号/节点数）与可见值类型隔离。

### 6. 行为契约
遵循 `docs/00_并行作战手册.md` §四。按 tasks 顺序推进（0→1→2…），每个 task 完成即跑三条命令。属性测试（task 9，24 个，一属性一文件 `numRuns≥100`）是必交付，不得空转。

### 7. DoD（可机器校验，按 task 增量）
- [ ] `src/ui/**` 纳入 lint 且 0 错。
- [ ] 每完成一个 task，对应单元/属性测试通过；`npx tsc --noEmit` 0 错；`npx vitest run` 全绿。
- [ ] 存在"拒绝即撤除全部派生交互、无部分渲染中间态"的测试证据；存在"UI 不调用 OpRegistry、无语义发明"的架构测试。

### 8. 回流方式
- 每完成一批 task，更新 `wakeup-ui-animation/tasks.md` 复选框（带证据）+ 主状态板该线进度。
- 若发现上游端口缺字段/需调整 → 交接项到对应 l2 线，不自行改上游。
