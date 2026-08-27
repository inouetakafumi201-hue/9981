import { describe, expect, it } from 'vitest';

import {
  compareRevision,
  isSameRevision,
  isSuperseded,
  makeRevision,
  revisionSortKey,
  type StateRevision,
} from '../revision';

function revision(sequence: number, fingerprint: string): StateRevision {
  const made = makeRevision(sequence, fingerprint);
  if (!made.ok) throw new Error('fixture revision must be constructible');
  return made.value;
}

describe('State_Revision 复合令牌', () => {
  it('四个比较分支各自可构造并被显式返回', () => {
    expect(compareRevision(revision(2, 'f2'), revision(1, 'f1'))).toBe('newer');
    expect(compareRevision(revision(1, 'f1'), revision(1, 'f1'))).toBe('same');
    expect(compareRevision(revision(1, 'f1'), revision(2, 'f2'))).toBe('older');
    expect(compareRevision(revision(1, 'f1'), revision(1, 'f-other'))).toBe('uncomparable');
  });

  it('sequence 相同而指纹不同时不得退化为 same', () => {
    const left = revision(7, 'fingerprint-a');
    const right = revision(7, 'fingerprint-b');
    expect(compareRevision(left, right)).not.toBe('same');
    expect(isSameRevision(left, right)).toBe(false);
  });

  it('在 sequence 维度上满足自反、反对称与传递', () => {
    const sequences = [0, 1, 2, 5, 17, 1024];
    for (const sequence of sequences) {
      const token = revision(sequence, `f${String(sequence)}`);
      expect(compareRevision(token, token)).toBe('same');
    }
    for (const left of sequences) {
      for (const right of sequences) {
        const a = revision(left, `f${String(left)}`);
        const b = revision(right, `f${String(right)}`);
        const forward = compareRevision(a, b);
        const backward = compareRevision(b, a);
        if (forward === 'newer') expect(backward).toBe('older');
        else if (forward === 'older') expect(backward).toBe('newer');
        else expect(backward).toBe(forward);
      }
    }
    const low = revision(1, 'f1');
    const mid = revision(2, 'f2');
    const high = revision(3, 'f3');
    expect(compareRevision(high, mid)).toBe('newer');
    expect(compareRevision(mid, low)).toBe('newer');
    expect(compareRevision(high, low)).toBe('newer');
  });
});

describe('isSuperseded 与构造校验', () => {
  it('只有更新的令牌才取代缓存令牌', () => {
    const cached = revision(4, 'f4');
    expect(isSuperseded(cached, revision(5, 'f5'))).toBe(true);
    expect(isSuperseded(cached, revision(4, 'f4'))).toBe(false);
    expect(isSuperseded(cached, revision(3, 'f3'))).toBe(false);
    expect(isSuperseded(cached, revision(4, 'f-different'))).toBe(false);
  });

  it('拒绝非整数、负数、非数字的 sequence 与空指纹', () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined]) {
      const result = makeRevision(bad, 'f');
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe('JSON_SEMANTIC_FIELD_DAMAGED');
    }
    for (const bad of ['', 42, null, undefined]) {
      const result = makeRevision(1, bad);
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe('JSON_SEMANTIC_FIELD_MISSING');
    }
  });

  it('已构造的令牌被冻结', () => {
    const token = revision(3, 'f3');
    expect(Object.isFrozen(token)).toBe(true);
  });

  it('排序键按 sequence 排在指纹之前', () => {
    const keys = [revision(10, 'a'), revision(2, 'z'), revision(2, 'b')]
      .map(revisionSortKey)
      .sort();
    expect(keys.map((key) => key.split(':')[1])).toEqual(['b', 'z', 'a']);
  });
});
