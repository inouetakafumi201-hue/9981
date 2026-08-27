# B11 Prompt Pack：通用反馈层组件库 · Pause · Transition Overlay

> batch=B11 execution=independent-command
> depends-on=B1 + B8（FeedbackLayer 已就位；本批在其上建立通用组件）

## 0. Independent Execution Contract

本批在 B1 AppShell/B1-04 FeedbackLayer 基础上建立**全旅程共享的通用反馈层组件库**，同时优化 `MenuPause` 和 `TransitionResult` 的交互体验。AI 必须先阅读 `src/devboard/game-ui-shell-15/components/menu-pause.tsx`、`src/devboard/game-ui-shell-15/components/settings-panel.tsx`、`src/devboard/game-ui-shell-15/components/transition-result.tsx`、`src/devboard/game-ui-shell-15/lib/use-focus-scope.ts`。本批建立可在 B2/B3/B4/B5 直接复用的组件，不修改 B1 AppShell 框架。

---

## 1. Problem Statement

当前 V0 存在以下反馈层碎片化问题：

### P1：Toast 反馈没有统一组件

B2（HUD）、B3（驻地区）、B4（Pause）各自实现了自己的 toast/error 反馈逻辑：
- HUD 的 `lastError` 只在页脚显示文字
- residence 的 `announce()` 用 `aria-live` 文字
- Pause 没有 toast 机制

结果：同一旅程中不同页面的反馈风格不一致。

**期望**：建立全旅程共享的 `ToastRegion` + `Announcer` 组件，统一所有页面反馈入口：
- Toast 显示：位置（顶部居中）、停留时间（success 3s / error 6s / warning 5s）、堆叠
- Announcer：`aria-live="polite"` 屏幕阅读器播报

### P2：MenuPause 确认流程状态感知弱

`menu-pause.tsx` 的 `RequestPhase` 状态机（pending → accepted/rejected/timeout）：
- pending 态没有明确的视觉 feedback（按钮卡住，但用户不知道发生了什么）
- rejected/timeout 态没有告诉用户"为什么被拒绝"或"下一步是什么"
- "重新开始"确认框没有警告性视觉

**期望**：
- MenuPause 4 选项（继续/设置/重新开始/返回标题）每个有 hover 预览
- 确认框（restart/title）有警告色（橙色标题"确认重新开始？"）+ 倒计时
- pending 态：选项卡 disabled + 全页半透明 + spinner + "等待响应…"
- rejected/timeout：红色 toast + reason + 重试按钮 + 安全返回

### P3：TransitionResult 反馈单向无返回确认

`transition-result.tsx`：
- 当前实现是单向投影（"查看奖励" / "返回驻地"），没有 progress 反馈
- 从 result → reward → return 的转换没有过渡

**期望**：
- 点击"查看奖励" / "返回驻地"后：
  - 按钮 disabled + spinner（pending 态）
  - 200ms 内 accepted → 过渡动画播放
  - rejected → 红色 toast + 按钮恢复 enabled
- 成功过渡时：当前 result overlay 滑出 + 新页面滑入

### P4：Accessibility Announcer 缺失

当前 `aria-live="polite"` 只在 residence 的 `announce()` 中使用，但：
- 没有统一的 announcer 组件
- 没有区分 `assertive`（立即播报）和 `polite`（等待空闲）
- 没有队列机制（连续多个 announce 不会丢失）

**期望**：
- `AccessibilityAnnouncer`：React context provider，在 AppShell 层挂载
  - `useAnnounce()` hook：`announce(message, { priority: 'polite' | 'assertive', duration?: number })`
  - `assertive` 用于 error/timeout/rejected；`polite` 用于 success/toast
  - 队列机制：连续 announce 依次播报（每个 200ms 后释放下一个）
- 每个 toast 同时有对应的 `aria-live` 播报

### P5：Loading/Progress/Empty/Error 四态组件碎片化

当前各页面各自实现 loading/empty/error 态：
- 没有统一的 `PageStateGate` wrapper
- 4 态视觉风格不统一

**期望**：
- `PageStateGate`：统一 wrapper，接受 `state: 'loading' | 'empty' | 'error' | 'ready'` + `children`
- 每个态有标准化布局和反馈
- loading：中心 spinner + 描述文字；empty：icon + 说明 + action；error：icon + reason + retry/safe-return

---

## 2. Scope List

### In scope

- 新建 `src/devboard/game-ui-shell-15/components/toast-region.tsx`：全旅程共享 toast 堆叠区
- 新建 `src/devboard/game-ui-shell-15/components/accessibility-announcer.tsx`：统一 announcer + `useAnnounce` hook
- 新建 `src/devboard/game-ui-shell-15/components/page-state-gate.tsx`：4 态统一 wrapper
- 新建 `src/devboard/game-ui-shell-15/components/action-feedback-button.tsx`：submit pending/rejected/timeout 态按钮
- `menu-pause.tsx`：3 项增强（选项 hover 预览 / pending 态全页反馈 / 确认框警告色）
- `transition-result.tsx`：pending/rejected 态反馈 + 过渡动画

### Out of scope

- 不修改 B1 AppShell 框架结构
- 不在 B1 层建立第二套全局状态树
- 不修改 `UiBackendProvider` / `UiSystem` 内部
- 不实现真实的 loading 模拟（仍用 120ms mock）
- 不修改 B2/B3/B4 页面内部逻辑（B11 组件供它们复用，不是替换）
- 不在 B11 中引入 `zustand` 等新状态管理

---

## 3. Reference Materials

- `frontend-interaction-accessibility` / `00-global/G-04.md`：Toast/LiveRegion 五态 + announcer 要求
- `frontend-port-contract` / `00-global/G-03.md`：IntentResult 四态 + pending 不等于 accepted
- `frontend-motion-fallback` / `00-global/G-05.md`：动效五档（normal/reduced-motion/load-failed/timeout/error）
- `frontend-battle-hud-pause` / `.kiro/specs/v0-frontend-workflow/prompts/04-modal-utility/B4-01-pause-menu-and-restart-confirm.md`：B4 Pause 原始契约
- `shell-focus-scope` / `src/devboard/game-ui-shell-15/lib/use-focus-scope.ts`：FocusScope 封装
- `frontend-fixtures` / `00-global/G-06.md`：loading / empty / error / retrying / safe-return fixtures

---

## 4. Technical Constraints

### ToastRegion 接口

```typescript
type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  kind: ToastKind
  title: string
  body?: string
  duration: number  // ms
  action?: { label: string; onClick: () => void }
  assertive: boolean  // true 时走 aria-live="assertive"
}

interface ToastRegionProps {
  // 注入到 AppShell 层，接收全局 toast context
  maxVisible?: number  // 默认 3
}

declare module 'react' {
  interface ContextProviders {
    ToastProvider: React.Context<{
      toast: (t: Omit<Toast, 'id'>) => void
      dismiss: (id: string) => void
    }>
  }
}
```

### useAnnounce 接口

```typescript
function useAnnounce(): {
  announce: (message: string, opts?: { priority?: 'polite' | 'assertive'; duration?: number }) => void
  announceResult: (status: 'accepted' | 'rejected' | 'timeout', label: string) => void
}
```

### PageStateGate 接口

```typescript
type PageState = 'loading' | 'empty' | 'error' | 'ready'

interface PageStateGateProps {
  state: PageState
  loadingLabel?: string   // 默认 "加载中…"
  emptyLabel?: string     // 默认 "暂无内容"
  emptyAction?: { label: string; onClick: () => void }
  errorLabel?: string     // 默认来自 error.message 或 "加载失败"
  errorReason?: string
  onRetry?: () => void
  onSafeReturn?: () => void
  children: React.ReactNode
}
```

### ActionFeedbackButton 接口

```typescript
interface ActionFeedbackButtonProps {
  intentId: string
  label: string
  onSubmit: () => Promise<{ accepted: boolean; reason?: string }>
  // 或使用 useSubmit 风格的同步 API
  pendingLabel?: string   // 默认 label + "…"
  successLabel?: string   // 默认 label + " ✓"
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}
```

### MenuPause Pending 态布局

当 `RequestPhase.status === 'pending'`：
- 全页半透明深色遮罩（`rgba(0,0,0,0.4)` + `backdrop-blur(2px)`）
- 中心：`Loader2` spinner + 文字"等待响应…" + 可选 cancel 按钮
- 选项卡保持可见但 disabled（不触发误操作）
- 焦点锁定在 spinner 区域

### TransitionResult Pending 态

点击 action button 后：
1. 按钮变为 disabled + spinner + "提交中…"（200ms 内）
2. accepted → 过渡动画
3. rejected → toast 红色 + 按钮恢复 enabled

---

## 5. Naming Rules

- 固定组件名：`ToastRegion`、`Toast`、`AccessibilityAnnouncer`、`PageStateGate`、`ActionFeedbackButton`、`LoadingSpinner`、`EmptyState`、`ErrorState`
- 固定 class：`toast-region`、`toast--{kind}`（success/error/warning/info）、`toast-enter`、`toast-exit`、`announcer`、`page-state-gate--{state}`、`action-feedback-btn--pending`、`action-feedback-btn--success`、`action-feedback-btn--rejected`
- 固定 hook：`useAnnounce`、`useToast`

---

## 6. Interaction Rules

### ToastRegion

- 堆叠：最多 3 条可见，新 toast 从顶部进入
- 入场：`y: -20` → `y: 0`，200ms ease-out
- 离场：停留时间到后 `opacity: 1` → `opacity: 0`，300ms
- 手动关闭：点击 `X` 按钮或 swipe（移动端）
- 堆叠动画：现有 toast 下移 + 新 toast 滑入
- `error` toast 永久显示（无自动消失），需手动关闭
- 点击 toast body 可展开详情（如 reasonCode JSON）
- 每个 toast 自动在 `aria-live` 对应区域播报

### AccessibilityAnnouncer

- `assertive`（rejected/timeout/error）：立即打断屏幕阅读器当前朗读
- `polite`（success/info）：等待当前朗读结束后播报
- 队列：最多 3 条排队，每条间隔 200ms 释放
- `announceResult()` 自动根据 status 选择 priority（rejected → assertive，accepted → polite）
- announcer 本身不可见（`aria-live` region，display:none）

### PageStateGate

- `loading`：居中 spinner + 描述文字 + 可选"取消"按钮
- `empty`：icon + 说明 + action（如"没有匹配记录，重新发起"）
- `error`：icon + reason + retry 按钮 + safe-return 按钮
- 每个态的布局与 `ready` 态的布局使用相同的空间占位（不跳版）

### ActionFeedbackButton

- idle：普通按钮
- pending：spinner + "提交中…" + disabled
- success：绿色勾 ✓ + "已提交" + 1.5s 后回到 idle
- rejected：红色 ✗ + 错误原因 + 恢复 idle（2s 后或用户点击后）
- 防抖：200ms 内的重复点击短路

### MenuPause Enhancements

- 选项 hover：显示次要说明（如"重新开始"下显示"当前进度将丢失"）
- 确认框：橙色标题 + 警告色背景 + 倒计时 10s
- pending 态：全页遮罩 + spinner + 焦点锁定
- rejected/timeout：toast 红色 + 操作建议

---

## 7. Explicit Exclusions

- 不在 AppShell 层建立全局状态管理（只通过 Context 传递 toast/announce API）
- 不修改 B1 AppShell 组件树结构
- 不实现 `zustand` 或其他外部状态管理库
- 不实现真实后端 integration（B11 组件只消费 UI 状态）
- 不在 ToastRegion 中显示 HTML（只支持纯文本 + icon）
- 不让 toast 永久阻塞焦点（error toast 关闭按钮必须可达）
- 不修改 B2/B3/B4/B5 页面内部逻辑（它们会逐步迁移到使用 B11 组件）

---

## 8. Batch Objective

在 B1 + B8 基础上建立**全旅程可复用的通用反馈层组件库**，并增强 MenuPause/TransitionResult：

1. `ToastRegion` + `useToast`：全旅程统一 toast 堆叠（4 态 / 入离场动画 / 手动关闭 / `aria-live`）
2. `AccessibilityAnnouncer` + `useAnnounce`：统一屏幕阅读器 announcer（assertive/polite 队列）
3. `PageStateGate`：4 态统一 wrapper（loading/empty/error/ready 同一空间占位）
4. `ActionFeedbackButton`：submit 5 态按钮（idle/pending/success/rejected/error 防抖）
5. `MenuPause`：选项 hover 预览 + pending 全页遮罩 + 确认框警告色 + 增强诊断
6. `TransitionResult`：pending/rejected 态反馈 + 过渡动画

目标是建立可被 B2/B3/B4/B5 直接 import 的反馈组件库，各页面无需重复实现 toast/announcer/loading/error 逻辑。

---

## 9. Batch Dependencies

- 前置：B1（AppShell / FeedbackLayer）、B8（WiringIntentFeedback）
- 同批：依赖 `shell-intent.ts` 的 `OUTCOME_MESSAGES`、B8 的 wiring feedback 格式
- 依赖 `menu-pause.tsx` / `transition-result.tsx` 的现有状态机
- 依赖 `use-focus-scope.ts` 的 FocusScope 封装
- 不依赖 B2（BUD action feedback）、B3（驻地区 anchor）、B9（B9 的动作卡反馈）、B10（B10 的 journey rail）
- 向后续：B11 组件库可被 B2/B3/B4/B5/B5 直接 import；各页面逐步迁移

---

## 10. Acceptance Checks

- [ ] `ToastRegion` 可在 B1 AppShell 层挂载，提供 `useToast` 给全旅程使用
- [ ] 4 种 toast（success/error/warning/info）各有独立色、停留时间和布局
- [ ] `useAnnounce` 支持 `assertive`/`polite` 区分，队列正确（最多 3 条，200ms 间隔）
- [ ] `PageStateGate` 对 loading/empty/error/ready 提供统一空间占位
- [ ] `ActionFeedbackButton` 有 5 态（idle/pending/success/rejected/error），200ms 防抖正确
- [ ] MenuPause 选项 hover 显示次要说明
- [ ] MenuPause pending 态：全页遮罩 + spinner + 焦点锁定
- [ ] MenuPause 确认框（restart/title）有警告色（橙色标题） + 倒计时
- [ ] TransitionResult 点击后 pending/rejected/rejected 正确反馈
- [ ] 所有 toast 同时有对应的 `aria-live` 播报
- [ ] 所有反馈组件使用 Framer Motion（AnimatePresence + motion.div）
- [ ] 通过 `npm run typecheck:shell` 和 `npm run lint src/devboard/game-ui-shell-15/components`
