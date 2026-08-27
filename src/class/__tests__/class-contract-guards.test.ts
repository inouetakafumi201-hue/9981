/**
 * 基类层契约护栏的可证伪测试。
 *
 * 每条契约都同时验证两侧：
 * - 正例：真实目录必须通过；
 * - 反例：人造违规输入必须被定位到具体 JSON 位置并给出稳定诊断代码。
 *
 * 只验证正例的测试无法证伪契约本身——它无法区分"契约成立"与"护栏没在工作"。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClassCatalogContractError } from '../json-contract';
import {
  GAMEPLAY_VALUE_FIELD_NAMES,
  L1_MECHANISM_DECLARATION_KEYS,
  findDanglingReferences,
  findGameplayValueKeys,
  findL1MechanismDeclarations,
  findPseudoSubtypes,
  findRuntimeStateDisguises,
  findUnclassifiedNumericLeaves,
  formatViolations,
  parseClassCatalog,
  parseSourceRecord,
  parseStructuralBound,
  sortViolations,
} from '../class-contract';
import { parseClassJson } from '../catalog-loader';
import type { JsonValue } from '../../core/kernel/spec-compiler/types';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CLASS_ROOT = resolve(TEST_DIR, '..');

/** 统一形状目录：由 parseClassCatalog 全量校验。 */
export const UNIFORM_CATALOG_DIRS: readonly string[] = [
  'actions',
  'attachments',
  'containers',
  'gateways',
  'items',
  'movement',
  'scenes',
  'skills',
];

function classJsonFiles(): readonly string[] {
  const files: string[] = [];
  const walk = (root: string): void => {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'schemas' || entry.name === '__tests__') continue;
        walk(path);
      } else if (entry.isFile() && extname(entry.name) === '.json') {
        files.push(path);
      }
    }
  };
  walk(CLASS_ROOT);
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function readClassJson(path: string): JsonValue {
  const sourceId = relative(CLASS_ROOT, path).replaceAll('\\', '/');
  return parseClassJson(readFileSync(path, 'utf8'), sourceId);
}

function sourceIdOf(path: string): string {
  return relative(CLASS_ROOT, path).replaceAll('\\', '/');
}

function catalogText(dir: string): string {
  return readFileSync(join(CLASS_ROOT, dir, 'index.json'), 'utf8');
}

function mutateCatalog(dir: string, mutate: (root: Record<string, unknown>) => void): unknown {
  const root = JSON.parse(catalogText(dir)) as Record<string, unknown>;
  mutate(root);
  return root;
}

describe('numeric ownership guard', () => {
  it('accepts every real class catalog because its only numbers are classified structural bounds', () => {
    const violations = classJsonFiles().flatMap((path) =>
      findUnclassifiedNumericLeaves(readClassJson(path), sourceIdOf(path)));
    expect(formatViolations(violations)).toEqual([]);
  });

  it('rejects a number that is not inside a classified structural bound', () => {
    const violations = findUnclassifiedNumericLeaves(
      { classes: [{ id: 'x', damageAmount: 3 }] } as unknown as JsonValue,
      'probe.json',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('SCHEMA_FIELD_MISSING_CLASSIFICATION');
    expect(violations[0]?.path).toBe('probe.json/classes/0/damageAmount');
  });

  it('rejects numbers hidden inside arrays', () => {
    const violations = findUnclassifiedNumericLeaves(
      { damageTable: [1, 2, 3] } as unknown as JsonValue,
      'probe.json',
    );
    expect(violations.map((violation) => violation.path)).toEqual([
      'probe.json/damageTable/0',
      'probe.json/damageTable/1',
      'probe.json/damageTable/2',
    ]);
  });

  it('accepts a structural bound value and the source location line', () => {
    const violations = findUnclassifiedNumericLeaves(
      {
        structuralBounds: [
          { id: 'b', value: 5, authoritativeSource: { sourceLocation: { section: 's', line: 12 } } },
        ],
      } as unknown as JsonValue,
      'probe.json',
    );
    expect(violations).toEqual([]);
  });

  it('rejects a structural bound that drops its authoritative source or structural rationale', () => {
    const complete = {
      id: 'structural-bound.probe',
      name: '探针边界',
      classification: 'Structural_Bound',
      unit: 'count',
      value: 5,
      appliesToFields: ['field'],
      structuralRationale: '理由',
      authoritativeSource: {
        sourceFile: 'docs/L0_规范宪法.md',
        sourceLocation: { sourceFile: 'docs/L0_规范宪法.md', section: '四' },
        precedence: 'l0-constitution',
        classification: 'Normative_Contract',
        owningLayer: '基类层',
        statementFingerprint: 'probe',
      },
    } as unknown as JsonValue;
    expect(() => parseStructuralBound(complete, '/probe')).not.toThrow();

    const withoutSource = { ...(complete as object) } as Record<string, unknown>;
    delete withoutSource['authoritativeSource'];
    expect(() => parseStructuralBound(withoutSource as JsonValue, '/probe'))
      .toThrowError(/authoritativeSource: is required/);

    const withoutRationale = { ...(complete as object) } as Record<string, unknown>;
    delete withoutRationale['structuralRationale'];
    expect(() => parseStructuralBound(withoutRationale as JsonValue, '/probe'))
      .toThrowError(/structuralRationale: is required/);
  });

  it('rejects a source record that omits precedence, owning layer or fingerprint', () => {
    const record = {
      sourceFile: 'docs/L0_规范宪法.md',
      sourceLocation: { sourceFile: 'docs/L0_规范宪法.md', section: '四' },
      precedence: 'l0-constitution',
      classification: 'Normative_Contract',
      owningLayer: '基类层',
      statementFingerprint: 'probe',
    } as unknown as JsonValue;
    expect(() => parseSourceRecord(record, '/probe')).not.toThrow();

    for (const field of ['precedence', 'owningLayer', 'statementFingerprint']) {
      const damaged = { ...(record as object) } as Record<string, unknown>;
      delete damaged[field];
      expect(() => parseSourceRecord(damaged as JsonValue, '/probe'), field)
        .toThrowError(new RegExp(`${field}: is required`));
    }
    const wrongLayer = { ...(record as object), owningLayer: '内容' } as unknown as JsonValue;
    expect(() => parseSourceRecord(wrongLayer, '/probe')).toThrowError(/must be one of 引擎层, 基类层, 玩法层/);
  });
});

describe('layer ownership guards', () => {
  it('accepts every real class catalog for gameplay-value keys and engine mechanism keys', () => {
    const violations = classJsonFiles().flatMap((path) => {
      const document = readClassJson(path);
      const sourceId = sourceIdOf(path);
      return [
        ...findGameplayValueKeys(document, sourceId),
        ...findL1MechanismDeclarations(document, sourceId),
      ];
    });
    expect(formatViolations(violations)).toEqual([]);
  });

  it('rejects every declared gameplay-value key name used as a key', () => {
    for (const field of GAMEPLAY_VALUE_FIELD_NAMES) {
      const violations = findGameplayValueKeys(
        { classes: [{ [field]: 'anything' }] } as unknown as JsonValue,
        'probe.json',
      );
      expect(violations.map((violation) => violation.code), field).toEqual(['SCHEMA_GAMEPLAY_TABLE_IN_L2']);
      expect(violations[0]?.path, field).toBe(`probe.json/classes/0/${field}`);
    }
  });

  it('allows a gameplay-value name to appear as a declared field name string', () => {
    const violations = findGameplayValueKeys(
      { playLayerOwnedFieldNames: ['damage', 'apCost'] } as unknown as JsonValue,
      'probe.json',
    );
    expect(violations).toEqual([]);
  });

  it('rejects every declared engine mechanism key name', () => {
    for (const field of L1_MECHANISM_DECLARATION_KEYS) {
      const violations = findL1MechanismDeclarations(
        { capabilities: [{ [field]: {} }] } as unknown as JsonValue,
        'probe.json',
      );
      expect(violations.map((violation) => violation.code), field).toEqual(['LAYER_L1_OWNERSHIP']);
      expect(violations[0]?.path, field).toBe(`probe.json/capabilities/0/${field}`);
    }
  });
});

describe('engine runtime state disguise guard', () => {
  const forbiddenTokens = ['transaction', 'hook', 'snapshot', '事务', '钩子', '回合编号'] as const;

  it('accepts semantic status identifiers', () => {
    const violations = findRuntimeStateDisguises(
      [
        { id: 'status_poisoned', name: '中毒', path: 'statuses/status_poisoned.json' },
        { id: 'status_aiming', name: '瞄准', path: 'statuses/status_aiming.json' },
      ],
      forbiddenTokens,
    );
    expect(violations).toEqual([]);
  });

  it('rejects a status whose identifier or name denotes engine runtime bookkeeping', () => {
    const violations = findRuntimeStateDisguises(
      [
        { id: 'status_in_transaction', name: '事务中', path: 'statuses/status_in_transaction.json' },
        { id: 'status_hook_dispatching', name: '钩子分发中', path: 'statuses/status_hook_dispatching.json' },
      ],
      forbiddenTokens,
    );
    expect(new Set(violations.map((violation) => violation.code))).toEqual(new Set(['LAYER_L1_RUNTIME_STATE']));
    expect(new Set(violations.map((violation) => violation.path))).toEqual(new Set([
      'statuses/status_in_transaction.json',
      'statuses/status_hook_dispatching.json',
    ]));
  });

  it('does not fire on descriptions that merely cite an engine interface', () => {
    const violations = findRuntimeStateDisguises(
      [{ id: 'status_blocking', name: '格挡', path: 'statuses/status_blocking.json' }],
      forbiddenTokens,
    );
    expect(violations).toEqual([]);
  });
});

describe('pseudo subtype guard', () => {
  it('accepts entries that differ in at least one distinguishing field', () => {
    const violations = findPseudoSubtypes([
      { id: 'a', path: 'p/0', distinguishingKey: ['tag', 'negative', 'cap.x'] },
      { id: 'b', path: 'p/1', distinguishingKey: ['tag', 'positive', 'cap.x'] },
    ]);
    expect(violations).toEqual([]);
  });

  it('rejects entries whose distinguishing fields are identical', () => {
    const violations = findPseudoSubtypes(
      [
        { id: 'status_slowed', path: 'p/0', distinguishingKey: ['numeric', 'negative', 'cap.eff'] },
        { id: 'status_sluggish', path: 'p/1', distinguishingKey: ['numeric', 'negative', 'cap.eff'] },
      ],
      'STATUS_PSEUDO_SUBTYPE',
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('STATUS_PSEUDO_SUBTYPE');
    expect(violations[0]?.reason).toContain('status_sluggish');
    expect(violations[0]?.reason).toContain('status_slowed');
  });
});

describe('reference integrity guard', () => {
  it('accepts references that resolve', () => {
    const violations = findDanglingReferences(
      [{ path: 'p/0', id: 'cap.a', expected: '能力登记表' }],
      new Set(['cap.a']),
    );
    expect(violations).toEqual([]);
  });

  it('rejects dangling slot, container, ammunition and accessory references', () => {
    const violations = findDanglingReferences(
      [
        { path: 'p/slot', id: 'slot.missing', expected: '槽位登记表' },
        { path: 'p/container', id: 'container.missing', expected: '容器登记表' },
        { path: 'p/ammunition', id: 'item.class.missing', expected: '物品类登记表' },
        { path: 'p/accessory', id: 'item.capability.missing', expected: '能力登记表' },
      ],
      new Set(['slot.present']),
      'ITEM_DANGLING_CAPABILITY_REFERENCE',
    );
    expect(violations).toHaveLength(4);
    expect(new Set(violations.map((violation) => violation.code))).toEqual(
      new Set(['ITEM_DANGLING_CAPABILITY_REFERENCE']),
    );
  });
});

describe('violation ordering', () => {
  it('sorts by path then by stable code so the observable output is deterministic', () => {
    const ordered = sortViolations([
      { code: 'B_CODE', path: 'z/1', reason: 'r', correction: 'c' },
      { code: 'A_CODE', path: 'z/1', reason: 'r', correction: 'c' },
      { code: 'C_CODE', path: 'a/1', reason: 'r', correction: 'c' },
    ]);
    expect(ordered.map((violation) => `${violation.path}:${violation.code}`)).toEqual([
      'a/1:C_CODE',
      'z/1:A_CODE',
      'z/1:B_CODE',
    ]);
  });
});

describe('uniform catalog structural contract', () => {
  it('loads every uniform catalog through the runtime contract', () => {
    for (const dir of UNIFORM_CATALOG_DIRS) {
      const catalog = parseClassCatalog(
        parseClassJson(catalogText(dir), `${dir}/index.json`),
        `${dir}/index.json`,
      );
      expect(catalog.classes.length, dir).toBeGreaterThan(0);
      expect(catalog.capabilities.length, dir).toBeGreaterThan(0);
      expect(Object.isFrozen(catalog), dir).toBe(true);
      expect(Object.isFrozen(catalog.classes), dir).toBe(true);
    }
  });

  it('rejects a concrete (non-abstract) base class', () => {
    const damaged = mutateCatalog('skills', (root) => {
      const classes = root['classes'] as Record<string, unknown>[];
      (classes[0] as Record<string, unknown>)['abstract'] = false;
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'skills/index.json'))
      .toThrowError(/base classes must be abstract/);
  });

  it('rejects a capability id that a class references but the catalog does not declare', () => {
    const damaged = mutateCatalog('gateways', (root) => {
      const classes = root['classes'] as Record<string, unknown>[];
      (classes[0] as Record<string, unknown>)['requiredCapabilityIds'] = ['gateway.capability.absent'];
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'gateways/index.json'))
      .toThrowError(/unknown capability id gateway\.capability\.absent/);
  });

  it('rejects a capability listed as both required and optional', () => {
    const damaged = mutateCatalog('containers', (root) => {
      const classes = root['classes'] as Record<string, unknown>[];
      const first = classes[0] as Record<string, unknown>;
      const required = first['requiredCapabilityIds'] as string[];
      (first['optionalCapabilityIds'] as string[]).push(required[0] as string);
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'containers/index.json'))
      .toThrowError(/must not repeat required capabilities/);
  });

  it('rejects a structural bound reference that does not resolve', () => {
    const damaged = mutateCatalog('scenes', (root) => {
      const classes = root['classes'] as Record<string, unknown>[];
      (classes[0] as Record<string, unknown>)['connectionBoundId'] = 'structural-bound.absent';
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'scenes/index.json'))
      .toThrowError(/unknown structural bound id structural-bound\.absent/);
  });

  it('rejects a semantic family that no class uses', () => {
    const damaged = mutateCatalog('movement', (root) => {
      (root['semanticFamilies'] as string[]).push('invented-family');
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'movement/index.json'))
      .toThrowError(/invented-family is declared but no class uses it/);
  });

  it('rejects a class whose semantic family is not declared by the catalog', () => {
    const damaged = mutateCatalog('attachments', (root) => {
      const classes = root['classes'] as Record<string, unknown>[];
      (classes[0] as Record<string, unknown>)['semanticFamily'] = 'not-declared';
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'attachments/index.json'))
      .toThrowError(/not-declared is not declared in \/semanticFamilies/);
  });

  it('rejects duplicate class identifiers and class/capability id collisions', () => {
    const duplicated = mutateCatalog('skills', (root) => {
      const classes = root['classes'] as Record<string, unknown>[];
      (classes[1] as Record<string, unknown>)['id'] = (classes[0] as Record<string, unknown>)['id'];
    });
    expect(() => parseClassCatalog(duplicated as JsonValue, 'skills/index.json'))
      .toThrowError(ClassCatalogContractError);

    const collided = mutateCatalog('skills', (root) => {
      const classes = root['classes'] as Record<string, unknown>[];
      const capabilities = root['capabilities'] as Record<string, unknown>[];
      (capabilities[0] as Record<string, unknown>)['id'] = (classes[0] as Record<string, unknown>)['id'];
    });
    expect(() => parseClassCatalog(collided as JsonValue, 'skills/index.json'))
      .toThrowError(/class ids and capability ids must not collide/);
  });

  it('rejects an unknown root key and an unknown class key', () => {
    const rootKey = mutateCatalog('actions', (root) => {
      root['transactionModel'] = 'two-phase';
    });
    expect(() => parseClassCatalog(rootKey as JsonValue, 'actions/index.json'))
      .toThrowError(/transactionModel: is not part of the catalog contract/);

    const classKey = mutateCatalog('actions', (root) => {
      const classes = root['classes'] as Record<string, unknown>[];
      (classes[0] as Record<string, unknown>)['damage'] = 'x';
    });
    expect(() => parseClassCatalog(classKey as JsonValue, 'actions/index.json'))
      .toThrowError(/damage: is not part of the catalog contract/);
  });

  it('rejects two classes that share an identical type identity statement', () => {
    const damaged = mutateCatalog('movement', (root) => {
      const classes = root['classes'] as Record<string, unknown>[];
      const first = (classes[0] as Record<string, unknown>)['typeIdentity'] as Record<string, unknown>;
      const second = (classes[1] as Record<string, unknown>)['typeIdentity'] as Record<string, unknown>;
      second['statement'] = first['statement'];
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'movement/index.json'))
      .toThrowError(/type identity statements must differ between classes/);
  });

  it('rejects a duplicate token inside one value set', () => {
    const damaged = mutateCatalog('gateways', (root) => {
      const valueSets = root['valueSets'] as Record<string, unknown>[];
      const tokens = (valueSets[0] as Record<string, unknown>)['tokens'] as Record<string, unknown>[];
      (tokens[1] as Record<string, unknown>)['id'] = (tokens[0] as Record<string, unknown>)['id'];
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'gateways/index.json'))
      .toThrowError(/duplicate token id/);
  });

  it('rejects a family whose classification evidence fails any of the three criteria', () => {
    for (const criterion of ['enumerable', 'composable', 'gameplayIndependent']) {
      const damaged = mutateCatalog('containers', (root) => {
        (root['classificationEvidence'] as Record<string, unknown>)[criterion] = false;
      });
      expect(() => parseClassCatalog(damaged as JsonValue, 'containers/index.json'), criterion)
        .toThrowError(/must satisfy all three criteria/);
    }
  });

  it('round-trips an optional capability familyId into the catalog (CaS-01 对齐入口)', () => {
    // 单一来源族 id（`component.*` 的 familyId）在能力条目上声明后应被解析进 catalog.capabilities，
    // 说明 ECS ComponentContract ↔ 基类能力契约的族字段可由机器读取并对齐。
    // 用 attachments 族能力：`attachment.capability.host_binding`（params=hostType，kernelOps=attach.add）
    // 恰好是 ECS `component.attachment.host` 形状的子集 → 声明 familyId=attachment 可通过对齐（不误报）。
    const withFamilyId = mutateCatalog('attachments', (root) => {
      const capabilities = root['capabilities'] as Record<string, unknown>[];
      (capabilities[0] as Record<string, unknown>)['familyId'] = 'attachment';
    });
    const catalog = parseClassCatalog(withFamilyId as JsonValue, 'attachments/index.json');
    expect(catalog.capabilities[0]?.familyId).toBe('attachment');
  });

  it('rejects a capability familyId that is not a string (CaS-01 校验入口)', () => {
    const damaged = mutateCatalog('skills', (root) => {
      const capabilities = root['capabilities'] as Record<string, unknown>[];
      (capabilities[0] as Record<string, unknown>)['familyId'] = 7;
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'skills/index.json'))
      .toThrowError(ClassCatalogContractError);
  });

  it('rejects a capability whose compositionKind deviates from the ECS single source (T-CaS-01 反例)', () => {
    // attachment 族 ECS 组件 `component.attachment.host` 单一源是 modified-explicit；能力声明 `static` → parseClassCatalog 抛 ECS_ALIGN。
    const damaged = mutateCatalog('attachments', (root) => {
      const capabilities = root['capabilities'] as Record<string, unknown>[];
      (capabilities[0] as Record<string, unknown>)['familyId'] = 'attachment';
      (capabilities[0] as Record<string, unknown>)['compositionKind'] = 'static';
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'attachments/index.json'))
      .toThrowError(/ECS_ALIGN_COMPOSITION_KIND_MISMATCH/);
  });

  it('rejects a capability whose kernelOps exceed the ECS single source (T-CaS-01 反例)', () => {
    // attachment 能力声明一条 ECS 组件 `component.attachment.host` 未登记的 Op（prop.nonexistent） → ECS_ALIGN_KERNELOPS_NOT_IN_SOURCE。
    const damaged = mutateCatalog('attachments', (root) => {
      const capabilities = root['capabilities'] as Record<string, unknown>[];
      const first = capabilities[0] as Record<string, unknown>;
      first['familyId'] = 'attachment';
      first['kernelOps'] = [...(first['kernelOps'] as string[]), 'prop.nonexistent'];
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'attachments/index.json'))
      .toThrowError(/ECS_ALIGN_KERNELOPS_NOT_IN_SOURCE/);
  });

  it('rejects a componentId that points to a different family (T-CaS-01 反例)', () => {
    // 能力声明 familyId=attachment 但 componentId 指到别的族的组件 → ECS_ALIGN_COMPONENT_NOT_FOUND。
    const damaged = mutateCatalog('attachments', (root) => {
      const capabilities = root['capabilities'] as Record<string, unknown>[];
      (capabilities[0] as Record<string, unknown>)['familyId'] = 'attachment';
      (capabilities[0] as Record<string, unknown>)['componentId'] = 'component.status.hostState';
    });
    expect(() => parseClassCatalog(damaged as JsonValue, 'attachments/index.json'))
      .toThrowError(/ECS_ALIGN_COMPONENT_NOT_FOUND/);
  });

  it('accepts a capability that matches the ECS single source exactly (T-CaS-01 正例)', () => {
    // attachment.capability.host_binding 声明 familyId=attachment（hostType/attach.add ⊆ ECS shape）→ 通过对齐。
    const withExactMatch = mutateCatalog('attachments', (root) => {
      const capabilities = root['capabilities'] as Record<string, unknown>[];
      (capabilities[0] as Record<string, unknown>)['familyId'] = 'attachment';
    });
    expect(() => parseClassCatalog(withExactMatch as JsonValue, 'attachments/index.json')).not.toThrow();
  });
});
