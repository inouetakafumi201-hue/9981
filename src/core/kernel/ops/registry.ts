/**
 * L3 Ops: OpRegistry（design.md 3.4节 / 需求16.1-16.4, 21.1-21.2）。
 *
 * 唯一写入通道：WorldState 全部结构区字段标记 readonly，只能通过 OpRegistry.invoke 修改。
 * invoke 自动包一层顶层事务：begin -> 执行 Op 实现 -> InvariantChecker.checkAll -> commit/rollback。
 */
import type { Value } from '../state/value.js';
import { Transaction, WorldStateHolder } from './transaction.js';
import { InvariantChecker } from './invariants.js';
import type { Result } from './result.js';
import { err } from './result.js';
import type { Diagnostic } from '../state/diagnostic.js';

export interface OpContext {
  tx: Transaction;
  emit(type: string, payload: Record<string, Value>): void;
  /** 当前 Op 调用链的因果事件深度（需求23-24 连锁安全，L4 完成后接入真实分发）。占位默认 0。 */
  depth: number;
}

export type OpImpl<Args, T> = (args: Args, ctx: OpContext) => Result<T>;

interface RegisteredOp {
  name: string;
  impl: OpImpl<unknown, unknown>;
  structural: boolean;
}

export interface InvokeHooks {
  /** before/after 事件分发钩子（写入通道 veto 包装点，design.md 3.4节 withVeto）。L4 完成后接入真实 HookDispatcher。 */
  dispatchBefore?: (opName: string, args: unknown, ctx: OpContext) => { cancelled: boolean; reason?: string };
  dispatchAfter?: (opName: string, args: unknown, ctx: OpContext) => void;
  /** 所有 ctx.emit（包括 Op 与 Flow）进入同一事件规则管道。 */
  dispatchEmit?: (type: string, payload: Record<string, Value>, ctx: OpContext) => void;
  onFatalDiagnostics?: (diags: Diagnostic[]) => void;
}

export class OpRegistry {
  private readonly ops = new Map<string, RegisteredOp>();
  private readonly invariantChecker = new InvariantChecker();

  constructor(
    private readonly holder: WorldStateHolder,
    private readonly hooks: InvokeHooks = {},
  ) {}

  /** 注册一个 Op；structural:true 的 Op 会被自动套上 before/after veto 包装（需求19.1-19.4）。 */
  register<A, T>(name: string, impl: OpImpl<A, T>, opts?: { structural?: boolean }): void {
    this.ops.set(name, { name, impl: impl as OpImpl<unknown, unknown>, structural: opts?.structural ?? false });
  }

  has(name: string): boolean {
    return this.ops.has(name);
  }

  /** 枚举当前已注册的全部 Op 名，供模糊测试等需要遍历全部 Op 的场景使用（纯读，不影响写入通道）。 */
  listOpNames(): string[] {
    return [...this.ops.keys()];
  }

  /** 查询某个已注册 Op 是否为结构性（会被自动套上 before/after veto 分发）。 */
  isStructural(name: string): boolean {
    return this.ops.get(name)?.structural ?? false;
  }

  /**
   * invokeInline：在调用方已经持有的 OpContext（即已经开启的事务）内调用某个 Op，
   * 仍然套用 before/after veto 分发（结构性 Op 的否决语义不因调用来源而分叉），
   * 但不新开顶层事务、不写回 holder、不做 InvariantChecker.checkAll——这些都留给最终持有该 ctx
   * 的顶层 invoke() 调用在其事务提交时统一完成一次。
   *
   * 存在原因（记录于 决策与风险记录.md）：L5 FlowInterpreter 的 {op:...} Effect 形态、
   * L4 HookDispatcher 分发的 Hook effects 里的 op 调用，都发生在"已经存在一个 OpContext"的场景下
   * （该 ctx 来自触发这次 Hook/Flow 的最外层 Op 调用）。若这些嵌套的 op 调用改为走 invoke()，
   * invoke() 会基于 holder.getState()（尚未包含外层未提交的 draft 改动）开一个全新的顶层事务，
   * 执行完立即写回 holder——这会让嵌套调用的改动绕过外层事务的原子性（外层若后续 rollback，
   * 嵌套调用已经独立提交到 holder 的改动不会被撤销），直接违反需求21.3-21.4。
   * invokeInline 用 ctx.tx.begin()/commit()/rollback() 的保存点语义代替顶层事务，
   * 改动只发生在传入的 ctx.tx 的 draft 里，随外层事务一起 commit 或 rollback。
   */
  invokeInline<A, T>(name: string, args: A, ctx: OpContext): Result<T> {
    const entry = this.ops.get(name);
    if (!entry) return err('E_OP_NOT_FOUND', `未注册的 Op: ${name}`);

    ctx.tx.begin();
    try {
      if (entry.structural && this.hooks.dispatchBefore) {
        const before = this.hooks.dispatchBefore(name, args, ctx);
        if (before.cancelled) {
          ctx.tx.rollback();
          return err('E_OP_VETOED', before.reason ?? '');
        }
      }
      const result = entry.impl(args, ctx) as Result<T>;
      if (!result.ok) {
        ctx.tx.rollback();
        return result;
      }
      ctx.tx.commit();
      if (entry.structural && this.hooks.dispatchAfter) {
        this.hooks.dispatchAfter(name, args, ctx);
      }
      return result;
    } catch (e) {
      ctx.tx.rollback();
      return err('E_OP_INVALID_ARGS', `Op ${name} 内部异常: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * invoke：Op 永不抛异常（需求16.2-16.3）——任何内部异常都会被捕获并转成 Result<false>。
   * 自动包一层事务：Op 实现返回 ok:false 时整体回滚；成功时先跑 InvariantChecker.checkAll，
   * 任一不变量失败也整体回滚，绝不提交违反不变量的状态（需求20.17, 21.3-21.4）。
   */
  invoke<A, T>(name: string, args: A): Result<T> {
    if (!this.ops.has(name)) return err('E_OP_NOT_FOUND', `未注册的 Op: ${name}`);

    const tx = new Transaction(this.holder.getState());
    const ctx: OpContext = {
      tx,
      depth: 0,
      emit: (type, payload) => {
        tx.recordEmit(type, payload);
        this.hooks.dispatchEmit?.(type, payload, ctx);
      },
    };

    const result = this.invokeInline<A, T>(name, args, ctx);
    if (!result.ok) return result;

    const finalDraft = tx.getFinalDraft();
    const diags = this.invariantChecker.checkAll(finalDraft);
    const fatalDiags = diags.filter((d) => d.severity === 'fatal');
    if (fatalDiags.length > 0) {
      this.hooks.onFatalDiagnostics?.(fatalDiags);
      // 使用触发失败的第一条不变量诊断的具体 code，而不是笼统的固定码——
      // 这样调用方能区分"哪一条不变量被违反"，符合 5.2 节"每个前置条件失败必须映射到具体 ErrCode"的纪律。
      return err(fatalDiags[0]!.code, `不变量校验失败: ${fatalDiags.map((d) => d.message).join('; ')}`);
    }

    this.holder.setState(finalDraft);
    return result;
  }
}
