/**
 * 无障碍标签判定与感知等价（design.md §11.2、§11.3、J-2、J-3、C-7，tasks.md 任务 4.3）。
 *
 * 标签缺失的判定：`accessibleLabel` 在 L2 契约里必填且没有"缺失"表示法，因此 UI 侧把
 * **空串或纯空白**视为缺失（J-2）。缺失后的处置按 C-7 收敛为"回退 + 警告"：`actionId`
 * 一类的稳定标识是已验证语义字段、且是 Visibility_Safe 的，构成合法回退；只有**连稳定标识
 * 都取不到**时才拒绝该呈现并产出 `ACCESSIBLE_LABEL_MISSING`。
 *
 * 读屏、字幕与视觉渲染消费**同一份**已过滤投影（Requirement 11.4）：本文件所有通道都从
 * `ruleSignificantItems(view)` 这一个列表派生，不存在第二条数据路径。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  type UiDiagnostic,
} from '../model/diagnostic.js';
import type { UiView } from '../model/view.js';

/** 空串或纯空白视为缺失。非字符串同样视为缺失。 */
export function isLabelMissing(label: unknown): boolean {
  return typeof label !== 'string' || label.trim().length === 0;
}

export interface LabelResolutionInput {
  readonly label: unknown;
  /** Visibility_Safe 的稳定标识（如 `actionId`）。取不到时为 `undefined`。 */
  readonly stableIdentifier: string | undefined;
  /** 该呈现是否为交互控件或规则显著状态。是则缺回退时必须拒绝（Requirement 9.9）。 */
  readonly essential: boolean;
  readonly presentationLocation: string;
}

export type LabelResolution =
  | { readonly kind: 'label'; readonly text: string; readonly diagnostics: readonly UiDiagnostic[] }
  | { readonly kind: 'fallback'; readonly text: string; readonly diagnostics: readonly UiDiagnostic[] }
  | { readonly kind: 'omitted'; readonly text: string; readonly diagnostics: readonly UiDiagnostic[] }
  | { readonly kind: 'rejected'; readonly text: string; readonly diagnostics: readonly UiDiagnostic[] };

export function resolveAccessibleLabel(input: LabelResolutionInput): LabelResolution {
  if (!isLabelMissing(input.label)) {
    return Object.freeze({
      kind: 'label' as const,
      text: (input.label as string).trim(),
      diagnostics: Object.freeze([]),
    });
  }

  if (input.stableIdentifier !== undefined && input.stableIdentifier.length > 0) {
    return Object.freeze({
      kind: 'fallback' as const,
      text: input.stableIdentifier,
      diagnostics: Object.freeze([
        uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
          presentationLocation: input.presentationLocation,
          reason: '无障碍标签缺失，已回退到已验证的稳定标识',
          correctionSuggestion: '上游应提供本地化的 accessibleLabel；回退只保证可感知，不保证可读性',
        }),
      ]),
    });
  }
  if (!input.essential) {
    return Object.freeze({
      kind: 'omitted' as const,
      text: '',
      diagnostics: Object.freeze([
        uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
          presentationLocation: input.presentationLocation,
          reason: '非必要呈现缺无障碍标签且无可用回退，已省略该资源',
          correctionSuggestion: '保留语义文本或形状输出即可，无需为装饰性资源发明标签',
        }),
      ]),
    });
  }
  return Object.freeze({
    kind: 'rejected' as const,
    text: '',
    diagnostics: Object.freeze([
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.ACCESSIBLE_LABEL_MISSING,
        presentationLocation: input.presentationLocation,
        reason: '交互控件或规则显著状态缺无障碍标签，且连稳定标识都不可用',
        correctionSuggestion: '拒绝该呈现；底层规则状态保持不变，不得为了让控件可见而降级为警告',
      }),
    ]),
  });
}

/** 颜色之外的等价线索种类。颜色**不在**其中——它不能单独承载规则信息。 */
export const NON_COLOR_CUES = ['shape', 'texture', 'icon-structure', 'text'] as const;
export type NonColorCue = (typeof NON_COLOR_CUES)[number];

export interface SemanticCue {
  readonly semanticRoleId: string;
  readonly usesColor: boolean;
  readonly nonColorCues: readonly NonColorCue[];
  readonly presentationLocation: string;
}

/**
 * 颜色区分语义角色时，必须至少有一个非颜色等价线索（Requirement 11.2、11.3）。
 *
 * 违规产出 `error`：颜色是唯一线索意味着一部分玩家拿不到规则信息，这不是可降级的表现问题。
 */
export function checkNonColorEquivalent(cue: SemanticCue): readonly UiDiagnostic[] {
  if (!cue.usesColor || cue.nonColorCues.length > 0) return Object.freeze([]);
  return Object.freeze([
    uiDiagnostic({
      code: UI_DIAGNOSTIC_CODES.ACCESSIBLE_LABEL_MISSING,
      presentationLocation: cue.presentationLocation,
      reason: `语义角色 ${cue.semanticRoleId} 仅以颜色区分，缺少非颜色等价线索`,
      correctionSuggestion: '至少补一项形状、纹理、图标结构或文本线索',
    }),
  ]);
}

export const PRESENTATION_CHANNELS = [
  'visual',
  'screen-reader',
  'captions',
  'audio',
  'haptics',
  'animation',
] as const;
export type PresentationChannel = (typeof PRESENTATION_CHANNELS)[number];

export const RULE_SIGNIFICANT_KINDS = [
  'action',
  'resource',
  'salient-state',
  'decision',
  'turn-order',
] as const;
export type RuleSignificantKind = (typeof RULE_SIGNIFICANT_KINDS)[number];

export interface RuleSignificantItem {
  readonly itemId: string;
  readonly kind: RuleSignificantKind;
  readonly accessibleLabel: string;
}

/**
 * 从已过滤视图抽取全部规则显著项。
 *
 * `hidden` 档的显著状态不进入任何通道：它对所有者以外的观察者必须"逐项等同于不存在"
 * （Requirement 3.13）。这不是第二次可见性判定，而是尊重描述符已声明的分层。
 */
export function ruleSignificantItems(view: UiView): readonly RuleSignificantItem[] {
  const items: RuleSignificantItem[] = [];
  for (const action of view.actions) {
    items.push({ itemId: `action:${action.actionId}`, kind: 'action', accessibleLabel: action.accessibleLabel });
  }
  for (const entity of view.entities) {
    for (const resource of entity.resources) {
      items.push({
        itemId: `resource:${resource.entityId}:${resource.role}`,
        kind: 'resource',
        accessibleLabel: resource.accessibleLabel,
      });
    }
    for (const state of entity.salientStates) {
      if (state.tier === 'hidden') continue;
      items.push({
        itemId: `salient:${state.ownerEntityId}:${state.stateSemanticId}`,
        kind: 'salient-state',
        accessibleLabel: state.accessibleLabel,
      });
    }
  }
  for (const decision of view.decisions) {
    items.push({
      itemId: `decision:${decision.decisionId}`,
      kind: 'decision',
      accessibleLabel: decision.accessibleLabel,
    });
  }
  for (const entry of view.turnOrder) {
    items.push({
      itemId: `turn:${entry.participantId}`,
      kind: 'turn-order',
      accessibleLabel: entry.accessibleLabel,
    });
  }
  return Object.freeze(
    items.sort((left, right) => (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0)),
  );
}

export interface AriaEntry {
  readonly itemId: string;
  readonly role: RuleSignificantKind;
  readonly label: string;
}

export interface AccessibleOutputs {
  readonly visual: readonly RuleSignificantItem[];
  readonly screenReader: readonly string[];
  readonly captions: readonly string[];
  readonly ariaMetadata: readonly AriaEntry[];
  readonly hapticPatterns: readonly string[];
  readonly reducedMotionAlternatives: readonly string[];
  readonly diagnostics: readonly UiDiagnostic[];
}

export interface AccessibleOutputOptions {
  /** 失效的呈现通道（资源加载失败、设备不支持等）。 */
  readonly failedChannels: readonly PresentationChannel[];
  readonly reducedMotion: boolean;
}

/**
 * 构造各通道输出。
 *
 * 关键性质：动画、音频、触觉失效**不会**减少 `screenReader` / `captions` / `ariaMetadata`
 * 的条目——每个规则显著结果都仍有无障碍等价物（Requirement 11.10）。反过来，这些通道也
 * 不会因为"多知道一点"而编码隐藏状态：它们全部从同一份已过滤视图派生（Requirement 11.11）。
 */
export function buildAccessibleOutputs(
  view: UiView,
  options: AccessibleOutputOptions,
): AccessibleOutputs {
  const items = ruleSignificantItems(view);
  const failed = new Set(options.failedChannels);
  const labels = items.map((item) => item.accessibleLabel);
  return Object.freeze({
    visual: failed.has('visual') ? Object.freeze([]) : items,
    screenReader: Object.freeze([...labels]),
    captions: Object.freeze([...labels]),
    ariaMetadata: Object.freeze(
      items.map((item) => Object.freeze({ itemId: item.itemId, role: item.kind, label: item.accessibleLabel })),
    ),
    hapticPatterns: failed.has('haptics')
      ? Object.freeze([])
      : Object.freeze(items.map((item) => `pattern:${item.kind}`)),
    reducedMotionAlternatives: options.reducedMotion
      ? Object.freeze(items.map((item) => `static:${item.itemId}`))
      : Object.freeze([]),
    diagnostics: Object.freeze([]),
  });
}
