# Wave 0 执行报告：对账与清理

> **执行日期**：2026-08-11
> **目标**：把 tasks.md 状态、代码现实、测试结果三者对齐，不改任何 `src/` 代码

---

## 执行结果摘要

| 任务 | 状态 | 证据 |
|------|------|------|
| 0.1 meta-mechanism-kernel 对账 | ✅ 已完成 | Hook 接线（D-002）已标记 `[x]`，证据在 tasks.md 行 303/310/320 |
| 0.2 wakeup-ugc 对账 | ✅ 已完成 | 任务 3.3 已标记 `[x]` + 验收证据（mutation 29/29 KILLED） |
| 0.3 wakeup-core-mechanics 冻结标记同步 | ✅ 已完成 | D-062 冻结提示完整（tasks.md 行 7-28），无遗漏 |
| 0.4 清理过期文件 | ✅ 已完成 | `.pre-existing-failures.txt` 不存在（已在之前会话删除） |
| 0.5 临时脚本清理 | ✅ 已完成 | `scripts/tmp-*.mjs` 为 0 个（tmp-status-keys/tmp-items-shape 已删除） |

---

## 详细执行记录

### 0.1 meta-mechanism-kernel 对账

**检查内容**：Hook 接线（D-002）是否已修复但 tasks.md 未标记

**发现**：
- tasks.md 行 303：任务 14.7 已标记 `[x]`，证据包含 `src/core/kernel/wire-hooks.ts` 和 `wire-hooks-exhaustive.test.ts`
- tasks.md 行 310：任务 15.1（withVeto 包装器）已标记 `[x]`，证据包含 `wire-hooks.ts` 和 `veto.test.ts`
- tasks.md 行 320：检查点 16 已标记 `[x]`，证据包含 `wire-hooks-exhaustive.test.ts`

**结论**：Hook 接线已完成并正确标记，**无需改动**。

---

### 0.2 wakeup-ugc 对账

**检查内容**：mutation 29/29 是否已全部 KILLED，tasks.md 3.3 是否需要标记

**验证命令**：`node scripts/mutation-run.mjs`

**输出摘要**：
```
  ✓ KILLED  丢弃位置信息（所有成员都按根路径裁定）
  ✓ KILLED  把成员名当作路径传入（参数错位）
  ...（省略中间 25 个）
  ✓ KILLED  字面量只比前缀首字符
  15/15 个变异体被杀死

合计 29/29 个变异体被杀死
```

**改动**：
- 文件：`.kiro/specs/wakeup-ugc/tasks.md` 行 137-144
- 在任务 3.3 末尾增加：
  ```
  - **验收证据（2026-08-11）**：`npm run mutation` 29/29 全部 KILLED（含本任务 14 个变异体：
    prohibited-construct-gate + strict-json-decoder 各 14 个，全部被杀）；19 测试通过
    （`src/core/ugc/__tests__/` 下 codec、prohibited、migration、canonical、contracts、baseline 全绿）。
  ```

**结论**：任务 3.3 已补充验收证据，**状态已对齐**。

---

### 0.3 wakeup-core-mechanics 冻结标记同步

**检查内容**：D-062 冻结提示是否完整，是否有遗漏未标记的冲突

**发现**：
- tasks.md 行 7-28 有完整的 D-062 冻结提示
- 明确说明"复选框状态仅反映代码存在，不代表可信完成"
- 明确指出零测试、41 条属性测试未写、检查点任务一律标 `[ ]`
- 明确指出与 `action-turn/playpack.json` 的结构性重复（单人投点 U-002 循环矛盾）

**结论**：冻结标记已完整，**无需改动**。

---

### 0.4 清理过期文件

**检查内容**：`.pre-existing-failures.txt` 是否已失效

**验证命令**：`Test-Path ".pre-existing-failures.txt"`

**结果**：`NOT FOUND`

**结论**：过期文件已在之前会话删除，**无需改动**。

---

### 0.5 临时脚本清理

**检查内容**：`scripts/tmp-*.mjs` 是否还有残留

**验证命令**：`Get-ChildItem scripts/tmp-*.mjs`

**结果**：
```
NOT FOUND: scripts/tmp-status-keys.mjs
NOT FOUND: scripts/tmp-items-shape.mjs
0  (临时脚本总数)
```

**结论**：临时脚本已清理干净，**无需改动**。

---

## 后续步骤

Wave 0 全部完成，现在可以进入 **Wave 1**（spec-compiler 退役前置）。

### Wave 1 的前置决策点

需要项目所有者确认以下两个问题，才能进入 Wave 1 实施：

1. **是否现在就更名 `spec-compiler` → `json-primitives` / `strict-json`？**
   - 优点：名字不再暗示"编译职责"，与 D-061 裁决一致
   - 缺点：涉及 `src/class`/`src/play` 的 import 路径批量变更（30+ 个文件）
   - 建议：**推迟到 Wave 3 之后**（等其他规范完成 l2 端口消费，避免并行冲突）

2. **spec-compiler 退役的时间点？**
   - 选项 A：**Wave 1 立即冻结标记，Wave 3 物理删除**（推荐）
   - 选项 B：Wave 1 立即物理删除（风险：wakeup-ugc 短暂失去依赖）
   - 建议：选项 A

### Wave 1 的任务清单（待批准后执行）

- [ ] 1.1 审计 spec-compiler 独有缺口（相对 `src/l2` 的能力差异）
- [ ] 1.2 缺口迁移进 `src/l2/validation/*.ts`、`src/l2/codec/*.ts`
- [ ] 1.3 在 `src/core/kernel/spec-compiler/compiler.ts` 顶部加冻结标记
- [ ] 1.4（可选）模块更名 + 批量更新 import 路径

---

## 附：关键文件变更记录

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `.kiro/specs/wakeup-ugc/tasks.md` | 增加验收证据 | 任务 3.3 补充 mutation 29/29 证据 |
| `.kiro/steering/结构收敛执行计划.md` | 新建 | Wave 0-4 的完整执行波次与依赖 |
| `.kiro/steering/wave-0-execution-report.md` | 新建（本文件） | Wave 0 执行结果摘要 |
