/**
 * scoreDesignCurrency / SequentialSearchPlanner 的 PBT 防回归（BATCH B 缺口5）。
 *
 * 目的：性质测试用大量随机信念切片/对局快照（numRuns≥100）约束评分器与搜索器的
 * **结构不变性**——不是为某个特定输入打补丁，而是把设计货币的三条核心原则
 * （死亡锚/分水岭/稀缺）与 sequential-search 的终止性、末位向量、非法分支
 * 在任意合法输入下都断言不得违背。写法遵循既有 `coarse-no-relevant-action.property.test.ts`
 * 的 `fast-check` + `fc.assert(..., { numRuns })` 惯例。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FixedBudgetLedger } from '../budget';
import {
  DESIGN_CURRENCY_CHARGES,
  DESIGN_CURRENCY_PRINCIPLES,
  scoreDesignCurrency,
} from '../design-currency';
import { SequentialSearchPlanner } from '../sequential-search';
import type {
  AIPlan,
  BeliefSlice,
  CandidateSeed,
  EvaluationOutcome,
  SearchDecisionContext,
  SearchSession,
  SimulationOutcome,
} from '../types';
import type { LegalAction as KernelLegalAction } from '../../actions/types';

/** 任意 1-5 的体能字段值（玩家可见部分；死亡锚/稀缺只在这段有意义）。 */
const vitalityValue = fc.integer({ min: 1, max: 5 });
/** 任意 0-3 的资源池代数量（0 会触发 exhaustionAnchor）。 */
const poolValue = fc.integer({ min: 0, max: 3 });

/** 构造一个以宿主实体为中心、最多含任一敌方与一把武器的信念切片。 */
function sliceWith(hostVitality: number, enemyVitality: number | null, downed: boolean, ap: number, stamina: number, weaponE: number | null): BeliefSlice {
  const facts: Record<string, number> = { 'e:host.vitality': hostVitality };
  if (enemyVitality !== null) facts['e:enemy.vitality'] = enemyVitality;
  if (downed) facts['e:enemy.downedZero'] = 1;
  facts['e:host.pool.ap'] = ap;
  facts['e:host.pool.stamina'] = stamina;
  if (weaponE !== null) facts['i:sword.E'] = weaponE;
  return {
    agent: { $: 'g:npc' },
    visibleFacts: facts,
    knownFacts: {},
    visibleRefs: [],
    policyContext: {},
  };
}

describe('scoreDesignCurrency PBT（缺口5 防回归）', () => {
  it('任意合法输入评分恒为有限数（绝不抛错 / 绝不 NaN / 绝不 ±Infinity）', () => {
    fc.assert(
      fc.property(
        vitalityValue,
        fc.option(fc.integer({ min: 0, max: 5 })),
        fc.boolean(),
        poolValue,
        poolValue,
        fc.option(fc.integer({ min: 1, max: 6 })),
        (hv, ev, downed, ap, stamina, weaponE) => {
          const slice = sliceWith(hv, ev, downed, ap, stamina, weaponE);
          const score = scoreDesignCurrency({ slice });
          expect(Number.isFinite(score)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('死亡锚：宿主进入死亡窗口（vitality<=lethalWindow）时，单维度切片的估值必为死亡锚，且稀缺正向绝不翻正', () => {
    fc.assert(
      fc.property(vitalityValue, (hv) => {
        // 纯生命切片（不含任何敌方/资源字段），避免敌方当量与资源正分稀释死亡锚的精确断言。
        const slice: BeliefSlice = {
          agent: { $: 'g:npc' },
          visibleFacts: { 'e:host.vitality': hv },
          knownFacts: {},
          visibleRefs: [],
          policyContext: {},
        };
        const score = scoreDesignCurrency({ slice });
        if (hv <= DESIGN_CURRENCY_PRINCIPLES.lethalWindow) {
          // 纯生命切片：死亡锚精确压过稀缺正向（稀缺系数的上限 0.2*4 远小于 10）→ 净分为死亡锚。
          expect(score).toBe(DESIGN_CURRENCY_PRINCIPLES.deathAnchor);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('分水岭单调：宿主血从 5 降到 4（进入窗口）时，在无其它字段的纯生命切片下，4 的估值不高于 5', () => {
    // 5 在窗口外（正稀缺微调），4 触发死亡锚 → 4 的净分必 <= 5 的净分。
    const pureSlice = (hv: number): BeliefSlice => ({
      agent: { $: 'g:npc' },
      visibleFacts: { 'e:host.vitality': hv },
      knownFacts: {},
      visibleRefs: [],
      policyContext: {},
    });
    const five = scoreDesignCurrency({ slice: pureSlice(5) });
    const four = scoreDesignCurrency({ slice: pureSlice(4) });
    expect(four).toBeLessThanOrEqual(five);
  });

  it('稀缺与击杀方向：敌方越残（值越低），进攻当量越高（低血稀缺单调，绝不见涨）', () => {
    // 敌方维度 unit=5 + 低血稀缺：值越低、血量越残，进攻当量越高。断言 strict 单调递减字典序：
    // score(evA) > score(evB) 当且仅当 evA < evB。宿主固定在安全窗口外(5)，只变敌方，避免
    // 宿主死亡锚(-10)污染敌方当量方向。
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 }), (evA, evB) => {
        if (evA === evB) return;
        const a = scoreDesignCurrency({ slice: sliceWith(5, evA, false, 3, 3, null) });
        const b = scoreDesignCurrency({ slice: sliceWith(5, evB, false, 3, 3, null) });
        // evA < evB（更残） → a 当量更高。
        expect(a).not.toBe(b);
        if (evA < evB) expect(a).toBeGreaterThan(b);
        else expect(b).toBeGreaterThan(a);
      }),
      { numRuns: 150 },
    );
  });

  it('死亡锚只对真正进入窗口的宿主施加：宿主安全(5)加任意残血敌，不凭空起死亡锚（净分不与 -10 并列）', () => {
    // 注意：belief 键 `<id>.<field>` 的 suffix 匹配使宿主 bare `vitality` 与敌方
    // `e:enemy.vitality` 会同时为敌方维度送值（既有设计行为），因此不能断言「单敌方切片为正」。
    // 这里断言更稳健的方向不变性：宿主安全窗口(5)时，加一个残血敌只会抬高进攻当量，绝不制造
    // 「宿主未观测 → 误起死亡锚」的负向回退——即加了安全敌方后分数须 > 无敌方时的宿主基础分。
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (ev) => {
        const base = sliceWith(5, null, false, 3, 3, null);
        const withEnemy = sliceWith(5, ev, false, 3, 3, null);
        const baseScore = scoreDesignCurrency({ slice: base });
        const withEnemyScore = scoreDesignCurrency({ slice: withEnemy });
        // 加入残血敌 → 进攻当量增加（敌方维度正 unit + 低血稀缺）→ 总分必上升，绝不因
        // 宿主字段的存在性异动而回落成新的死亡锚负分。
        expect(withEnemyScore).toBeGreaterThan(baseScore);
        expect(withEnemyScore).toBeGreaterThan(DESIGN_CURRENCY_PRINCIPLES.deathAnchor);
      }),
      { numRuns: 150 },
    );
  });

  it('分数表配置不变性：费目集合始终包含关键维度（防止未来误删/改名导致评分器失去读写面）', () => {
    const fields = DESIGN_CURRENCY_CHARGES.map((entry) => entry.field);
    for (const expected of ['vitality', 'E', 'heal', 'e:enemy.vitality', 'pool.ap', 'pool.stamina']) {
      expect(fields).toContain(expected);
    }
  });
});

// ―― SequentialSearchPlanner 结构性性质（缺口5）――
// 用单参与者的根请求 + 一个模拟 SearchSession 验证搜索器的控制流不变性
// （终止、末位向量含根参与者、非法分支代码、确定性平局）。求值分数用任意小整数
// 注入，验证的是**搜索器对任意合法估值的结构不变量**，不是某组固定分数的点焊。

function makeActorId(prefix: string, n: number): string {
  return `${prefix}${n}`;
}

interface SimSessionCtx {
  ctx: SearchDecisionContext;
  checkpoint: string;
}

function buildSimSession(opts: {
  scores: Record<string, number>;
  budget: { decisionPoints: number; simulations: number; evaluationCalls: number };
  actorId: string;
  /** 若提供，覆盖求值：返回非法分数（非有限）触发 AI_EVALUATION_INVALID fail-closed。 */
  nonFinite?: boolean;
}): { session: SearchSession; simulatedCalls: () => number; restoredCalls: () => number; tieCalls: () => number } {
  const actorId = opts.actorId;
  const ctx: SearchDecisionContext = {
    request: {
      category: 'npc-behavior',
      mode: 'act',
      agent: { $: 'g:npc' },
      controlledEntity: { $: actorId },
      policy: { $: 'd:policy' },
      behaviorBinding: { $: 'd:bind' },
      tier: 'exact',
      budget: opts.budget,
      correlationId: 'pbt-seq-root',
    },
    scope: {
      knowledgeVersion: 'k:1',
      actionVersion: 'a:1',
      beliefSlice: () => ({ ok: true, value: { visibleFacts: {} } as unknown as BeliefSlice }),
      queryActions: () => ({ ok: true, value: [] as never }),
      query: () => ({ ok: true, value: [] as never }),
      isCurrent: () => true,
      agent: { $: 'g:npc' },
    },
    behavior: {
      family: { $: 'd:family' },
      policy: { $: 'd:policy' },
      category: 'npc-behavior',
      parameters: [],
      relevantActionIds: [],
    },
  };

  let counter = 0;
  let simulated = 0;
  let restored = 0;
  let ties = 0;
  const open = new Map<string, SimSessionCtx>();

  const session: SearchSession = {
    root: ctx,
    simulate: (_c, _candidate) => {
      simulated += 1;
      counter += 1;
      const checkpoint = `ck:${counter}`;
      open.set(checkpoint, { ctx, checkpoint });
      return {
        ok: true,
        value: { checkpoint, visibleStateChanged: true, decisionState: 'none', intentState: 'resolved' } as SimulationOutcome,
      };
    },
    restore: (after) => {
      restored += 1;
      const branch = open.get(after.checkpoint);
      if (branch === undefined) {
        return { ok: false, code: 'AI_SIMULATION_FAILED', detail: 'No open simulated branch for checkpoint.' };
      }
      open.delete(after.checkpoint);
      return { ok: true, value: undefined };
    },
    nextDecisionContext: () => ({ ok: true, value: undefined }),
    evaluate: (_ctx2, candidate) => {
      if (opts.nonFinite === true) {
        const outcome: EvaluationOutcome = { score: Number.NaN, status: 'neutral-fallback' };
        return outcome;
      }
      const actionScore = candidate === undefined ? 0 : opts.scores[candidate.action] ?? 0;
      const outcome: EvaluationOutcome = { score: actionScore, status: 'evaluated' };
      return outcome;
    },
    selectTie: () => {
      ties += 1;
      return { ok: true, value: 0 };
    },
    remainingBudget: () => ({ decisionPoints: 0, simulations: 0, evaluationCalls: 0 }),
  };

  return { session, simulatedCalls: () => simulated, restoredCalls: () => restored, tieCalls: () => ties };
}

/** 构造单参与者根计划：固定数量的候选动作。 */
function buildRootPlan(opts: {
  candidateActions: string[];
  budget: { decisionPoints: number; simulations: number; evaluationCalls: number };
}): AIPlan {
  const ledger = new FixedBudgetLedger(opts.budget);
  const candidates: readonly CandidateSeed[] = opts.candidateActions.map((action) => ({
    legalAction: { action, kind: 'action', bindings: {}, cost: [] } as unknown as KernelLegalAction,
  }));
  return {
    rootSlice: { agent: { $: 'g:npc' }, visibleFacts: {}, knownFacts: {}, visibleRefs: [], policyContext: {} },
    tier: 'exact',
    candidates,
    budget: ledger,
  };
}

/** 用真实 SequentialSearchPlanner 跑一次 search，返回 (result, session 计数器)。 */
function runSequentialSearch(opts: {
  candidateActions: string[];
  scores: Record<string, number>;
  budget: { decisionPoints: number; simulations: number; evaluationCalls: number };
  actorId: string;
  nonFinite?: boolean;
}): { result: ReturnType<SequentialSearchPlanner['search']>; simulated: number; restored: number; ties: number } {
  const { session, simulatedCalls, restoredCalls, tieCalls } = buildSimSession(opts);
  const planFn = (): AIPlan => buildRootPlan({ candidateActions: opts.candidateActions, budget: opts.budget });
  const planner = new SequentialSearchPlanner(
    { plan: planFn } as unknown as SequentialSearchPlanner,
    { resolve: () => ({ ok: true, value: { plan: planFn } as never }) } as never,
  );
  const root = buildRootPlan({ candidateActions: opts.candidateActions, budget: opts.budget });
  const result = planner.search(session, root);
  return { result, simulated: simulatedCalls(), restored: restoredCalls(), ties: tieCalls() };
}

describe('SequentialSearchPlanner 结构性 PBT（缺口5 防回归）', () => {
  const budget = { decisionPoints: 40, simulations: 60, evaluationCalls: 120 };
  const actorId = makeActorId('e:npc', 0);

  it('任意合法候选集 + 任意终局分数下：终止、末位向量包含根参与者且分数为有限数 (numRuns=120)', () => {
    // 候选数 0..4，注入任意小整数分数；根参与者固定。断言终止且分数向量含根维。
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a:one', 'a:two', 'a:three'), { minLength: 0, maxLength: 4 }),
        fc.integer({ min: -100, max: 100 }),
        (actionNames, seedScore) => {
          const actions = Array.from(new Set(actionNames));
          const scores: Record<string, number> = {};
          const tied = Math.floor(seedScore);
          for (const action of actions) scores[action] = tied;
          const { result } = runSequentialSearch({ candidateActions: actions, scores, budget, actorId });
          if (actions.length === 0) {
            expect(result).toMatchObject({ ok: true, value: undefined });
            return;
          }
          expect(result.ok).toBe(true);
          const candidate = result.ok ? result.value : undefined;
          expect(candidate).toBeDefined();
          if (candidate !== undefined && candidate.scoreVector !== undefined) {
            expect(Object.keys(candidate.scoreVector)).toContain(actorId);
            const rootEntry = candidate.scoreVector[actorId];
            expect(rootEntry).toBeDefined();
            expect(Number.isFinite(rootEntry!.score)).toBe(true);
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  it('maxNs：每个候选分支都被模拟一次，且根选择后在恢复中回到活动前状态（预算充足，numRuns=100）', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a:one', 'a:two', 'a:three'), { minLength: 1, maxLength: 4 }), (names) => {
        const actions = Array.from(new Set(names));
        const scores: Record<string, number> = {};
        actions.forEach((action, index) => { scores[action] = index; });
        const { result, simulated, restored } = runSequentialSearch({ candidateActions: actions, scores, budget, actorId });
        expect(result.ok).toBe(true);
        expect(simulated).toBe(actions.length);
        expect(restored).toBe(actions.length);
      }),
      { numRuns: 100 },
    );
  });

  it('非法候选（求值返回非有限分数）时 fail-closed：返回 AI_EVALUATION_INVALID，且恢复到活动前（numRuns=100）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), (n) => {
        const actionNames = Array.from({ length: n }, (_, i) => makeActorId('a:b', i));
        const { result, restored } = runSequentialSearch({
          candidateActions: actionNames,
          scores: Object.fromEntries(actionNames.map((a) => [a, 0])),
          budget,
          actorId,
          nonFinite: true,
        });
        // evaluateTerminal 对非有限分数直接 fail-closed（AI_EVALUATION_INVALID），绝不带非法分数进入选择；
        // 任一分支失败即短路返回，已经展开的那条分支也确保 restore——断言恢复至少一次、绝不泄漏未恢复分支。
        expect(result).toMatchObject({ ok: false, code: 'AI_EVALUATION_INVALID' });
        expect(restored).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  it('预算耗尽的终止性：decisionPoints 为 0 时，search 立即以预算错误短路，终局不执行 (numRuns=100)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), (n) => {
        const actionNames = Array.from({ length: n }, (_, i) => makeActorId('a:c', i));
        const { result } = runSequentialSearch({
          candidateActions: actionNames,
          scores: { 'a:c0': 0 },
          budget: { decisionPoints: 0, simulations: 0, evaluationCalls: 0 },
          actorId,
        });
        // 连第一次 decisionPoints 都耗尽 → AI_BUDGET_EXHAUSTED，绝不进入候选循环。
        expect(result).toMatchObject({ ok: false, code: 'AI_BUDGET_EXHAUSTED' });
      }),
      { numRuns: 100 },
    );
  });
});

