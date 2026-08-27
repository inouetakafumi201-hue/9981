# Tasks — 玩法层彻查与补全（专项 CEME）

## 概述

本任务清单把 S3 立项轮廓七项缺漏 C-1~C-7 各落为一个补全任务，外加额外扫描登记（C-8）、边界/交接登记（C-9）与收账与门禁收口（C-10）。实现语言为已有 TypeScript / fast-check（沿用全仓测试生态），**不新建 go/rust 等语言**。红线：不修改 `src/play/core-mechanics/` 任何既有源码；所有玩法层改动只能以"新增玩法层声明式定义、新增规则、新增测试"落地，不得把终局/胜负/出生/参与者/过载实现塞进既有文件而改写它们。

依赖关系：C-1/C-2 是地基（各自独立）；C-4 依赖 C-2（出生装配指向参与者注册）；C-3/C-5 依赖 C-1（终局判定与胜负都读结局种类）；C-6 依赖 C-2（NPC 队列挂相位）与既有 `ai-runtime.ts`；C-7 独立裁决归属。检查点（Checkpoint）布置在每完成一项补全规则 + 契约测试后。

### 任务目录（编号 = 缺口）

| 编号 | 缺口 | 落地形态 |
|---|---|---|
| C-1 | 结局种类非空守恒集 + 可测试契约 | 填 `CoreMechanicsPlaypack.outcomes` 相关依赖的声明 + 契约测试 |
| C-2 | 参与者资格装载自动注册 | 新增装载期参与者注册 + PLAYER_QUEUE_GAP 结算测试 |
| C-3 | round 计数与终结点 | 新增回绕计数规则 + 终局判定字段 |
| C-4 | 出生规则 | 文档 + 新增出生装配规则与起始体力声明 |
| C-5 | 胜负结算 | `when→rank→ends` 读写环 + 只读胜负查询 |
| C-6 | AI runtime 接入 | `createPlayAiRuntime` 消费装载 + npcAction 相位挂载 + 同判罚测试 |
| C-7 | OVERLOAD_GAP 归属 | 归属裁决声明 + 收束实现或交接登记 |
| C-8 | 额外扫描登记 | design 额外扫描结论 + 缺口/交接登记 |
| C-9 | 边界/交接项 | 专项 B / 基类层 / 地图契约扩展的交接登记 |
| C-10 | 收账与门禁收口 | 主状态板入账、归档、门禁全绿 |

> 说明：本文稿任务**不要求**立刻把 C-1/C-3/C-5 的终局/胜负读写环做进生产 `src/play/core-mechanics/`（那会改写既有源码，违反红线）。每个任务的落地是**新增独立的玩法层声明文件 / 规则文件 / 测试**，放在 `src/play/` 新增子目录（如 `src/play/match-core/`，命名以 owner 拍板为准，沿用 S2 §Q-1 对模块名的待裁状态）。既有 `CoreMechanicsPlaypack.outcomes` 的"填充"通过**新增的声明组装模块**引用而非改写 `playpack.ts` 本体，避免触碰红线。

---

## 任务

- [ ] 1. C-1 结局种类：非空守恒集声明 + 契约测试
  - 新增 `src/play/match-core/` 子目录（或 owner 裁定落点）放结局种类声明组装模块，从 `src/play/core-mechanics/defs/playpack.ts` 只读导出并在其上补非空 `outcomes` 守恒集，不改写 `playpack.ts`。
  - 每条结局 `OutcomeDef`：`when` 纯读 Expr、`scope` 合法、`rank?` 内部量级、`onReach` 走合法事件链、`ends` 二值明确。
  - 契约测试断言：`outcomes` 非空、结构合法、`when` 可机械求值、终局判定字段写入走 `OpRegistry.invoke`、符合 `OutcomeDef` 引擎层形状。
  - _要求：20.2、20.3、20.4、20.11、20.12_

- [ ]* 1.1 C-1 属性测试
  - **属性 1：结局簿非空且结构合法**
  - **验证：要求 20.2, 20.3, 20.4, 20.11**

- [ ] 2. C-2 参与者资格装载自动注册（PLAYER_QUEUE_GAP 结算）
  - 新增装载期参与者注册流程：为入局玩家实体打 `play:roll-participant` 标记 + 写 `rollTier` 起点，令其进入 `playerQueue` 生产注册（`turnOrder` 长度恒等于 `playerQueue` 长度，复用 `settleOnExit` 守卫，不重复实现守卫）。
  - 转正 M10 手动清法：测试只断言生产注册行为，不再承担装载语义。
  - 无外部宿主写权：所有写入经 `OpRegistry.invoke`（`tag.add`/`prop.set`），`turnOrder`/`playerQueue` 一致性在装载期/首个结算断言。
  - 永久退出者装载后不再满足参与者谓词（复用 `permanentExitAttachment.onAdd` 的 tag del，断言闭环）。
  - _要求：24.1、24.2、24.3、24.4、24.5、24.6、24.7_

- [ ]* 2.1 C-2 属性测试
  - **属性 4：参与者-队列-顺序三者一致**；**属性 5：参与者资格装载期注册**
  - **验证：要求 24.1, 24.3, 24.8；24.2, 24.5, 24.6**

- [ ] 3. 检查点 — C-1/C-2 地基
  - C-1 结局种类声明 + C-2 参与者自动注册的契约测试与门禁（tsc/vitest/lint）通过。
  - 确认 C-1/C-2 各自独立可并行落地，不共享可写文件（C-2 只读 C-1 的结局声明模块，不改它）。

- [ ] 4. C-3 round 计数与终结点
  - 新增 round 回绕计数规则：每轮 cleanup→roll 回绕 `world.props.play.round` +1（internal 归属）。
  - 新增终局判定字段写入：当结局 `ends:true` 达成时把 `world.props.play.matchEnded` false→true 置位（内部值，投影不展示）。
  - 只读终局查询：暴露 `matchEnded()` 与终结详情，供对局外壳（专项 B）消费。
  - 终局写入不绕过既有五阶段守卫：当前阶段尚不满足推进条件时照常拒绝（复用 `settleOnExit`/`playerActionOnExit`/`npcActionOnExit`/`cleanupOnExit`，不重复实现）。
  - _要求：23.1-23.9_

- [ ]* 4.1 C-3 属性测试
  - **属性 2：终局判定单调单向**；**属性 3：round 计数只增不减**；**属性 11：终局写入不绕过阶段守卫**
  - **验证：要求 23.4, 23.9；23.1, 23.9；23.6, 23.7**

- [ ] 5. C-4 出生规则（起点装配）
  - 明确出生规则承载面：空态 `createEmptyWorldState` → 出生起点装配 → 参与者就位 → 首个 roll。
  - 起始体力显式声明归属（1-5 或合法内部量级）；玩家与 NPC 出生路径分离（NPC 走 `NpcBudgetBinding` + AI runtime 稳定编号，不混玩家路径）。
  - 出生起点写入全部走合法 Op；装载失败原子拒绝，无部分起点落地。
  - 与 C-2 的参与者注册衔接（出生装配指向参与者自动注册）。
  - 具体五角色出生数值 / 落点保持未冻结接口，只明确承载面（不默认化）。
  - _要求：25.1-25.7_

- [ ]* 5.1 C-4 属性测试
  - **属性 6：出生装配起点合法且原子**
  - **验证：要求 25.2, 25.5, 25.7**

- [ ] 6. C-5 胜负结算（OutcomeDef 真实用法）
  - 实现 `when→rank→ends` 胜负读写环：当 `when` 真且 `ends:true` 记终结结局（同 scope rank 最高优先、相等 rank 稳定唯一、replay 复现次序）。
  - `onReach` 走合法事件链，失败整体回滚。
  - 只读胜负查询暴露：是否已有胜负 / 终结结局名 / 终结 scope / 胜出者 rank。
  - 不实现 `victoryCondition` 具体模式胜负平衡；只提供"胜出者查询"承载面，`05`BattleRoyaleMode 消费它。
  - _要求：26.1-26.9_

- [ ]* 6.1 C-5 属性测试
  - **属性 7：胜负单真源与优先次序**
  - **验证：要求 26.2, 26.3, 26.6**

- [ ] 7. C-6 AI runtime 接入装载/推进相位
  - `createPlayAiRuntime` 消费 `loadCoreMechanics` 的同一 holder / registry / ruleProvider / playpackLoader。
  - `seedNpcQueue` 写 `PATH_NPC_QUEUE`、`popNextNpc` 消费队列头决策，均挂 `npcAction` 相位；AI 经 `CoreMechanicsFacade.submit` 提交通一判罚路径。
  - 玩家体 AI 参与行动轮（D-052/D-053），NPC（`play:npc`）不参与玩家投点/行动轮。
  - 契约断言：AI 请求与玩家请求得到相同合法性与拒绝原因；与 `createFullHarness` 的 Op/Hook/Holder 装配不冲突（装配一致性）。
  - _要求：27.1-27.7_

- [ ]* 7.1 C-6 属性测试
  - **属性 8：同一判罚路径**
  - **验证：要求 27.4, 27.5**

- [ ] 8. C-7 OVERLOAD_GAP 归属裁决 + 收束/交接
  - 归属裁决：把过载收束到 `src/play/core-mechanics`（新增 D-055 过载规则挂 `pool.overflow`/`play.stamina.grant` 超上限）或将 legacy `action-turn/playpack.json` 登记为唯一权威（交接专项 B 收账）。
  - 无论哪侧，配置校验（`validateOverloadConfig` 6 项）与运行期结算指向同一权威，不出现"配置受校验却从不被消费"或双实现分叉。
  - D-055"清理阶段自然恢复不触发过载"（Requirement 6.22）边界固定。
  - 若收束 core-mechanics：交付物为新增过载规则（新声明式定义，不改写 `rules.phase.ts`）+ 对应测试。
  - _要求：28.1-28.6_

- [ ]* 8.1 C-7 属性测试
  - **属性 9：过载唯一权威**
  - **验证：要求 28.3, 28.5**

- [ ] 9. 检查点 — C-3/C-4/C-5/C-6/C-7 补全
  - round/终局、出生、胜负、AI 接入、过载归属各补全任务与契约测试 + 属性测试门禁通过。
  - 七项缺漏 C-1~C-7 全部有定义与任务覆盖（design 回溯表逐项核对）。

- [ ] 10. C-8 额外扫描登记
  - 完成 `src/play/` 下"本 Spec 范围之外 / 待下游"注释、所有 `GAP` 登记、未冻结玩法层语义扫描，逐项登记为缺口或消解记录。
  - 已知跨线项（MapData `floor→layers` 契约扩展、素材库元状态、可用性钩子桩、L1↔L2 桥）登记为衔接项，不做实现、不做替换 MVP。
  - _要求：29.1-29.4_

- [ ]* 10.1 C-8 属性测试
  - **属性 13：扫描项不顺手实现**
  - **验证：要求 29.2, 29.4**

- [ ] 11. C-9 边界与交接项登记
  - 将生产组合根、对局外壳、UI 宿主、UI/AI 消费胜负查询、`matchEnd` 对外态切换登记为专项 B 交接项；L1↔L2 桥登记为基类层缺漏；MapData 契约扩展登记为独立专项。
  - 每条带 `*contract*` 断言面断言"该接线数据通、方向对、无越权写"。
  - _要求：21.1-21.7_

- [ ]* 11.1 C-9 属性测试
  - **属性 10：可自证 vs 交接可区分**；**属性 12：结局种类承载面不默认化具体模式**
  - **验证：要求 30.2, 30.3；20.13, 21.4, 31.2**

- [ ] 12. 收账与门禁收口（C-10）
  - 结算 `PLAYER_QUEUE_GAP` / `OVERLOAD_GAP` 登记状态，主状态板入账（S3 收账项）。
  - 归档本 spec 到 `L_归档`（按 S3 §三交付物 5）。
  - 门禁全绿：`npx tsc --noEmit`（全域 0 err）、`npx vitest run`（相关范围）、`npm run lint`、`npm run verify:docs`。
  - 收尾综述：如实列明哪些可在玩法层内自证（C-1/C-2/C-3/C-4/C-5 读写环、C-6 同判罚、C-7 归属声明），哪些交接给专项 B/基类层/独立专项；不得谎报完成。
  - _要求：30.1-30.5、31.1-31.4_

---

## 备注

- 本文稿是**纯规格交付**，任务 12 的收账/门禁是规格的机器核对与登记，不属于玩法规格外的业务实现。
- C-1/C-3/C-5 的"终局字段 read/write"依赖引擎层既有 `outcome.reach`（只记录事实）与 `world.props.play.*` 可写自由区；**不修改** `schedule-ops.ts` / `outcome-ops.ts`（引擎层接口不变，Requirement 19.3 沿用）。
- 全程速成纪律：不省 token、不做 MVP、不硬编码。每条规则、每个测试都完整实现并跑通门禁。
- 交接项（专项 B / 基类层 / 地图契约扩展）只登记，不实现；本 CEME 的玩法层补全不等专项 B。
