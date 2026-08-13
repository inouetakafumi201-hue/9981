/**
 * 领域规则执行序稳定性测试。
 *
 * 验证：
 * - 同一输入的诊断序列字节等价（Requirements 13.8 稳定排序）
 * - 一个含多个独立问题的候选一次报全（不遇错即停）
 * - 无重复诊断（对 (definitionId, jsonPath, code) 三元组去重后长度不变）
 */

import { describe, it, expect } from 'vitest';
import { buildValidationContext, validatePackage } from '../../../../src/l2/validation/validator.js';
import type { DefinitionPackage } from '../../../../src/l2/model/definition.js';
import { DIAGNOSTIC_CODES } from '../../../../src/l2/model/diagnostic-codes.js';
import { baseDefinition, capabilityIdentity, singleDefinitionPackage } from '../../../../src/l2/testing/builders.js';

describe('Feature: wakeup-space-items, Rule Order Stability', () => {
  it('同一输入产生字节等价的诊断序列', () => {
    const definition = baseDefinition({
      id: 'test.scene',
      defKind: 'node',
      semanticFamily: { familyId: 'scene', registration: undefined },
      typeIdentity: capabilityIdentity('test-capability'),
    });

    const pkg = singleDefinitionPackage('test.rule-order', definition);
    const context = buildValidationContext({ package: pkg });
    
    const result1 = validatePackage(context);
    const result2 = validatePackage(context);

    // 验证结果存在
    expect(result1).toBeDefined();
    expect(result1.diagnostics).toBeDefined();
    expect(result2).toBeDefined();
    expect(result2.diagnostics).toBeDefined();

    // 字节等价：序列化后相等
    expect(JSON.stringify(result1.diagnostics)).toBe(JSON.stringify(result2.diagnostics));
  });

  it('含多个独立问题的候选一次报全', () => {
    // 创建一个明确违反多个规则的定义
    const definition = {
      ...baseDefinition({
        id: '', // 空标识符 - 触发 DEF_MALFORMED_IDENTIFIER
        defKind: 'item',
        semanticFamily: { familyId: 'weapon', registration: undefined },
        typeIdentity: capabilityIdentity('weapon-capability'),
      }),
      sourceRecords: [], // 空的源记录 - 触发 DEF_MISSING_SOURCE_RECORD
    } as any;

    const pkg = singleDefinitionPackage('test.multi-issue', definition);
    const context = buildValidationContext({ package: pkg });
    const result = validatePackage(context);

    // 应该报告多个问题（至少2个：空标识符和缺少源记录）
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);

    // 验证包含预期的诊断码
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain(DIAGNOSTIC_CODES.DEF_MALFORMED_IDENTIFIER);
    expect(codes).toContain(DIAGNOSTIC_CODES.DEF_MISSING_SOURCE_RECORD);
  });

  it('无重复诊断（三元组唯一性）', () => {
    const definition = baseDefinition({
      id: 'test.node',
      defKind: 'node',
      semanticFamily: { familyId: 'scene', registration: undefined },
      typeIdentity: capabilityIdentity('scene-capability'),
    });

    const pkg = singleDefinitionPackage('test.no-duplicates', definition);
    const context = buildValidationContext({ package: pkg });
    const result = validatePackage(context);

    // 构造三元组集合
    const tuples = new Set<string>();
    for (const diag of result.diagnostics) {
      const tuple = JSON.stringify([
        diag.sourcePackage ?? '',
        diag.jsonPath ?? '',
        diag.code,
      ]);
      tuples.add(tuple);
    }

    // 去重后长度应与原长度相等
    expect(tuples.size).toBe(result.diagnostics.length);
  });

  it('规则执行序稳定（不受哈希表顺序影响）', () => {
    const def1 = baseDefinition({
      id: 'test.weapon.a',
      defKind: 'item',
      semanticFamily: { familyId: 'weapon', registration: undefined },
      typeIdentity: capabilityIdentity('weapon-a'),
    });

    const def2 = baseDefinition({
      id: 'test.weapon.b',
      defKind: 'item',
      semanticFamily: { familyId: 'weapon', registration: undefined },
      typeIdentity: capabilityIdentity('weapon-b'),
    });

    const pkg1: DefinitionPackage = {
      packageId: 'test.order-stable',
      schemaVersion: '1.0.0',
      definitions: [def1, def2],
      dependencies: [],
      sourceRecords: [],
    };

    const pkg2: DefinitionPackage = {
      schemaVersion: '1.0.0',
      packageId: 'test.order-stable', // 键顺序不同
      definitions: [def1, def2],
      dependencies: [],
      sourceRecords: [],
    };

    const context1 = buildValidationContext({ package: pkg1 });
    const context2 = buildValidationContext({ package: pkg2 });

    const result1 = validatePackage(context1);
    const result2 = validatePackage(context2);

    // 诊断序列应该完全一致（稳定排序）
    expect(JSON.stringify(result1.diagnostics)).toBe(JSON.stringify(result2.diagnostics));
  });
});
