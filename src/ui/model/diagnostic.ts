/**
 * UI 侧诊断形状与稳定码集。
 *
 * 结构复用 `src/l2/model/diagnostic.ts` 的 `Diagnostic`（`code` / `severity` / `reason` /
 * `correctionSuggestion` 无条件必填），但严重度采用 design.md §12.1 的四档
 * （`fatal` 从不由 UI 产生，见 design.md「Error Handling / 严重度与恢复」）。
 *
 * 码集来自 design.md「UI 侧诊断码」表，并按 tasks.md 任务 3.4 / 4.1 / §10.1 补入
 * 该表未列但被明确点名的 L2 复用码。表外新增码见 `UI_OWN_ADDITIONAL_CODES` 的说明。
 *
 * 铁律：本文件不向内核 `ERR_CODES` 新增任何码（J-20）。内核码经 `Result<T>.code`
 * 原样透传，不在此处重命名。
 */

import { DIAGNOSTIC_CODES } from '../../l2/model/diagnostic-codes.js';
import type { StateRevision } from './revision.js';

/** 诊断严重度。UI 最重的诊断是 `error`，其后果始终是"省略某个呈现或交互"。 */
export type UiDiagnosticSeverity = 'fatal' | 'error' | 'warn' | 'info';

/**
 * design.md「UI 侧诊断码」表列出的码，加上 tasks.md 明确点名复用的 L2 码。
 *
 * 与 L2 码表同名的键，其字符串取自 `DIAGNOSTIC_CODES`，使"UI 用法"与"L2 码表"
 * 在编译期绑定：L2 改名会直接让本文件类型检查失败，而不是静默分叉。
 */
export const UI_DIAGNOSTIC_CODES = {
  // ── design.md「UI 侧诊断码」表 ────────────────────────────────────────
  DESCRIPTOR_SEMANTIC_FIELD_MISSING: 'DESCRIPTOR_SEMANTIC_FIELD_MISSING',
  PROJECTION_WRITE_REJECTED: DIAGNOSTIC_CODES.PROJECTION_WRITE_REJECTED,
  PROJECTION_NOT_FROZEN: 'PROJECTION_NOT_FROZEN',
  SALIENCE_TIER_CONFLICT: 'SALIENCE_TIER_CONFLICT',
  CEREMONIAL_SOURCE_MISSING: 'CEREMONIAL_SOURCE_MISSING',
  PROFILE_RULE_SEMANTIC_FIELD: 'PROFILE_RULE_SEMANTIC_FIELD',
  GAMEPLAY_VALUE_OUT_OF_RANGE: 'GAMEPLAY_VALUE_OUT_OF_RANGE',
  ACCESSIBLE_LABEL_MISSING: 'ACCESSIBLE_LABEL_MISSING',
  PENDING_CONVERGENCE_CONTRACT: 'PENDING_CONVERGENCE_CONTRACT',
  INPUT_BINDING_CONFLICT: 'INPUT_BINDING_CONFLICT',
  PRESENTATION_FALLBACK_APPLIED: DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
  EVENT_ARRIVED_STALE: 'EVENT_ARRIVED_STALE',
  EVENT_BUFFER_TIMEOUT: 'EVENT_BUFFER_TIMEOUT',

  // ── tasks.md 任务 3.4 / 4.1 与 design.md §10.1 点名复用的 L2 码 ───────
  PROJECTION_SCOPE_VIOLATION: DIAGNOSTIC_CODES.PROJECTION_SCOPE_VIOLATION,
  UI_UNKNOWN_RESOURCE_ROLE: DIAGNOSTIC_CODES.UI_UNKNOWN_RESOURCE_ROLE,
  UI_DESCRIPTOR_TARGET_UNRESOLVED: DIAGNOSTIC_CODES.UI_DESCRIPTOR_TARGET_UNRESOLVED,
  JSON_SEMANTIC_FIELD_MISSING: DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_MISSING,
  JSON_SEMANTIC_FIELD_DAMAGED: DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
  JSON_SCHEMA_VERSION_UNSUPPORTED: DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_UNSUPPORTED,

  // ── 本 Spec 新增码（见 UI_OWN_ADDITIONAL_CODES 的理由说明） ───────────
  EVENT_PAYLOAD_KEY_NOT_WHITELISTED: 'EVENT_PAYLOAD_KEY_NOT_WHITELISTED',
  EVENT_PAYLOAD_VALUE_UNSAFE: 'EVENT_PAYLOAD_VALUE_UNSAFE',
  PROJECTION_REVISION_GAP: 'PROJECTION_REVISION_GAP',
} as const;

export type UiDiagnosticCode = (typeof UI_DIAGNOSTIC_CODES)[keyof typeof UI_DIAGNOSTIC_CODES];

/**
 * 本 Spec 在 design.md「UI 侧诊断码」表之外新增的三个码，及其必要性。
 *
 * 三者都是"design.md 正文要求产出结构化诊断、但未给码名"的位置。宁可显式登记新码，
 * 也不复用语义不符的既有码（例如把白名单丢弃记成 `PROJECTION_SCOPE_VIOLATION`
 * 会把 `warn` 级的字段未登记误报成 `error` 级的越权）。三者都属于**本 Spec 的自主判断**，
 * 待人工复核；若审查判定应并入 L2 码表，改动路径是"加到 L2 码表 + 走跨 Spec 审查"（J-20）。
 *
 * - `EVENT_PAYLOAD_KEY_NOT_WHITELISTED`：design.md §4.2 要求"未登记的键一律丢弃并产生一条
 *   `Warning_Diagnostic`"，未给码名。
 * - `EVENT_PAYLOAD_VALUE_UNSAFE`：已登记键的取值不是 `SafeProjectedValue` 时同样必须丢弃；
 *   与"键未登记"分开计数，才能在诊断里区分"字段没登记"和"字段登记了但值不可安全投影"。
 * - `PROJECTION_REVISION_GAP`：design.md §17 / Requirement 8.9 要求"报告修订间隙时请求全量投影"，
 *   未给码名。
 */
export const UI_OWN_ADDITIONAL_CODES: readonly UiDiagnosticCode[] = Object.freeze([
  UI_DIAGNOSTIC_CODES.EVENT_PAYLOAD_KEY_NOT_WHITELISTED,
  UI_DIAGNOSTIC_CODES.EVENT_PAYLOAD_VALUE_UNSAFE,
  UI_DIAGNOSTIC_CODES.PROJECTION_REVISION_GAP,
]);

/**
 * 码 → 严重度的固定映射。
 *
 * 把 design.md 表格的严重度列做成常量，使"语义拒绝不得被降级为 warn"这条纪律
 * （Requirement 9.10、Property 20）由类型与数据保证，而不是由每个调用点自觉传参。
 */
export const UI_DIAGNOSTIC_SEVERITY: Readonly<Record<UiDiagnosticCode, UiDiagnosticSeverity>> =
  Object.freeze({
    [UI_DIAGNOSTIC_CODES.DESCRIPTOR_SEMANTIC_FIELD_MISSING]: 'error',
    [UI_DIAGNOSTIC_CODES.PROJECTION_WRITE_REJECTED]: 'error',
    [UI_DIAGNOSTIC_CODES.PROJECTION_NOT_FROZEN]: 'error',
    [UI_DIAGNOSTIC_CODES.SALIENCE_TIER_CONFLICT]: 'error',
    [UI_DIAGNOSTIC_CODES.CEREMONIAL_SOURCE_MISSING]: 'error',
    [UI_DIAGNOSTIC_CODES.PROFILE_RULE_SEMANTIC_FIELD]: 'error',
    [UI_DIAGNOSTIC_CODES.GAMEPLAY_VALUE_OUT_OF_RANGE]: 'error',
    [UI_DIAGNOSTIC_CODES.ACCESSIBLE_LABEL_MISSING]: 'error',
    [UI_DIAGNOSTIC_CODES.PENDING_CONVERGENCE_CONTRACT]: 'error',
    [UI_DIAGNOSTIC_CODES.INPUT_BINDING_CONFLICT]: 'error',
    [UI_DIAGNOSTIC_CODES.PROJECTION_SCOPE_VIOLATION]: 'error',
    [UI_DIAGNOSTIC_CODES.UI_UNKNOWN_RESOURCE_ROLE]: 'error',
    [UI_DIAGNOSTIC_CODES.UI_DESCRIPTOR_TARGET_UNRESOLVED]: 'error',
    [UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_MISSING]: 'error',
    [UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED]: 'error',
    [UI_DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_UNSUPPORTED]: 'error',
    [UI_DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED]: 'warn',
    [UI_DIAGNOSTIC_CODES.EVENT_BUFFER_TIMEOUT]: 'warn',
    [UI_DIAGNOSTIC_CODES.EVENT_PAYLOAD_KEY_NOT_WHITELISTED]: 'warn',
    [UI_DIAGNOSTIC_CODES.EVENT_PAYLOAD_VALUE_UNSAFE]: 'warn',
    [UI_DIAGNOSTIC_CODES.PROJECTION_REVISION_GAP]: 'warn',
    [UI_DIAGNOSTIC_CODES.EVENT_ARRIVED_STALE]: 'info',
  });

/**
 * UI 诊断。
 *
 * `presentationLocation` 兑现 Requirement 12.2 的"受影响的呈现位置"；
 * `revision` 兑现 Requirement 12.9 的"回放/回退期间诊断标注其关联 State_Revision"。
 */
export interface UiDiagnostic {
  readonly code: UiDiagnosticCode;
  readonly severity: UiDiagnosticSeverity;
  /** 受影响的呈现位置（控件标识、描述符标识或资源引用），Visibility_Safe。 */
  readonly presentationLocation: string;
  readonly reason: string;
  readonly correctionSuggestion: string;
  readonly revision?: StateRevision;
  /** 内部度量等仅供已授权开发面的附加字段；用户面不得渲染。 */
  readonly internalFields?: Readonly<Record<string, string | number | boolean>>;
}

export type UiErrorDiagnostic = UiDiagnostic & { readonly severity: 'error' };

export function isUiErrorDiagnostic(diagnostic: UiDiagnostic): diagnostic is UiErrorDiagnostic {
  return diagnostic.severity === 'error';
}

export function hasUiError(diagnostics: readonly UiDiagnostic[]): boolean {
  return diagnostics.some(isUiErrorDiagnostic);
}

export interface UiDiagnosticInput {
  readonly code: UiDiagnosticCode;
  readonly presentationLocation: string;
  readonly reason: string;
  readonly correctionSuggestion: string;
  readonly revision?: StateRevision;
  readonly internalFields?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * 唯一的诊断构造入口。严重度**不接受调用方传入**，只能来自 `UI_DIAGNOSTIC_SEVERITY`。
 * 这使"把语义拒绝转成 warn 以保住控件"在类型层无法表达（Requirement 9.10）。
 */
export function uiDiagnostic(input: UiDiagnosticInput): UiDiagnostic {
  const base: UiDiagnostic = {
    code: input.code,
    severity: UI_DIAGNOSTIC_SEVERITY[input.code],
    presentationLocation: input.presentationLocation,
    reason: input.reason,
    correctionSuggestion: input.correctionSuggestion,
    ...(input.revision === undefined ? {} : { revision: input.revision }),
    ...(input.internalFields === undefined
      ? {}
      : { internalFields: Object.freeze({ ...input.internalFields }) }),
  };
  return Object.freeze(base);
}

/**
 * UI 层统一结果型。
 *
 * UI 不定义异常类、不返回裸布尔、不返回裸字符串原因
 * （design.md「Error Handling / 错误模型：复用引擎层，不新增」）。
 */
export type UiResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly UiDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly UiDiagnostic[] };

export function uiOk<T>(value: T, diagnostics: readonly UiDiagnostic[] = []): UiResult<T> {
  return Object.freeze({ ok: true as const, value, diagnostics: Object.freeze([...diagnostics]) });
}

export function uiRejected<T>(diagnostics: readonly UiDiagnostic[]): UiResult<T> {
  return Object.freeze({ ok: false as const, diagnostics: Object.freeze([...diagnostics]) });
}

/** 结构化拒绝：至少含一个 `error` 诊断，且携带可直接呈现的 Visibility_Safe 文案。 */
export interface UiStructuredRejection {
  readonly rejected: true;
  readonly diagnostics: readonly UiDiagnostic[];
  readonly displayText: string;
}

export function isValidUiStructuredRejection(rejection: UiStructuredRejection): boolean {
  return hasUiError(rejection.diagnostics);
}
