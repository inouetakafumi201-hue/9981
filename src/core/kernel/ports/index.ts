/**
 * 引擎层稳定端口（L0 不可变契约）
 *
 * 定义通用基础设施：JSON 编解码、哈希、诊断、持久化、配额。
 *
 * 版本：1.0.0（2026-08-11）
 *
 * 消费方：
 * - src/l2/** （基类层语义管线）
 * - src/core/ugc/** （UGC 集成）
 * - src/play/** （玩法层）
 *
 * 职责分工（铁律）：
 * - 引擎层：无语义，纯基础设施（JSON、哈希、诊断、持久化、配额）
 * - L2 层：语义编排（验证、解析、激活、规范化）
 * - UGC 层：集成协调（端口装配、CAS、投影）
 *
 * 不变量（violation = refactor）：
 * - 引擎端口不依赖 L2 概念（如 definition、reference）
 * - L2 不直接 import 旧 spec-compiler，只消费引擎端口
 * - UGC 不依赖 spec-compiler，只消费 L2 端口与引擎端口
 */

export * from './json-codec-contract';
export * from './hash-contract';
export * from './diagnostic-contract';
export * from './artifact-store-contract';
export * from './quota-contract';
