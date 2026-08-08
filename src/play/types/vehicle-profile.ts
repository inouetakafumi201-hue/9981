/**
 * 玩法层载具配置类型。
 *
 * 这些类型描述玩法配置，不是可直接传给 OpRegistry.invoke 的参数。动作提交器必须先解析
 * 符号目标和参数绑定，再通过唯一写入通道调用已注册 Op。
 */

/** 玩家可见离散数值。 */
export type PlayerScaleValue = 1 | 2 | 3 | 4 | 5;

export type VehicleType = 'land' | 'air' | 'water';
export type VehicleSeatRole = 'driver' | 'passenger';
export type VehicleActionType =
  | 'movement'
  | 'combat_aim'
  | 'combat_execute'
  | 'interaction'
  | 'sabotage'
  | 'utility';

export interface VehicleDamageState {
  /** 运行时生命边界可包含耗尽值；该区间不是独立玩家输入。 */
  readonly hpRange: readonly [number, number];
  readonly label: string;
  readonly effects: readonly string[];
}

export interface VehicleDestructionStep {
  readonly step: number;
  readonly effect: 'burning' | 'explosion';
  readonly duration?: PlayerScaleValue;
  readonly damage?: PlayerScaleValue;
  readonly scope: 'vehicle_and_node';
  readonly description: string;
}

export interface VehicleSeatDefinition {
  readonly index: PlayerScaleValue;
  readonly role: VehicleSeatRole;
  readonly accessible: boolean;
  readonly label: string;
}

/** 具备货舱的载具：容量与访问方式都必须给出。 */
export interface VehicleCargoPresent {
  readonly capacity: PlayerScaleValue;
  readonly accessibleFrom: 'outside' | 'inside';
  readonly accessibleApCost?: PlayerScaleValue;
  readonly unlockable?: boolean;
  readonly note?: string;
}

/**
 * 不具备货舱的载具（如装甲车，空间用于装甲结构）。
 *
 * 拆成联合类型而不是把 `capacity` 改成可选：`accessibleFrom: 'none'` 是在**声明能力缺席**，
 * 此时要求填一个容量数值只会逼出占位值。审计的参数支撑校验也按同一条规则处理——
 * 取值为 `false` 或 `'none'` 的能力门控参数不要求组合对应能力。
 */
export interface VehicleCargoAbsent {
  readonly accessibleFrom: 'none';
  readonly note: string;
}

export type VehicleCargoDefinition = VehicleCargoPresent | VehicleCargoAbsent;

export interface VehicleMoveEffect {
  readonly apCost: PlayerScaleValue;
  readonly range: PlayerScaleValue;
  readonly description: string;
}

export interface VehicleInteriorDefinition {
  readonly isMicroScene: false;
  readonly interactionModel: 'vehicle_entity';
  readonly note: string;
}

export interface VehicleActionPrecondition {
  readonly type:
    | 'seat_role'
    | 'vehicle_has_hp'
    | 'adjacent_to_vehicle'
    | 'vehicle_has_seat_available'
    | 'in_vehicle'
    | 'vehicle_locked'
    | 'target_in_vehicle'
    | 'has_ranged_weapon'
    | 'has_melee_weapon'
    | 'target_vehicle_adjacent'
    | 'character_not_in_vehicle'
    | 'in_medical_bay_seat'
    | 'target_in_same_vehicle'
    | 'moving';
  readonly value?: string | PlayerScaleValue | boolean;
  readonly min?: PlayerScaleValue;
}

export type VehicleEffectTarget = 'vehicle' | 'agent' | 'target_agent' | 'self';

/**
 * 玩法动作中的声明式效果。字段是提交器输入；`op` 必须对应真实注册的引擎层 Op。
 */
export interface VehicleActionEffect {
  readonly op: string;
  readonly target?: VehicleEffectTarget;
  readonly prop?: string;
  readonly value?: unknown;
  /**
   * `prop.add` 的增量。此前这里是 `modifier?: string`（写作 `"+1"`），但引擎的 `prop.set`
   * 只接受目标值、不解释增量表达式——声明的 Op 与实际语义不符。改为显式增量并配 `prop.add`。
   */
  readonly delta?: PlayerScaleValue;
  readonly attachmentClassId?: string;
  readonly durationTurns?: PlayerScaleValue;
  readonly description?: string;
}

/**
 * 多步 Paid_Action 序列中后续步骤所依赖的中间状态（L2 需求 6.2）。
 * 声明了 `prerequisite` 的动作是序列的续接步，它替换前一步而不是新增一个并列选项。
 */
export interface VehicleActionPrerequisite {
  readonly state: string;
  readonly description?: string;
}

/**
 * 一个 Paid_Action 恰好消耗一个 AP 单位（L2 需求 6.2/6.4）。需要多个 AP 的交互必须表达为有序的
 * 多步 Paid_Action 序列并给出显式中间状态，而不是声明多 AP 原子成本。
 *
 * 零 AP 的 Attached_Action 不用这个类型：按 L2 需求 6.3，它依附于某个 Paid_Action、
 * 不能作为独立决策分支，需要单独的形状来表达这层依附关系。
 */
export type PaidActionCost = 1;

export interface VehicleActionDefinition {
  readonly name: string;
  readonly id: string;
  readonly apCost: PaidActionCost;
  readonly type: VehicleActionType;
  readonly preconditions: readonly VehicleActionPrecondition[];
  readonly effects: readonly VehicleActionEffect[];
  /** 该动作 effects 实际使用的引擎 Op 集合，必须与 effects 完全一致。 */
  readonly kernelOps: readonly string[];
  readonly prerequisite?: VehicleActionPrerequisite;
  readonly description: string;
}

export interface VehicleSpecialAbility {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly requires?: string;
  readonly effect: string;
  readonly healRate?: PlayerScaleValue;
  readonly armorRating?: PlayerScaleValue;
  readonly note?: string;
}

export interface VehicleInteraction {
  readonly id: string;
  readonly label: string;
  readonly type: 'sabotage' | 'breakable' | 'seat';
  readonly targetable?: boolean;
  readonly effect?: string;
  readonly armored?: boolean;
  readonly hitPoints?: PlayerScaleValue;
  readonly note?: string;
}

export interface VehicleClassComposition {
  readonly classIds: readonly string[];
  readonly capabilityIds: readonly string[];
}

export interface VehicleProfileMetadata {
  readonly profileVersion: string;
  readonly createdDate: string;
  readonly category: string;
  readonly notes?: readonly string[];
}

/** 可由玩法层组合和版本化的完整载具配置。 */
export interface VehiclePlayProfile {
  readonly id: string;
  readonly name: string;
  readonly type: VehicleType;
  readonly volume: PlayerScaleValue;
  readonly hp: PlayerScaleValue;
  readonly maxHp: PlayerScaleValue;
  readonly armorRating?: PlayerScaleValue;
  readonly speed: PlayerScaleValue;
  readonly seats: readonly VehicleSeatDefinition[];
  readonly cargo: VehicleCargoDefinition;
  readonly canLock: boolean;
  readonly damageOnCollision: PlayerScaleValue;
  readonly moveEffect: VehicleMoveEffect;
  readonly interior: VehicleInteriorDefinition;
  readonly specialAbilities?: readonly VehicleSpecialAbility[];
  readonly grantedActions: readonly VehicleActionDefinition[];
  readonly interactions: readonly VehicleInteraction[];
  /** 全部 effects 实际使用的引擎 Op 集合，必须与 effects 完全一致。 */
  readonly kernelTopologyOps: readonly string[];
  /** 已知需要、但尚未由任何 effect 落地的 Op；与 `kernelTopologyOps` 不相交。 */
  readonly pendingKernelOps?: readonly string[];
  readonly pendingKernelOpsNote?: string;
  readonly unresolvedIssues?: readonly ProfileUnresolvedIssue[];
  readonly damageStates: readonly VehicleDamageState[];
  readonly destructionSequence: readonly VehicleDestructionStep[];
  readonly description: string;
  readonly tags: readonly string[];
  readonly classComposition: VehicleClassComposition;
  readonly metadata: VehicleProfileMetadata;
}

/**
 * profile 内登记的待裁决项。
 *
 * 与 `known-divergences.ts` 的分工：这里记录**本 profile 局部**的未决点，便于改这份配置的人
 * 当场看到；跨文件、跨层的分歧登记在 `known-divergences.ts` 并由契约测试断言其当前状态。
 */
export interface ProfileUnresolvedIssue {
  /** 稳定编号，便于在报告与测试之间对齐。 */
  readonly code: string;
  readonly status: 'unresolved';
  /** 分歧是什么。 */
  readonly issue: string;
  /** 当前如何处理，以及为什么不自行裁决。 */
  readonly decision: string;
}
