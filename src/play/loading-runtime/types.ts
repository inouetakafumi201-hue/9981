/**
 * 整合层（专项 B）共享类型：装载请求、装载结果与已装载对局的对外门面。
 *
 * 本模块是玩法层"已装载对局"的稳定出口（`docs/工程治理/04_整合层_装载运行期_规划设计.md` §2.1）：
 * - 引擎面 / 门禁面 / 外壳面 / 演员面 / 地图面 / UI 面由组合根 `createLoadedMatch` 一次性组装；
 * - 装载完成后对外暴露的**唯一写通道**仍是 `CoreMechanicsFacade.submit`（经 `OpRegistry.invoke`），
 *   宿主不得持 `WorldStateHolder` 直接改状态；
 * - `MatchShell` 是"一局"的量级容器（round+phase / 终局 / 胜负 / ended），不新增规则语义。
 *
 * 铁律：本文件不 import `src/ui`、`src/devboard`（UI 经端口注入，见 `ui-host.ts`）；
 * 不新造 L1↔L2 桥（专项 D 已交付，组合根消费它装进去）；玩家可见数值守 1-5，round 等内部值例外。
 */
import type { WorldState } from '../../core/kernel/state/world-state';
import type { WorldStateHolder } from '../../core/kernel/ops/transaction';
import type { OpRegistry } from '../../core/kernel/ops/registry';
import type { DefRegistry } from '../../core/kernel/state/def';
import type { RuleProvider } from '../../core/kernel/events/rule-provider';
import type { ExprEngine } from '../../core/kernel/expr/engine';
import type { QueryEngine } from '../../core/kernel/expr/query-engine';
import type { ActionCatalog } from '../../core/kernel/actions/catalog';
import type { PlaypackLoader } from '../../core/kernel/schedule/playpack';
import type { PlaypackActivator } from '../../core/kernel/schedule/playpack-runtime';
import type { Diagnostic } from '../../core/kernel/state/diagnostic';
import type { Result } from '../../core/kernel/ops/result';
import type { Value } from '../../core/kernel/state/value';
import type { CoreMechanicsConfig, CoreMechanicsLoadResult, CoreMechanicsRuntime, CoreMechanicsFacade } from '../core-mechanics/load';
import type { TerminalQuery } from '../core-mechanics/match-lifecycle';
import type { CoreMechanicsProjection } from '../core-mechanics/projection';
import type { MapDataDocument } from '../map/types';
import type { PlayAiRuntime } from '../ai-runtime';
import type { RegistryBridge } from '../../l2/kernel/registry-bridge';
import type { KernelContract } from '../../l2/kernel/kernel-contract';
import type { PresentationGateway } from '../../core/kernel/gateway';
import type { UiSystem } from '../../ui/index';
import type { PresentationProfile } from '../../ui/model/profile';
import type { DesignCurrencyConfig } from '../../core/kernel/ai/tuning/config-design-currency';
import type { PlaypackDef } from '../../core/kernel/schedule/playpack';

/** 出生装配的实体来源。`spawnCandidates` 优先；缺省时回退到 `playerEntityIds`。 */
export interface SpawnInput {
  /** 本局参与的玩家实体 id。装载期以参与者身份注册进玩法层（CEME C-2/C-4）。 */
  readonly playerEntityIds: readonly string[];
  /** 可选的出生候选清单路径（Internal_Metric）。缺省写 `spawnCandidates` 为 playerEntityIds。 */
  readonly spawnCandidates?: readonly string[];
}

export interface LoadedMatchOptions {
  /** 玩法层装载配置。生产 config 属玩法层（Q-3），整合层只注入，不持有默认值。 */
  readonly config: CoreMechanicsConfig;
  /** 可选的已编译玩法文件/玩法包定义；缺省时使用官方默认玩法包。 */
  readonly playpack?: PlaypackDef;
  /** 本局参与的玩家实体 id（出生 + 参与者自动注册输入）。 */
  readonly playerEntityIds: readonly string[];
  /**
   * 可选：装载前的世界预置（实体/节点/容器/agent/资源池）。
   * 组合根在 `loadCoreMechanics` 之前把它合入 holder——装载写入的玩法配置在其之上叠加，
   * 出生装配（`assembleMatchStart`）与后续 Op 写入都以合并后的状态为准。
   * 预置只做「数据落地」，不做任何规则语义；规则语义全部由玩法包装载派生。
   */
  readonly initialWorld?: WorldState;
  /**
   * 可选：装载进 world 的地图（compileMap → PrefabDef → prefab.spawn）。接受 legacy v1
   * floor 形状或 canonical v2 layer 形状；组合根在 compileMap 前统一经 `normalizeMapDocument`
   * 规范化为 canonical，legacy floor 只在导入边界出现。
   */
  readonly map?: MapDataDocument;
  /** 可选：AI 预算提供者；不传则本局无 NPC（npcAction 阶段空队列直接通过）。 */
  readonly npcBudget?: () => readonly {
    readonly entry: import('../ai-runtime').NpcEntry;
    readonly ap: number;
  }[];
  /**
   * 可选：AI 决策使用的设计货币费目表（调参产物）。`createPlayAiRuntime` 已支持注入；
   * 不传则使用默认费目表。仅影响 AI 决策估值，不改任何玩法规则。
   */
  readonly designCurrencyConfig?: DesignCurrencyConfig;
  /** 可选：Presentation_Profile（UI 宿主侧注入）。不传则不装配 UI 面。 */
  readonly profile?: PresentationProfile;
}

/** 装载成功的结果（`ok:false` 时不返回半可用对象）。 */
export type LoadedMatchResult =
  | { readonly ok: true; readonly match: LoadedMatch }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[]; readonly blocked: readonly string[] };

/** 对局外壳对外事件。事件出口只经 `PresentationGateway.subscribe('*')` 与外壳自持的有限事件。 */
export type MatchShellEvent =
  | { readonly type: 'round'; readonly round: number; readonly phase: string }
  | { readonly type: 'matchEnd'; readonly outcome: string; readonly detail: unknown };

/** 已装载对局的对外门面。 */
export interface LoadedMatch {
  /** 引擎面：真实引擎实例（宿主只读持有；写入一律经 facade/授权通道）。 */
  readonly engine: {
    readonly registry: OpRegistry;
    readonly defRegistry: DefRegistry;
    readonly ruleProvider: RuleProvider;
    readonly exprEngine: ExprEngine;
    readonly queryEngine: QueryEngine;
    readonly actionCatalog: ActionCatalog;
    readonly playpackLoader: PlaypackLoader;
    readonly playpackActivator: PlaypackActivator;
    /** 表现层唯一只读出口：订阅 after/语义事件 + 只读 query/queryActions（从不持写通道）。 */
    readonly gateway: PresentationGateway;
  };
  /** 门禁面：装载结果（含只读投影与结局守恒集）。 */
  readonly load: CoreMechanicsLoadResult;
  /** 玩法层装载运行时（与引擎共享同一 holder/registry/ruleProvider）。 */
  readonly runtime: CoreMechanicsRuntime;
  /** 统一判罚入口：玩家 / AI / UI 全部经它提交，无来源分支。 */
  readonly facade: CoreMechanicsFacade;
  /** 只读语义投影（loadCoreMechanics 构造）。 */
  readonly projection: CoreMechanicsProjection;
  /** 对局外壳。 */
  readonly shell: MatchShell;
  /** 只读终局/胜负查询（内部量级）。 */
  readonly terminal: TerminalQuery;
  /** 演员面：AI runtime（无 NPC 时为 null）。 */
  readonly ai: PlayAiRuntime | null;
  /** 关联合并快照：把主 holder 的最新可见世界合入 AI runtime 的决策快照，保留 AI 侧
   *  登记（agent / NPC 实体 / npcQueue / 实体作用域 AP）不被主世界覆盖。宿主可在任何
   *  `prop.set` 或阶段推进后调用，保证 AI 仿真分支读到与主世界一致的判罚前置。 */
  readonly syncAiFromMatch: () => void;
  /** L1↔L2 注册表桥产物：`kernel` 是真实 OpRegistry 包裹的唯一语义写入通道。 */
  readonly bridge: RegistryBridge;
  /** 桥产 KernelContract 包裹的动作提交器（专项 D 承接链：UI 与玩家/AI 同一判罚路径）。 */
  readonly submitter: {
    readonly kernel: KernelContract;
    readonly submitAction: (input: {
      readonly requestId: string;
      readonly actionId: string;
      readonly actorId: string;
      readonly targetIds: readonly string[];
      readonly parameters: Readonly<Record<string, unknown>>;
    }) => Result<{ readonly applied: boolean }>;
  };
  /** 事件订阅（经 PresentationGateway.subscribe('*')）。 */
  readonly events: {
    subscribe(handler: (event: MatchShellEvent) => void): { unsubscribe: () => void };
  };
  /** UI 面：绑定真实端口的 UI 系统（未注入 profile 时为 null）。 */
  readonly ui: UiSystem | null;
  /** 外壳控制。 */
  readonly control: {
    /** 推进一回合阶段。终局后拒绝。 */
    advance(): Result<void>;
    /** 清空玩家行动队列（生产 drain 入口）。 */
    drainPlayerQueue(): Result<void>;
    /** 手动触发一次外壳 round/matchEnd 语义事件广播（供宿主在不 advance 时也对外发声）。 */
    broadcast(): void;
  };
  /** 当前世界状态的只读投影（供宿主/运营只读消费；写入一律走 facade）。 */
  readonly getWorldState: () => WorldState;
}

/** 对局外壳。 */
export interface MatchShell {
  readonly round: number;
  readonly phase: string;
  readonly ended: boolean;
  readonly outcome: { readonly name: string; readonly scope: string; readonly rank: number | null } | null;
  readonly events: {
    subscribe(handler: (event: MatchShellEvent) => void): { unsubscribe: () => void };
  };
  /** 终局后调用拒绝（`E_OP_NOT_ACCEPTED`）。 */
  submitGuard(): Result<void>;
  /** 外壳自检（终局后外部 `submit` 被拒绝、round/phase 单调）。 */
  check(): readonly string[];
  readonly getState: () => WorldState;
}

/** 装载请求：传给 `createLoadedMatch` 的全部输入。 */
export interface LoadMatchRequest extends LoadedMatchOptions {
  readonly scheduleId: string;
  readonly seedDefs?: readonly import('../../core/kernel/state/def').Def[];
}

/** 只读门面持有者（`getState` 不暴露任何写通道）。 */
export type ReadOnlyWorld = () => WorldState;

/** 装载期契约的宿主实现占位：供 `pendingContracts` 端口消费。 */
export interface LoadedMatchContractView {
  readonly core: {
    projectedResources(entityId: string): Value[];
    phaseSemantics(): { readonly phaseSemanticId: string; readonly accessibleLabel: string } | null;
    legalActions(actorEntityId: string): readonly unknown[];
    safeUnavailabilityReasonKey(actionId: string): string | null;
    visibleDecisions(): readonly unknown[];
  };
  readonly spaceItems: {
    visibleScenes(): unknown[];
    visibleContainers(): unknown[];
    legalInteractions(actorEntityId: string): readonly unknown[];
  };
  readonly ai: {
    visibleActionState(): unknown[];
    publicIntents(): unknown[];
    safeExplanationLabels(actorEntityId: string): readonly string[];
  };
}
