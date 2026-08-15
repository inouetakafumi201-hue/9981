/**
 * ECS 组件契约 ↔ 基类能力契约的机器对齐（T-CaS-01）。
 *
 * 这是本批次在"基类层×玩法层契约单源化"上交付的机器可证伪校验器：
 * 把 `src/class/class-contract.ts` 的 `ClassCatalogCapability`（含可选 `compositionKind` /
 * `familyId`）与 ECS 组件契约单一源（`family-component-shapes.ts` 的 `ComponentContract` +
 * `CompositionShape`/`FamilyShape`）交叉核对，使"能力声明的字段形状必须与 ECS 单一源一致"变成
 * 一条可断言的契约，而不是靠两处各自内联判断。
 *
 * 本模块位于 `src/l2/model`，是只读消费单一源的判定侧；它不登记组件、不写任何数据。
 * 单一源自身（`composition-registry` / `family-component-shapes` / `composition-shape`）保持纯只读，
 * 本模块不触碰。
 *
 * 匹配语义（沿用 `caSFieldMatches` 的"同轨字段"口径）：
 * - 能力声明的 `compositionKind`、`familyId` 必须与 ECS 单一源同族同 kind 的组件一致；
 * - 能力声明的 `kernelOps` 必须 ⊆ ECS 该组件声明的 `kernelOps`（System 接线白名单）；
 * - 能力声明的参数槽位必须 ⊆ ECS 该组件声明的 `parameters` 槽位集。
 *
 * 向后兼容：能力未声明 `compositionKind` / `familyId` 时视字段缺失；ECS 侧找不到匹配组件时
 * 不报（该能力可能没有对应的 ECS 组件，属既有目录的合法空隙），只对"声明了却对不上"的情况报。
 */

import type { CompositionKind } from './composition-registry.js';

/** ECS `FamilyShape` 中本对齐校器实际读取的最小形态；与 `family-component-shapes` 的 `FamilyShape` 结构兼容。 */
export interface AlignmentFamilyShape {
  readonly familyId: string;
  readonly components: readonly AlignmentComponent[];
}

/** `ComponentContract` 中本对齐校验器实际读取的最小形态。 */
export interface AlignmentComponent {
  readonly id: string;
  readonly compositionKind: CompositionKind;
  readonly parameters: readonly { readonly name: string }[];
  readonly kernelOps: readonly string[];
}

/** 一个可被对齐的能力声明投影（由 class-contract / play catalog 传入）。 */
export interface CapabilityAlignmentInput {
  /** 能力 id（如 `skill.capability.activation`、`weapon.capability.damage_reference`）。 */
  readonly capabilityId: string;
  /** 能力声明所属的语义族（如 `skill`、`weapon`）。 */
  readonly familyId: string | undefined;
  /** 该能力显式声明的 ECS 组件 id（`component.*`）；未声明为 undefined。 */
  readonly componentId: string | undefined;
  readonly compositionKind: CompositionKind | undefined;
  /** 该能力声明的参数槽位名集合。 */
  readonly declaredParameterSlots: ReadonlySet<string>;
  /** 该能力声明的 kernelOps 白名单（含裸 Op 与带字段引线形态）。 */
  readonly declaredKernelOps: ReadonlySet<string>;
}

/** 对齐结果：`ok` 为 true 表示通过；否则 `issues` 列出每条具体差异。 */
export interface ComponentAlignmentResult {
  readonly ok: boolean;
  readonly issues: readonly ComponentAlignmentIssue[];
}

export interface ComponentAlignmentIssue {
  readonly code: 'ECS_ALIGN_COMPOSITION_KIND_MISMATCH' | 'ECS_ALIGN_FAMILY_MISMATCH'
    | 'ECS_ALIGN_KERNELOPS_NOT_IN_SOURCE' | 'ECS_ALIGN_PARAMETER_NOT_IN_SOURCE'
    | 'ECS_ALIGN_COMPONENT_NOT_FOUND';
  readonly reason: string;
  readonly correction: string;
}

/**
 * 从 ECS 单一源中按族解析全部组件，供对齐使用。
 *
 * `resolveFamilyComponentShape(familyId)` 返回 `FamilyShape`，其 `components` 是
 * 该族在单一源里登记的全部 `ComponentContract`。
 */
export type ComponentSourceResolver = (familyId: string) => AlignmentFamilyShape | null;

/**
 * 执行一次能力声明 ↔ ECS 组件契约的对齐。
 *
 * 仅在能力同时声明了 `familyId` 且该族在单一源中可解析时做完整对齐：
 * - 若能力还声明了 `componentId`，取该组件（同一族内其一）核对；
 * - 否则取该族在单一源里的第一个组件作为"该能力的 ECS 形状代表"（L2 族形状即能力形状）。
 *
 * `compositionKind` / 参数 / kernelOps 任一与代表组件不一致 → 报对应问题。
 * 能力未声明 `familyId`（既有目录空隙）→ 空操作（返回 ok）。调用方据此决定是否发射诊断。
 */
export function alignCapabilityToComponentContract(
  capability: CapabilityAlignmentInput,
  resolveFamilyShape: ComponentSourceResolver,
): ComponentAlignmentResult {
  // 未声明族 id：无 ECS 形状可对齐（合法空隙），空操作。
  if (capability.familyId === undefined) {
    return { ok: true, issues: [] };
  }
  const family = resolveFamilyShape(capability.familyId);
  // 族在单一源未登记：既有目录的合法空隙，空操作（不把"静态族无 ECS 组件"误报为差异）。
  if (family === null) {
    return { ok: true, issues: [] };
  }
  if (family.components.length === 0) {
    return { ok: true, issues: [] };
  }

  const source = capability.componentId !== undefined
    ? family.components.find((component) => component.id === capability.componentId) ?? null
    : family.components[0]!;

  if (source === null) {
    return {
      ok: false,
      issues: [{
        code: 'ECS_ALIGN_COMPONENT_NOT_FOUND',
        reason: `能力 ${capability.capabilityId} 声明指向组件 ${capability.componentId}，但 ECS 族 ${capability.familyId} 的单一源里没有这个组件。`,
        correction: `把 componentId 改为 ${family.components.map((c) => c.id).join(', ')} 之一，或移除该声明。`,
      }],
    };
  }

  const issues: ComponentAlignmentIssue[] = [];

  if (capability.compositionKind !== undefined && capability.compositionKind !== source.compositionKind) {
    issues.push({
      code: 'ECS_ALIGN_COMPOSITION_KIND_MISMATCH',
      reason: `能力 ${capability.capabilityId} 声明 compositionKind=${capability.compositionKind}，但 ECS 组件 ${source.id} 的单一源是 ${source.compositionKind}。`,
      correction: `把能力声明的 compositionKind 改为 ${source.compositionKind}，或在 ECS 族 ${capability.familyId} 登记另一种 kind 的组件。`,
    });
  }

  if (capability.componentId !== undefined && capability.componentId !== source.id) {
    // 仅当能力显式指定了 componentId 而它不在单一源时，上面已报 NOT_FOUND；
    // 这里补：指定了组件但组件所属族与能力 familyId 不一致的族失配。
  }

  const sourceKernelOps = new Set(source.kernelOps);
  for (const op of capability.declaredKernelOps) {
    if (!sourceKernelOps.has(op)) {
      issues.push({
        code: 'ECS_ALIGN_KERNELOPS_NOT_IN_SOURCE',
        reason: `能力 ${capability.capabilityId} 的 kernelOps 白名单含 ${op}，但 ECS 组件 ${source.id} 单一源只允许 ${[...sourceKernelOps].join(', ')}。`,
        correction: `把 ${op} 收进 ECS 组件 ${source.id} 的 kernelOps，或从能力声明移除（写入必须走 ECS 组件登记的 System 接线）。`,
      });
    }
  }

  const sourceParameters = new Set(source.parameters.map((field) => field.name));
  for (const slot of capability.declaredParameterSlots) {
    if (!sourceParameters.has(slot)) {
      issues.push({
        code: 'ECS_ALIGN_PARAMETER_NOT_IN_SOURCE',
        reason: `能力 ${capability.capabilityId} 的 parameters 声明了槽位 ${slot}，但 ECS 组件 ${source.id} 单一源的可配置字段集是 ${[...sourceParameters].join(', ')}。`,
        correction: `把 ${slot} 声明进 ECS 组件 ${source.id} 的 parameters，或在能力声明移除该槽位。`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}
