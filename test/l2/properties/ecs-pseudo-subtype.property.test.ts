/**
 * Feature: wakeup-base-layer-ecs, Property 7: 元素子类差异化 / PSEUDO_SUBTYPE
 *
 * Validates: Requirement 7.7 (确认: Task 8.4 vehicle 组合模板作为 H-ECS-05 交接项
 * = 载具从 `defKind:"entity"` 基类降级为组合型组件族，不在此任务线与具体 vehicle
 * 组合模板绑定；本属性面向 5.8 的元素子类差异化主线。)
 *
 * Requirement 7.7：IF 一个家族接受元素子类（damage 或 status 子类），
 * 则其子类与父类在语义族/能力上给出区别证据，或在 `valueSets` 中有 token 级差异化；
 * 若仍无区别证据则返回 `PSEUDO_SUBTYPE` 拒绝。
 *
 * 区别证据的两条合法通路：
 * 1. 语义轴证据 —— subType 在 typeIdentity.requiredCapabilities 上声明区别于父类的
 *    能力标记（family-contracts 的 `differsOnlyByNameOrValue: false` / capability 差异）；
 * 2. token 级差异化 —— 收敛为组件形状后，`parameters[*].enumValues` 是 valueSets 的
 *    token 级载体：不同子类必须携 token 级差异，而非仅靠继承父类 shapes 混同。
 *
 * 若两者皆缺（仅名称/数值差异），status 族经 `differsOnlyByNameOrValue === true`
 * 触发 `STATUS_PSEUDO_SUBTYPE`；schema 层 `enumValues` 保证 token 级差异可被
 * 机械判定，不依赖启发式猜测。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DIAGNOSTIC_CODES } from '../../../src/l2/model/diagnostic-codes.js';
import { ALL_FAMILY_SHAPES } from '../../../src/l2/model/family-component-shapes.js';
import { baseDefinition, singleDefinitionPackage, validStatusContract, capabilityIdentity } from '../../../src/l2/testing/builders.js';
import { arbId } from '../../../src/l2/testing/definition-generators.js';
import { validateStructure, hasCode } from '../helpers.js';

describe('Property 7: 元素子类差异化 / PSEUDO_SUBTYPE', () => {
  it('status 族只按名称/数值差异的子类型触发 PSEUDO_SUBTYPE 拒绝（Requirement 9.9 通路）', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbId, fc.constantFrom(true, false)).map(([id, differs]) => ({ id, differs })),
        (seed) => {
          const status = validStatusContract(`${seed.id}-effect`);
          const raw = {
            id: `st-${seed.id}`,
            defKind: 'attachment',
            semanticFamily: { familyId: 'status' },
            typeIdentity: capabilityIdentity(`stat-${seed.id}`),
            familyContract: seed.differs ? { ...status, differsOnlyByNameOrValue: true as const } : status,
          } as Parameters<typeof baseDefinition>[0];
          const def = baseDefinition(raw);
          const result = validateStructure(singleDefinitionPackage(`pkg-${seed.id}`, def));
          const pseudo = hasCode(result.diagnostics, DIAGNOSTIC_CODES.STATUS_PSEUDO_SUBTYPE);
          expect(pseudo).toBe(seed.differs);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('元素子类必须具备 token 级差异（enumValues）或能力证据，不能仅靠继承父类族形状混同', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_FAMILY_SHAPES.flatMap((s) => s.components)),
        (component) => {
          // skill / shield / status 等接受元素子类的族：组件形状若无 token 级差异化
          // 载体（enumValues），则族形状必须保留某种可判定的差异通道。
          // 这里断言：凡需要差异化判定的 family shape，要么提供 enumValues token，
          // 要么组件 id / familyId 本身就是稳定的族身份差异（即非仅名称差异）。
          const requiresDifferentiation = component.kernelOps.some((op) => op.startsWith('status.') || op.startsWith('skill.') || op.startsWith('shield.'));
          if (!requiresDifferentiation) {
            return;
          }
          // token 级或语义级至少其一存在：familyId 与 id 前缀同族即为语义轴证据，
          // enumValues 为 token 级差异载体。
          const hasTokenLevel = component.parameters.some(
            (p) => p.enumValues !== undefined && p.enumValues.length > 0,
          );
          const hasFamilyIdentity = component.id.startsWith(`component.${component.familyId}.`);
          expect(hasTokenLevel || hasFamilyIdentity).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('同族内两个显式配置了不同 enumValues token 的子类组件仍保持族身份且可共存', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('weak', 'strong', 'alternating'),
        fc.constantFrom('metal', 'wood', 'flesh'),
        (gradeToken, materialToken) => {
          // 两个子类共享同族组件 id 前缀，但 valueSets token（enumValues）不同 → 非伪子类。
          const rawA = {
            id: `component.status.${gradeToken}`,
            defKind: 'attachment',
            semanticFamily: { familyId: 'status' },
            typeIdentity: capabilityIdentity('statA'),
            parameters: Object.freeze([
              { name: 'grade', dataType: 'string', required: false, classification: 'Gameplay_Value', playerVisible: true, enumValues: Object.freeze([gradeToken]) },
            ]),
            kernelOps: Object.freeze(['status.apply']),
            familyId: 'status',
            compositionKind: 'modified-explicit',
          } as Parameters<typeof baseDefinition>[0];
          const defA = baseDefinition(rawA);

          const rawB = {
            id: `component.status.material.${materialToken}`,
            defKind: 'attachment',
            semanticFamily: { familyId: 'status' },
            typeIdentity: capabilityIdentity('statB'),
            parameters: Object.freeze([
              { name: 'material', dataType: 'string', required: false, classification: 'Gameplay_Value', playerVisible: true, enumValues: Object.freeze([materialToken]) },
            ]),
            kernelOps: Object.freeze(['status.apply']),
            familyId: 'status',
            compositionKind: 'modified-explicit',
          } as Parameters<typeof baseDefinition>[0];
          const defB = baseDefinition(rawB);

          const result = validateStructure(
            singleDefinitionPackage(
              `pkg-${gradeToken}-${materialToken}`,
              defA,
              { definitions: [defA, defB] },
            ),
          );
          const pseudoErrors = result.diagnostics.filter((d) => d.code === DIAGNOSTIC_CODES.STATUS_PSEUDO_SUBTYPE);
          // token 级差异化存在 → 不因伪子类而被拒。
          expect(pseudoErrors.some((d) => d.severity === 'Error')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
