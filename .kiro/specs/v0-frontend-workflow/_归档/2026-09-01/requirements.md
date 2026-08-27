# 偷师前端前置设计 Requirements

## 简介

本规范定义 WakeUp「偷师前端」Prompt Pack 的结构性合同。它面向 V0.dev 或其他前端生成 AI，产出完整、可演示、可抽取、可追溯的 UI 壳层；不产出玩法规则、后端、地图拓扑或运行时接线代码。

Prompt Pack 的组织方式是 `B1..B7` 的独立命令：每个 `B{n}-00` 与同目录 numbered briefs 构成一个可单独投喂、可执行的命令单元。`Batch 0`、`G-*`、`R-*` 和参考资产是可选深度附件；前序批次只作为非阻塞的已有项目能力参考。AI 可读取整个现有前端项目并按范围写锁直接修改；命令不依赖对话记忆。`.kiro/specs/v0-frontend-workflow/prompts/` 是只读输入区；本规范不要求或授权修改该目录。

## 术语表

- 偷师前端：只负责 UI 表现、状态切换、输入反馈、动效和页面编排的壳层。
- Prompt Pack：B1-B7 独立命令入口、同目录 numbered briefs、可选深度附件和 source provenance 的可携带投喂包；Batch 0/G/R/资产不构成命令启动前置。
- AI-readable brief：不要求 AI 读取后端或源文档即可执行的 brief；所有必要决策、边界、失败态和验收条件必须写在 brief 或其直接附件中。
- numbered brief：带 `B{n}-{nn}` 编号的批次附件；入口 Prompt 也属于固定结构 brief。
- 独立命令：`B{n}-00` 入口与其同目录 numbered briefs 的最小投喂单元；不要求 Batch 0、其他批次输出或对话历史存在。
- 深度附件：`Batch 0`、`G-*`、`R-*`、参考资产及其他可选上下文；用于增加约束和追溯，不是独立命令的启动前置条件。
- 自包含附件：被入口清单直接列出、路径可解析、内容足以支撑当前命令的 AI-readable 附件；不能只给一个源文档路径让 AI 自行猜测。
- source provenance：记录附件结论来自哪个权威源的追溯信息；provenance 供人工审计，不是 AI 的隐式规则入口。
- 参考资产 manifest：登记可直接投喂的图片、文字提示和其他视觉资产，包含 asset id、路径、用途、可用性和约束。
- 控制面板：UI 页面切换、变体切换、类别筛选、动画演示和后续抽取的唯一稳定表面，不是玩法控制台。
- heritage text：历史文档中的旧表述，只可作为冲突或边界证据，不能恢复为当前产品语义。
- 完整旅程：`startup-loading → menu-title → residence-main → matching/roaming → bed-front-ready → transition-battle-intro → transition-dream(enter) → hud-main → overlays → transition-result/reward → transition-dream(return) → residence-main`，并覆盖每个节点的失败回退。

## 要求

### 1. 作用域与用户裁决

作为项目所有者，我想要 UI 壳层与玩法/工具系统彻底隔离，以便任何批次都不会把生成 AI 引向错误的实现边界。

#### 验收标准

- WHEN 规范或 brief 定义作用域时，THE specification SHALL 将 `editor`、`research-bench`、`material-library`、`computer` 的内部 UI，以及地图节点、拓扑、节点移动、ORCA、pathfinding、路径成本、AI 决策和 gameplay rules 标记为 out-of-scope。
- WHEN 驻地展示上述四个系统时，THE specification SHALL 只允许入口占位和职责说明，不得展开内部页面。
- WHEN 规范涉及标题画面、启动加载、暂停、设置、驻地、battle HUD、叙事、任务、教程、通知、统计、成就、图鉴、回顾、过渡屏或控制面板时，THE specification SHALL 将其标记为 in-scope。
- IF 源文档仍有排除项描述，THEN the specification SHALL 将其记录为 heritage/boundary text，而 SHALL NOT 将其提升为产品语义。
- 素材允许使用已登记成品、纹理、光效、立绘、图标和参考图；任何验收 SHALL NOT 以“零素材渲染”为目标或替代素材挂载验证。

### 2. Prompt Pack 独立命令结构

作为项目所有者，我想要每个批次入口都能脱离投喂顺序和对话历史执行，以便命令可复用、可重试，且交接关系不会被误解为运行前置条件。

#### 验收标准

- Prompt Pack SHALL 登记 `B1`、`B2`、`B3`、`B4`、`B5`、`B6`、`B7`，且每个批次 SHALL 有一个 `B{n}-00` 独立命令入口和同目录 numbered briefs。
- `Batch 0`、`G-01` 至 `G-08`、`R-*` 和参考资产 SHALL 是可选深度附件；它们不得成为任一 `B{n}-00` 命令的执行前置条件。
- 每个 `B{n}-00` SHALL 以本批次入口和同目录 briefs 为最小投喂包，并 SHALL 声明单一主目标、页面、范围写锁、失败态覆盖、验收条件和可选附件清单。
- `dependsOn` SHALL 只表达前序批次的能力参考与交接顺序，不阻塞命令启动、代码读取、已有能力复用或最小挂载点补齐；依赖图表示交接顺序而非命令阻塞。
- AI SHALL NOT 依赖对话记忆；AI MAY 读取整个现有前端项目，复用已有代码，并在当前命令范围写锁内直接修改项目。
- 每个批次 SHALL 声明 `batchId`、目标、页面、依赖、`executionMode`、写边界、附件清单、失败态覆盖和验收条件；不得以未命名的“后续批次”替代。

### 3. AI-readable brief 完整性

作为项目所有者，我想要无上下文 AI 能直接消费每份 brief，以便生成 AI 不会因为缺少隐含背景而自行发明页面或规则。

#### 验收标准

- 每份 G-* 和 B*-xx brief（包括批次入口 Prompt）SHALL 按固定顺序包含且仅以该顺序编号的 15 节：
  1. 页面定位；2. 权威来源（attachmentId / provenance）；3. 当前决策；4. 状态机；5. 组件树；6. 只读数据；7. 动作意图；8. 本地 UI 状态；9. 视觉令牌；10. 动效绑定；11. 输入无障碍；12. 加载错误超时；13. 明确不做；14. 依赖交接；15. 验收条件。
- 15 节 SHALL 均非空；缺节、乱序、重复节号或使用未登记同义章节名 SHALL 标记为 incomplete。
- brief SHALL 把当前决策、失败/空态、取消、重试、安全返回、可访问性和明确不做写在自身或直接附件中；不得要求 AI 自行读取后端、数据库或隐藏规则实现。AI 可读取现有前端项目以复用代码。
- brief 中的页面 id、状态 id、intent id、组件名和 asset id SHALL 在入口、生成代码约定和抽取交接中保持一致。
- brief 中的 mock 数据 SHALL 显式标记 `mock`；mock 不得被描述为已确认规则结果。
- brief 中的交互 SHALL 使用显式 intent；不得用直接 `onSelect` 回调承载任务、奖励、匹配、结算、存档或规则写入。

### 4. 自包含附件与 source provenance

作为项目所有者，我想要附件可解析、来源可追溯但不把源文档当作隐式产品合同。

#### 验收标准

- 每个批次入口 SHALL 先列本批次 `B{n}-00` 和同目录 numbered briefs；`Batch 0`、G-*、R-*、参考资产及前序批次能力 SHALL 作为可选深度附件另列，不得写成启动前置。
- 每个直接附件 SHALL 有唯一 `attachmentId`、规范化路径、`directToAi` 标记和用途；入口列出的路径不存在时批次 SHALL 标记为 incomplete。
- AI-readable 附件 SHALL 足以支撑对应页面；source copy 只能通过 `attachmentId` / `provenance` 追溯，不能成为 AI 必须自行阅读的隐藏依赖。
- `source provenance` SHALL 记录来源文档、覆盖范围、当前角色（normative/support/boundary）和冲突处置；边界源不得被当作产品语义。
- `backendPathOnlyReferences` SHALL 被拒绝：只给内部后端路径、类名或实现位置而无可读附件内容，不满足自包含性。
- 每个批次 SHALL 提供附加附件核对清单，至少检查路径、attachmentId、直接投喂资格、来源角色和 checksum 状态。

### 5. PageCatalog 完整性

作为项目所有者，我想要页面目录与 G-08 一致，以便新增页面不会被“16 页”旧说明遗漏。

#### 验收标准

- PageCatalog SHALL 至少登记 G-08 的以下页面：`startup-loading`、`quest-log`、`objective-tracker`、`tutorial-help`、`location-title`、`notification-history`、`stats`、`achievements`、`codex`、`recap`。
- 页面目录 SHALL 以“基础页目录 + 扩展页目录”组织，或给出覆盖全部页面的单一完整目录；不得继续声称全包只有 16 页。
- 完整目录至少包含 26 个页面：基础 16 页加上述 10 个扩展页，并登记 family、batch、主要状态、变体/入口、source provenance 和参考资产基线状态。
- `control-panel-main` SHALL 是唯一稳定切换/抽取表面；新增页面必须通过该表面挂载，不能另建全局导航中心。
- 页面描述 SHALL 只表达 UI surface，不得赋予地图拓扑或玩法规则语义。

### 6. 控制面板与交互状态

作为项目所有者，我想要所有可见控制都有确定的呈现反馈，但不执行规则。

#### 验收标准

- 控制面板 SHALL 支持页面切换、类别筛选、呈现变体切换、`state-transition` 播放和 `click-play` 播放。
- 页面切换 SHALL 只改变 UI surface；类别筛选 SHALL 只过滤呈现；变体 SHALL 是呈现变体，不是玩法变体。
- 每个可见控件 SHALL 定义 hover、focus、active、disabled 和 return state；颜色不得是唯一语义。
- placeholder-only 控件只能改变局部呈现；所有 pending、accepted、rejected、stale、timeout 结果都必须可见且可读。
- UI SHALL 只消费 mock 或只读 projection，并 SHALL 通过稳定 port 提交 intent；不得本地推断 HP、AP、伤害、路径、匹配事实、任务完成或存档。
- 同屏并列选择、通知栈、错误操作组和列表视口 SHALL 默认不超过 5；超过时使用分页、分组或滚动。

### 7. HUD 爆发档位冻结

作为项目所有者，我想要 HUD MVP 的爆发选择稳定为 0/1/2，同时保留未来演出接口。

#### 验收标准

- battle HUD 的 MVP 选择器 SHALL 只允许 `0 / 1 / 2`。
- `+3极限爆发` SHALL 标记为 deferred/future-evaluation，MVP 不可选择、不提交、不出现在可选列表中；如保留视觉位，必须置灰并标注不可选。
- selection effect 与 trigger effect SHALL 同时存在，且可由控制面板分别演示。
- 源文档或旧参考图中的 4 档只作 heritage/legacy reference；不得恢复为当前交互。

### 8. 标题画面、暂停与完整旅程

作为项目所有者，我想要标题画面、暂停和完整旅程都具备成功与失败闭环。

#### 验收标准

- 标题画面 SHALL 包含 `新游戏`、`继续`、`选项`、`退出`；设置 SHALL 覆盖显示、声音、输入、无障碍、语言、图形等类别。
- 暂停菜单 SHALL 包含 `继续`、`设置`、`重新开始`、`返回标题`，并正确冻结/恢复世界层、管理焦点和确认态。
- 完整旅程 SHALL 覆盖启动加载、标题、驻地、匹配/漫游、影子大厅、床前就绪、对局介绍、`enter-dream`、HUD、overlay、结算/奖励、`return-home` 和原位置驻地。
- 完整旅程 SHALL 显式覆盖：启动加载失败、继续无存档、匹配取消/超时/失败、影子中继 stale/unavailable、装载失败/重试/安全返回、转场资源缺失、断线/重连、结算或奖励投影失败、返回原位置缺失，以及每项对应的取消、重试或安全返回。
- `床 = 装载入口` 与 `纯白显形唯一传送` SHALL 保持；标题新游戏先落地出租屋，不得直接进入对局。
- 动画失败、跳过、超时或素材缺失 SHALL 收敛到同一权威结果，不得推进规则。

### 9. 参考资产 manifest

作为项目所有者，我想要参考素材可直接投喂且不会误用旧视觉。

#### 验收标准

- 参考资产 manifest SHALL 至少登记 `A-201` HUD refined2、`A-202` HUD refined、`A-203` HUD v3 legacy tier reference 和 `A-301` 标题画面文字提示附件。
- 每项 SHALL 登记 `assetId`、相对路径、kind、directToAi、适用页面/批次、状态、source provenance、使用约束和 checksum 状态。
- `A-201` 为 HUD 主基线，`A-202` 为辅助基线；`A-203` 可以直接作为 legacy layout 对照，但档位必须以 0/1/2 文字合同为准；`A-301` 是文字附件，标题截图仍应标记 pending。
- 参考资产缺失时 SHALL 保留语义位置、文字和可追踪 fallback；不得用错误语义素材顶替，也不得以零素材叙事宣称完成。

### 10. 批次依赖与失败态

作为项目所有者，我想要批次不是只覆盖 happy path，以便 V0 壳层可以演示可恢复状态。

#### 验收标准

- 每个 `B{n}-00` 与同目录 briefs SHALL 能单独执行：入口必须包含短全局摘要、已有代码复用指引、当前命令范围写锁、缺失挂载点的最小补齐规则和改动报告要求；不得要求 Batch 0、其他批次或对话记忆作为隐式前置。
- `dependsOn` SHALL 只表示能力交接顺序和可参考输出，`executionMode` SHALL 明确为 `independent-command`；依赖图不得被解释为命令启动阻塞。
- 批次依赖图 SHALL 无环；跨批次接口冲突 SHALL 登记交接项，不得跨边界私改对方交付物。

### 11. 文档评估与冲突保留

作为项目所有者，我想要清楚知道哪些是当前合同、哪些只是来源证据。

#### 验收标准

- 规范 SHALL 列出 authority/support/boundary 来源及其覆盖范围。
- 当前裁决优先级 SHALL 为用户裁决与本规范当前合同 > 当前命令 brief > 可选深度附件（Batch 0/G-*/R-*/资产）> source provenance > legacy 文本。
- 冲突 SHALL 保留为 open item 或 resolved-for-prompt 记录；不得静默合并。
- 需要扩展但本次未生成的 Prompt/资产/索引文件 SHALL 在 execution-report.md 中准确列为未完成，不得写成已交付。

### 12. 校验、checksum 与门禁

作为项目所有者，我想要结构漂移在投喂或接线前被发现。

#### 验收标准

- SHALL 有静态校验检查 B1..B7 的独立命令入口和同目录 numbered briefs 是否可解析、每份 brief 是否满足 15 节、页面 id 是否无孤儿/重复、排除项是否泄漏；若提供 Batch 0/G-*/R-*/资产深度附件，再校验其清单和路径。
- SHALL 校验每个入口的附加附件清单、manifest 路径、`directToAi`、source provenance 和 SHA-256/checksum 状态。
- SHALL 校验 G-08 页面目录与 PageCatalog 一致，完整旅程每一节点有成功和失败回退，HUD `+3` 不可选且 selection/trigger 均存在。
- 收尾门禁 SHALL 运行 `npx tsc --noEmit`、相关 `npx vitest run`、`npm run lint` 和 `npm run verify:docs`；纯文档阶段也必须报告实际执行结果或明确未执行原因。
- 文档改动 SHALL 只落在本次允许的五个文件：`requirements.md`、`design.md`、`tasks.md`、`deliverables/03-batch-plan.md`、`execution-report.md`；不得修改 `prompts/` 或其他目录。

### 13. 独立命令可执行性

作为项目所有者，我想要任意一个 B-00 命令脱离批次顺序即可执行，以便并行投喂、失败重试和跨会话执行不依赖隐藏上下文。

#### 验收标准

- 单独投喂任一 `B{n}-00` 与同目录 briefs SHALL 能启动并完成该命令，不要求先投 `Batch 0`、G-01..G-08、R-*、资产、其他 B 批次或任何对话记忆。
- 每个入口 SHALL 包含：短全局摘要、已有代码复用说明、当前命令的范围写锁、缺失挂载点的最小补齐规则、失败态与验收条件、改动报告格式。
- AI SHALL 能读取整个现有前端项目，优先复用已有组件、样式、端口和挂载点；只在当前命令范围内最小补齐缺失挂载点，并 SHALL 不修改 `prompts/` 或越过写锁。
- 命令完成后 SHALL 报告复用的已有代码、实际改动文件、最小补齐项、未完成项、验证命令和结果；不得把前序批次参考或附件描述为已执行前置。
- 依赖图中的 `dependsOn` SHALL 表示交接顺序和能力参考，不得表示命令阻塞；`executionMode` SHALL 为 `independent-command`。
