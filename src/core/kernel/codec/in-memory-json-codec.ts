/**
 * 内存 JSON 编解码器实现（引擎端口）
 *
 * 职责：实现 StrictJsonCodecPort，通用 RFC JSON 解析，拒绝危险构造与配额超限。
 * 版本：1.0.0（2026-08-11）
 *
 * 注意：这是临时实现，用于 Phase 0 characterization。
 * Phase 1 将从旧 spec-compiler::StrictJsonCodec 迁出完整实现。
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
  JsonCodecError,
} from '../ports/index.js';
import { QuotaBudget } from '../ports/quota-contract.js';

/**
 * 占位实现（待 Phase 1 迁出完整实现）
 *
 * 当前仅做基础校验，真实实现来自 src/core/kernel/spec-compiler/json-codec.ts 的迁出。
 */
export class InMemoryJsonCodec implements StrictJsonCodecPort {
  parse(input: CandidateDocumentInput, quotas: TechnicalQuotas): ParsedCandidateDocument {
    // 检查输入字节数
    const inputBytes = Buffer.byteLength(input.sourceText, 'utf8');
    if (inputBytes > quotas.inputBytes) {
      throw new Error(`Input size ${inputBytes} exceeds quota ${quotas.inputBytes}`);
    }

    // 尝试解析 JSON
    let value: JsonValue;
    try {
      value = JSON.parse(input.sourceText);
    } catch (err) {
      throw new Error(`JSON parse error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 计算源码哈希
    const contentHash = createHash('sha256').update(input.sourceText, 'utf8').digest('hex');
    const sourceSliceHash = contentHash; // 简化：整个文档作为一个跨度

    // 构建 SourceRecord
    const sourceRecord: SourceRecord = {
      sourceId: input.sourceId,
      documentUri: input.documentUri,
      sourcePackage: input.sourcePackage,
      contentHash,
      precedence: input.precedence,
      owningLayer: input.owningLayer,
      normativeStatus: input.normativeStatus,
      span: {
        file: input.documentUri,
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: inputBytes, offset: inputBytes },
        sourceSliceHash,
      },
    };

    return {
      input,
      value,
      sourceRecord,
    };
  }
}
