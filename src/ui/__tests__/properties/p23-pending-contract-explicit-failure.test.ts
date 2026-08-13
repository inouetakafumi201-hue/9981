// Feature: wakeup-ui-animation, Property 23: 待汇合契约缺失是显式失败
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { UI_DIAGNOSTIC_CODES } from '../../model/diagnostic.js';
import { createPendingContractPorts } from '../support/in-memory-ports.js';

it('任意待汇合能力调用都返回缺失项而非空值或默认值', () => {
  fc.assert(fc.property(fc.constantFrom('resources', 'phase', 'actions', 'scenes', 'ai'), (capability) => {
    const ports = createPendingContractPorts();
    const result = capability === 'resources' ? ports.core.projectedResources('e') : capability === 'phase' ? ports.core.phaseSemantics() : capability === 'actions' ? ports.core.legalActions('e') : capability === 'scenes' ? ports.spaceItems.visibleScenes() : ports.ai.visibleActionState();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(UI_DIAGNOSTIC_CODES.PENDING_CONVERGENCE_CONTRACT);
    expect(result.missing.length).toBeGreaterThan(0);
  }), { numRuns: 100 });
});
