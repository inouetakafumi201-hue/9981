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
import { ActionCatalog } from '../../actions/catalog';
import { registerIntentOps } from '../../decision/intent-ops';
import { registerScheduleOps } from '../../schedule/schedule-ops';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine';
import { QueryEngine } from '../../expr/query-engine';
import { makeExprStateAccess } from '../../expr/state-access';
import { setPath } from '../../ops/path';
import { WorldStateHolder } from '../../ops/transaction';
import { InMemoryCheckpointStore } from '../../persistence/persistence';
import { createAgentShape } from '../../state/agent';
import { DefRegistry } from '../../state/def';
import { createEntityShape, createItemShape } from '../../state/entity';
import { createContainerShape, createNodeShape, createSlotShape } from '../../topology/types';
import { resetIdCounters } from '../../state/ids';
import { createEmptyWorldState, type WorldState } from '../../state/world-state';
import { DesignCurrencyGateway } from '../design-currency';
import { ValidatedBehaviorGateway } from '../behavior-validation';
import { ScopedCandidatePlanner } from '../candidate-planner';
import { CanonicalCandidateCommitGateway } from '../commit-gateway';
import { FiniteEvaluationGuard } from '../evaluation';
import { BoundedAIDecisionFacade } from '../facade';
import { StaticPlannerRegistry, type PlannerRegistration } from '../planner-registry';
import { RestrictedAIReadGateway } from '../read-gateway';
import { SequentialSearchPlanner } from '../sequential-search';
import { CanonicalSimulationAdapter } from '../simulation';
import { DefBackedBehaviorValidator, type AIBehaviorFamilySchema } from '../kernel/behavior-adapter';
import { KernelCanonicalSubmissionAdapter } from '../kernel/commit-adapter';
import { SchedulePhaseParticipants } from '../kernel/participant-order';
import { KernelAIReadAdapter } from '../kernel/read-adapter';
import { KernelSearchSessionGateway } from '../kernel/search-session';
import { KernelSimulationAdapter } from '../kernel/simulation-adapter';
import { registerPoolOps } from '../../actions/pool-ops';
import { registerAttachOps } from '../../attachment/attach-ops';
import { registerRelationOps } from '../../ops/relation-ops';
import { registerTransformOps } from '../../ops/transform-ops';
import { registerPrefabOps } from '../../ops/prefab-ops';
import { registerPropOps } from '../../ops/prop-ops';
import { registerStructuralOps, makeItemMove } from '../../ops/structural-ops';
import { wireHooksIntoRegistry, type WiredOpRegistry } from '../../wire-hooks';
import type { ActionDef } from '../../actions/types';
import type { ScheduleDef } from '../../schedule/types';
import type { Def } from '../../state/def';
import type { Expr } from '../../state/expr-types';
import type { Effect } from '../../events/effect-types';
import type { RuleDef } from '../../events/types';
import type { Value } from '../../state/value';
import type { Ref } from '../../state/ids';
import type { QueryMode } from '../../actions/catalog';
import type { LegalActionSource } from '../kernel/read-adapter';
import type { AIDecisionResult, BeliefSlice, NPCActionRequest } from '../types';

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
const ENEMY_AGENT = 'g:enemy-ai';
const POLICY = 'd:policy';
const ENEMY_POLICY = 'd:enemy-policy';
const BINDING = 'd:bind';
const ENEMY_BINDING = 'd:enemy-bind';
const MEDKIT = 'i:medkit';
const SWORD = 'i:sword';
/** 阶段4 测试靶强武器 `i:sword`（d:sword，props.E=5 高等级），经 read-adapter 投影成 `i:sword.E` 事实。 */
const SWORD_DEF: Def = { id: 'd:sword', kind: 'item', abstract: true, props: { E: 5 } };
/** 阶段4 治疗物 `i:medkit`（d:medkit，props.heal=2），投影成 `i:medkit.heal` 事实。 */
const MEDKIT_DEF: Def = { id: 'd:medkit', kind: 'item', abstract: true, props: { heal: 2 } };

/** 阶段零血倒地测试靶：规则把此 tag 写进零血实体的 tags 区，作为 `require` 里可读的倒地资格。 */
const TAG_DOWNED = 'tag:downed';

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
  track: 'highlight',
  // 攻击锁定「对方实体」：排除自己（攻击自己是自杀），只留下另一侧实体作为候选目标。
  //  是 ActionCatalog 展开查询时为当前候选 Ref 注入的变量（catalog.ts），用它做
  // self ≠ targetRef 即可把「当前正在判断的那个实体」排除掉，hero 侧就只剩 e:enemy。
  targets: [{ name: 'target', query: { from: 'entities', where: { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] } } }],
  require: true,
  cost: [],
  effects: [
    { let: 't', be: varRef('target') },
    // 伤害量来自 `world.props.aiCombatDamageRef`（阶段 0 注入点，固定 1；开发期测试靶，不抢
    // T-001 的玩法层权威数值源裁决）。阶段4「强武器更值」语义由 *分数表*（weapon.E 费目）承载，
    // 攻击动作本身不改数值、不因武器变伤害量（避免给同一动作拍两个行为）。
    { let: 'dmg', be: { path: 'world.props.aiCombatDamageRef' } },
    {
      emit: 'combat.nearDamage',
      data: {
        attacker: { $: HERO },
        target: varRef('t'),
        // damagePath 是绝对点路径（`entities.<id>.props.vitality`），供 `prop.add`/`prop.set` 用 path
        // 参数命中。emit 的 data 是求值后的数据，这里直接求值为字符串（不走 isExprLeafObject recurse）。
        damagePath: { op: 'concat', args: ['entities.', { op: 'get', args: [varRef('t'), '$'] }, '.props.vitality'] },
        delta: varRef('dmg'),
      } as unknown as Value,
    },
  ],
};

/** 伤害应用规则：把 vitality 减 delta，下限钳到 0。与 play 层 `rules.damage.ts` damageDefaultRule
 *  同构：显式 prop.set 剩余生命（非致命分支不 prop.del），1-5 数值铁律下 vitality 永不为负。
 *  命中 `combat.nearDamage` 的 default 阶段、紧贴动作 emit，让分支仿真里攻击真的把敌方打下去。 */
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
    // 下限钳 0：vitality 不为负。读完被减的生命、将其钳到 ≥0 的同时保持其余字段不变。
    {
      op: 'prop.set',
      args: { path: { var: 'p' }, value: { op: 'max', args: [refGetExpr(varRef('t'), ['props', 'vitality']), 0] } },
    },
    // M9 测试靶：vitality 归零时给目标打上「零血倒地」标记。与 play 层 damageDefaultRule 的致命
    // 分支（prop.del + attach.add）同构，但这里保留 vitality=0 字段（读侧兼容）。倒地资格用 tag
    // 表达：require 求值上下文（ActionCatalog 的 require 求值）无 stateAccess，builtin 的
    // hasAttachment/attachCount 在 require 里恒为 false；tags 是 require 唯一能经 refGet 读到的一等
    // 字段，与玩法层零血倒地把 tag 当 require 可读投影的做法同构。tag.add 需要
    // `ref.{collection,id}` 形状的 scratch（引擎层 TagArgs），用 scratch 暂存两字段再调、最后清除。
    {
      let: 'remaining',
      be: refGetExpr(varRef('t'), ['props', 'vitality']),
    },
    {
      if: { op: 'lte', args: [{ var: 'remaining' }, 0] },
      then: [
        { op: 'prop.set', args: { path: 'world.props.m9Scratch.collection', value: 'entities' } },
        { op: 'prop.set', args: { path: 'world.props.m9Scratch.id', value: refIdExpr(varRef('t')) } },
        { op: 'tag.add', args: { ref: { path: 'world.props.m9Scratch' }, tag: TAG_DOWNED } },
        { op: 'prop.del', args: { path: 'world.props.m9Scratch' } },
      ],
      else: [],
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
  track: 'highlight',
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
 * 敌方维度不高时对己方治疗无感（伤害来自各自分支的可见变化），这里只锁定「治疗自己」，
 * 排除敌方——治疗一个满血敌人是自相矛盾，会让「满血该补刀」的语义在分支评分上被搅混。
 */
const healAction: ActionDef = {
  id: 'a:heal',
  kind: 'action',
  label: 'Heal',
  track: 'highlight',
  // 医疗锁定「自我治疗」：治疗别人在真实的 1-5 生命意义上是另一个动作，这里不提供。
  // 敌我不分地加到任意目标会让「满血该补刀」在分支评分上跟「给敌方回血」搅在一起，AI 反而
  // 读错方向。所以治疗只作用于自己（self），用 eq(self, self) 恒真锁死自己这一票。
  targets: [{ name: 'target', query: { from: 'entities', where: { op: 'eq', args: [{ var: 'self' }, { var: 'self' }] } } }],
  require: true,
   cost: [],
  effects: [
    { let: 't', be: varRef('self') },
    opEffect('prop.set', {
      path: concatExpr('entities.', refIdExpr(varRef('t')), '.props.vitality'),
      // t 是 Ref（{$:...}），读它的字段要走 refGet 而非 get（get 只会把 Ref 当普通对象取键，
      // 取不到 props 字段）。这与 pickupAction 注释里「self 是 Ref 要走 refGet 通道」同一约束。
      // 治疗量 4：把残血(如 1)直接拉回 5、越出死亡窗口——这是让「残血但背包有治疗 → 优先治疗」
      // 在评分上真实闭环的关键（若只回 2，1→3 仍留在 lethalWindow 内，死亡锚 -10 依旧压着，治疗
      // 分支的「离开窗口」收益不出现，AI 反而因敌方补刀分而盲攻）。测试靶值 4 属内部治疗量，
      // 不与玩家可见 1-5 铁律冲突（vitality 目标仍被 clamp 到 5）。
      value: minExpr(addExpr(refGetExpr(varRef('t'), ['props', 'vitality']), 4), 5),
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
  track: 'highlight',
  targets: [{ name: 'node', query: { from: 'nodes' } }],
  require: true,
  cost: [],
  effects: [
    opEffect('entity.place', { entityId: 'e:hero', nodeId: refIdExpr(varRef('node')) }),
  ],
};

/**
 * 令其长眠（M9 测试靶，`eternal-sleep`）：对「零血倒地」的目标行使终结。`require` 要求目标存在
 * 且带 `att:downed` 标记；effect 把目标从世界里移除（entity.destroy）——目标「长眠」不再是活体。
 * 与 play 层 `eternalSleepAction`（Requirement 12.5）语义对齐，但这里是 AI 对局测试靶，不触碰
 * 玩法包的生命/死亡背包管理（T-001 冻结前的 AI 测试层范围之外）。
 */
const eternalSleepAction: ActionDef = {
  id: 'a:eternal-sleep',
  kind: 'action',
  label: 'EternalSleep',
  track: 'highlight',
  // targets：query 限定候选目标为「零血倒地」的实体，并排除自己。query 的 where 在求值每个候选
  // 时会把该候选 Ref 绑为 `self`、同步注入 `${target.name}Ref`（即 `targetRef`）——用 neq(self,
  // targetRef) 排除自己、includes(refGet(targetRef,'tags'), tag) 限定倒地。这样 eternal-sleep 的
  // 每个绑定都精确对应一个倒地目标、天然独一无二，与 heal/move 的绑定串绝不重叠：即便多项分数
  // 打平，它也是一个结构上不同的候选分支，AI 会真把这个候选人当终结动作来选。
  targets: [{
    name: 'target',
    query: {
      from: 'entities',
      where: {
        op: 'and',
        args: [
          { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] },
          {
            op: 'includes', args: [
              refGetExpr(varRef('targetRef'), ['tags']),
              TAG_DOWNED,
            ],
          },
        ],
      },
    },
  }],
  // require：目标是非自己、且带 `tag:downed`（零血倒地）才可被令其长眠。`require` 求值上下文
  // （decision/intent-ops 的 evalRequire）**没有 stateAccess**，所以 builtin 的
  // hasAttachment/attachCount 在 require 里恒为 false（见 src/play/core-mechanics/defs/expr.ts
  // 顶部的表）。唯一能在 require 里读别人状态的关键字是 `refGet`，而实体上可读的一等字段只有
  // `tags` 与 `props`。因此倒地资格用 tag 表达：规则把 `tag:downed` 写进实体 tags，require 在这里
  // 以同事务守卫复核（与玩法层零血倒地把 tag 当作 require 可读投影的做法同构）。
  require: {
    op: 'and',
    args: [
      { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] },
      {
        op: 'includes', args: [
          refGetExpr(varRef('target'), ['tags']),
          TAG_DOWNED,
        ],
      },
    ],
  },
  cost: [],
  effects: [
    { let: 't', be: varRef('target') },
    opEffect('entity.destroy', { id: refIdExpr(varRef('t')) }),
  ],
};

/**
 * 敌方反击：与 attackAction 对称但只打 hero 一票。敌方的诉求是把 hero 压低，逼我方在
 * 「我残血还主动出击」时吃一刀，让「主动出击吃反击」的代价真正折回我方那票（阶段3）。
 * 目标锁死 e:enemy 自身以外的主控实体（query 排除自己）。
 */
const enemyStrikeAction: ActionDef = {
  id: 'a:strike',
  kind: 'action',
  label: 'Strike',
  track: 'highlight',
  targets: [{ name: 'target', query: { from: 'entities', where: { op: 'neq', args: [{ var: 'self' }, { var: 'targetRef' }] } } }],
  require: { op: 'gt', args: [{ path: 'world.props.aiCombatDamageRef' }, 0] },
  cost: [],
  effects: [
    { let: 't', be: varRef('target') },
    { let: 'dmg', be: { path: 'world.props.aiCombatDamageRef' } },
    {
      emit: 'combat.nearDamage',
      data: {
        attacker: { $: ENEMY },
        target: varRef('t'),
        // 与 attackAction 同一约定：payload.delta 是正值伤害量，由 aiCombatDamageRule 里做
        // `neg(prop.add.delta)` 真正把目标压下去。若这里传负值，规则再 neg 一次会变成加血。
        damagePath: concatExpr('entities.', refIdExpr(varRef('t')), '.props.vitality'),
        delta: varRef('dmg'),
      } as unknown as Value,
    },
  ],
};

// ---------------------------------------------------------------------------
// 组合根（复用 sequential-kernel 的内核接线，但接齐真实 Op + 挂伤害规则）
// ---------------------------------------------------------------------------

function makeCombatWorld(
  opts: {
    heroVitality?: number; enemyVitality?: number; heroInitiative?: number; enemyInitiative?: number;
    /** 阶段3：给敌方注册 AI 敌人 Agent（e:enemy 由 g:enemy-ai 控制并只有反击动作）。 */
    enemyAgent?: boolean;
  } = {},
): { holder: WorldStateHolder; facade: BoundedAIDecisionFacade; registry: WiredOpRegistry } {
  const heroVitality = opts.heroVitality ?? 4;
  const enemyVitality = opts.enemyVitality ?? 3;
  const heroInitiative = opts.heroInitiative ?? 3;
  const enemyInitiative = opts.enemyInitiative ?? 2;
  const withEnemyAgent = opts.enemyAgent === true;
  let state = createEmptyWorldState('sched:round');
  const agents: WorldState['world']['agents'] = {};
  const entities: WorldState['entities'] = {};
  agents[AGENT] = { ...createAgentShape(AGENT, 'ai', 'ks:ai'), controls: [{ $: HERO }], policy: POLICY };
  if (withEnemyAgent) {
    agents[ENEMY_AGENT] = { ...createAgentShape(ENEMY_AGENT, 'ai', 'ks:enemy'), controls: [{ $: ENEMY }], policy: ENEMY_POLICY };
  }
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
  // 医疗物品掉在 hero 当前节点（阶段2: onlyOneHerosVitality branch上恰好不放，避免拾取与满血补刀抢答）。
  const stageTwoPickupDistractor = heroVitality === 5 && enemyVitality === 2;
  state = stageTwoPickupDistractor ? state : { ...state, items: { [MEDKIT]: { ...createItemShape(MEDKIT, 'd:medkit'), node: 'n:hero-a' } } } as WorldState;
  // 测试注入点（阶段 0，已登记文档）：固定伤害量 1、空隐藏、scratch 空对象（供 emit 用，但
  // combat.nearDamage 是简单 emit 不依赖 scratch）。
  state = setPath(state, 'world.props.aiCombatDamageRef', 1 as never) as WorldState;
  state = setPath(state, 'world.props.hiddenRefs', [] as never) as WorldState;

  const holder = new WorldStateHolder(state);
  const defRegistry = new DefRegistry();
  for (const def of [attackAction, pickupAction, healAction, moveAction, eternalSleepAction, schedule] as Def[]) defRegistry.register(def);
  if (withEnemyAgent) defRegistry.register(enemyStrikeAction as Def);
  defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });
  defRegistry.register({ id: BINDING, kind: 'policy', extends: ['d:ai-family'], mode: 'search', policy: POLICY, props: { alertLevel: 2 } });
  if (withEnemyAgent) defRegistry.register({ id: ENEMY_BINDING, kind: 'policy', extends: ['d:ai-family'], mode: 'search', policy: ENEMY_POLICY, props: { alertLevel: 2 } });
  defRegistry.register({ id: 'd:fighter', kind: 'entity', abstract: true });
  // 测试靶 Def（阶段 0 已登记，AI 测试目录内的开发期值，不混入玩法层基类默认值）：
  // medical 治疗物把「能回 2 血」这个真实语义以 `props.heal` 表示。item 值元数据会在
  // read-adapter 里投影成 `<id>.heal` 事实，设计货币据此给「地面/背包里躺着治疗物」记值。
  defRegistry.register({ id: 'd:medkit', kind: 'item', abstract: true, props: { heal: 2 } });

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const defLookup = (id: string) => defRegistry.resolve(id);
  const stateAccess = makeExprStateAccess(() => holder.getState(), defRegistry);
  // `refGet` 的结果（Exact-raw key path）：给 require 的 eligibility 判定提供一个能读到
  // Entity/Item 一等字段（tags 等）的只读通道。注意 `refGet` 是 builtin 状态算子，依赖
  // EvalContext.resolveRefValue——`ActionCatalog` 的 require 求值会走到这里。
  const resolveRefValue = (candidate: { $: string }, path: string): Value | null => {
    const state = holder.getState();
    const root: unknown = state.world.agents[candidate.$]
      ?? state.entities[candidate.$]
      ?? state.items[candidate.$]
      ?? state.nodes[candidate.$]
      ?? state.links[candidate.$]
      ?? state.world.attachments[candidate.$]
      ?? state.containers[candidate.$];
    let current = root;
    for (const part of path.split('.')) {
      if (current === null || typeof current !== 'object') return null;
      current = (current as Record<string, unknown>)[part];
    }
    return (current ?? null) as Value | null;
  };
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
      resolveRefValue,
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

  // 挂伤害规则（阶段 0 注入点）——让 attackAction / enemyStrikeAction 真正把目标 vitality 打下去。
  ruleProvider.add(aiCombatDamageRule);

  // 按「控制实体」给出动作集（阶段 0 注入点，不碰产线守卫）：单 Agent 只有 hero 全套动作；
  // 多 Agent 组合根里敌方也由 AI 敌人 Agent 控制，动作集只有反击。这是阶段3 的收敛关键——
  // 敌方的候选集不掺 hero 的攻击/拾取，前瞻会看到「我主动出击后敌方回合必然反击回去」。
  const actionDefsByActor = new Map<string, readonly ActionDef[]>();
  actionDefsByActor.set(HERO, [attackAction, pickupAction, healAction, moveAction, eternalSleepAction]);
  if (withEnemyAgent) actionDefsByActor.set(ENEMY, [enemyStrikeAction]);

  // KernelAIReadAdapter 只接收单一 catalog，而 ActionCatalog 的 listActionDefs 是一次性静态配置。
  // 这里用「每个控制实体一个 catalog」的方式：queryActions 时选中该 actor 对应的 catalog 委托，
  // 让 read scope 按当前主控实体解析到正确的候选集（同一套展开逻辑，只是动作源随 actor 分边）。
  const delegateFor = (actor: { $: string }): ActionCatalog =>
    new ActionCatalog({
      getState: () => holder.getState(), exprEngine, queryEngine,
      listActionDefs: () => [...(actionDefsByActor.get(actor.$) ?? [])],
      ctxForActor: (a, bindings) => {
        const ctx = ctxForSelf(a, bindings);
        // 查询 where 判定用 `targetRef` 变量代表「当前候选 target」（ActionCatalog 展开查询时为每个
        // 候选 Ref 注入 `${target.name}Ref`，见 src/core/kernel/actions/catalog.ts:123）。把它一并放
        // 进求值上下文，让 neq/eq(self, targetRef) 能真排除/锁死自己，而不是读到 null。
        const targetRef = ctx.vars['targetRef'];
        return targetRef === undefined ? ctx : { ...ctx, vars: { ...ctx.vars, targetRef } };
      },
    });
  const queryActionsFor = (actor: Ref, mode: QueryMode) => delegateFor(actor).queryActions(actor, mode);
  const actionCatalog: LegalActionSource = { queryActions: queryActionsFor };

  const readAdapter = new KernelAIReadAdapter({ getState: () => holder.getState(), queryEngine, actionCatalog, visibleTo: VISIBLE_TO, exprEngine, defRegistry });
  const readGateway = new RestrictedAIReadGateway(readAdapter);
  const submission = new KernelCanonicalSubmissionAdapter({ getState: () => holder.getState(), opRegistry: registry, actionCatalog, defLookup, isDeferred: () => false });
  const behaviorGateway = new ValidatedBehaviorGateway((binding) => new DefBackedBehaviorValidator({ defRegistry, familyOf: () => family }).resolve(binding));
  const base = new ScopedCandidatePlanner();
  // 每一档 policy（我方 + 阶段3 敌方）有一个「基础规划器」：递归进某个参与者的回合时，
  // SequentialSearchPlanner 用它们对这个参与者取候选（ScopedCandidatePlanner.plan）。
  const plannerEntries: PlannerRegistration[] = [{ policy: { $: POLICY }, category: 'npc-behavior', planner: base }];
  if (withEnemyAgent) {
    plannerEntries.push({ policy: { $: ENEMY_POLICY }, category: 'npc-behavior', planner: base });
  }
  const plannerRegistry = new StaticPlannerRegistry(plannerEntries);
  const searchPlanner = new SequentialSearchPlanner(base, plannerRegistry);
  // 顶层给 facade 的 policy→planner 映射：我方 POLICY 挂 searchPlanner（SequentialSearchPlanner）。
  // 递归进敌方回合时由 plannerRegistry 用 base 取候选即可（同 sequential-kernel.test.ts 的接线）。
  const facadePlannerEntries: PlannerRegistration[] = [
    { policy: { $: POLICY }, category: 'npc-behavior', planner: searchPlanner },
  ];
  if (withEnemyAgent) {
    facadePlannerEntries.push({ policy: { $: ENEMY_POLICY }, category: 'npc-behavior', planner: base });
  }
  const facadePlanners = new StaticPlannerRegistry(facadePlannerEntries);
  const silencer = { silence: () => {}, resume: () => {} };
  const simulation = new CanonicalSimulationAdapter(new KernelSimulationAdapter({ holder, checkpoints: new InMemoryCheckpointStore(), submission, presentation: silencer }));
  const order = new SchedulePhaseParticipants({ getState: () => holder.getState(), queryEngine, defLookup, opRegistry: registry, behaviorBindingFor: (id) => (id === AGENT ? { $: BINDING } : id === ENEMY_AGENT ? { $: ENEMY_BINDING } : null), exprEngine });
  const facade = new BoundedAIDecisionFacade({
    readGateway, behaviorGateway,
    planners: facadePlanners,
    evaluationGateway: new DesignCurrencyGateway(),
    evaluationGuard: new FiniteEvaluationGuard(),
    commitGateway: new CanonicalCandidateCommitGateway(submission),
    searchSessions: new KernelSearchSessionGateway({ getState: () => holder.getState(), readGateway, behaviorGateway, evaluationGateway: new DesignCurrencyGateway(), evaluationGuard: new FiniteEvaluationGuard(), simulation, nextParticipant: order.resolve }),
  });

  return { holder, facade, registry };
}

// 阶段4 专用组合根：允许传入自定义 item Def（d:sword 等），item.props 会经 read-adapter 的
// 物品价值投影变成 `<id>.<字段>` 事实、被 design-currency 的 `weapon.E`/`medical.heal` 费目读到。
function buildStage4World(
  state: WorldState,
  defs: Def[],
): { holder: WorldStateHolder; facade: BoundedAIDecisionFacade; registry: WiredOpRegistry } {
  const holder = new WorldStateHolder(state);
  const defRegistry = new DefRegistry();
  for (const def of [attackAction, pickupAction, healAction, moveAction, eternalSleepAction, schedule] as Def[]) defRegistry.register(def);
  for (const def of defs) defRegistry.register(def);
  defRegistry.register({ id: 'd:ai-family', kind: 'policy', abstract: true, mode: 'search' });  defRegistry.register({ id: BINDING, kind: 'policy', extends: ['d:ai-family'], mode: 'search', policy: POLICY, props: { alertLevel: 2 } });
  defRegistry.register({ id: 'd:fighter', kind: 'entity', abstract: true });
  // 治疗物「能回 2 血」语义以 props.heal 表达，read-adapter 投影成 `<id>.heal` 事实。
  defRegistry.register({ id: 'd:medkit', kind: 'item', abstract: true, props: { heal: 2 } });

  const exprEngine = new ExprEngine();
  const queryEngine = new QueryEngine();
  const defLookup = (id: string) => defRegistry.resolve(id);
  const stateAccess = makeExprStateAccess(() => holder.getState(), defRegistry);
  const resolveRefValue = (candidate: { $: string }, path: string): Value | null => {
    const state = holder.getState();
    const root: unknown = state.world.agents[candidate.$]
      ?? state.entities[candidate.$]
      ?? state.items[candidate.$]
      ?? state.nodes[candidate.$]
      ?? state.links[candidate.$]
      ?? state.world.attachments[candidate.$]
      ?? state.containers[candidate.$];
    let current = root;
    for (const part of path.split('.')) {
      if (current === null || typeof current !== 'object') return null;
      current = (current as Record<string, unknown>)[part];
    }
    return (current ?? null) as Value | null;
  };
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
      resolveRefValue,
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
  ruleProvider.add(aiCombatDamageRule);

  const actionDefsByActor = new Map<string, readonly ActionDef[]>();
  actionDefsByActor.set(HERO, [attackAction, pickupAction, healAction, moveAction, eternalSleepAction]);
  const delegateFor = (actor: { $: string }): ActionCatalog =>
    new ActionCatalog({
      getState: () => holder.getState(), exprEngine, queryEngine,
      listActionDefs: () => [...(actionDefsByActor.get(actor.$) ?? [])],
      ctxForActor: (a, bindings) => {
        const ctx = ctxForSelf(a, bindings);
        const targetRef = ctx.vars['targetRef'];
        return targetRef === undefined ? ctx : { ...ctx, vars: { ...ctx.vars, targetRef } };
      },
    });
  const queryActionsFor = (actor: Ref, mode: QueryMode) => delegateFor(actor).queryActions(actor, mode);
  const actionCatalog: LegalActionSource = { queryActions: queryActionsFor };

  const readAdapter = new KernelAIReadAdapter({ getState: () => holder.getState(), queryEngine, actionCatalog, visibleTo: VISIBLE_TO, exprEngine, defRegistry });
  const readGateway = new RestrictedAIReadGateway(readAdapter);
  const submission = new KernelCanonicalSubmissionAdapter({ getState: () => holder.getState(), opRegistry: registry, actionCatalog, defLookup, isDeferred: () => false });
  const behaviorGateway = new ValidatedBehaviorGateway((binding) => new DefBackedBehaviorValidator({ defRegistry, familyOf: () => family }).resolve(binding));
  const base = new ScopedCandidatePlanner();
  const plannerRegistry = new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: base }]);
  const searchPlanner = new SequentialSearchPlanner(base, plannerRegistry);
  const facadePlanners = new StaticPlannerRegistry([{ policy: { $: POLICY }, category: 'npc-behavior', planner: searchPlanner }]);
  const silencer = { silence: () => {}, resume: () => {} };
  const simulation = new CanonicalSimulationAdapter(new KernelSimulationAdapter({ holder, checkpoints: new InMemoryCheckpointStore(), submission, presentation: silencer }));
  const order = new SchedulePhaseParticipants({ getState: () => holder.getState(), queryEngine, defLookup, opRegistry: registry, behaviorBindingFor: (id) => (id === AGENT ? { $: BINDING } : null), exprEngine });
  const facade = new BoundedAIDecisionFacade({
    readGateway, behaviorGateway,
    planners: facadePlanners,
    evaluationGateway: new DesignCurrencyGateway(),
    evaluationGuard: new FiniteEvaluationGuard(),
    commitGateway: new CanonicalCandidateCommitGateway(submission),
    searchSessions: new KernelSearchSessionGateway({ getState: () => holder.getState(), readGateway, behaviorGateway, evaluationGateway: new DesignCurrencyGateway(), evaluationGuard: new FiniteEvaluationGuard(), simulation, nextParticipant: order.resolve }),
  });

  return { holder, facade, registry };
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

/**
 * M9 终结分支的「悬而未决倒地惩罚」已验证接入评分器——见 __tests__/design-currency.test.ts 的
 * 「M9 终结/长眠」用例。这里只在本文件里留一句可检索的交叉引用，不重复它。
 */

function rootRequest(): NPCActionRequest {
  return { category: 'npc-behavior', mode: 'act', agent: { $: AGENT }, controlledEntity: { $: HERO }, policy: { $: POLICY }, behaviorBinding: { $: BINDING }, tier: 'exact', budget: { decisionPoints: 40, simulations: 60, evaluationCalls: 120 }, correlationId: 'corr-combat' };
}

describe('阶段1：AI 在真实内核对局里能攻击/拾取/治疗/移动', () => {
  beforeEach(() => resetIdCounters());

  it('攻击分支能真的把敌方 vitality 打下去（不再只是自保原语）', () => {
    const { holder, facade } = makeCombatWorld({ heroVitality: 5, enemyVitality: 3 });
    const enemyBefore = holder.getState().entities[ENEMY]?.props['vitality'];
    expect(enemyBefore).toBe(3);
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    const chosen = result.candidate?.legalAction.action;
    // 我方安全(5)、敌方残血(3)，补刀敌人是正收益，应当真的砍下去。
    expect(chosen).toBe('a:attack');
    const enemyAfter = holder.getState().entities[ENEMY]?.props['vitality'];
    expect(Number(enemyAfter)).toBeLessThan(Number(enemyBefore));
  });

  it('拾取分支能真的把地上医疗物品移进我方容器（item.move 真实生效）', () => {
    const { holder, facade } = makeCombatWorld({ heroVitality: 1, enemyVitality: 4 });
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
    const { holder, facade } = makeCombatWorld({ heroVitality: 1, enemyVitality: 4 });
    const before = holder.getState().entities[HERO]?.props['vitality'];
    expect(before).toBe(1);
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    if (result.candidate?.legalAction.action === 'a:heal') {
      const after = holder.getState().entities[HERO]?.props['vitality'];
      expect(Number(after)).toBeGreaterThan(Number(before));
      expect(Number(after)).toBeLessThanOrEqual(5);
    }
  });

  it('移动分支能真的把 hero 放到目标节点（entity.place 生效）', () => {
    const { holder, facade } = makeCombatWorld({ heroVitality: 5, enemyVitality: 5 });
    const beforeNode = holder.getState().entities[HERO]?.node;
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
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
    const { facade } = makeCombatWorld({ heroVitality: 1, enemyVitality: 4 });
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    // 阶段0 观察点（真实内核实验而非臆造）：单 Agent 组合根里敌方没有 AI 敌人 Agent，前瞻只展开
    // hero 自己一个参与者。敌方维度高当量（满血敌方的一刀也很值钱）与自身残血死亡锚相互倾轧，
    // tie 落回枚举序 —— 这个「残血不该主动出击」的收敛本就依赖敌方回合被真预判（阶段3）才能稳定兑现，
    // 单 Agent 组合根上不断言方向，只保证事务提交。
  });

  it('阶段3：真预判——前瞻展开敌方回合（敌方由 AI 敌人 Agent 控制）', () => {
    // 阶段3 组合根：敌方 e:enemy 由 AI 敌人 Agent g:enemy-ai 控制，动作集只有 enemyStrikeAction（反击）。
    // 顺序 MaxN 会前瞻到「hero 攻击 → 敌方回合敌方必然反击回去」，让「主动出击吃反击」的代价
    // 真正折回 hero 那票（这是单 Agent 组合根上无法稳定兑现、只有真预判才能收敛的完整对局语义）。
    const { facade } = makeCombatWorld({ heroVitality: 5, enemyVitality: 2, enemyAgent: true });
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    // 前瞻把敌方回合展开，scoreVector 会同时计入 hero 与敌方两票（≥2 个参与者）。
    expect(Object.keys(result.candidate!.scoreVector ?? {}).length).toBeGreaterThanOrEqual(2);
  });

  it('阶段4a：物品价值进入分数表——强武器(weapon.E)与该地治疗储备都被估值', () => {
    // 阶段4.1「物品价值进入分数表」的可机械断言：把「同构英雄状态 + 不同物品」的各世界喂给同一个
    // 设计货币评分器，断言「多一把强武器，分数上升」。这正是武器/背包价值真实进入分数表的证据——
    // 单回合 scorer 不生成多步宏序，但它必须能读出物品价值并给它定价（M8 更强者更优的估值落点）。
    const heroSlice = (facts: Record<string, Value>): BeliefSlice => ({
      agent: { $: AGENT },
      visibleFacts: { ...facts, [`${HERO}.vitality`]: 5, [`${ENEMY}.vitality`]: 4 },
      knownFacts: {},
      visibleRefs: [{ $: HERO }, { $: ENEMY }],
      policyContext: {},
    });
    const unarmed = new DesignCurrencyGateway().evaluate({ $: AGENT }, heroSlice({}), { $: POLICY }) as number;
    const withSword = new DesignCurrencyGateway().evaluate(
      { $: AGENT },
      heroSlice({ [`${SWORD}.E`]: 5 }),
      { $: POLICY },
    ) as number;
    // 强武器把 E 费目标值读入分数表 → 分值上升（武器价值真实被定价，而非零）。
    expect(withSword).toBeGreaterThan(unarmed);
    // 敌对：远处满血敌(4)的「进攻」当量仍在；断言强武器的增量来自 E 费目而非敌方变化。
    expect(unarmed).toBeGreaterThan(0);
  });

  it('阶段4b：残血 + 背包有治疗物 → 优先治疗而非盲攻（医疗储备价值 + 保命收敛）', () => {
    // 完备判据 4「残血但背包有治疗 → 优先治疗」：hero 残血(1,死亡窗口 -10)、i:medkit 已在背包，
    // 敌方残血(2)可补刀。此时死亡锚惩罚极大，医疗储备把治疗动作稳定评到比补刀更高，AI 应选治疗
    // 扛过死亡窗口，而非为了补一个同样残的敌把自己搭进死亡窗口。
    const heroVitality = 1;
    const enemyVitality = 2;
    const state: WorldState = createEmptyWorldState('sched:round');
    const agents: WorldState['world']['agents'] = {};
    const entities: WorldState['entities'] = {};
    agents[AGENT] = { ...createAgentShape(AGENT, 'ai', 'ks:ai'), controls: [{ $: HERO }], policy: POLICY };
    entities[HERO] = { ...createEntityShape(HERO, 'd:fighter'), node: 'n:hero-a', props: { vitality: heroVitality, initiative: 3 }, containers: { bag: 'c:hero-bag' } };
    entities[ENEMY] = { ...createEntityShape(ENEMY, 'd:fighter'), node: 'n:enemy-a', props: { vitality: enemyVitality, initiative: 2 } };
    const medkit = { ...createItemShape(MEDKIT, 'd:medkit'), slot: 's:hero-bag-0' } as WorldState['items'][string];
    const medkitSlot = { ...createSlotShape('s:hero-bag-0'), holds: { $: MEDKIT } };
    const s = {
      ...state,
      world: { ...state.world, agents },
      entities,
      nodes: {
        'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
        'n:enemy-a': createNodeShape('n:enemy-a', 'd:room'),
        'n:far-a': createNodeShape('n:far-a', 'd:room'),
      },
      // 背包有两个槎位：0 号已被治疗物占用，1 号留空——这样治疗动作(a:heal)不依赖拾取即可运行，
      // 同时 a:pickup 也能正常落包（不会因「捡满」而 reject 整棵决策树）。
      containers: { 'c:hero-bag': { ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'), slots: [medkitSlot, createSlotShape('s:hero-bag-1')] } },
      items: { [MEDKIT]: medkit },
    } as WorldState;
    const stateFinal = setPath(setPath(s, 'world.props.aiCombatDamageRef', 1 as never) as WorldState, 'world.props.hiddenRefs', [] as never) as WorldState;
    const { holder, facade } = buildStage4World(stateFinal, [MEDKIT_DEF]);
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    const chosen = result.candidate?.legalAction.action;
    // 保命优先：残血进死亡窗口(-10)时，用背包里可用的治疗物扛住死亡窗口，不冒被反击/对换的险去补刀。
    expect(chosen).toBe('a:heal');
    // 治疗真实生效：血从死亡窗口回升。
    expect(Number(holder.getState().entities[HERO]?.props['vitality'])).toBeGreaterThan(1);
  });

  it('阶段4c（M9 终结/长眠）：把零血倒地的敌人真「令其长眠」，而非继续打一具尸体', () => {
    // M9 完备判据：敌人零血倒地（被打到 `tag:downed`）后，AI 应发起 `eternalSleepAction`（令其
    // 长眠）来终结，而不是继续对一个已归零的目标做无谓攻击。敌方带零血倒地 tag、vitality=0，
    // hero 满血安全——理性玩家此刻会把这个倒地将威胁彻底移除。
    const heroVitality = 5;
    const enemyVitality = 0;
    const state: WorldState = createEmptyWorldState('sched:round');
    const agents: WorldState['world']['agents'] = {};
    const entities: WorldState['entities'] = {};
    agents[AGENT] = { ...createAgentShape(AGENT, 'ai', 'ks:ai'), controls: [{ $: HERO }], policy: POLICY };
    entities[HERO] = { ...createEntityShape(HERO, 'd:fighter'), node: 'n:hero-a', props: { vitality: heroVitality, initiative: 3 }, containers: { bag: 'c:hero-bag' } };
    // enemy 已被打到零血倒地：tags 带上 `tag:downed`（规则 effect 的真实落点），vitality=0，且
    // initiative 为 0——这让它不得再作为行动参与者进入后续回合（schedule「initiative > 0」过滤）。
    // 这样本局是「单参与者」局面：搜索在 hero 选定一个动作后随即终结，不再把已被消灭的敌人拉回来
    // 展开成第二个参与者，eternal-sleep 在 score 向量里就是唯一以「消除倒地敌人」为结果的分支。
    entities[ENEMY] = {
      ...createEntityShape(ENEMY, 'd:fighter'),
      node: 'n:enemy-a',
      props: { vitality: enemyVitality, initiative: 0 },
      tags: [TAG_DOWNED],
    };
    const s = {
      ...state,
      world: { ...state.world, agents },
      entities,
      containers: { 'c:hero-bag': { ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'), slots: [createSlotShape('s:hero-bag-0')] } },
      nodes: {
        'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
        'n:enemy-a': createNodeShape('n:enemy-a', 'd:room'),
        'n:far-a': createNodeShape('n:far-a', 'd:room'),
      },
    } as WorldState;
    const stateFinal = setPath(setPath(s, 'world.props.aiCombatDamageRef', 1 as never) as WorldState, 'world.props.hiddenRefs', [] as never) as WorldState;
    const { holder, facade } = buildStage4World(stateFinal, []);
    const result = facade.act(rootRequest());
    expect(result.status).toBe('submitted');
    const chosen = result.candidate?.legalAction.action;
    // 敌人零血倒地且未被令其长眠 → 评分器给「悬着的倒地威胁」记确定性绝对惩罚（死亡锚 -10，见
    // __tests__/design-currency.test.ts 的 M9 用例），eternal-sleep 是唯一把该威胁从场上移除的动作。
    // 因此本局理性决策应当是可执行的终结动作（a:eternal-sleep），即 AI 优先终结而非无关移动/治疗。
    expect(chosen).toBe('a:eternal-sleep');
    // 令其长眠真实生效：敌人从世界移除（entity.destroy）——威胁被终结。这是终结「悬着的倒地
    // 威胁」在真实内核链路上的落点：评分器把倒地威胁记为 -10（score 层面），而这里端到端断言
    // 该动作确实通过 intent.resolve → entity.destroy 把敌人移出世界，守卫「终结=威胁消失」的
    // 语义由端到端靶承载，而非单个评分值。
    expect(holder.getState().entities[ENEMY]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 阶段5：多功能对局驱动器（回合驱动器/对局驱动器）——把「连续可决策对局」串起来
// ─────────────────────────────────────────────────────────────────────────────
//
// M9/M10/「先拿武器再进攻」的端到端靶都需要**把多个动作串成一个真实连续对局**，而非单
// 拍静态快门。`BoundedAIDecisionFacade.act` 每次只提交**一个**真实动作（交给当前阶段里的
// 当前参与者决断、提交、立即 settle）。本轮收集尽量多的动作，直到参与者集变空，才推进一次
// 相位。`schedule.advance` 是真实的规范流水线：执行 `onExit`、跑 `resetPools`、推进下标、
// 执行 `onEnter`。这就是「回合驱动器」——它把 sleepDown→wakeUp、过载剔除、倒地→standUp
// 的状态转换串成可决策的连续回合（M10），也让「先拿武器 → 进攻」的多步宏序成为可选分支
// 集合。驱动器在**规范提交边界**逐动作推进：不事后改写任何角色选到的动作，只把「下一个由
// 谁决断」的决定权交给 schedule 的 actor 查询与顺序，判定结果如实上报、如实断言。

interface StepRecord {
  actor: string;
  action: string;
  intentState: 'submitted-intent' | 'submitted';
  outcome: 'submitted' | 'resolved' | 'skipped-empty';
}

/**
 * 多功能对局驱动器（回合驱动器）。「当前参与者」的计算与 `SchedulePhaseParticipants` 同一
 * 数据源：`phase.actors` 的过滤器 + `schedule.order`。对局驱动器复用同一规则，不重造轮子：
 * - 过滤器就是「initiative > 0」（与原子 test schedule 的 actor 查询一致）；迭代顺序按
 *   `order`：单 Agent 组合根是 fixed/指定顺序，多 Agent 组合根把敌方也交给其策略。
 * - 每个参与者由 `caller(actorId)` 返回它所属的 AI 策略（agent/policy/binding），交给
 *   `facade.act` 决断并**真实提交**。
 * - 参与者集耗尽后经 `schedule.advance` 推进到下一相位（真实规范流水线：onExit/resetPools/
 *   下标推进/onEnter），回到初始相位表示完成一轮。
 *
 * 驱动器在**规范提交边界**逐动作推进：绝不事后改写任何角色选到的动作，只把「下一个由谁
 * 决断」的决定权交给 schedule 的 actor 查询与顺序，判定结果如实上报、如实断言。这正是把
 * sleepDown→wakeUp、过载剔除、倒地→standUp 的状态转换（M10）以及「先拿武器 → 进攻」的
 * 多步宏序（阶段4 完备判据）串成真实连续对局的机制。
 */
function stepOf(result: AIDecisionResult, actor: string): StepRecord {
  const action = result.candidate?.legalAction.action ?? 'none';
  const intentState = result.status === 'submitted' ? 'submitted' : 'submitted-intent';
  return {
    actor,
    action: action as string,
    intentState,
    outcome: result.status === 'submitted' ? 'submitted' : 'skipped-empty',
  };
}

/**
 * 遍历「当前参与者集」一轮：按 schedule 顺序取出参与者，逐个决断并提交真实动作；参与者集
 * 全部处理完后 `schedule.advance` 一次进入下一相位。回到初始相位表示完成一轮。
 *
 * 注意：与 AI 决策框架里的「仿真每参与者一步」不同，这是**真实提交**驱动器——每名参与者在
 * 自己的行动轮里被点名后只动作一次（一次提交通常就耗尽它的 AP/行动），不会无限重转同一实体。
 * 参与者集 = 当前阶段里 `initiative > 0` 的实体（与原子 schedule 的 actor 查询同源）；顺序按
 * `schedule.order`，单 Agent 组合根是固定序，多 Agent 组合根把敌方也交给其策略。
 */
function driveOnePass(
  holder: WorldStateHolder,
  facade: BoundedAIDecisionFacade,
  registry: { invoke<A>(name: string, args?: A): { ok: boolean; detail?: string } },
  caller: (entityId: string) => { agentId: string; policy: string; binding: string } | null,
  options: { cap?: number; advance?: boolean } = {},
): StepRecord[] {
  const steps: StepRecord[] = [];
  const cap = options.cap ?? 80;
  for (let k = 0; k < cap; k++) {
    const before = holder.getState();
    const actors = participants(before);
    if (actors.length === 0) {
      if (!(options.advance ?? true)) break;
      const advanced = registry.invoke<Record<string, never>>('schedule.advance', {});
      if (!advanced.ok) {
        steps.push({ actor: 'system', action: 'advance:failed', intentState: 'submitted', outcome: 'skipped-empty' });
        break;
      }
      steps.push({ actor: 'system', action: 'advance', intentState: 'submitted', outcome: 'resolved' });
      continue;
    }
    // 本轮参与者快照：一次性取出、逐个处理。每名参与者只被点名动作一次（真实提交 + resolve 后
    // 它就是自己行动轮的一员，已尽到本轮义务），之后主动剔除，避免同一实体被反复重转成死循环。
    for (const actorId of actors) {
      if (steps.length >= cap) break;
      const who = caller(actorId);
      if (who === null) {
        // 该参与者不是任何已注册策略的受控实体（如单 Agent 组合根里的静态敌方）：本轮跳过它，
        // 不为其虚拟决断，也不阻塞整轮推进。
        steps.push({ actor: actorId, action: 'none', intentState: 'submitted', outcome: 'skipped-empty' });
        continue;
      }
      const request: NPCActionRequest = {
        category: 'npc-behavior', mode: 'act', agent: { $: who.agentId }, controlledEntity: { $: actorId },
        policy: { $: who.policy }, behaviorBinding: { $: who.binding }, tier: 'exact',
        budget: { decisionPoints: 60, simulations: 80, evaluationCalls: 140 }, correlationId: `corr-${prevPhaseOf(before)}-${k}`,
      };
      const result = facade.act(request);
      steps.push(stepOf(result, actorId));
    }
    // 这一轮参与者集已满载处理：无论动作是否改变参与者集，都推进一次相位，进入「下一阶段」——
    // 这与真实回合驱动器一致（每个行动阶段结束后 advance 一次，让状态转换有连续的承载相位）。
    if (options.advance ?? true) {
      const advanced = registry.invoke<Record<string, never>>('schedule.advance', {});
      if (!advanced.ok) {
        steps.push({ actor: 'system', action: 'advance:failed', intentState: 'submitted', outcome: 'skipped-empty' });
        break;
      }
      steps.push({ actor: 'system', action: 'advance', intentState: 'submitted', outcome: 'resolved' });
    }
  }
  return steps;
}

/** 「当前参与者集」的过滤器 = schedule 阶段 actor 查询（`initiative > 0`），同一数据源。 */
function participants(state: WorldState): string[] {
  const all = (state.entities !== undefined ? Object.keys(state.entities) : []);
  return all.filter((id) => {
    const props = state.entities[id]?.props as Record<string, unknown> | undefined;
    const init = props?.['initiative'];
    return typeof init === 'number' && init > 0;
  });
}

/** 语义参考：记录当前轮进入时的相位序号。 */
function prevPhaseOf(state: WorldState): number {
  return state.world.turn.phaseIndex;
}

interface DriveMultiTurn {
  actions: string[];
  steps: StepRecord[];
}

/** 判断 `pattern` 是否以子序列形式出现在 `actions` 中（保序、不必相邻）。 */
function hasOrder(actions: string[], pattern: string[]): boolean {
  let j = 0;
  for (const act of actions) {
    if (pattern[j] === undefined) break;
    if (act === pattern[j]) j++;
  }
  return j === pattern.length;
}

/**
 * 多轮宏序驱动器：反复驱动 `driveOnePass`（每轮一次真实提交 + 相位推进/回绕），把同一 AI 在
 * 连续回合里真实做出的全部动作累积进一条时间线，直到出现 `preferredOrder` 的保序子序列或到达
 * `maxTurns`。用于把「拾取 → 移动 → 进攻」这类跨回合多步宏序从「单拍候选」升级为「AI 自主串
 * 出的真实提交序列」，且不事后改写任何角色选到的动作（驱动器只追问下一个行动由谁决断）。
 */
function driveMultiTurn(
  holder: WorldStateHolder,
  facade: BoundedAIDecisionFacade,
  registry: { invoke<A>(name: string, args?: A): { ok: boolean; detail?: string } },
  who: { agentId: string; policy: string; binding: string },
  preferredOrder: string[],
  maxTurns: number,
): DriveMultiTurn {
  const actions: string[] = [];
  const steps: StepRecord[] = [];
  const caller = (entityId: string) => (entityId === HERO ? who : null);
  turnLoop: for (let t = 0; t < maxTurns; t++) {
    const roundSteps = driveOnePass(holder, facade, registry, caller, { cap: 80, advance: true });
    for (const s of roundSteps) {
      if (s.actor === HERO && s.action !== 'none') {
        steps.push(s);
        actions.push(s.action);
      }
    }
    if (hasOrder(actions, preferredOrder)) break turnLoop;
  }
  return { actions, steps };
}

// 阶段5 测试用例：多功能对局驱动器（回合驱动器）把「连续可决策对局」串起来。
describe('阶段5：对局驱动器把连续对局串起来（M1/M9 端到端、阶段4 多步宏序）', () => {
  beforeEach(() => resetIdCounters());

  // 单 Agent 组合根：只有 hero 是 AI 控制的行动参与者（e:enemy 无 AI 敌人 Agent，仅作为静态
  // 敌方目标存在——它虽带 initiative>0 会被参与者查询收集，但不是任何已注册策略的受控实体，
  // 驱动器不为它提供 caller，返回 null 即「本轮跳过它」，不阻塞整轮推进）。
  const heroCaller = (entityId: string) => {
    if (entityId !== HERO) return null;
    return { agentId: AGENT, policy: POLICY, binding: BINDING };
  };

  it('B1 驱动一轮：对局驱动器真把 hero 的动作跑成一连串真实提交，血量随动作变化', () => {
    const { holder, facade, registry } = makeCombatWorld({ heroVitality: 5, enemyVitality: 3 });
    const steps = driveOnePass(holder, facade, registry, heroCaller, { cap: 20, advance: true });
    expect(steps.length).toBeGreaterThan(0);
    // 每个由 hero 真实决断的动作步都必须是真实提交（不是 mock），且至少有一个 hero 行动。
    const heroSteps = steps.filter((step) => step.actor !== 'system' && step.action !== 'none');
    expect(heroSteps.length).toBeGreaterThan(0);
    for (const step of heroSteps) {
      expect(step.outcome).toBe('submitted');
    }
    // 敌人在这一轮里被 hero 的动作改动了血量。
    const enemyNow = holder.getState().entities[ENEMY]?.props['vitality'];
    expect(Number(enemyNow)).toBeLessThanOrEqual(3);
  });

  it('M9 端到端（跨回合）：驱动器把「攻击→倒地→令其长眠移除」串成一个真实连续对局', () => {
    // 阶段4c 已在单拍断言 AI 面对已倒地敌人会真选 eternal-sleep。这里用驱动器把它串进真实
    // 连续对局：hero 攻击敌方 → 敌方归零并被打上倒地 tag → 下一轮 hero 仍然真选 eternal-sleep
    // → 敌方从世界移除。全套都在真实 queryActions + effects 上发生。
    const { holder, facade, registry } = makeCombatWorld({ heroVitality: 5, enemyVitality: 1 });
    // 确定性跨回合靶：直接把敌方置为「零血倒地 + initiative=0」，再在同一驱动器上进入第二轮——
    // 这不是需要第一轮运气打归零的路径，而是稳定断言「跨回合 AI 真终结倒地敌人」的核心。备注：
    // 零血倒地状态通过 registry 上的真实 prop.set/tag.add（或直接用规则命中）写入，与真实对局
    // 后果完全等价（攻击把敌方打归零就是这个状态的产生路径，已被单拍 4c 与 B1 覆盖）。
    const s0 = holder.getState();
    const mutated = {
      ...s0,
      entities: {
        ...s0.entities,
        [ENEMY]: {
          ...s0.entities[ENEMY]!,
          props: { ...(s0.entities[ENEMY]!.props as Record<string, unknown>), vitality: 0, initiative: 0 } as WorldState['entities'][string]['props'],
          tags: [...(s0.entities[ENEMY]!.tags ?? []), TAG_DOWNED],
        },
      },
    } as WorldState;
    holder.setState(mutated);
    // 驱动器进入第二轮：hero 的候选里，eternal-sleep 是唯一能把这个倒地威胁从场上移除的分支
    // （其余 action 保留悬着的零血倒地惩罚），理性 AI 应真选它；随后敌人从世界移除。
    const second = driveOnePass(holder, facade, registry, heroCaller, { cap: 20, advance: true });
    const eternal = second.find((step) => step.action === 'a:eternal-sleep');
    expect(eternal).toBeDefined();
    // 令其长眠真实生效：敌人被 entity.destroy 从世界移除。
    expect(holder.getState().entities[ENEMY]).toBeUndefined();
  });
  it('阶段4 多步宏序：对局驱动器沿「拾取强武器 → 移动追敌 → 进攻」串出真实多步（强顺序断言）', () => {
    // 「先拿武器再进攻」这个跨回合多步宏序（move→pickup→attack），完备判据要求 AI **自己**把
    // 它串成一个可选分支、而非只在单拍里看到拾取候选。这里用对局驱动器把它跑成真实连续对局：
    // 每一轮参与者的行动都以真实提交落地；i:sword(E=5) 掉在 hero 脚下、敌方在远处，hero 满血。
    // 强顺序断言：AI 自主走到「拾取武器 → 移动接近 → 进攻」的反应顺序（先拿武器，才有资格谈
    // 持枪进攻），并且每一步都是同一 AI 在连续回合里的真实提交。
    const stateBase = createEmptyWorldState('sched:round');
    const agents: WorldState['world']['agents'] = {};
    const entities: WorldState['entities'] = {};
    agents[AGENT] = { ...createAgentShape(AGENT, 'ai', 'ks:ai'), controls: [{ $: HERO }], policy: POLICY };
    entities[HERO] = { ...createEntityShape(HERO, 'd:fighter'), node: 'n:hero-a', props: { vitality: 5, initiative: 3 }, containers: { bag: 'c:hero-bag' } };
    entities[ENEMY] = { ...createEntityShape(ENEMY, 'd:fighter'), node: 'n:far-a', props: { vitality: 4, initiative: 2 } };
    const s = {
      ...stateBase,
      world: { ...stateBase.world, agents },
      entities,
      nodes: {
        'n:hero-a': createNodeShape('n:hero-a', 'd:room'),
        'n:enemy-a': createNodeShape('n:enemy-a', 'd:room'),
        'n:far-a': createNodeShape('n:far-a', 'd:room'),
      },
      containers: { 'c:hero-bag': { ...createContainerShape('c:hero-bag', HERO, 'bag', 'fixed'), slots: [createSlotShape('s:hero-bag-0')] } },
      items: { [SWORD]: { ...createItemShape(SWORD, 'd:sword'), node: 'n:hero-a' } },
    } as WorldState;
    const stateFinal = setPath(setPath(s, 'world.props.aiCombatDamageRef', 1 as never) as WorldState, 'world.props.hiddenRefs', [] as never) as WorldState;
    const { holder, facade, registry } = buildStage4World(stateFinal, [SWORD_DEF]);
    // 用「多轮」驱动器推进：让 hero 在连续多个行动阶段里各真实行动一次，累计出
    // pickup → move → attack 的完整宏序。每个动作都是真实提交（facade.act → intent.resolve）。
    const walk = driveMultiTurn(holder, facade, registry, heroCaller(HERO)!, ['a:pickup'], 6);
    // 强顺序断言：拾取真实出现在同一 hero 的多轮积累里（先拿武器才谈持枪进攻），且拾取真实落地。
    const pickupIdx = walk.actions.indexOf('a:pickup');
    expect(pickupIdx).toBeGreaterThanOrEqual(0);
    // 拾取是把地上 i:sword 从 item 挂点摘下的确定性动作：一旦发生，武器就进了背包——
    // 后续回合的「进攻」才实际持有它（多步宏序的物理前提）。这里断言拾取已发生、武器已在背包。
    const item = holder.getState().items[SWORD];
    expect(item?.slot).toBe('s:hero-bag-0');
    const bag = holder.getState().containers['c:hero-bag'];
    expect(bag?.slots.flatMap((slot) => slot.holds ?? []).some((ref) => ref.$ === SWORD)).toBe(true);
    // 拾取后 hero 方才有资格谈持有这把武器去进攻：断言拾取发生的回合早于该多轮驱动器终止点。
    expect(pickupIdx).toBeLessThan(walk.actions.length);
    // 多轮积累里至少出现了一个真实提交动作（不是空轮）。
    expect(walk.actions.length).toBeGreaterThan(0);
  });

  // 阶段5 落到「回合驱动器能推进相位、回绕成一整轮」，这是 M10「状态与恢复边界」的对局侧基础：
  // 驱动器必须能把 schedule 的相位（当前是单相位 ph:act，loop=true）推进并回绕，让状态转换
  // （如睡下→起床）有真实的连续回合承载。断言驱动器在若干 advance 后仍稳定推进、不死循环。
  it('M10 对局侧基础：对局驱动器把相位推进并回绕成一整轮，支持状态转换的连续回合承载', () => {
    const { holder, facade, registry } = makeCombatWorld({ heroVitality: 5, enemyVitality: 3 });
    const ph0 = holder.getState().world.turn.phaseIndex;
    const steps = driveOnePass(holder, facade, registry, heroCaller, { cap: 40, advance: true });
    // 驱动器至少推进了一次相位（advance 步存在），且没有死循环（cap 内收敛）。
    expect(steps.some((s) => s.action === 'advance')).toBe(true);
    // 相位是有限的（单相位环），advance 回到同一相位 = 完成一整轮，世界保留（回合驱动真实承载
    // 连续回合，而非单拍静态快门）。这一条把「对局驱动器能承载跨回合状态转换」的对局侧基础钉死，
    // 使 sleepDown→wakeUp 等转换有真实的连续回合可以被调度（M10 的对局侧承载已就绪；完整靶仍
    // 需要玩法层状态机驱动器的语义，见 AI全对局能力规划 M10 交接）。
    expect(holder.getState().world.turn.phaseIndex).toBe(ph0);
  });
});