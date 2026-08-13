/**
 * 引擎层哈希与指纹算法
 *
 * 版本：1.0.0（2026-08-11，迁出自 spec-compiler/json-codec.ts）
 * 迁出源：src/core/kernel/spec-compiler/json-codec.ts（部分）+ 相关实用
 * 职责：SHA-256 哈希计算、FNV-1a 快速指纹、二进制内容签名
 *
 * 用于源码精确定位、制品完整性验证、缓存键生成。
 */

import { createHash } from 'node:crypto';

/**
 * SHA-256 强类型哈希值
 *
 * 64 个十六进制字符，代表 256 比特。
 * 示例：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（空字符串）
 */
export type Sha256Hash = string & { readonly __brand: 'Sha256Hash' };

/**
 * 验证并构造 Sha256Hash 类型
 *
 * @throws 如果输入不是有效的 SHA-256 十六进制字符串（64 个十六进制字符）
 */
export function asSha256Hash(hex: string): Sha256Hash {
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error(`Invalid SHA-256 hash: ${hex}`);
  }
  return (hex.toLowerCase() as unknown) as Sha256Hash;
}

/**
 * SHA-256 哈希器端口（Node.js 实现）
 *
 * 职责：从任意输入产生 64 字符十六进制字符串（256 比特）。
 * 契约：
 * - ✅ 使用标准 SHA-256 算法
 * - ✅ 相同输入产生相同输出（确定性）
 * - ✅ 支持 UTF-8 字符串、原始字节、文件内容
 * - ✅ 输出为小写十六进制字符串
 * - ❌ 不支持增量哈希（streaming）
 * - ❌ 不用于安全相关（如密钥导出）
 */
export class Sha256Hasher {
  /**
   * 从 UTF-8 字符串计算哈希
   *
   * 等价于: hash(Buffer.from(text, 'utf8'))
   */
  hashUtf8(text: string): Sha256Hash {
    const hash = createHash('sha256').update(text, 'utf8').digest('hex');
    return asSha256Hash(hash);
  }

  /**
   * 从原始字节计算哈希
   */
  hashBytes(data: Uint8Array): Sha256Hash {
    const hash = createHash('sha256').update(data).digest('hex');
    return asSha256Hash(hash);
  }

  /**
   * 从文件路径计算哈希
   *
   * 注：此方法需要文件 I/O。在 Node.js 环境中使用。
   * @throws 文件不存在或不可读
   */
  hashFile(filePath: string): Sha256Hash {
    const fs = require('node:fs');
    const data = fs.readFileSync(filePath);
    return this.hashBytes(new Uint8Array(data));
  }
}

/**
 * 指纹算法枚举
 *
 * 用于快照、registry 状态等的轻量级哈希。
 */
export enum FingerprintAlgorithm {
  /** 非安全快速哈希（快照、registry 状态、缓存键） */
  FNV_1A = 'fnv-1a',
  /** 安全哈希（制品签名、版本链） */
  SHA256 = 'sha256',
}

/**
 * FNV-1a 哈希算法（非安全，快速，用于缓存键）
 *
 * 64 比特输出（16 个十六进制字符）。
 * 用于快速比较和缓存键生成，不能用于安全相关。
 */
function fnv1a(data: Uint8Array): string {
  // FNV-1a 64-bit constants
  // FNV offset basis
  let hash = BigInt('0xcbf29ce484222325');
  const FNV_PRIME = BigInt('0x100000001b3');

  for (const byte of data) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & BigInt('0xffffffffffffffff');
  }

  // Convert to lowercase hex string without BigInt notation
  return hash.toString(16).padStart(16, '0');
}

/**
 * 指纹计算策略
 *
 * 职责：根据算法选择产生指纹（快速或安全）。
 */
export class FingerprintComputer {
  private readonly hasher = new Sha256Hasher();

  /**
   * 计算指纹
   *
   * @param data 输入字节数据
   * @param algorithm 算法选择
   * @returns 十六进制字符串（FNV-1a: 16 字符，SHA-256: 64 字符）
   */
  compute(data: Uint8Array, algorithm: FingerprintAlgorithm): string {
    switch (algorithm) {
      case FingerprintAlgorithm.FNV_1A:
        return fnv1a(data);
      case FingerprintAlgorithm.SHA256:
        return this.hasher.hashBytes(data);
      default:
        throw new Error(`Unknown fingerprint algorithm: ${algorithm}`);
    }
  }

  /**
   * 快速 FNV-1a 指纹（用于缓存/比较）
   */
  fnv1a(data: Uint8Array): string {
    return fnv1a(data);
  }

  /**
   * 安全 SHA-256 指纹（用于制品）
   */
  sha256(data: Uint8Array): Sha256Hash {
    return this.hasher.hashBytes(data);
  }
}

/**
 * JSON 规范化与代码点排序（来自 json-codec.ts）
 *
 * 用于确保相同的 JSON 值总是产生相同的规范串，
 * 进而产生相同的哈希。
 */

export type JsonValue = null | boolean | number | string | JsonObject | JsonArray;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonArray = readonly JsonValue[];

/**
 * JSON 值类型判断
 */
export function jsonTypeOf(value: JsonValue): 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as 'string' | 'number' | 'boolean' | 'object';
}

/**
 * 代码点独立排序（不依赖 locale）
 *
 * String.prototype.localeCompare 依赖 host ICU 构建，所以不能用于决策
 * 到达规范制品字节或诊断排序的任何逻辑。
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

/**
 * 规范 JSON 序列化
 *
 * 产生确定性的 JSON 表示：
 * - 对象成员按代码点排序
 * - 没有空格
 * - 有限数只能是数字
 * - -0 记作 "0"
 */
export function canonicalStringify(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain non-finite numbers');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort(compareCodePoints);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify((value as any)[key])}`).join(',')}}`;
}

/**
 * 便捷函数：直接从 JSON 值计算 SHA-256
 */
export function hashJson(value: JsonValue): Sha256Hash {
  const canonical = canonicalStringify(value);
  const hasher = new Sha256Hasher();
  return hasher.hashUtf8(canonical);
}

/**
 * 便捷函数：直接从字符串计算 SHA-256
 */
export function hashString(text: string): Sha256Hash {
  const hasher = new Sha256Hasher();
  return hasher.hashUtf8(text);
}

/**
 * 便捷函数：直接从字节计算 SHA-256
 */
export function hashBytes(data: Uint8Array): Sha256Hash {
  const hasher = new Sha256Hasher();
  return hasher.hashBytes(data);
}
