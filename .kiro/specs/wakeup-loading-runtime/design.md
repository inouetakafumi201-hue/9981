# Design Document — 整合层装载运行期（专项 wakeup-loading-runtime）

## 概述

本设计文档把 `requirements.md`（Requirement 32~41）转成可实施、可机械验证的整合层生产规格。它把已落地的组合根 `createLoadedMatch`、对局外壳 `createMatchShell`、UI 宿主 `createUiHostPorts`、生产加载驱动 `driveMatch`、事件出口（真实 PresentationGateway）与收账项整合为一份完整设计。

关键立场（沿 S2 04 规划文档与 S3 07 prompt）：

- 整合层是**组合者**，不是定义者：只消费引擎层已登记原语（`OpRegistry.invoke`、`schedule.advance`、`prop.set` 等）、基类层桥（`KernelContract`）、玩法层承载面（`TerminalQuery`、`CoreMechanicsFacade`、`assembleMatchStart`），不重新定义它们。
- **唯一写入通道仍是 `OpRegistry.invoke`**（经 `CoreMechanicsFacade` 或桥产 `kernel.invoke`）。任何"宿主直接改 WorldState"都是越权。
- **引用权归玩法层**：整合层是"玩法层能力出口"，不做玩法语义裁决。
- **数值铁律**：玩家可见 1-5；round / npcNumber / 循环圈数等内部量级例外，归属 `internal`、投影禁止展示。
- **事件单次语义**：`matchEnd` 双层去重（外壳 `endedBroadcast` + 组合根 `matchEndDelivered`），闭合后不再重复广播。

### 与专项 A / 专项 D 的边界

| 块 | 归属 | 本设计对待方式 |
|---|---|---|
| 结局种类声明、终局判定字段、round 计数、参与者自动注册、出生起点、胜负结算、OVERLOAD 归属 | 专项 A（CEME，S5） | 只消费其承载面（`initializeMatchFields`/`assembleMatchStart`/`TerminalQuery`/`readTerminal`） |
| L1↔L2 注册表桥（`OpRegistry/DefRegistry` ↔ `ActiveRegistry/KernelContract`） | 专项 D（基类层，S6） | 只消费 `createRegistryBridge` 的 `kernel`/`defs` 出口，不新造桥 |
| 具体模式胜负平衡 / `victoryCondition` / 出生具体落点 / 五角色出生数值 | 下游（具体玩法模式） | 不默认化，只留承载面 |
| MapData `floor→layers` 契约扩展 | 独立专项 | 登记为衔接项，本设计只消费现有契约 |
| 素材库元状态层、可用性钩子真逻辑 | 正交域 | 登记为衔接项；UI 宿主对不可用能力已 `pendingConvergence` |

---

## 架构

整合层运行时骨架（虚线框为消费侧，非本设计实现）：

```
                             整合层（本设计实现区）
        ┌──────────────────────────────────────────────────────────────────────────────┐
  引擎层 │  createLoadedMatch(request)                                                   │
  Op     │    ├─ 引擎面：createFullHarness 能力子集（Op/Hook/Holder 字节级一致）            │
  `prop.set`│    ├─ 门禁面：loadCoreMechanics 8 步（生产 config）                          │
  `schedule.advance`│    ├─ 装载期世界配置：initializeMatchFields（matchEnded/round/spawnComplete）│
  `outcome.reach`│    ├─ 出生+参与者注册：assembleMatchStart（CEME C-2/C-4）                  │
  `prefab.spawn`│    ├─ 地图面：compileMap → PrefabDef → prefab.spawn                       │
        │    ├─ 演员面：createPlayAiRuntime（NPC 队列 seed + agent 登记）                  │
        │    ├─ 桥面：createRegistryBridge（专项 D）→ kernel + defs                       │
        │    ├─ 事件面：PresentationGateway（只读 surface + dispatch）                     │
        │    └─ UI 面：createUiHostPorts → createUiSystem（7 端口）                        │
        │                                                                                │
        │  LoadedMatch（单一不变量门面）                                                     │
        │    ├─ engine（10 端口 + gateway）                                                │
        │    ├─ facade（CoreMechanicsFacade，唯一写通道）                                   │
        │    ├─ shell（MatchShell：round/phase/ended/outcome/单次事件）                     │
        │    ├─ control（advance/drainPlayerQueue/broadcast）                              │
        │    ├─ events（外壳事件订阅，matchEnd 单次去重）                                    │
        │    ├─ ai（PlayAiRuntime | null）                                                │
        │    ├─ ui（UiSystem | null）                                                     │
        │    └─ bridge/submitter（桥产 KernelContract + action-submitter）                 │
        │                                                                                │
        │  driveMatch(match, options)                                                      │
        │    ├─ 五阶段松弛顺序：roll→settle→playerAction(drain)→npcAction(AI)→cleanup→回绕   │
        │    ├─ playerAction 自动 drain（consumePlayerQueue）                               │
        │    ├─ npcAction 喂 AI（popNextNpc）                                              │
        │    └─ 终局/步数上限 → 返回 DriveResult                                           │
        └──────────────────────────────────────────────────────────────────────────────┘
                                                                                        
  专项A（CEME）消费侧：TerminalQuery / initializeMatchFields / assembleMatchStart
  专项D（桥）消费侧：createRegistryBridge → kernel.invoke / defs.resolve
```

**架构原则**

1. **解耦优先、基层长远**：整合层只消费稳定端口（引擎 Op、玩法 `TerminalQuery`、桥 `KernelContract`），不写进个别 phase 守卫内做副作用终结。
2. **单一权威**：整合层内不得出现两处自称权威的装载/事件/驱动实现；组合根是唯一装载入口，`driveMatch` 是唯一生产驱动。
3. **零耦合守卫**：用测试断言"整合层尚未绑定到未冻结依赖"（不提前把正交域或未冻结契约拉进运行时）。
4. **装配一致性**：生产组合根与 `createFullHarness` 的 Op/Hook/Holder 装配字节级一致（Q-4），不得分叉。

---

## 组件与接口

### 组件 A：生产组合根（Requirement 32 / 33 / 39）

- **输入**：`LoadMatchRequest`（`config` / `playerEntityIds` / `scheduleId` / `seedDefs` / 可选 `initialWorld` / `map` / `npcBudget` / `profile`）。
- **输出**：`LoadedMatchResult`（`{ok:true, match}` 或 `{ok:false, diagnostics, blocked}`）。
- **接口**：
  - `createLoadedMatch(request)` → `LoadedMatchResult`（`src/play/loading-runtime/index.ts:98`）。
  - 引擎面：`createFullHarness` 能力子集（同一套 `registerXxxOps` + `wireHooksIntoRegistry` 装配，与测试组合根字节级一致）。
  - 门禁面：生产 `CoreMechanicsConfig` 调 `loadCoreMechanics` 8 步，失败不返回半可用对象。
  - 装载期世界配置：`initializeMatchFields(registry)` 写 `matchEnded=false` / `round=0` / `spawnComplete=false`。
  - 出生+参与者注册：`assembleMatchStart({registry, holder, playerEntityIds})`。
  - 地图面：`compileMap(map)` → `PrefabDef` 注册 → `prefab.spawn`。
  - 演员面：`createPlayAiRuntime({scheduleId, npcBudget, seedDefs})` + NPC 队列投影回主 holder。
  - 桥面：`createRegistryBridge({opRegistry, defRegistry, runtimeState, …})` → `kernel` + `defs`。
  - 事件面：`new PresentationGateway({getState, queryEngine, exprEngine, actionCatalog, …})`。
  - UI 面：`createUiHostPorts(deps)` → `createUiSystem(ports, profile)`。
- **证伪回路**：若不做 `initializeFields` → 一局无初始 round/matchEnded 字段（被专项 B 阻塞）。若 `assembleMatchStart` 失败不原子拒绝 → 半初始化对局可被返回（Requirement 32.4）。

### 组件 B：对局外壳（Requirement 35）

- **输入**：`WorldStateHolder` + `TerminalQuery`（玩法层只读终局查询）。
- **输出**：`MatchShell`（`round` / `phase` / `ended` / `outcome` / `events` / `submitGuard` / `check`）。
- **接口**：
  - `createMatchShell({holder, terminal})` → `MatchShell`（`match-shell.ts:30`）。
  - 轮询式终局判定：每次读 getter 都重查 `terminal.matchEnded()`；首次为真时单次广播 `matchEnd`（`endedBroadcast` 保证单次）。
  - `submitGuard()`：终局后返回 `E_OP_NOT_ACCEPTED`。
  - `check()`：自检不变量（round 回退、相位变更、终局 round 0、队列非空）。
- **证伪回路**：若不做 `endedBroadcast` → 终局事件重复广播（Requirement 35.2）。若 `submitGuard` 终局后不拒绝 → 终局后仍可提交（Requirement 35.3）。

### 组件 C：生产加载驱动（Requirement 36）

- **输入**：`LoadedMatch` + `DriveOptions`（`maxSteps` / `autoConsume`）。
- **输出**：`DriveResult`（`steps` / `ended` / `capped` / `round` / `phase` / `outcome`）。
- **接口**：
  - `driveMatch(match, options)` → `DriveResult`（`drive.ts:51`）。
  - 五阶段松弛顺序：反复读相位 → 若 `playerAction` 且 `autoConsume` 则 `drainPlayerQueue` → 若 `npcAction` 且 `ai !== null` 则 `popNextNpc` 喂决策 → `advance`。
  - 终局后以 `ended:true` 返回、不再推进；步数达 `maxSteps` 以 `capped:true` 返回。
- **证伪回路**：若不做 `autoConsume` → 玩家行动队列非空时 advance 被守卫拒绝，驱动卡死在 playerAction（Requirement 36.2）。若终局后仍 advance → 违反终局语义（Requirement 36.4）。

### 组件 D：事件出口（Requirement 40）

- **输入**：`PresentationGateway`（只读 surface）+ 外壳 `broadcastShell` + 组合根 `deliver`。
- **输出**：对外事件广播（`match.round` / `match.ended`）+ 外壳事件订阅。
- **接口**：
  - `gateway.dispatch('match.round', {round, phase})`：round 变更时广播。
  - `gateway.dispatch('match.ended', {outcome})`：终局时广播。
  - `deliver(event)`：`matchEnd` 经 `matchEndDelivered` 去重后投递给 `eventListeners`。
  - `shellEventRelay`：外壳事件 relay 到 `deliver`（与 `broadcastShell` 双路径不重复投递）。
- **证伪回路**：若不做 `matchEndDelivered` → 两条投递路径（relay + broadcast）各投一次 `matchEnd`（Requirement 40.1）。若 gateway 持写通道 → 违反只读 surface 契约（Requirement 40.3）。

### 组件 E：UI 宿主（Requirement 38）

- **输入**：`UiHostDeps`（holder/registry/facade/桥能力/投影/诊断等）。
- **输出**：`UiSystemPorts` 七端口（projection / events / actionQuery / revision / actions / pendingContracts / diagnostics）。
- **接口**：
  - `createUiHostPorts(deps)` → `UiSystemPorts`（`ui-host.ts:144`）。
  - `projection`：`createL2Projection(active, runtimeState, scope)` 只读投影。
  - `events`：`createScopeFilteredEventPort(rawSource, {scope, rules, currentRevision})`。
  - `actions`：`l2Submit({active, kernel, request, caller})` 经桥产 KernelContract 提交。
  - `pendingContracts`：不可用能力显式 `pendingConvergence`。
- **证伪回路**：若 `actions` 端口不经桥产 submitter → UI 提交绕过唯一判罚路径（Requirement 38.4）。若 `pendingContracts` 返回虚假可用值 → UI 展示不可用能力（Requirement 38.5）。

---

## 数据模型

以下为整合层新增/消费的 TypeScript 接口形状（沿既有 `types.ts` 命名习惯；标识符属已落地实现，此处只约束结构语义）。

```typescript
// —— 装载请求（types.ts:156）——
export interface LoadMatchRequest extends LoadedMatchOptions {
  readonly scheduleId: string;
  readonly seedDefs?: readonly Def[];
}

// —— 装载结果（types.ts:69）——
export type LoadedMatchResult =
  | { readonly ok: true; readonly match: LoadedMatch }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[]; readonly blocked: readonly string[] };

// —— 已装载对局门面（types.ts:79）——
export interface LoadedMatch {
  readonly engine: {
    readonly registry: OpRegistry;
    readonly defRegistry: DefRegistry;
    readonly ruleProvider: RuleProvider;
    readonly exprEngine: ExprEngine;
    readonly queryEngine: QueryEngine;
    readonly actionCatalog: ActionCatalog;
    readonly playpackLoader: PlaypackLoader;
    readonly playpackActivator: PlaypackActivator;
    readonly gateway: PresentationGateway;  // 只读 surface
  };
  readonly load: CoreMechanicsLoadResult;
  readonly runtime: CoreMechanicsRuntime;
  readonly facade: CoreMechanicsFacade;      // 唯一写通道
  readonly projection: CoreMechanicsProjection;
  readonly shell: MatchShell;
  readonly terminal: TerminalQuery;
  readonly ai: PlayAiRuntime | null;
  readonly bridge: RegistryBridge;
  readonly submitter: { readonly kernel: KernelContract; readonly submitAction: … };
  readonly events: { subscribe(handler: (event: MatchShellEvent) => void): { unsubscribe: () => void } };
  readonly ui: UiSystem | null;
  readonly control: {
    advance(): Result<void>;
    drainPlayerQueue(): Result<void>;
    broadcast(): void;
  };
  readonly getWorldState: () => WorldState;
}

// —— 外壳事件（types.ts:74）——
export type MatchShellEvent =
  | { readonly type: 'round'; readonly round: number; readonly phase: string }
  | { readonly type: 'matchEnd'; readonly outcome: string; readonly detail: unknown };

// —— 驱动结果（drive.ts:23）——
export interface DriveResult {
  readonly steps: number;
  readonly ended: boolean;
  readonly capped: boolean;
  readonly round: number;
  readonly phase: string;
  readonly outcome: LoadedMatch['shell']['outcome'];
}
```

**数值归属规则**：`round`、`npcNumber`、`steps` 标记为 `internal`（内部量级），禁止投影展示；玩家可见数值（vitality、stamina、ap）严格 1-5 `gameplayValue`。

---

## 正确性属性

*属性是一种在系统所有有效执行中都保持为真的特征。本文稿用属性支撑整合层自证闭环；每个属性都由 Requirement 32~41 的可机械验收驱动，且以 `for all / for any` 全称量化陈述。*

### 属性 1：装载成功且装配一致（Requirement 32.2/32.3）
*对于任意*合法装载请求（生产 config + 预置世界 + 合法玩家实体），`createLoadedMatch` 都返回 `{ok:true, match}`，且 `match.engine.registry.listOpNames()` 与 `createFullHarness().registry.listOpNames()` 全等。
**验证：Requirement 32.2, 32.3**

### 属性 2：装载失败原子性（Requirement 32.4/33.3）
*对于任意*不合法 config / 缺失实体 / 地图 spawn 失败 / AI seed 失败的装载请求，`createLoadedMatch` 都返回 `{ok:false}` 且 `match` 不存在（不返回半可用对象）。
**验证：Requirement 32.4, 33.3**

### 属性 3：门禁体面（Requirement 33.2）
*对于任意*生产 config 装载，`blocked` 只含未冻结项（如 `firearm-base-damage-table`），不含已冻结项（`standard-random-roll`、`power-die-settlement`、`play-event-pipeline-integration`）。
**验证：Requirement 33.2**

### 属性 4：终局判定单调单向（Requirement 35.2/35.3/40.1）
*对于任意*被调度推进的合法装载，`match.shell.ended` 至多发生一次 false→true 转换，一旦为 true 恒为 true；`matchEnd` 事件只广播一次（`endedBroadcast` + `matchEndDelivered` 双层去重）；终局后 `submitGuard()` 恒返回 `E_OP_NOT_ACCEPTED`。
**验证：Requirement 35.2, 35.3, 40.1**

### 属性 5：round 只增不减（Requirement 35.4）
*对于任意*完整推进回绕，`match.shell.round` 每轮五阶段回绕恰好 +1，只增不减；round 归属 `internal`。
**验证：Requirement 35.4**

### 属性 6：驱动终局停止（Requirement 36.4）
*对于任意*已终局的 `LoadedMatch`，`driveMatch` 以 `ended:true` 返回、`steps === 0`、不再推进。
**验证：Requirement 36.4**

### 属性 7：同一判罚路径（Requirement 37.4）
*对于任意*被装载后的 AI / UI / 玩家对同一动作请求，都得到相同合法性判定与相同拒绝原因；`CoreMechanicsFacade.submit` 无来源分支，UI 经桥产 `submitter.submitAction` 走同一路径。
**验证：Requirement 37.4**

### 属性 8：桥只读无副作用（Requirement 39.2）
*对于任意*可解析 Def 的桥视图，视图对象被冻结（`Object.isFrozen` 为真）；`kernel.hasOp` 对真实 Op 恒真、对未知名恒假；视图改动不影响注册表（`defRegistry.resolve` 仍返回原对象）。
**验证：Requirement 39.2**

### 属性 9：事件出口只读无副作用（Requirement 40.3）
*对于任意*已装载对局，`engine.gateway.query` / `queryActions` 调用不触发任何写入（registry 状态无变化、不增加 Op）。
**验证：Requirement 40.3**

### 属性 10：UI 端口不可用能力显式 pending（Requirement 38.5）
*对于任意*已装载对局（含 profile），`pendingContracts` 中不可用能力（`safeUnavailabilityReasonKey`、`visibleScenes`、`visibleContainers`、AI 说明）都返回 `pendingConvergence`，不返回虚假可用值。
**验证：Requirement 38.5**

### 属性 11：可自证 vs 交接可区分（Requirement 320.2/41.3）
*对于任意*本 Spec 判为"可在整合层内自证"的缺口（组合根、外壳、驱动、事件出口、UI 宿主），都能由 `src/play/loading-runtime/` 契约测试 + PBT 闭环验证；判为"交接"的缺漏在收尾综述如实列出，不得谎报完成。
**验证：Requirement 320.2, 41.3**

---

## 错误处理

1. **装载失败**：`createLoadedMatch` 在任一步（引擎装配、门禁、出生、地图 spawn、AI seed）失败时原子拒绝，不返回半可用对象（Requirement 32.4）。
2. **终局后提交**：`submitGuard()` 返回 `E_OP_NOT_ACCEPTED`，`advance()` 被外壳拒绝（Requirement 35.3）。
3. **驱动守卫拒绝**：`driveMatch` 在推进被守卫/队列约束拒绝时如实返回（不遮蔽、不吞错），标记 `capped` 或返回当前相位（Requirement 36.5）。
4. **事件投递异常**：`gateway.dispatch` 对 handler 抛出的异常静默吞掉（与 after-hook 同一契约），不中断其他订阅者（`gateway.ts:78-82`）。
5. **越权写**：任何绕过 `OpRegistry.invoke` 直接改 `WorldState` 的实现以 `E_LOAD_LAYER_OWNERSHIP` 或等价既有错误拒绝（属性 7/8）。

---

## 测试策略

- **单元测试**：对组合根装载成功/失败/门禁体面/装配一致/地图 spawn/AI 装配/外壳控制各写具体示例（`create-loaded-match.contract.test.ts` 7 用例）；对端口契约（同判罚路径/桥只读/UI 7 端口/外壳终局/外壳自检）各写具体示例（`loaded-match.ports.contract.test.ts` 5 用例）；对事件出口（gateway 只读/round 事件/终局事件）各写具体示例（`event-gateway.contract.test.ts` 3 用例）；对驱动（全自动推进/playerAction drain/NPC 决策/终局停止/maxSteps cap）各写具体示例（`drive.e2e.test.ts` 5 用例）。
- **属性测试（PBT）**：属性 1~11 每个恰有一个 fast-check 测试（≥100 次迭代，标记 `Feature: wakeup-loading-runtime, Property N: …`），生成合法玩家子集/advance 次数/defId，断言全称不变式。既有 `loading-runtime.property.test.ts` 已覆盖属性 1/5/8（出生装配守恒/阶段推进单调/桥只读无副作用），需补属性 2/3/4/6/7/9/10/11。
- **契约断言面（`*contract*`）**：每个接线面一个契约文件断言"数据通、方向对、无越权写"（属性 7/8/9/10 落地）。
- **门禁**：`npx tsc --noEmit`（全域 0 err）+ `npx vitest run`（相关范围）+ `npm run lint` + `npm run verify:docs`（Requirement 320.1）。