/**
 * 不可变候选与变更请求（design.md「Candidate ingress and source envelope」/ 需求 1.1、3.1、3.5、3.6）。
 *
 * 这里刻意不存在 `trusted`、`validated`、`activate`、`WorldState`、`OpRegistry`、注册表句柄或持久化写入器：
 * 候选只是"字节 + 来源元数据 + 目标层"。任何来源都无法通过构造候选获得特权（需求 3.4、3.9）。
 */

/** 创作入口种类。它只进入审计与诊断，不改变 Schema、配额、severity 或任何验证规则（需求 3.3）。 */
export const CANDIDATE_SOURCE_KINDS = [
  'hand-authored',
  'editor',
  'natural-language-adapter',
  'import',
] as const;
export type CandidateSourceKind = (typeof CANDIDATE_SOURCE_KINDS)[number];

/** 激活单元必须声明恰好一个目标归属层（需求 1.4）。 */
export const TARGET_OWNERSHIPS = ['base-layer', 'play-layer'] as const;
export type TargetOwnership = (typeof TARGET_OWNERSHIPS)[number];

export const CHANGE_OPERATIONS = ['add', 'replace', 'remove'] as const;
export type ChangeOperation = (typeof CHANGE_OPERATIONS)[number];

export interface CandidateSource {
  readonly kind: CandidateSourceKind;
  readonly documentId: string;
  readonly packageId: string;
  readonly sourceName: string;
  /**
   * 宿主审计序号。**不参与**规范化 JSON、候选指纹、变更请求指纹或诊断稳定排序
   * （design.md：审计顺序或 Adapter 展示名不得改变语义身份）。
   */
  readonly receivedAtSequence: number;
}

export interface CandidateDocument {
  readonly source: CandidateSource;
  readonly targetOwnership: TargetOwnership;
  /**
   * 原始 UTF-8 字节。由 `createCandidateDocument` 在构造时复制，因此调用方之后修改传入数组
   * 不会影响已创建的候选。UGC 内部只读取该数组，从不写入。
   */
  readonly utf8: Uint8Array;
}

export interface CandidateChangeRequest {
  readonly operation: ChangeOperation;
  readonly document: CandidateDocument;
  /** `replace` / `remove` 指向的现有目标标识；`add` 恒为 undefined。 */
  readonly expectedTargetId?: string;
}

/** 适配器边界：只能把创作输入转成候选字节与来源元数据，不能声明结果（需求 3.1、3.4、3.5）。 */
export interface UGCAdapter<Input> {
  readonly sourceKind: CandidateSourceKind;
  toCandidate(input: Input, source: CandidateSource, target: TargetOwnership): CandidateDocument;
}

export function isCandidateSourceKind(value: unknown): value is CandidateSourceKind {
  return typeof value === 'string' && (CANDIDATE_SOURCE_KINDS as readonly string[]).includes(value);
}

export function isTargetOwnership(value: unknown): value is TargetOwnership {
  return typeof value === 'string' && (TARGET_OWNERSHIPS as readonly string[]).includes(value);
}

export function isChangeOperation(value: unknown): value is ChangeOperation {
  return typeof value === 'string' && (CHANGE_OPERATIONS as readonly string[]).includes(value);
}

/** 稳定标识必须是非空且不含前后空白的字符串；空白差异会让同一来源产生两个身份。 */
export function isStableIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

export function createCandidateSource(input: {
  readonly kind: CandidateSourceKind;
  readonly documentId: string;
  readonly packageId: string;
  readonly sourceName: string;
  readonly receivedAtSequence: number;
}): CandidateSource {
  return Object.freeze({
    kind: input.kind,
    documentId: input.documentId,
    packageId: input.packageId,
    sourceName: input.sourceName,
    receivedAtSequence: input.receivedAtSequence,
  });
}

/** 构造候选文档。字节被复制，返回对象被冻结：外部之后的任何改动都不会影响它。 */
export function createCandidateDocument(
  source: CandidateSource,
  targetOwnership: TargetOwnership,
  utf8: Uint8Array,
): CandidateDocument {
  return Object.freeze({
    source: Object.isFrozen(source) ? source : createCandidateSource(source),
    targetOwnership,
    utf8: Uint8Array.prototype.slice.call(utf8, 0),
  });
}

export function createCandidateChangeRequest(input: {
  readonly operation: ChangeOperation;
  readonly document: CandidateDocument;
  readonly expectedTargetId?: string | undefined;
}): CandidateChangeRequest {
  const base = {
    operation: input.operation,
    document: input.document,
  };
  return Object.freeze(
    input.expectedTargetId === undefined ? base : { ...base, expectedTargetId: input.expectedTargetId },
  );
}

/** 返回候选字节的独立副本，供外部消费者读取而无法改动候选自身。 */
export function copyCandidateBytes(document: CandidateDocument): Uint8Array {
  return Uint8Array.prototype.slice.call(document.utf8, 0);
}

/**
 * 便捷构造：从 UTF-8 文本创建候选。仅用于测试与手写入口的便利，不改变任何验证语义——
 * 产出的候选与直接给出等价字节的候选完全同形。
 */
export function candidateFromText(
  source: CandidateSource,
  targetOwnership: TargetOwnership,
  text: string,
): CandidateDocument {
  return createCandidateDocument(source, targetOwnership, new TextEncoder().encode(text));
}
