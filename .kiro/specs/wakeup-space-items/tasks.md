# Implementation Plan: WakeUp 空间与物品基类层

## Overview

> ## ⚖️ 2026-08-08 裁决落地（D-056~D-060，见 design.md 顶部横幅）
>
> 本计划原假设"新建 `src/class/space-items/` 完整领域"，且把多项冲突当作"实施时保持未决、按 requirements 旧文本处理"。项目所有者已裁决，实施基线相应调整：
>
> 1. **不新建 `src/class/space-items/` 目录数据（D-058）**：目录数据落既有 `src/class/<族>/index.json`（扩展，不并列第二套分类）；**领域验证规则落已存在的 `src/l2/validation/*.ts`**；适配落 `src/l2/adapters/`。任务 9「领域登记目录」改写为「校验并补齐既有 `src/class/<族>/` 目录一致性」；任务 3/5 的落点相应调整为补齐既有模块。
> 2. **R-14 已裁决（D-057）**：连接数结构边界为**单一 5**（代码现状已正确）；按档 5/4/3 归玩法层。任务 2.2 与 5.x 不得按档登记三条边界。
> 3. **R-15 已裁决（D-056）**：微型场景父级为大/中/小三档；任务不得按"父级仅小场景"实现。
> 4. **R-12 已裁决（D-038）**：`interior.isMicroScene` 定值 `false`。
> 5. **R-04 已裁决（D-059）**：死亡容器"禁止存入"机制改为可替换引用 + 灌注时序义务写进契约；Hook 接线（`wire-hooks.ts`）已就绪。
> 6. **U-SPACE-002/005/007（D-040/D-038/D-042）**：现行 requirements 已是部分冻结，门禁按现行 requirements 收窄，**不是保持全未决**。仅 001/003/004/006 与各项的数值部分仍全未决。
> 7. **判定原则（D-060）**：不得以"文档没写/来源缺失"把已批准机制判为违规。

本计划把 [design.md](design.md) 转换为依赖有序、可单独验收的 TypeScript 实施任务。**目录数据扩展落 `src/class/<族>/`；领域验证规则、适配与运行时入口落 `src/l2/`（`validation/` `adapters/` `registry/`）**——不新建 `src/class/space-items/`（D-058）。

### 工具链硬约束（已核实，不得违反）

| 约束 | 事实 | 后果 |
|---|---|---|
| 测试发现范围 | 根 `vitest.config.ts` 只 `include` `src/**/*.test.ts` | 测试必须写在 `src/class/space-items/**/*.test.ts`。写到独立 `test/` 目录下的测试**不会被执行**，却会让测试报告显示全绿——这是禁止行为。 |
| 类型检查范围 | 根 `tsconfig.json` 只 `include` `src` | 生产代码与测试都必须在 `src` 下才会被 `npm run typecheck` 覆盖。 |
| Lint 范围 | `eslint src --ext .ts` | 同上。 |
| 命令 | `npm test`（`vitest run`）、`npm run typecheck`（`tsc --noEmit`）、`npm run lint` | 不使用 watch 模式。 |
| 模块别名 | `@kernel/*` **不存在** | 一律使用相对路径导入 `../../core/kernel/...`、`../../l2/...`。 |
| 错误码 | `src/core/kernel/state/error-codes.ts` 的 `ERR_CODES` 已覆盖所需全部码 | **不得新增任何成员**；领域类别只能映射到已登记码。 |
| 基类层目录纪律 | `src/class/**` 非 schema JSON 受 `src/class/__tests__/formal-data-integrity.test.ts` 的严格解析与字段名黑名单约束 | 领域目录 JSON 只能用 `*Field` / `*Ref` 表达可配置面；结构边界数值放 TypeScript。 |

本计划**不修改** `vitest.config.ts`、`tsconfig.json` 或 eslint 范围，因此不存在"独立 test/ 目录"的前置任务。

### 交付强度

- 不做 MVP、不留占位、不写 `TODO`、不省略内容。每个任务的产出都是完整可编译、可运行的实现。
- 14 个属性测试是**必交付项**，一属性一文件、`fast-check` `numRuns` ≥ 100，标签格式 `Feature: wakeup-space-items, Property {N}: {property_text}`。**不得**标记可选、不得 `skip`/`todo`、不得以"上游端口未就绪"为由跳过。
- 未决门禁**按现行 requirements 分级**（D-040/D-038/D-042 已部分冻结 002/005/007）：`U-SPACE-001`、`003`、`004`、`006` 及各项的**数值部分**保持未决，不得填默认数值/流程/动作/可用性；但 002 的二维正交结构、005 的"载具不建模为微型场景"、007 的零费菜单归属**已冻结、应当实现**，不得再以"未决"为由拒绝。
- 凡实现过程中产生的自主判断或对需求的理解性补充，必须逐条追加到 design.md 的「待人工复核项」表并在任务记录中标明，不得静默采纳。

## 串行门禁与依赖图

```text
1 基线与端口证据
  └─ 2 领域模型（标识 / 结构边界 / 数值归属 / 诊断映射 / 未决目录）
       ├─ 3 领域契约
       └─ 4 上游端口与失败关闭适配器
            └─ 5 领域验证规则集
                 ├─ 6 领域引用能力形状判定
                 └─ 9 领域登记目录
                      └─ 7 运行时入口（转移 / 微型场景 / 激活与拒绝）
                           └─ 8 适配契约与只读投影
                                └─ 10 测试设施、导出根与架构测试
                                     ├─ 11 属性测试 P1–P14
                                     └─ 12 单元 / 契约 / 集成 / 故障注入
                                          └─ 13 全量质量门禁与追踪验收
```

任务 3 与 4 在任务 2 后可并行；任务 6 与 9 在任务 5 后可并行；任务 11 的 14 个子任务在任务 10 后按各自前置并行。任务 12.3（真实接线集成）必须等任务 7 与 10 完成。任务 13 必须等 11 与 12 全部通过。

## Tasks

- [ ] 1. 建立领域基线与上游契约证据
  - [ ] 1.1 记录工具链与实施前行为基线
    - 运行并记录 `npm run typecheck`、`npm test`、`npm run lint` 的实施前结果；任何既有失败必须保存命令、错误文本与所属模块，**不得**通过过滤、改断言或缩小范围掩盖。
    - **不新建 `src/class/space-items/`（D-058）**：目录数据扩展既有 `src/class/<族>/`，规则/适配/运行时落 `src/l2/`。若发现有旧会话已建 `space-items/` 目录，停止并迁移到既有目录。
    - **重新核验 `src/class/` 当前状态**（R-17 已裁决为 D-058）：逐一确认现存目录清单、`scenes/index.json` 与 `containers/index.json` 的族与能力标识、`vehicles/index.json` 的 `unresolvedItems`、`class-contract.ts` 与 `json-contract.ts` 的导出、`schemas/` 下 schema；以现状为落点，缺什么补什么，不新建平行分类。
    - **R-14 / R-15 已由 D-057 / D-056 裁决**（不再是"未裁决时按 requirements 旧文本"）：连接数结构边界为**单一 5**——`scenes/index.json` 现状（三档共用 `connection_limit = 5`）**正确，保持**，按档 5/4/3 归玩法层，任务不得按档登记三条基类层边界；微型场景父级为**大/中/小三档**——需把 `scene.class.large`/`medium` 的 `admitsMicroScene` 改 `true`、`micro-scene.class.contact.admittedParentSceneScales` 改三档、`scene_scales` 中 small 的"唯一承载者"描述改写，并同步 `class-semantic-families.test.ts` 的对应断言；`admittedChildSceneScales` 降级为叙事分组（不参与距离/生命周期/找到）。
    - 记录 `src/class/__tests__/formal-data-integrity.test.ts` 与 `architecture-terminology.test.ts` 当前通过状态，因为本领域新增目录会被前者的全目录扫描纳入。
    - 验收：基线记录可在同一工作区复现；后续任务引用的命令与路径全部真实存在。
    - **Requirements:** 12.1、14.6。**Design:** Existing System Assessment；串行质量门禁。

  - [ ] 1.2 冻结引擎层与共享基类层端口的契约证据
    - 逐项核实并记录真实导出与签名：`OpRegistry.invoke` / `register` / `has` / `listOpNames` / `isStructural`（`src/core/kernel/ops/registry.ts`）；`registerStructuralOps` 注册的 Op 名全集与 `makeItemMove` 的 `ItemMoveArgs`、`makeEntityPlace` 的 `EntityPlaceArgs`（`src/core/kernel/ops/structural-ops.ts`）；`ensureMicroScene` / `onMicroSceneOccupantsChanged` / `checkMicroSceneCapacity`（`src/core/kernel/topology/micro-scene.ts`）；`linksTouching` / `cascadeNodeDestroySet`（`topology/graph.ts`）；`findDefaultSlotIndex` / `insertSlot` / `removeSlot` / `setSlotHolds`（`topology/container.ts`）；`ALL_INVARIANT_CHECKS` 覆盖的 `E_INV_*` 集合（`ops/invariants.ts`）；`KernelContract`（`src/l2/kernel/kernel-contract.ts`）；`createKernelContractFromOpRegistry`（`src/l2/kernel/op-registry-adapter.ts`）；`buildValidationContext` / `validatePackage` / `DEFINITION_RULES`（`src/l2/validation/validator.ts`）；`src/l2/model/**` 的共享类型；`src/l2/resolution/reference-graph.ts`。
    - 明确记录**缺失**能力：`src/l2/` 下不存在 `registry/`、`adapters/`、`testing/`，`resolution/` 无 `definition-resolver` 与 `dependent-revalidation`，`validation/` 无 `package-validation.ts`。为每项缺失记录 owner（`l2-base-layer-spec` 任务编号）、受影响验收标准与 `E_LOAD_UNRESOLVED_CONTRACT` 失败关闭结果。
    - 明确记录 `OpRegistry.invoke` **没有** `cause` 形参，因果信息只能经 `recordCause` 回调（对应 design.md 待人工复核项 R-10）。
    - 禁止把 `src/core/kernel/spec-compiler/` 或 `src/class/specification-compiler/` 当作已冻结的原子注册表端口直接依赖；`StrictJsonCodec` 例外，因为它已被 `src/class/catalog-loader.ts` 在生产路径使用且有测试覆盖。
    - 验收：每个端口有"已冻结"证据或显式 unavailable 记录；不存在未经证据假定的签名或字段形状。
    - **Requirements:** 3.1、3.2、14.1、14.2、14.5、14.6。**Design:** Existing System Assessment；尚不存在的上游能力；上游端口。

  - [ ] 1.3 核实共享错误码并冻结领域诊断类别映射
    - 审计 `ERR_CODES`，逐项确认 design.md「Diagnostics」表中引用的每个码都已登记：`E_LOAD_LAYER_OWNERSHIP`、`E_LOAD_NUMERIC_OWNERSHIP`、`E_LOAD_GAMEPLAY_VALUE_RANGE`、`E_LOAD_CROSS_FIELD_CONSTRAINT`、`E_LOAD_SCHEMA_CONTRACT`、`E_LOAD_DEPRECATED_MECHANIC`、`E_LOAD_TERM_NONCANONICAL`、`E_LOAD_NORMATIVE_WITHOUT_PROVENANCE`、`E_LOAD_EQUAL_PRECEDENCE_CONFLICT`、`E_LOAD_INHERITANCE_CYCLE`、`E_LOAD_COMPOSITION_CONFLICT`、`E_LOAD_ORDER_UNDECLARED`、`E_LOAD_UNDEFINED_REF`、`E_LOAD_UNRESOLVED_NORMATIVE`、`E_LOAD_SOURCE_STATUS_PROMOTION`、`E_LOAD_UNRESOLVED_CONTRACT`、`E_LOAD_SEMANTIC_FIELD_DAMAGED`、`E_LOAD_PRESENTATION_FALLBACK`、`E_REF_MISSING`、`E_REF_KIND`、`E_REF_ABSTRACT`、`E_REF_CYCLE`、`E_OP_NO_LEGAL_SLOT`、`E_OP_SLOT_FULL`、`E_OP_VETOED`、`E_OP_NOT_FOUND`、`E_OP_INVALID_ARGS`、全部 `E_INV_*`。
    - 这一步是**核实既有契约，不是新增登记**。若发现某个映射目标确实不存在，必须停下并把该路径标为 unavailable，**不得**新增 `ERR_CODES` 成员，也**不得**用 `E_LOAD_UNRESOLVED_CONTRACT` 给已登记码兜底。
    - 同时核实 `src/l2/model/diagnostic-codes.ts` 中已有的 `SPACE_*`、`ITEM_*`、`WEAPON_*`、`ARMOR_*`、`VEHICLE_*`、`LAYER_*`、`VALUE_L3_OWNERSHIP`、`SOURCE_PROMOTION_REQUIRES_DECISION` 条目，确定哪些领域检查可直接复用其代码、哪些需要新增领域类别。
    - 验收：每个已启用的领域诊断条件都能解析到唯一已登记 `ErrCode`；核实结果写入 `src/class/space-items/决策与风险记录.md`。
    - **Requirements:** 12.2、12.3。**Design:** Diagnostics；待人工复核项 R-03。

- [ ] 2. 实现领域模型（`src/class/space-items/model/`）
  - [ ] 2.1 实现 `domain-ids.ts`
    - 定义领域族标识 `SPACE_ITEMS_FAMILY_IDS`（`natural-scene`、`micro-scene`、`transition`、`container`、`item`、`weapon`、`profile`、`damage`、`armor`、`shield`、`movement`、`vehicle`）、能力标识、组合角色标识与座位/门/容器/槽位标识类型别名。
    - 复用 `src/l2/model/ids.ts` 的 `isWellFormedId` 与 `joinJsonPath`，**不重新实现**标识形状校验与 JSON 路径拼接。
    - 提供每个标识集合的规范化排序序数函数，保证诊断与投影输出确定性。
    - 验收：strict TypeScript 通过；标识集合为 `as const` 封闭集合；不含任何玩法数值。
    - **依赖：** 1.2。**Requirements:** 1.2、14.2、14.3。

  - [ ] 2.2 实现 `structural-bounds.ts`
    - 定义 `SceneScale`（`'large' | 'medium' | 'small'`）、`StructuralBound`、`SCENE_CONNECTION_BOUNDS`，取值恒为 large=5、medium=4、small=3。
    - 每个边界必须携带非空 `authoritativeSources`（`docs/L0_规范宪法.md` 第五条五并列原则；`docs/L2_基类层/03_空间系统.md`「场景节点分类」与「地图编辑规范 / 拓扑 Linter 度数检查」）与非空 `structuralRationale`，`owningLayer` 恒为 `'基类层'`。构造 `SourceRecord` 时复用 `src/l2/model/source.ts` 的类型，并与 `src/l2/model/constitution.ts` 的 `NODE_CONNECTION_BOUND_SOURCE` 保持同一 precedence 语义。
    - 定义 `ConnectionCountMetric`，`kind` 字面量恒为 `'Internal_Metric'`，并实现 `measureConnectionCount(links, nodeId)`，内部调用引擎层 `linksTouching`，**不自建图遍历**。
    - 数值写在 TypeScript 而非 JSON，避免在 `src/class` 的 JSON 中引入数值叶子。
    - **已裁决（design.md R-14）**：基类层只登记**一个**天花板 5（`SCENE_CONNECTION_CEILING`，L0 五并列来源），**不得**登记 4 与 3。按尺度收紧的 `{large:5, medium:4, small:3}` 已落地于玩法层 `src/play/map/types.ts` 的 `CONNECTION_LIMIT`，由 `validateMapStructure` 强制；两层关系已由 `src/play/map/__tests__/connection-limit-layering.test.ts` 钉死。本任务只需在 `structural-bounds.ts` 引用该天花板并复用 `measureConnectionCount`，**不要**重建按尺度的表。
    - 验收：三档边界值与来源可被单元测试逐项断言；删除任一来源或理由字段导致类型检查失败；`measureConnectionCount` 结果始终带 `Internal_Metric` 标记。
    - **依赖：** 2.1。**Requirements:** 2.4、4.1、4.2、4.6。**Design:** 结构边界目录。**Properties:** P3。

  - [ ] 2.3 实现 `numeric-ownership.ts`
    - 定义 `NumericOwnership` 四分类与 `NumericFieldClassification`，复用 `src/l2/model/schema.ts` 的 `ParameterField`、`src/l2/model/constitution.ts` 的 `GAMEPLAY_VALUE_RANGE`。
    - 实现 `classifyNumericField(field)`、`collectNumericFields(definition)`（递归遍历定义的全部数值叶字段，含参数 Schema、组合组件参数、契约内嵌字段，返回「字段路径 → 数值」列表，路径格式与 `NumericFieldClassification.fieldPath` 一致）。
    - 实现 `validateGameplayValue(classification, value)`：玩家可见的 `Gameplay_Value` 必须为 1–5 的有限整数；非玩家可见的 `Gameplay_Value` 必须携带 `authoritativeSources`，否则与"用 `playerVisible:false` 绕过 1–5"不可区分。
    - 实现 `validateInternalMetric`：必须有显式 `Internal_Metric` 标注与自有 Schema；缺标注的数值**不得**以"内部"为由豁免。
    - 全部为纯函数模块：不得 import `OpRegistry`、`Transaction`、`OpContext`，不得持有 `WorldState`。
    - 验收：1 与 5 的边界、0 与 6、非整数、非有限值、缺分类、冲突分类、无来源的非玩家可见值均有确定结果；模块无副作用。
    - **依赖：** 2.1。**Requirements:** 2.1、2.2、2.3、2.5、2.6。**Design:** 数值归属。**Properties:** P2。

  - [ ] 2.4 实现 `diagnostic-categories.ts`
    - 定义 `SPACE_ITEMS_DIAGNOSTIC_CATEGORIES` 封闭集合与 `CODE_MAP`，按 design.md「Diagnostics」表把每个（类别，条件）组合映射到唯一已登记 `ErrCode`，用 `satisfies Record<Category, Readonly<Record<string, ErrCode>>>` 获得编译期完整性检查。
    - 实现 scope-aware 诊断工厂：按定义级、包级、运行时级分别补齐 `code`、`severity`、`definitionId`、`jsonPath`、`sourcePackage`、`sourceLocation`、`reason`、`correctionSuggestion`、`relatedSources`；结构上不适用的定位字段显式省略而非填空串。
    - 领域诊断携带两个附加字段：`unresolvedId?: UnresolvedItemId` 与 `forbiddenSurface?: JsonPath`，供未决门禁使用。
    - 实现固定排序键（受影响定义标识 → JSON 路径 → 稳定代码 → 来源定位），复用 `src/l2/model/ordering.ts` 的 `canonicalSort`。
    - 验收：任何自由字符串代码无法通过类型检查；同一诊断集合的任意输入排列产生字节等价顺序；缺少 `Error_Diagnostic` 的拒绝被 `isValidStructuredRejection` 识别为无效。
    - **依赖：** 1.3、2.1。**Requirements:** 12.2、12.3。**Design:** Diagnostics。**Properties:** P12。

  - [ ] 2.5 实现 `unresolved.ts`
    - 定义 `UnresolvedItemId`（`'U-SPACE-001'` … `'U-SPACE-007'`）与 `UnresolvedItemRecord`，逐条按 design.md「未决边界」表填入 `upstreamIds`、`retainedInterface`、`forbiddenSurfaces`、`rejectionCategory`、`rejectionCode`、`sourceRecords`。
    - `UNRESOLVED_ITEM_CATALOG` 必须恰好包含七项且全部保持未决；**不得**为任何一项写入默认数值、默认流程、默认动作或默认可用性。
    - 提供 `forbiddenSurfacesOf(id)`、`findUnresolvedItem(id)`、`allForbiddenSurfaces()` 查询函数，按标识规范化排序。
    - 在文件头注释中记录 design.md 待人工复核项 R-01 的冲突（上游状态表把 002 记为结构已冻结、005 部分冻结、007 已关闭），并注明本实现按 requirements.md 要求 13 执行、未自行裁决。
    - 验收：七项齐备且可逐项断言；任何试图把某项标为已冻结的改动都会使专用单元测试失败。
    - **依赖：** 2.1、2.4。**Requirements:** 13.1–13.9。**Design:** 未决边界。**Properties:** P11。

- [ ] 3. 实现领域契约（`src/class/space-items/contracts/`）
  - [ ] 3.1 实现 `space-contracts.ts`
    - 实现 `NaturalSceneDomainContract`、`MicroSceneDomainContract`、`TransitionDomainContract`，字段形状按 design.md 第 3 节。
    - 这些契约**扩展**而非替换 `src/l2/model/family-contracts.ts` 的 `NaturalSceneContract` / `MicroSceneContract` / `TransitionContract`：只补该文件尚未表达的面（按 scale 引用结构边界、triggerKind、creator 用途约束、occupancySource、parentRemovalDisposition、端点 scale 对、网关引用、付费动作序列、依附动作宿主绑定）。
    - 违规检测面字段（`concreteMapNodeIds`、`spawnPointIds`、`shrinkOrderIds`、`creatorAsOwner`、`creatorAsLifecycleDeterminant`、`creatorAsAccessControl`、`ownerField`、`occupancyCounterField`、`modelsVehicleAsMicroScene`、`boundConcreteSceneIds`、`concreteApCost`、`concreteDistance`、`boundGameModeId`）保留为可选字段，存在的唯一目的是让越层声明能被确定性发现并定位；合法定义中必须缺省。
    - `MicroSceneDomainContract.creator` 的 `immutable` 与 `purpose` 用字面量类型 `true` / `'provenance-only'` 固定，使"声明 creator 可变"在类型层面就不可表达为合法值。
    - 所有集合暴露为 `readonly`；提供深度不可变构造辅助。
    - **冲突处理（design.md R-15）**：`src/class/scenes/index.json` 令 `micro-scene.class.contact.admittedParentSceneScales` 只含 `["small"]`、且大/中场景 `admitsMicroScene: false`。本任务按 requirements.md 要求 5.1 实现"父级可为任一有效天然场景"，并保留小场景的共享微型场景能力与个人空旷地排除。必须在 `space-contracts.ts` 文件头注释中记录该冲突与待裁决状态。
    - **未覆盖维度（design.md R-16）**：`scenes/index.json` 已引入大 ⊃ 中 ⊃ 小 的层级容纳关系（`admittedChildSceneScales` / `parentSceneRef` / `childSceneRefs`），而 requirements.md 要求 4.1 只要求三档类型身份。本任务**不**擅自纳入该层级；若人工确认其为有效契约，需回头补 `NaturalSceneDomainContract` 的父/子场景引用面及其引用完整性校验，并同步任务 5.5 与 P3。
    - 验收：strict TypeScript 通过；契约不含任何具体数值、具体地图或具体模式绑定；与 `src/l2` 族契约无字段语义冲突；两项冲突与一项未覆盖维度均已在注释中登记。
    - **依赖：** 2.1、2.2。**Requirements:** 4.1、4.4、5.1、5.2、5.4、5.7、6.1、6.3、6.5。**Design:** 空间领域契约扩展。**Properties:** P3、P4、P14。

  - [ ] 3.2 实现 `container-item-contracts.ts`
    - 实现 `ContainerDomainContract` 与 `ItemDomainContract`，字段形状按 design.md 第 4 节。
    - 槽位数量、容量、占位规模、充能次数一律以参数字段名（`*Field`）表达；`concreteSlotCount` / `concreteCapacity` 只作为违规检测面存在。
    - `transformCapability` 的 `promoteOpId` / `demoteOpId` 用字面量 `'item.promote'` / `'entity.demote'` 固定。
    - `deathContainerCapability` 的 `depositDisabled` 固定为 `true`、`depositDisabledMechanism` 固定为 `'before-item-move-veto'`、`contentSource` 固定为 `'deceased-entity-transaction'`；在注释中说明该机制的推导依据（已登记 Op 集合中没有任何 Op 能在容器创建后修改 `Slot.accepts`）并引用 design.md 待人工复核项 R-04。
    - `volumeClass` 与 `pocketSlots` 只作为 S-06 已否决机制的检测面存在。
    - 验收：strict TypeScript 通过；合法物品定义无法在类型层面写入具体容量或体积分类语义；死亡容器的三项固定值不可被覆盖。
    - **依赖：** 2.1。**Requirements:** 7.1、7.2、7.5、7.6、7.7、7.8。**Design:** 容器、物品与装备契约扩展。**Properties:** P6、P7。

  - [ ] 3.3 实现 `weapon-damage-contracts.ts`
    - 实现 `WeaponDomainContract`、`DamageDomainContract`、`ProfileDomainContract`，字段形状按 design.md 第 5 节。
    - 武器类型身份恰为 `'melee' | 'non-firearm-ranged' | 'firearm'` 三值；武器属性（散射/扫射/连发等，原"攻击形状"已废止）、谱型、距离策略、伤害引用、弹药行为、配件兼容性、动作序列、目标上限全部经 `compositionRoles` 声明，不作为契约顶层字段。[2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：`compositionRoles.role` 的 `'attack-shape'` 已改名为 `'weapon-attribute'`；散射/扫射属性不适用 `'target-limit'`（不设固定命中目标数上限）。详见 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3。]
    - `DamageDomainContract.damageTypeRef` 与 `vulnerabilityTypeRefs` 只引用 `src/class/damage-types/index.json` 的 `DMG_*` 与 `src/class/vulnerability-types/index.json` 的 `WKN_*` 已登记语义；`ProfileDomainContract.spectrumClassRef` 只引用 `src/class/weapons/index.json` 的 `spectrum-class.*`（弹道谱型登记表；已废止的攻击形状分类项 `spectrum-class.single/scatter/area` 及 `spectrumAxes`/`attack_shape_composition` 能力已随基类层一并删除，不在引用范围内。见 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3）。
    - 违规检测面：`baseDamageTable`、`concreteDamageValue`、`concreteHitThreshold`、`concreteRangeTable`、`specialTierMechanism`、`gameplayProfileCoupling`、`amount`、`critIncrement`、`damageTable`、`namedFirearmId`、`concreteAmmunitionCount`。
    - `profileTierRef` 只保留可扩展引用，注释注明 `U-SPACE-003` 未决，不得用任一既有 `spectrum-class.*`（弹道谱型）充当「特殊」档。
    - 验收：strict TypeScript 通过；契约中没有任何伤害、命中、距离或弹药数值；违规检测面在合法定义中缺省。
    - **依赖：** 2.1、2.5。**Requirements:** 8.1、8.2、8.3、8.5、8.7。**Design:** 武器、谱型、伤害与配件契约扩展。**Properties:** P9、P11。

  - [ ] 3.4 实现 `defense-movement-contracts.ts`
    - 实现 `ArmorDomainContract`、`ShieldDomainContract`、`MovementDomainContract`，字段形状按 design.md 第 6 节。
    - 防具只暴露装备槽位、减伤规则引用、破损条件引用、伤害类别兼容性引用与状态交互引用；`concreteMitigation` / `concreteDurability` / `concreteBreakThreshold` 为违规检测面。
    - 盾牌只暴露持有要求、格挡动作、损耗规则、破损条件与可选互动能力引用；`mvpDefaultInteractionIds` 为违规检测面（`U-SPACE-006` 未决，不设默认标配范围）。
    - 移动区分 `'ground' | 'vehicle' | 'other'` 遍历语义，成本/速度/距离/地形修正/载荷修正全部为 `*Field`；`carryTagAggregation.aggregation` 固定为 `'kernel-query-relation'`，标签聚合只能经引擎层 query 与 relation 接口。
    - 状态交互只能引用已登记 `Status_Family` 与 `Attachment_Family`；D-016 已移除的状态不得出现在任何默认标签或隐式交互中，为此提供一个显式的已移除状态标识黑名单常量。
    - 验收：strict TypeScript 通过；三个契约都不含具体减伤、耐久、成本、速度或范围数值；盾牌无默认可用性。
    - **依赖：** 2.1、2.5。**Requirements:** 9.1、9.2、9.3、9.4、9.5、9.6、9.7。**Design:** 防具、盾牌、状态与移动契约扩展。**Properties:** P2、P9、P11、P14。

  - [ ] 3.5 实现 `vehicle-contracts.ts`
    - 实现 `VehicleDomainContract`，字段形状按 design.md 第 7 节；`backingDefKind` 用字面量 `'entity'` 固定，使"载具映射为 Item 或 Micro_Scene"在类型层面不可表达。
    - 座位角色声明中 `bindOpId` / `unbindOpId` 用字面量 `'agent.bind'` / `'agent.unbind'` 固定，与 `src/class/vehicles/index.json` 的 `operationChannels` 保持一致。
    - `adjacencyComponentId` 与 `doorTargetComponentId` 为两个独立必填字段；`doors[].doorId` 必须良构且在解析后稳定唯一。
    - 损毁处置必须声明乘员去向引用、货舱去向引用与被授予状态的撤销引用（对应载具摧毁后其授予的能力必须一并撤销）。
    - `adjacencyPolicyRef` 只保留指向玩法层 policy 的引用（D-030 归玩法层）；`interiorMicroSceneBoundary`、`concreteDoorCount`、`concreteOccupantCount`、`directOccupantStateWrite`、`directCargoStateWrite` 为违规检测面。
    - 验收：strict TypeScript 通过；契约不含具体门数量、乘员数量或交互结果；邻接与门目标无法共用同一组件标识而通过类型检查以外的校验（校验在任务 5.11）。
    - **依赖：** 2.1、2.5、3.2。**Requirements:** 10.1、10.2、10.3、10.4、10.5、10.6。**Design:** 载具契约扩展。**Properties:** P10。

- [ ] 4. 实现上游端口与失败关闭适配器（`src/class/space-items/ports/`）
  - [ ] 4.1 定义五个端口接口
    - 在 `activation-port.ts`、`resolution-port.ts`、`snapshot-port.ts`、`submission-port.ts`、`action-availability-port.ts` 中分别定义 `DefinitionActivationPort`、`ReferenceResolutionPort`、`SnapshotPort`、`ActionSubmissionPort`、`ActionAvailabilityPort`，每个端口带 `contractVersion`。
    - 用 opaque handle 或泛型传递上游候选、图、快照；**不得**在本领域复制 `Def kind` 注册表、引用求值结构或注册表实现。
    - `ActionSubmissionPort.submit` 只接受 `ValidatedOpRequest`（从 `src/l2/model/projection.ts` 导入），不接受自由字符串 `opId` 与任意 args。
    - 验收：端口可由测试替身实现；没有任何替身能通过公共 API 直接激活未验证候选或直接写入 `WorldState`。
    - **依赖：** 1.2、2.4。**Requirements:** 14.1、14.2、14.5。**Design:** 上游端口。

  - [ ] 4.2 实现每个端口的 unavailable 适配器
    - 为五个端口各提供一个 unavailable 实现，统一返回 `PortUnavailable`，其 `diagnostics` 为 `PENDING_CONVERGENCE` / `port-unavailable` → `E_LOAD_UNRESOLVED_CONTRACT`，并携带 owner（`l2-base-layer-spec` 任务编号）与修复提示。
    - 实现真实适配器的构造函数骨架：`createActionSubmissionPortFromKernel(kernelContract)` 必须只调用 `KernelContract.invoke`；`createActionAvailabilityPortFromCatalog(actionCatalog)` 必须只调用引擎层 `ActionCatalog`。**禁止**为缺失的激活/解析/快照端口提供"本领域自己实现一份"的降级实现。
    - 添加契约测试：unavailable 适配器不调用任何后续端口、不创建 `ValidatedDomainChangeSet`、不改变观察到的语义状态指纹。
    - 验收：端口不可用时链路失败关闭且可观察；真实适配器对引擎层只有类型依赖，运行时实例由调用方注入。
    - **依赖：** 4.1。**Requirements:** 3.4、14.5、14.6。**Design:** 尚不存在的上游能力；Error Handling。**Properties:** P5、P11。

- [ ] 5. 实现领域验证规则集（`src/class/space-items/validation/`）
  - [ ] 5.1 实现 `context.ts` 与 `rule-set.ts`
    - `context.ts` 定义领域验证上下文（候选包、活动定义、已登记族、结构边界目录、未决目录、诊断收集器），在 `src/l2/validation/context.ts` 的 `ValidationContext` 之上做适配，不新建第二套上下文类型。
    - `rule-set.ts` 定义 `SPACE_ITEMS_DOMAIN_RULES` 的确定性执行序，并把 `src/l2/validation/spatial-rules.ts` 的 `validateSpatial` 与 `item-vehicle-rules.ts` 的 `validateItemsAndVehicles` 纳入同一序列，避免同一定义被两套互不知情的规则集分别校验。
    - 规则执行必须收集全部可确定发现的诊断后统一返回，不得遇错即停、不得静默修复。
    - 验收：一个候选中的多个独立问题全部返回；执行序稳定；`src/l2` 已有规则与本领域规则不产生重复诊断（同一 (定义, 路径, 代码) 只出现一次）。
    - **依赖：** 2.4、3.1–3.5。**Requirements:** 12.2。**Design:** 领域规则执行序；待人工复核项 R-08。**Properties:** P12。

  - [ ] 5.2 实现 `provenance-layer-rules.ts`（要求 1）
    - 校验每个定义声明唯一标识、合法 `L1DefKind`（复用 `src/l2/model/def-kind.ts`）、语义族、抽象状态、参数 Schema 与非空 `Source_Record`；缺来源 → `PROVENANCE` / `missing-source-record`。
    - 拒绝重新声明运行时 `Node`/`Link`/`Entity`/`Item`/`Container`/`Slot`/`Relation`/事务/查询/Op 分发/表达式求值/Hook 调度/持久化的定义 → `LAYER_L1_OWNERSHIP`（复用 `L1_MECHANISM_DECLARATION_KEYS`）。
    - 拒绝含具体地图布局、出生分布、胜负条件、模式顺序、命名实例或绑定某一玩法配置的定义 → `LAYER_L3_OWNERSHIP`。
    - 拒绝仅因玩法数值差异而继承的候选 → `COMPOSITION_CONTRACT` / `value-only-subtype`，并在修正建议中指明改用组合。
    - 拒绝废用术语（复用 `src/l2/model/constitution.ts` 的 `REJECTED_LAYER_TERMS`）→ `TERMINOLOGY`；拒绝 S-06 已否决机制（复用 `src/l2/compiler/deprecated-mechanics.ts` 的 `findDeprecatedMechanicsInText` 与 `deprecationSourceRecord`）→ `DEPRECATED_MECHANIC`，诊断必须携带控制来源与规范术语。
    - 同一来源优先级出现实质冲突时保留来源定位与冲突内容为 `Unresolved_Item` 并报 `SOURCE_CONFLICT` / `equal-precedence-conflict`，**不得**自行选择一项作为默认语义。
    - 验收：每类违规有正例与拒绝例；诊断含控制来源；不存在"自动选一个默认语义"的分支。
    - **依赖：** 5.1。**Requirements:** 1.1–1.8。**Properties:** P1。

  - [ ] 5.3 实现 `numeric-ownership-rules.ts`（要求 2）
    - 对每个定义调用 `collectNumericFields` 与 `classifyNumericField`：无唯一分类或分类冲突 → `VALUE_CLASSIFICATION_MISSING`；缺 `Internal_Metric` 标注而以"内部"为由的数值 → `VALUE_CLASSIFICATION_MISSING` / `unlabeled-internal-metric`。
    - 玩家可见 `Gameplay_Value` 不在 1–5 → `VALUE_L3_OWNERSHIP` / `gameplay-value-range`，诊断标明字段、实际值、允许范围与 S-01 来源。
    - 基类或可复用实例内嵌伤害表、概率表、动作价格表、容量表、阈值表、耐久、恢复量、距离、持续时间、生命值、槽位数量或具体动作代价 → `VALUE_L3_OWNERSHIP` / `gameplay-value-in-base-layer`；**不得**以历史示例补写默认值。
    - `Structural_Bound` 与 `Constitutional_Constant` 必须携带权威来源、归属层与结构理由，缺失即拒绝。
    - 验收：1 与 5 边界通过、0 与 6 拒绝；未分类字段拒绝；内部度量不套用 1–5；每条诊断可定位到字段路径。
    - **依赖：** 5.1、2.3。**Requirements:** 2.1–2.7。**Properties:** P2。

  - [ ] 5.4 实现 `write-channel-rules.ts`（要求 3）
    - 拒绝任何声明直接写世界状态、直接修改容器数组、直接修改关系索引或绕过事务执行的定义 → `OP_BYPASS_FORBIDDEN`。
    - 拒绝任何声明新增拾取、丢弃、装备、卸下、死亡物品转移或交易独立写入原语的定义 → `OP_BYPASS_FORBIDDEN` / `new-transfer-primitive`；物品转移引用的 Op 名必须恰为 `item.move`。
    - 校验定义引用的全部 Op 名都在引擎层已注册集合内：测试期用 `createFullHarness(defaultSeedDefs()).registry.listOpNames()` 机械比对，生产期由注入的 `KernelContract.hasOp` 判定；未注册 → `REFERENCE_CONTRACT` / `missing-target`。
    - 校验动作、伤害、状态、资源与网关语义只引用已登记的 `Action_Family`、`Damage_Family`、`Status_Family`、`Movement_Family`、`Gateway_Family`，不复制其底层解释规则。
    - 验收：越权写入声明全部被拒；任何非 `item.move` 的转移 Op 引用被拒；已注册 Op 名比对为机械校验而非硬编码清单。
    - **依赖：** 5.1、4.1。**Requirements:** 3.1–3.5、7.6、10.8。**Properties:** P5。

  - [ ] 5.5 实现 `natural-scene-rules.ts`（要求 4）
    - 校验 `scale` 为 `large`/`medium`/`small` 三值之一，且 `connectionBoundRef` 与 `scale` 一致；定义自带边界数值 → `STRUCTURAL_BOUND_VIOLATION` / `bound-rewritten-as-balance-value`；边界来源或结构理由缺失 → `bound-source-removed`。
    - 校验小场景必须声明 `sharedMicroSceneCapabilityRef` 且 `personalVacantGroundCapabilityRefs` 为空；大/中场景必须缺省 `sharedMicroSceneCapabilityRef`。小场景不得被归类为微型场景。
    - 实现候选地图配置校验 `validateCandidateMapConnectionBounds`：逐节点用 `measureConnectionCount` 现查连接数并与 `SCENE_CONNECTION_BOUNDS[scale].value` 比较；任一越界即拒绝**整份**候选地图配置，诊断报告节点标识、场景类型、实际连接数与结构边界。
    - 拒绝 `concreteMapNodeIds` / `spawnPointIds` / `shrinkOrderIds` 非空 → `LAYER_L3_OWNERSHIP`；具体出生点、关键资源位置、连通性目标、缩圈范围与顺序、地形叙事、地图平衡规则一律不得由本领域指定或推导。
    - 验收：5/4/3 三档边界各有通过与越界例；越界拒绝整份配置而非单节点；连接计数结果带 `Internal_Metric` 标记；具体地图字段全部被拒。
    - **依赖：** 5.1、2.2、3.1。**Requirements:** 4.1–4.7。**Properties:** P3。

  - [ ] 5.6 实现 `micro-scene-rules.ts`（要求 5）
    - 按 design.md 的 `validateMicroScene` 伪代码实现全部检查：父引用缺失、父引用非天然场景族、`creator.immutable !== true`、`creatorAsOwner` / `creatorAsLifecycleDeterminant` / `creatorAsAccessControl` / `ownerField` 出现、`lifecycleDeterminants` 不等于 `{valid-parent, occupancy}`、`occupancySource !== 'derived-query'`、`occupancyCounterField` 出现、`modelsVehicleAsMicroScene` 为真。
    - `triggerKind` 三值（`entity`/`transition`/`structural-shared`）只影响调用点，不得产生第二套生命周期规则；结构性共享微型场景与按需微型场景必须走同一父引用、同一占用查询与同一回收语义。
    - 实现 `validateParentRemoval`：父天然场景被候选事务移除时，必须为每个子微型场景声明 `parentRemovalDisposition`，并为其现查占用者声明合法去向；任一未解决 → `MICRO_SCENE_ATTACHMENT` / `orphaned-child`，整个候选事务拒绝并保持事务前状态。
    - 载具不得被定义为微型场景，也不得以微型场景父级规则决定载具存续。
    - 验收：每条检查有正例与拒绝例；`props.creator` 的任意取值变化不改变生命周期判定结论（由 P4 属性测试断言）；父移除留悬空子引用必定回滚。
    - **依赖：** 5.1、3.1。**Requirements:** 5.1–5.8。**Properties:** P4、P10。

  - [ ] 5.7 实现 `transition-gateway-rules.ts`（要求 6）
    - 校验过渡恰好两个端点、端点 scale 对在允许集合内、方向性合法，并要求通行条件引用、阻挡能力引用、视线/影响传播接口齐备。
    - 校验多阶段互动只由有序 `paidActionSequence` 加 `intermediateStatusRefs` 表达：除末步外每步必须有中间状态；依附动作必须绑定 `hostActionRef` 且不可单独形成决策分支。
    - 校验需要资源、检定或条件的通行互动分别引用资源转换、检定、条件网关契约（D-006 三种网关），具体门槛、成本、成功/失败效果不得内嵌。
    - 拒绝 `boundConcreteSceneIds` / `concreteApCost` / `concreteDistance` / `boundGameModeId` → `LAYER_L3_OWNERSHIP` 或 `VALUE_L3_OWNERSHIP`。
    - D-013 的跳窗距离规则与 D-014 的远程动作流程只能作为玩法层策略输入经 `distancePolicyRef` 与武器参数 Schema 引用，不得提升为不含上下文的引擎层规则；对后者同时挂 `U-SPACE-004` 门禁。
    - 验收：跳窗、楼梯、攀爬、接触、阻挡、视线桥接、距离权重均可由玩法层在该接口上配置而不改动本领域；任何具体成本/距离/伤害/反应窗口出现即拒绝。
    - **依赖：** 5.1、3.1、2.5。**Requirements:** 6.1–6.8。**Properties:** P14、P11。

  - [ ] 5.8 实现 `container-item-rules.ts`（要求 7）
    - 校验容器声明宿主类型、容器角色、槽位接受谓词引用、存取能力、可否存入/取出与转移动作引用；`concreteSlotCount` / `concreteCapacity` 出现即 `VALUE_L3_OWNERSHIP`。
    - 校验物品声明容器资格、装备位置要求、可携带标签、授予动作、附件点、使用位置、消耗行为与可选实体转换能力；`consumptionBehavior === 'charges'` 时 `chargesField` 必填且必须指向参数字段而非具体次数。
    - 校验容器与槽位的实际结构、顺序、插入策略、默认槽位选择、容纳检查与移动失败语义只被**引用**，不被重写（出现重写声明 → `OP_BYPASS_FORBIDDEN`）。
    - 校验死亡容器能力：`depositDisabled` 为 `true`、`depositDisabledMechanism` 为 `'before-item-move-veto'`、`contentSource` 为 `'deceased-entity-transaction'`、`containerRef` 指向新建容器；具体容量、清单可见性、动作成本与物品范围必须由玩法层提供。
    - 拒绝 `volumeClass` / `pocketSlots` 及其他 S-06 已否决携带机制 → `DEPRECATED_MECHANIC`，诊断给出控制来源。
    - 校验重型、可装备、可消耗、可转换等标签作为可组合能力存在，其产生的成本、状态效果、触发时机与数值必须引用玩法层规则。
    - 验收：每条检查有正例与拒绝例；死亡容器三项固定值任一被改动即拒绝；已否决携带机制字段必定被拒并引用来源。
    - **依赖：** 5.1、3.2。**Requirements:** 7.1–7.9。**Properties:** P6、P7、P8。

  - [ ] 5.9 实现 `weapon-damage-rules.ts`（要求 8）
    - 校验武器类型身份存在且三值之一；武器属性（散射/扫射/连发等，原"攻击形状"已废止）、谱型、距离策略、伤害引用、弹药行为、配件兼容性、动作序列、目标上限必须出现在 `compositionRoles` 中而非契约顶层；缺角色 → `REFERENCE_CONTRACT`。
    - 仅以数值区分而创建的武器子类 → `COMPOSITION_CONTRACT` / `value-only-subtype`，修正建议指明改用组合。
    - 校验伤害契约声明伤害类别引用、来源条件、目标条件与结算管道引用，且**不含** `amount` / `critIncrement` / `damageTable`；出现即 `VALUE_L3_OWNERSHIP`。
    - 校验谱型（弹道谱型/距离档，非攻击形状）契约只声明谱型身份与可组合参数接口；`namedFirearmId` / `concreteRangeTable` / `concreteAmmunitionCount` 出现即拒绝。
    - 枪械基础伤害表在任何基类或实例定义中出现即拒绝，并挂 `U-SPACE-001` 门禁；**不得**把未决表项视为零值，也不得用同类武器、同类谱型（弹道谱型）或历史数值做语义替换。
    - 非枪械远程与枪械可引用不同动作序列策略，但阶段、反应条件、命中逻辑、成本与结算结果必须由玩法层配置，并挂 `U-SPACE-004` 门禁。
    - 伤害、命中、弹药、反应或附件引用损坏时拒绝**整个**候选组合。
    - 验收：三类武器身份各有正例；伪子类型被拒；任何伤害表/命中门槛/暴击增量出现即拒绝且携带 `U-SPACE-001`。
    - **依赖：** 5.1、3.3、2.5。**Requirements:** 8.1–8.8。**Properties:** P9、P11。

  - [ ] 5.10 实现 `defense-movement-rules.ts`（要求 9）
    - 校验防具声明装备位置、减伤规则引用、破损条件引用、伤害类别兼容性与状态交互接口；内嵌具体减伤、生命、耐久或破损阈值即 `VALUE_L3_OWNERSHIP`。
    - 校验盾牌声明持有要求、格挡动作引用、损耗规则引用、破损条件引用与可选交互能力；`mvpDefaultInteractionIds` 出现或为可选互动声明默认启用 → 挂 `U-SPACE-006` 门禁拒绝。D-015 所列扔盾/盾击等特殊互动与 D-010 的格斗范围只能作为可选玩法层内容，不得成为标配行为。
    - 校验移动区分地面、载具与其他遍历语义，并把成本、速度、距离、地形修正、载荷修正暴露为参数字段；`concreteCost` / `concreteSpeed` 出现即拒绝。
    - 校验携带标签聚合只经引擎层 query 与 relation 接口（`aggregation === 'kernel-query-relation'`）；由标签直接导出移动成本、状态、清除时机或效果 → `derivedStatusFromTag` 拒绝。
    - 校验状态效果只引用 `Status_Family` 与 `Attachment_Family` 的持续、叠加、触发、打断与清理接口；把引擎层运行时迁移伪装成新基类语义即拒绝。
    - 校验 D-016 已移除的状态不出现在基类、实例、默认标签或隐式状态交互中；发现即拒绝。
    - 验收：三类契约各有正例与拒绝例；盾牌无默认可用性；已移除状态必定被拒。
    - **依赖：** 5.1、3.4、2.5。**Requirements:** 9.1–9.8。**Properties:** P2、P9、P11、P14。

  - [ ] 5.11 实现 `vehicle-rules.ts`（要求 10）
    - 校验 `backingDefKind === 'entity'` 且定义的 `defKind === 'entity'`；映射为 `Item`、映射为 `Micro_Scene`、或以微型场景父子关系绑定载具生命周期 → 拒绝。
    - 校验座位角色、货舱容器、门引用、邻接判定、锁定能力、移动能力、碰撞能力、可定向部件能力与损毁处置接口齐备且全部参数化；座位/货舱/门必须使用引擎层容器、槽位、引用与动作契约，不得定义独立的车内存储、乘员位置或门访问运行时结构。
    - 校验每个 `doorId` 良构且在解析后唯一稳定；`adjacencyComponentId` 与 `doorTargetComponentId` 必须不同，相同即拒绝。
    - 校验 `adjacencyPolicyRef` 指向 `defKind === 'policy'` 且归属层为玩法层（D-030 位置优先于门索引属玩法层策略）；具体门数量、乘员数量或互动结果写为默认值即拒绝。
    - 校验 D-011 所确认的撞击、部件损毁、锁定、推行、车上互动与损毁处置范围**可由该接口表达**（用一组代表性组合断言可表达性），但其具体车辆种类、数值、步骤、目标限制、反应条件与掉落结果全部由玩法层配置。
    - 校验 `interiorMicroSceneBoundary` 出现即挂 `U-SPACE-005` 门禁拒绝；`directOccupantStateWrite` / `directCargoStateWrite` 出现即 `OP_BYPASS_FORBIDDEN`。
    - 验收：载具非实体化必定被拒；门标识稳定唯一；邻接与门目标不可耦合；D-011 全部能力面可表达且不含数值。
    - **依赖：** 5.1、3.5、2.5。**Requirements:** 10.1–10.8。**Properties:** P10、P8、P11。

  - [ ] 5.12 实现 `unresolved-gate-rules.ts`（要求 13）
    - 按 design.md 的 `runUnresolvedGates` 伪代码实现：遍历 `UNRESOLVED_ITEM_CATALOG` 的七项，对每项 `forbiddenSurfaces` 逐一检查候选定义是否有非空值；命中即产出 `UNRESOLVED_ITEM_DEFAULTING` → `E_LOAD_UNRESOLVED_NORMATIVE`，诊断必须携带 `unresolvedId` 与 `forbiddenSurface` 的 JSON 路径。
    - 检查提升尝试：候选若声称提升某未决项但未携带新的控制决策、来源记录、拥有层与替代关系 → `UNRESOLVED_ITEM_PROMOTION` → `E_LOAD_SOURCE_STATUS_PROMOTION`；历史示例不得作为提升依据。
    - 全部七项一次报完，不早停；门禁必须对手写定义、UGC 导入与 UI 请求三条入口同时生效，不存在绕过入口。
    - 验收：七项各有独立的默认化拒绝例；每条诊断可反查到 `U-SPACE-00N`；无任何一项在实现中被赋予默认值。
    - **依赖：** 5.1、2.5。**Requirements:** 13.1–13.9。**Properties:** P11。

- [ ] 6. 实现领域引用能力形状判定（`src/class/space-items/resolution/capability-shape-rules.ts`）
  - 在 `src/l2/resolution/reference-graph.ts` 构建的引用图之上，只补"领域能力形状与语义族兼容性"这一层：对每个类型化引用校验目标的 `Def kind`、语义族与**必需能力**是否满足引用方声明的期望（例如过渡端点必须是天然场景族且具备对应 scale 能力；物品装备位置必须指向声明了该槽位角色的容器；载具货舱必须指向容器族；伤害引用必须指向已登记 `DMG_*` 语义）。
  - 缺失引用 → `E_REF_MISSING`；kind 或族不匹配 → `E_REF_KIND` 并同时报告期望与实际；目标为抽象定义而被实例化 → `E_REF_ABSTRACT`；引用环 → `E_REF_CYCLE` 并列出全部参与者；未定义引用 → `E_LOAD_UNDEFINED_REF`。全部诊断携带引用方的 JSON 路径。
  - 物品组合产生悬空槽位、容器、装备位置、消耗效果、附件点或转换目标时拒绝该组合并保留最后一个有效定义集。
  - 载具涉及容器、座位、门、动作、移动、碰撞、损毁、附件或状态引用时，全部引用必须在激活前验证；任何悬空或不兼容引用原子拒绝。
  - 不重新实现引用图构建、拓扑排序或依赖遍历——只提供 per-reference 的能力形状谓词。
  - 验收：每类引用失效有拒绝例；诊断确定且稳定排序；未激活任何候选。
  - **依赖：** 5.1–5.11、4.1。**Requirements:** 3.7、6.2、7.9、8.8、10.7、12.3。**Properties:** P8。

- [ ] 7. 实现运行时入口（`src/class/space-items/runtime/`）
  - [ ] 7.1 实现 `transfer.ts`
    - 实现 `TransferIntent` 与 `planTransfer(intent, context)`，返回 `ValidatedOpRequest | StructuredRejection`。
    - `opId` 恒为 `'item.move'`：函数签名**不接受** `opId` 入参，实现内**不存在**第二个分支。`purpose`（`pickup`/`drop`/`equip`/`unequip`/`trade`/`death-transfer`/`stow`）只影响 `require` 谓词与 Hook，不影响 `opId`。
    - 前置条件检查顺序固定：物品存在 → 容器存在 → 容器 `depositAllowed`（存入类 purpose）/`withdrawAllowed`（取出类 purpose）→ 依赖 Hook 时 `kernel.hookIntegrationAvailable()`。任一不满足返回带前状态指纹的 `StructuredRejection`，且**不调用** `ActionSubmissionPort.submit`。
    - `args` 恰为 `{ itemId, toContainerId, atSlot? }`，与引擎层 `ItemMoveArgs` 严格一致。
    - 引擎层返回 `E_OP_NO_LEGAL_SLOT` / `E_OP_SLOT_FULL` 时原样透传，**不得**创建地面替代物、销毁物品或改走其他 Op。
    - 验收：所有 `purpose` 的成功路径产出的 `opId` 均为 `'item.move'`；前置失败时提交端口调用次数为零；无合法槽位时容器与物品位置完全不变。
    - **依赖：** 4.2、5.8。**Requirements:** 3.3、3.5、7.4、7.6。**Properties:** P5、P6。

  - [ ] 7.2 实现 `micro-scene-lifecycle.ts`
    - 实现 `MicroSceneEntryIntent` 与 `planMicroSceneEntry(intent, context)`，`opId` 恒为 `'entity.place'`，`args` 映射到引擎层 `EntityPlaceArgs.microScene`（`hostNodeId`、`existingMicroSceneId`、`microSceneDefId`、`capacity`）。
    - `capacity` 只能来自玩法层配置字段的解析结果；本领域**不给默认值**，缺配置时 `capacity` 为 `undefined`（引擎层 `checkMicroSceneCapacity` 在该值缺省时不作限制）。
    - **不构造**独立的节点回收请求，也不调用 `node.destroy`：占用归零后的卸载由 `entity.place` 的 Op 实现内部经 `onMicroSceneOccupantsChanged` 完成。在文件头注释中记录该职责划分及其理由（避免两条互不同步的卸载分支），并引用 design.md 待人工复核项 R-05。
    - 实现 `planParentSceneRemoval`：把候选事务中的子微型场景处置与占用者去向映射为一组有序的引擎层结构性 Op 请求；任一子引用或占用者未解决时返回 `StructuredRejection`，不产出任何请求。
    - 结构性共享微型场景与按需微型场景共用同一实现，仅调用点不同。
    - 验收：`opId` 恒为 `'entity.place'`；不存在 `node.destroy` 调用点；父移除未解决时请求数为零。
    - **依赖：** 4.2、5.6。**Requirements:** 5.4、5.5、5.6、5.7。**Properties:** P4。

  - [ ] 7.3 实现 `rejection.ts` 与 `activateDomainPackage`
    - 实现领域 `StructuredRejection` 构造：必须至少含一个 `Error_Diagnostic`，必须记录 `priorStateFingerprint`（来自 `SnapshotPort` 或 `KernelContract.semanticStateFingerprint()`），诊断按固定键稳定排序。
    - 按 design.md 的 `activateDomainPackage` 伪代码实现激活编排：捕获基线 → 共享 `validatePackage` → 领域规则集 → 引用图 → 领域能力形状判定 → 无 Error 时经内部工厂构造 `ValidatedDomainChangeSet` → 调用 `DefinitionActivationPort.activate`。
    - `ValidatedDomainChangeSet` 的工厂必须是模块私有，绑定候选指纹与验证基线指纹；`src/class/space-items/index.ts` **不导出**该工厂，外部无法用类型断言或来源标签跳过门禁。
    - 任一 `Error_Diagnostic` 使激活为零变更，返回拒绝且保持基线；端口不可用时失败关闭为 `PENDING_CONVERGENCE`。
    - 验收：候选含任一错误时激活端口调用次数为零；`ValidatedDomainChangeSet` 无法从包外构造；拒绝结果始终含 Error 且带前状态指纹。
    - **依赖：** 4.2、5.1–5.12、6。**Requirements:** 12.1、12.4、12.5。**Properties:** P12、P7。

- [ ] 8. 实现适配契约与只读投影（`src/class/space-items/adapters/`）
  - [ ] 8.1 实现 `integration-contract.ts`
    - 实现 `SpaceItemsIntegrationContract`，`domain` 恒为 `'space-items'`，声明 `providerVersion`、`exportedDefKinds`、`exportedFamilies`、`referenceConstraints`、`structuralBounds`、`unresolvedItems`、`sourceRecords`。
    - `unresolvedItems` 必须恰好导出七项 `U-SPACE-00N` 记录，使 UGC / UI / AI / 玩法层能区分已冻结契约与未决边界（要求 14.5）。
    - `structuralBounds` 导出 5/4/3 三档及其权威来源，供上游做一致性核对。
    - 契约集合按 family / kind / reference 稳定排序并产出契约指纹；契约版本变化必须可观察。
    - 明确声明本 Spec **不**向其他领域主张其未定义的具体数值、具体实例、地图规则、NPC 规则、胜负规则或 UI 表现规则（要求 14.4）。
    - 验收：导出内容可被上游 `IntegrationContractCatalog` 直接消费；七项未决记录齐备；相同输入的任意排列产出同一指纹。
    - **依赖：** 2.2、2.5、3.1–3.5、6。**Requirements:** 14.1–14.6、11.8。**Properties:** P11、P13。

  - [ ] 8.2 实现 `domain-projection.ts`
    - 按 design.md 的 `projectDomain` 伪代码实现 `SpaceItemsProjection` 构造：先经 `ActionAvailabilityPort.queryActions` 取合法动作（复用引擎层 `queryActions`，不建第二套判定），再按 `AuthorizationScope` 裁剪场景、微型场景、过渡、容器、物品、装备、载具与合法交互。
    - 实现 `FieldProvenanceView`，对每个语义字段输出三态之一：`frozen-contract` / `play-layer-config` / `unresolved`（含 `unresolvedId`），并携带归属层与来源记录。玩法层提供的数值必须标记为玩法层配置而非基类默认值。
    - 投影为值拷贝后深度冻结（自实现纯函数 `deepFreezeProjection`），不得返回活动对象别名，不得暴露任何写方法。
    - 仅表现字段缺失或损坏时提供类型兼容降级并输出 `PRESENTATION_FALLBACK` Warning，且不改变任何语义字段；语义字段缺失或损坏一律 `SEMANTIC_FIELD_DAMAGED` 拒绝，不发明默认武器、防具、载具、容器、场景、数值、引用或行为。
    - 经投影写入语义字段的尝试返回 `PROJECTION_WRITE` 拒绝并保持请求前状态。
    - 验收：任意嵌套字段的修改尝试不改变语义状态；越权字段不出现在投影中；三态归属可被调用方区分；替换渲染器标识不改变任何动作标识或验证结果。
    - **依赖：** 4.2、7.3。**Requirements:** 11.1–11.8、2.8。**Properties:** P13。

- [ ] 9. 实现领域登记目录（`src/class/space-items/catalog/`）
  - 编写 `space-items.catalog.json`：登记本领域全部语义族、能力形状与参数槽位名，格式与 `src/class/{items,weapons,vehicles,npcs}/index.json` 的既有约定一致（`id` / `name` / `description` / `configurableParameterNames` / `capabilityIds` / `operationChannels`）。
  - 目录**只含能力形状与参数槽位名**，不含任何玩法数值。可配置面一律用 `*Field`（参数字段名）与 `*Ref`（类型化引用）表达，禁止出现 `src/class/__tests__/formal-data-integrity.test.ts` 的 `forbiddenFields` 黑名单字段名（`apCost`、`capacity`、`damage`、`duration`、`hp`、`maxHp`、`range`、`speed`、`armorRating`、`multiplier`、`probability`、`matrix`、`ammoCost`、`damageOnCollision`、`healRate`）。
  - `operationChannels` 只列引擎层已注册 Op 名（`item.move`、`entity.place`、`item.promote`、`entity.demote`、`slot.add`、`slot.del`、`node.create`、`node.destroy`、`link.create`、`link.destroy`、`agent.bind`、`agent.unbind`、`attach.add`、`attach.del`、`prop.set`、`prefab.spawn`），并由测试用 `registry.listOpNames()` 机械比对。
  - 实现 `loader.ts`：经 `src/class/catalog-loader.ts` 的 `parseStrictDataJson(source, sourceId, '基类层')` 严格解析，然后做运行时契约校验（允许键白名单、标识良构、标识全局唯一、能力引用可解析、参数槽位名不重复），失败抛出定位明确的错误。加载结果深度冻结。
  - 结构边界 5/4/3 **不写入本 JSON**，保持在 `model/structural-bounds.ts`。
  - 验收：目录通过 `src/class/__tests__/formal-data-integrity.test.ts` 的全目录扫描（严格解析 + 字段名黑名单）；`loader.ts` 对重复成员、未知键、悬空能力引用均抛错；目录标识与既有 `src/class/**` 目录标识不冲突。
  - **依赖：** 2.1、3.1–3.5。**Requirements:** 1.1、1.2、11.1。**Design:** 目录数据纪律；待人工复核项 R-09。

- [ ] 10. 实现测试设施、导出根与架构测试
  - [ ] 10.1 实现 `testing/generators.ts`
    - 用 `fast-check` 原语实现合法与非法候选生成器，覆盖：天然场景（三档 scale、边界内/越界连接数、具体地图字段）、微型场景（父引用有效/缺失/非天然场景、creator 各种误用、占用计数字段、载具误建模）、过渡（端点数、方向性、缺引用、内嵌数值、多阶段序列缺中间状态、依附动作无宿主）、容器与物品（无合法槽位、具体容量、体积分类/口袋槽位、死亡容器三项固定值被改）、武器与伤害（三类身份、伪子类型、伤害表、命中门槛、特殊档机制）、防具/盾牌/移动（内嵌减伤、默认标配互动、标签直接导出状态、已移除状态）、载具（非实体化、门标识重复/不良构、邻接与门目标耦合、内部微型场景边界、直接状态写入）、数值归属（四分类、1/5 边界、0/6、非整数、非有限、未分类、冲突分类）、引用（悬空、错 kind、错族、抽象目标、环）、未决项（七项各自的 `forbiddenSurfaces`）。
    - 生成器**不得**硬编码任何具名玩法实例（不得出现"霰弹枪""某地图"等具体实例作为基类候选）。
    - 收缩后的反例必须保留最小 JSON 路径、来源记录与诊断重建信息。
    - 验收：每个语义族均可生成合法与非法输入；边界值 1 与 5 可被精确命中；生成器自身有冒烟测试。
    - **依赖：** 2.1–2.5、3.1–3.5。**Requirements:** 12.6、12.7。

  - [ ] 10.2 实现 `testing/observers.ts`
    - 实现只经统一入口的观察器：`observeValidation`、`observeResolution`、`observeActivation`、`observeTransfer`、`observeMicroSceneEntry`、`observeProjection`，全部返回结构化结果（诊断集合 + 前后状态指纹 + 端口调用计数）。
    - 实现受控故障注入 `withFault`：解析失败、引用图失败、端口不可用、Hook 不可用、事务失败、表现字段损坏、语义字段损坏。
    - 实现端口调用计数替身：可断言"失败路径上效果 Op 调用次数为零"与"成功路径上 `item.move` 恰好调用一次"。
    - 观察器**不得**直接修改语义状态，也不得绕过验证器、引用判定、运行时入口或 `OpRegistry`。
    - 验收：故障可重复注入且不改变测试顺序；观察器无写能力；调用计数可精确断言。
    - **依赖：** 7.1–7.3、8.2。**Requirements:** 12.6、12.7、12.8。

  - [ ] 10.3 实现导出根 `index.ts` 与 `__tests__/architecture-boundary.test.ts`
    - `index.ts` 只导出：领域契约类型、结构边界目录、未决目录（只读）、领域诊断类别与映射（只读）、集成契约、只读投影构造、`planTransfer` / `planMicroSceneEntry` / `activateDomainPackage`、端口接口与 unavailable 适配器、目录加载器。**不导出** `ValidatedDomainChangeSet` 工厂、可变预算对象或任何写实现。
    - 架构测试用静态 import 扫描断言：`src/class/space-items/**` 的**公共**模块不 import `WorldState`、`OpRegistry`（值导入）、`Transaction`、Hook dispatcher、持久化 writer、`DefRegistry.register`；对引擎层只允许类型导入与经 `KernelContract` 的间接调用。
    - 扫描 `eval`、`Function` 构造器、`child_process`、动态模块执行与候选字符串执行路径，全部禁止。
    - 断言不存在第二写通道：全仓扫描 `src/class/space-items/**` 中出现的 Op 名字面量，转移类必须只有 `'item.move'`。
    - 断言术语纪律：领域源码与目录中不得出现废用术语（复用 `src/class/__tests__/architecture-terminology.test.ts` 的既有约定）。
    - 验收：故意加入的违规 fixture 会使架构测试失败，正常代码通过。
    - **依赖：** 10.1、10.2。**Requirements:** 1.7、3.1、3.4。**Properties:** P1、P5。

- [ ] 11. 编写 14 个正确性性质的属性测试
  > 全部位于 `src/class/space-items/__tests__/properties/`，一属性一文件，`fast-check` `numRuns` ≥ 100，注释精确包含 `Feature: wakeup-space-items, Property {N}: {property_text}`。禁止 `skip` / `todo` / 标记可选。

  - [ ] 11.1 `p01-provenance-layer.property.test.ts` — Property 1: 来源、层级与建模纪律
    - 生成越层声明、废用术语、已否决机制、缺来源、仅数值差异继承与同级来源冲突的候选，断言全部产生带控制来源与规范术语的 `Structured_Rejection`，且合法候选通过。
    - 标签：`Feature: wakeup-space-items, Property 1: 来源、层级与建模纪律`。
    - **依赖：** 5.2、10.1、10.2。**Requirements:** 1.1–1.8、6.8、8.4。

  - [ ] 11.2 `p02-numeric-ownership.property.test.ts` — Property 2: 数值归属四分类与 1–5 值域
    - 生成四分类组合、1/5 边界、0/6/非整数/非有限、未分类、冲突分类、无来源的非玩家可见值、基类内嵌数值表，断言分类唯一性、1–5 约束、内部度量不套用 1–5、越界与未分类必拒。
    - 标签：`Feature: wakeup-space-items, Property 2: 数值归属四分类与 1–5 值域`。
    - **依赖：** 5.3、10.1。**Requirements:** 2.1–2.8、7.1、8.2、9.1、9.8。

  - [ ] 11.3 `p03-connection-bound.property.test.ts` — Property 3: 天然场景连接数结构边界
    - 生成任意规模的候选地图（三档 scale 混合、连接数在边界内外），断言 5/4/3 恒定、任一越界拒绝整份配置、诊断含节点标识/场景类型/实际值/边界、计数结果带 `Internal_Metric`、改写边界或删除来源必拒。
    - 标签：`Feature: wakeup-space-items, Property 3: 天然场景连接数结构边界`。
    - **依赖：** 5.5、10.1。**Requirements:** 4.1–4.7。

  - [ ] 11.4 `p04-micro-scene-lifecycle.property.test.ts` — Property 4: 微型场景附属与生命周期
    - 生成微型场景、天然场景、占用集合、`props.creator` 变化序列与父场景移除候选事务，断言唯一有效父级、生命周期只由父级与现查占用决定、creator 任意变化不改变结论、creator 误用必拒、父移除未解决子引用或占用者时整体回滚、共享与按需走同一语义。
    - 标签：`Feature: wakeup-space-items, Property 4: 微型场景附属与生命周期`。
    - **依赖：** 5.6、7.2、10.2。**Requirements:** 5.1–5.8、12.5。

  - [ ] 11.5 `p05-single-write-channel.property.test.ts` — Property 5: 唯一写入通道与 `item.move` 唯一转移原语
    - 生成任意 `purpose` 与前置条件组合的转移意图，断言成功路径产出的 `opId` 恒为 `'item.move'` 且提交端口恰好调用一次；断言前置失败、Hook 不可用、端口不可用时效果 Op 调用次数为零；断言旁路写入与新增转移原语声明必拒。
    - 标签：`Feature: wakeup-space-items, Property 5: 唯一写入通道与 item.move 唯一转移原语`。
    - **依赖：** 5.4、7.1、10.2。**Requirements:** 3.1–3.5、7.6、10.8、11.7。

  - [ ] 11.6 `p06-no-legal-slot.property.test.ts` — Property 6: 无合法槽位时不落地不吞掉
    - 生成任意槽位数量、`accepts` 谓词与占用状态的容器，以及任意转移序列，断言无合法槽位时容器、物品位置与槽位占用与操作前完全等价，且不产生地面替代物、不销毁物品、不放入不接受的槽位；指定槽位不可用时同样状态等价。
    - 标签：`Feature: wakeup-space-items, Property 6: 无合法槽位时不落地不吞掉`。
    - **依赖：** 5.8、7.1、10.2。**Requirements:** 3.6、7.3、7.4、12.5。

  - [ ] 11.7 `p07-item-entity-transform.property.test.ts` — Property 7: 物品与实体转换的原子性
    - 生成 `item.promote` / `entity.demote` 序列（含会破坏引用、容器、位置或附件完整性的组合），断言非法转换原子拒绝并保持事务前状态，合法转换后同一 `DefId` 的物品与实体总量守恒且不出现悬空对象。
    - 标签：`Feature: wakeup-space-items, Property 7: 物品与实体转换的原子性`。
    - **依赖：** 5.8、7.3、10.2。**Requirements:** 3.6、7.5、12.5。

  - [ ] 11.8 `p08-reference-completeness.property.test.ts` — Property 8: 引用图完整性与确定性拒绝
    - 生成候选包引用图（含缺失、悬空、错 kind、错族、抽象目标、环、覆盖与删除），断言只有全部引用可解析且无不支持环时可激活；断言所有失效定位到全部参与者、诊断稳定排序；断言物品组合悬空时保留最后一个有效定义集。
    - 标签：`Feature: wakeup-space-items, Property 8: 引用图完整性与确定性拒绝`。
    - **依赖：** 6、10.1。**Requirements:** 3.7、6.2、7.9、8.8、10.7、12.3。

  - [ ] 11.9 `p09-weapon-composition.property.test.ts` — Property 9: 武器、谱型与伤害的无玩法数值组合
    - 生成三类武器身份、组合角色集合、伪子类型、伤害表、命中门槛、暴击增量、具体距离表与弹药数量，断言类型身份来自语义契约、配置全部经组合、伪子类型被拒并建议组合、任何数值面出现即拒且不做语义替换。
    - 标签：`Feature: wakeup-space-items, Property 9: 武器、谱型与伤害的无玩法数值组合`。
    - **依赖：** 5.9、10.1。**Requirements:** 8.1–8.8、9.2。

  - [ ] 11.10 `p10-vehicle-entity.property.test.ts` — Property 10: 载具实体化与交互面独立性
    - 生成载具定义（含映射为 Item / Micro_Scene、以微型场景父子绑定生命周期、门标识重复或不良构、邻接与门目标共用组件、直接乘员/货舱写入），断言全部被拒；断言合法载具的门标识解析后稳定唯一、邻接与门目标为两个独立组合输入。
    - 标签：`Feature: wakeup-space-items, Property 10: 载具实体化与交互面独立性`。
    - **依赖：** 5.11、10.1。**Requirements:** 5.8、10.1–10.8。

  - [ ] 11.11 `p11-unresolved-defaulting.property.test.ts` — Property 11: 未决项禁止默认化
    - 对七项 `U-SPACE-00N` 的每个 `forbiddenSurface` 生成默认化尝试（默认数值、默认流程、默认动作、默认可用性），断言全部被拒且诊断携带对应编号与 JSON 路径；生成无控制决策的提升尝试，断言 `UNRESOLVED_ITEM_PROMOTION`；断言手写、UGC 与 UI 三条入口结果一致。
    - 标签：`Feature: wakeup-space-items, Property 11: 未决项禁止默认化`。
    - **依赖：** 5.12、8.1、8.2、10.1。**Requirements:** 13.1–13.9、14.5。

  - [ ] 11.12 `p12-diagnostic-determinism.property.test.ts` — Property 12: 诊断完整性、确定性与拒绝后状态不变
    - 生成含多个相互独立问题的候选并随机重排定义、字段与来源顺序，断言诊断集合、顺序与人类可读含义字节等价；断言每条诊断字段完整；断言任何拒绝之后注册表、依赖图、快照与语义状态与操作前等价；断言无 Error 的拒绝被识别为无效。
    - 标签：`Feature: wakeup-space-items, Property 12: 诊断完整性、确定性与拒绝后状态不变`。
    - **依赖：** 2.4、7.3、10.2。**Requirements:** 1.8、12.1、12.2、12.4、12.5、12.8。

  - [ ] 11.13 `p13-projection-immutability.property.test.ts` — Property 13: 只读投影不可变且受作用域限制
    - 生成授权范围、运行时语义状态、深层嵌套字段与写入尝试，断言越权字段不出现、投影任意嵌套值不可变且非活动别名、写入尝试返回拒绝并保持请求前状态、三态字段归属可区分、替换渲染器标识不改变动作标识与验证结果。
    - 标签：`Feature: wakeup-space-items, Property 13: 只读投影不可变且受作用域限制`。
    - **依赖：** 8.2、10.2。**Requirements:** 2.8、11.1–11.8。

  - [ ] 11.14 `p14-transition-gateway-composition.property.test.ts` — Property 14: 过渡与网关的可组合接口无具体流程数值
    - 生成过渡与网关组合（端点类型、方向性、条件/阻挡/视线引用、三类网关、多阶段付费序列与中间状态、依附动作宿主绑定、具体成本/距离/伤害/反应窗口/通道/模式绑定），断言合法组合通过、缺引用与内嵌数值必拒、依附动作不能单独形成决策分支。
    - 标签：`Feature: wakeup-space-items, Property 14: 过渡与网关的可组合接口无具体流程数值`。
    - **依赖：** 5.7、5.10、10.1。**Requirements:** 6.1、6.3–6.8、9.3、9.6。

- [ ] 12. 编写单元、契约、集成与故障注入测试
  - [ ] 12.1 单元测试 `__tests__/contracts.unit.test.ts`、`validation-rules.unit.test.ts`、`unresolved-gates.unit.test.ts`
    - 契约单元测试：逐项断言字面量固定值（`backingDefKind === 'entity'`、`bindOpId === 'agent.bind'`、`promoteOpId === 'item.promote'`、`depositDisabled === true`、`depositDisabledMechanism === 'before-item-move-veto'`、`contentSource === 'deceased-entity-transaction'`、`creator.immutable === true`、`creator.purpose === 'provenance-only'`、`carryTagAggregation.aggregation === 'kernel-query-relation'`）；断言 5/4/3 三档边界值、来源与结构理由齐备。
    - 验证规则单元测试：为每条规则各写一个通过例与一个代表性拒绝例，锁定诊断代码、severity、JSON 路径与来源；覆盖 D-006 三网关、D-011 载具能力面可表达性、D-013/D-014 只作为玩法层策略输入、D-015/D-010 可选内容不成为标配、D-016 已移除状态被拒、D-030 归玩法层。
    - 未决门禁单元测试：七项各断言"目录中仍为未决"与"默认化尝试被拒且诊断含编号"；并显式断言 `UNRESOLVED_ITEM_CATALOG.length === 7`。
    - 断言诊断类别映射的封闭性与完整性：每个类别的每个条件都能解析到已登记 `ErrCode`；`ERR_CODES` 未被新增成员（对 `ERR_CODES` 做形状快照断言）。
    - **依赖：** 2.1–2.5、3.1–3.5、5.1–5.12。**Requirements:** 1、4–10、12、13、14 的代表性固定边界。

  - [ ] 12.2 契约测试 `__tests__/l2-shared-contract.test.ts`、`ports-unavailable.contract.test.ts`
    - 断言本领域消费 `src/l2/model/**` 的类型而非自建副本：对共享类型（`Diagnostic`、`ParameterField`、`TypedReference`、`SourceRecord`、`StructuredRejection`）做结构一致性断言；断言领域规则集与 `src/l2/validation` 的规则不产生重复诊断（同一 (定义, 路径, 代码) 唯一）。
    - 断言五个端口的 unavailable 适配器：不调用后续端口、不创建 `ValidatedDomainChangeSet`、不改变语义状态指纹、返回 `E_LOAD_UNRESOLVED_CONTRACT`。
    - 断言 `index.ts` 未导出 `ValidatedDomainChangeSet` 工厂与任何写实现。
    - **依赖：** 4.2、5.1、7.3、10.3。**Requirements:** 3.4、14.5、14.6。

  - [ ] 12.3 集成测试 `__tests__/op-channel.integration.test.ts`
    - 用 `createFullHarness(defaultSeedDefs())` 取得真实接线的 `OpRegistry`（含 Hook 分发），经 `createKernelContractFromOpRegistry` 构造 `KernelContract`，再经 `createActionSubmissionPortFromKernel` 构造提交端口。
    - 断言领域转移真实调用 `item.move` 且状态按引擎层语义变化；无合法槽位时真实返回 `E_OP_NO_LEGAL_SLOT` 且 `holder.getState()` 与调用前引用相等（完全未改变）。
    - 断言 `planMicroSceneEntry` 真实调用 `entity.place` 并创建 `parent` 指向宿主天然场景、`props.creator` 已写入的微型场景节点；断言占用归零后该节点被引擎层内部路径回收，且本领域从未调用 `node.destroy`。
    - 断言 `registry.listOpNames()` 覆盖领域目录 `operationChannels` 的全部条目（机械比对，不硬编码清单）。
    - 断言 Hook 未接线时依赖 Hook 的领域路径被拒且无写入；断言提交前不变量冲突时事务整体回滚。
    - **依赖：** 7.1、7.2、7.3、10.2、10.3、9。**Requirements:** 3.3、3.5、3.6、5.5、7.4、12.5。

  - [ ] 12.4 故障注入测试 `__tests__/failure-injection.integration.test.ts`
    - 用 `withFault` 注入：JSON 解析失败、引用图构建失败、激活端口不可用、解析端口不可用、快照端口不可用、提交端口不可用、Hook 不可用、事务失败、语义字段损坏、表现字段损坏。
    - 每个故障断言：稳定的 Error/Warning 分类与来源/路径信息；Error 使活动定义集、依赖图、快照与语义状态与操作前等价；表现字段故障只产生兼容 Warning 且不改语义；不存在补偿性写入。
    - 断言"未抛异常"不作为通过条件：每个用例都必须断言具体诊断代码与状态等价。
    - **依赖：** 7.3、8.2、10.2。**Requirements:** 11.3、11.4、12.3、12.4、12.5、12.8。

  - [ ] 12.5 目录完整性测试 `__tests__/catalog-integrity.test.ts`
    - 断言 `space-items.catalog.json` 经 `parseStrictDataJson` 解析成功、重复成员被拒、未知键被拒、标识全局唯一且不与既有 `src/class/**` 目录标识冲突。
    - 断言目录中不出现 `forbiddenFields` 黑名单字段名；断言 `operationChannels` 全部为已注册 Op 名。
    - 断言加载结果深度冻结。
    - **依赖：** 9。**Requirements:** 1.1、1.2、11.1。

- [ ] 13. 全量质量门禁与追踪验收
  - 运行 `npm run typecheck`、`npm run lint`、`npm test`（`vitest run`），全部通过；对照任务 1.1 的实施前基线，确认没有新增失败，也没有通过放宽断言、跳过测试或修改 `vitest.config.ts` / `tsconfig.json` / eslint 范围来"变绿"。
  - 机械核验属性测试交付强度：全仓扫描 `src/class/space-items/__tests__/properties/` 恰有 14 个文件、每个文件恰有一个 `fc.assert`、`numRuns` ≥ 100、标签字符串与 design.md 的 14 项性质标题逐字一致、无 `skip` / `todo`。该核验本身写成一个测试文件，使违规会直接导致测试失败。
  - 核验 `U-SPACE-001` ~ `U-SPACE-007` 全部仍为未决：`UNRESOLVED_ITEM_CATALOG` 七项齐备，且集成契约导出的 `unresolvedItems` 与之一致。
  - 核验需求追踪：design.md 的需求追踪矩阵中每条需求都至少有一个已实现组件与一个已通过测试；未能端到端验证的条目（要求 3.6、11.5、12.4、12.8 的上游依赖部分）必须在验收记录中显式标注为"仅验证失败关闭行为"，不得记为完整通过。
  - 撰写 `src/class/space-items/决策与风险记录.md`：记录实现期新增的全部自主判断、与 design.md 待人工复核项 R-01 ~ R-11 的对应关系、遇到的耗时较久的缺陷及其逻辑成因，并明确列出未完成部分、有问题的代码与需后续拓展之处。
  - **禁止**在本任务中把任何未通过验证的模块标记为完成；**禁止**自行裁决 `U-SPACE-001` ~ `U-SPACE-007` 或 design.md 待人工复核项。
  - **依赖：** 11.1–11.14、12.1–12.5。**Requirements:** 1–14 全部。

## Notes

- 实现语言为 TypeScript，测试用 Vitest 与 `fast-check`，与 design.md 的 Testing Strategy 一致，也与仓库既有约定一致（`src/class/__tests__/**` 已在用同一组合）。
- 每个 Property 1–14 有且只有一个属性测试文件，每项至少 100 次生成运行，注释使用 `Feature: wakeup-space-items, Property {N}: {property_text}`，`{property_text}` 与 design.md 的性质标题逐字一致。
- 测试层次互补：属性测试覆盖输入空间可变的领域规则；单元测试锁定固定决策与代表性拒绝例；契约测试防止与 `src/l2/` 分叉；集成测试用 `createFullHarness` 验证真实 Op 链路、事务回滚与 Hook 分发；故障注入验证失败路径无部分激活与无写入。
- 本计划不创建任何新的引擎层机制，不复制 Op / 事务 / Expr / Hook / 持久化 / 随机流；运行时写入必须经 `OpRegistry.invoke`，物品转移必须经 `item.move`。
- 本计划不把具体地图、命名武器、命名载具、具体 NPC、出生分布、缩圈顺序、胜负规则或任何玩法数值登记为基类；玩法层具体数值仍须由玩法层提供且玩家可见值落在 1–5。
- `U-SPACE-001`（枪械基础伤害表与 AP 平衡）、`U-SPACE-002`（掩体机制）、`U-SPACE-003`（谱型「特殊」档机制框架）、`U-SPACE-004`（远程多阶段流程跨文档对齐）、`U-SPACE-005`（载具内部微型场景与外部交互点边界）、`U-SPACE-006`（盾牌 MVP 标配范围）、`U-SPACE-007`（丢弃物品依附时机）在本计划与实现中**均不得自行定案**。
- design.md 待人工复核项 R-01 记录了一项真实的上游冲突：`docs/访谈决策记录.md` 与 `docs/审查状态综合报告.md` 已把 `U-SPACE-002` / `U-SPACE-005` / `U-SPACE-007` 记为结构已冻结 / 部分冻结 / 已关闭。若人工确认应以该状态表为准，需先修订 `requirements.md` 要求 13，再回改任务 2.5、5.12、8.1、11.11 与 12.1。**在此之前不得按状态表实现。**
- design.md 待人工复核项 **R-14 与 R-15 是两项高优先级上游冲突**，会直接影响任务 2.2、3.1、5.5、5.6、12.5 的产出正确性：`src/class/scenes/index.json` 现登记「三档统一连接上限 5」与「微型场景父级仅限小场景」，与 `requirements.md` 要求 4.2 / 5.1 及 `docs/L2_基类层/03_空间系统.md` 冲突。未裁决前按 requirements.md 实施并显式记录不一致；**不得**为求目录一致而改写任一方。R-16 记录了 `scenes/index.json` 引入的天然场景层级容纳关系尚未纳入本领域契约。
- design.md 待人工复核项 **R-17** 记录了 `src/class/` 在设计撰写期间被并行会话扩充，因此 design.md 中关于该目录的全部现状陈述都必须由任务 1.1 重新核验。
- design.md 待人工复核项 R-08 记录了 `src/l2/validation/spatial-rules.ts` 与 `item-vehicle-rules.ts` 已实现本领域一部分检查。本计划按"纳入同一执行序并补齐缺口"实施；若人工判定应整体迁入本领域，任务 3 与任务 5 需相应改写。
- 任务引用中的需求编号对应 `requirements.md`，设计引用对应 `design.md`，性质编号对应 design.md 的 Correctness Properties。若未来权威决策改变未决内容或上游端口形状，应先更新需求与设计，再修订本计划。
- 所有任务默认未完成。状态标记只能由实际执行并验证通过的代理写回；本计划不预先把任何任务标为完成，也不使用 `[Pending]`、`[-]`、`[~]` 等混合标记。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 4, "tasks": ["2.5"] },
    { "id": 5, "tasks": ["3.1", "3.2", "3.3", "3.4", "4.1"] },
    { "id": 6, "tasks": ["3.5", "4.2"] },
    { "id": 7, "tasks": ["5.1"] },
    { "id": 8, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "5.12"] },
    { "id": 9, "tasks": ["6", "9"] },
    { "id": 10, "tasks": ["7.1", "7.2", "7.3"] },
    { "id": 11, "tasks": ["8.1", "8.2"] },
    { "id": 12, "tasks": ["10.1", "10.2"] },
    { "id": 13, "tasks": ["10.3"] },
    {
      "id": 14,
      "tasks": [
        "11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7",
        "11.8", "11.9", "11.10", "11.11", "11.12", "11.13", "11.14",
        "12.1", "12.2", "12.5"
      ]
    },
    { "id": 15, "tasks": ["12.3", "12.4"] },
    { "id": 16, "tasks": ["13"] }
  ]
}
```
