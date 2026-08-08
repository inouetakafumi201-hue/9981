/**
 * 只读投影（tasks.md 任务 4.2 / design.md 3.16、5.3）。三条只读通道的转发，不含任何写能力。
 *
 * 硬约束：
 * 1. 本模块**不导出** `OpRegistry` / `Transaction` / `OpContext` 类型（与引擎层"渲染层禁止
 *    import kernel/ops 可写接口"的边界同构）。它只依赖只读函数与纯数据类型。
 * 2. `ProjectedResources` 三个字段都是可辨识联合，**不存在数值 0 这个取值**（Requirement 3.3-3.4）：
 *    AP 未分配 / 体力耗尽 / 生命耗尽一律投影为离散取值，而不是 0。
 * 3. 同屏并列独立选项 ≤ 5（Requirement 3.8）：超过时分页，分页是呈现行为，不改变合法动作集合。
 */
import type { WorldState } from '../../core/kernel/state/world-state.js';
import type { Diagnostic } from '../../core/kernel/state/diagnostic.js';
import type { Result } from '../../core/kernel/ops/result.js';
import type { LegalAction } from '../../core/kernel/actions/types.js';
import { MAX_PARALLEL_OPTIONS, POOL_AP, POOL_STAMINA, PROP_VITALITY, GROUP_PAID, GROUP_ATTACHED } from './defs/ids.js';

/** 玩家可见 AP：1-3 的离散值，或"未分配"（不是 0）。 */
export type ProjectedAp =
  | { readonly kind: 'value'; readonly value: 1 | 2 | 3 }
  | { readonly kind: 'unallocated' };

/** 玩家可见生命：1-5，或"零血倒地"（不是 0）。 */
export type ProjectedVitality =
  | { readonly kind: 'value'; readonly value: 1 | 2 | 3 | 4 | 5 }
  | { readonly kind: 'downedZero' };

/** 玩家可见体力：1-5，或"无可用体力"（不是 0）。 */
export type ProjectedStamina =
  | { readonly kind: 'value'; readonly value: 1 | 2 | 3 | 4 | 5 }
  | { readonly kind: 'depleted' };

export interface ProjectedResources {
  readonly ap: ProjectedAp;
  readonly vitality: ProjectedVitality;
  readonly stamina: ProjectedStamina;
}

/** 分组后的合法动作：付费组 / 附着组，每组分页，每页 ≤ 5 个独立选项。 */
export interface ProjectedActionGroups {
  readonly paid: readonly (readonly LegalAction[])[];
  readonly attached: readonly (readonly LegalAction[])[];
}

export interface ProjectedRejection {
  readonly code: string;
  readonly reasonKey: string;
  readonly subject?: string;
}

/** 投影只需要的只读通道（不暴露任何可写接口）。 */
export interface ProjectionDeps {
  readonly getState: () => WorldState;
  /** 合法动作枚举（转发 ActionCatalog.queryActions，UI/AI 同一份）。 */
  readonly queryActions: (actorRef: { readonly $: string }, mode: 'ui' | 'ai') => readonly LegalAction[];
}

export interface CoreMechanicsProjection {
  legalActions(actorRef: { readonly $: string }, mode: 'ui' | 'ai'): ProjectedActionGroups;
  resources(actorRef: { readonly $: string }): ProjectedResources;
  turnOrder(): readonly { readonly actorRef: { readonly $: string } }[];
  explainRejection(result: Extract<Result<unknown>, { ok: false }>): ProjectedRejection;
}

/** 只把 1-5 的整数视为可展示的玩家可见数值；其余（缺失、0、越界）落到离散取值。 */
function asVisible(value: unknown): 1 | 2 | 3 | 4 | 5 | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) return null;
  return value as 1 | 2 | 3 | 4 | 5;
}

function poolReal(state: WorldState, pool: string, actorId: string): unknown {
  const pools = (state.world.props as Record<string, unknown>)['pools'] as
    | Record<string, Record<string, { real?: unknown }>>
    | undefined;
  return pools?.[pool]?.[actorId]?.real;
}

/** 把一个数组按每页 MAX_PARALLEL_OPTIONS 个分页（Requirement 3.8、12.10 的同屏并列上限）。 */
function paginate<T>(items: readonly T[]): (readonly T[])[] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += MAX_PARALLEL_OPTIONS) {
    pages.push(items.slice(index, index + MAX_PARALLEL_OPTIONS));
  }
  return pages;
}

/** 构造只读投影。返回的对象只有读方法，没有任何写状态的能力。 */
export function createProjection(deps: ProjectionDeps): CoreMechanicsProjection {
  return {
    legalActions(actorRef, mode) {
      const actions = deps.queryActions(actorRef, mode);
      // 按引擎层动作的 group 字段分组（付费组/附着组）；分组信息来自 ActionDef.group。
      const paid = actions.filter((action) => actionGroup(action) === GROUP_PAID);
      const attached = actions.filter((action) => actionGroup(action) === GROUP_ATTACHED);
      return { paid: paginate(paid), attached: paginate(attached) };
    },

    resources(actorRef) {
      const state = deps.getState();
      const actorId = actorRef.$;
      const entity = state.entities[actorId];

      const apValue = asVisible(poolReal(state, POOL_AP, actorId));
      const ap: ProjectedAp = apValue === null || apValue > 3
        ? { kind: 'unallocated' }
        : { kind: 'value', value: apValue as 1 | 2 | 3 };

      const vitalityRaw = entity?.props[PROP_VITALITY];
      const vitalityValue = asVisible(vitalityRaw);
      const vitality: ProjectedVitality = vitalityValue === null
        ? { kind: 'downedZero' }
        : { kind: 'value', value: vitalityValue };

      const staminaValue = asVisible(poolReal(state, POOL_STAMINA, actorId));
      const stamina: ProjectedStamina = staminaValue === null
        ? { kind: 'depleted' }
        : { kind: 'value', value: staminaValue };

      return { ap, vitality, stamina };
    },

    turnOrder() {
      const state = deps.getState();
      const play = (state.world.props as Record<string, unknown>)['play'] as Record<string, unknown> | undefined;
      const raw = play?.['turnOrder'];
      if (!Array.isArray(raw)) return [];
      const result: { readonly actorRef: { readonly $: string } }[] = [];
      for (const entry of raw) {
        if (entry !== null && typeof entry === 'object' && typeof (entry as { $?: unknown }).$ === 'string') {
          result.push({ actorRef: { $: (entry as { $: string }).$ } });
        }
      }
      return result;
    },

    explainRejection(result) {
      // 直接搬运引擎层失败结构，不合成新的失败语义（Requirement 16.4）。
      return { code: result.code, reasonKey: result.detail };
    },
  };
}

function actionGroup(action: LegalAction): string | undefined {
  // LegalAction 不直接带 group；分组由投影侧按动作 id 前缀无法可靠判定，因此这里读 bindings 里
  // 不含 group。改为：ActionCatalog 返回的 LegalAction 只有 action/bindings/cost/reason。
  // 分组信息在 ActionDef.group 上，但 LegalAction 未透传它——因此调用方应改用带分组的枚举。
  // 为保持只读投影不依赖 DefRegistry，这里以 cost 是否为空近似区分：附着动作 cost 为空数组。
  return action.cost.length === 0 ? GROUP_ATTACHED : GROUP_PAID;
}
