# L12 持久化层（Persistence）测试报告

> **⚠️ 本报告为历史记录，其核心结论已被 2026-08-07 的验证推翻，请先读 [REPORT.md](REPORT.md)。**
>
> 本文件按非破坏性原则原样保留，因为它本身是一份有价值的反面材料：
> 它记录的 18 项测试全部通过、总随机运行 280,008 次，结论写的是"本轮未发现实现缺陷"——
> 而 2026-08-07 的影子模型对照发现了 **9 个产品缺陷**（BUG L12#1 ~ #9），
> 本报告下方 18 个测试入口无一能发现它们中的任何一个。
>
> 已知需要更正的四处：
> 1. **"发现的 Bug：本轮未发现实现缺陷"不成立**。实际有 9 个：快照/检查点/相位边界
>    三处别名泄漏、同版本装载返回入参引用、bestEffort 跳过不留诊断、
>    畸形版本号被静默折成 `0.0.0`、链未达目标仍报 `ok:true`、`replay` 不克隆 seed。
>    见 REPORT.md 第三节。
> 2. **属性 2「replay 确定性回放」的 100,000 次不构成回放正确性的证据**：其断言是
>    "同一 seed + 同一 Op 序列两次调用结果相同"，对任何确定性无副作用函数恒真，
>    连"完全不回放、直接返回 seed"也能通过。见 REPORT.md 第一节。
> 3. **属性 1「快照原始状态不变」的 100,000 次到不了缺陷**：其生成器产出的 Op
>    全是 `{...s}` 纯拷贝，永不原地写。于是 BUG L12#9（`replay` 不克隆 seed）
>    在该样本空间里**不可能发生**——断言写了，但它不可能失败。
>    补一个原地写的 Op 之后第 1 步即暴露。见 REPORT.md 第一节。
> 4. **"Spec 缺口"第 1 条所描述的 bestEffort 语义已被修正**：原文称
>    "bestEffort 失败时……若后续 migration 的 `from` 与当前实际 version 不匹配，
>    则整条链在该处断裂，最终返回 `ok: false`"。实际实现当时是**静默返回 `ok: true`**
>    （BUG L12#6/#8），现已补上 `W_MIG_SKIPPED` 诊断与未达目标版本守卫。
>
> 下方原文未作任何删改。

## 概述

- **层级**：L12 引擎层 — 快照/日志/回放/迁移（Persistence & Migration）
- **对应需求**：requirements.md 要求37（持久化、回放与回溯）、要求38（版本迁移）
- **测试目录**：`kernel-l12-test/`（独立测试工程，与 `src/core/kernel/persistence/` 主实现并行，遵循 L8~L11 已建立的独立测试工程模式）
- **测试文件**：`test/l12-property.test.ts`
- **测试框架**：vitest 2.x + fast-check 3.x
- **执行结果**：18/18 测试通过，0 失败
- **总断言运行次数**：280,008 次（10 项属性测试 × 各自 numRuns 之和 = 280,000，加 8 项边界/回归测试）

## 被测实现

- `src/persistence.ts`：`WorldState`、`Op`、`Journal`（append/getAll/since/trim/clear）、`takeSnapshot`/`cloneState`、`replay`、`CheckpointStore`（checkpoint/restore/has/list/remove）、`PhaseBoundaryLog`（markBoundary/rewind(n)/count）
- `src/migration.ts`：`compareVersions`（semver-lite 三段式比较）、`loadSnapshot`（要求38.2-38.6 四分支版本迁移逻辑）、`findMigrationChain`（BFS 多跳迁移链查找）

## 属性测试清单

| # | 属性 | numRuns | 结果 |
|---|------|---------|------|
| 1 | 任意 Op 序列 replay 后，`takeSnapshot` 捕获的原始状态不受影响 | 100,000 | PASS |
| 2 | replay 确定性——同一 seed + 同一 Op 序列多次 replay 结果一致 | 100,000 | PASS |
| 3 | `Journal.trim(n)` 保留最后 n 条记录 | 10,000 | PASS |
| 4 | checkpoint/restore 往返一致 | 10,000 | PASS |
| 5 | `compareVersions` 自反性（同版本比较为 0） | 10,000 | PASS |
| 6 | `compareVersions` 反对称性 | 10,000 | PASS |
| 7 | 存档版本 == 当前版本时直接恢复，不调用任何迁移 effect | 10,000 | PASS |
| 8 | 存档版本高于当前版本时一律拒绝（`E_MIG_NEWER_SAVE`） | 10,000 | PASS |
| 9 | reject 模式下迁移失败整体回滚，不产生部分应用状态（对应 tasks.md Property 28） | 10,000 | PASS |
| 10 | `PhaseBoundaryLog.rewind(n)` 返回正确的历史边界状态，越界/非法输入抛出明确错误 | 10,000 | PASS |

## 边界/回归测试清单

| # | 场景 | 结果 |
|---|------|------|
| 1 | 存档较旧但无迁移链时拒绝（`E_MIG_NO_PATH`） | PASS |
| 2 | 单跳迁移链成功执行 effects 并更新 version | PASS |
| 3 | 多跳迁移链按序拼接执行 | PASS |
| 4 | bestEffort 模式下失败的 migration 被跳过，不抛出未捕获异常 | PASS |
| 5 | restore 不存在的 checkpoint 抛出 `E_PERSIST_CHECKPOINT_NOT_FOUND` | PASS |
| 6 | `CheckpointStore.list()` 按创建顺序返回标签 | PASS |
| 7 | `remove` 后 `restore` 该 label 抛出异常 | PASS |
| 8 | `Journal.since(0)` 与 `since(负数)` 均返回全部记录 | PASS |

## 发现的 Bug

本轮未发现实现缺陷。18 项测试（10 项属性测试共 280,000 次随机运行 + 8 项边界测试）全部一次性通过，未触发任何失败用例。

## Spec 缺口与设计澄清记录

1. **bestEffort 迁移失败后的链路语义未在 requirements.md 中显式定义**：要求38 只定义了 `onFail: 'reject' | 'bestEffort'` 两种模式，但未说明当 bestEffort 模式的某个 migration 失败、导致 version 未能推进到下一跳时，后续 migration（其 `from` 字段对应的是"理论上应达到的版本"）应如何处理。当前实现选择：bestEffort 失败时跳过该 migration、保留失败前状态，version 不更新；若后续 migration 的 `from` 与当前实际 version 不匹配，则整条链在该处断裂，最终返回 `ok: false`。这是一个可接受但非规范强制的语义选择，已在测试注释中记录，建议后续在 requirements.md 中补充明确定义。
2. **AI 搜索三项隔离保证（影子随机流、强制 visibleTo、静默相位后展示订阅）未在本层测试覆盖**：要求37 提到的 checkpoint/restore 用于"AI 搜索"场景，但隔离保证涉及 L9（Phase/Flow）和呈现层订阅机制，属于跨层集成行为，超出 L12 独立测试工程的边界，建议在集成测试或 L13 阶段验证。
3. **快照的"结构共享"（structurally-shared）要求未做专门的引用共享断言**：当前 `cloneState`/`takeSnapshot` 测试验证的是"值不变"（深度相等），而非"底层对象引用是否被结构共享以优化内存"。这是性能优化范畴的性质，不影响正确性断言，故未在属性测试中单独验证。

## 结论

L12 持久化层的核心机制——快照捕获、Op 序列回放、Journal 裁剪、checkpoint 往返、版本比较、四分支迁移决策、事务式迁移回滚、相位边界回溯——均通过高强度随机化验证，行为符合 requirements.md 要求37、要求38 的定义。未发现需要修复的实现缺陷，仅记录两项面向未来的 spec 澄清建议。
