/**
 * 严格 JSON 解码器测试（tasks.md 3.2；需求 2.1-2.3、2.8-2.10、4.1-4.4、9.2-9.5；Properties P2、P9）。
 *
 * 表驱动覆盖每一类语法错误、重复成员、Unicode、数字边界、空结构与 span 精度，
 * 再用性质测试锁定 P2（任意字节序列要么产出有界 AST，要么产出结构化拒绝）与
 * P9（配额耗尽终止遍历且不激活任何东西）。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createStrictJsonDecoder } from '../strict-json-decoder.js';
import { SCHEMA_VERSION_MEMBER } from '../strict-json-decoder.js';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog.js';
import { createDiagnosticFactory } from '../../diagnostics/factory.js';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway.js';
import { createQuotaBudget } from '../../quota/quota-budget.js';
import { candidateFromText, createCandidateDocument, createCandidateSource } from '../../model/candidate.js';
import type { JsonAst } from '../../model/json-ast.js';
import type { QuotaKind, TrustedQuotaProfile } from '../../model/quota-types.js';
import type { UgcResult } from '../../model/result.js';
import type { ParsedCandidateDocument } from '../../model/json-ast.js';
import type { Diagnostic } from '../../../kernel/state/diagnostic.js';

const catalog = createDiagnosticCodeCatalog(sha256FingerprintGateway);
const factory = createDiagnosticFactory(catalog);
const decoder = createStrictJsonDecoder(factory);

/** 宽松档案：除被测配额外都足够大，使测试只在意图中的那一项上失败。 */
const GENEROUS: TrustedQuotaProfile = Object.freeze({
  profileId: 'test-generous',
  version: '1.0.0',
  inputBytes: 1_000_000,
  nestingDepth: 64,
  objectMembers: 10_000,
  arrayElements: 10_000,
  sourceRecords: 1_000,
  astNodes: 100_000,
  definitions: 1_000,
  referenceEdges: 10_000,
  traversalWork: 10_000_000,
  diagnostics: 1_000,
  migrationSteps: 16,
  outputBytes: 1_000_000,
});

function profileWith(overrides: Partial<Record<QuotaKind, number>>): TrustedQuotaProfile {
  return Object.freeze({ ...GENEROUS, ...overrides });
}

const source = createCandidateSource({
  kind: 'hand-authored',
  documentId: 'doc:test',
  packageId: 'pkg:test',
  sourceName: 'test.json',
  receivedAtSequence: 1,
});

function decodeText(text: string, profile: TrustedQuotaProfile = GENEROUS): UgcResult<ParsedCandidateDocument> {
  return decoder.decode(candidateFromText(source, 'base-layer', text), createQuotaBudget(profile));
}

function decodeBytes(bytes: Uint8Array, profile: TrustedQuotaProfile = GENEROUS): UgcResult<ParsedCandidateDocument> {
  return decoder.decode(createCandidateDocument(source, 'base-layer', bytes), createQuotaBudget(profile));
}

/** 把被测片段包进一个带合法 schemaVersion 的根对象，使成功路径不被版本检查挡住。 */
function wrap(fragment: string): string {
  return `{"${SCHEMA_VERSION_MEMBER}":"1.0.0","payload":${fragment}}`;
}

function codesOf(result: UgcResult<unknown>): readonly string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function onlyDiagnostic(result: UgcResult<unknown>): Diagnostic {
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toHaveLength(1);
  const diagnostic = result.diagnostics[0];
  if (diagnostic === undefined) throw new Error('expected exactly one diagnostic');
  return diagnostic;
}

/** 取根对象里 `payload` 成员的值，用于断言被测片段解析成了什么。 */
function payloadOf(parsed: ParsedCandidateDocument): JsonAst {
  const ast = parsed.ast;
  if (ast.kind !== 'object') throw new Error('root is not an object');
  const member = ast.members.find((entry) => entry.key === 'payload');
  if (member === undefined) throw new Error('no payload member');
  return member.value;
}

function expectOk(result: UgcResult<ParsedCandidateDocument>): ParsedCandidateDocument {
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.diagnostics.map((d) => `${d.code}: ${d.reason}`).join('; ')}`);
  }
  return result.value;
}

describe('严格 JSON 解码器：语法错误分类（需求 2.8）', () => {
  /**
   * 每一行都是"必须被拒绝的输入"，且必须以**指定的原因**被拒绝。
   *
   * 为什么必须断言 `reason` 而不只是 code：几乎所有语法问题都映射到同一个 `E_LOAD_JSON_SYNTAX`，
   * 只断言 code 时，一个走错分支的拒绝（例如把"前导零"错报成"多余内容"）也会让断言通过。
   * 变异自检证实过这一点：注入"不拒绝前导零"缺陷后，只断言 code 的版本依然全绿。
   * `condition` 区分 syntax / trailing-content，`detail` 钉住具体诊断原因。
   */
  const SYNTAX_CASES: readonly {
    readonly name: string;
    readonly text: string;
    readonly condition: 'syntax' | 'trailing-content';
    readonly detail: string;
  }[] = [
    { name: '空对象缺闭合', text: '{', condition: 'syntax', detail: '对象尚未闭合' },
    { name: '空数组缺闭合', text: '[', condition: 'syntax', detail: '期望一个值的位置结束' },
    { name: '对象尾随逗号', text: '{"a":1,}', condition: 'syntax', detail: '对象不允许尾随逗号' },
    { name: '数组尾随逗号', text: '[1,]', condition: 'syntax', detail: '数组不允许尾随逗号' },
    { name: '成员名不是字符串', text: '{a:1}', condition: 'syntax', detail: '成员名必须是双引号' },
    { name: '成员名用单引号', text: "{'a':1}", condition: 'syntax', detail: '成员名必须是双引号' },
    { name: '缺少冒号', text: '{"a" 1}', condition: 'syntax', detail: '成员名之后必须是冒号' },
    { name: '成员缺值', text: '{"a":}', condition: 'syntax', detail: '不是合法的 JSON 值起始字符' },
    { name: '对象用 ] 结束', text: '{"a":1]', condition: 'syntax', detail: '对象必须以 } 结束' },
    { name: '数组用 } 结束', text: '[1}', condition: 'syntax', detail: '数组必须以 ] 结束' },
    { name: '意外的右方括号', text: ']', condition: 'syntax', detail: '意外的 ]' },
    { name: '意外的右花括号', text: '}', condition: 'syntax', detail: '不是合法的 JSON 值起始字符' },
    { name: '字符串未闭合', text: '"abc', condition: 'syntax', detail: '字符串尚未闭合' },
    { name: '字符串含未转义换行', text: '"a\nb"', condition: 'syntax', detail: '不允许未转义的控制字符' },
    { name: '字符串含未转义制表符', text: '"a\tb"', condition: 'syntax', detail: '不允许未转义的控制字符' },
    { name: '非法转义 \\x', text: '"\\x41"', condition: 'syntax', detail: '不是合法的转义序列' },
    { name: '非法转义 \\0', text: '"\\0"', condition: 'syntax', detail: '不是合法的转义序列' },
    { name: '非法转义单引号', text: '"\\\'"', condition: 'syntax', detail: '不是合法的转义序列' },
    { name: '\\u 后不足四位', text: '"\\u12"', condition: 'syntax', detail: '四位十六进制' },
    { name: '\\u 后含非十六进制', text: '"\\u12g4"', condition: 'syntax', detail: '四位十六进制' },
    { name: '落单高位代理项', text: '"\\uD834"', condition: 'syntax', detail: '落单的高位代理项' },
    { name: '落单低位代理项', text: '"\\uDD1E"', condition: 'syntax', detail: '落单的低位代理项' },
    { name: '高位代理项后跟普通字符', text: '"\\uD834\\u0041"', condition: 'syntax', detail: '不是合法的低位代理项' },
    { name: '数字前导零', text: '01', condition: 'syntax', detail: '数字不允许前导零' },
    { name: '负数前导零', text: '-01', condition: 'syntax', detail: '数字不允许前导零' },
    { name: '裸小数点开头', text: '.5', condition: 'syntax', detail: '不是合法的 JSON 值起始字符' },
    { name: '小数点后无数字', text: '1.', condition: 'syntax', detail: '小数部分至少需要一位数字' },
    { name: '指数后无数字', text: '1e', condition: 'syntax', detail: '指数部分至少需要一位数字' },
    { name: '指数只有符号', text: '1e+', condition: 'syntax', detail: '指数部分至少需要一位数字' },
    { name: '正号开头', text: '+1', condition: 'syntax', detail: '不是合法的 JSON 值起始字符' },
    { name: '只有负号', text: '-', condition: 'syntax', detail: '数字尚未结束时结束' },
    { name: '十六进制字面量', text: '0x10', condition: 'trailing-content', detail: '多余内容' },
    { name: 'Infinity 字面量', text: 'Infinity', condition: 'syntax', detail: '不是合法的 JSON 值起始字符' },
    { name: 'NaN 字面量', text: 'NaN', condition: 'syntax', detail: '不是合法的 JSON 值起始字符' },
    { name: '未加引号的裸词', text: 'undefined', condition: 'syntax', detail: '不是合法的 JSON 值起始字符' },
    { name: 'true 的前缀但不完整', text: 'tru', condition: 'syntax', detail: '期望字面量 true' },
    { name: 'true 后跟垃圾字符', text: 'truex', condition: 'trailing-content', detail: '多余内容' },
    { name: 'false 拼写错误', text: 'fales', condition: 'syntax', detail: '期望字面量 false' },
    { name: 'null 拼写错误', text: 'nul', condition: 'syntax', detail: '期望字面量 null' },
    { name: '注释不被接受', text: '{"a":1} // c', condition: 'trailing-content', detail: '多余内容' },
    { name: '对象内出现没有成员名的值', text: '{"a":1,2}', condition: 'syntax', detail: '成员名必须是双引号' },
    { name: '只有逗号', text: ',', condition: 'syntax', detail: '不是合法的 JSON 值起始字符' },
  ];

  for (const testCase of SYNTAX_CASES) {
    it(`拒绝 ${testCase.name}`, () => {
      const diagnostic = onlyDiagnostic(decodeText(testCase.text));
      expect(diagnostic.code).toBe('E_LOAD_JSON_SYNTAX');
      // 条件与原因都必须对上，否则"走错分支的拒绝"会冒充正确拒绝。
      expect(diagnostic.messageKey).toBe(`ugc/decode/JSON_SYNTAX/${testCase.condition}`);
      expect(diagnostic.reason).toContain(testCase.detail);
    });
  }

  it('拒绝顶层值之后的多余内容，并单列为 trailing-content', () => {
    const diagnostic = onlyDiagnostic(decodeText('{"a":1} {"b":2}'));
    expect(diagnostic.code).toBe('E_LOAD_JSON_SYNTAX');
    expect(diagnostic.messageKey).toBe('ugc/decode/JSON_SYNTAX/trailing-content');
  });

  it('空文档单列为 truncated 而不是语法错误', () => {
    const diagnostic = onlyDiagnostic(decodeText(''));
    expect(diagnostic.code).toBe('E_LOAD_INPUT_TRUNCATED');
  });

  it('只有空白的文档被拒绝', () => {
    expect(decodeText('   \n\t  ').ok).toBe(false);
  });
});

describe('严格 JSON 解码器：重复成员（需求 2.9）', () => {
  it('拒绝重复成员名，并同时给出首次与冲突两个位置', () => {
    const text = `{"${SCHEMA_VERSION_MEMBER}":"1.0.0","dup":1,"dup":2}`;
    // 期望偏移由文本自身推出，而不是手写常量：手写常量在改动样例时会静默错位。
    const firstQuote = text.indexOf('"dup"');
    const duplicateQuote = text.indexOf('"dup"', firstQuote + 1);
    expect(firstQuote).toBeGreaterThan(0);
    expect(duplicateQuote).toBeGreaterThan(firstQuote);

    const diagnostic = onlyDiagnostic(decodeText(text));
    expect(diagnostic.code).toBe('E_LOAD_DUPLICATE_MEMBER');

    // 诊断锚点指向冲突处，首次位置进 messageArgs：两个位置都必须可读，缺一不可。
    const args = diagnostic.messageArgs;
    if (args === undefined) throw new Error('duplicate diagnostic must carry both positions');
    expect(args['key']).toBe('dup');
    expect(args['firstOffset']).toBe(firstQuote);
    expect(args['duplicateOffset']).toBe(duplicateQuote);
    expect(diagnostic.sourceSpan?.start.offset).toBe(duplicateQuote);
    // 两个位置必须真的不同，否则"同时指向两处"是空话。
    expect(args['firstOffset']).not.toBe(args['duplicateOffset']);
  });

  it('重复成名在嵌套对象内同样被拒绝', () => {
    expect(decodeText(wrap('{"x":1,"x":2}')).ok).toBe(false);
  });

  it('不同对象里的同名成员合法', () => {
    const parsed = expectOk(decodeText(wrap('[{"x":1},{"x":2}]')));
    const payload = payloadOf(parsed);
    expect(payload.kind).toBe('array');
  });

  it('后值绝不静默覆盖前值：原生 JSON.parse 会接受的输入被本解码器拒绝', () => {
    const text = `{"${SCHEMA_VERSION_MEMBER}":"1.0.0","dup":1,"dup":2}`;
    // 对照组：原生 JSON.parse 接受它，并且丢掉了第一个值——这正是不能用它做首次物化的原因。
    const nativeAccepted = JSON.parse(text) as Record<string, unknown>;
    expect(nativeAccepted['dup']).toBe(2);
    // 被测实现必须拒绝。
    expect(decodeText(text).ok).toBe(false);
  });

  it('三次重复也在第二次出现时即拒绝，不继续累积诊断', () => {
    const result = decodeText(`{"${SCHEMA_VERSION_MEMBER}":"1.0.0","d":1,"d":2,"d":3}`);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe('严格 JSON 解码器：Unicode 与转义', () => {
  const ESCAPE_CASES: readonly { readonly name: string; readonly text: string; readonly expected: string }[] = [
    { name: '双引号', text: '"\\""', expected: '"' },
    { name: '反斜杠', text: '"\\\\"', expected: '\\' },
    { name: '正斜杠', text: '"\\/"', expected: '/' },
    { name: '退格', text: '"\\b"', expected: '\b' },
    { name: '换页', text: '"\\f"', expected: '\f' },
    { name: '换行', text: '"\\n"', expected: '\n' },
    { name: '回车', text: '"\\r"', expected: '\r' },
    { name: '制表', text: '"\\t"', expected: '\t' },
    { name: '\\u 基本平面', text: '"\\u0041"', expected: 'A' },
    { name: '\\u 中文', text: '"\\u4e2d"', expected: '中' },
    { name: '\\u0000 空字符可转义', text: '"\\u0000"', expected: '\u0000' },
    { name: '\\u 大写十六进制', text: '"\\uD83D\\uDE00"', expected: '😀' },
    { name: '\\u 小写十六进制', text: '"\\ud83d\\ude00"', expected: '😀' },
    { name: '代理对与普通字符混排', text: '"a\\uD834\\uDD1Eb"', expected: 'a\u{1D11E}b' },
  ];

  for (const testCase of ESCAPE_CASES) {
    it(`正确解码转义：${testCase.name}`, () => {
      const parsed = expectOk(decodeText(wrap(testCase.text)));
      const payload = payloadOf(parsed);
      expect(payload.kind).toBe('string');
      if (payload.kind !== 'string') throw new Error('unreachable');
      expect(payload.value).toBe(testCase.expected);
    });
  }

  it('原生 UTF-8 多字节字符按原样保留', () => {
    const parsed = expectOk(decodeText(wrap('"中文 😀 混排"')));
    const payload = payloadOf(parsed);
    if (payload.kind !== 'string') throw new Error('expected string');
    expect(payload.value).toBe('中文 😀 混排');
  });

  it('成员名与字符串值共用同一套转义规则', () => {
    const parsed = expectOk(decodeText(`{"${SCHEMA_VERSION_MEMBER}":"1.0.0","\\u4e2d":1}`));
    if (parsed.ast.kind !== 'object') throw new Error('expected object');
    expect(parsed.ast.members.map((entry) => entry.key)).toContain('中');
  });

  it('成员名里的非法转义同样被拒绝，不比字符串值宽松', () => {
    expect(decodeText(`{"${SCHEMA_VERSION_MEMBER}":"1.0.0","\\x41":1}`).ok).toBe(false);
  });

  it('拒绝非法 UTF-8 字节，并给出字节偏移', () => {
    // 0xFF 不是任何合法 UTF-8 序列的起始字节。
    const bytes = new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]);
    const diagnostic = onlyDiagnostic(decodeBytes(bytes));
    expect(diagnostic.code).toBe('E_LOAD_SOURCE_INVALID');
    expect(diagnostic.sourceSpan?.start.offset).toBe(2);
  });

  it('拒绝截断的 UTF-8 多字节序列', () => {
    // 0xE4 0xB8 是 '中' 的前两字节，缺第三字节。
    const bytes = new Uint8Array([0x22, 0xe4, 0xb8, 0x22]);
    expect(codesOf(decodeBytes(bytes))).toContain('E_LOAD_SOURCE_INVALID');
  });

  it('UTF-8 校验先于语法检查：非法字节不会被报成语法错误', () => {
    // 这段字节既非法编码，又在语法上不完整。必须报编码问题。
    const bytes = new Uint8Array([0x7b, 0xc0, 0x80]);
    expect(codesOf(decodeBytes(bytes))).toEqual(['E_LOAD_SOURCE_INVALID']);
  });
});

describe('严格 JSON 解码器：数字边界（需求 2.10）', () => {
  const NUMBER_CASES: readonly { readonly text: string; readonly value: number }[] = [
    { text: '0', value: 0 },
    { text: '-0', value: -0 },
    { text: '1', value: 1 },
    { text: '-1', value: -1 },
    { text: '0.0', value: 0 },
    { text: '0.5', value: 0.5 },
    { text: '-0.5', value: -0.5 },
    { text: '1e2', value: 100 },
    { text: '1E2', value: 100 },
    { text: '1e+2', value: 100 },
    { text: '1e-2', value: 0.01 },
    { text: '1.5e3', value: 1500 },
    { text: '-1.5e-3', value: -0.0015 },
    { text: '0e0', value: 0 },
    { text: '9007199254740991', value: 9_007_199_254_740_991 },
    { text: '-9007199254740991', value: -9_007_199_254_740_991 },
    { text: '1e-320', value: 1e-320 },
  ];

  for (const testCase of NUMBER_CASES) {
    it(`接受 ${testCase.text}`, () => {
      const parsed = expectOk(decodeText(wrap(testCase.text)));
      const payload = payloadOf(parsed);
      expect(payload.kind).toBe('number');
      if (payload.kind !== 'number') throw new Error('unreachable');
      expect(payload.value).toBe(testCase.value);
      // 词法原文必须原样保留，诊断才能回显作者写下的形式。
      expect(payload.lexical).toBe(testCase.text);
    });
  }

  const NONFINITE_CASES: readonly string[] = ['1e999', '-1e999', '1e1000', '2e308'];

  for (const text of NONFINITE_CASES) {
    it(`拒绝求值为非有限值的 ${text}`, () => {
      const diagnostic = onlyDiagnostic(decodeText(wrap(text)));
      expect(diagnostic.code).toBe('E_LOAD_JSON_SYNTAX');
      expect(diagnostic.messageKey).toBe('ugc/decode/JSON_SYNTAX/nonfinite-number');
      // 非有限值必须回显词法原文，而不是回显 Infinity。
      expect(diagnostic.actual).toBe(text);
    });
  }

  it('非有限值判定基于求值结果，而非字符串匹配', () => {
    // 语法合法、指数极大：字符串里没有 "Infinity" 字样，只有求值才能发现问题。
    const result = decodeText(wrap('1e400'));
    expect(result.ok).toBe(false);
    // 反向：极小的下溢值求值为 0，是有限值，必须接受。
    expect(decodeText(wrap('1e-400')).ok).toBe(true);
  });

  it('超出安全整数范围但有限的数字被接受，精度损失不是解码器的判定项', () => {
    const parsed = expectOk(decodeText(wrap('9007199254740993')));
    const payload = payloadOf(parsed);
    if (payload.kind !== 'number') throw new Error('expected number');
    expect(Number.isFinite(payload.value)).toBe(true);
    // 原文保留，使上层仍能发现精度问题。
    expect(payload.lexical).toBe('9007199254740993');
  });
});

describe('严格 JSON 解码器：空结构与嵌套', () => {
  it('接受空对象', () => {
    const payload = payloadOf(expectOk(decodeText(wrap('{}'))));
    expect(payload.kind).toBe('object');
    if (payload.kind !== 'object') throw new Error('unreachable');
    expect(payload.members).toHaveLength(0);
  });

  it('接受空数组', () => {
    const payload = payloadOf(expectOk(decodeText(wrap('[]'))));
    expect(payload.kind).toBe('array');
    if (payload.kind !== 'array') throw new Error('unreachable');
    expect(payload.elements).toHaveLength(0);
  });

  it('接受空字符串，并与缺失严格区分', () => {
    const payload = payloadOf(expectOk(decodeText(wrap('""'))));
    if (payload.kind !== 'string') throw new Error('expected string');
    expect(payload.value).toBe('');
  });

  it('接受嵌套空容器', () => {
    expect(decodeText(wrap('[[],{},[{}]]')).ok).toBe(true);
  });

  it('接受空白散布在各处', () => {
    expect(decodeText(`{\n  "${SCHEMA_VERSION_MEMBER}" : "1.0.0" ,\n  "a" : [ 1 , 2 ]\n}`).ok).toBe(true);
  });

  it('三种标量字面量都被正确解码', () => {
    const parsed = expectOk(decodeText(wrap('[true,false,null]')));
    const payload = payloadOf(parsed);
    if (payload.kind !== 'array') throw new Error('expected array');
    expect(payload.elements.map((element) => element.kind)).toEqual(['boolean', 'boolean', 'null']);
    const first = payload.elements[0];
    const second = payload.elements[1];
    if (first?.kind !== 'boolean' || second?.kind !== 'boolean') throw new Error('expected booleans');
    expect(first.value).toBe(true);
    expect(second.value).toBe(false);
  });
});

describe('严格 JSON 解码器：source span 精度（需求 2.8）', () => {
  it('每个 span 的字节偏移都能切回该节点的原文', () => {
    const text = `{"${SCHEMA_VERSION_MEMBER}":"1.0.0","n":42,"s":"hi","a":[1,true]}`;
    const bytes = new TextEncoder().encode(text);
    const parsed = expectOk(decodeText(text));

    /** 用 span 的字节偏移从原始字节里切片，再解码回文本。 */
    const sliceOf = (ast: JsonAst): string =>
      new TextDecoder().decode(bytes.slice(ast.span.start.offset, ast.span.end.offset));

    if (parsed.ast.kind !== 'object') throw new Error('expected object');
    const byKey = new Map(parsed.ast.members.map((entry) => [entry.key, entry]));

    expect(sliceOf(byKey.get('n')!.value)).toBe('42');
    expect(sliceOf(byKey.get('s')!.value)).toBe('"hi"');
    expect(sliceOf(byKey.get('a')!.value)).toBe('[1,true]');
    // 根对象的 span 覆盖整个文档。
    expect(sliceOf(parsed.ast)).toBe(text);

    // key span 切回来是带引号的成员名原文。
    const keySpan = byKey.get('n')!.keySpan;
    expect(new TextDecoder().decode(bytes.slice(keySpan.start.offset, keySpan.end.offset))).toBe('"n"');
  });

  it('多字节字符不会让后续 span 错位', () => {
    // '中' 占 3 字节但 1 个 code point：字节偏移与列号必须各自独立正确。
    const text = `{"${SCHEMA_VERSION_MEMBER}":"1.0.0","k":"中文","after":7}`;
    const bytes = new TextEncoder().encode(text);
    const parsed = expectOk(decodeText(text));
    if (parsed.ast.kind !== 'object') throw new Error('expected object');
    const after = parsed.ast.members.find((entry) => entry.key === 'after');
    if (after === undefined) throw new Error('missing member');
    expect(new TextDecoder().decode(bytes.slice(after.value.span.start.offset, after.value.span.end.offset))).toBe('7');
  });

  it('行列号按 code point 计数，且换行推进行号', () => {
    const text = `{\n"${SCHEMA_VERSION_MEMBER}":"1.0.0",\n"k":1\n}`;
    const parsed = expectOk(decodeText(text));
    if (parsed.ast.kind !== 'object') throw new Error('expected object');
    const member = parsed.ast.members.find((entry) => entry.key === 'k');
    if (member === undefined) throw new Error('missing member');
    // "k" 在第 3 行，列号从 1 起。
    expect(member.keySpan.start.line).toBe(3);
    expect(member.keySpan.start.column).toBe(1);
  });

  it('语法错误的位置指向出错字符本身', () => {
    const text = '{"a" 1}';
    const diagnostic = onlyDiagnostic(decodeText(text));
    // 冒号缺失在偏移 5（'1' 处）被发现。
    expect(diagnostic.sourceSpan?.start.offset).toBe(text.indexOf('1'));
  });

  it('span 的 file 字段承载来源文档标识', () => {
    const parsed = expectOk(decodeText(wrap('1')));
    expect(parsed.ast.span.file).toBe('doc:test');
  });
});

describe('严格 JSON 解码器：显式 Schema 版本（需求 12.1）', () => {
  it('读出根对象显式声明的 schemaVersion', () => {
    const parsed = expectOk(decodeText(`{"${SCHEMA_VERSION_MEMBER}":"2.3.4"}`));
    expect(parsed.schemaVersion).toBe('2.3.4');
  });

  it('缺少 schemaVersion 时拒绝，不默认任何版本', () => {
    const diagnostic = onlyDiagnostic(decodeText('{"a":1}'));
    expect(diagnostic.code).toBe('E_LOAD_SCHEMA_VERSION');
  });

  it('schemaVersion 不是字符串时拒绝', () => {
    expect(codesOf(decodeText(`{"${SCHEMA_VERSION_MEMBER}":1}`))).toContain('E_LOAD_SCHEMA_VERSION');
  });

  it('schemaVersion 为空串或含前后空白时拒绝', () => {
    expect(decodeText(`{"${SCHEMA_VERSION_MEMBER}":""}`).ok).toBe(false);
    expect(decodeText(`{"${SCHEMA_VERSION_MEMBER}":" 1.0.0"}`).ok).toBe(false);
    expect(decodeText(`{"${SCHEMA_VERSION_MEMBER}":"1.0.0 "}`).ok).toBe(false);
  });

  it('顶层不是对象时拒绝', () => {
    expect(codesOf(decodeText('[1,2]'))).toContain('E_LOAD_SCHEMA_VERSION');
    expect(codesOf(decodeText('"just a string"'))).toContain('E_LOAD_SCHEMA_VERSION');
    expect(codesOf(decodeText('42'))).toContain('E_LOAD_SCHEMA_VERSION');
  });

  it('候选自身声明的来源与目标层原样透传，不被文档内容改写', () => {
    const document = candidateFromText(source, 'play-layer', `{"${SCHEMA_VERSION_MEMBER}":"1.0.0"}`);
    const result = decoder.decode(document, createQuotaBudget(GENEROUS));
    const parsed = expectOk(result);
    expect(parsed.targetOwnership).toBe('play-layer');
    expect(parsed.source.documentId).toBe('doc:test');
  });
});

describe('严格 JSON 解码器：配额与输入炸弹（需求 9.2-9.5，Property 9）', () => {
  /** 生成 `depth` 层嵌套数组。 */
  function nestedArrays(depth: number): string {
    return `${'['.repeat(depth)}1${']'.repeat(depth)}`;
  }

  it('inputBytes 超限时拒绝，且在解析前就拒绝', () => {
    const diagnostic = onlyDiagnostic(decodeText(wrap('1'), profileWith({ inputBytes: 4 })));
    expect(diagnostic.code).toBe('E_QUOTA_INPUT_BYTES');
    expect(diagnostic.expected).toBe(4);
  });

  it('nestingDepth 超限时拒绝', () => {
    const diagnostic = onlyDiagnostic(decodeText(wrap(nestedArrays(20)), profileWith({ nestingDepth: 5 })));
    expect(diagnostic.code).toBe('E_QUOTA_NESTING_DEPTH');
    expect(diagnostic.expected).toBe(5);
  });

  it('深度是峰值而非累计：宽而浅的文档不会被深度配额误拒', () => {
    // 200 个兄弟数组，每个只深 1 层。若按累计计数会得到 200 的"深度"。
    const wide = `[${Array.from({ length: 200 }, () => '[1]').join(',')}]`;
    expect(decodeText(wrap(wide), profileWith({ nestingDepth: 8 })).ok).toBe(true);
  });

  it('objectMembers 超限时拒绝', () => {
    const members = Array.from({ length: 50 }, (_, index) => `"k${String(index)}":1`).join(',');
    const diagnostic = onlyDiagnostic(decodeText(wrap(`{${members}}`), profileWith({ objectMembers: 10 })));
    expect(diagnostic.code).toBe('E_QUOTA_OBJECT_MEMBERS');
  });

  it('arrayElements 超限时拒绝', () => {
    const elements = Array.from({ length: 50 }, () => '1').join(',');
    const diagnostic = onlyDiagnostic(decodeText(wrap(`[${elements}]`), profileWith({ arrayElements: 10 })));
    expect(diagnostic.code).toBe('E_QUOTA_ARRAY_ELEMENTS');
  });

  it('astNodes 超限时拒绝', () => {
    const elements = Array.from({ length: 50 }, () => '1').join(',');
    const diagnostic = onlyDiagnostic(decodeText(wrap(`[${elements}]`), profileWith({ astNodes: 6 })));
    expect(diagnostic.code).toBe('E_QUOTA_AST_NODES');
  });

  it('traversalWork 超限时拒绝，长字符串也受工作量约束', () => {
    // 单个超长字符串在 scan 循环里只算一步，因此工作量必须在字符级别计费才拦得住。
    const longString = `"${'a'.repeat(5000)}"`;
    const diagnostic = onlyDiagnostic(decodeText(wrap(longString), profileWith({ traversalWork: 200 })));
    expect(diagnostic.code).toBe('E_QUOTA_TRAVERSAL_WORK');
  });

  it('配额诊断给出类别、上限与观测用量，且不回显完整超大载荷（需求 9.7）', () => {
    const huge = `[${Array.from({ length: 400 }, () => '1234567890').join(',')}]`;
    const diagnostic = onlyDiagnostic(decodeText(wrap(huge), profileWith({ arrayElements: 3 })));
    expect(diagnostic.expected).toBe(3);
    expect(diagnostic.actual).toBe(3);
    // 诊断文本长度必须与输入规模无关。
    const rendered = `${diagnostic.message}${diagnostic.reason}${diagnostic.correctionSuggestion}`;
    expect(rendered.length).toBeLessThan(400);
    expect(rendered).not.toContain('1234567890,1234567890');
  });

  it('深嵌套不造成调用栈溢出：显式栈使 10000 层只表现为配额拒绝（需求 9.5）', () => {
    const veryDeep = wrap(nestedArrays(10_000));
    // 关键断言是"不抛异常"。若实现改成递归，这里会是 RangeError 而不是结构化拒绝。
    const result = decodeText(veryDeep, profileWith({ nestingDepth: 64 }));
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('E_QUOTA_NESTING_DEPTH');
  });

  it('即使深度配额放开，深嵌套仍以结构化拒绝而非栈溢出收场', () => {
    const result = decodeText(wrap(nestedArrays(50_000)), profileWith({ nestingDepth: 100_000, astNodes: 200_000 }));
    // 无论落在哪一类配额上，都必须是结构化结果，不能抛异常。
    expect(typeof result.ok).toBe('boolean');
  });

  it('同一超大候选在同一档案下恒失败在同一配额类别（需求 9.10）', () => {
    const bomb = wrap(nestedArrays(500));
    const profile = profileWith({ nestingDepth: 16 });
    const first = codesOf(decodeText(bomb, profile));
    const second = codesOf(decodeText(bomb, profile));
    const third = codesOf(decodeText(bomb, profile));
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first).toContain('E_QUOTA_NESTING_DEPTH');
  });

  it('配额拒绝不产出任何部分 AST（需求 9.8）', () => {
    const result = decodeText(wrap(nestedArrays(100)), profileWith({ nestingDepth: 4 }));
    expect(result.ok).toBe(false);
    // 拒绝结果的类型里没有 value 字段；运行期也不得挂一个。
    expect((result as unknown as { value?: unknown }).value).toBeUndefined();
  });
});

/**
 * 生成器设计说明（对抗"测试空转"）：
 *
 * 若只用 `fc.string()` 喂解码器，几乎每个样本都是语法垃圾，"要么 AST 要么拒绝"这条断言会在
 * 100% 的拒绝分支上通过，成功分支一次都走不到——那样这条性质就退化成了重言式。
 * 因此下面分成两类生成器：一类**保证生成合法文档**（走成功分支），一类**保证生成非法输入**
 * （走拒绝分支），再各自断言各自该有的结论，并在合法分支上额外核对"确实成功了"。
 */

/** 有界的合法 JSON 值生成器。 */
const jsonValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constant(null),
    fc.boolean(),
    // 只取有限双精度：非有限值由单元测试单独覆盖，这里要保证成功分支真的能成功。
    fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 }),
    fc.string(),
    fc.array(tie('node'), { maxLength: 4 }),
    // 成员名池刻意很小，使重复键在"手工拼接"路径上成为常态而非稀有事件。
    fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd'), tie('node'), { maxKeys: 4 }),
  ),
})).node as fc.Arbitrary<unknown>;

describe('Property 2: 声明式 JSON 安全（任意字节要么产出有界 AST，要么产出结构化拒绝）', () => {
  it('对于任意合法 JSON 文档，解码成功且 AST 与原值语义一致', () => {
    let successes = 0;
    fc.assert(
      fc.property(jsonValueArb, (payload) => {
        const text = JSON.stringify({ [SCHEMA_VERSION_MEMBER]: '1.0.0', payload });
        const result = decodeText(text);
        // 合法输入必须成功。这条断言让"成功分支从未被走到"的空转形态无法隐藏。
        if (!result.ok) {
          throw new Error(`legal JSON rejected: ${text} → ${codesOf(result).join(',')}`);
        }
        successes += 1;
        // 语义一致性：把 AST 折回普通值，应与原值的规范 JSON 相等。
        expect(JSON.stringify(astToPlain(payloadOf(result.value)))).toBe(JSON.stringify(payload));
      }),
      { numRuns: 300 },
    );
    // 守卫：若生成器退化成一直产生同一个平凡值，这里能看出来。
    expect(successes).toBe(300);
  });

  it('对于任意字节序列，结果恒是"有界 AST"或"含 error 级诊断的拒绝"，且永不抛异常', () => {
    let accepted = 0;
    let rejected = 0;
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        const result = decodeBytes(bytes);
        if (result.ok) {
          accepted += 1;
          // 成功分支必须真的有一个 AST 和一个显式版本。
          expect(result.value.ast).toBeDefined();
          expect(result.value.schemaVersion.length).toBeGreaterThan(0);
        } else {
          rejected += 1;
          // 拒绝分支必须至少有一条阻断级诊断（需求 14.5）。
          expect(result.diagnostics.some((d) => d.severity === 'error' || d.severity === 'fatal')).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
    // 随机字节几乎必然全部被拒；这里只断言遍历确实发生过，不假装覆盖了成功分支。
    expect(accepted + rejected).toBe(500);
  });

  it('对于任意含重复成员的文档，恒被拒绝且后值从不覆盖前值', () => {
    const duplicateDocArb = fc
      .tuple(fc.constantFrom('a', 'b', 'c'), fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }))
      .map(([key, first, second]) => ({
        text: `{"${SCHEMA_VERSION_MEMBER}":"1.0.0","${key}":${String(first)},"${key}":${String(second)}}`,
        key,
      }));

    fc.assert(
      fc.property(duplicateDocArb, ({ text, key }) => {
        const result = decodeText(text);
        expect(result.ok).toBe(false);
        expect(codesOf(result)).toContain('E_LOAD_DUPLICATE_MEMBER');
        // 对照：原生 JSON.parse 会静默接受同一输入，证明这条拒绝不是白来的。
        const native = JSON.parse(text) as Record<string, unknown>;
        expect(Object.keys(native)).toContain(key);
      }),
      { numRuns: 200 },
    );
  });

  it('解码过程从不执行候选内容：含可执行字样的字符串按普通字符串解码', () => {
    const payloadArb = fc.constantFrom(
      '{"eval":"1+1"}',
      '{"fn":"function(){return 1}"}',
      '{"script":"<script>alert(1)</script>"}',
      '{"cmd":"rm -rf /"}',
      '{"desc":"这个技能的说明里出现了 eval 和 function 这两个词"}',
      '{"__proto__":{"polluted":true}}',
      '{"constructor":{"prototype":{"x":1}}}',
    );

    fc.assert(
      fc.property(payloadArb, (fragment) => {
        const result = decodeText(wrap(fragment));
        // 解码器只做语法层判定：这些都是语法合法的 JSON，必须成功解码为惰性数据。
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const payload = payloadOf(result.value);
        expect(payload.kind).toBe('object');
        // 全部成员值都必须是惰性 AST 节点，不存在任何函数。
        if (payload.kind !== 'object') return;
        for (const member of payload.members) {
          expect(typeof member.value).toBe('object');
          expect(typeof (member.value as unknown as { call?: unknown }).call).toBe('undefined');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('原型污染字样不会污染 AST：__proto__ 只是一个普通成员名', () => {
    const parsed = expectOk(decodeText(wrap('{"__proto__":{"polluted":true}}')));
    const payload = payloadOf(parsed);
    if (payload.kind !== 'object') throw new Error('expected object');
    // 成员被如实保留为数据……
    expect(payload.members.map((entry) => entry.key)).toEqual(['__proto__']);
    // ……但没有任何对象的原型被改动。
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('Property 9: 有界对抗处理（配额耗尽终止遍历且不激活任何东西）', () => {
  it('对于任意配额组合与对抗输入，恒返回结构化结果且永不抛异常', () => {
    const adversarialArb = fc.oneof(
      fc.integer({ min: 1, max: 400 }).map((depth) => `${'['.repeat(depth)}1${']'.repeat(depth)}`),
      fc.integer({ min: 1, max: 200 }).map((count) => `[${Array.from({ length: count }, () => '1').join(',')}]`),
      fc
        .integer({ min: 1, max: 200 })
        .map((count) => `{${Array.from({ length: count }, (_, i) => `"k${String(i)}":1`).join(',')}}`),
      fc.integer({ min: 1, max: 2000 }).map((length) => `"${'a'.repeat(length)}"`),
    );

    const quotaArb = fc.record({
      nestingDepth: fc.integer({ min: 1, max: 32 }),
      objectMembers: fc.integer({ min: 1, max: 32 }),
      arrayElements: fc.integer({ min: 1, max: 32 }),
      astNodes: fc.integer({ min: 1, max: 64 }),
      traversalWork: fc.integer({ min: 1, max: 5000 }),
    });

    fc.assert(
      fc.property(adversarialArb, quotaArb, (fragment, quotas) => {
        const result = decodeText(wrap(fragment), profileWith(quotas));
        // 恒是结构化结果。
        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) {
          // 拒绝时必须有阻断级诊断，且不激活任何东西（拒绝结果不含 value）。
          expect(result.diagnostics.some((d) => d.severity === 'error' || d.severity === 'fatal')).toBe(true);
          expect((result as unknown as { value?: unknown }).value).toBeUndefined();
        }
      }),
      { numRuns: 400 },
    );
  });

  it('配额越紧越容易被拒：放宽配额不会把已接受的输入变成拒绝（单调性）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }), (depth, limit) => {
        const fragment = `${'['.repeat(depth)}1${']'.repeat(depth)}`;
        const tight = decodeText(wrap(fragment), profileWith({ nestingDepth: limit }));
        const loose = decodeText(wrap(fragment), profileWith({ nestingDepth: limit + 20 }));
        // 紧配额通过 ⇒ 松配额也必须通过。
        if (tight.ok) expect(loose.ok).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * 输出形状不变量，而不是诊断文本断言。
   *
   * 上面的表格用 `reason` 钉住了代理项的拒绝原因，但那种断言会随文案改写一起失效。
   * 这条从另一侧封口：**凡是解码成功的字符串，其码元序列里不允许存在落单代理项**。
   * 无论代理项校验被绕过后走到哪条错误分支、报什么文案，只要它让落单代理项进入 AST，
   * 这条就会失败。
   */
  it('解码成功的字符串永不含落单代理项（与诊断文案无关的输出不变量）', () => {
    const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

    const escapeArb = fc.oneof(
      // 合法的成对代理项：应当解码为单个星平面字符。
      fc.constant('\\uD834\\uDD1E'),
      // 各种落单形态：必须被拒绝，绝不能带着落单代理项解码成功。
      fc.constant('\\uD834'),
      fc.constant('\\uDD1E'),
      fc.constant('\\uD834\\u0041'),
      fc.constant('\\uD834\\uD834'),
      fc.constant('\\uDD1E\\uDD1E'),
      fc.constant('\\uD800'),
      fc.constant('\\uDFFF'),
      fc.constant('A'),
      fc.constant('\\n'),
    );

    let accepted = 0;
    let rejected = 0;

    fc.assert(
      fc.property(fc.array(escapeArb, { minLength: 1, maxLength: 6 }), (parts) => {
        const result = decodeText(wrap(`"${parts.join('')}"`));
        if (result.ok) {
          accepted += 1;
          const decoded = payloadOf(expectOk(result));
          expect(decoded.kind).toBe('string');
          if (decoded.kind !== 'string') throw new Error('payload is not a string');
          expect(LONE_SURROGATE.test(decoded.value)).toBe(false);
        } else {
          rejected += 1;
          expect(codesOf(result)).toContain('E_LOAD_JSON_SYNTAX');
        }
      }),
      { numRuns: 300 },
    );

    // 双向非空：生成器必须同时覆盖接受与拒绝两侧，否则这条property会退化成重言式。
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });
});

/** 把 AST 折回普通 JS 值，用于与原始输入比对。重复成员在此之前就已被拒绝，故不会丢值。 */
function astToPlain(ast: JsonAst): unknown {
  if (ast.kind === 'null') return null;
  if (ast.kind === 'boolean') return ast.value;
  if (ast.kind === 'number') return ast.value;
  if (ast.kind === 'string') return ast.value;
  if (ast.kind === 'array') return ast.elements.map(astToPlain);
  const result: Record<string, unknown> = {};
  for (const member of ast.members) {
    result[member.key] = astToPlain(member.value);
  }
  return result;
}
