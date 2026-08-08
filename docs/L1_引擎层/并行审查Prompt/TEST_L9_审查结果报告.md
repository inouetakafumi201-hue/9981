# TEST_L9_Phase相位流程 — 属性测试完成报告

> **完成日期**: 2026-08-06
> **范围**: L9层 Phase状态机 + Flow回合推进
> **方法**: 代码实现 + fast-check属性测试（非手工推演）
> **工程目录**: `kernel-l9-test/`

---

## 一、环境与实现

- 环境：`kernel-l9-test/`，依赖 fast-check 3.18.0 / vitest 1.6.0 / typescript 5.3.3，与 L3/L7 一致。
- 实现文件：[src/phase.ts](../../../kernel-l9-test/src/phase.ts)（`FlowSystem`类，`PhaseDef`/`PhaseState`/`FlowDef`类型）
- 测试文件：[test/l9-property.test.ts](../../../kernel-l9-test/test/l9-property.test.ts)
- `npx tsc --noEmit` 通过，无类型错误。

## 二、测试结果

```
✓ test/l9-property.test.ts  (11 tests) 12013ms
Test Files  1 passed (1)
Tests  11 passed (11)
```

| # | 用例 | 类型 | numRuns | 结果 |
|---|------|------|---------|------|
| 1 | 任意advance序列后最多一个Phase处于open | 属性 | 100,000 | PASS |
| 2 | E_PHASE_INVALID_TRANSITION: 非法目标Phase被拒绝 | 属性 | 100,000 | PASS |
| 3 | E_FLOW_REACTION_LIMIT: round超限被拒绝 | 属性 | 10,000 | PASS |
| 4 | E_FLOW_INVALID_INITIAL: initial不在phases中 | 边界 | - | PASS |
| 5 | E_FLOW_INVALID_TRANSITION: transition指向不存在的Phase | 边界 | - | PASS |
| 6 | 末端Phase advance后Flow结束 | 边界 | - | PASS |
| 7 | locked Phase不能advance | 边界 | - | PASS |
| 8 | E_FLOW_ALREADY_RUNNING: 不能同时启动两个Flow | 边界 | - | PASS |
| 9 | ttl过期后自动推进到下一Phase | 属性 | 10,000 | PASS |
| 10 | E_FLOW_NOT_RUNNING: 无Flow运行时nextReactionRound抛出明确错误而非崩溃 | 边界(新增) | - | PASS |
| 11 | E_FLOW_NOT_RUNNING: 无Flow运行时lockPhase/unlockPhase抛出明确错误 | 边界(新增) | - | PASS |

总计约 22 万次随机属性推演 + 8 条确定性边界断言，全部 PASS，0 FAIL。

## 三、发现并修复的Bug

**Bug**: 任务原始给定的实现中，`nextReactionRound()`、`lockPhase()`、`unlockPhase()` 在 Flow 未启动（`currentFlow === null`）时会直接崩溃：

```typescript
// 原始给定代码
nextReactionRound(): void {
  const flow = this.flows.get(this.currentFlow!)!;   // Map.get(null) → undefined
  const phaseDef = flow.phases.find(...)              // TypeError: Cannot read properties of undefined
  ...
}
```

`this.currentFlow!` 是 TypeScript 的非空断言，编译期擦除、运行期无效。当 `currentFlow` 实际为 `null` 时，`this.flows.get(null)` 返回 `undefined`，随后访问 `.phases` 会抛出未受控的 `TypeError`，而不是内核约定的 `Error('E_XXX')` 错误码形式。这与 `advance()` 已有的 `E_FLOW_NOT_RUNNING` 前置检查不一致——三个写操作方法（lock/unlock/nextReactionRound）缺少同等的哨兵检查。

**修复**：为三个方法补上与 `advance()` 一致的前置检查，未运行时统一抛出 `E_FLOW_NOT_RUNNING`：

```typescript
lockPhase(): void {
  if (!this.currentPhase) throw new Error('E_FLOW_NOT_RUNNING');
  ...
}
unlockPhase(): void {
  if (!this.currentPhase) throw new Error('E_FLOW_NOT_RUNNING');
  ...
}
nextReactionRound(): void {
  if (!this.currentFlow || !this.currentPhase) throw new Error('E_FLOW_NOT_RUNNING');
  ...
}
```

并新增两条边界测试（#10、#11）覆盖该场景，防止回归。

## 四、结论

- L9 Phase/Flow 状态机核心不变量成立：单Phase-open、currentPhase非悬空、round不超限、ttl自动推进均在 22 万次随机操作序列下未被打破。
- 唯一发现的缺陷是错误处理一致性问题（未受控TypeError vs 受控错误码），已修复并补充回归测试，无需变更Spec设计本身。
- 建议后续层（L10 Intent等）复用 `FlowSystem` 时，统一在所有对外方法入口做 `E_FLOW_NOT_RUNNING` 前置检查，避免同类疏漏。

---

**完成状态**: ✅ 11/11 PASS，1个Bug已修复并回归覆盖
**下一步**: ~~执行 L10 Intent层测试推演~~ → ✅ 已完成，见
[`TEST_L10_审查结果报告.md`](TEST_L10_审查结果报告.md)（14/14 PASS，修复 3 个 Bug）

---

## 归档说明（2026-08-07）

- **层编号**：本报告的 L9 = **Phase 相位 + Flow 回合推进**，属于**属性实测轴（方案 C）**，
  也是工程验收的权威编号。注意目录内另有「Spec 章节审查轴（方案 A）」，
  其 L9 指 Schedule/Playpack/Policy —— 是不同的东西。映射见
  [`00_状态基线.md`](00_状态基线.md) §2.1。
- **错误码提示**：本报告中的 `E_PHASE_INVALID_TRANSITION`、`E_FLOW_REACTION_LIMIT`、
  `E_FLOW_INVALID_INITIAL`、`E_FLOW_INVALID_TRANSITION`、`E_FLOW_NOT_RUNNING`、
  `E_FLOW_ALREADY_RUNNING` 是**本独立测试工程内部**使用的错误码，
  不等于内核封闭注册表的成员。主实现的 `E_FLOW` 只有
  `BUDGET`/`NO_MAXITER`/`ABORT`/`INTERNAL`/`UNKNOWN_EFFECT`，且**没有 `E_PHASE_` 前缀**
  （`src/core/kernel/state/error-codes.ts`）。
  本层测试验证的是**状态机不变量**，不是错误码命名的一致性 ——
  两者的对账属于跨层门禁第 ① 项，尚未执行 → 跟踪项 **T-03**。
- **13 层总体结果**：见 [`00_状态基线.md`](00_状态基线.md) §3.2。
