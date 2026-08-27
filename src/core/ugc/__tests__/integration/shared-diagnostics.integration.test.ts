/**
 * 任务 11.2：与真实共享诊断基础设施集成。
 *
 * 这里验证 UGC 使用的是**真实**的 `ERR_CODES` / `HINT_TEMPLATES` / `DiagnosticSink`，而不是平行副本：
 * - 每个 UGC 启用的诊断代码都在封闭 `ERR_CODES` 里且有 hint（`checkHintCompleteness`）；
 * - `DiagnosticSink` 的去重不会折叠不同 definition/path 的 UGC 错误（否则多位置同类错误会丢失）；
 * - fatal `E_INV_*` 不可被候选或警告改写。
 */
import { describe, expect, it } from 'vitest';
import { ERR_CODES, isFatalCode } from '../../../kernel/state/error-codes';
import { HINT_TEMPLATES, checkHintCompleteness, DiagnosticSink } from '../../../kernel/safety/safety';
import { CODE_MAP, UGC_DIAGNOSTIC_CATEGORIES } from '../../diagnostics/code-map';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway';
import { createHarness } from '../harness';
import { requestFrom, validCandidateText } from '../../testing/generators';

describe('Feature: wakeup-ugc, Task 11.2: shared diagnostic contracts', () => {
  it('every code UGC maps to exists in the closed ERR_CODES enum with a hint', () => {
    const registered = new Set(
      Object.entries(ERR_CODES).flatMap(([prefix, suffixes]) => suffixes.map((suffix) => `${prefix}_${suffix}`)),
    );
    for (const category of UGC_DIAGNOSTIC_CATEGORIES) {
      for (const code of Object.values(CODE_MAP[category])) {
        expect(registered.has(code), `${code} must be a registered ErrCode`).toBe(true);
        expect(HINT_TEMPLATES[code], `${code} must have a hint`).toBeTruthy();
      }
    }
  });

  it('the whole shared enum still has complete hint coverage after task 1.3 additions', () => {
    // 任务 1.3 向共享枚举加了 E_QUOTA_MIGRATION_STEPS；这里确认没有破坏既有的 hint 完备性契约。
    expect(checkHintCompleteness(ERR_CODES)).toEqual([]);
  });

  it('the code catalog resolves only through the shared enum, never a free-form code', () => {
    const catalog = createDiagnosticCodeCatalog(sha256FingerprintGateway);
    expect(catalog.incompleteEntries()).toEqual([]);
    // 未映射条件返回 null，而不是编造一个代码。
    expect(catalog.resolve('JSON_SYNTAX', 'not-real')).toBeNull();
  });

  it('the DiagnosticSink does not collapse UGC errors that differ only by definition or path', () => {
    const harness = createHarness({
      validator: {
        errors: [
          { definitionId: 'weapon:a', jsonPath: '/x', condition: 'unknown-field' },
          { definitionId: 'weapon:a', jsonPath: '/y', condition: 'unknown-field' },
          { definitionId: 'weapon:b', jsonPath: '/x', condition: 'unknown-field' },
        ],
      },
    });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));

    // 把 UGC 诊断喂给真实 DiagnosticSink（开启去重），确认三条都保留。
    const sink = new DiagnosticSink({ dedup: true, maxCapacity: 100 });
    for (const diagnostic of report.diagnostics) sink.emit(diagnostic);
    const unknownFieldKept = sink.getAll().filter((entry) => entry.code === 'E_LOAD_UNKNOWN_FIELD');
    expect(unknownFieldKept).toHaveLength(3);
  });

  it('treats E_INV_* as fatal and UGC never emits one as a warning', () => {
    expect(isFatalCode('E_INV_DANGLING')).toBe(true);
    const catalog = createDiagnosticCodeCatalog(sha256FingerprintGateway);
    // UGC 的表现回退是唯一的 warn 通道，且它映射到 E_LOAD_PRESENTATION_FALLBACK，不是任何 E_INV_*。
    expect(catalog.severity('E_LOAD_PRESENTATION_FALLBACK')).toBe('warn');
    for (const category of UGC_DIAGNOSTIC_CATEGORIES) {
      for (const code of Object.values(CODE_MAP[category])) {
        expect(code.startsWith('E_INV_')).toBe(false);
      }
    }
  });
});
