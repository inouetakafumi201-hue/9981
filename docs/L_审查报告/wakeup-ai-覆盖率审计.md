# wakeup-ai 覆盖率审计（PT-04）

> **性质**：审计报告，**只陈述事实、不裁决**（`docs/00_并行作战手册.md` §五）。本文不下"必须删除 / 违反原则 / 应当重构"这类结论。
> **目的**：把 `wakeup-ai` 的"高信任"从 **"组件齐全 + 9 个测试文件全绿"** 升级为 **"逐条验收标准可证"**。
> **审计日期**：2026-08-10
> **审计范围**：`.kiro/specs/wakeup-ai/requirements.md` 全部 **12 条需求 / 71 条验收标准** × `src/core/kernel/ai/__tests__/` 全部 **9 个测试文件**（完整阅读，未跳读）。
> **审计方法**：逐条验收标准反查断言。行号为审计时刻（2026-08-10）的行号，`it()` / `describe()` 标题为**原文照抄**。

---

## 〇、结论先行

**`wakeup-ai` 的"高信任"不是逐条成立的。** 逐条核对后的分布是：

| 档位 | 含义 | 条数 | 占比 |
|---|---|---|---|
| ✅ **有直接断言** | 存在测试明确断言该验收标准描述的行为 | **44** | 62.0% |
| ◐ **仅间接覆盖** | 有测试路径经过该逻辑，但缺针对该条的断言（或只覆盖了该条的一部分） | **23** | 32.4% |
| ⬜ **无覆盖** | 找不到任何断言 | **4** | 5.6% |
| 合计 | | **71** | 100% |

> **勘误与守卫回流（2026-08-10）**：初版记为 43✅/22◐/6⬜。第一次复核发现 **12.4 判错**——代码侧已被扫描整个 `src/` 的仓库级守卫覆盖，故先修正为 43✅/23◐/5⬜。随后落地 `test/toolchain/spec-document-discipline.test.ts`：B-20 逐要求小节验证来源 footer，使 12.1 从 ⬜ 升为 ✅；B-19 扫描活跃 `.kiro/specs/**` 与 `docs/**`，但仍以精确棘轮承认 6 个文件中的 **23 处既有违规**，故 12.4 保持 ◐。最终为 **44✅/23◐/4⬜**。

**按需求聚合**：

| 需求 | ✅ | ◐ | ⬜ | 该需求可信程度（仅陈述） |
|---|---|---|---|---|
| 要求 1 角色/策略类别/层级边界 | 4 | 1 | 0 | 高 |
| 要求 2 人类与 AI 同权合法着法 | 4 | 1 | 0 | 高（但"同权"的关键断言是包含关系，非集合相等，见 2.2） |
| 要求 3 认知边界与认知切片 | 6 | 0 | 0 | **最高**，含 2 个 200 次 fast-check 性质 |
| 要求 4 顺序多人搜索与 depth 语义 | 2 | 3 | 0 | 中（maxⁿ 强，depth 定义无断言） |
| 要求 5 精算/粗略分层与语义意图 | 3 | 3 | 0 | 中（分层强，宏动作/语义意图弱） |
| 要求 6 评估边界与无效值 | 5 | 1 | 0 | 高 |
| 要求 7 Decision/Intent/Policy 与过期候选 | 5 | 2 | 0 | 中高（**延后/Decision 分支零覆盖**） |
| 要求 8 试探/随机/唯一写入通道 | 3 | 3 | 0 | 中高（回滚强，影子随机流弱） |
| 要求 9 行为类/NPC 配置/数值归属 | 2 | 4 | 0 | 中（1–5 数值强，状态机归属弱） |
| 要求 10 跨系统接口契约 | 6 | 0 | 1 | 高，但 **10.7 逐字段登记完全缺失** |
| 要求 11 可验证诊断与可解释性 | 2 | 3 | 1 | 中（状态回滚强，可重放性无断言） |
| 要求 12 来源可追踪性与未决项保护 | 2 | 2 | 2 | **最低**；来源追踪已机器化，术语侧仍保留 23 处既有违规基线，登记件仍缺失 |

**三处最值得注意的事实**（不含裁决）：

1. **延后提交路径零覆盖**：`commit-adapter.ts:155` 的 `outcome: 'submitted-intent'` 分支只在 `isDeferred(def)` 为真时进入，而全部 3 个内核测试都写死 `isDeferred: () => false`（`kernel-adapters.test.ts:163`、`kernel-adapters.test.ts:291`、`sequential-kernel.test.ts:177`）。`outcome: 'opened-decision'` 在**实现中根本没有任何产出点**，只存在于 `types.ts:222` 的联合类型里。
2. **宏动作的合法性守卫零覆盖**：`candidate-planner.ts:117` 的 `AI_CANDIDATE_ILLEGAL`（"macro step outside the current legal action set"）由 `intentUsesOnlyLegalActions`（`candidate-planner.ts:47`）驱动，只在 `CandidateSeed.intent` 存在时触发。唯一测到 organizer 的用例 `decision-facade.test.ts:82` 返回的 seed **不带 `intent`**，因此命中的是上一条守卫（`candidate-planner.ts:114`）。`SemanticIntent.orderedSteps` 在 9 个测试文件里**从未被构造过**。
3. **要求 10.7 / 12.5 / 12.6 所要求的"逐字段登记"没有承载物**：AI 模块能在诊断里报"某上游契约未冻结"（`diagnostics.ts` 的 `unavailableContract`，断言见 `contracts.test.ts:68`），但不存在满足 10.7 的登记结构（12 个属性 × 6 个必覆盖领域）。全模块检索 `ContractRegistry` / `PendingContract` / `contractLedger` 无命中。

---

## 一、判定口径（这些是审计者的判断，需明确标注）

以下 5 条是审计过程中必须做、但 requirements.md 没有规定的判断。**它们会影响 ✅/◐ 的分布**，因此显式列出以便复核者按自己的口径重算：

1. **"直接断言"的边界**：测试必须断言该验收标准描述的**可观察结果**（返回码、状态字段、投影内容、状态不变）。仅"代码路径被执行到"不算。例如"提交后世界状态未变"必须有 `expect(after).toBe(before)` 之类的断言，只跑通不算。
2. **替身驱动的分类透传 = ◐ 而非 ✅**：若某诊断分类是由注入的替身直接返回、再断言 facade 原样透传（典型：`decision-facade.test.ts:164` 的 `AI_DECISION_STALE`），则只证明了"分类不丢失"，没有证明"真实生命周期状态会产生该分类"。这类记 ◐。
3. **类型层断言计入 ✅**：`contracts.test.ts` 顶部的 `type Assert<T extends true>` + `playerCannotAct` 是编译期断言，PT-06 之后 `test/**` 与 `src/**` 全在 `tsc` 检查范围内，故它是**真门禁**，计入 ✅。
4. **源码文本断言计入 ✅（但标注其范围）**：`ai.test.ts:16`、`contracts.test.ts:314` 用 `readFileSync` + 正则断言"某类实现不存在"。这类断言对"不得引入 X"型验收标准是有效证据，但**只覆盖它显式列出的文件**，因此凡引用它的条目都注明扫描范围。
5. **对"本需求不得固化 X"这类文档级禁令**：若其唯一可机器化形式是源码扫描而无该扫描，记 ◐ 或 ⬜ 并说明"该条部分内容是文档约束，非运行期行为"。不因"它本来就难测"而抬高档位。

---

## 二、逐条覆盖矩阵

> 证据列格式：`文件:行号` + `it()` 原文标题。行号指向 `it(` 所在行。

### 要求 1：AI 角色、策略类别与层级边界

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 1.1 | 两类策略标记为不同类别；每策略绑定明确 Agent 与受控实体集合 | ✅ | `contracts.test.ts:62` `uses a discriminated request union: player assistance cannot act`（含编译期 `Assert<PlayerCannotAct>`）；受控实体集合的强制见 `contracts.test.ts:108` `uses an adapter-filtered immutable read scope and rejects uncontrolled actors`（`queryActions({$:'e:other'})` → `AI_CANDIDATE_ILLEGAL`） | — |
| 1.2 | 两类共享引擎层 Query/queryActions/Policy/Decision/Intent/事务/持久化/诊断契约；不得因类别不同提供专用作弊读写接口 | ◐ | `integration.test.ts:212` `uses the same legal action source and commits NPC actions only through the canonical chain`（两类走同一 facade、同一 scope 构造、同一 commitGateway）；`contracts.test.ts:314` `does not place full-state or write-channel types in the formal public API` | 只证明了 **queryActions 与提交链**对两类同源。**Decision / Intent / 事务 / 持久化**契约的"同权"没有按 category 分别断言；也没有"不存在按 `category` 分支的权限差异"这一针对性断言（现有测试是"两类都用同一份配置"，而非"即使配置不同也不能获得特权"） |
| 1.3 | 拒绝把玩家辅助策略直接赋作 NPC 策略（反之亦然），除非经验证的基类层适配声明兼容 | ✅ | `decision-facade.test.ts:225` `rejects forged player action requests before any submission` → `AI_POLICY_BINDING_INVALID` 且 `commits` 为空；`integration.test.ts:193` `rejects code, extra privileges, unregistered policies and mismatched categories`（`category` 不匹配被拒）；实现侧守卫在 `candidate-planner.ts` 的 `behavior.category !== request.category` | **例外分支未测**：没有任何用例构造"经验证的适配定义声明兼容"并断言此时允许通过 |
| 1.4 | 算法选择/行为范式/感知参数/地图策略/数值配置分别归入候选实现、基类层 Schema 或玩法层配置 | ✅ | `kernel-adapters.test.ts:403` `rejects a play value hardcoded in a reusable definition` → `AI_PLAY_CONFIGURATION_REQUIRED`；`ai.test.ts:16` `contains no legacy global-state search implementation or gameplay-field score heuristic`（断言 `alphaBeta`、`props?.['hp'\|'maxHp'\|'damage']` 均不出现） | `ai.test.ts:16` 的扫描范围只有 5 个文件（`index.ts`、`search.ts`、`belief-slice.ts`、`tiering.ts`、`evaluate-guard.ts`），不含 `facade.ts`、`sequential-search.ts` 等主要实现文件 |
| 1.5 | 策略装载或绑定失败时产生 AI 诊断（含失败类别/受控实体/不兼容契约）且不改变语义状态 | ✅ | `decision-facade.test.ts:232` `fails closed when a policy adapter is unavailable` → `AI_CONTRACT_UNAVAILABLE` 且 `commits` 为空；`kernel-adapters.test.ts:412` `rejects a missing required parameter, an abstract binding and an out-of-range player value`；诊断字段完备性见 `contracts.test.ts:68` `creates diagnostics with all mandatory correlation fields`（断言 `category`/`agent`/`controlledEntity`/`policy`/`correlationId`/`phase`）；"不改变语义状态"的真实内核版本见 `integration.test.ts:227` `fails closed before planning, evaluation or submission when the safe Query/Knowledge adapter is not frozen`（`evaluations===0`、`submissions===0`） | 绑定失败场景在**真实内核**上没有配套的"世界状态未变"断言（真实内核的状态不变断言出现在 recommend 成功路径 `kernel-adapters.test.ts:461`） |

### 要求 2：人类与 AI 的同权合法着法契约

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 2.1 | `queryActions` 结果是候选动作的唯一权威来源 | ✅ | `decision-facade.test.ts:74` `uses the scoped legal action result as its only exact-tier candidate source`（候选序列等于 scope 提供的着法序列）；`decision-facade.test.ts:82` `requires base-layer relevance metadata in coarse tier and rejects organizer inventions`（凭空造动作 → `AI_CANDIDATE_ILLEGAL`） | — |
| 2.2 | AI 与人类对同一实体/认知/状态得到**相同**合法着法、前置条件结果、目标约束与代价结算结果；有限采样不改变合法性 | ◐ | `kernel-adapters.test.ts:474` `offers exactly the legal actions a human sees for the same entity` | **测试标题强于其断言**：实际断言是 `expect(humanActions).toContain(recommendation.candidate!.legalAction.action)`，即"AI 选的那一个在人类列表里"（**包含关系**），并非标题所称的集合相等。因此"AI 看到的合法着法集合 == 人类看到的"这条**没有被断言**。另：**前置条件结果、目标约束、代价结算结果**三项均无比对断言（所有测试的 `cost` 皆为 `[]`）；"范围/多目标参数的有限采样不改变合法性"无任何用例 |
| 2.3 | 不得选择未出现在 `queryActions` 中的动作/绑定/目标；不得以评分高豁免 `require`/`visible`/成本/目标约束 | ✅ | `decision-facade.test.ts:82`（同上，organizer 造动作被拒）；`kernel-adapters.test.ts:268` `refuses an action that the ActionCatalog does not currently offer` → `AI_CANDIDATE_ILLEGAL` 且 `world.intents` 为空 | "以内部评分高为由豁免"没有对抗性用例（现有拒绝用例都不设置高分）。结构上评分在 planner 之后产生，但无断言 |
| 2.4 | 候选生成后变非法/目标失效/成本不可承担 → 拒绝、不提交效果、产生诊断 | ✅ | `decision-facade.test.ts:153` `rejects stale versions and missing current legal membership before submit` → `AI_KNOWLEDGE_CHANGED` / `AI_CANDIDATE_ILLEGAL`；`kernel-adapters.test.ts:276` `reports a void intent when the precondition lapses between submit and resolve` → `AI_INTENT_VOID` 且 `world.props.aiResolveCount` 为 `undefined`（效果确实未执行） | 三种失效原因里只有**前置条件失效**在真实内核上被断言；**目标失效**与**成本不可承担**无用例 |
| 2.5 | 新增 ActionDef 自动进入候选空间；粗略层要求相关性标记；单个未标记动作只被排除不改变合法性；仅配置缺失/引用损坏/必需集合为空才拒绝；配置完整但全未标记 → 可区分的正常 no-op/回退，可记信息性诊断但不得报为无合法 Action 或配置错误；不得维护 AI 专用清单 | ✅ | `decision-facade.test.ts:95` `distinguishes coarse-tier configuration gap, normal no-op, and genuine no-legal-action`（四种情形逐一断言：缺配置→`AI_TIER_CONFIGURATION_MISSING`；配置全但无标记→`noOp.kind==='coarse-no-relevant-action'` + `declaredFallback`；有标记→只该动作成为候选；真的无可执行着法→`AI_NO_LEGAL_ACTION`）；`decision-facade.test.ts:244` `returns an info-level no-action, not an error no-legal-action, when coarse tier is configured but no legal action is marked relevant`（`diagnostics` 长度恰为 1、`severity:'info'`、显式断言不含 `AI_NO_LEGAL_ACTION` 与 `AI_TIER_CONFIGURATION_MISSING`、`commits` 为空）；`coarse-no-relevant-action.property.test.ts:63` `Feature: wakeup-ai, Property 1: coarse tier fully configured with no relevant legal action yields a distinguishable no-op, never AI_NO_LEGAL_ACTION or AI_TIER_CONFIGURATION_MISSING`（fast-check 200 次）；相关性来源于 Def 属性路径而非 AI 内部清单，见 `kernel-adapters.test.ts:383` `accepts a concrete play binding and exposes coarse relevance` | 三种拒绝原因里**"引用损坏"（broken reference）没有独立用例**，只测了"缺失"。"新增 ActionDef 自动进入候选"是通过"候选恒等于 scope 着法列表"间接证明的，没有"注册一个新 ActionDef 后它出现在候选里"的端到端用例 |

### 要求 3：认知边界与认知切片

> 本需求是全文档覆盖最强的一条：**6/6 全部 ✅**，且含 2 个 200 次 fast-check 性质。

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 3.1 | 每次决策根节点构造认知切片，只用带 `visibleTo` 的 Query、`knowledgeScope`、公开 Policy 上下文与已声明只读契约 | ✅ | `kernel-adapters.test.ts:187` `applies the play visibleTo predicate and never exposes a hidden entity`（真实 `QueryEngine` + 玩法提供的 `visibleTo` 谓词；并断言 `policyContext['policy.id']`）；`contracts.test.ts:108`（`query({from:'entities'})` 缺 `visibleTo` → `AI_CONTRACT_UNAVAILABLE`，且断言底层 `queryVisible` 调用次数为 0，即**未过滤查询根本没被执行**） | — |
| 3.2 | 切片含可见事实 + Knowledge 记录的可标记为历史/不确定的信息；不得为既不可见也无合法记录的对象伪造 | ✅ | `kernel-adapters.test.ts:205` `separates live observation from retained knowledge`（`certainty:'observed'` vs `certainty:'historical'`）；`contracts.test.ts:200` `rejects malformed provenance, duplicate refs and adapter exceptions instead of publishing an unsafe slice`（缺 `observedAt`/`certainty` 的 `knownFacts` → 整个切片 `AI_CONTRACT_UNAVAILABLE`，即失败关闭而非发布无出处事实） | — |
| 3.3 | 公开入口不得接收或保留未过滤的完整世界状态；引擎层内部读取受同一规则约束 | ✅ | `contracts.test.ts:314` `does not place full-state or write-channel types in the formal public API`（对 `types.ts`/`read-gateway.ts`/`behavior-validation.ts` 断言不 import `world-state`/`ops/registry`/`ops/transaction`，且不出现 `setState(`/`invoke(`/`listLegalActions`）；`ai.test.ts:7` `exposes the bounded facade and removes the legacy state-taking entry points`；`kernel-adapters.test.ts:216` `filters a caller query that omits visibleTo`（内部读取也被过滤） | — |
| 3.4 | 不得通过完整世界状态/隐藏 Intent/他人私有 Knowledge/不可见容器内容/推断性旁路取得不可见信息 | ✅ | `contracts.test.ts:229` `Property: private Intent, container and foreign Knowledge markers never appear unless the validated adapter projects them`（fast-check 200 次，对序列化后的切片+着法做 `not.toContain`）；`contracts.test.ts:154` `deeply clones and freezes slice/action output so adapter aliases cannot become read or write side channels`（深冻结 + 事后修改适配器源对象，断言已发布切片不变）；`sequential-kernel.test.ts:323` `keeps a hidden entity out of every participant scope during search`（整条搜索链中隐藏实体不出现在任何参与者作用域） | — |
| 3.5 | 认知范围或已知事实在候选生成后变化 → 候选失效并重新验证；不能重验则拒绝 + 诊断 | ✅ | `decision-facade.test.ts:153`（`isCurrent` 返回 false → `AI_KNOWLEDGE_CHANGED`）；`kernel-adapters.test.ts:235` `produces deterministic versions that change when readable information changes`（改动 `world.knowledge` 后 `isCurrent` 变 false，真实内核） | — |
| 3.6 | 仅当上游 `Agent.omniscient` 合法启用才可省略过滤；该例外不得被 AI 专用配置模拟或扩大 | ✅ | `kernel-adapters.test.ts:225` `honours a legitimate upstream omniscient agent only`（`g:seer` 的 `omniscient` 来自上游 Agent 形状，能看到隐藏实体）；"不得被模拟或扩大"见 `integration.test.ts:193`（UGC 声明 `omniscient:true` → `AI_POLICY_BINDING_INVALID`） | — |

### 要求 4：顺序多人搜索语义与连续单步 depth

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 4.1 | 采用老实模型 maxⁿ；不得把其他参与者合并为虚构联合极小化对手 | ✅ | `simulation-search.test.ts:166` `uses honest MaxN: every participant selects its own score component instead of minimizing the root participant`。该用例设计了收益矩阵使 maxⁿ 与极小化产生**不同选择**（对手选 selfish 得 5 → 根选 `a:bait`；若对手被建模为极小化者会选 spite 迫使 bait 得 0 → 根会误选 `a:safe`），并断言 `result.value?.legalAction.action === 'a:bait'` 与完整 `scoreVector`。这是全文档中构造最有力的一条断言 | — |
| 4.2 | depth 定义为连续单步决策点数量；一个决策点只对应当前一个决策者一次可提交的单步选择 | ◐ | `simulation-search.test.ts:80` `derives and plans every next participant from its own context, restores every explored branch, and selects the root self-maximizing score`（`decisionPoints: 5` 预算下遍历 root→second→third，断言 `restore:` 事件恰 6 次）；`sequential-kernel.test.ts:267` `advances through the phase actor query in initiative order`（下一个决策点是**下一个 actor**，不是下一轮） | **没有对 depth/decisionPoints 计数语义本身的数值断言**：不存在"N 个参与者依次决策消耗 N 个 `decisionPoints`"这样的用例。`sequential-kernel.test.ts` 的 `rootRequest()` 给了 `decisionPoints: 40` 的宽松预算，因此计数是否按"单步决策点"递减未被观测 |
| 4.3 | 不得把 depth 解释为完整角色回合数/相位批次数/同时结算轮数 | ◐ | `sequential-kernel.test.ts:403` `advances to the next phase and continues with its first actor`（链条以 actor 粒度跨相位推进，而非以相位为批次；并断言 `world.turn.phaseIndex === 1`） | 这是"实现按 actor 粒度推进"的间接证据。**没有针对 depth 计数器语义的断言**（例如"跨越一个完整相位不等于 depth+1"） |
| 4.4 | 多个 Intent 收集后依序解算；不得假设或创建真正同时发生的状态写入 | ✅ | `kernel-adapters.test.ts:253` `commits through intent.submit and intent.resolve and actually changes state`（真实 `intent.submit`/`intent.resolve` Op，断言恰 1 个 intent 且 `status==='resolved'`）；`sequential-kernel.test.ts:300` `plans every derived participant from its own context and commits only the root choice`（探索了 3 个参与者的多分支，最终 `world.props.resolved === 1`、`intents` 恰 1 条、归属根参与者） | — |
| 4.5 | 玩家可见难度档与内部 depth/预算/搜索方式的映射交由玩法层；本需求不得指定固定档位数量/固定 depth/固定难度数值 | ◐ | `contracts.test.ts:283` `validates provenance and player-visible values without constraining internal metrics`（`search.maxNodes = 99` 标记 `internalMetric:true` 被接受，证明预算是**内部度量**、不受 1–5 玩家可见约束）；`kernel-adapters.test.ts:497` `drives a mode:search policy through the bridge without writing state`（`searchDepth` 来自玩法提供的 `PolicyDef`，非 AI 模块常量） | **"难度档 → depth/预算/搜索方式的映射由玩法层配置"这件事本身无断言**：没有任何用例构造难度档并断言其映射归属。本条后半（"本需求不得指定固定档位"）是文档级禁令，其可机器化形式（扫描 AI 源码内无固定档位/固定 depth 常量）**不存在** |

### 要求 5：精算/粗略分层与语义意图的合法性

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 5.1 | 支持精算/粗略两种展开模式；在搜索链**根节点**确定层级；递归中不得因分支临时状态变化隐式切换 | ◐ | 两种模式各自有断言：精算 `decision-facade.test.ts:74`；粗略 `decision-facade.test.ts:82` 与 `decision-facade.test.ts:95`。实现侧 `tier` 随 `AIPlan` 冻结（`candidate-planner.ts` 的 `tier: request.tier`） | **"整条搜索链层级不变"无断言**：`simulation-search.test.ts` 中派生参与者的 request 由 `request()` 辅助函数各自构造（都恰好是 `'exact'`），没有断言"派生上下文的 tier 必须等于根的 tier"。因此隐式切换是否可能未被门禁覆盖 |
| 5.2 | 粗略层只考虑玩法层通过基类层兼容 Schema 显式标记为相关的合法着法；未标记不得被 AI 自行假定相关 | ✅ | `decision-facade.test.ts:82`（无相关性投影 → `AI_TIER_CONFIGURATION_MISSING`，不退化为精算）；`decision-facade.test.ts:95`（只有被标记的 `a:move` 成为候选，且 `noOp` 为 `undefined`）；标记的来源是基类层 Schema 声明的属性路径，见 `kernel-adapters.test.ts:383`（`relevantActionsPath: 'props.relevantActions'` 由 `AIBehaviorFamilySchema` 提供，断言 `relevantActionIds` 解析为 `[{$:'a:hold-position'}]`） | — |
| 5.3 | 配置缺失/引用损坏/必需集合为空 → 保守不扩张 + 拒绝 + 配置或空集合诊断，不得解释为精算默认；单个未标记动作只过滤不逐个诊断；配置完整但全未标记 → 可区分正常 no-op/回退，可记信息性诊断但不得误报 | ✅ | `decision-facade.test.ts:95`（四情形逐一断言，见 2.5）；`decision-facade.test.ts:244`（`diagnostics` 长度**恰为 1** → 直接证明"未标记动作不逐个产生诊断"；`severity:'info'`、`phase:'plan'`、`reason` 含玩法声明的回退态 `'idle'`）；`coarse-no-relevant-action.property.test.ts:63`（200 次随机化，执行集与相关集刻意取不相交） | 同 2.5：**"引用损坏"无独立用例** |
| 5.4 | 语义意图可生成/归类/筛选候选宏动作；不得成为独立决策状态、绕过 `queryActions` 的动作来源或直接写入通道 | ◐ | 禁令半边有断言：`decision-facade.test.ts:82` 的 `inventingPlanner`（即注入的 `SemanticIntentOrganizer`）产出集外动作 → `AI_CANDIDATE_ILLEGAL`（命中 `candidate-planner.ts:114`） | **能力半边零覆盖**：`SemanticIntent`（`types.ts:142`，含 `kind`/`labels`/`orderedSteps`）在 9 个测试文件里**从未被构造**。因此 `candidate-planner.ts:47` 的 `intentUsesOnlyLegalActions` 与 `candidate-planner.ts:117` 的宏动作守卫（`'produced a macro step outside the current legal action set'`）**均为零覆盖代码**。"语义意图不得成为独立决策状态"亦无断言 |
| 5.5 | 宏动作每个可提交步骤在提交前经当前 `queryActions` 与合法 Op 链路重新验证；仅上游契约要求等待/收集/延后/Intent 解算时才进 Decision/Intent 生命周期；即时 Action 直接提交；中间步骤不可执行 → 停止宏动作 + 诊断 | ◐ | 单步重验有断言：`decision-facade.test.ts:153`（提交前重验版本与合法性成员资格）；即时 Action 直接提交路径见 `kernel-adapters.test.ts:253`（`isDeferred: () => false`） | **多步宏动作的"中途停止 + 诊断"零覆盖**（无 `orderedSteps` 用例，见 5.4）。**"需要等待/收集/延后时进入 Decision/Intent 生命周期"分支零覆盖**：全部内核测试写死 `isDeferred: () => false`（`kernel-adapters.test.ts:163`、`kernel-adapters.test.ts:291`、`sequential-kernel.test.ts:177`），`commit-adapter.ts:155` 的 `'submitted-intent'` 出口从未被执行 |
| 5.6 | 分类条件/相关着法标签名/语义意图类别/候选数量/阈值由玩法层或后续设计确定；不得固化示例数量、固定标签名或具体玩法意图 | ✅ | `kernel-adapters.test.ts:383`（标签路径 `relevantActionsPath` 由外部 Schema 注入，AI 模块不含固定标签名）；`ai.test.ts:16`（无玩法字段启发式、无 `alphaBeta`）；候选数量无上限常量：`coarse-no-relevant-action.property.test.ts:63` 用 1–6 个随机动作跑通 | `ai.test.ts:16` 扫描范围仅 5 个文件（见 1.4 说明） |

### 要求 6：评估边界、无效值与候选算法

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 6.1 | 从玩法层提供的**可替换**评估契约取得内部评估结果；AI 模块不得嵌入具体玩法胜负语义、固定权重或具体实体数值 | ✅ | `ai.test.ts:16` `contains no legacy global-state search implementation or gameplay-field score heuristic`（断言 `props?.['hp'\|'maxHp'\|'damage']` 型启发式不存在）；可替换性由构造函数注入体现并被多处使用不同实现验证：`decision-facade.test.ts:174` 起的 `evaluationGateway`（按 policy 返回 2 或 1）、`sequential-kernel.test.ts` 的 `evaluate: (actor, slice) => Number(slice.visibleFacts[...])`（只读切片可见事实） | `ai.test.ts:16` 扫描范围仅 5 个文件（见 1.4） |
| 6.2 | 参与排序/比较/剪枝/选择**前**验证评估结果是有限数值 | ✅ | `decision-facade.test.ts:126` `accepts only finite numeric evaluations and records explicit fallback diagnostics`（`4.5` → `status:'evaluated'`；`'4.5'` 字符串 → `status:'neutral-fallback'`；`Infinity` → `status:'neutral-fallback'`） | 「在排序/比较**之前**」这一时序没有独立断言（现有断言是对 `FiniteEvaluationGuard.normalize` 的单元断言，而非"未经守卫的分数不会进入排序"的集成断言） |
| 6.3 | `null`/非数值/`NaN`/无穷/其他不可比较值 → 产生诊断 + 使用**显式声明的**中性回退；不得依赖隐式转换或静默当作低/高/零分 | ✅ | `decision-facade.test.ts:126`：`'4.5'` 字符串在 `neutral=1` 时回退到 **1**、`Infinity` 在 `neutral=Infinity` 时回退到 **0**，两处不同的回退值直接证明"用的是显式声明的中性值，而不是硬编码 0"；两次均断言 `diagnostic.code === 'AI_EVALUATION_INVALID'` | 枚举的无效值里 **`null` 与 `NaN` 没有单独用例**（只测了字符串与 `Infinity`）。`NaN` 在 `simulation-search.test.ts:166` 中作为收益矩阵缺失时的兜底出现，但未断言它会触发 `AI_EVALUATION_INVALID` |
| 6.4 | 回退发生时把回退原因与受影响候选关联到结果或诊断 | ✅ | `decision-facade.test.ts:126` 断言 `fallback.diagnostic` 匹配 `{ code:'AI_EVALUATION_INVALID', candidateAction: { $: 'a:wait' } }`，即诊断携带受影响候选 | — |
| 6.5 | αβ/其他剪枝/动作排序/缓存/置换表/平局随机仲裁/评估服务类型均为候选实现；选择任一方案不得改变要求 2、3、4、7、8 的合法性、认知与写入约束 | ◐ | "未被固化"有断言：`ai.test.ts:16`（`alphaBeta` 不出现）；平局仲裁可替换有断言：`simulation-search.test.ts:246` `delegates equal-score selection to the injected replayable tie selector`（断言 `selectTie` 收到 `['a:first','a:second']`、返回 1、最终选中 `a:second`、调用恰 1 次） | **后半句零覆盖**：没有任何用例"装上一种剪枝/缓存实现，再重新验证要求 2/3/4/7/8 的不变量仍然成立"。即"候选实现替换不破坏不变量"这条**跨条兼容性**没有机器证据 |
| 6.6 | 评分范围/权重/比较阈值/搜索预算/性能指标标记为内部度量或玩法层配置；不得作为规范默认值或玩家可见数值 | ✅ | `contracts.test.ts:283` 三个分支全部断言：`internalMetric:true` + 值 99 → 接受（内部度量不受 1–5 约束）；`playerVisible:true` + 值 6 → `AI_PLAY_CONFIGURATION_REQUIRED`；`playerVisible:true` **且** `internalMetric:true`（出处含混）→ `AI_POLICY_BINDING_INVALID`。第三个分支尤其有力：它堵住了"把玩法数值伪装成内部度量以绕过 1–5"的路径 | — |

### 要求 7：Decision、Intent、Policy 与过期候选处理

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 7.1 | 通过上游 Policy 契约表达策略选择；不得复制或重定义 Policy 的数据结构、模式或写入机制 | ✅ | `kernel-adapters.test.ts:497` `drives a mode:search policy through the bridge without writing state`（直接使用引擎层 `PolicyDef`（`../../schedule/policy.js`）与 `mode:'search'`，不是 AI 私有结构）；`contracts.test.ts:314`（AI 公开 API 源码不含写通道类型） | — |
| 7.2 | 需要等待输入/收集选择/延后结算时使用上游 Decision 与 Intent 契约；不得创建阻塞调用、私有等待队列或第二套提交状态 | ◐ | 即时路径使用真实上游 Intent Op：`kernel-adapters.test.ts:253`（`intent.submit` + `intent.resolve`，且断言状态真的改变） | **延后路径零覆盖**（本审计最明确的执行面缺口之一）：`commit-adapter.ts:154` 的 `if (this.deps.isDeferred(def))` 分支从未被进入，因为全部 3 个内核测试写死 `isDeferred: () => false`（`kernel-adapters.test.ts:163`、`kernel-adapters.test.ts:291`、`sequential-kernel.test.ts:177`）。其出口 `outcome:'submitted-intent'`（`commit-adapter.ts:155`）无断言。更进一步：`outcome:'opened-decision'`（`types.ts:222`）在**整个实现中没有任何产出点**，只出现在类型联合与 `decision-facade.test.ts:177` 的替身签名里 |
| 7.3 | Decision 已关闭/超时/答满/被作废，或上下文前置条件失效 → 拒绝候选、保留既有语义状态、产生诊断 | ◐ | `decision-facade.test.ts:164` `preserves canonical stale decision and void intent lifecycle categories`（注入的 `validateLifecycle` 返回 `AI_DECISION_STALE`，断言 facade 原样保留该分类） | 按本报告 §一口径 2，这是**替身驱动的分类透传**：只证明"分类不会在传递中丢失"，未证明"真实的关闭/超时/答满/作废 Decision 会产生该分类"。**真实内核上没有任何 Decision 生命周期用例**（`registerIntentOps` 被接入，但 Decision 的 open/close/timeout/满额路径未被驱动） |
| 7.4 | Intent 解算前前置条件/目标/成本/可见性不再满足 → 按上游规则进入 void 或失败路径；不得执行原候选效果 | ✅ | `kernel-adapters.test.ts:276` `reports a void intent when the precondition lapses between submit and resolve`：在真实内核上于 `intent.resolve` 事务内翻转 `world.props.advanceAllowed`，断言 `AI_INTENT_VOID` 且 `world.props.aiResolveCount` 为 `undefined`（效果确实没执行） | 四种失效原因里只有**前置条件**被驱动；**目标、成本、可见性**三种无用例 |
| 7.5 | 到达上游声明的预算限制 → 返回经当前公开契约验证的最佳可提交候选，**或**转入已声明的回退策略或无动作结果；不得绕过预算、卡住相位或伪造合法动作 | ✅ | 本条是"或"关系，第二个析取项有完整断言：`decision-facade.test.ts:238` `returns no action with a budget diagnostic when evaluation budget is exhausted` → `status:'no-action'` + `AI_BUDGET_EXHAUSTED`；`simulation-search.test.ts:146` `treats exhausted shared simulation budget as failure-closed` → `AI_BUDGET_EXHAUSTED`；`contracts.test.ts:99` `keeps budget finite and rejects exhausted work deterministically`（断言精确的失败对象，并断言负预算构造抛错） | **第一个析取项（"返回已验证的最佳可提交候选"）无用例**：不存在"预算耗尽但已有可提交候选，于是提交它"的场景。若将来实现改为优先走这一支，当前测试不会发现回归 |
| 7.6 | 为预算耗尽、回退、无合法候选、过期 Decision、失效 Intent、重新验证失败**分别**产生可区分的诊断类别 | ✅ | 六类各有断言：预算耗尽 `decision-facade.test.ts:238`（`AI_BUDGET_EXHAUSTED`）；回退 `decision-facade.test.ts:126`（`AI_EVALUATION_INVALID`）；无合法候选 `decision-facade.test.ts:95`（`AI_NO_LEGAL_ACTION`，且与 `AI_NO_RELEVANT_ACTION` 明确区分）；过期 Decision `decision-facade.test.ts:164`（`AI_DECISION_STALE`）；失效 Intent `kernel-adapters.test.ts:276`（`AI_INTENT_VOID`）；重新验证失败 `decision-facade.test.ts:153`（`AI_KNOWLEDGE_CHANGED` / `AI_CANDIDATE_ILLEGAL`） | 没有**汇总性**断言（例如表驱动地断言"每种情形 ↔ 唯一码"的映射完备且互不重叠）；现在是六处分散的单点断言，新增情形若复用了已有码不会被发现 |
| 7.7 | Policy 只能选择或提出候选，不得直接执行效果；任何尝试直接执行效果的 Policy 路径必须被拒绝；冻结后也只能经合法 Action 或适用 Decision/Intent 到 Op 提交，不存在 Policy 自行写入的例外 | ✅ | `kernel-adapters.test.ts:497`：`bridge.propose(policy, ...)` 返回动作 id（`a:hold-position`），并断言 `holder.getState()).toBe(before)` —— **对象同一性**级别的"未写入"证据；另断言非目标 agent 返回 `null`。结构层面见 `contracts.test.ts:314`（AI 公开 API 不含 `invoke(` / `setState(`） | "任何**尝试**直接执行效果的 Policy 路径必须被拒绝"没有对抗性用例（没有构造一个试图写入的 Policy 并断言被拒） |

### 要求 8：试探、随机与唯一写入通道

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 8.1 | 通过上游 `checkpoint`/`restore`、事务和同一套合法 Op 执行试探；不得为 AI 搜索建立独立于正常状态推进的写入通道 | ✅ | `kernel-adapters.test.ts:321` `runs the canonical chain inside a branch and restores state, rng and journal-visible commitments`：真实 `InMemoryCheckpointStore` + 真实提交适配器；断言分支内 `world.props.aiResolveCount === 1`（正规链条确实执行了），`close()` 后 `after).toBe(before)`（对象同一性）、`intents` 清零、`aiResolveCount` 变回 `undefined`、`checkpoints.list()` 为空（检查点已回收）；`simulation-search.test.ts:52` `restores after failed attempts and always restores before close`（断言调用序列恰为 `['attempt','restore','close']`） | — |
| 8.2 | 试探中的随机行为使用上游**影子**随机流；不得推进真实对局随机流或污染其可回放状态 | ◐ | 后半有强断言：`kernel-adapters.test.ts:321`（`after.world.rng).toEqual(before.world.rng)`）；`sequential-kernel.test.ts:300`（整条多参与者搜索后 `world.rng).toEqual(before.world.rng)`） | **前半零覆盖**：现有断言只证明"真实随机流未被推进"，没有证明"试探确实走了影子随机流"。原因是所有测试用的 ActionDef（`a:hold-position`/`a:advance`/`a:hold`/`a:push`）都**不含任何随机效果**，探索期间根本没有随机数被消耗。因此"影子流"这条能力在 AI 侧无机器证据 |
| 8.3 | 试探应继续执行保证规则正确性的 Hook、前置条件、成本和不变量检查；只允许按上游契约静默表现层外部订阅，不得静默规则结果或诊断 | ◐ | 表现层静默有精确断言：`kernel-adapters.test.ts:321`（模拟期间 `dispatch` 的 `delivered` 为空、`suppressedCount()===1`；`close()` 之后再 dispatch 则被送达 → 静默是**有作用域且可恢复**的）；"规则否决仍被如实报告"见 `simulation-search.test.ts:52`（替身以 `'hook vetoed'` 返回 `AI_SIMULATION_FAILED`，并断言随后 `restore`） | "试探内 Hook / 前置条件 / 成本 / 不变量检查仍然生效"**只在替身层覆盖**：真实内核分支里没有"Hook 或不变量在分支内否决 → 诊断如实产出且状态回滚"的用例（`simulation-search.test.ts:52` 的 `beginCanonicalSimulation` 是手写替身，不是 `KernelSimulationAdapter`）。**成本检查**在试探中的生效性无用例（`cost` 皆为 `[]`） |
| 8.4 | 提交最终候选前按当前合法 Action 契约验证；需异步征询/收集选择/延后结算/Intent 解算时用适用的 Decision/Intent 生命周期；即时 Action 直接提交；任何语义写入最终经 `OpRegistry.invoke`；AI 不得直接修改世界状态/Knowledge/资源/目标/状态机字段/随机计数器 | ✅ | 提交前验证：`kernel-adapters.test.ts:268`（`ActionCatalog` 当前不提供 → `AI_CANDIDATE_ILLEGAL`，`intents` 为空）；唯一写入通道：`kernel-adapters.test.ts:253`（经真实 `intent.submit`/`intent.resolve`，效果通过 `runEffects` → `registry.invokeInline('prop.add',…)` 落地）；不得直接改状态：`contracts.test.ts:314` + `ai.test.ts:16`（源码级无 `world-state` import、无 `setState(`/`invoke(`） | 中段"需延后结算时进入 Decision/Intent 生命周期"与 7.2 同一缺口：`isDeferred` 恒为 `false`，该分支零覆盖 |
| 8.5 | 试探或提交期间任一 Op/事务/不变量/Hook/随机契约失败 → 按上游回滚规则恢复到有效状态 + 产生关联该候选的 AI 诊断 | ✅ | `simulation-search.test.ts:52`（失败后必 `restore`，序列断言）；`simulation-search.test.ts:285` `restores the active branch when recursive planner resolution fails`（断言 `restored).toEqual(['cp:active'])` 且返回 `AI_CONTRACT_UNAVAILABLE`）；`sequential-kernel.test.ts:414` `fails closed when the phase cannot be advanced through the Op channel` → `AI_TRANSACTION_FAILED`（真实内核：故意用未注册 `schedule.advance` 的 `OpRegistry`）；`kernel-adapters.test.ts:276`（void intent 后效果未落地） | "关联该候选"这一点在上述失败用例中未逐一断言 `candidateAction` 字段（该字段的关联性断言在 `contracts.test.ts:68` 与 `decision-facade.test.ts:126`，属其他情形） |
| 8.6 | 人类与 AI 对同一操作的权限、事务回滚、Hook 拦截、日志和回放语义应一致；AI 不得拥有专用的免代价/免前置条件/免诊断路径 | ◐ | 权限一致有断言：`kernel-adapters.test.ts:298` `rejects a non-ai agent and an unauthorized action`（`kind:'human'` 的 agent 走 AI 提交路径 → `AI_POLICY_BINDING_INVALID`；AI agent 但 `authority` 不含该动作 → `AI_CANDIDATE_ILLEGAL`）；合法着法同源见 `kernel-adapters.test.ts:474`（**注意其断言是包含关系，见 2.2**） | **事务回滚、Hook 拦截、日志（Journal）、回放语义的"人类 vs AI 一致"没有对照断言**：不存在"同一动作分别由人类与 AI 提交，比较 journal 条目/回滚行为/回放结果"的用例。"免代价/免前置条件"的对照亦无（`cost` 皆为 `[]`） |

### 要求 9：AI 行为类、NPC 配置与玩法数值归属

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 9.1 | 基类层 AI 行为类只定义可复用行为语义/字段 Schema/引用类型/验证约束；**不得**定义具体状态名称、状态集合、转换条件、转移图、初始或回退状态选择，亦不得填写具体玩法参数 | ◐ | 末半句有断言：`kernel-adapters.test.ts:403` `rejects a play value hardcoded in a reusable definition`（抽象族里写 `props.patrolRoute` → `AI_PLAY_CONFIGURATION_REQUIRED`，由 `AIBehaviorFamilySchema.playOwnedPaths` 驱动） | **"不得定义状态名称/状态集合/转换条件/转移图/初始或回退状态选择"整组零覆盖**：只有 `patrolRoute` 一个路径被 `playOwnedPaths` 保护，没有任何用例断言"在可复用定义里声明状态机（状态名、转移条件、转移图、初始/回退状态）会被拒绝" |
| 9.2 | 具体 NPC 的状态集合/初始或回退状态/转换条件/转移图/巡逻线/目标优先级/感知范围/声音处理/武器偏好/地图策略/行动成本/生命值/阈值等由玩法层基于已注册 Schema 配置 | ◐ | 部分有断言：`kernel-adapters.test.ts:383`（具体 def 提供 `alertLevel: 3` 与 `relevantActions`，经 Schema 校验通过）；**回退状态**由玩法层声明并被投影出来：`decision-facade.test.ts:95`（`fallbackState:'patrol'` → `noOp.declaredFallback`）与 `decision-facade.test.ts:244`（断言诊断 `reason` 含 `'idle'`） | 清单里只有 `alertLevel`（阈值类）与 `fallbackState`（回退态）有正向用例；**状态集合、转换条件、转移图、巡逻线、目标优先级、感知范围、声音处理、武器偏好、地图策略、行动成本、生命值** 均无正向配置用例 |
| 9.3 | 允许玩法层以已验证 AI 行为类组合形成守卫或其他 NPC 实例；守卫范式不得使其特定状态列表/转移/数值/地图行为成为所有 NPC 的强制默认 | ◐ | 组合能力有断言：`sequential-kernel.test.ts` 的 `makeWorld()` 从同一抽象族 `d:ai-family` 派生 3 个各自独立的绑定（`d:bind-one/two/three`），`sequential-kernel.test.ts:300` 断言每个派生参与者各自经过自己的绑定验证（`resolvedBindings` 包含另两个绑定 id） | **"守卫范式不成为强制默认"无断言**：没有用例证明"不配置守卫特有字段时 NPC 仍可成立"，也没有断言 AI 模块内不存在守卫默认值 |
| 9.4 | 拒绝在基类层 AI 定义中硬编码巡逻路线/具体感知阈值/玩法专属状态机/绑定到单一玩法的 NPC 实例，并产生指出玩法层归属的诊断 | ✅ | `kernel-adapters.test.ts:403` → `AI_PLAY_CONFIGURATION_REQUIRED`（码名本身即指出玩法层归属）；`kernel-adapters.test.ts:412` `rejects a missing required parameter, an abstract binding and an out-of-range player value`（抽象绑定被当作可用绑定 → `AI_POLICY_BINDING_INVALID`） | 四类被禁内容里只有**巡逻路线**有用例；**具体感知阈值、玩法专属状态机、绑定到单一玩法的 NPC 实例**无用例 |
| 9.5 | 玩法层配置玩家可见 AI 行为数值时验证落在 1–5；内部搜索度量不受该范围约束但必须显式标记为内部度量 | ✅ | `contracts.test.ts:283`（三分支全覆盖，含"出处含混"被拒，见 6.6）；真实 Def 通道上的同一约束见 `kernel-adapters.test.ts:412`（`alertLevel: 6` → `AI_PLAY_CONFIGURATION_REQUIRED`）与 `kernel-adapters.test.ts:383`（`alertLevel: 3` + `playerVisible:true` 通过） | 只测了上界越界（6）；下界（0 或负数）无用例 |
| 9.6 | 不得将声音衰减系数/视觉距离/固定 AP/特定武器或 DC 规则/固定路线长度/特定 NPC 参数作为通用 AI 需求默认值 | ◐ | `ai.test.ts:16`（源码级断言无 `props?.['hp'\|'maxHp'\|'damage']` 型玩法字段启发式） | 断言的**字段清单与文件范围都窄于本条列举**：只查 3 个字段名（hp/maxHp/damage），未查声音衰减、视距、AP、DC、路线长度；且只扫 5 个文件，不含 `facade.ts`、`sequential-search.ts`、`kernel/**` 等主体实现 |

### 要求 10：核心机制、NPC、UI 与 UGC 的接口契约

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 10.1 | 只依赖引言列出的公开契约；上游缺能力时记录待汇合契约，不得复制引擎机制或引入私有替代接口 | ✅ | `contracts.test.ts:276` `fails closed when the owner has not frozen the read or behavior contract`（两个 Unavailable 网关都返回精确的 `{ok:false, code:'AI_CONTRACT_UNAVAILABLE', detail}`）；`contracts.test.ts:68`（`unavailableContract(...)` 记录 `upstreamContract`，断言其含 `'Action'`）；`integration.test.ts:227`（读取契约未冻结时，在 plan/evaluate/submit **之前**就失败关闭，断言 `evaluations===0`、`submissions===0`）；无私有替代接口见 `contracts.test.ts:314` 与 `ai.test.ts:16` | — |
| 10.2 | NPC 配置接口接收经基类层验证的行为类/参数 Schema/玩法层配置；不得接收或暴露可写完整世界状态 | ✅ | `kernel-adapters.test.ts:383` / `:403` / `:412`（`DefBackedBehaviorValidator` 经真实 `DefRegistry` 解析继承链并校验参数出处、必填、范围、抽象性）；`contracts.test.ts:314`（公开 API 不含完整状态/写通道类型） | — |
| 10.3 | UI 通过只读投影获取解释信息/推荐/合法性原因/结构化诊断；UI 不得通过 AI 接口改变语义状态；玩家输入仍经与 AI 相同的合法 Action 契约 | ✅ | `integration.test.ts:102` `projects only visible reasons and never leaks bindings, scores or hidden refs`（序列化后断言不含隐藏实体、不含 `'score'`、不含 `'correlationId'`，且 `bindings` 默认为空）；`integration.test.ts:153` `strips agent identity, correlation id and upstream contract from every public diagnostic`（断言公开诊断的键集**恰为** `['code','hint','phase','reason','severity']`，并断言不含 `'internal'`）；玩家侧无写能力见 `contracts.test.ts:62`（编译期禁止 `player-assistance` 取 `act`） | — |
| 10.4 | UGC 以声明式数据定义可复用行为/Policy 引用/玩法配置，先经相同的基类层验证、引用解析与诊断；不得注入代码、直接写状态或绕过可见性过滤 | ✅ | `integration.test.ts:187` `accepts a registered declarative reference`；`integration.test.ts:193` `rejects code, extra privileges, unregistered policies and mismatched categories`（六个分支：`onEvaluate:'() => 1'` 代码注入、`omniscient:true` 越权、类别不匹配、`policy` 非引用形状、`schemaVersion` 不符、非对象输入，全部 → `AI_POLICY_BINDING_INVALID`）；`integration.test.ts:202` `fails closed when the base-class validator is unavailable` → `AI_CONTRACT_UNAVAILABLE` | — |
| 10.5 | 对 UI 或 UGC 暴露的解释信息不得包含无权读取的隐藏事实/私有 Knowledge/未公开 Intent/完整世界状态 | ✅ | `integration.test.ts:102`（把隐藏实体塞进 rationale 与诊断文本后，投影序列化仍不含它）；`explanation-policy.test.ts:59` `withholds a declared key whose value references something the viewer cannot see`（即使玩法**显式声明**了该 binding key，只要其值引用不可见对象仍被扣留）；`explanation-policy.test.ts:67` `drops a rationale node that cites an invisible reference regardless of policy` | — |
| 10.6 | 任一上下游接口缺少稳定字段/权限定义/验证结果时标记为未冻结待汇合契约，拒绝用猜测性字段/默认值/私有接口替代 | ✅ | 大量失败关闭断言：`contracts.test.ts:276`、`integration.test.ts:202`、`integration.test.ts:227`、`decision-facade.test.ts:232`、`decision-facade.test.ts:283` `fails closed instead of statically evaluating a search planner when SearchSession is unavailable`（并断言 `searchCalls===0`）、`decision-facade.test.ts:380` `converts SearchSession gateway exceptions into failure-closed diagnostics`、`simulation-search.test.ts:73` `fails closed without the unified checkpoint/shadow-stream adapter`、`sequential-kernel.test.ts:333` `fails closed when a derived AI participant has no validated behavior binding` | — |
| 10.7 | **每项**待汇合契约必须以**逐字段登记**记录：字段名或结果投影、生产者与消费者、所属层级与权威来源、读写权限、`visibleTo` 或脱敏边界、快照与版本语义、重新验证时点、验证状态、缺失时的拒绝结果、冻结状态；登记至少覆盖 (a) 动作候选→即时 Action/Decision/Intent/Op 映射、(b) Query/Knowledge 的版本快照与刷新语义、(c) `checkpoint`/`restore`+影子随机流+表现订阅静默的共同边界、(d) AI 行为类完整 Schema 与验证结果、(e) UI 解释字段脱敏规则、(f) UGC 编辑/审核/装载/回退结果 | ⬜ | 无（AI 侧） | **AI 侧无承载物，但仓库里存在三种相邻形态——这一点初稿漏写，复核补上**：<br>① `src/core/ugc/model/contract-types.ts` + `src/core/ugc/contracts/integration-contract-catalog.ts`：UGC 侧的跨领域待汇合契约目录，其 `INTEGRATION_DOMAINS` **明确包含 `'ai'`**。但 `IntegrationContract` 只有 7 个属性（`domain`/`providerId`/`version`/`exportedDefKinds`/`exportedSemanticFamilies`/`referenceConstraintsFingerprint`/`sourceRecords`），是**提供方级**而非**逐字段级**，且不含 10.7 要求的读写权限、`visibleTo`/脱敏边界、重新验证时点、验证状态、缺失时的拒绝结果、冻结状态。<br>② `src/ui/ports/pending-contracts.ts`（PT-09 产出）：UI 侧的待汇合端口声明。<br>③ `src/play/profiles/known-divergences.ts`：L3 分歧登记。<br>**结论仍是 ⬜**：三者都不是 10.7 要求的形状，且 **AI 模块既不产出也不消费其中任何一个**。AI 侧现有能力只是"逐次拒绝时产出一条诊断"（`diagnostics.ts` 的 `unavailableContract`，字段 `upstreamContract`/`reason`/`hint`，断言见 `contracts.test.ts:68`），与"每项契约的逐字段登记（12 属性 × 6 领域）"是两回事 |

### 要求 11：可验证诊断与可解释性

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 11.1 | 每个 AI 诊断至少包含：可机器判别类别、严重度、AI 决策者、关联策略或候选、发生阶段、原因、上游契约定位、可行动提示 | ✅ | `contracts.test.ts:68` `creates diagnostics with all mandatory correlation fields`（断言 `category`/`agent`/`controlledEntity`/`policy`/`correlationId`/`candidateAction`/`phase`；`severity`/`reason`/`hint`/`upstreamContract` 由 `createAIDiagnostic` 的入参类型强制，且 `upstreamContract` 在 `unavailableContract` 分支被单独断言）。类型必填 + PT-06 后 `test/**` 与 `src/**` 全在 `tsc` 范围内，故类型约束是真门禁 | 没有"遍历所有诊断构造点，断言 8 个字段齐全"的汇总断言；靠"类型必填 + 单点断言"组合。若将来某处用 `as` 绕过类型，不会被发现 |
| 11.2 | 能在不读取隐藏状态的前提下说明候选为何被**选择/拒绝/重新验证/作废/回退/停止**；解释只基于允许读取的切片与公开结果 | ◐ | 选择与拒绝有断言：`integration.test.ts:102`（推荐理由投影 + 被拒诊断的公开化，公开 `reason` 被替换为 `'The recommended action is no longer legal.'`）；`explanation-policy.test.ts:39/47/59/67` 四条覆盖"未声明则只发布动作 id / 声明后发布指定键与玩法措辞 / 声明键但值不可见则扣留 / 引用不可见的理由节点被丢弃" | 六种情形里**"重新验证 / 作废 / 回退 / 停止"四种的解释投影无断言**：这些情形的诊断码存在（见 7.6），但没有用例断言其**面向 UI 的解释**内容与脱敏 |
| 11.3 | 为以下情形提供可自动断言的诊断与状态结果：无效评估值、非法候选、**目标/成本/前置条件失效**、过期 Decision、失效 Intent、认知变化、预算耗尽、试探失败、Op/事务失败、无合法候选 | ◐ | 逐项：无效评估值 ✅`decision-facade.test.ts:126`；非法候选 ✅`decision-facade.test.ts:82` + `kernel-adapters.test.ts:268`；前置条件失效 ✅`kernel-adapters.test.ts:276`；过期 Decision ◐`decision-facade.test.ts:164`（替身驱动）；失效 Intent ✅`kernel-adapters.test.ts:276`；认知变化 ✅`decision-facade.test.ts:153` + `kernel-adapters.test.ts:235`；预算耗尽 ✅`decision-facade.test.ts:238` + `simulation-search.test.ts:146`；试探失败 ✅`simulation-search.test.ts:52`；Op/事务失败 ✅`sequential-kernel.test.ts:414`；无合法候选 ✅`decision-facade.test.ts:95` | 枚举的情形里 **"目标失效"与"成本失效"两项完全无断言**（全部测试的 `cost` 为 `[]`，且没有 target 在候选生成后失效的用例）；"过期 Decision"按 §一口径 2 只算间接 |
| 11.4 | 任何被拒绝/作废/回滚的候选，保持提交前或事务前的有效语义状态；不得留下部分状态、未结算代价或未回收的试探副作用 | ✅ | `kernel-adapters.test.ts:321`（`after).toBe(before)` 对象同一性 + `intents` 清零 + `aiResolveCount` 复原 + `world.rng` 相等 + `checkpoints.list()` 为空（试探副作用已回收）+ 表现订阅恢复送达）；`kernel-adapters.test.ts:268`（非法候选后 `intents` 为空）；`kernel-adapters.test.ts:276`（void intent 后效果未落地）；`sequential-kernel.test.ts:300`（整条搜索后只剩 1 次真实结算）；`kernel-adapters.test.ts:461` `recommends without any state change and submits through the canonical chain`（`recommend` 后 `holder.getState()).toBe(before)`） | "未结算代价"这一子项无用例（`cost` 皆为 `[]`） |
| 11.5 | 相同合法初始状态 + 相同公开认知 + 相同 Policy + 相同命名随机流状态 + 相同提交序列 → 产生**可重放**的候选结果与诊断分类；影子随机流与表现静默不得改变真实对局的随机与状态历史 | ◐ | 后半句有强断言：`kernel-adapters.test.ts:321` 与 `sequential-kernel.test.ts:300`（`world.rng` 相等）；表现静默可恢复（同 8.3）。确定性的局部证据：`kernel-adapters.test.ts:235`（`versions` 两次调用结果相等）；`simulation-search.test.ts:246`（平局仲裁委托给可重放的注入选择器） | **"重放等价"本身无端到端断言**：不存在"同一初始状态跑两次同一请求，断言候选与诊断分类完全相同"的用例。这是本需求里最容易机器化却缺失的一条 |
| 11.6 | 搜索树视图/性能计数/热力图等调试表现可作为候选实现；若实现，必须消费只读结果与诊断，且不得成为强制 UI/性能指标/算法前提 | ⬜ | 无 | **条件未触发**：AI 模块未实现任何调试表现，因此"若实现则…"的约束无从断言，**这不构成缺陷**。但同时也不存在"AI 模块不依赖任何调试视图"的反向断言，故按口径记 ⬜ 而非 ✅ |

### 要求 12：来源可追踪性与未决项保护

> 本需求 6 条中有 4 条是**文档与流程约束**（针对 requirements.md 自身与冻结流程），而非运行期行为。B-19/B-20 已把来源追踪与文档术语增量纪律机器化；逐字段登记与冻结流程仍无承载物。

| 编号 | 验收标准摘要 | 状态 | 证据 | 缺口说明 |
|---|---|---|---|---|
| 12.1 | 每一条需求都应包含来源追踪，至少指向一个权威来源/上游 Requirement/已确认决策/明确的待汇合契约 | ✅ | `test/toolchain/spec-document-discipline.test.ts:369` 自动发现全部活跃 `requirements.md` 并要求登记采纳状态；`:379` 对 `fully-adopted` 的 Spec 逐要求小节断言**恰有一个**来源 footer。`wakeup-ai` 登记为 fully-adopted，12/12 小节通过 | 守卫同时接受仓库内等价的「来源追踪」与「可追踪来源」标签；它证明 footer 存在且逐节唯一，不对 footer 所引来源的内容真实性作自动语义判定 |
| 12.2 | 来源只提供示例/历史/候选算法/性能建议/未定数值时，应标记为候选实现/历史材料/未冻结项，不得转化为强制验收标准 | ◐ | `ai.test.ts:16`（断言 `alphaBeta` 不出现在 AI 源码 → 候选算法确实没被固化为实现）；`ai.test.ts:29` `keeps only a SearchDecisionContext-based public search contract`（公开搜索契约以上下文对象为中心，未固化具体算法） | 只覆盖 `alphaBeta` 一个候选算法，且只扫 5 个文件；requirements.md 「明确未冻结的事项」列举的其余项（剪枝条件、候选排序、缓存/置换表、随机仲裁实现、评估服务类名/对象形状、性能阈值、可视化形态、固定搜索深度、固定评分权重、NPC 状态名、巡逻线、感知距离、衰减系数、动作成本、地图策略）**均无对应的"未固化"断言** |
| 12.3 | 涉及未确认的核心机制/NPC/UI/UGC 接口时记录依赖与未冻结状态，不得自行定义上游数据结构/数值/写入通道 | ✅ | `contracts.test.ts:276`（未冻结即失败关闭）；`contracts.test.ts:68`（`unavailableContract` 记录 `upstreamContract` 定位）；`contracts.test.ts:314`（不引入上游写通道类型）；`ai.test.ts:16`（不 import `world-state`）；`decision-facade.test.ts:283`/`:380`、`simulation-search.test.ts:73`、`sequential-kernel.test.ts:333`（四类上游未冻结均失败关闭） | 记录的是**逐次拒绝的诊断**，不是 10.7 要求的登记件（见 10.7） |
| 12.4 | 拒绝以宪法已禁用的术语描述层级归属、可复用定义或具体产物 | ◐ | **代码侧**：`src/class/__tests__/architecture-terminology.test.ts:40` 扫描整个 `src/`。**文档侧**：`test/toolchain/spec-document-discipline.test.ts:227` 扫描活跃 `.kiro/specs/**` 与 `docs/**`，对无歧义复合词建立精确条数棘轮，并验证声明禁令文件的职责豁免仍真实命中 | **已有机器守卫但尚未全量清零**：当前 6 个活跃文件合计仍有 **23 处既有违规**，由 `KNOWN_VIOLATIONS` 精确到文件与条数；任何新增都会失败，修少后也必须下调基线。历史档案目录被明确排除；单独词语因消息文案、Prompt、Vue 等合法义项未在文档侧一刀切。故本条保持 ◐，目标状态是基线空表 |
| 12.5 | 冻结某候选算法/数值/参数/接口之前，先记录其权威来源、所属层级、可判定验收条件与对要求 1–11 的兼容性结论 | ⬜ | 无 | 与 10.7 同源：需要一份登记件+流程门禁，两者都不存在。当前没有任何机制阻止"直接把某算法写进实现而不做兼容性结论" |
| 12.6 | 两个来源实质冲突且无更高优先级裁决时，逐字段/逐行为登记为未冻结待汇合契约（含冲突双方精确定位、冲突字段或行为、优先级裁决依据、责任层级、冻结或裁决状态、未裁决时必须拒绝的接口或效果路径）；不得将任一侧生成强制行为/默认数值/写入路径；被替代时保留被替代条款及其控制来源 | ⬜ | 无 | 与 10.7 / 12.5 同源缺口。注：仓库层面**存在**同类机制的先例（`src/play/profiles/known-divergences.ts` 用于 L3 数值分歧登记），可作为形态参考；但 AI 侧没有对应结构，也没有断言 |

---

## 三、可选补测清单（只提建议，不裁决；不含本审计写出的测试）

> 排序依据：**缺口的可机器化程度 × 该缺口掩盖真实缺陷的可能性**。每条给出建议落点文件与建议断言。
> 标注 **【零覆盖代码】** 的条目意味着当前存在从未被执行的实现分支。

### P1 —— 存在零覆盖实现分支，或断言弱于其标题

| # | 对应条 | 建议落点 | 建议断言 |
|---|---|---|---|
| B-01 | 7.2 / 8.4 / 5.5 **【零覆盖代码】** | `kernel-adapters.test.ts`（新增 describe） | 构造 `isDeferred: (def) => def.id === 'a:deferred'` 的 `KernelCanonicalSubmissionAdapter`，断言：提交延后动作时返回 `outcome:'submitted-intent'`（覆盖 `commit-adapter.ts:154–155`）、intent 停在未 resolve 状态、`world.props.aiResolveCount` 仍为 `undefined`（效果未提前执行）、且随后经上游 `intent.resolve` 才落地 |
| B-02 | 7.2 **【类型有出口、实现无产出点】** | 先确认归属再补测 | `outcome:'opened-decision'`（`types.ts:222`）在实现中没有任何产出点。**这是事实陈述，不是裁决**：需要由所属层判定它是"待实现"还是"应从联合类型移除"。判定后再补对应断言 |
| B-03 | 5.4 / 5.5 **【零覆盖代码】** | `decision-facade.test.ts` 的 `candidate planner and finite evaluation` | 构造带 `intent: { kind, labels, orderedSteps }` 的 `CandidateSeed`：(a) `orderedSteps` 全在合法集内 → 计划成功且 seed 保留 intent；(b) 其中一步不在合法集内 → `AI_CANDIDATE_ILLEGAL` 且 detail 为 `'…macro step outside the current legal action set.'`（覆盖 `candidate-planner.ts:47` 与 `:117`） |
| B-04 | 2.2 / 8.6 **（断言弱于标题）** | `kernel-adapters.test.ts:474` | 现断言为 `toContain`（包含关系）。若意图是标题所述的"exactly"，可改为集合相等：把 AI 侧可见候选**全集**取出（而非只取最终选中的一个），与人类 `queryActions(...,'ui')` 过滤 `reason===undefined` 后的集合做 `toEqual`（排序后）。**注**：这会改变一条既有测试的强度，属跨线改动，宜先确认归属 |
| B-05 | 11.5 | `kernel-adapters.test.ts` 或新增 `replay.test.ts` | 同一初始状态、同一请求连续执行两次（每次前重建 holder 到相同快照），断言两次的 `candidate.legalAction`、`score`、`diagnostics.map(d => d.code)` 完全相等 |
| B-06 | 8.2 | `kernel-adapters.test.ts` 的 `kernel simulation adapter` | 给试探用的 ActionDef 加一个消耗随机流的效果，断言：分支内随机数确实被消耗（影子流计数前进）、`close()` 后 `world.rng` 与 before 严格相等。这样"用了影子流"才有正面证据，而非只有"真实流没动" |

### P2 —— 枚举项覆盖不全（成本 / 目标 / 真实生命周期）

| # | 对应条 | 建议落点 | 建议断言 |
|---|---|---|---|
| B-07 | 2.4 / 7.4 / 8.3 / 11.3 / 11.4 | `kernel-adapters.test.ts` | 引入一个**带真实 `cost`** 的 ActionDef（当前所有测试 `cost: []`）。断言：资源不足时候选不可提交且诊断可区分；试探分支内代价被扣除、`close()` 后代价复原（"未结算代价"子项）；提交失败时代价不被扣 |
| B-08 | 2.4 / 7.4 / 11.3 | `kernel-adapters.test.ts` | 构造"目标（binding target）在候选生成后失效"场景（例如目标实体被移出可见集），断言产生可区分诊断且效果未执行。当前只有"前置条件失效"路径 |
| B-09 | 7.3 / 11.3 | `kernel-adapters.test.ts` 新增 describe | 用**真实** Decision 生命周期驱动 `AI_DECISION_STALE`：分别构造已关闭 / 已超时 / 已答满 / 已作废的 Decision，断言四种都被拒且状态不变。当前仅替身透传（`decision-facade.test.ts:164`） |
| B-10 | 6.3 | `decision-facade.test.ts:126` | 补 `null` 与 `NaN` 两个输入，断言同样产生 `AI_EVALUATION_INVALID` 并使用显式中性值 |
| B-11 | 9.5 | `kernel-adapters.test.ts:412` | 补玩家可见数值的**下界**越界（`0` 与负数），断言 `AI_PLAY_CONFIGURATION_REQUIRED` |
| B-12 | 2.5 / 5.3 | `decision-facade.test.ts:95` | 补"相关性配置**引用损坏**"（`relevantActionIds` 指向不存在的 def / 形状非法）分支，断言与"缺失"可区分或明确同码 |

### P3 —— 语义定义与跨条不变量（需要设计判断，建议先定口径再补）

| # | 对应条 | 建议落点 | 建议断言 |
|---|---|---|---|
| B-13 | 4.2 / 4.3 | `sequential-kernel.test.ts` | 用**紧预算**（`decisionPoints` 恰等于参与者数）跑一轮，断言：恰好用尽、再多一个决策点即 `AI_BUDGET_EXHAUSTED`；并断言跨相位推进不额外消耗 `decisionPoints`（即 depth 不是相位数） |
| B-14 | 5.1 | `simulation-search.test.ts` | 断言派生上下文的 `request.tier` 恒等于根的 `tier`（在 `nextDecisionContext` 返回不同 tier 时应被拒或被规范化） |
| B-15 | 8.6 | 新增对照用例 | 同一 ActionDef 分别由人类路径与 AI 路径提交，比较 journal 条目形状、回滚行为与回放结果一致 |
| B-16 | 6.5 | `simulation-search.test.ts` | 装上一个"剪枝"实现（例如按分数上界提前返回），重跑要求 2/3/4/7/8 的关键断言，证明不变量不因候选实现替换而破坏 |
| B-17 | 1.2 | `integration.test.ts` | 断言"两类策略即使配置不同也拿不到特权"：给 `player-assistance` 配一个试图打开无过滤读取的绑定，断言仍被 `visibleTo` 约束 |
| B-18 | 7.6 | 新增表驱动断言 | 一张 `情形 → 诊断码` 表，断言映射**完备且互不重叠**（防止新增情形复用已有码） |

### P4 —— 文档 / 流程类（可机器化但需先确定承载物）

| # | 对应条 | 建议落点 | 建议断言 |
|---|---|---|---|
| B-19 | 12.4 | ✅ **已落地**：`test/toolchain/spec-document-discipline.test.ts` | 扫描活跃 `.kiro/specs/**` 与 `docs/**`，排除明确归档目录；硬禁无歧义复合词；声明禁令文件按职责豁免且有死豁免检查；6 个文件共 23 处既有违规采用精确条数棘轮，目标为空表。当前因此仍记 ◐，不是把基线当永久许可 |
| B-20 | 12.1 | ✅ **已落地**：同文件 | 自动发现全部活跃 `.kiro/specs/*/requirements.md` 并与 adoption map 双向比对；`fully-adopted` 逐要求小节恰有一个 footer，`not-adopted` 逐节为零，`partially-adopted` 精确棘轮且禁止小节内重复。`wakeup-ai` 12/12 通过 |
| B-21 | 9.6 / 12.2 | 扩大既有扫描 | 把 `ai.test.ts:16` 的扫描范围从 5 个文件扩到 `src/core/kernel/ai/**` 全体，并把字段清单扩到本条列举的项（声音衰减、视距、AP、DC、路线长度等） |
| B-22 | 10.7 / 12.5 / 12.6 | **需先有承载物，非补测能解决** | 这三条要求的是"逐字段登记件"，AI 侧当前既无结构也无实现。**但不必从零设计**——仓库已有三种相邻形态可作为形状参考或直接接入点：`src/core/ugc/model/contract-types.ts` 的 `IntegrationContract`（**其 `INTEGRATION_DOMAINS` 已含 `'ai'`**，但只有 7 个属性、是提供方级而非逐字段级）、`src/ui/ports/pending-contracts.ts`（UI 侧待汇合端口声明）、`src/play/profiles/known-divergences.ts`（L3 分歧登记）。**可选路径有二**：(i) 扩展 UGC 侧目录到逐字段并让 AI 作为 provider 接入；(ii) AI 侧自建登记并与 UGC 目录建立引用关系。**选哪条属设计裁决，本审计不裁决，只登记事实并提请裁决（见裁决入口 §十一 A-AI-01）** |

---

## 四、本审计未覆盖的诚实边界

1. **只审计了 requirements.md 的验收标准**，未逐条核对 `design.md` 的不变量章节是否另有未被 requirements 覆盖的约束（PT-04 的 DoD 只要求 requirements 逐条矩阵）。design.md 已完整阅读，用于判断"某条验收标准是否根本没有实现"，但未单独出 design 矩阵。
2. **未审计 `.kiro/specs/wakeup-ai/tasks.md` 的复选框**与现实的一致性（属 PT-03 范围）。
3. **未运行覆盖率工具**（无 istanbul/c8 配置）。"零覆盖代码"的结论来自静态追踪：识别分支的唯一入口条件（如 `isDeferred`、`CandidateSeed.intent`）并检索全部测试中该条件的取值。这比行覆盖率更精确地指向"哪条语义分支没被验证"，但不等价于工具产出的行/分支覆盖率数字。
4. **未修改任何实现或测试**（PT-04 §5 黑名单）。清单里 B-04 涉及改动一条既有测试的强度，已在条目内标注需先确认归属。
5. 9 个测试文件在 2026-08-10 的全仓运行中全部通过；本审计**不质疑其通过性**，只陈述"通过的断言覆盖了哪些验收标准、没覆盖哪些"。
6. **初稿有一处方法论缺陷，已在 12.4 暴露并更正**：审计初稿默认"覆盖某模块的断言应该在该模块目录内"，因此只在 `src/core/kernel/ai/__tests__/` 里找证据。这漏掉了**跨目录的仓库级守卫**。复核时已针对所有 ⬜ 与源码扫描类条目重新检索全仓。
7. **审计后守卫回流验证**：`test/toolchain/spec-document-discipline.test.ts` 8/8、`test/toolchain` 20/20、`tsc --noEmit` 0 error、lint 0 error / 8 个既有 warning。守卫落地时全量曾为 198 文件/2292 测试全绿；随后并发新增 UGC/UI 文件使套件扩到 204/2337 并出现新红灯，当前剩 UGC 零耦合守卫 1 失败。B-19 仍保留 23 处精确基线，未伪称全量清零。
