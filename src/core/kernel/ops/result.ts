/**
 * L3 Ops: Result 类型（design.md 3.4节 / 需求16.2）。
 */
import type { ErrCode } from '../state/error-codes';

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrCode; detail: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(code: ErrCode, detail: string): Result<T> {
  return { ok: false, code, detail };
}
