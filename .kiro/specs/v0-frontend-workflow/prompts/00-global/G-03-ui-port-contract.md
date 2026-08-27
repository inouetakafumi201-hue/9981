# G-03 UI Port 前端抽象契约

## 1 页面定位

给没有后端上下文的 AI 一份稳定的前端接线抽象。AI 只实现 props、mock adapter 和 intent callback，不实现规则引擎。

## 2 权威来源（只写 attachmentId / provenance）

- `pt09-ui-projection` / `docs/并行作战/PT-09_执行完成总结.md`：StatePort、ActionPort、CadencePort 和写入隔离。
- `frontend-shell-plan` / `docs/工程治理/10_V0前端壳层生产与接线规划.md`：mock→真实端口替换。
- `frontend-workflow-design` / `.kiro/specs/v0-frontend-workflow/design.md`：页面和控制面板边界。

## 3 当前决策

UI 只读 `StatePort`，通过 `ActionPort` 发 intent，通过 `CadencePort` 接收刷新节奏。AI 不需要知道真实类名、目录或实现。

## 4 状态机

`mock snapshot` / `projection snapshot` → `render`；intent → `pending` → `accepted | rejected | stale | timeout` → `render next snapshot`。UI 不把 pending 当 accepted。

## 5 组件树

`PortProvider` → `PageSurface` → `ProjectionView` + `IntentControls` + `FeedbackRegion`。

## 6 只读数据

```typescript
// 双轨制 P1 新增：binding 值支持 Ref（指向状态树中的实体/节点 ID）
type BindingValue = string | number | boolean | null | { readonly $: string } // Ref 引用

// 双轨制 P1 新增：动作轨道（决定 HUD 渲染容器）
type ActionTrack = 'highlight' | 'card'
// 'highlight'：地图实体点击触发，不消耗 AP，显示在地图 HUD 层
// 'card'：手牌动作，消耗 AP，显示在 BattleHud 卡片轨

// 双轨制 P1 新增：卡片表现元数据（来自 CardPresentationDef）
interface CardPresentation {
  readonly icon: string          // asset 路径，如 'icons/action/attack.svg'
  readonly colorTheme: 'neutral' | 'aggressive' | 'defensive' | 'utility' | 'mystical'
  readonly effectText: string    // 效果描述，如 '对目标造成伤害'
  readonly interactionMode: 'instant' | 'toggle' | 'target'
  readonly tags: readonly string[]
}

// 双轨制 P1：动作卡视图（来自 useRealActions 的 cardActions / highlightActions）
interface ActionView {
  readonly actionId: string
  readonly label: string
  readonly track: ActionTrack
  readonly costCategory: 'paid' | 'attached' | 'zero-cost'
  readonly cost: number          // AP 消耗（paid 轨）
  readonly cardPresentation: CardPresentation | null
  readonly requires: {
    readonly targets?: number     // 需要多少个目标
    readonly targetKind?: string // 目标类型描述
    readonly ref?: { $: string } // Ref 类型 binding（目标变量引用）
  }
  readonly disabled: boolean
  readonly disabledReason?: string
}

interface StateSnapshot {
  screen: string;
  phase: string;
  entities: readonly Record<string, unknown>[];
  resources: readonly Record<string, unknown>[];
  notices: readonly Record<string, unknown>[];
  source: 'mock' | 'projection';
  revision: number;
  // 双轨制 P1：动作视图（已按 track 分流）
  actionViews: readonly ActionView[];
}
interface IntentRequest {
  intentId: string;
  payload: Record<string, unknown>;
  requestId: string;
  // 双轨制 P1：binding 值透传（支持 Ref 引用）
  bindings?: Readonly<Record<string, BindingValue>>;
}
interface IntentResult {
  requestId: string;
  status: 'accepted' | 'rejected' | 'stale' | 'timeout';
  reason?: string;
  nextRevision?: number;
}
interface UiPorts {
  state: { getSnapshot(): StateSnapshot };
  action: { submit(request: IntentRequest): Promise<IntentResult> };
  cadence: { subscribe(listener: (snapshot: StateSnapshot) => void): () => void };
}
```

## 7 动作意图

示例：`navigate.page`、`menu.new-game`、`menu.continue`、`settings.preview`、`settings.save`、`pause.resume`、`battle.select-action`、`battle.select-target`、`dialog.choose`、`residence.match`。请求只描述意图和显式字段，不携带本地计算的 AP/伤害/路径结果。

## 8 本地 UI 状态

`pendingRequestId`、焦点、选择、展开、筛选和动画阶段可以本地保存；规则结果、资源扣除、目标有效性必须来自 snapshot/result。

## 9 视觉令牌

pending = 橙色进行中；rejected/error = 红色；stale = 灰白/黄色说明；accepted = 绿色/语义结果。所有文字同时显示状态原因。

## 10 动效绑定

提交意图先显示局部 pending；只有收到 accepted/投影更新后播放结果动画。rejected/stale/timeout 使用错误/回弹，不播放成功演出。

## 11 输入无障碍

按钮、菜单、拖拽和快捷键都调用同一 intent builder；手柄/键盘不走另一套逻辑。屏幕阅读器读出 pending、disabled 原因和 rejected 原因。

## 12 加载错误超时

端口未连接显示连接中；请求超时显示重试/取消；版本不兼容显示安全返回；不得静默回退成规则成功。

## 13 明确不做

不调用 `OpRegistry.invoke`，不直接写 store，不读后端路径，不实现规则判定、AI 决策或真实存档。

> **双轨制 P1 补充约束**：
> - 不在 IntentRequest 之外计算 binding 值（binding 的求值是 kernel 职责，UI 只透传 Ref）
> - 不在 IntentRequest 之外计算 AP 消耗（cost 是 Def 上的静态字段）
> - 不在 IntentRequest 之外判断 target 是否有效（kernel 会判罚）
> - 不把 `track: 'highlight'` 轨的动作渲染进 `card` 轨容器（HUD 层按 track 分流）

## 14 依赖交接

真实接线方只需实现 `UiPorts` 或等价 adapter；页面组件签名和 mock fixture 保持不变。

> **双轨制 P1 接线变化**：
> - `useRealActions` 现在返回 `cardActions: ActionView[]` 和 `highlightActions: ActionView[]` 两路
> - `IntentRequest.bindings` 支持 `{ $: string }` Ref 形式
> - `state.actionViews` 包含 `track` + `cardPresentation` 字段

## 15 验收条件

所有交互都有 requestId 和结果态；mock 可独立运行；切换到 projection 不改组件树；无本地规则推断；错误可见且可恢复。

> **双轨制 P1 补充验收**：
> - `cardActions` 不含 `track: 'highlight'` 的动作
> - `highlightActions` 不含 `track: 'card'` 的动作
> - `IntentRequest.bindings` 中的 Ref 透传到 kernel 判罚层