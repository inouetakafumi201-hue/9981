/**
 * L2 回归测试：Canonical JSON、诊断集合与 Canonical_Snapshot 的确定性表示。
 *
 * 对应 Requirements 11.5–11.7、12.12、13.1–13.5、15.7、16.9–16.13 与集成门禁 5。
 *
 * 这些断言把"已批准的确定性输出"固化为内联期望值。任何非语义漂移都会使断言失败；
 * 更新期望值必须经过显式审查，不得通过放宽断言或盲目更新掩盖语义变化。
 */

import { describe, it, expect } from 'vitest';
import { canonicalizeValue } from '../../../src/l2/codec/json-canonicalizer.js';
import { activate, emptyRegistry } from '../../../src/l2/registry/definition-registry.js';
import { singleDefinitionPackage } from '../../../src/l2/testing/builders.js';
import { validActionDefinition } from '../../../src/l2/testing/definition-generators.js';

describe('Canonical JSON 回归', () => {
  it('键序与嵌套规范化输出字节稳定', () => {
    const value = { b: 1, a: { d: [3, 2, 1], c: true }, e: null };
    const canonical = canonicalizeValue(value);
    // 已批准的规范化字节输出（键按字典序，缩进两空格）。
    expect(canonical).toBe(
      [
        '{',
        '  "a": {',
        '    "c": true,',
        '    "d": [',
        '      3,',
        '      2,',
        '      1',
        '    ]',
        '  },',
        '  "b": 1,',
        '  "e": null',
        '}',
      ].join('\n'),
    );
  });

  it('-0 归一化为 0', () => {
    expect(canonicalizeValue({ x: -0 })).toBe('{\n  "x": 0\n}');
  });
});

describe('Canonical_Snapshot 回归', () => {
  it('同一输入两次激活快照指纹一致，含解析定义与来源', () => {
    const pkg = singleDefinitionPackage('pkg-reg', validActionDefinition('act-reg'));
    const first = activate(emptyRegistry(), pkg);
    const second = activate(emptyRegistry(), pkg);
    expect(first.rejected).toBe(false);
    expect(second.rejected).toBe(false);
    if (first.rejected || second.rejected) {
      return;
    }
    expect(first.value.snapshot.fingerprint).toBe(second.value.snapshot.fingerprint);
    expect(first.value.snapshot.resolvedDefinitions.map((d) => d.id)).toEqual(['act-reg']);
    // 快照含来源记录（可追踪）。
    expect(first.value.snapshot.sourceRecords.length).toBeGreaterThan(0);
  });

  it('失败激活不产生快照变化（空注册表快照保持空）', () => {
    const registry = emptyRegistry();
    const emptyFingerprint = registry.snapshot.fingerprint;
    const badPkg = singleDefinitionPackage('pkg-bad', {
      ...validActionDefinition('act-bad'),
      defKind: 'not-a-kind' as never,
    });
    const result = activate(registry, badPkg);
    expect(result.rejected).toBe(true);
    expect(registry.snapshot.fingerprint).toBe(emptyFingerprint);
  });
});
