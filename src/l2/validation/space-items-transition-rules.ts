/**
 * L2 验证：端点与通行规则。
 * 对应要求 6（端点类型、方向、通行条件、阻挡、距离策略）。
 */

import type { CandidateDefinition } from '../model/definition';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context';
import { defError } from './helpers';

const VALID_ENDPOINT_TYPES = Object.freeze(['door', 'gate', 'opening', 'passage']);
const VALID_DIRECTIONS = Object.freeze(['bidirectional', 'one-way', 'restricted']);

export const validateTransitionRules: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);

  // 要求 6.1：endpointType 必须在允许集合内
  const endpointType = def.endpointType;
  if (endpointType !== undefined && !VALID_ENDPOINT_TYPES.includes(String(endpointType))) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.TRANSITION_ENDPOINT_TYPE_INVALID,
        reason: `端点类型 ${endpointType} 不在允许集合 ${JSON.stringify(VALID_ENDPOINT_TYPES)} 内（要求 6.1）。`,
        correctionSuggestion: '改为允许的端点类型之一。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'endpointType'),
      }),
    );
  }

  // 要求 6.2：direction 必须为三值之一
  const direction = def.direction;
  if (direction !== undefined && !VALID_DIRECTIONS.includes(String(direction))) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.TRANSITION_DIRECTION_INVALID,
        reason: `通行方向 ${direction} 不在允许集合 ${JSON.stringify(VALID_DIRECTIONS)} 内（要求 6.2）。`,
        correctionSuggestion: '改为三值之一。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'direction'),
      }),
    );
  }

  // 要求 6.3：passageConditionIds 不能为空
  const passageConditions = def.passageConditionIds;
  if (Array.isArray(passageConditions) && passageConditions.length === 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.TRANSITION_CONDITION_EMPTY,
        reason: '字段 passageConditionIds 为空数组（要求 6.3：若声明通行条件则必须非空）。',
        correctionSuggestion: '要么移除该字段，要么添加至少一个条件引用。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'passageConditionIds'),
      }),
    );
  }

  // 要求 6.4：检测试图硬编码阻挡逻辑的字段
  const blockingFields = [
    'concreteBlockingRules',
    'blockingByStatusTag',
    'blockingByVehicleType',
    'blockingByAgentLevel',
  ];
  for (const field of blockingFields) {
    if (field in def && def[field] !== undefined && def[field] !== null) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.TRANSITION_BLOCKING_HARDCODED,
          reason: `字段 ${field} 试图硬编码阻挡逻辑（要求 6.4 禁止）。阻挡由引擎层通行条件判定导出。`,
          correctionSuggestion: '移除该字段。通过 passageConditionIds 引用标准条件。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

  // 要求 6.5：距离策略字段检测
  const distanceStrategyFields = ['concreteDistance', 'distanceMetric', 'distanceValidationFunction'];
  for (const field of distanceStrategyFields) {
    if (field in def && def[field] !== undefined && def[field] !== null) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.UNRESOLVED_ITEM_PROMOTION_ATTEMPT,
          reason: `字段 ${field} 涉及距离策略具体实现（要求 6.5，待 U-SPACE-004 决策）。`,
          correctionSuggestion: '移除该字段。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

};