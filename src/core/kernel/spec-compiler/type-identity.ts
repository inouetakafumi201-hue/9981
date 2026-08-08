import { canonicalStringify, compareCodePoints, joinJsonPointer } from './json-codec.js';
import { EMPTY_TYPE_IDENTITY } from './types.js';
import type {
  CandidateDefinition,
  DefinitionSchema,
  JsonValue,
  Report,
  TypeIdentity,
} from './types.js';

const IDENTITY_DIMENSIONS = ['requiredCapabilities', 'legalRelations', 'invariants', 'substitutes'] as const;

type IdentityDimension = (typeof IDENTITY_DIMENSIONS)[number];

/**
 * Read a declared Type_Identity.
 *
 * Type identity is the only thing inheritance is allowed to express, so its shape is checked strictly:
 * four optional string collections and nothing else. Unknown members are refused rather than ignored,
 * because a misspelled dimension would silently produce an identity that looks different but is not.
 */
export function readTypeIdentity(
  raw: JsonValue | undefined,
  path: string,
  definitionId: string,
  report: Report,
): TypeIdentity {
  if (raw === undefined) return EMPTY_TYPE_IDENTITY;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    report({
      code: 'E_LOAD_FIELD_TYPE', stage: 'schema',
      message: 'typeIdentity must be an object', path, definitionId,
    });
    return EMPTY_TYPE_IDENTITY;
  }
  const known = new Set<string>(IDENTITY_DIMENSIONS);
  for (const key of Object.keys(raw)) {
    if (known.has(key)) continue;
    report({
      code: 'E_LOAD_UNKNOWN_FIELD', stage: 'schema',
      message: `Unknown type identity dimension ${key}`,
      path: joinJsonPointer(path, key), definitionId,
    });
  }
  const dimensions = {} as Record<IdentityDimension, readonly string[]>;
  for (const dimension of IDENTITY_DIMENSIONS) {
    dimensions[dimension] = readIdentityList(raw[dimension], joinJsonPointer(path, dimension), definitionId, report);
  }
  return Object.freeze({ ...dimensions });
}

function readIdentityList(
  raw: JsonValue | undefined,
  path: string,
  definitionId: string,
  report: Report,
): readonly string[] {
  if (raw === undefined) return Object.freeze([]);
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    report({
      code: 'E_LOAD_FIELD_TYPE', stage: 'schema',
      message: 'Type identity dimension must be an array of names',
      path, definitionId,
    });
    return Object.freeze([]);
  }
  // Sorted and de-duplicated: identity is a set, so two declaration orders must compare equal.
  return Object.freeze([...new Set(raw as readonly string[])].sort(compareCodePoints));
}

/** Canonical comparison key. Two identities are the same identity when their keys match. */
export function typeIdentityKey(identity: TypeIdentity): string {
  return canonicalStringify({
    requiredCapabilities: [...identity.requiredCapabilities],
    legalRelations: [...identity.legalRelations],
    invariants: [...identity.invariants],
    substitutes: [...identity.substitutes],
  });
}

export function isEmptyTypeIdentity(identity: TypeIdentity): boolean {
  return IDENTITY_DIMENSIONS.every((dimension) => identity[dimension].length === 0);
}

/** Union of two identities, used when a type-defining component contributes to its host. */
export function unionTypeIdentity(left: TypeIdentity, right: TypeIdentity): TypeIdentity {
  const dimensions = {} as Record<IdentityDimension, readonly string[]>;
  for (const dimension of IDENTITY_DIMENSIONS) {
    dimensions[dimension] = Object.freeze(
      [...new Set([...left[dimension], ...right[dimension]])].sort(compareCodePoints));
  }
  return Object.freeze({ ...dimensions });
}

/**
 * Host identity after composition.
 *
 * Only a component declared as type defining may change the host's Type_Identity. That is what makes
 * removing an ordinary optional capability safe: the host keeps the same identity, so every existing
 * reference and substitution stays valid.
 */
export function composedTypeIdentity(
  declared: TypeIdentity,
  components: readonly CandidateDefinition[],
): TypeIdentity {
  let identity = declared;
  for (const component of components) {
    if (component.typeDefining) identity = unionTypeIdentity(identity, component.typeIdentity);
  }
  return identity;
}

export interface InheritanceIdentityInput {
  readonly child: CandidateDefinition;
  readonly parents: readonly CandidateDefinition[];
  readonly schema: DefinitionSchema | undefined;
  readonly path: string;
  readonly report: Report;
}

/**
 * Enforce that inheritance carries a real type difference.
 *
 * A child that declares no identity, or declares exactly its parent's identity, is not a new type: it is
 * the same type with different configuration, which composition already expresses. When the only thing
 * that actually differs is a gameplay value, the rejection says so explicitly, because that is the
 * mistake this rule exists to catch.
 */
export function validateInheritanceIdentity(input: InheritanceIdentityInput): void {
  const { child, parents, path, report } = input;
  if (parents.length === 0) return;
  const identityPath = joinJsonPointer(path, 'typeIdentity');

  if (isEmptyTypeIdentity(child.typeIdentity)) {
    report({
      code: 'E_LOAD_IDENTITY_CONFLICT', stage: 'semantic',
      message: `Derived definition ${child.id} declares no type identity difference`,
      path: identityPath, definitionId: child.id,
      relatedSources: parents.map((parent) => parent.source),
      suggestion: '继承必须表达本质类型差异。请声明所需能力、合法关系、不变量或替换兼容性中至少一项差异，'
        + '若只是配置不同，请改用组合。',
    });
    return;
  }

  const childKey = typeIdentityKey(child.typeIdentity);
  for (const parent of parents) {
    if (typeIdentityKey(parent.typeIdentity) !== childKey) continue;
    const differing = differingFieldNames(child, parent);
    const gameplayOnly = differing.length > 0 &&
      differing.every((field) => input.schema?.fields[field]?.numericOwnership === 'gameplay-value');
    report({
      code: 'E_LOAD_IDENTITY_CONFLICT', stage: 'semantic',
      message: gameplayOnly
        ? `Definition ${child.id} differs from ${parent.id} only by gameplay values`
        : `Definition ${child.id} repeats the type identity of ${parent.id}`,
      path: identityPath, definitionId: child.id,
      relatedSources: [parent.source],
      suggestion: gameplayOnly
        ? '这两者只有具体数值不同，不构成新类型。请保留同一个类型，把数值差异交给组合与玩法层参数。'
        : '子类型与父类型的本质语义完全相同。请写出真正的类型差异，或改用组合表达这项差异。',
    });
  }
}

const STRUCTURAL_FIELDS: ReadonlySet<string> = new Set([
  'id', 'kind', 'abstract', 'semanticFamily', 'extends', 'components',
  'mergeRules', 'override', 'typeIdentity', 'typeDefining',
]);

/** Semantic field names whose values differ between a child and one of its parents. */
export function differingFieldNames(
  child: CandidateDefinition,
  parent: CandidateDefinition,
): readonly string[] {
  const names = new Set<string>();
  for (const key of [...Object.keys(child.value), ...Object.keys(parent.value)]) {
    if (STRUCTURAL_FIELDS.has(key)) continue;
    names.add(key);
  }
  const differing: string[] = [];
  for (const name of [...names].sort(compareCodePoints)) {
    const left = child.value[name];
    const right = parent.value[name];
    if (left === undefined && right === undefined) continue;
    if (left === undefined || right === undefined) {
      differing.push(name);
      continue;
    }
    if (canonicalStringify(left) !== canonicalStringify(right)) differing.push(name);
  }
  return differing;
}
