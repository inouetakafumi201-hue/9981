/**
 * 权威动作端口（design.md §3.2、§7.1）。
 *
 * 绑定 `submitUiAction({active, kernel, request, scope, callerId})`，它内部构造
 * `CallerContext{kind:'ui'}` 后转发统一 `submit`。唯一写入路径是
 * `ActionPort.submit` → `submitUiAction` → `submit` → `KernelContract.invoke` →
 * `OpRegistry.invoke`；`src/ui` 目录内不出现其中任何一环的标识符。
 *
 * **实现方义务**（在任何 Op 被调用之前重新校验，Requirement 4.5、5.2）：
 * Agent 权限、动作可见性、当前合法性、目标、成本、Decision 状态、当前修订版本。
 * UI 的禁用状态**不是**规则安全边界：即便禁用被绕过、延迟或完全不可用，到达本端口的
 * 每一个意图仍须经过完整的当前状态复校（§7.3）。
 */

import type { UiStructuredRejection } from '../model/diagnostic';
import type { InteractionIntent } from '../model/intent';
import type { StateRevision } from '../model/revision';

/**
 * 提交结果三分支。
 *
 * `'stale'` 与 `'rejected'` **必须分开**：陈旧拒绝要触发重同步，普通拒绝不触发
 * （Requirement 5.6）。把两者并成一类会让 UI 在普通拒绝后也强制重拉投影，
 * 或者更糟——在陈旧拒绝后继续用旧投影重试。
 *
 * `'accepted'` 只表示"权威侧已提交"，**不等于**操作完成：UI 必须等到观察到含
 * `committedRevision` 的投影才认为完成（Requirement 4.7、5.7）。
 */
export type SubmissionOutcome =
  | { readonly kind: 'accepted'; readonly committedRevision: StateRevision }
  | { readonly kind: 'rejected'; readonly rejection: UiStructuredRejection }
  | { readonly kind: 'stale'; readonly rejection: UiStructuredRejection };

export interface ActionPort {
  /** 提交交互意图。与非 UI 调用方共用同一契约。 */
  submit(intent: InteractionIntent): SubmissionOutcome;
}

export function isAccepted(
  outcome: SubmissionOutcome,
): outcome is { readonly kind: 'accepted'; readonly committedRevision: StateRevision } {
  return outcome.kind === 'accepted';
}
