# 任务文档

实现语言：TypeScript（沿用 `src/core/kernel/ai` 生态；PBT 库 `fast-check` 已在项目 devDependencies）。

所有可选的 PBT 子任务以 `*` 后缀标注。任务集中在两个新目录（写权归本专项）：
- `src/core/kernel/ai/tuning/` —— 组件代码 + 配置 + 断言 + 历史 + 检查点
- `docs/ai/i-tunning.md` / `docs/ai/ai-tuning-rules.md` —— skill 载入文档

沿用既有生态的既有文件（只读参考，不可写）：`src/core/kernel/ai/design-currency.ts`、
`src/core/kernel/ai/facade.ts`、`src/core/kernel/ai/evaluation.ts`、`src/core/kernel/ai/types.ts`、
`src/core/kernel/ai/sequential-search.ts`、`src/core/kernel/testing/full-harness.ts`、
`src/core/kernel/ai/__tests__/combat-first.test.ts`、`src/core/kernel/ai/__tests__/m10-state-machine-consumption.test.ts`。

## 第 0 阶段：决策可审计地基

### 任务 1：费目表可序列化配置
- **描述**：新建 `src/core/kernel/ai/tuning/config/design-currency-config.json`，把既有 `DESIGN_CURRENCY_CHARGES` 与 `DESIGN_CURRENCY_PRINCIPLES` 的全部内容迁为可序列化数据（每行含 `field/unit/tunableRange/step/adjustment/scarcity/defeated/playerVisible/description`，`principles` 锁死）。新增 `DesignCurrencyConfig` 的 loader（`src/core/kernel/ai/tuning/config/load.ts`，`loadDesignCurrencyConfig()` 读 JSON + 校验 schema + 返回带类型守卫的类型）。
- **说明**：设计模块 §数据模型·DesignCurrencyConfig。代码仍可用硬编码表作 fallback，但调参器必须读 JSON。
- **引用**：R7.4；设计属性 11。
- **依赖**：无。

### 任务 2：把配置接入 `scoreDesignCurrency`
- **描述**：改造 `src/core/kernel/ai/design-currency.ts`，让 `scoreDesignCurrency` 的输入从「内部常量」改为「可注入 `DesignCurrencyConfig`」；`observedNumber` 的「not observed → 不计分」语义保持。硬编码常量表改为从 loading 装配点读取（或保留常量作为默认值，但调参路径必用 JSON 配置）。
- **说明**：设计模块 §1·ScoreBreakdown 前置；不改变任何默认分值（回归红线）。
- **引用**：R1.1, R1.2, R7.4；设计属性 1, 2, 11。
- **依赖**：任务 1。

### 任务 3：`ScoreBreakdown`（分数构成）
- **描述**：改写 `scoreDesignCurrency(context): number` → `scoreDesignCurrency(context): ScoreBreakdown`（含 `total` 与 `items[]`：每条记录 `feeItem/contribution/currentValue/triggeredPivot/scarcityMultiplier`）。改造 `DesignCurrencyGateway.evaluate` 消费 `.total`。保持既有调用方（评估/剪枝）数值语义不变。
- **说明**：设计模块 §1·ScoreBreakdown。
- **引用**：R1.3, R1.4；设计属性 1, 2, 。
- **依赖**：任务 2。

### 任务 4：`DecisionTrace`（决策审计）
- **描述**：新建 `src/core/kernel/ai/tuning/trace.ts`，定义 `DecisionTrace` 接口；在 `facade.act` 成功/拒绝路径上附加 `trace`（`correlationId/stateHash/timestamp`），从已算的 `ScoreBreakdown`、planner 输出、提交结果组装 `observedFacts / candidates / selected / submission`。缺 candidate 时产出最小 trace（`selected` = 无合法动作）。
- **说明**：设计模块 §1·DecisionTrace；需 Read `facade.ts` 后在既有返回对象上扩展，不破坏既有消费方。
- **引用**：R1.1, R1.2, R1.5, R2.3；设计属性 4。
- **依赖**：任务 3。

### 任务 5：`StateSnapshot`（可复现世界）
- **描述**：新建 `src/core/kernel/ai/tuning/snapshot.ts`，实现 `snapshotWorldState(state)/restoreFromSnapshot(snapshot)/hashWorldState(state)`（稳定字段序 + 规范化哈希，避免键序漂移导致 hash 不稳）。world 序列化包含 `entities/items/nodes/links/world` 全量。
- **说明**：设计模块 §1·StateSnapshot。
- **引用**：R2.1, R2.2, R2.4；设计属性 3。
- **依赖**：无。

### 任务 6：断言基座（Registry + Runner）
- **描述**：新建 `src/core/kernel/ai/tuning/assertions/`（JSON 断言目录）、`assertion.schema.json`、`behavior-assertions.ts`（`BehaviorAssertionRegistry.load/save/add/get/getByCategory/getGolden`）与 `assertion-runner.ts`（`AssertionRunner.run(assertionId): AssertionResult`：从 setup 恢复世界 → 合法相位推进 → `facade.act` → 取 trace → 检查 `shouldSelect/shouldNotSelect/scoreConstraints/pivotConstraints` → 汇总 violations）。
- **说明**：设计模块 §2。
- **引用**：R3.1, R3.2, R3.3, R3.4；设计属性 5。
- **依赖**：任务 3, 4, 5。

### 任务 7：黄金场景基线（首个断言集）
- **描述**：基于既有已绿行为（`combat-first.test.ts` 的 M9 终结语义、「残血保命 vs 满血进攻」阶段 2）构造 ≥20 条断言、其中 ≥10 条 `isGolden`。断言自带 `setup.serialized`（真实世界快照）+ `expect`（含 `shouldSelect` 与若干 `scoreConstraints`，如 `e:enemy.defeated < 0`）。断言文件放 `src/core/kernel/ai/tuning/assertions/`。
- **说明**：设计模块 §2 + §7（skill 自检依赖完整 golden 集）。
- **引用**：R3.2, R9.1；设计属性 10, 12。
- **依赖**：任务 6。

### 任务 8（检查点）：审计地基 + golden 全绿
- **描述**：门禁三命令（`npx tsc --noEmit` / `npx vitest run src/core/kernel/ai/tuning` / 相关 lint）。目标：trace、snapshot、断言 runner、golden 断言集真实可用且默认配置全绿；`scoreDesignCurrency` 分值语义与改前一致。
- **引用**：R1–R3 阶段性。
- **依赖**：任务 1–7。

## 第 1 阶段：归因与受限调参

### 任务 9：归因引擎
- **描述**：新建 `src/core/kernel/ai/tuning/attribution.ts`，实现 `AttributionEngine.attribute(violation, trace): Cause[]`。规则：wrongSelection 对比期望/实际动作的 ScoreBreakdown 输出贡献差异最大的费目（conf = 差异/分差）；scoreConstraint 直定位（conf 0.9）；只返回 trace 里真实出现的费目；近 4 轮被调 < 阈值可降置信度。
- **说明**：设计模块 §3。
- **引用**：R4.1, R4.2, R4.3；设计属性 6。
- **依赖**：任务 3, 4, 6。

### 任务 10：`ParameterTuner`（受限调参）+ 禁碰清单
- **描述**：新建 `src/core/kernel/ai/tuning/tuner.ts` 与 `tuning/tuning-constraints.json`（禁碰清单：`vitality.max/stamina.max/ap.max`、`deathAnchor/exhaustionAnchor/lethalWindow`、一切 `playerVisible:true`）。实现 `tune(feeItem, field, direction, magnitude)` 检查 `isForbidden()` 与 `allowedRange`，生成 `ParameterTuningRecord`（三槽由编排器回填）；`revert(recordId)` 回填 `decision:'reverted'`。
- **说明**：设计模块 §4。
- **引用**：R5.3, R5.4, R5.5, R5.6；设计属性 7, 8。
- **依赖**：任务 1, 2, 9。

### 任务 11：`TuningOrchestrator` + `RegressionGate` + 检查点
- **描述**：新建 `src/core/kernel/ai/tuning/orchestrator.ts`：
  - `RegressionGate.runAll()` 跑全量 golden 返回 `{ anyFailed, failures }`；
  - `TuningOrchestrator.runTuningCycle(assertionId)` 实现 7 步循环（run→attribute→detectCycle→inferDirection→tune→regressionGate→record），硬约束 `maxIterations=12`、单点归因、环检测（近 4 轮同费目 ≥2）、置信阈值 0.3、回归失败即 `revert`；
  - `saveCheckpoint(label)/loadCheckpoint(label)`；
  - 历史追加写 `tuning/history/records.jsonl`。
- **说明**：设计模块 §5 + §6。
- **引用**：R6.1–R6.6, R7.1, R7.3；设计属性 9, 10。
- **依赖**：任务 7, 9, 10。

### 任务 12：表自述生成器（面向非程序员文档）
- **描述**：新建 `docs/ai/i-tunning.md` 与 `src/core/kernel/ai/tuning/documentation.ts`：`generateFeeItemDocumentation(feeItem)` 输出人类可读 Markdown（对应费目当量/触发场景/调整史/±0.5 影响模拟）；内部把 `field` 术语翻译成玩家语言（`e:enemy.vitality` →「敌人的生命值」）。注：文档文件名固定 `i-tunning.md`（设计文档既有引用）。
- **说明**：设计模块 §6·表自述生成器；§7·浅出输出。
- **引用**：R7.5, R7.6, R9.4。
- **依赖**：任务 11。

### 任务 13（检查点）：归因 + 调参闭环单测全绿
- **描述**：门禁三命令。目标：归因/调参/编排器单元测试全绿——典型场景「构造 M9 该选 eternal-sleep 却选 heal 红断言」在 ≤12 轮内调对、禁碰/越界拒绝、环检测/低置信/超限停止、回归失败回滚。
- **引用**：R4–R6 阶段性。
- **依赖**：任务 9–12。

## 第 2 阶段：演化闸门与 skill 入口

### 任务 14：调参报告生成器 + 断言固化
- **描述**：新建 `src/core/kernel/ai/tuning/report.ts` 实现 `generateTuningReport(history)`（五段式「问题→原因→建议→影响范围→需确认」）+ 可固化逻辑（仅当目标断言 passed && golden 全绿，才把该断言 `source` 标为 `tuning-derived` 并入断言集，校验不破坏 JSON schema）。
- **说明**：设计模块 §6·调参报告 + §7·固化。
- **引用**：R7.2, R8.1, R8.2, R8.3；设计属性 13。
- **依赖**：任务 11, 12。

### 任务 15：`ai-tuning` skill（入口 + 防看漏 + 一键/交互 + 自检）
- **描述**：新建（或复用既有 skill 目录）`ai-tuning` skill。SKILL.md 声明 `/ai-tuning` 触发 + 深入浅出目标；manifest 声明 `src/core/kernel/ai/tuning/config/design-currency-config.json`、`tuning/assertions/`、`tuning/tuning-constraints.json`、`tuning/history/records.jsonl`、`docs/ai/ai-tuning-rules.md` 为强制加载项（缺任一即拒绝进入，提示缺失项）；内嵌「专业状态自检 checklist」（能列 golden？知禁碰？知防转圈 8 条？知何时交人？读懂 trace？）；提供一键（扫描全绿 + 自动化闭环 + 汇总交审）与交互（描述→临时断言→归因→建议→确认→执行→验证→固化）两模式。
- **说明**：设计模块 §7。
- **引用**：R9.1–R9.5, R10.1–R10.5, R11.1–R11.5；设计属性 12, 14。
- **依赖**：任务 6, 11, 13, 14。

### 任务 16（检查点）：skill 自检 + 门禁
- **描述**：门禁三命令全绿。额外验证：手动「缺失断言文件」→ skill 拒绝；`npm run verify:docs` 通过（术语一致性本项目纪律）。
- **引用**：R9, R10, R11 阶段性。
- **依赖**：任务 15。

## 第 3 阶段：PBT 正确性属性（可选子任务，全部标 `*`）

### 任务 17*：PBT——属性 1/2（分数守恒 + 未观测不计分）
- **描述**：用 fast-check 实现属性 1（`ScoreBreakdown.total === Σ items[].contribution`，pivot/scarcity 在 items 记录完整）与属性 2（`observedNumber` 未观测值费目不进入 items、贡献为 0）。生成器：随机 BeliefSlice + 随机配置子集。`numRuns ≥ 100`，标签 `Feature: wakeup-ai-tuning, Property 1/2`。
- **引用**：R1.3, R1.4, R1.2；设计属性 1, 2。
- **依赖**：任务 3。

### 任务 18*：PBT——属性 3/4（快照往返 + 重放确定性）
- **描述**：实现属性 3（`restore(snapshot(s))` 结构等于 `s` 且同 hash）与属性 4（恢复后连续两次 `facade.act` 的 `selected.actionId` 与提交结果一致）。生成器：枚举随机 WorldState。`numRuns ≥ 100`。
- **引用**：R2.1, R2.2, R2.4, R2.3；设计属性 3, 4。
- **依赖**：任务 5。

### 任务 19*：PBT——属性 5/11（断言 + 配置序列化往返）
- **描述**：实现属性 5（断言 JSON round-trip 语义等价、紧凑形态稳定）与属性 11（`DesignCurrencyConfig` round-trip 且 `version` 不变）。生成器：随机断言/配置对象。`numRuns ≥ 100`。
- **引用**：R3.1, R3.3, R7.4；设计属性 5, 11。
- **依赖**：任务 2, 6。

### 任务 20*：PBT——属性 7/8（调参边界 + 回滚幂等）
- **描述**：实现属性 7（ok 的 `after` 必在 `allowedRange`，禁碰不被改）与属性 8（已 accepted/rejected 记录 `revert` 后值回 `before`、`decision:'reverted'`）。生成器：随机参数 + 方向 + 幅度。`numRuns ≥ 100`。
- **引用**：R5.3, R5.4, R5.5, R5.6；设计属性 7, 8。
- **依赖**：任务 10。

### 任务 21*：PBT——属性 9/10（编排器终止 + 回归守恒）
- **描述**：实现属性 9（任意 `runTuningCycle` 在 ≤12 轮内 ok 或带 reason 停止，探针断言不无限循环）与属性 10（accepted 的改动 `regressionCount===0`）。生成器：随机断言 + 可控 budget + 故障注入候选。`numRuns ≥ 100`。
- **引用**：R6.3, R6.4, R6.5, R6.6, R7.2；设计属性 9, 10。
- **依赖**：任务 11。

### 任务 22*：PBT——属性 12/13/14（skill 加载 + 固化门槛 + 边界上交）
- **描述**：实现属性 12（skill 启动缺文件/空 → 拒绝并提示，不静默）、属性 13（仅 passed && golden 全绿才可固化）、属性 14（进入无解/震荡/低置信/禁碰/需新机制状态 → 停止上交，不硬调）。
- **引用**：R8, R9.2, R9.3, R11；设计属性 12, 13, 14。
- **依赖**：任务 11, 14, 15。

## 可执行性确认清单

- 所有任务均为可执行代码/文档任务，无用户验收测试、无部署、无业务流程。
- 每个任务引用至少一条需求，且依赖有序（第 0→1→2 阶段串行，PBT 任务依赖对应实现）。
- 检查点任务（8/13/16）在各阶段末做三命令门禁。
- 回归纪律：任务 2/3 改造既有函数时以「默认分值不变」为硬门禁，逻辑上由既有 `combat-first` / m10 测试保证。
