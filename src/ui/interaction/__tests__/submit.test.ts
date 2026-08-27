import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { actionView, revision, uiViewFixture } from '../../__tests__/support/fixtures';
import {
  REJECTED_OUTCOME,
  STALE_OUTCOME,
  createInMemoryActionPort,
} from '../../__tests__/support/in-memory-ports';
import { stripComments } from '../../__tests__/support/source-scan';
import type { InteractionIntent } from '../../model/intent';
import { buildIntent } from '../intent-factory';
import { createPendingRegistry } from '../pending-registry';
import { createSubmitFlow } from '../submit';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMITTED = revision(2, 'fp-2');

function intent(): InteractionIntent {
  const view = uiViewFixture({
    revision: revision(1, 'fp-1'),
    actions: [actionView({ actionId: 'act.move', bindings: [{ key: 'to', value: 'n1' }] })],
  });
  const built = buildIntent({
    view,
    controlId: 'control.move',
    interactionId: 'interaction.move',
    inputSource: 'keyboard',
    selection: { kind: 'action', actionId: 'act.move', bindings: { to: 'n1' } },
  });
  if (!built.ok) throw new Error('fixture intent must be constructible');
  return built.value;
}

function flow(outcomeKind: 'accepted' | 'stale' | 'rejected' = 'accepted') {
  const actionPort = createInMemoryActionPort({ kind: 'accepted', committedRevision: COMMITTED });
  if (outcomeKind === 'stale') actionPort.setOutcome(STALE_OUTCOME);
  if (outcomeKind === 'rejected') actionPort.setOutcome(REJECTED_OUTCOME);
  const registry = createPendingRegistry();
  return { actionPort, registry, submitFlow: createSubmitFlow({ actionPort, registry }) };
}

describe('成功只由已提交投影确认（tasks.md 任务 5.4、Requirement 5.7）', () => {
  it('accepted 但尚未观察到目标修订时状态为"未完成"', () => {
    const { submitFlow } = flow('accepted');
    const step = submitFlow.activate('control.move', intent());
    expect(step.state).toBe('awaiting-committed-revision');
    expect(step.awaitedRevision).toEqual(COMMITTED);
    expect(submitFlow.stateOf('control.move')).toBe('awaiting-committed-revision');
  });

  it('观察到含 committedRevision 的投影后才视为完成', () => {
    const { submitFlow } = flow('accepted');
    submitFlow.activate('control.move', intent());
    expect(submitFlow.observeRevision(revision(1, 'fp-1'))).toEqual([]);
    expect(submitFlow.stateOf('control.move')).toBe('awaiting-committed-revision');
    const completed = submitFlow.observeRevision(COMMITTED);
    expect(completed.map((step) => step.controlId)).toEqual(['control.move']);
    expect(submitFlow.stateOf('control.move')).toBe('completed');
  });

  it('更晚的投影也能确认完成（它必然包含该已提交修订）', () => {
    const { submitFlow } = flow('accepted');
    submitFlow.activate('control.move', intent());
    expect(submitFlow.observeRevision(revision(9, 'fp-9'))).toHaveLength(1);
  });
});

describe('stale 与 rejected 走不同路径（Requirement 5.6）', () => {
  it('stale 要求先重同步才能重新启用交互', () => {
    const { submitFlow } = flow('stale');
    const step = submitFlow.activate('control.move', intent());
    expect(step.state).toBe('resyncing');
    expect(step.requiresResync).toBe(true);
    expect(step.requiresRefresh).toBe(true);
    expect(step.displayText).toBe('状态已变化，请重试');
  });

  it('rejected 只刷新受影响投影，不触发重同步门禁', () => {
    const { submitFlow } = flow('rejected');
    const step = submitFlow.activate('control.move', intent());
    expect(step.state).toBe('rejected');
    expect(step.requiresResync).toBe(false);
    expect(step.requiresRefresh).toBe(true);
    expect(step.diagnostics.length).toBeGreaterThan(0);
  });

  it('两者不会被混为一类', () => {
    const stale = flow('stale').submitFlow.activate('control.move', intent());
    const rejected = flow('rejected').submitFlow.activate('control.move', intent());
    expect(stale.state).not.toBe(rejected.state);
    expect(stale.requiresResync).not.toBe(rejected.requiresResync);
  });
});

describe('待决控件的额外激活既不产生第二个意图也不再提交（Requirement 5.1）', () => {
  it('第二次激活不调用 ActionPort', () => {
    const { actionPort, submitFlow } = flow('accepted');
    const first = submitFlow.activate('control.move', intent());
    expect(first.state).toBe('awaiting-committed-revision');
    // accepted 分支已经结算了登记，因此这里用 stale 分支验证"待决期间"的行为。
    const staleFlow = flow('stale');
    const registry = staleFlow.registry;
    const pending = intent();
    registry.tryRegister('control.move', pending);
    const second = staleFlow.submitFlow.activate('control.move', pending);
    expect(second.state).toBe('already-pending');
    expect(staleFlow.actionPort.submitted()).toHaveLength(0);
    expect(actionPort.submitted()).toHaveLength(1);
  });
});

describe('不存在补偿性写入，也不出现写入标识符', () => {
  it('submit.ts 与 interaction 目录不出现写入标识符', () => {
    for (const file of [
      '../submit.ts',
      '../intent-factory.ts',
      '../pending-registry.ts',
      '../menu-faces.ts',
      '../end-turn-countdown.ts',
      '../input-normalizer.ts',
    ]) {
      const source = stripComments(readFileSync(resolve(HERE, file), 'utf8'));
      const forbiddenNames = [
        ['Op', 'Registry'],
        ['register', 'Op'],
        ['define', 'Query'],
        ['invoke', 'Inline'],
        ['prop', '.', 'set'],
        ['prop', '.', 'add'],
        ['Kernel', 'Contract'],
      ];
      for (const parts of forbiddenNames) {
        const identifier = parts.join('');
        const pattern = new RegExp(`\\b${identifier.replace('.', '\\.')}\\b`, 'u');
        expect(pattern.test(source), `${file}: ${pattern.source}`).toBe(false);
      }
    }
  });

  it('提交流程里没有任何"补偿"或"重试规则动作"的分支', () => {
    const source = stripComments(readFileSync(resolve(HERE, '../submit.ts'), 'utf8'));
    expect(/\bcompensat/iu.test(source)).toBe(false);
    expect(/\bretry\b/iu.test(source)).toBe(false);
  });
});
