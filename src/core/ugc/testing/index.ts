/**
 * UGC 受限 Test Interface 导出根。
 *
 * 这里**不导出**任何能铸造验证产物、跳过配额或直写注册表的能力——那正是本模块要防止的。
 */
export type { GeneratedCandidate, InvalidPattern } from './generators';
export {
  INVALID_PATTERNS,
  arbitraryBomb,
  arbitraryBytes,
  arbitraryValidCandidate,
  candidateForPattern,
  requestFrom,
  sourceKindArbitrary,
  validCandidateText,
} from './generators';

export type { RejectionFacts, StageObservation } from './observer';
export { activationUnchanged, diagnosticsOfCode, observe, rejectionFacts } from './observer';
