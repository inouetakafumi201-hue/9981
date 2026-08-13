import { describe, expect, it } from 'vitest';

import { revision } from '../../__tests__/support/fixtures.js';
import type { PresentationCommand, PresentationCommandKind } from '../scheduler.js';
import {
  applyReducedMotion,
  presentationInformationSignature,
} from '../reduced-motion.js';

function command(kind: PresentationCommandKind, sequence: number): PresentationCommand {
  return Object.freeze({
    kind,
    eventSequences: Object.freeze([sequence]),
    semanticTypes: Object.freeze([`event.${sequence}`]),
    revision: revision(sequence, `fp-${sequence}`),
  });
}

describe('减少动态保持信息与权威时序', () => {
  it('非必要动效替换为静态最终态，必要播报和收敛指令原样保留', () => {
    const input = [
      command('play', 1),
      command('coalesce', 2),
      command('retarget', 3),
      command('announce', 4),
      command('cancel', 5),
      command('fast-forward', 6),
      command('final-state', 7),
    ] as const;
    const output = applyReducedMotion(input);
    expect(output.map((item) => item.kind)).toEqual([
      'final-state',
      'final-state',
      'final-state',
      'announce',
      'cancel',
      'fast-forward',
      'final-state',
    ]);
    expect(output[3]).toBe(input[3]);
    expect(output[4]).toBe(input[4]);
    expect(output[5]).toBe(input[5]);
    expect(output[6]).toBe(input[6]);
  });

  it('变换前后事件集合、语义类型、顺序与修订逐项相等', () => {
    const input = [command('play', 9), command('announce', 9), command('retarget', 10)];
    const output = applyReducedMotion(input);
    expect(presentationInformationSignature(output)).toEqual(
      presentationInformationSignature(input),
    );
    expect(output).toHaveLength(input.length);
  });

  it('不修改输入结构', () => {
    const input = Object.freeze([command('play', 1)]);
    const before = JSON.stringify(input);
    const output = applyReducedMotion(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(output).not.toBe(input);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output[0]?.eventSequences)).toBe(true);
  });
});
