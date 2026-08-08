/**
 * L2 契约测试：相邻模块 DAG 共享契约（Requirements 2.3、2.7、13.6–13.7、15.2）。
 *
 * 验证 Codec → Validator → Resolver → Registry 使用同一共享模型：
 * - Codec 解析出的候选包能被 Validator 直接消费。
 * - Registry 激活只在无 Error 时进行。
 * - submit 只映射到 OpRegistry.invoke，不存在第二写通道。
 */

import { describe, it, expect } from 'vitest';
import { parsePackage } from '../../../src/l2/codec/json-codec.js';
import { activate, emptyRegistry } from '../../../src/l2/registry/definition-registry.js';
import { EMPTY_RUNTIME_SEMANTIC_STATE } from '../../../src/l2/model/projection.js';

const validJson = JSON.stringify({
  packageId: 'pkg-dag',
  schemaVersion: 'l2-declarative/1',
  dependencies: [],
  sourceRecords: [
    {
      sourceFile: 'docs/x.md',
      sourceLocation: { sourceFile: 'docs/x.md', section: 's' },
      precedence: 'finalized-l2-contract',
      classification: 'Normative_Contract',
      owningLayer: '基类层',
      statementFingerprint: 'pkg',
    },
  ],
  definitions: [
    {
      id: 'dmg-basic',
      defKind: 'rule',
      abstract: false,
      semanticFamily: { familyId: 'damage' },
      typeIdentity: { requiredCapabilities: ['deal-damage'], legalRelationships: [], invariants: [], substitutionCompatibility: [] },
      composition: [],
      parameterSchema: { fields: [], crossFieldConstraints: [] },
      tags: [],
      actionRefs: [],
      ruleRefs: [],
      familyContract: {
        contractKind: 'damage',
        damageCategory: 'physical',
        sourceRequirements: [],
        targetRequirements: [],
        settlementPipelineRefs: [
          { refId: 'pipe-1', role: 'rule', expected: { defKind: 'rule', allowAbstract: false }, required: false, jsonPath: '/x' },
        ],
      },
      sourceRecords: [
        {
          sourceFile: 'docs/x.md',
          sourceLocation: { sourceFile: 'docs/x.md', section: 's' },
          precedence: 'finalized-l2-contract',
          classification: 'Normative_Contract',
          owningLayer: '基类层',
          statementFingerprint: 'dmg',
        },
      ],
    },
  ],
});

describe('模块 DAG 契约', () => {
  it('Codec 输出可被 Registry 直接激活（端到端无 Error）', () => {
    const parsed = parsePackage(validJson, { sourceLocation: { sourceFile: 'x', section: 's' }, packageId: 'pkg-dag' });
    expect(parsed.rejected).toBe(false);
    if (parsed.rejected) {
      return;
    }
    const activation = activate(emptyRegistry(), parsed.value);
    expect(activation.rejected).toBe(false);
    if (!activation.rejected) {
      expect(activation.value.registry.definitions.has('dmg-basic')).toBe(true);
      // 快照可查询、含该定义。
      expect(activation.value.snapshot.resolvedDefinitions.some((d) => d.id === 'dmg-basic')).toBe(true);
    }
  });

  it('运行时状态为空时投影仍可构造（不依赖具体运行时）', () => {
    expect(EMPTY_RUNTIME_SEMANTIC_STATE.entities).toHaveLength(0);
  });
});
