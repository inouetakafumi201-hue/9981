/**
 * L11 影子模型（Model）——与产品实现**零共享代码**的独立重写。
 *
 * 两条硬约束，缺一条这个模型就退化成"产品等于产品"：
 *
 * 1. **severity 表是外部字面量，不从 CODE_REGISTRY 读。**
 *    判据必须来自代码之外。若模型 `import { CODE_REGISTRY }` 再拿它算 severity，
 *    改注册表时产品输出与模型期望**一起**变，差异恒不可见——这就是自指判据。
 *    代价是这张表要手工与 reg() 调用保持同步；`registryMatchesModel()` 把这件事
 *    变成一条会红的断言，而不是一句注释。
 *
 * 2. **算法不同。** 产品增量维护 sealed/members（emit 时 push、置位）；
 *    模型在 dump() 时**从操作日志重新推导**一切。同一算法的两份实现
 *    会犯同一个错，重新推导才能抓到增量维护漏更新。
 */

export type Severity = 'fatal' | 'error' | 'warn' | 'info';

/**
 * 全部 29 个注册码的期望 severity，钉成字面量。
 * 依据：仅 `E_INV_*` 为 fatal（FATAL_PREFIXES=['E_INV']），其余按语义分级，
 * `E_DEC_TIMEOUT` 是唯一的 warn。
 */
export const EXPECTED_SEVERITY: Readonly<Record<string, Severity>> = Object.freeze({
  E_INV_DANGLING: 'fatal',
  E_INV_DUAL_LOCATION: 'fatal',
  E_INV_CYCLE: 'fatal',
  E_INV_STACK_LEAK: 'fatal',
  E_COST_INSUFFICIENT: 'error',
  E_COST_OVER_FROZEN: 'error',
  E_COST_NEGATIVE_RESOURCE: 'error',
  E_OP_INVALID_AMOUNT: 'error',
  E_OP_NO_LEGAL_SLOT: 'error',
  E_OP_UNKNOWN: 'error',
  E_HOOK_DEPTH_EXCEEDED: 'error',
  E_HOOK_REENTRY: 'error',
  E_EXPR_TYPE: 'error',
  E_EXPR_DIV_ZERO: 'error',
  E_EXPR_UNKNOWN_VAR: 'error',
  E_DEC_INVALID: 'error',
  E_DEC_INVALID_ANSWER: 'error',
  E_DEC_DUPLICATE: 'error',
  E_DEC_COUNT_MISMATCH: 'error',
  E_DEC_ALREADY_RESOLVED: 'error',
  E_DEC_TIMEOUT: 'warn',
  E_FLOW_REACTION_LIMIT: 'error',
  E_FLOW_INVALID_TRANSITION: 'error',
  E_PHASE_NOT_OPEN: 'error',
  E_PHASE_MULTI_OPEN: 'error',
  E_INTENT_NOT_PENDING: 'error',
  E_INTENT_FROZEN_MISMATCH: 'error',
  E_REF_INVALID: 'error',
  E_LINK_CROSS_SCENE: 'error',
});

/** 独立推导前缀：取前两段。与产品同规则，但这里是重写而非调用。 */
export function expectedPrefix(code: string): string {
  const parts = code.split('_');
  return parts.length >= 2 ? `${parts[0]}_${parts[1]}` : code;
}

export const EXPECTED_PREFIXES: ReadonlySet<string> = Object.freeze(
  new Set(['E_INV', 'E_COST', 'E_OP', 'E_HOOK', 'E_EXPR', 'E_DEC', 'E_FLOW', 'E_PHASE', 'E_INTENT', 'E_REF', 'E_LINK'])
);

export interface ModelSource {
  layer: string;
  op?: string;
  entityId?: string;
  hookId?: string;
  exprPath?: string;
}

/** 模型侧的诊断记录。用数值 id 表示因果，不用对象引用——引用是产品的表示方式。 */
interface ModelEntry {
  seq: number;
  code: string;
  message: string;
  source: ModelSource;
  timestamp: number;
  causeSeq: number | null;
  /** 属于第几个 clear 世代。用于独立推导"跨世代复用因"必须被拒。 */
  generation: number;
}

export interface ModelDump {
  entries: Array<{
    code: string;
    severity: Severity;
    message: string;
    source: string;
    timestamp: number;
    cause: number | null;
  }>;
  sealed: boolean;
  fatalCount: number;
  errorCount: number;
  total: number;
}

export class DiagnosticModel {
  /** 全量日志，跨 clear 保留——用于推导"哪些诊断已不属于当前世代"。 */
  private log: ModelEntry[] = [];
  private seqCounter = 0;
  private timeCounter = 0;
  private generation = 0;

  /**
   * 尝试 emit。返回被接受记录的 seq，或拒绝原因。
   * 拒绝规则在这里**独立重写**一遍，不查产品的任何判断。
   */
  tryEmit(
    code: string,
    source: ModelSource | null | undefined,
    message: string | undefined,
    causeSeq: number | null
  ): { ok: true; seq: number } | { ok: false; reason: string } {
    if (!(code in EXPECTED_SEVERITY)) {
      return { ok: false, reason: `E_DIAG_UNREGISTERED_CODE:${code}` };
    }
    if (!source || !source.layer) {
      return { ok: false, reason: 'E_DIAG_MISSING_ATTRIBUTION' };
    }
    if (causeSeq !== null) {
      // 合法因 = 存在 且 属于当前世代。两个条件独立推导，不查产品的 members。
      const cause = this.log.find((e) => e.seq === causeSeq);
      if (!cause || cause.generation !== this.generation) {
        return { ok: false, reason: 'E_DIAG_FOREIGN_CAUSE' };
      }
    }

    const seq = this.seqCounter++;
    this.log.push({
      seq,
      code,
      // 空串/纯空白退回 code。独立重写，不复用产品的表达式。
      message: message !== undefined && message.trim().length > 0 ? message : code,
      source: { ...source },
      timestamp: this.timeCounter++,
      causeSeq,
      generation: this.generation,
    });
    return { ok: true, seq };
  }

  clear(): void {
    this.generation++;
    // 刻意不重置 timeCounter——独立推导出的同一结论：timestamp 跨世代唯一。
  }

  /** 当前世代的记录。每次调用重新过滤，不维护增量副本。 */
  private live(): ModelEntry[] {
    return this.log.filter((e) => e.generation === this.generation);
  }

  private severityOf(code: string): Severity {
    const s = EXPECTED_SEVERITY[code];
    if (!s) throw new Error(`model: 未知 code ${code}`);
    return s;
  }

  /**
   * 在 dump 时**重新推导** sealed，而不是在 tryEmit 里置位。
   * 产品是增量维护的；两侧算法不同，才可能抓到增量漏更新。
   */
  get sealed(): boolean {
    return this.live().some((e) => this.severityOf(e.code) === 'fatal');
  }

  dump(): ModelDump {
    const live = this.live();
    const seqToIdx = new Map<number, number>();
    live.forEach((e, i) => seqToIdx.set(e.seq, i));

    return {
      entries: live.map((e) => ({
        code: e.code,
        severity: this.severityOf(e.code),
        message: e.message,
        // source 序列化成有序键的字符串：键序不可观测，故排序；
        // 但**不排序 entries 数组本身**——它的顺序是 emit 顺序，是可观测的。
        source: JSON.stringify(
          Object.fromEntries(
            Object.entries(e.source)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
          )
        ),
        timestamp: e.timestamp,
        cause: e.causeSeq === null ? null : (seqToIdx.get(e.causeSeq) ?? -1),
      })),
      sealed: this.sealed,
      fatalCount: live.filter((e) => this.severityOf(e.code) === 'fatal').length,
      errorCount: live.filter((e) => this.severityOf(e.code) === 'error').length,
      total: live.length,
    };
  }

  /** 独立推导链长：沿 causeSeq 走，不调用产品的 chainOf。 */
  chainLength(seq: number): number {
    let n = 0;
    let cur: number | null = seq;
    const seen = new Set<number>();
    while (cur !== null) {
      if (seen.has(cur)) return -1; // 环。模型侧构造不出来，留作对照。
      seen.add(cur);
      n++;
      const e = this.log.find((x) => x.seq === cur);
      if (!e) return -1;
      cur = e.causeSeq;
    }
    return n;
  }
}
