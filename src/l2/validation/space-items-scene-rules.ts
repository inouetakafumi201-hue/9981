/**
 * L2 验证：空间系统场景规则。
 * 对应要求 4（天然场景）与部分要求 5（微型场景父级）。
 */

import type { CandidateDefinition } from '../model/definition.js';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids.js';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context.js';
import { defError } from './helpers.js';

export const validateSceneRules: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);

  // 要求 4.1：scale 必须为三值之一
  const scale = def.scale;
  if (scale !== undefined && !['large', 'medium', 'small'].includes(String(scale))) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCENE_SCALE_INVALID,
        reason: `场景档位 ${scale} 不在允许集合 [large, medium, small] 内（要求 4.1）。`,
        correctionSuggestion: '改为三档之一。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'scale'),
      }),
    );
  }

  // 要求 4.4：小场景必须声明 `scene.capability.personal_vacant_ground`
  if (scale === 'small') {
    const capabilities = def.capabilityIds;
    if (!Array.isArray(capabilities) || !capabilities.includes('scene.capability.personal_vacant_ground')) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SCENE_MISSING_REQUIRED_CAPABILITY,
          reason: '小场景必须声明 `scene.capability.personal_vacant_ground`（要求 4.4）。',
          correctionSuggestion: '添加该能力引用。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'capabilityIds'),
        }),
      );
    }
  }

  // 要求 4.5：具体节点不得出现
  const concreteNodeIds = def.concreteMapNodeIds;
  if (Array.isArray(concreteNodeIds) && concreteNodeIds.length > 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SPACE_CONCRETE_MAP_NODE,
        reason: `字段 concreteMapNodeIds 包含具体地图节点（要求 4.5 禁止），应由玩法层处理。`,
        correctionSuggestion: '移除该字段。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'concreteMapNodeIds'),
      }),
    );
  }

  // 要求 4.5：spawnPointIds / shrinkOrderIds 检测
  for (const field of ['spawnPointIds', 'shrinkOrderIds']) {
    if (field in def && Array.isArray(def[field]) && (def[field] as unknown[]).length > 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SPACE_CONCRETE_MAP_NODE,
          reason: `字段 ${field} 是具体地图配置（要求 4.5 禁止），应由玩法层处理。`,
          correctionSuggestion: '移除该字段。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

};