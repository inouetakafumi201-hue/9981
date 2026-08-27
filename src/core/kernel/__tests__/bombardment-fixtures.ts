/**
 * Feature: wakeup-engine-bombardment
 * 公用测试夹具：扩展脏输入集 + 原子性/Result 断言助手。
 *
 * 供属性 1/2/2b/3/10 复用。继承 cross-layer-regression 的 GARGE 思想并扩展，
 * 覆盖 requirements 10.2 列出的全部脏输入类别。
 */
import type { OpRegistry } from '../ops/registry';
import type { WorldStateHolder } from '../ops/transaction';

/**
 * 在 cross-layer-regression GARBAGE_ARGS 的 23 类基础上扩展：
 * 原型键、非有限数、深度嵌套、跨集合 ref 混用、不可实例化抽象 Def、未知方向、
 * 非有限 sides、缺失字段、非法索引数组。
 */
export const GARBAGE_ARGS_EXT: unknown[] = [
  // ---- 既有 23 类（cross-layer-regression）----
  undefined,
  null,
  {},
  [],
  0,
  '',
  'not-an-object',
  true,
  { def: 'nonexistent:def' },
  { id: 'e:does-not-exist' },
  { path: 'entities.e:missing.props.hp', value: 1 },
  { path: 'defs.d:human.kind', value: 'hacked' },
  { path: '', value: null },
  { ref: { collection: 'entities', id: 'e:missing' }, tag: 't' },
  { items: [] },
  { sides: 0 },
  { sides: -1 },
  { sides: 1.5 },
  { target: { $: 'e:missing' }, def: 'd:buff' },
  { from: null, to: undefined },
  { a: 'x', b: 'y' },
  { index: -1, path: 'world.props.list' },

  // ---- 新增脏输入类别（requirements 10.2）----
  // 原型污染键直写
  { ['__proto__']: { polluted: true } },
  { ['constructor']: 'hacked' },
  { ['prototype']: { polluted: true } },
  // 深度嵌套对象
  { path: 'world.props.deep', value: deepNest(60) },
  // 非有限数值
  { path: 'world.props.nan', value: Number.NaN },
  { path: 'world.props.inf', value: Number.POSITIVE_INFINITY },
  { sides: Number.POSITIVE_INFINITY },
  { sides: Number.NaN },
  // 跨集合类型混用：把 item id 当 entity、把 node id 当 item 等
  { id: 'i:cross-collection', path: 'entities.i:cross-collection.props.hp', value: 1 },
  { itemId: 'e:cross-collection' },
  // 不可实例化抽象 Def（exists in defaultSeedDefs）
  { def: 'd:abstract_entity' },
  { def: 'd:abstract_item' },
  // 未知方向 token / 合法方向 token
  { direction: 'sideways', directed: true },
  { direction: 'one-way-down' },
  { direction: 'one-way-up' },
  { weight: Number.POSITIVE_INFINITY },
  { weight: -5 },
  // 当某 Op 用数组下标当参数时塞非法下标
  { atSlot: 999999 },
  { atSlot: -999999 },
  { index: 999999 },
  // 未知 Op 名 / 未知 effect / 空 defs
  { op: 'no.such.op', def: 'd:human' },
  { defs: [] },
  { manifests: new Map() },
  // 环形 ref（自引用）
  { self: { $: 'e:self-cycle' } },
  // 畸形 Link 定义
  { a: 'n:x', b: 'n:y', direction: 'bidirectional', weight: 0 },
];

function deepNest(depth: number): unknown {
  let value: unknown = 1;
  for (let i = 0; i < depth; i++) value = { child: value };
  return value;
}

/** 断言一次 Op 调用满足「不抛 / ok 为 boolean / 失败带 string code」，并返回 result。 */
export function assertOpResult(result: unknown, op: string, args: unknown): { ok: boolean; code?: string } {
  if (result === undefined || result === null) {
    throw new Error(`Op ${op} 未返回 Result。args: ${safePrint(args)}`);
  }
  const r = result as { ok: unknown };
  if (typeof r.ok !== 'boolean') {
    throw new Error(`Op ${op} 的 Result.ok 不是 boolean。args: ${safePrint(args)}`);
  }
  if (!r.ok && typeof (r as { code?: unknown }).code !== 'string') {
    throw new Error(`Op ${op} 失败但缺少 string code。args: ${safePrint(args)}`);
  }
  return { ok: r.ok, code: (r as { code?: string }).code };
}

/** 断言失败时 holder 持有的状态引用与调用前逐字节引用相等。 */
export function assertFailureAtomic(
  holder: WorldStateHolder,
  before: unknown,
  op: string,
  args: unknown,
  r: { ok: boolean },
): void {
  if (!r.ok) {
    if (holder.getState() !== before) {
      throw new Error(`Op ${op} 失败却改变了状态引用（非原子）。args: ${safePrint(args)}`);
    }
  }
}

/** 遍历全 Op × GARBAGE_ARGS_EXT，每次调用断言不抛 / 合法 Result，返回「非零失败 Op×args」计数。 */
export function sweepAllOps(registry: OpRegistry, holder: WorldStateHolder): number {
  const opNames = registry.listOpNames();
  if (opNames.length === 0) throw new Error('harness 未注册任何 Op');
  let failures = 0;
  for (const name of opNames) {
    for (const args of GARBAGE_ARGS_EXT) {
      const before = holder.getState();
      let result: unknown;
      try {
        result = (registry.invoke as (op: string, args: unknown) => unknown)(name, args);
      } catch (e) {
        throw new Error(`Op ${name} 对垃圾参数抛未捕获异常: ${(e as Error).message}. args: ${safePrint(args)}`);
      }
      const r = assertOpResult(result as unknown as string, name, args);
      assertFailureAtomic(holder, before, name, args, r);
      if (!r.ok) failures++;
    }
  }
  return failures;
}

function safePrint(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
