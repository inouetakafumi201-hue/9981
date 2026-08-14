# PT-12：玩法层 ↔ 基类层 ECS 对接（全面规划）

> **前置依赖**：PT-11（基类层 ECS 收敛）已完成，`composition-registry.ts` / `family-component-shapes.ts` /
> `composition-alignment-rules.ts` 落地且门禁全绿；`src/class` 契约校验在 `class-contract.ts`。
> 本线是 PT-11 的前置结论（`src/l2/决策与风险记录.md` §7）的落实：**基类层 ↔ 玩法层当前只登记了交接项 H-ECS-06/07，
> 没有机器闭合的消费者**。本线把它们做成一份可并行展开的完整规划，符合宪法第三条（L1/L2/L3 分层）、
> ECS 规范（基类层 = 语义组件类型库 + System 接线契约）与数值铁律 1-5。
> **生成时间**：2026-08-14
> **方法依据**：`docs/00_并行作战手册.md` §六、`docs/L_归档/steering_历史/PARALLEL_EXECUTION_LOCK.md` 锁纪律。

---

## 〇、交付口径（务必先读）

本文件是 **planning artifact（规划 + 交接项）**，不是已实现的对接代码。规划把 `src/play` 与 `src/class` 列为
**写到代码时的白名单**，但**本次交付不放开这两处写权**：

- PT-11 的权威白名单仅 `src/l2/model/**`、`src/l2/validation/**`、`.kiro/specs/wakeup-base-layer-ecs/**`；
  `src/class/**` 与 `src/play/**` 是黑名单（PT-11 §四/§五），且 `src/play/**` 归 Wave 4/PT-07，跨线改他人交付物违反
  「不跨 Spec 改他人交付物」纪律。
- 因此本次交付的实际产出 = **本规划 + 交接项（H-ECS-06/07 + PT-12 自我交接）**，不包含 `class-contract.ts` / `catalog.ts` /
  `audit.ts` 的接线代码，也不新增 `src/play`/`src/class` 的测试与 PBT。
- 若用户明确放开 `src/play` 与 `src/class` 的写权，本规划 §五/§六/§八可直接作为下一批次的派发 prompt：按任务 1→4→5
  顺序落地代码、集成与 PBT 守卫，届时「对接实现 + PBT」才闭环。
- 未获授权前，「对接」一律按**规划 + 交接项**口径交付，不宣称已实现。

---

## 一、背景与意图

PT-11 把基类层收拢成 ECS 形状：`component.*` 组件契约单一源、`compositionKind` 四形、`kernelOps` System 接线、
vehicle 降级为组合型组件族。但它只做了**基类层内部**与**基类层→引擎层**的衔接。真实对账暴露两个未闭合缺口：

1. **`src/play` 零依赖 `src/l2`。** 全量 grep 无一条 `src/play → src/l2` import。玩法层从
   `src/class/*/index.json`（经 `src/play/profiles/catalog.ts` 的 `readCompositionContract`）读组合契约来校验，
   不消费 ECS 的 `composition-registry` / `family-component-shapes`。
2. **`src/class/class-contract.ts` 不认识 ECS。** 其 `CAPABILITY_ENTRY_KEYS` 只有
   `id/name/description/parameters/kernelOps/mutuallyExclusiveWith/writeChannelContract` 七键，
   **无 `compositionKind` / `familyId` / `playLayerOwnedFieldNames`**。ECS 的 `ComponentContract`（含四形/家族）
   与 `class-contract.ts`（真实目录校验链）是**两套并列的契约模型**，无接缝。

**本线的意图**：把玩法层设计成「组合+填数值」的正统 L3 层，同时让 ECS 的组件契约在玩法层侧也可机检。
它既不是玩法功能（不定义具体游戏），也不是基类层内容（不改 `src/class` 目录），而是**接线与机检**——
把「组件契约单一源 + compositionKind 四形 + kernelOps 接线 + playLayerOwnedFieldNames 数值归属」这条
被 PT-11 只在基类层建立的规则，延伸到 play→class 的真实组合路径上，并加 PBT 守卫锁定不回归。

## 二、权威依据（先读）

- `docs/并行作战/PT-11_基类层ECS收敛.md`（PT-11 白名单/黑名单、交接项、DoD）
- `.kiro/specs/wakeup-base-layer-ecs/{requirements,design,tasks}.md`（ECS 收敛权威）
- `docs/L0_规范宪法.md` 第三条（三层约束）、第四条（1-5 数值铁律）
- `src/l2/决策与风险记录.md` §7（本次对账结论与 H-ECS-06/07）
- `src/l2/model/composition-registry.ts`（`ComponentContract`、`playLayerOwnedFieldNames`）
- `src/l2/model/family-component-shapes.ts`（8 族组件形状、`COMPOSITION_REGISTRY`、`ALL_FAMILY_SHAPES`）
- `src/l2/validation/composition-alignment-rules.ts`（`validateCompositionAlignment`、`SYSTEM_BINDING_*`/`COMPOSITION_KIND_*`）
- `src/class/class-contract.ts`（真实目录契约校验链、`CAPABILITY_ENTRY_KEYS`、`CLASS_ENTRY_KEYS`、`compositionContract`）
- `src/class/schemas/class-catalog.schema.json`（`capabilityEntry`/`classEntry`/`compositionContract` schema）
- `src/play/profiles/catalog.ts`（`CompositionContract` 读取、`ClassLayerIndex`、`readCompositionContract`）
- `src/play/profiles/audit.ts`（`auditClassLayerReferences`、`auditCapabilityScope`、`PLAY-REF-*` 码）
- 既有测试范例：`test/l2/properties/*`（PBT 先例）、`src/play/__tests__/capability-binding.test.ts`（play 侧守卫先例）

## 三、就绪确认（开工前必须全部满足）

- [x] PT-11 已交付，`composition-registry`/`family-component-shapes`/`composition-alignment-rules` 全绿
- [x] `writeChannelContract` 唯一写通道常量两端一致（`parseCapability` = ECS `{channel:'OpRegistry.invoke',alternateChannels:'none'}`）
- [x] `compositionContract.playLayerOwnedFieldNames` 已在 `actions/items/vehicles/...` 的 `index.json` 存在（字段在、链路未接）
- [x] `src/play/profiles/catalog.ts` 已读 `compositionContract` 的 `classReferenceField`/`capabilityReferenceField`/`playLayerOwnedFieldNames`
- [x] 工具链状态已核验（`tsc`/`typecheck:l2`/`lint`/`verify:docs`/`verify:data` 基线）

## 四、并行边界判断（本线的关键纪律）

本线涉及**两条既有权威校验链**与**一个消费层**，必须先判能否并行，再向下拆批。

**共享资源冲突判断：**

| 写目标 | 权威所有者 | 冲突对象 |
|---|---|---|
| `src/l2/model/**`（ECS 组件契约扩展，如 familyId 常量） | ECS（本线延展） | 无其它线 |
| `src/class/class-contract.ts`（加 ECS 字段校验） | 型号契约线 | **不可与其它写 `src/class` 的线并行** |
| `src/class/schemas/class-catalog.schema.json` | 型号线 | 同上 |
| `src/play/**` | Wave 4/PT-07 专属 | **不可与 Wave 4 并行** |
| `test/l2/ecs/`（集成+属性测试） | 本线 | 无其它线 |
| `test/play/` 或 `src/play/__tests__/` 新增 guard | 本线 | 依赖 play 改动落地 |

**结论：稳定并行必须满足「本线独占 `src/class/class-contract.ts` + `src/class` schema + `src/play/**` 的写权」**，
且不与 Wave 4（PT-07）、PT-08b 共享可写资源。三批：A=ECS 契约模型侧接线（可在无其它线碰 `src/class` 时与 B 并跑，但
**B 改 `src/class`、A 只读引用它，A 应等 B schema 定型后再消费**）；B=class-contract + schema（`src/class` 写权）；C=play 消费端 + guard。
A 可先行，但 B/C 必须在无 Wave 4 / PT-08b 改动 `src/class` / `src/play` 的窗口内执行。

## 五、白名单（本线允许修改的路径）

### 5.1 生产代码

```
src/l2/model/composition-registry.ts        # 已存在；扩展：导出 familyId 常量供跨层复用（只追加，不改既有签名）
src/l2/model/index.ts                        # 已存在；补导出（如确实新增常量）
src/class/class-contract.ts                  # 扩展 capabilityEntry/classEntry 校验支持 compositionKind(四形)+familyId；
                                             #   可把 CAPABILITY_ENTRY_KEYS/CLASS_ENTRY_KEYS 增补（向后兼容：既有目录缺省字段合法）
src/play/profiles/catalog.ts                 # 扩展 CompositionContract 读取 playLayerOwnedFieldNames 语义对照（已读；补 compositionKind 归一）
src/play/profiles/audit.ts                   # 扩展 audit：组件 id 归一(component.* 或 capability.*)、CaS 缝隙、playLayerOwned 越界
```

### 5.2 测试代码

```
test/l2/ecs/link-to-play.integration.test.ts   # 新增：ECS 组件契约 ↔ play/class 组合路径的集成测试
test/l2/properties/ecs-play-alignment.property.test.ts  # 新增：玩法↔基类层对齐 PBT（见 §8）
src/play/__tests__/ecs-alignment-guard.test.ts  # 新增：play 侧守卫（借既有 capability-binding 先例）
```

### 5.3 文档记录

```
src/l2/决策与风险记录.md                        # 追加「PT-12 对账」小节：证据表、H-0N 自主判断、交接项
docs/并行作战/PT-12_玩法层对接ECS.md               # 本文件
```

## 六、黑名单（本线禁止修改的路径）

### 6.1 跨 Spec / 他线边界（修改需写交接项）

```
src/play/**（非本线新增文件）；src/class/*/index.json 目录内容    # 目录数据不变；只改校验入口与消费端
src/core/kernel/**         # 引擎层，不得新增 Op / 错误码 / Hook
src/core/ugc/**            # UGC 系统，PT-10 专属
src/ui/**                  # 表现系统，PT-09 专属
```

### 6.2 共享工具链配置（不得改动）

```
tsconfig*.json / vitest.config.ts / package.json / .eslintrc.cjs
```

### 6.3 既有约束

```
src/l2/validation/{spatial-rules,item-vehicle-rules,classification-rules,...}.ts  # 只读；改需写明相关性
src/class/*/index.json 中既有 compositionContract 字段名      # 读，改走交接项
```

## 七、行为契约（执行纪律）

### 7.1 不做 MVP、不特殊化

- 不得交付占位实现、`TODO`、`@ts-ignore` / `@ts-expect-error` 绕过。
- 不得为了让测试通过而对特定输入打针对性的补丁。
- PBT `numRuns ≥ 100`，不带 `skip`/`todo`，`Feature: wakeup-base-layer-ecs-friendly, Property N` 标签。

### 7.2 串行门禁（批次执行）

```
0（基线核验：读 §二/§三 + git status 确认 src/class 与 src/play 无未提交冲突变更）
  └─ 1（ECS 契约模型侧接线：composition-registry 常量导出、index 导出）——可先行
       ├─ 2（class-contract + schema：支持 compositionKind/familyId 解析与校验）——独占 src/class 写权
       │    └─ 3（play 消费端 + guard：audit/catalog 接上 ECS 组件契约归一与数值归属校验）
       └─ 4（测试：集成 + play 侧 guard PBT + ECS 对齐 PBT）
            └─ 5（全量门禁 + 文档纪律守卫 + 证据表/交接项 + 登记）
```

- 任务 2 与任务 3 依赖任务 1 的契约承载，故在任务 1 后；任务 3 依赖任务 2 的 `class-contract` 扩展，故在其后。
- **任务 5 必须等任务 4 全部通过**，不得用"大部分通过"宣称完成。
- 凡任务 1/2/3 需要改动 `src/play` 或 `src/class` 目录数据时，属越权，改写成 H-题-0N 交接项，不由本线改。

### 7.3 工具链纪律

- 每完成一个任务运行 `npm run typecheck && npm run typecheck:l2 && npm test && npm run lint`。
- 任一命令失败则修复后才继续；既有红灯（`combat-first.test.ts` 7 处、`bombardment-*` 4 处）用
  `git diff --name-only` 核实非本线引入即视为已隔离验证。
- 不得通过过滤、skip、改断言、缩小范围或降低 severity 掩盖失败。
- 诊断码纪律：新增对齐校验码映射到既有 `diagnostic-codes.ts` 成员或既有结构化家族；确无既存码则登记并写交接项。

### 7.4 诊断码纪律

对齐校验优先复用既有发射码：`VALUE_L3_OWNERSHIP`（玩法层越界）、`SYSTEM_BINDING_*` / `COMPOSITION_KIND_*`（ECS 已登记）、
`PLAY-REF-*`（play 侧既有）。确需新增再进 `src/l2/model/diagnostic-codes.ts`（白名单内登记 + 回流裁决入口），
不得用 `E_LOAD_UNRESOLVED_CONTRACT` 兜底。

### 7.5 不跨 Spec 改他人交付物

- 目录数据（`src/class/*/index.json`、`src/play/profiles/*`）不改；只改校验入口。
- 发现职责重复先判结构 vs 接口，结构问题登记提裁决，不用适配器绕过。
- 完整体现「组件契约单一源」：若 ECS 的 `component.*` 与 `class-contract.ts` 的 `capability` 形态并存，
  本线应归一化到单一源（组件契约），并保留向后兼容读取（catalog 已演示 `configurableParameters` 三拼写兼容读法）。

### 7.6 DoD 可机检

- `git status --porcelain` 显示白名单外无改动。
- `npx tsc --noEmit` 0 错（排除既有 combat-first/bombardment 红灯后的本线范围）。
- `npx vitest run test/l2/ecs` 与新增 guard 全绿，新增 PBT 存在且通过。
- `npm run lint` 0 error（warning 不高于基线）。
- `npx vitest run test/toolchain/spec-document-discipline.test.ts` 8/8 绿。

## 八、核心对齐规则（每条都要可机器断言）

1. **命名空间归一**：play/class 目录里的 `capability` id 是 `vehicle.capability.*` / `item.capability.*` 形态，
   ECS 组件契约是 `component.*` 形态。本线不强行改目录 id（那不属本线），而是由读取器/校验器把二者归一：
   `component.<family>.<name>` 与 `<family>.capability.<name>` 指向同一语义组件——用 `isComponentId` + 族级
   `familyId` 字段做映射，未映射时发 `COMPONENT_ID_CONFLICT` 或登记 H-题-0N。
2. **compositionKind 四形透传**：class-contract 需解析 `compositionKind`（`static`/`transient`/`modified-explicit`/
   `modified-capability`，单一源 `COMPOSITION_KINDS`），与 ECS 校验器同源；非法值发 `COMPOSITION_KIND_INVALID`。
3. **CaS 缝隙闭合到 play**：`kernelOps` 引用的字段名须落在 `parameters[*].key` 同一通路；play 侧 `audit` 校验
   组合的每个能力 `kernelOps` 未引用 play 未提供的字段（越界发 `VALUE_L3_OWNERSHIP`）。
4. **数值归属不越层**：`compositionContract.playLayerOwnedFieldNames` 声明玩法层拥有的字段名；play profile 里
   `hp`/`maxHp`/`speed`/`armorRating` 等取值须落在该集合内（既有 `auditCapabilityScope` 的 `playLayerOwnedFields`
   已接；补足枚举校验），同时受 1-5 铁律约束（`hp:3`、`speed:2` 已合规，`auditNumericValues` 既有）。
5. **不软改既有主目录**：派生/对齐只读既有 `src/class` 主目录，不自定义派生物覆盖；重叠 id 若语义不同则发
   `IDENTITY_CONFLICT` 而非静默替换。

## 九、证据表与交接项清单（样式）

落地 `src/l2/决策与风险记录.md` 追加「PT-12 对账」：逐条（八节 1-5 + 各要求）给 文件:函数 证据，不写"应该/可能"。
自主设计写 H-题-0N；需上游改动的路径写交接项（如"给 `vehicle.capability.*` 增加 ECS 归一映射需 class-catalog schema 允许
`compositionKind` 字段"属型号线）。

## 十、DoD（完成时逐条勾选）

- [ ] ECS 组件契约在 play/class 组合路径上可机检（direct 或经读取器归一）
- [ ] `class-contract.ts` 支持 `compositionKind`（四形）与 `familyId` 解析校验，`CAPABILITY_ENTRY_KEYS`/`CLASS_ENTRY_KEYS` 向后兼容增补
- [ ] play `audit`/`catalog` 接上 ECS 组件契约：CaS 缝隙、数值归属、compositionKind 透传不越界
- [ ] 无 `TODO`/`FIXME`/占位/`@ts-ignore`/`@ts-expect-error`
- [ ] PBT（`numRuns≥100`，规范标签）通过；集成测试覆盖完整组合路径
- [ ] 证据表完成，无模糊表述；H-题-0N 记录；需上游改动写交接项
- [ ] `git diff` 核实 `src/class` 目录数据与 `src/play/profiles` 目录数据未被本线改动
