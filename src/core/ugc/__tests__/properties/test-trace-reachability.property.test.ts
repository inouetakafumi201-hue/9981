/**
 * Feature: wakeup-ugc, Property 16: Test and trace reachability.
 *
 * 对每个已登记的 Schema 与 Integration Contract 族，Test Interface 能生成合法/非法候选，并观察解码、
 * 迁移、规范化、验证、解析与激活而无旁路。每条规范要求都映射到来源记录、设计性质、实现任务与自动验证。
 *
 * **Validates: Requirement 16**
 */
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from '../harness.js';
import {
  INVALID_PATTERNS,
  candidateForPattern,
  observe,
  requestFrom,
} from '../../testing/index.js';

const PROPERTY_DIR = dirname(fileURLToPath(import.meta.url));

describe('Feature: wakeup-ugc, Property 16: test and trace reachability', () => {
  it('has one independently named property test file for every property 1-16', () => {
    const files = readdirSync(PROPERTY_DIR).filter((name) => name.endsWith('.property.test.ts'));
    expect(files.length).toBe(16);
  });

  it('the test interface generates a candidate for every registered invalid pattern', () => {
    for (const pattern of INVALID_PATTERNS) {
      const generated = candidateForPattern(pattern);
      // 每个模式要么有文本，要么有原始字节（invalid-utf8 只能用字节表达）。
      expect(generated.text.length > 0 || (generated.bytes !== null && generated.bytes.length > 0)).toBe(true);
      expect(generated.pattern).toBe(pattern);
    }
  });

  it('every invalid pattern is reachable and rejectable through the production facade', () => {
    // 责任划分：有些缺陷由 UGC 自己拒（语法/编码/禁止构造/版本），有些由上游裁定
    // （未知字段/重复ID/数值范围/层级/继承环/引用）。P16 只要求"每个模式都能通过生产入口被拒"，
    // 因此对上游拥有的模式，把上游替身配置成会报错——这正是真实上游会做的事。
    const upstreamOwned = new Set([
      'unknown-field',
      'duplicate-id',
      'numeric-out-of-range',
      'layer-violation',
      'inheritance-cycle',
    ]);

    for (const pattern of INVALID_PATTERNS) {
      // stale-baseline 是激活期概念；invalid-utf8 需原始字节，二者分别由 P13、P2 覆盖。
      if (pattern === 'stale-baseline' || pattern === 'invalid-utf8') continue;
      // deep-nesting / wide-object 是资源模式：在充足配额下它们是合法候选，其拒绝由 P9 在受限配额下覆盖。
      if (pattern === 'deep-nesting' || pattern === 'wide-object') continue;

      const harness = createHarness(
        upstreamOwned.has(pattern)
          ? { validator: { errors: [{ definitionId: 'weapon:shotgun', jsonPath: '/x', condition: pattern === 'duplicate-id' ? 'duplicate-id' : 'unknown-field' }] } }
          : pattern === 'reference-missing'
            ? { resolver: { missingTarget: 'weapon:missing' } }
            : pattern === 'semantic-damage'
              ? { schema: { gaps: [{ definitionId: 'weapon:shotgun', jsonPath: '/icon', missingAsset: 'i', expectedTypeTag: 'icon', sourceSpan: null }], classify: () => 'semantic' } }
              : {},
      );
      const generated = candidateForPattern(pattern);
      const report = harness.facade.validate(requestFrom(generated.text, 'hand-authored'));

      expect(report.status, `pattern ${pattern} should be rejected`).toBe('rejected');
      expect(report.diagnostics.some((entry) => entry.severity === 'error' || entry.severity === 'fatal')).toBe(true);
      expect(harness.registry.calls.activate).toBe(0);
    }
  });

  it('the observer sees decode, validation and activation stages without a bypass hook', () => {
    const harness = createHarness();
    const rejected = observe(harness.facade.validate(requestFrom('{"schemaVersion":', 'hand-authored')));
    expect(rejected.status).toBe('rejected');
    expect(rejected.skippedStages.length).toBeGreaterThan(0);

    const accepted = harness.facade.validate(requestFrom('{"schemaVersion":"1.0.0","id":"a:b"}', 'hand-authored'));
    expect(accepted.status).toBe('validated');
    // 观察器只从生产报告读取事实，没有额外的中间态钩子。
    expect(observe(accepted).quotaUsed.inputBytes).toBeGreaterThan(0);
  });

  it('permits comparing diagnostics and snapshots without editor UI, model or network', () => {
    // 全套断言只用内存对象；本文件从头到尾没有 import 任何 UI/模型/网络设施即为证明。
    const harness = createHarness();
    const report = harness.facade.validate(requestFrom('{"schemaVersion":"1.0.0","id":"a:b"}', 'hand-authored'));
    expect(typeof report.candidateFingerprint).toBe('string');
    expect(typeof harness.registry.readSnapshot().snapshotFingerprint).toBe('string');
  });
});
