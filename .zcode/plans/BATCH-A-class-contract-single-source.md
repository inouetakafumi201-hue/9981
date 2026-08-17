# BATCH A prompt — 基类层×玩法层契约单源化闭环（基线线独占写权）

> 用途：作为一个全新、无上下文的会话的完整指令。你只负责这个批次，须一次做完、不交付 MVP/骨架。
> 项目：WakeUp（D:\coding\WakeUp，Git Bash，node≥20，TypeScript + vitest）。先读 `docs/L0_规范宪法.md` 与 `src/l2/model/composition-registry.ts` 及 `src/l2/model/family-component-shapes.ts`。

## 你的唯一交付物

把「`src/class/class-contract.ts` 的真实型号契约链」与「ECS `ComponentContract`（`src/l2/model/composition-registry.ts`）」这两套**并列契约模型**单源化，并让 **play 侧真正消费** ECS 组件契约，同时对齐**双份 `playLayerOwnedFieldNames`**（类目录 `compositionContract` 层 vs ECS `CompositionShape` 层），用**机器可证伪的结构校验 + PBT** 守住收敛。这是白盒覆盖闭环（T-CaS-01/02 系列）的最后一英里：让每一层契约都有能证伪它的机器检查。

现状要点（已核对，请以工作树为准复核）：
- `src/class/class-contract.ts` 的 `CAPABILITY_ENTRY_KEYS`（:468起）已含 `compositionKind`/`familyId`，`parseCapability` 已用 `expectEnum(COMPOSITION_KIND_KEYS)` + `expectString` 解析（:626-641），但 `familyId` 只是字符串、**未与 ECS `ComponentContract.familyId` 交叉核对**，`playLayerOwnedFieldNames` **根本不在结构校验链里**（数据面 `src/class/*/index.json` 已有它，但契约解析不认）。
- ECS 侧单一源：`src/l2/model/composition-registry.ts` 的 `ComponentContract` `CompositionShape`（有 `playLayerOwnedFieldNames`，:105/:287）、`family-component-shapes.ts`（family-shapes）。
- `src/play/profiles/audit.ts:14` 已唯一消费 `CAS_FIELD_GAP_CODE`/`caSFieldMatches`（:229-238 用 `kernelOps`↔`parameters` 对齐），`catalog.ts:151` 用 `optionalStrings(contract['playLayerOwnedFieldNames'])` 松读。
- `src/class/*/index.json` 的 `compositionContract.playLayerOwnedFieldNames` 与 ECS `ComponentContract.playLayerOwnedFieldNames` 字段同名但链路未接。

## 你要做的事（全部，自给自足）

1. **class-contract 单源成 ECS 形状的校验器（T-CaS-01）**：在 `parseCapability` 里把 `familyId` 从「裸 `expectString`」升级为「可解析 + 与 ECS `ComponentContract`/`family-shapes` 单一源交叉引用」。即：解析出的 `compositionKind`/`familyId` 必须能与 ECS 契约里同族同 kind 的 `ComponentContract` 对齐，`kernelOps`/`parameters`/`playLayerOwnedFieldNames` 与 ECS 形状一致；不一致返回既有诊断码槽位或同类新码（不落任何 map 数据改动）。`playLayerOwnedFieldNames` 纳入结构校验（`assertAllowedKeys` 放行它）。**向后兼容**：既有目录不声明的字段为 `undefined`，校验空操作；`src/class/*/index.json` 一律不改。
2. **play 侧 ECS 消费线（T-CaS-02 到 T-CaS-03）**：让 play 组合侧不再靠「松读 + 内联」重演 ECS 形状，而是**从 ECS 单一源（`composition-registry`/`family-shapes`）读** `playLayerOwnedFieldNames`/`familyId` 做客制字段所有权判定，与 `caSFieldMatches` 收敛到同一套。审计器 `audit.ts` 补齐「能力声明的 `parameters/kernelOps/compositionKind/familyId` 与其 ECS `ComponentContract` 是否一致」的机器对齐（不一致 `CAS_FIELD_GAP` 同类码）。`kernelOpsIsStringArray` 分支（T-CaS-02 起点）并入。
3. **双 `playLayerOwnedFieldNames` 对齐（T-CaS-04）**：类目录 `compositionContract.playLayerOwnedFieldNames` 与 ECS `CompositionShape.playLayerOwnedFieldNames` 必须逐项一致，且与「字段名↔System 参数 slot」判定自洽。对齐失败给结构性诊断码，不静默。
4. **PBT/防回归**：为上述三条各建属性测试（property-based，`numRuns≥100`，用你项目里已有的 PBT 设施；参考既有 `*.property.test.ts` 风格）。防回归断言：真实 `src/class/*/index.json` 全部通过新校验 → **零数据改动下必须全绿**；反例（错误 `familyId`/`compositionKind`/`playLayerOwnedFieldNames` 失配）必须被拒。
5. **更新 spec 审计对照表**：把对应交接行（T-CaS-01/02/03/04，`src/l2/决策与风险记录.md` 与相关 spec 审计表）从「交接」翻为「已闭合（T-CaS 落地）」；如实标注哪些仍属 AI 线。

## 并行锁（严格遵守，否则视为越权失败）

**独占可写**（只动这些）：`src/class/class-contract.ts`、`src/play/profiles/audit.ts`、`src/play/profiles/catalog.ts`（仅若需收紧松读）、`src/class/__tests__/*.ts`、`src/play/__tests__/*.ts`、`test/l2/**` 中与你新增校验直接对应的 property/pose 文件、上述文档审计表。

**只读、绝不改**：`src/l2/model/*`（ECS 单一源，只读）、`src/l2/validation/composition-alignment-rules.ts`（若你发现 T-CaS-02 应在此落地，登记交接并说明，**不代改**）、`src/core/kernel/**`（含 `ai/**`、`expr/**`）、`src/class/*/index.json` 全部、`src/play/profiles/*.json`、所有未跟踪的 plan/bombard 文件。

**禁止全局覆盖**：不改任何数据 JSON、不重构无关模块、不做「顺手清理」。只做收敛本身。

## 门禁（内部自证，全绿才收尾）

依次跑并记录结果：
- `npx tsc --noEmit`
- `npx vitest run`（相关范围；再全量一次，记录退出码与失败明细）
- `npm run lint`
- `npm run verify:docs`
- `npm run verify:data`

新校验下真实数据必须零失败。全量若出现「AI 线」红测（`combat-first` 阶段/`design-currency`）、或未跟踪并行轮子的红，归因并如实报告，**不代修**、不宣称完成。

## 收尾纪律
- 诚实汇报：做了哪几条、哪几条因黑名单未动、新增了哪些诊断码、用了哪些自主合理设计（要标注这是你的判断）。
- 产出可运行代码：任何新入口给一个能跑的用例如注释或测试。
