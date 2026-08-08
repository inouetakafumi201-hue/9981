/**
 * 规范化产物类型（design.md「Schema migration and canonicalization」/ 需求 11.1-11.9）。
 */
import type { ChangeRequestBinding } from './binding.js';
import type { CandidateSource, TargetOwnership } from './candidate.js';

export interface CanonicalCandidate {
  readonly source: CandidateSource;
  readonly targetOwnership: TargetOwnership;
  readonly schemaVersion: string;
  /** 规范化 JSON 字节序列的文本形式。相同定义在相同 Schema 版本下必然字节相同。 */
  readonly canonicalJson: string;
  /** 只由 `canonicalJson` 派生。它表示内容，不表示来源真实性。 */
  readonly canonicalFingerprint: string;
  /**
   * 规范化后的普通 JSON 值，**仅**用于传给冻结的基类层端口。
   * 到这一步重复成员、非有限数字和禁止构造都已被拒绝，因此物化为普通对象是安全的。
   */
  readonly decodedValue: unknown;
  readonly migrationIds: readonly string[];
}

/** 规范化候选 + 封存的变更请求绑定。后续阶段只消费该封存请求，不再回看可变输入。 */
export interface CanonicalizedChangeRequest {
  readonly candidate: CanonicalCandidate;
  readonly binding: ChangeRequestBinding;
  readonly changeRequestFingerprint: string;
}
