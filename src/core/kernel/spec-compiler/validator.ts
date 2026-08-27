import type { DefKind } from '../state/def';
import type {
  Diagnostic, SourceNormativeStatus, SourceOwningLayer, SourceRecord,
} from '../state/diagnostic';
import type { FatalErrorBoundary } from '../safety/fatal-boundary';
import { canonicalStringify, compareCodePoints, joinJsonPointer, jsonTypeOf } from './json-codec';
import { DiagnosticFactory } from './diagnostic-factory';
import type { CreatorMessageBundle } from './messages';
import type { RegistrySnapshot } from './registries';
import { enforceNumericClassification } from './numeric-classification';
import { failedCriteria } from './semantic-family';
import { readTypeIdentity, validateInheritanceIdentity } from './type-identity';
import {
  buildReferenceGraph,
  computeLineages,
  reportInheritanceCycles,
  resolveWorkingSet,
} from './resolver';
import {
  buildWorkingSet,
  readPackageDeclaration,
  reportOverrideDependentBreakage,
  reportRemovalDangling,
  toPackageRecord,
  validatePackageDependencies,
} from './package-change';
import type { PackageDeclaration } from './package-change';
import type {
  CandidateDefinition,
  CompiledModel,
  ConsumeWork,
  DefinitionSchema,
  FieldRule,
  JsonValue,
  NormativeStatement,
  PackageRecord,
  ParsedCandidateDocument,
  Report,
  ReportInput,
  ResolvedDefinition,
  SchemaVersion,
  SemanticFamilyRegistration,
  TechnicalQuotas,
  UnresolvedItem,
  ValidationBaseline,
} from './types';

export { GAMEPLAY_VALUE_MAXIMUM, GAMEPLAY_VALUE_MINIMUM } from './numeric-classification';

const BASE_DEFINITION_FIELDS = new Set([
  'id', 'kind', 'abstract', 'semanticFamily', 'extends', 'components', 'mergeRules', 'override',
  'typeIdentity', 'typeDefining',
]);
const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion', 'targetLayer', 'definitions', 'statements',
  'packageId', 'dependencies', 'removals', 'semanticFamilies',
]);
const LEGAL_TARGET_LAYERS = new Set<SourceOwningLayer>(['基类层', '玩法层']);
const LEGAL_STATUSES = new Set<SourceNormativeStatus>(['normative', 'historical', 'unresolved', 'deprecated']);
/**
 * Deprecated architecture and modelling terms, mapped to the canonical term that replaced them.
 *
 * The list is the one requirement 1.7 names, plus the historical `Layer N` labels. Matching is exact and
 * scoped to the designated term fields on purpose: `对象` is banned as a *modelling term*, not as a word,
 * so substring matching would reject ordinary prose such as `目标对象` and teach creators to work around
 * the check rather than fix the term.
 */
const NON_CANONICAL_TERMS: Readonly<Record<string, string>> = Object.freeze({
  '\u5185\u5bb9\u5c42': '基类层',
  '\u6a21\u677f': '实例',
  '\u6a21\u677f\u5c42': '基类层',
  '\u6a21\u677f\u7c7b\u578b': '基类',
  '\u73a9\u6cd5\u5305\u5c42': '玩法层',
  '\u5bf9\u8c61': '实例',
  'Layer 1': '引擎层',
  'Layer 2': '基类层',
  'Layer 3': '玩法层',
});

/** Fields whose value is a layer or modelling term rather than free prose. */
const TERM_FIELDS: readonly string[] = Object.freeze(['layerName', 'term', 'terminology']);

/** Path used to anchor a diagnostic about a definition the candidate document does not contain. */
const INHERITED_DEFINITION_PATH = '/definitions';

export interface ValidationContext {
  readonly document: ParsedCandidateDocument;
  readonly sourceText: string;
  readonly schema: SchemaVersion;
  readonly baseline: ValidationBaseline;
  readonly activeSnapshot: RegistrySnapshot;
  readonly quotas: TechnicalQuotas;
  readonly compilationId: string;
  readonly fatalBoundary: FatalErrorBoundary;
  /** Injected so validator diagnostics localise together with the rest of the pipeline. */
  readonly messageBundle?: CreatorMessageBundle;
}

export interface ModelValidationResult {
  readonly model: CompiledModel | null;
  readonly diagnostics: readonly Diagnostic[];
}

interface StatementResolution {
  readonly normative: Record<string, NormativeStatement>;
  readonly unresolved: UnresolvedItem[];
  readonly withheldKeys: ReadonlySet<string>;
}

export class SpecificationValidator {
  validate(context: ValidationContext): ModelValidationResult {
    const diagnostics: Diagnostic[] = [];
    const factory = new DiagnosticFactory(context.fatalBoundary, context.messageBundle);
    let work = 0;

    const location = (path: string): SourceRecord => context.document.locations.get(path) ?? context.document.source;
    const report: Report = (input: ReportInput): void => {
      diagnostics.push(factory.build({
        code: input.code,
        stage: input.stage,
        phase: stageNumber(input.stage),
        technicalMessage: input.message,
        source: location(input.path),
        sourceText: context.sourceText,
        path: input.path,
        definitionId: input.definitionId,
        relatedSources: input.relatedSources,
        warning: input.warning,
        informational: input.informational,
        messageArgs: input.messageArgs,
        compilationId: context.compilationId,
        baselineId: context.baseline.id,
        suggestion: input.suggestion,
      }));
      if (diagnostics.length > context.quotas.diagnostics) {
        context.fatalBoundary.halt(input.stage, 'DIAGNOSTIC_BUDGET_EXHAUSTED');
      }
    };
    const consumeWork: ConsumeWork = (path: string): boolean => {
      work++;
      if (work <= context.quotas.traversalWork) return true;
      report({
        code: 'E_QUOTA_TRAVERSAL_WORK',
        stage: 'semantic',
        message: `Validation work exceeded ${context.quotas.traversalWork}`,
        path,
        messageArgs: { limit: context.quotas.traversalWork },
      });
      return false;
    };

    if (!isJsonObject(context.document.value)) {
      report({ code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: 'Root value must be an object', path: '' });
      return { model: null, diagnostics };
    }
    const root = context.document.value;
    return this.validateRoot(root, context, diagnostics, report, consumeWork);
  }

  private validateRoot(
    root: Readonly<Record<string, JsonValue>>,
    context: ValidationContext,
    diagnostics: Diagnostic[],
    report: Report,
    consumeWork: ConsumeWork,
  ): ModelValidationResult {
    for (const key of Object.keys(root)) {
      if (TOP_LEVEL_FIELDS.has(key)) continue;
      report({
        code: 'E_LOAD_UNKNOWN_FIELD', stage: 'schema',
        message: `Unknown top-level field ${key}`, path: joinJsonPointer('', key),
      });
    }

    const schemaVersion = readRequiredString(root, 'schemaVersion', '', report);
    const targetLayer = this.readTargetLayer(root, context, report);
    if (schemaVersion && schemaVersion !== context.schema.version) {
      report({
        code: 'E_LOAD_SCHEMA_VERSION', stage: 'schema',
        message: `Expected schema ${context.schema.version}, received ${schemaVersion}`,
        path: '/schemaVersion',
      });
    }

    const declaration = readPackageDeclaration(root, context.document.source.sourcePackage, context.quotas, report);
    const activePackages = context.activeSnapshot.model?.packages ?? {};
    validatePackageDependencies(declaration, activePackages, context.quotas, report);

    // Statements are resolved first: a bound that depends on an undecided statement must be refused, and
    // that decision has to be known before any definition field is judged.
    const statements = resolveStatements(root['statements'], context, report, consumeWork);
    const families = this.resolveSemanticFamilies(root['semanticFamilies'], context, report);

    const rawDefinitions = root['definitions'];
    if (!Array.isArray(rawDefinitions)) {
      report({
        code: rawDefinitions === undefined ? 'E_LOAD_REQUIRED_FIELD' : 'E_LOAD_FIELD_TYPE',
        stage: 'schema', message: 'definitions must be an array', path: '/definitions',
      });
      return { model: null, diagnostics };
    }
    if (rawDefinitions.length > context.quotas.definitions) {
      report({
        code: 'E_QUOTA_DEFINITIONS', stage: 'schema',
        message: `Definition count ${rawDefinitions.length} exceeds ${context.quotas.definitions}`,
        path: '/definitions',
      });
      return { model: null, diagnostics };
    }

    const collected = this.collectDefinitions({
      rawDefinitions, context, targetLayer, families, statements, report, consumeWork,
    });
    const pathFor = (id: string, suffix = ''): string => {
      const own = collected.paths.get(id);
      return own ? `${own}${suffix}` : INHERITED_DEFINITION_PATH;
    };

    const active = context.activeSnapshot.model?.definitions ?? {};
    const staged = buildWorkingSet({
      active,
      candidates: collected.definitions,
      declaration,
      pathOf: pathFor,
      report,
    });
    // Lineages are computed once and shared: the required-field pass and resolution must agree about what
    // a definition inherits, and one memoised traversal is also what keeps a diamond lattice affordable.
    const lineages = computeLineages(staged, (id) => pathFor(id), consumeWork);
    const patched = completeRequiredFields({
      candidates: collected.definitions, working: staged, lineages,
      schema: context.schema, pathFor, report,
    });
    const candidates = mergeDefinitions(collected.definitions, patched);
    const working = mergeDefinitions(staged, patched);

    const graph = buildReferenceGraph(working, context.schema, (id) => pathFor(id));
    const cyclic = reportInheritanceCycles(working, (id) => pathFor(id), report, consumeWork);
    this.validateWorkingReferences(working, context, pathFor, report, consumeWork);
    reportRemovalDangling({ declaration, graph, active, report });
    reportOverrideDependentBreakage({ overrides: collected.overrides, graph, report });
    this.validateIdentityAcrossLineage(candidates, working, context, pathFor, report);

    const resolution = resolveWorkingSet({
      working, schema: context.schema, cyclic, pathOf: (id) => pathFor(id), report, consumeWork, lineages,
    });

    const hasErrors = diagnostics.some((item) => item.severity === 'error' || item.severity === 'fatal');
    if (hasErrors || !schemaVersion || !targetLayer) return { model: null, diagnostics };

    const model = buildModel({
      schemaVersion, targetLayer, declaration, activePackages, families,
      working, resolved: resolution.resolved, graph, statements,
      documentSource: context.document.source,
    });
    return { model, diagnostics };
  }

  /**
   * Read the owning layer of the change set.
   *
   * A registry holds one layer's definitions. Letting a play-layer document merge into a class-layer
   * registry would smuggle concrete gameplay values past the class-layer ownership check, so a mismatch
   * with the already activated layer is refused.
   */
  private readTargetLayer(
    root: Readonly<Record<string, JsonValue>>,
    context: ValidationContext,
    report: Report,
  ): SourceOwningLayer | null {
    const raw = readRequiredString(root, 'targetLayer', '', report);
    if (!raw) return null;
    if (!LEGAL_TARGET_LAYERS.has(raw as SourceOwningLayer)) {
      report({
        code: 'E_LOAD_LAYER_OWNERSHIP', stage: 'semantic',
        message: `Target layer ${raw} is not allowed for candidate definitions`,
        path: '/targetLayer',
      });
      return null;
    }
    const active = context.activeSnapshot.model?.targetLayer;
    if (active && active !== raw) {
      report({
        code: 'E_LOAD_LAYER_OWNERSHIP', stage: 'semantic',
        message: `Active specification belongs to ${active}; this change declares ${raw}`,
        path: '/targetLayer',
        suggestion: '同一份注册表只承载一个层级的内容。请把这份内容提交到对应层级的注册表。',
      });
      return null;
    }
    return raw as SourceOwningLayer;
  }

  /**
   * Effective semantic family register for this compilation.
   *
   * Host registrations and already activated families are joined with the families this document
   * proposes. Proposals are judged by the three criteria and must carry a reason, so the register grows
   * on evidence instead of on assertion; nothing here treats the known families as a closed list.
   */
  private resolveSemanticFamilies(
    raw: JsonValue | undefined,
    context: ValidationContext,
    report: Report,
  ): ReadonlyMap<string, SemanticFamilyRegistration> {
    const effective = new Map<string, SemanticFamilyRegistration>();
    for (const [id, registration] of context.schema.semanticFamilies) effective.set(id, registration);
    for (const [id, registration] of Object.entries(context.activeSnapshot.model?.semanticFamilies ?? {})) {
      effective.set(id, registration);
    }
    if (raw === undefined) return effective;
    if (!Array.isArray(raw)) {
      report({
        code: 'E_LOAD_FIELD_TYPE', stage: 'schema',
        message: 'semanticFamilies must be an array', path: '/semanticFamilies',
      });
      return effective;
    }
    raw.forEach((entry, index) => {
      const path = `/semanticFamilies/${index}`;
      const registration = this.readFamilyProposal(entry, path, context, report);
      if (!registration) return;
      const existing = effective.get(registration.id);
      if (existing && !sameFamilyContract(existing, registration)) {
        // Silently overwriting would let a candidate widen an already-registered family, for example by
        // letting `weapon` accept a scene kind. Every family-typed reference check downstream would then be
        // judged against a contract the host never agreed to.
        report({
          code: 'E_LOAD_SCHEMA_CONTRACT', stage: 'semantic',
          message: `Semantic family ${registration.id} is already registered with a different contract`,
          path, relatedSources: [existing.source],
          suggestion: '这个语义族已经登记过，且内容与你写的不一致。请改用已登记的定义，或换一个新的族编号；'
            + '要修改已登记的族，需要先由权威决策更新登记表。',
        });
        return;
      }
      effective.set(registration.id, registration);
    });
    return effective;
  }

  private readFamilyProposal(
    entry: JsonValue,
    path: string,
    context: ValidationContext,
    report: Report,
  ): SemanticFamilyRegistration | null {
    if (!isJsonObject(entry)) {
      report({
        code: 'E_LOAD_FIELD_TYPE', stage: 'schema',
        message: 'Semantic family proposal must be an object', path,
      });
      return null;
    }
    const id = readRequiredString(entry, 'id', path, report);
    const reason = readRequiredString(entry, 'classificationReason', path, report);
    const kinds = readKindList(entry['allowedKinds'], `${path}/allowedKinds`, context, report);
    const criteria = readCriteria(entry['criteria'], `${path}/criteria`, report);
    if (!id || !reason || kinds.length === 0 || !criteria) return null;
    if (!isValidIdentifier(id, context.quotas.identifierLength)) {
      report({
        code: 'E_LOAD_IDENTIFIER_INVALID', stage: 'schema',
        message: `Semantic family identifier ${id} is invalid`, path: `${path}/id`,
      });
      return null;
    }
    const failed = failedCriteria(criteria);
    if (failed.length > 0) {
      const gameplayCoupled = !criteria.gameplayIndependent;
      report({
        code: gameplayCoupled ? 'E_LOAD_LAYER_OWNERSHIP' : 'E_LOAD_SCHEMA_CONTRACT',
        stage: 'semantic',
        message: `Proposed family ${id} fails ${failed.join(', ')}`,
        path: `${path}/criteria`,
        suggestion: gameplayCoupled
          ? '这个概念依赖某一种具体玩法，属于玩法层。请把它作为玩法层内容登记，不要作为可复用语义族。'
          : '可复用语义族必须能被有限列举，并且能与其他基类组合。请重新界定范围，或把它拆成更小的可复用单元。',
      });
      return null;
    }
    return Object.freeze({
      id, allowedKinds: kinds, criteria, classificationReason: reason,
      source: context.document.locations.get(path) ?? context.document.source,
    });
  }

  private collectDefinitions(input: {
    readonly rawDefinitions: readonly JsonValue[];
    readonly context: ValidationContext;
    readonly targetLayer: SourceOwningLayer | null;
    readonly families: ReadonlyMap<string, SemanticFamilyRegistration>;
    readonly statements: StatementResolution;
    readonly report: Report;
    readonly consumeWork: ConsumeWork;
  }): {
    readonly definitions: ReadonlyMap<string, CandidateDefinition>;
    readonly paths: ReadonlyMap<string, string>;
    readonly overrides: readonly { readonly id: string; readonly path: string }[];
  } {
    const { rawDefinitions, context, targetLayer, families, statements, report, consumeWork } = input;
    const definitions = new Map<string, CandidateDefinition>();
    const paths = new Map<string, string>();
    const overrides: { id: string; path: string }[] = [];

    for (let index = 0; index < rawDefinitions.length && consumeWork(`/definitions/${index}`); index++) {
      const value = rawDefinitions[index];
      const path = `/definitions/${index}`;
      if (!isJsonObject(value)) {
        report({ code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: 'Definition must be an object', path });
        continue;
      }
      const id = readRequiredString(value, 'id', path, report);
      const kindValue = readRequiredString(value, 'kind', path, report);
      const schema = context.schema.definitionSchemas.get(kindValue as DefKind);
      if (!schema) {
        report({
          code: 'E_LOAD_DEF_KIND', stage: 'schema',
          message: `Definition kind ${kindValue || '<missing>'} is not registered`,
          path: `${path}/kind`, definitionId: id || undefined,
        });
        continue;
      }
      if (!isValidIdentifier(id, context.quotas.identifierLength)) {
        report({
          code: 'E_LOAD_IDENTIFIER_INVALID', stage: 'schema',
          message: `Identifier ${id || '<empty>'} is invalid`,
          path: `${path}/id`, definitionId: id || undefined,
        });
        continue;
      }
      const previousPath = paths.get(id);
      if (previousPath) {
        report({
          code: 'E_LOAD_DUPLICATE_ID', stage: 'schema',
          message: `Identifier ${id} is duplicated`,
          path: `${path}/id`, definitionId: id,
          relatedSources: [context.document.locations.get(`${previousPath}/id`) ?? context.document.source],
        });
        continue;
      }
      paths.set(id, path);

      const family = this.readSemanticFamily(value, schema, families, path, id, report);
      const abstract = value['abstract'] === true;
      if (value['abstract'] !== undefined && typeof value['abstract'] !== 'boolean') {
        report({
          code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: 'abstract must be a boolean',
          path: `${path}/abstract`, definitionId: id,
        });
      }
      if (abstract && schema.abstractAllowed === false) {
        report({
          code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'semantic',
          message: `Kind ${schema.kind} does not allow abstract definitions`,
          path: `${path}/abstract`, definitionId: id,
        });
      }
      const typeDefining = value['typeDefining'] === true;
      if (value['typeDefining'] !== undefined && typeof value['typeDefining'] !== 'boolean') {
        report({
          code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: 'typeDefining must be a boolean',
          path: `${path}/typeDefining`, definitionId: id,
        });
      }

      const parentIds = readRelationIds(value['extends'], `${path}/extends`, id, 'extends', report);
      const componentIds = readRelationIds(value['components'], `${path}/components`, id, 'components', report);
      const typeIdentity = readTypeIdentity(value['typeIdentity'], `${path}/typeIdentity`, id, report);
      const fallbacks: PresentationFallback[] = [];
      validateDefinitionFields({
        definition: value, schema, path, id, targetLayer,
        withheldStatementKeys: statements.withheldKeys, report, consumeWork, fallbacks,
      });
      validateTerms(value, path, id, context.document.source.normativeStatus, report);
      if (validateOverride(value, id, path, schema, context.activeSnapshot, report)) {
        overrides.push({ id, path: `${path}/override` });
      }

      // `override` is transaction intent, not part of the definition, so it never enters the model.
      // A degraded presentation value is substituted here rather than left as the damaged original, so the
      // published model matches the fallback the creator was told about.
      let effectiveValue: JsonValue = withoutOverride(value) as unknown as JsonValue;
      for (const fallback of fallbacks) {
        effectiveValue = setAtSegments(effectiveValue, fallback.segments, fallback.value);
      }

      definitions.set(id, Object.freeze({
        id,
        kind: schema.kind,
        abstract,
        semanticFamily: family,
        extends: parentIds,
        components: componentIds,
        typeIdentity,
        typeDefining,
        value: effectiveValue as Readonly<Record<string, JsonValue>>,
        source: context.document.locations.get(path) ?? context.document.source,
      }));
    }
    return { definitions, paths, overrides };
  }

  /**
   * Resolve and check the declared semantic family.
   *
   * A definition may only claim a family that is actually registered, and only when the family permits
   * its Def kind. Accepting an unregistered name would make every family-typed reference check
   * vacuously pass, because nothing would ever match the expected family.
   */
  private readSemanticFamily(
    value: Readonly<Record<string, JsonValue>>,
    schema: DefinitionSchema,
    families: ReadonlyMap<string, SemanticFamilyRegistration>,
    path: string,
    id: string,
    report: Report,
  ): string {
    const declared = value['semanticFamily'];
    if (declared !== undefined && typeof declared !== 'string') {
      report({
        code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: 'semanticFamily must be a string',
        path: `${path}/semanticFamily`, definitionId: id,
      });
      return schema.semanticFamily;
    }
    const family = declared ?? schema.semanticFamily;
    const registration = families.get(family);
    if (!registration) {
      report({
        code: 'E_LOAD_SCHEMA_CONTRACT', stage: 'semantic',
        message: `Semantic family ${family} is not registered`,
        path: declared === undefined ? path : `${path}/semanticFamily`, definitionId: id,
        suggestion: '请改用已登记的语义族，或在本文件的 semanticFamilies 里按可枚举、可组合、'
          + '不含具体玩法语义三条判据登记这个新族并写明理由。',
      });
      return family;
    }
    if (!registration.allowedKinds.includes(schema.kind)) {
      report({
        code: 'E_LOAD_SCHEMA_CONTRACT', stage: 'semantic',
        message: `Family ${family} does not allow kind ${schema.kind}`,
        path: declared === undefined ? path : `${path}/semanticFamily`, definitionId: id,
        relatedSources: [registration.source],
        suggestion: `这个语义族只接受 ${registration.allowedKinds.join('、')} 类别。请改用匹配的类别，或改选合适的语义族。`,
      });
    }
    return family;
  }

  /**
   * Check every typed reference in the merged working set.
   *
   * The whole set is walked, not only the new definitions: an override or a removal can invalidate a
   * reference declared by a package this document never mentions, and requirement 12.6 wants those
   * dependents revalidated before activation rather than after it.
   */
  private validateWorkingReferences(
    working: ReadonlyMap<string, CandidateDefinition>,
    context: ValidationContext,
    pathFor: (id: string, suffix?: string) => string,
    report: Report,
    consumeWork: ConsumeWork,
  ): void {
    let referenceCount = 0;
    for (const id of [...working.keys()].sort(compareCodePoints)) {
      const definition = working.get(id);
      if (!definition) continue;
      if (!consumeWork(pathFor(id))) return;
      definition.extends.forEach((parentId, index) => {
        referenceCount++;
        const parent = working.get(parentId);
        if (!parent) {
          report({
            code: 'E_REF_MISSING', stage: 'reference', message: `Parent ${parentId} does not exist`,
            path: pathFor(id, `/extends/${index}`), definitionId: id,
          });
          return;
        }
        if (parent.kind !== definition.kind) {
          report({
            code: 'E_REF_KIND', stage: 'reference',
            message: `Parent ${parentId} kind ${parent.kind} does not match ${definition.kind}`,
            path: pathFor(id, `/extends/${index}`), definitionId: id, relatedSources: [parent.source],
          });
        }
      });
      definition.components.forEach((componentId, index) => {
        referenceCount++;
        if (working.has(componentId)) return;
        report({
          code: 'E_REF_MISSING', stage: 'composition', message: `Component ${componentId} does not exist`,
          path: pathFor(id, `/components/${index}`), definitionId: id,
        });
      });
      const schema = context.schema.definitionSchemas.get(definition.kind);
      if (schema) {
        referenceCount += validateDeclaredReferences(definition, schema, working, context, pathFor, report);
      }
      if (referenceCount > context.quotas.referenceEdges) {
        report({
          code: 'E_QUOTA_REFERENCE_EDGES', stage: 'reference',
          message: `Reference edges exceed ${context.quotas.referenceEdges}`,
          path: pathFor(id), definitionId: id,
        });
        return;
      }
    }
  }

  /** Inheritance must express a type difference; only candidate definitions are being judged here. */
  private validateIdentityAcrossLineage(
    candidates: ReadonlyMap<string, CandidateDefinition>,
    working: ReadonlyMap<string, CandidateDefinition>,
    context: ValidationContext,
    pathFor: (id: string, suffix?: string) => string,
    report: Report,
  ): void {
    for (const id of [...candidates.keys()].sort(compareCodePoints)) {
      const child = candidates.get(id);
      if (!child || child.extends.length === 0) continue;
      const parents = child.extends
        .map((parentId) => working.get(parentId))
        .filter((parent): parent is CandidateDefinition => parent !== undefined);
      validateInheritanceIdentity({
        child, parents,
        schema: context.schema.definitionSchemas.get(child.kind),
        path: pathFor(id), report,
      });
    }
  }
}

/** Overlay of patched definitions onto a base map, without mutating either. */
function mergeDefinitions(
  base: ReadonlyMap<string, CandidateDefinition>,
  patched: ReadonlyMap<string, CandidateDefinition>,
): ReadonlyMap<string, CandidateDefinition> {
  if (patched.size === 0) return base;
  const merged = new Map(base);
  for (const [id, definition] of patched) {
    if (merged.has(id)) merged.set(id, definition);
  }
  return merged;
}

/** True when two registrations describe the same family contract, so re-declaring one is idempotent. */
function sameFamilyContract(
  left: SemanticFamilyRegistration,
  right: SemanticFamilyRegistration,
): boolean {
  return canonicalStringify({
    allowedKinds: [...left.allowedKinds].sort(compareCodePoints),
    criteria: { ...left.criteria },
    classificationReason: left.classificationReason,
  }) === canonicalStringify({
    allowedKinds: [...right.allowedKinds].sort(compareCodePoints),
    criteria: { ...right.criteria },
    classificationReason: right.classificationReason,
  });
}

function withoutOverride(value: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
  if (value['override'] === undefined) return value;
  const copy: Record<string, JsonValue> = {};
  for (const [key, member] of Object.entries(value)) {
    if (key === 'override') continue;
    copy[key] = member;
  }
  return Object.freeze(copy);
}

/**
 * A registered presentation value that replaces a missing or damaged presentation field.
 *
 * `segments` locates the field relative to the definition root, so the fallback can be applied to the
 * candidate before resolution. Announcing a fallback in a diagnostic without applying it would leave the
 * activated model without the field the creator was told the compiler had supplied.
 */
interface PresentationFallback {
  readonly segments: readonly string[];
  readonly value: JsonValue;
}

interface FieldValidationInput {
  readonly definition: Readonly<Record<string, JsonValue>>;
  readonly schema: DefinitionSchema;
  readonly path: string;
  readonly id: string;
  readonly targetLayer: SourceOwningLayer | null;
  readonly withheldStatementKeys: ReadonlySet<string>;
  readonly report: Report;
  readonly consumeWork: ConsumeWork;
  readonly fallbacks: PresentationFallback[];
}

/**
 * Validate the fields a definition actually declares.
 *
 * Required-field presence is deliberately *not* checked here: a field a definition inherits from an
 * ancestor or receives from a component is present in the resolved definition, and reporting it as missing
 * would reject a correct child. That check runs once the working set is known, in
 * {@link completeRequiredFields}.
 */
function validateDefinitionFields(input: FieldValidationInput): void {
  const { definition, schema, path, id, report } = input;
  for (const key of Object.keys(definition)) {
    if (BASE_DEFINITION_FIELDS.has(key)) continue;
    const rule = schema.fields[key];
    if (!rule) {
      report({
        code: 'E_LOAD_UNKNOWN_FIELD', stage: 'schema', message: `Unknown field ${key}`,
        path: joinJsonPointer(path, key), definitionId: id,
      });
      continue;
    }
    validateField(definition[key] as JsonValue, rule, joinJsonPointer(path, key), key, input, [key]);
  }
  for (const issue of schema.crossValidate?.(definition) ?? []) {
    report({
      code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'semantic', message: issue.reason,
      path: issue.paths[0] ? joinJsonPointer(path, issue.paths[0]) : path,
      definitionId: id, suggestion: issue.suggestion,
    });
  }
}

function validateField(
  value: JsonValue,
  rule: FieldRule,
  path: string,
  leafName: string,
  input: FieldValidationInput,
  segments: readonly string[],
): void {
  const { id, report, consumeWork } = input;
  if (!consumeWork(path)) return;
  const expected = Array.isArray(rule.type) ? rule.type : [rule.type];
  const actual = jsonTypeOf(value);
  if (!expected.includes(actual)) {
    // A damaged presentation field degrades only when the registered fallback is itself type compatible.
    // Without a compatible fallback there is nothing to degrade to, so inventing one would be exactly the
    // silent semantic repair the error handling contract forbids.
    if (rule.presentation === true && rule.fallback !== undefined && expected.includes(jsonTypeOf(rule.fallback))) {
      report({
        code: 'E_LOAD_PRESENTATION_FALLBACK', stage: 'semantic', warning: true,
        message: `Presentation field ${leafName} is ${actual} instead of ${expected.join('|')}; `
          + 'the registered fallback is used',
        path, definitionId: id,
      });
      input.fallbacks.push({ segments, value: rule.fallback });
      return;
    }
    report({
      code: 'E_LOAD_FIELD_TYPE', stage: 'schema',
      message: `Expected ${expected.join('|')}, received ${actual}`, path, definitionId: id,
    });
    return;
  }
  if (rule.deprecated) {
    report({
      code: 'E_LOAD_DEPRECATED_MECHANIC', stage: 'semantic',
      message: `Deprecated field is not allowed${rule.replacement ? `; use ${rule.replacement}` : ''}`,
      path, definitionId: id,
    });
  }
  if (rule.enum && isPrimitive(value) && !rule.enum.some((candidate) => Object.is(candidate, value))) {
    report({
      code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'semantic',
      message: 'Value is outside the registered choices', path, definitionId: id,
    });
  }
  if (typeof value === 'number') {
    enforceNumericClassification({
      value, rule, path, leafName, definitionId: id,
      targetLayer: input.targetLayer,
      withheldStatementKeys: input.withheldStatementKeys,
      report,
    });
    validateNumericBounds(value, rule, path, id, report);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemSegments = [...segments, String(index)];
      if (rule.item) {
        validateField(item, rule.item, `${path}/${index}`, leafName, input, itemSegments);
      } else {
        // No element rule means the elements are ungoverned, which is where an unclassified number hides.
        scanUngovernedRegion(item, `${path}/${index}`, input);
      }
    });
    if (rule.unordered) validateUnorderedIdentity(value, rule, path, id, report);
  } else if (isJsonObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nestedRule = rule.properties?.[key] ?? rule.defaultProperty;
      const nestedPath = joinJsonPointer(path, key);
      if (nestedRule) {
        validateField(nested, nestedRule, nestedPath, key, input, [...segments, key]);
        continue;
      }
      if (rule.properties && !rule.openProperties) {
        report({
          code: 'E_LOAD_UNKNOWN_FIELD', stage: 'schema', message: `Unknown nested field ${key}`,
          path: nestedPath, definitionId: id,
        });
        continue;
      }
      scanUngovernedRegion(nested, nestedPath, input);
    }
  }
}

/**
 * Refuse every number the schema does not classify.
 *
 * An open object or an array without an element rule is free-form as far as *shape* goes, but requirement
 * 5.7 admits no free-form numbers: an unclassified number is exactly how a concrete gameplay value such as
 * a damage table slips into a class-layer definition while every field-level check passes. A host that
 * legitimately wants numbers in an open region declares `defaultProperty` and classifies them there.
 */
function scanUngovernedRegion(value: JsonValue, path: string, input: FieldValidationInput): void {
  const { id, report, consumeWork } = input;
  if (!consumeWork(path)) return;
  if (typeof value === 'number') {
    report({
      code: 'E_LOAD_NUMERIC_OWNERSHIP', stage: 'semantic',
      message: 'Numeric value sits in an unclassified region of the schema',
      path, definitionId: id,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanUngovernedRegion(item, `${path}/${index}`, input));
    return;
  }
  if (isJsonObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      scanUngovernedRegion(nested, joinJsonPointer(path, key), input);
    }
  }
}

interface RequiredFieldInput {
  readonly candidates: ReadonlyMap<string, CandidateDefinition>;
  readonly working: ReadonlyMap<string, CandidateDefinition>;
  readonly lineages: ReadonlyMap<string, readonly string[]>;
  readonly schema: SchemaVersion;
  readonly pathFor: (id: string, suffix?: string) => string;
  readonly report: Report;
}

/**
 * Report missing required fields and supply registered presentation fallbacks.
 *
 * A field counts as present when the definition declares it, when an ancestor on its declared lineage
 * declares it, or when one of its components supplies it, which mirrors exactly what resolution merges.
 * Returns the candidates that had a fallback applied, so the caller can publish the value it announced.
 */
function completeRequiredFields(input: RequiredFieldInput): ReadonlyMap<string, CandidateDefinition> {
  const { candidates, working, lineages, schema, pathFor, report } = input;
  const patched = new Map<string, CandidateDefinition>();
  for (const id of [...candidates.keys()].sort(compareCodePoints)) {
    const candidate = candidates.get(id);
    if (!candidate) continue;
    const definitionSchema = schema.definitionSchemas.get(candidate.kind);
    if (!definitionSchema) continue;
    const provided = providedFieldNames(id, working, lineages);
    const fallbacks: PresentationFallback[] = [];
    for (const [key, rule] of Object.entries(definitionSchema.fields)) {
      if (!rule.required || provided.has(key)) continue;
      if (rule.presentation && rule.fallback !== undefined) {
        report({
          code: 'E_LOAD_PRESENTATION_FALLBACK', stage: 'semantic',
          message: `Optional presentation field ${key} uses registered fallback`,
          path: pathFor(id, `/${key}`), definitionId: id, warning: true,
        });
        fallbacks.push({ segments: [key], value: rule.fallback });
      } else {
        report({
          code: 'E_LOAD_REQUIRED_FIELD', stage: 'schema', message: `Required field ${key} is missing`,
          path: pathFor(id, `/${key}`), definitionId: id,
        });
      }
    }
    if (fallbacks.length > 0) patched.set(id, applyPresentationFallbacks(candidate, fallbacks));
  }
  return patched;
}

/**
 * Field names a definition will have after inheritance and composition.
 *
 * Only direct components are consulted, because resolution merges a component's own fields rather than its
 * resolved fields; consulting more here would accept a definition that resolution then leaves incomplete.
 */
function providedFieldNames(
  id: string,
  working: ReadonlyMap<string, CandidateDefinition>,
  lineages: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> {
  const names = new Set<string>();
  const add = (definition: CandidateDefinition | undefined): void => {
    for (const key of Object.keys(definition?.value ?? {})) names.add(key);
  };
  for (const member of lineages.get(id) ?? [id]) add(working.get(member));
  for (const componentId of working.get(id)?.components ?? []) add(working.get(componentId));
  return names;
}

function applyPresentationFallbacks(
  definition: CandidateDefinition,
  fallbacks: readonly PresentationFallback[],
): CandidateDefinition {
  let value: JsonValue = definition.value as unknown as JsonValue;
  for (const fallback of fallbacks) value = setAtSegments(value, fallback.segments, fallback.value);
  return Object.freeze({ ...definition, value: value as Readonly<Record<string, JsonValue>> });
}

/** Structural set along a path, cloning each level so no existing value is mutated in place. */
function setAtSegments(target: JsonValue, segments: readonly string[], value: JsonValue): JsonValue {
  const head = segments[0];
  if (head === undefined) return value;
  const rest = segments.slice(1);
  if (Array.isArray(target)) {
    const index = Number.parseInt(head, 10);
    if (!Number.isInteger(index) || index < 0 || index >= target.length) return target;
    const copy = [...target];
    copy[index] = setAtSegments(target[index] as JsonValue, rest, value);
    return copy;
  }
  const base: Record<string, JsonValue> = isJsonObject(target) ? { ...target } : {};
  base[head] = setAtSegments(base[head] ?? null, rest, value);
  return base;
}

function validateNumericBounds(
  value: number,
  rule: FieldRule,
  path: string,
  id: string,
  report: Report,
): void {
  if (rule.integer && !Number.isSafeInteger(value)) {
    report({
      code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: 'Value must be a safe integer',
      path, definitionId: id,
    });
  }
  if (rule.minimum !== undefined && value < rule.minimum) {
    report({
      code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'semantic',
      message: `Value must be at least ${rule.minimum}`, path, definitionId: id,
    });
  }
  if (rule.maximum !== undefined && value > rule.maximum) {
    report({
      code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'semantic',
      message: `Value must be at most ${rule.maximum}`, path, definitionId: id,
    });
  }
}

function validateUnorderedIdentity(
  value: readonly JsonValue[],
  rule: FieldRule,
  path: string,
  id: string,
  report: Report,
): void {
  if (!rule.identityField) {
    report({
      code: 'E_LOAD_CANONICAL_AMBIGUOUS', stage: 'canonicalization',
      message: 'Unordered collection has no identity field', path, definitionId: id,
    });
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!isJsonObject(item) || typeof item[rule.identityField as string] !== 'string') {
      report({
        code: 'E_LOAD_CANONICAL_AMBIGUOUS', stage: 'canonicalization',
        message: `Unordered member lacks ${rule.identityField}`, path: `${path}/${index}`, definitionId: id,
      });
      return;
    }
    const identity = item[rule.identityField as string] as string;
    if (seen.has(identity)) {
      report({
        code: 'E_LOAD_CANONICAL_AMBIGUOUS', stage: 'canonicalization',
        message: `Unordered identity ${identity} is duplicated`, path: `${path}/${index}`, definitionId: id,
      });
    }
    seen.add(identity);
  });
}

function validateDeclaredReferences(
  definition: CandidateDefinition,
  schema: DefinitionSchema,
  working: ReadonlyMap<string, CandidateDefinition>,
  context: ValidationContext,
  pathFor: (id: string, suffix?: string) => string,
  report: Report,
): number {
  let counted = 0;
  for (const [field, rule] of Object.entries(schema.fields)) {
    if (!rule.reference) continue;
    const raw = definition.value[field];
    if (raw === undefined) continue;
    const targets = typeof raw === 'string'
      ? [raw]
      : Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
    targets.forEach((targetId, index) => {
      counted++;
      const target = working.get(targetId);
      const suffix = Array.isArray(raw) ? `/${field}/${index}` : `/${field}`;
      const targetPath = pathFor(definition.id, suffix);
      if (!target) {
        report({
          code: 'E_REF_MISSING', stage: 'reference', message: `Reference ${targetId} does not exist`,
          path: targetPath, definitionId: definition.id,
        });
        return;
      }
      if (rule.reference?.kinds && !rule.reference.kinds.includes(target.kind)) {
        report({
          code: 'E_REF_KIND', stage: 'reference', message: `Reference ${targetId} has kind ${target.kind}`,
          path: targetPath, definitionId: definition.id, relatedSources: [target.source],
        });
      }
      if (rule.reference?.semanticFamilies && !rule.reference.semanticFamilies.includes(target.semanticFamily)) {
        report({
          code: 'E_REF_KIND', stage: 'reference',
          message: `Reference ${targetId} belongs to another semantic family`,
          path: targetPath, definitionId: definition.id, relatedSources: [target.source],
        });
      }
      if (target.abstract && rule.reference?.allowAbstract !== true) {
        report({
          code: 'E_REF_ABSTRACT', stage: 'reference', message: `Reference ${targetId} is abstract`,
          path: targetPath, definitionId: definition.id, relatedSources: [target.source],
        });
      }
      if (rule.reference?.provider && !context.schema.integrationContracts.has(rule.reference.provider)) {
        report({
          code: 'E_REF_PROVIDER_CONTRACT', stage: 'reference',
          message: `Provider contract ${rule.reference.provider} is unavailable`,
          path: targetPath, definitionId: definition.id,
        });
      }
    });
  }
  return counted;
}

/** Returns true when the definition declares a valid self-targeted override of an active definition. */
function validateOverride(
  value: Readonly<Record<string, JsonValue>>,
  id: string,
  path: string,
  schema: DefinitionSchema,
  activeSnapshot: RegistrySnapshot,
  report: Report,
): boolean {
  const active = activeSnapshot.model?.definitions[id];
  const override = value['override'];
  if (active && override !== id) {
    report({
      code: 'E_LOAD_OVERRIDE_INVALID', stage: 'semantic',
      message: `Active definition ${id} requires an explicit self-targeted override`,
      path: `${path}/override`, definitionId: id, relatedSources: [active.source],
    });
    return false;
  }
  if (override === undefined) return false;
  if (typeof override !== 'string' || override !== id || !active) {
    report({
      code: 'E_LOAD_OVERRIDE_INVALID', stage: 'semantic',
      message: 'Override must uniquely target the active definition with the same id',
      path: `${path}/override`, definitionId: id,
    });
    return false;
  }
  if (active.kind !== schema.kind) {
    report({
      code: 'E_LOAD_OVERRIDE_INVALID', stage: 'semantic',
      message: `Override kind ${schema.kind} does not match active kind ${active.kind}`,
      path: `${path}/override`, definitionId: id, relatedSources: [active.source],
    });
    return false;
  }
  return true;
}

function validateTerms(
  value: Readonly<Record<string, JsonValue>>,
  path: string,
  id: string,
  status: SourceNormativeStatus,
  report: Report,
): void {
  if (status !== 'normative') return;
  for (const field of TERM_FIELDS) {
    const term = value[field];
    if (typeof term === 'string' && NON_CANONICAL_TERMS[term]) {
      report({
        code: 'E_LOAD_TERM_NONCANONICAL', stage: 'semantic',
        message: `Term ${term} must be replaced with ${NON_CANONICAL_TERMS[term]}`,
        path: `${path}/${field}`, definitionId: id,
      });
    }
  }
}

/**
 * Turn statements into normative contracts, or preserve the disagreement.
 *
 * Two behaviours matter here. A statement may lower its document's authority but never raise it, so
 * historical material cannot become binding. And a material conflict between equally authoritative
 * sources is preserved as an Unresolved_Item instead of being decided: the affected contract is withheld,
 * every conflicting statement is kept, and the rest of the document still compiles. Anything that
 * actually depends on a withheld contract is refused separately, which is what keeps "no implicit
 * arbitration" from turning into "silently missing rule".
 */
function resolveStatements(
  raw: JsonValue | undefined,
  context: ValidationContext,
  report: Report,
  consumeWork: ConsumeWork,
): StatementResolution {
  const activeModel = context.activeSnapshot.model;
  // The published model is the whole active set, so statements decided by an earlier package are carried
  // forward. Emitting only this document's statements would silently erase every previously decided
  // contract and every preserved open item the moment a second package is activated.
  const normative: Record<string, NormativeStatement> = Object.create(null) as Record<string, NormativeStatement>;
  for (const [key, statement] of Object.entries(activeModel?.normativeStatements ?? {})) {
    normative[key] = statement;
  }
  const carried = new Map<string, UnresolvedItem>();
  for (const item of activeModel?.unresolvedItems ?? []) carried.set(item.key, item);
  const unresolved: UnresolvedItem[] = [];
  // A carried-over open item keeps withholding anything derived from it, otherwise a bound citing an
  // undecided statement would start passing simply because the next package did not mention it.
  const withheldKeys = new Set<string>(carried.keys());

  const finish = (): StatementResolution => {
    for (const key of [...carried.keys()].sort(compareCodePoints)) {
      const item = carried.get(key);
      if (item) unresolved.push(item);
    }
    return {
      normative,
      unresolved: unresolved.sort((left, right) => compareCodePoints(left.key, right.key)),
      withheldKeys,
    };
  };

  if (raw === undefined) return finish();
  if (!Array.isArray(raw)) {
    report({ code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: 'statements must be an array', path: '/statements' });
    return finish();
  }

  const previouslyUnresolved = new Set(carried.keys());
  const groups = new Map<string, NormativeStatement[]>();
  raw.forEach((item, index) => {
    const path = `/statements/${index}`;
    if (!consumeWork(path)) return;
    const statement = readStatement(item, path, context, previouslyUnresolved, report);
    if (!statement) return;
    const existing = groups.get(statement.key) ?? [];
    existing.push(statement);
    groups.set(statement.key, existing);
  });

  reportReusedDecisionIds(groups, report);
  for (const [key, statements] of [...groups.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
    if (!acceptsRedecision(key, statements, normative[key], report)) continue;
    // This document speaks about the key, so it decides the key: the carried-over state is replaced by
    // whatever adjudication produces below, including a fresh open item.
    carried.delete(key);
    withheldKeys.delete(key);
    delete normative[key];
    resolveOneKey(key, statements, { normative, unresolved, withheldKeys }, report);
  }
  return finish();
}

/**
 * Guard a change to an already decided statement.
 *
 * Replacing a decided contract with a different value is not an ordinary edit: it revokes a rule other
 * definitions may already depend on. By symmetry with a definition override, it has to be deliberate, so a
 * recorded decision identifier is required. Re-declaring the same value is idempotent and passes silently.
 */
function acceptsRedecision(
  key: string,
  statements: readonly NormativeStatement[],
  active: NormativeStatement | undefined,
  report: Report,
): boolean {
  if (!active) return true;
  const activeValue = canonicalStringify(active.value);
  if (statements.every((statement) => canonicalStringify(statement.value) === activeValue)) return true;
  if (statements.some((statement) => statement.source.decisionId !== undefined)) return true;
  report({
    code: 'E_LOAD_NORMATIVE_WITHOUT_PROVENANCE', stage: 'precedence',
    message: `Statement ${key} already has an activated value and cannot be changed without a decision`,
    path: '/statements', relatedSources: [active.source],
    suggestion: '这条规则已经生效过，改成别的内容需要有据可依。请附上作出改动的决策编号，或保持原有内容不变。',
  });
  return false;
}

function readStatement(
  item: JsonValue,
  path: string,
  context: ValidationContext,
  previouslyUnresolved: ReadonlySet<string>,
  report: Report,
): NormativeStatement | null {
  if (!isJsonObject(item) || typeof item['key'] !== 'string' || item['value'] === undefined) {
    report({
      code: 'E_LOAD_REQUIRED_FIELD', stage: 'schema',
      message: 'Statement requires key and value', path,
    });
    return null;
  }
  const sourceBase = context.document.locations.get(path) ?? context.document.source;
  const precedence = typeof item['precedence'] === 'number' ? item['precedence'] : sourceBase.precedence;
  const status = typeof item['status'] === 'string' && LEGAL_STATUSES.has(item['status'] as SourceNormativeStatus)
    ? item['status'] as SourceNormativeStatus
    : sourceBase.normativeStatus;
  // A statement may only lower its own authority. Allowing a historical or deprecated document to
  // declare `status: "normative"` per statement would let non-authoritative material silently become
  // a binding contract, which is exactly the promotion the source model is meant to prevent.
  if (isStatusPromotion(sourceBase.normativeStatus, status)) {
    report({
      code: 'E_LOAD_SOURCE_STATUS_PROMOTION', stage: 'precedence',
      message: `Statement cannot raise its authority from ${sourceBase.normativeStatus} to ${status}`,
      path: `${path}/status`,
      messageArgs: { declaredStatus: status, documentStatus: sourceBase.normativeStatus },
    });
    return null;
  }
  // Precedence is authority in numeric form, so it obeys the same one-way rule as status. The document's
  // precedence is assigned by the host from the source hierarchy; letting a statement declare a larger
  // number would let any document outrank the constitution simply by writing a bigger integer.
  if (precedence > sourceBase.precedence) {
    report({
      code: 'E_LOAD_SOURCE_INVALID', stage: 'precedence',
      message: `Statement precedence ${precedence} exceeds the document precedence ${sourceBase.precedence}`,
      path: `${path}/precedence`,
      suggestion: '规则的效力不能高于它所在文件的效力。请把这个数值改成不超过文件本身的效力，'
        + '或把规则移到效力更高的文件里。',
    });
    return null;
  }
  const decisionId = typeof item['decisionId'] === 'string' ? item['decisionId'] : sourceBase.decisionId;
  if (status === 'normative' && previouslyUnresolved.has(item['key']) && decisionId === undefined) {
    report({
      code: 'E_LOAD_NORMATIVE_WITHOUT_PROVENANCE', stage: 'precedence',
      message: `Statement ${item['key']} was undecided and needs a resolving decision to become normative`,
      path, suggestion: '这条规则之前被记为未决。要让它生效，请附上作出决定的决策编号。',
    });
    return null;
  }
  if (status === 'historical' || status === 'deprecated') {
    // Dropping the statement is correct, but doing it silently is not: the creator must be told that
    // the rule they wrote has no binding effect.
    report({
      code: 'E_LOAD_SOURCE_DISPLACED', stage: 'precedence',
      message: `Statement ${item['key']} is ${status} and therefore carries no normative effect`,
      path, informational: true,
      suggestion: '这条规则被标记为历史或废弃材料，不会生效。若要让它生效，请改为正式规则并附上决策依据。',
    });
    return null;
  }
  return { key: item['key'], value: item['value'], source: { ...sourceBase, precedence, decisionId, normativeStatus: status } };
}

interface KeyResolutionTarget {
  readonly normative: Record<string, NormativeStatement>;
  readonly unresolved: UnresolvedItem[];
  readonly withheldKeys: Set<string>;
}

function resolveOneKey(
  key: string,
  statements: readonly NormativeStatement[],
  target: KeyResolutionTarget,
  report: Report,
): void {
  const sorted = [...statements].sort((a, b) =>
    b.source.precedence - a.source.precedence || compareCodePoints(a.source.sourceId, b.source.sourceId));
  const highest = sorted[0]?.source.precedence;
  const controlling = sorted.filter((statement) => statement.source.precedence === highest);
  const distinct = new Map(controlling.map((statement) => [canonicalStringify(statement.value), statement]));
  const undecided = controlling.some((statement) => statement.source.normativeStatus === 'unresolved');

  if (distinct.size > 1 || undecided) {
    // Preserved, not decided: the item stays in the model so a later authoritative decision has
    // something to resolve, and the contract it would have produced is withheld until then.
    target.unresolved.push({ key, statements: Object.freeze(controlling) });
    target.withheldKeys.add(key);
    for (const statement of controlling) {
      report({
        code: distinct.size > 1 ? 'E_LOAD_EQUAL_PRECEDENCE_CONFLICT' : 'E_LOAD_UNRESOLVED_NORMATIVE',
        stage: 'precedence', warning: true,
        message: distinct.size > 1
          ? `Equal-precedence conflict for ${key} is preserved as an undecided item`
          : `Statement ${key} is marked undecided, so it produces no contract`,
        path: '/statements',
        relatedSources: controlling.filter((item) => item !== statement).map((item) => item.source),
        messageArgs: distinct.size > 1 ? {} : { statementKey: key },
      });
    }
    return;
  }

  const winner = controlling[0];
  if (!winner) return;
  target.normative[key] = winner;
  for (const displaced of sorted) {
    if (displaced.source.precedence >= (highest ?? Number.NEGATIVE_INFINITY)) continue;
    report({
      code: 'E_LOAD_SOURCE_DISPLACED', stage: 'precedence', warning: true,
      message: `Statement ${key} was displaced by a higher-precedence source`,
      path: '/statements', relatedSources: [winner.source],
    });
  }
}

/**
 * One decision identifier must describe one decision. When the same id is attached to statements with
 * different content, the compiler cannot tell which one the decision actually authorised, so it keeps
 * every source and warns instead of silently merging them.
 */
function reportReusedDecisionIds(
  groups: ReadonlyMap<string, readonly NormativeStatement[]>,
  report: Report,
): void {
  const byDecision = new Map<string, NormativeStatement[]>();
  for (const statements of groups.values()) {
    for (const statement of statements) {
      const decisionId = statement.source.decisionId;
      if (!decisionId) continue;
      const bucket = byDecision.get(decisionId) ?? [];
      bucket.push(statement);
      byDecision.set(decisionId, bucket);
    }
  }
  for (const [decisionId, statements] of [...byDecision.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
    const distinct = new Set(statements.map((statement) => `${statement.key}\u0000${canonicalStringify(statement.value)}`));
    if (distinct.size <= 1) continue;
    for (const statement of statements) {
      report({
        code: 'E_LOAD_DECISION_ID_REUSED', stage: 'precedence',
        message: `Decision ${decisionId} is attached to ${distinct.size} different statements`,
        path: '/statements', warning: true,
        messageArgs: { decisionId, variantCount: distinct.size },
        relatedSources: statements.filter((item) => item !== statement).map((item) => item.source),
      });
    }
  }
}

interface ModelInput {
  readonly schemaVersion: string;
  readonly targetLayer: SourceOwningLayer;
  readonly declaration: PackageDeclaration;
  readonly activePackages: Readonly<Record<string, PackageRecord>>;
  readonly families: ReadonlyMap<string, SemanticFamilyRegistration>;
  readonly working: ReadonlyMap<string, CandidateDefinition>;
  readonly resolved: ReadonlyMap<string, ResolvedDefinition>;
  readonly graph: { readonly outbound: ReadonlyMap<string, readonly { readonly to: string }[]>;
    readonly inbound: ReadonlyMap<string, readonly { readonly from: string }[]> };
  readonly statements: StatementResolution;
  readonly documentSource: SourceRecord;
}

/**
 * Assemble the activated model.
 *
 * Everything is emitted in canonical order so two runs that activated the same content produce
 * byte-identical output. The model is the whole merged active set, which is what makes the published
 * artifact self-contained instead of describing only the last change.
 */
function buildModel(input: ModelInput): CompiledModel {
  const ids = [...input.working.keys()].sort(compareCodePoints);
  const definitions: Record<string, CandidateDefinition> = Object.create(null) as Record<string, CandidateDefinition>;
  const resolved: Record<string, ResolvedDefinition> = Object.create(null) as Record<string, ResolvedDefinition>;
  const dependencyGraph: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
  const inboundGraph: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
  for (const id of ids) {
    const definition = input.working.get(id);
    if (definition) definitions[id] = definition;
    const resolvedDefinition = input.resolved.get(id);
    if (resolvedDefinition) resolved[id] = resolvedDefinition;
    dependencyGraph[id] = Object.freeze(
      [...new Set((input.graph.outbound.get(id) ?? []).map((edge) => edge.to))].sort(compareCodePoints));
    inboundGraph[id] = Object.freeze(
      [...new Set((input.graph.inbound.get(id) ?? []).map((edge) => edge.from))].sort(compareCodePoints));
  }

  const packages: Record<string, PackageRecord> = Object.create(null) as Record<string, PackageRecord>;
  const packageRecord = toPackageRecord(input.declaration);
  for (const id of [...Object.keys(input.activePackages), packageRecord.packageId].sort(compareCodePoints)) {
    const record = id === packageRecord.packageId ? packageRecord : input.activePackages[id];
    if (record) packages[id] = record;
  }

  const families: Record<string, SemanticFamilyRegistration> =
    Object.create(null) as Record<string, SemanticFamilyRegistration>;
  for (const id of [...input.families.keys()].sort(compareCodePoints)) {
    const registration = input.families.get(id);
    if (registration) families[id] = registration;
  }

  return Object.freeze({
    schemaVersion: input.schemaVersion,
    targetLayer: input.targetLayer,
    packages: Object.freeze(packages),
    semanticFamilies: Object.freeze(families),
    definitions: Object.freeze(definitions),
    resolvedDefinitions: Object.freeze(resolved),
    normativeStatements: Object.freeze(input.statements.normative),
    unresolvedItems: Object.freeze([...input.statements.unresolved]),
    dependencyGraph: Object.freeze(dependencyGraph),
    inboundGraph: Object.freeze(inboundGraph),
    sourceRecords: Object.freeze([
      input.documentSource,
      ...ids.map((id) => input.working.get(id)?.source).filter((source): source is SourceRecord => source !== undefined),
      ...Object.values(input.statements.normative).map((statement) => statement.source),
    ]),
  });
}

function readRequiredString(
  value: Readonly<Record<string, JsonValue>>,
  field: string,
  path: string,
  report: Report,
): string {
  const raw = value[field];
  const fieldPath = joinJsonPointer(path, field);
  if (raw === undefined) {
    report({
      code: 'E_LOAD_REQUIRED_FIELD', stage: 'schema',
      message: `Required field ${field} is missing`, path: fieldPath,
    });
    return '';
  }
  if (typeof raw !== 'string') {
    report({
      code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: `${field} must be a string`, path: fieldPath,
    });
    return '';
  }
  return raw;
}

function readStringArray(
  raw: JsonValue | undefined,
  path: string,
  id: string,
  report: Report,
): readonly string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    report({
      code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: 'Expected an array of identifiers',
      path, definitionId: id,
    });
    return [];
  }
  return Object.freeze([...(raw as readonly string[])]);
}

/**
 * Read an inheritance or composition edge list.
 *
 * Beyond shape, two authoring mistakes are refused here. A duplicate entry makes the declared order
 * ambiguous, which matters because an explicit merge rule has to name providers exactly. A self-reference
 * in a composition list is meaningless: the definition would contribute its own fields to itself, which
 * silently succeeds today and hides whatever the author actually meant. `extends` self-references are left
 * to the cycle pass, which already describes a self-loop accurately and names every participant.
 */
function readRelationIds(
  raw: JsonValue | undefined,
  path: string,
  id: string,
  relation: 'extends' | 'components',
  report: Report,
): readonly string[] {
  const values = readStringArray(raw, path, id, report);
  const seen = new Set<string>();
  const accepted: string[] = [];
  values.forEach((value, index) => {
    if (seen.has(value)) {
      report({
        code: 'E_LOAD_DUPLICATE_ID', stage: 'schema',
        message: `${relation} lists ${value} twice`, path: `${path}/${index}`, definitionId: id,
        suggestion: '同一个编号在这份列表里只需要出现一次。请删掉重复的那一条。',
      });
      return;
    }
    seen.add(value);
    if (relation === 'components' && value === id) {
      report({
        code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'composition',
        message: `${id} cannot compose itself`, path: `${path}/${index}`, definitionId: id,
        suggestion: '一份内容不能把自己作为组件装进自己。请改成引用别的内容，或删掉这一条。',
      });
      return;
    }
    accepted.push(value);
  });
  return Object.freeze(accepted);
}

function readKindList(
  raw: JsonValue | undefined,
  path: string,
  context: ValidationContext,
  report: Report,
): readonly DefKind[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((item) => typeof item !== 'string')) {
    report({
      code: 'E_LOAD_FIELD_TYPE', stage: 'schema',
      message: 'allowedKinds must be a non-empty array of registered kinds', path,
    });
    return [];
  }
  const kinds: DefKind[] = [];
  (raw as readonly string[]).forEach((kind, index) => {
    if (!context.schema.definitionSchemas.has(kind as DefKind)) {
      report({
        code: 'E_LOAD_DEF_KIND', stage: 'schema', message: `Kind ${kind} is not registered`,
        path: `${path}/${index}`,
      });
      return;
    }
    kinds.push(kind as DefKind);
  });
  return kinds;
}

function readCriteria(
  raw: JsonValue | undefined,
  path: string,
  report: Report,
): { enumerable: boolean; composable: boolean; gameplayIndependent: boolean } | null {
  if (!isJsonObject(raw)) {
    report({
      code: 'E_LOAD_REQUIRED_FIELD', stage: 'schema',
      message: 'criteria must declare enumerable, composable and gameplayIndependent', path,
    });
    return null;
  }
  const names = ['enumerable', 'composable', 'gameplayIndependent'] as const;
  const values: Record<string, boolean> = {};
  for (const name of names) {
    const value = raw[name];
    if (typeof value !== 'boolean') {
      report({
        code: 'E_LOAD_FIELD_TYPE', stage: 'schema', message: `${name} must be a boolean`,
        path: joinJsonPointer(path, name),
      });
      return null;
    }
    values[name] = value;
  }
  return {
    enumerable: values['enumerable'] === true,
    composable: values['composable'] === true,
    gameplayIndependent: values['gameplayIndependent'] === true,
  };
}

function isJsonObject(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value: JsonValue): value is string | number | boolean | null {
  return value === null || typeof value !== 'object';
}

/**
 * Identifier shape check. The length ceiling is a host resource limit rather than a normative constant,
 * so it arrives through the injected quotas instead of being fixed in this module.
 */
function isValidIdentifier(value: string, maximumLength: number): boolean {
  return value.length > 0 && value.length <= maximumLength && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

/** Authority rank. A statement may keep or lower its document's authority, never raise it. */
const STATUS_RANK: Readonly<Record<SourceNormativeStatus, number>> = Object.freeze({
  normative: 3,
  unresolved: 2,
  deprecated: 1,
  historical: 1,
});

function isStatusPromotion(documentStatus: SourceNormativeStatus, declaredStatus: SourceNormativeStatus): boolean {
  return STATUS_RANK[declaredStatus] > STATUS_RANK[documentStatus];
}

function stageNumber(stage: ReportInput['stage']): number {
  const order = [
    'intake', 'parse', 'schema', 'semantic', 'precedence', 'reference', 'composition',
    'migration', 'canonicalization', 'commit-recheck', 'staging-write', 'publish', 'rollback',
  ];
  return order.indexOf(stage);
}
