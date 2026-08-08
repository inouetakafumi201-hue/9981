/**
 * `State_Revision` 复合令牌与全序比较（design.md §4.1、J-1）。
 *
 * 内核没有修订版本概念，而 `semanticStateFingerprint` 只能判等不能判序（design.md C-4）。
 * 因此令牌分两段：`sequence` 判序（候选来源是内核 `world.logSeq`，由 `RevisionPort` 提供），
 * `fingerprint` 判等（取 `ReadOnlySemanticProjection.semanticStateFingerprint`）。
 *
 * `sequence` 相同而 `fingerprint` 不同必须显式返回 `'uncomparable'`，不得静默当作 `'same'`
 * ——静默相等会让 UI 把两个不同的语义状态当成同一个，这是最危险的失效形态。
 */

import { UI_DIAGNOSTIC_CODES, uiDiagnostic, uiOk, uiRejected, type UiResult } from './diagnostic.js';

export interface StateRevision {
  /** 顺序段：单调不减、裁剪后不复用。用于判序。 */
  readonly sequence: number;
  /** 等价段：语义状态内容指纹。用于判等。 */
  readonly fingerprint: string;
}

export const REVISION_ORDER = { NEWER: 1, SAME: 0, OLDER: -1 } as const;

export type RevisionComparison = 'newer' | 'same' | 'older' | 'uncomparable';

/**
 * 全序比较：返回 `a` 相对 `b` 的位置。
 *
 * 在 `sequence` 维度上满足全序（自反、反对称、传递）；`sequence` 相等时退化为判等，
 * 指纹不同即 `'uncomparable'`。
 */
export function compareRevision(a: StateRevision, b: StateRevision): RevisionComparison {
  if (a.sequence > b.sequence) return 'newer';
  if (a.sequence < b.sequence) return 'older';
  return a.fingerprint === b.fingerprint ? 'same' : 'uncomparable';
}

/** `cached` 是否已被 `incoming` 取代（Requirement 2.8）。 */
export function isSuperseded(cached: StateRevision, incoming: StateRevision): boolean {
  return compareRevision(incoming, cached) === 'newer';
}

/** 两个令牌是否指向同一语义状态。 */
export function isSameRevision(a: StateRevision, b: StateRevision): boolean {
  return compareRevision(a, b) === 'same';
}

/**
 * 构造令牌。
 *
 * `sequence` 必须是非负整数（内核 `logSeq` 的形态）；`fingerprint` 必须非空。
 * 违反即结构化拒绝，携带 `JSON_SEMANTIC_FIELD_DAMAGED`——修订令牌是语义字段
 * （design.md §10.1 判定表把 `State_Revision` 归入 Semantic）。
 */
export function makeRevision(sequence: unknown, fingerprint: unknown): UiResult<StateRevision> {
  const location = 'model/revision';
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0) {
    return uiRejected([
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
        presentationLocation: location,
        reason: 'State_Revision 的 sequence 段必须是非负整数',
        correctionSuggestion: '由 RevisionPort 提供内核单调序号（候选来源 world.logSeq）',
      }),
    ]);
  }
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) {
    return uiRejected([
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_MISSING,
        presentationLocation: location,
        reason: 'State_Revision 的 fingerprint 段缺失',
        correctionSuggestion: '取 ReadOnlySemanticProjection.semanticStateFingerprint',
      }),
    ]);
  }
  return uiOk(Object.freeze({ sequence, fingerprint }));
}

/** 排序用的确定性比较子：先按 `sequence`，再按 `fingerprint` 的码点序。 */
export function revisionSortKey(revision: StateRevision): string {
  return `${String(revision.sequence).padStart(16, '0')}:${revision.fingerprint}`;
}
