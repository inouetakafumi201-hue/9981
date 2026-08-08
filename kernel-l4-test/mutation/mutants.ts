/**
 * L4 变异体清单
 *
 * 每个变异体是对 src/ 的一处单点故障注入。测试套件必须让它失败（"杀死"）。
 * 存活的变异体意味着：该行为没有任何测试在管——或者契约本身粗到无法区分。
 *
 * find 必须在目标文件中恰好命中一次；命中 0 次或多次记为 INVALID，
 * 不计入得分，避免"改了个不存在的东西"被误算成击杀。
 */
export interface Mutant {
  id: string;
  /** 相对 src/ 的目标文件 */
  file: string;
  desc: string;
  find: string;
  replace: string;
  /** 预期等价（语义不变），存活是正确结果 */
  expectEquivalent?: boolean;
}

const SYS = 'hook-system.ts';

export const MUTANTS: Mutant[] = [
  // ---- A. instead 排序：6 级 tiebreak ----
  {
    id: 'M01',
    file: SYS,
    desc: 'priority 排序方向反转（降序→升序）',
    find: 'const priorityDelta = (b.hook.priority ?? 0) - (a.hook.priority ?? 0);',
    replace: 'const priorityDelta = (a.hook.priority ?? 0) - (b.hook.priority ?? 0);',
  },
  {
    id: 'M02',
    file: SYS,
    desc: 'priority 缺省值 0 改为 1（破坏"未指定即 0"契约）',
    find: 'const priorityDelta = (b.hook.priority ?? 0) - (a.hook.priority ?? 0);',
    replace: 'const priorityDelta = (b.hook.priority ?? 1) - (a.hook.priority ?? 0);',
  },
  {
    id: 'M03',
    file: SYS,
    desc: '完全不比较 priority',
    find: 'if (priorityDelta !== 0) return priorityDelta;',
    replace: 'if (false as boolean) return priorityDelta;',
  },
  {
    id: 'M04',
    file: SYS,
    desc: 'containerIndex 排序方向反转',
    find: 'return a.meta.containerIndex - b.meta.containerIndex;',
    replace: 'return b.meta.containerIndex - a.meta.containerIndex;',
  },
  {
    id: 'M05',
    file: SYS,
    desc: '不比较 containerIndex',
    find: `      if (a.meta.containerIndex !== b.meta.containerIndex) {
        return a.meta.containerIndex - b.meta.containerIndex;
      }`,
    replace: '      // containerIndex 比较被移除',
  },
  {
    id: 'M06',
    file: SYS,
    desc: 'slotIndex 排序方向反转',
    find: 'return a.meta.slotIndex - b.meta.slotIndex;',
    replace: 'return b.meta.slotIndex - a.meta.slotIndex;',
  },
  {
    id: 'M07',
    file: SYS,
    desc: '不比较 slotIndex',
    find: `      if (a.meta.slotIndex !== b.meta.slotIndex) {
        return a.meta.slotIndex - b.meta.slotIndex;
      }`,
    replace: '      // slotIndex 比较被移除',
  },
  {
    id: 'M08',
    file: SYS,
    desc: 'defId 比较方向反转',
    find: 'const defDelta = compareText(a.meta.defId, b.meta.defId);',
    replace: 'const defDelta = compareText(b.meta.defId, a.meta.defId);',
  },
  {
    id: 'M09',
    file: SYS,
    desc: '不比较 defId',
    find: 'if (defDelta !== 0) return defDelta;',
    replace: 'if (false as boolean) return defDelta;',
  },
  {
    id: 'M10',
    file: SYS,
    desc: 'hookId 比较方向反转',
    find: 'const hookDelta = compareText(a.hook.id, b.hook.id);',
    replace: 'const hookDelta = compareText(b.hook.id, a.hook.id);',
  },
  {
    id: 'M11',
    file: SYS,
    desc: '不比较 hookId',
    find: 'if (hookDelta !== 0) return hookDelta;',
    replace: 'if (false as boolean) return hookDelta;',
  },
  {
    id: 'M12',
    file: SYS,
    desc: 'order 兜底比较方向反转',
    find: 'return a.meta.order - b.meta.order;',
    replace: 'return b.meta.order - a.meta.order;',
  },
  {
    id: 'M13',
    file: SYS,
    desc: 'order 兜底改为恒等（放弃全序）',
    find: 'return a.meta.order - b.meta.order;',
    replace: 'return 0;',
  },
  {
    id: 'M14',
    file: SYS,
    desc: 'compareText 相等分支返回 1（破坏自反性）',
    find: 'return left < right ? -1 : left > right ? 1 : 0;',
    replace: 'return left < right ? -1 : left > right ? 1 : 1;',
  },
  {
    id: 'M15',
    file: SYS,
    desc: '排序前不复制数组（原地排序污染注册表顺序）',
    find: 'return [...candidates].sort((a, b) => {',
    replace: 'return candidates.sort((a, b) => {',
    // candidates 是 collectHooks 每次现造的局部数组，原地排序疑似无外部可见影响。
    // 不靠推理定性，由 mutation/equivalence.ts 差分模糊判定。
    expectEquivalent: true,
  },

  // ---- B. 候选收集 ----
  {
    id: 'M16',
    file: SYS,
    desc: 'phase 过滤失效（收集所有阶段的 Hook）',
    find: `      if (entry.hook.phase !== phase) continue;`,
    replace: `      if (false as boolean) continue;`,
  },
  {
    id: 'M17',
    file: SYS,
    desc: 'when 条件被忽略（恒执行）',
    find: 'if (entry.hook.when && !entry.hook.when(ctx)) continue;',
    replace: 'if (false as boolean) continue;',
  },
  {
    id: 'M18',
    file: SYS,
    desc: 'when 条件取反',
    find: 'if (entry.hook.when && !entry.hook.when(ctx)) continue;',
    replace: 'if (entry.hook.when && entry.hook.when(ctx)) continue;',
  },
  {
    id: 'M19',
    file: SYS,
    desc: '全局 Hook 的 defId 用固定串代替 hook.id',
    find: `          defId: entry.hook.id,`,
    replace: `          defId: '',`,
  },
  {
    id: 'M20',
    file: SYS,
    desc: '全局 Hook 的 order 恒为 0（丢失注册序）',
    find: `          order: entry.order,`,
    replace: `          order: 0,`,
  },
  {
    id: 'M21',
    file: SYS,
    desc: 'destroyed 物品不再跳过',
    find: 'if (item.destroyed) continue;',
    replace: 'if (false as boolean) continue;',
  },
  {
    id: 'M22',
    file: SYS,
    desc: 'destroyed 判定取反（只保留已销毁物品）',
    find: 'if (item.destroyed) continue;',
    replace: 'if (!item.destroyed) continue;',
  },
  {
    id: 'M23',
    file: SYS,
    desc: '物品 Hook 的 on 过滤失效',
    find: 'if (hook.on !== type || hook.phase !== phase) continue;',
    replace: 'if (hook.phase !== phase) continue;',
  },
  {
    id: 'M24',
    file: SYS,
    desc: '物品 Hook 的 phase 过滤失效',
    find: 'if (hook.on !== type || hook.phase !== phase) continue;',
    replace: 'if (hook.on !== type) continue;',
  },
  {
    id: 'M25',
    file: SYS,
    desc: '物品 Hook 的 when 被忽略',
    find: 'if (hook.when && !hook.when(ctx)) continue;',
    replace: 'if (false as boolean) continue;',
  },
  {
    id: 'M26',
    file: SYS,
    desc: '物品 Hook 的 defId 错用 item.id 而非 item.def',
    find: `              defId: item.def,`,
    replace: `              defId: item.id,`,
  },
  {
    id: 'M27',
    file: SYS,
    desc: '物品 Hook 的 order 错用 slotIndex 而非 ruleIndex',
    find: `              order: ruleIndex,`,
    replace: `              order: slotIndex,`,
  },
  {
    id: 'M28',
    file: SYS,
    desc: 'slotIndex 记录为常量 0',
    find: `              containerIndex,
              slotIndex,`,
    replace: `              containerIndex,
              slotIndex: 0,`,
  },
  {
    id: 'M29',
    file: SYS,
    desc: 'containerIndex 记录为常量 0',
    find: `              containerIndex,
              slotIndex,`,
    replace: `              containerIndex: 0,
              slotIndex,`,
  },
  {
    id: 'M30',
    file: SYS,
    desc: '无 entity 时提前返回改为继续（读 undefined 容器）',
    find: 'if (!entity) return candidates;',
    replace: 'if (!entity) return candidates.slice(0, 0);',
  },
  {
    id: 'M31',
    file: SYS,
    desc: '容器不存在时不跳过',
    find: 'if (!container) continue;',
    replace: 'if (false as boolean) continue;',
  },
  {
    id: 'M32',
    file: SYS,
    desc: 'entity 解析优先级反转（entity 优先于 target）',
    find: 'return data?.target ?? data?.entity;',
    replace: 'return data?.entity ?? data?.target;',
    // 两字段同时存在才可区分；若无测试构造该场景，会以存活形式暴露契约模糊
  },

  // ---- C. 五阶段顺序 ----
  {
    id: 'M33',
    file: SYS,
    desc: 'before 与 modify 顺序交换',
    find: `      this.runPhase(HookPhase.Before, type, ctx);
      this.runPhase(HookPhase.Modify, type, ctx);`,
    replace: `      this.runPhase(HookPhase.Modify, type, ctx);
      this.runPhase(HookPhase.Before, type, ctx);`,
  },
  {
    id: 'M34',
    file: SYS,
    desc: 'before 阶段被跳过',
    find: '      this.runPhase(HookPhase.Before, type, ctx);\n',
    replace: '',
  },
  {
    id: 'M35',
    file: SYS,
    desc: 'modify 阶段被跳过',
    find: '      this.runPhase(HookPhase.Modify, type, ctx);\n',
    replace: '',
  },
  {
    id: 'M36',
    file: SYS,
    desc: 'after 阶段被跳过',
    find: '      this.runPhase(HookPhase.After, type, ctx);\n',
    replace: '',
  },
  {
    id: 'M37',
    file: SYS,
    desc: 'after 提前到 default 之前',
    find: `      if (!prevented) this.runDefault(type, ctx);
      this.runPhase(HookPhase.After, type, ctx);`,
    replace: `      this.runPhase(HookPhase.After, type, ctx);
      if (!prevented) this.runDefault(type, ctx);`,
  },
  {
    id: 'M38',
    file: SYS,
    desc: 'default 无条件执行（prevent 失效）',
    find: 'if (!prevented) this.runDefault(type, ctx);',
    replace: 'this.runDefault(type, ctx);',
  },
  {
    id: 'M39',
    file: SYS,
    desc: 'prevent 判定取反（未阻止才跳过 default）',
    find: 'if (!prevented) this.runDefault(type, ctx);',
    replace: 'if (prevented) this.runDefault(type, ctx);',
  },

  // ---- D. prevent 语义 ----
  {
    id: 'M40',
    file: SYS,
    desc: 'preventAll 不再中断 instead 链',
    find: 'if (result?.preventAll) return true;',
    replace: 'if (false as boolean) return true;',
  },
  {
    id: 'M41',
    file: SYS,
    desc: 'preventExcept 的包含判定取反',
    find: 'if (result?.preventExcept && !result.preventExcept.includes(type)) return true;',
    replace: 'if (result?.preventExcept && result.preventExcept.includes(type)) return true;',
  },
  {
    id: 'M42',
    file: SYS,
    desc: 'preventExcept 一律阻止（忽略白名单）',
    find: 'if (result?.preventExcept && !result.preventExcept.includes(type)) return true;',
    replace: 'if (result?.preventExcept) return true;',
  },
  {
    id: 'M43',
    file: SYS,
    desc: 'preventExcept 完全失效',
    find: 'if (result?.preventExcept && !result.preventExcept.includes(type)) return true;',
    replace: 'if (false as boolean) return true;',
  },
  {
    id: 'M44',
    file: SYS,
    desc: 'instead 阶段恒不阻止 default',
    find: '    return false;\n  }\n\n  private invokeHook',
    replace: '    return false as boolean;\n  }\n\n  private invokeHook',
    expectEquivalent: true,
  },
  {
    id: 'M45',
    file: SYS,
    desc: 'before/modify/after 阶段的返回值不再被忽略（错误地当成 prevent）',
    find: `    for (const candidate of this.collectHooks(type, ctx, phase)) {
      this.invokeHook(type, candidate.hook, ctx);
    }`,
    replace: `    for (const candidate of this.collectHooks(type, ctx, phase)) {
      const result = this.invokeHook(type, candidate.hook, ctx);
      if (result?.preventAll) return;
    }`,
  },

  // ---- E. depth 上限 ----
  {
    id: 'M46',
    file: SYS,
    desc: 'depth 上限判定改为 >（放宽一层）',
    find: 'if (this.depth >= this.MAX_DEPTH) {',
    replace: 'if (this.depth > this.MAX_DEPTH) {',
  },
  {
    id: 'M47',
    file: SYS,
    desc: 'depth 上限常量 32→31',
    find: 'readonly MAX_DEPTH = 32;',
    replace: 'readonly MAX_DEPTH = 31;',
  },
  {
    id: 'M48',
    file: SYS,
    desc: 'depth 上限检查被移除',
    find: `    if (this.depth >= this.MAX_DEPTH) {
      throw new HookDepthExceededError();
    }`,
    replace: '    // depth 上限检查被移除',
  },
  {
    id: 'M49',
    file: SYS,
    desc: 'depth 递减被移除（计数器不复原）',
    find: `      this.depth--;
      if (this.depth === 0) this.callStack.length = 0;`,
    replace: `      if (this.depth === 0) this.callStack.length = 0;`,
  },
  {
    id: 'M50',
    file: SYS,
    desc: 'depth 归零时不清理调用栈',
    find: 'if (this.depth === 0) this.callStack.length = 0;',
    replace: 'if (false as boolean) this.callStack.length = 0;',
    // invokeHook 的 finally 恒执行 pop，调用栈本就配平，该清理是纵深防御。
    // 疑似等价，由 mutation/equivalence.ts 差分模糊判定，不靠推理定性。
    expectEquivalent: true,
  },
  {
    id: 'M51',
    file: SYS,
    desc: 'finally 改为正常路径清理（抛错时不复原 depth）',
    // 原写法只删 `} finally {` 会留下无 catch/finally 的 try，是语法错误——
    // 那样"击杀"来自编译器而非任何测试，是假击杀。此处整块替换为无 try 版本，
    // 语法合法，语义确为"抛错时跳过清理"。
    find: `    this.depth++;
    try {
      const ctx = this.createContext(type, data);
      this.runPhase(HookPhase.Before, type, ctx);
      this.runPhase(HookPhase.Modify, type, ctx);
      const prevented = this.runInsteadPhase(type, ctx);
      if (!prevented) this.runDefault(type, ctx);
      this.runPhase(HookPhase.After, type, ctx);
    } finally {
      this.depth--;
      if (this.depth === 0) this.callStack.length = 0;
    }`,
    replace: `    this.depth++;
    const ctx = this.createContext(type, data);
    this.runPhase(HookPhase.Before, type, ctx);
    this.runPhase(HookPhase.Modify, type, ctx);
    const prevented = this.runInsteadPhase(type, ctx);
    if (!prevented) this.runDefault(type, ctx);
    this.runPhase(HookPhase.After, type, ctx);
    this.depth--;
    if (this.depth === 0) this.callStack.length = 0;`,
  },

  // ---- F. 重入锁 ----
  {
    id: 'M52',
    file: SYS,
    desc: '重入检查被移除',
    find: 'if (this.isReentry(type, hook.id)) throw new HookReentryError();',
    replace: '// 重入检查被移除',
  },
  {
    id: 'M53',
    file: SYS,
    desc: '重入判定只看 type（同事件不同 Hook 也误判为重入）',
    find: `      (frame) => frame.type === type && frame.hookId === hookId,`,
    replace: `      (frame) => frame.type === type,`,
  },
  {
    id: 'M54',
    file: SYS,
    desc: '重入判定只看 hookId（跨事件复用同 id 被误判）',
    find: `      (frame) => frame.type === type && frame.hookId === hookId,`,
    replace: `      (frame) => frame.hookId === hookId,`,
  },
  {
    id: 'M55',
    file: SYS,
    desc: '调用栈不出栈（重入锁永不释放）',
    find: `    } finally {
      this.callStack.pop();
    }`,
    replace: `    }`,
  },
  {
    id: 'M56',
    file: SYS,
    desc: '调用栈不入栈（重入锁形同虚设）',
    find: 'this.callStack.push({ type, hookId: hook.id });',
    replace: '// 入栈被移除',
  },

  // ---- G. 反应轮 ----
  {
    id: 'M57',
    file: SYS,
    desc: '反应轮上限 8→7',
    find: 'readonly MAX_REACTION_ROUNDS = 8;',
    replace: 'readonly MAX_REACTION_ROUNDS = 7;',
  },
  {
    id: 'M58',
    file: SYS,
    desc: '反应轮上限判定改为 <=（多跑一轮）',
    find: 'while (this.reactionQueue.length > 0 && this.reactionRounds < this.MAX_REACTION_ROUNDS) {',
    replace: 'while (this.reactionQueue.length > 0 && this.reactionRounds <= this.MAX_REACTION_ROUNDS) {',
  },
  {
    id: 'M59',
    file: SYS,
    desc: '根 emit 的 reactionRounds 初值 1→0（白送一轮）',
    find: '      this.reactionRounds = 1;',
    replace: '      this.reactionRounds = 0;',
  },
  {
    id: 'M60',
    file: SYS,
    desc: '反应轮计数不递增（死循环风险）',
    find: '      this.reactionRounds++;',
    replace: '      // 轮次不再递增',
  },
  {
    id: 'M61',
    file: SYS,
    desc: 'drain 结束后不清空队列',
    find: `    }
    this.reactionQueue = [];
  }`,
    replace: `    }
  }`,
    // BUG L4#1 的修复在 emit 的 finally 里做了根级反应态归零，
    // 使 drain 尾部的这处清理成为冗余。疑似等价，由差分模糊判定。
    expectEquivalent: true,
  },
  {
    id: 'M62',
    file: SYS,
    desc: '整轮取出改为逐个取出（轮次语义退化为逐事件）',
    find: `      const currentRound = this.reactionQueue;
      this.reactionQueue = [];`,
    replace: `      const currentRound = [this.reactionQueue.shift()!];`,
  },
  {
    id: 'M63',
    file: SYS,
    desc: '非根 emit 也执行 drain',
    find: `      if (isRoot) this.drainReactions();`,
    replace: `      this.drainReactions();`,
  },
  {
    id: 'M64',
    file: SYS,
    desc: '根 emit 不清空上次残留队列',
    find: `      this.reactionQueue = [];
      // 顶层事件本身是第1轮；后续 react 事件最多推进到第8轮。`,
    replace: `      // 顶层事件本身是第1轮；后续 react 事件最多推进到第8轮。`,
    // 同 M61：emit 的 finally 已保证离开根 emit 时队列为空，
    // 故进入下一次根 emit 时无需再清。疑似等价，由差分模糊判定。
    expectEquivalent: true,
  },
  {
    id: 'M65',
    file: SYS,
    desc: 'finally 中的反应态归零被移除（BUG L4#1 的回归哨兵）',
    find: `      if (isRoot) {
        this.reactionQueue = [];
        this.reactionRounds = 0;
      }`,
    replace: `      // 反应态归零被移除`,
  },
  {
    id: 'M66',
    file: SYS,
    desc: 'react 改为立即 dispatch（丧失轮次语义）',
    find: `        this.reactionQueue.push({ type: reactionType, data: reactionData });`,
    replace: `        this.dispatch(reactionType, reactionData);`,
  },

  // ---- H. default handler ----
  {
    id: 'M67',
    file: SYS,
    desc: 'default handler 的返回值不再写入 ctx.result',
    find: 'if (result !== undefined) ctx.result = result;',
    replace: 'if (false as boolean) ctx.result = result;',
  },
  {
    id: 'M68',
    file: SYS,
    desc: 'default handler 注册覆盖改为忽略（后注册不生效）',
    find: 'this.defaultHandlers.set(type, handler);',
    replace: 'if (!this.defaultHandlers.has(type)) this.defaultHandlers.set(type, handler);',
  },
  {
    id: 'M69',
    file: SYS,
    desc: 'data 为 null 时不规范化为 {}',
    find: 'const normalizedData = data ?? {};',
    replace: 'const normalizedData = data;',
  },
  {
    id: 'M70',
    file: SYS,
    desc: '注册序号不自增（所有 Hook order 相同）',
    find: 'eventHooks.push({ hook, order: this.registrationOrder++ });',
    replace: 'eventHooks.push({ hook, order: this.registrationOrder });',
  },
];
