/**
 * 一局可声明结局种类（CEME C-1 / C-5）。
 *
 * 引擎层 `outcome.reach` 只记录事实；本文件声明玩法层消费的非空守恒集。
 * `when` 一律纯读 Expr（{path}/{q}/逻辑比较，不含随机或写入 Op）。
 * `ends:true` 的条目由 `rules.match.ts` 写入终局判定。
 *
 * 具体模式的胜负平衡数值不在此默认化（Requirement 20.13 / 21.4）。
 */
import type { OutcomeDef } from '../../../core/kernel/schedule/playpack';
import { and, eq, gt, includesOf, isNull, lenOf, not, notNull, or, pathOf } from './expr';
import {
  PATH_MATCH_ENDED,
  PATH_ROUND,
  PATH_SPAWN_COMPLETE,
  PROP_VITALITY,
  TAG_DOWNED_ZERO,
  TAG_PERMANENT_EXIT,
  TAG_ROLL_PARTICIPANT,
} from './ids';

/** 仍具备投点资格、仍存活、未永久退出的参与者。 */
const LIVING_PARTICIPANT_WHERE = and(
  includesOf(pathOf('self.tags'), TAG_ROLL_PARTICIPANT),
  notNull(pathOf(`self.props.${PROP_VITALITY}`)),
  not(includesOf(pathOf('self.tags'), TAG_PERMANENT_EXIT)),
);

const LIVING_PARTICIPANTS = {
  q: { from: 'entities' as const, where: LIVING_PARTICIPANT_WHERE },
};

const ELIMINATED_ENTITIES = {
  q: {
    from: 'entities' as const,
    where: or(
      includesOf(pathOf('self.tags'), TAG_PERMANENT_EXIT),
      includesOf(pathOf('self.tags'), TAG_DOWNED_ZERO),
    ),
  },
};

/**
 * 一局级终局：出生已完成，且已有人被淘汰（永久退出或零血倒地），
 * 场上恰好只剩 1 名仍存活的投点参与者。
 *
 * 单人开局不会在出生当下误触（必须先出现淘汰者）。
 */
const lastStandingWhen = and(
  eq(pathOf(PATH_SPAWN_COMPLETE), true),
  eq(lenOf(LIVING_PARTICIPANTS), 1),
  gt(lenOf(ELIMINATED_ENTITIES), 0),
);

/**
 * 核心机制玩法包声明的结局种类守恒集。
 *
 * - `last-standing`：一局级终局（ends:true）。when 由运行期胜负评估消费。
 * - `round-checkpoint`：进程中记录点（ends:false），不触发挥局判定。
 */
export const CORE_OUTCOMES: readonly OutcomeDef[] = [
  {
    name: 'last-standing',
    when: lastStandingWhen,
    scope: 'game',
    rank: 2,
    ends: true,
  },
  {
    name: 'round-checkpoint',
    when: and(
      notNull(pathOf(PATH_ROUND)),
      gt(pathOf(PATH_ROUND), 0),
      or(isNull(pathOf(PATH_MATCH_ENDED)), eq(pathOf(PATH_MATCH_ENDED), false)),
    ),
    scope: 'game',
    rank: 1,
    ends: false,
  },
];

/** 终局级结局名集合（ends:true），供胜负评估与契约测试使用。 */
export const TERMINAL_OUTCOME_NAMES: readonly string[] = CORE_OUTCOMES
  .filter((outcome) => outcome.ends)
  .map((outcome) => outcome.name);

/** 按声明顺序的 rank 降序：同 scope 内更高 rank 优先，相等时取先声明者。 */
export const CORE_OUTCOMES_BY_PRECEDENCE: readonly OutcomeDef[] = [...CORE_OUTCOMES]
  .sort((left, right) => {
    const leftRank = typeof left.rank === 'number' ? left.rank : 0;
    const rightRank = typeof right.rank === 'number' ? right.rank : 0;
    if (leftRank !== rightRank) return rightRank - leftRank;
    return CORE_OUTCOMES.indexOf(left) - CORE_OUTCOMES.indexOf(right);
  });
