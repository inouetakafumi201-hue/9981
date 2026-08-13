// Feature: wakeup-ui-animation, Property 2: 描述符缺字段必然导致交互省略
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { validatePresentationDescriptor } from '../../presentation/descriptor-validator.js';
import { arbDamagedDescriptor } from '../support/arbitraries.js';

const REQUIRED_ACTION_FIELDS = ['actionId', 'costCategory', 'available', 'assetRefs', 'targets'] as const;

it('任意必填动作语义字段损坏都会省略其全部交互并产出 error', () => {
  fc.assert(fc.property(fc.constantFrom(...REQUIRED_ACTION_FIELDS).chain(arbDamagedDescriptor), (damaged) => {
    const result = validatePresentationDescriptor({ descriptor: damaged.descriptor, bindingsByActionId: { 'action:0': [] } });
    expect(result.actions).toEqual([]);
    expect(result.diagnostics.some((item) => item.severity === 'error')).toBe(true);
  }), { numRuns: 100 });
});
