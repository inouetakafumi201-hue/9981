/**
 * L1 Specification Compiler: fail-closed candidate compilation with creator-facing diagnostics.
 *
 * Boundaries:
 * - Candidate errors reject the whole change set and preserve the last valid registry state.
 * - Diagnostic/source-mapping/determinism/output failures halt the session and revoke the output lease.
 * - Only explicitly optional presentation fields may degrade, and only through a warning.
 */
export { SpecificationCompiler } from './compiler';
export type { CompilerHostOptions } from './compiler';
export { StrictJsonCodec, JsonCodecError, canonicalStringify } from './json-codec';
export { DiagnosticFactory, sortDiagnostics } from './diagnostic-factory';
export { SpecificationValidator } from './validator';
export type { ValidationContext, ModelValidationResult } from './validator';
export { checkDiagnosticClosure } from './closure';
export type { ClosureIssue } from './closure';
export {
  KNOWN_SEMANTIC_FAMILIES,
  SemanticFamilyError,
  SemanticFamilyRegistry,
  createSemanticFamilyRegistry,
  failedCriteria,
  satisfiesClassLayerCriteria,
} from './semantic-family';
export {
  GAMEPLAY_VALUE_MAXIMUM,
  GAMEPLAY_VALUE_MINIMUM,
  NUMERIC_OWNERSHIPS,
  SchemaContractError,
  assertSchemaNumericContract,
  collectNumericSchemaIssues,
  declaresInternalMetricSchema,
  requiresBoundProvenance,
} from './numeric-classification';
export {
  composedTypeIdentity,
  differingFieldNames,
  isEmptyTypeIdentity,
  typeIdentityKey,
  unionTypeIdentity,
} from './type-identity';
export {
  buildReferenceGraph,
  computeAncestors,
  lineageOf,
  readMergeRules,
  resolveWorkingSet,
} from './resolver';
export type { ReferenceGraph, ResolutionOutcome } from './resolver';
export {
  buildWorkingSet,
  readPackageDeclaration,
  toPackageRecord,
  validatePackageDependencies,
} from './package-change';
export type { PackageDeclaration } from './package-change';
export { modelToJson, provenanceToJson } from './model-json';
export {
  SchemaRegistry,
  CandidateMigrationRegistry,
  InMemorySpecificationRegistry,
  hashText,
} from './registries';
export type { RegistrySnapshot, MigrationPathResult } from './registries';
export {
  OutputLease,
  OutputLeaseError,
  InMemoryArtifactStore,
  hashBytes,
} from './output-lease';
export { FileSystemArtifactStore, ArtifactChainError, hashUtf8 } from './filesystem-artifact-store';
export type {
  ArtifactStore,
  ArtifactManifest,
  ArtifactManifestEntry,
  ArtifactFailurePoint,
  OutputLeaseState,
} from './output-lease';
export { DEFAULT_TECHNICAL_QUOTAS, TechnicalQuotaError, validateTechnicalQuotas } from './types';
export { EMPTY_TYPE_IDENTITY } from './types';
export type {
  BoundProvenance,
  CandidateDefinition,
  CandidateDocumentInput,
  CandidateMigration,
  CanonicalSnapshot,
  CompilationRejection,
  CompilationResult,
  CompilationSuccess,
  CompiledModel,
  CompilerMode,
  DefinitionSchema,
  FieldRule,
  IntegrationContract,
  JsonValue,
  MergeRule,
  NormativeStatement,
  NumericOwnership,
  PackageRecord,
  ParsedCandidateDocument,
  ReferenceEdge,
  Report,
  ReportInput,
  ResolvedDefinition,
  SchemaVersion,
  SemanticFamilyCriteria,
  SemanticFamilyRegistration,
  TechnicalQuotas,
  TypeIdentity,
  UnresolvedItem,
  ValidationBaseline,
} from './types';

export {
  COMPILER_EMITTED_CODES,
  GUIDANCE_ARGUMENT_CONTRACT,
  ZH_CN_CREATOR_BUNDLE,
  bundleEntry,
  interpolate,
  missingBundleCodes,
  renderCreatorMessage,
  renderGuidance,
  unresolvedPlaceholders,
} from './messages';
export type { CreatorMessageBundle, CreatorMessageEntry } from './messages';
