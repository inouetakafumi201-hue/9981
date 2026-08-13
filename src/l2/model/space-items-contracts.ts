/**
 * L2 Model: Space-Items 领域的契约扩展。
 *
 * 在 `family-contracts.ts` 的基础上，补充容器（Container）、盾牌（Shield）
 * 与相关空间契约的领域专属面，以及违规检测面与已移除状态黑名单。
 *
 * References：
 * - Requirements 7 (Containers & Items)、8 (Weapons)、9 (Armor & Shield)、
 *   10 (Vehicles) 的缺面
 * - D-059 (Dead Body Container Logic)、D-016 (Removed Status Registry)
 * - Q-01 (Attack Spectrum未决)、Q-04 (Vehicle Interior微型场景未决)、
 *   Q-05 (Shield MVP Coverage未决)
 */

import type { FieldName } from './ids.js';
import type { TypedReference } from './reference.js';

// ───────────────────────────────────────────────────────────────────────────
// 真缺口 A: Container_Family 契约（Requirements 7.1）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 容器族契约：声明宿主类型、角色、槽位接受谓词、存取能力与转移动作引用。
 *
 * 容器只能作为 Item、Vehicle 的嵌入组件，不作顶层基类。
 * 槽位数量与容量一律通过参数字段名表达；`concreteSlotCount` / `concreteCapacity`
 * 只作违规检测面（越层声明的证据标记）。
 */
export interface ContainerDomainContract {
  readonly contractKind: 'container';
  /**
   * 容器宿主类型：只能是 'item' 或 'vehicle'。
   * Vehicles 通过 `CargoContainerDeclaration` 引用容器；Items 通过嵌入组件。
   */
  readonly hostType: 'item' | 'vehicle';
  /** 容器在宿主中的角色标识（如 'inventory'、'cargo'、'merchant-stock'）。 */
  readonly containerRole: string;
  /** 槽位接受条件的谓词引用（定义哪些物品可进入某槽位）。 */
  readonly slotAcceptancePredicateRef?: TypedReference;
  /** 存取能力引用集（如容器打开、关闭、锁定等）。 */
  readonly accessibilityCapabilityRefs: readonly TypedReference[];
  /** 是否允许存入；参数字段名。 */
  readonly depositAllowedField?: FieldName;
  /** 是否允许取出；参数字段名。 */
  readonly withdrawAllowedField?: FieldName;
  /** 物品转移动作引用（必须指向 `item.move` Op）。 */
  readonly transferActionRef: TypedReference;
  /** 违规检测面：内嵌具体槽位数（越层拒绝）。 */
  readonly concreteSlotCount?: number;
  /** 违规检测面：内嵌具体容量（越层拒绝）。 */
  readonly concreteCapacity?: number;
}

// ───────────────────────────────────────────────────────────────────────────
// D-059: 死亡容器能力（Requirements 7.6）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 死亡容器的结构性义务（Requirements 7.6、D-059）。
 *
 * D-059 明确：
 * 1. 灌注是指把死亡实体的"可转移物品集"写入指定容器的一次原子事务。
 * 2. 其中"禁止存入"标记（`Slot.accepts: false`）必须在灌注事务**提交后**才生效，
 *    否则灌注自身的 `item.move` 会被拒绝。
 *
 * 因此新增两个约束字段，与既有 `DeathContainerCapability.depositDisabled` 的"禁止存入"
 * 声明配套使用。
 */
export interface DeathContainerObligation {
  /** 禁止存入状态的生效机制引用（**可替换的机制引用**，非字面量常量名）。 */
  readonly depositDisabledMechanismRef: TypedReference;
  /**
   * 禁止存入标记何时生效。
   * 恒为 `'after-infusion-commit'`（字面量固定）：灌注事务提交后才禁止新增物品。
   */
  readonly depositMarkTiming: 'after-infusion-commit';
}

// ───────────────────────────────────────────────────────────────────────────
// 真缺口 B: Shield_Family 契约（Requirements 9.2、9.6、U-SPACE-006）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 盾牌族契约：声明持有要求、格挡动作、损耗规则、破损条件。
 *
 * Q-05 (Shield MVP Coverage) 未决：是否默认配置"扔盾"与"盾击"为标配互动。
 * 本契约不推导默认值；`mvpDefaultInteractionIds` 作违规检测面，任何尝试均被拒并挂
 * `U-SPACE-006` 门禁。
 */
export interface ShieldDomainContract {
  readonly contractKind: 'shield';
  /** 持有盾牌的要求（如手臂完整、力量足够等）。 */
  readonly holdingRequirementRefs: readonly TypedReference[];
  /** 格挡动作引用。 */
  readonly blockingActionRef: TypedReference;
  /** 损耗规则引用（如格挡失败后盾牌耐久度衰减）。 */
  readonly depletionRuleRefs: readonly TypedReference[];
  /** 破损条件引用（什么情况下盾牌会被完全破坏）。 */
  readonly breakConditionRefs: readonly TypedReference[];
  /**
   * 违规检测面：尝试声明默认可用互动（U-SPACE-006 门禁）。
   * Q-05 未决，本层不设默认标配范围。任何出现即拒绝。
   */
  readonly mvpDefaultInteractionIds?: readonly string[];
}

// ───────────────────────────────────────────────────────────────────────────
// 待裁决缺口 C: Profile_Family 契约（Requirements 8.3、§6 H-02）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 2026-08-11 待裁决：Profile_Family 是否需要独立契约。
 *
 * 两个可能方向：
 * 1. **需要独立契约**：谱型身份（弹道谱型/距离档/重量级）与可组合参数接口
 *    写成 `ProfileDomainContract`，仅引用 `weapons/index.json` 的 `range-tier.*` /
 *    `band-axis.*` / `weight-tier.*`。
 * 2. **不需要独立契约**：谱型完全由 band 轴 + tier 值集 + weapon.capability 表达，
 *    无需额外契约——`WeaponContract.attackSpectrumTier` 的引用已足够。
 *
 * 裁决前，本文件不预置任何契约定义。一旦裁决下达，在此追加定义。
 *
 * 相关问题记录在 `.kiro/specs/wakeup-space-items/requirements.md` §6 的 **H-02**。
 */

// ───────────────────────────────────────────────────────────────────────────
// 补齐面 F: D-016 已移除状态黑名单（Requirements 9.7）
// ───────────────────────────────────────────────────────────────────────────

/**
 * D-016 已移除状态的黑名单。
 *
 * 这些状态不得出现在基类定义、实例定义、默认标签或隐式状态交互中。
 * 验证器在 `space-items-container-item-rules.ts` 中引用此常量检测违规。
 *
 * 来源：`src/l2/决策与风险记录.md` 的 §「space-items D-016 已移除状态映射」。
 */
export const REMOVED_STATUS_BLACKLIST: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    // 按 D-016 的已移除状态列表填充（待核查 0.5 产出）
    // 临时占位：实际列表由 0.5 核实后追加
    // 预期形式: 'status.keyword.xxx' 等既有标识
  ]),
);

// ───────────────────────────────────────────────────────────────────────────
// 补齐面 E: 违规检测面字段汇总
// ───────────────────────────────────────────────────────────────────────────

/**
 * 违规检测面字段的完整清单（来自任务 2.1 的需求 E）。
 *
 * 这些字段存在的唯一目的是让越层声明可被确定性发现与定位。
 * 合法定义中必须全部缺省（`undefined`）。
 *
 * 分类：
 * - 场景违规面：concreteMapNodeIds、spawnPointIds、shrinkOrderIds
 * - 微型场景创建者误用：creatorAsOwner、creatorAsLifecycleDeterminant、creatorAsAccessControl、ownerField
 * - 微型场景配置误用：occupancyCounterField、modelsVehicleAsMicroScene
 * - 过渡违规面：boundConcreteSceneIds、concreteApCost、concreteDistance、boundGameModeId
 * - 容器违规面：volumeClass、pocketSlots、concreteSlotCount、concreteCapacity
 * - 物品违规面：concreteInstanceRef
 * - 武器/伤害违规面：baseDamageTable、concreteDamageValue、concreteHitThreshold、
 *   concreteRangeTable、concreteAmmunitionCount、amount、critIncrement、damageTable、namedFirearmId
 * - 防具/移动违规面：concreteMitigation、concreteDurability、concreteBreakThreshold、
 *   concreteCost、concreteSpeed
 * - 载具违规面：interiorMicroSceneBoundary、concreteDoorCount、concreteOccupantCount、
 *   directOccupantStateWrite、directCargoStateWrite
 *
 * 注意：这不是一个 TypeScript 接口，而是用于文档化的常量列表。
 * 验证器应在检查过程中查询这些字段名，确认缺省。
 */
export const REGULATORY_DETECTION_FIELDS: ReadonlyArray<string> = Object.freeze([
  // 场景
  'concreteMapNodeIds',
  'spawnPointIds',
  'shrinkOrderIds',
  // 微型场景
  'creatorAsOwner',
  'creatorAsLifecycleDeterminant',
  'creatorAsAccessControl',
  'ownerField',
  'occupancyCounterField',
  'modelsVehicleAsMicroScene',
  // 过渡
  'boundConcreteSceneIds',
  'concreteApCost',
  'concreteDistance',
  'boundGameModeId',
  // 容器
  'volumeClass',
  'pocketSlots',
  'concreteSlotCount',
  'concreteCapacity',
  // 物品
  'concreteInstanceRef',
  // 武器/伤害
  'baseDamageTable',
  'concreteDamageValue',
  'concreteHitThreshold',
  'concreteRangeTable',
  'concreteAmmunitionCount',
  'amount',
  'critIncrement',
  'damageTable',
  'namedFirearmId',
  // 防具/移动
  'concreteMitigation',
  'concreteDurability',
  'concreteBreakThreshold',
  'concreteCost',
  'concreteSpeed',
  // 载具
  'interiorMicroSceneBoundary',
  'concreteDoorCount',
  'concreteOccupantCount',
  'directOccupantStateWrite',
  'directCargoStateWrite',
]);

// ───────────────────────────────────────────────────────────────────────────
// 补齐面 D: 空间契约的结构性常量与字面量约束
// ───────────────────────────────────────────────────────────────────────────

/**
 * 载具的结构性字面量（Requirements 10.1、10.2）。
 *
 * 这些值在 `VehicleContract` 中被硬编码为类型约束，确保设计时即不可表达。
 */
export const VEHICLE_STRUCTURAL_LITERALS = Object.freeze({
  /** Requirements 10.1：载具必须映射为 Entity，不是 Item。 */
  backingDefKind: 'entity' as const,
  /** Requirements 10.2：座位绑定 Op（引擎层已注册）。 */
  seatBindOpId: 'agent.bind' as const,
  seatUnbindOpId: 'agent.unbind' as const,
});

/**
 * 死亡容器的结构性字面量（D-059、Requirements 7.6）。
 *
 * 这些值是结构性义务的体现，必须在所有死亡容器定义中精确匹配。
 */
export const DEATH_CONTAINER_STRUCTURAL_LITERALS = Object.freeze({
  /** D-059：死亡容器禁止新增存入。 */
  depositDisabled: true as const,
  /** D-059：内容来源恒为死亡实体事务。 */
  contentSource: 'deceased-entity-transaction' as const,
  /** D-059：禁止存入标记在灌注提交后生效。 */
  depositMarkTiming: 'after-infusion-commit' as const,
});

/**
 * 微型场景创建者的结构性字面量（Requirements 7.4）。
 *
 * `props.creator` 是溯源信息，不承担归属或生命周期职责。
 * 必须固定为不可变且仅用于文档目的。
 */
export const MICRO_SCENE_CREATOR_STRUCTURAL_LITERALS = Object.freeze({
  /** 创建者信息不可变：不得基于运行时事件改变。 */
  immutable: true as const,
  /** 创建者信息只用于溯源与审计，不用于控制。 */
  purpose: 'provenance-only' as const,
});

/**
 * 微型场景占用者查询的结构性约束（Requirements 7.4）。
 *
 * 占用者数只能通过引擎层查询（`derived-query`），不得用运行时字段计数。
 */
export const MICRO_SCENE_OCCUPANCY_STRUCTURAL_LITERAL = Object.freeze({
  occupancySource: 'derived-query' as const,
});

// ───────────────────────────────────────────────────────────────────────────
// 已移除携带机制（Requirements 7.7）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 已否决的携带机制字段名黑名单。
 *
 * 这些字段在旧 design 中用于表达物品的体积/占位，但已由容器系统取代。
 * 任何出现均拒绝并诊断为 `DEPRECATED_MECHANIC`。
 */
export const DEPRECATED_CARRYING_MECHANISM_FIELDS: ReadonlyArray<string> = Object.freeze([
  'volumeClass',
  'pocketSlots',
]);

// ───────────────────────────────────────────────────────────────────────────
// 综合导出类型
// ───────────────────────────────────────────────────────────────────────────

/**
 * Space-Items 领域的所有契约扩展（可与 FamilyContract 并用）。
 *
 * 扩展契约可作为 FamilyContract 的补充、专属字段或验证面，
 * 不覆盖 family-contracts.ts 中已定义的标准契约。
 */
export type SpaceItemsDomainContract =
  | ContainerDomainContract
  | ShieldDomainContract;

/**
 * 检查值是否为 space-items 领域专属契约。
 */
export function isSpaceItemsDomainContract(
  value: unknown,
): value is SpaceItemsDomainContract {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return obj.contractKind === 'container' || obj.contractKind === 'shield';
}
