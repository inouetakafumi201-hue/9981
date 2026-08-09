/**
 * 表现字段降级（design.md §10.2，tasks.md 任务 4.2）。
 *
 * 四条约束：
 * 1. 回退**只能**从已验证语义字段派生，绝不从标签、图标、素材名、邻近字段或默认玩法假设
 *    发明语义（Requirement 9.2）。`DeclaredFallback.derivedFrom` 把这条写进类型。
 * 2. 回退不增加、不移除、不启用任何动作（Requirement 9.4）：本文件只返回资源引用，
 *    没有任何触及 `available` 的路径。
 * 3. 原描述符语义类型本身隐藏时，只能用 `generic` 回退，不能用 `type-specific`
 *    ——类型特定回退会暴露隐藏类型（Requirement 9.5）。
 * 4. 语义拒绝**不得**被降级掩盖（Requirement 9.10）：本文件只处理纯表现资源，
 *    没有任何入口能把语义错误转成 `warn`。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  type UiDiagnostic,
} from '../model/diagnostic.js';

export const FALLBACK_RESOURCE_KINDS = [
  'icon',
  'texture',
  'sound',
  'haptic',
  'animation-clip',
  'font',
  'posture-asset',
] as const;
export type FallbackResourceKind = (typeof FALLBACK_RESOURCE_KINDS)[number];

/** 回退的可见性作用域。`generic` 是 Visibility_Safe 的通用呈现。 */
export const FALLBACK_SCOPES = ['generic', 'type-specific'] as const;
export type FallbackScope = (typeof FALLBACK_SCOPES)[number];

/** 回退只能由这些**已验证语义字段**派生。 */
export const VALIDATED_SEMANTIC_SOURCES = [
  'actionId',
  'resourceRole',
  'interactionIntent',
  'costCategory',
  'stableIdentifier',
] as const;
export type ValidatedSemanticSource = (typeof VALIDATED_SEMANTIC_SOURCES)[number];

export interface DeclaredFallback {
  readonly kind: FallbackResourceKind;
  readonly assetRef: string;
  readonly scope: FallbackScope;
  readonly derivedFrom: ValidatedSemanticSource;
}

export interface FallbackRequest {
  readonly kind: FallbackResourceKind;
  readonly presentationLocation: string;
  /** 原描述符的语义类型本身是否隐藏（Requirement 9.5）。 */
  readonly semanticTypeHidden: boolean;
  /**
   * 该资源是否为"让交互控件或规则显著状态可访问"所必需（Requirement 9.9）。
   *
   * 这条分界是整个降级机制的关键：**看不见图标可以降级，读屏用户完全无法感知这个控件必须拒绝**。
   */
  readonly essential: boolean;
}

export type FallbackOutcome =
  | {
      readonly kind: 'applied';
      readonly asset: DeclaredFallback;
      readonly diagnostics: readonly UiDiagnostic[];
    }
  | { readonly kind: 'omitted'; readonly diagnostics: readonly UiDiagnostic[] }
  | { readonly kind: 'rejected'; readonly diagnostics: readonly UiDiagnostic[] };

/**
 * 选择类型兼容回退。
 *
 * 候选按 `assetRef` 的码点序排序后取第一个，因此同输入必得同输出——回退选择不能是随机的，
 * 否则"换 profile 重跑属性测试"会因为回退抖动而假失败。
 */
export function resolveFallback(
  request: FallbackRequest,
  declared: readonly DeclaredFallback[],
): FallbackOutcome {
  const candidates = declared
    .filter((item) => item.kind === request.kind)
    .filter((item) => (request.semanticTypeHidden ? item.scope === 'generic' : true))
    .sort((left, right) => (left.assetRef < right.assetRef ? -1 : left.assetRef > right.assetRef ? 1 : 0));

  const chosen = candidates[0];
  if (chosen !== undefined) {
    return Object.freeze({
      kind: 'applied' as const,
      asset: chosen,
      diagnostics: Object.freeze([
        uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
          presentationLocation: request.presentationLocation,
          reason: `表现资源 ${request.kind} 不可用，已使用已声明的类型兼容回退`,
          correctionSuggestion: '补齐该资源即可恢复原呈现；回退不改变任何动作可用性',
          internalFields: {
            fallbackKind: chosen.kind,
            fallbackScope: chosen.scope,
            derivedFrom: chosen.derivedFrom,
          },
        }),
      ]),
    });
  }

  if (!request.essential) {
    return Object.freeze({
      kind: 'omitted' as const,
      diagnostics: Object.freeze([
        uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
          presentationLocation: request.presentationLocation,
          reason: `非必要资源 ${request.kind} 没有类型兼容且可见性安全的回退，已省略该资源`,
          correctionSuggestion: '保留语义文本或形状输出即可；不得因资源缺失而禁用合法动作',
        }),
      ]),
    });
  }
  return Object.freeze({
    kind: 'rejected' as const,
    diagnostics: Object.freeze([
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.ACCESSIBLE_LABEL_MISSING,
        presentationLocation: request.presentationLocation,
        reason: `资源 ${request.kind} 是让该呈现可访问所必需的，但没有类型兼容且可见性安全的回退`,
        correctionSuggestion: '拒绝该呈现，并保持底层规则状态不变',
      }),
    ]),
  });
}

/**
 * 动画回退时仍必须呈现已提交的最终语义状态（Requirement 9.6）。
 *
 * 返回的是"应当直接呈现最终态"这一决定，而不是任何动效——没有动效可用时最终态照样要出现。
 */
export function animationFallbackPresentsFinalState(outcome: FallbackOutcome): boolean {
  return outcome.kind !== 'rejected';
}

/**
 * 音频或触觉回退不可用、而该反馈承载必需信息时，保留等价的视觉与无障碍文本通道
 * （Requirement 9.7）。返回仍需保留的通道清单。
 */
export function retainedChannelsAfterFailure(
  failedKind: FallbackResourceKind,
): readonly ('visual' | 'accessible-text')[] {
  return failedKind === 'sound' || failedKind === 'haptic'
    ? Object.freeze(['visual' as const, 'accessible-text' as const])
    : Object.freeze(['accessible-text' as const]);
}
