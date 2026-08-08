/**
 * `Interaction_Intent` 形状（design.md §4.3）。
 *
 * 四项设计约束：
 * 1. `target` 是**判别联合**而不是两个可选字段——可选字段允许"两个都填"和"都不填"
 *    这两种无意义状态，判别联合从类型上排除它们。
 * 2. `bindings` 的取值只能是投影里出现过的标识或值，UI 不能凭空构造目标标识。
 * 3. `observedRevision` 必填。没有它，权威侧无法执行当前修订校验（Requirement 4.5）。
 * 4. `inputSource` **不参与合法性判定**，只用于诊断（Requirement 4.9）。
 */

import type { StateRevision } from './revision.js';

/**
 * 归一化后的交互来源，闭合枚举。
 *
 * 物理来源共六类（键盘、指针、触摸、手柄、开关控制、辅助自动化），其中开关控制与
 * 辅助自动化都归一化到 `assistive`——它们在合法性上与其他来源完全等价，区分只有诊断意义。
 */
export const INPUT_SOURCES = ['keyboard', 'pointer', 'touch', 'gamepad', 'assistive'] as const;
export type InputSource = (typeof INPUT_SOURCES)[number];

export function isInputSource(candidate: unknown): candidate is InputSource {
  return typeof candidate === 'string' && (INPUT_SOURCES as readonly string[]).includes(candidate);
}

/** 绑定取值：只能是投影中出现过的标识或值。 */
export type ProjectedBindingValue = string | number | boolean;

export interface ActionIntentTarget {
  readonly kind: 'action';
  readonly actionId: string;
}

export interface DecisionIntentTarget {
  readonly kind: 'decision';
  readonly decisionId: string;
  readonly optionId: string;
}

export type IntentTarget = ActionIntentTarget | DecisionIntentTarget;

export interface InteractionIntent {
  readonly intentId: string;
  readonly agentId: string;
  /** 二者恰择其一：动作意图或 Decision 答复意图。 */
  readonly target: IntentTarget;
  readonly bindings: Readonly<Record<string, ProjectedBindingValue>>;
  /** 形成该意图时观察到的修订版本。权威侧据此判定陈旧。 */
  readonly observedRevision: StateRevision;
  /** 归一化后的交互来源。**不参与合法性判定**，仅用于诊断。 */
  readonly inputSource: InputSource;
}

/** 目标的稳定字符串表示，用于确定性排序与意图标识派生。 */
export function intentTargetKey(target: IntentTarget): string {
  return target.kind === 'action'
    ? `action:${target.actionId}`
    : `decision:${target.decisionId}:${target.optionId}`;
}

/** 绑定的稳定字符串表示：键按码点序排列，因此同内容必得同结果。 */
export function bindingsKey(bindings: Readonly<Record<string, ProjectedBindingValue>>): string {
  return Object.keys(bindings)
    .sort()
    .map((key) => `${key}=${String(bindings[key])}`)
    .join('&');
}

/**
 * 确定性意图标识。
 *
 * 刻意**不含** `inputSource`：Requirement 4.9 要求同一动作经不同来源解析到同一个意图形状，
 * 若标识随来源变化，"除 inputSource 外逐字段相等"就无法成立。
 */
export function deriveIntentId(
  agentId: string,
  target: IntentTarget,
  bindings: Readonly<Record<string, ProjectedBindingValue>>,
  observedRevision: StateRevision,
): string {
  const material = [
    agentId,
    intentTargetKey(target),
    bindingsKey(bindings),
    String(observedRevision.sequence),
    observedRevision.fingerprint,
  ].join('|');
  return `intent:${stableHash(material)}`;
}

/**
 * 确定性、与宿主无关的字符串散列（FNV-1a 32 位）。
 *
 * 用途仅限派生稳定标识与装饰性变化，**不消耗任何权威随机流**（Requirement 7.9、J-18）。
 */
export function stableHash(material: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < material.length; index++) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
