/**
 * 严格 UTF-8 字节校验（需求 2.1、2.8；design.md「Structural JSON decoder」）。
 *
 * 为什么不直接用 `new TextDecoder('utf-8', { fatal: true })` 了事：它确实会在非法字节上抛错，
 * 但**不报告位置**，而需求 2.8 要求解析诊断给出字节或行列位置。因此先用本模块定位第一个非法序列，
 * 再交给 TextDecoder 完成解码。
 *
 * 校验规则按 Unicode 标准的 well-formed UTF-8 子集（RFC 3629）：拒绝过长编码（overlong）、
 * 代理区编码（U+D800–U+DFFF）和超出 U+10FFFF 的序列。
 */

export interface Utf8Violation {
  /** 第一个非法字节的 0-based 偏移。 */
  readonly offset: number;
  readonly reason:
    | 'invalid-lead-byte'
    | 'unexpected-continuation'
    | 'truncated-sequence'
    | 'overlong-encoding'
    | 'surrogate-encoding'
    | 'code-point-too-large';
}

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0x80 && byte <= 0xbf;
}

/** 返回第一个非法序列的位置，全部合法时返回 `null`。单遍、O(n)、零分配。 */
export function findFirstUtf8Violation(bytes: Uint8Array): Utf8Violation | null {
  let index = 0;
  const length = bytes.length;

  while (index < length) {
    const lead = bytes[index];
    if (lead === undefined) break;

    if (lead <= 0x7f) {
      index += 1;
      continue;
    }

    if (lead >= 0x80 && lead <= 0xbf) {
      return { offset: index, reason: 'unexpected-continuation' };
    }

    if (lead === 0xc0 || lead === 0xc1) {
      return { offset: index, reason: 'overlong-encoding' };
    }

    if (lead >= 0xf5) {
      return { offset: index, reason: 'code-point-too-large' };
    }

    if (lead <= 0xdf) {
      const second = bytes[index + 1];
      if (!isContinuation(second)) {
        return { offset: index, reason: 'truncated-sequence' };
      }
      index += 2;
      continue;
    }

    if (lead <= 0xef) {
      const second = bytes[index + 1];
      const third = bytes[index + 2];
      if (!isContinuation(second) || !isContinuation(third)) {
        return { offset: index, reason: 'truncated-sequence' };
      }
      if (second === undefined) return { offset: index, reason: 'truncated-sequence' };
      if (lead === 0xe0 && second < 0xa0) {
        return { offset: index, reason: 'overlong-encoding' };
      }
      if (lead === 0xed && second > 0x9f) {
        return { offset: index, reason: 'surrogate-encoding' };
      }
      index += 3;
      continue;
    }

    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const fourth = bytes[index + 3];
    if (!isContinuation(second) || !isContinuation(third) || !isContinuation(fourth)) {
      return { offset: index, reason: 'truncated-sequence' };
    }
    if (second === undefined) return { offset: index, reason: 'truncated-sequence' };
    if (lead === 0xf0 && second < 0x90) {
      return { offset: index, reason: 'overlong-encoding' };
    }
    if (lead === 0xf4 && second > 0x8f) {
      return { offset: index, reason: 'code-point-too-large' };
    }
    index += 4;
  }

  return null;
}

/** 一个 Unicode code point 的 UTF-8 编码字节数。 */
export function utf8LengthOfCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export const UTF8_VIOLATION_TEXT: Readonly<Record<Utf8Violation['reason'], string>> = Object.freeze({
  'invalid-lead-byte': '不是合法的 UTF-8 起始字节',
  'unexpected-continuation': '出现了没有起始字节的 UTF-8 续接字节',
  'truncated-sequence': 'UTF-8 多字节序列不完整',
  'overlong-encoding': '使用了过长的 UTF-8 编码形式',
  'surrogate-encoding': '编码了 UTF-16 代理区码位，UTF-8 不允许',
  'code-point-too-large': '码位超出 Unicode 上限 U+10FFFF',
});
