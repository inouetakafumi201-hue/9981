/**
 * 诊断工厂实现
 *
 * 版本：1.0.0（2026-08-11）
 * 迁出源：spec-compiler/diagnostic-factory.ts
 *
 * 职责：从编译阶段数据构造规范化诊断。
 * 设计约束：
 * - ✅ 源位置验证（source mapping 检查）
 * - ✅ 相关源去重（collapse duplicates）
 * - ✅ 决定论排序（locale-independent sort）
 * - ✅ 消息 i18n 集成（renderGuidance + renderCreatorMessage）
 */

import type { ErrCode } from './error-codes.js';
import { isInfrastructureFatalCode } from './error-codes.js';
import type {
  CompilationStage,
  Diagnostic,
  DiagnosticArgument,
  SourceRecord,
} from './diagnostic.js';
import { validateSourceRecord } from './source-record.js';
import type { FatalErrorBoundary } from '../safety/fatal-boundary.js';
import { compareCodePoints } from '../codec/index.js';
import { renderCreatorMessage, renderGuidance } from './message-bundles.js';
import type { CreatorMessageBundle } from './message-bundles.js';

/**
 * 诊断构造输入
 *
 * 完整的信息集合，由编译阶段各处提供。
 */
export interface DiagnosticBuildInput {
  readonly code: ErrCode;
  readonly stage: CompilationStage;
  readonly phase: number;
  readonly technicalMessage: string;
  readonly source: SourceRecord;
  readonly sourceText: string;
  readonly path?: string;
  readonly definitionId?: string;
  readonly relatedSources?: readonly SourceRecord[];
  readonly expected?: Diagnostic['expected'];
  readonly actual?: Diagnostic['actual'];
  readonly messageArgs?: Readonly<Record<string, DiagnosticArgument>>;
  readonly blockingCode?: ErrCode;
  readonly warning?: boolean;
  readonly informational?: boolean;
  readonly compilationId: string;
  readonly baselineId: string;
  readonly suggestion?: string;
}

/**
 * 诊断工厂（唯一权威构造点）
 *
 * 所有创作者诊断必须通过本工厂，确保：
 * - 源位置验证一致
 * - 相关源去重一致
 * - 排序决定论性
 */
export class DiagnosticFactory {
  constructor(
    private readonly fatalBoundary: FatalErrorBoundary,
    private readonly bundle: CreatorMessageBundle,
  ) {}

  build(input: DiagnosticBuildInput): Diagnostic {
    return this.fatalBoundary.run('canonicalization', 'DIAGNOSTIC_BUILD_FAILED', () => {
      // 验证主源 record
      const sourceIssues = validateSourceRecord(input.source, input.sourceText);
      if (sourceIssues.length > 0) {
        return this.fatalBoundary.halt(input.stage, 'SOURCE_MAPPING_FAILED');
      }

      // 验证相关源 records
      for (const related of input.relatedSources ?? []) {
        if (!related.sourceId || !related.documentUri || !related.sourcePackage) {
          return this.fatalBoundary.halt(input.stage, 'SOURCE_MAPPING_FAILED');
        }
      }

      // 去重相关源（同一 document 同一 span 只保留一次）
      const relatedSources = dedupeSources(input.relatedSources ?? []);

      // 决定诊断严重程度
      const infrastructure = isInfrastructureFatalCode(input.code);
      const informational = input.informational === true && !infrastructure;
      const warning = input.warning === true && !informational;

      // 参数总是对象（宿主渲染不需要 guard）
      const messageArgs: Readonly<Record<string, DiagnosticArgument>> = input.messageArgs ?? {};

      // 指导信息：优先用明确建议，否则从 bundle 渲染
      const hint = input.suggestion ?? renderGuidance(this.bundle, input.code, messageArgs);
      if (!hint) return this.fatalBoundary.halt(input.stage, 'DIAGNOSTIC_BUILD_FAILED');

      return Object.freeze({
        code: input.code,
        severity: infrastructure ? 'fatal' : informational ? 'info' : warning ? 'warn' : 'error',
        haltClass: infrastructure ? 'infrastructure' : (warning || informational) ? undefined : 'candidate',
        message: input.technicalMessage,
        messageKey: input.code,
        messageArgs,
        creatorMessage: renderCreatorMessage(this.bundle, input.code, messageArgs),
        hint,
        actionableHint: hint,
        phase: input.phase,
        stage: input.stage,
        scope: input.definitionId ? 'definition' : 'document',
        sourcePackage: input.source.sourcePackage,
        sourceSpan: input.source.span,
        source: input.source,
        relatedSources,
        path: input.path,
        at: input.definitionId ? { def: input.definitionId } : undefined,
        expected: input.expected,
        actual: input.actual,
        blockingCode: input.blockingCode,
        compilationId: input.compilationId,
        baselineId: input.baselineId,
        reason: input.technicalMessage,
        correctionSuggestion: hint,
      } satisfies Diagnostic);
    });
  }
}

/**
 * 去重相关源
 *
 * 同一 document 同一 span 只保留第一个，防止创作者界面噪音。
 */
function dedupeSources(sources: readonly SourceRecord[]): readonly SourceRecord[] {
  const seen = new Set<string>();
  const unique: SourceRecord[] = [];
  for (const source of sources) {
    const key = `${source.sourceId}:${source.span.start.offset}:${source.span.end.offset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  return Object.freeze(unique);
}

/**
 * 决定论诊断排序（与 locale 无关）
 *
 * 闭包检查断言诊断已按此顺序排序，所以必须无 locale 依赖。
 */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const packageOrder = compareCodePoints(left.sourcePackage ?? '', right.sourcePackage ?? '');
    if (packageOrder !== 0) return packageOrder;
    const leftOffset = left.source?.span.start.offset ?? left.sourceSpan?.start.offset ?? -1;
    const rightOffset = right.source?.span.start.offset ?? right.sourceSpan?.start.offset ?? -1;
    if (leftOffset !== rightOffset) return leftOffset - rightOffset;
    const defOrder = compareCodePoints(String(left.at?.def ?? ''), String(right.at?.def ?? ''));
    if (defOrder !== 0) return defOrder;
    const pathOrder = compareCodePoints(left.path ?? '', right.path ?? '');
    if (pathOrder !== 0) return pathOrder;
    return compareCodePoints(left.code, right.code);
  });
}
