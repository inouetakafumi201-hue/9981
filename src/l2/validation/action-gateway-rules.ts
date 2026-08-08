/**
 * L2 Validation: Action_Family 与三种 Gateway_Family 契约验证。
 *
 * 对应 Requirements 6.1–6.10、15.2、16.2、D-006、Q-02 与 Property 12。
 *
 * 关键铁律：
 * - 一个动作永远 1 AP；多 AP 原子成本 → 拒绝，建议多步序列（Requirements 6.4，L0 AP 铁律）。
 * - Attached_Action 依附 Paid_Action、0 AP、不能作为独立决策分支（Requirements 6.3）。
 * - 三种网关类型互斥、字段完整；不得内嵌具名商店/锁/工作台/具体阈值（Requirements 6.9）。
 * - Q-02 不推导两步/一步默认：验证器不要求也不禁止序列长度，只校验结构。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { joinJsonPath } from '../model/ids.js';
import type { CandidateDefinition } from '../model/definition.js';
import type {
  ActionContract,
  GatewayContract,
} from '../model/family-contracts.js';
import type { DiagnosticCollector, ValidationContext } from './context.js';
import { defError } from './helpers.js';

function actionOf(definition: CandidateDefinition): ActionContract | undefined {
  return definition.familyContract?.contractKind === 'action' ? definition.familyContract : undefined;
}

function gatewayOf(definition: CandidateDefinition): GatewayContract | undefined {
  return definition.familyContract?.contractKind === 'gateway' ? definition.familyContract : undefined;
}

export function validateAction(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const action = actionOf(definition);
  if (action === undefined) {
    return;
  }
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  if (action.completionState.trim().length === 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.ACTION_MISSING_CONTRACT_FIELD,
        reason: `动作 ${definition.id} 缺少 completionState。`,
        correctionSuggestion: '声明动作完成状态（Requirements 6.1）。',
        jsonPath: joinJsonPath(base, 'completionState'),
      }),
    );
  }

  if (action.costCategory === 'paid') {
    if (action.apCost !== 1) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST,
          reason: `Paid_Action ${definition.id} 声明了 ${action.apCost} 点原子 AP 成本。`,
          correctionSuggestion:
            '一个动作永远消耗 1 AP；多 AP 交互应表达为有序 Paid_Action 序列 + 中间状态（Requirements 6.2、6.4）。',
          jsonPath: joinJsonPath(base, 'apCost'),
        }),
      );
    }
  }

  if (action.costCategory === 'attached') {
    if (action.apCost !== 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.ACTION_ATTACHED_NONZERO_COST,
          reason: `Attached_Action ${definition.id} 的 AP 成本不为 0（实际 ${action.apCost}）。`,
          correctionSuggestion: 'Attached_Action 是 0 AP 动作（requirements.md Glossary）。',
          jsonPath: joinJsonPath(base, 'apCost'),
        }),
      );
    }
    if (action.hostActionRef === undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.ACTION_ATTACHED_WITHOUT_HOST,
          reason: `Attached_Action ${definition.id} 未声明依附的 Paid_Action。`,
          correctionSuggestion: 'Attached_Action 必须依附于一个 Paid_Action（Requirements 6.3）。',
          jsonPath: joinJsonPath(base, 'hostActionRef'),
        }),
      );
    }
    if (action.availableAsDecisionBranch) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.ACTION_ATTACHED_AS_DECISION_BRANCH,
          reason: `Attached_Action ${definition.id} 被声明为可独立形成决策分支。`,
          correctionSuggestion: 'Attached_Action 不能作为独立决策分支（Requirements 6.3）。',
          jsonPath: joinJsonPath(base, 'availableAsDecisionBranch'),
        }),
      );
    }
  }

  // 多步序列：除最后一步外每步必须有中间状态（Requirements 6.2）。
  if (action.sequence !== undefined && action.sequence.length > 0) {
    action.sequence.forEach((step, index) => {
      const isLast = index === action.sequence!.length - 1;
      if (!isLast && step.intermediateStatusRef === undefined) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.ACTION_SEQUENCE_MISSING_INTERMEDIATE_STATUS,
            reason: `动作 ${definition.id} 的序列步骤「${step.stepId}」缺少中间状态。`,
            correctionSuggestion: '多步骤付费交互的非末步必须声明显式中间状态（如"撬锁中"）（Requirements 6.2）。',
            jsonPath: joinJsonPath(base, 'sequence', index, 'intermediateStatusRef'),
          }),
        );
      }
    });
  }
}

export function validateGateway(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const gateway = gatewayOf(definition);
  if (gateway === undefined) {
    return;
  }
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  // 三种网关互斥：kind 与所填载荷必须一致，且只填一种。
  const present = [
    gateway.resourceConversion !== undefined ? 'resource-conversion' : undefined,
    gateway.check !== undefined ? 'check' : undefined,
    gateway.condition !== undefined ? 'condition' : undefined,
  ].filter((value): value is string => value !== undefined);

  if (present.length !== 1 || present[0] !== gateway.gatewayKind) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.GATEWAY_KIND_AMBIGUOUS,
        reason:
          `网关 ${definition.id} 的 gatewayKind 为「${gateway.gatewayKind}」，但填充的载荷为 [${present.join('、') || '无'}]。`,
        correctionSuggestion: '资源转换、检定、条件三类网关互斥；只能填与 gatewayKind 一致的那一种载荷（Requirements 6.5）。',
        jsonPath: base,
      }),
    );
    return;
  }

  if (gateway.gatewayKind === 'resource-conversion') {
    const rc = gateway.resourceConversion!;
    if (rc.inputResourceRefs.length === 0 || rc.outputEffectRefs.length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.GATEWAY_MISSING_CONTRACT_FIELD,
          reason: `资源转换网关 ${definition.id} 缺少输入资源引用或输出效果引用。`,
          correctionSuggestion: '资源转换网关必须声明输入资源引用与输出效果引用（Requirements 6.6）。',
          jsonPath: joinJsonPath(base, 'resourceConversion'),
        }),
      );
    }
  }

  if (gateway.gatewayKind === 'check') {
    const check = gateway.check!;
    if (check.successEffectRefs.length === 0 || check.failureEffectRefs.length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.GATEWAY_MISSING_CONTRACT_FIELD,
          reason: `检定网关 ${definition.id} 缺少成功或失败效果引用。`,
          correctionSuggestion: '检定网关必须声明 L1 随机/求值原语引用、可配置判据、成功与失败效果引用（Requirements 6.7）。',
          jsonPath: joinJsonPath(base, 'check'),
        }),
      );
    }
  }

  if (gateway.gatewayKind === 'condition') {
    const condition = gateway.condition!;
    if (condition.successEffectRefs.length === 0 || condition.failureEffectRefs.length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.GATEWAY_MISSING_CONTRACT_FIELD,
          reason: `条件网关 ${definition.id} 缺少成功或失败效果引用。`,
          correctionSuggestion: '条件网关必须声明布尔 Expr 引用与成功、失败效果引用（Requirements 6.8）。',
          jsonPath: joinJsonPath(base, 'condition'),
        }),
      );
    }
  }

  // 违规检测面：具名玩法实体与具体阈值（Requirements 6.9）。
  if (gateway.namedGameplayEntity !== undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.GATEWAY_NAMED_GAMEPLAY_ENTITY,
        reason: `网关 ${definition.id} 内嵌了具名玩法实体「${gateway.namedGameplayEntity}」。`,
        correctionSuggestion: '具名商店/锁/工作台归玩法层；基类层只保留网关类型契约（Requirements 6.9）。',
        jsonPath: joinJsonPath(base, 'namedGameplayEntity'),
      }),
    );
  }
  if (gateway.concreteThreshold !== undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.GATEWAY_CONCRETE_THRESHOLD,
        reason: `网关 ${definition.id} 内嵌了具体阈值 ${gateway.concreteThreshold}。`,
        correctionSuggestion: '阈值必须通过可配置判据（thresholdField）引用参数字段，具体值归玩法层（Requirements 6.9）。',
        jsonPath: joinJsonPath(base, 'concreteThreshold'),
      }),
    );
  }
}

/** 4.5 总入口。 */
export function validateActionsAndGateways(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  validateAction(definition, context, collector);
  validateGateway(definition, context, collector);
}
