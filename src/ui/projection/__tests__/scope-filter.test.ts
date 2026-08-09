import { describe, expect, it } from 'vitest';

import { revision, scope } from '../../__tests__/support/fixtures.js';
import { uiOk } from '../../model/diagnostic.js';
import type { RuleEventProjection } from '../../model/event-projection.js';
import type { UiDiagnostic } from '../../model/diagnostic.js';
import type {
  ActionQueryPort,
  LegalActionQueryOutcome,
  ScopedQueryOutcome,
  ScopedQuerySpec,
  ScopedRef,
} from '../../ports/action-query-port.js';
import type { EventSubscription, RawEventSource, RawGatewayEvent } from '../../ports/event-port.js';
import {
  createScopeFilteredEventPort,
  createScopedQueryRunner,
  narrowRawEvent,
  safeFieldRulesFromProfile,
  type SafeFieldRule,
} from '../scope-filter.js';
import { profileFixture } from '../../__tests__/support/fixtures.js';

const SCOPE = scope({ visibleEntityIds: ['e1', 'e2'], visibleNodeIds: ['n1'] });
const CURRENT = revision(3, 'fp-3');
const RULES: readonly SafeFieldRule[] = Object.freeze([
  Object.freeze({ key: 'actorId', kind: 'entity-ref' as const }),
  Object.freeze({ key: 'toNodeId', kind: 'node-ref' as const }),
  Object.freeze({ key: 'movementKind', kind: 'opaque' as const }),
]);

function deps(onDiagnostics?: (diagnostics: readonly UiDiagnostic[]) => void): {
  readonly scope: typeof SCOPE;
  readonly rules: readonly SafeFieldRule[];
  readonly currentRevision: () => typeof CURRENT;
  readonly onDiagnostics?: (diagnostics: readonly UiDiagnostic[]) => void;
} {
  return {
    scope: SCOPE,
    rules: RULES,
    currentRevision: () => CURRENT,
    ...(onDiagnostics === undefined ? {} : { onDiagnostics }),
  };
}

function rawEvent(payload: Readonly<Record<string, unknown>>, type = 'after:entity.move'): RawGatewayEvent {
  return Object.freeze({ type, sequence: 7, payload: Object.freeze({ ...payload }) });
}

describe('事件侧收窄（tasks.md 任务 3.4）', () => {
  it('范围内标识通过，并按白名单产出安全载荷', () => {
    const result = narrowRawEvent(
      rawEvent({ actorId: 'e1', toNodeId: 'n1', movementKind: 'walk', hiddenNote: 'secret' }),
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.safePayload).toEqual({ actorId: 'e1', movementKind: 'walk', toNodeId: 'n1' });
    expect(result.value.observedAtRevision).toEqual(CURRENT);
    expect(result.value.sequence).toBe(7);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'EVENT_PAYLOAD_KEY_NOT_WHITELISTED',
    ]);
  });

  it('含范围外实体标识的事件被整条丢弃并产出 PROJECTION_SCOPE_VIOLATION', () => {
    const result = narrowRawEvent(rawEvent({ actorId: 'e9', toNodeId: 'n1' }), deps());
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PROJECTION_SCOPE_VIOLATION',
    ]);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('范围外节点标识同样导致整条丢弃', () => {
    const result = narrowRawEvent(rawEvent({ actorId: 'e1', toNodeId: 'n9' }), deps());
    expect(result.ok).toBe(false);
  });

  it('嵌套结构里的范围外标识也被检出', () => {
    const result = narrowRawEvent(
      rawEvent({ actorId: ['e1', { inner: 'e9' }], toNodeId: 'n1' }),
      deps(),
    );
    expect(result.ok).toBe(false);
  });

  it('收窄先于白名单：范围外标识不会因为字段未登记而"顺带被挡住"', () => {
    const rules: readonly SafeFieldRule[] = Object.freeze([
      Object.freeze({ key: 'actorId', kind: 'entity-ref' as const }),
    ]);
    const result = narrowRawEvent(rawEvent({ actorId: 'e9', extra: 1 }), {
      scope: SCOPE,
      rules,
      currentRevision: () => CURRENT,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PROJECTION_SCOPE_VIOLATION',
    ]);
  });

  it('profile 的白名单一律按 opaque 读取，不猜某个键是否承载实体标识', () => {
    const rules = safeFieldRulesFromProfile(profileFixture({ safeFieldWhitelist: ['actorId'] }));
    expect(rules).toEqual([{ key: 'actorId', kind: 'opaque' }]);
  });
});

describe('通配订阅不泄漏范围外标识', () => {
  it("'*' 通配事件源经本模块后，监听者只收到范围内事件", () => {
    let deliver: ((event: RawGatewayEvent) => void) | undefined;
    const rawSource: RawEventSource = {
      subscribe(listener): EventSubscription {
        deliver = listener;
        return { unsubscribe: () => undefined };
      },
    };
    const received: RuleEventProjection[] = [];
    const diagnostics: UiDiagnostic[] = [];
    const port = createScopeFilteredEventPort(
      rawSource,
      deps((batch) => diagnostics.push(...batch)),
    );
    port.subscribe((event) => received.push(event));
    expect(deliver).toBeDefined();

    deliver?.(rawEvent({ actorId: 'e1', toNodeId: 'n1' }, 'after:entity.move'));
    deliver?.(rawEvent({ actorId: 'e9', toNodeId: 'n1' }, 'after:entity.hidden-move'));
    deliver?.(rawEvent({ actorId: 'e2', toNodeId: 'n9' }, 'after:entity.place'));

    expect(received).toHaveLength(1);
    expect(received[0]?.safePayload).toEqual({ actorId: 'e1', toNodeId: 'n1' });
    const serialized = JSON.stringify(received);
    expect(serialized).not.toContain('e9');
    expect(serialized).not.toContain('n9');
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'PROJECTION_SCOPE_VIOLATION')).toHaveLength(2);
  });
});

describe('查询侧范围复核', () => {
  function portReturning(refs: readonly ScopedRef[]): ActionQueryPort {
    return {
      scopedQuery(_spec: ScopedQuerySpec): ScopedQueryOutcome {
        return uiOk(refs);
      },
      queryActions(): LegalActionQueryOutcome {
        return uiOk([]);
      },
    };
  }

  it('范围外引用被丢弃并产出诊断，范围内引用保留', () => {
    const runner = createScopedQueryRunner(
      portReturning([
        { refId: 'e1', kind: 'entity' },
        { refId: 'e9', kind: 'entity' },
        { refId: 'n1', kind: 'node' },
        { refId: 'n9', kind: 'node' },
      ]),
      SCOPE,
    );
    const outcome = runner.run({ from: 'entity' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.value.map((ref) => ref.refId)).toEqual(['e1', 'n1']);
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PROJECTION_SCOPE_VIOLATION',
    ]);
  });

  it('全部引用都在范围内时不产出诊断', () => {
    const runner = createScopedQueryRunner(portReturning([{ refId: 'e2', kind: 'entity' }]), SCOPE);
    const outcome = runner.run({ from: 'entity' });
    expect(outcome.diagnostics).toEqual([]);
  });
});
