/**
 * `Presentation_Profile` schema（design.md §4.5、tasks.md 任务 1.6）。
 *
 * profile 是「装载期声明式配置」，不是运行期状态：它只声明呈现规则本身的形状
 * （哪些动作有仪式化演出、哪些规则状态用什么显著性分层、缓冲超时是多少），
 * 不含任何玩法数值字段（数值字段属于 `GameplayValue`/`InternalMetric`，不在本文件）、
 * 不含任何规则语义字段（"这条规则做什么"是内核/L2 的职责，profile 只登记"怎么呈现"）。
 *
 * `salienceTiers[]` 与 `view.ts` 的 `SalienceTier` 是同一个类型（本文件是权威定义，
 * `view.ts` 从这里 import），因为分层只能从 profile 声明读取，不得从规则效果推断
 * （Requirement 3.10）——如果两处各自定义一份，就会出现"运行时用的分层"与"profile 声明
 * 的分层"两个真相源，那正是本文件要杜绝的失效形态。
 */

import type { InternalMetric } from '../presentation/gameplay-value.js';

/**
 * 显著性分层。三档闭合枚举，语义分别是：
 * - `public-persistent`：始终可见，不需要交互触发。
 * - `public-on-inspect`：默认不占屏幕空间，检视触发后才呈现。
 * - `hidden`：不呈现给非授权 Agent；只对已获得对应 `AuthorizationScope` 的 Agent 可见。
 *
 * 不使用数值等级（如 1-5）表达分层，因为分层不是玩法数值，混用会让 `GameplayValue` 的
 * 范围校验误吞并这里的语义（design.md §4.5）。
 */
export const SALIENCE_TIERS = ['public-persistent', 'public-on-inspect', 'hidden'] as const;
export type SalienceTier = (typeof SALIENCE_TIERS)[number];

export function isSalienceTier(candidate: unknown): candidate is SalienceTier {
  return typeof candidate === 'string' && (SALIENCE_TIERS as readonly string[]).includes(candidate);
}

/**
 * 仪式化动作语义登记项。
 *
 * `authoritativeSource` 是必填项，不是可选的文档字段：它记录"谁裁定这个动作需要仪式化演出"
 * （例如某条访谈决策编号或设计文档章节），使"为什么这个动作有特殊演出"可追溯，
 * 不依赖开发者口头约定（design.md §4.5、Requirement 11.3）。
 */
export interface CeremonialActionSemantics {
  readonly actionSemanticId: string;
  readonly authoritativeSource: string;
}

/**
 * 规则显著状态的分层声明项。
 *
 * `renderer` 允许为 `null`（表示"分层已声明但暂无专用渲染器，退化为默认呈现"），
 * 但 `tier` 不允许缺省——分层缺省等价于"不知道该不该呈现"，必须在装载期拒绝而不是
 * 在运行期默认成某一档（呼应 `view.ts` 的 `UiSalientStateView.tier` 为必填非可选）。
 */
export interface SalienceTierDeclaration {
  readonly stateSemanticId: string;
  readonly tier: SalienceTier;
  readonly renderer: string | null;
}

/** 回合栏呈现配置。纯呈现开关，不含任何回合推进逻辑（那是内核 L9 Schedule 的职责）。 */
export interface TurnOrderBarConfig {
  readonly visible: boolean;
  readonly showPortraits: boolean;
  readonly showSpentIndicator: boolean;
}

/** 回合末倒计时呈现配置。 */
export interface EndTurnCountdownConfig {
  readonly visible: boolean;
  /** 倒计时的呈现精度（如 'seconds' | 'deciseconds'），非玩法数值，不受 1-5 约束。 */
  readonly displayPrecision: string;
}

/**
 * 安全字段白名单。与 `event-projection.ts` 的 `projectSafePayload` 消费的白名单是同一形状
 * （字段名的只读数组），但那里的白名单是运行期传入的参数，这里是 profile 声明的**默认**白名单，
 * 二者不是同一个值——profile 只提供缺省来源，调用方仍可显式传入更窄的白名单。
 */
export type SafeFieldWhitelist = readonly string[];

/**
 * 安全化的不可用原因文案登记表。键是内部原因码，值是可直接呈现给玩家的文案。
 * 不在此表中的原因码必须在呈现前被安全化模块拒绝（不得原样透传未登记文案）。
 */
export type SafeUnavailabilityReasons = Readonly<Record<string, string>>;

/**
 * Presentation_Profile。装载期声明式配置的顶层形状。
 *
 * 所有集合字段都是只读类型（`readonly` 数组/记录），防止运行期对已装载的 profile 做
 * 就地修改——profile 一旦装载即不可变，修改呈现规则必须走"重新装载新 profile"。
 */
export interface PresentationProfile {
  /** 视觉方向标识（如美术风格代号），开放字符串，不做枚举校验（呼应 `posture` 的 J-15 处理方式）。 */
  readonly visualDirection: string;
  readonly ceremonialActionSemantics: readonly CeremonialActionSemantics[];
  readonly salienceTiers: readonly SalienceTierDeclaration[];
  readonly turnOrderBar: TurnOrderBarConfig;
  readonly endTurnCountdown: EndTurnCountdownConfig;
  readonly safeFieldWhitelist: SafeFieldWhitelist;
  readonly safeUnavailabilityReasons: SafeUnavailabilityReasons;
  /** 演出事件缓冲超时。是内部度量（毫秒等），不是玩法数值，因此类型为 `InternalMetric`。 */
  readonly eventBufferTimeout: InternalMetric<number>;
}

/** 冻结并规范化集合字段，防止调用方传入的可变数组/对象被后续修改污染已装载的 profile。 */
export function freezePresentationProfile(profile: PresentationProfile): PresentationProfile {
  return Object.freeze({
    ...profile,
    ceremonialActionSemantics: Object.freeze(
      profile.ceremonialActionSemantics.map((item) => Object.freeze({ ...item })),
    ),
    salienceTiers: Object.freeze(profile.salienceTiers.map((item) => Object.freeze({ ...item }))),
    turnOrderBar: Object.freeze({ ...profile.turnOrderBar }),
    endTurnCountdown: Object.freeze({ ...profile.endTurnCountdown }),
    safeFieldWhitelist: Object.freeze([...profile.safeFieldWhitelist]),
    safeUnavailabilityReasons: Object.freeze({ ...profile.safeUnavailabilityReasons }),
    eventBufferTimeout: Object.freeze({ ...profile.eventBufferTimeout }),
  });
}

/** 按 `stateSemanticId` 查找分层声明；未登记时返回 `undefined`（调用方必须拒绝，不得默认档位）。 */
export function findSalienceTierDeclaration(
  profile: PresentationProfile,
  stateSemanticId: string,
): SalienceTierDeclaration | undefined {
  return profile.salienceTiers.find((item) => item.stateSemanticId === stateSemanticId);
}
