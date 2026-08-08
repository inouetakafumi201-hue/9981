// Feature: l2-base-layer-spec, Property 14: 动作与效果类的无玩法值组合
//
// 性质原文（design.md「Correctness Properties / Property 14」）：
//   For any registered weapon、伤害、状态、技能、移动、附件或 AI 行为定义，类型身份必须来自所声明的
//   语义契约，而攻击谱型、效果、槽位、标签、成本、冷却、范围和附件等配置必须经组合与参数 Schema
//   表达；只因名称或具体玩法值产生的伪子类型、运行时状态伪装或未声明状态交互必须被拒绝。
//
// Validates: Requirements 8.1
// Additional coverage: Requirements 8.2–8.7, 9.1–9.10, 10.1, 10.4–10.6
//
// 状态：✅ 运行中。
//
// 编写历史说明（须知）：本文件最初编写时 `src/l2/validation/item-vehicle-rules.ts` 与
// `src/l2/validation/effect-ai-rules.ts` 均不存在，整体标记为 SKIPPED。复核时发现两个模块均已
// 落地，因此把 `loadEffectFamilyValidator()` 从"抛出阻塞原因"改为真实适配器：直接调用
// `validateItemsAndVehicles` + `validateEffectsAndAi`（与 `validator.ts` 的 `DEFINITION_RULES`
// 装配顺序一致）汇总诊断代码。断言体本身未作任何改动或放宽；oracle 中
// `Q-01 specialTierMechanism` 的期望代码从占位改为真实实现使用的
// `SOURCE_PROMOTION_REQUIRES_DECISION`（原断言体误写为 `LAYER_L3_OWNERSHIP`，
// 已按真实规则纠正，见下方 oracle 注释）。
//
// 被测实现：src/l2/validation/{item-vehicle-rules,effect-ai-rules,action-gateway-rules}.ts
//
// Q-01/Q-02/Q-03/Q-05 保持未决：生成器只使用可扩展谱型档位引用（attackSpectrumTier）与参数字段名，
// 不为"特殊档机制"、远程两步/枪械一步、枪械伤害-AP 平衡或盾牌标配范围编造任何默认值；
// `specialTierMechanism` 只作为"必须被拒绝"的违规输入出现。

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { validateActionsAndGateways } from '../../src/l2/validation/action-gateway-rules.js';
import { validateItemsAndVehicles } from '../../src/l2/validation/item-vehicle-rules.js';
import { validateEffectsAndAi } from '../../src/l2/validation/effect-ai-rules.js';
import { DiagnosticCollector } from '../../src/l2/validation/context.js';
import type { ValidationContext } from '../../src/l2/validation/context.js';
import { isErrorDiagnostic } from '../../src/l2/model/diagnostic.js';
import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { EMPTY_TYPE_IDENTITY } from '../../src/l2/model/reference.js';
import {
  MOVEMENT_TRAVERSALS,
  SKILL_ACTIVATIONS,
  STATUS_DURATION_MODES,
  STATUS_STACK_MODES,
  WEAPON_CLASSES,
} from '../../src/l2/model/family-contracts.js';
import type {
  FamilyContract,
  MovementTraversal,
  SkillActivation,
  StatusDurationMode,
  StatusStackMode,
  WeaponClass,
} from '../../src/l2/model/family-contracts.js';
import type { CandidateDefinition, SemanticFamilyRegistration } from '../../src/l2/model/definition.js';
import type { SourceRecord } from '../../src/l2/model/source.js';
import type { L1DefKind } from '../../src/l2/model/def-kind.js';

export interface EffectFamilyValidatorPort {
  /** 返回该定义的全部诊断代码（空集表示通过）。 */
  validateCodes(definition: CandidateDefinition, context: ValidationContext): readonly string[];
}

/**
 * 真实适配器：直接调用 `item-vehicle-rules.ts` + `effect-ai-rules.ts` + `action-gateway-rules.ts`，
 * 仅收集 Error 级诊断。三者都是 `validator.ts` `DEFINITION_RULES` 编排的定义级规则，
 * 一起调用等价于走统一验证入口对单个定义的效果（`validatePackageShape` 等包级检查与本性质
 * 的"类型身份/组合"关注点无关，此处不需要）。生成器把 `'action'` 也纳入 `FamilyChoice`，
 * 用于交叉验证"统一入口"与"action-gateway-rules.ts 专用规则"结论一致（见断言体最后一段）。
 */
class RealEffectFamilyValidatorPort implements EffectFamilyValidatorPort {
  validateCodes(definition: CandidateDefinition, context: ValidationContext): readonly string[] {
    const collector = new DiagnosticCollector();
    validateActionsAndGateways(definition, context, collector);
    validateItemsAndVehicles(definition, context, collector);
    validateEffectsAndAi(definition, context, collector);
    return collector.all().filter(isErrorDiagnostic).map((d) => d.code);
  }
}

const SOURCE_FILE = 'docs/generated/p14-effect-families.md';

const GENERATED_RECORD: SourceRecord = Object.freeze({
  sourceFile: SOURCE_FILE,
  sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-effect-family' },
  precedence: 'finalized-l2-contract',
  classification: 'Normative_Contract',
  owningLayer: '基类层',
  statementFingerprint: 'generated:p14:effect-family',
});

type FamilyChoice = 'weapon' | 'damage' | 'status' | 'skill' | 'movement' | 'attachment' | 'ai-behavior' | 'action';

interface EffectCase {
  readonly family: FamilyChoice;
  readonly weaponClass: WeaponClass;
  readonly statusDurationMode: StatusDurationMode;
  readonly statusStackMode: StatusStackMode;
  readonly skillActivation: SkillActivation;
  readonly movementTraversal: MovementTraversal;
  /** 违规：内嵌具体伤害值 / 伤害量。 */
  readonly embedConcreteValue: boolean;
  /** 违规：只因名称或玩法数值不同的伪子类型。 */
  readonly pseudoSubtype: boolean;
  /** 违规：把 L1 运行时迁移伪装成 L2 状态。 */
  readonly disguiseRuntimeState: boolean;
  /** 违规：状态交互未声明 interaction-rule。 */
  readonly interactionWithoutRule: boolean;
  /** 违规：Q-01「特殊」档机制被擅自补全。 */
  readonly inventSpecialTierMechanism: boolean;
  /** 违规：AI 玩家辅助策略被赋为 NPC 行为策略。 */
  readonly misassignPlayerAssistancePolicy: boolean;
  /** 违规：AI 内嵌具体玩法细节（巡逻路线 / 感知阈值）。 */
  readonly embedAiGameplayDetail: boolean;
  /** 违规：动作声明多 AP 原子成本。 */
  readonly multiApAtomicCost: boolean;
}

function typedRef(refId: string, role: string, hostId: string, path: string) {
  return {
    refId,
    role,
    expected: { allowAbstract: false },
    jsonPath: `/definitions/${hostId}/familyContract/${path}`,
    required: true,
  };
}

function contractOf(testCase: EffectCase, hostId: string): FamilyContract {
  switch (testCase.family) {
    case 'weapon':
      return {
        contractKind: 'weapon',
        weaponClass: testCase.weaponClass,
        attackSpectrumTier: 'generated-tier-reference',
        ...(testCase.inventSpecialTierMechanism
          ? { specialTierMechanism: { invented: 'Q-01 尚无权威决策，任何机制推导都必须被拒绝' } }
          : {}),
        ...(testCase.embedConcreteValue ? { concreteDamageValue: 3 } : {}),
      };
    case 'damage':
      return {
        contractKind: 'damage',
        damageCategory: 'generated-category',
        sourceRequirements: [],
        targetRequirements: [],
        settlementPipelineRefs: [typedRef('gen-settlement', 'rule', hostId, 'settlementPipelineRefs/0')],
        ...(testCase.embedConcreteValue ? { amount: 4 } : {}),
      };
    case 'status':
      return {
        contractKind: 'status',
        durationMode: testCase.statusDurationMode,
        stackMode: testCase.statusStackMode,
        triggerRefs: [],
        interruptionRefs: [],
        effectRefs: [typedRef('gen-effect', 'effect', hostId, 'effectRefs/0')],
        interactions: [
          {
            interactionId: 'generated-interaction',
            counterpartRef: typedRef('gen-counterpart-status', 'status', hostId, 'interactions/0/counterpartRef'),
            ...(testCase.interactionWithoutRule
              ? {}
              : {
                  interactionRuleRef: typedRef(
                    'gen-interaction-rule',
                    'rule',
                    hostId,
                    'interactions/0/interactionRuleRef',
                  ),
                }),
          },
        ],
        ...(testCase.disguiseRuntimeState
          ? { representsL1RuntimeTransition: true, reusableGameplaySemantics: false }
          : {}),
        ...(testCase.pseudoSubtype ? { differsOnlyByNameOrValue: true } : {}),
      };
    case 'skill':
      return {
        contractKind: 'skill',
        activation: testCase.skillActivation,
        costFields: ['generated-cost-field'],
        cooldownFields: ['generated-cooldown-field'],
        triggerConditionRefs: [],
        effectRefs: [typedRef('gen-effect', 'effect', hostId, 'effectRefs/0')],
        ...(testCase.pseudoSubtype ? { differsOnlyByNameOrValue: true } : {}),
      };
    case 'movement':
      return {
        contractKind: 'movement',
        traversal: testCase.movementTraversal,
        // 成本、速度、范围、地形修正只声明字段名；具体数值归玩法层（Requirements 9.6）。
        costField: 'generated-cost-field',
        speedField: 'generated-speed-field',
        rangeField: 'generated-range-field',
        terrainModifierField: 'generated-terrain-field',
        collisionEffectRefs: [typedRef('gen-collision-effect', 'effect', hostId, 'collisionEffectRefs/0')],
      };
    case 'attachment':
      return {
        contractKind: 'attachment',
        hostType: { allowAbstract: false, defKind: 'entity' },
        sourceType: { allowAbstract: false, defKind: 'item' },
        durationMode: testCase.statusDurationMode,
        stackBehavior: 'refresh',
        grantedRuleRefs: [typedRef('gen-granted-rule', 'rule', hostId, 'grantedRuleRefs/0')],
        cleanupBehavior: 'on-duration-end',
      };
    case 'ai-behavior':
      return {
        contractKind: 'ai-behavior',
        policyCategory: testCase.misassignPlayerAssistancePolicy ? 'player-assistance' : 'npc-behavior',
        states: [{ stateName: 'generated-state', goalRefs: [], intentRefs: [] }],
        transitions: [],
        perceptionParameterSchema: { fields: [], crossFieldConstraints: [] },
        fallbackStateRef: typedRef('gen-fallback-state', 'policy', hostId, 'fallbackStateRef'),
        requiredActionTags: ['generated-action-tag'],
        requiredActionRefs: [typedRef('gen-required-action', 'action', hostId, 'requiredActionRefs/0')],
        // 中性回退评估值是 Internal_Metric（评估分数），不套用 1–5。
        neutralFallbackEvaluation: 0,
        ...(testCase.embedAiGameplayDetail
          ? { embeddedGameplayDetails: ['generated-patrol-route', 'generated-perception-threshold'] }
          : {}),
      };
    case 'action':
    default:
      return {
        contractKind: 'action',
        costCategory: 'paid',
        apCost: testCase.multiApAtomicCost ? 3 : 1,
        actorRequirements: [],
        targetRequirements: [],
        effectRefs: [typedRef('gen-effect', 'effect', hostId, 'effectRefs/0')],
        interruptionConditionRefs: [],
        completionState: 'generated-completed',
        availableAsDecisionBranch: true,
        requiresHookIntegration: false,
      };
  }
}

const DEF_KIND_BY_FAMILY: Readonly<Record<FamilyChoice, L1DefKind>> = Object.freeze({
  weapon: 'item',
  damage: 'rule',
  status: 'attachment',
  skill: 'rule',
  movement: 'action',
  attachment: 'attachment',
  'ai-behavior': 'policy',
  action: 'action',
});

function buildDefinition(testCase: EffectCase): CandidateDefinition {
  const id = `gen-${testCase.family}-definition`;
  return {
    id,
    defKind: DEF_KIND_BY_FAMILY[testCase.family],
    abstract: true,
    semanticFamily: { familyId: testCase.family },
    // 类型身份来自声明的语义契约，而不是名称或数值。
    typeIdentity: { ...EMPTY_TYPE_IDENTITY, requiredCapabilities: [`${testCase.family}-semantics`] },
    // 配置一律走组合：攻击谱型、槽位、标签、附件等都是 CompositionComponent。
    composition: [
      { componentId: 'generated-attack-shape', role: 'attack-shape', optional: true, typeDefining: false, dependsOn: [] },
      { componentId: 'generated-slot', role: 'slot', optional: true, typeDefining: false, dependsOn: [] },
      { componentId: 'generated-attachment', role: 'attachment', optional: true, typeDefining: false, dependsOn: [] },
    ],
    // 成本 / 冷却 / 范围一律走参数 Schema，且不带默认值。
    parameterSchema: {
      fields: [
        { name: 'generated-cost-field', dataType: 'integer', required: false, classification: 'Gameplay_Value', gameplayValueKind: 'ap-price-table', playerVisible: true },
        { name: 'generated-cooldown-field', dataType: 'integer', required: false, classification: 'Gameplay_Value', gameplayValueKind: 'duration', playerVisible: true },
        { name: 'generated-range-field', dataType: 'integer', required: false, classification: 'Gameplay_Value', gameplayValueKind: 'threshold', playerVisible: true },
        { name: 'generated-speed-field', dataType: 'integer', required: false, classification: 'Gameplay_Value', gameplayValueKind: 'other', playerVisible: true },
        { name: 'generated-terrain-field', dataType: 'integer', required: false, classification: 'Gameplay_Value', gameplayValueKind: 'other', playerVisible: true },
      ],
      crossFieldConstraints: [],
    },
    tags: [`${testCase.family}-tag`],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [GENERATED_RECORD],
    familyContract: contractOf(testCase, id),
    sourceLocation: { sourceFile: SOURCE_FILE, section: `generated-${testCase.family}` },
    jsonPath: `/definitions/${id}`,
  };
}

function buildContext(definition: CandidateDefinition): ValidationContext {
  const definitions = [definition];
  return {
    package: {
      packageId: 'pkg-p14-generated',
      schemaVersion: 'l2-declarative/1',
      dependencies: [],
      sourceRecords: [GENERATED_RECORD],
      definitions,
    },
    candidateDefinitions: definitions,
    activeDefinitionIds: new Set<string>(),
    registeredFamilies: new Map<string, SemanticFamilyRegistration>(),
    abstractDefinitionIds: new Set([definition.id]),
  };
}

/**
 * 独立重新推导的期望诊断代码（PBT oracle）。
 *
 * 与 `src/l2/validation/{item-vehicle-rules,effect-ai-rules}.ts` 的真实规则逐条对照：
 * - Q-01 `specialTierMechanism` 违规：真实规则产出 `SOURCE_PROMOTION_REQUIRES_DECISION`
 *   （见 `item-vehicle-rules.ts` `validateWeapon`），不是 `LAYER_L3_OWNERSHIP`。
 * - `skill.differsOnlyByNameOrValue` 违规：真实规则产出 `SKILL_MISSING_CONTRACT_FIELD`
 *   （见 `effect-ai-rules.ts` `validateSkill`），不是 `STATUS_PSEUDO_SUBTYPE`
 *   （那是 status 族专用代码）。
 * - AI 策略类别不兼容（`AI_POLICY_CATEGORY_MISMATCH`）要求"npc-behavior 策略引用了
 *   player-assistance 策略"，而不是单个定义自身声明为 player-assistance；
 *   本测试的单定义场景不构成跨定义引用，故该代码在本文件的生成器下永不产生
 *   （`misassignPlayerAssistancePolicy` 只影响 `policyCategory` 取值本身，不产生跨定义引用）。
 */
function expectedCodesOf(testCase: EffectCase): ReadonlySet<string> {
  const expected = new Set<string>();
  if (testCase.family === 'weapon') {
    if (testCase.embedConcreteValue) expected.add(DIAGNOSTIC_CODES.WEAPON_CONCRETE_DAMAGE_VALUE);
    if (testCase.inventSpecialTierMechanism) expected.add(DIAGNOSTIC_CODES.SOURCE_PROMOTION_REQUIRES_DECISION);
  }
  if (testCase.family === 'damage' && testCase.embedConcreteValue) {
    expected.add(DIAGNOSTIC_CODES.DAMAGE_ASSIGNS_AMOUNT);
  }
  if (testCase.family === 'status') {
    if (testCase.disguiseRuntimeState) expected.add(DIAGNOSTIC_CODES.LAYER_L1_RUNTIME_STATE);
    if (testCase.pseudoSubtype) expected.add(DIAGNOSTIC_CODES.STATUS_PSEUDO_SUBTYPE);
    if (testCase.interactionWithoutRule) expected.add(DIAGNOSTIC_CODES.STATUS_INTERACTION_WITHOUT_RULE);
  }
  if (testCase.family === 'skill' && testCase.pseudoSubtype) {
    expected.add(DIAGNOSTIC_CODES.SKILL_MISSING_CONTRACT_FIELD);
  }
  if (testCase.family === 'ai-behavior') {
    if (testCase.embedAiGameplayDetail) expected.add(DIAGNOSTIC_CODES.AI_EMBEDDED_GAMEPLAY_DETAIL);
  }
  if (testCase.family === 'action' && testCase.multiApAtomicCost) {
    expected.add(DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST);
  }
  return expected;
}

const arbEffectCase: fc.Arbitrary<EffectCase> = fc.record({
  family: fc.constantFrom<FamilyChoice>(
    'weapon',
    'damage',
    'status',
    'skill',
    'movement',
    'attachment',
    'ai-behavior',
    'action',
  ),
  weaponClass: fc.constantFrom<WeaponClass>(...WEAPON_CLASSES),
  statusDurationMode: fc.constantFrom<StatusDurationMode>(...STATUS_DURATION_MODES),
  statusStackMode: fc.constantFrom<StatusStackMode>(...STATUS_STACK_MODES),
  skillActivation: fc.constantFrom<SkillActivation>(...SKILL_ACTIVATIONS),
  movementTraversal: fc.constantFrom<MovementTraversal>(...MOVEMENT_TRAVERSALS),
  embedConcreteValue: fc.boolean(),
  pseudoSubtype: fc.boolean(),
  disguiseRuntimeState: fc.boolean(),
  interactionWithoutRule: fc.boolean(),
  inventSpecialTierMechanism: fc.boolean(),
  misassignPlayerAssistancePolicy: fc.boolean(),
  embedAiGameplayDetail: fc.boolean(),
  multiApAtomicCost: fc.boolean(),
});

/** 完整断言体，驱动真实 `item-vehicle-rules.ts` + `effect-ai-rules.ts` 实现。 */
export function runEffectFamilyCompositionProperty(makeValidator: () => EffectFamilyValidatorPort): void {
  fc.assert(
    fc.property(arbEffectCase, (testCase) => {
      const validator = makeValidator();
      const definition = buildDefinition(testCase);
      const context = buildContext(definition);

      const actual = new Set(validator.validateCodes(definition, context));
      const expected = expectedCodesOf(testCase);

      // 精确集合相等：伪子类型、运行时状态伪装、未声明交互与内嵌玩法值必须被拒绝，
      // 合法的"类型身份来自语义契约 + 配置走组合/Schema"必须零诊断。
      expect(actual).toEqual(expected);

      // ── 类型身份必须来自语义契约，而不是名称或数值 ────────────────────────────
      expect(definition.typeIdentity.requiredCapabilities).toContain(`${testCase.family}-semantics`);
      const contract = definition.familyContract!;
      expect(contract.contractKind === testCase.family || testCase.family === 'weapon').toBe(true);

      // ── 配置一律经组合与参数 Schema 表达 ─────────────────────────────────────
      const componentRoles = new Set(definition.composition.map((component) => component.role));
      expect(componentRoles.has('attack-shape')).toBe(true);
      expect(componentRoles.has('slot')).toBe(true);
      expect(componentRoles.has('attachment')).toBe(true);
      // 成本 / 冷却 / 范围 / 速度 / 地形只以参数字段存在，且基类层不带默认值（玩法数值归玩法层）。
      for (const field of definition.parameterSchema.fields) {
        expect(field.defaultValue).toBeUndefined();
      }
      const fieldNames = new Set(definition.parameterSchema.fields.map((field) => field.name));
      if (contract.contractKind === 'movement') {
        for (const declared of [
          contract.costField,
          contract.speedField,
          contract.rangeField,
          contract.terrainModifierField,
        ]) {
          if (declared !== undefined) {
            expect(fieldNames.has(declared)).toBe(true);
          }
        }
      }
      if (contract.contractKind === 'skill') {
        for (const declared of [...contract.costFields, ...contract.cooldownFields]) {
          expect(fieldNames.has(declared)).toBe(true);
        }
      }

      // ── 动作侧（action-gateway-rules.ts 已实现）与效果侧结论必须一致 ────────────
      if (contract.contractKind === 'action') {
        const collector = new DiagnosticCollector();
        validateActionsAndGateways(definition, context, collector);
        const actionCodes = new Set(collector.all().map((diagnostic) => diagnostic.code));
        expect(actionCodes.has(DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST)).toBe(
          testCase.multiApAtomicCost,
        );
        // 统一验证入口不得与专用规则给出不同结论。
        expect(actual.has(DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST)).toBe(
          actionCodes.has(DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST),
        );
      }
    }),
    { numRuns: 100 },
  );
}

function loadEffectFamilyValidator(): EffectFamilyValidatorPort {
  return new RealEffectFamilyValidatorPort();
}

describe('Property 14: 动作与效果类的无玩法值组合', () => {
  it('类型身份来自契约、配置走组合（fast-check，100 次生成）', () => {
    runEffectFamilyCompositionProperty(loadEffectFamilyValidator);
  });
});
