/**
 * L2 验证：原子 System 接线验证器（spec Task 6 / 任务4）。
 * 对应 Requirements 3、5 与 design.md System 接线验证器。
 */
import type { CandidateDefinition } from '../model/definition.js';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids.js';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context.js';
import { defError } from './helpers.js';

const COMPOSITION_KINDS = ['static', 'transient', 'modified-explicit', 'modified-capability'] as const;

function isComponentId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith('component.');
}

export const validateCompositionAlignment: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);

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
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'parameters', index, 'name'),
          }),
        );
      }
    });
  }

  const compositionKind = def['compositionKind'];
  if (compositionKind !== undefined && typeof compositionKind === 'string'
    && !(COMPOSITION_KINDS as readonly string[]).includes(compositionKind)) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.COMPOSITION_KIND_INVALID,
        reason: 'invalid compositionKind.',
        correctionSuggestion: 'Use one of the four composition kinds.',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'compositionKind'),
      }),
    );
  }

  const kernelOps = def['kernelOps'];
  if (kernelOps !== undefined
    && (!Array.isArray(kernelOps) || kernelOps.some((op) => typeof op !== 'string'))) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SYSTEM_BINDING_MISSING_KERNELOPS,
        reason: 'kernelOps is not a string array.',
        correctionSuggestion: 'Declare kernelOps as an array of op names.',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'kernelOps'),
      }),
    );
  }

  if (def['id'] !== undefined && isComponentId(def['id'])) {
    const familyId = def['familyId'];
    if (typeof familyId !== 'string' || familyId.trim().length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SYSTEM_BINDING_MISSING_FAMILY,
          reason: 'component.* definition lacks familyId.',
          correctionSuggestion: 'Declare the component familyId.',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'familyId'),
        }),
      );
    }
  }
};
