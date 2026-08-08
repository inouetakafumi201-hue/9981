import { createHash } from 'node:crypto';
import type { SourcePoint, SourceRecord, SourceSpan } from './diagnostic.js';

export interface SourceIntegrityIssue {
  readonly field: string;
  readonly reason: string;
}

export function sha256Utf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Convert a UTF-16 string index used by JavaScript parsers to the source contract's UTF-8 position. */
export function sourcePointAtCharIndex(source: string, charIndex: number): SourcePoint {
  if (!Number.isInteger(charIndex) || charIndex < 0 || charIndex > source.length) {
    throw new RangeError(`charIndex ${charIndex} is outside source length ${source.length}`);
  }

  const prefix = source.slice(0, charIndex);
  const lines = prefix.split('\n');
  const currentLine = lines[lines.length - 1] ?? '';
  return {
    line: lines.length,
    column: Array.from(currentLine).length + 1,
    offset: utf8ByteLength(prefix),
  };
}

/** Convert a UTF-8 byte offset back to a creator-facing point and reject offsets inside a code point. */
export function sourcePointAtByteOffset(source: string, offset: number): SourcePoint {
  if (!Number.isInteger(offset) || offset < 0 || offset > utf8ByteLength(source)) {
    throw new RangeError(`offset ${offset} is outside UTF-8 source bytes`);
  }

  let bytes = 0;
  let charIndex = 0;
  for (const codePoint of source) {
    if (bytes === offset) return sourcePointAtCharIndex(source, charIndex);
    const width = utf8ByteLength(codePoint);
    if (bytes + width > offset) {
      throw new RangeError(`offset ${offset} points inside a UTF-8 code point`);
    }
    bytes += width;
    charIndex += codePoint.length;
  }
  if (bytes === offset) return sourcePointAtCharIndex(source, source.length);
  throw new RangeError(`offset ${offset} cannot be mapped to source`);
}

export function sourceSpanFromCharRange(
  file: string,
  source: string,
  startCharIndex: number,
  endCharIndex: number,
): SourceSpan {
  if (endCharIndex < startCharIndex) {
    throw new RangeError('source span end precedes start');
  }
  const slice = source.slice(startCharIndex, endCharIndex);
  return {
    file,
    start: sourcePointAtCharIndex(source, startCharIndex),
    end: sourcePointAtCharIndex(source, endCharIndex),
    sourceSliceHash: sha256Utf8(slice),
  };
}

export function createSourceRecord(input: {
  sourceId: string;
  documentUri: string;
  sourcePackage: string;
  sourceText: string;
  precedence: number;
  decisionId?: string;
  owningLayer: SourceRecord['owningLayer'];
  normativeStatus: SourceRecord['normativeStatus'];
  startCharIndex?: number;
  endCharIndex?: number;
}): SourceRecord {
  const start = input.startCharIndex ?? 0;
  const end = input.endCharIndex ?? input.sourceText.length;
  return {
    sourceId: input.sourceId,
    documentUri: input.documentUri,
    sourcePackage: input.sourcePackage,
    contentHash: sha256Utf8(input.sourceText),
    precedence: input.precedence,
    decisionId: input.decisionId,
    owningLayer: input.owningLayer,
    normativeStatus: input.normativeStatus,
    span: sourceSpanFromCharRange(input.documentUri, input.sourceText, start, end),
  };
}

export function validateSourceRecord(record: SourceRecord, sourceText: string): readonly SourceIntegrityIssue[] {
  const issues: SourceIntegrityIssue[] = [];
  const byteLength = utf8ByteLength(sourceText);
  const { start, end } = record.span;

  if (record.contentHash !== sha256Utf8(sourceText)) {
    issues.push({ field: 'contentHash', reason: 'content hash does not match immutable source bytes' });
  }
  if (!Number.isFinite(record.precedence)) {
    issues.push({ field: 'precedence', reason: 'precedence must be finite' });
  }
  if (start.offset < 0 || end.offset < start.offset || end.offset > byteLength) {
    issues.push({ field: 'span', reason: 'UTF-8 offsets are outside source bounds or reversed' });
    return issues;
  }

  try {
    const expectedStart = sourcePointAtByteOffset(sourceText, start.offset);
    const expectedEnd = sourcePointAtByteOffset(sourceText, end.offset);
    if (expectedStart.line !== start.line || expectedStart.column !== start.column) {
      issues.push({ field: 'span.start', reason: 'line/column do not map to start offset' });
    }
    if (expectedEnd.line !== end.line || expectedEnd.column !== end.column) {
      issues.push({ field: 'span.end', reason: 'line/column do not map to end offset' });
    }

    const sourceBytes = Buffer.from(sourceText, 'utf8');
    const slice = sourceBytes.subarray(start.offset, end.offset).toString('utf8');
    if (!record.span.sourceSliceHash) {
      issues.push({ field: 'span.sourceSliceHash', reason: 'source slice hash is missing' });
    } else if (record.span.sourceSliceHash !== sha256Utf8(slice)) {
      issues.push({ field: 'span.sourceSliceHash', reason: 'source slice hash does not match source bytes' });
    }
  } catch (error) {
    issues.push({ field: 'span', reason: error instanceof Error ? error.message : String(error) });
  }

  return issues;
}

export function assertValidSourceRecord(record: SourceRecord, sourceText: string): void {
  const issues = validateSourceRecord(record, sourceText);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => `${issue.field}: ${issue.reason}`).join('; '));
  }
}
