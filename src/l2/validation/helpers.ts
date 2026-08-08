/**
 * L2 Validation: 规则共享的诊断构造辅助。
 *
 * 统一填充 definitionId / jsonPath / sourcePackage / sourceLocation，
 * 使每条诊断都可定位、可修复（Requirements 13.2）。
 */

import type { StableDiagnosticCode, HumanReadableText, JsonPath } from '../model/ids.js';
import type { Diagnostic } from '../model/diagnostic.js';
import { errorDiagnostic, warningDiagnostic } from '../model/diagnostic-factory.js';
import type { CandidateDefinition } from '../model/definition.js';
import type { ValidationContext } from './context.js';
import type { SourceRecord } from '../model/source.js';

export interface RuleDiagnosticInput {
  readonly code: StableDiagnosticCode;
  readonly reason: HumanReadableText;
  readonly correctionSuggestion: HumanReadableText;
  readonly jsonPath?: JsonPath;
  readonly relatedSources?: readonly SourceRecord[];
}

/** 为某个定义构造 Error 诊断（自动补 definitionId/sourcePackage/sourceLocation）。 */
export function defError(
  context: ValidationContext,
  definition: CandidateDefinition,
  input: RuleDiagnosticInput,
): Diagnostic {
  return errorDiagnostic({
    code: input.code,
    reason: input.reason,
    correctionSuggestion: input.correctionSuggestion,
    definitionId: definition.id,
    jsonPath: input.jsonPath ?? definition.jsonPath ?? '',
    sourcePackage: context.package.packageId,
    ...(definition.sourceLocation === undefined ? {} : { sourceLocation: definition.sourceLocation }),
    ...(input.relatedSources === undefined ? {} : { relatedSources: input.relatedSources }),
  });
}

/** 为某个定义构造 Warning 诊断。 */
export function defWarning(
  context: ValidationContext,
  definition: CandidateDefinition,
  input: RuleDiagnosticInput,
): Diagnostic {
  return warningDiagnostic({
    code: input.code,
    reason: input.reason,
    correctionSuggestion: input.correctionSuggestion,
    definitionId: definition.id,
    jsonPath: input.jsonPath ?? definition.jsonPath ?? '',
    sourcePackage: context.package.packageId,
    ...(definition.sourceLocation === undefined ? {} : { sourceLocation: definition.sourceLocation }),
    ...(input.relatedSources === undefined ? {} : { relatedSources: input.relatedSources }),
  });
}
