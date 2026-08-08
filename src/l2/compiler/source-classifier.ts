/**
 * L2 Compiler: 来源分类与三判据新语义族资格判定。
 *
 * 对应 Requirements 1.1–1.13、4.2–4.4、5.11–5.12、16.1–16.13 与
 * design.md `Specification_Compiler.classify` / `classifyProposedFamily`。
 *
 * 分类只依据以下确定性信号，**绝不依据名称**（Requirements 16.3）：
 * 1. 固定决策目录（requirements.md 直接规定的地位）
 * 2. 未决事项目录（L0 第七节 Q-01~Q-05）
 * 3. 废案清单命中（`declaredMechanics` / `deprecatedMechanic`，不扫描自由文本）
 * 4. 纯表现内容标记（UI mockup、动画时序、性能/预算/人员估算）
 * 5. 段落标记（示例 / 待定 / 占位 / 候选 / 未来 / 需专题讨论）
 * 6. 具体玩法 Profile 耦合
 * 7. 三判据资格（可枚举、可组合、不含具体玩法语义）
 * 8. 来源自称分类 + 来源优先级
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import type { Diagnostic } from '../model/diagnostic.js';
import { errorDiagnostic, warningDiagnostic } from '../model/diagnostic-factory.js';
import type { SemanticFamilyRegistration } from '../model/definition.js';
import type {
  EligibilityVerdict,
  FamilyEligibilityEvidence,
  NumericExample,
  OwningLayer,
  SourceClassificationKind,
  SourceMarker,
  SourceStatement,
} from '../model/source.js';
import { precedenceRank } from '../model/source.js';
import { canonicalSort, compareDiagnostics } from '../model/ordering.js';
import {
  findDecisionStatus,
  findUnresolvedQuestion,
  GLOSSARY_FILE,
} from './decision-catalog.js';
import {
  deprecationSourceRecord,
  findDeprecatedMechanic,
  type DeprecatedMechanicEntry,
} from './deprecated-mechanics.js';
import type { NumericExampleOutcome, SourceClassificationOutcome } from './types.js';

/**
 * 三判据判定（design.md `classifyProposedFamily`）。
 *
 * 三条全部成立才接受；任一不成立时列出失败判据，由调用方生成层级归属诊断。
 */
export function qualifyProposedFamily(evidence: FamilyEligibilityEvidence): EligibilityVerdict {
  const failed: ('enumerable' | 'composable' | 'gameplayIndependent')[] = [];
  if (!evidence.enumerable) {
    failed.push('enumerable');
  }
  if (!evidence.composable) {
    failed.push('composable');
  }
  if (!evidence.gameplayIndependent) {
    failed.push('gameplayIndependent');
  }
  return {
    conceptId: evidence.conceptId,
    accepted: failed.length === 0,
    failedCriteria: Object.freeze(failed) as readonly typeof failed[number][],
  };
}

/** 段落标记到规范分类的映射（Requirements 16.2）。 */
const MARKER_CLASSIFICATION: ReadonlyMap<SourceMarker, SourceClassificationKind> = new Map([
  ['待定', 'Unresolved_Item'],
  ['需专题讨论', 'Unresolved_Item'],
  ['示例', 'Historical_Example'],
  ['占位', 'Historical_Example'],
  ['候选', 'Historical_Example'],
  ['未来', 'Historical_Example'],
] as const);

/**
 * 标记分类：未决优先于历史示例。
 * 若同时出现"示例"与"待定"，保守取 `Unresolved_Item` —— 未决状态比历史示例更强，
 * 因为它会阻断受影响契约而不是仅仅拒绝成为默认。
 */
export function markerClassification(
  markers: readonly SourceMarker[],
): SourceClassificationKind | undefined {
  let result: SourceClassificationKind | undefined;
  for (const marker of markers) {
    const mapped = MARKER_CLASSIFICATION.get(marker);
    if (mapped === 'Unresolved_Item') {
      return 'Unresolved_Item';
    }
    if (mapped !== undefined) {
      result = mapped;
    }
  }
  return result;
}

/** 该陈述命中的废案条目。 */
export function collectDeprecatedMechanics(
  statement: SourceStatement,
): readonly DeprecatedMechanicEntry[] {
  const hits: DeprecatedMechanicEntry[] = [];
  for (const mechanic of statement.declaredMechanics) {
    const entry = findDeprecatedMechanic(mechanic);
    if (entry !== undefined) {
      hits.push(entry);
    }
  }
  return Object.freeze(hits);
}

/** 权威优先级：只有 L0、已确认访谈决策与 L1 边界可直接支撑规范契约。 */
const AUTHORITATIVE_PRECEDENCE_LIMIT = precedenceRank('finalized-l2-contract');

function isAuthoritativeForNormative(statement: SourceStatement): boolean {
  return precedenceRank(statement.record.precedence) <= AUTHORITATIVE_PRECEDENCE_LIMIT;
}

/**
 * 数值示例分类（Requirements 5.11–5.12）。
 *
 * 分类必须落在五类之一，且不得凭空补造：
 * - 被提议为规范常量但属于字符长度 / 容量 / 文件大小 / 测试次数且缺乏权威来源 → 拒绝并记为未决。
 * - 自称宪法常量必须有权威来源支撑。
 * - 自称结构边界必须有权威来源与结构理由。
 * - 未自称分类时：陈述本身未决 → 未决；带示例/占位标记 → 历史示例；
 *   玩家可见玩法数字 → 玩法层（Requirements 5.2）；其余 → 未决 + 未分类错误。
 *   最后一条刻意不给默认值：无法判定归属的数字必须由人裁决。
 */
export function classifyNumericExample(
  statement: SourceStatement,
  example: NumericExample,
  statementClassification: SourceClassificationKind,
): NumericExampleOutcome {
  const diagnostics: Diagnostic[] = [];
  const location = statement.record.sourceLocation;
  const related = [statement.record];

  if (example.proposedAsNormativeConstant && example.constantKind !== undefined && !example.authoritativeSupport) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.SOURCE_UNSUPPORTED_NORMATIVE_CONSTANT,
        reason:
          `字段 ${example.fieldName} 被提议为规范常量（类别 ${example.constantKind}，值 ${example.value}），` +
          '但没有任何权威来源支撑。Requirements 5.12 禁止把无来源支撑的实现常量晋升为规范常量。',
        correctionSuggestion:
          '提供权威来源记录后再提议该常量；否则把它保留为未决项，或改由玩法层 Profile 提供。',
        sourceLocation: location,
        relatedSources: related,
      }),
    );
    return { example, classification: 'Unresolved_Item', diagnostics: Object.freeze(diagnostics) };
  }

  if (example.proposedClassification === 'Constitutional_Constant') {
    if (!example.authoritativeSupport) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.SCHEMA_CONSTITUTIONAL_CONSTANT_MISSING_SOURCE,
          reason: `字段 ${example.fieldName} 自称宪法常量，但缺少权威来源支撑。`,
          correctionSuggestion: '补充 L0 来源标识、归属层与适用字段，或改为其他分类。',
          sourceLocation: location,
          relatedSources: related,
        }),
      );
      return { example, classification: 'Unresolved_Item', diagnostics: Object.freeze(diagnostics) };
    }
    return { example, classification: 'Constitutional_Constant', diagnostics: Object.freeze(diagnostics) };
  }

  if (example.proposedClassification === 'Structural_Bound') {
    const missing: string[] = [];
    if (!example.authoritativeSupport) {
      missing.push('权威来源');
    }
    if (example.structuralRationale === undefined || example.structuralRationale.trim().length === 0) {
      missing.push('结构理由');
    }
    if (missing.length > 0) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_SOURCE,
          reason: `字段 ${example.fieldName} 自称结构边界，但缺少 ${missing.join(' 与 ')}。`,
          correctionSuggestion: '补充权威 Source_Record 与结构理由（Requirements 5.3），或改为其他分类。',
          sourceLocation: location,
          relatedSources: related,
        }),
      );
      return { example, classification: 'Unresolved_Item', diagnostics: Object.freeze(diagnostics) };
    }
    return { example, classification: 'Structural_Bound', diagnostics: Object.freeze(diagnostics) };
  }

  if (example.proposedClassification === 'L3_Profile' || example.proposedClassification === 'Historical_Example') {
    return { example, classification: example.proposedClassification, diagnostics: Object.freeze(diagnostics) };
  }

  if (example.proposedClassification === 'Unresolved_Item' || statementClassification === 'Unresolved_Item') {
    return { example, classification: 'Unresolved_Item', diagnostics: Object.freeze(diagnostics) };
  }

  if (statementClassification === 'Historical_Example') {
    return { example, classification: 'Historical_Example', diagnostics: Object.freeze(diagnostics) };
  }

  if (example.playerVisible) {
    return { example, classification: 'L3_Profile', diagnostics: Object.freeze(diagnostics) };
  }

  diagnostics.push(
    errorDiagnostic({
      code: DIAGNOSTIC_CODES.SOURCE_NUMERIC_EXAMPLE_UNCLASSIFIED,
      reason:
        `字段 ${example.fieldName} 的数值 ${example.value} 没有可判定的规范分类：` +
        '既未自称分类，也不满足未决 / 历史示例 / 玩家可见玩法数值中的任一情形。',
      correctionSuggestion:
        '显式声明该数字属于结构边界、宪法常量、玩法层数值、历史示例还是未决项（Requirements 5.11）。',
      sourceLocation: location,
      relatedSources: related,
    }),
  );
  return { example, classification: 'Unresolved_Item', diagnostics: Object.freeze(diagnostics) };
}

/** 分类依据，用于诊断说明与测试断言。 */
export const CLASSIFICATION_BASES = [
  'decision-catalog',
  'unresolved-question',
  'deprecated-mechanic',
  'presentation-only',
  'source-marker',
  'gameplay-profile-coupling',
  'family-eligibility',
  'declared-classification',
] as const;

export type ClassificationBasis = (typeof CLASSIFICATION_BASES)[number];

interface ClassificationDecision {
  readonly classification: SourceClassificationKind;
  readonly owningLayer: OwningLayer;
  readonly basis: ClassificationBasis;
}

function decideClassification(
  statement: SourceStatement,
  deprecated: readonly DeprecatedMechanicEntry[],
  verdict: EligibilityVerdict | undefined,
): ClassificationDecision {
  const record = statement.record;
  const catalogEntry = findDecisionStatus(record.decisionId, record.sourceFile);
  if (catalogEntry !== undefined) {
    return {
      classification: catalogEntry.classification,
      owningLayer: catalogEntry.owningLayer,
      basis: 'decision-catalog',
    };
  }
  if (findUnresolvedQuestion(record.decisionId) !== undefined) {
    return { classification: 'Unresolved_Item', owningLayer: record.owningLayer, basis: 'unresolved-question' };
  }
  if (deprecated.length > 0 || statement.deprecatedMechanic) {
    return {
      classification: 'Historical_Example',
      owningLayer: record.owningLayer,
      basis: 'deprecated-mechanic',
    };
  }
  if (statement.presentationOnly) {
    return {
      classification: 'Historical_Example',
      owningLayer: record.owningLayer,
      basis: 'presentation-only',
    };
  }
  const marker = markerClassification(statement.markers);
  if (marker !== undefined) {
    return { classification: marker, owningLayer: record.owningLayer, basis: 'source-marker' };
  }
  if (statement.gameplayProfileCoupled) {
    return { classification: 'L3_Profile', owningLayer: '玩法层', basis: 'gameplay-profile-coupling' };
  }
  if (verdict !== undefined && !verdict.accepted) {
    return { classification: 'L3_Profile', owningLayer: '玩法层', basis: 'family-eligibility' };
  }
  return {
    classification: record.classification,
    owningLayer: record.owningLayer,
    basis: 'declared-classification',
  };
}

const FAILED_CRITERION_CODE = {
  enumerable: DIAGNOSTIC_CODES.FAMILY_NOT_ENUMERABLE,
  composable: DIAGNOSTIC_CODES.FAMILY_NOT_COMPOSABLE,
  gameplayIndependent: DIAGNOSTIC_CODES.FAMILY_GAMEPLAY_DEPENDENT,
} as const;

const FAILED_CRITERION_TEXT = {
  enumerable: '在当前玩法范围内不可有限列举',
  composable: '不能与其他基类组合产生实例',
  gameplayIndependent: '依赖具体玩法 Profile',
} as const;

function eligibilityDiagnostics(
  statement: SourceStatement,
  evidence: FamilyEligibilityEvidence,
  verdict: EligibilityVerdict,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const location = statement.record.sourceLocation;
  const related = [statement.record, ...evidence.sources];

  for (const criterion of verdict.failedCriteria) {
    diagnostics.push(
      errorDiagnostic({
        code: FAILED_CRITERION_CODE[criterion],
        reason: `概念 ${evidence.conceptId} 不满足基类三判据：${FAILED_CRITERION_TEXT[criterion]}。`,
        correctionSuggestion:
          '三判据必须同时成立才能登记为基类层语义族；否则把该概念交给玩法层，或改为已有基类的组合实例。',
        sourceLocation: location,
        relatedSources: related,
      }),
    );
  }

  if (!verdict.accepted) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.LAYER_L3_OWNERSHIP,
        reason: `概念 ${evidence.conceptId} 未通过三判据，其归属层为玩法层而非基类层。`,
        correctionSuggestion: '在玩法层 Profile 中声明该概念，或先补足三判据证据再提议登记。',
        sourceLocation: location,
        relatedSources: related,
      }),
    );
    return Object.freeze(diagnostics);
  }

  const reasonsMissing =
    evidence.enumerationRationale.trim().length === 0 ||
    evidence.compositionRationale.trim().length === 0 ||
    evidence.independenceRationale.trim().length === 0;
  if (reasonsMissing) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.FAMILY_MISSING_CLASSIFICATION_REASON,
        reason: `概念 ${evidence.conceptId} 通过了三判据，但缺少完整的分类理由文本。`,
        correctionSuggestion: '为可枚举、可组合、不含具体玩法语义三条各提供一段分类理由。',
        sourceLocation: location,
        relatedSources: related,
      }),
    );
  }
  if (evidence.sources.length === 0) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.DEF_MISSING_SOURCE_RECORD,
        reason: `概念 ${evidence.conceptId} 的语义族登记缺少 Source_Record。`,
        correctionSuggestion: '为新语义族登记至少一条权威 Source_Record（Requirements 4.3、16.9）。',
        sourceLocation: location,
        relatedSources: [statement.record],
      }),
    );
  }
  return Object.freeze(diagnostics);
}

/**
 * 分类一条来源陈述。
 *
 * 输出恰好一个规范地位；所有降级、拒绝与追踪理由都以诊断形式给出，
 * 不存在"静默改写分类"的路径。
 */
export function classifyStatement(statement: SourceStatement): SourceClassificationOutcome {
  const diagnostics: Diagnostic[] = [];
  const record = statement.record;
  const location = record.sourceLocation;
  const declared = record.classification;
  const proposedNormative = declared === 'Normative_Contract';

  const deprecated = collectDeprecatedMechanics(statement);
  const verdict = statement.eligibility === undefined ? undefined : qualifyProposedFamily(statement.eligibility);
  const decision = decideClassification(statement, deprecated, verdict);

  const catalogEntry = findDecisionStatus(record.decisionId, record.sourceFile);
  if (catalogEntry !== undefined && catalogEntry.classification !== declared) {
    const construct = proposedNormative ? errorDiagnostic : warningDiagnostic;
    diagnostics.push(
      construct({
        code: DIAGNOSTIC_CODES.SOURCE_CLASSIFICATION_MISMATCH,
        reason:
          `决策 ${catalogEntry.decisionId}（${catalogEntry.variantKey}）的固定地位为 ` +
          `${catalogEntry.classification}，但来源自称 ${declared}。需求条款：${catalogEntry.requirementRefs.join('、')}。`,
        correctionSuggestion: `把该来源的分类改为 ${catalogEntry.classification}；固定地位由需求文档规定，不可由来源自行改写。`,
        sourceLocation: location,
        relatedSources: [record],
      }),
    );
  }

  const unresolvedQuestion = findUnresolvedQuestion(record.decisionId);
  if (unresolvedQuestion !== undefined) {
    diagnostics.push(
      warningDiagnostic({
        code: DIAGNOSTIC_CODES.SOURCE_UNRESOLVED_ITEM_RETAINED,
        reason: `${unresolvedQuestion.decisionId} 尚无权威决策：${unresolvedQuestion.summary}`,
        correctionSuggestion: `保持未决状态；当前只保留接口：${unresolvedQuestion.retainedInterface}`,
        sourceLocation: location,
        relatedSources: [record],
      }),
    );
    if (proposedNormative) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.SOURCE_PROMOTION_REQUIRES_DECISION,
          reason: `${unresolvedQuestion.decisionId} 仍是未决项，不能被提议为基类层规范契约。`,
          correctionSuggestion: '先取得权威决策编号与 Source_Record，再把该项晋升为规范契约（Requirements 16.11）。',
          sourceLocation: location,
          relatedSources: [record],
        }),
      );
    }
  }

  for (const entry of deprecated) {
    const construct = proposedNormative ? errorDiagnostic : warningDiagnostic;
    diagnostics.push(
      construct({
        code: DIAGNOSTIC_CODES.SOURCE_DEPRECATED_MECHANIC,
        reason: `机制「${entry.mechanic}」在废案清单中被记录为${entry.status === 'vetoed' ? '否决' : '降级为可选内容'}：${entry.vetoReason}`,
        correctionSuggestion:
          entry.status === 'vetoed'
            ? '废案机制禁止作为基类层标准契约重新引入（Requirements 16.7–16.8）。'
            : '该机制只能作为可选玩法层内容，不得进入基类层标配契约。',
        sourceLocation: location,
        relatedSources: [record, deprecationSourceRecord(entry)],
      }),
    );
  }

  if (deprecated.length === 0 && statement.deprecatedMechanic) {
    const construct = proposedNormative ? errorDiagnostic : warningDiagnostic;
    diagnostics.push(
      construct({
        code: DIAGNOSTIC_CODES.SOURCE_DEPRECATED_MECHANIC,
        reason: '该来源陈述被标注为废案内容，但未声明具体机制名，无法与废案清单条目对应。',
        correctionSuggestion: `在 declaredMechanics 中写出机制名，使其可与 ${GLOSSARY_FILE} 的废案清单条目一一对应。`,
        sourceLocation: location,
        relatedSources: [record],
      }),
    );
  }

  if (statement.presentationOnly) {
    const construct = proposedNormative ? errorDiagnostic : warningDiagnostic;
    diagnostics.push(
      construct({
        code: DIAGNOSTIC_CODES.SOURCE_PRESENTATION_ONLY_EXCLUDED,
        reason:
          '该来源属于纯表现内容（UI mockup、动画时序、性能/预算/人员估算），' +
          '按 Requirements 16.5 不进入基类层语义契约。',
        correctionSuggestion: '把该内容留在表现层或项目管理文档中；不要在基类层声明它。',
        sourceLocation: location,
        relatedSources: [record],
      }),
    );
  }

  const marker = markerClassification(statement.markers);
  if (marker !== undefined && catalogEntry === undefined) {
    const construct = proposedNormative ? errorDiagnostic : warningDiagnostic;
    diagnostics.push(
      construct({
        code: DIAGNOSTIC_CODES.SOURCE_MARKER_BLOCKS_DEFAULT,
        reason: `该来源带有标记「${statement.markers.join('、')}」，在没有更高优先级决策前不能成为基类层默认。`,
        correctionSuggestion: '取得更高优先级决策后再晋升；在此之前保持历史示例或未决状态（Requirements 16.2）。',
        sourceLocation: location,
        relatedSources: [record],
      }),
    );
  }

  if (statement.gameplayProfileCoupled) {
    const construct = proposedNormative ? errorDiagnostic : warningDiagnostic;
    diagnostics.push(
      construct({
        code: DIAGNOSTIC_CODES.SOURCE_GAMEPLAY_COUPLED_TO_L3,
        reason: '该来源与具体玩法 Profile 耦合，其归属层为玩法层（Requirements 16.3–16.4）。',
        correctionSuggestion: '把具体玩法内容放入玩法层 Profile；基类层只保留可复用的语义接口。',
        sourceLocation: location,
        relatedSources: [record],
      }),
    );
  }

  let registration: SemanticFamilyRegistration | undefined;
  if (statement.eligibility !== undefined && verdict !== undefined) {
    const evidence = statement.eligibility;
    diagnostics.push(...eligibilityDiagnostics(statement, evidence, verdict));
    if (verdict.accepted) {
      registration = Object.freeze({
        familyId: evidence.conceptId,
        classificationReason: [
          `可枚举：${evidence.enumerationRationale}`,
          `可组合：${evidence.compositionRationale}`,
          `不含具体玩法语义：${evidence.independenceRationale}`,
        ].join(' | '),
        eligibility: evidence,
        sourceRecords: Object.freeze([record, ...evidence.sources]) as readonly typeof record[],
      }) as SemanticFamilyRegistration;
    }
  }

  if (decision.classification === 'Normative_Contract' && !isAuthoritativeForNormative(statement)) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.SOURCE_MISSING_AUTHORITATIVE_RECORD,
        reason:
          `该陈述被判定为规范契约，但其来源优先级为 ${record.precedence}，` +
          '不足以独立支撑基类层规范契约（Requirements 16.9）。',
        correctionSuggestion:
          '为该契约提供 L0、已确认访谈决策、L1 边界或 L2 定稿契约级别的权威来源，或保留为未决项。',
        sourceLocation: location,
        relatedSources: [record],
      }),
    );
  }

  const numericOutcomes = statement.numericExamples.map((example) =>
    classifyNumericExample(statement, example, decision.classification),
  );
  for (const outcome of numericOutcomes) {
    diagnostics.push(...outcome.diagnostics);
  }

  const outcome: SourceClassificationOutcome = {
    claimKey: statement.claimKey,
    statement,
    classification: decision.classification,
    owningLayer: decision.owningLayer,
    numericOutcomes: Object.freeze(numericOutcomes) as readonly NumericExampleOutcome[],
    diagnostics: Object.freeze(canonicalSort(diagnostics, compareDiagnostics).slice()),
    ...(verdict === undefined ? {} : { eligibilityVerdict: verdict }),
    ...(registration === undefined ? {} : { registration }),
  };
  return Object.freeze(outcome);
}
