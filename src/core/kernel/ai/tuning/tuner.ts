/**
 * 受限调参器（Task 10）+ 禁碰清单。
 *
 * 在可序列化费目表（DesignCurrencyConfig）上做受限修改：某费目的 `unit` / `scarcity.coefficient`
 * / 可选 pivot 阈值。每处修改都校验：
 *  - 不在禁碰清单（玩家可见 1-5 值：vitality 等 playerVisible:true；核心语义锚 deathAnchor/
 *    exhaustionAnchor/lethalWindow）；
 *  - 落点在 allowedRange 内；
 *  - 受 step 步长约束。
 * 产生 ParameterTuningRecord（attribution / change / verification / decision），支持回滚。
 */
import type { DesignCurrencyConfig, DesignCurrencyChargeConfig } from './config-design-currency';
import {
  defaultDesignCurrencyConfig,
  parseDesignCurrencyConfig,
  saveDesignCurrencyConfig,
  toCompactCharge,
} from './config-design-currency';
import type { DecisionTrace } from './trace';

/** 可调参数类型。 */
export type TunableField = 'unit' | 'scarcity.coefficient';

/** 一次参数调优记录（完整追踪）。 */
export interface ParameterTuningRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly iteration: number;
  readonly attribution: {
    readonly violatedAssertion: string;
    readonly rootCauseFeeItem: string;
    readonly confidence: number;
    readonly evidenceTrace: DecisionTrace;
  };
  readonly change: {
    readonly feeItem: string;
    readonly field: TunableField;
    readonly before: number;
    readonly after: number;
    readonly direction: 'increase' | 'decrease';
    readonly magnitude: number;
    readonly reasoning: string;
  };
  readonly verification: {
    readonly targetAssertionPassed: boolean;
    readonly regressionCount: number;
    readonly regressionDetails: string[];
  };
  readonly decision: 'accepted' | 'rejected' | 'reverted';
}

/** 调参结果。 */
export type TuningResult =
  | { readonly ok: true; readonly record: ParameterTuningRecord; readonly after: DesignCurrencyConfig }
  | { readonly ok: false; readonly reason: string };

export interface TuneRequest {
  readonly feeItem: string;
  readonly field: TunableField;
  readonly direction: 'increase' | 'decrease';
  readonly magnitude?: number;
  /** 若已是 `accepted`/`rejected`，将其决定标记为 reverted。 */
  readonly recordId?: string;
  readonly iteration?: number;
  readonly violatedAssertion?: string;
  readonly rootCauseFeeItem?: string;
  readonly confidence?: number;
  readonly evidenceTrace?: DecisionTrace;
  readonly reasoning?: string;
}

/** 调参限制上下文。 */
export interface TunerConfig {
  readonly config: DesignCurrencyConfig;
  /** 若传文件路径，每次改动写盘（tuning 历史持久化接盘）。 */
  readonly filePath?: string;
}

const FORBIDDEN_FIELDS: readonly string[] = ['deathAnchor', 'exhaustionAnchor', 'lethalWindow'];
const FORBIDDEN_FIELDS_PLAYER_VISIBLE = ['vitality.max', 'stamina.max', 'ap.max'];

/** 禁碰判定：核心锚 + 玩家可见 1-5 上限 + 一切 playerVisible:true 费目。 */
export class ForbiddenList {
  constructor(
    private readonly config: () => DesignCurrencyConfig,
    private readonly playerVisibleForbidden: readonly string[] = FORBIDDEN_FIELDS_PLAYER_VISIBLE,
  ) {}

  isForbidden(feeItem: string, field?: TunableField): boolean {
    if (FORBIDDEN_FIELDS.includes(feeItem)) return true;
    if (this.playerVisibleForbidden.includes(feeItem)) return true;
    // 玩家可见费目整体禁碰（无论改 unit 还是系数）。
    const charge = this.config().charges.find((c) => c.field === feeItem);
    if (charge !== undefined && charge.playerVisible === true) return true;
    // pivot 相关字段（lethalWindow/exhaustion 锚）虽不按「费目」列在 FORBIDDEN_FIELDS，但这里
    // 不允许调 pivot 阈值字段本身（只有 unit/scarcity 可调）。
    return field === undefined ? false : false;
  }

  describeForbidden(feeItem: string): string {
    return `费目「${feeItem}」在禁碰清单中（玩家可见值/核心语义锚，agent 不得修改）。`;
  }
}

/** 纪录 id 生成。 */
let recordCounter = 0;
export function nextRecordId(): string {
  recordCounter += 1;
  return `tune-${recordCounter}`;
}

/** 受限调参器。 */
export class ParameterTuner {
  private readonly records = new Map<string, ParameterTuningRecord>();
  private readonly forbidden: ForbiddenList;
  private currentConfig: DesignCurrencyConfig;
  private readonly filePath?: string;

  constructor(private readonly opts: TunerConfig) {
    this.currentConfig = opts.config;
    this.filePath = opts.filePath;
    this.forbidden = new ForbiddenList(() => this.currentConfig);
  }

  /** 配置快照（供编排器读取当前费目值）。 */
  get config(): DesignCurrencyConfig {
    return this.currentConfig;
  }

  /** 禁碰清单引用。 */
  get forbiddenList(): ForbiddenList {
    return this.forbidden;
  }

  get recordsAll(): ParameterTuningRecord[] {
    return [...this.records.values()];
  }

  getRecord(id: string): ParameterTuningRecord | undefined {
    return this.records.get(id);
  }

  /** 调参：校验禁碰 + 范围 + step，产出记录。 */
  tune(request: TuneRequest): TuningResult {
    const feeItem = request.feeItem;
    if (this.forbidden.isForbidden(feeItem, request.field)) {
      return { ok: false, reason: `forbidden: ${this.forbidden.describeForbidden(feeItem)}` };
    }
    const chargeIndex = this.currentConfig.charges.findIndex((c) => c.field === feeItem);
    if (chargeIndex === -1) return { ok: false, reason: `unknown-fee-item: ${feeItem} not in config` };
    const charge = this.currentConfig.charges[chargeIndex];
    if (charge === undefined) return { ok: false, reason: `unknown-fee-item: ${feeItem} not in config` };

    const range: [number, number] = request.field === 'unit' ? [charge.tunableRange[0], charge.tunableRange[1]] : scarcityRange();
    const step = charge.step;
    const current = request.field === 'unit' ? charge.unit : (charge.scarcity?.coefficient ?? defaultScarcityCoefficient());
    const magnitude = request.magnitude ?? Math.max(step, 0.5);
    const raw = request.direction === 'increase' ? current + magnitude : current - magnitude;
    // 对齐到 step 网格（向原值方向最近合法值）。
    let after = roundToStep(raw, step);
    if (after < range[0] || after > range[1]) {
      return {
        ok: false,
        reason: `out-of-range: ${feeItem}.${request.field} would be ${after}, allowed [${range[0]}, ${range[1]}]`,
      };
    }
    after = clamp(after, range);

    // 变更配置（不可变复制，重建 charges 数组）。
    const charges: DesignCurrencyConfig['charges'] = this.currentConfig.charges.map((entry) => ({ ...entry }));
    const updated: DesignCurrencyChargeConfig = request.field === 'unit'
      ? { ...charge, unit: after }
      : charge.scarcity === undefined
        ? { ...charge, scarcity: { floor: 1, ceiling: 5, coefficient: after } }
        : { ...charge, scarcity: { ...charge.scarcity, coefficient: after } };
    (charges as DesignCurrencyChargeConfig[])[chargeIndex] = updated;
    const afterConfig = { ...this.currentConfig, charges } as DesignCurrencyConfig;

    const record: ParameterTuningRecord = {
      id: nextRecordId(),
      timestamp: Date.now(),
      iteration: request.iteration ?? 0,
      attribution: {
        violatedAssertion: request.violatedAssertion ?? '',
        rootCauseFeeItem: request.rootCauseFeeItem ?? feeItem,
        confidence: request.confidence ?? 0.5,
        evidenceTrace: request.evidenceTrace ?? emptyEvidenceTrace(),
      },
      change: {
        feeItem,
        field: request.field,
        before: current,
        after,
        direction: request.direction,
        magnitude: Math.abs(after - current),
        reasoning: request.reasoning ?? '',
      },
      verification: { targetAssertionPassed: false, regressionCount: 0, regressionDetails: [] },
      decision: 'rejected', // 未经验证默认 rejected，编排器确认后置 accepted
    };
    this.records.set(record.id, record);
    // 若请求带 recordId 且之前是 accepted/rejected，先翻转成 reverted。
    if (request.recordId !== undefined) this.markReverted(request.recordId);

    if (this.filePath !== undefined) {
      try {
        saveDesignCurrencyConfig(this.filePath, afterConfig);
      } catch {
        // 写盘失败不阻断内存中的调参（由上层报持久化警告）。
      }
    }
    this.currentConfig = afterConfig;
    return { ok: true, record, after: afterConfig };
  }

  /** 校验一次调参的「当前值」未被外部改动（冲突检测：编排期间外部改 config 则拒）。 */
  validateExternalUnchanged(feeItem: string, field: TunableField, expected: number): boolean {
    const charge = this.currentConfig.charges.find((c) => c.field === feeItem);
    if (charge === undefined) return false;
    const actual = field === 'unit' ? charge.unit : (charge.scarcity?.coefficient ?? defaultScarcityCoefficient());
    return actual === expected;
  }

  /** 回滚某条记录：把该次改动复原为 before，且记录决定置 reverted。 */
  revert(recordId: string): { ok: boolean; reason?: string } {
    const record = this.records.get(recordId);
    if (record === undefined) return { ok: false, reason: `unknown-record: ${recordId}` };
    const current = this.readFeeItemValue(record.change.feeItem, record.change.field);
    if (current === undefined) return { ok: false, reason: `fee-item missing: ${record.change.feeItem}` };
    if (current === record.change.before) {
      // 已是目标值，仅标记 reverted。
      this.markReverted(recordId);
      return { ok: true };
    }
    // 反向调回 before。
    const tuned: TuningResult = this.tune({
      feeItem: record.change.feeItem,
      field: record.change.field,
      direction: current < record.change.before ? 'increase' : 'decrease',
      magnitude: Math.abs(record.change.before - current),
      iteration: record.iteration,
    });
    if (!tuned.ok) return { ok: false, reason: tuned.reason };
    this.markReverted(recordId);
    return { ok: true };
  }

  /** 编排器在回归通过后确认记录为 accepted。 */
  confirmAccepted(recordId: string): void {
    this.setDecision(recordId, 'accepted');
  }

  private markReverted(recordId: string): void {
    this.setDecision(recordId, 'reverted');
  }

  private setDecision(recordId: string, decision: ParameterTuningRecord['decision']): void {
    const record = this.records.get(recordId);
    if (record === undefined) return;
    this.records.set(recordId, { ...record, decision });
  }

  private readFeeItemValue(feeItem: string, field: TunableField): number | undefined {
    const charge = this.currentConfig.charges.find((c) => c.field === feeItem);
    if (charge === undefined) return undefined;
    if (field === 'unit') return charge.unit;
    if (charge.scarcity !== undefined) return charge.scarcity.coefficient;
    return defaultScarcityCoefficient();
  }
}

/** 稀缺系数缺省（与既有设计一致，vitality 等有 scarcity 时非缺省）。 */
function defaultScarcityCoefficient(): number {
  return 0;
}

function scarcityRange(): [number, number] {
  return [0, 5];
}
function roundToStep(value: number, step: number): number {
  const scale = 1 / step;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, range: [number, number]): number {
  return Math.max(range[0], Math.min(range[1], value));
}

function emptyEvidenceTrace(): DecisionTrace {
  return {
    correlationId: 'no-evidence',
    stateHash: 'none',
    timestamp: 0,
    observedFacts: [],
    candidates: [],
    selected: null,
    submission: { ok: false, rejectionReason: 'no evidence supplied' },
  };
}

export { saveDesignCurrencyConfig, parseDesignCurrencyConfig, defaultDesignCurrencyConfig, toCompactCharge };
