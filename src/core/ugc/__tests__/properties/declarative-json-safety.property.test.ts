/**
 * Feature: wakeup-ugc, Property 2: Declarative JSON safety.
 *
 * 对任意字节序列，结构化解码要么在配额内产出有限、保留 span 的 JSON AST，要么产出结构化拒绝；
 * 重复成员、非法语法、非有限数字与禁止语义执行构造永远到不了激活，且永不被执行。
 *
 * **Validates: Requirement 2**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness.js';
import { arbitraryBytes, candidateForPattern, requestFrom } from '../../testing/generators.js';
import { rejectionFacts } from '../../testing/observer.js';
import { createCandidateChangeRequest, createCandidateDocument, createCandidateSource } from '../../model/candidate.js';

const source = createCandidateSource({
  kind: 'hand-authored',
  documentId: 'doc-1',
  packageId: 'pkg-1',
  sourceName: 'bytes.json',
  receivedAtSequence: 1,
});

function bytesRequest(bytes: Uint8Array) {
  return createCandidateChangeRequest({
    operation: 'add',
    document: createCandidateDocument(source, 'base-layer', bytes),
  });
}

describe('Feature: wakeup-ugc, Property 2: declarative JSON safety', () => {
  it('for any byte sequence, yields a bounded AST or a structured rejection and never throws', () => {
    const harness = createHarness();
    fc.assert(
      fc.property(arbitraryBytes(), (bytes) => {
        const report = harness.facade.validate(bytesRequest(bytes));
        // 二分：要么进入了验证/拒绝流程，要么产出产物；两种情况都不得抛异常。
        if (report.status === 'rejected') {
          const facts = rejectionFacts(report);
          expect(facts.hasBlocking).toBe(true);
          expect(facts.noArtifact).toBe(true);
        } else {
          expect(report.candidateFingerprint).not.toBeNull();
        }
        expect(harness.registry.calls.activate).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it('never executes candidate strings while deciding validity', () => {
    const harness = createHarness();
    const marker = '__ugc_property2_executed__';
    const globals = globalThis as unknown as Record<string, unknown>;
    delete globals[marker];

    const payloads = [
      `globalThis["${marker}"] = true`,
      `process.exit(1)`,
      `require('node:fs')`,
      `(() => { globalThis["${marker}"] = true; })()`,
    ];
    for (const payload of payloads) {
      const text = JSON.stringify({ schemaVersion: '1.0.0', description: payload, note: payload });
      harness.facade.validate(requestFrom(text, 'hand-authored'));
    }
    expect(globals[marker]).toBeUndefined();
  });

  it('rejects duplicate members, invalid syntax, nonfinite numbers and invalid UTF-8 before activation', () => {
    const patterns = ['duplicate-member', 'json-syntax', 'nonfinite-number', 'invalid-utf8'] as const;
    for (const pattern of patterns) {
      const harness = createHarness();
      const generated = candidateForPattern(pattern);
      const report =
        generated.bytes === null
          ? harness.facade.validate(requestFrom(generated.text, 'hand-authored'))
          : harness.facade.validate(bytesRequest(generated.bytes));

      const facts = rejectionFacts(report);
      expect(facts.rejected).toBe(true);
      expect(facts.hasBlocking).toBe(true);
      expect(facts.noArtifact).toBe(true);
      expect(harness.registry.calls.activate).toBe(0);
    }
  });

  it('rejects a prohibited execution construct at an effect position with a locating diagnostic', () => {
    const harness = createHarness();
    const generated = candidateForPattern('prohibited-construct');
    const report = harness.facade.validate(requestFrom(generated.text, 'hand-authored'));
    const prohibited = report.diagnostics.filter((entry) => entry.code === 'E_LOAD_PROHIBITED_CONSTRUCT');
    expect(prohibited.length).toBeGreaterThan(0);
    expect(prohibited[0]?.path).toBe('/effects/0/eval');
  });

  it('reports a source span for every syntax rejection', () => {
    const harness = createHarness();
    fc.assert(
      fc.property(
        fc.constantFrom('{', '[', '{"a"', '{"a":}', '[1,]', '{,}', 'tru', '01', '1.', '"unclosed'),
        (fragment) => {
          const report = harness.facade.validate(requestFrom(fragment, 'hand-authored'));
          expect(report.status).toBe('rejected');
          const syntax = report.diagnostics.find((entry) => entry.code === 'E_LOAD_JSON_SYNTAX');
          if (syntax !== undefined) {
            expect(syntax.sourceSpan).not.toBeNull();
            expect(syntax.sourceSpan?.start.offset).toBeGreaterThanOrEqual(0);
            // document scope 不得编造 definition 标识（需求 14.4）。
            expect(syntax.at).toBeNull();
            expect(syntax.path).toBeNull();
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});
