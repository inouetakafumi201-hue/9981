# 实施计划：wakeup-engine-layer（引擎层与基类层对账完备性）

## 概述

把 requirements.md 的六条对账需求（R-A~R-E + 守卫）+ 完备性元需求（要求 7）落成可执行任务。实施语言 TypeScript，测试库 fast-check。每个任务建立在前序之上、引用具体要求子句、合理间隔置检查点，PBT 子任务标 `*` 后缀。每任务后回归三命令门禁（`npx tsc --noEmit` 0 / 相关范围 `npx vitest run` 全过 / `npm run lint` 0 error），收尾追加 `npm run verify:data` + `npm run verify:docs`。

实现语言：TypeScript。

## 任务

- [ ] 1. A1：方向 token 语义修通（R-A）
   - `src/core/kernel/topology/metrics.ts` `allowsTraversal(link, fromA)`：按 `Link.direction` 决定 b→a / a→b 是否允许；`'one-way-down'` 仅 a→b、`'one-way-up'` 仅 b→a、`'bidirectional'`/未定向双通、`'unidirectional'` 仅 a→b；`direction === undefined` 回退 `directed`（back-compat，绝不报错）。
   - 让 `dist/spread/shortestPath/radius` 全部走 `buildAdjacency` 消费四值。
   - _要求：1.1、1.2、1.3_

- [ ]* 2. A2/A3：方向守卫 + 交接（R-A back-compat、要求 2）
   - **属性 1：方向可达性不对称** / **属性 2：方向 back-compat**
   - `engine-layer-map.property.test.ts` Property 6 扩展 + `transform-ops.test.ts` link.create back-compat 用例，断言 `one-way-down` 反向 `dist` 为 `null`、`one-way-up` 反向、至少一条真实度量被四 token 触及。
   - 交接登记：`reconciliation-design.md` §四「方向扩值交接 L2」。
   - _要求：1.3、1.4、1.5、2.1、2.2、2.3_

- [ ] 3. 检查点：方向语义闭合
   - 确认 `dist/spread/shortestPath/radius` 对四 token 的可达性断言全绿；无玩家可见数值变化（仍 1-5）；back-compat 无缺 token 报错。

- [ ] 4. B1：单调重定义授权门统一（R-B 主修）
   - `src/l2/ugc/ports/package-mapping.ts` `checkChangeAuthorization`：同 key 且未声明 `overrideIntent` 不再报 `REF_OVERRIDE_NOT_DECLARED`（同 key 即重定义，放行到 activate 覆盖）；保留 add/replace/remove 与 `overrideIntent`/`removals` 声明一致的判据（`REF_OVERRIDE_TARGET_MISSING`/`REF_REMOVAL_TARGET_MISSING`）。
   - _要求：3.1、3.2、3.5_

- [ ] 5. B2：`effectiveOverrides` 数据面（R-B 依赖重验证）
   - `src/l2/ugc/ports/package-mapping.ts` `mapCandidatePackage`：为 `CandidateMappingResult` 计算 `effectiveOverrides`（活动定义中同 key 被候选覆盖者）；`validation-gateway.ts` 透传入 `validateFullPackage`；`dependent-revalidation.ts` 用其补 `revalidateDependents` 只随 `overrideIntent` 走的缺口；验证-网关接口字段均可选、后向兼容。
   - _要求：3.3_

- [ ]* 6. B3+B4：单调重定义守卫（R-B 原子性）
   - **属性 3：单调重定义有效与原子回滚**
   - `full-pipeline.integration.test.ts` 加 `effectiveOverrides` 用例（激活 provider+consumer 后同 key 改 defKind 断言 `E_LOAD_OVERRIDE_INVALIDATES_DEPENDENT`）；`schedule.test.ts` 单调覆盖/回滚属性断言激活失败时活动注册表不变。
   - `definition-registry.ts` 已 Map.set 覆盖、`playpack.ts` findConflicts 恒空死分支清理（B3）。
   - _要求：3.1-3.5_

- [ ] 7. 检查点：单调重定义闭合
   - 确认 UGC 端口同 key 后装不再 `REF_OVERRIDE_NOT_DECLARED`、激活为后装覆盖、激活失败原子回滚；`effectiveOverrides` 贯穿 mapping→validation→revalidation 全链路。

- [ ] 8. C：载器承载面守卫 + 交接登记（R-C）
   - **属性 4：载器承载面接纳规则** / **属性 5：载器/载具守卫保持现状**
   - `carrier.property.test.ts` 守卫 `container.enter` 非 `category:'carrier'` 面拒 `E_OP_NOT_ACCEPTED`、carrier 面可进、容量封顶、destroy 清槽、无半改；基类层 `item-vehicle-rules`/`space-items-micro-scene-rules` 守卫确认保留现状。
   - `reconciliation-design.md` §二登记「基类层 seat_binding/agent.bind 不建 carrier 面」为待裁决，交接 L2。不推导机制。
   - _要求：4.1-4.4_

- [ ] 9. D：地图锚点措辞对齐 + 守卫（R-D）
   - **属性 6：地图锚点同 key 撞位不可替换、异 key 互不排**
   - `src/play/map/anchor.ts` 措辞对齐「同 key 撞位不可替换、异 key 互不排（ID 尾数区分）、非绝对不可替换」；`engine-layer-map.property.test.ts` Property 4 多地图独立性守卫。
   - `reconciliation-design.md` §六登记 `registerMapAnchor` 无消费端接入缺口为交接项，交接 L2 仲裁接入点。
   - _要求：5.1-5.3_

- [ ] 10. E：载具参数面登记待裁决（R-E，不推导）
   - `reconciliation-design.md` §七维持 `VEHICLE_PARAMETER_BINDING_GAP` 登记，列 `moveApCost`/`cargoCapacity`/`occupiedDisposition` 等缺失顶层 key 为 Q-04 派生待裁决项，交接 L2。不在本 spec 合成承载面。
   - _要求：6.1、6.2_

- [ ] 11. A4+B 收尾：错误处理与守卫对齐
   - 确认 `E_OP_NOT_ACCEPTED`（carrier 拒非 carrier）既有不改；`REF_OVERRIDE_NOT_DECLARED` 从「同 key 单调」退出但保留 add/replace 判据；方向 back-compat 缺 token 不回退报错。`code-map.ts`/`error-codes.ts`/消息束对 `E_LOAD_OVERRIDE_INVALIDATES_DEPENDENT` 的映射与提示已完备。
   - _要求：1.3、3.2、4.1、6.2_

- [ ] 12. 最终检查点：完备性自证（要求 7）
   - **属性 7：规格完备性自证**
   - 逐条核对：每条验收标准 → 恰好一个属性（prework 表）；每属性 → 恰好一个 PBT（`Feature: wakeup-engine-layer, Property N` + ≥100 迭代）或确定性守卫；每任务 → 引用要求子句。
   - 收尾三命令门禁 + `npm run verify:data`（90 份）+ `npm run verify:docs`（废用词/层级标签），确认对账五线 + 守卫全绿、无越权改 `src/class/**`、待决项全部交接 L2。
   - _要求：7.1-7.4_

## 备注 / 边界

- `*` 标注为 PBT 相关可选子任务，即正确性属性实现；本规格为完备性兜底，不跳过。
- 不碰 `src/class/**`；方向扩值、载器接线、载具参数、地图锚点接入一律交接 L2 线。
- 改玩法逻辑、不改玩家可见数值（1-5）、不做狂轰滥炸（白盒封顶后做）。
- 待决项（载器接线、载具参数、地图锚点接入、方向扩值）全部登记 reconciliation 文档并交接 L2 线，不本 spec 越权拍板。
