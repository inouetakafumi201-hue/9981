# Requirements Document — 玩法层彻查与补全（专项 CEME）

## 简介

本 Spec 是「玩法层彻查 CEME（Core Mechanics Exhaustive）」的生产规格交付物。它承接 `docs/工程治理/05_玩法层彻查CEME_立项轮廓.md` 的七项可证伪缺漏 C-1~C-7 与「额外扫描」要求，针对**整个玩法层**把长期以来"暧昧、等之后再补"的一局语义（结局种类、参与者资格、回合量级边界、出生规则、胜负结算、AI 接入装载推进相位、OVERLOAD_GAP 归属）逐一定义，整合成可测试的规格。

本 Spec 的性质与边界：

- **纯规格交付**，不写业务实现代码。交付物是本目录下 `requirements.md` / `design.md` / `tasks.md` 三个文件。
- **面向整个玩法层（src/play）**：凡现行 `src/play/core-mechanics/`、`src/play/ai-runtime.ts`、`src/play/map/` 中"延迟到下游再补/属另一 Spec 范围"的玩法语义，凡现行 `GAP` 登记，凡未被冻结的玩法层语义，都在本 Spec 的彻查范围内（见 Requirement 20 的额外扫描）。
- **与整合层专项 B 的边界**：生产组合根 `createLoadedMatch`、对局外壳 `MatchShell`、UI 宿主侧实现、L1↔L2 注册表桥均属专项 B 或基类层，**不属于本 Spec 的实现范围**。本 Spec 只把它们登记为交接项并写清依赖，不越权定义。见 Requirement 21。
- **红线**：不修改 `src/play/core-mechanics/` 任何既有源码；本 Spec 的实现落点只能是新增的玩法层声明式定义、新增规则与新测试，且必须遵守「唯一状态写入通道是 `OpRegistry.invoke`」。
- **数值铁律**：所有玩家可见数值严格限于 1-5；内部量级（回合号、实体数、循环圈数、归队计数、结算预算）属内部数值例外，且必须由归属机制标记为 `internal`、投影禁止展示。

### 层级归属

- **引擎层（L1）** 拥有 `OpRegistry.invoke`、合法 Op（含 `outcome.reach` / `schedule.advance` / `prop.set` 等）、Expr、Query、Hook、Schedule、Pool、随机、诊断。本 Spec 只消费它们，不再定义、复制或旁路。
- **基类层（L2）** 拥有可登记的基类、实例、状态族、伤害族、动作族等；本 Spec 只选择并组合已登记的基类与实例。
- **玩法层（L3）** 拥有本 Spec 定义的具体数值、行动经济、阶段顺序、状态约束、以及——本 Spec 新补充的——**一局的可声明结局种类、玩家参与者资格的装载自动注册、回合/round 计数与游戏终结点、出生规则、胜负结算、AI 与玩家同一判罚路径、OVERLOAD_GAP 的结算归属声明**。

### 权威来源与追踪代号

| 代号 | 来源 | 权威用途 |
|---|---|---|
| S0 | `docs/L0_规范宪法.md` | 最高权威：三层边界、玩家可见数值 1-5、五并列、唯一写入通道、正交域（D-067~D-070） |
| S1 | `docs/00_架构域与文档分类.md` | 严格三层、正交域、已装载对局为三层依赖链终点（非第四层） |
| S2 | `docs/04_整合层_装载运行期_规划设计.md`（工程治理域，已完成使命归档至 `docs/L_归档/工程治理_历史/04_……`） | 专项切分（专项 A CEME / 专项 B 整合层）、Q-2/Q-3/Q-4/Q-5、领域规约 |
| S3 | `docs/05_玩法层彻查CEME_立项轮廓.md`（工程治理域 `docs/工程治理/05_……`） | **本专项方针**：范围、七项缺漏 C-1~C-7、边界、交付物 |
| S4 | `docs/访谈决策记录.md` | 全部裁决 D-001~D-070，尤其 D-052/D-053/D-054/D-055/D-062/D-063/D-067~D-070 |
| S5 | `src/play/core-mechanics/` 现状源码 | 只读参考：defs/playpack.ts、defs/schedule.ts、load.ts、projection.ts、defs/ids.ts、ownership.ts 等 |
| S6 | `src/play/ai-runtime.ts` | AI runtime 现状（NPC 队列、createPlayAiRuntime） |
| S7 | `src/play/map/` 现状源码 | map/compile.ts、types.ts（现有 MapData 契约） |
| S8 | 核心机制现行 Spec `.kiro/specs/wakeup-core-mechanics/{requirements,design,tasks}.md` | 既有核心机制规则集；本 Spec 沿用其规则与编号体系（Requirement 1~19），不重复其已定义内容 |
| R0 | 现有核心机制 Spec 的 `Requirement 18`「未冻结契约」表 | 「出生规则、胜负条件」当前被列为未冻结接口 → 本 Spec 将其中的一局语义从"未冻结"转为"玩法层彻查并定义"（见 Requirement 22） |

要求回溯与本 Spec 的追加编号从 **Requirement 20** 开始，紧接核心机制 Spec 的 Requirement 1~19，避免编号冲突。

---

## 术语表

- **一局（Match）**：三层依赖链终点——一条被装载、被调度、可推进到终局的完整体。本 Spec 定义的"一局语义"指让对局外壳（专项 B）能够判定"一局有没有结束、谁赢"的玩法层契约。
- **对局外壳（MatchShell）**：专项 B 新增数据结构，负责"回合号 + 终局判定 + 胜负结算 + 终局事件"。本 Spec **不实现**它，只定义它消费的玩法层契约（结局种类、终局查询）。
- **结局种类（Outcome）**：`PlaypackDef.outcomes?: OutcomeDef[]` 中的条目；`OutcomeDef` 形状为 `{ name, when, scope: 'game'|'agent'|'faction', rank?, onReach?, ends }`。现行 `CoreMechanicsPlaypack.outcomes` 为空（C-1）。
- **玩家参与者（Player participant）**：满足「带 `play:roll-participant` 标记且 `props.rollTier` 非空」的活体实体。现行没有任何装载期逻辑给实体打上该标记——只在测试里手动加（`PLAYER_QUEUE_GAP`，C-2）。
- **回合/round 计数**：对局外壳需要的内部量级（内部数值例外），现行引擎层 `TurnState` 无 round 计数、五阶段 `loop:true` 无终局概念（C-3）。
- **出生规则（Spawn rule）**：一局开始时空态 `createEmptyWorldState` → 装载五角色 props/statuses → 首个 roll 之间，为每个参与者装配起点（起始体力、起点状态、投点资格标记）的玩法层声明（C-4）。
- **胜负结算（Victory settlement）**：`OutcomeDef.when` 的求值、`scope`/`rank` 的胜负判定、`onReach` 的效果触发、`ends:true` 的终局含义的玩法层真实用法（C-5）。
- **同上判罚路径**：UI / AI / UGC / 网络 / 测试对同一动作请求得到同一合法性判定与同一拒绝原因；AI hardware 经 `CoreMechanicsFacade` 提交（`submit` 无来源参数，类型层面防绕过）（C-6）。
- **OVERLOAD_GAP**：核心机制 Spec（Requirement 6、16）已把过载（D-055）裁决为规范位阶并做了装载期配置校验，但 `src/play/core-mechanics/` 包内**没有任何规则真正消费过载绑定**——真实过载实现只存在于 legacy `src/play/action-turn/playpack.json`，二者的结算归属未被声明（C-7）。
- **内部数值**：回合号、实体数、循环圈数、归队计数、结算预算、投点骰内部量等不属于 1-5 玩家可见刻度的量；必须由归属机制标记为 `internal`，投影禁止展示。
- **未冻结契约**：尚无权威结论，不得由实现/工具/下游 Spec 推断默认值的接口或数值。
- **交接项（Handoff）**：本 Spec 无法在玩法层内完成、需交由专项 B（整合层本体）或基类层补全的缺漏，本 Spec 只登记并写清依赖。

---

## Requirements

### Requirement 20: 结局种类（一局可声明的结局簿）与终局判定契约

**User Story:** 作为对局外壳（专项 B）的设计者，我希望从玩法包读到一份非空的、可机械验证的结局种类声明，以便在装载后判定一局是否到达终点。

#### 验收标准

20.1. 系统 SHOULD 在整个玩法层范围内扫描"未在本核心机制 Spec 内定义的、由权威文档（S1/S2/S3/S4）确定为玩法层语义的悬空处"，并把扫描出的每一项登记为缺口条目或消解记录（本 Spec 的额外扫描结果，见 Requirement 20.14 与 design.md 审查结论）。

20.2. `CoreMechanicsPlaypack.outcomes` SHOULD NOT 为空：核心机制玩法包应声明一局可达到结局种类的非空守恒集，使对局外壳有可枚举的终局判定来源。

20.3. 声明结局种类时，`OutcomeDef.when` 应为引擎层可求值的纯读 Expr（引用 entities 生命、附加状态、回合计数等状态量），不得引用随机 Op 或写入 Op。

20.4. `OutcomeDef.scope` 的每项取值（`game` / `agent` / `faction`）都应声明其角色：`game` 为一局级状态、`agent` 为单实体状态、`faction` 为一组实体共享状态。

20.5. `OutcomeDef.ends` 为 `true` 的条目应声明为"终局级结果"，`ends` 为 `false` 的条目应声明为"进程中记录点"，二者不得混淆。

20.6. 系统应提供一种玩法层声明（RuleDef 挂载于 `outcome.reach` 后置或等效合法事件链上），使 `outcome.reach` 被消费后能把"该结局已达成"写入 `world.props.play.*` 的终局判定字段。

20.7. 系统 SHOULD 提供一种只读查询（挂在只读投影或等效只读通道上），使对局外壳能问到"当前是否已到达终局，且终结于哪个结局种类、哪个 scope、哪个 rank"。

20.8. 当 `outcome.reach` 记录 `ends:true` 的结局后，玩法层 SHOULD 使终局判定字段反映"己终局"，但对局外壳关闭对外提交通道（`ended` 态拒绝提交）属于专项 B 的职责，本 Spec 不实现（见 Requirement 21.3）。

20.9. 非 `ends` 的记录点结局（`ends:false`）不得触发挥局判定转换；只有 `ends:true` 结局才能把终局判定字段置为"终局已达成"。

20.10. 所有结局条目及终局判定字段的声明都应有合法数值归属（`gameplay` 或 `internal`），不得出现未分类数值；回合号/round 计数参与终结判定的部分是内部数值例外。

20.11. 系统 SHOULD 提供对 `CoreMechanicsPlaypack.outcomes` 的契约测试（补对该契约工厂），断言其结构与既有 `OutcomeDef` 形状一致、每条结局可机械求值、终局判定字段写入不越权。

20.12. 系统 SHOULD 把 `outcomes` 非空、终局判定字段可写可读的装载期流程纳入现有 `loadCoreMechanics` 装载序（补充步骤不阻塞既有 8 步），并给出装载期测试断言。

20.13. 本 Spec 的结局种类契约只定义"一局可声明/怎么判定终局"的**玩法层承载面**，**不裁决具体模式的胜负平衡**（如 `05`BattleRoyaleMode 的 `victoryCondition` 是概念草稿，具体判负条件由专项 B 或具体玩法模式消费本契约后定义，见 Requirement 21.4）。

**来源追踪：** S3 表 C-1（`outcomes` 空、`OutcomeDef` 无人消费）；S2 §四 Q-2（结局种类契约归玩法层）；S5 `playpack.ts:26`（`outcomes?: OutcomeDef[]`）、`projection.ts`；引擎层 `src/core/kernel/ops/outcome-ops.ts`（`outcome.reach` 只记录事实，`ends` 为记录数据，无端上"已终局"概念）；S4 D-067~D-070、S6 正交域纪律。

### Requirement 21: 边界——交接项与不越权

**User Story:** 作为专项 B 与基类层的维护者，我希望本 Spec 明确哪些是交接项、哪些本 Spec 绝不实现，以避免双重定义或倒挂依赖。

#### 验收标准

21.1. 系统 SHOULD NOT 指定或实现生产组合根 `createLoadedMatch`、对局外壳 `MatchShell`、UI 宿主侧实现、`PresentationGateway` 事件出口与 `matchEnd` 对外态切换；这些是专项 B 的整块新建。

21.2. 系统 SHOULD NOT 指定或实现 L1↔L2 注册表桥（`OpRegistry`/`DefRegistry` ↔ `ActiveRegistry`/`KernelContract`）、任何 L2 适配器接线或基类层契约；这些是基类层缺漏（S2 §Q-5 已裁归基类层）。

21.3. 系统 SHOULD 把"终局事件单次语义、闭合后 `LoadedMatch` 对外态切到 ended、不再接受提交"登记为专项 B 依赖本 Spec 终局契约的消费语义，但**不实现**，只写清依赖关系。

21.4. 系统 SHOULD 把"具体模式胜负规则 / 缩圈流程 / 环境淘汰 / 出生具体落点 / 具体地图布局"登记为下游（专项 B 或具体玩法模式）的消费项，本 Spec 只定义其玩法层承载面，不填具体数值与平衡。

21.5. 系统 SHOULD 不修改 `src/play/core-mechanics/` 任何既有源码；本 Spec 的改动只能以"新增玩法层声明式定义、新增规则、新增测试"的方式落地（见 Requirement 23.1）。

21.6. 系统 SHOULD 确保本 Spec 的所有新增结局种类、参与者资格、出生、胜负与 round 计数语义都以 `OpRegistry.invoke` 为唯一写入通道，并以 **`E_LOAD_LAYER_OWNERSHIP` / `E_LOAD_*` 或等价装载期错误**拒绝任何绕过唯一写入通道的越权实现。

21.7. Requirement 21 的每条边界都应有一条对应测试断言（`*contract*` 断言面），断言"本接线确实数据通、方向对、无越权写"。

**来源追踪：** S3 §四（与整合层边界绝不越界）；S2 §一 1.2（严格边界）、§2.2（引用权在玩法层）、§2.6（桥归基类层）、§五 Q-5；S0 正交域（D-067~D-070）；S1。

### Requirement 22: 与既有核心机制 Spec 的关系

**User Story:** 作为既有核心机制 Spec 的维护者，我希望本 Spec 的彻查结论不推翻已冻结规则，只在"未冻结/延迟到下游"处补充定义。

#### 验收标准

22.1. 系统 SHOULD 沿用核心机制 Spec `Requirement 1~19` 的全部已冻结规则，不重新定义 AP 经济、投点分配、体力上限、五阶段、状态生命周期、恢复边界、过载（D-055）等既有内容。

22.2. 核心机制 Spec `Requirement 18`「未冻结契约」表中"出生规则、胜负条件"当前被列为未冻结接口；本 Spec 将其中的**一局语义承载面**（结局种类、终局判定、出生起点装配、胜负结算的玩法层契约）从"未冻结"转为"由本 Spec 定义"，但**具体模式的胜负平衡与出生具体落点仍属未冻结接口**，不得默认化（Requirement 23.3）。

22.3. 系统 SHOULD 把本 Spec 的新增要求编号从 20 起，与核心机制 Spec 的 1~19 保持顺序连续、无编号冲突。

22.4. 系统 SHOULD NOT 因本 Spec 的彻查而把核心机制 Spec 已裁决关闭的 U-001/U-002/U-003（过载）/U-004/U-005、T-002 结构部分退回未冻结状态。

**来源追踪：** S8 `requirements.md` Requirement 1~19、Requirement 18（未冻结契约表）；S4 D-037/D-052/D-053/D-054/D-055/D-062。

### Requirement 23: 一局的量级边界与终结点

**User Story:** 作为对局外壳（专项 B）消费者，我希望玩法层定义"一局有没有结束"的可机械判定，使 `loop:true` 的五阶段不再无限循环而无法收敛。

#### 验收标准

23.1. 系统 SHOULD 定义并持久化一个**回合/round 计数**（内部数值，归属 `internal`，投影禁止展示）：每完成一轮五阶段（cleanup → roll 的回绕）round 递增 1。

23.2. 系统 SHOULD 提供一种玩法层声明，使对局外壳能据此判定"一局是否到达终局"——读 `world.props.play.*` 的终局判定字段与 round 计数，二者构成终局查询的输入。

23.3. 具体模式的终结条件（如"某 scope 的 `ends:true` 结局已达成"、"round 达到某个上限"、"仅 1 名存活参与者"）应由玩法层声明为 `OutcomeDef.when` 或等效声明式判据，不得在玩法层内硬编码为特定玩法模式的特殊分支（Requirement 20.13 / 21.4）。

23.4. 当终局判定成立时，系统 SHOULD 在同一事务内把终局判定字段（`world.props.play.matchEnded` 或其等效内部字段）置为终态；该写入必须是一次合法 `OpRegistry.invoke` 的 `prop.set`，且该字段归属为 `internal`（玩法层内部量级例外，玩家不可见）。

23.5. round 计数参与终局判定时属内部量级；round 计数不得作为玩家可见玩法数值展示（投影不得暴露）。

23.6. 五阶段调度 `loop:true` 的**推进本身**不得直接触发终局写入；推进到终局写入的转换必须经由本 Spec 定义的结局判定规则与终局查询，不得在 `schedule.ts` 阶段守卫内副作用式终结。

23.7. 若当前回合尚未满足既有五阶段守卫（结算未完成、执行队列非空、到期未完成），system 应照常拒绝推进，不得因终局判定成立而绕过阶段守卫直接终结。

23.8. 对局外壳据本 Spec 契约在读到终局后关闭对外提交通道（`ended` 态拒绝提交）属专项 B，本 Spec 只提供"终局判定字段可读"的契约（Requirement 21.3）。

23.9. 系统 SHOULD 提供 PBT 断言：对任意合法装载并推进的玩法包裹载，round 计数只增不减、终局判定字段只有 false→true 两种取值方向（不会回退）、一旦终局写入则对局外壳的可读终局查询稳定为"己终局"。

**来源追踪：** S3 表 C-3（五阶段 `loop:true` 无终局概念）；S2 §2.4（对局外壳需要回合号/终局判定）；引擎层 `schedule-ops.ts`（`schedule.advance` 不评估 outcome、无 round/终态，`TurnState` 仅 phaseIndex/phaseEnteredAt）、`world-state.ts`（`world.props.*` 自由可写区）；S0 第四条（内部数值例外）、S5 `ids.ts`（现有路径均在 `world.props.play.*`）。

### Requirement 24: 玩家参与者资格的装载自动注册（PLAYER_QUEUE_GAP 结算）

**User Story:** 作为对局外壳与 AI 演员入口的消费者，我希望玩家 actor 在装载期自动成为参与者并入队，而不是依赖测试侧手动清法。

#### 验收标准

24.1. 系统 SHOULD 定义参与者资格判定的装载期规则：一方玩家实体成为投点参与者当且仅当其携带 `play:roll-participant` 标记且 `props.rollTier` 非空（沿用既有 `rules.phase.ts` 的 `PARTICIPANT_PRED` 谓词）。

24.2. 系统 SHOULD 提供装载期能力，使"成为参与者"的实体在装载时自动获得 `play:roll-participant` 标记与起始投点等级（`rollTier`）初始值，而不依赖测试代码手动添加。

24.3. `playerQueue`（`world.props.play.playerQueue`）的**生产化注册**应转到装载/首次结算流程：受领参与者资格的实体应进入 `playerQueue`，且 `turnOrder` 长度恒等于 `playerQueue` 长度（沿用既有 `settleOnExit` 守卫）。

24.4. 该注册应解决 `PLAYER_QUEUE_GAP`：M10 `driveMultiTurn` 靠测试侧手动清/注册 playerQueue 的方式应转成生产自动注册，测试只用于断言生产注册行为，不再承担装载语义。

24.5. 系统 SHOULD NOT 让 UI / AI / devboard 拥有玩法层权威写权：凡"谁成为参与者"的写入都必须经 `OpRegistry.invoke`（`tag.add` / `prop.set`），不得由外部宿主直接改 `WorldState`。

24.6. 观战/退出（`permanentExitAttachment.onAdd` 现在 `tag del play:roll-participant`）后该实体不再满足参与者谓词；本 Spec 应将"永久退出者在装载后不得重回参与者集合"纳入装载期一致性断言。

24.7. 出生规则（Requirement 25）应能指向装载期参与者注册：为每个受领者写出起点（起始体力、起点状态、投点资格），使空态 → 参与者 → 首个 roll 的链条成为可自动装配的装载序。

24.8. 系统 SHOULD 提供 PBT 断言：对任意合法参与者集合，装载自动注册后参与者谓词与 `playerQueue`/`turnOrder` 长度三者一致，且无外部宿主写权参与。

**来源追踪：** S3 表 C-2（`PLAYER_QUEUE_GAP`、M10 手动清法）；S2 §2.7 演员面（玩家经装载期以参与者身份进入 playerQueue，学 M10 手动清法转自动注册）；S5 `rules.phase.ts`（`PARTICIPANT_PRED`）、`defs/ids.ts`（`TAG_ROLL_PARTICIPANT`、`PATH_PLAYER_QUEUE`）、引擎层 `pool-ops.ts`/`schedule-ops.ts`（playerQueue 生产注册点）、`state-machine.e2e.test.ts`（测试手动 tag add 现状）；S4 D-067~D-070。

### Requirement 25: 出生规则（起点装配）

**User Story:** 作为对局外壳的 domain-entry 消费者，我希望每个参与者在首个 roll 前已有明确的起点（起始体力、起点状态、投点资格），且默认不被推断。

#### 验收标准

25.1. 系统 SHOULD 定义出生规则承载面：空态 `createEmptyWorldState` → 装载五角色 props/statuses → 参与者就位 → 首 roll 之间，为每个参与者装配起点。

25.2. 起始体力 SHOULD 是一个显式且有归属的声明值，落于 1-5 或按内部规则放行；现行 `AP_POOL`/`STAMINA_POOL` 未声明 `initial`（默认回到 min/0）的"出生规则属下游"注释，应由本 Spec 转为明确的出生起点定义。

25.3. 系统 SHOULD 提供起点状态的声明入口：出生时可为参与者附加的初始状态（如初始 `rollTier` 起点、标注玩家/ NPC 身份的 `play:npc` 标记除外）显式声明，不推断额外状态。

25.4. 玩家与 NPC 的出生规则 SHOULD 分开声明：玩家起点走参与资格 + 出生装配；NPC 起点由 `NpcBudgetBinding` 与 `createPlayAiRuntime` 的稳定编号编排决定，二者不得混用同一条出生路径。

25.5. 出生规则应在装载期或首个 roll 前事务内完成起点写入，任何起点写入都经合法 Op；失败时装载应原子拒绝，不返回半初始化的对局。

25.6. 系统 SHOULD 把出生规则与 `createWsState`/`holder` 的"从空态到首 roll"连接登记为领域入口时序，但**具体的"五角色从何而来、数值几何"**仍属具体模式/装载配置，本 Spec 只定义承载面（Requirement 21.4）。

25.7. 系统 SHOULD 提供契约断言：出生装配后每名玩家参与者满足参与者谓词、拥有合法起点（不含未分类数值）、出生所在路径写入均走 `OpRegistry.invoke`，且装载失败时无部分起点落地。

**来源追踪：** S3 表 C-4（`AP_POOL`/`STAMINA_POOL` 注释"出生规则属下游，Requirement 18"、未声明 initial 默认 0，`load.ts` M10 靶"睡下→起床回满到 5"需出生装配）；S2 §2.8 domain-entry；S5 `defs/playpack.ts`（池 initial 注释）、`load.ts`；引擎层 `pool-ops.ts` 的 `initial` 默认（min/0）；S4 核心机制 Spec Requirement 18 未冻结契约表（"出生规则"现列为未冻结接口，本 Spec 明确其承载面）。

### Requirement 26: 胜负结算（OutcomeDef 的真实用法）

**User Story:** 作为对局外壳的胜负消费者，我希望 `OutcomeDef` 的 `when`/`scope`/`rank`/`onReach`/`ends` 被玩法层真实消费，并暴露可机械查询的胜负结果。

#### 验收标准

26.1. 系统 SHOULD 让既有的 `OutcomeDef` 形状被玩法层真实消费：`outcome.reach` 是记录事实的原语，本 Spec 应在其之上定义"谁 / 哪种结局 / 什么 rank 达成"的胜负结算声明，不改引擎层接口。

26.2. `OutcomeDef.when` 求值应是玩法层胜负判定的唯一真源：当 `when` 为真且该结局 `ends:true`，系统应把该结局记为"达成的终局结局"，并把 `scope`（`game`/`agent`/`faction`）与该结局绑定。

26.3. `OutcomeDef.rank` SHOULD 用于同一 scope 下多结局的优先级比较：rank 更高者优先作为该 scope 的终结结局；相等 rank 时按声明顺序或稳定次序取唯一者，且该优先次序在重放中复现。

26.4. `OutcomeDef.onReach` 的效果在结局达成时 SHOULD 沿合法事件链执行；其写入不得违反唯一写入通道，失败时整体回滚（结局不记成）。

26.5. 系统 SHOULD 暴露只读胜负查询：给定当前状态，可问到"是否已有胜负结论、终结结局名、终结 scope、胜出者 rank"，供对局外壳结算胜利条件使用。

26.6. 胜负结算的写入（把某结局记为终结结局、把终局判定字段置位）应在一个合法事务内原子完成，失败不得留下半终结态（结局已达成但终局判定未写）。

26.7. 系统 SHOULD 确保"胜负裁决的数值/rank"落在内部量级或玩家可见 1-5（如消耗可见的生命做败北判据）的合法归属内；任何参与胜负判定的玩家可见数值严格 1-5。

26.8. 系统 SHOULD 定期评估胜负只读结论的可查询能力：`05`BattleRoyaleMode 的 `victoryCondition` 目前是概念草稿，本 Spec 不实现它，但应提供它消费的"胜出者查询"承载面。

26.9. **已自证（Requirement 26.9）**：本 Spec 自身应证明"胜负结算契约"能在玩法层内完成——即 `outcome.reach` 记录 → 玩法层规则把 `ends:true` 结局写入终结判定 → 只读查询可读回，这一读写环无需依赖专项 B 即可在玩法层装载 + 规则 + 投影 + 契约测试内闭环（专项 B 只消费这个环的输出）。

**来源追踪：** S3 表 C-5（`OutcomeDef` 存在但无胜负声明、`05`BattleRoyaleMode `victoryCondition` 概念草稿）；S2 §2.4（对局外壳需胜负结算）；S5 `playpack.ts`（`outcome.reach` 原语）、引擎层 `outcome-ops.ts`（`outcome.reach` 记录事实、无端上语义）；S4 核心机制 Spec Requirement 18（"胜负条件"现列为未冻结接口，本 Spec 定义其玩法层承载面）。

### Requirement 27: AI runtime 接入装载/推进相位（C-6）

**User Story:** 作为 AI 演员入口的消费者，我希望 `createPlayAiRuntime` 接上 `loadCoreMechanics`/`advancePhase`，使 AI 与玩家走同一条判罚路径。

#### 验收标准

27.1. 系统 SHOULD 使 `createPlayAiRuntime` 能够消费 `loadCoreMechanics` 的装载结果（同一 holder / registry / ruleProvider / playpackLoader），使 AI 与玩家在装载期进入同一套玩法规则。

27.2. 系统 SHOULD 使 AI 的 NPC 队列填充（`seedNpcQueue`）与决策（`popNextNpc`）能挂进五阶段的 NPC 行动相位：`npcAction` 阶段驱动 NPCP 队列，AI 经 `BoundedAIDecisionFacade` 决策、经 `CoreMechanicsFacade.submit` 提交，走与玩家/UI 同一判罚路径（`CoreMechanicsFacade` 已保证 `submit` 无来源参数）。

27.3. AI 决策写入 NPC 队列、参与判定、与玩家参与者资格（Requirement 24）应保持同一套状态视图，AI 不得旁路 `OpRegistry.invoke` 直接改 `WorldState`。

27.4. 系统 SHOULD 提供契约断言：AI runtime 消费装载后，AI 请求与玩家请求得到相同合法性判定与相同拒绝原因（`*contract*` 断言面 + PBT）。

27.5. 装载 tip 完整性：`CoreMechanicsFacade.submit/resolve/advancePhase` 是玩法层统一提交入口；AI 不得引入第二套提交通道或来源分支。

27.6. `seedNpcQueue` 的稳定编号 / `play:npc` 标记的玩家资格（AI 视同玩家的参与行动轮资格按 D-052/D-053）应显式分区：NPC 不进入玩家投点、不进入行动轮（既有规则），但 AI 控制的**玩家形实体**参与行动轮。

27.7. 系统 SHOULD 把"AI runtime 与玩家驱动的装载一致性"纳入装配一致性门禁：与 `createFullHarness` 的 Op/Hook/Holder 装配字节级一致（沿用 S2 §Q-4 思路），或至少断言共享 registry 上 Op 装配不冲突。

**来源追踪：** S3 表 C-6（`createPlayAiRuntime` 从未接 loadCoreMechanics/advancePhase）；S2 §2.7 演员面（AI 接上 loadCoreMechanics+advancePhase、经 facade 提交）；S6 `ai-runtime.ts`（`createPlayAiRuntime` 现状、`seedNpcQueue`/`popNextNpc`）；S5 `load.ts`（`CoreMechanicsFacade`，`submit` 无来源参数）。

### Requirement 28: OVERLOAD_GAP 结算归属收账

**User Story:** 作为核心机制 Spec 的维护者，我希望 OVERLOAD_GAP 的归属被明确：过载的规范位阶与配置校验由核心机制 Spec 持有，但"真正触发过载的结算规则"的归属性被声明，避免双份实现并存而不自知。

#### 验收标准

28.1. 系统 SHOULD 把 `OVERLOAD_GAP` 结算归属收账为一条明确声明：`src/play/core-mechanics/` 包内过载配置校验（`validateOverloadConfig`，6 项检查）已落地，但**无消费规则**；真实过载结算当前只存在于 legacy `src/play/action-turn/playpack.json`（`rule:overload-on-pool-overflow` / `rule:overload-countdown` / `attachment:overloaded` / `rule:overloaded-block-intent`）。

28.2. 系统 SHOULD 判定这条归属：若把过载收束到本玩法层（`src/play/core-mechanics`），则应登记为"本 CEME 的补全任务之一，把 D-055 的过载语义以新规则落地到 core-mechanics 事件链（`pool.overflow` → `play.stamina.grant` 超上限 → 施加过载）；若决定保留在 legacy 包，则应显式声明 legacy 包为过载唯一权威并登记为交接项（专项 B 收账）。

28.3. 无论收束到哪一侧，系统 SHOULD 确保过载的**装载期配置校验**（Requirement 16.9 的 6 项）与**运行期结算规则**指向同一权威，不得出现"配置被校验但从不被消费"或"两处都自称实现过载"的分叉。

28.4. 系统 SHOULD 把 D-055 的"清理阶段自然恢复不触发过载"（Requirement 6.22）纳入归属声明，使 `staminaGrantRule` 对"满 5 不触发过载"与"其他来源超上限触发过载"两条路径边界清晰。

28.5. 系统 SHOULD 以 `*contract*` 断言 + PBT 验证过载结算归属：同一过载场景只走一条权威规则路径，不出现 legacy 与新规则双触发或零触发。

28.6. 系统 SHOULD 如实登记：若本 CEME 决定把过载收束进 core-mechanics，则该任务的交付物是"新增玩法层过载规则 + 对应测试"，落地边界必须是新声明式定义（Requirement 23.1），并更新该 `OVERLOAD_GAP` 登记为"已结算"。

**来源追踪：** S3 表 C-7（OVERLOAD_GAP 结算归属）；S2 §一、专项 B 收账项；S4 D-055（过载裁决）；S5 `ownership.ts`（`validateOverloadConfig` 6 项）、`load.ts` `defaultCoreMechanicsConfig().overload`、`defs/rules.phase.ts` `staminaGrantRule`（满 5 不触发过载）；legacy `src/play/action-turn/playpack.json`；核心机制 Spec Requirement 6、16（过载验收标准）。

### Requirement 29: 额外扫描——本 Spec 覆盖范围外的玩法层缺口登记

**User Story:** 作为审查者，我希望本 Spec 的额外扫描结论显式登记，不漏报 S3 表外的玩法层未定义处。

#### 验收标准

29.1. 系统 SHOULD 对本 Spec 完成额外扫描，覆盖 `src/play/` 下所有"本 Spec 范围之外 / 待下游"注释、所有 `GAP` 登记、所有未冻结的玩法层语义，并把扫描发现逐项登记为缺口或消解记录（design.md 的"额外扫描结论"章）。

29.2. 系统 SHOULD 至少扫描并登记以下已知跨线事实（不跨 Spec 改他人交付物，只登记为衔接项）：MapData `floor→layers` 契约扩展（独立专项，S7 现实 `types.ts` 仍 floor:int）、素材库元状态层、可用性钩子真逻辑（现全放行桩）、L1↔L2 注册表桥（基类层）。

29.3. 对每一扫描项，系统 SHOULD 判定其在玩法层内是可补全（进 design 的第 x 项设计 + tasks 的对应 task）、可自证（有可机械验收）、还是只能交接（登记为交接项，说明理由）。

29.4. 额外扫描的登记 SHALL NOT 变成"顺手实现"，判定为交接的项必须维持交接状态，不做 MVP、不做替代实现。

**来源追踪：** S3 §二末段（"逐一彻查中还应额外扫描……详见立项轮廓 §三交付物"）；S7 `map/types.ts`（floor:int 现状）；S2 §2.5（MapData 契约扩展独立专项）；S3 §四边界。

### Requirement 30: 门禁对齐与自证类要求

**User Story:** 作为质量工程师，我希望本 Spec 的全部实现与测试都能通过既定门禁，并区分"可自证"与"不可自证"。

#### 验收标准

30.1. 本 Spec 实现与测试的收尾门禁对齐：`npx tsc --noEmit`（全域 0 err）、`npx vitest run`（相关范围）、`npm run lint`、`npm run verify:docs`。

30.2. **已自证（Requirement 30.2）**：本 Spec 中凡判定"可在玩法层内自证"的缺口（C-1/C-2/C-3/C-4/C-5 的读写环、C-6 的同一判罚路径、C-7 归属声明），都应能由玩法层装载 + 规则 + 只读投影 + 契约断言 + PBT 闭环验证，不依赖专项 B 或基类层交付。

30.3. **不可自证（Requirement 30.3）**：本 Spec 中凡判定"交接给专项 B / 基类层"的缺漏（生产组合根、对局外壳、UI 宿主、UI/AI 消费胜利查询、L1↔L2 桥、MapData 契约扩展、具体模式胜负平衡、matchEnd 对外态切换），应在收尾综述与 design 中如实列明"无法在玩法层内自证"，不得谎报完成。

30.4. 每条 `*contract*` 断言面对应至少一条 PBT（fast-check，≥100 次迭代，标记 `Feature: wakeup-core-mechanics-exhaustive, Property N: …`）。

30.5. 系统 SHOULD 在收尾时结算 `PLAYER_QUEUE_GAP` 与 `OVERLOAD_GAP` 的登记状态（并入主状态板），并归档本 spec 到 `L_归档`（按 S3 §三交付物中"收账"项）。

**来源追踪：** S3 §三交付物之 4（门禁对齐与契约断言面）、之 5（收账项）；S2 §三（门禁对齐）；S4 核心机制 Spec Requirement 19（已自证类要求先例）。

---

### Requirement 31: 追溯与完整性（自证）

**User Story:** 作为设计评审者，我希望在进入设计阶段前能机械确认本 Spec 覆盖七项缺漏 + 额外扫描、无越层定义、无隐式默认值。

#### 验收标准

31.1. 本 Spec 的每条验收标准 SHOULD 至少落到一个 design.md 正确性属性或 tasks.md task，不得出现无落点的要求（Requirement 19 反向检查的延续）。

31.2. 本 Spec SHOULD NOT 为下述仍未冻结内容补写实现结论：具体模式胜负平衡、出生具体落点与具体角色数值、具体 MapData 实例、具体房屋/闸门/环境淘汰实例。这些只登记为承接自专项 B/具体模式的契约承载面。

31.3. 本 Spec SHOULD 证明七项缺漏 C-1~C-7 全部有定义与任务覆盖（design.md 的回溯表逐项核对），并证明跨线事实（Requirement 29 扫描项）有交接登记而非静默丢弃。

31.4. **已自证（Requirement 31.4）**：本 Spec 自身（requirements.md / design.md / tasks.md 三个文件）应当结构完整、每条 EARS/INCOSE 合规、每条有来源锚点、每个 task 有可测试验收；该自证可由一次结构审读与门禁（tsc 对 design 引用的既有类型、vitest 相关范围、lint、verify:docs 术语一致性）机器核对。

**来源追踪：** S3 §三交付物之 1（requirements 每条例挂权威锚点、含已自证类）；S8 `requirements.md` Requirement 19（准入反向检查先例）；S4。

---

## 未冻结契约（本 Spec 的边界重申）

本 Spec 定义的是**一局语义的玩法层承载面**（结局种类、终局判定、参与者资格、出生起点装配、胜负结算契约、OVERLOAD_GAP 归属声明）。以下内容**仍属未冻结接口**，本 Spec 不默认化：

- 具体模式的胜负规则、`victoryCondition` 的具体判负/判胜值、出生具体落点、五角色具体出生数值。
- MapData `floor→layers` 契约扩展的具体形态（任意 `height?:number`、`opacity` 公式、跨层可见性）——独立专项，不并进本 Spec。
- L1↔L2 注册表桥的形状与接线——基类层缺漏。
- 生产组合根 / 对局外壳 / UI 宿主的对外态切换与事件出口——专项 B。
- 具体房间/闸门/物品/武器 Instances——space-items 等下游配置。
