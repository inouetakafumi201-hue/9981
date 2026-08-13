/**
 * 引擎层诊断基础设施稳定端口契约（L0 不可变）
 *
 * 职责：通用诊断收集、排序、本地化消息管理。
 * 消费方：基类层 L2、玩法层、UGC 集成
 * 版本：1.0.0（2026-08-11）
 *
 * 演变规则：
 * - 可增加新的诊断 code 分组
 * - 可增加新的 locale bundle
 * - 不能删除现有 code
 * - 不能改变现有 code 的语义分类（如从 Error 改为 Warning）
 * - 不能删除现有 bundle entry
 */

import type { SourceRecord, SourceSpan } from './json-codec-contract.js';

/**
 * 诊断严重性
 *
 * Error：必须修复，才能继续
 * Warning：建议修复，但可以继续
 * Info：参考信息，无影响
 */
export enum DiagnosticSeverity {
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
}

/**
 * 诊断等级（内部使用）
 *
 * 用于排序与优先级决策
 */
export enum DiagnosticLevel {
  Fatal = 0, // 整个过程失败，无恢复机制
  Error = 1, // 致命错误，本地失败
  Warning = 2, // 警告，继续处理
  Info = 3, // 信息，无影响
}

/**
 * 诊断代码（闭集）
 *
 * 每个 code 对应唯一的问题类型与解决方案。
 * 由引擎层统一维护，多个上层可追加子代码。
 */
export interface DiagnosticCode {
  readonly codeId: string;
  readonly severity: DiagnosticSeverity;
  readonly level: DiagnosticLevel;
}

/**
 * 诊断消息（语言中立）
 *
 * 包含结构化字段，便于 i18n 与创作者工具集成。
 */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  /** 唯一定位到源码位置 */
  readonly sourceSpan?: SourceSpan;
  /** 字段路径（如 "/definitions/0/damage"） */
  readonly path?: string;
  /** 引用另一诊断的地方（如重复定义的第一个位置） */
  readonly relatedDiagnostic?: Diagnostic;
  /** 技术性错误消息（必填，用于调试与传译） */
  readonly technicalMessage: string;
  /** 创作者可读提示（可选，不填时由 bundle 生成） */
  readonly creatorMessage?: string;
  /** 修正建议（可选） */
  readonly suggestion?: string;
  /** 参数映射（如 identifier: "item.weapon"） */
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * 诊断工厂端口
 *
 * 职责：创建结构化诊断，收集与排序。
 * 契约：
 * - ✅ 所有诊断都有对应 code 与 severity
 * - ✅ 确定性排序（首先按 severity，其次按 sourceSpan 位置）
 * - ✅ 不丢弃任何 Error 级诊断
 * - ✅ 支持容量上限（超过立即拒绝）
 * - ❌ 不进行聚合或去重（去重由上层决策）
 */
export interface DiagnosticFactoryPort {
  /**
   * 创建诊断
   *
   * 失败场景：
   * - code 未登记 → 抛错
   * - 超过容量 → 抛错（fail-closed）
   */
  createDiagnostic(code: DiagnosticCode, sourceSpan?: SourceSpan): Diagnostic;

  /**
   * 批量排序诊断
   *
   * 顺序：Error (by location) → Warning (by location) → Info (by location)
   */
  sortDiagnostics(items: readonly Diagnostic[]): readonly Diagnostic[];

  /**
   * 检查诊断闭包
   *
   * 验证每个 code 都有对应的消息 bundle entry。
   * 失败时列出缺失 codes。
   */
  checkDiagnosticClosure(codes: readonly DiagnosticCode[], bundle: CreatorMessageBundle): ClosureIssue[];
}

/**
 * 创作者消息 Bundle（本地化）
 *
 * 映射 code → {title, guidance}。
 * 通过分离存储实现多语言支持。
 */
export interface CreatorMessageBundle {
  readonly locale: string; // 如 'zh-CN', 'en-US'
  readonly entries: Readonly<Record<string, CreatorMessageEntry>>;
}

export interface CreatorMessageEntry {
  /** 错误标题（一行） */
  readonly title: string;
  /** 创作者指导（可含占位符如 ${identifier}） */
  readonly guidance: string;
  /** 占位符参数列表 */
  readonly placeholders?: readonly string[];
}

/**
 * 诊断闭包问题
 */
export interface ClosureIssue {
  readonly code: string;
  readonly issue: 'code-not-in-bundle' | 'bundle-entry-missing-title' | 'bundle-entry-missing-guidance';
}

/**
 * 默认中文消息 Bundle（最小集合）
 *
 * 用于演示。生产应改为从 i18n 加载。
 */
export const DEFAULT_ZH_CN_BUNDLE: CreatorMessageBundle = {
  locale: 'zh-CN',
  entries: {
    E_LOAD_JSON_SYNTAX: {
      title: 'JSON 语法错误',
      guidance: '第 ${line} 行第 ${column} 列附近有 JSON 格式错误。请检查括号、引号、逗号是否匹配。',
      placeholders: ['line', 'column'],
    },
    E_LOAD_DUPLICATE_MEMBER: {
      title: '重复的对象成员',
      guidance: '对象中有多个同名的成员"${key}"。请保留一个，删除重复的。',
      placeholders: ['key'],
    },
  },
};

/**
 * 消息插值（参数填充）
 *
 * 职责：用 parameters 填充 guidance 中的占位符。
 * 契约：
 * - ✅ 替换 ${name} 形式的占位符
 * - ✅ 未知占位符保留原样
 * - ✅ 参数值经过 toString() 转换
 * - ✅ 已替换的文本不再被扫描（无递归展开）
 * - ❌ 不支持条件或循环
 */
export function interpolateCreatorMessage(
  guidance: string,
  parameters: Record<string, string | number | boolean>,
): string {
  let result = guidance;
  for (const [key, value] of Object.entries(parameters)) {
    result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

/**
 * 诊断排序器
 *
 * 全序关系：保障确定性输出
 */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  // 1. 按严重性排序
  const severityOrder = { error: 0, warning: 1, info: 2 };
  const severityDiff =
    severityOrder[a.code.severity as keyof typeof severityOrder] -
    severityOrder[b.code.severity as keyof typeof severityOrder];
  if (severityDiff !== 0) return severityDiff;

  // 2. 按源码位置排序
  if (a.sourceSpan && b.sourceSpan) {
    if (a.sourceSpan.file !== b.sourceSpan.file) {
      return a.sourceSpan.file.localeCompare(b.sourceSpan.file);
    }
    if (a.sourceSpan.start.offset !== b.sourceSpan.start.offset) {
      return a.sourceSpan.start.offset - b.sourceSpan.start.offset;
    }
  } else if (a.sourceSpan && !b.sourceSpan) {
    return -1;
  } else if (!a.sourceSpan && b.sourceSpan) {
    return 1;
  }

  // 3. 按代码排序
  return a.code.codeId.localeCompare(b.code.codeId);
}
