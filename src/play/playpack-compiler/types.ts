/**
 * 玩法包编译器的类型定义。
 *
 * 这是 LLM 工具、玩家上传、审核系统的共同入口。它把现有的分散编译器（profile-audit、
 * map-compile、numeric-classification）组合成一个统一的验证管线，返回结构化诊断。
 *
 * 设计原则：
 *  - 编译器只消费现有能力，不新增规则判定
 *  - 诊断必须携带自动修正建议（autoFixable 为 true 时）
 *  - 复杂度评分用于定价，与规则正确性无关
 */

import type { JsonValue } from '../../core/kernel/spec-compiler/types';

/**
 * 玩法包来源标识。
 *
 * `uploaded`（D-077/D-079）：上传播放包分流两态——态一带 UGC 角标的普通可插拔玩法包、
 * 态二按地图切成多个口子（仅入口地图、进图装整包）。与既有 `player-uploaded`（历史泛指）等价
 * 但语义专门化：compiler 不再把它收进源码级分支，纯上传来源由上传两态辨形在编译产物层给出口子。
 */
export type PlaypackSource = 'llm-generated' | 'player-uploaded' | 'uploaded' | 'official';

/** 玩法包输入：解析后的 zip 包内容。 */
export interface PlaypackInput {
  /** 包 ID（用户命名 + 随机 key，或由系统生成）。 */
  readonly id: string;

  /** 包名称（玩家可见）。 */
  readonly name: string;

  /** 包版本（语义化版本号，例如 "1.0.0"）。 */
  readonly version: string;

  /** JSON 文件列表（相对路径 → JSON 字符串内容）。 */
  readonly manifests: ReadonlyMap<string, string>;

  /** 素材文件列表（相对路径 → 二进制内容）。 */
  readonly assets: ReadonlyMap<string, ArrayBuffer>;

  /** 来源标识。 */
  readonly source: PlaypackSource;

  /** 创作者 Steam ID（官方包为 null）。 */
  readonly creatorSteamId: string | null;
}

/** 编译选项。 */
export interface CompileOptions {
  /** 是否进行完整性审计（包括数值归属、UGC 友好性）。默认 true。 */
  readonly fullAudit?: boolean;

  /** 是否允许引用未发布的地图（创作模式）。默认 false。 */
  readonly allowUnpublishedMaps?: boolean;

  /** 目标环境。默认 'both'。 */
  readonly targetEnv?: 'singleplayer' | 'multiplayer' | 'both';
}

/** 编译结果。 */
export type PlaypackCompileResult =
  | { readonly ok: true; readonly artifact: CompiledPlaypack }
  | { readonly ok: false; readonly diagnostics: readonly PlaypackDiagnostic[] };

/** 编译产物。 */
export interface CompiledPlaypack {
  /** 原始输入的副本。 */
  readonly input: PlaypackInput;

  /** 编译产物：解析后的 profile 文档列表。 */
  readonly profiles: readonly ParsedProfile[];

  /** 编译产物：解析后的地图列表（如果有）。 */
  readonly maps: readonly ParsedMap[];

  /** 编译产物：引用的基类层 id 全集。 */
  readonly referencedClassIds: ReadonlySet<string>;

  /** 诊断列表（可能有 warning，但没有 error）。 */
  readonly diagnostics: readonly PlaypackDiagnostic[];

  /** 复杂度评分（用于定价）。 */
  readonly complexityScore: number;

  /** 高级标签（L-06, D-077）：编译器对产物做可达性静态扫描，凡含引擎层引用即标记。 */
  readonly advanced?: boolean;

  /** L-06：高级判定的理由。未标高级时为 undefined。 */
  readonly advancedReason?: string;

  /**
   * 上传两态辨形（L-07/D-079）：compiler 对 `uploaded` 玩法包在编译产物层标记其装载形态。
   * - `'ordinary'` = 态一：可插拔的普通玩法包（带 UGC 角标，可自建房/探索匹配）。
   * - `'entry-by-map'` = 态二：带地图，按地图切多个口子，只能从各自入口进入、进图装整包。
   * 取自编译产物的地图产物数量：无地图 → ordinary；有地图 → entry-by-map。仅供上传/口子建图
   * 消费，不改变 Schemma 或校验规则（来源不带特权）。
   */
  readonly deliveryForm?: 'ordinary' | 'entry-by-map';

  /**
   * playpack 清单（D-081 / L0 第十四条：玩法包可携带完整规则与逻辑）。
   *
   * zip 根目录的 playpack.json / manifest.json（或顶层 kind:'playpack' 的文档）经引擎严格
   * 解码链（StrictJsonCodec → decodePlaypack）校验后落在该字段；无清单时为 undefined。
   * 装配桥（compileToPlaypackDef）以此为基础合并 profiles/maps 展开的 defs。
   */
  readonly playpackDef?: import('../../core/kernel/schedule/playpack').PlaypackDef;
}

/** 解析后的 profile。 */
export interface ParsedProfile {
  /** 相对包根目录的路径。 */
  readonly path: string;

  /** profile 类别（推断自路径）。 */
  readonly category: 'items' | 'npcs' | 'statuses' | 'vehicles' | 'weapons';

  /** 解析后的 JSON 文档（已深冻结）。 */
  readonly document: Readonly<Record<string, JsonValue>>;
}

/** 解析后的地图。 */
export interface ParsedMap {
  /** 相对包根目录的路径。 */
  readonly path: string;

  /** 解析后的 MapData（已深冻结）。 */
  readonly data: unknown; // MapData，避免循环依赖

  /** 编译产物：PrefabDef（已深冻结）。 */
  readonly prefab: unknown; // PrefabDef，避免循环依赖
}

/** 玩法包诊断。 */
export interface PlaypackDiagnostic {
  /** 稳定诊断码。 */
  readonly code: string;

  /** 严重程度。 */
  readonly severity: 'error' | 'warning' | 'info';

  /** 出问题的文件路径（相对于包根目录）。 */
  readonly file?: string;

  /** JSON 指针路径（例如 "/damage" 或 "/nodes/3/at"）。 */
  readonly path?: string;

  /** 面向创作者的说明：哪里错了。 */
  readonly message: string;

  /** 建议的修正方式。 */
  readonly correction?: string;

  /** 是否可自动修正（LLM 可以尝试修复）。 */
  readonly autoFixable: boolean;

  /** 自动修正的建议值（如果 autoFixable = true）。 */
  readonly suggestedFix?: unknown;
}

/** 复杂度评分的输入指标。 */
export interface ComplexityMetrics {
  /** profile 实例总数。 */
  readonly profileCount: number;

  /** 地图数量。 */
  readonly mapCount: number;

  /** 自定义规则数量（暂未实现规则系统，预留）。 */
  readonly customRuleCount: number;
}
