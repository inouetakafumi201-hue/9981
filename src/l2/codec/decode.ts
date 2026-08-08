/**
 * L2 Codec: 声明式 JSON → 候选定义解码。
 *
 * 对应 Requirements 11.1、11.4、11.10–11.11。
 *
 * 铁律：
 * - 语义字段缺失或损坏 → 记 Error 诊断，**绝不补造**默认值。
 * - 表现字段缺失或损坏 → 丢弃该表现字段并记 Warning，语义字段不受影响。
 * - 解码只做"形状"判定；层级、数值归属、族契约深度校验属于验证器职责。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import type { Diagnostic } from '../model/diagnostic.js';
import { errorDiagnostic, warningDiagnostic } from '../model/diagnostic-factory.js';
import type { PackageId } from '../model/ids.js';
import type { SourceLocation } from '../model/source.js';
import type { JsonNode } from './json-scanner.js';
import { findPosition } from './json-scanner.js';

export interface DecodeContext {
  readonly baseLocation: SourceLocation;
  readonly root: JsonNode;
  readonly packageId?: PackageId;
  readonly diagnostics: Diagnostic[];
  /** 当前正在解码的定义标识，用于诊断定位；解码顶层包元数据时为 undefined。 */
  definitionId?: string;
}

export function createDecodeContext(
  root: JsonNode,
  baseLocation: SourceLocation,
  packageId?: PackageId,
): DecodeContext {
  return {
    root,
    baseLocation,
    diagnostics: [],
    ...(packageId === undefined ? {} : { packageId }),
  };
}

/** 由 JSON 路径推导带行列的来源定位。 */
export function locate(ctx: DecodeContext, path: string): SourceLocation {
  const position = findPosition(ctx.root, path);
  if (position === undefined) {
    return ctx.baseLocation;
  }
  return { ...ctx.baseLocation, line: position.line, column: position.column };
}

function pushError(ctx: DecodeContext, path: string, code: string, reason: string, fix: string): void {
  ctx.diagnostics.push(
    errorDiagnostic({
      code,
      reason,
      correctionSuggestion: fix,
      jsonPath: path,
      sourceLocation: locate(ctx, path),
      ...(ctx.definitionId === undefined ? {} : { definitionId: ctx.definitionId }),
      ...(ctx.packageId === undefined ? {} : { sourcePackage: ctx.packageId }),
    }),
  );
}

export function pushPresentationFallback(ctx: DecodeContext, path: string, reason: string): void {
  ctx.diagnostics.push(
    warningDiagnostic({
      code: DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
      reason,
      correctionSuggestion: '补全该表现字段以获得完整展示效果；语义结果不受此回退影响。',
      jsonPath: path,
      sourceLocation: locate(ctx, path),
      ...(ctx.definitionId === undefined ? {} : { definitionId: ctx.definitionId }),
      ...(ctx.packageId === undefined ? {} : { sourcePackage: ctx.packageId }),
    }),
  );
}

function missing(ctx: DecodeContext, path: string, expected: string): undefined {
  pushError(
    ctx,
    path,
    DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_MISSING,
    `必需语义字段缺失：${path || '/'} 期望 ${expected}。`,
    `补全该语义字段；解码器不会为缺失的语义内容补造默认值（Requirements 11.10）。`,
  );
  return undefined;
}

function damaged(ctx: DecodeContext, path: string, expected: string, actual: unknown): undefined {
  pushError(
    ctx,
    path,
    DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
    `语义字段类型不符：${path || '/'} 期望 ${expected}，实际为 ${describe(actual)}。`,
    '修正该字段类型；解码器不做静默强制转换（Requirements 13.10）。',
  );
  return undefined;
}

function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

// ── 基础取值器：区分"缺失"与"损坏"，都不补造 ──────────────────────────────

export function requireObject(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return missing(ctx, path, 'object');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return damaged(ctx, path, 'object', value);
  }
  return value as Record<string, unknown>;
}

export function requireString(ctx: DecodeContext, value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return missing(ctx, path, 'string');
  }
  if (typeof value !== 'string') {
    return damaged(ctx, path, 'string', value);
  }
  return value;
}

export function requireBoolean(ctx: DecodeContext, value: unknown, path: string): boolean | undefined {
  if (value === undefined) {
    return missing(ctx, path, 'boolean');
  }
  if (typeof value !== 'boolean') {
    return damaged(ctx, path, 'boolean', value);
  }
  return value;
}

export function requireArray(ctx: DecodeContext, value: unknown, path: string): unknown[] | undefined {
  if (value === undefined) {
    return missing(ctx, path, 'array');
  }
  if (!Array.isArray(value)) {
    return damaged(ctx, path, 'array', value);
  }
  return value;
}

export function requireFiniteNumber(ctx: DecodeContext, value: unknown, path: string): number | undefined {
  if (value === undefined) {
    return missing(ctx, path, 'number');
  }
  if (typeof value !== 'number') {
    return damaged(ctx, path, 'number', value);
  }
  if (!Number.isFinite(value)) {
    pushError(
      ctx,
      path,
      DIAGNOSTIC_CODES.JSON_NON_FINITE_NUMBER,
      `数值字段 ${path} 不是有限数字。`,
      '使用有限数字；NaN 与 Infinity 不是合法声明式 JSON 值。',
    );
    return undefined;
  }
  return value;
}

// ── 可选取值器：缺失返回 undefined 且不报错；损坏仍报错 ──────────────────

export function optionalString(ctx: DecodeContext, value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return damaged(ctx, path, 'string', value);
  }
  return value;
}

export function optionalBoolean(ctx: DecodeContext, value: unknown, path: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    return damaged(ctx, path, 'boolean', value);
  }
  return value;
}

export function optionalFiniteNumber(ctx: DecodeContext, value: unknown, path: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireFiniteNumber(ctx, value, path);
}

export function optionalArray(ctx: DecodeContext, value: unknown, path: string): unknown[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return damaged(ctx, path, 'array', value);
  }
  return value;
}

export function optionalObject(
  ctx: DecodeContext,
  value: unknown,
  path: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return damaged(ctx, path, 'object', value);
  }
  return value as Record<string, unknown>;
}

/** 校验字符串值属于允许集合；否则报损坏（枚举越界属于语义损坏）。 */
export function requireEnum<T extends string>(
  ctx: DecodeContext,
  value: unknown,
  path: string,
  allowed: readonly T[],
): T | undefined {
  const raw = requireString(ctx, value, path);
  if (raw === undefined) {
    return undefined;
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    return damaged(ctx, path, `enum(${allowed.join('|')})`, raw);
  }
  return raw as T;
}
