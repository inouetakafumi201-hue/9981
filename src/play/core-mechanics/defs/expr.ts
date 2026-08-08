/**
 * 声明式 `Expr` / `Effect` 构造器（纯函数，产出的都是引擎层既有结构，不新增任何形态）。
 * 见 `ids.ts` 顶部的 DEVIATION-01 说明本文件为何存在。
 *
 * ## 一处必须遵守的引擎层事实（本模块存在的主要原因，不遵守会静默失效）
 *
 * `ExprEngine` 的**状态类算子**（`hasTag` / `hasAttachment` / `propOf` / `defOf` / `isA`、
 * 拓扑类、关系类、认知类）全部依赖 `EvalContext.stateAccess`。而玩法层实际求值的两个位置
 * 都**没有**提供它：
 *
 * | 求值位置 | 上下文来源（已核对源码） | 有 stateAccess？ |
 * |---|---|---|
 * | `ActionDef.require` | `decision/intent-ops.ts` 的 `evalRequire` → `makeDefaultEvalContext({self, vars, resolvePath, resolveRefValue})` | **无** |
 * | `Effect` / `RuleDef.when` | `flow/interpreter.ts` 的 `evalCtx` → `makeDefaultEvalContext({self, vars, resolvePath, defRegistry, resolveRefDefId, resolveRefValue, runQuery, runQueryValues})` | **无** |
 *
 * 缺失时这些算子一律返回 `null`/`false`（`ExprEngine` 保持全函数性，不抛异常）。后果是：
 * 写成 `{op:'not', args:[{op:'hasTag', args:[self, TAG]}]}` 的守卫会因为 `hasTag` 恒为 `false`
 * 而**恒为真**——即"带着零血倒地标记的玩家照样能攻击"，而且没有任何诊断。
 *
 * 因此本模块只使用两个位置都真实可用的通道：`{path}`、`{var}`、`refGet`，以及算术/比较/逻辑/
 * 表算子。`{q:...}` 只在 `Effect` 里使用（`require` 里没有 `runQuery`，用了会恒为 `null`）。
 */
import type { Expr } from '../../../core/kernel/state/expr-types.js';
import type { Effect } from '../../../core/kernel/events/effect-types.js';

// ---------------------------------------------------------------------------
// 基础形态
// ---------------------------------------------------------------------------

/** 变量引用（`self` / `agent` / `intent` / 动作绑定名 / `forEach` 的 `as` 名）。 */
export const varOf = (name: string): Expr => ({ var: name });

/** 从 `WorldState` 根出发的绝对路径读取；`self.` 前缀会回退为相对当前 `EvalContext.self`。 */
export const pathOf = (path: string): Expr => ({ path });

/** 当前行动者（`intent.submit` 与 `queryActions` 都把它绑定为 `self`）。 */
export const SELF: Expr = varOf('self');

/**
 * 读取一个 `Ref` 指向对象的相对字段。这是玩法层唯一可用的"读别人身上的东西"的通道。
 *
 * `path` 声明为 `Expr` 而不是 `string`：`op` 形态的 `args` 会被 `ExprEngine` 递归求值，
 * 因此第二个参数可以是 `concat` 拼出来的**动态路径**（见文件末尾的 `worldRead`）。
 * 传字符串字面量同样合法（字符串本身就是一个 `Expr`）。
 */
export const refGet = (ref: Expr, path: Expr): Expr => ({ op: 'refGet', args: [ref, path] });

// ---------------------------------------------------------------------------
// 逻辑与比较（全部为 `ExprEngine` 内置算子表中的名字，不新增算子）
// ---------------------------------------------------------------------------

export const and = (...args: Expr[]): Expr => ({ op: 'and', args });
export const or = (...args: Expr[]): Expr => ({ op: 'or', args });
export const not = (arg: Expr): Expr => ({ op: 'not', args: [arg] });
export const eq = (left: Expr, right: Expr): Expr => ({ op: 'eq', args: [left, right] });
export const neq = (left: Expr, right: Expr): Expr => ({ op: 'neq', args: [left, right] });
export const gt = (left: Expr, right: Expr): Expr => ({ op: 'gt', args: [left, right] });
export const gte = (left: Expr, right: Expr): Expr => ({ op: 'gte', args: [left, right] });
export const lt = (left: Expr, right: Expr): Expr => ({ op: 'lt', args: [left, right] });
export const lte = (left: Expr, right: Expr): Expr => ({ op: 'lte', args: [left, right] });
export const isNull = (arg: Expr): Expr => ({ op: 'isNull', args: [arg] });
export const notNull = (arg: Expr): Expr => not(isNull(arg));

// ---------------------------------------------------------------------------
// 算术与表
// ---------------------------------------------------------------------------

export const addNum = (left: Expr, right: Expr): Expr => ({ op: 'add', args: [left, right] });
export const subNum = (left: Expr, right: Expr): Expr => ({ op: 'sub', args: [left, right] });
export const mulNum = (left: Expr, right: Expr): Expr => ({ op: 'mul', args: [left, right] });
export const coalesce = (...args: Expr[]): Expr => ({ op: 'coalesce', args });
export const maxNum = (left: Expr, right: Expr): Expr => ({ op: 'max', args: [left, right] });
export const minNum = (left: Expr, right: Expr): Expr => ({ op: 'min', args: [left, right] });
export const clampNum = (value: Expr, low: Expr, high: Expr): Expr => ({ op: 'clamp', args: [value, low, high] });
export const lenOf = (list: Expr): Expr => ({ op: 'len', args: [list] });
export const atOf = (list: Expr, index: Expr): Expr => ({ op: 'at', args: [list, index] });
export const includesOf = (list: Expr, item: Expr): Expr => ({ op: 'includes', args: [list, item] });
export const getOf = (mapping: Expr, key: Expr): Expr => ({ op: 'get', args: [mapping, key] });
export const arrayOf = (...items: Expr[]): Expr => ({ op: 'array', args: items });
export const concatStr = (...parts: Expr[]): Expr => ({ op: 'concat', args: parts });

// ---------------------------------------------------------------------------
// 领域谓词（全部只用 refGet + 表/逻辑算子，因此在 require 与 effects 两处行为一致）
// ---------------------------------------------------------------------------

/**
 * 引用是否指向一个真实存在的对象。
 *
 * 失败关闭的必要性：`refGet` 对不存在的引用返回 `null`，而 `not(null)` 求值为 `true`。
 * 如果不先确认引用存在，"不带某标记"这类否定型守卫会对**已被销毁或从未存在的目标**放行。
 * 这里以 `def` 字段作为存在性探针：Entity / Item / Node / Link / Attachment 都有它。
 */
export const refExists = (ref: Expr): Expr => notNull(refGet(ref, 'def'));

/** 引用带有某个标记。`tags` 缺失时 `includes` 返回 `null`，整体判定为假（失败关闭）。 */
export const hasTag = (ref: Expr, tag: string): Expr => includesOf(refGet(ref, 'tags'), tag);

/**
 * 引用**不带**某个标记，且引用本身必须存在。
 * 缺少 `refExists` 这一半就是 design.md 11.6 描述的那类静默放行。
 */
export const lacksTag = (ref: Expr, tag: string): Expr => and(refExists(ref), not(hasTag(ref, tag)));

/** 读取引用对象 `props` 自由区的一个字段。 */
export const propOfRef = (ref: Expr, prop: string): Expr => refGet(ref, `props.${prop}`);

/**
 * 引用对象是否**存在**某个 `props` 字段（不是"值为真"）。
 *
 * 这是"字段缺失被当成 0"防护的判据（design.md 11.6）：`prop.add` 与 `freezeCost` 读到不存在的
 * 路径都会退化为 `0`，所以任何治疗/恢复效果都必须先用它确认字段真的在。
 */
export const hasProp = (ref: Expr, prop: string): Expr => notNull(propOfRef(ref, prop));

// ---------------------------------------------------------------------------
// 动态路径拼装（`prop.set` / `prop.del` / `prop.add` 的 `path` 参数是字符串）
// ---------------------------------------------------------------------------

/** `world.props.pools.<pool>.<actor>.<field>`（引擎层成本三态的既有布局，玩法层不改）。 */
export const poolFieldPath = (pool: string, actorId: Expr, field: 'available' | 'real'): Expr =>
  concatStr(`world.props.pools.${pool}.`, actorId, `.${field}`);

/** `entities.<id>.props.<prop>`。 */
export const entityPropPath = (entityId: Expr, prop: string): Expr =>
  concatStr('entities.', entityId, `.props.${prop}`);

/** `world.attachments.<id>.props.<prop>`（引擎层可写白名单里的真实前缀，见 ids.ts 的校正记录）。 */
export const attachmentPropPath = (attachmentId: Expr, prop: string): Expr =>
  concatStr('world.attachments.', attachmentId, `.props.${prop}`);

/**
 * 从一个 `Ref` 取出其裸 Id 字符串（`{$: 'e:1'}` → `'e:1'`），用于拼装路径与 Op 的 Id 参数。
 *
 * 必须用 `get` 而**不能**用 `refGet`：`refGet` 会先把 Ref**解引用**成它指向的对象，再在那个对象上
 * 读字段——而 Entity/Item/Node 对象上并没有名为 `$` 的字段，所以 `refGet(ref,'$')` 恒为 `null`。
 * `get` 是"读一个映射的键"，Ref 本身就是 `{$: id}` 这个映射，因此 `get(ref,'$')` 才是取 Id 的正确算子。
 */
export const refId = (ref: Expr): Expr => getOf(ref, '$');

// ---------------------------------------------------------------------------
// Effect 构造器（十形态之内，不新增形态）
// ---------------------------------------------------------------------------

export const opEffect = (op: string, args: Record<string, Expr>, result?: string): Effect =>
  result === undefined ? { op, args } : { op, args, result };

export const letEffect = (name: string, be: Expr): Effect => ({ let: name, be });

export const ifEffect = (condition: Expr, then: Effect[], otherwise?: Effect[]): Effect =>
  otherwise === undefined ? { if: condition, then } : { if: condition, then, else: otherwise };

export const forEachEffect = (list: Expr, as: string, body: Effect[]): Effect => ({ forEach: list, as, do: body });

export const emitEffect = (type: string, data?: Expr): Effect =>
  data === undefined ? { emit: type } : { emit: type, data };

export const abortEffect = (reason: string): Effect => ({ abort: reason });

/**
 * 守卫：条件不满足即 `abort`，使外层事务整体回滚（design.md 3.3、3.5 的"首条 Effect 为 if + abort"）。
 *
 * `then` 为空数组是刻意的：守卫只负责"不满足就停"，满足时不产生任何写入，后续效果按顺序继续。
 */
export const guardEffect = (condition: Expr, abortReason: string): Effect =>
  ifEffect(condition, [], [abortEffect(abortReason)]);

/**
 * 构造一个**会被求值**的映射（`emit` 的 data / 请求 payload）。
 *
 * 不能直接用对象字面量：`ExprEngine` 对普通对象字面量只做浅拷贝、**不递归求值**其成员
 * （见 `engine.ts` 的兜底分支）。因此这里用 `array` + `get` 的组合无法表达映射……
 * 实际上 `ExprEngine` 的对象兜底分支 `result[k] = (v as Value) ?? null` 会把成员原样当作 Value，
 * 而 `{var:'x'}` 这类成员会被当成**字面对象**保留，不求值。
 *
 * 结论（已核对）：**唯一**能得到"成员被求值的映射"的通道是先把映射写进 draft 的某个路径，再用
 * `{path}` 读回来。因此 `emit` 的 data 一律用 `pathOf(<请求记录根>)`，而不是内联映射。
 * 本函数因此**不构造内联映射**，而是要求调用方已经把字段写进了请求记录：它只是对
 * "读回整条请求记录"这一意图的一个具名封装，语义等价于 `pathOf(root)`。
 *
 * 为兼容早期只需要"带一个已求值 Ref 字段"的演出 emit，这里退化为读取调用方指定的单一路径。
 */
export const payloadMap = (fields: Record<string, Expr>): Expr => {
  const keys = Object.keys(fields);
  if (keys.length === 1) {
    const only = fields[keys[0] as string];
    if (only !== undefined) return only;
  }
  // 多字段映射必须走请求记录路径（见上）；这里不静默构造一个不会被求值的字面映射。
  throw new Error('payloadMap: 多字段 emit 必须先写入请求记录再用 pathOf 读取，不能内联构造映射');
};

// ---------------------------------------------------------------------------
// 动态目标打标记（见 ids.ts 的 DEVIATION-04）
// ---------------------------------------------------------------------------

/** `tag.add` / `tag.del` 支持的集合（引擎层 `TagArgs.ref.collection` 的封闭取值）。 */
export type TagCollection = 'entities' | 'items' | 'nodes' | 'links';

/**
 * 对一个**动态**引用打/去标记，展开为三条效果：写暂存区两字段 → 调 `tag.*` → 清暂存区。
 *
 * `idExpr` 必须求值为裸 Id 字符串（用 `refId(...)` 从 Ref 取 `$`）。
 */
export function tagEffects(
  mode: 'add' | 'del',
  collection: TagCollection,
  scratchPath: string,
  idExpr: Expr,
  tag: string,
): Effect[] {
  return [
    opEffect('prop.set', { path: `${scratchPath}.collection`, value: collection }),
    opEffect('prop.set', { path: `${scratchPath}.id`, value: idExpr }),
    opEffect(`tag.${mode}`, { ref: pathOf(scratchPath), tag }),
    opEffect('prop.del', { path: scratchPath }),
  ];
}

/**
 * 写一条请求记录字段。`path` 用静态字符串拼装（记录根固定），`value` 作为顶层参数被求值。
 */
export const setRequestField = (requestRoot: string, field: string, value: Expr): Effect =>
  opEffect('prop.set', { path: `${requestRoot}.${field}`, value });

/** 读一条请求记录字段（从当前 draft 现读，因此能看到 `modify` 阶段的改写）。 */
export const requestField = (requestRoot: string, field: string): Expr => pathOf(`${requestRoot}.${field}`);

/** 清空整条请求记录（发起方在事务末尾调用，避免请求记录残留到下一次事务）。 */
export const clearRequest = (requestRoot: string): Effect => opEffect('prop.del', { path: requestRoot });

/**
 * `emit` 之后紧跟的否决守卫（见 ids.ts 的 DEVIATION-03）。
 * `before` 阶段规则写入 `veto` 字段即可让整个动作事务回滚。
 */
export const vetoGuard = (requestRoot: string, vetoField: string, abortReason: string): Effect =>
  guardEffect(isNull(requestField(requestRoot, vetoField)), abortReason);

// ---------------------------------------------------------------------------
// 动态路径**读取**（这是唯一可行的通道，理由见下）
// ---------------------------------------------------------------------------

/**
 * `world` 的引用。`FlowInterpreter.resolveRefObject` 对 `{$: 'w:0'}` 特判为 `state.world`。
 */
export const WORLD_REF: Expr = { $: 'w:0' };

/**
 * 读一个**运行期才能算出路径**的世界状态字段。
 *
 * 为什么必须走 `refGet` 而不是 `{path}`：`{path}` 的路径是**字面字符串**，`ExprEngine` 不会对它
 * 求值，因此无法表达"读 `world.props.pools.ap.<当前候选的 id>.available`"。而 `refGet` 是
 * `{op:'refGet', args:[ref, pathExpr]}`——`op` 形态的 `args` 会被递归求值，所以第二个参数可以是
 * `concat` 拼出来的动态路径。
 *
 * **可用范围限制（已核对源码，不遵守会静默返回 null）**：`resolveRefValue` 的实现按调用点不同
 * 而不同：
 * - `flow/interpreter.ts` 的 `resolveRefObject` **包含** `w:0 → state.world` 的特判 → 可用；
 * - `decision/intent-ops.ts` 的 `evalRequire` 与 `testing/full-harness.ts` 的 `ctxForSelf`
 *   **都不包含** `w:0` 分支 → 在 `ActionDef.require` 里恒为 `null`。
 *
 * 因此本函数只能用于 `Effect` / `RuleDef` / `Query` 内部，**不得**用于 `ActionDef.require`。
 */
export const worldRead = (relativePath: Expr): Expr => refGet(WORLD_REF, relativePath);

/** 读某个行动者的资源池字段（动态路径，只能在效果/查询里用）。 */
export const poolFieldRead = (pool: string, actorId: Expr, field: 'available' | 'real'): Expr =>
  worldRead(concatStr(`props.pools.${pool}.`, actorId, `.${field}`));

/** Query 的 `where` / `orderBy` 里指代**当前候选**的字段（`EvalContext.self` 为候选）。 */
export const candidateField = (relativePath: string): Expr => pathOf(`self.${relativePath}`);

/** Query 的 `where` / `orderBy` 里指代当前候选的 `props` 字段。 */
export const candidateProp = (prop: string): Expr => candidateField(`props.${prop}`);
