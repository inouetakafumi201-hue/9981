# 专项批次 09 — 现行玩法全面扫描与迭代（到 demo 级无常识破绽）

> **性质**：可复制专项 prompt（本文件含一份可直接粘贴给全新会话的完整 prompt）。这份 prompt **完全脱离本批次撰写者的上下文**——接收它的会话不继承任何本项目的会话记忆，只能靠读文件 + 一次贯穿扫描得出自己的理解。这是刻意为之：只有剥离上下文、让新会话自己读一遍现行玩法，才能找出撰写者"想当然"看不到的破绽。
> **背景（2026-08-17）**：`wakeup-ai-tuning` 引擎接线已完成（facade 出 trace、config 可注入、live-runner 真实宿主、golden 可真跑）；`wakeup-loading-runtime` 整合层已落地（组合根 `createLoadedMatch` + `MatchShell` + `driveMatch`）。用户宣告：**现在没有并行任务了，且用户要求"这次迭代应当剥离你的上下文"**。目标从"实现 spec"转向"让 AI 实现 demo 级别的、无常识破绽的实际迭代"——即：以**当下现行玩法全体**为靶，扫描出未补全项，全面迭代到能拿出去演示的程度。
> **范围界定**：本批次只做「扫描 → 找未补全 → 迭代让 AI 无常识破绽」。**不新建玩法机制、不引入新 spec、不触碰表现/美术/叙事系统**（那些是现行玩法之外的成果，不是本批次的"玩法"对象）。"无需识破绽"指的是：把当下已实现的玩法（行动轮/体力、五阶段状态机、技能动作、物品装备、载体、AI NPC 决策）串成一个**可被旁观者外行的旁观者一眼看懂、且不会露馅（比如 AI 会做明显荒谬选择）**的完整循环。
> **并行状态**：用户已宣告无并行任务。本批次**单线**（一个会话串行完成），不拆多 agent，避免上下文交接丢失。

---

## 交付物锚点（读这几处即可建立现状全景，但不可只依赖记忆）

开工前**必须通读**以下文件（全部自上下文读，不可靠任何记忆）：
- 权威宪法与规则：`docs/L0_规范宪法.md`、`docs/00_主状态板.md`（进度真相源）、`docs/00_并行作战手册.md`（并行方法）、`docs/访谈决策记录.md`（D-001~D-082 全部裁决）。
- 玩法层设计/规则：`docs/L3_玩法层/`（01_行动轮与体力博弈系统、02_AI性格与难度配置、03_AI要玩法层提供什么）、`.kiro/specs/wakeup-core-mechanics/{requirements,design,tasks}.md`、`.kiro/specs/wakeup-core-mechanics-exhaustive/{requirements,design,tasks}.md`、`.kiro/specs/wakeup-space-items/requirements.md`。
- 现行玩法实现代码：`src/play/core-mechanics/`（五阶段状态机、AP/体力、动作/装置/规则 defs、`load.ts`、`match-lifecycle.ts`）、`src/play/profiles/`（武器/物品/状态/载具/NPC 的 JSON 实例）、`src/play/map/`（地图编译与 spawn）、`src/play/loading-runtime/`（生产组合根 `createLoadedMatch` + `MatchShell` + `driveMatch` 驱动一局）、`src/play/ai-runtime.ts`（`createPlayAiRuntime`，生产 AI 决策根）。
- AI 学习迭代系统（**本批次的迭代引擎**）：`.kiro/specs/wakeup-ai-tuning/{requirements,design,tasks}.md`、`.agents/skills/ai-tuning/SKILL.md`、`src/core/kernel/ai/tuning/`（config / assertions / golden-scenarios / attribution / tuner / orchestrator / live-runner / report）、`src/core/kernel/ai/design-currency.ts`、`src/core/kernel/ai/facade.ts`（trace 出口）、`src/play/ai-runtime.ts`（config 注入点）。
- 断点证据（哪些已交付、哪些是死代码、哪些留交接）：`docs/L_审查报告/*.md`、`docs/00_主状态板.md` 的「待立项专项」「交接项」「收束批次红灯」段落、`.kiro/specs/*/tasks.md` 的复选框状态。

---

## 当前已知的事实基线（本批次从这些出发，但要自行重新核实，不信即重验）

1. **核心机制已实现且测试全绿**：`src/play/core-mechanics/` 五阶段状态机（roll→settle→playerAction→npcAction→cleanup→roll）、AP 单动作原则、体力 1-5、downed/eternal-sleep/残血保命等语义，P01~P41 属性测试全绿。
2. **AI 决策链路已真接线**：`createPlayAiRuntime(designCurrencyConfig?)` 接受可注入费目表；`facade.act` 返回带 `DecisionTrace` 的结果；`makeLiveAssertionRunner` 是生产断言宿主（恢复世界快照→真实 facade.act→回 trace）；golden 断言可真跑。
3. **整合层已落地**：`createLoadedMatch` 把引擎/玩法/AI/地图/外壳串成一局；`driveMatch` 生产端到端驱动一局；`MatchShell` 管回合/终局/拒绝提交。
4. **一个已知缺口（真实空档，本批次须处理）**：**调参 JSON → 生产对局**之间没有接线——`createLoadedMatch` 内部的 `createPlayAiRuntime` **没有注入** `designCurrencyConfig`（`src/play/loading-runtime/index.ts:200`）。所以现在调整设计货币费目表，**只对测试侧组合根（`_shared.ts` 的 `makeRuntimeFor`）生效，不改变生产 `LoadedMatch` 里的真实 AI 决策**。这是"迭代 AI 参数/表格"真正要拧上生产对局这颗螺丝的断点。
5. **迭代闭环的架构边界**（实测结论，非缺陷）：真实对局里所有候选动作共享同一 rootSlice breakdown，归因只能 diffFromSingle 回退；调 `e:enemy.vitality` 的 unit 会同等移动所有候选终端分数→排序不变→cycle-detected。这是防转圈设计行为。**本批次不试图绕过它，而是把它当已知边界**：迭代只能改"能真正改变相对排序"的设计货币项，或通过构造真实多费目贡献的断言场景来达成闭环验证。

---

## 唯一产出与目标

**一个能闭环的真实迭代**：从扫描现行玩法出发，找出"AI 在某个真实对局场景里会做出常识性荒谬选择"的实际破绽（不是人为捏造，而是现行玩法/AI 配置下确实会发生的那种），然后**把它变成一条真实红断言，跑真实 `runTuningCycle`，在 ≤12 轮内调 JSON 费目表，让生产 AI（经 `createLoadedMatch` + `driveMatch`）从选错变选对，golden 全绿**。收尾时交付「为什么扫到它 → 扫描依据 → 迭代怎么改对 → 改对后的行为证据」的人类可读报告。

**目标的三层含义（从低到高，都要满足）**：
- **层 1（必达）**：现状靶通读后形成一份「未补全项清单」，含每一项的【证据/根因/影响/是否本批次处理/是否留给别线】——这是"扫描现行玩法找未补全"的落纸产出，必须如实列，不谎报完成。
- **层 2（核心交付）**：让 AI 在真实生产组合根上跑一圈，找出一处真实常识破绽，用 ai-tuning 闭环把它调对（真实 config 注入 → 生产 AI 行为真变化）。这是"AI 迭代的实际效果"。
- **层 3（演示级）**：把"一局"用生产 `createLoadedMatch` + `driveMatch` 跑通到终局，作为 demo 的最小骨架（有多位参与者 + 玩家行动 + NPC 决策 + 终局判定），证明现有玩法能作为一个可被外行看懂、不会露馅的对局被驱动。

**交付物清单（落盘位置明确）**：
1. `docs/工程治理/09_《现行玩法未补全项清单与迭代报告》.md` —— 完整的扫描清单 + 迭代闭环实证 + demo 对局跑通证据。
2. 若需新增代码/测试才能达成层 2，落 `test/ai-tuning/`（新测试）或 `src/core/kernel/ai/tuning/`（仅测试辅助或 config 数据，不改组件语义）；若需给 `createLoadedMatch` 补 `designCurrencyConfig` 注入点，落 `src/play/loading-runtime/index.ts`（见下方边界审议项）。
3. 迭代收敛后固化的断言入 `src/core/kernel/ai/tuning/assertions/`。

### 边界审议项（写权争议点在动手前先自判，能不动就不动）

- **优先级零**：`test/ai-tuning/`（新目录，本批次独占）、`src/core/kernel/ai/tuning/`（本专项交付物，可改测试辅助；组件语义不改）、`docs/工程治理/`（新建本报告）。这些无争议。
- **须谨慎**：给 `createLoadedMatch` 补 `designCurrencyConfig` 注入（`src/play/loading-runtime/index.ts`）。这是**达成"调参生效于生产对局"的正道**，但它是 loading-runtime 专项的交付物。**判定**：这是使能性补全（加一个可选 option 透传，不改既有默认行为），且是本目标（生产 AI 真吃调参）的必要条件，属"消费方接线项"而非"跨 Spec 改别人语义"。**若你评估后发现存在更小接触面的做法（比如只在一个新测试组合根里注入，而非改生产组合根），优先做更小接触面，并在报告里如实登记未改生产组合根。** 那条边界在 report 里写清你做了哪一层即可。
- **红线（绝不碰）**：`src/class/**`、`src/ui/**`、`src/l2/**`、`src/core/ugc/**`、`src/devboard/**`、表现/美术/叙事系统文档与产物；不改任何 spec 的 `tasks.md` 复选框（那是别的主控账）；不改 `design-currency.ts` 的默认分值/原则表（回归红线）；不新建玩法机制/spec。

---

## 门禁（收尾必须全绿）

- `npx tsc --noEmit`（全域 0 err；若 loading-runtime 既有并行线产物报错属他线，登记不代修）
- `npx vitest run src/core/kernel/ai test/ai-tuning src/play/loading-runtime`（相关范围；你新增的迭代闭环 e2e 必须绿）
- `npm run lint`（0 error）
- `npm run verify:docs`（术语一致性，新增文档不得引入废用词）
- 额外：新 golden 断言必须真跑通过（用 live-runner），不能只是"写了断言"。

## 收尾综述纪律（不符即算未完成）

- 分三层如实汇报：①扫到的未补全项清单（含证据与归属）②迭代闭环实证（红断言怎么来自现实、怎么调对、生产 AI 行为怎么变化、golden 怎么全绿）③demo 对局跑通证据（参与者/行动/NPC/终局完整一轮）。
- 未达成的层必须醒目标出（比如"生产组合根本批次未注入 config，因为边界判断为不可动"，或"找不到真实可调的常识破绽，只构造了测试场景"），不得谎报全部达成。
- 写明你作为无上下文的进场者，哪些"文档说的现状"和你实测不符——这正是本次剥离上下文的价值所在，务必记下来。

---

## 可复制 prompt（粘贴给全新会话）

```text
你是 WakeUp 项目「现行玩法全面迭代（demo 级无常识破绽）」专项的立项认领者。工作目录 D:\coding\WakeUp。
你是一个全新会话，**不带任何本项目的历史会话记忆**。你的全部理解必须来自读文件 + 亲手扫描。
本任务：扫描当下现行玩法的全部，找出未补全项，然后全面迭代，让 AI 达到 demo 级别、无常识破绽的实际效果。
迭代不是"再实现一个 spec"，而是"把已实现的东西串成能跑、能看、不露馅的一局"。

【第一步——现状全景（自上下文读，逐份读，不可靠记忆跳读）】
通读：docs/L0_规范宪法.md、docs/00_主状态板.md、docs/00_并行作战手册.md、docs/访谈决策记录.md；
玩法层 docs/L3_玩法层/ 三份；spec .kiro/specs/wakeup-core-mechanics/{requirements,design,tasks}.md、
.kiro/specs/wakeup-core-mechanics-exhaustive/{requirements,design,tasks}.md、.kiro/specs/wakeup-space-items/requirements.md；
代码 src/play/core-mechanics/、src/play/profiles/、src/play/map/、src/play/loading-runtime/、
src/play/ai-runtime.ts；AI 调参 .kiro/specs/wakeup-ai-tuning/ 三份 + .agents/skills/ai-tuning/SKILL.md +
src/core/kernel/ai/tuning/ + src/core/kernel/ai/design-currency.ts + src/core/kernel/ai/facade.ts；
断点 docs/L_审查报告/*.md + 主状态板的"待立项专项/交接项/收束批次红灯"。

【第二步——扫描未补全项，落纸】
读完后，形成「现行玩法未补全项清单」，每项含【证据路径、根因、对 demo 的影响、是否本批次处理、是否留别线】。
重点扫描这些方向（不限于）：
- 现行玩法是否能被生产组合根 createLoadedMatch + driveMatch 完整驱动一次（玩家行动 + NPC 决策 + 终局判定）？缺什么？
- AI 在真实对局里会不会做出常识性荒谬选择？（比如残血主角 AI 不去保命、攻击已倒地的敌人不去终结、满 AP 却空过……）
- 调参 JSON 是否真的能改变生产对局里的 AI 行为？（已知：createLoadedMatch 内部 createPlayAiRuntime 未注入 designCurrencyConfig——核实并决定动法）
- 哪些 profiles/武器/物品/状态是死数据、没被任何动作/规则消费？（扫描链接的连通性，而非只看是否有文件）

【第三步——迭代闭环（核心交付）】
基于第二步扫出的真实破绽（优先选生产对局真会发生的那种），构造一条真实红断言（真实世界快照 + 真实 facade.act），
跑真实 runTuningCycle，在 ≤12 轮内调 JSON 费目表，让生产 AI 从选错变选对，golden 全绿。
- 调参必须经真实 ParameterTuner 改 JSON，不得手工硬写默认表。
- 若需要给 createLoadedMatch 补 designCurrencyConfig 注入才让生产真吃调参，先评估更小接触面（新测试组合根注入 vs 改生产组合根），能不做大的就不做；report 里写明你做了哪一层。
- 已知防转圈边界：真实对局候选共享 rootSlice breakdown → 调 unit 不改相对排序是正常行为，不是 bug；不要试图绕过它。
- 固化：闭环成功且 golden 全绿才 solidifyAssertion 入断言集。

【第四步——demo 对局骨架（演示级）】
用生产 createLoadedMatch + driveMatch 驱动一局到终局，作为最小演示骨架：有多位参与者 + 玩家行动 + NPC 真实决策 + 终局判定。
提供可复现的运行方式（一条命令起一局 / 一个可跑的驱动脚本），证明现行玩法能作为可被外行看懂、不会露馅的对局被驱动。

【写权（独占/谨慎两级）】
- 独占可改：test/ai-tuning/（新目录）、src/core/kernel/ai/tuning/（改测试辅助/断言/config 数据，不改组件语义）、docs/工程治理/（新建本批次报告）。
- 谨慎：src/play/loading-runtime/index.ts 补 designCurrencyConfig 注入（使能性补全，能小则小，report 写明）。
- 绝不碰：src/class、src/ui、src/l2、src/core/ugc、src/devboard、表现/美术/叙事系统、各 spec 的 tasks.md 复选框、design-currency.ts 默认分值/原则表。不新建玩法机制/spec。

【门禁（收尾全绿，缺一不算完成）】
npx tsc --noEmit（全域 0 err）、npx vitest run src/core/kernel/ai test/ai-tuning src/play/loading-runtime（相关范围 + 你新增的迭代 e2e）、
npm run lint（0 error）、npm run verify:docs（无废用词）。
新断言必须真跑通过（live-runner），不只是"写了断言"。

【收尾综述——三层如实汇报，缺层醒目标出，不符即未完成】
①扫到的未补全项清单（含证据/根因/影响/归属，不谎报）
②迭代闭环实证（红断言怎么来自现实→怎么调对→生产 AI 行为怎么变化→golden 怎么全绿）
③demo 对局跑通证据（参与者/行动/NPC/终局完整一轮）
若哪层没做成，醒目标出原因和边界判断；不得谎报完成。作为无上下文进场者，把"文档说的现状和你实测不符"的点记进报告——这正是本任务的价值。
```

---

## 批次执行说明

- **单线串行**：本批次不拆多 agent。原因：目标高度依赖"通读→扫描→找破绽→迭代"的上下文连续性，拆开会引入交接丢失，正与用户"剥离上下文"的意图相反。
- **剥离上下文的用意**：接收该 prompt 的会话不带本项目记忆，必须自己把现行玩法读一遍。这样扫出来的未补全项是"外行旁观者视角"的真实破绽，而非撰写者想当然认为的完整。
- **验收**：stage 2 的迭代闭环 + stage 3 的 demo 对局是"AI 迭代做用例测试"的最终验收门；主状态板登记推进。
