# TEST_L10_Intent意图系统 — 属性测试完成报告

> **完成日期**: 2026-08-06
> **范围**: L10层 Intent 意图系统（提交→冻结→解算→void/cancelled 四态）
> **方法**: 代码实现 + fast-check属性测试（非手工推演）
> **工程目录**: `kernel-l10-test/`

---

## 一、环境与实现

- 环境：`kernel-l10-test/`，依赖 fast-check 3.18.0 / vitest 1.6.0 / typescript 5.3.3，与 L3/L7/L9 一致。
- 实现文件：[src/intent.ts](../../../kernel-l10-test/src/intent.ts)（`IntentSystem`类，`IntentDef`/`Intent`/`Actor`/`IntentWorld`类型）
- 测试文件：[test/l10-property.test.ts](../../../kernel-l10-test/test/l10-property.test.ts)
- `npx tsc --noEmit` 通过，无类型错误。

## 二、测试结果

```
✓ test/l10-property.test.ts  (14 tests) 14168ms
Test Files  1 passed (1)
Tests  14 passed (14)
```

| # | 用例 | 类型 | numRuns | 结果 |
|---|------|------|---------|------|
| 1 | INV-12: 任意submit/resolve/void/cancel后Cost守恒 | 属性 | 100,000 | PASS |
| 2 | INV-12: void后冻结资源全额退回 | 属性 | 100,000 | PASS |
| 3 | 资源在resolve时正确扣除 | 属性 | 100,000 | PASS |
| 4 | 多个pending Intent的冻结总量不超过可用资源 | 属性 | 10,000 | PASS |
| 5 | E_COST_INSUFFICIENT: 资源不足时submit失败 | 边界 | - | PASS |
| 6 | require失败时Intent变为void，资源退回 | 边界 | - | PASS |
| 7 | E_INTENT_NOT_PENDING: 已resolved的Intent不能再resolve | 边界 | - | PASS |
| 8 | cost=[{amount:0}]的Intent正常submit和resolve | 边界 | - | PASS |
| 9 | actor销毁后resolve返回void | 边界 | - | PASS |
| 10 | Bug回归: 单Intent内重复pool的cost合并计算，不产生冻结超额 | 边界(新增) | - | PASS |
| 11 | Bug回归: 重复id的submit被拒绝(E_INTENT_DUP_ID) | 边界(新增) | - | PASS |
| 12 | Bug回归: 负数cost被拒绝(E_COST_NEGATIVE) | 边界(新增) | - | PASS |
| 13 | E_REF_INVALID: void不存在的Intent抛出异常 | 边界(新增) | - | PASS |
| 14 | E_INTENT_NOT_PENDING: 已resolved的Intent不能被cancel | 边界(新增) | - | PASS |

总计约 31 万次随机属性推演 + 9 条确定性边界断言，全部 PASS，0 FAIL。

## 三、发现并修复的Bug

任务原始给定的实现（Prompt文档中的示例代码）存在 3 处未受控缺陷，均在编写属性测试前的代码审查中发现并修复：

**Bug #1 — 同Intent内重复pool的cost计算错误（潜在冻结超额）**

原始 `submit()` 对 `def.cost` 数组逐条独立检查可用量、逐条独立冻结：

```typescript
// 原始给定代码
for (const cost of def.cost) {
  const available = this.getAvailable(actor, cost.pool);   // 未感知同批次中其他条目
  if (available < cost.amount) throw new Error('E_COST_INSUFFICIENT');
}
for (const cost of def.cost) {
  const current = actor.frozenResources.get(cost.pool) ?? 0;
  actor.frozenResources.set(cost.pool, current + cost.amount);  // 逐条累加，语义正确但检查阶段漏判
}
```

若同一个Intent的 `cost` 数组中出现两条指向同一 `pool` 的记录（如 `[{pool:'gold',amount:25},{pool:'gold',amount:15}]`），检查阶段每条都独立对比 `available`（未扣减同批次其他条目），当 `available` 介于两条金额之间时会误判为"资源充足"而实际冻结总量超过可用量，直接违反 INV-12。

**修复**：在检查前先按 `pool` 合并同批次cost，用合并后的总量做一次性可用量校验与冻结：

```typescript
const merged = new Map<string, number>();
for (const cost of def.cost) {
  merged.set(cost.pool, (merged.get(cost.pool) ?? 0) + cost.amount);
}
for (const [pool, amount] of merged.entries()) {
  const current = actor.frozenResources.get(pool) ?? 0;
  actor.frozenResources.set(pool, current + amount);
}
```

`resolve()`、`returnFrozen()`、`checkInvariants()` 中的同类逐条处理也一并改为合并计算，保持一致。新增回归测试 #10 覆盖。

**Bug #2 — 重复id的submit静默覆盖**

原始实现 `submit()` 直接 `this.intents.set(def.id, intent)`，未检查id是否已存在。若外部用相同id两次submit（例如误重试），第二次会静默覆盖第一次的Intent记录，但第一次已冻结的资源不会被追踪释放——旧Intent对象被垂悬引用丢弃，其冻结量永久滞留在 `frozenResources` 中，形成资源泄漏（可复现路径：submit('i1',10) → submit('i1',5) → void('i1') 只退回5，另外10永久冻结）。

**修复**：在 `submit()` 入口增加重复id检查：

```typescript
submit(def: IntentDef, world: IntentWorld): Intent {
  if (this.intents.has(def.id)) throw new Error('E_INTENT_DUP_ID');
  ...
}
```

新增回归测试 #11 覆盖。

**Bug #3 — 负数cost未被拒绝**

原始实现只检查 `available < cost.amount`，未检查 `cost.amount` 本身的符号。传入负数amount会使该条检查恒成立（`available < 负数` 几乎不可能触发），冻结时 `frozenResources` 反而减少，等价于凭空为actor"解冻"出资源，可被用于绕过其他Intent的可用量校验，破坏 INV-12。

**修复**：在检查循环中显式拒绝负数：

```typescript
for (const cost of def.cost) {
  if (cost.amount < 0) throw new Error('E_COST_NEGATIVE');
  ...
}
```

新增回归测试 #12 覆盖。

**次要一致性修复**：原始 `void(intentId, world)` 对不存在的intentId静默返回（`voidIntent`内部用 `if (!intent) return`），与 `resolve`/`cancel` 遇到不存在id时抛出 `E_REF_INVALID` 的行为不一致。为保持三个终止态转换方法（resolve/void/cancel）的错误处理一致性，`void()` 现在先校验intent存在性再抛错，`voidIntent`私有方法保留原有的"仅pending态才生效、其他态静默跳过"语义（因为它同时被 `resolve` 内部的自动void路径复用，那里"重复void"应是幂等无操作而非报错）。新增回归测试 #13。

## 四、结论

- L10 Intent 意图系统的核心不变量成立：任意 submit/resolve/void/cancel 操作序列下，`frozenResources ≤ resources`、资源非负、pending态Intent的冻结量与其声明cost一致，在 31 万次随机操作序列下均未被打破。
- 发现的3个Bug均属于"给定示例代码未处理的边界"而非Spec设计缺陷：多pool重复计算、重复id覆盖、负数cost，三者共同点是均可导致 INV-12（冻结量守恒）被绕过。均已修复并补充回归测试，无需变更Spec设计本身。
- 建议后续层复用Intent系统时注意：cost数组允许同pool出现多条（语义上代表"同一动作多笔扣费"），任何对cost数组的遍历处理都必须先按pool合并，不能逐条独立处理。

---

**完成状态**: ✅ 14/14 PASS，3个Bug已修复并回归覆盖
**下一步**: ~~执行 L11 Knowledge/Agent 或 L12 Persistence 层测试推演~~
→ ✅ 均已完成：L11 诊断体系（`kernel-l11-test`，12 项 PASS，修复 4 处 severity 误注册）、
L12 Persistence+Migration（`kernel-l12-test`，18 项 PASS）、
L13 Safety/Linter/配额（`kernel-l13-test`，15 项 PASS）。
Knowledge/Agent 由 `src/core/kernel/ai/**` 承担（AI 层 30 项测试，见
`决策与风险记录.md` 第 14 节）。

---

## 归档说明（2026-08-07）

- **层编号**：本报告的 L10 = **Intent 意图系统**，属于**属性实测轴（方案 C）**，是权威编号。
  目录内另有「Spec 章节审查轴（方案 A）」，其 L10 指 Random/命名流/影子流；
  另有已废弃的方案 D 把 Intent 编为 L7。
  因此 [`TEST_L7_Intent提交解算分离_框架.md`](TEST_L7_Intent提交解算分离_框架.md) 标记的
  "待推演执行"**不构成缺口** —— 其内容正是由本报告覆盖的。
  映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。
- **错误码提示**：本报告中的 `E_INTENT_NOT_PENDING`、`E_INTENT_DUP_ID`、`E_COST_NEGATIVE`
  是**本独立测试工程内部**使用的错误码，不是内核封闭注册表的成员。
  主实现的 `E_COST` 只有 `INSUFFICIENT`/`FROZEN_GONE`，且**没有 `E_INTENT_` 前缀**
  （`src/core/kernel/state/error-codes.ts`）。本层验证的是 INV-12 冻结守恒，
  不是错误码命名一致性；两者对账属跨层门禁第 ① 项，尚未执行 → 跟踪项 **T-03**。
- **未被本层覆盖的 Intent 维度**：Hidden 隐藏机制、`resolveOrder` 排序、`onConflict` 多策略
  的专项测试缺失，详见 `TEST_L7_Intent提交解算分离_框架.md` 的归档说明。
- **13 层总体结果**：见 [`00_状态基线.md`](00_状态基线.md) §3.2。
