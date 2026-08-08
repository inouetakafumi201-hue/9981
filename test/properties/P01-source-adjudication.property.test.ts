// Feature: l2-base-layer-spec, Property 1: 来源裁决不产生隐式结论
//
// 性质原文（design.md「Correctness Properties / Property 1」）：
//   For any set of source statements representing one 语义主张，跨优先级冲突必须选择最高优先级
//   陈述并诊断每个被替代项；同优先级实质冲突必须完整保留为一个 `Unresolved_Item`、产生追踪诊断
//   且不生成受影响的默认契约。相同决策编号的不同来源陈述仍必须保留为不同 `Source_Record`。
//
// Validates: Requirements 1.1
// Additional coverage: Requirements 1.2–1.5, 1.10–1.12, 15.12, 16.1, 16.9–16.11
//
// 被测实现：src/l2/compiler/{specification-compiler,conflict-resolver,source-classifier}.ts
// 状态：运行中（Specification_Compiler 已完整实现）。

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compile } from '../../src/l2/compiler/specification-compiler.js';
import {
  decisionIdentifierReuseDiagnostics,
  materiallyConflicts,
  resolveConflict,
  semanticFingerprintOf,
} from '../../src/l2/compiler/conflict-resolver.js';
import { INTERVIEW_FILE, L0_FILE } from '../../src/l2/compiler/decision-catalog.js';
import { isUnresolvedOutcome } from '../../src/l2/compiler/types.js';
import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { isErrorDiagnostic } from '../../src/l2/model/diagnostic.js';
import { isOk } from '../../src/l2/model/result.js';
import { precedenceRank, SOURCE_PRECEDENCE_ORDER } from '../../src/l2/model/source.js';
import type { SourcePrecedence, SourceRecord, SourceStatement } from '../../src/l2/model/source.js';

/** 权威优先级上限：只有该级别及以上可独立支撑规范契约（source-classifier 的同名判定）。 */
const AUTHORITATIVE_LIMIT = precedenceRank('finalized-l2-contract');

interface StatementDraft {
  readonly precedence: SourcePrecedence;
  /** 语义负载变体号：变体号不同即构成实质冲突（conflict-resolver 用 payload 指纹判定）。 */
  readonly payloadVariant: number;
  readonly sectionOrdinal: number;
}

/**
 * 构造一条生成的来源陈述。
 *
 * 生成器刻意不触发任何 Error 路径（无标记、无废案、无表现内容、无玩法耦合、无数值示例、
 * 无决策编号），使 `compile` 的输出结构本身成为被观察对象；否则编译会因分类 Error 直接拒绝，
 * 裁决结构就无法被检查。分类按"优先级是否足以支撑规范契约"派生，避免制造
 * `SOURCE_MISSING_AUTHORITATIVE_RECORD` 噪声。
 */
function makeStatement(claimKey: string, index: number, draft: StatementDraft): SourceStatement {
  const authoritative = precedenceRank(draft.precedence) <= AUTHORITATIVE_LIMIT;
  const sourceFile = `docs/generated/p01-source-${index}.md`;
  const record: SourceRecord = {
    sourceFile,
    sourceLocation: { sourceFile, section: `generated-section-${draft.sectionOrdinal}-${index}` },
    precedence: draft.precedence,
    classification: authoritative ? 'Normative_Contract' : 'Unresolved_Item',
    owningLayer: '基类层',
    statementFingerprint: `generated:${claimKey}:${index}`,
  };
  return {
    claimKey,
    text: `generated claim ${claimKey} variant ${draft.payloadVariant}`,
    record,
    markers: [],
    deprecatedMechanic: false,
    declaredMechanics: [],
    gameplayProfileCoupled: false,
    presentationOnly: false,
    numericExamples: [],
    payload: { variant: draft.payloadVariant },
  };
}

/**
 * D-009 的两条来源陈述：L0 的锁定术语条目与访谈记录的格挡/隐蔽玩法条目。
 * 二者共用决策编号但语义不同，按 Requirements 1.10、1.12 必须保持为独立 Source_Record。
 * 声明分类与 `decision-catalog.ts` 的固定地位一致，避免产生分类不一致诊断。
 */
const D009_L0_STATEMENT: SourceStatement = {
  claimKey: 'd-009@l0-terminology',
  text: 'L0 决策索引 D-009：锁定术语条目。',
  record: {
    sourceFile: L0_FILE,
    sourceLocation: { sourceFile: L0_FILE, section: '决策索引 D-009（锁定术语）' },
    precedence: 'l0-constitution',
    decisionId: 'D-009',
    classification: 'Normative_Contract',
    owningLayer: '基类层',
    statementFingerprint: 'l0:d-009:terminology-lock',
  },
  markers: [],
  deprecatedMechanic: false,
  declaredMechanics: [],
  gameplayProfileCoupled: false,
  presentationOnly: false,
  numericExamples: [],
  payload: { entry: 'terminology-lock' },
};

const D009_INTERVIEW_STATEMENT: SourceStatement = {
  claimKey: 'd-009@interview-blocking-hiding',
  text: '访谈记录 D-009：格挡与隐蔽玩法规则。',
  record: {
    sourceFile: INTERVIEW_FILE,
    sourceLocation: { sourceFile: INTERVIEW_FILE, section: 'D-009（格挡 / 隐蔽规则）' },
    precedence: 'confirmed-interview-decision',
    decisionId: 'D-009',
    classification: 'L3_Profile',
    owningLayer: '玩法层',
    statementFingerprint: 'interview:d-009:blocking-and-hiding',
  },
  markers: [],
  deprecatedMechanic: false,
  declaredMechanics: [],
  gameplayProfileCoupled: false,
  presentationOnly: false,
  numericExamples: [],
  payload: { entry: 'blocking-and-hiding-rules' },
};

const arbDraft: fc.Arbitrary<StatementDraft> = fc.record({
  precedence: fc.constantFrom(...SOURCE_PRECEDENCE_ORDER),
  payloadVariant: fc.integer({ min: 0, max: 2 }),
  sectionOrdinal: fc.integer({ min: 0, max: 3 }),
});

describe('Property 1: 来源裁决不产生隐式结论', () => {
  it('跨优先级裁决、同级冲突保留、决策编号不合并（fast-check，100 次生成）', () => {
    fc.assert(
      fc.property(
        fc.array(arbDraft, { minLength: 1, maxLength: 5 }),
        fc.constantFrom('claim-alpha', 'claim-beta'),
        (drafts, claimKey) => {
          const group = drafts.map((draft, index) => makeStatement(claimKey, index, draft));

          const bestRank = Math.min(...group.map((s) => precedenceRank(s.record.precedence)));
          const highest = group.filter((s) => precedenceRank(s.record.precedence) === bestRank);
          const conflicting = materiallyConflicts(highest);

          // ── 1. resolveConflict：优先级裁决与同级冲突保留 ───────────────────────
          const resolution = resolveConflict(group);
          expect(resolution.claimKey).toBe(claimKey);
          // 裁决本身不产生 Error：冲突保留是追踪行为，不是候选错误。
          expect(resolution.diagnostics.some(isErrorDiagnostic)).toBe(false);
          expect(isUnresolvedOutcome(resolution.outcome)).toBe(conflicting);

          const resolutionCodes = resolution.diagnostics.map((d) => d.code);

          if (isUnresolvedOutcome(resolution.outcome)) {
            const unresolved = resolution.outcome;
            // 全部最高优先级陈述被完整保留，一条不少。
            expect([...unresolved.statements].map((s) => s.record.statementFingerprint).sort()).toEqual(
              [...highest].map((s) => s.record.statementFingerprint).sort(),
            );
            expect(unresolved.sources).toHaveLength(highest.length);
            expect(resolutionCodes).toContain(DIAGNOSTIC_CODES.SOURCE_SAME_PRECEDENCE_CONFLICT);
            // 受影响契约被扣留：不生成任何默认结论。
            expect(resolutionCodes).toContain(DIAGNOSTIC_CODES.SOURCE_CONTRACT_WITHHELD);
            // 未经裁决就不存在"被替代"，不得出现替代诊断。
            expect(resolutionCodes).not.toContain(DIAGNOSTIC_CODES.SOURCE_DISPLACED_BY_HIGHER_PRECEDENCE);
          } else {
            const contract = resolution.outcome;
            // 被选中的陈述必须处于最高优先级。
            expect(precedenceRank(contract.authoritativeSource.precedence)).toBe(bestRank);
            expect(contract.authoritativeSource).toBe(contract.statement.record);

            // 每个被替代项恰有一条替代诊断；同级且语义相同的重复陈述不算被替代。
            const displaced = group.filter(
              (s) =>
                s !== contract.statement &&
                !(
                  precedenceRank(s.record.precedence) === bestRank &&
                  semanticFingerprintOf(s) === semanticFingerprintOf(contract.statement)
                ),
            );
            const displacementDiagnostics = resolution.diagnostics.filter(
              (d) => d.code === DIAGNOSTIC_CODES.SOURCE_DISPLACED_BY_HIGHER_PRECEDENCE,
            );
            expect(displacementDiagnostics).toHaveLength(displaced.length);
            for (const statement of displaced) {
              expect(
                displacementDiagnostics.some(
                  (d) => d.sourceLocation?.section === statement.record.sourceLocation.section,
                ),
              ).toBe(true);
              // 替代诊断必须同时标明被替代者与控制性来源。
              expect(
                displacementDiagnostics.some(
                  (d) =>
                    d.relatedSources.some((r) => r === statement.record) &&
                    d.relatedSources.some((r) => r === contract.authoritativeSource),
                ),
              ).toBe(true);
            }
          }

          // ── 2. compile：编译级输出不产生隐式结论 ─────────────────────────────
          const statements = [...group, D009_L0_STATEMENT, D009_INTERVIEW_STATEMENT];
          const compiled = compile(statements);
          expect(compiled.rejected).toBe(false);
          if (!isOk(compiled)) {
            return;
          }
          const spec = compiled.value;

          // 零合并：每条输入陈述的 Source_Record 都被独立保留（Requirements 16.10）。
          expect(spec.sourceRecords).toHaveLength(statements.length);
          expect(new Set(spec.sourceRecords.map((r) => r.statementFingerprint)).size).toBe(
            new Set(statements.map((s) => s.record.statementFingerprint)).size,
          );

          // 每条陈述恰有一个规范地位（Requirements 16.1）。
          expect(spec.classifications).toHaveLength(statements.length);

          const authoritativeSelection = bestRank <= AUTHORITATIVE_LIMIT;
          if (conflicting) {
            // 同级实质冲突：无契约、有未决项、全部陈述在内。
            expect(spec.normativeContracts.some((c) => c.claimKey === claimKey)).toBe(false);
            const item = spec.unresolvedItems.find((u) => u.claimKey === claimKey);
            expect(item).toBeDefined();
            expect(item?.statements).toHaveLength(highest.length);
          } else if (authoritativeSelection) {
            const contract = spec.normativeContracts.find((c) => c.claimKey === claimKey);
            expect(contract).toBeDefined();
            expect(precedenceRank(contract!.authoritativeSource.precedence)).toBe(bestRank);
            expect(spec.unresolvedItems.some((u) => u.claimKey === claimKey)).toBe(false);
          } else {
            // 最高优先级陈述本身不足以支撑契约：扣留契约并记为未决，不给默认值。
            expect(spec.normativeContracts.some((c) => c.claimKey === claimKey)).toBe(false);
            expect(spec.unresolvedItems.some((u) => u.claimKey === claimKey)).toBe(true);
            expect(spec.diagnostics.map((d) => d.code)).toContain(
              DIAGNOSTIC_CODES.SOURCE_CONTRACT_WITHHELD,
            );
          }

          // 未决主张与规范契约互斥：不存在"既未决又有默认契约"的主张。
          for (const item of spec.unresolvedItems) {
            expect(spec.normativeContracts.some((c) => c.claimKey === item.claimKey)).toBe(false);
          }

          // 每个规范契约都有权威来源记录（Requirements 16.9）。
          for (const contract of spec.normativeContracts) {
            expect(precedenceRank(contract.authoritativeSource.precedence)).toBeLessThanOrEqual(
              AUTHORITATIVE_LIMIT,
            );
          }

          // ── 3. 决策编号复用：D-009 两条陈述不合并 ────────────────────────────
          const d009Records = spec.sourceRecords.filter((r) => r.decisionId === 'D-009');
          expect(d009Records).toHaveLength(2);
          expect(new Set(d009Records.map((r) => r.sourceFile))).toEqual(
            new Set([L0_FILE, INTERVIEW_FILE]),
          );
          expect(spec.normativeContracts.some((c) => c.claimKey === 'd-009@l0-terminology')).toBe(true);
          expect(spec.l3Profiles.some((e) => e.claimKey === 'd-009@interview-blocking-hiding')).toBe(
            true,
          );

          const reuseDiagnostics = decisionIdentifierReuseDiagnostics(statements).filter(
            (d) => d.code === DIAGNOSTIC_CODES.SOURCE_DECISION_ID_REUSE,
          );
          expect(reuseDiagnostics).toHaveLength(1);
          expect([...reuseDiagnostics[0]!.relatedSources].map((r) => r.sourceFile).sort()).toEqual(
            [INTERVIEW_FILE, L0_FILE].sort(),
          );
          expect(spec.diagnostics.map((d) => d.code)).toContain(
            DIAGNOSTIC_CODES.SOURCE_DECISION_ID_REUSE,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
