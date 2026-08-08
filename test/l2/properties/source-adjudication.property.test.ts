/**
 * Feature: l2-base-layer-spec, Property 1: 来源裁决不产生隐式结论
 *
 * Validates Requirements 1.1–1.5, 1.10–1.12, 16.9–16.11.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { compile } from '../../../src/l2/compiler/specification-compiler.js';
import { resolveConflict } from '../../../src/l2/compiler/conflict-resolver.js';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import type { SourceStatement, SourcePrecedence } from '../../../src/l2/model/source.js';
import { SOURCE_PRECEDENCE_ORDER } from '../../../src/l2/model/source.js';

function statement(
  claimKey: string,
  precedence: SourcePrecedence,
  fingerprint: string,
  payloadTag: string,
): SourceStatement {
  return {
    claimKey,
    text: `陈述 ${fingerprint}`,
    record: {
      sourceFile: `docs/src-${fingerprint}.md`,
      sourceLocation: { sourceFile: `docs/src-${fingerprint}.md`, section: `s-${fingerprint}` },
      precedence,
      classification: 'Normative_Contract',
      owningLayer: '基类层',
      statementFingerprint: fingerprint,
    },
    markers: [],
    declaredMechanics: [],
    deprecatedMechanic: false,
    gameplayProfileCoupled: false,
    presentationOnly: false,
    numericExamples: [],
    payload: { tag: payloadTag },
  };
}

const arbPrecedence = fc.constantFrom<SourcePrecedence>(...SOURCE_PRECEDENCE_ORDER);

describe('Property 1: 来源裁决不产生隐式结论', () => {
  it('跨优先级冲突选最高优先级并为每个被替代者产生诊断', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbPrecedence, { minLength: 2, maxLength: 4 }),
        (precedences) => {
          const statements = precedences.map((precedence, index) =>
            statement('claim', precedence, `fp${index}`, `payload${index}`),
          );
          const resolution = resolveConflict(statements);
          // 不同 payload → 视优先级而定。取最高优先级组。
          const ranks = precedences.map((p) => SOURCE_PRECEDENCE_ORDER.indexOf(p));
          const best = Math.min(...ranks);
          const topCount = ranks.filter((r) => r === best).length;

          if (topCount === 1) {
            // 唯一最高优先级：产生规范契约，被替代者各有诊断。
            expect('statement' in resolution.outcome).toBe(true);
            const displaced = resolution.diagnostics.filter(
              (d) => d.code === DIAGNOSTIC_CODES.SOURCE_DISPLACED_BY_HIGHER_PRECEDENCE,
            );
            expect(displaced.length).toBe(statements.length - 1);
          } else {
            // 多个同为最高优先级且 payload 不同 → 未决项，无默认契约。
            expect('statements' in resolution.outcome).toBe(true);
            expect(
              resolution.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.SOURCE_SAME_PRECEDENCE_CONFLICT),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('同优先级实质冲突保留全部陈述为未决项且不生成默认契约', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (count) => {
        const statements = Array.from({ length: count }, (_, index) =>
          statement('claim', 'l0-constitution', `fp${index}`, `distinct${index}`),
        );
        const result = compile(statements);
        // 同级实质冲突 → 编译成功（只 Warning），但无规范契约、有未决项。
        if (!result.rejected) {
          expect(result.value.normativeContracts.length).toBe(0);
          expect(result.value.unresolvedItems.length).toBe(1);
          expect(result.value.unresolvedItems[0]!.statements.length).toBe(count);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('相同决策编号的不同语义陈述保留为独立来源且产生复用诊断', () => {
    const shared = 'D-009';
    const a = statement('claim-a', 'l0-constitution', 'l0-term', 'terminology');
    const b = statement('claim-b', 'confirmed-interview-decision', 'iv-block', 'blocking-rule');
    const withDecision = [a, b].map((s) => ({
      ...s,
      record: { ...s.record, decisionId: shared },
    }));
    const result = compile(withDecision);
    expect(result.rejected).toBe(false);
    if (!result.rejected) {
      expect(
        result.value.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.SOURCE_DECISION_ID_REUSE),
      ).toBe(true);
      // 两条来源记录都被保留。
      expect(result.value.sourceRecords.length).toBe(2);
    }
  });
});
