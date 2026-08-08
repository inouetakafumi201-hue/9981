/**
 * 严格、有界、保留 span 的 JSON 解码器（design.md「Structural JSON decoder」/ 需求 2.1-2.3、2.8-2.10、9.2-9.5）。
 *
 * 关键设计点：
 * 1. **不使用 `JSON.parse` 作为首次物化路径**。`JSON.parse` 会让重复成员的后值静默覆盖前值，
 *    从而永久丢掉需求 2.9 要求检测的冲突，也拿不到 span。
 * 2. **显式栈，零递归**。深度只受配额限制，恶意嵌套无法造成调用栈溢出（需求 9.5）。
 * 3. **创建前消费配额**。每个节点、成员、元素、深度增量都先扣预算再构造，超限即终止受影响遍历。
 * 4. **失败不暴露部分 AST**。任何错误都返回拒绝结果，已构造的栈帧被丢弃（需求 9.8）。
 */
import type { Diagnostic, SourcePoint, SourceSpan } from '../../kernel/state/diagnostic.js';
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import { documentAnchorSpan } from '../diagnostics/factory.js';
import type { CandidateDocument } from '../model/candidate.js';
import type { JsonAst, JsonMember, ParsedCandidateDocument } from '../model/json-ast.js';
import type { QuotaBudget, QuotaViolation } from '../model/quota-types.js';
import type { UgcResult } from '../model/result.js';
import { ugcOk, ugcReject } from '../model/result.js';
import { DepthTracker } from '../quota/quota-budget.js';
import { SourceCursor } from './source-cursor.js';
import { UTF8_VIOLATION_TEXT, findFirstUtf8Violation } from './utf8.js';

/** 根对象中声明 Schema 版本的成员名（需求 12.1）。 */
export const SCHEMA_VERSION_MEMBER = 'schemaVersion';

interface ArrayFrame {
  readonly kind: 'array';
  readonly start: SourcePoint;
  readonly elements: JsonAst[];
}

interface ObjectFrame {
  readonly kind: 'object';
  readonly start: SourcePoint;
  readonly members: JsonMember[];
  /** 已见成员名 → 首次出现的 key span。重复成员诊断必须同时指向首次与冲突位置。 */
  readonly seen: Map<string, SourceSpan>;
  pendingKey: { readonly key: string; readonly keySpan: SourceSpan } | null;
}

type Frame = ArrayFrame | ObjectFrame;

type ParseMode = 'value' | 'member-key' | 'colon' | 'comma-or-end';

/** 解析失败的内部表示。它在返回给调用方前被转换为共享 Diagnostic。 */
type DecodeFailure =
  | { readonly kind: 'syntax'; readonly detail: string; readonly point: SourcePoint }
  | { readonly kind: 'trailing-content'; readonly point: SourcePoint }
  | { readonly kind: 'nonfinite-number'; readonly lexical: string; readonly span: SourceSpan }
  | {
      readonly kind: 'duplicate-member';
      readonly key: string;
      readonly firstSpan: SourceSpan;
      readonly duplicateSpan: SourceSpan;
    }
  | { readonly kind: 'quota'; readonly violation: QuotaViolation };

const DIGITS = new Set('0123456789');
const HEX_DIGITS = new Set('0123456789abcdefABCDEF');

class StrictJsonScanner {
  private readonly cursor: SourceCursor;
  private readonly depthTracker: DepthTracker;
  private readonly stack: Frame[] = [];
  private root: JsonAst | null = null;
  private mode: ParseMode = 'value';
  private afterComma = false;

  constructor(
    text: string,
    file: string,
    private readonly budget: QuotaBudget,
  ) {
    this.cursor = new SourceCursor(text, file);
    this.depthTracker = new DepthTracker(budget);
  }

  /** 单遍扫描。成功返回根节点，失败返回结构化失败事实。 */
  scan(): { readonly ok: true; readonly ast: JsonAst } | { readonly ok: false; readonly failure: DecodeFailure } {
    for (;;) {
      const work = this.budget.consume('traversalWork', 1);
      if (work !== null) return this.fail({ kind: 'quota', violation: work });

      this.cursor.skipWhitespace();

      if (this.mode === 'value') {
        const stepped = this.stepValue();
        if (stepped !== null) return this.fail(stepped);
      } else if (this.mode === 'member-key') {
        const stepped = this.stepMemberKey();
        if (stepped !== null) return this.fail(stepped);
      } else if (this.mode === 'colon') {
        const stepped = this.stepColon();
        if (stepped !== null) return this.fail(stepped);
      } else {
        const stepped = this.stepCommaOrEnd();
        if (stepped !== null) return this.fail(stepped);
      }

      if (this.root !== null && this.stack.length === 0) {
        this.cursor.skipWhitespace();
        if (!this.cursor.atEnd()) {
          return this.fail({ kind: 'trailing-content', point: this.cursor.point() });
        }
        return { ok: true, ast: this.root };
      }
    }
  }

  private fail(failure: DecodeFailure): { readonly ok: false; readonly failure: DecodeFailure } {
    // 丢弃全部栈帧：失败路径绝不向调用方暴露部分 AST。
    this.stack.length = 0;
    this.root = null;
    return { ok: false, failure };
  }

  private syntax(detail: string): DecodeFailure {
    return { kind: 'syntax', detail, point: this.cursor.point() };
  }

  private work(): DecodeFailure | null {
    const violation = this.budget.consume('traversalWork', 1);
    return violation === null ? null : { kind: 'quota', violation };
  }

  private node(span: SourceSpan): DecodeFailure | null {
    const violation = this.budget.consume('astNodes', 1, { sourceSpan: span });
    return violation === null ? null : { kind: 'quota', violation };
  }

  private top(): Frame | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** 把已完成的值挂到栈顶帧，或在栈空时作为根值。 */
  private attach(ast: JsonAst): DecodeFailure | null {
    const frame = this.top();
    if (frame === undefined) {
      this.root = ast;
      return null;
    }
    if (frame.kind === 'array') {
      const violation = this.budget.consume('arrayElements', 1, { sourceSpan: ast.span });
      if (violation !== null) return { kind: 'quota', violation };
      frame.elements.push(ast);
    } else {
      const pending = frame.pendingKey;
      if (pending === null) {
        return this.syntax('对象内出现了没有成员名的值');
      }
      const violation = this.budget.consume('objectMembers', 1, { sourceSpan: pending.keySpan });
      if (violation !== null) return { kind: 'quota', violation };
      frame.members.push({ key: pending.key, keySpan: pending.keySpan, value: ast });
      frame.pendingKey = null;
    }
    this.mode = 'comma-or-end';
    this.afterComma = false;
    return null;
  }

  private openContainer(kind: 'array' | 'object'): DecodeFailure | null {
    const start = this.cursor.point();
    this.cursor.advance();
    const anchor = this.cursor.spanFrom(start);
    const depthViolation = this.depthTracker.enter(this.stack.length + 1, { sourceSpan: anchor });
    if (depthViolation !== null) return { kind: 'quota', violation: depthViolation };
    const nodeFailure = this.node(anchor);
    if (nodeFailure !== null) return nodeFailure;
    if (kind === 'array') {
      this.stack.push({ kind: 'array', start, elements: [] });
      this.mode = 'value';
    } else {
      this.stack.push({ kind: 'object', start, members: [], seen: new Map(), pendingKey: null });
      this.mode = 'member-key';
    }
    this.afterComma = false;
    return null;
  }

  private closeArray(): DecodeFailure | null {
    const frame = this.stack.pop();
    if (frame === undefined || frame.kind !== 'array') return this.syntax('意外的 ]');
    this.cursor.advance();
    return this.attach({
      kind: 'array',
      elements: Object.freeze([...frame.elements]),
      span: this.cursor.spanFrom(frame.start),
    });
  }

  private closeObject(): DecodeFailure | null {
    const frame = this.stack.pop();
    if (frame === undefined || frame.kind !== 'object') return this.syntax('意外的 }');
    if (frame.pendingKey !== null) return this.syntax(`成员 "${frame.pendingKey.key}" 缺少值`);
    this.cursor.advance();
    return this.attach({
      kind: 'object',
      members: Object.freeze([...frame.members]),
      span: this.cursor.spanFrom(frame.start),
    });
  }

  private stepColon(): DecodeFailure | null {
    if (this.cursor.peekChar() !== ':') return this.syntax('成员名之后必须是冒号');
    this.cursor.advance();
    this.mode = 'value';
    return null;
  }

  private stepCommaOrEnd(): DecodeFailure | null {
    const frame = this.top();
    if (frame === undefined) return null;
    const char = this.cursor.peekChar();
    if (char === ',') {
      this.cursor.advance();
      this.afterComma = true;
      this.mode = frame.kind === 'array' ? 'value' : 'member-key';
      return null;
    }
    if (char === ']') return frame.kind === 'array' ? this.closeArray() : this.syntax('对象必须以 } 结束');
    if (char === '}') return frame.kind === 'object' ? this.closeObject() : this.syntax('数组必须以 ] 结束');
    if (char === null) return this.syntax('输入在容器尚未闭合时结束');
    return this.syntax(`期望逗号或容器结束符，实际读到 ${JSON.stringify(char)}`);
  }

  private stepMemberKey(): DecodeFailure | null {
    const frame = this.top();
    if (frame === undefined || frame.kind !== 'object') return this.syntax('成员名只能出现在对象内');
    const char = this.cursor.peekChar();
    if (char === null) return this.syntax('输入在对象尚未闭合时结束');
    if (char === '}') {
      if (this.afterComma) return this.syntax('对象不允许尾随逗号');
      return this.closeObject();
    }
    if (char !== '"') {
      return this.syntax(`成员名必须是双引号包围的字符串，实际读到 ${JSON.stringify(char)}`);
    }
    const start = this.cursor.point();
    const parsed = this.parseString();
    if (parsed.ok === false) return parsed.failure;
    const keySpan = this.cursor.spanFrom(start);

    // 重复成员检测必须发生在把成员放进任何普通对象之前，否则后值会静默覆盖前值（需求 2.9）。
    const firstSpan = frame.seen.get(parsed.value);
    if (firstSpan !== undefined) {
      return { kind: 'duplicate-member', key: parsed.value, firstSpan, duplicateSpan: keySpan };
    }
    frame.seen.set(parsed.value, keySpan);
    frame.pendingKey = { key: parsed.value, keySpan };
    this.mode = 'colon';
    this.afterComma = false;
    return null;
  }

  private stepValue(): DecodeFailure | null {
    const char = this.cursor.peekChar();
    if (char === null) return this.syntax('输入在期望一个值的位置结束');
    const frame = this.top();

    if (char === ']') {
      if (frame === undefined || frame.kind !== 'array') return this.syntax('意外的 ]');
      if (this.afterComma) return this.syntax('数组不允许尾随逗号');
      return this.closeArray();
    }
    if (char === '{') return this.openContainer('object');
    if (char === '[') return this.openContainer('array');
    if (char === '"') {
      const start = this.cursor.point();
      const parsed = this.parseString();
      if (parsed.ok === false) return parsed.failure;
      const span = this.cursor.spanFrom(start);
      const nodeFailure = this.node(span);
      if (nodeFailure !== null) return nodeFailure;
      return this.attach({ kind: 'string', value: parsed.value, span });
    }
    if (char === '-' || DIGITS.has(char)) return this.parseNumber();
    if (char === 't') return this.parseLiteral('true', { kind: 'boolean', value: true });
    if (char === 'f') return this.parseLiteral('false', { kind: 'boolean', value: false });
    if (char === 'n') return this.parseLiteral('null', { kind: 'null' });
    return this.syntax(`不是合法的 JSON 值起始字符：${JSON.stringify(char)}`);
  }

  /**
   * 读取一个 JSON 字符串（含开引号）。成员名与字符串值共用这一条实现，因此两处的转义、控制字符
   * 和代理对规则天然一致，不存在"成员名比值宽松"的缝隙。
   *
   * 严格点：
   * - 拒绝未转义的控制字符（U+0000–U+001F）。JSON 要求它们必须转义。
   * - 只接受八种转义 `" \ / b f n r t u`。`\x41`、`\'`、`\0` 一律拒绝。
   * - `\u` 必须跟四位十六进制数字。
   * - 代理对必须成对且顺序正确；落单的高位或低位代理都拒绝（tasks.md 3.2「非法 surrogate」）。
   *   落单代理若放进 AST，规范化输出时会变成 U+FFFD，从而破坏往返性质。
   */
  private parseString(): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly failure: DecodeFailure } {
    const reject = (failure: DecodeFailure): { readonly ok: false; readonly failure: DecodeFailure } => ({
      ok: false,
      failure,
    });

    if (this.cursor.peekChar() !== '"') {
      return reject(this.syntax('字符串必须以双引号开始'));
    }
    this.cursor.advance();

    let value = '';
    for (;;) {
      const workViolation = this.work();
      if (workViolation !== null) return reject(workViolation);

      const codePoint = this.cursor.peekCodePoint();
      if (codePoint === null) {
        return reject(this.syntax('输入在字符串尚未闭合时结束'));
      }

      if (codePoint === 0x22) {
        this.cursor.advance();
        return { ok: true, value };
      }

      if (codePoint < 0x20) {
        return reject(this.syntax(`字符串内不允许未转义的控制字符 U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`));
      }

      if (codePoint !== 0x5c) {
        this.cursor.advance();
        value += String.fromCodePoint(codePoint);
        continue;
      }

      // 转义序列。
      this.cursor.advance();
      const escape = this.cursor.peekChar();
      if (escape === null) {
        return reject(this.syntax('输入在转义序列尚未结束时结束'));
      }

      if (escape === '"' || escape === '\\' || escape === '/') {
        this.cursor.advance();
        value += escape;
        continue;
      }
      if (escape === 'b') {
        this.cursor.advance();
        value += '\b';
        continue;
      }
      if (escape === 'f') {
        this.cursor.advance();
        value += '\f';
        continue;
      }
      if (escape === 'n') {
        this.cursor.advance();
        value += '\n';
        continue;
      }
      if (escape === 'r') {
        this.cursor.advance();
        value += '\r';
        continue;
      }
      if (escape === 't') {
        this.cursor.advance();
        value += '\t';
        continue;
      }
      if (escape !== 'u') {
        return reject(this.syntax(`不是合法的转义序列：\\${escape}`));
      }

      this.cursor.advance();
      const first = this.readHex4();
      if (first.ok === false) return reject(first.failure);
      const unit = first.value;

      if (unit >= 0xdc00 && unit <= 0xdfff) {
        return reject(this.syntax('落单的低位代理项，必须先出现高位代理项'));
      }

      if (unit < 0xd800 || unit > 0xdbff) {
        value += String.fromCharCode(unit);
        continue;
      }

      // 高位代理项：必须紧跟一个 \uDC00-\uDFFF 低位代理项。
      if (this.cursor.peekChar() !== '\\' || this.cursor.peekCharAt(1) !== 'u') {
        return reject(this.syntax('落单的高位代理项，必须紧跟 \\uDC00-\\uDFFF 低位代理项'));
      }
      this.cursor.advance();
      this.cursor.advance();
      const second = this.readHex4();
      if (second.ok === false) return reject(second.failure);
      const low = second.value;
      if (low < 0xdc00 || low > 0xdfff) {
        return reject(this.syntax('高位代理项之后不是合法的低位代理项'));
      }
      value += String.fromCharCode(unit, low);
    }
  }

  /** 读取恰好四位十六进制数字，返回其数值。 */
  private readHex4(): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly failure: DecodeFailure } {
    let digits = '';
    for (let index = 0; index < 4; index += 1) {
      const workViolation = this.work();
      if (workViolation !== null) return { ok: false, failure: workViolation };
      const char = this.cursor.peekChar();
      if (char === null || !HEX_DIGITS.has(char)) {
        return { ok: false, failure: this.syntax('\\u 转义必须跟四位十六进制数字') };
      }
      digits += char;
      this.cursor.advance();
    }
    return { ok: true, value: Number.parseInt(digits, 16) };
  }

  /**
   * 严格 JSON 数字语法：`-? (0 | [1-9][0-9]*) (. [0-9]+)? ([eE] [+-]? [0-9]+)?`。
   *
   * 逐字符走文法而不是"先切一段再交给 Number()"：JS 的 `Number()` 接受 JSON 不允许的形式
   * （`.5`、`5.`、`+5`、`0x10`、`Infinity`、前后空白），用它判定合法性会让这些形式静默通过。
   * 词法原文保留在 `lexical` 里，诊断才能如实回显作者写下的数字（json-ast.ts 的字段注释）。
   *
   * 非有限值单独成一类失败：`1e999` 语法完全合法，但求值为 Infinity，而 Infinity 无法被 JSON 表示，
   * 放进 AST 会在规范化往返时变成 `null`（需求 2.10、11 的往返性质）。
   */
  private parseNumber(): DecodeFailure | null {
    const start = this.cursor.point();
    let lexical = '';

    /** 消耗当前字符并计入词法原文。调用前必须已确认它是期望的字符。 */
    const take = (): DecodeFailure | null => {
      const workFailure = this.work();
      if (workFailure !== null) return workFailure;
      const char = this.cursor.peekChar();
      if (char === null) return this.syntax('输入在数字尚未结束时结束');
      lexical += char;
      this.cursor.advance();
      return null;
    };

    /** 消耗一段至少一位的数字串。 */
    const takeDigits = (what: string): DecodeFailure | null => {
      const first = this.cursor.peekChar();
      if (first === null || !DIGITS.has(first)) {
        return this.syntax(`${what}至少需要一位数字`);
      }
      while (!this.cursor.atEnd()) {
        const char = this.cursor.peekChar();
        if (char === null || !DIGITS.has(char)) break;
        const failure = take();
        if (failure !== null) return failure;
      }
      return null;
    };

    if (this.cursor.peekChar() === '-') {
      const failure = take();
      if (failure !== null) return failure;
    }

    const leading = this.cursor.peekChar();
    if (leading === null) return this.syntax('输入在数字尚未结束时结束');
    if (leading === '0') {
      const failure = take();
      if (failure !== null) return failure;
      // JSON 禁止前导零：`01`、`00`、`0123` 都不合法。
      const next = this.cursor.peekChar();
      if (next !== null && DIGITS.has(next)) {
        return this.syntax('数字不允许前导零');
      }
    } else if (DIGITS.has(leading)) {
      const failure = takeDigits('整数部分');
      if (failure !== null) return failure;
    } else {
      return this.syntax(`不是合法的数字起始字符：${JSON.stringify(leading)}`);
    }

    if (this.cursor.peekChar() === '.') {
      const dotFailure = take();
      if (dotFailure !== null) return dotFailure;
      const fracFailure = takeDigits('小数部分');
      if (fracFailure !== null) return fracFailure;
    }

    const exponentChar = this.cursor.peekChar();
    if (exponentChar === 'e' || exponentChar === 'E') {
      const expFailure = take();
      if (expFailure !== null) return expFailure;
      const signChar = this.cursor.peekChar();
      if (signChar === '+' || signChar === '-') {
        const signFailure = take();
        if (signFailure !== null) return signFailure;
      }
      const digitsFailure = takeDigits('指数部分');
      if (digitsFailure !== null) return digitsFailure;
    }

    const span = this.cursor.spanFrom(start);
    const value = Number(lexical);
    if (!Number.isFinite(value)) {
      return { kind: 'nonfinite-number', lexical, span };
    }
    const nodeFailure = this.node(span);
    if (nodeFailure !== null) return nodeFailure;
    return this.attach({ kind: 'number', lexical, value, span });
  }

  /**
   * 三个字面量的逐字符匹配。
   *
   * 不用"前缀命中即接受"：`truex` 的前四个字符与 `true` 相同，若只比前缀就会把它当成 `true` 后面
   * 跟着垃圾内容，错误位置也会指偏。这里要求完整匹配，失败时位置停在第一个不符的字符上。
   */
  private parseLiteral(literal: string, value: { kind: 'boolean'; value: boolean } | { kind: 'null' }): DecodeFailure | null {
    const start = this.cursor.point();
    for (let offset = 0; offset < literal.length; offset += 1) {
      const workFailure = this.work();
      if (workFailure !== null) return workFailure;
      if (this.cursor.peekChar() !== literal.charAt(offset)) {
        return this.syntax(`期望字面量 ${literal}`);
      }
      this.cursor.advance();
    }
    const span = this.cursor.spanFrom(start);
    const nodeFailure = this.node(span);
    if (nodeFailure !== null) return nodeFailure;
    return this.attach(value.kind === 'null' ? { kind: 'null', span } : { kind: 'boolean', value: value.value, span });
  }
}

/** 解码阶段固定为 `'decode'`：本模块只在流水线的这一阶段运行。 */
const DECODE_STAGE = 'decode' as const;

export interface StructuralJsonDecoder {
  decode(document: CandidateDocument, budget: QuotaBudget): UgcResult<ParsedCandidateDocument>;
}

/**
 * 把内部失败事实转成共享 Diagnostic。
 *
 * 全部走 `factory.document(...)`：解码期只有"来源文档 + 解析位置"这一种上下文，还没有 definition ID
 * 或 JSON path 可言。工厂对 document scope 强制 `at`/`path` 为显式 null，因此这条路径不可能编造定义标识。
 */
function failureToDiagnostic(
  failure: DecodeFailure,
  factory: UGCDiagnosticFactory,
  document: CandidateDocument,
): Diagnostic {
  const sourcePackage = document.source.packageId;
  const file = document.source.documentId;
  const common = { stage: DECODE_STAGE, sourcePackage } as const;

  if (failure.kind === 'syntax') {
    return factory.document({
      ...common,
      selector: { category: 'JSON_SYNTAX', condition: 'syntax' },
      sourceSpan: { file, start: failure.point, end: failure.point },
      message: `JSON syntax error: ${failure.detail}`,
      reason: `JSON 语法错误：${failure.detail}。`,
      correctionSuggestion: '请按标准 JSON 语法修正该位置，然后重新提交候选。',
    });
  }

  if (failure.kind === 'trailing-content') {
    return factory.document({
      ...common,
      selector: { category: 'JSON_SYNTAX', condition: 'trailing-content' },
      sourceSpan: { file, start: failure.point, end: failure.point },
      message: 'Trailing content after the top-level JSON value.',
      reason: '顶层 JSON 值之后还有多余内容。一个候选文档只能包含一个顶层值。',
      correctionSuggestion: '请删除顶层值之后的多余内容；若需要多个文档，请分别作为独立候选提交。',
    });
  }

  if (failure.kind === 'nonfinite-number') {
    return factory.document({
      ...common,
      selector: { category: 'JSON_SYNTAX', condition: 'nonfinite-number' },
      sourceSpan: failure.span,
      message: `Number literal ${failure.lexical} evaluates to a nonfinite value.`,
      reason: `数字 ${failure.lexical} 求值为非有限值（Infinity 或 NaN），而 JSON 无法表示这类值。`,
      correctionSuggestion: '请改用一个有限的数值；指数过大的写法需要缩小到可表示范围内。',
      actual: failure.lexical,
    });
  }

  if (failure.kind === 'duplicate-member') {
    // 同时指向首次与冲突位置：诊断锚在冲突处，首次位置进 messageArgs，两者都不丢（需求 2.9）。
    return factory.document({
      ...common,
      selector: { category: 'JSON_SYNTAX', condition: 'duplicate-member' },
      sourceSpan: failure.duplicateSpan,
      message: `Duplicate object member ${JSON.stringify(failure.key)}.`,
      reason: `同一个 JSON 对象内出现了重复成员名 ${JSON.stringify(failure.key)}。若按普通对象物化，后一个值会静默覆盖前一个值。`,
      correctionSuggestion: '请删除或重命名重复的成员名，使该对象内每个成员名只出现一次。',
      actual: failure.key,
      messageArgs: {
        key: failure.key,
        firstLine: failure.firstSpan.start.line,
        firstColumn: failure.firstSpan.start.column,
        firstOffset: failure.firstSpan.start.offset,
        duplicateLine: failure.duplicateSpan.start.line,
        duplicateColumn: failure.duplicateSpan.start.column,
        duplicateOffset: failure.duplicateSpan.start.offset,
      },
    });
  }

  const violation = failure.violation;
  return factory.document({
    ...common,
    selector: { category: 'RESOURCE_LIMIT', condition: violation.kind },
    sourceSpan: violation.context?.sourceSpan ?? documentAnchorSpan(file),
    message: `Quota ${violation.kind} exceeded: limit ${String(violation.limit)}, observed ${String(violation.observed)}.`,
    reason: `解码该候选超出了可信配额 ${violation.kind}（上限 ${String(violation.limit)}，观测用量 ${String(violation.observed)}）。`,
    correctionSuggestion: '请缩减候选的规模或嵌套深度；配额由宿主配置，候选自身无法提高它。',
    expected: violation.limit,
    actual: violation.observed,
  });
}

/**
 * 读取根对象显式声明的 `schemaVersion`（需求 12.1）。
 *
 * 版本**必须**由文档自身声明，不由 UGC 推断或默认：若缺失就默认一个版本，等于让 UGC 替创作者选择
 * 校验规则，需求 12.2 要求的"按该确切版本校验"就失去了依据。
 */
function readSchemaVersion(
  ast: JsonAst,
  factory: UGCDiagnosticFactory,
  document: CandidateDocument,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly diagnostic: Diagnostic } {
  const sourcePackage = document.source.packageId;
  const reject = (sourceSpan: SourceSpan, reason: string): { readonly ok: false; readonly diagnostic: Diagnostic } => ({
    ok: false,
    diagnostic: factory.document({
      selector: { category: 'SCHEMA_CONTRACT', condition: 'missing-schema-version' },
      stage: DECODE_STAGE,
      sourcePackage,
      sourceSpan,
      message: `Candidate does not declare a usable ${SCHEMA_VERSION_MEMBER}.`,
      reason,
      correctionSuggestion: `请在候选文档的顶层对象里声明 "${SCHEMA_VERSION_MEMBER}"，其值为非空字符串形式的 Schema 版本。`,
    }),
  });

  if (ast.kind !== 'object') {
    return reject(ast.span, `候选文档的顶层必须是对象，才能声明 "${SCHEMA_VERSION_MEMBER}"，实际是 ${ast.kind}。`);
  }

  const member = ast.members.find((entry) => entry.key === SCHEMA_VERSION_MEMBER);
  if (member === undefined) {
    return reject(ast.span, `候选文档的顶层对象缺少必需成员 "${SCHEMA_VERSION_MEMBER}"。`);
  }
  if (member.value.kind !== 'string') {
    return reject(
      member.value.span,
      `"${SCHEMA_VERSION_MEMBER}" 必须是字符串，实际是 ${member.value.kind}。`,
    );
  }
  if (member.value.value.length === 0 || member.value.value.trim() !== member.value.value) {
    return reject(
      member.value.span,
      `"${SCHEMA_VERSION_MEMBER}" 必须是非空且不含前后空白的字符串；空白差异会让同一版本产生两个身份。`,
    );
  }
  return { ok: true, value: member.value.value };
}

/**
 * 创建严格解码器。
 *
 * 顺序是刻意的：**先扣输入字节配额，再做 UTF-8 校验，最后才解析**。若先解码文本再查配额，
 * 一个超大候选已经在内存里物化了一份完整字符串，配额就没能起到"防输入炸弹"的作用（需求 9.4）。
 */
export function createStrictJsonDecoder(factory: UGCDiagnosticFactory): StructuralJsonDecoder {
  return Object.freeze({
    decode(document: CandidateDocument, budget: QuotaBudget): UgcResult<ParsedCandidateDocument> {
      const file = document.source.documentId;

      const inputViolation = budget.consume('inputBytes', document.utf8.length, {
        sourceSpan: documentAnchorSpan(file),
      });
      if (inputViolation !== null) {
        return ugcReject([
          failureToDiagnostic({ kind: 'quota', violation: inputViolation }, factory, document),
        ]);
      }

      // 空输入单列一类：它不是"某处语法写错了"，而是根本没有可解析的文档。
      if (document.utf8.length === 0) {
        return ugcReject([
          factory.document({
            selector: { category: 'JSON_SYNTAX', condition: 'truncated' },
            stage: DECODE_STAGE,
            sourcePackage: document.source.packageId,
            sourceSpan: documentAnchorSpan(file),
            message: 'Candidate document is empty.',
            reason: '候选文档为空，没有任何可解析的 JSON 内容。',
            correctionSuggestion: '请提交一个包含顶层 JSON 对象的非空文档。',
          }),
        ]);
      }

      const utf8Violation = findFirstUtf8Violation(document.utf8);
      if (utf8Violation !== null) {
        const point = { line: 1, column: 1, offset: utf8Violation.offset } as const;
        return ugcReject([
          factory.document({
            selector: { category: 'JSON_SYNTAX', condition: 'invalid-utf8' },
            stage: DECODE_STAGE,
            sourcePackage: document.source.packageId,
            sourceSpan: { file, start: point, end: point },
            message: `Invalid UTF-8 at byte ${String(utf8Violation.offset)}: ${utf8Violation.reason}.`,
            reason: `候选字节在偏移 ${String(utf8Violation.offset)} 处不是合法的 UTF-8：${UTF8_VIOLATION_TEXT[utf8Violation.reason]}。`,
            correctionSuggestion: '请以 UTF-8 重新编码该文档后再提交；不要混用其他字符编码。',
            actual: utf8Violation.reason,
          }),
        ]);
      }

      // UTF-8 已确认合法，因此这里的解码不会产生 U+FFFD 替换字符。
      const text = new TextDecoder('utf-8', { fatal: true }).decode(document.utf8);

      const scanned = new StrictJsonScanner(text, file, budget).scan();
      if (scanned.ok === false) {
        return ugcReject([failureToDiagnostic(scanned.failure, factory, document)]);
      }

      const schemaVersion = readSchemaVersion(scanned.ast, factory, document);
      if (schemaVersion.ok === false) {
        return ugcReject([schemaVersion.diagnostic]);
      }

      return ugcOk({
        source: document.source,
        targetOwnership: document.targetOwnership,
        schemaVersion: schemaVersion.value,
        ast: scanned.ast,
      });
    },
  });
}
