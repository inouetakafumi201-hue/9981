/**
 * 任务 3.3 验收测试：禁止执行构造的语义门禁。
 *
 * 重点验证两个方向，缺一不可：
 * - **不漏报**：效果位置上的执行请求必须被拒绝，且带精确 JSON path 与 span。
 * - **不误报**：自由文本里出现同名单词、以及本引擎**已登记**的声明式效果（`while`+`maxIter`、`set`），
 *   都必须通过。这是初稿关键字黑名单被作废的直接原因。
 */
import { describe, expect, it, vi } from 'vitest';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog';
import { createDiagnosticFactory } from '../../diagnostics/factory';
import { candidateFromText, createCandidateSource } from '../../model/candidate';
import { QUOTA_KINDS } from '../../model/quota-types';
import type { TrustedQuotaProfile } from '../../model/quota-types';
import type { ParsedCandidateDocument } from '../../model/json-ast';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway';
import { UNAVAILABLE_PROVIDER_ID } from '../../ports/availability';
import { createQuotaBudget } from '../../quota/quota-budget';
import { createStrictJsonDecoder } from '../strict-json-decoder';
import { createProhibitedConstructGate } from '../prohibited-construct-gate';
import type { EffectContractView, MemberVerdict } from '../prohibited-construct-gate';

const factory = createDiagnosticFactory(createDiagnosticCodeCatalog(sha256FingerprintGateway));
const decoder = createStrictJsonDecoder(factory);

function budget(): ReturnType<typeof createQuotaBudget> {
  const base: Record<string, unknown> = { profileId: 'p1', version: 'v1' };
  for (const kind of QUOTA_KINDS) base[kind] = 10_000;
  return createQuotaBudget(base as unknown as TrustedQuotaProfile);
}

const source = createCandidateSource({
  kind: 'hand-authored',
  documentId: 'doc-1',
  packageId: 'pkg-1',
  sourceName: 'a.json',
  receivedAtSequence: 1,
});

function parse(text: string): ParsedCandidateDocument {
  const decoded = decoder.decode(candidateFromText(source, 'base-layer', text), budget());
  if (!decoded.ok) {
    throw new Error(`fixture failed to decode: ${decoded.diagnostics.map((d) => d.code).join(',')}`);
  }
  return decoded.value;
}

/**
 * 一个可信效果契约替身。它按"成员名 + 是否在自由文本区域"裁定，
 * 模拟真实上游 Schema 会做的事，但判定权始终在契约一侧，不在 UGC。
 */
function contract(options: {
  readonly executionMembers?: Readonly<Record<string, MemberVerdict>>;
  readonly freeTextPrefixes?: readonly string[];
}): EffectContractView {
  const executionMembers = options.executionMembers ?? {};
  const freeTextPrefixes = options.freeTextPrefixes ?? ['/description', '/name', '/localization'];
  return {
    providerId: 'test.effect-contract',
    contractVersion: 'v1',
    classifyMember(_jsonPath: string, memberName: string): MemberVerdict {
      return executionMembers[memberName] ?? { kind: 'admitted' };
    },
    isFreeTextRegion(jsonPath: string): boolean {
      return freeTextPrefixes.some((prefix) => jsonPath.startsWith(prefix));
    },
  };
}

describe('Feature: wakeup-ugc, Task 3.3: rejects execution requests at effect positions', () => {
  it('rejects a code-string evaluation request with a precise json path and span', () => {
    const gate = createProhibitedConstructGate(
      factory,
      contract({ executionMembers: { eval: { kind: 'execution-request', detail: 'code-string-evaluation' } } }),
    );
    const document = parse('{"schemaVersion":"1.0.0","effects":[{"eval":"drop(player)"}]}');
    const diagnostics = gate.scan(document, budget());

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('E_LOAD_PROHIBITED_CONSTRUCT');
    expect(diagnostics[0]?.path).toBe('/effects/0/eval');
    expect(diagnostics[0]?.sourceSpan).not.toBeNull();
    expect(diagnostics[0]?.severity).toBe('error');
  });

  it('rejects each execution request kind', () => {
    const kinds = [
      'function-definition',
      'imperative-loop',
      'variable-assignment',
      'external-command',
      'script-payload',
    ] as const;
    for (const detail of kinds) {
      const gate = createProhibitedConstructGate(
        factory,
        contract({ executionMembers: { danger: { kind: 'execution-request', detail } } }),
      );
      const diagnostics = gate.scan(parse('{"schemaVersion":"1.0.0","effects":[{"danger":1}]}'), budget());
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.actual).toBe(detail);
    }
  });

  it('rejects an unregistered expression language with its own condition', () => {
    const gate = createProhibitedConstructGate(
      factory,
      contract({
        executionMembers: {
          expr: { kind: 'unregistered-expression-language', language: 'javascript' },
        },
      }),
    );
    const diagnostics = gate.scan(parse('{"schemaVersion":"1.0.0","cond":{"expr":"a>b"}}'), budget());
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('E_LOAD_PROHIBITED_CONSTRUCT');
    expect(diagnostics[0]?.actual).toBe('javascript');
    expect(diagnostics[0]?.reason).toContain('javascript');
  });

  it('finds requests nested deep inside arrays and objects', () => {
    const gate = createProhibitedConstructGate(
      factory,
      contract({ executionMembers: { exec: { kind: 'execution-request', detail: 'external-command' } } }),
    );
    const document = parse('{"schemaVersion":"1.0.0","a":[[{"b":{"c":[{"exec":"rm -rf /"}]}}]]}');
    const diagnostics = gate.scan(document, budget());
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.path).toBe('/a/0/0/b/c/0/exec');
  });

  it('reports every independent finding rather than stopping at the first', () => {
    const gate = createProhibitedConstructGate(
      factory,
      contract({ executionMembers: { eval: { kind: 'execution-request', detail: 'code-string-evaluation' } } }),
    );
    const document = parse('{"schemaVersion":"1.0.0","x":{"eval":"1"},"y":{"eval":"2"}}');
    const diagnostics = gate.scan(document, budget());
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((entry) => entry.path).sort()).toEqual(['/x/eval', '/y/eval']);
  });
});

describe('Feature: wakeup-ugc, Task 3.3: no false positives (why the keyword blacklist was scrapped)', () => {
  it('accepts the same word appearing in free-text description', () => {
    const gate = createProhibitedConstructGate(
      factory,
      contract({ executionMembers: { eval: { kind: 'execution-request', detail: 'code-string-evaluation' } } }),
    );
    // 描述文本里出现 eval / exec / function 等词完全合法（需求 2.4 的"不得误报"）。
    const document = parse(
      '{"schemaVersion":"1.0.0","description":"用 eval 之力开门，exec 一段咒语，function 才是关键"}',
    );
    expect(gate.scan(document, budget())).toEqual([]);
  });

  it('skips an entire free-text subtree, including nested objects', () => {
    const gate = createProhibitedConstructGate(
      factory,
      contract({ executionMembers: { eval: { kind: 'execution-request', detail: 'code-string-evaluation' } } }),
    );
    const document = parse('{"schemaVersion":"1.0.0","localization":{"zh":{"eval":"这是译文键名"}}}');
    expect(gate.scan(document, budget())).toEqual([]);
  });

  it('accepts registered declarative effects that a keyword blacklist would have rejected', () => {
    // `while` 在本引擎是已登记 Flow 构造（强制 maxIter），`set` 对应已登记的 prop.set Op。
    // 按名字拒绝它们会让完全合法的候选无法装载。
    const gate = createProhibitedConstructGate(factory, contract({}));
    const document = parse(
      '{"schemaVersion":"1.0.0","effects":[{"while":{"cond":true},"maxIter":5},{"set":{"path":"hp","value":3}},{"for":1},{"function":2}]}',
    );
    expect(gate.scan(document, budget())).toEqual([]);
  });

  it('treats an unknown member as not-an-execution-request and leaves it to the validator', () => {
    // unknown-member 归上游 Definition Validator 报 E_LOAD_UNKNOWN_FIELD，不是本门禁的职责。
    const gate = createProhibitedConstructGate(factory, {
      providerId: 'test.effect-contract',
      contractVersion: 'v1',
      classifyMember: () => ({ kind: 'unknown-member' }),
      isFreeTextRegion: () => false,
    });
    expect(gate.scan(parse('{"schemaVersion":"1.0.0","mystery":1}'), budget())).toEqual([]);
  });

  it('never executes any candidate string while deciding validity', () => {
    const classifyMember = vi.fn((): MemberVerdict => ({ kind: 'admitted' }));
    const gate = createProhibitedConstructGate(factory, {
      providerId: 'test.effect-contract',
      contractVersion: 'v1',
      classifyMember,
      isFreeTextRegion: () => false,
    });
    const document = parse('{"schemaVersion":"1.0.0","payload":"globalThis.hacked = true"}');
    expect(gate.scan(document, budget())).toEqual([]);
    expect((globalThis as Record<string, unknown>)['hacked']).toBeUndefined();
    // 契约只被查询，字符串从未被求值。
    expect(classifyMember).toHaveBeenCalled();
  });
});

describe('Feature: wakeup-ugc, Task 3.3: what exactly the contract is asked', () => {
  /**
   * 契约的两个查询各自收到什么，必须被钉住。
   *
   * 为什么单独测：前面的用例都用"按成员名裁定"的替身，完全忽略 path 参数。
   * 那样的替身在实现把 path 传错（传根路径、传成员名）时依然给出同样裁定，
   * 断言照样通过——位置语义就此空转。这里改为断言**实参本身**。
   */
  it('asks classifyMember with the containing object path plus the bare member name', () => {
    const seen: { path: string; name: string }[] = [];
    const gate = createProhibitedConstructGate(factory, {
      providerId: 'test.effect-contract',
      contractVersion: 'v1',
      classifyMember(jsonPath, memberName) {
        seen.push({ path: jsonPath, name: memberName });
        return { kind: 'admitted' };
      },
      isFreeTextRegion: () => false,
    });
    gate.scan(parse('{"schemaVersion":"1.0.0","effects":[{"eval":"x"}]}'), budget());

    // 根成员用 '/' 表示所在对象，而不是空串。
    expect(seen).toContainEqual({ path: '/', name: 'schemaVersion' });
    expect(seen).toContainEqual({ path: '/', name: 'effects' });
    // 关键：eval 的所在对象是 /effects/0，成员名是裸名 'eval'（不是完整路径）。
    expect(seen).toContainEqual({ path: '/effects/0', name: 'eval' });
    expect(seen.map((entry) => entry.name)).not.toContain('/effects/0/eval');
  });

  it('asks isFreeTextRegion with the full member path, not the containing object path', () => {
    const seen: string[] = [];
    const gate = createProhibitedConstructGate(factory, {
      providerId: 'test.effect-contract',
      contractVersion: 'v1',
      classifyMember: () => ({ kind: 'admitted' }),
      isFreeTextRegion(jsonPath) {
        seen.push(jsonPath);
        return false;
      },
    });
    gate.scan(parse('{"schemaVersion":"1.0.0","effects":[{"eval":"x"}]}'), budget());
    expect(seen).toContain('/effects/0/eval');
  });

  it('lets position decide: the same member name is admitted in one place and rejected in another', () => {
    // 这是"位置是判定核心"的最小证明：同一个名字 `run`，两处不同裁定。
    const gate = createProhibitedConstructGate(factory, {
      providerId: 'test.effect-contract',
      contractVersion: 'v1',
      classifyMember(jsonPath, memberName) {
        if (memberName !== 'run') return { kind: 'admitted' };
        return jsonPath === '/effects/0'
          ? { kind: 'execution-request', detail: 'script-payload' }
          : { kind: 'admitted' };
      },
      isFreeTextRegion: () => false,
    });
    const document = parse('{"schemaVersion":"1.0.0","effects":[{"run":1}],"meta":{"run":1}}');
    const diagnostics = gate.scan(document, budget());

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.path).toBe('/effects/0/run');
  });

  it('anchors the finding at the member name, not at its value', () => {
    const text = '{"schemaVersion":"1.0.0","effects":[{"eval":"AAAAAAAA"}]}';
    const gate = createProhibitedConstructGate(
      factory,
      contract({ executionMembers: { eval: { kind: 'execution-request', detail: 'code-string-evaluation' } } }),
    );
    const span = gate.scan(parse(text), budget())[0]?.sourceSpan;
    if (span === null || span === undefined) throw new Error('expected a source span');

    // 从原文按 span 偏移切回来，证明锚点落在成员名上。值 "AAAAAAAA" 长度不同，切错必然露馅。
    expect(text.slice(span.start.offset, span.end.offset)).toBe('"eval"');
  });

  it('escapes JSON Pointer tokens so a member name containing "/" stays unambiguous', () => {
    const gate = createProhibitedConstructGate(
      factory,
      contract({ executionMembers: { eval: { kind: 'execution-request', detail: 'code-string-evaluation' } } }),
    );
    // 两个结构完全不同的候选：成员名带斜杠 vs 真正的两层嵌套。
    const slashInName = gate.scan(parse('{"schemaVersion":"1.0.0","a/b":{"eval":1}}'), budget());
    const realNesting = gate.scan(parse('{"schemaVersion":"1.0.0","a":{"b":{"eval":1}}}'), budget());

    expect(slashInName[0]?.path).toBe('/a~1b/eval');
    expect(realNesting[0]?.path).toBe('/a/b/eval');
    // 不转义时两者都会是 /a/b/eval，路径就无法定位到真实成员。
    expect(slashInName[0]?.path).not.toBe(realNesting[0]?.path);
  });

  it('escapes "~" in member names', () => {
    const gate = createProhibitedConstructGate(
      factory,
      contract({ executionMembers: { eval: { kind: 'execution-request', detail: 'code-string-evaluation' } } }),
    );
    const diagnostics = gate.scan(parse('{"schemaVersion":"1.0.0","a~b":{"eval":1}}'), budget());
    expect(diagnostics[0]?.path).toBe('/a~0b/eval');
  });
});

describe('Feature: wakeup-ugc, Task 3.3: fail-closed and bounded', () => {
  it('fails closed with unresolved contract when the effect contract is unavailable', () => {
    const gate = createProhibitedConstructGate(factory, {
      providerId: UNAVAILABLE_PROVIDER_ID,
      contractVersion: UNAVAILABLE_PROVIDER_ID,
      classifyMember: () => ({ kind: 'admitted' }),
      isFreeTextRegion: () => false,
    });
    const diagnostics = gate.scan(parse('{"schemaVersion":"1.0.0"}'), budget());
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
    // 关键：不得在契约缺失时给出"合法"结论。
    expect(diagnostics[0]?.severity).toBe('error');
  });

  it('terminates on quota exhaustion without claiming the candidate is clean', () => {
    const tiny: Record<string, unknown> = { profileId: 'p1', version: 'v1' };
    for (const kind of QUOTA_KINDS) tiny[kind] = 10_000;
    tiny['traversalWork'] = 1;
    const gate = createProhibitedConstructGate(factory, contract({}));
    const diagnostics = gate.scan(
      parse('{"schemaVersion":"1.0.0","a":{"b":{"c":{"d":1}}}}'),
      createQuotaBudget(tiny as unknown as TrustedQuotaProfile),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('E_QUOTA_TRAVERSAL_WORK');
  });

  it('handles deep nesting iteratively without a stack overflow', () => {
    const depth = 4000;
    const text = `{"schemaVersion":"1.0.0","deep":${'['.repeat(depth)}1${']'.repeat(depth)}}`;
    const deepBudget: Record<string, unknown> = { profileId: 'p1', version: 'v1' };
    for (const kind of QUOTA_KINDS) deepBudget[kind] = 10_000_000;
    const decoded = decoder.decode(
      candidateFromText(source, 'base-layer', text),
      createQuotaBudget(deepBudget as unknown as TrustedQuotaProfile),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const gate = createProhibitedConstructGate(factory, contract({}));
    expect(() =>
      gate.scan(decoded.value, createQuotaBudget(deepBudget as unknown as TrustedQuotaProfile)),
    ).not.toThrow();
  });
});
