/**
 * 基类层 · 空间与物品领域：族标识、能力标识、组合角色标识与结构标识别名。
 *
 * 对应 `.kiro/specs/wakeup-space-items/requirements.md` 要求 1.2、14.2、14.3 与
 * design.md「拥有清单 / 类型身份」。
 *
 * 落点依据（D-058）：本领域不新建平行目录树，全部产物落在既有 `src/l2/` 子目录下，
 * 以 `space-items-` 前缀区分。标识形状校验与 JSON 路径拼接复用 `./ids.js`，
 * 不重新实现。
 *
 * 本文件不含任何玩法数值：只有封闭的标识集合与它们的规范化排序序数。
 */

import type { DefinitionId } from './ids.js';

/** 本领域拥有的语义族标识（封闭集合，要求 1.2）。 */
export const SPACE_ITEMS_FAMILY_IDS = [
  'natural-scene',
  'micro-scene',
  'transition',
  'container',
  'item',
  'weapon',
  'profile',
  'damage',
  'armor',
  'shield',
  'movement',
  'vehicle',
] as const;

export type SpaceItemsFamilyId = (typeof SPACE_ITEMS_FAMILY_IDS)[number];

export function isSpaceItemsFamilyId(value: unknown): value is SpaceItemsFamilyId {
  return typeof value === 'string' && (SPACE_ITEMS_FAMILY_IDS as readonly string[]).includes(value);
}

/** 族标识的规范化排序序数（按声明顺序，保证诊断与投影输出确定）。 */
export function familyRank(familyId: SpaceItemsFamilyId): number {
  const index = SPACE_ITEMS_FAMILY_IDS.indexOf(familyId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * 领域契约判别键（`domainKind`）。
 *
 * 它与 `SpaceItemsFamilyId` 一一对应：契约判别键即族标识。分成两个常量是为了让
 * 「契约形状的判别」与「语义族登记」在类型层面各自独立可用，不产生第二套分类。
 */
export const SPACE_ITEMS_DOMAIN_KINDS = SPACE_ITEMS_FAMILY_IDS;
export type SpaceItemsDomainKind = SpaceItemsFamilyId;

/**
 * 本领域拥有的能力标识（封闭集合）。
 *
 * 命名与 `src/class/<族>/index.json` 的既有能力标识保持同名，使目录与代码可机械比对：
 * 目录里的 `scene.capability.*` / `container.capability.*` / `item.capability.*` /
 * `weapon.capability.*` / `movement.capability.*` / `vehicle.capability.*` 是同一批标识。
 */
export const SPACE_ITEMS_CAPABILITY_IDS = [
  // 空间
  'scene.capability.occupancy',
  'scene.capability.shared_micro_scene',
  'scene.capability.personal_vacant_ground',
  'scene.capability.traversal_weight',
  'scene.capability.micro_scene_parenthood',
  'scene.capability.micro_scene_attachment',
  'scene.capability.creator_provenance',
  'scene.capability.lifecycle_eligibility',
  'scene.capability.transition_endpoint',
  'scene.capability.traversal_condition',
  'scene.capability.blocking',
  // 容器
  'container.capability.host_binding',
  'container.capability.capacity_declaration',
  'container.capability.access_condition',
  'container.capability.deposit',
  'container.capability.withdraw',
  'container.capability.deposit_disabled',
  'container.capability.derived_content_source',
  // 物品与装备
  'item.capability.armor',
  'item.capability.shield',
  'item.capability.consumption',
  'item.capability.durability',
  'item.capability.accessory_mount',
  'item.capability.heavy_tag_aggregation',
  'item.capability.death_container_binding',
  // 武器
  // 2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：'weapon.capability.attack_shape_composition'
  // 已删除，替换为武器属性能力。攻击形状/形状轴判定为冗余设计，见 model/family-contracts.ts
  // 顶部权威变更说明，并核查 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3。
  'weapon.capability.scatter_attribute',
  'weapon.capability.sweep_attribute',
  'weapon.capability.burst_attribute',
  'weapon.capability.range_profile',
  'weapon.capability.damage_reference',
  'weapon.capability.target_limit',
  'weapon.capability.ammunition_binding',
  'weapon.capability.accessory_compatibility',
  // 移动
  'movement.capability.adjacency_traversal',
  'movement.capability.vehicle_bound_traversal',
  'movement.capability.terrain_condition',
  'movement.capability.collision_effect',
  'movement.capability.cost_declaration',
  // 载具
  'vehicle.capability.seat_binding',
  'vehicle.capability.cargo',
  'vehicle.capability.door_addressing',
  'vehicle.capability.adjacency_interaction',
  'vehicle.capability.door_target_interaction',
  'vehicle.capability.lockable',
  'vehicle.capability.drive',
  'vehicle.capability.collision',
  'vehicle.capability.targetable_parts',
  'vehicle.capability.destruction_sequence',
] as const;

export type SpaceItemsCapabilityId = (typeof SPACE_ITEMS_CAPABILITY_IDS)[number];

export function isSpaceItemsCapabilityId(value: unknown): value is SpaceItemsCapabilityId {
  return typeof value === 'string' && (SPACE_ITEMS_CAPABILITY_IDS as readonly string[]).includes(value);
}

export function capabilityRank(capabilityId: SpaceItemsCapabilityId): number {
  const index = SPACE_ITEMS_CAPABILITY_IDS.indexOf(capabilityId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * 武器组合角色标识（要求 8.1）。
 *
 * 武器属性（散射/扫射/连发）、谱型、距离策略、伤害引用、弹药行为、配件兼容性、动作序列与
 * 目标上限一律以组合角色声明，不作为契约顶层字段——这是"继承决定类型、组合决定配置"的落点。
 *
 * 2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：`'attack-shape'` 已改名为
 * `'weapon-attribute'`。攻击形状（single-target/spread/area 三选一形状轴）判定为冗余设计，
 * 已被武器属性完全覆盖，武器不再声明形状身份。散射/扫射属性不适用 `'target-limit'`
 * （不设固定命中目标数上限）。详见 `docs/L0_规范宪法.md`、`docs/L2_基类层/基类层定义.md` §4.3。
 */
export const WEAPON_COMPOSITION_ROLES = [
  'weapon-attribute',
  'profile',
  'range-policy',
  'damage-reference',
  'ammunition-behavior',
  'accessory-compatibility',
  'action-sequence',
  'target-limit',
] as const;

export type WeaponCompositionRole = (typeof WEAPON_COMPOSITION_ROLES)[number];

export function isWeaponCompositionRole(value: unknown): value is WeaponCompositionRole {
  return typeof value === 'string' && (WEAPON_COMPOSITION_ROLES as readonly string[]).includes(value);
}

export function weaponCompositionRoleRank(role: WeaponCompositionRole): number {
  const index = WEAPON_COMPOSITION_ROLES.indexOf(role);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * 武器组合角色中"每个合法武器都必须声明"的最小集合。
 *
 * 依据要求 8.1：类型身份之外的全部配置面必须经组合表达。三项必需角色是让一个武器
 * 可被玩法层配置为可用实例的下限——缺任一项时该武器无法结算（没有谱型 / 没有伤害引用 /
 * 没有动作序列都会使结算管道断开）。武器属性（散射/扫射/连发）是可选面：默认不声明任何
 * 属性即隐含单体攻击，不需要显式的"单体"标签。距离策略、弹药行为、配件兼容性与
 * 目标上限也是可选面：近战武器不需要距离策略与弹药行为。
 *
 * 2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：`'attack-shape'` 已从必需集合移除
 * （随其改名为 `'weapon-attribute'` 一并变为可选面）。详见
 * `docs/L0_规范宪法.md`、`docs/L2_基类层/基类层定义.md` §4.3。
 *
 * 这是本实现对要求 8.1 的理解性补充（记录于决策与风险记录 DR-SI-004）。
 */
export const REQUIRED_WEAPON_COMPOSITION_ROLES: readonly WeaponCompositionRole[] = Object.freeze([
  'profile',
  'damage-reference',
  'action-sequence',
]);

/** 容器角色标识（要求 7.1）。 */
export const CONTAINER_ROLES = [
  'carried',
  'stationary',
  'equipment-slot',
  'vehicle-cargo',
  'death-container',
] as const;

export type ContainerRole = (typeof CONTAINER_ROLES)[number];

export function isContainerRole(value: unknown): value is ContainerRole {
  return typeof value === 'string' && (CONTAINER_ROLES as readonly string[]).includes(value);
}

export function containerRoleRank(role: ContainerRole): number {
  const index = CONTAINER_ROLES.indexOf(role);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** 座位角色标识（要求 10.2）。 */
export const SEAT_ROLES = ['driver', 'passenger', 'gunner', 'medic-bay'] as const;
export type SpaceItemsSeatRole = (typeof SEAT_ROLES)[number];

export function isSeatRole(value: unknown): value is SpaceItemsSeatRole {
  return typeof value === 'string' && (SEAT_ROLES as readonly string[]).includes(value);
}

export function seatRoleRank(role: SpaceItemsSeatRole): number {
  const index = SEAT_ROLES.indexOf(role);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * 结构标识别名。
 *
 * 与 `./ids.ts` 的 `DoorId` / `SeatRoleId` / `ContainerId` / `SlotId` 同为字符串别名：
 * 形状由 `isWellFormedId` 保证，不引入名义类型（理由同 D-L2-001）。
 */
export type MicroSceneDefinitionId = DefinitionId;
export type NaturalSceneDefinitionId = DefinitionId;
export type TransitionDefinitionId = DefinitionId;
export type VehicleDoorId = string;
export type ContainerSlotRoleId = string;

/**
 * 领域族标识 → 允许的引擎层 `Def kind` 集合。
 *
 * 这是"本领域只把引擎层原语约束为语义族"的机械表达：例如天然场景与微型场景都只能是
 * `node`，过渡只能是 `link`，载具只能是 `entity`（要求 10.1）。判定在验证规则中执行，
 * 本文件只登记映射。
 */
export const DOMAIN_FAMILY_DEF_KINDS: Readonly<Record<SpaceItemsFamilyId, readonly string[]>> =
  Object.freeze({
    'natural-scene': Object.freeze(['node']),
    'micro-scene': Object.freeze(['node']),
    transition: Object.freeze(['link']),
    container: Object.freeze(['entity', 'item']),
    item: Object.freeze(['item']),
    weapon: Object.freeze(['item']),
    profile: Object.freeze(['rule']),
    damage: Object.freeze(['rule']),
    armor: Object.freeze(['item']),
    shield: Object.freeze(['item']),
    movement: Object.freeze(['action', 'rule']),
    vehicle: Object.freeze(['entity']),
  });
