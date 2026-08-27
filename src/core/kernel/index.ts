/**
 * 元机制内核对外的唯一入口（design.md 第2章模块目录 / 6.4节"导出面即 3.4-3.15 节列出的公开接口的并集"）。
 *
 * 这个文件的存在本身就是一条被机械校验的边界声明，不是便利性的 barrel 文件：
 *
 * 1. **导出面是需求42（明确排除的边界）的检验对象**。`__tests__/boundary-absence.test.ts`
 *    直接扫描本文件的导出符号名与本文件的源码文本，断言坐标系类型、真实时钟接口、
 *    Flow 的函数定义/闭包语法、寻路算法自定义扩展点、网络协议类型五类接口在此不存在。
 *    因此本文件**必须**使用显式具名 re-export，不得用 `export *`——`export *` 会让
 *    "导出面"随被导入模块的增删而漂移，使需求42 的架构测试失去可判定的观测对象。
 *
 * 2. **表现层只能看到 PresentationGateway**（需求40.5、design 3.15节）。本文件同时导出
 *    `OpRegistry` 与 `PresentationGateway`，是因为宿主（服务端权威循环）需要前者、
 *    渲染层需要后者；两者的隔离由 `.eslintrc.cjs` 中"渲染层禁止 import kernel/ops"的
 *    `no-restricted-imports` 规则强制，而不是靠本文件少导出一点来实现。
 *
 * 3. **不导出 spec-compiler 与 ai 两个子目录**。`kernel/spec-compiler` 属于
 *    《06_规范编译器与诊断体系》的范围，`kernel/ai` 属于 wakeup-ai spec 的范围，
 *    二者都不是 design.md 第2章列出的 13 层之一，因此不在本内核的导出契约内。
 *    需要它们的调用方直接 import 对应子路径。
 */

// ===========================================================================
// L1 State — 需求 1、2、3、4、5、6
// ===========================================================================

export {
  ID_PREFIXES,
  WORLD_REF,
  idPrefixOf,
  isValidIdPrefix,
  isRef,
  makeRef,
  nextId,
  resetIdCounters,
} from './state/ids';
export type { Id, IdPrefix, Ref } from './state/ids';

export { isFiniteNumber, isValidValue, validateValue } from './state/value';
export type { Value, ValueValidationResult } from './state/value';

export { DefRegistry } from './state/def';
export type { Def, DefKind, DefRegisterResult, ContainerSpec, SlotSpec } from './state/def';

export { createEntityShape, createItemShape } from './state/entity';
export type { Entity, Item } from './state/entity';

export { createAttachmentShape, cascadeRemovalSet } from './state/attachment';
export type { Attachment } from './state/attachment';

export { createAgentShape } from './state/agent';
export type { Agent, AgentKind } from './state/agent';

export { RelationIndex } from './state/relation';
export type { Relation } from './state/relation';

export { hasTag } from './state/tag';
export type { Taggable } from './state/tag';

export { createEmptyWorldState, TOP_LEVEL_COLLECTION_KEYS } from './state/world-state';
export type {
  WorldState,
  WorldTop,
  TurnState,
  RngStreamState,
  DecisionState,
  IntentState,
  RuleCircuitEntry,
  DeferredEffect,
  LogEntry,
} from './state/world-state';

export { DEFAULT_LOG_RETENTION, applyLogRetention, appendLogEntry, logEntryToValue } from './state/event-log';
export type { LogRetention } from './state/event-log';

export { collectCallTargets } from './state/expr-types';
export type { Expr, Query, QueryFrom } from './state/expr-types';

export {
  ERR_CODES,
  FATAL_PREFIXES,
  INFRASTRUCTURE_FATAL_CODES,
  isFatalCode,
  isInfrastructureFatalCode,
} from './state/error-codes';
export type { ErrCode } from './state/error-codes';

export type { Diagnostic, Severity } from './state/diagnostic';

// ===========================================================================
// L1 Topology — 需求 7、8、9、10、11
//
// 需求42.1 的边界在这里最容易被违反：拓扑只导出 Node/Link/Container/Slot 与
// dist/spread/shortestPath/radius 这些图上的度量，不导出任何坐标、向量、
// 位置矢量或距离场类型。若将来有人想加 `Vec2`/`Position`，那属于表现层的
// 布局数据，应落在 src/scene，不能进这条导出面。
// ===========================================================================

export { createNodeShape, createLinkShape, createSlotShape, createContainerShape } from './topology/types';
export type { Node, Link, Slot, Container } from './topology/types';

export {
  insertSlot,
  insertSlotFixed,
  insertSlotShift,
  removeSlot,
  removeSlotFixed,
  removeSlotShift,
  findDefaultSlotIndex,
  setSlotHolds,
} from './topology/container';

export { linksTouching, connectedComponents, childNodesOf, cascadeNodeDestroySet } from './topology/graph';

export { dist, spread, shortestPath, radius } from './topology/metrics';
export type { DistOpts, SpreadOpts, SpreadResult } from './topology/metrics';

export { ensureMicroScene, onMicroSceneOccupantsChanged, checkMicroSceneCapacity } from './topology/micro-scene';
export type { MicroSceneSpec, CreateNodeFn } from './topology/micro-scene';

export { buildKeyToIdMap, remapLinks, resolveAttachToRoot } from './topology/prefab';
export type { PrefabDef, PrefabHandle } from './topology/prefab';

// ===========================================================================
// L2 Expr / Query — 需求 12、13、14、15
// ===========================================================================

export { ExprEngine, makeDefaultEvalContext } from './expr/engine';
export type { EvalContext, ExprOpImpl } from './expr/engine';

export { checkPure, registerExprDef, applyOverrides } from './expr/named-expr';
export type { ExprDef, PureCheckResult } from './expr/named-expr';

export { QueryEngine, collectSourceRefs } from './expr/query-engine';
export type { QueryRunDeps } from './expr/query-engine';

export { makeExprStateAccess, asRef } from './expr/state-access';
export type { ExprStateAccess, TopologyOpOpts } from './expr/state-access';

// ===========================================================================
// L3 Ops / Transactions — 需求 16、17、18、19、20、21
//
// 这一段是"唯一写入通道"（需求16.1）的导出面：外部只能拿到 OpRegistry 与
// 各层的 registerXxxOps 注册函数，拿不到任何直接改写 WorldState 字段的入口。
// setPath/deletePath 是 prop.* 系列 Op 的内部实现，故意不出现在这里。
// ===========================================================================

export { OpRegistry } from './ops/registry';
export type { OpContext, OpImpl, InvokeHooks } from './ops/registry';

export { ok, err } from './ops/result';
export type { Result } from './ops/result';

export { Transaction, WorldStateHolder } from './ops/transaction';
export type { JournalEntry } from './ops/transaction';

export { InvariantChecker, ALL_INVARIANT_CHECKS } from './ops/invariants';

export { getPath, isWritablePropsPath } from './ops/path';

export { checkInstantiable } from './ops/def-guard';
export type { DefLookupFn } from './ops/def-guard';

export { registerPropOps, makePropAdd, propSet, propDel, listInsert, listRemove, listMove } from './ops/prop-ops';
export type {
  PropSetArgs,
  PropDelArgs,
  PropAddArgs,
  ListInsertArgs,
  ListRemoveArgs,
  ListMoveArgs,
  TagArgs,
} from './ops/prop-ops';

export {
  registerStructuralOps,
  makeEntityCreate,
  entityDestroy,
  makeItemCreate,
  itemDestroy,
  makeNodeCreate,
  nodeDestroy,
  makeLinkCreate,
  linkDestroy,
  slotAdd,
  slotDel,
  makeItemMove,
  makeEntityPlace,
  itemPromote,
  makeEntityDemote,
  materializeDefContainers,
  createContainerForOwner,
} from './ops/structural-ops';
export type {
  EntityCreateArgs,
  EntityDestroyArgs,
  ItemCreateArgs,
  ItemDestroyArgs,
  NodeCreateArgs,
  NodeDestroyArgs,
  LinkCreateArgs,
  LinkDestroyArgs,
  SlotAddArgs,
  SlotDelArgs,
  ItemMoveArgs,
  ItemMoveDeps,
  EntityPlaceArgs,
  ItemPromoteArgs,
  EntityDemoteArgs,
} from './ops/structural-ops';

export { registerStackOps, makeStackSplit, stackMerge } from './ops/stack-ops';
export type { StackSplitArgs, StackMergeArgs } from './ops/stack-ops';

export {
  registerRelationOps,
  relationSet,
  relationDel,
  relOut,
  relIn,
  removeAllRelationsInvolving,
} from './ops/relation-ops';
export type { RelationSetArgs, RelationDelArgs } from './ops/relation-ops';

export { registerTransformOps, makeEntitySetDef, nodeMerge, makeNodeSplit } from './ops/transform-ops';
export type { CarryField, EntitySetDefArgs, NodeMergeArgs, NodeSplitArgs, NodeSplitSpec } from './ops/transform-ops';

export { registerAgentOps, agentCreate, agentBind, agentUnbind } from './ops/agent-ops';
export type { AgentCreateArgs, AgentBindArgs, AgentUnbindArgs } from './ops/agent-ops';

export { registerOutcomeOps, outcomeReach } from './ops/outcome-ops';
export type { OutcomeReachArgs } from './ops/outcome-ops';

export { registerPrefabOps } from './ops/prefab-ops';
export type { PrefabSpawnArgs, PrefabDespawnArgs, PrefabOpsDeps } from './ops/prefab-ops';

export {
  attachmentsCascadeFor,
  cascadeRelationsAndAttachments,
  destroyOwnedContainers,
  clearHoldingSlot,
} from './ops/cascade-destroy';

// ===========================================================================
// L4 Events / Hooks — 需求 23、24
// ===========================================================================

export { HookDispatcher } from './events/dispatcher';
export type { HookCandidate, HookDiagnostic, HookDispatcherDeps, EffectRunner } from './events/dispatcher';

export { RuleProvider } from './events/rule-provider';
export type { DynamicRuleResolver } from './events/rule-provider';

export type { Event, HookPhase, RuleDef, DispatchResult } from './events/types';

// ===========================================================================
// L5 Flow — 需求 22
//
// 需求42.3 的边界：Effect 联合类型里没有 `fn`/`def`/`lambda`/`closure` 形态，
// FlowInterpreter 也不导出任何"注册自定义 Effect 形态"的接口。
// ===========================================================================

export { FlowInterpreter } from './flow/interpreter';
export type { FlowInterpreterDeps, FlowRunResult } from './flow/interpreter';
export type { Effect } from './events/effect-types';

// ===========================================================================
// L6 Actions — 需求 25、26
// ===========================================================================

export { ActionCatalog } from './actions/catalog';
export type { ActionCatalogDeps, QueryMode } from './actions/catalog';

export type { ActionDef, TargetSpec, CostSpec, LegalAction } from './actions/types';

export { freezeCost, settleCost, refundCost } from './actions/cost';
export type { FrozenCostEntry, Reservation, CostSettleDeps } from './actions/cost';

export { registerPoolOps } from './actions/pool-ops';
export type {
  PoolResetTrigger,
  PoolInitializeArgs,
  PoolSetArgs,
  PoolAddArgs,
  PoolGetArgs,
  PoolResetArgs,
  PoolAddResult,
  PoolOpsDeps,
} from './actions/pool-ops';

// ===========================================================================
// L7 Decision / Intent — 需求 27、28、29
// ===========================================================================

export {
  registerDecisionOps,
  makeDecisionOpen,
  makeDecisionAnswer,
  makeProcessDecisionTimeouts,
  decisionClose,
  checkQuorum,
} from './decision/decision-ops';
export type { DecisionDefLookup, DecisionAnswerDeps, QuorumCheckFn } from './decision/decision-ops';

export { registerIntentOps } from './decision/intent-ops';
export type {
  IntentSubmitArgs,
  IntentResolveArgs,
  IntentVoidArgs,
  IntentRevealArgs,
  IntentOpsDeps,
} from './decision/intent-ops';

export { queryPendingIntentsFor, queryAllPendingIntents } from './decision/response-phase';
export type { ResponsePhaseDef } from './decision/response-phase';

export type { DecisionDef, DecisionOpenArgs, DecisionAnswerArgs } from './decision/types';

// ===========================================================================
// L8 Attachment — 需求 30
// ===========================================================================

export { registerAttachOps } from './attachment/attach-ops';
export type { AttachAddArgs, AttachDelArgs, AttachExpireArgs, AttachOpsDeps } from './attachment/attach-ops';

export { AuraEngine } from './attachment/aura-engine';
export type { AuraComputeResult, AuraEngineOpts } from './attachment/aura-engine';

export type { AttachmentDef, AttachStackStrategy } from './attachment/types';

// ===========================================================================
// L9 Schedule / Playpack / Policy — 需求 31、32、33、34
//
// 需求42.2 的边界：相位推进只有 `schedule.advance` 这一个 Op，
// 本段不导出任何 setInterval/setTimeout/Clock/RealTime 接口。
// ===========================================================================

export { registerScheduleOps } from './schedule/schedule-ops';
export type { ScheduleAdvanceArgs, ScheduleOpsDeps } from './schedule/schedule-ops';

export type { PhaseDef, PhaseInput, PhaseKind, ScheduleDef } from './schedule/types';

export { PlaypackLoader } from './schedule/playpack';
export type { PlaypackDef, PoolDef, OutcomeDef, LoadResult, PlaypackLoaderOpts } from './schedule/playpack';

export { PlaypackActivator, registerPlaypackRuntimeOps } from './schedule/playpack-runtime';
export type {
  PlaypackActivateArgs,
  PlaypackActivatorDeps,
  PlaypackRuntimeOpsDeps,
  ActivationResult,
} from './schedule/playpack-runtime';

export { PlaypackCodec, decodePlaypack } from './schedule/playpack-codec';
export type { PlaypackDecodeResult } from './schedule/playpack-codec';

export { PolicyEvaluator } from './schedule/policy';
export type {
  PolicyDef,
  PolicyRuleEntry,
  PolicyDecision,
  PolicyDecideDeps,
  PolicyEvalContext,
  CheckpointRestoreHook,
  SearchPolicyResolver,
} from './schedule/policy';

// ===========================================================================
// L10 Random — 需求 35
// ===========================================================================

export { registerRandomOps } from './random/random-ops';
export type {
  RandomRollArgs,
  RandomPickArgs,
  RandomShuffleArgs,
  RandomWeightedPickArgs,
} from './random/random-ops';

export { withShadowStream, snapshotStream, restoreStream } from './random/shadow-stream';
export type { ShadowStreamOpts } from './random/shadow-stream';

// ===========================================================================
// L11 Knowledge — 需求 36
//
// 只有纯读访问器：写 fact 走 prop.set（design 3.12节修补），
// 这里不存在 setFact 这条第二写入路径。
// ===========================================================================

export { WorldKnowledgeStore, knowledgeStore } from './knowledge/knowledge-store';
export type { KnowledgeStore } from './knowledge/knowledge-store';

// ===========================================================================
// L12 Persistence — 需求 37、38
// ===========================================================================

export {
  takeSnapshot,
  Journal,
  replay,
  InMemoryCheckpointStore,
  rewind,
  applyMigration,
  compareVersions,
  LogStore,
} from './persistence/persistence';
export type {
  Snapshot,
  JournalRecord,
  ReplayDeps,
  CheckpointStore,
  MigrationDef,
  MigrationResult,
  // 与 state/world-state.ts 的 LogEntry 同名但语义不同（前者是 world.log 的条目，
  // 后者是 LogStore 的条目），因此重命名导出，避免导出面出现二义。
  LogEntry as PersistenceLogEntry,
} from './persistence/persistence';

// ===========================================================================
// L13 Safety — 需求 39、41、42
// ===========================================================================

export {
  DiagnosticSink,
  DiagnosticHaltError,
  HINT_TEMPLATES,
  checkHintCompleteness,
  RuleCircuitBreaker,
  Linter,
  QuotaEnforcer,
} from './safety/safety';
export type {
  DiagnosticOverflowPolicy,
  DiagnosticSinkOpts,
  CircuitBreakerOpts,
  LintResult,
  LinterOpts,
  QuotaLimits,
} from './safety/safety';

export { FatalErrorBoundary, InMemoryEmergencySink, CompilationHaltedError } from './safety/fatal-boundary';
export type { EmergencyCode, EmergencySink, FatalEnvelope } from './safety/fatal-boundary';

// ===========================================================================
// 横切：表现层只读通道（需求40）与 Hook 接线（design 3.4节 withVeto 的落点）
// ===========================================================================

export { PresentationGateway } from './gateway';
export type { GatewayEventHandler, GatewaySubscription, PresentationGatewayDeps } from './gateway';

export { wireHooksIntoRegistry, WiredOpRegistry } from './wire-hooks';
export type { WiredHooks, WireHooksOpts } from './wire-hooks';
