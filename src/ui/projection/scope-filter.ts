/**
 * 单一 Agent 过滤点（design.md §6.1、C-5，tasks.md 任务 3.4）。
 *
 * `PresentationGateway` 实测**不按 Agent 过滤**：`query` 不强制注入 `visibleTo`，
 * `subscribe`/`dispatch` 原样投递 payload 且支持 `'*'` 通配订阅。因此过滤责任落在 UI
 * 端口边界，并且**只落在本文件**——第二个过滤器意味着两套规则，迟早分叉。
 *
 * 本模块承担两件事：
 * 1. 查询侧：`scopedQuery(spec)` 是 UI 到查询端口的唯一路径（端口本身不暴露裸 `Query`，
 *    见 J-23），本模块再对返回的引用做一次范围复核，范围外引用一律丢弃并产出诊断。
 * 2. 事件侧：把未收窄的 `RawGatewayEvent` 收窄为 `RuleEventProjection`，
 *    出现范围外标识即**丢弃该事件**，随后走 §4.2 的白名单投影。
 *
 * 这是**防御性补偿**，不构成对 C-5 的修复；引擎层修复后本模块应退化为薄封装并复核是否仍需要。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  uiOk,
  uiRejected,
  type UiDiagnostic,
  type UiResult,
} from '../model/diagnostic.js';
import { projectSafePayload, type RuleEventProjection } from '../model/event-projection.js';
import type { StateRevision } from '../model/revision.js';
import type { PresentationProfile } from '../model/profile.js';
import type { AuthorizationScope } from '../model/view.js';
import type {
  ActionQueryPort,
  ScopedQueryOutcome,
  ScopedQuerySpec,
  ScopedRef,
} from '../ports/action-query-port.js';
import type {
  EventPort,
  EventSubscription,
  RawEventSource,
  RawGatewayEvent,
} from '../ports/event-port.js';

/**
 * 安全字段的引用种类。
 *
 * 值收窄必须是**精确**的：不能靠字段名或字符串形状猜"这个值是不是实体标识"。
 * 因此每个安全字段显式声明它承载什么引用；`opaque` 表示"不承载任何可定位标识"。
 */
export const SAFE_FIELD_KINDS = ['entity-ref', 'node-ref', 'belief-agent-ref', 'opaque'] as const;
export type SafeFieldKind = (typeof SAFE_FIELD_KINDS)[number];

export interface SafeFieldRule {
  readonly key: string;
  readonly kind: SafeFieldKind;
}

/**
 * 把 profile 声明的安全字段白名单读成规则。
 *
 * profile 的 `safeFieldWhitelist` 只有键名（其具体键名属于待汇合契约，§14.4 第 2 项），
 * 因此这里一律按 `opaque` 处理：**不猜**某个键是否承载实体标识。需要按引用收窄的字段
 * 必须由宿主显式给出 `SafeFieldRule`，这正是"不发明语义"的落点。
 */
export function safeFieldRulesFromProfile(profile: PresentationProfile): readonly SafeFieldRule[] {
  return Object.freeze(
    profile.safeFieldWhitelist.map((key) => Object.freeze({ key, kind: 'opaque' as const })),
  );
}

function allowlistFor(scope: AuthorizationScope, kind: SafeFieldKind): readonly string[] {
  switch (kind) {
    case 'entity-ref':
      return scope.visibleEntityIds;
    case 'node-ref':
      return scope.visibleNodeIds;
    case 'belief-agent-ref':
      return scope.authorizedBeliefAgentIds;
    default:
      return [];
  }
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, into);
  }
}

function scopeViolation(location: string, offending: readonly string[]): UiDiagnostic {
  return uiDiagnostic({
    code: UI_DIAGNOSTIC_CODES.PROJECTION_SCOPE_VIOLATION,
    presentationLocation: location,
    reason: `出现当前授权范围外的标识，已丢弃该输入（共 ${String(offending.length)} 项）`,
    correctionSuggestion: '读通道必须按 AuthorizationScope 收窄；范围外标识不得进入表现层',
  });
}

/** 查询侧：UI 到查询端口的唯一路径，并对返回引用做范围复核。 */
export interface ScopedQueryRunner {
  run(spec: ScopedQuerySpec): ScopedQueryOutcome;
}

export function createScopedQueryRunner(
  port: ActionQueryPort,
  scope: AuthorizationScope,
): ScopedQueryRunner {
  return Object.freeze({
    run(spec: ScopedQuerySpec): ScopedQueryOutcome {
      const outcome = port.scopedQuery(spec);
      if (!outcome.ok) return outcome;
      const allowedEntities = new Set(scope.visibleEntityIds);
      const allowedNodes = new Set(scope.visibleNodeIds);
      const kept: ScopedRef[] = [];
      const dropped: string[] = [];
      for (const ref of outcome.value) {
        const allowed =
          ref.kind === 'entity'
            ? allowedEntities.has(ref.refId)
            : ref.kind === 'node'
              ? allowedNodes.has(ref.refId)
              : allowedEntities.has(ref.refId) || allowedNodes.has(ref.refId);
        if (allowed) kept.push(ref);
        else dropped.push(ref.refId);
      }
      const diagnostics: UiDiagnostic[] = [...outcome.diagnostics];
      if (dropped.length > 0) {
        diagnostics.push(scopeViolation(`projection/scope-filter#${spec.from}`, dropped));
      }
      return uiOk(Object.freeze(kept), diagnostics);
    },
  });
}

export interface ScopeFilterDeps {
  readonly scope: AuthorizationScope;
  readonly rules: readonly SafeFieldRule[];
  /** 当前已验证投影的修订令牌。事件以它作为 `observedAtRevision`。 */
  readonly currentRevision: () => StateRevision;
  readonly onDiagnostics?: (diagnostics: readonly UiDiagnostic[]) => void;
}

/**
 * 事件侧：把未收窄的网关事件收窄为安全事件投影。
 *
 * 顺序固定为"先按范围收窄标识，再按白名单投影字段"。反过来会先把范围外标识放进
 * `safePayload`，再指望白名单兜住它——白名单管的是"哪些键"，不管"值是否越权"。
 */
export function narrowRawEvent(
  event: RawGatewayEvent,
  deps: ScopeFilterDeps,
): UiResult<RuleEventProjection> {
  const location = `projection/scope-filter#${event.type}`;
  const offending: string[] = [];
  for (const rule of deps.rules) {
    if (rule.kind === 'opaque') continue;
    if (!Object.prototype.hasOwnProperty.call(event.payload, rule.key)) continue;
    const allowed = new Set(allowlistFor(deps.scope, rule.kind));
    const values: string[] = [];
    collectStrings(event.payload[rule.key], values);
    for (const value of values) {
      if (!allowed.has(value)) offending.push(value);
    }
  }
  if (offending.length > 0) {
    return uiRejected([scopeViolation(location, offending)]);
  }
  const projected = projectSafePayload(
    event.payload,
    deps.rules.map((rule) => rule.key),
    location,
  );
  const projection: RuleEventProjection = Object.freeze({
    sequence: event.sequence,
    semanticType: event.type,
    observedAtRevision: deps.currentRevision(),
    safePayload: projected.safePayload,
  });
  return uiOk(projection, projected.diagnostics);
}

/**
 * 由未收窄事件源构造已收窄的 `EventPort`。
 *
 * 即便上游用 `'*'` 通配订阅把所有事件都投递过来，范围外标识也不会到达监听者：
 * 被拒绝的事件根本不调用监听者，只把诊断交给 `onDiagnostics`。
 */
export function createScopeFilteredEventPort(
  rawSource: RawEventSource,
  deps: ScopeFilterDeps,
): EventPort {
  return Object.freeze({
    subscribe(listener: (event: RuleEventProjection) => void): EventSubscription {
      return rawSource.subscribe((raw) => {
        const narrowed = narrowRawEvent(raw, deps);
        if (narrowed.diagnostics.length > 0) deps.onDiagnostics?.(narrowed.diagnostics);
        if (narrowed.ok) listener(narrowed.value);
      });
    },
  });
}
