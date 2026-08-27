/**
 * UGC 模型层导出根。只包含不可变值类型、纯函数与稳定编码；不含任何 I/O、注册表或运行时写入能力。
 */
export type { UgcOk, UgcRejected, UgcResult } from './result';
export {
  diagnosticIntegrityFailure,
  hasBlockingDiagnostic,
  isBlockingDiagnostic,
  propagate,
  ugcOk,
  ugcReject,
  unwrap,
} from './result';

export type { FingerprintField, StableFingerprintGateway } from './fingerprint';
export {
  compareCodePoints,
  compareNullableCodePoints,
  encodeFingerprintPayload,
  fingerprintFields,
  utf8ByteLength,
} from './fingerprint';

export type {
  CandidateChangeRequest,
  CandidateDocument,
  CandidateSource,
  CandidateSourceKind,
  ChangeOperation,
  TargetOwnership,
  UGCAdapter,
} from './candidate';
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
} from './candidate';

export type { BindingFieldMismatch, ChangeRequestBinding, ChangeRequestBindingField } from './binding';
export {
  CHANGE_REQUEST_BINDING_FIELDS,
  CHANGE_REQUEST_DOMAIN,
  computeChangeRequestFingerprint,
  createChangeRequestBinding,
  diffChangeRequestBindings,
  encodeChangeRequestBindingFields,
} from './binding';

export type {
  BaselineComparisonField,
  BaselineComponentField,
  BaselineFieldMismatch,
  ValidationBaseline,
  ValidationBaselineComponents,
} from './baseline';
export {
  BASELINE_COMPARISON_FIELDS,
  BASELINE_COMPONENT_FIELDS,
  BASELINE_DOMAIN,
  baselinesEqual,
  createValidationBaseline,
  diffValidationBaselines,
  encodeBaselineFields,
} from './baseline';

export type {
  QuotaBudget,
  QuotaConsumeContext,
  QuotaKind,
  QuotaUsage,
  QuotaUsageSnapshot,
  QuotaViolation,
  TrustedQuotaProfile,
} from './quota-types';
export { QUOTA_KINDS, isQuotaKind } from './quota-types';

export type {
  JsonAst,
  JsonAstKind,
  JsonMember,
  MigratedCandidateDocument,
  ParsedCandidateDocument,
} from './json-ast';
export { astSpan } from './json-ast';

export type { CanonicalCandidate, CanonicalizedChangeRequest } from './canonical-types';

export type { SkippedCheck, ValidationStage } from './stage';
export { VALIDATION_STAGES, compareSkippedChecks, createSkippedCheck, stageIndex } from './stage';

export type {
  DefinitionRegistryReadSnapshot,
  FieldClassification,
  PresentationAssetIdentity,
  PresentationGap,
  UpstreamReferenceEdge,
  UpstreamResolvedReferenceGraph,
  UpstreamSchemaView,
  UpstreamValidatedCandidate,
} from './upstream';
export { FIELD_CLASSIFICATIONS } from './upstream';

export type { PresentationFallbackDecision } from './presentation';
export {
  comparePresentationDecisions,
  createPresentationFallbackDecision,
  isSemanticsPreserving,
} from './presentation';

export type { ValidatedChangeSet } from './validated-change-set';

export type { ActivationResult, ActivationStatus, ValidationReport, ValidationStatus } from './report';
export { isValidatedReport } from './report';
