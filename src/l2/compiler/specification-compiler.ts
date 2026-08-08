/**
 * L2 Compiler: `Specification_Compiler.compile` 编排。
 *
 * 对应 Requirements 1.1–1.13、16.1–16.13 与 design.md `compileSource`。
 *
 * 输出语义（明确定义，避免下游误读）：
 * - `classifications`   与输入陈述 **1:1**，每条陈述恰有一个规范地位。
 * - `normativeContracts` 每个语义主张（claimKey）最多一条，来自优先级裁决。
 * - `unresolvedItems`   每个未决主张一条：同级实质冲突，或最高优先级陈述本身未决。
 * - `l3Profiles` / `historicalExamples` 按**陈述**登记的内容目录，供下游查询归属与来源。
 *
 * 铁律：低优先级示例不会生成基类层默认值；Q-01~Q-05 保持未决；D-009/D-010 编号复用不合并。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import type { Diagnostic } from '../model/diagnostic.js';
import { warningDiagnostic } from '../model/diagnostic-factory.js';
import type { SemanticFamilyRegistration } from '../model/definition.js';
import type { Result } from '../model/result.js';
import { ok } from '../model/result.js';
import { structuredRejection } from '../model/diagnostic-factory.js';
import { isErrorDiagnostic, isWarningDiagnostic } from '../model/diagnostic.js';
import type {
  HistoricalExampleEntry,
  L3ProfileEntry,
  NormativeContract,
  SourceRecord,
  SourceStatement,
  UnresolvedItem,
} from '../model/source.js';
import {
  canonicalSort,
  compareDiagnostics,
  compareSourceRecords,
  compareSourceStatements,
  compareStrings,
  fingerprint,
} from '../model/ordering.js';
import { classifyStatement } from './source-classifier.js';
import { decisionIdentifierReuseDiagnostics, resolveConflict } from './conflict-resolver.js';
import { isUnresolvedOutcome, type CompiledSpecification, type SourceClassificationOutcome } from './types.js';

/** 按语义主张键分组，组内按规范化顺序排列。 */
export function groupByClaimKey(
  statements: readonly SourceStatement[],
): readonly (readonly [string, readonly SourceStatement[]])[] {
  const groups = new Map<string, SourceStatement[]>();
  for (const statement of statements) {
    const bucket = groups.get(statement.claimKey);
    if (bucket === undefined) {
      groups.set(statement.claimKey, [statement]);
    } else {
      bucket.push(statement);
    }
  }
  return Object.freeze(
    [...groups.keys()]
      .sort(compareStrings)
      .map(
        (key) =>
          [key, Object.freeze(canonicalSort(groups.get(key)!, compareSourceStatements).slice())] as const,
      ),
  );
}

function dedupeRegistrations(
  outcomes: readonly SourceClassificationOutcome[],
): { readonly families: readonly SemanticFamilyRegistration[]; readonly diagnostics: readonly Diagnostic[] } {
  const byFamily = new Map<string, SemanticFamilyRegistration[]>();
  for (const outcome of outcomes) {
    const registration = outcome.registration;
    if (registration === undefined) {
      continue;
    }
    const bucket = byFamily.get(registration.familyId);
    if (bucket === undefined) {
      byFamily.set(registration.familyId, [registration]);
    } else {
      bucket.push(registration);
    }
  }

  const families: SemanticFamilyRegistration[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const familyId of [...byFamily.keys()].sort(compareStrings)) {
    const registrations = byFamily.get(familyId)!;
    const distinct = new Set(registrations.map((registration) => fingerprint(registration)));
    const sorted = canonicalSort(registrations, (left, right) =>
      compareSourceRecords(left.sourceRecords[0]!, right.sourceRecords[0]!),
    );
    families.push(sorted[0]!);
    if (distinct.size > 1) {
      diagnostics.push(
        warningDiagnostic({
          code: DIAGNOSTIC_CODES.FAMILY_DUPLICATE_REGISTRATION,
          reason:
            `语义族 ${familyId} 收到 ${distinct.size} 份内容不同的登记体，` +
            '已按来源优先级选取其中一份，其余保留为追踪信息。',
          correctionSuggestion: '统一该语义族的三判据理由与来源记录，避免同一族出现多份互不一致的登记。',
          sourceLocation: sorted[0]!.sourceRecords[0]!.sourceLocation,
          relatedSources: sorted.flatMap((registration) => registration.sourceRecords),
        }),
      );
    }
  }
  return { families: Object.freeze(families), diagnostics: Object.freeze(diagnostics) };
}

function buildUnresolvedFromStatements(
  claimKey: string,
  statements: readonly SourceStatement[],
  reason: string,
  awaitingDecisionId?: string,
): UnresolvedItem {
  const sources = canonicalSort(
    statements.map((statement) => statement.record),
    compareSourceRecords,
  );
  return Object.freeze({
    claimKey,
    statements: Object.freeze(statements.slice()) as readonly SourceStatement[],
    sources: Object.freeze(sources.slice()) as readonly SourceRecord[],
    reason,
    ...(awaitingDecisionId === undefined ? {} : { awaitingDecisionId }),
  }) as UnresolvedItem;
}

/**
 * 编译规范来源。
 *
 * 返回拒绝的情形：任一分类产生了 Error_Diagnostic
 * （废案机制被提议为规范契约、无来源支撑的规范常量、未通过三判据的新族、
 * 未决项被提议晋升、纯表现内容被提议为规范契约、规范契约缺乏权威来源等）。
 * 此时不产生任何 `Compiled_Specification`，避免半成品规范模型流入验证器。
 */
export function compile(statements: readonly SourceStatement[]): Result<CompiledSpecification> {
  const diagnostics: Diagnostic[] = [];

  const outcomes = canonicalSort(
    statements.map((statement) => classifyStatement(statement)),
    (left, right) => compareSourceStatements(left.statement, right.statement),
  );
  for (const outcome of outcomes) {
    diagnostics.push(...outcome.diagnostics);
  }

  const classificationByStatement = new Map<SourceStatement, SourceClassificationOutcome>(
    outcomes.map((outcome) => [outcome.statement, outcome] as const),
  );

  const normativeContracts: NormativeContract[] = [];
  const unresolvedItems: UnresolvedItem[] = [];

  for (const [claimKey, group] of groupByClaimKey(statements)) {
    const resolution = resolveConflict(group);
    diagnostics.push(...resolution.diagnostics);

    if (isUnresolvedOutcome(resolution.outcome)) {
      unresolvedItems.push(resolution.outcome);
      continue;
    }

    const selected = resolution.outcome.statement;
    const selectedClassification = classificationByStatement.get(selected)?.classification;

    if (selectedClassification === 'Normative_Contract') {
      normativeContracts.push(resolution.outcome);
      continue;
    }

    diagnostics.push(
      warningDiagnostic({
        code: DIAGNOSTIC_CODES.SOURCE_CONTRACT_WITHHELD,
        reason:
          `语义主张 ${claimKey} 的最高优先级陈述被分类为 ${String(selectedClassification)}，` +
          '因此不生成基类层规范契约。',
        correctionSuggestion:
          '若该主张应成为基类层契约，请提供更高优先级的权威决策；低优先级或非规范来源不能生成默认契约。',
        sourceLocation: selected.record.sourceLocation,
        relatedSources: [selected.record],
      }),
    );

    if (selectedClassification === 'Unresolved_Item') {
      unresolvedItems.push(
        buildUnresolvedFromStatements(
          claimKey,
          group,
          '最高优先级陈述本身处于未决状态。',
          selected.record.decisionId,
        ),
      );
    }
  }

  const l3Profiles: L3ProfileEntry[] = [];
  const historicalExamples: HistoricalExampleEntry[] = [];
  for (const outcome of outcomes) {
    if (outcome.classification === 'L3_Profile') {
      l3Profiles.push(
        Object.freeze({
          claimKey: outcome.claimKey,
          statement: outcome.statement,
          sources: Object.freeze([outcome.statement.record]) as readonly SourceRecord[],
        }) as L3ProfileEntry,
      );
    } else if (outcome.classification === 'Historical_Example') {
      historicalExamples.push(
        Object.freeze({
          claimKey: outcome.claimKey,
          statement: outcome.statement,
          sources: Object.freeze([outcome.statement.record]) as readonly SourceRecord[],
        }) as HistoricalExampleEntry,
      );
    }
  }

  diagnostics.push(...decisionIdentifierReuseDiagnostics(statements));

  const registrations = dedupeRegistrations(outcomes);
  diagnostics.push(...registrations.diagnostics);

  const sortedDiagnostics = Object.freeze(canonicalSort(diagnostics, compareDiagnostics).slice());
  const sourceRecords = Object.freeze(
    canonicalSort(
      statements.map((statement) => statement.record),
      compareSourceRecords,
    ).slice(),
  );

  if (sortedDiagnostics.some(isErrorDiagnostic)) {
    return structuredRejection(sortedDiagnostics, fingerprint({ sourceRecords }));
  }

  const body = {
    normativeContracts: Object.freeze(
      canonicalSort(normativeContracts, (left, right) => compareStrings(left.claimKey, right.claimKey)).slice(),
    ) as readonly NormativeContract[],
    l3Profiles: Object.freeze(
      canonicalSort(l3Profiles, (left, right) =>
        compareSourceStatements(left.statement, right.statement),
      ).slice(),
    ) as readonly L3ProfileEntry[],
    historicalExamples: Object.freeze(
      canonicalSort(historicalExamples, (left, right) =>
        compareSourceStatements(left.statement, right.statement),
      ).slice(),
    ) as readonly HistoricalExampleEntry[],
    unresolvedItems: Object.freeze(
      canonicalSort(unresolvedItems, (left, right) => compareStrings(left.claimKey, right.claimKey)).slice(),
    ) as readonly UnresolvedItem[],
    registeredFamilies: registrations.families,
    classifications: Object.freeze(outcomes.slice()) as readonly SourceClassificationOutcome[],
    sourceRecords,
    diagnostics: sortedDiagnostics,
  };

  const compiled: CompiledSpecification = Object.freeze({
    ...body,
    fingerprint: fingerprint({
      normativeContracts: body.normativeContracts.map((contract) => contract.claimKey),
      l3Profiles: body.l3Profiles.map((entry) => entry.statement.record.statementFingerprint),
      historicalExamples: body.historicalExamples.map((entry) => entry.statement.record.statementFingerprint),
      unresolvedItems: body.unresolvedItems.map((item) => item.claimKey),
      registeredFamilies: body.registeredFamilies.map((family) => family.familyId),
      diagnostics: body.diagnostics,
    }),
  });

  return ok(compiled, sortedDiagnostics.filter(isWarningDiagnostic));
}
