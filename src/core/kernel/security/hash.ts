/**
 * 哈希算法原语
 *
 * 版本：1.0.0（2026-08-11）
 * 迁出源：spec-compiler/json-codec.ts、output-lease.ts
 *
 * 职责：
 * - SHA-256（制品指纹、source mapping）
 * - 确定性哈希函数（locale-independent）
 */

import { createHash } from 'node:crypto';

/**
 * SHA-256 字节哈希（十六进制字符串）
 *
 * 用途：
 * - 制品完整性校验
 * - source mapping 指纹
 * - 缓存键
 *
 * 保证：
 * - 相同输入 → 相同输出（确定性）
 * - 输出始终为 64 个十六进制字符
 */
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * UTF-8 文本哈希
 *
 * 便利方法，自动处理编码。
 */
export function hashUtf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 对象深度哈希（canonical JSON 路径）
 *
 * 用途：
 * - 规范化快照指纹
 * - 避免格式差异导致的哈希差异
 */
export function hashObject(obj: unknown): string {
  const json = JSON.stringify(obj, (_, v) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') return v;
    if (Array.isArray(v)) return v.map((item) => JSON.stringify(item)).sort();
    if (typeof v === 'object') {
      const pairs = Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => `${JSON.stringify(k)}:${JSON.stringify(val)}`);
      return `{${pairs.join(',')}}`;
    }
    return v;
  });
  return hashUtf8(json);
}

/**
 * FNV-1a 哈希（快速指纹，非加密）
 *
 * 用途：
 * - 快速检测基本差异
 * - 内部缓存键（不用于安全相关）
 *
 * 注意：不适合安全敏感场景，仅用于性能优化。
 */
export function fnv1aHash(bytes: Uint8Array): number {
  let hash = 2166136261;
  for (const byte of Array.from(bytes)) {
    hash ^= byte;
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
}

/**
 * 字符串 FNV-1a 哈希
 */
export function fnv1aString(text: string): number {
  return fnv1aHash(Buffer.from(text, 'utf8'));
}
