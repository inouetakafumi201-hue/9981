# wakeup-presentation-layer Acceptance

Spec: `.kiro/specs/wakeup-presentation-layer/`
Authority: `docs/表现系统/15_表现层生命周期与交互桥设计.md`, `docs/表现系统/14_表现层架构设计.md`, `docs/表现系统/11_ORCA寻路与移动系统设计补全.md`.

## Spec

```text
.kiro/specs/wakeup-presentation-layer/
├── requirements.md     # R1–R14 with success/failure acceptance criteria
├── design.md           # SpatialProjection, Cluster, Footprint, CollisionRegistry, RenderCommand data model
├── tasks.md            # Phase A–F: state stores, event bridge, command lifecycle, handoff gate, cleanup, auditability
├── execution-report.md # this file
└── remaining-plan.md  # R9/R11/R12/P9/P10/P11 follow-up plan
```

## Code

```text
src/ui/presentation/spatial/
├── render-command-api.ts                # + RenderCommand, RenderCommandOutcome
├── stores/
│   ├── collision-registry.ts           # R4
│   ├── cluster-store.ts                # R2
│   ├── ground-glow.ts                  # R3, R11, R12
│   └── projection-store.ts             # R1, R13
├── commands/
│   └── render-command-executor.ts      # R5, R13
├── choreography/
│   ├── event-bridge.ts                # R6
│   ├── move-choreographer.ts           # R7
│   └── turn-handoff-gate.ts            # R8
├── fallback/
│   └── resource-failure-fallback.ts    # R10
├── disposable.ts                       # R9
├── accessibility-config.ts             # R11
├── focus-traversal.ts                  # R12
├── algorithms/
│   ├── traversable-computer.ts         # P9
│   ├── pathfinding-service.ts          # P10
│   ├── orca-engine.ts                  # P11
│   └── __tests__/
│       ├── traversable-computer.test.ts
│       ├── pathfinding-service.test.ts
│       └── orca-engine.test.ts
├── __tests__/
│   ├── collision-registry.test.ts
│   ├── cluster-store.test.ts
│   ├── ground-glow.test.ts
│   ├── projection-store.test.ts
│   ├── render-command-executor.test.ts
│   ├── event-bridge.test.ts
│   ├── move-choreographer.test.ts
│   ├── turn-handoff-gate.test.ts
│   ├── resource-failure-fallback.test.ts
│   ├── r9-dispose.test.ts
│   ├── r11-accessibility.test.ts
│   ├── r12-focus.test.ts
│   └── auditability.test.ts
```

## Verification

```text
$ npx vitest run src/ui/presentation/
Test Files  27 passed (27)
Tests       224 passed (224)

$ npm run verify:docs     → 全部校验通过
$ npm run verify:prompt-pack → Prompt Pack verification passed.
```

Pre-existing environment errors (not from this spec, in game-ui-shell-15 Next project):

```text
src/devboard/game-ui-shell-15/.../shell-particle-contract.ts  (noUncheckedIndexedAccess)
src/devboard/game-ui-shell-15/.../shell-a11y.ts              (noUncheckedIndexedAccess)
src/devboard/game-ui-shell-15/.../shell-journey.ts          (string|undefined)
src/devboard/game-ui-shell-15/.../shell-route.ts             (alias @/lib/..., noUncheckedIndexedAccess)
src/devboard/game-ui-shell-15/.../use-focus-scope.ts         (noUncheckedIndexedAccess)
```

These are pre-existing game-ui-shell-15 Next alias and `noUncheckedIndexedAccess` issues unrelated to the presentation layer spec.

## Requirement coverage

| Req | Component | Tests |
|---|---|---|
| R1  Spatial projection lifecycle | SpatialProjectionStore | projection-store.test.ts (8 tests) |
| R2  Cluster lifecycle | ClusterStore | cluster-store.test.ts (6 tests) |
| R3  Ground-glow interaction | ground-glow | ground-glow.test.ts (10 tests) |
| R4  CollisionRegistry and mobility | CollisionRegistry | collision-registry.test.ts (6 tests) |
| R5  Render command lifecycle | RenderCommandExecutor | render-command-executor.test.ts (7 tests) |
| R6  Event bridge from gameplay | EventBridge | event-bridge.test.ts (5 tests) |
| R7  Single-player non-blocking | MoveChoreographer | move-choreographer.test.ts (4 tests) |
| R8  Multi-player hard limit | TurnHandoffGate | turn-handoff-gate.test.ts (5 tests) |
| R9  PresentationRuntime.dispose() | Disposable + presentation-runtime | r9-dispose.test.ts |
| R10 Resource failure fallback | ResourceFailureFallback | resource-failure-fallback.test.ts (5 tests) |
| R11 reduced-motion + low-performance | AccessibilityConfig + isMoveDegraded | r11-accessibility.test.ts |
| R12 Keyboard / gamepad / screen-reader | FocusTraversal | r12-focus.test.ts |
| R13 Command revision check | RenderCommandExecutor + SpatialProjectionStore | covered in R1 + R5 tests |
| R14 Auditability | auditability.test.ts | auditability.test.ts (11 tests) |

## Algorithm coverage (P9/P10/P11)

| Task | Component | Tests |
|---|---|---|
| P9 TraversableComputer | traversable-computer.ts | traversable-computer.test.ts |
| P10 PathfindingService | pathfinding-service.ts | pathfinding-service.test.ts |
| P11 OrcaEngine | orca-engine.ts | orca-engine.test.ts |

## V0 Competence List

All completed items have been recorded in `.kiro/v0-completeness-checklist.md` under the P9/P10/P11 section, including:

- R9: `Disposable` interface, `dispose()` chain, dispose after no-ops
- R11: `isMoveDegraded()` + `AccessibilityConfig` interface
- R12: `FocusTraversal.getFocusOrder()` + `getFocusLabel()` aria-label
- P9: `TraversableComputer` pure function, WSpan/freespan domain, 8-dir neighbor, 4-dir mask
- P10: A* with heap, diagonal + corner cutting prevention, path continuity validation
- P11: `orcaStep()` pure TS, half-plane projection, `fallbackToLinear`, single-agent straight displacement, separation for offset agents

Remaining: rendering layer integration (animations, ellipse SVG, particle system, audio), game-ui-shell-15 Next app fixes, rvo2-js replacement for OrcaEngine.
