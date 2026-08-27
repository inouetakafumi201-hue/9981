# Presentation Layer Design

## Overview

The presentation layer sits between the integrated match runtime and the render layer. It owns spatial state, ORCA inputs, choreography, and a command face. It never reads gameplay micro-scene internals directly; instead it consumes a `MicroScenePresentationProjection` and `presentation:*` events emitted by the integration layer.

Layering (per `14_`):

```text
Ports (projection/actions/events)
  ↓
Choreography (Move / Attack / Standoff) + TurnHandoffGate
  ↓
Algorithms (traversable domain, A*, ORCA, contagion)
  ↓
Spatial (CollisionRegistry / ClusterStore / spatialStore / facingStore)
  ↓
Render layer (commands only)
```

## Data Model

### SpatialProjection

```ts
interface SpatialProjection {
  readonly revision: number
  readonly layers: LayerView[]
  readonly nodes: NodeView[]
  readonly edges: EdgeView[]
  readonly entities: EntityView[]
  readonly clusters: ClusterView[]
  readonly tiles: TileView[] // empty unless gameplay running
}
```

`SpatialProjection` is deep-frozen at commit time. A separate `pending` state wraps the projection when the runtime has not yet produced a committed snapshot.

### Cluster and GroundGlowFootprint

ClusterView (existing `spatial-view.ts`):

```ts
interface ClusterView {
  readonly id: string
  readonly center: Vec2
  readonly entityIds: readonly string[]
  readonly glowRadius: number
}
```

GroundGlowFootprint (new, presentation-only):

```ts
type GroundGlowVisibility = 'weak' | 'highlighted' | 'selected' | 'fading'

interface GroundGlowFootprint {
  readonly footprintId: string  // === microSceneId
  readonly center: Vec2
  readonly radiusX: number
  readonly radiusY: number
  readonly rotation: 0
  readonly occupantIds: readonly string[]
  readonly visibility: GroundGlowVisibility
  readonly interactive: boolean
  readonly revision: number
}
```

### CollisionRegistry

```ts
type Mobility = 'movable-character' | 'movable-entity' | 'immovable-character' | 'immovable-entity'

interface CollisionBox {
  readonly entityId: string
  readonly center: Vec2
  readonly radius: number          // equivalent circle radius for ORCA
  readonly mobility: Mobility
  readonly clusterId?: string
}
```

### RenderCommand

```ts
type RenderCommandTrigger = 'after-event' | 'projection' | 'local-input'

interface RenderCommand {
  readonly commandId: string
  readonly semanticId: string
  readonly sourceRevision: number
  readonly targetPageId?: string
  readonly trigger: RenderCommandTrigger
  readonly advancesJourney: false
  readonly payload: Readonly<Record<string, unknown>>
}

type RenderCommandOutcome =
  | 'accepted' | 'completed' | 'skipped' | 'degraded'
  | 'failed' | 'timeout' | 'cancelled' | 'stale'
```

## Component Responsibilities

### ClusterStore

- Source of truth: `presentation:micro-scene-*` events + `SpatialProjection.clusters`.
- Rules:
  - No Cluster with zero occupants.
  - `micro-scene-destroyed` is idempotent.
  - Last occupant leaves → emit destroyed snapshot + enter `fading` for 200–300ms.
  - Never invent Cluster from proximity.

### GroundGlowStore

- Derives ground footprints from active Clusters.
- Derives ORCA equivalent circle `max(radiusX, radiusY) * 0.5`.
- Hit-test is elliptical.
- Footprint removed from active set when Cluster is destroyed/fading.

### CollisionRegistry

- Single source of collision boxes for ORCA.
- Mobility updated via projection events, not inferred by render layer.
- Cleans up on `entity.removed`.

### EventBridge

- Subscribes to `presentation:*` and `after:entity.place` / `after:rule-settled`.
- Drops stale events older than current revision.
- Emits deep-frozen projection snapshot to render layer.

### MoveChoreographer

- Consumes `after:entity.place`.
- Waits for projection commit before animating.
- Non-blocking in single-player.

### TurnHandoffGate

- Multiplayer gate: waits for required animations, enforces 3000ms hard limit.
- On timeout: cancel pending animations, record diagnostic, force-release turn.

## Cross-Layer Contracts

- Presentation layer never owns gameplay micro-scene state.
- The only bridge signal is `presentation:immovable-relocatable` for immovable entity drift (no animation, no rule change).
- All gameplay facts arrive via projection or `after:*` events; render layer never predicts a fact not yet committed.

## Lifecycle

```text
init(projection)
→ commit(newProjection)    // atomic swap, deep freeze
→ handleEvent(event)       // micro-scene / after:events
→ renderCommand(cmd)       // executor
→ dispose()                // all resources, idempotent
```
