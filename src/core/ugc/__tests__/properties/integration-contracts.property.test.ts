/**
 * Feature: wakeup-ugc, Property 15: Integration contracts fail closed.
 *
 * 对任意 core mechanics、space-items 或 AI 引用，缺失、提供方冲突、导出缺失或版本变化都拒绝或使验证失效，
 * 且不猜测提供方形状。登记契约永不自动激活此前被拒绝的候选。
 *
 * **Validates: Requirement 15**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog.js';
import { createDiagnosticFactory } from '../../diagnostics/factory.js';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway.js';
import { INTEGRATION_DOMAINS } from '../../model/contract-types.js';
import type { IntegrationContract, IntegrationDomain } from '../../model/contract-types.js';
import { createIntegrationContractCatalog } from '../../contracts/integration-contract-catalog.js';
import type { SourceRecord } from '../../../kernel/state/diagnostic.js';

const fingerprint = sha256FingerprintGateway;
const factory = createDiagnosticFactory(createDiagnosticCodeCatalog(fingerprint));

const record: SourceRecord = {
  sourceId: 's', documentUri: 'd', sourcePackage: 'p', contentHash: 'h', precedence: 1,
  owningLayer: '基类层', normativeStatus: 'normative',
  span: { file: 'd', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } },
};

function contract(domain: IntegrationDomain, overrides: Partial<IntegrationContract> = {}): IntegrationContract {
  return {
    domain,
    providerId: `provider.${domain}`,
    version: '1.0.0',
    exportedDefKinds: ['action'],
    exportedSemanticFamilies: ['cost'],
    referenceConstraintsFingerprint: 'rc-1',
    sourceRecords: [record],
    ...overrides,
  };
}

function catalogOf(contracts: readonly IntegrationContract[]) {
  const built = createIntegrationContractCatalog({ fingerprint, factory }, contracts);
  if (!built.ok) throw new Error('unexpected catalog rejection');
  return built.value;
}

describe('Feature: wakeup-ugc, Property 15: integration contracts fail closed', () => {
  it('rejects a dependency on any unmerged domain', () => {
    fc.assert(
      fc.property(fc.constantFrom(...INTEGRATION_DOMAINS), (present) => {
        const catalog = catalogOf([contract(present)]);
        for (const domain of INTEGRATION_DOMAINS) {
          const result = catalog.resolve(domain, 'pkg-1');
          if (domain === present) {
            expect(result.ok).toBe(true);
          } else {
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
          }
        }
      }),
      { numRuns: 3 },
    );
  });

  it('rejects a provider-identity conflict when two providers claim one domain', () => {
    fc.assert(
      fc.property(fc.constantFrom(...INTEGRATION_DOMAINS), (domain) => {
        const built = createIntegrationContractCatalog({ fingerprint, factory }, [
          contract(domain),
          contract(domain, { providerId: `${domain}.other` }),
        ]);
        expect(built.ok).toBe(false);
        if (built.ok) return;
        expect(built.diagnostics[0]?.code).toBe('E_LOAD_IDENTITY_CONFLICT');
      }),
      { numRuns: 3 },
    );
  });

  it('rejects a capability absent from the registered provider with expected information', () => {
    const catalog = catalogOf([contract('core-mechanics')]);
    const result = catalog.resolveExport('core-mechanics', 'not-exported', 'pkg-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.expected).toBe('not-exported');
    expect(result.diagnostics[0]?.reason).toContain('provider.core-mechanics');
  });

  it('changes the catalog fingerprint whenever a version changes, invalidating prior baselines', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[1-9]\.\d\.\d$/), (version) => {
        const base = catalogOf([contract('ai')]).snapshot().fingerprint;
        const changed = catalogOf([contract('ai', { version })]).snapshot().fingerprint;
        if (version === '1.0.0') {
          expect(changed).toBe(base);
        } else {
          expect(changed).not.toBe(base);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('holds no candidate state, so merging a contract cannot auto-activate anything', () => {
    const catalog = catalogOf([contract('space-items')]);
    expect(Object.keys(catalog).sort()).toEqual(['resolve', 'resolveExport', 'snapshot']);
    const asRecord = catalog as unknown as Record<string, unknown>;
    for (const forbidden of ['retry', 'reactivate', 'pending', 'activate']) {
      expect(asRecord[forbidden]).toBeUndefined();
    }
  });

  it('produces an order-independent catalog fingerprint', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const a = catalogOf([contract('core-mechanics'), contract('ai')]).snapshot().fingerprint;
        const b = catalogOf([contract('ai'), contract('core-mechanics')]).snapshot().fingerprint;
        expect(b).toBe(a);
      }),
      { numRuns: 3 },
    );
  });
});
