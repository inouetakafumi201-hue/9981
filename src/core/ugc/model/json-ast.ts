/**
 * 纯 JSON 语法树类型（design.md「Structural JSON decoder」/ 需求 2.1、2.8-2.9、11.1）。
 *
 * 这**不是**引擎层的 Expr AST，也永远不会被求值。它只是"保留了来源位置和重复成员的 JSON 语法结构"。
 * 保留重复成员是必需的：普通对象物化会让后值静默覆盖前值，从而丢掉需求 2.9 要求检测的冲突。
 */
import type { SourceSpan } from '../../kernel/state/diagnostic';
import type { CandidateSource, TargetOwnership } from './candidate';

export interface JsonMember {
  readonly key: string;
  readonly keySpan: SourceSpan;
  readonly value: JsonAst;
}

export type JsonAst =
  | { readonly kind: 'null'; readonly span: SourceSpan }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly span: SourceSpan }
  | {
      readonly kind: 'number';
      /** 原始词法形式。保留它才能在诊断中如实回显作者写下的数字，并检测非有限值。 */
      readonly lexical: string;
      readonly value: number;
      readonly span: SourceSpan;
    }
  | { readonly kind: 'string'; readonly value: string; readonly span: SourceSpan }
  | { readonly kind: 'array'; readonly elements: readonly JsonAst[]; readonly span: SourceSpan }
  | { readonly kind: 'object'; readonly members: readonly JsonMember[]; readonly span: SourceSpan };

export type JsonAstKind = JsonAst['kind'];

export function astSpan(ast: JsonAst): SourceSpan {
  return ast.span;
}

/** 解码完成的候选文档。`schemaVersion` 由文档自身显式声明（需求 12.1），不由 UGC 推断。 */
export interface ParsedCandidateDocument {
  readonly source: CandidateSource;
  readonly targetOwnership: TargetOwnership;
  readonly schemaVersion: string;
  readonly ast: JsonAst;
}

/** 迁移后的候选文档，附带原始版本与已应用的迁移边标识，便于诊断与确定性核对。 */
export interface MigratedCandidateDocument extends ParsedCandidateDocument {
  readonly originalSchemaVersion: string;
  readonly appliedMigrationIds: readonly string[];
}
