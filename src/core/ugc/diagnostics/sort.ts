/**
 * 诊断确定性排序与跨来源等价比较（design.md「Diagnostics」/ 需求 3.10、14.8、14.9、11.11）。
 *
 * 排序键（固定顺序）：
 *   sourcePackage → sourceSpan.file → sourceSpan.start.offset(null 最后) → definitionId(null 最后)
 *   → jsonPath(null 最后) → code → rootCauseId
 *
 * 不依赖 Adapter 提交时间、对象键遍历顺序或哈希表迭代顺序。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic';
import { compareCodePoints, compareNullableCodePoints } from '../model/fingerprint';

function nullableOffset(diagnostic: Diagnostic): number | null {
  return diagnostic.sourceSpan?.start.offset ?? null;
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function definitionIdOf(diagnostic: Diagnostic): string | null {
  return diagnostic.at?.def ?? null;
}

function jsonPathOf(diagnostic: Diagnostic): string | null {
  return diagnostic.path ?? null;
}

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  const byPackage = compareNullableCodePoints(left.sourcePackage ?? null, right.sourcePackage ?? null);
  if (byPackage !== 0) return byPackage;

  const byFile = compareNullableCodePoints(left.sourceSpan?.file ?? null, right.sourceSpan?.file ?? null);
  if (byFile !== 0) return byFile;

  const byOffset = compareNullableNumbers(nullableOffset(left), nullableOffset(right));
  if (byOffset !== 0) return byOffset;

  const byDefinition = compareNullableCodePoints(definitionIdOf(left), definitionIdOf(right));
  if (byDefinition !== 0) return byDefinition;

  const byPath = compareNullableCodePoints(jsonPathOf(left), jsonPathOf(right));
  if (byPath !== 0) return byPath;

  const byCode = compareCodePoints(left.code, right.code);
  if (byCode !== 0) return byCode;

  return compareNullableCodePoints(left.rootCauseId ?? null, right.rootCauseId ?? null);
}

/** 返回新数组的稳定排序，不修改输入。 */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return Object.freeze([...diagnostics].sort(compareDiagnostics));
}

/**
 * 跨来源等价投影。
 *
 * 需求 3.10 要求"等价候选经不同 Adapter 提交时诊断等价"，但来源包/文档标识本身**合法地不同**，
 * 所以比较前必须把它们投影掉。同时刻意**不**投影 code、severity、scope、reason class（messageKey）、
 * JSON path、expected/actual 和相对顺序——把这些也忽略掉就会让"来源不同导致规则不同"的真实缺陷逃过检测。
 */
export interface DiagnosticEquivalenceProjection {
  readonly code: string;
  readonly severity: string;
  readonly scope: string | null;
  readonly reasonClass: string | null;
  readonly jsonPath: string | null;
  readonly definitionId: string | null;
  readonly expected: string;
  readonly actual: string;
  readonly hasSourceSpan: boolean;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return '\u0000undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => compareCodePoints(leftKey, rightKey))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

export function projectForEquivalence(diagnostic: Diagnostic): DiagnosticEquivalenceProjection {
  return Object.freeze({
    code: diagnostic.code,
    severity: diagnostic.severity,
    scope: diagnostic.scope ?? null,
    reasonClass: diagnostic.messageKey ?? null,
    jsonPath: jsonPathOf(diagnostic),
    definitionId: definitionIdOf(diagnostic),
    expected: stableStringify(diagnostic.expected),
    actual: stableStringify(diagnostic.actual),
    hasSourceSpan: diagnostic.sourceSpan !== null && diagnostic.sourceSpan !== undefined,
  });
}

/** 两个已排序诊断序列在忽略合法来源身份差异后是否等价（含相对顺序）。 */
export function diagnosticsEquivalent(left: readonly Diagnostic[], right: readonly Diagnostic[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (leftItem === undefined || rightItem === undefined) return false;
    if (stableStringify(projectForEquivalence(leftItem)) !== stableStringify(projectForEquivalence(rightItem))) {
      return false;
    }
  }
  return true;
}
