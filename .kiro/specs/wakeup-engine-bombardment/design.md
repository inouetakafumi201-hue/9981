# 设计：wakeup-engine-bombardment（引擎层收官属性与压力测试）

## 概述

本设计把 `requirements.md` 的 11 条需求（9 条逐层属性轰炸 + 1 条跨层贯通脏输入 + 1 条完备性元需求）落成可机械校验的正确性属性与属性测试。设计基线是引擎层在对账批后已语义冻结、白盒已封顶、`npx tsc --noEmit` 0 / `npx vitest run` 3040 全绿 / `lint` 0 error。本规格**只验证与完备修复**，不新增玩法机制、不改玩家可见数值、不越权改 `src/class/**`。

对每条验收标准做 prework 可测性分析，聚类为属性，每属性被恰好一个 fast-check PBT（≥100 生成，高价值压力面 500+）实现，全部带 `Feature: wakeup-engine-bombardment, Property N` 注释。

## 架构

```
引擎层13层 + 跨层贯通 ──► 统一以「真机 harness + 真实模块 import」轰炸：
   L1  State/Topology    ──► value/invariant + metrics/prefab/container
   L2  Expr/Query        ──► expr 穷举解析/求值/dirty 表达式
   L3  Ops/Transaction   ──► 事务嵌套 + 唯一写入通道 + GARBAGE_ARGS 全 Op 遍历
   L4  Hook/Flow         ──► 五阶段确定性 + 深度/重入 + Flow 预算
   L5  Flow              ──► 预算 + (并入 L4)
   L6  Actions           ──► cost 守恒 + 池结算
   L7  Decision/Intent   ──► 决策有终 + 意图幂等 + 超时推进
   L8  Attachment        ──► 级联回收 + aura
   L9  Schedule          ──► schedule.advance 阶段一致
   L10 Random            ──► 确定回放 + 影子流 + 输出范围
   L11 Knowledge         ──► 只读访问面（无第二写通道）
   L12 Persistence       ──► snapshot/replay/rewind/migration
   L13 Safety/Codec      ──► 诊断汇/熔断/配额 + 严格 JSON fail-closed
   └──────────────────────► 跨层贯通：#10 全 Op × 脏输入 × 长序列对抗
```

**关键架构原则**
1. **白盒封顶只验证**：不改机制语义；对刨出的真实问题按宪法做整体修复。
2. **真机轰炸**：直接用生产能力模块（import 生产代码或 `createFullHarness`），不用 mock 假实现。
3. **反例分类**：任何 PBT 失败按「测试缺陷 / 代码 bug / 规格缺口」分类，代码 bug 做整体修复并记录。
4. **完备性自证**：要求↔属性↔PBT↔任务四向回溯。

## 组件和接口

逐层被测组件均为现有引擎生产模块（`src/core/kernel/**`），本设计不新增组件。轰炸动作通过以下既有入口：

| 层 | 被测入口 | 现有测试基座 | 本轮轰炸超集 |
|---|---|---|---|
| L1 State | `validateValue`/`isValidValue`/`isFiniteNumber`、`InvariantChecker` | `state/value.test.ts`、`state/*.test.ts` | Property 1 |
| L1 Topology | `dist/spread/shortestPath/radius`、`buildKeyToIdMap/remapLinks/resolveAttachToRoot`、`container.*` | `topology/metrics.test.ts`、`graph/container/prefab.test.ts` | Property 2 |
| L2 Expr | `ExprEngine`/`QueryEngine`/`makeDefaultEvalContext` | `expr/engine.test.ts`、`query-engine` | Property 2b（并入） |
| L3 Ops/Transaction | `Transaction`、`OpRegistry`、`WorldStateHolder` | `ops/registry.test.ts`、`cross-layer-regression A/B` | Property 3 |
| L4-L5 Hook/Flow | `HookDispatcher`、`FlowInterpreter`、`wireHooksIntoRegistry` | `events/*`、`flow/*` | Property 4 |
| L6 Actions | `freezeCost/settleCost/refundCost`、`ActionCatalog` | `actions/cost.test.ts` | Property 5a |
| L7 Decision/Intent | `makeProcessDecisionTimeouts`、`queryPendingIntentsFor/All`、`intent.resolve/void` | `decision/*` | Property 5b |
| L8 Attachment | `cascadeRemovalSet`、`registerAttachOps` | `attachment/attach.test.ts` | Property 6a |
| L9 Schedule | `schedule.advance`、`PlaypackLoader` | `schedule/advance-conditions.test.ts` | Property 6b |
| L10 Random | `random.roll/pick/shuffle/weightedPick`、`snapshotStream/restoreStream` | `random/random.test.ts` | Property 7 |
| L12 Persistence | `takeSnapshot/Journal/replay/rewind/InMemoryCheckpointStore/applyMigration/compareVersions` | `persistence/persistence.test.ts` | Property 8 |
| L13 Safety/Codec | `DiagnosticSink`、`RuleCircuitBreaker`、`QuotaEnforcer`、`StrictJsonCodec` | `safety/safety.test.ts`、`codec/strict-json-codec` | Property 9 |
| 跨层贯通 | `createFullHarness` + `opSequenceArb` + `runOpSequence` + `GARBAGE_ARGS` | `cross-layer-regression.test.ts`、`fuzz*.test.ts` | Property 10 |

## 数据模型

无新数据模型。被测对象为引擎既有的 `WorldState`、`Link`、`Def`、`Diagnostic`、`Snapshot` 等；新生成的抽象仅存在于测试测试域（随机图、随机值、随机 Op 序列、随机诊断流）。

## 正确性属性

*属性是一种特征或行为，应该在系统的所有有效执行中都保持真实。每个属性带「对任意/对每一」全称量化 + 要求回溯，并以恰好一个 fast-check 属性测试实现（≥100 次生成，压力面 500 次）。*

### 属性 1：L1 State 值安全与不变量稳定
- **对任意** 随机生成的值（嵌套对象/非有限数/原型键/数组），`validateValue`/`isValidValue`/`isFiniteNumber` 恒返回合法判定且不抛异常；`isFiniteNumber(NaN/Infinity/-0)` 恒 `false`；带 `__proto__`/`constructor` 键的值判为非法。
- **验证：要求 1.1、1.2、1.3**
- **类型**：invariant + error-condition
- **实现**：`bombardment-l1-state.property.test.ts`。用 `fc.oneof(fc.integer/number/string/boolean/keyword('null')/nested array/object/prototype key)` 生成任意值，断言判定函数不抛；对含非有限数与原型键的产物断言非法。
- **迭代**：500

### 属性 2：L1 Topology 图度量一致性
- **对任意** 随机图（多节点、混合 `direction` 四 token、混合权重、含自环/悬空端点/负权），`dist(a,a)=0`、`dist(a,b)+dist(b,a)` 至少一侧非 `null`（不是两向都 null）、`shortestPath` 序列逐边可达且代价 = `dist`、`radius(…,budget)` 集合 === `dist(…,maxCost=budget)` 可到达集、`spread` 结果 `strength∈[0,budget]` 且沿边单调不增、度量函数绝不抛异常。
- **验证：要求 2.1、2.2、2.3、2.4**
- **类型**：invariant + metamorphic
- **实现**：`bombardment-l1-topology.property.test.ts`。用 `fc.array(fc.string())` + `fc.array(fc.record({a,b,direction,weight}))` 生成可达图；断言上述多条一致性（`dist(path) === Σcost`、`radius` σ 一致性）。这是 Direction/weight 混合图上的对照验证。
- **迭代**：300

### 属性 2b：L2 Expr/Query 穷举健壮性
- **对任意** 结构随机的 Expr（含未知算子、越界深度、`$` 绑定陷阱、非法类型）与随机 Query，`ExprEngine`/`QueryEngine` 求值产生合法 `Result` 或结构化错误，绝不抛未捕获异常；`checkPure` 对含副作用访问的表达式判为不纯。
- **验证：要求 2.5（并入）**
- **类型**：error-condition
- **实现**：并入 `bombardment-l1-topology.property.test.ts` 或独立 `bombardment-l2-expr.property.test.ts`（复用既有 `fuzz-malformed-expr` 的生成策略，但落在 QueryEngine 组合路径）。
- **迭代**：300

### 属性 3：L3 Ops/Transaction 全 Op 脏输入原子性
- **对任意** 注册 Op × GARBAGE_ARGS 组合，`registry.invoke` 返回合法 `Result`（`ok` boolean、失败必带 string `code`），永不抛未捕获异常；失败时 `holder.getState()` 引用与调用前逐字节相等；结构性 Op 标记与 `isStructural`一致。
- **验证：要求 3.1、3.3、3.4**（3.2 由属性 10 覆盖跨层）
- **类型**：error-condition + invariant
- **实现**：`bombardment-l3-ops.property.test.ts`。遍历 `listOpNames()` × 扩展 GARBAGE_ARGS（原有 23 种 + 原型键 + 深嵌套 + 跨集合 ref），对每次调用断言不抛/合法 Result/失败原子/结构标记；结合 `Transaction.begin/commit/rollback` 嵌套序列断言 `getDraft` 恒返回引用、回滚恢复基线引用、越底无操作。
- **迭代**：100（穷举遍历本身就是确定性；随机嵌套事务 300）

### 属性 4：L4-L5 Hook/Flow 确定性 + 预算
- **对任意** 随机注册的 RuleDef 集与随机事件，`HookDispatcher` 分发结果确定性（同输入同输出）；深度/重入超限签发 `E_HOOK_DEPTH`/`E_HOOK_REENTRY`；`FlowInterpreter` 对任意效果脚本超 `budget`/`maxIter` 签发 `E_FLOW_BUDGET` 且不无限循环；`wireHooksIntoRegistry` 接线下 effects 实际被 FlowInterpreter 执行。
- **验证：要求 4.1、4.2、4.3、4.4**
- **类型**：destructive + invariant
- **实现**：`bombardment-l4-hook-flow.property.test.ts`。用 fc 生成随机 RuleDef 序列与 effect 脚本，断言确定性（两次分发结果等价）、预算回退不挂死。
- **迭代**：200

### 属性 5a：L6 Actions cost 三态守恒
- **对任意** 随机动作序列（create 资源、freeze/settle/refund 交错、含失败 settle），`freeze+settled+refund` 的总进出账守恒：冻结后被结算或退款的成本不泄漏，settle 失败不产生滞留冻结。
- **验证：要求 5.1**
- **类型**：confluence（守恒）
- **实现**：`bombardment-l6-actions.property.test.ts`。构造带 AP 池的世界，随机 freeze→settle/refund 序列，断言池余额 + 有效冻结恒等于初始。
- **迭代**：300

### 属性 5b：L7 Decision/Intent 决策有终 + 意图幂等
- **对任意** 随机决策开启/作答/超时序列，`makeProcessDecisionTimeouts` 推进后 open 态决策必被处理（不悬置）；意图提交后 resolve/void 至多一次；`queryPendingIntentsFor/queryAllPendingIntents` 返回全集且无重复。
- **验证：要求 5.2、5.3**
- **类型**：invariant + idempotence
- **实现**：`bombardment-l7-decision-intent.property.test.ts`。
- **迭代**：200

### 属性 6a：L8 Attachment 级联回收 + aura
- **对任意** 随机 attachment 图（含 `grantedBy` 链），删除父 attachment 后 `cascadeRemovalSet` 覆盖全部后代、`checkAttachmentConsistency`+`checkGrantedByCascade` 全绿、无悬空 `grantedBy`。
- **验证：要求 6.1**
- **类型**：invariant
- **实现**：`bombardment-l8-attachment.property.test.ts`。
- **迭代**：200

### 属性 6b：L9 Schedule advance 阶段一致
- **对任意** 合法初始 schedule 状态，`schedule.advance` 推进一个时间单位产出可判定新状态、不产生悬置决策；缺失可选字段不崩溃（合法错误码）。
- **验证：要求 6.2、6.3**
- **类型**：invariant + error-condition
- **实现**：`bombardment-l9-schedule.property.test.ts`。
- **迭代**：200

### 属性 7：L10 Random 回放确定性 + 输出范围
- **对任意** seed/流名/操作序列，`snapshotStream`→`restoreStream` 往返后 RNG 状态相等、重放输出逐取相等；`random.roll` 输出∈`[1,sides]`、`pick` 取自数组、`weightedPick` 按权重；无效 sides/空数组/负权重返回 `E_OP_INVALID_ARGS` 不越界。
- **验证：要求 7.1、7.2、7.3**
- **类型**：round-trip + invariant
- **实现**：`bombardment-l10-random.property.test.ts`。
- **迭代**：300

### 属性 8：L12 Persistence 快照重放往返
- **对任意** 随机状态与随机 journal 序列，`takeSnapshot`→`replay(journal)` 后关键场（实体/关系/附件/容器拓扑）语义等价；`applyMigration` transform 抛异常时原状态不变、原子失败；`compareVersions` 对任意版本串返回 `-1/0/1` 且不抛。
- **验证：要求 8.1、8.2、8.3**
- **类型**：round-trip + error-condition
- **实现**：`bombardment-l12-persistence.property.test.ts`。
- **迭代**：200

### 属性 9：L13 Safety/Codec fail-closed
- **对任意** 字节串（含字节炸弹、深度嵌套、危险键、重复成员），`StrictJsonCodec.parse` 返回可解析 AST 或结构化错误（带 code/line/column），绝不抛未捕获异常、绝不原型污染宿主；嵌套超 `HARD_MAX_NESTING_DEPTH` 返回 `E_LOAD_*_EXCEEDED` 类错误。
- **对任意** 诊断注入序列，`DiagnosticSink` error/fatal 永不被丢弃或降级、dedup 稳定、evict 先 info 后 warn；halt 后每次 emit 抛 `DiagnosticHaltError`。
- **对任意** 时间序列，`RuleCircuitBreaker.recordError` 达阈置 `disabled` 并保持、窗外不入窗、reset 清除；超配额 `QuotaEnforcer` 返回 `ok:false`。
- **验证：要求 9.1、9.2、9.3、9.4、9.5**
- **类型**：total-function + error-condition + invariant
- **实现**：`bombardment-l13-safety-codec.property.test.ts`。
- **迭代**：500（字节 bomb）

### 属性 10：跨层贯通脏输入用例集轰炸
- **对任意** 全 Op × GARBAGE_ARGS × 脏表达式/越界引用组合与任意长随机 Op 序列（150-300，hook 接线 harness），终局满足全部不变量、失败原子、无未捕获异常、无 Id 空间冲突、无挂死（<5000ms）；覆盖全部脏输入类别（悬空引用/原型键/非有限数/深嵌套/自环/越界索引/负数小数 sides/抽象 Def/未知 Op/缺失字段/跨集合类型混用）。
- **验证：要求 10.1、10.2、10.3**
- **类型**：error-condition + invariant + stress
- **实现**：新 `bombardment-cross-layer.property.test.ts`（复用 `createFullHarness`/`opSequenceArb`/`runOpSequence`/`GARBAGE_ARGS`，把既有的 fuzz F1-F5 与 cross-layer A2 提高迭代并扩展脏输入集）。
- **迭代**：500

### 属性 11：完备性自证
- **对每一** 验收标准，都遵循某一种 EARS 模式并 INCOSE 合规；**对每一** 可测标准恰好被一个属性覆盖；**对每一** 属性恰好被一个 PBT（`Feature: wakeup-engine-bombardment, Property N` + ≥100 迭代）实现；**对每一** 实现任务回引其要求子句。
- **验证：要求 11.1-11.5**
- **类型**：model-based（文档结构）
- **实现**：本规格自身 + 收尾 verify:docs/verify:data。
- **迭代**：n/a（文档静态校验）

## 错误处理

- 属性轰炸发现的反例一律先分类：**测试缺陷**（断言/生成器错）→ 修测试；**代码 bug** → 按宪法做整体方案修复并登记；**规格缺口**（超出本 spec 职权）→ 登记交接项提请裁决，不默认否决。分类结果记入本 spec 的 execution 记录。
- 守卫宪法：任何新增测试不得让玩家可见数值越 1-5、不得出现非 1 AP 原子动作、不改 `src/class/**`。

## 测试策略

### 双重测试
- **单元确定性样例**：对每层保留既有单测（metrics/expr/ops/decision/attachment/schedule/random/persistence/safety 的 `*.test.ts`），本轮在其上叠加属性轰炸。
- **基于属性的测试**（fast-check）：属性 1/2/2b/3/4/5a/5b/6a/6b/7/8/9/10 各一个 PBT，全部 `Feature: wakeup-engine-bombardment, Property N` 注释 + ≥100 迭代（压力面 300-500）。

### PBT 配置
```typescript
const propertyConfig = { numRuns: 500, path: 'design.md', propertyId: 'Property 1', validates: 'Requirements 1.1,1.2,1.3' };
```
标签：`/** Feature: wakeup-engine-bombardment, Property N ... */`。

### 三命令门禁 + 数据/文档门禁
每个任务后：`npx tsc --noEmit` 0 / 相关范围 `npx vitest run` 全绿 / `npm run lint` 0 error；收尾加 `npm run verify:data`（90 份）+ `npm run verify:docs`。
