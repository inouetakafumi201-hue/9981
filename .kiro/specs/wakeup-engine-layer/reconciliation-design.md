# 设计：wakeup-engine-layer 基类层对账（reconciliation）

> 本设计不改任何既有权威文档本体，只按宪法第十一条（文档即权威）与 D-060（不跨 Spec 改交付物、登记+提请裁决）把引擎层与基类层/对接层的冲突与不对应落成方案。撰写日期 2026-08-14。
> 基线：引擎层批落地后 `tsc 0 / vitest 3018 全过 / lint 0 error`。
> 前提（用户重申）：不在引擎层炸锅——白盒正积极封顶，本轮先让两层语义对齐回完备；玩法逻辑未变，理想情况只改对接层一层。

## 一、审查结论矩阵（代码核实）

| # | 主题 | 判定 | 引擎层现状 | 基类层/宪法权威 | 处理 |
|---|---|---|---|---|---|
| 1 | 载器承载活体写通道 | 待裁决（接线缺口） | `container.enter/exit` 落地（`src/core/kernel/ops/carrier-ops.ts`），要求目标是 `category:'carrier'`，`carrier.ts` 定义承载面 | 基类层用 `seat_binding`（`agent.bind`）+ `container.class.stationary`，**不建 `category:'carrier'` 面**；Q-04 未决 | §2 待裁决/交接 L2 |
| 2 | 方向 token 布尔化丢失 | 真冲突 | `Link.direction?: string` 四值已透传，但 `metrics.ts:29` 只消费 `directed` 布尔；`map/validate + map/types` 四态开放 | `scenes/index.json` + `family-contracts.ts:243` 两态；权威 L2/03 空间系统含 one-way-down/up | §4 本轮修 metrics + 守卫；扩值交接 |
| 3 | 单调重定义装载 | 真冲突 | `playpack.ts` findConflicts 返空（D-073 后装覆盖）；`definition-registry` Map.set 后装覆盖 | UGC `package-mapping.ts:155/160` 仍 `REF_OVERRIDE_NOT_DECLARED` 拒同 key | §5 本轮改 UGC 授权门对齐 |
| 4 | 地图锚点 | 待对齐（无冲突） | `anchor.ts` 已落地，`registerMapAnchor` 无消费端 | UGC §7.6（地图=玩法包、同 key 即替换、只在同 key 撞位不可替换） | §6 措辞对齐 + 交接接入 |
| 5 | 载具参数承载面 | 待裁决（依赖 Q-04） | — | `VEHICLE_PARAMETER_BINDING_GAP`（field-name 槽指向缺失顶层 key） | §7 登记待裁决 |

## 二、载器承载活体：待裁决（不动机制）

**当前状态（代码核实）**：引擎层 `container.enter`/`container.exit` 是「让活体进容器承载槽」的唯一写通道（`carrier-ops.ts`），判定依据 `category:'carrier'`（`carrier.ts isCarrierSurface`）。基类层载具把乘员表达为 `seat_binding`（`agent.bind`）、货舱引用 `container.class.stationary`，**没有任何基类层能力会建造 `category:'carrier'` 承载面**。因此写通道已备、基类层未接线——这是接线缺口而不是语义错误。

**裁决选项（交接至 L2 基类层线）**：
- 选项 A：载类能力（`vehicles/index.json`）补充 `category:'carrier'` 承载面语义，seat/cargo 槽用 `container.enter/exit`。
- 选项 B：在 `src/l2` 对接层把 `agent.bind` ↔ `container.enter` 收纳对齐（不改 `src/class/**`、不改玩法）。
- 预判：选项 B 更符合「只改对接层一层」愿景，但需裁决 seat_binding 与承载槽谁当真相源——**不在本轮拍板**。

**守卫（C2，防止白盒封顶前漂移）**：
- `container.enter` 对非 `category:'carrier'` 面拒绝 `E_OP_NOT_ACCEPTED`。
- `container.enter` 对 `category:'carrier'` 面可进活体。
- 基类层 `item-vehicle-rules` 对 `interiorMicroSceneBoundary` 仍拒 `SOURCE_PROMOTION_REQUIRES_DECISION`（Q-04 未决），`space-items-micro-scene-rules` 对 `modelsVehicleAsMicroScene` 仍拒 `VEHICLE_NOT_MICRO_SCENE`。

## 三、数据流

地图方向：`MapData.directionality`(四值) → `linkSpecOf`(保留 `direction`，不压布尔) → `PrefabDef.links[].direction` → `prefab.spawn` 透传 → `Link.direction` → **本轮改动点** `metrics.ts` 建邻接按 `direction` 定向。

单调重定义装载：候选包同 key → `validation-gateway` → **本轮改动点** `package-mapping.checkChangeAuthorization`（同 key 不再 `REF_OVERRIDE_NOT_DECLARED`）→ `definition-registry.activate`（Map.set 覆盖，原子，失败回滚 active）。

## 四、方向语义（本轮改动：metrics 消费 direction）

`buildAdjacency`（`metrics.ts:20-34`）当前：
```
adjacency.get(a).push(b);            // a→b 恒有向边
if (!link.directed) adjacency.get(b).push(a);  // 仅未定向时加 b→a
```
**改为**：按 `Link.direction` 决定是否加反向边。
- `direction === 'one-way-up'`：只加 b→a（禁用 a→b），语义「从上方到下方」。
- `direction === 'one-way-down'`：只加 a→b（禁用 b→a），语义「从下方到上方」——a→b 恒在，等于不加反向。
- `direction === 'bidirectional'` / 无 token + `directed !== true`：a→b 与 b→a 都有（现有行为）。
- `direction === 'unidirectional'` / 无 token + `directed === true`：只 a→b（现有行为）。

**back-compat 铁律**：`direction === undefined` 时必须回退 `directed` 布尔，保证存量 `Link`（只设 directed）语义不变。现有 `engine-layer-map.property.test.ts` Property 6 已有「one-way-down/up 在 adjacency 中被正确识别为有向」断言需随之扩展为「可达性不对称」。

> **交接项（A3，不在本轮执行）**：方向 token 扩基类层值集两态→四态（`src/class/scenes/index.json` `transition_directionalities` + `src/l2/model/family-contracts.ts` `TRANSITION_DIRECTIONALITIES`）提交 L2 基类层线。本轮 metrics 已对齐四 token 语义，白盒侧接线即可。

## 五、单调重定义（本轮改动：UGC 授权门对齐）

**`package-mapping.ts` `checkChangeAuthorization`**（L145-244）：
- 判据 1「未声明覆盖」（L153-169）：`filter(id => activeDefinitionIds.has(id) && !declaredOverrides.has(id))` 报 `REF_OVERRIDE_NOT_DECLARED`——**这与 D-073 相反**（同 key 即重定义，无需声明）。改法：不再把「同 key 且未声明 overrideIntent」当冲突；同 key 即合法重定义，放行到 activate 的 Map.set 覆盖。
- 判据 2（`REF_OVERRIDE_TARGET_MISSING`/`REF_REMOVAL_TARGET_MISSING`）与判据 3（删除目标不存在）：**保留**——它们守 add/replace/remove 操作与 `overrideIntent`/`removals` 声明的一致性，与 D-073 无关。`operation === 'add'` 却声明 override/removal 仍拒（add 不授权修改既有定义）。
- `operation === 'replace'` 要求声明 override/removal 的判据：保留（显式 replace 语义仍要求明确目标），但这不覆盖「玩家上传 LLM 产物未声明 override」的单调重定义场景——该场景 `operation` 应为 add（新增定义含同 key 时按单调覆盖走）。

**引擎层 `playpack.ts`**（B3）：`findConflicts` 已返空（`:191-198`），`:110-112` 的循环是死分支（恒不命中），清理掉避免误导。`playpack-runtime.ts:150` 的 PoolDef 撞名是**命名空间不同**的语义（PoolDef name 而非 def key），不属于 D-073 清范围，**保留**。

**原子性**（B4）：`definition-registry.activate` 只构造新 `definitions` Map（L136-143），不动 active，失败走 `structuredRejection`（L131-133）。守卫测试确认失败时 previous active 不变。

## 六、地图锚点（措辞对齐，不动语义）

`anchor.ts` 已实现「同 key 不可替换 / 异 key 不互排 / 释放后可重装 / LLM 地图拒绝」，与 UGC §7.6（地图=玩法包、同 key 即替换、只在同 key 撞位不可替换）一致。改动：
- 措辞对齐：`anchor.ts` 头注释与拒绝消息明确「非绝对不可替换，仅在同 key 撞位时 non-replaceable，异 key 按 ID 尾数各自独立」。
- `registerMapAnchor` 接入 compiler/运行时的缺口**交接至 L2 线**（接入点裁决），本轮不接。

## 七、载具参数承载面（登记待裁决）

`VEHICLE_PARAMETER_BINDING_GAP`（`known-divergences.ts:110`）已登记 field-name 槽指向缺失顶层键（`moveApCost`/`cargoCapacity`/`cargoAccessibleFrom`/`cargoAccessApCost`/`occupantDisposition`/`cargoDisposition`）。这是 Q-04 的派生项：载具内部承载机制未决，能力参数承载面自然无处落槽。**保持登记**，交接 L2 线，本轮不推导。

## 八、正确性属性（守卫，均带 Feature 注释 + ≥100 次生成）

- **属性 6 扩展（方向可达性不对称）**：对任意 `one-way-down` 边，`dist(a,b)` 可达、`dist(b,a)` 为 `null`；`one-way-up` 相反；`bidirectional` 两向可达。
- **属性 3 扩展（单调重定义 + 原子性）**：任意按序装载的包序列，同 key 后装覆盖先装、异 key append；激活失败时活动注册表与失败前逐字节一致（回滚）。
- **属性 4（载器载体）**：非 `category:'carrier'` 面 `container.enter` 拒绝 `E_OP_NOT_ACCEPTED`；`category:'carrier'` 面可进。
- **属性 5（地图锚点）**：同 key 撞位不可替换（或 no-reload 跳过）、异 key 不互排、释放后可重装、LLM 地图拒绝。

## 待裁决项（均交接 L2 基类层线，所有者拍板）

1. 载器承载面如何接线（选项 A/B）。
2. Q-04 载具内部是否微型场景（接口交互点未决）。
3. VEHICLE_PARAMETER_BINDING_GAP 落槽方式。
4. 地图锚点接入 compiler/运行时的消费端。
5. 方向 token 扩基类层值集（scenes/index.json + family-contracts）。

## 基类层影响面审查结论（2026-08-14 追加）

审查三项引擎层改动对基类层的耦合后，判定与已落地代价：

- **方向/metrics**：基类层（`src/class`、`src/l2`）**不消费** `metrics.ts`；`dist/spread` 仅供内核 expr 路径与 `src/play/map`。真冲突只在对接面：`link.create` 交互 Op 之前只认 `directed` 布尔、造不出 one-way-down/up 边（map/prefab 路径已透传）。本轮给 `makeLinkCreate` 补 `direction?: string` 透传，统一"能产出完整方向 token 的唯一通道"。
- **单调重定义**：发现一处基类层真实缺口——`dependent-revalidation.ts` 只随 `overrideIntent` 走，去掉 UGC 端口对同 key 冲突的门后，**不挂 overrideIntent 的同 key 覆盖不再触发对活动依赖者的类型兼容重校验**，会让活动依赖静默破坏。解决方案：`package-mapping` 新增 `effectiveOverrides`（本次候选实际覆盖的活动 id 并集 = 同 key + 显式 intent），经 `validateFullPackage` → `revalidateDependents` 重校验；并为它新增对外码 `E_LOAD_OVERRIDE_INVALIDATES_DEPENDENT`（此前该码"已声明零产出"，P10 子句曾因它 skip）。`mapCandidatePackage` 与 `validateFullPackage` 保持向后兼容（新字段全部可选）。
- **carrier / 载具参数面 / 地图锚点**：对基类层**无数据/配置影响**。carrier 是引擎层已落地、基类层从不知晓的面；基类层仍用 `seat_binding`+`agent.bind`+`container.class.stationary`（物品槽），`interiorMicroSceneBoundary` 的三处 Q-04 拒绝/保留守卫必须保持。`VEHICLE_PARAMETER_BINDING_GAP` 登记不变（audit 已 `vehicles:''` 短路）。地图锚点零基类层耦合。

**基类层原语义保持点**：Q-04 未决即不把载具当微型场景、不采用 carrier 槽承载活体；同 key 覆盖不静默破坏活动依赖；`link.create` 不传方向时语义与旧 `directed` 完全一致。

## 错误处理

- 本轮改动不新增错误码；`REF_OVERRIDE_NOT_DECLARED` 从「同 key 单调场景」退出，但仍在「add 却声明 override」「判别健」诊断路径保留（`diagnostic-projection.ts:120` 映射保留）。
- `E_OP_NOT_ACCEPTED`（carrier 拒非 carrier 面）既有，不改。
- 方向 back-compat：无 `direction` token 回退 `directed`，绝不因缺 token 报错。
