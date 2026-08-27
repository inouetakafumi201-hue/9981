# WakeUp UI Prompt Pack

## 这是什么

给 V0 前端生成 AI 的可携带 UI 投喂包。把 WakeUp 的 UI 结构、交互、人机输入、动效、设置、错误恢复和参考素材改写成 AI 可直接读取的附件。V0 必须先检查整个现有前端项目，直接在现有项目上修改。

主叙事：**完整游戏 UI 壳层 + 可用参考素材 + 声明式动效**。不以"零素材渲染"为目标。允许使用已登记的成品素材；素材缺失时按确定性降级执行。

## 投喂顺序

1. 选择一个批次的 `B*-00` 入口 Prompt，连同目录下该批次全部 numbered briefs 一起投喂；这一组就是一条可单独执行的命令。
2. 执行时先检查整个现有前端项目，再复用并修改已有实现；不要把历史批次塞入对话，也不要等待前置批次。
3. `00-global/G-*` 仅作为可选深度附件补充，不是独立执行的前置依赖。
4. `legacy/` 只用于识别旧内容，不能作为当前规则。

## 独立执行规则

- 每个 `B*-00` 加同目录全部 numbered briefs 都必须能作为单独命令执行；不依赖前置批次、历史对话或会话记忆。
- V0 可以看到整个现有前端项目，必须先检查当前架构和已有功能；优先复用已有实现，不重复造壳或创建孤立 demo。
- 只修改当前批次的职责范围；发现缺失挂载点时，在现有架构内做最小必要补齐，不等待前置批次交付。
- 全局契约仍是可选的深度附件；即使不附加 G，也必须遵守本包及各批次 brief 中的所有安全边界和明确排除项。
- 完成后报告实际改动与未完成项；不要把未确认的规则、结果或接线状态报告为已完成。

## 当前批次

| 批次 | 目标 | 入口 |
|---|---|---|
| B8 | Shell 接线意图反馈层：wiring badge 实时状态 / pending 3 阶段进度 / failure 4 态图标+reasonCode / ActiveIntentPanel / revision 翻转动画 | `08-shell-wiring-feedback/B8-00-shell-wiring-feedback-prompt.md` |
| B9 | HUD 动作卡交互优化：disabled 5 因+tooltip / target mode 覆盖层+cursor+ESC+计数器 / 骰子需求高亮 / submit 5 态+debounce / AP 资源条 | `09-hud-action-feedback/B9-00-hud-action-feedback-prompt.md` |
| B10 | 驻地主界面 + JourneyRail + Overlay：AnchorStatusBar 6 态 / BedA 倒计时确认+入梦白淡 / ResidenceJourneyRail 产品级节点图 / 驻地区 FocusScope+ESC / 匹配 4 段进度条 | `10-residence-journey-overlay/B10-00-residence-journey-overlay-prompt.md` |
| B11 | 通用反馈层组件库：ToastRegion+useToast / AccessibilityAnnouncer+useAnnounce / PageStateGate / ActionFeedbackButton / MenuPause 增强 / TransitionResult pending 态 | `11-universal-feedback/B11-00-universal-feedback-prompt.md` |

## 全局契约（按需附加）

| 契约 | 文件 | 用途 |
|---|---|---|
| 项目与范围合同 | `00-global/G-01-project-and-scope-contract.md` | 页面目录、范围边界、AI 不得猜测清单 |
| 视觉令牌合同 | `00-global/G-02-visual-token-contract.md` | 颜色/字号/间距/圆角/阴影/动效参数 |
| UI 端口合同 | `00-global/G-03-ui-port-contract.md` | IntentResult 四态 / pending 不等于 accepted / reasonCode |
| 交互无障碍合同 | `00-global/G-04-interaction-accessibility.md` | FocusScope / ESC / toast 五态 / 键盘无障碍 |
| 动效音频降级合同 | `00-global/G-05-motion-audio-fallback.md` | 动效五档 / reduced motion / 入梦纯白显形 |
| Mock 数据合同 | `00-global/G-06-mock-data-fixtures.md` | actionCard fixture / loading 120ms / source:mock 标签 |
| 冲突登记簿 | `00-global/G-07-conflict-register.md` | 已知决策冲突与覆盖规则 |
| 页面与批次索引 | `00-global/G-08-page-and-batch-index.md` | startup→title→residence→battle→result 旅程 + 批次依赖图 |
| 接线装载运行期 | `00-global/G-09-wiring-loading-runtime.md` | match-boot.ts / UiBackendProvider / 7 端口投影 / 生命周期 |

## AI 不得猜测

- 不得读取或猜测后端规则、AI 决策、地图拓扑、ORCA、寻路、路径成本、伤害、AP 扣除、目标判定或存档写入。
- 不得把附件中的 mock 数据当成真实规则结果。
- 不得把 `editor`、`research-bench`、`material-library`、`computer` 的内部页面加入本 UI 范围；它们只可作为驻地入口占位或边界说明。
- 不得从 legacy/ 恢复旧的"4 档爆发"或"无标题画面"等已归档结论。
- 不得把标题画面、设置、暂停、任务日志、教程、错误恢复当作可选装饰；它们是完整 UI 旅程的一部分。

## 统一 brief 结构

每份 `G-*` 或 `B*-xx` AI brief 都使用以下结构：

1. 页面定位 / 问题陈述
2. 权威来源（attachmentId / provenance）
3. 当前决策 / 现状
4. 状态机
5. 组件树
6. 只读数据
7. 动作意图
8. 本地 UI 状态
9. 视觉令牌
10. 动效绑定
11. 输入无障碍
12. 加载错误超时
13. 明确不做
14. 依赖交接
15. 验收条件

## 生成结果的最低标准

生成结果必须是可演示的完整 UI 壳层：页面可进入、可退出、可切换、可聚焦、可使用键盘/手柄等价操作，成功、空状态、错误、取消、重试和 reduced motion 都有确定表现。组件可以使用真实视觉素材，但所有规则写入都留给后续稳定端口接线。
