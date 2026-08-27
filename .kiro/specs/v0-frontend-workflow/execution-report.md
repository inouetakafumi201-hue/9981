# V0.dev 前端壳层生产规划 - Prompt Pack 结构同步执行报告

> 执行日期：2026-08-20
> 任务性质：Prompt Pack 独立命令化优化（入口、manifest、静态校验与 spec 合同同步）
> 本次写入边界：Prompt Pack 入口与 manifest、Prompt Pack 静态校验器，以及 `.kiro/specs/v0-frontend-workflow/requirements.md`、`design.md`、`tasks.md`、`deliverables/03-batch-plan.md`、`execution-report.md`；未修改前端业务源码、后端规则或其他 Spec 交付物。

## 一、此前结构同步基线

此前报告记录过 Prompt Pack 的页面、控制面、素材和失败态结构；其中 `deliverables/01-scope-and-pages.md` 与 `deliverables/02-control-surface.md` 属于历史阶段交付物，本次未修改。

本次优化实际写入以下范围：

- `prompts/00-PROMPT-PACK-README.md`：增加独立命令模式、现有项目检查/复用规则和可选深度附件说明。
- `prompts/00-prompt-pack-manifest.json`：登记独立执行模型、命令入口、同目录附件和非阻塞会话依赖字段。
- `prompts/01-shell-startup/` 至 `prompts/07-motion-polish/` 的七个 `B*-00` 入口：增加独立执行合同、机器标记和非阻塞依赖语义。
- `scripts/verify-prompt-pack.mjs`：校验 manifest 独立执行字段、入口路径、同目录附件和逐批次命令标记。
- `requirements.md`：新增独立命令结构与 Requirement 13，明确 B-00 最小投喂、可选深度附件、非阻塞交接、现有前端复用和命令写锁。
- `design.md`：更新独立命令拓扑，补充 `PromptPacket`、`executionMode`、`dependsOn` 非阻塞语义、最小挂载点补齐和改动报告字段。
- `deliverables/03-batch-plan.md`：更新批次表、最小投喂规则、可选深度附件和依赖解释。
- `tasks.md`：增加并勾选独立命令合同/静态校验任务，保留实际独立投喂验证为未完成项。
- `execution-report.md`：记录本次优化范围、验证结果和未完成项。

## 二、已保留的用户裁决

- `editor`、`research-bench`、`material-library`、`computer` 内部 UI 仍 out-of-scope；驻地只保留入口占位。
- 素材允许使用并且可以成为壳层的一部分；素材缺失走语义 fallback，不以“零素材”作为目标。
- HUD MVP 只开放 `0 / 1 / 2`；`+3极限爆发` deferred、不可选，但 selection/trigger effect 保留。
- 标题画面完整包含新游戏/继续/选项/退出；暂停菜单完整包含继续/设置/重新开始/返回标题。
- `床 = 装载入口`、`纯白显形唯一传送`、新游戏先进入出租屋等旅程约束未被放宽。

## 三、当前完成与保留项

1. 现有 Prompt Pack 的 Batch 0/G-01..G-08、B1..B7 和参考附件状态沿用历史基线；它们在本次合同中均不再是 B-00 命令启动前置。单独命令实际投喂仍待完成。
2. `references/assets/asset-manifest.json` 中 A-203 仍为历史 tier 参考；A-301 是标题画面文字提示词，实际标题 PNG 保持 pending，未虚报生成。
3. B-00 的“独立执行”已由入口自然语言合同、固定 HTML 命令标记、manifest 字段和 `verify-prompt-pack.mjs` 静态校验共同约束；未建立运行时代码校验，因为本任务交付物是投喂合同，不是前端运行时。

## 四、历史基线验证状态

以下结果是此前结构同步阶段的历史记录，不替代本次独立命令合同优化的待跑验证。

- `npm run verify:prompt-pack`：通过。
- `npm run verify:docs`：通过。
- `npx tsc --noEmit`：通过（exit 0）。
- `npx vitest run`：历史基线记录为通过（3618 tests passed，0 failed）。
- `npx vitest run test/toolchain/spec-document-discipline.test.ts`：通过（8 tests passed）。
- `npm run lint`：通过（exit 0），保留仓库既有 157 条 warning、0 errors；本阶段未修改这些既有代码问题。
- `git diff --check`：通过。

## 五、本次独立命令合同优化（2026-08-20）

本次实际完成：

- 在 `requirements.md` 将 B1-B7 的 `B{n}-00` 与同目录 briefs 定义为独立命令；将 Batch 0/G-01..G-08、R-*、参考资产和前序批次能力改为可选、非阻塞深度附件，并新增 Requirement 13 独立性验收。
- 在 `design.md` 将批次拓扑改为独立命令模型，新增 `PromptPacket` 的 `globalSummary`、`reuseGuidance`、`writeBoundary`、`minimalMountPointCompletion`、`changeReportFields` 和 `executionMode`，并明确 `dependsOn` 只表示非阻塞交接顺序。
- 在 `deliverables/03-batch-plan.md` 更新批次表、最小投喂规则、已有前端代码复用、范围写锁、缺失挂载点最小补齐和改动报告要求。
- 在 `tasks.md` 增加并勾选独立命令合同/校验任务，另保留未勾选的实际独立投喂验证任务。
- 本次同步修改了 Prompt Pack 的入口、manifest、静态校验器，以及用户指定的五个 spec 文档；未修改前端业务源码、后端规则或其他 Spec 交付物。

- [x] `npm run verify:prompt-pack`：通过。
- [x] `npm run verify:docs`：通过。
- [x] `npx tsc --noEmit`：通过（exit 0）。
- [x] `npx vitest run`：首次全量运行出现 1 个既有随机属性失败（`bombardment-l2-expr.property.test.ts`，随机表达式命中宿主原型 `valueOf`，返回原生函数而非 `Value/null`）；单文件复跑通过，随后全量复跑通过（390 files / 3618 tests）。该失败未涉及本次文档/Prompt Pack 变更。
- [x] `npm run lint`：通过（0 errors，157 existing warnings）。
- [x] `npx vitest run test/toolchain/spec-document-discipline.test.ts`：全量复跑中通过（8 tests）。
- [x] `git diff --check`：目标差异通过；工作树中其他既有改动未纳入本次范围。
- [ ] 逐个在无 Batch 0、无前序批次产出、无对话记忆的条件下实际投喂 B1-00 至 B7-00 及同目录 briefs，并记录复用、写锁、最小补齐和改动报告。
- [ ] 确认工作树中本次新增差异仅属于本次优化目标文件；仓库已有其他未提交改动不纳入本次优化。