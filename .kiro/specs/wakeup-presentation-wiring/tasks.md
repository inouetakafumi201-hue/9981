# Tasks — `wakeup-presentation-wiring`（表现层接线专项）

## 执行前提

- [ ] **Owner 拍板**：B 方案（新建独立 Spec，不并入 `wakeup-full-body-wiring`）
- [ ] **D-W0X 待决项**：requirements.md §未决项中 D-W01 ~ D-W05 由 owner 拍板后开始阶段 A

---

## 阶段 A：环境就绪（Baseline）

> 目标：让主仓 `tsc --noEmit` 与 V0 壳 `pnpm tsc --noEmit` 双线全绿，形成干净 baseline。

### 阶段 A-1：修复主仓 typecheck 对 V0 壳的污染

**Task A-1-1**：修改主仓 `tsconfig.json`，在 `exclude` 数组中加入 `src/devboard/game-ui-shell-15/**/*.{ts,tsx}`，除以下白名单文件外：
- `src/devboard/game-ui-shell-15/lib/shell-intent.ts`
- `src/devboard/game-ui-shell-15/lib/real-transport-adapter.ts`（阶段 B 新建，阶段 A 先不加）
- `src/devboard/game-ui-shell-15/app/page.tsx`

**验收**：修改后 `npx tsc --noEmit` 退出码 0。

### 阶段 A-2：修复 V0 壳内部 typecheck 错误

**Task A-2-1**：修复 `src/devboard/game-ui-shell-15/lib/chroma-key.ts` 的 7+ 个 TS 错误：
- `@/lib/bitmap-cache` 无法解析 → 确认该文件是否存在；若不存在，创建占位文件 `src/devboard/game-ui-shell-15/lib/bitmap-cache.ts` 并导出空 `BitmapCache`
- `noUncheckedIndexedAccess` 严校验 → 在 `imageData.data[i]` 调用前加 `!` 断言

**Task A-2-2**：修复 `src/devboard/game-ui-shell-15/lib/shell-a11y.ts` 的 3 个 `noUncheckedIndexedAccess` 错误（`lastItem` / `firstItem` / `menuItems`）。

**Task A-2-3**：修复 `src/devboard/game-ui-shell-15/lib/shell-journey.ts` 的 2 个 `string | undefined` 参数错误（节点查询返回值断言）。

**Task A-2-4**：修复 `src/devboard/game-ui-shell-15/lib/shell-particle-contract.ts` 的 `@/lib/b7-particles` 引用。

**验收**：`cd src/devboard/game-ui-shell-15 && pnpm install --frozen-lockfile && pnpm tsc --noEmit` 退出码 0。

### 阶段 A-3：新增 npm 脚本

**Task A-3-1**：在 `package.json` 新增 `"typecheck:shell": "cd src/devboard/game-ui-shell-15 && pnpm install --frozen-lockfile && pnpm tsc --noEmit"`

**验收**：`npm run typecheck:shell` 退出码 0。

### 阶段 A-4：建立 baseline 门禁报告

**Task A-4-1**：跑以下命令并记录实际输出：

```
npx tsc --noEmit           # 记录退出码、耗时、错误数
npm run typecheck:shell   # 记录退出码、耗时
npx vitest run src/ui/presentation  # 记录通过数/总数
npm run lint              # 记录退出码、错误数
npm run verify:docs      # 记录退出码
```

**Task A-4-2**：创建 `.kiro/specs/wakeup-presentation-wiring/execution-report.md` 初版，内容包含：
- baseline 时刻（日期 + commit hash）
- 每条命令的退出码 + 摘要行
- 当前 V0 壳 ` JOURNEY_NODES` 数量 + 节点 ID 列表
- 当前 V0 壳 ` JOURNEY_EDGES` 数量 + 过渡 ID 列表
- 当前 `wakeup-presentation-layer` 复选框状态（仅记录，不修——PT-03 交接项）

**验收**：报告存在且每条命令退出码正确。

### 阶段 A 复选框

- [ ] A-1-1 主仓 `tsc --noEmit` 通过
- [ ] A-2-1 V0 壳 `chroma-key.ts` TS 错误全部修复
- [ ] A-2-2 V0 壳 `shell-a11y.ts` TS 错误全部修复
- [ ] A-2-3 V0 壳 `shell-journey.ts` TS 错误全部修复
- [ ] A-2-4 V0 壳 `shell-particle-contract.ts` 引用修复
- [ ] A-3-1 `npm run typecheck:shell` 脚本生效
- [ ] A-4-1 baseline 门禁命令全部运行并记录
- [ ] A-4-2 `execution-report.md` 初版创建

---

## 阶段 B：PresentationGateway 装配

> 目标：新建 `src/play/loading-runtime/presentation-gateway.ts`，让 `createMatchShell` 的 `after:*` 事件流接入 `PresentationRuntime`。

### 阶段 B-1：确认 `createMatchShell` 事件出口

**Task B-1-1**：审查 `src/play/loading-runtime/match-shell.ts`，确认是否已有 `eventBus: EventBus` 端口。
- 若有 → 记录端口形状，进入 B-2
- 若无 → 在 `MatchShellDeps` 新增 `eventBus` 端口（**非破坏性扩展**），记录交接项到 `execution-report.md`

**验收**：端口存在或已添加。

### 阶段 B-2：创建 `presentation-gateway.ts`

**Task B-2-1**：创建 `src/play/loading-runtime/presentation-gateway.ts`，导出：
- `PresentationGatewayDeps` 接口
- `createPresentationGateway(deps: PresentationGatewayDeps): PresentationGateway`
- `PresentationGateway` 接口（`getProjection()` / `subscribe(handler)` / `dispose()`）

**Task B-2-2**：在 `presentation-gateway.ts` 内实例化 `PresentationRuntime`（`src/ui/presentation/spatial/presentation-runtime.ts`），传入 `mapData`。

**Task B-2-3**：实现事件订阅逻辑：遍历 `afterEvents = ['entity.place', 'rule-settled', 'entity.removed', 'micro-scene-occupants-changed', 'micro-scene-created', 'micro-scene-destroyed']`，每个调用 `matchShell.eventBus.subscribe(event, runtime.feed)`。

**验收**：`npx tsc --noEmit` 通过。

### 阶段 B-3：PresentationGateway 单元测试

**Task B-3-1**：创建 `src/devboard/wiring/presentation-wiring/__tests__/presentation-gateway.test.ts`，覆盖：
- 创建后 `getProjection().revision === 0`
- 接收 `after:entity.place` 后 revision 自增
- `dispose()` idempotent（调用两次无异常）
- `subscribe` 返回注销函数
- `getProjection()` 返回深冻结对象

**验收**：`npx vitest run src/devboard/wiring/presentation-wiring/__tests__/presentation-gateway.test.ts` 全绿。

### 阶段 B-4：对接线层装配点

**Task B-4-1**：在 `src/play/loading-runtime/index.ts`（或主入口）导出 `createPresentationGateway`。
**Task B-4-2**：在 `src/play/loading-runtime/drive.ts` 中添加 `createPresentationGateway` 实例化（放在 `createMatchShell` + `createUiHostPorts` 之后、`driveMatch` 启动之前）。

**验收**：`npx tsc --noEmit` + `npx vitest run src/play/loading-runtime` 全绿。

### 阶段 B 复选框

- [ ] B-1-1 `MatchShell` 事件出口确认或新增
- [ ] B-2-1 `presentation-gateway.ts` 骨架创建
- [ ] B-2-2 `PresentationRuntime` 实例化
- [ ] B-2-3 事件订阅逻辑实现
- [ ] B-3-1 5 个 `PresentationGateway` 单测全绿
- [ ] B-4-1 装配点导出
- [ ] B-4-2 `driveMatch` 集成

---

## 阶段 C：realTransportAdapter 实现

> 目标：让 V0 壳在 `wiring=real` 模式下能把意图发给 `UiSystemPorts`，并接收真实返回。

### 阶段 C-1：IntentMapper 静态数据

**Task C-1-1**：创建 `src/devboard/game-ui-shell-15/lib/intent-mapper.ts`，定义 `INTENT_MAP`：
- 覆盖 V0 壳 `JOURNEY_EDGES` 中所有 `intentId`
- 每个 entry：schema（zod）+ `toInteraction` 构造器
- 未注册 `intentId` → 立即返回 `rejected + INTENT_NOT_REGISTERED`

**Task C-1-2**：创建 `src/devboard/game-ui-shell-15/lib/intent-mapper.test.ts`，覆盖：
- 所有已注册 `intentId` 的 schema 校验
- 未注册 `intentId` 返回 `INTENT_NOT_REGISTERED`
- 玩家可见数值超界（< 1 或 > 5）被拒绝

**验收**：单测全绿。

### 阶段 C-2：realTransportAdapter 实现

**Task C-2-1**：创建 `src/devboard/game-ui-shell-15/lib/real-transport-adapter.ts`，实现 `ShellTransportAdapter` 接口：
- `request(shellRequest: ShellRequest): Promise<ShellTransportResult>`
- `cancel(requestId: string): void`

**Task C-2-2**：实现 `outcomeToState` 翻译：SubmissionOutcome → ShellTransportState。

**Task C-2-3**：实现 800ms `waitForRevisionBump`，在 `accepted` 后等待 `PresentationGateway.getProjection().revision` 变化；若未变化，返回 `degraded`。

**Task C-2-4**：实现 `cancel` 路径：通过 `UiSystem.pendingContracts.cancel(requestId)`。

**验收**：`npx tsc --noEmit` 通过。

### 阶段 C-3：realTransportAdapter 单元测试

**Task C-3-1**：创建 `src/devboard/wiring/presentation-wiring/__tests__/real-transport-adapter.test.ts`，覆盖：
- `accepted` 翻译为 `ShellTransportState.accepted`
- `rejected` 翻译
- `stale` 翻译
- `timeout` 翻译
- `cancel` 路径
- `INTENT_NOT_REGISTERED` 路径
- 800ms 内无 revision 更新 → `degraded`

**验收**：6 个测试全绿。

### 阶段 C-4：接线模式开关集成

**Task C-4-1**：创建 `src/devboard/game-ui-shell-15/lib/wiring-mode.ts`，导出 `WiringMode = 'mock' | 'real' | 'iter-V0'` + `getWiringMode()` / `setWiringMode()`。

**Task C-4-2**：修改 `submitShellIntent`（`src/devboard/game-ui-shell-15/lib/shell-intent.ts`），在 `wiring=real` 时调用 `realTransportAdapter`，在 `wiring=mock` 时走 `mockTransportAdapter`。

**Task C-4-3**：在主仓 `tsconfig.json` 白名单中补加 `src/devboard/game-ui-shell-15/lib/real-transport-adapter.ts`（阶段 A-1-1 的白名单设计）。

**验收**：`npm run typecheck:shell` + `npx tsc --noEmit` 双线通过。

### 阶段 C 复选框

- [ ] C-1-1 `IntentMapper` 覆盖所有 V0 壳 `intentId`
- [ ] C-1-2 3 个 IntentMapper 单测全绿
- [ ] C-2-1 `realTransportAdapter` 骨架
- [ ] C-2-2 `outcomeToState` 翻译
- [ ] C-2-3 800ms `waitForRevisionBump`
- [ ] C-2-4 `cancel` 路径
- [ ] C-3-1 6 个 realTransportAdapter 单测全绿
- [ ] C-4-1 `WiringMode` 开关
- [ ] C-4-2 `submitShellIntent` 路由集成
- [ ] C-4-3 主仓 typecheck 白名单更新

---

## 阶段 D：V0 壳控制面板接线状态增强

> 目标：在 V0 壳控制面板中新增接线模式显示 + revision 计数器 + 失败态强制注入（real 模式）。

### 阶段 D-1：控制面板接线状态徽章

**Task D-1-1**：在 `src/devboard/game-ui-shell-15/components/control-panel.tsx` 新增 `WiringStatusBadge` 组件：
- 左上角徽章：`[MOCK]`（灰色）/ `[REAL]`（绿色）/ `[ITER-V0]`（蓝色）
- 仅 `NODE_ENV !== 'production'` 时可见

**验收**：V0 壳 dev server 启动后，控制面板左上角有接线徽章。

### 阶段 D-2：Revision 计数器

**Task D-2-1**：创建 `src/devboard/game-ui-shell-15/components/revision-counter.tsx`：
- 每 500ms 调用一次 `PresentationGateway.getProjection().revision`
- 显示：`Revision: ${value}`（已连接）/ `Revision: --`（未连接）
- 仅在 `wiring=real` 时渲染

**验收**：`wiring=real` 模式下 revision 值随 `after:entity.place` 事件回流而更新。

### 阶段 D-3：Real 模式强制失败注入

**Task D-3-1**：在 `ForcedOutcomePanel`（新增）中添加 5 个强制失败按钮（REJECTED / STALE / TIMEOUT / CANCELLED / DISCONNECTED），仅 `wiring=real` 模式可见。

**验收**：点击每个按钮，V0 壳 `useShellRouter` 在 200ms 内反映对应失败态，`fallbackPageId` 保持正确。

### 阶段 D-4：ShellTransportState 扩展

**Task D-4-1**：在 `src/devboard/game-ui-shell-15/lib/shell-adapters.ts` 的 `ShellTransportState` 中补加 `disconnected` 与 `degraded`（V0 壳 TypeScript 类型）。

**Task D-4-2**：在 `TRANSPORT_MESSAGES` 中添加：
- `disconnected: '连接已断开，请检查网络后重试。'`
- `degraded: '请求已被接受，但表现层未在 800ms 内响应，界面已降级展示。'`

**Task D-4-3**：修改 `useShellRouter` 把 `degraded` 映射为 `fallbackPageId`（与 `rejected` 同路径）。

**验收**：`npm run typecheck:shell` 通过。

### 阶段 D 复选框

- [ ] D-1-1 `WiringStatusBadge` 渲染
- [ ] D-2-1 `RevisionCounter` 每 500ms 更新
- [ ] D-3-1 5 个强制失败按钮在 real 模式可见
- [ ] D-4-1 `ShellTransportState` 扩字段（disconnected / degraded）
- [ ] D-4-2 `TRANSPORT_MESSAGES` 新增 2 条
- [ ] D-4-3 `useShellRouter` 区分 degraded 与 accepted

---

## 阶段 E：城市地图 + ORCA 接入

> 目标：创建 `city-v1.json` 并让 ORCA 能用该地图数据跑通一次移动意图闭环。

### 阶段 E-1：city-v1.json 设计

**Task E-1-1**：参考 `run/v0-assets/maps/office-v1.json` schema，创建 `run/v0-assets/maps/city-v1.json`：
- schemaVersion: "2.0"
- 节点数 >= 12（驻地区 3 节点 + 床 A 节点 + 途中节点 >= 8 + 边路节点 >= 2）
- micro-scenes >= 3
- 床位 >= 1
- 驻地区域 >= 1
- 边数 >= 14（确保 ORCA 有足够邻居进行半平面计算）
- 每个节点有 `x` / `y` 坐标（ORCA 需要）、`name` 标签（V0 壳显示需要）
- 每个 micro-scene 有 `microSceneId`（供 `presentation:micro-scene-created` 事件映射）

**Task E-1-2**：运行 `npm run verify:data`（或等效 schema 校验脚本）验证 `city-v1.json` 合规。

**Task E-1-3**：创建 `test/play/map/__tests__/city-v1-schema.test.ts`，断言：
- 节点数 >= 12
- micro-scenes >= 3
- 床位 >= 1
- 驻地区域 >= 1
- 边数 >= 14

**验收**：schema 测试全绿。

### 阶段 E-2：ORCA 初始化与移动意图闭环

**Task E-2-1**：修改 `PresentationRuntime` 构造函数（或装配点），在初始化时用 `city-v1` 节点坐标创建 `SpatialEntityStore` entities：主角 entityId = `'player-1'`。

**Task E-2-2**：在 `realTransportAdapter` 中注册 `'move.place'` intentId，参数：
```ts
{
  targetNodeId: z.string(),
  entityId: z.string().default('player-1'),
  pathCost: z.number().int().min(1).max(5),
}
```

**Task E-2-3**：修改 `MoveChoreographer`，在 `after:entity.place` 事件中注入 ORCA 输出：
- 计算 `preferredVelocity` = `targetPosition - currentPosition`
- 调用 `OrcaEngine.step(agents, options)`
- 输出 `OrcaStep.newPosition` 作为移动动画起点

**验收**：手动在 V0 壳中从驻地区移动到床 A，`OrcaEngine.step` 被调用一次，`RenderCommand` 产生。

### 阶段 E-3：失败态闭环验证

**Task E-3-1**：创建 `src/devboard/wiring/presentation-wiring/__tests__/integration/property-tests.ts`，属性测试：
- `rejected` 不前进（`renderCommand.state !== 'accepted'`）
- `stale` 不覆盖新修订（revision 不回退）
- `accepted` 后 revision > oldRevision

**Task E-3-2**：运行属性测试，记录结果到 `execution-report.md`。

### 阶段 E 复选框

- [ ] E-1-1 `city-v1.json` 创建（>= 12 节点）
- [ ] E-1-2 `npm run verify:data` 通过
- [ ] E-1-3 city-v1 schema 测试全绿
- [ ] E-2-1 `PresentationRuntime` 用 city-v1 初始化
- [ ] E-2-2 `'move.place'` intentId 注册
- [ ] E-2-3 `OrcaEngine.step` 在 `after:entity.place` 被调用
- [ ] E-3-1 3 个属性测试全绿
- [ ] E-3-2 测试结果记录到 `execution-report.md`

---

## 阶段 F：完整旅程验证（B 级可跑）

> 目标：V0 壳能走完 `startup-loading → menu-title → residence → bed → battle-intro → hud → pause → result → return` 完整流程，真实接线模式（`wiring=real`）。

### 阶段 F-1：journey edge 覆盖度检查

**Task F-1-1**：对照 `JOURNEY_EDGES`（V0 壳）逐条确认：
- 每个 `intentId` 在 `INTENT_MAP` 中有对应条目
- 每个 `intentId` 在 `CoreMechanicsFacade` 中有对应 `submit` 方法
- 边数统计：当前 `JOURNEY_EDGES.length`，已注册数，待注册数

**Task F-1-2**：对未覆盖的 `intentId`，在 `execution-report.md` 中登记为"待注册 intentId"。

### 阶段 F-2：端到端手动验证

**Task F-2-1**：在浏览器中手动走完以下路径（V0 壳 `wiring=real`，主仓 dev server 运行）：
```
startup-loading（跳过启动动画）→ menu-title → "开始游戏"
→ residence-main → 移动到床 A
→ bed-front-ready → "入梦"
→ transition-battle-intro → "进入对局"
→ hud-main → 暂停 → "继续"
→ hud-main → 攻击一次（或走完一回合）
→ 结算 → transition-result → reward
→ "返回驻地"
→ residence-main
```

**Task F-2-2**：在每个失败态注入点（控制面板）验证：
- REJECTED → 保持原页面
- TIMEOUT → 800ms 后返回 degraded
- CANCELLED → 保持原页面
- STALE → revision 不回退

**Task F-2-3**：将验证结果登记到 `execution-report.md`。

### 阶段 F 复选框

- [ ] F-1-1 `JOURNEY_EDGES` 覆盖度 100%（或记录差异）
- [ ] F-2-1 完整旅程手动走通
- [ ] F-2-2 5 个失败态闭环验证
- [ ] F-2-3 结果登记 `execution-report.md`

---

## 阶段 G：V0 迭代准备 + 交付

> 目标：完成首次 V0 上传，收集反馈，准备下一轮迭代。

### 阶段 G-1：生成 V0 迭代包

**Task G-1-1**：在 `src/devboard/game-ui-shell-15` 中运行 `pnpm build`，确认产物在 `.next/`。

**Task G-1-2**：将 V0 壳当前代码状态打 tag：`git tag wakeup-presentation-wiring/v0-iteration-1`。

**Task G-1-3**：准备 V0 迭代 prompt（包含当前瑕疵清单、意图覆盖度报告、ORCA 输出截图）。

### 阶段 G-2：execution-report.md 最终版

**Task G-2-1**：在 `execution-report.md` 中填写：
- 每个要求的测试覆盖情况（ID + 通过日期）
- 所有未完成项（含原因 + 预计影响）
- 迭代回合改动物（任何超出 A/B/C/D 范围的改动登记越权）
- owner 拍板 D-W01~D-W05 结果

**验收**：报告每条要求有对应测试 ID。

### 阶段 G-3：三命令门禁最终验收

**Task G-3-1**：跑全部门禁命令：
```
npm run typecheck:shell
npx tsc --noEmit
npx vitest run src/ui/presentation
npx vitest run src/devboard/wiring/presentation-wiring
npm run lint
npm run verify:docs
```

**Task G-3-2**：将结果更新到 `execution-report.md`。

### 阶段 G 复选框

- [ ] G-1-1 V0 壳 build 成功
- [ ] G-1-2 git tag 创建
- [ ] G-1-3 V0 迭代 prompt 准备
- [ ] G-2-1 `execution-report.md` 最终版
- [ ] G-3-1 全部门禁命令退出码 0
- [ ] G-3-2 结果登记 `execution-report.md`

---

## 任务总览

| 阶段 | 任务数 | 复选框数 |
|---|---|---|
| A：环境就绪 | 4 | 8 |
| B：PresentationGateway 装配 | 4 | 7 |
| C：realTransportAdapter 实现 | 4 | 10 |
| D：控制面板增强 | 4 | 6 |
| E：城市地图 + ORCA 接入 | 3 | 8 |
| F：完整旅程验证 | 2 | 4 |
| G：V0 迭代准备 | 3 | 6 |
| **合计** | **24** | **49** |

## 跨 Spec 交接项（登记用）

> 以下项在本 Spec 范围内发现但归属其他 Spec，应在对应 Spec 中修复。

| 交接项 | 归属 Spec | 发现位置 | 备注 |
|---|---|---|---|
| PT-03：`wakeup-presentation-layer` 复选框 0/12 与代码现实（224 测全绿）脱节 | `wakeup-presentation-layer` | Baseline 侦查 | 不在本 Spec 修复，登记交接 |
| 主仓 `tsconfig.json` exclude 列表需维护 | 主仓工程治理 | 阶段 A-1-1 | 后续若 V0 壳新增需同步更新 |
| V0 壳 typecheck 7+ 个 TS 错误 | `game-ui-shell-15` 维护 | 阶段 A-2 | 已修复（阶段 A），但不保证后续 V0 迭代不回退 |
| `createMatchShell` 可能无 `eventBus` 端口 | `wakeup-loading-runtime` | 阶段 B-1 | 已在阶段 B 补充端口（非破坏性扩展） |
| `verify:data` 脚本位置待确认 | 主仓 scripts | 阶段 E-1-2 | 如不存在需新建 `scripts/verify-data.mjs` |
