/**
 * UGC 解码层导出根。
 */
export type { Utf8Violation } from './utf8.js';
export { UTF8_VIOLATION_TEXT, findFirstUtf8Violation, utf8LengthOfCodePoint } from './utf8.js';

export { SourceCursor } from './source-cursor.js';

export type { StructuralJsonDecoder } from './strict-json-decoder.js';
export { SCHEMA_VERSION_MEMBER, createStrictJsonDecoder } from './strict-json-decoder.js';

export type {
  EffectContractView,
  ExecutionRequestKind,
  MemberVerdict,
  ProhibitedConstructFinding,
  ProhibitedConstructGate,
} from './prohibited-construct-gate.js';
export { createProhibitedConstructGate } from './prohibited-construct-gate.js';
