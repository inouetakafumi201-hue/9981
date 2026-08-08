import { describe, expect, it } from 'vitest';
import { INFRASTRUCTURE_FATAL_CODES, isInfrastructureFatalCode } from '../../state/error-codes.js';
import { sourcePointAtByteOffset, sourcePointAtCharIndex, validateSourceRecord, createSourceRecord } from '../../state/source-record.js';
import { candidate, createHarness } from './fixtures.js';

/**
 * Reverse audit: each case is an attempt to find a silent-pass hole, not a demonstration
 * that the happy path works.
 */
describe('reverse audit: source positions under multibyte and CRLF input', () => {
  it('maps multibyte characters to consistent line/column/offset', () => {
    const text = '{\n  "名称": "霰弹枪"\n}';
    const record = createSourceRecord({
      sourceId: 's', documentUri: 'f.json', sourcePackage: 'p', sourceText: text,
      precedence: 1, owningLayer: '基类层', normativeStatus: 'normative',
      startCharIndex: 4, endCharIndex: 8,
    });
    expect(validateSourceRecord(record, text)).toEqual([]);
    expect(record.span.start.line).toBe(2);
    // Two spaces precede the quote on line 2, so the code-point column is 3.
    expect(record.span.start.column).toBe(3);
    // Offsets are UTF-8 bytes, so they must exceed the code-point index.
    expect(record.span.end.offset).toBeGreaterThan(record.span.end.column);
  });

  it('refuses an offset that lands inside a multibyte code point', () => {
    const text = '霰弹枪';
    expect(() => sourcePointAtByteOffset(text, 1)).toThrow(RangeError);
    expect(sourcePointAtByteOffset(text, 3)).toEqual({ line: 1, column: 2, offset: 3 });
  });

  it('detects a tampered source slice hash', () => {
    const text = '{"a":1}';
    const record = createSourceRecord({
      sourceId: 's', documentUri: 'f.json', sourcePackage: 'p', sourceText: text,
      precedence: 1, owningLayer: '基类层', normativeStatus: 'normative',
    });
    const tampered = { ...record, span: { ...record.span, sourceSliceHash: 'deadbeef' } };
    expect(validateSourceRecord(tampered, text).length).toBeGreaterThan(0);
    expect(validateSourceRecord(record, '{"a":2}').length).toBeGreaterThan(0);
  });

  it('treats CRLF input without shifting reported lines', () => {
    const text = '{\r\n  "a": 1\r\n}';
    expect(sourcePointAtCharIndex(text, text.indexOf('"a"')).line).toBe(2);
  });
});

describe('reverse audit: escape and encoding evasion of the prohibited execution surface', () => {
  it('rejects a prohibited key written with unicode escapes', async () => {
    const harness = createHarness();
    // "\u0024eval" decodes to "$eval": detection must happen on the decoded key, not the raw text.
    const text = '{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[],"\\u0024eval":"x"}';
    const result = await harness.compiler.compileAndActivate(candidate(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_PROHIBITED_CONSTRUCT');
  });

  it('rejects duplicate members that differ only by escaping', async () => {
    const harness = createHarness();
    const text = '{"schemaVersion":"1.0.0","\\u0073chemaVersion":"1.0.0","targetLayer":"基类层","definitions":[]}';
    const result = await harness.compiler.compileAndActivate(candidate(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_DUPLICATE_MEMBER');
  });

  it('rejects non-finite and malformed numbers that JSON.parse would also refuse', async () => {
    for (const literal of ['1e999', 'NaN', 'Infinity', '01', '.5', '1.']) {
      const harness = createHarness();
      const text = `{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[],"n":${literal}}`;
      const result = await harness.compiler.compileAndActivate(candidate(text));
      expect(result.ok, `literal ${literal} must not activate`).toBe(false);
    }
  });

  it('rejects unescaped control characters inside strings', async () => {
    const harness = createHarness();
    const text = '{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[],"s":"a\u0001b"}';
    const result = await harness.compiler.compileAndActivate(candidate(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_LOAD_JSON_SYNTAX');
  });

  it('does not let a prototype-polluting key reach the model', async () => {
    const harness = createHarness();
    const text = '{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[],"__proto__":{"polluted":true}}';
    const result = await harness.compiler.compileAndActivate(candidate(text));
    expect(result.ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('reverse audit: quotas cannot be raised by the candidate itself', () => {
  it('rejects an oversized document before building a parse tree', async () => {
    const harness = createHarness({ quotas: { inputBytes: 120 } });
    const filler = 'x'.repeat(400);
    const text = `{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[],"pad":"${filler}"}`;
    const result = await harness.compiler.compileAndActivate(candidate(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_QUOTA_INPUT_BYTES');
    expect(result.halted).toBe('candidate');
  });

  it('terminates on deep nesting instead of overflowing the call stack', async () => {
    const harness = createHarness({ quotas: { nestingDepth: 20 } });
    const depth = 5000;
    const text = `{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[],"deep":${'['.repeat(depth)}${']'.repeat(depth)}}`;
    const result = await harness.compiler.compileAndActivate(candidate(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain('E_QUOTA_NESTING_DEPTH');
  });

  it('ignores candidate-declared quota fields', async () => {
    const harness = createHarness({ quotas: { definitions: 1 } });
    const text = JSON.stringify({
      schemaVersion: '1.0.0',
      targetLayer: '基类层',
      quotas: { definitions: 9999 },
      definitions: [
        { id: 'item.a', kind: 'item', iconRef: 'i' },
        { id: 'item.b', kind: 'item', iconRef: 'i' },
      ],
    });
    const result = await harness.compiler.compileAndActivate(candidate(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.diagnostics.map((item) => item.code);
    expect(codes).toContain('E_QUOTA_DEFINITIONS');
  });
});

describe('reverse audit: infrastructure code classification', () => {
  it('never classifies ordinary candidate load errors as infrastructure failures', () => {
    for (const code of ['E_LOAD_JSON_SYNTAX', 'E_LOAD_UNKNOWN_FIELD', 'E_LOAD_DUPLICATE_ID', 'E_REF_MISSING']) {
      expect(isInfrastructureFatalCode(code)).toBe(false);
    }
    for (const code of INFRASTRUCTURE_FATAL_CODES) {
      expect(isInfrastructureFatalCode(code)).toBe(true);
    }
  });
});

describe('reverse audit: host misconfiguration cannot crash the parser', () => {
  it('refuses deeply nested input even when the host quota is absurdly large', async () => {
    const harness = createHarness({ quotas: { nestingDepth: Number.MAX_SAFE_INTEGER } });
    const depth = 20_000;
    const text = `{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[],"deep":${'['.repeat(depth)}${']'.repeat(depth)}}`;
    const result = await harness.compiler.compileAndActivate(candidate(text));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A structural ceiling applies regardless of configuration, and the failure stays a candidate error.
    expect(result.halted).toBe('candidate');
    expect(result.diagnostics.map((item) => item.code)).toContain('E_QUOTA_NESTING_DEPTH');
  });
});
