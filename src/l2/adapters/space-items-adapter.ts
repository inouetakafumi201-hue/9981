/**
 * L2 Adapters: Space-Items 运行时适配。
 *
 * 将 space-items 定义模型转换为 L1 运行时能够理解的形式。
 * 对应 Task 6 目标：实现 space-items 模型到 L1 运行时的转换适配器。
 *
 * References:
 * - Requirements 7-10（容器、物品、场景、载具）
 * - family-contracts.ts、space-items-contracts.ts 的契约定义
 * - L1 kernel contract 的运行时语义
 */

import type { CandidateDefinition } from '../model/definition.js';
import type { ContainerDomainContract, ShieldDomainContract } from '../model/space-items-contracts.js';
import type { TypedReference } from '../model/reference.js';

/**
 * 容器运行时配置（从 ContainerDomainContract 转换而来）。
 */
export interface ContainerRuntimeConfig {
  readonly containerId: string;
  readonly hostType: 'item' | 'vehicle';
  readonly containerRole: string;
  readonly slotAcceptancePredicateRef?: TypedReference;
  readonly accessibilityCapabilityRefs: readonly TypedReference[];
  readonly transferActionRef: TypedReference;
  readonly depositAllowed: boolean;
  readonly withdrawAllowed: boolean;
}

/**
 * 盾牌运行时配置（从 ShieldDomainContract 转换而来）。
 */
export interface ShieldRuntimeConfig {
  readonly shieldId: string;
  readonly holdingRequirementRefs: readonly TypedReference[];
  readonly blockingActionRef: TypedReference;
  readonly depletionRuleRefs: readonly TypedReference[];
  readonly breakConditionRefs: readonly TypedReference[];
}

/**
 * 场景运行时配置。
 */
export interface SceneRuntimeConfig {
  readonly sceneId: string;
  readonly scale: 'large' | 'medium' | 'small';
  readonly isEmbeddedMicroScene: boolean;
  readonly parentSceneRef?: TypedReference;
  readonly capabilityIds: readonly string[];
}

/**
 * 载具运行时配置。
 */
export interface VehicleRuntimeConfig {
  readonly vehicleId: string;
  readonly seatIds: readonly string[];
  readonly cargoContainerIds: readonly string[];
  readonly doorIds: readonly string[];
  readonly driverAgentSlotRef?: TypedReference;
  readonly adjacencyRuleIds: readonly string[];
}

/**
 * 从 ContainerDomainContract 转换为运行时配置。
 */
export function containerToRuntimeConfig(
  definition: CandidateDefinition,
  contract: ContainerDomainContract,
): ContainerRuntimeConfig {
  const def = definition as unknown as Record<string, unknown>;
  return {
    containerId: definition.id,
    hostType: contract.hostType,
    containerRole: contract.containerRole,
    slotAcceptancePredicateRef: contract.slotAcceptancePredicateRef,
    accessibilityCapabilityRefs: contract.accessibilityCapabilityRefs,
    transferActionRef: contract.transferActionRef,
    // 检查参数字段决定是否允许存取
    depositAllowed: typeof def[contract.depositAllowedField ?? ''] === 'boolean'
      ? (def[contract.depositAllowedField ?? ''] as boolean)
      : true,
    withdrawAllowed: typeof def[contract.withdrawAllowedField ?? ''] === 'boolean'
      ? (def[contract.withdrawAllowedField ?? ''] as boolean)
      : true,
  };
}

/**
 * 从 ShieldDomainContract 转换为运行时配置。
 */
export function shieldToRuntimeConfig(
  definition: CandidateDefinition,
  contract: ShieldDomainContract,
): ShieldRuntimeConfig {
  return {
    shieldId: definition.id,
    holdingRequirementRefs: contract.holdingRequirementRefs,
    blockingActionRef: contract.blockingActionRef,
    depletionRuleRefs: contract.depletionRuleRefs,
    breakConditionRefs: contract.breakConditionRefs,
  };
}

/**
 * 从定义转换场景运行时配置。
 */
export function sceneToRuntimeConfig(definition: CandidateDefinition): SceneRuntimeConfig {
  const def = definition as unknown as Record<string, unknown>;
  return {
    sceneId: definition.id,
    scale: (def.scale as 'large' | 'medium' | 'small') ?? 'medium',
    isEmbeddedMicroScene: (def.isEmbeddedMicroScene as boolean) ?? false,
    parentSceneRef: def.parentSceneRef as TypedReference | undefined,
    capabilityIds: Array.isArray(def.capabilityIds) ? (def.capabilityIds as string[]) : [],
  };
}

/**
 * 从定义转换载具运行时配置。
 */
export function vehicleToRuntimeConfig(definition: CandidateDefinition): VehicleRuntimeConfig {
  const def = definition as unknown as Record<string, unknown>;
  return {
    vehicleId: definition.id,
    seatIds: Array.isArray(def.seatIds) ? (def.seatIds as string[]) : [],
    cargoContainerIds: Array.isArray(def.cargoContainerIds) ? (def.cargoContainerIds as string[]) : [],
    doorIds: Array.isArray(def.doorIds) ? (def.doorIds as string[]) : [],
    driverAgentSlotRef: def.driverAgentSlotRef as TypedReference | undefined,
    adjacencyRuleIds: Array.isArray(def.adjacencyRuleIds) ? (def.adjacencyRuleIds as string[]) : [],
  };
}

/**
 * 验证容器运行时配置的完整性。
 */
export function validateContainerRuntimeConfig(config: ContainerRuntimeConfig): readonly string[] {
  const errors: string[] = [];

  if (!config.containerId || config.containerId.length === 0) {
    errors.push('Container ID cannot be empty');
  }

  if (config.hostType !== 'item' && config.hostType !== 'vehicle') {
    errors.push(`Invalid hostType: ${config.hostType}`);
  }

  if (!config.containerRole || config.containerRole.length === 0) {
    errors.push('Container role cannot be empty');
  }

  if (!config.transferActionRef) {
    errors.push('Transfer action reference is required');
  }

  return errors;
}

/**
 * 验证场景运行时配置的完整性。
 */
export function validateSceneRuntimeConfig(config: SceneRuntimeConfig): readonly string[] {
  const errors: string[] = [];

  if (!config.sceneId || config.sceneId.length === 0) {
    errors.push('Scene ID cannot be empty');
  }

  const validScales = ['large', 'medium', 'small'];
  if (!validScales.includes(config.scale)) {
    errors.push(`Invalid scale: ${config.scale}`);
  }

  if (config.isEmbeddedMicroScene && !config.parentSceneRef) {
    errors.push('Embedded micro-scene must have parent scene reference');
  }

  return errors;
}

/**
 * 验证载具运行时配置的完整性。
 */
export function validateVehicleRuntimeConfig(config: VehicleRuntimeConfig): readonly string[] {
  const errors: string[] = [];

  if (!config.vehicleId || config.vehicleId.length === 0) {
    errors.push('Vehicle ID cannot be empty');
  }

  if (!Array.isArray(config.seatIds) || config.seatIds.length === 0) {
    errors.push('Vehicle must have at least one seat');
  }

  if (config.driverAgentSlotRef && !config.driverAgentSlotRef.refId) {
    errors.push('Driver slot reference is invalid');
  }

  return errors;
}
