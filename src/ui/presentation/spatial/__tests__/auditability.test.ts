import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REQUIREMENTS: { id: string; token: string; testFile: string }[] = [
  { id: 'R1', token: 'SpatialProjectionStore (R1', testFile: 'projection-store.test.ts' },
  { id: 'R2', token: 'ClusterStore (R2', testFile: 'cluster-store.test.ts' },
  { id: 'R3', token: 'GroundGlowFootprint (R3', testFile: 'ground-glow.test.ts' },
  { id: 'R4', token: 'CollisionRegistry (R4', testFile: 'collision-registry.test.ts' },
  { id: 'R5', token: 'RenderCommandExecutor (R5', testFile: 'render-command-executor.test.ts' },
  { id: 'R6', token: 'drops stale events', testFile: 'event-bridge.test.ts' },
  { id: 'R7', token: 'MoveChoreographer (R7', testFile: 'move-choreographer.test.ts' },
  { id: 'R8', token: 'TurnHandoffGate (R8', testFile: 'turn-handoff-gate.test.ts' },
  { id: 'R10', token: 'ResourceFailureFallback (R10', testFile: 'resource-failure-fallback.test.ts' },
  { id: 'R13', token: 'SpatialProjectionStore (R1, R13', testFile: 'projection-store.test.ts' },
  { id: 'P1', token: 'SpatialEntityStore (P1', testFile: 'spatial-entity-store.test.ts' },
  { id: 'P2', token: 'drives entities + clusters revision', testFile: 'event-bridge.test.ts' },
  { id: 'P3', token: 'ProjectionBuilder (P3', testFile: 'projection-builder.test.ts' },
  { id: 'P4', token: 'MoveChoreographer (P4', testFile: 'move-choreographer.test.ts' },
  { id: 'P5', token: 'RenderCommandExecutor (P5', testFile: 'render-command-executor.test.ts' },
  { id: 'P6', token: 'after:entity.place 触发 move command 进 executor', testFile: 'presentation-runtime.test.ts' },
]

const SPECS: Record<string, readonly string[]> = {
  R1: ['rejects a commit whose revision is older than the current', 'notifies subscribers on each commit'],
  R2: ['treats destroyed as idempotent', 'drops stale events older than the current revision'],
  R3: ['produces radiusX > radiusY', 'hit-test rejects points outside the ellipse'],
  R4: ['rejects update on missing entity', 'returns the existing box on duplicate registration'],
  R5: ['returns stale when the source revision is older', 'cancels and removes a command'],
  R6: ['drops stale events', 'drives entities + clusters revision in lock-step from kernel events'],
  R7: ['rejects a move whose target revision is older than current', 'queues multiple moves and drains in order'],
  R8: ['release before the hard limit does not mark the gate as timed out', 'clear cancels the armed timer'],
  R10: ['records the asset failure in diagnostics', 'does not block interaction on the failed asset'],
  R13: ['rejects a commit whose revision is older than the current', 'replaces the snapshot atomically on a newer commit'],
  P1: ['records entity → nodeId on update', 'snapshot is deep-frozen'],
  P2: ['drops stale events', 'drives entities + clusters revision in lock-step from kernel events'],
  P3: ['builds a deep-frozen SpatialProjection from MapData + stores', 'EntityView.locationNodeId is the latest entity → nodeId'],
  P4: ['rejects a move whose target revision is older than current', 'queues multiple moves and drains in order'],
  P5: ['returns stale when the source revision is older', 'cancels and removes a command'],
  P6: ['after:entity.place 触发 move command 进 executor', 'SpatialEntityStore 记录了 after:entity.place 的 nodeId'],
}

describe('Requirement Auditability (R14)', () => {
  const dir = join(process.cwd(), 'src', 'ui', 'presentation', 'spatial', '__tests__')

  for (const { id, testFile } of REQUIREMENTS) {
    it(`${id} references its test file (${testFile}) and covers at least one success/failure case`, () => {
      const path = join(dir, testFile)
      expect(existsSync(path)).toBe(true)
      const contents = readFileSync(path, 'utf8')
      const expectations = SPECS[id] ?? []
      for (const phrase of expectations) {
        expect(contents).toContain(phrase)
      }
    })
  }

  it('test files cover the declared stores and choreography', () => {
    const files = readdirSync(dir)
    for (const required of [
      'cluster-store.test.ts',
      'collision-registry.test.ts',
      'ground-glow.test.ts',
      'projection-store.test.ts',
      'projection-builder.test.ts',
      'spatial-entity-store.test.ts',
      'render-command-executor.test.ts',
      'event-bridge.test.ts',
      'move-choreographer.test.ts',
      'turn-handoff-gate.test.ts',
      'resource-failure-fallback.test.ts',
    ]) {
      expect(files).toContain(required)
    }
  })
})
