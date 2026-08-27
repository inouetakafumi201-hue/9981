/**
 * L2 Adapters: AI_Adapter.aiView 与统一动作提交集成。
 *
 * 对应 Requirements 10.1–10.13、14.1、14.7、15.14 与 design.md `AI_Adapter.aiView`、Property 11/12/14。
 *
 * 铁律：
 * - AI 只取得授权只读投影（Requirements 10.7）。
 * - 玩家辅助策略不能赋给 NPC（Requirements 10.3–10.4）。
 * - 空/非数值/非有限评估返回评估诊断 + 策略声明的中性回退（Requirements 10.10）。
 * - AI 动作经与非 AI 相同的 `submit → OpRegistry.invoke` 路径（Requirements 10.9）。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import type { Diagnostic } from '../model/diagnostic';
import { errorDiagnostic, structuredRejection } from '../model/diagnostic-factory';
import type { Result } from '../model/result';
import { ok } from '../model/result';
import { compareStrings } from '../model/ordering';
import type {
  ActionRequest,
  AiEvaluationOutcome,
  AiLegalAction,
  AiSemanticView,
  AuthorizationScope,
  CallerContext,
  OpResult,
} from '../model/projection';
import type { AiBehaviorContract } from '../model/family-contracts';
import type { ActiveRegistry } from '../registry/definition-registry';
import { query } from '../registry/definition-registry';
import { createProjection } from '../registry/read-only-projection';
import { submit } from '../registry/action-submitter';
import type { KernelContract } from '../kernel/kernel-contract';
import type { RuntimeSemanticState } from '../model/projection';

/** 从 AI 策略定义解析合法动作集合。 */
function legalActionsOf(active: ActiveRegistry, policy: AiBehaviorContract): readonly AiLegalAction[] {
  const actions: AiLegalAction[] = [];
  for (const ref of policy.requiredActionRefs) {
    const definition = query(active, ref.refId);
    if (definition?.familyContract?.contractKind === 'action') {
      actions.push({
        actionId: definition.id,
        tags: [...definition.tags].sort(compareStrings),
        targetIds: [],
        costCategory: definition.familyContract.costCategory,
      });
    }
  }
  return actions.sort((left, right) => compareStrings(left.actionId, right.actionId));
}

export interface AiViewInput {
  readonly active: ActiveRegistry;
  readonly runtimeState: RuntimeSemanticState;
  readonly policyId: string;
  readonly scope: AuthorizationScope;
}

/**
 * 构造 AI 语义视图。
 * 若策略未解析或必需动作集为空则拒绝（Requirements 10.12）。
 */
export function aiView(input: AiViewInput): Result<AiSemanticView> {
  const definition = query(input.active, input.policyId);
  if (definition === undefined || definition.familyContract?.contractKind !== 'ai-behavior') {
    return structuredRejection([
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.AI_MISSING_CONTRACT_FIELD,
        reason: `AI 策略 ${input.policyId} 未解析为 AI_Behavior_Family 定义。`,
        correctionSuggestion: '确认策略已注册且其 familyContract.contractKind 为 ai-behavior。',
      }),
    ]);
  }
  const policy = definition.familyContract;
  const legalActions = legalActionsOf(input.active, policy);

  if (legalActions.length === 0 && (policy.requiredActionRefs.length > 0 || policy.requiredActionTags.length > 0)) {
    return structuredRejection([
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.AI_REQUIRED_ACTION_SET_EMPTY,
        reason: `AI 策略 ${input.policyId} 的必需动作集因缺失定义解析为空集。`,
        correctionSuggestion: '提供策略所需的动作定义，或修正动作引用（Requirements 10.12）。',
      }),
    ]);
  }

  const projection = createProjection(input.active, input.runtimeState, input.scope);
  const view: AiSemanticView = {
    policyId: input.policyId,
    policyCategory: policy.policyCategory,
    projection,
    legalActions,
    diagnostics: [],
  };
  return ok(view);
}

/**
 * 规范化 AI 评估结果（Requirements 10.10）。
 * null / 非数字 / 非有限 → 返回策略声明的中性回退 + 评估诊断。
 */
export function evaluate(raw: unknown, neutralFallback: number): AiEvaluationOutcome {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { raw, usedFallback: false, value: raw, diagnostics: [] };
  }
  const diagnostic: Diagnostic = errorDiagnostic({
    code: DIAGNOSTIC_CODES.AI_EVALUATION_INVALID,
    reason: `AI 评估结果无效（${raw === null ? 'null' : typeof raw === 'number' ? '非有限数字' : typeof raw}），使用中性回退 ${neutralFallback}。`,
    correctionSuggestion: '评估必须返回有限数字；无效评估回退到策略声明的中性值，不改变语义状态（Requirements 10.10）。',
  });
  return { raw, usedFallback: true, value: neutralFallback, diagnostics: [diagnostic] };
}

export interface AiSubmitInput {
  readonly active: ActiveRegistry;
  readonly kernel: KernelContract;
  readonly request: ActionRequest;
  readonly scope: AuthorizationScope;
  readonly policyId: string;
  readonly callerId: string;
}

/**
 * AI 提交动作：构造 AI 调用方上下文后走统一 `submit`。
 * AI 与非 AI 动作经过完全相同的验证与 `OpRegistry.invoke` 路径。
 */
export function submitAiAction(input: AiSubmitInput): Result<OpResult> {
  const caller: CallerContext = {
    callerId: input.callerId,
    kind: 'ai',
    scope: input.scope,
    policyId: input.policyId,
  };
  return submit({ active: input.active, kernel: input.kernel, request: input.request, caller });
}
