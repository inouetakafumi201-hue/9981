# Design Document — 玩法层彻查与补全（专项 CEME）

## 概述

本设计文档把 `requirements.md`（Requirement 20~31）转成可实施、可机械验证的玩法层补全结构。它逐项给出 S3 立项轮廓七项缺漏 C-1~C-7 的"现状 → 定义 → 证伪回路"，并登记额外扫描结论。关键立场（沿核心机制设计）：

- 玩法层是**组合者**，不是定义者：只消费引擎层已登记原语（`OpRegistry.invoke`、`outcome.reach`、`schedule.advance`、`prop.set`、`tag.add` 等）与基类层实例组合，不重新定义它们。
- 一局语义的玩法层承载面（结局种类、终局判定、参与者资格、出生起点、胜负结算、OVERLOAD 归属）是本设计新增声明；具体模式胜负平衡、出生数值、对局外壳照本文稿外部消费。
- **唯一写入通道仍是 `OpRegistry.invoke`**。任何"宿主直接改 WorldState"都是越权。UI / AI / devboard 不得拥有玩法层权威写权。
- 数值铁律：玩家可见 1-5；回合号 / round / 归队计数 / 结算预算 / 内部量级例外，必须归属 `internal`、投影禁止展示。

### 与专项 B / 基类层的边界（本文稿不越权的块）

| 块 | 归属 | 本设计对待方式 |
|---|---|---|
| 生产组合根 `createLoadedMatch` | 专项 B | 只登记为消费本设计载荷的交接项 |
| 对局外壳 `MatchShell`（回合号+终局判定+胜负结算+终局事件） | 专项 B | 只定义它消费的结局种类/终局查询/胜负查询承载面，不实现外壳 |
| UI 宿主侧实现、`PresentationGateway` 事件出口、`matchEnd` 对外态 | 专项 B | 登记为专项 B 消费，不实现 |
| L1↔L2 注册表桥（`OpRegistry/DefRegistry` ↔ `ActiveRegistry/KernelContract`） | 基类层 | 登记为基类层缺漏，消费它装进去，不定义它 |
| `MapData` `floor→layers` 契约扩展 | 独立专项 | 登记为衔接项，本文稿只消费现有契约 |
| 具体模式胜负平衡 / `victoryCondition` / 出生具体落点 / 五角色出生数值 | 下游（专项 B/具体模式） | 不默认化，只留承载面 |

---

## 架构

玩法层补全的三段式运行时骨架（虚线框为专项 B 消费侧，非实现）：

```
                            玩法层 CEME 补全（本文稿实现区）
        ┌─────────────────────────────────────────────────────────────────────┐
  引擎层 │  schedule.advance(loop:true)    五阶段 roll→settle→playerAction→   │
  Op     │                                 npcAction→cleanup→(回绕 roll)       │
  `outcome.reach`(记录事实)                    │ round++（回绕守卫，内部量）     │
        │                                        │                              │
        │   ┌──────────────┐   ┌───────────────────────────────┐               │
        │   │ 结局声明 Rule │──▶│ 终局判定字段                       │               │
        │   │ (解读Reach,   │   │ world.props.play.matchEnded      │               │
        │   │  ends && when)│   │ + 胜出 scope/rank（internal）     │               │
        │   └──────────────┘   └───────────────▲───────────────────┘               │
        │                            只读胜负/终局查询（投影或等效只读通道）          │
        └─────────────────────────────────────┼───────────────────────────────────┘
                                              │ 结局种类/终局判定/胜负查询承载面
        ┌─────────────────────────────────────▼───────────────────────────────────┐
  专项B │  createLoadedMatch → MatchShell 读终局查询 → ended → 关闭对外提交通道        │
        └──────────────────────────────────────────────────────────────────────────┘

  装载序（loadCoreMechanics 扩充，只补不改既有 8 步）：
     参与者常驻装载自动注册（tag.add roll-participant + rollTier 起点，Requirement 24）
     → 出生起点装配（起始体力等，Requirement 25）→ 结局非空声明装载（Requirement 20）
     → 终局判定/胜负规则挂载（Requirement 23/26）→ 首个 roll
  AI（createPlayAiRuntime，Requirement 27）：消费同一 holder/registry/ruleProvider，
     seedNpcQueue 挂 npcAction 相位，经 CoreMechanicsFacade 提交通一判罚路径。
```

**架构原则**

1. 解耦优先、基层长远：结局 / 胜负 / 终局判定作为玩法层声明式契约暴露，不写进个别 phase 守卫内做副作用终结（Requirement 23.6）。
2. 单一权威：玩法层内不得出现两处自称权威的胜负 / 参与者 / 过载实现；重叠则由本章做所有权裁决并声明唯一权威（Requirement 26 / 28）。
3. 零耦合守卫：用测试断言"本补全尚未绑定到未冻结依赖"（专项 B/桥/地图契约扩展不提前耦合）。
4. 装配一致性：生产化 AI runtime 与现有测试组合根共享 Op/Hook/Holder 装配不冲突（沿用 S2 §Q-4 思路，Requirement 27.7）。

---

## 组件与接口

### 组件 A：结局种类声明与终局判定（Requirement 20 / 23）

- **输入**：`CoreMechanicsPlaypack.outcomes`（现为空，需补非空守恒集）、状态量（entities 生命 / round / 附加标记）。
- **输出**：终局判定可读字段 `world.props.play.matchEnded` + 终结 scope / 结局名 / rank（internal）。
- **接口**：
  - 声明：`OutcomeDef[]`（不改引擎层，填核心机制玩法包的 `outcomes` 与关联 RuleDef）。
  - 事件：`outcome.reach`（引擎层既有，记录 `{scope, ends, rank, phase}`）。
  - 规则：一根 `RuleDef` 挂在 `outcome.reach` 后置合法事件链，解读 `ends:true` 结局并写终局字段。
  - 只读查询：终局/胜负查询函数（投影侧或等效只读通道），读 `matchEnded` + 终结详情。
- **证伪回路**：若不做 `outcomes` 非空声明 → 对局外壳无可枚举终局来源（被专项 B 阻塞）。若缺终局查询 → 外壳无法判定"一局有没有结束"（Requirement 20.7 / 23.2）。

### 组件 B：参与者资格装载自动注册（Requirement 24）

- **输入**：装载期常驻动作（`loadCoreMechanics` 扩充步骤）、被装载实体的"玩家"身份。
- **输出**：受领者获得 `play:roll-participant` 标记 + `rollTier` 起点并进入 `playerQueue`。
- **接口**：装载期自动执行 `tag.add('play:roll-participant')` + `prop.set(entities.<id>.props.rollTier, 起点)`（等价既有参与者谓词 `PARTICIPANT_PRED` 的前件），并令 `playerQueue` 生产注册（`turnOrder` 长度恒等于 `playerQueue` 长度，复用 `settleOnExit` 守卫）。
- **证伪回路**：若只靠测试手动 tag add → `PLAYER_QUEUE_GAP` 未结算，对局外壳/演员入口无法装载期入队（Requirement 24.3/24.4）。

### 组件 C：round 计数与终结点（Requirement 23）

- **输入**：`schedule.advance` 的 roundEnd（cleanup→roll 回绕）。
- **输出**：`world.props.play.play.round`（internal）只增不减。
- **接口**：回绕守卫（`cleanupOnExit` 或 roundEnd 等效声明）内 `prop.set` round+1；终局判定把 `matchEnded` 从 false→true 写入。
- **证伪回路**：若不做 round 计数 → 五阶段 `loop:true` 无限循环无收敛判据（Requirement 23.1）；若推进本身副作用终结 → 违反 Requirement 23.6（终局必须经结局判定规则转换）。

### 组件 D：出生规则与 domain-entry（Requirement 25）

- **输入**：空态 `createEmptyWorldState`、出生起点配置（起始体力等，由具体模式提供，非本设计默认值）。
- **输出**：每名玩家参与者出生装配完成（起点体力 + 起点状态 + 投点资格），可在首 roll 前使用。
- **接口**：出生装配在装载序且首 roll 前事务内完成；起始体力显式声明归属（1-5）；玩家与 NPC 出生路径分离。
- **证伪回路**：若出生默认被推断（池 initial 缺席回 min/0）→ 现有 M10"睡下→起床回满到 5"的装载语义不可装配（Requirement 25.2 / C-4）。

### 组件 E：胜负结算（Requirement 26）

- **输入**：`OutcomeDef.when` 求值、`scope`/`rank`/`onReach`/`ends`。
- **输出**：成对"终结结局 + scope + rank"记录 + 只读胜负查询。
- **接口**：
  - 当 `when` 真且 `ends:true` → 记该结局为终结结局（同 scope rank 最高者优先，replay 复现次序）。
  - `onReach` 沿合法事件链执行，失败整体回滚。
  - 只读胜负查询暴露"是否已有胜负 / 终结结局名 / 终结 scope / 胜出者 rank"。
- **证伪回路**：若不做 `when→rank→ends` 解读 → `OutcomeDef` 只有类型无人消费（C-5）；胜负查询缺失则对局外壳无法结算胜利条件（Requirement 26.5）。

### 组件 F：AI runtime 接入（Requirement 27）

- **输入**：`createPlayAiRuntime` 与 `loadCoreMechanics` 共享 holder/registry/ruleProvider。
- **输出**：NPC 队列填充挂 npcAction 相位、AI 经 `CoreMechanicsFacade` 提交通一判罚路径。
- **接口**：`seedNpcQueue` 写 `PATH_NPC_QUEUE`、`popNextNpc` 消费队列头并让 AI 决策、均走既有权重路径；玩家体 AI 参与参与者判定，NPC（`play:npc`）不参与（沿用既有 D-052/D-053 分区）。
- **证伪回路**：若 `createPlayAiRuntime` 不接 loadCoreMechanics/advancePhase → AI 走不到玩法判罚路径，AI 与玩家不同源（C-6，Requirement 27.1/27.2）。

### 组件 G：OVERLOAD_GAP 归属声明（Requirement 28）

- **输入**：`CoreMechanicsConfig.overload`（现被 6 项装载校验但无消费规则）、legacy `action-turn/playpack.json` 过载实现。
- **输出**：归属声明（唯一权威），随后按裁决实现或交接。
- **接口**：若收束 core-mechanics → 新增过载规则（D-055 语义）挂 `pool.overflow`/`play.stamina.grant` 超上限；清理自然恢复不触发过载（Requirement 6.22）边界固定。
- **证伪回路**：若配置被校验却从不被消费，或 legacy 与新规则双触发/零触发 → `OVERLOAD_GAP` 未结算（Requirement 28.2/28.5）。

---

## 数据模型

以下为玩法层新增声明的 TypeScript 接口形状（沿既有 `defs/ids.ts` 常量与核心机制 Spec 命名习惯；标识符属未冻结契约，此处只约束结构语义）。

```typescript
// —— 终局判定与 round（写于 world.props.play.*，均 internal 归属）——
export const PATH_MATCH_ENDED = 'world.props.play.matchEnded';     // boolean，false→true
export const PATH_ROUND = 'world.props.play.round';                 // number，internal，只增不减
export const PATH_MATCH_END_DETAIL = 'world.props.play.matchEnd';  // { outcome, scope, rank } internal

// —— 结局声明（填 CoreMechanicsPlaypack.outcomes）——
export interface CoreOutcomeDecl {
  readonly name: string;               // OutcomeDef.name
  readonly when: Expr;                 // OutcomeDef.when，纯读
  readonly scope: 'game'|'agent'|'faction'; // OutcomeDef.scope
  readonly rank?: Expr;                // OutcomeDef.rank（内部量级）
  readonly onReach?: Effect[];         // OutcomeDef.onReach，走合法事件链
  readonly ends: boolean;              // OutcomeDef.ends
}

// —— 只读终局/胜负查询（组件 A/E 的出口，无写权）——
export interface TerminalQuery {
  matchEnded(): boolean;
  matchEndDetail(): { outcome: string; scope: string; rank: number | null } | null;
}
```

**数值归属规则**：`round`、`matchEnd` 细节的 rank 标记为 `internalMetric`（`internal` 归属），禁止投影展示；若胜负用可见生命做败北判据，则该可见生命仍 1-5 `gameplayValue`。任何新字段未分类 → 装载拒绝（沿用核心机制 `ownerhip.ts` 的 `buildNumericOwnership` 归属要求）。

---

## 正确性属性

*属性是一种在系统所有有效执行中都保持为真的特征。本文稿用属性支撑玩法层自证闭环；每个属性都由 Requirement 20~31 的可机械验收驱动，且以 `for all / for any` 全称量化陈述。*

### 属性 1：结局簿非空且结构合法（Requirement 20.2/20.3/20.4）
*对于任意*本补全的合法玩法包裹载，`CoreMechanicsPlaypack.outcomes` 都非空，每条 `OutcomeDef` 结构合法，`when` 为纯读 Expr、`scope` 合法、`ends` 二值明确。
**验证：Requirement 20.2, 20.3, 20.4, 20.11**

### 属性 2：终局判定单调单向（Requirement 23.4/23.9）
*对于任意*被调度推进的合法装载，`world.props.play.matchEnded` 至多发生一次 false→true 转换，一旦为 true 恒为 true，且不随推进回退。
**验证：Requirement 23.4, 23.9**

### 属性 3：round 计数只增不减（Requirement 23.1/23.9）
*对于任意*完整推进回绕，round 每轮五阶段回绕恰好 +1，只增不减；round 参与终局比较时按稳定数字比较。
**验证：Requirement 23.1, 23.9**

### 属性 4：参与者-队列-顺序三者一致（Requirement 24.1/24.3/24.8）
*对于任意*合法参与者集合，装载自动注册后参与者谓词（`play:roll-participant` ∧ `rollTier` 非空）为真的实体集合、`playerQueue` 长度、`turnOrder` 长度三者一致。
**验证：Requirement 24.1, 24.3, 24.8**

### 属性 5：参与者资格装载期注册（Requirement 24.2/24.5）
*对于任意*作为玩家入局的实体，装载自动注册都会给它打上 `play:roll-participant` 标记并给出 `rollTier` 起点，无需任何外部宿主写权；永久退出的实体装载后不再满足该谓词。
**验证：Requirement 24.2, 24.5, 24.6**

### 属性 6：出生装配起点合法且原子（Requirement 25.2/25.5/25.7）
*对于任意*装载并可行的出生配置，每个参与者在首 roll 前具有合法起点（起始体力有归属声明、起点状态显式），出生装配写入全部走合法 Op，装载失败时无部分起点落地。
**验证：Requirement 25.2, 25.5, 25.7**

### 属性 7：胜负单真源与优先次序（Requirement 26.2/26.3/26.6）
*对于任意*同时多个 `ends:true` 结局竞争的局面，系统所选终结结局唯一：同 scope 内 rank 最高者优先，相等 rank 时按声明顺序/稳定次序取唯一，且该选择在重放中复现；终结写入在一个事务内原子完成，失败不留半终结态（结局达成但终局判定未写）。
**验证：Requirement 26.2, 26.3, 26.6**

### 属性 8：同一判罚路径（Requirement 27.4/27.5）
*对于任意*被装载后的 AI / UI / UGC 对同一动作请求，都得到相同合法性判定与相同拒绝原因；play `CoreMechanicsFacade.submit` 无来源分支，不存在第二套提交通道。
**验证：Requirement 27.4, 27.5**

### 属性 9：过载唯一权威（Requirement 28.3/28.5）
*对于任意*同一过载触发场景，所属侧（core-mechanics 新规则 或 legacy 包）只走一条权威规则路径，不出现双触发或零触发，配置校验与运行期结算指向同一权威。
**验证：Requirement 28.3, 28.5**

### 属性 10：可自证 vs 交接可区分（Requirement 30.2/30.3）
*对于任意*本 Spec 判为"可在玩法层内自证"的缺口（C-1/C-2/C-3/C-4/C-5 读写环、C-6 同判罚、C-7 归属），都能由玩法层装载+规则+只读投影+契约断言+PBT 闭环验证；判为"交接"的缺漏在收尾综述如实列出，不得谎报完成。
**验证：Requirement 30.2, 30.3**

### 属性 11：终局写入不绕过阶段守卫（Requirement 23.6/23.7）
*对于任意*当前尚不满足既有五阶段守卫（结算未完成 / 执行队列非空 / 到期未完成）的推进，系统都照常拒绝推进，不因终局判定成立而绕过阶段守卫副作用式终结。
**验证：Requirement 23.6, 23.7**

### 属性 12：结局种类承载面不默认化具体模式（Requirement 20.13/21.4/31.2）
*对于任意*本 Spec 的结局种类声明，都不包含"具体模式胜负平衡数值、出生具体落点、五角色出生数值"等仍应保持未冻结的具体值；这些只作为专项 B / 具体模式的契约承载面被登记。
**验证：Requirement 20.13, 21.4, 31.2**

### 属性 13：扫描项不顺手实现（Requirement 29.2/29.4）
*对于任意*额外扫描判为"交接"的跨线项（MapData 契约扩展、素材库元状态、可用性钩子桩、L1↔L2 桥），系统都只登记衔接项，不实现、"不做替换 MVP"。
**验证：Requirement 29.2, 29.4**

---

## 错误处理

1. 终局写入失败：整次事务回滚，`matchEnded` 不置位；回滚保持请求前语义（Requirement 2 沿用）。
2. 出生起点装配失败：装载期原子拒绝，不返回半初始化对局（Requirement 25.5 沿用）。
3. 结局声明结构非法 / `when` 非纯读：装载期拒绝（`E_LOAD_*` 或既有装载错误），不得默认化（Requirement 20.3/30.2）。
4. 胜负多数占先：同 scope 平 rank 需稳定唯一者，否则以明确拒绝或稳定次序处理（属性 7）。
5. 越权写：任何绕过 `OpRegistry.invoke` 直接改 `WorldState` 的实现以 `E_LOAD_LAYER_OWNERSHIP` 或等价既有错误拒绝（Requirement 30.2 反证，属性 8）。

## 测试策略

- **单元测试**：对结局声明结构、终局判定、round 计数、出生装配、参与者自动注册、过载归属各写具体示例，验证确定性行为。
- **属性测试（PBT）**：属性 1~13 每个恰有一个 fast-check 测试（≥100 次迭代，标记 `Feature: wakeup-core-mechanics-exhaustive, Property N: …`），生成合法状态/结局/参与者集合，断言全称不变式。
- **契约断言面（`*contract*`）**：每个接线面一个契约文件断言"数据通、方向对、无越权写"（属性 8/10 落地）。
- **门禁**：`npx tsc --noEmit`（全域 0 err）+ `npx vitest run`（相关范围）+ `npm run lint` + `npm run verify:docs`（Requirement 30.1）。
