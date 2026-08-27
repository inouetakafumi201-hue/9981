import type { SourceOwningLayer } from '../state/diagnostic';
import { joinJsonPointer } from './json-codec';
import type {
  BoundProvenance,
  DefinitionSchema,
  FieldRule,
  NumericOwnership,
  Report,
} from './types';

/**
 * Player-visible values are constrained to 1-5 by the project constitution. Named constants keep the
 * check, the technical message and the localisable `messageArgs` from ever disagreeing.
 */
export const GAMEPLAY_VALUE_MINIMUM = 1;
export const GAMEPLAY_VALUE_MAXIMUM = 5;

/**
 * The four classifications a parameter field may declare, plus the engine-owned technical quota.
 *
 * A gameplay value belongs to the play layer and is bounded by the constitution. A structural bound and
 * a constitutional constant are normative, so both need authoritative provenance. An internal metric is
 * validated by its own declared schema instead of the gameplay range. A technical quota is an
 * engine-owned resource limit and is the only classification whose owning layer is fixed.
 */
export const NUMERIC_OWNERSHIPS: readonly NumericOwnership[] = Object.freeze([
  'gameplay-value',
  'structural-bound',
  'constitutional-constant',
  'internal-metric',
  'technical-quota',
]);

/** Classifications that assert a normative limit and therefore require provenance. */
const PROVENANCE_REQUIRED: ReadonlySet<NumericOwnership> = new Set<NumericOwnership>([
  'structural-bound',
  'constitutional-constant',
  'technical-quota',
]);

/** Host schema contract violation. Raised by `SchemaRegistry.register`, never by candidate input. */
export class SchemaContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaContractError';
  }
}

export function requiresBoundProvenance(ownership: NumericOwnership): boolean {
  return PROVENANCE_REQUIRED.has(ownership);
}

/** An internal metric must carry its own schema, otherwise nothing constrains it at all. */
export function declaresInternalMetricSchema(rule: FieldRule): boolean {
  return rule.integer === true ||
    rule.minimum !== undefined ||
    rule.maximum !== undefined ||
    rule.unit !== undefined;
}

function ruleAcceptsNumber(rule: FieldRule): boolean {
  return Array.isArray(rule.type) ? rule.type.includes('number') : rule.type === 'number';
}

function provenanceIssues(
  provenance: BoundProvenance | undefined,
  ownership: NumericOwnership,
  leafName: string,
): readonly string[] {
  if (!provenance) return [`${ownership} requires an authoritative source record`];
  const issues: string[] = [];
  if (provenance.sourceId.trim().length === 0) issues.push('boundProvenance.sourceId is empty');
  if (provenance.rationale.trim().length === 0) issues.push('boundProvenance.rationale is empty');
  if (!provenance.affectedFields.includes(leafName)) {
    issues.push(`boundProvenance.affectedFields does not list ${leafName}`);
  }
  if (ownership === 'technical-quota' && provenance.owningLayer !== ENGINE_LAYER) {
    issues.push('a technical quota must be owned by the engine layer');
  }
  return issues;
}

const ENGINE_LAYER: SourceOwningLayer = '引擎层';

/**
 * Static contract check for one field rule tree.
 *
 * It runs when the host registers a schema, so an unclassified or unsourced numeric field can never be
 * offered to a creator in the first place. Returning the issues instead of throwing lets the caller
 * report every problem in one message.
 */
export function collectNumericSchemaIssues(
  rule: FieldRule,
  fieldPath: string,
  leafName: string,
): readonly string[] {
  const issues: string[] = [];
  if (ruleAcceptsNumber(rule)) {
    const ownership = rule.numericOwnership;
    if (!ownership) {
      issues.push(`${fieldPath}: numeric field declares no ownership classification`);
    } else if (requiresBoundProvenance(ownership)) {
      for (const issue of provenanceIssues(rule.boundProvenance, ownership, leafName)) {
        issues.push(`${fieldPath}: ${issue}`);
      }
    } else if (ownership === 'internal-metric' && !declaresInternalMetricSchema(rule)) {
      issues.push(`${fieldPath}: internal metric declares neither unit, integer flag nor range`);
    } else if (ownership === 'gameplay-value') {
      issues.push(...gameplayRangeIssues(rule, fieldPath));
    }
  }
  if (rule.item) {
    issues.push(...collectNumericSchemaIssues(rule.item, `${fieldPath}/*`, leafName));
  }
  if (rule.defaultProperty) {
    // The rule that governs unnamed members is a real numeric site: leaving it unchecked would let a host
    // reopen the exact hole this classification exists to close, one nesting level down.
    issues.push(...collectNumericSchemaIssues(rule.defaultProperty, `${fieldPath}/*`, leafName));
  }
  for (const [nested, nestedRule] of Object.entries(rule.properties ?? {})) {
    issues.push(...collectNumericSchemaIssues(nestedRule, joinJsonPointer(fieldPath, nested), nested));
  }
  return issues;
}

function gameplayRangeIssues(rule: FieldRule, fieldPath: string): readonly string[] {
  const issues: string[] = [];
  if (rule.minimum !== undefined && rule.minimum < GAMEPLAY_VALUE_MINIMUM) {
    issues.push(`${fieldPath}: gameplay minimum ${rule.minimum} is below the constitutional range`);
  }
  if (rule.maximum !== undefined && rule.maximum > GAMEPLAY_VALUE_MAXIMUM) {
    issues.push(`${fieldPath}: gameplay maximum ${rule.maximum} is above the constitutional range`);
  }
  return issues;
}

/** Whole-schema contract check. Throws so a misconfigured host fails before compiling anything. */
export function assertSchemaNumericContract(schema: DefinitionSchema): void {
  const issues: string[] = [];
  for (const [field, rule] of Object.entries(schema.fields)) {
    issues.push(...collectNumericSchemaIssues(rule, field, field));
  }
  if (issues.length > 0) {
    throw new SchemaContractError(`Schema for kind ${schema.kind} is not classifiable: ${issues.join('; ')}`);
  }
}

export interface NumericValueContext {
  readonly value: number;
  readonly rule: FieldRule;
  readonly path: string;
  readonly leafName: string;
  readonly definitionId: string;
  readonly targetLayer: SourceOwningLayer | null;
  /** Statement keys withheld as Unresolved_Items. A bound derived from one of them cannot be used. */
  readonly withheldStatementKeys: ReadonlySet<string>;
  readonly report: Report;
}

const PLAY_LAYER: SourceOwningLayer = '玩法层';

/**
 * Enforce the four-way classification on one concrete numeric value.
 *
 * Every branch is exhaustive on purpose: an unclassified number, a gameplay value outside the layer or
 * the constitutional range, an unsourced normative bound and a bound derived from an undecided statement
 * are all refused. Nothing falls through to a permissive default.
 */
export function enforceNumericClassification(context: NumericValueContext): void {
  const { rule, path, definitionId, report } = context;
  const ownership = rule.numericOwnership;
  if (!ownership) {
    report({
      code: 'E_LOAD_NUMERIC_OWNERSHIP', stage: 'semantic',
      message: 'Numeric field has no ownership classification',
      path, definitionId,
    });
    return;
  }

  if (ownership === 'gameplay-value') {
    enforceGameplayValue(context);
    return;
  }
  if (ownership === 'internal-metric') {
    if (!declaresInternalMetricSchema(rule)) {
      report({
        code: 'E_LOAD_NUMERIC_OWNERSHIP', stage: 'semantic',
        message: 'Internal metric declares no unit, integer flag or range of its own',
        path, definitionId,
      });
    }
    return;
  }

  const issues = provenanceIssues(rule.boundProvenance, ownership, context.leafName);
  if (issues.length > 0) {
    report({
      code: 'E_LOAD_NORMATIVE_WITHOUT_PROVENANCE', stage: 'semantic',
      message: `Bound classified ${ownership} lacks provenance: ${issues.join('; ')}`,
      path, definitionId,
    });
    return;
  }
  const statementKey = rule.boundProvenance?.statementKey;
  if (statementKey !== undefined && context.withheldStatementKeys.has(statementKey)) {
    report({
      code: 'E_LOAD_UNRESOLVED_NORMATIVE', stage: 'semantic',
      message: `Bound depends on the undecided statement ${statementKey}`,
      path, definitionId,
      messageArgs: { statementKey },
    });
  }
}

function enforceGameplayValue(context: NumericValueContext): void {
  const { value, path, definitionId, report } = context;
  if (context.targetLayer !== PLAY_LAYER) {
    report({
      code: 'E_LOAD_LAYER_OWNERSHIP', stage: 'semantic',
      message: `Concrete gameplay value is only allowed in ${PLAY_LAYER}`,
      path, definitionId,
    });
  }
  if (!Number.isFinite(value) || value < GAMEPLAY_VALUE_MINIMUM || value > GAMEPLAY_VALUE_MAXIMUM) {
    report({
      code: 'E_LOAD_GAMEPLAY_VALUE_RANGE', stage: 'semantic',
      message: `Gameplay value ${value} is outside ${GAMEPLAY_VALUE_MINIMUM}-${GAMEPLAY_VALUE_MAXIMUM}`,
      path, definitionId,
      messageArgs: { value, minimum: GAMEPLAY_VALUE_MINIMUM, maximum: GAMEPLAY_VALUE_MAXIMUM },
    });
  }
}
