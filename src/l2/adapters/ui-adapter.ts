/**
 * L2 Adapters: UI_Adapter.uiDescriptor 与 UI 动作提交集成。
 *
 * 对应 Requirements 14.1–14.11、13.11、16.12–16.13 与 design.md `UI_Adapter.uiDescriptor`、
 * Presentation_Descriptor、Property 7/11/12。
 *
 * 铁律：
 * - 描述符从只读投影与已验证运行时状态派生。
 * - HP/stamina/AP 是独立资源语义角色，不靠字段名猜测（Requirements 14.3）。
 * - 交互意图与渲染技术无关（Requirements 14.4）。attackShape 已废止，见 model/family-contracts.ts。
 * - Paid/Attached 分为独立动作组（Requirements 14.6）。
 * - 更换 renderer 不改变任何语义动作标识或验证结果（Requirements 14.8）。
 * - Presentation_Field 缺失只产生兼容回退 Warning（Requirements 14.9）。
 * - UI 动作走统一 `submit`（Requirements 14.7）。
 */

import { compareStrings } from '../model/ordering';
import { deepFreeze } from '../model/immutable';
import { warningDiagnostic } from '../model/diagnostic-factory';
import type { Result } from '../model/result';
import { ok } from '../model/result';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import type {
  ActionDescriptor,
  ActionRequest,
  AuthorizationScope,
  CallerContext,
  OpResult,
  PresentationDescriptor,
  ProvenanceLabel,
  ResourceDescriptor,
  RuntimeSemanticState,
  SemanticStateEntry,
  UiQuery,
} from '../model/projection';
import type { Diagnostic } from '../model/diagnostic';
import type { ActionContract, ResourceSemanticRole } from '../model/family-contracts';
import type { ActiveRegistry } from '../registry/definition-registry';
import { query } from '../registry/definition-registry';
import { createProjection } from '../registry/read-only-projection';
import { submit } from '../registry/action-submitter';
import type { KernelContract } from '../kernel/kernel-contract';

type MutableDiagnostics = Diagnostic[];

/** 从实体语义属性提取资源描述符（依赖 resourceRole，不猜字段名）。 */
function resourceDescriptors(entry: SemanticStateEntry): readonly ResourceDescriptor[] {
  const roleLabels: Record<ResourceSemanticRole, string> = {
    hp: '生命值',
    stamina: '体力',
    ap: '行动点',
  };
  const out: ResourceDescriptor[] = [];
  for (const property of entry.properties) {
    if (property.resourceRole !== undefined) {
      out.push({
        entityId: entry.entityId,
        role: property.resourceRole,
        value: property.value,
        accessibleLabel: roleLabels[property.resourceRole],
      });
    }
  }
  return out.sort((left, right) => compareStrings(left.role, right.role));
}

function actionDescriptor(
  actionId: string,
  action: ActionContract,
  available: boolean,
  unavailabilityReason: string | undefined,
  presentation: { readonly accessibleLabel?: string; readonly assetRefs?: readonly string[] } | undefined,
  warnings: MutableDiagnostics,
  scopePath: string,
): ActionDescriptor {
  // 表现字段缺失 → 类型兼容回退 + Warning（Requirements 14.9）。
  let accessibleLabel = action.accessibleLabel ?? presentation?.accessibleLabel;
  if (accessibleLabel === undefined) {
    accessibleLabel = actionId;
    warnings.push(
      warningDiagnostic({
        code: DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
        reason: `动作 ${actionId} 缺少无障碍标签，回退为动作标识。`,
        correctionSuggestion: '补全 accessibleLabel 以获得完整可访问性；语义不受影响。',
        jsonPath: scopePath,
      }),
    );
  }
  return {
    actionId,
    costCategory: action.costCategory,
    available,
    accessibleLabel,
    assetRefs: presentation?.assetRefs ?? [],
    targets: [],
    // 双轨制 P2：track 透传 L2 ActionContract.track；缺省按 P3 数据填充约定默认 'card'。
    track: action.track ?? 'card',
    ...(action.interactionIntent === undefined ? {} : { interactionIntent: action.interactionIntent }),
    // 2026-08-08 权威变更：attackShape 已删除，见 model/family-contracts.ts 顶部权威变更说明。
    ...(action.posture === undefined ? {} : { posture: action.posture }),
    ...(unavailabilityReason === undefined ? {} : { unavailabilityReason }),
    // 双轨制 P2：cardPresentation 由装载期已求值；ui-adapter 仅透传。
    ...(action.cardPresentation === undefined ? {} : { cardPresentation: action.cardPresentation }),
  };
}

export interface UiDescriptorInput {
  readonly active: ActiveRegistry;
  readonly runtimeState: RuntimeSemanticState;
  readonly query: UiQuery;
  readonly scope: AuthorizationScope;
  /** 可用动作 id 集合（由玩法层运行时判定；缺省表示全部可用）。 */
  readonly availableActionIds?: ReadonlySet<string>;
  /** 需要展示的动作 id 列表。 */
  readonly actionIds: readonly string[];
}

/**
 * 生成 UI 表现描述符。
 * `rendererId` 只记录在描述符里用于回归对比；更换它不改变任何 actionId 或可用性判定。
 */
export function uiDescriptor(input: UiDescriptorInput): Result<PresentationDescriptor> {
  const warnings: MutableDiagnostics = [];
  const projection = createProjection(input.active, input.runtimeState, input.scope);

  const actorEntry = projection.entities.find((entry) => entry.entityId === input.query.actorId);
  const resources = actorEntry === undefined ? [] : resourceDescriptors(actorEntry);

  const paidActions: ActionDescriptor[] = [];
  const attachedActions: ActionDescriptor[] = [];
  const provenanceLabels: ProvenanceLabel[] = [];

  for (const actionId of [...input.actionIds].sort(compareStrings)) {
    const definition = query(input.active, actionId);
    if (definition === undefined || definition.familyContract?.contractKind !== 'action') {
      warnings.push(
        warningDiagnostic({
          code: DIAGNOSTIC_CODES.UI_DESCRIPTOR_TARGET_UNRESOLVED,
          reason: `UI 请求展示的动作 ${actionId} 未解析为 Action_Family，已跳过。`,
          correctionSuggestion: '确认动作已注册。',
        }),
      );
      continue;
    }
    const action = definition.familyContract;
    const available = input.availableActionIds === undefined || input.availableActionIds.has(actionId);
    const unavailabilityReason = available ? undefined : `动作 ${actionId} 当前不可用`;
    if (!available && !input.query.includeUnavailable) {
      continue;
    }
    const descriptor = actionDescriptor(
      actionId,
      action,
      available,
      unavailabilityReason,
      definition.presentation,
      warnings,
      `${actionId}`,
    );
    if (action.costCategory === 'attached') {
      attachedActions.push(descriptor);
    } else {
      paidActions.push(descriptor);
    }

    // 规范地位标签（Requirements 16.12–16.13）。
    const record = definition.sourceRecords[0];
    if (record !== undefined) {
      provenanceLabels.push({
        definitionId: actionId,
        classification: record.classification,
        owningLayer: record.owningLayer,
        nonNormative: record.classification !== 'Normative_Contract',
        nonDefault: record.classification === 'Historical_Example',
        sourceLocation: record.sourceLocation,
        label:
          record.classification === 'L3_Profile'
            ? `玩法层内容（来源 ${record.sourceFile}）`
            : record.classification === 'Historical_Example'
              ? `历史示例（非默认、非规范，来源 ${record.sourceFile}）`
              : `基类层规范（来源 ${record.sourceFile}）`,
      });
    }
  }

  const descriptor: PresentationDescriptor = {
    scopeId: input.scope.scopeId,
    resources,
    paidActions,
    attachedActions,
    provenanceLabels: provenanceLabels.sort((left, right) => compareStrings(left.definitionId, right.definitionId)),
    warnings,
    ...(input.query.rendererId === undefined ? {} : { rendererId: input.query.rendererId }),
  };
  // Presentation_Descriptor 与只读投影同属"深度不可变返回值"（Requirements 14.1、Property 11）：
  // 描述符不得成为调用方可写的别名。此处在返回前深度冻结；warnings 的全部 push 都发生在
  // 描述符构造之前，冻结不会截断后续诊断。
  const frozen = deepFreeze(descriptor) as PresentationDescriptor;
  return ok(frozen, warnings);
}

export interface UiSubmitInput {
  readonly active: ActiveRegistry;
  readonly kernel: KernelContract;
  readonly request: ActionRequest;
  readonly scope: AuthorizationScope;
  readonly callerId: string;
}

/** UI 提交动作：走与 AI/非 UI 相同的统一 `submit`（Requirements 14.7、14.8）。 */
export function submitUiAction(input: UiSubmitInput): Result<OpResult> {
  const caller: CallerContext = {
    callerId: input.callerId,
    kind: 'ui',
    scope: input.scope,
  };
  return submit({ active: input.active, kernel: input.kernel, request: input.request, caller });
}
