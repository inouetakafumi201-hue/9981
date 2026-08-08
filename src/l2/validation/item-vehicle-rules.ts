/**
 * L2 Validation: 物品、武器、防具、消耗品与载具能力规则。
 *
 * 对应 Requirements 8.1–8.13、5.8、16.3–16.5、Q-05 与 Property 5/8/14。
 *
 * 铁律：
 * - 武器无具体伤害值、不与具体玩法 Profile 耦合；攻击谱型走 Composition。
 * - 护甲无内嵌具体实例；只暴露减伤/破损引用与槽位要求。
 * - 消耗品声明使用位置/效果/消耗行为。
 * - 车辆是 Entity；邻接与门目标是独立组合输入；门标识稳定；D-030 策略归 L3。
 * - 死亡容器禁止存入且内容来自死亡实体事务。
 * - Q-05 只保留组合接口，不推导盾牌标配。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { joinJsonPath } from '../model/ids.js';
import { isWellFormedId } from '../model/ids.js';
import type { CandidateDefinition } from '../model/definition.js';
import type {
  ItemContract,
  VehicleContract,
  WeaponContract,
} from '../model/family-contracts.js';
import type { DiagnosticCollector, ValidationContext } from './context.js';
import { defError } from './helpers.js';

export function validateWeapon(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'weapon') {
    return;
  }
  const weapon: WeaponContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  if (weapon.concreteDamageValue !== undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.WEAPON_CONCRETE_DAMAGE_VALUE,
        reason: `武器 ${definition.id} 分配了具体伤害值 ${weapon.concreteDamageValue}。`,
        correctionSuggestion: '武器不含具体伤害值；伤害通过伤害接口引用，具体值归玩法层（Requirements 8.4）。',
        jsonPath: joinJsonPath(base, 'concreteDamageValue'),
      }),
    );
  }
  if (weapon.gameplayProfileCoupling !== undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.LAYER_L3_OWNERSHIP,
        reason: `武器 ${definition.id} 与具体玩法 Profile「${weapon.gameplayProfileCoupling}」耦合。`,
        correctionSuggestion: '可复用武器实例不得与具体玩法 Profile 耦合（Requirements 8.4）。',
        jsonPath: joinJsonPath(base, 'gameplayProfileCoupling'),
      }),
    );
  }
  // Q-01：特殊谱型档机制未决，禁止内嵌机制定义。
  if (weapon.specialTierMechanism !== undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SOURCE_PROMOTION_REQUIRES_DECISION,
        reason: `武器 ${definition.id} 内嵌了"特殊"谱型档机制，但 Q-01 尚无权威决策。`,
        correctionSuggestion: 'Q-01 未决前只保留可扩展谱型引用（attackSpectrumTier），不得推导特殊档机制。',
        jsonPath: joinJsonPath(base, 'specialTierMechanism'),
      }),
    );
  }
}

export function validateArmorAndConsumable(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'item') {
    return;
  }
  const item: ItemContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  if (item.armor !== undefined) {
    if (item.armor.mitigationRuleRefs.length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.ARMOR_MISSING_MITIGATION_REFERENCE,
          reason: `护甲 ${definition.id} 未暴露减伤规则引用。`,
          correctionSuggestion: '护甲必须暴露减伤规则引用、破损条件引用与装备槽位要求（Requirements 8.5）。',
          jsonPath: joinJsonPath(base, 'armor', 'mitigationRuleRefs'),
        }),
      );
    }
    if (item.armor.concreteInstanceRef !== undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.ARMOR_EMBEDDED_CONCRETE_INSTANCE,
          reason: `护甲 ${definition.id} 内嵌了具体护甲实例「${item.armor.concreteInstanceRef}」。`,
          correctionSuggestion: '护甲定义不得内嵌具体实例（Requirements 8.5）。',
          jsonPath: joinJsonPath(base, 'armor', 'concreteInstanceRef'),
        }),
      );
    }
  }

  if (item.consumable !== undefined) {
    if (item.consumable.effectRefs.length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.CONSUMABLE_MISSING_CONTRACT_FIELD,
          reason: `消耗品 ${definition.id} 未声明效果引用。`,
          correctionSuggestion: '消耗品必须暴露使用位置、效果引用与消耗行为（Requirements 8.6）。',
          jsonPath: joinJsonPath(base, 'consumable', 'effectRefs'),
        }),
      );
    }
    if (item.consumable.consumptionBehavior === 'charges' && item.consumable.chargesField === undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.CONSUMABLE_MISSING_CONTRACT_FIELD,
          reason: `按次数消耗的消耗品 ${definition.id} 未指向充能次数参数字段。`,
          correctionSuggestion: '充能次数必须引用参数字段，具体次数归玩法层。',
          jsonPath: joinJsonPath(base, 'consumable', 'chargesField'),
        }),
      );
    }
  }

  // 死亡容器（Requirements 8.12）。
  if (item.deathContainerCapability !== undefined) {
    const capability = item.deathContainerCapability;
    if (!capability.depositDisabled) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.ITEM_DEATH_CONTAINER_DEPOSIT_ENABLED,
          reason: `死亡容器 ${definition.id} 未禁止存入。`,
          correctionSuggestion: '死亡容器必须是新建的禁止存入容器（Requirements 8.12）。',
          jsonPath: joinJsonPath(base, 'deathContainerCapability', 'depositDisabled'),
        }),
      );
    }
    if (capability.contentSource !== 'deceased-entity-transaction') {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.ITEM_DEATH_CONTAINER_MISSING_TRANSACTION_SOURCE,
          reason: `死亡容器 ${definition.id} 的内容来源不是死亡实体事务。`,
          correctionSuggestion: '死亡容器内容引用必须派生自死亡实体事务（Requirements 8.12）。',
          jsonPath: joinJsonPath(base, 'deathContainerCapability', 'contentSource'),
        }),
      );
    }
  }

  // 重物标签聚合必须走 L1 query/relation（Requirements 8.11）。
  if (item.heavyTagAggregation !== undefined && item.heavyTagAggregation.aggregation !== 'l1-query-relation') {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.ITEM_HEAVY_TAG_NOT_QUERY_BASED,
        reason: `物品 ${definition.id} 的重物标签聚合未使用 L1 query/relation 接口。`,
        correctionSuggestion: '重物标签聚合必须通过 L1 query 与 relation 接口暴露（Requirements 8.11）。',
        jsonPath: joinJsonPath(base, 'heavyTagAggregation', 'aggregation'),
      }),
    );
  }
}

export function validateVehicle(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'vehicle') {
    return;
  }
  const vehicle: VehicleContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  // 车辆是 Entity（Requirements 7.11）。
  if (!vehicle.entityBacked || definition.defKind !== 'entity') {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.VEHICLE_NOT_ENTITY,
        reason: `载具 ${definition.id} 未被建模为 Entity（entityBacked=${vehicle.entityBacked}, defKind=${definition.defKind}）。`,
        correctionSuggestion: '车辆是 Entity，不是 Micro_Scene 或 Item（Requirements 7.11）。',
        jsonPath: base,
      }),
    );
  }

  // 门标识稳定且唯一（Requirements 8.8）。
  const doorIds = new Set<string>();
  vehicle.doors.forEach((door, index) => {
    if (!isWellFormedId(door.doorId)) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.VEHICLE_DOOR_IDENTIFIER_UNSTABLE,
          reason: `载具 ${definition.id} 的门标识「${door.doorId}」形状不稳定。`,
          correctionSuggestion: '门标识必须是稳定、良构的标识符（Requirements 8.8）。',
          jsonPath: joinJsonPath(base, 'doors', index, 'doorId'),
        }),
      );
    }
    if (doorIds.has(door.doorId)) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.VEHICLE_DOOR_IDENTIFIER_UNSTABLE,
          reason: `载具 ${definition.id} 的门标识「${door.doorId}」重复。`,
          correctionSuggestion: '每个门标识在已解析定义内必须唯一且稳定。',
          jsonPath: joinJsonPath(base, 'doors', index, 'doorId'),
        }),
      );
    } else {
      doorIds.add(door.doorId);
    }
  });

  // 邻接与门目标是独立组合输入（Requirements 8.9）。
  if (
    vehicle.adjacencyInteractionComponentId !== undefined &&
    vehicle.doorTargetInteractionComponentId !== undefined &&
    vehicle.adjacencyInteractionComponentId === vehicle.doorTargetInteractionComponentId
  ) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.VEHICLE_ADJACENCY_COUPLED_TO_DOOR_TARGET,
        reason: `载具 ${definition.id} 的车辆邻接与门特定目标共用同一组合组件。`,
        correctionSuggestion: '车辆邻接与门特定目标必须是不同的可组合交互输入（Requirements 8.9）。',
        jsonPath: joinJsonPath(base, 'adjacencyInteractionComponentId'),
      }),
    );
  }

  // D-030 策略必须归 L3（Requirements 1.13、8.10）。
  if (vehicle.d030PolicyRef !== undefined) {
    const expectsPolicy = vehicle.d030PolicyRef.expected.defKind === 'policy';
    if (!expectsPolicy) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.VEHICLE_D030_POLICY_NOT_L3,
          reason: `载具 ${definition.id} 的 D-030 引用未指向 policy 类型。`,
          correctionSuggestion: 'D-030 乘员交互是玩法层策略；基类层只保留指向 policy 的引用（Requirements 1.13、8.10）。',
          jsonPath: joinJsonPath(base, 'd030PolicyRef'),
        }),
      );
    }
  }

  // Q-04：不得推导载具内部微型场景机制。
  if (vehicle.interiorMicroSceneBoundary !== undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SOURCE_PROMOTION_REQUIRES_DECISION,
        reason: `载具 ${definition.id} 声明了内部微型场景边界机制，但 Q-04 尚无权威决策。`,
        correctionSuggestion: 'Q-04 未决前只保留车辆邻接、门引用与微型场景父级契约，不推导内部边界机制。',
        jsonPath: joinJsonPath(base, 'interiorMicroSceneBoundary'),
      }),
    );
  }
}

/** 4.7 总入口。 */
export function validateItemsAndVehicles(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  validateWeapon(definition, context, collector);
  validateArmorAndConsumable(definition, context, collector);
  validateVehicle(definition, context, collector);
}
