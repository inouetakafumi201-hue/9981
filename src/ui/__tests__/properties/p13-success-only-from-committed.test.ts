// Feature: wakeup-ui-animation, Property 13: 成功只由已提交投影确认
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { createPendingRegistry } from '../../interaction/pending-registry';
import { createSubmitFlow } from '../../interaction/submit';
import type { InteractionIntent } from '../../model/intent';
import { createInMemoryActionPort } from '../support/in-memory-ports';
import { revision } from '../support/fixtures';

it('任意 accepted 提交在目标修订到达前均未完成，到达后才完成', () => {
  fc.assert(fc.property(fc.nat({ max: 1000 }), (sequence) => {
    const committed = revision(sequence + 2, `fp:${sequence + 2}`);
    const port = createInMemoryActionPort({ kind: 'accepted', committedRevision: committed });
    const flow = createSubmitFlow({ actionPort: port, registry: createPendingRegistry() });
    const intent: InteractionIntent = Object.freeze({ intentId: `intent:${sequence}`, agentId: 'agent:0', target: Object.freeze({ kind: 'action' as const, actionId: 'act' }), bindings: Object.freeze({}), observedRevision: revision(sequence, `fp:${sequence}`), inputSource: 'keyboard' });
    expect(flow.activate('control', intent).state).toBe('awaiting-committed-revision');
    expect(flow.observeRevision(revision(sequence + 1, `fp:${sequence + 1}`))).toEqual([]);
    expect(flow.stateOf('control')).toBe('awaiting-committed-revision');
    expect(flow.observeRevision(committed).map((step) => step.state)).toEqual(['completed']);
  }), { numRuns: 100 });
});
