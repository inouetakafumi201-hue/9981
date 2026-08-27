# B9 Prompt Pack：HUD 动作卡 · 目标选择 · 骰子反馈

> batch=B9 execution=independent-command
> depends-on=B2（hud-main / battle-hud 已就位；本批在其上增量）

## 0. Independent Execution Contract

本批在 B2 战斗 HUD 基础上增量优化动作卡、目标选择和骰子反馈的交互体验。AI 必须先阅读 `src/devboard/game-ui-shell-15/components/battle-hud.tsx` 与 `src/devboard/game-ui-shell-15/lib/use-real-actions.ts`，在现有实现上修改。本批只优化**交互反馈**与**可读性**，不实现规则结算、不修改后端 interaction 模型。

---

## 1. Problem Statement

当前 V0 battle-hud 存在以下交互层问题：

### P1：动作卡 disabled 原因不可读

`actionCards` 数组里 cost > `AVAILABLE_AP` 的卡片在渲染时直接 disabled，但 `disabledReason` 字段无差异化文案，鼠标悬停没有 tooltip，玩家看不到"为什么不能点"。

**现状**（来自 `battle-hud.tsx`）：
```typescript
const actionCards: ActionCard[] = [
  { id: 'fireball', name: 'Fireball', cost: 4, ... }, // AVAILABLE_AP=4，仍可
  { id: 'execute', name: 'Execute', cost: 5, ... }, // cost > AVAILABLE_AP, disabled
]
```

但视觉上 disabled 卡片没有可读原因，开发者无法判断是"AP 不足"还是"目标无效"还是"不在玩家回合"。

**期望**：
- 任何 disabled 动作卡必须显示**结构化不可用原因**：
  - `cost > ap` → "AP 不足：需要 5，当前 4"
  - `requires target` + `target invalid` → "需要选中有效目标"
  - `requires roll symbol` → "骰子结果缺 Sword"
  - `cooldown` → "冷却中（X 回合）"
- disabled 原因通过 `aria-describedby` 暴露给屏幕阅读器
- disabled 卡片 hover 显示 tooltip 完整原因
- 减饱和 + 图标切换为禁用态（保留可识别性）

### P2：目标选择进入/退出流程混乱

当玩家点击"需要目标"的动作（如 `cleave` / `fireball`），当前进入 target mode 但：
- 进入 target mode 没有清晰的视觉提示（玩家不知道现在该做什么）
- 取消 target mode 没有 ESC 提示
- 同一目标被错误高亮/未高亮的状态
- 多目标选择（如 AoE）没有数量计数

**期望**：
- 进入 target mode：全屏半透明覆盖层，提示"请选择目标"（含目标类型与数量）
- target cursor 在悬停有效目标时变绿，无效目标变红
- ESC 退出 target mode（屏幕提示"已按 ESC 取消目标选择"）
- 多目标选择时显示 "已选 1/3" 计数器
- 选中后点击确认（或 Enter）提交，cancel 按钮随时可用

### P3：骰子 roll bar 与动作需求可视化弱

`rollBars` 显示 7 个 unit 的骰子结果，但**没有视觉关联**到当前选定动作的 `reqIcons`：
- 玩家选中 `cleave`（需要 sword + burst）后，骰子条应高亮 5（玩家）的 sword + burst
- 当前实现骰子条静态，没有交互反馈

**期望**：
- 选定动作后，骰子条（特别 player）按 `reqIcons` 高亮：
  - 已满足：青色光晕
  - 缺失：灰色 / 红色警告 + 原因
- 多动作需求时同时显示各 req 的状态
- 未选定动作时骰子条静默（不打扰阅读）

### P4：动作提交后无进度反馈

`useRealActions.submit(actionId)` 返回 `true/false`，但 BattleHud 没有：
- 提交中的 loading 态
- rejected 时的 toast / 错误浮层
- accepted 后的视觉确认

**期望**：
- 提交中：动作卡变为 pending 态（橙色边框 + spinner）
- accepted：成功 toast（"已提交：Slash"）
- rejected：动作卡变为红边 + 错误原因浮层（"目标不可用"等）
- 多次重复点击防抖（200ms 内只发一次）

### P5：AP 资源条与动作成本可视化

当前 `AVAILABLE_AP = 4` 是硬编码，资源条不可见，玩家无法直观感受"自己剩多少 AP"。

**期望**：
- 资源条显示当前 AP（虚构但视觉一致）
- 动作卡 cost > AP 时卡片变灰 + AP 差值提示
- 资源条 hover 显示 "AP = 4 / 5"（含最大值）

---

## 2. Scope List

### In scope

- `battle-hud.tsx`：动作卡 disabled 原因结构化 + tooltip + 视觉状态
- `battle-hud.tsx`：目标选择 enter/exit 流（覆盖层 + 计数 + 提示 + ESC）
- `battle-hud.tsx`：骰子 roll bar 与动作需求的视觉关联
- `battle-hud.tsx`：动作卡 submit 进度反馈（pending / accepted / rejected）
- `battle-hud.tsx`：AP 资源条可见化

### Out of scope

- 不修改 `useRealActions.submit` 内部行为（不改变 `sendIntent` 调用）
- 不实现真实 AP 计算（AP 仍可硬编码或从 mock 拉取）
- 不修改交互意图 submission 的规则层（仍走 `ports.actions.submit`）
- 不实现真实目标筛选（仅视觉化当前 target state）
- 不修改 HUD 视觉布局（只增强反馈层）

---

## 3. Reference Materials

- `frontend-battle-hud-baseline` / `run/v0-assets/maps/.../hud-refined2.png`：HUD 视觉基线（参考图）
- `frontend-action-card-spec` / `.kiro/specs/v0-frontend-workflow/prompts/02-battle-hud/B2-02-action-cards-target-context.md`：B2 动作卡原始契约
- `frontend-battle-hud-quality` / `.kiro/specs/v0-frontend-workflow/prompts/02-battle-hud/B2-03-dice-turn-status-visibility.md`：B2 骰子 / 回合态契约
- `frontend-interaction-accessibility` / `00-global/G-04.md`：disabled 五态 + 焦点契约
- `frontend-port-contract` / `00-global/G-03.md`：`IntentResult` 四态 + pending 不等于 accepted
- `frontend-fixtures` / `00-global/G-06.md`：动作卡 fixture + availability 字段

---

## 4. Technical Constraints

### DisabledAction 原因结构

```typescript
type UnavailabilityReason =
  | { kind: 'ap-insufficient'; required: number; current: number }
  | { kind: 'target-required'; targetKind: TargetKind }
  | { kind: 'roll-missing-symbol'; missing: ReqKind[] }
  | { kind: 'cooldown'; rounds: number }
  | { kind: 'not-your-turn' }
  | { kind: 'opponent-invisible' }

interface ActionCardView {
  card: ActionCard
  available: boolean
  unavailability: UnavailabilityReason | null
  pending: boolean  // submit 中
  lastResult: 'accepted' | 'rejected' | 'timeout' | null
}
```

### 目标选择状态机

```text
target-mode-idle
  -> target-mode-selecting   (action 需要目标)
  -> target-mode-cancelled
  -> target-mode-confirmed
  -> target-mode-pending    (submit 中)
  -> target-mode-result     (accepted | rejected | timeout)
```

### 骰子需求可视化规则

```typescript
function rollBarState(roll: RollBar, reqIcons: ReqKind[]): {
  satisfied: boolean
  missing: ReqKind[]
  highlight: 'full' | 'partial' | 'none'
}
```

| 骰子结果 | reqIcons | 状态 |
|----------|----------|------|
| 含 sword+burst | [sword, burst] | full（青光） |
| 仅 sword | [sword, burst] | partial（黄光） |
| 无 sword/burst | [sword, burst] | none（红） |

### Submit 防抖

```typescript
const submitDebounceMs = 200
const lastSubmitRef = useRef<{ time: number; actionId: string } | null>(null)
function debouncedSubmit(actionId: string) {
  const now = Date.now()
  const last = lastSubmitRef.current
  if (last && last.actionId === actionId && now - last.time < submitDebounceMs) {
    return  // 重复点击短路
  }
  lastSubmitRef.current = { time: now, actionId }
  realActions.submit?.(actionId)
}
```

---

## 5. Naming Rules

- 固定组件名：`ActionCard`、`DisabledActionTooltip`、`TargetOverlay`、`TargetCursor`、`RollBarHighlight`、`ApResourceBar`、`SubmitToast`、`ActionPendingIndicator`
- 固定 class：`action-card--disabled-{kind}`（ap-insufficient / target-required / ...）、`action-card--pending`、`action-card--accepted`、`action-card--rejected`、`target-overlay`、`target-cursor--valid`、`target-cursor--invalid`、`target-counter`、`roll-bar--satisfied`、`roll-bar--missing`、`ap-bar`、`ap-bar--depleted`、`submit-toast`
- 固定 intentId：`hud.action.select`、`hud.action.submit`、`hud.target.select`、`hud.target.cancel`、`hud.action.tooltip-show`
- 固定快捷键：`1-9` 数字键选择 action card；`Tab` 切换 target 候选；`Enter` 提交；`Esc` 取消；`Space` 切换动作详情

---

## 6. Interaction Rules

### 动作卡五态

| 状态 | 视觉 | hover 行为 | 键盘行为 |
|------|------|------------|----------|
| `available` | 边框青光、cost 数字青色 | 显示快捷键 | Enter / 数字键 |
| `hovered` | 边框加亮 + 缩放 1.02 | 显示完整 description | — |
| `disabled-ap-insufficient` | 灰色降饱和 + 缺口红条 | tooltip: "AP 不足：需 5 / 当前 4" | 不可激活 |
| `disabled-target-required` | 边框黄 + 目标图标灰色 | tooltip: "需要先选择目标" | 不可激活 |
| `disabled-roll-missing-symbol` | 边框橙 + req 灰 | tooltip: "骰子缺 Sword" | 不可激活 |
| `pending` | 边框橙 + spinner | tooltip: "提交中…" | 不可再次激活 |
| `accepted` | 边框绿 + 1.5s 闪光 | tooltip: "已提交" | 不可再次激活 |
| `rejected` | 边框红 + 错误浮层 | tooltip: "拒绝：{reasonCode}" | 1.5s 后回到 available |

### 目标选择覆盖层

- **进入**：玩家点击需要目标的动作后，触发 `target-mode-selecting` 态：
  - 全屏半透明深色覆盖层（`rgba(0,0,0,0.5)` + `backdrop-blur(4px)`）
  - 顶部居中横幅："请选择目标" + 目标类型（如 "选择 1 个敌方目标"）+ 数量计数器
  - ESC 提示：底部小字 "按 ESC 取消"
- **悬停目标**：
  - 有效目标：绿色描边 + 目标名称 tooltip
  - 无效目标：红色 + "无效目标"提示
  - 鼠标 cursor 变化：`target-cursor--valid` / `target-cursor--invalid`
- **多目标选择**：
  - 计数器 "已选 1 / 3"
  - 已选目标绿色锁定
  - 达上限后不能再选
- **确认 / 取消**：
  - 选中后 `Enter` 提交或点击动作卡重新触发确认
  - `Esc` 取消 → target-mode-cancelled
  - 取消 toast "已按 ESC 取消目标选择"

### 骰子需求高亮

- 玩家**未选定动作**：骰子条静态显示
- 玩家**选定动作**：
  - 玩家（unit 5）骰子条按 `reqIcons` 高亮
  - 满足 req 的符号：青色脉冲
  - 缺失 req 的符号：红色降饱和
  - 其他 unit 骰子条仍可读但不打扰
- 取消动作选定：恢复静态

### Submit 反馈

- 点击动作卡：
  - 即时：动作卡变 `pending` 态
  - `accepted`（200ms 内）：动作卡 `accepted` 态 + 1.5s 闪光 + toast "已提交：Slash"
  - `rejected`：动作卡 `rejected` 态 + 错误浮层 + toast 错误原因
  - `timeout`：动作卡 `rejected` 态 + toast "请求超时"
- 200ms 内重复点击同一动作卡：debounce 短路

### AP 资源条

- 位置：HUD 底部或顶部固定条
- 视觉：5 段 AP pip 段
  - 满 AP：青色 pip
  - 0 AP：空 pip 灰
- hover：tooltip "AP: 4 / 5（可恢复：1）"
- 减 AP 动画：pip 200ms ease-out 消失

---

## 7. Explicit Exclusions

- 不修改 `useRealActions.submit` 内部或 `ports.actions.submit` 行为
- 不实现真实 AP 计算规则（AP 仍可硬编码或从 mock 拉取）
- 不实现真实目标筛选 / 距离判定（仅视觉化当前 target state）
- 不改变 `actionCards` 数组的硬编码数据
- 不修改 HUD 视觉布局（layout / panel 位置）
- 不引入新设计令牌（颜色 / 字号）
- 不实现 V0 接管真实规则
- 不修改 B2 骰子 / 回合态基本契约

---

## 8. Batch Objective

在 B2 战斗 HUD 基础上为动作卡 / 目标选择 / 骰子反馈**增加可读性 + 反馈层**：

1. 动作卡 disabled 原因结构化（5 种 unavailability 原因 + tooltip + 视觉）
2. 目标选择覆盖层 + 计数 + ESC 提示 + cursor 变化
3. 骰子条与动作需求的视觉关联（satisfied / partial / missing）
4. 动作卡 submit 5 态反馈（pending / accepted / rejected / timeout / debounce）
5. AP 资源条可见化

唯一主目标是"动作 / 目标 / 骰子 / 提交 / 资源"五条交互的可读性 + 反馈一致性，不引入新规则、不修改后端端口。

---

## 9. Batch Dependencies

- 前置：B2（hud-main / battle-hud / useRealActions 已就位）
- 同批：依赖 `useRealActions` 的 `submit` / `lastError` / `revision`
- 依赖 `shell-intent.ts` 的 `OUTCOME_REASONS` 失败诊断
- 依赖 `b1-contract.ts` 的 `IntentStatus` 枚举
- 不依赖 B3 / B4 / B5
- 向后续：B9 增强的反馈层可被 B5 RPG 引导 / 教程复用

---

## 10. Acceptance Checks

- [ ] 5 种 disabled 原因（ap-insufficient / target-required / roll-missing-symbol / cooldown / not-your-turn）各有独立 class + tooltip 文案
- [ ] 动作卡 hover 显示 `aria-describedby` 完整原因，键盘 Tab 可达
- [ ] 目标选择覆盖层在点击需要目标的动作时显示，顶部 "请选择目标" + 类型 + 计数器
- [ ] ESC 取消 target mode 显示 toast
- [ ] 多目标选择计数器正确（"已选 1 / 3"）
- [ ] 骰子条按动作 reqIcons 高亮，satisfied / partial / missing 视觉区分
- [ ] 动作卡 submit 5 态（pending / accepted / rejected / timeout / debounce）正确切换
- [ ] 200ms 内重复点击短路
- [ ] AP 资源条 5 段 pip 可见，hover 显示 AP 数值
- [ ] 所有文字和图标共同表达状态，不只靠颜色
- [ ] 键盘可完成所有动作（Tab / Enter / Esc / 数字键）
- [ ] 通过 `npm run typecheck:shell` 和 `npm run lint src/devboard/game-ui-shell-15/components`
