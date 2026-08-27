/**
 * UGC 解码层导出根。
 */
export type { Utf8Violation } from './utf8';
export { UTF8_VIOLATION_TEXT, findFirstUtf8Violation, utf8LengthOfCodePoint } from './utf8';

export { SourceCursor } from './source-cursor';

export type { StructuralJsonDecoder } from './strict-json-decoder';
export { SCHEMA_VERSION_MEMBER, createStrictJsonDecoder } from './strict-json-decoder';

export type {
  EffectContractView,
  ExecutionRequestKind,
  MemberVerdict,
  ProhibitedConstructFinding,
  ProhibitedConstructGate,
} from './prohibited-construct-gate';
export { createProhibitedConstructGate } from './prohibited-construct-gate';
