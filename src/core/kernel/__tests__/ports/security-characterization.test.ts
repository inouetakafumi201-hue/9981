/**
 * 安全模块端口 characterization tests
 *
 * 版本：1.0.0（2026-08-12）
 *
 * 目标：验证哈希和配额的功能性。
 *
 * 测试点：
 * - ✅ SHA-256 确定性
 * - ✅ FNV-1a 快速指纹
 * - ✅ 配额验证与消耗追踪
 */

import { describe, it, expect } from 'vitest';
import {
  hashBytes,
  hashUtf8,
  hashObject,
  fnv1aHash,
  fnv1aString,
  DEFAULT_TECHNICAL_QUOTAS,
  TechnicalQuotaError,
  validateTechnicalQuotas,
  isQuotaSubsetOf,
  mergeQuotasConservative,
  createQuotaConsumption,
  isQuotaExhausted,
} from '../../security/index.js';

describe('Security Port: Hash Functions', () => {
  describe('SHA-256 hash', () => {
    it('produces consistent hashes', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const hash1 = hashBytes(bytes);
      const hash2 = hashBytes(bytes);
      expect(hash1).toBe(hash2);
    });

    it('produces 64-char hex strings', () => {
      const hash = hashBytes(new Uint8Array([1]));
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('differs for different inputs', () => {
      const hash1 = hashBytes(new Uint8Array([1]));
      const hash2 = hashBytes(new Uint8Array([2]));
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('UTF-8 hash', () => {
    it('hashes strings consistently', () => {
      const hash1 = hashUtf8('hello');
      const hash2 = hashUtf8('hello');
      expect(hash1).toBe(hash2);
    });

    it('produces 64-char hex strings', () => {
      const hash = hashUtf8('test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('handles unicode', () => {
      const hash1 = hashUtf8('你好');
      const hash2 = hashUtf8('你好');
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Object hash', () => {
    it('produces canonical JSON hashes', () => {
      const obj1 = { b: 2, a: 1 };
      const obj2 = { a: 1, b: 2 };
      // 虽然顺序不同，但规范化后应相同
      expect(hashObject(obj1)).toBe(hashObject(obj2));
    });

    it('differs for different values', () => {
      const obj1 = { x: 1 };
      const obj2 = { x: 2 };
      expect(hashObject(obj1)).not.toBe(hashObject(obj2));
    });
  });

  describe('FNV-1a hash', () => {
    it('produces number hashes', () => {
      const hash = fnv1aHash(new Uint8Array([1, 2, 3]));
      expect(typeof hash).toBe('number');
    });

    it('is consistent', () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const hash1 = fnv1aHash(bytes);
      const hash2 = fnv1aHash(bytes);
      expect(hash1).toBe(hash2);
    });

    it('differs for different inputs', () => {
      const hash1 = fnv1aHash(new Uint8Array([1]));
      const hash2 = fnv1aHash(new Uint8Array([2]));
      expect(hash1).not.toBe(hash2);
    });

    it('string version works', () => {
      const hash1 = fnv1aString('hello');
      const hash2 = fnv1aString('hello');
      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('number');
    });
  });
});

describe('Security Port: Quotas', () => {
  describe('Quota validation', () => {
    it('accepts valid quotas', () => {
      expect(() => validateTechnicalQuotas(DEFAULT_TECHNICAL_QUOTAS)).not.toThrow();
    });

    it('rejects non-integer quotas', () => {
      const invalid = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: 1.5 };
      expect(() => validateTechnicalQuotas(invalid)).toThrow(TechnicalQuotaError);
    });

    it('rejects zero quotas', () => {
      const invalid = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: 0 };
      expect(() => validateTechnicalQuotas(invalid)).toThrow(TechnicalQuotaError);
    });

    it('rejects negative quotas', () => {
      const invalid = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: -1 };
      expect(() => validateTechnicalQuotas(invalid)).toThrow(TechnicalQuotaError);
    });

    it('rejects non-finite quotas', () => {
      const invalid = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: Infinity };
      expect(() => validateTechnicalQuotas(invalid)).toThrow(TechnicalQuotaError);
    });
  });

  describe('Quota relationships', () => {
    it('checks subset relationship', () => {
      const parent = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: 1000 };
      const child = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: 500 };
      expect(isQuotaSubsetOf(child, parent)).toBe(true);
      expect(isQuotaSubsetOf(parent, child)).toBe(false);
    });

    it('merges conservatively', () => {
      const quota1 = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: 1000, nestingDepth: 100 };
      const quota2 = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: 500, nestingDepth: 200 };
      const merged = mergeQuotasConservative(quota1, quota2);
      expect(merged.inputBytes).toBe(500);
      expect(merged.nestingDepth).toBe(100);
    });
  });

  describe('Quota consumption tracking', () => {
    it('creates zero consumption', () => {
      const consumption = createQuotaConsumption();
      expect(consumption.inputBytes).toBe(0);
      expect(consumption.astNodes).toBe(0);
      expect(consumption.diagnostics).toBe(0);
    });

    it('detects exhaustion', () => {
      const quotas = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: 100, astNodes: 10 };
      const consumption = createQuotaConsumption();
      consumption.inputBytes = 50;
      expect(isQuotaExhausted(consumption, quotas)).toBe(false);

      consumption.inputBytes = 100;
      expect(isQuotaExhausted(consumption, quotas)).toBe(true);
    });

    it('detects any dimension exhaustion', () => {
      const quotas = { ...DEFAULT_TECHNICAL_QUOTAS, inputBytes: 100, diagnostics: 10 };
      const consumption = createQuotaConsumption();
      consumption.diagnostics = 11;
      expect(isQuotaExhausted(consumption, quotas)).toBe(true);
    });
  });
});
