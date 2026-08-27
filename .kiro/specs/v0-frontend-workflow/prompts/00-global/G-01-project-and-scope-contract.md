# G-01 项目与作用域契约

## 1 页面定位

这是所有页面 AI brief 的共同边界。目标是生成完整、可演示、可接线的 WakeUp UI 壳层，不是生成规则引擎、后端或地图系统。

## 2 权威来源（只写 attachmentId / provenance）

- `frontend-workflow-requirements` / `.kiro/specs/v0-frontend-workflow/requirements.md`：页面范围、控制面板、交互、批次与 HUD 爆发冻结。
- `frontend-workflow-design` / `.kiro/specs/v0-frontend-workflow/design.md`：页面家族、PromptPacket、只读表现边界。
- `v0-shell-production-plan` / `docs/工程治理/10_V0前端壳层生产与接线规划.md`：V0 生成壳层，后续接线替换真实端口。
- `v0-steal-system` / `docs/工程治理/12_v0.dev前端偷师体系设计.md`：投喂、抽取、接线和验收纪律。
- `journey-current-ruling` / `docs/工程治理/11_游戏整体交互流程设计.md`：标题→驻地→入梦→对局→结算→返回旅程。

## 3 当前决策

- In scope：标题画面、启动/加载、设置、暂停、驻地入口呈现、匹配状态、入梦/返回、battle HUD、叙事对话、RPG 引导、通知、错误/重连、结算、控制面板和次面板。
- Out of scope：`editor`、`research-bench`、`material-library`、`computer` 的内部 UI，以及地图节点、拓扑、节点移动、ORCA、寻路、路径成本和玩法规则。
- 驻地中四个排除系统只保留入口占位，不展开内部页面。
- UI 只展示 `mock` 或只读投影；所有按钮提交 intent，不在组件中执行规则。
- 允许使用成品素材、纹理、光效、立绘和参考图；不把本项目定义成零素材渲染。
- `+3极限爆发` 是 future-evaluation、MVP 不可选；0/1/2 选择特效与触发特效仍必须实现。

## 4 状态机

所有页面至少支持：`idle` → `interacting` → `confirmed` 或 `rejected`；加载类页面还支持 `loading`、`empty`、`error`、`retrying`、`safe-return`。

## 5 组件树

`AppShell → ControlPanel → PageSurface → LocalOverlay → FeedbackLayer`。页面不得创建第二套全局路由或规则状态树。

## 6 只读数据

显示字段来自 G-03 的 `StateSnapshot`；开发演示使用 G-06 fixtures。字段必须带 `source: mock | projection` 标签。

## 7 动作意图

动作只生成 `{intentId, payload, requestId}`，例如 `navigate.page`、`settings.update-preview`、`pause.resume`、`dialog.choose`。宿主决定接受、拒绝、过期或重同步。

## 8 本地 UI 状态

允许：hover、focus、active、selected、expanded、filter、pageIndex、animationPhase、reducedMotion。禁止本地持有 HP、AP、伤害、匹配事实或任务完成事实。

## 9 视觉令牌

遵循 G-02。所有页面保持 WakeUp 的像素前景 + 全息投影背景语言，允许实际素材增强空间感。

## 10 动效绑定

遵循 G-05。动画只重演投影结果；跳过动画直接落到同一结果，不改状态。

## 11 输入无障碍

遵循 G-04。鼠标、键盘、手柄、触控和屏幕阅读器必须有等价路径。

## 12 加载错误超时

任何等待都必须有 loading、超时说明、重试、取消或安全返回；不能无限 spinner，也不能用 mock 成功掩盖失败。

## 13 明确不做

不实现后端、规则、OpRegistry、AI 决策、地图几何、真实资源写库、隐藏信息泄露或自动业务回调。

## 14 依赖交接

页面只依赖 G-03 的稳定 UI port 抽象和 G-06 的 fixtures；真实工程接线由后续端口实现负责。

## 15 验收条件

页面能独立演示主要成功态、空态、错误、取消、重试和退出；无未配套后端路径引用；排除项未变成正常页面；符合对应批次入口 Prompt。