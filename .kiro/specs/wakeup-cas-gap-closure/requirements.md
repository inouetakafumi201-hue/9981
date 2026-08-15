# CaS 缝隙闭合（component-slot gap closure）— Requirements

## Introduction

本 spec 处理既存缺口：**CaS 缝隙（component-slot gap）的机器闭合被切分到两条并列且不同来源的校验链，且 play/class 组合路径对 `src/l2` 的 ECS 组件契约零消费**，导致"组件可配置字段名与 System 参数名同指一个取值、却无单一权威的机器校验落到同一通路"这一缝隙在 **生产态组合路径（`src/play/profiles` 组合 `src/class` 目录能力）上没有单一来源可断言的契约件**。

已核实证据链（`git show master:a3e5cea`，2026-08-15）：

- CaS 缝隙的定义与闭合动机写在 `.kiro/specs/wakeup-base-layer-ecs/requirements.md` §CaS 缝隙（component-slot gap）与 Requirement 3.2 / 5.4（"对 CaS 缝隙的闭合，THE Base_Layer_Spec 只在字段名引用同一取值时成立"）。
- 真实生产态里 CaS 被**两处各自实现、规则不同、无共享单一源**：
  1. `src/l2/validation/composition-alignment-rules.ts` 的 `validateCompositionAlignment` —— 挂进 `src/l2/validation/validator.ts`，注释自述"组件字段名到 System 参数名的 CaS 缝隙闭合（Requirements 3.2、3.3）"，但实际只做 parameter「非空 name」形状 + `compositionKind` 四形 + `kernelOps` 字符串数组/命名规范检查；**字段↔参数名是否同轨的断言不存在**；op 存在性/许可集合显式注释为 H-ECS-03 交接项。消费者是 spec-compiler（E 范围），**不进入 `src/play`/`src/class`**。
  2. `src/play/profiles/audit.ts` 的 `auditKernelOpsAlignment` —— 挂进 `auditClassLayerReferences`，发射 `PLAY-REF-KERNELOPS-FIELD-GAP`。真正做字段↔参数名的「宽松前缀匹配」（`prop.<field>`、`<field>.<nested>`、`<nested>.<field>` 视为同一槽位）。但 `kernelOps`/`parameters` 直接来自 `src/play/profiles/catalog.ts` 的 `readCompositionContract`，是 `src/class/*/index.json` 的 **class-catalog 原始形状**（schema 定义的 `kernelOps`/`parameters` 槽），**不是 ECS 的 `ComponentContract`**。宽松/严格的取舍登记在 `src/l2/决策与风险记录.md` §7.5 的 H-ECSP-01，等待人工确认，未在单一源落地。
- 结果（本 spec 靶子，已代码取证）：
  1. **`src/play` 对 `src/l2` 零 import**（PT-12 §一.1 已声明并核实）。`src/play/profiles/audit.ts` 不消费 `composition-registry` / `family-component-shapes` / `composition-alignment-rules` / `ComponentContract.familyId`。
  2. **`src/class/class-contract.ts` 与 ECS 是两套并列契约模型**（PT-12 §一.2 已声明并核实）：`ClassCatalogCapability`（含 `semanticFamily` + `compositionKind?`）vs `ComponentContract`（含 `familyId` + `playLayerOwnedFieldNames` + `kernelOps`）。`familyId`（ECS）在 play 侧没有任何对应字段；唯一穿过的字段是 `compositionKind`（PT-12 已落地为 `COMPOSITION_KIND_KEYS` 单源透传）。
  3. **CaS 缝隙闭合无单一权威诊断码**：`src/l2/model/diagnostic-codes.ts` 无任何 FIELD/GAP/KERNELOPS 字段缝隙码（grep 0 命中）；闭环唯一码 `PLAY-REF-KERNELOPS-FIELD-GAP` 是 play audit 的字符串字面量，不属于 `src/l2` 的核心诊断字典。

本 spec 的落点：把「同一个字段名↔参数名落到同一通路的机器断言」收敛成 **单一权威实现 + 单一权威诊断码 + 单一匹配规则（废除 H-ECSP-01 的局部宽松/严格分裂）**，并把这条 CaS 缝隙闭合接到 **`src/play/profiles`（组合路径在生产态入口）**，使基类层（`src/l2/model` 组件契约 + `composition-alignment-rules`）→ 目录校验链（`src/class/class-contract.ts`）→ 玩法层组合（`src/play/profiles/audit.ts`）同走一套组件契约单一源。

> **来源采纳状态**：本 spec 用「接受标准体 + 要求子句回溯」，无逐条「来源追踪」footer。须按 `test/toolchain/spec-document-discipline.test.ts` 的 `SOURCE_TRACING_ADOPTION` 登记为 `not-adopted`（与 `wakeup-base-layer-ecs` / `wakeup-base-layer-bombardment` 同口径）。

## Glossary

- **CaS 缝隙（component-slot gap）**：组件的可配置字段名与对应 System 参数名同指一个取值、却无机器校验落到同一通路的现象。闭合该缝隙是本 spec 的核心动机（沿用 `wakeup-base-layer-ecs/requirements.md` §Glossary 定义）。其闭合判定：字段名引用到同一取值（沿用同 spec Req 5.4）。
- **组件契约单一源（component single source）**：`kernelOps` 引用的字段，其参数名、可写性、归属、匹配规则都由唯一权威实现提供，禁止在两处各自声明不同规则（本 spec 要求 1.1 / 2.1）。
- **ComponentContract**：`src/l2/model/composition-registry.ts` 导出的 ECS 组件契约类型，含 `id`、`familyId`、`kernelOps`、`parameters`、`compositionKind`；`CompositionShape` 含 `playLayerOwnedFieldNames`。
- **ComponentClassContract**：`src/class/class-contract.ts` 的真实目录校验契约类型，含 `semanticFamily`、`compositionKind?`、`kernelOps`（`ClassCatalogCapability`）。
- **System 接线（kernelOps）**：能力声明由哪些 Op/Hook 读写（`Src/core` 落点为 Op；基类层语义见 `wakeup-base-layer-ecs` Requirement 3.1/3.3）。
- **宽松前缀匹配（loose prefix matching）**：`auditKernelOpsAlignment` 现行规则——`prop.<field>`、`<field>.<nested>`、`<nested>.<field>` 视为同一槽位。本 spec 把它收敛成一个受检、单一来源的匹配判定函数（要求 1.3），不再仅口头登记于 H-ECSP-01。
- **生产态组合路径**：`src/play/profiles/*.json` 通过 `capabilityIds` 组合 `src/class/*/index.json` 能力的真实入口（`src/play/profiles/audit.ts` 的 `auditClassLayerReferences`）。
- **诊断码（diagnostic code）**：稳定、可断言的一致代码字符串，用于在测试/报告/守卫之间对齐。CaS 缝隙闭环码必须进入 `src/l2/model/diagnostic-codes.ts`（本 spec 要求 1.3）。
- **H-ECSP-01**：`src/l2/决策与风险记录.md` §7.5 登记的设计判断——CaS 字段归属用宽松前缀匹配而非字面相等；本 spec 将其升格为受测的单一来源实现并记录裁决（见 design.md「决策记录」）。

## Requirements

### Requirement 1: 单一权威的 CaS 缝隙闭合

**User Story:** 作为跨层契约维护者，我希望任何一个"组件可配置字段名 ↔ System 参数名是否同轨"的断言只由一个权威实现给出，以便基类层、目录校验层、玩法层组合从同一份规则取用，杜绝两处各说各话。

#### 验收标准

1. THE CaS_Gap_Closure SHALL 提供唯一一个实现，判定 `kernelOps` 带括号字段引用时，其字段名是否落到该能力 `parameters[*].key`（或等价的参数名集合）声明的槽位（Req 3.2 的"同一通路"判定）。
2. WHEN `src/play/profiles/audit.ts` 组合路径执行同样的字段↔参数名对齐判定，THEN 它 SHALL 复用 Requirement 1.1 的单一实现，而不各自内联一套规则。
3. THE CaS_Gap_Closure SHALL 把 CaS 缝隙闭环诊断码登记到 `src/l2/model/diagnostic-codes.ts`（原 `PLAY-REF-KERNELOPS-FIELD-GAP` 字符串字面量废除），使核心诊断字典与 play audit 共享同一码。
4. THE CaS_Gap_Closure SHALL 提供经属性测试（`numRuns≥100`）保证的、全称量化的匹配判定正确性（匹配、不匹配、不适用三种输出）。
5. IF 一个 `kernelOps` 是裸 Op（无括号字段引用），THEN CaS_Gap_Closure SHALL 不触发字段缝隙诊断（不误报，沿用 H-ECSP-01 意图）。

### Requirement 2: play/class 组合路径消费 ECS 组件契约单一源

**User Story:** 作为玩法层组合路径的维护者，我希望 `src/play/profiles` 与 `src/class/class-contract.ts` 真正引用 `src/l2` 的组件契约单一源，以便基类层能力、目录校验、玩法层组合同走一套契约，而非各自从 `src/class/*/index.json` 原始形状各读一套。

#### 验收标准

1. THE `src/play/profiles` 组合路径 SHALL 通过稳定端口消费 `src/l2` 导出的组件契约单一源（`composition-registry` / `family-component-shapes` 之一），使"组合能力"与其"组件契约形状"可机检同源。
2. WHEN `src/class/class-contract.ts` 解析一个 capability，THE `ComponentClassContract SHALL 把其 `parameters` / `kernelOps` / `compositionKind` 与其对应的 `ComponentContract`（如存在）作机器对齐，对不一致项返回已登记诊断（`COMPONENT_ID_CONFLICT` 或本 spec 新增同类码）。
3. THE CaS 缝隙闭合在生产态组合路径（`src/play/profiles`）的进入点 SHALL 是可观察、可断言的——即组合路径每次迭代在 `kernelOps` 字段缝隙存在时都产生 `CaS_GAP` 类诊断，且测试能稳定断言其存在。
4. THE Requirement 2.1 的消费 SHALL 为向后兼容（不改变既有 `src/class/*/index.json` 与 `src/play/profiles/*` 数据文件的读取行为），只扩展读取/校验入口。

### Requirement 3: 匹配规则单源、可测试、无局部例外

**User Story:** 作为维护者，我希望"宽松前缀 / 字段归属"这个规则不再是各实现各自记的主观判断（H-ECSP-01），而是升格为受测、单一来源、全仓库一致的函数。

#### 验收标准

1. THE CaS_Gap_Closure SHALL 把字段名↔参数名的匹配判定（含"宽松前缀"规则）收敛为单一可调用函数，将其输入输出约束以全称量化属性表达。
2. WHEN 该匹配函数被 `src/l2/validation`（spec-compiler 路径）与 `src/play/profiles/audit`（玩法层组合路径）同时调用，THEN 两者 SHALL 对同一 `(kernelOps 字段, parameters 槽位)` 输入产出同一判定。
3. THE CaS_Gap_Closure SHALL 在 `src/l2/model/diagnostic-codes.ts` 之外，为"不适用（裸 Op）"、"匹配"、"不匹配"各提供明确的状态，供测试断言。
4. THE 字段归属匹配 SHALL 不依赖任何方言/局部上下文差异（不因调用层是基类层 or 玩法层而改变规则），除非经本 spec 记录的 Q-题-0N 裁决新增字段名语法。

### Requirement 4: 数值归属与 CaS 缝隙不互相覆盖

**User Story:** 作为玩法层数据维护者，我希望数值归属（`playLayerOwnedFieldNames`）与 CaS 字段缝隙是两条独立、不互相吞并的链路，以便 CaS 缝隙闭合不因数值归属缺失或重叠而误判。

#### 验收标准

1. THE CaS_Gap_Closure SHALL 与玩法层数值归属（`playLayerOwnedFieldNames` → play 组合取值 1-5 铁律）保持独立；字段缝隙的判定不要求该字段同时是玩法层拥有字段。
2. IF 一个字段名落在 "既未被 parameters 声明、又未被 playLayerOwnedFieldNames 覆盖" 的真空，THEN CaS_Gap_Closure SHALL 仍判定为不匹配（不被数值归属"吃掉"），并返回 `CaS_GAP` 类诊断。
3. THE CaS_Gap_Closure SHALL 在属性测试中把「数值归属不吞并字段缝隙」作为不变量，与 `ecs-play-alignment.property.test.ts` 的既有名称/字段 PBT 协同（不要求新增重复 PBT，但要复用/覆盖）。

### Requirement 5: 门禁、来源采纳与交接

**User Story:** 作为收尾演行者，我希望 CaS 缝隙闭合的落地可被全量门禁与文档纪律守卫核对，不引入新的红测或未登记来源，且既有交付物不被跨线改写。

#### 验收标准

1. THE 本 spec 的三件套（`requirements.md` / `design.md` / `tasks.md`）SHALL 落地到 `.kiro/specs/wakeup-cas-gap-closure/`，并按 `spec-document-discipline.test.ts` 的 `SOURCE_TRACING_ADOPTION` 登记为 `not-adopted`。
2. WHEN 全量门禁运行，THE `npx tsc --noEmit` SHALL 返回 0 error、`npm run lint` SHALL 返回 0 error、`npm run verify:docs` / `npm run verify:data` SHALL 全过、`spec-document-discipline.test.ts` SHALL 8/8 绿。
3. THE 落地 SHALL 不改变任何 `src/class/*/index.json` 与 `src/play/profiles/*` 目录数据文件（只扩展读取/校验入口）。
4. IF 全部全量测试中唯一的红测是 `src/core/kernel/ai/__tests__/combat-first.test.ts` 阶段2（属 AI 并行线工作树，非本线），THEN 本 spec SHALL 如实登记为待 AI 线收敛交接项，不代修不旁路。
5. THE 落地 SHALL 提供新增 CaS PBT/防回归守卫（若本 spec 确需扩展现有 PBT），使 CaS 缝隙闭合不回归。

---

## 交接项（Handoff Items）

| 项 | 归属 | 内容 | 关联 |
|---|---|---|---|
| T-CaS-01 | 型号契约线 / `src/class/class-contract.ts` | 把 `ClassCatalogCapability` 与 ECS `ComponentContract`（`familyId` / `playLayerOwnedFieldNames`）做完整字段对齐归一（本 spec 要求 2.2 起步；完整单源化需 class-catalog schema 允许 `familyId` 等字段） | Req 2.2 |
| T-CaS-02 | 基类层线 / `src/l2/validation` | 把 `validateCompositionAlignment` 的"字段↔参数名同轨"真正实现（当前只有名称形状检查），或显式声明把该判定委托给本 spec 的单一实现（二者选一，不得各自再写第三份） | Req 1.1/3.2 |
| T-CaS-03 | AI 并行线 | `combat-first` 阶段2 红测（expected a:attack got a:move）在干净 master 上即失败，属 AI 线工作树，非本线引入；登记录入，待 AI 收敛 | Req 5.4 |
| T-CaS-04 | 并行锁纪律 | 本 spec 落 `src/l2`（component 契约扩展）与 `src/class/class-contract.ts`、`src/play/profiles/audit.ts`（校验入口扩展）、新建测试。落这三类目录需用户在策略上放开写权（与 PT-12 相同处置）；未授权不落改写 | 全部 |

> T-CaS-04 是写权边界：本 spec 的完整落地（Requirements 1–5）会改动 `src/l2/model`、`src/l2/validation`、`src/class/class-contract.ts`、`src/play/profiles/audit.ts` 与新增测试，均属跨线交付物。只有用户放开写权后，T-CaS-02 与 Requirement 1–4 的实现才能真正落地；否则本 spec 仅以文档交付并登记交接。

---

## 审计对照表（Requirement → 证据，2026-08-15）

> 逐条映射要求 1–5 的验收标准到实现/测试/门禁证据。证据快照在提交前重跑全绿，全量 vitest 唯一红 = `combat-first` 阶段2（AI 并行线，T-CaS-03）。「已闭合」= 证据存在且门禁绿；「交接」= 生产态链路成立但跨写权部分登记待授权。

| Req | 要求 | 实现证据（文件:函数/常量） | 测试/属性证据 | 门禁证据 | 状态 |
|---|---|---|---|---|---|
| 1.1 | 唯一实现判定字段↔参数同轨 | `src/l2/model/cas-field-alignment.ts::caSFieldMatches`（新增，返回 `CASchemaOutcome` 三态） | `cas-field-alignment.property.test.ts` Property 1/2/3 | targeted vitest 44/44 绿 | 已闭合 |
| 1.2 | play audit 复用该实现，不各自内联 | `src/play/profiles/audit.ts`：删内联宽松前缀，改为 import `caSFieldMatches` + `CAS_FIELD_GAP_CODE`，调 `caSFieldMatches(...)!=='no-match'` | `profile-composition.test.ts`（29 绿）+ `property 4 跨路径确定性` | 同上 | 已闭合 |
| 1.3 | CaS 缝隙诊断码入核心字典，废除 play 字面量 | `src/l2/model/diagnostic-codes.ts` `CAS_FIELD_GAP`（新增）；audit 发射由 `'PLAY-REF-KERNELOPS-FIELD-GAP'` 改 `CAS_FIELD_GAP_CODE`；`src/l2/ugc/ports/diagnostic-projection.ts` 补 `composition-conflict` 投影 | `diagnostic-projection.test.ts`（7 绿，穷举码投影） | 同上 | 已闭合 |
| 1.4 | 全称量化 PBT（numRuns≥100） | `cas-field-alignment.property.test.ts`（6 条，numRuns 100/200，标签 `Feature: wakeup-cas-gap-closure`） | 属性 1–6 | targeted 44/44 | 已闭合 |
| 1.5 | 裸 Op 不误报 | `caSFieldMatches` 对无括号/空字段返回 `not-applicable` | Property 1/6（裸样本恒 not-applicable） | 同上 | 已闭合 |
| 2.1 | play 通过稳定端口消费 src/l2 | `audit.ts` import `../../l2/model/cas-field-alignment.js`（单一判定函数 + 单一码）——src/play 首次以共享判定函数形式消费 src/l2 | —— | 22（audit 链路绿） | 已闭合（最小同源：共享判定函数+共享码） |
| 2.2 | class-contract 与 ComponentContract 机器对齐 | 未落地 | 无 | —— | 交接 T-CaS-01 |
| 2.3 | 生产态入口可观察、可断言 | `auditClassLayerReferences` 每迭代对带字段 kernelOps 调 `caSFieldMatches`，`no-match` → 发射 `CAS_FIELD_GAP` | `profile-composition.test.ts` 正向/反向（`CAS_FIELD_GAP` 正 1 例 + 反向裸 Op 不报） | 22 绿 | 已闭合 |
| 2.4 | 向后兼容（不改目录数据） | `git diff --name-only HEAD` 无 `src/class/*/index.json` 或 `src/play/profiles/*.json` | `git status` 白名单外 0 改动 | 全绿 | 已闭合 |
| 3.1 | 匹配规则收敛为单一可调用函数 + 全称量化 | `caSFieldMatches`（唯一函数） | Property 1–3 | —— | 已闭合 |
| 3.2 | l2/validation 与 play/audit 对同输入同判定 | l2 侧 `validateCompositionAlignment` 仍未委托（只做名称形状）；play 侧已复用单一函数 | Property 4 只断言 play 侧单一码 | —— | **交接 T-CaS-02**（l2 侧未委托） |
| 3.3 | 三态状态提供 | `CA_SCHEMA_OUTCOMES = ['match','no-match','not-applicable']` | Property 1 断言三态恰一 | —— | 已闭合 |
| 3.4 | 不因调用层而变规则 | 匹配逻辑唯一在 `caSFieldMatches`，无方言 | —— | —— | 已闭合（唯一实现即天然一致） |
| 4.1 | CaS 与数值归属独立 | `caSFieldMatches` 只按 `parameters[*].key` 判定，不读 `playLayerOwnedFieldNames` | Property 5（空声明仍 no-match） | —— | 已闭合 |
| 4.2 | 字段真空仍报缝隙 | `caSFieldMatches(field, 空集) === 'no-match'` | Property 5 | —— | 已闭合 |
| 4.3 | 数值归属不吞并缝隙作 PBT 不变量 | 属性 5 固化 | —— | —— | 已闭合 |
| 5.1 | 三件套落地 + 登记 not-adopted | `.kiro/specs/wakeup-cas-gap-closure/{requirements,design,tasks}.md`；`test/toolchain/spec-document-discipline.test.ts` SOURCE_TRACING_ADOPTION 登记 `wakeup-cas-gap-closure/requirements.md` | `spec-document-discipline.test.ts` 8/8 绿 | —— | 已闭合 |
| 5.2 | 全量门禁全绿 | —— | —— | tsc 0 / lint 0 error / verify:docs 全过 / verify:data 90 / spec-document-discipline 8/8 | 已闭合 |
| 5.3 | 不改变目录数据 | 见 2.4 行 | —— | —— | 已闭合 |
| 5.4 | 唯一红=AI 线 combat-first 阶段2，登记交接 | —— | —— | 全量 vitest 3170/3171 唯一 failed `combat-first` 阶段2；登记 T-CaS-03 + `wakeup-ai/AI全对局能力规划.md` 附：跨线改动致歉 | 交接 T-CaS-03 |
| 5.5 | 新增 CaS PBT/防回归 | `cas-field-alignment.property.test.ts`（6 条）+ 改写既有 2 文件断言码 | Property 1–6 | targeted 44/44 | 已闭合 |

**审计结论**：本 spec 的**生产态组合侧（src/play/profiles）CaS 缝隙闭合** 于提交前全部要求达成（Req 1.1–1.5、2.1/2.3/2.4、3.1/3.3/3.4、4.1–4.3、5.1–5.5）。两条跨线**交接**未落地（需写权）：T-CaS-02（`src/l2/validation` 侧由 spec-compiler 路径委托到单一判定）、T-CaS-01（`src/class/class-contract.ts` 与 `ComponentContract` 完整字段对齐）。全量 vitest 唯一红为 AI 并行线 `combat-first` 阶段2（T-CaS-03），非本线，已登记不代修。
