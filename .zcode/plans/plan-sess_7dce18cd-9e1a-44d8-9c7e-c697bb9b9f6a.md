## 目标

把 `.kiro/specs/v0-frontend-workflow/prompts/` 从“依赖仓库上下文的几份 Markdown Prompt”升级成**可脱离后端、可按批次直接交给 V0.dev/前端生成 AI 的完整 Prompt Pack**。

关键原则：

- AI 不会看到 WakeUp 后端，因此不再只写 `src/...` 路径或“请参考某文档”。所有 AI 必须知道的内容都复制进 Prompt Pack，并改写成自包含的 UI brief。
- 活跃源文档中存在历史内容和冲突，不能把全文原样塞给 AI。原文只作为不可投喂的 provenance 归档；AI 使用的是带编号、带优先级、带冲突裁决的 rewritten brief。
- 不把路线描述成“零素材渲染”。Prompt 使用“UI 壳层 + 可用参考素材 + 草图/样图 + 声明式动效”的口径，允许成品素材和视觉资源强化风格。
- 保留 `editor`、`research-bench`、`material-library`、`computer` 四项内部 UI 的 out-of-scope 边界；驻地只保留它们的入口占位，不把这些文档交给 AI 生成内部页面。
- 全部 UI 旅程要闭合：冷启动/加载/标题画面/设置/驻地/匹配/入梦/对局 HUD/暂停/叙事/RPG 引导/通知/结算/返回/错误/重连/退出/无障碍。

## 最终目录结构

在现有目录上扩展，不把当前核心 Prompt 丢失：

```text
.kiro/specs/v0-frontend-workflow/prompts/
├─ 00-PROMPT-PACK-README.md                 # 给人和 AI 的总入口、投喂顺序、禁止猜测规则
├─ 00-prompt-pack-manifest.json              # 机器可校验的编号、来源、批次、依赖、附件清单
├─ 00-global/
│  ├─ G-01-project-and-scope-contract.md     # 项目定位、in/out scope、后端不可见边界
│  ├─ G-02-visual-token-contract.md          # 色彩、材质、尺寸、层级、视角、风格
│  ├─ G-03-ui-port-contract.md               # StatePort/ActionPort/CadencePort 的前端可见抽象
│  ├─ G-04-interaction-accessibility.md      # 五态、输入等价、键盘、手柄、屏幕阅读器、焦点
│  ├─ G-05-motion-audio-fallback.md           # 动效、声音、镜头、reduced motion、资源缺失降级
│  ├─ G-06-mock-data-fixtures.md              # 页面 mock 数据、状态和变体，不暴露后端实现
│  ├─ G-07-conflict-register.md               # 历史文档冲突及当前裁决
│  └─ G-08-page-and-batch-index.md            # 全部 UI surface 与批次索引
├─ 01-shell-startup/
│  ├─ B1-00-shell-startup-prompt.md          # 批次入口 Prompt
│  ├─ B1-01-app-shell-control-panel.md
│  ├─ B1-02-startup-loading-recovery.md
│  ├─ B1-03-title-menu-and-settings.md
│  └─ B1-04-navigation-and-focus-contract.md
├─ 02-battle-hud/
│  ├─ B2-00-battle-hud-prompt.md
│  ├─ B2-01-hud-layout-and-fixed-components.md
│  ├─ B2-02-action-cards-target-context.md
│  ├─ B2-03-dice-turn-status-visibility.md
│  ├─ B2-04-spectator-reconnect-and-result.md
│  └─ B2-05-visual-quality-gate.md
├─ 03-residence-flow/
│  ├─ B3-00-residence-flow-prompt.md
│  ├─ B3-01-residence-node-and-input.md
│  ├─ B3-02-match-shadow-lobby.md
│  ├─ B3-03-dream-load-return-transition.md
│  └─ B3-04-residence-empty-error-states.md
├─ 04-pause-utility-feedback/
│  ├─ B4-00-pause-utility-prompt.md
│  ├─ B4-01-pause-menu-and-restart-confirm.md
│  ├─ B4-02-settings-lifecycle-and-a11y.md
│  ├─ B4-03-inventory-safe-and-utility-panels.md
│  ├─ B4-04-notification-history-and-subtitles.md
│  └─ B4-05-connection-error-retry-overlay.md
├─ 05-narrative-rpg/
│  ├─ B5-00-narrative-rpg-prompt.md
│  ├─ B5-01-dialog-and-portrait-fallback.md
│  ├─ B5-02-quest-log-objective-tracker.md
│  ├─ B5-03-tutorial-help-location-title.md
│  ├─ B5-04-notification-priority-and-history.md
│  └─ B5-05-stats-achievements-codex-recap.md
├─ 06-full-journey-integration/
│  ├─ B6-00-journey-integration-prompt.md
│  ├─ B6-01-route-state-machine.md
│  ├─ B6-02-overlay-z-index-and-input-arbitration.md
│  ├─ B6-03-settings-and-global-feedback-wiring.md
│  └─ B6-04-v0-extraction-handoff.md
├─ 07-motion-polish/
│  ├─ B7-00-motion-polish-prompt.md
│  ├─ B7-01-motion-recipe-catalog.md
│  ├─ B7-02-reduced-motion-performance.md
│  └─ B7-03-visual-acceptance-matrix.md
├─ references/
│  ├─ source/                                # 只读来源副本，保留出处，不直接投喂
│  ├─ ai/                                    # 已重写、可直接读的 AI brief 副本
│  ├─ assets/                                # 真实参考图副本和清单
│  └─ REFERENCE-INDEX.md                     # 来源→AI brief→批次映射
└─ legacy/                                    # 现有旧 Prompt/addendum 的迁移说明，不再作为新投喂入口
```

## 编号与引用规则

- `G-xx` 是全局附件，所有批次入口都列出必读/选读关系。
- `B1-xx` 至 `B7-xx` 是批次附件；每一份只属于一个批次，避免跨批次共享写权。
- `A-xxx` 是参考图/资源附件，写入 manifest 的 `assetId`，不再只写仓库路径。
- Prompt 中不能出现“请直接读取 `D:\coding\WakeUp\docs\...`”这种唯一引用。每次引用必须同时写：`attachmentId`、附件标题、附件中的结论摘要、来源 provenance。
- 每个批次入口 Prompt 仍使用十个固定章节，但新增一个“Attached AI-readable packet”章节，列出该批次必须随 Prompt 一起投喂的完整文件。
- 每个 AI brief 统一采用 15 段结构：页面定位、权威来源、当前决策、状态机、组件树、只读数据、动作意图、本地 UI 状态、视觉令牌、动效绑定、输入无障碍、加载错误超时、明确不做、依赖交接、验收条件。
- 旧的两个 HUD addendum 不再以“追加在文件后面”的方式使用：合并为 `B2-02` 和 `B2-05`，在 `B2-00` 中写出明确优先级；底部行动卡只负责动作选择，投点强力骰/逆转滑块保留为另一条交互契约。

## AI-readable 内容的具体整理范围

### 全局附件 G-01 至 G-08

1. `G-01`：从 `requirements.md`、`design.md`、`docs/工程治理/10`、`docs/工程治理/12` 重写项目定位、UI-only 边界、四个排除域、素材口径、页面 AI 不得猜测后端。
2. `G-02`：从 `docs/表现系统/00/01/04` 和当前 D-083 提取视觉令牌。明确“像素前景 + 全息投影背景”，禁止旧“像素+简笔画”和错误视角；允许成品素材、纹理、光效。
3. `G-03`：把 `StatePort`、`ActionPort`、`CadencePort` 改写成 AI 能理解的前端接口快照，附 mock JSON；不要求 AI 阅读 `src/`，不让 AI 实现 `OpRegistry` 或规则引擎。
4. `G-04`：统一 hover/focus/active/disabled/return、键盘/手柄/鼠标/触控等价、焦点陷阱、焦点归还、live region、五并列预算。
5. `G-05`：把事件级动画配方、音频通道、镜头和资源缺失 fallback 改写成表格；动画只能重演结果，不能推进规则；纯白显形仍是入梦/返回唯一传送门。
6. `G-06`：给 AI 直接可用的 mock 数据：页面状态、玩家轮次、HUD 动作、目标、菜单、匹配、对话、通知、设置和错误；每个字段标注展示用途。
7. `G-07`：登记启动菜单旧文档冲突、HUD 动作卡与右下列表冲突、单人投点冲突、旧 4 档冲突、对话框裁切冲突、选项上限冲突、资源/图层冲突；每项写当前采用结论，AI 不得自行裁决。
8. `G-08`：完整页面目录、状态/变体、批次归属和 out-of-scope 交接清单。

### Batch 1：壳层、启动、标题画面、设置

- 把 `menu-title`、`menu-pause`、启动加载/恢复、设置六类（显示/声音/输入/无障碍/语言/图形）、全局导航和焦点规则写成自包含 brief。
- 标题入口必须有新游戏/继续/选项/退出，继续要覆盖无存档/加载中/失败/重试；新游戏先进入出租屋，不直接进对局。
- 设置必须覆盖文字大小、UI 缩放、音量通道、输入重绑/冲突、reduced motion、字幕、视觉替代、震动/镜头抖动、语言重排、图形性能档位、保存/取消/恢复默认/失败重试。
- 启动加载、资源缺失、版本不兼容、退出失败必须有确定性界面。

### Batch 2：完整对局 HUD

- 将现有 HUD 主 Prompt、行动卡 addendum、质感 addendum 改写并合并。
- 追加目标上下文菜单、攻击预览、不可用原因、提交 pending/拒绝/过期、NPC 阶段、淘汰/观战、断线/重连、终局/胜负/奖励结果。
- 明确：动作选择是底部扇形手牌；投点是轮次栏旁的离散 0/1/2 推挡滑块；两者不是同一控件。
- 所有 HUD 数据用 G-03/G-06 的 mock contract 表达，禁止出现“AI 去读取后端路径”。

### Batch 3：驻地、匹配、入梦/返回

- 从 `运营系统/03`、`运营系统/01`、工程治理/11 重写驻地状态机。
- 精确门控：MVP 只有床 A 可入竞技；床 B 后置不可点；床 C 只允许自测不可入局；匹配完成只点亮对应床。
- 覆盖匹配取消/超时/失败/重试、匹配期间继续漫游、影子大厅、床前就绪、装载失败、返回原位置/床旁。
- 明确结算→继续→`return-home` 纯白显形→出租屋，不能用黑幕替代唯一传送。

### Batch 4：暂停、工具面板、通知、错误与字幕

- 把暂停菜单、设置复用、背包、收藏室、匹配状态、通知优先级/队列/历史、字幕与声音视觉替代、连接/重连/装载错误统一打包。
- 电视保持被动只读，不生成普通可操作菜单。
- 补齐重新开始确认、返回标题确认、焦点恢复、浮层 z-index 和输入仲裁。

### Batch 5：叙事、RPG 引导和信息覆盖层

- 将 `dialog-line`/`dialog-options` 从全文设计中抽取成 AI brief：立绘降级链、`displayName`、语音/字幕、背景音乐压低、默认不暂停、与 HUD 共存、选项只提交意图。
- 新增 `quest-log`、`objective-tracker`、`tutorial-help`、`location-title`、`notification-history`、`stats`、`achievements`、`codex`、`recap` 等非排除 UI surface；模式不适用时用明确 disabled/hidden variant，不删掉页面契约。
- 旧 `onSelect` 业务回调改写为声明式 intent，不把玩法逻辑交给 AI。

### Batch 6：全旅程整合与抽取交接

- 生成完整 route/state machine：冷启动→标题→新游戏/继续→驻地→锚定导流仪→匹配→床→对局介绍→纯白入梦→HUD→暂停/覆盖层→结算→纯白返回→驻地；任何节点失败都有重试/取消/安全返回。
- 定义 overlay 优先级：暂停/设置/对话/错误/通知/仪式层之间谁覆盖谁、谁锁焦点、谁允许 Esc 关闭。
- 定义控制面板抽取顺序、页面组件签名、mock→端口替换清单。

### Batch 7：动效、声音、无障碍和视觉验收

- 把现有 `05-motion-polish` 改为最后收束包，绑定所有新页面。
- 统一 9 个动效母题、音频通道、reduced motion、低性能 profile、资源缺失 fallback、60fps/console/资产错误验收。

## 并行执行方案与写入锁

### Batch 0（串行，必须先完成）

先建立 `00-PROMPT-PACK-README.md`、manifest、编号规则、G-01~G-08 目录、source→AI brief 索引。这一步是共享契约，不能并行写。

### Batch 1（并行，互不写同一目录）

- Prompt A：只写 `references/source/` 和 `references/ai/G-*.md`，整理全局契约、冲突和 mock 数据；不得修改批次 Prompt。
- Prompt B：只写 `01-shell-startup/`，整理启动、标题、设置、导航、加载恢复。
- Prompt C：只写 `02-battle-hud/`，整理 HUD、行动卡、目标、观战、结算。
- Prompt D：只写 `03-residence-flow/` 与 `04-pause-utility-feedback/`，整理驻地、匹配、暂停、通知、错误、字幕。
- Prompt E：只写 `05-narrative-rpg/` 与 `06-full-journey-integration/`，整理对话、任务、教程、信息覆盖层和整合状态机。

所有子任务只读 `docs/` 与当前 spec，独占自己的写目录；不能修改 `00-prompt-pack-manifest.json`、`deliverables/03-batch-plan.md` 或其他子任务目录。

### Batch 2（串行整合）

主会话读取所有子任务产物，更新：

- manifest 的 `files`、`batchBindings`、`sourceProvenance`。
- 每个 batch `B*-00` 的十章节入口 Prompt。
- `deliverables/01-scope-and-pages.md` 的完整 PageCatalog。
- `deliverables/02-control-surface.md` 的类别、动作、页面状态与抽取边界。
- `deliverables/03-batch-plan.md` 的 8 个批次（Batch 0 + B1~B7）。
- `design.md` 的 UiFamily、BatchSpec、PromptPacket、正确性属性和错误处理。
- `requirements.md` 的 AI-readable 包完整性、旅程闭环与失败状态要求。
- `tasks.md` 与 `execution-report.md` 的执行状态。

### Batch 3（验证）

运行专用 Prompt Pack 校验：

- 编号唯一且连续/可解释。
- 每个批次入口引用的附件 ID 都存在。
- 每个 AI brief 都有 15 个固定段落。
- Prompt 中不存在未配套的 path-only backend 引用。
- out-of-scope 内容只出现在边界/排除段。
- 所有页面都绑定批次，所有批次都有 acceptance checks。
- `+3极限爆发` 不得进入 MVP selectable 集合。
- `npm run verify:docs` 通过。
- 运行项目既有 `npx tsc --noEmit`、相关 `vitest run`、`npm run lint`；如仍被未跟踪 `src/devboard/editor-shell/` 阻塞，必须按文件和基线归因，不把它伪报为 Prompt Pack 回归。

## 交付标准

完成后用户拿到的不是“几个引用了仓库路径的 Prompt”，而是：

1. 一个 `00-PROMPT-PACK-README.md`，说明给 AI 投喂哪些文件、顺序是什么。
2. 一个 manifest，能看出每份附件来自哪份源文档、属于哪个批次、是否直接投喂。
3. 8 个全局/交互契约附件，AI 不看后端也能生成正确 UI 壳层。
4. B1~B7 每批的入口 Prompt + numbered AI-readable briefs。
5. 现有参考图的本地副本与图片 manifest；标题画面提示词作为文字参考，实际草图未生成则明确标 `pending`，不假装存在。
6. 更新后的 PageCatalog、ControlPanelModel、BatchPlan、requirements/design/tasks。
7. 一份冲突登记和一份 V0 抽取/接线交接清单。

这套方案会把“文档引用链”变成“AI 可直接读取的本地投喂包”，同时保留源文档可追溯性、排除域边界和后端端口解耦。