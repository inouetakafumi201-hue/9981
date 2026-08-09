import { describe, expect, it } from 'vitest';

import { makeRevision, type StateRevision } from '../revision.js';
import {
  INPUT_SOURCES,
  bindingsKey,
  deriveIntentId,
  intentTargetKey,
  isInputSource,
  stableHash,
  type InteractionIntent,
  type IntentTarget,
} from '../intent.js';

const made = makeRevision(9, 'fp-9');
if (!made.ok) throw new Error('fixture revision must be constructible');
const REVISION: StateRevision = made.value;

describe('Interaction_Intent 形状（类型层约束）', () => {
  it('判别联合排除"两个 target 都填"与"都不填"', () => {
    const action: IntentTarget = { kind: 'action', actionId: 'act.move' };
    const decision: IntentTarget = { kind: 'decision', decisionId: 'dec.1', optionId: 'opt.a' };
    expect(intentTargetKey(action)).toBe('action:act.move');
    expect(intentTargetKey(decision)).toBe('decision:dec.1:opt.a');

    // @ts-expect-error 同时携带动作目标与 Decision 目标的取值在类型层不可构造
    const both: IntentTarget = { kind: 'action', actionId: 'act.move', decisionId: 'dec.1', optionId: 'opt.a' };
    // @ts-expect-error 不携带任何目标的取值在类型层不可构造
    const neither: IntentTarget = {};
    expect(both).toBeTruthy();
    expect(neither).toBeTruthy();
  });

  it('observedRevision 为必填', () => {
    // @ts-expect-error 缺少 observedRevision 的意图在类型层不可构造
    const missing: InteractionIntent = {
      intentId: 'intent:1',
      agentId: 'agent.a',
      target: { kind: 'action', actionId: 'act.move' },
      bindings: {},
      inputSource: 'keyboard',
    };
    expect(missing).toBeTruthy();
  });

  it('inputSource 是闭合枚举，开关控制与辅助自动化归一到 assistive', () => {
    expect(INPUT_SOURCES).toEqual(['keyboard', 'pointer', 'touch', 'gamepad', 'assistive']);
    expect(isInputSource('assistive')).toBe(true);
    expect(isInputSource('switch-control')).toBe(false);
  });
});

describe('确定性标识派生', () => {
  it('意图标识不含 inputSource，因此不同来源得到同一标识', () => {
    const target: IntentTarget = { kind: 'action', actionId: 'act.move' };
    const bindings = { to: 'node.2' } as const;
    const ids = INPUT_SOURCES.map(() => deriveIntentId('agent.a', target, bindings, REVISION));
    expect(new Set(ids).size).toBe(1);
  });

  it('绑定键序不影响标识', () => {
    const target: IntentTarget = { kind: 'action', actionId: 'act.move' };
    const left = deriveIntentId('agent.a', target, { a: 1, b: 2 }, REVISION);
    const right = deriveIntentId('agent.a', target, { b: 2, a: 1 }, REVISION);
    expect(left).toBe(right);
    expect(bindingsKey({ b: 2, a: 1 })).toBe('a=1&b=2');
  });

  it('修订变化导致标识变化', () => {
    const target: IntentTarget = { kind: 'action', actionId: 'act.move' };
    const other = makeRevision(10, 'fp-10');
    if (!other.ok) throw new Error('fixture revision must be constructible');
    expect(deriveIntentId('agent.a', target, {}, REVISION)).not.toBe(
      deriveIntentId('agent.a', target, {}, other.value),
    );
  });

  it('稳定散列与宿主无关且确定性', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
    expect(stableHash('abc')).toMatch(/^[0-9a-f]{8}$/u);
  });
});
