/**
 * L6 Actions: ActionCatalog.queryActions（design.md 3.7节 / 需求25.1-25.7, 44.1）。
 *
 * 同一份实现同时服务 UI 菜单、AI 着法生成、网络协议校验、模糊测试采样（需求25.3）：
 * mode 参数只影响 TargetSpec.range/count 的展开粒度，不存在两套着法生成代码。
 */
import type { Ref } from '../state/ids';
import type { Value } from '../state/value';
import { ExprEngine } from '../expr/engine';
import type { EvalContext } from '../expr/engine';
import type { QueryEngine } from '../expr/query-engine';
import type { WorldState } from '../state/world-state';
import type { ActionDef, LegalAction, TargetSpec } from './types';

export type QueryMode = 'ui' | 'ai';

export interface ActionCatalogDeps {
  getState: () => WorldState;
  exprEngine?: ExprEngine;
  queryEngine: QueryEngine;
  ctxForActor: (actor: Ref, bindings: Record<string, Value>) => EvalContext;
  listActionDefs: () => ActionDef[];
}

/** 数值区间展开：'ui' 返回完整区间描述，'ai' 只采样边界值/当前可承担最大值/step 网格点（需求25.7）。 */
function expandRange(
  spec: NonNullable<TargetSpec['range']>,
  mode: QueryMode,
  exprEngine: ExprEngine,
  ctx: EvalContext,
  affordableMax?: number,
): number[] {
  const min = exprEngine.eval(spec.min, ctx);
  const max = exprEngine.eval(spec.max, ctx);
  const step = exprEngine.eval(spec.step, ctx);
  if (typeof min !== 'number' || typeof max !== 'number' || typeof step !== 'number' || step <= 0) return [];

  if (mode === 'ui') {
    const full: number[] = [];
    for (let v = min; v <= max; v += step) full.push(v);
    return full;
  }

  // ai 模式：边界值 + 当前可承担最大值 + step 网格上的有限点（这里取一个小的固定网格采样数，
  // 保证分支数量有界，具体网格密度是本实现的判断，design.md 未给出精确数值）
  const points = new Set<number>([min, max]);
  if (affordableMax !== undefined && affordableMax >= min && affordableMax <= max) points.add(affordableMax);
  const gridSize = 5;
  for (let i = 0; i <= gridSize; i++) {
    const v = min + ((max - min) * i) / gridSize;
    points.add(Math.round(v / step) * step);
  }
  return Array.from(points).filter((v) => v >= min && v <= max);
}

export class ActionCatalog {
  private readonly exprEngine: ExprEngine;

  constructor(private readonly deps: ActionCatalogDeps) {
    this.exprEngine = deps.exprEngine ?? new ExprEngine();
  }

  /**
   * queryActions(actor, mode)：返回该行动者当前可执行的着法列表（需求25.2）。
   * require 不满足 -> 不出现（需求25.4）；visible 满足但 require 不满足 -> 灰显、带 reason（需求25.5）。
   */
  queryActions(actor: Ref, mode: QueryMode): LegalAction[] {
    const results: LegalAction[] = [];
    for (const action of this.deps.listActionDefs()) {
      const bindingsList = this.expandBindings(action, actor, mode);
      for (const bindings of bindingsList) {
        const ctx = this.deps.ctxForActor(actor, bindings);
        const requireOk = action.require === undefined || this.exprEngine.eval(action.require, ctx) === true;
        if (requireOk) {
          results.push({ action: action.id, bindings, cost: action.cost ?? [] });
          continue;
        }
        // 需求25.4 是默认规则："require 不满足 -> 不出现"；需求25.5 是例外情形："满足 visible"才灰显。
        // 未声明 visible 视为不满足（沿用需求25.4 的默认规则，不给"未声明"赋予"总是可见"的隐含语义）。
        const visibleOk = action.visible !== undefined && this.exprEngine.eval(action.visible, ctx) === true;
        if (visibleOk) {
          const reason = action.reason ? this.exprEngine.eval(action.reason, ctx) : null;
          results.push({ action: action.id, bindings, cost: action.cost ?? [], reason: typeof reason === 'string' ? reason : undefined });
        }
        // require 不满足且 visible 也不满足：不出现在结果中（需求25.4）
      }
    }
    return results;
  }

  /** 展开 TargetSpec 的绑定组合：range/count 按 mode 展开，query 型 target 枚举匹配的 Ref。 */
  private expandBindings(action: ActionDef, actor: Ref, mode: QueryMode): Record<string, Value>[] {
    const targets = action.targets ?? [];
    if (targets.length === 0) return [{}];

    let combos: Record<string, Value>[] = [{}];
    for (const target of targets) {
      const nextCombos: Record<string, Value>[] = [];
      for (const combo of combos) {
        const values = this.expandTargetValues(target, actor, combo, mode);
        for (const v of values) {
          nextCombos.push({ ...combo, [target.name]: v });
        }
        if (target.optional && values.length === 0) {
          nextCombos.push({ ...combo });
        }
      }
      combos = nextCombos;
    }
    return combos;
  }

  private expandTargetValues(target: TargetSpec, actor: Ref, existingBindings: Record<string, Value>, mode: QueryMode): Value[] {
    if (target.range) {
      const ctx = this.deps.ctxForActor(actor, existingBindings);
      return expandRange(target.range, mode, this.exprEngine, ctx) as unknown as Value[];
    }
    if (target.query) {
      const ctx = this.deps.ctxForActor(actor, existingBindings);
      const refs = this.deps.queryEngine.run(this.deps.getState(), target.query, {
        exprEngine: this.exprEngine,
        baseCtx: ctx,
        ctxForSelf: (ref) => this.deps.ctxForActor(actor, { ...existingBindings, [`${target.name}Ref`]: ref }),
      });
      return refs as unknown as Value[];
    }
    return [];
  }
}
