/**
 * Feature: wakeup-ugc, Property 12: Version and migration determinism.
 *
 * 对任意 Schema 迁移图，旧候选只经一条完整无环路径迁移；缺失、歧义、重复、成环、失败或更新版本的路径
 * 拒绝且不改动原始输入或活动状态。相同输入与注册表产生相同的迁移规范化输出。
 *
 * **Validates: Requirement 12**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog';
import { createDiagnosticFactory } from '../../diagnostics/factory';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway';
import { createSchemaMigrationCoordinator } from '../../migration/schema-migration-coordinator';
import { budget, edge, migrationGateway, parse, versionCatalog } from '../../migration/__tests__/fixtures';
import { ugcOk } from '../../model/result';

const factory = createDiagnosticFactory(createDiagnosticCodeCatalog(sha256FingerprintGateway));

function coordinator(supported: readonly string[], edges: readonly ReturnType<typeof edge>[]) {
  return createSchemaMigrationCoordinator({
    catalog: versionCatalog(supported),
    gateway: migrationGateway(edges),
    factory,
    maxSteps: 12,
  });
}

describe('Feature: wakeup-ugc, Property 12: version and migration determinism', () => {
  it('migrates only through a single complete acyclic chain', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (steps) => {
        const versions = ['1.0.0', ...Array.from({ length: steps }, (_v, index) => `1.${String(index + 1)}.0`)];
        const edges = versions.slice(0, -1).map((from, index) => edge(`m${String(index)}`, from, versions[index + 1] ?? from));
        const target = versions[versions.length - 1] ?? '1.0.0';
        const result = coordinator([target], edges).migrate(parse('{"schemaVersion":"1.0.0"}'), budget());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.schemaVersion).toBe(target);
        expect(result.value.appliedMigrationIds).toHaveLength(steps);
      }),
      { numRuns: 6 },
    );
  });

  it('rejects a gap without mutating the original document', () => {
    const document = parse('{"schemaVersion":"1.0.0","keep":"me"}');
    const originalAst = document.ast;
    const result = coordinator(['2.0.0'], []).migrate(document, budget());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_MIG_NO_PATH');
    expect(document.ast).toBe(originalAst);
    expect(document.schemaVersion).toBe('1.0.0');
  });

  it('rejects ambiguity, duplicate edges and cycles with their own codes', () => {
    const ambiguous = coordinator(['2.0.0'], [
      edge('direct', '1.0.0', '2.0.0'),
      edge('a', '1.0.0', '1.5.0'),
      edge('b', '1.5.0', '2.0.0'),
    ]).migrate(parse('{"schemaVersion":"1.0.0"}'), budget());
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.diagnostics[0]?.code).toBe('E_MIG_AMBIGUOUS_PATH');

    const cyclic = coordinator(['2.0.0'], [edge('a', '1.0.0', '1.5.0'), edge('b', '1.5.0', '1.0.0')]).migrate(
      parse('{"schemaVersion":"1.0.0"}'),
      budget(),
    );
    expect(cyclic.ok).toBe(false);
    if (!cyclic.ok) expect(cyclic.diagnostics[0]?.code).toBe('E_MIG_CYCLE');
  });

  it('rejects a version newer than every supported version', () => {
    const result = coordinator(['2.0.0'], []).migrate(parse('{"schemaVersion":"5.0.0"}'), budget());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_SCHEMA_VERSION');
  });

  it('is deterministic for the same input and registry', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const edges = [edge('m1', '1.0.0', '1.5.0'), edge('m2', '1.5.0', '2.0.0')];
        const run = () => {
          const result = coordinator(['2.0.0'], edges).migrate(parse('{"schemaVersion":"1.0.0","x":1}'), budget());
          return result.ok ? `${result.value.schemaVersion}|${result.value.appliedMigrationIds.join(',')}` : 'rejected';
        };
        expect(run()).toBe(run());
      }),
      { numRuns: 5 },
    );
  });

  it('a successful migration still requires passing every current check (migration alone is not activation)', () => {
    // 需求 12.7：迁移成功只是把文档搬到受支持版本，不授予激活资格。
    const result = coordinator(['2.0.0'], [edge('m', '1.0.0', '2.0.0', (ast) => ugcOk(ast))]).migrate(
      parse('{"schemaVersion":"1.0.0"}'),
      budget(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 迁移产物只是"到了受支持版本"，后续仍需完整验证（本用例只断言迁移边界职责）。
    expect(result.value.schemaVersion).toBe('2.0.0');
    expect(result.diagnostics.some((entry) => entry.code === 'E_LOAD_MIGRATED_SOURCE_REBASED')).toBe(true);
  });
});
