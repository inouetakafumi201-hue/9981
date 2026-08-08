/**
 * L2 Testing: 独立观察、快照观察与受控故障注入。
 *
 * 对应 Requirements 13.6–13.12、15.2、15.6–15.7、15.13–15.16 与
 * design.md `Test_Interface.observe`、`withFault`、故障注入策略。
 *
 * 铁律：测试接口只能**观察**或经**统一入口**提交候选与动作；
 * 不能直接修改 Semantic_State，也不能绕过 Validator / Resolver / Registry / OpRegistry。
 */

import type { Result } from '../model/result.js';
import type { CanonicalSnapshot } from '../model/snapshot.js';
import type { KernelContract, KernelInvokeResult } from '../kernel/kernel-contract.js';
import type { ActionRequest, CallerContext, OpCause, OpResult, RuntimeSemanticState } from '../model/projection.js';
import type { JsonValue } from '../model/json.js';
import type { DefinitionPackage } from '../model/definition.js';
import { parsePackage, type ParseOptions } from '../codec/json-codec.js';
import { canonicalize, parseCanonical } from '../codec/json-canonicalizer.js';
import { fromUgc, type UgcInput } from '../ugc/ugc-adapter.js';
import { activate, type ActiveRegistry, type ActivationSuccess } from '../registry/definition-registry.js';
import { submit } from '../registry/action-submitter.js';

/** 可观察操作的种类。 */
export const OBSERVABLE_OPERATIONS = [
  'parse',
  'canonicalize',
  'parse-canonical',
  'ugc',
  'activate',
  'submit',
] as const;
export type ObservableOperation = (typeof OBSERVABLE_OPERATIONS)[number];

/** 观察 JSON 解析。 */
export function observeParse(input: string, options: ParseOptions): Result<DefinitionPackage> {
  return parsePackage(input, options);
}

/** 观察规范化。 */
export function observeCanonicalize(input: string): Result<string> {
  return canonicalize(input);
}

export function observeParseCanonical(input: string): Result<JsonValue> {
  return parseCanonical(input);
}

/** 观察 UGC 转换。 */
export function observeUgc(input: UgcInput): Result<DefinitionPackage> {
  return fromUgc(input);
}

/** 观察激活。 */
export function observeActivate(active: ActiveRegistry, candidate: DefinitionPackage): Result<ActivationSuccess> {
  return activate(active, candidate);
}

/** 观察活动注册表快照。 */
export function observeSnapshot(active: ActiveRegistry): CanonicalSnapshot {
  return active.snapshot;
}

// ── 受控故障注入 ────────────────────────────────────────────────────────

/** 故障种类（对应 design.md 故障注入策略）。 */
export const FAULT_KINDS = [
  'op-not-found',
  'op-vetoed',
  'op-invalid-args',
  'l1-invariant-violation',
  'transaction-aborted',
  'hook-unavailable',
] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export interface FaultSpecification {
  readonly kind: FaultKind;
  /** 仅对指定 opId 注入；缺省对所有 op 注入。 */
  readonly opId?: string;
}

/** 可配置的 Kernel double：可注入故障，记录调用，供断言"失败时零写入"。 */
export class FaultInjectableKernel implements KernelContract {
  private invokeCount = 0;
  private readonly journal: string[] = [];
  private stateFingerprint: string;
  private hookAvailable: boolean;
  private fault: FaultSpecification | undefined;

  constructor(
    private readonly runtime: RuntimeSemanticState,
    private readonly registeredOps: ReadonlySet<string>,
    options?: { readonly initialFingerprint?: string; readonly hookAvailable?: boolean },
  ) {
    this.stateFingerprint = options?.initialFingerprint ?? 'state:0';
    this.hookAvailable = options?.hookAvailable ?? true;
  }

  setFault(fault: FaultSpecification | undefined): void {
    this.fault = fault;
  }

  setHookAvailable(available: boolean): void {
    this.hookAvailable = available;
  }

  /** 已发生的写入调用次数（用于断言失败路径为零）。 */
  invocations(): number {
    return this.invokeCount;
  }

  hasOp(opId: string): boolean {
    if (this.fault?.kind === 'op-not-found' && (this.fault.opId === undefined || this.fault.opId === opId)) {
      return false;
    }
    return this.registeredOps.has(opId);
  }

  invoke(opId: string, args: Readonly<Record<string, JsonValue>>, cause: OpCause): KernelInvokeResult {
    const applies = this.fault !== undefined && (this.fault.opId === undefined || this.fault.opId === opId);
    if (applies && this.fault !== undefined) {
      switch (this.fault.kind) {
        case 'op-vetoed':
          return { ok: false, kind: 'vetoed', code: 'E_OP_VETOED', detail: '注入的否决', semanticStateFingerprintAfter: this.stateFingerprint };
        case 'op-invalid-args':
          return { ok: false, kind: 'invalid-args', code: 'E_OP_INVALID_ARGS', detail: '注入的参数错误', semanticStateFingerprintAfter: this.stateFingerprint };
        case 'l1-invariant-violation':
          return { ok: false, kind: 'invariant-violation', code: 'E_INV_DANGLING', detail: '注入的不变量违规', semanticStateFingerprintAfter: this.stateFingerprint };
        case 'transaction-aborted':
          return { ok: false, kind: 'transaction-aborted', code: 'E_FLOW_ABORT', detail: '注入的事务中止', semanticStateFingerprintAfter: this.stateFingerprint };
        default:
          break;
      }
    }
    // 成功：推进指纹并记录（模拟真实写入）。
    this.invokeCount += 1;
    this.journal.push(`op=${opId} req=${cause.requestId}`);
    this.stateFingerprint = `state:${this.invokeCount}`;
    void args;
    return {
      ok: true,
      journalEntries: [...this.journal],
      semanticStateFingerprintAfter: this.stateFingerprint,
    };
  }

  hookIntegrationAvailable(): boolean {
    if (this.fault?.kind === 'hook-unavailable') {
      return false;
    }
    return this.hookAvailable;
  }

  semanticStateFingerprint(): string {
    return this.stateFingerprint;
  }

  runtimeState(): RuntimeSemanticState {
    return this.runtime;
  }
}

/**
 * 在注入故障的前提下执行一次动作提交，返回结果与前后状态指纹。
 * 用于断言：失败时 `invocations()` 为 0 或状态不变。
 */
export function withFault(
  kernel: FaultInjectableKernel,
  fault: FaultSpecification | undefined,
  active: ActiveRegistry,
  request: ActionRequest,
  caller: CallerContext,
): { readonly result: Result<OpResult>; readonly before: string; readonly after: string } {
  const before = kernel.semanticStateFingerprint();
  kernel.setFault(fault);
  const result = submit({ active, kernel, request, caller });
  const after = kernel.semanticStateFingerprint();
  kernel.setFault(undefined);
  return { result, before, after };
}
