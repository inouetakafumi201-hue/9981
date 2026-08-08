import type { ErrCode } from '../state/error-codes.js';
import type { SourceRecord } from '../state/diagnostic.js';
import { createSourceRecord, sourceSpanFromCharRange, utf8ByteLength } from '../state/source-record.js';
import type {
  CandidateDocumentInput,
  JsonValue,
  MutableJsonObject,
  ParsedCandidateDocument,
  TechnicalQuotas,
} from './types.js';

export class JsonCodecError extends Error {
  constructor(
    readonly code: ErrCode,
    message: string,
    readonly startCharIndex: number,
    readonly endCharIndex: number,
    readonly path: string,
    readonly details: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(message);
    this.name = 'JsonCodecError';
  }
}

interface Counters {
  nodes: number;
  objectMembers: number;
  arrayElements: number;
}

/**
 * Structural ceiling that does not depend on host configuration. The parser is recursive, so a host
 * that configures an absurd nesting quota must still be refused rather than allowed to overflow the
 * call stack. Refusing is the fail-closed choice.
 */
const HARD_MAX_NESTING_DEPTH = 512;

const PROHIBITED_KEYS = new Set([
  '$eval', '$script', '$exec', 'externalCommand', 'processCommand',
  'functionBody', 'javascript', 'shell', 'powershell',
]);

export function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function joinJsonPointer(parent: string, segment: string): string {
  return `${parent}/${escapeJsonPointer(segment)}`;
}

export class StrictJsonCodec {
  parse(input: CandidateDocumentInput, quotas: TechnicalQuotas): ParsedCandidateDocument {
    if (utf8ByteLength(input.sourceText) > quotas.inputBytes) {
      throw new JsonCodecError(
        'E_QUOTA_INPUT_BYTES',
        `Input bytes exceed ${quotas.inputBytes}`,
        0,
        input.sourceText.length,
        '',
        { limit: quotas.inputBytes, observed: utf8ByteLength(input.sourceText) },
      );
    }

    const source = createSourceRecord({
      ...input,
      startCharIndex: 0,
      endCharIndex: input.sourceText.length,
    });
    const parser = new Parser(input, source, quotas);
    return parser.parse();
  }

  canonicalize(value: JsonValue): string {
    return canonicalStringify(value);
  }
}

class Parser {
  private index = 0;
  private readonly locations = new Map<string, SourceRecord>();
  private readonly counters: Counters = { nodes: 0, objectMembers: 0, arrayElements: 0 };

  constructor(
    private readonly input: CandidateDocumentInput,
    private readonly documentSource: SourceRecord,
    private readonly quotas: TechnicalQuotas,
  ) {}

  parse(): ParsedCandidateDocument {
    this.skipWhitespace();
    if (this.index >= this.input.sourceText.length) {
      throw this.error('E_LOAD_INPUT_TRUNCATED', 'Input is empty or truncated', this.index, this.index, '');
    }
    const value = this.parseValue('', 0);
    this.skipWhitespace();
    if (this.index !== this.input.sourceText.length) {
      throw this.error('E_LOAD_JSON_SYNTAX', 'Unexpected characters after the root value', this.index, this.index + 1, '');
    }
    return { value, source: this.documentSource, locations: this.locations };
  }

  private parseValue(path: string, depth: number): JsonValue {
    const depthLimit = Math.min(this.quotas.nestingDepth, HARD_MAX_NESTING_DEPTH);
    if (depth > depthLimit) {
      throw this.error(
        'E_QUOTA_NESTING_DEPTH',
        `Nesting depth exceeds ${depthLimit}`,
        this.index,
        this.index + 1,
        path,
        { limit: depthLimit, observed: depth },
      );
    }
    this.counters.nodes++;
    if (this.counters.nodes > this.quotas.astNodes) {
      throw this.error(
        'E_QUOTA_AST_NODES',
        `AST node count exceeds ${this.quotas.astNodes}`,
        this.index,
        this.index + 1,
        path,
        { limit: this.quotas.astNodes, observed: this.counters.nodes },
      );
    }

    this.skipWhitespace();
    const start = this.index;
    const char = this.input.sourceText[this.index];
    let value: JsonValue;
    if (char === '{') value = this.parseObject(path, depth + 1);
    else if (char === '[') value = this.parseArray(path, depth + 1);
    else if (char === '"') value = this.parseString(path);
    else if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) value = this.parseNumber(path);
    else if (this.consumeLiteral('true')) value = true;
    else if (this.consumeLiteral('false')) value = false;
    else if (this.consumeLiteral('null')) value = null;
    else if (char === undefined) {
      throw this.error('E_LOAD_INPUT_TRUNCATED', 'Input ended before a value was complete', start, start, path);
    } else {
      throw this.error('E_LOAD_JSON_SYNTAX', `Unexpected token ${char}`, start, start + 1, path);
    }
    this.locations.set(path, this.sourceForRange(start, this.index));
    return value;
  }

  private parseObject(path: string, depth: number): JsonValue {
    this.index++;
    const result: MutableJsonObject = Object.create(null) as MutableJsonObject;
    const keys = new Map<string, { start: number; end: number }>();
    this.skipWhitespace();
    if (this.peek('}')) {
      this.index++;
      return result;
    }

    while (true) {
      this.skipWhitespace();
      const keyStart = this.index;
      if (!this.peek('"')) {
        const code = this.index >= this.input.sourceText.length ? 'E_LOAD_INPUT_TRUNCATED' : 'E_LOAD_JSON_SYNTAX';
        throw this.error(code, 'Object field name must be a quoted string', this.index, this.index + 1, path);
      }
      const key = this.parseString(path);
      const keyEnd = this.index;
      const previous = keys.get(key);
      if (previous) {
        throw this.error(
          'E_LOAD_DUPLICATE_MEMBER',
          `Duplicate object member ${key}`,
          keyStart,
          keyEnd,
          joinJsonPointer(path, key),
          { key, firstOffset: previous.start },
        );
      }
      keys.set(key, { start: keyStart, end: keyEnd });
      this.counters.objectMembers++;
      if (this.counters.objectMembers > this.quotas.objectMembers) {
        throw this.error(
          'E_QUOTA_OBJECT_MEMBERS',
          `Object members exceed ${this.quotas.objectMembers}`,
          keyStart,
          keyEnd,
          path,
          { limit: this.quotas.objectMembers, observed: this.counters.objectMembers },
        );
      }
      if (PROHIBITED_KEYS.has(key)) {
        throw this.error(
          'E_LOAD_PROHIBITED_CONSTRUCT',
          `Executable field ${key} is prohibited`,
          keyStart,
          keyEnd,
          joinJsonPointer(path, key),
          { construct: key },
        );
      }

      this.skipWhitespace();
      if (!this.peek(':')) {
        throw this.error('E_LOAD_JSON_SYNTAX', 'Expected colon after object field name', this.index, this.index + 1, path);
      }
      this.index++;
      const childPath = joinJsonPointer(path, key);
      result[key] = this.parseValue(childPath, depth);
      this.skipWhitespace();
      if (this.peek('}')) {
        this.index++;
        return result;
      }
      if (!this.peek(',')) {
        const code = this.index >= this.input.sourceText.length ? 'E_LOAD_INPUT_TRUNCATED' : 'E_LOAD_JSON_SYNTAX';
        throw this.error(code, 'Expected comma or closing brace', this.index, this.index + 1, path);
      }
      this.index++;
    }
  }

  private parseArray(path: string, depth: number): JsonValue[] {
    this.index++;
    const result: JsonValue[] = [];
    this.skipWhitespace();
    if (this.peek(']')) {
      this.index++;
      return result;
    }

    while (true) {
      const childPath = joinJsonPointer(path, String(result.length));
      result.push(this.parseValue(childPath, depth));
      this.counters.arrayElements++;
      if (this.counters.arrayElements > this.quotas.arrayElements) {
        throw this.error(
          'E_QUOTA_ARRAY_ELEMENTS',
          `Array elements exceed ${this.quotas.arrayElements}`,
          this.index,
          this.index,
          path,
          { limit: this.quotas.arrayElements, observed: this.counters.arrayElements },
        );
      }
      this.skipWhitespace();
      if (this.peek(']')) {
        this.index++;
        return result;
      }
      if (!this.peek(',')) {
        const code = this.index >= this.input.sourceText.length ? 'E_LOAD_INPUT_TRUNCATED' : 'E_LOAD_JSON_SYNTAX';
        throw this.error(code, 'Expected comma or closing bracket', this.index, this.index + 1, path);
      }
      this.index++;
    }
  }

  private parseString(path: string): string {
    const start = this.index;
    this.index++;
    let escaped = false;
    while (this.index < this.input.sourceText.length) {
      const code = this.input.sourceText.charCodeAt(this.index);
      const char = this.input.sourceText[this.index];
      if (!escaped && char === '"') {
        this.index++;
        const raw = this.input.sourceText.slice(start, this.index);
        try {
          return JSON.parse(raw) as string;
        } catch {
          throw this.error('E_LOAD_JSON_SYNTAX', 'Invalid string escape', start, this.index, path);
        }
      }
      if (!escaped && code < 0x20) {
        throw this.error('E_LOAD_JSON_SYNTAX', 'Unescaped control character in string', this.index, this.index + 1, path);
      }
      if (!escaped && char === '\\') escaped = true;
      else escaped = false;
      this.index++;
    }
    throw this.error('E_LOAD_INPUT_TRUNCATED', 'String is missing its closing quote', start, this.index, path);
  }

  private parseNumber(path: string): number {
    const start = this.index;
    const remaining = this.input.sourceText.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(remaining);
    if (!match) throw this.error('E_LOAD_JSON_SYNTAX', 'Invalid number', start, start + 1, path);
    this.index += match[0].length;
    const next = this.input.sourceText[this.index];
    if (next !== undefined && !/[\s,\]}]/.test(next)) {
      throw this.error('E_LOAD_JSON_SYNTAX', 'Invalid character after number', this.index, this.index + 1, path);
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw this.error('E_LOAD_FIELD_TYPE', 'Number must be finite', start, this.index, path);
    }
    return value;
  }

  private consumeLiteral(literal: string): boolean {
    if (!this.input.sourceText.startsWith(literal, this.index)) return false;
    const end = this.index + literal.length;
    const next = this.input.sourceText[end];
    if (next !== undefined && !/[\s,\]}]/.test(next)) return false;
    this.index = end;
    return true;
  }

  private skipWhitespace(): void {
    while (this.index < this.input.sourceText.length && /[\t\n\r ]/.test(this.input.sourceText[this.index] ?? '')) {
      this.index++;
    }
  }

  private peek(value: string): boolean {
    return this.input.sourceText[this.index] === value;
  }

  private sourceForRange(start: number, end: number): SourceRecord {
    return {
      ...this.documentSource,
      span: sourceSpanFromCharRange(this.input.documentUri, this.input.sourceText, start, end),
    };
  }

  private error(
    code: ErrCode,
    message: string,
    start: number,
    end: number,
    path: string,
    details: Readonly<Record<string, string | number | boolean>> = {},
  ): JsonCodecError {
    return new JsonCodecError(code, message, Math.max(0, start), Math.max(start, end), path, details);
  }
}

export function jsonTypeOf(value: JsonValue): 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as 'string' | 'number' | 'boolean' | 'object';
}

export function canonicalStringify(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain non-finite numbers');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort(compareCodePoints);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key] as JsonValue)}`).join(',')}}`;
}

/**
 * Locale-independent ordering. `String.prototype.localeCompare` depends on the host ICU build, so it
 * must never decide anything that reaches the canonical artifact bytes or the reported diagnostic order.
 */
export function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const aCode = a[i]?.codePointAt(0) ?? 0;
    const bCode = b[i]?.codePointAt(0) ?? 0;
    if (aCode !== bCode) return aCode - bCode;
  }
  return a.length - b.length;
}
