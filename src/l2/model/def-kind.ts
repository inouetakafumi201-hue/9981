/**
 * L2 Model: 合法 L1 Def kind 与 L1 独占机制清单。
 *
 * Def kind 清单来自 requirements.md Glossary：
 * entity、item、node、link、attachment、action、rule、playpack、decision、prefab、expr、schedule、policy。
 * 每个 L2 基类与可复用实例必须映射到其中恰好一个（Requirements 2.2、4.1）。
 */

export const L1_DEF_KINDS = [
  'entity',
  'item',
  'node',
  'link',
  'attachment',
  'action',
  'rule',
  'playpack',
  'decision',
  'prefab',
  'expr',
  'schedule',
  'policy',
] as const;

export type L1DefKind = (typeof L1_DEF_KINDS)[number];

export function isL1DefKind(value: unknown): value is L1DefKind {
  return typeof value === 'string' && (L1_DEF_KINDS as readonly string[]).includes(value);
}

/** Def kind 的规范化排序序数（按清单声明顺序，保证输出确定性）。 */
export function defKindRank(kind: L1DefKind): number {
  const index = L1_DEF_KINDS.indexOf(kind);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * L1 独占机制（Requirements 2.3）。
 * L2 定义一旦声明要引入/重定义这些机制，返回 `LAYER_L1_OWNERSHIP`。
 */
export const L1_EXCLUSIVE_MECHANISMS = [
  'ref-prefix',
  'transaction-model',
  'op-dispatch',
  'expr-evaluator',
  'hook-scheduler',
  'persistence',
  'random-stream',
  'search-algorithm',
  'transaction-safe-simulation',
] as const;

export type L1ExclusiveMechanism = (typeof L1_EXCLUSIVE_MECHANISMS)[number];

export function isL1ExclusiveMechanism(value: unknown): value is L1ExclusiveMechanism {
  return typeof value === 'string' && (L1_EXCLUSIVE_MECHANISMS as readonly string[]).includes(value);
}

/**
 * L1 独占机制在 JSON 中的常见声明键名。
 * 候选定义若在顶层出现这些键，即视为试图重定义 L1 机制。
 */
export const L1_MECHANISM_DECLARATION_KEYS: ReadonlyMap<string, L1ExclusiveMechanism> = Object.freeze(
  new Map<string, L1ExclusiveMechanism>([
    ['refPrefix', 'ref-prefix'],
    ['refPrefixes', 'ref-prefix'],
    ['transactionModel', 'transaction-model'],
    ['transaction', 'transaction-model'],
    ['opDispatch', 'op-dispatch'],
    ['opRegistry', 'op-dispatch'],
    ['exprEvaluator', 'expr-evaluator'],
    ['exprEngine', 'expr-evaluator'],
    ['hookScheduler', 'hook-scheduler'],
    ['hookDispatcher', 'hook-scheduler'],
    ['persistence', 'persistence'],
    ['snapshotEngine', 'persistence'],
    ['randomStream', 'random-stream'],
    ['searchAlgorithm', 'search-algorithm'],
    ['simulation', 'transaction-safe-simulation'],
  ]),
);
