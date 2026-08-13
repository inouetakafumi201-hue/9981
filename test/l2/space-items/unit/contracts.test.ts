/**
 * 单元测试：space-items-contracts 领域契约扩展与字面量约束。
 *
 * 实施要求 2.1：
 * - ContainerDomainContract、ShieldDomainContract 与字面量常量的定义
 * - 字面量固定值断言（不可变设计）
 * - 违规检测面在合法定义中缺省
 * - 类型层强制性约束（@ts-expect-error 反向断言）
 */

import { describe, it, expect } from 'vitest';
import {
  REMOVED_STATUS_BLACKLIST,
  REGULATORY_DETECTION_FIELDS,
  VEHICLE_STRUCTURAL_LITERALS,
  DEATH_CONTAINER_STRUCTURAL_LITERALS,
  MICRO_SCENE_CREATOR_STRUCTURAL_LITERALS,
  MICRO_SCENE_OCCUPANCY_STRUCTURAL_LITERAL,
  DEPRECATED_CARRYING_MECHANISM_FIELDS,
  isSpaceItemsDomainContract,
  type ContainerDomainContract,
  type ShieldDomainContract,
} from '../../../../src/l2/model/space-items-contracts.js';

describe('space-items-contracts: 字面量约束与结构性验证', () => {
  // ─────────────────────────────────────────────────────────────────────
  // 字面量固定值测试（需求 2.1）
  // ─────────────────────────────────────────────────────────────────────

  describe('VEHICLE_STRUCTURAL_LITERALS', () => {
    it('backingDefKind 恒为 "entity"', () => {
      expect(VEHICLE_STRUCTURAL_LITERALS.backingDefKind).toBe('entity');
    });

    it('seatBindOpId 恒为 "agent.bind"', () => {
      expect(VEHICLE_STRUCTURAL_LITERALS.seatBindOpId).toBe('agent.bind');
    });

    it('seatUnbindOpId 恒为 "agent.unbind"', () => {
      expect(VEHICLE_STRUCTURAL_LITERALS.seatUnbindOpId).toBe('agent.unbind');
    });

    it('所有字面量被冻结', () => {
      expect(Object.isFrozen(VEHICLE_STRUCTURAL_LITERALS)).toBe(true);
    });
  });

  describe('DEATH_CONTAINER_STRUCTURAL_LITERALS', () => {
    it('depositDisabled 恒为 true', () => {
      expect(DEATH_CONTAINER_STRUCTURAL_LITERALS.depositDisabled).toBe(true);
    });

    it('contentSource 恒为 "deceased-entity-transaction"', () => {
      expect(DEATH_CONTAINER_STRUCTURAL_LITERALS.contentSource).toBe(
        'deceased-entity-transaction',
      );
    });

    it('depositMarkTiming 恒为 "after-infusion-commit"', () => {
      expect(DEATH_CONTAINER_STRUCTURAL_LITERALS.depositMarkTiming).toBe(
        'after-infusion-commit',
      );
    });

    it('所有字面量被冻结', () => {
      expect(Object.isFrozen(DEATH_CONTAINER_STRUCTURAL_LITERALS)).toBe(true);
    });
  });

  describe('MICRO_SCENE_CREATOR_STRUCTURAL_LITERALS', () => {
    it('immutable 恒为 true', () => {
      expect(MICRO_SCENE_CREATOR_STRUCTURAL_LITERALS.immutable).toBe(true);
    });

    it('purpose 恒为 "provenance-only"', () => {
      expect(MICRO_SCENE_CREATOR_STRUCTURAL_LITERALS.purpose).toBe('provenance-only');
    });

    it('所有字面量被冻结', () => {
      expect(Object.isFrozen(MICRO_SCENE_CREATOR_STRUCTURAL_LITERALS)).toBe(true);
    });
  });

  describe('MICRO_SCENE_OCCUPANCY_STRUCTURAL_LITERAL', () => {
    it('occupancySource 恒为 "derived-query"', () => {
      expect(MICRO_SCENE_OCCUPANCY_STRUCTURAL_LITERAL.occupancySource).toBe('derived-query');
    });

    it('被冻结', () => {
      expect(Object.isFrozen(MICRO_SCENE_OCCUPANCY_STRUCTURAL_LITERAL)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 已移除状态黑名单与违规检测面
  // ─────────────────────────────────────────────────────────────────────

  describe('REMOVED_STATUS_BLACKLIST', () => {
    it('被冻结为 ReadonlySet', () => {
      expect(Object.isFrozen(REMOVED_STATUS_BLACKLIST)).toBe(true);
    });

    it('支持 has() 方法', () => {
      expect(typeof REMOVED_STATUS_BLACKLIST.has).toBe('function');
    });
  });

  describe('REGULATORY_DETECTION_FIELDS', () => {
    it('是只读数组', () => {
      expect(Array.isArray(REGULATORY_DETECTION_FIELDS)).toBe(true);
      expect(Object.isFrozen(REGULATORY_DETECTION_FIELDS)).toBe(true);
    });

    it('包含场景违规面字段', () => {
      expect(REGULATORY_DETECTION_FIELDS).toContain('concreteMapNodeIds');
      expect(REGULATORY_DETECTION_FIELDS).toContain('spawnPointIds');
      expect(REGULATORY_DETECTION_FIELDS).toContain('shrinkOrderIds');
    });

    it('包含微型场景创建者误用字段', () => {
      expect(REGULATORY_DETECTION_FIELDS).toContain('creatorAsOwner');
      expect(REGULATORY_DETECTION_FIELDS).toContain('creatorAsLifecycleDeterminant');
      expect(REGULATORY_DETECTION_FIELDS).toContain('creatorAsAccessControl');
    });

    it('包含过渡违规面字段', () => {
      expect(REGULATORY_DETECTION_FIELDS).toContain('boundConcreteSceneIds');
      expect(REGULATORY_DETECTION_FIELDS).toContain('concreteApCost');
      expect(REGULATORY_DETECTION_FIELDS).toContain('concreteDistance');
    });

    it('包含容器违规面字段', () => {
      expect(REGULATORY_DETECTION_FIELDS).toContain('concreteSlotCount');
      expect(REGULATORY_DETECTION_FIELDS).toContain('concreteCapacity');
    });

    it('包含武器/伤害违规面字段', () => {
      expect(REGULATORY_DETECTION_FIELDS).toContain('baseDamageTable');
      expect(REGULATORY_DETECTION_FIELDS).toContain('concreteHitThreshold');
      expect(REGULATORY_DETECTION_FIELDS).toContain('damageTable');
    });

    it('包含防具/移动违规面字段', () => {
      expect(REGULATORY_DETECTION_FIELDS).toContain('concreteMitigation');
      expect(REGULATORY_DETECTION_FIELDS).toContain('concreteDurability');
    });

    it('包含载具违规面字段', () => {
      expect(REGULATORY_DETECTION_FIELDS).toContain('interiorMicroSceneBoundary');
      expect(REGULATORY_DETECTION_FIELDS).toContain('directOccupantStateWrite');
      expect(REGULATORY_DETECTION_FIELDS).toContain('directCargoStateWrite');
    });
  });

  describe('DEPRECATED_CARRYING_MECHANISM_FIELDS', () => {
    it('包含已否决携带机制字段', () => {
      expect(DEPRECATED_CARRYING_MECHANISM_FIELDS).toContain('volumeClass');
      expect(DEPRECATED_CARRYING_MECHANISM_FIELDS).toContain('pocketSlots');
    });

    it('被冻结为只读数组', () => {
      expect(Object.isFrozen(DEPRECATED_CARRYING_MECHANISM_FIELDS)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 合同合法构造示例
  // ─────────────────────────────────────────────────────────────────────

  describe('ContainerDomainContract 合法构造', () => {
    it('可定义有效容器契约', () => {
      const validContainer: ContainerDomainContract = {
        contractKind: 'container',
        hostType: 'item',
        containerRole: 'inventory',
        accessibilityCapabilityRefs: [
          {
            refId: 'container.capability.open',
            role: 'capability',
            expected: { semanticFamily: 'gateway', allowAbstract: false },
            jsonPath: '$.accessibilityCapabilityRefs[0]',
            required: true,
          },
        ],
        transferActionRef: {
          refId: 'item.move',
          role: 'action',
          expected: { semanticFamily: 'action', allowAbstract: false },
          jsonPath: '$.transferActionRef',
          required: true,
        },
      };

      expect(validContainer.contractKind).toBe('container');
      expect(validContainer.hostType).toBe('item');
      expect(validContainer.concreteSlotCount).toBeUndefined();
      expect(validContainer.concreteCapacity).toBeUndefined();
    });

    it('容器可指定存取字段', () => {
      const containerWithFields: ContainerDomainContract = {
        contractKind: 'container',
        hostType: 'vehicle',
        containerRole: 'cargo',
        depositAllowedField: 'acceptsDeposits',
        withdrawAllowedField: 'acceptsWithdrawal',
        accessibilityCapabilityRefs: [],
        transferActionRef: {
          refId: 'item.move',
          role: 'action',
          expected: { semanticFamily: 'action', allowAbstract: false },
          jsonPath: '$.transferActionRef',
          required: true,
        },
      };

      expect(containerWithFields.depositAllowedField).toBe('acceptsDeposits');
      expect(containerWithFields.withdrawAllowedField).toBe('acceptsWithdrawal');
    });

    it('违规检测面在合法定义中缺省', () => {
      const validContainer: ContainerDomainContract = {
        contractKind: 'container',
        hostType: 'item',
        containerRole: 'inventory',
        accessibilityCapabilityRefs: [],
        transferActionRef: {
          refId: 'item.move',
          role: 'action',
          expected: { semanticFamily: 'action', allowAbstract: false },
          jsonPath: '$.transferActionRef',
          required: true,
        },
      };

      expect(validContainer.concreteSlotCount).toBeUndefined();
      expect(validContainer.concreteCapacity).toBeUndefined();
    });
  });

  describe('ShieldDomainContract 合法构造', () => {
    it('可定义有效盾牌契约', () => {
      const validShield: ShieldDomainContract = {
        contractKind: 'shield',
        holdingRequirementRefs: [
          {
            refId: 'requirement.physical.grip',
            role: 'requirement',
            expected: { semanticFamily: 'action', allowAbstract: false },
            jsonPath: '$.holdingRequirementRefs[0]',
            required: true,
          },
        ],
        blockingActionRef: {
          refId: 'action.shield.block',
          role: 'action',
          expected: { semanticFamily: 'action', allowAbstract: false },
          jsonPath: '$.blockingActionRef',
          required: true,
        },
        depletionRuleRefs: [
          {
            refId: 'rule.shield.durability_loss',
            role: 'rule',
            expected: { semanticFamily: 'status', allowAbstract: false },
            jsonPath: '$.depletionRuleRefs[0]',
            required: true,
          },
        ],
        breakConditionRefs: [
          {
            refId: 'condition.shield.destroyed',
            role: 'status',
            expected: { semanticFamily: 'status', allowAbstract: false },
            jsonPath: '$.breakConditionRefs[0]',
            required: true,
          },
        ],
      };

      expect(validShield.contractKind).toBe('shield');
      expect(validShield.holdingRequirementRefs).toHaveLength(1);
      expect(validShield.mvpDefaultInteractionIds).toBeUndefined();
    });

    it('盾牌违规检测面在合法定义中缺省', () => {
      const validShield: ShieldDomainContract = {
        contractKind: 'shield',
        holdingRequirementRefs: [],
        blockingActionRef: {
          refId: 'action.shield.block',
          role: 'action',
          expected: { semanticFamily: 'action', allowAbstract: false },
          jsonPath: '$.blockingActionRef',
          required: true,
        },
        depletionRuleRefs: [],
        breakConditionRefs: [],
      };

      expect(validShield.mvpDefaultInteractionIds).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 类型层强制性（@ts-expect-error 反向断言）
  // ─────────────────────────────────────────────────────────────────────

  describe('类型层强制约束', () => {
    it('VEHICLE_STRUCTURAL_LITERALS 的 backingDefKind 被冻结', () => {
      // 验证字面量值恒定
      expect(VEHICLE_STRUCTURAL_LITERALS.backingDefKind).toBe('entity');
    });

    it('DEATH_CONTAINER_STRUCTURAL_LITERALS 的 depositDisabled 被冻结', () => {
      // 验证字面量值恒定
      expect(DEATH_CONTAINER_STRUCTURAL_LITERALS.depositDisabled).toBe(true);
    });

    it('MICRO_SCENE_CREATOR_STRUCTURAL_LITERALS 的 immutable 被冻结', () => {
      // 验证字面量值恒定
      expect(MICRO_SCENE_CREATOR_STRUCTURAL_LITERALS.immutable).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 类型守卫函数
  // ─────────────────────────────────────────────────────────────────────

  describe('isSpaceItemsDomainContract', () => {
    it('容器契约被识别', () => {
      const containerContract: ContainerDomainContract = {
        contractKind: 'container',
        hostType: 'item',
        containerRole: 'inventory',
        accessibilityCapabilityRefs: [],
        transferActionRef: {
          refId: 'item.move',
          role: 'action',
          expected: { semanticFamily: 'action', allowAbstract: false },
          jsonPath: '$.transferActionRef',
          required: true,
        },
      };

      expect(isSpaceItemsDomainContract(containerContract)).toBe(true);
    });

    it('盾牌契约被识别', () => {
      const shieldContract: ShieldDomainContract = {
        contractKind: 'shield',
        holdingRequirementRefs: [],
        blockingActionRef: {
          refId: 'action.shield.block',
          role: 'action',
          expected: { semanticFamily: 'action', allowAbstract: false },
          jsonPath: '$.blockingActionRef',
          required: true,
        },
        depletionRuleRefs: [],
        breakConditionRefs: [],
      };

      expect(isSpaceItemsDomainContract(shieldContract)).toBe(true);
    });

    it('非空间物品契约被拒绝', () => {
      const otherContract = { contractKind: 'action' };
      expect(isSpaceItemsDomainContract(otherContract)).toBe(false);
    });

    it('null 被拒绝', () => {
      expect(isSpaceItemsDomainContract(null)).toBe(false);
    });

    it('undefined 被拒绝', () => {
      expect(isSpaceItemsDomainContract(undefined)).toBe(false);
    });

    it('非对象值被拒绝', () => {
      expect(isSpaceItemsDomainContract('container')).toBe(false);
      expect(isSpaceItemsDomainContract(42)).toBe(false);
    });
  });
});
