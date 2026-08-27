/**
 * L2 验证：物品容器与槽位规则。
 * 对应要求 7（容器/槽位/装备位/消耗/附件点/转换）。
 */

import type { CandidateDefinition } from '../model/definition';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context';
import { defError } from './helpers';

export const validateItemRules: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);

  // 要求 7.2：containerIds 引用格式必须为 `container.<name>`
  const containerIds = def.containerIds;
  if (Array.isArray(containerIds)) {
    for (let i = 0; i < containerIds.length; i++) {
      const cid = containerIds[i];
      if (typeof cid === 'string' && !cid.startsWith('container.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.CONTAINER_REFERENCE_INVALID,
            reason: `容器引用 ${cid} 不符合格式 \`container.<name>\`（要求 7.2）。`,
            correctionSuggestion: '改为有效格式。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'containerIds', i),
          }),
        );
      }
    }
  }

  // 要求 7.3：检测试图重写容器结构或槽位配置的字段
  const containerOverrideFields = [
    'slotOrderOverride',
    'insertionStrategyOverride',
    'slotAllocationOverride',
    'capacityCheckCustomFunction',
    'containerDirectionality',
  ];
  for (const field of containerOverrideFields) {
    if (field in def && def[field] !== undefined && def[field] !== null) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.CONTAINER_STRUCTURE_OVERRIDE,
          reason: `字段 ${field} 试图重写容器结构或槽位配置（要求 7.3 禁止）。容器结构由引擎层拥有。`,
          correctionSuggestion: '移除该字段。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

  // 要求 7.4：equipmentSlotIds 格式检查
  const equipmentSlotIds = def.equipmentSlotIds;
  if (Array.isArray(equipmentSlotIds)) {
    for (let i = 0; i < equipmentSlotIds.length; i++) {
      const slotId = equipmentSlotIds[i];
      if (typeof slotId === 'string' && !slotId.startsWith('equipment-slot.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.EQUIPMENT_SLOT_REFERENCE_INVALID,
            reason: `装备位引用 ${slotId} 不符合格式 \`equipment-slot.<name>\`（要求 7.4）。`,
            correctionSuggestion: '改为有效格式。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'equipmentSlotIds', i),
          }),
        );
      }
    }
  }

  // 要求 7.5：consumptionPointIds 格式检查
  const consumptionPointIds = def.consumptionPointIds;
  if (Array.isArray(consumptionPointIds)) {
    for (let i = 0; i < consumptionPointIds.length; i++) {
      const pointId = consumptionPointIds[i];
      if (typeof pointId === 'string' && !pointId.startsWith('consumption-point.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.CONSUMPTION_POINT_REFERENCE_INVALID,
            reason: `消耗点引用 ${pointId} 不符合格式 \`consumption-point.<name>\`（要求 7.5）。`,
            correctionSuggestion: '改为有效格式。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'consumptionPointIds', i),
          }),
        );
      }
    }
  }

  // 要求 7.6：attachmentPointIds 格式检查
  const attachmentPointIds = def.attachmentPointIds;
  if (Array.isArray(attachmentPointIds)) {
    for (let i = 0; i < attachmentPointIds.length; i++) {
      const pointId = attachmentPointIds[i];
      if (typeof pointId === 'string' && !pointId.startsWith('attachment-point.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.ATTACHMENT_POINT_REFERENCE_INVALID,
            reason: `附件点引用 ${pointId} 不符合格式 \`attachment-point.<name>\`（要求 7.6）。`,
            correctionSuggestion: '改为有效格式。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'attachmentPointIds', i),
          }),
        );
      }
    }
  }

  // 要求 7.7：检测试图定义具体转换规则的字段
  const conversionFields = ['concreteConversionRules', 'transformationLookupTable', 'conversionFunctionRef'];
  for (const field of conversionFields) {
    if (field in def && def[field] !== undefined && def[field] !== null) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.ITEM_CONVERSION_HARDCODED,
          reason: `字段 ${field} 试图硬编码物品转换规则（要求 7.7 禁止）。转换由引擎层根据操作导出。`,
          correctionSuggestion: '移除该字段。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

};