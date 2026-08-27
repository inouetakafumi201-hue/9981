/**
 * 受众分级诊断汇（design.md §12，tasks.md 任务 7.1）。
 *
 * 诊断在进入任何可观察表面前按 AuthorizedAgent 收窄。开发面只能增加技术字段，不能扩大
 * 实体集合；本地设置不能授予开发面或全知范围。重复项按稳定键折叠，不使用本地时钟。
 */

import type { UiDiagnostic, UiDiagnosticCode, UiDiagnosticSeverity } from '../model/diagnostic';
import type { StateRevision } from '../model/revision';
import type { AuthorizedAgent } from '../model/view';

export const DIAGNOSTIC_CATEGORIES = [
  'descriptor-rejection',
  'stale-interaction',
  'projection-gap',
  'resource-failure',
  'fallback-selection',
] as const;
export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number];

export const DIAGNOSTIC_SURFACES = ['user', 'authorized-dev'] as const;
export type DiagnosticSurface = (typeof DIAGNOSTIC_SURFACES)[number];

export type OpaqueResourceId = string & { readonly __brand: 'OpaqueResourceId' };

/** 将资源加载器内部键转成不透明遥测标识；返回值不保留描述性名称。 */
export function opaqueResourceId(loaderKey: string | number): OpaqueResourceId {
  const value = String(loaderKey);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `resource:${(hash >>> 0).toString(16).padStart(8, '0')}` as OpaqueResourceId;
}

export type SafeDiagnosticContext = Readonly<Record<string, string | number | boolean>>;

export interface DiagnosticObservation {
  readonly category: DiagnosticCategory;
  readonly diagnostic: UiDiagnostic;
  /** 关联实体。空数组表示全局呈现问题；非空时只保留当前 Agent 可见的实体。 */
  readonly affectedEntityIds: readonly string[];
  /** 已由调用方安全化的首次上下文；不会被后续重复项覆盖。 */
  readonly safeContext: SafeDiagnosticContext;
  /** 宿主提供的单调发生序号或时间戳，只用于诊断折叠显示，不参与规则判定。 */
  readonly occurrence: number;
  readonly opaqueResourceId?: OpaqueResourceId;
}

export interface FilteredDiagnostic {
  readonly __brand: 'FilteredDiagnostic';
  readonly category: DiagnosticCategory;
  readonly severity: UiDiagnosticSeverity;
  readonly displayText: string;
  readonly presentationLocation: string;
  readonly affectedEntityIds: readonly string[];
  readonly allowedSurfaces: readonly DiagnosticSurface[];
  readonly revision?: StateRevision;
  readonly opaqueResourceId?: OpaqueResourceId;
  readonly latestOccurrence: number;
  readonly count: number;
  /** 首次安全上下文只进入上游授权的技术面；用户面不接受任意上下文字段。 */
  readonly firstSafeContext?: SafeDiagnosticContext;
  /** 只有获得上游开发面授权后才出现。 */
  readonly code?: UiDiagnosticCode;
  readonly technicalLabel?: '诊断/技术信息';
  readonly technicalFields?: SafeDiagnosticContext;
}

interface StoredDiagnostic {
  readonly category: DiagnosticCategory;
  readonly diagnostic: UiDiagnostic;
  readonly affectedEntityIds: readonly string[];
  readonly firstSafeContext: SafeDiagnosticContext;
  readonly latestOccurrence: number;
  readonly count: number;
  readonly opaqueResourceId?: OpaqueResourceId;
}

export interface DiagnosticSink {
  record(observation: DiagnosticObservation): void;
  read(surface: DiagnosticSurface): readonly FilteredDiagnostic[];
  clear(): void;
  size(): number;
}

const USER_TEXT: Readonly<Record<DiagnosticCategory, string>> = Object.freeze({
  'descriptor-rejection': '此交互暂时无法显示',
  'stale-interaction': '状态已变化，请刷新后重试',
  'projection-gap': '显示正在与当前状态同步',
  'resource-failure': '部分表现资源未能加载',
  'fallback-selection': '已使用兼容的替代呈现',
});

function visibleEntityIds(agent: AuthorizedAgent, ids: readonly string[]): readonly string[] {
  if (ids.length === 0) return Object.freeze([]);
  if (agent.authority.omniscient) return Object.freeze([...new Set(ids)].sort());
  const visible = new Set(agent.scope.visibleEntityIds);
  return Object.freeze([...new Set(ids.filter((id) => visible.has(id)))].sort());
}

function storageKey(observation: DiagnosticObservation, entityIds: readonly string[]): string {
  return [
    observation.category,
    observation.diagnostic.code,
    observation.diagnostic.presentationLocation,
    entityIds.join('\u0000'),
    observation.opaqueResourceId ?? '',
    observation.diagnostic.revision?.sequence ?? '',
    observation.diagnostic.revision?.fingerprint ?? '',
  ].join('\u0001');
}

function freezeContext(context: SafeDiagnosticContext): SafeDiagnosticContext {
  return Object.freeze({ ...context });
}

export function createDiagnosticSink(agent: AuthorizedAgent): DiagnosticSink {
  const records = new Map<string, StoredDiagnostic>();

  function toFiltered(
    record: StoredDiagnostic,
    surface: DiagnosticSurface,
  ): FilteredDiagnostic {
    const developmentAuthorized =
      surface === 'authorized-dev' && agent.authority.developmentSurface;
    const allowedSurfaces: DiagnosticSurface[] = ['user'];
    if (agent.authority.developmentSurface) allowedSurfaces.push('authorized-dev');
    const technicalFields = Object.freeze({
      ...(record.diagnostic.internalFields ?? {}),
      reason: record.diagnostic.reason,
      correctionSuggestion: record.diagnostic.correctionSuggestion,
    });
    return Object.freeze({
      __brand: 'FilteredDiagnostic' as const,
      category: record.category,
      severity: record.diagnostic.severity,
      displayText: USER_TEXT[record.category],
      presentationLocation: record.diagnostic.presentationLocation,
      affectedEntityIds: record.affectedEntityIds,
      allowedSurfaces: Object.freeze(allowedSurfaces),
      ...(record.diagnostic.revision === undefined
        ? {}
        : { revision: record.diagnostic.revision }),
      ...(record.opaqueResourceId === undefined
        ? {}
        : { opaqueResourceId: record.opaqueResourceId }),
      latestOccurrence: record.latestOccurrence,
      count: record.count,
      ...(developmentAuthorized
        ? {
            firstSafeContext: record.firstSafeContext,
            code: record.diagnostic.code,
            technicalLabel: '诊断/技术信息' as const,
            technicalFields,
          }
        : {}),
    });
  }

  return Object.freeze({
    record(observation: DiagnosticObservation): void {
      const visibleIds = visibleEntityIds(agent, observation.affectedEntityIds);
      if (observation.affectedEntityIds.length > 0 && visibleIds.length === 0) return;
      const key = storageKey(observation, visibleIds);
      const previous = records.get(key);
      records.set(
        key,
        Object.freeze({
          category: observation.category,
          diagnostic: observation.diagnostic,
          affectedEntityIds: visibleIds,
          firstSafeContext:
            previous?.firstSafeContext ?? freezeContext(observation.safeContext),
          latestOccurrence: Math.max(
            previous?.latestOccurrence ?? observation.occurrence,
            observation.occurrence,
          ),
          count: (previous?.count ?? 0) + 1,
          ...(observation.opaqueResourceId === undefined
            ? {}
            : { opaqueResourceId: observation.opaqueResourceId }),
        }),
      );
    },

    read(surface: DiagnosticSurface): readonly FilteredDiagnostic[] {
      if (surface === 'authorized-dev' && !agent.authority.developmentSurface) {
        return Object.freeze([]);
      }
      return Object.freeze(
        [...records.values()]
          .sort((left, right) => {
            if (left.latestOccurrence !== right.latestOccurrence) {
              return left.latestOccurrence - right.latestOccurrence;
            }
            return left.diagnostic.code < right.diagnostic.code
              ? -1
              : left.diagnostic.code > right.diagnostic.code
                ? 1
                : 0;
          })
          .map((record) => toFiltered(record, surface)),
      );
    },

    clear(): void {
      records.clear();
    },

    size(): number {
      return records.size;
    },
  });
}

export interface DiagnosticRenderResult<TProjection, TOutput> {
  readonly projection: TProjection;
  readonly output?: TOutput;
  readonly rendererFailed: boolean;
  readonly retryRuleAction: false;
}

/**
 * 诊断渲染器失败只撤除诊断表面；原投影按引用保留，且返回类型固定禁止重试规则动作。
 */
export function renderDiagnosticsSafely<TProjection, TOutput>(
  projection: TProjection,
  diagnostics: readonly FilteredDiagnostic[],
  renderer: (entries: readonly FilteredDiagnostic[]) => TOutput,
): DiagnosticRenderResult<TProjection, TOutput> {
  try {
    return Object.freeze({
      projection,
      output: renderer(diagnostics),
      rendererFailed: false,
      retryRuleAction: false as const,
    });
  } catch {
    return Object.freeze({
      projection,
      rendererFailed: true,
      retryRuleAction: false as const,
    });
  }
}
