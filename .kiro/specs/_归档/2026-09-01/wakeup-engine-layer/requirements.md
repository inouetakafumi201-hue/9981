# 需求：wakeup-engine-layer（引擎层与基类层对账完备性规格）

## 简介

本项目针对引擎层（`src/core`、`src/play/map`、`src/l2`）与基类层/对接层之间的**冲突与不对应**做一次全量审查，产出**行为可验证的完整规格**：以 EARS 模式 + INCOSE 质量规则写下每一条需求，Design 阶段用 prework 可测性分析导出正确性属性，Tasks 阶段拆成带检查点与 PBT 子任务的可执行步骤，最终三层语义对齐回完备。本规格的**首要交付物是完备性本身**——每一条需求都明确、可测、可回溯，而不是只交付代码改动。

权威事实源：宪法（第十一条「文档即权威」）、基类层空间系统（`03_空间系统.md` / UGC `06_UGC系统.md` §7.6）、既有裁决（D-038/D-072~D-079/Q-04）。实现语言 TypeScript，测试库 fast-check（PBT 均 ≥100 次生成，带 `Feature: wakeup-engine-layer, Property N` 注释）。

审查核实的五条线：

| # | 主题 | 判定 |
|---|---|---|
| R-A | 方向 token 布尔化丢失（`metrics.ts` 只消费 `directed`） | 真冲突，本轮修 |
| R-B | 单调重定义装载（UGC 授权门 `REF_OVERRIDE_NOT_DECLARED` 拒同 key 后装） | 真冲突，本轮修 |
| R-C | 载器承载活体写通道（`container.enter/exit` 已落地、基类层未建 `category:'carrier'` 面） | 待裁决，登记交接 |
| R-D | 地图锚点（`anchor.ts` 无消费端、措辞需对齐 UGC §7.6） | 待对齐，措辞修 |
| R-E | 载具参数承载面（`field-name` 槽指向 profile 缺失顶层 key） | 待裁决，登记交接 |

## 原则

1. **不越权**：不跨 Spec 改基类层交付物（`src/class/**`）；方向扩值、载器接线、载具参数、地图锚点接入一律交接至 L2 基类层线，不在本轮越权改。
2. **不改玩法逻辑**：不改任何玩家可见数值（数值铁律 1-5）、不加新玩法机制；只让两层语义对齐回完备。
3. **Q-04 未决不推导**：载器接线属待裁决，不推导载器机制、不把载具当微型场景。
4. **本规格的完备性即交付物**：要求→设计→任务严格顺序，每条要求有 EARS 验收标准，每个可测标准被正确性属性覆盖，每个属性被一个 PBT 实现，每个任务可回溯到要求。

## 术语表

- **方向 token**：`Link.direction?: string` 的四值——`'bidirectional' | 'unidirectional' | 'one-way-down' | 'one-way-up'`。
- **单调重定义**（D-073）：同 key 的包后装覆盖先装，`findConflicts` 返回 `[]`；异 key 追加。
- **`category:'carrier'` 承载面**：可用 `container.enter/exit` 收纳活体生命体的容器面（`isCarrierSurface`）。
- **地图锚点位**：按地图 ID（命名 + 随机符号尾数）占据的 map 装载位；同 key 撞位不可替换、异 key 互不排。
- **EARS**：Easy Approach to Requirements Syntax，六种需求句式模式。
- **INCOSE**：国际系统工程理事会，需求质量规则。
- **PBT**：Property-Based Testing，基于属性的测试。
- **D-038 / Q-04**：既有裁决——载具不是微型场景；载具内部是否微型场景待裁决。

## 要求

### 要求 1：方向 token 语义在引擎层修通

**用户故事：** 作为引擎层实现者，我希望 `dist/spread/shortestPath/radius` 真正消费 `Link.direction` 的四值语义，以便 `one-way-down`/`one-way-up` 不再被压成无差别单向。

#### 验收标准

1. [Ubiquitous] THE engine-layer topology metrics SHALL build its adjacency by consuming `Link.direction` so that a `'one-way-down'` link disables the b→a traversal while keeping a→b, and a `'one-way-up'` link disables the a→b traversal while keeping b→a.
2. [Ubiquitous] THE metrics SHALL retain the existing semantics of `'bidirectional'` (both a→b and b→a) and `'unidirectional'` (only a→b).
3. [Event-driven] WHEN a link has no `direction` token, THEN the metrics SHALL fall back to the `directed` boolean so that legacy `Link` values keep their existing behavior without error.
4. [Unwanted-event] IF the direction handling changes the reachability of any existing unidirectional link, THEN the metrics SHALL not do so silently; the fallback path is exercised by a guard test.
5. [Ubiquitous] THE change SHALL NOT alter any player-visible numeric value; direction affects only reachability/traversal, not cost magnitude (values stay in the 1-5 band where player-visible).

### 要求 2：方向 token 数据面一致（守卫）

**用户故事：** 作为引擎层实现者，我希望守卫测试锁定「one-way-down 反向不可达、one-way-up 正向不可达」，以便 metrics 的未来改动不会再度把方向压成布尔。

#### 验收标准

1. [Ubiquitous] The guard property SHALL assert that, for a `'one-way-down'` link, `dist` from a to b is reachable and from b to a is `null`; SHALL assert the reverse for `'one-way-up'`.
2. [Ubiquitous] The guard property SHALL exercise at least one real traversal metric (`dist`/`spread`/`shortestPath`/`radius`) against all four direction tokens.
3. [Ubiquitous] The guard property SHALL run at least 100 generated iterations and SHALL carry the `Feature: wakeup-engine-layer, Property N` tag.

### 要求 3：单调重定义装载在 UGC 授权门统一

**用户故事：** 作为 UGC 实现者，我希望同一个「同 key 再装」在引擎层 `PlaypackLoader`（D-073 后装覆盖）与 UGC 端口授权核对（`package-mapping.ts`）语义一致，以便玩家上传后继包不再被 `REF_OVERRIDE_NOT_DECLARED` 误拒。

#### 验收标准

1. [Ubiquitous] THE UGC port `checkChangeAuthorization` SHALL treat a same-key redefinition as valid under the monotonic model and SHALL NOT reject it with `REF_OVERRIDE_NOT_DECLARED` merely because no `overrideIntent` was declared.
2. [Ubiquitous] THE diagnostics that guard add/replace/remove operations against declared `overrideIntent`/`removals` (`REF_OVERRIDE_TARGET_MISSING` / `REF_REMOVAL_TARGET_MISSING`) SHALL be preserved.
3. [Event-driven] WHEN the candidate redefines an active key (monotonic override), THEN the mapping result SHALL surface that override via `effectiveOverrides` so that `revalidateDependents` can re-validate active dependents.
4. [Event-driven] WHEN an activation fails, THEN the definition registry SHALL retain the previous active set unchanged (atomic rollback, `activate` mutates candidates only).
5. [Ubiquitous] THE engine layer `defRegistry` SHALL keep activating a same-key candidate as a later-loaded override (Map.set), and the port guard SHALL NOT block it before activation.

### 要求 4：载器承载写通道登记为待裁决，守卫保持现状

**用户故事：** 作为基类层裁决者，我希望在 Q-04 未决前，引擎层的载器写通道不被基类层误接线、也不被错误推导成微型场景机制。

#### 验收标准

1. [Event-driven] WHEN `container.enter` targets a surface that is NOT `category:'carrier'` holding a living being, THEN it SHALL reject with `E_OP_NOT_ACCEPTED`; WHEN it targets a `category:'carrier'` surface, THEN it SHALL accept.
2. [Ubiquitous] The base-layer vehicle rule SHALL keep rejecting any declaration that models the vehicle as a micro-scene (`modelsVehicleAsMicroScene` → `VEHICLE_NOT_MICRO_SCENE`).
3. [Ubiquitous] The base-layer vehicle rule SHALL keep rejecting `interiorMicroSceneBoundary` while Q-04 is undecided (`SOURCE_PROMOTION_REQUIRES_DECISION`).
4. [Ubiquitous] THE reconciliation document SHALL register the「基类层 `seat_binding`/`agent.bind` + `container.class.stationary` 不建 `category:'carrier'` 面」gap as a pending decision, handed to the L2 line, and SHALL NOT derive a carrier mechanism this round.

### 要求 5：地图锚点语义对齐 UGC §7.6

**用户故事：** 作为 UGC 文档权威，我希望引擎层地图锚点契约与「地图是玩法包的一种、同 key 即替换、只在同 key 撞位不可替换」一致，不与 D-073 冲突。

#### 验收标准

1. [Event-driven] WHEN two distinct maps share the same slot key, THEN the anchor SHALL reject (non-replaceable); WHEN the keys differ, THEN the anchor SHALL load both independently without mutual exclusion.
2. [Ubiquitous] THE anchor wording SHALL express that same-key-collision non-replaceability, not absolute non-replaceability, aligning with UGC §7.6.
3. [Ubiquitous] THE reconciliation document SHALL register the「`registerMapAnchor` 无消费端」integration gap as a handoff to the L2 line for the anchor point decision.

### 要求 6：载具参数承载面登记为待裁决

**用户故事：** 作为基类层裁决者，我希望 `VEHICLE_PARAMETER_BINDING_GAP`（`field-name` 槽指向 profile 不存在的顶层 key）保持登记，在 Q-04 未决前不推导落槽机制。

#### 验收标准

1. [Ubiquitous] THE reconciliation document SHALL register the `moveApCost`/`cargoCapacity`/`occupiedDisposition` etc. missing top-level keys as a Q-04-derived pending decision, handed to the L2 line.
2. [Ubiquitous] NO engine-layer change in this scope SHALL synthesize a binding surface for those fields.

### 要求 7：规格完备性自证

**用户故事：** 作为规格审查者，我希望这条对账规格本身具备 EARS/INCOSE 合规、可测性分析与要求的双向回溯，以便证明「完备性」而非仅交付代码。

#### 验收标准

1. [Ubiquitous] EVERY acceptance criterion in this document SHALL follow one of the six EARS patterns and SHALL be INCOSE-compliant（主动语态、无模糊术语、单想法、无免责条款）.
2. [Ubiquitous] EVERY testable acceptance criterion SHALL be validated by exactly one correctness property in design.md.
3. [Ubiquitous] EVERY correctness property SHALL be implemented by exactly one property-based test, tagged `Feature: wakeup-engine-layer, Property N`, with ≥100 iterations.
4. [Ubiquitous] EVERY implementation task SHALL reference the requirement clause(s) it satisfies.

---

_要求 1-6 为功能/守卫需求（对账内容），要求 7 为规格自身的完备性元需求。编号连续、每表含 EARS 模式标注与 INCOSE 落点。_
