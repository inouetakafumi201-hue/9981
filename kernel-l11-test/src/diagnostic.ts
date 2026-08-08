/**
 * L11 被测产品：诊断收集器与错误码注册表。
 *
 * 这一版的形状由前面几层的实测教训决定，不是"顺手写成这样"：
 *
 * - **注册表在模块加载末尾被 sealRegistry() 封住写入面**，每个 CodeSpec 被 Object.freeze。
 *   理由：注册表是全局单例，任何一处写入都会泄漏到别的用例，
 *   造成"某条测试失败取决于它跑在第几位"这类顺序依赖的假结论。
 *   损坏注入必须绕过原型（Map.prototype.set.bind）才能写——绕过这件事本身就是封印生效的证据。
 *
 * - **members: Set 与 diags: Array 是两套登记面**，刻意不合并。
 *   emit 的因果校验查 members（O(1) 身份判定），checkInvariants 另有子句核对两者一一对应。
 *   合并成一套就没人能检出"登记漏了/多了"这类损坏了。
 *
 * - **walkChainForCheck 与 chainOf 是两个函数**，刻意不复用。
 *   chainOf 是给调用方看的、按调用方给的展示预算截断；
 *   walkChainForCheck 是给不变量检查器用的、上界随成员数走（diags.length + 1）。
 *   曾经复用过一次，结果 100 条合法 emit 串成的长链被判成"数据损坏"（缺陷 C01）——
 *   合法 API 序列产出数据损坏结论，是不变量检查器最坏的一种错。
 *
 * - **clear() 刻意不重置 time**（设计选择 C12）。timestamp 在单个 collector 内保持全局唯一，
 *   跨 clear 世代也不重复；重置会让两个世代的诊断拥有相同 timestamp，
 *   而 NON_MONOTONIC_TS 与因果先后判定都依赖它的唯一性。
 */

export type Severity = 'fatal' | 'error' | 'warn' | 'info';

export interface DiagnosticSource {
  layer: string; // 'kernel' | 'class' | 'play'
  op?: string;
  entityId?: string;
  hookId?: string;
  exprPath?: string;
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  source: DiagnosticSource;
  timestamp: number;
  causedBy?: Diagnostic;
}

export interface CodeSpec {
  code: string;
  severity: Severity;
  prefix: string;
  recoverable: boolean;
}

export const CODE_REGISTRY: Map<string, CodeSpec> = new Map();

function reg(code: string, severity: Severity): void {
  const prefix = code.split('_').slice(0, 2).join('_');
  CODE_REGISTRY.set(
    code,
    Object.freeze({
      code,
      severity,
      prefix,
      recoverable: severity !== 'fatal',
    })
  );
}

// INV系列 — 全部fatal（数据损坏）
reg('E_INV_DANGLING', 'fatal');
reg('E_INV_DUAL_LOCATION', 'fatal');
reg('E_INV_CYCLE', 'fatal');
reg('E_INV_STACK_LEAK', 'fatal');

// COST系列
// NOTE: per FATAL_PREFIXES=['E_INV'] in error-codes.ts, only E_INV_* is fatal.
// E_COST_OVER_FROZEN and E_COST_NEGATIVE_RESOURCE are severe but recoverable (rolled back).
reg('E_COST_INSUFFICIENT', 'error');
reg('E_COST_OVER_FROZEN', 'error');
reg('E_COST_NEGATIVE_RESOURCE', 'error');

// OP系列
reg('E_OP_INVALID_AMOUNT', 'error');
reg('E_OP_NO_LEGAL_SLOT', 'error');
reg('E_OP_UNKNOWN', 'error');

// HOOK系列
reg('E_HOOK_DEPTH_EXCEEDED', 'error');
reg('E_HOOK_REENTRY', 'error');

// EXPR系列
reg('E_EXPR_TYPE', 'error');
reg('E_EXPR_DIV_ZERO', 'error');
reg('E_EXPR_UNKNOWN_VAR', 'error');

// DEC系列
reg('E_DEC_INVALID', 'error');
reg('E_DEC_INVALID_ANSWER', 'error');
reg('E_DEC_DUPLICATE', 'error');
reg('E_DEC_COUNT_MISMATCH', 'error');
reg('E_DEC_ALREADY_RESOLVED', 'error');
reg('E_DEC_TIMEOUT', 'warn');

// FLOW/PHASE系列
// NOTE: E_PHASE_MULTI_OPEN changed to 'error' — only E_INV_* is fatal per FATAL_PREFIXES.
reg('E_FLOW_REACTION_LIMIT', 'error');
reg('E_FLOW_INVALID_TRANSITION', 'error');
reg('E_PHASE_NOT_OPEN', 'error');
reg('E_PHASE_MULTI_OPEN', 'error');

// INTENT系列
// NOTE: E_INTENT_FROZEN_MISMATCH changed to 'error' — only E_INV_* is fatal per FATAL_PREFIXES.
reg('E_INTENT_NOT_PENDING', 'error');
reg('E_INTENT_FROZEN_MISMATCH', 'error');

// REF系列
reg('E_REF_INVALID', 'error');

// LINK系列
reg('E_LINK_CROSS_SCENE', 'error');

/**
 * 合法前缀白名单。与注册表分开维护是刻意的：
 * 注册表答的是"这个码存在吗"，白名单答的是"这个码属于一个被承认的族吗"。
 * 合并成一套，"注册了一个前缀不在体系内的码"这类损坏就没有判据能检出。
 */
export const VALID_PREFIXES: ReadonlySet<string> = Object.freeze(
  new Set([
    'E_INV', 'E_COST', 'E_OP', 'E_HOOK', 'E_EXPR',
    'E_DEC', 'E_FLOW', 'E_PHASE', 'E_INTENT', 'E_REF', 'E_LINK',
  ])
);

/**
 * 封住注册表的写入面。
 *
 * 注册表是全局单例：任何一条测试若能写进去，损坏就会泄漏到后面的用例，
 * 变成"失败取决于跑在第几位"的顺序依赖。封印让这类写入立刻报错而不是静默生效。
 * 注意封的是**实例属性**（遮蔽原型方法），读取面（get/has/迭代）不受影响。
 */
function sealRegistry(): void {
  const deny = (op: string) => () => {
    throw new Error(`E_DIAG_REGISTRY_SEALED:${op}`);
  };
  const m = CODE_REGISTRY as unknown as Record<string, unknown>;
  m['set'] = deny('set');
  m['delete'] = deny('delete');
  m['clear'] = deny('clear');
}
sealRegistry();

export class DiagnosticCollector {
  private diags: Diagnostic[] = [];
  private time = 0;
  private sealed = false;
  /**
   * 成员身份表。与 diags 并存而非合并：
   * emit 用它做 O(1) 的"这个因是不是我发出来的"判定，
   * checkInvariants 另有子句核对它与 diags 一一对应——合并成一套就检不出登记漏/多。
   */
  private members: Set<Diagnostic> = new Set();

  emit(
    code: string,
    source: DiagnosticSource,
    message?: string,
    causedBy?: Diagnostic
  ): Diagnostic {
    const spec = CODE_REGISTRY.get(code);
    if (!spec) {
      throw new Error(`E_DIAG_UNREGISTERED_CODE:${code}`);
    }
    if (!source || !source.layer) {
      throw new Error('E_DIAG_MISSING_ATTRIBUTION');
    }
    // 校验顺序是契约的一部分：两个缺陷共存时优先报未注册码。
    // 顺序颠倒会让"码写错了"被报成"归因缺失"，把调用方引向错误的修法。
    if (causedBy !== undefined && !this.members.has(causedBy)) {
      throw new Error('E_DIAG_FOREIGN_CAUSE');
    }

    const d: Diagnostic = {
      code,
      severity: spec.severity,
      message: message !== undefined && message.trim() !== '' ? message : code,
      // 按值复制：调用方事后改自己那个 source 对象，不应追改已发出的诊断。
      source: { ...source },
      timestamp: this.time++,
    };
    // 条件写入而非恒写：无因时不应留下一个值为 undefined 的 causedBy 键，
    // 否则 'causedBy' in d 为真，序列化与结构比较都会多出一个虚假维度。
    if (causedBy !== undefined) d.causedBy = causedBy;

    this.diags.push(d);
    this.members.add(d);
    if (spec.severity === 'fatal') this.sealed = true;
    return d;
  }

  get all(): readonly Diagnostic[] {
    return [...this.diags];
  }

  get fatals(): Diagnostic[] {
    return this.diags.filter((d) => d.severity === 'fatal');
  }

  get errors(): Diagnostic[] {
    return this.diags.filter((d) => d.severity === 'error');
  }

  get isSealed(): boolean {
    return this.sealed;
  }

  /**
   * 展开因果链，供调用方展示/诊断使用。
   *
   * maxDepth 是**调用方给的展示预算**，不是数据完整性的上界——
   * 超预算报 CHAIN_TOO_DEEP 表示"你要的比预算长"，不表示数据坏了。
   * 不变量检查器不得复用它（见 walkChainForCheck 与缺陷 C01）。
   */
  chainOf(d: Diagnostic, maxDepth = 64): Diagnostic[] {
    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new Error('E_DIAG_INVALID_MAXDEPTH');
    }
    const chain: Diagnostic[] = [];
    const seen = new Set<Diagnostic>();
    let cur: Diagnostic | undefined = d;
    while (cur && chain.length < maxDepth) {
      if (seen.has(cur)) throw new Error('E_DIAG_CAUSAL_CYCLE');
      seen.add(cur);
      chain.push(cur);
      cur = cur.causedBy;
    }
    if (cur) throw new Error('E_DIAG_CHAIN_TOO_DEEP');
    return chain;
  }

  /**
   * 供 checkInvariants 使用的链遍历。与 chainOf 分开的两个理由：
   *
   * 1. **上界不同**。这里的上界随成员数走（diags.length + 1），
   *    因为"链比成员数还长"才真的意味着链上有外来节点或有环——这是数据损坏的判据。
   *    chainOf 的 maxDepth 是展示预算，拿它当损坏判据会把合法长链判成损坏（缺陷 C01）。
   *    +1 是因为链首那一节自己也算一节：N 条成员能串出的最长合法链是 N，
   *    再加上"链尾可能挂着一个刚被 clear 掉的旧世代节点"这一格容差。
   * 2. **不抛异常**。检查器要把所有违规收集齐再返回，不能第一条就中断。
   */
  private walkChainForCheck(d: Diagnostic): { len: number; err?: string } {
    const cap = this.diags.length + 1;
    const seen = new Set<Diagnostic>();
    let cur: Diagnostic | undefined = d;
    let len = 0;
    while (cur) {
      if (seen.has(cur)) return { len, err: 'E_DIAG_CAUSAL_CYCLE' };
      seen.add(cur);
      len++;
      if (len > cap) return { len, err: 'E_DIAG_CHAIN_EXCEEDS_MEMBERSHIP' };
      cur = cur.causedBy;
    }
    return { len };
  }

  /**
   * 清空本世代。刻意**不重置 time**（设计选择 C12）：
   * timestamp 在单个 collector 内保持全局唯一，跨世代也不重号。
   * 看起来"清得不彻底"，但重置才是错的——重号会同时破坏 NON_MONOTONIC_TS
   * 与 CAUSE_NOT_EARLIER 两条判据的前提。
   */
  clear(): void {
    this.diags = [];
    this.sealed = false;
    this.members.clear();
  }

  /**
   * collector 状态的自洽性检查。
   *
   * 每条子句都是**双向**的：既查"该报的报了"，也查反方向
   * （FATAL_NOT_SEALED 配 SEALED_WITHOUT_FATAL）。只查一个方向时，
   * 把判据整体取反的实现能一路绿灯通过（缺陷 C05）。
   *
   * 每条子句的诊断串刻意互不相同并带上定位信息（code / timestamp / 实际取值）：
   * 两条子句共用一个串，就无法区分是哪种损坏，检查器的输出也就失去了可操作性。
   */
  checkInvariants(): string[] {
    const violations: string[] = [];

    for (const d of this.diags) {
      const spec = CODE_REGISTRY.get(d.code);
      if (!spec) {
        violations.push(`UNREGISTERED:${d.code}`);
        continue;
      }

      if (spec.severity !== d.severity) {
        violations.push(`SEVERITY_MISMATCH:${d.code} reg=${spec.severity} got=${d.severity}`);
      }

      if (!VALID_PREFIXES.has(spec.prefix)) {
        violations.push(`BAD_PREFIX:${d.code} prefix=${spec.prefix}`);
      }

      if (!d.source || !d.source.layer) {
        violations.push(`NO_ATTRIBUTION:${d.code}`);
      }

      // 判据看 d.severity 而非 spec.severity：注册表被篡改到与诊断失同步时，
      // 查 spec 会让"诊断自己声称 fatal 却可恢复"这种损坏消失于无形。
      if (d.severity === 'fatal' && spec.recoverable) {
        violations.push(`FATAL_RECOVERABLE:${d.code}`);
      }

      if (d.causedBy && d.causedBy.timestamp >= d.timestamp) {
        violations.push(`CAUSE_NOT_EARLIER:${d.code} cause=${d.causedBy.timestamp} effect=${d.timestamp}`);
      }

      if (d.causedBy && !this.members.has(d.causedBy)) {
        violations.push(`FOREIGN_CAUSE:${d.code} cause=${d.causedBy.code}`);
      }

      const w = this.walkChainForCheck(d);
      if (w.err) violations.push(`CHAIN:${d.code}:${w.err}`);
    }

    // 相邻单调性：用 <= 而非 <，相邻同 timestamp 也是违规——
    // 唯一性是 CAUSE_NOT_EARLIER 判据的前提，放行相等就等于放弃那条判据。
    for (let i = 1; i < this.diags.length; i++) {
      const prev = this.diags[i - 1];
      const curr = this.diags[i];
      if (curr!.timestamp <= prev!.timestamp) {
        violations.push(`NON_MONOTONIC_TS at ${i}`);
      }
    }

    if (this.fatals.length > 0 && !this.sealed) {
      violations.push('FATAL_NOT_SEALED');
    }
    if (this.fatals.length === 0 && this.sealed) {
      violations.push('SEALED_WITHOUT_FATAL');
    }

    if (this.members.size !== this.diags.length) {
      violations.push(`MEMBERS_SIZE_MISMATCH members=${this.members.size} diags=${this.diags.length}`);
    }
    for (const d of this.diags) {
      if (!this.members.has(d)) {
        violations.push(`MEMBERS_MISSING:${d.code}@${d.timestamp}`);
      }
    }

    // 相邻单调性查不出非相邻的重号（如 [0,1,0]），故另设全局唯一性子句。
    const tsSeen = new Set<number>();
    for (const d of this.diags) {
      if (tsSeen.has(d.timestamp)) violations.push(`DUPLICATE_TS:${d.timestamp}`);
      tsSeen.add(d.timestamp);
    }

    return violations;
  }

  /**
   * 注册表自洽性检查。与 checkInvariants 分开，因为它查的是**注册表本身**，
   * 与 collector 状态无关。混在一起会让"哪个损坏被哪条子句检出"无法定位，
   * 也会让空 collector 上的注册表损坏检不出来。
   *
   * static 是这条分离的落实：注册表是全局单例，检查它不需要、也不应该需要一个实例。
   * 做成实例方法会暗示"结论依赖这个 collector 的状态"，而它并不依赖。
   */
  static checkRegistry(): string[] {
    const violations: string[] = [];
    for (const [key, spec] of CODE_REGISTRY) {
      if (key !== spec.code) violations.push(`REG_KEY_MISMATCH:${key} vs ${spec.code}`);
      if (!VALID_PREFIXES.has(spec.prefix)) violations.push(`REG_BAD_PREFIX:${key} prefix=${spec.prefix}`);
      if (spec.prefix !== key.split('_').slice(0, 2).join('_')) {
        violations.push(`REG_PREFIX_NOT_DERIVED:${key} prefix=${spec.prefix}`);
      }
      if (spec.severity === 'fatal' && spec.recoverable) violations.push(`REG_FATAL_RECOVERABLE:${key}`);
      if (spec.severity !== 'fatal' && !spec.recoverable) violations.push(`REG_NONFATAL_UNRECOVERABLE:${key}`);
      if (!Object.isFrozen(spec)) violations.push(`REG_SPEC_MUTABLE:${key}`);
    }
    return violations;
  }
}
