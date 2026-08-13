/**
 * 引擎层 JSON 编解码稳定实现
 *
 * 版本：1.0.0（2026-08-11）
 *
 * 消费方：
 * - src/l2/** （基类层）
 * - src/core/ugc/** （UGC 集成）
 * - src/play/** （玩法层）
 *
 * 维护规则（v1.1+ 只能扩展）：
 * - 可新增编解码器（如 JSON5、YAML 支持）
 * - 不能改变现有 RFC 7159 编解码器的行为
 * - 不能删除现有公共导出
 */

export { StrictJsonCodec, JsonCodecError, canonicalStringify, compareCodePoints, jsonTypeOf, escapeJsonPointer, joinJsonPointer } from './strict-json-codec.js';
export type { JsonObject, JsonArray } from './strict-json-codec.js';
