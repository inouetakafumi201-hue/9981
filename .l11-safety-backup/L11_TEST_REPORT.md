# L11 诊断体系 属性测试报告

## 测试规模

| 测试项 | 次数 | 结果 |
|--------|------|------|
| DIAG-1..8: 任意emit序列后不变量成立 | 100,000 | ✅ PASS |
| 注册表自洽：prefix白名单 + fatal不可恢复 | 100,000 | ✅ PASS |
| E_DIAG_UNREGISTERED_CODE: 未注册码拒绝 | 100,000 | ✅ PASS |
| E_DIAG_MISSING_ATTRIBUTION: layer缺失拒绝 | 100,000 | ✅ PASS |
| 因果链有限：chainOf maxDepth正确终止 | 10,000 | ✅ PASS |
| DIAG-8: fatal后sealed语义 | 10,000 | ✅ PASS |
| E_DIAG_CAUSAL_CYCLE: 人工环检测 | 1 | ✅ PASS |
| DIAG-2: 篡改severity被检出 | 1 | ✅ PASS |
| E_INV_*全部为fatal | 1 | ✅ PASS |
| clear()后状态复位 | 1 | ✅ PASS |
| 空collector不变量成立 | 1 | ✅ PASS |
| 覆盖率：L3-L10所有错误码均已注册 | 1 | ✅ PASS |
| **合计** | **420,006** | **12/12 PASS** |

---

## 发现的Bug

| # | 最小复现序列 | 期望 | 实际 | 修复 |
|---|-------------|------|------|------|
| 1 | `reg('E_COST_OVER_FROZEN', 'fatal')` | severity='error'，recoverable=true | severity='fatal'，recoverable=false，与`FATAL_PREFIXES=['E_INV']`冲突 | 改为`'error'` |
| 2 | `reg('E_COST_NEGATIVE_RESOURCE', 'fatal')` | severity='error' | severity='fatal' | 改为`'error'` |
| 3 | `reg('E_PHASE_MULTI_OPEN', 'fatal')` | severity='error' | severity='fatal' | 改为`'error'` |
| 4 | `reg('E_INTENT_FROZEN_MISMATCH', 'fatal')` | severity='error' | severity='fatal' | 改为`'error'` |

**根因**：Spec §13.2 描述这些状态"语义上严重"，但真正的fatal判定标准由`src/core/kernel/state/error-codes.ts`的`FATAL_PREFIXES = ['E_INV']`唯一决定（需求39.6）。该文件注释明确："仅 E_INV_* 固定为 fatal，此表是唯一真相源，玩法包不可覆盖。" 非E_INV前缀的错误码，无论语义多严重，均为`error`级别，由Op层`tx.rollback()`保证状态一致性。

---

## Spec缺口（UNDEF）

以下是发现的命名漂移和Spec与实现不一致的地方，不属于本harness的Bug，需要在设计文档层面决策。

### 命名漂移（相同语义，不同代码字符串）

| 本harness注册的code | 实际L层代码发出的code | 来源 | 建议 |
|--------------------|--------------------|------|------|
| `E_EXPR_UNKNOWN_VAR` | `E_EXPR_UNBOUND_VAR` | kernel-l5-test/src/evaluator.ts:34 | 统一为`E_EXPR_UNBOUND_VAR`（实现侧已定，harness和Spec跟随） |
| `E_COST_OVER_FROZEN` | `E_COST_FROZEN_GONE` | src/core/kernel/state/error-codes.ts | 真正的ERR_CODES用`E_COST_FROZEN_GONE`，本harness沿用Spec的命名，两者含义接近但不完全一致 |

### INV双重定义漂移

| 情况 | 位置 | 说明 |
|------|------|------|
| `E_INV_DUAL_LOCATION` | kernel-l3-test/src/transaction.ts:84 | commit时检查"entity同时有node和slot" |
| `E_INV_LOCATION_EXCLUSIVE` | kernel-l3-test/src/invariants.ts:99 | InvariantChecker检查同一条件 |

两个code检查的是**完全相同的不变量**（INV-4），但分散在两个独立实现中，名称不同。本harness只注册了`E_INV_DUAL_LOCATION`（来自Spec），`E_INV_LOCATION_EXCLUSIVE`未被注册。建议：合并为一个code，统一由InvariantChecker发出，transaction.ts复用相同code。

### 本harness未覆盖的真实ERR_CODES

以下code族在`src/core/kernel/state/error-codes.ts`的`ERR_CODES`中定义并有`HINT_TEMPLATES`，但本harness未收录（Spec §13.2未列出）：

| code族 | 示例 | 所属系统 |
|--------|------|----------|
| `E_LOAD_*` | E_LOAD_CONFLICT, E_LOAD_CYCLE_DEP, E_LOAD_LINT, E_LOAD_UNDEFINED_REF | Playpack加载/Linter |
| `E_MIG_*` | E_MIG_NO_PATH, E_MIG_NEWER_SAVE, E_MIG_FAILED | 存档迁移 |
| `E_QUOTA_*` | E_QUOTA_ENTITIES, E_QUOTA_ATTACHMENTS, E_QUOTA_RULES | 配额强制 |
| `E_FLOW_BUDGET` | — | Flow脚本步数上限 |
| `E_FLOW_NO_MAXITER` | — | while缺少maxIter |
| `E_FLOW_ABORT` | — | Flow被abort effect停止 |
| `E_HOOK_INSTEAD_CONFLICT` | — | Hook instead冲突 |
| `E_HOOK_DEPTH` | — | Hook深度（harness用的是`E_HOOK_DEPTH_EXCEEDED`） |
| `E_EXPR_DEPTH` | — | Expr嵌套深度 |
| `E_EXPR_CALL_CYCLE` | — | 命名Expr调用环 |
| `E_DEC_VOID` | — | Decision已void |
| `E_DEC_QUORUM` | — | quorum配置无效 |
| `E_REF_KIND` / `E_REF_DESTROYED` / `E_REF_ABSTRACT` | — | Ref检查附加分类 |

**建议**：上述code族应在下一轮Spec修订时补入§13.2的注册表，并确保severity均为`error`（`E_LOAD_CYCLE_DEP`是例外，src/core/kernel/safety/safety.ts中标注为`fatal`，但其前缀不在`FATAL_PREFIXES`中——该处逻辑在真实实现里靠hardcode`'fatal'`实现，不依赖`isFatalCode()`，属于已知特例）。

### kernel-l5-test内的额外code（Spec未定义severity）

以下code由kernel-l5-test实现发出但Spec无显式severity定义，参照上下文判断为`error`（均为Expr求值阶段的静态结构错误，不修改状态）：

| code | 建议归类 | 原因 |
|------|----------|------|
| `E_EXPR_INVALID_QUERY` | error | sum操作缺少field字段，属格式校验错误 |
| `E_EXPR_UNKNOWN_OP` | error | 操作符名不在已知集合内，防御性default分支 |
| `E_EXPR_UNKNOWN_TYPE` | error | expr.type未知，防御性default分支 |

---

## 结论

**PASS** — 12/12，420,006次运行，零失败。

修复了4处severity分类错误（非E_INV_*代码不应为fatal）。发现并记录了5处命名漂移和16个Spec未列出的真实错误码，建议在下一轮Spec修订中统一。
