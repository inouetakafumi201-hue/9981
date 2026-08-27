/**
 * L2 Model: 语义状态、授权范围、只读投影、运行时请求与适配器描述符。
 *
 * 对应 Requirements 6、10.7–10.12、13.6–13.7、14.1–14.11 与 design.md 的
 * `Read_Only_Semantic_Projection` / `Presentation_Descriptor` / `Validated_Op_Request` 数据模型。
 *
 * 边界铁律：本文件不定义任何写入能力。运行时请求只是**数据**，
 * 唯一的语义写入通道是 `registry/action-submitter.ts` 调用的 `OpRegistry.invoke`。
 */

import type { ActionId, AiPolicyId, FieldName, HumanReadableText, JsonPath, OpId, SemanticFamilyId, TagId } from './ids';
import type { JsonValue } from './json';
import type { Diagnostic } from './diagnostic';
import type { OwningLayer, SourceClassificationKind, SourceLocation } from './source';
import type { ReadOnlyResolvedDefinition } from './definition';
import type {
  ActionCostCategory,
  AiPolicyCategory,
  InteractionIntent,
  ResolvedCardPresentation,
  ResourceSemanticRole,
} from './family-contracts';

// ───────────────────────────────────────────────────────────────────────────
// 语义状态（由 L1 提供，L2 只读）
// ───────────────────────────────────────────────────────────────────────────

/** 语义属性。`resourceRole` 让 UI 不必依赖字段名猜测资源（Requirements 14.3）。 */
export interface SemanticProperty {
  readonly name: FieldName;
  readonly value: JsonValue;
  readonly resourceRole?: ResourceSemanticRole;
  readonly playerVisible: boolean;
}

export interface SemanticStateEntry {
  readonly entityId: string;
  readonly definitionId?: string;
  readonly properties: readonly SemanticProperty[];
  readonly statusIds: readonly string[];
  readonly locationNodeId?: string;
  /** 姿态语义标签；由 L1 运行时状态提供，L2 不枚举具体取值。 */
  readonly posture?: string;
}

export interface BeliefFact {
  readonly factId: string;
  readonly subject: string;
  readonly value: JsonValue;
}

export interface BeliefSlice {
  readonly agentId: string;
  readonly facts: readonly BeliefFact[];
}

export interface VisibilityEntry {
  readonly agentId: string;
  readonly visibleEntityIds: readonly string[];
  readonly visibleNodeIds: readonly string[];
}

/**
 * 运行时语义状态视图。
 * `turn` 是 `Internal_Metric`（回合编号），不受 1–5 约束。
 */
export interface RuntimeSemanticState {
  readonly turn: number;
  readonly entities: readonly SemanticStateEntry[];
  readonly beliefSlices: readonly BeliefSlice[];
  readonly visibility: readonly VisibilityEntry[];
}

export const EMPTY_RUNTIME_SEMANTIC_STATE: RuntimeSemanticState = Object.freeze({
  turn: 0,
  entities: Object.freeze([]) as readonly SemanticStateEntry[],
  beliefSlices: Object.freeze([]) as readonly BeliefSlice[],
  visibility: Object.freeze([]) as readonly VisibilityEntry[],
});

// ───────────────────────────────────────────────────────────────────────────
// 授权范围与只读投影
// ───────────────────────────────────────────────────────────────────────────

export const PROJECTION_CONSUMERS = ['ai', 'ui', 'test', 'other'] as const;
export type ProjectionConsumer = (typeof PROJECTION_CONSUMERS)[number];

/**
 * Authorization_Scope：投影裁剪依据。
 * 未列入的 agent 认知与不可见实体/节点不得出现在投影中（Requirements 10.7、14.1）。
 */
export interface AuthorizationScope {
  readonly scopeId: string;
  readonly consumer: ProjectionConsumer;
  readonly agentId?: string;
  readonly authorizedBeliefAgentIds: readonly string[];
  readonly visibleEntityIds: readonly string[];
  readonly visibleNodeIds: readonly string[];
  /** 未声明时表示"所有已注册族均可见"；声明时按白名单裁剪定义。 */
  readonly authorizedDefinitionFamilies?: readonly SemanticFamilyId[];
  readonly authorizedResourceRoles: readonly ResourceSemanticRole[];
}

/** Read_Only_Semantic_Projection：深度不可变，不是活动对象的可写别名。 */
export interface ReadOnlySemanticProjection {
  readonly scopeId: string;
  readonly consumer: ProjectionConsumer;
  readonly turn: number;
  readonly definitions: readonly ReadOnlyResolvedDefinition[];
  readonly entities: readonly SemanticStateEntry[];
  readonly beliefSlices: readonly BeliefSlice[];
  readonly visibility: readonly VisibilityEntry[];
  /** 语义状态指纹：用于断言"请求前后语义状态等价"。 */
  readonly semanticStateFingerprint: string;
}

// ───────────────────────────────────────────────────────────────────────────
// 运行时请求与提交
// ───────────────────────────────────────────────────────────────────────────

/** 试图写入语义字段的声明；投影/描述符路径上出现即拒绝（Requirements 10.8、14.10）。 */
export interface SemanticFieldWrite {
  readonly path: JsonPath;
  readonly value: JsonValue;
}

export interface ActionRequest {
  readonly requestId: string;
  readonly actionId: ActionId;
  readonly actorId: string;
  readonly targetIds: readonly string[];
  // 参数可以是 JsonValue 或 Ref（{ $: string }），后者用于 node/item 目标绑定
  readonly parameters: Readonly<Record<FieldName, JsonValue | { readonly $: string }>>;
  readonly semanticFieldWrites?: readonly SemanticFieldWrite[];
}

export const CALLER_KINDS = ['ai', 'ui', 'other'] as const;
export type CallerKind = (typeof CALLER_KINDS)[number];

export interface CallerContext {
  readonly callerId: string;
  readonly kind: CallerKind;
  readonly scope: AuthorizationScope;
  readonly policyId?: AiPolicyId;
}

/** Op 因果链信息。 */
export interface OpCause {
  readonly requestId: string;
  readonly callerId: string;
  readonly callerKind: CallerKind;
  readonly actionId: ActionId;
}

/** 已验证的 Op 请求：`submit` 的唯一输出形态。 */
export interface ValidatedOpRequest {
  readonly actionId: ActionId;
  readonly opId: OpId;
  // args 同时支持 JsonValue 和 Ref，直接透传 UI 绑定的 Ref（需要 kernel 支持）
  readonly args: Readonly<Record<string, JsonValue | { readonly $: string }>>;
  readonly cause: OpCause;
}

/** L1 Op 执行结果（由 KernelContract 返回，L2 只透传）。 */
export interface OpResult {
  readonly opId: OpId;
  readonly applied: boolean;
  readonly journalEntries: readonly string[];
  readonly semanticStateFingerprintAfter: string;
}

// ───────────────────────────────────────────────────────────────────────────
// UI 描述符（Requirements 14）
// ───────────────────────────────────────────────────────────────────────────

export interface ResourceDescriptor {
  readonly entityId: string;
  readonly role: ResourceSemanticRole;
  readonly value: JsonValue;
  readonly accessibleLabel: string;
}

export interface TargetDescriptor {
  readonly targetId: string;
  readonly intent: InteractionIntent;
  readonly executable: boolean;
  readonly accessibleLabel: string;
}

export interface ActionDescriptor {
  readonly actionId: ActionId;
  readonly costCategory: ActionCostCategory;
  readonly interactionIntent?: InteractionIntent;
  // 2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：attackShape 字段已删除。
  // 攻击形状判定为冗余设计，已被武器属性（散射/扫射/连发）完全覆盖。详见
  // src/l2/model/family-contracts.ts 顶部权威变更说明。
  readonly posture?: string;
  readonly available: boolean;
  readonly unavailabilityReason?: HumanReadableText;
  readonly accessibleLabel: string;
  readonly assetRefs: readonly string[];
  readonly targets: readonly TargetDescriptor[];
  /**
   * 双轨制轨道（双轨制 P1）。从 L1 ActionDef.track 透传到 L2 投影。
   * - `'highlight'`：高亮轨（地图直接点实体）
   * - `'card'`：卡片轨（发牌器渲染）
   */
  readonly track: 'highlight' | 'card';
  /**
   * 已求值的卡片元数据（双轨制 P1）。仅当 `track === 'card'` 时出现。
   * `cardPresentation` 缺省时前端使用默认基线值（图标=assetRefs[0]）。
   */
  readonly cardPresentation?: ResolvedCardPresentation;
}

/** 规范地位标签（Requirements 16.12–16.13）。 */
export interface ProvenanceLabel {
  readonly definitionId: string;
  readonly classification: SourceClassificationKind;
  readonly owningLayer: OwningLayer;
  readonly nonNormative: boolean;
  readonly nonDefault: boolean;
  readonly sourceLocation: SourceLocation;
  readonly label: HumanReadableText;
}

export interface PresentationDescriptor {
  readonly scopeId: string;
  /** 渲染器标识只用于回归对比：更换它不得改变任何语义动作标识或验证结果。 */
  readonly rendererId?: string;
  readonly resources: readonly ResourceDescriptor[];
  readonly paidActions: readonly ActionDescriptor[];
  readonly attachedActions: readonly ActionDescriptor[];
  readonly provenanceLabels: readonly ProvenanceLabel[];
  readonly warnings: readonly Diagnostic[];
}

export interface UiQuery {
  readonly actorId: string;
  readonly includeUnavailable: boolean;
  readonly rendererId?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// AI 视图（Requirements 10）
// ───────────────────────────────────────────────────────────────────────────

export interface AiLegalAction {
  readonly actionId: ActionId;
  readonly tags: readonly TagId[];
  readonly targetIds: readonly string[];
  readonly costCategory: ActionCostCategory;
}

export interface AiSemanticView {
  readonly policyId: AiPolicyId;
  readonly policyCategory: AiPolicyCategory;
  readonly projection: ReadOnlySemanticProjection;
  readonly legalActions: readonly AiLegalAction[];
  readonly diagnostics: readonly Diagnostic[];
}

/** AI 评估结果的规范化输出（Requirements 10.10）。 */
export interface AiEvaluationOutcome {
  readonly raw: unknown;
  readonly usedFallback: boolean;
  readonly value: number;
  readonly diagnostics: readonly Diagnostic[];
}
