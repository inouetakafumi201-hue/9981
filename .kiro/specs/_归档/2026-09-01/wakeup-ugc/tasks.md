# Implementation Plan: WakeUp UGC Declarative Ingress

## Overview

本计划把 [design.md](design.md) 转换为依赖有序、可单独验收的 TypeScript 实施任务。生产代码落在 `src/core/ugc/`，测试也位于 `src/core/ugc/**`，以符合根 `vitest.config.ts` 的 `src/**/*.test.ts` 发现规则。

UGC 的实现目标是接入编排，不是创建第二套定义系统：所有来源产生不可变候选 JSON；有界解码、可信 Schema 迁移和规范化后，必须调用基类层统一 `JSON_Codec`、`Definition_Validator`、`Reference_Resolver` 和 `Definition_Registry`。任何上游端口、共享错误码、领域契约或可信配额缺失都失败关闭。现有 `src/core/kernel/state/def.ts` 的逐项 `DefRegistry.register`、`safety.ts` 的部分 `Linter` 和运行时 `QuotaEnforcer` 不能作为完整验证或原子激活替代品。

本计划不实现编辑器 UI、自然语言模型、发布分发、网络、审核、宿主持久化、具体玩法数值、具体地图/胜负规则、领域内部语义或运行时脚本。候选永远是数据，不会被动态执行。

## Task Dependency Graph

下图既是依赖图，也是串行闸门（serial gates）：箭头下游的任务不得在上游未通过验收前开工。

```text
1 上游证据、共享错误码与工程基线
  └─ 2 UGC 公共模型、端口、诊断与静态边界
       ├─ 3 技术配额与有界 JSON 解码
       ├─ 4 Schema 版本、可信文档迁移与规范化
       └─ 5 跨领域契约目录与验证基线
            └─ 6 单一验证流水线与基类层端口接入
                 ├─ 7 表现资源回退与语义指纹守卫
                 └─ 8 不可伪造验证产物与原子激活
                      └─ 9 公共 Facade 与 Test Interface
                           └─ 10 Properties 1–16
                                └─ 11 真实上游集成、恶意输入和故障注入
                                     └─ 12 全量质量门禁与追踪验收
```

任务 3、4、5 在任务 2 后可并行，但任务 6 必须等待三者。任务 7 与任务 8 的基础实现都依赖任务 6；任务 8 的成功路径还依赖任务 7。任务 10 的每个性质测试使用独立文件，可在任务 9 后按其具体前置并行。任务 11 必须等待全部本地性质通过，并且真实上游端口已经冻结。不得用端口替身测试代替任务 11 的集成证据。

机器可读的并行波次（wave 号即执行顺序，同一 wave 内的任务可并行）：

```json
{
  "waves": [
    { "wave": 0, "tasks": ["1.1", "1.2"] },
    { "wave": 1, "tasks": ["1.3"] },
    { "wave": 2, "tasks": ["2.1", "2.2", "2.3"] },
    { "wave": 3, "tasks": ["2.4", "3.1", "4.1", "5.1"] },
    { "wave": 4, "tasks": ["3.2", "4.2", "5.2"] },
    { "wave": 5, "tasks": ["3.3", "4.3", "6.1"] },
    { "wave": 6, "tasks": ["6.2", "6.3", "6.4", "6.5"] },
    { "wave": 7, "tasks": ["7.1", "8.1"] },
    { "wave": 8, "tasks": ["7.2", "8.2"] },
    { "wave": 9, "tasks": ["8.3"] },
    { "wave": 10, "tasks": ["9.1", "9.2"] },
    { "wave": 11, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "10.6", "10.7", "10.8", "10.9", "10.10", "10.11", "10.12", "10.14", "10.15", "10.16"] },
    { "wave": 12, "tasks": ["10.13"] },
    { "wave": 13, "tasks": ["11.1", "11.2"] },
    { "wave": 14, "tasks": ["11.3", "11.4", "11.5", "11.6"] },
    { "wave": 15, "tasks": ["12.1", "12.2", "12.3"] }
  ]
}
```

同一 wave 内只有在不修改同一文件、端口已冻结且不存在隐式依赖时才可并行。Property 13 位于后续 wave，因为它需要真实或契约完整的 atomic registry 行为。最终验收必须以真实上游集成和全量质量门禁为依据，不能只以端口替身测试通过宣称完成。

## Tasks

- [x] 1. 建立上游契约证据、共享诊断目录和可复现工程基线
  - [x] 1.1 记录真实工程命令和现有行为基线。
    - 核对根 `package.json`、`tsconfig.json`、`vitest.config.ts`，确认生产/测试文件发现范围、ESM 导入约定、strict/noUncheckedIndexedAccess 和非 watch 命令。
    - 运行并记录 `npm run typecheck`、`npm test`、`npm run lint` 的实施前结果；任何既有失败必须保存命令、错误和所属模块，不能通过过滤或改断言掩盖。
    - 记录 `src/core/ugc` 与 `src/l2` 的存在状态、当前导出和并行实现风险；若其他会话正在写同一路径，先合并或停止冲突写入。
    - Small-grained acceptance: 基线记录能在相同工作区复现；任务后续引用的命令和路径全部真实存在。
    - **Requirements:** 16.1, 16.16. **Design:** Existing System Assessment; Quality gates.

  - [x] 1.2 冻结基类层四端口和运行时兼容端口的最小契约证据。
    - 核对或登记待冻结：`JSON_Codec`、`Definition_Validator`、`Reference_Resolver`、批量原子 `Definition_Registry`、Schema catalog、runtime compatibility 的真实导出、版本令牌、输入/输出和失败语义。
    - 明确真实 Definition Registry 必须支持工作副本、完整入边重验、compare-and-swap 发布和确定性快照；禁止通过循环调用 `DefRegistry.register` 伪造原子性。
    - `src/core/kernel/spec-compiler/` 和 `src/class/specification-compiler/` 展示了可能的实现形状（后者的 `AtomicDefinitionRegistry` 有真实 CAS），但两者均未被任何 `.kiro/specs` 任务认领为交付物，也未被仓库其余生产代码引用（后者更是零测试覆盖）；不得直接导入两者作为已冻结端口的替代实现，只能作为设计参考。
    - 为缺失端口记录 owner、证据位置、受影响阶段和 `E_LOAD_UNRESOLVED_CONTRACT` 失败关闭结果。
    - Small-grained acceptance: 每个端口有“frozen”证据或显式 unavailable 记录；不存在未经证据假定的字段形状。
    - **Requirements:** 1.2–1.3, 3.2–3.9, 7.1–7.4, 12.8–12.11, 13.3–13.13, 15.1–15.10. **Design:** Ownership table; Upstream definition ports; Unresolved boundaries.

  - [x] 1.3 核实共享错误码、提示目录并冻结诊断形状扩展。
    - 审计 `ERR_CODES` 与 `HINT_TEMPLATES`：确认层级归属（`E_LOAD_LAYER_OWNERSHIP`）、数值归属/分类（`E_LOAD_NUMERIC_OWNERSHIP`、`E_LOAD_GAMEPLAY_VALUE_RANGE`）、继承环（`E_LOAD_INHERITANCE_CYCLE`）、组合冲突（`E_LOAD_COMPOSITION_CONFLICT`、`E_LOAD_ORDER_UNDECLARED`）、语义损坏（`E_LOAD_SEMANTIC_FIELD_DAMAGED`）、表现回退（`E_LOAD_PRESENTATION_FALLBACK`）以及已有 JSON、装载、迁移、细粒度配额代码均已登记且有稳定 severity/hint；这一步是核实既有契约，不是新增登记。
    - 只有两项真正缺失，需要提交或等待上游批准：`migrationSteps` 配额的精确共享代码（`E_QUOTA_MIGRATION_STEPS` 或批准的等价成员，当前 `ERR_CODES.E_QUOTA` 未登记）；登记前迁移步数超限路径保持 unavailable。
    - 冻结共享 `Diagnostic` 的规范化定位形状：`at`、`path` 字段当前仅为可选（`undefined`-only），必须扩展为可空（参照已有 `sourcePackage`/`sourceSpan` 的 `T | null` 模式），使结构上不适用的定位能显式表达 `null`；通过扩展同一个共享类型及其消费者实现，不得创建 UGC 私有诊断类型或第二通道。
    - 对上述两项缺口以外的路径，禁止误判为待汇合而使用 `E_LOAD_UNRESOLVED_CONTRACT` 兜底；已登记代码必须直接使用。仅对确认缺失的两项在登记前标记 unavailable。
    - 为错误码目录定义版本令牌，纳入 Validation Baseline。
    - Small-grained acceptance: 每个已启用诊断条件都能解析到一个封闭 `ErrCode`、确定 severity 和 actionable hint；共享诊断可无歧义序列化适用位置或显式 null；只有 `migrationSteps` 配额路径在登记前保持 unavailable，其余映射不得被误标为待汇合。
    - **Requirements:** 1.3, 4.2–4.11, 5.2–5.9, 14.1–14.13. **Design:** Diagnostics mapping; Quality gate 6.

- [x] 2. 建立 UGC 公共模型、受限端口和架构守卫
  - [x] 2.1 在 `src/core/ugc/model/` 实现不可变候选、请求绑定、结果、基线和阶段模型。
    - 实现 `CandidateSource`、`CandidateDocument`、`CandidateChangeRequest`、`TargetOwnership`、`ChangeRequestBinding`、`CanonicalizedChangeRequest`、`ValidationStage`、`SkippedCheck`、`ValidationBaseline`、`ValidationReport`、`ActivationResult` 和稳定指纹句柄。
    - 定义 `changeRequestFingerprint` 的域分隔、长度前缀稳定编码：绑定 canonical candidate fingerprint、稳定的 package/document identity、target ownership、operation 和规范化为 null 的 optional expected target ID；明确排除 `source.kind`、`sourceName`、`receivedAtSequence`。
    - 候选仅保存 UTF-8 字节、来源元数据和目标层；不得包含 trusted/validated 标志、可写注册表、WorldState、Op、Hook 或持久化句柄。
    - 所有外部集合使用 readonly；提供深度不可变构造和运行时防御性复制。
    - 添加类型级/单元测试，证明来源不能构造 validated artifact，输入修改不会改变已创建候选，请求字段任一绑定项变化都会改变请求指纹而审计序列变化不会。
    - Small-grained acceptance: strict TypeScript 通过；候选公共类型不暴露任何直接激活或运行时写入能力；相同内容不能跨来源文档、操作、预期目标或目标层复用验证身份。
    - **Requirements:** 1.1–1.10, 3.1–3.9, 13.1, 13.12–13.13. **Design:** Candidate ingress; Validation baseline; Security invariants. **Properties:** P1, P3, P13.

  - [x] 2.2 在 `src/core/ugc/ports/` 定义最小上游端口和 opaque handles。
    - 定义 `DefinitionValidationGateway`、`ReferenceResolutionGateway`、`DefinitionRegistryGateway`、`SchemaVersionCatalog`、`SchemaMigrationGateway`、`RuntimeCompatibilityGateway` 和 `StableFingerprintGateway`。
    - 使用泛型或 opaque handles 传递上游候选、Schema、引用图和快照；不得在 UGC 复制 Def kind、领域字段或引用求值结构。
    - 为每个端口提供 unavailable adapter，统一返回带来源和修复提示的失败关闭诊断。
    - 添加 contract tests，证明 unavailable adapter 不调用任何后续端口、不创建 validated artifact、不改变观察到的快照。
    - Small-grained acceptance: 端口可由测试替身实现，但没有任何替身能通过公共 API 直接激活未验证候选。
    - **Requirements:** 1.2–1.3, 3.2–3.9, 7.1–7.4, 12.8–12.11, 15.1–15.10. **Design:** Upstream definition ports; Ownership table. **Properties:** P1, P3, P15.

  - [x] 2.3 在 `src/core/ugc/diagnostics/` 实现 code catalog、共享诊断形状适配、scope-aware factory、排序和等价比较。
    - 实现 `DiagnosticCodeCatalog`，只消费共享 `ERR_CODES`/severity/hint，版本变化可观察。
    - 先使用任务 1.3 冻结的共享 `Diagnostic` 可空定位契约；若需修改上游类型，同步更新共享工厂、序列化、排序、去重和消费者，禁止定义 UGC-only diagnostic wrapper 作为第二结果通道。
    - 工厂分别构造 document、definition、change-set、registry scope；按要求填充来源、路径、expected/actual、reason、correction suggestion、root cause，结构上不适用字段显式为 null。
    - 实现固定排序键和 Adapter 跨来源等价比较；等价比较忽略合法不同的来源身份值，但不忽略 code、severity、scope、路径、原因类别、expected/actual 或相对顺序。
    - 添加多错误输入排列测试、共享类型 round-trip、null 定位测试、错误拒绝必须含 error 测试和缺 code/hint 失败关闭测试。
    - Small-grained acceptance: 相同诊断集合的任意输入排列产生字节等价顺序；共享 `Diagnostic` 可直接承载显式 null；不完整拒绝结果不能通过 result guard。
    - **Requirements:** 2.8, 7.5–7.7, 9.7, 10.5, 12.12, 14.1–14.13. **Design:** Diagnostics; Error handling. **Properties:** P14.

  - [x] 2.4 建立静态架构测试和导出根。
    - 在 `src/core/ugc/index.ts` 只导出 Facade、候选/结果只读类型和允许的 Adapter 接口；不导出内部 artifact 工厂、预算可变对象或端口写实现。
    - 添加静态 import/API 测试，禁止 public UGC 模块导入 `WorldState`、`OpRegistry`、Hook dispatcher、事务 writer、persistence writer 或直接 `DefRegistry.register`。
    - 扫描 `eval`、`Function` constructor、process/child-process、动态模块执行和候选字符串代码执行路径。
    - Small-grained acceptance: 架构测试能对故意加入的违规 fixture 失败，并在正常代码上通过。
    - **Requirements:** 1.2–1.3, 2.4–2.7, 3.5, 13.9, 15.6–15.8. **Design:** Non-goals; Security invariants 1–4.

- [x] 3. 实现可信技术配额和有界 JSON 解码
  - [x] 3.1 在 `src/core/ugc/quota/` 实现 `TrustedQuotaProfile` 校验和单调 `QuotaBudget`。
    - 要求所有必需 quota 由宿主提供，且为有限非负整数；禁止候选覆盖、禁用或提高配额。
    - 实现无溢出的 consume、used/limit/snapshot；覆盖输入字节、深度、对象成员、数组元素、来源记录、AST 节点、定义、引用边、遍历工作、诊断、迁移步数和输出字节。
    - 诊断配额耗尽后只允许一个终止性配额诊断和 suppressed lower bound，不继续分配无界诊断；迁移步数耗尽只能使用任务 1.3 批准的精确共享代码，未登记时该能力失败关闭为 unresolved contract。
    - 添加整数边界、超大 amount、重复 consume、缺配置、缺迁移步数错误码和候选伪造配额测试。
    - Small-grained acceptance: 预算从不减少或溢出；同一消耗序列在同一 profile 下于相同 quota/usage 失败。
    - **Requirements:** 5.5–5.8, 9.1–9.4, 9.7, 9.10. **Design:** Trusted quota profile; P9.

  - [x] 3.2 在 `src/core/ugc/codec/strict-json-decoder.ts` 实现保留 span 的严格 JSON 解码器。
    - 使用显式栈或机械深度守卫单遍解析 UTF-8；仅接受标准 JSON，记录每个节点和 member key/value 的 source span。
    - 在普通对象物化前检测重复成员，并同时报告首个与冲突位置；拒绝 trailing content、非法转义、非法 surrogate、非法数字和非有限值。
    - 在读取/创建每个结构前消费 input/depth/member/element/AST quota；失败后不暴露部分 AST。
    - 添加表驱动测试覆盖每类语法错误、重复 key、Unicode、数字边界、空结构和 source span 精度。
    - Small-grained acceptance: 不使用原生 `JSON.parse` 作为首次对象物化路径；任意重复 key 都不能被后值静默覆盖。
    - **Requirements:** 2.1–2.3, 2.8–2.10, 4.1–4.4, 9.2–9.5. **Design:** Structural JSON decoder; Error handling. **Properties:** P2, P9.

  - [x] 3.3 实现禁止执行构造的语义门禁而非字符串黑名单。
    - 在 AST 仍保留字段和 span 时，按当前 closed Schema/已登记效果契约识别 function/script/eval/external command/variable assignment/command loop/未登记表达式语言请求。
    - 普通名称、描述或本地化文本中出现相同词语不得误报；任何字符串都不得被执行以判断合法性。
    - 将具体效果、Expr 和 Flow 合法性转交上游 Schema/Definition Validator；UGC 不实现求值器。
    - 添加恶意 payload、嵌套 payload、文本误报和未知效果形式测试。
    - Small-grained acceptance: 所有禁止构造在执行前拒绝；合法文本不因词法匹配被拒绝；测试可证明零执行回调发生。
    - **Requirements:** 2.2–2.7, 13.9. **Design:** Declarative JSON safety; Security invariant 1. **Properties:** P2.
    - **验收证据（2026-08-11）**：`npm run mutation` 29/29 全部 KILLED（含本任务 14 个变异体：prohibited-construct-gate + strict-json-decoder 各 14 个，全部被杀）；19 测试通过（`src/core/ugc/__tests__/` 下 codec、prohibited、migration、canonical、contracts、baseline 全绿）。

- [x] 4. 实现 Schema 版本、可信文档迁移和确定性规范化
  - [x] 4.1 在 `src/core/ugc/migration/schema-migration-graph.ts` 实现版本目录和唯一迁移路径解析。
    - 解析明确版本格式，区分直接支持、旧版、未来版和非法版本；不得静默重解释版本。
    - 验证迁移图不存在重复边、分支歧义和环；按 trusted migrationSteps/traversalWork quota 搜索唯一完整路径。
    - 添加直接支持、无路径、未来版、分支、重复边、环和步数超限测试。
    - Small-grained acceptance: 只有一个完整无环路径时可继续；同一图和版本对始终解析同一路径。
    - **Requirements:** 12.1–12.5, 12.12–12.13. **Design:** Schema migration; P12.

  - [x] 4.2 在 `src/core/ugc/migration/schema-migration-coordinator.ts` 实现隔离、可信、确定性 AST 迁移。
    - 只执行宿主注册的 `TrustedSchemaMigration`；候选不能声明迁移函数或新边。
    - 每一步对不可变 AST 产生新值并消费预算；任一步失败丢弃全部迁移结果，保留原始候选。
    - 迁移完成后重新执行当前 Schema 结构检查、有界 AST 计数、完整 Definition Validator 和引用解析。
    - 将玩法包/存档兼容和 active-match replacement 仅转交 `RuntimeCompatibilityGateway`，不读取/写入持久化状态。
    - 添加中途抛错、返回非法 AST、输入突变、非确定迁移检测和 runtime compatibility spy 测试。
    - Small-grained acceptance: UGC 候选无法产生可执行 `MigrationDef.transform`；迁移失败时原 AST 和活动快照保持等价。
    - **Requirements:** 12.3–12.13, 13.9. **Design:** Schema migration versus runtime migration. **Properties:** P12.

  - [x] 4.3 在 `src/core/ugc/canonical/canonicalizer.ts` 实现 Schema-aware canonical JSON。
    - 对 object key 使用 locale-independent Unicode code point 总序；保留有序 array；仅对 Schema 明确标记无序且有稳定语义身份的集合排序。
    - 拒绝无序集合中的重复/缺失身份和无法唯一规范化的组合；不注入时间、随机 ID、宿主路径或来源信息。
    - 在输出期间消费 outputBytes/traversalWork quota，使用稳定指纹 gateway 生成候选指纹。
    - 添加 parse-canonicalize-parse、重复规范化、key/whitespace/unordered permutations、semantic array order 和 locale 变化测试。
    - Small-grained acceptance: 首次规范化后字节幂等；语义数组顺序差异不会被抹平。
    - **Requirements:** 3.10, 8.4–8.7, 11.1–11.12, 12.13. **Design:** Canonicalization Gateway; P8, P11.

- [x] 5. 实现跨领域契约目录与完整验证基线
  - [x] 5.1 在 `src/core/ugc/contracts/integration-contract-catalog.ts` 实现版本化契约目录。
    - 只登记 core mechanics、space-items、AI 提供方的 provider/version/exported kind/semantic family/reference-constraint fingerprint/source records。
    - 检测缺失领域、重复 provider identity、冲突 export、缺失 capability 和不兼容版本；不保存或执行领域内部语义。
    - 合同集合按 domain/provider/export 稳定排序并产生 catalog fingerprint；更新目录不自动处理历史候选。
    - 添加缺失、歧义、错 provider、错 export、版本变化和相同输入排列测试。
    - Small-grained acceptance: 未汇合能力始终 `E_LOAD_UNRESOLVED_CONTRACT`；任何查询结果唯一且可追踪来源。
    - **Requirements:** 7.2–7.7, 15.1–15.10. **Design:** Integration Contract Catalog; P7, P15.

  - [x] 5.2 在 `src/core/ugc/baseline/validation-baseline.ts` 实现不可变基线捕获和比较。
    - 捕获 Definition Registry、Schema catalog、Integration Contract catalog、Diagnostic catalog、quota profile 的版本和总指纹。
    - 定义字段级 mismatch 诊断，包含 expected/actual；任一组成变化都使基线过期。
    - 添加每一项单独变化、组合变化、相同版本不同内容指纹和重复比较测试。
    - Small-grained acceptance: 任何真实依赖变化不能被相同对象引用或时间顺序掩盖；同一依赖快照产生相同 baseline fingerprint。
    - **Requirements:** 3.7–3.8, 11.10–11.11, 13.1, 13.5–13.6, 15.5, 15.10. **Design:** ValidationBaseline; P13, P15.

- [x] 6. 实现所有来源共用的验证流水线和基类层接入
  - [x] 6.1 在 `src/core/ugc/adapter/` 实现手写、编辑器和自然语言适配器的同形候选输出。
    - Adapter 只封装来源、目标层和 UTF-8 JSON；不得自行解析语义、标记成功、改变 severity、调用 registry 或访问 WorldState。
    - 编辑后必须生成新候选指纹，旧 ValidationReport/ValidatedChangeSet 不可复用。
    - 添加跨 Adapter 等价输入测试、来源元数据差异测试和伪造 trusted/validated 字段测试。
    - Small-grained acceptance: 三类来源从 strict decoder 起共用完全相同的生产调用链和 quota profile。
    - **Requirements:** 3.1–3.10. **Design:** Candidate ingress; Source-route equivalence. **Properties:** P3.

  - [x] 6.2 在 `src/core/ugc/validation/coordinator.ts` 实现阶段 DAG、错误聚合和 skipped-check 关联。
    - 按 ingress → decode → migration → canonicalize → request binding → baseline → definition validation → reference resolution → presentation → activation precheck 编排。
    - 在 canonicalize 后按任务 2.1 生成 `ChangeRequestBinding` / `changeRequestFingerprint`，并把二者与 content-only candidate fingerprint 一同写入 `ValidationReport`；后续阶段只消费该封存请求。
    - 独立可发现错误继续聚合；依赖失败阶段不猜测输入，记录 check ID、stage 和 blocking diagnostic root ID。
    - 所有阶段共享同一 QuotaBudget、Diagnostic Factory、Code Catalog 和稳定排序；任何 error 阻止 validated artifact。
    - 添加多错误、根错误阻断、诊断 quota、阶段异常、同输入重复运行和不同 Adapter 运行测试。
    - Small-grained acceptance: 报告可解释每个执行/跳过检查；不存在异常逃逸、半成功状态或来源专用分支。
    - **Requirements:** 3.2–3.10, 4.12, 9.4–9.10, 13.1–13.4, 14.5–14.12. **Design:** Validation pipeline; Diagnostics. **Properties:** P3, P9, P14.

  - [x] 6.3 接入唯一 `DefinitionValidationGateway` 并验证层级、Schema、数值、继承和组合结果。
    - 将 canonical candidate、target ownership、Integration Contract snapshot、active read snapshot、source records 和 budget 传给同一上游 validator。
    - 要求上游覆盖 closed/open Schema、required/type/cross-field、legal Def kind、唯一 ID/override、抽象实例、基类层/玩法层、全部数值分类、继承环、组合冲突和语义字段严格性。
    - UGC 只验证上游结果完整性和诊断映射，不复制每条领域规则；缺少任何 mandatory capability 时失败关闭。
    - 添加 gateway contract tests，使用合规替身和故意缺能力替身验证门禁；真实适配留到任务 11。
    - Small-grained acceptance: 未通过统一 validator 的候选不能进入 reference stage；所有具体玩法值仅在玩法层被接受且为 1–5。
    - **Requirements:** 1.3–1.9, 4.1–4.12, 5.1–5.10, 6.1–6.10, 8.1–8.10, 10.1–10.3. **Design:** DefinitionValidationGateway; Numeric and layer rules. **Properties:** P1, P4, P5, P6, P8, P10.

  - [x] 6.4 接入唯一 `ReferenceResolutionGateway` 和变更后的完整入边重验。
    - 传入 candidate + active snapshot + contract snapshot；要求解析 expected kind/semantic family/provider domain，并返回稳定 inbound/outbound graph。
    - 覆盖 missing、ambiguous、wrong kind/family/provider、reference cycle、package cycle、override/remove 后 transitive inbound closure；继承环留给 validator，迁移环留给 migration coordinator。
    - 验证 equivalent graph permutations 的边和诊断顺序；不允许 partial graph 作为 validated output。
    - 添加直接、跨域、多跳、循环、覆盖、删除重定向、非法删除和 graph quota 测试。
    - Small-grained acceptance: 任一受影响 dependent 无效都拒绝完整 change set；每个 valid dependent 恰好重验一次。
    - **Requirements:** 4.9–4.11, 7.1–7.12, 8.1, 9.2, 13.10–13.11, 15.1–15.10. **Design:** ReferenceResolutionGateway; P7, P8, P13, P15.

  - [x] 6.5 实现玩法包/存档兼容声明的纯转交边界。
    - 将候选中的兼容声明交给 `RuntimeCompatibilityGateway`；保留 newer-save 和 active-match replacement 的上游拒绝。
    - 断言 UGC 不创建 Snapshot、Journal、Checkpoint、MigrationDef，不读取或替换 WorldState。
    - 添加 spy contract tests，确认每个声明最多调用一次上游 gateway，拒绝结果不被降级或改写。
    - Small-grained acceptance: runtime compatibility gateway 缺失时声明失败关闭；无声明候选不触发任何 persistence/lifecycle 调用。
    - **Requirements:** 1.2, 12.8–12.11, 13.9. **Design:** Compatibility forwarding. **Properties:** P1, P12.

- [x] 7. 实现非语义表现资源回退和语义指纹守卫
  - [x] 7.1 在 `src/core/ugc/presentation/fallback-resolver.ts` 实现 eligibility 和隔离解析。
    - 仅接受 current Schema 明确标记 optional + presentation-only + type-compatible fallback contract 的资源字段。
    - 名称/辅助文本只有在 Schema 明确证明不参与标识、查询、可见性、AI 决策或规则时才可进入该分类。
    - 原始 CandidateDocument/CanonicalCandidate 保持不可变；解析产生独立 `PresentationFallbackDecision`。
    - 添加 required/optional、semantic/presentation、compatible/incompatible、无 fallback 和伪装语义 metadata 测试。
    - Small-grained acceptance: 任何语义字段损坏都在此阶段之前或之中成为 error；不存在复制旧语义值路径。
    - **Requirements:** 10.1–10.4, 10.7–10.10. **Design:** PresentationFallbackResolver; P10.

  - [x] 7.2 实现前后语义指纹比较和表现警告。
    - 使用上游 Schema 视图计算不含表现资源的语义指纹；回退前后必须相同，否则拒绝。
    - 产生包含 definition ID、JSON path、损坏/缺失资源、fallback identity、source span 的共享 Warning Diagnostic。
    - 验证 warning-only activation eligibility 不授权任何其他 coercion；错误与 warning 同时出现时完整拒绝。
    - 添加语义污染故障注入、相同语义不同资源和多个回退稳定排序测试。
    - Small-grained acceptance: 每个成功 fallback 有一条可定位 warning；所有成功 fallback 的语义指纹严格相同。
    - **Requirements:** 10.4–10.10, 13.4, 14.10–14.11. **Design:** Fallback flow; Diagnostics. **Properties:** P10, P14.

- [x] 8. 实现不可伪造验证产物和基线绑定的原子激活
  - [x] 8.1 在 `src/core/ugc/activation/validated-change-set.ts` 实现内部 branded artifact factory。
    - 工厂仅接受无 error 的完整 validation/reference/presentation 结果，绑定 canonical candidate fingerprint、`changeRequestFingerprint`、完整 `ChangeRequestBinding`、baseline fingerprint、target ownership、resolved graph 和 warnings。
    - 工厂从内部规范化请求重算摘要，逐字段核对 canonical content、package/document identity、target ownership、operation、expected target ID；不得信任调用方提供的 fingerprint 或可变 envelope。
    - 工厂不从公共导出暴露；运行时 guard 检查内部不可伪造 token、请求绑定、候选指纹和完整阶段证明。
    - 添加类型级和运行时伪造测试、修改候选后复用测试、同内容不同来源文档/操作/expected target/target ownership 复用测试、不同目标 registry 复用测试。
    - Small-grained acceptance: 外部 JSON、Adapter 或类型断言无法经公共 Facade 激活伪造 artifact；一个请求的验证结果不能授权另一个请求。
    - **Requirements:** 3.4–3.9, 13.1–13.4, 13.12–13.13. **Design:** Validated artifact; Security invariant 3. **Properties:** P3, P13.

  - [x] 8.2 在 `src/core/ugc/activation/atomic-activation-coordinator.ts` 实现提交前请求绑定与完整基线复检。
    - 从 sealed `ChangeRequestBinding` 重新派生 `changeRequestFingerprint`，与 artifact/report 对比；canonical content、package/document identity、target ownership、operation 或 expected target ID 任一不一致均在 registry 调用前拒绝。
    - 重新读取目标 registry、Schema、Integration Contract、Diagnostic Code Catalog、quota profile 版本和指纹；逐字段比较 expected/actual。
    - 任一变化返回 registry-scope `E_LOAD_BASELINE_STALE`，要求从原始候选完整重验；不能局部更新 artifact。
    - 添加每个请求绑定字段和每个基线部分单独变化、候选指纹变化、同内容跨请求复用、并发双提交和 ABA 内容指纹变化测试。
    - Small-grained acceptance: 任何 request mismatch 或 stale artifact 调用 registry activate 次数为零，active snapshot 指纹不变。
    - **Requirements:** 3.7–3.8, 13.5–13.6, 15.5, 15.10. **Design:** Atomic activation flow; P13, P15.

  - [x] 8.3 接入 `DefinitionRegistryGateway.activateAtomically` 并验证全成或全败。
    - 当前基线时只调用一次 gateway；传递完整 change set、resolved graph 和 presentation decisions。
    - 验证成功同时发布 registry/graph/canonical snapshot；失败返回 previous/active fingerprint 相同和 unchanged=true。
    - 覆盖 add/replace/remove、multi-hop dependent、warning-only success、commit-time recheck failure、gateway throw/invalid result 和双层混合拒绝。
    - 明确禁止写 WorldState、执行 entry effect、注册 Hook、推进迁移或写持久化。
    - Small-grained acceptance: 任一失败候选零部分变化可见；成功候选所有变化一次可见；invalid gateway result 被转为 activation error 并保留旧状态。
    - **Requirements:** 1.4–1.8, 6.7–6.9, 7.10–7.11, 13.3–13.13. **Design:** DefinitionRegistryGateway; Atomic coordinator. **Properties:** P1, P6, P7, P13.

- [x] 9. 实现唯一公共 Facade 和受限 Test Interface
  - [x] 9.1 在 `src/core/ugc/facade/ugc-ingress-facade.ts` 实现 validate/activate 公共入口。
    - `validate` 只接受 `CandidateChangeRequest` 并调用 coordinator；`activate` 只接受由 validate 成功内部持有的 artifact handle。
    - 不提供 force、skip、trusted-source、activate-with-errors 或直接 registry 方法；编辑后必须重新 validate。
    - 所有异常转换为 scope-correct structured diagnostics，不抛出未处理异常或返回半状态。
    - 添加手写/编辑器/自然语言/导入端到端本地测试和所有旁路尝试测试。
    - Small-grained acceptance: 公共 API 的每条成功激活路径都经过全部 mandatory stages；每条失败路径有 unchanged assertion。
    - **Requirements:** 1.1–1.10, 3.1–3.10, 13.1–13.13. **Design:** UGCIngressFacade; Main flows. **Properties:** P1, P3, P13.

  - [x] 9.2 在 `src/core/ugc/testing/` 实现 generators、observer 和 fault injection。
    - 为每个已登记 Schema/Integration Contract family 提供 valid/invalid candidate 生成；模式覆盖 unknown fields、illegal kind、duplicate member/ID、numeric boundaries、cycles、conflicts、references、quotas、versions、semantic/presentation damage 和 stale baseline。
    - Observer 独立观察 decode、migration、canonicalization、validation、resolution、fallback、activation 和 snapshots，但只能调用生产入口。
    - Fault injection 仅替换设计端口返回/异常，不允许 mint artifact、跳过 quota 或直接改 registry。
    - 添加 generator coverage test：新增 family 未注册 valid/invalid generators 时失败。
    - Small-grained acceptance: 所有最小化反例保留 source span、JSON path、source record 和 reproducible seed。
    - **Requirements:** 16.1–16.16. **Design:** Test and trace reachability; Testing strategy. **Properties:** P16.

- [x] 10. 将 16 项正确性性质编码为独立 mandatory property tests
  - [x] 10.1 在 `src/core/ugc/__tests__/properties/boundary-closure.property.test.ts` 实现 Property 1。
    - 生成 L1 机制重定义、越层配置、混合激活和直接写入请求；断言 ownership rejection、零 activation call 和 unchanged snapshot。
    - **Requirements:** 1, 6. **Property:** P1.

  - [x] 10.2 在 `src/core/ugc/__tests__/properties/declarative-json-safety.property.test.ts` 实现 Property 2。
    - 生成任意 bytes、重复 key、深/宽结构、非法数字/Unicode 和禁止语义 payload；断言有界终止、span 诊断和零执行。
    - **Requirements:** 2. **Property:** P2.

  - [x] 10.3 在 `src/core/ugc/__tests__/properties/source-route-equivalence.property.test.ts` 实现 Property 3。
    - 生成等价多来源候选，断言规范化和语义诊断等价；来源 kind 变化不改变 severity、quota 或验证阶段。
    - **Requirements:** 3. **Property:** P3.

  - [x] 10.4 在 `src/core/ugc/__tests__/properties/schema-identity.property.test.ts` 实现 Property 4。
    - 生成 closed/open Schema、unknown field、kind、duplicate ID、override target；断言 acceptance iff 全部结构/身份条件满足。
    - **Requirements:** 4. **Property:** P4.

  - [x] 10.5 在 `src/core/ugc/__tests__/properties/numeric-ownership.property.test.ts` 实现 Property 5。
    - 生成分类、层级、1/5 边界、0/6、版本/大小/配额和冲突分类；断言只对 Gameplay Value 使用 1–5。
    - **Requirements:** 5. **Property:** P5.

  - [x] 10.6 在 `src/core/ugc/__tests__/properties/layer-separation.property.test.ts` 实现 Property 6。
    - 生成基类层定义、玩法层配置和 mixed change set，断言层级隔离与独立原子集。
    - **Requirements:** 6. **Property:** P6.

  - [x] 10.7 在 `src/core/ugc/__tests__/properties/reference-completeness.property.test.ts` 实现 Property 7。
    - 生成 missing/ambiguous/wrong-type/provider/cycle/override/remove 多跳图，断言完整入边重验和稳定图/诊断。
    - **Requirements:** 7. **Property:** P7.

  - [x] 10.8 在 `src/core/ugc/__tests__/properties/composition-determinism.property.test.ts` 实现 Property 8。
    - 生成 inheritance cycle、field conflict、independent components 和 explicit order，断言拒绝或等价解析。
    - **Requirements:** 8. **Property:** P8.

  - [x] 10.9 在 `src/core/ugc/__tests__/properties/bounded-adversarial-processing.property.test.ts` 实现 Property 9。
    - 生成输入炸弹、图 fan-out、重复引用和诊断洪泛，断言 matching quota、bounded work/memory proxy、零激活。
    - **Requirements:** 9. **Property:** P9.

  - [x] 10.10 在 `src/core/ugc/__tests__/properties/semantic-presentation.property.test.ts` 实现 Property 10。
    - 生成语义/表现字段损坏和 fallback 类型，断言语义严格拒绝、表现 warning 和相同语义指纹。
    - **Requirements:** 10. **Property:** P10.

  - [x] 10.11 在 `src/core/ugc/__tests__/properties/canonical-roundtrip.property.test.ts` 实现 Property 11。
    - 生成等价 key/whitespace/unordered permutations 和不同 semantic array order，断言 round-trip、幂等和必要差异保留。
    - **Requirements:** 11. **Property:** P11.

  - [x] 10.12 在 `src/core/ugc/__tests__/properties/version-migration.property.test.ts` 实现 Property 12。
    - 生成 migration DAG/path/gap/branch/cycle/failure/newer version，断言唯一确定路径或原状态拒绝。
    - **Requirements:** 12. **Property:** P12.

  - [x] 10.13 在 `src/core/ugc/__tests__/properties/atomic-activation.property.test.ts` 实现 Property 13。
    - 生成 active snapshot、valid artifact、请求绑定字段变化、同内容跨来源文档/操作/预期目标/目标层复用、baseline races 和 gateway failures，断言请求不匹配或 stale 拒绝、全成或全败、snapshot equivalence。
    - **Requirements:** 13. **Property:** P13.

  - [x] 10.14 在 `src/core/ugc/__tests__/properties/diagnostic-determinism.property.test.ts` 实现 Property 14。
    - 生成多个独立错误和 permutations，断言 scope fields、stable code/order、root links、error-bearing rejection 和 warning limits。
    - **Requirements:** 14. **Property:** P14.

  - [x] 10.15 在 `src/core/ugc/__tests__/properties/integration-contracts.property.test.ts` 实现 Property 15。
    - 生成 domain contracts 的缺失/冲突/export/version 更新，断言失败关闭、baseline invalidation 和零自动激活。
    - **Requirements:** 15. **Property:** P15.

  - [x] 10.16 在 `src/core/ugc/__tests__/properties/test-trace-reachability.property.test.ts` 实现 Property 16。
    - 枚举所有 Schema/family/stage/requirements/properties/tasks，断言 generator、observer 和追踪矩阵均有覆盖且无 bypass operation。
    - **Requirements:** 16. **Property:** P16.

- [ ] 11. 完成真实上游集成、恶意输入与故障注入验收
  - [x] 11.1 在 `src/core/ugc/integration/` 实现基类层真实端口适配器。**（2026-08-10 完成）** `l2-adapter.ts` 仅消费冻结的 `src/l2/ugc/ports/index.ts`，执行 `createL2PortBundle()` → `assertL2PortBundle()` → 按目标层装配 `ValidationCoordinator` / `AtomicActivationCoordinator` / `UGCIngressFacade`；不做语义转换。
    - 仅在任务 1.2 的接口冻结后导入真实 JSON Codec、Definition Validator、Reference Resolver 和 atomic Definition Registry。
    - 对齐共享候选类型、Schema view、diagnostics、dependency graph、version tokens 和 canonical snapshot；移除仅用于本地测试的临时 shape conversion。
    - 添加邻接 contract tests，确认手写与 Adapter 候选调用同一 validator，引用结果来自同一 resolver，activation 来自同一 registry。
    - Small-grained acceptance: 集成测试可证明没有直接 `DefRegistry.register`、局部 Linter acceptance 或第二套 resolver。
    - **Requirements:** 3, 4, 7, 8, 13, 15. **Design:** Upstream ports; Existing assessment.

  - [x] 11.2 完成 shared diagnostics/hints 与真实安全基础设施集成。
    - 对已批准错误码补齐共享 hint；验证 `checkHintCompleteness` 对所有启用代码为空。
    - 确认 DiagnosticSink 去重不会折叠不同 definition/path/source 的 UGC 错误；如需修正，使用完整稳定诊断 identity，不按 message 单独去重。
    - 验证 fatal `E_INV_*` 不可被候选或玩法包覆盖；UGC warnings 不改变 fatal/error 语义。
    - Small-grained acceptance: 多位置相同错误均保留；所有启用诊断可定位、可行动且属于封闭代码集。
    - **Requirements:** 14.1–14.13. **Design:** Diagnostics; P14.

  - [~] 11.3 已添加 `src/core/ugc/__tests__/integration/full-pipeline.integration.test.ts`，真实基类层端口场景 12/13 通过（场景 11 valid play candidate 因玩法包契约未冻结保持失败关闭）。**剩余阻塞：l2 尚未冻结规范玩法包验证契约**，当前 `DefinitionValidationGateway` 仍复用基类定义包校验，不能把基类包写入 play registry 冒充 valid play candidate。待 l2 交付冻结契约后补齐场景 11。详见 `docs/L_归档/L_审查报告/UGC薄适配器最终验收报告.md`。
    - 覆盖 valid base candidate、valid play candidate、unknown field、duplicate ID、typed cross-domain reference、override/remove、old Schema migration、presentation fallback、warning-only activation 和 canonical snapshot。
    - 每个 rejected case 断言 registry/graph/snapshot 指纹不变；每个 success 断言完整变化一次可见。
    - Small-grained acceptance: requirements 1–16 每组至少一个真实端口场景，且报告包含 candidate/baseline/snapshot identity。
    - **Requirements:** 1–16. **Design:** Main flows; Traceability.

  - [x] 11.4 添加 `src/core/ugc/__tests__/integration/adversarial-input.integration.test.ts`。
    - 使用实际 decoder/pipeline 运行深层、宽对象、重复成员、超大字符串、reference fan-out、migration bomb、diagnostic flood 和 canonical output bomb。
    - 测量可观察 work counters/allocated node counts，断言不超过 quota 推导上界；不能依赖测试超时作为唯一安全断言。
    - Small-grained acceptance: 每类攻击在匹配 quota 失败、无未捕获异常/stack overflow、无部分状态。
    - **Requirements:** 2, 9, 14. **Design:** Bounded work; P2, P9, P14.

  - [x] 11.5 添加 `src/core/ugc/__tests__/integration/failure-injection.integration.test.ts`。
    - 在 decode、migration、canonicalize、baseline、validator、resolver、fallback、commit precheck 和 registry commit 每个阶段注入失败/异常/invalid result。
    - 断言 scope-correct diagnostics、skipped checks、单次 root linkage、零后续非法调用和旧快照保持。
    - Small-grained acceptance: Error Handling 表每一行至少一个自动化场景；任何异常都不会逃逸公共 Facade。
    - **Requirements:** 2–15. **Design:** Error Handling; P2–P15.

  - [x] 11.6 添加运行时边界和兼容转交集成测试。
    - 验证 UGC public API 无 WorldState、OpRegistry、Hook、transaction、journal、checkpoint 或 persistence writer；runtime compatibility 声明只触发已有 gateway。
    - 验证 newer-save 和 active-match replacement 拒绝原样保留，候选不能声明 executable migration transform。
    - Small-grained acceptance: 静态扫描和 spy 均证明 UGC 零运行时写入；缺 gateway 时失败关闭。
    - **Requirements:** 1.2–1.3, 2.4–2.7, 12.8–12.11, 13.9. **Design:** Compatibility forwarding; Security invariants.

- [x] 12. 完成全量质量门禁、追踪审计和交付验收
  - [x] 12.1 运行 targeted 与全量验证并修复所有新增失败。
    - 依次运行 UGC targeted Vitest（非 watch）、`npm run typecheck`、`npm test`、`npm run lint`。
    - 不使用 skip/only、过滤失败、更新不合理快照、降低 severity、减少生成范围或放宽断言通过门禁。
    - 记录测试数量、16 个 property identifiers、集成/故障注入结果和任何实施前既有失败的最终状态。
    - Small-grained acceptance: 所有适用命令退出成功；日志无未处理 rejection、warning-as-error 或开放 handle。
    - **Requirements:** 16.1–16.16. **Design:** Quality gates.

  - [x] 12.2 执行安全和架构反向审查。
    - 扫描动态执行、process、直接 registry/WorldState 写、UGC-owned Ref/Op/Expr/Hook/transaction/persistence、来源旁路、semantic fallback、candidate quota override、non-deterministic time/random/locale/hash iteration。
    - 检查恶意深度、diagnostic bomb、stale baseline、TOCTOU、artifact forgery、partial activation 和 Adapter source privilege。
    - 任何发现必须修复并重新运行相关性质、集成和全量门禁。
    - Small-grained acceptance: 反向审查清单逐项有代码/测试证据；不存在未记录的高风险或阻断项。
    - **Requirements:** 1–15. **Design:** Security invariants; all properties.

  - [x] 12.3 核对 requirements/design/tasks 三向追踪和待汇合边界。
    - 为 R1–R16 逐项确认至少一个设计组件、一个 Property、一个实现任务和一个自动验证；核对每个 task 引用真实 Requirement。
    - 确认缺失错误码、领域契约、配额 profile、Schema migration registry 或 atomic registry 的路径仍明确 unavailable，未被替身/默认值宣称完成。
    - 确认未引入具体玩法数值、胜负规则、地图配置、具名玩法实例或领域最终字段。
    - Small-grained acceptance: trace audit 零缺口；所有未决边界有 owner、阻断能力、失败代码和下一步证据。
    - **Requirements:** 15, 16. **Design:** Requirements Traceability; Unresolved Integration Boundaries.

## Verification matrix

| Verification theme | Tasks | Key assertions |
|---|---|---|
| Pure JSON and injection surface | 3.2–3.3, 10.2, 11.4, 12.2 | No execution; duplicate keys retained/rejected; bounded decode |
| Single route and no bypass | 2.1–2.4, 6.1–6.2, 9.1, 10.3 | Every source uses one pipeline; no trusted/force path |
| Layer and numeric ownership | 6.3, 10.4–10.6, 11.3 | Base/play isolation; only Gameplay Value uses 1–5 |
| Typed references and composition | 5.1, 6.3–6.4, 10.7–10.8 | Complete typed graph; cycles/conflicts deterministic |
| Resource bombs | 3.1–3.2, 6.2, 10.9, 11.4 | Every traversal bounded; diagnostic/output quotas enforced |
| Semantic strictness | 7.1–7.2, 10.10 | No semantic fallback; presentation warning preserves semantic fingerprint |
| Versions and migration | 4.1–4.3, 6.5, 10.11–10.12 | Unique deterministic Schema path; runtime migration only forwarded |
| Atomic activation | 5.2, 8.1–8.3, 10.13, 11.3–11.5 | Branded artifact; baseline CAS; all-or-nothing snapshot |
| Diagnostics | 1.3, 2.3, 6.2, 10.14, 11.2 | Closed codes; scope fields; deterministic aggregation/root links |
| Cross-domain contracts | 5.1–5.2, 6.4, 10.15 | Missing/conflicting/version-changed contract fails closed |
| Test/trace reachability | 9.2, 10.1–10.16, 12.1–12.3 | Every requirement/property/family/stage covered |

## Requirements-to-task trace

| Requirement | Primary implementation tasks | Primary verification tasks |
|---|---|---|
| R1 | 1.2, 2.1–2.4, 6.3, 8.3, 9.1 | 10.1, 11.6, 12.2 |
| R2 | 3.2–3.3 | 10.2, 11.4, 11.6 |
| R3 | 2.1–2.2, 6.1–6.2, 9.1 | 10.3, 11.3 |
| R4 | 6.3 | 10.4, 11.3 |
| R5 | 3.1, 6.3 | 10.5, 11.3 |
| R6 | 6.3, 8.3 | 10.6, 11.3 |
| R7 | 5.1, 6.4 | 10.7, 11.3 |
| R8 | 4.3, 6.3–6.4 | 10.8, 11.3 |
| R9 | 3.1–3.2, 6.2 | 10.9, 11.4 |
| R10 | 7.1–7.2 | 10.10, 11.3 |
| R11 | 4.3 | 10.11, 11.3 |
| R12 | 4.1–4.2, 6.5 | 10.12, 11.3, 11.6 |
| R13 | 5.2, 8.1–8.3 | 10.13, 11.3, 11.5 |
| R14 | 1.3, 2.3, 6.2 | 10.14, 11.2, 11.5 |
| R15 | 5.1–5.2, 6.4 | 10.15, 11.3 |
| R16 | 9.2 | 10.16, 12.1–12.3 |

## Notes

- **并行波次的唯一来源**是 [Task Dependency Graph](#task-dependency-graph) 里的 `waves` JSON。此处不再重复一份，避免两处漂移。
- **进度勾选的口径**：任务只有在实现完成、`npm run typecheck` 与 `npm test` 全绿、且该任务自己声明的 small-grained acceptance 逐条被测试覆盖之后才能勾上。仅"代码写完"不算完成。
- **断言必须可证伪**：本 spec 下多数错误路径共享同一个错误码（例如各类语法问题都落在 `E_LOAD_JSON_SYNTAX`），只断言 code 的测试会在实现被破坏后依然通过。任务 3.2 的验收因此额外要求断言 `messageKey` 与具体原因，并以变异自检（`npm run mutation`）证明每条守卫都被独立钉住。
- **任务 3.2 已完成**：解码器与 130 条测试全绿，15/15 个变异体被杀死。可用 `npm run mutation:isolate -- "<变异体名>" "<测试名片段>"` 验证单条测试是否独立杀死某个变异体；该脚本在筛选串命中零个用例时会显式报错，而不是把"跳过全部用例"误判为通过。
