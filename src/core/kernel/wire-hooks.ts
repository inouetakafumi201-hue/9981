/**
 * 跨层接线：把 HookDispatcher（L4）与 FlowInterpreter（L5）接到 OpRegistry.invoke（L3）的
 * before/after veto 分发点上（design.md 3.4/3.5/3.6节，withVeto 包装器的真实实现）。
 *
 * 缺失接线补齐（记录于 决策与风险记录.md）：全部既有测试（events/__tests__/dispatcher.test.ts、
 * flow/__tests__/interpreter.test.ts、ops/__tests__/veto.test.ts）都只单独验证 HookDispatcher
 * 或 FlowInterpreter 各自的正确性，用手搭的最小 mock（`dispatchBefore: () => ({cancelled:
 * true})`、`runEffects: () => ({result: ok(undefined), vars: {}})`）代替真实实现。这意味着
 * "一条 RuleDef 的 effects 真正通过 FlowInterpreter 执行、其中一个 op 效果真正调用
 * OpRegistry.invokeInline、这个内层调用又可能触发新的 Hook 分发"这一完整链路，此前从未有
 * 任何测试真正跑过——即便三个组件各自的单元测试都是绿的，组合起来是否正确仍是未知数。
 *
 * wireHooksIntoRegistry 是这条链路的唯一合法接线方式：
 * 1. OpRegistry 的 InvokeHooks.dispatchBefore/After 委托给 HookDispatcher.dispatch，
 *    事件类型固定为 `before:${opName}` / `after:${opName}`（design.md 3.4节 withVeto 原文的
 *    事件命名约定）。
 * 2. HookDispatcher 的 EffectRunner 委托给 FlowInterpreter.run，rule.effects 数组与当前
 *    payload（作为 vars.payload）真正跑一遍 Flow 解释执行。
 * 3. HookDispatcher.resetDepth() 在每次顶层 invoke 成功提交后被调用（需求24.3：depth 在
 *    事务提交边界处重置）——OpRegistry.invoke 本身不知道 HookDispatcher 的存在，因此这一步
 *    由 wireHooksIntoRegistry 返回的 `onCommitted` 回调完成，调用方（本文件的
 *    createWiredOpRegistry）负责在 invoke 成功后调用它。
 */
import { OpRegistry } from './ops/registry.js';
import type { OpContext } from './ops/registry.js';
import { WorldStateHolder } from './ops/transaction.js';
import { HookDispatcher } from './events/dispatcher.js';
import type { EffectRunner, HookDiagnostic } from './events/dispatcher.js';
import { RuleProvider } from './events/rule-provider.js';
import { FlowInterpreter } from './flow/interpreter.js';
import type { FlowInterpreterDeps } from './flow/interpreter.js';
import { AuraEngine } from './attachment/aura-engine.js';
import type { Value } from './state/value.js';
import type { Def } from './state/def.js';
import type { RuleDef } from './events/types.js';

/**
 * WiredOpRegistry 是 OpRegistry 的一个真子类（不是重新实现的结构兼容对象）：这样它能被
 * 原样传给全部既有 `registerXxxOps(registry: OpRegistry, ...)` 函数，不需要改动任何一个
 * 既有 Op 注册函数的参数类型。唯一覆写的方法是 invoke——每次顶层调用完成后自动调用
 * hookDispatcher.resetDepth()（需求24.3：depth 在事务提交边界处重置），其它方法
 * （invokeInline/register/has/listOpNames/isStructural）继承自基类，行为不变。
 */
export class WiredOpRegistry extends OpRegistry {
  constructor(
    holder: WorldStateHolder,
    hooks: ConstructorParameters<typeof OpRegistry>[1],
    private readonly onTopLevelInvoke: () => void,
  ) {
    super(holder, hooks);
  }

  override invoke<A, T>(name: string, args: A) {
    const result = super.invoke<A, T>(name, args);
    this.onTopLevelInvoke();
    return result;
  }
}

export interface WiredHooks {
  registry: WiredOpRegistry;
  ruleProvider: RuleProvider;
  hookDispatcher: HookDispatcher;
  flowInterpreter: FlowInterpreter;
}

export interface WireHooksOpts {
  holder: WorldStateHolder;
  maxHookDepth?: number;
  onDiagnostic?: (d: HookDiagnostic) => void;
  flowBudget?: number;
  flowDeps?: Partial<Omit<FlowInterpreterDeps, 'opRegistry'>>;
  /** 用于从活动 AttachmentDef.rules 动态派生规则；省略时只使用显式常驻规则。 */
  defLookup?: (id: string) => Def | null;
}

/**
 * 组合根：构造一个 OpRegistry，其结构性 Op 的 before/after veto 真正接到 HookDispatcher，
 * HookDispatcher 触发的 RuleDef.effects 真正接到 FlowInterpreter。
 *
 * 调用方仍需自行调用各层的 registerXxxOps 把具体 Op 注册进返回的 registry（本函数不预先
 * 注册任何 Op，保持与 testing/full-harness.ts 的组合方式一致，二者的区别是本函数额外把
 * Hook/Flow 接线接真，full-harness.ts 此前完全没有做这一步）。
 */
export function wireHooksIntoRegistry(opts: WireHooksOpts): WiredHooks {
  const ruleProvider = new RuleProvider();
  if (opts.defLookup) {
    ruleProvider.setDynamicResolver((ctx) => {
      const rules = new Map<string, RuleDef>();
      const draft = ctx.tx.getDraft();
      const phase = draft.world.turn.phaseEnteredAt;
      const attachments = Object.values(draft.world.attachments)
        .sort((left, right) => left.id.localeCompare(right.id));
      for (const attachment of attachments) {
        // 需求30.8：activeAt 未到的 Attachment 整体视为未生效，其规则不得挂载。这一条必须在
        // 收集候选集合时就过滤掉，而不是留给 RuleDef.when 自己判断——否则"延时生效"就退化成
        // 每条规则作者都要记得自查的约定，漏写一处就等于延时失效。
        if (attachment.activeAt !== undefined && attachment.activeAt > phase) continue;
        const attachmentDef = opts.defLookup?.(attachment.def);
        for (const ruleId of attachmentDef?.rules ?? []) {
          const rule = opts.defLookup?.(ruleId);
          if (rule?.kind === 'rule') rules.set(rule.id, rule as RuleDef);
        }
      }
      return [...rules.values()];
    });
  }

  // 打破循环依赖（OpRegistry 需要 HookDispatcher 提供 dispatchBefore/After，HookDispatcher
  // 需要 FlowInterpreter 提供 runEffects，FlowInterpreter 需要 OpRegistry 作为 .opRegistry
  // 依赖）：用一个可变占位对象承载 FlowInterpreterDeps，OpRegistry 构造完成后再回填其
  // opRegistry 字段——FlowInterpreter 只在真正执行某条 Effect 时才读取 this.deps.opRegistry，
  // 那时占位已经被回填，不会读到未初始化的值。
  const flowDeps: FlowInterpreterDeps = {
    opRegistry: null as unknown as OpRegistry,
    ...opts.flowDeps,
  };
  const flowInterpreter = new FlowInterpreter(flowDeps);

  const runEffects: EffectRunner = (effects, ctx, vars) => {
    const result = flowInterpreter.run(effects, ctx, opts.flowBudget, vars);
    return { result: result.result, vars: result.vars };
  };

  const hookDispatcher = new HookDispatcher({
    runEffects,
    evalWhen: (expression, ctx, vars) => expression === undefined ? true : flowInterpreter.evaluate(expression, ctx, vars),
    onDiagnostic: opts.onDiagnostic,
  }, opts.maxHookDepth);

  // 保留宿主自定义 emit 回调；规则分发统一由 OpContext.emit -> dispatchEmit 完成，
  // 避免 Flow emit 与 Op 内部 emit 走两条链或发生双重分发。
  const upstreamOnEmit = flowDeps.onEmit;
  flowDeps.onEmit = (type, payload, ctx) => {
    upstreamOnEmit?.(type, payload, ctx);
  };

  const dispatchEmit = (type: string, payload: Record<string, Value>, ctx: OpContext): void => {
    const candidates = ruleProvider.candidatesFor(type, ctx);
    if (candidates.length > 0) hookDispatcher.dispatch(type, payload, candidates, ctx);
  };

  const dispatchBefore = (opName: string, args: unknown, ctx: OpContext) => {
    const candidates = ruleProvider.candidatesFor(`before:${opName}`, ctx);
    if (candidates.length === 0) return { cancelled: false };
    const result = hookDispatcher.dispatch(`before:${opName}`, argsToPayload(args), candidates, ctx);
    return { cancelled: result.cancelled, reason: result.reason };
  };

  // 内置光环重算触发器（需求30.2/30.5）：拓扑变化与附着变化的 after 阶段无条件重算光环，
  // 与触发它的 Op 共享同一事务（写在 ctx.tx.draft 上）。重算经 setPath 写 aura.* prop 而非走 Op，
  // 因此不会重新触发 after 分发，天然无环。defLookup 缺省（不接 Def 解析）时不启用，退回旧行为。
  const auraEngine = opts.defLookup ? new AuraEngine({ defLookup: opts.defLookup as (id: string) => Def | null }) : null;
  const AURA_TRIGGER_OPS = new Set([
    'entity.place', 'node.merge', 'node.split', 'attach.add', 'attach.del', 'attach.expire',
  ]);

  const dispatchAfter = (opName: string, args: unknown, ctx: OpContext): void => {
    const candidates = ruleProvider.candidatesFor(`after:${opName}`, ctx);
    if (candidates.length > 0) {
      hookDispatcher.dispatch(`after:${opName}`, argsToPayload(args), candidates, ctx);
    }
    if (auraEngine && AURA_TRIGGER_OPS.has(opName)) {
      const { state } = auraEngine.recomputeAll(ctx.tx.getDraft());
      ctx.tx.setDraft(state);
    }
  };

  const wiredRegistry = new WiredOpRegistry(
    opts.holder,
    { dispatchBefore, dispatchAfter, dispatchEmit },
    () => hookDispatcher.resetDepth(),
  );
  flowDeps.opRegistry = wiredRegistry;

  return { registry: wiredRegistry, ruleProvider, hookDispatcher, flowInterpreter };
}

function argsToPayload(args: unknown): Record<string, Value> {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, Value>;
  }
  return {};
}
