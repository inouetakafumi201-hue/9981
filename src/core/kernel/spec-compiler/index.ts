/**
 * L1 Specification Compiler: fail-closed candidate compilation with creator-facing diagnostics.
 *
 * Boundaries:
 * - Candidate errors reject the whole change set and preserve the last valid registry state.
 * - Diagnostic/source-mapping/determinism/output failures halt the session and revoke the output lease.
 * - Only explicitly optional presentation fields may degrade, and only through a warning.
 */
export { SpecificationCompiler } from './compiler.js';
export type { CompilerHostOptions } from './compiler.js';
export { StrictJsonCodec, JsonCodecError, canonicalStringify } from './json-codec.js';
export { DiagnosticFactory, sortDiagnostics } from './diagnostic-factory.js';
export { SpecificationValidator } from './validator.js';
export type { ValidationContext, ModelValidationResult } from './validator.js';
export { checkDiagnosticClosure } from './closure.js';
export type { ClosureIssue } from './closure.js';
export {
  KNOWN_SEMANTIC_FAMILIES,
  SemanticFamilyError,
  SemanticFamilyRegistry,
  createSemanticFamilyRegistry,
  failedCriteria,
  satisfiesClassLayerCriteria,
} from './semantic-family.js';
export {
  GAMEPLAY_VALUE_MAXIMUM,
  GAMEPLAY_VALUE_MINIMUM,
  NUMERIC_OWNERSHIPS,
  SchemaContractError,
  assertSchemaNumericContract,
  collectNumericSchemaIssues,
  declaresInternalMetricSchema,
  requiresBoundProvenance,
} from './numeric-classification.js';
export {
  composedTypeIdentity,
  differingFieldNames,
  isEmptyTypeIdentity,
  typeIdentityKey,
  unionTypeIdentity,
} from './type-identity.js';
export {
  buildReferenceGraph,
  computeAncestors,
  lineageOf,
  readMergeRules,
  resolveWorkingSet,
} from './resolver.js';
export type { ReferenceGraph, ResolutionOutcome } from './resolver.js';
export {
  buildWorkingSet,
  readPackageDeclaration,
  toPackageRecord,
  validatePackageDependencies,
} from './package-change.js';
export type { PackageDeclaration } from './package-change.js';
export { modelToJson, provenanceToJson } from './model-json.js';
export {
  SchemaRegistry,
  CandidateMigrationRegistry,
  InMemorySpecificationRegistry,
  hashText,
} from './registries.js';
export type { RegistrySnapshot, MigrationPathResult } from './registries.js';
export {
  OutputLease,
  OutputLeaseError,
  InMemoryArtifactStore,
  hashBytes,
} from './output-lease.js';
export { FileSystemArtifactStore, ArtifactChainError, hashUtf8 } from './filesystem-artifact-store.js';
export type {
  ArtifactStore,
  ArtifactManifest,
  ArtifactManifestEntry,
  ArtifactFailurePoint,
  OutputLeaseState,
} from './output-lease.js';
export { DEFAULT_TECHNICAL_QUOTAS, TechnicalQuotaError, validateTechnicalQuotas } from './types.js';
export { EMPTY_TYPE_IDENTITY } from './types.js';
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
} from './types.js';

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
} from './messages.js';
export type { CreatorMessageBundle, CreatorMessageEntry } from './messages.js';
