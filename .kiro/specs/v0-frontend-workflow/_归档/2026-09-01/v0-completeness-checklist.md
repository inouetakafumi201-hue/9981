# V0 前端补全清单

> 归属：`.kiro/specs/v0-frontend-workflow` · 交付物
> 目的：记录 V0.dev 提示工程批次中发现的前端设计缺口与补全项，供批量 Prompt 生成使用。
> 更新模式：由 B{n} Prompt 工程批次逐次追加，每个批次在投喂时检查自身目标是否命中以下任一条目。

## 一、清单结构

每条清单项遵循以下形状：

```
[V-{batchId}-{seq}] {category}: {short-title}
  状态：{pending | drafted | fed | verified}
  来源：{触发的 B{n} 批次/专题会话}
  描述：{一句话的问题陈述}
  影响范围：{涉及的页面 / 组件 / 交互}
  补全方式：{V0 Prompt Pack 中的哪个 Prompt / brief 消解}
  链接：{关联 design / brief 路径}
```

- **状态**：`pending` = 已登记未动手；`drafted` = Prompt 正在起草；`fed` = 已投喂 V0；`verified` = 产物落地并通过校验。
- **category**：`hud` | `inventory` | `item-detail` | `residence` | `highlight` | `layout` | `animation` | `cross-batch` 。

---

## 二、设计澄清（执行批次前必读）

下方清单与 B2-B7 brief 在写 Prompt 时应**先读**这两条结论，否则会按 V0 既有误解复刻：

1. **0费/1费切页取消**。V0 现有 BattleHud 把 `cost === 0` 的卡视为与 `cost === 1` 并列的另一种"free 卡片排"；这是误解 L2 语义——L2 的 `costCategory: 'attached'`（0费附赠）**不是独立可选项**，是 `bindings.attached` 随父 `paid` 行动一并提交的子动作。所以前端**只有一个扇形牌组**（全部可玩 paid 行动 + 它们的 attached 子项），不切页。

2. **方案 B 拍板：单扇形 + 一个按钮切 0费池**。底栏左侧一个按钮（与 powerDie/reversal 控件并排），点击切换主扇形为 0费池。0费池承载三件事：
   - `costCategory: 'attached'` 的附赠动作（取消格挡、丢弃物品等）
   - 0费消耗品立即使用
   - 0费主动技能（"蓄力"类瞬发）
   选中某项 → 标记挂载到下个 1费 → 自动切回主扇形 → 主扇形提交时携带 0费。**0费池不只是 attached 临时托管，是机制定位（"免费即时行动"），设计中后期需补 0费专有内容**。

3. **AP 不足的卡**灰显（不是隐藏）。0费池不受 AP 限制。

## 三、当前发现缺口

### [V-B2-01] hud: 单扇形 + 0费池按钮切换

- 状态：pending
- 来源：B2 Battle HUD 会话；本页 §二 设计澄清 2、3
- 描述：保留 V0 现有的 `paidCards` 扇形几何。底栏左侧新增一个"0费"切换按钮（与 `powerDie` / `reversal` 控件视觉一致），点击后主扇形替换为 0费池视图（反过来再点切回）。0费池承载三件事：(a) `costCategory: 'attached'` 的附赠动作；(b) 0费消耗品立即使用；(c) 0费主动技能（如"蓄力"瞬发）。选中某项 → 标记挂载到下个 1费 → 自动切回主扇形 → 主卡提交时携带 0费。**0费池不是 attached 临时托管，是"免费即时行动"机制定位**，后续内容设计需补充 0费专有动作。
- 影响范围：`hud-main`、`action-card` 组件、`handleCardPlay` 提交流程、底栏 toggle 按钮
- 补全方式：B2-00 Battle HUD Prompt + `briefs/B2-03-zero-cost-pool.md`
- 链接：`prompts/02-battle-hud/B2-00-battle-hud-prompt.md`

### [V-B2-02] highlight: 局外模式下高亮操作的交互闭环

- 状态：pending
- 来源：B2/B3 讨论（局外简洁状态）
- 描述：局外中没有卡片，只有高亮。高亮操作已经可以做任何具身事情（如匹配、装载入口传送），但缺少「高亮 → 右键菜单 → 执行」或「高亮 → 左键直接触发」的交互定义。
- 影响范围：`residence-main`（驻地）、`transition-*`、全局高亮层
- 补全方式：B3-00 Residence Flow Prompt + `briefs/B3-01-highlight-embodiment.md`
- 链接：`prompts/03-residence-flow/B3-00-residence-flow-prompt.md`

### [V-B4-01] inventory: Shift 展开半透明背包页

- 状态：pending
- 来源：B4 Pause + utilities 会话
- 描述：背包以 Shift 键打开半透明覆盖层，包含玩家信息、四个物品槽、双手槽、任务目标等。当前 B4 brief 仅登记 `utility-inventory` 占位，未设计 Shift 触发的半透明模式与槽位交互。
- 影响范围：`utility-inventory`、`control-panel-main` 的触发入口
- 补全方式：B4-00 Pause Utility Prompt + `briefs/B4-03-inventory-overlay.md`
- 链接：`prompts/04-pause-utility-feedback/B4-00-pause-utility-prompt.md`

### [V-B4-02] inventory: 整理事件（Tidy）的 AP 消耗与中断处理

- 状态：pending
- 来源：B4/背包会话
- 描述：整理是一个事件，完成后全物品栏高亮可拖动；点击确定消耗 AP。但遭遇交互或轮次结束时背包强制关闭的中断处理，以及 AP 消耗动画/倒计时未定义。
- 影响范围：`utility-inventory`、`hud-main` 的 AP 显示、`selection/trigger effect` 层
- 补全方式：B4-00 + `briefs/B4-04-tidy-event.md`
- 链接：同上

### [V-B4-03] item-detail: 物品详情悬停模态框

- 状态：pending
- 来源：B4 会话
- 描述：物品详情以悬停模态框展示。局外模式下不应只读——高亮操作即可做任何具身，因此模态框需支持直接从悬停执行操作（学习、装备、使用等），不仅仅查看。
- 影响范围：`utility-inventory`、`residence-main`、`item-card` 悬停区域
- 补全方式：B4-00 + `briefs/B4-05-item-detail-modal.md`
- 链接：同上

### [V-B5-01] narrative: 任务目标在半透明背包页的联合展示

- 状态：pending
- 来源：B5 Narrative RPG 会话
- 描述：背包页需联合展示任务目标，但 B5 目前将 `quest-log` 与 `utility-inventory` 分属不同 brief。需确认它们在半透明覆盖层下的层叠关系与数据同步。
- 影响范围：`utility-inventory`、`quest-log`
- 补全方式：B5-00 + `briefs/B5-02-quest-inventory-merge.md`
- 链接：`prompts/05-narrative-rpg/B5-00-narrative-rpg-prompt.md`

### [V-B6-01] layout: 覆盖层层级系统（含半透明背包页）

- 状态：pending
- 来源：B6 Full Journey Integration
- 描述：B6 负责完整旅程路由与覆盖层层级，但半透背包页、悬浮模态框、Toast、暂停菜单等覆盖层的 z 轴优先级与关闭策略未明确。缺少「Shift 背包 + 悬浮 Toast + 暂停」的三者叠加行为定义。
- 影响范围：全页面覆盖层、`menu-pause`、`notice-toast`、`utility-inventory`
- 补全方式：B6-00 + `briefs/B6-03-overlay-stack.md`
- 链接：`prompts/06-full-journey-integration/B6-00-journey-integration-prompt.md`

### [V-B7-01] animation: 背包打开/关闭的 Shift 切换动效

- 状态：pending
- 来源：B7 Motion Polish
- 描述：Shift 打开半透背包页应有切入动画，关闭有退场动画，以及「遭遇中断强制关闭」的打断/打断取消动效。B7 目前仅登记全局动效，未细化这种快捷键触发覆盖层的动画。
- 影响范围：`utility-inventory` 动画、`motion-polish` 全局
- 补全方式：B7-00 + `briefs/B7-02-inventory-motion.md`
- 链接：`prompts/07-motion-polish/B7-00-motion-polish-prompt.md`

### [V-B7-02] animation: 物品详情模态框悬停/退场动效

- 状态：pending
- 来源：B7 Motion Polish
- 描述：详情模态框悬停进入应有渐现/缩放；远离目标退场应有反向动画；以及在半透背包页之上层的进入顺序。
- 影响范围：`item-detail-modal`、`motion-polish`
- 补全方式：B7-00 + `briefs/B7-03-modal-motion.md`
- 链接：同上

---

## 四、补全进度追踪

| 批次 | 涉及清单项 | 状态 | 备注 |
|---|---|---|---|
| Batch 0 | (全局合同 — 不涉及具体 UI 缺口) | — | 仅建立框架 |
| B1 | (Shell + 启动) | — | 不直接命中 |
| B2 | V-B2-01 | pending | 单一扇形 + 卡片背 attached |
| B3 | V-B2-02 | pending | 局外高亮操作 |
| B4 | V-B4-01, V-B4-02, V-B4-03 | pending | 背包页 + 整理事件 + 详情模态 |
| B5 | V-B5-01 | pending | 任务目标联合展示 |
| B6 | V-B6-01 | pending | 覆盖层层级 |
| B7 | V-B7-01, V-B7-02 | pending | 动效 |

> 表格由各 B{n} 批次在执行完成后逐行更新：`pending → drafted → fed → verified`。
