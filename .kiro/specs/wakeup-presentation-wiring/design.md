# Design — `wakeup-presentation-wiring`（表现层接线专项）

## 概述

本设计把 `game-ui-shell-15` 定位为渲染交互层（V0 壳），把 `PresentationRuntime`、ORCA 引擎、城市地图数据与 UI 端口面的权威能力留在主仓稳定端口之后。接线层不重写 V0 视觉组件，不把规则写入 React store，也不让任何单一页面成为跨层事实源。

接线工程采用三条可验证边界：

1. **运输边界**：`realTransportAdapter` 只替换 `mockTransportAdapter` 的路由函数，不改变 `submitShellIntent` 的调用签名、返回值形状与 V0 壳 `useShellRouter` 的状态机。
2. **事件边界**：`PresentationGateway` 订阅 `after:*` 事件并桥接到 `PresentationRuntime.feed()`，只暴露 `SpatialProjection` 与 `RenderCommand` 给 V0 壳，不暴露 `OpRegistry` / `WorldStateHolder`。
3. **迭代边界**：每次 V0 迭代只允许 A/B/C/D 四类改动，任何越权改动必须登记，不得静默合入。

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│ game-ui-shell-15 / V0 壳（Next.js 16 + React 19）             │
│ 标题·驻地·HUD·暂停·结算·控制面板                                │
│ 只消费 SpatialProjection / RenderCommand / ShellTransportResult  │
├─────────────────────────────────────────────────────────────────┤
│ 接线层                                                          │
│ realTransportAdapter (mock/real/iter-V0 三模式路由)             │
│ ShellTransportState 扩展: disconnected, degraded               │
├────────────────────────┬────────────────────────────────────────┤
│ PresentationGateway    │  IntentMapper                          │
│ createEventBridge      │  intentId → InteractionIntent schema   │
│ subscribe(RenderCommand)│  unregistered → rejected              │
│ getProjection()        │  参数校验 + 玩家可见数值断言          │
├────────────────────────┴────────────────────────────────────────┤
│ UiSystemPorts (src/ui/index.ts)                                │
│ projection / events / actionQuery / revision / actions          │
│ pendingContracts / diagnostics                                 │
├─────────────────────────────────────────────────────────────────┤
│ PresentationRuntime (src/ui/presentation/spatial/...)          │
│ SpatialEntityStore / ClusterStore / CollisionRegistry          │
│ MoveChoreographer / OrcaEngine / RenderCommandExecutor         │
├─────────────────────────────────────────────────────────────────┤
│ createLoadedMatch + createMatchShell + createUiHostPorts        │
│ driveMatch / after:* 事件流 / MapData                           │
├─────────────────────────────────────────────────────────────────┤
│ CoreMechanicsFacade → OpRegistry.invoke → after:*               │
│ src/play/loading-runtime/ / src/play/core-mechanics/           │
└─────────────────────────────────────────────────────────────────┘
```

### 接线开关设计

```
                        submitShellIntent(request)
                                    │
                          wiring mode 检查
                         /          |          \
                    mock          real       iter-V0
                      │            │            │
              mockTransport     realTransport  混合路由
              Adapter.request   Adapter.request
                      │            │            │
              强制注入仍可用    走 UiSystem     走 UiSystem
              (控制面板)        + degraded       + degraded
                              800ms 超时检测   + mock 强制注入
```

**URL 参数驱动**：`?wiring=mock|real|iter-V0`，默认 `mock`。`NODE_ENV === 'production'` 时强制 `real`。

**控制面板显示**：
- 左上角接线状态徽章：`[MOCK]` / `[REAL]` / `[ITER-V0]`
- `wiring=real` 时新增：`[DEGRADED 强制]` / `[DISCONNECTED 强制]` / `[REJECTED 强制]` 按钮
- 当前 revision 计数器（每 500ms 刷新）

### realTransportAdapter 内部设计

```ts
// src/devboard/game-ui-shell-15/lib/real-transport-adapter.ts

export interface RealTransportAdapterDeps {
  readonly uiSystem: UiSystem;          // from src/ui/index.ts createUiSystem()
  readonly presentationGateway: PresentationGateway; // from src/play/loading-runtime/presentation-gateway.ts
  readonly forcedOutcome?: Exclude<ShellTransportState, 'pending'>;
  readonly getWiringMode: () => WiringMode;
}

export const realTransportAdapter: ShellTransportAdapter = {
  async request(shellRequest: ShellRequest) {
    const wiring = deps.getWiringMode()
    if (wiring === 'mock') return mockTransportAdapter.request(shellRequest)

    // 1. 映射 ShellIntentRequest → InteractionIntent
    const intent = INTENT_MAP[shellRequest.intentId]
    if (!intent) {
      return makeResult(shellRequest, 'rejected', 'INTENT_NOT_REGISTERED',
        `intentId ${shellRequest.intentId} not in intent map`)
    }

    // 2. 参数校验 + 玩家可见数值断言
    const validated = intent.validate(shellRequest.parameters)
    if (validated.kind === 'err') {
      return makeResult(shellRequest, 'rejected', validated.code, validated.message)
    }

    // 3. 提交到 UiSystem
    const submitResult = deps.uiSystem.interaction.sendIntent({
      ...validated.value,
      requestId: shellRequest.requestId,
      safeReturn: shellRequest.safeReturnTarget,
    })

    // 4. 翻译 SubmissionOutcome → ShellTransportState
    const state = outcomeToState(submitResult.outcome)

    // 5. accepted 后等待投影刷新（800ms）
    if (state === 'accepted') {
      const refreshed = await waitForRevisionBump(
        deps.presentationGateway,
        shellRequest.requestId,
        800,
      )
      if (!refreshed) {
        return makeResult(shellRequest, 'degraded',
          'PROJECTION_NOT_REFRESHED',
          'accepted but projection not updated within 800ms')
      }
    }

    return makeResult(shellRequest, state,
      state === 'accepted' ? undefined : `REAL_${state.toUpperCase()}`)
  },

  cancel(requestId) {
    deps.uiSystem.pendingContracts.cancel(requestId)
  },
}
```

### IntentMapper 设计

```ts
// intent-map.ts（realTransportAdapter 内部静态数据）

export const INTENT_MAP: Record<string, IntentConstructor> = {
  'residence.match.start': {
    schema: z.object({ anchorSlot: z.string() }),
    toInteraction: (params, req) => ({
      intentId: 'match.start',
      actorRef: { kind: 'player', id: req.source },
      target: params.anchorSlot,
      parameters: { anchorSlot: params.anchorSlot },
    }),
  },
  'move.place': {
    schema: z.object({
      targetNodeId: z.string(),
      entityId: z.string(),
      pathCost: z.number().int().min(1).max(5),
    }),
    toInteraction: (params, req) => ({
      intentId: 'entity.move',
      actorRef: { kind: 'player', id: req.source },
      target: params.targetNodeId,
      parameters: { entityId: params.entityId, pathCost: params.pathCost },
    }),
  },
  'bed.front.ready': {
    schema: z.object({ bedId: z.string() }),
    toInteraction: (params, req) => ({
      intentId: 'bed.ready',
      actorRef: { kind: 'player', id: req.source },
      target: params.bedId,
      parameters: {},
    }),
  },
  // ... 覆盖 V0 壳 JOURNEY_EDGES 中所有 intentId
}
```

### PresentationGateway 装配设计

```ts
// src/play/loading-runtime/presentation-gateway.ts

export interface PresentationGatewayDeps {
  readonly matchShell: MatchShell;        // from createMatchShell
  readonly mapData: MapData;             // from createLoadedMatch
  readonly profile: PresentationProfile; // from config
}

export function createPresentationGateway(deps: PresentationGatewayDeps): PresentationGateway {
  // 1. 创建 PresentationRuntime，传入 mapData
  const runtime = createPresentationRuntime({
    mapData: deps.mapData,
    eventBus: deps.matchShell.eventBus,
  })

  // 2. 订阅 matchShell 事件流
  const unsubscribers: Array<() => void> = []
  const afterEvents = ['entity.place', 'rule-settled', 'entity.removed',
                        'micro-scene-occupants-changed', 'micro-scene-created',
                        'micro-scene-destroyed'] as const

  for (const eventType of afterEvents) {
    unsubscribers.push(
      deps.matchShell.eventBus.subscribe(eventType, (event) => {
        runtime.feed(event)
      })
    )
  }

  // 3. RenderCommand 订阅
  let commandRevision = 0
  runtime.subscribeCommand((cmd: RenderCommand) => {
    commandRevision++
    listeners.notify({ ...cmd, sourceRevision: runtime.revision })
  })

  return {
    getProjection(): SpatialProjection {
      return runtime.getSnapshot()
    },

    subscribe(handler: (cmd: RenderCommand) => void): () => void {
      return listeners.add(handler)
    },

    dispose() {
      runtime.dispose()
      unsubscribers.forEach((u) => u())
      listeners.clear()
    },
  }
}
```

### 接线模式与 V0 壳控制面板集成

V0 壳 `app/page.tsx` 的控制面板增加接线状态区块：

```tsx
// src/devboard/game-ui-shell-15/app/page.tsx（接线区块注入点）

function WiringStatusBadge({ mode }: { mode: WiringMode }) {
  const colors = { mock: 'bg-gray-600', real: 'bg-green-600', 'iter-V0': 'bg-blue-600' }
  const labels = { mock: 'MOCK', real: 'REAL', 'iter-V0': 'ITER-V0' }
  return (
    <span className={`${colors[mode]} text-white px-2 py-1 rounded text-xs font-bold`}>
      [{labels[mode]}]
    </span>
  )
}
```

控制面板中：
- 接线模式选择器（mock / real / iter-V0，仅 dev 可见）
- `wiring=real` 时显示：`[DEGRADED 强制]` / `[DISCONNECTED 强制]` / `[REJECTED 强制]` / `[STALE 强制]` / `[TIMEOUT 强制]` / `[CANCELLED 强制]`
- revision 计数器（每 500ms fetch）
- 当前 `SpatialProjection` revision 值（只读）

### 三命令门禁设计

```
验收门禁（任何 PR 合入前必须全部绿灯）:

  1. npm run typecheck:shell   ← V0 壳子项目独立 typecheck
  2. npx tsc --noEmit         ← 主仓 typecheck（含 devboard，不含 game-ui-shell-15/*）
  3. npx vitest run src/ui/presentation  ← 表现层单测（224 绿为 baseline）
  4. npx vitest run src/devboard/wiring/presentation-wiring  ← 新增接线层单测
  5. npm run typecheck:shell && npx vitest run --reporter=verbose  ← 联合门禁脚本

  仅阶段 B+ 触发：
  6. npm run verify:data       ← city-v1.json schema 校验
  7. npm run lint              ← eslint 全量
  8. npm run verify:docs       ← 文档一致性校验
  9. npm run verify:prompt-pack ← V0 壳 Prompt Pack 完整性
```

## 设计决策

### D-W1：接线开关用 URL 参数而非环境变量

- URL 参数（`?wiring=real`）允许在同一浏览器标签页内切换，不需要重启 dev server
- `NODE_ENV=production` 时强制 `real` 作为安全网
- 与 V0 壳现有的 `?demo=...` 参数体系一致

### D-W2：realTransportAdapter 不持有 CoreMechanicsFacade

- 只通过 `UiSystem.interaction.sendIntent()` 提交
- 好处：不需要修改 `realTransportAdapter` 就能接入 `CoreMechanicsFacade` 的新能力
- 坏处：多一层间接；交接报告记录此取舍

### D-W3：degraded 使用 800ms 固定阈值

- 不使用 `PresentationRuntime` 内部状态判断（避免循环依赖）
- 800ms 是经验值，可在 V0 迭代期用控制面板"超时注入"实测调整
- 调整时只需改 `real-transport-adapter.ts` 常量，不影响 V0 壳或 `PresentationRuntime`

### D-W4：PresentationGateway 不持有 MapData 真理

- `MapData` 由整合层 `createLoadedMatch` 单点传入
- 好处：同一 `MapData` 同时驱动玩法层（边/节点拓扑）与表现层（ORCA 可达域）
- 坏处：若 `MapData` 被修改，需重新创建 `PresentationGateway`；已通过 `dispose()` idempotent 设计缓解

### D-W5：city-v1.json 使用 office-v1.json 同 schema

- `office-v1.json` 已有 `schemaVersion: "2.0"` baseline
- `city-v1` 直接扩展节点数、边数与 micro-scene 数，不引入新 schema 字段
- 若 `MapData` schema 本身有 breaking change，登记为 `wakeup-loading-runtime` 后续 Spec 范围

## 与相邻 Spec 的边界处理

### 与 `wakeup-presentation-layer`（S1）的边界

- `PresentationRuntime` 是已有落地代码（161 行 ORCA + 224 测全绿）
- 本 Spec 的 `PresentationGateway` 只组合它，不改它的内部实现
- 若需要修改 `PresentationRuntime` 行为（例如 ORCA 参数可配置），走 `wakeup-presentation-layer` 后续 Spec 立项

### 与 `wakeup-full-body-wiring`（S9）的边界

- 本 Spec 专注"表现层 + V0 壳接线"
- `wakeup-full-body-wiring` 专注"元状态 / 电脑 UI / 编辑创作接线"
- 两者共享 `UiSystemPorts`，但入口不同：`realTransportAdapter` 走本 Spec，`ComputerWiringAdapter` / `MetaStateShellBinding` 走 `wakeup-full-body-wiring`
- 若出现冲突（例如同一 intentId 被两边注册），由 owner 裁决归属，不得静默覆盖

### 与 `wakeup-loading-runtime`（S2）的边界

- `PresentationGateway` 依赖 `createMatchShell` 暴露的 `eventBus`
- 若 `createMatchShell` 不暴露 `eventBus`（当前未暴露），本 Spec 阶段 A 需要补充该端口
- 补充端口视为本 Spec 对 `wakeup-loading-runtime` 的**非破坏性扩展**，不修改其既有契约

## 组件和接口

### 1. WiringModeSelector

位置：`src/devboard/game-ui-shell-15/components/wiring-mode-selector.tsx`（新增）

```ts
interface WiringModeSelectorProps {
  current: WiringMode
  onChange: (mode: WiringMode) => void
}
```

- 仅 `NODE_ENV !== 'production'` 时渲染
- 三选一：Mock / Real / Iter-V0
- 切换时调用 `wiringModeRef.current = mode`，不触发页面刷新

### 2. RevisionCounter

位置：`src/devboard/game-ui-shell-15/components/revision-counter.tsx`（新增）

```ts
interface RevisionCounterProps {
  presentationGateway: PresentationGateway // 由 createPresentationGateway 返回
}
```

- 每 500ms 调用一次 `presentationGateway.getProjection().revision`
- 显示：`Revision: ${revision}`（当前值）/ `Revision: --`（未连接）

### 3. ForcedOutcomePanel

位置：`src/devboard/game-ui-shell-15/components/forced-outcome-panel.tsx`（新增）

```ts
interface ForcedOutcomePanelProps {
  mode: WiringMode
  realTransport: RealTransportAdapter
}
```

- `wiring=mock` 时：渲染 V0 壳既有 `setForcedIntentOutcome` / `setForcedTransportState` / `setForcedAssetOutcome`
- `wiring=real` 时：渲染 `setForcedOutcome(forcedOutcome)` 强制 `realTransportAdapter` 走指定结果
- 五按钮：`REJECTED` / `STALE` / `TIMEOUT` / `CANCELLED` / `DISCONNECTED`

### 4. realTransportAdapter

位置：`src/devboard/game-ui-shell-15/lib/real-transport-adapter.ts`（新增）

```ts
interface RealTransportAdapterDeps {
  uiSystem: UiSystem
  presentationGateway: PresentationGateway
  forcedOutcome?: Exclude<ShellTransportState, 'pending'>
  getWiringMode: () => WiringMode
}
export function createRealTransportAdapter(deps: RealTransportAdapterDeps): ShellTransportAdapter
```

### 5. IntentMapper

位置：`src/devboard/game-ui-shell-15/lib/intent-mapper.ts`（新增）

```ts
interface IntentConstructor {
  schema: z.ZodType
  toInteraction: (
    params: unknown,
    request: ShellRequest,
  ) => InteractionIntent
}
export const INTENT_MAP: Readonly<Record<string, IntentConstructor>>
```

### 6. PresentationGateway

位置：`src/play/loading-runtime/presentation-gateway.ts`（新增）

```ts
export interface PresentationGatewayDeps {
  matchShell: MatchShell
  mapData: MapData
  profile: PresentationProfile
}

export function createPresentationGateway(deps: PresentationGatewayDeps): PresentationGateway
export interface PresentationGateway {
  getProjection(): SpatialProjection
  subscribe(handler: (cmd: RenderCommand) => void): () => void
  dispose(): void
}
```

### 7. city-v1.json

位置：`run/v0-assets/maps/city-v1.json`（新增）

- schemaVersion: "2.0"（与 office-v1.json 一致）
- 节点数 >= 12
- micro-scenes >= 3
- 床位 >= 1
- 驻地区域 >= 1
- 边数 >= 14
- 每条边必须有 `traversable: true` 供 ORCA 初始化

### 8. 接线层单元测试

位置：`src/devboard/wiring/presentation-wiring/__tests__/`（新增）

```
__tests__/
  real-transport-adapter.test.ts   ← 6 个测试
  presentation-gateway.test.ts      ← 5 个测试
  intent-mapper.test.ts            ← 覆盖所有注册 intentId
  city-v1-schema.test.ts           ← 1 个 schema 校验测试
  wiring-mode.test.ts              ← 切换模式不改变页面状态
  integration/property-tests.ts    ← 失败态闭包属性测试（3 个属性）
```

### 9. 联合验收脚本

位置：`scripts/wire-presentation-gate.sh`（新增，可选）

```bash
#!/bin/bash
set -e
npm run typecheck:shell
npx tsc --noEmit
npx vitest run src/ui/presentation
npx vitest run src/devboard/wiring/presentation-wiring
npm run lint
echo "ALL GATES PASSED"
```
