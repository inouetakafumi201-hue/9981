# CaS 缝隙闭合（component-slot gap closure）— Tasks

## Introduction

把「CaS 缝隙闭合」从两条并列、规则不同、无单一依赖的实现，收敛为单一权威判定函数 + 单一权威诊断码 + 生产态组合路径可观察入口；并用属性测试锁死不回归。范围严格限于校验入口扩展 + 新增测试；**不改任何 `src/class/*/index.json` 与 `src/play/profiles/*` 目录数据**，不跨线改写 AI 交付物。

实现语言：TypeScript（与 `src/l2` / `src/play` 一致，fast-check 用于属性测试）。

## Tasks

### Checkpoint: 落地前就绪（写权已放开？）

> 本 spec 会改动 `src/l2/model/**`、`src/play/profiles/audit.ts`、`src/play/__tests__/profile-composition.test.ts`、新增 `test/l2/properties/cas-field-alignment.property.test.ts`。其中 `src/play/**` 与 `src/class/**` 是跨线交付物，需用户在策略上放开写权（与 PT-12 同处置，requirements.md T-CaS-04）。未授权前执行到任务 2 即可，任务 3/4 停驻为交接。

#### C1. 就绪核对机检
- 确认 `src/play` 对 `src/l2` 零 import（`grep -rn "from.*l2" src/play/ | grep -i composition` 空）。
- 确认 `src/l2/model/diagnostic-codes.ts` 无 `CAS_FIELD_GAP`（grep 空）。
- 确认 `src/play/profiles/audit.ts` 发射 `PLAY-REF-KERNELOPS-FIELD-GAP`（字面量存在）。
- _要求：Requirement 5.1, 5.3_

### 任务 1：单一权威字段匹配判定函数

- [ ] 1-1. 在 `src/l2/model/cas-field-alignment.ts`（新增）实现 `caSFieldMatches(scopeField, declaredParams): CASchemaOutcome`，返回 `'match' | 'no-match' | 'not-applicable'` 三态。
- [ ] 1-2. `not-applicable` 覆盖：kernelOps scopeField 无括号、括号内空、结尾无右括号 → 恒 `not-applicable`，不外报 CaS 缝隙（Req 1.5）。
- [ ] 1-3. `match` 覆盖：`fieldHint===declared` 或 `prop.<declared>` 或 `<declared>.<nested>` 或 `<nested>.<declared>`（宽松前缀，H-ECSP-01 受测固化）。
- [ ] 1-4. 其余（fieldHint 非空、带括号、但不在 D 同义形态内）→ `no-match`。
- [ ] 1-5. 导出 `CaSFieldGapFinding` 类型（code/sourceId/jsonPath/reason）。
- _要求：Requirement 1.1, 1.4, 1.5, 3.3_

### Checkpoint: 任务 1 通过
- [ ]* C2. 属性测试（预置，验证）`test/l2/properties/cas-field-alignment.property.test.ts`：
   - **属性 1: [匹配判定全称一致（跨路径确定性）]** — `*对于任何* scopeField s、声明集合 D，从 src/l2/validation 与 src/play 两入口调用都返回同一判定。`
   - **验证：Requirement 1.1, 1.2, 3.2**
   - **属性 2: [匹配判定三态且与声明严格对应]** — `*对于任何* s、D，三态恰一；裸 Op→not-applicable；同义形态→match；否则→no-match。`
   - **验证：Requirement 1.4, 1.5, 3.3**
   - `fc.assert` 包裹（fast-check 3.23 同步属性必须经 `fc.property`），`numRuns: 100`，标签 `Feature: wakeup-cas-gap-closure, Property N: <title>`。
- _要求：Requirement 1.4, 3.1, 3.3_

### 任务 2：单一权威诊断码

- [ ] 2-1. 在 `src/l2/model/diagnostic-codes.ts` 增加 `CAS_FIELD_GAP: 'CAS_FIELD_GAP'`。
- [ ] 2-2. 保留 `PLAY-REF-KERNELOPS-FIELD-GAP` 为废弃读取别名（向后兼容），不再作为生产态发射码。
- [ ] 2-3. 断言 `caSFieldMatches` 从 `src/l2/model` 被 import（单一权威来源，禁止在 play 侧再内联一套）。
- _要求：Requirement 1.3, 3.3_

### 任务 3：play/class 组合路径 + 校验入口消费单一源

> 属 `src/play/profiles/audit.ts`、`src/class/class-contract.ts`、`src/play/__tests__/profile-composition.test.ts` 跨线交付物。#需用户在策略上放开写权（T-CaS-04）；授权前本任务停驻为交接。

- [ ] 3-1. `src/play/profiles/audit.ts::auditKernelOpsAlignment` 改调 `caSFieldMatches`；对 `no-match` 发射核心码 `CAS_FIELD_GAP`（保持 jsonPath/reason 稳定）。
- [ ] 3-2. 删除 `audit.ts` 中 `PLAY-REF-KERNELOPS-FIELD-GAP` 字面量发射点；保留废弃别名读取（Req 1.3 / 5.3）。
- [ ] 3-3. `src/play/__tests__/profile-composition.test.ts`：既有 `PLAY-REF-KERNELOPS-FIELD-GAP` 断言改为 `CAS_FIELD_GAP`；新增对该码的正向（字段缝隙确实报）与反向（裸 Op 不报）可观察断言（Req 2.3 / 属性 4）。
- [ ] 3-4. （可选，若不阻塞）`src/class/class-contract.ts` 对 capability 的 `parameters`/`kernelOps`/`compositionKind` 与 ECS `ComponentContract` 做机器对齐；不一致发 `COMPONENT_ID_CONFLICT` 或同类码；否则登记 T-CaS-01。
- [ ] 3-5. 新增 / 扩展属性测试覆盖 `CAS_FIELD_GAP` 与数值归属不互相吞并（属性 3）：`只要 fieldHint 不在活动能力 parameters 且不在 playLayerOwnedFieldNames，就报 CAS_FIELD_GAP`。
- _要求：Requirement 1.2, 2.1, 2.2, 2.3, 4.1, 4.2_

### Checkpoint: 任务 3 通过（全量路径零回归）
- [ ]* C3. 属性测试 `test/l2/properties/cas-field-alignment.property.test.ts` 补属性 3/4：
   - **属性 3: [CaS 缝隙与数值归属不互相吞并]** — 覆盖 4.2 不变量。
   - **属性 4: [全量路径零回归（真实目录不新增 CAS_FIELD_GAP）]** — `*对于任何* 真实 class 目录能力的 kernelOps（裸 Op），caSFieldMatches→not-applicable；该收敛不向既有真实组合新增 CAS_FIELD_GAP。`
   - **验证：Requirement 4.2, 5.4**
- _要求：Requirement 4.2, 5.4_
- [ ] 3-6. 跑 `npx vitest run test/l2/properties/cas-field-alignment.property.test.ts src/play/__tests__/profile-composition.test.ts` 确认绿。

### Checkpoint: 全量门禁与收尾

- [ ] C4. `npx tsc --noEmit` → 0 error。
- [ ] C5. `npm run lint` → 0 error（warning 不高于基线）。
- [ ] C6. `npm run verify:docs` 与 `npm run verify:data` → 全过。
- [ ] C7. `npx vitest run test/toolchain/spec-document-discipline.test.ts` → 8/8 绿。
- [ ] C8. 向 `SOURCE_TRACING_ADOPTION` 登记 `.kiro/specs/wakeup-cas-gap-closure/requirements.md` 为 `not-adopted`（接受标准体，无逐条 footer）。
- _要求：Requirement 5.1, 5.2_

### 任务 4：审计与交接登记

- [ ] 4-1. 全量 `npx vitest run`（含既有 3165 范围）确认唯一红是 `combat-first` 阶段2；如实登记为 AI 并行线交接项 T-CaS-03（Req 5.4）。
- [ ] 4-2. `git status --porcelain` 核实白名单外无改动：`src/class/*/index.json`、`src/play/profiles/*` 目录数据未改（Req 5.3）。
- [ ] 4-3. 完成 prompt→artifact 审计：每条 Requirement 1–5 对应一个实现/测试/门禁证据，无模糊表述；Q 记录完备。
- _要求：Requirement 5.3, 5.4, 5.5_

## Notes

- 不新建重复的数值归属 PBT；复用 `ecs-play-alignment.property.test.ts` 既有命名/字段 PBT，仅扩展属性 3/4（Req 4.3，避免重复）。
- `caSFieldMatches` 是全仓库唯一 CaS 判定函数；任何层发现第二份内联"宽松前缀"都应该指向它（Req 1.2/3.2）。
- 若不授权写权，交付物 = 本三件套文档 + `src/l2/model/cas-field-alignment.ts`（src/l2 不属跨线黑名单）+ 属性 1/2 测试；play/class 接线与属性 3/4 停驻为交接 T-CaS-04。
