/**
 * L2 Model: 各语义族的契约负载。
 *
 * 对应 Requirements 6（动作与网关）、7（空间）、8（物品/装备/载具）、9（效果类）、
 * 10（AI 行为）与 14（UI 语义值）。
 *
 * 所有契约只声明"接口形状"，不含具体玩法赋值：
 * - 具体伤害、成本、阈值、持续时间等以 `Parameter_Field` 声明，由 L3 填值。
 * - 契约上出现的 `concrete*` / `named*` / `embedded*` 字段是**违规检测面**：
 *   它们存在的唯一目的是让验证器能确定性地发现越层声明并给出定位，而不是让 L2 使用它们。
 * - Q-01~Q-05 相关字段只保留引用与接口，不推导机制或默认值。
 */

import type {
  ContainerId,
  DoorId,
  FieldName,
  HumanReadableText,
  OpId,
  SeatRoleId,
  SemanticFamilyId,
  SlotId,
  TagId,
} from './ids.js';
import type { JsonValue } from './json.js';
import type { ExpectedReferenceType, ParameterSchema } from './schema.js';
import type { SourceRecord } from './source.js';
import type { TypedReference } from './reference.js';

// ───────────────────────────────────────────────────────────────────────────
// 通用片段
// ───────────────────────────────────────────────────────────────────────────

/** 结构边界声明：必须带权威来源与结构理由（Requirements 5.3）。 */
export interface StructuralBoundDeclaration {
  readonly value: number;
  readonly authoritativeSource: SourceRecord;
  readonly structuralRationale: HumanReadableText;
}

/** 交互意图（Requirements 14.4）。 */
export const INTERACTION_INTENTS = [
  'traversal',
  'precise-interaction',
  'hostile-interaction',
  'executable-target',
] as const;
export type InteractionIntent = (typeof INTERACTION_INTENTS)[number];

/**
 * 2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：`ATTACK_SHAPES`/`AttackShape` 已删除。
 * 攻击形状（single-target/spread/area 三选一形状轴）判定为冗余设计，其功能已被武器属性
 * （散射/扫射/连发）完全覆盖。后续维护者与并行会话请以 `docs/L0_规范宪法.md`、
 * `docs/L2_基类层/基类层定义.md` §4.3 最新权威内容为准，并核查
 * `.kiro/specs/l2-base-layer-spec`、`.kiro/specs/wakeup-space-items`、
 * `.kiro/specs/wakeup-ui-animation` 三个规范的同步变更记录。
 */

/** 资源语义角色（Requirements 14.3）。 */
export const RESOURCE_SEMANTIC_ROLES = ['hp', 'stamina', 'ap'] as const;
export type ResourceSemanticRole = (typeof RESOURCE_SEMANTIC_ROLES)[number];

/** 动作施动者要求。 */
export interface ActorRequirement {
  readonly requirementId: string;
  readonly capability: string;
  readonly conditionExprRef?: TypedReference;
}

/** 目标种类。 */
export const TARGET_KINDS = ['entity', 'item', 'node', 'link', 'attachment', 'self', 'none'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** 动作目标要求。目标上限只能引用参数字段，不能内嵌具体数字。 */
export interface TargetRequirement {
  readonly requirementId: string;
  readonly targetKind: TargetKind;
  readonly expectedFamily?: SemanticFamilyId;
  readonly maxTargetsField?: FieldName;
  readonly conditionExprRef?: TypedReference;
  readonly interactionIntent?: InteractionIntent;
}

/** Op 参数映射来源。 */
export const OP_ARGUMENT_SOURCES = ['actor', 'target', 'parameter', 'constant'] as const;
export type OpArgumentSource = (typeof OP_ARGUMENT_SOURCES)[number];

export interface OpArgumentMapping {
  readonly opArgument: string;
  readonly source: OpArgumentSource;
  readonly parameterName?: FieldName;
  readonly constant?: JsonValue;
}

/**
 * 结构化 Op 映射：动作在运行时映射到哪一个 L1 Op。
 * L2 只声明映射，不解释 Op、不开启事务、不计算 Expr。
 */
export interface OpMapping {
  readonly opId: OpId;
  readonly argumentMapping: readonly OpArgumentMapping[];
}

// ───────────────────────────────────────────────────────────────────────────
// Action_Family（Requirements 6.1–6.4）
// ───────────────────────────────────────────────────────────────────────────

export const ACTION_COST_CATEGORIES = ['paid', 'attached'] as const;
export type ActionCostCategory = (typeof ACTION_COST_CATEGORIES)[number];

/**
 * 多步骤付费交互的一步。
 * Requirements 6.2：多步骤付费交互必须表达为有序 Paid_Action 序列并带显式中间状态。
 * 除最后一步外，每一步都必须声明 `intermediateStatusRef`。
 */
export interface ActionSequenceStep {
  readonly stepId: string;
  readonly actionRef: TypedReference;
  readonly intermediateStatusRef?: TypedReference;
}

export interface ActionContract {
  readonly contractKind: 'action';
  readonly costCategory: ActionCostCategory;
  /**
   * AP 成本。
   * `Structural_Bound`：Paid_Action 恒为 1，Attached_Action 恒为 0
   * （来源：requirements.md Glossary 对 Paid_Action / Attached_Action 的定义）。
   * 声明 >1 的原子成本时返回 `ACTION_MULTI_AP_ATOMIC_COST`。
   */
  readonly apCost: number;
  readonly actorRequirements: readonly ActorRequirement[];
  readonly targetRequirements: readonly TargetRequirement[];
  readonly effectRefs: readonly TypedReference[];
  readonly interruptionConditionRefs: readonly TypedReference[];
  readonly completionState: string;
  /** Attached_Action 必须为 false（Requirements 6.3）。 */
  readonly availableAsDecisionBranch: boolean;
  /** Attached_Action 必填：依附的 Paid_Action。 */
  readonly hostActionRef?: TypedReference;
  /** 多步骤付费交互序列。 */
  readonly sequence?: readonly ActionSequenceStep[];
  readonly opMapping?: OpMapping;
  readonly requiresHookIntegration: boolean;
  /** UI 语义（Requirements 14.2、14.4）：与渲染技术无关。attackShape 已删除，见上方权威变更说明。 */
  readonly interactionIntent?: InteractionIntent;
  /** 姿态语义标签；L2 不枚举具体姿态，原样透传给 UI。 */
  readonly posture?: string;
  readonly accessibleLabel?: HumanReadableText;
}

// ───────────────────────────────────────────────────────────────────────────
// Gateway_Family（Requirements 6.5–6.10）
// ───────────────────────────────────────────────────────────────────────────

export const GATEWAY_KINDS = ['resource-conversion', 'check', 'condition'] as const;
export type GatewayKind = (typeof GATEWAY_KINDS)[number];

export const CRITERION_COMPARISONS = ['gte', 'gt', 'lte', 'lt', 'eq', 'neq'] as const;
export type CriterionComparison = (typeof CRITERION_COMPARISONS)[number];

/** 可配置判据：阈值来自参数字段，不是内嵌常量（Requirements 6.7、6.9）。 */
export interface CriterionDeclaration {
  readonly comparison: CriterionComparison;
  readonly thresholdField: FieldName;
}

export interface ResourceConversionGateway {
  readonly inputResourceRefs: readonly TypedReference[];
  readonly outputEffectRefs: readonly TypedReference[];
  /** Requirements 6.6：资源转换必须声明确定性成功语义。 */
  readonly deterministicSuccess: boolean;
}

export interface CheckGateway {
  /** L1 随机或求值原语引用（Requirements 6.7）。 */
  readonly primitiveRef: TypedReference;
  readonly criterion: CriterionDeclaration;
  readonly successEffectRefs: readonly TypedReference[];
  readonly failureEffectRefs: readonly TypedReference[];
}

export interface ConditionGateway {
  /** L1 布尔表达式引用（Requirements 6.8）。 */
  readonly conditionExprRef: TypedReference;
  readonly successEffectRefs: readonly TypedReference[];
  readonly failureEffectRefs: readonly TypedReference[];
}

export interface GatewayContract {
  readonly contractKind: 'gateway';
  readonly gatewayKind: GatewayKind;
  readonly resourceConversion?: ResourceConversionGateway;
  readonly check?: CheckGateway;
  readonly condition?: ConditionGateway;
  /** 违规检测面：具名商店/锁/工作台（Requirements 6.9）。 */
  readonly namedGameplayEntity?: string;
  /** 违规检测面：内嵌具体阈值（Requirements 6.9）。 */
  readonly concreteThreshold?: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Natural_Scene_Family / Micro_Scene / Transition_Family（Requirements 7）
// ───────────────────────────────────────────────────────────────────────────

export const SCENE_SCALES = ['large', 'medium', 'small'] as const;
export type SceneScale = (typeof SCENE_SCALES)[number];

export interface NaturalSceneContract {
  readonly contractKind: 'natural-scene';
  readonly scale: SceneScale;
  /** 连接数上限：只有带权威来源时才作为 Structural_Bound 生效（Requirements 7.2）。 */
  readonly connectionBound?: StructuralBoundDeclaration;
  /** 小场景必填：共享 Micro_Scene 能力（Requirements 7.10）。 */
  readonly sharedMicroSceneCapabilityRef?: TypedReference;
  /** 小场景必须为空：个人空地 Micro_Scene 被排除（Requirements 7.10）。 */
  readonly personalVacantGroundMicroSceneRefs: readonly TypedReference[];
  /** 违规检测面：具体地图节点（Requirements 7.1）。 */
  readonly concreteMapNodeIds?: readonly string[];
}

/** `props.creator`：不可变溯源信息，不承担归属或生命周期（Requirements 7.4）。 */
export interface CreatorProvenance {
  readonly creatorEntityRef: string;
  readonly immutable: boolean;
}

export const MICRO_SCENE_LIFECYCLE_DETERMINANTS = ['valid-parent', 'occupancy'] as const;
export type MicroSceneLifecycleDeterminant = (typeof MICRO_SCENE_LIFECYCLE_DETERMINANTS)[number];

export interface MicroSceneContract {
  readonly contractKind: 'micro-scene';
  /** 唯一天然场景父级（Requirements 7.3）。 */
  readonly parent: TypedReference;
  readonly creator: CreatorProvenance;
  readonly occupancyContractRef: TypedReference;
  /** 必须同时包含 valid-parent 与 occupancy（Requirements 7.5）。 */
  readonly lifecycleDeterminants: readonly MicroSceneLifecycleDeterminant[];
  /** 违规检测面：把 owner 当作归属/生命周期依据（Requirements 7.6）。 */
  readonly ownerField?: string;
}

export const TRANSITION_DIRECTIONALITIES = ['bidirectional', 'unidirectional'] as const;
export type TransitionDirectionality = (typeof TRANSITION_DIRECTIONALITIES)[number];

export interface TransitionContract {
  readonly contractKind: 'transition';
  /** 恰好两个端点引用；unidirectional 时 [from, to]。 */
  readonly endpoints: readonly TypedReference[];
  readonly directionality: TransitionDirectionality;
  readonly traversalConditionRefs: readonly TypedReference[];
  readonly blockingCapabilityRefs: readonly TypedReference[];
}

// ───────────────────────────────────────────────────────────────────────────
// Item_Family / Weapon_Family / Vehicle_Family（Requirements 8）
// ───────────────────────────────────────────────────────────────────────────

export const ITEM_KINDS = [
  'generic',
  'armor',
  'consumable',
  'ammunition',
  'accessory',
  'key',
  'tool',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ContainerEligibility {
  readonly storable: boolean;
  readonly requiredContainerCapabilityRefs: readonly TypedReference[];
  /** 体积/占位参数字段名；具体数值归 L3。 */
  readonly volumeField?: FieldName;
}

export interface SlotRequirement {
  readonly slotId: SlotId;
  readonly slotRef: TypedReference;
  readonly exclusive: boolean;
}

export interface EquipRequirement {
  readonly requirementId: string;
  readonly capability: string;
  readonly conditionExprRef?: TypedReference;
}

export interface AttachmentPoint {
  readonly pointId: string;
  readonly acceptedFamily: SemanticFamilyId;
  readonly acceptedRef?: TypedReference;
}

export interface ArmorProfile {
  /** Requirements 8.5：减伤规则引用。 */
  readonly mitigationRuleRefs: readonly TypedReference[];
  /** Requirements 8.5：破损条件引用。 */
  readonly breakConditionRefs: readonly TypedReference[];
  readonly equipmentSlotRequirements: readonly SlotRequirement[];
  /** 违规检测面：内嵌具体护甲实例（Requirements 8.5）。 */
  readonly concreteInstanceRef?: string;
}

export const CONSUMABLE_USE_LOCATIONS = ['self', 'adjacent', 'ranged', 'micro-scene'] as const;
export type ConsumableUseLocation = (typeof CONSUMABLE_USE_LOCATIONS)[number];

export const CONSUMPTION_BEHAVIORS = ['consume-on-use', 'charges', 'persistent'] as const;
export type ConsumptionBehavior = (typeof CONSUMPTION_BEHAVIORS)[number];

export interface ConsumableProfile {
  readonly useLocation: ConsumableUseLocation;
  readonly effectRefs: readonly TypedReference[];
  readonly consumptionBehavior: ConsumptionBehavior;
  /** `charges` 行为时必须指向参数字段而不是具体次数。 */
  readonly chargesField?: FieldName;
}

/** Requirements 8.11：重物标签聚合必须走 L1 query/relation 接口。 */
export interface HeavyTagAggregation {
  readonly aggregation: 'l1-query-relation';
  readonly queryRef: TypedReference;
  readonly relationRef: TypedReference;
  readonly tag: TagId;
}

/** Requirements 8.12：死亡容器能力。 */
export interface DeathContainerCapability {
  readonly containerRef: TypedReference;
  /** 必须为 true：新建容器禁止存入。 */
  readonly depositDisabled: boolean;
  /** 必须为 `deceased-entity-transaction`：内容引用来自死亡实体事务。 */
  readonly contentSource: string;
}

export interface ItemContract {
  readonly contractKind: 'item';
  readonly itemKind: ItemKind;
  readonly containerEligibility: ContainerEligibility;
  readonly slotRequirements: readonly SlotRequirement[];
  readonly equipRequirements: readonly EquipRequirement[];
  readonly grantedActionRefs: readonly TypedReference[];
  readonly attachmentPoints: readonly AttachmentPoint[];
  readonly armor?: ArmorProfile;
  readonly consumable?: ConsumableProfile;
  readonly heavyTagAggregation?: HeavyTagAggregation;
  readonly deathContainerCapability?: DeathContainerCapability;
}

export const WEAPON_CLASSES = ['melee', 'non-firearm-ranged', 'firearm'] as const;
export type WeaponClass = (typeof WEAPON_CLASSES)[number];

/**
 * Requirements 8.3：武器属性（散射/扫射/连发等，原"攻击形状"已废止见上方权威变更说明）、
 * 射程谱、伤害引用、目标上限、弹药行为与配件兼容性全部通过 Composition 表达。
 * 因此本契约只承载 Type_Identity 判据（weaponClass）与 Q-01 的谱型档位引用（弹道谱型/距离档，
 * 非攻击形状），其余配置在 `composition` 中按角色声明。
 */
export interface WeaponContract {
  readonly contractKind: 'weapon';
  readonly weaponClass: WeaponClass;
  /**
   * 谱型档位引用（Q-01）。
   * 只保留可扩展引用；`specialTierMechanism` 一旦出现即拒绝，因为 Q-01 尚无权威决策。
   */
  readonly attackSpectrumTier?: string;
  readonly specialTierMechanism?: Readonly<Record<string, JsonValue>>;
  /** 违规检测面：具体伤害值（Requirements 8.4）。 */
  readonly concreteDamageValue?: number;
  /** 违规检测面：与具体玩法 Profile 耦合（Requirements 8.4）。 */
  readonly gameplayProfileCoupling?: string;
}

export interface SeatRoleDeclaration {
  readonly seatRole: SeatRoleId;
  readonly capacityField?: FieldName;
  readonly occupantRequirementRefs: readonly TypedReference[];
}

export interface DoorDeclaration {
  readonly doorId: DoorId;
  readonly lockCapabilityRef?: TypedReference;
  readonly adjacentSeatRoles: readonly SeatRoleId[];
}

export interface CargoContainerDeclaration {
  readonly containerId: ContainerId;
  readonly containerRef: TypedReference;
}

export interface DestructionDisposition {
  readonly occupantDispositionRef: TypedReference;
  readonly cargoDispositionRef: TypedReference;
}

export interface VehicleContract {
  readonly contractKind: 'vehicle';
  /** Requirements 7.11：车辆是 Entity，不是 Micro_Scene 或 Item。必须为 true。 */
  readonly entityBacked: boolean;
  readonly seatRoles: readonly SeatRoleDeclaration[];
  readonly cargoContainers: readonly CargoContainerDeclaration[];
  readonly doors: readonly DoorDeclaration[];
  readonly lockCapabilityRef?: TypedReference;
  readonly movementCapabilityRef?: TypedReference;
  readonly collisionCapabilityRef?: TypedReference;
  readonly destructionDisposition?: DestructionDisposition;
  /**
   * Requirements 8.9：车辆邻接与门特定目标是**两个独立**的可组合交互输入。
   * 两者必须指向不同的 `CompositionComponent.componentId`。
   */
  readonly adjacencyInteractionComponentId?: string;
  readonly doorTargetInteractionComponentId?: string;
  /**
   * D-030 乘员交互策略引用。
   * Requirements 1.13 / 8.10：D-030 归 L3；该引用必须指向 policy 且归属层为玩法层。
   */
  readonly d030PolicyRef?: TypedReference;
  /** Q-04：载具内部微型场景与外部交互点的边界未决，不得在此推导机制。 */
  readonly interiorMicroSceneBoundary?: Readonly<Record<string, JsonValue>>;
}

// ───────────────────────────────────────────────────────────────────────────
// 效果类（Requirements 9）
// ───────────────────────────────────────────────────────────────────────────

export interface DamageContract {
  readonly contractKind: 'damage';
  readonly damageCategory: string;
  readonly sourceRequirements: readonly ActorRequirement[];
  readonly targetRequirements: readonly TargetRequirement[];
  readonly settlementPipelineRefs: readonly TypedReference[];
  /** 违规检测面：分配具体伤害量（Requirements 9.1）。 */
  readonly amount?: number;
}

export const STATUS_DURATION_MODES = ['instant', 'turns', 'until-condition', 'permanent'] as const;
export type StatusDurationMode = (typeof STATUS_DURATION_MODES)[number];

export const STATUS_STACK_MODES = ['none', 'refresh', 'stack', 'independent'] as const;
export type StatusStackMode = (typeof STATUS_STACK_MODES)[number];

/** 状态交互：必须带显式 interaction-rule 引用（Requirements 9.10）。 */
export interface StatusInteraction {
  readonly interactionId: string;
  readonly counterpartRef: TypedReference;
  readonly interactionRuleRef?: TypedReference;
}

export interface StatusContract {
  readonly contractKind: 'status';
  readonly durationMode: StatusDurationMode;
  readonly stackMode: StatusStackMode;
  readonly triggerRefs: readonly TypedReference[];
  readonly interruptionRefs: readonly TypedReference[];
  readonly effectRefs: readonly TypedReference[];
  readonly interactions: readonly StatusInteraction[];
  /** 违规检测面：把 L1 运行时迁移伪装成 L2 状态（Requirements 9.8）。 */
  readonly representsL1RuntimeTransition?: boolean;
  readonly reusableGameplaySemantics?: boolean;
  /** 违规检测面：只因名称或玩法数值不同的伪子类型（Requirements 9.9）。 */
  readonly differsOnlyByNameOrValue?: boolean;
}

export const SKILL_ACTIVATIONS = ['active', 'passive', 'triggered'] as const;
export type SkillActivation = (typeof SKILL_ACTIVATIONS)[number];

export interface SkillContract {
  readonly contractKind: 'skill';
  readonly activation: SkillActivation;
  /** 成本参数字段名；具体数值归 L3（Requirements 9.4）。 */
  readonly costFields: readonly FieldName[];
  readonly cooldownFields: readonly FieldName[];
  readonly triggerConditionRefs: readonly TypedReference[];
  readonly effectRefs: readonly TypedReference[];
  readonly differsOnlyByNameOrValue?: boolean;
}

export const MOVEMENT_TRAVERSALS = ['ground', 'vehicle', 'teleport'] as const;
export type MovementTraversal = (typeof MOVEMENT_TRAVERSALS)[number];

/**
 * Requirements 9.6：成本、速度、范围、地形修正与碰撞效果作为 L3 拥有的参数暴露。
 * 因此这里只登记字段名，验证器要求对应字段存在、分类为 Gameplay_Value 且不带默认值。
 */
export interface MovementContract {
  readonly contractKind: 'movement';
  readonly traversal: MovementTraversal;
  readonly costField?: FieldName;
  readonly speedField?: FieldName;
  readonly rangeField?: FieldName;
  readonly terrainModifierField?: FieldName;
  readonly collisionEffectRefs: readonly TypedReference[];
}

export const ATTACHMENT_STACK_BEHAVIORS = ['none', 'refresh', 'stack', 'independent'] as const;
export type AttachmentStackBehavior = (typeof ATTACHMENT_STACK_BEHAVIORS)[number];

export const ATTACHMENT_CLEANUP_BEHAVIORS = [
  'on-duration-end',
  'on-host-removal',
  'on-source-removal',
  'explicit-only',
] as const;
export type AttachmentCleanupBehavior = (typeof ATTACHMENT_CLEANUP_BEHAVIORS)[number];

export interface AttachmentContract {
  readonly contractKind: 'attachment';
  readonly hostType: ExpectedReferenceType;
  readonly sourceType: ExpectedReferenceType;
  readonly durationMode: StatusDurationMode;
  readonly stackBehavior: AttachmentStackBehavior;
  readonly grantedRuleRefs: readonly TypedReference[];
  readonly cleanupBehavior: AttachmentCleanupBehavior;
}

// ───────────────────────────────────────────────────────────────────────────
// AI_Behavior_Family（Requirements 10）
// ───────────────────────────────────────────────────────────────────────────

export const AI_POLICY_CATEGORIES = ['player-assistance', 'npc-behavior'] as const;
export type AiPolicyCategory = (typeof AI_POLICY_CATEGORIES)[number];

export interface AiStateDeclaration {
  readonly stateName: string;
  readonly goalRefs: readonly TypedReference[];
  readonly intentRefs: readonly TypedReference[];
}

export interface AiTransitionDeclaration {
  readonly transitionId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly conditionExprRef: TypedReference;
}

export interface AiBehaviorContract {
  readonly contractKind: 'ai-behavior';
  readonly policyCategory: AiPolicyCategory;
  readonly states: readonly AiStateDeclaration[];
  readonly transitions: readonly AiTransitionDeclaration[];
  /** 感知参数 Schema：只声明参数形状，不给具体阈值（Requirements 10.1、10.5）。 */
  readonly perceptionParameterSchema: ParameterSchema;
  readonly fallbackStateRef: TypedReference;
  readonly requiredActionTags: readonly TagId[];
  readonly requiredActionRefs: readonly TypedReference[];
  /**
   * 策略声明的中性回退评估值（Requirements 10.10）。
   * 分类为 `Internal_Metric`：它是评估分数而非玩家可见玩法数值，不套用 1–5。
   */
  readonly neutralFallbackEvaluation: number;
  /** 违规检测面：巡逻路线、具体感知阈值、玩法专属状态机（Requirements 10.5）。 */
  readonly embeddedGameplayDetails?: readonly string[];
  /** 违规检测面：重定义 L1 policy/query/belief/visibility/random 接口（Requirements 10.2）。 */
  readonly redefinedL1Interfaces?: readonly string[];
}

// ───────────────────────────────────────────────────────────────────────────
// 通用（可扩展新语义族）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 通用契约：满足三判据、但尚未拥有专用契约的新语义族使用它。
 * 它不放宽任何验证：层级、术语、数值、引用、继承与组合规则照常执行。
 */
export interface GenericFamilyContract {
  readonly contractKind: 'generic';
  readonly familyId: SemanticFamilyId;
  readonly declaredContractFields: readonly string[];
}

export type FamilyContract =
  | ActionContract
  | GatewayContract
  | NaturalSceneContract
  | MicroSceneContract
  | TransitionContract
  | ItemContract
  | WeaponContract
  | VehicleContract
  | DamageContract
  | StatusContract
  | SkillContract
  | MovementContract
  | AttachmentContract
  | AiBehaviorContract
  | GenericFamilyContract;

export type FamilyContractKind = FamilyContract['contractKind'];

/**
 * 已登记语义族（Requirements 4.2 明确"不视为穷举"）。
 * `micro-scene` 依据 L0 拓扑铁律登记；`weapon` 与 `item` 分列，与 4.2 的清单一致。
 */
export const KNOWN_SEMANTIC_FAMILY_IDS = [
  'action',
  'gateway',
  'natural-scene',
  'micro-scene',
  'transition',
  'item',
  'weapon',
  'vehicle',
  'damage',
  'status',
  'skill',
  'movement',
  'attachment',
  'ai-behavior',
] as const;

export type KnownSemanticFamilyId = (typeof KNOWN_SEMANTIC_FAMILY_IDS)[number];

export function isKnownSemanticFamilyId(value: unknown): value is KnownSemanticFamilyId {
  return typeof value === 'string' && (KNOWN_SEMANTIC_FAMILY_IDS as readonly string[]).includes(value);
}

/** 已登记语义族与其专用契约 kind 的对应关系。 */
export const FAMILY_CONTRACT_KIND_BY_FAMILY: ReadonlyMap<string, FamilyContractKind> = Object.freeze(
  new Map<string, FamilyContractKind>([
    ['action', 'action'],
    ['gateway', 'gateway'],
    ['natural-scene', 'natural-scene'],
    ['micro-scene', 'micro-scene'],
    ['transition', 'transition'],
    ['item', 'item'],
    ['weapon', 'weapon'],
    ['vehicle', 'vehicle'],
    ['damage', 'damage'],
    ['status', 'status'],
    ['skill', 'skill'],
    ['movement', 'movement'],
    ['attachment', 'attachment'],
    ['ai-behavior', 'ai-behavior'],
  ]),
);
