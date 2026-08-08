# 实施计划：wakeup-core-mechanics

## 概述

本计划把 `requirements.md` 的 19 项需求与 `design.md` 的组件、Op 映射、事务边界和 41 条正确性属性，转成可增量执行、可机械验证的编码任务。实现语言为 **TypeScript**（仓库既有语言，`design.md` 全篇以 TypeScript 表达接口，无需再选语言）。

> ## ⚠️ D-062 冻结提示（PT-03 对齐，2026-08-09）
>
> **本 Spec 的实现线（`src/play/core-mechanics/`）已被 `docs/访谈决策记录.md` 的 D-062 认定为与
> `src/play/action-turn/`（`playpack.json`，纯声明式数据，已有 30 + 若干集成测试全绿）存在
> 结构性重复，且结论互相矛盾（例如单人投点 U-002：`core-mechanics/allocation.ts` 按
> requirements.md 5.11/D-037 实现为单人 2 AP，而 `action-turn/playpack.json` 的
> `resolutionPolicy.singleParticipant` 反过来声称"以 wakeup-core-mechanics 为完全权威"应
> abort 阻塞——两者互相指向对方为权威，形成循环矛盾）。
>
> D-062 裁决草案：声明式 `playpack` 数据是机制内容权威形态，`core-mechanics` 的价值收缩为
> "装载期治理层"（玩法层 Linter），而不是内嵌第二份机制 `Def`。**该裁决尚待项目所有者复核批准**，
> 批准前 `core-mechanics` 并行线**冻结**，不得向下写新实现（执行/收敛工作列为并行任务 PT-07，
> 🔒 未就绪）。
>
> 因此，以下复选框状态**仅反映"对应 `.ts` 文件里是否存在代码"，不代表"是否可信完成"**：
> - `core-mechanics/` 下**没有任何 `__tests__/` 目录、零测试**（本 Spec"必交付"的 41 条属性测试
>   一条也没有写），任何标 `[x]` 的任务都只有静态代码存在、没有测试证明其正确性或可装载性；
> - 检查点任务（5、8）与属性测试任务（9.2、10.1–10.41）因此一律标 `[ ]`；
> - 过载机制（任务 6）与行动轮排名/窗口期机制（任务 7）在 `core-mechanics` 侧**完全未声明**，
>   但在 `action-turn/playpack.json` 里已有等价机制且通过测试——这正是 D-062 描述的重复现实。
>
> 可信的"完成"判定需等 D-062 收敛执行（PT-07）落地后才能重新评估。

### 与仓库实际情况对齐的三条硬约束（覆盖 design.md 中的过时表述）

1. **测试必须与源码同目录**：全部测试落在 `src/play/core-mechanics/**/*.test.ts`。`design.md` 8.2 写的 `test/play/core-mechanics/**` 在本仓库**永远不会被执行**——`vitest.config.ts` 的 `include` 只有 `src/**/*.test.ts`，`tsconfig.json` 的 `include` 只有 `src`，`npm run lint` 是 `eslint src --ext .ts`。任务 6.3 用真实断言把这条路径风险钉死。
2. **不存在 `@kernel/*` 路径别名**：`tsconfig.json` 没有 `paths`，`vitest.config.ts` 没有 `resolve.alias`。所有对引擎层的引用一律用相对路径 + `.js` 后缀（仓库既有写法），例如从 `src/play/core-mechanics/load.ts` 引用 `../../core/kernel/ops/registry.js`，从 `src/play/core-mechanics/__tests__/property/*.test.ts` 引用 `../../../../core/kernel/wire-hooks.js`。`design.md` 3.1 的 `import ... from '@kernel/...'` 写法不可照抄。
3. **命令**：`npm test`（= `vitest run`，单次执行）、`npm run typecheck`（= `tsc --noEmit`）、`npm run lint`（= `eslint src --ext .ts`）。属性测试库用已在 `devDependencies` 中的 `fast-check@^3.19.0`，不自建框架。

### 交付强度

本计划**没有可选任务**：不使用 `*` 后缀，不设可跳过项。41 条属性测试、契约测试、门禁测试、集成测试全部是必交付项，缺一条即视为对应需求未实现。

## 任务

- [ ] 1. 玩法层数值归属与装载期治理基座
  - [ ] 1.1 建立 `src/play/core-mechanics/ownership.ts` 的归属类型与数值字段遍历
    - 定义 `NumericOwnership`（`gameplay` / `internal` / `structural` / `constitutional` 四种，字段形状照 design.md 2.6）、`UnresolvedId`（`'T-001' | 'T-002' | 'U-001' | 'U-002' | 'U-003' | 'U-004' | 'U-005'`）、`PlayDefExtension`（`numericOwnership` / `costClass` / `parentActions` / `sourceTrace` / `unresolvedGuards`）
    - 实现 `collectNumericFields(def)`：递归遍历一个 `Def` 的全部数值字面量字段（含 `props`、`cost[].amount`、`clamp` 的 `min`/`max`），返回「字段路径 → 数值」列表；路径格式与 `numericOwnership` 的键一致
    - 该模块为纯函数模块：不得 import `OpRegistry`、`Transaction`、`OpContext`，不得持有 `WorldState`
    - 相对导入引擎层类型：`../../core/kernel/state/def.js`、`../../core/kernel/state/diagnostic.js`
    - _需求：1.7, 3.7, 3.9_

  - [ ] 1.2 在 `src/play/core-mechanics/ownership.ts` 实现归属分类校验与可见值域纯函数
    - `validateNumericOwnership(def)`：任一数值字段在 `numericOwnership` 中无分类 → 产出 `E_LOAD_NUMERIC_OWNERSHIP` 诊断，且**不得**把它推断为内部数值
    - `validateGameplayValueRange(def)`：分类为 `gameplay` 但值不是 1-5 的整数 → `E_LOAD_GAMEPLAY_VALUE_RANGE`
    - `isVisibleGameplayValue(v)`：纯函数，仅当 `Number.isInteger(v) && v >= 1 && v <= 5` 时为真；显式拒绝 `0`、`6`、小数、`NaN`、`Infinity`、`-Infinity`
    - `assertInternalNotInProjectionWhitelist(def, whitelist)`：分类为 `internal` 的字段出现在投影白名单中 → `E_LOAD_NUMERIC_OWNERSHIP`
    - 全部错误码从 `../../core/kernel/state/error-codes.js` 的 `ERR_CODES` 派生，**不新增任何错误码**
    - _需求：3.1, 3.2, 3.3, 3.9_

  - [ ] 1.3 在 `src/play/core-mechanics/ownership.ts` 实现术语、废案、来源追踪与未冻结项校验
    - `validateTerminology(def)`：定义中把「模板」「内容层」用作规范概念 → `E_LOAD_TERM_NONCANONICAL`
    - `validateNotDeprecated(def)`：命中废案名单（尸体系统、回合外反击 / Overwatch、感知衰减表、已移除的「淋湿」状态及其组合效果）→ `E_LOAD_DEPRECATED_MECHANIC`；名单以显式常量数组声明并标注来源代号 S8
    - `validateProvenance(def)`：`sourceTrace` 为空或指向不存在的来源代号 → `E_LOAD_NORMATIVE_WITHOUT_PROVENANCE`
    - `validateUnresolvedGuards(def)`：`unresolvedGuards` 非空 → `E_LOAD_UNRESOLVED_CONTRACT`，`Diagnostic.reason` 写该未冻结项编号原文（`'T-001'` … `'U-005'`）
    - `collectBlockedCapabilities(config)`：产出 `BlockedCapability[]`（`capability` / `blockedBy` / `rejectionCode`）；**T-003 不得出现在该列表中**
    - _需求：1.4, 1.5, 1.7, 16.8, 17.2, 17.5_

- [ ] 2. 玩法层纯函数（无随机、无 WorldState）
  - [ ] 2.1 在 `src/play/core-mechanics/allocation.ts` 实现 AP 差值分配
    - 定义 `RollTier`（`1 | 2 | 3 | 4 | 5`）、`ApAllocation`（`{kind:'allocated', ap:1|2|3}` 或 `{kind:'unallocated'}`）、`RollParticipant`、`RollOutcome`
    - `allocateAp(participants)` 按 design.md 3.3 的四步判定顺序实现：参与者为 1 名 → 返回 `E_LOAD_UNRESOLVED_CONTRACT`（`reason='U-002'`）且不返回任何分配值；恰好 2 名 → 不低于对方者 2 AP、较低者按差 1 / 差 ≥2 得 1 AP / 未分配，且**不产生 3 AP**；>2 名 → 唯一最高且领先第二高 ≥2 得 3 AP，并列最高或领先不足 2 的最高者各 2 AP，与最高差 1 得 1 AP，差 ≥2 未分配
    - `staminaRefunded = (allocation.kind === 'unallocated')`，且仅当 `committedStamina > 0` 时代表实际退还写入
    - 函数签名与实现体内**不得**出现 `random.*`、`Math.random`、`WorldState`、`OpRegistry`：入参只有外部提供的合法最终等级，返回值只有 `Result<readonly RollOutcome[]>`（复用 `../../core/kernel/ops/result.js`）
    - _需求：5.4, 5.5, 5.6, 5.7, 5.8, 5.11, 5.12_

  - [ ] 2.2 在 `src/play/core-mechanics/allocation.ts` 实现顺序键比较与较长剩余选择
    - `compareTurnOrder(a, b)`：纯比较函数，键序固定为「分配 AP 较多者优先 → 最终投点等级较高者次优先 → `tieBreak` 升序」；`tieBreak` 由调用方从命名随机流取得后传入，比较函数自身不生成随机
    - `pickLongerRemainingTurns(existing, incoming)`：返回两者中较大的合法剩余回合数（值域 1-5），用于刷新策略；输入越界即返回 `Result` 失败而不是截断
    - `validateVisibleRange(values)`：批量校验一组玩家可见数值全部落在 1-5 整数域，复用 1.2 的 `isVisibleGameplayValue`
    - 三个函数均不 import 引擎层写入类型
    - _需求：7.3, 7.4, 13.1, 13.2_

- [ ] 3. 声明式定义集合（`src/play/core-mechanics/defs/`）
  - [ ] 3.1 编写 `src/play/core-mechanics/defs/attachments.ts`
    - 声明离散状态 `AttachmentDef`：零血倒地、普通倒地、格挡（条件持续）、隐蔽（条件持续）、精密交互中间状态（`props = { kind, targetRef, beganAtPhase }`）、强力骰承诺标记、永久退出（观战/退出）标记
    - 回合型状态携带 `props.remainingTurns`（Gameplay_Value，1-5，永不写 0）
    - `stackStrategy` 只允许 `'unique' | 'count' | 'independent'`；**禁止**使用引擎层 `'refresh'`（design.md 3.12 的映射裁决）
    - 每个 `AttachmentDef` 携带 1.1 定义的 `PlayDefExtension`（`numericOwnership` + `sourceTrace`）
    - _需求：9.2, 11.3, 12.1, 13.1, 14.2, 14.5_

  - [ ] 3.2 编写 `src/play/core-mechanics/defs/schedule.ts`
    - 声明 `CORE_PHASES` 常量与对应 `ScheduleDef`：`roll`(input `all`) → `settle`(`none`) → `playerAction`(`actor`) → `npcAction`(`none`) → `cleanup`(`none`)，长度恒为 5
    - 每个 `PhaseDef` 的 `onEnter`/`onExit` 预留守卫位（首条 `Effect` 为 `if` + `abort`），具体守卫条件在 3.7 填入
    - 引用 `../../../core/kernel/schedule/types.js`
    - _需求：7.1, 7.2_

  - [ ] 3.3 编写 `src/play/core-mechanics/defs/actions.paid.ts`
    - 声明付费动作 `ActionDef` 集合：移动到相邻合法位置、拾取、攻击、整理背包、上车、下车、举盾格挡、睡下、起床、站起、令其长眠、爬行、精密交互「开始」与「完成」、多步移动两步、观战、退出
    - 每个动作的 `cost` 恰好一项且 `amount` 为**字面量 `1`**（不接受 Expr）；`pool` 为 AP 池
    - 全部付费动作的 `require` 统一带「不带零血倒地标记」守卫；观战/退出除外，且两者成功后写入永久退出标记
    - 令其长眠的 `require` 为三条纯读 Expr：目标处于零血倒地、执行者与目标同微型场景、目标满足资格
    - 精密交互「完成」的 `require` 要求中间状态 `props.targetRef === bindings.target`
    - _需求：4.2, 4.7, 6.11, 9.1, 11.5, 11.6, 12.3, 12.5_

  - [ ] 3.4 编写 `src/play/core-mechanics/defs/actions.attached.ts`
    - 声明附着动作 `ActionDef` 集合：丢弃物品、使用已声明的随动作消耗品、取消格挡、医疗物品、体力消耗品
    - `cost` 为**空数组**，不得写成 `amount: 0`；`PlayDefExtension.costClass = 'attached'`，`parentActions` 必须非空
    - 每个附着动作显式声明 `triggerPoint`（`beforeParentEffects` / `afterParentEffects`）、`requireRef`、效果与 `onFailure`（`rejectWholeAction` / `skipAttachedOnly`）
    - `require` 中包含守卫「存在一个正在解算的、声明了本动作为附着项的父意图」，使顶层枚举时该守卫为假且未声明 `visible`
    - 医疗与体力消耗品的单次恢复量只允许 1 或 2
    - _需求：4.8, 8.5, 8.6, 15.1, 15.5_

  - [ ] 3.5 编写 `src/play/core-mechanics/defs/rules.damage.ts`
    - 声明 `play.damage.request` 五阶段 `RuleDef`：`before`（目标资格 / 免疫 veto）、`modify`（护甲与盾牌减伤挂载点，本包不注册任何具体数值规则）、`instead`（完全免疫型格挡）、`default`（读生命 → 分支 → `prop.set` 剩余生命，或 `prop.del` + `attach.add` + `tag.add` + `emit play.downed.entered`）、`after`（只读演出增量）
    - 声明 `play.heal.request` 五阶段 `RuleDef`：`default` 走 `prop.add` 并依赖活体 `Def.clamp.vitality = { min:1, max:5, int:true }`
    - 受击后自动取消格挡的 `after` 阶段规则调用 `attach.del`，且全过程**不得**出现 `decision.open`
    - 全部 Op 名只取自 design.md 2.3 的 Op 全集，不新增 Op
    - _需求：3.5, 11.3, 11.8, 14.3_

  - [ ] 3.6 编写 `src/play/core-mechanics/defs/rules.status.ts`
    - 声明 `play.status.apply` 的 `modify`（用 2.2 的 `pickLongerRemainingTurns` 裁决剩余时间并写入 `payload.remainingTurns`）与 `default`（以该值调用 `attach.add`，策略为 `unique`）
    - 声明 `play.status.tick` 的 `default`：剩余 ≥1 时 `prop.set`，剩余将为 0 时改为 `attach.del`
    - 声明 `after:entity.place` 的隐蔽移除规则（`attach.del`）
    - 声明「找到」交互的目标守卫：带隐蔽标记的活体不出现在合法目标集合中
    - _需求：13.1, 13.2, 13.4, 13.7, 14.6, 14.7_

  - [ ] 3.7 编写 `src/play/core-mechanics/defs/rules.phase.ts`
    - 填入五阶段推进守卫（`roll→settle` 承诺齐备、`settle→playerAction` 三项写入完成且 `turnOrder` 长度等于应行动玩家数、`playerAction→npcAction` 执行队列已空、`npcAction→cleanup` NPC 队列已空、`cleanup→roll` 无未完成到期结算）
    - `roll` 阶段 `onEnter` 首条 `Effect` 为 U-001 策略守卫：策略不齐备时 `abort`，且必须发生在任何 `random.*` 调用与任何体力扣减之前
    - `settle` 阶段 `emit play.phase.settle`，其 `default` 规则在**同一事务**内完成最终等级确认、AP 分配（调用 2.1 的结果写入 AP 池）、强力骰退还（`intent.void`）与 `turnOrder` 写入
    - `cleanup` 阶段 `onEnter` 结算自然体力恢复 1（`emit play.stamina.grant`）、状态到期推进、已声明持续效果
    - NPC 顺序按稳定编号升序，不使用玩家同分随机；`npcBudget === null` 时不写入任何 NPC AP 池
    - 装载期约束落点：任何写入 `turnOrder` 路径且不挂在 `settle` 阶段的定义必须可被 4.3 的 Linter 识别并拒绝
    - _需求：5.9, 6.2, 7.2, 7.3, 7.6, 7.7, 7.9, 7.10_

  - [ ] 3.8 编写 `src/play/core-mechanics/defs/rules.gateway.ts`
    - 声明 `GatewayKind`、`GatewayBinding`、`GatewayJudgement` 类型与 `play.gateway.evaluate` 的五阶段 `RuleDef`
    - `default` 阶段按 `kind` 分派：`resourceConversion`（输入不足则 `abort`，足额则同一事务内扣减 + 成功效果）、`check`（调用声明的 `random.*` 命名流后比对 criterion）、`condition`（求值 predicate）
    - 失败语义只有两种：显式失败效果或无效果；失败原因走 `Diagnostic.reason`，不新建错误模型
    - **不提供**商店、锁门、合成台、检定难度、资源数量或网关 AP 成本的默认值；`gateways: []` 是合法配置
    - _需求：10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8_

- [ ] 4. 玩法包、装载入口与玩法层 Linter
  - [ ] 4.1 编写 `src/play/core-mechanics/playpack.ts`
    - 组装 `CoreMechanicsPlaypack: PlaypackDef`（`kind:'playpack'`）：`pools` 声明 AP 池（`per:'actor'`, `reset:'turn'`）与体力池（`per:'actor'`, `reset:'never'`），`schedule` 指向 3.2 的 `ScheduleDef`，`defs` 汇总 3.1–3.8 的全部定义，`outcomes` 留空
    - 引用 `../../core/kernel/schedule/playpack.js` 的 `PlaypackDef` / `PoolDef` 类型
    - 每个汇总进来的 `Def` 必须携带 `PlayDefExtension`，否则在类型层面即报错
    - _需求：2.1, 16.1_

  - [ ] 4.2 在 `src/play/core-mechanics/load.ts` 实现装载入口与组合根接线
    - 定义 `CoreMechanicsConfig`（`rollPolicy` / `npcBudget` / `staminaMax:5` / `vitalityMax:5` / `enabledPaidActions` / `enabledAttachedActions` / `gateways` / `statuses` / `recoverySources` / `parallelismExceptions`）、`CoreMechanicsLoadOptions`、`CoreMechanicsLoadResult`、`BlockedCapability`
    - `loadCoreMechanics(opts)` 按 design.md 2.5 的八步顺序执行：接受外部传入的 `WiredHooks`（来自 `../../core/kernel/wire-hooks.js` 的 `wireHooksIntoRegistry`，玩法层**不自行构造** `HookDispatcher` / `FlowInterpreter`）→ `ruleProvider.load(RuleDef 集合)` → `defRegistry.register(全部 Def)` → `new PlaypackLoader({defRegistry}).load(CoreMechanicsPlaypack)` → 玩法层 Linter
    - 任一诊断为 `error`/`fatal` → `ok:false`、`projection:null`（不返回半可用对象）、注册表状态与装载前相等
    - `load.ts` 是玩法层**唯一**可以引用 `OpRegistry` 的模块；即便如此也不得持有 `OpContext`，嵌套 Op 一律由 `FlowInterpreter` 代为调用
    - _需求：2.1, 2.2, 16.1, 16.2, 17.3_

  - [ ] 4.3 在 `src/play/core-mechanics/load.ts` 实现玩法层 Linter 全量规则
    - 把 design.md 2.6 与 3.x 的装载期校验逐条落为规则函数，全部复用 1.2/1.3 的校验器与既有 `ERR_CODES`，**不新增任何错误码**：
      - 数值归属缺失 → `E_LOAD_NUMERIC_OWNERSHIP`；Gameplay_Value 越界 → `E_LOAD_GAMEPLAY_VALUE_RANGE`
      - 付费动作 `cost` 不是「单项 + AP 池 + 字面量 1」（含 Expr 形态、>1、<1）→ `E_LOAD_GAMEPLAY_VALUE_RANGE`；附着动作 `cost` 非空或写成 0 → `E_LOAD_SEMANTIC_FIELD_DAMAGED`
      - 附着动作缺 `parentActions` / `triggerPoint` / `requireRef` / 效果 / `onFailure` 任一项 → `E_LOAD_SEMANTIC_FIELD_DAMAGED`
      - 静态并列选项数 > 5 且未声明宪法例外 → `E_LOAD_CROSS_FIELD_CONSTRAINT`
      - 状态配置缺 `duration` / `stack` / `effectRefs` / `interruptionRefs` 任一项 → `E_LOAD_SEMANTIC_FIELD_DAMAGED`；使用引擎层 `'refresh'` 策略 → `E_LOAD_COMPOSITION_CONFLICT`
      - 格挡状态 `duration.kind !== 'condition'` → `E_LOAD_COMPOSITION_CONFLICT`
      - `recoverySources` 白名单之外的任何效果写入 `vitality` / `stamina` 路径 → `E_LOAD_LAYER_OWNERSHIP`；同 `triggerPoint` + 同 `resource` + 同目标重复登记 → `E_LOAD_CONFLICT`
      - 网关缺 `costClass` / 成功效果 / 失败语义 / 失败原因 / 判定输入任一项 → `E_LOAD_SEMANTIC_FIELD_DAMAGED`
      - 重新定义引擎层 Op / Expr / Query / Hook / Decision / Intent / 事务 / 随机 / 持久化机制 → `E_LOAD_LAYER_OWNERSHIP`
      - 写入 `turnOrder` 且不挂在结算阶段 → `E_LOAD_LAYER_OWNERSHIP`
      - 引用未登记基类/实例/动作/状态 → `E_LOAD_UNDEFINED_REF`；同优先级实质冲突未裁决 → `E_LOAD_EQUAL_PRECEDENCE_CONFLICT`
      - 表现字段缺失 → `E_LOAD_PRESENTATION_FALLBACK`（`severity: 'warn'`，不回滚、不改语义字段）
    - 语义字段一律不静默补全；只有表现字段可按类型兼容回退
    - _需求：3.9, 4.3, 8.5, 13.3, 13.8, 15.6, 15.7, 16.1, 16.2, 16.3_

  - [ ] 4.4 在 `src/play/core-mechanics/load.ts` 实现拒绝原因映射与统一提交入口
    - 声明 `PLAY_REJECTION_TO_ERRCODE` 常量表，逐行对应 design.md 7.2 的全部拒绝原因；表内每个码都必须在 `ERR_CODES` 中存在（由 7.3 的契约测试机械校验）
    - 实现 `CoreMechanicsFacade`：`submit(req)` / `resolve(intentId)` / `advancePhase()`，内部只做参数整形 + `OpRegistry.invoke`，**没有来源参数**、没有 `isFromUI` / `isFromAI` 分支
    - `ActionRequest.attached` 只能作为父动作请求的一部分出现；`actionId` 为附着动作时直接返回 `E_OP_NOT_ACCEPTED` 且不产生任何写入
    - 失败一律原样返回引擎层 `Result` / `Diagnostic`，不抛玩法层异常、不返回布尔或字符串失败原因
    - 说明：design.md 7.2 提到该映射表的真相源是 `errors.ts`，但 design.md 1.6 的文件清单没有这个文件；本计划把表放在 `load.ts` 以留在 1.6 的文件集合内，该取舍已记入下方「注意事项」待人工确认
    - _需求：2.5, 8.8, 16.4, 16.7, 18.2_

  - [ ] 4.5 实现 design.md 11.6 的「字段缺失被当成 0」防护
    - 在 `src/play/core-mechanics/defs/rules.damage.ts` 的治疗 `require` **与** `default` 阶段各加一条显式守卫：目标缺失 `vitality` 字段或带零血倒地标记时拒绝，不得只依赖 `clamp`
    - 在 `src/play/core-mechanics/defs/actions.attached.ts` 的医疗与体力消耗品 `require` 中加同类显式守卫（缺失资源字段即不合法）
    - 在 `src/play/core-mechanics/defs/rules.phase.ts` 的结算与清理效果中，AP 的 `available` 与 `real` 必须**成对写入、成对删除**：未分配 AP 时两条路径一起 `prop.del`，分配时两条路径一起写
    - 在上述三个文件的对应位置写明成因注释（`prop.add` / `freezeCost` 读到不存在路径会退化为 `0`），禁止后续以「clamp 已经兜住了」为理由删除显式判定
    - _需求：3.4, 3.5, 11.6, 11.8, 15.2_

- [ ] 5. 检查点 - 装载链路可编译可装载
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. 过载机制（design 3.17，D-055；建立在 AP/体力/阶段任务 1–4 之上）
  - [ ] 6.1 在 `src/play/core-mechanics/defs/attachments.ts` 追加过载态 `AttachmentDef`
    - 新增引用基类层 `status_overloaded` 实例的离散状态 `AttachmentDef`：`durationKind: 'condition'`（非回合型，不参与 `remainingTurns` 推进），施加走 `attach.add`、解除走 `attach.del`，不使用任何其他 Op
    - 携带 1.1 定义的 `PlayDefExtension`（`numericOwnership` + `sourceTrace`，来源代号 D-055）；`status_overloaded` 引用现为合法，不得再产出 `E_LOAD_UNRESOLVED_CONTRACT`
    - 与既有离散状态并排声明，不新建平行的状态文件
    - _需求：6.16, 6.19_

  - [ ] 6.2 新增 `src/play/core-mechanics/defs/rules.stamina.ts` 承载 `play.stamina.grant` 过载触发
    - 声明 `play.stamina.grant` 的 `default` 阶段规则：读目标当前体力 `cur` 与本次增加量 `inc`，`cur + inc > 5` 时把体力钳到 5（`prop.add` + `clamp`）并在同一事务内 `attach.add` 施加 6.1 的过载态；`cur + inc <= 5` 时只做常规恢复、不施加
    - 显式排除清理阶段自然恢复：目标体力已为 5 时的 `+1` 是无操作（`min(5+1,5)=5`），不得判为"尝试超过 5"；在规则体内写明该排除的成因注释（防止满体力活体每回合必然过载导致机制自毁）
    - D-053 施加于他方的两项增加（弱点命中 +1、招架成功 +1）作为合法过载触发来源接入同一 `default` 判定
    - Op 名只取自 design 2.3 全集，不新增 Op、不新增 ErrCode
    - _需求：6.14, 6.16, 6.22_

  - [ ] 6.3 在 `src/play/core-mechanics/defs/rules.phase.ts` 追加归队计数与失权推进
    - 施加过载时用 `prop.set` 把归队计数 `entities.{id}.props.overloadRejoinPending` 置 1（跳过紧邻的下一次投点），该计数标注为 `internal`（投影白名单禁止收录）
    - 在 `roll` 阶段 `onEnter` 判定：带计数者本次投点被跳过；被跳过后的其后那一次投点（下下回合）前用 `prop.del` 清除计数并 `attach.del` 解除过载态
    - 若过载施加时该活体本回合尚未行动，`attach.add` 一个本回合失权标记；已行动则不追加
    - 归队计数递减与解除全部沿合法 Op 事件链自动完成，不为过载 `decision.open` 任何面向他人的即时选择
    - _需求：6.17, 6.18, 6.21_

  - [ ] 6.4 在 `src/play/core-mechanics/load.ts` 追加过载装载期校验（Requirement 16.9 清单）
    - 逐条落为规则函数，全部复用既有 `ERR_CODES`，不新增错误码：过载触发条件必须是"尝试使体力超过 5"（其他谓词 → 拒绝）；体力封顶必须 `clamp.stamina.max === 5`；必须声明"未行动者失去本回合行动权"；必须声明"跳过一次投点后下下回合归队"；归队计数必须标注 `internal`；清理阶段自然恢复必须被排除在触发之外
    - 任一项缺失或与 Requirement 6 第 14–22 条不一致 → 拒绝装载，不补全默认语义
    - 引用 `status_overloaded` 的合法配置**不得**因未冻结（U-003）理由被拒绝
    - _需求：6.14, 6.16, 6.17, 6.18, 6.22, 16.9_

- [ ] 7. 行动轮排名与窗口期（design 3.18，D-035/D-036/D-053/D-055；建立在阶段任务 3.7 与过载任务 6 之上）
  - [ ] 7.1 新增 `src/play/core-mechanics/defs/rules.turnround.ts` 承载排名交换与推进扫描
    - 声明行动轮排名结构：落在 `world.props.play.turnOrder` 有序列表，每名参与玩家占唯一排名位（列表下标为 Internal_Metric，不作玩家可见数值），NPC 不进入行动轮
    - 排名变化一律以**排名交换**实现，用既有 `list.move` 表达两位互换的有序结果；**绝不** `list.insert`、不复制条目、不改变列表长度；交换前后成员多重集逐元素相等
    - 声明变化幅度表规则（逆转 +1、超逆转 +2、处决成功执行者 +1、弱点命中被命中方 -1、招架成功攻击方 -1），表外幅度不产出任何写入
    - 推进 = 扫描列表定位第一个 `hasActed === false` 且未带 6.3 失权标记的条目；已行动者保留在列表中并按 D-035 标记降饱和，不以出队方式移除
    - 每次排名变化后在同一事务内重排；事务中途失败则重排与推进整体回滚
    - Op 名只取自 design 2.3 全集，不新增 Op、不新增 ErrCode
    - _需求：7.11, 7.12, 7.13, 7.14, 7.15_

  - [ ] 7.2 新增 `src/play/core-mechanics/defs/actions.window.ts` 承载逆转/超逆转窗口期动作
    - 声明逆转动作 `ActionDef`：`cost` 恰一项 `{ pool: AP, amount: 1 }`（字面量 1），仅窗口期可提交，作用自身排名 +1
    - 声明超逆转动作 `ActionDef`：`cost` 恰一项 `{ pool: STAMINA, amount: 2 }`（字面量 2），仅窗口期可提交，作用自身排名 +2
    - 逆转/超逆转与同回合强力骰承诺互斥：该回合已提交其一后，另一项 `require` 守卫为假并被结构化拒绝（`E_OP_NOT_ACCEPTED`），被拒项不扣 AP、不扣体力
    - 携带 `PlayDefExtension`（`numericOwnership`：AP/体力成本为 gameplay，来源 D-053/D-055）
    - _需求：7.16, 7.17, 8.10_

  - [ ] 7.3 在 `src/play/core-mechanics/defs/rules.phase.ts` 追加窗口期提交的成本结算与延迟兑现
    - 窗口期提交（逆转、超逆转、强力骰承诺）在提交时立即结算成本（`intent.submit` → `freezeCost` → 提交即 settle）
    - 排名与投点等级修正记为待兑现量，仅在下一次投点阶段 `onEnter` 效果里应用，不打开任何面向他人的 `decision.open`
    - 窗口期定义为"上一回合行动开始之后、下一回合投点开始之前"；窗口期之外的提交结构化拒绝且不扣任何资源
    - _需求：7.16, 7.18, 8.11_

  - [ ] 7.4 在 `src/play/core-mechanics/load.ts` 追加行动轮/窗口期装载期校验
    - 逐条落为规则函数，复用既有 `ERR_CODES`，不新增错误码：行动轮排名唯一（排名集合基数等于参与玩家数，任何允许并列的配置 → 拒绝）；排名变更只允许交换式（任何 `list.insert`/复制/改变列表长度的排名写入 → 拒绝）；幅度必须符合幅度表（表外幅度 → 拒绝）；逆转成本字面量 1 AP、超逆转成本字面量 2 体力（其他成本形态 → 拒绝）；窗口期时序（非窗口期提交路径 → 拒绝）；逆转/超逆转与强力骰承诺互斥（同回合允许并存的配置 → 拒绝）
    - 任何写入 `turnOrder` 且既不挂在结算阶段、又不属 D-053 六项机制标识符之一的 Def → 拒绝装载
    - _需求：7.11, 7.12, 7.15, 7.16, 7.17_

- [ ] 8. 检查点 - 过载与行动轮定义可编译可装载
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. 属性测试生成器与投影层（属性测试的前置依赖）
  - [ ] 9.1 在 `src/play/core-mechanics/projection.ts` 实现只读投影
    - 转发 `queryActions` / `QueryEngine` / `ExprEngine` 三条只读通道；`ProjectedResources` 三字段为可辨识联合，不存在数值 0 取值；不导出 `OpRegistry` / `Transaction` / `OpContext`
    - 分组呈现每组同屏并列 ≤5，超过时分页；投影白名单排除任何 `internal` 归属字段（含过载归队计数、行动轮下标）
    - _需求：3.4, 3.8, 16.7, 18.2_

  - [ ] 9.2 在 `src/play/core-mechanics/__tests__/property/generators.ts` 建立共享 fast-check 生成器
    - 实现 design 8.3 清单：`arbReachableState`、`arbRollTierMultiset`、`arbBoostCommitment`、`arbPaidAction`/`arbAttachedAction`、`arbDamageCase`、`arbCarriedItems`、`arbStatusApplyPair`、`arbFailureInjection`、`arbUnresolvedReference`、`arbDeprecatedReference`、`arbCallerSource`
    - 追加过载/行动轮所需生成器：`arbStaminaGrantCase`（cur×inc 全组合，含 cur=5 清理恢复）、`arbInflictedIncrease`（弱点命中/招架，含发起者满体力）、`arbTurnRoundState`（参与玩家集合 + 排名变化序列）、`arbWindowSubmission`（窗口期内/外、与强力骰承诺组合）
    - 相对导入引擎层：`../../../../core/kernel/wire-hooks.js` 等；不自建属性测试框架
    - _需求：5.12, 6.14, 7.11, 16.6_

- [ ] 10. 属性测试（一文件一属性，文件名含属性编号，`fast-check` `numRuns` ≥ 100；全部为必交付项）
  - [ ] 10.1 `__tests__/property/p01-op-set-invariance.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 1: 状态变化只经已登记 Op 与唯一写入通道`
    - _需求：2.1, 13.7, 15.8, 19.3_
  - [ ] 10.2 `__tests__/property/p02-rejection-preserves-state.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 2: 拒绝保持事务前状态`
    - _需求：2.3, 2.4, 2.5, 4.9, 16.4_
  - [ ] 10.3 `__tests__/property/p03-visible-values-1-5.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 3: 玩家可见数值恒在 1-5 且不出现 0`
    - _需求：3.1, 3.2, 3.3, 11.1_
  - [ ] 10.4 `__tests__/property/p04-depletion-discrete-projection.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 4: 资源耗尽与无独立成本投影为离散取值`
    - _需求：3.4, 3.6, 5.7_
  - [ ] 10.5 `__tests__/property/p05-parallel-options-max-5.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 5: 同时并列独立选项不超过 5`
    - _需求：3.8, 8.7, 12.10_
  - [ ] 10.6 `__tests__/property/p06-unclassified-numeric-rejected.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 6: 未分类数值拒绝装载`
    - _需求：3.7, 3.9_
  - [ ] 10.7 `__tests__/property/p07-paid-action-one-ap.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 7: 付费动作恰好 1 AP，不存在 2 AP 原子动作`
    - _需求：4.2, 4.3, 4.7, 9.6_
  - [ ] 10.8 `__tests__/property/p08-attached-never-toplevel.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 8: 附着动作永不成为顶层分支`
    - _需求：4.8, 8.4, 8.5, 8.8_
  - [ ] 10.9 `__tests__/property/p09-parent-failure-zero-write.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 9: 父动作失败则附着效果零写入`
    - _需求：8.6_
  - [ ] 10.10 `__tests__/property/p10-ap-differential-allocation.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 10: AP 差值分配表`
    - _需求：5.4, 5.5, 5.6, 5.7, 5.12_
  - [ ] 10.11 `__tests__/property/p11-two-player-no-3ap.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 11: 双人投点不产生 3 AP`
    - _需求：5.8_
  - [ ] 10.12 `__tests__/property/p12-settle-atomicity-guard.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 12: 结算事务四项原子性与策略守卫先于副作用`
    - _需求：5.2, 5.3, 5.9, 6.7_
  - [ ] 10.13 `__tests__/property/p13-single-participant-blocked.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 13: 单一投点参与者阻塞而非推断默认`
    - _需求：5.11_
  - [ ] 10.14 `__tests__/property/p14-deterministic-replay.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 14: 相同快照、输入与随机流产生相同结果`
    - _需求：5.10, 16.6_
  - [ ] 10.15 `__tests__/property/p15-stamina-cap-5.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 15: 体力上限恒为 5 且不触发未冻结过载`
    - _需求：6.1, 6.2, 6.14_
  - [ ] 10.16 `__tests__/property/p16-boost-stamina-conservation.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 16: 强力骰体力守恒`
    - _需求：6.8, 6.9_
  - [ ] 10.17 `__tests__/property/p17-boost-two-tiers.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 17: 强力骰仅两档、承诺不可撤销、不足不部分冻结`
    - _需求：6.3, 6.4, 6.5, 6.6_
  - [ ] 10.18 `__tests__/property/p18-five-phase-order-turnorder-fixed.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 18: 五阶段顺序与结算后固定的行动顺序`
    - _需求：7.1, 7.3, 7.6_
  - [ ] 10.19 `__tests__/property/p19-phase-guard-cleanup-atomic.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 19: 阶段推进守卫与清理阶段原子性`
    - _需求：7.9, 7.10_
  - [ ] 10.20 `__tests__/property/p20-timing-purity.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 20: 时序纯洁性`
    - _需求：8.1, 8.2_
  - [ ] 10.21 `__tests__/property/p21-precise-two-step-interrupt.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 21: 精密交互的两步结构与中断语义`
    - _需求：9.1, 9.2, 9.3, 9.4, 9.7_
  - [ ] 10.22 `__tests__/property/p22-gateway-all-or-nothing.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 22: 网关全成或全不成`
    - _需求：10.3, 10.5, 10.6, 10.7_
  - [ ] 10.23 `__tests__/property/p23-downed-atomic-no-zero.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 23: 零血倒地的原子转换且从不暴露 0`
    - _需求：3.5, 11.3_
  - [ ] 10.24 `__tests__/property/p24-downed-action-set-exit-irreversible.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 24: 零血倒地动作集不扩大、退出不可逆`
    - _需求：11.4, 11.5, 11.6, 11.7_
  - [ ] 10.25 `__tests__/property/p25-heal-cap-no-revive.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 25: 治疗上限与不复活`
    - _需求：11.8, 15.2_
  - [ ] 10.26 `__tests__/property/p26-eternal-sleep-three-atomic.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 26: 令其长眠的三事原子性`
    - _需求：6.10, 12.5, 12.6, 12.11_
  - [ ] 10.27 `__tests__/property/p27-death-bag-conservation.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 27: 死亡背包物品守恒、只出不进、容量派生`
    - _需求：12.7, 12.8, 12.9_
  - [ ] 10.28 `__tests__/property/p28-status-expiry-no-zero.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 28: 状态到期不保留可见 0`
    - _需求：13.1, 13.4_
  - [ ] 10.29 `__tests__/property/p29-refresh-longer-remaining.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 29: 刷新策略保留较长剩余时间且不叠加强度`
    - _需求：13.2_
  - [ ] 10.30 `__tests__/property/p30-status-config-required.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 30: 状态配置缺必需项即拒绝`
    - _需求：13.3, 13.8_
  - [ ] 10.31 `__tests__/property/p31-block-lifecycle.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 31: 格挡生命周期`
    - _需求：14.1, 14.2, 14.3_
  - [ ] 10.32 `__tests__/property/p32-stealth-scene-move-find.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 32: 隐蔽的场景限定、移动移除与不可被找到`
    - _需求：14.5, 14.6, 14.7_
  - [ ] 10.33 `__tests__/property/p33-no-implicit-recovery.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 33: 无隐式恢复，增量必可归因`
    - _需求：6.12, 6.13, 15.1, 15.3, 15.7_
  - [ ] 10.34 `__tests__/property/p34-sleep-two-step.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 34: 睡眠两步流程与起床回满`
    - _需求：6.11, 15.4_
  - [ ] 10.35 `__tests__/property/p35-same-legality-all-sources.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 35: UI、AI、UGC 与玩家共用同一合法性判定与同一拒绝原因`
    - _需求：4.5, 16.7, 18.2, 19.6_
  - [ ] 10.36 `__tests__/property/p36-load-atomic-reject-presentation-fallback.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 36: 装载的原子拒绝与表现字段降级边界`
    - _需求：16.1, 16.2, 16.3_
  - [ ] 10.37 `__tests__/property/p37-unresolved-reject-closed-accept.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 37: 引用未冻结项一律拒绝且不产生默认值`
    - _需求：8.9, 11.2, 14.8, 16.8, 17.1, 17.2, 17.3_
  - [ ] 10.38 `__tests__/property/p38-deprecated-not-revived.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 38: 已否决机制不得复活`
    - _需求：1.5, 13.6_
  - [ ] 10.39 `__tests__/property/p39-layer-ownership-provenance-conflict.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 39: 层级归属、来源状态与冲突保留`
    - _需求：1.1, 1.2, 1.3, 1.4, 1.6, 1.7_
  - [ ] 10.40 `__tests__/property/p40-normal-downed-explicit.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 40: 普通倒地的显式触发与场景约束`
    - _需求：12.1, 12.2, 12.3, 12.4_
  - [ ] 10.41 `__tests__/property/p41-npc-order-budget.test.ts`
    - `// Feature: wakeup-core-mechanics, Property 41: NPC 顺序稳定且预算不从玩家投点推断`
    - _需求：4.6, 7.7, 7.8_
