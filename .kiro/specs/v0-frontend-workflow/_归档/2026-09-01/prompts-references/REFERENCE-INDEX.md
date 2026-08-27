# Prompt Pack References Index

本索引把 source attachmentId、AI brief、参考资产和 batch 绑定起来。`references/source/` 是 provenance 副本，不能替代 AI brief；`references/ai/` 是经过当前裁决、可脱离后端直接投喂的内容。

## 全局规则

- 先投喂 G-01..G-08，再投喂目标批次入口、对应 R-* numbered brief 和本索引登记的 A-*。
- `references/source/` 全部 `directToAi: false`，只用于 provenance/人工追溯；legacy/历史内容不得恢复为当前规则。
- `references/assets/` 的登记图片可直接附加；标题 PNG 不存在时必须标为 `pending`，不能用文字提示词冒充图片。
- G-01..G-08 约束：UI-only；允许使用登记素材/纹理/光效/立绘；禁止零素材口径；`+3极限爆发`不可选但保留选择/触发特效位；同屏并列选择≤5；editor/research-bench/material-library/computer 内部 UI 不生成。

## Source → AI brief → batch 映射

| source attachmentId | source 文件/素材 | AI brief | batch | directToAi | status | 历史/遗留说明 |
|---|---|---|---|---|---|---|
| `presentation-ui-01` | `source/presentation-ui-01.md` | `R-01-visual-ui-baseline.md` | B1/B2/B3/B4/B5/B6/B7 | false | current-rewritten | 视觉结论已重写为像素前景+全息投影光层；旧背景表述不作当前口令。 |
| `decision-d083` | `source/presentation-ui-01.md` §视觉风格 | `R-01-visual-ui-baseline.md` | B1/B2/B3/B4/B5/B6/B7 | false | current-ruling | 背景升级为暖/冷半透明全息光层，不等于暗黑科技终端。 |
| `presentation-animation-feedback-02` | `source/presentation-animation-feedback-02.md` | `R-02-motion-feedback.md` | B2/B3/B4/B7 | false | current-rewritten | 动画/声音只重演结果，旧高频全屏想法不恢复。 |
| `presentation-motion-index-03` | `source/presentation-motion-index-03.md` | `R-02-motion-feedback.md` | B2/B3/B4/B7 | false | inspiration-rewritten | 灵感索不是权威契约，只抽取当前母题、边角状态和 fallback。 |
| `presentation-motion-checklist-12` | `source/presentation-motion-checklist-12.md` | `R-02-motion-feedback.md` | B1/B2/B3/B4/B7 | false | current-rewritten | 只保留可跳过、reduced motion、错误和性能边界。 |
| `presentation-dynamic-completion-10` | `source/presentation-dynamic-completion-10.md` | `R-02-motion-feedback.md` | B2/B3/B4/B7 | false | current-rewritten | 补全终局/经济/连接表现结论；不把规则计算或内部调试 UI 投喂给 AI。 |
| `presentation-implementation-09` | `source/presentation-implementation-09.md` | `R-01-visual-ui-baseline.md` / `R-02-motion-feedback.md` / `R-03-narrative-dialog.md` | B1/B2/B4/B5/B7 | false | implementation-provenance | 仅用于工具映射追溯；AI brief 保留可替换端口和表现语义，不复制库路径。 |
| `presentation-dialog-06` | `source/presentation-dialog-06.md` | `R-03-narrative-dialog.md` | B4/B5 | false | current-rewritten | 对话交互改为声明式 intent；历史 onSelect 业务回调不进入 AI brief。 |
| `presentation-rpg-07` | `source/presentation-rpg-07.md` | `R-04-rpg-guidance-information.md` | B4/B5 | false | current-rewritten | RPG 模块统一为只读信息层，后置模块保留空/锁定边界。 |
| `operations-residence-03` | `source/operations-residence-03.md` | `R-05-residence-and-operations.md` | B3 | false | current-rewritten | 床门控、影子大厅、纯白显形和退出已重写；内部工具只留占位。 |
| `operations-outside-growth-01` | `source/operations-outside-growth-01.md` | `R-05-residence-and-operations.md` | B3/B4 | false | current-rewritten | 少 UI 与一人模式分离；反仓库边界只保留 UI 结论。 |
| `operations-safe-library-04` | `source/operations-safe-library-04.md` | `R-05-residence-and-operations.md` | B3/B4 | false | current-rewritten | 书架/保险箱/门缝职责仅用于入口标签，不生成内部页面。 |
| `operations-narrative-evidence-05` | `source/operations-narrative-evidence-05.md` | `R-03-narrative-dialog.md` | B4/B5 | false | current-rewritten | 证据提交只复用警官对话层；电脑内部应用不进入本 brief。 |
| `governance-journey-11` | `source/governance-journey-11.md` | `R-06-shell-and-journey.md` | B1/B3/B6 | false | current-ruling-rewritten | 采用标题→出租屋→匹配→入梦→对局→结算→返回；旧“无标题/回主菜单”是历史偏差。 |
| `governance-v0-shell-10` | `source/governance-v0-shell-10.md` | `R-06-shell-and-journey.md` | B1/B6/B7 | false | current-rewritten | 只抽取投喂、接线、验收纪律，后端路径不投喂。 |
| `governance-v0-system-12` | `source/governance-v0-system-12.md` | `R-08-v0-extraction-and-handoff.md` | B1/B6/B7 | false | current-rewritten | 偷师板/偷师前端是开发期展示/抽取流程，控制面板不是玩家产品页。 |
| `frontend-workflow-requirements` | `.kiro/specs/v0-frontend-workflow/requirements.md` | `R-01`–`R-08` | B1–B7 | false | current-contract | Prompt Pack 总边界 provenance；brief 不复制需求全文。 |
| `frontend-workflow-design` | `.kiro/specs/v0-frontend-workflow/design.md` | `R-01`–`R-08` | B1–B7 | false | current-contract | 页面/port/PromptPacket provenance；AI 只读重写 brief。 |
| `frontend-workflow-template` | `.kiro/specs/v0-frontend-workflow/v0-spec-template.md` | `R-01`–`R-08` | B1–B7 | false | current-contract | brief 已采用固定 15 节，不要求 AI 读取模板。 |
| `interview-decisions` | `source/interview-decisions.md` | `R-01`–`R-08` | B1–B7 | false | provenance-only | 只采用已同步的当前裁决；未冻结规则不写成 UI 事实。 |
| `bench-v0` | `source/bench-v0.md` | `R-07-excluded-systems-boundary.md` | B3/B6 | false | legacy-boundary | 研究台内部需求只作边界证据，不生成词条/锻造/合成 UI。 |
| `material-library-v0` | `source/material-library-v0.md` | `R-07-excluded-systems-boundary.md` | B3/B6 | false | legacy-boundary | 素材库内部需求只作边界证据，不生成卡片/搜索/蓝本 UI。 |
| `map-editor-iteration-v2` | `source/map-editor-iteration-v2.md` | `R-07-excluded-systems-boundary.md` | B3/B6 | false | legacy-boundary | 编辑器内部修正 prompt 只作历史 provenance，不生成画布/诊断/MapData UI。 |
| `pixel-painter-v0` | `source/pixel-painter-v0.md` | `R-07-excluded-systems-boundary.md` | B3/B6 | false | specialized-boundary | 绘制器是独立专项组件，不因入口引用而进入本 brief。 |

## AI-readable attachments

| attachmentId | AI 文件 | 主要内容 | batch | directToAi | status |
|---|---|---|---|---|---|
| `G-01`..`G-08` | `00-global/G-01...G-08` | 项目边界、tokens、ports、无障碍、动效、fixtures、冲突、页面索引 | B1–B7 | true | current-contract |
| `R-01` | `ai/R-01-visual-ui-baseline.md` | 视觉、色彩、层级、素材、视角 | B1–B7 | true | ready |
| `R-02` | `ai/R-02-motion-feedback.md` | 动效、音频、feedback、fallback | B2/B3/B4/B7 | true | ready |
| `R-03` | `ai/R-03-narrative-dialog.md` | 对话、立绘、字幕、语音 | B4/B5 | true | ready |
| `R-04` | `ai/R-04-rpg-guidance-information.md` | 任务、目标、教程、帮助、通知、统计、成就、图鉴、回顾 | B4/B5 | true | ready |
| `R-05` | `ai/R-05-residence-and-operations.md` | 驻地、匹配、床门控、错误返回、只读边界 | B3 | true | ready |
| `R-06` | `ai/R-06-shell-and-journey.md` | 标题、启动、完整旅程、端口接线 | B1/B6 | true | ready |
| `R-07` | `ai/R-07-excluded-systems-boundary.md` | 四类内部 UI 的边界占位 | B1/B3/B6 | true | ready |
| `R-08` | `ai/R-08-v0-extraction-and-handoff.md` | 控制面板抽取、mock→port、交接清单 | B6/B7 | true | ready |

## Visual assets

| assetId | fileName | source | page | batch | kind | status | directToAi | 说明 |
|---|---|---|---|---|---|---|---|---|
| `A-201` | `assets/A-201-hud-refined2.png` | `hud-visual-baseline` / 已登记 HUD refined2 | `hud-main` | B2 | image/png | ready | true | 当前 HUD 主空间参考；不代表规则或真实数据。 |
| `A-202` | `assets/A-202-hud-refined.png` | `hud-visual-baseline` / 已登记 HUD refined | `hud-main` | B2 | image/png | ready | true | HUD 备选构图参考。 |
| `A-203` | `assets/A-203-hud-v3-legacy-tier-reference.png` | `hud-legacy-v3` / 历史 HUD v3 | `hud-main` | B2 | image/png | legacy-reference | true | 只能识别旧 tier；不能恢复旧四档或使 +3 可选。 |
| `A-301` | `assets/A-301-menu-title-text-prompt.md` | `title-screen-prompt` / 标题文字提示词 | `menu-title` | B1 | prompt-text | pending | true | 真实标题 PNG 尚不存在；该文件不是截图。 |

## Batch handoff

| batch | AI brief | 页面/范围 | 推荐附件 | status |
|---|---|---|---|---|
| B1 | R-01/R-06/R-07 | 标题、启动、设置、壳层、入口边界 | G-01..G-08、A-301 pending | ready-for-generation |
| B2 | R-01/R-02 | HUD、动作反馈、投点、结算 | G-01..G-08、A-201/A-202/A-203 legacy | ready-for-generation |
| B3 | R-05/R-07 | 驻地、匹配、床、入口边界 | G-01..G-08；不投喂内部 source | ready-for-generation |
| B4 | R-02/R-03/R-04 | 暂停、错误、字幕、通知、信息 overlay | G-01..G-08 | ready-for-generation |
| B5 | R-03/R-04 | 对话、任务、教程、帮助、通知历史 | G-01..G-08 | ready-for-generation |
| B6 | R-06/R-07/R-08 | 全旅程、边界、抽取与接线 | G-01..G-08 | ready-for-generation |
| B7 | R-02/R-06/R-08 | 动效、声音、reduced motion、性能、抽取验收 | G-01..G-08、A-201/A-202 按需 | ready-for-generation |

## 历史/遗留说明

- 标题画面当前只有 A-301 文字提示词，真实 PNG 状态为 `pending`。
- A-203 是历史 HUD tier 参考；当前只允许 0/1/2，`+3` 为 disabled future 注记，不能恢复四档爆发。
- bench/material-library/map-editor/pixel-painter source 全部 `directToAi: false`；R-07 把它们改写成边界，而不是复制内部 UI。
- 旧“无标题画面”“直接进驻地/旧主菜单”“独立统一大厅”“零素材渲染”都不是当前目标；当前结论是标题前置、出租屋落地、影子大厅/异步匹配、素材允许。
- source 的后端路径、类名、内部字段只用于人工追溯；AI brief 必须脱离后端路径自包含。

## 投喂规则

批次入口 `B*-00`、G-01..G-08、目标 R-* 和本索引登记的 A-* 必须一起投喂。只投入口 Prompt、不投对应 numbered brief 或资产说明是不完整投喂。