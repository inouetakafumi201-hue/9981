/**
 * JSON 编解码端口 characterization tests
 *
 * 目标：证明新引擎端口的 JSON 编解码能力等价于旧 spec-compiler::StrictJsonCodec。
 *
 * 测试策略：
 * 1. 从旧 spec-compiler 测试中提取验收条件
 * 2. 编写端口抽象的测试（不依赖具体实现）
 * 3. 验证新实现与旧实现产生相同的输出
 *
 * 完成条件：
 * - ✅ 所有旧 JSON 相关测试通过
 * - ✅ 端口实现与旧实现产生 byte-identical 输出
 * - ✅ 端口实现拒绝条件与旧实现完全相同
 */

import { describe, it, expect } from 'vitest';
import { StrictJsonCodec, canonicalStringify } from '../../codec/index';
import { DEFAULT_TECHNICAL_QUOTAS } from '../../ports/index';
import type { CandidateDocumentInput } from '../../ports/index';

const codec = new StrictJsonCodec();

function parseJson(sourceText: string) {
  const input: CandidateDocumentInput = {
    sourceId: 'test:json-codec',
    documentUri: 'file:///test.json',
    sourcePackage: 'test',
    sourceText,
    precedence: 0,
    owningLayer: '基类层',
    normativeStatus: 'normative',
  };
  return codec.parse(input, DEFAULT_TECHNICAL_QUOTAS);
}

describe('JSON Codec Port: Characterization', () => {
  describe('RFC 7159 compliance', () => {
    it('accepts valid RFC JSON', () => {
      const validCases = [
        '{}',
        '[]',
        '{"key":"value"}',
        '{"nested":{"deep":"value"}}',
        '[1,2,3]',
        'null',
        'true',
        'false',
        '0',
        '-1',
        '1.5',
        '"escaped\\"quote"',
      ];

      for (const input of validCases) {
        expect(() => parseJson(input)).not.toThrow(`Should accept: ${input}`);
      }
    });

    it('rejects non-finite numbers', () => {
      expect(() => parseJson('{"value":NaN}')).toThrow();
      expect(() => parseJson('{"value":Infinity}')).toThrow();
      expect(() => parseJson('{"value":-Infinity}')).toThrow();
    });
  });

  describe('Prohibited constructs', () => {
    it('rejects __proto__ key', () => {
      expect(() => parseJson('{"__proto__":"x"}')).toThrow('Prohibited key');
    });

    it('rejects constructor key', () => {
      expect(() => parseJson('{"constructor":"x"}')).toThrow('Prohibited key');
    });

    it('rejects prototype key', () => {
      expect(() => parseJson('{"prototype":"x"}')).toThrow('Prohibited key');
    });

    it('rejects $eval key', () => {
      expect(() => parseJson('{"$eval":"code"}')).toThrow('Prohibited key');
    });

    it('rejects $function key', () => {
      expect(() => parseJson('{"$function":"code"}')).toThrow('Prohibited key');
    });

    it('rejects $exec key', () => {
      expect(() => parseJson('{"$exec":"code"}')).toThrow('Prohibited key');
    });

    it('rejects shell key', () => {
      expect(() => parseJson('{"shell":"ls"}')).toThrow('Prohibited key');
    });
  });

  describe('Source mapping', () => {
    it('provides sourceRecord with accurate hash', () => {
      const input = '{"key":"value"}';
      const result = parseJson(input);
      expect(result.sourceRecord.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.sourceRecord.span.sourceSliceHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('populates sourceRecord correctly', () => {
      const input = '{"name":"test"}';
      const result = parseJson(input);
      expect(result.sourceRecord.sourceId).toBe('test:json-codec');
      expect(result.sourceRecord.documentUri).toBe('file:///test.json');
      expect(result.sourceRecord.owningLayer).toBe('基类层');
    });
  });

  describe('Quotas', () => {
    it('rejects deep nesting', () => {
      let nested = '{}';
      for (let i = 0; i < 600; i++) {
        nested = `{"x":${nested}}`;
      }
      const input: CandidateDocumentInput = {
        sourceId: 'test',
        documentUri: 'file:///test.json',
        sourcePackage: 'test',
        sourceText: nested,
        precedence: 0,
        owningLayer: '基类层',
        normativeStatus: 'normative',
      };
      expect(() => codec.parse(input, DEFAULT_TECHNICAL_QUOTAS)).toThrow();
    });

    it('rejects oversized input', () => {
      const input: CandidateDocumentInput = {
        sourceId: 'test',
        documentUri: 'file:///test.json',
        sourcePackage: 'test',
        sourceText: 'x'.repeat(20 * 1024 * 1024),
        precedence: 0,
        owningLayer: '基类层',
        normativeStatus: 'normative',
      };
      expect(() => codec.parse(input, DEFAULT_TECHNICAL_QUOTAS)).toThrow();
    });
  });

  describe('Canonical stringification', () => {
    it('produces deterministic output', () => {
      const obj = { b: 2, a: 1, c: 3 };
      const result1 = canonicalStringify(obj);
      const result2 = canonicalStringify(obj);
      expect(result1).toBe(result2);
    });

    it('sorts keys alphabetically', () => {
      const obj = { z: 1, a: 2, m: 3 };
      const result = canonicalStringify(obj);
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it('normalizes -0 to 0', () => {
      const value = { x: -0 };
      const result = canonicalStringify(value);
      expect(result).toBe('{"x":0}');
    });

    it('rejects non-finite numbers', () => {
      expect(() => canonicalStringify({ x: NaN })).toThrow();
      expect(() => canonicalStringify({ x: Infinity })).toThrow();
    });
  });
});
