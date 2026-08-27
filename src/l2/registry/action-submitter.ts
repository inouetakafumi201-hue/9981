/**
 * L2 Registry: 统一运行时提交与唯一 `OpRegistry.invoke` 映射。
 *
 * 对应 Requirements 6.1–6.10、10.8–10.9、13.6–13.7、14.7、14.10 与
 * design.md 运行时写入边界、`submit`、Property 12。
 *
 * 铁律（唯一写入通道）：
 * - 所有调用方（AI/UI/其他）走同一 `submit`。
 * - 有效动作只映射为结构化 Op 并调用一次 `KernelContract.invoke`（转发 L1 `OpRegistry.invoke`）。
 * - 前置条件失败、动作不可用、Hook 接线不可用、投影越权写入 → 不调用任何效果 Op，保持前状态。
 * - L2 不实现本地 Hook 分发、事务或 Expr 求值：这些错误由 KernelContract 透传。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import type { Result } from '../model/result';
import { ok } from '../model/result';
import { errorDiagnostic, structuredRejection } from '../model/diagnostic-factory';
import type {
  ActionRequest,
  CallerContext,
  OpCause,
  OpResult,
  ValidatedOpRequest,
} from '../model/projection';
import type { JsonValue } from '../model/json';
import type { ActionContract } from '../model/family-contracts';
import type { KernelContract } from '../kernel/kernel-contract';
import type { ActiveRegistry } from './definition-registry';
import { query } from './definition-registry';

/** 把已解析动作与请求映射为结构化 Op 请求。 */
function mapToOpRequest(
  action: ActionContract,
  actionId: string,
  request: ActionRequest,
  caller: CallerContext,
): ValidatedOpRequest | undefined {
  if (action.opMapping === undefined) {
    return undefined;
  }
  const args: Record<string, JsonValue | { $: string } | Record<string, JsonValue | { $: string }>> = {};
  for (const mapping of action.opMapping.argumentMapping) {
    switch (mapping.source) {
      case 'actor':
        args[mapping.opArgument] = request.actorId;
        break;
      case 'target':
        args[mapping.opArgument] = [...request.targetIds];
        break;
      case 'parameter':
        if (mapping.parameterName !== undefined && mapping.parameterName in request.parameters) {
          args[mapping.opArgument] = request.parameters[mapping.parameterName] as JsonValue;
        }
        break;
      case 'constant':
        if (mapping.constant !== undefined) {
          args[mapping.opArgument] = mapping.constant;
        }
        break;
      default: {
        const exhaustive: never = mapping.source;
        return exhaustive;
      }
    }
  }
  const cause: OpCause = {
    requestId: request.requestId,
    callerId: caller.callerId,
    callerKind: caller.kind,
    actionId,
  };
  return { actionId, opId: action.opMapping.opId, args, cause };
}

export interface SubmitInput {
  readonly active: ActiveRegistry;
  readonly kernel: KernelContract;
  readonly request: ActionRequest;
  readonly caller: CallerContext;
}

/**
 * 提交一个动作请求。
 *
 * 校验顺序（任一失败即返回 Structured_Rejection，不触及 Op）：
 * 1. 动作可解析且为 Action_Family。
 * 2. 拒绝携带语义字段写入（投影/描述符不可写，Requirements 10.8、14.10）。
 * 3. 目标在授权可见范围内（Requirements 10.7）。
 * 4. 动作可用（有 Op 映射；attached 动作不能独立提交）。
 * 5. Hook 接线：requiresHookIntegration 的动作在接线不可用时拒绝。
 * 6. 映射为结构化 Op 并调用唯一写入通道。
 */
export function submit(input: SubmitInput): Result<OpResult> {
  const { active, kernel, request, caller } = input;
  const priorFingerprint = kernel.semanticStateFingerprint();

  const definition = query(active, request.actionId);
  if (definition === undefined || definition.familyContract?.contractKind !== 'action') {
    return structuredRejection(
      [
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.RUNTIME_ACTION_UNRESOLVED,
          reason: `动作请求 ${request.requestId} 引用的动作 ${request.actionId} 未解析为 Action_Family 定义。`,
          correctionSuggestion: '确认动作已注册且其 familyContract.contractKind 为 action。',
        }),
      ],
      priorFingerprint,
    );
  }
  const action = definition.familyContract;

  // 语义字段写入尝试：统一拒绝（投影不可写）。
  if (request.semanticFieldWrites !== undefined && request.semanticFieldWrites.length > 0) {
    return structuredRejection(
      [
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.PROJECTION_WRITE_REJECTED,
          reason: `动作请求 ${request.requestId} 试图直接写入语义字段，只读投影不允许写入。`,
          correctionSuggestion: '语义状态只能通过动作映射的 Op 修改，不能经投影/描述符直接写入（Requirements 10.8、14.10）。',
          jsonPath: request.semanticFieldWrites[0]!.path,
        }),
      ],
      priorFingerprint,
    );
  }

  // 目标可见范围（Requirements 10.7）。
  const visible = new Set(caller.scope.visibleEntityIds);
  for (const targetId of request.targetIds) {
    if (!visible.has(targetId)) {
      return structuredRejection(
        [
          errorDiagnostic({
            code: DIAGNOSTIC_CODES.RUNTIME_TARGET_OUT_OF_SCOPE,
            reason: `动作请求 ${request.requestId} 的目标 ${targetId} 不在调用方授权可见范围内。`,
            correctionSuggestion: '只能对授权可见范围内的目标发起动作（Requirements 10.7）。',
          }),
        ],
        priorFingerprint,
      );
    }
  }

  // Attached_Action 不能独立提交。
  if (action.costCategory === 'attached') {
    return structuredRejection(
      [
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.RUNTIME_ACTION_UNAVAILABLE,
          reason: `Attached_Action ${request.actionId} 不能作为独立请求提交。`,
          correctionSuggestion: 'Attached_Action 只能依附于其宿主 Paid_Action 执行（Requirements 6.3）。',
        }),
      ],
      priorFingerprint,
    );
  }

  // Op 映射存在性。
  const opRequest = mapToOpRequest(action, request.actionId, request, caller);
  if (opRequest === undefined) {
    return structuredRejection(
      [
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.RUNTIME_OP_MAPPING_MISSING,
          reason: `动作 ${request.actionId} 缺少 Op 映射，无法执行运行时写入。`,
          correctionSuggestion: '为可执行动作声明 opMapping。',
        }),
      ],
      priorFingerprint,
    );
  }

  // Hook 接线门禁（design.md 运行时写入边界、集成门禁 4）。
  if (action.requiresHookIntegration && !kernel.hookIntegrationAvailable()) {
    return structuredRejection(
      [
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.RUNTIME_HOOK_INTEGRATION_UNAVAILABLE,
          reason: `动作 ${request.actionId} 依赖 Hook 接线，但引擎层 Hook 分发尚不可用。`,
          correctionSuggestion: 'Hook 接线可用前不执行该动作；基类层不提供本地补偿性分发（H-001 缺口）。',
        }),
      ],
      priorFingerprint,
    );
  }

  // Op 是否已在 L1 注册。
  if (!kernel.hasOp(opRequest.opId)) {
    return structuredRejection(
      [
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.RUNTIME_OP_MAPPING_MISSING,
          reason: `动作 ${request.actionId} 映射的 Op「${opRequest.opId}」未在引擎层注册。`,
          correctionSuggestion: '确认目标 Op 已在 L1 OpRegistry 注册。',
        }),
      ],
      priorFingerprint,
    );
  }

  // 唯一语义写入通道。
  const invokeResult = kernel.invoke(opRequest.opId, opRequest.args, opRequest.cause);
  if (!invokeResult.ok) {
    const code =
      invokeResult.kind === 'invariant-violation'
        ? DIAGNOSTIC_CODES.RUNTIME_L1_INVARIANT_VIOLATION
        : invokeResult.kind === 'transaction-aborted'
          ? DIAGNOSTIC_CODES.RUNTIME_TRANSACTION_ABORTED
          : DIAGNOSTIC_CODES.RUNTIME_PRECONDITION_FAILED;
    return structuredRejection(
      [
        errorDiagnostic({
          code,
          reason: `引擎层拒绝动作 ${request.actionId} 的 Op「${opRequest.opId}」：[${invokeResult.code}] ${invokeResult.detail}`,
          correctionSuggestion: '引擎层已中止包含事务并保持事务前语义状态；修正前置条件或参数后重试。',
        }),
      ],
      invokeResult.semanticStateFingerprintAfter,
    );
  }

  const result: OpResult = {
    opId: opRequest.opId,
    applied: invokeResult.ok,
    journalEntries: invokeResult.journalEntries,
    semanticStateFingerprintAfter: invokeResult.semanticStateFingerprintAfter,
  };
  return ok(result);
}
