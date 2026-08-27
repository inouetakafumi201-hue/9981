# Implementation Plan — 整合层装载运行期（专项 wakeup-loading-runtime）

## 概述

本实施计划把整合层（专项 B）的落地实现与收账整合为可执行任务。专项 A（CEME）与专项 D（基类层注册表桥）的承载面、组合根 `createLoadedMatch`、对局外壳 `createMatchShell`、UI 宿主 `createUiHostPorts`、生产加载驱动 `driveMatch`、事件出口（真实 PresentationGateway）均已落地且通过契约测试（规划文档 `docs/L_归档/工程治理_历史/04_整合层_装载运行期_规划设计.md` 已完成使命归档，本 spec 是正式交付规格）；本计划的任务把已有测试逐项对照 Requirement 32~41，补齐缺失的契约断言/PBT 与属性测试，并完成收账（OVERLOAD_GAP 结算登记、ui-adapter 处置、主状态板入账）。最终全量门禁确认新 spec 覆盖。

实现语言：TypeScript（沿用 `src/play/loading-runtime/` + `test/play/loading-runtime/` 既有结构）。

---

## 任务

- [x] 1. 核对组合根契约已覆盖（Requirement 32/33/34/39）
- 复核 `create-loaded-match.contract.test.ts` 7 用例与 `createLoadedMatch`（`index.ts:98`）：装载成功、门禁体面、装配字节级一致、失败原子、地图 spawn、演员 AI 装配、外壳控制（advance+drain）。
- 确认 `LoadedMatch` 门面按 `types.ts:79` 暴露全部 14 个面向。
- 确认唯一写通道纪律：`match` 不暴露可写 holder，装载完成后宿主只能经 `facade.submit` / `submitter.submitAction` / `control.*`。
- 确认零耦合守卫（`*contract*` 断言面）：整合层未绑定到未冻结依赖。
- _要求：32.1~32.7, 33.1~33.4, 34.1~34.5, 39.1~39.5_

- [x]* 2. 编写/核对组合根 PBT（属性 1/2/3）
- **属性 1：装载成功且装配一致** · **验证：Requirement 32.2, 32.3**
- **属性 2：装载失败原子性** · **验证：Requirement 32.4, 33.3**
- **属性 3：门禁体面** · **验证：Requirement 33.2**
- 用 fast-check 生成玩家子集/非法 config/缺失实体等，断言 `ok:true` 时 listOpNames 与 createFullHarness 全等、门禁 blocked 只含未冻结项；`ok:false` 时 `match` 不存在。
- _要求：32.2, 32.3, 32.4, 33.2, 33.3_

- [x] 3. 核对外壳终局与事件出口已覆盖（Requirement 35/40）
- 复核 `loaded-match.ports.contract.test.ts`（外壳终局单次广播、submitGuard 拒绝、外壳自检）与 `event-gateway.contract.test.ts`（gateway 只读/round 事件/终局事件）。
- 确认 `matchEnd` 双层去重：外壳 `endedBroadcast` + 组合根 `matchEndDelivered`，双路径（shellEventRelay + broadcastShell）不重复投递。
- 确认 `gateway.dispatch('match.round'/'match.ended')` 只在 round 变更/终局时调用。
- _要求：35.1~35.6, 40.1~40.4_

- [x]* 4. 编写/核对终端 PBT（属性 4/5）
- **属性 4：终局判定单调单向** · **验证：Requirement 35.2, 35.3, 40.1**
- **属性 5：round 只增不减** · **验证：Requirement 35.4**
- 生成任意次 advance，断言 `shell.ended` 单调单向、`matchEnd` 事件单次、round 只增不减、终局后 submitGuard 恒拒绝。
- _要求：35.2, 35.3, 35.4, 40.1_

- [x] 5. 核对生产加载驱动已覆盖（Requirement 36）
- 复核 `drive.e2e.test.ts` 5 用例：全自动推进五阶段、playerAction 自动 drain、NPC 决策喂入、终局停止、maxSteps cap。
- 确认 `driveMatch`（`drive.ts:51`）在终局后以 `ended:true` 返回、`steps===0`；守卫拒绝时如实返回（不遮蔽）。
- _要求：36.1~36.6_

- [x]* 6. 编写驱动 PBT（属性 6）
- **属性 6：驱动终局停止** · **验证：Requirement 36.4**
- 生成已终局对局，断言 `driveMatch` 返回 `ended:true`、`steps===0`、不再推进。
- _要求：36.4_

- [x] 7. 核对演员面已覆盖（Requirement 37）
- 复核 `create-loaded-match.contract.test.ts` 演员面用例（npcBudget 时 `ai` 非空、NPC 实体/agent 登记、NPC 队列投影回主 holder）。
- 确认 AI/UI/玩家经 `CoreMechanicsFacade.submit` 同一判罚路径（`submit` 无来源参数）；UI 经桥产 `submitter.submitAction`。
- 确认 AI runtime 自持 holder 只作决策环仿真快照源，不参与主世界写入。
- _要求：37.1~37.5_

- [x]* 8. 编写/核对同判罚路径 PBT（属性 7）
- **属性 7：同一判罚路径** · **验证：Requirement 37.4**
- 生成同一动作请求经 facade / submitter / UI ActionPort，断言三者得到相同合法性判定与相同拒绝原因。
- _要求：37.4_

- [x]* 9. 核对桥只读 PBT（属性 8，既有）
- **属性 8：桥只读无副作用** · **验证：Requirement 39.2**
- 复核 `loading-runtime.property.test.ts` 属性 3（桥只读视图冻结/kernel.hasOp 真实/防污染）。
- _要求：39.2_

- [x] 10. 核对 UI 宿主已覆盖（Requirement 38）
- 复核 `loaded-match.ports.contract.test.ts` UI 宿主 7 端口用例（projection/actionQuery/revision/actions/pendingContracts/diagnostics 可用）。
- 确认 `src/ui` / `src/devboard` 目录内无 `OpRegistry`/`WorldStateHolder` 标识符（正交域纪律）。
- _要求：38.1~38.5_

- [x]* 11. 编写/核对 UI 端口 PBT（属性 9/10）
- **属性 9：事件出口只读无副作用** · **验证：Requirement 40.3**
- **属性 10：UI 端口不可用能力显式 pending** · **验证：Requirement 38.5**
- 断言 gateway.query/queryActions 不触发任何写入；pendingContracts 不可用能力返回 pendingConvergence 而非虚假可用值。
- _要求：38.5, 40.3_

- [x] 12. 检查点——整合层契约 + PBT 全绿
- 核对 `test/play/loading-runtime/` 全部测试文件（组合根/端口/事件出口/驱动/property/fixtures）通过；tsconfig/vitest 自动纳入新测试。
- 全量 `npx vitest run` 相关范围 + `npx tsc --noEmit` + `npm run lint` + `npm run verify:docs`。
- _要求：41.1, 41.2_

- [x] 13. 收账——OVERLOAD_GAP 结算登记
- 按专项 A（CEME）Requirement 28 判定 OVERLOAD_GAP 归属：若 CEME 已把过载收束进 core-mechanics，本 Spec 确认其 `src/play/core-mechanics/` 包内校验（`validateOverloadConfig` 6 项）与运行期结算规则指向同一权威；把该 `OVERLOAD_GAP` 登记状态改为"已结算"并入主状态板。
- 若 legacy `src/play/action-turn/playpack.json` 仍是唯一过载实现，则显式登记为交接项（后续专项把 D-055 语义以新规则落地 core-mechanics；本 Spec 只登记，不代实现）。
- **2026-08-17 交叉复核结论（如实登记）**：CEME 已在 core-mechanics 落地过载的施加/拦截/归队规则（`overloadApplyRule`/`overloadBlockIntentRule`/`overloadTickRule`，`rules.match.ts:135`+`schedule.ts` 投点 onEnter 逐实体 `OVERLOAD_TICK`）与 `overloadedAttachment`（D-055 语义），配置校验（`validateOverloadConfig` 6 项）与这些规则指向同一权威。但触发链仍有一处零连接须直书：`play.overload.apply` 与 `pool.overflow` 在 core-mechanics 包内**无任何生产发射端**（`staminaGrantRule` 用 `prop.set` 而非 `pool.add`，满 5 时既不触发过载也不发 `pool.overflow`；全仓仅测试 `state-machine.e2e.test.ts` 直接 `applyAttachment` 施加过载），故 `overloadApplyRule` 在生产主世界当前不会被自发触发，过载施加的权威入口仍是 legacy `action-turn/playpack.json`（挂 `pool.overflow`）。已登记为后续专项交接项：把过载触发端口收束进 core-mechanics（在体力超上限路径发 `pool.overflow`→`overloadApplyRule`），不代实现、不改写既有文件。主状态板 154 行已同步补充。
- _要求：41.5_

- [x] 14. 收账——legacy ui-adapter 处置登记
- `src/l2/adapters/ui-adapter.ts` 的 `uiDescriptor` / `submitUiAction` 是 L2 描述符/提交实现，被 `test/properties/P11` 与 `adapter-consumers.integration.test.ts` 真实引用（**不可删除**）；整合层 UI 宿主 `createUiHostPorts` 用桥产 `action-submitter` 而非 `submitUiAction`。
- 在整合层收尾中登记 `ui-adapter.ts` 为"L2 描述符实现（被既有测试真实引用）"并明确其与整合层 UI 宿主的关系（两者职责未合并，各自稳定）；不删除、不重构既有 L2 契约。
- 若 04 规划文档曾把 ui-adapter 列为"悬空适配器"待处置，此处更新为"已定位为 L2 描述符实现，保留"。
- _要求：41.5_

- [x] 15. 收账——归档 04 规划文档到 L_归档（已完成）
- `docs/工程治理/04_整合层_装载运行期_规划设计.md` 已归档到 `docs/L_归档/工程治理_历史/04_整合层_装载运行期_规划设计.md`（保留原全名），因专项 B 已落地、spec 已落账，规划文档转为历史参考；05/06/07 prompt 与 CEME spec 的引用已更新为归档路径。
- 保持工程治理目录剩余文档（01/02/03/05/06/07）原貌，不动范围。
- _要求：41.5_

- [x] 16. 收账——主状态板更新
- 更新 `docs/00_主状态板.md` 整合层条目：将"剩余（最后一公里）"改为"已落地 + spec 落账（wakeup-loading-runtime）"，登记 loading-runtime 专项 spec 路径；主状态板 28 行测试计数更新为装入 loading-runtime 全量后的数值。
- _要求：41.5_

- [x] 17. 最终检查点——全量门禁 + 交接项登记
- 跑 `npx tsc --noEmit` + `npx vitest run` + `npm run lint` + `npm run verify:docs`，全量通过。
- **2026-08-17 复核结果（如实登记）**：`tsc --noEmit` ✅ 0 error；`npm run lint` ✅ 0 error（144 既有 warning）；`npm run verify:docs` ✅ 全过；`vitest run` 全量 381 文件 3562 通过，唯一红灯为既有 `bombardment-l2-expr.property.test.ts` 的 Property 2b（`Expr {path:"toString"}` 触发 `getPath` 落到宿主 `Object.prototype.toString` 内建函数，断言非 Value 形状而红；fast-check 种子随机、复跑可绿，属既存 flaky，非本整合层引入，只登记不代修）。loading-runtime 自身 6 文件 34 用例全绿。
- 在收尾综述如实列明不可自证/交接项（specific 模式胜负平衡、MapData floor→layers 契约扩展、素材库元状态、可用性钩子真逻辑），不得谎报完成。
- **交接项明细**：①具体模式胜负平衡 / `victoryCondition` 只留承载面，无具体消费整合层契约；②MapData `floor→layers` 契约扩展为独立专项，`types.ts` 仍 `floor:int`；③素材库元状态层为正交域，UI 宿主对不可用能力已 `pendingConvergence`；④可用性钩子真逻辑仍为放行桩；⑤过载触发端口收束（OVERLOAD_GAP 遗留，见任务 13）；⑥`bombardment-l2-expr` Property 2b flaky（`path:"toString"` 宿主原型护栏，既存非本线）。
- _要求：41.1, 41.3, 41.4, 41.5_

## 备注

- 标有`*`的任务是可选测试任务（PBT/属性测试），沿用既有 `loading-runtime.property.test.ts` 的 fast-check 风格（≥100 次迭代，标记 `Feature: wakeup-loading-runtime, Property N: …`）。
- 每个任务都引用了特定 Requirement（32~41），可追溯回 `requirements.md`。
- 检查点任务（Task 12/17）确保在实现与收账之间增量验证。
- 实现语言 TypeScript；测试库 fast-check（既有）。
