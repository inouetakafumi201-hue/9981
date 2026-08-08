/**
 * L2 Model: L0 规范宪法常量及其权威来源记录。
 *
 * 这些是 `Constitutional_Constant`：由 `docs/L0_规范宪法.md` 固定，带来源编号、归属层
 * 与适用字段（Requirements 5.4）。L2 只引用它们，不重新裁决其数值。
 *
 * 术语废用词清单来自 L0「一、术语铁律」与 Requirements 1.7。
 */

import type { SourceRecord } from './source.js';

/** L0 文档标识。 */
export const L0_SOURCE_FILE = 'docs/L0_规范宪法.md';

function l0Record(section: string, fingerprint: string): SourceRecord {
  return {
    sourceFile: L0_SOURCE_FILE,
    sourceLocation: { sourceFile: L0_SOURCE_FILE, section },
    precedence: 'l0-constitution',
    classification: 'Normative_Contract',
    owningLayer: '基类层',
    statementFingerprint: fingerprint,
  };
}

/**
 * 数值铁律：所有玩家可见数值严格限制在 1–5 范围内；内部数值例外。
 * 来源：L0「四、引擎层铁律 / 4.2 数值铁律」。
 */
export const GAMEPLAY_VALUE_RANGE = Object.freeze({ min: 1, max: 5 });

export const GAMEPLAY_VALUE_RANGE_SOURCE: SourceRecord = Object.freeze(
  l0Record('四、引擎层铁律 / 4.2 数值铁律', 'l0:numeric-iron-law:player-visible-1-to-5'),
);

/**
 * 拓扑铁律：五并列原则 —— 节点连接数不超过 5。
 * 来源：L0「四、引擎层铁律 / 4.3 拓扑铁律」。
 * 该上限作为 `Structural_Bound` 消费，不是 L3 地图数值（Requirements 7.2）。
 */
export const NODE_CONNECTION_BOUND = 5;

export const NODE_CONNECTION_BOUND_SOURCE: SourceRecord = Object.freeze(
  l0Record('四、引擎层铁律 / 4.3 拓扑铁律', 'l0:topology-iron-law:max-five-parallel-connections'),
);

/**
 * Op 通道铁律：唯一写入通道是 `OpRegistry.invoke`。
 * 来源：L0「四、引擎层铁律 / 4.1 Op 通道铁律」。
 */
export const SINGLE_WRITE_CHANNEL_SOURCE: SourceRecord = Object.freeze(
  l0Record('四、引擎层铁律 / 4.1 Op 通道铁律', 'l0:op-iron-law:single-write-channel'),
);

/**
 * 微型场景由实体创建、附属于天然场景。
 * 来源：L0「四、引擎层铁律 / 4.3 拓扑铁律」。
 */
export const MICRO_SCENE_ATTACHMENT_SOURCE: SourceRecord = Object.freeze(
  l0Record('四、引擎层铁律 / 4.3 拓扑铁律', 'l0:topology-iron-law:micro-scene-attaches-to-natural-scene'),
);

/** 术语铁律来源。 */
export const TERMINOLOGY_SOURCE: SourceRecord = Object.freeze(
  l0Record('一、术语铁律', 'l0:terminology-iron-law:canonical-layer-terms'),
);

/** 规范术语（Requirements 1.6）。 */
export const CANONICAL_TERMS = Object.freeze(['引擎层', '基类层', '玩法层', '实例', '基类'] as const);

/**
 * 废用词字面量以 Unicode 转义表示，避免本拒绝字典自身被术语扫描判定为违规用法。
 * 与 `core/kernel/spec-compiler/validator.ts` 的 `NON_CANONICAL_TERMS` 采用同一表示方式。
 */
const OBSOLETE_CLASS_LAYER_LABEL = '\u5185\u5bb9\u5c42';
const OBSOLETE_INSTANCE_WORD = '\u6a21\u677f';
const OBSOLETE_INSTANCE_LAYER_LABEL = `${OBSOLETE_INSTANCE_WORD}\u5c42`;
const OBSOLETE_INSTANCE_KIND_LABEL = `${OBSOLETE_INSTANCE_WORD}\u7c7b\u578b`;
const OBSOLETE_PLAY_LAYER_LABEL = '玩法包层';
const OBSOLETE_INSTANCE_ALIAS = '对象';

/**
 * 废用词 → 规范术语映射（Requirements 1.7 与 L0 术语铁律）。
 * 键为废用词，值为应当使用的规范术语。
 */
export const DEPRECATED_TERM_REPLACEMENTS: ReadonlyMap<string, string> = Object.freeze(
  new Map<string, string>([
    [OBSOLETE_CLASS_LAYER_LABEL, '基类层'],
    [OBSOLETE_INSTANCE_LAYER_LABEL, '基类层'],
    [OBSOLETE_PLAY_LAYER_LABEL, '玩法层'],
    [OBSOLETE_INSTANCE_KIND_LABEL, '基类'],
    [OBSOLETE_INSTANCE_WORD, '实例'],
    [OBSOLETE_INSTANCE_ALIAS, '实例'],
  ]),
);

/** Requirements 1.7 明确要求拒绝的五个废用词。 */
export const REJECTED_LAYER_TERMS = Object.freeze([
  OBSOLETE_CLASS_LAYER_LABEL,
  OBSOLETE_INSTANCE_LAYER_LABEL,
  OBSOLETE_PLAY_LAYER_LABEL,
  OBSOLETE_INSTANCE_KIND_LABEL,
  OBSOLETE_INSTANCE_ALIAS,
] as const);
