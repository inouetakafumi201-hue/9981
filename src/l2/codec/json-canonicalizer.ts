/**
 * L2 Codec: Canonical JSON 输出与规范化往返（Requirements 11.5–11.7、15.3）。
 *
 * 规范化在 `JsonValue` 层面进行：递归按键名排序、归一化 -0、拒绝非有限数字。
 * 它只消除非语义表示差异（键序、空白），不添加、删除或重解释任何语义字段。
 *
 * 往返性质（Property 6/7）：
 *   parse(s) → jsonValue → canonicalize → parse → 等价 jsonValue
 * 由于规范化只重排键序，两次解析得到的语义内容一致。
 */

import { canonicalizeJsonValue, compareStrings } from '../model/ordering';
import type { JsonValue } from '../model/json';
import { isJsonValue } from '../model/json';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import { errorDiagnostic, structuredRejection } from '../model/diagnostic-factory';
import type { Result } from '../model/result';
import { ok } from '../model/result';
import { scanJson } from './json-scanner';
import { nodeToJsonValue } from './json-scanner';

/** 规范化缩进（两空格）。缩进是纯表现，不影响语义等价。 */
const INDENT = '  ';

/** 把已规范化的 JsonValue 递归美化输出。键已在 canonicalizeJsonValue 中排序。 */
function emit(value: JsonValue, depth: number): string {
  if (value === null || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const inner = value
      .map((element) => `${INDENT.repeat(depth + 1)}${emit(element, depth + 1)}`)
      .join(',\n');
    return `[\n${inner}\n${INDENT.repeat(depth)}]`;
  }
  const record = value as Record<string, JsonValue>;
  const keys = Object.keys(record).sort(compareStrings);
  if (keys.length === 0) {
    return '{}';
  }
  const inner = keys
    .map((key) => `${INDENT.repeat(depth + 1)}${JSON.stringify(key)}: ${emit(record[key] as JsonValue, depth + 1)}`)
    .join(',\n');
  return `{\n${inner}\n${INDENT.repeat(depth)}}`;
}

/** 把任意 JsonValue 规范化为确定性、语法有效的声明式 JSON 字符串。 */
export function canonicalizeValue(value: JsonValue): string {
  return emit(canonicalizeJsonValue(value), 0);
}

/**
 * 规范化一段声明式 JSON 文本。
 * 先扫描（保证输入语法有效且无重复成员歧义），再规范化输出。
 */
export function canonicalize(input: string): Result<string> {
  const scan = scanJson(input);
  if (!scan.ok) {
    return structuredRejection([
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_PARSE_ERROR,
        reason: `规范化前解析失败（行 ${scan.position.line} 列 ${scan.position.column}）：${scan.message}`,
        correctionSuggestion: '先修正语法错误，再进行规范化。',
        sourceLocation: { sourceFile: '<canonicalize>', section: 'input', line: scan.position.line, column: scan.position.column },
      }),
    ]);
  }
  const raw = nodeToJsonValue(scan.root);
  if (!isJsonValue(raw)) {
    return structuredRejection([
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_NON_FINITE_NUMBER,
        reason: '输入包含无法规范化的值（非有限数字或非法结构）。',
        correctionSuggestion: '仅使用对象、数组、字符串、有限数字、布尔与 null。',
        sourceLocation: { sourceFile: '<canonicalize>', section: 'input' },
      }),
    ]);
  }
  return ok(canonicalizeValue(raw));
}

/** 解析规范化 JSON 为 JsonValue（供往返比较）。 */
export function parseCanonical(canonicalJson: string): Result<JsonValue> {
  const scan = scanJson(canonicalJson);
  if (!scan.ok) {
    return structuredRejection([
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_PARSE_ERROR,
        reason: `Canonical JSON 再解析失败：${scan.message}`,
        correctionSuggestion: '规范化输出应始终可再解析；若失败说明规范化器有缺陷。',
        sourceLocation: { sourceFile: '<parseCanonical>', section: 'input', line: scan.position.line, column: scan.position.column },
      }),
    ]);
  }
  const raw = nodeToJsonValue(scan.root);
  if (!isJsonValue(raw)) {
    return structuredRejection([
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_NON_FINITE_NUMBER,
        reason: 'Canonical JSON 含非法值。',
        correctionSuggestion: '检查规范化器输出。',
        sourceLocation: { sourceFile: '<parseCanonical>', section: 'input' },
      }),
    ]);
  }
  return ok(raw);
}

/** 语义等价：两段 JSON 规范化后字节一致即等价（忽略键序与空白）。 */
export function equivalentJson(left: string, right: string): boolean {
  const a = canonicalize(left);
  const b = canonicalize(right);
  if (a.rejected || b.rejected) {
    return false;
  }
  return a.value === b.value;
}
