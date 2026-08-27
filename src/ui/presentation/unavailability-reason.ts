/**
 * 不可用原因安全化（design.md §6.3、J-16，tasks.md 任务 4.4）。
 *
 * `ActionDescriptor.unavailabilityReason` 与内核 `LegalAction.reason` 都是自由文本，
 * 可能携带越权信息（"目标在 3 号房间"）。因此原文**永不**直接呈现给玩家：只按 profile 的
 * `safeUnavailabilityReasons` 映射键取通用原因，无映射时回落到通用文案，原文只进入
 * 需要**显式上游授权**的开发诊断面。
 *
 * "原因映射键"这个字段目前不在 L2 契约中（design.md §14.4 第 3 项），因此键缺失时本模块
 * 返回 `PENDING_CONVERGENCE_CONTRACT`，同时给出可安全呈现的通用文案——玩家侧永远有东西看，
 * 但那东西绝不是原文。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  type UiDiagnostic,
} from '../model/diagnostic';
import type { PresentationProfile } from '../model/profile';
import { PENDING_CONVERGENCE_CODE, convergenceDiagnostic } from '../ports/convergence';

/** 通用不可用文案。它不含任何规则条件，因此对任何观察者都安全。 */
export const GENERIC_UNAVAILABILITY_TEXT = '当前不可用';

/** 开发诊断面的授权来源。`none` 时原文不进入任何输出。 */
export const DEVELOPER_AUTHORITIES = ['upstream-authorized', 'none'] as const;
export type DeveloperAuthority = (typeof DEVELOPER_AUTHORITIES)[number];

export interface UnavailabilityInput {
  /** 上游给出的安全原因映射键。`undefined` 表示该字段尚未汇合。 */
  readonly reasonKey: string | undefined;
  /** 自由文本原文。只可能出现在已授权开发面。 */
  readonly rawReason?: string;
  readonly profile: PresentationProfile;
  readonly developerAuthority: DeveloperAuthority;
  readonly presentationLocation: string;
}

export interface UnavailabilityPresentation {
  /** 玩家可见文案。恒为通用原因或映射后的安全文案，永不是原文。 */
  readonly playerText: string;
  /** 仅在显式上游授权时存在的开发诊断文本。 */
  readonly developerText?: string;
}

export type UnavailabilityOutcome =
  | {
      readonly ok: true;
      readonly value: UnavailabilityPresentation;
      readonly diagnostics: readonly UiDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly code: typeof PENDING_CONVERGENCE_CODE;
      readonly missing: readonly string[];
      /** 汇合失败时仍可安全呈现的文案。调用方必须渲染它，而不是留空或退回原文。 */
      readonly visibilitySafeFallbackText: string;
      readonly diagnostics: readonly UiDiagnostic[];
    };

function developerFields(input: UnavailabilityInput): { readonly developerText?: string } {
  return input.developerAuthority === 'upstream-authorized' && input.rawReason !== undefined
    ? { developerText: input.rawReason }
    : {};
}

export function presentUnavailability(input: UnavailabilityInput): UnavailabilityOutcome {
  if (input.reasonKey === undefined) {
    return Object.freeze({
      ok: false as const,
      code: PENDING_CONVERGENCE_CODE,
      missing: Object.freeze(['unavailability-reason-mapping-key']),
      visibilitySafeFallbackText: GENERIC_UNAVAILABILITY_TEXT,
      diagnostics: Object.freeze([
        convergenceDiagnostic(['unavailability-reason-mapping-key'], input.presentationLocation),
      ]),
    });
  }

  const mapped = input.profile.safeUnavailabilityReasons[input.reasonKey];
  if (mapped === undefined) {
    return Object.freeze({
      ok: true as const,
      value: Object.freeze({
        playerText: GENERIC_UNAVAILABILITY_TEXT,
        ...developerFields(input),
      }),
      diagnostics: Object.freeze([
        uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
          presentationLocation: input.presentationLocation,
          reason: `原因键 ${input.reasonKey} 未在 profile 的安全原因映射中登记，已回落到通用文案`,
          correctionSuggestion: '在 Presentation_Profile 的 safeUnavailabilityReasons 中登记该键',
        }),
      ]),
    });
  }

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({ playerText: mapped, ...developerFields(input) }),
    diagnostics: Object.freeze([]),
  });
}

/** 取可直接渲染的玩家文案，两条分支都不会返回原文。 */
export function playerVisibleUnavailabilityText(outcome: UnavailabilityOutcome): string {
  return outcome.ok ? outcome.value.playerText : outcome.visibilitySafeFallbackText;
}
