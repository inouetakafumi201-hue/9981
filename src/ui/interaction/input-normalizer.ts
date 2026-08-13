/**
 * 输入归一化（design.md §7.2、§11.3，tasks.md 任务 5.1）。
 *
 * 六类物理来源（键盘、指针、触摸、手柄、开关控制、辅助自动化）全部解析到**同一组稳定交互
 * 标识**与同一个意图形状（Requirement 11.6、4.9）。归一化后的 `inputSource` 只有五个取值：
 * 开关控制与辅助自动化都归入 `assistive`，因为它们在合法性上与其他来源完全等价，
 * 区分只有诊断意义。
 *
 * 改绑只改"哪个物理输入映射到哪个稳定交互标识"，**不改动作定义、不引入来源特定合法性**
 * （Requirement 11.7）：本文件的输出里没有任何合法性字段，因此"来源特定合法性"无处安放。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  uiOk,
  uiRejected,
  type UiDiagnostic,
  type UiResult,
} from '../model/diagnostic.js';
import type { InputSource } from '../model/intent.js';

/** 物理输入来源。比 `InputSource` 多两类，归一化时收敛。 */
export const RAW_INPUT_KINDS = [
  'keyboard',
  'pointer',
  'touch',
  'gamepad',
  'switch-control',
  'assistive-automation',
] as const;
export type RawInputKind = (typeof RAW_INPUT_KINDS)[number];

export const INPUT_SOURCE_BY_RAW_KIND: Readonly<Record<RawInputKind, InputSource>> = Object.freeze({
  keyboard: 'keyboard',
  pointer: 'pointer',
  touch: 'touch',
  gamepad: 'gamepad',
  'switch-control': 'assistive',
  'assistive-automation': 'assistive',
});

export interface RawInputEvent {
  readonly rawKind: RawInputKind;
  /** 物理输入标识（按键码、指针目标、手柄按钮…）。它**不是**稳定交互标识。 */
  readonly physicalId: string;
}

/** 输入绑定：物理输入 → 稳定交互标识 + 承载它的控件。 */
export interface InputBinding {
  readonly physicalId: string;
  readonly controlId: string;
  readonly interactionId: string;
}

export interface BindingIndex {
  resolve(physicalId: string): InputBinding | undefined;
  bindings(): readonly InputBinding[];
}

function bindingSortKey(binding: InputBinding): string {
  return `${binding.physicalId}\u0000${binding.controlId}\u0000${binding.interactionId}`;
}

/**
 * 建立绑定索引。
 *
 * 同一 `physicalId` 被映射到不同的 `(controlId, interactionId)` 即冲突：产出**确定性**
 * 冲突报告并要求显式解决，**不静默丢弃**任何一个绑定（Requirement 11.8）。
 * 报告按绑定的稳定排序键排列，因此同一组输入必得同一份报告。
 */
export function buildBindingIndex(bindings: readonly InputBinding[]): UiResult<BindingIndex> {
  const byPhysicalId = new Map<string, InputBinding[]>();
  for (const binding of bindings) {
    const bucket = byPhysicalId.get(binding.physicalId);
    if (bucket === undefined) byPhysicalId.set(binding.physicalId, [binding]);
    else bucket.push(binding);
  }

  const conflicts: UiDiagnostic[] = [];
  for (const physicalId of [...byPhysicalId.keys()].sort()) {
    const bucket = byPhysicalId.get(physicalId) ?? [];
    const distinct = [...new Set(bucket.map(bindingSortKey))].sort();
    if (distinct.length <= 1) continue;
    conflicts.push(
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.INPUT_BINDING_CONFLICT,
        presentationLocation: `interaction/input-binding#${physicalId}`,
        reason: `物理输入 ${physicalId} 被绑定到多个稳定交互标识：${distinct.join(' | ')}`,
        correctionSuggestion: '请显式解决该冲突（改绑或删除其中一个）；系统不会替你选一个保留',
      }),
    );
  }
  if (conflicts.length > 0) return uiRejected(conflicts);

  const resolved = new Map<string, InputBinding>();
  for (const binding of bindings) resolved.set(binding.physicalId, binding);
  const ordered = Object.freeze(
    [...bindings].sort((left, right) =>
      bindingSortKey(left) < bindingSortKey(right) ? -1 : bindingSortKey(left) > bindingSortKey(right) ? 1 : 0,
    ),
  );
  return uiOk(
    Object.freeze({
      resolve(physicalId: string): InputBinding | undefined {
        return resolved.get(physicalId);
      },
      bindings(): readonly InputBinding[] {
        return ordered;
      },
    }),
  );
}

/**
 * 归一化后的输入。
 *
 * 刻意**没有**任何合法性、成本或可用性字段：合法性只由权威侧判定，
 * 输入来源不得参与其中（Requirement 4.9、11.7）。
 */
export interface NormalizedInput {
  readonly controlId: string;
  readonly interactionId: string;
  readonly inputSource: InputSource;
}

export function normalizeInput(
  event: RawInputEvent,
  index: BindingIndex,
): UiResult<NormalizedInput> {
  const binding = index.resolve(event.physicalId);
  if (binding === undefined) {
    return uiRejected([
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.INPUT_BINDING_CONFLICT,
        presentationLocation: `interaction/input-binding#${event.physicalId}`,
        reason: `物理输入 ${event.physicalId} 没有对应的稳定交互标识绑定`,
        correctionSuggestion: '为该物理输入显式声明绑定；未绑定的输入不会被当作任何动作',
      }),
    ]);
  }
  return uiOk(
    Object.freeze({
      controlId: binding.controlId,
      interactionId: binding.interactionId,
      inputSource: INPUT_SOURCE_BY_RAW_KIND[event.rawKind],
    }),
  );
}
