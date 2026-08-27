import type { ErrCode } from '../state/error-codes';
import { isInfrastructureFatalCode } from '../state/error-codes';
import type {
  CompilationStage,
  Diagnostic,
  DiagnosticArgument,
  SourceRecord,
} from '../state/diagnostic';
import { validateSourceRecord } from '../state/source-record';
import type { FatalErrorBoundary } from '../safety/fatal-boundary';
import { compareCodePoints } from './json-codec';
import { ZH_CN_CREATOR_BUNDLE, renderCreatorMessage, renderGuidance } from './messages';
import type { CreatorMessageBundle } from './messages';

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
  /** Non-blocking notice that something the creator wrote has no effect. Never halts, never blocks. */
  readonly informational?: boolean;
  readonly compilationId: string;
  readonly baselineId: string;
  readonly suggestion?: string;
}

export class DiagnosticFactory {
  constructor(
    private readonly fatalBoundary: FatalErrorBoundary,
    private readonly bundle: CreatorMessageBundle = ZH_CN_CREATOR_BUNDLE,
  ) {}

  build(input: DiagnosticBuildInput): Diagnostic {
    return this.fatalBoundary.run('canonicalization', 'DIAGNOSTIC_BUILD_FAILED', () => {
      const sourceIssues = validateSourceRecord(input.source, input.sourceText);
      if (sourceIssues.length > 0) {
        return this.fatalBoundary.halt(input.stage, 'SOURCE_MAPPING_FAILED');
      }
      for (const related of input.relatedSources ?? []) {
        if (!related.sourceId || !related.documentUri || !related.sourcePackage) {
          return this.fatalBoundary.halt(input.stage, 'SOURCE_MAPPING_FAILED');
        }
      }
      // Two related definitions can legitimately resolve to the same span, for example when a cycle is
      // reported from a document that was activated twice at the same offsets. Listing one location twice
      // is noise for the creator and a closure violation for the pipeline, so collapse it here rather
      // than requiring every call site to remember.
      const relatedSources = dedupeSources(input.relatedSources ?? []);

      const infrastructure = isInfrastructureFatalCode(input.code);
      const informational = input.informational === true && !infrastructure;
      const warning = input.warning === true && !informational;
      // Always an object: hosts rendering a localised bundle must never have to guard for undefined,
      // and the i18n contract test can assert argument shape uniformly.
      const messageArgs: Readonly<Record<string, DiagnosticArgument>> = input.messageArgs ?? {};
      // Host-supplied schema guidance (crossValidate suggestions) is already content, so it wins over
      // the bundle. Everything else renders from messageKey + messageArgs, which is what makes the
      // creator-facing layer translatable without touching compiler logic.
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

/** Collapse related locations that describe the same span of the same document. */
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
 * Deterministic, locale-independent reporting order. `closure.ts` asserts that emitted diagnostics are
 * already in this order, so any locale-sensitive comparison here would make the closure gate itself
 * environment-dependent.
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
