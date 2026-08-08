/**
 * 表现资源回退决定（design.md「Presentation fallback resolver」/ 需求 10.4-10.6、10.10）。
 *
 * 每个决定必须自证"语义未变"：`semanticFingerprintBefore === semanticFingerprintAfter`。
 * 这不是可选的审计字段，而是回退被接受的前提条件；不相等即转为错误。
 */
import { compareCodePoints } from './fingerprint.js';

export interface PresentationFallbackDecision {
  readonly definitionId: string;
  readonly jsonPath: string;
  /** 原缺失/损坏资源标识；无法识别时为显式 `null`。 */
  readonly missingAsset: string | null;
  readonly fallbackAsset: string;
  readonly semanticFingerprintBefore: string;
  readonly semanticFingerprintAfter: string;
}

export function createPresentationFallbackDecision(
  input: PresentationFallbackDecision,
): PresentationFallbackDecision {
  return Object.freeze({
    definitionId: input.definitionId,
    jsonPath: input.jsonPath,
    missingAsset: input.missingAsset,
    fallbackAsset: input.fallbackAsset,
    semanticFingerprintBefore: input.semanticFingerprintBefore,
    semanticFingerprintAfter: input.semanticFingerprintAfter,
  });
}

/** 语义未变的自证检查。 */
export function isSemanticsPreserving(decision: PresentationFallbackDecision): boolean {
  return decision.semanticFingerprintBefore === decision.semanticFingerprintAfter;
}

/** 多个回退决定的确定性排序：定义标识 → JSON path → 回退资产。 */
export function comparePresentationDecisions(
  left: PresentationFallbackDecision,
  right: PresentationFallbackDecision,
): number {
  const byDefinition = compareCodePoints(left.definitionId, right.definitionId);
  if (byDefinition !== 0) return byDefinition;
  const byPath = compareCodePoints(left.jsonPath, right.jsonPath);
  if (byPath !== 0) return byPath;
  return compareCodePoints(left.fallbackAsset, right.fallbackAsset);
}
