# 双轨制实施规划（v0.1）

> 目标：把"高亮轨 + 卡片轨"双轨制从概念肃清落到 L2 契约 + 前端接线，跑通 demo。
> 状态：v0.1，待 owner 拍板。
> 前置：`.kiro/双轨制-L2契约扩展草稿.md` 是契约锚点，本规划是落地路径。

---

## 阶段总览

| 阶段 | 名称 | 范围 | 风险 |
|---|---|---|---|
| **P0** | 术语肃清 + 缺口登记 | 文档层，不动代码 | 低 |
| **P1** | L1 + L2 契约扩展 | types.ts / family-contracts.ts / projection.ts / view.ts | 中（**核心契约层**） |
| **P2** | 投影与校验链落地 | ui-adapter.ts / descriptor-validator.ts | 中 |
| **P3** | 玩法层数据填充 | 给所有 ActionDef 补 `track` + `cardPresentation` 引用 | 中（涉及全部 ActionDef） |
| **P4** | 前端 BattleHud 数据层重写 | 接 L2 真实数据 | 高（**前端最重的活**） |
| **P5** | 发牌器 + 0费/1费切页 | 新增 UI 组件 | 中 |
| **P6** | 高亮轨地图交互 | 新增 UI 组件 | 中 |
| **P7** | 集成测试 + 端到端 demo | 全链路验证 | 低 |

**关键依赖**：
- P0 完成才能进 P1（术语不肃清，L1 改了会撞已有文档）
- P1 → P2 → P3 强顺序
- P3 不必 P2 全完，可以先填少量 def 做"概念验证"
- P4 必须在 P3 完成后（数据层有 `track` 才能切池）
- P5 / P6 独立，可并行
- P7 必须等 P4-P6 全完

---

## P0 术语肃清 + 缺口登记

**目标**：把"表现层 5 义"统一为一个权威表；把双轨制设计-实现冲突登记。

**动作**：
1. 在 `docs/表现系统/00_术语与命名.md` 新建（如果不存在），列出 5 义对照表：
   - 表现系统（正交域，L0 第十三条）
   - PresentationDescriptor（数据类型，src/l2/model/projection.ts:213）
   - 表现层（运行链位置，14_ 文档新分层）
   - 渲染交互层（V0 壳层，14_ §一.1）
   - src/ui/presentation/（代码子目录，accessibility + descriptor-validator）

2. 登记以下"待裁决 / 待补"项到 `docs/00_主状态板.md`：
   - 动作卡片是否显示 AP 数字（已定：保留菱形 ◆）
   - `dnd-kit` 必装 vs 后置档（已定：必装但属后期）
   - `rvo2-js` / `pathfinding` 必装裁决
   - `≤5 分级导航` vs `两套独立菜单` 模型合并

3. 在 `docs/表现系统/14_表现层架构设计.md` 顶部加 banner，引用 00_术语与命名.md

**交付**：`00_术语与命名.md` 落档 + 主状态板 D-新 登记
**验证**：`npm run verify:docs` 绿

---

## P1 L1 + L2 契约扩展

**目标**：在基类层 + 玩法层 + L2 投影层同步加 4 个新字段/类型。

### 改动文件

| 文件 | 改动 |
|---|---|
| `src/core/kernel/actions/types.ts` | 新增 `export type ActionTrack = 'highlight' \| 'card'`；`ActionDef` 加 `track: ActionTrack`（必填）+ `cardPresentation?: Id`（可选） |
| `src/core/kernel/actions/card-presentation.ts`（新） | 新建 `CardPresentationDef` 接口（kind: 'card-presentation' / icon / colorTheme / effectText / interactionMode），并加入 `Def` 联合（state/def.ts） |
| `src/core/kernel/state/def.ts` | `DefKind` 联合加 `'card-presentation'` 字面量 |
| `src/l2/model/family-contracts.ts` | `ActionContract` 加 `track?: ActionTrack` + `cardPresentation?: ResolvedCardPresentation`（与 L1 镜像） |
| `src/l2/model/projection.ts` | `ActionDescriptor` 加 `track: ActionTrack` + `cardPresentation?: ResolvedCardPresentation`（透传 L1） |
| `src/l2/model/projection.ts` | 新增 `ResolvedCardPresentation` 接口（icon / colorTheme / effectText string / interactionMode） |
| `src/ui/model/view.ts` | `UiActionView` 加 `track: ActionTrack` + `cardPresentation?: UiCardPresentation` |
| `src/ui/model/view.ts` | 新增 `UiCardPresentation` 接口（iconRef / colorTheme / effectText / interactionMode） |

### 严格遵守 ECS 规范

- `CardPresentationDef` 是个 **Def**（不是 Entity/Component），存于 `defRegistry`，按 `kind === 'card-presentation'` 过滤
- 卡片本身**不是 ECS 实例**（B 方案），是 Value Object
- `cardPresentation?: Id` 字段是 `Id` 引用，**不**是嵌套对象——保持 Def 之间的解耦

### ColorTheme 闭合枚举（决策草案）

```ts
export const ACTION_CARD_COLOR_THEMES = [
  'neutral',   // 中性
  'aggressive',// 攻击
  'defensive', // 防御
  'utility',   // 工具
  'mystical',  // 神秘/魔法
] as const;
export type ActionCardColorTheme = (typeof ACTION_CARD_COLOR_THEMES)[number];
```

放在 `src/l2/model/family-contracts.ts`（与 `ACTION_COST_CATEGORIES` 同源）。

### interactionMode 默认推导

| interactionIntent | 推导 interactionMode |
|---|---|
| `traversal` | `instant` |
| `precise-interaction` | `toggle` |
| `hostile-interaction` / `executable-target` | `target` |

`CardPresentationDef.interactionMode` 可缺省，缺省时按 `interactionIntent` 推导。

**验证**：`npx tsc --noEmit` 绿 + 新增 1 个 `track-default-mode.test.ts`（覆盖推导逻辑）
**测试**：`track` 字段必填校验测试（`validateActionDescriptor` 拒缺 `track` 的 ActionDescriptor）

---

## P2 投影与校验链落地

**目标**：让新字段从 L1 经 L2 投影到 L2/UI 描述符，全程被校验。

### 改动文件

| 文件 | 改动 |
|---|---|
| `src/l2/adapters/ui-adapter.ts` | `actionDescriptor` 函数（L67-101）逐字段赋值加 2 行：`track` + `cardPresentation`；`effectText` 求值用 `exprEngine.eval`（参考 `ui-adapter.ts` 现有 `label` 字段的求值模式） |
| `src/ui/presentation/descriptor-validator.ts` | `validateActionDescriptor` 函数加 2 个新分支：`track`（闭合域校验）+ `cardPresentation`（嵌套对象校验，参照 `validateTargetDescriptor` 模式） |
| `src/l2/model/family-contracts.ts` | 新增 `validateCardPresentation` 纯函数（L2 装配链，校验 Def 形状） |

### 严格顺序

1. `family-contracts.ts` 加 `validateCardPresentation`（先有校验）
2. `ui-adapter.ts` 加 `cardPresentation` 字段赋值
3. `descriptor-validator.ts` 加白名单 + 嵌套校验

### effectText 求值路径

参考 `src/l2/adapters/ui-adapter.ts` 现有 `accessibleLabel` 求值模式（应该已经存在 `exprEngine.eval(action.label, ctx)` 之类），把 `CardPresentationDef.effectText` 用同样 ctx 求值。

如果 `exprEngine.eval` 返回 `Value` 而非 `string`，需要 `String(value)` 强转（参考 `reason` 字段 L83-85 模式）。

**验证**：
- `npx tsc --noEmit` 绿
- `descriptor-validator.test.ts` 新增 3 个用例（缺 `track` / 闭合域错 / cardPresentation 嵌套错）
- `ui-adapter.test.ts` 新增 1 个用例（end-to-end 投影含 `cardPresentation`）

---

## P3 玩法层数据填充

**目标**：给所有 ActionDef 补 `track` 字段 + `cardPresentation` 引用。

### 改动文件

| 文件 | 改动 |
|---|---|
| `src/play/core-mechanics/defs/actions.paid.ts` | 全部 ActionDef 加 `track` 字段（攻击类 → `card` / 移动类 → `highlight`）；按需加 `cardPresentation` 引用 |
| `src/play/core-mechanics/defs/actions.attached.ts` | 全部 ActionDef 加 `track: 'card'`（attached 默认卡片） |
| `src/play/core-mechanics/defs/playpack.ts` | 如果含直接定义的 ActionDef 同步补 |

### 决策映射（草案）

| Action 类型 | track | cardPresentation | interactionMode |
|---|---|---|---|
| `move` | `highlight` | 不需要（地图高亮） | `instant` |
| `attack-melee` | `card` | `card.attack.melee` | `target` |
| `attack-ranged` | `card` | `card.attack.ranged` | `target` |
| `reload` | `card` | `card.action.reload` | `instant` |
| `parry` | `card` | `card.action.parry` | `toggle` |
| `use-item` | `card` | `card.action.use-item` | `target` |
| `pickup` | `highlight` | 不需要 | `instant` |

### CardPresentationDef 注册

新建 `src/play/core-mechanics/defs/card-presentations.ts`，注册所有 CardPresentationDef（图标路径从 sprite-forge 语义库查，查不到走 lucide-react）。

**验证**：
- `npx vitest run src/play` 绿
- 新增 `playpack-track-coverage.test.ts`：断言所有 ActionDef 都有 `track` 字段（无遗漏）
- `asset:validate` 绿（所有 `icon` 路径都注册过）

---

## P4 前端 BattleHud 数据层重写

**目标**：把 V0 偷师前端的 BattleHud 数据层从 mock 切换到 L2 真实投影。

### 改动文件

| 文件 | 改动 |
|---|---|
| `src/devboard/game-ui-shell-15/lib/battle-hud-data.ts`（新） | 新建 BattleHud 数据层：拉 `useUiView()` → 按 `track` 切 `highlightPool` / `cardPool` → 喂给 BattleHud 组件 |
| `src/devboard/game-ui-shell-15/components/battle-hud.tsx` | 删 `actionCards: ActionCard[]` 模块顶部 const（约 L104-117）；删 `railUnits: RailUnit[]` 模块顶部 const（约 L79-87）；删 `AVAILABLE_AP = 4` 模块顶部 const；改用 props 接收 `useUiView()` 数据 |
| `src/devboard/game-ui-shell-15/lib/b1-contract.ts` | 删 12 个 `battle.*` intent 的 mock 实现，替换为 `createSubmitFlow().activate()` 调用 |
| `src/devboard/game-ui-shell-15/lib/shell-adapters.ts` | `mockAssetAdapter` 保留（前端仍需 mock 资产）；`mockTransportAdapter` 替换为 `ActionPort.submit` |

### 严格遵守契约

- 不再 `setTimeout(accepted)`，**必须走 `submittedRevision` 等待**
- `cost: number` → `costCategory: 'paid' | 'attached'`
- `source: 'free' | 'paid'` → `costCategory: 'attached' | 'paid'`
- `target: 'none' | 'hostile' | 'ally'` → `interactionIntent` 4 值
- 提交必须包含 `observedRevision` / `agentId` / `inputSource`

### 复用项

- fan geometry、hover 曲线（`handLiftPx` + `handRotateMul`）、cast-flight、ghost-card 动画**全部保留**
- 仅数据来源和提交路径重写

**验证**：
- `npx tsc --noEmit` 绿
- `npx vitest run src/devboard/game-ui-shell-15` 全绿
- 手动 devboard 启动：进入 `session.hud` → 看到真实动作列表、点击触发 `committedRevision` 路径

---

## P5 发牌器 + 0费/1费切页

**目标**：新增"发牌器"组件，实现重发动画 + 0费/1费切页。

### 新建文件

| 路径 | 职责 |
|---|---|
| `src/devboard/game-ui-shell-15/components/card-dealer.tsx` | 发牌器：订阅 `useUiView()` → diff 上一次与当前 `cardPool` → 算插入/退出 → Framer Motion `AnimatePresence` 播放 |
| `src/devboard/game-ui-shell-15/hooks/use-card-pool-diff.ts`（新） | 算 cardPool 差集：哪些是新加入、哪些是退出、哪些保留 |
| `src/devboard/game-ui-shell-15/lib/card-animation-recipes.ts`（新） | 4 种动画 recipe：`deal-from-deck` / `discard-to-pile` / `reveal` / `swap-hand` |

### 改 `menu-faces.ts`

`src/ui/interaction/menu-faces.ts:34-49` 已有 `paid` / `zeroCost` 切面，加：
- 0费卡恒显示（`zeroCostAlwaysAvailable: true as const` 已锁）
- 切页用 Framer Motion 滑动动画
- 切页触发条件：点击 0费/1费切换按钮

### 渲染决策

- 卡牌按 `costCategory` 分两组（paid / attached）
- 切换按钮：底部 tab 栏，两组上下排布
- 进入战斗：先 1费卡组展开（默认）
- 使用 0费物品：前端 diff 检测到 0费卡组变化 → 触发 `reveal` 动画（**不**触发整组重发）

**验证**：
- `npx vitest run src/devboard/game-ui-shell-15/components/card-dealer.test.tsx` 绿
- 手动测试：进入战斗 → 切 0费/1费 → 用物品 → 看到重发但不眩晕

---

## P6 高亮轨地图交互

**目标**：实现"鼠标高亮交互"——地图上可直接点的实体高亮。

### 改 `bh-world` 组件

`src/devboard/game-ui-shell-15/components/battle-hud.tsx:551-628` `bh-world`：
- 当前位置硬编码 `railUnits`，改为 `useUiView().entities`
- `is-target-candidate` 判定改为**消费后端的合法目标集合**（不再 `unit.faction !== 'player'` 本地判定）
- 位置信息从 L2 的 `locationNodeId` → 通过地图数据查 `node.position` 映射

### 改 token 渲染

每个 token 组件接收：
- `executable: boolean`（来自 UiTargetView）
- `interactionMode: 'instant' | 'toggle' | 'target'`（来自 cardPresentation.interactionMode）
- 高亮颜色按 mode 区分（绿=可点 / 黄=可切换 / 红=可目标）

### 新建地图节点查询

`src/devboard/game-ui-shell-15/lib/entity-position-resolver.ts`（新）：
- 输入：`locationNodeId` + 地图数据
- 输出：屏幕坐标 `{x, y}`（百分比）
- 缓存：避免每帧重算

**验证**：
- 手动 devboard 启动：进入 `session.hud` → 看到地图上 token 按 `track: 'highlight'` 的 ActionDef 可点
- 点击 token 触发 `interactionMode: 'target'` 的高亮 → 进入 `bh-targeting-hint` 模式

---

## P7 集成测试 + 端到端 demo

**目标**：从载入玩包到战斗回合结束全链路跑通。

### 测试矩阵

| 场景 | 期望 |
|---|---|
| 玩家空手 | 0费卡组 = 空；1费卡组 = 移动（不出现，因 track=highlight）；高亮轨 = 地图上可移动格子高亮 |
| 玩家捡起手枪 | 0费卡组 = 出现"快拔"；1费卡组 = 出现"瞄准/装弹"；高亮轨 = 地图上可射击目标高亮 |
| 玩家射击 | 0费/1费切组；高亮轨根据目标筛选更新；提交走 `committedRevision` 等待；AP 扣减 |
| 玩家过载 | 所有付费动作灰显（`available: false` + `unavailabilityReason`） |
| 玩家被缴械 | 持枪相关卡组消失（`require` 不满足 → 不显示） |

### 端到端测试

新建 `src/devboard/__tests__/dual-track-e2e.test.tsx`：
- 渲染完整 BattleHud
- 模拟 4 个状态切换（空手 / 持枪 / 射击中 / 被缴械）
- 断言每个状态下的 `highlightPool` / `cardPool` 数量与卡片内容

### 演示路径

1. `npm run dev:board` 启动 devboard
2. 进入 `boot.menu` → `residence` → `match.engagement` → `session.hud`
3. 在 HUD 中：空手 → 拾取手枪 → 看到卡片池变化 → 切换 0费/1费 → 射击敌人 → 看到高亮轨正确触发
4. 验证 `committedRevision` 等待：UI 在 submit 成功后不立即更新，必须等到新 UiView 到达

**门禁三命令**（与现有开发纪律一致）：
- `npx tsc --noEmit`
- `npx vitest run`（含 P7 新增 e2e）
- `npm run lint`

---

## 阶段并行规划

**P1 / P2 强顺序**（必须串行）

**P3 / P4 可以并行**（互不踩）：
- P3 改 `play/core-mechanics/`，P4 改 `devboard/game-ui-shell-15/`
- 并行锁：P4 不动 `play/`，P3 不动 `devboard/`

**P5 / P6 可以并行**：
- P5 改 `card-dealer` + `menu-faces`
- P6 改 `bh-world` + `entity-position-resolver`
- 并行锁：双方都不动 `ui/model/view.ts`（已固化）

**P7 等待 P4-P6 全完**

---

## 风险登记表

| 风险 | 等级 | 缓解 |
|---|---|---|
| `descriptor-validator.ts` 加白名单漏字段导致整条 ActionDescriptor 拒 | 高 | 加 P2 单元测试覆盖每个新字段 |
| 玩法层 ActionDef 漏 `track` 字段导致运行时报错 | 高 | P3 加 `playpack-track-coverage.test.ts` |
| V0 BattleHud 数据层重写破坏动画/几何 | 中 | fan/hover/cast-flight 纯函数抽出独立模块 |
| `committedRevision` 等待与现有 mock `setTimeout(accepted)` 冲突 | 中 | P4 改 mockTransportAdapter 直接转发到 ActionPort |
| 发牌动画在大状态切换时闪屏 | 中 | P5 用 `AnimatePresence` 配 stagger delay |
| 高亮轨位置查询性能（每帧重算） | 中 | P6 用 `useMemo` + 节点表 |

---

## 待 owner 拍板项

1. **P1 ColorTheme 闭合枚举值草案**（5 个：neutral/aggressive/defensive/utility/mystical）——需要 owner 拍
2. **P1 interactionMode 缺省推导逻辑**——需要 owner 拍
3. **P3 ActionDef 的 track 映射**（move=highlight, attack-melee=card 等）——需要 owner 拍
4. **P5 重发动画的具体 recipe**（4 种：deal/discard/reveal/swap）——需要 owner 拍
5. **P7 端到端测试是否需要录屏回放**——需要 owner 拍
