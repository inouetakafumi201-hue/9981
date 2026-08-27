import { describe, it, expect } from 'vitest';
import { HookDispatcher } from '../dispatcher';
import type { EffectRunner, HookCandidate } from '../dispatcher';
import { ok } from '../../ops/result';
import { Transaction } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import type { OpContext } from '../../ops/registry';
import type { RuleDef } from '../types';

function makeCtx(): OpContext {
  return { tx: new Transaction(createEmptyWorldState('sched:1')), depth: 0, emit: () => {} };
}

function rule(id: string, opts?: Partial<RuleDef>): RuleDef {
  return { id, kind: 'rule', on: 'test', phase: 'default', priority: 0, effects: [], ...opts };
}

describe('RuleDef 三种挂载生命周期（需求23.8-23.9）', () => {
  /**
   * 需求23.9：同一个 RuleDef 结构在 PlaypackDef（全局常驻）、AttachmentDef.rules（状态存续期间生效）、
   * attach.add(world,mod)（运行期开关）三种挂载下具有不同生命周期，但 RuleDef 本身不因挂载方式分叉。
   * L4 阶段只验证：HookDispatcher 消费的 HookCandidate[] 是一个"当前生效的 RuleDef 集合"，
   * 不关心这些 RuleDef 是从哪种挂载来源收集来的——这正是"结构不分叉"的可验证含义：
   * 只要调用方传入的 candidates 数组包含某个 RuleDef，它就会被同等对待地参与调度，
   * 无论该 RuleDef 是常驻声明的还是运行期临时挂载的。
   */
  it('相同结构的 RuleDef 无论来自何种挂载来源，参与调度的行为完全一致', () => {
    const log: string[] = [];
    const runner: EffectRunner = (_e, _c, vars, ruleId) => {
      log.push(ruleId);
      return { result: ok(undefined), vars };
    };

    // 模拟三种来源产出的候选集合在结构上完全相同（同一个 RuleDef 对象）
    const sharedRule = rule('r:global-or-attachment-or-runtime');
    const fromPlaypack: HookCandidate[] = [{ rule: sharedRule }];
    const fromAttachment: HookCandidate[] = [{ rule: sharedRule }];
    const fromRuntimeToggle: HookCandidate[] = [{ rule: sharedRule }];

    for (const candidates of [fromPlaypack, fromAttachment, fromRuntimeToggle]) {
      log.length = 0;
      const dispatcher = new HookDispatcher({ runEffects: runner });
      const result = dispatcher.dispatch('test.event', {}, candidates, makeCtx());
      expect(result.cancelled).toBe(false);
      expect(log).toEqual(['r:global-or-attachment-or-runtime']);
    }
  });

  it('未出现在 candidates 里的 RuleDef（如已被挂载来源移除/未挂载）不参与调度', () => {
    const log: string[] = [];
    const runner: EffectRunner = (_e, _c, vars, ruleId) => {
      log.push(ruleId);
      return { result: ok(undefined), vars };
    };
    const dispatcher = new HookDispatcher({ runEffects: runner });
    // 空 candidates 模拟"该 Attachment 已被移除，其 rules 不再挂载"
    const result = dispatcher.dispatch('test.event', {}, [], makeCtx());
    expect(result.cancelled).toBe(false);
    expect(log).toEqual([]);
  });
});
