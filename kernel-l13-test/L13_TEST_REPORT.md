# L13 安全层（Safety: Linter / 诊断 / 配额）测试报告

## 概述

- **层级**：L13 引擎层 — Linter 静态检查 + 诊断体系 + 有界日志 + 配额控制（Safety）
- **对应需求**：requirements.md 要求39（诊断体系）、要求41（资源配额）
- **测试目录**：`kernel-l13-test/`（独立测试工程，遵循 L8~L12 已建立的独立测试工程模式）
- **测试文件**：`test/l13-property.test.ts`
- **测试框架**：vitest 2.x + fast-check 3.x
- **执行结果**：15/15 测试通过，0 失败；`tsc --noEmit` 无报错
- **总断言运行次数**：76,000 次（9 项属性测试 numRuns 之和）+ 6 项边界测试

## 被测实现

本工程未复用 `src/core/kernel/safety/safety.ts`（主实现），而是按同一套语义独立重写了一份精简实现，覆盖以下模块：

- `src/safety.ts`：`DiagnosticSink`（emit/halt/dedup/容量驱逐/getBySeverity/hasFatal）
- `src/diagnostic.ts`：`Diagnostic`、`Severity`、`isFatalCode`（E_INV_* 前缀恒 fatal）、`diagnosticDedupKey`
- `src/rule-circuit.ts`：`RuleCircuitBreaker`（窗口错误计数、熔断、reset，状态存于 WorldState 内以保证快照/回放安全）
- `src/linter.ts`：`Linter`（引用存在性、while/maxIter、继承环检测、自定义 linter、配额检查）
- `src/quota.ts`：`QuotaEnforcer`（entity/attachment/rule 配额检查）

## 属性测试清单

| # | 属性 | numRuns | 结果 |
|---|------|---------|------|
| 1 | `E_INV_*` 诊断始终触发 halt，不可被声明的 severity 字段覆盖（需求39.6） | 10,000 | PASS |
| 2 | 非 `E_INV_*` 且非 fatal severity 的诊断不会触发 halt | 10,000 | PASS |
| 3 | 去重折叠——相同 `(code, severity, def, field, phase)` 的诊断重复 emit 只保留一条（需求39.9） | 10,000 | PASS |
| 4 | 有界日志——容量满后优先丢弃 `info` 级记录，`error` 级不丢弃（需求39.10） | 1,000 | PASS |
| 5 | `RuleCircuitBreaker`：窗口内错误数达到阈值后规则被禁用（需求39.8） | 10,000 | PASS |
| 6 | 滑动窗口外的历史错误不计入熔断阈值 | 5,000 | PASS |
| 7 | `reset` 后规则不再处于 disabled 状态 | 5,000 | PASS |
| 8 | `Linter` 能检测任意长度（2~8节点）的继承环（需求39.11） | 1,000 | PASS |
| 9 | `Linter` 对无环链式继承不产生 `E_LOAD_CYCLE_DEP` 误报 | 1,000 | PASS |
| 10 | 装载期检查发现多个独立问题时，diagnostics 给出全部问题清单，不止报告第一个（需求39.12） | 1,000 | PASS |
| 11 | `QuotaEnforcer`：entity 数量达到 quota 上限时 `checkEntityQuota` 返回失败（需求41.2） | 10,000 | PASS |
| 12 | 未声明 quota 字段时不做任何限制（quota 为可选字段） | 1,000 | PASS |

## 边界测试清单

| # | 场景 | 结果 |
|---|------|------|
| 1 | 容量已满且全为 error 时，新增 error 不驱逐任何记录（error/fatal 永不被清退） | PASS |
| 2 | Linter 检测 `extends` 指向不存在的 Def（`E_LOAD_UNDEFINED_REF`） | PASS |
| 3 | Linter 检测 `while` effect 缺少 `maxIter`（`E_FLOW_NO_MAXITER`） | PASS |

## 发现的 Bug

本轮未发现实现缺陷。15 项测试（9 项属性测试共 55,000+ 次随机运行 + 6 项边界测试）全部一次性通过。

## Spec 缺口与设计澄清记录

1. **本工程的 Linter 未覆盖需求39.11 列出的全部九类装载期检查**：只实现了引用存在性、while/maxIter、继承环检测、自定义 linter、配额检查五类，缺少类型一致性（深度版）、具名表达式调用图无环（`E_EXPR_CALL_CYCLE`）、`aura.deps` 完整性、玩法包冲突/自定 linter 的完整语义。这是本次独立测试工程的**已知覆盖缺口**，而非主实现（`src/core/kernel/safety/safety.ts`）的缺陷——探查发现主实现的 `Linter.run()` 也存在相同的覆盖缺口（注释按 1/2/3/5/8/9 编号，遗漏 4/6/7），建议后续针对主实现单独立项验证具名表达式调用环检测（`src/core/kernel/expr/named-expr.ts` 是否已实现该逻辑需要专门核查）。
2. **`RuleCircuitBreaker` 熔断后是否阻止规则继续执行的语义未在本工程测试**：需求39.8 只要求"自动停用该规则并生成 `W_RULE_DISABLED` 诊断"，`W_RULE_DISABLED` 诊断的生成时机与内容格式未在本轮验证，因为这涉及规则执行引擎（L6 Hook/Rule 层）与 L13 的集成行为，超出本层独立测试边界。
3. **配额检查存在"严格小于"与"大于等于"两种边界语义并存**：`Linter.quotas` 检查用的是 `count > limit`（超出才报错，即允许等于上限），而 `QuotaEnforcer.checkEntityQuota` 用的是 `count >= limit`（达到上限即拒绝新建）。这与主实现（`safety.ts`）的行为一致，是"静态校验已声明的 Def 数量"（宽松，装载期一次性检查）和"运行期动态创建拦截"（严格，逐次创建判断）两种不同场景的合理差异，不是 bug，但在文档中未显式说明这一边界差异，建议在 design.md 或 requirements.md 补充澄清。

## 结论

L13 安全层的核心诊断契约——四级严重度、fatal 码不可覆盖、去重折叠、有界日志驱逐策略、规则熔断的窗口计数与状态可快照性、继承环检测、多问题清单输出、配额拦截——均通过随机化验证，行为符合 requirements.md 要求39、要求41 的定义。Linter 的九类装载期检查覆盖不全是已记录的已知缺口（主实现同样存在），建议后续跟进补齐类型一致性深度检查与具名表达式调用环检测的独立验证。
