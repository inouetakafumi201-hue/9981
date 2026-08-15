/**
 * L2 Expr: ExprEngine 表达式求值器（design.md 3.3节 / 需求12.1-12.8）。
 * 全函数：任意输入返回值或 null，永不抛异常。内置算子表是冻结的封闭集合，运行期不可扩展。
 */
import type { Value } from '../state/value.js';
import { isFiniteNumber } from '../state/value.js';
import type { Ref } from '../state/ids.js';
import { isRef } from '../state/ids.js';
import type { Expr, Query } from '../state/expr-types.js';
import type { DefRegistry } from '../state/def.js';
import type { ExprStateAccess, TopologyOpOpts } from './state-access.js';
import { asRef } from './state-access.js';
import { hasTag as hasTagPure } from '../state/tag.js';

export interface EvalContext {
  self?: Ref;
  vars: Record<string, Value>;
  budget: { depth: number; maxDepth: number };
  /** 路径寻址的读取根：由调用方（L3 Op 层）提供，ExprEngine 本身不持有 WorldState。 */
  resolvePath: (path: string) => Value | null;
  /** 具名表达式解析：由调用方提供 body 查找与递归求值入口，允许注入 overrides（需求13.5）。 */
  resolveNamedExpr?: (id: string) => { params?: string[]; body: Expr } | null;
  /** isA 判定：委托给 DefRegistry.defIsA，需要先从 ref 读出 def 字段。 */
  defRegistry?: DefRegistry;
  /** 读出某个 Ref 指向对象的 def 字段，供 isA 使用。 */
  resolveRefDefId?: (ref: Ref) => string | null;
  /** 读取 Ref 指向对象的相对字段，供通用 refGet 表达式算子使用。 */
  resolveRefValue?: (ref: Ref, path: string) => Value | null;
  /** Query 执行委托：由 L2 QueryEngine 提供（Expr 的 {q:...} 形态需要跑一次查询）。 */
  runQuery?: (q: Query, ctx: EvalContext) => Ref[];
  /**
   * 放宽返回类型的 Query 执行委托（QueryEngine.runValues）。存在的唯一原因是 from:'log'：
   * 日志条目不是 Ref 可寻址对象（需求1.2 的封闭前缀集合里没有日志前缀），因此无法经由
   * 返回 Ref[] 的 runQuery 通道返回。设置了它时 {q:...} 一律走它。
   */
  runQueryValues?: (q: Query, ctx: EvalContext) => Value[];
  /**
   * 拓扑/状态/关系/认知四类算子的只读状态访问面（design.md 3.3节算子表）。
   * 缺失时这些算子一律返回 null，不抛异常——保持 Expr 的全函数性（需求12.1）。
   */
  stateAccess?: ExprStateAccess;
}

export type ExprOpImpl = (args: Value[], ctx: EvalContext) => Value | null;

const RANDOM_OP_NAMES = new Set(['roll', 'pick', 'shuffle', 'weightedPick']);

interface ObjectWithKeys { readonly [K: string]: unknown }
function isExprLeafObject(v: unknown): v is object {
  if (v === null || typeof v !== 'object') return false;
  if (isRef(v)) return false; // Ref 是不可拆分的原子值，按值保留
  // 形如 {var}/{op}/{path}/{q}/{call}（可含任意附加键）的对象视为 Expr 节点，需递归求值
  const keys = Object.keys(v as ObjectWithKeys);
  return keys.some((k) => k === 'var' || k === 'op' || k === 'path' || k === 'q' || k === 'call');
}

function num(v: Value | null): number | null {
  return typeof v === 'number' && isFiniteNumber(v) ? v : null;
}

function bool(v: Value | null): boolean {
  return v === true;
}

/** 内置算子表：不可变、构造时冻结，不含随机类算子（需求12.5, 12.8）。 */
function buildBuiltinOps(): Readonly<Record<string, ExprOpImpl>> {
  const ops: Record<string, ExprOpImpl> = {
    // 算术
    add: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      return x === null || y === null ? null : x + y;
    },
    sub: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      return x === null || y === null ? null : x - y;
    },
    mul: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      return x === null || y === null ? null : x * y;
    },
    div: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      if (x === null || y === null || y === 0) return null; // 除零返回 null（需求12.4）
      return x / y;
    },
    mod: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      if (x === null || y === null || y === 0) return null;
      return x % y;
    },
    neg: (a) => {
      const x = num(a[0] ?? null);
      return x === null ? null : -x;
    },
    min: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      return x === null || y === null ? null : Math.min(x, y);
    },
    max: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      return x === null || y === null ? null : Math.max(x, y);
    },
    clamp: (a) => {
      const x = num(a[0] ?? null);
      const lo = num(a[1] ?? null);
      const hi = num(a[2] ?? null);
      if (x === null || lo === null || hi === null) return null;
      return Math.min(Math.max(x, lo), hi);
    },
    floor: (a) => {
      const x = num(a[0] ?? null);
      return x === null ? null : Math.floor(x);
    },
    ceil: (a) => {
      const x = num(a[0] ?? null);
      return x === null ? null : Math.ceil(x);
    },
    round: (a) => {
      const x = num(a[0] ?? null);
      return x === null ? null : Math.round(x);
    },
    abs: (a) => {
      const x = num(a[0] ?? null);
      return x === null ? null : Math.abs(x);
    },
    // 比较
    eq: (a) => valueEquals(a[0] ?? null, a[1] ?? null),
    neq: (a) => !valueEquals(a[0] ?? null, a[1] ?? null),
    lt: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      return x === null || y === null ? null : x < y;
    },
    lte: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      return x === null || y === null ? null : x <= y;
    },
    gt: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      return x === null || y === null ? null : x > y;
    },
    gte: (a) => {
      const x = num(a[0] ?? null);
      const y = num(a[1] ?? null);
      return x === null || y === null ? null : x >= y;
    },
    // 逻辑
    and: (a) => a.every((v) => bool(v)),
    or: (a) => a.some((v) => bool(v)),
    not: (a) => !bool(a[0] ?? null),
    // 空值
    isNull: (a) => (a[0] ?? null) === null,
    coalesce: (a) => {
      for (const v of a) if (v !== null) return v;
      return null;
    },
    // 字符串
    concat: (a) => a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(''),
    strLen: (a) => (typeof a[0] === 'string' ? a[0].length : null),
    // 表
    len: (a) => (Array.isArray(a[0]) ? a[0].length : null),
    at: (a) => {
      const arr = a[0];
      const idx = num(a[1] ?? null);
      if (!Array.isArray(arr) || idx === null) return null;
      return idx >= 0 && idx < arr.length ? (arr[idx] as Value) : null;
    },
    includes: (a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return null;
      return arr.some((item) => valueEquals(item as Value, a[1] ?? null));
    },
    indexOf: (a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return null;
      return arr.findIndex((item) => valueEquals(item as Value, a[1] ?? null));
    },
    get: (a) => {
      const source = a[0];
      const key = a[1];
      if (source === null || typeof source !== 'object' || Array.isArray(source)) return null;
      if (typeof key !== 'string') return null;
      return (source as Record<string, Value>)[key] ?? null;
    },
    refGet: (a, ctx) => {
      const reference = a[0];
      const path = a[1];
      if (!isRef(reference) || typeof path !== 'string' || !ctx.resolveRefValue) return null;
      return ctx.resolveRefValue(reference, path);
    },
    array: (a) => a,
    slice: (a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return null;
      const start = num(a[1] ?? null);
      if (start === null) return null;
      const hasEnd = a[2] !== undefined && a[2] !== null;
      if (!hasEnd) return arr.slice(start) as Value;
      const end = num(a[2] ?? null);
      if (end === null) return null;
      return arr.slice(start, end) as Value;
    },
    // `contains` 是源设计稿算子表里的名字，`includes` 是本实现早前采用的名字。两个名字保留为
    // 同义算子而不是二选一：改名会静默失效已经写好的玩法包表达式，而多一个别名没有语义风险。
    contains: (a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return null;
      return arr.some((item) => valueEquals(item as Value, a[1] ?? null));
    },
    sort: (a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return null;
      return [...(arr as Value[])].sort(compareValues) as Value;
    },
    reverse: (a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return null;
      return [...(arr as Value[])].reverse() as Value;
    },
    sum: (a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return null;
      let total = 0;
      for (const item of arr as Value[]) {
        const value = num(item);
        if (value === null) return null; // 非数元素让整体求和无意义，返回 null 而不是静默跳过
        total += value;
      }
      return total;
    },
    // any/all 是"表元素真值归约"，不是接受谓词的高阶算子：Expr 的六种形态（需求12.2）里没有
    // 函数字面量，需求22.3 也明确禁止闭包，所以无法把谓词作为参数传进来。需要"按谓词筛选"时，
    // 正确手法是用 Query 的 where 字段（{q:{from:...,where:...}}），那才是内核给定的筛选通道。
    // 同理，源设计稿算子表里的 map/filter 在无闭包的 Expr 里无法表达，本实现刻意不提供。
    any: (a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return null;
      return (arr as Value[]).some((item) => bool(item));
    },
    all: (a) => {
      const arr = a[0];
      if (!Array.isArray(arr)) return null;
      return (arr as Value[]).every((item) => bool(item));
    },

    // ---- 状态类（design.md 3.3节算子表）----
    // hasTag 同时接受 Ref 与内联对象：Ref 走 stateAccess 解析当前状态里的 tags，内联对象直接读
    // 自身 tags 字段。保留后者是因为 Def.slots[].accepts 这类谓词求值时拿到的是候选对象快照本身，
    // 那时还没有一个可寻址的 Ref。
    hasTag: (a, ctx) => {
      const subject = a[0];
      const tag = a[1];
      if (typeof tag !== 'string') return false;
      const ref = asRef(subject);
      if (ref) return ctx.stateAccess ? ctx.stateAccess.tagsOf(ref).includes(tag) : false;
      // 内联对象分支复用 L1 的唯一真相源 hasTag，不在此重写一份数组包含判定。
      if (subject === null || typeof subject !== 'object' || Array.isArray(subject)) return false;
      return hasTagPure(subject as { tags?: string[] }, tag);
    },
    hasAttachment: (a, ctx) => {
      const ref = asRef(a[0]);
      const defId = a[1];
      if (!ref || typeof defId !== 'string' || !ctx.stateAccess) return false;
      return ctx.stateAccess.activeAttachmentsOf(ref).some((attachment) => attachment.def === defId);
    },
    attachCount: (a, ctx) => {
      const ref = asRef(a[0]);
      const defId = a[1];
      if (!ref || !ctx.stateAccess) return null;
      const active = ctx.stateAccess.activeAttachmentsOf(ref);
      // 不传 defId 时统计全部已生效 Attachment 条数；传了则累加该 def 的 stack 层数
      // （stack:'count' 策略下一条 Attachment 可代表多层，条数与层数不是同一个问题）。
      if (typeof defId !== 'string') return active.length;
      return active
        .filter((attachment) => attachment.def === defId)
        .reduce((total, attachment) => total + (attachment.stack ?? 1), 0);
    },
    propOf: (a, ctx) => {
      const ref = asRef(a[0]);
      const path = a[1];
      if (!ref || typeof path !== 'string' || !ctx.stateAccess) return null;
      return ctx.stateAccess.propOf(ref, path);
    },
    defOf: (a, ctx) => {
      const ref = asRef(a[0]);
      if (!ref || !ctx.stateAccess) return null;
      return ctx.stateAccess.defOf(ref);
    },
    // 需求12.7 明确要求 isA 是一个算子。此前它只作为 ExprEngine 的一个实例方法存在，
    // 没有进入算子表，意味着 {op:'isA'} 形态的表达式会走"未知算子"分支恒为 null——
    // 声明了却不可用。这里把它接入算子表，优先用 stateAccess，回退到 resolveRefDefId+defRegistry。
    isA: (a, ctx) => {
      const ref = asRef(a[0]);
      const defId = a[1];
      if (!ref || typeof defId !== 'string') return false;
      if (ctx.stateAccess) return ctx.stateAccess.isA(ref, defId);
      if (!ctx.resolveRefDefId || !ctx.defRegistry) return false;
      const actual = ctx.resolveRefDefId(ref);
      return actual === null ? false : ctx.defRegistry.defIsA(actual, defId);
    },

    // ---- 拓扑类（design.md 3.3节算子表）----
    // 入参统一接受 Ref 或裸 NodeId 字符串：玩法包表达式里 {path:'self.node'} 读出来的是字符串
    // NodeId，而 {var:'target'} 拿到的通常是 Ref，两种都得能直接喂给 dist。
    dist: (a, ctx) => {
      const from = asNodeId(a[0]);
      const to = asNodeId(a[1]);
      if (from === null || to === null || !ctx.stateAccess) return null;
      return ctx.stateAccess.dist(from, to, topologyOpts(a[2] ?? null));
    },
    path: (a, ctx) => {
      const from = asNodeId(a[0]);
      const to = asNodeId(a[1]);
      if (from === null || to === null || !ctx.stateAccess) return null;
      return ctx.stateAccess.path(from, to, topologyOpts(a[2] ?? null)) as Value | null;
    },
    spread: (a, ctx) => {
      const origin = asNodeId(a[0]);
      const budget = num(a[1] ?? null);
      if (origin === null || budget === null || !ctx.stateAccess) return null;
      return ctx.stateAccess.spread(origin, budget, topologyOpts(a[2] ?? null)) as unknown as Value;
    },
    radius: (a, ctx) => {
      const origin = asNodeId(a[0]);
      const budget = num(a[1] ?? null);
      if (origin === null || budget === null || !ctx.stateAccess) return null;
      return ctx.stateAccess.radius(origin, budget, topologyOpts(a[2] ?? null)) as Value;
    },
    nodeOf: (a, ctx) => {
      const ref = asRef(a[0]);
      if (!ref || !ctx.stateAccess) return null;
      return ctx.stateAccess.nodeOf(ref);
    },
    parentOf: (a, ctx) => {
      const nodeId = asNodeId(a[0]);
      if (nodeId === null || !ctx.stateAccess) return null;
      return ctx.stateAccess.parentOf(nodeId);
    },
    containerOf: (a, ctx) => {
      const ref = asRef(a[0]);
      if (!ref || !ctx.stateAccess) return null;
      return ctx.stateAccess.containerOf(ref);
    },
    slotOf: (a, ctx) => {
      const ref = asRef(a[0]);
      if (!ref || !ctx.stateAccess) return null;
      return ctx.stateAccess.slotOf(ref);
    },
    occupantsOf: (a, ctx) => {
      const nodeId = asNodeId(a[0]);
      if (nodeId === null || !ctx.stateAccess) return null;
      return ctx.stateAccess.occupantsOf(nodeId) as unknown as Value;
    },

    // ---- 关系类（design.md 3.3节算子表）----
    relOut: (a, ctx) => {
      const ref = asRef(a[0]);
      const kind = a[1];
      if (!ref || typeof kind !== 'string' || !ctx.stateAccess) return null;
      return ctx.stateAccess.relOut(ref, kind) as unknown as Value;
    },
    relIn: (a, ctx) => {
      const ref = asRef(a[0]);
      const kind = a[1];
      if (!ref || typeof kind !== 'string' || !ctx.stateAccess) return null;
      return ctx.stateAccess.relIn(ref, kind) as unknown as Value;
    },
    hasRel: (a, ctx) => {
      const from = asRef(a[0]);
      const to = asRef(a[1]);
      const kind = a[2];
      if (!from || !to || typeof kind !== 'string' || !ctx.stateAccess) return false;
      return ctx.stateAccess.relOut(from, kind).some((candidate) => candidate.$ === to.$);
    },

    // ---- 认知类（design.md 3.3节算子表 / 3.12节）----
    // visibleTo 刻意不作为算子提供：design.md 3.12节把可见性过滤定为 QueryEngine.run 的
    // visibleTo 参数（结果集级别的门禁），而不是表达式里的一个布尔判定。把它同时做成算子会产生
    // 两条语义可能漂移的可见性路径，正是 3.12 节要避免的"第二条写入/判定路径"。
    knows: (a, ctx) => {
      const scope = a[0];
      const key = a[1];
      if (typeof key !== 'string' || !ctx.stateAccess) return null;
      const scopeId = typeof scope === 'string' ? scope : asRef(scope)?.$ ?? null;
      if (scopeId === null) return null;
      return ctx.stateAccess.knows(scopeId, key);
    },
  };
  return Object.freeze(ops);
}

/** 把 Ref 或裸 Id 字符串统一收敛为 NodeId，其它一律 null。 */
function asNodeId(value: Value | null | undefined): string | null {
  if (typeof value === 'string') return value;
  const ref = asRef(value);
  return ref ? ref.$ : null;
}

/** 解析拓扑算子的第三个可选参数（一个内联映射），非映射一律视为未提供修饰。 */
function topologyOpts(value: Value | null): TopologyOpOpts | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isRef(value)) return undefined;
  const source = value as Record<string, Value>;
  const viaTag = source['viaTag'];
  const maxCost = source['maxCost'];
  const metric = source['metric'];
  return {
    ...(typeof viaTag === 'string' ? { viaTag } : {}),
    ...(typeof maxCost === 'number' && isFiniteNumber(maxCost) ? { maxCost } : {}),
    ...(metric === 'sum' || metric === 'hops' ? { metric } : {}),
  };
}

/** 表算子 sort 的全序比较：数值按大小，字符串按码点，混合类型按类型名保证确定性。 */
function compareValues(left: Value, right: Value): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right);
  return typeName(left).localeCompare(typeName(right));
}

function typeName(value: Value): string {
  if (value === null) return '0null';
  if (typeof value === 'boolean') return `1bool:${value ? 1 : 0}`;
  if (typeof value === 'number') return `2num:${value}`;
  if (typeof value === 'string') return `3str:${value}`;
  if (Array.isArray(value)) return `4arr:${value.length}`;
  return `5obj:${JSON.stringify(value)}`;
}

function valueEquals(a: Value | null, b: Value | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (isRef(a) && isRef(b)) return a.$ === b.$;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => valueEquals(v, b[i] as Value));
  }
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b) && !isRef(a) && !isRef(b)) {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => valueEquals((a as Record<string, Value>)[k] ?? null, (b as Record<string, Value>)[k] ?? null));
  }
  return false;
}

const BUILTIN_OPS = buildBuiltinOps();

export class ExprEngine {
  /** 验证内置算子表不含随机类算子名（需求12.8），构造期断言，非运行期开销。 */
  static assertNoRandomOps(): void {
    for (const name of Object.keys(BUILTIN_OPS)) {
      if (RANDOM_OP_NAMES.has(name)) {
        throw new Error(`内核内部错误：内置算子表意外包含随机类算子 ${name}`);
      }
    }
  }

  /** 全函数：任意输入返回值或 null，永不抛异常（需求12.1）。 */
  eval(expr: Expr, ctx: EvalContext): Value | null {
    try {
      return this.evalInner(expr, ctx);
    } catch {
      return null;
    }
  }

  private evalInner(expr: Expr, ctx: EvalContext): Value | null {
    if (ctx.budget.depth > ctx.budget.maxDepth) return null;

    if (expr === null || typeof expr === 'boolean' || typeof expr === 'number' || typeof expr === 'string') {
      return typeof expr === 'number' && !isFiniteNumber(expr) ? null : expr;
    }
    if (Array.isArray(expr)) {
      // 字面量数组 Value；但内部元素若是 Expr 结构（如 op 的 args），由具体分支处理；这里当作字面 Value
      return expr as unknown as Value;
    }
    if (isRef(expr)) return expr;

    const obj = expr as Record<string, unknown>;

    if ('path' in obj && typeof obj['path'] === 'string') {
      return ctx.resolvePath(obj['path'] as string);
    }
    if ('var' in obj && typeof obj['var'] === 'string') {
      return ctx.vars[obj['var'] as string] ?? null;
    }
    if ('op' in obj && typeof obj['op'] === 'string') {
      const opName = obj['op'] as string;
      if (RANDOM_OP_NAMES.has(opName)) return null; // 随机算子不属于 Expr（需求12.8），求值直接返回 null
      const impl = BUILTIN_OPS[opName];
      if (!impl) return null; // 未知算子（需求12.3 越界/未知一律返回 null 或走诊断，此处求值层返回 null）
      const rawArgs = Array.isArray(obj['args']) ? (obj['args'] as Expr[]) : [];
      const evaledArgs = rawArgs.map((a) => this.evalInner(a, { ...ctx, budget: { depth: ctx.budget.depth + 1, maxDepth: ctx.budget.maxDepth } }));
      return impl(evaledArgs, ctx);
    }
    if ('q' in obj) {
      // runQueryValues 优先：它对九个对象源返回与 runQuery 相同的 Ref 数组，但额外支持
      // from:'log'（日志条目不可 Ref 寻址，只能作为自描述映射返回，见 query-engine.ts 说明）。
      const query = obj['q'] as Query;
      if (ctx.runQueryValues) return ctx.runQueryValues(query, ctx) as unknown as Value;
      if (!ctx.runQuery) return null;
      return ctx.runQuery(query, ctx) as unknown as Value;
    }
    if ('call' in obj && typeof obj['call'] === 'string') {
      if (!ctx.resolveNamedExpr) return null;
      const named = ctx.resolveNamedExpr(obj['call'] as string);
      if (!named) return null;
      const argsExpr = (obj['args'] as Record<string, Expr> | undefined) ?? {};
      const newVars: Record<string, Value> = { ...ctx.vars };
      for (const [k, v] of Object.entries(argsExpr)) {
        newVars[k] = this.evalInner(v, ctx) ?? null;
      }
      return this.evalInner(named.body, {
        ...ctx,
        vars: newVars,
        budget: { depth: ctx.budget.depth + 1, maxDepth: ctx.budget.maxDepth },
      });
    }
    // 普通对象形态的字面量 Value（映射）。叶子若是 Expr 结构（含 var/op/path/q/call 键的对象、数组嵌套），
    // 递归求值而非原样拷贝——保证 `{ emit: { data: { target: {var:'t'}, delta: {var:'dmg'} } } }` 这类
    // 运行动态派生的 payload 能真正把运行时值写进规则（需求15）：Event payload 是「求值后的数据」，
    // 而不是带着 Expr 结构的半成品。若不展开，规则里 `get(payload, 'damagePath')` 会拿到一个没求值的
    // Expr 节点，随后把 [object Object] 当路径写进 prop.add，直接违反需求1.7（结构区不可直写）。
    const nextCtx = { ...ctx, budget: { depth: ctx.budget.depth + 1, maxDepth: ctx.budget.maxDepth } };
    // 注意 maxDepth 守卫：深度将尽时（nextDepth > maxDepth）不再用 isExprLeafObject 展开嵌套表达式
    // 子树，回退为原样拷贝映射，避免栈溢出。这让带深嵌套的 emit payload 在预算允许内展开、预算逼近
    // 时不崩溃（query/path 最坏是返回 null）。
    const canExpand = nextCtx.budget.depth <= nextCtx.budget.maxDepth;
    const result: Record<string, Value> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = canExpand && isExprLeafObject(v) ? (this.evalInner(v as Expr, nextCtx) ?? null) : (v as Value);
    }
    return result;
  }

  /** isA(ref, defId) 算子（需求12.7）：沿 Def 继承链判断归属关系。 */
  isA(ref: Ref, defId: string, ctx: EvalContext): boolean {
    if (!ctx.resolveRefDefId || !ctx.defRegistry) return false;
    const actualDefId = ctx.resolveRefDefId(ref);
    if (!actualDefId) return false;
    return ctx.defRegistry.defIsA(actualDefId, defId);
  }
}

export function makeDefaultEvalContext(overrides?: Partial<EvalContext>): EvalContext {
  return {
    vars: {},
    budget: { depth: 0, maxDepth: 64 },
    resolvePath: () => null,
    ...overrides,
  };
}
