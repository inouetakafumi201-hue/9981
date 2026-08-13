import { describe, expect, it } from 'vitest';

import {
  INPUT_SOURCE_BY_RAW_KIND,
  RAW_INPUT_KINDS,
  buildBindingIndex,
  normalizeInput,
  type InputBinding,
} from '../input-normalizer.js';

/** 六类物理来源各绑一个物理输入，全部指向同一稳定交互标识与同一控件。 */
const SIX_SOURCE_BINDINGS: readonly InputBinding[] = Object.freeze(
  RAW_INPUT_KINDS.map((kind) => ({
    physicalId: `physical.${kind}`,
    controlId: 'control.move',
    interactionId: 'interaction.move',
  })),
);

function index(bindings: readonly InputBinding[] = SIX_SOURCE_BINDINGS) {
  const built = buildBindingIndex(bindings);
  if (!built.ok) throw new Error('fixture bindings must be conflict-free');
  return built.value;
}

describe('输入归一化（tasks.md 任务 5.1）', () => {
  it('六类来源对同一动作产出相同的稳定交互标识与控件', () => {
    const resolved = RAW_INPUT_KINDS.map((rawKind) => {
      const outcome = normalizeInput({ rawKind, physicalId: `physical.${rawKind}` }, index());
      if (!outcome.ok) throw new Error(`normalization must succeed for ${rawKind}`);
      return outcome.value;
    });
    expect(new Set(resolved.map((item) => item.interactionId)).size).toBe(1);
    expect(new Set(resolved.map((item) => item.controlId)).size).toBe(1);
  });

  it('开关控制与辅助自动化归一到 assistive，其余一一对应', () => {
    expect(INPUT_SOURCE_BY_RAW_KIND).toEqual({
      keyboard: 'keyboard',
      pointer: 'pointer',
      touch: 'touch',
      gamepad: 'gamepad',
      'switch-control': 'assistive',
      'assistive-automation': 'assistive',
    });
    expect(new Set(Object.values(INPUT_SOURCE_BY_RAW_KIND)).size).toBe(5);
  });

  it('改绑前后动作标识与合法性不变：输出里根本没有合法性字段', () => {
    const before = normalizeInput({ rawKind: 'keyboard', physicalId: 'physical.keyboard' }, index());
    const rebound = normalizeInput(
      { rawKind: 'keyboard', physicalId: 'key.Q' },
      index([{ physicalId: 'key.Q', controlId: 'control.move', interactionId: 'interaction.move' }]),
    );
    if (!before.ok || !rebound.ok) throw new Error('both normalizations must succeed');
    expect(rebound.value.interactionId).toBe(before.value.interactionId);
    expect(rebound.value.controlId).toBe(before.value.controlId);
    expect(Object.keys(rebound.value).sort()).toEqual(['controlId', 'inputSource', 'interactionId']);
  });
});

describe('绑定冲突被报告而非静默丢弃（Requirement 11.8）', () => {
  const conflicting: readonly InputBinding[] = Object.freeze([
    { physicalId: 'key.E', controlId: 'control.move', interactionId: 'interaction.move' },
    { physicalId: 'key.E', controlId: 'control.attack', interactionId: 'interaction.attack' },
  ]);

  it('同一物理输入映射到不同交互标识时整体被拒绝', () => {
    const built = buildBindingIndex(conflicting);
    expect(built.ok).toBe(false);
    expect(built.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['INPUT_BINDING_CONFLICT']);
    expect(built.diagnostics[0]?.severity).toBe('error');
  });

  it('冲突报告确定性：同一组绑定无论顺序都给出同一份报告', () => {
    const forward = buildBindingIndex(conflicting);
    const reversed = buildBindingIndex([...conflicting].reverse());
    expect(reversed.diagnostics.map((diagnostic) => diagnostic.reason)).toEqual(
      forward.diagnostics.map((diagnostic) => diagnostic.reason),
    );
  });

  it('多组冲突按物理输入的码点序报告', () => {
    const built = buildBindingIndex([
      { physicalId: 'key.Z', controlId: 'c1', interactionId: 'i1' },
      { physicalId: 'key.Z', controlId: 'c2', interactionId: 'i2' },
      { physicalId: 'key.A', controlId: 'c3', interactionId: 'i3' },
      { physicalId: 'key.A', controlId: 'c4', interactionId: 'i4' },
    ]);
    expect(built.diagnostics).toHaveLength(2);
    expect(built.diagnostics[0]?.presentationLocation).toContain('key.A');
    expect(built.diagnostics[1]?.presentationLocation).toContain('key.Z');
  });

  it('完全重复的绑定不算冲突', () => {
    const built = buildBindingIndex([
      { physicalId: 'key.E', controlId: 'c1', interactionId: 'i1' },
      { physicalId: 'key.E', controlId: 'c1', interactionId: 'i1' },
    ]);
    expect(built.ok).toBe(true);
  });

  it('未绑定的物理输入不会被当作任何动作', () => {
    const outcome = normalizeInput({ rawKind: 'keyboard', physicalId: 'key.unbound' }, index());
    expect(outcome.ok).toBe(false);
  });
});

describe('绑定冲突被报告而非静默丢弃（Requirement 11.8）', () => {
  const conflicting: readonly InputBinding[] = Object.freeze([
    { physicalId: 'key.E', controlId: 'control.move', interactionId: 'interaction.move' },
    { physicalId: 'key.E', controlId: 'control.attack', interactionId: 'interaction.attack' },
  ]);

  it('同一物理输入映射到不同交互标识时整体被拒绝', () => {
    const built = buildBindingIndex(conflicting);
    expect(built.ok).toBe(false);
    expect(built.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['INPUT_BINDING_CONFLICT']);
    expect(built.diagnostics[0]?.severity).toBe('error');
  });

  it('冲突报告确定性：同一组绑定无论顺序都给出同一份报告', () => {
    const forward = buildBindingIndex(conflicting);
    const reversed = buildBindingIndex([...conflicting].reverse());
    expect(reversed.diagnostics.map((diagnostic) => diagnostic.reason)).toEqual(
      forward.diagnostics.map((diagnostic) => diagnostic.reason),
    );
  });

  it('多组冲突按物理输入的码点序报告', () => {
    const built = buildBindingIndex([
      { physicalId: 'key.Z', controlId: 'c1', interactionId: 'i1' },
      { physicalId: 'key.Z', controlId: 'c2', interactionId: 'i2' },
      { physicalId: 'key.A', controlId: 'c3', interactionId: 'i3' },
      { physicalId: 'key.A', controlId: 'c4', interactionId: 'i4' },
    ]);
    expect(built.diagnostics).toHaveLength(2);
    expect(built.diagnostics[0]?.presentationLocation).toContain('key.A');
    expect(built.diagnostics[1]?.presentationLocation).toContain('key.Z');
  });

  it('完全重复的绑定不算冲突', () => {
    const built = buildBindingIndex([
      { physicalId: 'key.E', controlId: 'c1', interactionId: 'i1' },
      { physicalId: 'key.E', controlId: 'c1', interactionId: 'i1' },
    ]);
    expect(built.ok).toBe(true);
  });

  it('未绑定的物理输入不会被当作任何动作', () => {
    const outcome = normalizeInput({ rawKind: 'keyboard', physicalId: 'key.unbound' }, index());
    expect(outcome.ok).toBe(false);
  });
});
