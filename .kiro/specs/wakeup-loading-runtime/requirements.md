# Requirements Document — 整合层装载运行期（专项 wakeup-loading-runtime）

## 简介

本 Spec 是「整合层 / 装载运行期 wakeup-loading-runtime」的生产规格交付物。它承接 `docs/L_归档/工程治理_历史/04_整合层_装载运行期_规划设计.md`（专项切分 B：整合层本体）与 `docs/工程治理/07_整合层本体B_专项prompt.md`，把专项 A（CEME，`wakeup-core-mechanics-exhaustive`）冻结的玩法层一局语义、专项 D（基类层注册表桥 `createRegistryBridge`）交付的 L1↔L2 桥，与已落地的组合根 `createLoadedMatch`、对局外壳 `createMatchShell`、UI 宿主 `createUiHostPorts`、生产加载驱动 `driveMatch`、外壳/UI 事件出口（真实 PresentationGateway）整合成为一个可实施、可机械验证的整合层生产规格。

本 Spec 的性质与边界：

- **纯规格交付**，不写新的业务实现代码；交付物是本目录 `requirements.md` / `design.md` / `tasks.md` 三个文件，加上对既有 `src/play/loading-runtime/` 落地线与契约测试的整合。
- **整合层是"已装载对局"这一运行态的生产面**：它把三层已有的积木（引擎 `OpRegistry`、基类桥 `KernelContract`、玩法 `CoreMechanicsFacade`）按既有稳定端口组装成一台可被玩家/AI/UI/地图生产共同驱动的对局运行时，**不新增规则语义、不引入新的层**（S1：已装载对局是三层依赖链终点，非第四层）。
- **引用权归玩法层**（owner 定型 2026-08-15）：玩法层拥有对基类/引擎能力的引用权，是组合与装载的唯一宿主；整合层是"玩法层能力出口"（组合根 + 对局外壳 + UI 宿主 + 加载驱动），不做任何玩法语义裁决。
- **唯一状态写入通道仍是 `OpRegistry.invoke`**：装载完成后宿主不得持 `WorldStateHolder` 直接改状态，全部经 `CoreMechanicsFacade.submit/resolve/advancePhase/consumePlayerQueue` 或桥产 `KernelContract.invoke`。
- **红线**：整合层不 import `src/ui`、`src/devboard`（UI 经端口注入，见 `ui-host.ts`）；不新造 L1↔L2 桥（专项 D 已交付，本组合根只消费它装进去）；玩家可见数值守 1-5，round 等内部量级例外。

### 层级归属与权威来源

| 代号 | 来源 | 权威用途 |
|---|---|---|
| S0 | `docs/L0_规范宪法.md` | 最高权威：三层边界、玩家可见数值 1-5、唯一写入通道、正交域（D-067~D-070）、已装载对局非第四层 |
| S1 | `docs/00_架构域与文档分类.md` | 严格三层、正交域、引用权归玩法层 |
| S2 | `docs/L_归档/工程治理_历史/04_整合层_装载运行期_规划设计.md` | 本专项统筹规划（已完成使命归档）：面貌（组合根+六接线面）、专项切分、Q-1~Q-6 裁决、阶段路径、收账项 |
| S3 | `docs/工程治理/07_整合层本体B_专项prompt.md` | 专项 B 的领域规约与交付物清单（组合根/对局外壳/UI 宿主） |
| S4 | `docs/工程治理/05_玩法层彻查CEME_立项轮廓.md` | 专项 A（CEME）方针：七项缺漏 C-1~C-7、边界、交付物 |
| S5 | `.kiro/specs/wakeup-core-mechanics-exhaustive/{requirements,design,tasks}.md` | 专项 A（CEME）冻结交付：Requirement 20~31、结局种类、终局判定、参与者资格、round 计数、胜负结算、AI 接入、OVERLOAD_GAP 归属 |
| S6 | `docs/工程治理/06_基类层注册表桥_专项prompt.md` + `src/l2/kernel/registry-bridge.ts` | 专项 D（基类层注册表桥）交付：`createRegistryBridge` → `KernelContract` + 只读 Def 视图 |
| S7 | `src/play/loading-runtime/{index,match-shell,ui-host,drive,types}.ts` + `test/play/loading-runtime/*` | 本专项已落地的实现与契约测试（阶段1/阶段2） |
| S8 | `src/play/core-mechanics/{load,match-lifecycle,projection}.ts`、`src/play/ai-runtime.ts`、`src/play/map/compile.ts`、`src/core/kernel/gateway.ts`、`src/l2/kernel/registry-bridge.ts` | 整合层消费的既有稳定端口（只读参考） |

### 与专项 A / 专项 D 的关系

- 专项 A（CEME，S5）定义了一局语义的**玩法层承载面**（结局种类、终局判定字段、round 计数、参与者自动注册、出生起点、胜负结算、AI 同判罚路径、OVERLOAD 归属）。专项 B（本 Spec）**消费这些承载面**：组合根用 `initializeMatchFields`/`assembleMatchStart` 落出生与参与者，对局外壳 `createMatchShell` 读 `TerminalQuery`（`match-lifecycle.ts`）做终局/胜负/ended 判定。专项 A 不在整合层内实现（Requirement 21.1 转本 Spec Requirement 34 边界）。
- 专项 D（基类层注册表桥，S6）交付了 `createRegistryBridge`；本 Spec 的组合根**只消费它装进去**（桥产 `kernel`/`defs` 注入 UI 宿主与 submitter），不新造桥、不改桥形状。

未完成项定位：步骤 6「收账」原是专项 B 完成表内的剩余待办（OVERLOAD_GAP 归属、ui-adapter 处置、主状态板入账、04 文档归档）。本 Spec 在 `requirements.md` / `tasks.md` 中把收账作为不可委托的实现任务一并纳入，使整合层从"落地代码"升格为"有正式 spec 可追溯的规格"。

---

## 术语表

- **整合层 / loading-runtime**：玩法层之下的"已装载对局"生产面——生产组合根 + 对局外壳 + UI 宿主 + 生产加载驱动 + 事件出口。专著名 `src/play/loading-runtime/`（S2 Q-1 已按此执行）。
- **组合根（Composition Root）**：`createLoadedMatch(request)`，一次性把引擎/玩法/AI/UI/地图/桥组装成单一 `LoadedMatch` 不变量对象；只有装载期一次性的组装权。
- **已装载对局（LoadedMatch）**：`createLoadedMatch` 的产物，三层依赖链终点。对外暴露只读门面 + 授权提交通道 + 事件订阅 + 外壳控制 + 生产驱动；唯一写通道是 `CoreMechanicsFacade.submit`（经 `OpRegistry.invoke`）。
- **对局外壳（MatchShell）**：`createMatchShell` 产物，一局的量级容器——round+phase、终局判定、胜负结算、ended、拒绝提交。只读消费玩法层 `TerminalQuery`，不新增规则语义。
- **生产加载驱动（driveMatch）**：`driveMatch(match, options)`，在宿主/运营/对局循环里推进五阶段、消费玩家行动队列、喂 NPC 决策、读到终局即停的生产副作用封装。
- **事件出口（PresentationGateway）**：整合层经 `engine.gateway`（真实 `PresentationGateway` 实例，只读 surface，从不暴露写通道）对外广播 `match.round`/`match.ended` 语义事件；`matchEnd` 是**单次语义**（`matchEndDelivered` 去重）。
- **终端查询（TerminalQuery）**：玩法层 `match-lifecycle.ts` 的只读 `matchEnded()/matchEndDetail()/round()`，外壳据此判定一局是否结束。
- **桥（RegistryBridge）**：专项 D 交付的 `createRegistryBridge` 产物——真实 `OpRegistry`/`DefRegistry` → `KernelContract` + 只读 Def 视图。整合层消费其 `kernel` 包裹 action-submitter。
- **同判罚路径**：UI / AI / 玩家对同一动作请求得到同一合法性判定与同一拒绝原因；`CoreMechanicsFacade.submit` 无来源参数，类型层面防绕过。
- **内部量级**：回合号（round）、实体数、循环圈数、npcNumber 等不属于 1-5 玩家可见刻度的量；必须归属 `internal`、投影禁止展示。
- **事件单次语义**：`matchEnd` 只在第一次到达时对外广播，闭合后不再重复（外壳 `endedBroadcast` + 组合根 `matchEndDelivered` 双层去重）。

---

## Requirements

### Requirement 32: 生产组合根装载（createLoadedMatch）

**User Story:** 作为对局运行的宿主，我希望用生产 config 经一次调用把整个三层对局运行时装配成一个不变量对象，以便把我面对的运行态作为一个可查询、可驱动单元。

#### 验收标准

32.1. 系统 SHALL 提供生产组合根 `createLoadedMatch(request: LoadMatchRequest): LoadedMatchResult`，输入含 `config` / `playerEntityIds` / `scheduleId` / `seedDefs` 与其他可选装载输入（`initialWorld` / `map` / `npcBudget` / `profile`）。

32.2. WHEN 装载请求所有必填输入合法，THEN 系统 SHALL 返回 `{ok:true, match}`，其中 `match.engine.registry` / `defRegistry` / `ruleProvider` / `exprEngine` / `queryEngine` / `actionCatalog` / `playpackLoader` / `playpackActivator` 是真实引擎实例（`load.ok === true` 且 `projection` 非空、`outcomes` 为非空守恒集）。

32.3. WHERE 生产 config 与测试组合根 `createFullHarness`，THEN 系统 SHALL 保持二者 Op/Hook/Holder 装配**字节级一致**（Q-4）：`createLoadedMatch(...).engine.registry.listOpNames()` 与 `createFullHarness().registry.listOpNames()` 全等，不得出现生产/测试两套装配分叉。

32.4. WHEN 装载被门禁阻塞（config 非法、实体缺失、地图 spawn 失败、AI seed 失败），THEN 系统 SHALL 返回 `{ok:false, diagnostics, blocked}` 且**不返回半可用对象**（`match` 不存在，装载失败的任一步不留下部分初始化的状态）。

32.5. WHERE 提供 `initialWorld`，THEN 系统 SHALL 在 `loadCoreMechanics` 之前把预置世界合入装载 holder（实体/节点/容器/链接/物品/agent/资源池以预置为准，turn/decisions/log 等元数据保留），装载写入在其上叠加；`holder.setState` 只在本函数装载前置数据落地使用一次。

32.6. 系统 SHALL 使装载完成后对外暴露的**唯一写通道**是 `match.facade`（→ `OpRegistry.invoke`）；`match` 不暴露任何可写 holder，宿主不得持 `WorldStateHolder` 直接改状态。

32.7. 系统 SHALL 消费既有 MapData 契约把地图装进 world：`compileMap(map)` → `PrefabDef` 注册 → `prefab.spawn` 入 world（节点以 prefab 分配编号落地）；MapData `floor→layers` 契约扩展是独立专项，本组合根不代做。

**来源追踪：** S2 §2.1（组合根）、§五 Q-4（装配字节级一致）、§1.2（唯一写通道）；S3 交付物 1/4；S7 `index.ts:98`、`create-loaded-match.contract.test.ts`。

### Requirement 33: 门禁面（装载期体面）

**User Story:** 作为门禁守门人，我希望装载用生产 config 而非测试 config，使 `blocked` 只反映真实未冻结项，以在装载期尽早暴露不可用能力。

#### 验收标准

33.1. 系统 SHALL 用生产 `CoreMechanicsConfig`（非 `official-state-machine-config.ts` 测试专用 config）调 `loadCoreMechanics` 8 步；生产 config 属玩法层（Q-3），整合层只注入、不持有默认值。

33.2. WHEN 装载返回，THEN 系统 SHALL 把 `blocked` 收敛为只含未冻结项：已冻结项（如 `standard-random-roll`、`power-die-settlement`、`play-event-pipeline-integration`）不得出现在 `blocked`；当前只允许登记 `firearm-base-damage-table` 这类尚未冻结的伤害表。

33.3. WHEN `loadCoreMechanics` 返回`ok:false` 或 `projection === null`，THEN 系统 SHALL 中止装配并返回 `{ok:false}`，不继续写后续字段、不返回半可用对象。

33.4. 系统 SHALL 在装载期落一局世界的初始量级：`initializeMatchFields` 用 `prop.set`（经 `OpRegistry.invoke`）写入 `matchEnded=false` / `round=0` / `spawnComplete=false`；round 归属 `internal`。

**来源追踪：** S2 §三（门禁对齐）、§1.3（装载期门禁）、Q-3；S7 `index.ts:115-134`、`create-loaded-match.contract.test.ts`（门禁体面）。

### Requirement 34: 边界——消费承载面而非重写

**User Story:** 作为整合层与本 Spec 的维护者，我希望整合层只消费专项 A / 专项 D 冻结的承载面，以保证不越权、不双份实现、不倒挂依赖。

#### 验收标准

34.1. 系统 SHALL NOT 指定或实现专项 A（CEME）范围的一局语义来源：结局种类声明、round 计数、胜负结算、参与者自动注册、出生起点、OVERLOAD 归属（S5 Requirement 20~28）——整合层只消费它们（`initializeMatchFields`/`assembleMatchStart`/`TerminalQuery`）。

34.2. 系统 SHALL NOT 指定或实现 L1↔L2 注册表桥、任何 L2 适配器接线或基类层契约（S6 专项 D）：组合根只调用 `createRegistryBridge` 的既有出口（`kernel`/`defs`），不新造桥。

34.3. 系统 SHALL NOT import `src/ui`、`src/devboard`；UI 经端口注入（`createUiHostPorts` → `createUiSystem`），表现/创作/运营侧不得被拉进已装载对局权威（D-067~D-070 正交域纪律）。

34.4. 系统 SHOULD 用测试断言"整合层尚未绑定到未冻结依赖"（零耦合守卫）：不提前把正交域或未冻结契约拉进运行时。

34.5. 每条边界（34.1~34.4）THEN 均应有一条对应 `*contract*` 断言面，断言"该接线确实数据通、方向对、无越权写"。

**来源追踪：** S2 §1.2/§2.2（严格边界、引用权）、§五 Q-4/Q-5；S5 Requirement 21（边界交接）；S7 `index.ts` 头注释、`ui-host.ts:16-18`。

### Requirement 35: 对局外壳（MatchShell）与终结语义

**User Story:** 作为把"规则流养成为一局"的载体设计者，我希望外壳能读玩法层终局做结束/胜负/拒绝判定，并对外单次广播终局事件。

#### 验收标准

35.1. 系统 SHALL 提供对局外壳 `createMatchShell(deps)`，它以 `round` / `phase` / `ended` / `outcome` 四个只读 getter 暴露一局状态，每次读都重查玩法层 `TerminalQuery`（轮询式终局判定）。

35.2. WHEN `deps.terminal.matchEnded()` 首次为真，THEN 系统 SHALL 单次向外壳事件订阅者广播 `{type:'matchEnd', outcome, detail}`；`endedBroadcast` 保证闭合后不再重复广播（**终局事件单次语义**）。

35.3. WHEN 一局已终局（`ended`），THEN 系统 SHALL 使 `submitGuard()` 返回 `{ok:false, code:'E_OP_NOT_ACCEPTED'}`，拒绝一切新的提交；终局前 `submitGuard()` 返回 `{ok:true}`。

35.4. 系统 SHALL 使 `round` 只读消费玩法层 round（cleanup→roll 回绕经玩法层 +1，外壳不自行改写）；`round` 归属 `internal`，投影禁止展示。

35.5. 系统 SHALL 提供 `check()` 自检，登记不变量违例（round 回退、相位变更、终局发生在 round 0、玩家行动队列非空）。

35.6. 系统 SHALL 经组合根把外壳 `round` 变更广播为 `gateway.dispatch('match.round', …)`、终局广播为 `gateway.dispatch('match.ended', …)`；组合根本地以 `matchEndDelivered` 对 `matchEnd` 事件二次去重（外壳 relay 与 `broadcastShell` 双路径不重复投递）。

**来源追踪：** S2 §2.4（对局外壳，单次语义）、§一1.2（round 内部量）；S7 `match-shell.ts:30`、`index.ts:360-388`、事件契约测试。

### Requirement 36: 加载驱动（生产端到端 driveMatch）

**User Story:** 作为对局循环的宿主，我希望有生产驱动把已装载对局推进成一局（或到达上限），使五阶段端到端不再散在测试侧。

#### 验收标准

36.1. 系统 SHALL 提供生产驱动 `driveMatch(match, options): DriveResult`，反复读相位 → 消费玩家行动队列 / 喂 NPC 决策 → `advance`，返回推进步数/是否终局/是否被 cap/当前 round 与 phase、终局详情。

36.2. WHEN 到达 `playerAction` 相位且 `autoConsume` 开启，THEN 系统 SHALL 先经 `match.control.drainPlayerQueue()`（生产 drain 入口，复用 CEME `consumePlayerQueue`）清空执行队列，再 advance——不靠外部手动清队列即可离开玩家行动阶段。

36.3. WHERE 有 AI runtime（`npcBudget` 提供、`match.ai !== null`）且处于 `npcAction` 相位，THEN 系统 SHALL 反复调 `match.ai.popNextNpc()` 喂队列头决策直到队列空，队列清空后再推进。

36.4. WHEN `match.shell.ended` 为真，THEN 系统 SHALL 以 `ended:true` 返回、不再推进、不再接受提交（终局后驱动停止）。

36.5. WHEN 推进被守卫/队列约束拒绝，THEN 系统 SHALL 如实返回（不遮蔽、不吞错），标记 `capped` 或返回当前相位。

36.6. WHEN 推进步数达到 `maxSteps`（缺省 200），THEN 系统 SHALL 以 `capped:true` 返回（防无限循环）；`maxSteps` 可被调用方配置。

**来源追踪：** S2 §2.4 "剩余白盒最后一公里"（五阶段端到端生产加载驱动）；S7 `drive.ts:51`、`drive.e2e.test.ts`。

### Requirement 37: 演员面（玩家入口 + AI 入口）

**User Story:** 作为对局运行的演员管理者，我希望玩家在装载期自动成为参与者，AI 受控实体接入同一 holder/registry，使玩家与 AI 走同一判罚路径。

#### 验收标准

37.1. 系统 SHALL 用 `initializeMatchFields` + `assembleMatchStart({registry, holder, playerEntityIds})` 在装载期落出生与参与者注册：玩家实体获得/保留 `play:roll-participant` 标记、`rollTier` 与 `vitality`（玩家可见 1-5）、体力池可用值（非空时写满 5）；NPC（带 `play:npc`）不得走玩家出生路径（CEME C-2/C-4）。

37.2. WHERE 提供 `npcBudget`，THEN 系统 SHALL 用 `createPlayAiRuntime({scheduleId, npcBudget, seedDefs})` 接入 AI：NPC 实体以稳定编号落地到主 holder、AI agent 登记进 `world.agents`、NPC 队列经 `seedNpcQueue` 投影回主 holder（`prop.set` 经 OpRegistry）。

37.3. 系统 SHALL NOT 让 AI 或外部宿主拥有玩法层权威写权：AI runtime 自持的独立 holder 只作决策环的仿真快照源，不参与主世界写入；主世界写入经 `CoreMechanicsFacade.submit` / `OpRegistry.invoke`。

37.4. AI 决策、UI 提交、玩家提交三者经 `CoreMechanicsFacade.submit` 同一判罚路径：`submit` 无来源参数，UI 经桥产 `submitter.submitAction`（专项 D 承接链），同一动作请求得到同一判定与同一拒绝原因。

37.5. 系统 SHALL 提供契约断言：AI runtime 消费装载后，AI 请求与玩家请求对同一动作得到相同合法性判定（`*contract*` 断言面 + PBT 属性见 design 属性 7）。

**来源追踪：** S2 §2.7（演员面）、§1.3（AI 未接 loadCoreMechanics/advancePhase 的历史缺口）；S7 `index.ts:137-225`、`create-loaded-match.contract.test.ts` 演员面用例；S5 Requirement 24/27。

### Requirement 38: UI 宿主（7 端口接线）

**User Story:** 作为表现系统消费者，我希望 UI 经七端口只读语义投影、只发意图，且不持任何状态写入权。

#### 验收标准

38.1. 系统 SHALL 提供 `createUiHostPorts(deps)` 把 `UiSystemPorts` 七端口绑定到真实 holder/actionCatalog/facade/桥能力：`projection`（只读语义投影）、`events`（PresentationGateway `subscribe('*')` 收窄）、`actionQuery`（玩法层 `queryActions` 'ui' 全展开）、`revision`（`world.logSeq` 单调 + 语义指纹）、`actions`（sendIntent → 桥产 KernelContract 包裹的 action-submitter）、`pendingContracts`（不可用能力显式 `pendingConvergence`，不猜测不默认）、`diagnostics`。

38.2. WHEN 注入 `PresentationProfile`，THEN 系统 SHALL 用 `createUiSystem(ports, profile)` 装配 `match.ui`；未注入 profile 时 `match.ui === null`。

38.3. 系统 SHALL NOT 在 `src/ui`/`src/devboard` 目录内出现 `OpRegistry` / `WorldStateHolder` 标识符；宿主侧 `ui-host.ts` 可持有这些句柄，但不得把它们暴露进端口。

38.4. 系统 SHALL NOT 让 UI 拥有玩法层权威写权：`actions` 端口经桥产 `submitter`/`l2Submit`（→ `OpRegistry.invoke`）提交，UI 只发意图，不做裁决。

38.5. 系统 SHALL 使 `pendingContracts` 对不可用能力（如 `safeUnavailabilityReasonKey`、`visibleScenes`、`visibleContainers`、AI 说明）显式 `pendingConvergence`，不返回虚假可用值。

**来源追踪：** S2 §2.3（UI 面 7 端口绑定）、§2.3 承接链（桥产 submitter）；S7 `ui-host.ts:144`、`loaded-match.ports.contract.test.ts`（UI 宿主 7 端口）。

### Requirement 39: 组合根返回门面（LoadedMatch）

**User Story:** 作为宿主与运营消费者，我希望已装载对局以单一只读门面暴露所有面向，并明确哪些是可写、哪些是只读。

#### 验收标准

39.1. 系统 SHALL 使 `LoadedMatch` 暴露：`engine`（10 端口 + 真实只读 `gateway`）、`load`、`runtime`、`facade`、`projection`、`shell`、`terminal`、`ai`、`bridge`、`submitter`、`events`、`ui`、`control`、`getWorldState`。

39.2. 系统 SHALL 使 `engine.gateway` 是真实 `PresentationGateway` 实例（只读 surface：`subscribe`/`query`/`queryActions`，从不暴露 registry/tx/写通道），供表现层订阅语义事件与只读查询。

39.3. 系统 SHALL 使 `events.subscribe(handler)` 把外壳 `round`/`matchEnd` 事件转给订阅者（`MATCH_SHELL_EVENT`，`matchEnd` 单次语义经 `deliver` 去重）。

39.4. 系统 SHALL 使 `control` 暴露 `advance()`（推进一回合阶段，终局后拒绝）、`drainPlayerQueue()`（清空玩家行动队列）、`broadcast()`（手动触发一次外壳 round/matchEnd 语义事件广播）。

39.5. 系统 SHALL 使 `getWorldState()` 返回当前世界状态的**只读投影**供宿主/运营只读消费；宿主对状态的任何变更一律经 `facade`。

**来源追踪：** S3 交付物 1/4；S7 `types.ts:79`、`index.ts:440-467`。

### Requirement 40: 事件出口单次语义与只读无副作用

**User Story:** 作为表现层订阅者，我希望对外事件具有单次与只读语义，使订阅方不会因重复投递或副作用而收到错误信号。

#### 验收标准

40.1. 系统 SHALL 使 `matchEnd` 事件只在第一次出现时对外投递：外壳 `endedBroadcast` + 组合根 `matchEndDelivered` 双层去重，两条投递路径（`shellEventRelay` 与 `broadcastShell`）不重复向订阅者/ gateway 投 `matchEnd`。

40.2. 系统 SHALL 使 `gateway.dispatch('match.round'/'match.ended', …)` 只在 round 变更 / 终局时调用；round 未变更不重复广播 `match.round`。

40.3. 系统 SHALL 保证 `gateway.query` / `gateway.queryActions` 纯读无副作用：调用不触发任何写入（registry 状态无变化、不增加 Op）。

40.4. 系统 SHALL 保证对外事件出口不成为写通道：`PresentationGateway` 从不持 registry/tx/写通道，UI/AI 对事件仅订阅消费、不改状态。

**来源追踪：** S2 §2.4（事件出口单次语义）、§1.2（唯一写通道）；S7 `event-gateway.contract.test.ts`、`gateway.ts:9`。

### Requirement 41: 门禁对齐与自证 / 交接可区分

**User Story:** 作为质量工程师，我希望整合层 spec 的全部实现与测试通过既定门禁，并区分可自证与交接项。

#### 验收标准

41.1. 本 Spec 实现与测试的收尾门禁对齐：`npx tsc --noEmit`（全域 0 err）、`npx vitest run`（相关范围）、`npm run lint`、`npm run verify:docs`。

41.2. **已自证（Requirement 320.2）**：本整合层已落地的契约测试/PBT（组合根、端口、事件出口、加载驱动）均可在 `src/play/loading-runtime/` + 既有测试夹具内闭环验证，不依赖正交域。

41.3. **不可自证 / 交接（Requirement 320.3）**：本 Spec 凡判为"留给具体模式/下游"的项——specific 模式的胜负平衡、出生具体落点与数值、MapData `floor→layers` 契约扩展具体形态、素材库元状态层、可用性钩子真逻辑——应在收尾综述与 tasks 的交接项中如实列明，不得谎报完成。

41.4. 每条 `*contract*` 断言面对应至少一条 PBT（fast-check，标记 `Feature: wakeup-loading-runtime, Property N: …`；本项目契约用例可 ≥100 次迭代，落 PBT 处 ≥100）。

41.5. 系统 SHALL 在收尾时完成收账：OVERLOAD_GAP 归属随 CEME（S5 Requirement 28）结算登记、legacy `src/l2/adapters/ui-adapter.ts` 处置登记、04 规划文档归档到 `docs/L_归档`、主状态板整合层条目更新为已落地 + spec 落账。

**来源追踪：** S2 §六（收账项）、§三（门禁对齐）；S5 Requirement 30.5（收账并入主状态板）；S7 契约测试。

---

## 未冻结契约（本 Spec 的边界重申）

本 Spec 定义的是整合层**已落地 + 待完整规格化**的生产承载：组合根、对局外壳、UI 宿主、生产加载驱动、事件出口、收账。以下内容**仍属未冻结/下游承接**，本 Spec 不默认化：

- 具体模式的胜负规则、`victoryCondition` 判据、出生具体落点与五角色出生数值（专项 A Requirement 20.13/21.4 与具体模式）。
- MapData `floor→layers` 契约扩展的具体形态（任意 `height?:number`、`opacity` 公式、跨层可见性）——独立专项。
- 素材库元状态层、可用性钩子的真逻辑（现全放行桩；`ui-host.ts` 对不可用能力已 `pendingConvergence`，消费方按其处理）。
- specific 玩法模式 consume 本整合层契约后定义的具体行为（如把 `victoryCondition` 映射到某 `OutcomeDef`）。
