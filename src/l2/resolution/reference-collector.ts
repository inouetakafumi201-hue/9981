/**
 * L2 Resolution: 从候选定义收集全部类型化引用。
 *
 * 对应 Requirements 12.1（解析每个 base/action/rule/expr/policy/node/link/item/attachment/container/slot 引用）。
 *
 * 引用来自：extends、actionRefs、ruleRefs、otherRefs、composition[].target、
 * 以及 familyContract 内各族声明的 TypedReference。集中在此收集，避免各处遗漏。
 */

import { joinJsonPath } from '../model/ids';
import type { CandidateDefinition } from '../model/definition';
import type { FamilyContract } from '../model/family-contracts';
import type { TypedReference } from '../model/reference';

/** 一条收集到的引用及其宿主。 */
export interface CollectedReference {
  readonly hostId: string;
  readonly reference: TypedReference;
}

/** extends 视为 base 角色的引用（目标应为可继承的基类，允许抽象）。 */
function extendsReferences(definition: CandidateDefinition): CollectedReference[] {
  return (definition.extends ?? []).map((ref) => ({
    hostId: definition.id,
    reference: {
      refId: ref.refId,
      role: 'base',
      expected: { allowAbstract: true },
      jsonPath: ref.jsonPath,
      required: true,
    },
  }));
}

/** 收集 familyContract 内的全部 TypedReference。 */
function familyContractReferences(contract: FamilyContract): readonly TypedReference[] {
  const refs: TypedReference[] = [];
  const push = (ref: TypedReference | undefined): void => {
    if (ref !== undefined) {
      refs.push(ref);
    }
  };
  const pushAll = (list: readonly TypedReference[] | undefined): void => {
    for (const ref of list ?? []) {
      refs.push(ref);
    }
  };

  switch (contract.contractKind) {
    case 'action':
      pushAll(contract.effectRefs);
      pushAll(contract.interruptionConditionRefs);
      push(contract.hostActionRef);
      for (const step of contract.sequence ?? []) {
        push(step.actionRef);
        push(step.intermediateStatusRef);
      }
      for (const actor of contract.actorRequirements) {
        push(actor.conditionExprRef);
      }
      for (const target of contract.targetRequirements) {
        push(target.conditionExprRef);
      }
      break;
    case 'gateway':
      if (contract.resourceConversion !== undefined) {
        pushAll(contract.resourceConversion.inputResourceRefs);
        pushAll(contract.resourceConversion.outputEffectRefs);
      }
      if (contract.check !== undefined) {
        push(contract.check.primitiveRef);
        pushAll(contract.check.successEffectRefs);
        pushAll(contract.check.failureEffectRefs);
      }
      if (contract.condition !== undefined) {
        push(contract.condition.conditionExprRef);
        pushAll(contract.condition.successEffectRefs);
        pushAll(contract.condition.failureEffectRefs);
      }
      break;
    case 'natural-scene':
      push(contract.sharedMicroSceneCapabilityRef);
      pushAll(contract.personalVacantGroundMicroSceneRefs);
      break;
    case 'micro-scene':
      push(contract.parent);
      push(contract.occupancyContractRef);
      break;
    case 'transition':
      pushAll(contract.endpoints);
      pushAll(contract.traversalConditionRefs);
      pushAll(contract.blockingCapabilityRefs);
      break;
    case 'item':
      pushAll(contract.containerEligibility.requiredContainerCapabilityRefs);
      for (const slot of contract.slotRequirements) {
        push(slot.slotRef);
      }
      for (const equip of contract.equipRequirements) {
        push(equip.conditionExprRef);
      }
      pushAll(contract.grantedActionRefs);
      for (const point of contract.attachmentPoints) {
        push(point.acceptedRef);
      }
      if (contract.armor !== undefined) {
        pushAll(contract.armor.mitigationRuleRefs);
        pushAll(contract.armor.breakConditionRefs);
        for (const slot of contract.armor.equipmentSlotRequirements) {
          push(slot.slotRef);
        }
      }
      if (contract.consumable !== undefined) {
        pushAll(contract.consumable.effectRefs);
      }
      if (contract.heavyTagAggregation !== undefined) {
        push(contract.heavyTagAggregation.queryRef);
        push(contract.heavyTagAggregation.relationRef);
      }
      if (contract.deathContainerCapability !== undefined) {
        push(contract.deathContainerCapability.containerRef);
      }
      break;
    case 'vehicle':
      for (const seat of contract.seatRoles) {
        pushAll(seat.occupantRequirementRefs);
      }
      for (const cargo of contract.cargoContainers) {
        push(cargo.containerRef);
      }
      for (const door of contract.doors) {
        push(door.lockCapabilityRef);
      }
      push(contract.lockCapabilityRef);
      push(contract.movementCapabilityRef);
      push(contract.collisionCapabilityRef);
      push(contract.d030PolicyRef);
      if (contract.destructionDisposition !== undefined) {
        push(contract.destructionDisposition.occupantDispositionRef);
        push(contract.destructionDisposition.cargoDispositionRef);
      }
      break;
    case 'damage':
      for (const actor of contract.sourceRequirements) {
        push(actor.conditionExprRef);
      }
      for (const target of contract.targetRequirements) {
        push(target.conditionExprRef);
      }
      pushAll(contract.settlementPipelineRefs);
      break;
    case 'status':
      pushAll(contract.triggerRefs);
      pushAll(contract.interruptionRefs);
      pushAll(contract.effectRefs);
      for (const interaction of contract.interactions) {
        push(interaction.counterpartRef);
        push(interaction.interactionRuleRef);
      }
      break;
    case 'skill':
      pushAll(contract.triggerConditionRefs);
      pushAll(contract.effectRefs);
      break;
    case 'movement':
      pushAll(contract.collisionEffectRefs);
      break;
    case 'attachment':
      pushAll(contract.grantedRuleRefs);
      break;
    case 'ai-behavior':
      for (const state of contract.states) {
        pushAll(state.goalRefs);
        pushAll(state.intentRefs);
      }
      for (const transition of contract.transitions) {
        push(transition.conditionExprRef);
      }
      push(contract.fallbackStateRef);
      pushAll(contract.requiredActionRefs);
      break;
    case 'weapon':
      // 武器契约的配置引用（攻击谱型、伤害接口、配件）通过 composition 组件表达，
      // 已由 collectReferences 的 composition 分支收集；契约本身不含额外 TypedReference。
      break;
    case 'generic':
      break;
    default: {
      const exhaustive: never = contract;
      return exhaustive;
    }
  }
  return refs;
}

/** 收集一个定义的全部类型化引用。 */
export function collectReferences(definition: CandidateDefinition): readonly CollectedReference[] {
  const collected: CollectedReference[] = [...extendsReferences(definition)];

  const add = (ref: TypedReference): void => {
    collected.push({ hostId: definition.id, reference: ref });
  };
  for (const ref of definition.actionRefs) {
    add(ref);
  }
  for (const ref of definition.ruleRefs) {
    add(ref);
  }
  for (const ref of definition.otherRefs ?? []) {
    add(ref);
  }
  definition.composition.forEach((component, index) => {
    if (component.target !== undefined) {
      add({
        ...component.target,
        jsonPath: component.target.jsonPath || joinJsonPath(definition.jsonPath ?? '', 'composition', index, 'target'),
      });
    }
  });
  if (definition.familyContract !== undefined) {
    for (const ref of familyContractReferences(definition.familyContract)) {
      add(ref);
    }
  }
  return collected;
}
