/**
 * 基类层契约完备性测试。
 *
 * 这里补的是"契约已声明但没有任何东西在检查它"的那一类缺口。既有测试覆盖了
 * 统一形状目录（由 `parseClassCatalog` 全量校验）与状态族；本文件补上：
 *
 * - 跨目录组合引用（容器、移动）是否悬空——此前只有目录内引用被校验；
 * - 引擎层运行时簿记伪装的检查范围，从状态族扩大到全部目录的类与能力标识；
 * - 非统一形状目录（weapons、vehicles、npcs）的抽象性与类型身份唯一性；
 * - `forbiddenFieldNames` 是否真的被强制，而不是只写在目录里；
 * - schemas/ 是否会给玩法数值留下入口。
 *
 * 每条契约都同时跑正例（真实目录必须通过）与反例（人造违规必须被定位）。
 */

import { describe, expect, it } from 'vitest';
import {
  TYPE_IDENTITY_BASES,
  findDanglingReferences,
  findPseudoSubtypes,
  findRuntimeStateDisguises,
  formatViolations,
  type ContractViolation,
  type DistinguishableEntry,
  type NamedEntry,
  type TypedReferenceUse,
} from '../class-contract';
import {
  expectArray,
  expectObject,
  expectString,
  visitJson,
  type JsonObject,
} from '../json-contract';
import type { JsonValue } from '../../core/kernel/spec-compiler/types';
import {
  CATALOG_DIRS,
  SCHEMA_ROOT,
  canonicalClassIds,
  catalogText,
  classSourceId,
  jsonFilesUnder,
  readCatalog,
  readClassJson,
} from './catalog-fixtures';

/** 各目录中承载"语义类"的字段名。token 型目录不在此列，另行声明。 */
const CLASS_ENTRY_FIELDS: ReadonlyMap<string, readonly string[]> = Object.freeze(
  new Map<string, readonly string[]>([
    ['actions', ['classes']],
    ['attachments', ['classes']],
    ['containers', ['classes']],
    ['gateways', ['classes']],
    ['items', ['classes']],
    ['movement', ['classes']],
    ['npcs', ['classes']],
    ['scenes', ['classes']],
    ['skills', ['classes']],
    ['vehicles', ['classes']],
    ['weapons', ['classes']],
  ]),
);

/**
 * 只登记语义标识而不登记语义类的目录。
 *
 * 这些目录的条目没有 defKind 与 typeIdentity：伤害类别与弱点类别是编号语义，
 * 状态类由 status-effect.schema.json 与状态族测试单独覆盖。
 */
const TOKEN_ONLY_CATALOG_DIRS: readonly string[] = Object.freeze([
  'damage-types',
  'statuses',
  'vulnerability-types',
]);

/** 跨目录组合引用字段名：值必须解析到另一个目录登记的标识。 */
const CROSS_CATALOG_REFERENCE_KEYS: ReadonlyMap<string, string> = Object.freeze(
  new Map<string, string>([
    ['containerClassRefs', '容器族登记表'],
    ['movementClassRefs', '移动族登记表'],
  ]),
);

/** 解析目录文本为可改写的普通对象，用于构造反例。 */
function mutableCatalog(dir: string): Record<string, unknown> {
  return JSON.parse(catalogText(dir)) as Record<string, unknown>;
}

function entriesOf(root: JsonObject, field: string): readonly JsonObject[] {
  const value = root[field];
  if (value === undefined) return Object.freeze([]);
  return expectArray(value, `/${field}`).map((entry, index) => expectObject(entry, `/${field}/${index}`));
}

/** 目录中全部语义类条目，带其 JSON 定位。 */
function classEntriesWithPath(dir: string, root: JsonObject): readonly { entry: JsonObject; path: string }[] {
  const fields = CLASS_ENTRY_FIELDS.get(dir);
  if (fields === undefined) return Object.freeze([]);
  return fields.flatMap((field) =>
    entriesOf(root, field).map((entry, index) => ({ entry, path: `${dir}/index.json/${field}/${index}` })));
}

/** 目录中全部能力条目，带其 JSON 定位。 */
function capabilityEntriesWithPath(dir: string, root: JsonObject): readonly { entry: JsonObject; path: string }[] {
  return entriesOf(root, 'capabilities').map((entry, index) => ({
    entry,
    path: `${dir}/index.json/capabilities/${index}`,
  }));
}

function optionalStringArray(root: JsonObject, field: string): readonly string[] {
  const value = root[field];
  if (value === undefined) return Object.freeze([]);
  return expectArray(value, `/${field}`).map((entry, index) => expectString(entry, `/${field}/${index}`));
}

function parameterKeys(entry: JsonObject): readonly string[] {
  return entriesOf(entry, 'parameters').map((parameter) => expectString(parameter['key'], '/parameters/key'));
}

/** 收集一份目录文档中的全部跨目录引用使用点。 */
function crossCatalogReferenceUses(sourceId: string, document: JsonValue): readonly TypedReferenceUse[] {
  const uses: TypedReferenceUse[] = [];
  visitJson(document, (visit) => {
    const expected = CROSS_CATALOG_REFERENCE_KEYS.get(visit.key);
    if (expected === undefined) return;
    if (typeof visit.value !== 'string') return;
    uses.push({ path: `${sourceId}${visit.pointer}`, id: visit.value, expected });
  });
  return Object.freeze(uses);
}

/** 找出被 `forbiddenFieldNames` 禁止、却仍能经自身参数或必需能力参数到达的字段名。 */
function findReachableForbiddenFields(dir: string, root: JsonObject): readonly ContractViolation[] {
  const capabilityParameters = new Map<string, readonly string[]>(
    capabilityEntriesWithPath(dir, root)
      .map(({ entry }) => [expectString(entry['id'], '/capabilities/id'), parameterKeys(entry)]),
  );
  const violations: ContractViolation[] = [];
  for (const { entry, path } of classEntriesWithPath(dir, root)) {
    const forbidden = optionalStringArray(entry, 'forbiddenFieldNames');
    if (forbidden.length === 0) continue;
    const own = parameterKeys(entry);
    const viaRequired = optionalStringArray(entry, 'requiredCapabilityIds')
      .flatMap((capabilityId) => capabilityParameters.get(capabilityId) ?? []);
    for (const name of forbidden) {
      const reachedVia = own.includes(name)
        ? 'its own parameter list'
        : viaRequired.includes(name)
          ? 'a required capability parameter list'
          : undefined;
      if (reachedVia === undefined) continue;
      violations.push({
        code: 'CLASS_FORBIDDEN_FIELD_REACHABLE',
        path,
        reason: `${String(entry['id'])} 声明禁止字段 ${name}，但该字段仍可经${reachedVia === 'its own parameter list' ? '自身参数' : '必需能力参数'}到达。`,
        correction: '移除该参数，或从 forbiddenFieldNames 中去掉它并说明类型身份为何允许它。',
      });
    }
  }
  return violations;
}

/**
 * schemas/ 中允许声明数值型数据属性的位置。
 *
 * 只有结构边界取值与来源定位的行列号可以是数字：前者必须同时带分类、权威来源与
 * 结构理由，后者是内部度量。除此之外任何数值型属性都会给玩法数值留下入口。
 * 注意这里只检查 `type: number|integer`（数据形状），不检查 minLength/minItems
 * 这类 schema 自身的元约束。
 */
const ALLOWED_NUMERIC_SCHEMA_POINTERS: readonly string[] = Object.freeze([
  '/definitions/sourceLocation/properties/line/type',
  '/definitions/sourceLocation/properties/column/type',
  '/definitions/structuralBound/properties/value/type',
]);

function findNumericSchemaProperties(sourceId: string, schema: JsonValue): readonly ContractViolation[] {
  const violations: ContractViolation[] = [];
  visitJson(schema, (visit) => {
    if (visit.key !== 'type') return;
    if (visit.value !== 'number' && visit.value !== 'integer') return;
    if (ALLOWED_NUMERIC_SCHEMA_POINTERS.includes(visit.pointer)) return;
    violations.push({
      code: 'SCHEMA_ADMITS_UNCLASSIFIED_NUMBER',
      path: `${sourceId}${visit.pointer}`,
      reason: `schema 允许在此处出现 ${String(visit.value)} 型取值，而该位置不是已分类的结构边界或内部度量。`,
      correction: '把该字段改为字段名声明（字符串），让取值由玩法层 profile 承载。',
    });
  });
  return violations;
}

function schemaFiles(): readonly string[] {
  return jsonFilesUnder(SCHEMA_ROOT);
}

describe('cross-catalog composition references', () => {
  it('resolves every cross-catalog class reference against the canonical class catalogs', () => {
    const known = canonicalClassIds();
    const uses = CATALOG_DIRS.flatMap((dir) =>
      crossCatalogReferenceUses(`${dir}/index.json`, readCatalog(dir)));
    // 断言这些引用真的存在，否则下一条断言会在零输入上空转。
    expect(uses.length, '跨目录引用必须至少存在一处，否则本契约无从证伪').toBeGreaterThan(0);
    expect(formatViolations(findDanglingReferences(uses, known, 'REF_MISSING_TARGET'))).toEqual([]);
  });

  it('keeps the declared cross-catalog reference key list from rotting', () => {
    const seen = new Set<string>();
    for (const dir of CATALOG_DIRS) {
      visitJson(readCatalog(dir), (visit) => {
        if (CROSS_CATALOG_REFERENCE_KEYS.has(visit.key)) seen.add(visit.key);
      });
    }
    expect([...CROSS_CATALOG_REFERENCE_KEYS.keys()].filter((key) => !seen.has(key)))
      .toEqual([]);
  });

  it('rejects a cross-catalog reference whose target no longer exists', () => {
    const damaged = mutableCatalog('vehicles');
    const capabilities = damaged['capabilities'] as Record<string, unknown>[];
    const cargo = capabilities.find((entry) => Array.isArray(entry['containerClassRefs']));
    expect(cargo, 'containerClassRefs 必须至少存在于一个能力上').toBeDefined();
    if (cargo === undefined) throw new Error('no capability carries containerClassRefs');
    cargo['containerClassRefs'] = ['container.class.does_not_exist'];

    const uses = crossCatalogReferenceUses('vehicles/index.json', damaged as JsonValue);
    const violations = findDanglingReferences(uses, canonicalClassIds(), 'REF_MISSING_TARGET');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('REF_MISSING_TARGET');
    expect(violations[0]?.reason).toContain('容器族登记表');
  });
});

describe('engine runtime-state disguise across every catalog', () => {
  const tokens = expectArray(
    expectObject(readCatalog('statuses')['runtimeStateBoundary'], '/runtimeStateBoundary')['forbiddenConceptTokens'],
    '/forbiddenConceptTokens',
  ).map((value, index) => expectString(value, `/forbiddenConceptTokens/${index}`));

  function namedEntries(dir: string): readonly NamedEntry[] {
    const root = readCatalog(dir);
    const classes = classEntriesWithPath(dir, root);
    const capabilities = capabilityEntriesWithPath(dir, root);
    return [...classes, ...capabilities].map(({ entry, path }) => ({
      id: expectString(entry['id'], `${path}/id`),
      name: expectString(entry['name'], `${path}/name`),
      path,
    }));
  }

  it('keeps engine bookkeeping tokens out of class and capability identifiers in every catalog', () => {
    const violations = CATALOG_DIRS
      .filter((dir) => !TOKEN_ONLY_CATALOG_DIRS.includes(dir))
      .flatMap((dir) => findRuntimeStateDisguises(namedEntries(dir), tokens));
    expect(formatViolations(violations)).toEqual([]);
  });

  it('rejects an engine bookkeeping concept disguised as a class in any catalog', () => {
    const violations = findRuntimeStateDisguises(
      [{ id: 'gateway.class.transaction_phase', name: '阶段网关', path: 'gateways/index.json/classes/9' }],
      tokens,
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(new Set(violations.map((violation) => violation.code))).toEqual(new Set(['LAYER_L1_RUNTIME_STATE']));
    expect(new Set(violations.map((violation) => violation.path))).toEqual(new Set(['gateways/index.json/classes/9']));
  });
});

describe('abstractness and type identity for non-uniform catalogs', () => {
  // weapons、vehicles、npcs 不走统一形状 schema，其抽象性与类型身份唯一性此前只在
  // 统一目录里被 parseClassCatalog 强制；这里为它们补上等价的机械校验。
  const NON_UNIFORM_DIRS = ['weapons', 'vehicles', 'npcs'] as const;

  it('keeps every non-uniform class abstract with a declared type identity basis', () => {
    const violations: string[] = [];
    for (const dir of NON_UNIFORM_DIRS) {
      const root = readCatalog(dir);
      for (const { entry, path } of classEntriesWithPath(dir, root)) {
        if (entry['abstract'] !== true) violations.push(`${path} abstract=${String(entry['abstract'])}`);
        const identity = entry['typeIdentity'];
        if (identity === undefined || typeof identity !== 'object' || Array.isArray(identity)) {
          violations.push(`${path} missing typeIdentity`);
          continue;
        }
        const basis = (identity as JsonObject)['basis'];
        if (typeof basis !== 'string' || !TYPE_IDENTITY_BASES.includes(basis as (typeof TYPE_IDENTITY_BASES)[number])) {
          violations.push(`${path} bad typeIdentity.basis=${String(basis)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps type identity statements unique within each non-uniform class field', () => {
    const violations: string[] = [];
    for (const dir of NON_UNIFORM_DIRS) {
      const root = readCatalog(dir);
      const entries: DistinguishableEntry[] = classEntriesWithPath(dir, root).map(({ entry, path }) => ({
        id: expectString(entry['id'], `${path}/id`),
        path,
        distinguishingKey: [
          expectString(expectObject(entry['typeIdentity'], `${path}/typeIdentity`)['statement'], `${path}/statement`),
        ],
      }));
      violations.push(...findPseudoSubtypes(entries, 'CLASS_DUPLICATE_TYPE_IDENTITY').map((v) => `${v.path}: ${v.reason}`));
    }
    expect(violations).toEqual([]);
  });

  it('rejects two weapon classes that share an identical type identity statement', () => {
    const damaged = mutableCatalog('weapons');
    // W2 统一信封：武器类与伤害结算类都收在 weapons.classes，不再是旧专有顶层 weaponClasses。
    const weaponClasses = (damaged['classes'] as Record<string, unknown>[])
      .filter((entry) => String(entry['id']).startsWith('weapon-class.'));
    const first = weaponClasses[0]?.['typeIdentity'] as Record<string, unknown>;
    const second = weaponClasses[1]?.['typeIdentity'] as Record<string, unknown>;
    second['statement'] = first['statement'];

    const entries: DistinguishableEntry[] = weaponClasses.map((entry, index) => ({
      id: String(entry['id']),
      path: `weapons/index.json/classes/${index}`,
      distinguishingKey: [String((entry['typeIdentity'] as Record<string, unknown>)['statement'])],
    }));
    const violations = findPseudoSubtypes(entries, 'CLASS_DUPLICATE_TYPE_IDENTITY');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CLASS_DUPLICATE_TYPE_IDENTITY');
  });
});

describe('forbidden field names are actually enforced', () => {
  it('keeps every forbidden field name unreachable through own or required-capability parameters', () => {
    const violations = CATALOG_DIRS
      .filter((dir) => CLASS_ENTRY_FIELDS.has(dir))
      .flatMap((dir) => findReachableForbiddenFields(dir, readCatalog(dir)));
    expect(formatViolations(violations)).toEqual([]);
  });

  it('rejects a class that forbids a field it still exposes as a parameter', () => {
    const damaged = mutableCatalog('skills');
    const classes = damaged['classes'] as Record<string, unknown>[];
    const passive = classes.find((entry) => entry['id'] === 'skill.class.passive');
    expect(passive).toBeDefined();
    if (passive === undefined) throw new Error('skill.class.passive not found');
    // 让被动技能同时把 cost 声明为参数键，又把 cost 留在 forbiddenFieldNames 里。
    passive['parameters'] = [
      ...(passive['parameters'] as Record<string, unknown>[]),
      { key: 'cost', description: '违规注入的成本参数。', required: true, valueShape: 'field-name' },
    ];
    const violations = findReachableForbiddenFields('skills', damaged as unknown as JsonObject);
    expect(violations.some((violation) => violation.code === 'CLASS_FORBIDDEN_FIELD_REACHABLE')).toBe(true);
    expect(violations.some((violation) => violation.reason.includes('cost'))).toBe(true);
  });
});

describe('schemas do not admit unclassified numbers', () => {
  it('keeps every schema free of numeric data properties outside classified bounds and metrics', () => {
    const violations = schemaFiles().flatMap((path) =>
      findNumericSchemaProperties(classSourceId(path), readClassJson(path)));
    expect(formatViolations(violations)).toEqual([]);
  });

  it('rejects a schema that would let a gameplay number through', () => {
    const probe = {
      type: 'object',
      properties: {
        damageAmount: { type: 'number' },
      },
    } as unknown as JsonValue;
    const violations = findNumericSchemaProperties('probe.schema.json', probe);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('SCHEMA_ADMITS_UNCLASSIFIED_NUMBER');
    expect(violations[0]?.path).toBe('probe.schema.json/properties/damageAmount/type');
  });
});

describe('damage settlement classes carry a machine-checkable type identity', () => {
  it('gives every weapon damage class a distinct settlement input kind', () => {
    // W2：伤害结算类的类型身份不再落在专有的 settlementInputKind 字段上,而是由
    // settlement_input_kinds 值集登记结算输入来源、class 的 typeIdentity.statement 表达。
    // 这里断言可枚举层面的契约:结算输入来源 token 互异,且每个伤害结算类都能被 damage_reference 引用。
    const valueSets = expectArray(readCatalog('weapons')['valueSets'], '/valueSets')
      .map((entry, index) => expectObject(entry, `/valueSets/${index}`));
    const settlementSet = valueSets.find((set) => set['id'] === 'weapon.valueset.settlement_input_kinds');
    expect(settlementSet, '必须存在 settlement_input_kinds 值集').toBeDefined();
    const tokens = expectArray(settlementSet?.['tokens'], '/settlement_input_kinds/tokens')
      .map((token, index) => expectString(expectObject(token, `/tokens/${index}`)['id'], `/tokens/${index}/id`));

    const classes = expectArray(readCatalog('weapons')['classes'], '/classes');
    const damageClasses = classes
      .map((entry, index) => ({ entry: expectObject(entry, `/classes/${index}`), index }))
      .filter(({ entry }) => String(entry['id']).startsWith('damage-class.'));
    // 结算语义类必须各有一个可枚举的、互异的输入来源 token,而不是只存在于散文里。
    expect(damageClasses.length).toBeGreaterThan(1);
    expect(new Set(tokens).size, '结算输入来源 token 不得重复').toBe(tokens.length);
    // 每个伤害结算类必须能通过 damage_reference 能力被引用(声明 damageClassId 入口)。
    const capabilityIds = new Set(
      classes.flatMap((raw, index) => {
        const entry = expectObject(raw, `/classes/${index}`);
        return [
          ...expectArray(entry['requiredCapabilityIds'], `/classes/${index}/requiredCapabilityIds`),
          ...expectArray(entry['optionalCapabilityIds'], `/classes/${index}/optionalCapabilityIds`),
        ];
      }),
    );
    expect(capabilityIds, '伤害结算类必须能被 damage_reference 能力引用').toContain('weapon.capability.damage_reference');
  });
});

/**
 * 类标识形状：跨目录**实际取值**引用的判别式。
 *
 * 基类层里绝大多数"引用"是参数声明（key + valueShape，描述玩法层将提供什么），
 * 不是实际取值；只有极少数字段（如 `containerClassRefs`）携带具体的跨目录类标识。
 * 这条判别式只匹配"长得像另一个目录的类标识"的**具体字符串取值**，从而无需依赖
 * 硬编码键名清单，就能发现任何新增的跨目录悬空引用（补 G-01 的防腐缺口）。
 *
 * 判别式刻意收紧：只认 `<前缀>.class.<名>` 以及武器目录的
 * `(spectrum|damage|weapon)-class.<名>`、`(range|weight)-tier.<名>` 这几种确定的类标识形态；
 * 说明、指纹、valueShape 等自由文本不会误命中。
 */
const CLASS_ID_SHAPE =
  /^(?:[a-z-]+\.class\.[a-z_.]+|(?:spectrum|damage|weapon)-class\.[a-z_]+|(?:range|weight)-tier\.[a-z_]+)$/;

/** 这些键承载的是标识本身或自由文本，不是引用取值，扫描时跳过以免自命中。 */
const NON_REFERENCE_KEYS = new Set<string>([
  'id',
  'name',
  'description',
  'statement',
  'statementFingerprint',
  'valueShape',
  'correction',
  'handling',
  'reason',
]);

function findUnresolvedClassIdValues(
  sourceId: string,
  document: JsonValue,
  known: ReadonlySet<string>,
): readonly ContractViolation[] {
  const violations: ContractViolation[] = [];
  visitJson(document, (visit) => {
    if (typeof visit.value !== 'string') return;
    if (NON_REFERENCE_KEYS.has(visit.key)) return;
    if (!CLASS_ID_SHAPE.test(visit.value)) return;
    if (known.has(visit.value)) return;
    violations.push({
      code: 'REF_MISSING_TARGET',
      path: `${sourceId}${visit.pointer}`,
      reason: `取值 ${visit.value} 形如类标识但无法在任何基类层目录中解析。`,
      correction: '补齐被引用的类定义，或移除该引用。',
    });
  });
  return violations;
}

describe('cross-catalog references resolve by identifier shape, not by a hardcoded key list', () => {
  it('resolves every class-id-shaped value in every catalog against the canonical class ids', () => {
    const known = canonicalClassIds();
    const violations = CATALOG_DIRS.flatMap((dir) =>
      findUnresolvedClassIdValues(`${dir}/index.json`, readCatalog(dir), known));
    expect(formatViolations(violations)).toEqual([]);
  });

  it('rejects a newly introduced class-id reference under any key once its target is gone', () => {
    // 用一个此前未被 CROSS_CATALOG_REFERENCE_KEYS 覆盖的全新键名，证明判别式不依赖键名清单。
    const probe = {
      classes: [{ id: 'x', someBrandNewLinkField: 'movement.class.does_not_exist' }],
    } as unknown as JsonValue;
    const violations = findUnresolvedClassIdValues('probe/index.json', probe, canonicalClassIds());
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('REF_MISSING_TARGET');
    expect(violations[0]?.path).toBe('probe/index.json/classes/0/someBrandNewLinkField');
  });

  it('does not flag a class-id-shaped value that actually resolves', () => {
    const probe = {
      capabilities: [{ id: 'y', linkTo: 'container.class.stationary' }],
    } as unknown as JsonValue;
    expect(findUnresolvedClassIdValues('probe/index.json', probe, canonicalClassIds())).toEqual([]);
  });
});
