/**
 * 任务 2.3 验收测试：code catalog 完备性、scope 强制字段、显式 null 定位、确定性排序、跨来源等价。
 */
import { describe, expect, it } from 'vitest';
import { ERR_CODES } from '../../../kernel/state/error-codes';
import { HINT_TEMPLATES } from '../../../kernel/safety/safety';
import type { Diagnostic, SourceSpan } from '../../../kernel/state/diagnostic';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway';
import { CODE_MAP, UGC_DIAGNOSTIC_CATEGORIES } from '../code-map';
import { createDiagnosticCodeCatalog } from '../code-catalog';
import { UnmappedDiagnosticError, createDiagnosticFactory, documentAnchorSpan } from '../factory';
import { compareDiagnostics, diagnosticsEquivalent, sortDiagnostics } from '../sort';

const catalog = createDiagnosticCodeCatalog(sha256FingerprintGateway);
const factory = createDiagnosticFactory(catalog);

function span(file: string, offset: number, line = 1, column = 1): SourceSpan {
  const point = { line, column, offset };
  return { file, start: point, end: point };
}

describe('Feature: wakeup-ugc, Task 2.3: diagnostic code catalog', () => {
  it('resolves every mapped condition to a registered closed ErrCode with a hint', () => {
    expect(catalog.incompleteEntries()).toEqual([]);
  });

  it('only maps to codes that exist in the shared ERR_CODES enum', () => {
    const registered = new Set(
      Object.entries(ERR_CODES).flatMap(([prefix, suffixes]) => suffixes.map((suffix) => `${prefix}_${suffix}`)),
    );
    for (const category of UGC_DIAGNOSTIC_CATEGORIES) {
      for (const code of Object.values(CODE_MAP[category])) {
        expect(registered.has(code)).toBe(true);
        expect(HINT_TEMPLATES[code]).toBeTruthy();
      }
    }
  });

  it('returns null for an unmapped condition instead of inventing a code', () => {
    expect(catalog.resolve('JSON_SYNTAX', 'not-a-real-condition')).toBeNull();
  });

  it('classifies severity as fatal, warn or error by closed rules', () => {
    expect(catalog.severity('E_LOAD_JSON_SYNTAX')).toBe('error');
    expect(catalog.severity('E_LOAD_PRESENTATION_FALLBACK')).toBe('warn');
    expect(catalog.severity('E_LOAD_MIGRATED_SOURCE_REBASED')).toBe('warn');
    // E_QUOTA_DIAGNOSTICS 已登记为基础设施 fatal，诊断洪泛必须终止而不是继续收集。
    expect(catalog.severity('E_QUOTA_DIAGNOSTICS')).toBe('fatal');
    expect(catalog.severity('E_INV_DANGLING')).toBe('fatal');
  });

  it('derives its version from content so any code or hint change invalidates baselines', () => {
    const again = createDiagnosticCodeCatalog(sha256FingerprintGateway);
    expect(again.version).toBe(catalog.version);
    expect(catalog.version.startsWith('dcat-')).toBe(true);
  });

  it('registers the migration-steps quota code closed in task 1.3', () => {
    expect(catalog.resolve('RESOURCE_LIMIT', 'migrationSteps')).toBe('E_QUOTA_MIGRATION_STEPS');
    expect(catalog.hint('E_QUOTA_MIGRATION_STEPS')).toBeTruthy();
  });
});

describe('Feature: wakeup-ugc, Task 2.3: scope-aware mandatory fields', () => {
  const common = {
    stage: 'decode' as const,
    sourcePackage: 'pkg-1',
    message: 'msg',
    reason: '原因',
    correctionSuggestion: '修正建议',
  };

  it('gives document scope an explicit null definition id and json path', () => {
    const diagnostic = factory.document({
      ...common,
      selector: { category: 'JSON_SYNTAX', condition: 'syntax' },
      sourceSpan: span('doc-1', 12),
    });
    expect(diagnostic.scope).toBe('document');
    // 需求 14.4：document scope 不得编造 definition 标识，必须是显式 null（不是 undefined）。
    expect(diagnostic.at).toBeNull();
    expect(diagnostic.path).toBeNull();
    expect(diagnostic.sourceSpan?.file).toBe('doc-1');
    expect(diagnostic.sourcePackage).toBe('pkg-1');
  });

  it('gives definition scope a definition id, json path and span', () => {
    const diagnostic = factory.definition({
      ...common,
      selector: { category: 'SCHEMA_CONTRACT', condition: 'unknown-field' },
      definitionId: 'weapon:shotgun',
      jsonPath: '/defs/0/unknown',
      sourceSpan: span('doc-1', 40),
    });
    expect(diagnostic.scope).toBe('definition');
    expect(diagnostic.at?.def).toBe('weapon:shotgun');
    expect(diagnostic.path).toBe('/defs/0/unknown');
    expect(diagnostic.sourceSpan).not.toBeNull();
  });

  it('gives change-set scope a null definition id and tolerates an absent span', () => {
    const diagnostic = factory.changeSet({
      ...common,
      selector: { category: 'RESOURCE_LIMIT', condition: 'traversalWork' },
      sourceSpan: null,
      jsonPath: null,
    });
    expect(diagnostic.scope).toBe('change-set');
    expect(diagnostic.at).toBeNull();
    expect(diagnostic.path).toBeNull();
    expect(diagnostic.sourceSpan).toBeNull();
  });

  it('gives registry scope expected and actual baseline identities', () => {
    const diagnostic = factory.registry({
      ...common,
      stage: 'activation-precheck',
      selector: { category: 'ATOMIC_ACTIVATION', condition: 'baseline-stale' },
      expectedBaseline: 'base-1',
      actualBaseline: 'base-2',
    });
    expect(diagnostic.scope).toBe('registry');
    expect(diagnostic.expected).toBe('base-1');
    expect(diagnostic.actual).toBe('base-2');
    expect(diagnostic.code).toBe('E_LOAD_BASELINE_STALE');
  });

  it('encodes stage, category and condition into a stable messageKey', () => {
    const diagnostic = factory.document({
      ...common,
      selector: { category: 'JSON_SYNTAX', condition: 'duplicate-member' },
      sourceSpan: documentAnchorSpan('doc-1'),
    });
    expect(diagnostic.messageKey).toBe('ugc/decode/JSON_SYNTAX/duplicate-member');
    expect(diagnostic.rootCauseId).toBe('ugc/decode/JSON_SYNTAX/duplicate-member');
  });

  it('throws a loud implementation error for an unmapped selector', () => {
    expect(() =>
      factory.document({
        ...common,
        // 故意绕过编译期类型检查，模拟映射表与调用点不一致的实现缺陷。
        selector: { category: 'JSON_SYNTAX', condition: 'nope' } as never,
        sourceSpan: documentAnchorSpan('doc-1'),
      }),
    ).toThrow(UnmappedDiagnosticError);
  });
});

function raw(overrides: Partial<Diagnostic>): Diagnostic {
  return {
    code: 'E_LOAD_JSON_SYNTAX',
    severity: 'error',
    message: 'm',
    phase: 0,
    at: null,
    path: null,
    sourcePackage: 'pkg-1',
    sourceSpan: null,
    ...overrides,
  };
}

describe('Feature: wakeup-ugc, Task 2.3: deterministic ordering', () => {
  it('produces a byte-equivalent order for any input permutation', () => {
    const items: readonly Diagnostic[] = [
      raw({ sourcePackage: 'pkg-b', sourceSpan: span('d2', 5) }),
      raw({ sourcePackage: 'pkg-a', sourceSpan: span('d1', 9), at: { def: 'z' }, path: '/z' }),
      raw({ sourcePackage: 'pkg-a', sourceSpan: span('d1', 9), at: { def: 'a' }, path: '/a' }),
      raw({ sourcePackage: 'pkg-a', sourceSpan: span('d1', 2) }),
      raw({ sourcePackage: 'pkg-a', sourceSpan: null }),
      raw({ sourcePackage: 'pkg-a', sourceSpan: span('d1', 9), code: 'E_LOAD_UNKNOWN_FIELD', at: { def: 'a' }, path: '/a' }),
    ];

    const signature = (list: readonly Diagnostic[]): string =>
      sortDiagnostics(list)
        .map((entry) => `${entry.sourcePackage ?? '-'}|${entry.sourceSpan?.start.offset ?? '-'}|${entry.at?.def ?? '-'}|${entry.path ?? '-'}|${entry.code}`)
        .join('#');

    const reference = signature(items);
    const permutations = [
      [...items].reverse(),
      [items[3], items[0], items[5], items[1], items[4], items[2]].filter((entry): entry is Diagnostic => entry !== undefined),
      [items[4], items[2], items[1], items[3], items[5], items[0]].filter((entry): entry is Diagnostic => entry !== undefined),
    ];
    for (const permutation of permutations) {
      expect(signature(permutation)).toBe(reference);
    }
  });

  it('sorts a null source offset, definition id and json path last', () => {
    const withOffset = raw({ sourceSpan: span('d1', 3) });
    const withoutOffset = raw({ sourceSpan: null });
    expect(compareDiagnostics(withOffset, withoutOffset)).toBeLessThan(0);

    const withDef = raw({ sourceSpan: span('d1', 3), at: { def: 'a' } });
    expect(compareDiagnostics(withDef, withOffset)).toBeLessThan(0);
  });

  it('does not mutate the input array', () => {
    const items = [raw({ sourceSpan: span('d1', 9) }), raw({ sourceSpan: span('d1', 1) })];
    const snapshot = [...items];
    sortDiagnostics(items);
    expect(items).toEqual(snapshot);
  });
});

describe('Feature: wakeup-ugc, Task 2.3: cross-source equivalence', () => {
  it('ignores legitimately different source identities', () => {
    const fromHand = [raw({ sourcePackage: 'pkg-hand', sourceSpan: span('doc-hand', 4), messageKey: 'k1' })];
    const fromEditor = [raw({ sourcePackage: 'pkg-editor', sourceSpan: span('doc-editor', 4), messageKey: 'k1' })];
    expect(diagnosticsEquivalent(fromHand, fromEditor)).toBe(true);
  });

  it('still distinguishes code, severity, scope, reason class and json path', () => {
    const reference = [raw({ messageKey: 'k1', scope: 'document' })];
    expect(diagnosticsEquivalent(reference, [raw({ messageKey: 'k1', scope: 'change-set' })])).toBe(false);
    expect(diagnosticsEquivalent(reference, [raw({ messageKey: 'k2', scope: 'document' })])).toBe(false);
    expect(diagnosticsEquivalent(reference, [raw({ messageKey: 'k1', scope: 'document', severity: 'warn' })])).toBe(false);
    expect(diagnosticsEquivalent(reference, [raw({ messageKey: 'k1', scope: 'document', path: '/a' })])).toBe(false);
    expect(
      diagnosticsEquivalent(reference, [raw({ messageKey: 'k1', scope: 'document', code: 'E_LOAD_UNKNOWN_FIELD' })]),
    ).toBe(false);
  });

  it('distinguishes differing expected/actual values and lengths', () => {
    const reference = [raw({ messageKey: 'k1', expected: 1, actual: 2 })];
    expect(diagnosticsEquivalent(reference, [raw({ messageKey: 'k1', expected: 1, actual: 3 })])).toBe(false);
    expect(diagnosticsEquivalent(reference, [])).toBe(false);
  });
});
