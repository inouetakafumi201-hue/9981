# Implementation Plan: WakeUp 空间与物品基类层

> ## 本版取代旧版（2026-08-09 按 D-058 重写）
>
> **旧版为什么不可执行**：旧计划的全部 13 个任务都指向新建 `src/class/space-items/{model,contracts,ports,validation,resolution,runtime,adapters,catalog,testing,__tests__}`。
> **D-058 已裁决否决该目录**。因此旧计划是针对被否决架构写的实现路线，逐条执行都会产出违反裁决的目录树。
>
> 本版把每一条旧任务重写为三类可执行动作之一：
>
> | 类型 | 含义 | 落点 |
> |---|---|---|
> | **A 校验既有** | 核对既有实现是否已覆盖某条要求，产出证据或缺口清单 | 只读 + 产出记录 |
> | **B 补验证面** | 在既有 `src/l2/` 模块内补上未覆盖的校验/契约/适配 | `src/l2/{model,validation,resolution,adapters}/space-items-*.ts` |
> | **C 补目录字段** | 在既有 `src/class/<族>/index.json` 补字段或修正与裁决冲突的描述 | `src/class/<族>/index.json` |
>
> **不新建 `src/class/space-items/`。本文件中不存在该路径的任何引用。**

## §0 落点裁决（D-058）与旧任务映射

### 0.1 三个落点

| 产物类别 | 落点 | 依据 |
|---|---|---|
| 目录数据（族 / 能力 / 参数槽位名 / 禁止面 / 未决登记） | 既有 `src/class/<族>/index.json` **扩展**，不并列第二套分类 | D-058 |
| 领域验证规则 | 既有 `src/l2/validation/*.ts`，新增文件以 `space-items-` 前缀命名并挂进 `DEFINITION_RULES` | D-058 |
| 领域模型（标识 / 结构边界 / 数值归属 / 诊断类别 / 未决目录） | 既有 `src/l2/model/space-items-*.ts`（**已存在，见 §2.2**） | D-058 |
| 领域引用能力形状 | 既有 `src/l2/resolution/` | D-058 |
| 跨层适配（领域意图 → 引擎层 Op 请求、集成契约、领域投影） | 既有 `src/l2/adapters/` | D-058 |
| 测试 | `test/l2/space-items/**`（vitest 已 include `test/l2/**`，无需改配置） | 工具链现状，§1 |

> **自主判断（本次重写）**：D-058 只点名了「目录数据 / 领域验证 / 跨层适配」三处落点，没有为「领域运行时入口」（转移意图规划、微型场景进入规划）指定落点。
> 本版把它归入 `src/l2/adapters/`，理由是这两个函数的职责恰是「把领域意图适配成引擎层 Op 请求」，属跨层适配；
> 且提交必须复用既有唯一提交通道 `src/l2/registry/action-submitter.ts`，不得新建第二条提交路径。
> 此判断需人工确认，已登记为 §6 的 **H-03**。

### 0.2 旧任务 → 新落点映射（逐条，无遗漏）

| 旧任务 | 旧落点（已否决） | 本版处理 | 新落点 |
|---|---|---|---|
| 1.1 基线 | — | 保留，改为核验 §2 现状 | 任务 0.1 |
| 1.2 端口证据 | `ports/` | 保留证据核验，删除"五端口"抽象（既有 `KernelContract` 已是端口） | 任务 0.2 |
| 1.3 错误码核实 | — | 保留 | 任务 0.3 |
| 2.1 `model/domain-ids.ts` | `src/class/space-items/model/` | **已落地**，需接线 + 测试 | `src/l2/model/space-items-domain-ids.ts` |
| 2.2 `model/structural-bounds.ts` | 同上 | **已落地**（单一 5，已按 D-057），需接线 + 测试 | `src/l2/model/space-items-structural-bounds.ts` |
| 2.3 `model/numeric-ownership.ts` | 同上 | **已落地**，需接线 + 测试 | `src/l2/model/space-items-numeric-ownership.ts` |
| 2.4 `model/diagnostic-categories.ts` | 同上 | **已落地**，需接线 + 测试 | `src/l2/model/space-items-diagnostic-categories.ts` |
| 2.5 `model/unresolved.ts` | 同上 | **已落地**（七项齐备），需接线 + 测试 | `src/l2/model/space-items-unresolved.ts` |
| 3.1 空间契约 | `contracts/space-contracts.ts` | 改为**扩展**既有 `family-contracts.ts` 的差集 | `src/l2/model/space-items-contracts.ts` |
| 3.2 容器物品契约 | 同上 | 同上（`ContainerContract` 是真缺口，见 §3 要求 7.1） | 同上 |
| 3.3 武器伤害契约 | 同上 | 同上（`ProfileContract` 是真缺口，见 §3 要求 8.3） | 同上 |
| 3.4 防具移动契约 | 同上 | 同上（`ShieldContract` 是真缺口，见 §3 要求 9.2） | 同上 |
| 3.5 载具契约 | 同上 | 同上（补齐性校验面） | 同上 |
| 4.1 五端口接口 | `ports/` | **删除**。既有 `src/l2/kernel/kernel-contract.ts` + `registry/` 已是端口；再造一套是职责重复 | — |
| 4.2 unavailable 适配器 | `ports/` | **收窄**为"领域路径在 `KernelContract` 能力缺失时失败关闭" | 任务 4.3 |
| 5.1 上下文与规则序 | `validation/` | 改为把领域规则挂进既有 `DEFINITION_RULES` | `src/l2/validation/validator.ts` |
| 5.2–5.12 十一条规则集 | `validation/` | 逐条比对既有覆盖后只补缺口 | `src/l2/validation/space-items-*.ts` |
| 6 引用能力形状 | `resolution/` | 保留 | `src/l2/resolution/space-items-capability-shape.ts` |
| 7.1 转移入口 | `runtime/transfer.ts` | 保留，落适配层 | `src/l2/adapters/space-items-transfer.ts` |
| 7.2 微型场景入口 | `runtime/micro-scene-lifecycle.ts` | 保留，落适配层 | `src/l2/adapters/space-items-micro-scene.ts` |
| 7.3 激活编排 | `runtime/rejection.ts` | **删除**。既有 `registry/definition-registry.ts` + `validation/package-validation.ts` 已是原子激活编排 | — |
| 8.1 集成契约 | `adapters/` | 保留 | `src/l2/adapters/space-items-integration-contract.ts` |
| 8.2 领域投影 | `adapters/` | 保留（三态字段归属是真缺口） | `src/l2/adapters/space-items-projection.ts` |
| 9 领域登记目录 | `catalog/space-items.catalog.json` | **改为**校验并补齐既有 `src/class/<族>/index.json` | `src/class/<族>/index.json` |
| 10.1 生成器 | `testing/generators.ts` | 改为扩展既有 `src/l2/testing/definition-generators.ts` | `src/l2/testing/space-items-generators.ts` |
| 10.2 观察器 | `testing/observers.ts` | 改为复用既有 `src/l2/testing/test-interface.ts` | 同上 |
| 10.3 导出根 + 架构测试 | `index.ts`、`__tests__/` | 改为扩展 `src/l2/index.ts` + 新架构测试 | `test/l2/space-items/architecture-boundary.test.ts` |
| 11.1–11.14 十四属性测试 | `src/class/space-items/__tests__/properties/` | 保留，改落点 | `test/l2/space-items/properties/` |
| 12.1–12.5 单元/契约/集成/故障注入 | 同上 | 保留，改落点 | `test/l2/space-items/{unit,integration}/` |
| 13 质量门禁 | — | 保留 | 任务 9 |

## §1 工具链事实（2026-08-09 实测复核，已修正旧版过时项）

| 约束 | 实测事实 | 后果 |
|---|---|---|
| 测试发现范围 | `vitest.config.ts` 的 `include` = `src/**/*.test.ts`、`test/l2/**/*.test.ts`、`test/properties/**/*.test.ts` | 领域测试落 `test/l2/space-items/**` **会被执行**。旧版"测试必须写在 `src/**` 否则不被执行"**已过时**。 |
| 类型检查范围 | `tsconfig.json` 的 `include` = `["src", "test"]` | `test/**` 已被 `npm run typecheck` 覆盖。旧版表述**已过时**。 |
| L2 隔离门禁 | `tsconfig.l2.json` 的 `include` = `["src/l2", "test/l2", "src/core/kernel/ops/registry.ts", "src/core/kernel/ops/result.ts"]`，由 `npm run typecheck:l2` 运行 | **领域实现落 `src/l2` + `test/l2` 后必须同时通过 `typecheck:l2`**。这意味着领域代码只能依赖 `src/l2` 内部与这两个 kernel 文件；引用其它 kernel 路径会使该门禁失败。**这是本版新增的硬约束，旧版未提及。** |
| Lint 范围 | `package.json` 的 `lint` = `eslint src test --ext .ts,.tsx` | `test/**` **已被 lint 覆盖**（PT-06 已落地，见 `.eslintrc.cjs` 头注释）。旧版"lint 只覆盖 src"**已过时**。 |
| 命令 | `npm test`、`npm run typecheck`、`npm run typecheck:l2`、`npm run lint`、`npm run verify`（三合一） | 不使用 watch 模式。 |
| 模块别名 | 无 `@kernel/*`。`src/l2` 内部一律相对路径且带 `.js` 后缀（`moduleResolution: "Bundler"`，既有代码全部如此） | 新增文件必须沿用 `./xxx.js` 形式。 |
| 错误码 | `src/core/kernel/state/error-codes.ts` 的 `ERR_CODES` | **不得新增成员**；领域类别只能映射到已登记码。 |
| 基类层目录纪律 | `src/class/**` 的 JSON 受 `src/class/__tests__/formal-data-integrity.test.ts` 严格解析与字段名黑名单约束 | 目录 JSON 只能用 `*Field` / `*Ref` / 参数 `key` 表达可配置面；结构边界数值放 TypeScript。 |

本计划**不修改** `vitest.config.ts`、`tsconfig.json`、`tsconfig.l2.json`、`package.json` scripts 或 `.eslintrc.cjs`。

### 交付强度

- 不做 MVP、不留占位、不写 `TODO`、不省略内容。每个任务的产出都是完整可编译、可运行的实现。
- 14 个属性测试是**必交付项**，一属性一文件、`fast-check` `numRuns` ≥ 100，标签格式 `Feature: wakeup-space-items, Property {N}: {property_text}`。不得标记可选、不得 `skip`/`todo`。
- 未决门禁**按现行 requirements 分级**：`U-SPACE-001`、`003`、`004`、`006` 及各项**数值部分**保持未决；`002` 的二维正交结构、`005` 的"载具不建模为微型场景"、`007` 的零费菜单归属**已冻结、应当实现**。
- 实现期产生的自主判断必须逐条追加到 §6 并在任务记录中标明，不得静默采纳。

## §2 现状基线（2026-08-09 实测，不是推测）

### 2.1 `src/class/` 实际目录清单

```
src/class/catalog-loader.ts   class-contract.ts   json-contract.ts   决策与风险记录.md
src/class/{actions,attachments,containers,damage-types,gateways,items,movement,
           npcs,scenes,skills,statuses,vehicles,vulnerability-types,weapons}/index.json
src/class/items/item-types.ts
src/class/schemas/{catalog-metadata,class-catalog,damage-type,status-effect,vulnerability-type}.schema.json
src/class/statuses/status_*.json（19 个）
src/class/__tests__/{architecture-terminology,class-contract-completeness,class-contract-guards,
                     class-semantic-families,formal-data-integrity}.test.ts + catalog-fixtures.ts
```

**关键事实（推翻旧计划的多处假设）**：

1. **不存在 `armor/`、`shields/`、`profiles/` 独立目录**。防具与盾牌是 `items/index.json` 的 `item.capability.armor` / `item.capability.shield`，且 `prohibition.item.armor_as_separate_base_class` 明确禁止把防具立为独立基类。**本计划不得为防具/盾牌新建目录。**
2. **`weapons/index.json` 里没有 `spectrum-class.*`**。实际登记的是 `weapon-class.{melee,ranged_nonfirearm,firearm}`、`damage-class.{firearm,physical}`、`weight-tier.{light,medium,heavy}`、`range-tier.{close,medium,long,extreme}`、`band-axis.{handling-weight,range-band}`，能力为 `weapon.capability.{scatter_attribute,sweep_attribute,burst_attribute,range_profile,handling_profile,damage_reference,target_limit,ammunition_binding,accessory_compatibility}`。旧计划任务 3.3 引用的 `spectrum-class.single/scatter/area` 与 `spectrumAxes` **已随攻击形状一并删除，不存在**。
3. **`damage-types/index.json` 里没有 `DMG_*` 标识**，只有 `damage-axis.category` 与四条 prohibition。**`vulnerability-types/index.json` 里没有 `WKN_*`**，只有 `vulnerability-axis.category` 与两条 prohibition。旧计划任务 3.3 的 `DMG_*` / `WKN_*` 引用**是过时的**。
4. `scenes/index.json` **已按 D-056 / D-057 更新**：三档 `admitsMicroScene: true`，三档共用 `connectionBoundId: "structural-bound.scene.connection_limit"`，`micro-scene.class.contact.admittedParentSceneScales: ["large","medium","small"]`，`admittedChildSceneScales` 的 `childSceneRefs` / `parentSceneRef` 参数描述已注明"只服务地图编排校验，不得被编译进运行期节点的附属字段"。**旧计划任务 1.1 / 3.1 里"需把 large/medium 的 admitsMicroScene 改 true"的待办已完成。**
5. `scenes/index.json` 仍有 **一处 D-056 残留冲突**：`scene.valueset.scene_scales` 中 `small` 的 description 为「唯一可承载微型场景的天然场景」。见任务 3.1。
6. `vehicles/index.json` 仍把 `interior.isMicroScene` 登记为 **Q-04 未决下的可配置参数名**（`unresolvedItems[Q-04].handling`），与 D-038「载具内部不建模为微型场景」冲突。见任务 3.2。

### 2.2 领域模型已落地但是**死代码**（本版最重要的基线发现）

`src/l2/model/` 下已存在五个按 D-058 落点写好的领域模型文件：

```
src/l2/model/space-items-domain-ids.ts
src/l2/model/space-items-structural-bounds.ts
src/l2/model/space-items-numeric-ownership.ts
src/l2/model/space-items-diagnostic-categories.ts
src/l2/model/space-items-unresolved.ts
```

**实测状态**：全仓 `Select-String -Pattern 'space-items'` 的结果显示，除 `space-items-unresolved.ts` import `space-items-diagnostic-categories.js` 之外，**这五个文件没有任何其它消费者**：

- 未从 `src/l2/model/index.ts` 导出；
- 未被 `src/l2/validation/**` 任何规则引用；
- 未被 `src/l2/adapters/**`、`src/l2/registry/**`、`src/l2/resolution/**` 引用；
- `src/l2/**` 与 `test/l2/**` 下**没有任何针对它们的测试**（`src/l2` 树内零 `*.test.ts` 文件，l2 的测试全在 `test/l2/**` 与 `test/properties/**`）。

**结论**：旧计划的任务 2.1–2.5 的**内容已产出但未接线、未验证**。它们当前的正确性没有任何门禁保障（只被 `tsc` 检查语法与类型，不被任何断言检查语义）。
本版把"接线 + 测试"列为任务 1，优先级最高——因为后续所有验证规则都要消费它们。

**不得**把这五个文件当作"已完成"计入交付；也**不得**因为它们已存在就跳过测试。

### 2.3 `src/l2/` 实际模块树

```
src/l2/index.ts   决策与风险记录.md
src/l2/adapters/{ai-adapter,ui-adapter,index}.ts
src/l2/codec/{decode,definition-decoder,family-decoder,index,json-canonicalizer,json-codec,
              json-scanner,prohibited-constructs,schema-decoder}.ts
src/l2/compiler/{conflict-resolver,decision-catalog,deprecated-mechanics,index,
                 source-classifier,specification-compiler,types}.ts
src/l2/kernel/{kernel-contract,op-registry-adapter}.ts
src/l2/model/{constitution,def-kind,definition,diagnostic-codes,diagnostic-factory,diagnostic,
              family-contracts,ids,immutable,index,json,ordering,projection,reference,result,
              schema,snapshot,source}.ts + 上述五个 space-items-*.ts
src/l2/registry/{action-submitter,canonical-snapshot,definition-registry,index,read-only-projection}.ts
src/l2/resolution/{definition-resolver,dependent-revalidation,index,reference-collector,reference-graph}.ts
src/l2/testing/{builders,definition-generators,index,test-interface}.ts
src/l2/ugc/{index,ugc-adapter}.ts
src/l2/validation/{action-gateway-rules,classification-rules,context,effect-ai-rules,helpers,index,
                   inheritance-composition-rules,item-vehicle-rules,package-validation,
                   parameter-rules,spatial-rules,validator}.ts
```

**旧计划任务 1.2 记录的"缺失能力"清单已全部过时**：`src/l2/registry/`、`src/l2/adapters/`、`src/l2/testing/` 都已存在；`resolution/definition-resolver.ts`、`resolution/dependent-revalidation.ts`、`validation/package-validation.ts` 都已存在。因此旧计划任务 4（五端口 + unavailable 适配器）失去前提，本版删除。

### 2.4 既有验证规则的实际覆盖面（按文件与诊断码实测）

| 文件 | 规则函数 | 实测发出的诊断码 |
|---|---|---|
| `classification-rules.ts` | `validateDefKind` | `DEF_INVALID_DEF_KIND` |
| | `validateNoL1Mechanism` | `LAYER_L1_OWNERSHIP` |
| | `validateNoGameplaySpecificRule` | `LAYER_L3_OWNERSHIP` |
| | `validateNoUnclassifiedGameplayValue` | `VALUE_L3_OWNERSHIP` |
| | `validateTerminology` | `TERM_DEPRECATED_LAYER_TERM` |
| | `validateNoDeprecatedMechanic` | `SOURCE_DEPRECATED_MECHANIC` |
| | `validateSemanticFamily` | `FAMILY_UNREGISTERED`、`FAMILY_COMBINATION_INSTANCE_AS_BASE`、`DEF_MISSING_SOURCE_RECORD` |
| | `validateAbstractInstantiation` | `DEF_INSTANCE_CARRIES_GAMEPLAY_VALUE`、`DEF_INSTANCE_CARRIES_GAMEPLAY_RULE` |
| `parameter-rules.ts` | `validateParameters` | `SCHEMA_FIELD_MISSING_CLASSIFICATION`、`SCHEMA_FIELD_REFERENCE_TARGET_MISSING`、`SCHEMA_GAMEPLAY_TABLE_IN_L2`、`SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE`、`SCHEMA_STRUCTURAL_BOUND_MISSING_SOURCE`、`SCHEMA_STRUCTURAL_BOUND_MISSING_RATIONALE`、`SCHEMA_CONSTITUTIONAL_CONSTANT_MISSING_SOURCE`、`SCHEMA_CONSTITUTIONAL_CONSTANT_MISSING_LAYER`、`SCHEMA_INTERNAL_METRIC_MISSING_SCHEMA`、`SCHEMA_FIELD_DUPLICATE_NAME`、`SCHEMA_FIELD_RANGE_MALFORMED`、`SCHEMA_CROSS_FIELD_CONSTRAINT_UNRESOLVED` |
| `inheritance-composition-rules.ts` | `validateInheritanceTypeIdentity` | `INHERIT_GAMEPLAY_VALUE_ONLY_DIFFERENCE`、`INHERIT_NO_TYPE_IDENTITY_DIFFERENCE` |
| | `validateMultiInheritanceMerge` | `INHERIT_FIELD_CONFLICT_WITHOUT_RULE` |
| | `validateComposition` | `COMPOSE_DUPLICATE_COMPONENT`、`COMPOSE_ORDER_DEPENDENCY_UNDECLARED` |
| `action-gateway-rules.ts` | `validateAction` | `ACTION_MISSING_CONTRACT_FIELD`、`ACTION_MULTI_AP_ATOMIC_COST`、`ACTION_ATTACHED_NONZERO_COST`、`ACTION_ATTACHED_WITHOUT_HOST`、`ACTION_ATTACHED_AS_DECISION_BRANCH`、`ACTION_SEQUENCE_MISSING_INTERMEDIATE_STATUS` |
| | `validateGateway` | `GATEWAY_KIND_AMBIGUOUS`、`GATEWAY_MISSING_CONTRACT_FIELD`、`GATEWAY_NAMED_GAMEPLAY_ENTITY`、`GATEWAY_CONCRETE_THRESHOLD` |
| `effect-ai-rules.ts` | `validateDamage` | `DAMAGE_ASSIGNS_AMOUNT`、`DAMAGE_MISSING_CONTRACT_FIELD` |
| | `validateStatus` | `LAYER_L1_RUNTIME_STATE`、`STATUS_PSEUDO_SUBTYPE`、`STATUS_INTERACTION_WITHOUT_RULE` |
| | `validateSkill` / `validateAttachment` | `SKILL_MISSING_CONTRACT_FIELD` / `ATTACHMENT_MISSING_CONTRACT_FIELD` |
| | `validateMovement` | `MOVEMENT_PARAMETER_NOT_L3_OWNED` |
| | `validateAiBehavior` / `validateAiPolicyCategory` | `AI_REDEFINES_L1_INTERFACE`、`AI_EMBEDDED_GAMEPLAY_DETAIL`、`AI_REQUIRED_ACTION_SET_EMPTY`、`AI_POLICY_CATEGORY_MISMATCH` |
| `spatial-rules.ts` | `validateSpatial` | 天然场景：具体地图节点、连接边界越界/无来源、小场景共享微型场景与个人空旷地排除；微型场景：父引用非空、`ownerField`、`creator` 可变、生命周期判定项；过渡：端点数 |
| `item-vehicle-rules.ts` | `validateItemsAndVehicles` | 武器：具体伤害值、谱型玩法耦合、特殊档机制（Q-01 提升门禁）；物品：防具减伤引用缺失、防具内嵌具体实例、消耗品效果引用、`chargesField`、死亡容器 `depositDisabled` / `contentSource`、重型标签聚合通道；载具：非实体化、门标识不稳定、邻接与门目标耦合、D-030 策略越层、`interiorMicroSceneBoundary`（Q-04 门禁） |

### 2.5 既有共享设施（本领域必须复用，不得再造）

| 能力 | 既有落点 |
|---|---|
| 唯一提交通道（领域 → 引擎层 Op） | `src/l2/registry/action-submitter.ts`（含 `priorFingerprint`、`PROJECTION_WRITE_REJECTED`） |
| 原子激活与回滚 | `src/l2/registry/definition-registry.ts`、`src/l2/validation/package-validation.ts` |
| 只读投影 | `src/l2/registry/read-only-projection.ts`（`deepClonePlain` + `deepFreeze` + `semanticStateFingerprint`） |
| 引用图 / 依赖重验证 | `src/l2/resolution/{reference-graph,reference-collector,definition-resolver,dependent-revalidation}.ts` |
| 引擎层端口 | `src/l2/kernel/kernel-contract.ts` + `op-registry-adapter.ts` |
| 诊断构造与排序 | `src/l2/model/{diagnostic,diagnostic-factory,diagnostic-codes,ordering}.ts` |
| 不可变工具 | `src/l2/model/immutable.ts`（`deepFreeze`、`deepClonePlain`） |
| UGC / UI / AI 适配 | `src/l2/ugc/ugc-adapter.ts`、`src/l2/adapters/{ui-adapter,ai-adapter}.ts` |
| 测试设施 | `src/l2/testing/{builders,definition-generators,test-interface}.ts`（含故障注入 `E_OP_VETOED` / `E_INV_DANGLING` / `E_FLOW_ABORT`） |
| 废案机制检测 | `src/l2/compiler/deprecated-mechanics.ts` |
| 同级来源冲突裁决 | `src/l2/compiler/conflict-resolver.ts` |

## §3 Requirements 1–14 覆盖矩阵

图例：**✅ 已覆盖** = 有实测证据的既有实现；**◐ 部分覆盖** = 有实现但缺面；**⬜ 待补** = 无实现证据；**⚠ 冲突** = 既有实现与已确认裁决不一致。

### 要求 1：来源追踪、层级边界与建模纪律

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 1.1 只登记可枚举可组合语义基类 | ✅ | `src/class/<族>/index.json` 十四族已登记；`classification-rules.ts::validateSemanticFamily`（`FAMILY_UNREGISTERED`、`FAMILY_COMBINATION_INSTANCE_AS_BASE`） | 0.4 |
| 1.2 唯一标识 / 合法 Def kind / 族 / 抽象 / Schema / Source_Record | ✅ | `validator.ts` 的包形状校验 + `validateDefKind` + `DEF_MISSING_SOURCE_RECORD` | 0.4 |
| 1.3 继承只表达类型身份，其余靠组合 | ✅ | `inheritance-composition-rules.ts::validateInheritanceTypeIdentity`（`INHERIT_NO_TYPE_IDENTITY_DIFFERENCE`）+ `validateComposition` | 0.4 |
| 1.4 仅数值差异继承 → `VALUE_L3_OWNERSHIP` | ◐ | 既有码为 `INHERIT_GAMEPLAY_VALUE_ONLY_DIFFERENCE`，语义等价但**不是** requirements 写的 `VALUE_L3_OWNERSHIP`。需在领域诊断类别映射里登记等价关系，或确认以既有码为准 | 0.4、4.1、§6 H-01 |
| 1.5 具体地图 / 出生 / 胜负 / 模式 / 命名实例 → `LAYER_L3_OWNERSHIP` | ✅ | `validateNoGameplaySpecificRule` | 0.4 |
| 1.6 重声明引擎层机制 → `LAYER_L1_OWNERSHIP` | ✅ | `validateNoL1Mechanism`（复用 `L1_MECHANISM_DECLARATION_KEYS`） | 0.4 |
| 1.7 废用术语 / 已否决机制 → `Structured_Rejection` | ✅ | `validateTerminology` + `validateNoDeprecatedMechanic`（`src/l2/compiler/deprecated-mechanics.ts`）；`src/class/__tests__/architecture-terminology.test.ts` | 0.4 |
| 1.8 同级来源冲突保留 `Unresolved_Item`，不自选默认 | ◐ | `src/l2/compiler/conflict-resolver.ts` 存在但**未核实它对同级冲突是否确实不自选默认语义**，也未核实它是否被 `validatePackage` 链路调用 | 0.4（核实）、4.1（补挂） |

### 要求 2：参数、数值和结构边界归属

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 2.1 四分类标记 + 单位 / 值域 / 归属层 / 来源 | ✅ | `parameter-rules.ts`（`SCHEMA_FIELD_MISSING_CLASSIFICATION` 等 12 码）；`src/l2/model/schema.ts::ParameterField` | 0.4 |
| 2.2 玩法数值不得写入基类本体 | ✅ | `SCHEMA_GAMEPLAY_TABLE_IN_L2` + `validateNoUnclassifiedGameplayValue` + 各族 `prohibition.*.embedded_*_value` | 0.4 |
| 2.3 玩家可见数值 1–5 | ✅ | `SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE` + `src/l2/model/constitution.ts::GAMEPLAY_VALUE_RANGE` | 0.4 |
| 2.4 连接数为结构边界，上限 5 | ✅ | `scenes/index.json::structural-bound.scene.connection_limit`（三档共用）；`space-items-structural-bounds.ts`（死代码，待接线） | 1.2 |
| 2.5 内部度量显式标记 | ✅ | `SCHEMA_INTERNAL_METRIC_MISSING_SCHEMA`；领域侧 `ConnectionCountMetric` / `measureConnectionCount`（死代码） | 1.2 |
| 2.6 缺归属分类 → `VALUE_CLASSIFICATION_MISSING` | ◐ | 既有码为 `SCHEMA_FIELD_MISSING_CLASSIFICATION`，与 requirements 措辞不同；同 1.4 处理 | 4.1、§6 H-01 |
| 2.7 基类内嵌数值表 → `VALUE_L3_OWNERSHIP` | ✅ | `SCHEMA_GAMEPLAY_TABLE_IN_L2` + `DAMAGE_ASSIGNS_AMOUNT` + `prohibition.damage.matrix_in_class_layer` | 0.4 |
| 2.8 UI 取字段归属与来源，玩法层值标为玩法层配置 | ⬜ | 无三态归属实现。落点 `src/l2/adapters/space-items-projection.ts::FieldProvenanceView` | 7.2 |

### 要求 3：引擎层依赖与唯一写入边界

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 3.1 引擎层原语作为类型化依赖 | ✅ | `src/l2/kernel/kernel-contract.ts` + `op-registry-adapter.ts`；`tsconfig.l2.json` 的窄 include 本身就是"不越界依赖"的机器守卫 | 0.2 |
| 3.2 引用已登记语义族与效果接口，不复制解释规则 | ✅ | `family-contracts.ts` + `validateSemanticFamily` | 0.4 |
| 3.3 写入必经 `OpRegistry.invoke`；转移必复用 `item.move`；不得新增转移原语 | ⬜ | **实测：`src/l2/**` 全树没有 `item.move` 字面量**。领域转移入口不存在。落点 `src/l2/adapters/space-items-transfer.ts` | 6.1、4.3 |
| 3.4 旁路写入声明 → `OP_BYPASS_FORBIDDEN` | ⬜ | 类别已在 `space-items-diagnostic-categories.ts` 登记（死代码），无规则消费。落点 `src/l2/validation/space-items-write-channel-rules.ts` | 4.3 |
| 3.5 前置不满足经同一动作契约返回 `Structured_Rejection` | ◐ | `action-submitter.ts` 已有前状态指纹与拒绝构造；**领域侧前置条件顺序（物品存在 → 容器存在 → 存取能力 → Hook 可用）待补** | 6.1 |
| 3.6 违反引擎层不变量则拒绝并保前状态 | ✅ | 引擎层 `ops/invariants.ts::ALL_INVARIANT_CHECKS` + `op-registry-adapter.ts` 透传 `semanticStateFingerprintAfter` | 8.4 |
| 3.7 `Reference_Resolver` 激活前验证 kind / 族 / 必需能力 | ◐ | 引用图与解析器已有（`resolution/`）；**领域"必需能力形状"谓词待补**。落点 `src/l2/resolution/space-items-capability-shape.ts` | 5 |

### 要求 4：天然场景与拓扑类型契约

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 4.1 三档类型身份，不创建具体地图节点 | ✅ | `scenes/index.json` 的 `scene.class.{large,medium,small}` + `family-contracts.ts::SCENE_SCALES`；`typeIdentity.basis: required-capability` 已把三档分界写成必需能力差异 | 0.4 |
| 4.2 单一结构边界 5，按档 5/4/3 归玩法层 | ✅ | `scenes/index.json` 三档共用 `structural-bound.scene.connection_limit`；玩法层 `src/play/map/types.ts::CONNECTION_LIMIT` + `src/play/map/__tests__/connection-limit-layering.test.ts` 已把两层关系钉死 | 1.2（接线） |
| 4.3 候选地图越界 → 拒绝**整份**配置并报节点/类型/实际值/边界 | ◐ | `spatial-rules.ts` 只检查单个契约自带的 `connectionBound > 5`；**逐节点现查 + 整份候选地图拒绝待补**。落点 `src/l2/validation/space-items-scene-rules.ts::validateCandidateMapConnectionBounds` | 4.4 |
| 4.4 小场景共享微型场景且排除个人空旷地；大/中声明个人空旷地；父级为三档 | ◐ | 小场景侧已覆盖（`spatial-rules.ts` + `excludedMicroSceneKinds`）；`admittedParentSceneScales` 已为三档；**大/中的 `scene.capability.personal_vacant_ground` 必需性校验待补** | 4.4 |
| 4.5 具体出生 / 资源位 / 连通性 / 缩圈 / 叙事 / 平衡归玩法层 | ◐ | `SPACE_CONCRETE_MAP_NODE` + `prohibition.scene.concrete_map_node` 已覆盖 `concreteMapNodeIds`；**`spawnPointIds` / `shrinkOrderIds` 检测面待补** | 4.4 |
| 4.6 拓扑计数显式标记内部度量 | ✅（死代码） | `space-items-structural-bounds.ts::ConnectionCountMetric` / `measureConnectionCount`（调用引擎层 `linksTouching`），待接线 | 1.2 |
| 4.7 改写边界数值 / 删来源 / 把具体节点登记为基类 → 拒绝 | ◐ | `prohibition.scene.unsourced_connection_bound` + `spatial-rules.ts` 已查 >5 与无来源；**"删除结构理由"（`bound-source-removed` 面）待补** | 4.4 |
| 4.8 三档父子仅叙事分组，不参与距离 / 生命周期 / "找到" | ◐ | `scenes/index.json` 的 `childSceneRefs` / `parentSceneRef` 参数描述已声明"只服务地图编排校验，不得被编译进运行期节点的附属字段"，并有 `prohibition.scene.natural_scene_nesting_in_runtime_parent`；**无 TS 规则断言该禁止面**。落点 `space-items-scene-rules.ts` | 4.4 |

### 要求 5：微型场景的附属、创建与生命周期契约

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 5.1 恰一父级，父级可为三档任一 | ◐ | `spatial-rules.ts` 已查 parent 非空；`admittedParentSceneScales: ["large","medium","small"]` 已就位；`structural-bound.micro_scene.parent_cardinality` 已登记；**"父引用必须解析为 natural-scene 族"的族兼容判定待补** | 4.5、5 |
| 5.2 创建触发者三类，只写入不可变 `props.creator` | ✅ | `spatial-rules.ts` 查 `creator.immutable`；`scene.capability.creator_provenance` + `scene.valueset.micro_scene_kinds` | 0.4 |
| 5.3 `creator` 不得表歸属/占用/生命周期 → `MICRO_SCENE_CREATOR_MISUSE` | ◐ | 已查 `ownerField` 与 `creator` 可变（`prohibition.scene.owner_semantics`、`prohibition.scene.mutable_creator`）；**`creatorAsOwner` / `creatorAsLifecycleDeterminant` / `creatorAsAccessControl` 三个检测面待补** | 4.5 |
| 5.4 生命周期由有效父级 + 现查占用共同判定，人数不得独立存状态 | ◐ | `lifecycleDeterminants` 必含 `valid-parent` + `occupancy` 已查；**`occupancySource === 'derived-query'` 与 `occupancyCounterField` 检测面待补** | 4.5 |
| 5.5 占用归零走引擎层回收；父移除必须同时解决全部子级与占用者去向 | ⬜ | 目录侧已有 `scene.valueset.child_resolution_modes`（`destroy-children` / `redirect-parent`）与 `prohibition.scene.orphaned_child_on_parent_removal`，**无 TS 实现**。落点 `space-items-scene-rules.ts::validateParentRemoval` + `src/l2/adapters/space-items-micro-scene.ts::planParentSceneRemoval` | 4.5、6.2 |
| 5.6 缺父 / 父非天然场景 / 移除留悬空 / 占用悬空 → 拒绝并保前状态 | ◐ | 部分覆盖（缺父已查）；其余随 5.1 / 5.5 补齐 | 4.5、6.2 |
| 5.7 结构性共享与按需微型场景共用同一父/占用/回收语义，无创建者例外 | ⬜ | 无规则断言"两类走同一实现"。落点 `space-items-scene-rules.ts` + 属性测试 P4 | 4.5、8.2 |
| 5.8 载具不是微型场景 | ◐ | 载具侧 `VEHICLE_NOT_ENTITY` 与 `prohibition.scene.vehicle_as_micro_scene` 已登记；**`modelsVehicleAsMicroScene` 检测面待补**；且 `vehicles/index.json` 的 Q-04 处理与 D-038 冲突（见 ⚠ 任务 3.2） | 3.2、4.5、4.8 |

### 要求 6：过渡、接触和网关的可组合接口

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 6.1 端点类型 / 方向 / 通行条件 / 阻挡 / 视线传播 / 距离策略 | ◐ | `TransitionContract` 与 `transition.class.scene_link` 已有字段；`spatial-rules.ts` 只查端点数 == 2（`structural-bound.transition.endpoint_count`）；**方向合法性、四类引用齐备性、端点 scale 对合法性待补** | 4.6 |
| 6.2 引用解析为兼容类型，悬空 → `Structured_Rejection` | ◐ | 引用图已有；**端点族 / scale 对兼容谓词待补** | 5 |
| 6.3 过渡动作经 `Action_Family` 声明 | ✅ | `action-gateway-rules.ts::validateAction`（`ACTION_MISSING_CONTRACT_FIELD` 等六码） | 0.4 |
| 6.4 资源转换 / 检定 / 条件三类网关 | ✅ | `validateGateway` + `gateways/index.json` 三 class（`GATEWAY_KIND_AMBIGUOUS`、`GATEWAY_CONCRETE_THRESHOLD`、`GATEWAY_NAMED_GAMEPLAY_ENTITY`、`prohibition.gateway.effect_on_failure`） | 0.4 |
| 6.5 多阶段有序付费动作 + 中间状态；依附动作绑定宿主且不单独成决策分支 | ✅ | `ACTION_SEQUENCE_MISSING_INTERMEDIATE_STATUS`、`ACTION_ATTACHED_WITHOUT_HOST`、`ACTION_ATTACHED_AS_DECISION_BRANCH`、`ACTION_ATTACHED_NONZERO_COST` | 0.4 |
| 6.6 跳窗 / 楼梯 / 攀爬 / 接触 / 阻挡 / 视线桥接 / 距离权重可由玩法层配置 | ⬜ | 无"可表达性"断言。落点属性测试 P14 的代表性组合 | 8.2 |
| 6.7 D-013 / D-014 只作玩法层策略输入（挂 `U-SPACE-004` 门禁） | ⬜ | 无 `distancePolicyRef` 面与门禁。落点 `space-items-transition-rules.ts` + `space-items-unresolved-gate-rules.ts` | 4.6、4.7 |
| 6.8 具体场景绑定 / AP 成本 / 距离 / 模式绑定 → 越层拒绝 | ⬜ | 检测面 `boundConcreteSceneIds` / `concreteApCost` / `concreteDistance` / `boundGameModeId` 均无实现 | 4.6 |

### 要求 7：容器、槽位、物品与装备能力契约

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 7.1 `Container_Family` 宿主 / 角色 / 接受谓词 / 存取 / 转移引用；容量归玩法层 | ◐ | 目录侧齐备（`containers/index.json` 两 class + 九能力 + 三 prohibition，含 `prohibition.container.embedded_capacity_value`、`deposit_conflict`、`invented_content`）；**`family-contracts.ts` 无 `contractKind: 'container'`，`item-vehicle-rules.ts` 无容器规则** → TS 契约与规则待补 | 2.1、4.6 |
| 7.2 `Item_Family` 容器资格 / 装备位 / 标签 / 授予动作 / 附件点 / 使用位 / 消耗 / 转换 | ✅ | `family-contracts.ts::ItemContract`（含 `ContainerEligibility`、`SlotRequirement`、`EquipRequirement`、`AttachmentPoint`、`ArmorProfile`、`ConsumableProfile`）+ `item-vehicle-rules.ts` | 0.4 |
| 7.3 容器与槽位结构由引擎层拥有，只可引用不可重写 | ⬜ | 无"重写声明"检测。落点 `space-items-write-channel-rules.ts` | 4.3 |
| 7.4 无合法槽位时失败，不造地面替代物 / 不吞物品 | ⬜ | 领域转移入口不存在，`E_OP_NO_LEGAL_SLOT` 透传未实现 | 6.1、8.4 |
| 7.5 物品/实体转换必经合法 Op 与事务，破坏完整性则原子拒绝 | ⬜ | 领域侧无 `item.promote` / `entity.demote` 规则或入口 | 4.6、6.1 |
| 7.6 死亡容器：声明层能力组合 + **可替换机制引用** + **灌注时序义务**（D-059） | ◐ | `DeathContainerCapability` 已有；`item-vehicle-rules.ts` 已查 `depositDisabled` 与 `contentSource`；`containers/index.json` 有 `container.capability.deposit_disabled` / `derived_content_source`；玩法层 `src/play/core-mechanics/defs/rules.phase.ts` 已 emit `play.death.settled` 等待本层灌注。**⚠ 缺口：机制引用当前是硬编码字面量而非"可替换引用"，且灌注时序义务（标记必须在灌注事务提交后才生效）无任何校验** | 4.6、6.1 |
| 7.7 体积分类 / 口袋槽位等已否决携带机制 → `DEPRECATED_MECHANIC` | ◐ | 通用 `validateNoDeprecatedMechanic` 覆盖文本面；**`volumeClass` / `pocketSlots` 字段面检测待补** | 4.6 |
| 7.8 重型 / 可装备 / 可消耗 / 可转换作为可组合能力，数值引用玩法层 | ✅ | `item.capability.*` 十一项 + `HeavyTagAggregation` + `prohibition.item.embedded_gameplay_value` | 0.4 |
| 7.9 组合产生悬空 → 拒绝并保留最后有效定义集 | ◐ | `prohibition.item.dangling_composition_reference` 已登记；原子激活由 `definition-registry.ts` 保障；**领域悬空面（槽位/容器/装备位/消耗效果/附件点/转换目标）谓词待补** | 5 |

### 要求 8：武器、谱型、伤害与配件组合契约

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 8.1 三类武器身份 + 属性/谱型/距离/伤害/弹药/配件/动作序列全部经组合 | ◐ | `WEAPON_CLASSES = ['melee','non-firearm-ranged','firearm']`、`weapons/index.json` 三 `weapon-class.*` 与九能力已就位；**`compositionRoles` 必需角色集合校验待补**（`space-items-domain-ids.ts` 里已有角色标识，死代码） | 1.1、4.6 |
| 8.2 `Damage_Family` 不含具体伤害量 / 命中门槛 / 暴击增量 / 伤害表 | ✅ | `effect-ai-rules.ts::validateDamage`（`DAMAGE_ASSIGNS_AMOUNT`、`DAMAGE_MISSING_CONTRACT_FIELD`）+ `prohibition.damage.{assigns_amount,matrix_in_class_layer,axis_conflation,cardinality_constant}` | 0.4 |
| 8.3 `Profile_Family` 谱型身份（弹道谱型/距离档）与可组合参数接口 | ⬜ | **`family-contracts.ts` 无 `contractKind: 'profile'`**。目录侧现以 `range-tier.*` + `band-axis.*` + `weight-tier.*` + `weapon.capability.{range_profile,handling_profile}` 表达。需决定是否立 `ProfileContract`，或确认"谱型即 band 轴 + tier 值集"已充分表达 → 见 §6 **H-02** | 2.1、§6 H-02 |
| 8.4 仅数值区分的子类 → 拒绝并建议组合 | ✅ | `INHERIT_GAMEPLAY_VALUE_ONLY_DIFFERENCE` + `prohibition.weapon.band_as_subtype` | 0.4 |
| 8.5 配件经兼容性引用 / 附件点 / 效果引用组合 | ◐ | `weapon.capability.accessory_compatibility` + `item.capability.accessory_mount` + `AttachmentPoint` 已有；**TS 规则未校验兼容性引用齐备性** | 4.6 |
| 8.6 两类远程可引用不同动作序列策略，阶段/成本/结算归玩法层 | ◐ | `ActionSequenceStep` + `ACTION_SEQUENCE_MISSING_INTERMEDIATE_STATUS` 覆盖序列结构；**"两类各自策略引用"面待补**，并挂 `U-SPACE-004` | 4.6、4.7 |
| 8.7 枪械基础伤害表在任何定义中出现即拒绝（挂 `U-SPACE-001`） | ◐ | `item-vehicle-rules.ts` 已查单值 `concreteDamageValue`（`prohibition.weapon.concrete_damage_value`）；**`baseDamageTable` / `damageTable` / `concreteHitThreshold` / `critIncrement` / `concreteRangeTable` / `concreteAmmunitionCount` 面待补**；**诊断未携带 `U-SPACE-001` 编号** | 4.6、4.7 |
| 8.8 伤害/命中/弹药/反应/附件引用损坏 → 拒绝**整个**组合，不做语义替换 | ◐ | 原子激活已保障"整包不激活"；**领域"整组合拒绝"断言与不替换断言待补** | 5、8.2 |

### 要求 9：防具、盾牌、状态与移动能力契约

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 9.1 `Armor_Family` 装备位 / 减伤引用 / 破损条件 / 伤害类兼容 / 状态交互，不嵌具体值 | ✅ | `family-contracts.ts::ArmorProfile` + `item-vehicle-rules.ts`（减伤引用缺失、内嵌具体实例）+ `item.capability.armor` + `prohibition.item.armor_as_separate_base_class` | 0.4 |
| 9.2 `Shield_Family` 持有要求 / 格挡动作 / 损耗 / 破损 / 可选互动 | ⬜ | 目录侧只有 `item.capability.shield` 一条能力；**无 `ShieldContract`、无规则、无 `U-SPACE-006` 门禁**（`items/index.json` 已登记 `Q-05` 未决条目）。落点 `space-items-contracts.ts` + `space-items-item-rules.ts` | 2.1、4.6、4.7 |
| 9.3 `Movement_Family` 区分地面 / 载具 / 其他，参数全部暴露为玩法层字段 | ◐⚠ | `MOVEMENT_TRAVERSALS = ['ground','vehicle','teleport']` + `movement/index.json` 三 class + `MOVEMENT_PARAMETER_NOT_L3_OWNED` 已覆盖参数归属。**⚠ 第三值是 `teleport`（具体遍历方式），requirements 9.3 写的是"其他移动类型"** → 措辞不一致，见 §6 **H-04** | 0.4、§6 H-04 |
| 9.4 携带标签聚合只经引擎层 query / relation | ✅⚠ | `item-vehicle-rules.ts` 校验 `heavyTagAggregation.aggregation`，既有字面量为 **`'l1-query-relation'`**（`item.valueset.aggregation_channels`）。**⚠ 死代码契约与旧 design 期望的是 `'kernel-query-relation'`** → 字面量冲突，见 §6 **H-05** | 0.4、§6 H-05 |
| 9.5 状态效果引用 `Status_Family` / `Attachment_Family` 的持续/叠加/触发/打断/清理 | ✅ | `effect-ai-rules.ts::validateStatus` / `validateAttachment`（`LAYER_L1_RUNTIME_STATE`、`STATUS_INTERACTION_WITHOUT_RULE`、`ATTACHMENT_MISSING_CONTRACT_FIELD`）+ `attachments/index.json` 十二能力 | 0.4 |
| 9.6 D-015 盾牌特殊互动与 D-010 格斗范围为可选，不作标配 | ⬜ | 无"默认可用性"检测面。落点 `space-items-item-rules.ts` 的 `mvpDefaultInteractionIds` 面 + `U-SPACE-006` 门禁 | 4.6、4.7 |
| 9.7 D-016 已移除状态不得出现在基类 / 实例 / 默认标签 / 隐式交互 | ⬜ | `src/class/statuses/` 有 19 个 `status_*.json`，**尚未逐一比对 D-016 已移除清单**；无黑名单常量。落点 `space-items-contracts.ts` 的已移除状态黑名单 + `space-items-item-rules.ts` | 0.5、2.1、4.6 |
| 9.8 未分类数值 / 缺效果引用 / 不兼容引用 → 拒绝并报字段与来源 | ✅ | `parameter-rules.ts` 十二码 + `effect-ai-rules.ts` + 引用图 | 0.4 |

### 要求 10：载具实体与交互能力契约

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 10.1 必须映射为 `Entity`，不得为 `Item` / `Micro_Scene` | ✅ | `item-vehicle-rules.ts`（`prohibition.vehicle.not_entity`）+ `VehicleContract` | 0.4 |
| 10.2 座位 / 货舱 / 门 / 邻接 / 锁定 / 移动 / 碰撞 / 可定向部件 / 损毁处置全部参数化 | ◐ | `vehicles/index.json` 已有 24 项 `vehicle.capability.*`；`VehicleContract` 有 `SeatRoleDeclaration` / `DoorDeclaration` / `CargoContainerDeclaration` / `DestructionDisposition`；**"九项接口齐备性"校验待补** | 4.6 |
| 10.3 座位/货舱/门必须使用引擎层容器、槽位、引用与动作契约；不得自建车内存储 | ⬜ | 无"自建运行时结构"检测。落点 `space-items-write-channel-rules.ts` | 4.3 |
| 10.4 每个门标识解析后稳定且可单独引用 | ✅ | `item-vehicle-rules.ts`（`prohibition.vehicle.unstable_door_identifier`） | 0.4 |
| 10.5 D-030 位置优先于门索引属玩法层策略 | ✅ | `item-vehicle-rules.ts`（`prohibition.vehicle.d030_policy_in_class_layer`）+ `vehicle.capability.{adjacency_interaction,door_target_interaction}` 两项独立 | 0.4 |
| 10.6 D-011 撞击/部件损毁/锁定/推行/车上互动/损毁处置可表达 | ◐ | 目录能力齐全（`collision`、`targetable_parts`、`damage_stages`、`destruction_sequence`、`lockable`、`pushable_transition`、`mounted_melee`、`occupant_extraction`、`tire_sabotage` 等）；**"可表达性"断言与"损毁后撤销其授予状态"面待补** | 4.6、8.2 |
| 10.7 激活前验证载具全部引用 | ◐ | 引用图已有；**载具专属引用能力形状谓词待补** | 5 |
| 10.8 载具生命周期绑微型场景 / 内部误作本体 / 直接改乘员货舱 → 拒绝 | ◐⚠ | `interiorMicroSceneBoundary` 已被拒绝，但**当前是以 Q-04 未决门禁的名义**；D-038 已把"载具内部不建模为微型场景"关闭，应改为定值 `false` 的结构性拒绝。**`directOccupantStateWrite` / `directCargoStateWrite` 面待补** | 3.2、4.3、4.6 |

### 要求 11：UGC、UI 与玩法层的稳定适配接口

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 11.1 带版本纯声明式 JSON，禁可执行代码 / 命令式循环 / 动态求值 | ✅ | `src/l2/codec/prohibited-constructs.ts` + `json-scanner.ts` + `src/core/ugc/codec/__tests__/prohibited-construct-gate.test.ts` | 0.4 |
| 11.2 UGC 与手写走同一验证器与原子激活，无绕过入口 | ✅ | `src/l2/ugc/ugc-adapter.ts` → `validation/package-validation.ts` → `registry/definition-registry.ts` | 0.4 |
| 11.3 字段缺失 / 损坏时拒绝，不发明默认值 | ◐ | `codec/` 解码拒绝已有；**领域"语义字段损坏一律拒绝"路径待补** | 7.2、8.4 |
| 11.4 仅表现字段缺失 → 类型兼容降级 + `Warning_Diagnostic` | ✅ | `src/l2/adapters/ui-adapter.ts`（`PresentationDescriptor` + `deepFreeze`） | 0.4 |
| 11.5 UI 经只读语义投影获取场景 / 动作 / 不可用原因 / 角色 / 标签 | ✅ | `src/l2/registry/read-only-projection.ts`（`deepClonePlain` + `deepFreeze` + `semanticStateFingerprint`） | 0.4 |
| 11.6 玩法层配置只消费已登记基类，越界则拒绝并保持此前有效状态 | ◐ | 原子激活已保障；**领域侧"玩法层配置校验入口"待补** | 7.1 |
| 11.7 UI 与 AI 复用引擎层 `queryActions`，不建第二套判定 | ⬜ | **实测：`src/l2/**` 无 `queryActions` 字面量**。`adapters/ai-adapter.ts` 是否已间接复用需核实 | 0.2（核实）、7.2 |
| 11.8 暴露每字段的来源 / 归属层 / 待决状态 / 诊断 | ⬜ | 无三态实现。落点 `space-items-projection.ts::FieldProvenanceView`（`frozen-contract` / `play-layer-config` / `unresolved`） | 7.2 |

### 要求 12：拒绝、诊断、原子性与可验证性

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 12.1 每条规范关联来源 + 可观察验证结果 + 拒绝或诊断行为 | ◐ | 本矩阵即该映射的当前快照；**领域侧尚有 ⬜ 项未闭合** | 9 |
| 12.2 诊断含稳定代码 / 级别 / 定义标识 / JSON 路径 / 来源 / 原因 / 建议，多问题一次报全 | ✅ | `src/l2/model/{diagnostic,diagnostic-factory,ordering}.ts`；`validator.ts` 收集后统一返回 | 0.4 |
| 12.3 八类拒绝原因返回含 `Error_Diagnostic` 的 `Structured_Rejection` | ◐ | 六类已覆盖；**未决项擅自赋值（要求 13）与领域非法组合两类待补** | 4.7、4.6 |
| 12.4 包内任一错误则整包不激活，此前定义集不变 | ✅ | `registry/definition-registry.ts` + `validation/package-validation.ts`；`test/properties/P10-atomic-activation-rollback.property.test.ts` | 0.4 |
| 12.5 运行时前置失败 / Op 否决 / 不变量冲突 → 保前状态，无部分效果 | ◐ | `action-submitter.ts` 前状态指纹 + 引擎层不变量；**领域转移与微型场景路径未接入** | 6.1、6.2、8.4 |
| 12.6 测试接口能生成合法与非法的八类组合并观察五种结果 | ◐ | `src/l2/testing/{definition-generators,builders,test-interface}.ts` 已有通用设施与故障注入；**领域生成器待补** | 8.1 |
| 12.7 覆盖十项边界（连接数 / 微型场景生命周期 / 无合法槽位 / 转换回滚 / 悬空引用 / 数值越界 / 废案字段 / 载具非实体化 / 玩法数值入基类 / 未决误用） | ⬜ | 领域属性测试全部未写 | 8.2 |
| 12.8 拒绝后状态等价，不以"未抛异常"作为通过条件 | ◐ | 通用属性测试已有此纪律；**领域测试待补** | 8.2、8.3 |

### 要求 13：未决接口与禁止默认化

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 13.1–13.7 七项未决项的分级状态与保留接口 | ✅（死代码） | `src/l2/model/space-items-unresolved.ts` 七项齐备，已按 D-040 / D-038 / D-042 收窄 002 / 005 / 007。**未接线、无测试** | 1.5 |
| 13.8 任何默认化尝试 → 拒绝且诊断引用未决项编号 | ⬜⚠ | `item-vehicle-rules.ts` 现以 `SOURCE_PROMOTION_REQUIRES_DECISION` 处理 Q-01（特殊档）与 Q-04（车内边界），**诊断不携带 `U-SPACE-00N` 编号，也不覆盖其余五项**。落点 `src/l2/validation/space-items-unresolved-gate-rules.ts` | 4.7 |
| 13.9 提升未决项需新控制决策 / 来源 / 拥有层 / 替代关系 | ⬜ | 无提升尝试检测。落点同上 | 4.7 |

### 要求 14：跨 Spec 稳定依赖与待汇合边界

| 条 | 状态 | 证据 / 落点 | 任务 |
|---|---|---|---|
| 14.1 对引擎层的稳定依赖清单 | ✅ | `src/l2/kernel/kernel-contract.ts`；`tsconfig.l2.json` 的窄 include 是机器守卫 | 0.2 |
| 14.2 对基类层的稳定依赖清单 | ✅ | `src/l2/model/**` + `family-contracts.ts` + `src/class/<族>/index.json` | 0.4 |
| 14.3 向玩法层提供的接口清单 | ◐ | `src/play/core-mechanics/defs/*.ts` 已在多处标注"由 space-items 提供"（`actions.paid.ts` 载具/盾牌、`rules.phase.ts` 死亡灌注、`rules.status.ts` "找到"）；**本层未导出对应集成契约** | 7.1 |
| 14.4 不向其它领域主张其未定义内容 | ⬜ | 需在集成契约中显式声明 | 7.1 |
| 14.5 未冻结边界不得被视为可交付默认行为 | ◐ | 目录已有（死代码）；**集成契约需导出七项未决记录** | 1.5、7.1 |
| 14.6 上游变更时先更新来源记录与迁移结论，不静默改语义 | ⬜ | 无契约指纹与版本可观察性。落点 `space-items-integration-contract.ts` | 7.1 |

> **跨 Spec 现状**：`src/core/ugc/model/contract-types.ts` 的 `INTEGRATION_DOMAINS` 已含 `'space-items'`，`src/core/ugc/contracts/integration-contract-catalog.ts` 已就绪消费该 domain 的契约。**提供方（l2 侧）尚未实现**——这是 PT-02 与本 Spec 的交界，见 §6 交接项 **T-02**。

## §4 串行门禁与依赖图

```text
0 基线核验（只读）
  └─ 1 领域模型接线与测试（死代码转活）
       ├─ 2 领域契约扩展（补 Container / Shield / 缺口面）
       └─ 3 目录数据修正与补齐（src/class/<族>/index.json）
            └─ 4 领域验证规则补齐（src/l2/validation/space-items-*.ts）
                 ├─ 5 领域引用能力形状（src/l2/resolution/）
                 └─ 6 领域运行时适配（src/l2/adapters/）
                      └─ 7 集成契约与领域投影（src/l2/adapters/）
                           └─ 8 测试（test/l2/space-items/**）
                                └─ 9 全量门禁与追踪验收
```

任务 2 与 3 在任务 1 后可并行。4.3–4.7 在 4.1 后可并行。5 与 6 在 4 后可并行。8.2 的 14 个属性测试在 8.1 后按各自前置并行。9 必须等 8 全部通过。

## Tasks

- [ ] 0. 基线核验（只读，产出证据，不改代码）
  - [ ] 0.1 记录实施前门禁基线
    - 运行并记录 `npm run typecheck`、`npm run typecheck:l2`、`npm run lint`、`npm test` 的实施前完整结果；既有失败必须保存命令、错误文本与所属模块，不得通过过滤、改断言或缩小范围掩盖。
    - 记录 `src/class/__tests__/` 五个测试文件与 `test/l2/**`、`test/properties/**` 的当前通过状态。
    - **DoD（可机器校验）**：基线记录文件存在且包含四条命令的退出码与失败清单；同一工作区可复现。
    - **落点**：`src/l2/决策与风险记录.md` 追加「space-items 实施基线」小节。
    - **Requirements:** 12.1、14.6。

  - [ ] 0.2 核实引擎层端口与动作可用性复用现状
    - 逐项核实真实导出与签名并记录：`src/l2/kernel/kernel-contract.ts::KernelContract`（含 `invoke`、`hasOp`、`semanticStateFingerprint`、`hookIntegrationAvailable` 是否存在）；`op-registry-adapter.ts::createKernelContractFromOpRegistry`；`src/core/kernel/ops/registry.ts::OpRegistry` 的 `invoke`/`register`/`has`/`listOpNames`/`isStructural`；`structural-ops.ts` 注册的 Op 名全集与 `ItemMoveArgs`、`EntityPlaceArgs` 字段；`topology/micro-scene.ts::{ensureMicroScene,onMicroSceneOccupantsChanged,checkMicroSceneCapacity}`；`topology/graph.ts::{linksTouching,cascadeNodeDestroySet}`；`topology/container.ts::{findDefaultSlotIndex,insertSlot,removeSlot,setSlotHolds}`；`ops/invariants.ts::ALL_INVARIANT_CHECKS` 覆盖的 `E_INV_*`。
    - **回答要求 11.7 的悬空问题**：核实 `src/l2/adapters/ai-adapter.ts` 与 `read-only-projection.ts` 是否已经（间接）复用引擎层 `queryActions`；若否，记录为缺口并指明接入点。
    - 核实 `OpRegistry.invoke` 是否有 `cause` 形参（旧 design R-10 声称无，需复核）。
    - **注意 `tsconfig.l2.json` 约束**：领域实现只能直接 import `src/l2/**`、`src/core/kernel/ops/registry.ts`、`src/core/kernel/ops/result.ts`。上述其它 kernel 能力**必须经 `KernelContract` 间接使用**，不得直接 import，否则 `npm run typecheck:l2` 失败。这一点旧计划完全没提，是本版新增的硬约束。
    - **DoD**：每个端口有"已冻结（签名原文）"或"unavailable（缺口 + owner）"记录；`typecheck:l2` 的依赖边界结论写明。
    - **Requirements:** 3.1、3.2、11.7、14.1、14.2、14.5、14.6。

  - [ ] 0.3 核实错误码与领域诊断类别映射
    - 审计 `src/core/kernel/state/error-codes.ts::ERR_CODES`，逐项确认 `space-items-diagnostic-categories.ts` 的 `CODE_MAP` 引用的每个码都已登记。**不得新增 `ERR_CODES` 成员**；若某映射目标不存在，停下并把该路径标为 unavailable，不得用 `E_LOAD_UNRESOLVED_CONTRACT` 给已登记码兜底。
    - 核实 `src/l2/model/diagnostic-codes.ts` 中已有的 `SPACE_*`、`ITEM_*`、`WEAPON_*`、`ARMOR_*`、`VEHICLE_*`、`LAYER_*`、`VALUE_L3_OWNERSHIP`、`SOURCE_PROMOTION_REQUIRES_DECISION` 条目，确定哪些领域检查可直接复用、哪些需新增领域类别。
    - **产出 §6 H-01 所需的等价映射表**：requirements 措辞（`VALUE_L3_OWNERSHIP`、`VALUE_CLASSIFICATION_MISSING`、`MICRO_SCENE_CREATOR_MISUSE`、`OP_BYPASS_FORBIDDEN`、`DEPRECATED_MECHANIC`）↔ 既有码。
    - **DoD**：每个已启用的领域诊断条件解析到唯一已登记码；`ERR_CODES` 成员数与实施前一致（写成快照断言的输入）。
    - **Requirements:** 12.2、12.3。

  - [ ] 0.4 逐条核验 §3 覆盖矩阵中标 ✅ 与 ◐ 的项
    - 对 §3 中每个标 ✅ 的条目，打开对应文件确认该检查真实存在且真实被 `DEFINITION_RULES` 执行序调用（不只是文件里有函数）。核验方式：读 `src/l2/validation/validator.ts` 的规则装配处，逐一比对。
    - **重点核验 §3 要求 1.8**：`src/l2/compiler/conflict-resolver.ts` 是否被 `validatePackage` 链路调用；它对同级优先级冲突是否确实保留 `Unresolved_Item` 而不自选默认语义。
    - 对每个标 ◐ 的条目，写清"已覆盖的面"与"缺的面"，缺面必须精确到字段名或判定条件。
    - **DoD**：产出一份逐条证据表，每行含（requirement 条号、状态、文件:函数、诊断码或字段名）。表中不得出现"应该""可能""大概"。
    - **落点**：`src/l2/决策与风险记录.md` 追加「space-items 要求覆盖证据表」小节。
    - **Requirements:** 12.1。

  - [ ] 0.5 核实 D-016 已移除状态清单与 `src/class/statuses/` 的一致性
    - 从 `docs/访谈决策记录.md` D-016 与 `docs/_术语表与废案清单.md` 提取"已移除状态"的确切清单。
    - 逐一比对 `src/class/statuses/` 下 19 个 `status_*.json`（`aiming`、`blocking`、`burning`、`concealed`、`downed`、`frozen`、`hastened`、`heavy`、`knocked_down`、`lockpicking`、`overloaded`、`poisoned`、`radiation`、`sleeping`、`slowed`、`staggered`、`stunned`、`traveling`、`weak`）与 `statuses/index.json` 的值集。
    - 若发现已移除状态仍在目录中，**不在本任务删除**（跨越 §3 要求 9.7 的实现边界），登记为任务 3 的输入与 §6 交接项。
    - **DoD**：产出「D-016 已移除状态清单」与「目录现存状态清单」的差集，差集为空或每项有处置结论。
    - **Requirements:** 9.7。

- [ ] 1. 把已落地的领域模型接线并测试（把 §2.2 的死代码转为受门禁保护的活代码）
  > 这五个文件**内容已存在**。本任务**不是重写**，是：①核对其内容与现行 requirements / 裁决一致；②从 `src/l2/model/index.ts` 导出；③补上测试。
  > **不得**因为文件已存在就跳过测试；**不得**为了让测试通过而改写断言去迁合实现——发现实现与 requirements 不一致时改实现。

  - [ ] 1.1 核对并接线 `space-items-domain-ids.ts`
    - 核对：族标识集合是否恰为 requirements 涉及的十二族（`natural-scene`、`micro-scene`、`transition`、`container`、`item`、`weapon`、`profile`、`damage`、`armor`、`shield`、`movement`、`vehicle`）；能力标识与组合角色标识是否与 `src/class/<族>/index.json` 的实际 `capabilityIds` 对齐（**注意 §2.1 事实 2：不存在 `spectrum-class.*`**）；是否复用 `./ids.js` 的 `isWellFormedId` 与 `joinJsonPath` 而非自建；规范化排序序数函数是否对每个集合都提供。
    - 组合角色标识必须含 `weapon-attribute`（**不得**出现已废止的 `attack-shape`）。
    - 从 `src/l2/model/index.ts` 导出。
    - **DoD**：`test/l2/space-items/unit/domain-ids.test.ts` 断言：集合为 `as const` 封闭集；十二族齐备；每个能力标识在对应 `src/class/<族>/index.json` 中可找到（机械比对，读 JSON 而非硬编码清单）；不含任何数值；不含 `attack-shape` 字面量。
    - **依赖：** 0.2、0.4。**Requirements:** 1.2、14.2、14.3。

  - [ ] 1.2 核对并接线 `space-items-structural-bounds.ts`
    - 核对：是否只登记**单一**天花板 5（D-057），**没有**按档登记 5/4/3；`owningLayer` 恒为 `'基类层'`；`authoritativeSources` 与 `structuralRationale` 非空且与 `src/l2/model/constitution.ts` 的 `NODE_CONNECTION_BOUND_SOURCE` 同 precedence 语义；`ConnectionCountMetric.kind` 恒为 `'Internal_Metric'`；`measureConnectionCount` 是否经 `KernelContract` 或纯参数（links 数组）计算——**若它直接 import `src/core/kernel/topology/graph.ts`，会违反 `tsconfig.l2.json` 边界，必须改为纯参数或经端口**。
    - 与 `src/class/scenes/index.json::structural-bound.scene.connection_limit` 机械比对取值与来源。
    - 与玩法层 `src/play/map/types.ts::CONNECTION_LIMIT` 的分层关系已由 `src/play/map/__tests__/connection-limit-layering.test.ts` 钉死，**本任务不得改动玩法层**。
    - **DoD**：`test/l2/space-items/unit/structural-bounds.test.ts` 断言：天花板恰为 5 且只有一个；删除任一来源或理由字段导致类型检查失败（用 `@ts-expect-error` 反向断言）；`measureConnectionCount` 结果始终带 `Internal_Metric`；`typecheck:l2` 通过。
    - **依赖：** 1.1。**Requirements:** 2.4、2.5、4.1、4.2、4.6。**Properties:** P3。

  - [ ] 1.3 核对并接线 `space-items-numeric-ownership.ts`
    - 核对：四分类是否复用 `./schema.js::ParameterField` 与 `./constitution.js::GAMEPLAY_VALUE_RANGE`；`collectNumericFields` 是否递归覆盖参数 Schema、组合组件参数与契约内嵌字段；`validateGameplayValue` 是否对玩家可见值要求 1–5 有限整数，且对**非**玩家可见的 `Gameplay_Value` 要求 `authoritativeSources` 非空（否则 `playerVisible:false` 就成了绕过 1–5 的后门）；`validateInternalMetric` 是否要求显式标注与自有 Schema；模块是否为纯函数（不得 import `OpRegistry`、事务、`WorldState`）。
    - **与既有 `parameter-rules.ts` 去重**：该文件已实现十二类数值诊断。本模块只能提供**领域递归收集**与**领域分类判定**，不得产出与 `parameter-rules.ts` 重复的诊断（同一 (定义, 路径, 代码) 只能出现一次）。
    - **DoD**：`test/l2/space-items/unit/numeric-ownership.test.ts` 断言 1 与 5 通过、0 与 6 拒绝、非整数拒绝、非有限拒绝、缺分类拒绝、冲突分类拒绝、无来源的非玩家可见值拒绝；模块无副作用（import 后不产生任何全局状态变化）；与 `parameter-rules.ts` 无重复诊断。
    - **依赖：** 1.1。**Requirements:** 2.1、2.2、2.3、2.5、2.6。**Properties:** P2。

  - [ ] 1.4 核对并接线 `space-items-diagnostic-categories.ts`
    - 核对：类别集合是否封闭；`CODE_MAP` 是否用 `satisfies Record<Category, Readonly<Record<string, ErrCode>>>` 获得编译期完整性；诊断工厂是否按定义级 / 包级 / 运行时级补齐定位字段（不适用的字段显式省略而非填空串）；是否携带 `unresolvedId?` 与 `forbiddenSurface?` 两个附加字段；排序是否复用 `./ordering.js::canonicalSort`。
    - **落地 0.3 产出的等价映射表**：把 requirements 措辞的类别名映射到既有已登记码，映射关系写进注释与常量，不得静默改名。
    - **DoD**：`test/l2/space-items/unit/diagnostic-categories.test.ts` 断言任何自由字符串代码无法通过类型检查（`@ts-expect-error`）；同一诊断集合的任意输入排列产出字节等价顺序；缺 `Error_Diagnostic` 的拒绝被识别为无效；`ERR_CODES` 成员数与 0.3 记录一致（形状快照）。
    - **依赖：** 0.3、1.1。**Requirements:** 12.2、12.3。**Properties:** P12。

  - [ ] 1.5 核对并接线 `space-items-unresolved.ts`
    - 核对：`UNRESOLVED_ITEM_CATALOG` 恰含 `U-SPACE-001` … `U-SPACE-007` 七项；每项的 `upstreamIds`、`retainedInterface`、`forbiddenSurfaces`、`rejectionCategory`、`rejectionCode`、`sourceRecords` 齐备；**分级正确**——001 / 003 / 004 / 006 全未决；002 的二维正交结构已冻结（仅数值未决）；005 的"载具不建模为微型场景"已冻结（仅车内外互攻未决）；007 已由 D-042 关闭（保留为已冻结记录，不得再拒绝引用它的配置）。
    - **删除旧版遗留的错误注释**：旧 design R-01 声称"上游状态表与 requirements 冲突，按 requirements 保持全未决"。该冲突**已由 D-040 / D-038 / D-042 关闭**，现行 requirements 要求 13 本身就是分级的。若文件头仍有"按 requirements 保持全未决"的注释，改为分级说明并引用三条 D 号。
    - 提供 `forbiddenSurfacesOf(id)`、`findUnresolvedItem(id)`、`allForbiddenSurfaces()`，按标识规范化排序。
    - **DoD**：`test/l2/space-items/unit/unresolved.test.ts` 断言 `UNRESOLVED_ITEM_CATALOG.length === 7`；逐项断言分级状态；断言任何把 001/003/004/006 标为已冻结的改动使测试失败；断言 002/005/007 的已冻结面**不**出现在 `forbiddenSurfaces` 中。
    - **依赖：** 1.4。**Requirements:** 13.1–13.9。**Properties:** P11。

  - [ ] 1.6 从 `src/l2/model/index.ts` 与 `src/l2/index.ts` 导出，并加"无死代码"守卫
    - 把 1.1–1.5 的公共类型与只读目录从 `src/l2/model/index.ts` 导出，再由 `src/l2/index.ts` 转出。
    - **只导出**：领域标识、结构边界目录、数值归属纯函数、诊断类别与工厂、未决目录（只读）。**不导出**任何可变对象。
    - 新增守卫测试：扫描 `src/l2/model/space-items-*.ts` 的每个 `export`，断言它至少被 `src/l2/model/index.ts` 转出或被 `src/l2/{validation,resolution,adapters,registry}/**` 中至少一个模块引用。**这条守卫的目的就是防止 §2.2 的死代码状态复现。**
    - **DoD**：`test/l2/space-items/unit/no-dead-exports.test.ts` 存在并通过；故意加一个未被引用的 export 会使其失败。
    - **依赖：** 1.1–1.5。**Requirements:** 14.2、14.3。

- [ ] 2. 领域契约扩展（`src/l2/model/space-items-contracts.ts`，单文件）
  - [ ] 2.1 只补 `family-contracts.ts` 尚未表达的面，不复制已有契约
    - **前置**：`family-contracts.ts` 已有 `natural-scene`、`micro-scene`、`transition`、`item`、`weapon`、`vehicle`、`damage`、`status`、`skill`、`movement`、`attachment`、`action`、`gateway`、`ai-behavior`、`generic` 共 15 个 `contractKind`。本任务**不重新定义**它们。
    - **真缺口 A — `ContainerDomainContract`**：`family-contracts.ts` 无容器契约（要求 7.1）。声明宿主类型、容器角色、槽位接受谓词引用、存取能力、`depositAllowed` / `withdrawAllowed`、转移动作引用。槽位数量与容量一律用 `*Field` 参数字段名表达；`concreteSlotCount` / `concreteCapacity` 只作违规检测面存在。
    - **真缺口 B — `ShieldDomainContract`**：无盾牌契约（要求 9.2）。声明持有要求、格挡动作引用、损耗规则引用、破损条件引用、可选互动能力引用；`mvpDefaultInteractionIds` 作违规检测面（`U-SPACE-006` 未决，不设默认标配范围）。
    - **待裁决缺口 C — `ProfileDomainContract`**：见 §6 **H-02**。裁决为"需要"则声明谱型身份（弹道谱型 / 距离档）与可组合参数接口，只引用 `weapons/index.json` 实存的 `range-tier.*` / `band-axis.*` / `weight-tier.*`；裁决为"不需要"则在本文件注释中记录"谱型由 band 轴 + tier 值集表达"的结论。**不得**在裁决前二选一实现。
    - **补齐面 D — 空间三契约的差集**：按 scale 引用结构边界、`triggerKind`（`entity` / `transition` / `structural-shared`）、`creator` 的 `immutable: true` 与 `purpose: 'provenance-only'` 字面量固定、`occupancySource: 'derived-query'`、`parentRemovalDisposition`、端点 scale 对、网关引用、付费动作序列、依附动作宿主绑定。
    - **补齐面 E — 违规检测面字段**（存在的唯一目的是让越层声明可被确定性发现并定位，合法定义中必须缺省）：`concreteMapNodeIds`、`spawnPointIds`、`shrinkOrderIds`、`creatorAsOwner`、`creatorAsLifecycleDeterminant`、`creatorAsAccessControl`、`ownerField`、`occupancyCounterField`、`modelsVehicleAsMicroScene`、`boundConcreteSceneIds`、`concreteApCost`、`concreteDistance`、`boundGameModeId`、`volumeClass`、`pocketSlots`、`baseDamageTable`、`concreteDamageValue`、`concreteHitThreshold`、`concreteRangeTable`、`concreteAmmunitionCount`、`amount`、`critIncrement`、`damageTable`、`namedFirearmId`、`concreteMitigation`、`concreteDurability`、`concreteBreakThreshold`、`concreteCost`、`concreteSpeed`、`interiorMicroSceneBoundary`、`concreteDoorCount`、`concreteOccupantCount`、`directOccupantStateWrite`、`directCargoStateWrite`。
    - **补齐面 F — 已移除状态黑名单常量**：按 0.5 的产出登记 D-016 已移除状态标识黑名单。
    - **补齐面 G — 死亡容器（D-059 两层）**：`depositDisabled` 固定 `true`；`depositDisabledMechanismRef` 为**可替换机制引用**（**不是**字面量 `'before-item-move-veto'`）；`contentSource` 固定 `'deceased-entity-transaction'`；新增 `depositMarkTiming` 固定为 `'after-infusion-commit'` 以承载灌注时序义务。注释中说明推导依据：`Slot.accepts` 是结构区字段，已登记 Op 集合中没有任何 Op 能在容器创建后修改它，因此创建时即写 `accepts:false` 会连灌注自身的 `item.move` 一并拒绝。
    - **载具面**：`backingDefKind` 字面量固定 `'entity'`；座位 `bindOpId` / `unbindOpId` 固定 `'agent.bind'` / `'agent.unbind'`（与 `vehicles/index.json::operationChannels` 机械比对）；`adjacencyComponentId` 与 `doorTargetComponentId` 为两个独立必填字段；损毁处置必须声明乘员去向、货舱去向与**被授予状态的撤销引用**。
    - **武器面**：类型身份恰三值；武器属性 / 谱型 / 距离策略 / 伤害引用 / 弹药行为 / 配件兼容性 / 动作序列全部经 `compositionRoles` 声明，不作顶层字段；`compositionRoles.role` 不得出现 `'attack-shape'`。
    - 所有集合 `readonly`；提供深度不可变构造辅助（复用 `./immutable.js::deepFreeze`）。
    - **DoD**：`typecheck` 与 `typecheck:l2` 通过；`test/l2/space-items/unit/contracts.test.ts` 逐项断言字面量固定值（`backingDefKind === 'entity'`、`bindOpId === 'agent.bind'`、`depositDisabled === true`、`depositMarkTiming === 'after-infusion-commit'`、`contentSource === 'deceased-entity-transaction'`、`creator.immutable === true`、`creator.purpose === 'provenance-only'`、`occupancySource === 'derived-query'`）；断言契约中不含任何具体数值、具体地图或模式绑定；断言违规检测面在合法定义构造中全部缺省；`@ts-expect-error` 反向断言"声明 creator 可变"与"载具映射为 item"在类型层不可表达。
    - **依赖：** 1.6、0.5。**Requirements:** 4.1、4.4、5.1、5.2、5.4、5.7、6.1、6.3、6.5、7.1、7.2、7.5、7.6、7.7、7.8、8.1、8.2、8.3、8.5、8.7、9.1、9.2、9.3、9.4、9.5、9.6、9.7、10.1–10.6。**Properties:** P3、P4、P6、P7、P9、P10、P11、P14。

- [ ] 3. 目录数据修正与补齐（`src/class/<族>/index.json`，**不新建目录**）
  - [ ] 3.1 修正 `src/class/scenes/index.json` 的 D-056 残留冲突
    - `scene.valueset.scene_scales` 中 `small` 的 description 现为「唯一可承载微型场景的天然场景」，与 D-056（微型场景父级为大/中/小三档）冲突。改写为准确表述：小场景是**唯一自带共享微型场景且排除个人空旷地**的档位（这才是它的类型分界），三档均可作微型场景父级。
    - 同步核对 `large` / `medium` 的 description（现为「承载中场景的最外层天然场景」/「承载小场景的中层天然场景」）：三档父子关系按 D-056 只是**叙事分组**，description 不得暗示它参与距离、生命周期或"找到"判定。若暗示，改写。
    - 同步 `src/class/__tests__/class-semantic-families.test.ts` 中依赖这些描述或 `admittedChildSceneScales` 语义的断言（若有）。
    - **DoD**：`scenes/index.json` 中不再出现「唯一可承载微型场景」字样；`grep -n '唯一.*微型场景' src/class/scenes/index.json` 无匹配；`npm test` 中 `src/class/__tests__/**` 全绿。
    - **Requirements:** 4.4、4.8、5.1。

  - [ ] 3.2 按 D-038 修正 `src/class/vehicles/index.json` 的 `interior.isMicroScene`
    - 现状：`unresolvedItems[Q-04].handling` 把 `interior.isMicroScene` 登记为"可配置参数名"，并声明"不为车内空间推导任何微型场景机制"。**D-038 已裁决载具内部不建模为微型场景**，因此该项已从"未决"变为"已冻结为 `false`"。
    - 改动：把 `interior.isMicroScene` 从可配置参数名改为**定值 `false` 的结构性声明**（或等价的 prohibition 表达，与目录既有风格一致）；`unresolvedItems[Q-04]` 收窄为仅保留**车内外互相攻击判定细则**这一未决面（D-038 第 6 条明确保留的独立子课题），并注明 `interior.isMicroScene` 已由 D-038 关闭。
    - 保留 `vehicle.capability.adjacency_interaction` 与 `vehicle.capability.door_target_interaction` 两项独立能力不变（D-030 已归玩法层）。
    - **DoD**：`vehicles/index.json` 中 `interior.isMicroScene` 不再出现在任何"可配置参数名"位置；`unresolvedItems[Q-04]` 的 `handling` 文本只覆盖车内外互攻；`src/class/__tests__/**` 全绿。
    - **Requirements:** 5.8、10.8、13.5。

  - [ ] 3.3 按 D-059 补齐死亡容器的"可替换机制引用"与"灌注时序"面
    - `src/class/containers/index.json`：`container.capability.deposit_disabled` 现只表达"禁止存入"这一声明层。补上**运行期机制引用**的参数槽位名（如 `depositDisabledMechanismRef`）与**灌注时序**的参数槽位名（如 `depositMarkTimingRef` 或值集条目 `after-infusion-commit`），使"机制可替换"与"标记必须在灌注事务提交后生效"成为目录层可表达、可校验的面，而非硬编码字面量。
    - `src/class/items/index.json`：`item.capability.death_container_binding` 同步补上对应引用槽位名。
    - 新增或修正 prohibition：`prohibition.container.deposit_mark_before_infusion`（灌注前即生效的标记必须被拒绝）。
    - **不得**在 JSON 中写入任何 Hook 名、Op 名之外的实现细节；`operationChannels` 只列引擎层已注册 Op 名。
    - **DoD**：`formal-data-integrity.test.ts` 通过（严格解析 + 字段名黑名单）；新增槽位名不在 `forbiddenFields` 黑名单（`apCost`、`capacity`、`damage`、`duration`、`hp`、`maxHp`、`range`、`speed`、`armorRating`、`multiplier`、`probability`、`matrix`、`ammoCost`、`damageOnCollision`、`healRate`）内。
    - **Requirements:** 7.6。

  - [ ] 3.4 按 §3 矩阵补齐其余目录缺口
    - `containers/index.json`：补槽位接受谓词引用、存取能力的转移动作引用槽位名（要求 7.1）。
    - `items/index.json`：补盾牌能力的持有要求 / 格挡动作 / 损耗规则 / 破损条件引用槽位名（要求 9.2）；`Q-05` 条目保持未决且不设默认标配范围（`U-SPACE-006`）。
    - `weapons/index.json`：补配件兼容性引用槽位名（要求 8.5）；按 §6 H-02 的裁决决定是否补谱型登记面。
    - `movement/index.json`：按 §6 H-04 的裁决处理 `movement.class.teleport` 与"其他移动类型"的措辞。
    - `statuses/index.json` 与 `status_*.json`：按 0.5 差集处置已移除状态（要求 9.7）。
    - **每一处补齐都只补参数槽位名与引用，不补任何数值。**
    - **DoD**：`src/class/__tests__/` 五个测试全绿；`grep` 确认新增字段全部以 `Field` / `Ref` 结尾或为 `key` 声明；`operationChannels` 与引擎层 `listOpNames()` 机械比对通过（该比对写在任务 8.4 的集成测试里）。
    - **Requirements:** 7.1、8.5、9.2、9.3、9.7。

- [ ] 4. 领域验证规则补齐（`src/l2/validation/space-items-*.ts`）
  > **纪律**：只补 §3 矩阵中标 ◐ 的缺面与 ⬜ 的空白。**不得**重复实现 `spatial-rules.ts` / `item-vehicle-rules.ts` / `classification-rules.ts` / `parameter-rules.ts` / `effect-ai-rules.ts` / `action-gateway-rules.ts` 已有的检查——同一 (定义, JSON 路径, 诊断码) 在一次验证结果中只能出现一次。

  - [ ] 4.1 把领域规则挂进既有执行序（`src/l2/validation/validator.ts`）
    - 在 `DEFINITION_RULES` 的确定性执行序中插入领域规则，并把 `spatial-rules.ts::validateSpatial` 与 `item-vehicle-rules.ts::validateItemsAndVehicles` 与新增领域规则编入**同一序列**，避免同一定义被两套互不知情的规则集分别校验。
    - 领域规则上下文在既有 `src/l2/validation/context.ts::ValidationContext` 之上**适配**，不新建第二套上下文类型。
    - 落地 0.3 / 1.4 的诊断码等价映射（§6 H-01）：requirements 措辞的类别名映射到既有已登记码，不改既有码。
    - 若 0.4 核实发现 `conflict-resolver.ts` 未被 `validatePackage` 链路调用（要求 1.8），在此补挂。
    - 规则执行必须收集全部可确定发现的诊断后统一返回，不得遇错即停、不得静默修复。
    - **DoD**：`test/l2/space-items/unit/rule-order.test.ts` 断言执行序稳定（同一输入的诊断序列字节等价）；断言一个含多个独立问题的候选一次报全；断言无重复诊断（对 (definitionId, jsonPath, code) 三元组做去重后长度不变）。
    - **依赖：** 1.6、2.1。**Requirements:** 1.8、12.2。**Properties:** P12。

  - [ ] 4.2 `space-items-write-channel-rules.ts`（要求 3.3、3.4、7.3、10.3）
    - 拒绝声明直接写世界状态、直接修改容器数组、直接修改关系索引或绕过事务执行的定义 → `OP_BYPASS_FORBIDDEN` 类别。
    - 拒绝声明新增拾取 / 丢弃 / 装备 / 卸下 / 死亡物品转移 / 交易独立写入原语的定义；物品转移引用的 Op 名必须恰为 `item.move`。
    - 拒绝重写容器与槽位结构、顺序、插入策略、默认槽位选择、容纳检查或移动失败语义的声明（要求 7.3）。
    - 拒绝自建车内存储 / 乘员位置 / 门访问运行时结构的声明（要求 10.3）；拒绝 `directOccupantStateWrite` / `directCargoStateWrite`。
    - 校验定义引用的全部 Op 名都在引擎层已注册集合内：经注入的 `KernelContract.hasOp` 判定（生产期），测试期用真实 registry 的 `listOpNames()` 机械比对。**不得硬编码 Op 名清单。**
    - **DoD**：每类违规有正例与拒绝例；任何非 `item.move` 的转移 Op 引用被拒；`test/l2/space-items/unit/write-channel-rules.test.ts` 断言 Op 名比对是机械的（改动 registry 注册集合会改变测试结论）。
    - **依赖：** 4.1。**Requirements:** 3.1–3.5、7.3、7.6、10.3、10.8。**Properties:** P5。

  - [ ] 4.3 `space-items-scene-rules.ts`（要求 4 的缺面）
    - 校验 `scale` 为三值之一且 `connectionBoundRef` 指向单一天花板（要求 4.1、4.2）。
    - 补 `bound-source-removed`：边界来源或结构理由被删除即拒绝（要求 4.7）。
    - 补大 / 中场景必须声明 `scene.capability.personal_vacant_ground`；小场景必须声明 `shared_micro_scene` 且 `personalVacantGroundCapabilityRefs` 为空（要求 4.4）。
    - 实现 `validateCandidateMapConnectionBounds`：逐节点现查连接数与天花板 5 比较，**任一越界拒绝整份候选地图配置**，诊断报告节点标识、场景类型、实际连接数与结构边界；计数结果带 `Internal_Metric` 标记（要求 4.3）。**按档 5/4/3 的越界属玩法层校验，本规则不代为拒绝。**
    - 补 `spawnPointIds` / `shrinkOrderIds` 非空即越层拒绝（要求 4.5）。
    - 补要求 4.8：断言三档父子字段（`admittedChildSceneScales` / `childSceneRefs` / `parentSceneRef`）不被用于距离计算、微型场景生命周期或"找到"判定——检测面为"这些字段出现在距离策略引用、生命周期判定项或找到判定引用中"即拒绝。
    - 实现 `validateParentRemoval`：父天然场景被候选事务移除时，每个子微型场景必须声明 `parentRemovalDisposition`（`destroy-children` / `redirect-parent`），并为其现查占用者声明合法去向；任一未解决即拒绝整个候选事务并保持事务前状态（要求 5.5）。
    - **DoD**：三档各有通过与越界例；越界拒绝整份配置而非单节点；具体地图字段全部被拒；父移除留悬空子引用必定回滚。
    - **依赖：** 4.1、1.2。**Requirements:** 4.1–4.8、5.5。**Properties:** P3、P4。

  - [ ] 4.4 `space-items-micro-scene-rules.ts`（要求 5 的缺面）
    - 补父引用的**族兼容判定**：`parent` 必须解析为 `natural-scene` 族且 scale 在 `admittedParentSceneScales`（三档）内；父引用非天然场景即拒绝（要求 5.1、5.6）。
    - 补 `creatorAsOwner` / `creatorAsLifecycleDeterminant` / `creatorAsAccessControl` 三个检测面 → `MICRO_SCENE_CREATOR_MISUSE` 类别（要求 5.3）。
    - 补 `occupancySource !== 'derived-query'` 与 `occupancyCounterField` 出现即拒绝（要求 5.4）。
    - 补 `modelsVehicleAsMicroScene` 检测面（要求 5.8）。
    - 补要求 5.7：`triggerKind` 三值只影响调用点，不得产生第二套生命周期规则——检测面为"结构性共享微型场景声明了与按需微型场景不同的父引用规则、占用查询或回收语义"即拒绝；同时禁止基于创建者或固定所有者的例外。
    - **DoD**：每条检查有正例与拒绝例；`props.creator` 的任意取值变化不改变生命周期判定结论（由属性测试 P4 断言）。
    - **依赖：** 4.1、2.1。**Requirements:** 5.1–5.8。**Properties:** P4、P10。

  - [ ] 4.5 `space-items-transition-rules.ts`（要求 6 的缺面）
    - 补方向性合法性、通行条件引用 / 阻挡能力引用 / 视线与影响传播接口 / 可选距离策略引用的齐备性（要求 6.1）。端点数 == 2 已由 `spatial-rules.ts` 覆盖，**不重复实现**。
    - 补端点 scale 对是否在允许集合内（要求 6.1、6.2）。
    - 补 `boundConcreteSceneIds` / `concreteApCost` / `concreteDistance` / `boundGameModeId` 越层拒绝（要求 6.8）。
    - 补 D-013 / D-014 只作玩法层策略输入：`distancePolicyRef` 必须指向玩法层策略；远程动作流程面挂 `U-SPACE-004` 门禁（要求 6.7）。
    - 多阶段序列与依附动作宿主绑定已由 `action-gateway-rules.ts` 覆盖，**不重复实现**；本规则只校验"过渡引用的动作序列确实是付费动作序列"。
    - **DoD**：任何具体成本 / 距离 / 伤害 / 反应窗口出现即拒绝；跳窗、楼梯、攀爬、接触、阻挡、视线桥接、距离权重的代表性组合均可通过（可表达性断言，属性测试 P14）。
    - **依赖：** 4.1、2.1、1.5。**Requirements:** 6.1、6.2、6.6、6.7、6.8。**Properties:** P14、P11。

  - [ ] 4.6 `space-items-container-item-rules.ts`（要求 7 与 9 的缺面）
    - **容器**（要求 7.1）：校验宿主类型、容器角色、槽位接受谓词引用、存取能力、`depositAllowed` / `withdrawAllowed`、转移动作引用齐备；`concreteSlotCount` / `concreteCapacity` 出现即越层拒绝。
    - **死亡容器**（要求 7.6，D-059）：校验 `depositDisabled === true`、`contentSource === 'deceased-entity-transaction'`、`containerRef` 指向新建容器（这三项 `item-vehicle-rules.ts` 已部分覆盖，**在此只补差集**）；补 `depositDisabledMechanismRef` 必须是**可替换引用**而非字面量；补 `depositMarkTiming === 'after-infusion-commit'` 的时序义务，任何在灌注事务提交前即生效的标记声明必须被拒绝。
    - **已否决携带机制**（要求 7.7）：补 `volumeClass` / `pocketSlots` 字段面 → `DEPRECATED_MECHANIC`，诊断携带控制来源。
    - **物品/实体转换**（要求 7.5）：校验转换只引用 `item.promote` / `entity.demote`；候选转换若声明会导致引用、容器、位置或附件关系不完整，必须原子拒绝。
    - **盾牌**（要求 9.2、9.6）：校验持有要求 / 格挡动作 / 损耗规则 / 破损条件引用齐备；`mvpDefaultInteractionIds` 出现或为可选互动声明默认启用 → 挂 `U-SPACE-006` 门禁拒绝。D-015 扔盾 / 盾击与 D-010 格斗范围只能是可选玩法层内容。
    - **已移除状态**（要求 9.7）：校验 D-016 黑名单状态不出现在基类、实例、默认标签或隐式状态交互中。
    - **防具与移动**：`item-vehicle-rules.ts::validateArmor*` 与 `effect-ai-rules.ts::validateMovement` 已覆盖要求 9.1、9.3、9.4、9.8，**不重复实现**；只补 `concreteMitigation` / `concreteDurability` / `concreteBreakThreshold` / `concreteCost` / `concreteSpeed` 中尚未被覆盖的字段面。
    - **DoD**：每条检查有正例与拒绝例；死亡容器的时序义务有专门的拒绝例（"创建时即写 accepts:false"必须被拒）；已否决携带机制字段必定被拒并引用来源；盾牌无默认可用性。
    - **依赖：** 4.1、2.1、3.3、3.4、0.5。**Requirements:** 7.1、7.5、7.6、7.7、9.2、9.6、9.7。**Properties:** P6、P7、P8、P11、P14。

  - [ ] 4.7 `space-items-weapon-vehicle-rules.ts`（要求 8 与 10 的缺面）
    - **武器组合角色**（要求 8.1、8.4）：校验武器属性 / 谱型 / 距离策略 / 伤害引用 / 弹药行为 / 配件兼容性 / 动作序列 / 目标上限出现在 `compositionRoles` 而非契约顶层；缺角色即引用契约错误。`compositionRoles.role` 出现 `'attack-shape'` 即拒绝（已废止）。伪子类型已由 `INHERIT_GAMEPLAY_VALUE_ONLY_DIFFERENCE` 覆盖，**不重复实现**。
    - **伤害与谱型数值面**（要求 8.7）：补 `baseDamageTable` / `damageTable` / `concreteHitThreshold` / `critIncrement` / `concreteRangeTable` / `concreteAmmunitionCount` / `namedFirearmId` 面（`concreteDamageValue` 已被 `item-vehicle-rules.ts` 覆盖，只补差集）；**不得**把未决表项视为零值，**不得**用同类武器或同类谱型做语义替换。
    - **配件**（要求 8.5）：校验兼容性引用、附件点、效果引用齐备；具体兼容名单 / 数值加成 / 装卸成本 / 弹药类型 / 显示规则属玩法层。
    - **动作序列策略**（要求 8.6）：校验两类远程可引用不同策略；阶段 / 反应条件 / 命中逻辑 / 成本 / 结算归玩法层，并挂 `U-SPACE-004`。
    - **整组合拒绝**（要求 8.8）：伤害 / 命中 / 弹药 / 反应 / 附件引用损坏时拒绝**整个**候选组合。
    - **载具接口齐备性**（要求 10.2、10.6）：校验九项接口（座位角色、货舱容器、门引用、邻接判定、锁定、移动、碰撞、可定向部件、损毁处置）齐备且全部参数化；损毁处置必须声明**被授予状态的撤销引用**（载具摧毁后其授予的半掩体等能力必须一并撤销）；D-011 全部能力面可表达（用一组代表性组合断言可表达性）。
    - **载具内部**（要求 10.8）：`interiorMicroSceneBoundary` 现由 `item-vehicle-rules.ts` 以 Q-04 未决门禁拒绝。**按 D-038 改为结构性拒绝**（载具内部定值不建模为微型场景），门禁编号只保留在"车内外互攻"面上。此改动需与任务 3.2 同步。
    - **DoD**：三类武器身份各有正例；任何伤害表 / 命中门槛 / 暴击增量出现即拒绝且诊断携带 `U-SPACE-001`；载具非实体化必定被拒；D-011 全部能力面可表达且不含数值；`interiorMicroSceneBoundary` 的拒绝理由不再是"Q-04 未决"。
    - **依赖：** 4.1、2.1、3.2、1.5。**Requirements:** 8.1、8.5、8.6、8.7、8.8、10.2、10.6、10.8。**Properties:** P9、P10、P11。

  - [ ] 4.8 `space-items-unresolved-gate-rules.ts`（要求 13）
    - 遍历 `UNRESOLVED_ITEM_CATALOG` 七项，对每项 `forbiddenSurfaces` 逐一检查候选定义是否有非空值；命中即产出未决默认化拒绝，诊断**必须携带 `unresolvedId` 与 `forbiddenSurface` 的 JSON 路径**（要求 13.8）。
    - 检查提升尝试：候选若声称提升某未决项但未携带新的控制决策、来源记录、拥有层与替代关系 → 提升拒绝；历史示例不得作为提升依据（要求 13.9）。
    - **收敛既有分散门禁**：`item-vehicle-rules.ts` 现以 `SOURCE_PROMOTION_REQUIRES_DECISION` 处理 Q-01 与 Q-04，无编号字段。改为由本规则统一承担并携带编号；`item-vehicle-rules.ts` 侧只保留结构性检查，避免同一问题两处报诊断。
    - **分级正确性**：001 / 003 / 004 / 006 与各项数值部分保持未决；002 的二维正交结构、005 的"载具不建模为微型场景"、007 的零费菜单归属**已冻结**，本规则**不得**再对引用它们的配置报未决拒绝。
    - 门禁必须对手写定义、UGC 导入（`src/l2/ugc/ugc-adapter.ts`）与 UI 请求三条入口同时生效。七项一次报完，不早停。
    - **DoD**：七项各有独立的默认化拒绝例；每条诊断可反查到 `U-SPACE-00N`；断言 002 / 005 / 007 的已冻结面**不**产生拒绝；断言三条入口结果一致。
    - **依赖：** 4.1、1.5。**Requirements:** 13.1–13.9。**Properties:** P11。

- [ ] 5. 领域引用能力形状判定（`src/l2/resolution/space-items-capability-shape.ts`）
  - 在既有 `reference-graph.ts` / `reference-collector.ts` / `definition-resolver.ts` 构建的引用图之上，**只补** per-reference 的"领域能力形状与语义族兼容性"谓词。**不重新实现**引用图构建、拓扑排序或依赖遍历。
  - 谓词覆盖：过渡端点必须是天然场景族且具备对应 scale 能力；微型场景 `parent` 必须是天然场景族且 scale 在三档内；物品装备位置必须指向声明了该槽位角色的容器；载具货舱必须指向容器族；伤害引用必须指向已登记伤害语义（**按 §2.1 事实 3，目标是 `damage-axis.category` 体系，不是 `DMG_*`**）；易伤引用指向 `vulnerability-axis.category` 体系；谱型引用按 §6 H-02 的裁决指向 `range-tier.*` / `band-axis.*`。
  - 诊断：缺失引用、kind 或族不匹配（同时报期望与实际）、抽象目标被实例化、引用环（列出全部参与者）、未定义引用；全部携带引用方 JSON 路径，按既有 `canonicalSort` 稳定排序。
  - 物品组合产生悬空槽位 / 容器 / 装备位置 / 消耗效果 / 附件点 / 转换目标时拒绝该组合并保留最后一个有效定义集（要求 7.9）。
  - 载具涉及容器 / 座位 / 门 / 动作 / 移动 / 碰撞 / 损毁 / 附件 / 状态引用时，全部引用必须在激活前验证；任何悬空或不兼容引用原子拒绝（要求 10.7）。
  - **DoD**：每类引用失效有拒绝例；诊断确定且稳定排序；未激活任何候选；`test/l2/space-items/unit/capability-shape.test.ts` 断言"期望 vs 实际"同时出现在诊断中。
  - **依赖：** 4.2–4.8。**Requirements:** 3.7、6.2、7.9、8.8、10.7、12.3。**Properties:** P8。

- [ ] 6. 领域运行时适配（`src/l2/adapters/space-items-*.ts`）
  > **落点理由与自主判断见 §0.1 注**。提交**必须**复用既有 `src/l2/registry/action-submitter.ts`，**不得**新建第二条提交路径。

  - [ ] 6.1 `space-items-transfer.ts`
    - 实现 `TransferIntent` 与 `planTransfer(intent, context)`，返回 `ValidatedOpRequest | StructuredRejection`（`ValidatedOpRequest` 从 `src/l2/model/projection.ts` 导入，不自建）。
    - `opId` 恒为 `'item.move'`：函数签名**不接受** `opId` 入参，实现内**不存在**第二个分支。`purpose`（`pickup` / `drop` / `equip` / `unequip` / `trade` / `death-transfer` / `stow`）只影响 `require` 谓词与 Hook，不影响 `opId`。
    - 前置条件检查顺序固定：物品存在 → 容器存在 → 容器 `depositAllowed`（存入类）/ `withdrawAllowed`（取出类）→ 依赖 Hook 时 `KernelContract` 的 Hook 可用性判定。任一不满足返回带前状态指纹的 `StructuredRejection`，且**不调用**提交通道。
    - `args` 恰为 `{ itemId, toContainerId, atSlot? }`，与引擎层 `ItemMoveArgs` 严格一致（按 0.2 记录的签名核对）。
    - 引擎层返回 `E_OP_NO_LEGAL_SLOT` / `E_OP_SLOT_FULL` 时原样透传，**不得**创建地面替代物、销毁物品或改走其他 Op（要求 7.4）。
    - **死亡容器灌注（要求 7.6）**：`purpose === 'death-transfer'` 路径必须满足灌注时序义务——禁止存入的标记在灌注事务提交后才生效。玩法层 `src/play/core-mechanics/defs/rules.phase.ts` 已 emit `play.death.settled` 等待本层灌注，本任务需与该事件对接（**只消费事件，不改玩法层文件**）。
    - **DoD**：所有 `purpose` 的成功路径产出的 `opId` 均为 `'item.move'`；前置失败时提交通道调用次数为零；无合法槽位时容器与物品位置完全不变；`grep -c "item.move" src/l2/adapters/space-items-transfer.ts` 的字面量出现处只在单一常量定义（架构测试 8.5 机械断言）。
    - **依赖：** 4.2、4.6、0.2。**Requirements:** 3.3、3.5、7.4、7.6。**Properties:** P5、P6、P7。

  - [ ] 6.2 `space-items-micro-scene.ts`
    - 实现 `MicroSceneEntryIntent` 与 `planMicroSceneEntry(intent, context)`，`opId` 恒为 `'entity.place'`，`args` 映射到引擎层 `EntityPlaceArgs.microScene`（`hostNodeId`、`existingMicroSceneId`、`microSceneDefId`、`capacity`），字段名按 0.2 记录核对。
    - `capacity` 只能来自玩法层配置字段的解析结果；本层**不给默认值**，缺配置时为 `undefined`。
    - **不构造**独立的节点回收请求，也**不调用** `node.destroy`：占用归零后的卸载由 `entity.place` 的 Op 实现内部经 `onMicroSceneOccupantsChanged` 完成。文件头注释记录该职责划分与理由（避免两条互不同步的卸载分支）。
    - 实现 `planParentSceneRemoval`：把候选事务中的子微型场景处置与占用者去向映射为一组有序的引擎层结构性 Op 请求；任一子引用或占用者未解决时返回 `StructuredRejection`，**不产出任何请求**。
    - 结构性共享微型场景与按需微型场景共用同一实现，仅调用点不同（要求 5.7）。
    - **DoD**：`opId` 恒为 `'entity.place'`；全文件不存在 `node.destroy` 调用点（架构测试机械断言）；父移除未解决时请求数为零。
    - **依赖：** 4.4、4.3、0.2。**Requirements:** 5.4、5.5、5.6、5.7。**Properties:** P4。

- [ ] 7. 集成契约与领域投影（`src/l2/adapters/space-items-*.ts`）
  - [ ] 7.1 `space-items-integration-contract.ts`
    - 实现集成契约，`domain` 恒为 `'space-items'`——**与既有 `src/core/ugc/model/contract-types.ts::INTEGRATION_DOMAINS` 的字面量机械比对**，该常量已含 `'space-items'`，消费方 `src/core/ugc/contracts/integration-contract-catalog.ts` 已就绪。
    - 声明 `providerVersion`、`exportedDefKinds`、`exportedFamilies`、`referenceConstraints`、`structuralBounds`、`unresolvedItems`、`sourceRecords`。
    - `structuralBounds` 导出**单一天花板 5**及其权威来源（**不是** 5/4/3 三档——旧计划任务 8.1 写的"导出 5/4/3 三档"违反 D-057，本版纠正）。
    - `unresolvedItems` 导出七项 `U-SPACE-00N` 记录及其**分级状态**，使 UGC / UI / AI / 玩法层能区分已冻结契约与未决边界（要求 14.5）。
    - 显式声明本 Spec **不**向其它领域主张其未定义的具体数值、具体实例、地图规则、NPC 规则或 UI 表现规则（要求 14.4）。
    - 契约集合按 family / kind / reference 稳定排序并产出契约指纹；契约版本变化必须可观察（要求 14.6）。
    - **DoD**：导出内容可被 `integration-contract-catalog.ts` 直接消费（集成测试断言）；七项未决记录齐备且分级正确；相同输入的任意排列产出同一指纹；`structuralBounds` 中不含 4 与 3。
    - **依赖：** 1.2、1.5、2.1、5。**Requirements:** 11.8、14.1–14.6。**Properties:** P11、P13。

  - [ ] 7.2 `space-items-projection.ts`
    - 构造领域只读投影：先经引擎层动作可用性通道取合法动作（**复用 `queryActions`，不建第二套判定**；接入点按 0.2 的核实结论），再按授权范围裁剪场景、微型场景、过渡、容器、物品、装备、载具与合法交互（要求 11.5、11.7）。
    - 实现 `FieldProvenanceView`：每个语义字段输出三态之一 `frozen-contract` / `play-layer-config` / `unresolved`（含 `unresolvedId`），并携带归属层与来源记录。玩法层提供的数值必须标记为**玩法层配置**而非基类默认值（要求 2.8、11.8）。
    - 投影为值拷贝后深度冻结：**复用 `src/l2/model/immutable.ts::deepClonePlain` + `deepFreeze`**，不自实现（旧计划要求"自实现 `deepFreezeProjection`"是重复职责，本版纠正）。不得返回活动对象别名，不得暴露任何写方法。
    - 仅表现字段缺失或损坏 → 类型兼容降级 + 表现降级 Warning，且不改变任何语义字段（复用 `ui-adapter.ts` 的既有降级路径）；语义字段缺失或损坏一律拒绝，不发明默认武器 / 防具 / 载具 / 容器 / 场景 / 数值 / 引用 / 行为（要求 11.3、11.4）。
    - 经投影写入语义字段的尝试返回拒绝并保持请求前状态（复用既有 `PROJECTION_WRITE_REJECTED`）。
    - **DoD**：任意嵌套字段的修改尝试不改变语义状态；越权字段不出现在投影中；三态归属可被调用方区分；替换渲染器标识不改变任何动作标识或验证结果。
    - **依赖：** 6.1、6.2、7.1。**Requirements:** 2.8、11.1–11.8。**Properties:** P13。
