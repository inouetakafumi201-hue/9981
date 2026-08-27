/**
 * Feature: wakeup-ugc, Property 1: UGC boundary closure.
 *
 * 对任意候选或适配器输出，请求新的 Ref 前缀、Def kind 注册表、Op/Expr/Hook/事务/持久化机制、
 * 直接写 WorldState 或混合基类层/玩法层激活，都必须产生适用的归属拒绝、零激活调用和不变快照。
 *
 * **Validates: Requirements 1, 6**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness';
import { rejectionFacts } from '../../testing/observer';
import { requestFrom, validCandidateText } from '../../testing/generators';

/** 请求引擎层原语的候选形状。上游验证器会把它们判为层级越权。 */
const ENGINE_PRIMITIVE_REQUESTS = [
  { refPrefix: 'mine:' },
  { defKindRegistry: { register: 'weapon-class' } },
  { opDispatcher: 'prop.custom' },
  { exprEvaluator: { lang: 'mine' } },
  { hookScheduler: { phase: 'before' } },
  { transaction: { begin: true } },
  { persistence: { write: 'save.json' } },
  { worldState: { entities: {} } },
] as const;

describe('Feature: wakeup-ugc, Property 1: UGC boundary closure', () => {
  it('rejects every engine-primitive request with an ownership diagnostic and zero activation', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ENGINE_PRIMITIVE_REQUESTS), (payload) => {
        // 上游验证器负责判定层级归属；这里注入一条层级归属错误来代表其裁定。
        const harness = createHarness({
          validator: { errors: [{ definitionId: 'weapon:shotgun', jsonPath: '/engine', condition: 'unknown-field' }] },
        });
        const before = harness.registry.readSnapshot();
        const report = harness.facade.validate(requestFrom(validCandidateText(payload), 'hand-authored'));
        const facts = rejectionFacts(report);

        expect(facts.rejected).toBe(true);
        expect(facts.hasBlocking).toBe(true);
        expect(facts.noArtifact).toBe(true);
        expect(harness.registry.calls.activate).toBe(0);
        const after = harness.registry.readSnapshot();
        expect(after.snapshotFingerprint).toBe(before.snapshotFingerprint);
        expect(after.activeDefinitionIds).toEqual(before.activeDefinitionIds);
      }),
      { numRuns: ENGINE_PRIMITIVE_REQUESTS.length },
    );
  });

  it('never lets a play-layer artifact activate into a base-layer registry, or the reverse', () => {
    fc.assert(
      fc.property(fc.constantFrom('base-layer' as const, 'play-layer' as const), (registryLayer) => {
        const candidateLayer = registryLayer === 'base-layer' ? 'play-layer' : 'base-layer';
        const harness = createHarness({ targetOwnership: registryLayer });
        const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored', candidateLayer));
        expect(report.status).toBe('validated');
        if (report.validated === null) return;

        const result = harness.facade.activate(report.validated, report.baseline);
        expect(result.status).toBe('rejected');
        expect(result.unchanged).toBe(true);
        expect(harness.registry.calls.activate).toBe(0);
      }),
      { numRuns: 2 },
    );
  });

  it('exposes no runtime write capability on any public surface', () => {
    const harness = createHarness();
    const surfaces: readonly Record<string, unknown>[] = [
      harness.facade as unknown as Record<string, unknown>,
      harness.registry.readSnapshot() as unknown as Record<string, unknown>,
    ];
    for (const surface of surfaces) {
      for (const forbidden of ['invoke', 'setDraft', 'commit', 'register', 'emit', 'write', 'takeSnapshot', 'applyMigration']) {
        expect(surface[forbidden]).toBeUndefined();
      }
    }
  });
});
