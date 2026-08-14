/**
 * L2 Model: 语义族组件形状（Composition_Shape）。
 *
 * 对应 `.kiro/specs/wakeup-base-layer-ecs` Requirements 7、8 与 design.md 的两条族契约收敛组件接口：
 * - `shapeFamilyContract(familyId)`：把族契约字段形状为能力组件；
 * - `preserveFamilyFingerprint(familyId)`：保留族契约既有能力指纹（被 spaces-items 容器载体引用）。
 *
 * `compositionShape.*` 是族级字段（Glossary「Composition_Shape」）：由族契约持有者维护，
 * 声明该族的原语能力组件形状，供验证器核对。本模块以一个族级 Shape 契约承载这份声明，
 * 让既有 `family-contracts.ts` 的 13 个语义族可以以组件形状面世，且不破坏其既有能力指纹。
 */

import type { SemanticFamilyId } from './ids.js';
import type { CompositionKind, ComponentContract } from './composition-registry.js';

/**
 * Composition_Shape：一个语义族对原语能力组件形状的既定声明。
 *
 * `components` 是该族在原语层的能力组件集合（`component.<family>.<name>`）；
 * `shapeIds` 是可选组合形状（如载具族）；`preservesFingerprint` 标记
 * 族契约既有能力指纹是否被保留（Requirement 7 系列：既有契约指纹不因收敛而丢失）。
 */
export interface FamilyShape {
  readonly familyId: SemanticFamilyId;
  readonly components: readonly ComponentContract[];
  readonly shapeIds: readonly string[];
  /** 该族是否保留既有 family-contracts 的能力指纹（Requirements 7.1-7.7）。 */
  readonly preservesFingerprint: boolean;
  /** 该族是否必需组合形状（Requirement 2.4：特化的单组件族不需要形状）。 */
  readonly requiresShape: boolean;
}

/**
 * 语义族 → 组件形状登记表。以 `compositionShape.*` 为族级字段命名空间。
 *
 * 由族契约持有者（`family-contracts.ts`、`space-items-contracts.ts` 的收敛端）填充；
 * 验证器通过 `resolveFamilyShape` 核对某族的原语能力组件是否与声明一致。
 */
export class CompositionShapeRegistry {
  private readonly shapes = new Map<SemanticFamilyId, FamilyShape>();

  /** 登记一个语义族的组件形状。 */
  register(shape: FamilyShape): void {
    const existing = this.shapes.get(shape.familyId);
    if (existing !== undefined && existing !== shape) {
      throw new Error(`CompositionShapeRegistry: family shape conflict for '${shape.familyId}'`);
    }
    this.shapes.set(shape.familyId, shape);
  }

  /** 解析某语义族的组件形状；未登记返回 null。 */
  resolveFamilyShape(familyId: SemanticFamilyId): FamilyShape | null {
    return this.shapes.get(familyId) ?? null;
  }

  /** 列出全部已登记族形状，按 familyId 字典序稳定排序。 */
  listShapes(): readonly FamilyShape[] {
    return [...this.shapes.values()].sort((a, b) =>
      a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0,
    );
  }
}

/**
 * 既有 `family-contracts.ts` 能力指纹是否被当前族形状保留。
 * 这是 `preserveFamilyFingerprint` 的判定核心：家族目录以 `capabilities` 为组织核心，
 * 收敛后族契约字段形状为能力组件（`component.<family>.<name>`），既有指纹不因收敛丢失。
 */
export function preservesFamilyFingerprint(
  shape: FamilyShape,
  declaredCapabilityIds: readonly string[],
): boolean {
  const shapeIds = new Set(shape.components.map((component) => component.id));
  // 族契约既有能力指纹 = 该族声明的 capability id 集合中，仍能以 component 形状出现的部分。
  return declaredCapabilityIds.every((id) => shapeIds.has(id));
}

/**
 * 校验某族能力组件的 compositionKind 与族声明一致。
 * 用途：让验证器把「族级 compositionShape 备选」（Requirement 8.5）与单能力声明对齐。
 */
export function familyAllowsCompositionKind(
  shape: FamilyShape,
  componentId: string,
  kind: CompositionKind,
): boolean {
  const component = shape.components.find((candidate) => candidate.id === componentId);
  if (component === undefined) {
    return false;
  }
  return component.compositionKind === kind;
}
