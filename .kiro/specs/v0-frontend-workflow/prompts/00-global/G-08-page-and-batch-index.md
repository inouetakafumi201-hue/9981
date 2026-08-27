# G-08 页面与批次索引

## 1 页面定位

这是完整 UI surface 的导航表。AI 使用它判断页面归属、状态和批次，不通过猜测扩展页面。

## 2 权威来源（只写 attachmentId / provenance）

- `frontend-workflow-pages` / `.kiro/specs/v0-frontend-workflow/deliverables/01-scope-and-pages.md`：页面目录与固定组件。
- `frontend-workflow-batches` / `.kiro/specs/v0-frontend-workflow/deliverables/03-batch-plan.md`：批次依赖。
- `rpg-guidance` / `presentation-rpg-07`：任务、教程、通知、统计和回顾 surface。

## 3 当前决策

| pageId | family | batch | 主要状态 |
|---|---|---|---|
| `menu-title` | main-menu | B1 | initial/options/quit-confirm/loading/error |
| `menu-pause` | main-menu | B4 | paused/settings/restart-confirm/return-title-confirm |
| `startup-loading` | main-menu | B1 | loading/retry/error/safe-return |
| `hud-main` | battle-hud | B2 | dice/action/target/settlement/spectator/reconnect |
| `residence-main` | residence | B3 | roam/device/matching/bed-ready |
| `transition-battle-intro` | transition-screen | B3 | show/skip/load-failed |
| `transition-dream` | transition-screen | B3 | enter-dream/return-home/skip/load-failed |
| `transition-result` | transition-screen | B2/B3 | win/lose/draw/timeout/rewards/continue |
| `dialog-line` | narrative-dialog | B5 | entering/typing/waiting/skipped/exiting |
| `dialog-options` | narrative-dialog | B5 | options-focused/selected/rejected |
| `quest-log` | utility-panel | B5 | list/detail/empty/error |
| `objective-tracker` | utility-panel | B5 | active/collapsed/completed/hidden-by-mode |
| `tutorial-help` | system-notice | B5 | first-time/show/replay/disabled |
| `location-title` | transition-screen | B5 | entering/first-visit/return |
| `notice-broadcast` | system-notice | B4/B5 | passive/expanded/closed |
| `notice-toast` | system-notice | B4 | queued/visible/merged/dismissed |
| `notification-history` | utility-panel | B4/B5 | list/read/clear/empty |
| `utility-settings` | utility-panel | B1/B4 | tabs/edit/saving/saved/error |
| `utility-inventory` | utility-panel | B4 | browse/drag/context/empty |
| `utility-safe` | utility-panel | B4 | browse/detail/empty |
| `utility-match` | utility-panel | B3/B4 | preparing/pending/cancelled/timeout/ready/shadow |
| `stats` | utility-panel | B5 | overview/empty |
| `achievements` | utility-panel | B5 | locked/unlocked/empty |
| `codex` | utility-panel | B5 | browse/detail/empty |
| `recap` | utility-panel | B5 | timeline/empty |
| `control-panel-main` | control-panel | B1/B6 | pages/filter/variants/animations |

Out of scope internals: editor, research-bench, material-library, computer. Residence only shows their entry placeholders.

## 4 状态机

Full route: `startup-loading → menu-title → residence-main → utility-match → transition-battle-intro → transition-dream(enter) → hud-main → menu-pause/overlays → transition-result → transition-dream(return) → residence-main`; all failure paths go to retry/cancel/safe-return.

## 5 组件树

AppShell → ControlPanel → PageSurface → overlay stack. Pages use stable pageId and variantId.

## 6 只读数据

Each page reads its own G-06 fixture or StateSnapshot subset; no page reads another page's private rules.

## 7 动作意图

Navigation, settings, pause, match, dialog, tutorial, notification and result actions use intent IDs; no direct business callback.

## 8 本地 UI 状态

Current page, variant, filter, focus, overlay, animation and pagination are local view state.

## 9 视觉令牌

All pages use G-02. Main menu may use a strong authored title asset; HUD uses supplied reference images A-201/A-202 and legacy visual reference A-203 with textual tier override.

## 10 动效绑定

Every transition has enter/exit/skip/fallback; return-home must use pure-white manifestation. B7 owns cross-page polish.

## 11 输入无障碍

Every page has keyboard/pad equivalent, focus return and screen-reader status. `J`/`F1`/`N` shortcuts are scoped and documented in B5.

## 12 加载错误超时

Index includes loading/error/retry for startup, match, dream load, reconnect, settings save and result return.

## 13 明确不做

No hidden new page family, no backend internals, no excluded editor/library/bench/computer pages, no route that bypasses title/residence/bed contract.

## 14 依赖交接

B1 creates shell and startup; B2 HUD; B3 residence; B4 overlays/errors; B5 narrative; B6 integrates; B7 polishes.

## 15 验收条件

Every pageId maps to one batch and one entry brief; every entry lists attachments; full route has success and failure paths; no orphan or duplicate IDs.