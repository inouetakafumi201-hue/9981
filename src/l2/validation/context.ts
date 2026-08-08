/**
 * L2 Validation: 验证上下文与规则协议。
 *
 * 对应 design.md `Definition_Validator` 与 Requirements 4.1、13.1–13.12。
 *
 * 验证器收集**全部**可确定发现的错误后统一排序输出，不遇错即停、不静默修复
 * （Requirements 13.8、13.10）。每条规则接收只读上下文，向共享收集器追加诊断。
 */

import type { Diagnostic } from '../model/diagnostic.js';
import type { CandidateDefinition, DefinitionPackage } from '../model/definition.js';
import type { CompiledSpecification } from '../compiler/types.js';
import type { SemanticFamilyRegistration } from '../model/definition.js';

/** 诊断收集器：所有规则共享，保证一次验证收齐全部诊断。 */
export class DiagnosticCollector {
  private readonly items: Diagnostic[] = [];

  add(diagnostic: Diagnostic): void {
    this.items.push(diagnostic);
  }

  addAll(diagnostics: readonly Diagnostic[]): void {
    for (const diagnostic of diagnostics) {
      this.items.push(diagnostic);
    }
  }

  all(): readonly Diagnostic[] {
    return this.items;
  }
}

/**
 * 验证上下文。
 *
 * `registeredFamilies` 合并了编译器已登记的族与已知族；`activeDefinitionIds` 是当前活动注册表
 * 中的标识，用于跨包引用与重复标识判定。上下文全部只读。
 */
export interface ValidationContext {
  readonly package: DefinitionPackage;
  readonly compiled?: CompiledSpecification;
  /** 本候选包内可见的全部定义（含 additions/overrides）。 */
  readonly candidateDefinitions: readonly CandidateDefinition[];
  /** 当前活动注册表中的定义标识。 */
  readonly activeDefinitionIds: ReadonlySet<string>;
  /** 已登记语义族（族 id → 登记体）。 */
  readonly registeredFamilies: ReadonlyMap<string, SemanticFamilyRegistration>;
  /** 抽象定义标识集合（候选 + 活动），用于实例化目标检查。 */
  readonly abstractDefinitionIds: ReadonlySet<string>;
}

/** 单条定义级验证规则。 */
export type DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
) => void;

/** 包级验证规则。 */
export type PackageRule = (context: ValidationContext, collector: DiagnosticCollector) => void;
