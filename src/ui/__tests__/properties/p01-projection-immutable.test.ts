// Feature: wakeup-ui-animation, Property 1: 投影层不暴露可变引用
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { acceptProjection, attemptSemanticWrite, findUnfrozenPaths } from '../../projection/projection-cache.js';
import { arbDescriptor, arbReachableProjection } from '../support/arbitraries.js';
import { authority, revision } from '../support/fixtures.js';

it('任意已验证投影与描述符均深冻结且写入尝试不改变指纹', () => {
  fc.assert(fc.property(arbReachableProjection(), arbDescriptor(), (reachable, descriptor) => {
    const fingerprint = reachable.projection.semanticStateFingerprint;
    expect(findUnfrozenPaths(reachable.projection)).toEqual([]);
    expect(findUnfrozenPaths(descriptor)).toEqual([]);
    const accepted = acceptProjection({ agentId: 'agent:0', scopeId: reachable.projection.scopeId, revision: revision(1, fingerprint), projection: reachable.projection, descriptor, authority: authority() });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const rejection = attemptSemanticWrite(accepted.value, ['entities', '0', 'locationNodeId'], 'forbidden');
    expect(rejection.rejected).toBe(true);
    expect(reachable.projection.semanticStateFingerprint).toBe(fingerprint);
  }), { numRuns: 100 });
});
