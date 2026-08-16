/**
 * 装载入口、玩法层 Linter、拒绝原因映射与统一提交入口（tasks.md 任务 4.2-4.5 / design.md 2.5、3.16、7.2）。
 *
 * 层级纪律：本文件是玩法层**唯一**可以引用 `OpRegistry` 的模块。即便如此也不持有 `OpContext`，
 * 不直接改 `WorldState`——嵌套 Op 一律由 `FlowInterpreter` 代为调用；本文件对状态的唯一写入是
 * 通过 `OpRegistry.invoke('prop.set', …)` 写装载期的世界配置（这本身是一次合法的顶层 Op 调用）。
 *
 * DEVIATION-10（如实记录，需人工确认）：design.md 3.1 的 `CoreMechanicsLoadOptions` 只含
 * `wired: WiredHooks`。但 `WiredHooks` 不含 `DefRegistry` / `PlaypackLoader` / `WorldStateHolder`，
 * 而装载必须把玩法包的 `Def` 注册进**同一个** `DefRegistry`（Op 的 defLookup 绑定的那个）、经
 * 同一个 `PlaypackLoader` 装载、并向同一个 `holder` 写配置。因此本文件的装载依赖扩展为
 * `CoreMechanicsRuntime`（registry + defRegistry + ruleProvider + playpackLoader + holder）。
 * 这与 Requirement 2.8「玩法层不自建组合根」一致：本文件**不** import `wireHooksIntoRegistry`，
 * 也不构造 Hook/Flow——运行时由调用方（当前只有测试组合根）接线后传入。
 */
import type { OpRegistry } from '../../core/kernel/ops/registry.js';
import type { DefRegistry } from '../../core/kernel/state/def.js';
import type { Def } from '../../core/kernel/state/def.js';
import type { RuleProvider } from '../../core/kernel/events/rule-provider.js';
import type { PlaypackDef, PlaypackLoader, OutcomeDef } from '../../core/kernel/schedule/playpack.js';
import type { WorldStateHolder } from '../../core/kernel/ops/transaction.js';
import type { Diagnostic } from '../../core/kernel/state/diagnostic.js';
import type { ErrCode } from '../../core/kernel/state/error-codes.js';
import type { Result } from '../../core/kernel/ops/result.js';
import type { Value } from '../../core/kernel/state/value.js';
import type { ActionDef, CostSpec } from '../../core/kernel/actions/types.js';
import type { AttachmentDef } from '../../core/kernel/attachment/types.js';
import type { RuleDef } from '../../core/kernel/events/types.js';
import type { LegalAction } from '../../core/kernel/actions/types.js';
import { createProjection } from './projection.js';
import { createTerminalQuery, consumePlayerQueue as consumePlayerQueueOp } from './match-lifecycle.js';
import type { TerminalQuery } from './match-lifecycle.js';
import type {
  BlockedCapability,
  BlockedCapabilityConfig,
  PlayDefExtension,
} from './ownership.js';
import {
  collectBlockedCapabilities,
  playExtensionOf,
  validateConfigUnresolvedRefs,
  validateGameplayValueRange,
  validateNotDeprecated,
  validateNumericOwnership,
  validateProvenance,
  validateTerminology,
  validateUnresolvedGuards,
} from './ownership.js';
import { CoreMechanicsPlaypack, CORE_MECHANICS_RULES } from './defs/playpack.js';
import {
  ATT_BLOCKING,
  MAX_PARALLEL_OPTIONS,
  PATH_COMMITMENTS_REQUIRED,
  PATH_NPC_ENABLED,
  PATH_ROLL_POLICY_READY,
  PATH_TURN_ORDER,
  POOL_AP,
} from './defs/ids.js';
import { FORBIDDEN_STACK_STRATEGY } from './defs/attachments.js';

// ---------------------------------------------------------------------------
// 配置（design.md 3.1）
// ---------------------------------------------------------------------------

/** 投点策略绑定（U-001 未冻结）。 */
export interface RollPolicyBinding {
  readonly enableRandomRoll: boolean;
  readonly baseTierPolicyRef: string | null;
  readonly boostBoundaryPolicyRef: string | null;
}

/** NPC 资源配置（D-052 已冻结默认值）。null 表示该玩法包不启用 NPC。 */
export interface NpcBudgetBinding {
  readonly ap: number;
  readonly staminaMax: number;
  readonly staminaInitial: number;
  readonly usesStamina: boolean;
}

/** 恢复来源白名单条目（Requirement 15.6：七项字段必须齐备）。 */
export interface RecoverySourceBinding {
  readonly sourceId: string;
  readonly targetEligibilityRef: string;
  readonly actionClass: 'paid' | 'attached';
  readonly resource: 'vitality' | 'stamina';
  readonly amount: { readonly kind: 'fixed'; readonly value: 1 | 2 | 3 | 4 | 5 } | { readonly kind: 'toMax' };
  readonly triggerPoint: 'onAttachedInvoke' | 'onCleanup' | 'onActionComplete';
  readonly onFailure: 'rejectWholeAction' | 'skipAttachedOnly';
}

/** 状态生命周期绑定（引用基类层已登记状态实例）。 */
export interface StatusBinding {
  readonly statusDefRef: string;
  readonly duration: { readonly kind: 'turns'; readonly turns: 1 | 2 | 3 | 4 | 5 } | { readonly kind: 'condition'; readonly untilRef: string };
  readonly stack: { readonly kind: 'refreshKeepLonger' } | { readonly kind: 'count'; readonly maxStack: 1 | 2 | 3 | 4 | 5 } | { readonly kind: 'independent' };
  readonly effectRefs: readonly string[];
  readonly interruptionRefs: readonly string[];
}

/** 五并列例外声明（宪法第十二条）。未声明的分组一律按 ≤5 校验。 */
export interface ParallelismException {
  readonly groupId: string;
  readonly rationale: string;
}

export interface CoreMechanicsConfig extends BlockedCapabilityConfig {
  readonly rollPolicy: RollPolicyBinding;
  readonly npcBudget: NpcBudgetBinding | null;
  /** 体力上限：Constitutional_Constant（D-007）。 */
  readonly staminaMax: 5;
  /** 生命上限：Constitutional_Constant（S0 第四条）。 */
  readonly vitalityMax: 5;
  readonly enabledPaidActions: readonly string[];
  readonly enabledAttachedActions: readonly { readonly actionId: string; readonly parentActions: readonly string[] }[];
  readonly gateways: readonly { readonly gatewayId: string; readonly kind: 'resourceConversion' | 'check' | 'condition' }[];
  readonly statuses: readonly StatusBinding[];
  readonly recoverySources: readonly RecoverySourceBinding[];
  readonly parallelismExceptions: readonly ParallelismException[];
  /** 是否要求投点阶段收集强力骰承诺。 */
  readonly requireCommitments: boolean;
}

/** 一个不启用 NPC、不启用随机投点（U-001 阻塞）、无网关的最小合法配置——用于纯核心装载与测试。 */
export function defaultCoreMechanicsConfig(): CoreMechanicsConfig {
  return {
    rollPolicy: { enableRandomRoll: false, baseTierPolicyRef: null, boostBoundaryPolicyRef: null },
    npcBudget: null,
    staminaMax: 5,
    vitalityMax: 5,
    enabledPaidActions: [],
    enabledAttachedActions: [],
    gateways: [],
    statuses: [],
    recoverySources: [],
    parallelismExceptions: [],
    requireCommitments: false,
    hookWiringAccepted: false,
    // D-055：过载已取得规范位阶，最小配置也必须给出完整、内部一致的过载绑定
    // （字面量字段的取值来自 OverloadBinding 的类型定义本身，不是本函数新引入的判断）。
    overload: {
      overloadStatusRef: 'status_overloaded',
      triggerPredicate: 'cur + inc > 5',
      staminaCap: 5,
      loseCurrentRoundActionRightIfNotYetActed: true,
      skipNextRollThenRejoinRoundAfterNext: true,
      rejoinCounterPath: 'entities.{id}.props.overloadRejoinPending',
      rejoinCounterOwnership: 'internal',
      cleanupNaturalRecoveryTriggersOverload: false,
    },
  };
}

export interface CoreMechanicsRuntime {
  readonly registry: OpRegistry;
  readonly defRegistry: DefRegistry;
  readonly ruleProvider: RuleProvider;
  readonly playpackLoader: PlaypackLoader;
  readonly holder: WorldStateHolder;
  /** 合法动作枚举（转发 ActionCatalog.queryActions）；提供后装载成功即构造只读投影。 */
  readonly queryActions?: (actorRef: { readonly $: string }, mode: 'ui' | 'ai') => readonly LegalAction[];
}

export interface CoreMechanicsLoadOptions {
  readonly runtime: CoreMechanicsRuntime;
  readonly config: CoreMechanicsConfig;
  /**
   * 要装载的玩法包（D-081 / L0 第十四条：装载权限不分级）。缺省时为官方
   * `CoreMechanicsPlaypack`——官方 TS 包只保留"默认装载的第一个包"地位，不再拥有源码特权；
   * 传入任意 `PlaypackDef`（官方 TS 构造或 UGC JSON 反序列化）都经同一装载契约进入注册表，
   * 装载后 Def 快照地位等价。
   */
  readonly playpack?: PlaypackDef;
}

export interface CoreMechanicsLoadResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  /** 装载成功后可用的只读投影；失败时为 null（不返回半可用对象）。 */
  readonly projection: unknown | null;
  readonly blocked: readonly BlockedCapability[];
  /** 装载期声明的结局种类（CEME C-1：playpack.outcomes 非空守恒集）。 */
  readonly outcomes: readonly OutcomeDef[];
}

// ---------------------------------------------------------------------------
// 拒绝原因 → 引擎层 ErrCode 映射（design.md 7.2）
// ---------------------------------------------------------------------------

/**
 * 玩法层每一条拒绝路径都必须在此表中有一行；表内每个码都必须在引擎层 ERR_CODES 中存在
 * （由契约测试机械校验）。玩法层不新增任何 ErrCode。
 */
export const PLAY_REJECTION_TO_ERRCODE = {
  ap_insufficient: 'E_COST_INSUFFICIENT',
  stamina_insufficient: 'E_COST_INSUFFICIENT',
  frozen_cost_gone: 'E_COST_FROZEN_GONE',
  precondition_unmet: 'E_OP_NOT_ACCEPTED',
  attached_submitted_standalone: 'E_OP_NOT_ACCEPTED',
  commitment_after_roll: 'E_OP_NOT_ACCEPTED',
  structural_op_vetoed: 'E_OP_VETOED',
  ref_missing: 'E_REF_MISSING',
  phase_guard_failed: 'E_FLOW_ABORT',
  unresolved_policy_guard: 'E_FLOW_ABORT',
  flow_budget_exceeded: 'E_FLOW_BUDGET',
  decision_void: 'E_DEC_VOID',
  unresolved_contract: 'E_LOAD_UNRESOLVED_CONTRACT',
  numeric_ownership_missing: 'E_LOAD_NUMERIC_OWNERSHIP',
  gameplay_value_range: 'E_LOAD_GAMEPLAY_VALUE_RANGE',
  cross_field_constraint: 'E_LOAD_CROSS_FIELD_CONSTRAINT',
  deprecated_mechanic: 'E_LOAD_DEPRECATED_MECHANIC',
  layer_ownership: 'E_LOAD_LAYER_OWNERSHIP',
  term_noncanonical: 'E_LOAD_TERM_NONCANONICAL',
  composition_conflict: 'E_LOAD_COMPOSITION_CONFLICT',
  semantic_field_damaged: 'E_LOAD_SEMANTIC_FIELD_DAMAGED',
  undefined_ref: 'E_LOAD_UNDEFINED_REF',
  equal_precedence_conflict: 'E_LOAD_EQUAL_PRECEDENCE_CONFLICT',
  normative_without_provenance: 'E_LOAD_NORMATIVE_WITHOUT_PROVENANCE',
  presentation_fallback: 'E_LOAD_PRESENTATION_FALLBACK',
  invariant_violated: 'E_INV_DANGLING',
} as const satisfies Record<string, ErrCode>;

export type PlayRejectionReason = keyof typeof PLAY_REJECTION_TO_ERRCODE;

/** 玩法层拒绝原因 → 引擎层 ErrCode。表内一定命中（类型保证），不返回 undefined。 */
export function rejectionErrCode(reason: PlayRejectionReason): ErrCode {
  return PLAY_REJECTION_TO_ERRCODE[reason];
}

// ---------------------------------------------------------------------------
// 玩法层 Linter（task 4.3 / design.md 2.6、3.x 的装载期校验）
// ---------------------------------------------------------------------------

function lintDiag(code: ErrCode, message: string, defId?: string, extra: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code,
    severity: code === 'E_LOAD_PRESENTATION_FALLBACK' ? 'warn' : 'error',
    message,
    ...(defId === undefined ? {} : { at: { def: defId } }),
    phase: 0,
    scope: 'definition',
    ...extra,
  };
}

/** 收集一个效果树里全部 {op} 形态的 Op 名。 */
function collectOpNames(node: unknown, acc: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectOpNames(item, acc);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (typeof record['op'] === 'string' && 'args' in record && !Array.isArray(record['args'])) {
    // {op, args:{...}} 是 Effect 的 op 形态（args 是映射）；Expr 的 {op, args:[...]} 的 args 是数组，
    // 那是表达式算子（如 add/eq），不是 OpRegistry 的 Op，不纳入 Op 合法性校验。
    acc.add(record['op']);
  }
  for (const value of Object.values(record)) collectOpNames(value, acc);
}

/** 一个动作的 cost 是否恰好是 [{pool: ap, amount: 字面量 1}]。 */
function isExactlyOneApLiteral(cost: readonly CostSpec[] | undefined): boolean {
  if (!Array.isArray(cost) || cost.length !== 1) return false;
  const only = cost[0] as { pool?: string; amount?: unknown };
  return only.pool === POOL_AP && only.amount === 1;
}

/** 写入 turnOrder 路径的 prop.set/prop.del/list.* Op（design.md 3.5 的顺序固定性校验）。 */
function writesTurnOrder(node: unknown): boolean {
  let found = false;
  const visit = (n: unknown): void => {
    if (found) return;
    if (Array.isArray(n)) { for (const item of n) visit(item); return; }
    if (n === null || typeof n !== 'object') return;
    const record = n as Record<string, unknown>;
    if (typeof record['op'] === 'string' && record['op'].startsWith('prop.')) {
      const args = record['args'] as Record<string, unknown> | undefined;
      if (args && typeof args['path'] === 'string' && (args['path'] as string).startsWith(PATH_TURN_ORDER)) {
        found = true;
        return;
      }
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(node);
  return found;
}

/**
 * 玩法层 Linter：把 design.md 2.6 与 3.x 的装载期校验逐条落地。全部复用既有 ERR_CODES，不新增码。
 *
 * @param defs       玩法包的全部定义（含 Playpack 自身）
 * @param config     玩法层配置
 * @param opNames    引擎层当前已注册的 Op 名全集（用于 Op 合法性校验）
 * @param playpackId 被装载玩法包的 id（只作配置诊断的归属锚点；诊断内容与包无关）
 */
export function coreMechanicsLinter(
  defs: readonly Def[],
  config: CoreMechanicsConfig,
  opNames: ReadonlySet<string>,
  playpackId: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const def of defs) {
    // 1. 归属 / 值域 / 术语 / 废案 / 来源 / 未冻结项（复用 ownership.ts 的校验器）。
    diagnostics.push(...validateNumericOwnership(def));
    diagnostics.push(...validateGameplayValueRange(def));
    diagnostics.push(...validateProvenance(def));
    diagnostics.push(...validateTerminology(def));
    diagnostics.push(...validateNotDeprecated(def));
    diagnostics.push(...validateUnresolvedGuards(def).filter((d) => d.severity === 'error'));

    const ext: PlayDefExtension | null = playExtensionOf(def);

    // 2. Op 合法性：效果里每个 {op} 都必须是引擎层已注册的 Op（玩法层不新增 Op）。
    const usedOps = new Set<string>();
    collectOpNames((def as Record<string, unknown>)['effects'], usedOps);
    collectOpNames((def as Record<string, unknown>)['onEnter'], usedOps);
    collectOpNames((def as Record<string, unknown>)['onExit'], usedOps);
    collectOpNames((def as Record<string, unknown>)['onAdd'], usedOps);
    collectOpNames((def as Record<string, unknown>)['onRemove'], usedOps);
    collectOpNames((def as Record<string, unknown>)['phases'], usedOps);
    for (const opName of usedOps) {
      if (!opNames.has(opName)) {
        diagnostics.push(lintDiag('E_LOAD_LAYER_OWNERSHIP', `定义 ${def.id} 的效果引用了未注册的 Op「${opName}」（玩法层不得新增 Op）`, def.id, { reason: 'layer_ownership' }));
      }
    }

    // 3. 动作成本类别。
    if (def.kind === 'action') {
      const action = def as ActionDef;
      const costClass = ext?.costClass;
      if (costClass === 'paid') {
        if (!isExactlyOneApLiteral(action.cost)) {
          diagnostics.push(lintDiag('E_LOAD_GAMEPLAY_VALUE_RANGE', `付费动作 ${def.id} 的成本必须恰好是一条 { pool: ap, amount: 字面量 1 }`, def.id, { reason: 'gameplay_value_range' }));
        }
      } else if (costClass === 'attached') {
        if (Array.isArray(action.cost) && action.cost.length !== 0) {
          diagnostics.push(lintDiag('E_LOAD_SEMANTIC_FIELD_DAMAGED', `附着动作 ${def.id} 的成本必须是空数组（不得写成 amount: 0）`, def.id, { reason: 'semantic_field_damaged' }));
        }
        if (ext?.parentActions === undefined || ext.parentActions.length === 0) {
          diagnostics.push(lintDiag('E_LOAD_SEMANTIC_FIELD_DAMAGED', `附着动作 ${def.id} 缺少父付费动作声明（parentActions 非空）`, def.id, { reason: 'semantic_field_damaged' }));
        }
        if (ext?.triggerPoint === undefined) {
          diagnostics.push(lintDiag('E_LOAD_SEMANTIC_FIELD_DAMAGED', `附着动作 ${def.id} 缺少触发时点声明`, def.id, { reason: 'semantic_field_damaged' }));
        }
        if (ext?.requireRef === undefined) {
          diagnostics.push(lintDiag('E_LOAD_SEMANTIC_FIELD_DAMAGED', `附着动作 ${def.id} 缺少前置条件引用`, def.id, { reason: 'semantic_field_damaged' }));
        }
        if (ext?.onFailure === undefined) {
          diagnostics.push(lintDiag('E_LOAD_SEMANTIC_FIELD_DAMAGED', `附着动作 ${def.id} 缺少失败行为声明`, def.id, { reason: 'semantic_field_damaged' }));
        }
      }
    }

    // 4. 状态叠加策略：禁止引擎层 'refresh'（design.md 3.12）。
    if (def.kind === 'attachment') {
      const strategy = (def as AttachmentDef).stackStrategy;
      if (strategy === FORBIDDEN_STACK_STRATEGY) {
        diagnostics.push(lintDiag('E_LOAD_COMPOSITION_CONFLICT', `状态 ${def.id} 使用了引擎层 'refresh' 策略；本 Spec 的"刷新"须映射为 'unique'（剩余时间在 modify 阶段取较长者）`, def.id, { reason: 'composition_conflict' }));
      }
    }

    // 5. turnOrder 写入的挂载点（design.md 3.5）：只允许结算阶段的 Def 写 turnOrder。
    if (writesTurnOrder(def)) {
      const isSettlePhaseDef = def.id.includes('settle') || (def.kind === 'schedule');
      if (!isSettlePhaseDef) {
        diagnostics.push(lintDiag('E_LOAD_LAYER_OWNERSHIP', `定义 ${def.id} 写入了 turnOrder，但它不是结算阶段的定义；行动顺序只能在结算阶段一次性写入`, def.id, { reason: 'layer_ownership' }));
      }
    }
  }

  diagnostics.push(...lintParallelism(defs, config));
  diagnostics.push(...lintConfig(config, playpackId));
  return diagnostics;
}

/** 五并列（design.md 2.7 / Requirement 3.8）：同一父付费动作下的附着动作数 ≤ 5，除非声明例外。 */
function lintParallelism(defs: readonly Def[], config: CoreMechanicsConfig): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const exceptionGroups = new Set(config.parallelismExceptions.map((exception) => exception.groupId));
  const attachedByParent = new Map<string, number>();
  for (const def of defs) {
    if (def.kind !== 'action') continue;
    const ext = playExtensionOf(def);
    if (ext?.costClass !== 'attached') continue;
    for (const parent of ext.parentActions ?? []) {
      attachedByParent.set(parent, (attachedByParent.get(parent) ?? 0) + 1);
    }
  }
  for (const [parent, count] of attachedByParent) {
    if (count > MAX_PARALLEL_OPTIONS && !exceptionGroups.has(parent)) {
      diagnostics.push(lintDiag(
        'E_LOAD_CROSS_FIELD_CONSTRAINT',
        `父付费动作 ${parent} 下的附着动作数 ${count} 超过五并列上限 ${MAX_PARALLEL_OPTIONS}，且未声明宪法例外`,
        parent,
        { reason: 'cross_field_constraint' },
      ));
    }
  }
  return diagnostics;
}

/** 配置级校验：未冻结引用、恢复来源完整性、状态生命周期约束（design.md 3.13、3.15）。 */
function lintConfig(config: CoreMechanicsConfig, playpackId: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // 未冻结项引用（U-001 / T-001 / T-002 数值 / U-003）。
  diagnostics.push(...validateConfigUnresolvedRefs(config, playpackId));

  // 恢复来源：七项字段齐备（Requirement 15.6），且同 (triggerPoint, resource, targetEligibilityRef) 不重复。
  const recoveryKeys = new Set<string>();
  for (const source of config.recoverySources) {
    const missing: string[] = [];
    if (!source.sourceId) missing.push('sourceId');
    if (!source.targetEligibilityRef) missing.push('targetEligibilityRef');
    if (source.actionClass !== 'paid' && source.actionClass !== 'attached') missing.push('actionClass');
    if (source.resource !== 'vitality' && source.resource !== 'stamina') missing.push('resource');
    if (source.amount === undefined) missing.push('amount');
    if (source.triggerPoint === undefined) missing.push('triggerPoint');
    if (source.onFailure === undefined) missing.push('onFailure');
    if (missing.length > 0) {
      diagnostics.push(lintDiag('E_LOAD_SEMANTIC_FIELD_DAMAGED', `恢复来源 ${source.sourceId || '<未命名>'} 缺少必填字段：${missing.join(', ')}`, undefined, { reason: 'semantic_field_damaged' }));
      continue;
    }
    const key = `${source.triggerPoint}::${source.resource}::${source.targetEligibilityRef}`;
    if (recoveryKeys.has(key)) {
      diagnostics.push(lintDiag('E_LOAD_CONFLICT', `恢复来源 ${source.sourceId} 与已登记来源在同一触发时点/资源/目标资格上重复`, undefined, { reason: 'composition_conflict' }));
    }
    recoveryKeys.add(key);
    if (source.amount.kind === 'fixed' && source.actionClass === 'attached' && (source.amount.value < 1 || source.amount.value > 2)) {
      diagnostics.push(lintDiag('E_LOAD_GAMEPLAY_VALUE_RANGE', `附着类恢复来源 ${source.sourceId} 的单次恢复量必须是 1 或 2`, undefined, { reason: 'gameplay_value_range' }));
    }
  }

  // 状态生命周期：配置完整性 + 格挡/隐蔽必须条件持续（Requirement 13.8、14.2）。
  for (const status of config.statuses) {
    const missing: string[] = [];
    if (status.duration === undefined) missing.push('duration');
    if (status.stack === undefined) missing.push('stack');
    if (status.effectRefs === undefined) missing.push('effectRefs');
    if (status.interruptionRefs === undefined) missing.push('interruptionRefs');
    if (missing.length > 0) {
      diagnostics.push(lintDiag('E_LOAD_SEMANTIC_FIELD_DAMAGED', `状态 ${status.statusDefRef} 配置缺少必填项：${missing.join(', ')}（不得补全默认语义）`, status.statusDefRef, { reason: 'semantic_field_damaged' }));
    }
    if (status.statusDefRef === ATT_BLOCKING && status.duration?.kind !== 'condition') {
      diagnostics.push(lintDiag('E_LOAD_COMPOSITION_CONFLICT', `格挡状态 ${status.statusDefRef} 必须是条件持续（duration.kind === 'condition'），不得因回合结束自动移除`, status.statusDefRef, { reason: 'composition_conflict' }));
    }
  }

  return diagnostics;
}

function hasBlocking(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error' || d.severity === 'fatal');
}

// ---------------------------------------------------------------------------
// 装载入口（task 4.2 / design.md 2.5 的八步顺序）
// ---------------------------------------------------------------------------

/**
 * 装载核心机制玩法包。
 *
 * 玩法包来源（D-081 / L0 第十四条）：`opts.playpack` 未传时默认官方 `CoreMechanicsPlaypack`——
 * 官方包只是"默认装载的第一个玩法包"，不再持有源码特权。注入包的 def 集合、id 与规则集合
 * 决定本装载的一切派生：lint 目标、`PlaypackLoader.load` 输入、配置校验锚点、常驻规则挂载
 * 与 `CoreMechanicsFacade` 的附着动作集。默认路径（不传 playpack）的派生输入与改造前
 * 逐字节一致，行为不变。
 *
 * 顺序：玩法层 Linter + 配置校验（先于任何注册表改动）→ 若阻塞则原子拒绝（注册表状态不变）→
 * PlaypackLoader.load（引擎层 Linter + 注册 defs）→ 规则挂进 RuleProvider → 写装载期世界配置 →
 * 构造只读投影。任一诊断为 error/fatal → ok:false、projection:null（不返回半可用对象）。
 */
export function loadCoreMechanics(opts: CoreMechanicsLoadOptions): CoreMechanicsLoadResult {
  const { runtime, config } = opts;
  const playpack = opts.playpack ?? CoreMechanicsPlaypack;
  const diagnostics: Diagnostic[] = [];
  const blocked = collectBlockedCapabilities(config);

  // Step 1-2：玩法层 Linter + 配置校验（先于注册表改动，保证原子拒绝时注册表不变）。
  // 只 lint 具体 Def，不把 playpack 根当 Def 扫：`writesTurnOrder`/`collectOpNames` 会递归遍历
  // playpack 的 `defs` 数组——playpack 根自身不含 effects/turnOrder，把根一并扫会把 `defs` 里
  // 合法写 turnOrder 的结算规则误判指向 playpack 根（kind==='playpack' 非 settle），报
  // E_LOAD_LAYER_OWNERSHIP。叶子 def 已各自携带归属扩展并会被逐条校验。
  const opNames = new Set(runtime.registry.listOpNames());
  const lintTargets: Def[] = [...playpack.defs];
  diagnostics.push(...coreMechanicsLinter(lintTargets, config, opNames, playpack.id));
  if (hasBlocking(diagnostics)) {
    return { ok: false, diagnostics, projection: null, blocked, outcomes: playpack.outcomes ?? [] };
  }

  // Step 3：引擎层装载（PlaypackLoader 内部 fork 一个候选注册表，失败不影响活动注册表）。
  const loadResult = runtime.playpackLoader.load(playpack);
  diagnostics.push(...loadResult.diagnostics);
  if (!loadResult.ok) {
    return { ok: false, diagnostics, projection: null, blocked, outcomes: playpack.outcomes ?? [] };
  }

  // Step 4：常驻规则挂进同一 Hook 管道。规则集合同样随注入包派生：官方包经
  // CORE_MECHANICS_RULES 提供，注入包从自己的 `rules` 引用解析（与 PlaypackActivator 同语义，
  // 见 playpack-runtime.ts 的 mountPermanentRules）。注入包未声明 rules 时不挂任何规则。
  const mountedRuleIds = playpack === CoreMechanicsPlaypack
    ? CORE_MECHANICS_RULES.map((rule) => rule.id)
    : playpack.rules ?? [];
  for (const ruleId of mountedRuleIds) {
    const definition = runtime.defRegistry.resolve(ruleId);
    if (definition === null || definition.kind !== 'rule') {
      diagnostics.push(lintDiag('E_LOAD_UNDEFINED_REF', `注入包 ${playpack.id} 的常驻规则 ${ruleId} 不存在或不是 RuleDef`, ruleId, { reason: 'undefined_ref' }));
      return { ok: false, diagnostics, projection: null, blocked, outcomes: playpack.outcomes ?? [] };
    }
    runtime.ruleProvider.add(definition as RuleDef);
  }

  // Step 5：写装载期世界配置（合法 Op 调用，不直接改 WorldState）。
  const rollPolicyReady = config.rollPolicy.enableRandomRoll
    && config.rollPolicy.baseTierPolicyRef !== null
    && config.rollPolicy.boostBoundaryPolicyRef !== null;
  const configWrites: readonly { readonly path: string; readonly value: Value }[] = [
    { path: PATH_ROLL_POLICY_READY, value: rollPolicyReady },
    { path: PATH_COMMITMENTS_REQUIRED, value: config.requireCommitments },
    { path: PATH_NPC_ENABLED, value: config.npcBudget !== null },
  ];
  for (const write of configWrites) {
    const result = runtime.registry.invoke<{ path: string; value: Value }, void>('prop.set', write);
    if (!result.ok) {
      diagnostics.push(lintDiag('E_LOAD_ACTIVATION_FAILED', `写装载期世界配置失败：${write.path} → ${result.detail}`, undefined, { reason: 'invariant_violated' }));
      return { ok: false, diagnostics, projection: null, blocked, outcomes: playpack.outcomes ?? [] };
    }
  }

  const projection = runtime.queryActions
    ? createProjection({ getState: () => runtime.holder.getState(), queryActions: runtime.queryActions })
    : null;
  return { ok: true, diagnostics, projection, blocked, outcomes: playpack.outcomes ?? [] };
}

// ---------------------------------------------------------------------------
// 统一提交入口（task 4.4 / design.md 3.16）
// ---------------------------------------------------------------------------

export interface ActionRequest {
  readonly actorRef: { readonly $: string };
  readonly actionId: string;
  readonly bindings: Record<string, Value>;
  /** 附着动作只能作为父动作请求的一部分出现，不能作为独立请求的 actionId。 */
  readonly attached?: readonly { readonly actionId: string; readonly bindings: Record<string, Value> }[];
}

export interface SubmitAck {
  readonly intentId: string;
}

/**
 * 唯一提交入口。UI / AI / UGC / 网络输入全部经过它，得到同一合法性判定与同一拒绝原因。
 *
 * `submit` **没有来源参数**——这在类型层面保证 UI/AI/UGC 无法走不同校验路径（Requirement 16.7、18.2）。
 * 内部只做参数整形 + `OpRegistry.invoke`，不做来源相关分支，不抛玩法层异常。
 */
export class CoreMechanicsFacade {
  private readonly registry: OpRegistry;
  private readonly attachedActionIds: ReadonlySet<string>;

  /**
   * @param registry 引擎层 Op 注册表（与 `loadCoreMechanics` 的 runtime.registry 同一实例）。
   * @param playpack 该 Facade 服务的目标玩法包；缺省为官方 `CoreMechanicsPlaypack`
   *   （与 `loadCoreMechanics` 的默认包一致）。附着动作全集随注入包派生——默认路径的派生输入
   *   与改造前逐字节一致，行为不变。
   */
  constructor(
    registry: OpRegistry,
    playpack: PlaypackDef = CoreMechanicsPlaypack,
  ) {
    this.registry = registry;
    this.attachedActionIds = new Set(
      playpack.defs
        .filter((def): def is ActionDef => def.kind === 'action' && playExtensionOf(def)?.costClass === 'attached')
        .map((def) => def.id),
    );
  }

  submit(req: ActionRequest): Result<SubmitAck> {
    // 附着动作被独立提交 → 结构化拒绝，状态不变（Requirement 8.8）。
    if (this.attachedActionIds.has(req.actionId)) {
      return { ok: false, code: rejectionErrCode('attached_submitted_standalone'), detail: `附着动作 ${req.actionId} 不能作为独立请求提交` };
    }
    const attachedBindings = (req.attached ?? []).map((item) => ({
      actionId: item.actionId,
      ...item.bindings,
    }));
    const args = {
      action: req.actionId,
      agent: req.actorRef.$,
      bindings: { ...req.bindings, attached: attachedBindings as unknown as Value },
    };
    const result = this.registry.invoke<typeof args, { $: string }>('intent.submit', args);
    if (!result.ok) return result;
    return { ok: true, value: { intentId: result.value.$ } };
  }

  resolve(intentId: string): Result<void> {
    return this.registry.invoke<{ id: string }, void>('intent.resolve', { id: intentId });
  }

  advancePhase(): Result<void> {
    return this.registry.invoke<Record<string, never>, void>('schedule.advance', {});
  }

  consumePlayerQueue(): Result<void> {
    return consumePlayerQueueOp(this.registry);
  }

  /** 装载后的终局/回合只读查询（round / matchEnded 均为 Internal_Metric，投影禁止展示）。 */
  terminal(): TerminalQuery {
    // 只读当前已提交的顶层状态（holder 是顶层事务的唯一状态源，registry 内部持有它）。
    return createTerminalQuery(() => this.registry['holder'].getState());
  }
}

