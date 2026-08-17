# BATCH B prompt — AI 生产侧 runtime 接线 + 阶段3/4 收敛（跨线，已授权）

> 用途：作为全新、无上下文会话的完整指令。一次做完、不交付 MVP/骨架/占位。
> 项目：WakeUp（D:\coding\WakeUp，Git Bash，Node≥20，TypeScript + vitest）。先读 `docs/L0_规范宪法.md`、`src/core/kernel/ai/{types,design-currency,sequential-search,planner-registry,kernel/read-adapter}.ts`、`src/core/kernel/ai/__tests__/combat-first.test.ts`、`src/l2/adapters/ai-adapter.ts`、`src/play/**` 的 ActionCatalog/schedule/behaviorBindingFor/DefRegistry。

> **授权提示**：本批次由项目所有者对本会话明确授权修补 `src/core/kernel/ai/**`（用户 "授权本会话修补"）。你在本批内的写权仅限下方白名单，越权即失败。

## 你的唯一交付物

把 AI 从「只在测试桩里跑的评估器/搜索器」接成 **play 生产侧 runtime 决策环**，并同时收敛 AI 阶段3/4（含当前阶段4c 红测）与清理三条已知残留。目标是「AI 真的在 play 对局里驱动 NPC 决策，且每一环都有能证伪的机器检查」。

调查确认的现状（请以工作树复核）：
- **零生产接线**：play 无 runtime 决策环；`l2/adapters/ai-adapter.ts` 是 dangling adapter；`NPC_QUEUE` 从不被填充。`makeCombatWorld` 只在测试里复刻了「多 Agent 组合根 + 敌方 AI」。
- **阶段4c 红测**（worktree 现状）：`combat-first.test.ts` 阶段4 `a:eternal-sleep` 预期收到的是 `a:heal`——强武器/治疗物价值估值未让 AI 选出终结。阶段2 已由之前 commit（81de9bd）收敛，不得倒退。
- **read-adapter 有未提交的 item-value projection**（`kernel/read-adapter.ts`，已 staged 17 行）：无 props 的物品把 Def 承载的 `value`/`effect` 摊成 `<id>.<字段>` 事实给设计货币，读侧只投影不越权组装，不拟合生编字段名。**目前零测试**，且它依赖 `this.deps.defRegistry?.resolve`。
- **`sequential-search.ts:234-236` 残留 P9 `console.log`**（当前仍在，含 `eslint-disable-next-line no-console`）：probe 残留，须清除。
- 分层依赖必须单向：play→l2→engine。AI 决策环必须建在 play 侧生产代码，不得让 AI 反向依赖 play 造成环。

## 你要做的事（全部）

1. **play 生产侧 AI runtime wiring（缺口1）**：建真正 composition root，在 play 生产代码里接 ActionCatalog、schedule phases、`DefRegistry`、`behaviorBindingFor`；把 `makeCombatWorld` 里已验证的多 Agent 组合逻辑复刻（非复制对局数据，按生产契约重建）到 play 生产路径；填充 `NPC_QUEUE`/喂入搜索。让「play 真调决策环」有端到端用例证明（非桩、非测试专用拼接）。消费的 ECS 契约一律用**已在 BATCH A 落地后的单一 source**（`component.*` 单一源、class-contract 交叉校验后），不得再自建一份并列形状。
2. **阶段4 收敛（缺口2）**：修复阶段4c `a:eternal-sleep` vs `a:heal` 红测。允许通过正确估值/正确动作集让 AI 选中终结；**禁止为过测试给分数表/动作集打针对输入补丁**。阶段4「强武器/治疗物更值」语义由 *分数表*（`weapon.E`/`medkit.heal` 费目）承载。
3. **read-adapter item projection 落测（缺口3）**：给已 staged 的 item-value projection 补真实测试（含 Def 存在的投影、Def 缺失的降级、不覆盖已存在事实、不越权组装）。若自洽后认为该投影设计有缺陷，明确说明并给替代设计，不静默塞 `include`/`exclude` 逃课。
4. **清理 probe 残留（缺口4）**：清除 `sequential-search.ts` 的 P9 `console.log` 及任何 `[PnPROBE]`/`eslint-disable` 残留；`grep -rn 'PnPROBE\|console.log\|eslint-disable-next-line no-console' src/core/kernel/ai` 清空后自证。
5. **AI skill PBT/防回归（缺口5）**：为 `scoreDesignCurrency`（deathAnchor/lethalWindow/费目查表 + 离散当量）、`sequential-search`（terminating scores、终局向量、`AI_EVALUATION_INVALID` 分支）加 property-based 测试，`numRuns≥100`，用项目既有 PBT 设施与既有 `design-currency-decision.test.ts` 风格。
6. **处理 dangling adapter（缺口6）**：`l2/adapters/ai-adapter.ts` 要么接上生产 wiring，要么删除并说明理由；不得留「存在但无人调」的中间态而不交代。

## 并行锁（严格遵守）

**独占可写**：`src/core/kernel/ai/**`、`src/play/**`（仅你新增的 AI production wiring 文件 + 端到端测试；**不**改动 play 的目录数据/既有行为）、`src/l2/adapters/ai-adapter.ts`、对应测试文件。`expr/engine.ts` 只允许保留 AI-line 已提交的 `isExprLeafObject`/`maxDepth` guard（不倒退其行为）。
**只读、绝不改**：`src/class/**`（含 `class-contract.ts`）、`src/l2/model/composition-registry.ts`、`src/l2/validation/**`、任何 `*.json` 数据、未跟踪 plan/bombard 文件。
**禁止全局覆盖**：不改他人交付物、不重构无关逻辑、不做数据迁移、不隐式关闭本会话之外的探针。

## 门禁（内部自证，全绿或如实归因）

- `npx tsc --noEmit`
- `npx vitest run`（`src/core/kernel/ai` 范围必须全绿含阶段3/4；再全量一次记录退出码与失败明细）
- `npm run lint`
- `npm run verify:docs`、`npm run verify:data`

## 收尾纪律
- 诚实汇报：wiring 怎么建、阶段4c 根因与修法、item projection 的处理去留及理由、清理了什么残留、PBT 覆盖面；哪些因黑名单未动；哪些是你的自主判断。
- 阶段4c 修复必须先给根因分析再给 patch，禁止「先看到红就蒙改」。
