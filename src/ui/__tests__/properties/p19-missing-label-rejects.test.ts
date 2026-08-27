// Feature: wakeup-ui-animation, Property 19: 无障碍标签缺失导致拒绝而非静默放行
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { UI_DIAGNOSTIC_CODES } from '../../model/diagnostic';
import { resolveAccessibleLabel } from '../../presentation/accessibility';

it('任意缺失标签且无稳定标识的必要呈现都结构化拒绝', () => {
  const missing = fc.oneof(fc.constant(undefined), fc.constant(null), fc.stringMatching(/^\s*$/u));
  fc.assert(fc.property(missing, (label) => {
    const result = resolveAccessibleLabel({ label, stableIdentifier: undefined, essential: true, presentationLocation: 'property/p19' });
    expect(result.kind).toBe('rejected');
    expect(result.text).toBe('');
    expect(result.diagnostics.map((item) => item.code)).toContain(UI_DIAGNOSTIC_CODES.ACCESSIBLE_LABEL_MISSING);
    expect(result.diagnostics.every((item) => item.severity === 'error')).toBe(true);
  }), { numRuns: 100 });
});
