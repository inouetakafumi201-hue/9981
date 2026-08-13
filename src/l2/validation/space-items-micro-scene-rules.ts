/**
 * L2 验证：微型场景规则。
 * 对应要求 5（微型场景的附属、创建与生命周期契约）。
 */

import type { CandidateDefinition } from '../model/definition.js';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids.js';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context.js';
import { defError } from './helpers.js';

export const validateMicroSceneRules: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);

  // 要求 5.3：检测创建者误用
  const creatorMisuseFields = [
    'creatorAsOwner',
    'creatorAsLifecycleDeterminant',
    'creatorAsAccessControl',
  ];
  for (const field of creatorMisuseFields) {
    if (field in def && def[field]) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.MICRO_SCENE_CREATOR_MISUSE,
          reason: `字段 ${field} 试图让创建者承担所有权/生命周期责任（要求 5.3 禁止）。创建者仅作溯源，不承担任何语义责任。`,
          correctionSuggestion: '移除该字段。生命周期由有效父级和现查占用共同判定。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

  // 要求 5.4：occupancySource 必须为 'derived-query'
  const occupancySource = def.occupancySource;
  if (occupancySource !== undefined && occupancySource !== 'derived-query') {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.MICRO_SCENE_OCCUPANCY_SOURCE_INVALID,
        reason: `occupancySource 为 ${occupancySource}，但要求 5.4 要求必须为 'derived-query'（由引擎层查询导出）。`,
        correctionSuggestion: "改为 'derived-query'。",
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'occupancySource'),
      }),
    );
  }

  // 要求 5.4：若出现 occupancyCounterField 则拒绝
  if ('occupancyCounterField' in def && def.occupancyCounterField) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.MICRO_SCENE_OCCUPANCY_SOURCE_INVALID,
        reason: '字段 occupancyCounterField 试图硬编码占用计数（要求 5.4 禁止）。占用数据必须由查询导出。',
        correctionSuggestion: '移除该字段。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'occupancyCounterField'),
      }),
    );
  }

  // 要求 5.8：检测 modelsVehicleAsMicroScene
  if ('modelsVehicleAsMicroScene' in def && def.modelsVehicleAsMicroScene) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.VEHICLE_NOT_MICRO_SCENE,
        reason: '字段 modelsVehicleAsMicroScene 试图把载具建模为微型场景（要求 5.8 禁止）。载具是实体，乘员处于"在实体内"。',
        correctionSuggestion: '移除该字段。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'modelsVehicleAsMicroScene'),
      }),
    );
  }

};