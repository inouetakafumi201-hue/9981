---
name: ai-tuning
description: WakeUp「AI 自主学习迭代系统」入口——让任何 agent 一句话进入专业 AI 调参状态，防看漏/防想当然。当用户要：AI 表现不对想自主调优设计货币费目表、排查"为什么 AI 不选更优动作"、跑一键调优闭环、把某个场景固化成规则、读懂 AI 决策证据链(DecisionTrace/ScoreBreakdown)、生成人类可读调参报告。这是开发期 AI 内部调参工具，product 侧 AI 行为由本系统调优。
---

# AI 调参（ai-tuning skill）

一句话：**把「反复 dump 日志 → 人眼看 → 手工改表 → 再测」的脏活，变成 agent 能独立闭环的流水线；防转圈红线保证不会把系统调崩或原地打转。** 目标读者可能是资深玩家，输出深入浅出。

## 何时触发
用户说「AI 表现不对 / AI 该选 X 却选 Y / 我要进行一次 AI 调优 / 调一下 AI 的费目表」等，或直接引用 `/ai-tuning`。

## 强制加载清单（缺任一即拒绝进入，提示缺失项，绝不自作主张继续）

Skill 载入时**必须**先校验以下文件存在且非空；缺任一即打印缺失项并停下，不得跳过：

1. 当前费目配置：`src/core/kernel/ai/tuning/config/design-currency-config.json`
2. 完整断言集：`src/core/kernel/ai/tuning/assertions/*.json`
3. 禁碰清单：`src/core/kernel/ai/tuning/config/tuning-constraints.json`
4. 最近调参历史：`src/core/kernel/ai/tuning/history/records.jsonl`（最近 N 条）
5. 防转圈规则与边界决策指南：`docs/ai/ai-tuning-rules.md`

## 载入后必须完成「专业状态自检」（skill 内嵌 checklist）

- 我能列出当前所有 golden scenarios 吗？
- 我知道哪些参数禁碰吗？
- 我知道防转圈 8 条吗？
- 我知道何时该上交人类吗？
- 我能读懂 DecisionTrace 和 ScoreBreakdown 吗？

## 数据读法（terminology 翻译）

| 术语 | 玩家语言 |
| --- | --- |
| `scoreDesignCurrency` | AI 对某个状态值多少分 |
| `ScoreBreakdown` | 这份总分的构成明细 |
| `DecisionTrace` | 一次决策的完整证据链（读了什么、选了什么、成败） |
| `BehaviorAssertion` | 一条「AI 在什么情况下该怎么做」的规则 |
| `Golden Scenario` | 一组已知应正确的规则，作为回归基准 |
| `e:enemy.vitality` | 敌人的生命值 |
| `pool.ap` / `pool.stamina` | 行动点 / 体力 |
| `ParameterTuningRecord` | 一次调参的完整记录 |

## 代码位置（只读参考 + 本 skill 写权）
全部在 `src/core/kernel/ai/tuning/`（本 skill/专项写权），不跨 Spec 改 play-layer 或其它交付物。
- 配置：`src/core/kernel/ai/tuning/config-design-currency.ts` + `design-currency-config.json`
- 断言/回归：`assertions.ts`、`golden-scenarios.ts`
- 归因/受限调参/编排：`attribution.ts`、`tuner.ts`、`orchestrator.ts`
- 文档/报告：`documentation.ts`、`report.ts`
- 审计地基：`runtime.ts`、`snapshot.ts`、`trace.ts`、`build-trace.ts`

门禁三命令：`npx tsc --noEmit` / `npx vitest run src/core/kernel/ai/tuning` / `npm run lint`。

## 两种模式

### 一键模式（用户仅说「我要进行一次 AI 调优」）
1. 扫描断言集找出红色断言。
2. 对每个红断言跑 `runTuningCycle`。
3. 汇总 `generateTuningReport` 交用户审批。
4. 自动跳过已绿断言，不打扰。

### 交互模式（用户描述具体场景「为什么 AI 对残血敌人用治疗」）
1. 把描述翻译成临时断言（`TEMPORARY*` 前缀）。
2. 跑一轮归因，给出浅出建议。
3. 用户确认后执行。
4. 验证；若用户要求且成功则固化进断言集。

## 输出纪律
- 用「问题 → 原因 → 建议 → 影响范围 → 需确认」叙述结构。
- 禁止未翻译的费目术语堆砌给非程序用户。
- 边界情况（无解 / 回归震荡 / 置信度低 / 触碰禁区）→ 停止并请求人类裁决，不硬调。
- 每次闭环成功且 golden 全绿，才可把验证断言固化进断言集（`source: tuning-derived`）。

## 参考
- 需求/设计/任务：`.kiro/specs/wakeup-ai-tuning/{requirements,design,tasks}.md`
- 防转圈规则与边界决策：`docs/ai/ai-tuning-rules.md`
- 表自述：`docs/ai/i-tunning.md`
