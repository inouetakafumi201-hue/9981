# 设计：wakeup-engine-layer（引擎层与基类层对账完备性规格）

## 概述

本设计把 `requirements.md` 的六条对账需求（R-A~R-E + 守卫）+ 一条完备性元需求（要求 7）落成可机械校验的正确性属性与守卫测试。设计聚焦让引擎层与基类层/对接层语义对齐回完备，**不改玩法逻辑、不越权改 `src/class/**`、不推导待裁决机制**。对每个验收标准做 prework 可测性分析 → 导出正确性属性（每条带 "对任意/对每一" 全称量化 + 要求回溯）→ 每属性恰好一个 PBT（fast-check ≥100 次，`Feature: wakeup-engine-layer, Property N` 注释）。

设计基线：`npx tsc --noEmit` 0、对账范围 `npx vitest run` 841 全过（2026-08-14 实测，覆盖五线相关套件）。

## 架构

对账按五条线 + 完备性自证线组织，改动面只落在引擎层/对接层，不跨层：

```
五线冲突/不对应 ──► 本轮改　(引擎/对接层)
   R-A 方向token ──► metrics.ts 建邻接 + Property6 守卫
   R-B 单调重定义 ──► package-mapping.ts 授权门 + effectiveOverrides + 守卫
   R-C 载器承载面 ──► 守卫保持现状 + 交接L2（不推导）
   R-D 地图锚点   ──► anchor.ts 措辞对齐 + Property4 守卫 + 交接L2
   R-E 载具参数面 ──► 交接L2（不推导）
                    └──► 全部交接项登记 reconciliation 文档，L2 线裁决
```

**关键架构原则**
1. **合规优先、不越权**：改动限制在 `src/core/kernel/**` + `src/play/map/**` + `src/l2/**` 的错误码/端口/守卫测试；`src/class/**` 及玩法数值一律不动。
2. **back-compat**：方向缺 token 回退 `directed`；`effectiveOverrides` 字段可选后向兼容。
3. **守卫防漂移**：对「Q-04 未决」的载器/载具行为用守卫测试锁现状，白盒封顶前机制不漂移。
4. **完备性自证**：要求↔属性↔PBT↔任务四向回溯完整。

## 组件和接口

### 1. 方向语义组件（R-A）
- **输入**：`Link`（含 `direction?: string` + 后向 `directed`）。
- **输出**：`buildAdjacency` 邻接表，`dist/spread/shortestPath/radius` 消费四值。
- **接口**：`src/core/kernel/topology/metrics.ts` `buildAdjacency`/`allowsTraversal`；`Link.direction` 四值透传已就位。
- **改动**：`allowsTraversal(link, fromA)` 按 `direction` 决定 b→a / a→b 是否允许；缺 token 用 `directed`。

### 2. 单调重定义端口组件（R-B）
- **输入**：`CandidateMappingInput` + 已授权包。
- **输出**：`CandidateMappingResult`（含 `effectiveOverrides`：本次活动被单调覆盖的定义 id 集）。
- **接口**：`src/l2/ugc/ports/package-mapping.ts` `checkChangeAuthorization` + `mapCandidatePackage`；`validation-gateway.ts` 透传 `effectiveOverrides` 入 `validateFullPackage`；`dependent-revalidation.ts` 用其 revalidateDependents。
- **改动**：同 key 且未声明 `overrideIntent` 不再 `REF_OVERRIDE_NOT_DECLARED`；保留 add/replace/remove 与声明一致的判据。

### 3. 载器承载面守卫组件（R-C）
- **输入**：容器 + 活体。
- **输出**：`container.enter` 接受/拒绝。
- **接口**：`src/core/kernel/ops/carrier-ops.ts`；`carrier.ts` `isCarrierSurface`。
- **守卫**：非 `category:'carrier'` 面拒绝 `E_OP_NOT_ACCEPTED`；carrier 面可进。交接 L2。

### 4. 地图锚点组件（R-D）
- **输入**：地图 ID（含随机符号尾数）。
- **输出**：`accept/reject(non-replaceable)/skip(no-reload)`。
- **接口**：`src/play/map/anchor.ts` `MapAnchorRegistry` + `registerMapAnchor`。
- **改动**：措辞对齐「同 key 撞位不可替换、异 key 互不排」。接入 compiler 交接 L2。

### 5. 载具参数承载面（R-E）
- **接口**：`known-divergences.ts` `VEHICLE_PARAMETER_BINDING_GAP`。
- **改动**：保持登记，交接 L2，不补数据不推导。

## 数据模型

### `CandidateMappingResult`（R-B 新增字段）
```typescript
interface CandidateMappingResult {
  readonly package: DefinitionPackage | null;
  readonly l2Diagnostics: readonly L2Diagnostic[];
  readonly portDiagnostics: readonly L2Diagnostic[];
  /** 本次活动被单调重定义覆盖的定义 id（同 key 后装即覆盖，D-073）；blocked 时为只读空数组。 */
  readonly effectiveOverrides: readonly string[];
}
```

### `Link.direction`（R-A，既有）
```typescript
direction?: 'bidirectional' | 'unidirectional' | 'one-way-down' | 'one-way-up';
directed?: boolean; // 后向兼容：direction 缺失时生效
```

## 正确性属性

*属性是一种特征或行为，应该在系统的所有有效执行中都保持真实。属性是形式正确性验证的基础：每个属性带「对任意/对每一」全称量化 + 要求回溯，并以恰好一个 fast-check 属性测试实现（≥100 次生成）。*

### 属性 1：方向可达性不对称
- **对任意** `one-way-down` 链接 `(a,b)`，`dist(a,b)` 可达、`dist(b,a)` 为 `null`；**对任意** `one-way-up` 链接，`dist(a,b)` 为 `null`、`dist(b,a)` 可达；**对任意** `bidirectional` 链接，两向可达。
- **验证：要求 1.1、1.2、2.1**
- **类型**：invariant（模板：方向链接上的可达性不变量）。
- **实现**：`engine-layer-map.property.test.ts` Property 6 用 `fc.constantFrom(四 token)` 生成任意图，对每个 token 断言 `dist` 双向往返。
- **迭代**：≥100（`fc.asyncProperty` + `maxNumIterations: 100`）。

### 属性 2：方向 back-compat
- **对任意** 只设 `directed`（无 `direction`）的链接，语义等于既有 `directed` 布尔（未定向双通、定向仅 a→b），且绝不因缺 token 报错。
- **验证：要求 1.3、1.4**
- **类型**：invariant。
- **实现**：`transform-ops.test.ts` link.create back-compat 用例（one-way-down/up 透传 + directed-only 回退）。
- **迭代**：≥1 确定性样例 + ≥100 生成（并入 Property 1）。

### 属性 3：单调重定义有效与原子回滚
- **对任意** 含同 key 覆盖的候选包，`checkChangeAuthorization` 不因未声明 `overrideIntent` 报 `REF_OVERRIDE_NOT_DECLARED`，激活结果为后装覆盖，且映射结果携带该覆盖的 `effectiveOverrides`；**对任意** 激活失败的候选，活动注册表与失败前逐字节一致（原子回滚）。
- **验证：要求 3.1、3.3、3.4、3.5**
- **类型**：model-based + error-condition。
- **实现**：`full-pipeline.integration.test.ts`（`effectiveOverrides` 用例）+ `schedule.test.ts` 单调覆盖/回滚属性。
- **迭代**：≥100。

### 属性 4：载器承载面接纳规则
- **对任意** 非 `category:'carrier'` 面 + 活体，`container.enter` 返回 `E_OP_NOT_ACCEPTED`、不产生半改状态；**对任意** `category:'carrier'` 面 + 活体（未超容量），`container.enter` 接受且 holds/slot 镜像成立、容量封顶、destroy 清槽。
- **验证：要求 4.1**
- **类型**：invariant + error-condition。
- **实现**：`carrier.property.test.ts` Property 1 半改状态 + Property 2b 容量。
- **迭代**：≥100。

### 属性 5：载器/载具守卫保持现状
- **对任意** 基类层载具声明，若 `modelsVehicleAsMicroScene` 为真，则拒 `VEHICLE_NOT_MICRO_SCENE`；若含 `interiorMicroSceneBoundary`，则拒 `SOURCE_PROMOTION_REQUIRES_DECISION`（Q-04 未决）。
- **验证：要求 4.2、4.3**
- **类型**：error-condition（现状守卫）。
- **实现**：`item-vehicle-rules` / `space-items-micro-scene-rules` 既有守卫测试确认保留。
- **迭代**：≥1 确定性样例。

### 属性 6：地图锚点同 key 撞位不可替换、异 key 互不排
- **对任意** 两个同 slot key 的地图，第二个装填返回 `non-replaceable` 拒绝；**对任意** 两个异 key 地图，可各自独立装载、互不排斥，`occupiedSlots.size` 等于已装唯一 key 数；释放后可重装；LLM 地图拒绝。
- **验证：要求 5.1、5.2**
- **类型**：invariant。
- **实现**：`engine-layer-map.property.test.ts` Property 4 多地图独立性。
- **迭代**：≥100。

### 属性 7：规格完备性自证
- **对每一** 验收标准，都遵循某一种 EARS 模式并 INCOSE 合规；**对每一** 可测标准恰好被一个属性验证；**对每一** 属性恰好被一个 PBT 实现（`Feature: wakeup-engine-layer, Property N` + ≥100 迭代）；**对每一** 实现任务回引其要求子句。
- **验证：要求 7.1-7.4**
- **类型**：model-based（文档结构模型）。
- **实现**：本规格自身 + tasks 引用可追溯；收尾 verify:docs 校验废用词/层级标签。
- **迭代**：文档静态校验（非数值 PBT）。

## 错误处理

- 方向 back-compat：缺 `direction` token 一律回退 `directed`，绝不报错（要求 1.3/属性 2）。
- 单调重定义：同 key 未声明 override 不再 `REF_OVERRIDE_NOT_DECLARED`；`REF_OVERRIDE_TARGET_MISSING`/`REF_REMOVAL_TARGET_MISSING`（add/replace/remove 与声明一致）保留（要求 3.2）。
- `E_OP_NOT_ACCEPTED`：非 carrier 面 `container.enter` 拒绝，既有，不改（属性 4）。
- 地图锚点：同 key 撞位 `non-replaceable`、no-reload 跳过（不报错）、异 key 互不排（属性 6）。
- 待裁决项全部交接 L2 线，不本 spec 合成承载面（要求 4.4、6.1、6.2）。

## 测试策略

### 双重测试
- **单元测试**（确定性样例）：link.create direction 透传 back-compat、`container.enter` 拒绝/接受、锚点同 key/异 key/释放/LLM、授权门同 key 覆盖。
- **基于属性的测试**（fast-check ≥100 次）：方向可达性（属性 1）、单调重定义+原子回滚（属性 3）、载器容量/半改（属性 4）、锚点多地图独立性（属性 6）。全部带 `Feature: wakeup-engine-layer, Property N` 注释。

### 三命令门禁 + 数据/文档门禁
每个任务后：`npx tsc --noEmit` 0、`npx vitest run`（相关范围）全过、`npm run lint` 0 error；收尾加 `npm run verify:data`（90 份 JSON 解析）+ `npm run verify:docs`（术语一致性）。

### PBT 配置
```typescript
const propertyConfig = { numRuns: 100, path: 'design.md', propertyId: 'Property 1', validates: 'Requirements 1.1,1.2,2.1' };
```
标签：`/** Feature: wakeup-engine-layer, Property N ... */`。
