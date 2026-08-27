/**
 * Diagnostic 结构类型（design.md 3.14/4.3节 / 需求39.1）。
 *
 * 物理上放在 kernel/state（L1）而非 kernel/safety（L13），理由与 ErrCode/Expr 相同：
 * 这是零运行时逻辑的纯数据形状，只依赖 L1 的 Ref/Value/Id/ErrCode。L3 的 InvariantChecker.checkAll
 * 需要在装载 L13 之前就能返回 Diagnostic[]，若类型定义在 L13 会造成 L3 反向 import L13。
 * L13（kernel/safety）拥有的是运行时逻辑：DiagnosticSink.emit/onFatal、hint 规则、去重折叠、熔断。
 */
import type { Id, Ref } from './ids';
import type { Value } from './value';
import type { ErrCode } from './error-codes';

export type Severity = 'fatal' | 'error' | 'warn' | 'info';

export interface SourcePoint {
  /** 1-based creator-facing line number. */
  readonly line: number;
  /** 1-based Unicode code-point column. */
  readonly column: number;
  /** 0-based UTF-8 byte offset into the immutable source bytes. */
  readonly offset: number;
}

export interface SourceSpan {
  readonly file: string;
  readonly start: SourcePoint;
  readonly end: SourcePoint;
  /** SHA-256 of the exact UTF-8 bytes covered by this span. Required by SpecificationCompiler. */
  readonly sourceSliceHash?: string;
}

export type SourceOwningLayer = '引擎层' | '基类层' | '玩法层';
export type SourceNormativeStatus = 'normative' | 'historical' | 'unresolved' | 'deprecated';

/** Immutable provenance attached to every specification node. */
export interface SourceRecord {
  readonly sourceId: string;
  readonly documentUri: string;
  readonly sourcePackage: string;
  readonly contentHash: string;
  readonly precedence: number;
  readonly decisionId?: string;
  readonly owningLayer: SourceOwningLayer;
  readonly normativeStatus: SourceNormativeStatus;
  readonly span: SourceSpan;
}

export type DiagnosticScope = 'document' | 'definition' | 'change-set' | 'registry' | 'host';
export type CompilationStage =
  | 'intake'
  | 'parse'
  | 'schema'
  | 'semantic'
  | 'precedence'
  | 'reference'
  | 'composition'
  | 'migration'
  | 'canonicalization'
  | 'commit-recheck'
  | 'staging-write'
  | 'publish'
  | 'rollback';
export type HaltClass = 'candidate' | 'infrastructure';
export type DiagnosticArgument = string | number | boolean | null;

export interface Diagnostic {
  readonly code: ErrCode;
  readonly severity: Severity;
  readonly message: string;
  /**
   * 结构化定位锚点。`undefined` 表示"未提供该定位维度"；显式 `null` 表示"该诊断作用域结构上
   * 确定适用定位，但此处取值为空"（例如 document-scope 解析诊断没有 definition id）。
   * 这与 `sourcePackage`/`sourceSpan` 已有的 `T | null` 模式一致，是 wakeup-ugc 需求 14.4 要求的
   * "结构上不适用的定位字段以显式 null 表示"的共享契约扩展，UGC 不得为此另建第二诊断通道。
   */
  readonly at?: { def?: Id; field?: string; playpack?: Id } | null;
  readonly subject?: Ref;
  readonly path?: string | null;
  readonly expected?: Value;
  readonly actual?: Value;
  readonly cause?: Id;
  readonly hint?: string;
  readonly phase: number;
  readonly scope?: DiagnosticScope;
  readonly sourcePackage?: string | null;
  readonly sourceSpan?: SourceSpan | null;
  readonly reason?: string;
  readonly correctionSuggestion?: string;
  readonly rootCauseId?: string;
  readonly derivedFrom?: string;
  readonly isDerived?: boolean;

  /** Specification compiler extensions. Runtime diagnostics may omit these compatibility fields. */
  readonly haltClass?: HaltClass;
  readonly stage?: CompilationStage;
  readonly messageKey?: string;
  readonly messageArgs?: Readonly<Record<string, DiagnosticArgument>>;
  readonly creatorMessage?: string;
  readonly source?: SourceRecord;
  readonly relatedSources?: readonly SourceRecord[];
  readonly blockingCode?: ErrCode;
  readonly baselineId?: string;
  readonly compilationId?: string;
  readonly actionableHint?: string;
}
