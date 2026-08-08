/**
 * L3 Ops: 结构性 Op 的 Def 实例化前置校验（design.md 3.1节 / 需求3.5, 16.6）。
 *
 * 运行期严厉性缺口修补（记录于 决策与风险记录.md）：本次穷举复核发现，全部会创建带
 * `def: Id` 字段的运行时对象的 Op（entity/item/node/link.create、entity.setDef、
 * node.split、prefab.spawn、attach.add、intent.submit、schedule.advance、decision.open）
 * 里，存在性校验（E_REF_MISSING）与 kind 匹配校验（E_REF_KIND）覆盖不齐——部分 Op（如
 * entity.create/item.create/node.create/link.create/entity.setDef/node.split）此前对
 * `args.def` 零校验，直接把调用方传入的任意字符串写进结构区字段；而已经做了前两项校验的
 * Op（prefab.spawn/attach.add/intent.submit/schedule.advance/decision.open）里，没有一个
 * 检查 `abstract` 标记——需求3.5 明确要求"abstract 为真的 Def 不得被直接实例化"，这是一条
 * 与"存在性"、"kind 匹配"平级的第三维校验，此前完全没有被任何 Op 实现覆盖。
 *
 * 这正是"两种容忍度"边界的运行期一侧：装载期（DefRegistry.register/PlaypackLoader.load）
 * 允许前向引用、允许 abstract Def 存在（abstract Def 本身合法，只是不能被实例化）——但一旦
 * 装载完成、进入运行期，任何试图"实例化"一个 Def（entity.create 等）的调用，都必须同时满足
 * 存在×kind匹配×非abstract 三个条件，缺一不可，不打任何折扣。
 *
 * checkInstantiable 是这三维校验的唯一实现，全部会实例化 Def 的 Op 都必须调用它，
 * 不允许每个 Op 各自手写一份（这类重复正是此前"部分 Op 校验、部分 Op 不校验"不一致的根源）。
 */
import type { Id } from '../state/ids.js';
import type { Def, DefKind } from '../state/def.js';
import type { Result } from './result.js';
import { ok, err } from './result.js';

export type DefLookupFn = (id: Id) => Def | null;

/**
 * 校验某个 Def Id 是否可以被实例化为指定 kind 的运行时对象。
 * 三维穷举：不存在 -> E_REF_MISSING；存在但 kind 不匹配 -> E_REF_KIND；
 * 存在且 kind 匹配但 abstract:true -> E_REF_ABSTRACT；三者都通过才返回 ok。
 */
export function checkInstantiable(defLookup: DefLookupFn, id: Id, expectedKind: DefKind): Result<Def> {
  const def = defLookup(id);
  if (!def) return err('E_REF_MISSING', `Def ${id} 不存在`);
  if (def.kind !== expectedKind) return err('E_REF_KIND', `Def ${id} 的 kind 是 ${def.kind}，期望 ${expectedKind}`);
  if (def.abstract === true) return err('E_REF_ABSTRACT', `Def ${id} 标记为 abstract，不得被直接实例化`);
  return ok(def);
}
