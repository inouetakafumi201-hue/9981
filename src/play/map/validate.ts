/**
 * MapData 校验。
 *
 * 分两层：`validateMapStructure` 只看 MapData 自身，不需要基类层目录，编辑器每次编辑后都能
 * 即时跑；`validateMapAgainstClasses` 再补上跨目录引用检查。拆开的原因是即时反馈不能每次去
 * 读盘加载目录，而引用检查又不能省——两者合并会迫使编辑器在每帧交互里做 IO。
 *
 * 校验产出诊断列表而非抛异常，且**一次报出全部问题**（与 `auditNumericOwnership` 同一形态）：
 * 逐条抛异常会让创作者陷入"修一条、再跑、再修一条"的循环。
 *
 * 严重度分级沿用 L2/06_UGC系统 的约定：`error` 阻止发布但不阻止保存（阻止保存会弄丢半成品
 * 工作）；`warning` 只提示。报错文案必须指出**具体哪一部分**出了问题并给出改法——创作者
 * 大多不是程序员，冷冰冰的错误码没有用。
 */
import {
  CONNECTION_LIMIT,
  COORD_MAX,
  COORD_MIN,
  EXPR_DISCRIMINANT_KEYS,
  type MapData,
  type MapDataDocument,
  type MapEdge,
  type MapLayer,
  type MapNode,
  type SceneScale,
  type Vec2,
} from './types';
import { distance } from './curve';

export type Severity = 'error' | 'warning';

/** 一条校验诊断。 */
export interface MapDiagnostic {
  readonly code: string;
  readonly severity: Severity;
  /** JSON 指针式路径，供编辑器把摄像机飞到出问题的元素。 */
  readonly path: string;
  /** 出问题的元素 id，便于编辑器高亮。 */
  readonly subject?: string;
  /** 面向创作者的说明：哪里错了。 */
  readonly message: string;
  /** 面向创作者的改法。 */
  readonly correction: string;
}

/** 端点吸附容差（归一化坐标）。超出即视为没吸附上。 */
export const SNAP_TOLERANCE = 0.005;

function inRange(value: number): boolean {
  return Number.isFinite(value) && value >= COORD_MIN && value <= COORD_MAX;
}

function isNormalized(point: Vec2): boolean {
  return inRange(point.x) && inRange(point.y);
}

/**
 * 结构校验：只依赖 MapData 自身（canonical 与 legacy 形状均受理；canonical 由
 * validateLayerContract 守图层契约，legacy 由 validateLegacyFloorDeclaration 守楼层声明）。
 * 返回的诊断按 path 稳定排序，使编辑器的问题列表不会在两次校验间跳动。
 */
export function validateMapStructure(map: MapDataDocument): readonly MapDiagnostic[] {
  const findings: MapDiagnostic[] = [];
  const nodeById = new Map<string, MapNode>();
  const mapView = map as unknown as {
    readonly floors?: readonly number[];
    readonly layers?: readonly MapLayer[];
    readonly nodes: readonly { readonly floor?: number; readonly layerId?: string }[];
  };
  const canonicalShape = hasCanonicalLayerFields(map);
  const floors = new Set(mapView.floors ?? []);

  // Zone 契约（layers/layerId）：canonical 与 legacy 冲突、Zone id 唯一、floor 规则等。
  // legacy 楼层声明检查走 validateLegacyFloorDeclaration（逐节点一条），避免同一条诊断出现两次。
  if (!canonicalShape) {
    findings.push(...validateLegacyFloorDeclaration(map, floors));
  } else {
    findings.push(...validateLayerContract(map));
  }

  // ---- 节点 ---------------------------------------------------------------
  map.nodes.forEach((node, index) => {
    const path = `/nodes/${index}`;
    if (nodeById.has(node.id)) {
      findings.push({
        code: 'MAP_DUPLICATE_NODE_ID',
        severity: 'error',
        path: `${path}/id`,
        subject: node.id,
        message: `节点 id「${node.id}」重复出现。`,
        correction: '每个节点的 id 必须唯一。改掉其中一个，或删除多余的那个节点。',
      });
    }
    nodeById.set(node.id, node as MapNode);

    if (!isNormalized(node.at)) {
      findings.push({
        code: 'MAP_COORD_OUT_OF_RANGE',
        severity: 'error',
        path: `${path}/at`,
        subject: node.id,
        message: `节点「${node.name ?? node.id}」的坐标 (${node.at.x}, ${node.at.y}) 落在 0-1 之外。`,
        correction: '地图坐标是相对底图的归一化值，两轴都必须在 0 到 1 之间。把节点拖回底图范围内。',
      });
    }

    // canonical 节点用 layerId（validateLayerContract 守）；legacy 节点的楼层声明检查
    // 已由 validateLegacyFloorDeclaration 提前整体报出（每个未声明节点一条），节点循环
    // 内不再重复报，避免同一条诊断出现两次。
  });

  // ---- 父子嵌�� -----------------------------------------------------------

  // ---- 连接 ---------------------------------------------------------------
  const degree = new Map<string, number>();
  const seenEdgeIds = new Set<string>();
  const seenPairs = new Map<string, string>();

  map.edges.forEach((edge, index) => {
    const path = `/edges/${index}`;
    if (!edge.def) findings.push({ code: 'MAP_EDGE_DEF_UNREGISTERED', severity: 'error', path: `${path}/def`, subject: edge.id, message: '连接未选择具体过渡类型。', correction: '选择一个已登记的 transition def。' });
    if (map.schemaVersion === '3.0') {
      const a = map.nodes.find((node) => node.id === edge.a);
      const b = map.nodes.find((node) => node.id === edge.b);
      if (a && b && a.layerId !== b.layerId && edge.interaction !== 'move') findings.push({
        code: 'MAP_CROSS_ZONE_INTERACTION_FORBIDDEN',
        severity: 'error',
        path: `${path}/interaction`,
        subject: edge.id,
        message: `连接「${edge.id}」跨 Zone，但交付语义是「${edge.interaction ?? '未声明'}」。`,
        correction: '跨 Zone 只允许 move；攻击、感知等语义必须改为 Zone 内连接。',
      });
    }
    if (seenEdgeIds.has(edge.id)) {
      findings.push({
        code: 'MAP_DUPLICATE_EDGE_ID',
        severity: 'error',
        path: `${path}/id`,
        subject: edge.id,
        message: `连接 id「${edge.id}」重复出现。`,
        correction: '每条连接的 id 必须唯一。',
      });
    }
    seenEdgeIds.add(edge.id);

    const endpointsExist = [
      ['a', edge.a] as const,
      ['b', edge.b] as const,
    ].every(([key, id]) => {
      if (nodeById.has(id)) return true;
      findings.push({
        code: 'MAP_EDGE_ENDPOINT_NOT_FOUND',
        severity: 'error',
        path: `${path}/${key}`,
        subject: edge.id,
        message: `连接「${edge.id}」的端点「${id}」不是地图上任何一个节点。`,
        correction: '把这条连接的端点重新吸附到一个存在的节点上，或删掉这条连接。',
      });
      return false;
    });

    if (edge.a === edge.b) {
      findings.push({
        code: 'MAP_SELF_LOOP',
        severity: 'error',
        path,
        subject: edge.id,
        message: `连接「${edge.id}」的两个端点是同一个节点。`,
        correction: '自环没有通行含义。把一端接到别的节点，或删掉这条连接。',
      });
    } else if (endpointsExist) {
      const pairKey = JSON.stringify([edge.a, edge.b].sort((l, r) => l.localeCompare(r, 'en')));
      const existing = seenPairs.get(pairKey);
      if (existing !== undefined) {
        findings.push({
          code: 'MAP_PARALLEL_EDGE',
          severity: 'warning',
          path,
          subject: edge.id,
          message: `连接「${edge.id}」与「${existing}」连接了同一对节点。`,
          correction:
            '两点之间的多条通路会各自占用连接数配额，也会让玩家看到重复选项。'
            + '确认这是有意为之（例如一条正门一条后窗），否则删掉一条。',
        });
      } else {
        seenPairs.set(pairKey, edge.id);
      }
      degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
    }

    // 方向 token 必须是封闭集合之一（L-07，D-074）：扩展后的 Directionality 不再是布尔，
    // 非法 token 会静默丢掉方向语义，必须显式拒绝而非猜。
    if (!DIRECTIONALITY_SET.has(edge.directionality)) {
      findings.push({
        code: 'MAP_UNKNOWN_DIRECTIONALITY',
        severity: 'error',
        path: `${path}/directionality`,
        subject: edge.id,
        message: `连接「${edge.id}」的方向「${edge.directionality}」不是已知类型。`,
        correction: `方向只能是${[...DIRECTIONALITY_SET].join('、')}之一。改掉这个值。`,
      });
    }

    // L-07 数据面增量字段的校验（D-074 与 tasks 8.2）。每个字段按类型/取值域钉死，
    // 且显式拒绝 Expr 判别键，保持"数据面即数据、不进 Expr 求值"这条边界。
    if (edge.directionality !== 'bidirectional') {
      // 单向连接不允许带过渡窗口：窗口是"进出方向上都看得见"的动画，单向语义下无意义。
      if (edge.transitionWindow !== undefined) {
        findings.push({
          code: 'MAP_TRANSITION_WINDOW_ON_UNIDIRECTIONAL',
          severity: 'warning',
          path: `${path}/transitionWindow`,
          subject: edge.id,
          message: `单向连接「${edge.id}」带了一个过渡窗口。`,
          correction: '过渡窗口只在双向连接上有意义。删掉它，或把连接改成双向。',
        });
      }
    }
    findings.push(...validateEdgeDataFields(edge, path));
    // 曲线自身的校验（点数、坐标范围、首尾吸附），反向用例命中的正是这些。
    findings.push(...validateEdgePath(map as MapData, index, nodeById));
  });

  // ---- 连接数上限 ---------------------------------------------------------
  for (const [index, node] of map.nodes.entries()) {
    const limit = CONNECTION_LIMIT[node.scale];
    const actual = degree.get(node.id) ?? 0;
    if (actual > limit) {
      findings.push({
        code: 'MAP_CONNECTION_LIMIT_EXCEEDED',
        severity: 'error',
        path: `/nodes/${index}`,
        subject: node.id,
        message:
          `${scaleName(node.scale)}「${node.name ?? node.id}」有 ${actual} 条连接，`
          + `超过了上限 ${limit}。`,
        correction:
          `${scaleName(node.scale)}最多 ${limit} 条连接（五并列原则：玩家同时面对的选项不超过 5 个，`
          + '场景越小选项越少）。删掉几条连接，或把这个节点改成更大的场景。',
      });
    }
  }

  // ---- 放置 ---------------------------------------------------------------
  const seenPlacementIds = new Set<string>();
  map.placements.forEach((placement, index) => {
    const path = `/placements/${index}`;
    if (seenPlacementIds.has(placement.id)) {
      findings.push({
        code: 'MAP_DUPLICATE_PLACEMENT_ID',
        severity: 'error',
        path: `${path}/id`,
        subject: placement.id,
        message: `放置 id「${placement.id}」重复出现。`,
        correction: '每次放置的 id 必须唯一。',
      });
    }
    seenPlacementIds.add(placement.id);

    if (!nodeById.has(placement.at)) {
      findings.push({
        code: 'MAP_PLACEMENT_HOST_NOT_FOUND',
        severity: 'error',
        path: `${path}/at`,
        subject: placement.id,
        message: `放置「${placement.id}」挂在节点「${placement.at}」上，但这个节点不存在。`,
        correction: '把它挂到一个存在的节点上，或删掉这次放置。',
      });
    }

    for (const key of Object.keys(placement.overrides ?? {})) {
      if (!EXPR_DISCRIMINANT_KEYS.includes(key)) continue;
      findings.push({
        code: 'MAP_OVERRIDE_KEY_SHADOWS_EXPR',
        severity: 'error',
        path: `${path}/overrides/${key}`,
        subject: placement.id,
        message: `放置「${placement.id}」的覆写用了保留键名「${key}」。`,
        correction:
          `${EXPR_DISCRIMINANT_KEYS.join('、')} 这几个键名会被表达式求值器当成表达式而不是数据，`
          + `导致��个值被静默误解。换一个名字，例如「${key}Value」。`,
      });
    }
  });

  return findings.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

/** 曲线自身的校验：点数、坐标范围、首尾吸附。 */
function validateEdgePath(
  map: MapData,
  index: number,
  nodeById: ReadonlyMap<string, MapNode>,
): readonly MapDiagnostic[] {
  const edge = map.edges[index] as MapData['edges'][number];
  const path = `/edges/${index}/path`;
  const findings: MapDiagnostic[] = [];

  // 空曲线合法：渲染层退化为直线。只有画了但画坏了才报。
  if (edge.path.length === 0) return findings;

  if (edge.path.length === 1) {
    findings.push({
      code: 'MAP_PATH_TOO_SHORT',
      severity: 'error',
      path,
      subject: edge.id,
      message: `连接「${edge.id}」的曲线只有一个点。`,
      correction: '一条曲线至少要有起点和终点两个点。重画这条连接，或清空曲线改用直线。',
    });
    return findings;
  }

  edge.path.forEach((point, pointIndex) => {
    if (isNormalized(point)) return;
    findings.push({
      code: 'MAP_COORD_OUT_OF_RANGE',
      severity: 'error',
      path: `${path}/${pointIndex}`,
      subject: edge.id,
      message: `连接「${edge.id}」曲线上第 ${pointIndex + 1} 个点的坐标 (${point.x}, ${point.y}) 落在 0-1 之外。`,
      correction: '曲线坐标必须落在底图范围内（0 到 1）。把这个控制点拖回图内。',
    });
  });

  // 端点必须吸附。浮点近似会让运行期判出"边端点不存在"，所以这是正确性要求而非美观要求。
  const ends: readonly (readonly [string, string, Vec2])[] = [
    ['起点', edge.a, edge.path[0] as Vec2],
    ['终点', edge.b, edge.path[edge.path.length - 1] as Vec2],
  ];
  for (const [label, nodeId, point] of ends) {
    const node = nodeById.get(nodeId);
    if (node === undefined) continue; // 端点不存在已由上层报过，不重复报。
    const gap = distance(point, node.at);
    if (gap <= SNAP_TOLERANCE) continue;
    findings.push({
      code: 'MAP_PATH_ENDPOINT_NOT_SNAPPED',
      severity: 'error',
      path,
      subject: edge.id,
      message:
        `连接「${edge.id}」的曲线${label}离节点「${node.name ?? node.id}」有 ${gap.toFixed(4)} 的距离，`
        + '没有对上。',
      correction:
        '曲线两端必须精确落在所连节点的中心。重新拖动这一端，让它吸附到节点上。',
    });
  }

  return findings;
}

/** 方向式枚举的封闭集合（L-07）。非法 token 必须显式拒绝，不能静默丢语义。 */
const DIRECTIONALITY_SET: ReadonlySet<string> = new Set([
  'bidirectional',
  'unidirectional',
  'one-way-down',
  'one-way-up',
]);

/** 语义锚点的合法取值（L-07）。 */
const SEMANTIC_ANCHOR_SET: ReadonlySet<string> = new Set(['high', 'low', 'neutral']);

/** 语义锚点的语义名，供报错文案使用。 */
function anchorName(value: string): string {
  return value === 'high' ? '高地' : value === 'low' ? '低地' : value === 'neutral' ? '中立' : value;
}

function isNormalizedPointList(points: unknown): points is readonly Vec2[] {
  return Array.isArray(points) && points.every((p) => isNormalized(p as Vec2));
}

/**
 * 连接数据面增量字段（visualObstruction/physicalObstruction/transitionWindow/semanticAnchor）
 * 的独立校验（L-07 任务 8.2，design D-074）。每一项都是单独校验码可寻址的结构校验：
 * 不进 Expr 求值、是纯数据面。报错文案对创作者指明是哪片字段坏了。
 */
function validateEdgeDataFields(edge: MapEdge, path: string): readonly MapDiagnostic[] {
  const findings: MapDiagnostic[] = [];

  if (edge.visualObstruction !== undefined) {
    findings.push(...validateObstruction(edge.visualObstruction, path, 'visualObstruction', edge, '视觉遮挡'));
  }
  if (edge.physicalObstruction !== undefined) {
    findings.push(...validateObstruction(edge.physicalObstruction, path, 'physicalObstruction', edge, '物理遮挡'));
  }
  if (edge.transitionWindow !== undefined) {
    const window = edge.transitionWindow;
    if (window.control === undefined || !Array.isArray(window.control) || window.control.length === 0) {
      findings.push({
        code: 'MAP_TRANSITION_WINDOW_EMPTY',
        severity: 'error',
        path: `${path}/transitionWindow/control`,
        subject: edge.id,
        message: `连接「${edge.id}」的过渡窗口没有控制点。`,
        correction: '过渡窗口至少需要一个控制点，渲染层才能画出进出的动画路径。',
      });
    } else if (!isNormalizedPointList(window.control)) {
      findings.push({
        code: 'MAP_COORD_OUT_OF_RANGE',
        severity: 'error',
        path: `${path}/transitionWindow/control`,
        subject: edge.id,
        message: `连接「${edge.id}」的过渡窗口里有的控制点坐标落在 0-1 之外。`,
        correction: '过渡窗口的控制点坐标是归一化的，两轴都必须在 0 到 1 之间。',
      });
    }
  }
  if (edge.semanticAnchor !== undefined && !SEMANTIC_ANCHOR_SET.has(edge.semanticAnchor)) {
    findings.push({
      code: 'MAP_UNKNOWN_SEMANTIC_ANCHOR',
      severity: 'error',
      path: `${path}/semanticAnchor`,
      subject: edge.id,
      message: `连接「${edge.id}」的语义锚点「${edge.semanticAnchor}」不认识。`,
      correction: `语义锚点只能是 ${[...SEMANTIC_ANCHOR_SET].map(anchorName).join('、')} 之一。`,
    });
  }

  return findings;
}

/** 遮挡规格（visualObstruction/physicalObstruction 共用）的校验。 */
function validateObstruction(
  spec: { shape?: unknown; height?: unknown; bounds?: unknown },
  path: string,
  field: string,
  edge: MapEdge,
  label: string,
): readonly MapDiagnostic[] {
  const findings: MapDiagnostic[] = [];
  const shape = spec.shape as string | undefined;
  if (shape === undefined || !['box', 'circle', 'polygon'].includes(shape)) {
    findings.push({
      code: 'MAP_UNKNOWN_OBSTRUCTION_SHAPE',
      severity: 'error',
      path: `${path}/${field}/shape`,
      subject: edge.id,
      message: `连接「${edge.id}」的${label}形状「${shape ?? '（未填）'}」不认识。`,
      correction: `${label}形状只能是 box、circle、polygon 之一。`,
    });
  }
  if (spec.height !== undefined && typeof spec.height !== 'number') {
    findings.push({
      code: 'MAP_OBSTRUCTION_HEIGHT_TYPE',
      severity: 'error',
      path: `${path}/${field}/height`,
      subject: edge.id,
      message: `连接「${edge.id}」的${label}高度不是数字。`,
      correction: '高度作为数值（单位像素或归一格请与渲染层约定）填写。',
    });
  }
  if (spec.bounds !== undefined && !isNormalizedPointList(spec.bounds)) {
    findings.push({
      code: 'MAP_COORD_OUT_OF_RANGE',
      severity: 'error',
      path: `${path}/${field}/bounds`,
      subject: edge.id,
      message: `连接「${edge.id}」的${label}包围盒里有坐标落在 0-1 之外。`,
      correction: '遮挡包围盒的顶点是归一化的，两轴都必须在 0 到 1 之间。',
    });
  }
  return findings;
}

function scaleName(scale: SceneScale): string {
  return scale === 'large' ? '大场景' : scale === 'medium' ? '中场景' : '小场景';
}

function hasLegacyFloorFields(map: MapDataDocument): boolean {
  const candidates = map as unknown as { readonly floors?: readonly number[]; readonly nodes: readonly { readonly floor?: unknown }[] };
  return candidates.floors !== undefined || candidates.nodes.some((node) => typeof node.floor === 'number');
}

/** legacy floor 形态（schemaVersion '1.0'）的楼层声明检查：每个节点的 floor 必须命中 floors 声明。 */
function validateLegacyFloorDeclaration(
  map: MapDataDocument,
  floors: ReadonlySet<number>,
): readonly MapDiagnostic[] {
  const findings: MapDiagnostic[] = [];
  map.nodes.forEach((node, index) => {
    const path = `/nodes/${index}/floor`;
    const floor = (node as unknown as { floor: number }).floor;
    if (!floors.has(floor)) {
      findings.push({
        code: 'MAP_UNDECLARED_FLOOR',
        severity: 'error',
        path,
        subject: node.id,
        message: `节点「${node.name ?? node.id}」在第 ${floor} 层，但这一层没有在 floors 里声明。`,
        correction: `把 ${floor} 加进地图的 floors 列表，或把这个节点移到已声明的楼层。`,
      });
    }
  });
  return findings;
}

function hasCanonicalLayerFields(map: MapDataDocument): boolean {
  const candidates = map as unknown as { readonly layers?: readonly MapLayer[]; readonly nodes: readonly { readonly layerId?: unknown }[] };
  return candidates.layers !== undefined || candidates.nodes.some((node) => node.layerId !== undefined);
}

/**
 * Canonical 图层契约校验（MapData floor→layers 契约扩展，Task 2）。
 * 只对 canonical 形状（`layers` / `node.layerId`）生效。校验项：
 * - layer id 必填且唯一；
 * - node.layerId 必须命中 `layers` 中的唯一图层；
 * - 参与透视（填了 height）的 height 必须有限、非负；
 * - 参与透视的 height 不能重复（同图内）；
 * - legacy `floor` / `floors` 字段不可与 canonical 并存（冲突拒绝）。
 * legacy floor 形态（schemaVersion '1.0'）不由此校验处理——它在导入边界就被规范化。
 */
export function validateLayerContract(map: MapDataDocument): readonly MapDiagnostic[] {
  if (map.schemaVersion !== '3.0') return [];
  const findings: MapDiagnostic[] = [];
  const seen = new Set<string>();
  map.layers.forEach((zone, index) => {
    const path = `/layers/${index}/id`;
    if (!zone.id) findings.push({ code: 'MAP_EMPTY_LAYER_ID', severity: 'error', path, message: 'Zone id 不能为空。', correction: '填写稳定且唯一的 zone id。' });
    else if (seen.has(zone.id)) findings.push({ code: 'MAP_DUPLICATE_LAYER_ID', severity: 'error', path, subject: zone.id, message: `Zone id「${zone.id}」重复。`, correction: '每个 zone 使用唯一 id。' });
    seen.add(zone.id);
  });
  map.nodes.forEach((node, index) => {
    if (!node.layerId) findings.push({ code: 'MAP_NODE_NO_LAYER_REF', severity: 'error', path: `/nodes/${index}/layerId`, subject: node.id, message: '节点没有 zone 引用。', correction: '选择一个已存在的 zone。' });
    else if (!seen.has(node.layerId)) findings.push({ code: 'MAP_LAYER_REF_NOT_FOUND', severity: 'error', path: `/nodes/${index}/layerId`, subject: node.id, message: `节点引用了不存在的 zone「${node.layerId}」。`, correction: '选择一个已存在的 zone。' });
    if (node.floor !== null && !Number.isFinite(node.floor)) findings.push({ code: 'MAP_NODE_FLOOR_INVALID', severity: 'error', path: `/nodes/${index}/floor`, subject: node.id, message: '高度排序值必须是有限数字或空。', correction: '填写有限数字或清空。' });
  });
  return findings;
}

/** 基类层索引的最小接口。只要求能回答"这个 def 存在吗、它是什么尺度"。 */
export interface MapClassIndex {
  /** 已登记的场景 Def id → 尺度。 */
  readonly sceneDefs: ReadonlyMap<string, SceneScale>;
  /** 已登记的过渡连接 Def id 全集。 */
  readonly transitionDefs: ReadonlySet<string>;
  /** 具体过渡类型的默认方向。 */
  readonly transitionDirectionalities?: ReadonlyMap<string, MapEdge['directionality']>;
  /** 可放置的实例 id 全集。 */
  readonly placeableInstances: ReadonlySet<string>;
}

/**
 * 跨目录引用校验。与结构校验分开调用，因为它需要加载基类层与玩法层目录。
 *
 * 这一层回答的是"引用的东西存在吗、尺度声明与 def 一致吗"。它不重复结构校验的任何判据。
 */
export function validateMapAgainstClasses(
  map: MapDataDocument,
  index: MapClassIndex,
): readonly MapDiagnostic[] {
  const findings: MapDiagnostic[] = [];

  map.nodes.forEach((node, position) => {
    const declared = index.sceneDefs.get(node.def);
    if (declared === undefined) {
      findings.push({
        code: 'MAP_UNKNOWN_SCENE_DEF',
        severity: 'error',
        path: `/nodes/${position}/def`,
        subject: node.id,
        message: `节点「${node.name ?? node.id}」用的场景类型「${node.def}」没有在基类层登记。`,
        correction: '换一个已登记的场景类型。若确实需要新类型，那要先在基类层补，不能在地图里现造。',
      });
      return;
    }
    if (declared !== node.scale) {
      findings.push({
        code: 'MAP_SCALE_MISMATCH',
        severity: 'error',
        path: `/nodes/${position}/scale`,
        subject: node.id,
        message:
          `节点「${node.name ?? node.id}」标的是${scaleName(node.scale)}，`
          + `但它的类型「${node.def}」在基类层是${scaleName(declared)}。`,
        correction: `把尺度改成${scaleName(declared)}，或换一个确实是${scaleName(node.scale)}的类型。`,
      });
    }
  });

  map.edges.forEach((edge, position) => {
    if (index.transitionDefs.has(edge.def)) {
      const expected = index.transitionDirectionalities?.get(edge.def);
      if (expected !== undefined && expected !== edge.directionality) findings.push({ code: 'MAP_EDGE_DIRECTIONALITY_MISMATCH', severity: 'warning', path: `/edges/${position}/directionality`, subject: edge.id, message: `方向行为与 ${edge.def} 的默认值不一致。`, correction: `改为 ${expected}，或确认这是有意覆盖。` });
      return;
    }
    findings.push({
      code: 'MAP_EDGE_DEF_UNREGISTERED',
      severity: 'error',
      path: `/edges/${position}/def`,
      subject: edge.id,
      message: `连接「${edge.id}」用的过渡类型「${edge.def}」没有在基类层登记。`,
      correction: '换一个已登记的过渡类型。',
    });
  });

  map.placements.forEach((placement, position) => {
    if (index.placeableInstances.has(placement.def)) return;
    findings.push({
      code: 'MAP_UNKNOWN_INSTANCE',
      severity: 'error',
      path: `/placements/${position}/def`,
      subject: placement.id,
      message: `放置「${placement.id}」引用的实例「${placement.def}」不存在，或它不可放置。`,
      correction:
        '只有仓库里的完整实例可以放到地图上。依附类实例（例如中毒这样的状态）不能直接摆，'
        + '要在工作台里装进某个实例的插槽。',
    });
  });

  return findings.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

/** 只有 error 阻止发布；warning 不阻止。保存永不被阻止。 */
export function canPublish(findings: readonly MapDiagnostic[]): boolean {
  return !findings.some((finding) => finding.severity === 'error');
}
