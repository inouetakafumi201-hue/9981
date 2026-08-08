/**
 * 稳定指纹端口与域分隔、长度前缀编码（design.md「Schema migration and canonicalization」）。
 *
 * 指纹只表示"被编码内容"，不表示来源真实性，也不是签名。任何两个语义不同的字段组合必须编码为
 * 不同字节序列——这依赖长度前缀，而不是分隔符转义：分隔符方案在字段值本身含分隔符时会产生歧义
 * （`a|b` + `c` 与 `a` + `b|c` 编码相同），长度前缀从结构上排除这种碰撞。
 */

/** 注入式指纹计算器。默认实现见 `ports/sha256-fingerprint-gateway.ts`，测试可替换为确定性替身。 */
export interface StableFingerprintGateway {
  /** 参与 Validation Baseline 的算法标识；算法变化必须使旧基线过期。 */
  readonly algorithmId: string;
  /** 对 UTF-8 字节序列计算稳定指纹（小写十六进制）。 */
  fingerprintBytes(bytes: Uint8Array): string;
  /** 对文本按 UTF-8 编码后计算稳定指纹（小写十六进制）。 */
  fingerprintText(text: string): string;
}

/** 一个待编码字段。`value` 为 `null` 表示"结构上适用但取值为空"，与空字符串严格区分。 */
export interface FingerprintField {
  readonly label: string;
  readonly value: string | null;
}

const utf8Encoder = new TextEncoder();

/** UTF-8 字节长度。使用字节长度而非 `String.length`，避免代理对与 BMP 外字符造成长度歧义。 */
export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}

/** 长度前缀编码单元：`<utf8字节长度>:<内容>`。 */
function lengthPrefixed(text: string): string {
  return `${utf8ByteLength(text)}:${text}`;
}

/**
 * 域分隔、长度前缀的稳定编码。
 *
 * 结构：`U1<域>` 后接每个字段的 `<标签>` + 取值标记（`s` 有值 / `n` 显式 null）+ `<取值>`。
 * `U1` 是编码版本前缀：编码规则若变化必须提升它，使历史指纹不会与新指纹混淆。
 */
export function encodeFingerprintPayload(domain: string, fields: readonly FingerprintField[]): string {
  const parts: string[] = ['U1', lengthPrefixed(domain), lengthPrefixed(String(fields.length))];
  for (const field of fields) {
    parts.push(lengthPrefixed(field.label));
    if (field.value === null) {
      parts.push('n');
    } else {
      parts.push('s', lengthPrefixed(field.value));
    }
  }
  return parts.join('');
}

/** 对一组域分隔字段计算指纹。 */
export function fingerprintFields(
  gateway: StableFingerprintGateway,
  domain: string,
  fields: readonly FingerprintField[],
): string {
  return gateway.fingerprintText(encodeFingerprintPayload(domain, fields));
}

/**
 * Unicode code point 全序比较。
 *
 * 不使用 `String.prototype.localeCompare`（locale 相关）也不使用默认 `<`（按 UTF-16 code unit 比较，
 * 会把 BMP 外字符排到 U+E000–U+FFFF 之前，即所谓 surrogate 排序异常）。需求 11.2 要求"一个有文档记录的、
 * locale 无关的全序"，因此这里显式按 code point 逐位比较。
 */
export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    const leftChar = leftPoints[index];
    const rightChar = rightPoints[index];
    if (leftChar === undefined || rightChar === undefined) break;
    const leftCode = leftChar.codePointAt(0) ?? 0;
    const rightCode = rightChar.codePointAt(0) ?? 0;
    if (leftCode !== rightCode) return leftCode < rightCode ? -1 : 1;
  }
  if (leftPoints.length === rightPoints.length) return 0;
  return leftPoints.length < rightPoints.length ? -1 : 1;
}

/** `null` 排在最后的可空 code point 比较，用于诊断排序键。 */
export function compareNullableCodePoints(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareCodePoints(left, right);
}
