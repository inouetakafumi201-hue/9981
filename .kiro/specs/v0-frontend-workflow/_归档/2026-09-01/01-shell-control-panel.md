# V0.dev 投喂 Prompt · batch-1：壳层骨架 + 控制面板

## 1. Project Positioning

本项目是一个「WakeUp前端」UI 壳层：用一套声明式 React 界面，把整个游戏的 UI 表面全部做出来（标题画面、对局 HUD、驻地、叙事对话框、过渡屏、系统通知、控制面板、次面板），供开发期演示、抽取与后续接线。**本壳层只表达视觉与交互手感，不实现任何玩法规则。**

本批次是整个壳层的第一块地基：应用外壳（AppShell）+ 控制面板（ControlPanel）。控制面板是**唯一稳定的切换面与抽取面**——所有页面通过它进入，后续接线也以它为抽取边界。

## 2. Scope List

**In scope（本批次）：**
- 应用外壳 AppShell：顶栏/侧栏/页面挂载区/全屏覆盖层层级。
- 控制面板 ControlPanel：页面切换、类别筛选、变体切换、动画播放（state-transition 与 click-play 两类）。
- 16 个页面占位壳（空页面 + 标题 + 状态标签），供后续批次填实：`menu-title` / `menu-pause` / `hud-main` / `residence-main` / `dialog-line` / `dialog-options` / `transition-dream` / `transition-battle-intro` / `transition-result` / `notice-broadcast` / `notice-toast` / `control-panel-main` / `utility-settings` / `utility-inventory` / `utility-safe` / `utility-match`。

**Out of scope（全项目，任何批次不得引入）：**
- `editor`（地图编辑器）、`research-bench`（研究台）、`material-library`（素材库）、`computer`（电脑）的内部界面。
- 地图节点、空间拓扑、节点移动、ORCA、寻路、路径成本、玩法规则结算。

## 3. Reference Materials

- 无既有草图（本批次为结构件）。
- 布局与视觉语言请按第 4 节「视觉规范」与下文交互规则执行。

## 4. Technical Constraints

- 技术栈：React + TypeScript；动效用 Framer Motion；图标用 lucide-react；可访问行为用 Radix；跨组件 UI 状态用 Zustand；音效用 Howler（本批次可留空音频槽）。
- 基准分辨率 1920×1080，最小支持 1280×720。
- 语义色（全局 token，不得另造主色）：
  - 红=生命减损/伤害/致命；蓝=清醒/体力/科技；黄=感官/警戒；橙=AP/行动/进行中；绿=安全/正面/免费；紫=关系约束/远程/条件；珊瑚=近战/格斗；青=社交/UGC/创作来源；灰=冷却/延迟/不可点击；灰白=受当前状态限制但仍可交互；纯白/奶白=梦境边界/过载；金/银=品级高光。
- 交互语法：可交互对象 = 边缘发光 + 高光 + 材质感；不可交互 = 扁平淡线条。
- 风格关键词：克制、暗调、半透明 UI、低心智性；像素前景 + 全息投影背景的叠层观感（UI 面板半透明，让背景透一点）。

## 5. Naming Rules

- 页面 id：`menu-title`、`menu-pause`、`hud-main`、`residence-main`、`dialog-line`、`dialog-options`、`transition-dream`、`transition-battle-intro`、`transition-result`、`notice-broadcast`、`notice-toast`、`control-panel-main`、`utility-settings`、`utility-inventory`、`utility-safe`、`utility-match`。
- 类别 id：`cat-menu`（标题与暂停）/ `cat-hud` / `cat-residence` / `cat-narrative` / `cat-transition` / `cat-notice` / `cat-control` / `cat-utility`。
- 组件名、路由名、状态名与上述 id 保持一致，不得自由改名。

## 6. Interaction Rules

- 所有可见控制必须写全五态：hover（边缘发光亮起+轻微凸起）、focus（Radix 焦点环）、active（高光加深/内缩）、disabled（扁平降饱和）、return（回到基线态）。
- 控制面板动作：
  - 页面切换：切换 UI 表面，不得渲染成角色移动或空间遍历。
  - 类别筛选（cat-menu / cat-hud / cat-residence / cat-narrative / cat-transition / cat-notice / cat-control / cat-utility）：只作用于呈现筛选，被隐藏页面不卸载状态。
  - 变体切换（hud 的 standard/solo/minimal、对话框的 with-portrait/no-portrait、过渡屏的 enter-dream/return-home）：呈现变体，不是玩法变体。
  - 动画播放：`state-transition`（UI 状态变化触发）与 `click-play`（点击触发）分开呈现。
- placeholder-only：所有交互只改变呈现，不提交玩法动作、不结算规则、不写游戏状态。
- 所有假数值/假标签必须标注 `mock`。

## 7. Explicit Exclusions

- ❌ 不做任何地图、节点、拓扑、寻路、ORCA 相关组件或视觉底板暗示。
- ❌ 不做编辑器/研究台/素材库/电脑的任何内部页面。
- ❌ 不做玩法规则执行（AP 扣除、伤害、目标选择结算、路径成本）。
- ❌ 不做真实数据接口（本批次全部 mock）。
- ❌ 不引入除第 4 节之外的任何新依赖库。

## 8. Batch Objective

建立 AppShell + ControlPanel + 16 个页面占位路由，让控制面板成为可切换、可筛选、可播放动画的稳定抽取面。**唯一主目标：壳层与控制面板先立住。**

## 9. Batch Dependencies

无依赖（本批次是首批）。

## 10. Acceptance Checks

- [ ] 控制面板可切换到全部 16 个占位页面，切换有过渡动画。
- [ ] 类别筛选按 8 个类别工作，被筛掉页面仅隐藏。
- [ ] 变体切换对支持多变体的页面生效（至少 hud/dialog/transition 三处）。
- [ ] state-transition 与 click-play 两类动画都有至少一处可演示。
- [ ] 排除项不出现在任何导航、标签或组件名中。
- [ ] 五态（hover/focus/active/disabled/return）在键盘与鼠标下都可验证。
- [ ] `npx tsc --noEmit` 0 error；`npm run lint` 0 error。
