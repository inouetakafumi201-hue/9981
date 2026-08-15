# CaS 缝隙闭合（component-slot gap closure）— Design

## Overview

本设计的核心是把「CaS 缝隙（组件字段名 ↔ System 参数名同指一个取值、却无机器校验落到同一通路）的机器闭合」从 **两条并列、规则不同、无单一依赖的实现** 收敛为 **单一权威判定函数 + 单一权威诊断码 + 单一消费链**，并把该收敛接到 **`src/play/profiles` 生产态组合路径**（即 `auditClassLayerReferences` 的进入点）。

现状（代码取证，见 requirements.md Introduction）：

1. `src/l2/validation/composition-alignment-rules.ts::validateCompositionAlignment` 自述闭合 CaS 缝隙，实际只做 parameter 非空 name 形状 + `compositionKind` 四形 + `kernelOps` 字符串数组/命名规范；字段↔参数名同轨断言**不存在**；op 存在性显式留 H-ECS-03。消费者是 spec-compiler，不进 play/class。
2. `src/play/profiles/audit.ts::auditKernelOpsAlignment` 真正做字段↔参数名对齐，用「宽松前缀匹配」（`prop.<field>`、`<field>.<nested>`、`<nested>.<field>` 视为同槽位），发射字符串字面量 `PLAY-REF-KERNELOPS-FIELD-GAP`；但 `kernelOps`/`parameters` 来自 `catalog.ts::readCompositionContract` 的 **class-catalog 原始形状**，非 ECS `ComponentContract`。宽松/严格取舍记于 `src/l2/决策与风险记录.md` §7.5 的 H-ECSP-01，未升格为受测单一源。
3. `src/play` 对 `src/l2` **零 import**；`src/class/class-contract.ts` 与 ECS 是**两套并列契约模型**（`ClassCatalogCapability[semanticFamily, compositionKind?]` vs `ComponentContract[familyId, playLayerOwnedFieldNames, kernelOps]`）。

本设计不重写既定 ECS 语义、不改任何目录数据，只把"CaS 缝隙闭合"这条断言做成单一权威、可测、可在生产态组合路径观察的契约件。

## Architecture

```
                 ┌─────────────────────────────────────────────┐
                 │  src/l2/model/  CONTRACT SINGLE SOURCE       │
                 │   diagnostic-codes.ts  (add CaS_GAP +        │
                 │     states: match/nomatch/N/A)               │
                 │   cas-field-alignment.ts  (NEW authoritative │
                 │     match function ~ frozen rule)            │
                 └──────────────┬──────────────────────────────┘
                                │ imports only the frozen fn + codes
                 ┌──────────────▼──────────────────────────────┐
                 │  src/l2/validation/composition-alignment-    │
                 │  rules.ts  validateCompositionAlignment      │
                 │   → delegate the field↔param verdict here    │
                 └──────────────┬──────────────────────────────┘
                                │ (spec-compiler E path; optional)
                 ┌──────────────▼──────────────────────────────┐
                 │  src/play/profiles/ (production combo path)  │
                 │   audit.ts::auditKernelOpsAlignment          │
                 │    → import the SAME match fn + SAME code    │
                 │    → emit core CaS_GAP (not loose literal)    │
                 └─────────────────────────────────────────────┘
```

- **权威层（L2 model）**：单一判定函数 `caSFieldMatches(fieldHint, declaredParams)` + 单一诊断码 `CAS_FIELD_GAP`，都从 `src/l2/model` 导出。任何层都只 import 这两个共享件，禁止各自内联同一规则。
- **生产态入口（play combo）**：`auditKernelOpsAlignment` 复用该函数与该码，删除 `PLAY-REF-KERNELOPS-FIELD-GAP` 字面量。因此`src/play` 侧对 CaS 不再有自己的一套匹配规则。为满足 Requirement 2.1（play 消费 src/l2），可选地把 `src/play/profiles/catalog.ts` 的 `readCompositionContract` 转型（或新增断言桥）为从 `src/l2/model` 读取 `ComponentContract` 的稳定端口；本设计先以「由 `src/l2/model` 提供共享判定函数与诊断码」作为最弱但真实的同源消费（见 Requirement 2.1 的唯一承诺），完整单源化（把 `catalog.ts` 变成 `ComponentContract` 读取器）留给 T-CaS-01/02。
- **目录校验层（src/class）**：`class-contract.ts` 现有 `compositionKind` 透传已落地（PT-12）。本 spec 要求 2.2 的「ClassCatalogCapability 与 ComponentContract 对齐」落到 T-CaS-01 交接（需 schema 允许 `familyId` 等，超出本 spec 可自由落地的目录数据约束）。

## Components and Interfaces

### 1. `src/l2/model/cas-field-alignment.ts`（新增，权威判定）

为满足 generate-spec 的组件输入/输出/接口，定义：

```ts
/** 字段匹配的明确三态——供测试断言（Req 3.3）。 */
export const CA_SCHEMA_OUTCOMES = ['match', 'no-match', 'not-applicable'] as const;
export type CASchemaOutcome = (typeof CA_SCHEMA_OUTCOMES)[number];

/**
 * CaS 缝隙闭合的单一来源匹配判定。
 * 沿用 H-ECSP-01 的宽松前缀意图并把它受测固化：
 *  `prop.<field>`、`<field>.<nested>`、`<nested>.<field>` 与声明槽位视为同一通路；
 *  字段引用无括号或空 → not-applicable（裸 Op 不误报，Req 1.5）。
 * 输入：kernelOps 中的一个 scopeField；能力声明的参数名集合（parameters[*].key ∪ parameterNames）。
 * 输出：match / no-match / not-applicable 三态之一。
 * 不变量（Req 3.1/3.4）：对同一 (scopeField, declaredParams)，无论从 src/l2/validation 或 src/play/profiles 调用，都返回同一判定。
 */
export function caSFieldMatches(
  scopeField: string,
  declaredParams: ReadonlySet<string>,
): CASchemaOutcome {
  const openParen = scopeField.indexOf('(');
  const hasOpen = openParen !== -1;
  const closed = scopeField.endsWith(')');
  // 裸 Op / 无字段引线 → 不适用（不外报 CaS 缝隙）。
  if (!hasOpen || !closed) return 'not-applicable';
  const fieldHint = scopeField.slice(openParen + 1, -1);
  if (fieldHint.trim().length === 0) return 'not-applicable';
  // 宽松前缀：与声明槽位任一同义形态匹配。
  const matches = [...declaredParams].some((declared) =>
    fieldHint === declared
    || fieldHint === `prop.${declared}`
    || fieldHint.startsWith(`${declared}.`)
    || fieldHint.endsWith(`.${declared}`));
  return matches ? 'match' : 'no-match';
}
export interface CaSFieldGapFinding {
  readonly code: 'CAS_FIELD_GAP';
  readonly sourceId: string;
  readonly jsonPath: string;
  readonly reason: string;
}
```

### 2. `src/l2/model/diagnostic-codes.ts`（扩展）

增加 `CAS_FIELD_GAP: 'CAS_FIELD_GAP'` 到核心诊断字典；`PLAY-REF-KERNELOPS-FIELD-GAP` 作为废弃别名可保留（向后兼容读取）但生产态不再发射。

### 3. `src/play/profiles/audit.ts`（改写，合并）

把 `auditKernelOpsAlignment` 的字段缝隙判定改为调用 `caSFieldMatches`；命中 `no-match` 时发射核心码 `CAS_FIELD_GAP`（保持 `jsonPath`/`reason` 稳定）。`profile-composition.test.ts` 的既有断言从 `PLAY-REF-KERNELOPS-FIELD-GAP` 改读 `CAS_FIELD_GAP`。

### 4. 生产态可观察进入点

`auditClassLayerReferences` 遍历每个 profile 的每个组合能力，对每个携带字段引线的 `kernelOps` 调 `caSFieldMatches`；因此生产态组合路径的每次迭代都能被测试断言 `CAS_FIELD_GAP` 是否存在（Req 2.3）。

## Data Model

- `CASchemaOutcome = 'match' | 'no-match' | 'not-applicable'`（Req 3.3）。
- `CaSFieldGapFinding`（code / sourceId / jsonPath / reason），与 `audit.ts` 既有 `Finding` 形状一致。
- 诊断码 `CAS_FIELD_GAP` 进入 `src/l2/model/diagnostic-codes.ts`（Req 1.3）。

## Correctness Properties

每个属性都是 `测试/l2/properties/cas-field-alignment.property.test.ts` 的一个 `fc.assert`（`numRuns≥100`，规范标签 `Feature: wakeup-cas-gap-closure, Property N: <title>`）。

**属性 1：匹配判定全称一致（跨路径确定性）**
*对于任何*能力 `kernelOps` 中的 scopeField `s`、任何声明的参数名集合 `D`，*若* `caSFieldMatches(s, D)` 返回 `r`，*则* 从 `src/l2/validation` 与 `src/play/profiles` 两个入口调用都返回 `r`；`src/play/profiles/audit.ts` 组合路径的任何一次迭代对该 `(s, D)` 同样判定。
**验证：Requirement 1.1、1.2、3.2**

**属性 2：匹配判定三态覆盖，且判定与声明严格对应（语义不变量）**
*对于任何* scopeField `s`（含裸 `/带括号`）、任何 `D`：`caSFieldMatches(s, D)` 恰等于 `'match'`、`'no-match'`、`'not-applicable'` 之一；且 `s` 为裸 Op（无括号或空字段）时恒为 `'not-applicable'`；`s` 带括号字段且该字段确在 `D` 的同义形态内时恒为 `'match'` 否则 `'no-match'`。
**验证：Requirement 1.4、1.5、3.3**

**属性 3：CaS 缝隙与数值归属不互相吞并（正交不变量）**
*对于任何* profile 组合能力、任何其 `kernelOps` 字段引用 `f`：*若* `f` 既不在活动能力 `parameters` 声明、又不在 `playLayerOwnedFieldNames` 覆盖，*则* 组合路径针对该 `f` 发射 `CAS_FIELD_GAP`（不被数值归属吞掉）。
**验证：Requirement 4.2**

**属性 4：全量路径零回归（守卫：既有目录与既有组合不被新增诊断破坏）**
*对于任何* 真实 `src/class/*/index.json` 能力与其真实 `kernelOps`（裸 Op 形态）：`caSFieldMatches` 对每个裸 Op 返回 `'not-applicable'`；因此该收敛不向既有真实组合新增任何 `CAS_FIELD_GAP`（若真实目录确实 214 个零括号裸 Op —— 按 H-ECSP-01 记载核实）。
**验证：Requirement 5.4（不引入新的红测于本线目录）**

## Error Handling

- 字段引用携带括号字段但声明集合为空或不含同义形态 → `no-match` → `CAS_FIELD_GAP` 诊断（Req 1.1/4.2）。
- 裸 Op（无括号、空字段、结尾无右括号）→ `not-applicable`，不外报（Req 1.5，不误报）。
- 既有 `PLAY-REF-KERNELOPS-FIELD-GAP` 保留为废弃别名读取，不改任何目录数据（Req 5.3）。

## Testing Strategy

1. 单元 + 属性测试 `test/l2/properties/cas-field-alignment.property.test.ts` 覆盖属性 1–4（`numRuns≥100`，规范标签）。
2. 改写既有 `src/play/__tests__/profile-composition.test.ts` 的 CaS 用例断言码为 `CAS_FIELD_GAP`（Req 1.3），新增对 `CAS_FIELD_GAP` 的正/反向可观察断言（Req 2.3）。
3. 全量门禁：`npx tsc --noEmit` 0、`npm run lint` 0 error、`npm run verify:docs` / `verify:data` 全过、`spec-document-discipline.test.ts` 8/8、相关 `vitest` 目标绿；`combat-first` 阶段2 红测如实登记为 AI 线交接（Req 5.4）。

## 决策记录（Q-题）

| 项 | 裁决 | 依据 |
|---|---|---|
| Q-CaS-01 | 字段归属匹配收敛为**宽松前缀**并受测固化于 `caSFieldMatches`，而非字面相等 | 沿用 H-ECSP-01 意图；属性 1/2 使其全称可断言，消除"仅口头登记、未落地单一源"的状态 |
| Q-CaS-02 | 诊断码收敛为 `CAS_FIELD_GAP`（入 `src/l2/model/diagnostic-codes.ts`），废除 play audit 字符串字面量 | Req 1.3；单一权威诊断码 |
| Q-CaS-03 | `src/play` 对 `src/l2` 的消费从「共享判定函数 + 共享诊断码」起步（最弱真实同源），完整 `catalog.ts` 转 `ComponentContract` 读取归 T-CaS-01 | Req 2.1；避免一步改写 class-catalog 读取导致既有组合回归 |
| Q-CaS-04 | `validateCompositionAlignment` 是否内联调用 `caSFieldMatches`：建议**委托**，否则在 l2 注释声明由本单一实现兜底 | Req 1.1/3.2 / T-CaS-02 |
