import { describe, expect, it } from 'vitest';

import { actionView, revision, uiViewFixture } from '../../__tests__/support/fixtures.js';
import { REJECTED_OUTCOME } from '../../__tests__/support/in-memory-ports.js';
import type { InteractionIntent } from '../../model/intent.js';
import { buildIntent } from '../intent-factory.js';
import { createPendingRegistry } from '../pending-registry.js';

function intentFor(controlId: string, sequence = 1): InteractionIntent {
  const view = uiViewFixture({
    revision: revision(sequence, `fp-${String(sequence)}`),
    actions: [actionView({ actionId: 'act.move', bindings: [{ key: 'to', value: 'n1' }] })],
  });
  const built = buildIntent({
    view,
    controlId,
    interactionId: `interaction.${controlId}`,
    inputSource: 'keyboard',
    selection: { kind: 'action', actionId: 'act.move', bindings: { to: 'n1' } },
  });
  if (!built.ok) throw new Error('fixture intent must be constructible');
  return built.value;
}

describe('待决登记以 controlId 为键（tasks.md 任务 5.3、J-12）', () => {
  it('同一控件连续 N 次激活只产出 1 个意图', () => {
    const registry = createPendingRegistry();
    const intent = intentFor('control.a');
    const outcomes = Array.from({ length: 7 }, () => registry.tryRegister('control.a', intent));
    expect(outcomes.filter((outcome) => outcome.kind === 'registered')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'already-pending')).toHaveLength(6);
    expect(registry.pendingControlIds()).toEqual(['control.a']);
  });

  it('不同控件承载同一动作时各自可独立产出意图', () => {
    const registry = createPendingRegistry();
    expect(registry.tryRegister('control.turn-bar', intentFor('control.turn-bar')).kind).toBe('registered');
    expect(registry.tryRegister('control.action-panel', intentFor('control.action-panel')).kind).toBe(
      'registered',
    );
    expect(registry.pendingControlIds()).toEqual(['control.action-panel', 'control.turn-bar']);
  });

  it('结算后该控件可以再次登记', () => {
    const registry = createPendingRegistry();
    const intent = intentFor('control.a');
    registry.tryRegister('control.a', intent);
    registry.settle(intent.intentId, REJECTED_OUTCOME);
    expect(registry.isPending('control.a')).toBe(false);
    expect(registry.tryRegister('control.a', intent).kind).toBe('registered');
  });

  it('结算一个不存在的意图标识是无操作，不抛错', () => {
    const registry = createPendingRegistry();
    expect(() => registry.settle('intent:missing', REJECTED_OUTCOME)).not.toThrow();
  });
});

describe('修订变化批量失效受影响绑定（Requirement 5.3）', () => {
  it('修订变化后原绑定不可再提交，并返回被失效的控件列表', () => {
    const registry = createPendingRegistry();
    registry.tryRegister('control.b', intentFor('control.b', 1));
    registry.tryRegister('control.a', intentFor('control.a', 1));
    const invalidated = registry.invalidateByRevision(revision(2, 'fp-2'));
    expect(invalidated).toEqual(['control.a', 'control.b']);
    expect(registry.pendingControlIds()).toEqual([]);
    expect(registry.pendingIntent('control.a')).toBeUndefined();
  });

  it('修订未变时不失效任何绑定', () => {
    const registry = createPendingRegistry();
    registry.tryRegister('control.a', intentFor('control.a', 3));
    expect(registry.invalidateByRevision(revision(3, 'fp-3'))).toEqual([]);
    expect(registry.isPending('control.a')).toBe(true);
  });

  it('序号相同但指纹不同（uncomparable）同样导致失效', () => {
    const registry = createPendingRegistry();
    registry.tryRegister('control.a', intentFor('control.a', 3));
    expect(registry.invalidateByRevision(revision(3, 'fp-other'))).toEqual(['control.a']);
  });

  it('回退到更早修订也导致失效', () => {
    const registry = createPendingRegistry();
    registry.tryRegister('control.a', intentFor('control.a', 5));
    expect(registry.invalidateByRevision(revision(4, 'fp-4'))).toEqual(['control.a']);
  });

  it('失效列表按码点序，因此顺序确定性', () => {
    const registry = createPendingRegistry();
    for (const controlId of ['control.z', 'control.m', 'control.a']) {
      registry.tryRegister(controlId, intentFor(controlId, 1));
    }
    expect(registry.invalidateByRevision(revision(9, 'fp-9'))).toEqual([
      'control.a',
      'control.m',
      'control.z',
    ]);
  });
});
