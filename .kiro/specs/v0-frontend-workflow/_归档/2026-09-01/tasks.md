# 任务：偷师前端 Prompt Pack 结构同步

## 概述

实现语言：文档编排与静态结构校验（前置设计线，不产对局代码）。Prompt Pack 的命令结构为 `B1..B7` 独立的 `B-00` 命令；`Batch 0`、`G-*`、`R-*` 和参考资产是可选深度附件。本 spec 只同步结构合同、页面目录、控制面、批次计划、任务和执行记录，不修改 `prompts/`、`src/` 或其他模块。

## 任务

- [x] 1. [独立命令与可选深度附件合同]
  - 固化每个 `B{n}-00` 与同目录 briefs 为可单独投喂的最小命令包。
  - 将 Batch 0/G-01..G-08、R-*、参考资产和前序批次能力改为可选、非阻塞深度附件；命令不依赖对话记忆，可读取并复用整个现有前端项目。
  - 要求入口包含短全局摘要、已有代码复用、范围写锁、缺失挂载点最小补齐和改动报告。
  - _要求：独立命令结构、非阻塞交接和可选附件合同_

- [x] 2. [AI-readable brief 完整性]
  - 固定每份 G-*、B*-00 入口和 numbered brief 的 15 节顺序：页面定位、权威来源、当前决策、状态机、组件树、只读数据、动作意图、本地 UI 状态、视觉令牌、动效绑定、输入无障碍、加载错误超时、明确不做、依赖交接、验收条件。
  - 校验章节非空、编号唯一、顺序稳定、attachmentId/provenance 存在、mock 与 explicit intent 边界明确。
  - 缺节或旧 9/10/11 节模板标记 incomplete，不做隐式补全。
  - _要求：3.1-3.5_

- [x] 3. [自包含附件与 source provenance]
  - 为每个 B1-B7 入口建立本命令入口、同目录 numbered briefs、可选深度附件和参考资产的清单。
  - Batch 0/G-01..G-08、R-*、前序批次能力与参考资产只作可选附件，不得作为启动前置；入口必须可独立执行。
  - 每项登记 attachmentId、路径、directToAi、用途、source role、provenance 和 checksum 状态。
  - 拒绝只提供 backend path、内部类名或未解释源文档链接的附件。
  - _要求：4.1-4.6, 12.1-12.2_

- [x] 4. [作用域与 PageCatalog]
  - 采用“基础页目录 + 扩展页目录”，不再以旧 16 页作为完整目录。
  - 至少登记 G-08 新页面：`startup-loading`、`quest-log`、`objective-tracker`、`tutorial-help`、`location-title`、`notification-history`、`stats`、`achievements`、`codex`、`recap`。
  - 保留 `editor` / `research-bench` / `material-library` / `computer` 内部 out-of-scope，仅允许驻地入口占位。
  - 每个页面登记 family、batch、状态、入口/变体、source provenance、参考资产基线状态和失败回退。
  - _要求：1.1-1.5, 5.1-5.5_

- [x] 5. [控制面板与交互模型]
  - 固化 `switch-page`、`switch-variant`、`filter-category`、`play-state-transition`、`play-click` 五类动作。
  - 控制面板作为唯一切换/抽取边界；动作只改变呈现或提交显式 intent，不写玩法。
  - 所有控件落实 hover/focus/active/disabled/return、pending/accepted/rejected/stale/timeout 和焦点恢复。
  - 统一同屏选择≤5、Radix/等价可访问原语和鼠标/键盘/手柄等价输入。
  - _要求：6.1-6.6_

- [x] 6. [HUD 爆发档位冻结]
  - 固化 MVP `0 / 1 / 2` 离散选择。
  - 将 `+3极限爆发` 保留为 deferred/future-evaluation、不可选择且不可提交；保留 selection effect、trigger effect 和后续 manifest/recipe 交接位。
  - 将旧 4 档参考图登记为 legacy reference，不恢复旧语义。
  - _要求：7.1-7.4_

- [x] 7. [标题、暂停与完整旅程失败态]
  - 标题完整保留新游戏/继续/选项/退出及五脏俱全设置；暂停完整保留继续/设置/重新开始/返回标题。
  - 明确 `startup-loading → menu-title → residence-main → matching/roaming → bed-front-ready → battle-intro → enter-dream → hud-main → overlays → result/reward → return-home → residence-original-position`。
  - 为启动、无存档、匹配、影子中继、装载、转场资源、断线/重连、结算/奖励、原位置缺失补齐 error/empty/timeout/retry/cancel/safe-return。
  - 保留 `床 = 装载入口` 与 `纯白显形唯一传送`；动画失败/跳过不得推进规则。
  - _要求：8.1-8.6, 10.3_

- [x] 8. [参考资产 manifest 与素材口径]
  - 登记 A-201 HUD refined2、A-202 HUD refined、A-203 legacy tier reference、A-301 标题文字提示。
  - 记录路径、kind、适用 page/batch、directToAi、available/pending/legacy 状态、source provenance 和 SHA-256/checksum 字段。
  - 允许素材；素材缺失保留语义位置和正确类别 fallback，不以零素材作为验收目标。
  - 标题实际截图仍 pending 时，必须保留 pending，不得虚报已生成。
  - _要求：9.1-9.4_

- [x] 9. [B1-B7 入口与 numbered briefs]
  - B1：shell/startup；B2：battle HUD；B3：residence flow；B4：pause/utility/feedback；B5：narrative/RPG；B6：full journey integration；B7：motion polish。
  - 每个入口列明 numbered brief 附件、自包含性、失败态、write boundary、provenance 和参考资产。
  - 不把当前缺失的 B1/B4/B6/B7 numbered briefs 或专用索引文件写成已完成。
  - _要求：2.3-2.5, 4.1, 10.1-10.4_

- [x] 10. [独立命令校验]
  - 校验任一 `B{n}-00` + 同目录 briefs 可单独投喂，且入口包含短全局摘要、复用指引、范围写锁、最小挂载点补齐和改动报告字段。
  - 校验 `executionMode = independent-command`，并确认 `dependsOn` 仅表示非阻塞能力交接顺序，不作为启动前置或对话记忆替代。
  - 校验 AI 可读取整个现有前端项目并优先复用已有代码；只在命令写锁内最小补齐挂载点。
  - _要求：独立性验收条款、BatchSpec/PromptPacket 合同_

- [x] 11. [AI references 校验]
  - 校验 AI 直接附件不依赖 AI 自行读取 source copy；sourceDirectories 的 role 与 directToAi 正确。
  - 校验参考资产 manifest 中 A-201/A-202/A-203/A-301 的路径和状态；pending/legacy 不得当作当前成品基线。
  - 校验每个批次入口的附加附件清单与实际文件一致；缺文件、孤儿文件和未登记 asset id 均输出诊断。
  - _要求：4.1-4.6, 9.1-9.4_

- [x] 12. [完整旅程与失败态校验]
  - 校验成功 route 和失败/空/超时/重试/取消/安全返回闭包。
  - 校验 B3 的床A竞技、床B后置、床C自测-only，以及 B6 的 overlay/input arbiter/returnOrigin 边界。
  - 校验错误不绕过标题、驻地、床A门控或纯白 return-home 传送合同。
  - _要求：8.3-8.6, 10.3_

- [x] 13. [三命令门禁与文档门禁]
  - 收尾运行 `npx tsc --noEmit`、相关 `npx vitest run`、`npm run lint` 和 `npm run verify:docs`。
  - 运行静态 Prompt Pack/brief/manifest 校验；记录实际命令、退出状态、失败原因和未执行项。
  - 确认本次仅修改用户允许的五个文件：`requirements.md`、`design.md`、`tasks.md`、`deliverables/03-batch-plan.md`、`execution-report.md`；不修改 `prompts/` 或其他目录。
  - _要求：12.1-12.5_

- [ ] 14. [独立命令实际投喂验证]
  - 分别在无 Batch 0、无前序批次产出和无对话记忆的条件下抽样投喂 B1-00 至 B7-00 与同目录 briefs。
  - 记录已有代码复用、写锁遵守、缺失挂载点最小补齐、改动报告和验证结果；不得以静态文档存在替代实际执行。
  - _要求：Requirement 13 独立性验收_

- 当前 Prompt Pack 的既有入口和 briefs 状态沿用历史基线；本次只同步独立命令结构合同，不代替实际命令投喂验证。
- 本任务只同步五个允许的 spec 结构文档，不修改 `prompts/` 或其他目录；任何入口/附件缺失继续作为后续交接项记录。
- `PageCatalog` 的完整结构属于既有 deliverables 交付物，本次未修改；若仍漂移需作为后续交接项。
