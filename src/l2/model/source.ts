/**
 * L2 Model: 来源追踪模型（Source_Record、来源优先级、规范分类、三判据证据）。
 *
 * 对应 Requirements 1.1–1.13、5.11–5.12、16.1–16.13 与 design.md 的 `Source_Record` 数据模型。
 *
 * 设计补充（记录于 `src/l2/决策与风险记录.md` D-L2-002）：
 * design.md 的 `compile(records: readonly Source_Record[])` 中，`Source_Record` 只包含追踪元数据
 * （文件、定位、优先级、决策编号、分类、归属层、指纹），本身不携带"被主张的内容"，因此无法被裁决。
 * 本实现把可裁决单元建模为 `SourceStatement`，每个 statement 内嵌它的 `SourceRecord`；
 * 编译入口签名相应为 `compile(statements: readonly SourceStatement[])`。
 * 这是对设计的理解性补充，不改变任何裁决语义。
 */

import type {
  DecisionId,
  FieldName,
  HumanReadableText,
  JsonPath,
  SemanticFamilyId,
  SourceFileId,
  StableFingerprint,
} from './ids';

/**
 * 来源优先级（Requirements 1.1）。
 * 数值越小优先级越高；该序号是 `Internal_Metric`（比较用序数），不是玩法数值。
 */
export const SOURCE_PRECEDENCE_ORDER = [
  'l0-constitution',
  'confirmed-interview-decision',
  'l1-boundary-invariant',
  'finalized-l2-contract',
  'unresolved-l2-content',
  'historical-example',
] as const;

export type SourcePrecedence = (typeof SOURCE_PRECEDENCE_ORDER)[number];

/** 返回优先级序数：越小越高。未知优先级返回 `Number.MAX_SAFE_INTEGER` 而不是抛异常。 */
export function precedenceRank(precedence: SourcePrecedence): number {
  const index = SOURCE_PRECEDENCE_ORDER.indexOf(precedence);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** 归属层（规范宪法术语铁律：只使用 引擎层 / 基类层 / 玩法层）。 */
export const OWNING_LAYERS = ['引擎层', '基类层', '玩法层'] as const;
export type OwningLayer = (typeof OWNING_LAYERS)[number];

/** 规范分类（Requirements 16.1）。 */
export const SOURCE_CLASSIFICATION_KINDS = [
  'Normative_Contract',
  'L3_Profile',
  'Historical_Example',
  'Unresolved_Item',
] as const;
export type SourceClassificationKind = (typeof SOURCE_CLASSIFICATION_KINDS)[number];

/** 分类的规范化排序序数，用于确定性输出。 */
export function classificationRank(kind: SourceClassificationKind): number {
  const index = SOURCE_CLASSIFICATION_KINDS.indexOf(kind);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * 来源段落标记（Requirements 16.2）。
 * 带任一标记的段落在没有更高优先级决策时不得成为 L2 默认。
 */
export const SOURCE_MARKERS = ['示例', '待定', '占位', '候选', '未来', '需专题讨论'] as const;
export type SourceMarker = (typeof SOURCE_MARKERS)[number];

/** 来源定位。包含文件是为了让每条诊断都能独立回溯，不依赖上下文推断。 */
export interface SourceLocation {
  readonly sourceFile: SourceFileId;
  /** 文档内定位：标题路径、表格行或条目编号。 */
  readonly section: string;
  readonly line?: number;
  readonly column?: number;
}

/**
 * 来源跨度定位（精确 UTF-8 字节映射）
 *
 * 用于诊断输出时的精确定位，支持行列号与字节偏移转换。
 * sourceSliceHash 用于完整性验证，防止来源文档被篡改。
 */
export interface SourceSpan {
  readonly startLine: number;
  readonly startColumn: number;
  readonly startByteOffset: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly endByteOffset: number;
  /** 跨度内容的 SHA-256 哈希（UTF-8 字节）。用于来源完整性验证。 */
  readonly sourceSliceHash: string;
}

/** Source_Record：design.md 数据模型的直接实现。 */
export interface SourceRecord {
  readonly sourceFile: SourceFileId;
  readonly sourceLocation: SourceLocation;
  readonly precedence: SourcePrecedence;
  readonly decisionId?: DecisionId;
  readonly classification: SourceClassificationKind;
  readonly owningLayer: OwningLayer;
  readonly statementFingerprint: StableFingerprint;
  /**
   * 精确的来源跨度定位（若可用）
   *
   * 当来源由 JSON codec 或标准化工具解析时包含。
   * 若来源是手动输入或不支持精确映射，可为 undefined。
   */
  readonly span?: SourceSpan;
}

/**
 * 数值示例的规范分类（Requirements 5.11）。
 * 与 `Parameter_Field.classification` 不同：后者描述"字段本身归谁"，
 * 本枚举描述"来源里出现的这个具体数字应被当作什么"。
 */
export const NUMERIC_EXAMPLE_CLASSIFICATIONS = [
  'Structural_Bound',
  'Constitutional_Constant',
  'L3_Profile',
  'Historical_Example',
  'Unresolved_Item',
] as const;
export type NumericExampleClassification = (typeof NUMERIC_EXAMPLE_CLASSIFICATIONS)[number];

/**
 * 无权威来源支撑时禁止晋升为规范常量的实现常量类别（Requirements 5.12）。
 */
export const UNSUPPORTED_CONSTANT_KINDS = [
  'character-limit',
  'collection-capacity',
  'file-size-limit',
  'test-count',
] as const;
export type UnsupportedConstantKind = (typeof UNSUPPORTED_CONSTANT_KINDS)[number];

/** 来源中出现的一个具体数字。 */
export interface NumericExample {
  readonly fieldName: FieldName;
  readonly value: number;
  readonly jsonPath?: JsonPath;
  /** 来源自称的分类；编译器仍会独立判定并在不一致时产生诊断。 */
  readonly proposedClassification?: NumericExampleClassification;
  /** 是否被提议为 L2 规范常量。 */
  readonly proposedAsNormativeConstant: boolean;
  /** 若被提议为规范常量，属于哪一类实现常量。 */
  readonly constantKind?: UnsupportedConstantKind;
  /** 是否存在权威来源支撑（由来源导入方标注，编译器据此执行 5.12）。 */
  readonly authoritativeSupport: boolean;
  /** 玩家可见性：仅玩家可见的玩法数值受 1–5 宪法约束。 */
  readonly playerVisible: boolean;
  readonly structuralRationale?: HumanReadableText;
}

/** 三判据证据（design.md `classifyProposedFamily`）。 */
export interface FamilyEligibilityEvidence {
  readonly conceptId: SemanticFamilyId;
  /** 在当前玩法范围内可被有限列举。 */
  readonly enumerable: boolean;
  readonly enumerationRationale: HumanReadableText;
  /** 可与其他基类组合产生实例。 */
  readonly composable: boolean;
  readonly compositionRationale: HumanReadableText;
  /** 不依赖任何具体玩法 Profile。 */
  readonly gameplayIndependent: boolean;
  readonly independenceRationale: HumanReadableText;
  readonly sources: readonly SourceRecord[];
}

/** 三判据判定结果。 */
export interface EligibilityVerdict {
  readonly conceptId: SemanticFamilyId;
  readonly accepted: boolean;
  readonly failedCriteria: readonly ('enumerable' | 'composable' | 'gameplayIndependent')[];
}

/**
 * 一条可裁决的来源陈述。
 *
 * `claimKey` 是"同一语义主张"的归组键：不同来源对同一主张给出不同内容时才构成冲突。
 * 它由来源导入方显式给出，而不是由文本相似度猜测——猜测会把两个不同主张误判为冲突。
 */
export interface SourceStatement {
  readonly claimKey: string;
  readonly text: HumanReadableText;
  readonly record: SourceRecord;
  /** 该陈述提议登记新语义族时的三判据证据。 */
  readonly eligibility?: FamilyEligibilityEvidence;
  readonly markers: readonly SourceMarker[];
  /** 该陈述复述了废案清单中的禁止机制（Requirements 16.7–16.8）。 */
  readonly deprecatedMechanic: boolean;
  /**
   * 该陈述显式声明的机制名清单。
   *
   * 废案检测只扫描本字段与 `deprecatedMechanic`，**不扫描 `text`**：
   * 对自由文本做子串匹配会把恰好含相同字样的合法内容误判为废案，
   * 也会让"按名称分类"从后门溜回来（Requirements 16.3 禁止按名称分类）。
   */
  readonly declaredMechanics: readonly string[];
  /** 该陈述与某个具体玩法 Profile 耦合（Requirements 16.3–16.4）。 */
  readonly gameplayProfileCoupled: boolean;
  /** 该陈述属于纯表现内容：UI mockup、动画时序、性能/预算/人员估算（Requirements 16.5）。 */
  readonly presentationOnly: boolean;
  readonly numericExamples: readonly NumericExample[];
  /** 该陈述提议的规范内容负载；仅在成为 Normative_Contract 时被下游消费。 */
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * 验证来源跨度的完整性
 *
 * 检查：
 * - 行列号与字节偏移的单调性
 * - SHA-256 哈希格式（64 个十六进制字符）
 */
export function validateSourceSpan(span: SourceSpan): readonly string[] {
  const issues: string[] = [];

  if (span.startLine > span.endLine) {
    issues.push('startLine must be <= endLine');
  }
  if (span.startLine === span.endLine && span.startColumn > span.endColumn) {
    issues.push('on same line, startColumn must be <= endColumn');
  }
  if (span.startByteOffset > span.endByteOffset) {
    issues.push('startByteOffset must be <= endByteOffset');
  }

  if (!/^[a-f0-9]{64}$/.test(span.sourceSliceHash)) {
    issues.push('sourceSliceHash must be a 64-character hex string (SHA-256)');
  }

  return issues;
}

/**
 * 计算两个 SourceSpan 的并集（假设来自同一文件）
 *
 * 用于诊断聚合时合并相关位置。
 */
export function mergeSourceSpans(a: SourceSpan, b: SourceSpan): SourceSpan {
  const startLine = Math.min(a.startLine, b.startLine);
  const startColumn = startLine === a.startLine ? Math.min(a.startColumn, b.startColumn) : 
                      startLine === b.startLine ? Math.min(a.startColumn, b.startColumn) : 0;
  const startByteOffset = Math.min(a.startByteOffset, b.startByteOffset);

  const endLine = Math.max(a.endLine, b.endLine);
  const endColumn = endLine === a.endLine && endLine === b.endLine ? Math.max(a.endColumn, b.endColumn) :
                    endLine === a.endLine ? a.endColumn :
                    endLine === b.endLine ? b.endColumn : 0;
  const endByteOffset = Math.max(a.endByteOffset, b.endByteOffset);

  // 并集后的 hash 无法精确计算（需要原始文本），设为 undefined 或取 a 的 hash 作占位
  // 这里采用占位策略（实际诊断不应依赖并集的 hash）
  return {
    startLine,
    startColumn,
    startByteOffset,
    endLine,
    endColumn,
    endByteOffset,
    sourceSliceHash: a.sourceSliceHash, // 占位
  };
}

export interface NormativeContract {
  readonly claimKey: string;
  readonly statement: SourceStatement;
  readonly authoritativeSource: SourceRecord;
  readonly owningLayer: OwningLayer;
}

/** 保留为未决的主张。 */
export interface UnresolvedItem {
  readonly claimKey: string;
  readonly statements: readonly SourceStatement[];
  readonly sources: readonly SourceRecord[];
  readonly reason: HumanReadableText;
  /** 解除未决状态所需的决策编号（若来源已经指明，例如 Q-01）。 */
  readonly awaitingDecisionId?: DecisionId;
}

/** 归 L3 的来源内容。 */
export interface L3ProfileEntry {
  readonly claimKey: string;
  readonly statement: SourceStatement;
  readonly sources: readonly SourceRecord[];
}

/** 历史示例。 */
export interface HistoricalExampleEntry {
  readonly claimKey: string;
  readonly statement: SourceStatement;
  readonly sources: readonly SourceRecord[];
}
