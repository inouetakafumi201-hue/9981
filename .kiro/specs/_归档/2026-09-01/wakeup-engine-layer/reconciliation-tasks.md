# 实施计划：wakeup-engine-layer 基类层对账（reconciliation）

## 概述

把引擎层与基类层/对接层已知的五条冲突/不对应按宪法与权威文档对齐回完备，全部主控专做。本轮**不改玩法逻辑、不越权改 `src/class/**`、不做狂轰滥炸（白盒封顶后做）**；只让两层语义一致、补守卫、登记交接项。实现语言 TypeScript，测试库 fast-check（守卫 ≥100 生成，带 `Feature: wakeup-engine-layer, Property N` 注释）。每任务后回归三命令门禁 + `verify:data`/`verify:docs`。

## 任务

- [ ] 1. 方向语义修通（A1，需求要求 1）
   - `src/core/kernel/topology/metrics.ts` `buildAdjacency`：按 `Link.direction` 决定是否加反向边；`direction === undefined` 时回退 `directed` 布尔（back-compat）。
   - 语义：bidirectional/无token+未定向=双向；unidirectional/无token+已定向=仅 a→b；one-way-down=a→b；one-way-up=仅 b→a。
   - 让 `dist/spread/shortestPath/radius` 全部用上四值。

- [ ] 2. 方向守卫（A2，需求要求 2）
   - `engine-layer-map.property.test.ts` Property 6 扩展：对 `one-way-down`，`dist(a,b)` 可达、`dist(b,a)` 为 `null`；`one-way-up` 相反；`bidirectional` 两向可达。至少一条真实度量函数被四 token 触及。

- [ ] 3. 基类层扩值交接登记（A3，不执行）
   - `reconciliation-design.md` §四「交接项」写明：`scenes/index.json` + `family-contracts.ts:243` 扩到四 token 提交 L2 线。本轮 metrics 已对齐四 token 语义。

- [ ] 4. 单调重定义授权门统一（B1，需求要求 3）
   - `src/l2/ugc/ports/package-mapping.ts` `checkChangeAuthorization`：判据 1「未声明覆盖」在「同 key 且未声明 overrideIntent」时**不再报 `REF_OVERRIDE_NOT_DECLARED`**（同 key 即重定义，放行到 activate 覆盖）；保留判据 2/3（add/replace/remove 与 `overrideIntent`/`removals` 声明一致性）。

- [ ] 5. 单调重定义守卫（B2+B4，需求要求 3）
   - 守卫测试锁「UGC 端口同 key 后装不再 `REF_OVERRIDE_NOT_DECLARED`，激活后为后装覆盖」「激活失败时活动注册表不变（原子性）」。
   - `definition-registry.ts` 已 Map.set 覆盖，无需改，只加守卫。

- [ ] 6. 引擎层单调残留清理（B3）
   - `src/core/kernel/schedule/playpack.ts`:110-112 死分支（findConflicts 恒空）移除；`playpack-runtime.ts:150` PoolDef 撞名保留（不同命名空间语义）。

- [ ] 7. 载器载体守卫（C2，需求要求 4）
   - 守卫测试：`container.enter` 对非 `category:'carrier'` 面拒绝 `E_OP_NOT_ACCEPTED`；对 `category:'carrier'` 面可进活体；基类层 `item-vehicle-rules` 对 `interiorMicroSceneBoundary` 仍拒 `SOURCE_PROMOTION_REQUIRES_DECISION` + `space-items-micro-scene-rules` 对 `modelsVehicleAsMicroScene` 仍拒 `VEHICLE_NOT_MICRO_SCENE`。

- [ ] 8. 地图锚点措辞对齐（D2+D1，需求要求 5）
   - `anchor.ts` 头注释/拒绝消息对齐「同 key 撞位不可替换、异 key 不互排（ID 尾数区分）、非绝对不可替换」。
   - Property 4 守卫保持「同 key 不可替换 / no-reload 跳过 / 异 key 不互排 / 释放可重装 / LLM 地图拒绝」，注释对齐 UGC §7.6。

- [ ] 9. 载具参数面交接登记（E1，需求要求 6）
   - `reconciliation-design.md` §七 维持 `VEHICLE_PARAMETER_BINDING_GAP` 登记，列 field-name 顶层键缺失为 Q-04 派生待裁决项，交接 L2 线。

## 收尾（最终验证）

全部任务后跑：`npx tsc --noEmit` 0、`npx vitest run` 全过、`npm run lint` 0 error、`npm run verify:data` 90 份过、`npm run verify:docs` 过；确认两层语义对齐回完备，无越权改 `src/class/**`。

## 备注 / 边界

- 不碰 `src/class/**`；方向扩值、载器接线、载具参数、地图锚点接入一律交接 L2 线。
- 不做狂轰滥炸测试（白盒封顶后做）。
- 不推导载器机制、不把载具当微型场景（D-038/Q-04）。
