/**
 * 正式数据完整性测试。
 *
 * 覆盖：严格 JSON 解析链、物品目录的运行期契约、状态索引与状态文件的双射、
 * 单记录 schema、玩法数值不得回流基类层、玩法层引用可解析、以及玩法层动作
 * 只能引用引擎层已注册的写入操作。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { createFullHarness, defaultSeedDefs } from '../../core/kernel/testing/full-harness.js';
import type { JsonValue } from '../../core/kernel/spec-compiler/types.js';
import {
  ClassCatalogContractError,
  parseClassJson,
  parseItemClassCatalog,
} from '../catalog-loader.js';
import {
  findGameplayValueKeys,
  findPseudoSubtypes,
  findRuntimeStateDisguises,
  findUnclassifiedNumericLeaves,
  formatViolations,
} from '../class-contract.js';
import { expectArray, expectObject, expectString, type JsonObject } from '../json-contract.js';
import {
  CLASS_ROOT,
  PLAY_PROFILE_ROOT,
  canonicalClassIds,
  classJsonFiles,
  classSourceId,
  getOperationChannels,
  getRuntimeStateBoundary,
  jsonFilesUnder,
  readCatalog,
  readClassJson,
  readPlayProfile,
  readSchema,
} from './catalog-fixtures.js';

function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'));
}

interface SchemaValidator {
  (value: unknown): boolean | PromiseLike<unknown>;
  readonly errors?: readonly unknown[] | null;
}

function compileSchema(name: string): SchemaValidator {
  return new Ajv({ allErrors: true }).compile(readSchema(name) as object);
}

function expectSchemaValid(validate: SchemaValidator, value: JsonValue, source: string): void {
  const valid = validate(value);
  expect(valid, `${source}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

function visit(
  value: JsonValue,
  path: string,
  visitor: (key: string, value: JsonValue, path: string) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${path}/${index}`, visitor));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key}`;
    visitor(key, child, childPath);
    visit(child, childPath, visitor);
  }
}

function statusFiles(): readonly string[] {
  return readdirSync(join(CLASS_ROOT, 'statuses'))
    .filter((name) => /^status_[a-z_]+\.json$/.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function statusEntries(): readonly JsonObject[] {
  const index = readCatalog('statuses');
  return expectArray(index['classes'], '/classes')
    .map((entry, position) => expectObject(entry, `/classes/${position}`));
}

describe('formal class and play data integrity', () => {
  it('strictly parses every formal JSON file without duplicate members or executable keys', () => {
    const classFiles = classJsonFiles();
    const playFiles = jsonFilesUnder(PLAY_PROFILE_ROOT);
    expect(classFiles.length).toBeGreaterThan(0);
    expect(playFiles.length).toBeGreaterThan(0);
    classFiles.forEach((path) => expect(() => readClassJson(path), path).not.toThrow());
    playFiles.forEach((path) => expect(() => readPlayProfile(path), path).not.toThrow());
  });

  it('loads the item catalog through its runtime TypeScript contract and freezes nested data', () => {
    const source = readFileSync(join(CLASS_ROOT, 'items', 'index.json'), 'utf8');
    const catalog = parseItemClassCatalog(source);
    expect(catalog.category).toBe('items');
    expect(catalog.classes.map((entry) => entry.id)).toEqual([
      'item.class.consumable',
      'item.class.tool',
      'item.class.equipment',
      'item.class.attachment',
      'item.class.ammunition',
    ]);
    expect(catalog.capabilities).toHaveLength(12);
    expect(catalog.capabilities.every((capability) => capability.parameters.length > 0)).toBe(true);
    expect(catalog.classes.every((entry) => entry.defKind === 'item')).toBe(true);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.capabilities[0]?.parameters)).toBe(true);

    const obsoleteShape = source.replace('"parameters"', '"parameterShape"');
    expect(() => parseItemClassCatalog(obsoleteShape)).toThrow(ClassCatalogContractError);
  });

  it('keeps the status index and per-status files in an exact schema-validated bijection', () => {
    const entries = statusEntries();
    const indexedIds = entries.map((entry, position) => expectString(entry['id'], `/classes/${position}/id`));
    expect(new Set(indexedIds).size).toBe(indexedIds.length);
    expect(statusFiles()).toEqual(sortedStrings(indexedIds.map((id) => `${id}.json`)));

    const validate = compileSchema('status-effect.schema.json');
    for (const [position, entry] of entries.entries()) {
      const id = indexedIds[position]!;
      const definition = expectObject(readClassJson(join(CLASS_ROOT, 'statuses', `${id}.json`)), id);
      expectSchemaValid(validate, definition, id);
      for (const field of ['id', 'name', 'category', 'type', 'tags', 'description']) {
        expect(definition[field], `${id}/${field}`).toEqual(entry[field]);
      }
    }
  });

  it('resolves every per-status capability reference against the status capability registry', () => {
    const registry = new Set(
      expectArray(readCatalog('statuses')['capabilities'], '/capabilities')
        .map((entry, index) => expectString(expectObject(entry, `/capabilities/${index}`)['id'], `/${index}/id`)),
    );
    const unresolved: string[] = [];
    const used = new Set<string>();
    for (const entry of statusEntries()) {
      const id = expectString(entry['id'], '/classes/id');
      const definition = expectObject(readClassJson(join(CLASS_ROOT, 'statuses', `${id}.json`)), id);
      for (const [index, capability] of expectArray(definition['capabilityIds'], `${id}/capabilityIds`).entries()) {
        const capabilityId = expectString(capability, `${id}/capabilityIds/${index}`);
        used.add(capabilityId);
        if (!registry.has(capabilityId)) unresolved.push(`${id}/capabilityIds/${index} -> ${capabilityId}`);
      }
    }
    expect(unresolved).toEqual([]);
    expect(sortedStrings([...registry].filter((id) => !used.has(id))), '能力登记表不得留下未被任何状态使用的条目')
      .toEqual([]);
  });

  it('keeps every status class distinguishable by form, category, capabilities and parameters', () => {
    const entries = statusEntries().map((entry) => {
      const id = expectString(entry['id'], '/classes/id');
      const definition = expectObject(readClassJson(join(CLASS_ROOT, 'statuses', `${id}.json`)), id);
      const capabilityIds = expectArray(definition['capabilityIds'], `${id}/capabilityIds`)
        .map((value, index) => expectString(value, `${id}/capabilityIds/${index}`));
      const parameters = expectArray(definition['configurableParameters'], `${id}/configurableParameters`)
        .map((value, index) => expectString(value, `${id}/configurableParameters/${index}`));
      return {
        id,
        path: `statuses/${id}.json`,
        distinguishingKey: [
          expectString(definition['type'], `${id}/type`),
          expectString(definition['category'], `${id}/category`),
          sortedStrings(capabilityIds).join(','),
          sortedStrings(parameters).join(','),
        ],
      };
    });
    expect(formatViolations(findPseudoSubtypes(entries, 'STATUS_PSEUDO_SUBTYPE'))).toEqual([]);
  });

  it('keeps engine runtime bookkeeping out of the status family', () => {
    const boundary = getRuntimeStateBoundary(readCatalog('statuses'));
    const tokens = expectArray(boundary['forbiddenConceptTokens'], '/forbiddenConceptTokens')
      .map((value, index) => expectString(value, `/forbiddenConceptTokens/${index}`));
    const entries = statusEntries().map((entry) => ({
      id: expectString(entry['id'], '/classes/id'),
      name: expectString(entry['name'], '/classes/name'),
      path: `statuses/${expectString(entry['id'], '/classes/id')}.json`,
    }));
    expect(formatViolations(findRuntimeStateDisguises(entries, tokens))).toEqual([]);
  });

  it('keeps every status class paired with exactly one play profile', () => {
    const classIds = statusEntries().map((entry) => expectString(entry['id'], '/classes/id'));
    const profileRoot = join(PLAY_PROFILE_ROOT, 'statuses');
    const profileFiles = readdirSync(profileRoot)
      .filter((name) => /^status_[a-z_]+\.json$/.test(name))
      .sort((left, right) => left.localeCompare(right, 'en'));

    expect(profileFiles).toEqual(sortedStrings(classIds.map((id) => `${id}.json`)));
    for (const file of profileFiles) {
      const profile = expectObject(readPlayProfile(join(profileRoot, file)), file);
      const id = expectString(profile['id'], `${file}/id`);
      const composition = expectObject(profile['classComposition'], `${file}/classComposition`);
      expect(file).toBe(`${id}.json`);
      expect(composition['sourceClass']).toBe(id);
    }
  });

  it('validates every damage and vulnerability record against its single-record schema', () => {
    const cases = [
      ['damage-types', 'classes', 'damage-type.schema.json'],
      ['vulnerability-types', 'classes', 'vulnerability-type.schema.json'],
    ] as const;

    for (const [dir, field, schemaName] of cases) {
      const catalog = readCatalog(dir);
      const records = expectArray(catalog[field], `/${field}`);
      const validate = compileSchema(schemaName);
      const ids = records.map((record, index) =>
        expectString(expectObject(record, `/${field}/${index}`)['id'], `/${field}/${index}/id`));
      expect(new Set(ids).size, `${dir} ids`).toBe(ids.length);
      records.forEach((record, index) => expectSchemaValid(validate, record, `${dir}/${field}/${index}`));
    }
  });
});

describe('gameplay value ownership', () => {
  it('keeps concrete gameplay fields and unclassified numbers out of class catalogs', () => {
    const violations = classJsonFiles().flatMap((path) => {
      const document = readClassJson(path);
      const sourceId = classSourceId(path);
      return [
        ...findGameplayValueKeys(document, sourceId),
        ...findUnclassifiedNumericLeaves(document, sourceId),
      ];
    });
    expect(formatViolations(violations)).toEqual([]);
  });

  it('declares which field names the play layer owns for every catalog', () => {
    const catalogs = ['actions', 'attachments', 'containers', 'damage-types', 'gateways', 'items', 'movement',
      'npcs', 'scenes', 'skills', 'statuses', 'vehicles', 'vulnerability-types', 'weapons'] as const;
    for (const dir of catalogs) {
      const contract = expectObject(readCatalog(dir)['compositionContract'], `${dir}/compositionContract`);
      const owned = expectArray(contract['playLayerOwnedFieldNames'], `${dir}/playLayerOwnedFieldNames`);
      expect(owned.length, dir).toBeGreaterThan(0);
    }
  });
});

describe('play layer references into the class layer', () => {
  it('resolves every play class/status reference against the canonical class catalogs', () => {
    const knownIds = canonicalClassIds();
    const referenceKeys = new Set([
      'behaviorClassId',
      'capabilityIds',
      'classIds',
      'damageClassId',
      'damageTypeIds',
      'sourceClass',
      'spectrumClassIds',
      'vulnerabilityTypeIds',
      'weaponClassId',
    ]);
    const unresolved: string[] = [];

    for (const file of jsonFilesUnder(PLAY_PROFILE_ROOT)) {
      const relativePath = relative(PLAY_PROFILE_ROOT, file).replaceAll('\\', '/');
      visit(readPlayProfile(file), '', (key, value, path) => {
        const references: string[] = [];
        if (referenceKeys.has(key)) {
          if (typeof value === 'string') references.push(value);
          else if (Array.isArray(value)) {
            value.forEach((entry) => {
              if (typeof entry === 'string') references.push(entry);
            });
          }
        }
        if (typeof value === 'string' && /^status_[a-z_]+$/.test(value)) references.push(value);
        for (const reference of references) {
          if (!knownIds.has(reference)) unresolved.push(`${relativePath}${path} -> ${reference}`);
        }
      });
    }
    expect(unresolved).toEqual([]);
  });

  it('uses only operation names registered by the full engine harness in every play profile', () => {
    const registeredOps = new Set(createFullHarness(defaultSeedDefs()).registry.listOpNames());
    const operationKeys = new Set(['kernelOp', 'kernelOps', 'kernelTopologyOps', 'op']);
    const unresolved: string[] = [];

    for (const file of jsonFilesUnder(PLAY_PROFILE_ROOT)) {
      const relativePath = relative(PLAY_PROFILE_ROOT, file).replaceAll('\\', '/');
      visit(readPlayProfile(file), '', (key, value, path) => {
        if (!operationKeys.has(key)) return;
        const names = typeof value === 'string'
          ? [value]
          : Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === 'string')
            : [];
        for (const name of names) {
          if (!registeredOps.has(name)) unresolved.push(`${relativePath}${path} -> ${name}`);
        }
      });
    }

    expect(unresolved).toEqual([]);
  });

  it('uses only registered operation channels and keeps each vehicle action declaration exact', () => {
    const registry = createFullHarness(defaultSeedDefs()).registry;
    const registeredOps = new Set(registry.listOpNames());
    const vehicleCatalog = readCatalog('vehicles');
    const operationChannels = getOperationChannels(vehicleCatalog);
    expect(operationChannels.filter((op) => !registeredOps.has(op))).toEqual([]);

    const mismatches: string[] = [];
    for (const file of jsonFilesUnder(join(PLAY_PROFILE_ROOT, 'vehicles'))) {
      const profile = expectObject(readPlayProfile(file), file);
      const profileId = expectString(profile['id'], `${file}/id`);
      const topologyOps = expectArray(profile['kernelTopologyOps'], `${profileId}/kernelTopologyOps`)
        .map((value, index) => expectString(value, `${profileId}/kernelTopologyOps/${index}`));
      topologyOps.forEach((op) => {
        if (!registeredOps.has(op)) mismatches.push(`${profileId}/kernelTopologyOps -> ${op}`);
      });

      const actions = expectArray(profile['grantedActions'], `${profileId}/grantedActions`);
      actions.forEach((actionValue, actionIndex) => {
        const action = expectObject(actionValue, `${profileId}/grantedActions/${actionIndex}`);
        const actionId = expectString(action['id'], `${profileId}/grantedActions/${actionIndex}/id`);
        const effectOps = expectArray(action['effects'], `${profileId}/${actionId}/effects`)
          .map((effectValue, effectIndex) => {
            const effect = expectObject(effectValue, `${profileId}/${actionId}/effects/${effectIndex}`);
            return expectString(effect['op'], `${profileId}/${actionId}/effects/${effectIndex}/op`);
          });
        const declaredOps = expectArray(action['kernelOps'], `${profileId}/${actionId}/kernelOps`)
          .map((value, index) => expectString(value, `${profileId}/${actionId}/kernelOps/${index}`));
        effectOps.forEach((op) => {
          if (!registeredOps.has(op)) mismatches.push(`${profileId}/${actionId}/effects -> ${op}`);
        });
        if (JSON.stringify(sortedStrings(new Set(effectOps))) !== JSON.stringify(sortedStrings(new Set(declaredOps)))) {
          mismatches.push(`${profileId}/${actionId}: effects=${effectOps.join(',')} kernelOps=${declaredOps.join(',')}`);
        }
      });
    }
    expect(mismatches).toEqual([]);
  });
});

describe('strict formal-data parser regression', () => {
  it('rejects duplicate members before ordinary JSON parsing can hide them', () => {
    const duplicate = '{"version":"1.0.0","version":"2.0.0"}';
    expect(() => parseClassJson(duplicate, 'duplicate.json')).toThrowError(/Duplicate object member version/);
  });
});
