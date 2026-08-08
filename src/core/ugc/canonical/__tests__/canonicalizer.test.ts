/**
 * 任务 4.3 验收测试：确定性规范化、往返、字节幂等、语义顺序保留、无序集合唯一性。
 */
import { describe, expect, it } from 'vitest';
import type { MigratedCandidateDocument } from '../../model/json-ast.js';
import { createUnavailableSchemaVersionCatalog } from '../../ports/unavailable.js';
import type { CanonicalizationSchemaView } from '../../ports/schema-ports.js';
import { createCanonicalizationGateway } from '../canonicalizer.js';
import {
  budget,
  canonicalSchema,
  catalogFactory,
  fingerprint,
  parse,
} from '../../migration/__tests__/fixtures.js';

function migrated(text: string): MigratedCandidateDocument {
  const document = parse(text);
  return { ...document, originalSchemaVersion: document.schemaVersion, appliedMigrationIds: [] };
}

function canonicalize(text: string, schema: CanonicalizationSchemaView = canonicalSchema()) {
  const gateway = createCanonicalizationGateway({ schema, fingerprint, factory: catalogFactory });
  return gateway.canonicalize(migrated(text), budget());
}

function json(text: string, schema?: CanonicalizationSchemaView): string {
  const result = canonicalize(text, schema);
  if (!result.ok) throw new Error(`unexpected rejection: ${result.diagnostics.map((d) => d.code).join(',')}`);
  return result.value.canonicalJson;
}

describe('Feature: wakeup-ugc, Task 4.3: deterministic key ordering', () => {
  it('orders object keys by Unicode code point, independent of input order', () => {
    const a = json('{"schemaVersion":"1.0.0","b":1,"a":2}');
    const b = json('{"a":2,"schemaVersion":"1.0.0","b":1}');
    expect(a).toBe(b);
    expect(a.indexOf('"a"')).toBeLessThan(a.indexOf('"b"'));
    expect(a.indexOf('"b"')).toBeLessThan(a.indexOf('"schemaVersion"'));
  });

  it('places BMP-outside keys after all BMP keys', () => {
    const output = json('{"schemaVersion":"1.0.0","\u{1F600}":1,"\uFFFD":2}');
    expect(output.indexOf('\uFFFD')).toBeLessThan(output.indexOf('\u{1F600}'));
  });

  it('normalises whitespace differences to identical bytes', () => {
    const compact = json('{"schemaVersion":"1.0.0","a":[1,2]}');
    const spaced = json('{\n  "schemaVersion" : "1.0.0" ,\n  "a" : [ 1 , 2 ]\n}');
    expect(spaced).toBe(compact);
  });

  it('emits no whitespace, timestamp, random id or host path', () => {
    const output = json('{"schemaVersion":"1.0.0","a":1}');
    expect(output).toBe('{"a":1,"schemaVersion":"1.0.0"}');
  });
});

describe('Feature: wakeup-ugc, Task 4.3: number and string canonical form', () => {
  it('normalises equivalent numeric spellings to one form', () => {
    expect(json('{"schemaVersion":"1.0.0","n":1.0}')).toBe(json('{"schemaVersion":"1.0.0","n":1}'));
    expect(json('{"schemaVersion":"1.0.0","n":1e2}')).toBe(json('{"schemaVersion":"1.0.0","n":100}'));
    expect(json('{"schemaVersion":"1.0.0","n":-0}')).toContain('"n":0');
  });

  it('escapes only what JSON requires and keeps non-ASCII literal', () => {
    const output = json('{"schemaVersion":"1.0.0","s":"中\\n\\"x\\\\y\\u0001"}');
    expect(output).toContain('中');
    expect(output).toContain('\\n');
    expect(output).toContain('\\"');
    expect(output).toContain('\\\\');
    expect(output).toContain('\\u0001');
    // 非 ASCII 不做 \u 转义，否则同一字符会有两种合法写法，规范形式就不唯一。
    expect(output).not.toContain('\\u4e2d');
  });

  it('normalises an escaped surrogate pair to the literal character', () => {
    expect(json('{"schemaVersion":"1.0.0","s":"\\ud83d\\ude00"}')).toBe(
      json('{"schemaVersion":"1.0.0","s":"\u{1F600}"}'),
    );
  });
});

describe('Feature: wakeup-ugc, Task 4.3: round trip and byte idempotence', () => {
  it('is byte-identical when canonicalizing canonical output again', () => {
    const first = json('{"schemaVersion":"1.0.0","b":[3,1,2],"a":{"z":1,"y":2}}');
    const second = json(first);
    expect(second).toBe(first);
    const third = json(second);
    expect(third).toBe(second);
  });

  it('parse-canonicalize-parse yields an equivalent definition', () => {
    const original = '{"schemaVersion":"1.0.0","a":[1,{"b":true,"c":null}],"d":"x"}';
    const canonical = json(original);
    expect(JSON.parse(canonical)).toEqual(JSON.parse(original));
  });

  it('produces a decodedValue that exactly matches the canonical bytes', () => {
    const result = canonicalize('{"schemaVersion":"1.0.0","a":[1,2],"b":{"c":1}}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decodedValue).toEqual(JSON.parse(result.value.canonicalJson));
  });

  it('derives the fingerprint from canonical content only', () => {
    const compact = canonicalize('{"schemaVersion":"1.0.0","a":1}');
    const spaced = canonicalize('{  "a" : 1 , "schemaVersion" : "1.0.0"  }');
    expect(compact.ok && spaced.ok).toBe(true);
    if (!compact.ok || !spaced.ok) return;
    expect(spaced.value.canonicalFingerprint).toBe(compact.value.canonicalFingerprint);

    const different = canonicalize('{"schemaVersion":"1.0.0","a":2}');
    if (!different.ok) return;
    expect(different.value.canonicalFingerprint).not.toBe(compact.value.canonicalFingerprint);
  });
});

describe('Feature: wakeup-ugc, Task 4.3: array order is semantic by default', () => {
  it('preserves a differing semantic array order', () => {
    const ascending = json('{"schemaVersion":"1.0.0","steps":[1,2,3]}');
    const descending = json('{"schemaVersion":"1.0.0","steps":[3,2,1]}');
    expect(ascending).not.toBe(descending);
    expect(ascending).toContain('[1,2,3]');
    expect(descending).toContain('[3,2,1]');
  });

  it('sorts only a collection the schema explicitly declares unordered', () => {
    const schema = canonicalSchema({
      unorderedPaths: ['/tags'],
      identities: { '/tags': ['b', 'a', 'c'] },
    });
    const output = json('{"schemaVersion":"1.0.0","tags":["second","first","third"]}', schema);
    // 身份 a<b<c，对应下标 1,0,2 → 输出顺序 first, second, third。
    expect(output).toContain('["first","second","third"]');
  });

  it('normalises permutations of an unordered collection to identical bytes', () => {
    const schemaOne = canonicalSchema({ unorderedPaths: ['/tags'], identities: { '/tags': ['a', 'b'] } });
    const schemaTwo = canonicalSchema({ unorderedPaths: ['/tags'], identities: { '/tags': ['b', 'a'] } });
    expect(json('{"schemaVersion":"1.0.0","tags":["x","y"]}', schemaOne)).toBe(
      json('{"schemaVersion":"1.0.0","tags":["y","x"]}', schemaTwo),
    );
  });

  it('rejects an unordered collection whose element has no stable identity', () => {
    const schema = canonicalSchema({ unorderedPaths: ['/tags'], identities: { '/tags': ['a', null] } });
    const result = canonicalize('{"schemaVersion":"1.0.0","tags":["x","y"]}', schema);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_CANONICAL_AMBIGUOUS');
    expect(result.diagnostics[0]?.path).toBe('/tags/1');
  });

  it('rejects duplicate semantic identities in an unordered collection', () => {
    const schema = canonicalSchema({ unorderedPaths: ['/tags'], identities: { '/tags': ['a', 'a'] } });
    const result = canonicalize('{"schemaVersion":"1.0.0","tags":["x","y"]}', schema);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_CANONICAL_AMBIGUOUS');
    expect(result.diagnostics[0]?.reason).toContain('重复');
  });
});

describe('Feature: wakeup-ugc, Task 4.3: bounded output and fail-closed schema', () => {
  it('reports the output-bytes quota rather than emitting an unbounded string', () => {
    const gateway = createCanonicalizationGateway({
      schema: canonicalSchema(),
      fingerprint,
      factory: catalogFactory,
    });
    const result = gateway.canonicalize(migrated('{"schemaVersion":"1.0.0","a":"xxxxxxxxxx"}'), budget({ outputBytes: 5 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_QUOTA_OUTPUT_BYTES');
  });

  it('handles deep nesting iteratively without a stack overflow', () => {
    const depth = 3000;
    const text = `{"schemaVersion":"1.0.0","deep":${'['.repeat(depth)}1${']'.repeat(depth)}}`;
    expect(() => json(text)).not.toThrow();
  });

  it('fails closed when the canonicalization schema view is unmerged', () => {
    const gateway = createCanonicalizationGateway({
      schema: createUnavailableSchemaVersionCatalog() as unknown as CanonicalizationSchemaView,
      fingerprint,
      factory: catalogFactory,
    });
    const result = gateway.canonicalize(migrated('{"schemaVersion":"1.0.0"}'), budget());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
  });
});
