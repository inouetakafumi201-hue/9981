/**
 * L9 PlaypackDef + PlaypackLoader: 5-step loading algorithm
 * (design.md 3.10节 / 需求32.1-32.8, Property 19, 23).
 */
import type { Id } from '../state/ids';
import type { Def } from '../state/def';
import type { DefRegistry } from '../state/def';
import type { ErrCode } from '../state/error-codes';
import type { Diagnostic } from '../state/diagnostic';
import type { Expr } from '../state/expr-types';
import type { Effect } from '../events/effect-types';
import { Linter } from '../safety/safety';

export interface PoolDef {
  readonly name: string;
  readonly per: 'world' | 'actor' | 'faction';
  readonly min?: Expr;
  readonly max?: Expr;
  /** 新 scope 首次出现时的真实值；省略时为 min，min 也省略时为 0。 */
  readonly initial?: Expr;
  readonly reset: 'never' | 'turn' | 'phase' | Expr;
  /** reset 命中时写入的值；省略时回到 initial。 */
  readonly resetTo?: Expr;
}

export interface OutcomeDef {
  readonly name: string;
  readonly when: Expr;
  readonly scope: 'game' | 'agent' | 'faction';
  readonly rank?: Expr;
  readonly onReach?: Effect[];
  readonly ends: boolean;
}

export interface PlaypackDef extends Def {
  readonly kind: 'playpack';
  readonly version: string;
  readonly schedule?: Id;
  readonly pools?: PoolDef[];
  readonly conflicts?: Id[];
  readonly visibility?: Id;
  readonly logRetention?: { readonly phases?: number; readonly max?: number };
  readonly outcomes?: OutcomeDef[];
  readonly evaluate?: Expr;
  readonly policies?: Id[];
  readonly entry?: Effect[];
  readonly requires?: string[];
  readonly defs: Def[];
  readonly hookOrder?: Id[];
  readonly overrides?: Record<Id, Id>;
  readonly linter?: (defs: Def[]) => Diagnostic[];
}

export interface LoadResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

export interface PlaypackLoaderOpts {
  defRegistry: DefRegistry;
  existingPlaypacks?: PlaypackDef[];
}

/**
 * PlaypackLoader: 5-step loading algorithm (需求32.1-32.8).
 *
 * Step 1: Topo sort playpack dependencies
 * Step 2: Conflicts check — no two playpacks define same Id with incompatible overrides
 * Step 3: Apply overrides — remap def Ids per overrides table
 * Step 4: Hook ordering — sort hook rules by hookOrder declaration
 * Step 5: Run linter if present
 */
export class PlaypackLoader {
  /**
   * 已经成功装载的玩法包。构造参数只是初始基线；每次成功装载都要并入这里，
   * 否则顺序装载依赖链时 requires 永远无法满足，且对先前装载包的冲突检测会失效。
   */
  private readonly loaded: PlaypackDef[];

  constructor(private readonly opts: PlaypackLoaderOpts) {
    this.loaded = [...(opts.existingPlaypacks ?? [])];
  }

  /** 当前已装载的玩法包（只读快照）。 */
  loadedPlaypacks(): readonly PlaypackDef[] {
    return [...this.loaded];
  }

  /** 激活协调器失败时恢复装载历史；定义注册表由协调器用 fork/replaceFrom 同步恢复。 */
  restoreLoaded(playpacks: readonly PlaypackDef[]): void {
    this.loaded.length = 0;
    this.loaded.push(...playpacks);
  }

  load(playpack: PlaypackDef): LoadResult {
    const diagnostics: Diagnostic[] = [];
    const existing = this.loaded;
    const existingIds = new Set(existing.map((item) => item.id));

    for (const required of playpack.requires ?? []) {
      if (!existingIds.has(required)) diagnostics.push(this.diag('E_LOAD_UNDEFINED_REF', `玩法包 ${playpack.id} 依赖的 ${required} 不存在`, playpack.id));
    }
    const sorted = PlaypackLoader.topoSort([...existing, playpack]);
    if (!sorted) diagnostics.push(this.diag('E_LOAD_CYCLE_DEP', `玩法包 ${playpack.id} 的依赖图存在循环`, playpack.id));
    for (const current of existing) {
      if ((playpack.conflicts ?? []).includes(current.id) || (current.conflicts ?? []).includes(playpack.id)) {
        diagnostics.push(this.diag('E_LOAD_CONFLICT', `玩法包 ${playpack.id} 与 ${current.id} 明确声明不兼容`, playpack.id));
      }
    }
    // 注：D-073 单调重定义下 findConflicts 恒空（同 key 后装覆盖先装，不视为冲突），已移除该死分支。

    const seen = new Set<Id>();
    for (const def of playpack.defs) {
      if (seen.has(def.id)) diagnostics.push({ ...this.diag('E_LOAD_CONFLICT', `候选包中定义 ${def.id} 重复`, playpack.id), at: { def: def.id, playpack: playpack.id } });
      seen.add(def.id);
    }
    if (diagnostics.some(isBlocking)) return { ok: false, diagnostics };

    const defs = this.applyOverrides(playpack.defs, playpack.overrides ?? {});
    const staged = this.opts.defRegistry.fork();
    for (const def of defs) {
      // D-073 单调重定义：同 key 即覆盖/新增，不再需要 overrides 声明。
      // staged.register 若遇到同 key def，由 DefRegistry 的注册逻辑决定是覆盖还是拒绝——
      // 在单调重定义模式下，覆盖是合法的，只有跨作用域冲突才拒绝（findConflicts 已返回空）。
      const result = staged.register(def);
      if (!result.ok) diagnostics.push({
        code: result.code as ErrCode, severity: 'error', message: result.detail,
        hint: '请移除循环关系或修正定义依赖。',
        at: { def: def.id, playpack: playpack.id }, phase: 0,
      });
    }

    const mandatory = new Linter().run({ allDefs: staged.allRaw() });
    diagnostics.push(...mandatory.diagnostics);
    if (playpack.linter) {
      try {
        const custom = playpack.linter(defs);
        if (!Array.isArray(custom)) throw new Error('自定义检查必须返回诊断数组');
        diagnostics.push(...custom);
      } catch (error) {
        diagnostics.push({
          code: 'E_LOAD_DIAGNOSTIC_FACTORY', severity: 'fatal',
          message: `自定义检查发生内部故障：${error instanceof Error ? error.message : String(error)}`,
          hint: '装载已安全停止；请修复自定义检查后重试。',
          at: { playpack: playpack.id }, phase: 0,
        });
      }
    }
    if (diagnostics.some(isBlocking)) return { ok: false, diagnostics };

    this.opts.defRegistry.replaceFrom(staged);
    this.loaded.push(playpack);
    return { ok: true, diagnostics };
  }

  private diag(code: ErrCode, message: string, playpack: Id): Diagnostic {
    return { code, severity: 'error', message, hint: '请检查玩法包依赖、冲突声明和定义标识。', at: { playpack }, phase: 0 };
  }

  /** Topo-sort a list of playpacks by their requires dependencies. */
  static topoSort(playpacks: PlaypackDef[]): PlaypackDef[] | null {
    const map = new Map<string, PlaypackDef>(playpacks.map((p) => [p.id, p]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const sorted: PlaypackDef[] = [];

    function visit(id: string): boolean {
      if (visited.has(id)) return true;
      if (visiting.has(id)) return false; // cycle
      visiting.add(id);
      const pp = map.get(id);
      if (pp) {
        for (const req of pp.requires ?? []) {
          if (!visit(req)) return false;
        }
        sorted.push(pp);
      }
      visiting.delete(id);
      visited.add(id);
      return true;
    }

    for (const p of playpacks) {
      if (!visit(p.id)) return null; // cycle detected
    }
    return sorted;
  }

  private applyOverrides(defs: Def[], overrides: Record<Id, Id>): Def[] {
    if (Object.keys(overrides).length === 0) return defs;
    const rewrite = (value: unknown): unknown => {
      if (typeof value === 'string') return overrides[value] ?? value;
      if (Array.isArray(value)) return value.map(rewrite);
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, rewrite(child)]));
      }
      return value;
    };
    return defs.map((def) => rewrite(def) as Def);
  }
}

function isBlocking(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === 'error' || diagnostic.severity === 'fatal';
}
