/**
 * 手写、编辑器、自然语言与导入适配器（design.md「Candidate ingress」/ 需求 3.1-3.10；tasks.md 6.1）。
 *
 * 四个适配器**结构上完全同形**：都只把创作输入变成 UTF-8 字节 + 来源元数据 + 目标层。
 * 它们共享同一个 `createCandidateDocument`，因此从严格解码器开始的整条生产调用链、配额档案、
 * Schema 版本选择和诊断策略都是同一条——不存在"官方工具走快车道"的可能（需求 3.2、3.9）。
 *
 * 这里刻意**没有**：`validated` 标记、severity 调整、registry 句柄、Op 调用、WorldState 访问、
 * 激活入口或持久化写入。适配器无法通过任何字段给自己的输出赋予特权（需求 3.4、3.5）。
 */
import type {
  CandidateDocument,
  CandidateSource,
  CandidateSourceKind,
  TargetOwnership,
  UGCAdapter,
} from '../model/candidate';
import { createCandidateDocument } from '../model/candidate';

const utf8Encoder = new TextEncoder();

/**
 * 所有适配器的唯一实现。
 *
 * 之所以让四种来源共用一个工厂而不是各写一份：只要有两份实现，就有两份实现产生分歧的可能，
 * 而"不同来源走同一条路"正是需求 3 的核心。差异只体现在 `sourceKind` 这一个审计字段上。
 */
function createTextAdapter<Input>(
  sourceKind: CandidateSourceKind,
  toText: (input: Input) => string,
): UGCAdapter<Input> {
  return Object.freeze({
    sourceKind,
    toCandidate(input: Input, source: CandidateSource, target: TargetOwnership): CandidateDocument {
      // 来源种类以适配器自身为准，避免调用方伪造成另一种来源。即便伪造也不改变任何验证规则，
      // 但审计信息必须如实。
      const attributed: CandidateSource = { ...source, kind: sourceKind };
      return createCandidateDocument(attributed, target, utf8Encoder.encode(toText(input)));
    },
  });
}

/** 手写 JSON：输入已经是 JSON 文本。 */
export const handAuthoredAdapter: UGCAdapter<string> = createTextAdapter('hand-authored', (text) => text);

/**
 * 图形化编辑器：输入是编辑器状态的**已序列化**声明式 JSON 文本。
 *
 * 适配器不理解编辑器语义，也不做语义校验——那是上游 Definition Validator 的职责。
 * 它只负责把编辑器产物变成候选字节。
 */
export const editorAdapter: UGCAdapter<string> = createTextAdapter('editor', (text) => text);

/**
 * 自然语言适配器：输入是模型产出的**声明式 JSON 文本**。
 *
 * 模型对话策略、提示工程和模型访问都在本 Spec 范围之外；这里只接收其最终 JSON 文本产物。
 * 模型输出与手写 JSON 享有完全相同的（零）信任级别（需求 2.2）。
 */
export const naturalLanguageAdapter: UGCAdapter<string> = createTextAdapter('natural-language-adapter', (text) => text);

/** 导入工具：输入是外部来源的 JSON 文本。 */
export const importAdapter: UGCAdapter<string> = createTextAdapter('import', (text) => text);

/** 全部适配器，供跨来源等价性测试枚举（需求 3.10、16.2）。 */
export const ALL_ADAPTERS: readonly UGCAdapter<string>[] = Object.freeze([
  handAuthoredAdapter,
  editorAdapter,
  naturalLanguageAdapter,
  importAdapter,
]);
