/**
 * Feature: wakeup-ugc, Property 6: Base/play separation.
 *
 * 对任意候选变更集：基类层定义不含具体玩法数值/规则/配置，玩法层候选只组合已登记的基类层契约，
 * 且一个原子变更集永不同时改动两个注册表。
 *
 * **Validates: Requirement 6**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness';
import { requestFrom, validCandidateText } from '../../testing/generators';
import { TARGET_OWNERSHIPS } from '../../model/candidate';

describe('Feature: wakeup-ugc, Property 6: base/play separation', () => {
  it('requires exactly one declared target ownership layer', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TARGET_OWNERSHIPS), (layer) => {
        const harness = createHarness({ targetOwnership: layer });
        const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored', layer));
        expect(report.status).toBe('validated');
        expect(report.changeRequestBinding?.targetOwnership).toBe(layer);
      }),
      { numRuns: 2 },
    );
  });

  it('binds the target layer into the request identity so layers cannot be swapped', () => {
    const harness = createHarness();
    const asBase = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored', 'base-layer'));
    const asPlay = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored', 'play-layer'));
    // 内容完全相同，但目标层不同 → 请求身份必须不同（需求 13.13）。
    expect(asPlay.candidateFingerprint).toBe(asBase.candidateFingerprint);
    expect(asPlay.changeRequestFingerprint).not.toBe(asBase.changeRequestFingerprint);
  });

  it('never activates a candidate into a registry of the other layer', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TARGET_OWNERSHIPS), (registryLayer) => {
        const candidateLayer = registryLayer === 'base-layer' ? 'play-layer' : 'base-layer';
        const harness = createHarness({ targetOwnership: registryLayer });
        const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored', candidateLayer));
        if (report.validated === null) return;
        const before = harness.registry.readSnapshot();
        const result = harness.facade.activate(report.validated, report.baseline);

        expect(result.status).toBe('rejected');
        expect(harness.registry.calls.activate).toBe(0);
        expect(harness.registry.readSnapshot().snapshotFingerprint).toBe(before.snapshotFingerprint);
      }),
      { numRuns: 2 },
    );
  });

  it('activates each layer only through its own atomic change set', () => {
    for (const layer of TARGET_OWNERSHIPS) {
      const harness = createHarness({ targetOwnership: layer });
      const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored', layer));
      if (report.validated === null) throw new Error('fixture should validate');
      const result = harness.facade.activate(report.validated, report.baseline);
      expect(result.status).toBe('activated');
      // 每层各自一次提交，互不影响。
      expect(harness.registry.calls.activate).toBe(1);
    }
  });

  it('rejects a base-layer candidate carrying concrete gameplay rules when upstream says so', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('victoryCondition', 'mapLayout', 'spawnDistribution', 'balanceTable', 'playpackSequence'),
        (field) => {
          const harness = createHarness({
            validator: { errors: [{ definitionId: 'weapon:shotgun', jsonPath: `/${field}`, condition: 'unknown-field' }] },
          });
          const report = harness.facade.validate(
            requestFrom(validCandidateText({ [field]: 'concrete' }), 'hand-authored', 'base-layer'),
          );
          expect(report.status).toBe('rejected');
          expect(harness.registry.calls.activate).toBe(0);
        },
      ),
      { numRuns: 5 },
    );
  });
});
