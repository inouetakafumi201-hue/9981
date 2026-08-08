import type {
  CompilationStage,
  Diagnostic,
  DiagnosticArgument,
  SourceNormativeStatus,
  SourceOwningLayer,
  SourceRecord,
} from '../state/diagnostic.js';
import type { ErrCode } from '../state/error-codes.js';
import type { DefKind } from '../state/def.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type MutableJsonObject = { [key: string]: JsonValue };

/**
 * Host-owned resource ceilings for one compilation session.
 *
 * None of these numbers is a normative constant: no authoritative source fixes an input size, a
 * collection capacity or an identifier length, so they must not be compiled into the specification
 * model. They exist only to keep a single session bounded, they are injected by the host, and a
 * candidate can never raise them. Requirement 5.12 forbids promoting an unsourced limit to a
 * normative constant, which is why `identifierLength` lives here instead of being hard-coded inside
 * the validator.
 */
export interface TechnicalQuotas {
  readonly inputBytes: number;
  readonly nestingDepth: number;
  readonly objectMembers: number;
  readonly arrayElements: number;
  readonly astNodes: number;
  readonly definitions: number;
  readonly referenceEdges: number;
  readonly traversalWork: number;
  readonly diagnostics: number;
  readonly outputBytes: number;
  readonly migrationSteps: number;
  /** Maximum length of a definition, family or package identifier. Host resource limit only. */
  readonly identifierLength: number;
  /** Maximum number of package dependency edges walked while searching for a dependency cycle. */
  readonly packageDependencyEdges: number;
}

export const DEFAULT_TECHNICAL_QUOTAS: TechnicalQuotas = Object.freeze({
  inputBytes: 2_000_000,
  nestingDepth: 64,
  objectMembers: 50_000,
  arrayElements: 50_000,
  astNodes: 100_000,
  definitions: 10_000,
  referenceEdges: 100_000,
  traversalWork: 1_000_000,
  diagnostics: 2_000,
  outputBytes: 8_000_000,
  migrationSteps: 100,
  identifierLength: 128,
  packageDependencyEdges: 10_000,
});

/** Host misconfiguration of the session quotas. Never reachable from candidate input. */
export class TechnicalQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TechnicalQuotaError';
  }
}

const QUOTA_FIELDS: readonly (keyof TechnicalQuotas)[] = Object.freeze([
  'inputBytes', 'nestingDepth', 'objectMembers', 'arrayElements', 'astNodes', 'definitions',
  'referenceEdges', 'traversalWork', 'diagnostics', 'outputBytes', 'migrationSteps',
  'identifierLength', 'packageDependencyEdges',
]);

/**
 * Reject a quota set no traversal can be bounded by.
 *
 * Every quota is consumed as a countdown or a ceiling, so a non-finite, fractional or non-positive value
 * turns a bounded walk into undefined behaviour: `budget-- <= 0` never trips on `NaN`, and a zero ceiling
 * makes the compiler unable to report why it stopped. Failing here means a misconfigured host cannot get
 * as far as compiling anything.
 */
export function validateTechnicalQuotas(quotas: TechnicalQuotas): void {
  const issues: string[] = [];
  for (const field of QUOTA_FIELDS) {
    const value = quotas[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      issues.push(`${String(field)} must be a positive safe integer, received ${String(value)}`);
    }
  }
  if (issues.length > 0) {
    throw new TechnicalQuotaError(`Technical quotas are unusable: ${issues.join('; ')}`);
  }
}

export interface CandidateDocumentInput {
  readonly sourceId: string;
  readonly documentUri: string;
  readonly sourcePackage: string;
  readonly sourceText: string;
  readonly precedence: number;
  readonly decisionId?: string;
  readonly owningLayer: SourceOwningLayer;
  readonly normativeStatus: SourceNormativeStatus;
}

export interface ParsedCandidateDocument {
  readonly value: JsonValue;
  readonly source: SourceRecord;
  /** RFC 6901 JSON Pointer -> exact source record. */
  readonly locations: ReadonlyMap<string, SourceRecord>;
}

export type JsonFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
export type NumericOwnership =
  | 'gameplay-value'
  | 'internal-metric'
  | 'structural-bound'
  | 'constitutional-constant'
  | 'technical-quota';

export interface ReferenceRule {
  readonly kinds?: readonly DefKind[];
  readonly semanticFamilies?: readonly string[];
  readonly provider?: string;
  readonly allowAbstract?: boolean;
}

/**
 * Provenance a non-gameplay numeric bound must carry.
 *
 * Requirement 5.3 demands an authoritative source and a structural rationale for a Structural_Bound;
 * requirement 5.4 demands a source identifier, an owning layer and the affected fields for a
 * Constitutional_Constant. Without this record a bound is an unsourced implementation constant, which
 * requirement 5.12 forbids from becoming normative.
 */
export interface BoundProvenance {
  /** Authoritative document the bound comes from. */
  readonly sourceId: string;
  /** Decision identifier when the bound was fixed by a recorded decision. */
  readonly decisionId?: string;
  readonly owningLayer: SourceOwningLayer;
  /** Field names this bound governs. The declaring field must be listed. */
  readonly affectedFields: readonly string[];
  /** Why the bound is structural rather than a gameplay balance choice. */
  readonly rationale: string;
  /**
   * Normative statement the bound is derived from. When that statement is withheld as an
   * Unresolved_Item, every field pointing at it is rejected instead of silently keeping a default.
   */
  readonly statementKey?: string;
}

export interface FieldRule {
  readonly type: JsonFieldType | readonly JsonFieldType[];
  readonly required?: boolean;
  readonly semantic?: boolean;
  readonly presentation?: boolean;
  readonly enum?: readonly JsonPrimitive[];
  readonly numericOwnership?: NumericOwnership;
  /** Required for structural-bound, constitutional-constant and technical-quota classifications. */
  readonly boundProvenance?: BoundProvenance;
  /** Declares the field as unit of measure for an internal metric. */
  readonly unit?: string;
  readonly integer?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly reference?: ReferenceRule;
  readonly item?: FieldRule;
  readonly properties?: Readonly<Record<string, FieldRule>>;
  /**
   * Rule governing object members that `properties` does not name.
   *
   * Without it an open region is ungoverned, and an ungoverned region is where an unclassified number
   * hides: requirement 5.7 demands that every numeric field carry a classification, so a number found in
   * an open region with no rule is refused rather than accepted as free-form data. Declaring this rule is
   * how a host says what such members are allowed to be, and the rule itself passes the same numeric
   * contract check as any named field.
   */
  readonly defaultProperty?: FieldRule;
  readonly openProperties?: boolean;
  readonly unordered?: boolean;
  readonly identityField?: string;
  readonly deprecated?: boolean;
  readonly replacement?: string;
  readonly fallback?: JsonValue;
}

export interface DefinitionSchema {
  readonly kind: DefKind;
  /** Default semantic family for the kind. A definition may declare any registered family instead. */
  readonly semanticFamily: string;
  readonly abstractAllowed?: boolean;
  readonly fields: Readonly<Record<string, FieldRule>>;
  readonly crossValidate?: (definition: Readonly<Record<string, JsonValue>>) => readonly CrossFieldIssue[];
}

/**
 * Three-criteria classification a semantic family must satisfy to belong to the class layer.
 * All three must hold; a concept that fails `gameplayIndependent` belongs to the play layer.
 */
export interface SemanticFamilyCriteria {
  /** Finitely enumerable within the current scope. */
  readonly enumerable: boolean;
  /** Composable with other base types. */
  readonly composable: boolean;
  /** Independent of any specific gameplay profile. */
  readonly gameplayIndependent: boolean;
}

/**
 * One entry of the extensible semantic-family register. The register is deliberately open: the known
 * families are an initial listing, not a closed enumeration, so a qualifying new concept is accepted
 * as long as it carries the three-criteria judgement and a source record explaining the decision.
 */
export interface SemanticFamilyRegistration {
  readonly id: string;
  /** Def kinds a definition of this family may use. */
  readonly allowedKinds: readonly DefKind[];
  readonly criteria: SemanticFamilyCriteria;
  readonly classificationReason: string;
  readonly source: SourceRecord;
}

/** Type_Identity: the essential semantics that decide contract, relations, invariants and substitution. */
export interface TypeIdentity {
  readonly requiredCapabilities: readonly string[];
  readonly legalRelations: readonly string[];
  readonly invariants: readonly string[];
  readonly substitutes: readonly string[];
}

export const EMPTY_TYPE_IDENTITY: TypeIdentity = Object.freeze({
  requiredCapabilities: Object.freeze([]),
  legalRelations: Object.freeze([]),
  invariants: Object.freeze([]),
  substitutes: Object.freeze([]),
});

/**
 * Explicit, deterministic resolution for a field two independent providers both supply.
 *
 * `prefer` names the winning provider, so the outcome does not depend on declaration order.
 * `concat` is order sensitive by nature, so it must list the providers explicitly: the declared order
 * decides the result, which keeps two different declaration orders equivalent.
 */
export type MergeRule =
  | { readonly strategy: 'prefer'; readonly source: string }
  | { readonly strategy: 'concat'; readonly order: readonly string[] };

/** A package activated into the registry, kept so dependency cycles can be detected across packages. */
export interface PackageRecord {
  readonly packageId: string;
  readonly dependencies: readonly string[];
}

export interface CrossFieldIssue {
  readonly paths: readonly string[];
  readonly reason: string;
  readonly suggestion: string;
}

export interface IntegrationContract {
  readonly id: string;
  readonly version: string;
  readonly provider: string;
  readonly exportedKinds: readonly DefKind[];
  readonly exportedSemanticFamilies: readonly string[];
  readonly capabilities: readonly string[];
  readonly source: SourceRecord;
}

export interface SchemaVersion {
  readonly version: string;
  readonly definitionSchemas: ReadonlyMap<DefKind, DefinitionSchema>;
  readonly integrationContracts: ReadonlyMap<string, IntegrationContract>;
  /** Host-registered semantic families. A candidate may extend this register, never bypass it. */
  readonly semanticFamilies: ReadonlyMap<string, SemanticFamilyRegistration>;
}

export interface CandidateDefinition {
  readonly id: string;
  readonly kind: DefKind;
  readonly abstract: boolean;
  readonly semanticFamily: string;
  /** Inheritance edges. Inheritance carries type identity and contract specialisation only. */
  readonly extends: readonly string[];
  /** Composition edges. Composition carries configuration, capabilities and parameter values. */
  readonly components: readonly string[];
  readonly typeIdentity: TypeIdentity;
  /**
   * True when this definition, used as a component, contributes to its host's Type_Identity.
   * Removing a component that is not type defining must leave the host identity unchanged.
   */
  readonly typeDefining: boolean;
  readonly value: Readonly<Record<string, JsonValue>>;
  readonly source: SourceRecord;
}

/** One typed edge of the reference graph. */
export interface ReferenceEdge {
  readonly from: string;
  readonly to: string;
  /** JSON pointer of the declaring site inside its own document. */
  readonly path: string;
  readonly relation: 'extends' | 'component' | 'field';
}

/**
 * A definition after inheritance and composition have been applied.
 *
 * Resolution is idempotent: resolving the same input repeatedly yields an equivalent definition,
 * which is what makes the canonical artifact reproducible.
 */
export interface ResolvedDefinition {
  readonly id: string;
  readonly kind: DefKind;
  readonly abstract: boolean;
  readonly semanticFamily: string;
  /** Declared lineage from the furthest ancestor to this definition. */
  readonly lineage: readonly string[];
  readonly typeIdentity: TypeIdentity;
  readonly components: readonly string[];
  readonly fields: Readonly<Record<string, JsonValue>>;
}

export interface NormativeStatement {
  readonly key: string;
  readonly value: JsonValue;
  readonly source: SourceRecord;
}

export interface UnresolvedItem {
  readonly key: string;
  readonly statements: readonly NormativeStatement[];
}

/**
 * The complete active specification after a candidate package has been merged in.
 *
 * A compilation does not publish the candidate alone: it publishes the whole active set produced by
 * applying the candidate's additions, overrides and removals to the previous active set. That is what
 * makes activation atomic and keeps cross-package references resolvable after the commit.
 */
export interface CompiledModel {
  readonly schemaVersion: string;
  readonly targetLayer: SourceOwningLayer;
  readonly packages: Readonly<Record<string, PackageRecord>>;
  readonly semanticFamilies: Readonly<Record<string, SemanticFamilyRegistration>>;
  readonly definitions: Readonly<Record<string, CandidateDefinition>>;
  readonly resolvedDefinitions: Readonly<Record<string, ResolvedDefinition>>;
  readonly normativeStatements: Readonly<Record<string, NormativeStatement>>;
  readonly unresolvedItems: readonly UnresolvedItem[];
  /** Outbound reference target ids per definition. */
  readonly dependencyGraph: Readonly<Record<string, readonly string[]>>;
  /** Inbound reference source ids per definition, so a removal can find everything that depends on it. */
  readonly inboundGraph: Readonly<Record<string, readonly string[]>>;
  readonly sourceRecords: readonly SourceRecord[];
}

export interface ValidationBaseline {
  readonly id: string;
  readonly schemaRegistryId: string;
  readonly integrationRegistryId: string;
  readonly activeSnapshotId: string;
}

export interface CanonicalArtifact {
  readonly bytes: Uint8Array;
  readonly text: string;
  readonly hash: string;
  readonly model: CompiledModel;
}

/**
 * `SAFE_DRAFT` runs the complete validation pipeline but is structurally incapable of publishing:
 * no staging bytes are written, the registry is never committed, and no artifact generation appears.
 * It exists so a creator can iterate quickly without ever risking a half-activated deployment.
 * `PRODUCTION` is the only mode that may advance a generation.
 */
export type CompilerMode = 'SAFE_DRAFT' | 'PRODUCTION';

export interface CompilationSuccess {
  readonly ok: true;
  readonly mode: CompilerMode;
  readonly compilationId: string;
  readonly baselineId: string;
  /** Null in SAFE_DRAFT: nothing was activated, so no snapshot identity exists. */
  readonly snapshotId: string | null;
  readonly artifactHash: string;
  /** Present in SAFE_DRAFT so the creator can preview exactly what PRODUCTION would publish. */
  readonly draftModel?: CompiledModel;
  /**
   * Regression view of the active registry as it stands after this compilation.
   *
   * In PRODUCTION it describes the generation just published; in SAFE_DRAFT it is byte-identical to the
   * pre-compilation view, which is what makes "a draft publishes nothing" checkable by the caller instead
   * of merely asserted by the compiler.
   */
  readonly canonicalSnapshot: CanonicalSnapshot;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CompilationRejection {
  readonly ok: false;
  readonly mode: CompilerMode;
  readonly halted: 'candidate' | 'infrastructure';
  readonly compilationId: string;
  readonly baselineId: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly unchangedState: true;
  /**
   * Regression view of the active registry, which a rejection must leave untouched.
   *
   * `unchangedState: true` is the compiler's claim; this snapshot is the evidence. A caller can compare it
   * against the view it held before the attempt and detect a partially applied change set without needing
   * privileged access to the registry.
   */
  readonly canonicalSnapshot: CanonicalSnapshot;
  readonly incidentId?: string;
}

export type CompilationResult = CompilationSuccess | CompilationRejection;

export interface CandidateMigration {
  readonly id: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly source: SourceRecord;
  readonly transform: (candidate: JsonValue) => JsonValue;
}

/** Diagnostic emission callback shared by every validation module. */
export interface ReportInput {
  readonly code: ErrCode;
  readonly stage: CompilationStage;
  readonly message: string;
  readonly path: string;
  readonly definitionId?: string;
  readonly relatedSources?: readonly SourceRecord[];
  readonly warning?: boolean;
  readonly informational?: boolean;
  readonly suggestion?: string;
  /** Locale-neutral values the creator-facing bundle may interpolate. */
  readonly messageArgs?: Readonly<Record<string, DiagnosticArgument>>;
}

export type Report = (input: ReportInput) => void;

/** Deterministic work accounting shared by every traversal, so no module can loop unbounded. */
export type ConsumeWork = (path: string) => boolean;

/**
 * Regression comparison view of an activated registry.
 * Two runs that activated the same content must produce byte-identical `canonicalModel`.
 */
export interface CanonicalSnapshot {
  readonly id: string;
  readonly generation: number;
  readonly artifactHash: string | null;
  readonly canonicalModel: string;
}
