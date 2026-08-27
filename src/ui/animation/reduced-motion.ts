/**
 * 减少动态适配（design.md §16.3，tasks.md 任务 6.2）。
 *
 * 非必要运动指令被替换为同顺序、同事件集合、同修订的静态最终态；播报与收敛指令原样保留。
 * 该变换不接触动作可用性，也不改变权威时序键。
 */

import {
  NONESSENTIAL_COMMAND_KINDS,
  type PresentationCommand,
  type PresentationCommandKind,
} from './scheduler';

const NONESSENTIAL = new Set<PresentationCommandKind>(NONESSENTIAL_COMMAND_KINDS);

function freezeAsFinalState(command: PresentationCommand): PresentationCommand {
  return Object.freeze({
    kind: 'final-state' as const,
    eventSequences: Object.freeze([...command.eventSequences]),
    semanticTypes: Object.freeze([...command.semanticTypes]),
    revision: command.revision,
  });
}

/**
 * 保序纯变换。每个输入指令对应恰好一个输出指令，因此不会通过删除项泄漏事件数量或顺序。
 */
export function applyReducedMotion(
  commands: readonly PresentationCommand[],
): readonly PresentationCommand[] {
  return Object.freeze(
    commands.map((command) =>
      NONESSENTIAL.has(command.kind) ? freezeAsFinalState(command) : command,
    ),
  );
}

export interface PresentationInformationSignature {
  readonly eventSequences: readonly number[];
  readonly semanticTypes: readonly string[];
  readonly revisionSequence: number;
  readonly revisionFingerprint: string;
}

/** 用于验证减少动态前后的信息与权威时序逐项等价。 */
export function presentationInformationSignature(
  commands: readonly PresentationCommand[],
): readonly PresentationInformationSignature[] {
  return Object.freeze(
    commands.map((command) =>
      Object.freeze({
        eventSequences: Object.freeze([...command.eventSequences]),
        semanticTypes: Object.freeze([...command.semanticTypes]),
        revisionSequence: command.revision.sequence,
        revisionFingerprint: command.revision.fingerprint,
      }),
    ),
  );
}
