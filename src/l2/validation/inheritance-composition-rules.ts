/**
 * L2 Validation: 继承、组合与 Type_Identity 规则。
 *
 * 对应 Requirements 3.1–3.4、3.6–3.8、3.11 与 Property 4/5。
 *
 * 核心：继承表达类型身份，组合表达配置。
 * - 子类型必须相对父级有 Type_Identity 差异（必需能力/合法关系/不变量/替换兼容性）。
 * - 仅玩法数值或仅名称差异 → 建议改用 Composition。
 * - 多继承对同一字段冲突时必须有显式合并规则。
 * - 移除非类型决定的可选能力保持宿主 Type_Identity。
 * （谱系环、跨定义字段合并、嵌套组件先解析等在 resolution 阶段做，本处做定义级静态检查。）
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import { joinJsonPath } from '../model/ids';
import { typeIdentityDiffers } from '../model/reference';
import type { CandidateDefinition } from '../model/definition';
import type { DiagnosticCollector, ValidationContext } from './context';
import { defError } from './helpers';

function findDefinition(context: ValidationContext, id: string): CandidateDefinition | undefined {
  return context.candidateDefinitions.find((definition) => definition.id === id);
}

/**
 * 子类型 Type_Identity 差异（Requirements 3.3–3.4）。
 *
 * 只对候选包内可解析的父级做检查（跨包父级在 resolution 阶段处理）。
 * 若子类型相对父级没有任何 Type_Identity 差异，则：
 * - 若子类型带 gameplayValues 或组合参数差异 → 建议 Composition（INHERIT_GAMEPLAY_VALUE_ONLY_DIFFERENCE）。
 * - 否则 → 无差异子类型（INHERIT_NO_TYPE_IDENTITY_DIFFERENCE）。
 */
export function validateInheritanceTypeIdentity(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const parents = definition.extends ?? [];
  if (parents.length === 0) {
    return;
  }

  for (const parentRef of parents) {
    const parent = findDefinition(context, parentRef.refId);
    if (parent === undefined) {
      // 缺失父级由引用图（5.1）报告；此处不重复。
      continue;
    }
    const differs = typeIdentityDiffers(definition.typeIdentity, parent.typeIdentity);
    if (differs) {
      continue;
    }

    // 无 Type_Identity 差异：判断差异是否只在玩法数值/名称。
    const onlyGameplayOrNameDifference =
      (definition.gameplayValues ?? []).length > 0 ||
      definition.composition.length !== parent.composition.length ||
      definition.presentation !== undefined;

    if (onlyGameplayOrNameDifference) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.INHERIT_GAMEPLAY_VALUE_ONLY_DIFFERENCE,
          reason:
            `定义 ${definition.id} 继承自 ${parent.id}，但仅在玩法数值/名称/配置上有差异，` +
            '没有 Type_Identity 差异。',
          correctionSuggestion: '仅配置差异应使用 Composition（嵌套决定配置），而不是继承（继承决定类型）。',
          jsonPath: joinJsonPath(definition.jsonPath ?? '', 'extends'),
        }),
      );
    } else {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.INHERIT_NO_TYPE_IDENTITY_DIFFERENCE,
          reason: `定义 ${definition.id} 继承自 ${parent.id}，但没有任何 Type_Identity 差异。`,
          correctionSuggestion:
            '子类型必须在必需能力、合法关系、不变量或替换兼容性上与父级不同（Requirements 3.3）。',
          jsonPath: joinJsonPath(definition.jsonPath ?? '', 'typeIdentity'),
        }),
      );
    }
  }
}

/**
 * 多继承字段合并声明（Requirements 3.7–3.8）。
 *
 * 若定义有多个父级，且它们的参数字段名存在交集，则该交集字段必须在 mergeRules 中
 * 有对应的显式合并/优先级声明；否则 INHERIT_FIELD_CONFLICT_WITHOUT_RULE。
 * 只检查候选包内可解析的父级。
 */
export function validateMultiInheritanceMerge(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const parents = (definition.extends ?? [])
    .map((ref) => findDefinition(context, ref.refId))
    .filter((parent): parent is CandidateDefinition => parent !== undefined);
  if (parents.length < 2) {
    return;
  }

  // 收集每个父级提供的字段名。
  const fieldProviders = new Map<string, string[]>();
  for (const parent of parents) {
    for (const field of parent.parameterSchema.fields) {
      const providers = fieldProviders.get(field.name);
      if (providers === undefined) {
        fieldProviders.set(field.name, [parent.id]);
      } else {
        providers.push(parent.id);
      }
    }
  }

  const declaredMergeFields = new Set((definition.mergeRules ?? []).map((rule) => rule.field));
  for (const [fieldName, providers] of fieldProviders) {
    if (providers.length < 2) {
      continue;
    }
    // 该定义自身若重新声明该字段，视为覆盖，无需合并规则。
    const selfOverrides = definition.parameterSchema.fields.some((field) => field.name === fieldName);
    if (selfOverrides || declaredMergeFields.has(fieldName)) {
      continue;
    }
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.INHERIT_FIELD_CONFLICT_WITHOUT_RULE,
        reason:
          `定义 ${definition.id} 从多个父级（${providers.join('、')}）继承了字段「${fieldName}」，` +
          '但未声明显式合并或优先级规则。',
        correctionSuggestion: '为冲突字段声明 mergeRules（precedence/merge），或在本定义中显式覆盖该字段（Requirements 3.7）。',
        jsonPath: joinJsonPath(definition.jsonPath ?? '', 'mergeRules'),
      }),
    );
  }
}

/**
 * 组合规则（Requirements 3.2、3.11）。
 * - 组件 id 唯一。
 * - dependsOn 只能引用同一定义内的其他组件 id。
 * - typeDefining 的可选能力若被标记为 optional，仍视为类型决定项（移除会改变类型身份），
 *   这里校验声明一致性：typeDefining=true 且 optional=true 的组件必须显式说明 reason。
 */
export function validateComposition(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const ids = new Set<string>();
  definition.composition.forEach((component, index) => {
    const path = joinJsonPath(definition.jsonPath ?? '', 'composition', index);
    if (ids.has(component.componentId)) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.COMPOSE_DUPLICATE_COMPONENT,
          reason: `组合组件 id「${component.componentId}」重复。`,
          correctionSuggestion: '同一定义内组合组件 id 必须唯一。',
          jsonPath: joinJsonPath(path, 'componentId'),
        }),
      );
    } else {
      ids.add(component.componentId);
    }
  });

  definition.composition.forEach((component, index) => {
    const path = joinJsonPath(definition.jsonPath ?? '', 'composition', index);
    for (const dependency of component.dependsOn) {
      if (!ids.has(dependency)) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.COMPOSE_ORDER_DEPENDENCY_UNDECLARED,
            reason: `组合组件「${component.componentId}」声明依赖「${dependency}」，但该组件不存在于本定义。`,
            correctionSuggestion: 'dependsOn 只能引用同一定义内已声明的组件 id；顺序依赖必须显式且可解析。',
            jsonPath: joinJsonPath(path, 'dependsOn'),
          }),
        );
      }
      if (dependency === component.componentId) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.COMPOSE_ORDER_DEPENDENCY_UNDECLARED,
            reason: `组合组件「${component.componentId}」依赖自身。`,
            correctionSuggestion: '移除自依赖；组件不能依赖自身。',
            jsonPath: joinJsonPath(path, 'dependsOn'),
          }),
        );
      }
    }
  });
}

/** 4.4 总入口。 */
export function validateInheritanceAndComposition(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  validateInheritanceTypeIdentity(definition, context, collector);
  validateMultiInheritanceMerge(definition, context, collector);
  validateComposition(definition, context, collector);
}
