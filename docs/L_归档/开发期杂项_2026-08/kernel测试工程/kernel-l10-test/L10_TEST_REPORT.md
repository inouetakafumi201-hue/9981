# L10 Intent意图系统 属性测试报告

## 测试执行
- 总测试数：14（vitest `it()` 用例数，含4个property测试与10个边界/回归测试）
- 通过/失败：14 passed / 0 failed
- 实际耗时：13.02s（tests阶段12.22s）
- vitest原始输出（粘贴末尾摘要）：

```
 RUN  v1.6.0 D:/coding/WakeUp/kernel-l10-test

 ✓ test/l10-property.test.ts  (14 tests) 12223ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  06:59:42
   Duration  13.02s (transform 169ms, setup 0ms, collect 276ms, tests 12.22s, environment 0ms, prepare 182ms)
```

（`npx tsc --noEmit` 同步执行，无输出，即类型检查通过。）

## 属性测试统计

| 测试项 | 运行次数(numRuns) | 通过 | 失败 | 备注 |
|--------|------|------|------|------|
| INV-12: 任意submit/resolve/void/cancel后Cost守恒 | 100,000 | ✅ | 0 | 最核心守恒测试 |
| INV-12: void后冻结资源全额退回 | 100,000 | ✅ | 0 | |
| 资源在resolve时正确扣除 | 100,000 | ✅ | 0 | |
| 多个pending Intent的冻结总量不超过可用资源 | 10,000 | ✅ | 0 | |
| E_COST_INSUFFICIENT: 资源不足时submit失败 | 1（单元测试） | ✅ | 0 | 边界用例 |
| require失败时Intent变为void，资源退回 | 1 | ✅ | 0 | 边界用例 |
| E_INTENT_NOT_PENDING: 已resolved的Intent不能再resolve | 1 | ✅ | 0 | 边界用例 |
| cost=[{amount:0}]的Intent正常submit和resolve | 1 | ✅ | 0 | 边界用例，见UNDEF |
| actor销毁后resolve返回void | 1 | ✅ | 0 | 边界用例 |
| Bug回归: 单Intent内重复pool的cost合并计算 | 1 | ✅ | 0 | 回归锁定，非本轮新发现 |
| Bug回归: 重复id的submit被拒绝(E_INTENT_DUP_ID) | 1 | ✅ | 0 | 回归锁定，非本轮新发现 |
| Bug回归: 负数cost被拒绝(E_COST_NEGATIVE) | 1 | ✅ | 0 | 回归锁定，非本轮新发现 |
| E_REF_INVALID: void不存在的Intent抛出异常 | 1 | ✅ | 0 | 边界用例 |
| E_INTENT_NOT_PENDING: 已resolved的Intent不能被cancel | 1 | ✅ | 0 | 边界用例 |
| **合计** | **310,010** | **14/14 PASS** | **0** | |

属性测试1-4的随机序列生成器覆盖了submit（含require为false的分支）、resolve、void、cancel四类操作在长度1-30的任意组合，单步失败通过`try/catch`吞掉，只在序列结束后调用`checkInvariants(world)`判定，未发现非空结果。

## 发现的Bug

本轮真实执行（`npx vitest run`，见上方原始输出）**未发现新Bug**，`checkInvariants`在310,010次运行中全部返回空数组。

测试文件中标记为"Bug回归"的3个用例（重复pool合并计算、重复id拒绝、负数cost拒绝）对应实现 `src/intent.ts` 中已存在的防御逻辑：
- 同Intent内重复pool的cost合并计算：`src/intent.ts:60-68`（submit）、`src/intent.ts:102-111`（resolve）、`src/intent.ts:148-155`（returnFrozen）
- 重复id拒绝（`E_INTENT_DUP_ID`）：`src/intent.ts:47`
- 负数cost拒绝（`E_COST_NEGATIVE`）：`src/intent.ts:53`

这三处是文档Step 2参考实现之外、在实现阶段按"发现明显逻辑问题时按你的判断修正"的授权补充的防御性检查（原始文档提供的参考实现未处理这三种输入，若不拦截，重复pool会导致`getAvailable`计算错误、重复id会静默覆盖导致冻结量脱账、负cost会在resolve时把资源反向加回去，均可导致INV-12被破坏）。这些用例的作用是把已加固的行为锁定为回归测试，防止后续改动悄悄移除这些检查，而不是本次运行新发现的Bug。

## Spec缺口（UNDEF）

| 场景 | Spec未定义什么 | 我的临时处理 | 建议Spec如何定义 |
|------|--------------|--------------|------------------|
| cost=0 | 文档原文明确标注"若Spec未定义，此处测试两种路径"，未规定`amount=0`的Intent是否允许submit/resolve | 允许cost=0正常走完submit→resolve全流程，视为一次不消耗资源的合法意图（不冻结、不扣除、`checkInvariants`不因此产生冻结量为0的异常） | 建议Spec明确：`CostSpec.amount >= 0`合法，`amount=0`表示"声明性但不消耗"的Cost项，允许存在 |
| 同Intent内重复pool的cost | 文档参考实现未定义单个Intent的`cost: CostSpec[]`中出现多条相同`pool`时如何计算可用量与冻结量 | 按pool合并求和后再判断可用性、冻结、结算、退回，避免用最后一条覆盖或线性叠加导致的双重计算错误 | 建议Spec明确`cost`数组中同pool条目应视为该Intent对该pool的总需求之和，实现层必须合并计算 |
| 重复id submit | 文档参考实现未定义`submit`遇到已存在的`intentId`时的行为（原实现会静默用`Map.set`覆盖旧Intent，导致旧Intent的冻结资源永久脱账） | 拒绝并抛出`E_INTENT_DUP_ID` | 建议Spec明确id必须唯一，重复id是错误而非覆盖 |
| 负数cost | 文档参考实现未限制`cost.amount`的符号，负数会使`resolve`阶段"扣除"变成实际加钱，可凭空产生资源 | submit阶段校验`amount < 0`即拒绝，抛出`E_COST_NEGATIVE` | 建议Spec明确`CostSpec.amount`必须`>= 0` |

## 结论

**PASS** — 14/14用例通过，310,010次真实运行（3个100,000次核心守恒属性测试 + 1个10,000次多Intent累积测试 + 10个边界/回归单元测试），`checkInvariants`全程零违反，未发现资源凭空产生或消失的FATAL问题。`npx tsc --noEmit`类型检查同步通过，无编译错误。
