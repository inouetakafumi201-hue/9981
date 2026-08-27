# 实施计划：wakeup-engine-bombardment（引擎层收官属性与压力测试）

## 概述

把 requirements.md 的 9 条逐层属性轰炸 + 1 条跨层贯通脏输入 + 1 条完备性元需求落成可执行测试任务。实现语言 TypeScript，测试库 fast-check。每个任务的产出是「一个带 `Feature: wakeup-engine-bombardment, Property N` 注释的 PBT/确定性测试文件」，每个属性被恰好一个 PBT 实现（≥100 次生成，压力面 300-500），每任务后回归三命令门禁，收尾追加 `npm run verify:data`（90 份）+ `npm run verify:docs`。

**边界**（宪法 + 专项规则）：只新增测试文件/测试夹具，只读生产实现、不为过测试打补丁；任何刨出的真实问题按宪法做整体修复（不做补洞），超出本 spec 职权的登记交接项。不碰 `src/class/**`，不改任何玩家可见数值（1-5 铁律 + AP 铁律 + 单动作原则）。

实现语言：TypeScript。

## 任务

- [ ] 1. 建立轰炸测试夹具：扩展脏输入集
   - 在 `src/core/kernel/__tests__/bombardment-fixtures.ts`（新建）导出扩展版 `GARBAGE_ARGS_EXT`（继承既有 `cross-layer-regression` 的 23 种 + 新增：原型键 `{['__proto__']:…}`、`{['constructor']:…}`、深度嵌套对象、跨集合 ref（把 item id 当 entity）、`dir:'one-way-down'` 合法方向、未知方向 `dir:'sideways'`、非有限 sides、不可实例化抽象 Def id、缺失字段）。
   - 同时导出一个 `emptyHolderCheck` 助手：对给定 OpRegistry + args 断言「不抛 / ok 为 boolean / 失败带 string code / 失败时状态引用逐字节不变」。
   - _要求：3.1、3.3、10.2_

- [ ]* 2. P1：L1 State 值安全与不变量稳定
   - **属性 1：L1 State 值安全与不变量稳定**
   - `bombardment-l1-state.property.test.ts`：fc 生成任意值（整数/浮点/字符串/布尔/null/数组/嵌套对象/原型键对象）→ 断言 `isFiniteNumber`（对 NaN/Infinity 恒 false）、`validateValue`/`isValidValue` 不抛且判定一致（非法值 `ok:false`）、含 `__proto__`/`constructor`/`prototype` 键的产物判非法。用 `InvariantChecker` 对 `createEmptyWorldState` 扫描断言零 fatal。
   - _要求：1.1、1.2、1.3_

- [ ]* 3. P2：L1 Topology 图度量一致性
   - **属性 2：L1 Topology 图度量一致性**
   - `bombardment-l1-topology.property.test.ts`：fc 生成随机图（多节点 + 混合方向 token 四值 + 加权 + 自环/悬空端点/负权）→ 断言 `dist(a,a)=0`、`shortestPath` 首尾为 a/b 且逐边可达、`dist`===序列代价和、`radius` 集合与 `dist(maxCost)` 一致、`spread` 结果 `strength∈[0,budget]` 且沿边单调、度量函数对含负权/悬空/未知方向图不抛。
   - _要求：2.1、2.2、2.3、2.4_

- [ ]* 4. P2b：L2 Expr/Query 穷举健壮性
   - **属性 2b：L2 Expr/Query 穷举健壮性**
   - `bombardment-l2-expr.property.test.ts`：复用 `fuzz-malformed-expr` 的结构随机 Expr 生成策略，落在真实 `ExprEngine`/`QueryEngine`/`makeDefaultEvalContext` 组合路径，断言求值返回合法 `Result` 或结构化错误、不抛未捕获异常；`checkPure` 对含副作用访问的表达式判为不纯。
   - _要求：2.5（并入要求 2 数据面）_

- [ ] 5. 检查点：L1-L2 属性轰炸闭合
   - 确认 Value/图度量/Expr-Query 三块属性测试全绿；无玩家可见数值越界；无越权改生产语义。

- [ ]* 6. P3：L3 Ops/Transaction 全 Op 脏输入原子性
   - **属性 3：L3 Ops/Transaction 全 Op 脏输入原子性**
   - `bombardment-l3-ops.property.test.ts`：遍历 `createFullHarness().registry.listOpNames()` × GARBAGE_ARGS_EXT（复用夹具），对每次 invoke 断言不抛/合法 Result/失败原子/结构标记；加 `Transaction.begin/commit/rollback` 嵌套随机序列断言 `getDraft` 恒返回引用、回滚恢复基线、越底无操作。
   - _要求：3.1、3.3、3.4_

- [ ]* 7. P4：L4-L5 Hook/Flow 确定性 + 预算
   - **属性 4：L4-L5 Hook/Flow 确定性 + 预算**
   - `bombardment-l4-hook-flow.property.test.ts`：fc 生成随机 RuleDef 集与 effect 脚本 → 断言 Hook 分发确定性（同输入同输出）、深度/重入超限签发 `E_HOOK_DEPTH`/`E_HOOK_REENTRY`、`FlowInterpreter` 超 budget/maxIter 签发 `E_FLOW_BUDGET` 且不挂死、`wireHooksIntoRegistry` 接线下 effects 真实经 FlowInterpreter 执行。
   - _要求：4.1、4.2、4.3、4.4_

- [ ] 8. 检查点：L3-L5 轰炸闭合
   - 确认 Ops 原子性 + Hook/Flow 预算全绿；记录任何刨出的异常。

- [ ]* 9. P5a+P5b：L6 Actions cost 守恒 + L7 Decision/Intent 决策有终
   - **属性 5a：L6 Actions cost 三态守恒**
   - `bombardment-l6-actions.property.test.ts`：构造带 AP 池世界，随机 freeze→settle/refund 交错（含失败 settle）断言池余额 + 有效冻结守恒、settle 失败不滞留冻结。
   - **属性 5b：L7 Decision/Intent 决策有终 + 意图幂等**
   - `bombardment-l7-decision-intent.property.test.ts`：随机决策开启/作答/超时序列断言 `makeProcessDecisionTimeouts` 推进后无悬置 open；意图 resolve/void 至多一次；`queryPendingIntentsFor/All` 无重复全覆盖。
   - _要求：5.1、5.2、5.3_

- [ ]* 10. P6a+P6b：L8 Attachment 级联回收 + L9 Schedule advance
   - **属性 6a：L8 Attachment 级联回收 + aura**
   - `bombardment-l8-attachment.property.test.ts`：随机 `grantedBy` 链 attachment 图 → 删父后 `cascadeRemovalSet` 覆盖全部后代、`checkAttachmentConsistency`+`checkGrantedByCascade` 全绿、无悬空 grantedBy。
   - **属性 6b：L9 Schedule advance 阶段一致**
   - `bombardment-l9-schedule.property.test.ts`：`schedule.advance` 对合法初始状态推进一个时间单位、不产生悬置；缺失可选字段返回合法错误码不崩溃。
   - _要求：6.1、6.2、6.3_

- [ ] 11. 检查点：L6-L9 轰炸闭合
   - 确认 Actions/Decision/Attachment/Schedule 四块全绿；核对 cost 收敛与决策终态。

- [ ]* 12. P7：L10 Random 回放确定性 + 输出范围
   - **属性 7：L10 Random 回放确定性 + 输出范围**
   - `bombardment-l10-random.property.test.ts`：随机 seed/流名/操作序列断言 `snapshotStream→restoreStream` 往返相等、重放输出逐取相等、`random.roll`∈`[1,sides]`、`pick`取自数组、`weightedPick` 按权重；无效 sides/空数组/负权重返回 `E_OP_INVALID_ARGS` 不越界。
   - _要求：7.1、7.2、7.3_

- [ ]* 13. P8：L12 Persistence 快照重放往返
   - **属性 8：L12 Persistence 快照重放往返**
   - `bombardment-l12-persistence.property.test.ts`：随机状态 + journal → `takeSnapshot`→`replay(journal)` 关键场语义等价；`applyMigration` transform 抛异常时原状态不变、原子失败；`compareVersions` 对任意版本串返回 `-1/0/1` 且不抛。
   - _要求：8.1、8.2、8.3_

- [ ]* 14. P9：L13 Safety/Codec fail-closed
   - **属性 9：L13 Safety/Codec fail-closed**
   - `bombardment-l13-safety-codec.property.test.ts`：fc 字节 bomb/深度嵌套/危险键 → `StrictJsonCodec.parse` 返回 AST 或结构化错误（带 code/line/column）、不原型污染、超 `HARD_MAX_NESTING_DEPTH` 返回 `E_LOAD_*_EXCEEDED`；`DiagnosticSink` 随机注入序列断言 error/fatal 不丢不降级、dedup 稳定、halt/evict 确定；`RuleCircuitBreaker` 随机时间序列断言阈值熔断、窗外不入、reset 清除；`QuotaEnforcer` 超配额 `ok:false`。
   - _要求：9.1、9.2、9.3、9.4、9.5_

- [ ] 15. 检查点：L10-L13 轰炸闭合
   - 确认 Random/Persistence/Safety/Codec 全绿；无栈溢出、无原型污染。

- [ ]* 16. P10：跨层贯通脏输入用例集轰炸
   - **属性 10：跨层贯通脏输入用例集轰炸**
   - `bombardment-cross-layer.property.test.ts`：复用 `createFullHarness`+`opSequenceArb`+`runOpSequence`+GARBAGE_ARGS_EXT，把既有 fuzz F1-F5 与 cross-layer A2 提高迭代（500）并扩展脏输入集，断言终局满足全部不变量、失败原子、无未捕获异常、无 Id 冲突、无挂死（<5000ms）；覆盖全部脏输入类别。
   - _要求：10.1、10.2、10.3_

- [ ] 17. 终极反例分类 + 完备修复
   - 汇总本轮全部 PBT 反例，逐条分类为「代码 bug / 测试缺陷 / 规格缺口」。代码 bug 按其根因按宪法做整体方案修复（不做补洞），并重跑相关属性；规格缺口登记交接项。在本 spec 目录写 `execution-report.md` 如实记录每个反例的分类与处置。
   - _要求：10.4、11.1-11.4_

- [ ] 18. 最终检查点：完备性自证 + 收尾门禁
   - **属性 11：完备性自证**
   - 逐条核对：每条验收标准 → 恰好一个属性（prework 表）；每属性 → 恰好一个 PBT（`Feature: wakeup-engine-bombardment, Property N` + ≥100 迭代）或确定性守卫；每任务 → 引用要求子句。
   - 收尾三命令门禁 + `npm run verify:data`（90 份）+ `npm run verify:docs`（废用词/层级标签），确认无越权改 `src/class/**`、无越 1-5 玩家可见数值、所有刨出 bug 已按宪法修复完毕、交接项已登记。
   - _要求：11.1-11.5_

## 备注 / 边界

- `*` 标注为 PBT 相关子任务，即正确性属性实现；本规格为收官轰炸，全部必做（不跳过）。
- 不碰 `src/class/**`；不改任何玩家可见数值；不引入新玩法机制。发现职责重复先做所有权裁决（D-060），不经适配器绕过。
- 属性测试用真机（import 生产代码 / `createFullHarness`），不用 mock 假实现。
- 反例分类后如实写入本 spec 的 `execution-report.md`，不隐藏任何未解决问题。
- 收尾门禁：`npx tsc --noEmit`、`npx vitest run`（相关范围）、`npm run lint`、`npm run verify:data`、`npm run verify:docs`。
