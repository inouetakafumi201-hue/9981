/**
 * 来源游标：在扫描 JS 字符串的同时维护 UTF-8 字节偏移、行号和 code point 列号。
 *
 * 为什么要三套坐标：共享 `SourcePoint` 同时要求 1-based 行、1-based **code point** 列
 * 和 0-based **UTF-8 字节**偏移。字符串索引是 UTF-16 code unit，三者都不等于它，所以必须显式同步推进。
 * 尤其列号用 code point 计数：BMP 外字符（如 emoji）占两个 code unit，按 code unit 计列会让创作者看到
 * 与编辑器不一致的列号。
 */
import type { SourcePoint, SourceSpan } from '../../kernel/state/diagnostic.js';
import { utf8LengthOfCodePoint } from './utf8.js';

export class SourceCursor {
  /** UTF-16 code unit 索引，用于字符串取值。 */
  private index = 0;
  private byteOffset = 0;
  private line = 1;
  private column = 1;

  constructor(
    private readonly text: string,
    private readonly file: string,
  ) {}

  atEnd(): boolean {
    return this.index >= this.text.length;
  }

  /** 当前 code point（不推进）。到达末尾返回 `null`。 */
  peekCodePoint(): number | null {
    if (this.atEnd()) return null;
    return this.text.codePointAt(this.index) ?? null;
  }

  /** 当前位置的单个 UTF-16 code unit 字符（不推进）。到达末尾返回 `null`。 */
  peekChar(): string | null {
    if (this.atEnd()) return null;
    return this.text.charAt(this.index);
  }

  /** 相对当前位置向前看 `ahead` 个 code unit 的字符。 */
  peekCharAt(ahead: number): string | null {
    const target = this.index + ahead;
    if (target >= this.text.length) return null;
    return this.text.charAt(target);
  }

  point(): SourcePoint {
    return { line: this.line, column: this.column, offset: this.byteOffset };
  }

  spanFrom(start: SourcePoint): SourceSpan {
    return { file: this.file, start, end: this.point() };
  }

  spanOfCurrent(): SourceSpan {
    const start = this.point();
    return { file: this.file, start, end: start };
  }

  /**
   * 消耗一个 code point 并同步三套坐标。
   *
   * 换行按 JSON 的字面文本处理：`\n` 递增行号并把列重置为 1。`\r` 不单独递增行号——
   * CRLF 中的 `\r` 会与随后的 `\n` 一起只算一行；孤立的 `\r` 只推进列。这样 CRLF 文件的行号
   * 与创作者编辑器显示一致。
   */
  advance(): number | null {
    const codePoint = this.peekCodePoint();
    if (codePoint === null) return null;
    const unitLength = codePoint > 0xffff ? 2 : 1;
    this.index += unitLength;
    this.byteOffset += utf8LengthOfCodePoint(codePoint);
    if (codePoint === 0x0a) {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return codePoint;
  }

  /** 跳过 JSON 允许的四种空白字符：空格、制表符、换行、回车。 */
  skipWhitespace(): void {
    while (!this.atEnd()) {
      const codePoint = this.peekCodePoint();
      if (codePoint === 0x20 || codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
        this.advance();
        continue;
      }
      return;
    }
  }

  /** 当前 UTF-8 字节偏移，用于配额与诊断。 */
  currentByteOffset(): number {
    return this.byteOffset;
  }

  fileName(): string {
    return this.file;
  }
}
