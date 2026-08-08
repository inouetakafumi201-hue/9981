/**
 * L2 Testing: 各语义族有效/无效候选定义生成器（基于 fast-check）。
 *
 * 对应 Requirements 4.2–4.3、5.5–5.7、8.1–8.13、9.1–9.10、10.1–10.12、15.1、15.8–15.12
 * 与 design.md `Test_Interface.generate`。
 *
 * 每个"无效"生成器都携带 `expectedCode`：它声明该输入应触发哪个诊断，
 * 让 PBT 能断言"确实因这个原因被拒绝"，而不是碰巧被别的规则拒绝。
 * 生成器只使用 fast-check 原语，不自造 PBT 引擎；不硬编码具名玩法实例。
 */

import fc from 'fast-check';
import type { CandidateDefinition, DefinitionPackage } from '../model/definition.js';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { GAMEPLAY_VALUE_RANGE } from '../model/constitution.js';
import { KNOWN_SEMANTIC_FAMILY_IDS } from '../model/family-contracts.js';
import {
  baseDefinition,
  baseSourceRecord,
  capabilityIdentity,
  gameplayField,
  singleDefinitionPackage,
  typedRef,
  validActionContract,
  validConditionGateway,
  validDamageContract,
  validStatusContract,
} from './builders.js';

/** 带期望诊断的无效样例。 */
export interface InvalidCase {
  readonly definition: CandidateDefinition;
  readonly expectedCode: string;
  readonly description: string;
}

/** 良构标识符生成器（首字符字母）。 */
export const arbId: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('a', 'b', 'c', 'd', 'x', 'y', 'z'),
    fc.stringMatching(/^[a-z0-9_]{0,8}$/u),
  )
  .map(([head, tail]) => `${head}${tail}`);

/** 有效的动作定义。 */
export function validActionDefinition(id: string): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'action',
    semanticFamily: { familyId: 'action' },
    typeIdentity: capabilityIdentity(`act-${id}`),
    familyContract: validActionContract(`${id}-effect`),
  });
}

/** 有效的伤害定义。 */
export function validDamageDefinition(id: string): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'rule',
    semanticFamily: { familyId: 'damage' },
    typeIdentity: capabilityIdentity(`dmg-${id}`),
    familyContract: validDamageContract(`${id}-pipeline`),
  });
}

/** 有效的状态定义。 */
export function validStatusDefinition(id: string): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'attachment',
    semanticFamily: { familyId: 'status' },
    typeIdentity: capabilityIdentity(`st-${id}`),
    familyContract: validStatusContract(`${id}-effect`),
  });
}

/** 有效的条件网关定义。 */
export function validGatewayDefinition(id: string): CandidateDefinition {
  return baseDefinition({
    id,
    defKind: 'rule',
    semanticFamily: { familyId: 'gateway' },
    typeIdentity: capabilityIdentity(`gw-${id}`),
    familyContract: validConditionGateway(`${id}-expr`, `${id}-effect`),
  });
}

/** 有效定义生成器（在若干族间选择）。 */
export const arbValidDefinition: fc.Arbitrary<CandidateDefinition> = fc
  .tuple(arbId, fc.constantFrom('action', 'damage', 'status', 'gateway'))
  .map(([id, family]) => {
    switch (family) {
      case 'action':
        return validActionDefinition(id);
      case 'damage':
        return validDamageDefinition(id);
      case 'status':
        return validStatusDefinition(id);
      default:
        return validGatewayDefinition(id);
    }
  });

// ── 无效样例生成器（携带期望诊断代码） ────────────────────────────────────

/** 非法 Def kind。 */
export function invalidDefKind(id: string): InvalidCase {
  const definition = {
    ...validActionDefinition(id),
    defKind: 'not-a-kind' as CandidateDefinition['defKind'],
  };
  return { definition, expectedCode: DIAGNOSTIC_CODES.DEF_INVALID_DEF_KIND, description: '非法 Def kind' };
}

/** 重定义 L1 机制。 */
export function l1MechanismRedefinition(id: string): InvalidCase {
  const definition: CandidateDefinition = {
    ...validActionDefinition(id),
    declaredL1Mechanisms: ['transaction-model'],
  };
  return { definition, expectedCode: DIAGNOSTIC_CODES.LAYER_L1_OWNERSHIP, description: '重定义 L1 事务机制' };
}

/** 越层玩法规则。 */
export function gameplaySpecificRuleCase(id: string): InvalidCase {
  const definition: CandidateDefinition = {
    ...validActionDefinition(id),
    gameplaySpecificRules: [{ kind: 'victory-condition', detail: '最后一名存活者获胜' }],
  };
  return { definition, expectedCode: DIAGNOSTIC_CODES.LAYER_L3_OWNERSHIP, description: '内嵌胜负条件' };
}

/** 实例携带玩法数值。 */
export function instanceGameplayValueCase(id: string): InvalidCase {
  const definition: CandidateDefinition = {
    ...validActionDefinition(id),
    abstract: false,
    gameplayValues: [{ field: 'damage', value: 3, playerVisible: true, owningProfile: 'battle-royale' }],
  };
  return { definition, expectedCode: DIAGNOSTIC_CODES.VALUE_L3_OWNERSHIP, description: '实例内嵌玩法数值' };
}

/** 废用术语。 */
export function deprecatedTermCase(id: string): InvalidCase {
  const definition: CandidateDefinition = {
    ...validActionDefinition(id),
    // 故意注入废用词以驱动 TERM_DEPRECATED_LAYER_TERM 反向用例；以转义码点书写，避免触发仓库级术语护栏
    // （与 architecture-terminology.test.ts 对该词采用 '\u5185\u5bb9\u5c42' 的写法一致）。运行时值仍等同于该废用词。
    tags: ['\u5185\u5bb9\u5c42'],
  };
  return { definition, expectedCode: DIAGNOSTIC_CODES.TERM_DEPRECATED_LAYER_TERM, description: '使用废用词\u5185\u5bb9\u5c42' };
}

/** 未登记语义族且无三判据证据。 */
export function unregisteredFamilyCase(id: string): InvalidCase {
  const definition: CandidateDefinition = {
    ...validActionDefinition(id),
    semanticFamily: { familyId: 'made-up-family' },
  };
  return { definition, expectedCode: DIAGNOSTIC_CODES.FAMILY_UNREGISTERED, description: '未登记语义族' };
}

/** 玩家可见玩法数值超出 1–5。 */
export function gameplayValueOutOfRangeCase(id: string): InvalidCase {
  const field = gameplayField('power', true);
  const definition: CandidateDefinition = {
    ...validActionDefinition(id),
    parameterSchema: {
      fields: [{ ...field, range: { min: 1, max: GAMEPLAY_VALUE_RANGE.max + 3 } }],
      crossFieldConstraints: [],
    },
  };
  return { definition, expectedCode: DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE, description: '玩家可见数值超出 1–5' };
}

/** 未分类数值字段。 */
export function unclassifiedFieldCase(id: string): InvalidCase {
  const definition: CandidateDefinition = {
    ...validActionDefinition(id),
    parameterSchema: {
      fields: [{ name: 'x', dataType: 'number', required: false, classification: 'bogus' as never }],
      crossFieldConstraints: [],
    },
  };
  return { definition, expectedCode: DIAGNOSTIC_CODES.SCHEMA_FIELD_MISSING_CLASSIFICATION, description: '未分类数值字段' };
}

/** 结构边界缺来源。 */
export function structuralBoundNoSourceCase(id: string): InvalidCase {
  const definition: CandidateDefinition = {
    ...validActionDefinition(id),
    parameterSchema: {
      fields: [{ name: 'cap', dataType: 'integer', required: false, classification: 'Structural_Bound', structuralRationale: '容量上限' }],
      crossFieldConstraints: [],
    },
  };
  return { definition, expectedCode: DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_SOURCE, description: '结构边界缺权威来源' };
}

/** 武器带具体伤害值。 */
export function weaponConcreteDamageCase(id: string): InvalidCase {
  const definition: CandidateDefinition = baseDefinition({
    id,
    defKind: 'item',
    semanticFamily: { familyId: 'weapon' },
    typeIdentity: capabilityIdentity(`wp-${id}`),
    familyContract: { contractKind: 'weapon', weaponClass: 'firearm', concreteDamageValue: 3 },
  });
  return { definition, expectedCode: DIAGNOSTIC_CODES.WEAPON_CONCRETE_DAMAGE_VALUE, description: '武器内嵌具体伤害值' };
}

/** 伤害分配具体数值。 */
export function damageAmountCase(id: string): InvalidCase {
  const definition: CandidateDefinition = baseDefinition({
    id,
    defKind: 'rule',
    semanticFamily: { familyId: 'damage' },
    typeIdentity: capabilityIdentity(`dmg-${id}`),
    familyContract: {
      contractKind: 'damage',
      damageCategory: 'physical',
      sourceRequirements: [],
      targetRequirements: [],
      settlementPipelineRefs: [typedRef(`${id}-pipeline`, 'rule', { defKind: 'rule' })],
      amount: 4,
    },
  });
  return { definition, expectedCode: DIAGNOSTIC_CODES.DAMAGE_ASSIGNS_AMOUNT, description: '伤害分配具体数值' };
}

/** 多 AP 原子成本。 */
export function multiApActionCase(id: string): InvalidCase {
  const definition: CandidateDefinition = baseDefinition({
    id,
    defKind: 'action',
    semanticFamily: { familyId: 'action' },
    typeIdentity: capabilityIdentity(`act-${id}`),
    familyContract: { ...validActionContractOrThrow(`${id}-effect`), apCost: 2 },
  });
  return { definition, expectedCode: DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST, description: '多 AP 原子成本动作' };
}

function validActionContractOrThrow(effectRefId: string) {
  const contract = validActionContract(effectRefId);
  if (contract.contractKind !== 'action') {
    throw new Error('unreachable');
  }
  return contract;
}

/** 全部无效样例构造器。 */
export const INVALID_CASE_BUILDERS: readonly ((id: string) => InvalidCase)[] = Object.freeze([
  invalidDefKind,
  l1MechanismRedefinition,
  gameplaySpecificRuleCase,
  instanceGameplayValueCase,
  deprecatedTermCase,
  unregisteredFamilyCase,
  gameplayValueOutOfRangeCase,
  unclassifiedFieldCase,
  structuralBoundNoSourceCase,
  weaponConcreteDamageCase,
  damageAmountCase,
  multiApActionCase,
]);

/** 无效样例生成器。 */
export const arbInvalidCase: fc.Arbitrary<InvalidCase> = fc
  .tuple(arbId, fc.integer({ min: 0, max: INVALID_CASE_BUILDERS.length - 1 }))
  .map(([id, index]) => INVALID_CASE_BUILDERS[index]!(id));

/** 生成一个把有效定义装入单定义包的生成器。 */
export const arbValidPackage: fc.Arbitrary<DefinitionPackage> = fc
  .tuple(arbId, arbValidDefinition)
  .map(([pkgId, definition]) => singleDefinitionPackage(`pkg-${pkgId}`, definition));

/** 已登记族列表（供族边界测试遍历）。 */
export const KNOWN_FAMILIES = KNOWN_SEMANTIC_FAMILY_IDS;

export { baseSourceRecord };
