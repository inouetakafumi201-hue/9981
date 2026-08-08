/**
 * Runtime activation boundary for validated PlaypackDef values.
 * Definition publication, permanent-rule mounting, pool initialization, schedule selection, and entry
 * effects either all become active or are all restored to the pre-activation snapshot.
 */
import type { RuleProvider } from '../events/rule-provider.js';
import type { RuleDef } from '../events/types.js';
import type { Effect } from '../events/effect-types.js';
import type { OpContext, OpRegistry } from '../ops/registry.js';
import type { Result } from '../ops/result.js';
import { err, ok } from '../ops/result.js';
import type { Def, DefRegistry } from '../state/def.js';
import type { Diagnostic } from '../state/diagnostic.js';
import type { Id } from '../state/ids.js';
import type { Value } from '../state/value.js';
import type { ScheduleDef } from './types.js';
import type { LoadResult, PlaypackDef } from './playpack.js';
import { PlaypackLoader } from './playpack.js';

export interface PlaypackActivateArgs {
  playpackId: Id;
}

export interface PlaypackRuntimeOpsDeps {
  playpackLookup: (id: Id) => PlaypackDef | null;
  defLookup: (id: Id) => Def | null;
  runEffects?: (effects: Effect[], ctx: OpContext, vars: Record<string, Value>) => Result<void>;
}

export interface PlaypackActivatorDeps {
  loader: PlaypackLoader;
  defRegistry: DefRegistry;
  opRegistry: OpRegistry;
  ruleProvider: RuleProvider;
}

export interface ActivationResult extends LoadResult {}

function runEffects(
  effects: Effect[] | undefined,
  ctx: OpContext,
  deps: PlaypackRuntimeOpsDeps,
  playpack: PlaypackDef,
): Result<void> {
  if (!effects || effects.length === 0 || !deps.runEffects) return ok(undefined);
  return deps.runEffects(effects, ctx, { playpack: playpack.id });
}

export function registerPlaypackRuntimeOps(registry: OpRegistry, deps: PlaypackRuntimeOpsDeps): void {
  registry.register<PlaypackActivateArgs, void>('playpack.activate', (args, ctx) => {
    const playpack = deps.playpackLookup(args.playpackId);
    if (!playpack) return err('E_REF_MISSING', `Playpack ${args.playpackId} 尚未装载`);

    let schedule: ScheduleDef | undefined;
    if (playpack.schedule) {
      const definition = deps.defLookup(playpack.schedule);
      if (!definition || definition.kind !== 'schedule') {
        return err('E_LOAD_UNDEFINED_REF', `Playpack ${playpack.id} 引用的 ScheduleDef ${playpack.schedule} 不存在`);
      }
      schedule = definition as ScheduleDef;
      if (schedule.phases.length === 0) {
        return err('E_LOAD_CROSS_FIELD_CONSTRAINT', `ScheduleDef ${schedule.id} 至少需要一个 phase`);
      }
    }

    const poolResult = registry.invokeInline('pool.initialize', {
      names: (playpack.pools ?? []).map((pool) => pool.name),
    }, ctx);
    if (!poolResult.ok) return poolResult;

    const draft = ctx.tx.getDraft();
    const active = Array.isArray(draft.world.props['activePlaypacks'])
      ? draft.world.props['activePlaypacks'] as Value[]
      : [];
    const nextActive = active.includes(playpack.id) ? active : [...active, playpack.id];
    const nextTurn = schedule
      ? { scheduleId: schedule.id, phaseIndex: 0, phaseEnteredAt: draft.world.turn.phaseEnteredAt + 1 }
      : draft.world.turn;
    ctx.tx.setDraft({
      ...draft,
      world: {
        ...draft.world,
        props: { ...draft.world.props, activePlaypacks: nextActive },
        turn: nextTurn,
        // 需求15.2：把玩法包声明的保留窗口写进 WorldState，从此刻起 world.log 的裁剪按它执行。
        // 未声明时保持 undefined，recordEmit 会退回到 DEFAULT_LOG_RETENTION 的安全兜底。
        ...(playpack.logRetention !== undefined ? { logRetention: playpack.logRetention } : {}),
      },
    });

    const entry = runEffects(playpack.entry, ctx, deps, playpack);
    if (!entry.ok) return entry;
    const firstPhase = schedule?.phases[0];
    const enter = runEffects(firstPhase?.onEnter, ctx, deps, playpack);
    if (!enter.ok) return enter;

    ctx.tx.logOp('playpack.activate', args, () => {});
    return ok(undefined);
  });
}

export class PlaypackActivator {
  constructor(private readonly deps: PlaypackActivatorDeps) {}

  activate(playpack: PlaypackDef): ActivationResult {
    const preflight = this.preflight(playpack);
    if (preflight.length > 0) return { ok: false, diagnostics: preflight };

    const definitionsBefore = this.deps.defRegistry.fork();
    const loadedBefore = this.deps.loader.loadedPlaypacks();
    const mountedBefore = new Map<string, RuleDef | undefined>();
    for (const ruleId of playpack.rules ?? []) mountedBefore.set(ruleId, this.deps.ruleProvider.get(ruleId));

    const loaded = this.deps.loader.load(playpack);
    if (!loaded.ok) return loaded;

    const mountResult = this.mountPermanentRules(playpack);
    if (mountResult) {
      this.restore(definitionsBefore, loadedBefore, mountedBefore);
      return { ok: false, diagnostics: [...loaded.diagnostics, mountResult] };
    }

    const activated = this.deps.opRegistry.invoke<PlaypackActivateArgs, void>('playpack.activate', {
      playpackId: playpack.id,
    });
    if (!activated.ok) {
      this.restore(definitionsBefore, loadedBefore, mountedBefore);
      return {
        ok: false,
        diagnostics: [...loaded.diagnostics, this.diagnostic(activated.code, activated.detail, playpack.id)],
      };
    }
    return loaded;
  }

  private preflight(playpack: PlaypackDef): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const poolNames = new Set<string>();
    for (const pool of playpack.pools ?? []) {
      if (poolNames.has(pool.name)) {
        diagnostics.push(this.diagnostic('E_LOAD_CONFLICT', `PoolDef ${pool.name} 在玩法包内重复`, playpack.id));
      }
      poolNames.add(pool.name);
    }
    const activePoolNames = new Set(
      this.deps.loader.loadedPlaypacks().flatMap((active) => (active.pools ?? []).map((pool) => pool.name)),
    );
    for (const name of poolNames) {
      if (activePoolNames.has(name)) {
        diagnostics.push(this.diagnostic('E_LOAD_CONFLICT', `PoolDef ${name} 与已激活玩法包冲突`, playpack.id));
      }
    }
    return diagnostics;
  }

  private mountPermanentRules(playpack: PlaypackDef): Diagnostic | null {
    for (const ruleId of playpack.rules ?? []) {
      const definition = this.deps.defRegistry.resolve(ruleId);
      if (!definition || definition.kind !== 'rule') {
        return this.diagnostic('E_LOAD_UNDEFINED_REF', `常驻规则 ${ruleId} 不存在或不是 RuleDef`, playpack.id);
      }
      this.deps.ruleProvider.add(definition as RuleDef);
    }
    return null;
  }

  private restore(
    definitions: DefRegistry,
    loaded: readonly PlaypackDef[],
    mountedBefore: ReadonlyMap<string, RuleDef | undefined>,
  ): void {
    this.deps.defRegistry.replaceFrom(definitions);
    this.deps.loader.restoreLoaded(loaded);
    for (const [ruleId, previous] of mountedBefore) {
      if (previous) this.deps.ruleProvider.add(previous);
      else this.deps.ruleProvider.remove(ruleId);
    }
  }

  private diagnostic(code: Diagnostic['code'], message: string, playpack: Id): Diagnostic {
    return {
      code,
      severity: 'error',
      message,
      hint: '修正玩法包声明或运行时入口效果后重新激活。',
      at: { playpack },
      phase: 0,
    };
  }
}
