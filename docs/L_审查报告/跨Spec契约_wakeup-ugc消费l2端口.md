# 跨 Spec 契约：wakeup-ugc 消费 l2 基类层端口（方案 A 落地）

> 裁决：方案 A（wakeup-ugc 消费 l2 端口），已确认。原则：解耦优先、基层长远稳定。
> 本文件是**唯一权威的端口边界契约**，供 l2-base-layer-spec 会话实现。
> 记录时间：2026-08-08。

## 当前状态（2026-08-11 最终验收）

**PT-02 已交付**：`src/l2/ugc/ports/index.ts` 导出 `createL2PortBundle`，返回冻结的 JSON Codec、Definition Validator、Reference Resolver 和双目标层 atomic Definition Registry。

**wakeup-ugc task 11.1 完成**：`src/core/ugc/integration/l2-adapter.ts` 实现唯一 composition root，仅消费 `createL2PortBundle()`，按目标层装配 `ValidationCoordinator` / `AtomicActivationCoordinator` / `UGCIngressFacade`；无语义转换、无第二套 validator/resolver/registry。

**守卫通过**：
- `src/core/ugc/integration/l2-port-contract.ts` 运行期检查方法存在、目标层一致、provider/version 同源、双 registry 隔离。
- `src/core/ugc/__tests__/architecture-boundary.test.ts` 更新为"imports only through frozen l2 port composition seam"。

**真实全链路测试接通**：`src/core/ugc/__tests__/integration/full-pipeline.integration.test.ts` 13 个场景覆盖 base success、四类 Adapter 同路由、reject 三状态不变、success 恰好一次、跨域引用、覆盖/删除、迁移、表现、规范快照、陈旧基线、玩法缺口拒绝、配额。

**质量门禁**：
- 定向 28/28 ✅（full-pipeline 13 + l2-port-contract 8 + architecture-boundary 7）
- 全仓 2423/2425 ✅，2 个失败均为未修改并行区域（l2 space-items ReferenceError、spec 术语位置契约）
- TypeScript + ESLint 全部本次文件通过 ✅

**剩余阻塞（task 11.3）**：l2 尚未冻结规范玩法包验证契约，valid play candidate 场景保持失败关闭（诚实验收，不虚标完成）。待 l2 交付冻结契约后补齐场景 11。

**详细验收报告**：`docs/L_审查报告/UGC薄适配器最终验收报告.md`。

---

## 一、为什么不由 wakeup-ugc 写"适配 l2 当前内部形状"的适配器

l2 当前对外只暴露**单体** API：`parsePackage(text) → Result<DefinitionPackage>` 与
`activate(registry, package) → Result<ActivationSuccess>`，且用的是 l2 自己的 `Result`、
`Diagnostic`、`DefinitionPackage` 模型（与内核 `Diagnostic`、wakeup-ugc 模型均不同）。

若 wakeup-ugc 现在写一个适配器去桥接这些**内部形状**，那个适配器本身就成了对 l2 不稳定内部的
硬耦合——这与"解耦优先"背道而驰。解耦的正确做法是：**l2 发布一组稳定端口,wakeup-ugc 只依赖端口**。
wakeup-ugc 已经有这组端口的 TypeScript 接口(`src/core/ugc/ports/*.ts`)与失败关闭替身;
缺的是 l2 侧实现它们。本文件把这组接口固化为跨 Spec 契约。

---

## 二、l2 必须导出的四个冻结端口（形状以 `src/core/ugc/ports` 为准）

以下接口的**权威定义**在 wakeup-ugc 仓库内,l2 应 `import type` 复用,不得另立平行类型。

### 2.1 `DefinitionValidationGateway`（对应 l2 的 validateFullPackage 能力）

```
validate(request: CanonicalizedChangeRequest, context: DefinitionValidationContext, budget: QuotaBudget)
  → ValidationStageResult   // { diagnostics; coveredCapabilities; validated: UpstreamValidatedCandidate | null }
```

- l2 内部可继续用 `validateFullPackage` 实现,但**对外**必须是这个离散签名。
- `coveredCapabilities` 必须如实声明覆盖了哪些 `MANDATORY_VALIDATION_CAPABILITIES`;
  wakeup-ugc 会逐项核对,缺项即失败关闭。
- 诊断必须是**内核共享 `Diagnostic`** 形状(`src/core/kernel/state/diagnostic.ts`),不是 l2 私有诊断。
  → 这要求 l2 增加一层"l2 Diagnostic → 内核 Diagnostic"投影(见第四节)。

### 2.2 `ReferenceResolutionGateway`

```
resolve(validated, activeSnapshot, contracts, budget)
  → ReferenceStageResult    // { diagnostics; coveredCapabilities; graph: UpstreamResolvedReferenceGraph | null }
```

- l2 的 `validateFullPackage` 已经产出 `graph` 与 `resolved`;把它们投影为
  `UpstreamResolvedReferenceGraph`(nodes/outboundEdges/inboundEdges/revalidatedDependents)即可。

### 2.3 `DefinitionRegistryGateway`（对应 l2 的 activate 能力 + baseline-CAS 包裹）

```
readSnapshot() → DefinitionRegistryReadSnapshot   // { registryVersion; snapshotFingerprint; targetOwnership; activeDefinitionIds; payload }
activateAtomically(change: ValidatedChangeSet, expected: ValidationBaseline) → ActivationResult
targetOwnership: 'base-layer' | 'play-layer'
```

- l2 的 `activate(active, candidate)` 是纯函数、返回带 `snapshot.fingerprint` 的新注册表,
  这与 baseline-CAS **天然兼容**:适配器在调 `activate` 前后读快照指纹并比对即可。
- **谁补 baseline-CAS**:由 wakeup-ugc 的 `AtomicActivationCoordinator`(已实现)在**外层**补。
  因此 l2 的 `activate` 不必新增 baseline 参数——它只需保证"拒绝时返回旧快照指纹、成功时发布新指纹",
  l2 现有实现已满足(`priorFingerprint` 逻辑)。这是 R13 安全属性得以保留的关键。
- `targetOwnership`:l2 需按目标层暴露两个注册表实例(或一个带层标记的实例),使
  wakeup-ugc 能拒绝"玩法层产物提交进基类层注册表"。

### 2.4 `JSON_Codec`（对应 l2 的 parsePackage）

- l2 的 `parsePackage(text) → Result<DefinitionPackage>` 是 codec 能力。
- **归属决策**:wakeup-ugc 的 `design.md` 把解码/规范化**留在 wakeup-ugc 自身**(`src/core/ugc/codec`、
  `canonical`)。因此 codec 端口在方案 A 下**不需要 l2 实现**:wakeup-ugc 自持 JSON 解码/规范化,
  只把**规范化后的 JSON 文本 / decodedValue** 交给 l2 的 validator。
- l2 的 `parsePackage` 内部若也做解析,那是 l2 内部实现细节;wakeup-ugc 不经由它解析。
  → 但需要一个**约定**:validator 端口接收的是 wakeup-ugc 规范化后的 `decodedValue`,
  l2 validator 必须能从该 `decodedValue` 构造其内部 `DefinitionPackage`(见第三节映射)。

---

## 三、`ValidatedChangeSet` ↔ `DefinitionPackage` 映射（l2 侧实现）

wakeup-ugc 的工作单元是**每文档候选**;l2 是**整包 `DefinitionPackage`**。映射约定:

| wakeup-ugc | l2 DefinitionPackage | 说明 |
|---|---|---|
| `CanonicalCandidate.decodedValue` | `definitions` / `overrideIntent` / `removals` / `dependencies` | l2 validator 从规范化 JSON 值解读出包结构 |
| `ChangeRequestBinding.operation` (add/replace/remove) | `overrideIntent` / `removals` 的有无 | operation 决定映射到 override 还是 removal |
| `ChangeRequestBinding.sourcePackageId` | `packageId` | 稳定来源包身份 |
| `CanonicalCandidate.schemaVersion` | `schemaVersion` | 文档显式声明 |
| `CandidateSource` 溯源 | `sourceRecords` | 复用共享 `SourceRecord` |

- **单文档 vs 整包**:方案 A 下 wakeup-ugc 一次提交一个候选文档,映射为一个只含该文档定义的
  `DefinitionPackage`。若未来需要多文档合并成一个原子包,再扩展绑定(当前不做)。

---

## 四、诊断模型桥接（l2 侧实现)

- l2 有自己的 `src/l2/model/diagnostic.ts`;wakeup-ugc 端口要求**内核共享 `Diagnostic`**
  (`src/core/kernel/state/diagnostic.ts`,已含任务 1.3 的可空 `at`/`path` 扩展)。
- l2 需提供 `l2Diagnostic → 内核 Diagnostic` 的投影,并保证:
  - 错误码落在封闭 `ERR_CODES` 内(不得自由字符串);
  - scope/at/path 按 wakeup-ugc R14.4 填(document/definition/change-set/registry,结构不适用处显式 null);
  - severity 与 `HINT_TEMPLATES` 对齐。
- 这也顺带消除了当前"两套诊断模型"的分叉。

---

## 五、l2 侧需要停止/降级的行为

1. **降级 `src/l2/ugc/`**:`fromUgc` 目前是"UGC 独立接入编排器"(自己扫禁止构造 + 自己走 parsePackage),
   与 wakeup-ugc R3「单一统一入口」冲突。方案 A 下它应:
   - 要么**移除**;
   - 要么降级为 l2 **内部测试便利**并在文档中明确"非 UGC 正式接入路径,不得被生产调用"。
   - l2 的 `detectProhibitedConstructs` / `scanJson` 作为**部件**保留无妨,冲突点只在"自成一套入口"。
2. **不要在 l2 内新增第二套配额/基线/branded 产物**。这些归 wakeup-ugc。

## 六、验收口径（何时 11.1/11.3 可以做）

wakeup-ugc 任务 11.1/11.3 的开工条件(全部满足才动手):

1. l2 导出上述 **2.1 / 2.2 / 2.3** 三个端口(codec 不需要,见 2.4),签名 `import type` 自 wakeup-ugc `ports`;
2. l2 提供**内核 `Diagnostic` 投影**(第四节);
3. l2 提供 `decodedValue → DefinitionPackage` 的映射(第三节);
4. l2 的这三个端口有**自己的测试**证明其行为(不由 wakeup-ugc 代测);
5. `src/l2/ugc` 已按第五节降级,不再自称统一入口;
6. l2 相关文件在一段静默期内不再频繁变更(避免边写边接)。

满足后 wakeup-ugc 在 `src/core/ugc/integration/` 写**薄**适配器(只做端口装配,不做语义转换),
并补 `__tests__/integration/full-pipeline.integration.test.ts`。

## 七、当前状态与交接

- **wakeup-ugc 侧（当前）**：任务 11.1 已完成，唯一生产装配缝为 `src/core/ugc/integration/l2-adapter.ts`；真实基类层端口 full-pipeline 测试已落地。11.3 仍因规范玩法包验证契约未冻结而部分阻塞，禁止用基类定义包写入 play registry 冒充完成。
- **l2 侧（已交付）**：第二节三端口 + 第三、四节桥接 + 第五节降级已由 PT-02 完成；后续交接项是发布玩法包的稳定验证/组合契约，使 valid play candidate 能组合已登记基类定义而不复用基类包语义。
- **跨 Spec 边界**：UGC 只消费 `src/l2/ugc/ports/index.ts`，不修改或依赖 l2 内部实现文件。

---

## 八、已交付（PT-02，l2 侧，2026-08-10）

l2 侧端口全部落地于 `src/l2/ugc/ports/`，入口 `createL2PortBundle()`（`port-bundle.ts`）。
`tsc --noEmit` 0 错、`vitest run` 2158 全绿、`eslint` 0 错（8 条为既有他处 warning）。

| 契约条目 | 交付物 | 状态 |
|---|---|---|
| §2.1 `DefinitionValidationGateway` | `validation-gateway.ts` | ✅ 复用 `validateFullPackage`，与 `activate` 同输入；如实声明 `coveredCapabilities` |
| §2.2 `ReferenceResolutionGateway` | `resolution-gateway.ts` | ✅ 重建工作图 + 活动入边补全 + 传递入边闭包重验 + 确定性边序 |
| §2.3 `DefinitionRegistryGateway`（含 CAS） | `registry-gateway.ts` | ✅ 按层各一份；CAS 比对 `definitionRegistryVersion`；拒绝路径 `unchanged=true` 且前后指纹相同 |
| §2.4 JSON_Codec | 不需 l2 实现 | ✅ 端口从 `canonicalJson`/`decodedValue` 起步 |
| §三 `decodedValue→DefinitionPackage` | `package-mapping.ts` | ✅ 以 `canonicalJson` 喂 `parsePackage`，并与 `decodedValue` 语义一致性核对；operation→override/removal 授权核对 |
| §四 诊断投影 | `diagnostic-projection.ts` | ✅ 全部 l2 代码 → UGC `DiagnosticSelector`（`satisfies Record` 编译期穷举）；scope/at/path/severity 契约由测试断言 |
| §五 降级 `fromUgc` | `ugc-adapter.ts` 文档 | ✅ 保留为 l2 内部便捷入口并注明「非 UGC 正式接入路径」；与端口无职责重复（都复用同一 `parsePackage`） |
| §六.4 端口自测 | `ports/__tests__/*` | ✅ bundle 通过 `inspectL2PortBundle`；验证/解析/CAS/诊断投影穷举各有断言 |

**补充能力**（UGC 契约要求但 l2 核心结构上没有，由端口补齐，非职责重复）：
- 封闭 Schema（`closed-schema.ts`，Proxy 探测；作用域=包顶层+定义级封闭字段集，见文件内已知局限说明）；
- 提供方判定 `provider-domain`/`ambiguous-target`（`provider-domain.ts`，输入=UGC 契约目录，l2 拿不到）；
- 包依赖环 `package-cycle`（`package-cycle.ts`，触发此前从未被使用的 `REF_PACKAGE_DEPENDENCY_CYCLE`）。

**解耦守卫**：`port-bundle.ts` 不 import `src/core/ugc/integration/l2-port-contract.ts`，只实现其结构形状；
UGC 侧 `integration/__tests__/l2-port-contract.test.ts` 的「零 l2 耦合」用例仍全绿。

**交接给 wakeup-ugc（解除 task 11.1/11.3 阻塞）**：第六节 1–5 条已满足。11.1 现可写薄装配器：
`createL2PortBundle()` → `inspectL2PortBundle` 校验 → 接入 `AtomicActivationCoordinator`。
注意端口消费需由本提供方（`providerId='l2-base-layer'`）串起：验证产物、解析产物、注册表快照三者的
`payload` 都带 provider 令牌，跨提供方混用会失败关闭。
