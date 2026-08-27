/**
 * 仪式演出选择（design.md §9.2、§9.3、§16.3，tasks.md 任务 6.2）。
 *
 * 本模块只消费已确认的呈现配置与已投影结算分支。它不判断动作是否合法、不读取成本，
 * 也不改变任何规则状态。集合外语义以及招架的静默失效分支均返回空输出。
 */

import type { PresentationProfile } from '../model/profile';

export const DEFAULT_CEREMONIAL_ACTION_SEMANTICS = [
  'vault-window',
  'jump-window',
  'lay-to-rest',
  'parry-trigger',
] as const;
export type DefaultCeremonialActionSemantic =
  (typeof DEFAULT_CEREMONIAL_ACTION_SEMANTICS)[number];

export const CEREMONIAL_RESOLUTION_BRANCHES = [
  'resolved',
  'received-melee-attack',
  'received-ranged-attack',
  'received-unparryable-damage',
] as const;
export type CeremonialResolutionBranch =
  (typeof CEREMONIAL_RESOLUTION_BRANCHES)[number];

export const CEREMONIAL_PRESENTATION_MODES = [
  'standard',
  'user-skipped',
  'reduced-motion',
  'resource-fallback',
] as const;
export type CeremonialPresentationMode =
  (typeof CEREMONIAL_PRESENTATION_MODES)[number];

export const CEREMONIAL_CUE_KINDS = [
  'fullscreen',
  'static-equivalent',
  'accessible-announcement',
  'resource-fallback',
] as const;
export type CeremonialCueKind = (typeof CEREMONIAL_CUE_KINDS)[number];

/** 只能由调用方从已经对当前 Agent 可见的稳定投影标识构造。 */
export type VisibleStableId = string & { readonly __brand: 'VisibleStableId' };

export function visibleStableIdFromProjection(value: string): VisibleStableId {
  if (value.length === 0) throw new Error('visible stable id must not be empty');
  return value as VisibleStableId;
}

export interface CeremonialCue {
  readonly kind: CeremonialCueKind;
  readonly actionSemanticId: string;
  readonly fullscreen: boolean;
  readonly decorationVariant: number;
  readonly accessibleLabel: string;
  /** 三个字面量使演出结果无法伪装成规则迁移。 */
  readonly changedSemanticState: false;
  readonly changedLegality: false;
  readonly changedCost: false;
}

export interface CeremonialPlanInput {
  readonly actionSemanticId: string;
  readonly resolutionBranch: CeremonialResolutionBranch;
  readonly profile: PresentationProfile;
  readonly mode: CeremonialPresentationMode;
  readonly visibleStableId: VisibleStableId;
  readonly decorationVariantCount?: number;
  readonly accessibleLabel: string;
}

/**
 * FNV-1a 32-bit 确定性散列。只消费可见稳定标识；没有随机源参数，因此不会推进权威随机流。
 */
export function stableHash(value: VisibleStableId): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function deriveDecorationVariant(
  stableId: VisibleStableId,
  variantCount: number,
): number {
  if (!Number.isSafeInteger(variantCount) || variantCount < 1) {
    throw new Error('decoration variant count must be a positive safe integer');
  }
  return stableHash(stableId) % variantCount;
}

function isRegistered(profile: PresentationProfile, actionSemanticId: string): boolean {
  return profile.ceremonialActionSemantics.some(
    (entry) => entry.actionSemanticId === actionSemanticId,
  );
}

function isSilentParryLapse(input: CeremonialPlanInput): boolean {
  return (
    input.actionSemanticId === 'parry-trigger' &&
    input.resolutionBranch !== 'received-melee-attack'
  );
}

function cueKindFor(mode: CeremonialPresentationMode): CeremonialCueKind {
  switch (mode) {
    case 'standard':
      return 'fullscreen';
    case 'user-skipped':
      return 'accessible-announcement';
    case 'reduced-motion':
      return 'static-equivalent';
    case 'resource-fallback':
      return 'resource-fallback';
  }
}

/**
 * 返回零项或恰好一项呈现指令。零项只有两种情况：集合外语义，或招架静默失效。
 * 跳过、减少动态与资源失败只替换呈现形式，不改变动作结算结果。
 */
export function planCeremonialPresentation(
  input: CeremonialPlanInput,
): readonly CeremonialCue[] {
  if (!isRegistered(input.profile, input.actionSemanticId) || isSilentParryLapse(input)) {
    return Object.freeze([]);
  }
  const kind = cueKindFor(input.mode);
  const variantCount = input.decorationVariantCount ?? 1;
  return Object.freeze([
    Object.freeze({
      kind,
      actionSemanticId: input.actionSemanticId,
      fullscreen: kind === 'fullscreen',
      decorationVariant: deriveDecorationVariant(input.visibleStableId, variantCount),
      accessibleLabel: input.accessibleLabel,
      changedSemanticState: false as const,
      changedLegality: false as const,
      changedCost: false as const,
    }),
  ]);
}
