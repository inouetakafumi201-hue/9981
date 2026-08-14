# FROZEN 标记（spec-compiler 冻结引用件）

> **冻结时间**：2026-08-12（D-061 架构裁决）
> **归属**：本文件是该目录状态的**独立引用标记**。规范代码层面的冻结陈述见 `compiler.ts` 顶部注释，本文件将其提炼为可被引用、可校验的真相载体。
> **状态**：🔒 冻结（不再接受新功能或优化），等待物理删除（Wave 3 前置）。

---

## 一、冻结政策

`src/core/kernel/spec-compiler/` 被判为与 `src/l2` 重复实现（D-061 架构裁决），执行状态冻结。

| 状态 | 政策 |
|---|---|
| ✅ 已完成 | 引擎层基础设施迁出（Phase 1，`src/core/kernel/codec|state|security`） |
| ✅ 已完成 | 9 个独有缺口识别与迁移方案（落 `src/l2/` 与引擎层） |
| 🔒 冻结 | 本目录文件不再接受新功能或优化 |
| ⏳ 等待 | 其他规范确认已消费 `src/l2` 端口后才执行物理删除（Wave 3） |

新功能落地优先级：
1. 优先落 `src/l2/`（语义层）
2. 其次落 `src/core/kernel/`（引擎基础设施）
3. **严禁**直接改本目录文件（含 `compiler.ts`）

---

## 二、已迁出 / 冻结成果（波次 1）

### 已迁出
- 引擎层基础设施 Phase 1：`src/core/kernel/codec`、`state`、`security`
- 9 个独有缺口识别与迁移方案

### 冻结含义
- `compiler.ts` 不再接受新功能或优化
- 生产代码 `src/class` + `src/play` 的 import 已从本目录割到 `ports/codec/security`（Wave 3 import 迁移）
- 详见 `FROZEN.md` 对应的迁移交接记录与 `docs/L_审查报告/Wave1.2_缺口迁移并行Prompt.md`

---

## 三、Wave 3 物理删除前置

本目录的**物理删除**存在前置条件，未满足前不能删除：

1. 其他规范已确认消费 `src/l2` 端口（不再是"预计会有"）
2. catalog-activation / scene-catalog-activation 的编译/激活运行时桥（当前为 test-only，无 L2 出口）已梳理交接给 `src/l2`
3. schedule / playpack-codec 的 `ParsedCandidateDocument` 扩展已落 `src/l2`
4. 全量测试转绿且无 `src/core/kernel/spec-compiler` 残留引用

> 任一前置未闭合则本目录保持 🔒，不得提前删除。

---

## 四、依据

- `docs/L_审查报告/D-061_spec-compiler_L2_功能差集审计.md`（完整对比）
- `docs/L_审查报告/Wave1.2_缺口迁移并行Prompt.md`（迁移方案）
- 波次计划：`docs/L_归档/steering_历史/PARALLEL_EXECUTION_LOCK.md`（Wave 1）

**联系**：若需绕过冻结，请在架构评审会上讨论修订 D-061。
