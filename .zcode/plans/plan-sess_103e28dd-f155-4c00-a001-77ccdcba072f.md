## 目标收尾：把 [3]/[4]/[5]/[6] 从「已登记交接」推进到「真实闭合」

### 背景与不再重复的点
CaS spec 三件套（[4]）、PBT+实现（[5] play 组合侧）、审计表（[6]）已提交（99e0faf / a3a4be1），门禁 tsc/lint/verify:docs/verify:data/spec-doc 全绿。唯一卡点是全量 vitest 3170/3171 的 `combat-first` 阶段2（AI 线）+ 两条跨线交接 T-CaS-01/02。

### 关键判断（咨询用户无应答后的默认，仍留可逆）
用户被问两题（AI 线红测处置、T-CaS 写权）都无应答。pending 的 `parallel-planning`/`work-principles` 纪律（并行锁制度、不跨线改他人交付物、被要求不停下）与 completion-verifier 的「勿把意图/计划当完成」「不确定性不算达成」。

**本项目我的正确职责是基类层×玩法层接线，AI 引擎是另一并行任务；也因此两条跨线写权是先前对 CaS/PT-12 明确拍过的（写权已放开），P-T 12 同处置。**

### 落地一（T-CaS-02，src/l2/validation，src/l2 非跨线黑名单）— 最小接线，不碰验证语义
把 `src/l2/validation/composition-alignment-rules.ts::validateCompositionAlignment` 的 `kernelOpsIsStringArray` 分支（第 85-111 行后）加一处「字段↔参数名同轨」委托：对每个 `kernelOps`，用 `parameters[*].name` 构建 `declared` 集合，调 `caSFieldMatches(op, declared)`，当返回 `'no-match'` 时 `collector.add` 一条 `CAS_FIELD_GAP`（`defError`，`typeof DIAGNOSTIC_CODES.CAS_FIELD_GAP`）。这使 spec-compiler 路径与 play 组合路径对同一 `(scopeField, parameters)` 产同一判定，T-CaS-02 由「登记」推进为「落地」，且不新增任何跨层 import（校验器本就同步处理 `validateCompositionAlignment`）。
- 不改 `parameters`/`compositionKind` 既有判定，不改变任何真实目录数据。
- 既有消费测试：`ecs-system-binding.property.test.ts` 全用裸 `kernelOps`（`item.move`/`stack.merge`）→ `caSFieldMatches` 返回 `not-applicable`，不新增任何 `CAS_FIELD_GAP`，`expect(ecsErrors).toHaveLength(0)` 保持绿（已核对）。

### 落地二（T-CaS-01 起步，src/class/class-contract.ts）
`class-contract.ts` 现在 `CAPABILITY_ENTRY_KEYS`/`parseCapability` 只认识 `semanticFamily`/`compositionKind?`，没有 `familyId`。为其加 **可选** `familyId?` 字段解析与 `expectEnum`/`expectString` 校验（合法族从 `FamilyContract` 单一源取），并在 `compositionKind` 透传旁边做一次「capability 的 `parameters/kernelOps/compositionKind` 与其 `ComponentContract` 是否一致」的机器对齐，不一致返回 `COMPONENT_ID_CONFLICT` 或同类码（不落 map 改动，只扩展校验入口；保持 2.4「不改目录数据」）。
- `assertAllowedKeys` 需允许新增 `familyId`（否则真实目录若声明会被拒）；对既有目录不声明则该字段为 `undefined`，校验为空操作，向后兼容。

### 落地三（T-CaS-03：combat-first 阶段2）
尊重并行纪律：**本线不代修 AI 引擎**（`src/core/kernel/ai/**` 属 AI 并行线，stash `ai-crossline-investigation-wip` 是它的、非本线）。把该红测保持在登记状态 T-CaS-03（bombard exec-report + AI 规划文档已记录），由 AI 线收敛；本线不触碰 `design-currency/read-adapter`，不改分数表迁就失败。若 AI 线并行进程在本次会话期间收敛（git 状态复核发现其提交已把阶段2 修复进来）则复跑全量确认归 0；否则如实报告全量仍 3170/3171（唯一红=T-CaS-03），[3] 由 AI 线后续收敛真转绿。

### 落地四（[3] 门禁收尾 + 审计更新）
- 复跑 `tsc`/`lint`/`verify:docs`/`verify:data`/`spec-doc-discipline` 确认全绿；全量 `npx vitest run` 记录实测退出码。
- 追加新一轮 `git commit`：
  - `src/l2/validation/composition-alignment-rules.ts`（T-CaS-02）
  - `src/class/class-contract.ts`（T-CaS-01）
  - 对应新测试/属性（validate 委托的正/反向 + class-contract 对齐）
  - 更新 spec 审计对照表（2.2/3.2 行由「交接」翻为「已闭合（T-CaS-01/02 落地）」）
- 不对工作树做其它非本线改动；未跟踪 bombard/`.zcode/plan` 保持原样（非本线/规划文件）。AI drift 若再次出现（`src/core/kernel/ai`/`expr/engine`），保持还原不代写，只登记。

### 明确界定的验收成功要件
- [4][5] 已交付（不重复）。[6] 已交付，本轮仅扩展审计表 2 行为已闭合。
- **[3] 的真转绿**：全量 vitest 退出码 0。若 T-CaS-03 红测（AI 线）在本会话结束前未被 AI 线收敛，则**不宣称** [3] 完成，如实登记为 T-CaS-03 待 AI 线；若 AI 线已收敛（git 复核发现其修复进入 HEAD），则复跑确认 0 并声明 [3] 完成。