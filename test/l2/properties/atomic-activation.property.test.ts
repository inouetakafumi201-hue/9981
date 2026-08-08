/**
 * Feature: l2-base-layer-spec, Property 10: 包激活、覆盖、删除的原子性与回滚
 *
 * Validates Requirements 2.7, 7.12–7.13, 11.12, 12.6–12.11, 13.4, 15.7, 15.17.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { activate, emptyRegistry } from '../../../src/l2/registry/definition-registry.js';
import { snapshotsEquivalent } from '../../../src/l2/model/diagnostic-factory.js';
import { multiDefinitionPackage, singleDefinitionPackage } from '../../../src/l2/testing/builders.js';
import {
  arbId,
  validActionDefinition,
  INVALID_CASE_BUILDERS,
} from '../../../src/l2/testing/definition-generators.js';

describe('Property 10: 包激活、覆盖、删除的原子性与回滚', () => {
  it('含任一非法定义的候选包零变更且快照不变', () => {
    fc.assert(
      fc.property(
        arbId,
        fc.integer({ min: 0, max: INVALID_CASE_BUILDERS.length - 1 }),
        (idSeed, badIndex) => {
          const good = validActionDefinition(`good${idSeed}`);
          const bad = INVALID_CASE_BUILDERS[badIndex]!(`bad${idSeed}`).definition;
          const registry = emptyRegistry();
          const priorSnapshot = registry.snapshot;
          const result = activate(registry, multiDefinitionPackage('pkg', [good, bad]));
          expect(result.rejected).toBe(true);
          if (result.rejected) {
            // 拒绝含至少一个 Error。
            expect(result.diagnostics.some((d) => d.severity === 'Error')).toBe(true);
            // 前状态快照指纹被记录。
            expect(result.priorStateFingerprint).toBe(priorSnapshot.fingerprint);
          }
          // 活动注册表未变（仍为空）。
          expect(registry.definitions.size).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('全部合法的候选包一次性激活并产生确定快照', () => {
    fc.assert(
      fc.property(arbId, (idSeed) => {
        const definition = validActionDefinition(`ok${idSeed}`);
        const pkg = singleDefinitionPackage(`pkg-${idSeed}`, definition);
        const first = activate(emptyRegistry(), pkg);
        const second = activate(emptyRegistry(), pkg);
        expect(first.rejected).toBe(false);
        expect(second.rejected).toBe(false);
        if (!first.rejected && !second.rejected) {
          expect(first.value.registry.definitions.has(definition.id)).toBe(true);
          // 同一输入两次激活产生等价快照。
          expect(snapshotsEquivalent(first.value.snapshot, second.value.snapshot)).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('失败激活前后活动快照严格等价', () => {
    fc.assert(
      fc.property(arbId, (idSeed) => {
        // 先激活一个合法包建立基线。
        const baseline = activate(emptyRegistry(), singleDefinitionPackage('base', validActionDefinition(`base${idSeed}`)));
        expect(baseline.rejected).toBe(false);
        if (baseline.rejected) {
          return;
        }
        const before = baseline.value.registry.snapshot;
        // 再尝试激活一个非法包。
        const bad = INVALID_CASE_BUILDERS[0]!(`bad${idSeed}`).definition;
        const failed = activate(baseline.value.registry, singleDefinitionPackage('bad', bad));
        expect(failed.rejected).toBe(true);
        // 基线注册表对象不被原地修改。
        expect(snapshotsEquivalent(before, baseline.value.registry.snapshot)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});
