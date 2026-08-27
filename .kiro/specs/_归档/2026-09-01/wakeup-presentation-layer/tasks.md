# Presentation Layer Implementation Tasks

> Implements the requirements in `requirements.md` (R001–R014) and the design in `design.md`. Tests live alongside the code in `src/ui/presentation/spatial/__tests__/`. Scope: presentation state, event bridge, and command lifecycle. Rendering and ORCA algorithm are out of scope.

## Phase A: Spatial State Stores

- [ ] 1. Implement ClusterStore
  - Maintain `Record<clusterId, ClusterRecord>` keyed by `microSceneId`.
  - Apply `microSceneCreated` (>=1 occupant required), `occupantsChanged`, `microSceneDestroyed`.
  - No zero-occupant active clusters; idempotent destroy.
  - On zero-occupant event, transition to `fading` and remove after timeout.
  - Emit snapshots to subscribers.
  - _Verification: R1, R2, R13, R14_

- [ ] 2. Implement GroundGlowStore
  - Derive `GroundGlowFootprint` from each active Cluster.
  - Default `visibility: 'weak'`; transition on selection state.
  - Compute equivalent circle radius for ORCA.
  - Hit-test using `(dx/rx)^2 + (dy/ry)^2 <= 1`.
  - _Verification: R3, R11, R12, R14_

- [ ] 3. Implement CollisionRegistry
  - Register, update mobility, deregister by entity id.
  - Reject duplicate registration (return existing).
  - Update cluster id on migration signal.
  - _Verification: R4, R14_

- [ ] 4. Implement SpatialProjectionStore
  - Hold deep-frozen projection snapshot.
  - Revision monotonic; atomic swap on commit.
  - Reject revisions older than current.
  - _Verification: R1, R13, R14_

## Phase B: Event Bridge

- [ ] 5. Implement EventBridge
  - Subscribe to `presentation:micro-scene-*` and `after:*` events.
  - Translate to ClusterStore / GroundGlowStore / CollisionRegistry updates.
  - Drop stale events older than current revision.
  - _Verification: R6, R14_

## Phase C: Command Lifecycle

- [ ] 6. Implement RenderCommandExecutor
  - Accept `RenderCommand`, return `RenderCommandOutcome`.
  - Revision check → `stale` if older than current projection.
  - Cancel signal support; cleanup on terminal outcome.
  - _Verification: R5, R13, R14_

- [ ] 7. Implement MoveChoreographer skeleton
  - Consume `after:entity.place`.
  - Skip animation in single-player; queue in multiplayer.
  - Non-blocking input: not awaiting move completion for next input.
  - _Verification: R7_

## Phase D: Multiplayer Handoff

- [ ] 8. Implement TurnHandoffGate
  - Wait for required animations; enforce 3000ms hard limit.
  - On timeout: cancel outstanding, record diagnostic, force-release.
  - _Verification: R8_

## Phase E: Cleanup and Fallback

- [ ] 9. Implement PresentationRuntime.dispose()
  - Cancel timers, RAF, particle, audio loops.
  - Clear subscriptions, command queue, collision registry.
  - Set every active footprint to `fading`.
  - Idempotent.
  - _Verification: R9_

- [ ] 10. Implement Resource Fallback Provider
  - Placeholder for failed asset (semantic shape or text).
  - Footprint outline when asset missing.
  - Record diagnostic with asset id.
  - _Verification: R10_

## Phase F: Auditability

- [ ] 11. Add per-requirement tests
  - One success and one failure test per requirement (R1–R14).
  - _Verification: R14_

- [ ] 12. Run project-level gates
  - `npx tsc --noEmit` on the new files.
  - `npx vitest run src/ui/presentation/spatial`.
  - `npm run verify:docs` after any spec change.
  - _Verification: R14_
