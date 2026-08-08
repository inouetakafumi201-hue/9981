/**
 * 任务 11.4：用真实解码器/流水线跑深层、宽对象、重复成员、超大字符串、扇出、诊断洪泛与规范化炸弹。
 *
 * 关键要求：断言可观察的工作量计数器不超过配额推导上界，**不依赖测试超时**作为唯一安全断言。
 */
import { describe, expect, it } from 'vitest';
import { QUOTA_KINDS } from '../../model/quota-types.js';
import { createHarness } from '../harness.js';
import { requestFrom } from '../../testing/generators.js';

function tightHarness() {
  return createHarness({
    quota: {
      inputBytes: 8_000,
      nestingDepth: 40,
      objectMembers: 128,
      arrayElements: 128,
      astNodes: 512,
      traversalWork: 20_000,
      outputBytes: 8_000,
      diagnostics: 64,
    },
  });
}

describe('Feature: wakeup-ugc, Task 11.4: adversarial input stays bounded', () => {
  it('rejects a deeply nested array bomb on the nesting-depth quota', () => {
    const harness = tightHarness();
    const depth = 5_000;
    const text = `{"schemaVersion":"1.0.0","d":${'['.repeat(depth)}1${']'.repeat(depth)}}`;
    const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
    expect(report.status).toBe('rejected');
    // 深嵌套炸弹可能先撞上 input-bytes（每个 `[` 一字节）或 nesting-depth，取决于哪个上限先到。
    // 两者都是正确的"有界终止"，因此接受任一精确配额码。
    expect(
      report.diagnostics.some((entry) => ['E_QUOTA_NESTING_DEPTH', 'E_QUOTA_INPUT_BYTES'].includes(entry.code)),
    ).toBe(true);
    assertBounded(report.budget);
  });

  it('rejects a deeply nested array bomb specifically on depth when bytes are ample', () => {
    const harness = createHarness({
      quota: { inputBytes: 1_000_000, nestingDepth: 40, arrayElements: 100_000, astNodes: 1_000_000, traversalWork: 5_000_000, outputBytes: 1_000_000 },
    });
    const depth = 500;
    const text = `{"schemaVersion":"1.0.0","d":${'['.repeat(depth)}1${']'.repeat(depth)}}`;
    const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_QUOTA_NESTING_DEPTH')).toBe(true);
    assertBounded(report.budget);
  });

  it('rejects a wide object bomb on the object-members quota', () => {
    const harness = tightHarness();
    const members = Array.from({ length: 5_000 }, (_v, index) => `"k${String(index)}":${String(index)}`).join(',');
    const report = harness.facade.validate(requestFrom(`{"schemaVersion":"1.0.0",${members}}`, 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => ['E_QUOTA_OBJECT_MEMBERS', 'E_QUOTA_INPUT_BYTES', 'E_QUOTA_AST_NODES'].includes(entry.code))).toBe(true);
    assertBounded(report.budget);
  });

  it('rejects a huge array on the array-elements quota', () => {
    const harness = tightHarness();
    const elements = Array.from({ length: 5_000 }, () => '1').join(',');
    const report = harness.facade.validate(requestFrom(`{"schemaVersion":"1.0.0","a":[${elements}]}`, 'hand-authored'));
    expect(report.status).toBe('rejected');
    assertBounded(report.budget);
  });

  it('rejects an oversized string on the input-bytes quota without echoing it', () => {
    const harness = createHarness({ quota: { inputBytes: 64 } });
    const huge = 'x'.repeat(50_000);
    const report = harness.facade.validate(requestFrom(`{"schemaVersion":"1.0.0","s":"${huge}"}`, 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_QUOTA_INPUT_BYTES')).toBe(true);
    for (const diagnostic of report.diagnostics) {
      expect((diagnostic.reason ?? '').length).toBeLessThan(2_000);
      expect(diagnostic.reason?.includes(huge) ?? false).toBe(false);
    }
  });

  it('rejects duplicate members even inside a large object', () => {
    const harness = tightHarness();
    const report = harness.facade.validate(requestFrom('{"schemaVersion":"1.0.0","dup":1,"other":2,"dup":3}', 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_DUPLICATE_MEMBER')).toBe(true);
  });

  it('caps diagnostic flooding with a single terminal diagnostic', () => {
    const harness = createHarness({
      quota: { diagnostics: 4 },
      validator: {
        errors: Array.from({ length: 200 }, (_v, index) => ({ definitionId: `d:${String(index)}`, jsonPath: `/f${String(index)}`, condition: 'unknown-field' as const })),
      },
    });
    const report = harness.facade.validate(requestFrom('{"schemaVersion":"1.0.0"}', 'hand-authored'));
    expect(report.diagnostics.filter((entry) => entry.code === 'E_QUOTA_DIAGNOSTICS')).toHaveLength(1);
    expect(report.diagnostics.length).toBeLessThanOrEqual(6);
  });

  it('never throws a stack overflow or unhandled exception on any bomb', () => {
    const harness = tightHarness();
    const bombs = [
      `{"schemaVersion":"1.0.0","d":${'{"n":'.repeat(8_000)}1${'}'.repeat(8_000)}}`,
      `{"schemaVersion":"1.0.0","a":${'['.repeat(8_000)}${']'.repeat(8_000)}}`,
      `{"schemaVersion":"1.0.0","s":"${'\\n'.repeat(20_000)}"}`,
    ];
    for (const bomb of bombs) {
      expect(() => harness.facade.validate(requestFrom(bomb, 'hand-authored'))).not.toThrow();
    }
  });
});

/** 有界的可观察证据：每类配额的用量都不超过其上限。 */
function assertBounded(budget: Readonly<Record<string, { used: number; limit: number }>>): void {
  for (const kind of QUOTA_KINDS) {
    const usage = budget[kind];
    if (usage !== undefined) {
      expect(usage.used).toBeLessThanOrEqual(usage.limit);
    }
  }
}
