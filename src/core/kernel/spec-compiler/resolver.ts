import { canonicalStringify, compareCodePoints, joinJsonPointer, jsonTypeOf } from './json-codec';
import { composedTypeIdentity } from './type-identity';
import type {
  CandidateDefinition,
  ConsumeWork,
  DefinitionSchema,
  JsonValue,
  MergeRule,
  ReferenceEdge,
  Report,
  ResolvedDefinition,
  SchemaVersion,
} from './types';

/** Definition members that describe structure rather than configurable content. */
export const STRUCTURAL_DEFINITION_FIELDS: ReadonlySet<string> = new Set([
  'id', 'kind', 'abstract', 'semanticFamily', 'extends', 'components',
  'mergeRules', 'override', 'typeIdentity', 'typeDefining',
]);

export interface ReferenceGraph {
  readonly definitions: ReadonlyMap<string, CandidateDefinition>;
  readonly outbound: ReadonlyMap<string, readonly ReferenceEdge[]>;
  readonly inbound: ReadonlyMap<string, readonly ReferenceEdge[]>;
}

/** Every typed reference a definition declares: inheritance, composition and schema reference fields. */
export function collectOutboundEdges(
  definition: CandidateDefinition,
  schema: DefinitionSchema | undefined,
  path: string,
): readonly ReferenceEdge[] {
  const edges: ReferenceEdge[] = [];
  definition.extends.forEach((target, index) => {
    edges.push({ from: definition.id, to: target, path: `${path}/extends/${index}`, relation: 'extends' });
  });
  definition.components.forEach((target, index) => {
    edges.push({ from: definition.id, to: target, path: `${path}/components/${index}`, relation: 'component' });
  });
  for (const [field, rule] of Object.entries(schema?.fields ?? {})) {
    if (!rule.reference) continue;
    const raw = definition.value[field];
    if (typeof raw === 'string') {
      edges.push({ from: definition.id, to: raw, path: joinJsonPointer(path, field), relation: 'field' });
    } else if (Array.isArray(raw)) {
      raw.forEach((item, index) => {
        if (typeof item !== 'string') return;
        edges.push({
          from: definition.id, to: item,
          path: `${joinJsonPointer(path, field)}/${index}`, relation: 'field',
        });
      });
    }
  }
  return edges;
}

/**
 * Build the reference graph over the whole working set.
 *
 * The graph spans the merged active-plus-candidate state rather than the candidate alone. That is what
 * lets a removal see everything that still points at it and lets a cycle be found even when only one of
 * its members is new.
 */
export function buildReferenceGraph(
  working: ReadonlyMap<string, CandidateDefinition>,
  schema: SchemaVersion,
  pathOf: (id: string) => string,
): ReferenceGraph {
  const outbound = new Map<string, readonly ReferenceEdge[]>();
  const inbound = new Map<string, ReferenceEdge[]>();
  for (const id of [...working.keys()].sort(compareCodePoints)) {
    const definition = working.get(id);
    if (!definition) continue;
    const edges = collectOutboundEdges(definition, schema.definitionSchemas.get(definition.kind), pathOf(id));
    outbound.set(id, Object.freeze([...edges]));
    for (const edge of edges) {
      const bucket = inbound.get(edge.to) ?? [];
      bucket.push(edge);
      inbound.set(edge.to, bucket);
    }
  }
  const frozenInbound = new Map<string, readonly ReferenceEdge[]>();
  for (const [id, edges] of [...inbound.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
    frozenInbound.set(id, Object.freeze([...edges].sort(compareEdges)));
  }
  return { definitions: working, outbound, inbound: frozenInbound };
}

function compareEdges(left: ReferenceEdge, right: ReferenceEdge): number {
  return compareCodePoints(left.from, right.from) ||
    compareCodePoints(left.path, right.path) ||
    compareCodePoints(left.relation, right.relation);
}

/** Inbound edges that come from a definition other than the target itself. */
export function inboundFrom(graph: ReferenceGraph, id: string): readonly ReferenceEdge[] {
  return (graph.inbound.get(id) ?? []).filter((edge) => edge.from !== id);
}

/**
 * Ancestor set of every definition, derived from the shared lineage computation.
 *
 * Deriving it rather than walking the graph a second time keeps the two answers consistent: a definition's
 * ancestors are exactly its lineage minus itself, so "is X an ancestor of Y" can never disagree with the
 * order resolution actually applied.
 */
export function computeAncestors(
  working: ReadonlyMap<string, CandidateDefinition>,
  lineages: ReadonlyMap<string, readonly string[]> = computeLineages(working),
): ReadonlyMap<string, ReadonlySet<string>> {
  const ancestors = new Map<string, ReadonlySet<string>>();
  for (const id of [...working.keys()].sort(compareCodePoints)) {
    const lineage = lineages.get(id) ?? [id];
    ancestors.set(id, new Set(lineage.filter((member) => member !== id)));
  }
  return ancestors;
}

interface LineageOutcome {
  readonly ordered: readonly string[];
  /** False when the guard or the work budget cut the traversal short, so the result must not be cached. */
  readonly cacheable: boolean;
}

/**
 * Declared lineage of every definition in the working set.
 *
 * The memo is what makes this affordable. Without it the walk re-expands every shared ancestor once per
 * path, so a diamond lattice of `n` definitions costs `2^n` visits and a modest hand-written document can
 * hang the compiler instead of being rejected. Results are only cached when the subtree was explored
 * without hitting the cycle guard or the work budget, because a truncated answer is not the real lineage.
 *
 * `consumeWork` bounds the whole computation. When it refuses, it has already reported the quota
 * diagnostic, so the caller fails closed rather than resolving against a truncated lineage.
 */
export function computeLineages(
  working: ReadonlyMap<string, CandidateDefinition>,
  pathOf: (id: string) => string = () => '',
  consumeWork: ConsumeWork = () => true,
): ReadonlyMap<string, readonly string[]> {
  const memo = new Map<string, readonly string[]>();
  const walk = (id: string, guard: ReadonlySet<string>): LineageOutcome => {
    const cached = memo.get(id);
    if (cached) return { ordered: cached, cacheable: true };
    if (guard.has(id)) return { ordered: EMPTY_LINEAGE, cacheable: false };
    if (!consumeWork(pathOf(id))) return { ordered: Object.freeze([id]), cacheable: false };

    const nextGuard = new Set([...guard, id]);
    const ordered: string[] = [];
    const seen = new Set<string>();
    let cacheable = true;
    for (const parent of working.get(id)?.extends ?? []) {
      if (!working.has(parent)) continue;
      const outcome = walk(parent, nextGuard);
      if (!outcome.cacheable) cacheable = false;
      // First appearance wins, which reproduces the declaration-order post-order walk exactly while
      // letting each ancestor subtree be computed once.
      for (const member of outcome.ordered) {
        if (seen.has(member)) continue;
        seen.add(member);
        ordered.push(member);
      }
    }
    if (!seen.has(id)) ordered.push(id);
    const frozen = Object.freeze([...ordered]);
    if (cacheable) memo.set(id, frozen);
    return { ordered: frozen, cacheable };
  };

  const lineages = new Map<string, readonly string[]>();
  for (const id of [...working.keys()].sort(compareCodePoints)) {
    lineages.set(id, walk(id, new Set()).ordered);
  }
  return lineages;
}

const EMPTY_LINEAGE: readonly string[] = Object.freeze([]);

/**
 * Report every inheritance cycle in the working set.
 *
 * Every participant is named, because telling a creator only one member of a cycle leaves them guessing
 * which edge to remove. The walk covers definitions inherited from earlier packages too: a candidate that
 * overrides an active definition can close a cycle whose other members it never mentions.
 */
export function reportInheritanceCycles(
  working: ReadonlyMap<string, CandidateDefinition>,
  pathOf: (id: string) => string,
  report: Report,
  consumeWork: ConsumeWork,
): ReadonlySet<string> {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  const stack: string[] = [];

  const walk = (id: string): void => {
    if (!consumeWork(pathOf(id))) return;
    if (visiting.has(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      for (const member of new Set(cycle)) {
        if (reported.has(member)) continue;
        reported.add(member);
        report({
          code: 'E_LOAD_INHERITANCE_CYCLE', stage: 'composition',
          message: `Inheritance cycle ${cycle.join(' -> ')}`,
          path: `${pathOf(member)}/extends`, definitionId: member,
          relatedSources: [...new Set(cycle)]
            .filter((other) => other !== member)
            .map((other) => working.get(other)?.source)
            .filter((source): source is NonNullable<typeof source> => source !== undefined),
        });
      }
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const parent of working.get(id)?.extends ?? []) {
      if (working.has(parent)) walk(parent);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of [...working.keys()].sort(compareCodePoints)) walk(id);
  return reported;
}

/**
 * Declared lineage from the furthest ancestor down to the definition itself.
 *
 * Parents are visited in declaration order and de-duplicated on first appearance, so a diamond produces
 * one deterministic order rather than depending on traversal luck. Callers that need the lineage of more
 * than one definition should use {@link computeLineages}, which shares one memo across the whole set.
 */
export function lineageOf(
  id: string,
  working: ReadonlyMap<string, CandidateDefinition>,
): readonly string[] {
  return computeLineages(working).get(id) ?? Object.freeze([id]);
}

interface FieldProvider {
  readonly providerId: string;
  readonly value: JsonValue;
}

/** One field claimed by two providers that are not on the same inheritance path. */
interface FieldConflict {
  readonly field: string;
  readonly providers: readonly FieldProvider[];
}

export interface ResolutionOutcome {
  readonly resolved: ReadonlyMap<string, ResolvedDefinition>;
  /** Definitions that could not be resolved because a conflict or incompatibility was reported. */
  readonly failed: ReadonlySet<string>;
}

/** Parse the declared merge rules. An unparseable rule is refused rather than treated as permission. */
export function readMergeRules(
  raw: JsonValue | undefined,
  path: string,
  definitionId: string,
  report: Report,
): ReadonlyMap<string, MergeRule> {
  const rules = new Map<string, MergeRule>();
  if (raw === undefined) return rules;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    report({
      code: 'E_LOAD_FIELD_TYPE', stage: 'schema',
      message: 'mergeRules must be an object keyed by field name', path, definitionId,
    });
    return rules;
  }
  for (const field of Object.keys(raw).sort(compareCodePoints)) {
    const entry = raw[field];
    const entryPath = joinJsonPointer(path, field);
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      report({
        code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'composition',
        message: `Merge rule for ${field} must be an object declaring a strategy`,
        path: entryPath, definitionId,
        suggestion: '合并规则必须写明采用哪一方的值：使用 {"strategy":"prefer","source":"来源编号"}，'
          + '或对列表使用 {"strategy":"concat","order":["来源编号1","来源编号2"]}。',
      });
      continue;
    }
    const strategy = entry['strategy'];
    if (strategy === 'prefer' && typeof entry['source'] === 'string') {
      rules.set(field, { strategy: 'prefer', source: entry['source'] });
      continue;
    }
    if (strategy === 'concat' && Array.isArray(entry['order']) &&
        entry['order'].every((item) => typeof item === 'string')) {
      rules.set(field, { strategy: 'concat', order: entry['order'] as readonly string[] });
      continue;
    }
    report({
      code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'composition',
      message: `Merge rule for ${field} declares no usable deterministic strategy`,
      path: entryPath, definitionId,
      suggestion: '合并规则必须写明采用哪一方的值：使用 {"strategy":"prefer","source":"来源编号"}，'
        + '或对列表使用 {"strategy":"concat","order":["来源编号1","来源编号2"]}。',
    });
  }
  return rules;
}

export interface ResolveInput {
  readonly working: ReadonlyMap<string, CandidateDefinition>;
  readonly schema: SchemaVersion;
  readonly cyclic: ReadonlySet<string>;
  readonly pathOf: (id: string) => string;
  readonly report: Report;
  readonly consumeWork: ConsumeWork;
  /**
   * Lineages already computed for this working set. Sharing them keeps one memo for the whole
   * compilation, so the required-field pass and resolution cannot disagree about a definition's lineage.
   */
  readonly lineages?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Resolve every definition in the working set.
 *
 * Inheritance contributes the ancestors' fields along the declared lineage, composition contributes the
 * components' configuration, and the definition's own fields win last. A field claimed by two providers
 * that are not on the same inheritance path is a genuine ambiguity: it is only accepted when the
 * definition declares an explicit deterministic rule, and the rule is checked rather than trusted.
 */
export function resolveWorkingSet(input: ResolveInput): ResolutionOutcome {
  const { working, schema, cyclic, pathOf, report, consumeWork } = input;
  const lineages = input.lineages ?? computeLineages(working, pathOf, consumeWork);
  const ancestors = computeAncestors(working, lineages);
  const resolved = new Map<string, ResolvedDefinition>();
  const failed = new Set<string>();

  for (const id of [...working.keys()].sort(compareCodePoints)) {
    if (cyclic.has(id)) {
      failed.add(id);
      continue;
    }
    const definition = working.get(id);
    if (!definition) continue;
    if (!consumeWork(pathOf(id))) {
      failed.add(id);
      continue;
    }
    const outcome = resolveOne(definition, {
      working, schema, ancestors, lineages, pathOf, report, resolvedFailed: failed,
    });
    if (outcome) resolved.set(id, outcome);
    else failed.add(id);
  }
  return { resolved, failed };
}

interface ResolveOneContext {
  readonly working: ReadonlyMap<string, CandidateDefinition>;
  readonly schema: SchemaVersion;
  readonly ancestors: ReadonlyMap<string, ReadonlySet<string>>;
  readonly lineages: ReadonlyMap<string, readonly string[]>;
  readonly pathOf: (id: string) => string;
  readonly report: Report;
  readonly resolvedFailed: Set<string>;
}

function ownSemanticFields(definition: CandidateDefinition): readonly string[] {
  return Object.keys(definition.value)
    .filter((key) => !STRUCTURAL_DEFINITION_FIELDS.has(key))
    .sort(compareCodePoints);
}

function resolveOne(definition: CandidateDefinition, context: ResolveOneContext): ResolvedDefinition | null {
  const { working, schema, ancestors, pathOf, report } = context;
  const path = pathOf(definition.id);
  const mergeRules = readMergeRules(definition.value['mergeRules'], `${path}/mergeRules`, definition.id, report);
  const usedRules = new Set<string>();
  let ok = true;

  const lineage = context.lineages.get(definition.id) ?? [definition.id];
  const inheritedProviders = new Map<string, FieldProvider>();
  const inheritedConflicts = new Map<string, FieldProvider[]>();

  for (const memberId of lineage) {
    if (memberId === definition.id) continue;
    const member = working.get(memberId);
    if (!member) continue;
    for (const field of ownSemanticFields(member)) {
      const value = member.value[field] as JsonValue;
      const previous = inheritedProviders.get(field);
      if (!previous) {
        inheritedProviders.set(field, { providerId: memberId, value });
        continue;
      }
      // Two branches that agree are not an ambiguity, so identical values need no resolution rule.
      if (canonicalStringify(previous.value) === canonicalStringify(value)) continue;
      // A descendant refining an ancestor's field is contract specialisation, not a conflict.
      if (ancestors.get(memberId)?.has(previous.providerId)) {
        if (!checkTypeCompatibility(previous, { providerId: memberId, value }, field, path, definition, report)) {
          ok = false;
        }
        inheritedProviders.set(field, { providerId: memberId, value });
        continue;
      }
      const bucket = inheritedConflicts.get(field) ?? [previous];
      bucket.push({ providerId: memberId, value });
      inheritedConflicts.set(field, bucket);
    }
  }

  const fields = new Map<string, JsonValue>();
  for (const [field, provider] of [...inheritedProviders.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
    if (inheritedConflicts.has(field)) continue;
    fields.set(field, provider.value);
  }
  for (const [field, providers] of [...inheritedConflicts.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
    const merged = applyMergeRule({
      conflict: { field, providers }, rule: mergeRules.get(field), definition, path,
      relation: 'inheritance', report,
    });
    if (merged === null) ok = false;
    else fields.set(field, merged);
    if (mergeRules.has(field)) usedRules.add(field);
  }

  const components: CandidateDefinition[] = [];
  const componentProviders = new Map<string, FieldProvider>();
  const componentConflicts = new Map<string, FieldProvider[]>();
  for (const componentId of definition.components) {
    const component = working.get(componentId);
    if (!component) {
      // The missing-reference diagnostic is raised by the reference pass; resolution simply cannot finish.
      ok = false;
      continue;
    }
    components.push(component);
    for (const field of ownSemanticFields(component)) {
      const value = component.value[field] as JsonValue;
      const previous = componentProviders.get(field);
      if (!previous) {
        componentProviders.set(field, { providerId: componentId, value });
        continue;
      }
      if (canonicalStringify(previous.value) === canonicalStringify(value)) continue;
      const bucket = componentConflicts.get(field) ?? [previous];
      bucket.push({ providerId: componentId, value });
      componentConflicts.set(field, bucket);
    }
  }

  for (const [field, provider] of [...componentProviders.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
    if (componentConflicts.has(field)) continue;
    fields.set(field, provider.value);
  }
  for (const [field, providers] of [...componentConflicts.entries()].sort(([a], [b]) => compareCodePoints(a, b))) {
    const merged = applyMergeRule({
      conflict: { field, providers }, rule: mergeRules.get(field), definition, path,
      relation: 'composition', report,
    });
    if (merged === null) ok = false;
    else fields.set(field, merged);
    if (mergeRules.has(field)) usedRules.add(field);
  }

  // The definition's own declarations win last: they are the most specific statement about this type.
  for (const field of ownSemanticFields(definition)) {
    fields.set(field, definition.value[field] as JsonValue);
  }

  for (const field of [...mergeRules.keys()].sort(compareCodePoints)) {
    if (usedRules.has(field)) continue;
    report({
      code: 'E_LOAD_LINT', stage: 'composition', warning: true,
      message: `Merge rule for ${field} resolves no conflict`,
      path: `${path}/mergeRules`, definitionId: definition.id,
      suggestion: '这条合并规则没有对应的冲突，可以删掉，避免以后误以为某个字段已经有明确取舍。',
    });
  }
  if (!ok) return null;
  void schema;
  return buildResolved(definition, lineage, components, fields);
}

function buildResolved(
  definition: CandidateDefinition,
  lineage: readonly string[],
  components: readonly CandidateDefinition[],
  fields: ReadonlyMap<string, JsonValue>,
): ResolvedDefinition {
  const ordered: Record<string, JsonValue> = {};
  for (const field of [...fields.keys()].sort(compareCodePoints)) {
    ordered[field] = fields.get(field) as JsonValue;
  }
  return Object.freeze({
    id: definition.id,
    kind: definition.kind,
    abstract: definition.abstract,
    semanticFamily: definition.semanticFamily,
    lineage: Object.freeze([...lineage]),
    typeIdentity: composedTypeIdentity(definition.typeIdentity, components),
    components: Object.freeze([...definition.components]),
    fields: Object.freeze(ordered),
  });
}

function checkTypeCompatibility(
  previous: FieldProvider,
  next: FieldProvider,
  field: string,
  path: string,
  definition: CandidateDefinition,
  report: Report,
): boolean {
  const previousType = jsonTypeOf(previous.value);
  const nextType = jsonTypeOf(next.value);
  if (previousType === nextType) return true;
  report({
    code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'composition',
    message: `Field ${field} is ${previousType} in ${previous.providerId} but ${nextType} in ${next.providerId}`,
    path: `${path}/extends`, definitionId: definition.id,
    suggestion: '同一项在继承链上必须保持同一种写法。请让父子两处使用一致的类型，或改用组合表达差异。',
  });
  return false;
}

interface MergeInput {
  readonly conflict: FieldConflict;
  readonly rule: MergeRule | undefined;
  readonly definition: CandidateDefinition;
  readonly path: string;
  readonly relation: 'inheritance' | 'composition';
  readonly report: Report;
}

/**
 * Apply an explicit rule to a real conflict, or refuse.
 *
 * Declaring a rule is not enough: it has to name providers that actually conflict and it has to be
 * applicable to the values involved. Without that check a rule would merely silence the conflict while
 * leaving the resolved value undecided, which is the failure mode this function exists to prevent.
 */
function applyMergeRule(input: MergeInput): JsonValue | null {
  const { conflict, rule, definition, path, relation, report } = input;
  const providerIds = conflict.providers.map((provider) => provider.providerId);
  if (!rule) {
    report({
      code: relation === 'inheritance' ? 'E_LOAD_ORDER_UNDECLARED' : 'E_LOAD_COMPOSITION_CONFLICT',
      stage: 'composition',
      message: `${providerIds.join(' and ')} both provide ${conflict.field} with different values`,
      path: relation === 'inheritance' ? `${path}/extends` : `${path}/components`,
      definitionId: definition.id,
      relatedSources: [],
      suggestion: `请在 mergeRules 里写明 ${conflict.field} 采用哪一方的值，或去掉其中一个来源。`,
    });
    return null;
  }
  if (rule.strategy === 'prefer') {
    const chosen = conflict.providers.find((provider) => provider.providerId === rule.source);
    if (!chosen) {
      report({
        code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'composition',
        message: `Merge rule for ${conflict.field} names ${rule.source}, which provides no value`,
        path: `${path}/mergeRules`, definitionId: definition.id,
        suggestion: `请把采用来源改成实际提供该项的来源之一：${providerIds.join('、')}。`,
      });
      return null;
    }
    return chosen.value;
  }
  return applyConcat(input, providerIds);
}

function applyConcat(input: MergeInput, providerIds: readonly string[]): JsonValue | null {
  const { conflict, rule, definition, path, report } = input;
  if (!rule || rule.strategy !== 'concat') return null;
  const declared = [...rule.order].sort(compareCodePoints);
  const actual = [...providerIds].sort(compareCodePoints);
  if (declared.length !== actual.length || declared.some((id, index) => id !== actual[index])) {
    report({
      code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'composition',
      message: `Concat order for ${conflict.field} must list exactly ${providerIds.join(', ')}`,
      path: `${path}/mergeRules`, definitionId: definition.id,
      suggestion: `请把顺序列表写成正好包含这些来源：${providerIds.join('、')}。`,
    });
    return null;
  }
  const byProvider = new Map(conflict.providers.map((provider) => [provider.providerId, provider.value]));
  const combined: JsonValue[] = [];
  for (const providerId of rule.order) {
    const value = byProvider.get(providerId);
    if (!Array.isArray(value)) {
      report({
        code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'composition',
        message: `Concat requires every provider of ${conflict.field} to supply a list`,
        path: `${path}/mergeRules`, definitionId: definition.id,
        suggestion: '拼接只能用于列表。请改用采用某一方的写法，或把两边都改成列表。',
      });
      return null;
    }
    combined.push(...value);
  }
  return combined;
}
