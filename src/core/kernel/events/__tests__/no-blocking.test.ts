import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HookDispatcher } from '../dispatcher.js';
import { ok } from '../../ops/result.js';
import { Transaction } from '../../ops/transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';

describe('架构测试：HookDispatcher 内部不导出任何等待类型（需求28.1, 28.4）', () => {
  it('dispatcher.ts 源码不包含 Promise/async/await/setTimeout 等阻塞或异步等待原语', () => {
    const content = readFileSync(join(process.cwd(), 'src/core/kernel/events/dispatcher.ts'), 'utf-8');
    expect(content.includes('Promise')).toBe(false);
    expect(content.includes('async ')).toBe(false);
    expect(content.includes('await ')).toBe(false);
    expect(content.includes('setTimeout')).toBe(false);
    expect(content.includes('setInterval')).toBe(false);
  });

  it('HookDispatcher.dispatch 是同步函数：调用后立即返回 DispatchResult，不返回 Promise', () => {
    const dispatcher = new HookDispatcher({ runEffects: () => ({ result: ok(undefined), vars: {} }) });
    const ctx = { tx: new Transaction(createEmptyWorldState('sched:1')), depth: 0, emit: () => {} };
    const result = dispatcher.dispatch('e', {}, [], ctx);
    expect(result instanceof Promise).toBe(false);
    expect(typeof result.cancelled).toBe('boolean');
  });
});
