# CEME 线收尾确认（玩法层彻查专项）

**日期**: 2026-08-18
**性质**: 只读代码核对 + 文档收账（本报告不修改任何 `src/**` 生产源码）
**结论**: ✅ 玩法层内七项缺漏 C-1~C-7 的**一局语义承载面**已全部落地且可自证；两项交接项（专项 B 生产组合根 / 出生具体落点）按边界如实登记。**OVERLOAD_GAP 尚未结算**，为唯一未收束项，归属既有 legacy 包 + core-mechanics 施加/拦截双形态（详见 §四.7）。

---

## 一、本报告口径

本报告是对 `.kiro/specs/wakeup-core-mechanics-exhaustive`（CEME 专项）的收尾核对：逐一读代码，确认每一条缺漏的承载面是否真实存在、是否可机械验证、何者在玩法层内自证、何者交接。**红线遵守确认**：未修改 `src/play/core-mechanics/` 下任何既有源码；玩法层改动全部以新增声明式文件、新增规则、新增契约测试落地（`match-lifecycle.ts` 为 CEME 专项新增模块）。

---

## 二、C-1~C-7 逐项核实结论

| 缺口 | 承载面落点 | 可否玩法层内自证 | 现状 |
|---|---|---|---|
| **C-1 结局种类非空守恒集** | `defs/outcomes.ts` `CORE_OUTCOMES`（`last-standing` / `round-checkpoint`）→ 填 `CoreMechanicsPlaypack.outcomes`；`load.ts` 装载结果携带 `outcomes` | ✅ 自证 | 见 §四.1 |
| **C-2 参与者资格装载自动注册** | `match-lifecycle.ts` `assembleMatchStart`（打 `play:roll-participant` + `rollTier` 起点 + 体力） | ✅ 自证 | 见 §四.2 |
| **C-3 round 计数与终结点** | `schedule.ts` `roundEnd` 发 `EVENT_ROUND_INCREMENT` → `rules.match.ts` `roundIncrementRule` 写 `world.props.play.round`；`outcomeTerminalRule` 写 `matchEnded` | ✅ 自证 | 见 §四.3 |
| **C-4 出生规则** | `match-lifecycle.ts` `assembleMatchStart`（起点装配）；玩家/NPC 出生路径分离断言内置 | 🔶 承载面自证 / 具体数值交接 | 见 §四.4 |
| **C-5 胜负结算** | `match-lifecycle.ts` `evaluateOutcomes` / `recordOutcome` / `createTerminalQuery`/`readTerminal`（`when→rank→ends` 读写环） | ✅ 自证 | 见 §四.5 |
| **C-6 AI runtime 接入装载/推进相位** | `ai-runtime.ts` `seedNpcQueue`/`popNextNpc` 挂 NPC 相位、经 `CoreMechanicsFacade` 提交通一判罚；专项 B `createLoadedMatch` 消费同一 holder/registry | ✅ 自证（接管语义）+ 🔶 相位驱动接入部分交接 | 见 §四.6 |
| **C-7 OVERLOAD_GAP 归属** | `rules.match.ts` 落地施加/拦截/归队三规则 + `match-lifecycle` 消费；**生产触发端口未收束**（`staminaGrantRule` 用 `prop.set` 而非 `pool.add`，无 `pool.overflow` 发射端） | ⚠️ **未收束** | 见 §四.7 |

---

## 三、谁在消费这些承载面（机械核对）

- **装载结果**：`loadCoreMechanics` 返回 `outcomes` 字段（非空守恒集，`load.ts:182`），`state-machine.e2e.test.ts:184-187` 断言装载结果与声明集合逐项一致。
- **生产组合根**：`loading-runtime/index.ts` `createLoadedMatch` 依次调用 `initializeMatchFields` → `playpack.activate` → `assembleMatchStart` →（可选）`compileMap`/`prefab.spawn` → AI runtime（`seedNpcQueue`）→ `createTerminalQuery`/`createMatchShell`，全部经 `OpRegistry.invoke`（唯一写通道）。
- **只读终局/胜负查询**：`createTerminalQuery`/`readTerminal` 读 `world.props.play.matchEnded` + `matchEnd` 明细 + `round`（Internal_Metric），`CreateMatchShell` 消费判 `ended`，对外事件 `match.round`/`match.ended` 一次广播。
- **AI 同判罚**：`ai-runtime.ts` 自持独立 holder/registry 只作决策仿真快照源（`createLoadedMatch` 注释如实标注此装配面边界），决策提交仍经 `CoreMechanicsFacade.submit`（无来源分支）。

---

## 四、逐项细节与如实登记

### 4.1 C-1 结局种类
`CoreMechanicsPlaypack.outcomes` 现为非空守恒集 `[last-standing(rank:2,ends:true), round-checkpoint(rank:1,ends:false)]`。`when` 全部为纯读 Expr（`{q}` 查询 + `{path}` 逻辑比较，无随机/写入 Op）。结构符合 `OutcomeDef` 形状，终局判定写入走 `rules.match.ts` `outcomeTerminalRule`（`play.outcome.reached` 事件链，default 阶段）。**已自证**：装载成功 + 结果携带守恒集 + 结构逐条合法 + `when` 可求值。

### 4.2 C-2 参与者注册 + PLAYER_QUEUE_GAP
`assembleMatchStart` 为每个玩家实体：打 `play:roll-participant`、写 `rollTier` 起点、写体力池、写 `spawnCandidates`；`consumePlayerQueue` 的 `prop.set` 写 `PATH_PLAYER_QUEUE`（生产化清队入口，经 Op）。永久退出者打了 `TAG_PERMANENT_EXIT` 会被跳过（不重回参与者集合）。测试 `drive.e2e.test.ts` 与 `state-machine.e2e.test.ts` 均已改走 `consumePlayerQueue` 生产入口，不再手动 `setState` 改队列。**已自证**：生产者注册 + 谓词一致性 + 无外部宿主写权。

### 4.3 C-3 round 计数与终结点
`schedule.ts` 的 `ScheduleDef.roundEnd: [emitEffect(EVENT_ROUND_INCREMENT)]` 在 cleanup→roll 回绕时发事件；`rules.match.ts` `roundIncrementRule` 消费并 `prop.set/prop.add` 写 `world.props.play.round`（初始 1，此后 +1，只增不减）。`outcomeTerminalRule` 只在 `ends:true` 且 `matchEnded` 未置位时写 `matchEnded=true`（单调 false→true）。**五阶段守卫不绕过**：终局写入不在 phase 守卫内副作用式终结，而是经独立事件规则；阶段推进守卫由 `schedule-ops` 既有守卫保持。**已自证**：`state-machine.e2e.test.ts:263` 断言一整轮回绕后 `terminal().round()` 为 1。

### 4.4 C-4 出生规则
承载面 = `assembleMatchStart` 的"起点装配"（起始体力 `SPAWN_STAMINA_INITIAL`、rollTier 起点、投点资格）。**玩家与 NPC 出生路径分离**：`assembleMatchStart` 遇 `play:npc` 标记实体直接拒绝（`E_OP_NOT_ACCEPTED`）；NPC 出生由 `ai-runtime.ts` 稳定编号编排（`NpcBudgetBinding` + `nextNpcNumber`），与此装配分开。**具体五角色出生数值/落点仍属未冻结接口**，本承载面不默认化（Requirement 22.2/25.6/31.2）——具体数值由专项 B/具体模式消费。

### 4.5 C-5 胜负结算（OutcomeDef 真实用法）
`evaluateOutcomes` 按 rank 降序、相等取先声明者的稳定次序求值 `when`，返回首个达成者（单真源）；`recordOutcome` 先 `outcome.reach` 记事实，`ends:true` 且为终局名时同一序列写 `matchEnded`+`matchEnd` 明细（原子，失败提前返回不留半终结态）。`outcomeTerminalRule` 为声明式等价路径。**已自证**：`drive.e2e.test.ts:75-91` 记录 `last-standing` 后 `shell.ended=true`、驱动不再推进。

### 4.6 C-6 AI 接入 + 同判罚
`ai-runtime.ts` 独立持有完整 Op/Hook/Flow 装配（`createFullHarness` 字节一致不是它，但 produce 同语义），`seedNpcQueue` 写 `PATH_NPC_QUEUE`、`popNextNpc` 消费队列头并让 `facade.act` 决策，经 `CanonicalCandidateCommitGateway`→`intent.submit`。**同一判罚路径**：`loaded-match.ports.contract.test.ts:51` 断言 `facade.submit` 无来源分支、附着动作独立提交与 UI `ActionPort` 提交得到同一结构化拒绝。**如实标注的装配面边界**：专项 B `createLoadedMatch` 复用 AI runtime 的"预算→队列/agent 登记"语义，但 AI runtime 自持独立 holder，由 `mergeAiFromMatchSnapshot` 把主世界事实投影进其决策快照源（`syncAiFromMatch`）——这是对"AI 与玩家同一状态视图"的诚实近似，非共享同一 holder。

### 4.7 C-7 OVERLOAD_GAP 归属 —— 未收束（如实登记）
core-mechanics 包内过载**施加/拦截/归队**已落地声明式规则（`overloadApplyRule` / `overloadBlockIntentRule` / `overloadTickRule`）+ `overloadedAttachment`，但**生产主世界无任何发射端**：
- `staminaGrantRule` 满 5 用 `prop.set` 写体力而不是 `pool.add`，既不触发过载也不发 `pool.overflow`；全仓仅 `state-machine.e2e.test.ts` 直接 `attach.add` 施加过载。
- 因此生产加载的正常路径**不会自发触发过载**；过载施加的权威入口仍是 legacy `action-turn/playpack.json`（挂 `pool.overflow`）。

**归属判定**：`OVERLOAD_GAP` **保持未结算**（不算"CEME 已闭环"）。过载存在双形态但不分叉——legacy 负责施加、core-mechanics 负责施加/拦截/归队的*声明式*语义（供测试与未来触发端口复用）。已登记为后续专项交接项：把过载触发端口收束进 core-mechanics（在体力超上限路径发 `pool.overflow`→`overloadApplyRule`），不代实现、不改写既有文件。**C-7 不能宣告完成**。

---

## 五、交接项（本 CEME 不代做的块）

| 交接项 | 归属 | 现状 |
|---|---|---|
| 生产组合根 `createLoadedMatch` 完整接线（地图 prefab、地图归一化、AI 快照合并、eventSink/UI 七端口、L1↔L2 桥、submitter） | 专项 B / 整合层 | ✅ 已落地（`loading-runtime/index.ts`，本次收尾一并核对），非本 CEME 实现 |
| 具体模式胜负平衡 / `victoryCondition` / 出生具体落点 / 五角色出生数值 | 专项 B / 具体模式 | 🔶 未冻结接口，只留承载面（Requirement 22.2/31.2） |
| L1↔L2 注册表桥 | 基类层 | ✅ 专项 D 已交付（`src/l2/kernel/registry-bridge.ts`），组合根消费它 |
| MapData `floor→layers` 契约扩展 | 独立专项 | 🔶 `wakeup-mapdata-floor-layers` 已建 spec，`Src play/map/types.ts` canonical 归一化已落地，组合根导入边界 normalize |
| 素材库元状态层 / 可用性钩子真逻辑 | 独立专项 | 🔶 现为全放行桩 |

---

## 六、门禁状态

- **类型检查**：`npx tsc --noEmit` 全域 0 error（本次收尾前已复测）。
- **测试**：`npx vitest run` 相关范围（`state-machine.e2e` / `drive.e2e` / `loaded-match.ports.contract` / `ugc-full-rule-chain` / 专项 B 各契约）全绿。
- **lint**：`npm run lint` 0 error。
- **文档门禁**：`npm run verify:docs` 全绿。

> 以上为收尾前的如实快照；完整三命令 + verify 全量门禁由收尾会话在 `00_主状态板` 入账后统一重跑（本报告不宣称已执行）。

---

## 七、结论

CEME 专项的七项缺漏中，**六项（C-1/C-2/C-3/C-4/C-5/C-6）玩法层承载面已落地且可自证**；**C-7（OVERLOAD_GAP）未收束**，登记为唯一待结项的后续专项。两项边界（生产组合根已由专项 B 落地、具体出生数值/落点仍未冻结）如实交接，不谎报完成。
