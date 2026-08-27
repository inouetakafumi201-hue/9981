/**
 * L2 Model: 组件契约单一源（Composition_Registry）。
 *
 * 对应 `.kiro/specs/wakeup-base-layer-ecs` Requirements 1、2 与 design.md 的
 * `Component_Contract` / `Composition_Shape` / `Composition_Registry` /
 * `Validation_Result` 数据模型。
 *
 * 本模块是基类层 ECS 收敛的「组件契约单一源」：
 * 语义族目录的 class 与 capability 以 `component.*` 前缀
 * 集中登记，供类与组合形状以 id 引用并去重，从而避免「类与能力口径分裂」。
 *
 * 设计补充（记录于 `src/l2/决策与风险记录.md` D-ECS-001）：
 * design.md 的 `Composition_Registry` 把组件、组合形状登记在可变 Map 上。
 * 本实现将 Map 封装进私有字段，对外只暴露确定性只读方法
 * （listComponents / listShapes），与 `ordering.ts` 的 canonical-sort 惯用法对齐，
 * 保证任意登记顺序下产出顺序稳定，供 Canonical_Snapshot 复用。
 */

import type { FieldName, HumanReadableText, JsonPath, OpId, SemanticFamilyId } from './ids';
import type { ParameterField } from './schema';
import type { TypedReference } from './reference';
import type { SourceRecord } from './source';

// ---------------------------------------------------------------------------
// 组合形态常量（compositionKind）
// ---------------------------------------------------------------------------

/**
 * compositionKind 四形（Requirements 5.1）。
 * - static            静态、无哨兵、只描述形状：激活后承载物不因绑定以外的写入而变化。
 * - transient         承载物随系统写入刷新，不因单次查询而成为只读投影的稳定语义。
 * - modified-explicit 明确列出被改写与未被改写的承载字段。
 * - modified-capability 承载物改写由另一个声明了对该形态负责的组件承担。
 */
export const COMPOSITION_KINDS = [
  'static',
  'transient',
  'modified-explicit',
  'modified-capability',
] as const;

export type CompositionKind = (typeof COMPOSITION_KINDS)[number];

/** compositionKind 的规范化排序序数，用于确定性输出。 */
export function compositionKindRank(kind: CompositionKind): number {
  const index = COMPOSITION_KINDS.indexOf(kind);
  return index === -1 ? COMPOSITION_KINDS.length : index;
}

// ---------------------------------------------------------------------------
// 写通道契约
// ---------------------------------------------------------------------------

/**
 * 组件承载项写入的通道契约（Requirements 4.5）。
 * 只读投影不写语义状态：任何写入只经 L1 允许的写通道执行。
 */
export interface WriteChannelContract {
  readonly channel: 'OpRegistry.invoke';
  readonly alternateChannels: 'none';
}

export const EMPTY_WRITE_CHANNEL_CONTRACT: WriteChannelContract = Object.freeze({
  channel: 'OpRegistry.invoke',
  alternateChannels: 'none',
});

// ---------------------------------------------------------------------------
// 组件契约模型
// ---------------------------------------------------------------------------

/**
 * Component_Contract：design.md 数据模型的直接实现。
 *
 * `id` 以 `component.*` 前缀命名；`familyId` 标识所属语义族。
 * `parameters` 是可配置字段（值由 L3/UGC 填），`kernelOps` 是读写该组件的
 * System 接线（Op/Hook）。`compositionKind` 显式声明承载物生命周期变化模式。
 */
export interface ComponentContract {
  readonly id: string;
  readonly familyId: SemanticFamilyId;
  /** 可配置字段（值由 L3/UGC 填）；L2 只声明形状，不填值。 */
  readonly parameters: readonly ParameterField[];
  /** System 接线：读写该组件的 Op 名。 */
  readonly kernelOps: readonly OpId[];
  readonly compositionKind: CompositionKind;
  /** 引用其他组件（如 containerClassRefs）。 */
  readonly classReferences?: readonly TypedReference[];
  readonly writeChannelContract?: WriteChannelContract;
  /** 组件契约的来源佐证。 */
  readonly sourceRecords?: readonly SourceRecord[];
  readonly reason?: HumanReadableText;
}

/**
 * Composition_Shape：design.md 数据模型的直接实现。
 * 组合型组件族（如载具）由一组原语组件拼装，不声明 entity 基类身份。
 */
export interface CompositionShape {
  readonly id: string;
  readonly classIds: readonly string[];
  readonly capabilityIds: readonly string[];
  readonly compositionKind: CompositionKind;
  /** 玩法层归属字段名（值由 L3 填）。 */
  readonly playLayerOwnedFieldNames: readonly string[];
  /** 该组合形状所有者的族 id（`CompositionRegistry` 登记的唯一键解析为族级形状，缺省视为族形状）。 */
  readonly familyId?: string;
}

// ---------------------------------------------------------------------------
// 契约违规
// ---------------------------------------------------------------------------

/**
 * 组件 / 组合形状契约违规。与 `ValidationResult` 配套，作为文档纪律守卫的可读输出。
 * `code` 使用既有诊断命名空间（`COMPONENT_ID_CONFLICT` 等），`jsonPath` 定位来源。
 */
export interface ContractViolation {
  readonly code: string;
  readonly path: JsonPath;
  readonly reason: HumanReadableText;
  readonly correction: HumanReadableText;
}

// ---------------------------------------------------------------------------
// 确定性解析辅助
// ---------------------------------------------------------------------------

/** 归一化登记顺序：按 id 字典序排序（UTF-16，与 ordering.ts 一致）。 */
function compareById(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** 判断 `component.*` 前缀，登记时的硬校验（错误处理 §1）。 */
export function isComponentId(id: string): boolean {
  return id.startsWith('component.');
}

// ---------------------------------------------------------------------------
// Composition_Registry
// ---------------------------------------------------------------------------

/**
 * Composition_Registry：design.md 数据模型的直接实现。
 *
 * 以 `component.*` 前缀集中登记组件，供语义族的类与组合形状以 id 引用并去重。
 * 重复登记同一 `component.*` id 且契约不一致（组件 id 冲突）时抛 `Error`，
 * 由调用方转换为含 `COMPONENT_ID_CONFLICT` 的 Structured_Rejection
 * （错误处理 §1「组件 id 冲突」）。
 */
export class CompositionRegistry {
  // design.md 模型用可变 Map；本实现封装为私有，对外只暴露确定性只读方法。
  private readonly components = new Map<string, ComponentContract>();
  private readonly shapes = new Map<string, CompositionShape>();

  /** 登记一个 `component.*` 组件。 */
  registerComponent(component: ComponentContract): void {
    if (!isComponentId(component.id)) {
      throw new Error(
        `CompositionRegistry: component id '${component.id}' must use 'component.*' prefix`,
      );
    }
    const existing = this.components.get(component.id);
    if (existing !== undefined) {
      // 组件 id 冲突：同 key 后装不拒的唯一豁免是「类型身份陈述一致」的精确重复声明。
      if (!sameComponentContract(existing, component)) {
        throw new Error(`CompositionRegistry: component id conflict for '${component.id}'`);
      }
      return; // 精确重复声明：保持既有契约，不重复登记。
    }
    this.components.set(component.id, component);
  }

  /** 登记一个组合形状。 */
  registerShape(shape: CompositionShape): void {
    const existing = this.shapes.get(shape.id);
    if (existing !== undefined && !sameShape(existing, shape)) {
      throw new Error(`CompositionRegistry: shape id conflict for '${shape.id}'`);
    }
    if (existing === undefined) {
      this.shapes.set(shape.id, shape);
    }
  }

  /** 解析组件 id，返回组件定义或 null。 */
  resolveComponent(id: string): ComponentContract | null {
    return this.components.get(id) ?? null;
  }

  /** 列出全部已登记组件，按 id 字典序稳定排序。 */
  listComponents(): readonly ComponentContract[] {
    return [...this.components.values()].sort(compareById);
  }

  /** 列出全部已登记组合形状，按 id 字典序稳定排序。 */
  listShapes(): readonly CompositionShape[] {
    return [...this.shapes.values()].sort(compareById);
  }

  /**
   * 跨族去重（Requirements 2.2）：
   * 两个族声明相同可配置字段时提取共享组件并使其只定义一次。
   * 返回去重报告：被合并的组件 id 依据（供文档纪律守卫核对）。
   */
  dedupeAcrossFamilies(): DedupeReport {
    const seen = new Map<string, string /* familyId */>();
    const merged: DedupeReportEntry[] = [];
    const survivors = new Map<string, ComponentContract>();

    for (const component of this.listComponents()) {
      const fingerprintId = componentFieldFingerprint(component);
      const prior = seen.get(fingerprintId);
      if (prior === undefined) {
        seen.set(fingerprintId, component.id);
        survivors.set(component.id, component);
        continue;
      }
      // 同字段形状、不同族：提取共享组件，保留先登记者为代表。
      merged.push({
        mergedFrom: component.id,
        mergedInto: prior,
        familyId: component.familyId,
        sharedFieldNames: component.parameters.map((field) => field.name),
      });
    }

    // 去重后重建登记表，只保留代表组件。
    this.components.clear();
    for (const [id, component] of survivors) {
      this.components.set(id, component);
    }

    return { entries: merged.sort(byMergedFrom) };
  }
}

// ---------------------------------------------------------------------------
// 跨族去重报告
// ---------------------------------------------------------------------------

export interface DedupeReportEntry {
  readonly mergedFrom: string;
  readonly mergedInto: string;
  readonly familyId: SemanticFamilyId;
  readonly sharedFieldNames: readonly FieldName[];
}

export interface DedupeReport {
  readonly entries: readonly DedupeReportEntry[];
}

function byMergedFrom(left: DedupeReportEntry, right: DedupeReportEntry): number {
  return left.mergedFrom < right.mergedFrom ? -1 : left.mergedFrom > right.mergedFrom ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 等价性判定与字段指纹（私有）
// ---------------------------------------------------------------------------

/** 组件契约的字段形状指纹：只比较可配置字段名（值由 L3 填，不参与指纹）。 */
function componentFieldFingerprint(component: ComponentContract): string {
  return component.parameters
    .map((field) => field.name)
    .sort()
    .join('\u0000');
}

/** 是否"精确重复声明"（同 key 后装不拒的判定，Requirements 1.7）。 */
function sameComponentContract(left: ComponentContract, right: ComponentContract): boolean {
  return (
    left.id === right.id &&
    left.familyId === right.familyId &&
    left.compositionKind === right.compositionKind &&
    arraysEqual(left.kernelOps, right.kernelOps) &&
    arraysEqual(
      left.parameters.map((field) => field.name),
      right.parameters.map((field) => field.name),
    )
  );
}

/** 是否相同组合形状。 */
function sameShape(left: CompositionShape, right: CompositionShape): boolean {
  return (
    left.id === right.id &&
    arraysEqual(left.classIds, right.classIds) &&
    arraysEqual(left.capabilityIds, right.capabilityIds) &&
    left.compositionKind === right.compositionKind &&
    arraysEqual(left.playLayerOwnedFieldNames, right.playLayerOwnedFieldNames) &&
    (left.familyId ?? '') === (right.familyId ?? '')
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
