/**
 * Presentation_Profile 严格装载器（design.md §9.2、§13，tasks.md 任务 7.2）。
 *
 * 原始文本先通过内核 StrictJsonCodec，因而重复键、危险可执行键、非有限数字与配额越界
 * 在任何 profile 语义校验前即被拒绝。随后执行闭合结构、来源、规则字段与显著性冲突校验。
 */

import { JsonCodecError, StrictJsonCodec } from '../../core/kernel/spec-compiler/json-codec.js';
import {
  DEFAULT_TECHNICAL_QUOTAS,
  type JsonValue,
} from '../../core/kernel/spec-compiler/types.js';
import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  uiOk,
  uiRejected,
  type UiDiagnostic,
  type UiResult,
} from '../model/diagnostic.js';
import {
  CONFIRMED_DECISION_IDS,
  SALIENCE_TIERS,
  freezePresentationProfile,
  type ConfirmedDecisionId,
  type PresentationProfile,
  type SalienceTier,
} from '../model/profile.js';
import { makeInternalMetric } from '../presentation/gameplay-value.js';

export type ProfileRuleVisibility = 'public' | 'hidden';

export interface ProfileLoaderOptions {
  readonly sourceId?: string;
  readonly confirmedDecisionIds?: readonly string[];
  readonly ruleVisibilityByStateSemanticId?: Readonly<Record<string, ProfileRuleVisibility>>;
}

const DEFAULT_RULE_VISIBILITY: Readonly<Record<string, ProfileRuleVisibility>> = Object.freeze({
  weakness: 'public',
  aiming: 'public',
  'parry-ready': 'hidden',
});

const TOP_LEVEL_FIELDS = new Set([
  'version',
  'visualDirection',
  'ceremonialActionSemantics',
  'salienceTiers',
  'turnOrderBar',
  'endTurnCountdown',
  'safeFieldWhitelist',
  'safeUnavailabilityReasons',
  'eventBufferTimeout',
]);

const RULE_SEMANTIC_FIELD = /(?:damage|apcost|hitbonus|difficultyclass|legality|forcevisible|visibilityoverride|alwaysenabled|effectstrength|randomresult|topology|cooldown)/iu;
const INTERNAL_NUMERIC_PATHS = new Set(['/endTurnCountdown/seconds', '/eventBufferTimeout']);

function isObject(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function at(object: Readonly<Record<string, JsonValue>>, key: string): JsonValue | undefined {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

function semanticDiagnostic(path: string, reason: string): UiDiagnostic {
  return uiDiagnostic({
    code: UI_DIAGNOSTIC_CODES.PROFILE_RULE_SEMANTIC_FIELD,
    presentationLocation: `profile${path}`,
    reason,
    correctionSuggestion: '移除规则语义或玩家可见数值；profile 只能承载可替换的表现配置',
  });
}

function damagedDiagnostic(path: string, reason: string): UiDiagnostic {
  return uiDiagnostic({
    code: UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
    presentationLocation: `profile${path}`,
    reason,
    correctionSuggestion: '按 Presentation_Profile 的闭合结构修正字段类型与取值',
  });
}

function missingDiagnostic(path: string): UiDiagnostic {
  return uiDiagnostic({
    code: UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_MISSING,
    presentationLocation: `profile${path}`,
    reason: `profile 必填字段 ${path} 缺失`,
    correctionSuggestion: '补齐 Presentation_Profile 必填字段',
  });
}

function inspectForbiddenContent(
  value: JsonValue,
  path: string,
  diagnostics: UiDiagnostic[],
): void {
  if (typeof value === 'number' && !INTERNAL_NUMERIC_PATHS.has(path)) {
    diagnostics.push(semanticDiagnostic(path, `profile 在 ${path} 出现未分类的玩家可见数值字面量`));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForbiddenContent(item, `${path}/${index}`, diagnostics));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[-_\s]/gu, '');
    if (RULE_SEMANTIC_FIELD.test(normalized)) {
      diagnostics.push(semanticDiagnostic(`${path}/${key}`, `profile 字段 ${key} 属于规则语义或规则覆盖声明`));
      continue;
    }
    inspectForbiddenContent(child, `${path}/${key}`, diagnostics);
  }
}

function requireObject(
  object: Readonly<Record<string, JsonValue>>,
  key: string,
  path: string,
  diagnostics: UiDiagnostic[],
): Readonly<Record<string, JsonValue>> | undefined {
  const value = at(object, key);
  if (value === undefined) diagnostics.push(missingDiagnostic(`${path}/${key}`));
  else if (!isObject(value)) diagnostics.push(damagedDiagnostic(`${path}/${key}`, `${key} 必须是映射`));
  else return value;
  return undefined;
}

function requireArray(
  object: Readonly<Record<string, JsonValue>>,
  key: string,
  path: string,
  diagnostics: UiDiagnostic[],
): readonly JsonValue[] | undefined {
  const value = at(object, key);
  if (value === undefined) diagnostics.push(missingDiagnostic(`${path}/${key}`));
  else if (!Array.isArray(value)) diagnostics.push(damagedDiagnostic(`${path}/${key}`, `${key} 必须是数组`));
  else return value;
  return undefined;
}

function requireString(
  object: Readonly<Record<string, JsonValue>>,
  key: string,
  path: string,
  diagnostics: UiDiagnostic[],
): string | undefined {
  const value = at(object, key);
  if (value === undefined) diagnostics.push(missingDiagnostic(`${path}/${key}`));
  else if (typeof value !== 'string' || value.length === 0) {
    diagnostics.push(damagedDiagnostic(`${path}/${key}`, `${key} 必须是非空字符串`));
  } else return value;
  return undefined;
}

function requireBoolean(
  object: Readonly<Record<string, JsonValue>>,
  key: string,
  path: string,
  diagnostics: UiDiagnostic[],
): boolean | undefined {
  const value = at(object, key);
  if (value === undefined) diagnostics.push(missingDiagnostic(`${path}/${key}`));
  else if (typeof value !== 'boolean') diagnostics.push(damagedDiagnostic(`${path}/${key}`, `${key} 必须是布尔值`));
  else return value;
  return undefined;
}

function rejectUnknownFields(
  object: Readonly<Record<string, JsonValue>>,
  allowed: ReadonlySet<string>,
  path: string,
  diagnostics: UiDiagnostic[],
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) diagnostics.push(damagedDiagnostic(`${path}/${key}`, `profile 出现未声明字段 ${key}`));
  }
}

function sourceIsConfirmed(source: string, confirmed: ReadonlySet<string>): boolean {
  return confirmed.has(source);
}

function parseCodec(sourceText: string, sourceId: string): JsonValue {
  return new StrictJsonCodec().parse(
    {
      sourceId,
      documentUri: sourceId,
      sourcePackage: 'wakeup-ui-presentation-profile',
      sourceText,
      precedence: 0,
      owningLayer: '玩法层',
      normativeStatus: 'normative',
    },
    DEFAULT_TECHNICAL_QUOTAS,
  ).value;
}

function codecFailure(error: JsonCodecError): UiResult<PresentationProfile> {
  return uiRejected([
    uiDiagnostic({
      code: UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
      presentationLocation: `profile${error.path}`,
      reason: `严格 JSON 解析拒绝输入：${error.message}`,
      correctionSuggestion: '移除重复成员、危险构造或损坏的 JSON 语法后重试',
      internalFields: { parserCode: error.code },
    }),
  ]);
}

export function loadPresentationProfile(
  sourceText: string,
  options: ProfileLoaderOptions = {},
): UiResult<PresentationProfile> {
  const sourceId = options.sourceId ?? 'wakeup-default.profile.json';
  let parsed: JsonValue;
  try {
    parsed = parseCodec(sourceText, sourceId);
  } catch (error) {
    if (error instanceof JsonCodecError) return codecFailure(error);
    throw error;
  }

  if (!isObject(parsed)) {
    return uiRejected([damagedDiagnostic('', 'Presentation_Profile 根必须是映射')]);
  }

  const diagnostics: UiDiagnostic[] = [];
  inspectForbiddenContent(parsed, '', diagnostics);
  rejectUnknownFields(parsed, TOP_LEVEL_FIELDS, '', diagnostics);
  if (diagnostics.length > 0) return uiRejected(diagnostics);

  const confirmed = new Set(options.confirmedDecisionIds ?? CONFIRMED_DECISION_IDS);
  const ruleVisibility = options.ruleVisibilityByStateSemanticId ?? DEFAULT_RULE_VISIBILITY;

  const version = requireString(parsed, 'version', '', diagnostics);
  const visual = requireObject(parsed, 'visualDirection', '', diagnostics);
  const ceremonies = requireArray(parsed, 'ceremonialActionSemantics', '', diagnostics);
  const salience = requireArray(parsed, 'salienceTiers', '', diagnostics);
  const turnOrder = requireObject(parsed, 'turnOrderBar', '', diagnostics);
  const countdown = requireObject(parsed, 'endTurnCountdown', '', diagnostics);
  const whitelist = requireArray(parsed, 'safeFieldWhitelist', '', diagnostics);
  const reasons = requireObject(parsed, 'safeUnavailabilityReasons', '', diagnostics);
  const timeout = at(parsed, 'eventBufferTimeout');
  if (timeout === undefined) diagnostics.push(missingDiagnostic('/eventBufferTimeout'));
  else if (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout < 0) {
    diagnostics.push(damagedDiagnostic('/eventBufferTimeout', 'eventBufferTimeout 必须是非负安全整数'));
  }

  const visualFields = new Set(['interactionComponents', 'mapBackground', 'compositing', 'authoritativeSource']);
  if (visual !== undefined) rejectUnknownFields(visual, visualFields, '/visualDirection', diagnostics);
  const interactionComponents = visual === undefined ? undefined : requireString(visual, 'interactionComponents', '/visualDirection', diagnostics);
  const mapBackground = visual === undefined ? undefined : requireString(visual, 'mapBackground', '/visualDirection', diagnostics);
  const compositing = visual === undefined ? undefined : requireString(visual, 'compositing', '/visualDirection', diagnostics);
  const visualSource = visual === undefined ? undefined : requireString(visual, 'authoritativeSource', '/visualDirection', diagnostics);
  if (visualSource !== undefined && !sourceIsConfirmed(visualSource, confirmed)) {
    diagnostics.push(damagedDiagnostic('/visualDirection/authoritativeSource', `决策编号 ${visualSource} 未确认`));
  }

  const ceremonyEntries: Array<{ actionSemanticId: string; authoritativeSource: ConfirmedDecisionId }> = [];
  const ceremonyIds = new Set<string>();
  ceremonies?.forEach((candidate, index) => {
    const path = `/ceremonialActionSemantics/${index}`;
    if (!isObject(candidate)) {
      diagnostics.push(damagedDiagnostic(path, '仪式动作项必须是映射'));
      return;
    }
    rejectUnknownFields(candidate, new Set(['actionSemanticId', 'authoritativeSource']), path, diagnostics);
    const actionSemanticId = requireString(candidate, 'actionSemanticId', path, diagnostics);
    const source = at(candidate, 'authoritativeSource');
    if (typeof source !== 'string' || !sourceIsConfirmed(source, confirmed)) {
      diagnostics.push(
        uiDiagnostic({
          code: UI_DIAGNOSTIC_CODES.CEREMONIAL_SOURCE_MISSING,
          presentationLocation: `profile${path}/authoritativeSource`,
          reason: typeof source === 'string' ? `仪式动作来源 ${source} 不在已确认决策目录中` : '仪式动作缺少 authoritativeSource',
          correctionSuggestion: '为仪式动作提供已确认决策编号；未确认条目不得装载',
        }),
      );
      return;
    }
    if (actionSemanticId === undefined) return;
    if (ceremonyIds.has(actionSemanticId)) {
      diagnostics.push(damagedDiagnostic(`${path}/actionSemanticId`, `仪式动作 ${actionSemanticId} 重复登记`));
      return;
    }
    ceremonyIds.add(actionSemanticId);
    ceremonyEntries.push({
      actionSemanticId,
      authoritativeSource: source as ConfirmedDecisionId,
    });
  });

  const salienceEntries: Array<{
    stateSemanticId: string;
    tier: SalienceTier;
    renderer: string | null;
    authoritativeSource: ConfirmedDecisionId;
  }> = [];
  salience?.forEach((candidate, index) => {
    const path = `/salienceTiers/${index}`;
    if (!isObject(candidate)) {
      diagnostics.push(damagedDiagnostic(path, '显著性分层项必须是映射'));
      return;
    }
    rejectUnknownFields(candidate, new Set(['stateSemanticId', 'tier', 'renderer', 'authoritativeSource']), path, diagnostics);
    const stateSemanticId = requireString(candidate, 'stateSemanticId', path, diagnostics);
    const tierValue = requireString(candidate, 'tier', path, diagnostics);
    const source = requireString(candidate, 'authoritativeSource', path, diagnostics);
    const renderer = at(candidate, 'renderer');
    if (renderer !== null && typeof renderer !== 'string') {
      diagnostics.push(damagedDiagnostic(`${path}/renderer`, 'renderer 必须是字符串或 null'));
    }
    if (tierValue !== undefined && !(SALIENCE_TIERS as readonly string[]).includes(tierValue)) {
      diagnostics.push(damagedDiagnostic(`${path}/tier`, `未知显著性档位 ${tierValue}`));
    }
    if (source !== undefined && !sourceIsConfirmed(source, confirmed)) {
      diagnostics.push(damagedDiagnostic(`${path}/authoritativeSource`, `决策编号 ${source} 未确认`));
    }
    if (stateSemanticId !== undefined && tierValue !== undefined) {
      const expected = ruleVisibility[stateSemanticId];
      const conflict = expected !== undefined && ((tierValue === 'hidden') !== (expected === 'hidden'));
      if (conflict || (tierValue === 'hidden' && renderer !== null)) {
        diagnostics.push(
          uiDiagnostic({
            code: UI_DIAGNOSTIC_CODES.SALIENCE_TIER_CONFLICT,
            presentationLocation: `profile${path}`,
            reason: `状态 ${stateSemanticId} 的显著性档位与规则可见性或真隐藏约束矛盾`,
            correctionSuggestion: '公开状态使用公开档；隐藏状态使用 hidden 且 renderer 为 null',
          }),
        );
      }
    }
    if (
      stateSemanticId !== undefined &&
      tierValue !== undefined &&
      (SALIENCE_TIERS as readonly string[]).includes(tierValue) &&
      source !== undefined &&
      sourceIsConfirmed(source, confirmed) &&
      (renderer === null || typeof renderer === 'string')
    ) {
      salienceEntries.push({
        stateSemanticId,
        tier: tierValue as SalienceTier,
        renderer,
        authoritativeSource: source as ConfirmedDecisionId,
      });
    }
  });

  const turnFields = new Set(['edge', 'persistent', 'entryFields', 'spentEntryTreatment', 'rollAnimationAnchor', 'authoritativeSource']);
  if (turnOrder !== undefined) rejectUnknownFields(turnOrder, turnFields, '/turnOrderBar', diagnostics);
  const edge = turnOrder === undefined ? undefined : requireString(turnOrder, 'edge', '/turnOrderBar', diagnostics);
  const persistent = turnOrder === undefined ? undefined : requireBoolean(turnOrder, 'persistent', '/turnOrderBar', diagnostics);
  const entryFields = turnOrder === undefined ? undefined : requireArray(turnOrder, 'entryFields', '/turnOrderBar', diagnostics);
  const spentEntryTreatment = turnOrder === undefined ? undefined : requireString(turnOrder, 'spentEntryTreatment', '/turnOrderBar', diagnostics);
  const rollAnimationAnchor = turnOrder === undefined ? undefined : requireString(turnOrder, 'rollAnimationAnchor', '/turnOrderBar', diagnostics);
  const turnSource = turnOrder === undefined ? undefined : requireString(turnOrder, 'authoritativeSource', '/turnOrderBar', diagnostics);
  if (edge !== undefined && !['left', 'right', 'top', 'bottom'].includes(edge)) diagnostics.push(damagedDiagnostic('/turnOrderBar/edge', `未知边缘 ${edge}`));
  const entryFieldStrings = entryFields?.filter((item): item is string => typeof item === 'string') ?? [];
  if (entryFields !== undefined && entryFieldStrings.length !== entryFields.length) diagnostics.push(damagedDiagnostic('/turnOrderBar/entryFields', 'entryFields 只能包含字符串'));
  for (const source of turnSource?.split(',').map((item) => item.trim()) ?? []) {
    if (!sourceIsConfirmed(source, confirmed)) diagnostics.push(damagedDiagnostic('/turnOrderBar/authoritativeSource', `决策编号 ${source} 未确认`));
  }

  const countdownFields = new Set(['seconds', 'cancellable', 'authoritativeSource']);
  if (countdown !== undefined) rejectUnknownFields(countdown, countdownFields, '/endTurnCountdown', diagnostics);
  const seconds = countdown === undefined ? undefined : at(countdown, 'seconds');
  if (seconds === undefined) diagnostics.push(missingDiagnostic('/endTurnCountdown/seconds'));
  else if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) diagnostics.push(damagedDiagnostic('/endTurnCountdown/seconds', 'seconds 必须是非负有限数'));
  const cancellable = countdown === undefined ? undefined : requireBoolean(countdown, 'cancellable', '/endTurnCountdown', diagnostics);
  const countdownSource = countdown === undefined ? undefined : requireString(countdown, 'authoritativeSource', '/endTurnCountdown', diagnostics);
  if (countdownSource !== undefined && !sourceIsConfirmed(countdownSource, confirmed)) diagnostics.push(damagedDiagnostic('/endTurnCountdown/authoritativeSource', `决策编号 ${countdownSource} 未确认`));

  const whitelistStrings = whitelist?.filter((item): item is string => typeof item === 'string') ?? [];
  if (whitelist !== undefined && whitelistStrings.length !== whitelist.length) diagnostics.push(damagedDiagnostic('/safeFieldWhitelist', 'safeFieldWhitelist 只能包含字符串'));
  const safeReasons: Record<string, string> = {};
  if (reasons !== undefined) {
    for (const [key, value] of Object.entries(reasons)) {
      if (typeof value !== 'string') diagnostics.push(damagedDiagnostic(`/safeUnavailabilityReasons/${key}`, '安全原因文案必须是字符串'));
      else safeReasons[key] = value;
    }
  }

  if (diagnostics.length > 0) return uiRejected(diagnostics);
  if (
    version === undefined || visual === undefined || interactionComponents === undefined ||
    mapBackground === undefined || compositing === undefined || visualSource === undefined ||
    turnOrder === undefined || edge === undefined || persistent === undefined ||
    spentEntryTreatment === undefined || rollAnimationAnchor === undefined || turnSource === undefined ||
    countdown === undefined || typeof seconds !== 'number' || cancellable === undefined ||
    countdownSource === undefined || typeof timeout !== 'number'
  ) {
    return uiRejected([damagedDiagnostic('', 'profile 校验未能构造完整结果')]);
  }

  return uiOk(
    freezePresentationProfile({
      version,
      visualDirection: {
        interactionComponents,
        mapBackground,
        compositing,
        authoritativeSource: visualSource as ConfirmedDecisionId,
      },
      ceremonialActionSemantics: ceremonyEntries,
      salienceTiers: salienceEntries,
      turnOrderBar: {
        edge: edge as 'left' | 'right' | 'top' | 'bottom',
        persistent,
        entryFields: entryFieldStrings,
        spentEntryTreatment,
        rollAnimationAnchor,
        authoritativeSource: turnSource,
      },
      endTurnCountdown: {
        seconds: makeInternalMetric(seconds, 's'),
        cancellable,
        authoritativeSource: countdownSource as ConfirmedDecisionId,
      },
      safeFieldWhitelist: whitelistStrings,
      safeUnavailabilityReasons: safeReasons,
      eventBufferTimeout: makeInternalMetric(timeout, 'ms'),
    }),
  );
}
