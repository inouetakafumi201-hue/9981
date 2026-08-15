# 设计文档

## 概述

本设计文档定义基类层收官轰炸的架构、组件边界、测试属性与错误处理。本规格是**测试/验收规格**：它不引入新玩法机制、不改任何玩家可见数值，交付物是可复现、可回溯、覆盖基类层全部组成的测试证据链，以及对被刨出的真实问题按宪法做整体修复的方案。

基类层按**装载 → 契约束 #1 护栏 → 规范模型 → 验证 → 运行时投影/提交 → 装载桥原子激活 → 跨层贯通/引用一致性**自下而上被轰炸。每层对应一个测试面，每个可测验收标准被恰好一个正确性属性覆盖，每属性被一个带 `Feature: wakeup-base-layer-bombardment, Property N` 的 PBT 实现（≥100 次，压力面 ≥500）。

**核心设计意图（引用一致性，D-073 / 架构决策「契约要机器可校验」）**：基类层一个长期而未闭环的缺口是——`kernelOps`（能力声明读写的 System Op 名）只经过命名规范检查（`space-items-write-channel-rules.ts` 与 `composition-alignment-rules.ts` 的注释都明说"需用 `registry.listOpNames()` 机械比对，但 ValidationContext 不含 kernel 引用"）。本轮把这项升级为**机器断言**：用一个真实接线（`createFullHarness` → `OpRegistry`）+ 基类层目录的 `kernelOps` 全量做机械比对，把"Op 必须真实注册"从注释承诺变成装载期门禁。

## 架构

### 分层与测试数据流（按层逐层往上）

```
┌─────────────────────────────────────────────────────────────┐
│  7 跨层贯通 & 引用一致性守卫（回归锁，verify:data 期也跑）     │
│    目录.kernelOps ↔ 真实 OpRegistry.listOpNames() 机械闭合     │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  6 L2 适配器：ai/ui/space-items 运行时投影/提交的一致性       │
│     vehicleToRuntimeConfig 不越权推导 Q-04 carrier 面         │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  5 装载桥原子激活（catalog-activation/scene-catalog）          │
│    多目录合并 compileAndActivate 原子回滚、跨目录引用闭合      │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  4 kernelOps 机械一致性（D-073 机器可校验）                   │
│    kernelOps ↔ OpRegistry.listOpNames() 全覆盖                │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  3 L2 规范模型/验证层（model+validation）一致性与守卫          │
│    与 src/class 护栏同目录结论兼容；非法 compositionKind/kernelOps 拒绝 │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  2 契约护栏引用闭合（parseClassCatalog findDangling/Collision）│
│    悬空引用/伪子类型/循环引用 确定性拒绝                       │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  1 JSON 装载层（catalog-loader + parseStrictDataJson）         │
│    畸形字节/重复键/类型错位 → 结构错误，绝不静默               │
└─────────────────────────────────────────────────────────────┘
```

### 关键架构原则

1. **机器可校验优先（D-073）**：任何"两个层之间引用不存在"的隐患以自动断言覆盖，不靠注释。`OpRegistry.listOpNames()` 是 Op 存在性的唯一权威来源。
2. **真实接线，不用 mock**：属性测试直接用生产模块（`parseClassCatalog`、`parseStrictDataJson`、`createFullHarness`、`catalog-activation` 的 `compileAndActivate`），不用 stub。
3. **确定性**：每个拒绝/失败结果必须可复现。fast-check 用固定 seed（`fc.assert` 默认 seed 可注入），目录级用例用全量真实目录。
4. **不越权**：测试与修复只落在基类层目录（`src/class/**`、`src/l2/**`、`src/core/kernel/testing/**` 若需复用现存 harness、以及本 spec 目录）。不发明 Q-04 / `VEHICLE_PARAMETER_BINDING_GAP` / `registerMapAnchor` 机制，只做一致性守卫。
5. **按层顺序**：任一层的红必须先清（按宪法整体修）才进下一层，保证下层是可信地基。

## 组件和接口

轰炸的每个被测组件（输入 → 输出 → 已有接口）汇总如下；本规格不新造组件，只断言其正确性。

### 1. JSON 装载（`src/class/catalog-loader.ts` + `json-contract.ts`）
- **输入**：目录源文本 / 已 parse 的 `JsonValue`。
- **输出**：`ClassCatalog` 或抛 `ClassCatalogContractError`。
- **接口**：`parseStrictDataJson(sourceText, sourceId)`、`parseClassJson`、`loadClassCatalog(text, id)`、`parseItemClassCatalog`。
- **本规格断言**：畸形字节/重复键/类型错位是否被结构错误拦下；全量真实目录是否全过。

### 2. 契约护栏（`src/class/class-contract.ts`）
- **输入**：已 parse 的目录 `JsonValue`。
- **输出**：`ClassCatalog`（解析成功时）或 `ContractViolation[]`（`findDanglingReferences` 等）。
- **本规格断言**：悬空引用、伪子类型、id 碰撞、循环引用的确定性拒绝与有限终止。

### 3. L2 规范模型 / 验证（`src/l2/model/**`、`src/l2/validation/**`）
- **输入**：目录定义/能力。
- **输出**：解析模型 / 验证诊断。
- **接口**：`composition-registry.ts`（`resolveComponent`/`listComponents`/`isComponentId`）、`composition-alignment-rules.ts`（`kernelOps` 形状与命名）、`space-items-write-channel-rules.ts`。
- **本规格断言**：与 class 护栏同目录结论兼容；非法 `kernelOps` 形状 / `compositionKind` 被拒。

### 4. `kernelOps` 机械一致性（新增守卫）
- **输入**：目录的 `kernelOps`/`operationChannels` 全量 + 真实 `OpRegistry.listOpNames()`。
- **输出**：`{ registered } | { missing: string[] }` 报告。
- **接口**：`createFullHarness()`（`src/core/kernel/testing/full-harness.ts`）的 `registry.listOpNames()`。
- **本规格断言**：所有声明 Op 名都在已注册集内；缺失则机器拒绝。

### 5. 装载桥原子激活（`src/class/catalog-activation.ts`、`scene-catalog-activation.ts`）
- **输入**：一组 `ClassCatalog`（统一形状 8 目录）。
- **输出**：`CompilationResult`（真实 `SpecificationCompiler.compileAndActivate`）。
- **接口**：`activateCatalogs`/`buildCatalogDocument`/`catalogDocumentInput`/`createCatalogCompilerHost`。
- **本规格断言**：生产模式成功、失败原子回滚、跨目录引用闭合。

### 6. L2 适配器（`src/l2/adapters/**`）
- **输入**：`CandidateDefinition`（space-items 定义模型）。
- **输出**：`ContainerRuntimeConfig`/`ShieldRuntimeConfig`/`SceneRuntimeConfig`/`VehicleRuntimeConfig`。
- **接口**：`containerToRuntimeConfig`/`vehicleToRuntimeConfig`/`validate*RuntimeConfig`。
- **本规格断言**：运行时配置字段与 L1 契约兼容；`VehicleRuntimeConfig` 不推导 `category:'carrier'` 面；`validate*` 对脏输入返回结构化字符串（不抛）。

### 7. 贯通守卫（新增）
- **输入**：全量真实目录（统一形状 + 族特有）。
- **输出**：三方对齐报告（目录层 × Op 层 × 契约层）。
- **本规格断言**：`npm run verify` 期可复跑，标出已知边界与待裁决项。

## 数据模型

属性测试的关键数据形状（不从目录之外发明字段，只取目录真实字段的投影）：

```typescript
/** 目录一个能力/类声明的 Op 名引用（规范化后）。 */
interface OpNameUse {
  readonly catalogDir: string;      // 如 'actions'
  readonly ownerPath: string;       // 如 'actions/classes/0/kernelOps'
  readonly opName: string;          // 如 'prop.set'
}

/** kernelOps 机械一致性比对结果。 */
interface OpReferenceReport {
  readonly uses: readonly OpNameUse[];
  readonly registered: readonly string[];   // OpRegistry.listOpNames()
  readonly missing: readonly OpNameUse[];   // 指向未注册 Op 的引用
  readonly declaredButUnused?: never;       // 本规格不裁决"未使用即错"
}
```

```typescript
/** 契约护栏拒绝的确定性投影（用于相等断言）。 */
interface ViolationProjection {
  readonly kind: string;   // 违例类别（REF / COLLISION / 类型错位）
  readonly path: string;   // JSON 路径
}
```

## 正确性属性

> 每个属性用 `对于任意/所有` 全称量化书写，并在 `**验证**` 回链到对应的要求子句。每个属性被恰好一个 PBT 测试实现，文件名、tag、迭代次数在 tasks.md 一一对应。要求 8（规格完备性元要求 8.1-8.4）不由正确性属性覆盖，而由本规格自身的结构保证 + execution-report 的每属性→文件映射表 + 要求-设计-任务双向回溯表承担（见 design 末尾「完备性自证」与 tasks.md 勾选状态、execution-report 交付物表）；8.2/8.3/8.4 的每属性恰好一实现、每任务回溯要求子句、EARS/INCOSE 合规分别由下表映射与 requirements 文件的 EARS 标注落实。

### 属性 1：JSON 装载的畸形输入结构性失败
*对于任意* 畸形候选源文本（截断 JSON、尾随垃圾、非法转义、重复键的 JSON 文本、超大文档、超深嵌套、`kernelOps` 用非字符串数组的文档），*当* 经 `parseStrictDataJson` / `parseClassJson` / `loadClassCatalog` 解析时，*则* 要么成功返回结构合法的 `ClassCatalog`，要么抛出的错误类型是 `ClassCatalogContractError` 或包含已分类诊断——绝不把畸形当合法吞掉、绝不向调用方抛出 `SyntaxError`/`RangeError` 之外的未捕获原始异常。
**验证：要求 1.1、1.2、1.3**

### 属性 2：全量真实目录可解析且不被改动
*对于每一个* 真实目录文件（`src/class/**/index.json` + 各 `*.json`），*当* 其原始字节经 `parseClassCatalog(parseClassJson(text, sourceId), sourceId)` 解析时，*则* 解析成功且不抛异常，且解析前后字节相同（无静默改写）。
**验证：要求 1.4、2.1**

### 属性 3：契约护栏对悬空引用与 id 碰撞的确定性拒绝
*对于任意* 从真实目录派生、注入单点/组合悬空 class/capability/component/structural-bound 引用的目录，*当* 经 `parseClassCatalog` 解析时，*则* 该注入在有限步内被确定性拒绝（`findDanglingReferences` 返回非空或解析抛 `ClassCatalogContractError`），且对同一注入反复解析结果的违例集合与顺序逐位相同。
**验证：要求 2.1、2.2、2.3**

### 属性 4：契约护栏对伪子类型与重复 id 的确定性拒绝
*对于任意* 注入"两个 class 共享同一 id / class↔capability id 碰撞 / 相同的类型身份陈述"的目录，*当* 经护栏解析时，*则* 被确定性拒绝（`findPseudoSubtypes` 非空或解析抛错），且拒绝理由落在已分类违例内。
**验证：要求 2.2**

### 属性 5：循环引用的有限终止
*对于任意* 从真实目录派生、注入 class↔capability 双向环或目录自引用的目录，*当* 经护栏解析时，*则* 在有限步内完成（拒绝或被安全接受），不发生死循环、栈溢出或超时（测试断言完成时间受控）。
**验证：要求 2.4**

### 属性 6：L2 规范模型与 class 护栏的同目录兼容
*对于所有* 真实统一形状目录，*当* class 护栏（`parseClassCatalog`）与 L2 规范模型/验证层（`src/l2/**` 的解析与 `composition-alignment-rules` 等）各自处理同一输入时，*则* 两者的接受/拒绝结论兼容：护栏接受的真实目录，L2 验证不产生阻断性错误；护栏拒绝的注入违例，L2 产生同族违例。
**验证：要求 3.1**

### 属性 7：L2 验证对非法 kernelOps/compositionKind/structural-bound 的拒绝
*对于任意* 注入非字符串数组 `kernelOps`、非法 `compositionKind`、结构边界越界数值的目录，*当* 经 L2 验证层处理时，*则* 报告 `SYSTEM_BINDING_*` / `COMPOSITION_KIND_*` / 数值分类系的已分类违例，而绝不静默接受。
**验证：要求 3.2**

### 属性 8：composition-registry 组件解析一致性
*对于任意* `component.*` id 前缀的组件 id，`resolveComponent` 对未登记 id 返回 `null` 而不抛异常；对已登记 id 返回与其登记时 `kernelOps`/`parameters` 逐位相等的组件，且 `listComponents` 按 id 字典序稳定排序。
**验证：要求 3.3**

### 属性 9：`kernelOps` 机械一致性（核心引用错误检测）
*对于全部* 真实目录的每个声明 `kernelOps`（及 `operationChannels`）项，*当* 与真实 `OpRegistry.listOpNames()`（`createFullHarness()` 接线）机械比对时，*则* 每个 Op 名都落在已注册集内；若有任何缺失，装载期守卫以结构化拒绝暴露缺失项，且该守卫以 `OpRegistry.listOpNames()` 为唯一权威（非硬编码清单）。
*说明*：三个子句各自落实——4.1（未注册 Op → 结构化拒绝，opconsistency 注入 `ghost.op` 用例机器断言）；4.2（`OpRegistry.listOpNames()` 为唯一权威，throughline「真实 registry 唯一权威」用例断言 listOpNames 非空且映射真实生产注册）；4.3（每个声明 kernelOps 被机器比对，统一形状 8 目录 `report.missing === []` 全量闭合）；4.4（命名合法但未注册与引用未声明 capability 同级阻断，注入 `ghost.op` 被 report 暴露为 missing 而统一目录 0 缺失）。
**验证：要求 4.1、4.2、4.3、4.4（opconsistency.test.ts + throughline.test.ts）**

### 属性 10：装载桥生产模式激活成功与跨目录引用闭合
*对于* 8 个统一形状真实目录合并装载，*当* 经 `activateCatalogs`（`compileAndActivate`，targetLayer 基类层）激活时，*则* 成功、无悬空引用、产生确定性快照，且一个目录的类引用另一目录的能力在单次合并内被完整解析。
**验证：要求 5.2、5.3**

### 属性 11：装载桥失败原子回滚
*对于任意* 在合并文档中注入契约违例的输入，*当* 经 `compileAndActivate` 激活时，*则* 若失败，已激活的定义集合与激活前逐位相同（原子回滚），注册表无候选变更残留。
**验证：要求 5.1**

### 属性 12：L2 适配器运行时配置与 Q-04 边界
*对于任意* 有效的 space-items `CandidateDefinition`，`*when*` 经 `vehicleToRuntimeConfig`/`containerToRuntimeConfig` 转换时，*则* 输出配置的字段集与 L1 运行时契约分类兼容，且**不推导** `category:'carrier'` 承载面（Q-04 未决，维持现状）；`validate*RuntimeConfig` 对脏配置返回结构化字符串列表而不抛异常。
*说明*：三个子句各自落实——6.1（vehicle/container 转换字段与 L1 分类兼容、不推导 carrier 面，adapter 用例断言 `'category' in config === false`）；6.2（写只经 `KernelContract.invoke` 唯一通道、不直接 mutate 运行态）由 throughline 属性 13 的跨目录写通道扫描落地，同时该断言的**机器实现上游 `wakeup-base-layer-ecs` 属性 8（`ecs-read-only-projection.property.test.ts`，Requirement 4.2）已覆盖**——每个组件形状的 `writeChannelContract` 恒为 `{ channel: 'OpRegistry.invoke', alternateChannels: 'none' }`；本属性对 6.2 采用**跨 spec 复用 + 属性 13 扫描**而非重复实现；6.3（脏配置 validate 返回结构化字符串不抛，adapter `validate*` 500 次生成用例机器断言）。
**验证：要求 6.1、6.3（本属性实现）；6.2 由属性 13 扫描 + 上游 base-layer-ecs 属性 8 复用实现（豁免唯一实现）**

### 属性 13：跨层贯通回归锁
*当* `npm run verify:data` 通过后，*则* 贯通守卫（目录层 × Op 层 × 契约层）可复跑并全部通过（真实目录 JSON 可解析 + 护栏可接受 + kernelOps 机械闭合），同时如实标出已知切片边界与待裁决项不视为失败。
*说明*：本属性在通过 line 文件里追加一项**跨目录写通道扫描**（任何 not-mutate 组件不声明写 Op —— 补齐要求 6.2 在本规格的真实断言，机器实现落在此处；见属性 12 的复用说明）。该扫描同时落实要求 1.5（not-mutate 组件声明写 Op 名 → 暴露为待裁决边界）。对要求 **5.4**（装载桥切片边界之外的字段违例——structuralBounds 数值归属、值集合、玩法层参数绑定——按既有显式切片边界处理/拒绝，不看做 Must-fix、回归为已知边界）：由属性 11 的失败原子回滚与属性 10 的跨目录闭合共同执行（切片外字段违例在激活时按既有边界处理，属性 11 已证明不污染已激活集、属性 13 的两方对齐报告如实把 Q-04/VEHICLE_PARAMETER_BINDING_GAP/registerMapAnchor 标为已知边界而非 Must-fix）。
**验证：要求 7.1、7.2、6.2（写通道扫描子项）、1.5（同扫描覆盖）、5.4（由属性 10/11/13 联合执行）**

## 错误处理

1. **契约违例归类**：所有拒绝必须落在既有诊断命名空间（`ClassCatalogContractError`、`E_REF_*`、`SYSTEM_BINDING_*`、`COMPOSITION_KIND_*`、数值分类系、`OP_BYPASS_FORBIDDEN` 等），不得抛未分类原始异常。测试断言"不抛 `SyntaxError`/`RangeError` 之外的未捕获异常"。
2. **确定性拒绝**：拒绝集合与顺序可复现（`sortViolations` + 固定 fast-check seed）。
3. **原子性**：装载桥失败时回滚到激活前快照，零残留。
4. **边界登记**：`category:'carrier'` 面、`VEHICLE_PARAMETER_BINDING_GAP`、`registerMapAnchor` 接入、`src/l2` 与 spec-compiler 收敛归属，属待裁决项，本规格做守卫不发明机制——守卫把它们标为已知边界而非 Must-fix。

## 测试策略

- **语言/库**：TypeScript，原生 `fast-check`（已装 3.23.2），不用 `@fast-check/vitest`。
- **放置**：新测试落在 `src/class/__tests__/base-layer-bombardment-*.test.ts`（属性 1-13 对应一个文件，或按属性分组），全部在 `tsconfig.json`/`eslint`/`vitest include` 现有范围内。
- **复用**：真实模块直连；`kernelOps` 机械一致性用 `createFullHarness()`（已存在，`src/core/kernel/testing/full-harness.ts`）的 `registry.listOpNames()`。
- **迭代**：常规属性 ≥100，压力面（属性 1/5/11 的子属性）≥500。
- **门禁**：收尾跑 `npx tsc --noEmit`、`npx vitest run`（相关范围 + 全量）、`npm run lint`、`npm run verify:data`、`npm run verify:docs`。

## 完备性自证（要求 8）

> 要求 8 是元规格自身的完备性证明，不由任一轰炸属性承担（设计上这些属性质疑的是「被测系统」，而 8.x 质疑的是「规格自身」）。以下逐条给出机器/文档断言落点，保证四向回溯闭合（要求→设计→任务→测试证据）。

| 要求 | 自证任务 | 落点 |
|---|---|---|
| 8.1（每条验收标准遵循 EARS/INCOSE） | requirements.md 每条 `[Pattern]` 标注六模式之一 + 主动语态/无模糊术语 | requirements.md 28 条验收标准逐条带 EARS 括号标注；`verify:docs` 不报废用词 |
| 8.2（每条可测验收标准被恰好一个属性覆盖） | 属性↔要求子句回溯表 | 下表 +「属性验证行」回链（本设计前文）；无被遗漏子句 |
| 8.3（每属性被恰好一个 PBT、迭代≥100、tagged） | 属性↔测试文件↔迭代映射 | 下表「测试文件/tag/迭代」列；`Feature: wakeup-base-layer-bombardment, Property N` 头注释在每个文件 |
| 8.4（每实现任务回溯到要求子句） | tasks.md 每任务 `_要求：N.M_` | tasks.md 全部任务逐条带要求子句；execution-report 交付物表回链 |

**属性↔要求↔测试文件↔迭代映射表**（8.2/8.3 的机器可校验承载）：

| 属性 | 覆盖要求 | 测试文件 & tag & 迭代 |
|---|---|---|
| 属性 1 | 1.1 1.2 1.3 | `base-layer-bombardment-loading.test.ts` · Property 1 · numRuns 500 |
| 属性 2 | 1.4 2.1 | `base-layer-bombardment-opconsistency.test.ts`（属性2基础）· Property 9/2 头 · 目录级 |
| 属性 3 | 2.1 2.2 2.3 | `base-layer-bombardment-references.test.ts` · Property 3/4/5 · numRuns 100 |
| 属性 4 | 2.2 | 同属性 3 |
| 属性 5 | 2.4 | 同属性 3（含时间卫） |
| 属性 6 | 3.1 | `base-layer-bombardment-model.test.ts` · Property 6/7/8 |
| 属性 7 | 3.2 | 同属性 6 |
| 属性 8 | 3.3 | 同属性 6 · numRuns 100 |
| 属性 9 | 4.1 4.2 4.3 4.4 | `base-layer-bombardment-opconsistency.test.ts` · Property 9 |
| 属性 10 | 5.2 5.3 | `base-layer-bombardment-activation.test.ts` · Property 10/11 |
| 属性 11 | 5.1 | 同属性 10 · numRuns 500 |
| 属性 12 | 6.1 6.3（6.2 复用+属性13扫描） | `base-layer-bombardment-adapter.test.ts` · Property 12 · numRuns 500 |
| 属性 13 | 7.1 7.2 6.2 1.5 5.4 | `base-layer-bombardment-throughline.test.ts` · Property 13 |
| 要求 8.1-8.4 | （元要求，非被测属性） | 本「完备性自证」节 |

> 每一可测验收标准（要求 1-7 的 28 条中的可测项）在表中覆盖；剩下 8.1-8.4 为元要求，由本表的结构性保证履行。
