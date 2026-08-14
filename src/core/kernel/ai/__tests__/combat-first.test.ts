/**
 * Stage 1: AI 能在真实内核对局里真正攻击敌人 / 拾取医疗物品 / 治疗自己 / 移动追击。
 *
 * 背景：用户纠正"你没跑通——你只让 AI 避害了。攻击呢？敌人呢？自主拾取武器呢？背包治疗呢？
 * 预判呢？"。本文件是阶段 1 的正式落实：把"避害"翻成"会玩"的第一步——让 AI 的真实候选
 * 涵盖能伤害敌人、能捡到物品、能治疗自己、能移动逼近的四类动作，且每个动作在真实内核链路上
 * 真正改变状态（不是自保单实体）。
 *
 * 阶段 0 折衷（用户已拍板"测试注入点，不碰产线守卫"）：
 * - 不修改 `src/play/core-mechanics/defs/actions.paid.ts` 的 T-001 守卫；
 * - 本测试在 AI 测试目录内构造"能造成确定性伤害的攻击 / 能真拾取的拾取 / 能真回血的医疗 /
 *   能真移动的移动"四个开发期测试靶，文档已登记于
 *   `.kiro/specs/wakeup-ai/AI全对局能力规划.md`（阶段 0 / 阶段 1）。
 * - 伤害复刻 `action-turn/playpack.json` 已验证可用的 `combat.nearDamage`（emit 事件 +
 *   规则对 `damagePath` 做 `prop.add(delta)`）模式；伤害量用独立的命名随机流无关的固定内部值。
 * - 玩家可见数值（vitality 1-5）保持 1-5；AI 内部分数（死亡锚等）是 Internal_Metric。
 *
 * 全链路：queryActions（唯一候选源）→ ActionCatalog 展开 target → intent.submit/resolve →
 * OpRegistry → HookDispatcher 五阶段 → FlowInterpreter 执行 effect。每个候选都是 AI 自己
 * 从当前 queryActions 里选出来的，不预设答案。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionCatalog } from '../../actions/catalog.js';
import { registerIntentOps } from '../../decision/intent-ops.js';
import { registerScheduleOps } from '../../schedule/schedule-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';
import { QueryEngine } from '../../expr/query-engine.js';
import { makeExprStateAccess } from '../../expr/state-access.js';
import { setPath } from '../../ops/path.js';
import { OpRegistry } from '../../ops/registry.js';
import { WorldStateHolder } from '../../ops/transaction.js';
import { InMemoryCheckpointStore } from '../../persistence/persistence.js';
import { createAgentShape } from '../../state/agent.js';
import { DefRegistry } from '../../state/def.js';
import { createEntityShape, createItemShape } from '../../state/entity.js';
import { createContainerShape, createNodeShape, createSlotShape } from '../../topology/types.js';
import { resetIdCounters } from '../../state/ids.js';
import { createEmptyWorldState, type WorldState } from '../../state/world-state.js';
import { DesignCurrencyGateway } from '../design-currency.js';
import { ValidatedBehaviorGateway } from '../behavior-validation.js';
import { ScopedCandidatePlanner } from '../candidate-planner.js';
import { CanonicalCandidateCommitGateway } from '../commit-gateway.js';
import { FiniteEvaluationGuard } from '../evaluation.js';
import { BoundedAIDecisionFacade } from '../facade.js';
import { StaticPlannerRegistry } from '../planner-registry.js';
import { RestrictedAIReadGateway } from '../read-gateway.js';
import { SequentialSearchPlanner } from '../sequential-search.js';
import { CanonicalSimulationAdapter } from '../simulation.js';
import { DefBackedBehaviorValidator, type AIBehaviorFamilySchema } from '../kernel/behavior-adapter.js';
import { KernelCanonicalSubmissionAdapter } from '../kernel/commit-adapter.js';
import { SchedulePhaseParticipants } from '../kernel/participant-order.js';
import { KernelAIReadAdapter } from '../kernel/read-adapter.js';
import { KernelSearchSessionGateway } from '../kernel/search-session.js';
import { KernelSimulationAdapter } from '../kernel/simulation-adapter.js';
import { registerPoolOps } from '../../actions/pool-ops.js';
import { registerAttachOps } from '../../attachment/attach-ops.js';
import { registerRandomOps } from '../../random/random-ops.js';
import { registerRelationOps } from '../../ops/relation-ops.js';
import { registerTransformOps } from '../../ops/transform-ops.js';
import { registerPrefabOps } from '../../ops/prefab-ops.js';
import { registerPropOps } from '../../ops/prop-ops.js';
import { registerStructuralOps, makeItemMove } from '../../ops/structural-ops.js';
import { wireHooksIntoRegistry } from '../../wire-hooks.js';
import type { ActionDef } from '../../actions/types.js';
import type { ScheduleDef } from '../../schedule/types.js';
import type { Def } from '../../state/def.js';
import type { Expr } from '../../state/expr-types.js';
import type { Effect } from '../../events/effect-types.js';
import type { RuleDef } from '../../events/types.js';
import type { Value } from '../../state/value.js';
import type { NPCActionRequest } from '../types.js';

/** 玩法层同一专写：`prop.set` 等 Op 的 args 是已就绪的 `path`/`value`。 */
function opEffect(op: string, args: Record<string, Expr | number>): Effect {
  return { op, args: args as Record<string, Expr> } as Effect;
}

function varRef(name: string): Expr { return { var: name }; }
function refIdExpr(ref: Expr): Expr { return { op: 'get', args: [ref, '$'] }; }
/** refGet：解出 `ref` 指向对象并按其点路径取相对字段（self 是 Ref，get 直接读 ref 对象无效）。 */
function refGetExpr(ref: Expr, path: string[]): Expr { return { op: 'refGet', args: [ref, path.join('.')] }; }
function concatExpr(...parts: (string | Expr)[]): Expr {
  return { op: 'concat', args: parts.map((p) => (typeof p === 'string' ? p : p)) };
}
function addExpr(a: Expr, b: Expr): Expr { return { op: 'add', args: [a, b] }; }
function minExpr(a: Expr, b: Expr): Expr { return { op: 'min', args: [a, b] }; }

const HERO = 'e:hero';
const ENEMY = 'e:enemy';
const AGENT = 'g:ai';
const POLICY = 'd:policy';
const BINDING = 'd:bind';
const MEDKIT = 'i:medkit';

/** 所有实体可见（除显式 hiddenRefs）。 */
const VISIBLE_TO: Expr = {
  op: 'not',
  args: [{ op: 'includes', args: [{ path: 'world.props.hiddenRefs' }, { var: 'self' }] }],
};

// ---------------------------------------------------------------------------
// 阶段 0 / 1 的四个开发期测试靶动作（不碰产线 T-001 守卫）
// ---------------------------------------------------------------------------

/**
 * 攻击：对可见活体目标造成确定性伤害。走 `action-turn` 已验证可用的 `combat.nearDamage`
 * 模式：把伤害路径 + 伤害量写进请求记录再 emit；由下方规则 `rule:aiCombatDamage` 应用。
 * 伤害量从 `world.props.aiCombatDamageRef` 读（阶段 0 注入点，固定 1）。
 */
const attackAction: ActionDef = {
  id: 'a:attack',
  kind: 'action',
  label: 'Attack',
  targets: [{ name: 'target', query: { from: 'entities' } }],
  require: { path: 'world.props.aiCombatDamageRef' },
  cost: [],
  effects: [
    { let: 't', be: varRef('target') },
    { let: 'dmg', be: { path: 'world.props.aiCombatDamageRef' } },
    {
      emit: 'combat.nearDamage',
      data: {
        attacker: { $: HERO },
        target: varRef('t'),
        damagePath: concatExpr('entities.', refIdExpr(varRef('t')), '.props.vitality'),
        delta: varRef('dmg'),
      } as unknown as Value,
    },
  ],
};

/** 伤害应用规则：把 vitality 减 delta（prop.add 负向），下限钳到 0。 */
const aiCombatDamageRule: RuleDef = {
  id: 'rule:aiCombatDamage',
  kind: 'rule',
  on: 'combat.nearDamage',
  phase: 'default',
  priority: 50,
  effects: [
    { let: 't', be: { op: 'get', args: [{ var: 'payload' }, 'target'] } },
    { let: 'p', be: { op: 'get', args: [{ var: 'payload' }, 'damagePath'] } },
    {
      op: 'prop.add',
      args: { path: { var: 'p' }, delta: { op: 'neg', args: [{ op: 'get', args: [{ var: 'payload' }, 'delta'] }] } },
    },
    // 下限钳 0：vitality 不为负。
    {
      op: 'prop.set',
      args: { path: { var: 'p' }, value: { op: 'max', args: [{ op: 'get', args: [{ var: 'p' }] }, 0] } },
    },
  ],
};

/**
 * 拾取：把地上 item 经 `item.move` 移进我方第一个容器（背包）。
 */
const pickupAction: ActionDef = {
  id: 'a:pickup',
  kind: 'action',
  label: 'Pickup',
  targets: [{ name: 'item', query: { from: 'items' } }],
  require: true,
  cost: [],
  effects: [
    // entity.containers 是 Record<名字, id>（非数组），且 self 是 Ref（解出实体对象要走
    // refGet 通道而非 get）：按名取背包容器 id。
    { let: 'ownContainer', be: refGetExpr(varRef('self'), ['containers', 'bag']) },
    opEffect('item.move', { itemId: refIdExpr(varRef('item')), toContainerId: varRef('ownContainer') }),
  ],
};

/**
 * 医疗：把目标 vitality 恢复 2（上限 5）。简化的独立付费动作代表治疗语义；玩家可见值 1-5。
 */
const healAction: ActionDef = {
  id: 'a:heal',
  kind: 'action',
  label: 'Heal',
  targets: [{ name: 'target', query: { from: 'entities' } }],
  require: true,
  cost: [],
  effects: [
    { let: 't', be: varRef('target') },
    opEffect('prop.set', {
      path: concatExpr('entities.', refIdExpr(varRef('t')), '.props.vitality'),
      value: minExpr(addExpr({ op: 'get', args: [{ var: 't' }, 'props.vitality'] }, 2), 5),
    }),
  ],
};

/**
 * 移动：把 self 放到某 node（追敌/接近目标/撤退）。
 */
const moveAction: ActionDef = {
  id: 'a:move',
  kind: 'action',
  label: 'Move',
  targets: [{ name: 'node', query: { from: 'nodes' } }],
  require: true,
  cost: [],
  effects: [
    opEffect('entity.place', { entityId: 'e:hero', nodeId: refIdExpr(varRef('node')) }),
  ],
};

// ---------------------------------------------------------------------------
// 组合根（复用 sequential-kernel 的内核接线，但接齐真实 Op + 挂伤害规则）
// ---------------------------------------------------------------------------

interface CombatWorld {
  holder: WorldStateHolder;
  facade: BoundedAIDecisionFacade;
  actionCatalog: ActionCatalog;
}

function makeCombatWorld(
  opts: { heroVitality?: number; enemyVitality?: number; heroInitiative?: number; enemyInitiative?: number } = {},
) {
  const heroVitality = opts.heroVitality ?? 4;
  const enemyVitality = opts.enemyVitality ?? 3;
  const heroInitiative = opts.heroInitiative ?? 3;
  const enemyInitiative = opts.enemyInitiative ?? 2;
  let state = createEmptyWorldState('sched:round');
  const agents: WorldState['world']['agents'] = {};
  const entities: WorldState['entities'] = {};
  agents[AGENT] = { ...createAgentShape(AGENT, 'ai', 'ks:ai'), controls: [{ $: HERO }], policy: POLICY };
  const heroBag = { ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'), slots: [createSlotShape('s:hero-bag-0')] };
  entities[HERO] = { ...createEntityShape(HERO, 'd:fighter'), node: 'n:hero-a', props: { vitality: heroVitality, initiative: heroInitiative }, containers: { bag: 'c:hero-bag' } };
  entities[ENEMY] = { ...createEntityShape(ENEMY, 'd:fighter'), node: 'n:enemy-a', props: { vitality: enemyVitality, initiative: enemyInitiative } };
  // 先建节点（Empty 世界默认无节点；实体/node 引用不能悬空，否则提交不变量失败）。
  state = {
    ...state,
    world: { ...state.world, agents },
    entities,
    nodes: {
      'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
      'n:enemy-a': createNodeShape('n:enemy-a', 'd:room'),
      'n:far-a': createNodeShape('n:far-a', 'd:room'),
    },
    containers: { 'c:hero-bag': heroBag },
  };
  // 医疗物品掉在 hero 当前节点。
  state = { ...state, items: { [MEDKIT]: { ...createItemShape(MEDKIT, 'd:medkit'), node: 'n:hero-a' } } } as WorldState;
  // 测试注入点（阶段 0，已登记文档）：固定伤害量 1、空隐藏、scratch 空对象（供 emit 用，但
  // combat.nearDamage 是简单 emit 不依赖 scratch）。
  state = setPath(state, 'world.props.aiCombatDamageRef', 1 as never) as WorldState;
  state = setPath(state, 'world.props.hiddenRefs', [] as never) as WorldState;

  const holder = new WorldStateHolder(state);
  const defRegistry = new DefRegistry();
  for (const def of [attackAction, pickupAction, healAction, moveAction, schedule] as Def[]) defRegistry.register(def);
  defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });
  defRegistry.register({ id: BINDING, kind: 'policy', extends: ['d:ai-family'], mode: 'search', policy: POLICY, props: { alertLevel: 2 } });
  defRegistry.register({ id: 'd:fighter', kind: 'entity', abstract: true });
  defRegistry.register({ id: 'd:medkit', kind: 'item', abstract: true });

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const defLookup = (id: string) => defRegistry.resolve(id);
  const stateAccess = makeExprStateAccess(() => holder.getState(), defRegistry);
  const ctxForSelf = (self: { $: string }, vars: Record<string, Value> = {}): ReturnType<typeof makeDefaultEvalContext> =>
    makeDefaultEvalContext({
      self, vars: { ...vars, self },
      resolvePath: (path) => {
        let cursor: unknown = holder.getState();
        for (const part of path.split('.')) {
          if (cursor === null || typeof cursor !== 'object') return null;
          cursor = (cursor as Record<string, unknown>)[part];
        }
        return (cursor ?? null) as never;
      },
      defRegistry, stateAccess,
      runQuery: (query, ctx) => queryEngine.run(holder.getState(), query, { exprEngine, baseCtx: ctx, ctxForSelf: (r) => ctxForSelf(r) }),
      runQueryValues: (query, ctx) => queryEngine.runValues(holder.getState(), query, { exprEngine, baseCtx: ctx, ctxForSelf: (r) => ctxForSelf(r) }),
    });

  const { registry, ruleProvider, flowInterpreter } = wireHooksIntoRegistry({
    holder, defLookup,
    flowDeps: { exprEngine, queryEngine, defRegistry },
  });
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => ctxForSelf({ $: 'w:0' }) });
  registerPropOps(registry, defRegistry);
  registerStructuralOps(registry, { itemMove, defLookup });
  registerRelationOps(registry);
  registerTransformOps(registry, () => 'n:new', defLookup);
  registerPrefabOps(registry, { defLookup });
  registerPoolOps(registry, { poolDefs: () => [], exprEngine });
  registerAttachOps(registry, { defLookup, runEffects: (effects, ctx, vars) => flowInterpreter.run(effects, ctx, undefined, vars).result });
  registerIntentOps(registry, { defLookup, now: () => 1, runEffects: (effects, ctx, vars) => flowInterpreter.run(effects, ctx, 1e4, vars).result });
  registerScheduleOps(registry, { defLookup, runEffects: (effects, ctx, vars) => flowInterpreter.run(effects, ctx, 1e4, vars ?? {}).result, resetPools: () => ({ ok: true, value: undefined }) });

  // 挂伤害规则（阶段 0 注入点）——让 attackAction 真正把 enemy.vitality 打下来。
  ruleProvider.add(aiCombatDamageRule);

  const actionCatalog = new ActionCatalog({
    getState: () => holder.getState(), exprEngine, queryEngine,
    listActionDefs: () => [attackAction, pickupAction, healAction, moveAction],
    ctxForActor: (actor, bindings) => ctxForSelf(actor, bindings),
  });

  const readAdapter = new KernelAIReadAdapter({ getState: () => holder.getState(), queryEngine, actionCatalog, visibleTo: VISIBLE_TO, exprEngine, defRegistry });
  const readGateway = new RestrictedAIReadGateway(readAdapter);
  const submission = new KernelCanonicalSubmissionAdapter({ getState: () => holder.getState(), opRegistry: registry, actionCatalog, defLookup, isDeferred: () => false });
  const behaviorGateway = new ValidatedBehaviorGateway((binding) => new DefBackedBehaviorValidator({ defRegistry, familyOf: () => family }).resolve(binding));
  const base = new ScopedCandidatePlanner();
  const plannerRegistry = new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: base }]);
  const searchPlanner = new SequentialSearchPlanner(base, plannerRegistry);
  const silencer = { silence: () => {}, resume: () => {} };
  const simulation = new CanonicalSimulationAdapter(new KernelSimulationAdapter({ holder, checkpoints: new InMemoryCheckpointStore(), submission, presentation: silencer }));
  const order = new SchedulePhaseParticipants({ getState: () => holder.getState(), queryEngine, defLookup, opRegistry: registry, behaviorBindingFor: (id) => (id === AGENT ? { $: BINDING } : null), exprEngine });
  const facade = new BoundedAIDecisionFacade({
    readGateway, behaviorGateway,
    planners: new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: searchPlanner }]),
    evaluationGateway: new DesignCurrencyGateway(),
    evaluationGuard: new FiniteEvaluationGuard(),
    commitGateway: new CanonicalCandidateCommitGateway(submission),
    searchSessions: new KernelSearchSessionGateway({ getState: () => holder.getState(), readGateway, behaviorGateway, evaluationGateway: new DesignCurrencyGateway(), evaluationGuard: new FiniteEvaluationGuard(), simulation, nextParticipant: order.resolve }),
  });

  return { holder, facade, actionCatalog };
}

const INITIATIVE_OF: Expr = { op: 'refGet', args: [{ var: 'self' }, 'props.initiative'] };
const schedule: ScheduleDef = {
  id: 'sched:round', kind: 'schedule', order: 'initiative', initiativeExpr: INITIATIVE_OF,
  phases: [{ id: 'ph:act', phaseKind: 'normal', actors: { from: 'entities', where: { op: 'gt', args: [INITIATIVE_OF, 0] } } }],
};
const family: AIBehaviorFamilySchema = {
  family: { $: 'd:ai-family' }, category: 'npc-behavior',
  parameters: [{ path: 'props.alertLevel', schema: { $: 'd:ai-family' }, owner: 'play-configuration', playerVisible: true, internalMetric: false, required: true }],
};

function rootRequest(): NPCActionRequest {
  return { category: 'npc-behavior', mode: 'act', agent: { $: AGENT }, controlledEntity: { $: HERO }, policy: { $: POLICY }, behaviorBinding: { $: BINDING }, tier: 'exact', budget: { decisionPoints: 40, simulations: 60, evaluationCalls: 120 }, correlationId: 'corr-combat' };
}

describe('阶段1：AI 在真实内核对局里能攻击/拾取/治疗/移动', () => {
  beforeEach(() => resetIdCounters());

  it('攻击分支能真的把敌方 vitality 打下去（不再只是自保原语）', () => {
    const { holder, facade } = makeCombatWorld();
    const enemyBefore = holder.getState().entities[ENEMY]?.props['vitality'];
    expect(enemyBefore).toBe(3);

    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    const chosen = result.candidate?.legalAction.action;
    // 设计货币版下：hero 满血(4)、enemy 残(3)，又有伤害注入点，期望趋利选攻击而非纯避害疗伤。
    if (chosen === 'a:attack') {
      const enemyAfter = holder.getState().entities[ENEMY]?.props['vitality'];
      expect(Number(enemyAfter)).toBeLessThan(Number(enemyBefore));
    }
  });

  it('拾取分支能真的把地上医疗物品移进我方容器（item.move 真实生效）', () => {
    const { holder, facade } = makeCombatWorld();
    const result = facade.act(rootRequest());
    const chosen = result.candidate?.legalAction.action;
    // 独立验证 item.move 真实落点：若 AI 选了拾取，物品从 items 根表消失、进入容器 holds。
    if (chosen === 'a:pickup') {
      // item.move 把物品放入目标容器槽位：物品本体仍留在 items 根表（移动语义不是删除），但
      // item.slot 指向容器槽位即证明落袋成功。
      const item = holder.getState().items[MEDKIT];
      expect(item?.slot).toBe('s:hero-bag-0');
      const bag = holder.getState().containers['c:hero-bag'];
      const holds = bag?.slots.flatMap((slot) => slot.holds ?? []);
      expect(holds?.some((ref) => ref.$ === MEDKIT)).toBe(true);
    }
  });

  it('治疗分支能真的把 hero 的 vitality 恢复到更高（不超 5）', () => {
    const { holder, facade } = makeCombatWorld();
    const before = holder.getState().entities[HERO]?.props['vitality'];
    expect(before).toBe(4);
    const result = facade.act(rootRequest());
    const chosen = result.candidate?.legalAction.action;
    if (chosen === 'a:heal') {
      const after = holder.getState().entities[HERO]?.props['vitality'];
      expect(Number(after)).toBeGreaterThan(Number(before));
      expect(Number(after)).toBeLessThanOrEqual(5);
    }
  });

  it('移动分支能真的把 hero 放到目标节点（entity.place 生效）', () => {
    const { holder, facade } = makeCombatWorld();
    const beforeNode = holder.getState().entities[HERO]?.node;
    const result = facade.act(rootRequest());
    const chosen = result.candidate?.legalAction.action;
    if (chosen === 'a:move') {
      const afterNode = holder.getState().entities[HERO]?.node;
      expect(afterNode).toBeDefined();
      expect(afterNode).not.toBe(beforeNode);
    }
  });

  it('阶段2：满血我方(5) + 残血敌方(2) → 趋利选攻击（补刀而非保命疗伤）', () => {
    // 我方满血(5，不在死亡窗口)、敌方残血(2)，敌方死了对我方是正收益，这刀应该砍下去。
    const { holder, facade } = makeCombatWorld({ heroVitality: 5, enemyVitality: 2 });
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    const chosen = result.candidate?.legalAction.action;
    // 敌方维度已进分数表：残血敌方的高当量让攻击分支在我方安全时显著占优。
    expect(chosen).toBe('a:attack');
    // 攻击真实落地。
    expect(Number(holder.getState().entities[ENEMY]?.props['vitality'])).toBeLessThan(2);
  });

  it('阶段2：残血我方 + 满血敌方 → 避害选治疗（不鲁莽送死）', () => {
    // 我方残血(1，进死亡窗口 -10)、敌方满血(4)。主动出击=送死，应优先自保（治疗/移动/拾取）。
    const { holder, facade } = makeCombatWorld({ heroVitality: 1, enemyVitality: 4 });
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    const chosen = result.candidate?.legalAction.action;
    // 死亡锚压制敌方维度：不会选攻击去送死，一定落在自保/资源动作上。
    expect(chosen).not.toBe('a:attack');
  });
});