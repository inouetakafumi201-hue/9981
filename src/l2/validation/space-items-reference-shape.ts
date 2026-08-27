/**
 * L2 验证：空间与物品领域的引用能力形状判定。
 *
 * 对应 Task 5 的目标：验证物品、场景、载具之间的引用是否满足类型契约。
 * 这一层在"分类验证"（classification-rules）之后，在"依赖解析"（resolution 层）之前。
 *
 * References：
 * - Requirements 7 (Containers & Items)、8 (Weapons)、10 (Vehicles)
 * - family-contracts.ts 的标准族契约
 * - space-items-contracts.ts 的域专属契约
 */

import type { CandidateDefinition } from '../model/definition';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context';
import { defError } from './helpers';

/**
 * 引用能力形状验证：检查定义对其他定义的引用是否都已声明引用形状。
 *
 * 不检查引用是否存在（那是 resolution 层的职责），只检查**声明**。
 */
export const validateReferenceCapabilityShape: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);

  // 要求 7.2: 容器引用必须通过 `containerIds` 字段声明
  const containerRefs = def.containerIds;
  if (Array.isArray(containerRefs) && containerRefs.length > 0) {
    // 每个容器引用应该有对应的形状声明
    // 这里只检查声明的存在性，实际解析在 resolution 层
    for (let i = 0; i < containerRefs.length; i++) {
      const cRef = containerRefs[i];
      if (typeof cRef === 'string' && cRef.length === 0) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.SCHEMA_FIELD_REFERENCE_TARGET_MISSING,
            reason: `容器引用为空字符串（位置 containerIds[${i}]，要求 7.2）。`,
            correctionSuggestion: '提供有效的容器标识。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'containerIds', i),
          }),
        );
      }
    }
  }

  // 要求 8.1: 武器类型恒等性检查
  // 武器必须声明 `weaponTypeId` 来标识其攻击特性
  if (definition.defKind === 'item' && def.semanticFamily === 'weapon') {
    if (!def.weaponTypeId || typeof def.weaponTypeId !== 'string') {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.WEAPON_TYPE_IDENTITY_MISSING,
          reason: '武器定义缺少 weaponTypeId（要求 8.1）。',
          correctionSuggestion: '声明武器的类型恒等性（如 "rifle"、"melee"）。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'weaponTypeId'),
        }),
      );
    }
  }

  // 要求 10.1: 载具必须声明座位与乘员绑定
  const seatIds = def.seatIds;
  if (Array.isArray(seatIds)) {
    if (seatIds.length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.VEHICLE_MISSING_CAPABILITY,
          reason: '载具定义声明 seatIds 但数组为空（要求 10.1）。',
          correctionSuggestion: '要么移除该字段，要么添加至少一个座位引用。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'seatIds'),
        }),
      );
    }
    // 检查座位引用格式
    for (let i = 0; i < seatIds.length; i++) {
      const seatId = seatIds[i];
      if (typeof seatId === 'string' && seatId.length === 0) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.VEHICLE_SEAT_REFERENCE_INVALID,
            reason: `座位引用为空（位置 seatIds[${i}]，要求 10.1）。`,
            correctionSuggestion: '提供有效的座位标识。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'seatIds', i),
          }),
        );
      }
    }
  }

  // 要求 7.4: 微型场景必须声明父级场景
  if (def.isEmbeddedMicroScene) {
    const parentSceneRef = def.parentSceneRef;
    if (!parentSceneRef || typeof parentSceneRef !== 'string') {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_PARENT_MISSING,
          reason: '微型场景缺少 parentSceneRef（要求 7.4）。',
          correctionSuggestion: '声明此微型场景附属的父级场景引用。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'parentSceneRef'),
        }),
      );
    }
  }

  // 要求 7.4: 微型场景不能有多个父级
  const parentSceneRefs = def.parentSceneRefs;
  if (Array.isArray(parentSceneRefs) && parentSceneRefs.length > 1) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_MULTIPLE_PARENTS,
        reason: `微型场景声明 ${parentSceneRefs.length} 个父级场景（要求 7.4：必须恰为一个）。`,
        correctionSuggestion: '移除多余的父级场景引用，保留唯一有效的那个。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'parentSceneRefs'),
      }),
    );
  }

};