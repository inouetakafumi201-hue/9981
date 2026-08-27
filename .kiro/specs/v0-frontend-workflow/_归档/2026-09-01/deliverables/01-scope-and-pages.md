# 偷师前端 · 设计定稿 01：作用域与页面目录

> 归属：`.kiro/specs/v0-frontend-workflow` · 交付物
> 依据：requirements §1/§5/§8/§9；G-01、G-08
> 状态：结构同步（2026-08-20）
> 口径：完整 UI 壳层 / AI-readable Prompt Pack / 允许登记素材；不把零素材作为目标

## 一、ScopeRegistry

| scope id | 状态 | 当前口径 | provenance 角色 |
|---|---|---|---|
| `main-menu` | in-scope | 标题画面四入口、选项设置、退出确认 | `frontend-workflow-requirements` normative |
| `startup-loading` | in-scope | 启动加载、重试、错误和安全返回 | `G-08` current contract |
| `battle-hud` | in-scope | 对局 HUD、固定组件、0/1/2 爆发选择与反馈 | `frontend-workflow-requirements` normative |
| `residence` | in-scope | 出租屋空间、实体入口、床前就绪 | `ops-residence-flow-03` support |
| `narrative-dialog` | in-scope | 单句/选项对话、立绘和字幕降级 | `narrative-dialog-system` support |
| `transition-screen` | in-scope | 对局介绍、入梦、结算、返回和区域名演出 | `journey-current-ruling` normative |
| `system-notice` | in-scope | 公告、Toast、教程帮助和反馈 | `rpg-guidance` support |
| `control-panel` | in-scope | 唯一 UI 切换与抽取表面 | `frontend-workflow-design` normative |
| `utility-panel` | in-scope | 设置、背包、保险箱、匹配、任务和档案 | `G-08` current contract |
| `editor` | out-of-scope | 只保留边界证据，不进入页面目录 | `map-editor-iteration-v2` boundary |
| `research-bench` | out-of-scope | 驻地可有入口占位，不展开内部 | `bench-v0` boundary |
| `material-library` | out-of-scope | 驻地可有入口占位，不展开内部 | `material-library-v0` boundary |
| `computer` | out-of-scope | 驻地可有入口占位，不展开内部 | `operations-residence-03` boundary |
| `map nodes / topology / node movement / ORCA / pathfinding / gameplay rules` | out-of-scope | 不进入 UI Prompt 语义 | `G-01` normative boundary |

### 用户裁决保留

- `editor`、`research-bench`、`material-library`、`computer` 的内部页面始终 out-of-scope；驻地只展示入口占位和职责说明。
- 素材允许且鼓励使用已登记成品、纹理、光效、立绘、图标和参考图。缺素材时需要可追踪的语义降级，但不以“零素材渲染”作为验收目标。
- HUD MVP 爆发档位为 `0 / 1 / 2`；`+3极限爆发` deferred、不可选，但 selection/trigger 特效和后续 recipe/manifest 交接位保留。
- 标题画面和暂停菜单完整保留。标题包含 `新游戏`、`继续`、`选项`、`退出`；暂停包含 `继续`、`设置`、`重新开始`、`返回标题`。

## 二、PageCatalog 组织

旧的“共 16 个页面”只适用于基础页集合，不再代表完整目录。本目录采用“基础页目录 + 扩展页目录”；所有页面都通过 `control-panel-main` 挂载。

### 2.1 基础页目录

| pageId | family | batch | 主要状态 | 变体/入口 | 基线 |
|---|---|---|---|---|---|
| `menu-title` | main-menu | B1 | initial / options / quit-confirm / loading / error | new-game / continue / options / quit | 文字附件 `A-301`；截图 pending |
| `menu-pause` | main-menu | B4 | paused / settings / restart-confirm / return-title-confirm | pause | pending |
| `hud-main` | battle-hud | B2 | dice / action / target / settlement / spectator / reconnect | standard / solo / minimal | `A-201` 主基线；`A-202` 辅助 |
| `residence-main` | residence | B3 | roam / device / matching / bed-ready / empty / error | mvp-first | pending；允许登记实体素材 |
| `transition-battle-intro` | transition-screen | B3 | show / skip / load-failed | intro | pending |
| `transition-dream` | transition-screen | B3 | enter-dream / return-home / skip / load-failed | enter-dream / return-home | pending；纯白显形合同 |
| `transition-result` | transition-screen | B2/B3 | win / lose / draw / timeout / rewards / continue / error | result | pending |
| `dialog-line` | narrative-dialog | B5 | entering / typing / waiting / skipped / exiting / error | with-portrait / no-portrait | 文本布局；pending |
| `dialog-options` | narrative-dialog | B5 | focused / selected / rejected / timeout | with-portrait / no-portrait | 文本布局；pending |
| `notice-broadcast` | system-notice | B4/B5 | passive / expanded / closed / error | announcement / event | pending |
| `notice-toast` | system-notice | B4 | queued / visible / merged / dismissed / error | info / error | pending |
| `control-panel-main` | control-panel | B1/B6 | pages / filter / variants / animations / feedback | single surface | pending |
| `utility-settings` | utility-panel | B1/B4 | tabs / editing / saving / saved / error | settings | pending |
| `utility-inventory` | utility-panel | B4 | browse / drag / context / empty / error | inventory | pending |
| `utility-safe` | utility-panel | B4 | browse / detail / empty / error | safe | pending |
| `utility-match` | utility-panel | B3/B4 | preparing / pending / cancelled / timeout / ready / shadow / error | match | pending |

### 2.2 扩展页目录（G-08 必须项）

| pageId | family | batch | 主要状态 | 入口/说明 | 基线 |
|---|---|---|---|---|---|
| `startup-loading` | main-menu | B1 | loading / retry / error / safe-return | 冷启动和连接反馈 | pending |
| `quest-log` | utility-panel | B5 | list / detail / empty / error / stale | `J`、暂停或控制面板入口 | pending |
| `objective-tracker` | utility-panel | B5 | active / collapsed / completed / hidden-by-mode / stale | 世界层附着，不遮挡 HUD | pending |
| `tutorial-help` | system-notice | B5 | first-time / show / replay / disabled / error | `F1` 帮助、教程重放 | pending |
| `location-title` | transition-screen | B5 | entering / first-visit / return / fallback | 区域进入演出 | pending |
| `notification-history` | utility-panel | B4/B5 | list / read / clear-view / empty / error / stale | `N` 打开；只读历史 | pending |
| `stats` | utility-panel | B5 | overview / empty / error | archive tab | pending |
| `achievements` | utility-panel | B5 | locked / in-progress / unlocked / empty / error | archive tab | pending |
| `codex` | utility-panel | B5 | browse / detail / locked / empty / error | archive tab | pending |
| `recap` | utility-panel | B5 | timeline / detail / empty / error / stale | archive tab | pending |

### 2.3 目录不变量

- 目录至少 26 页；`startup-loading`、`quest-log`、`objective-tracker`、`tutorial-help`、`location-title`、`notification-history`、`stats`、`achievements`、`codex`、`recap` 不得遗漏。
- 每个 pageId 必须映射到至少一个 batch、一个 AI-readable entry/brief 和一个 scope 状态；不得重复登记或出现孤儿页。
- `family` 只描述 UI surface；不得把 `residence-main` 或 `control-panel-main` 描述成地图拓扑、节点遍历或规则执行器。
- 每页的主要状态必须包含适用的 loading、empty、error、timeout、retry、cancel 或 safe-return 分支；不适用项要在对应 brief 中明确说明。
- 每页允许使用 `assetRef`/`assetId` 挂接实际素材。素材缺失时保留语义容器、文字、焦点和诊断，不借用错误语义素材。

## 三、完整旅程页面关系

```text
startup-loading
  → menu-title
  → residence-main
  → utility-match / residence-main roaming / utility-match shadow
  → bed-front-ready
  → transition-battle-intro
  → transition-dream (enter-dream)
  → hud-main
  → menu-pause / utility-settings / narrative / notice / error overlays
  → transition-result
  → reward presentation
  → transition-dream (return-home)
  → residence-main at returnOrigin
```

任何节点都必须保留上下文失败路径：加载失败可重试/取消/安全返回；匹配可取消/超时/失败；影子中继可 stale/unavailable；转场资产缺失可语义降级；结算/奖励失败可重试或返回；原位置缺失不得静默跳默认点。

## 四、参考资产与 provenance 摘要

| assetId | 路径 | kind | 用途 | 状态/约束 |
|---|---|---|---|---|
| `A-201` | `prompts/references/assets/A-201-hud-refined2.png` | image | `hud-main` 主 layout/state | available；主基线 |
| `A-202` | `prompts/references/assets/A-202-hud-refined.png` | image | `hud-main` 辅助 layout | available；辅助基线 |
| `A-203` | `prompts/references/assets/A-203-hud-v3-legacy-tier-reference.png` | image | HUD legacy layout 对照 | legacy-reference；档位以 0/1/2 合同覆盖 |
| `A-301` | `prompts/references/assets/A-301-menu-title-text-prompt.md` | text-prompt | `menu-title` 文字视觉提示 | available；标题截图仍 pending |

上述资产的详细 directToAi、source provenance、用途约束和 checksum 状态以参考资产 manifest 为准。source copies 只作人工追溯，不是 AI 自由阅读入口。

## 五、固定 brief 合同

所有 G-*、B*-00 入口和 numbered brief 均使用以下 15 节，顺序不可改变：

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

每个批次入口还必须列：Batch 0 G-01..G-08、numbered briefs、参考资产、附加附件、失败态覆盖、write boundary 和 checksum/路径校验状态。
