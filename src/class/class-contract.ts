/**
 * 基类层语义契约校验器。
 *
 * 这里实现的是"契约本身"，不是测试脚手架：每个导出函数都是纯函数，
 * 输入已解析的目录数据，输出确定性排序的违规清单。测试既在真实目录上运行它们
 * （正例），也在人造违规对象上运行它们（反例），因此每条契约都是可证伪的。
 *
 * 覆盖的规范点：
 * - 数值归属：基类层唯一允许出现数字的位置是带权威来源与结构理由的结构边界。
 * - 层级归属：基类层不得声明引擎层机制，也不得把引擎层运行时簿记伪装成语义状态。
 * - 类型身份：不得出现只靠改名或玩法取值差异产生的伪子类型。
 * - 引用完整性：组合引用（能力、槽位、容器、弹药、配件、结构边界）不得悬空。
 */

import type { JsonValue } from '../core/kernel/spec-compiler/types.js';
import {
  ClassCatalogContractError,
  assertAllowedKeys,
  assertRequiredKeys,
  assertUniqueIds,
  deepFreeze,
  expectArray,
  expectBoolean,
  expectEnum,
  expectNonEmptyArray,
  expectNumber,
  expectObject,
  expectString,
  expectUniqueStringArray,
  type JsonObject,
  visitJson,
} from './json-contract.js';

/** 违规项：稳定代码、定位、原因与修正建议。 */
export interface ContractViolation {
  readonly code: string;
  readonly path: string;
  readonly reason: string;
  readonly correction: string;
}

/** 确定性排序：先定位、再代码。排序是可观察输出的一部分。 */
export function sortViolations(violations: readonly ContractViolation[]): readonly ContractViolation[] {
  return Object.freeze(
    [...violations].sort((left, right) =>
      left.path === right.path
        ? left.code.localeCompare(right.code, 'en')
        : left.path.localeCompare(right.path, 'en')),
  );
}

export function formatViolations(violations: readonly ContractViolation[]): readonly string[] {
  return sortViolations(violations).map((violation) => `${violation.code} @ ${violation.path}: ${violation.reason}`);
}

// ───────────────────────────────────────────────────────────────────────────
// 1. 数值归属：基类层的数字只允许出现在已分类的结构边界里
// ───────────────────────────────────────────────────────────────────────────

/**
 * 允许出现数字的 JSON 定位后缀。
 *
 * - `/structuralBounds/<i>/value`：结构边界取值，必须同时带分类、权威来源与结构理由。
 * - `.../sourceLocation/line`、`.../sourceLocation/column`：来源定位，是内部度量而不是玩法参数。
 */
const NUMERIC_POINTER_PATTERNS: readonly RegExp[] = Object.freeze([
  /^\/structuralBounds\/\d+\/value$/,
  /\/sourceLocation\/line$/,
  /\/sourceLocation\/column$/,
]);

/**
 * 玩法数值字段名：这些字段名一旦作为基类层 JSON 的键出现，即表示玩法赋值回流。
 *
 * 它们出现在字符串值里是合法的——基类层需要能声明"哪个玩法层字段名承载该取值"，
 * 因此本护栏只检查键名。
 */
export const GAMEPLAY_VALUE_FIELD_NAMES: readonly string[] = Object.freeze([
  'accessibleApCost',
  'alertThreshold',
  'ammoCost',
  'apCost',
  'armorRating',
  'blockPower',
  'capacity',
  'cooldownTurns',
  'damage',
  'damageOnCollision',
  'duration',
  'healRate',
  'hitPoints',
  'hp',
  'matrix',
  'maxHp',
  'multiplier',
  'priority',
  'probability',
  'range',
  'shieldHp',
  'speed',
  'threshold',
  'turns',
]);

/** 基类层不得声明的引擎层机制键。 */
export const L1_MECHANISM_DECLARATION_KEYS: readonly string[] = Object.freeze([
  'exprEvaluator',
  'hookDispatcher',
  'hookScheduler',
  'journal',
  'journalCursor',
  'opDispatch',
  'opDispatcher',
  'persistence',
  'randomStream',
  'refPrefix',
  'replayCursor',
  'rewindCursor',
  'shadowStream',
  'snapshotStore',
  'transaction',
  'transactionModel',
]);

function isAllowedNumericPointer(pointer: string): boolean {
  return NUMERIC_POINTER_PATTERNS.some((pattern) => pattern.test(pointer));
}

/**
 * 找出所有未分类的数字叶值。
 *
 * 这条护栏比"基类层不许出现数字"更精确：数字本身不是问题，
 * 没有分类、没有权威来源、没有结构理由的数字才是问题（规范要求每个数值字段
 * 必须具备玩法数值、结构边界、宪法常量或内部度量之一的有效分类）。
 */
export function findUnclassifiedNumericLeaves(document: JsonValue, sourceId: string): readonly ContractViolation[] {
  const violations: ContractViolation[] = [];
  visitJson(document, (visit) => {
    if (typeof visit.value !== 'number') return;
    if (isAllowedNumericPointer(visit.pointer)) return;
    violations.push({
      code: 'SCHEMA_FIELD_MISSING_CLASSIFICATION',
      path: `${sourceId}${visit.pointer}`,
      reason: `数值 ${visit.value} 没有归属分类：基类层的数字只能出现在带分类、权威来源与结构理由的 structuralBounds 条目中。`,
      correction: '把该取值下沉到玩法层 profile，或改写为带 classification、authoritativeSource 与 structuralRationale 的结构边界。',
    });
  });
  return sortViolations(violations);
}

/** 找出以玩法数值字段名作为键的位置。 */
export function findGameplayValueKeys(document: JsonValue, sourceId: string): readonly ContractViolation[] {
  const forbidden = new Set(GAMEPLAY_VALUE_FIELD_NAMES);
  const violations: ContractViolation[] = [];
  visitJson(document, (visit) => {
    if (visit.parent === undefined) return;
    if (!forbidden.has(visit.key)) return;
    if (!visit.pointer.endsWith(`/${visit.key}`)) return;
    violations.push({
      code: 'SCHEMA_GAMEPLAY_TABLE_IN_L2',
      path: `${sourceId}${visit.pointer}`,
      reason: `键名 ${visit.key} 是玩法赋值字段，不得出现在基类层目录中。`,
      correction: '只声明该字段名（作为字符串值），把取值交给玩法层 profile。',
    });
  });
  return sortViolations(violations);
}

/** 找出基类层对引擎层机制的重定义声明。 */
export function findL1MechanismDeclarations(document: JsonValue, sourceId: string): readonly ContractViolation[] {
  const forbidden = new Set(L1_MECHANISM_DECLARATION_KEYS);
  const violations: ContractViolation[] = [];
  visitJson(document, (visit) => {
    if (visit.parent === undefined) return;
    if (!forbidden.has(visit.key)) return;
    if (!visit.pointer.endsWith(`/${visit.key}`)) return;
    violations.push({
      code: 'LAYER_L1_OWNERSHIP',
      path: `${sourceId}${visit.pointer}`,
      reason: `键名 ${visit.key} 声明的是引擎层机制，基类层不得重定义它。`,
      correction: '改为引用引擎层已有接口；写入只经唯一写入通道执行。',
    });
  });
  return sortViolations(violations);
}

// ───────────────────────────────────────────────────────────────────────────
// 2. 结构边界完备性
// ───────────────────────────────────────────────────────────────────────────

export interface StructuralBoundRecord {
  readonly id: string;
  readonly classification: 'Structural_Bound' | 'Constitutional_Constant';
  readonly unit: string;
  readonly value: number;
  readonly appliesToFields: readonly string[];
  readonly structuralRationale: string;
  readonly authoritativeSourceFile: string;
  readonly authoritativeSourceSection: string;
  readonly precedence: string;
  readonly owningLayer: string;
}

const SOURCE_PRECEDENCES = [
  'l0-constitution',
  'confirmed-interview-decision',
  'l1-boundary-invariant',
  'finalized-l2-contract',
  'unresolved-l2-content',
  'historical-example',
] as const;

const OWNING_LAYERS = ['引擎层', '基类层', '玩法层'] as const;

const SOURCE_CLASSIFICATIONS = [
  'Normative_Contract',
  'L3_Profile',
  'Historical_Example',
  'Unresolved_Item',
] as const;

/** 解析并校验一条来源记录；缺任何一项追踪元数据都直接拒绝。 */
export function parseSourceRecord(value: JsonValue | undefined, path: string): {
  readonly sourceFile: string;
  readonly section: string;
  readonly precedence: string;
  readonly classification: string;
  readonly owningLayer: string;
  readonly statementFingerprint: string;
  readonly decisionId?: string;
} {
  const object = expectObject(value, path);
  assertAllowedKeys(object, path, [
    'sourceFile',
    'sourceLocation',
    'precedence',
    'decisionId',
    'classification',
    'owningLayer',
    'statementFingerprint',
  ]);
  assertRequiredKeys(object, path, [
    'sourceFile',
    'sourceLocation',
    'precedence',
    'classification',
    'owningLayer',
    'statementFingerprint',
  ]);
  const location = expectObject(object['sourceLocation'], `${path}/sourceLocation`);
  assertAllowedKeys(location, `${path}/sourceLocation`, ['sourceFile', 'section', 'line', 'column']);
  const decisionId = object['decisionId'];
  return {
    sourceFile: expectString(object['sourceFile'], `${path}/sourceFile`),
    section: expectString(location['section'], `${path}/sourceLocation/section`),
    precedence: expectEnum(object['precedence'], `${path}/precedence`, SOURCE_PRECEDENCES),
    classification: expectEnum(object['classification'], `${path}/classification`, SOURCE_CLASSIFICATIONS),
    owningLayer: expectEnum(object['owningLayer'], `${path}/owningLayer`, OWNING_LAYERS),
    statementFingerprint: expectString(object['statementFingerprint'], `${path}/statementFingerprint`),
    ...(decisionId === undefined ? {} : { decisionId: expectString(decisionId, `${path}/decisionId`) }),
  };
}

/** 解析并校验结构边界；权威来源与结构理由缺一不可。 */
export function parseStructuralBound(value: JsonValue, path: string): StructuralBoundRecord {
  const object = expectObject(value, path);
  assertAllowedKeys(object, path, [
    'id',
    'name',
    'classification',
    'unit',
    'value',
    'appliesToFields',
    'structuralRationale',
    'authoritativeSource',
  ]);
  assertRequiredKeys(object, path, [
    'id',
    'name',
    'classification',
    'unit',
    'value',
    'appliesToFields',
    'structuralRationale',
    'authoritativeSource',
  ]);
  const source = parseSourceRecord(object['authoritativeSource'], `${path}/authoritativeSource`);
  return Object.freeze({
    id: expectString(object['id'], `${path}/id`),
    classification: expectEnum(object['classification'], `${path}/classification`, [
      'Structural_Bound',
      'Constitutional_Constant',
    ] as const),
    unit: expectString(object['unit'], `${path}/unit`),
    value: expectNumber(object['value'], `${path}/value`),
    appliesToFields: expectUniqueStringArray(object['appliesToFields'], `${path}/appliesToFields`),
    structuralRationale: expectString(object['structuralRationale'], `${path}/structuralRationale`),
    authoritativeSourceFile: source.sourceFile,
    authoritativeSourceSection: source.section,
    precedence: source.precedence,
    owningLayer: source.owningLayer,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 3. 引擎层运行时状态伪装
// ───────────────────────────────────────────────────────────────────────────

export interface NamedEntry {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

/**
 * 找出把引擎层运行时迁移与簿记伪装成基类层语义的条目。
 *
 * 只检查标识与名称，不检查说明：说明里出现"引擎层 Op"这类字样是合法的
 * ——基类层需要能说明自己消费了哪个引擎层接口。
 */
export function findRuntimeStateDisguises(
  entries: readonly NamedEntry[],
  forbiddenTokens: readonly string[],
): readonly ContractViolation[] {
  const violations: ContractViolation[] = [];
  for (const entry of entries) {
    const haystack = `${entry.id} ${entry.name}`.toLowerCase();
    // 一个条目是否为运行时状态伪装是"一次判定"，不是"每个命中词一次"：
    // 命中首个禁用词即成立，记一条违规并停止扫描该条目，避免同一 (code,path) 上的重复噪声。
    const matched = forbiddenTokens.find((token) => haystack.includes(token.toLowerCase()));
    if (matched === undefined) continue;
    violations.push({
      code: 'LAYER_L1_RUNTIME_STATE',
      path: entry.path,
      reason: `${entry.id} 的标识或名称含引擎层运行时簿记概念「${matched}」，它没有可复用的玩法语义。`,
      correction: '把该概念留在引擎层；基类层只登记可复用的玩法语义。',
    });
  }
  return sortViolations(violations);
}

// ───────────────────────────────────────────────────────────────────────────
// 4. 伪子类型
// ───────────────────────────────────────────────────────────────────────────

export interface DistinguishableEntry {
  readonly id: string;
  readonly path: string;
  /** 用于区分类型身份的字段值；顺序无关的集合请先排序后传入。 */
  readonly distinguishingKey: readonly string[];
}

/**
 * 找出只靠改名或玩法取值差异产生的伪子类型。
 *
 * 判据：两个条目在全部"区分字段"上完全一致，则它们之间没有类型身份差异，
 * 差异只剩名称，应改为组合而不是新登记一个类。
 */
export function findPseudoSubtypes(
  entries: readonly DistinguishableEntry[],
  code = 'INHERIT_GAMEPLAY_VALUE_ONLY_DIFFERENCE',
): readonly ContractViolation[] {
  const byKey = new Map<string, DistinguishableEntry>();
  const violations: ContractViolation[] = [];
  for (const entry of entries) {
    const key = entry.distinguishingKey.join('\u241F');
    const previous = byKey.get(key);
    if (previous === undefined) {
      byKey.set(key, entry);
      continue;
    }
    violations.push({
      code,
      path: entry.path,
      reason: `${entry.id} 与 ${previous.id} 在全部区分字段上一致，二者只有名称差异。`,
      correction: '改为同一个类加不同参数取值，取值由玩法层提供。',
    });
  }
  return sortViolations(violations);
}

// ───────────────────────────────────────────────────────────────────────────
// 5. 引用完整性
// ───────────────────────────────────────────────────────────────────────────

export interface TypedReferenceUse {
  readonly path: string;
  readonly id: string;
  /** 期望目标所属的引用空间名称，仅用于诊断可读性。 */
  readonly expected: string;
}

/** 找出悬空引用：目标标识不在已知集合中。 */
export function findDanglingReferences(
  uses: readonly TypedReferenceUse[],
  known: ReadonlySet<string>,
  code = 'REF_MISSING_TARGET',
): readonly ContractViolation[] {
  const violations: ContractViolation[] = [];
  for (const use of uses) {
    if (known.has(use.id)) continue;
    violations.push({
      code,
      path: use.path,
      reason: `引用 ${use.id} 无法在${use.expected}中解析。`,
      correction: '在同一候选变更中补齐被引用的定义，或移除该引用。',
    });
  }
  return sortViolations(violations);
}

// ───────────────────────────────────────────────────────────────────────────
// 6. 统一形状目录的解析与语义校验
// ───────────────────────────────────────────────────────────────────────────

export const CLASS_CATALOG_ROOT_KEYS: readonly string[] = Object.freeze([
  'schemaVersion',
  'version',
  'name',
  'description',
  'category',
  'semanticFamilies',
  'classificationEvidence',
  'sourceRecords',
  'classes',
  'capabilities',
  'valueSets',
  'structuralBounds',
  'prohibitions',
  'unresolvedItems',
  'compositionContract',
  'l3OwnedParameterNames',
  'l3OwnedParameterOwnership',
]);

export const CLASS_ENTRY_KEYS: readonly string[] = Object.freeze([
  'id',
  'name',
  'description',
  'defKind',
  'semanticFamily',
  'abstract',
  'typeIdentity',
  'requiredCapabilityIds',
  'optionalCapabilityIds',
  'parameters',
  'kernelOps',
  'forbiddenFieldNames',
  'costCategory',
  'apUnitBoundId',
  'gatewayKind',
  'sceneScale',
  'admittedChildSceneScales',
  'admittedParentSceneScales',
  'admittedEndpointSceneScales',
  'admitsMicroScene',
  'connectionBoundId',
  'parentCardinalityBoundId',
  'endpointCountBoundId',
  'lifecycleDeterminants',
  'excludedMicroSceneKinds',
  'activation',
  'traversal',
  'grantedContractKind',
  'contentLocality',
]);

const CAPABILITY_ENTRY_KEYS: readonly string[] = Object.freeze([
  'id',
  'name',
  'description',
  'parameters',
  'kernelOps',
  'mutuallyExclusiveWith',
  'writeChannelContract',
]);

/** 类条目上引用结构边界的字段名。 */
const STRUCTURAL_BOUND_REFERENCE_KEYS: readonly string[] = Object.freeze([
  'apUnitBoundId',
  'connectionBoundId',
  'parentCardinalityBoundId',
  'endpointCountBoundId',
]);

export const DEF_KINDS = [
  'entity',
  'item',
  'node',
  'link',
  'attachment',
  'action',
  'rule',
  'playpack',
  'decision',
  'prefab',
  'expr',
  'schedule',
  'policy',
] as const;

export const TYPE_IDENTITY_BASES = [
  'required-capability',
  'legal-relationship',
  'invariant',
  'substitution-compatibility',
] as const;

export interface ClassCatalogParameter {
  readonly key: string;
  readonly description: string;
  readonly required: boolean;
  readonly valueShape?: string;
}

export interface ClassCatalogCapability {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly ClassCatalogParameter[];
  readonly kernelOps: readonly string[];
  readonly mutuallyExclusiveWith: readonly string[];
}

export interface ClassCatalogClassEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defKind: (typeof DEF_KINDS)[number];
  readonly semanticFamily: string;
  readonly typeIdentityBasis: (typeof TYPE_IDENTITY_BASES)[number];
  readonly typeIdentityStatement: string;
  readonly requiredCapabilityIds: readonly string[];
  readonly optionalCapabilityIds: readonly string[];
  readonly parameterKeys: readonly string[];
  readonly kernelOps: readonly string[];
  readonly forbiddenFieldNames: readonly string[];
  readonly structuralBoundRefs: readonly string[];
}

export interface ClassCatalogValueSet {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tokenIds: readonly string[];
  readonly playLayerTokensByToken: ReadonlyMap<string, readonly string[]>;
}

export interface ClassCatalogProhibition {
  readonly id: string;
  readonly diagnosticCode: string;
  readonly statement: string;
  readonly correction: string;
}

export interface ClassCatalogUnresolvedItem {
  readonly id: string;
  readonly awaitingDecisionId: string;
  readonly statement: string;
  readonly handling: string;
}

export interface KernelOpUse {
  readonly path: string;
  readonly op: string;
}

export interface ClassCatalog {
  readonly sourceId: string;
  readonly category: string;
  readonly version: string;
  readonly semanticFamilies: readonly string[];
  readonly classes: readonly ClassCatalogClassEntry[];
  readonly capabilities: readonly ClassCatalogCapability[];
  readonly valueSets: readonly ClassCatalogValueSet[];
  readonly structuralBounds: readonly StructuralBoundRecord[];
  readonly prohibitions: readonly ClassCatalogProhibition[];
  readonly unresolvedItems: readonly ClassCatalogUnresolvedItem[];
  readonly kernelOpUses: readonly KernelOpUse[];
}

function parseParameters(value: JsonValue | undefined, path: string): readonly ClassCatalogParameter[] {
  if (value === undefined) return Object.freeze([]);
  const parameters = expectArray(value, path).map((entry, index) => {
    const entryPath = `${path}/${index}`;
    const object = expectObject(entry, entryPath);
    assertAllowedKeys(object, entryPath, ['key', 'description', 'required', 'valueShape']);
    const required = object['required'];
    const valueShape = object['valueShape'];
    return Object.freeze({
      key: expectString(object['key'], `${entryPath}/key`),
      description: expectString(object['description'], `${entryPath}/description`),
      required: required === undefined ? false : expectBoolean(required, `${entryPath}/required`),
      ...(valueShape === undefined ? {} : { valueShape: expectString(valueShape, `${entryPath}/valueShape`) }),
    });
  });
  const keys = parameters.map((parameter) => parameter.key);
  if (new Set(keys).size !== keys.length) {
    throw new ClassCatalogContractError(path, 'must not declare duplicate parameter keys');
  }
  return Object.freeze(parameters);
}

function parseCapability(value: JsonValue, path: string): ClassCatalogCapability {
  const object = expectObject(value, path);
  assertAllowedKeys(object, path, CAPABILITY_ENTRY_KEYS);
  assertRequiredKeys(object, path, ['id', 'name', 'description', 'parameters', 'kernelOps']);
  expectNonEmptyArray(object['parameters'], `${path}/parameters`);
  const writeChannel = object['writeChannelContract'];
  if (writeChannel !== undefined) {
    const contract = expectObject(writeChannel, `${path}/writeChannelContract`);
    assertAllowedKeys(contract, `${path}/writeChannelContract`, ['channel', 'alternateChannels', 'description']);
    expectEnum(contract['channel'], `${path}/writeChannelContract/channel`, ['OpRegistry.invoke'] as const);
    expectEnum(contract['alternateChannels'], `${path}/writeChannelContract/alternateChannels`, ['none'] as const);
    expectString(contract['description'], `${path}/writeChannelContract/description`);
  }
  const exclusives = object['mutuallyExclusiveWith'];
  return Object.freeze({
    id: expectString(object['id'], `${path}/id`),
    name: expectString(object['name'], `${path}/name`),
    description: expectString(object['description'], `${path}/description`),
    parameters: parseParameters(object['parameters'], `${path}/parameters`),
    kernelOps: expectUniqueStringArray(object['kernelOps'], `${path}/kernelOps`),
    mutuallyExclusiveWith: exclusives === undefined
      ? Object.freeze([])
      : expectUniqueStringArray(exclusives, `${path}/mutuallyExclusiveWith`),
  });
}

function parseClassEntry(value: JsonValue, path: string): ClassCatalogClassEntry {
  const object = expectObject(value, path);
  assertAllowedKeys(object, path, CLASS_ENTRY_KEYS);
  assertRequiredKeys(object, path, [
    'id',
    'name',
    'description',
    'defKind',
    'semanticFamily',
    'abstract',
    'typeIdentity',
    'requiredCapabilityIds',
    'optionalCapabilityIds',
  ]);
  if (expectBoolean(object['abstract'], `${path}/abstract`) !== true) {
    throw new ClassCatalogContractError(`${path}/abstract`, 'base classes must be abstract; instances belong to the play layer');
  }
  const typeIdentity = expectObject(object['typeIdentity'], `${path}/typeIdentity`);
  assertAllowedKeys(typeIdentity, `${path}/typeIdentity`, ['basis', 'statement']);
  const requiredCapabilityIds = expectUniqueStringArray(
    object['requiredCapabilityIds'],
    `${path}/requiredCapabilityIds`,
  );
  const optionalCapabilityIds = expectUniqueStringArray(
    object['optionalCapabilityIds'],
    `${path}/optionalCapabilityIds`,
  );
  const overlap = requiredCapabilityIds.filter((id) => optionalCapabilityIds.includes(id));
  if (overlap.length > 0) {
    throw new ClassCatalogContractError(
      `${path}/optionalCapabilityIds`,
      `must not repeat required capabilities: ${overlap.join(', ')}`,
    );
  }
  const structuralBoundRefs = STRUCTURAL_BOUND_REFERENCE_KEYS.flatMap((key) => {
    const reference = object[key];
    return reference === undefined ? [] : [expectString(reference, `${path}/${key}`)];
  });
  const kernelOps = object['kernelOps'];
  const forbiddenFieldNames = object['forbiddenFieldNames'];
  return Object.freeze({
    id: expectString(object['id'], `${path}/id`),
    name: expectString(object['name'], `${path}/name`),
    description: expectString(object['description'], `${path}/description`),
    defKind: expectEnum(object['defKind'], `${path}/defKind`, DEF_KINDS),
    semanticFamily: expectString(object['semanticFamily'], `${path}/semanticFamily`),
    typeIdentityBasis: expectEnum(typeIdentity['basis'], `${path}/typeIdentity/basis`, TYPE_IDENTITY_BASES),
    typeIdentityStatement: expectString(typeIdentity['statement'], `${path}/typeIdentity/statement`),
    requiredCapabilityIds,
    optionalCapabilityIds,
    parameterKeys: parseParameters(object['parameters'], `${path}/parameters`).map((parameter) => parameter.key),
    kernelOps: kernelOps === undefined ? Object.freeze([]) : expectUniqueStringArray(kernelOps, `${path}/kernelOps`),
    forbiddenFieldNames: forbiddenFieldNames === undefined
      ? Object.freeze([])
      : expectUniqueStringArray(forbiddenFieldNames, `${path}/forbiddenFieldNames`),
    structuralBoundRefs: Object.freeze(structuralBoundRefs),
  });
}

function parseValueSet(value: JsonValue, path: string): ClassCatalogValueSet {
  const object = expectObject(value, path);
  assertAllowedKeys(object, path, ['id', 'name', 'description', 'cardinality', 'tokens']);
  assertRequiredKeys(object, path, ['id', 'name', 'description', 'tokens']);
  const tokenIds: string[] = [];
  const playLayerTokensByToken = new Map<string, readonly string[]>();
  for (const [index, entry] of expectNonEmptyArray(object['tokens'], `${path}/tokens`).entries()) {
    const tokenPath = `${path}/tokens/${index}`;
    const token = expectObject(entry, tokenPath);
    assertAllowedKeys(token, tokenPath, ['id', 'name', 'description', 'playLayerTokens']);
    assertRequiredKeys(token, tokenPath, ['id', 'name', 'description']);
    const tokenId = expectString(token['id'], `${tokenPath}/id`);
    expectString(token['name'], `${tokenPath}/name`);
    expectString(token['description'], `${tokenPath}/description`);
    if (tokenIds.includes(tokenId)) {
      throw new ClassCatalogContractError(`${tokenPath}/id`, `duplicate token id ${tokenId}`);
    }
    tokenIds.push(tokenId);
    const playLayerTokens = token['playLayerTokens'];
    playLayerTokensByToken.set(
      tokenId,
      playLayerTokens === undefined
        ? Object.freeze([])
        : expectUniqueStringArray(playLayerTokens, `${tokenPath}/playLayerTokens`),
    );
  }
  return Object.freeze({
    id: expectString(object['id'], `${path}/id`),
    name: expectString(object['name'], `${path}/name`),
    description: expectString(object['description'], `${path}/description`),
    tokenIds: Object.freeze(tokenIds),
    playLayerTokensByToken,
  });
}

function parseProhibition(value: JsonValue, path: string): ClassCatalogProhibition {
  const object = expectObject(value, path);
  assertAllowedKeys(object, path, ['id', 'diagnosticCode', 'statement', 'correction']);
  assertRequiredKeys(object, path, ['id', 'diagnosticCode', 'statement', 'correction']);
  const diagnosticCode = expectString(object['diagnosticCode'], `${path}/diagnosticCode`);
  if (!/^[A-Z][A-Z0-9_]*$/.test(diagnosticCode)) {
    throw new ClassCatalogContractError(`${path}/diagnosticCode`, 'must be an upper-snake-case stable diagnostic code');
  }
  return Object.freeze({
    id: expectString(object['id'], `${path}/id`),
    diagnosticCode,
    statement: expectString(object['statement'], `${path}/statement`),
    correction: expectString(object['correction'], `${path}/correction`),
  });
}

function parseUnresolvedItem(value: JsonValue, path: string): ClassCatalogUnresolvedItem {
  const object = expectObject(value, path);
  assertAllowedKeys(object, path, ['id', 'statement', 'handling', 'awaitingDecisionId', 'sources']);
  assertRequiredKeys(object, path, ['id', 'statement', 'handling', 'awaitingDecisionId', 'sources']);
  expectNonEmptyArray(object['sources'], `${path}/sources`).forEach((source, index) =>
    parseSourceRecord(source, `${path}/sources/${index}`));
  return Object.freeze({
    id: expectString(object['id'], `${path}/id`),
    awaitingDecisionId: expectString(object['awaitingDecisionId'], `${path}/awaitingDecisionId`),
    statement: expectString(object['statement'], `${path}/statement`),
    handling: expectString(object['handling'], `${path}/handling`),
  });
}

function parseClassificationEvidence(value: JsonValue | undefined, path: string): void {
  const object = expectObject(value, path);
  assertAllowedKeys(object, path, [
    'enumerable',
    'enumerationRationale',
    'composable',
    'compositionRationale',
    'gameplayIndependent',
    'independenceRationale',
  ]);
  assertRequiredKeys(object, path, [
    'enumerable',
    'enumerationRationale',
    'composable',
    'compositionRationale',
    'gameplayIndependent',
    'independenceRationale',
  ]);
  for (const criterion of ['enumerable', 'composable', 'gameplayIndependent'] as const) {
    if (expectBoolean(object[criterion], `${path}/${criterion}`) !== true) {
      throw new ClassCatalogContractError(
        `${path}/${criterion}`,
        'a registered base-layer family must satisfy all three criteria',
      );
    }
  }
  expectString(object['enumerationRationale'], `${path}/enumerationRationale`);
  expectString(object['compositionRationale'], `${path}/compositionRationale`);
  expectString(object['independenceRationale'], `${path}/independenceRationale`);
}

/**
 * 解析统一形状的基类层目录，并在解析期执行结构性契约：
 * 标识唯一、语义族一致、能力引用可解析、必需与可选能力不重叠、
 * 结构边界引用可解析、值集合内取值唯一、类型身份陈述不重复。
 *
 * 语义层面的护栏（数值归属、层级归属、伪子类型、跨目录引用）由本模块的
 * `find*` 函数提供，便于对人造反例单独运行。
 */
export function parseClassCatalog(parsed: JsonValue, sourceId: string): ClassCatalog {
  const root = expectObject(parsed, '');
  assertAllowedKeys(root, '', CLASS_CATALOG_ROOT_KEYS);
  assertRequiredKeys(root, '', [
    'schemaVersion',
    'version',
    'name',
    'description',
    'category',
    'semanticFamilies',
    'classificationEvidence',
    'sourceRecords',
    'classes',
    'capabilities',
    'valueSets',
    'structuralBounds',
    'prohibitions',
    'unresolvedItems',
    'compositionContract',
  ]);
  const version = expectString(root['version'], '/version');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new ClassCatalogContractError('/version', 'must use semantic version form x.y.z');
  }
  parseClassificationEvidence(root['classificationEvidence'], '/classificationEvidence');
  expectNonEmptyArray(root['sourceRecords'], '/sourceRecords').forEach((record, index) =>
    parseSourceRecord(record, `/sourceRecords/${index}`));

  const semanticFamilies = expectUniqueStringArray(root['semanticFamilies'], '/semanticFamilies');
  if (semanticFamilies.length === 0) {
    throw new ClassCatalogContractError('/semanticFamilies', 'must declare at least one semantic family');
  }

  const classes = expectNonEmptyArray(root['classes'], '/classes')
    .map((entry, index) => parseClassEntry(entry, `/classes/${index}`));
  const capabilities = expectNonEmptyArray(root['capabilities'], '/capabilities')
    .map((entry, index) => parseCapability(entry, `/capabilities/${index}`));
  const valueSets = expectArray(root['valueSets'], '/valueSets')
    .map((entry, index) => parseValueSet(entry, `/valueSets/${index}`));
  const structuralBounds = expectArray(root['structuralBounds'], '/structuralBounds')
    .map((entry, index) => parseStructuralBound(entry, `/structuralBounds/${index}`));
  const prohibitions = expectArray(root['prohibitions'], '/prohibitions')
    .map((entry, index) => parseProhibition(entry, `/prohibitions/${index}`));
  const unresolvedItems = expectArray(root['unresolvedItems'], '/unresolvedItems')
    .map((entry, index) => parseUnresolvedItem(entry, `/unresolvedItems/${index}`));
  return finishClassCatalog({
    sourceId,
    root,
    version,
    semanticFamilies,
    classes,
    capabilities,
    valueSets,
    structuralBounds,
    prohibitions,
    unresolvedItems,
  });
}

interface ClassCatalogDraft {
  readonly sourceId: string;
  readonly root: JsonObject;
  readonly version: string;
  readonly semanticFamilies: readonly string[];
  readonly classes: readonly ClassCatalogClassEntry[];
  readonly capabilities: readonly ClassCatalogCapability[];
  readonly valueSets: readonly ClassCatalogValueSet[];
  readonly structuralBounds: readonly StructuralBoundRecord[];
  readonly prohibitions: readonly ClassCatalogProhibition[];
  readonly unresolvedItems: readonly ClassCatalogUnresolvedItem[];
}

function finishClassCatalog(draft: ClassCatalogDraft): ClassCatalog {
  assertUniqueIds(draft.classes, '/classes');
  assertUniqueIds(draft.capabilities, '/capabilities');
  assertUniqueIds(draft.valueSets, '/valueSets');
  assertUniqueIds(draft.structuralBounds, '/structuralBounds');
  assertUniqueIds(draft.prohibitions, '/prohibitions');
  assertUniqueIds(draft.unresolvedItems, '/unresolvedItems');

  const declaredIds = [...draft.classes.map((entry) => entry.id), ...draft.capabilities.map((entry) => entry.id)];
  if (new Set(declaredIds).size !== declaredIds.length) {
    throw new ClassCatalogContractError('/capabilities', 'class ids and capability ids must not collide');
  }

  const capabilityIds = new Set(draft.capabilities.map((capability) => capability.id));
  const boundIds = new Set(draft.structuralBounds.map((bound) => bound.id));
  const families = new Set(draft.semanticFamilies);

  for (const [index, entry] of draft.classes.entries()) {
    const path = `/classes/${index}`;
    if (!families.has(entry.semanticFamily)) {
      throw new ClassCatalogContractError(
        `${path}/semanticFamily`,
        `${entry.semanticFamily} is not declared in /semanticFamilies`,
      );
    }
    for (const capabilityId of [...entry.requiredCapabilityIds, ...entry.optionalCapabilityIds]) {
      if (!capabilityIds.has(capabilityId)) {
        throw new ClassCatalogContractError(path, `unknown capability id ${capabilityId}`);
      }
    }
    for (const boundId of entry.structuralBoundRefs) {
      if (!boundIds.has(boundId)) {
        throw new ClassCatalogContractError(path, `unknown structural bound id ${boundId}`);
      }
    }
  }

  const familiesUsed = new Set(draft.classes.map((entry) => entry.semanticFamily));
  const unusedFamily = draft.semanticFamilies.find((family) => !familiesUsed.has(family));
  if (unusedFamily !== undefined) {
    throw new ClassCatalogContractError('/semanticFamilies', `${unusedFamily} is declared but no class uses it`);
  }

  for (const [index, capability] of draft.capabilities.entries()) {
    for (const exclusiveId of capability.mutuallyExclusiveWith) {
      if (!capabilityIds.has(exclusiveId)) {
        throw new ClassCatalogContractError(
          `/capabilities/${index}/mutuallyExclusiveWith`,
          `unknown capability id ${exclusiveId}`,
        );
      }
    }
  }

  const statements = draft.classes.map((entry) => entry.typeIdentityStatement);
  if (new Set(statements).size !== statements.length) {
    throw new ClassCatalogContractError('/classes', 'type identity statements must differ between classes');
  }

  const pseudoSubtypes = findPseudoSubtypes(
    draft.classes.map((entry, index) => ({
      id: entry.id,
      path: `${draft.sourceId}/classes/${index}`,
      distinguishingKey: [
        entry.defKind,
        entry.semanticFamily,
        [...entry.requiredCapabilityIds].sort((left, right) => left.localeCompare(right, 'en')).join(','),
        [...entry.optionalCapabilityIds].sort((left, right) => left.localeCompare(right, 'en')).join(','),
        [...entry.parameterKeys].sort((left, right) => left.localeCompare(right, 'en')).join(','),
      ],
    })),
  );
  if (pseudoSubtypes.length > 0) {
    throw new ClassCatalogContractError('/classes', formatViolations(pseudoSubtypes).join('; '));
  }

  const kernelOpUses: KernelOpUse[] = [];
  draft.classes.forEach((entry, index) => {
    entry.kernelOps.forEach((op, opIndex) =>
      kernelOpUses.push({ path: `${draft.sourceId}/classes/${index}/kernelOps/${opIndex}`, op }));
  });
  draft.capabilities.forEach((capability, index) => {
    capability.kernelOps.forEach((op, opIndex) =>
      kernelOpUses.push({ path: `${draft.sourceId}/capabilities/${index}/kernelOps/${opIndex}`, op }));
  });

  return deepFreeze({
    sourceId: draft.sourceId,
    category: expectString(draft.root['category'], '/category'),
    version: draft.version,
    semanticFamilies: draft.semanticFamilies,
    classes: draft.classes,
    capabilities: draft.capabilities,
    valueSets: draft.valueSets,
    structuralBounds: draft.structuralBounds,
    prohibitions: draft.prohibitions,
    unresolvedItems: draft.unresolvedItems,
    kernelOpUses: Object.freeze(kernelOpUses),
  });
}
