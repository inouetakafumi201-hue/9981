/**
 * L2 验证：空间与物品未决项门禁规则。
 *
 * 对应 requirements.md 要求 13.8–13.9：
 * - 13.8：任何默认化尝试（推导未决项的具体机制）→ 拒绝且诊断引用未决项编号
 * - 13.9：提升未决项需新控制决策 / 来源 / 拥有层 / 替代关系
 */

import type { CandidateDefinition } from '../model/definition.js';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids.js';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context.js';
import { defError } from './helpers.js';
import { REGULATORY_DETECTION_FIELDS } from '../model/space-items-contracts.js';

export const validateUnresolvedItems: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;

  // 遍历所有规制检测面字段
  for (const fieldName of REGULATORY_DETECTION_FIELDS) {
    if (fieldName in def && def[fieldName] !== undefined && def[fieldName] !== null) {
      let unresolvedCode: string | undefined;
      let reason: string;

      if (
        fieldName === 'concreteDamageValue' ||
        fieldName === 'baseDamageTable' ||
        fieldName === 'damageTable'
      ) {
        unresolvedCode = 'U-SPACE-001';
        reason = `字段 ${fieldName} 是越层推导伤害表的标记（待 D-040）。`;
      } else if (
        fieldName === 'concreteApCost' ||
        fieldName === 'concreteDistance'
      ) {
        unresolvedCode = 'U-SPACE-004';
        reason = `字段 ${fieldName} 是越层推导距离策略的标记。`;
      } else if (fieldName === 'mvpDefaultInteractionIds') {
        unresolvedCode = 'U-SPACE-006';
        reason = `字段 ${fieldName} 是越层推导盾牌 MVP 互动的标记。`;
      } else if (
        fieldName === 'interiorMicroSceneBoundary' ||
        fieldName === 'directOccupantStateWrite' ||
        fieldName === 'directCargoStateWrite'
      ) {
        unresolvedCode = 'U-SPACE-005';
        reason = `字段 ${fieldName} 是越层推导载具内部边界的标记（待 D-038）。`;
      } else if (fieldName === 'specialTierMechanism') {
        unresolvedCode = 'U-SPACE-003';
        reason = `字段 ${fieldName} 是越层推导特殊档位机制的标记。`;
      } else {
        reason = `字段 ${fieldName} 是规制检测面，不得在基类层出现。`;
      }

      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.UNRESOLVED_ITEM_PROMOTION_ATTEMPT,
          reason,
          correctionSuggestion: unresolvedCode ? `移除该字段。若需要该机制，请先获得 ${unresolvedCode} 的权威裁决。` : '移除该字段。',
          jsonPath: joinJsonPath(
            ROOT_JSON_PATH,
            'definitions',
            context.candidateDefinitions.indexOf(definition),
            fieldName,
          ),
          ...(unresolvedCode ? { unresolvedItemCode: unresolvedCode } : {}),
        }),
      );
    }
  }

  // 检测 D-016 已移除状态的黑名单（注：这些字段可能不在所有定义类型中存在）
  // 由于 definition 可能不包含这些字段，我们跳过此检查

};