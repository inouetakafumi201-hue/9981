/**
 * L13 Safety: DiagnosticSink, HINT_TEMPLATES, RuleCircuitBreaker, Linter, QuotaEnforcer
 * (design.md 3.14 / requirements 39.1-39.12, Property 20, 29).
 */
import type { ErrCode } from '../state/error-codes.js';
import type { Diagnostic, Severity } from '../state/diagnostic.js';
import { isFatalCode, isInfrastructureFatalCode } from '../state/error-codes.js';
import type { WorldState } from '../state/world-state.js';
import type { RuleCircuitEntry } from '../state/world-state.js';
import type { Id } from '../state/ids.js';
import type { Def } from '../state/def.js';
import type { Expr } from '../state/expr-types.js';
import { collectCallTargets } from '../state/expr-types.js';
import type { AttachmentDef } from '../attachment/types.js';

// ---------------------------------------------------------------------------
// DiagnosticSink: four-severity contract + fatal handling + dedup/folding
// ---------------------------------------------------------------------------

/**
 * `evict` keeps the bounded runtime log usable: oldest low-severity entries may be dropped, and
 * error/fatal entries are never discarded. `halt` is the specification-compiler contract: exhausting
 * capacity is itself an infrastructure failure, because a truncated diagnostic set cannot be trusted.
 */
export type DiagnosticOverflowPolicy = 'evict' | 'halt';

export interface DiagnosticSinkOpts {
  onFatal?: (diag: Diagnostic) => void;
  maxCapacity?: number;
  dedup?: boolean;
  overflowPolicy?: DiagnosticOverflowPolicy;
}

/** Thrown after a fatal diagnostic has been recorded and the caller hook has been notified. */
export class DiagnosticHaltError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = 'DiagnosticHaltError';
  }
}

export class DiagnosticSink {
  private readonly log: Diagnostic[] = [];
  private readonly opts: Required<DiagnosticSinkOpts>;
  private readonly seen = new Set<string>();
  private halted = false;
  private droppedCount = 0;

  constructor(opts: DiagnosticSinkOpts = {}) {
    const maxCapacity = opts.maxCapacity ?? 500;
    if (!Number.isSafeInteger(maxCapacity) || maxCapacity < 1) {
      throw new RangeError('DiagnosticSink maxCapacity 必须是正安全整数');
    }
    this.opts = {
      onFatal: opts.onFatal ?? (() => {}),
      maxCapacity,
      dedup: opts.dedup ?? true,
      overflowPolicy: opts.overflowPolicy ?? 'evict',
    };
  }

  private halt(diag: Diagnostic): never {
    this.halted = true;
    try {
      this.opts.onFatal(diag);
    } catch {
      // 通知回调自身失败不得取代或吞掉终止信号。
    }
    // 通知回调即使正常返回，也不得让 fatal 编译路径恢复执行。
    throw new DiagnosticHaltError(diag);
  }

  emit(diag: Diagnostic): void {
    if (this.halted) throw new DiagnosticHaltError(diag);

    const mustHalt = isHaltingDiagnostic(diag);
    const key = diagnosticDedupKey(diag);

    // fatal 通知必须先于去重判断。否则同位置、同消息的早期低严重度记录可能吞掉终止信号。
    if (mustHalt) {
      if (!this.opts.dedup || !this.seen.has(key)) this.record(diag, key);
      this.halt(diag);
    }

    if (this.opts.dedup && this.seen.has(key)) return;
    this.record(diag, key);
  }

  /**
   * Capacity is a soft presentation limit. Low-severity diagnostics can be
   * evicted oldest-first, whereas error and fatal diagnostics are never
   * discarded or converted into a synthetic fatal overflow.
   */
  private record(diag: Diagnostic, key: string): void {
    if (this.log.length >= this.opts.maxCapacity) {
      if (this.opts.overflowPolicy === 'halt') {
        this.halt({
          code: 'E_QUOTA_DIAGNOSTICS',
          severity: 'fatal',
          haltClass: 'infrastructure',
          message: `Diagnostic capacity ${this.opts.maxCapacity} exhausted`,
          creatorMessage: '问题数量超过系统能够可靠保存的上限，编译已安全停止。',
          hint: '先修复当前已经显示的问题，再重新完整编译。',
          actionableHint: '先修复当前已经显示的问题，再重新完整编译。',
          phase: diag.phase,
          stage: diag.stage,
          scope: 'host',
          compilationId: diag.compilationId,
          baselineId: diag.baselineId,
        });
      }
      const evictionIndex = findEvictionIndex(this.log);
      if (evictionIndex >= 0) {
        const [evicted] = this.log.splice(evictionIndex, 1);
        if (this.opts.dedup && evicted !== undefined) this.seen.delete(diagnosticDedupKey(evicted));
        this.droppedCount++;
      }
    }
    this.log.push(diag);
    if (this.opts.dedup) this.seen.add(key);
  }

  getAll(): readonly Diagnostic[] {
    return this.log;
  }

  getBySeverity(severity: Severity): Diagnostic[] {
    return this.log.filter((d) => d.severity === severity);
  }

  hasFatal(): boolean {
    return this.halted || this.log.some(isHaltingDiagnostic);
  }

  isHalted(): boolean {
    return this.halted;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  /** 仅由拥有者在编译会话已关闭后调用。 */
  clear(): void {
    this.log.length = 0;
    this.seen.clear();
    this.halted = false;
    this.droppedCount = 0;
  }
}

function isHaltingDiagnostic(diag: Diagnostic): boolean {
  return diag.severity === 'fatal' ||
    diag.haltClass === 'infrastructure' ||
    isFatalCode(diag.code) ||
    isInfrastructureFatalCode(diag.code);
}

function findEvictionIndex(log: readonly Diagnostic[]): number {
  const infoIndex = log.findIndex((diag) => diag.severity === 'info');
  return infoIndex >= 0 ? infoIndex : log.findIndex((diag) => diag.severity === 'warn');
}

function diagnosticDedupKey(diag: Diagnostic): string {
  const sourceId = diag.source?.sourceId ?? diag.sourceSpan?.file ?? '';
  const start = diag.source?.span.start.offset ?? diag.sourceSpan?.start.offset ?? -1;
  const end = diag.source?.span.end.offset ?? diag.sourceSpan?.end.offset ?? -1;
  return [
    diag.code,
    diag.severity,
    diag.scope ?? '',
    sourceId,
    start,
    end,
    diag.at?.def ?? '',
    diag.path ?? '',
    diag.phase,
    diag.messageKey ?? diag.message,
  ].join('::');
}

// ---------------------------------------------------------------------------
// HINT_TEMPLATES: completeness self-check (requirement 39.7-39.8)
// ---------------------------------------------------------------------------

export const HINT_TEMPLATES: Record<string, string> = {
  E_REF_MISSING: 'The referenced Id does not exist in the current WorldState. Check spelling or ensure the target object has been created.',
  E_REF_KIND: 'The referenced Def type does not match the expected kind. Check the kind field.',
  E_REF_DESTROYED: 'The referenced object has been destroyed. Check lifecycle management logic.',
  E_REF_ABSTRACT: 'The referenced Def is marked abstract and cannot be instantiated directly. Use a concrete subclass Def instead.',
  E_INV_DANGLING: 'A dangling reference exists: a field points to a non-existent Id.',
  E_INV_CYCLE: 'An inheritance/reference cycle was detected; the DAG must be acyclic.',
  E_INV_DUAL_LOCATION: 'Entity/Item appears in multiple locations simultaneously (violates single-location invariant).',
  E_INV_STACK_LEAK: 'Item stack count is zero but object still exists in a container (stack leak).',
  E_INV_SINGLE_CONTAINMENT: 'Item is held by more than one container (violates single-containment invariant).',
  E_INV_SINGLE_LOCATION: 'Entity simultaneously occupies multiple Nodes (violates single-location invariant).',
  E_INV_LOCATION_EXCLUSIVE: 'Entity has both a location and a container position simultaneously (mutual exclusion violated).',
  E_INV_CONTAINMENT_CYCLE: 'Container containment cycle detected: A contains B and B contains A.',
  E_INV_TOPOLOGY_CONSISTENCY: 'Topology structure inconsistency: Node/Link relationship is asymmetric.',
  E_INV_PARENT_CHILD: 'Parent-child relationship inconsistency: child node does not back-reference parent.',
  E_INV_RELATION_SYMMETRY: 'Relation symmetry violated: relOut/relIn are not mirrors of each other.',
  E_INV_CONTAINER_BIDIRECTIONAL: 'Container bidirectional reference inconsistency.',
  E_INV_SLOT_INDEX_CONTINUITY: 'Container slot index is not contiguous or has holes (shift mode violated).',
  E_INV_ATTACHMENT_CONSISTENCY: 'Attachment target reference does not exist.',
  E_INV_STACK_BOUNDED: 'Item stack exceeds maxStack limit.',
  E_INV_DECISION_TERMINATION: 'Decision is in open state past its deadline.',
  E_INV_NAN_OR_INFINITY: 'Property value contains NaN or Infinity (not a valid Value).',
  E_INV_UNSUPPORTED_TYPE: 'Property value type is not supported.',
  E_OP_SLOT_FULL: 'Target container slot is full; cannot place item.',
  E_OP_NOT_ACCEPTED: 'Operation was rejected by the target (require condition not met).',
  E_OP_VETOED: 'Operation was vetoed by a before-hook.',
  E_OP_NO_LEGAL_SLOT: 'No legal slot found for the item.',
  E_OP_NOT_FOUND: 'Op name is not registered. Check that register() was called.',
  E_OP_INVALID_ARGS: 'Op arguments are invalid. Check argument types and ranges.',
  E_EXPR_TYPE: 'Expression type mismatch: operator received unexpected argument type.',
  E_EXPR_UNKNOWN_OP: 'Unknown expression operator name.',
  E_EXPR_DEPTH: 'Expression evaluation exceeded maximum nesting depth.',
  E_EXPR_CALL_CYCLE: 'Named expression call graph contains a cycle.',
  E_FLOW_BUDGET: 'Flow script exceeded step budget.',
  E_FLOW_NO_MAXITER: 'while effect is missing the required maxIter field.',
  E_FLOW_ABORT: 'Flow was stopped by an abort effect.',
  E_FLOW_INTERNAL: 'Flow encountered an internal execution failure. Stop processing and inspect the original cause.',
  E_FLOW_UNKNOWN_EFFECT: 'The effect shape is not registered. Check the field spelling and active schema.',
  E_HOOK_DEPTH: 'Hook event chain depth exceeded the limit.',
  E_HOOK_REENTRY: 'Same (type, hookId) combination triggered Hook re-entry.',
  E_HOOK_INSTEAD_CONFLICT: 'Multiple instead-phase candidates passed the when condition (only one is allowed).',
  E_COST_INSUFFICIENT: 'Insufficient cost resource: pool available amount is not enough.',
  E_COST_FROZEN_GONE: 'Frozen cost was partially deleted before settlement.',
  E_DEC_VOID: 'Decision is already in void/resolved state; no new answers accepted.',
  E_DEC_QUORUM: 'Decision quorum configuration is invalid.',
  E_LOAD_CONFLICT: 'Two Playpacks define the same Id without an override mapping to resolve the conflict.',
  E_LOAD_CYCLE_DEP: 'Playpack dependency graph contains a cycle.',
  E_LOAD_LINT: 'Playpack loader Linter detected a rule violation.',
  E_LOAD_UNDEFINED_REF: 'Def references another Def Id that does not exist.',
  E_LOAD_SOURCE_INVALID: 'The source cannot be read safely. Check UTF-8 encoding and source metadata.',
  E_LOAD_SOURCE_SPAN: 'The source location is outside the source document.',
  E_LOAD_JSON_SYNTAX: 'The JSON syntax is invalid at the reported location.',
  E_LOAD_DUPLICATE_MEMBER: 'The same object field appears more than once. Keep exactly one value.',
  E_LOAD_PROHIBITED_CONSTRUCT: 'Executable or dynamic content is not allowed in declarative input.',
  E_LOAD_SCHEMA_CONTRACT: 'The candidate does not satisfy the active schema contract.',
  E_LOAD_IDENTITY_CONFLICT: 'A definition or source identity is duplicated or ambiguous.',
  E_LOAD_UNRESOLVED_CONTRACT: 'Equal-authority sources conflict; obtain an authoritative decision before release.',
  E_LOAD_DECISION_ID_REUSED: 'A decision identifier maps to different statements; all source records were preserved.',
  E_LOAD_BASELINE_STALE: 'The active registry changed after validation. Revalidate the complete candidate.',
  E_LOAD_ACTIVATION_FAILED: 'Atomic activation failed; the previous valid state remains active.',
  E_LOAD_MODE_FORBIDDEN: 'This operation is not allowed in the current compiler mode.',
  E_LOAD_DIAGNOSTIC_FACTORY: 'Diagnostic infrastructure failed. Compilation must halt without publishing.',
  E_LOAD_COMPILER_TERMINATED: 'The isolated compiler process terminated before producing a valid result.',
  E_LOAD_WORKER_PROTOCOL: 'The compiler process returned an invalid or oversized protocol message.',
  E_LOAD_PERSISTENCE_CAPABILITY: 'The host storage does not satisfy atomic publication requirements.',
  E_LOAD_STAGE_IO: 'Writing or synchronizing the staging artifact failed.',
  E_LOAD_ATOMIC_RENAME: 'The staging artifact could not be atomically renamed into place.',
  E_LOAD_RECOVERY_CORRUPT: 'The committed artifact chain is invalid or corrupted.',
  E_MIG_NO_PATH: 'No migration path found from the current version to the target version.',
  E_MIG_NEWER_SAVE: 'Save file version is newer than the current game version; cannot reverse-migrate.',
  E_MIG_FAILED: 'Migration execution failed.',
  E_QUOTA_ENTITIES: 'Entity count exceeds the declared quota limit.',
  E_QUOTA_ATTACHMENTS: 'Attachment count exceeds the declared quota limit.',
  E_QUOTA_RULES: 'Rule count exceeds the declared quota limit.',
  E_QUOTA_INPUT_BYTES: 'Input bytes exceed the trusted host limit.',
  E_QUOTA_NESTING_DEPTH: 'Input nesting exceeds the trusted host limit.',
  E_QUOTA_OBJECT_MEMBERS: 'Object member count exceeds the trusted host limit.',
  E_QUOTA_ARRAY_ELEMENTS: 'Array element count exceeds the trusted host limit.',
  E_QUOTA_SOURCE_RECORDS: 'Source record count exceeds the trusted host limit.',
  E_QUOTA_AST_NODES: 'AST node count exceeds the trusted host limit.',
  E_QUOTA_DEFINITIONS: 'Candidate definition count exceeds the trusted host limit.',
  E_QUOTA_REFERENCE_EDGES: 'Reference edge count exceeds the trusted host limit.',
  E_QUOTA_TRAVERSAL_WORK: 'Validation traversal work exceeds the trusted host limit.',
  E_QUOTA_DIAGNOSTICS: 'Diagnostic count exceeds the reporting limit.',
  E_QUOTA_OUTPUT_BYTES: 'Canonical output exceeds the trusted host limit.',
  E_QUOTA_MIGRATION_STEPS: 'The number of schema migration steps exceeds the trusted host limit. Register a shorter migration path or raise the host quota.',

  // Remaining closed-enum entries. Keeping these explicit makes missing creator guidance a testable build failure.
  E_REF_AMBIGUOUS: '多个对象同时匹配该引用。请使用唯一标识，或缩小查询条件。',
  E_REF_PROVIDER_CONTRACT: '引用提供方不满足约定。请检查提供方类型、能力和必填字段。',
  E_REF_CYCLE: '引用关系形成循环。请移除至少一条回指边。',
  E_LOAD_SOURCE_RECORD_MISSING: '规范节点缺少来源记录。请重新生成节点并保留文件、位置和来源标识。',
  E_LOAD_SOURCE_SPAN_CORRUPT: '来源位置数据损坏。请重新读取原文件并重建精确的起止位置。',
  E_LOAD_SOURCE_MAP_LOST: '转换过程中丢失了来源映射。编译已停止，请由维护者修复对应转换阶段。',
  E_LOAD_DIAGNOSTIC_FAILURE: '诊断生成本身失败。编译已安全停止，且不会发布不完整产物。',
  E_LOAD_INPUT_TRUNCATED: '输入内容不完整。请重新读取或上传完整文件后再编译。',
  E_LOAD_SCHEMA_VERSION: 'Schema 版本不受支持。请迁移到当前支持的版本。',
  E_LOAD_UNKNOWN_FIELD: '发现当前 Schema 未定义的字段。请检查拼写或删除该字段。',
  E_LOAD_REQUIRED_FIELD: '缺少必填字段。请按提示路径补齐字段。',
  E_LOAD_FIELD_TYPE: '字段值类型不正确。请改为提示中要求的类型。',
  E_LOAD_DEF_KIND: '定义类别不受支持。请使用已登记的基类层定义类别。',
  E_LOAD_IDENTIFIER_INVALID: '标识格式无效。请使用稳定、非空且符合命名规则的唯一标识。',
  E_LOAD_DUPLICATE_ID: '同一作用域出现重复标识。请重命名其中一个定义。',
  E_LOAD_OVERRIDE_INVALID: '替换声明无效或不唯一。请明确指定现有目标和唯一的新定义。',
  E_LOAD_LAYER_OWNERSHIP: '该字段不属于当前层级。请把规则放回负责它的引擎层、基类层或玩法层。',
  E_LOAD_TERM_NONCANONICAL: '使用了非规范术语。请改用诊断中建议的正式名称。',
  E_LOAD_NUMERIC_OWNERSHIP: '玩法数值出现在错误层级。请将具体约束移到玩法层。',
  E_LOAD_GAMEPLAY_VALUE_RANGE: '玩家可见数值超出 1–5。请调整到允许范围。',
  E_LOAD_CROSS_FIELD_CONSTRAINT: '多个字段的组合不满足约束。请按提示同时调整相关字段。',
  E_LOAD_DEPRECATED_MECHANIC: '该机制已经废弃。请迁移到提示中的当前机制。',
  E_LOAD_SEMANTIC_FIELD_DAMAGED: '关键语义字段在转换后损坏或丢失。编译已停止，请恢复原始语义。',
  E_LOAD_INHERITANCE_CYCLE: '继承关系形成循环。请移除至少一条继承边。',
  E_LOAD_COMPOSITION_CONFLICT: '组合项对同一语义给出不兼容定义。请显式选择或协调冲突项。',
  E_LOAD_ORDER_UNDECLARED: '结果依赖顺序，但未声明稳定顺序。请增加明确排序规则。',
  E_LOAD_SOURCE_DISPLACED: '该陈述被更高优先级来源替代。请查看诊断列出的控制来源。',
  E_LOAD_EQUAL_PRECEDENCE_CONFLICT: '同等权威来源给出不同结论。请先取得带决策编号的权威裁决。',
  E_LOAD_UNRESOLVED_NORMATIVE: '规范规则仍未裁决。生产发布前必须解决该冲突。',
  E_LOAD_SOURCE_STATUS_PROMOTION: '来源状态提升缺少授权依据。请附上确认决策并保留原始记录。',
  E_LOAD_NORMATIVE_WITHOUT_PROVENANCE: '规范陈述缺少可追踪来源。请补齐来源文件、位置和权威级别。',
  E_LOAD_CANONICAL_AMBIGUOUS: '规范化结果不唯一。请消除无序或等价冲突，使输出只有一个确定表示。',
  E_LOAD_CANONICAL_NONDETERMINISTIC: '相同输入产生不同规范化结果。编译已停止，请修复不稳定排序或环境依赖。',
  E_LOAD_ROUNDTRIP_MISMATCH: '产物重新读取后与写出前不一致。请停止发布并检查序列化实现。',
  E_LOAD_COMMIT_RECHECK_FAILED: '提交前复核失败。请基于最新活动状态重新完整验证。',
  E_LOAD_PARTIAL_ACTIVATION: '检测到部分激活。请停止运行并恢复到最后一个完整 generation。',
  E_LOAD_OUTPUT_WRITE_FAILED: '输出写入失败。旧产物仍有效；请检查空间、权限和文件系统状态。',
  E_LOAD_CACHE_ROLLBACK_FAILED: '缓存回滚失败。请清理隔离缓存并从最后有效快照恢复。',
  E_LOAD_PRESENTATION_FALLBACK: '友好提示生成失败，当前显示的是保底诊断。请依据错误码联系维护者。',
  E_LOAD_MIGRATED_SOURCE_REBASED: '文件已自动升级到当前版本，之后报告的行号列号对应升级后的内容，不是你原始文件的位置。请以升级后的内容为准核对。',
  E_MIG_AMBIGUOUS_PATH: '存在多条迁移路径。请指定唯一迁移序列。',
  E_MIG_CYCLE: '迁移依赖形成循环。请移除循环迁移边。',
};

export function checkHintCompleteness(errCodes: Record<string, readonly string[]>): string[] {
  const missing: string[] = [];
  for (const [prefix, suffixes] of Object.entries(errCodes)) {
    for (const suffix of suffixes) {
      const key = `${prefix}_${suffix}`;
      if (!HINT_TEMPLATES[key]) {
        missing.push(key);
      }
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// RuleCircuitBreaker
// ---------------------------------------------------------------------------

export interface CircuitBreakerOpts {
  windowMs?: number;
  threshold?: number;
}

export class RuleCircuitBreaker {
  private readonly windowMs: number;
  private readonly threshold: number;

  constructor(opts: CircuitBreakerOpts = {}) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.threshold = opts.threshold ?? 5;
  }

  recordError(state: WorldState, ruleId: Id, now: number): { state: WorldState; circuitOpen: boolean } {
    const existing = state.world.ruleCircuitState[ruleId] ?? { windowErrors: [], disabled: false };
    const recentErrors = existing.windowErrors.filter((t) => t > now - this.windowMs);
    recentErrors.push(now);
    const shouldDisable = recentErrors.length >= this.threshold;
    const updated: RuleCircuitEntry = { windowErrors: recentErrors, disabled: shouldDisable || existing.disabled };
    const nextState: WorldState = { ...state, world: { ...state.world, ruleCircuitState: { ...state.world.ruleCircuitState, [ruleId]: updated } } };
    return { state: nextState, circuitOpen: updated.disabled };
  }

  isDisabled(state: WorldState, ruleId: Id): boolean {
    return state.world.ruleCircuitState[ruleId]?.disabled ?? false;
  }

  reset(state: WorldState, ruleId: Id): WorldState {
    const { [ruleId]: _removed, ...rest } = state.world.ruleCircuitState;
    return { ...state, world: { ...state.world, ruleCircuitState: rest } };
  }
}

// ---------------------------------------------------------------------------
// Linter (nine categories)
// ---------------------------------------------------------------------------

export interface LintResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

export interface LinterOpts {
  allDefs: Def[];
  customLinter?: (defs: Def[]) => Diagnostic[];
  quotas?: { maxEntities?: number; maxAttachments?: number; maxRules?: number };
}

const DEFAULT_PHASE = 0;

function mkDiag(code: ErrCode, severity: Diagnostic['severity'], message: string, defId?: Id): Diagnostic {
  return { code, severity, message, at: defId ? { def: defId } : undefined, phase: DEFAULT_PHASE };
}

export class Linter {
  run(opts: LinterOpts): LintResult {
    const diagnostics: Diagnostic[] = [];
    const defMap = new Map(opts.allDefs.map((d) => [d.id, d]));

    // 1. Reference existence
    for (const def of opts.allDefs) {
      for (const parentId of def.extends ?? []) {
        if (!defMap.has(parentId)) {
          diagnostics.push(mkDiag('E_LOAD_UNDEFINED_REF', 'error', `Def ${def.id} extends references non-existent ${parentId}`, def.id));
        }
      }
    }

    // 2. Type consistency
    for (const def of opts.allDefs) {
      if (def.kind === 'action' && (def as Record<string, unknown>)['effects'] === undefined) {
        diagnostics.push(mkDiag('E_LOAD_LINT', 'warn', `ActionDef ${def.id} missing effects field`, def.id));
      }
    }

    // 3. while maxIter check
    function checkEffects(defId: Id, effects: unknown[]): void {
      for (const eff of effects) {
        if (typeof eff !== 'object' || eff === null) continue;
        const e = eff as Record<string, unknown>;
        if ('while' in e && (e['maxIter'] === undefined || e['maxIter'] === null)) {
          diagnostics.push(mkDiag('E_FLOW_NO_MAXITER', 'error', `Def ${defId} while effect missing maxIter`, defId));
        }
        if ('do' in e && Array.isArray(e['do'])) checkEffects(defId, e['do'] as unknown[]);
        if ('then' in e && Array.isArray(e['then'])) checkEffects(defId, e['then'] as unknown[]);
        if ('else' in e && Array.isArray(e['else'])) checkEffects(defId, e['else'] as unknown[]);
        if ('try' in e && Array.isArray(e['try'])) checkEffects(defId, e['try'] as unknown[]);
        if ('catch' in e && Array.isArray(e['catch'])) checkEffects(defId, e['catch'] as unknown[]);
      }
    }
    for (const def of opts.allDefs) {
      const effects = (def as Record<string, unknown>)['effects'];
      if (Array.isArray(effects)) checkEffects(def.id, effects as unknown[]);
    }

    // 4. Named-expression call graph cycles
    for (const def of opts.allDefs) {
      if (def.kind === 'expr' && hasCallCycle(def.id, defMap, new Set())) {
        diagnostics.push(mkDiag('E_EXPR_CALL_CYCLE', 'fatal', `具名表达式 ${def.id} 的调用图存在循环`, def.id));
      }
    }

    // 5. Inheritance cycles
    for (const def of opts.allDefs) {
      if (hasCycle(def.id, defMap, new Set())) {
        diagnostics.push(mkDiag('E_LOAD_CYCLE_DEP', 'fatal', `Def ${def.id} has inheritance cycle`, def.id));
      }
    }

    // 6. aura.deps completeness: 每个 deps 条目必须指向一个真实存在且 kind:'attachment' 的 Def
    // （对应本实现的 aura 数据模型：deps 是"变化时应触发重算"的 attachment Def Id 列表，
    // 不是 design.md 早期草案设想的属性路径列表——参见 attachment/types.ts 的 aura 字段实际形状）。
    // deps 悬空引用是一个静默 bug：AuraEngine.onAttachmentChanged 只会用 includes() 做字符串比较，
    // 不存在的 Id 不会报错，只会导致该 aura 永远不会因为它触发重算。
    for (const def of opts.allDefs) {
      if (def.kind !== 'attachment') continue;
      const aura = (def as unknown as AttachmentDef).aura;
      if (!aura) continue;
      for (const depId of aura.deps) {
        const depDef = defMap.get(depId);
        if (!depDef) {
          diagnostics.push(mkDiag('E_LOAD_UNDEFINED_REF', 'error', `Attachment ${def.id} 的 aura.deps 引用了不存在的 Def ${depId}`, def.id));
        } else if (depDef.kind !== 'attachment') {
          diagnostics.push(mkDiag('E_LOAD_UNDEFINED_REF', 'error', `Attachment ${def.id} 的 aura.deps 引用了非 attachment 类型的 Def ${depId}（kind: ${depDef.kind}）`, def.id));
        }
      }
    }

    // 7. 玩法包冲突检测：不在这里实现。Linter.run 的输入是扁平 Def[]，不携带"这个 Def 来自哪个
    // Playpack、与哪些其它 Playpack 同批装载"的信息——冲突判定（同 Id 重复声明、conflicts 字段
    // 互斥声明）天然需要跨 Playpack 的批次视角，只有 PlaypackLoader.load 持有这个视角（它在调用
    // Linter 之前就已经做过 requires/conflicts/重复 Id 检查，见 schedule/playpack.ts）。
    // 因此这里不是遗漏，而是职责边界：Linter 负责单个候选 Def 集合内部的静态一致性，
    // PlaypackLoader 负责跨包装载语义。

    // 8. Custom linter
    if (opts.customLinter) {
      diagnostics.push(...opts.customLinter(opts.allDefs));
    }

    // 9. Quota check
    if (opts.quotas) {
      const entityCount = opts.allDefs.filter((d) => d.kind === 'entity').length;
      const attachCount = opts.allDefs.filter((d) => d.kind === 'attachment').length;
      const ruleCount = opts.allDefs.filter((d) => d.kind === 'rule').length;
      if (opts.quotas.maxEntities !== undefined && entityCount > opts.quotas.maxEntities)
        diagnostics.push(mkDiag('E_QUOTA_ENTITIES', 'error', `Entity Def count ${entityCount} exceeds quota ${opts.quotas.maxEntities}`));
      if (opts.quotas.maxAttachments !== undefined && attachCount > opts.quotas.maxAttachments)
        diagnostics.push(mkDiag('E_QUOTA_ATTACHMENTS', 'error', `Attachment Def count ${attachCount} exceeds quota ${opts.quotas.maxAttachments}`));
      if (opts.quotas.maxRules !== undefined && ruleCount > opts.quotas.maxRules)
        diagnostics.push(mkDiag('E_QUOTA_RULES', 'error', `Rule Def count ${ruleCount} exceeds quota ${opts.quotas.maxRules}`));
    }

    return { ok: !diagnostics.some((d) => d.severity === 'error' || d.severity === 'fatal'), diagnostics };
  }
}

function hasCycle(id: Id, defMap: Map<Id, Def>, visiting: Set<Id>): boolean {
  if (visiting.has(id)) return true;
  const def = defMap.get(id);
  if (!def || !def.extends) return false;
  visiting.add(id);
  for (const parentId of def.extends) {
    if (hasCycle(parentId, defMap, new Set(visiting))) return true;
  }
  return false;
}

/** 与 hasCycle 同构，但走 `{call:Id}` 调用边而非 extends 继承边（需求39.11 第4类检查）。 */
function hasCallCycle(id: Id, defMap: Map<Id, Def>, visiting: Set<Id>): boolean {
  if (visiting.has(id)) return true;
  const def = defMap.get(id);
  if (!def || def.kind !== 'expr') return false;
  const body = (def as unknown as { body?: Expr }).body;
  if (!body) return false;
  visiting.add(id);
  for (const targetId of collectCallTargets(body)) {
    if (hasCallCycle(targetId, defMap, new Set(visiting))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// QuotaEnforcer
// ---------------------------------------------------------------------------

export interface QuotaLimits {
  maxEntities?: number;
  maxAttachments?: number;
  maxRules?: number;
}

export class QuotaEnforcer {
  constructor(private readonly limits: QuotaLimits) {}

  checkEntityQuota(state: WorldState): { ok: boolean; message?: string } {
    const count = Object.keys(state.entities).length;
    if (this.limits.maxEntities !== undefined && count >= this.limits.maxEntities)
      return { ok: false, message: `Entity count ${count} has reached quota limit ${this.limits.maxEntities}` };
    return { ok: true };
  }

  checkAttachmentQuota(state: WorldState): { ok: boolean; message?: string } {
    const count = Object.keys(state.world.attachments).length;
    if (this.limits.maxAttachments !== undefined && count >= this.limits.maxAttachments)
      return { ok: false, message: `Attachment count ${count} has reached quota limit ${this.limits.maxAttachments}` };
    return { ok: true };
  }

  checkRuleQuota(state: WorldState): { ok: boolean; message?: string } {
    const count = Object.values(state.defs).filter((d) => d.kind === 'rule').length;
    if (this.limits.maxRules !== undefined && count >= this.limits.maxRules)
      return { ok: false, message: `Rule Def count ${count} has reached quota limit ${this.limits.maxRules}` };
    return { ok: true };
  }
}
