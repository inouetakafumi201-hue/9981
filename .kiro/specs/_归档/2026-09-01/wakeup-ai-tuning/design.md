# 设计文档

## 概述

本设计文档描述「AI 自主学习迭代系统」的架构和实施细节。该系统让 agent 能自主调优 AI 决策（设计货币费目表），当 AI 在某个场景表现不符合预期时，agent 通过「观测决策证据链 → 归因到具体费目 → 受限调参 → 验证无破坏 → 记录与报告」闭环修复，并以 `ai-tuning` skill 作为收尾入口，让任何 agent 能快速进入稳定的调参专业状态，而非凭 memory 想当然或看漏文档。

系统的正确性由以下原则保证：
1. **可审计性**：每次 AI 决策都能反推到「读了什么事实、每条费目算了几分、选了哪个、成败如何」，这是归因与信任的地基。
2. **可复现性**：同一世界快照 + stateHash 重放决策结果一致，杜绝状态漂移导致的反复。
3. **防转圈**：迭代预算、环检测、回归闸、检查点、单点归因、禁碰清单共同保证 agent 不会把系统调崩或原地打转。
4. **人机分工**：agent 做观测/归因/调参/验证的脏活；人类做经验决策（边界裁决、玩法级需求）。
5. **面向非程序员的输出**：调参报告深入浅出，资深玩家即可评审，不必读懂原始费目表。

实现语言：TypeScript（沿用现有 `src/core/kernel/ai` 生态）。

## 架构

系统为「地基可审计 → 标尺断言 → 自主调参 → 闸门自述 → skill 入口」五层接入现有 AI 决策栈：

```
┌────────────────────────────────────────────────────────────────────┐
│  ai-tuning skill (入口) — 强制加载上下文 + 防看漏 + 一键/交互 + 浅出报告  │
└────────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────────────────────────────────────────────────┐
│  Agent 工具集 (agent-facing, 受限)                                  │
│  listAssertions / runAssertion / getFeeItemDoc / tuneFeeItem /     │
│  runTuningCycle / saveCheckpoint / loadCheckpoint / requestHuman… │
└────────────────────────────────────────────────────────────────────┘
                         │
┌───────────────── 调参闭环 (orchestrator) ──────────────────────────┐
│  runAssertion → attribute → detectCycle → singleTune → regressionGate │
└──────────┬───────────────┬─────────────────┬──────────────────────┘
           │               │                 │
┌──────────▼─────┐ ┌──────▼──────┐  ┌───────▼────────┐
│ AttributionEngine│ │ ParameterTuner│  │ TuningOrchestrator│
│ 归因（含置信度）   │ │ 受限改表+禁碰   │  │ 防转圈核心         │
└──────────┬─────┘ └──────┬──────┘  └───────┬────────┘
           └──────────────┼──────────────┘
                          │
┌───────── 观测与断言基座 ─┐
│ BehaviorAssertionRegistry │
│ AssertionRunner           │
│ Golden Scenarios          │
└──────────────┬───────────┘
               │
┌───────── 决策可审计层（地基）─────────┐
│ DecisionTrace / ScoreBreakdown / StateSnapshot │
└──────────────┬─────────────────────┘
               │
┌───────── 现有决策系统 ─────────┐
│ BoundedAIDecisionFacade + DesignCurrency │
└─────────────────────────────┘
```

**关键架构原则：**
1. **五层严格分层**：地基 → 标尺 → 调参 → 闸门 → skill 入口，下层被上层依赖，不越级。
2. **可观测性前置**：第 0 层（审计）必须先于任何调参能力，归因必须先有证据链。
3. **配置与代码分离**：费目表、断言、禁碰清单、检查点都是可序列化 JSON，agent 可读、可在受限范围内写，但核心语义（锚值）锁死。
4. **回归守恒**：任何改动以「全量黄金场景仍绿」为门槛，否则回滚。
5. **人机分工边界**：agent 在现有费目内做分数级调整；玩法级（新费目/新动作/新规则）上交人类。

## 组件和接口

### 1. 决策可审计层（地基）

**目的**：让每次 AI 决策可反推、可复现。

#### ScoreBreakdown（改造 `scoreDesignCurrency`）
- **输入**：`{ slice: BeliefSlice }`
- **输出**：`ScoreBreakdown`（替代当前标量 `number`）
- **接口**：`scoreDesignCurrency(context): ScoreBreakdown`；`DesignCurrencyGateway.evaluate` 改为消费 `.total`

```typescript
interface ScoreBreakdown {
  total: number;
  items: Array<{
    feeItem: string;            // e.g. "e:enemy.vitality"
    contribution: number;       // 本条贡献
    currentValue: number;       // 观测到的当前值
    triggeredPivot?: string;    // "lethalWindow" | "exhaustionAnchor" | "defeated" | undefined
    scarcityMultiplier?: number; // 若由稀缺系数上调
  }>;
}
```

#### DecisionTrace（改造 `BoundedAIDecisionFacade`）
- **输入**：一次 `facade.act(request)`
- **输出**：在 `ActResult` 上附加 `trace: DecisionTrace`
- **接口**：`facade.act(request): ActResult & { trace: DecisionTrace }`

```typescript
interface DecisionTrace {
  correlationId: string;
  stateHash: string;
  timestamp: number;
  observedFacts: Array<{ key: string; value: number; source: 'direct' | 'projected' | 'inferred' }>;
  candidates: Array<{ actionId: string; score: number; breakdown: ScoreBreakdown }>;
  selected: { actionId: string; score: number; reason: string };
  submission: { ok: boolean; rejectionCode?: string; rejectionReason?: string };
}
```

#### StateSnapshot
- **输入**：`WorldState`
- **输出**：`WorldStateSnapshot`
- **接口**：`snapshotWorldState(state): WorldStateSnapshot`；`restoreFromSnapshot(snapshot): WorldState`；`hashWorldState(state): string`

```typescript
interface WorldStateSnapshot {
  stateHash: string;
  serialized: string;   // JSON.stringify(WorldState)
}
```

### 2. 观测与断言基座

**目的**：给 agent 明确的对错标尺（含 golden 回归基准）。

#### BehaviorAssertionRegistry
- **输入**：JSON 断言文件（目录 `src/core/kernel/ai/tuning/assertions/`）
- **接口**：`load/save/add/get/getByCategory/getGolden`
- 断言存 JSON，与代码分离，agent 可读写。

```json
{
  "id": "M9-defeat-finish-001",
  "category": "M9",
  "description": "已倒地未长眠的敌方应被终结",
  "setup": { "stateHash": "...", "serialized": "..." },
  "expect": {
    "shouldSelect": "a:eternal-sleep",
    "scoreConstraints": [
      { "feeItem": "e:enemy.defeated", "operator": "<", "value": 0, "reason": "defeated 应为负分（死亡锚）" }
    ],
    "pivotConstraints": [
      { "pivot": "lethalWindow", "shouldTrigger": true, "reason": "残血敌方应触发致死窗口" }
    ]
  },
  "isGolden": true
}
```

#### AssertionRunner
- **输入**：`assertionId`（或直接 `BehaviorAssertion`）
- **输出**：`AssertionResult`
- **接口**：`run(assertionId): AssertionResult`

```typescript
interface AssertionResult {
  passed: boolean;
  violations: Array<{
    type: 'wrongSelection' | 'scoreConstraint' | 'pivotConstraint';
    expected: string;
    actual: string;
    trace: DecisionTrace;
  }>;
}
```

**执行流程**：从 setup 恢复世界 →（必要时推进到合法相位）→ 跑 `facade.act` → 取 trace → 检查 expect 各约束 → 汇总 violations。

### 3. 归因引擎

**目的**：定位「哪条费目导致了违规」。

#### AttributionEngine
- **输入**：`(violation: AssertionViolation, trace: DecisionTrace)`
- **输出**：`Array<{ feeItem: string; confidence: number; reasoning: string }>`（按置信度降序）
- **接口**：`attribute(violation, trace): Cause[]`

**归因规则**：
- `wrongSelection` 型：对比「期望动作」与「实际动作」的 ScoreBreakdown，输出贡献差异最大的费目；`confidence = 差异幅度 / |分差|`。
- `scoreConstraint` 型：直接定位到该约束索引的费目，`confidence = 0.9`。
- 只返回在 trace 里真实出现的费目；未观测的费目不归因。
- 若某费目近 4 轮都被调过，降低其置信度（提示可能已陷入局部）。

### 4. 受限调参器

**目的**：让 agent 能改费目值，但不破坏玩家可见/核心语义。

#### ParameterTuner
- **输入**：`feeItem`, `field`('unit'|'scarcity'|'pivot'), direction, magnitude
- **输出**：`TuningResult | { ok:false, reason }`
- **接口**：`tune(...): TuningResult`；`revert(recordId)`；`saveCheckpoint(label)`；`loadCheckpoint(label)`
- **可调参数**：从费目表（可序列化 `design-currency-config.json`）读，每个带 `allowedRange` + `step` + `tunable`。

```typescript
interface TunableParameter {
  feeItem: string;
  field: 'unit' | 'pivot.threshold' | 'scarcity.coefficient';
  currentValue: number;
  allowedRange: [number, number];
  step: number;
}
```

- **禁碰清单**：`vitality.max`、`stamina.max`、`ap.max`（玩家可见 1-5 值）、`deathAnchor`、`exhaustionAnchor`、`lethalWindow`（核心语义锚）以及一切 `playerVisible: true` 的参数。禁碰判定放 `isForbidden()`，不允许绕过。
- **改动记录**：每次 `tune` 生成 `ParameterTuningRecord`，含 attribution/verification/decision 三槽（由编排器回填）。

### 5. 调参编排器（防转圈核心）

**目的**：独立把一个表现不对的 AI 行为调对，且不弄坏别处。

#### TuningOrchestrator
- **输入**：`targetAssertionId`
- **输出（每轮）**：`TuningCycleResult { ok, iterations, reason, history }`
- **接口**：`runTuningCycle(assertionId): TuningCycleResult`

**每轮流程（`runTuningCycle`）**：
1. `runner.run(assertionId)` — 已绿则返回成功。
2. `attributor.attribute(firstViolation, trace)` — 得根因候选。
3. `detectCycle(feeItem)` — 近 4 轮该费目出现 ≥2 次 → 停止（返回 cycle）。
4. `inferDirection(violation, cause)` — 推断升/降。
5. `tuner.tune(feeItem, 'unit', direction, 0.5)` — 单点改。
6. `runRegressionGate()` — 全量 golden；任一被弄黄 → `tuner.revert`、记 rejected、可试下一候选 cause。
7. 全部 golden 仍绿 → 记 accepted，`iteration++`。

**硬约束**：
- `maxIterations = 12`（可配置）；超限返回 `{ ok:false, reason:'max-iterations' }`。
- 单点归因：每轮只调一个 feeItem。
- 环检测：见步骤 3。
- 回归闸：见步骤 6。
- 置信度阈值：`confidence < 0.3` → 停止 `{ ok:false, reason:'low-confidence' }`。

### 6. 演化闸门与表自述

**目的**：结果可验证、可追溯、可人类评审。

- **回归闸（RegressionGate）**：独立函数，跑全量 golden，返回 `{ anyFailed, failures }`。由编排器在每轮改动后调用。
- **检查点**：`saveCheckpoint(label)/loadCheckpoint(label)` 读写 `checkpoints/<label>.json`。
- **调参历史持久化**：追加写 `tuning-history/records.jsonl`。
- **表自述生成器（`generateFeeItemDocumentation`）**：对某费目输出人类可读 Markdown——当前当量、触发场景（统计哪些断言以它为可选候选/约束）、分水岭、最近调整史、调高/低 0.5 的影响模拟（临时调参+回滚跑典型场景测分数变化）。
- **调参报告（`generateTuningReport`）**：面向资深玩家，五段式「问题 → 原因 → 建议 → 影响范围 → 需确认」。内部把费目术语翻译成贴近玩家的语言（如把 `e:enemy.vitality` 写作「敌人的生命值」，把「unit 提高」写作「更重要一点」）。

### 7. ai-tuning skill（入口）

**目的**：让任何 agent 一句话进入专业调参状态，防看漏/防想当然。

**SKILL.md 描述**：`/ai-tuning` 触发；目标读者可能是资深玩家，输出须深入浅出。

**Skill 强制加载清单（缺任一即提示，禁止继续）**：
1. 当前费目配置：`src/core/kernel/ai/tuning/config/design-currency-config.json`
2. 完整断言集：`src/core/kernel/ai/tuning/assertions/*.json`
3. 禁碰清单：`src/core/kernel/ai/tuning/config/tuning-constraints.json`
4. 最近调参历史：`src/core/kernel/ai/tuning/history/records.jsonl`（最近 N 条）
5. 防转圈规则与边界决策指南：`docs/ai/ai-tuning-rules.md`

**载入后必须完成的「专业状态自检」**（skill 内嵌 checklist）：
- 我能列出当前所有 golden scenarios 吗？
- 我知道哪些参数禁碰吗？
- 我知道防转圈 8 条吗？
- 我知道何时该上交人类吗？
- 我能读懂 DecisionTrace 和 ScoreBreakdown 吗？

**两种模式**：
- **一键模式**（用户仅说「我要进行一次 AI 调优」）：扫描断言找出红色 → 对每个跑 `runTuningCycle` → 汇总报告交用户审批。自动跳过已绿断言，不打扰。
- **交互模式**（用户描述具体场景「为什么 AI 对残血敌人用治疗」）：把描述翻译成临时断言（TEMPORARY* 前缀）→ 跑一轮归因 → 给出浅出建议 → 用户确认后执行 → 验证 → 若用户要求且成功则固化进断言集。

**输出语言**：遵循「问题 → 原因 → 建议 → 影响范围 → 需确认」。禁止未翻译的费目术语堆砌给非程序用户。

## 数据模型

### DesignCurrencyConfig（可序列化费目表，替代硬编码）
```typescript
interface DesignCurrencyConfig {
  version: number;
  principles: {
    deathAnchor: number;      // 锁死
    lethalWindow: number;     // 锁死（核心语义）
    exhaustionAnchor: number; // 锁死
  };
  charges: Array<{
    field: string;
    unit: number;             // tunable, has range
    tunableRange: [number, number];
    step: number;
    adjustment?: { when: string; value: number };   // when 以字符串谓词表达
    scarcity?: { floor: number; ceiling: number; coefficient: number };
    defeated?: { when: string };
    playerVisible: boolean;   // true → 禁碰
    description: string;      // 人类可读费目说明
  }>;
}
```

### ParameterTuningRecord
```typescript
interface ParameterTuningRecord {
  id: string;
  timestamp: number;
  iteration: number;
  attribution: {
    violatedAssertion: string;
    rootCauseFeeItem: string;
    confidence: number;
    evidenceTrace: DecisionTrace;  // 引用/内联
  };
  change: {
    feeItem: string;
    field: string;
    before: number;
    after: number;
    direction: 'increase' | 'decrease';
    magnitude: number;
    reasoning: string;
  };
  verification: {
    targetAssertionPassed: boolean;
    regressionCount: number;
    regressionDetails: string[];
  };
  decision: 'accepted' | 'rejected' | 'reverted';
}
```

### 行为断言 JSON Schema（存于 `tuning/schemas/assertion.schema.json`）
- `id`, `category`, `description`
- `setup: { stateHash, serialized }`
- `expect: { shouldSelect?, shouldNotSelect[], scoreConstraints[], pivotConstraints[] }`
- `isGolden: boolean`
- （可选）`source: 'initial' | 'curated' | 'tuning-derived'`，`temperedByHuman?: boolean`

## 正确性属性

*属性是应在系统所有有效执行中都保持为真的特征或行为。它们充当人类可读规范与机器可验证正确性保证之间的桥梁。*

### 基于属性的测试概述

PBT 通过测试许多生成输入的通用属性来验证正确性。每个属性都是应适用于所有有效输入的正式规范。本系统的 `feature_name = wakeup-ai-tuning`。

### 属性 1：分数构成总和守恒（不变量）
*对于任何（信念切片，费目配置），`scoreDesignCurrency` 返回的 `ScoreBreakdown.total` 都应等于 `items[].contribution` 之和，且触发状态（pivot/scarcity）应在 `items` 上有完整记录。*
**验证：要求 1.3, 1.4**

### 属性 2：未观测不计分（不变量）
*对于任何信念切片，`observedNumber` 未观测到值的费目，其贡献应为 0（不进入 `items`，不给负贡献）。*
**验证：要求 1.2**

### 属性 3：状态快照往返（round-trip）
*对于任何 `WorldState`，`restoreFromSnapshot(snapshotWorldState(state))` 得到的状态在结构上等于原状态，且再次 `snapshotWorldState` 产生相同 `stateHash`。*
**验证：要求 2.1, 2.2, 2.4**

### 属性 4：快照重放决策确定性（模型-对比/幂等）
*对于任何快照，从其恢复后连续跑 `facade.act` 两次，两次的 `DecisionTrace.selected.actionId` 与提交结果应一致（决策确定性）。*
**验证：要求 2.3**

### 属性 5：断言序列化往返（round-trip）
*对于任何 `BehaviorAssertion`，序列化为 JSON 再解析，应得到语义等价的断言；再序列化应产生与首次序列化相同的紧凑形态（不含 `stateHash` 漂移）。*
**验证：要求 3.1, 3.3**

### 属性 6：归因只引用已观测费用项（不变量）
*对于任何归因结果（violation, trace），`AttributionEngine.attribute` 输出的每个 `feeItem` 都应在 `trace.candidates[].breakdown.items[].feeItem` 中存在。*
**验证：要求 4.3**

### 属性 7：调参边界收敛（不变量）
*对于任何 `ParameterTuner.tune` 调用，若结果 `ok`，则其 `after` 值必须落在该参数的 `allowedRange` 内，且任何禁碰参数（`isForbidden`）不得被修改。*
**验证：要求 5.3, 5.4**

### 属性 8：调参历史可回滚（不变量/幂等）
*对于任何已 `accepted` 或 `rejected` 的记录，`revert(recordId)` 后该参数值应回到 `change.before`，且该记录 `decision` 标记为 `reverted`。*
**验证：要求 5.5, 5.6**

### 属性 9：编排器在有限步内终止（不变量/error-condition）
*对于任何 `TuningOrchestrator.runTuningCycle` 调用，其要么在 ≤ `maxIterations` 轮内返回 `ok`，要么在检测到环 / 置信度过低 / 达到上限时返回带 `reason` 的 `{ ok:false }`——绝不可无限循环。*
**验证：要求 6.3, 6.4, 6.6**

### 属性 10：回归闸守恒（不变量）
*对于任何成功接受的调参（`decision === 'accepted'`），该改动时的全量 golden scenarios 都必须为绿（`regressionCount === 0`）。*
**验证：要求 6.5, 7.2, 10.5**

### 属性 11：配置序列化往返（round-trip）
*对于任何 `DesignCurrencyConfig`，序列化→解析→再序列化应保持语义等价且 `version` 不变。*
**验证：要求 7.4**

### 属性 12：Skill 加载完整性（error-condition）
*对于任何 `ai-tuning` skill 启动，若强制加载清单中任一文件缺失或为空，skill 应拒绝进入对话并提示缺失项，绝不静默跳过。*
**验证：要求 9.2, 9.3**

### 属性 13：断言固化仅发生于成功后（状态驱动）
*对于任何一次调参闭环，仅当目标断言已通过（`passed:true`）且全量 golden 仍绿时，agent 才可将该断言标记为可固化进断言集。*
**验证：要求 8.1, 8.2, 8.3**

### 属性 14：边界决策必然上交（error-condition）
*对于任何进入「无解 / 回归震荡 / 风险置信度低 / 唯一根因禁碰 / 需新机制」状态的情况，agent 应停止并请求人类裁决，不得自行硬调。*
**验证：要求 11.1-11.5**

## 错误处理

### 1. 决策审计错误
- **费目未定义**：`scoreDesignCurrency` 遇到配置里不存在的费目 → 记录诊断，跳过该项，不崩溃。
- **`observedNumber` 观测量非有限数**：视为未观测，不计分。
- **trace 缺字段**：`createDecisionTrace` 缺 candidate 时创建最小 trace（`selected` 为「无合法动作」）。

### 2. 断言/配置加载错误
- **JSON 解析失败**：`BehaviorAssertionRegistry.load` 抛带文件路径的错误，skill 据此报「断言文件损坏」。
- **缺失文件**：skill 强制清单校验失败 → 打印缺失项 + 中止调参（要求 9.2/9.3）。
- **违反 schema**：校验 `assertion.schema.json`，不符则拒绝该断言 + 说明字段。

### 3. 调参错误
- **禁碰**：`isForbidden` → 返回 `{ ok:false, reason:'forbidden' }`，agent 不得绕过。
- **越界**：`after` 超出 `allowedRange` → 返回 `{ ok:false, reason:'out-of-range' }`。
- **归因失败**：无候选 → 编排器返回 `{ ok:false, reason:'cannot-attribute' }`。
- **回归失败**：golden 被弄黄 → `revert` + 记 rejected，编排器尝试下一候选或停止。

### 4. 编排错误
- **环检测**：返回 `{ ok:false, reason:'cycle-detected' }`。
- **低置信**：`confidence<0.3` → 返回 `{ ok:false, reason:'low-confidence' }`。
- **超限**：`iteration>=maxIterations` → 返回 `{ ok:false, reason:'max-iterations' }`。
- **交互冲突**：同一费目在编排期间被外部改动 → 校验当前值，不符则重置该轮。

## 测试策略

### 双重测试方法

**单元测试**（具体示例）：覆盖每层组件的具体行为（如归因给定一个 violation+trace 得到指定根因、调参禁碰拒绝、编排器 4 轮内调对某断言）。

**基于属性的测试**（通用属性）：用 fast-check 验证上述 14 条正确性属性（属性 1、2、5、7、8、10、11 特别适合 PBT）。

### 属性测试实现（摘要）
- `feature_name = wakeup-ai-tuning`
- 库：`fast-check`
- 最小 `numRuns = 100`
- 标签：`Feature: wakeup-ai-tuning, Property N: <title>`
- 生成器：
  - 属性 1/2：随机 BeliefSlice（随机字段名 + 有限数值），随机配置子集。
  - 属性 3/4：随机 WorldState（枚举生成）。
  - 属性 5/11：随机断言 / 配置对象。
  - 属性 7：随机 `tune` 调用（随机参数 + 方向 + 幅度），断言范围与禁碰。
  - 属性 9：随机断言 + 可控 budget，用探针断言编排器必然终止。

### 集成测试
- **决策可审计**：对 `combat-first` 的 M9 场景跑 `facade.act`，断言 trace 含 `e:enemy.defeated` 的负分项。
- **自动化闭环**：构造「M9 该选 eternal-sleep 却选 heal」的红断言，编排器 ≤12 轮内调对且 golden 全绿。
- **skill 校验**：临时删掉一个断言文件，断言 skill 启动时拒绝并列出缺失项。

### 故障注入验证
- **属性 9 反例**：构造无解断言（需加新费目），断言编排器 12 轮后停止并交回 history。
- **环检测反例**：构造 A↔B 反复改场景，断言编排器检测到环后停止。
- **回归反例**：构造「调 A 必然弄黄 golden B」，断言编排器回滚本次改动并尝试其他候选或停止。
