/**
 * L2 Validation: 参数 Schema、数值归属与来源支持规则。
 *
 * 对应 Requirements 2.5、5.1–5.12、8.4、9.1、9.6、15.8 与 Property 3。
 *
 * 核心：每个数值字段恰好有一个有效分类；玩家可见 Gameplay_Value 具体值只在 L3 且落 1–5；
 * 结构边界/宪法常量必须带来源；内部度量走自身 Schema；L2 不得内嵌玩法平衡表。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import { GAMEPLAY_VALUE_RANGE, GAMEPLAY_VALUE_RANGE_SOURCE } from '../model/constitution';
import { NUMERIC_DECLARED_TYPES, type ParameterField, type ParameterSchema } from '../model/schema';
import { joinJsonPath } from '../model/ids';
import type { CandidateDefinition } from '../model/definition';
import type { SourceRecord } from '../model/source';
import type { DiagnosticCollector, ValidationContext } from './context';
import { defError } from './helpers';

function GAMEPLAY_VALUE_RANGE_SOURCE_REF(): SourceRecord {
  return GAMEPLAY_VALUE_RANGE_SOURCE;
}

/** 递归遍历 Schema 中的每个字段（含 object 嵌套），带路径。 */
function forEachField(
  schema: ParameterSchema,
  basePath: string,
  visit: (field: ParameterField, path: string) => void,
): void {
  schema.fields.forEach((field, index) => {
    const path = joinJsonPath(basePath, 'fields', index);
    visit(field, path);
    if (field.objectFields !== undefined) {
      field.objectFields.forEach((nested, nestedIndex) => {
        const nestedPath = joinJsonPath(path, 'objectFields', nestedIndex);
        visit(nested, nestedPath);
      });
    }
  });
}

function validateField(
  field: ParameterField,
  path: string,
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  // 字段名重复由包含它的 Schema 层统一检查；此处校验分类完整性。
  const isNumeric = NUMERIC_DECLARED_TYPES.has(field.dataType);

  switch (field.classification) {
    case 'Gameplay_Value':
      validateGameplayValueField(field, path, isNumeric, definition, context, collector);
      break;
    case 'Structural_Bound':
      validateStructuralBoundField(field, path, definition, context, collector);
      break;
    case 'Constitutional_Constant':
      validateConstitutionalConstantField(field, path, definition, context, collector);
      break;
    case 'Internal_Metric':
      validateInternalMetricField(field, path, definition, context, collector);
      break;
    default:
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SCHEMA_FIELD_MISSING_CLASSIFICATION,
          reason: `字段 ${field.name} 缺少有效的数值/字段分类。`,
          correctionSuggestion:
            '每个字段必须分类为 Gameplay_Value、Structural_Bound、Constitutional_Constant 或 Internal_Metric 之一（Requirements 5.7）。',
          jsonPath: joinJsonPath(path, 'classification'),
        }),
      );
  }

  // 引用类型字段必须声明 referenceTarget。
  if (field.dataType === 'reference' && field.referenceTarget === undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCHEMA_FIELD_REFERENCE_TARGET_MISSING,
        reason: `引用类型字段 ${field.name} 未声明 referenceTarget。`,
        correctionSuggestion: '为引用字段声明期望的 Def kind 或语义族（Requirements 5.1）。',
        jsonPath: joinJsonPath(path, 'referenceTarget'),
      }),
    );
  }
}

function validateGameplayValueField(
  field: ParameterField,
  path: string,
  isNumeric: boolean,
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  // Gameplay_Value 字段必须声明 gameplayValueKind 与 playerVisible。
  if (field.gameplayValueKind === undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCHEMA_FIELD_MISSING_CLASSIFICATION,
        reason: `玩法数值字段 ${field.name} 未声明 gameplayValueKind。`,
        correctionSuggestion: '声明该玩法数值的类别（damage-table、duration、capacity、threshold 等）。',
        jsonPath: joinJsonPath(path, 'gameplayValueKind'),
      }),
    );
  }
  if (field.playerVisible === undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCHEMA_FIELD_MISSING_CLASSIFICATION,
        reason: `玩法数值字段 ${field.name} 未声明 playerVisible。`,
        correctionSuggestion: '声明该玩法数值是否玩家可见；玩家可见值受 L0 的 1–5 宪法约束。',
        jsonPath: joinJsonPath(path, 'playerVisible'),
      }),
    );
  }

  // L2 不得为玩法数值字段内嵌默认值（那是把具体赋值塞进基类层，Requirements 5.2、5.8）。
  if (field.defaultValue !== undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_TABLE_IN_L2,
        reason: `玩法数值字段 ${field.name} 在基类层携带了默认值 ${JSON.stringify(field.defaultValue)}。`,
        correctionSuggestion: '基类层只声明玩法数值接口，具体赋值（含默认值）由玩法层 Profile 提供。',
        jsonPath: joinJsonPath(path, 'defaultValue'),
      }),
    );
  }

  // 玩法数值表类别（伤害/概率/AP 价格）不得作为字段直接落在 L2（Requirements 5.8、8.4）。
  const tableKinds = new Set(['damage-table', 'probability-table', 'ap-price-table']);
  if (field.gameplayValueKind !== undefined && tableKinds.has(field.gameplayValueKind)) {
    // 表接口本身可以声明，但若它带 range/defaultValue 具体化则拒绝；纯接口声明放行。
    if (field.range !== undefined || field.defaultValue !== undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_TABLE_IN_L2,
          reason: `字段 ${field.name} 在基类层具体化了玩法数值表（${field.gameplayValueKind}）。`,
          correctionSuggestion: '基类层只暴露表接口，具体表值归玩法层（Requirements 5.8）。',
          jsonPath: path,
        }),
      );
    }
  }

  // 玩家可见玩法数值的 range 若声明，必须落在 1–5 内（Requirements 5.5）。
  if (isNumeric && field.playerVisible === true && field.range !== undefined) {
    const { min, max } = field.range;
    if ((min !== undefined && min < GAMEPLAY_VALUE_RANGE.min) || (max !== undefined && max > GAMEPLAY_VALUE_RANGE.max)) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE,
          reason:
            `玩家可见玩法数值字段 ${field.name} 的取值范围 [${String(min)}, ${String(max)}] ` +
            `超出 L0 规定的 ${GAMEPLAY_VALUE_RANGE.min}–${GAMEPLAY_VALUE_RANGE.max}。`,
          correctionSuggestion: '玩家可见数值严格限制在 1–5（L0 数值铁律）。',
          jsonPath: joinJsonPath(path, 'range'),
          relatedSources: [GAMEPLAY_VALUE_RANGE_SOURCE_REF()],
        }),
      );
    }
  }
}

function validateStructuralBoundField(
  field: ParameterField,
  path: string,
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  if (field.authoritativeSource === undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_SOURCE,
        reason: `结构边界字段 ${field.name} 缺少权威来源。`,
        correctionSuggestion: '结构边界必须带权威 Source_Record（Requirements 5.3）。',
        jsonPath: joinJsonPath(path, 'authoritativeSource'),
      }),
    );
  }
  if (field.structuralRationale === undefined || field.structuralRationale.trim().length === 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_RATIONALE,
        reason: `结构边界字段 ${field.name} 缺少结构理由。`,
        correctionSuggestion: '结构边界必须带结构理由说明其保证的类型结构或引擎不变量（Requirements 5.3）。',
        jsonPath: joinJsonPath(path, 'structuralRationale'),
      }),
    );
  }
}

function validateConstitutionalConstantField(
  field: ParameterField,
  path: string,
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  if (field.authoritativeSource === undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCHEMA_CONSTITUTIONAL_CONSTANT_MISSING_SOURCE,
        reason: `宪法常量字段 ${field.name} 缺少来源标识。`,
        correctionSuggestion: '宪法常量必须带来源标识、归属层与适用字段（Requirements 5.4）。',
        jsonPath: joinJsonPath(path, 'authoritativeSource'),
      }),
    );
  }
  if (field.owningLayer === undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCHEMA_CONSTITUTIONAL_CONSTANT_MISSING_LAYER,
        reason: `宪法常量字段 ${field.name} 缺少归属层。`,
        correctionSuggestion: '声明宪法常量的 owningLayer（引擎层/基类层/玩法层）。',
        jsonPath: joinJsonPath(path, 'owningLayer'),
      }),
    );
  }
}

function validateInternalMetricField(
  field: ParameterField,
  path: string,
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  if (field.internalMetricSchema === undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SCHEMA_INTERNAL_METRIC_MISSING_SCHEMA,
        reason: `内部度量字段 ${field.name} 缺少自有 Schema。`,
        correctionSuggestion: '内部度量按其声明的 Internal_Metric Schema 验证，而不是套用玩法数值范围（Requirements 5.6）。',
        jsonPath: joinJsonPath(path, 'internalMetricSchema'),
      }),
    );
  }
}

/** 校验单个 Schema 的字段名唯一性与跨字段约束引用完整性。 */
function validateSchemaShape(
  schema: ParameterSchema,
  basePath: string,
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const seen = new Map<string, number>();
  schema.fields.forEach((field, index) => {
    const previous = seen.get(field.name);
    if (previous !== undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SCHEMA_FIELD_DUPLICATE_NAME,
          reason: `参数 Schema 中字段名「${field.name}」重复（首次在 index ${previous}）。`,
          correctionSuggestion: '同一 Schema 内字段名必须唯一。',
          jsonPath: joinJsonPath(basePath, 'fields', index, 'name'),
        }),
      );
    } else {
      seen.set(field.name, index);
    }
    // range 形状：min <= max。
    if (field.range !== undefined) {
      const { min, max } = field.range;
      if (min !== undefined && max !== undefined && min > max) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.SCHEMA_FIELD_RANGE_MALFORMED,
            reason: `字段 ${field.name} 的范围 min(${min}) 大于 max(${max})。`,
            correctionSuggestion: '确保 min <= max。',
            jsonPath: joinJsonPath(basePath, 'fields', index, 'range'),
          }),
        );
      }
    }
  });

  const fieldNames = new Set(schema.fields.map((field) => field.name));
  schema.crossFieldConstraints.forEach((constraint, index) => {
    for (const referenced of constraint.fields) {
      if (!fieldNames.has(referenced)) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.SCHEMA_CROSS_FIELD_CONSTRAINT_UNRESOLVED,
            reason: `跨字段约束 ${constraint.constraintId} 引用了不存在的字段「${referenced}」。`,
            correctionSuggestion: '跨字段约束只能引用同一 Schema 内已声明的字段。',
            jsonPath: joinJsonPath(basePath, 'crossFieldConstraints', index),
          }),
        );
      }
    }
  });
}

/** 参数与数值规则总入口。遍历定义的参数 Schema 与嵌套组件参数。 */
export function validateParameters(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const schemaPath = joinJsonPath(definition.jsonPath ?? '', 'parameterSchema');
  validateSchemaShape(definition.parameterSchema, schemaPath, definition, context, collector);
  forEachField(definition.parameterSchema, schemaPath, (field, path) => {
    validateField(field, path, definition, context, collector);
  });

  definition.composition.forEach((component, index) => {
    if (component.parameters !== undefined) {
      const path = joinJsonPath(definition.jsonPath ?? '', 'composition', index, 'parameters');
      validateSchemaShape(component.parameters, path, definition, context, collector);
      forEachField(component.parameters, path, (field, fieldPath) => {
        validateField(field, fieldPath, definition, context, collector);
      });
    }
  });
}
