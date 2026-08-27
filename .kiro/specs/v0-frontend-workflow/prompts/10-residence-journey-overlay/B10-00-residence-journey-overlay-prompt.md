# B10 Prompt Pack：Residence · Journey Dock · Overlay 交互层

> batch=B10 execution=independent-command
> depends-on=B1 + B3（residence-main 已就位；本批在其上增量）

## 0. Independent Execution Contract

本批在 B3 驻地主界面和 B1 AppShell 基础上增量优化驻地区、journey dock 和 overlay 交互。AI 必须先阅读 `src/devboard/game-ui-shell-15/components/residence-main.tsx` 和 `src/devboard/game-ui-shell-15/components/product-shell.tsx` 的 journey dock 区（`journey-dock`、`journey-status`、`journey-failure`）。本批只优化**驻地区 + dock + overlay 反馈**，不修改漫游 WASD 移动底层、B1 AppShell 层级或 B8 的 wiring feedback。

---

## 1. Problem Statement

当前 V0 residence + product-shell 存在以下交互问题：

### P1：Anchor 6 态可视化层级薄弱

`anchorState` 6 态（idle / ready / matching / complete / timeout / failed）目前在 residence 页面没有统一的**状态展示区**：
- `idle`：无提示（正常）
- `ready`：`anchor panel` 显示"锚定导流仪就绪"，但没有状态色区分
- `matching`：只有计时器 + toast，页面上没有醒目的"匹配中"视觉
- `complete`：床A点亮，但 `bedALit` 是布尔值，没有说明
- `timeout`：toast 文案太长，没有清晰的重试/取消 CTA
- `failed`：与 timeout 视觉无区分

**期望**：
- 页面顶部增加 **Anchor Status Bar**（固定条，高度 36px）：
  - idle：灰灰"锚定导流仪 · 未连接"
  - ready：蓝色脉冲"锚定导流仪 · 就绪" + 点击可发起匹配
  - matching：橙色旋转图标"匹配中…" + 可取消按钮（`X` 小按钮）
  - complete：绿色"匹配完成 · 床A已点亮" + 向导动画（箭头指向床A）
  - timeout：黄色警告"匹配超时" + 重试按钮
  - failed：红色"匹配失败" + 重试按钮
- 状态条 hover 显示详细诊断（如"上次匹配耗时 11.2s / 超时阈值 12s"）

### P2：床 A 就绪确认流程粗糙

当前 `bedAReadyPromptOpen` 触发时机是 `bedALit && nearBedA`，但：
- 确认弹框简陋，没有倒计时
- 取消后玩家不知道该做什么
- 就绪后 `onEnterDream` 没有 progress feedback

**期望**：
- 就绪弹框：`AnimatePresence` 滑入，居中覆盖层
- 内容："确认在床 A 就绪？进入造梦。" + 床A图标 + 倒计时 8s（超时自动关闭）
- 倒计时可视化：圆弧进度环 + 数字
- 确认按钮：青色主按钮"就绪"（Enter 快捷键）
- 取消按钮：灰色"返回"（Esc）
- 倒计时结束自动关闭，显示 toast"就绪超时，重新靠近床A"
- 确认后：弹框消失 + 全屏白色淡入过渡（入梦仪式）

### P3：Journey Dock 与驻地区断连

`product-shell.tsx` 的 `journey-dock`（`MOCK JOURNEY` 面板）是开发者调试 UI，不是产品 UI。但当前实现有严重问题：
- 面板与 residence 实际 anchor state 不同步
- `RESIDENCE_ACTIONS` 是硬编码映射，不反映 residence 的真实状态
- 面板里的"当前节点"没有清晰解释"这是什么阶段"

**期望**：
- 在 `residence-main.tsx` 中增加 **Residence Journey Rail**（产品级 UI，不是开发调试）：
  - 固定在页面底部，高度 48px
  - 显示当前驻地在整体旅程中的位置（用节点图）
  - 节点：`出租屋` → `匹配中` → `床A就绪` → `入梦` → `对局` → `结算`
  - 当前节点高亮（用纯白/金边），已完成节点实心，未到达节点空心
  - 当前节点 label 大字，已完成 label 小字
- **此为产品 UI**（不是开发调试），但数据仍来自 mock（`source: mock` 标签可见）
- 开发调试的 `journey-dock`（`MOCK JOURNEY`）保留在 product-shell 的开发覆盖层，但标注为"仅调试"

### P4：驻地区 Overlay（设置/公告/保险箱）焦点混乱

当前 residence 的 overlay（settings / notice / safe / desk 等）：
- 打开时没有 FocusScope
- 关闭时焦点没有归还触发器
- 没有 ESC 提示

**期望**：
- 所有驻地区 overlay 使用 `AnimatePresence` + `FocusScope`
- 打开时焦点进入 overlay 标题或首个有效控件
- 关闭/ESC 后焦点归还触发器（`settingsTriggerRef` 等）
- 每个 overlay 的 header 有"按 ESC 关闭"小字（`aria-label`）

### P5：竞争匹配模拟流程缺引导

`startCompetitiveMatch()` / `cancelMatch()` / `retryMatch()` 的模拟流程：
- 匹配中 2200ms 太短，用户看不清状态变化
- 超时文案"匹配超时（mock）"暴露了 mock 实现
- 重试路径没有清晰引导

**期望**：
- 匹配进度可视化：进度条从 0% → 100%（2200ms 内）
- 进度条分段：
  - 0-30%："正在寻找对手…"
  - 30-70%："对手已找到，等待确认…"
  - 70-90%："匹配成功，准备传送…"
  - 90-100%："床A已点亮"
- 超时改为"匹配未能完成，请稍后重试"（不暴露 mock）
- 重试按钮引导文案："重新发起匹配"（代替技术性"retryMatch"）

---

## 2. Scope List

### In scope

- `residence-main.tsx`：Anchor Status Bar（6 态可视化）
- `residence-main.tsx`：床 A 就绪确认弹框（倒计时 + 入梦仪式）
- `residence-main.tsx`：Residence Journey Rail（产品级旅程节点图）
- `residence-main.tsx`：驻地区 overlay（FocusScope + ESC 提示）
- `residence-main.tsx`：竞争匹配进度条（分阶段引导）
- `product-shell.tsx`：开发调试 dock 标注"仅调试"

### Out of scope

- 不修改 WASD 漫游底层实现
- 不修改 `useRoamController` / `playerPos` / `BED_A_RADIUS` 计算
- 不修改 `anchorState` 状态机逻辑（6 态不变）
- 不修改 AppShell 全局层级
- 不实现真实网络匹配（仍用 2200ms mock timer）
- 不修改 B8 wiring feedback
- 不改变驻地区视觉风格（只增强反馈层）

---

## 3. Reference Materials

- `frontend-residence-baseline` / `src/devboard/game-ui-shell-15/components/residence-main.tsx`：当前 6 态 anchor + bedA 就绪逻辑
- `frontend-journey-ruling` / `00-global/G-08.md`：旅程抽象为 startup → title → residence → ...，失败路径 retry/cancel/safe-return
- `frontend-residence-flow` / `.kiro/specs/v0-frontend-workflow/prompts/03-residence-flow/B3-01-residence-node-and-input.md`：驻地基线
- `frontend-interaction-accessibility` / `00-global/G-04.md`：FocusScope + ESC 提示 + overlay 焦点规则
- `frontend-motion-fallback` / `00-global/G-05.md`：入梦仪式使用纯白显形（不是黑幕）
- `frontend-fixtures` / `00-global/G-06.md`：`source: mock` 标签要求

---

## 4. Technical Constraints

### AnchorStatusBar 组件

```typescript
type AnchorStateDisplay = {
  state: AnchorState
  label: string
  sublabel: string
  progress?: number  // 0-100，matching 时使用
  cancellable: boolean
  retryable: boolean
  suggestion: string  // 操作建议
}

const ANCHOR_STATE_DISPLAY: Record<AnchorState, AnchorStatusDisplay> = {
  idle:    { label: '未连接', sublabel: '锚定导流仪', progress: undefined, cancellable: false, retryable: false, suggestion: '等待匹配入口就绪' },
  ready:   { label: '就绪', sublabel: '锚定导流仪', progress: undefined, cancellable: false, retryable: false, suggestion: '可发起匹配' },
  matching:{ label: '匹配中', sublabel: '…', progress: 0, cancellable: true, retryable: false, suggestion: '正在寻找对手' },
  complete:{ label: '匹配完成', sublabel: '床A已点亮', progress: 100, cancellable: false, retryable: false, suggestion: '靠近床A就绪' },
  timeout: { label: '超时', sublabel: '未完成匹配', progress: undefined, cancellable: false, retryable: true, suggestion: '可重新发起匹配' },
  failed:  { label: '失败', sublabel: '匹配失败', progress: undefined, cancellable: false, retryable: true, suggestion: '可重新发起匹配' },
}
```

### 倒计时组件

```typescript
interface ConfirmCountdown {
  seconds: number  // 倒计时秒数
  onConfirm: () => void
  onCancel: () => void
  onTimeout: () => void
}
```

### Journey Rail 节点

```typescript
const JOURNEY_RAIL_NODES = [
  { id: 'residence', label: '出租屋', variant: 'completed' | 'current' | 'future' },
  { id: 'matching', label: '匹配中', variant: 'completed' | 'current' | 'future' },
  { id: 'bed-ready', label: '床A就绪', variant: 'completed' | 'current' | 'future' },
  { id: 'enter-dream', label: '入梦', variant: 'completed' | 'current' | 'future' },
  { id: 'battle', label: '对局', variant: 'future' },
  { id: 'result', label: '结算', variant: 'future' },
] as const
```

### FocusScope 封装

每个 overlay（settings / notice / safe / desk / pod / computer / bookshelf）必须用 `FocusScope` 包裹：
```tsx
import { FocusScope } from '@radix-ui/react-focus-scope'
<FocusScope>
  <div role="dialog" aria-label={overlayTitle} aria-modal="true">
    <h2>{overlayTitle}</h2>
    <button onClick={closeOverlay}>关闭</button>
    <p>按 ESC 关闭</p>
  </div>
</FocusScope>
```

---

## 5. Naming Rules

- 固定组件名：`AnchorStatusBar`、`MatchingProgressBar`、`BedAConfirmDialog`、`ConfirmCountdownRing`、`ResidenceJourneyRail`、`JourneyRailNode`、`ResidenceOverlay`
- 固定 class：`anchor-status-bar`、`anchor-status-bar--{state}`、`matching-progress`、`matching-progress--{stage}`、`bed-confirm-dialog`、`countdown-ring`、`journey-rail`、`journey-rail-node--{variant}`、`residence-overlay`
- 固定 overlay id：`overlay-settings`、`overlay-notice`、`overlay-safe`、`overlay-desk`、`overlay-pod`、`overlay-computer`、`overlay-bookshelf`

---

## 6. Interaction Rules

### AnchorStatusBar

- 点击 ready 态的 status bar → 触发 `startCompetitiveMatch()`
- matching 态的 `X` 按钮 → `cancelMatch()`（显示确认吗？不需要，直接取消）
- timeout / failed 态的"重试"按钮 → `retryMatch()`
- complete 态的 status bar → toast "请靠近床A就绪"（不触发 action）

### BedAConfirmDialog

- 弹框滑入（`AnimatePresence` + `y: 20` → `y: 0`）
- 倒计时圆弧：SVG circle + stroke-dashoffset，每秒更新
- 8s 内：
  - Enter / 点击"就绪" → `confirmBedAReady()` → 弹框消失 + 全屏白色淡入 + `onEnterDream()`
  - Esc / 点击"返回" → `cancelBedAReady()` → 弹框消失
- 8s 后：自动关闭 + toast "就绪超时，重新靠近床A"
- 关闭/超时后焦点归还到触发按钮（bed A hotspot）

### ResidenceJourneyRail

- 只读产品 UI，数据来自 mock（`source: mock` 标签）
- 当前节点：金色实心圆 + label 大字
- 已完成节点：实心小圆
- 未到达节点：空心圆
- 节点间连线：虚线，current 之后变实线
- 页面间切换时 rail 更新（如进入 HUD 主战场后 rail 显示"对局"高亮）

### Overlay Focus

- 所有驻地区 overlay 用 `AnimatePresence` + `FocusScope`
- 打开：`motion.div` 从 `y: 20` 滑入 + backdrop 淡入
- 焦点进入 overlay header 或首个控件
- 关闭/ESC：反向动画 + 焦点回触发器
- header 小字："按 ESC 关闭"（`aria-label`）

### 匹配进度条

- 2200ms 分 4 阶段，每阶段有独立 label
- 进度条分段颜色：橙色（寻找）→ 蓝紫（已找到）→ 绿色（成功）
- 完成后 500ms 保持显示 → 自动关闭 + 跳到 complete 态

---

## 7. Explicit Exclusions

- 不修改 `anchorState` 状态机逻辑（6 态名称/转换不变）
- 不修改 WASD 漫游 / `useRoamController` / `playerPos` 底层
- 不修改 B8 wiring feedback（`journey-status` / `journey-failure` 不在本批范围）
- 不实现真实匹配（mock 2200ms 计时器不变）
- 不在 AnchorStatusBar 中显示后端 URL 或内部类名
- 不把 `source: mock` 标签隐藏（Journey Rail 必须可见）
- 不把入梦仪式做成黑幕（必须用纯白显形，按 G-05）

---

## 8. Batch Objective

在 B1 + B3 驻地主界面基础上，为驻地区增加**可读的 Anchor 反馈 + Journey Rail + Overlay 焦点管理**：

1. Anchor Status Bar：6 态固定条（idle/ready/matching/complete/timeout/failed）各带语义色 + 操作建议
2. BedAConfirmDialog：倒计时圆弧 + 就绪/返回/超时自动关闭 + 入梦白色淡入
3. ResidenceJourneyRail：产品级旅程节点图（6 节点），数据来自 mock，`source: mock` 可见
4. 驻地区所有 overlay：FocusScope + ESC 提示 + 焦点归还
5. 匹配进度条：4 阶段分段可视化，不暴露 mock 术语

唯一主目标是"驻地区 + dock + overlay"反馈层可读性，不修改漫游、状态机或后端接线。

---

## 9. Batch Dependencies

- 前置：B1（AppShell/FeedbackLayer）、B3（residence-main）
- 同批：依赖 `residence-main.tsx` 的 `anchorState`、`playerPos`、`nearBedA`、`bedAReadyPromptOpen`
- 依赖 `product-shell.tsx` 的 `router.nodeId`、`router.pageId`、`onEnterDream` props
- 不依赖 B2（HUD）、B8（wiring feedback）、B9（action feedback）
- 向后续：B10 的 ResidenceJourneyRail 状态可被 B5 叙事/RPG 引导复用

---

## 10. Acceptance Checks

- [ ] Anchor Status Bar 6 态各有专属色（灰/蓝/橙/绿/黄/红）和操作建议
- [ ] matching 态显示进度条（4 阶段）+ 取消按钮
- [ ] BedAConfirmDialog 有圆弧倒计时 8s，Enter/ESC/超时各路径正确
- [ ] 就绪确认后全屏白色淡入（入梦仪式），不是黑幕
- [ ] ResidenceJourneyRail 显示 6 节点，current/completed/future variant 区分清晰
- [ ] JourneyRail 数据来自 mock，`source: mock` 标签可见
- [ ] 所有驻地区 overlay 有 FocusScope + ESC 提示，关闭后焦点回触发器
- [ ] 匹配超时文案不暴露 mock（改为"未完成匹配，请稍后重试"）
- [ ] 键盘可完成所有驻地区操作（Tab / Enter / Esc）
- [ ] 所有文字和图标共同表达状态，不只靠颜色
- [ ] 通过 `npm run typecheck:shell` 和 `npm run lint src/devboard/game-ui-shell-15/components`
