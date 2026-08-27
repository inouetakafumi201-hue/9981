/**
 * 一局终局 / 回绕 / 出生 / 过载规则（CEME C-1/C-3/C-5/C-7）。
 *
 * 不改写 `rules.phase.ts`：本文件是新增声明式规则，由 playpack 组装挂进同一 Hook 管道。
 * 终局写入不挂 `after:outcome.reach`（after 阶段写入会被 HookDispatcher 回滚），
 * 而是消费 `play.outcome.reached` 的 default 阶段。
 */
import type { RuleDef } from '../../../core/kernel/events/types';
import { playRule, RULE_OWNERSHIP_RULES } from './rules.damage';
import { internalMetric } from '../ownership';
import {
  and,
  concatStr,
  eq,
  getOf,
  gt,
  ifEffect,
  includesOf,
  isNull,
  lenOf,
  letEffect,
  not,
  notNull,
  opEffect,
  or,
  pathOf,
  propOfRef,
  refGet,
  refId,
  varOf,
} from './expr';
import {
  ATT_OVERLOADED,
  EVENT_OUTCOME_REACHED,
  EVENT_OVERLOAD_APPLY,
  EVENT_OVERLOAD_TICK,
  EVENT_ROUND_INCREMENT,
  EVENT_SPAWN_REQUEST,
  PATH_MATCH_END_DETAIL,
  PATH_MATCH_ENDED,
  PATH_ROUND,
  PATH_SPAWN_COMPLETE,
  PROP_OVERLOAD_REJOIN,
  RULE_OUTCOME_TERMINAL,
  RULE_OVERLOAD_APPLY,
  RULE_OVERLOAD_BLOCK_INTENT,
  RULE_OVERLOAD_TICK,
  RULE_ROUND_INCREMENT,
  RULE_SPAWN_DEFAULT,
  TAG_OVERLOADED,
} from './ids';

const MATCH_OWNERSHIP_RULES = [
  ...RULE_OWNERSHIP_RULES,
  {
    pathSuffix: 'args.value',
    whenValue: (value: number) => value === 1 || value === 2,
    ownership: internalMetric('round 初值 / 过载归队计数：Internal_Metric，投影禁止展示。'),
  },
  {
    pathSuffix: 'args.delta',
    whenValue: (value: number) => value === 1 || value === -1,
    ownership: internalMetric('round +1 / 过载归队 -1：Internal_Metric，投影禁止展示。'),
  },
];

/**
 * play.outcome.reached：只在 ends:true 且尚未终局时写 matchEnded + matchEnd 详情。
 * 装载入口与 match-lifecycle.recordOutcome 走同一语义的 invoke 写入；本规则供声明式事件链复用。
 */
export const outcomeTerminalRule: RuleDef = playRule({
  id: RULE_OUTCOME_TERMINAL,
  on: EVENT_OUTCOME_REACHED,
  phase: 'default',
  priority: 100,
  when: and(
    eq(getOf(varOf('payload'), 'ends'), true),
    or(isNull(pathOf(PATH_MATCH_ENDED)), eq(pathOf(PATH_MATCH_ENDED), false)),
  ),
  effects: [
    opEffect('prop.set', { path: PATH_MATCH_ENDED, value: true }),
    opEffect('prop.set', { path: `${PATH_MATCH_END_DETAIL}.outcome`, value: getOf(varOf('payload'), 'outcomeName') }),
    opEffect('prop.set', { path: `${PATH_MATCH_END_DETAIL}.scope`, value: getOf(varOf('payload'), 'scope') }),
    opEffect('prop.set', { path: `${PATH_MATCH_END_DETAIL}.rank`, value: getOf(varOf('payload'), 'rank') }),
  ],
  sourceTrace: ['Req 20.6', 'Req 23.4', 'Req 26.2', 'S3 C-1', 'S3 C-5'],
  ownershipRules: MATCH_OWNERSHIP_RULES,
});

/**
 * 回绕计数：cleanup→roll 由 ScheduleDef.roundEnd 发出本事件。
 */
export const roundIncrementRule: RuleDef = playRule({
  id: RULE_ROUND_INCREMENT,
  on: EVENT_ROUND_INCREMENT,
  phase: 'default',
  priority: 100,
  effects: [
    ifEffect(
      isNull(pathOf(PATH_ROUND)),
      [opEffect('prop.set', { path: PATH_ROUND, value: 1 })],
      [opEffect('prop.add', { path: PATH_ROUND, delta: 1 })],
    ),
  ],
  sourceTrace: ['Req 23.1', 'Req 23.9', 'S3 C-3'],
  ownershipRules: MATCH_OWNERSHIP_RULES,
});

/**
 * 出生请求的声明式回声：装载入口 `assembleMatchStart` 是权威写入；
 * 本规则只在已完成出生后把 spawnComplete 保持为 true（幂等）。
 */
export const spawnDefaultRule: RuleDef = playRule({
  id: RULE_SPAWN_DEFAULT,
  on: EVENT_SPAWN_REQUEST,
  phase: 'default',
  priority: 100,
  effects: [
    ifEffect(
      eq(pathOf(PATH_SPAWN_COMPLETE), true),
      [],
      [opEffect('prop.set', { path: PATH_SPAWN_COMPLETE, value: true })],
    ),
  ],
  sourceTrace: ['Req 25.1', 'Req 25.5', 'S3 C-4'],
  ownershipRules: MATCH_OWNERSHIP_RULES,
});

const overloadTarget = getOf(varOf('payload'), 'target');

/**
 * 过载施加：体力超上限的权威路径（D-055）。清理自然恢复不走本事件。
 * path 参数由 Flow 求值（concat），不是 {path} 节点。
 */
export const overloadApplyRule: RuleDef = playRule({
  id: RULE_OVERLOAD_APPLY,
  on: EVENT_OVERLOAD_APPLY,
  phase: 'default',
  priority: 100,
  when: notNull(overloadTarget),
  effects: [
    opEffect('attach.add', {
      def: ATT_OVERLOADED,
      target: overloadTarget,
    }),
    opEffect('prop.set', {
      path: concatStr('entities.', refId(overloadTarget), `.props.${PROP_OVERLOAD_REJOIN}`),
      value: 2,
    }),
  ],
  sourceTrace: ['Req 28.1', 'Req 6.16', 'Req 6.18', 'D-055', 'S3 C-7'],
  ownershipRules: MATCH_OWNERSHIP_RULES,
});

/**
 * 过载拦截主动动作：过载期间 intent.submit 一律结构化拒绝。
 * payload.agent 是裸 Id 字符串；用查询读 tags，避免 {path: concat} 静默失效。
 */
export const overloadBlockIntentRule: RuleDef = playRule({
  id: RULE_OVERLOAD_BLOCK_INTENT,
  on: 'before:intent.submit',
  phase: 'before',
  priority: 50,
  when: and(
    notNull(getOf(varOf('payload'), 'agent')),
    gt(
      lenOf({
        q: {
          from: 'entities',
          where: and(
            eq(pathOf('self.id'), getOf(varOf('payload'), 'agent')),
            includesOf(pathOf('self.tags'), TAG_OVERLOADED),
          ),
        },
      }),
      0,
    ),
  ),
  effects: [
    { abort: '过载期间不得提交主动动作（Requirement 6.20 / D-055）。' },
  ],
  sourceTrace: ['Req 28.3', 'Req 6.20', 'D-055', 'S3 C-7'],
  ownershipRules: MATCH_OWNERSHIP_RULES,
});

/**
 * 过载归队计数推进：投点阶段发出 play.overload.tick 后减 1；减到 0 时移除过载附件。
 * 动态字段读走 refGet（{path} 只接受字面字符串）。
 */
export const overloadTickRule: RuleDef = playRule({
  id: RULE_OVERLOAD_TICK,
  on: EVENT_OVERLOAD_TICK,
  phase: 'default',
  priority: 100,
  when: notNull(overloadTarget),
  effects: [
    letEffect('ovTarget', overloadTarget),
    opEffect('prop.add', {
      path: concatStr('entities.', refId(varOf('ovTarget')), `.props.${PROP_OVERLOAD_REJOIN}`),
      delta: -1,
    }),
    ifEffect(
      or(
        isNull(propOfRef(varOf('ovTarget'), PROP_OVERLOAD_REJOIN)),
        not(gt(propOfRef(varOf('ovTarget'), PROP_OVERLOAD_REJOIN), 0)),
      ),
      [
        opEffect('attach.del', {
          def: ATT_OVERLOADED,
          target: varOf('ovTarget'),
        }),
        opEffect('prop.del', {
          path: concatStr('entities.', refId(varOf('ovTarget')), `.props.${PROP_OVERLOAD_REJOIN}`),
        }),
      ],
      [],
    ),
  ],
  sourceTrace: ['Req 28.3', 'Req 6.18', 'D-055', 'S3 C-7'],
  ownershipRules: MATCH_OWNERSHIP_RULES,
});

export const CORE_MATCH_RULES: readonly RuleDef[] = [
  outcomeTerminalRule,
  roundIncrementRule,
  spawnDefaultRule,
  overloadApplyRule,
  overloadBlockIntentRule,
  overloadTickRule,
];
