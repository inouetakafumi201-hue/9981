# B8 Prompt Pack：Shell Wiring Intent Feedback & Transition UX

> batch=B8 execution=independent-command
> depends-on=B1（AppShell/ControlPanel 已就位；本批在其上增量）

## 0. Independent Execution Contract

本命令在 B1 启动壳层基础上增量，不替换已有的 AppShell/ControlPanel/PageSurface/FeedbackLayer。AI 必须先阅读现有 `src/devboard/game-ui-shell-15/components/product-shell.tsx` 和 `src/devboard/game-ui-shell-15/lib/wiring-mode.ts`，在现有实现上修改，不能另起孤立的 demo 组件。验收范围只限本批定义的交互行为，不要求覆盖全旅程页面。

---

## 1. Problem Statement

当前 V0 shell 的 WiringMode 状态和 transition 状态存在以下 UX 问题：

### P1：WiringMode badge 静态，无实时反馈

`page.tsx` 的 WiringMode badge 显示 wiring mode 字符串，但没有反映实时连接状态。即使 `wiringMode === 'real'`，badge 颜色是固定的，不反映 `uiSystem` 是否真的连接成功。

**现状**：
- `wiringMode` = `mock` 时 badge 灰，`real` 时绿，`iter-V0` 时橙
- 但 UI 没有反映 `uiSystem` 的 `pending`、`connected` 或 `error` 子状态

**期望**：badge 在 `mock` 时显示 mock 灰 + "MOCK" 文字，在 `real` 时根据 `uiSystem` 连接状态显示：
- `idle` → 灰灰 "REAL / DISCONNECTED"
- `pending` → 橙 "REAL / CONNECTING…" 带旋转动画
- `connected` → 绿 "REAL / CONNECTED"
- `error` → 红 "REAL / ERROR" + 可展开诊断

### P2：transition pending 状态显示简陋

`product-shell.tsx` 的 `journey-status` 显示 pending 只有：
```tsx
<span className="journey-pending">
  <Loader2 className="spin" size={12} /> 请求已接受，等待投影提交
  <button type="button" onClick={router.cancel}><X size={11} />取消</button>
</span>
```

问题：
- 没有 intentId 的可读标签
- 没有进度阶段（"已接受" → "等待投影" → "渲染中"）
- cancel 按钮没有 disabled 状态（在 pending 结束前不能点）
- 没有展示 requestId 的调试折叠区

**期望**：
- pending 显示 intent 的语义标签（如"匹配请求已接受"而非"请求已接受"）
- 阶段进度条（3格：ACCEPTED → PROJECTING → RENDERING）
- cancel 按钮在 `cancelled` 后变为已取消 disabled
- 可折叠 `requestId` 调试区（默认隐藏）

### P3：rejected/stale/timeout 状态诊断不足

`journey-failure` 区只显示 `reasonCode` + `message`，缺少：
- 语义化操作建议（"此操作需要先完成匹配"而非"ROUTE_HELD"）
- 4种失败态（rejected/stale/timeout/cancelled）的图标区分
- rejected 时的 reasonCode 是否在 `OUTCOME_MESSAGES` 中有映射

**期望**：
- 4种失败态各有专属图标（🔴rejected / 🟡stale / ⏱timeout / ⚫cancelled）
- reasonCode 通过 `OUTCOME_MESSAGES[reasonCode]` 映射为中文操作建议
- 每个失败态下面给出明确的"重试"、"取消"、"安全返回"按钮，cancelled 态的 cancel 按钮 disabled

### P4：控制面板 wiring 区与 shell 实际状态脱节

`page.tsx` 的 WiringMode 控制块只显示当前 wiring mode，没有：
- 展示当前 active intent 的 pending/rejected/stale 状态
- 显示 revision 计数变化
- 显示 wiring boot 是否已完成

**期望**：
- WiringMode 控制块下方增加 **Active Intent Status** 子区：
  - idle：灰灰 "无活动请求"
  - pending：显示 intent label + 阶段 + cancel 按钮
  - rejected/stale/timeout/cancelled：显示诊断 + 重试/安全返回
- revision 数字随投影更新动画（数字翻转效果）
- wiring boot 完成后显示 ✅ BOOT COMPLETE

---

## 2. Scope List

### In scope

- `product-shell.tsx`：WiringMode badge 接入实时连接状态
- `product-shell.tsx`：transition pending/rejected/stale/timeout/cancelled 状态分层显示
- `product-shell.tsx`：journey-failure 诊断增强（4态图标 + reasonCode 映射 + 按钮状态）
- `page.tsx`：控制面板 wiring 区增加 Active Intent Status 子区 + revision 动画
- `wiring-mode.ts`：必要时增加 `WiringConnectionState` 类型和 `getConnectionState()` 导出

### Out of scope

- 不修改 `bootUiBackend`、`UiSystem` 核心、或接线条逻辑
- 不改变页面组件树结构
- 不修改 B2/B3/B4 页面内部交互
- 不实现真实的 `revision` 动画（只做 CSS/Framer Motion 数字翻转效果）

---

## 3. Reference Materials

以下文件构成当前实现的权威依据：

- `shell-wiring-mode` / `src/devboard/game-ui-shell-15/lib/wiring-mode.ts`：WiringMode 枚举、`wiringModeLabel()`、`wiringModeColor()`、`installWiringMode()`
- `shell-product-shell` / `src/devboard/game-ui-shell-15/components/product-shell.tsx`：当前 `journey-status`、`journey-failure` 和 `wiring badge` 实现
- `shell-control-panel` / `src/devboard/game-ui-shell-15/app/page.tsx`：控制面板 wiring mode 区
- `shell-intent` / `src/devboard/game-ui-shell-15/lib/shell-intent.ts`：`OUTCOME_MESSAGES`、`OUTCOME_REASONS`
- `frontend-interaction-accessibility` / `00-global/G-04.md`：pending/rejected/stale/timeout 五态和焦点契约
- `frontend-port-contract` / `00-global/G-03.md`：`IntentResult` 四态和语义要求

---

## 4. Technical Constraints

### WiringConnectionState 类型

```typescript
export type WiringConnectionState = 'idle' | 'pending' | 'connected' | 'error'

export interface WiringStatusDisplay {
  mode: WiringMode
  connection: WiringConnectionState
  pendingIntent: {
    intentId: string
    label: string
    stage: 'accepted' | 'projecting' | 'rendering'
    requestId: string
    cancellable: boolean
  } | null
  lastResult: {
    status: 'rejected' | 'stale' | 'timeout' | 'cancelled' | null
    reasonCode: string | null
    message: string | null
    suggestion: string | null
  }
  revision: number
  bootComplete: boolean
}
```

### Intent Stage 语义

| Stage | 时机 | 显示 |
|--------|------|------|
| `accepted` | `router.transition.state === 'pending'` 初始 | "已接受，等待投影" |
| `projecting` | 等待超过 1.5s 且 `router.transition.state === 'pending'` | "投影生成中…" |
| `rendering` | 等待超过 3s 且 `router.transition.state === 'pending'` | "渲染画面…" |

### reasonCode 映射

`shell-intent.ts` 中已有 `OUTCOME_MESSAGES` 和 `OUTCOME_REASONS`。如 reasonCode 未登记，回退文案为："未知错误（{reasonCode}），建议安全返回。"

### 语义按钮规则

| 状态 | 按钮组合 | cancel 按钮 |
|------|----------|-------------|
| `idle` | 无 | — |
| `pending` | cancel | 可点击 |
| `accepted` | cancel | 可点击 |
| `projecting` | cancel | 可点击 |
| `rendering` | cancel | 可点击 |
| `rejected` | retry, safe-return | disabled |
| `stale` | retry, safe-return | disabled |
| `timeout` | retry, cancel, safe-return | disabled（超时已结束） |
| `cancelled` | safe-return | disabled（已取消） |

### revision 动画

使用 Framer Motion 的 `AnimateNumber` 或 CSS counter animation。revision 变化时数字向上翻页效果，200ms ease-out。

---

## 5. Naming Rules

- 固定组件名：`WiringStatusBadge`、`IntentPendingBanner`、`IntentFailureAlert`、`ActiveIntentPanel`
- 固定样式 class：`wiring-badge`（已存在）、`wiring-badge--{connection}`（新增）、`intent-pending-banner`、`intent-failure-alert`、`intent-stage-{stage}`、`intent-failure-icon`、`intent-stage-progress`、`active-intent-panel`、`revision-counter`
- 固定 intentId：使用 `shell.cancel`、`shell.retry`、`shell.safe-return`（在 `shell-intent.ts` 已有 `router.cancel`）
- `reasonCode` → 操作建议映射在 `wiring-mode.ts` 或新建 `wiring-diagnostic.ts`

---

## 6. Interaction Rules

### WiringMode badge 交互

- badge 点击不触发 action，只显示 tooltip："当前接线模式：{modeLabel}，连接状态：{connectionState}"
- badge hover 显示可读连接状态描述
- `real` mode + `pending` 时 badge 脉冲动画（橙光呼吸）

### IntentPendingBanner 交互

- 3格进度条用 `AnimatePresence` + `motion.div`，每格依次点亮
- cancel 按钮点击后：
  - 按钮文字变为 "取消中…" + spinner
  - `router.transition.state === 'cancelled'` 后按钮变为 "已取消" disabled
- requestId 调试折叠：点击 `[requestId]` 展开显示完整 UUID（用于调试）
- 超过 5s 未解决，自动显示警告："响应时间较长，可选择安全返回。"

### IntentFailureAlert 交互

- 4种失败态图标：
  - rejected：`AlertCircle` 红色
  - stale：`RefreshCw` 黄色
  - timeout：`Clock` 橙色
  - cancelled：`Slash` 灰色
- 操作建议文案在 icon 下方，灰色小字
- 重试按钮 disabled 直到上次请求完全清理（`transition.state === 'idle'`）
- safe-return 按钮始终可用
- 展开诊断详情（默认收起）：点击 reasonCode 标签展开 JSON 详情

### ActiveIntentPanel 交互

- idle 态："无活动请求" 灰灰小字
- pending 态：黄色背景条，intent label 加粗
- failure 态：红色/黄色/橙色背景条（取决于 failure type）
- revision 数字变化时：向上翻页动画（+1 效果）
- bootComplete 时：绿色 ✅ 在 wiring badge 旁闪烁一次（500ms 后消失）

---

## 7. Explicit Exclusions

- 不修改 `UiSystem`、`UiBackendProvider` 或 `bootUiBackend` 内部逻辑
- 不在 wiring badge 中显示真实后端 URL 或内部类名
- 不把 pending 状态伪装为 accepted 或 successful
- 不删除现有的 `journey-status` / `journey-failure` DOM 结构（只能在其内增量增强）
- 不修改 `router.request()` / `router.cancel()` / `router.safeReturn()` 的实现逻辑
- 不实现真实的 WebSocket 状态检测（WiringConnectionState 由 shell router 的内部状态推断）

---

## 8. Batch Objective

在 B1 AppShell/ControlPanel 基础上，为 V0 shell 增加**可诊断的意图反馈层**：

1. WiringMode badge 实时反映连接状态（idle/pending/connected/error）
2. transition pending 显示3阶段进度（accepted → projecting → rendering）+ intent 语义标签
3. transition failure 显示4态图标 + reasonCode 映射操作建议 + 正确按钮状态
4. 控制面板 wiring 区增加 Active Intent Status 子区 + revision 翻转动画
5. 整体反馈层满足 G-03/G-04 的 pending/rejected/stale/timeout/cancelled 语义契约

---

## 9. Batch Dependencies

- 前置：B1（B1-00/B1-01 已有 AppShell/ControlPanel；B1-04 有焦点契约）
- 同批：依赖 `shell-intent.ts` 的 `OUTCOME_MESSAGES` / `OUTCOME_REASONS`
- 依赖 `wiring-mode.ts` 的 `installWiringMode()` / `parseWiringMode()`
- 依赖 `shell-route.ts` 的 `router.transition` 状态对象
- 不依赖 B2/B3/B4 页面实现
- 向后续：B8 增强的 wiring feedback 可直接被 B2/B3/B4 页面复用（统一反馈格式）

---

## 10. Acceptance Checks

- [ ] WiringMode badge 在 `real` + `pending` 时脉冲橙光，`real` + `error` 时红色 + tooltip
- [ ] pending 状态显示 intent 语义标签（如"匹配请求"而非 generic "请求"）
- [ ] pending 进度条有3格（ACCEPTED / PROJECTING / RENDERING），超时自动降级
- [ ] 4种失败态各有不同图标和背景色，不可混淆
- [ ] reasonCode 通过映射表显示中文操作建议（未知码有 fallback）
- [ ] cancel 按钮在 `cancelled` 后 disabled；timeout 态的 cancel 也 disabled
- [ ] revision 数字变化时有向上翻页动画效果
- [ ] bootComplete 时 wiring badge 旁闪现绿色 ✅（500ms）
- [ ] requestId 在折叠区可展开查看（默认收起）
- [ ] 所有文字和图标共同表达状态，不只靠颜色
- [ ] 键盘可完成所有反馈操作（cancel/retry/safe-return）
- [ ] 通过 `npm run typecheck:shell` 和 `npm run lint src/devboard/game-ui-shell-15`
