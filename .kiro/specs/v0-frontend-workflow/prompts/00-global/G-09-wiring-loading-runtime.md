# G-09 — Wiring Mode + Loading Runtime Integration Contract

> **性质**：V0 迭代全局上下文扩展（2026-08-25）
> **范围**：不影响 G-01~G-08；补充 wiring mode 路由决策与 loading-runtime 接入合同

---

## 1. Wiring Mode 架构

V0 壳有 3 种接线模式，通过 `?wiring=` URL 参数或 `NODE_ENV=production` 切换：

| Mode | 触发条件 | ShellTransportAdapter | submitShellIntent |
|------|----------|-----------------------|-------------------|
| `mock` | 默认 / `?wiring=mock` | `mockTransportAdapter` | Mock forced-outcome 模拟 |
| `iter-V0` | `?wiring=iter-V0` | 待实现 | 待实现 |
| `real` | `?wiring=real` / production | `realTransportAdapter` | `submitRealIntent()` → `uiSystem.interaction.sendIntent()` |

**核心文件**：
- `src/devboard/game-ui-shell-15/lib/wiring-mode.ts` — wiring mode 全局状态机
- `src/devboard/game-ui-shell-15/lib/real-intent-bridge.ts` — ShellIntentRequest → InteractionIntent 翻译桥
- `src/devboard/game-ui-shell-15/lib/shell-route.ts` — adapter registry + `getActiveRouterAdapter()`
- `src/devboard/game-ui-shell-15/lib/shell-intent.ts` — `registerRealSubmitIntent()` 注册点
- `src/devboard/game-ui-shell-15/components/product-shell.tsx` — wiring mode boot `installWiringMode()`

**WiringMode badge** 在控制面板显示：Mock（灰）/ Iter-V0（橙）/ Real（绿）。

---

## 2. Real Intent Bridge 翻译合同

`real-intent-bridge.ts` 将 V0 壳的 `ShellIntentRequest` 翻译为 `InteractionIntent`：

```
ShellIntentRequest.intentId   → InteractionIntent.intentId
ShellIntentRequest.parameters  → InteractionIntent.bindings  (string | number | boolean)
ShellIntentRequest.revision    → InteractionIntent.observedRevision  (StateRevision)
```

**注册时机**：`product-shell.tsx` 的 `useEffect(() => { installWiringMode(mode, ui, ...) })`
**依赖注入**：`uiSystem: UiSystem` 来自 `UiBackendProvider`（即 `bootUiBackend()` 返回值）

**支持的 intentId 集合**（`SUPPORTED_INTENT_IDS`，需与 `JOURNEY_EDGES` intentId 保持同步）：

```typescript
new Set([
  'boot.enter-title',
  'menu.new-game', 'menu.continue',
  'residence.match.start', 'residence.match.cancel', 'residence.match.accept',
  'residence.bed.confirm-ready',
  'session.enter-dream', 'session.hud.attach',
  'session.abandon-to-title', 'session.settle', 'session.return-home',
  'residence.restore-position', 'residence.exit',
])
```

**5 类强制失败**：`rejected` / `stale` / `timeout` / `cancelled` / `degraded`

---

## 3. ShellTransportState 扩展

`degraded` 状态加入 V0 壳状态机：

```typescript
export type ShellTransportState = 'idle' | 'pending' | 'accepted' | 'rejected' | 'stale' | 'timeout' | 'cancelled' | 'degraded'
```

`degraded` 语义：请求被宿主接受，但表现层未在 **800ms** 内刷新投影。

---

## 4. Loading Runtime 接入点

V0 壳通过 `bootUiBackend()` 启动对局，流程：

```
ProductShell 挂载
  → UiBackendProvider.mount()
    → bootUiBackend()
      → createUiSystem()              // InteractionPort + ProjectionPort + PendingContracts
      → loadCanonicalGameJson(...)     // 官方/UGC JSON 统一装载
      → SpatialEntityStore.setNodeMap() // 地图节点
      → PresentationRuntime 初始化    // 依赖 fedDeck.piles.spatial.map
      → 返回 UiSystem
```

**关键约束**：
- `bootUiBackend()` 失败时回退到 **mock 对局**（`createMockUiSystem()`）
- `PresentationRuntime` 依赖 `SpatialEntityStore`（地图节点数据）
- `city-v1` 地图加载需要 `run/v0-assets/maps/city-v1.json`

---

## 5. 尚未完全接通的缺口（H-G-21 范围）

| 缺口 | 位置 | 阻塞状态 |
|------|------|----------|
| `mountSurface` 加载 `city-v1` | `map.tsx` | map.tsx 占位未实现 |
| `PresentationRuntime` fedDeck 注入 | `bootUiBackend` | SpatialEntityStore 未注入 fedDeck.piles.spatial.map |
| `realTransportAdapter` adapter 注册 | `product-shell` | shell-route adapter 未通过 wiring-mode 注册 |
| `usePresentation` hook | V0 壳 lib | 未实现 |

这些缺口**不阻塞**本次 V0 迭代上传（wiring mode Mock 模式可完整验证 UI shell），后续迭代逐步接入。

---

## 6. 验证命令

```bash
# V0 壳 typecheck
npm run typecheck:shell

# 接线条 + 表现层 vitest
npx vitest run src/devboard/wiring/presentation-wiring src/ui/presentation

# 浏览器访问
# Mock 模式：http://localhost:3000/v0-shell
# Real 模式：http://localhost:3000/v0-shell?wiring=real
```
