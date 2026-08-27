# G-04 交互与无障碍契约

## 1 页面定位

统一全 UI 的人机交互、输入等价、焦点和可访问行为，让 AI 生成的页面不是只会鼠标点击的视觉稿。

## 2 权威来源（只写 attachmentId / provenance）

- `presentation-ui-authority` / `docs/表现系统/01_图形化与UI.md`：输入等价、快捷键、可访问性。
- `rpg-guidance` / `docs/表现系统/07_RPG叙事与引导系统全览.md`：教程、帮助、通知和导航交互。
- `frontend-workflow-template` / `.kiro/specs/v0-frontend-workflow/v0-spec-template.md`：Radix、Tab、Enter、Space、Esc 约定。

## 3 当前决策

每个可见控制必须定义 hover、focus、active、disabled、return 五态。交互不能只依赖颜色。全局同屏并列选择不超过 5 个，超过时分页/滚动/分组。

## 4 状态机

`focusable` → `focused` → `active` → `return`；弹层 `closed` → `open` → `confirm | cancel` → `closed`；输入错误 `invalid` 必须保留原因。

## 5 组件树

`FocusScope` / `Dialog` / `Menu` / `Tooltip` / `LiveRegion`；页面不得自行实现不可访问的 div button。

## 6 只读数据

可见 label、disabled reason、shortcut、current selection、announcement text 都来自 fixture/投影；不要从视觉颜色猜测。

## 7 动作意图

鼠标 click、键盘 Enter/Space、手柄 confirm、触控 tap/long-press 调用同一 intent。Esc 通常取消当前 overlay，不应隐式提交。

## 8 本地 UI 状态

焦点索引、键盘导航、展开、拖拽来源/目标、tooltip 可见性、筛选和选择可本地保存。

## 9 视觉令牌

focus = 明确外环/内光，不被 clip-path 裁掉；disabled = 扁平无高光 + 文本原因；active = 内缩/高光加深；return = 回基线。

## 10 动效绑定

焦点和 hover 使用短反馈；列表切换保持空间连续；reduced motion 时保留顺序和结果，缩短位移/闪烁。

## 11 输入无障碍

至少支持 Tab/Shift+Tab、Enter、Space、Esc、方向键、数字快捷键（适用时）、手柄焦点和屏幕阅读器名称/角色/状态。拖拽必须提供键盘“选来源→选目标→确认”替代。

## 12 加载错误超时

焦点进入加载/错误状态时，必须可读出状态和下一步；焦点不得落入不可操作的空白区域。

## 13 明确不做

不使用纯 hover 才能发现的关键操作，不使用颜色作为唯一语义，不把动画或音频用来泄露隐藏信息。

## 14 依赖交接

真实 UI 接线保持相同 aria label、intentId、shortcut 和焦点顺序；变更需更新 brief。

## 15 验收条件

键盘和手柄能完成标题→驻地→对局→暂停→返回；弹层焦点陷阱/归还正确；五态可见；屏幕阅读器可读出状态、错误原因和操作结果；同屏选择≤5。