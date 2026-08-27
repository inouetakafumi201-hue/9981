# 偷师前端 · 设计定稿 03：独立命令与可选深度附件批次规划

> 归属：`.kiro/specs/v0-frontend-workflow` · 交付物
> 依据：requirements §2/§3/§8/§10/§12/§13；Prompt Pack manifest、G-08
> 状态：结构同步（2026-08-20）
> 说明：本文件同步当前 Prompt Pack 的实际入口和 numbered brief；不宣称尚未存在的文件已生成

## 一、独立命令总表

| batchId | 单一主目标 | dependsOn（非阻塞交接） | executionMode | 页面/范围 | 最小投喂入口 |
|---|---|---|---|---|---|
| `Batch 0` | 全局合同、冲突、fixtures、页面索引和附件规则 | 无 | `optional-depth-attachment` | G-01..G-08、manifest、资产索引 | `prompts/00-PROMPT-PACK-README.md` + `prompts/00-global/` |
| `B1` | 壳层、控制面板、启动加载、标题画面、设置与焦点 | `Batch 0` 能力参考 | `independent-command` | `startup-loading`、`menu-title`、`control-panel-main`、`utility-settings` | `prompts/01-shell-startup/B1-00-shell-startup-prompt.md` + 同目录 briefs |
| `B2` | 完整对局 HUD、动作卡、投点、观战、断线、结算 | `B1` 挂载能力参考 | `independent-command` | `hud-main`、`transition-result` | `prompts/02-battle-hud/B2-00-battle-hud-prompt.md` + 同目录 briefs |
| `B3` | 驻地、匹配、影子大厅、入梦、返回 | `B1` 挂载能力参考 | `independent-command` | `residence-main`、`utility-match`、`transition-battle-intro`、`transition-dream` | `prompts/03-residence-flow/B3-00-residence-flow-prompt.md` + 同目录 briefs |
| `B4` | 暂停、工具面板、设置生命周期、通知和错误恢复 | `B1` 挂载能力参考 | `independent-command` | `menu-pause`、`notice-broadcast`、`notice-toast`、`notification-history`、`utility-settings`、`utility-inventory`、`utility-safe`、`utility-match` | `prompts/04-pause-utility-feedback/B4-00-pause-utility-prompt.md` + 同目录 briefs |
| `B5` | 叙事、RPG 引导、任务、教程、通知历史和档案覆盖层 | `B1` 页面能力参考 | `independent-command` | `dialog-line`、`dialog-options`、`quest-log`、`objective-tracker`、`tutorial-help`、`location-title`、`stats`、`achievements`、`codex`、`recap` | `prompts/05-narrative-rpg/B5-00-narrative-rpg-prompt.md` + 同目录 briefs |
| `B6` | 完整旅程路由、覆盖层层级、输入仲裁和抽取交接 | `B1-B5` 整合能力参考 | `independent-command` | 完整 journey route + overlays + `control-panel-main` | `prompts/06-full-journey-integration/B6-00-journey-integration-prompt.md` + 同目录 briefs |
| `B7` | 动效、声音、reduced motion、性能和视觉验收 | `B1-B6` 收束能力参考 | `independent-command` | 全部页面与旅程动效 | `prompts/07-motion-polish/B7-00-motion-polish-prompt.md` + 同目录 briefs |

表内 `dependsOn` 只表示能力交接顺序和已有项目能力参考，不表示命令启动阻塞。任何一个 `B{n}-00` 都可只投自身入口与同目录 briefs；Batch 0/G-01..G-08、R-*、前序批次输出和参考资产均可按需要追加为深度附件。

## 二、入口与附件合同

### 2.1 独立命令投喂规则

每个 `B{n}-00` 是独立命令。最小投喂只包含该入口和同目录 numbered briefs，不要求 Batch 0、G-01..G-08、R-*、参考资产、前序批次输出或对话记忆。

入口必须在最前部提供以下短合同：

1. 短全局摘要：UI-only 边界、当前批次目标和关键产品裁决。
2. 已有代码复用：先读取整个现有前端项目，优先复用既有组件、样式、端口、状态投影和挂载点。
3. 范围写锁：允许修改的当前批次代码目录/文件，以及禁止修改的 prompts/ 和其他批次交付物。
4. 缺失挂载点最小补齐：只补齐当前目标执行必需的最小挂载点，不重建已有能力，不扩大范围。
5. 改动报告：报告复用项、改动文件、最小补齐项、未完成项、验证命令和结果。

可选深度附件按需追加：Batch 0/G-*、R-*、参考资产、source provenance 和前序批次交接材料。它们增加上下文，不改变独立命令的执行资格。

每个命令入口仍应列出本目录全部 numbered briefs；G-*、R-*、参考资产和 source provenance 改为可选附件。下表记录当前目录状态，不把附件存在误写成命令前置：

### 2.2 当前实际文件映射

| 批次 | 当前入口/brief | 当前可见状态 |
|---|---|---|
| Batch 0 | `00-PROMPT-PACK-README.md`、`00-global/G-01..G-08`、`00-prompt-pack-manifest.json` | 已存在并通过 Prompt Pack 校验 |
| B1 | `01-shell-startup/B1-00` 至 `B1-04` | 已存在；入口 11 节、numbered briefs 15 节 |
| B2 | `02-battle-hud/B2-00` 至 `B2-05` | 已存在；入口 11 节、numbered briefs 15 节 |
| B3 | `03-residence-flow/B3-00` 至 `B3-04` | 已存在；入口/子 brief 可直接投喂 |
| B4 | `04-pause-utility-feedback/B4-00` 至 `B4-05` | 已存在；入口 11 节、numbered briefs 15 节 |
| B5 | `05-narrative-rpg/B5-00` 至 `B5-05` | 已存在；入口/子 brief 可直接投喂 |
| B6 | `06-full-journey-integration/B6-00` 至 `B6-04` | 已存在；入口 11 节、numbered briefs 15 节 |
| B7 | `07-motion-polish/B7-00` 至 `B7-03` | 已存在；入口 11 节、numbered briefs 15 节 |

以上状态以实际文件和 `npm run verify:prompt-pack` 为准。

### 2.3 参考资产 manifest

当前实际 manifest 为 `prompts/00-prompt-pack-manifest.json`，已登记全局 G-01..G-08、sourceDirectories 和规则；参考资产目录实际包含：

- `A-201-hud-refined2.png`
- `A-202-hud-refined.png`
- `A-203-hud-v3-legacy-tier-reference.png`
- `A-301-menu-title-text-prompt.md`

当前实际索引为 `prompts/references/REFERENCE-INDEX.md`，资产字段清单为 `prompts/references/assets/asset-manifest.json`。标题画面实际 PNG 尚未生成，A-301 维持 pending；A-203 维持 heritage-only。

## 三、各批次主目标与独立执行验收

### Batch 0：全局合同

- 入口先声明 UI-only 边界、允许素材、四个排除内部系统和历史冲突裁决。
- G-08 登记完整基础/扩展 PageCatalog、B1-B7 和完整旅程。
- manifest 登记 directToAi、sourceDirectories、15 节 brief、+3 不可选、selection/trigger 和禁止 backend-only/zero-material framing。
- 验收：G-01..G-08 可直接附加；路径/ID/来源/规则可校验；没有旧 4 档或无标题画面结论复活。

### B1：Shell + startup

- 单目标：建立 AppShell、ControlPanel、`startup-loading`、`menu-title`、全局 settings/focus 挂载点和基础页/扩展页占位。
- 必须覆盖：加载中、连接失败、重试、安全返回；标题新游戏/继续/选项/退出；无存档继续 disabled；标题进入驻地而非对局。
- 验收：控制面板可挂载完整目录，排除项不出现在导航，所有控件五态且焦点可恢复。

### B2：Battle HUD

- 单目标：完成 `hud-main` 及动作卡、投点、观战、重连、结算边界。
- 必须覆盖：MVP 0/1/2 离散选择，+3 deferred 不可选，selection/trigger effects，HUD 三变体，空手、AP 耗尽、断线/重连和结算失败呈现。
- 验收：不写 AP/伤害/目标/投点规则，参考资产 A-201/A-202 可挂载，A-203 旧档位不被恢复。

### B3：Residence flow

- 单目标：完成出租屋空间、锚定导流仪、异步匹配、影子大厅、床A装载和纯白入梦/返回链。
- 必须覆盖：继续漫游、取消/超时/失败、relay stale/unavailable、床A门控、床B后置、床C自测-only、装载失败/重试/安全返回、returnOrigin。
- 验收：不重载统一大厅，不做四个排除系统内部，不以零素材替代实体资产语义。

### B4：Pause + utilities + feedback

- 单目标：完成暂停、设置生命周期、背包、保险箱、匹配状态、公告/Toast、通知历史和错误恢复的可演示浮层。
- 必须覆盖：暂停四入口、焦点锁/恢复、通知队列/历史、empty/error/timeout/retry/cancel/safe-return。
- 验收：浮层不成为网页 dashboard；所有业务都经 intent；错误不遮掉世界上下文。

### B5：Narrative RPG

- 单目标：完成对话、任务日志、目标追踪、教程帮助、区域名、通知历史和 stats/achievements/codex/recap。
- 必须覆盖：同屏≤5、投影 revision、素材 fallback、`J`/`F1`/`N`、默认不暂停、错误/超时/重同步。
- 验收：任务、成就、图鉴、统计和回顾均只读；回顾 replay 不重新执行剧情；`？？？` 未解锁语义保留。

### B6：Full journey integration

- 单目标：将所有 route、overlay、input arbiter、feedback、UiPorts 和 ControlPanelExtractionBoundary 接成完整旅程。
- 必须覆盖：`cold-start → ... → residence-original-position`，所有节点成功/空/错/超时/重试/取消/安全返回；暂停、设置、叙事、通知、错误、连接反馈仲裁。
- 验收：不新增第二套路由、控制面板或规则状态树；不修改 B1-B5 交付物。

### B7：Motion polish

- 单目标：收束 9 个动效母题、声音/触觉通道、纯白往返、reduced motion、低性能档、60fps 和视觉验收。
- 必须覆盖：资源/音频失败、可跳过、超时、错误、空状态；`state-transition` 和 `click-play` 分开演示。
- 验收：动画只重演已确认结果；+3 recipe 保留但不可选；控制台、资源、音频和 hydration 错误清零。

每个 B 批次的主目标仍保持页面家族分工，但这些目标只能约束本命令改动范围，不能把其他批次变成执行前置。B6/B7 的整合或收束逻辑在单独执行时，读取现有项目并对缺失挂载点做最小补齐。

B1-B7 的入口 Prompt 与所有 numbered brief，以及 Batch 0 的 G-* 全局 brief，都必须依次包含：

1. 页面定位
2. 权威来源（attachmentId / provenance）
3. 当前决策
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

入口额外附加清单不是替代 brief 章节；路径、附件、provenance 和 failure coverage 必须在入口中可读。

## 五、校验和门禁任务

- 校验每个 B1..B7 独立命令：入口路径、同目录 numbered brief、`executionMode`、写锁和改动报告字段；若投喂可选深度附件，再校验 Batch 0/G-*/R-*、attachmentId、directToAi、sourceDirectories。
- 校验 AI-readable brief：15 节顺序/非空、`attachmentId/provenance`、自包含性、mock 标记和明确不做。
- 校验 PageCatalog：G-08 十个新页面、基础/扩展分层、batch 映射、无重复/孤儿。
- 校验参考资产 manifest：A-201/A-202/A-203/A-301 路径、用途、状态、legacy/pending、checksum 字段。
- 校验完整旅程：每个节点有成功和失败回退，失败态覆盖 loading/empty/error/timeout/retry/cancel/safe-return。
- 校验约束：四个内部系统 out-of-scope、+3 不可选且 selection/trigger 存在、无 zero-material framing、无 backend-only reference。
- 收尾门禁：`npx tsc --noEmit`、相关 `npx vitest run`、`npm run lint`、`npm run verify:docs`，并在 execution-report 记录本次实际结果。
