// Feature: wakeup-ui-animation, Property 10: UI 目录不含写入标识符
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { scanUiSources } from '../support/source-scan.js';

it('任意重复扫描中 UI 代码都不含写入通道标识符', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const forbidden = [['Op', 'Registry'], ['register', 'Op'], ['define', 'Query'], ['invoke', 'Inline'], ['prop', '.', 'set'], ['prop', '.', 'add']].map((parts) => parts.join(''));
  fc.assert(fc.property(fc.nat(), () => {
    const violations = scanUiSources(root).filter((source) => source.path !== '__tests__/architecture.test.ts' && source.path !== '__tests__/properties/p10-no-write-identifiers.test.ts').flatMap((source) => forbidden.filter((identifier) => source.code.includes(identifier)).map((identifier) => `${source.path}:${identifier}`));
    expect(violations).toEqual([]);
  }), { numRuns: 100 });
});
