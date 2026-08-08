/**
 * L2 单元测试：JSON Codec 的固定边界（Requirements 11.1–11.4、11.10）。
 */

import { describe, it, expect } from 'vitest';
import { parsePackage } from '../../../src/l2/codec/json-codec.js';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';

const loc = { sourceFile: 'x', section: 's' };

describe('JSON Codec 固定边界', () => {
  it('语法错误返回带行列的解析拒绝', () => {
    const result = parsePackage('{ bad json', { sourceLocation: loc });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      const parse = result.diagnostics.find((d) => d.code === DIAGNOSTIC_CODES.JSON_PARSE_ERROR);
      expect(parse).toBeDefined();
      expect(parse!.sourceLocation?.line).toBeGreaterThanOrEqual(1);
    }
  });

  it('缺 schemaVersion 被拒绝', () => {
    const result = parsePackage('{"packageId":"p","definitions":[]}', { sourceLocation: loc });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_MISSING)).toBe(true);
    }
  });

  it('重复成员被识别为语义损坏，不静默丢弃', () => {
    const json = '{"packageId":"p","packageId":"q","schemaVersion":"l2-declarative/1","definitions":[]}';
    const result = parsePackage(json, { sourceLocation: loc });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED)).toBe(true);
    }
  });

  it('禁止构造（$eval 键）被定位拒绝', () => {
    const json = '{"packageId":"p","schemaVersion":"l2-declarative/1","definitions":[],"$eval":"x"}';
    const result = parsePackage(json, { sourceLocation: loc });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      const hit = result.diagnostics.find((d) => d.code === DIAGNOSTIC_CODES.JSON_PROHIBITED_CONSTRUCT);
      expect(hit).toBeDefined();
      expect(hit!.jsonPath).toContain('$eval');
    }
  });

  it('NaN / 尾随逗号 / 单引号 被拒绝', () => {
    for (const bad of ['{"a":NaN}', '{"a":1,}', "{'a':1}"]) {
      const result = parsePackage(bad, { sourceLocation: loc });
      expect(result.rejected).toBe(true);
    }
  });
});
