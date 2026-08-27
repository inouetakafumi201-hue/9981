/**
 * 基类层 · 空间与物品领域：结构边界目录。
 *
 * 对应要求 2.4、4.1–4.3、4.6–4.8 与 design.md「结构边界目录」。
 *
 * ## 为什么只登记一个连接数边界（D-057）
 *
 * 基类层只登记连接数**天花板 5**，权威来源是 `docs/L0_规范宪法.md` 第五条五并列原则
 * （拓扑铁律）。按尺度收紧到 5 / 4 / 3 的那张更严的表**不属于基类层**：它只有
 * `docs/L2_基类层/03_空间系统.md` 支撑，理由是空间性格与选择密度，属地图编排规则，
 * 已落在玩法层 `src/play/map/types.ts` 的 `CONNECTION_LIMIT` 并由 `validateMapStructure`
 * 强制。若在基类层重复登记 4 与 3，会让一条只有 L2 文档支撑的数值伪装成带 L0 来源的
 * 结构边界，并与玩法层形成两份可漂移的表。
 *
 * 因此三档尺度的**类型身份来自必需能力**，而不是各自持有一个连接数。
 */

import type { HumanReadableText } from './ids';
import type { OwningLayer, SourceRecord } from './source';
import {
  GAMEPLAY_VALUE_RANGE,
  MICRO_SCENE_ATTACHMENT_SOURCE,
  NODE_CONNECTION_BOUND,
  NODE_CONNECTION_BOUND_SOURCE,
} from './constitution';
import { deepFreeze } from './immutable';

/** 天然场景三档尺度。与 `./family-contracts.ts` 的 `SpaceItemsSceneScale` 同义、同取值。 */
export const SPACE_ITEMS_SCENE_SCALES = Object.freeze(['large', 'medium', 'small'] as const);
export type SpaceItemsSceneScale = (typeof SPACE_ITEMS_SCENE_SCALES)[number];

export function isSpaceItemsSceneScale(value: unknown): value is SpaceItemsSceneScale {
  return typeof value === 'string' && (SPACE_ITEMS_SCENE_SCALES as readonly string[]).includes(value);
}

export function sceneScaleRank(scale: SpaceItemsSceneScale): number {
  const index = SPACE_ITEMS_SCENE_SCALES.indexOf(scale);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * 结构边界：为类型结构、认知上限或引擎不变量服务，不是玩法平衡数值。
 *
 * `authoritativeSources` 与 `structuralRationale` 都是必填且必须非空：删除任一项即
 * 使该边界失去"结构"资格，验证规则以 `bound-source-removed` 拒绝（要求 4.7）。
 */
export interface StructuralBound {
  readonly boundId: string;
  readonly value: number;
  readonly unit: string;
  readonly owningLayer: OwningLayer;
  readonly authoritativeSources: readonly SourceRecord[];
  readonly structuralRationale: HumanReadableText;
}

function frozenBound(bound: StructuralBound): StructuralBound {
  return deepFreeze({
    ...bound,
    authoritativeSources: bound.authoritativeSources.slice(),
  }) as StructuralBound;
}

/**
 * 天然场景连接数**天花板**（要求 4.2、2.4）。
 *
 * 基类层只登记这一个值：5。它已落地于 `src/class/scenes/index.json` 的
 * `structural-bound.scene.connection_limit`，三档 scene 类的 `connectionBoundId` 全部指向它。
 */
export const SCENE_CONNECTION_CEILING: StructuralBound = frozenBound({
  boundId: 'structural-bound.scene.connection_limit',
  value: NODE_CONNECTION_BOUND,
  unit: 'connection-count',
  owningLayer: '基类层',
  authoritativeSources: [NODE_CONNECTION_BOUND_SOURCE],
  structuralRationale:
    '五并列原则限制单个节点的连接数，用于保证玩家可同时认知的分支数量上限；这是拓扑与认知结构约束，' +
    '不是玩法层可调的地图数值。按尺度收紧的 5 / 4 / 3 属地图编排规则，归玩法层地图 Linter（D-057）。',
});

/** 微型场景父级基数：恰好一个（要求 5.1）。 */
export const MICRO_SCENE_PARENT_CARDINALITY: StructuralBound = frozenBound({
  boundId: 'structural-bound.micro_scene.parent_cardinality',
  value: 1,
  unit: 'parent-count',
  owningLayer: '基类层',
  authoritativeSources: [MICRO_SCENE_ATTACHMENT_SOURCE],
  structuralRationale:
    '微型场景附属于天然场景是拓扑铁律；恰好一个父级保证附属关系与生命周期资格可确定判定，' +
    '多父级会使生命周期结论歧义。',
});

/** 微型场景生命周期判据基数：恰由「有效父级」与「现查占用」两项共同决定（要求 5.4）。 */
export const MICRO_SCENE_LIFECYCLE_DETERMINANT_CARDINALITY: StructuralBound = frozenBound({
  boundId: 'structural-bound.micro_scene.lifecycle_determinant_cardinality',
  value: 2,
  unit: 'determinant-count',
  owningLayer: '基类层',
  authoritativeSources: [MICRO_SCENE_ATTACHMENT_SOURCE],
  structuralRationale:
    '生命周期资格恰由「有效父级」与「现查占用」两项共同决定，缺一即失效：只看父级会留下空占用节点，' +
    '只看占用会让子节点在父级消失后继续存活。',
});

/** 过渡端点数结构边界的权威来源：引擎层 `Link` 原语恰有两个端点。 */
const TRANSITION_ENDPOINT_SOURCE: SourceRecord = Object.freeze({
  sourceFile: '.kiro/specs/meta-mechanism-kernel/design.md',
  sourceLocation: {
    sourceFile: '.kiro/specs/meta-mechanism-kernel/design.md',
    section: '3.2 节 拓扑 / Link 结构',
  },
  precedence: 'l1-boundary-invariant',
  classification: 'Normative_Contract',
  owningLayer: '引擎层',
  statementFingerprint: 'l1:topology:link-has-exactly-two-endpoints',
});

/** 过渡端点数：恰好两个（要求 6.1）。 */
export const TRANSITION_ENDPOINT_COUNT: StructuralBound = frozenBound({
  boundId: 'structural-bound.transition.endpoint_count',
  value: 2,
  unit: 'endpoint-count',
  owningLayer: '基类层',
  authoritativeSources: [TRANSITION_ENDPOINT_SOURCE],
  structuralRationale:
    '过渡是二元连接语义，端点数由引擎层 Link 结构决定；它不是玩法层可调的通行数值。',
});

/** 本领域全部结构边界的封闭目录，按 `boundId` 规范化排序。 */
export const SPACE_ITEMS_STRUCTURAL_BOUNDS: readonly StructuralBound[] = Object.freeze(
  [
    SCENE_CONNECTION_CEILING,
    MICRO_SCENE_PARENT_CARDINALITY,
    MICRO_SCENE_LIFECYCLE_DETERMINANT_CARDINALITY,
    TRANSITION_ENDPOINT_COUNT,
  ].sort((left, right) => (left.boundId < right.boundId ? -1 : left.boundId > right.boundId ? 1 : 0)),
);

export function findStructuralBound(boundId: string): StructuralBound | undefined {
  return SPACE_ITEMS_STRUCTURAL_BOUNDS.find((bound) => bound.boundId === boundId);
}

/**
 * 一个结构边界是否仍具备"结构"资格：来源非空且结构理由非空白。
 * 任一缺失即以 `bound-source-removed` 拒绝（要求 4.7）。
 */
export function isWellSourcedBound(bound: StructuralBound): boolean {
  return (
    bound.authoritativeSources.length > 0 &&
    typeof bound.structuralRationale === 'string' &&
    bound.structuralRationale.trim().length > 0
  );
}

/**
 * 三档尺度的类型身份来自**必需能力**，而不是各自持有一个连接数（要求 4.1、4.4）。
 *
 * 与 `src/class/scenes/index.json` 的 `requiredCapabilityIds` 逐字一致：
 * - 大场景独有 `traversal_weight`（承担 03 号文档距离公式里的加权计量）；
 * - 大 / 中场景具备 `personal_vacant_ground`（活体移动到空旷地时创建个人私有微型场景）；
 * - 小场景独有 `shared_micro_scene` 且排除个人空旷地；
 * - 三档都具备 `micro_scene_parenthood`（D-056：微型场景父级可为任一档）。
 */
export const SCENE_SCALE_IDENTITY: Readonly<Record<SpaceItemsSceneScale, readonly string[]>> = Object.freeze({
  large: Object.freeze([
    'scene.capability.occupancy',
    'scene.capability.transition_endpoint',
    'scene.capability.micro_scene_parenthood',
    'scene.capability.personal_vacant_ground',
    'scene.capability.traversal_weight',
  ]),
  medium: Object.freeze([
    'scene.capability.occupancy',
    'scene.capability.transition_endpoint',
    'scene.capability.micro_scene_parenthood',
    'scene.capability.personal_vacant_ground',
  ]),
  small: Object.freeze([
    'scene.capability.occupancy',
    'scene.capability.transition_endpoint',
    'scene.capability.shared_micro_scene',
    'scene.capability.micro_scene_parenthood',
  ]),
});

/** 微型场景的合法父级尺度：三档全含（D-056）。 */
export const ADMITTED_MICRO_SCENE_PARENT_SCALES: readonly SpaceItemsSceneScale[] = Object.freeze([
  'large',
  'medium',
  'small',
]);

/**
 * 从引擎层拓扑现查连接数；结果显式分类为 `Internal_Metric`（要求 4.6）。
 *
 * `kind` 是字面量类型，缺失它无法通过类型检查——这使连接计数不可能被当成
 * 「玩法层可自由突破的参数」传播。
 */
export interface ConnectionCountMetric {
  readonly kind: 'Internal_Metric';
  readonly metric: 'natural-scene-connection-count';
  readonly nodeId: string;
  readonly count: number;
}

/**
 * 连接计数所需的稳定最小输入端口。
 *
 * 该端口只表达「一条连接有两个端点」，不依赖引擎层内部 `Link` 类的属性、标签、权重或存储形状。
 * 调用方（例如引擎层或运行时适配器）负责从自身图存储投影为只读端点对；
 * 因此引擎层可以独立演进内部表示，而领域层保持稳定的纯输入契约。
 *
 * **实施前要求 1.2**：L2 层不得直接 import `src/core/kernel/topology/graph` 或 `Link` 的内部形状；
 * 该端口形状必须在 `tsconfig.l2.json` 允许范围内通过类型检查。
 */
export interface ConnectionEndpoints {
  readonly a: string;
  readonly b: string;
}

/**
 * 从纯端点输入现查节点连接数。每个端点对最多计数一次，自环也只表示一条连接。
 *
 * **实施前要求 1.2**：本函数只接受纯数据输入 `ConnectionEndpoints[]` 与 `nodeId`，
 * 不依赖引擎层拓扑模块的任何运行时状态、类或方法；调用方负责在投影或适配器层提供端点对数据。
 */
export function measureConnectionCount(
  links: readonly ConnectionEndpoints[],
  nodeId: string,
): ConnectionCountMetric {
  let count = 0;
  for (const link of links) {
    if (link.a === nodeId || link.b === nodeId) {
      count += 1;
    }
  }
  return Object.freeze({
    kind: 'Internal_Metric',
    metric: 'natural-scene-connection-count',
    nodeId,
    count,
  });
}

/**
 * 玩法层按尺度收紧的连接数表（要求 4.2、4.7 的玩法层一侧）。
 *
 * 基类层不登记它的取值，只登记"合法收紧"的判据：每一档必须落在
 * `[GAMEPLAY_VALUE_RANGE.min, 天花板]` 内，且至少有一档严格小于天花板——否则那不是收紧，
 * 而是把天花板复制一遍伪装成按档表。
 */
export interface ScaleTighteningVerdict {
  readonly acceptable: boolean;
  /** 越界的档位与其取值。 */
  readonly outOfRange: readonly { readonly scale: SpaceItemsSceneScale; readonly value: number }[];
  /** 是否至少有一档严格小于天花板。 */
  readonly tightensAtLeastOnce: boolean;
}

export function validateScaleTightening(
  table: Readonly<Record<SpaceItemsSceneScale, number>>,
): ScaleTighteningVerdict {
  const ceiling = SCENE_CONNECTION_CEILING.value;
  const outOfRange: { readonly scale: SpaceItemsSceneScale; readonly value: number }[] = [];
  let tightensAtLeastOnce = false;
  for (const scale of SPACE_ITEMS_SCENE_SCALES) {
    const value = table[scale];
    const withinRange =
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= GAMEPLAY_VALUE_RANGE.min &&
      value <= ceiling;
    if (!withinRange) {
      outOfRange.push({ scale, value });
      continue;
    }
    if (value < ceiling) {
      tightensAtLeastOnce = true;
    }
  }
  return {
    acceptable: outOfRange.length === 0 && tightensAtLeastOnce,
    outOfRange: Object.freeze(outOfRange),
    tightensAtLeastOnce,
  };
}
