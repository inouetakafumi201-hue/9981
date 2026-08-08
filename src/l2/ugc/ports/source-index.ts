/**
 * L2 → wakeup-ugc 端口：来源定位索引。
 *
 * 为什么需要它：l2 的 `SourceLocation` 只带 `line` / `column`（1 基），而 wakeup-ugc 端口要求的
 * 内核 `SourceSpan` 需要 `{ file, start, end }`，且每个 `SourcePoint` 必须给出 **0 基 UTF-8 字节偏移**。
 * 字节偏移不能由行列直接推算——它取决于该行前缀的实际 UTF-8 编码长度（中文、emoji 与 ASCII 不同宽）。
 * 因此本模块在文本上建一次索引，之后把任意 (line, column) 常数时间地映射为完整 `SourcePoint`。
 *
 * 定位基准（重要，且是本端口的显式契约）：
 * wakeup-ugc 交给基类层的是**规范化之后**的候选（`CanonicalCandidate.canonicalJson` /
 * `decodedValue`），原始创作字节留在 UGC 侧。因此 l2 报出的行列是「规范化文档内的位置」，
 * `SourceSpan.file` 填 UGC 的 `source.documentId` 以保证可追溯到同一份文档。
 * 若未来需要把位置回映到创作者原始字节，需要 UGC 侧提供 canonical→original 的位置映射，
 * 那是 UGC 侧的交接项，不是基类层能单方面解决的（见本目录 README 段落与回流记录）。
 */

import type { SourcePoint, SourceSpan } from '../../../core/kernel/state/diagnostic.js';

const utf8Encoder = new TextEncoder();

/** 规范化文档的位置索引。 */
export interface SourceIndex {
  /** 用作 `SourceSpan.file` 的文档标识（UGC 的 `CandidateSource.documentId`）。 */
  readonly documentId: string;
  /** 文档总行数（至少 1）。 */
  readonly lineCount: number;
  /** 把 1 基行列映射为内核 `SourcePoint`；越界值被夹紧到文档范围内。 */
  point(line: number | undefined, column: number | undefined): SourcePoint;
  /**
   * 把 1 基行列映射为零宽 `SourceSpan`。
   *
   * 之所以是零宽：l2 诊断只携带单个起始位置，不携带结束位置。伪造一个更宽的区间会让创作者
   * 以为该范围内的全部内容都有问题，因此这里如实表达「一个点」。
   */
  span(line: number | undefined, column: number | undefined): SourceSpan;
  /** 文档锚点（第 1 行第 1 列，偏移 0）。用于「必须给出来源文档但无法定位到具体位置」的场合。 */
  anchor(): SourceSpan;
}

/**
 * 为一段文本建立位置索引。
 *
 * 行拆分只按 `\n`：规范化 JSON 由 UGC 的 canonicalizer 产出，它不插入 `\r`，
 * 而 l2 扫描器的行号也只在遇到 `\n` 时递增，两侧口径一致。
 */
export function createSourceIndex(documentId: string, text: string): SourceIndex {
  const lines = text.split('\n');
  // 每行起始的 UTF-8 字节偏移。第 i 行（0 基）起始偏移 = lineByteStarts[i]。
  const lineByteStarts = new Array<number>(lines.length);
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    lineByteStarts[index] = cursor;
    // +1 为该行末尾的 '\n'（最后一行没有换行符，但它的下一行不存在，不会被读取）。
    cursor += utf8Encoder.encode(lines[index] ?? '').length + 1;
  }

  const clampLine = (line: number | undefined): number => {
    if (line === undefined || !Number.isInteger(line) || line < 1) {
      return 1;
    }
    return line > lines.length ? lines.length : line;
  };

  const point = (line: number | undefined, column: number | undefined): SourcePoint => {
    const effectiveLine = clampLine(line);
    const lineText = lines[effectiveLine - 1] ?? '';
    // 列的合法范围是 [1, lineText 的码点数 + 1]：末尾之后一位表示「行尾」。
    const codePoints = Array.from(lineText);
    let effectiveColumn: number;
    if (column === undefined || !Number.isInteger(column) || column < 1) {
      effectiveColumn = 1;
    } else {
      effectiveColumn = column > codePoints.length + 1 ? codePoints.length + 1 : column;
    }
    const prefix = codePoints.slice(0, effectiveColumn - 1).join('');
    const offset = (lineByteStarts[effectiveLine - 1] ?? 0) + utf8Encoder.encode(prefix).length;
    return { line: effectiveLine, column: effectiveColumn, offset };
  };

  const span = (line: number | undefined, column: number | undefined): SourceSpan => {
    const anchorPoint = point(line, column);
    return { file: documentId, start: anchorPoint, end: anchorPoint };
  };

  return Object.freeze({
    documentId,
    lineCount: lines.length,
    point,
    span,
    anchor(): SourceSpan {
      return span(1, 1);
    },
  });
}
