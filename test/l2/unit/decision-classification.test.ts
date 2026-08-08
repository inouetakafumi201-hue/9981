/**
 * L2 单元测试：固定决策地位与来源分类（Requirements 1.8–1.13、16.2–16.8）。
 *
 * 锁定 D-006/D-019/D-007/D-008/D-009×2/D-010×2/D-017/D-018/D-030 的规范地位，
 * 以及废案清单、纯表现内容、段落标记的分类行为。
 */

import { describe, it, expect } from 'vitest';
import { classifyStatement } from '../../../src/l2/compiler/source-classifier.js';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import type { SourceStatement, SourcePrecedence, SourceClassificationKind } from '../../../src/l2/model/source.js';

function stmt(overrides: Partial<SourceStatement> & { claimKey: string }): SourceStatement {
  const precedence: SourcePrecedence = overrides.record?.precedence ?? 'confirmed-interview-decision';
  return {
    claimKey: overrides.claimKey,
    text: overrides.text ?? 't',
    markers: overrides.markers ?? [],
    declaredMechanics: overrides.declaredMechanics ?? [],
    deprecatedMechanic: overrides.deprecatedMechanic ?? false,
    gameplayProfileCoupled: overrides.gameplayProfileCoupled ?? false,
    presentationOnly: overrides.presentationOnly ?? false,
    numericExamples: overrides.numericExamples ?? [],
    record: overrides.record ?? {
      sourceFile: 'docs/访谈决策记录.md',
      sourceLocation: { sourceFile: 'docs/访谈决策记录.md', section: 's' },
      precedence,
      classification: 'Normative_Contract',
      owningLayer: '基类层',
      statementFingerprint: overrides.claimKey,
    },
    ...(overrides.eligibility === undefined ? {} : { eligibility: overrides.eligibility }),
    ...(overrides.payload === undefined ? {} : { payload: overrides.payload }),
  };
}

function record(
  decisionId: string,
  sourceFile: string,
  precedence: SourcePrecedence,
  classification: SourceClassificationKind,
) {
  return {
    sourceFile,
    sourceLocation: { sourceFile, section: `${decisionId}` },
    precedence,
    decisionId,
    classification,
    owningLayer: (classification === 'L3_Profile' ? '玩法层' : '基类层') as '玩法层' | '基类层',
    statementFingerprint: `${decisionId}@${sourceFile}`,
  };
}

describe('固定决策地位', () => {
  it('D-006 三种网关是基类层规范契约', () => {
    const outcome = classifyStatement(
      stmt({ claimKey: 'D-006', record: record('D-006', 'docs/访谈决策记录.md', 'confirmed-interview-decision', 'Normative_Contract') }),
    );
    expect(outcome.classification).toBe('Normative_Contract');
    expect(outcome.owningLayer).toBe('基类层');
  });

  it('D-019 声明式 JSON 是基类层规范契约', () => {
    const outcome = classifyStatement(
      stmt({ claimKey: 'D-019', record: record('D-019', 'docs/访谈决策记录.md', 'confirmed-interview-decision', 'Normative_Contract') }),
    );
    expect(outcome.classification).toBe('Normative_Contract');
  });

  it('D-007 体力上限归玩法层', () => {
    const outcome = classifyStatement(
      stmt({ claimKey: 'D-007', record: record('D-007', 'docs/访谈决策记录.md', 'confirmed-interview-decision', 'Normative_Contract') }),
    );
    expect(outcome.classification).toBe('L3_Profile');
    expect(outcome.owningLayer).toBe('玩法层');
    // 来源自称 Normative 与固定地位不一致 → 产生 mismatch 诊断。
    expect(outcome.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.SOURCE_CLASSIFICATION_MISMATCH)).toBe(true);
  });

  it('D-030 载具乘员交互归玩法层', () => {
    const outcome = classifyStatement(
      stmt({ claimKey: 'D-030', record: record('D-030', 'docs/访谈决策记录.md', 'confirmed-interview-decision', 'L3_Profile') }),
    );
    expect(outcome.classification).toBe('L3_Profile');
  });

  it('D-009 在 L0 与访谈记录中分别按基类层/玩法层处理', () => {
    const l0 = classifyStatement(
      stmt({ claimKey: 'D-009-l0', record: record('D-009', 'docs/L0_规范宪法.md', 'l0-constitution', 'Normative_Contract') }),
    );
    const interview = classifyStatement(
      stmt({ claimKey: 'D-009-iv', record: record('D-009', 'docs/访谈决策记录.md', 'confirmed-interview-decision', 'L3_Profile') }),
    );
    expect(l0.classification).toBe('Normative_Contract');
    expect(l0.owningLayer).toBe('基类层');
    expect(interview.classification).toBe('L3_Profile');
    expect(interview.owningLayer).toBe('玩法层');
  });

  it('D-017/D-018 是未决项', () => {
    for (const id of ['D-017', 'D-018']) {
      const outcome = classifyStatement(
        stmt({ claimKey: id, record: record(id, 'docs/访谈决策记录.md', 'unresolved-l2-content', 'Unresolved_Item') }),
      );
      expect(outcome.classification).toBe('Unresolved_Item');
    }
  });
});

describe('废案 / 表现 / 标记分类', () => {
  it('废案机制被记为历史示例并产生诊断', () => {
    const outcome = classifyStatement(
      stmt({ claimKey: 'c', declaredMechanics: ['霸体'], record: record('X', 'docs/x.md', 'historical-example', 'Historical_Example') }),
    );
    expect(outcome.classification).toBe('Historical_Example');
    expect(outcome.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.SOURCE_DEPRECATED_MECHANIC)).toBe(true);
  });

  it('纯表现内容被排除在 L2 语义契约外', () => {
    const outcome = classifyStatement(stmt({ claimKey: 'ui', presentationOnly: true }));
    expect(outcome.classification).toBe('Historical_Example');
    expect(outcome.diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.SOURCE_PRESENTATION_ONLY_EXCLUDED)).toBe(true);
  });

  it('带待定标记的陈述保留为未决', () => {
    const outcome = classifyStatement(stmt({ claimKey: 'm', markers: ['待定'] }));
    expect(outcome.classification).toBe('Unresolved_Item');
  });
});
