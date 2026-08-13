/**
 * L2 验证：容器与能力绑定规则。
 * 对应要求 11（容器与能力的正确绑定、引擎层所有权）。
 */

import type { CandidateDefinition } from '../model/definition.js';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids.js';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context.js';
import { defError } from './helpers.js';

export const validateContainerCapabilityBinding: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);

  // 要求 11.2：容器能力引用必须遵循命名约定 `container.capability.<name>`
  const containerCapabilities = def.containerCapabilityIds;
  if (Array.isArray(containerCapabilities)) {
    for (let i = 0; i < containerCapabilities.length; i++) {
      const capId = containerCapabilities[i];
      if (typeof capId === 'string' && !capId.startsWith('container.capability.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.CONTAINER_CAPABILITY_REFERENCE_INVALID,
            reason: `容器能力引用 ${capId} 不符合命名约定 \`container.capability.<name>\`（要求 11.2）。`,
            correctionSuggestion: '改为遵循命名约定的引用。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'containerCapabilityIds', i),
          }),
        );
      }
    }
  }

  // 要求 11.3：检测试图重新定义容器能力的字段
  const capabilityOverrideFields = [
    'containerCapabilityCustomImplementation',
    'containerCapabilityPropertyOverride',
    'capacityCalculationOverride',
    'insertionRuleOverride',
  ];
  for (const field of capabilityOverrideFields) {
    if (field in def && def[field] !== undefined && def[field] !== null) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.CONTAINER_CAPABILITY_OVERRIDE,
          reason: `字段 ${field} 试图重新定义容器能力（要求 11.3 禁止）。容器能力由引擎层拥有，基类层只可引用。`,
          correctionSuggestion: '移除该字段。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

  // 要求 11.4：slotCapabilities 必须为引用而非定义
  const slotCapabilities = def.slotCapabilityIds;
  if (Array.isArray(slotCapabilities)) {
    for (let i = 0; i < slotCapabilities.length; i++) {
      const slotCapId = slotCapabilities[i];
      if (typeof slotCapId === 'string' && !slotCapId.startsWith('slot.capability.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.SLOT_CAPABILITY_REFERENCE_INVALID,
            reason: `槽位能力引用 ${slotCapId} 不符合格式 \`slot.capability.<name>\`（要求 11.4）。`,
            correctionSuggestion: '改为有效的槽位能力引用格式。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'slotCapabilityIds', i),
          }),
        );
      }
    }
  }

  // 要求 11.5：检测试图硬编码能力与容器之间的绑定关系
  const bindingOverrideFields = [
    'concreteCapabilityBindingRules',
    'slotCapabilityBindingOverride',
    'capabilityMutualExclusivityCustomRules',
  ];
  for (const field of bindingOverrideFields) {
    if (field in def && def[field] !== undefined && def[field] !== null) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.CONTAINER_CAPABILITY_BINDING_OVERRIDE,
          reason: `字段 ${field} 试图硬编码能力与容器之间的绑定（要求 11.5 禁止）。绑定由引擎层根据结构推导。`,
          correctionSuggestion: '移除该字段。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

};