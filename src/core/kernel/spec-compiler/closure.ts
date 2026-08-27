import type { Diagnostic } from '../state/diagnostic';
import { ERR_CODES, isFatalCode, isInfrastructureFatalCode } from '../state/error-codes';
import { validateSourceRecord } from '../state/source-record';
import { HINT_TEMPLATES } from '../safety/safety';
import { sortDiagnostics } from './diagnostic-factory';

const KNOWN_CODES: ReadonlySet<string> = new Set(
  Object.entries(ERR_CODES).flatMap(([prefix, suffixes]) => suffixes.map((suffix) => `${prefix}_${suffix}`)),
);

export interface ClosureIssue {
  readonly reason: string;
  readonly code?: string;
}

/** Blocks activation: both candidate errors and infrastructure failures qualify. */
function isBlocking(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === 'error' || diagnostic.severity === 'fatal';
}

/** Declares intent to stop, so severity must be error or fatal. */
function declaresHalt(diagnostic: Diagnostic): boolean {
  return diagnostic.haltClass !== undefined ||
    isFatalCode(diagnostic.code) ||
    isInfrastructureFatalCode(diagnostic.code);
}

/**
 * Structural gate that runs before any diagnostics leave the compiler.
 * A violation here means the diagnostic subsystem itself is untrustworthy, so the caller must halt
 * rather than return a rejection that a creator cannot act on.
 */
export function checkDiagnosticClosure(
  diagnostics: readonly Diagnostic[],
  sourceTexts: ReadonlyMap<string, string>,
  options: { readonly requireRejection: boolean },
): readonly ClosureIssue[] {
  const issues: ClosureIssue[] = [];

  for (const diagnostic of diagnostics) {
    if (!KNOWN_CODES.has(diagnostic.code)) {
      issues.push({ reason: 'code is absent from the closed ErrCode registry', code: diagnostic.code });
      continue;
    }
    if (!HINT_TEMPLATES[diagnostic.code] && !diagnostic.actionableHint) {
      issues.push({ reason: 'no actionable hint is registered', code: diagnostic.code });
    }
    if (declaresHalt(diagnostic) && !isBlocking(diagnostic)) {
      issues.push({ reason: 'halting diagnostic must be error or fatal', code: diagnostic.code });
    }
    if (isInfrastructureFatalCode(diagnostic.code) && diagnostic.severity !== 'fatal') {
      issues.push({ reason: 'infrastructure failure must be fatal', code: diagnostic.code });
    }
    if ((diagnostic.severity === 'warn' || diagnostic.severity === 'info') && diagnostic.haltClass !== undefined) {
      issues.push({ reason: 'non-blocking diagnostic must not declare a halt class', code: diagnostic.code });
    }
    collectSourceIssues(diagnostic, sourceTexts, issues);
  }

  if (options.requireRejection && !diagnostics.some(isBlocking)) {
    issues.push({ reason: 'rejection result contains no error-severity diagnostic' });
  }
  if (!isDeterministicallySorted(diagnostics)) {
    issues.push({ reason: 'diagnostics are not in the deterministic reporting order' });
  }
  return issues;
}

function collectSourceIssues(
  diagnostic: Diagnostic,
  sourceTexts: ReadonlyMap<string, string>,
  issues: ClosureIssue[],
): void {
  const source = diagnostic.source;
  if (!source) {
    // Host-scope infrastructure diagnostics describe the compiler, not a creator source location.
    if (diagnostic.scope !== 'host') {
      issues.push({ reason: 'candidate diagnostic has no Source_Record', code: diagnostic.code });
    }
    return;
  }

  const sourceText = sourceTexts.get(source.sourceId);
  if (sourceText === undefined) {
    issues.push({ reason: 'Source_Record refers to an unknown source document', code: diagnostic.code });
  } else {
    for (const issue of validateSourceRecord(source, sourceText)) {
      issues.push({ reason: `Source_Record integrity: ${issue.field} ${issue.reason}`, code: diagnostic.code });
    }
  }

  const relatedKeys = new Set<string>();
  for (const related of diagnostic.relatedSources ?? []) {
    const key = `${related.sourceId}:${related.span.start.offset}:${related.span.end.offset}`;
    if (relatedKeys.has(key)) {
      issues.push({ reason: 'relatedSources contains duplicate entries', code: diagnostic.code });
    }
    relatedKeys.add(key);
    if (!related.span.sourceSliceHash) {
      issues.push({ reason: 'related Source_Record has no verified span', code: diagnostic.code });
    }
  }

  if (diagnostic.blockingCode !== undefined && !KNOWN_CODES.has(diagnostic.blockingCode)) {
    issues.push({ reason: 'blockingCode is absent from the closed ErrCode registry', code: diagnostic.code });
  }
}

function isDeterministicallySorted(diagnostics: readonly Diagnostic[]): boolean {
  const sorted = sortDiagnostics(diagnostics);
  return diagnostics.every((diagnostic, index) => sorted[index] === diagnostic);
}
