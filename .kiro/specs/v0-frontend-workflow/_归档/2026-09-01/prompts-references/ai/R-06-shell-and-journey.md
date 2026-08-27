# R-06 标题、启动、完整旅程与端口接线重写 brief

## 1 页面定位

生成 WakeUp 从启动到返回驻地的完整前端 journey shell：标题画面、启动加载、标题四入口、设置/暂停、出租屋、匹配、床就绪、入梦、对局 HUD、结算、纯白返回和错误安全返回。它是可脱离后端运行的展示壳层：路由和展示状态完整，数据用 mock fixture，所有业务动作以 intent 形式交接，不实现游戏规则。

目标是“能走完旅程的 UI”，不是“能玩的游戏”。组件结构、页面 ID、overlay 层级、焦点归还和端口形状稳定，后续接线只替换数据源与动作适配器。

## 2 权威来源（attachmentId/provenance）

- `G-01-project-and-scope-contract`：完整 UI 范围、路由边界和后端隔离。
- `G-03-ui-port-contract`：`StatePort`/`ActionPort`/`CadencePort` 与结果态。
- `G-04-interaction-accessibility`：完整旅程的键盘/手柄、焦点和错误恢复。
- `G-05-motion-audio-fallback`：过渡、跳过和 fallback。
- `G-08-page-and-batch-index`：pageId、完整 route、批次归属。
- `governance-journey-11` / `references/source/governance-journey-11.md`：标题→驻地→匹配→入梦→对局→结算→返回的旅程裁决。
- `governance-v0-shell-10` / `references/source/governance-v0-shell-10.md`：V0 生成、接线、验收和 mock→真实端口方法。
- `governance-v0-system-12` / `references/source/governance-v0-system-12.md`：偷师前端定位、完全阉割逻辑和控制面板抽取方向。
- `A-301-menu-title-text-prompt` / `references/assets/A-301-menu-title-text-prompt.md`：标题画面文字提示词，图片 pending。

## 3 当前决策

- 标题画面是启动前置，标准四入口为 `新游戏`、`继续`、`选项`、`退出`；`新游戏` 淡入出租屋，不直接进入对局。`继续` 无存档时 disabled 并显示原因。
- 出租屋是局外主界面；床=装载入口，锚定导流仪=模式/匹配门控；对局结束结算后返回出租屋，不回旧式主菜单。
- 完整 route：`startup-loading → menu-title → residence-main → utility-match → transition-battle-intro → transition-dream(enter) → hud-main → pause/overlays → transition-result → transition-dream(return) → residence-main`。任何失败都进 retry/cancel/safe-return。
- 暂停包含继续、设置、重新开始、返回标题；对局左上角退出是经权威动作通道的请求，不是本地强退。
- V0/前端生成壳层不实现回合、伤害、AI、ORCA、寻路、画布几何、规则装载或存档；只实现 UI 状态、mock fixture、动画和 intent callbacks。
- 页面可使用登记素材和参考图片；标题真实 PNG 当前不存在，必须在附件映射中标为 pending，不得假装有成品截图。

## 4 状态机

应用级：`boot → loading → title → residence → match → dream-enter → battle → pause/overlay → result → dream-return → residence`。

页面级：`unmounted → entering → ready → leaving → unmounted`。

端口级：`mock snapshot | projection snapshot → render`；每个 intent `idle → pending → accepted | rejected | stale | timeout`。

加载/错误：`loading → retrying | error → retry | cancel | safe-return`。返回标题前要有 confirm overlay，Esc 取消并归还焦点。

## 5 组件树

`JourneyApp → PortProvider → AppRouter → AppShell → PageSurface + OverlayStack + FeedbackRegion`。

- `StartupPage → StartupProgress + StartupError + RetryCancel`。
- `TitlePage → TitleLogo + TitleMenu + OptionsOverlay + QuitConfirm`。
- `ResidencePage → ResidenceShell`（R-05）。
- `BattlePage → BattleHudShell`（HUD projection surface）。
- `PauseOverlay → PauseMenu + SettingsOverlay + RestartConfirm + ReturnTitleConfirm`。
- `TransitionLayer → DreamTransition + ResultTransition + SkipControl`。
- `ControlPanel` 仅是开发期页面/效果导航的抽取候选，不能成为第二套路由或规则树。

## 6 只读数据

统一使用：

```ts
interface StateSnapshot {
  screen: string;
  phase: string;
  entities: readonly Record<string, unknown>[];
  resources: readonly Record<string, unknown>[];
  notices: readonly Record<string, unknown>[];
  source: 'mock' | 'projection';
  revision: number;
}
interface IntentRequest { intentId: string; payload: Record<string, unknown>; requestId: string; }
interface IntentResult { requestId: string; status: 'accepted'|'rejected'|'stale'|'timeout'; reason?: string; nextRevision?: number; }
```

页面使用自己的 fixture subset：title save availability/options；residence node/match/bed；battle HUD projection；result summary；settings preview. 数字展示遵守 1–5 规则（回合号等内部度量例外）。UI 不从本地路由推导业务状态。

## 7 动作意图

页面导航：`navigate.page`、`menu.new-game`、`menu.continue`、`menu.options`、`menu.quit`、`pause.resume`、`pause.restart`、`pause.return-title`。

设置：`settings.preview`、`settings.save`、`settings.reset`。

运营/对局：`residence.start-match`、`residence.cancel-match`、`residence.ready-at-bed`、`battle.select-action`、`battle.select-target`、`battle.exit`、`result.continue`。

动画 Skip 仅 `presentation.skip`。所有动作生成 requestId 并显示结果；不要在页面 callback 中直接改全局 store、推进路由到成功页或写存档。路由跳转可以响应 accepted 的投影变化或宿主允许的导航 intent。

## 8 本地 UI 状态

允许 `currentPage`、`pendingRoute`、menuIndex、focusScope、overlayStack、settingsDraft、selectedTab、pendingRequestId、animationPhase、skipRequested、reducedMotion 和 toast。禁止本地持有 save existence 的业务事实、match outcome、bed readiness、battle resources、result rewards 或 progression。草稿设置仅是预览，保存成功前不覆盖 snapshot。

## 9 视觉令牌

- Title 可使用强烈的全息抽象光层、标题字和四入口纵向菜单，但 A-301 的旧冷峻赛博/扫描线描述仅作历史提示词来源；当前基线仍以 R-01/G-02 的像素前景+克制暖/冷全息光层为准。
- Startup 使用低信息量的轮廓显影/装载提示；Residence 用暖现实锚点；Battle 复用 A-201/A-202 HUD 空间参考；Result 使用低频梦醒/结算层。
- 控件五态明确：hover/focus 语义光，active 压缩，disabled 扁平无高光+原因，return 回基线。错误红色、pending 橙色、stale 灰白/黄色、accepted 绿色。
- overlay 层级不能遮住焦点语义；标题、暂停、设置和确认不做重复的全局 chrome。

## 10 动效绑定

- boot→title：轮廓显影或简短淡入，加载失败走 error overlay。
- title→residence：新游戏/继续 accepted 后页面级淡入；不做“直接加载进战斗”。
- residence↔battle：匹配/床 ready 后使用 R-05 纯白显形；床固定存在、可跳过、结果一致。
- pause/settings：半透明遮罩+菜单滑入，关闭焦点回到触发控件；restart/return-title 是确认 overlay。
- result→residence：结算面板先展示 projection 结果，再纯白返回；不以动画完成作为规则完成。
- 页面列表和菜单使用 `layout/reflow`、边缘发光和语义反馈；不在 journey 里添加每页独立的传送语言。

## 11 输入无障碍

全局 Tab 顺序跟随当前页面；Enter/Space 确认；方向键/数字键用于菜单（页面适用时）；Esc 关闭当前 overlay/取消；手柄导航与键盘同一 intent；触控给明确取消/返回按钮。所有 modal 有焦点陷阱和归还；加载/错误页面焦点落在状态说明和下一步，不落空白区域。屏幕阅读器读出 page title、当前项、disabled reason、pending/result 和安全返回。

## 12 加载错误超时

startup、save/continue、match、dream load、battle reconnect、settings save、result return 都要有 loading、明确文字、超时阈值、retry/cancel/safe-return。错误不要靠无限 spinner；rejected/stale/timeout 不跳到下一页。资源失败按 fallback 保留页面骨架；版本不兼容时安全返回 title/residence。不要用 mock 成功隐藏真实端口失败。

## 13 明确不做

不实现游戏规则、战斗计算、AI 决策、地图/画布渲染、ORCA/寻路、资产生产管线、真实存档、匹配协议、经济结算或后端 API。不要恢复“无标题画面”旧结论、旧主菜单流程、旧 4 档爆发或独立统一大厅。不要把控制面板当成玩家产品页，不把 editor/research-bench/material-library/computer 内部 UI 放入 journey。

## 14 依赖交接

壳层交付物是 pageId 稳定的 React/TypeScript 组件、fixtures、intent builders 和可替换 `UiPorts` adapter。接线方只替换 `StatePort`、`ActionPort`、`CadencePort` 与素材 resolver，不改组件树/props/焦点/动效语义。批次交接：B1 壳层启动标题，B2 HUD，B3 驻地入梦，B4 overlay/error，B5 RPG/叙事，B6 journey 集成，B7 动效 polish。页面间只通过公开 snapshot/intent 端口，不读取后端内部路径。

## 15 验收条件

- 新用户可走通 startup loading→title→new game→residence→match→bed→dream→battle→result→return residence；continue/options/quit/pause/error/cancel/retry/safe-return 可独立演示。
- 每个 pageId 只属于一个确定批次，路由无 orphan/duplicate；mock 可运行，替换 projection 不改组件树。
- 纯白是唯一入梦/返回门；标题真实 PNG pending 被诚实标注；A-201/A-202 可直接关联 HUD，A-203 仅历史。
- 所有交互带 requestId 和可读结果，键盘/手柄/触控/屏幕阅读器等价，reduced motion 与素材失败不改变结果。
- 没有后端路径、规则计算、内部工具 UI 或本地伪造成功状态。
