# R-05 驻地、匹配、床门控与运营 UI 边界重写 brief

## 1 页面定位

生成 WakeUp 的出租屋驻地壳层和运营流：现实地图是局外主界面，节点/承载物承担菜单职责；锚定导流仪负责模式、规则准备和异步匹配；床负责躺下就绪和装载入口。驻地默认是少 UI 实例，不显示战斗轮次、HP、SP、AP 或战斗动作面板，但保留移动、局部交互、必要文本和运营反馈。

这是只读 UI 边界 brief。它只生成驻地导航、匹配面板、影子大厅提示、床状态、错误返回和入口占位，不生成四类被排除系统的内部页面，不把运营系统变成第二套玩法规则引擎。

## 2 权威来源（attachmentId/provenance）

- `G-01-project-and-scope-contract`：驻地范围、四类系统只留占位、少 UI、素材允许和端口边界。
- `G-02-visual-token-contract`：驻地视觉、色彩、素材/背景光层和交互高光。
- `G-03-ui-port-contract`：状态快照、intent、pending/rejected/stale/timeout。
- `G-04-interaction-accessibility`：输入等价、焦点、五态和≤5。
- `G-05-motion-audio-fallback`：匹配/床/入梦/返回表现和 fallback。
- `operations-residence-03` / `references/source/operations-residence-03.md`：出租屋节点职责、床门控、影子大厅、纯白显形、退出和 MVP 边界。
- `operations-outside-growth-01` / `references/source/operations-outside-growth-01.md`：运营系统、少 UI 与一人模式分离、反仓库。
- `operations-safe-library-04` / `references/source/operations-safe-library-04.md`：书架、保险箱、门缝接触面职责。
- `operations-narrative-evidence-05` / `references/source/operations-narrative-evidence-05.md`：电脑承载证据应用但本 brief 只留入口占位。

## 3 当前决策

- 驻地承载物：床A 蓝=主线/竞技装载入口；床B 珊瑚=联机副本后续；床C 青=自建梦/体验沙箱后续，MVP 仅编辑器内自测不可入局。锚定导流仪=模式选择+异步匹配；研究台=素材级工作台；造梦舱=地图编辑器；电脑=元状态港湾；电视=被动公告；书架=梦境素材库；保险箱=收藏室；门缝=纯叙事，不是入口。
- 锚定导流仪未完成交互前，任何床都不可交互，显示扁平灰、无高光、原因文字。匹配完成后对应床由灰变可交互，玩家走到床边并躺下即 ready。
- 匹配是异步的：匹配期间玩家可以继续在出租屋移动和使用不冲突节点，不锁在等待屏。采用影子站桩，不加载独立大厅；MVP 可在 ready 后直接进入装载边界。
- 入梦和返回统一使用纯白显形门；床是固定实体、演出全程不消失、可跳过且不影响装载。对局中退出通过左上角 intent 请求，返回出租屋原位置/床旁，不强制回床。
- 收藏室/素材库/研究台/编辑器/电脑仅可显示入口占位、状态摘要或“进入独立界面”按钮，内部 UI 必须在各自专项 brief/后续交付中生成。

## 4 状态机

驻地总流程：`residence-ready → device-focused → device-open → residence-ready`。

匹配：`idle → preparing → matching → matched → cancelled | timeout | rejected | error`。

床：`locked → available → readying → load-pending → dream-transition → in-game`；床B/C 的后续/禁用态保持 `locked`。

退出：`in-game → exit-pending → return-transition → residence-ready`，失败为 `exit-error → retry | safe-return`。

## 5 组件树

`ResidenceShell → ResidenceSceneLayer → ResidenceInteractables → MatchStatusLayer → BedGateLayer → OverlayStack → FeedbackLayer`。

- `ResidenceInteractables → BedNode(A/B/C) + AnchorDeviceNode + ResearchBenchPlaceholder + DreamPodPlaceholder + ComputerPlaceholder + TelevisionNode + LibraryPlaceholder + SafePlaceholder + DoorNoteSurface`。
- `MatchStatusLayer → MatchPanel + ModeChoices + RuleSummary + ReadyNotice + ShadowPlayers`。
- `BedGateLayer → BedStateBadge + ReadyPrompt + DreamTransitionOverlay`。
- `OverlayStack` 只挂设置、错误、确认和端口状态，不挂编辑器、研究台、素材库或电脑内部页面。

## 6 只读数据

```ts
interface ResidenceSnapshot {
  source: 'mock' | 'projection';
  revision: number;
  player: { positionLabel?: string };
  nodes: readonly ResidenceNodeView[];
  match: { state: 'idle'|'preparing'|'matching'|'matched'|'cancelled'|'timeout'|'error'; mode?: string; reason?: string };
  beds: readonly { id: 'bed-a'|'bed-b'|'bed-c'; state: 'locked'|'available'|'ready'|'loading'; reason?: string }[];
  shadows: readonly { id: string; displayName: string; ready: boolean; visible: boolean }[];
  returnTarget?: string;
}
```

节点投影带 `role`、`label`、`availability`、`disabledReason`、`placeholderOnly`。来源明确为 mock/projection；UI 不从位置、颜色或本地计时推导 match、bed readiness、权限或装载结果。

## 7 动作意图

- `residence.move`：请求移动到节点，payload 只含目标意图。
- `residence.open-device`：打开锚定导流仪摘要面板。
- `residence.select-mode`、`residence.start-match`、`residence.cancel-match`、`residence.accept-ready`。
- `residence.ready-at-bed`、`residence.start-dream-load`、`residence.exit-match`、`residence.return-to-residence`。
- `residence.open-placeholder`：只打开“该系统独立实现/待接线”说明，不进入内部页面。

所有意图带 requestId；床点击在 locked 时不得偷偷提交 load intent，必须显示门控原因。错误/取消/安全返回均由宿主结果决定。

## 8 本地 UI 状态

允许当前焦点节点、hover/focus/selected、当前 overlay、mode tab、match panel 展开、shadow visibility、bed prompt、pendingRequestId、transitionPhase、reducedMotion 和错误 toast。禁止本地记录匹配成功、床 ready、影子 ready、场景装载、对局状态、玩家位置事实或战斗资源。异步匹配的等待不能靠本地倒计时自动确认。

## 9 视觉令牌

- 驻地背景：暖琥珀/低饱和全息光层，像出租屋现实锚点；实体/可交互静态组件可使用登记素材和正面俯视规格。
- 床A 蓝、床B 珊瑚、床C 青只表示入口语义；未开放床扁平灰并带锁/原因，不能用颜色暗示已可进入。
- 锚定导流仪可使用较高信息密度的完整彩色面板；床只需极简 ready feedback，避免把两个职责做成相同按钮。
- 入口占位使用名称、职责、状态和回退说明；不显示其内部字段、诊断树、素材网格、工具栏或账号应用。
- 少 UI 隐藏战斗数值，不隐藏必要的节点名、匹配状态、错误原因和退出。

## 10 动效绑定

- 节点 hover/focus：语义边缘光、轻微上浮、短促确认音；不可点节点不发光，原因可读。
- 异步匹配：匹配面板显示轻量状态变化；影子玩家在同一出租屋中轮廓淡入/呼吸，不重载独立大厅。
- 匹配完成：床从 locked 的灰态过渡到 available 的高光；躺下/ready 只播放睡眠或就绪反馈。
- 实→梦：床固定在场 → 床/人纯白显形 → 颜色复原 → 人离床进入梦；梦→实反向回床并起床。两者都可跳过并落到同一目标状态。
- 错误/取消：局部红色或灰白反馈、回弹和可读原因；黑幕可表达断线/退出，但不替代纯白入梦/返回门。

## 11 输入无障碍

鼠标点击/悬停、键盘 Tab/Enter/Space/Esc、方向键、手柄 confirm/cancel、触控 tap/long-press 和屏幕阅读器全部等价。匹配进行中 Esc/明确取消按钮可取消；床 locked 的原因在焦点进入时读出。焦点进入匹配面板后循环并在关闭时回到锚定导流仪；过渡层提供 Skip 按钮并不劫持焦点。节点和状态不能只靠颜色表达。

## 12 加载错误超时

匹配 preparing/matching、规则摘要、床装载、纯白过渡、退出返回分别显示文字状态和有限 loading。超时提供重试、取消和安全返回；模式不兼容/端口断开显示安全返回；匹配失败不把床变成 available。素材缺失时用节点轮廓/语义占位保留空间；过渡失败直接落目标快照，不伪造匹配或装载成功。

## 13 明确不做

不实现匹配算法、房间协议、队伍权限、床装载规则、对局规则、战斗 HUD、仓库/配装、货币、编辑器画布、研究台槽位、素材库搜索、电脑应用、证据提交机制或内部诊断。没有独立大厅场景，不把电视变成交互入口，不让门缝进入对局，不把床和研究台/造梦舱/电脑混成一个“万能菜单”。

## 14 依赖交接

运营宿主提供 `ResidenceSnapshot`、会话/装载/节奏端口和 ActionPort；生成壳层只绑定稳定 page/role/intent。入口占位方只提供 `placeholderOnly`、label、description 和 `openExternal` intent，内部四类系统由独立交接项实现。素材方提供床、锚定导流仪、驻地承载物和影子资源的 assetRef，表现层提供语义 fallback。

## 15 验收条件

- 玩家可从出租屋移动、打开锚定导流仪、发起异步匹配、继续活动、看到 ready 床、就绪、入梦和返回。
- 床在门控未完成前不可点且原因可读；床B/C 的 MVP 边界明确；研究台/编辑器/素材库/电脑只有入口占位。
- 不加载独立大厅，不显示战斗数值，不把少 UI 与一人模式混为一谈。
- 匹配/装载/退出的 accepted、rejected、cancelled、timeout、error、safe-return 均有路径；纯白演出可跳过且结果一致。
- 键盘/手柄/触控/屏幕阅读器等价，素材允许使用且缺失不破坏布局，所有数据源可审计。
