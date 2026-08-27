/**
 * `Rule_Event_Projection` 安全字段形状与白名单投影（design.md §4.2、J-10、J-11）。
 *
 * 白名单而非黑名单：漏列一个键的后果是"少显示一点信息"，漏禁一个键的后果是一次信息泄漏。
 * 因此本文件**没有**任何黑名单分支——未登记的键一律丢弃。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  type UiDiagnostic,
} from './diagnostic';
import type { StateRevision } from './revision';

/** 可安全投影的取值。函数、`undefined`、Symbol 与非有限数一律不属于该集合。 */
export type SafeProjectedValue =
  | string
  | number
  | boolean
  | null
  | readonly SafeProjectedValue[]
  | { readonly [key: string]: SafeProjectedValue };

export interface RuleEventProjection {
  /** 来自 `LogEntry.seq`，保证因果顺序（单调、裁剪后不复用）。 */
  readonly sequence: number;
  /** 来自 `LogEntry.type`（事件名约定 `after:${opName}`）。 */
  readonly semanticType: string;
  readonly observedAtRevision: StateRevision;
  readonly safePayload: Readonly<Record<string, SafeProjectedValue>>;
}

export interface SafePayloadProjection {
  readonly safePayload: Readonly<Record<string, SafeProjectedValue>>;
  readonly diagnostics: readonly UiDiagnostic[];
}

function isSafeProjectedValue(candidate: unknown, depth = 0): candidate is SafeProjectedValue {
  if (depth > 16) return false;
  if (candidate === null) return true;
  const kind = typeof candidate;
  if (kind === 'string' || kind === 'boolean') return true;
  if (kind === 'number') return Number.isFinite(candidate as number);
  if (Array.isArray(candidate)) {
    return candidate.every((item) => isSafeProjectedValue(item, depth + 1));
  }
  if (kind !== 'object') return false;
  return Object.entries(candidate as Record<string, unknown>).every(([, item]) =>
    isSafeProjectedValue(item, depth + 1),
  );
}

export { isSafeProjectedValue };

function deepFreezeSafeValue(value: SafeProjectedValue): SafeProjectedValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeSafeValue(item)));
  }
  const entries = Object.entries(value as Record<string, SafeProjectedValue>);
  const frozen: Record<string, SafeProjectedValue> = {};
  for (const [key, item] of entries) frozen[key] = deepFreezeSafeValue(item);
  return Object.freeze(frozen);
}

/**
 * 按白名单投影事件载荷。
 *
 * - 未在 `whitelist` 中登记的键：丢弃，每个键产出一条 `warn` 诊断。
 * - 已登记但取值不可安全投影的键：同样丢弃，产出 `EVENT_PAYLOAD_VALUE_UNSAFE`。
 * - `whitelist` 为空：输出为空映射（不是"全部放行"）。
 *
 * 键的枚举顺序按码点排序，使诊断顺序确定性可断言。
 */
export function projectSafePayload(
  rawPayload: Readonly<Record<string, unknown>>,
  whitelist: readonly string[],
  presentationLocation = 'model/event-projection',
): SafePayloadProjection {
  const allowed = new Set(whitelist);
  const diagnostics: UiDiagnostic[] = [];
  const projected: Record<string, SafeProjectedValue> = {};
  const keys = Object.keys(rawPayload).sort();

  for (const key of keys) {
    if (!allowed.has(key)) {
      diagnostics.push(
        uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.EVENT_PAYLOAD_KEY_NOT_WHITELISTED,
          presentationLocation,
          reason: `事件载荷字段 ${key} 未在安全字段白名单中登记，已丢弃`,
          correctionSuggestion: '若该字段确应对该 Agent 可见，请在 Presentation_Profile 的 safeFieldWhitelist 中显式登记',
        }),
      );
      continue;
    }
    const value = rawPayload[key];
    if (!isSafeProjectedValue(value)) {
      diagnostics.push(
        uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.EVENT_PAYLOAD_VALUE_UNSAFE,
          presentationLocation,
          reason: `事件载荷字段 ${key} 的取值不可安全投影，已丢弃`,
          correctionSuggestion: '安全载荷只接受字符串、有限数字、布尔、null 及其数组与映射组合',
        }),
      );
      continue;
    }
    projected[key] = deepFreezeSafeValue(value);
  }

  return Object.freeze({
    safePayload: Object.freeze(projected),
    diagnostics: Object.freeze(diagnostics),
  });
}
