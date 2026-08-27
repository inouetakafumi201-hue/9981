/**
 * 显著性分层解析与冲突拒绝（design.md §6.4、J-4，tasks.md 任务 4.5）。
 *
 * 三条约束：
 * 1. 分层**只从显式描述符字段读取**，不从规则效果推断（Requirement 3.10）。因此本文件唯一
 *    的分层来源是 profile 的 `salienceTiers`，没有任何"根据效果猜档位"的分支。
 * 2. profile 声明的分层与规则层可见性分类矛盾时**拒绝该条目**并产出 `SALIENCE_TIER_CONFLICT`
 *    （Requirement 3.14）。表现层只能在规则允许的范围内决定"多显眼"，不能决定"是否可见"，
 *    所以两个方向的矛盾都算冲突：把规则层隐藏的状态标成公开档，或把规则层公开的状态标成
 *    `hidden`，都被拒绝。
 * 3. `hidden` 档对所有者以外的观察者**不产生任何呈现输出**，包括顺序、计数、动画选择与时序
 *    （Requirement 3.13、6.15）——本模块直接把它从输出列表里剔除，而不是输出一个"占位但不渲染"
 *    的条目，否则计数与顺序就会泄漏它的存在。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  uiOk,
  uiRejected,
  type UiDiagnostic,
  type UiResult,
} from '../model/diagnostic';
import { findSalienceTierEntry, type PresentationProfile, type SalienceTier } from '../model/profile';
import type { UiSalientStateView } from '../model/view';

/** 规则层可见性分类。由上游投影给出，不由表现层判定。 */
export const RULE_VISIBILITY_CLASSES = ['public', 'hidden'] as const;
export type RuleVisibilityClass = (typeof RULE_VISIBILITY_CLASSES)[number];

export interface SalientStateDeclaration {
  readonly stateSemanticId: string;
  readonly ownerEntityId: string;
  readonly accessibleLabel: string;
  /** 规则层的可见性判定结果，来自已验证投影。 */
  readonly ruleVisibility: RuleVisibilityClass;
}

export interface SalienceTierResolutionInput {
  readonly stateSemanticId: string;
  readonly profile: PresentationProfile;
  readonly ruleVisibility: RuleVisibilityClass;
  readonly presentationLocation: string;
}

/** 分层与规则层可见性是否矛盾。`hidden` 档必须与规则层隐藏一一对应。 */
export function conflictsWithRuleVisibility(
  tier: SalienceTier,
  ruleVisibility: RuleVisibilityClass,
): boolean {
  return (tier === 'hidden') !== (ruleVisibility === 'hidden');
}

export function resolveSalienceTier(input: SalienceTierResolutionInput): UiResult<SalienceTier> {
  const entry = findSalienceTierEntry(input.profile, input.stateSemanticId);
  if (entry === undefined) {
    return uiRejected([
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.DESCRIPTOR_SEMANTIC_FIELD_MISSING,
        presentationLocation: input.presentationLocation,
        reason: `状态 ${input.stateSemanticId} 没有显式的显著性分层声明`,
        correctionSuggestion: '在 Presentation_Profile 的 salienceTiers 中显式声明该状态的档位；不得在运行期默认档位',
      }),
    ]);
  }
  if (conflictsWithRuleVisibility(entry.tier, input.ruleVisibility)) {
    return uiRejected([
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.SALIENCE_TIER_CONFLICT,
        presentationLocation: input.presentationLocation,
        reason: `profile 把状态 ${input.stateSemanticId} 标为 ${entry.tier}，与规则层可见性分类 ${input.ruleVisibility} 矛盾`,
        correctionSuggestion: '表现层只能决定"多显眼"，不能决定"是否可见"；请改 profile 或复核规则层判定',
      }),
    ]);
  }
  if (entry.tier === 'hidden' && entry.renderer !== null) {
    return uiRejected([
      uiDiagnostic({
        code: UI_DIAGNOSTIC_CODES.SALIENCE_TIER_CONFLICT,
        presentationLocation: input.presentationLocation,
        reason: `hidden 档的状态 ${input.stateSemanticId} 声明了渲染器，真隐藏不得产生任何呈现输出`,
        correctionSuggestion: 'hidden 档的 renderer 必须为 null',
      }),
    ]);
  }
  return uiOk(entry.tier);
}

export interface SalienceResolutionInput {
  readonly declarations: readonly SalientStateDeclaration[];
  readonly profile: PresentationProfile;
  /** 当前观察者控制的实体标识集合。用于判定"是否为该状态的所有者"。 */
  readonly observerOwnedEntityIds: readonly string[];
}

export interface SalienceResolution {
  readonly views: readonly UiSalientStateView[];
  readonly diagnostics: readonly UiDiagnostic[];
}

/**
 * 解析一组显著状态的呈现项。
 *
 * `hidden` 档且观察者不是所有者时，该条目**完全不进入返回列表**：输出的长度、顺序与内容
 * 都与"该状态不存在"时逐项相等。这正是 Property 7 的断言方式。
 */
export function resolveSalientStates(input: SalienceResolutionInput): SalienceResolution {
  const owned = new Set(input.observerOwnedEntityIds);
  const views: UiSalientStateView[] = [];
  const diagnostics: UiDiagnostic[] = [];
  for (const declaration of input.declarations) {
    const location = `presentation/salience#${declaration.stateSemanticId}`;
    const tier = resolveSalienceTier({
      stateSemanticId: declaration.stateSemanticId,
      profile: input.profile,
      ruleVisibility: declaration.ruleVisibility,
      presentationLocation: location,
    });
    if (!tier.ok) {
      diagnostics.push(...tier.diagnostics);
      continue;
    }
    if (tier.value === 'hidden' && !owned.has(declaration.ownerEntityId)) continue;
    const entry = findSalienceTierEntry(input.profile, declaration.stateSemanticId);
    views.push(
      Object.freeze({
        stateSemanticId: declaration.stateSemanticId,
        ownerEntityId: declaration.ownerEntityId,
        tier: tier.value,
        renderer: entry?.renderer ?? null,
        accessibleLabel: declaration.accessibleLabel,
      }),
    );
  }
  return Object.freeze({
    views: Object.freeze(
      views.sort((left, right) =>
        left.stateSemanticId < right.stateSemanticId
          ? -1
          : left.stateSemanticId > right.stateSemanticId
            ? 1
            : 0,
      ),
    ),
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * `public-on-inspect` 的检视结果。
 *
 * 检视是**纯本地操作**：不产生 `Interaction_Intent`、不消耗资源、不改变语义状态
 * （Requirement 3.12、§6.4）。返回类型把这三点写成字面量 `false`，因此任何"检视顺带提交"
 * 的实现都无法通过类型检查。
 */
export interface InspectOutcome {
  readonly presented: boolean;
  readonly producedIntent: false;
  readonly consumedResources: false;
  readonly changedSemanticState: false;
}

export function inspect(state: UiSalientStateView): InspectOutcome {
  return Object.freeze({
    presented: state.tier === 'public-on-inspect' || state.tier === 'public-persistent',
    producedIntent: false as const,
    consumedResources: false as const,
    changedSemanticState: false as const,
  });
}
