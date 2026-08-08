/**
 * 受限 Test Interface：候选生成器（design.md「Test and trace reachability」/ 需求 16.1-16.16；tasks.md 9.2）。
 *
 * 约束（design.md Testing strategy 明确要求）：
 * - 生成器只产出**候选字节**，不能铸造验证产物、不能改写注册表、不能跳过配额记账；
 * - 观察必须通过生产入口，因此这里不导出任何内部阶段的直连句柄；
 * - 故障注入是"在已登记端口上做依赖注入"，不是在生产代码里加来源专用分支。
 */
import fc from 'fast-check';
import type { CandidateChangeRequest, CandidateSourceKind, TargetOwnership } from '../model/candidate.js';
import { createCandidateChangeRequest, createCandidateSource } from '../model/candidate.js';
import { ALL_ADAPTERS } from '../adapter/adapters.js';
import { SCHEMA_VERSION_MEMBER } from '../codec/strict-json-decoder.js';

/** 候选缺陷模式。枚举它保证需求 16.3-16.10 的每一类都有生成器覆盖。 */
export const INVALID_PATTERNS = [
  'json-syntax',
  'duplicate-member',
  'nonfinite-number',
  'invalid-utf8',
  'missing-schema-version',
  'prohibited-construct',
  'unknown-field',
  'duplicate-id',
  'numeric-out-of-range',
  'layer-violation',
  'reference-missing',
  'inheritance-cycle',
  'deep-nesting',
  'wide-object',
  'unsupported-version',
  'semantic-damage',
  'stale-baseline',
] as const;

export type InvalidPattern = (typeof INVALID_PATTERNS)[number];

export interface GeneratedCandidate {
  readonly text: string;
  readonly bytes: Uint8Array | null;
  readonly pattern: InvalidPattern | 'valid';
}

export function validCandidateText(overrides: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    [SCHEMA_VERSION_MEMBER]: '1.0.0',
    id: 'weapon:shotgun',
    kind: 'weapon-class',
    ...overrides,
  });
}

/** 任意合法候选。键顺序与空白随机，用于验证规范化归一。 */
export function arbitraryValidCandidate(): fc.Arbitrary<GeneratedCandidate> {
  return fc
    .record({
      id: fc.stringMatching(/^[a-z]{3,8}:[a-z]{3,8}$/),
      count: fc.integer({ min: 1, max: 5 }),
      tag: fc.stringMatching(/^[a-z]{1,10}$/),
    })
    .map((fields) => ({
      text: validCandidateText({ id: fields.id, count: fields.count, tag: fields.tag }),
      bytes: null,
      pattern: 'valid' as const,
    }));
}

/** 针对某个缺陷模式产出候选。返回的 `bytes` 非空时表示该模式必须用原始字节表达。 */
export function candidateForPattern(pattern: InvalidPattern): GeneratedCandidate {
  switch (pattern) {
    case 'json-syntax':
      return { text: '{"schemaVersion":', bytes: null, pattern };
    case 'duplicate-member':
      return { text: '{"schemaVersion":"1.0.0","id":"a","id":"b"}', bytes: null, pattern };
    case 'nonfinite-number':
      // 直接构造文本，不写数值字面量：`1e999` 作为 JS 字面量会触发 no-loss-of-precision，
      // 而我们要的正是"语法合法但求值为 Infinity"的原始 JSON 文本。
      return { text: '{"schemaVersion":"1.0.0","big":1e999}', bytes: null, pattern };
    case 'invalid-utf8':
      return { text: '', bytes: new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]), pattern };
    case 'missing-schema-version':
      return { text: '{"id":"weapon:shotgun"}', bytes: null, pattern };
    case 'prohibited-construct':
      return { text: JSON.stringify({ schemaVersion: '1.0.0', effects: [{ eval: 'drop()' }] }), bytes: null, pattern };
    case 'unknown-field':
      return { text: validCandidateText({ mysteryField: 1 }), bytes: null, pattern };
    case 'duplicate-id':
      return { text: validCandidateText({ duplicates: ['weapon:shotgun', 'weapon:shotgun'] }), bytes: null, pattern };
    case 'numeric-out-of-range':
      return { text: validCandidateText({ damage: 9 }), bytes: null, pattern };
    case 'layer-violation':
      return { text: validCandidateText({ victoryCondition: 'last-standing' }), bytes: null, pattern };
    case 'reference-missing':
      return { text: validCandidateText({ uses: 'weapon:missing' }), bytes: null, pattern };
    case 'inheritance-cycle':
      return { text: validCandidateText({ extends: ['weapon:shotgun'] }), bytes: null, pattern };
    case 'deep-nesting':
      return { text: `{"schemaVersion":"1.0.0","deep":${'['.repeat(200)}1${']'.repeat(200)}}`, bytes: null, pattern };
    case 'wide-object': {
      const members = Array.from({ length: 400 }, (_value, index) => `"k${String(index)}":${String(index)}`).join(',');
      return { text: `{"schemaVersion":"1.0.0",${members}}`, bytes: null, pattern };
    }
    case 'unsupported-version':
      return { text: '{"schemaVersion":"9.9.9","id":"weapon:shotgun"}', bytes: null, pattern };
    case 'semantic-damage':
      return { text: validCandidateText({ icon: null }), bytes: null, pattern };
    case 'stale-baseline':
      return { text: validCandidateText(), bytes: null, pattern };
  }
}

/** 恶意字节序列：任意字节、含代理对、含控制字符。用于 Property 2 的"任意字节"要求。 */
export function arbitraryBytes(): fc.Arbitrary<Uint8Array> {
  return fc.uint8Array({ minLength: 0, maxLength: 96 });
}

/** 深/宽结构生成器，用于资源炸弹属性。 */
export function arbitraryBomb(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.integer({ min: 1, max: 400 }).map((depth) => `{"schemaVersion":"1.0.0","d":${'['.repeat(depth)}1${']'.repeat(depth)}}`),
    fc.integer({ min: 1, max: 400 }).map((depth) => `{"schemaVersion":"1.0.0","d":${'{"n":'.repeat(depth)}1${'}'.repeat(depth)}}`),
    fc.integer({ min: 1, max: 600 }).map((width) => {
      const members = Array.from({ length: width }, (_v, index) => `"k${String(index)}":${String(index)}`).join(',');
      return `{"schemaVersion":"1.0.0",${members}}`;
    }),
    fc.integer({ min: 1, max: 600 }).map((width) => `{"schemaVersion":"1.0.0","a":[${Array.from({ length: width }, () => '1').join(',')}]}`),
  );
}

export function sourceKindArbitrary(): fc.Arbitrary<CandidateSourceKind> {
  return fc.constantFrom(...ALL_ADAPTERS.map((adapter) => adapter.sourceKind));
}

/** 用指定来源种类构造请求。等价字节在不同来源下必须得到等价结果（需求 3.10）。 */
export function requestFrom(
  text: string,
  sourceKind: CandidateSourceKind,
  target: TargetOwnership = 'base-layer',
  documentId = 'doc-1',
): CandidateChangeRequest {
  const adapter = ALL_ADAPTERS.find((entry) => entry.sourceKind === sourceKind) ?? ALL_ADAPTERS[0];
  if (adapter === undefined) throw new Error('no adapter registered');
  const document = adapter.toCandidate(
    text,
    createCandidateSource({
      kind: sourceKind,
      documentId,
      packageId: 'pkg-1',
      sourceName: 'gen.json',
      receivedAtSequence: 1,
    }),
    target,
  );
  return createCandidateChangeRequest({ operation: 'add', document });
}
