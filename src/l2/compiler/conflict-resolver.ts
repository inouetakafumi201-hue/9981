/**
 * L2 Compiler: 优先级裁决、同级冲突保留与决策编号复用追踪。
 *
 * 对应 Requirements 1.1–1.5、1.10–1.12、16.6、16.9–16.11 与
 * design.md `resolveConflict` / `compileSource`。
 *
 * 三条不可让步的规则：
 * 1. 跨优先级冲突选最高优先级陈述，并为**每个**被替代者产生诊断。
 * 2. 同优先级实质冲突把**全部**陈述保留为一个 `Unresolved_Item`，不生成任何默认契约。
 * 3. 同一决策编号的不同语义陈述**不合并**，只产生追踪诊断。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import type { Diagnostic } from '../model/diagnostic.js';
import { warningDiagnostic } from '../model/diagnostic-factory.js';
import type {
  NormativeContract,
  SourceRecord,
  SourceStatement,
  UnresolvedItem,
} from '../model/source.js';
import { precedenceRank } from '../model/source.js';
import {
  canonicalSort,
  compareDiagnostics,
  compareSourceRecords,
  compareSourceStatements,
  fingerprint,
} from '../model/ordering.js';
import { findUnresolvedQuestion } from './decision-catalog.js';
import type { ConflictResolution } from './types.js';

/**
 * 语义指纹：用于判断同优先级的两条陈述是否**实质**冲突。
 *
 * 优先使用结构化 `payload`（语义内容），缺省时退回 `text`。
 * 这样"同一结论的不同措辞"不会被误判为冲突，而"同一措辞下的不同结论"仍会被发现。
 */
export function semanticFingerprintOf(statement: SourceStatement): string {
  if (statement.payload !== undefined) {
    return fingerprint({ payload: statement.payload });
  }
  return fingerprint({ text: statement.text.trim().replace(/\s+/gu, ' ') });
}

/** 判断一组同优先级陈述是否实质冲突。 */
export function materiallyConflicts(statements: readonly SourceStatement[]): boolean {
  if (statements.length <= 1) {
    return false;
  }
  const first = semanticFingerprintOf(statements[0]!);
  return statements.some((statement) => semanticFingerprintOf(statement) !== first);
}

function highestPrecedenceGroup(statements: readonly SourceStatement[]): readonly SourceStatement[] {
  let best = Number.MAX_SAFE_INTEGER;
  for (const statement of statements) {
    const rank = precedenceRank(statement.record.precedence);
    if (rank < best) {
      best = rank;
    }
  }
  return statements.filter((statement) => precedenceRank(statement.record.precedence) === best);
}

/**
 * 裁决同一语义主张下的全部陈述。
 *
 * 输入必须是同一 `claimKey` 的陈述；调用方（`specification-compiler.ts`）负责分组。
 */
export function resolveConflict(statements: readonly SourceStatement[]): ConflictResolution {
  if (statements.length === 0) {
    throw new TypeError('resolveConflict 需要至少一条来源陈述');
  }
  const ordered = canonicalSort(statements, compareSourceStatements);
  const claimKey = ordered[0]!.claimKey;
  const diagnostics: Diagnostic[] = [];

  const highest = highestPrecedenceGroup(ordered);

  if (materiallyConflicts(highest)) {
    const sources = canonicalSort(
      highest.map((statement) => statement.record),
      compareSourceRecords,
    );
    const awaiting = highest
      .map((statement) => findUnresolvedQuestion(statement.record.decisionId)?.decisionId)
      .find((id): id is string => id !== undefined);

    diagnostics.push(
      warningDiagnostic({
        code: DIAGNOSTIC_CODES.SOURCE_SAME_PRECEDENCE_CONFLICT,
        reason:
          `语义主张 ${claimKey} 在同一优先级（${highest[0]!.record.precedence}）上存在 ${highest.length} 条实质冲突的陈述，` +
          '全部保留为一个未决项，不生成任何默认契约。',
        correctionSuggestion:
          '由权威决策裁决其中一条，或提高其中一条的来源优先级；在此之前不得由实现者自行选择结论（Requirements 1.4–1.5）。',
        sourceLocation: highest[0]!.record.sourceLocation,
        relatedSources: sources,
      }),
    );
    diagnostics.push(
      warningDiagnostic({
        code: DIAGNOSTIC_CODES.SOURCE_CONTRACT_WITHHELD,
        reason: `语义主张 ${claimKey} 的规范契约被扣留，直到未决冲突被权威决策解决（Requirements 1.5）。`,
        correctionSuggestion: '在冲突解决前，依赖该主张的基类层契约不得被推导或使用默认值。',
        sourceLocation: highest[0]!.record.sourceLocation,
        relatedSources: sources,
      }),
    );

    const unresolved: UnresolvedItem = Object.freeze({
      claimKey,
      statements: Object.freeze(highest.slice()) as readonly SourceStatement[],
      sources: Object.freeze(sources.slice()) as readonly SourceRecord[],
      reason: `同优先级实质冲突：${highest.length} 条陈述互不一致。`,
      ...(awaiting === undefined ? {} : { awaitingDecisionId: awaiting }),
    }) as UnresolvedItem;

    return {
      claimKey,
      outcome: unresolved,
      diagnostics: Object.freeze(canonicalSort(diagnostics, compareDiagnostics).slice()),
    };
  }

  const selected = highest[0]!;
  for (const displaced of ordered) {
    if (displaced === selected) {
      continue;
    }
    if (
      precedenceRank(displaced.record.precedence) === precedenceRank(selected.record.precedence) &&
      semanticFingerprintOf(displaced) === semanticFingerprintOf(selected)
    ) {
      // 同优先级且语义相同：不是被替代，只是重复陈述，无需替代诊断。
      continue;
    }
    diagnostics.push(
      warningDiagnostic({
        code: DIAGNOSTIC_CODES.SOURCE_DISPLACED_BY_HIGHER_PRECEDENCE,
        reason:
          `语义主张 ${claimKey} 的陈述（${displaced.record.sourceFile} / ${displaced.record.sourceLocation.section}，` +
          `优先级 ${displaced.record.precedence}）被更高优先级陈述` +
          `（${selected.record.sourceFile} / ${selected.record.sourceLocation.section}，优先级 ${selected.record.precedence}）替代。`,
        correctionSuggestion: '更新被替代的来源文档，或提升其优先级后重新裁决；低优先级来源不能覆盖高优先级来源。',
        sourceLocation: displaced.record.sourceLocation,
        relatedSources: [displaced.record, selected.record],
      }),
    );
  }

  const contract: NormativeContract = Object.freeze({
    claimKey,
    statement: selected,
    authoritativeSource: selected.record,
    owningLayer: selected.record.owningLayer,
  }) as NormativeContract;

  return {
    claimKey,
    outcome: contract,
    diagnostics: Object.freeze(canonicalSort(diagnostics, compareDiagnostics).slice()),
  };
}

/** 决策编号复用的一个变体。 */
export interface DecisionVariantObservation {
  readonly decisionId: string;
  readonly claimKey: string;
  readonly semanticFingerprint: string;
  readonly record: SourceRecord;
}

/**
 * 决策编号复用追踪（Requirements 1.10–1.12）。
 *
 * 同一 `decisionId` 若映射到不同语义陈述（不同主张键或不同语义指纹），
 * 产生追踪诊断并**保留全部独立 Source_Record**；绝不按编号合并。
 * D-009 与 D-010 在 L0 与访谈记录中的不同含义正是该规则的目标场景。
 */
export function decisionIdentifierReuseDiagnostics(
  statements: readonly SourceStatement[],
): readonly Diagnostic[] {
  const byDecision = new Map<string, DecisionVariantObservation[]>();
  for (const statement of statements) {
    const decisionId = statement.record.decisionId;
    if (decisionId === undefined) {
      continue;
    }
    const observation: DecisionVariantObservation = {
      decisionId,
      claimKey: statement.claimKey,
      semanticFingerprint: semanticFingerprintOf(statement),
      record: statement.record,
    };
    const bucket = byDecision.get(decisionId);
    if (bucket === undefined) {
      byDecision.set(decisionId, [observation]);
    } else {
      bucket.push(observation);
    }
  }

  const diagnostics: Diagnostic[] = [];
  for (const decisionId of [...byDecision.keys()].sort()) {
    const observations = byDecision.get(decisionId)!;
    const distinct = new Set(
      observations.map((observation) => `${observation.claimKey}::${observation.semanticFingerprint}`),
    );
    if (distinct.size <= 1) {
      continue;
    }
    const sources = canonicalSort(
      observations.map((observation) => observation.record),
      compareSourceRecords,
    );
    diagnostics.push(
      warningDiagnostic({
        code: DIAGNOSTIC_CODES.SOURCE_DECISION_ID_REUSE,
        reason:
          `决策编号 ${decisionId} 映射到 ${distinct.size} 条语义不同的来源陈述` +
          `（出现在 ${[...new Set(sources.map((record) => record.sourceFile))].join('、')}）。` +
          '按 Requirements 1.12 保留为彼此独立的 Source_Record，不合并。',
        correctionSuggestion:
          '为不同含义的条目分配不同决策编号，或在文档中显式区分变体；实现方不得用一个条目覆盖另一个条目。',
        sourceLocation: sources[0]!.sourceLocation,
        relatedSources: sources,
      }),
    );
  }
  return Object.freeze(canonicalSort(diagnostics, compareDiagnostics).slice());
}
