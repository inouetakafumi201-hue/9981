// Feature: wakeup-ui-animation, Property 20: 语义拒绝不被降级掩盖
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { UI_DIAGNOSTIC_CODES } from '../../model/diagnostic.js';
import { validatePresentationDescriptor } from '../../presentation/descriptor-validator.js';
import { arbDamagedDescriptor } from '../support/arbitraries.js';

const SEMANTIC_FIELDS = ['actionId', 'costCategory', 'available', 'assetRefs', 'targets'] as const;

it('任意损坏语义字段都只产生 error 拒绝，不会转换为表现回退警告', () => {
  fc.assert(fc.property(fc.constantFrom(...SEMANTIC_FIELDS).chain(arbDamagedDescriptor), (damaged) => {
    const result = validatePresentationDescriptor({ descriptor: damaged.descriptor, bindingsByActionId: { 'action:0': [] } });
    expect(result.actions).toEqual([]);
    expect(result.diagnostics.some((item) => item.severity === 'error')).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).not.toContain(UI_DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED);
  }), { numRuns: 100 });
});
