import { HookPhase } from './hook.js';
import type { Context, HookDef } from './hook.js';
/** 一次 Hook 调用的轨迹条目。仅在 recording 打开时产生。 */
export interface TraceEntry {
    /** 'hook' = 某个 Hook 的 effect 被调用；'default' = 默认处理器被调用 */
    kind: 'hook' | 'default';
    type: string;
    phase: HookPhase | 'default';
    hookId: string;
    /** dispatch 嵌套深度，进入该调用时的值 */
    depth: number;
}
/** checkInvariants 的违规码。 */
export declare const HookInvariant: {
    /** 顶层 emit 结束后 depth 未归零 */
    readonly DEPTH_NOT_RESET: 'E_INV_DEPTH_NOT_RESET';
    /** depth 为负，说明 finally 递减与递增不配对 */
    readonly DEPTH_NEGATIVE: 'E_INV_DEPTH_NEGATIVE';
    /** depth 超过上限仍在运行 */
    readonly DEPTH_OVERFLOW: 'E_INV_DEPTH_OVERFLOW';
    /** 空闲状态下调用栈非空，说明重入锁泄漏 */
    readonly STACK_LEAKED: 'E_INV_STACK_LEAKED';
    /** 调用栈深度与 depth 不相容 */
    readonly STACK_DEPTH_MISMATCH: 'E_INV_STACK_DEPTH_MISMATCH';
    /** 空闲状态下反应队列非空，说明 drain 未清空 */
    readonly QUEUE_LEAKED: 'E_INV_QUEUE_LEAKED';
    /** 反应轮数超过上限 */
    readonly ROUNDS_OVERFLOW: 'E_INV_ROUNDS_OVERFLOW';
    /** 注册序号与已注册 Hook 总数不符 */
    readonly ORDER_COUNT_MISMATCH: 'E_INV_ORDER_COUNT_MISMATCH';
    /** 注册序号在同一事件桶内非严格递增 */
    readonly ORDER_NOT_MONOTONIC: 'E_INV_ORDER_NOT_MONOTONIC';
    /** 注册序号在全局出现重复 */
    readonly ORDER_DUPLICATE: 'E_INV_ORDER_DUPLICATE';
    /** Hook 被挂在与其 on 字段不符的事件桶下 */
    readonly BUCKET_MISKEYED: 'E_INV_BUCKET_MISKEYED';
    /** 事件桶存在但为空数组 */
    readonly BUCKET_EMPTY: 'E_INV_BUCKET_EMPTY';
    /** Hook 的 phase 不是四个合法值之一 */
    readonly PHASE_INVALID: 'E_INV_PHASE_INVALID';
};
export declare class HookSystem {
    private readonly hooks;
    private readonly defaultHandlers;
    private readonly callStack;
    private reactionQueue;
    private registrationOrder;
    private depth;
    private reactionRounds;
    private recording;
    private trace;
    readonly MAX_DEPTH = 32;
    readonly MAX_REACTION_ROUNDS = 8;
    /**
     * 打开执行轨迹记录。默认关闭，打开后不改变任何调度行为，
     * 仅在每次 Hook effect / default handler 被调用时追加一条记录。
     */
    startRecording(): void;
    /** 取出并清空轨迹。 */
    takeTrace(): TraceEntry[];
    /** 关闭轨迹记录并清空。 */
    stopRecording(): void;
    /**
     * 结构快照。用于测试比对，不含函数引用。
     * hooks 按事件名排序，桶内保持注册顺序（即 order 升序）。
     */
    snapshot(): {
        hooks: Array<{
            on: string;
            entries: Array<{
                id: string;
                phase: string;
                priority: number;
                order: number;
            }>;
        }>;
        defaultHandlers: string[];
        depth: number;
        reactionRounds: number;
        queueLength: number;
        callStack: Array<{
            type: string;
            hookId: string;
        }>;
        registrationOrder: number;
    };
    /**
     * 内部一致性校验。返回空数组表示无违规。
     *
     * `idle` 为 true 时（默认）额外校验"空闲态"专属不变量：
     * depth 必须为 0、调用栈必须为空、反应队列必须为空。
     * 在 Hook 执行过程中调用应传 false。
     */
    checkInvariants(idle?: boolean): string[];
    registerHook(hook: HookDef): void;
    registerDefaultHandler(type: string, handler: (ctx: Context) => unknown): void;
    emit(type: string, data?: any): void;
    /** 供属性测试及诊断使用，不执行 Hook。 */
    collectAndSortInstead(type: string, data?: any): HookDef[];
    private dispatch;
    private createContext;
    private resolveEntity;
    private drainReactions;
    private runPhase;
    private runInsteadPhase;
    private invokeHook;
    private runDefault;
    private collectHooks;
    private sortInsteadHooks;
    private isReentry;
}
//# sourceMappingURL=hook-system.d.ts.map