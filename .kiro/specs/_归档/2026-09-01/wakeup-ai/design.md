# Design Document

## Overview

WakeUp AI 是引擎层公开契约的受限消费者，不是拥有完整世界读取或状态写入特权的平行运行时。它支持两种策略类别：

- **玩家辅助策略**只生成只读推荐、解释和诊断；不能提交动作。
- **NPC 行为策略**为已验证绑定的 AI Agent 生成候选，并且只能在重新验证后通过既有 Action → Decision/Intent → `OpRegistry.invoke` → Transaction/Hook 链路提交。

本设计落实 [requirements.md](requirements.md) 的 12 条需求。它不定义具体 NPC、巡逻线、感知参数、地图策略、玩家可见难度数值、评估权重或唯一搜索算法。剪枝、缓存、排序、置换表、随机仲裁和调试表现均是未来可替换的候选实现，不能改变本设计的认知、合法性、写入、试探和诊断不变量。

现有 `src/core/kernel/ai/search.ts` 不是最终入口：它向策略公开完整 `WorldState`，采用二人最大最小递归、注入式动作枚举和不改变状态的模拟占位。迁移时仅保留可被新契约吸收的有限数评估守卫、根节点固定认知和根节点固定分层思想；旧公开入口、全局状态读取、具体实体字段启发式、无受控实体时的可见实体 fallback 与占位模拟必须移除。

## Goals and non-goals

### Goals

1. AI 与人类经同一 `queryActions`、Policy、Decision、Intent、事务、Hook 和 `OpRegistry.invoke` 规则链行动。
2. 每次 AI 决策只消费由 `visibleTo`、Knowledge 和 Agent 授权范围构造的只读认知切片。
3. 多人搜索以老实模型在连续单步决策点展开；精算/粗略层级在根节点固定。
4. 试探复用 checkpoint/restore、规范提交链路和影子随机流，且不污染真实状态、主随机流、journal 或表现订阅。
5. 绑定、候选、评估、认知、Decision/Intent、预算和事务失败都产生可关联、可诊断、可重放的结果。
6. 基类层提供可复用 AI 行为类、Schema 和验证结果；玩法层提供具体 NPC、地图策略和玩法数值。

### Non-goals

- 不在 AI 内复制 Query、Op、事务、Policy、Decision、Intent、Knowledge、随机或持久化机制。
- 不将任何 NPC 状态列表、感知范围、行动成本、路线或战斗行为设成通用默认值。
- 不把内部决策点、预算、评分、耗时或节点数变成玩家可见玩法数值。
- 不向 UI 或 UGC 暴露隐藏事实、私有 Knowledge、未公开 Intent、完整世界状态或可写引用。
- 不在本设计冻结具体搜索优化、性能目标或调试 UI。

## Architecture

```text
玩家辅助 / NPC 调度器 / UI / UGC
              │ 受限 AI 请求
              ▼
        AIDecisionFacade
              │ 绑定、权限、诊断生命周期
              ▼
 AIReadGateway ──► Query + visibleTo + Knowledge
      │                     │
      │                BeliefSlice
      ▼                     │
 CandidatePlanner ◄── queryActions + 已验证 Policy
      │
      ├─ Rule / Scripted Planner
      └─ SearchPlanner（可替换算法）
              │
 EvaluationGuard / BudgetLedger / Tier Plan
              │
      CandidateCommitGateway ──► canonical Action → Decision/Intent → Op
              │
 SimulationAdapter ──► checkpoint/restore + shadow RNG + canonical chain
              │
 Diagnostics / Journal / Read-only explanation projection
```

`AIDecisionFacade` 是唯一正式公共入口。它不接收可自由读取的完整世界状态，不导出可写状态，也不接受任意动作枚举或状态写入回调。所有上游能力由受限网关注入；当某项上游契约缺失时，对应网关按缺口性质返回一个可区分、指明缺失契约的失败关闭诊断（例如提交/验证适配缺失用 `AI_CONTRACT_UNAVAILABLE`、相关性配置缺失用 `AI_TIER_CONFIGURATION_MISSING`、模拟推进 Op 缺失用 `AI_TRANSACTION_FAILED`），而非调用私有替代路径或统一折叠为单一诊断码。失败关闭是所有缺口的共同要求；诊断码不是。

### Dependency status

| 契约 | 状态 | AI 用途 | 缺口处理 |
|---|---|---|---|
| Query、`visibleTo`、Knowledge、`queryActions`、Policy、Decision、Intent、`OpRegistry.invoke`、事务、诊断 | 引擎层已冻结的基础原语 | 读取、合法候选、规范提交和诊断映射 | 缺少稳定权限/结果语义则失败关闭 |
| 动作到 Decision/Intent/Op 的提交适配 | 待冻结 AI 集成适配 | `CandidateCommitGateway.submit` | 禁止 `act`，返回 `AI_CONTRACT_UNAVAILABLE` |
| Query/Knowledge 版本和可见性刷新语义 | 待冻结 AI 集成适配 | 过期候选检测 | 重新读取后保守拒绝，不能伪造版本 |
| checkpoint/restore、影子随机流、表现订阅静默的联合范围 | 待冻结 AI 集成适配 | `SimulationAdapter` | 禁止搜索型实际执行，不能使用空状态模拟 |
| 基类层行为类验证和数值归属结果 | 待冻结基类层适配 | NPC/玩法绑定 | 拒绝未验证绑定，不能自行解析 Schema |

## Type ownership and interfaces

### Type ownership and freeze status

| 类型 | 所有者 | AI 使用方式 |
|---|---|---|
| `Ref`、`Value`、`Query`、`LegalAction`、通用 `Result` | 引擎层 | 仅类型导入；由引擎层稳定导出 |
| Action/Decision/Intent 提交结果、版本令牌、checkpoint 句柄 | 引擎层 AI 集成适配 | 未冻结前封装为失败关闭网关，不猜测字段形状 |
| 行为类 Schema、字段路径、参数归属和引用验证 | 基类层 | 仅消费 `ValidatedAIBehaviorBinding`，不复制验证器 |
| `AIDiagnostic`、请求/结果、预算、解释节点、公开诊断投影、搜索上下文 | AI 模块 | 本设计直接定义，必须由任务 2 实现 |
| 具体 NPC、实际参数、玩法难度和地图关系 | 玩法层 | 只能作为已经验证的绑定配置出现 |

下面所有 `Ref`、`Value`、`Query`、`LegalAction` 和 `Result` 均指已冻结引擎层类型，不在 AI 中重新定义。`CanonicalCommitResult`、版本令牌和 checkpoint 句柄使用上游 AI 集成适配抽象；在其所属层级冻结真实来源之前，它们一律封装为失败关闭网关，不猜测字段形状。

### 1. Requests, results, diagnostics and facade

```typescript
type AIPolicyCategory = 'player-assistance' | 'npc-behavior';
type PlanningTier = 'exact' | 'coarse';
type AIDiagnosticCode =
  | 'AI_POLICY_BINDING_INVALID'
  | 'AI_CONTRACT_UNAVAILABLE'
  | 'AI_NO_LEGAL_ACTION'
  // Informational only: coarse tier is fully configured but no currently legal
  // action is marked relevant. It is a normal no-op, never an error (see §3).
  | 'AI_NO_RELEVANT_ACTION'
  | 'AI_CANDIDATE_ILLEGAL'
  | 'AI_KNOWLEDGE_CHANGED'
  | 'AI_DECISION_STALE'
  | 'AI_INTENT_VOID'
  | 'AI_BUDGET_EXHAUSTED'
  | 'AI_EVALUATION_INVALID'
  | 'AI_SIMULATION_FAILED'
  | 'AI_TRANSACTION_FAILED'
  | 'AI_TIER_CONFIGURATION_MISSING'
  | 'AI_PLAY_CONFIGURATION_REQUIRED';

interface AIBudget {
  readonly decisionPoints: number;
  readonly simulations: number;
  readonly evaluationCalls: number;
}

interface AIRequestBase {
  readonly agent: Ref;
  readonly controlledEntity: Ref;
  readonly policy: Ref;
  readonly tier: PlanningTier;
  readonly budget: AIBudget;
  readonly correlationId: string;
}

interface PlayerRecommendationRequest extends AIRequestBase {
  readonly category: 'player-assistance';
  readonly mode: 'recommend';
}

interface NPCRecommendationRequest extends AIRequestBase {
  readonly category: 'npc-behavior';
  readonly mode: 'recommend';
}

interface NPCActionRequest extends AIRequestBase {
  readonly category: 'npc-behavior';
  readonly mode: 'act';
}

type AIRecommendationRequest = PlayerRecommendationRequest | NPCRecommendationRequest;
type AIDecisionRequest = AIRecommendationRequest | NPCActionRequest;

interface AIDiagnostic {
  readonly code: AIDiagnosticCode;
  readonly severity: 'info' | 'warn' | 'error';
  readonly category: AIPolicyCategory;
  readonly agent: Ref;
  readonly controlledEntity: Ref;
  readonly policy: Ref;
  readonly correlationId: string;
  readonly candidateAction?: Ref;
  readonly phase: 'bind' | 'read' | 'plan' | 'simulate' | 'revalidate' | 'submit';
  readonly reason: string;
  readonly upstreamContract: string;
  readonly hint: string;
}

interface AIExplanationNode {
  readonly kind: 'legal-action' | 'policy-rule' | 'tier' | 'evaluation' | 'revalidation';
  readonly summary: string;
  readonly visibleRefs: readonly Ref[];
}

interface AICandidate {
  readonly legalAction: LegalAction;
  readonly rationale: readonly AIExplanationNode[];
  readonly score: number;
  readonly scoreStatus: 'evaluated' | 'neutral-fallback';
  readonly rootKnowledgeVersion: string;
  readonly rootActionVersion: string;
}

interface AIDecisionResult {
  readonly status: 'recommended' | 'submitted' | 'no-action' | 'rejected';
  readonly candidate?: AICandidate;
  readonly diagnostics: readonly AIDiagnostic[];
}

interface AIDecisionFacade {
  recommend(request: AIRecommendationRequest): AIDecisionResult;
  act(request: NPCActionRequest): AIDecisionResult;
}
```

请求是判别联合类型：玩家辅助无法在类型层构造 `act` 请求；运行时仍必须拒绝任何不受信任边界伪造的玩家辅助提交。每个诊断都必带策略类别、Agent、受控实体、策略和 correlation ID；候选关联时还必带 Action。不得把这些信息仅编码在 `reason` 字符串中。

### 2. Read scope and Belief Slice

```typescript
interface AIReadGateway {
  openReadScope(agent: Ref): Result<AIReadScope>;
}

interface AIReadScope {
  readonly agent: Ref;
  readonly knowledgeVersion: string;
  readonly actionVersion: string;
  beliefSlice(): Result<BeliefSlice>;
  queryActions(actor: Ref): Result<readonly LegalAction[]>;
  query(query: Query): Result<readonly Ref[]>;
  isCurrent(version: { knowledge: string; actions: string }): boolean;
}

interface KnownFact {
  readonly value: Value;
  readonly observedAt: number;
  readonly certainty: 'observed' | 'historical' | 'uncertain';
}

interface BeliefSlice {
  readonly agent: Ref;
  readonly visibleFacts: Readonly<Record<string, Value>>;
  readonly knownFacts: Readonly<Record<string, KnownFact>>;
  readonly visibleRefs: readonly Ref[];
  readonly policyContext: Readonly<Record<string, Value>>;
}
```

`AIReadGateway` 只能通过 Query、`visibleTo`、Knowledge、Agent 权限和公开 Policy 上下文构造范围。`BeliefSlice` 不含可写引擎引用；策略不可从未列出的 Ref 推断隐藏对象。仅上游合法 `Agent.omniscient` 可省略可见性过滤，NPC 配置、策略和 UGC 无权开启该能力。

### 3. Candidate planning and tiers

```typescript
interface BudgetLedger {
  remaining(): Readonly<AIBudget>;
  consume(kind: keyof AIBudget): Result<void>;
  exhausted(): boolean;
}

interface SemanticIntent {
  readonly kind: string;
  readonly labels: readonly string[];
  readonly orderedSteps: readonly LegalAction[];
}

interface CandidateSeed {
  readonly legalAction: LegalAction;
  readonly intent?: SemanticIntent;
}

interface AIPlanNoOp {
  readonly kind: 'coarse-no-relevant-action';
  readonly declaredFallback?: string; // play-declared fallback state, surfaced for explanation
}

interface AIPlan {
  readonly rootSlice: BeliefSlice;
  readonly tier: PlanningTier;
  readonly candidates: readonly CandidateSeed[];
  readonly budget: BudgetLedger;
  readonly noOp?: AIPlanNoOp; // present only for a deliberate coarse-tier no-op; candidates is then empty
}

interface CandidatePlanner {
  plan(scope: AIReadScope, request: AIDecisionRequest): Result<AIPlan>;
}
```

候选唯一来自 `scope.queryActions(controlledEntity)`。语义意图只能组织或筛选这些合法候选，不能生成新 Action、binding 或 target，也不能写状态。精算层保留策略可处理的全部合法候选；粗略层只保留玩法层经基类层兼容 Schema 显式标记为相关的合法候选。层级在根节点固定。

粗略层必须区分「配置缺口」与「正常空结果」，二者不得折叠为同一结果：

- **配置缺口**：相关性配置缺失、引用损坏，或策略所必需的候选集合因缺失定义解析为空时，规划器采取保守的不扩张行为，返回 `AI_TIER_CONFIGURATION_MISSING` 并拒绝本次策略选择；不得把缺失配置解释为精算层默认展开。
- **正常空结果**：相关性配置完整、但当前所有合法着法都未被标记为相关时，这不是缺口。规划器返回一个成功的空候选计划并带 `AIPlanNoOp` 标记（`kind: 'coarse-no-relevant-action'`，如绑定声明了 `ValidatedAIBehaviorBinding.fallbackState` 则透传为 `declaredFallback`）；Facade 据此产生可区分的正常 no-op（`status: 'no-action'`），至多附带一条 `info` 级 `AI_NO_RELEVANT_ACTION` 诊断。规划器不得返回 `AI_TIER_CONFIGURATION_MISSING`，也不得以 `error` 级的 `AI_NO_LEGAL_ACTION` 或配置错误诊断表示。
- **单个未标记着法**只被过滤，不逐个产生诊断。

`AI_NO_LEGAL_ACTION` 仅用于 `queryActions` 本身没有任何当前可执行合法着法（与分层无关）的情形，且由 Facade 映射为 `status: 'no-action'`；它不表示粗略层的相关性筛选把候选集缩减为空。

### 4. Policy, behavior validation and configuration ownership

```typescript
interface PolicyAdapter {
  readonly category: AIPolicyCategory;
  supports(policy: Ref): Result<void>;
  createPlanner(policy: Ref, tier: PlanningTier): Result<CandidatePlanner>;
}

interface PlannerRegistry {
  resolve(policy: Ref, category: AIPolicyCategory): Result<CandidatePlanner>;
}

interface ValidatedAIParameter {
  readonly path: string;
  readonly value: Value;
  readonly schema: Ref;
  readonly owner: 'base-schema' | 'play-configuration';
  readonly playerVisible: boolean;
  readonly internalMetric: boolean;
}

interface ValidatedAIBehaviorBinding {
  readonly family: Ref;
  readonly policy: Ref;
  readonly category: AIPolicyCategory;
  readonly parameters: readonly ValidatedAIParameter[];
  readonly fallbackState?: string;
}

interface AIBehaviorValidationGateway {
  resolveValidatedBinding(binding: Ref): Result<ValidatedAIBehaviorBinding>;
}
```

AI 只消费基类层已经验证的绑定结果，不重新定义行为 Schema 或解析任意 `Record<string, Value>`。基类层验证器必须：

- 拒绝在可复用行为定义中硬编码巡逻路线、具体感知阈值、玩法专属状态机或与单一玩法绑定的 NPC 实例，并返回含字段路径、原因和玩法层归属的 `AI_PLAY_CONFIGURATION_REQUIRED` 诊断；
- 验证策略类别兼容性、字段注册、引用有效性和参数所有权；
- 对 `playerVisible:true` 的玩法配置值执行 1–5 检查；`internalMetric:true` 的预算、评分和计数不适用该检查，并且不得同时标记为玩家可见；
- 在该验证契约未冻结时使 AI 返回 `AI_CONTRACT_UNAVAILABLE`，不得以默认数值或推断填补配置。

规则型、搜索型和脚本型策略可共享 `PolicyAdapter` 的读写边界；跨类别绑定只能由经过验证的兼容性声明允许。

### 5. Evaluation guard

```typescript
interface EvaluationContext {
  readonly request: AIDecisionRequest;
  readonly slice: BeliefSlice;
  readonly candidate?: LegalAction;
}

interface EvaluationGateway {
  evaluate(actor: Ref, slice: BeliefSlice, policy: Ref): unknown;
  neutralFallback(policy: Ref): number;
}

interface EvaluationOutcome {
  readonly score: number;
  readonly status: 'evaluated' | 'neutral-fallback';
  readonly diagnostic?: AIDiagnostic;
}

interface EvaluationGuard {
  normalize(raw: unknown, fallback: number, context: EvaluationContext): EvaluationOutcome;
}
```

比较、排序、剪枝和选择之前必须通过 `EvaluationGuard`。`null`、非数值、`NaN`、无穷值和不可比较值产生 `AI_EVALUATION_INVALID`，并使用策略或上游契约声明的有限中性回退。AI 不读取具体生命值、伤害、胜负或固定权重。现有 `evaluate-guard.ts` 仅能作为迁移起点。

### 6. Canonical revalidation and commit

```typescript
interface CanonicalCommitResult {
  readonly outcome: 'submitted' | 'opened-decision' | 'submitted-intent' | 'rejected';
}

interface CandidateCommitGateway {
  revalidate(scope: AIReadScope, candidate: AICandidate): Result<LegalAction>;
  submit(agent: Ref, action: LegalAction): Result<CanonicalCommitResult>;
}
```

`revalidate` 检查认知/动作版本、当前 `queryActions` 成员资格、Action/binding/target、可见性、`require`、成本、Policy 权限和宏动作当前步骤。它还把关闭、超时、答满、作废或前置条件失效的 Decision 映射为 `AI_DECISION_STALE`，并将 Intent 的上游 void/refund 结果映射为 `AI_INTENT_VOID`。`submit` 只能调用既有 Action → Decision/Intent → `OpRegistry.invoke` 链；AI 不直接修改任何语义字段，也不替换失效候选的目标。

### 7. Simulation and sequential multi-agent search

```typescript
interface SimulationOutcome {
  readonly checkpoint: string;
  readonly visibleStateChanged: boolean;
  readonly decisionState: 'none' | 'open' | 'resolved' | 'void';
  readonly intentState: 'none' | 'pending' | 'resolved' | 'void';
}

interface SimulationHandle {
  attempt(actor: Ref, candidate: LegalAction): Result<SimulationOutcome>;
  restore(): Result<void>;
  close(): Result<void>;
}

interface SimulationAdapter {
  begin(request: NPCActionRequest): Result<SimulationHandle>;
}

interface SearchDecisionContext {
  readonly request: AIDecisionRequest;
  readonly scope: AIReadScope;
  readonly behavior: ValidatedAIBehaviorBinding;
}

interface SearchSession {
  readonly root: SearchDecisionContext;
  evaluate(context: SearchDecisionContext, slice: BeliefSlice): EvaluationOutcome;
  simulate(context: SearchDecisionContext, candidate: LegalAction): Result<SimulationOutcome>;
  nextDecisionContext(after: SimulationOutcome): Result<SearchDecisionContext | undefined>;
  remainingBudget(): Readonly<AIBudget>;
}

interface SearchPlanner extends CandidatePlanner {
  search(session: SearchSession, root: AIPlan): Result<AICandidate | undefined>;
}
```

`SimulationAdapter.attempt` 经过与真实提交相同的 Action → Decision/Intent → Op → Transaction/Hook 链，规则 Hook、前置条件、成本、不变量和诊断都必须执行。它使用影子随机流；表现层外部订阅可以按上游契约静默，但规则和失败诊断不得静默。所有成功、失败、异常和预算中断路径都必须 restore 并 close。

搜索按连续单步决策点运行。`nextDecisionContext` 必须为下一参与者返回已经验证的 Agent、受控实体、Policy、策略类别、读范围和行为绑定；SearchPlanner 以该上下文重新解析 Planner、重新建立认知切片、重新获取合法候选。每个参与者按自己的 Policy 与评估选择，不得被建模为根 AI 的联合对手。预算耗尽时仅返回已经重新验证的候选、声明的回退或 `no-action`。具体剪枝、缓存和排序均非本设计强制项。

### 8. UI, UGC, persistence and explanation

```typescript
interface PublicAIDiagnostic {
  readonly code: AIDiagnosticCode;
  readonly severity: AIDiagnostic['severity'];
  readonly phase: AIDiagnostic['phase'];
  readonly reason: string;
  readonly hint: string;
}

interface AIExplanationProjection {
  readonly status: AIDecisionResult['status'];
  readonly recommendation?: Readonly<LegalAction>;
  readonly reasons: readonly AIExplanationNode[];
  readonly diagnostics: readonly PublicAIDiagnostic[];
}
```

解释投影必须按决策者 Belief Slice 再过滤 `visibleRefs` 和原因文本，不能泄露隐藏事实、私有 Knowledge、未公开 Intent、完整评分明细或世界结构。UGC 只能声明式引用已注册 Policy、行为类与玩法配置；它不能注入任意代码、直接 Op、可写状态、全知标记或可见性绕过。

真实提交由上游 journal 记录。给定等价的公开状态、认知、Policy、命名随机流和提交序列，系统必须再现等价提交结果与诊断分类。影子随机流的试探过程不得污染真实 journal 或回放数据。

## Main flows

### Recommendation flow

```text
validate typed request/category and behavior binding
  → open read scope and belief slice
  → queryActions(controlled entity)
  → select fixed exact/coarse candidates
  → rule/scripted/search planning with guarded evaluation and budget
  → revalidate current candidate
  → return read-only recommendation + filtered explanation + diagnostics
```

玩家辅助只允许此流程。NPC 推荐也可使用此流程，但不能因推荐结果而修改状态。

### NPC action flow

```text
validate NPC action request and behavior binding
  → recommendation flow
  → revalidate immediately before commit
  → canonical Action → Decision/Intent → Op path
  → map upstream outcome and diagnostics
  → return submitted/rejected/no-action result
```

### Search simulation flow

```text
open root SearchDecisionContext with fixed tier
  → begin checkpoint + shadow random scope
  → get candidates from current scope.queryActions
  → attempt one legal action through canonical chain
  → derive next participant SearchDecisionContext and belief slice
  → recurse one continuous single-step decision point
  → restore parent checkpoint
  → consume budget or choose verified result
  → close handle and restore root
```

## Invariants and failure handling

| 不变量 | 机制 | 失败结果 |
|---|---|---|
| 非全知 AI 不读隐藏信息 | `AIReadGateway` / `BeliefSlice` | 拒绝读取并诊断 |
| 候选均合法 | `queryActions` 为唯一来源；提交前重验 | 不提交、`AI_CANDIDATE_ILLEGAL` |
| 人机规则同权 | 相同 Action/Decision/Intent/Op/事务/Hook 链 | 上游规则决定结果，无 AI 特例 |
| AI 不直接写状态 | `CandidateCommitGateway` / 静态边界测试 | 拒绝越权接口 |
| 试探无污染 | checkpoint/restore + 影子随机流 | 恢复父状态并诊断 |
| 无效评估不参与比较 | `EvaluationGuard` 有限回退 | `AI_EVALUATION_INVALID` |
| 不使用过期候选 | 版本、Decision/Intent 与当前动作重检 | 拒绝候选并诊断 |
| 粗略层不猜测配置 | 显式相关性标记 | 配置缺失/损坏/因缺定义解析为空时不扩张并 `AI_TIER_CONFIGURATION_MISSING`；配置完整但全部未标记时按正常 no-op/声明回退处理，至多 `info` 诊断 |
| 玩法参数不越层 | 已验证行为绑定 | 拒绝并指出玩法层归属 |

## Migration of existing implementation

1. 将 `belief-slice.ts` 迁移为 `AIReadGateway` 内部实现；输入必须来自 Query、`visibleTo` 和 Knowledge。
2. 将 `evaluate-guard.ts` 迁移为统一 `EvaluationGuard`，返回完整 `EvaluationOutcome` 与必填关联诊断。
3. 将 `tiering.ts` 迁移为根节点 `PlanningTier` 解析，不允许递归时切换层级。
4. 用 `SearchDecisionContext`、`SearchSession`、`SimulationAdapter` 和 `AIDecisionFacade` 替换旧 `aiSearch(agentId, state, config, listLegalActions)`。
5. 移除完整 `WorldState` 公共入口、任意动作枚举回调、空状态模拟、具体实体字段评分及首个可见实体 fallback。
6. 移除二人最大最小/αβ 专属公共语义；若保留优化，只能是满足本设计不变量的私有候选实现。
7. 在端到端测试证明唯一入口、认知边界、规范提交和回放语义后，删除旧导出、调用点和旧测试假设。

## Requirements traceability

| Requirements | 设计落点 |
|---|---|
| 1 | 判别请求、必填诊断关联、PolicyAdapter、行为绑定验证 |
| 2 | AIReadScope、CandidatePlanner、CandidateCommitGateway |
| 3 | AIReadGateway、BeliefSlice、解释投影 |
| 4 | SearchDecisionContext、连续单步决策点、顺序多人搜索 |
| 5 | PlanningTier、SemanticIntent、逐步重新验证 |
| 6 | EvaluationGateway、EvaluationGuard、候选算法边界 |
| 7 | 规范提交、Decision/Intent 映射、BudgetLedger |
| 8 | SimulationAdapter、canonical commit、影子随机流 |
| 9 | AIBehaviorValidationGateway、ValidatedAIBehaviorBinding、参数 provenance |
| 10 | 依赖状态表、UI/UGC 投影、失败关闭网关 |
| 11 | 必填 AIDiagnostic、解释过滤、journal/replay |
| 12 | 类型所有权表、迁移规则、候选实现与冻结状态 |

## Unresolved integration boundaries

以下边界必须由对应层级冻结后再接线：规范提交适配、可见性/Knowledge 版本语义、试探的随机与表现范围、基类层行为验证结果、玩法层具体配置以及 UI/UGC 展示体验。每项缺口都必须失败关闭，并返回一个指明缺失契约与所属层级、按缺口性质选择的可区分诊断码（视缺口而定，如 `AI_CONTRACT_UNAVAILABLE`、`AI_TIER_CONFIGURATION_MISSING`、`AI_TRANSACTION_FAILED`），不得统一固定为单一诊断码；不得借用完整世界读取、直接状态修改、默认数值或私有适配器临时绕过。

注意区分「缺口」与「正常结果」：粗略层「相关性配置完整但当前所有合法着法均未被标记」不是契约缺口，必须按正常 no-op 或行为绑定声明的回退处理，不得失败关闭（见第 3 节）。 
