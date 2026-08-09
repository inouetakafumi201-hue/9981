import { describe, expect, it } from 'vitest';

import {
  acceptProjection,
  attemptSemanticWrite,
  createProjectionCache,
  findUnfrozenPaths,
  type AcceptProjectionInput,
} from '../projection-cache.js';
import {
  authority,
  descriptor,
  projection,
  revision,
} from '../../__tests__/support/fixtures.js';
import type { ReadOnlySemanticProjection } from '../../model/view.js';

function input(overrides: Partial<AcceptProjectionInput> = {}): AcceptProjectionInput {
  return {
    agentId: 'agent.a',
    scopeId: 'scope.a',
    revision: revision(1, 'fp-1'),
    projection: projection(),
    descriptor: descriptor(),
    authority: authority(),
    ...overrides,
  };
}

/** 构造一份"外层已冻结、嵌套层未冻结"的投影，模拟上游违约。 */
function shallowFrozenProjection(): ReadOnlySemanticProjection {
  const entities = [{ entityId: 'e1', properties: [], statusIds: [], locationNodeId: 'n1' }];
  return Object.freeze({
    scopeId: 'scope.a',
    consumer: 'ui' as const,
    turn: 1,
    definitions: Object.freeze([]),
    entities: Object.freeze(entities),
    beliefSlices: Object.freeze([]),
    visibility: Object.freeze([]),
    semanticStateFingerprint: 'fp-1',
  }) as unknown as ReadOnlySemanticProjection;
}

describe('深冻结断言（tasks.md 任务 3.1）', () => {
  it('深冻结投影被接受', () => {
    const result = acceptProjection(input());
    expect(result.ok).toBe(true);
  });

  it('含未冻结嵌套层的投影被拒绝，并携带 PROJECTION_NOT_FROZEN', () => {
    const result = acceptProjection(input({ projection: shallowFrozenProjection() }));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('PROJECTION_NOT_FROZEN');
    expect(result.diagnostics[0]?.severity).toBe('error');
  });
