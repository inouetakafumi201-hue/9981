# Implementation Plan

## Overview

本计划把 [design.md](design.md) 转化为依赖有序的 TypeScript 实施任务。AI 的最终形态是引擎层公开契约的受限消费者：只读取认知切片与合法着法，试探使用 checkpoint/restore 和影子随机流，真实提交只经过 Action → Decision/Intent → `OpRegistry.invoke` → Transaction/Hook。

本计划不实现具体 NPC、地图策略、玩家可见难度、具体玩法数值、固定搜索算法、缓存/剪枝/排序策略、评分权重或调试 UI。它们属于玩法层或后续候选实现，不能以默认机制进入 AI 核心。

## Dependency graph

```text
1 上游契约证据与基线
  └─ 2 公共类型、判别请求、诊断与静态边界
       ├─ 3 AI Read Gateway / Belief Slice
       ├─ 4 Evaluation Guard
       ├─ 5 行为绑定验证与参数 provenance
       └─ 6 Candidate Planner / Tier / Semantic Intent
            └─ 7 Canonical Revalidation / Commit Gateway
                 ├─ 8 Facade 的规则/脚本推荐与 act 骨架
                 └─ 9 Simulation Adapter
                      └─ 10 Sequential multi-agent Search Planner
                           └─ 11 迁移既有 AI 并收敛唯一入口
                                └─ 12 基类层、玩法层、UI、UGC 集成
                                     └─ 13 端到端、回放与架构验收
```

任务 3、4、5、6 在任务 2 后可并行。任务 8 与 9 都依赖任务 7；任务 10 必须等待 3、4、5、6、7、9；任务 11 等待 8 和 10；任务 12 等待 11；任务 13 等待 12。不得在提交网关建立前实现试探规范链，也不得在跨层适配完成前宣称端到端验收。

## Tasks

- [x] 1. 建立上游契约证据、失败关闭策略和工程基线
  - 定位拥有 `src/core/kernel` 的实际 package、TypeScript 配置、测试运行器、lint、构建和 CI 命令；记录真实命令，不假设根目录脚本存在。
  - 逐项核验 Query、`visibleTo`、Knowledge、`queryActions`、Policy、Decision、Intent、`OpRegistry.invoke`、事务/Hook、诊断的稳定导出、权限、输入、结果和失败语义。
  - 分别核验或记录为待冻结：规范提交适配、版本/刷新语义、checkpoint/restore 与影子随机流/表现订阅的联合范围、基类层行为验证结果。
  - 为每个未冻结项登记责任层、证据位置、受影响 AI 能力，以及按缺口性质选择的可区分失败关闭诊断码（视缺口而定，如 `AI_CONTRACT_UNAVAILABLE`、`AI_TIER_CONFIGURATION_MISSING`、`AI_TRANSACTION_FAILED`，不得统一固定为单一码）；失败关闭是所有缺口的共同要求，诊断码不是。禁止用私有适配器填补。本任务只核验并登记证据、建立工程基线，不冻结任何上游契约——上游契约由其所属层级冻结，AI 侧不得把契约可用性反向依赖到本任务。
  - 运行现有类型检查和测试，记录可复现基线并区分既有失败。
  - _Requirements: 1, 8, 10, 12_

- [x] 2. 建立公共类型、判别请求、必填诊断和静态架构边界
  - 在 `src/core/kernel/ai` 实现本地类型：`AIBudget`、`BudgetLedger`、`AIDiagnosticCode`、`AIDiagnostic`、`AIExplanationNode`、`PublicAIDiagnostic`、`EvaluationContext`、`AICandidate`、结果类型和各受限网关接口。
  - 将 `AIDecisionRequest` 实现为判别联合：玩家辅助只能构造 `mode:'recommend'`；只有 NPC 行为策略能构造 `mode:'act'`。定义 `AIDecisionFacade.recommend` 与 `act` 的精确输入/输出。
  - 每个诊断强制包含策略类别、Agent、受控实体、Policy、correlation ID、阶段、上游契约和修复提示；候选关联时强制包含候选 Action。禁止将关联信息仅写进 reason 文本。
  - 建立并测试全部诊断代码，包括 `AI_PLAY_CONFIGURATION_REQUIRED`；测试绑定失败、候选拒绝、预算耗尽和试探失败的字段级完整性。
  - 建立静态架构测试，确认正式 AI API 不暴露完整 `WorldState`、可写世界引用、任意动作枚举回调或状态写入回调；确认无直接世界/Knowledge/随机/资源写入及第二条 Op/事务写入通道。
  - 编写编译期断言，玩家辅助请求不可构造 `act`；编写运行时防御测试，伪造的玩家辅助提交被拒绝且零状态改变。
  - _Requirements: 1, 8, 10, 11, 12_

- [x] 3. 实现 AI Read Gateway 与不可变认知切片
  - 实现 `AIReadGateway.openReadScope(agent)`，只经 Query、`visibleTo`、Knowledge、Agent 权限和公开 Policy 上下文建立 `AIReadScope`。
  - 实现不可变 `BeliefSlice`，区分可见事实、历史/不确定 Knowledge、可见 Ref 和公开 Policy 上下文；不得返回可写引擎引用。
  - 接入或保守适配 `knowledgeVersion`、`actionVersion` 与刷新语义；上游未冻结版本时重新读取并拒绝不确定候选，不得伪造版本。
  - 只允许上游合法 `Agent.omniscient` 省略可见性过滤；拒绝策略、NPC 配置或 UGC 擅自声明全知。
  - 编写属性测试：任意非全知 Agent 的切片、Query 和解释输入均不含隐藏对象、隐藏 Intent、其他 Agent 私有 Knowledge 或不可见容器内容。
  - _Requirements: 2, 3, 10, 11_

- [x] 4. 实现可替换评估网关与有限回退守卫
  - 将 `evaluate-guard.ts` 迁移为 `EvaluationGateway` + `EvaluationGuard`；AI 核心不读取具体生命值、伤害、胜负或固定权重。
  - 在比较、排序、搜索截断和选择前守卫所有评估；对 `null`、非数值、`NaN`、无穷或不可比较值产生完整 `AI_EVALUATION_INVALID` 并使用显式有限中性回退。
  - 在候选和结果中保存 score 状态及关联诊断；无效或非有限回退本身必须失败关闭。
  - 编写参数化与性质测试，证明任意输入经守卫后产生有限 score，且每个无效输入都有诊断和正确关联字段。
  - _Requirements: 6, 11, 12_

- [x] 5. 接入基类层行为验证与玩法参数 provenance
  - 定义 `AIBehaviorValidationGateway` 只消费基类层验证结果，并实现 `ValidatedAIBehaviorBinding`、`ValidatedAIParameter` 的适配层；AI 不接受未经验证的自由配置对象。
  - 令验证结果为每个参数提供字段路径、Schema 引用、归属层、`playerVisible` 与 `internalMetric` 标记。
  - 接入基类层的拒绝结果：可复用定义中硬编码巡逻路线、具体感知阈值、玩法专属状态机或单一玩法 NPC 实例时，返回带字段路径、玩法层归属和 `AI_PLAY_CONFIGURATION_REQUIRED` 的诊断。
  - 对玩家可见玩法配置执行 1–5 验证；测试 0/6 被拒绝、1/5 被接受，内部预算/评分不触发该检查，且任何字段不能同时被标为玩家可见和内部度量。
  - 上游验证契约未冻结时，拒绝绑定并返回 `AI_CONTRACT_UNAVAILABLE`；不以内建默认值替代。
  - _Requirements: 1, 5, 9, 10, 11, 12_

- [x] 6. 实现唯一候选源、根节点分层和语义意图
  - 实现 `CandidatePlanner`，只从当前 `AIReadScope.queryActions(controlledEntity)` 获取候选；禁止 AI 专用 Action 清单、手工 binding 或目标生成。
  - 实现根节点 `PlanningTier`：精算层保留策略可处理的全部合法候选；粗略层只保留玩法层经验证 Schema 显式标记相关的候选。不得隐式切换精算层；整条搜索链不得改变根节点 tier。
  - 粗略层必须区分「配置缺口」与「正常空结果」，二者不得折叠为同一诊断码：
    - 相关性配置缺失、引用损坏，或策略所必需的候选集合因缺失定义解析为空时，保守不扩张并返回 `AI_TIER_CONFIGURATION_MISSING` 拒绝本次策略选择；不得把缺失配置解释为精算层默认展开。
    - 相关性配置完整、但当前所有合法着法都未被标记为相关时，这不是缺口：规划器返回带 `AIPlanNoOp`（`kind: 'coarse-no-relevant-action'`，透传 `ValidatedAIBehaviorBinding.fallbackState` 为 `declaredFallback`）的成功空候选计划，Facade 据此产生可区分的正常 no-op（`AIDecisionResult.status = 'no-action'`），至多附带一条 `info` 级 `AI_NO_RELEVANT_ACTION` 诊断；禁止返回 `AI_TIER_CONFIGURATION_MISSING`，也禁止以 `error` 级 `AI_NO_LEGAL_ACTION` 或配置错误表示。
    - 单个未标记着法只被过滤，不逐个产生诊断。`AI_NO_LEGAL_ACTION` 仅保留给 `queryActions` 无任何当前可执行合法着法（与分层无关）的情形。
  - 实现只读 `SemanticIntent`，它只能组织/筛选合法候选步骤，不能产生新 Action 或写状态。
  - 编写测试：精算层新增合法 Action 自动可见；粗略层未标记 Action 被排除、标记后可用；粗略层「配置完整但全部合法着法未标记」产生可区分 no-op/声明回退，诊断恰为一条 `info` 级 `AI_NO_RELEVANT_ACTION`（断言不是 `AI_TIER_CONFIGURATION_MISSING`、不是 `error` 级 `AI_NO_LEGAL_ACTION`，且零提交）；粗略层「配置缺失/引用损坏/因缺定义解析为空」产生 `AI_TIER_CONFIGURATION_MISSING`。性质测试（一属性一文件、fast-check ≥100 runs、标签 `Feature: wakeup-ai, Property {N}: {property_text}`）保证规划结果和语义步骤都是相同读范围合法动作集的成员，并覆盖上述粗略层 no-op 不变量。
  - _Requirements: 2, 5, 7, 9, 11_

- [x] 7. 实现候选重新验证和规范提交网关
  - 实现 `CandidateCommitGateway.revalidate`，检查版本、当前合法动作成员资格、Action/binding/target、可见性、`require`、成本、Policy 授权和宏动作当前步骤。
  - 将关闭/超时/答满/作废或前置条件失效的 Decision 映射为 `AI_DECISION_STALE`；将上游 Intent void/refund 映射为 `AI_INTENT_VOID`；AI 不复制 Decision/Intent 结算逻辑。
  - 实现 `submit`，只调用 Action → Decision/Intent → `OpRegistry.invoke` 既有路径；不直接写任何语义字段，不替换失效候选。
  - 编写集成测试覆盖非法候选、目标/成本/可见性失效、过期 Decision、void Intent 和无合法候选；每项拒绝保持有效状态并产生完整诊断。
  - _Requirements: 2, 3, 5, 7, 8, 11_

- [x] 8. 实现规则/脚本 Policy Adapter 与 Facade 骨架
  - 实现按玩家辅助和 NPC 行为分离的 `PolicyAdapter`/`PlannerRegistry`；跨类别绑定只能来自任务 5 验证的兼容性结果。
  - 接入规则型策略的公开 Query/表达式读取和脚本型策略的上游 Flow；两者都只产出任务 6 的合法候选。
  - 实现 `AIDecisionFacade.recommend` 和 `act` 骨架：推荐调用任务 7 revalidate；NPC act 在重新验证后调用 canonical commit；玩家辅助不可能进入 commit。
  - 搜索型策略尚未完成时必须返回 `AI_CONTRACT_UNAVAILABLE`，不能回退到旧搜索入口或状态不变的模拟。
  - 编写类别绑定、推荐零状态改变、NPC act 规范提交和搜索未可用时失败关闭的测试。
  - _Requirements: 1, 2, 6, 7, 8, 10, 11_

- [x] 9. 实现 Simulation Adapter 与无污染试探
  - 使用任务 7 的规范提交网关封装 checkpoint/restore、影子随机流、事务、Hook 和 Action/Decision/Intent 链为 `SimulationAdapter`；只暴露 begin/attempt/restore/close。
  - `attempt` 必须执行同一规则链、前置条件、成本、Hook、不变量和诊断；表现层外部订阅仅按上游契约静默，规则与失败诊断不得静默。
  - 保证成功、失败、异常和预算中断均 restore/close 并释放 checkpoint；真实状态、主随机流、真实 journal 和表现事件不可被污染。
  - 缺少上游模拟契约时禁止搜索型实际执行并返回 `AI_CONTRACT_UNAVAILABLE`；不得使用空状态模拟。
  - 编写事务性和性质测试，证明任意合法候选试探后恢复的快照、主随机流和真实 journal 与起点等价。
  - _Requirements: 4, 7, 8, 11_

- [x] 10. 实现顺序多参与者 Search Planner 与预算守卫
  - 实现 `SearchDecisionContext` 和 `SearchSession.nextDecisionContext`，使每个派生决策点取得经验证的 Agent、受控实体、Policy、类别、读范围和行为绑定。
  - 每个连续单步决策点都用该参与者自己的 Policy、认知切片、`queryActions` 和评估建立计划；不得把后续参与者合并为根 AI 的联合对手。
  - 仅将 depth/预算计入连续单步决策点；不得按完整角色回合、相位批次或同时结算轮次计算。
  - 使用 `BudgetLedger` 约束决策点、模拟和评估调用；任一上限耗尽时只返回已经重验的候选、声明回退或 `no-action`，并产生完整 `AI_BUDGET_EXHAUSTED`。
  - 不强制实现剪枝、缓存、排序、置换表或随机仲裁；任何未来优化必须通过同一认知、试探、预算和提交测试。
  - 编写三参与者场景，使用不同 Policy 与受控实体断言第二、第三参与者确实按自己的上下文选择；验证 depth 语义和每种预算耗尽分支。
  - _Requirements: 3, 4, 5, 6, 7, 8, 11_

- [x] 11. 迁移现有 AI 并收敛唯一正式入口
  - 将 `belief-slice.ts`、`tiering.ts`、`evaluate-guard.ts` 分别迁移到任务 3、6、4 的新边界。
  - 用 `SearchDecisionContext`、`SearchSession`、`SimulationAdapter`、`CandidateCommitGateway` 和 `AIDecisionFacade` 替换 `search.ts` 的旧 `aiSearch(agentId, state, config, listLegalActions)` 入口。
  - 删除完整世界公共入口、任意枚举回调、空状态模拟、具体实体字段评分、首个可见实体 fallback，以及二人最大最小/αβ 专属公共语义。
  - 更新导出、调用点、fixture 和测试，使 `AIDecisionFacade` 成为唯一正式入口；候选优化若保留只能是私有实现。
  - 运行所属 package 的类型检查、静态边界检查和 AI 完整测试，修复迁移引入的失败。
  - _Requirements: 1–8, 11, 12_

- [x] 12. 完成基类层、玩法层、UI 与 UGC 的只读集成
  - 只通过任务 5 的行为验证结果消费基类层 Schema 和玩法层配置，拒绝未验证行为定义、越层定义、越界玩家可见数值和缺失 provenance。
  - 实现 UI 解释投影，只暴露推荐、合法性原因、经 Belief Slice 过滤的解释与公共诊断；测试不泄露隐藏事实、私有 Knowledge、未公开 Intent 或完整世界结构。
  - 实现 UGC 的声明式 AI 接入：只允许已注册 Policy、行为类与玩法配置引用；拒绝任意代码、直接 Op、可写状态、全知声明和可见性绕过。
  - 验证新增合法行为类和 Action 可在不改 AI 核心的情况下被适配器消费。
  - _Requirements: 1, 5, 9, 10, 11, 12_

- [x] 13. 完成端到端、回放和架构验收
  - 构造受限信息场景，分别以人类与 AI 调用同一 `queryActions`/提交链路，断言候选、前置条件、成本、Hook、事务结果和拒绝理由一致。
  - 覆盖隐藏对象/Intent、私有 Knowledge、认知变化、失效目标、过期 Decision、void Intent、无效评估、预算耗尽、模拟失败和 Op/事务失败；逐项断言诊断完整字段、回滚/状态保持和无泄密。
  - 验证相同公开状态、认知、Policy、命名随机流和提交序列产生等价的提交结果与诊断分类；影子随机流不改变真实随机、journal 或回放。
  - 执行静态扫描，确认不存在完整世界公开读取、直接状态写入、AI 专用合法动作清单、硬编码玩法/NPC 参数、旧 `aiSearch` 公开入口或宪法禁用术语。
  - 运行任务 1 确认的类型检查、单元测试、属性测试、集成测试、lint 和构建命令；任何失败都必须修复或明确归类为实施前可复现阻断项，不能跳过、过滤或降低断言。
  - 对照 requirements 1–12 与 design traceability 表逐条确认至少一个实现任务和一个验证场景；确认所有未冻结边界保持失败关闭。
  - _Requirements: 1–12_

## Verification matrix

| 验证主题 | 覆盖任务 | 关键断言 |
|---|---|---|
| 请求、绑定和诊断字段 | 2、5、8、13 | 非法类别拒绝；诊断有类别、实体、策略、关联和相关 ID |
| 同权合法动作 | 3、6、7、13 | AI 候选是 `queryActions` 子集，提交走同一规则链 |
| 认知和隐私 | 3、7、10、12、13 | 非全知 AI、UI、UGC 不获取隐藏事实 |
| 顺序多人决策 | 9、10、13 | 每个参与者有自己的上下文；depth 为连续单步 |
| 精算/粗略分层 | 6、10、13 | 根节点固定；缺失相关性不扩张 |
| 评估和预算 | 4、10、13 | 无效值有限回退；所有预算分支有诊断 |
| Decision/Intent/提交 | 7、8、9、13 | 过期/void 不留残余；无直接写入 |
| 试探和随机隔离 | 9、10、13 | restore 后状态、主随机和 journal 等价 |
| 行为 Schema、数值和层级 | 5、12、13 | 禁止定义拒绝；可见值 1–5；内部度量豁免 |
| 回放和候选实现边界 | 11、13 | 新入口唯一；同输入可重现；未冻结算法不被固化 |

## Deferred boundaries

提交适配、版本/刷新语义、checkpoint/restore 与随机/表现的联合范围、基类层行为验证、玩法层具体配置以及 UI/UGC 体验，均必须由对应层级冻结后再接线。任何缺口都必须失败关闭，并返回带来源和修复建议、按缺口性质选择的可区分诊断码（视缺口而定，如 `AI_CONTRACT_UNAVAILABLE`、`AI_TIER_CONFIGURATION_MISSING`、`AI_TRANSACTION_FAILED`），不得统一固定为单一码；不得以完整世界读取、直接状态修改、默认数值或私有适配器临时绕过。

注意：粗略层「相关性配置完整但当前所有合法着法未标记」不是缺口，须按任务 6 规定产生可区分的正常 no-op 或声明回退，不得失败关闭。
