/**
 * UGC 模型层导出根。只包含不可变值类型、纯函数与稳定编码；不含任何 I/O、注册表或运行时写入能力。
 */
export type { UgcOk, UgcRejected, UgcResult } from './result.js';
export {
  diagnosticIntegrityFailure,
  hasBlockingDiagnostic,
  isBlockingDiagnostic,
  propagate,
  ugcOk,
  ugcReject,
  unwrap,
} from './result.js';

export type { FingerprintField, StableFingerprintGateway } from './fingerprint.js';
export {
  compareCodePoints,
  compareNullableCodePoints,
  encodeFingerprintPayload,
  fingerprintFields,
  utf8ByteLength,
} from './fingerprint.js';

export type {
  CandidateChangeRequest,
  CandidateDocument,
  CandidateSource,
  CandidateSourceKind,
  ChangeOperation,
  TargetOwnership,
  UGCAdapter,
} from './candidate.js';
export {
  CANDIDATE_SOURCE_KINDS,
  CHANGE_OPERATIONS,
  TARGET_OWNERSHIPS,
  candidateFromText,
  copyCandidateBytes,
  createCandidateChangeRequest,
  createCandidateDocument,
  createCandidateSource,
  isCandidateSourceKind,
  isChangeOperation,
  isStableIdentity,
  isTargetOwnership,
} from './candidate.js';

export type { BindingFieldMismatch, ChangeRequestBinding, ChangeRequestBindingField } from './binding.js';
export {
  CHANGE_REQUEST_BINDING_FIELDS,
  CHANGE_REQUEST_DOMAIN,
  computeChangeRequestFingerprint,
  createChangeRequestBinding,
  diffChangeRequestBindings,
  encodeChangeRequestBindingFields,
} from './binding.js';

export type {
  BaselineComparisonField,
  BaselineComponentField,
  BaselineFieldMismatch,
  ValidationBaseline,
  ValidationBaselineComponents,
} from './baseline.js';
export {
  BASELINE_COMPARISON_FIELDS,
  BASELINE_COMPONENT_FIELDS,
  BASELINE_DOMAIN,
  baselinesEqual,
  createValidationBaseline,
  diffValidationBaselines,
  encodeBaselineFields,
} from './baseline.js';

export type {
  QuotaBudget,
  QuotaConsumeContext,
  QuotaKind,
  QuotaUsage,
  QuotaUsageSnapshot,
  QuotaViolation,
  TrustedQuotaProfile,
} from './quota-types.js';
export { QUOTA_KINDS, isQuotaKind } from './quota-types.js';

export type {
  JsonAst,
  JsonAstKind,
  JsonMember,
  MigratedCandidateDocument,
  ParsedCandidateDocument,
} from './json-ast.js';
export { astSpan } from './json-ast.js';

export type { CanonicalCandidate, CanonicalizedChangeRequest } from './canonical-types.js';

export type { SkippedCheck, ValidationStage } from './stage.js';
export { VALIDATION_STAGES, compareSkippedChecks, createSkippedCheck, stageIndex } from './stage.js';

export type {
  DefinitionRegistryReadSnapshot,
  FieldClassification,
  PresentationAssetIdentity,
  PresentationGap,
  UpstreamReferenceEdge,
  UpstreamResolvedReferenceGraph,
  UpstreamSchemaView,
  UpstreamValidatedCandidate,
} from './upstream.js';
export { FIELD_CLASSIFICATIONS } from './upstream.js';

export type { PresentationFallbackDecision } from './presentation.js';
export {
  comparePresentationDecisions,
  createPresentationFallbackDecision,
  isSemanticsPreserving,
} from './presentation.js';

export type { ValidatedChangeSet } from './validated-change-set.js';

export type { ActivationResult, ActivationStatus, ValidationReport, ValidationStatus } from './report.js';
export { isValidatedReport } from './report.js';
