# 执行报告：wakeup-base-layer-bombardment（基类层收官轰炸）

> 本报告如实记录本轮收官轰炸的反例分类与处置。遵循「不省 token / 不做 MVP / 实事求是」原则：标出所有未完成项、自主设计判断、以及对 design 的理解性补充。

## 结论摘要

- 基类层 6 个轰炸属性测试文件（属性 1-13 全部覆盖）已落地并全绿，与既有 8 个 `src/class/__tests__` 测试文件协同。
- 收尾门禁：`npx tsc --noEmit` 0 error / 基类层相关 scope 全绿 / `npm run lint` 0 error（126 warning 既有）/ `npm run verify:data`（90 份全过）/ `npm run verify:docs`（全过）。
- 未越权改 `src/core/kernel/**` 玩法语义、`src/play/**`、其他 spec 交付物。改动限于：新测试 `src/class/__tests__/base-layer-bombardment-*.test.ts`（6 文件）+ harness 1 文件、注释级接线说明 `src/l2/validation/composition-alignment-rules.ts`、以及本 spec 目录。

## 交付物（新测试文件）

| 文件 | 覆盖属性 | 要点 |
|---|---|---|
| `base-layer-bombardment-harness.ts` | 公共 | 目录读取 + `createFullHarness().registry.listOpNames()` 真实接入 + `kernelOps` 规范化 `OpNameUse`/`OpReferenceReport` |
| `base-layer-bombardment-loading.test.ts` | 属性 1 | JSON 畸形载荷（500 次）、重复键、类型错位——结构性失败 |
| `base-layer-bombardment-opconsistency.test.ts` | 属性 9/2 | kernelOps 机械一致性、全量目录可解析 |
| `base-layer-bombardment-model.test.ts` | 属性 6/7/8 | L2 规范模型一致性、compositionKind 权威源、composition-registry 解析 |
| `base-layer-bombardment-references.test.ts` | 属性 3/4/5 | 悬空引用/伪子类型确定性拒绝、循环引用有限终止 |
| `base-layer-bombardment-activation.test.ts` | 属性 10/11 | 装载桥生产激活 + 失败原子回滚（500 次） |
| `base-layer-bombardment-adapter.test.ts` | 属性 12 | 适配器运行时配置兼容 + Q-04 边界 |
| `base-layer-bombardment-throughline.test.ts` | 属性 13 | 跨层贯通回归锁 |

## 反例分类与处置

### 真实发现（核心引用错误检测）：npcs/weapons 声明引用了真实 `OpRegistry` 中不存在的 15 个 Op 名

- **事实**：`src/class/npcs/index.json`（10 个能力）与 `src/class/weapons/index.json`（6 个能力）的 `kernelOps` 共 300 项引用里，有 30 项指向真实 `OpRegistry.listOpNames()`（59 个）不存在的 **15 个唯一 Op 名**：
  `entity.move`、`entity.grantAction`、`entity.revokeAction`、`hook.subscribe`、`prop.get`、`query.entitiesInNode`、`query.path`、`query.route`、`query.stimuli`、`query.threatLevel`、`query.visibilityScope`、`relation.get`、`slot.swap`、`state.add`、`state.del`。
- **归属裁定（结构问题，非接口问题）**：这 15 个名对应引擎 **AI/行为/查询/状态接口**（`entity.grantAction` 是 AI 授权动作、`query.*` 是查询、`state.*` 是状态声明、`hook.subscribe` 是事件订阅），它们**不以 `OpRegistry` Op 形式注册**，而是经引擎 `src/core/kernel/ai/**` 的 policy/belief/visibility facade 与 `src/l2/model/family-contracts.ts` 的 `AiBehaviorContract.redefinedL1Interfaces` 表达。`npcs`/`weapons` 是**族特有（非统一形状）目录**：`weapons` 直接 `parseClassCatalog` 抛 `semanticFamily damage not declared`，走族专用解析翼；`npcs` 虽被 `parseClassCatalog` 接受（`category:"npcs"`），但不属于装载桥激活的 8 个统一形状目录，其 `kernelOps` 此前**无任何 `OpRegistry.listOpNames()` 机械比对守卫**。
- **整体方案（不做补洞）**：按宪法「契约要机器可校验」+「机器可校验优先」，把这项**如实暴露为待裁决已知边界**而非强行改写 npcs/weapons（那会发明未决的族专用解析翼）。属性 9/13 把「8 个统一形状目录的 kernelOps 全数注册」设为硬断言（无条件通过），把「族特有 15 个未注册 Op 名」登记为 `KNOWN_FAMILY_PENDING_OPS` 交接集，并断言缺口只落 npcs/weapons、不扩散到未知命名空间、不当作 bug 静默吞掉。同时把 `composition-alignment-rules.ts` 的既有 TODO 注解从「留给集成测试对比 listOpNames」升格为「已由 base-layer-bombardment 守卫以真实 OpRegistry 全量比对接入」，接通文档与守卫的机器断言链路。
- **交接项**（不越权）：npcs/weapons 的能力 `kernelOps` 需族专用解析器（或引擎把这些接口注册为 Op）落地后才纳入装载桥原子激活；在此之前登记为待裁决，不做杜撰。

### 无真实代码 bug 被本轮触发为"must-fix"

- 属性 1（装载）、3/4/5（护栏引用）、6/7/8（规范模型）、10/11（激活原子回滚）、12（适配器 Q-04 边界）均按真实模块直连通过，未刨出新的可证伪真实矛盾，无需逐点打补丁。

### 测试实现修正（非代码缺陷）

- fc.assert 同步属性必须经 `fc.property` 包装（fast-check 3.23 的签名约束），三处已修。
- `CompilationResult` 成功态才含 `snapshotId`/`artifactHash`，激活复用断言已按成功态收窄。
- `CandidateDefinition` 需满足 `BaseDefinition` 全字段形状，adapter 测试的构造器已补齐。

## 交接项签名

1. **npcs/weapons 能力 `kernelOps` 的 15 个未注册 Op 名**（`entity.move`/`query.*`/`state.*`/`entity.grantAction` 等）——登记为本 spec 的族特有待裁决已知边界（`base-layer-bombardment-opconsistency.test.ts`/`throughline.test.ts`），由族专用解析器或引擎把这些接口注册为 Op 后消解。Q-04 载器承载面 / `VEHICLE_PARAMETER_BINDING_GAP` / `registerMapAnchor` 接入 / `src/l2` 与 spec-compiler 收敛归属维持既有待裁决登记（本 spec 只守卫不发明）。
2. **`composition-alignment-rules.ts` 的 H-ECS-03 注释**已升格为指向本守卫的接线说明——若未来引擎把 npc/weapon 接口注册为 Op，需把 `KNOWN_FAMILY_PENDING_OPS` 从交接集移入统一注册集。

## 收尾门禁与红线复核（任务 12）

- [x] `npx tsc --noEmit` → 0 error
- [x] `npx vitest run`（本 spec 新增 6 文件 25 用例 + `src/class/__tests__` + `src/l2` 相关 scope）→ 全绿。全量 3166 用例中有 1 个红 = `src/core/kernel/ai/__tests__/combat-first.test.ts` 阶段2（expected a:attack got a:move），经仓库基线复核该断言在 committed HEAD（stash 掉 AI 轮子改动后）同样失败 —— 属 AI design-currency 并行轮子工作树改动（DRW 敌方维度实现未闭环），与本 spec 无关，登记为待并行轮子收敛。
- [x] `npm run lint` → 0 error（warning 既有）
- [x] `npm run verify:data` → 90 份全过
- [x] `npm run verify:docs` → 全过。需为 spec-document-discipline 的 `SOURCE_TRACING_ADOPTION` 登记本 spec（not-adopted，接受标准体无逐条 footer）—— 若不登记全量门禁会红 T2（活跃 requirements.md 漏检）；本轮已补登记并复跑全绿。
- [x] 未越权改 `src/core/kernel/**` 玩法语义 / `src/play/**` / 其他 spec 交付物；改动限于 `src/class/__tests__`+harness、`src/l2/validation/composition-alignment-rules.ts`、`test/toolchain/spec-document-discipline.test.ts`（SOURCE_TRACING_ADOPTION 登记）、本 spec 目录。

## 未完成 / 遗留（如实标注）

- `src/core/kernel/ai/__tests__/combat-first.test.ts` 阶段2 存在既存红测（expected a:attack vs a:move），属 AI design-currency 并行轮子工作树改动（git 基线非本轮引入），登记为待并行轮子收敛后复核，非本 spec 职权。
- 族特有目录（npcs/weapons）的 kernelOps 未注册 Op 名属待裁决交接（见上），不在本轮发明。
