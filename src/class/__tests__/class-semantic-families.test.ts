/**
 * 基类层语义族契约测试。
 *
 * 逐族核对规范要求的契约字段是否真的被声明、是否可解析、是否与引擎层与
 * `src/l2` 的规范模型常量对齐。凡是"规范要求声明某接口"的条款，这里都断言
 * 该接口存在且可被机械读取，而不是仅存在于散文说明中。
 */

import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_CLEANUP_BEHAVIORS,
  CRITERION_COMPARISONS,
  GATEWAY_KINDS,
  INTERACTION_INTENTS,
  KNOWN_SEMANTIC_FAMILY_IDS,
  MOVEMENT_TRAVERSALS,
  SCENE_SCALES,
  SKILL_ACTIVATIONS,
  STATUS_DURATION_MODES,
  STATUS_STACK_MODES,
  TARGET_KINDS,
} from '../../l2/model/family-contracts.js';
import { AI_POLICY_CATEGORIES } from '../../l2/model/family-contracts.js';
import { DIAGNOSTIC_CODES } from '../../l2/model/diagnostic-codes.js';
import { createFullHarness, defaultSeedDefs } from '../../core/kernel/testing/full-harness.js';
import { expectArray, expectObject, expectString, type JsonObject } from '../json-contract.js';
import { parseClassCatalog } from '../class-contract.js';
import { parseClassJson } from '../catalog-loader.js';
import type { ClassCatalog } from '../class-contract.js';
import {
  CATALOG_DIRS,
  CATALOG_ID_FIELDS,
  getBandAxes,
  getBehaviorClasses,
  getCategoryAxis,
  getModeSelectionContract,
  getRangeTiers,
  getSettlementContract,
  getWeightTiers,
  PLAY_PROFILE_ROOT,
  UNIFORM_CATALOG_DIRS,
  canonicalClassIds,
  catalogText,
  collectIds,
  jsonFilesUnder,
  readCatalog,
  readPlayProfile,
  readSchema,
} from './catalog-fixtures.js';

const uniformCatalogs = new Map<string, ClassCatalog>(
  UNIFORM_CATALOG_DIRS.map((dir) => [
    dir,
    parseClassCatalog(parseClassJson(catalogText(dir), `${dir}/index.json`), `${dir}/index.json`),
  ]),
);

function uniform(dir: string): ClassCatalog {
  const catalog = uniformCatalogs.get(dir);
  if (catalog === undefined) throw new Error(`${dir} is not a uniform catalog`);
  return catalog;
}

function classById(dir: string, id: string): ClassCatalog['classes'][number] {
  const entry = uniform(dir).classes.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`${dir} does not declare class ${id}`);
  return entry;
}

function valueSetTokens(dir: string, valueSetId: string): readonly string[] {
  const valueSet = uniform(dir).valueSets.find((candidate) => candidate.id === valueSetId);
  if (valueSet === undefined) throw new Error(`${dir} does not declare value set ${valueSetId}`);
  return valueSet.tokenIds;
}

function entries(root: JsonObject, field: string): readonly JsonObject[] {
  return expectArray(root[field], `/${field}`).map((entry, index) =>
    expectObject(entry, `/${field}/${index}`));
}

function entryById(root: JsonObject, field: string, id: string): JsonObject {
  const found = entries(root, field).find((entry) => entry['id'] === id);
  if (found === undefined) throw new Error(`/${field} does not declare ${id}`);
  return found;
}

function stringArray(root: JsonObject, field: string): readonly string[] {
  return expectArray(root[field], `/${field}`).map((value, index) => expectString(value, `/${field}/${index}`));
}

describe('semantic family registration', () => {
  it('registers every known semantic family in at least one class catalog', () => {
    const declared = new Set<string>();
    for (const dir of CATALOG_DIRS) {
      for (const family of stringArray(readCatalog(dir), 'semanticFamilies')) declared.add(family);
    }
    const missing = KNOWN_SEMANTIC_FAMILY_IDS.filter((family) => !declared.has(family));
    expect(missing, '每个已登记语义族都必须有对应的基类层目录').toEqual([]);
  });

  it('keeps every declared family either known or accompanied by classification evidence', () => {
    const known = new Set<string>(KNOWN_SEMANTIC_FAMILY_IDS);
    for (const dir of CATALOG_DIRS) {
      const root = readCatalog(dir);
      const evidence = expectObject(root['classificationEvidence'], `${dir}/classificationEvidence`);
      for (const family of stringArray(root, 'semanticFamilies')) {
        if (known.has(family)) continue;
        // 新族必须保存三判据理由：这是登记新语义族的唯一入口。
        expect(evidence['enumerable'], `${dir}:${family}`).toBe(true);
        expect(evidence['composable'], `${dir}:${family}`).toBe(true);
        expect(evidence['gameplayIndependent'], `${dir}:${family}`).toBe(true);
        expect(String(evidence['independenceRationale']).length, `${dir}:${family}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every catalog conformant to the shared metadata schema', () => {
    const ajv = new Ajv({ allErrors: true });
    ajv.addSchema(readSchema('class-catalog.schema.json') as object);
    const validate = ajv.compile(readSchema('catalog-metadata.schema.json') as object);
    for (const dir of CATALOG_DIRS) {
      const valid = validate(readCatalog(dir));
      expect(valid, `${dir}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('keeps every uniform catalog conformant to the uniform catalog schema', () => {
    const validate = new Ajv({ allErrors: true }).compile(readSchema('class-catalog.schema.json') as object);
    for (const dir of UNIFORM_CATALOG_DIRS) {
      const valid = validate(readCatalog(dir));
      expect(valid, `${dir}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('keeps every catalog identifier globally unique and every id field declared', () => {
    expect(new Set(CATALOG_ID_FIELDS.keys())).toEqual(new Set(CATALOG_DIRS));
    expect(canonicalClassIds().size).toBeGreaterThan(0);
  });

  it('cites only stable diagnostic codes in prohibitions', () => {
    const stable = new Set<string>(Object.values(DIAGNOSTIC_CODES));
    const unknown: string[] = [];
    for (const dir of CATALOG_DIRS) {
      for (const prohibition of entries(readCatalog(dir), 'prohibitions')) {
        const code = expectString(prohibition['diagnosticCode'], `${dir}/prohibitions/diagnosticCode`);
        if (!stable.has(code)) unknown.push(`${dir}: ${code}`);
      }
    }
    expect(unknown, '禁止项引用的诊断代码必须来自稳定代码目录').toEqual([]);
  });

  it('references only engine operations that the full harness registers', () => {
    const registered = new Set(createFullHarness(defaultSeedDefs()).registry.listOpNames());
    const unresolved: string[] = [];
    for (const dir of UNIFORM_CATALOG_DIRS) {
      for (const use of uniform(dir).kernelOpUses) {
        if (!registered.has(use.op)) unresolved.push(`${use.path} -> ${use.op}`);
      }
    }
    for (const dir of ['statuses', 'vehicles']) {
      const root = readCatalog(dir);
      for (const [index, capability] of entries(root, 'capabilities').entries()) {
        const ops = capability['kernelOps'];
        if (ops === undefined) continue;
        for (const [opIndex, op] of expectArray(ops, `${dir}/capabilities/${index}/kernelOps`).entries()) {
          const name = expectString(op, `${dir}/capabilities/${index}/kernelOps/${opIndex}`);
          if (!registered.has(name)) unresolved.push(`${dir}/capabilities/${index}/kernelOps/${opIndex} -> ${name}`);
        }
      }
      const channels = root['operationChannels'];
      if (channels === undefined) continue;
      for (const [index, channel] of expectArray(channels, `${dir}/operationChannels`).entries()) {
        const name = expectString(channel, `${dir}/operationChannels/${index}`);
        if (!registered.has(name)) unresolved.push(`${dir}/operationChannels/${index} -> ${name}`);
      }
    }
    expect(unresolved).toEqual([]);
  });
});

describe('action family and the three gateways', () => {
  it('declares paid and attached cost categories with their action-point structural bounds', () => {
    const paid = classById('actions', 'action.class.paid');
    const attached = classById('actions', 'action.class.attached');
    expect(valueSetTokens('actions', 'action.valueset.cost_categories')).toEqual(['paid', 'attached']);

    const bounds = new Map(uniform('actions').structuralBounds.map((bound) => [bound.id, bound]));
    const paidBound = bounds.get('structural-bound.action.paid_ap_unit');
    const attachedBound = bounds.get('structural-bound.action.attached_ap_unit');
    expect(paidBound?.value).toBe(1);
    expect(attachedBound?.value).toBe(0);
    expect(paidBound?.classification).toBe('Structural_Bound');
    expect(paidBound?.structuralRationale.length ?? 0).toBeGreaterThan(0);
    expect(paid.structuralBoundRefs).toEqual(['structural-bound.action.paid_ap_unit']);
    expect(attached.structuralBoundRefs).toEqual(['structural-bound.action.attached_ap_unit']);
  });

  it('requires the attached action to bind a host paid action and forbids it as a decision branch', () => {
    const attached = classById('actions', 'action.class.attached');
    expect(attached.requiredCapabilityIds).toContain('action.capability.host_binding');
    expect(attached.parameterKeys).toContain('hostActionRef');
    expect(attached.parameterKeys).toContain('availableAsDecisionBranch');

    const paid = classById('actions', 'action.class.paid');
    expect(paid.requiredCapabilityIds).not.toContain('action.capability.host_binding');
    expect(paid.typeIdentityBasis).toBe('substitution-compatibility');
  });

  it('expresses a multi-step paid interaction as an ordered sequence with an intermediate status', () => {
    const sequence = uniform('actions').capabilities
      .find((capability) => capability.id === 'action.capability.multi_step_sequence');
    expect(sequence?.parameters.map((parameter) => parameter.key)).toEqual([
      'steps',
      'steps.stepId',
      'steps.actionRef',
      'steps.intermediateStatusRef',
    ]);
    const codes = uniform('actions').prohibitions.map((prohibition) => prohibition.diagnosticCode);
    expect(codes).toContain(DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST);
    expect(codes).toContain(DIAGNOSTIC_CODES.ACTION_ATTACHED_AS_DECISION_BRANCH);
  });

  it('declares action target kinds and interaction intents exactly as the spec model does', () => {
    expect(valueSetTokens('actions', 'action.valueset.target_kinds')).toEqual([...TARGET_KINDS]);
    expect(valueSetTokens('actions', 'action.valueset.interaction_intents')).toEqual([...INTERACTION_INTENTS]);
  });

  it('no longer declares an attack-shape value set (2026-08-08 权威变更：攻击形状已废止)', () => {
    // 攻击形状（single-target/spread/area 三选一形状轴）判定为冗余设计，已被武器属性
    // （散射/扫射/连发）完全覆盖。详见 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3。
    const root = readCatalog('actions');
    const valueSetIds = entries(root, 'valueSets').map((entry) => entry['id']);
    expect(valueSetIds).not.toContain('action.valueset.attack_shapes');

    const presentation = entryById(root, 'capabilities', 'action.capability.presentation_semantics');
    const parameterKeys = entries(presentation, 'parameters').map((parameter) => parameter['key']);
    expect(parameterKeys).not.toContain('attackShape');
  });

  it('routes any action write through the single write channel and declares no alternate channel', () => {
    const mapping = readCatalog('actions');
    const capability = entryById(mapping, 'capabilities', 'action.capability.op_mapping');
    const contract = expectObject(capability['writeChannelContract'], '/writeChannelContract');
    expect(contract['channel']).toBe('OpRegistry.invoke');
    expect(contract['alternateChannels']).toBe('none');
  });

  it('gives the three gateways distinct, mutually non-subsuming required capability sets', () => {
    const gateways = uniform('gateways').classes;
    expect(gateways.map((entry) => entry.id)).toEqual([
      'gateway.class.resource_conversion',
      'gateway.class.check',
      'gateway.class.condition',
    ]);
    const kinds = entries(readCatalog('gateways'), 'classes')
      .map((entry) => expectString(entry['gatewayKind'], '/gatewayKind'));
    expect(kinds).toEqual([...GATEWAY_KINDS]);

    for (const left of gateways) {
      for (const right of gateways) {
        if (left.id === right.id) continue;
        const leftSet = new Set(left.requiredCapabilityIds);
        const rightSet = new Set(right.requiredCapabilityIds);
        const leftSubsumesRight = [...rightSet].every((id) => leftSet.has(id));
        expect(leftSubsumesRight, `${left.id} 不得包含 ${right.id} 的全部必需能力`).toBe(false);
      }
    }
  });

  it('binds the check gateway to an engine random primitive and keeps the condition gateway deterministic', () => {
    const check = classById('gateways', 'gateway.class.check');
    const condition = classById('gateways', 'gateway.class.condition');
    const conversion = classById('gateways', 'gateway.class.resource_conversion');

    expect(check.requiredCapabilityIds).toContain('gateway.capability.random_primitive_binding');
    expect(check.parameterKeys).toContain('criterion.thresholdField');
    expect(check.kernelOps.length).toBeGreaterThan(0);

    expect(condition.requiredCapabilityIds).toContain('gateway.capability.boolean_condition_binding');
    expect(condition.requiredCapabilityIds).not.toContain('gateway.capability.random_primitive_binding');
    expect(condition.kernelOps).toEqual([]);

    expect(conversion.requiredCapabilityIds).toContain('gateway.capability.deterministic_resolution');
    expect(conversion.parameterKeys).toContain('deterministicSuccess');
    expect(conversion.requiredCapabilityIds).not.toContain('gateway.capability.failure_effect_output');
  });

  it('declares the criterion comparisons without embedding any threshold', () => {
    expect(valueSetTokens('gateways', 'gateway.valueset.criterion_comparisons')).toEqual([...CRITERION_COMPARISONS]);
    const codes = uniform('gateways').prohibitions.map((prohibition) => prohibition.diagnosticCode);
    expect(codes).toContain(DIAGNOSTIC_CODES.GATEWAY_CONCRETE_THRESHOLD);
    expect(codes).toContain(DIAGNOSTIC_CODES.GATEWAY_NAMED_GAMEPLAY_ENTITY);
    expect(uniform('gateways').structuralBounds).toEqual([]);
  });

  it('requires every gateway to reject without applying effects when its condition fails', () => {
    for (const entry of uniform('gateways').classes) {
      expect(entry.requiredCapabilityIds, entry.id).toContain('gateway.capability.failure_rejection');
    }
  });
});

describe('natural scenes, micro scenes and transitions', () => {
  const scenes = readCatalog('scenes');

  it('distinguishes the three natural scene scales without creating map nodes', () => {
    const naturalScenes = entries(scenes, 'classes')
      .filter((entry) => entry['semanticFamily'] === 'natural-scene');
    expect(naturalScenes.map((entry) => expectString(entry['sceneScale'], '/sceneScale')))
      .toEqual([...SCENE_SCALES]);
    expect(valueSetTokens('scenes', 'scene.valueset.scene_scales')).toEqual([...SCENE_SCALES]);
    for (const entry of naturalScenes) {
      expect(entry['concreteMapNodeIds'], String(entry['id'])).toBeUndefined();
    }
  });

  it('lets every scene scale parent micro scenes and reserves the shared capability for the small scene', () => {
    // docs/L2_基类层/03_空间系统.md「微型场景的三种创建者」：活体在**大/中场景**移动到空旷地时创建
    // 个人微型场景；过渡连接在其两侧天然场景各创建一个；小场景自带一个共享的。因此三档都能作父级。
    // 若只允许小场景作父级，大/中场景的「找到」（D-046 的 1 AP）就没有承载物，2 AP 处决锚点会失效。
    const large = classById('scenes', 'scene.class.large');
    const medium = classById('scenes', 'scene.class.medium');
    const small = classById('scenes', 'scene.class.small');

    for (const entry of [large, medium, small]) {
      expect(entry.requiredCapabilityIds, entry.id).toContain('scene.capability.micro_scene_parenthood');
      expect(entryById(scenes, 'classes', entry.id)['admitsMicroScene'], entry.id).toBe(true);
    }

    // 共享微型场景只属于小场景；个人空旷地只属于大/中场景。两者互补且不重叠。
    expect(small.requiredCapabilityIds).toContain('scene.capability.shared_micro_scene');
    expect(small.requiredCapabilityIds).not.toContain('scene.capability.personal_vacant_ground');
    for (const entry of [large, medium]) {
      expect(entry.requiredCapabilityIds, entry.id).not.toContain('scene.capability.shared_micro_scene');
      expect(entry.requiredCapabilityIds, entry.id).toContain('scene.capability.personal_vacant_ground');
    }

    // 距离权重是大场景独有的必需能力，它承担 03 号文档距离公式里大场景的加权计量。
    expect(large.requiredCapabilityIds).toContain('scene.capability.traversal_weight');
    for (const entry of [medium, small]) {
      expect(entry.requiredCapabilityIds, entry.id).not.toContain('scene.capability.traversal_weight');
    }
  });

  it('keeps natural-scene nesting an authoring-only input that never reaches the runtime parent field', () => {
    // 引擎层用节点附属字段非空判定「是否微型场景」（makeEntityPlace / onMicroSceneOccupantsChanged）。
    // 若天然场景之间的层级被编译进同一字段，最后一名占用者离开时天然场景会被按微型场景回收，
    // 并级联销毁其子节点与关联连接。因此层级只能是编排期可选输入。
    for (const scale of SCENE_SCALES) {
      const entry = classById('scenes', `scene.class.${scale}`);
      const parameters = entries(entryById(scenes, 'classes', entry.id), 'parameters');
      for (const parameter of parameters) {
        const key = expectString(parameter['key'], '/key');
        if (key !== 'parentSceneRef' && key !== 'childSceneRefs') continue;
        expect(parameter['required'], `${entry.id}/${key}`).toBe(false);
      }
    }
    const codes = uniform('scenes').prohibitions.map((prohibition) => prohibition.diagnosticCode);
    expect(codes).toContain(DIAGNOSTIC_CODES.LAYER_L1_OWNERSHIP);
  });

  it('excludes personal vacant-ground micro scenes from the shared micro scene capability', () => {
    const small = entryById(scenes, 'classes', 'scene.class.small');
    expect(stringArray(small, 'excludedMicroSceneKinds')).toContain('personal-vacant-ground');
    const codes = uniform('scenes').prohibitions.map((prohibition) => prohibition.diagnosticCode);
    expect(codes).toContain(DIAGNOSTIC_CODES.SPACE_SMALL_SCENE_PERSONAL_VACANT_GROUND);
  });

  it('gives the micro scene exactly one natural scene parent and keeps creator provenance immutable', () => {
    const micro = entryById(scenes, 'classes', 'micro-scene.class.contact');
    expect(micro['parentCardinalityBoundId']).toBe('structural-bound.micro_scene.parent_cardinality');
    expect(stringArray(micro, 'admittedParentSceneScales')).toEqual([...SCENE_SCALES]);
    expect(stringArray(micro, 'lifecycleDeterminants')).toEqual(['valid-parent', 'occupancy']);
    expect(stringArray(micro, 'forbiddenFieldNames')).toEqual(['owner', 'ownerId', 'ownedBy']);

    const bound = uniform('scenes').structuralBounds
      .find((candidate) => candidate.id === 'structural-bound.micro_scene.parent_cardinality');
    expect(bound?.value).toBe(1);
    expect(bound?.authoritativeSourceFile).toBe('docs/L0_规范宪法.md');

    const provenance = entryById(scenes, 'capabilities', 'scene.capability.creator_provenance');
    const parameters = entries(provenance, 'parameters').map((parameter) => expectString(parameter['key'], '/key'));
    expect(parameters).toEqual(['creatorEntityRef', 'immutable']);
    expect(valueSetTokens('scenes', 'scene.valueset.lifecycle_determinants')).toEqual(['valid-parent', 'occupancy']);
  });

  it('requires parent removal to resolve every child through an engine lifecycle operation', () => {
    const parenthood = entryById(scenes, 'capabilities', 'scene.capability.micro_scene_parenthood');
    const keys = entries(parenthood, 'parameters').map((parameter) => expectString(parameter['key'], '/key'));
    expect(keys).toContain('removalChildResolution');
    expect(valueSetTokens('scenes', 'scene.valueset.child_resolution_modes'))
      .toEqual(['destroy-children', 'redirect-parent']);
    const codes = uniform('scenes').prohibitions.map((prohibition) => prohibition.diagnosticCode);
    expect(codes).toContain(DIAGNOSTIC_CODES.SPACE_PARENT_REMOVAL_ORPHANS_CHILD);
  });

  it('treats transition directionality as a parameter instead of a subtype', () => {
    const transitions = entries(scenes, 'classes').filter((entry) => entry['semanticFamily'] === 'transition');
    expect(transitions).toHaveLength(1);
    const transition = classById('scenes', 'transition.class.scene_link');
    expect(transition.parameterKeys).toContain('directionality');
    expect(transition.parameterKeys).toContain('endpoints');
    expect(transition.parameterKeys).toContain('traversalConditionRefs');
    expect(transition.parameterKeys).toContain('blockingCapabilityRefs');
    expect(valueSetTokens('scenes', 'scene.valueset.transition_directionalities'))
      .toEqual(['bidirectional', 'unidirectional']);

    const endpointBound = uniform('scenes').structuralBounds
      .find((candidate) => candidate.id === 'structural-bound.transition.endpoint_count');
    expect(endpointBound?.value).toBe(2);
  });

  it('classifies the node connection limit as a sourced structural bound rather than a map value', () => {
    // 基类层只登记五并列给出的天花板 5；03 号文档按尺度收紧到 5/4/3 的那张更严的表属于地图编排
    // 规则，落在玩法层 `src/play/map/types.ts` 的 CONNECTION_LIMIT 并由 validateMapStructure 强制。
    // 两层分工是有意的：基类层的边界必须有 L0 来源，而 4 与 3 只有 03 号文档支撑。
    const bound = uniform('scenes').structuralBounds
      .find((candidate) => candidate.id === 'structural-bound.scene.connection_limit');
    expect(bound?.value).toBe(5);
    expect(bound?.classification).toBe('Structural_Bound');
    expect(bound?.precedence).toBe('l0-constitution');
    expect(bound?.authoritativeSourceSection).toContain('五并列原则');
    for (const scale of SCENE_SCALES) {
      const entry = entryById(scenes, 'classes', `scene.class.${scale}`);
      expect(entry['connectionBoundId'], scale).toBe('structural-bound.scene.connection_limit');
    }
  });

  // 「玩法层按尺度收紧到 5/4/3 且不超过该天花板」这一层关系断言放在玩法层
  // （src/play/map/__tests__/connection-limit-layering.test.ts）：基类层不得依赖玩法层。

  it('keeps the vehicle out of the micro scene family and keeps Q-04 unresolved', () => {
    const codes = uniform('scenes').prohibitions.map((prohibition) => prohibition.diagnosticCode);
    expect(codes).toContain(DIAGNOSTIC_CODES.VEHICLE_NOT_ENTITY);
    expect(uniform('scenes').unresolvedItems.map((item) => item.awaitingDecisionId)).toEqual(['Q-04']);
  });
});

describe('items, weapons, armor and vehicles', () => {
  const weapons = readCatalog('weapons');
  const items = readCatalog('items');
  const vehicles = readCatalog('vehicles');

  it('distinguishes melee, non-firearm ranged and firearm type identities', () => {
    // W2 统一信封:武器类与伤害结算类都收在 weapons.classes。这里只取三个武器类,不包含 damage-class。
    const ids = collectIds(weapons, ['classes']);
    const weaponClassIds = ids.filter((id) => id.startsWith('weapon-class.'));
    expect(weaponClassIds).toEqual([
      'weapon-class.melee',
      'weapon-class.ranged_nonfirearm',
      'weapon-class.firearm',
    ]);
    const firearm = entryById(weapons, 'classes', 'weapon-class.firearm');
    const melee = entryById(weapons, 'classes', 'weapon-class.melee');
    expect(stringArray(firearm, 'requiredCapabilityIds')).toContain('weapon.capability.ammunition_binding');
    expect(stringArray(melee, 'requiredCapabilityIds')).not.toContain('weapon.capability.ammunition_binding');
    // 弹药需求由 typeIdentity.statement 表达(不是布尔字段 requiresAmmunition,已在 W2 删除)。
    const firearmType = expectObject(firearm['typeIdentity'], '/typeIdentity');
    const meleeType = expectObject(melee['typeIdentity'], '/typeIdentity');
    expect(String(meleeType['statement'])).not.toBe(String(firearmType['statement']));
  });

  it('no longer declares a shape axis, spectrum classes or attack-shape composition (2026-08-08 权威变更)', () => {
    // 攻击形状/形状轴（single/scatter/area 三选一强制分类）判定为冗余设计，已被武器属性
    // （散射/扫射/连发）完全覆盖。详见 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3。
    expect(weapons['spectrumClasses']).toBeUndefined();
    expect(weapons['spectrumAxes']).toBeUndefined();

    const capabilityIds = new Set(collectIds(weapons, ['capabilities']));
    expect(capabilityIds.has('weapon.capability.attack_shape_composition')).toBe(false);
    // D-071:三个空参数占位能力(scatter/sweep/burst_attribute)已被 6 个战术能力替代。
    expect(capabilityIds.has('weapon.capability.scatter_attribute')).toBe(false);
    expect(capabilityIds.has('weapon.capability.sweep_attribute')).toBe(false);
    expect(capabilityIds.has('weapon.capability.burst_attribute')).toBe(false);
    expect(capabilityIds.has('weapon.capability.scatter_shot')).toBe(true);
    expect(capabilityIds.has('weapon.capability.assault_advance')).toBe(true);
  });

  it('lets carrying-capacity and burst attributes carry no fixed target-count parameter', () => {
    // 散射由 battle map 的天然拓扑约束(宪法五并列原则连接数 ≤5),不是武器自带的玩法数值,
    // 因此不需要固定目标上限参数。这里断言散射与连发承载能力不携带 maxTargets。
    const targetLimitKeys = entries(entryById(weapons, 'capabilities', 'weapon.capability.target_limit'), 'parameters')
      .map((parameter) => parameter['key']);
    expect(targetLimitKeys).toEqual(['maxTargetsField']);

    // D-071:散射语义收在 scatter_shot 战术能力,它是命中面(非固定人数)输入,不应声明固定目标参数字段。
    const scatter = entryById(weapons, 'capabilities', 'weapon.capability.scatter_shot');
    for (const parameter of entries(scatter, 'parameters')) {
      expect(String(parameter['key']), '散射能力不得声明固定目标上限参数').not.toMatch(/max_target|targetCount/i);
    }
  });

  it('keeps weight and range bands as composition inputs instead of weapon subtypes', () => {
    // W2 统一信封:负重档/射程档收在 weapons.valueSets。档位是组合输入(经 handling_profile / range_profile
    // 能力组合),不是武器类;鉴别方式是档位 id 不再落在武器类的 classes 里。
    const weaponClassIds = new Set(collectIds(weapons, ['classes']));
    for (const valueSetId of ['weapon.valueset.weight_tiers', 'weapon.valueset.range_tiers']) {
      const tokens = entries(entryById(weapons, 'valueSets', valueSetId), 'tokens');
      for (const tier of tokens) {
        const id = expectString(tier['id'], '/id');
        expect(weaponClassIds.has(id), id).toBe(false);
        expect(String(expectObject(tier, '/tier')['description']).length).toBeGreaterThan(0);
      }
    }
    // 档位与持有者之间的衔接落在两个组合能力上,而不是把档位定义成武器子类。
    for (const capabilityId of [
      'weapon.capability.handling_profile',
      'weapon.capability.range_profile',
    ]) {
      expect(entryById(weapons, 'capabilities', capabilityId), capabilityId).toBeDefined();
    }
  });

  it('keeps the play layer band tokens resolvable against the declared band tiers', () => {
    // W2:档位 token 由 capability 参数引用(weightTierId/rangeTierId)承载,取代旧的顶层 bandAxes/tierField 结构。
    const tierTokenIds = new Map([
      ['weapon.valueset.weight_tiers', 'weightTierId'],
      ['weapon.valueset.range_tiers', 'rangeTierId'],
    ]);
    const acceptedByField = new Map<string, ReadonlySet<string>>();
    for (const [valueSetId, capabilityParam] of tierTokenIds) {
      const tokens = entries(entryById(weapons, 'valueSets', valueSetId), 'tokens');
      acceptedByField.set(capabilityParam, new Set(tokens.map((tier) => expectString(tier['id'], '/id'))));
    }
    const unresolved: string[] = [];
    for (const file of jsonFilesUnder(join(PLAY_PROFILE_ROOT, 'weapons'))) {
      const profile = expectObject(readPlayProfile(file), file);
      const classComposition = expectObject(profile['classComposition'], `${file}/classComposition`);
      const weaponParameters = profile['weaponParameters'];
      if (weaponParameters === undefined) continue;
      const params = expectObject(weaponParameters, `${file}/weaponParameters`);
      const handling = params['weapon.capability.handling_profile'];
      if (handling !== undefined) {
        const token = expectString(expectObject(handling, '/handling_profile')['weightTierId'], '/weightTierId');
        const accepted = acceptedByField.get('weightTierId') ?? new Set<string>();
        if (!accepted.has(token)) unresolved.push(`${file}/weaponParameters/handling_profile/weightTierId -> ${token}`);
      }
      const range = params['weapon.capability.range_profile'];
      if (range !== undefined) {
        const token = expectString(expectObject(range, '/range_profile')['rangeTierId'], '/rangeTierId');
        const accepted = acceptedByField.get('rangeTierId') ?? new Set<string>();
        if (!accepted.has(token)) unresolved.push(`${file}/weaponParameters/range_profile/rangeTierId -> ${token}`);
      }
    }
    expect(unresolved, '玩法层档位取值必须能解析到基类层声明的档位值集').toEqual([]);
  });

  it('exposes armor through composition of the equipment class and the armor capability', () => {
    const classIds = new Set(collectIds(items, ['classes']));
    expect(classIds.has('item.class.equipment')).toBe(true);
    expect([...classIds].some((id) => id.includes('armor'))).toBe(false);

    const armor = entryById(items, 'capabilities', 'item.capability.armor');
    const keys = entries(armor, 'parameters').map((parameter) => expectString(parameter['key'], '/key'));
    expect(keys).toContain('mitigationRule');
    expect(keys).toContain('breakCondition');
    expect(keys).toContain('slotRequirementRef');

    const equipment = classById('items', 'item.class.equipment');
    expect(equipment.parameterKeys).toContain('slotRequirements');
    expect(equipment.parameterKeys).toContain('slotRequirements.slotRef');
    expect(equipment.parameterKeys).toContain('equipRequirements');
    expect(equipment.optionalCapabilityIds).toContain('item.capability.armor');
  });

  it('exposes consumable use location, effect references and consumption behaviour', () => {
    const consumable = classById('items', 'item.class.consumable');
    expect(consumable.parameterKeys).toContain('useLocation');
    expect(consumable.parameterKeys).toContain('effectRefs');
    expect(consumable.parameterKeys).toContain('consumptionBehavior');
    expect(valueSetTokens('items', 'item.valueset.use_locations'))
      .toEqual(['self', 'adjacent', 'ranged', 'micro-scene']);
    expect(valueSetTokens('items', 'item.valueset.consumption_behaviors'))
      .toEqual(['consume-on-use', 'charges', 'persistent']);
  });

  it('closes the ammunition, accessory, container and heavy-tag composition references', () => {
    const known = canonicalClassIds();
    const ammunition = classById('items', 'item.class.ammunition');
    expect(ammunition.requiredCapabilityIds).toEqual(['item.capability.ammunition_supply']);
    expect(known.has('item.capability.ammunition_supply')).toBe(true);

    const accessory = classById('items', 'item.class.attachment');
    expect(accessory.requiredCapabilityIds).toEqual(['item.capability.accessory_mount']);
    expect(accessory.parameterKeys).toContain('acceptedHostClassIds');
    expect(accessory.parameterKeys).toContain('typeDefining');

    const weaponAmmunition = entryById(weapons, 'capabilities', 'weapon.capability.ammunition_binding');
    const ammunitionKeys = entries(weaponAmmunition, 'parameters')
      .map((parameter) => expectString(parameter['key'], '/key'));
    expect(ammunitionKeys).toContain('ammunitionClassId');

    const heavyTag = entryById(items, 'capabilities', 'item.capability.heavy_tag_aggregation');
    const heavyKeys = entries(heavyTag, 'parameters').map((parameter) => expectString(parameter['key'], '/key'));
    expect(heavyKeys).toEqual(['tag', 'queryRef', 'relationRef', 'aggregationChannel']);
    expect(valueSetTokens('items', 'item.valueset.aggregation_channels')).toEqual(['l1-query-relation']);

    const deathContainer = entryById(items, 'capabilities', 'item.capability.death_container_binding');
    const deathKeys = entries(deathContainer, 'parameters').map((parameter) => expectString(parameter['key'], '/key'));
    expect(deathKeys).toEqual(['containerRef', 'depositEnabled', 'contentSource']);
    expect(valueSetTokens('containers', 'container.valueset.content_sources'))
      .toContain('deceased-entity-transaction');
    const depositDisabled = uniform('containers').capabilities
      .find((capability) => capability.id === 'container.capability.deposit_disabled');
    expect(depositDisabled?.mutuallyExclusiveWith).toEqual(['container.capability.deposit']);
  });

  it('models the vehicle as an entity with stable door identifiers', () => {
    expect(vehicles['entityBacked']).toBe(true);
    const land = entryById(vehicles, 'classes', 'vehicle.class.land');
    expect(land['defKind']).toBe('entity');

    const doors = entryById(vehicles, 'capabilities', 'vehicle.capability.door_addressing');
    expect(doors['identifierStability']).toBe('stable-within-resolved-definition');
    expect(doors['configurableParameters']).toBeDefined();
    const seats = entryById(vehicles, 'capabilities', 'vehicle.capability.seat_binding');
    expect(seats['identifierStability']).toBe('stable-within-resolved-definition');
  });

  it('keeps vehicle adjacency and door-specific targeting as separate composition inputs', () => {
    const contract = expectObject(vehicles['interactionSeparationContract'], '/interactionSeparationContract');
    const adjacencyId = expectString(contract['adjacencyCapabilityId'], '/adjacencyCapabilityId');
    const doorTargetId = expectString(contract['doorTargetCapabilityId'], '/doorTargetCapabilityId');
    expect(adjacencyId).not.toBe(doorTargetId);
    expect(contract['separation']).toBe('independent-composition-inputs');
    expect(contract['d030PolicyOwnership']).toBe('玩法层');

    const adjacency = entryById(vehicles, 'capabilities', adjacencyId);
    const doorTarget = entryById(vehicles, 'capabilities', doorTargetId);
    expect(stringArray(adjacency, 'separatedFrom')).toEqual([doorTargetId]);
    expect(stringArray(doorTarget, 'separatedFrom')).toEqual([adjacencyId]);
    expect(stringArray(adjacency, 'configurableParameters').some((name) => name.startsWith('door'))).toBe(false);
    expect(stringArray(doorTarget, 'configurableParameters').some((name) => name.startsWith('adjacency')))
      .toBe(false);
    expect(stringArray(doorTarget, 'requiresCapabilityIds')).toEqual(['vehicle.capability.door_addressing']);
  });

  it('keeps every play-layer vehicle profile conformant to the required capability set', () => {
    const land = entryById(vehicles, 'classes', 'vehicle.class.land');
    const required = stringArray(land, 'requiredCapabilityIds');
    const permitted = new Set([...required, ...stringArray(land, 'optionalCapabilityIds')]);
    const violations: string[] = [];
    for (const file of jsonFilesUnder(join(PLAY_PROFILE_ROOT, 'vehicles'))) {
      const profile = expectObject(readPlayProfile(file), file);
      const composition = expectObject(profile['classComposition'], `${file}/classComposition`);
      const declared = stringArray(composition, 'capabilityIds');
      for (const capability of required) {
        if (!declared.includes(capability)) violations.push(`${file} missing ${capability}`);
      }
      for (const capability of declared) {
        if (!permitted.has(capability)) violations.push(`${file} uses undeclared ${capability}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps every play-layer item capability inside the permitted set of its declared classes', () => {
    const permittedByClass = new Map<string, ReadonlySet<string>>(
      uniform('items').classes.map((entry) => [
        entry.id,
        new Set([...entry.requiredCapabilityIds, ...entry.optionalCapabilityIds]),
      ]),
    );
    const violations: string[] = [];
    for (const file of jsonFilesUnder(join(PLAY_PROFILE_ROOT, 'items'))) {
      const profile = expectObject(readPlayProfile(file), file);
      const composition = expectObject(profile['classComposition'], `${file}/classComposition`);
      const classIds = stringArray(composition, 'classIds');
      const permitted = new Set(classIds.flatMap((id) => [...(permittedByClass.get(id) ?? [])]));
      for (const id of classIds) {
        if (!permittedByClass.has(id)) violations.push(`${file} unknown class ${id}`);
      }
      for (const capability of stringArray(composition, 'capabilityIds')) {
        if (!permitted.has(capability)) violations.push(`${file} capability ${capability} not permitted`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps Q-01, Q-02, Q-03 and Q-05 unresolved instead of deciding them here', () => {
    expect(collectIds(weapons, ['unresolvedItems'])).toEqual(['Q-01', 'Q-02', 'Q-03']);
    expect(collectIds(items, ['unresolvedItems'])).toEqual(['Q-05']);
    expect(collectIds(vehicles, ['unresolvedItems'])).toEqual(['Q-04']);
    expect(uniform('actions').unresolvedItems.map((item) => item.id)).toEqual(['Q-02']);
  });
});

describe('damage, status, skill, movement and attachment families', () => {
  const damage = readCatalog('damage-types');
  const vulnerability = readCatalog('vulnerability-types');
  const statuses = readCatalog('statuses');

  it('declares damage source, target and settlement references without assigning an amount', () => {
    const contract = expectObject(damage['settlementContract'], '/settlementContract');
    expect(contract['sourceRequirementField']).toBe('sourceRequirements');
    expect(contract['targetRequirementField']).toBe('targetRequirements');
    expect(contract['settlementPipelineReferenceField']).toBe('settlementPipelineRefs');
    expect(contract['amountOwnership']).toBe('玩法层');
    for (const record of entries(damage, 'damageTypes')) {
      expect(record['amount'], String(record['id'])).toBeUndefined();
    }
  });

  it('keeps the damage category axis and the damage settlement axis disjoint', () => {
    const categoryIds = new Set(collectIds(damage, ['damageTypes']));
    // W2 统一信封:伤害结算类(damage-class.*)收在 weapons.classes,不再是顶层 damageClasses。
    const deliveryIds = new Set(collectIds(readCatalog('weapons'), ['classes'])
      .filter((id) => id.startsWith('damage-class.')));
    expect([...categoryIds].some((id) => deliveryIds.has(id))).toBe(false);
    for (const record of entries(damage, 'damageTypes')) expect(record['axis']).toBe('category');
    // 结算语义类通过 damage_reference 能力把类别组合入口暴露给玩法层,而不是携带 axis。
    for (const id of [...deliveryIds]) {
      expect(id, `伤害结算类 ${id} 仍是独立的 damage-class 标识`).toMatch(/^damage-class\./);
    }
    const capabilityIds = new Set(collectIds(readCatalog('weapons'), ['capabilities']));
    expect(capabilityIds.has('weapon.capability.damage_reference')).toBe(true);
  });

  it('keeps damage and vulnerability numbering independent and extensible', () => {
    // W2 统一信封:弱点编号收在 vulnerabilityTypes,不再是 classes;同样计数 10。
    expect(new Set(collectIds(vulnerability, ['vulnerabilityTypes'])).size).toBe(10);
    for (const catalog of [damage, vulnerability]) {
      const axis = expectObject(catalog['categoryAxis'], '/categoryAxis');
      expect(axis['extensible']).toBe(true);
      expect(String(axis['extensionRule']).length).toBeGreaterThan(0);
    }
    const damageSchema = expectObject(readSchema('damage-type.schema.json'), 'damage-type.schema.json');
    const pattern = expectString(
      expectObject(expectObject(damageSchema['properties'], '/properties')['id'], '/id')['pattern'],
      '/pattern',
    );
    // 标识格式不得隐含条目数量上限：DMG_11 之类的扩展必须被格式接受。
    expect(new RegExp(pattern).test('DMG_11')).toBe(true);
    expect(new RegExp(pattern).test('DMG_1')).toBe(false);
  });

  it('declares the status duration and stack mode axes with the spec model vocabulary', () => {
    const durationTokens = entries(statuses, 'valueSets')
      .find((set) => set['id'] === 'status.valueset.duration_modes');
    const stackTokens = entries(statuses, 'valueSets')
      .find((set) => set['id'] === 'status.valueset.stack_modes');
    expect(collectIds(expectObject(durationTokens, '/durationModes'), ['tokens']))
      .toEqual([...STATUS_DURATION_MODES]);
    expect(collectIds(expectObject(stackTokens, '/stackModes'), ['tokens'])).toEqual([...STATUS_STACK_MODES]);

    const selection = expectObject(statuses['modeSelectionContract'], '/modeSelectionContract');
    expect(selection['durationModeField']).toBe('durationUnit');
    expect(selection['stackModeField']).toBe('stackBehavior');
    expect(selection['ownership']).toBe('玩法层');
  });

  it('resolves every play-layer duration and stack token to a declared mode', () => {
    const aliasByField = new Map<string, ReadonlySet<string>>();
    const selection = expectObject(statuses['modeSelectionContract'], '/modeSelectionContract');
    const axes: readonly [string, string][] = [
      [expectString(selection['durationModeField'], '/durationModeField'), 'status.valueset.duration_modes'],
      [expectString(selection['stackModeField'], '/stackModeField'), 'status.valueset.stack_modes'],
    ];
    for (const [field, valueSetId] of axes) {
      const valueSet = entries(statuses, 'valueSets').find((set) => set['id'] === valueSetId);
      const tokens = entries(expectObject(valueSet, `/${valueSetId}`), 'tokens');
      const accepted = new Set<string>();
      for (const token of tokens) {
        for (const alias of stringArray(token, 'playLayerTokens')) accepted.add(alias);
        accepted.add(expectString(token['id'], '/id'));
      }
      aliasByField.set(field, accepted);
    }

    const unresolved: string[] = [];
    for (const file of jsonFilesUnder(join(PLAY_PROFILE_ROOT, 'statuses'))) {
      const profile = expectObject(readPlayProfile(file), file);
      for (const [field, accepted] of aliasByField) {
        const value = profile[field];
        if (value === undefined) continue;
        const token = expectString(value, `${file}/${field}`);
        if (!accepted.has(token)) unresolved.push(`${file}/${field} -> ${token}`);
      }
    }
    expect(unresolved, '玩法层模式取值必须能解析到基类层声明的模式').toEqual([]);
  });

  it('declares the runtime state boundary and the pseudo subtype contract for statuses', () => {
    const boundary = expectObject(statuses['runtimeStateBoundary'], '/runtimeStateBoundary');
    expect(boundary['diagnosticCode']).toBe(DIAGNOSTIC_CODES.LAYER_L1_RUNTIME_STATE);
    expect(stringArray(boundary, 'forbiddenConceptTokens').length).toBeGreaterThan(0);

    const pseudo = expectObject(statuses['pseudoSubtypeContract'], '/pseudoSubtypeContract');
    expect(pseudo['diagnosticCode']).toBe(DIAGNOSTIC_CODES.STATUS_PSEUDO_SUBTYPE);
    expect(stringArray(pseudo, 'distinguishingFields'))
      .toEqual(['type', 'category', 'capabilityIds', 'configurableParameters']);

    const interaction = expectObject(statuses['interactionContract'], '/interactionContract');
    expect(interaction['diagnosticCode']).toBe(DIAGNOSTIC_CODES.STATUS_INTERACTION_WITHOUT_RULE);
    expect(interaction['resultOwnership']).toBe('玩法层');
  });

  it('distinguishes skill activations and forbids a cooldown on a passive skill', () => {
    const activations = entries(readCatalog('skills'), 'classes')
      .map((entry) => expectString(entry['activation'], '/activation'));
    expect(activations).toEqual([...SKILL_ACTIVATIONS]);
    expect(valueSetTokens('skills', 'skill.valueset.activations')).toEqual([...SKILL_ACTIVATIONS]);

    const passive = classById('skills', 'skill.class.passive');
    expect(passive.forbiddenFieldNames).toContain('activationActionRef');
    expect(passive.forbiddenFieldNames).toContain('cooldownFields');
    expect(passive.requiredCapabilityIds).not.toContain('skill.capability.activation_action');

    const active = classById('skills', 'skill.class.active');
    expect(active.requiredCapabilityIds).toContain('skill.capability.activation_action');
    expect(active.parameterKeys).toContain('costFields');

    const triggered = classById('skills', 'skill.class.triggered');
    expect(triggered.requiredCapabilityIds).toContain('skill.capability.trigger_condition');
    expect(triggered.forbiddenFieldNames).toContain('activationActionRef');
  });

  it('distinguishes movement traversals and assigns cost, speed, range and terrain to the play layer', () => {
    const movement = readCatalog('movement');
    const traversals = entries(movement, 'classes').map((entry) => expectString(entry['traversal'], '/traversal'));
    expect(traversals).toEqual([...MOVEMENT_TRAVERSALS]);
    expect(valueSetTokens('movement', 'movement.valueset.traversals')).toEqual([...MOVEMENT_TRAVERSALS]);
    expect(stringArray(movement, 'l3OwnedParameterNames'))
      .toEqual(['cost', 'speed', 'range', 'terrainModifier', 'collisionEffect']);
    expect(movement['l3OwnedParameterOwnership']).toBe('玩法层');

    // 玩法层拥有的参数名只能作为字段名出现，不能成为基类层的键。
    const serialized = JSON.stringify(movement);
    for (const name of stringArray(movement, 'l3OwnedParameterNames')) {
      expect(serialized.includes(`"${name}":`), name).toBe(false);
    }
    const teleport = classById('movement', 'movement.class.teleport');
    expect(teleport.forbiddenFieldNames).toContain('terrainModifierField');
    expect(teleport.requiredCapabilityIds).toContain('movement.capability.discontinuous_traversal');
  });

  it('declares host, source, duration, stack, granted rule and cleanup for every attachment class', () => {
    const attachments = uniform('attachments');
    expect(attachments.classes.map((entry) => entry.id)).toEqual([
      'attachment.class.status',
      'attachment.class.property',
      'attachment.class.skill',
    ]);
    for (const entry of attachments.classes) {
      for (const key of ['hostType', 'sourceType', 'durationMode', 'stackBehavior', 'cleanupBehavior']) {
        expect(entry.parameterKeys, `${entry.id}/${key}`).toContain(key);
      }
      expect(entry.requiredCapabilityIds, entry.id).toContain('attachment.capability.host_binding');
      expect(entry.requiredCapabilityIds, entry.id).toContain('attachment.capability.cleanup');
    }
    const grantedKinds = entries(readCatalog('attachments'), 'classes')
      .map((entry) => expectString(entry['grantedContractKind'], '/grantedContractKind'));
    expect(new Set(grantedKinds).size).toBe(grantedKinds.length);
    expect(valueSetTokens('attachments', 'attachment.valueset.duration_modes'))
      .toEqual([...STATUS_DURATION_MODES]);
    expect(valueSetTokens('attachments', 'attachment.valueset.stack_behaviors')).toEqual([...STATUS_STACK_MODES]);
    expect(valueSetTokens('attachments', 'attachment.valueset.cleanup_behaviors'))
      .toEqual([...ATTACHMENT_CLEANUP_BEHAVIORS]);
  });
});

describe('AI behaviour family', () => {
  const npcs = readCatalog('npcs');

  it('exposes state names, transitions, goals, intents, perception schema and fallback state', () => {
    // W2:原先专有的 behaviorDeclarationContract / perceptionParameterSchema / evaluationFallbackContract
    // 字段已收敛进 description 散文(见 npcs/index.json 顶部 description 迁移说明)。这里断言这些契约
    // 语义仍被机械可见地声明,并通过 valueSets 的 policy_categories 与 event_driven 能力承载可枚举部分。
    const description = expectString(npcs['description'], '/description');
    // 状态名/迁移字段:event-driven-only 迁移机制必须出现在描述里。
    expect(description).toContain('event-driven-only');
    expect(description).toContain('stateNameField');
    expect(description).toContain('neutralFallbackEvaluation');
    // 感知参数架构:以 reference<policy> 形状声明的参数字段名必须可见。
    expect(description).toContain('sensorProfileRef');
    // 事件驱动能力负责状态迁移触发;该能力必须存在且携带事件绑定参数。
    const eventDriven = entryById(npcs, 'capabilities', 'npc.capability.event_driven');
    const eventKeys = entries(eventDriven, 'parameters').map((parameter) => expectString(parameter['key'], '/key'));
    expect(eventKeys).toContain('eventBindingsRef');
    // 感知能力以 reference<policy> 声明感知器/发现/筛选引用。
    const perceive = entryById(npcs, 'capabilities', 'npc.capability.perceive');
    for (const parameter of entries(perceive, 'parameters')) {
      expect(parameter['valueShape'], String(parameter['key'])).toBe('reference<policy>');
    }
  });

  it('keeps player assistance and NPC behaviour as separate, non-interchangeable policy categories', () => {
    const tokens = entries(npcs, 'valueSets')
      .find((set) => set['id'] === 'npc.valueset.policy_categories');
    expect(collectIds(expectObject(tokens, '/policyCategories'), ['tokens'])).toEqual([...AI_POLICY_CATEGORIES]);
    const categoryTokens = collectIds(expectObject(tokens, '/policyCategories'), ['tokens']);
    expect(categoryTokens).toContain('player-assistance');
    // 没有玩家辅助策略类:所有 classes 的 policyCategory 语义(写在 description 里)均为 npc-behavior,玩家辅助注册为零。
    const zeroPlayerAssistance = categoryTokens.filter((t) => t !== 'npc-behavior');
    expect(zeroPlayerAssistance, '玩家辅助策略类别尚无任何登记类').toHaveLength(1);
    const codes = entries(npcs, 'prohibitions').map((entry) => expectString(entry['diagnosticCode'], '/code'));
    expect(codes).toContain(DIAGNOSTIC_CODES.AI_POLICY_CATEGORY_MISMATCH);
    expect(codes).toContain(DIAGNOSTIC_CODES.AI_REDEFINES_L1_INTERFACE);
    expect(codes).toContain(DIAGNOSTIC_CODES.PROJECTION_WRITE_REJECTED);
  });

  it('consumes engine policy, query, belief, visibility, guard and random interfaces without redefining them', () => {
    // W2:consumedKernelInterfaces / readOnlyProjectionContract 移入 description;这里从描述里声明这些引擎接口。
    const description = expectString(npcs['description'], '/description');
    for (const iface of ['policy', 'query', 'belief-slice', 'visibility', 'evaluation-guard', 'deterministic-random']) {
      expect(description, `必须消费引擎接口 ${iface}`).toContain(iface);
    }
    expect(description).toContain('writeCapability: none');
    expect(description).toContain('shared-action-contract');
    // 动作统一契约、只读投影与非重定义:描述里必须声明这些语义。
    expect(description, 'NPC 不得重定义 L1 引擎接口').not.toMatch(/redefines|重定义/);
    // 动作统一契约:攻击能力必须经统一动作契约提交。
    const attack = entryById(npcs, 'capabilities', 'npc.capability.attack');
    const attackOps = stringArray(attack, 'kernelOps');
    expect(attackOps).toContain('entity.grantAction');
  });

  it('declares a neutral fallback evaluation as an internal metric instead of a player-visible value', () => {
    const description = expectString(npcs['description'], '/description');
    expect(description).toContain('neutralFallbackEvaluation');
    expect(description).toContain('AI_EVALUATION_INVALID');
    // 类别编号标签标注为回退评估:描述里以 neutralFallback 语义表达,且不隐含玩家可见数值。
    expect(description).not.toMatch(/neutralFallback[^ ]*: *[1-5]$/);
  });

  it('separates required from optional behaviour capabilities and forbids contradictory ones', () => {
    const capabilityIds = new Set(collectIds(npcs, ['capabilities']));
    for (const entry of entries(npcs, 'classes')) {
      const id = expectString(entry['id'], '/id');
      const required = stringArray(entry, 'requiredCapabilityIds');
      const optional = stringArray(entry, 'optionalCapabilityIds');
      expect(required.length, id).toBeGreaterThan(0);
      expect(required.filter((capability) => optional.includes(capability)), id).toEqual([]);
      for (const capability of [...required, ...optional]) {
        expect(capabilityIds.has(capability), `${id} -> ${capability}`).toBe(true);
      }
    }
    // 描述里用 forbiddenCapabilityIds 表达「不能同时具备」的互斥约束;平民禁攻击、僵尸禁巡逻/调查。
    const civilian = entryById(npcs, 'classes', 'npc.class.civilian');
    expect(String(expectObject(civilian['typeIdentity'], '/typeIdentity')['statement'])).toContain('不具备攻击能力');
    const zombie = entryById(npcs, 'classes', 'npc.class.zombie');
    expect(String(expectObject(zombie['typeIdentity'], '/typeIdentity')['statement'])).toContain('不具备巡逻与调查能力');
  });

  it('keeps every play-layer NPC profile conformant to its behaviour class contract', () => {
    const byId = new Map(entries(npcs, 'classes').map((entry) => [expectString(entry['id'], '/id'), entry]));
    const violations: string[] = [];
    for (const file of jsonFilesUnder(join(PLAY_PROFILE_ROOT, 'npcs'))) {
      const profile = expectObject(readPlayProfile(file), file);
      const composition = expectObject(profile['classComposition'], `${file}/classComposition`);
      const behaviorClassId = expectString(composition['behaviorClassId'], `${file}/behaviorClassId`);
      const entry = byId.get(behaviorClassId);
      if (entry === undefined) {
        violations.push(`${file} unknown behaviour class ${behaviorClassId}`);
        continue;
      }
      const declared = stringArray(composition, 'capabilityIds');
      const required = stringArray(entry, 'requiredCapabilityIds');
      const optional = stringArray(entry, 'optionalCapabilityIds');
      const permitted = new Set([...required, ...optional]);
      for (const capability of required) {
        if (!declared.includes(capability)) violations.push(`${file} missing ${capability}`);
      }
      for (const capability of declared) {
        if (!permitted.has(capability)) violations.push(`${file} uses undeclared ${capability}`);
      }
      const alternatives = entry['requiredCapabilityAlternatives'];
      if (alternatives === undefined) continue;
      for (const alternative of entries(entry, 'requiredCapabilityAlternatives')) {
        const options = stringArray(alternative, 'anyOfCapabilityIds');
        if (!options.some((capability) => declared.includes(capability))) {
          violations.push(`${file} satisfies none of ${options.join('/')}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
