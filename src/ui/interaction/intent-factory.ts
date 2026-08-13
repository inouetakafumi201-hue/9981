/**
 * 交互意图构建（design.md §4.3、§7.1，tasks.md 任务 5.2）。
 *
 * 意图只能引用**当前权威投影中存在**的动作或**开放**的 Decision：
 * 不存在从用户输入直接构造目标标识的路径（Requirement 4.1、5.4、5.5）。
 * 标识由 `deriveIntentId` 确定性派生且不含 `inputSource`，因此同一动作经不同来源
 * 构建出的意图除 `inputSource` 外逐字段相等（Requirement 4.9）。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  uiOk,
  uiRejected,
  type UiDiagnostic,
  type UiResult,
} from '../model/diagnostic.js';
import {
  deriveIntentId,
  type InputSource,
  type InteractionIntent,
  type IntentTarget,
  type ProjectedBindingValue,
} from '../model/intent.js';
import type { UiView } from '../model/view.js';

export type IntentSelection =
  | {
      readonly kind: 'action';
      readonly actionId: string;
      /** 绑定键的子集选择。取值必须与投影中该动作的绑定一致。 */
      readonly bindings: Readonly<Record<string, ProjectedBindingValue>>;
    }
  | { readonly kind: 'decision'; readonly decisionId: string; readonly optionId: string };

export interface IntentBuildInput {
  readonly view: UiView;
  readonly controlId: string;
  readonly interactionId: string;
  readonly inputSource: InputSource;
  readonly selection: IntentSelection;
}

function rejection(location: string, reason: string): UiDiagnostic {
  return uiDiagnostic({
    code: UI_DIAGNOSTIC_CODES.DESCRIPTOR_SEMANTIC_FIELD_MISSING,
    presentationLocation: location,
    reason,
    correctionSuggestion: '重新查询当前投影后再构建意图；UI 不得凭本地状态构造目标标识',
  });
}

export function buildIntent(input: IntentBuildInput): UiResult<InteractionIntent> {
  const location = `interaction/${input.controlId}`;
  // 先取出判别联合再收窄：在回调里访问 `input.selection` 会丢失收窄。
  const selection = input.selection;
  let target: IntentTarget;
  let bindings: Readonly<Record<string, ProjectedBindingValue>>;

  if (selection.kind === 'action') {
    const action = input.view.actions.find((item) => item.actionId === selection.actionId);
    if (action === undefined) {
      return uiRejected([rejection(location, `动作 ${selection.actionId} 不在当前权威投影中`)]);
    }
    const projected = new Map(action.bindings.map((binding) => [binding.key, binding.value]));
    for (const [key, value] of Object.entries(selection.bindings)) {
      if (!projected.has(key)) {
        return uiRejected([rejection(location, `绑定键 ${key} 不在该动作的投影绑定中`)]);
      }
      if (projected.get(key) !== value) {
        return uiRejected([
          rejection(location, `绑定 ${key} 的取值不是投影中出现过的取值`),
        ]);
      }
    }
    target = Object.freeze({ kind: 'action' as const, actionId: action.actionId });
    bindings = Object.freeze({ ...selection.bindings });
  } else {
    const decision = input.view.decisions.find((item) => item.decisionId === selection.decisionId);
    if (decision === undefined) {
      return uiRejected([
        rejection(location, `Decision ${selection.decisionId} 不在当前权威投影中`),
      ]);
    }
    if (decision.status !== 'open') {
      return uiRejected([
        rejection(location, `Decision ${decision.decisionId} 的状态为 ${decision.status}，不再接受答复`),
      ]);
    }
    if (!decision.optionIds.includes(selection.optionId)) {
      return uiRejected([
        rejection(location, `选项 ${selection.optionId} 不在该 Decision 的投影选项中`),
      ]);
    }
    target = Object.freeze({
      kind: 'decision' as const,
      decisionId: decision.decisionId,
      optionId: selection.optionId,
    });
    bindings = Object.freeze({});
  }

  const observedRevision = input.view.revision;
  return uiOk(
    Object.freeze({
      intentId: deriveIntentId(input.view.agentId, target, bindings, observedRevision),
      agentId: input.view.agentId,
      target,
      bindings,
      observedRevision,
      inputSource: input.inputSource,
    }),
  );
}
