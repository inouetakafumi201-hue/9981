/**
 * Task 42: PresentationGateway boundary tests.
 * Verifies: no OpRegistry/Transaction in gateway exports.
 */
import { describe, it, expect } from 'vitest';
import { PresentationGateway } from '../gateway';
import { QueryEngine } from '../expr/query-engine';
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine';
import { ActionCatalog } from '../actions/catalog';
import { createEmptyWorldState } from '../state/world-state';

function makeGateway() {
  const state = createEmptyWorldState('sched:1');
  const queryEngine = new QueryEngine();
  const exprEngine = new ExprEngine();
  const baseCtx = makeDefaultEvalContext({ resolvePath: () => null });
  const catalog = new ActionCatalog({
    getState: () => state,
    queryEngine,
    ctxForActor: () => baseCtx,
    listActionDefs: () => [],
  });
  return new PresentationGateway({
    getState: () => state,
    queryEngine,
    exprEngine,
    actionCatalog: catalog,
    ctxForSelf: () => baseCtx,
    baseCtx: () => baseCtx,
  });
}

describe('Task 42: PresentationGateway boundary tests', () => {
  it('subscribe + dispatch 事件传递', () => {
    const gateway = makeGateway();
    const received: Array<{ type: string; payload: unknown }> = [];
    const sub = gateway.subscribe('entity.created', (type, payload) => {
      received.push({ type, payload });
    });
    gateway.dispatch('entity.created', { id: 'e:1' });
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('entity.created');
    sub.unsubscribe();
    gateway.dispatch('entity.created', { id: 'e:2' });
    expect(received).toHaveLength(1); // unsubscribed
  });

  it('subscribe * 通配符接收所有事件', () => {
    const gateway = makeGateway();
    const received: string[] = [];
    gateway.subscribe('*', (type) => received.push(type));
    gateway.dispatch('a.b', {});
    gateway.dispatch('c.d', {});
    expect(received).toEqual(['a.b', 'c.d']);
  });

  it('query 返回 Ref 数组', () => {
    const gateway = makeGateway();
    const refs = gateway.query({ from: 'entities' });
    expect(Array.isArray(refs)).toBe(true);
  });

  it('queryActions 返回空数组（无 ActionDef）', () => {
    const gateway = makeGateway();
    const actions = gateway.queryActions({ $: 'e:1' });
    expect(Array.isArray(actions)).toBe(true);
    expect(actions).toHaveLength(0);
  });

  it('架构边界：gateway.ts 导出不包含 OpRegistry / Transaction / WorldStateHolder', async () => {
    const mod = await import('../gateway');
    const keys = Object.keys(mod);
    expect(keys).not.toContain('OpRegistry');
    expect(keys).not.toContain('Transaction');
    expect(keys).not.toContain('WorldStateHolder');
    // Must export PresentationGateway
    expect(keys).toContain('PresentationGateway');
  });
});
