import { describe, expect, it, vi } from 'vitest';

import { createUiSystem } from '../index';
import { UI_DIAGNOSTIC_CODES } from '../model/diagnostic';
import type { InteractionIntent } from '../model/intent';
import type { RuleEventProjection } from '../model/event-projection';
import type { ActionPort } from '../ports/action-port';
import {
  createInMemoryActionPort,
  createInMemoryActionQueryPort,
  createInMemoryEventPort,
  createInMemoryProjectionPort,
  createInMemoryRevisionPort,
  createPendingContractPorts,
  createRecordingDiagnosticSink,
  createReplayModeActionPort,
} from './support/in-memory-ports';
import { profileFixture, revision } from './support/fixtures';

const INTENT: InteractionIntent = Object.freeze({
  intentId: 'intent.a',
  agentId: 'agent.a',
  target: Object.freeze({ kind: 'action' as const, actionId: 'act.move' }),
  bindings: Object.freeze({}),
  observedRevision: revision(1, 'fp-1'),
  inputSource: 'keyboard' as const,
});

function createPorts<TActionPort extends ActionPort>(actions: TActionPort) {
  return {
    projection: createInMemoryProjectionPort(),
    events: createInMemoryEventPort(),
    actionQuery: createInMemoryActionQueryPort(),
    revision: createInMemoryRevisionPort(1),
    actions,
    pendingContracts: createPendingContractPorts(),
    diagnostics: createRecordingDiagnosticSink(),
  };
}

describe('UI 组合根只通过注入端口工作', () => {
  it('查询、事件与交互入口均委派给内存端口', () => {
    const ports = createPorts(createInMemoryActionPort());
    const system = createUiSystem(ports, profileFixture());

    expect(system.query.projection({ agentId: 'agent.a', scopeId: 'scope.a' }).ok).toBe(true);
    expect(system.query.descriptor({
      agentId: 'agent.a',
      scopeId: 'scope.a',
      actorId: 'e1',
      includeUnavailable: true,
    }).ok).toBe(true);
    expect(system.query.legalActions({ entityId: 'e1' }).ok).toBe(true);
    expect(system.query.scopedRefs({ from: 'entity' }).ok).toBe(true);
    expect(system.query.currentRevisionSequence()).toEqual({ ok: true, value: 1 });

    const listener = vi.fn<(event: RuleEventProjection) => void>();
    const subscription = system.query.events(listener);
    const projectedEvent: RuleEventProjection = Object.freeze({
      sequence: 2,
      semanticType: 'after:test',
      observedAtRevision: revision(1, 'fp-1'),
      safePayload: Object.freeze({}),
    });
    ports.events.dispatch(projectedEvent);
    expect(listener).toHaveBeenCalledWith(projectedEvent);
    subscription.unsubscribe();
    expect(ports.events.subscriberCount()).toBe(0);

    expect(system.interaction.sendIntent(INTENT).kind).toBe('accepted');
    expect(ports.actions.submitted()).toEqual([INTENT]);
    expect(Object.isFrozen(system)).toBe(true);
    expect(Object.isFrozen(system.query)).toBe(true);
    expect(Object.isFrozen(system.interaction)).toBe(true);
  });

  it('修订替身可独立驱动汇合成功与显式失败', () => {
    const ports = createPorts(createInMemoryActionPort());
    const system = createUiSystem(ports, profileFixture());
    ports.revision.setSequence(undefined);
    expect(system.query.currentRevisionSequence()).toEqual({
      ok: false,
      code: UI_DIAGNOSTIC_CODES.PENDING_CONVERGENCE_CONTRACT,
      missing: ['kernel-monotonic-log-sequence'],
    });
    ports.revision.setSequence(9);
    expect(system.query.currentRevisionSequence()).toEqual({ ok: true, value: 9 });
  });

  it('回放模式端口机械拒绝一切提交', () => {
    const system = createUiSystem(createPorts(createReplayModeActionPort()), profileFixture());
    const outcome = system.interaction.sendIntent(INTENT);
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') expect(outcome.rejection.displayText).toBe('回放中无法操作');
  });

  it('组合根不复制 profile，可替换配置被深冻结装载', () => {
    const profile = profileFixture({ version: 'alternate-profile' });
    const system = createUiSystem(createPorts(createInMemoryActionPort()), profile);
    expect(system.profile.version).toBe('alternate-profile');
    expect(system.pendingContracts.core.phaseSemantics()).toMatchObject({
      ok: false,
      missing: ['core-phase-semantics'],
    });
    expect(system.diagnostics.size()).toBe(0);
  });
});
