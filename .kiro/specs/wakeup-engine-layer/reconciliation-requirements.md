# 需求：wakeup-engine-layer 基类层对账（reconciliation）

## 概述

对引擎层近批落地与基类层/对接层的**冲突与不对应**做一次全量审查，给出符合需求的解决方案，使两层都回到完备状态。本轮审查聚焦五条已由代码核实确认的线：载器承载写通道(1)、方向 token 布尔化丢失(2)、单调重定义装载(3)、地图锚点(4)、载具参数承载面(5)。权威事实源为宪法(第十一条「文档即权威」)、基类层空间系统(UGC §7.6/03 空间系统)与既有 D 编号裁决（D-073/D-074/D-038/Q-04）。

实现语言：TypeScript。测试库：fast-check（守卫测试均 ≥100 次生成，带 `Feature: wakeup-engine-layer, Property N` 注释）。

## 原则

1. **合规优先、不越权**：不跨 Spec 改基类层交付物（`src/class/**`）；载具参数、Q-04、方向扩值、地图锚点接入一律登记交接至 L2 基类层线，不在本轮越权改。
2. **玩法逻辑未变**：本轮只让引擎层与基类层/对接层的**语义对齐回完备**，不改任何玩家可见数值、不加新玩法机制。
3. **设计全定后轰炸**：本轮先对齐语义；属性和用例狂轰滥炸留待白盒封顶后。
4. **Q-04 未决不推导**：载器接线属待裁决，不推导载器机制、不把载具当微型场景。

---

## 要求 1：方向 token 语义在引擎层修通

**用户故事：** 作为引擎层实现者，我希望 `dist/spread/shortestPath/radius` 能真正消费 `Link.direction` 的四值语义，以便 one-way-down/one-way-up 不再被压成无差别单向。

#### 验收标准

1. THE engine-layer topology metrics SHALL build its adjacency by consuming `Link.direction` rather than only the `directed` boolean, so that `'one-way-down'` disables the b→a traversal while keeping a→b, and `'one-way-up'` disables the a→b traversal while keeping b→a.
2. THE `'bidirectional'` and `'unidirectional'` tokens SHALL retain their existing semantics under the change (bidirectional traverses both ways, unidirectional only a→b).
3. WHEN a link has no `direction` token (legacy back-compat), THEN metrics SHALL fall back to the `directed` boolean so existing callers that construct `Link` without `direction` keep working.
4. THE change SHALL NOT alter any player-visible numeric value (values stay 1-5); direction affects only reachability/traversal, not cost magnitude.

## 要求 2：方向 token 数据面一致（守卫）

**用户故事：** 作为引擎层实现者，我希望守卫测试锁定「one-way-down 反向不可达、one-way-up 正向不可达」，以便 metrics 的未来改动不会再度把方向压成布尔。

#### 验收标准

1. THE property test `Property 6` SHALL assert that, for a `'one-way-down'` link, `dist` from a to b is reachable and from b to a is `null`; SHALL assert the reverse for `'one-way-up'`.
2. EVERY real traversal metric (`dist`/`spread`/`shortestPath`/`radius`) SHALL be exercised at least once against the four-token direction in the guard.

## 要求 3：单调重定义装载在 UGC 授权门统一

**用户故事：** 作为 UGC 实现者，我希望同一个「同 key 再装」在引擎层 `PlaypackLoader`（D-073 后装覆盖）与 UGC 端口授权核对（`package-mapping.ts`）语义一致，以便玩家上传后继包不再被 `REF_OVERRIDE_NOT_DECLARED` 误拒。

#### 验收标准

1. THE UGC 端口 `checkChangeAuthorization` SHALL treat a same-key redefinition as valid under the monotonic model and SHALL NOT reject it with `REF_OVERRIDE_NOT_DECLARED` merely because no `overrideIntent` was declared.
2. THE criteria that OWED `REF_OVERRIDE_TARGET_MISSING` / `REF_REMOVAL_TARGET_MISSING`（add/replace/remove 操作与 `overrideIntent`/`removals` 声明的一致性）SHALL be preserved—they are not part of D-073.
3. THE engine layer `defRegistry` SHALL keep activating a same-key candidate as a later-loaded override（Map.set 覆盖），and the port guard SHALL no longer block it before activation.
4. WHEN an activation fails, THE definition registry SHALL retain the previous active set（atomicity，`activate` 只动候选、不改 active），preserving atomic rollback.

## 要求 4：载器承载写通道登记为待裁决，守卫保持现状

**用户故事：** 作为基类层裁决者，我希望在 Q-04 未决前，引擎层的载器写通道不被基类层误接线、也不被错误推导成微型场景机制。

#### 验收标准

1. THE engine layer `container.enter` SHALL reject holding a living being into a surface that is NOT `category:'carrier'`（`E_OP_NOT_ACCEPTED`），and SHALL accept into a `category:'carrier'` surface.
2. THE base-layer vehicle rule SHALL keep rejecting any declaration that models the vehicle as a micro-scene (`modelsVehicleAsMicroScene` → `VEHICLE_NOT_MICRO_SCENE`), and SHALL keep rejecting `interiorMicroSceneBoundary` while Q-04 is undecided (`SOURCE_PROMOTION_REQUIRES_DECISION`)。
3. THE reconciliation 文档 SHALL register the「基类层 seat_binding/agent.bind + container.class.stationary 不建 `category:'carrier'` 面」落差为待裁决，提交 L2 线，不在本轮推导机制。

## 要求 5：地图锚点语义对齐 UGC §7.6

**用户故事：** 作为 UGC 文档权威，我希望引擎层地图锚点契约与「地图=玩法包一种、同 key 即替换、只在同 key 撞位不可替换」一致，不与 D-073 冲突。

#### 验收标准

1. THE engine layer map-anchor contract SHALL treat a map slot as non-replaceable only on same-key collision（按 ID 随机符号尾数区分），and SHALL let different-key maps load independently without mutual exclusion.
2. THE reconciliation 文档 SHALL align the anchor wording to UGC §7.6 and register the「`registerMapAnchor` 无消费端」接入缺口为交接项，提交 L2 线仲裁接入点。

## 要求 6：载具参数承载面登记为待裁决

**用户故事：** 作为基类层裁决者，我希望 `VEHICLE_PARAMETER_BINDING_GAP`（field-name 槽指向 profile 不存在的顶层 key）保持登记，在 Q-04 未决前不推导落槽机制。

#### 验收标准

1. THE reconciliation 文档 SHALL register the `moveApCost`/`cargoCapacity`/`occupantDisposition` 等顶层键缺失作为 Q-04 派生待裁决项，交接至 L2 线。
2. NO engine-layer change in this scope SHALL synthesize a binding surface for those fields.
