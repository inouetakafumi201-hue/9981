import { describe, expect, it } from 'vitest';

import { actionView, decisionView, uiViewFixture } from '../../__tests__/support/fixtures';
import { INPUT_SOURCES } from '../../model/intent';
import { buildIntent } from '../intent-factory';

const VIEW = uiViewFixture({
  actions: [actionView({ actionId: 'act.move', bindings: [{ key: 'to', value: 'n1' }] })],
  decisions: [decisionView('dec.open'), decisionView('dec.closed', 'resolved')],
});

function build(
  selection: Parameters<typeof buildIntent>[0]['selection'],
  inputSource: (typeof INPUT_SOURCES)[number] = 'keyboard',
) {
  return buildIntent({
    view: VIEW,
    controlId: 'control.move',
    interactionId: 'interaction.move',
    inputSource,
    selection,
  });
}

describe('意图只能引用当前投影中的动作或开放 Decision（tasks.md 任务 5.2）', () => {
  it('合法动作意图被构建，并写入观察到的修订', () => {
    const outcome = build({ kind: 'action', actionId: 'act.move', bindings: { to: 'n1' } });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.value.target).toEqual({ kind: 'action', actionId: 'act.move' });
    expect(outcome.value.observedRevision).toEqual(VIEW.revision);
    expect(outcome.value.agentId).toBe(VIEW.agentId);
  });

  it('引用投影外的动作被拒绝', () => {
    expect(build({ kind: 'action', actionId: 'act.teleport', bindings: {} }).ok).toBe(false);
  });

  it('引用已关闭的 Decision 被拒绝', () => {
    expect(build({ kind: 'decision', decisionId: 'dec.closed', optionId: 'opt.a' }).ok).toBe(false);
  });

  it('开放 Decision 的合法选项被接受', () => {
    const outcome = build({ kind: 'decision', decisionId: 'dec.open', optionId: 'opt.a' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.value.target).toEqual({ kind: 'decision', decisionId: 'dec.open', optionId: 'opt.a' });
    expect(outcome.value.bindings).toEqual({});
  });

  it('投影外的 Decision 选项被拒绝', () => {
    expect(build({ kind: 'decision', decisionId: 'dec.open', optionId: 'opt.z' }).ok).toBe(false);
  });
});

describe('不存在从用户输入直接构造目标标识的路径', () => {
  it('绑定键不在投影绑定中时被拒绝', () => {
    expect(build({ kind: 'action', actionId: 'act.move', bindings: { from: 'n1' } }).ok).toBe(false);
  });

  it('绑定取值不是投影中出现过的取值时被拒绝', () => {
    expect(build({ kind: 'action', actionId: 'act.move', bindings: { to: 'n9' } }).ok).toBe(false);
  });

  it('省略绑定是允许的：意图只能收窄而不能扩张', () => {
    expect(build({ kind: 'action', actionId: 'act.move', bindings: {} }).ok).toBe(true);
  });
});

describe('同一动作经不同来源构建出的意图除 inputSource 外逐字段相等', () => {
  it('五种归一化来源产出的意图只有 inputSource 不同', () => {
    const built = INPUT_SOURCES.map((source) => {
      const outcome = build({ kind: 'action', actionId: 'act.move', bindings: { to: 'n1' } }, source);
      if (!outcome.ok) throw new Error('unreachable');
      return outcome.value;
    });
    const first = built[0];
    if (first === undefined) throw new Error('unreachable');
    for (const intent of built) {
      expect({ ...intent, inputSource: 'keyboard' as const }).toStrictEqual({
        ...first,
        inputSource: 'keyboard' as const,
      });
    }
    expect(new Set(built.map((intent) => intent.intentId)).size).toBe(1);
    expect(new Set(built.map((intent) => intent.inputSource)).size).toBe(INPUT_SOURCES.length);
  });

  it('修订变化导致意图标识变化，因此陈旧绑定不会被误认为同一意图', () => {
    const otherView = uiViewFixture({
      revision: { sequence: 2, fingerprint: 'fp-2' },
      actions: [actionView({ actionId: 'act.move', bindings: [{ key: 'to', value: 'n1' }] })],
    });
    const first = build({ kind: 'action', actionId: 'act.move', bindings: { to: 'n1' } });
    const second = buildIntent({
      view: otherView,
      controlId: 'control.move',
      interactionId: 'interaction.move',
      inputSource: 'keyboard',
      selection: { kind: 'action', actionId: 'act.move', bindings: { to: 'n1' } },
    });
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.value.intentId).not.toBe(first.value.intentId);
  });
});

describe('不存在从用户输入直接构造目标标识的路径', () => {
  it('绑定键不在投影绑定中时被拒绝', () => {
    expect(build({ kind: 'action', actionId: 'act.move', bindings: { from: 'n1' } }).ok).toBe(false);
  });

  it('绑定取值不是投影中出现过的取值时被拒绝', () => {
    expect(build({ kind: 'action', actionId: 'act.move', bindings: { to: 'n9' } }).ok).toBe(false);
  });

  it('省略绑定是允许的：意图只能收窄而不能扩张', () => {
    expect(build({ kind: 'action', actionId: 'act.move', bindings: {} }).ok).toBe(true);
  });
});

describe('同一动作经不同来源构建出的意图除 inputSource 外逐字段相等', () => {
  it('五种归一化来源产出的意图只有 inputSource 不同', () => {
    const built = INPUT_SOURCES.map((source) => {
      const outcome = build({ kind: 'action', actionId: 'act.move', bindings: { to: 'n1' } }, source);
      if (!outcome.ok) throw new Error('unreachable');
      return outcome.value;
    });
    const first = built[0];
    if (first === undefined) throw new Error('unreachable');
    for (const intent of built) {
      expect({ ...intent, inputSource: 'keyboard' as const }).toStrictEqual({
        ...first,
        inputSource: 'keyboard' as const,
      });
    }
    expect(new Set(built.map((intent) => intent.intentId)).size).toBe(1);
    expect(new Set(built.map((intent) => intent.inputSource)).size).toBe(INPUT_SOURCES.length);
  });

  it('修订变化导致意图标识变化，因此陈旧绑定不会被误认为同一意图', () => {
    const otherView = uiViewFixture({
      revision: { sequence: 2, fingerprint: 'fp-2' },
      actions: [actionView({ actionId: 'act.move', bindings: [{ key: 'to', value: 'n1' }] })],
    });
    const first = build({ kind: 'action', actionId: 'act.move', bindings: { to: 'n1' } });
    const second = buildIntent({
      view: otherView,
      controlId: 'control.move',
      interactionId: 'interaction.move',
      inputSource: 'keyboard',
      selection: { kind: 'action', actionId: 'act.move', bindings: { to: 'n1' } },
    });
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(second.value.intentId).not.toBe(first.value.intentId);
  });
});
