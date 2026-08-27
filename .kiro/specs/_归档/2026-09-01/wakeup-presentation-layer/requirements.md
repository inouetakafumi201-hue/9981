# Presentation Layer Lifecycle and Interaction Bridge

## Introduction

This spec implements the presentation layer that sits between the integrated match runtime and the render layer. It defines the lifecycle of spatial state, the bridge between gameplay micro-scenes and presentation clusters/ground-glow footprints, and the contract for render commands used by the render layer.

Authority: `docs/表现系统/15_表现层生命周期与交互桥设计.md`, `docs/表现系统/14_表现层架构设计.md`, `docs/表现系统/11_ORCA寻路与移动系统设计补全.md`.

The presentation layer never owns authoritative game state. It only consumes the match projection and event bus, and produces visual state plus render commands.

## Glossary

- **SpatialProjection**: deep-frozen read-only snapshot of layers, nodes, edges, entities, clusters, tiles, and revision.
- **ClusterView**: presentation-side aggregate of entities around a center. Distinct from gameplay micro-scene.
- **GroundGlowFootprint**: elliptical target on the ground representing a clickable micro-scene destination. Radius X > Radius Y, center at entity feet.
- **CollisionBox**: entity collision geometry registered with the CollisionRegistry.
- **CollisionRegistry**: presentation-side store of all collision boxes and their mobility.
- **RenderCommand**: request from choreography to render layer carrying semanticId, commandId, sourceRevision, and outcome enum.
- **MoveChoreographer**: converts `after:entity.place` into a rendered movement that respects the new projection first.
- **EventBridge**: thin consumer that subscribes to `presentation:*` and `after:*` events to drive stores.
- **ProjectionRevision**: monotonic counter used for stale detection on commands and projections.

## Requirements

### Requirement 1: Spatial Projection Lifecycle

**User story:** As the render layer, I want a stable projection snapshot with lifecycle, so I can render the current match state without leaking half-updated state.

#### Acceptance Criteria

1. THE SpatialProjection SHALL carry a monotonically increasing `revision` for stale detection.
2. THE SpatialProjection SHALL be deep-frozen before being returned to consumers.
3. THE SpatialProjection SHALL always include either an active state or a structured pending/revision error, never a partially frozen empty object.
4. WHEN a new projection is committed, THE previous projection SHALL be discarded atomically (no incremental half-replacement).
5. THE SpatialProjection SHALL not embed micro-scene internal topology fields; the bridge layer translates them to ClusterView.
6. THE SpatialProjection SHALL expose `tiles` precomputed for the ORCA traversable domain when running gameplay; otherwise it is empty.

### Requirement 2: Cluster Lifecycle

**User story:** As the presentation layer, I want a cluster that appears with at least one entity and disappears when the last entity leaves, so the ground glow never represents a phantom target.

#### Acceptance Criteria

1. THE ClusterStore SHALL only allow a Cluster to exist when `occupantIds.length >= 1`.
2. WHEN a `presentation:micro-scene-occupants-changed` event reports `occupantIds.length === 0`, THE ClusterStore SHALL immediately remove the Cluster and emit a destroyed snapshot.
3. THE ClusterStore SHALL treat `presentation:micro-scene-destroyed` as idempotent: repeated calls SHALL not throw and SHALL not re-create the Cluster.
4. THE destroyed state SHALL be final: a later `created` event with the same `microSceneId` SHALL be treated as a new Cluster.
5. THE ClusterStore SHALL emit a `fading` visibility state for 200–300ms before final removal; during fading the Cluster is not interactive and not eligible for ORCA input.
6. THE ClusterStore SHALL not invent a Cluster from two entities being near each other; the only Cluster source is the micro-scene bridge.

### Requirement 3: GroundGlowFootprint Interaction

**User story:** As a player, I want a visible elliptical target on the ground to click for a micro-scene move, so the click target is obvious and matches the camera view.

#### Acceptance Criteria

1. THE GroundGlowFootprint SHALL have `radiusX > radiusY` and `rotation === 0`.
2. THE GroundGlowFootprint SHALL have a `visibility` field with one of `weak`, `highlighted`, `selected`, `fading`.
3. THE GroundGlowFootprint SHALL be `weak` by default and stay visible even when not the active move target.
4. WHEN a move-selection state begins, THE GroundGlowFootprint for every interactive Cluster SHALL switch to `highlighted`.
5. WHEN a Cluster is destroyed or fading, THE corresponding GroundGlowFootprint SHALL be removed from the active set and SHALL not be hit-testable.
6. THE hit test SHALL be elliptical: `(dx/radiusX)^2 + (dy/radiusY)^2 <= 1`.
7. THE ORCA input SHALL use the equivalent circle radius `max(radiusX, radiusY) * 0.5`, not the raw ellipse axes.

### Requirement 4: CollisionRegistry and Mobility

**User story:** As the ORCA algorithm, I want a single source of truth for collision boxes and their mobility, so blocked paths and standoff resolve consistently.

#### Acceptance Criteria

1. THE CollisionRegistry SHALL store collision boxes keyed by entity id.
2. THE CollisionRegistry SHALL support four mobility classes: `movable-character`, `movable-entity`, `immovable-character`, `immovable-entity`.
3. THE CollisionRegistry SHALL not allow a collision box to exist without a corresponding entity; stale boxes SHALL be removed on `entity.removed` events.
4. THE CollisionRegistry SHALL support updating mobility class for an existing box without removing the box; e.g. vehicle becomes `immovable-entity` when the driver leaves.
5. THE CollisionRegistry SHALL reject duplicate registration and return the existing box.

### Requirement 5: RenderCommand Lifecycle

**User story:** As the render layer, I want commands with full lifecycle, so I can start, skip, cancel, and report outcome without ambiguity.

#### Acceptance Criteria

1. THE RenderCommand SHALL carry `commandId`, `semanticId`, `sourceRevision`, optional `targetPageId`, `trigger`, and `payload`.
2. THE RenderCommand SHALL declare `advancesJourney: false`.
3. THE RenderCommandExecutor SHALL resolve a command to exactly one of: `accepted`, `completed`, `skipped`, `degraded`, `failed`, `timeout`, `cancelled`, `stale`.
4. WHEN `sourceRevision` is older than the current SpatialProjection revision, THE executor SHALL return `stale` without executing.
5. WHEN the executor receives a cancel signal, it SHALL stop the command and release resources.
6. WHEN a command reaches `completed`, `failed`, `timeout`, or `cancelled`, THE command SHALL be removed from the active set within one tick.

### Requirement 6: EventBridge from Gameplay to Presentation

**User story:** As the presentation layer, I want a single event bridge that converts `presentation:*` and `after:*` events to store updates, so the render layer receives consistent snapshots.

#### Acceptance Criteria

1. THE EventBridge SHALL subscribe to `presentation:micro-scene-created`, `presentation:micro-scene-occupants-changed`, `presentation:micro-scene-destroyed`.
2. THE EventBridge SHALL subscribe to `after:entity.place` and feed it to the MoveChoreographer.
3. THE EventBridge SHALL not read gameplay micro-scene internal state beyond what is exposed in projection events.
4. WHEN an event is older than the current revision, THE EventBridge SHALL drop it as stale.
5. THE EventBridge SHALL provide `subscribe(handler)` to the render layer and SHALL not leak gameplay types into the handler signature.

### Requirement 7: Single-player Input Non-Blocking

**User story:** As a single-player player, I expect the next action card to highlight immediately after the previous rule settlement, so I am not waiting on animation.

#### Acceptance Criteria

1. THE EventBridge SHALL emit an updated snapshot immediately after `after:rule-settled`.
2. THE action card highlight SHALL not wait for any pending movement animation to finish.
3. THE MoveChoreographer SHALL not block the next input even if a previous move is animating.

### Requirement 8: Multiplayer Turn Handoff Hard Limit

**User story:** As a multiplayer match, I want the turn to hand off only after required animations, but I don't want infinite waits.

#### Acceptance Criteria

1. THE TurnHandoffGate SHALL wait for required animations before releasing the next turn.
2. THE TurnHandoffGate SHALL enforce a 3000ms hard limit.
3. WHEN the hard limit expires, THE TurnHandoffGate SHALL cancel outstanding animations, record a timeout diagnostic, and force-release the next turn.
4. THE TurnHandoffGate SHALL not roll back any rule state.
5. THE TurnHandoffGate SHALL not replay a submitted intent.

### Requirement 9: RenderLayer Cleanup

**User story:** As a developer, I want a deterministic dispose path so resources do not leak on page change.

#### Acceptance Criteria

1. THE PresentationRuntime.dispose() SHALL cancel all RAF and timer handles.
2. THE PresentationRuntime.dispose() SHALL clear all active command subscriptions.
3. THE PresentationRuntime.dispose() SHALL clear all event subscriptions on the EventBridge.
4. THE PresentationRuntime.dispose() SHALL clear the CollisionRegistry.
5. THE PresentationRuntime.dispose() SHALL set every active GroundGlowFootprint to `fading` and release it.
6. THE PresentationRuntime.dispose() SHALL clear audio loops and particle instances.
7. THE PresentationRuntime.dispose() SHALL be idempotent.

### Requirement 10: Resource Failure Fallback

**User story:** As a player, I want the game to keep working when a sprite or audio fails to load, so I never see a broken screen.

#### Acceptance Criteria

1. WHEN an asset fails to load, THE FallbackProvider SHALL provide a placeholder (semantic shape, text label) without blocking interaction.
2. WHEN a GroundGlowFootprint asset is missing, THE footprint SHALL still render as a thin outline so the target is clickable.
3. THE resource failure SHALL be recorded in the diagnostic sink with the asset id.

### Requirement 11: Reduced-motion and Low-performance

**User story:** As a player with motion sensitivity, I want the game to remain readable and interactive when reduced motion is enabled.

#### Acceptance Criteria

1. WHEN `prefers-reduced-motion: reduce` is set, THE PresentationRuntime SHALL skip non-essential animations and reach the final state directly.
2. THE GroundGlowFootprint SHALL remain visible in reduced-motion.
3. WHEN the runtime detects low-performance, particle counts SHALL be reduced but interactions SHALL remain intact.
4. THE reduced-motion path SHALL not produce empty or blank scenes.

### Requirement 12: Accessibility and Keyboard

**User story:** As a keyboard or gamepad user, I want a non-color focus indicator and a clear focus order.

#### Acceptance Criteria

1. THE GroundGlowFootprint SHALL have an `aria-label` derived from the micro-scene projection.
2. THE PresentationRuntime SHALL support keyboard focus traversal across scenes and footprints.
3. THE focus state SHALL produce a non-color visual change (outline thickening, slight scale).
4. THE focus order SHALL match the spatial order of nodes and clusters.

### Requirement 13: Command Result Revision Check

**User story:** As the system, I want commands tied to a specific source revision, so I never replay an old command against a new world.

#### Acceptance Criteria

1. THE RenderCommandExecutor SHALL compare `sourceRevision` with the current SpatialProjection revision before executing.
2. IF the command's revision is older, THE executor SHALL return `stale` and not execute.
3. THE render layer SHALL not visually advance on a `stale` result.
4. THE command SHALL be removed from the active set after `stale`.

### Requirement 14: Auditability of the Bridge

**User story:** As a reviewer, I want to see tests for every requirement, so the implementation can be verified by anyone.

#### Acceptance Criteria

1. For every requirement in this spec, at least one test SHALL cover the success path and one test SHALL cover the failure path.
2. The spec is accepted only if all tests pass and the project-level gates succeed.
