/**
 * L4 调度影子模型：五阶段 / depth / 重入 / 反应轮 / prevent 语义
 *
 * 与 src/hook-system.ts 零共享代码。作用域刻意收窄为"仅全局 Hook"——
 * 容器/槽位/物品的收集与排序已由 l4-order-model.test.ts 穷尽覆盖，
 * 本模型专注调度流程，保持每个 oracle 小而可审。
 */
import { HookPhase } from '../../src/index.js';

export type Action =
  | { kind: 'noop' }
  | { kind: 'emit'; target: string }
  | { kind: 'react'; target: string }
  | { kind: 'preventAll' }
  | { kind: 'preventExcept'; types: string[] }
  | { kind: 'throw' };

export interface HookSpec {
  id: string;
  on: string;
  phase: HookPhase;
  priority: number;
  /** 静态 when：false 表示该 Hook 恒被跳过 */
  when: boolean;
  action: Action;
}

export interface Scenario {
  hooks: HookSpec[];
  /** 注册了 default handler 的事件名 */
  defaults: string[];
  rootType: string;
}

export interface RunResult {
  /** 规范化轨迹：`kind:type:phase:hookId:depth` */
  trace: string[];
  /** 抛出的错误消息；未抛出为 '' */
  error: string;
}

export const MAX_DEPTH = 32;
export const MAX_REACTION_ROUNDS = 8;

/** before / modify 两个阶段：按注册顺序执行，返回值忽略。 */
const PHASE_SEQUENCE: HookPhase[] = [HookPhase.Before, HookPhase.Modify];

/** 模型内部使用的哨兵异常，用于模拟 effect 抛错。 */
class ModelThrow extends Error {
  constructor() {
    super('boom');
  }
}

/**
 * 独立实现的调度模型。
 *
 * 契约：
 *  1. emit 在 depth===0 时为"根事件"：清空反应队列、reactionRounds 置 1，
 *     dispatch 结束后 drain 反应队列。
 *  2. dispatch 进入时若 depth >= MAX_DEPTH 抛 E_HOOK_DEPTH_EXCEEDED（先判后增）。
 *  3. 阶段顺序 before → modify → instead → default → after。
 *  4. instead 阶段按 (priority 降, 注册序 升) 排序；返回 preventAll，
 *     或返回 preventExcept 且其中不含当前事件类型，则阻止 default 并中断 instead 链。
 *  5. before / modify / after 阶段的返回值一律忽略。
 *  6. 重入判定：调用栈中已存在同 (type, hookId) 时抛 E_HOOK_REENTRY。
 *  7. drain：队列非空且 reactionRounds < MAX_REACTION_ROUNDS 时，
 *     取出整轮、rounds++、逐个 dispatch；结束后清空队列。
 */
export function runModel(scenario: Scenario): RunResult {
  const trace: string[] = [];
  const callStack: Array<{ type: string; hookId: string }> = [];
  let depth = 0;
  let reactionRounds = 0;
  let queue: Array<{ type: string }> = [];

  const defaults = new Set(scenario.defaults);

  const record = (kind: 'hook' | 'default', type: string, phase: string, hookId: string): void => {
    trace.push(`${kind}:${type}:${phase}:${hookId}:${depth}`);
  };

  const hooksFor = (type: string, phase: HookPhase): Array<{ spec: HookSpec; order: number }> =>
    scenario.hooks
      .map((spec, order) => ({ spec, order }))
      .filter((entry) => entry.spec.on === type && entry.spec.phase === phase && entry.spec.when);

  const sortInstead = (
    entries: Array<{ spec: HookSpec; order: number }>,
  ): Array<{ spec: HookSpec; order: number }> =>
    [...entries].sort((a, b) => {
      if (a.spec.priority !== b.spec.priority) return b.spec.priority - a.spec.priority;
      // 全局 Hook：containerIndex/slotIndex 均为 0，defId===hookId
      if (a.spec.id !== b.spec.id) return a.spec.id < b.spec.id ? -1 : 1;
      return a.order - b.order;
    });

  /** 执行一个 Hook 的 action，返回 prevent 结果。 */
  const applyAction = (action: Action, type: string): { preventAll?: boolean; preventExcept?: string[] } | undefined => {
    switch (action.kind) {
      case 'noop':
        return undefined;
      case 'emit':
        emit(action.target);
        return undefined;
      case 'react':
        queue.push({ type: action.target });
        return undefined;
      case 'preventAll':
        return { preventAll: true };
      case 'preventExcept':
        return { preventExcept: action.types };
      case 'throw':
        throw new ModelThrow();
      default: {
        const exhaustive: never = action;
        void exhaustive;
        void type;
        return undefined;
      }
    }
  };

  const invoke = (
    type: string,
    spec: HookSpec,
  ): { preventAll?: boolean; preventExcept?: string[] } | undefined => {
    if (callStack.some((frame) => frame.type === type && frame.hookId === spec.id)) {
      throw new Error('E_HOOK_REENTRY');
    }
    record('hook', type, spec.phase, spec.id);
    callStack.push({ type, hookId: spec.id });
    try {
      return applyAction(spec.action, type);
    } finally {
      callStack.pop();
    }
  };

  const dispatch = (type: string): void => {
    if (depth >= MAX_DEPTH) throw new Error('E_HOOK_DEPTH_EXCEEDED');
    depth++;
    try {
      for (const phase of PHASE_SEQUENCE) {
        for (const entry of hooksFor(type, phase)) invoke(type, entry.spec);
      }

      let prevented = false;
      for (const entry of sortInstead(hooksFor(type, HookPhase.Instead))) {
        const result = invoke(type, entry.spec);
        if (result?.preventAll) {
          prevented = true;
          break;
        }
        if (result?.preventExcept && !result.preventExcept.includes(type)) {
          prevented = true;
          break;
        }
      }

      if (!prevented && defaults.has(type)) {
        record('default', type, 'default', `<default:${type}>`);
      }

      for (const entry of hooksFor(type, HookPhase.After)) invoke(type, entry.spec);
    } finally {
      depth--;
      if (depth === 0) callStack.length = 0;
    }
  };

  const drain = (): void => {
    while (queue.length > 0 && reactionRounds < MAX_REACTION_ROUNDS) {
      const round = queue;
      queue = [];
      reactionRounds++;
      for (const reaction of round) dispatch(reaction.type);
    }
    queue = [];
  };

  const emit = (type: string): void => {
    const isRoot = depth === 0;
    if (isRoot) {
      queue = [];
      reactionRounds = 1;
    }
    dispatch(type);
    if (isRoot) drain();
  };

  let error = '';
  try {
    emit(scenario.rootType);
  } catch (caught) {
    error = caught instanceof ModelThrow ? 'boom' : (caught as Error).message;
  }

  return { trace, error };
}
