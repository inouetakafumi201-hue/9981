# 实施计划：基类层收官轰炸（属性 + 压力 + 引擎层引用一致性）

## 概述

为给基类层做终极验证，按「装载 → 契约护栏 → 规范模型 → 验证 → 运行时投影 → 装载桥原子激活 → 跨层贯通/引用一致性」逐层往上轰炸。实现将复用真实生产模块（不做 mock），把 `kernelOps ↔ OpRegistry.listOpNames()` 机械一致性从注释承诺升格为机器断言。

实现语言 TypeScript，测试库 fast-check（已装），PBT 均带有 `Feature: wakeup-base-layer-bombardment, Property N` 注释（常规 ≥100 次，压力面 ≥500 次）。

**白名单改动范围**（本轮只允许动这些，不越权改 `src/core/kernel/**` 玩法语义 / `src/play/**` / 其他 spec）：
- 新建测试：`src/class/__tests__/base-layer-bombardment-*.test.ts`
- 若需使 `kernelOps` 机械一致性成为装载期守卫，只允许在 `src/class/**`、`src/l2/validation/**`、`src/l2/model/**` 现有实现上做"从注释升格为机器断言"的整体性增强（不发明新机制）。
- `.kiro/specs/wakeup-base-layer-bombardment/**`

## 任务

- [x] 1. 设置测试骨架与真实输入接入（`base-layer-bombardment-harness.ts`）
- 建立 `src/class/__tests__/base-layer-bombardment-harness.ts`：全量真实目录（`CATALOG_DIRS` 14 目录）+ 统一形状 8 目录读取、`parseClassJson` 解析、`createFullHarness()` 的 `OpRegistry.listOpNames()` 真实接入。
- 定义 `OpNameUse` / `OpReferenceReport`（design.md 数据模型）+ `collectAllCatalogOpUses`/`buildOpReferenceReport`/`buildRealOpNameSet`。
- fast-check 固定 seed（属性 1/5/11 等压力面带 `numRuns ≥ 500` 与固定 seed）保证确定性拒绝可复现。
- _要求：1.4、2.3、4.2_

- [x] 2. 属性 1：JSON 装载畸形输入结构性失败（压力面）
- [x]* 2.1 生成任意畸形源文本（截断/尾随垃圾/非法转义/超大/超深/`kernelOps` 非字符串数组/重复键文本），经 `parseStrictDataJson`/`parseClassJson`/`loadClassCatalog` 解析
- 断言：要么成功、要么抛 `ClassCatalogContractError`（或含已分类诊断），绝不把畸形当合法吞掉；不抛未分类原始异常
- **属性 1：JSON 装载畸形输入结构性失败（numRuns ≥ 500，seed 固定）**
- **验证：要求 1.1、1.2、1.3**
- 落点：`base-layer-bombardment-loading.test.ts`（4 tests）

- [x] 3. 从注释升格 `kernelOps` 机械一致性守卫
- 检查 `src/l2/validation/composition-alignment-rules.ts` 与 `space-items-write-channel-rules.ts`。
- 处置：`composition-alignment-rules.ts` 的 H-ECS-03 TODO 已升格注解，指向本守卫以真实 `OpRegistry.listOpNames()` 全量比对接入；守卫以该权威源为唯一来源（非硬编码清单）。
- 发现真实缺口：npcs/weapons 声明 15 个 OpRegistry 不存在 Op 名，登记为族特有待裁决交接（见 execution-report）。
- _要求：4.1、4.2、4.4_

- [x] 4. 属性 9：`kernelOps` 机械一致性（核心引用错误检测）
- [x]* 4.1 用 `createFullHarness()` 的真实 `registry.listOpNames()` 作权威，对全量真实目录的每个声明 `kernelOps`（及 `operationChannels`）项机械比对
- 断言：每个 Op 名都落在已注册集内（全量真实目录必须机器通过）；若注入缺失 Op，守卫产生结构化报告
- 属性 9 被此测试唯一实现（tag `Feature: wakeup-base-layer-bombardment, Property 9`）
- **属性 9：`kernelOps` 机械一致性（numRuns ≥ 100）**
- **验证：要求 4.1、4.2、4.3、4.4**
- 落点：`base-layer-bombardment-opconsistency.test.ts`（5 tests）

- [x] 5. 属性 2/6/7/8：规范模型与验证层一致性守卫
- [x]* 5.1 **属性 2 全量真实目录可解析**：每个真实目录经 `parseClassCatalog(parseClassJson(text, id))` 成功且不改字节（numRuns=1，目录级）
- [x]* 5.2 **属性 6 同目录兼容**：栏护接受的真实统一形状目录，`src/l2/**` 验证不产生阻断性错误；栏护拒绝的注入拒绝与 L2 违例同族（numRuns ≥ 100）
- [x]* 5.3 **属性 7 非法 kernelOps/compositionKind/structural-bound 拒绝**：注入后 L2 验证报告 `SYSTEM_BINDING_*`/`COMPOSITION_KIND_*`/数值分类违例（numRuns ≥ 100）
- [x]* 5.4 **属性 8 composition-registry 一致性**：`resolveComponent` 未登记返回 null 不抛；已登记返回逐位相等；`listComponents` 字典序稳定（numRuns ≥ 100）
- **验证：要求 3.1、3.2、3.3、1.4**
- 落点：`base-layer-bombardment-model.test.ts`（properties 6/7/8）

- [x] 6. 属性 3/4/5：契约护栏引用闭合与循环终止
- [x]* 6.1 **属性 3 悬空引用确定性拒绝**：注入单点/组合悬空 class/capability/structural-bound 引用，断言确定性拒绝 + 重复解析结果逐位相同（numRuns ≥ 100）
- [x]* 6.2 **属性 5 循环引用有限终止**：注入 class↔capability 双向环/自引用，断言有限步内完成不超时（numRuns ≥ 100）
- [x]* 6.3 **属性 4 伪子类型/重复 id 拒绝**：注入共享 id / id 碰撞 / 相同类型身份陈述，断言 `findPseudoSubtypes` 非空或被拒（numRuns ≥ 100）
- **验证：要求 2.1、2.2、2.3、2.4**
- 落点：`base-layer-bombardment-references.test.ts`（properties 3/4/5，含循环终止时间卫）

- [x] 7. 检查点：装载 → 护栏 → 模型三分层全绿
- 只跑本轮新增测试文件与既有 `src/class/__tests__` + `src/l2` + `test/l2`，确认既有用例 + 本轮新增全绿，无回归
- _要求：1-6 全部_

- [x] 8. 属性 10/11：装载桥原子激活（复用既有 `catalog-activation.property.test.ts` 的 P8/P10，新增压力子属性）
- [x]* 8.1 **属性 10 生产模式成功 + 多目录合并跨目录引用闭合**（真实 8 统一目录，`activateCatalogs` 成功、无悬空、确定性快照）
- [x]* 8.2 **属性 11 失败原子回滚**：注入任意契约违例，`compileAndActivate` 失败时已激活定义集合逐位不变（numRuns ≥ 500）
- **属性 10：装载桥生产激活/跨目录闭合**
- **属性 11：装载桥失败原子回滚（numRuns ≥ 500）**
- **验证：要求 5.1、5.2、5.3**
- 落点：`base-layer-bombardment-activation.test.ts`（properties 10/11，~43s）

- [x] 9. 属性 12：L2 适配器运行时配置与 Q-04 边界
- [x]* 9.1 对 space-items `CandidateDefinition` 经 `vehicleToRuntimeConfig`/`containerToRuntimeConfig` 转换，断言输出字段与 L1 运行时契约分类兼容，且不推导 `category:'carrier'` 承载面
- [x]* 9.2 `validate*RuntimeConfig` 对脏配置返回结构化字符串列表而不抛异常（numRuns ≥ 100）
- **属性 12：L2 适配器配置兼容与 Q-04 边界（numRuns ≥ 100）**
- **验证：要求 6.1、6.3**（要求 6.2 写通道唯一性由属性 13 的 throughline 写通道扫描落地 + 上游 base-layer-ecs 属性 8 复用，本任务不自证 6.2）
- 落点：`base-layer-bombardment-adapter.test.ts`（properties 12）

- [x]* 10. 属性 13：跨层贯通回归锁
- [x]* 10.1 `parseStrictDataJson` 全量真实目录可解析 + `parseClassCatalog` 统一形状目录全部可接受 + `buildRealOpNameSet`/`buildOpReferenceReport` kernelOps 机械闭合三关对齐，如实标出已知切片边界（族特有 6 目录未接装载桥、Q-04 carrier 面待裁决、`VEHICLE_PARAMETER_BINDING_GAP`、`registerMapAnchor` 零消费）为 Known，不视为失败
- [x]* 10.2 **跨目录写通道扫描（要求 6.2/1.5）**：统一形状目录每个 class 组件装配写件全部注册于真实 OpRegistry（not-mutate 只读面不裸写），杜绝越权 mutate 运行态；npcs/weapons 未接入切片，其写 Op 缺口登记为 known 待裁决
- **属性 13：跨层贯通回归锁（`npm run verify:data` 期可复跑）**
- **验证：要求 7.1、7.2、6.2、1.5**
- 落点：`base-layer-bombardment-throughline.test.ts`（三关对齐 + 写通道扫描；3 tests）

- [x] 11. 反例分类与交接项登记
- 汇总本轮全部被刨出的真实问题：分类为「真实 bug → 已整体修复」/「测试缺陷 → 已修正」/「规格缺口 / 待裁决 → 登记交接项」
- 对任何真实代码矛盾，按宪法（文档即权威 / 解耦优先 / 机器可校验 D-073）做整体修复并说明根因，不做逐点补洞；将 Q-04 载器承载面、`VEHICLE_PARAMETER_BINDING_GAP`、`registerMapAnchor` 接入、`src/l2` 与 spec-compiler 收敛归属登记为待裁决交接
- _要求：8.2（若产生，如实记录）_
- 落点：`execution-report.md`（15 个族特有待裁决 Op 名、Q-04、VEHICLE_PARAMETER_BINDING_GAP、registerMapAnchor，均登记为 Known）

- [x] 12. 规格完备性与门禁复核
- 核对每条要求被覆盖、每属性唯一测试实现、每任务可回溯；跑收尾三命令 + `verify:data` + `verify:docs`
- `npx tsc --noEmit`、`npx vitest run`（相关范围 + 全量）、`npm run lint`、`npm run verify:data`、`npm run verify:docs`
- 要求→设计→任务→测试证据四向回溯：design.md 增补「完备性自证」节（8.1-8.4 落点表 + 属性↔要求↔文件↔迭代映射表），要求 1-7 的 25 条子句全部被属性验证行回链、8.1-8.4 元要求被自证表覆盖
- 更新 `MEMORY` 与既有 `l2-base-layer-spec/tasks.md` 的 D-4/D-5 落点状态（如需，追加交接登记）
- _要求：8.1、7.1_

## 备注

- 标 `*` 为 PBT 子任务；每属性恰好一个实现被保证（design.md「完备性自证」映射表维护）。
- 要求 6.2 写通道唯一性由属性 13 的 throughline 跨目录写通道扫描落地 + 上游 base-layer-ecs 属性 8 复用（豁免唯一实现，见 design.md 属性 12 说明）。
- 所有 `fast-check` 断言必须能注入 seed 以保证确定性；拒绝类用例用既有 `sortViolations` 排序断言。
- 复用既有 `catalog-activation.property.test.ts`、`scene-catalog-activation.property.test.ts`、`class-contract-guards.test.ts` 的违例注入模式，不重造已绿性质（P8/P10）。
- 不越权改 `src/core/kernel/**` 玩法语义、`src/play/**`、其他 spec 交付物；`kernelOps` 机械一致性守卫只在基类层实现为守卫，不重开引擎层 Op 集。
- `createFullHarness()` 处于 `src/core/kernel/testing/full-harness.ts`，已在引擎层轰炸中被实际使用，真实接线。
