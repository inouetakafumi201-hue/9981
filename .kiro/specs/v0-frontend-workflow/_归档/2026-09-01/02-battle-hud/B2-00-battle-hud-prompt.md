# B2 Battle HUD Prompt Pack
<!-- prompt-pack: command-entry batch=B2 execution=independent-command -->

## 0. Independent Execution Contract

本命令可独立执行。已有项目是当前实现事实；AI 必须先检查现有前端并在其基础上修改，不能另起孤立 demo。缺失挂载点时，在现有架构内最小补齐；已存在功能不得重复/破坏。只修改当前批次职责范围，不要等待前置批次，也不要求记住 Batch 0 或前一批次对话。

全局硬约束摘要：UI-only；只读 mock/projection；所有交互使用显式 intent，不执行玩法或业务规则。允许使用并挂载登记素材与可替换 `assetRef`；不用“零素材”口径作为完成标准，可自行生成美术ui素材以提升质量。四类内部 UI out-of-scope：`editor`、`research-bench`、`material-library`、`computer`，只能保留入口/挂载位，不实现内部页面。同屏并列可操作选项 ≤5，超出时分页、滚动、分组或分步。`+3极限爆发` deferred/future-evaluation-only，MVP 不可选，但保留必要的预留表现槽位。

## 1. Project Positioning

WakeUp 的 B2 是一个可演示、可抽取、可接线的 `battle-hud` UI 壳层包。它在全屏游戏世界上叠加透明、分层、空间附着的 HUD，覆盖对局进行中、行动选择、投点与轮次、NPC 阶段、观战、断线/重连、淘汰、对局结果与奖励。它只消费只读 projection / mock fixture，只提交声明式 UI intent；不实现玩法规则。

视觉优先级是「世界先于面板」：环境全息投影层 → 像素实体层 → 事件/目标层 → HUD 层 → 低频仪式/错误层。结果必须像正在发生的游戏，而不是 SaaS dashboard、三栏后台或卡片墙。

## 2. Scope List

本批次包含：

- `hud-main` 的 standard / solo / minimal 表现变体，以及 `battle-result`、`battle-spectator`、`battle-reconnect` 的同一 HUD 体系状态面。
- HUD 固定组件：左侧轮次栏/行动轮脊柱、顶部回合与阶段徽章、当前行动者、HP 5 格、SP/清醒 5 格、AP 离散格/徽标、buff 区、状态区、头顶弱点图标、2 手 + 2 格物品栏、负重提示、左上退出与设置入口。
- 底部居中的扇形行动卡手牌：付费动作与零费动作空间分离、悬停详情、无目标直接视觉演出、有目标进入目标选择、点击空白取消；保留分级导航同时可见选项不超过 5。
- 投点/轮次舞台：骰子悬空、强力骰与逆转的两条离散 `0/1/2` 滑块契约、selection / trigger effects、横条三段式生长与结算行。它与行动卡是两条独立交互契约。
- 攻击预览：目标、距离/DC、命中/后果等只读显式字段；只展示 projection 提供的关系，不在 UI 推断。
- pending / rejected / stale / timeout / error / safe-return；NPC 行动阶段；淘汰后的观战切换；观战自由视角与只读标识；断线、重连、匹配/对局结果；胜利、失败、平局、超时、奖励和继续返回意图。
- 视觉质量硬门禁：世界承载层、半透明不对称材质、CSS `clip-path`、Framer Motion 空间连续演出、键盘/手柄/读屏/reduced-motion 等价路径，以及登记素材的 `assetRef` 挂载和明确 fallback。

## 3. Reference Materials

权威或直接投喂附件：

- `frontend-workflow-requirements`：`.kiro/specs/v0-frontend-workflow/requirements.md`；Prompt 结构、作用域、HUD `+3` 冻结和只读壳层边界。
- `frontend-workflow-design`：`.kiro/specs/v0-frontend-workflow/design.md`；PromptPacket、页面目录、固定组件和表现端口边界。
- `presentation-ui-authority`：`docs/表现系统/01_图形化与UI.md`；轮次栏、回合、动作菜单、投点、状态、观战、素材与可访问性。
- `presentation-elements-baseline`：`docs/表现系统/04_画面要素文档.md`；1080p HUD 要素与空间层级基板。
- `journey-current-ruling`：`docs/工程治理/11_游戏整体交互流程设计.md`；进入/退出对局、HUD 循环、NPC、结算与返回驻地。
- `frontend-port-contract`：`00-global/G-03-ui-port-contract.md`；StatePort / ActionPort、revision 与结果态。
- `frontend-visual-tokens`：`00-global/G-02-visual-token-contract.md`；颜色、材质和分层。
- `frontend-accessibility`：`00-global/G-04-interaction-accessibility.md`；五态、输入等价、焦点与 ≤5。
- `frontend-motion-fallback`：`00-global/G-05-motion-audio-fallback.md`；结果动画、跳过、缺失与 reduced motion。
- `frontend-mock-fixtures`：`00-global/G-06-mock-data-fixtures.md`；mock 标记、可见数值和状态 fixture。
- `hud-legacy-baseline`：`prompts/02-battle-hud.md`；旧 HUD 主 Prompt 的布局和固定组件内容，已在本包重写吸收。
- `hud-action-cards-addendum`：`prompts/02-battle-hud-action-cards-addendum.md`；行动卡模型，已在本包重写吸收。
- `hud-visual-quality-addendum`：`prompts/02-battle-hud-visual-quality-addendum.md`；反网页感构图、材质和动效硬门禁，已在本包重写吸收。
- 视觉参考：`prompts/references/assets/A-201-hud-refined2.png`、`A-202-hud-refined.png`、`A-203-hud-v3-legacy-tier-reference.png`。它们只说明 layout / state / transition；旧 4 档画面不能覆盖当前契约。

## 4. Technical Constraints

- React + TypeScript + Tailwind/design tokens；Framer Motion；Radix 可访问原语；Zustand 只保存可丢弃的 UI 状态；lucide-react 只作语义图标；Howler 音效可选且不得成为信息唯一来源。
- DOM/CSS 是 HUD 表现层；不引入 Pixi、Three、Phaser、WebGL 或新的 Canvas engine。地图/世界占位必须有低饱和全息空间、实体落点、阴影和事件承载，不得是空白纯色矩形。
- 1920×1080 基准，1280×720 最小安全区；保留响应式重排、键盘焦点顺序、手柄、触控和 `prefers-reduced-motion`。
- 颜色只使用全局 token：红生命/伤害/失败，蓝清醒/SP/科技，黄感官/警戒，橙 AP/进行中，绿安全/免费/完成，紫远程/约束，珊瑚近战，青社交/UGC，灰冷却/延迟/不可用，灰白受状态限制仍可交互，纯白/奶白梦境边界，金银少量高光。
- HP、SP、AP 使用离散格/菱形语义，不用细长连续资源条。所有玩家可见资源、成本、距离、DC、伤害、奖励值只显示投影显式值，遵守项目玩家可见数值 1–5 约束；回合号、实体数等结构值可例外。
- StatePort 只读 snapshot；ActionPort 接收 `{intentId, payload, requestId}` 并返回 `accepted | rejected | stale | timeout`；pending 不是 accepted。UI 不写规则 store、不本地推进 projection。
- `+3极限爆发` 是 deferred、future-evaluation-only、MVP 不可选；0/1/2 是唯一可选档位。强力骰/逆转滑块只属于投点契约，绝不能渲染为行动卡或行动卡成本选择。
- 禁用参考稿中的 9-slice / 缝合边框图（如 `frame-card.png`、`frame-card-gold.png`）；面板使用 CSS `clip-path`、半透明多层全息材质、局部阴影和语义边缘光。

## 5. Naming Rules

- 页面 id：`hud-main`、`battle-result`、`battle-spectator`、`battle-reconnect`、`battle-loading`。
- HUD 变体 id：`standard`、`solo`、`minimal`；状态 id：`round-roll`、`player-action`、`target-selection`、`npc-phase`、`eliminated`、`spectating`、`reconnecting`、`result`、`safe-return`。
- 固定组件 id：`fixed-turn-spine`、`fixed-turn-header`、`fixed-current-actor`、`fixed-ap-badge`、`fixed-buff-zone`、`fixed-status-zone`、`fixed-weakness-icon`、`fixed-inventory-slots`、`fixed-encumbrance-tag`、`fixed-leave-entry`。
- 行动与投点 id：`paid-action-hand`、`free-action-band`、`action-card-detail`、`target-context-layer`、`attack-preview`、`power-die-slider`、`reversal-slider`、`dice-roll-stage`、`roll-comparison-bars`、`roll-result-row`。
- 连接/结果 id：`npc-phase-banner`、`elimination-state`、`spectator-readonly-badge`、`connection-status`、`reconnect-intent`、`match-result`、`reward-summary`、`safe-return-transition`。
- 统一使用 `assetRef` / `iconRef` / `portraitRef` / `textureRef`；假数据标记 `source: 'mock'` 和 `mock: true`。组件名、intent 名、fixture 字段名在本包内保持一致。

## 6. Interaction Rules

1. 动作选择必须是底部居中的扇形行动卡手牌。付费动作在 `paid-action-hand`，零费动作在空间分离的 `free-action-band`；两者不混排、不做并排按钮墙、不做选项卡切页。当前同时可选项（含分级导航）不超过 5。
2. 悬停/聚焦行动卡时，在卡面就地展开详情：图标、显式成本菱形、目标意图、可用/不可用原因。不得打开遮挡世界的大 tooltip 弹窗，也不得本地计算成本、命中、伤害或目标范围。
3. 单击无目标动作，卡片沿明确方向飞向当前行动者/当前事件锚点并发送 action intent；单击有目标动作，卡片吸附到光标/目标选择层，候选目标按 projection 高亮，点击目标发送 intent；点击空白或 Esc 取消本地选择。整个过程不弹确认框，不结算规则。
4. 攻击预览只显示 projection 显式的目标、武器、距离/DC、命中/后果预览、成本和说明；远程关系用紫色点线，近战候选用珊瑚边缘光，伤害/致命后果用红色。招架仍是真隐藏，不创建待机图标。
5. 投点面板就地附着轮次栏，不是独立居中弹窗。强力骰与逆转是另一条离散 `0/1/2` 滑块契约；档位推动有递增 selection effect，确认投掷有一次性 trigger effect，之后按灰白伸出 → 强力骰快速增长 → 从左刷色的顺序呈现横条和结果。`+3` 只保留置灰预留位。
6. 回合徽章显示回合/阶段/当前行动方；轮到玩家显示「你的回合！剩余 AP」，NPC 显示「NPC 行动阶段」及正在处理的公开视觉事件。NPC 不进入玩家轮次栏，不提供玩家确认按钮；快速演出只重演投影结果。
7. 当前行动者反光高亮；玩家自己的轮次框更宽更粗；已行动者保留在轮次栏但降饱和，不删除、不加叉、不加网页式完成横幅。轮次重排使用 `layout` 保持空间连续。
8. 淘汰态保留公开结果和玩家身份，动作控件转为禁用并说明「已淘汰」；若允许观战，切入自由视角的 `spectating`，复用同一只读 HUD。观战者可查看公开状态、装备、动作结果和全场地图，所有提交动作控件标注「观战只读」。
9. 断线/重连/匹配和对局结果必须区分连接事实、请求事实和投影事实：显示连接中、重连中、重连成功、重连失败、匹配中、匹配超时、对局装载/结果等待；不把本地倒计时或动画冒充服务器成功。
10. 结果覆盖胜利、失败、平局、超时四类 projection outcome；结果页显示回合/公开统计、奖励明细、继续/安全返回 intent。奖励只读显示，不在 UI 发放；纯白 `safe-return` 只回放宿主确认的返回结果。
11. 全部可见控制实现 `hover / focus / active / disabled / return` 五态。交互只改变呈现或提交 intent，mock 数据与 placeholder-only 必须可审计。

## 7. Explicit Exclusions

- 不实现 AP 扣除、HP/SP 变化、伤害、命中/DC 判定、目标判定、行动轮排序、NPC 决策、过载、淘汰判定、胜负判定、平局/超时判定或奖励发放。
- 不调用、不实现、不模拟 `OpRegistry`、规则引擎、AI 决策、目标选择器、路径/拓扑/ORCA/pathfinding 或后端/服务器协议。
- 不把强力骰/逆转做成行动卡、不把它们合并进动作成本，不提供第 3 档 `+3极限爆发` 的可选行为；保留 selection/trigger effects 和置灰预留位。
- 不做地图编辑器、研究台、素材库、电脑内部页面或第二套全局路由；世界层仅作可辨识视觉承载。
- 不做浏览器 chrome、SaaS dashboard、三栏应用模板、统一圆角卡片墙、网页式 tooltip 弹层、9-slice 边框、霓虹扫描线或大面积不透明面板。
- 不隐藏关键状态在 hover/音效/颜色单一通道；不以零素材为目标，不手工造贴图，不删除登记素材位。

## 8. Batch Objective

交付一套完整、连贯、可演示的 B2 battle HUD Prompt Pack，使 AI 能在同一套空间视觉与 UI port 语言下生成 HUD 主屏、动作卡、投点/轮次、目标/攻击预览、NPC 阶段、淘汰/观战、断线/重连和结果/奖励状态。唯一主目标是：完整表达玩家「现在发生什么、我能做什么、对谁生效、请求处于什么状态、对局如何结束」的表现层，不越界为规则实现。

## 9. Batch Dependencies

- 前批次 B1：若项目已有 `AppShell`、页面挂载点、控制面板切换、全局 token、焦点与 UI port 注入边界则复用；若没有，按本命令约定在现有架构内补齐；不要求记住 Batch 0 或前一批次对话。
- 当前批次约定：本文件与同目录 numbered briefs 已包含可执行的 HUD、UI port、视觉、交互和降级摘要；G-*、R-* 及其他参考材料均为可选补充，不构成阻塞依赖。
- 后续交接说明：B3/B6 可通过稳定 intent / projection 端口复用对局入口、结果继续、`safe-return`、`returnOrigin` 和连接/匹配状态；不修改对方交付物。
- 后续接线可复用既定素材管线和 manifest；组件帧使用合法登记 `assetRef`，缺失时由本包 fallback 规则承接。

## 10. Acceptance Checks

- [ ] 目标目录含且仅含 6 个 B2 文件，入口总 Prompt 的 11 节齐全，5 个 numbered brief 各有固定 15 节且顺序不变。
- [ ] HUD 固定组件、回合/轮次、standard/solo/minimal、NPC 阶段、淘汰、观战、断线、重连、匹配/结果、胜负/平局/超时和奖励均有明确覆盖。
- [ ] 动作选择是底部扇形手牌；付费/零费空间分离；悬停详情；无目标直接演出；有目标目标选择；空白/Esc 取消；没有按钮纵列、并排墙或选项卡动作菜单。
- [ ] 强力骰与逆转明确是独立离散 `0/1/2` 滑块；`+3` deferred 且 MVP 不可选；selection 与 trigger effects 均有；不得误写为行动卡。
- [ ] 攻击预览只读、目标上下文来自 projection；pending/rejected/stale/timeout 不伪造成功；连接状态、NPC、淘汰、观战和结果都可区分。
- [ ] 世界先于面板；至少有环境/实体/事件/HUD/仪式层；半透明不对称材质、CSS `clip-path`、像素前景、登记素材与 fallback 规则完整；无 9-slice 和网页 dashboard。
- [ ] 所有控件有五态、键盘/手柄/触控等价、Radix 语义、live region、焦点归还和 reduced-motion 降级；颜色不是唯一通道。
- [ ] 任何实现只消费只读字段和稳定 intent，不写 AP/伤害/目标/OpRegistry/规则；mock 和 placeholder-only 均带标记。
- [ ] 静态自检可确认六文件存在、章节计数正确、关键冻结词与禁止项未遗漏；代码接入时再运行项目既定 TypeScript、相关 Vitest 与 lint 门禁。

## 11. Attached AI-readable packet

本命令必读本文件+同目录 numbered briefs；G-* 和 R-* 是可选补充，正文摘要已经足够执行。

可选补充参考：

1. 全局包 `G-01` 至 `G-08`，尤其 G-02/G-03/G-04/G-05/G-06。
2. 视觉参考资产 `A-201`、`A-202`、`A-203`；`A-203` 只作 legacy layout/state 参考，禁止恢复旧 4 档。

AI-readable packet 的共同口令：世界先于 HUD；HUD 是空间附着的透明工具层；动作卡负责动作选择，投点滑块负责投点承诺；只读 projection 负责规则事实；intent 负责请求；accepted/projection update 才能触发结果演出；`+3` deferred 不可选但 selection/trigger effects 保留；素材通过 `assetRef`/manifest 进入，缺失走语义 fallback。
