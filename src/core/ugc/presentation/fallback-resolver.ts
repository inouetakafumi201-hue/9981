/**
 * 表现资源回退与语义指纹守卫（design.md「Presentation fallback resolver」/ 需求 10.1-10.10；tasks.md 7.1、7.2）。
 *
 * 这是整个 UGC 边界里**唯一**允许"缺东西还能继续"的地方，因此资格判定必须极窄。三道门：
 *
 * 1. **分类必须是 `presentation-optional`**。`semantic` 与 `presentation-required` 一律拒绝。
 * 2. **上游必须能证明该字段非语义**（`provesNonSemantic`）。名称、辅助文本只有在 Schema 明确证明
 *    它不参与标识、查询、可见性、AI 决策或规则时才可进入这一类（需求 10.4、Glossary）。
 *    端口返回 false 时按语义字段处理——UGC 不自行推断"看起来像装饰性文本"。
 * 3. **回退必须类型兼容，且语义指纹前后严格相同**。指纹一旦变化就转为错误（需求 10.6）。
 *
 * 另外：解析**不修改**原始 `CandidateDocument` 或 `CanonicalCandidate`，只产出独立的回退决定和
 * 一个新的上游候选值（需求 10.10）。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import type { PresentationFallbackDecision } from '../model/presentation.js';
import { comparePresentationDecisions, createPresentationFallbackDecision } from '../model/presentation.js';
import type { PresentationGap, UpstreamSchemaView, UpstreamValidatedCandidate } from '../model/upstream.js';
import type { UgcResult } from '../model/result.js';
import { ugcOk, ugcReject } from '../model/result.js';

const STAGE = 'presentation-resolution' as const;

export interface PresentationResolution {
  readonly candidate: UpstreamValidatedCandidate;
  readonly decisions: readonly PresentationFallbackDecision[];
  /** 每个成功回退对应一条可定位的 Warning（需求 10.5）。 */
  readonly warnings: readonly Diagnostic[];
}

export interface PresentationFallbackResolver {
  resolve(
    validated: UpstreamValidatedCandidate,
    schema: UpstreamSchemaView,
    sourcePackage: string,
  ): UgcResult<PresentationResolution>;
}

/** 稳定排序，保证多个缺口的处理顺序与诊断顺序确定（需求 11.11）。 */
function compareGaps(left: PresentationGap, right: PresentationGap): number {
  if (left.definitionId !== right.definitionId) return left.definitionId < right.definitionId ? -1 : 1;
  if (left.jsonPath !== right.jsonPath) return left.jsonPath < right.jsonPath ? -1 : 1;
  return 0;
}

export function createPresentationFallbackResolver(
  factory: UGCDiagnosticFactory,
): PresentationFallbackResolver {
  return Object.freeze({
    resolve(
      validated: UpstreamValidatedCandidate,
      schema: UpstreamSchemaView,
      sourcePackage: string,
    ): UgcResult<PresentationResolution> {
      const gaps = [...schema.listPresentationGaps(validated)].sort(compareGaps);
      if (gaps.length === 0) {
        return ugcOk({ candidate: validated, decisions: Object.freeze([]), warnings: Object.freeze([]) });
      }

      const errors: Diagnostic[] = [];
      const eligible: { readonly gap: PresentationGap; readonly assetId: string }[] = [];

      for (const gap of gaps) {
        const classification = schema.classifyField(gap.definitionId, gap.jsonPath);

        if (classification === 'semantic') {
          errors.push(semanticDamage(factory, sourcePackage, gap, '该字段是语义字段，缺失或损坏必须拒绝，不存在回退。'));
          continue;
        }

        if (!schema.provesNonSemantic(gap.definitionId, gap.jsonPath)) {
          // 上游无法证明其非语义 → 按语义字段处理。这是"宁可拒绝也不猜"的方向（需求 10.7）。
          errors.push(
            semanticDamage(
              factory,
              sourcePackage,
              gap,
              '上游 Schema 无法证明该字段不参与标识、查询、可见性、决策或规则，因此按语义字段处理。',
            ),
          );
          continue;
        }

        const fallback = schema.fallbackFor(gap.definitionId, gap.jsonPath);

        if (classification === 'presentation-required') {
          if (fallback === null) {
            errors.push(
              semanticDamage(
                factory,
                sourcePackage,
                gap,
                '该表现字段是必填的，且没有登记类型兼容的回退项，因此不能省略。',
              ),
            );
            continue;
          }
        }

        if (fallback === null) {
          // 真正可选且省略无语义影响：不产生回退，也不产生错误（需求 10.8）。
          continue;
        }

        if (fallback.typeTag !== gap.expectedTypeTag) {
          errors.push(
            semanticDamage(
              factory,
              sourcePackage,
              gap,
              `登记的回退项类型 ${JSON.stringify(fallback.typeTag)} 与该字段要求的类型 ` +
                `${JSON.stringify(gap.expectedTypeTag)} 不兼容，不能用于回退。`,
            ),
          );
          continue;
        }

        eligible.push({ gap, assetId: fallback.assetId });
      }

      if (errors.length > 0) {
        return ugcReject(errors);
      }
      if (eligible.length === 0) {
        return ugcOk({ candidate: validated, decisions: Object.freeze([]), warnings: Object.freeze([]) });
      }

      return applyEligible(validated, schema, factory, sourcePackage, eligible);
    },
  });
}

/**
 * 在隔离副本上应用全部合格回退，并证明语义指纹未变。
 *
 * 指纹在**应用全部回退之后**统一比较一次，而不是逐项比较：多个回退可能相互作用，逐项都"看起来没变"
 * 而整体改变语义的情况必须被抓住。若指纹变化，全部回退作废并转为错误（需求 10.6）。
 */
function applyEligible(
  validated: UpstreamValidatedCandidate,
  schema: UpstreamSchemaView,
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
  eligible: readonly { readonly gap: PresentationGap; readonly assetId: string }[],
): UgcResult<PresentationResolution> {
  const before = schema.semanticFingerprint(validated);

  const resolvedCandidate = schema.withResolvedPresentation(
    validated,
    eligible.map((entry) => ({
      definitionId: entry.gap.definitionId,
      jsonPath: entry.gap.jsonPath,
      asset: { assetId: entry.assetId, typeTag: entry.gap.expectedTypeTag },
    })),
  );

  const after = schema.semanticFingerprint(resolvedCandidate);

  if (before !== after) {
    return ugcReject(
      eligible.map((entry) =>
        semanticDamage(
          factory,
          sourcePackage,
          entry.gap,
          `应用表现资源回退改变了语义指纹（回退前 ${before}，回退后 ${after}）。` +
            '表现回退绝不允许改变任何规则结果，因此全部回退已作废。',
        ),
      ),
    );
  }

  const decisions = eligible
    .map((entry) =>
      createPresentationFallbackDecision({
        definitionId: entry.gap.definitionId,
        jsonPath: entry.gap.jsonPath,
        missingAsset: entry.gap.missingAsset,
        fallbackAsset: entry.assetId,
        semanticFingerprintBefore: before,
        semanticFingerprintAfter: after,
      }),
    )
    .sort(comparePresentationDecisions);

  const warnings = decisions.map((decision) =>
    factory.definition({
      selector: { category: 'PRESENTATION_FALLBACK', condition: 'presentation-fallback' },
      stage: STAGE,
      sourcePackage,
      definitionId: decision.definitionId,
      jsonPath: decision.jsonPath,
      sourceSpan:
        eligible.find((entry) => entry.gap.jsonPath === decision.jsonPath)?.gap.sourceSpan ??
        { file: sourcePackage, start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } },
      message: `Presentation asset ${decision.missingAsset ?? '(unidentified)'} replaced by ${decision.fallbackAsset}.`,
      reason:
        `定义 ${decision.definitionId} 的表现资源 ` +
        `${decision.missingAsset === null ? '（已损坏且无法识别原标识）' : decision.missingAsset} 不可用，` +
        `已改用类型兼容的替代资源 ${decision.fallbackAsset}。规则结果未受影响。`,
      correctionSuggestion: '若希望显示原本的素材，请补齐缺失的资源文件后重新提交候选。',
      expected: decision.missingAsset,
      actual: decision.fallbackAsset,
    }),
  );

  return ugcOk({
    candidate: resolvedCandidate,
    decisions: Object.freeze(decisions),
    warnings: Object.freeze(warnings),
  });
}

/** 语义损坏一律 error，且**不**复制旧值、不发明默认值、不丢弃规则（需求 10.2、10.3）。 */
function semanticDamage(
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
  gap: PresentationGap,
  reason: string,
): Diagnostic {
  return factory.definition({
    selector: { category: 'SCHEMA_CONTRACT', condition: 'semantic-field-damaged' },
    stage: STAGE,
    sourcePackage,
    definitionId: gap.definitionId,
    jsonPath: gap.jsonPath,
    sourceSpan:
      gap.sourceSpan ?? { file: sourcePackage, start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } },
    message: `Semantic field damaged at ${gap.jsonPath}.`,
    reason,
    correctionSuggestion: '请修正该字段的值；系统不会用旧值、默认值或替代项来掩盖语义问题。',
    actual: gap.missingAsset,
  });
}
