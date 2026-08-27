/**
 * L8 AuraEngine: event-driven aura recompute trigger (design.md 3.9节 / 需求30.5-30.6).
 *
 * AuraEngine is NOT a polling loop. It subscribes to "attachment changed" notifications
 * and recomputes aura props for affected targets. In tests, callers trigger it directly.
 * In production, it would be wired to entity.place/prop.set after-hooks.
 */
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine';
import type { EvalContext } from '../expr/engine';
import type { WorldState } from '../state/world-state';
import type { Attachment } from '../state/attachment';
import type { Def } from '../state/def';
import type { AttachmentDef } from './types';
import type { Id } from '../state/ids';
import type { Value } from '../state/value';
import { setPath } from '../ops/path';

export interface AuraComputeResult {
  targetId: Id;
  propKey: string;
  oldValue: Value | null;
  newValue: Value | null;
}

export interface AuraEngineOpts {
  defLookup: (id: Id) => Def | null;
}

export class AuraEngine {
  private readonly exprEngine = new ExprEngine();

  constructor(private readonly opts: AuraEngineOpts) {}

  /**
   * Recompute all aura properties for attachments on the given target.
   * Returns a new WorldState with aura props updated (immutable).
   * Also returns a diff of what changed (Property 11: aura diff recompute).
   */
  recomputeForTarget(state: WorldState, targetId: Id): { state: WorldState; diff: AuraComputeResult[] } {
    const diff: AuraComputeResult[] = [];

    // Find all attachments on this target that have aura defs.
    // 需求30.8：activeAt 未到的 Attachment 不授予光环——延时生效必须同时覆盖"规则不挂载"
    // （见 wire-hooks.ts 的动态解析器）与"光环不授予"两侧，只做一侧会让延时状态半生效。
    const phase = state.world.turn.phaseEnteredAt;
    const attachments = (Object.values(state.world.attachments) as Attachment[]).filter(
      (a) => a.target.$ === targetId && (a.activeAt === undefined || a.activeAt <= phase),
    );

    let nextState = state;

    for (const attachment of attachments) {
      const def = this.opts.defLookup(attachment.def);
      if (!def || def.kind !== 'attachment') continue;
      const aDef = def as AttachmentDef;
      if (!aDef.aura) continue;

      // Evaluate the aura compute expression against the accumulating state so composed auras see
      // each other's writes.
      const evalCtx: EvalContext = makeDefaultEvalContext({
        vars: {
          attachment: attachment.props,
          stack: attachment.stack,
          target: { $: targetId },
        },
        resolvePath: (path) => {
          const parts = path.split('.');
          let cur: unknown = nextState;
          for (const part of parts) {
            if (cur === null || typeof cur !== 'object') return null;
            cur = (cur as Record<string, unknown>)[part];
          }
          return (cur ?? null) as Value | null;
        },
      });

      let computedValue: Value | null = null;
      try {
        computedValue = (this.exprEngine.eval(aDef.aura.compute, evalCtx) ?? null) as Value | null;
      } catch {
        computedValue = null;
      }

      // 缺陷修复（cross-layer S2/S3）：aura 键 `aura.${def}` 含点号（defId 形如 d:glow），而 setPath
      // 以点号为分隔符——若把它拼进写入路径，值会落到嵌套的 props.aura[def]，而读取端按字面扁平键
      // props['aura.d:glow'] 读，二者永不相交（值读不回、重算永不幂等）。修法：把 auraKey 当作 props
      // 对象的一个字面键，读写都走"整块 props 对象重写"——路径只到 `.props` 为止（targetId 无点号），
      // auraKey 作为对象键不经过路径分割，读写位置一致，因而可读回且幂等。从 nextState 读取以累积多光环。
      const auraKey = `aura.${attachment.def}`;
      const entity = nextState.entities[targetId];
      const node = entity ? undefined : nextState.nodes[targetId];
      const holder = entity ?? node;
      if (!holder) continue;
      const collection = entity ? 'entities' : 'nodes';
      const oldValue = (holder.props[auraKey] ?? null) as Value | null;
      if (oldValue !== computedValue) {
        const nextProps = { ...holder.props, [auraKey]: computedValue } as Value;
        nextState = setPath(nextState, `${collection}.${targetId}.props`, nextProps);
        diff.push({ targetId, propKey: auraKey, oldValue, newValue: computedValue });
      }
    }

    return { state: nextState, diff };
  }

  /**
   * 对当前所有承载光环 Attachment 的目标做一次无条件重算（需求30.2：拓扑变化时无条件重算）。
   * 由组合根在 entity.place/node.merge/node.split/attach.* 的 after 阶段调用。目标集合按 Id 升序
   * 处理以保证确定性。重算只经 setPath 写 aura.* prop（不走 Op），因此不会重新触发 after 分发、无环。
   */
  recomputeAll(state: WorldState): { state: WorldState; diff: AuraComputeResult[] } {
    const targets = new Set<Id>();
    for (const attachment of Object.values(state.world.attachments) as Attachment[]) {
      const def = this.opts.defLookup(attachment.def);
      if (def && def.kind === 'attachment' && (def as AttachmentDef).aura) {
        targets.add(attachment.target.$);
      }
    }
    let nextState = state;
    const allDiff: AuraComputeResult[] = [];
    for (const targetId of [...targets].sort((left, right) => left.localeCompare(right))) {
      const { state: s2, diff } = this.recomputeForTarget(nextState, targetId);
      nextState = s2;
      allDiff.push(...diff);
    }
    return { state: nextState, diff: allDiff };
  }

  /**
   * Called when an attachment changes (add/remove/update).
   * Recomputes all aura defs that list this attachment's def as a dep.
   * Returns updated state + full diff across all affected targets.
   */
  onAttachmentChanged(state: WorldState, changedAttachmentDef: Id): { state: WorldState; diff: AuraComputeResult[] } {
    // Find all targets that have an attachment whose aura.deps include changedAttachmentDef
    const affectedTargets = new Set<Id>();
    for (const att of Object.values(state.world.attachments) as Attachment[]) {
      const def = this.opts.defLookup(att.def);
      if (!def || def.kind !== 'attachment') continue;
      const aDef = def as AttachmentDef;
      if (aDef.aura?.deps.includes(changedAttachmentDef)) {
        affectedTargets.add(att.target.$);
      }
    }

    let nextState = state;
    const allDiff: AuraComputeResult[] = [];
    for (const targetId of affectedTargets) {
      const { state: s2, diff } = this.recomputeForTarget(nextState, targetId);
      nextState = s2;
      allDiff.push(...diff);
    }
    return { state: nextState, diff: allDiff };
  }
}
