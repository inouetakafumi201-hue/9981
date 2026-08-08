/**
 * L2 Validation: 伤害、状态、技能、移动、附件与 AI 行为 Schema 规则。
 *
 * 对应 Requirements 9.1–9.12、10.1、10.4–10.6、10.13 与 Property 14。
 *
 * 铁律：
 * - 伤害不分配数值；只声明类别、来源、目标与结算引用。
 * - 状态交互必须带显式 interaction-rule；L1 运行时迁移伪装被拒绝；仅名称/数值差异被拒绝。
 * - 技能通过激活语义区分类型；成本/冷却是参数字段。
 * - 移动成本/速度/范围/地形/碰撞是 L3 参数。
 * - 附件声明宿主/来源/持续/叠加/清理。
 * - AI 只用注册 L1 原语与 Schema；不重定义 L1 接口；不内嵌巡逻路线/感知阈值/玩法状态机；
 *   玩家辅助策略不能赋给 NPC。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { joinJsonPath } from '../model/ids.js';
import type { CandidateDefinition } from '../model/definition.js';
import type {
  AiBehaviorContract,
  AttachmentContract,
  DamageContract,
  MovementContract,
  SkillContract,
  StatusContract,
} from '../model/family-contracts.js';
import type { DiagnosticCollector, ValidationContext } from './context.js';
import { defError } from './helpers.js';

export function validateDamage(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'damage') {
    return;
  }
  const damage: DamageContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  if (damage.amount !== undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.DAMAGE_ASSIGNS_AMOUNT,
        reason: `伤害 ${definition.id} 分配了具体数值 ${damage.amount}。`,
        correctionSuggestion: '伤害类只声明类别、来源、目标与结算引用，不分配数值（Requirements 9.1）。',
        jsonPath: joinJsonPath(base, 'amount'),
      }),
    );
  }
  if (damage.settlementPipelineRefs.length === 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.DAMAGE_MISSING_CONTRACT_FIELD,
        reason: `伤害 ${definition.id} 未声明结算管线引用。`,
        correctionSuggestion: '伤害必须声明结算管线引用（Requirements 9.1）。',
        jsonPath: joinJsonPath(base, 'settlementPipelineRefs'),
      }),
    );
  }
}

export function validateStatus(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'status') {
    return;
  }
  const status: StatusContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  // L1 运行时迁移伪装（Requirements 9.8）。
  if (status.representsL1RuntimeTransition === true && status.reusableGameplaySemantics !== true) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.LAYER_L1_RUNTIME_STATE,
        reason: `状态 ${definition.id} 表示 L1 运行时迁移且无可复用玩法语义。`,
        correctionSuggestion: '不要把 L1 运行时状态伪装成 L2 状态基类（Requirements 9.8）。',
        jsonPath: joinJsonPath(base, 'representsL1RuntimeTransition'),
      }),
    );
  }

  // 仅名称/数值差异的伪子类型（Requirements 9.9）。
  if (status.differsOnlyByNameOrValue === true) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.STATUS_PSEUDO_SUBTYPE,
        reason: `状态 ${definition.id} 仅因名称或玩法数值不同而成为子类型。`,
        correctionSuggestion: '仅名称/数值差异应改用 L3 组合，而不是新建状态子类型（Requirements 9.9）。',
        jsonPath: base,
      }),
    );
  }

  // 状态交互必须有显式 interaction-rule 引用（Requirements 9.10）。
  status.interactions.forEach((interaction, index) => {
    if (interaction.interactionRuleRef === undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.STATUS_INTERACTION_WITHOUT_RULE,
          reason: `状态 ${definition.id} 的交互「${interaction.interactionId}」缺少显式 interaction-rule 引用。`,
          correctionSuggestion: '组合状态声明交互时必须提供显式 interaction-rule 引用（Requirements 9.10）。',
          jsonPath: joinJsonPath(base, 'interactions', index, 'interactionRuleRef'),
        }),
      );
    }
  });
}

export function validateSkill(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'skill') {
    return;
  }
  const skill: SkillContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');
  if (skill.differsOnlyByNameOrValue === true) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SKILL_MISSING_CONTRACT_FIELD,
        reason: `技能 ${definition.id} 仅因名称或玩法数值不同而成为子类型。`,
        correctionSuggestion: '技能子类型必须通过激活语义区分；仅名称/数值差异应改用 L3 组合（Requirements 9.3、9.9）。',
        jsonPath: base,
      }),
    );
  }
}

export function validateMovement(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'movement') {
    return;
  }
  const movement: MovementContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  // 成本/速度/范围/地形字段若声明，必须是参数字段且分类为 Gameplay_Value（Requirements 9.6）。
  const namedFields: { readonly field: string | undefined; readonly key: string }[] = [
    { field: movement.costField, key: 'costField' },
    { field: movement.speedField, key: 'speedField' },
    { field: movement.rangeField, key: 'rangeField' },
    { field: movement.terrainModifierField, key: 'terrainModifierField' },
  ];
  for (const named of namedFields) {
    if (named.field === undefined) {
      continue;
    }
    const declared = definition.parameterSchema.fields.find((f) => f.name === named.field);
    if (declared === undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.MOVEMENT_PARAMETER_NOT_L3_OWNED,
          reason: `移动 ${definition.id} 的 ${named.key}「${named.field}」未在参数 Schema 中声明。`,
          correctionSuggestion: '移动成本/速度/范围/地形必须作为 L3 拥有的参数字段暴露（Requirements 9.6）。',
          jsonPath: joinJsonPath(base, named.key),
        }),
      );
    } else if (declared.classification !== 'Gameplay_Value') {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.MOVEMENT_PARAMETER_NOT_L3_OWNED,
          reason: `移动 ${definition.id} 的 ${named.key}「${named.field}」分类为 ${declared.classification}，而非 Gameplay_Value。`,
          correctionSuggestion: '移动成本/速度/范围/地形是玩法层数值，字段分类必须为 Gameplay_Value（Requirements 9.6）。',
          jsonPath: joinJsonPath(base, named.key),
        }),
      );
    }
  }
}

export function validateAttachment(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'attachment') {
    return;
  }
  const attachment: AttachmentContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');
  // 宿主与来源类型必须声明（decode 已保证；此处校验 grantedRuleRefs 至少可为空但类型存在）。
  if (attachment.hostType === undefined || attachment.sourceType === undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.ATTACHMENT_MISSING_CONTRACT_FIELD,
        reason: `附件 ${definition.id} 缺少宿主类型或来源类型。`,
        correctionSuggestion: '附件必须声明宿主类型、来源类型、持续模式、叠加行为、授予规则与清理行为（Requirements 9.7）。',
        jsonPath: base,
      }),
    );
  }
}

/** 玩家辅助策略赋给 NPC 时使用的类别引用集合（用于跨定义检查）。 */
export function validateAiBehavior(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'ai-behavior') {
    return;
  }
  const ai: AiBehaviorContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  // 重定义 L1 接口（Requirements 10.2）。
  if (ai.redefinedL1Interfaces !== undefined && ai.redefinedL1Interfaces.length > 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.AI_REDEFINES_L1_INTERFACE,
        reason: `AI 行为 ${definition.id} 重定义了 L1 接口 [${ai.redefinedL1Interfaces.join('、')}]。`,
        correctionSuggestion: 'AI 只能消费 L1 policy/query/belief/visibility/evaluation-guard/random 接口，不能重定义（Requirements 10.2）。',
        jsonPath: joinJsonPath(base, 'redefinedL1Interfaces'),
      }),
    );
  }

  // 内嵌玩法细节（Requirements 10.5）。
  if (ai.embeddedGameplayDetails !== undefined && ai.embeddedGameplayDetails.length > 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.AI_EMBEDDED_GAMEPLAY_DETAIL,
        reason: `AI 行为 ${definition.id} 内嵌了玩法细节 [${ai.embeddedGameplayDetails.join('、')}]。`,
        correctionSuggestion: '巡逻路线、具体感知阈值、玩法专属状态机与 NPC 实例耦合归玩法层（Requirements 10.5）。',
        jsonPath: joinJsonPath(base, 'embeddedGameplayDetails'),
      }),
    );
  }

  // 必需动作集为空（Requirements 10.12）。
  if (ai.requiredActionRefs.length === 0 && ai.requiredActionTags.length === 0 && ai.states.length > 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.AI_REQUIRED_ACTION_SET_EMPTY,
        reason: `AI 策略 ${definition.id} 声明了状态但必需动作集为空。`,
        correctionSuggestion: '为 AI 策略声明所需动作引用或动作标签；空动作集无法产生行为（Requirements 10.12）。',
        jsonPath: joinJsonPath(base, 'requiredActionRefs'),
      }),
    );
  }
}

/**
 * 玩家辅助策略不能赋给 NPC（Requirements 10.3–10.4）。
 *
 * 包级检查：若某 AI 行为定义的 policyCategory 为 player-assistance，
 * 但被另一个定义/引用当作 NPC 行为策略使用，则拒绝。
 * 这里检查同一定义内的一致性：AI 行为若声明为 NPC 行为语义却引用了 player-assistance 目标。
 * 完整的跨定义赋值检查在引用解析阶段（5.1）借助已解析类别完成。
 */
export function validateAiPolicyCategory(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'ai-behavior') {
    return;
  }
  const ai: AiBehaviorContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  // fallbackState 与 required actions 引用的 AI 定义类别一致性：
  // 若本策略是 npc-behavior，但引用了标注为 player-assistance 的其他 AI 定义作为行为来源，则拒绝。
  const referencedAiDefs = [...ai.requiredActionRefs, ai.fallbackStateRef]
    .map((ref) => context.candidateDefinitions.find((d) => d.id === ref.refId))
    .filter((d): d is CandidateDefinition => d !== undefined);
  for (const referenced of referencedAiDefs) {
    const referencedContract = referenced.familyContract;
    if (
      referencedContract?.contractKind === 'ai-behavior' &&
      ai.policyCategory === 'npc-behavior' &&
      referencedContract.policyCategory === 'player-assistance'
    ) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.AI_POLICY_CATEGORY_MISMATCH,
          reason: `NPC 行为策略 ${definition.id} 引用了玩家辅助策略 ${referenced.id}。`,
          correctionSuggestion: '玩家辅助策略与 NPC 行为策略类别不兼容，不能相互赋值（Requirements 10.3–10.4）。',
          jsonPath: base,
        }),
      );
    }
  }
}

/** 4.8 总入口。 */
export function validateEffectsAndAi(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  validateDamage(definition, context, collector);
  validateStatus(definition, context, collector);
  validateSkill(definition, context, collector);
  validateMovement(definition, context, collector);
  validateAttachment(definition, context, collector);
  validateAiBehavior(definition, context, collector);
  validateAiPolicyCategory(definition, context, collector);
}
