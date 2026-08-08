import { compareCodePoints } from './json-codec.js';
import { inboundFrom } from './resolver.js';
import type { ReferenceGraph } from './resolver.js';
import type {
  CandidateDefinition,
  JsonValue,
  PackageRecord,
  Report,
  TechnicalQuotas,
} from './types.js';

/**
 * Package-level intent declared by one candidate document.
 *
 * A compilation is a change set, not a snapshot upload: it may add definitions, override active ones and
 * remove active ones. Modelling the intent explicitly is what allows the registry to apply all three as a
 * single atomic change and to refuse a change that would leave a dangling reference behind.
 */
export interface PackageDeclaration {
  readonly packageId: string;
  readonly dependencies: readonly string[];
  readonly removals: readonly string[];
}

export function readPackageDeclaration(
  root: Readonly<Record<string, JsonValue>>,
  fallbackPackageId: string,
  quotas: TechnicalQuotas,
  report: Report,
): PackageDeclaration {
  const declaredId = root['packageId'];
  let packageId = fallbackPackageId;
  if (declaredId !== undefined) {
    if (typeof declaredId !== 'string' || declaredId.length === 0 ||
        declaredId.length > quotas.identifierLength) {
      report({
        code: 'E_LOAD_IDENTIFIER_INVALID', stage: 'schema',
        message: 'packageId must be a non-empty identifier within the configured length',
        path: '/packageId',
      });
    } else {
      packageId = declaredId;
    }
  }
  return {
    packageId,
    dependencies: readIdList(root['dependencies'], '/dependencies', quotas, report),
    removals: readIdList(root['removals'], '/removals', quotas, report),
  };
}

function readIdList(
  raw: JsonValue | undefined,
  path: string,
  quotas: TechnicalQuotas,
  report: Report,
): readonly string[] {
  if (raw === undefined) return Object.freeze([]);
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    report({
      code: 'E_LOAD_FIELD_TYPE', stage: 'schema',
      message: 'Expected an array of identifiers', path,
    });
    return Object.freeze([]);
  }
  const values = raw as readonly string[];
  const seen = new Set<string>();
  const accepted: string[] = [];
  values.forEach((value, index) => {
    if (value.length === 0 || value.length > quotas.identifierLength) {
      report({
        code: 'E_LOAD_IDENTIFIER_INVALID', stage: 'schema',
        message: `Identifier ${value || '<empty>'} is invalid`, path: `${path}/${index}`,
      });
      return;
    }
    if (seen.has(value)) {
      report({
        code: 'E_LOAD_DUPLICATE_ID', stage: 'schema',
        message: `Identifier ${value} is listed twice`, path: `${path}/${index}`,
      });
      return;
    }
    seen.add(value);
    accepted.push(value);
  });
  return Object.freeze(accepted);
}

/**
 * Check the package dependency graph.
 *
 * A dependency that names no activated package cannot be honoured, and a cycle has no supported
 * activation order, so both are refused before any working set is built.
 */
export function validatePackageDependencies(
  declaration: PackageDeclaration,
  activePackages: Readonly<Record<string, PackageRecord>>,
  quotas: TechnicalQuotas,
  report: Report,
): void {
  declaration.dependencies.forEach((dependency, index) => {
    if (dependency === declaration.packageId || activePackages[dependency]) return;
    report({
      code: 'E_REF_MISSING', stage: 'reference',
      message: `Package dependency ${dependency} is not activated`,
      path: `/dependencies/${index}`,
      suggestion: '请先装载被依赖的内容包，或去掉这条依赖声明。',
    });
  });
  reportPackageCycle(declaration, activePackages, quotas, report);
}

function reportPackageCycle(
  declaration: PackageDeclaration,
  activePackages: Readonly<Record<string, PackageRecord>>,
  quotas: TechnicalQuotas,
  report: Report,
): void {
  const edges = new Map<string, readonly string[]>();
  for (const [id, record] of Object.entries(activePackages)) edges.set(id, record.dependencies);
  edges.set(declaration.packageId, declaration.dependencies);

  let budget = quotas.packageDependencyEdges;
  const stack: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycle: readonly string[] | null = null;
  let exhausted = false;

  const walk = (id: string): void => {
    if (cycle || exhausted) return;
    if (budget-- <= 0) {
      // Returning quietly here would mean a dependency graph too large to search is reported as
      // cycle-free, which is the one answer this function must never give by default.
      exhausted = true;
      return;
    }
    if (visiting.has(id)) {
      cycle = [...stack.slice(stack.indexOf(id)), id];
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const next of [...(edges.get(id) ?? [])].sort(compareCodePoints)) walk(next);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  walk(declaration.packageId);

  if (cycle) {
    report({
      code: 'E_LOAD_CYCLE_DEP', stage: 'reference',
      message: `Package dependency cycle ${(cycle as readonly string[]).join(' -> ')}`,
      path: '/dependencies',
      suggestion: '内容包之间的依赖绕回了自己。请去掉其中一条依赖，改由共同的基础包提供共享部分。',
    });
    return;
  }
  if (exhausted) {
    report({
      code: 'E_QUOTA_TRAVERSAL_WORK', stage: 'reference',
      message: `Package dependency search exceeded ${quotas.packageDependencyEdges} edges`,
      path: '/dependencies',
      messageArgs: { limit: quotas.packageDependencyEdges },
    });
  }
}

export interface WorkingSetInput {
  readonly active: Readonly<Record<string, CandidateDefinition>>;
  readonly candidates: ReadonlyMap<string, CandidateDefinition>;
  readonly declaration: PackageDeclaration;
  readonly pathOf: (id: string) => string;
  readonly report: Report;
}

/**
 * Merge the candidate change set onto the active set.
 *
 * The result is a working copy: nothing observable changes until the whole copy has passed validation,
 * resolution and canonicalisation. Building it explicitly is also what makes a cross-package reference
 * survive the commit, instead of resolving against a previous state that the commit then discards.
 */
export function buildWorkingSet(input: WorkingSetInput): ReadonlyMap<string, CandidateDefinition> {
  const { active, candidates, declaration, report } = input;
  const working = new Map<string, CandidateDefinition>();
  for (const id of Object.keys(active).sort(compareCodePoints)) {
    const definition = active[id];
    if (definition) working.set(id, definition);
  }
  declaration.removals.forEach((id, index) => {
    if (candidates.has(id)) {
      report({
        code: 'E_LOAD_CROSS_FIELD_CONSTRAINT', stage: 'semantic',
        message: `Definition ${id} is removed and redefined in the same change`,
        path: `/removals/${index}`, definitionId: id,
        suggestion: '同一次提交里不能既删除又重新定义同一个编号。请二选一：直接替换，或先删除后另建新编号。',
      });
      return;
    }
    if (!working.delete(id)) {
      report({
        code: 'E_REF_MISSING', stage: 'reference',
        message: `Definition ${id} is not active and cannot be removed`,
        path: `/removals/${index}`, definitionId: id,
        suggestion: '要删除的内容当前并不生效。请检查编号，或去掉这条删除声明。',
      });
    }
  });
  for (const id of [...candidates.keys()].sort(compareCodePoints)) {
    const definition = candidates.get(id);
    if (definition) working.set(id, definition);
  }
  return working;
}

export interface RemovalCheckInput {
  readonly declaration: PackageDeclaration;
  readonly graph: ReferenceGraph;
  readonly active: Readonly<Record<string, CandidateDefinition>>;
  readonly report: Report;
}

/**
 * Refuse a removal that leaves an inbound reference unresolved.
 *
 * The diagnostic is anchored at the removal the creator wrote, not at the dependent definition, because
 * the removal is the change under judgement and the dependent may live in a package this document never
 * mentions. The dependent's own location travels along as a related source.
 */
export function reportRemovalDangling(input: RemovalCheckInput): void {
  const { declaration, graph, active, report } = input;
  declaration.removals.forEach((removedId, index) => {
    for (const edge of inboundFrom(graph, removedId)) {
      const dependent = graph.definitions.get(edge.from) ?? active[edge.from];
      report({
        code: 'E_LOAD_UNDEFINED_REF', stage: 'reference',
        message: `Removing ${removedId} leaves ${edge.from} pointing at nothing (${edge.relation})`,
        path: `/removals/${index}`, definitionId: removedId,
        relatedSources: dependent ? [dependent.source] : [],
        suggestion: `请在同一次提交里一起处理仍然指向它的 ${edge.from}：删掉那处引用，或改指向别的内容。`,
      });
    }
  });
}

export interface OverrideCheckInput {
  readonly overrides: readonly { readonly id: string; readonly path: string }[];
  readonly graph: ReferenceGraph;
  readonly report: Report;
}

/**
 * Revalidate everything that points at an overridden definition.
 *
 * An override is only safe when every existing dependent still accepts the replacement. Checking the
 * dependents is what stops an override from turning an unrelated package's reference into a type error
 * that nobody notices until runtime.
 */
export function reportOverrideDependentBreakage(input: OverrideCheckInput): void {
  const { overrides, graph, report } = input;
  for (const override of overrides) {
    const replacement = graph.definitions.get(override.id);
    if (!replacement) continue;
    for (const edge of inboundFrom(graph, override.id)) {
      const dependent = graph.definitions.get(edge.from);
      if (!dependent) continue;
      const breakage = describeBreakage(edge.relation, dependent, replacement);
      if (!breakage) continue;
      report({
        code: 'E_LOAD_OVERRIDE_INVALID', stage: 'reference',
        message: `Override of ${override.id} breaks ${edge.from}: ${breakage}`,
        path: override.path, definitionId: override.id,
        relatedSources: [dependent.source],
        suggestion: `替换后 ${edge.from} 就用不了它了。请让替换保持原有类别与语义族，或在同一次提交里一并调整 ${edge.from}。`,
      });
    }
  }
}

/**
 * Breakage that is worth reporting at the override site.
 *
 * The whole working set is revalidated elsewhere, so an override that invalidates a reference is already
 * refused. What this adds is the anchor: pointing at the override the creator wrote is far more useful than
 * pointing at an inherited definition from a package they never opened. Only relations whose contract the
 * override itself can violate are listed here, to avoid inventing a rule that the general reference pass
 * does not also enforce.
 */
function describeBreakage(
  relation: 'extends' | 'component' | 'field',
  dependent: CandidateDefinition,
  replacement: CandidateDefinition,
): string | null {
  if (relation === 'extends' && replacement.kind !== dependent.kind) {
    return `parent kind became ${replacement.kind} while the child is ${dependent.kind}`;
  }
  return null;
}

/** Deterministic package record for the activated model. */
export function toPackageRecord(declaration: PackageDeclaration): PackageRecord {
  return Object.freeze({
    packageId: declaration.packageId,
    dependencies: Object.freeze([...declaration.dependencies].sort(compareCodePoints)),
  });
}
