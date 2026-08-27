/**
 * 上游 opaque handle（design.md「Upstream definition ports」/ 需求 1.2、7.1-7.12、15.6-15.8）。
 *
 * 设计约束：UGC **不复制** Def kind、领域字段、继承/组合求值或引用求值结构。因此这些 handle 只暴露
 * UGC 自己需要用来做"结果完整性检查、确定性检查、表现回退资格判定和诊断定位"的最小信息，其余一律
 * 装在 `payload: unknown` 里对 UGC 不透明。UGC 读不懂 payload，也不应该读懂。
 */
import type { SourceSpan } from '../../kernel/state/diagnostic';
import type { TargetOwnership } from './candidate';

/** 上游验证通过的候选。`payload` 由基类层拥有，UGC 只转交。 */
export interface UpstreamValidatedCandidate {
  readonly providerId: string;
  /** 候选中出现的定义标识，按上游给出的稳定顺序。UGC 用它做定位、计数与配额核对。 */
  readonly definitionIds: readonly string[];
  readonly payload: unknown;
}

export interface UpstreamReferenceEdge {
  readonly fromDefinitionId: string;
  readonly jsonPath: string;
  readonly toDefinitionId: string;
  readonly expectedKind: string;
  readonly semanticFamily: string;
  /** 跨领域引用的提供领域；同层内部引用为 `null`。 */
  readonly providerDomain: string | null;
}

/** 上游解析完成的依赖图。需求 7.8/7.12 要求出边与入边都确定且顺序稳定。 */
export interface UpstreamResolvedReferenceGraph {
  readonly providerId: string;
  readonly nodes: readonly string[];
  readonly outboundEdges: readonly UpstreamReferenceEdge[];
  readonly inboundEdges: readonly UpstreamReferenceEdge[];
  /** 被替换/删除定义的传递入边闭包中，本次已重验的活动定义（需求 7.10）。 */
  readonly revalidatedDependents: readonly string[];
  readonly payload: unknown;
}

/** 目标注册表的纯读快照。UGC 只读版本与指纹，不读也不写内部结构。 */
export interface DefinitionRegistryReadSnapshot {
  readonly registryVersion: string;
  readonly snapshotFingerprint: string;
  readonly targetOwnership: TargetOwnership;
  readonly activeDefinitionIds: readonly string[];
  readonly payload: unknown;
}

/**
 * 字段分类。只有 `presentation-optional` 才可能进入表现回退；其余一律走语义严格拒绝（需求 10.4、10.7）。
 *
 * `presentation-required` 表示"是表现资源，但 Schema 未标记为 optional"——它不可回退，缺失即错误。
 */
export const FIELD_CLASSIFICATIONS = ['semantic', 'presentation-optional', 'presentation-required'] as const;
export type FieldClassification = (typeof FIELD_CLASSIFICATIONS)[number];

export interface PresentationAssetIdentity {
  readonly assetId: string;
  /** 类型兼容性标记。回退资产的 typeTag 必须与原字段契约一致，否则视为不兼容（需求 10.4）。 */
  readonly typeTag: string;
}

/** 上游报告的一处表现资源缺口。`missingAsset` 为 `null` 表示资源已损坏且无法识别原标识。 */
export interface PresentationGap {
  readonly definitionId: string;
  readonly jsonPath: string;
  readonly missingAsset: string | null;
  readonly expectedTypeTag: string;
  readonly sourceSpan: SourceSpan | null;
}

/**
 * 上游 Schema 视图。UGC 通过它判定资格与语义指纹，但不实现任何 Schema 规则。
 *
 * `provesNonSemantic` 是需求 10.4 与 Glossary 中 `Presentation_Field` 定义的直接编码：名称或文本
 * **只有在上游 Schema 能够证明**其不参与标识、查询、可见性、决策或规则时才可被当作表现字段。
 * 端口返回 `false` 时 UGC 必须按语义字段处理，而不是自行推断"看起来像是装饰性文本"。
 */
export interface UpstreamSchemaView {
  readonly schemaCatalogVersion: string;
  classifyField(definitionId: string, jsonPath: string): FieldClassification;
  provesNonSemantic(definitionId: string, jsonPath: string): boolean;
  fallbackFor(definitionId: string, jsonPath: string): PresentationAssetIdentity | null;
  /** 上游按当前 Schema 列出的表现资源缺口，顺序必须稳定。 */
  listPresentationGaps(candidate: UpstreamValidatedCandidate): readonly PresentationGap[];
  /** 排除全部表现资源后的语义指纹。回退前后必须严格相同（需求 10.6）。 */
  semanticFingerprint(candidate: UpstreamValidatedCandidate): string;
  /** 在隔离副本上应用回退决定，产生新的候选值；不得修改传入候选。 */
  withResolvedPresentation(
    candidate: UpstreamValidatedCandidate,
    resolved: readonly { readonly definitionId: string; readonly jsonPath: string; readonly asset: PresentationAssetIdentity }[],
  ): UpstreamValidatedCandidate;
}
