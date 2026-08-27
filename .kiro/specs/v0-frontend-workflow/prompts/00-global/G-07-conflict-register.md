# G-07 冲突登记与当前裁决

## 1 页面定位

让 AI 不在冲突文档之间自行选规则。以下条目是当前投喂结论；历史文本只作 provenance。

## 2 权威来源（只写 attachmentId / provenance）

- `interview-decisions` / `references/source/interview-decisions.md`：用户/访谈决策。
- `journey-current-ruling` / `references/source/governance-journey-11.md`：当前完整旅程。
- `frontend-workflow-requirements` / `.kiro/specs/v0-frontend-workflow/requirements.md`：当前 UI spec。

## 3 当前决策

| 冲突 | 当前采用 | AI 处理 |
|---|---|---|
| 无传统主菜单 vs 标题画面 | 标题画面是启动前置；新游戏落地出租屋 | 不恢复旧无主菜单结论 |
| HUD 旧 4 档 vs +3 暂缓 | MVP 0/1/2；+3 deferred，不可选 | 选择/触发特效保留 |
| 动作列表 vs 扇形行动卡 | 动作选择用底部扇形行动卡；投点滑块独立 | 不把两者合并 |
| 单人投点旧 abort vs 后续决策 | 按后续 2 AP 口径 | 不采用旧 abort |
| 结算黑幕 vs 纯白传送 | 黑幕只能显影/退场；返回必须纯白 `return-home` | 不用黑幕替代传送 |
| 对话图片完整显示 vs cover | brief 使用完整显示优先；裁切需人工确认 | AI 不自行 cover |
| 对话选项 4 vs 全局 ≤5 | 页面最多 4 个可见选项，仍满足 ≤5 | 不增加并列项 |
| `onSelect` 业务回调 vs intent | 只提交声明式 intent | 不写任务/奖励/关系逻辑 |
| 素材库旧词条快捷栏 vs 共享素材快捷栏 | 只保留共享素材快捷栏 | 不恢复旧字段 |
| 地图 v1 scenes vs canonical v2 | v2 唯一数据边界 | AI 不生成 v1 结构 |
| “零素材渲染”叙事 | 允许成品素材和参考资源 | 禁止用零素材作为目标 |

## 4 状态机

若 brief 与来源冲突：`conflict` → 读取本表当前采用 → `resolved-for-prompt`；没有登记的冲突必须标记 `open`，不得猜测。

## 5 组件树

冲突不在组件树里解决；由 brief 的当前决策段固定。

## 6 只读数据

历史文档中的旧字段只能作为 `heritageText`，不得进入 mock fixture 的 selectable/active 数据。

## 7 动作意图

冲突涉及动作时使用当前 intent 名，不生成第二套 action kind。

## 8 本地 UI 状态

可展示 deferred、disabled、legacy reference 标签，但不能把它们转为可选行为。

## 9 视觉令牌

旧视觉只可作为“不要这样做”的对照，不可作为当前风格来源。

## 10 动效绑定

只按当前裁决绑定动效；尤其 `+3` selection/trigger 仍在，tier 不在。

## 11 输入无障碍

冲突裁决不能删掉键盘、手柄或屏幕阅读器路径。

## 12 加载错误超时

冲突或缺少裁决时显示人工复核/安全返回，不自动生成一个规则版本。

## 13 明确不做

不把历史记录当活跃需求，不把 proposal/实验报告当玩家可见经济或规则契约。

## 14 依赖交接

新增冲突写入本表，并在对应 B brief 的第 2/3 节登记 attachmentId 和结论。

## 15 验收条件

每份 B brief 的关键冲突都能在本表找到；Prompt 中没有未解释的旧术语、旧档位或旧页面入口。