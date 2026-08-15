/**
 * L2 验证：原子 System 接线验证器（spec Task 6 / 任务4）。
 * 对应 Requirements 3、5 与 design.md System 接线验证器。
 *
 * 覆盖范围（Requirements 3.2–3.4、3.7、5.2）：
 * - compositionKind 仅取四形之一，否则 `COMPOSITION_KIND_INVALID`（Requirements 5.1、5.2）；
 * - component.* 未显式声明 compositionKind 要求显式声明，否则 `COMPOSITION_KIND_NOT_DECLARED`（Requirements 3.7）；
 * - kernelOps 未声明或为空时 `SYSTEM_BINDING_MISSING_KERNELOPS`（Requirement 3.4 → Condition 4）；
 * - kernelOps 非法形状（非字符串数组）归入 `SYSTEM_BINDING_*` 系；op 名基本命名规范与
 *   space-items 先例一致（`namespace.operation`）；
 * - component parameter 无 name 时 `SYSTEM_BINDING_MALFORMED`；
 * - component.* 缺 familyId 时 `SYSTEM_BINDING_MISSING_FAMILY`。
 *
 * 定义侧校验边界（见 `src/l2/决策与风险记录.md` D-ECS-001）：
 * 这些 ECS 字段（`parameters`/`compositionKind`/`kernelOps`/`familyId`）尚未进入
 * `BaseDefinition` 接口，也不经 decoder 变入 `CandidateDefinition`。本规则通过
 * cast to `Record<string, unknown>` 读取，是在新收敛结构入口处的形状校验；
 * op 存在性与许可集合（Requirement 3.3）属于 H-ECS-03 交接项，由族级集成测试
 * 对比 `listOpNames()` 完成，context 不含 kernel 引用。
 */
import type { CandidateDefinition } from '../model/definition.js';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { COMPOSITION_KINDS } from '../model/composition-registry.js';
import { caSFieldMatches } from '../model/cas-field-alignment.js';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids.js';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context.js';
import { defError } from './helpers.js';

/** 收集 parameters 声明的槽位名（parameters[*].name；与组件契约 parameters 的 key 同源，宽容前缀存进 caSFieldMatches）。 */
function parametersArrayNames(parameters: unknown): readonly string[] {
  if (!Array.isArray(parameters)) return [];
  const names: string[] = [];
  for (const field of parameters) {
    const raw = field as Record<string, unknown> | null;
    if (raw === null || typeof raw !== 'object') continue;
    const name = raw['name'];
    if (typeof name === 'string' && name.trim().length > 0) names.push(name.trim());
  }
  return names;
}

function isComponentId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith('component.');
}

/** op 名基本命名规范：`namespace.operation`（与 space-items 先例一致）。 */
function isWellFormedOpName(opName: string): boolean {
  return opName.includes('.') && !opName.startsWith('.') && !opName.endsWith('.');
}

export const validateCompositionAlignment: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);
  const defPath = joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex);

  // 组件字段形状：每个 parameter 必须有非空 name（Requirements 3.2，CaS 缝隙的另一侧）。
  const parameters = def['parameters'];
  if (Array.isArray(parameters)) {
    parameters.forEach((field, index) => {
      const raw = field as Record<string, unknown>;
      if (raw === null || typeof raw !== 'object') return;
      const name = raw['name'];
      if (typeof name !== 'string' || name.trim().length === 0) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.SYSTEM_BINDING_MALFORMED,
            reason: 'component parameter lacks a non-empty name.',
            correctionSuggestion: 'Declare a non-empty name for every parameter.',
            jsonPath: joinJsonPath(defPath, 'parameters', index, 'name'),
          }),
        );
      }
    });
  }

  // compositionKind 四形（Requirements 5.1、5.2）。
  // 单一权威源：`COMPOSITION_KINDS` 从 composition-registry 导入，不在本规则重复定义。
  const compositionKind = def['compositionKind'];
  const hasDeclaredCompositionKind =
    compositionKind !== undefined && typeof compositionKind === 'string';
  if (hasDeclaredCompositionKind
    && !(COMPOSITION_KINDS as readonly string[]).includes(compositionKind)) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.COMPOSITION_KIND_INVALID,
        reason: `invalid compositionKind '${compositionKind}'.`,
        correctionSuggestion: 'Use one of the four composition kinds.',
        jsonPath: joinJsonPath(defPath, 'compositionKind'),
      }),
    );
  }

  // 组件字段名到 System 参数名的 CaS 缝隙闭合（Requirements 3.2、3.3）。
  // op 存在性/许可集合连接留给集成测试（H-ECS-03）；这里做形状与命名规范检查。
  const kernelOps = def['kernelOps'];
  const kernelOpsIsStringArray =
    Array.isArray(kernelOps) && kernelOps.every((op) => typeof op === 'string');
  if (kernelOps !== undefined && !kernelOpsIsStringArray) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SYSTEM_BINDING_MISSING_KERNELOPS,
        reason: 'kernelOps is not a string array.',
        correctionSuggestion: 'Declare kernelOps as an array of op names.',
        jsonPath: joinJsonPath(defPath, 'kernelOps'),
      }),
    );
  } else if (kernelOpsIsStringArray) {
    // kernelOps 引用字段名 ↔ parameters[*].name 是否落在同一通路（CaS 缝隙闭合）。
    // 单一权威判定收敛于 src/l2/model/cas-field-alignment.ts::caSFieldMatches（wakeup-cas-gap-closure
    // Req 1.1/3.2）：本路径（spec-compiler）与 src/play/profiles/audit 组合路径共用同一实现。
    const declaredSlots = new Set(
      parametersArrayNames(parameters),
    );
    for (let opIndex = 0; opIndex < kernelOps.length; opIndex += 1) {
      const opName = kernelOps[opIndex] as string;
      if (!isWellFormedOpName(opName)) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.SYSTEM_BINDING_MISSING_KERNELOPS,
            reason: `kernelOps op '${opName}' does not match the "namespace.operation" naming convention.`,
            correctionSuggestion: 'Use a well-formed op name, e.g. "item.move".',
            jsonPath: joinJsonPath(defPath, 'kernelOps', opIndex),
          }),
        );
      }
      if (caSFieldMatches(opName, declaredSlots) === 'no-match') {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.CAS_FIELD_GAP,
            reason: `kernelOps op '${opName}' references a field not declared in parameters (CaS 缝隙).`,
            correctionSuggestion: 'Declare the referenced field in parameters, or align the kernelOps field name.',
            jsonPath: joinJsonPath(defPath, 'kernelOps', opIndex),
          }),
        );
      }
    }
  }

  // component.* 特有要求（Requirements 3.4、3.7）。
  if (isComponentId(def['id'])) {
    // Requirement 3.4 → Condition 4：未声明或空 kernelOps 触发 SYSTEM_BINDING_*。
    if (!kernelOpsIsStringArray || kernelOps.length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SYSTEM_BINDING_MISSING_KERNELOPS,
          reason: 'component.* definition lacks kernelOps.',
          correctionSuggestion: 'Declare the kernelOps this component is read/written by.',
          jsonPath: joinJsonPath(defPath, 'kernelOps'),
        }),
      );
    }

    // Requirement 3.7：component.* 必须显式声明 compositionKind。
    if (!hasDeclaredCompositionKind) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.COMPOSITION_KIND_NOT_DECLARED,
          reason: 'component.* definition lacks an explicit compositionKind.',
          correctionSuggestion: 'Declare one of the four composition kinds explicitly.',
          jsonPath: joinJsonPath(defPath, 'compositionKind'),
        }),
      );
    }

    const familyId = def['familyId'];
    if (typeof familyId !== 'string' || familyId.trim().length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SYSTEM_BINDING_MISSING_FAMILY,
          reason: 'component.* definition lacks familyId.',
          correctionSuggestion: 'Declare the component familyId.',
          jsonPath: joinJsonPath(defPath, 'familyId'),
        }),
      );
    }
  }
};
