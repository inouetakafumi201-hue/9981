/**
 * scope 感知的诊断工厂（design.md「Diagnostics」/ 需求 14.2-14.4、14.12）。
 *
 * 强制规则：
 * - 每条诊断都有稳定 code、severity、scope、来源包、reason、correctionSuggestion。
 * - `definition` scope 必须有 definition ID + JSON path + source span。
 * - `document` scope 必须有来源文档与解析位置，且 `at`/`path` 为**显式 null**（不编造定义标识）。
 * - `change-set` scope 必须有配额/候选上下文，`at` 为显式 null。
 * - `registry` scope 必须有 expected/actual 基线身份。
 * - 结构上不适用的定位字段一律显式 `null`，这依赖任务 1.3 对共享 `Diagnostic` 的可空扩展。
 */
import type { CompilationStage, Diagnostic, SourceSpan } from '../../kernel/state/diagnostic.js';
import type { Value } from '../../kernel/state/value.js';
import type { ValidationStage } from '../model/stage.js';
import type { DiagnosticCodeCatalog } from './code-catalog.js';
import type { DiagnosticSelector } from './code-map.js';

/** UGC 阶段 → 共享 `CompilationStage`。共享枚举粒度较粗，精确阶段另存于 `messageKey`。 */
const STAGE_TO_COMPILATION_STAGE: Readonly<Record<ValidationStage, CompilationStage>> = {
  'ingress': 'intake',
  'decode': 'parse',
  'schema-migration': 'migration',
  'canonicalize': 'canonicalization',
  'request-binding': 'canonicalization',
  'baseline': 'intake',
  'definition-validation': 'schema',
  'reference-resolution': 'reference',
  'presentation-resolution': 'semantic',
  'activation-precheck': 'commit-recheck',
};

export interface DiagnosticCommonInput {
  readonly selector: DiagnosticSelector;
  readonly stage: ValidationStage;
  readonly sourcePackage: string;
  /** 面向实现者的英文技术原因。 */
  readonly message: string;
  /** 面向创作者的中文原因说明。 */
  readonly reason: string;
  /** 一条可执行的修正建议。禁止建议"绕过验证"或"直接改 WorldState"（需求 14.12）。 */
  readonly correctionSuggestion: string;
  readonly expected?: Value;
  readonly actual?: Value;
  /** 本诊断自身的稳定标识，供 skipped check 关联。 */
  readonly rootCauseId?: string;
  /** 由更早诊断派生时指向其 rootCauseId。 */
  readonly derivedFrom?: string;
  readonly messageArgs?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DocumentDiagnosticInput extends DiagnosticCommonInput {
  /** 解析位置。document scope 必须给出位置，`file` 承载来源文档标识。 */
  readonly sourceSpan: SourceSpan;
}

export interface DefinitionDiagnosticInput extends DiagnosticCommonInput {
  readonly definitionId: string;
  readonly jsonPath: string;
  readonly sourceSpan: SourceSpan;
}

export interface ChangeSetDiagnosticInput extends DiagnosticCommonInput {
  /** 最近可用的位置；确实不存在时为 null。 */
  readonly sourceSpan: SourceSpan | null;
  readonly jsonPath: string | null;
}

export interface RegistryDiagnosticInput extends DiagnosticCommonInput {
  readonly expectedBaseline: string;
  readonly actualBaseline: string;
}

/** 主机/基础设施 scope：UGC 自身或宿主配置的问题，不是创作者输入问题。 */
export interface HostDiagnosticInput extends DiagnosticCommonInput {
  readonly sourceSpan: SourceSpan | null;
}

export interface UGCDiagnosticFactory {
  document(input: DocumentDiagnosticInput): Diagnostic;
  definition(input: DefinitionDiagnosticInput): Diagnostic;
  changeSet(input: ChangeSetDiagnosticInput): Diagnostic;
  registry(input: RegistryDiagnosticInput): Diagnostic;
  host(input: HostDiagnosticInput): Diagnostic;
}

/**
 * 未映射代码时抛出。这不是创作者可见错误，而是实现缺陷：
 * 调用方必须在编译期就通过 `DiagnosticSelector` 保证映射存在，运行时到达这里说明映射表与调用点不一致。
 */
export class UnmappedDiagnosticError extends Error {
  constructor(category: string, condition: string) {
    super(`UGC diagnostic mapping missing for ${category}/${condition}`);
    this.name = 'UnmappedDiagnosticError';
  }
}

export function messageKeyFor(stage: ValidationStage, selector: DiagnosticSelector): string {
  return `ugc/${stage}/${selector.category}/${selector.condition}`;
}

export function createDiagnosticFactory(catalog: DiagnosticCodeCatalog): UGCDiagnosticFactory {
  function base(input: DiagnosticCommonInput): Omit<Diagnostic, 'at' | 'path' | 'sourceSpan' | 'scope'> {
    const code = catalog.resolve(input.selector.category, input.selector.condition);
    if (code === null) {
      throw new UnmappedDiagnosticError(input.selector.category, input.selector.condition);
    }
    const severity = catalog.severity(code);
    const hint = catalog.hint(code);
    const messageKey = messageKeyFor(input.stage, input.selector);
    const result: Record<string, unknown> = {
      code,
      severity,
      message: input.message,
      reason: input.reason,
      correctionSuggestion: input.correctionSuggestion,
      creatorMessage: input.reason,
      actionableHint: input.correctionSuggestion,
      phase: 0,
      stage: STAGE_TO_COMPILATION_STAGE[input.stage],
      messageKey,
      sourcePackage: input.sourcePackage,
      rootCauseId: input.rootCauseId ?? messageKey,
      isDerived: input.derivedFrom !== undefined,
    };
    if (hint !== null) result['hint'] = hint;
    if (severity === 'fatal') result['haltClass'] = 'infrastructure';
    if (input.expected !== undefined) result['expected'] = input.expected;
    if (input.actual !== undefined) result['actual'] = input.actual;
    if (input.derivedFrom !== undefined) result['derivedFrom'] = input.derivedFrom;
    if (input.messageArgs !== undefined) result['messageArgs'] = input.messageArgs;
    return result as unknown as Omit<Diagnostic, 'at' | 'path' | 'sourceSpan' | 'scope'>;
  }

  return Object.freeze({
    document(input: DocumentDiagnosticInput): Diagnostic {
      return Object.freeze({
        ...base(input),
        scope: 'document',
        at: null,
        path: null,
        sourceSpan: input.sourceSpan,
      });
    },
    definition(input: DefinitionDiagnosticInput): Diagnostic {
      return Object.freeze({
        ...base(input),
        scope: 'definition',
        at: { def: input.definitionId },
        path: input.jsonPath,
        sourceSpan: input.sourceSpan,
      });
    },
    changeSet(input: ChangeSetDiagnosticInput): Diagnostic {
      return Object.freeze({
        ...base(input),
        scope: 'change-set',
        at: null,
        path: input.jsonPath,
        sourceSpan: input.sourceSpan,
      });
    },
    registry(input: RegistryDiagnosticInput): Diagnostic {
      return Object.freeze({
        ...base(input),
        scope: 'registry',
        at: null,
        path: null,
        sourceSpan: null,
        expected: input.expectedBaseline,
        actual: input.actualBaseline,
        baselineId: input.expectedBaseline,
      });
    },
    host(input: HostDiagnosticInput): Diagnostic {
      return Object.freeze({
        ...base(input),
        scope: 'host',
        at: null,
        path: null,
        sourceSpan: input.sourceSpan,
      });
    },
  });
}

/** 构造一个只承载文档身份的零宽 span，用于"位置不可定位但必须给出来源文档"的场合。 */
export function documentAnchorSpan(documentId: string, offset = 0): SourceSpan {
  const point = { line: 1, column: 1, offset } as const;
  return { file: documentId, start: point, end: point };
}
