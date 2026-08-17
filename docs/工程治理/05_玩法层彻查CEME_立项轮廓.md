# 专项 CEME — 玩法层彻查与补全（Core Mechanics Exhaustive）

> **性质**：立项轮廓（预立项）。本文件把"玩法层拥有引用权"的定性落地为一次**针对于整个玩法层**的需求彻查——把一直以来"暧昧、等出来之后再补玩法"的缺口，全部点名并按设计原则定义；彻底审查之后，对每一处的实现与解决各写一个 task，整体整合成一个 spec。
> **位置**：工程治理域（规划/立项入口）；它所规划的交付物属玩法层，最终 spec 落 `.kiro/specs/wakeup-core-mechanics-exhaustive/`。
> **依据**：`docs/L_归档/工程治理_历史/04_整合层_装载运行期_规划设计.md`（§四专项切分、§五 Q-2/Q-3/Q-4；04 规划文档已完成使命归档，见 loading-runtime spec）、`docs/00_主状态板.md`"尚待立项独立专项"、`docs/L3_玩法层/*` 设计需求。
> **与整合层关系**：整合层本体（专项 B）是**下游消费方**；CEME 是整合层的**硬前置**——不先彻查并补全玩法层未定义处，整合层就无法定义对局外壳与演员入口。
> **红线**：不写实现、不建 spec 结构，本文件只划范围、列可证伪缺漏与设计原则依据，等待立项批准后经 `generate-spec` 产出正式 spec。

---

## 一、为什么要彻查（背景）

三层依赖链以"已装载对局"收束，但玩法层对"一局"的边界长期持暧昧态度——"先出地基、等之后再补玩法"。这导致一批**属于玩法层却迟迟未定义**的契约悬空，整合层无法据此成形。owner 定型：**玩法层拥有对基类/引擎能力的引用权，是组合与装载的唯一宿主**。因此这些悬空处不是整合层能猜的，而是玩法层必须彻查、并逐一按设计原则定义的缺漏。

## 二、彻查范围（针对于整个玩法层）

以下每个缺漏都要在审查后给出"现状 → 缺什么 → 按哪条设计原则 → 如何定义/实现 → 如何测试证伪"：

| # | 缺漏 | 现状 | 设计原则依据 | 属整合层哪项前置 |
|---|------|------|-------------|-----------------|
| C-1 | **一局可声明的结局种类** | `PlaypackDef.outcomes?: OutcomeDef[]` 类型已存在（`name`/`when`/`scope`/`rank`/`onReach`/`ends`），但 `CoreMechanicsPlaypack.outcomes` **空着**；`OutcomeDef` 只有类型无人消费 | `04_整合层` §四 Q-2；对局外壳需结局契约作终局判定 | 专项 B 对局外壳 |
| C-2 | **玩家参与者资格判定 + PLAYER_QUEUE_GAP** | 玩家 actor 无装载期自动入 `ruleProvider` 的 playerQueue；M10 `driveMultiTurn` 靠测试侧手动清法，未转生产自动注册 | `04_整合层` §四 Q-4；`PLAYER_QUEUE_GAP` 已登记 | 专项 B 演员入口 |
| C-3 | **回合/对局量级边界（round 计数、游戏终结点）** | 五阶段 schedule `loop:true`、`order:'fixed'`，回合无限循环无终局概念 | 对局外壳需"一局有没有结束"判定 | 专项 B 对局外壳 |
| C-4 | **出生规则（起始体力/起点状态）** | `AP_POOL`/`STAMINA_POOL` 注释明确"起始体力不在本 Spec 范围（出生规则属下游，Requirement 18）"且**未声明 initial（默认 0）** | `load.ts` M10 靶"睡下→起床回满到 5"需出生装配 | 专项 B domain-entry |
| C-5 | **胜负结算（谁赢/胜出条件查询）** | `OutcomeDef` 存在但无任何胜负声明；`05`BattleRoyaleMode 的 `victoryCondition` 仅概念草稿 | 对局外壳需胜负结算 | 专项 B 对局外壳 |
| C-6 | **AI runtime 接入装载/推进相位** | `createPlayAiRuntime` 从未接 `loadCoreMechanics`/`advancePhase` | `createPlayAiRuntime` ≥接上后走与玩家/UI 同一判罚路径 | 专项 B 演员入口 |
| C-7 | **OVERLOAD_GAP 结算归属** | core-mechanics 包内过载为**如实登记的未落差距**（真实过载在 legacy action-turn 包） | `04_整合层` 专项 B 收账项 | 专项 B 收账 |

> 逐一彻查中还应**额外扫描**：`src/play/` 下所有"本 Spec 范围之外/待下游"注释、所有 `GAP` 登记、所有未冻结的玩法层语义——不限于上表七项。审查结论若发现新缺漏，追加进表内。

## 三、交付物（立项后经 `generate-spec` 生成）

1. **requirements.md**：EARS 模板、INCOSE 质量规则，每条挂权威锚点（宪法铁律/访谈裁决/`04_整合层`/设计需求），含"已自证"类要求。
2. **design.md**：预扫导出的正确性属性（全称量化 + 要求回溯），每个缺漏一条"现状→定义→证伪"回路。
3. **tasks.md**：审查结论逐项 -> 一个 task，整体整合成一个 spec；含检查点 + 承 `*PBT*` 断言（装配一致性/接线方向/无越权写）。
4. **门禁对齐**：`npx tsc --noEmit`（全域 0 err）+ `npx vitest run`（相关范围）+ `npm run lint` + `npm run verify:docs`；新增 `*contract*` 断言面。
5. **收账**：结算 `PLAYER_QUEUE_GAP`/`OVERLOAD_GAP`，主状态板入账，归档本立项轮廓到 `L_归档`。

## 四、与整合层的边界（绝不越界）

- CEME 只补**玩法层**缺漏（把玩法语义定义清楚）。**不造**生产组合根、对局外壳、UI 宿主——那些是专项 B。
- L1↔L2 注册表桥归**基类层**（`04_整合层` Q-5 已裁，随"越底层越好"定性），不并进 CEME。CEME 的 prompt 里已设**硬边界**：任何"注册表桥 / L2 适配器接线 / 基类层契约"只能 Read、不得要求玩法层实现，只能登记为交接项丢回基类层去向对账。
- CEME 交付后，其产物须经统一门禁收敛为**已冻结版本**，专项 B 才以之加载（避免整合层倒挂依赖未冻结玩法层）。

## 四·补、基类层注册表桥（专项之外、独立去向）

> 本段把"注册表桥"这一被裁归基类层的缺漏，登记为**基类层去向缺漏**，跟随整合层/CEME 推进共同追踪，保证"桥被补全 + 有测试归属"落到执行层面而不悬空。

**现状（2026-08-15 实测核验）**：
- 桥的两个产地（`src/l2/kernel/op-registry-adapter.ts::createKernelContractFromOpRegistry`、`src/l2/kernel/kernel-contract.ts::KernelContract`）**类型已冻结**，`src/l2/决策与风险记录.md:154-155` 已登记为 L2 稳定端口。
- 但 `createKernelContractFromOpRegistry` 的**生产调用点为 0**——全仓仅 `test/l2/integration/end-to-end.integration.test.ts`、`test/properties/P12-*.test.ts`、`src/l2/决策与风险记录.md` 引用它，没有任何生产代码实例化真实桥（探针与插桩是测试用的近似，插桩里也未见正式 createOpRegistry 调用）。
- UI/AI 适配器（`src/l2/adapters/ui-adapter.ts`、`ai-adapter.ts`）只做 `type import` KernelContract，且 `adapters/index.ts` 只 `export *`，没有一处用真实 L1 OpRegistry 装好 KernelContract 再喂给它们——等于桥的"生产端插头"造好了却**从没插进墙里的插座**。

**缺漏定义**：需要一个**生产装配点**（属基类层/专用桥 spec）用真实 L1 `OpRegistry` 调 `createKernelContractFromOpRegistry`，产出工程内置的 KernelContract，并经自动化契约测试断言：`invoke` 只走真实 `OpRegistry.invoke` 单通道、`hasOp`>真实 `has`、错误 `code/detail` 原样透传、`hookIntegrationAvailable` 不伪造、接线冲突（false）时依赖 Hook 动作被拒。

**去向**：开**基类层注册表桥专项/交接项**，或由整合层专项 B 在 UI 宿主接线时消费（届时才真正有生产 OpRegistry 可装）。本文件的 04 文档 Q-5 已落"桥归基类层"归属，本段补充了现状核验与测试归属，防止它被当"碍眼小事"搁置。

> **✅ 已闭环（2026-08-16，专项 D 落地）**：生产装配点 `src/l2/kernel/registry-bridge.ts`（`createRegistryBridge`）已用真实 L1 实例产出 KernelContract + 只读 Def 视图，`createKernelContractFromOpRegistry` 生产调用点 0→1；契约测试 `test/l2/integration/registry-bridge.contract.test.ts` 8 绿覆盖本段缺漏定义的全部断言面。剩余"UI/AI 适配器接桥"属消费方接线（04 文档 §2.3 承接链，专项 B 消费），不再是本缺漏未实现。

> ⚠️ 纠偏（owner 确认）：桥归基类层是被裁归属，但"修"/"实现"的**动作**由基类层去向负责；整合层/CEME 只登记、只交接、不代做，避免跨线越权。

## 五、待批准

- 立项范围（§二 七项缺漏 + 额外扫描）是否开放给本专项执行。
- 开工顺序：CEME 专项 A 先行，审计 + 全面测试后，再立项专项 B（整合层本体）。
