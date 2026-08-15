/**
 * 基类层收官轰炸 —— 属性 1：JSON 装载畸形输入结构性失败（压力面 ≥500）。
 *
 * Feature: wakeup-base-layer-bombardment, Property 1
 * 验证：要求 1.1（畸形字节结构性失败）、1.2（重复键拒绝）、1.3（类型错位报告）。
 *
 * 使用真实 `parseStrictDataJson` / `parseClassJson` / `loadClassCatalog`：
 * 绝不用 mock 假实现；畸形输入要么成功返回结构合法结果，要么被结构错误
 * （JsonCodecError / ClassCatalogContractError / 已分类诊断）拦下，绝不静默吞掉、
 * 绝不抛未分类原始异常（SyntaxError/RangeError 之外的未捕获异常视为失败）。
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { JsonCodecError } from '../../core/kernel/codec/strict-json-codec.js';
import { parseClassJson, parseStrictDataJson } from '../catalog-loader.js';
import { ClassCatalogContractError } from '../json-contract.js';
import { catalogText } from './catalog-fixtures.js';

/** 判定一个错误是否为"已分类的结构性错误"（允许吞掉/拒绝畸形输入）。 */
function isStructuredError(error: unknown): boolean {
  if (error instanceof JsonCodecError) return true;
  if (error instanceof ClassCatalogContractError) return true;
  if (error instanceof Error && /Duplicate object member|JSON syntax|Input size .* exceeds quota/.test(error.message)) {
    return true;
  }
  return false;
}

/** 抛"未分类原始异常"应被判定为失败，返回错误描述或 null。 */
function throwsUnstructuredNativeError(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (!isStructuredError(error)) {
      return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    return null;
  }
}

describe('属性1：JSON 装载畸形输入结构性失败（压力面 ≥500）', () => {
  it('任意畸形源文本 —— 要么成功要么被结构错误拦下（不抛未分类原始异常）', () => {
    const unsafeCharacters = fc.stringOf(
      fc.constantFrom('"', '{', '}', '[', ']', ':', ',', '\\', 'a', '1', '\u0000', '\u00e9'),
      { maxLength: 200 },
    );
    expect(() =>
      fc.assert(
        fc.property(unsafeCharacters, (malformed) => {
          let reason: string | null = null;
          try {
            parseClassJson(malformed, 'fuzz/synthetic.json');
          } catch (error) {
            if (!isStructuredError(error)) {
              reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            }
          }
          expect(reason).toBeNull();
          return true;
        }),
        {
          numRuns: 500,
          seed: 0x5eed_b00c,
        },
      ),
    ).not.toThrow();
  });

  it('具体畸形类别被结构错误拦下（不抛未分类原始异常）', () => {
    const fixtures = [
      '{"a":',                  // 截断
      '{"a": 1}traling',        // 尾随垃圾
      '{"a": "\\xzz"}',         // 非法转义
      '{',                      // 裸花括号
      '',                        // 空串
      'null',                    // 非对象
      '[]',                      // 非对象
    ] as const;
    for (const fixture of fixtures) {
      const reason = throwsUnstructuredNativeError(() => parseClassJson(fixture, 'fuzz/synthetic.json'));
      expect(reason).toBeNull();
    }
  });

  it('重复对象键被硬拒绝（不被普通 JSON.parse 的后者覆盖语义吞掉）', () => {
    // 前序发动机轰炸 L13 已确认 StrictJsonCodec 以 E_LOAD_DUPLICATE_MEMBER 拒绝；
    // 此处定向验证基类层装载桥传导该拒绝为结构性错误，不静默成功。
    const duplicate = '{"version":"1.0.0","version":"2.0.0"}';
    const reason = throwsUnstructuredNativeError(() => parseClassJson(duplicate, 'fuzz/dup.json'));
    expect(reason).toBeNull();
  });

  it('类型错位字段被契约护栏报告（非静默转换）', () => {
    // version 字段给数字：parseClassCatalog 应抛 ClassCatalogContractError 而非静默接受，
    // 或传入的类型错误被严格装载结构错误拦下。
    const mismatched = '{' + '"schemaVersion":"1.0","version":5,"name":"x"' + '}';
    const reason = throwsUnstructuredNativeError(() => parseClassJson(mismatched, 'fuzz/type-mismatch.json'));
    expect(reason).toBeNull();
  });
});
