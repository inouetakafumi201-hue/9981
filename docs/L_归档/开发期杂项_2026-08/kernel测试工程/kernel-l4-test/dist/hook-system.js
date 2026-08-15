"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HookSystem = exports.HookInvariant = void 0;
const hook_js_1 = require("./hook.js");
/** checkInvariants 的违规码。 */
exports.HookInvariant = {
    /** 顶层 emit 结束后 depth 未归零 */
    DEPTH_NOT_RESET: 'E_INV_DEPTH_NOT_RESET',
    /** depth 为负，说明 finally 递减与递增不配对 */
    DEPTH_NEGATIVE: 'E_INV_DEPTH_NEGATIVE',
    /** depth 超过上限仍在运行 */
    DEPTH_OVERFLOW: 'E_INV_DEPTH_OVERFLOW',
    /** 空闲状态下调用栈非空，说明重入锁泄漏 */
    STACK_LEAKED: 'E_INV_STACK_LEAKED',
    /** 调用栈深度与 depth 不相容 */
    STACK_DEPTH_MISMATCH: 'E_INV_STACK_DEPTH_MISMATCH',
    /** 空闲状态下反应队列非空，说明 drain 未清空 */
    QUEUE_LEAKED: 'E_INV_QUEUE_LEAKED',
    /** 反应轮数超过上限 */
    ROUNDS_OVERFLOW: 'E_INV_ROUNDS_OVERFLOW',
    /** 注册序号与已注册 Hook 总数不符 */
    ORDER_COUNT_MISMATCH: 'E_INV_ORDER_COUNT_MISMATCH',
    /** 注册序号在同一事件桶内非严格递增 */
    ORDER_NOT_MONOTONIC: 'E_INV_ORDER_NOT_MONOTONIC',
    /** 注册序号在全局出现重复 */
    ORDER_DUPLICATE: 'E_INV_ORDER_DUPLICATE',
    /** Hook 被挂在与其 on 字段不符的事件桶下 */
    BUCKET_MISKEYED: 'E_INV_BUCKET_MISKEYED',
    /** 事件桶存在但为空数组 */
    BUCKET_EMPTY: 'E_INV_BUCKET_EMPTY',
    /** Hook 的 phase 不是四个合法值之一 */
    PHASE_INVALID: 'E_INV_PHASE_INVALID',
};
const VALID_PHASES = new Set([
    hook_js_1.HookPhase.Before,
    hook_js_1.HookPhase.Modify,
    hook_js_1.HookPhase.Instead,
    hook_js_1.HookPhase.After,
]);
class HookSystem {
    hooks = new Map();
    defaultHandlers = new Map();
    callStack = [];
    reactionQueue = [];
    registrationOrder = 0;
    depth = 0;
    reactionRounds = 0;
    recording = false;
    trace = [];
    MAX_DEPTH = 32;
    MAX_REACTION_ROUNDS = 8;
    /**
     * 打开执行轨迹记录。默认关闭，打开后不改变任何调度行为，
     * 仅在每次 Hook effect / default handler 被调用时追加一条记录。
     */
    startRecording() {
        this.recording = true;
        this.trace = [];
    }
    /** 取出并清空轨迹。 */
    takeTrace() {
        const result = this.trace;
        this.trace = [];
        return result;
    }
    /** 关闭轨迹记录并清空。 */
    stopRecording() {
        this.recording = false;
        this.trace = [];
    }
    /**
     * 结构快照。用于测试比对，不含函数引用。
     * hooks 按事件名排序，桶内保持注册顺序（即 order 升序）。
     */
    snapshot() {
        return {
            hooks: [...this.hooks.keys()].sort().map((on) => ({
                on,
                entries: (this.hooks.get(on) ?? []).map((e) => ({
                    id: e.hook.id,
                    phase: e.hook.phase,
                    priority: e.hook.priority ?? 0,
                    order: e.order,
                })),
            })),
            defaultHandlers: [...this.defaultHandlers.keys()].sort(),
            depth: this.depth,
            reactionRounds: this.reactionRounds,
            queueLength: this.reactionQueue.length,
            callStack: this.callStack.map((f) => ({ type: f.type, hookId: f.hookId })),
            registrationOrder: this.registrationOrder,
        };
    }
    /**
     * 内部一致性校验。返回空数组表示无违规。
     *
     * `idle` 为 true 时（默认）额外校验"空闲态"专属不变量：
     * depth 必须为 0、调用栈必须为空、反应队列必须为空。
     * 在 Hook 执行过程中调用应传 false。
     */
    checkInvariants(idle = true) {
        const violations = [];
        const push = (code, detail) => {
            violations.push(`${code}: ${detail}`);
        };
        if (this.depth < 0) {
            push(exports.HookInvariant.DEPTH_NEGATIVE, `depth=${this.depth}`);
        }
        if (this.depth > this.MAX_DEPTH) {
            push(exports.HookInvariant.DEPTH_OVERFLOW, `depth=${this.depth} > ${this.MAX_DEPTH}`);
        }
        if (this.reactionRounds > this.MAX_REACTION_ROUNDS) {
            push(exports.HookInvariant.ROUNDS_OVERFLOW, `reactionRounds=${this.reactionRounds} > ${this.MAX_REACTION_ROUNDS}`);
        }
        // depth 为负时该比较必然成立，属 DEPTH_NEGATIVE 的派生噪声，不单独报。
        if (this.depth >= 0 && this.callStack.length > this.depth) {
            push(exports.HookInvariant.STACK_DEPTH_MISMATCH, `callStack=${this.callStack.length} > depth=${this.depth}`);
        }
        if (idle) {
            if (this.depth !== 0)
                push(exports.HookInvariant.DEPTH_NOT_RESET, `depth=${this.depth}`);
            if (this.callStack.length !== 0) {
                push(exports.HookInvariant.STACK_LEAKED, `callStack=[${this.callStack.map((f) => `${f.type}/${f.hookId}`).join(',')}]`);
            }
            if (this.reactionQueue.length !== 0) {
                push(exports.HookInvariant.QUEUE_LEAKED, `queue=${this.reactionQueue.length}`);
            }
        }
        let total = 0;
        const seenOrders = new Set();
        for (const [on, entries] of this.hooks) {
            if (entries.length === 0) {
                push(exports.HookInvariant.BUCKET_EMPTY, `event ${on} has an empty bucket`);
            }
            let prevOrder = -1;
            for (const entry of entries) {
                total++;
                if (entry.hook.on !== on) {
                    push(exports.HookInvariant.BUCKET_MISKEYED, `hook ${entry.hook.id} has on=${entry.hook.on} but sits in bucket ${on}`);
                }
                if (!VALID_PHASES.has(entry.hook.phase)) {
                    push(exports.HookInvariant.PHASE_INVALID, `hook ${entry.hook.id} phase=${String(entry.hook.phase)}`);
                }
                if (entry.order <= prevOrder) {
                    push(exports.HookInvariant.ORDER_NOT_MONOTONIC, `bucket ${on}: order ${entry.order} follows ${prevOrder}`);
                }
                prevOrder = entry.order;
                if (seenOrders.has(entry.order)) {
                    push(exports.HookInvariant.ORDER_DUPLICATE, `order ${entry.order} appears more than once`);
                }
                seenOrders.add(entry.order);
            }
        }
        if (total !== this.registrationOrder) {
            push(exports.HookInvariant.ORDER_COUNT_MISMATCH, `registered=${total} but registrationOrder=${this.registrationOrder}`);
        }
        return violations;
    }
    registerHook(hook) {
        const eventHooks = this.hooks.get(hook.on) ?? [];
        eventHooks.push({ hook, order: this.registrationOrder++ });
        this.hooks.set(hook.on, eventHooks);
    }
    registerDefaultHandler(type, handler) {
        this.defaultHandlers.set(type, handler);
    }
    emit(type, data = {}) {
        const isRoot = this.depth === 0;
        if (isRoot) {
            this.reactionQueue = [];
            // 顶层事件本身是第1轮；后续 react 事件最多推进到第8轮。
            this.reactionRounds = 1;
        }
        try {
            this.dispatch(type, data);
            if (isRoot)
                this.drainReactions();
        }
        finally {
            // 根级 emit 无论正常返回还是抛错，都必须把反应态归零。
            // 否则 Hook 抛错（含重入/深度错误）会绕过 drainReactions，
            // 让未消费的反应数据残留到下一次根 emit，空闲态不干净。
            if (isRoot) {
                this.reactionQueue = [];
                this.reactionRounds = 0;
            }
        }
    }
    /** 供属性测试及诊断使用，不执行 Hook。 */
    collectAndSortInstead(type, data = {}) {
        const ctx = this.createContext(type, data);
        return this.sortInsteadHooks(this.collectHooks(type, ctx, hook_js_1.HookPhase.Instead))
            .map((candidate) => candidate.hook);
    }
    dispatch(type, data) {
        if (this.depth >= this.MAX_DEPTH) {
            throw new hook_js_1.HookDepthExceededError();
        }
        this.depth++;
        try {
            const ctx = this.createContext(type, data);
            this.runPhase(hook_js_1.HookPhase.Before, type, ctx);
            this.runPhase(hook_js_1.HookPhase.Modify, type, ctx);
            const prevented = this.runInsteadPhase(type, ctx);
            if (!prevented)
                this.runDefault(type, ctx);
            this.runPhase(hook_js_1.HookPhase.After, type, ctx);
        }
        finally {
            this.depth--;
            if (this.depth === 0)
                this.callStack.length = 0;
        }
    }
    createContext(type, data) {
        const normalizedData = data ?? {};
        return {
            event: type,
            data: normalizedData,
            entity: this.resolveEntity(normalizedData),
            emit: (nestedType, nestedData = {}) => this.emit(nestedType, nestedData),
            react: (reactionType, reactionData = {}) => {
                this.reactionQueue.push({ type: reactionType, data: reactionData });
            },
        };
    }
    resolveEntity(data) {
        return data?.target ?? data?.entity;
    }
    drainReactions() {
        while (this.reactionQueue.length > 0 && this.reactionRounds < this.MAX_REACTION_ROUNDS) {
            const currentRound = this.reactionQueue;
            this.reactionQueue = [];
            this.reactionRounds++;
            for (const reaction of currentRound) {
                this.dispatch(reaction.type, reaction.data);
            }
        }
        this.reactionQueue = [];
    }
    runPhase(phase, type, ctx) {
        for (const candidate of this.collectHooks(type, ctx, phase)) {
            this.invokeHook(type, candidate.hook, ctx);
        }
    }
    runInsteadPhase(type, ctx) {
        const candidates = this.sortInsteadHooks(this.collectHooks(type, ctx, hook_js_1.HookPhase.Instead));
        for (const candidate of candidates) {
            const result = this.invokeHook(type, candidate.hook, ctx);
            if (result?.preventAll)
                return true;
            if (result?.preventExcept && !result.preventExcept.includes(type))
                return true;
        }
        return false;
    }
    invokeHook(type, hook, ctx) {
        if (this.isReentry(type, hook.id))
            throw new hook_js_1.HookReentryError();
        if (this.recording) {
            this.trace.push({
                kind: 'hook',
                type,
                phase: hook.phase,
                hookId: hook.id,
                depth: this.depth,
            });
        }
        this.callStack.push({ type, hookId: hook.id });
        try {
            return hook.effect(ctx);
        }
        finally {
            this.callStack.pop();
        }
    }
    runDefault(type, ctx) {
        const handler = this.defaultHandlers.get(type);
        if (this.recording && handler) {
            this.trace.push({
                kind: 'default',
                type,
                phase: 'default',
                hookId: `<default:${type}>`,
                depth: this.depth,
            });
        }
        const result = handler?.(ctx);
        if (result !== undefined)
            ctx.result = result;
    }
    collectHooks(type, ctx, phase) {
        const candidates = [];
        for (const entry of this.hooks.get(type) ?? []) {
            if (entry.hook.phase !== phase)
                continue;
            if (entry.hook.when && !entry.hook.when(ctx))
                continue;
            candidates.push({
                hook: entry.hook,
                meta: {
                    containerIndex: 0,
                    slotIndex: 0,
                    defId: entry.hook.id,
                    order: entry.order,
                },
            });
        }
        const entity = ctx.entity;
        if (!entity)
            return candidates;
        for (let containerIndex = 0; containerIndex < entity.containerOrder.length; containerIndex++) {
            const container = entity.containers[entity.containerOrder[containerIndex]];
            if (!container)
                continue;
            for (let slotIndex = 0; slotIndex < container.items.length; slotIndex++) {
                const item = container.items[slotIndex];
                if (item.destroyed)
                    continue;
                for (let ruleIndex = 0; ruleIndex < item.rules.length; ruleIndex++) {
                    const hook = item.rules[ruleIndex];
                    if (hook.on !== type || hook.phase !== phase)
                        continue;
                    if (hook.when && !hook.when(ctx))
                        continue;
                    candidates.push({
                        hook,
                        meta: {
                            containerIndex,
                            slotIndex,
                            defId: item.def,
                            order: ruleIndex,
                        },
                    });
                }
            }
        }
        return candidates;
    }
    sortInsteadHooks(candidates) {
        return [...candidates].sort((a, b) => {
            const priorityDelta = (b.hook.priority ?? 0) - (a.hook.priority ?? 0);
            if (priorityDelta !== 0)
                return priorityDelta;
            if (a.meta.containerIndex !== b.meta.containerIndex) {
                return a.meta.containerIndex - b.meta.containerIndex;
            }
            if (a.meta.slotIndex !== b.meta.slotIndex) {
                return a.meta.slotIndex - b.meta.slotIndex;
            }
            const defDelta = compareText(a.meta.defId, b.meta.defId);
            if (defDelta !== 0)
                return defDelta;
            const hookDelta = compareText(a.hook.id, b.hook.id);
            if (hookDelta !== 0)
                return hookDelta;
            return a.meta.order - b.meta.order;
        });
    }
    isReentry(type, hookId) {
        return this.callStack.some((frame) => frame.type === type && frame.hookId === hookId);
    }
}
exports.HookSystem = HookSystem;
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
//# sourceMappingURL=hook-system.js.map