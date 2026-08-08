/**
 * L2 Codec: 手写 JSON 扫描器（带位置与重复成员检测）。
 *
 * 为什么不用 `JSON.parse`：
 * 1. Requirements 11.3 要求解析失败返回**来源位置**与原因；`JSON.parse` 只给一条消息。
 * 2. Requirements 11.2 要求把禁止构造定位到 **JSON 路径**；需要每个键的位置。
 * 3. Requirements 11.4 要求保留**每个** Semantic_Field；`JSON.parse` 会静默丢弃重复成员中
 *    除最后一个以外的全部，导致语义字段被无声吞掉。
 *
 * 扫描器只识别 RFC 8259 的纯 JSON 语法：不接受注释、尾随逗号、单引号、
 * `NaN` / `Infinity` / `undefined`，也不执行任何输入内容。
 */

/** 源码位置（1 基行列，0 基偏移）。 */
export interface Position {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface JsonMemberNode {
  readonly key: string;
  readonly keyPosition: Position;
  readonly value: JsonNode;
}

export type JsonNode =
  | { readonly kind: 'object'; readonly members: readonly JsonMemberNode[]; readonly position: Position }
  | { readonly kind: 'array'; readonly elements: readonly JsonNode[]; readonly position: Position }
  | { readonly kind: 'string'; readonly value: string; readonly position: Position }
  | { readonly kind: 'number'; readonly value: number; readonly position: Position }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly position: Position }
  | { readonly kind: 'null'; readonly position: Position };

/** 重复成员记录。 */
export interface DuplicateMember {
  readonly jsonPath: string;
  readonly key: string;
  readonly firstPosition: Position;
  readonly duplicatePosition: Position;
}

export interface ScanFailure {
  readonly ok: false;
  readonly message: string;
  readonly position: Position;
}

export interface ScanSuccess {
  readonly ok: true;
  readonly root: JsonNode;
  readonly duplicates: readonly DuplicateMember[];
}

export type ScanResult = ScanSuccess | ScanFailure;

class ScanError extends Error {
  constructor(
    message: string,
    readonly position: Position,
  ) {
    super(message);
    this.name = 'ScanError';
  }
}

class Scanner {
  private index = 0;
  private line = 1;
  private column = 1;
  readonly duplicates: DuplicateMember[] = [];

  constructor(private readonly text: string) {}

  position(): Position {
    return { offset: this.index, line: this.line, column: this.column };
  }

  private advance(count = 1): void {
    for (let step = 0; step < count; step += 1) {
      const char = this.text[this.index];
      this.index += 1;
      if (char === '\n') {
        this.line += 1;
        this.column = 1;
      } else {
        this.column += 1;
      }
    }
  }

  private peek(): string | undefined {
    return this.text[this.index];
  }

  private atEnd(): boolean {
    return this.index >= this.text.length;
  }

  private fail(message: string): never {
    throw new ScanError(message, this.position());
  }

  private skipWhitespace(): void {
    while (!this.atEnd()) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        this.advance();
        continue;
      }
      if (char === '/') {
        this.fail('纯声明式 JSON 不允许注释');
      }
      return;
    }
  }

  private expect(char: string): void {
    if (this.peek() !== char) {
      this.fail(`期望字符 ${JSON.stringify(char)}，实际为 ${this.atEnd() ? '输入结束' : JSON.stringify(this.peek())}`);
    }
    this.advance();
  }

  parseDocument(): JsonNode {
    this.skipWhitespace();
    const root = this.parseValue('');
    this.skipWhitespace();
    if (!this.atEnd()) {
      this.fail('顶层值之后存在多余内容');
    }
    return root;
  }

  private parseValue(path: string): JsonNode {
    this.skipWhitespace();
    if (this.atEnd()) {
      this.fail('输入在期望值处结束');
    }
    const char = this.peek()!;
    if (char === '{') {
      return this.parseObject(path);
    }
    if (char === '[') {
      return this.parseArray(path);
    }
    if (char === '"') {
      const position = this.position();
      return { kind: 'string', value: this.parseString(), position };
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      return this.parseNumber();
    }
    if (this.text.startsWith('true', this.index)) {
      const position = this.position();
      this.advance(4);
      return { kind: 'boolean', value: true, position };
    }
    if (this.text.startsWith('false', this.index)) {
      const position = this.position();
      this.advance(5);
      return { kind: 'boolean', value: false, position };
    }
    if (this.text.startsWith('null', this.index)) {
      const position = this.position();
      this.advance(4);
      return { kind: 'null', position };
    }
    if (
      this.text.startsWith('NaN', this.index) ||
      this.text.startsWith('Infinity', this.index) ||
      this.text.startsWith('-Infinity', this.index) ||
      this.text.startsWith('undefined', this.index)
    ) {
      this.fail('纯声明式 JSON 不允许 NaN / Infinity / undefined');
    }
    if (char === "'") {
      this.fail('纯声明式 JSON 字符串必须使用双引号');
    }
    this.fail(`无法识别的值起始字符 ${JSON.stringify(char)}`);
  }

  private parseObject(path: string): JsonNode {
    const position = this.position();
    this.expect('{');
    const members: JsonMemberNode[] = [];
    const seen = new Map<string, Position>();
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.advance();
      return { kind: 'object', members: Object.freeze(members), position };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== '"') {
        this.fail('对象成员名必须是双引号字符串');
      }
      const keyPosition = this.position();
      const key = this.parseString();
      const firstPosition = seen.get(key);
      if (firstPosition !== undefined) {
        this.duplicates.push({ jsonPath: path, key, firstPosition, duplicatePosition: keyPosition });
      } else {
        seen.set(key, keyPosition);
      }
      this.skipWhitespace();
      this.expect(':');
      const value = this.parseValue(`${path}/${key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`);
      members.push({ key, keyPosition, value });
      this.skipWhitespace();
      const next = this.peek();
      if (next === ',') {
        this.advance();
        this.skipWhitespace();
        if (this.peek() === '}') {
          this.fail('纯声明式 JSON 不允许尾随逗号');
        }
        continue;
      }
      if (next === '}') {
        this.advance();
        return { kind: 'object', members: Object.freeze(members), position };
      }
      this.fail('对象成员之后期望 , 或 }');
    }
  }

  private parseArray(path: string): JsonNode {
    const position = this.position();
    this.expect('[');
    const elements: JsonNode[] = [];
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.advance();
      return { kind: 'array', elements: Object.freeze(elements), position };
    }
    for (;;) {
      const element = this.parseValue(`${path}/${elements.length}`);
      elements.push(element);
      this.skipWhitespace();
      const next = this.peek();
      if (next === ',') {
        this.advance();
        this.skipWhitespace();
        if (this.peek() === ']') {
          this.fail('纯声明式 JSON 不允许尾随逗号');
        }
        continue;
      }
      if (next === ']') {
        this.advance();
        return { kind: 'array', elements: Object.freeze(elements), position };
      }
      this.fail('数组元素之后期望 , 或 ]');
    }
  }

  private parseString(): string {
    this.expect('"');
    let out = '';
    for (;;) {
      if (this.atEnd()) {
        this.fail('字符串在输入结束前未闭合');
      }
      const char = this.peek()!;
      if (char === '"') {
        this.advance();
        return out;
      }
      if (char === '\\') {
        this.advance();
        if (this.atEnd()) {
          this.fail('转义序列在输入结束前未完成');
        }
        const escape = this.peek()!;
        this.advance();
        switch (escape) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const hex = this.text.slice(this.index, this.index + 4);
            if (!/^[0-9a-fA-F]{4}$/u.test(hex)) {
              this.fail('\\u 转义需要 4 位十六进制数字');
            }
            out += String.fromCharCode(Number.parseInt(hex, 16));
            this.advance(4);
            break;
          }
          default:
            this.fail(`不合法的转义字符 ${JSON.stringify(escape)}`);
        }
        continue;
      }
      const code = char.charCodeAt(0);
      if (code < 0x20) {
        this.fail('字符串中不允许未转义的控制字符');
      }
      out += char;
      this.advance();
    }
  }

  private parseNumber(): JsonNode {
    const position = this.position();
    const start = this.index;
    if (this.peek() === '-') {
      this.advance();
    }
    if (this.peek() === '0') {
      this.advance();
      if (this.peek() !== undefined && /[0-9]/u.test(this.peek()!)) {
        this.fail('数字不允许前导零');
      }
    } else if (this.peek() !== undefined && /[1-9]/u.test(this.peek()!)) {
      while (this.peek() !== undefined && /[0-9]/u.test(this.peek()!)) {
        this.advance();
      }
    } else {
      this.fail('数字整数部分缺失');
    }
    if (this.peek() === '.') {
      this.advance();
      if (this.peek() === undefined || !/[0-9]/u.test(this.peek()!)) {
        this.fail('小数点后需要至少一位数字');
      }
      while (this.peek() !== undefined && /[0-9]/u.test(this.peek()!)) {
        this.advance();
      }
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') {
        this.advance();
      }
      if (this.peek() === undefined || !/[0-9]/u.test(this.peek()!)) {
        this.fail('指数部分需要至少一位数字');
      }
      while (this.peek() !== undefined && /[0-9]/u.test(this.peek()!)) {
        this.advance();
      }
    }
    const raw = this.text.slice(start, this.index);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new ScanError(`数字 ${raw} 不是有限值`, position);
    }
    return { kind: 'number', value, position };
  }
}

/** 扫描 JSON 文本；不抛异常，失败以结果形式返回。 */
export function scanJson(text: string): ScanResult {
  const scanner = new Scanner(text);
  try {
    const root = scanner.parseDocument();
    return { ok: true, root, duplicates: Object.freeze(scanner.duplicates.slice()) };
  } catch (error) {
    if (error instanceof ScanError) {
      return { ok: false, message: error.message, position: error.position };
    }
    return {
      ok: false,
      message: `扫描器内部异常：${error instanceof Error ? error.message : String(error)}`,
      position: scanner.position(),
    };
  }
}

/**
 * 把语法树转换为纯 `JsonValue`。
 * 重复成员按"后者覆盖前者"处理，与 `JSON.parse` 一致；
 * 重复本身已由 `scanJson` 记录，不会被静默吞掉。
 */
export function nodeToJsonValue(node: JsonNode): unknown {
  switch (node.kind) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const member of node.members) {
        out[member.key] = nodeToJsonValue(member.value);
      }
      return out;
    }
    case 'array':
      return node.elements.map((element) => nodeToJsonValue(element));
    case 'string':
      return node.value;
    case 'number':
      return node.value;
    case 'boolean':
      return node.value;
    case 'null':
      return null;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

/** 在语法树上按 JSON 路径查找节点位置，供诊断定位。 */
export function findPosition(root: JsonNode, jsonPath: string): Position | undefined {
  if (jsonPath === '') {
    return root.position ?? undefined;
  }
  const segments = jsonPath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'));
  let current: JsonNode = root;
  let position: Position | undefined = current.position;
  for (const segment of segments) {
    if (current.kind === 'object') {
      const member = current.members.find((candidate) => candidate.key === segment);
      if (member === undefined) {
        return position;
      }
      position = member.keyPosition;
      current = member.value;
      continue;
    }
    if (current.kind === 'array') {
      const index = Number.parseInt(segment, 10);
      const element = Number.isInteger(index) ? current.elements[index] : undefined;
      if (element === undefined) {
        return position;
      }
      position = element.position;
      current = element;
      continue;
    }
    return position;
  }
  return position;
}

/**
 * 遍历语法树，对每个节点恰好回调一次（路径为 RFC 6901 风格）。
 * `key` / `keyPosition` 仅在该节点是某个对象成员的值时提供。
 */
export function walkJson(
  node: JsonNode,
  visit: (path: string, node: JsonNode, key?: string, keyPosition?: Position) => void,
  path = '',
  key?: string,
  keyPosition?: Position,
): void {
  visit(path, node, key, keyPosition);
  if (node.kind === 'object') {
    for (const member of node.members) {
      const childPath = `${path}/${member.key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`;
      walkJson(member.value, visit, childPath, member.key, member.keyPosition);
    }
    return;
  }
  if (node.kind === 'array') {
    node.elements.forEach((element, index) => {
      walkJson(element, visit, `${path}/${index}`);
    });
  }
}
