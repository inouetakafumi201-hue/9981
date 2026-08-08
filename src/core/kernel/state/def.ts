/**
 * L1 State: Def 声明与继承（design.md 3.1节 / 需求3.1-3.5）。
 */
import type { Id } from './ids.js';
import { isRef } from './ids.js';
import type { Value } from './value.js';
import type { Expr } from './expr-types.js';
import { collectCallTargets } from './expr-types.js';
import type { ErrCode } from './error-codes.js';

export type DefKind =
  | 'entity'
  | 'item'
  | 'node'
  | 'link'
  | 'attachment'
  | 'action'
  | 'rule'
  | 'playpack'
  | 'decision'
  | 'prefab'
  | 'expr'
  | 'schedule'
  | 'policy';

export interface ContainerSpec {
  name: string;
  insert: 'fixed' | 'shift';
  slots?: number;
}

export interface SlotSpec {
  tags?: string[];
  accepts?: Expr;
}

export interface Def {
  readonly id: Id;
  readonly kind: DefKind;
  readonly extends?: Id[];
  readonly abstract?: boolean;
  readonly tags?: string[];
  readonly props?: Record<string, Value>;
  readonly containers?: ContainerSpec[];
  readonly slots?: SlotSpec[];
  readonly actions?: Id[];
  readonly rules?: Id[];
  readonly clamp?: Record<string, { min?: number; max?: number; int?: boolean }>;
  readonly schema?: Record<string, unknown>;
  // 允许具体 DefKind 扩展额外字段（如 ExprDef.body、ActionDef.effects）
  readonly [key: string]: unknown;
}

export type DefRegisterResult = { ok: true } | { ok: false; code: ErrCode; detail: string };

/**
 * DefRegistry：继承展开与环检测（写入通道情形c：装载期例外）。
 * register 在装载期被调用，不经过 OpRegistry —— 此时无对局、无 journal、无 Hook。
 */
export class DefRegistry {
  private readonly raw = new Map<Id, Def>();
  private readonly resolved = new Map<Id, Def>();

  register(def: Def): DefRegisterResult {
    const previousRaw = this.raw.get(def.id);
    const previousResolved = this.resolved.get(def.id);
    this.raw.set(def.id, deepClone(def));

    const restorePrevious = (): void => {
      if (previousRaw) this.raw.set(def.id, previousRaw);
      else this.raw.delete(def.id);
      if (previousResolved) this.resolved.set(def.id, previousResolved);
      else this.resolved.delete(def.id);
    };

    // 环检测允许前向引用，但任何失败都必须完整恢复该 ID 的最后有效 raw/resolved 状态。
    const cycleCheck = this.detectCycle(def.id, 'extends');
    if (cycleCheck) {
      restorePrevious();
      return { ok: false, code: 'E_LOAD_CYCLE_DEP', detail: `继承环: ${cycleCheck.join(' -> ')}` };
    }
    if (def.kind === 'expr') {
      const exprCycle = this.detectCycle(def.id, 'call');
      if (exprCycle) {
        restorePrevious();
        return { ok: false, code: 'E_EXPR_CALL_CYCLE', detail: `具名表达式调用环: ${exprCycle.join(' -> ')}` };
      }
    }
    // 缺失父定义仍允许作为装载批次内前向引用；包级装载器会在提交前执行完整引用检查。
    this.resolved.delete(def.id);
    this.tryExpand(def.id);
    return { ok: true };
  }

  /** 返回一个 Def 节点在指定边类型下的出边目标 Id 列表：'extends' 走继承边，'call' 走具名表达式调用边。 */
  private outgoingEdges(d: Def, edgeKind: 'extends' | 'call'): Id[] {
    if (edgeKind === 'extends') return d.extends ?? [];
    if (d.kind !== 'expr') return [];
    const body = (d as unknown as { body?: Expr }).body;
    return body ? collectCallTargets(body) : [];
  }

  private detectCycle(startId: Id, edgeKind: 'extends' | 'call'): Id[] | null {
    const visiting = new Set<Id>();
    const visited = new Set<Id>();
    const path: Id[] = [];

    const dfs = (id: Id): Id[] | null => {
      if (visited.has(id)) return null;
      if (visiting.has(id)) {
        const cycleStart = path.indexOf(id);
        return path.slice(cycleStart).concat(id);
      }
      const d = this.raw.get(id);
      if (!d) return null; // 引用了尚未注册的 Def，非环检测本身的职责
      visiting.add(id);
      path.push(id);
      for (const nextId of this.outgoingEdges(d, edgeKind)) {
        const cyc = dfs(nextId);
        if (cyc) return cyc;
      }
      path.pop();
      visiting.delete(id);
      visited.add(id);
      return null;
    };

    return dfs(startId);
  }

  private tryExpand(id: Id, visiting: Set<Id> = new Set()): Def | null {
    const cached = this.resolved.get(id);
    if (cached) return cached;
    const d = this.raw.get(id);
    if (!d) return null;
    if (visiting.has(id)) return null; // 环已在 detectCycle 拦截，这里是防御性兜底
    visiting.add(id);
    if (!d.extends || d.extends.length === 0) {
      // 与继承分支保持一致：resolve() 的返回值里 abstract 恒为严格布尔值，不是 undefined
      // （即便 checkInstantiable 用 === true 判断时 undefined 也能正确处理，让 resolve()
      // 的输出契约本身就不含糊，比"依赖下游判断方式碰巧兼容"更符合"运行期零容忍模糊"的原则）。
      const result = { ...d, abstract: d.abstract ?? false };
      this.resolved.set(id, result);
      return result;
    }
    let merged: Record<string, unknown> = {};
    for (const parentId of d.extends) {
      const parentExpanded = this.tryExpand(parentId, visiting);
      if (!parentExpanded) return null; // 父 Def 尚未注册，暂不缓存，等待后续 register 重新触发展开
      merged = deepMerge(merged, parentExpanded as unknown as Record<string, unknown>);
    }
    merged = deepMerge(merged, d as unknown as Record<string, unknown>);
    merged['id'] = d.id;
    merged['kind'] = d.kind;
    // abstract 是实例化边界标记，不是可继承的数据字段（design.md 未明确但由需求3的用户故事
    // 反推得出的设计决策，记录于 决策与风险记录.md）：若 abstract 像 props 一样被 deepMerge
    // 继承，则任何继承自 abstract 基类的具体子类都会永久卡在 abstract:true（除非每次都手写
    // abstract:false 覆盖），这会让"定义抽象基类、派生具体子类"这一继承的核心用例——需求3
    // 的用户故事本身描述的场景——完全无法工作。因此 abstract 必须像 id/kind 一样强制取自
    // 子 Def 自身的声明，不从父链合并；子 Def 未声明则视为 false（具体类），这与大多数
    // 面向对象语言"子类默认具体，除非显式声明为抽象"的直觉一致。
    merged['abstract'] = d.abstract ?? false;
    const result = merged as unknown as Def;
    this.resolved.set(id, result);
    return result;
  }

  /**
   * 已展开继承的最终 Def，纯读。若缓存未命中（例如父 Def 在此 Def 之后才注册），
   * 惰性重新展开一次；展开成功则回填缓存，后续调用恢复 O(1)。
   */
  resolve(id: Id): Def | null {
    return this.resolved.get(id) ?? this.tryExpand(id);
  }

  /**
   * 沿继承链判断某个已知 defId 是否是 baseDefId 的子类（含自身），纯读。
   * 需求12.7 的 `isA(ref, defId)` Expr 算子由 L2 ExprEngine 实现：先从 ref 指向的对象读出其 `def` 字段，
   * 再调用这个结构性方法判断继承关系——DefRegistry 本身不持有 WorldState，无法从 Ref 解出对象。
   */
  defIsA(defId: Id, baseDefId: Id): boolean {
    if (defId === baseDefId) return true;
    const d = this.raw.get(defId);
    if (!d) return false;
    for (const parentId of d.extends ?? []) {
      if (this.defIsA(parentId, baseDefId)) return true;
    }
    return false;
  }

  getRaw(id: Id): Def | null {
    return this.raw.get(id) ?? null;
  }

  has(id: Id): boolean {
    return this.raw.has(id);
  }

  allRaw(): Def[] {
    return Array.from(this.raw.values(), (def) => deepClone(def));
  }

  allResolved(): Def[] {
    return Array.from(this.resolved.values(), (def) => deepClone(def));
  }

  /** 创建完全隔离的候选注册表；候选失败不会修改当前活动实例。 */
  fork(): DefRegistry {
    const forked = new DefRegistry();
    for (const [id, def] of this.raw) forked.raw.set(id, deepClone(def));
    for (const [id, def] of this.resolved) forked.resolved.set(id, deepClone(def));
    return forked;
  }

  /** 以一次同步替换发布已验证候选；调用前不得再执行可能失败的用户逻辑。 */
  replaceFrom(candidate: DefRegistry): void {
    const nextRaw = new Map<Id, Def>();
    const nextResolved = new Map<Id, Def>();
    for (const [id, def] of candidate.raw) nextRaw.set(id, deepClone(def));
    for (const [id, def] of candidate.resolved) nextResolved.set(id, deepClone(def));
    this.raw.clear();
    this.resolved.clear();
    for (const [id, def] of nextRaw) this.raw.set(id, def);
    for (const [id, def] of nextResolved) this.resolved.set(id, def);
  }
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !isRef(value) &&
      base[key] !== undefined &&
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
}

function deepClone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = deepClone(val);
  }
  return out as unknown as T;
}
