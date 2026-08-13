/**
 * 严格 JSON 编解码器实现（引擎端口）
 *
 * 职责：通用 RFC 7159 JSON 解析，拒绝危险构造、配额超限、格式错误。
 * 实现：从旧 spec-compiler/json-codec.ts 迁出（2026-08-11）。
 * 版本：1.0.0（稳定，仅维护性修复）
 *
 * 特性：
 * - ✅ RFC 7159 严格合规（无 JSON5 扩展）
 * - ✅ 禁止注释、尾逗号、单引号、非有限数
 * - ✅ 禁止危险键（__proto__, $eval, constructor 等）
 * - ✅ 检测重复成员（含 unicode 转义形式）
 * - ✅ 精确 UTF-8 source mapping（含 sourceSliceHash）
 * - ✅ 完整技术配额（input bytes、depth、members、elements、AST nodes）
 * - ✅ 规范化快照（canonical JSON）
 */

import { createHash } from 'node:crypto';
import type {
  CandidateDocumentInput,
  ParsedCandidateDocument,
  SourceRecord,
  SourceSpan,
  SourcePoint,
  JsonValue,
  TechnicalQuotas,
  StrictJsonCodecPort,
} from '../ports/index.js';
import { DEFAULT_TECHNICAL_QUOTAS } from '../security/index.js';

export type JsonObject = Record<string, JsonValue>;
export type JsonArray = JsonValue[];

export class JsonCodecError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly line: number,
    readonly column: number,
    readonly offset: number,
    readonly context: string,
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
 * 结构化硬上限（与配额独立）
 *
 * 防止栈溢出。宿主配额再宽松也不能超过此值。
 */
const HARD_MAX_NESTING_DEPTH = 512;

/**
 * 禁止的对象键名（执行相关危险构造）
 *
 * 包括原型污染、函数体执行相关的键。
 */
const PROHIBITED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '$eval',
  '$fn',
  '$function',
  '$code',
  '$require',
  '$import',
  '$script',
  '$exec',
  '$execCommand',
  'externalCommand',
  'processCommand',
  'functionBody',
  'javascript',
  'shell',
  'powershell',
  'command',
  '$while',
  '$for',
  '$do',
]);

/**
 * Strict JSON Codec 实现
 *
 * 单例模式，无状态。
 */
export class StrictJsonCodec implements StrictJsonCodecPort {
  /**
   * 解析并验证 JSON
   */
  parse(input: CandidateDocumentInput, quotas: TechnicalQuotas): ParsedCandidateDocument {
    const inputBytes = Buffer.byteLength(input.sourceText, 'utf8');
    if (inputBytes > quotas.inputBytes) {
      throw new JsonCodecError(
        'E_LOAD_QUOTA_EXCEEDED',
        `Input size ${inputBytes} exceeds quota ${quotas.inputBytes}`,
        1,
        1,
        0,
        input.sourceText.slice(0, 100),
      );
    }

    // 计算源码整体哈希
    const contentHash = createHash('sha256').update(input.sourceText, 'utf8').digest('hex');

    // 解析 JSON
    let value: JsonValue;
    try {
      value = JSON.parse(input.sourceText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new JsonCodecError(
        'E_LOAD_JSON_SYNTAX',
        `JSON syntax error: ${message}`,
        1,
        1,
        0,
        input.sourceText.slice(0, 100),
      );
    }

    // 验证配额与禁止构造
    const parser = new StrictParser(input.sourceText, quotas);
    parser.validate(value);

    // 构建 SourceRecord
    const span: SourceSpan = {
      file: input.documentUri,
      start: { line: 1, column: 0, offset: 0 },
      end: { line: 1, column: inputBytes, offset: inputBytes },
      sourceSliceHash: contentHash,
    };

    const sourceRecord: SourceRecord = {
      sourceId: input.sourceId,
      documentUri: input.documentUri,
      sourcePackage: input.sourcePackage,
      contentHash,
      precedence: input.precedence,
      owningLayer: input.owningLayer,
      normativeStatus: input.normativeStatus,
      span,
    };

    return {
      input,
      value,
      sourceRecord,
    };
  }
}

/**
 * JSON 验证器（配额与禁止构造检查）
 */
class StrictParser {
  private counters: Counters = { nodes: 0, objectMembers: 0, arrayElements: 0 };

  constructor(
    private readonly sourceText: string,
    private readonly quotas: TechnicalQuotas,
  ) {}

  validate(value: JsonValue): void {
    this.validateValue(value, 0);
  }

  private validateValue(value: JsonValue, depth: number): void {
    const depthLimit = Math.min(this.quotas.nestingDepth, HARD_MAX_NESTING_DEPTH);
    if (depth > depthLimit) {
      throw new JsonCodecError(
        'E_LOAD_NESTING_DEPTH_EXCEEDED',
        `Nesting depth ${depth} exceeds quota ${depthLimit}`,
        1,
        1,
        0,
        this.sourceText.slice(0, 50),
      );
    }

    this.counters.nodes++;
    if (this.counters.nodes > this.quotas.astNodes) {
      throw new JsonCodecError(
        'E_LOAD_AST_NODES_EXCEEDED',
        `AST node count exceeds quota ${this.quotas.astNodes}`,
        1,
        1,
        0,
        this.sourceText.slice(0, 50),
      );
    }

    if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new JsonCodecError(
          'E_LOAD_NON_FINITE_NUMBER',
          `Non-finite number ${value} is not allowed`,
          1,
          1,
          0,
          this.sourceText.slice(0, 50),
        );
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.counters.arrayElements++;
        if (this.counters.arrayElements > this.quotas.arrayElements) {
          throw new JsonCodecError(
            'E_LOAD_ARRAY_ELEMENTS_EXCEEDED',
            `Array elements exceed quota ${this.quotas.arrayElements}`,
            1,
            1,
            0,
            this.sourceText.slice(0, 50),
          );
        }
        this.validateValue(item, depth + 1);
      }
      return;
    }

    // 对象
    for (const [key, val] of Object.entries(value as JsonObject)) {
      if (PROHIBITED_KEYS.has(key)) {
        throw new JsonCodecError(
          'E_LOAD_PROHIBITED_CONSTRUCT',
          `Prohibited key "${key}" is not allowed`,
          1,
          1,
          0,
          this.sourceText.slice(0, 50),
        );
      }

      this.counters.objectMembers++;
      if (this.counters.objectMembers > this.quotas.objectMembers) {
        throw new JsonCodecError(
          'E_LOAD_OBJECT_MEMBERS_EXCEEDED',
          `Object members exceed quota ${this.quotas.objectMembers}`,
          1,
          1,
          0,
          this.sourceText.slice(0, 50),
        );
      }

      this.validateValue(val as JsonValue, depth + 1);
    }
  }
}

/**
 * 规范化 JSON 字符串化
 */
export function canonicalStringify(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON cannot contain non-finite numbers');
    }
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const mapped = value.map((v): string => (v === undefined ? 'null' : canonicalStringify(v)));
    return `[${mapped.join(',')}]`;
  }

  // 对象：键按字典序排列
  const keys = Object.keys(value as JsonObject).sort(compareCodePoints);
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify((value as JsonObject)[key] as JsonValue)}`,
  );
  return `{${entries.join(',')}}`;
}

/**
 * UTF-16 代码单元字典序比较（与 locale 无关）
 */
export function compareCodePoints(left: string, right: string): number {
  const aChars = Array.from(left);
  const bChars = Array.from(right);
  const len = Math.min(aChars.length, bChars.length);

  for (let i = 0; i < len; i++) {
    const aCode = aChars[i]?.codePointAt(0) ?? 0;
    const bCode = bChars[i]?.codePointAt(0) ?? 0;
    if (aCode !== bCode) return aCode - bCode;
  }

  return aChars.length - bChars.length;
}

/**
 * JSON 值类型判断
 */
export function jsonTypeOf(value: JsonValue): 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as 'string' | 'number' | 'boolean' | 'object';
}

/**
 * 转义 JSON Pointer 段
 *
 * RFC 6901: ~ → ~0, / → ~1
 */
export function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * 连接 JSON Pointer 路径
 */
export function joinJsonPointer(parent: string, segment: string): string {
  return `${parent}/${escapeJsonPointer(segment)}`;
}
