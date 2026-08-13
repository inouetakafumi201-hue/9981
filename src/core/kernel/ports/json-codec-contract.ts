/**
 * 引擎层 JSON 编解码稳定端口契约（L0 不可变）
 *
 * 职责：通用 RFC 7159 JSON 解析，拒绝危险构造、配额超限、格式错误，不涉及语义解释。
 * 消费方：基类层 L2、玩法层、UGC 集成
 * 版本：1.0.0（2026-08-11）
 *
 * 演变规则（v1.1+ 只能扩展，不能删除已导出项）：
 * - 可增加新的 error code
 * - 可增强拒绝条件（如更严格的配额）
 * - 不能改变现有 code 的语义
 * - 不能删除现有公共导出
 */

/**
 * 候选文档输入（创作者源码）
 */
export interface CandidateDocumentInput {
  readonly sourceId: string;
  readonly documentUri: string;
  readonly sourcePackage: string;
  readonly sourceText: string;
  readonly precedence: number;
  readonly owningLayer: '基类层' | '玩法层' | '引擎层';
  readonly normativeStatus: 'normative' | 'informative' | 'deprecated' | 'historical';
}

/**
 * 技术配额原语（防御性资源限制）
 *
 * 所有限制均为绝对上限，运行时不可更改。超限即拒绝。
 */
export interface TechnicalQuotas {
  /** 输入 UTF-8 字节数上限（防止 OOM） */
  readonly inputBytes: number;
  /** 嵌套深度上限（防止栈溢出） */
  readonly nestingDepth: number;
  /** 对象成员数上限 */
  readonly objectMembers: number;
  /** 数组元素数上限 */
  readonly arrayElements: number;
  /** AST 节点数上限 */
  readonly astNodes: number;
  /** 定义数上限 */
  readonly definitions: number;
  /** 引用边数上限 */
  readonly referenceEdges: number;
  /** 遍历工作量上限 */
  readonly traversalWork: number;
  /** 诊断数上限 */
  readonly diagnostics: number;
  /** 输出字节数上限 */
  readonly outputBytes: number;
  /** 迁移步数上限 */
  readonly migrationSteps: number;
  /** 标识符长度上限 */
  readonly identifierLength: number;
  /** 包依赖边数上限 */
  readonly packageDependencyEdges: number;
}

/**
 * 解析后的源码记录（精确定位能力）
 *
 * 包含完整的 UTF-8 字节偏移与内容哈希，支持创作者诊断定位。
 */
export interface SourceRecord {
  readonly sourceId: string;
  readonly documentUri: string;
  readonly sourcePackage: string;
  /** UTF-8 SHA-256 哈希 */
  readonly contentHash: string;
  readonly precedence: number;
  readonly owningLayer: '基类层' | '玩法层' | '引擎层';
  readonly normativeStatus: 'normative' | 'informative' | 'deprecated' | 'historical';
  readonly span: SourceSpan;
}

/**
 * 源码位置跨度（UTF-8 精确）
 *
 * 所有偏移都是 0-indexed，按 UTF-8 字节计。
 * 支持多行、多字节字符、CRLF 混合。
 */
export interface SourceSpan {
  readonly file: string;
  readonly start: SourcePoint;
  readonly end: SourcePoint;
  /** 跨度内容的 SHA-256 哈希（创作者诊断定位） */
  readonly sourceSliceHash: string;
}

export interface SourcePoint {
  /** 1-indexed 行号 */
  readonly line: number;
  /** 0-indexed 列号（UTF-16 代码单元，兼容 VSCode） */
  readonly column: number;
  /** 0-indexed UTF-8 字节偏移 */
  readonly offset: number;
}

/**
 * JSON 解析结果
 *
 * 成功时包含规范化快照，失败时不改变状态。
 */
export interface ParsedCandidateDocument {
  readonly input: CandidateDocumentInput;
  readonly value: JsonValue;
  readonly sourceRecord: SourceRecord;
}

/** JSON 支持的值类型 */
export type JsonValue = null | boolean | number | string | JsonObject | JsonArray;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonArray = readonly JsonValue[];

/**
 * JSON 编解码器错误分类
 */
export enum JsonCodecErrorCode {
  /** JSON 语法错误 */
  PARSE_ERROR = 'E_LOAD_JSON_SYNTAX',
  /** 重复对象成员 */
  DUPLICATE_MEMBER = 'E_LOAD_DUPLICATE_MEMBER',
  /** 禁止的构造（如 __proto__、$eval） */
  PROHIBITED_CONSTRUCT = 'E_LOAD_PROHIBITED_CONSTRUCT',
  /** 非有限数字（NaN、Infinity） */
  NON_FINITE_NUMBER = 'E_LOAD_NON_FINITE_NUMBER',
  /** 超过配额 */
  QUOTA_EXCEEDED = 'E_LOAD_QUOTA_EXCEEDED',
  /** 未转义控制字符 */
  UNESCAPED_CONTROL_CHAR = 'E_LOAD_UNESCAPED_CONTROL',
}

/**
 * JSON 编解码异常
 */
export interface JsonCodecError extends Error {
  readonly code: JsonCodecErrorCode;
  readonly line: number;
  readonly column: number;
  readonly offset: number;
  readonly context: string;
}

/**
 * 严格 JSON 编解码器端口
 *
 * 单向：仅支持 parse。
 * 契约：
 * - ✅ 拒绝重复键、危险键、非有限数、控制字符、配额超限、深嵌套
 * - ✅ 返回精确 SourceRecord（含 SHA-256 sourceSliceHash）
 * - ✅ 确定性排序、canonical JSON 支持
 * - ❌ 不补造默认值
 * - ❌ 不进行语义解释
 * - ❌ 不支持 JSON5 扩展（注释、尾逗号等）
 */
export interface StrictJsonCodecPort {
  parse(
    input: CandidateDocumentInput,
    quotas: TechnicalQuotas,
  ): ParsedCandidateDocument;
}

/**
 * Canonical JSON 序列化器端口
 *
 * 职责：确定性规范化，用于快照与指纹计算。
 * 契约：
 * - ✅ 键按 UTF-16 代码单元字典序排序
 * - ✅ -0 标准化为 0
 * - ✅ 非有限数拒绝
 * - ✅ 相同值多次调用产生字节等价输出
 * - ❌ 不涉及语义变换
 */
export interface CanonicalJsonPort {
  stringify(value: JsonValue): string;
}

/**
 * 默认配额（通用上限）
 *
 * 可被宿主在编译期替换，运行时不可更改。
 */
export const DEFAULT_TECHNICAL_QUOTAS: TechnicalQuotas = {
  inputBytes: 10 * 1024 * 1024, // 10 MB
  nestingDepth: 512,
  objectMembers: 10000,
  arrayElements: 100000,
  astNodes: 100000,
  definitions: 5000,
  referenceEdges: 50000,
  traversalWork: 1000000,
  diagnostics: 10000,
  outputBytes: 50 * 1024 * 1024, // 50 MB
  migrationSteps: 100,
  identifierLength: 256,
  packageDependencyEdges: 5000,
};
