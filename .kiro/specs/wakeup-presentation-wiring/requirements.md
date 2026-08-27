# Requirements — `wakeup-presentation-wiring`（表现层接线专项）

## 简介

本规范定义 V0 偷师前端（`src/devboard/game-ui-shell-15`，下称 **V0 壳**）与 WakeUp 表现层后端、整合层装载运行期、UI 端口面、ORCA 寻路、城市地图数据之间的**接线工程**。工程目标不是再写一套前端，而是把 V0 壳已经成型的视觉、动效、控制面板、页面切换与失败态闭包接入可验证的项目权威契约，使玩家流程能从 `startup-loading` 走完整条 `B 级单关完整流程` 并通过 V0 壳自带控制面板强制注入每个失败态以验证表现层接线正确性。

**接线成功 ≠ Demo 完成**。接线后存在视觉、动效、时序与失败态的瑕疵是预期现象，本 Spec 的**迭代交付循环**显式承认这些瑕疵：每轮"上传 V0 多模态"迭代都可能产生四种改动——(1) V0 壳前端代码改动、(2) 表现层后端 bug 修复、(3) 城市/测试地图数据新增、(4) 失败态/动效 recipe 新增；本 Spec 必须约束这四类改动的**写锁边界**，防止任何一轮迭代越界把规则事实写进壳或把表现层状态写成权威。

**与相邻 Spec 的关系**：

- 本 Spec 是**新独立 Spec**（owner 拍板 2026-08-27，B 方案），不并入 `wakeup-full-body-wiring`；后者继续承担"全身接线"中的元状态/电脑 UI/编辑创作接线，**不重复**本 Spec 范围。
- 本 Spec **消费** `wakeup-presentation-layer`（R1-R14）锁定的表现层内部契约，不重写。
- 本 Spec **消费** `wakeup-loading-runtime` 的 `createLoadedMatch` / `createMatchShell` / `createUiHostPorts` / `driveMatch` 落地线，不重写。
- 本 Spec **消费** `v0-frontend-workflow` 的 V0 壳 Prompt Pack 范围锁（`editor` / `research-bench` / `material-library` / `computer` 仅驻地入口占位），不重写。
- 本 Spec **被** `docs/表现系统/14_表现层架构设计.md` 与 `15_表现层生命周期与交互桥设计.md` 约束。

**本 Spec 的写锁纪律**：

- 写：仅 `src/devboard/wiring/presentation-wiring/**`、`src/devboard/game-ui-shell-15/lib/real-transport-adapter.ts` 真实 transport 实现（替换 mockTransportAdapter 的真实分支）、`src/play/loading-runtime/presentation-gateway.ts` 装配点（如不存在则新建）、`run/v0-assets/maps/city-v1*.json` 城市地图数据、`.kiro/specs/wakeup-presentation-wiring/` 自有 spec 文件、`.github/workflows/wire-presentation-iterate.yml`（如需 CI）。
- 读（仅参考，不修改）：`src/ui/**`、`src/play/loading-runtime/**`（除 presentation-gateway 装配点）、`src/devboard/game-ui-shell-15/{app,components,lib,hooks}/**` V0 壳全部视觉与 mock 文件（除 `mockTransportAdapter` 真实分支替换点）。
- 禁止：删除/隐藏/静态化任何 V0 壳视觉层；不通过删除视觉解决接线 bug；不在 React store 中持有规则事实；不通过 mock 数据冒充权威投影；不绕过 `UiSystemPorts` 直接调用 `OpRegistry` 或 `WorldStateHolder`。

### 层级归属与权威来源

| 代号 | 来源 | 权威用途 |
|---|---|---|
| S0 | `docs/L0_规范宪法.md` | 最高权威：三层边界、玩家可见数值 1-5、唯一写入通道、正交域（D-067~D-070） |
| S1 | `.kiro/specs/wakeup-presentation-layer/{requirements,design}.md`（R1-R14） | 表现层内部契约：空间投影、Cluster、GroundGlow、Collision、RenderCommand、EventBridge、MoveChoreographer、TurnHandoffGate、dispose、fallback、无障碍、修订检查、可审计 |
| S2 | `.kiro/specs/wakeup-loading-runtime/{requirements,design}.md` + `src/play/loading-runtime/` | 整合层装载运行期：组合根 `createLoadedMatch`、对局外壳 `createMatchShell`、UI 宿主 `createUiHostPorts`、加载驱动 `driveMatch`、事件出口 |
| S3 | `.kiro/specs/v0-frontend-workflow/{requirements,design}.md` | V0 壳范围锁：B1-B7 独立命令、PageCatalog、控制面板、资产 manifest、HUD 爆发档位冻结、失败态闭包、参考资产口径 |
| S4 | `src/devboard/game-ui-shell-15/{app,components,lib,hooks}/**` + V0 壳 `EXTRACTION-REPORT.md` | V0 壳代码现状（已落地）：`submitShellIntent` / `useShellRouter` / `JOURNEY_NODES` / `JOURNEY_EDGES` / `mockAssetAdapter` / `mockStorageAdapter` / `mockTransportAdapter` / 强制注入接口 |
| S5 | `src/ui/index.ts` `UiSystemPorts` / `src/ui/ports/**` | 唯一 UI 端口面：projection / events / actionQuery / revision / actions / pendingContracts / diagnostics |
| S6 | `docs/表现系统/{14,15}_*.md` | 表现层架构设计 + 生命周期与交互桥设计（运行链位置、4 块组织、只读数据面 + 命令面） |
| S7 | `src/ui/presentation/spatial/algorithms/orca-engine.ts`（161 行已落地）+ `__tests__/orca-engine.test.ts` | ORCA 纯 TS 骨架，1 步 neighbor half-plane 投影，fallback 直线位移 |
| S8 | `run/v0-assets/maps/{office-v1,warehouse-v1}.json` | 现有 V0 资产地图基线；本 Spec 新增 `city-v1*.json` 走同一 schema |
| S9 | `.kiro/specs/wakeup-full-body-wiring/{requirements,design}.md` | 全身接线的元状态/电脑 UI/编辑/素材接线范围（本 Spec 不重复） |

### Baseline 现状（2026-08-27 立项时刻实测）

| 指标 | 数值 | 备注 |
|---|---|---|
| 表现层后端单测 | **224 / 224 passed**（27 files） | `npx vitest run src/ui/presentation` 全绿 |
| 全仓 typecheck | **失败** | V0 壳 `game-ui-shell-15/lib/{chroma-key,shell-a11y,shell-journey,shell-particle-contract,shell-route}.ts` 报 7+ 个 TS 错误，主要为 `@/*` path alias 在主仓 `tsc` 范围下无法解析 + `noUncheckedIndexedAccess` 触发的 array index 严校验 |
| V0 壳自含 typecheck | 未跑 | 需 `cd src/devboard/game-ui-shell-15 && pnpm tsc --noEmit` 单独执行；属本 Spec 阶段 A 待办 |
| `wakeup-presentation-layer` 复选框 | **0/12 done** | 与代码现实脱节（224 测全绿），属 PT-03 交接项；本 Spec 不代修 |
| V0 壳真接入后端 | **未发生** | `submitShellIntent` 当前直接走 `mockTransportAdapter` 自我闭环 |
| PresentationGateway 装配点 | **不存在** | `src/play/loading-runtime/` 下没有 `presentation-gateway.ts`；本 Spec 需新建 |

### B 级可初步跑起来的范围（不超出本 Spec 即满足）

**包含**：

1. V0 壳 `startup-loading → menu-title → residence-main` 完整跳转。
2. 床 A 入口 → `transition-battle-intro → transition-dream(enter) → hud-main`。
3. HUD 内单回合：移动选 cluster → 提交 `place` 意图 → ORCA 计算路径 → 动画执行 → `after:entity.place` 回到空间投影。
4. `menu-pause` 继续/退出切换。
5. `transition-result → reward → transition-dream(return-home) → residence-main`（结算界面 V0 已有，真实胜负规则由玩法层 `MatchShell` 注入）。
6. ORCA 走 `src/ui/presentation/spatial/algorithms/orca-engine.ts` 纯 TS 骨架；**不引** `rvo2-js` 外部库。
7. 城市地图：新增 `run/v0-assets/maps/city-v1.json`（>= 12 nodes、>= 3 micro-scenes、>= 1 床位、>= 1 驻地区域），作为首次接入的 real MapData。
8. V0 壳控制面板保留全部强制注入能力（`setForcedIntentOutcome` / `setForcedTransportState` / `setForcedAssetOutcome`），并在面板新增"当前接线状态"区域显式标注 `mock` 或 `real`。
9. 失败态闭包：`rejected` / `stale` / `timeout` / `cancelled` / `disconnected` 全部在 V0 壳 UI 可视化，控制面板一键复现。

**不包含（out-of-scope，明确边界）**：

- 联机多人（`TurnHandoffGate` 真实排队）——本 Spec 只做单玩家 fake 队列。
- 拓展玩法（除"移动 + 一次攻击"外）。
- 素材管线**全部**路径（仅允许 V0 壳已有 `mockAssetAdapter` 路径；新增素材资产 out-of-scope）。
- 真实持久化（`ShellStorageClass` 维持 `session-fixture` / `temporary-draft` / `mock-save`）。
- 电脑 UI 真实命令（控制面/电脑 UI 仍为 V0 壳自带 mock）。
- 房间编辑器、研究台、像素绘制器的真实接线（V0 壳范围锁已声明 out-of-scope）。
- 改写 V0 壳视觉层/CSS/动效（仅允许接线层改动，不允许视觉层改动）。
- 改写玩法层/基类层/引擎层以"让接线更简单"。

## 术语表

- **V0 壳 / game-ui-shell-15**：`src/devboard/game-ui-shell-15` 中承载标题、驻地、过场、HUD、暂停、结算、控制面板的视觉前端；Next.js 16 + React 19 + Framer Motion 子项目。
- **真实接线（real wiring）**：`submitShellIntent` 走 `realTransportAdapter` → 命中 `ui/index.ts` 的 `UiSystemPorts` → `InteractionIntent` 经玩法层 `CoreMechanicsFacade.submit` → `OpRegistry.invoke` → `after:*` 事件回流表现层。
- **Mock 接线**：`submitShellIntent` 走 V0 壳自含 `mockTransportAdapter`，自我闭环，**仅用于开发期控制面板强制注入演示**。
- **PresentationGateway**：`src/play/loading-runtime/presentation-gateway.ts` 的整合层装配点，把 `after:*` 语义事件桥接到 `PresentationRuntime.feed()`，并把 `RenderCommand` 暴露给 V0 壳。
- **realTransportAdapter**：`src/devboard/game-ui-shell-15/lib/real-transport-adapter.ts`，实现 V0 壳的 `ShellTransportAdapter` 接口但走 `UiSystemPorts`；与 `mockTransportAdapter` 并存，由 V0 壳接线开关（`?wiring=real|mock` URL 参数或环境变量 `WAKEUP_WIRING_MODE`）决定。
- **接线开关 / wiring mode**：`mock`（默认开发期）/ `real`（首次接入）/ `iter-V0`（上传 V0 迭代期，开发期 mock + 真实意图混合）三种接线模式。
- **V0 迭代回合 / iteration round**：一次"上传 V0 多模态 → 拿到反馈 → 改四类交付物"循环；本 Spec 不限轮数。
- **B 级可跑**：单关完整流程能走通，能看到表现层效果（移动动画、cluster 高亮、地面足迹、失败态闭包），可上传 V0 迭代；不要求视觉精致、不要求全部功能、不要求无瑕疵。

## 要求

### 要求 1：唯一 UI 端点边界

作为接线工程师，我想让 V0 壳只通过 `UiSystemPorts` 与后端通信，以便真实宿主接入时不会维护多套相互冲突的前端事实。

#### 验收标准

1. THE V0 壳 SHALL 通过 `submitShellIntent` 唯一出口提交所有产品意图；该函数 SHALL 接受与 V0 壳现有 `ShellIntentRequest` 形状完全一致的入参（`intentId` / `requestId` / `source` / `target` / `parameters` / `mock` / `safeReturnTarget` / `revision`）。
2. THE V0 壳 SHALL 在 `wiring=real` 或 `wiring=iter-V0` 模式下，调用 `realTransportAdapter.request()` 替代 `mockTransportAdapter.request()`；返回结构 SHALL 与 V0 壳现有 `ShellTransportResult` 完全一致。
3. THE V0 壳 SHALL 在 `wiring=mock` 模式下继续走 V0 壳现有 `mockTransportAdapter`，且 SHALL NOT 删除该 mock；控制面板 SHALL 保留 `setForcedIntentOutcome` / `setForcedTransportState` 强制注入能力。
4. THE `realTransportAdapter` SHALL 不直接 import `src/play/map/**` / `src/play/core-mechanics/**` / `src/l2/**` / `src/core/**`；只通过 `src/ui/index.ts` 的 `UiSystemPorts` 提交 `InteractionIntent` 并读 `ProjectionOutcome`。
5. THE `realTransportAdapter` SHALL 在 `accepted` 之外的所有结果（`rejected` / `stale` / `timeout` / `cancelled` / `disconnected`）上保留 V0 壳的 `safeReturnTarget` 与 `reasonCode`；`safeReturnTarget` 不得被改写。
6. THE V0 壳控制面板 SHALL 新增"当前接线模式"显示位（`mock` / `real` / `iter-V0`），并 SHALL 提供"切换接线模式"开关（仅在 `NODE_ENV !== 'production'` 时可见）；该开关 SHALL 改变下一次 `submitShellIntent` 的路由，不刷新页面。
7. THE 切换接线模式 SHALL NOT 改变 V0 壳的页面 ID、状态机、动效与视觉组件；V0 壳范围锁（`editor` / `research-bench` / `material-library` / `computer` 仅驻地入口占位）维持不变。

### 要求 2：PresentationGateway 整合层装配

作为整合层维护者，我想让整合层有且仅有一个 `PresentationGateway` 装配点，以便 V0 壳、表现层后端、整合层装载运行期之间不存在多条桥路。

#### 验收标准

1. THE `src/play/loading-runtime/presentation-gateway.ts` SHALL 暴露 `createPresentationGateway(deps)` 工厂函数，签名与 `createMatchShell` / `createUiHostPorts` 一致：只接受稳定端口，不接受 React props 或 V0 壳内部形状。
2. THE `PresentationGateway` SHALL 在创建时实例化 `PresentationRuntime`（`src/ui/presentation/spatial/presentation-runtime.ts`，已落地 161 行），传入 `mapData: MapData`（来自整合层 `createLoadedMatch` 的 `mapData`，而非 V0 壳伪造 fixture）。
3. THE `PresentationGateway` SHALL 订阅 `createMatchShell` 暴露的 `after:*` 事件流（`entity.place` / `rule-settled` / `entity.removed` / `micro-scene-occupants-changed`），并 SHALL 调用 `PresentationRuntime.feed(event)` 推进。
4. THE `PresentationGateway` SHALL 暴露 `subscribe(handler)` 给 V0 壳，handler 签名 SHALL 是 V0 壳已声明的 `RenderCommand` 形状（`commandId` / `semanticId` / `sourceRevision` / `targetPageId` / `trigger` / `advancesJourney` / `payload`），不泄漏表现层内部 `GameplayEvent` 类型。
5. THE `PresentationGateway` SHALL 暴露 `getProjection()` 给 V0 壳，返回值 SHALL 是 `SpatialProjection` 形状（layers / nodes / edges / entities / clusters / tiles / revision），不暴露 `OpRegistry` / `WorldStateHolder` 引用。
6. THE `PresentationGateway.dispose()` SHALL 调用 `PresentationRuntime.dispose()` 并取消所有整合层事件订阅，idempotent 二次调用 SHALL NOT throw。
7. THE `PresentationGateway` SHALL NOT 自己持有 `MapData` 真理；`MapData` 由整合层 `createLoadedMatch` 单点传入；表现层任何"地图是 X"的判断 SHALL NOT 走 `PresentationGateway`。

### 要求 3：V0 壳 `realTransportAdapter` 实现

作为前端工程师，我想有 `realTransportAdapter` 可替换 `mockTransportAdapter`，以便 V0 壳在不修改视觉层的前提下切换到真实接线。

#### 验收标准

1. THE `realTransportAdapter` SHALL 满足 V0 壳 `ShellTransportAdapter` 接口（`request` / `cancel`），并 SHALL 在构造时接受 `UiSystem` 引用（来自 `createUiSystem(ports, profile)`）。
2. THE `realTransportAdapter.request()` SHALL 等待 `submitShellIntent` 调用方构造的 `ShellIntentRequest` 转换得到的 `InteractionIntent`，并 SHALL 把 `requestId` / `source` / `target` / `safeReturnTarget` 映射为 `InteractionIntent` 的 `requestId` / `actorRef` / `target` / `safeReturn` 字段。
3. THE `realTransportAdapter.request()` SHALL 把 `UiSystem` 返回的 `SubmissionOutcome` 翻译回 V0 壳 `ShellTransportState`：
   - `accepted` → `accepted`
   - `rejected` → `rejected`
   - `stale` → `stale`
   - `timeout` / `cancelled` → `timeout` / `cancelled`
   - `disconnected` → `disconnected`（这是 `InteractionIntent` 的新结果，本 Spec 引入）
4. THE `realTransportAdapter` SHALL 实现 `cancel(requestId)`，通过 `UiSystem.pendingContracts` 取消未完成 `InteractionIntent`；取消 SHALL 在 200ms 内反映回 V0 壳 UI（基于 V0 壳 `useShellRouter` 的预期）。
5. THE `realTransportAdapter` SHALL 在 `accepted` 之后等待 `PresentationGateway.getProjection()` 反映新修订（`revision` 变化）；若 800ms 内未更新，SHALL 标记 `degraded` 并返回（**新增 outcome**，V0 壳 ShellTransportState 需扩字段，下文要求 9 锁）。
6. THE `realTransportAdapter` SHALL 走 `src/ui/ports/revision-port.ts` 的 `currentSequence()` 做 revision 自增；不会硬编码任何"全局 revision"。

### 要求 4：意图映射与唯一判罚路径

作为玩法层维护者，我想让所有 V0 壳意图都走 `InteractionIntent` 唯一判罚路径，以便不出现"前端调了后端但后端没收到规则变化"的暗故障。

#### 验收标准

1. THE V0 壳全部产品意图 SHALL 通过 `InteractionIntent` 表达；`InteractionIntent` 的 `intentId` SHALL 来自 V0 壳 `submitShellIntent` 的 `intentId`（命名空间保留，例如 `residence.match.start` / `bed.front.ready` / `move.place`）。
2. THE `realTransportAdapter` SHALL 维护一份 `intentId → InteractionIntent 构造器`映射表（位于 `real-transport-adapter.ts` 内部静态数据，未注册 `intentId` SHALL 立即返回 `rejected` + `reasonCode: INTENT_NOT_REGISTERED`）。
3. THE 唯一写入通道 SHALL 仍是 `OpRegistry.invoke`（V0 壳不直接调用）；`realTransportAdapter` SHALL NOT 直接持有 `OpRegistry` / `CoreMechanicsFacade` 引用，仅通过 `UiSystem.interaction.sendIntent()`。
4. THE `realTransportAdapter` SHALL NOT 把 `request.parameters` 整包作为 `InteractionIntent.parameters`；`parameters` SHALL 按 `intentId` 注册的 schema 校验，未知字段 SHALL 被丢弃并记录 `reasonCode: PARAMETER_DROPPED`。
5. THE 玩家可见数值 SHALL 守 1-5；任何 `InteractionIntent.parameters` 中的 `apCost` / `spCost` / `range` / `damage` / `targets` SHALL 在接入处断言，违例 SHALL 返回 `rejected` + `reasonCode: PLAYER_VISIBLE_VALUE_OOR`。

### 要求 5：城市地图与 ORCA 接入

作为地图数据维护者，我想让首张真实接线地图（`city-v1`）走 ORCA 与 V0 壳全部能跑通，以便能拿这张地图去 V0 迭代。

#### 验收标准

1. THE `run/v0-assets/maps/city-v1.json` SHALL 满足 `MapData` schema (`src/play/map/types.ts` 的 `schemaVersion: "2.0"`)；节点数 SHALL `>= 12`、micro-scenes SHALL `>= 3`、床位 SHALL `>= 1`、驻地区域 SHALL `>= 1`、边数 SHALL `>= 14`。
2. THE `city-v1` SHALL 通过 `npm run verify:data` 校验；`scripts/verify-data.mjs` SHALL 报 `city-v1 OK`。
3. THE `city-v1` SHALL 在 `PresentationGateway` 创建时作为 `mapData` 传入，`PresentationRuntime` SHALL 用其节点坐标初始化 `SpatialEntityStore` 与 `ClusterStore`。
4. THE ORCA 接入 SHALL 走 `src/ui/presentation/spatial/algorithms/orca-engine.ts` 纯 TS 骨架；移动意图落地 SHALL 走 `OrcaEngine.step()` 一次推进，**不引** `rvo2-js` 外部库。
5. THE `OrcaEngine` SHALL 接收 `OrcaAgent[]` 来自 `SpatialEntityStore`；每个 agent 的 `preferredVelocity` SHALL 由 `InteractionIntent` 的 `target` 节点坐标减去当前坐标计算；`maxSpeed` SHALL 与 `city-v1` 节点之间的最小边长匹配。
6. THE ORCA 输出（`OrcaStep.newPosition`）SHALL 走 `MoveChoreographer` 生成 `RenderCommand`，不直接修改 `SpatialEntityStore`；entity 位置最终一致性由 `after:entity.place` 事件回流。
7. THE `city-v1` 的"床 A"节点 SHALL 是 `microSceneId` 关联 `presentation:micro-scene-created` 事件的来源；本 Spec 阶段 B 接入时 SHALL 验证 cluster 创建/销毁闭包。

### 要求 6：失败态闭包与控制面板强制注入

作为开发者，我想让 V0 壳控制面板的强制注入能力在真实接线模式下仍然可用，以便我能复现每个失败态。

#### 验收标准

1. THE V0 壳控制面板 SHALL 保留全部 V0 既有强制注入能力：`setForcedIntentOutcome`（accepted/rejected/stale/timeout/cancelled/auto）、`setForcedTransportState`（auto/accepted/rejected/stale/timeout/cancelled）、`setForcedAssetOutcome`（auto/missing/failed/timeout）。
2. THE 控制面板 SHALL 新增"real 模式强制失败"区（在 `wiring=real` 模式下可见），可强制让 `realTransportAdapter` 走：`rejected` / `stale` / `timeout` / `cancelled` / `disconnected` 五种结果，**不需**改 V0 壳的 intent 内容。
3. THE 强制失败 SHALL 走 `realTransportAdapter` 内部 hook（构造时接受 `forcedOutcome?: ForcedTransportState`），不修改 `mockTransportAdapter`。
4. THE 失败态 SHALL 通过 V0 壳 `useShellRouter` 在 200ms 内反映到 UI（基于 `ShellTransportState` → `ShellRouteTransition.state` 已有映射）。
5. THE 任何失败态 SHALL 保留 V0 壳 `fallbackPageId` / `safeReturnTarget`；不得因为"想回到驻地"而由前端自行跳转。
6. THE 控制面板 SHALL 暴露"当前表现层 revision"读数（来自 `realTransportAdapter` 暴露的 `currentRevision: () => number`），让开发者能验证 `after:*` 事件回流确实推进了 revision。

### 要求 7：迭代期改动交付物边界

作为项目维护者，我想明确每次 V0 迭代回合能改什么、不能改什么，以便 V0 多模态反馈能安全回流而不破坏接线契约。

#### 验收标准

1. THE 一次 V0 迭代回合 SHALL 只允许以下四类改动：
   - **A 类**：V0 壳前端代码改动（仅 `src/devboard/game-ui-shell-15/{app,components,hooks,lib}/**`），前提是改动后 V0 壳 `pnpm tsc --noEmit` 通过且视觉/动效不退化。
   - **B 类**：表现层后端 bug 修复（仅 `src/ui/presentation/**`），前提是改动后 `npx vitest run src/ui/presentation` 全绿且不违反 S1 R1-R14 任何条款。
   - **C 类**：城市/测试地图数据新增/修订（仅 `run/v0-assets/maps/city-v1*.json` 与 `test-map-*.json`），前提是 `npm run verify:data` 通过。
   - **D 类**：失败态/动效 recipe 新增（仅 `src/devboard/wiring/presentation-wiring/recipes/**`），前提是该 recipe 在 `realTransportAdapter` 失败闭包测试中被引用。
2. THE 任何超出 A/B/C/D 范围的改动 SHALL 被视为越权，SHALL 在 `.kiro/specs/wakeup-presentation-wiring/execution-report.md` 登记为"越权改动"并说明原因，不得静默合入。
3. THE 一次迭代回合 SHALL NOT 删除 V0 壳已落地的视觉层/CSS/动效；删除 SHALL 走 `wakeup-full-body-wiring` 范围并由 owner 拍板。
4. THE 一次迭代回合 SHALL NOT 改 `src/ui/index.ts` 的 `UiSystemPorts` 形状（新增 port 字段视为 `wakeup-ui-ports-extension` 范围，本 Spec 不开）。
5. THE 一次迭代回合 SHALL NOT 改 `src/play/loading-runtime/{createLoadedMatch,createMatchShell,createUiHostPorts,driveMatch}.ts`；如需新事件/新方法，走 `wakeup-loading-runtime` 后续 Spec 立项。

### 要求 8：环境隔离与 baseline 门禁

作为工程治理者，我想让 V0 壳子项目与主仓 typecheck 隔离清晰，以便本 Spec 阶段 A 的"环境就绪"基线可机械验证。

#### 验收标准

1. THE V0 壳 SHALL 维持独立 `src/devboard/game-ui-shell-15/package.json` + `pnpm-lock.yaml` + `tsconfig.json`；不得把 V0 壳的 `tsconfig.json` 合并到主仓 `tsconfig.json`。
2. THE 主仓 `tsconfig.json` SHALL 把 `src/devboard/game-ui-shell-15/**/*.{ts,tsx}` 显式 `exclude`（除 `lib/real-transport-adapter.ts` 与 `lib/shell-intent.ts` 等需要在主仓范围内编译的文件外）；修改主仓 `tsconfig.json` SHALL 在 `.eslintrc.cjs` 的"配置改动"门禁中显式登记。
3. THE 本 Spec 阶段 A SHALL 新增 npm 脚本 `npm run typecheck:shell`，等价于 `cd src/devboard/game-ui-shell-15 && pnpm install --frozen-lockfile && pnpm tsc --noEmit`；该命令 SHALL 退出码 0 才能进入阶段 B。
4. THE 任何对 V0 壳 `package.json` / `pnpm-lock.yaml` / `tsconfig.json` 的修改 SHALL 重新跑 `npm run typecheck:shell` + `npx tsc --noEmit` 两条命令，保证 baseline 跨环境一致。
5. THE V0 壳自含 typecheck 错误（**当前 7+ 个**：`chroma-key.ts` `@/lib/bitmap-cache` 无法解析、`shell-a11y.ts` `noUncheckedIndexedAccess` 严校验等）SHALL 在阶段 A 内**全部修复**；修复范围限定在 V0 壳 `lib/` 与 `components/` 目录内（不修主仓规则）。
6. THE 阶段 A 完成 SHALL 形成 baseline 报告：主仓 `npx tsc --noEmit` 通过 + V0 壳 `pnpm tsc --noEmit` 通过 + `npx vitest run src/ui/presentation` 全绿 + `npm run verify:data` 全绿。

### 要求 9：V0 壳 `ShellTransportState` 扩展

作为前端工程师，我想在真实接线期把 `disconnected` / `degraded` 两种结果并入 V0 壳 `ShellTransportState`，以便 UI 能区分"链接断"与"提交成功但表现层没回响"。

#### 验收标准

1. THE V0 壳 `ShellTransportState` SHALL 扩字段：`disconnected`、`degraded`；原 `accepted` / `rejected` / `stale` / `timeout` / `cancelled` / `pending` / `reconnecting` 保持不变。
2. THE `degraded` 状态 SHALL 表示"提交已被 `OpRegistry.invoke` 接受，但 `PresentationGateway.getProjection()` 在 800ms 内未反映新 revision"；UI 表现 SHALL 是"已接受但降级"而非"未提交"。
3. THE V0 壳 `TRANSPORT_MESSAGES` SHALL 为 `disconnected` 与 `degraded` 各增加一条**中文** message；`disconnected` 沿用现有 `reconnecting` 文案风格，`degraded` 沿用 `timeout` 文案风格但说明已提交。
4. THE V0 壳 `useShellRouter` SHALL 把 `degraded` 与 `accepted` 区分对待：`degraded` 走 `fallbackPageId` 而非 `targetPageId`；`accepted` 才执行 page swap。
5. THE 控制面板 SHALL 提供 `degraded` 强制注入（仅 `wiring=real` 模式可见），用于复现 800ms 内未刷新的场景。

### 要求 10：审计与三命令门禁

作为审阅者，我想本 Spec 收尾阶段跑通三命令门禁，以便任何一个执行批次都能在仓库层机械验证。

#### 验收标准

1. THE 收尾 SHALL 跑：`npx tsc --noEmit`、`npx vitest run src/ui/presentation`、全量 `npx vitest run`（如修改范围跨域）、`npm run typecheck:shell`、`npm run lint`、`npm run verify:data`、`npm run verify:docs`、`npm run verify:prompt-pack`。
2. THE 阶段 A baseline 报告 SHALL 列出每条命令的实际退出码、耗时与失败行（如有）；未形成 baseline 不得进入阶段 B。
3. THE `PresentationGateway` 装配点 SHALL 至少 5 个单测：创建后 revision=0、接收 `after:entity.place` 后 revision 自增、`dispose()` idempotent、订阅 `RenderCommand` 收到合法命令、`getProjection()` 返回深冻结对象。
4. THE `realTransportAdapter` SHALL 至少 6 个单测：accepted 翻译、rejected 翻译、stale 翻译、timeout 翻译、cancel 路径、unregistered intentId 返回 `INTENT_NOT_REGISTERED`。
5. THE `city-v1.json` SHALL 至少 1 个 schema 合规测试（在 `test/play/map/__tests__/city-v1-schema.test.ts` 或同等位置），断言节点数、micro-scene 数、床位数、驻地区域数下限。
6. THE 失败态闭包 SHALL 至少 3 个端到端属性测试：rejected 不前进、stale 不覆盖新修订、accepted 不等于 route completed；测试注释 SHALL 使用 `[Feature: wakeup-presentation-wiring, Property N: <名>]` 标签。
7. THE 本 Spec 的执行报告（`execution-report.md`）SHALL 列出每条要求的覆盖测试 ID 与最新通过日期；任何要求未覆盖 SHALL 登记交接项。

## 未决项（待 owner 拍板）

- **D-W01**：`PresentationGateway` 是否同时承担"整合层事件出口"和"V0 壳 RenderCommand 出口"两个角色，或拆为两个独立对象（`createEventBridge` + `createRenderCommandSink`）？本 Spec 倾向单对象（要求 2 锁），等 owner 拍板。
- **D-W02**：`realTransportAdapter` 的 revision 自增是否复用 `UiSystemPorts.revision`，还是另起独立序列（V0 壳内部"显示用 revision"）？本 Spec 倾向复用（要求 3 锁），等 owner 拍板。
- **D-W03**：`degraded` 阈值 800ms 是否合理？本 Spec 默认 800ms，可在阶段 B 接入后用 V0 壳控制面板的"超时注入"实测后调整。
- **D-W04**：城市地图的"床 A"是否就是 `transition-battle-intro` 的物理位置（即床的 micro-scene ID 关联 `micro-scene-created` 事件），还是仅做视觉占位？本 Spec 默认前者（要求 5 锁），等 owner 拍板。
- **D-W05**：本 Spec 是否需要在阶段 B 同步开 `wakeup-presentation-wiring-execution` 的子 Spec 跟踪迭代回合？本 Spec 倾向不另开子 Spec，每个回合直接更新本 Spec 的 `execution-report.md`。
