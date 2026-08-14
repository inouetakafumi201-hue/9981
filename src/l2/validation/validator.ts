/**
 * L2 Validation: Definition_Validator 框架、结果聚合与包形状验证。
 *
 * 对应 Requirements 1.3、2.7、4.1、4.8、13.1–13.12、15.2 与 design.md `Definition_Validator`。
 *
 * 统一入口收集全部可确定发现的诊断并稳定排序（Requirements 13.8）；
 * 不遇错即停、不静默修复。Warning 不改变语义且允许后续按策略激活（Requirements 13.5）。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import type { Diagnostic, ValidationResult } from '../model/diagnostic.js';
import { hasError } from '../model/diagnostic.js';
import { errorDiagnostic } from '../model/diagnostic-factory.js';
import { canonicalSort, compareDiagnostics } from '../model/ordering.js';
import { isWellFormedId, joinJsonPath, ROOT_JSON_PATH } from '../model/ids.js';
import type { CandidateDefinition, DefinitionPackage, SemanticFamilyRegistration } from '../model/definition.js';
import type { CompiledSpecification } from '../compiler/types.js';
import { KNOWN_SEMANTIC_FAMILY_IDS } from '../model/family-contracts.js';
import { DiagnosticCollector, type DefinitionRule, type ValidationContext } from './context.js';
import { defError } from './helpers.js';
import {
  validateDefKind,
  validateNoL1Mechanism,
  validateNoGameplaySpecificRule,
  validateNoUnclassifiedGameplayValue,
  validateTerminology,
  validateNoDeprecatedMechanic,
  validateSemanticFamily,
  validateAbstractInstantiation,
} from './classification-rules.js';
import { validateParameters } from './parameter-rules.js';
import { validateInheritanceAndComposition } from './inheritance-composition-rules.js';
import { validateActionsAndGateways } from './action-gateway-rules.js';
import { validateSpatial } from './spatial-rules.js';
import { validateItemsAndVehicles } from './item-vehicle-rules.js';
import { validateEffectsAndAi } from './effect-ai-rules.js';
import { validateUnresolvedItems } from './space-items-unresolved-gate-rules.js';
import { validateWriteChannel } from './space-items-write-channel-rules.js';
import { validateSceneRules } from './space-items-scene-rules.js';
import { validateMicroSceneRules } from './space-items-micro-scene-rules.js';
import { validateTransitionRules } from './space-items-transition-rules.js';
import { validateItemRules } from './space-items-item-rules.js';
import { validateVehicleRules } from './space-items-vehicle-rules.js';
import { validateContainerCapabilityBinding } from './space-items-container-rules.js';
import { validateReferenceCapabilityShape } from './space-items-reference-shape.js';
import { validateCompositionAlignment } from './composition-alignment-rules.js';

/** 全部定义级规则，按确定性顺序执行。 */
export const DEFINITION_RULES: readonly DefinitionRule[] = Object.freeze([
  validateDefKind,
  validateNoL1Mechanism,
  validateNoGameplaySpecificRule,
  validateNoUnclassifiedGameplayValue,
  validateTerminology,
  validateNoDeprecatedMechanic,
  validateSemanticFamily,
  validateAbstractInstantiation,
  validateParameters,
  validateInheritanceAndComposition,
  validateActionsAndGateways,
  validateSpatial,
  validateItemsAndVehicles,
  validateEffectsAndAi,
  // 空间与物品基类层特定规则（按依赖顺序）
  validateUnresolvedItems,
  validateWriteChannel,
  validateSceneRules,
  validateMicroSceneRules,
  validateTransitionRules,
  validateItemRules,
  validateVehicleRules,
  validateContainerCapabilityBinding,
  validateReferenceCapabilityShape,
  // ECS 收敛：原子 System 接线与 compositionKind（Requirements 3、5）
  validateCompositionAlignment,
]);

export interface BuildContextInput {
  readonly package: DefinitionPackage;
  readonly activeDefinitionIds?: ReadonlySet<string>;
  readonly activeAbstractIds?: ReadonlySet<string>;
  readonly compiled?: CompiledSpecification;
  /** 活动注册表中已登记的族。 */
  readonly activeFamilies?: ReadonlyMap<string, SemanticFamilyRegistration>;
}

/** 由候选包与活动状态构造验证上下文。 */
export function buildValidationContext(input: BuildContextInput): ValidationContext {
  const candidateDefinitions = input.package.definitions;
  const abstractIds = new Set<string>(input.activeAbstractIds ?? []);
  for (const definition of candidateDefinitions) {
    if (definition.abstract) {
      abstractIds.add(definition.id);
    }
  }

  const registeredFamilies = new Map<string, SemanticFamilyRegistration>(input.activeFamilies ?? []);
  for (const familyId of KNOWN_SEMANTIC_FAMILY_IDS) {
    if (!registeredFamilies.has(familyId)) {
      // 已知族无需登记体；用占位登记表示"已登记"。此登记不参与三判据再验证。
      registeredFamilies.set(familyId, undefined as unknown as SemanticFamilyRegistration);
    }
  }
  for (const definition of candidateDefinitions) {
    const registration = definition.semanticFamily.registration;
    if (registration !== undefined) {
      registeredFamilies.set(registration.familyId, registration);
    }
  }
  for (const registration of input.compiled?.registeredFamilies ?? []) {
    registeredFamilies.set(registration.familyId, registration);
  }

  return {
    package: input.package,
    candidateDefinitions,
    activeDefinitionIds: input.activeDefinitionIds ?? new Set<string>(),
    registeredFamilies,
    abstractDefinitionIds: abstractIds,
    ...(input.compiled === undefined ? {} : { compiled: input.compiled }),
  };
}

/** 包形状与元数据验证（Requirements 4.1、4.8）。 */
export function validatePackageShape(
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const pkg = context.package;

  if (!isWellFormedId(pkg.packageId)) {
    collector.add(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.PKG_MISSING_METADATA,
        reason: `定义包缺少良构的 packageId（收到 ${JSON.stringify(pkg.packageId)}）。`,
        correctionSuggestion: '声明良构的 packageId。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'packageId'),
        sourcePackage: isWellFormedId(pkg.packageId) ? pkg.packageId : undefined,
      }),
    );
  }
  if (typeof pkg.schemaVersion !== 'string' || pkg.schemaVersion.trim().length === 0) {
    collector.add(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.PKG_MISSING_METADATA,
        reason: '定义包缺少 schemaVersion。',
        correctionSuggestion: '声明显式 schemaVersion。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'schemaVersion'),
        ...(isWellFormedId(pkg.packageId) ? { sourcePackage: pkg.packageId } : {}),
      }),
    );
  }

  // 定义标识良构、唯一（Requirements 4.1、4.8）。
  const seen = new Map<string, number>();
  pkg.definitions.forEach((definition, index) => {
    if (!isWellFormedId(definition.id)) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.DEF_MALFORMED_IDENTIFIER,
          reason: `定义标识「${String(definition.id)}」不是良构标识符。`,
          correctionSuggestion: '标识符首字符为字母，其余为字母、数字、_ . : -。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', index, 'id'),
        }),
      );
    }
    const previous = seen.get(definition.id);
    if (previous !== undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.DEF_DUPLICATE_IDENTIFIER,
          reason: `定义标识「${definition.id}」在同一解析范围内重复（首次在 index ${previous}）。`,
          correctionSuggestion: '同一解析范围内定义标识必须唯一（Requirements 4.8）。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', index, 'id'),
        }),
      );
    } else {
      seen.set(definition.id, index);
    }
    // 每个定义至少一条 Source_Record（Requirements 16.9 对规范契约的最低要求在编译器；
    // 定义级至少要求非空以保证可追溯）。
    if (definition.sourceRecords.length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.DEF_MISSING_SOURCE_RECORD,
          reason: `定义 ${definition.id} 缺少 Source_Record。`,
          correctionSuggestion: '为每个定义登记至少一条 Source_Record 以保证可追溯（Requirements 4.10、16.9）。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', index, 'sourceRecords'),
        }),
      );
    }
  });
}

/** 校验分类（供 UGC/Codec 复用的轻量分类检查，只跑分类相关规则）。 */
export function validateClassification(
  definition: CandidateDefinition,
  context: ValidationContext,
): readonly Diagnostic[] {
  const collector = new DiagnosticCollector();
  validateDefKind(definition, context, collector);
  validateNoL1Mechanism(definition, context, collector);
  validateNoGameplaySpecificRule(definition, context, collector);
  validateNoUnclassifiedGameplayValue(definition, context, collector);
  validateTerminology(definition, context, collector);
  validateNoDeprecatedMechanic(definition, context, collector);
  validateSemanticFamily(definition, context, collector);
  validateAbstractInstantiation(definition, context, collector);
  return canonicalSort(collector.all(), compareDiagnostics);
}

/**
 * 验证整个候选包。
 *
 * 运行包形状验证 + 每个定义的全部规则，聚合并稳定排序诊断。
 * 该函数只做**结构与语义**验证；引用图、依赖解析与原子激活在 resolution/registry 层完成。
 */
export function validatePackage(context: ValidationContext): ValidationResult {
  const collector = new DiagnosticCollector();
  validatePackageShape(context, collector);

  for (const definition of context.candidateDefinitions) {
    for (const rule of DEFINITION_RULES) {
      rule(definition, context, collector);
    }
  }

  return { diagnostics: canonicalSort(collector.all(), compareDiagnostics) };
}

export { hasError };
