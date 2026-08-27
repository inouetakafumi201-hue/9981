/**
 * PT-02：诊断投影穷举性与 scope/severity 契约测试。
 */
import { describe, expect, it } from 'vitest';
import { ALL_DIAGNOSTIC_CODES, DIAGNOSTIC_CODES } from '../../../model/diagnostic-codes';
import { errorDiagnostic, warningDiagnostic } from '../../../model/diagnostic-factory';
import { L2_DIAGNOSTIC_SELECTORS, projectL2Diagnostic } from '../diagnostic-projection';
import type { DiagnosticProjectionContext } from '../diagnostic-projection';
import { createSourceIndex } from '../source-index';
import { catalog, factory } from './fixtures';

function context(): DiagnosticProjectionContext {
  return {
    factory,
    catalog,
    stage: 'definition-validation',
    sourcePackage: 'pkg-port',
    index: createSourceIndex('doc-1', '{\n  "packageId": "p"\n}\n'),
    definitionAnchors: new Map([['def-a', '/definitions/0']]),
  };
}

describe('PT-02: 诊断投影穷举性', () => {
  it('每个 l2 诊断代码都能解析到 UGC 选择器与已登记错误码', () => {
    for (const code of ALL_DIAGNOSTIC_CODES) {
      const selector = (L2_DIAGNOSTIC_SELECTORS as Record<string, { category: string; condition: string }>)[code];
      expect(selector, `代码 ${code} 缺少选择器映射`).toBeDefined();
      const resolved = catalog.resolve(selector!.category as never, selector!.condition);
      expect(resolved, `代码 ${code} 的选择器解析不到 ErrCode`).not.toBeNull();
    }
  });

  it('全部 l2 代码按其自然严重级投影都恰好产生一条诊断（不走未映射、不走升级）', () => {
    const ctx = context();
    // 唯一映射到 warn 级 ErrCode 的 l2 代码：表现回退。它在 l2 中本就以 Warning 发出。
    const naturallyWarn = new Set<string>([DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED]);
    for (const code of ALL_DIAGNOSTIC_CODES) {
      const make = naturallyWarn.has(code) ? warningDiagnostic : errorDiagnostic;
      const diagnostic = make({
        code,
        reason: 'r',
        correctionSuggestion: 'c',
        definitionId: 'def-a',
        jsonPath: '/definitions/0/x',
        sourcePackage: 'pkg-port',
      });
      const projected = projectL2Diagnostic(ctx, diagnostic);
      // 自然严重级下：既不应未映射失败关闭，也不应触发严重级升级——恰好一条。
      expect(projected.length, `代码 ${code} 应恰好投影为一条诊断`).toBe(1);
    }
  });
});

describe('PT-02: 投影 scope 与 severity 契约', () => {
  it('带 definitionId 的诊断投影为 definition scope', () => {
    const ctx = context();
    const projected = projectL2Diagnostic(
      ctx,
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.DEF_DUPLICATE_IDENTIFIER,
        reason: 'r',
        correctionSuggestion: 'c',
        definitionId: 'def-a',
        jsonPath: '/definitions/0/id',
        sourcePackage: 'pkg-port',
      }),
    );
    expect(projected[0]?.scope).toBe('definition');
    expect(projected[0]?.at).toEqual({ def: 'def-a' });
  });

  it('无 definitionId 且根路径的诊断投影为 document scope（at/path 显式 null）', () => {
    const ctx = context();
    const projected = projectL2Diagnostic(
      ctx,
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_PARSE_ERROR,
        reason: 'r',
        correctionSuggestion: 'c',
        sourcePackage: 'pkg-port',
      }),
    );
    expect(projected[0]?.scope).toBe('document');
    expect(projected[0]?.at).toBeNull();
    expect(projected[0]?.path).toBeNull();
  });

  it('l2 Error 映射到 warn 级 ErrCode 时追加一条升级错误', () => {
    const ctx = context();
    // PRESENTATION_FALLBACK_APPLIED 映射到 E_LOAD_PRESENTATION_FALLBACK（warn）。
    // 若人为把它标为 Error，投影必须追加升级诊断。
    const projected = projectL2Diagnostic(
      ctx,
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
        reason: 'r',
        correctionSuggestion: 'c',
        definitionId: 'def-a',
        jsonPath: '/definitions/0/presentation',
        sourcePackage: 'pkg-port',
      }),
    );
    expect(projected.length).toBe(2);
    expect(projected.some((d) => d.severity === 'error' && d.messageKey?.includes('gateway-invalid-result'))).toBe(true);
  });

  it('l2 Warning（表现回退）投影为单条 warn，不追加升级', () => {
    const ctx = context();
    const projected = projectL2Diagnostic(
      ctx,
      warningDiagnostic({
        code: DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
        reason: 'r',
        correctionSuggestion: 'c',
        definitionId: 'def-a',
        jsonPath: '/definitions/0/presentation',
        sourcePackage: 'pkg-port',
      }),
    );
    expect(projected.length).toBe(1);
    expect(projected[0]?.severity).toBe('warn');
  });
});

describe('PT-02: 来源定位索引 UTF-8 offset', () => {
  it('多字节字符前缀按 UTF-8 字节计 offset', () => {
    // 第 2 行 "中文x"，列 3（x 前）：前缀 "中文" = 6 字节；本行起始偏移 = 第 1 行 "{" + "\n" = 2。
    const index = createSourceIndex('doc', '{\n中文x\n}');
    const point = index.point(2, 3);
    expect(point.line).toBe(2);
    expect(point.column).toBe(3);
    expect(point.offset).toBe(2 + 6);
  });
});
