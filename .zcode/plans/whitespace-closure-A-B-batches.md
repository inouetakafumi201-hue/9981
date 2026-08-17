# 白盒覆盖闭环：A/B 两批次并行落地方案

> 定位：把四块「白盒覆盖面（让每一层契约都有能证伪它的机器检查）还没铺到」的缺口，用两个批次闭环。
> 用户拍板：「1 是接口跟 AI 系统本身无明显关联，你现在可以全量解决；不是立刻，先做规划。」调查完成，本文件是规划本身与 A/B 批次 prompt 的落地载体。

## 一、调查结论：四块缺口与批次归属

调查由三个 Explore subagent 完成，结论已核对到工作树。

| # | 缺口 | 本质 | 归属线 | 批次 |
|---|------|------|--------|------|
| 1 | `src/class/class-contract.ts` 不认识 ECS 四形/`familyId`/`playLayerOwnedFieldNames`；ECS `ComponentContract` 与 class-contract 是**两套并列契约模型**、未单源化 | 契约未单源 + 校验入口缺失 | 基线线（`src/class` 已有 `familyId`/`compositionKind` 解析起点） | **A** |
| 2 | `compositionContract.playLayerOwnedFieldNames`（数据面 `src/class/*/index.json`）「字段在、链路未接」：ECS 不消费、`class-contract.ts` 不解析，play 组合侧只是 `optionalStrings` 松读 | 字段在、链路未接 | 基线线 | **A** |
| 3 | ECS 组件契约（`registry`/`family-shapes`/`ComponentContract.familyId`）在 play/class 侧**零消费**、未单源化（class-catalog 原始形状 vs ECS） | 并列契约、零消费 | 基线线（play 消费线 T-CaS 已授权写权） | **A**（消费）+ **B**（只有 read-adapter 投影落测属 AI 线） |
| 4 | AI 生产侧零接线（play 无 runtime 决策环；`l2/adapters/ai-adapter.ts` dangling；`NPC_QUEUE` 从不填充）；阶段3/4 无 PBT；read-adapter 游离 item-value projection 未提交未测；阶段4c（eternal-sleep）工作树红；`sequential-search.ts:234-236` 残留 P9 `console.log` | AI 引擎本身 | **AI 线**（用户已授权本会话修补 `src/core/kernel/ai/**`） | **B** |

关键判断：
- **A 先做**：纯收敛、基线线独占写权、可逆。它不依赖 B 的任何产出。
- **B 后做**：跨线需要已到手的 AUTH；B 的大部分（AI 引擎、阶段3/4、read-adapter）与 A 无共享可写文件，唯一共享点是「play 消费 ECS contract」——A 落地 class-contract 单源 + play 消费后，B 的 AI 生产 wiring 消费该成品即可，故 **A→B 是强顺序依赖**（B 的 prompt 明确要求基于 A 落地后的 class-contract 单一源）。
- 一个例外可并行：B 中「阶段4c 收敛 + read-adapter 投影落测 + P9 残留清除 + AI skill PBT」只碰 `src/core/kernel/ai/**` + 测试，与 A 零共享，**可与 A 同一批并行**。故实际拆两批：**批A（基线线闭环）+ 批B（AI 生产 wiring，跨线）**，批 B 单独执行；批 B 内「AI 引擎收敛」子任务并入批 A 的并行槽。

## 二、批次 A（基线线，独占写权，先并行）——单一子任务

**交付物**：把「class-contract 与 ECS ComponentContract 两套并列契约」单源化 + play 侧 ECS 消费 + 双 `playLayerOwnedFieldNames` 对齐 + PBT 守卫。纯收敛、不动数据。

**可写文件白名单**：
- `src/class/class-contract.ts`（已有 `compositionKind`/`familyId` 解析起点，扩为「与 ECS `ComponentContract` 交叉结构校验」的单源入口）
- `src/play/profiles/audit.ts`（消费线：`caSFieldMatches`/`CAS_FIELD_GAP_CODE` 已是唯一；若需补 ECS 消费则在此）
- `src/play/profiles/catalog.ts` 若需松读收紧
- class/play 对应的 `*.test.ts` / `*.property.test.ts`（新增单源核对 + PBT）
- 相关 spec 文档审计对照表（翻「交接」为「已闭合 T-CaS」）

**禁止触碰**：
- `src/core/kernel/ai/**`、`src/core/kernel/expr/**`（AI 线）
- 任何 `src/class/*/index.json`、`src/play/profiles/*.json` 数据（不改目录数据铁律）
- `src/l2/model/*`（ECS 单一源，只**读**不写——若需改属另一条已闭合线，登记交接）
- `src/l2/**` 其它、`src/core/**` 其它；未跟踪 bombard/plan 文件保持原样

**门禁（必须内部跑通并证明）**：`npx tsc --noEmit`、`npx vitest run`（相关范围 + 全量退出码）、`npm run lint`、`npm run verify:docs`、`npm run verify:data`、`npx vitest run && echo OK` 全绿。

## 三、批次 B（AI 生产 wiring，跨线已授权）——单一子任务

**交付物**：把 AI 从「测试桩评估器」接成「play 生产侧 runtime 决策环」——建真正 composition root、把 `makeCombatWorld` 逻辑复刻到 play 生产 `ActionCatalog`/schedule phases/`DefRegistry`/`behaviorBindingFor`，填充 `NPC_QUEUE`；同时收敛阶段3/4、修复阶段4c 红测、read-adapter 游离 item-value projection 落测、清除 P9 残留、补 AI skill PBT。

**可写文件白名单**（AI 线，用户已 AUTH 本会话修补）：
- `src/core/kernel/ai/**`（含 `design-currency.ts`、`sequential-search.ts`、`kernel/read-adapter.ts`、`planner-registry.ts`、`types.ts`）
- `src/core/kernel/expr/engine.ts`（仅保留 AI-line 已提交的 `isExprLeafObject` + `maxDepth` guard，不倒退）
- `src/play/**` 中真正新增的 production AI wiring（新文件 + composition root），但**必须只在 A 落地后的单一契约上接**
- `src/l2/adapters/ai-adapter.ts`（dangling adapter，接上或删除二选一并说明）

**禁止触碰**：
- `src/class/**`、`src/l2/model/composition-registry.ts`（只读）、`src/core/kernel/expr/**` 除已提交 AI-line 改动外的结构（不倒退 `isExprLeafObject`/`maxDepth`）
- 任何数据 JSON；未跟踪非本线文件

**必含项**：
- 修复阶段4c（`a:eternal-sleep` 预期 vs `a:heal` 收到）红测
- 处置 read-adapter 未提交 item-value projection（已 staged 17 行，无测试）：落测试或按自洽判断保留并说明
- 清除 `sequential-search.ts:234-236` P9 `console.log`（当前仍在！）+ 任何探针残留 + `eslint-disable` 处理
- 补 `scoreDesignCurrency`/`sequential-search` PBT（numRuns≥100）
- 门禁同上

**完成判据**：全量 vitest 退出码 0，且 AI 生产 wiring 有端到端用例证明 play 真调用决策环（非桩），阶段3/4 PBT 绿，无任何 probe 残留。

## 四、执行顺序与并行锁摘要

- 批 A 与批 B 的「AI 引擎收敛」子任务**本可并行**（零共享可写文件），但 B 的主体（生产 wiring）依赖 A 的单源成品。
- 实操：**先跑批 A prompt**（独立 session，独占写权）；**再跑批 B prompt**（跨线已授权，基于 A 成品）。用户已确认「先做规划」，本文件即规划交付；两个批次 prompt 与批次一一对应，各给一个全新无上下文 session。
