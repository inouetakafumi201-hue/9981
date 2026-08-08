/**
 * L1 State: Value 值域（design.md 3.1节 / 需求1.1、1.4）。
 */
import { isRef, type Ref } from './ids.js';

export type Value =
  | null
  | boolean
  | number
  | string
  | Value[]
  | { [key: string]: Value }
  | Ref;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 校验一个 JSON 兼容的输入是否为合法 Value：
 * - 数值必须是有限数（拒绝 NaN/Infinity，需求1.4）
 * - Ref 必须满足 isRef 判别
 * - 表与映射递归校验
 */
export function isValidValue(v: unknown): v is Value {
  if (v === null) return true;
  if (typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return isFiniteNumber(v);
  if (Array.isArray(v)) return v.every(isValidValue);
  if (isRef(v)) return true;
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).every(isValidValue);
  }
  return false;
}

export type ValueValidationResult = { ok: true } | { ok: false; reason: string };

export function validateValue(v: unknown): ValueValidationResult {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return { ok: true };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { ok: false, reason: 'E_INV_NAN_OR_INFINITY' };
    return { ok: true };
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const r = validateValue(item);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (isRef(v)) return { ok: true };
  if (typeof v === 'object' && v !== null) {
    for (const item of Object.values(v as Record<string, unknown>)) {
      const r = validateValue(item);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  return { ok: false, reason: 'E_INV_UNSUPPORTED_TYPE' };
}
