/**
 * 基类层 · 空间与物品领域的封闭标识目录。
 *
 * 标识形状与 JSON 路径统一复用 `./ids.js`；本文件只登记语义标识，
 * 不携带玩法数值、具体玩法规则或具名实例。
 */

import type { DefinitionId, JsonPath } from './ids';
import { isWellFormedId, joinJsonPath } from './ids';
import { deepFreeze } from './immutable';

/** requirements 涉及的十二个语义族。 */
export const SPACE_ITEMS_FAMILY_IDS = Object.freeze([
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
] as const);

export type SpaceItemsFamilyId = (typeof SPACE_ITEMS_FAMILY_IDS)[number];

export function isSpaceItemsFamilyId(value: unknown): value is SpaceItemsFamilyId {
  return isWellFormedId(value) && (SPACE_ITEMS_FAMILY_IDS as readonly string[]).includes(value);
}

export function familyRank(familyId: SpaceItemsFamilyId): number {
  const index = SPACE_ITEMS_FAMILY_IDS.indexOf(familyId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** 领域契约判别键与族标识使用同一套封闭地址空间。 */
export const SPACE_ITEMS_DOMAIN_KINDS = SPACE_ITEMS_FAMILY_IDS;
export type SpaceItemsDomainKind = SpaceItemsFamilyId;

/**
 * 六份实际 class catalog 中 `capabilities[].id` 的完整闭集。
 *
 * 权威目录：`scenes`、`containers`、`items`、`weapons`、`movement`、`vehicles`。
 * armor / shield 是 items 目录中的组合能力；profile / damage 的组合入口在 weapons 目录。
 * 目录增加或删除能力时，机械对齐测试会要求本闭集同步变更。
 */
export const SPACE_ITEMS_CAPABILITY_IDS = Object.freeze([
  // scenes
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
  // containers
  'container.capability.host_binding',
  'container.capability.node_placement',
  'container.capability.capacity_declaration',
  'container.capability.access_condition',
  'container.capability.deposit',
  'container.capability.withdraw',
  'container.capability.lockable',
  'container.capability.deposit_disabled',
  'container.capability.derived_content_source',
  // items（含 armor / shield 组合能力）
  'item.capability.recover',
  'item.capability.cure',
  'item.capability.armor',
  'item.capability.shield',
  'item.capability.lock_interaction',
  'item.capability.status_grant',
  'item.capability.durability',
  'item.capability.consumption',
  'item.capability.ammunition_supply',
  'item.capability.accessory_mount',
  'item.capability.heavy_tag_aggregation',
  'item.capability.death_container_binding',
  // weapons（handling_profile 是三种武器类共同消费的负重档入口）
  // 战术能力（2026-08-12 D-071：6类枪械战术能力定义）
  'weapon.capability.quickdraw',
  'weapon.capability.ready_stance',
  'weapon.capability.suppressive_fire',
  'weapon.capability.scatter_shot',
  'weapon.capability.hold_breath',
  'weapon.capability.assault_advance',
  'weapon.capability.range_profile',
  'weapon.capability.handling_profile',
  'weapon.capability.damage_reference',
  'weapon.capability.target_limit',
  'weapon.capability.ammunition_binding',
  'weapon.capability.accessory_compatibility',
  // movement
  'movement.capability.adjacency_traversal',
  'movement.capability.vehicle_bound_traversal',
  'movement.capability.discontinuous_traversal',
  'movement.capability.terrain_condition',
  'movement.capability.collision_effect',
  'movement.capability.cost_declaration',
  // vehicles
  'vehicle.capability.durable',
  'vehicle.capability.seat_binding',
  'vehicle.capability.cargo',
  'vehicle.capability.lockable',
  'vehicle.capability.door_addressing',
  'vehicle.capability.adjacency_interaction',
  'vehicle.capability.door_target_interaction',
  'vehicle.capability.drive',
  'vehicle.capability.collision',
  'vehicle.capability.boarding',
  'vehicle.capability.occupant_extraction',
  'vehicle.capability.tire_sabotage',
  'vehicle.capability.targetable_parts',
  'vehicle.capability.damage_stages',
  'vehicle.capability.destruction_sequence',
  'vehicle.capability.offroad',
  'vehicle.capability.pushable_transition',
  'vehicle.capability.mounted_melee',
  'vehicle.capability.medical_bay',
  'vehicle.capability.emergency_signal',
  'vehicle.capability.armor',
  'vehicle.capability.reinforced_tire',
  'vehicle.capability.intimidation',
] as const);

export type SpaceItemsCapabilityId = (typeof SPACE_ITEMS_CAPABILITY_IDS)[number];

export function isSpaceItemsCapabilityId(value: unknown): value is SpaceItemsCapabilityId {
  return isWellFormedId(value) && (SPACE_ITEMS_CAPABILITY_IDS as readonly string[]).includes(value);
}

export function capabilityRank(capabilityId: SpaceItemsCapabilityId): number {
  const index = SPACE_ITEMS_CAPABILITY_IDS.indexOf(capabilityId);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** 能力在规范化领域投影中的 JSON 路径；统一使用 RFC 6901 拼接器。 */
export function capabilityJsonPath(capabilityId: SpaceItemsCapabilityId): JsonPath {
  return joinJsonPath('', 'capabilities', capabilityRank(capabilityId));
}

/** 武器配置只能通过这些组合角色进入，不存在已废止的形状角色。 */
export const WEAPON_COMPOSITION_ROLES = Object.freeze([
  'weapon-attribute',
  'profile',
  'range-policy',
  'damage-reference',
  'ammunition-behavior',
  'accessory-compatibility',
  'action-sequence',
  'target-limit',
] as const);

export type WeaponCompositionRole = (typeof WEAPON_COMPOSITION_ROLES)[number];

export function isWeaponCompositionRole(value: unknown): value is WeaponCompositionRole {
  return isWellFormedId(value) && (WEAPON_COMPOSITION_ROLES as readonly string[]).includes(value);
}

export function weaponCompositionRoleRank(role: WeaponCompositionRole): number {
  const index = WEAPON_COMPOSITION_ROLES.indexOf(role);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** 缺任一项都会使武器结算管道不完整；武器属性本身是可选组合面。 */
export const REQUIRED_WEAPON_COMPOSITION_ROLES = Object.freeze([
  'profile',
  'damage-reference',
  'action-sequence',
] as const satisfies readonly WeaponCompositionRole[]);

export const CONTAINER_ROLES = Object.freeze([
  'carried',
  'stationary',
  'equipment-slot',
  'vehicle-cargo',
  'death-container',
] as const);

export type ContainerRole = (typeof CONTAINER_ROLES)[number];

export function isContainerRole(value: unknown): value is ContainerRole {
  return isWellFormedId(value) && (CONTAINER_ROLES as readonly string[]).includes(value);
}

export function containerRoleRank(role: ContainerRole): number {
  const index = CONTAINER_ROLES.indexOf(role);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export const SEAT_ROLES = Object.freeze(['driver', 'passenger', 'gunner', 'medic-bay'] as const);
export type SpaceItemsSeatRole = (typeof SEAT_ROLES)[number];

export function isSeatRole(value: unknown): value is SpaceItemsSeatRole {
  return isWellFormedId(value) && (SEAT_ROLES as readonly string[]).includes(value);
}

export function seatRoleRank(role: SpaceItemsSeatRole): number {
  const index = SEAT_ROLES.indexOf(role);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export type MicroSceneDefinitionId = DefinitionId;
export type NaturalSceneDefinitionId = DefinitionId;
export type TransitionDefinitionId = DefinitionId;
export type VehicleDoorId = string;
export type ContainerSlotRoleId = string;

/** 领域族到允许的引擎层 Def kind 的只读约束。 */
export const DOMAIN_FAMILY_DEF_KINDS: Readonly<Record<SpaceItemsFamilyId, readonly string[]>> =
  deepFreeze({
    'natural-scene': ['node'],
    'micro-scene': ['node'],
    transition: ['link'],
    container: ['entity', 'item'],
    item: ['item'],
    weapon: ['item'],
    profile: ['rule'],
    damage: ['rule'],
    armor: ['item'],
    shield: ['item'],
    movement: ['action', 'rule'],
    vehicle: ['entity'],
  });
