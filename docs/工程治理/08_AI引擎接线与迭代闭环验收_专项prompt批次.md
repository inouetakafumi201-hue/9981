# 专项批次 08 — AI 引擎接线与迭代闭环验收（两阶段串行）

> **性质**：可复制专项 prompt 批次（本文件含两份可直接粘贴给全新会话的完整 prompt）。
> **背景（2026-08-16）**：`wakeup-ai-tuning` 专项的 89 个测试全部自洽通过，但真实接线状态未完善——调参 JSON 对真实 AI 决策零影响、`facade.act` 不产 DecisionTrace、断言 runner 无生产宿主、golden 断言是占位快照。用户判定：**先把 AI 引擎的完善和接口问题解决，全部完成之后，AI 迭代做用例测试才有意义。**
> **并行状态（用户宣告）**：现在没有并行任务。因此本批次是**纯串行两段**，无批次间并行、无踩踏风险。
> **依赖**：本批次消费 `wakeup-ai-tuning` 的 `tuning/` 交付物（可调 JSON 配置 + `scoreDesignCurrencyBreakdown(config,slice)` + `DecisionTrace` 类型 + `BehaviorAssertion`/`AssertionRunner` 契约）与 `play/ai-runtime.ts` 的 `createPlayAiRuntime` 生产组合根。

---

## 阶段 1：AI 引擎接线（prompt 1）

**目标**：把「AI 调参系统的螺丝刀拧上真实 AI 决策这颗螺丝」——让真实 `facade.act` 出 trace、让 `scoreDesignCurrency` 从可注入 JSON 配置读、让断言 runner 有真实宿主、让 golden 断言可真跑。**不改变任何既有默认分值（回归红线）**。

**写权（独占）**：
- `src/core/kernel/ai/facade.ts`
- `src/core/kernel/ai/design-currency.ts`
- `src/core/kernel/ai/types.ts`（仅加 `trace?` 字段与相关类型）
- `src/play/ai-runtime.ts`（仅 eval 注入点 + 可选的 `live` 出口）
- `src/core/kernel/ai/tuning/`（本专项交付物，可继续改）

**冻结声明（不碰）**：`src/play/loading-runtime/`、`src/devboard/**`、`src/l2/**`、`src/core/ugc/**`、`src/class/**`、`src/ui/**`、`test/play/loading-runtime/`；不改其它 spec 交付物。

**门禁（必须全绿才收尾）**：`npx tsc --noEmit`（全域 0 err，注意 loading-runtime 并行线既存错误属他线）+ `npx vitest run src/core/kernel/ai src/play`（相关范围）+ `npm run lint` + `npm run verify:docs`。

---

### 可复制 prompt 1（引擎接线）

```text
你是 WakeUp 项目「AI 决策可观测接线」专项的立项认领者。工作目录 D:\coding\WakeUp。
本任务把 wakeup-ai-tuning 的调参系统**真实接进**生产 AI 决策链路：让真实 facade.act 产出
DecisionTrace、让 scoreDesignCurrency 从可注入 DesignCurrencyConfig 读、给断言 runner 一个
真实宿主、把 golden 断言从占位快照升级为可真跑回归基准。**不改变任何既有默认分值（回归红线）。**

【开工前必读（自上下文读，不可靠记忆）】
- 调参系统交付物：`.kiro/specs/wakeup-ai-tuning/{requirements,design,tasks}.md`、`src/core/kernel/ai/tuning/`
  （尤其 `config-design-currency.ts` 的 `defaultDesignCurrencyConfig`、`runtime.ts` 的
  `scoreDesignCurrencyBreakdown(config, slice)`、`trace.ts` 的 `DecisionTrace`、`build-trace.ts` 的
  `buildDecisionTrace`、`assertions.ts` 的 `AssertionRunContext`）。
- 生产 AI 决策链路：`src/play/ai-runtime.ts`（`createPlayAiRuntime`，eval 注入点在 359/366 行
  `new DesignCurrencyGateway()`）、`src/core/kernel/ai/facade.ts`（`BoundedAIDecisionFacade.planAndRevalidate`，
  每个候选分数已在 `AICandidate.score`，具备回填 trace 的原料）、`src/core/kernel/ai/design-currency.ts`
  （`scoreDesignCurrency` 现读硬编码 `DESIGN_CURRENCY_CHARGES`，`DesignCurrencyGateway.evaluate` 消费它）。
- 回归红线：`design-currency.ts` 默认分值/`DESIGN_CURRENCY_PRINCIPLES` 不得变；既有 design-currency*/combat-first
  测试必须保持绿。

【唯一产出与交付物】
1. **trace 出口**：在 `AIDecisionResult`（`src/core/kernel/ai/types.ts:319`）加只读可选 `trace?: DecisionTrace`；
   在 `facade.ts` 的 `planAndRevalidate` 成功后用已算出的候选分数 + `buildDecisionTrace` 回填
   `DecisionTrace`（含 correlationId、stateHash、observedFacts、candidates 的 ScoreBreakdown、selected、submission）。
   既有调用方（`AIDecisionResult.status/candidate/diagnostics`）行为完全不变。
2. **config 注入**：让 `DesignCurrencyGateway` 支持可选注入 `DesignCurrencyConfig`（默认
   `defaultDesignCurrencyConfig()`，语义与硬编码表完全一致）；`scoreDesignCurrency`/`scoreBreakdown`
   在无注入时仍走默认表。**关键**：`ParameterTuner` 改 JSON 后，把新 config 注入 gateway，真实决策必须
   用新值（这是「调参真正生效」的断点）。
3. **真实断言宿主**：实现 `AssertionRunContext` 的生产版本 `makeLiveAssertionRunner(aiRuntime)`——
   `runRequest(serialized)`：恢复世界快照 → 用真实 `facade.act` 决策 → 返回 trace。
4. **真实 golden 回归**：把 `src/core/kernel/ai/tuning/assertions/*.json` 用上述 runner 真跑，
   验证「未调优配置下确实选 shouldSelect 动作」；替换占位快照。新增契约测试断言：默认配置下 golden 全绿；
   注入调参后配置后，`scoreDesignCurrency` 输出随 config 变化（证明调参生效）。

【必须遵守的边界（对你无贡献，宁少勿缺）】
- 不碰 `src/play/loading-runtime/`、`src/devboard/**`、`src/l2/**`、`src/core/ugc/**`、`src/class/**`、
  `src/ui/**`、`test/play/loading-runtime/`；不改其它 spec 交付物。
- 不改 `design-currency.ts` 的默认分值/原则表；`scoreDesignCurrency` 默认行为不变（回归红线）。
- 唯一语义写入通道仍 `OpRegistry.invoke`；trace 只读、不新增写路径。
- 不新造 L1↔L2 桥、不做 MapData 契约扩展（均为独立专项）。

【门禁与收尾】
- `npx tsc --noEmit`（全域 0 err；loading-runtime 并行线既存错误属他线，登记不代修）
  + `npx vitest run src/core/kernel/ai src/play`（相关范围）+ `npm run lint` + `npm run verify:docs`。
- 收尾综述如实列：trace 出口被哪里消费、config 注入如何让调参生效、断言宿主是否被 skill 引用、
  golden 断言是否可真跑；不得谎报完成。接线是"串起来"，不是再写一套规则。
```

---

## 阶段 2：AI 迭代闭环验收（prompt 2）

**目标**：把「实际迭代 AI 参数/表格当用例测试」这一用户核心验收标准落地——构造一条真实红断言，
让编排器 ≤12 轮内调 JSON 配置、真实 AI 决策从选错变选对、真实 golden 全绿。这是整个系统的验收门。

**写权（独占）**：`test/ai-tuning/`（新目录）+ `src/core/kernel/ai/tuning/`（可改测试辅助，不碰组件语义）。

**冻结声明**：不碰 `src/play/loading-runtime/`、`src/devboard/**`、`src/l2/**`、`src/core/ugc/**`、`src/class/**`、`src/ui/**`。

**门禁**：`npx tsc --noEmit`（全域 0 err）+ `npx vitest run src/core/kernel/ai src/play test/ai-tuning` + `npm run lint` + `npm run verify:docs`。

---

### 可复制 prompt 2（迭代闭环验收）

```text
你是 WakeUp 项目「AI 迭代闭环验收」专项的立项认领者。工作目录 D:\coding\WakeUp。
本任务把「实际迭代 AI 参数/表格当用例测试」落地：在阶段 1 接线完成（facade 出 trace、config 可注入、
断言宿主真实）的基础上，构造一条真实红断言，跑真实 runTuningCycle，验证 AI 从选错变选对、golden 全绿。

【开工前必读】
- 阶段 1 接线交付物：`makeLiveAssertionRunner`（真实断言宿主）、config 注入后的 DesignCurrencyGateway、
  facade 的 trace 出口；`src/core/kernel/ai/tuning/orchestrator.ts`（runTuningCycle）、`report.ts`（固化）。
- `src/play/ai-runtime.ts`（createPlayAiRuntime）+ `src/core/kernel/ai/tuning/assertions/golden-*.json`（可真跑）。

【唯一产出与交付物】
1. **真实迭代 e2e 用例**（落 `test/ai-tuning/`）：构造一条「该选 X 却选 Y」的真实红断言（用真实世界快照 +
   真实 facade.act），跑 `runTuningCycle`，断言 ≤12 轮内调 JSON 配置、目标断言变绿、golden 全绿、
   `ParameterTuningRecord` 完整。
2. **调参生效断言**：注入新 config 后，真实决策所选动作确实改变（证明「调 JSON 让 AI 行为变化」）。
3. **固化验证**：闭环成功后 `solidifyAssertion` 把断言标 `tuning-derived` 并入断言集，schema 不破。
4. **边界上交验证**：唯一根因禁碰/低置信/无解 → 编排器 `{ok:false}` + 带 reason，不硬调。

【必须遵守的边界】
- 不碰 `src/play/loading-runtime/`、`src/devboard/**`、`src/l2/**`、`src/core/ugc/**`、`src/class/**`、`src/ui/**`。
- 不修改 tuning 组件语义（orchestrator/tuner/attribution 只可测试辅助化，不改行为）。
- 真实 e2e 只能改 JSON 配置（经 tuner），不得手工改默认表。

【门禁与收尾】
- `npx tsc --noEmit`（全域 0 err）+ `npx vitest run src/core/kernel/ai src/play test/ai-tuning` + `npm run lint` + `npm run verify:docs`。
- 收尾综述如实列：红断言怎么构造、调参后真实 AI 行为怎么变化、golden 怎么保持全绿、固化怎么入断言集；
  不得谎报完成。这条用例是整个「AI 自主学习迭代系统」的验收门。
```

---

## 批次执行说明

- **顺序强依赖**：阶段 2 消费阶段 1 的接线交付物（`makeLiveAssertionRunner`、config 注入、trace 出口），
  必须在阶段 1 全绿后启动。两段之间无并行。
- **每段独立门禁**：各 prompt 末尾列的门禁命令必须在该段收尾时全绿。
- **收尾**：阶段 2 全绿即「AI 迭代做用例测试」的完整链路打通；主状态板登记推进，`verify:docs` 术语一致性保持。
