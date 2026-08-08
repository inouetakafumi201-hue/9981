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
  ADMITTED_CHILD_SCALES,
  CONNECTION_LIMIT,
  COORD_MAX,
  COORD_MIN,
  EXPR_DISCRIMINANT_KEYS,
  type MapData,
  type MapNode,
  type SceneScale,
  type Vec2,
} from './types.js';
import { distance } from './curve.js';

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
 * 结构校验：只依赖 MapData 自身。
 * 返回的诊断按 path 稳定排序，使编辑器的问题列表不会在两次校验间跳动。
 */
export function validateMapStructure(map: MapData): readonly MapDiagnostic[] {
  const findings: MapDiagnostic[] = [];
  const nodeById = new Map<string, MapNode>();
  const floors = new Set(map.floors);

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
    nodeById.set(node.id, node);

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

    if (!floors.has(node.floor)) {
      findings.push({
        code: 'MAP_UNDECLARED_FLOOR',
        severity: 'error',
        path: `${path}/floor`,
        subject: node.id,
        message: `节点「${node.name ?? node.id}」在第 ${node.floor} 层，但这一层没有在 floors 里声明。`,
        correction: `把 ${node.floor} 加进地图的 floors 列表，或把这个节点移到已声明的楼层。`,
      });
    }
  });

  // ---- 父子嵌套 -----------------------------------------------------------
  for (const [index, node] of map.nodes.entries()) {
    if (node.parent === undefined) continue;
    const path = `/nodes/${index}/parent`;
    const parent = nodeById.get(node.parent);
    if (parent === undefined) {
      findings.push({
        code: 'MAP_PARENT_NOT_FOUND',
        severity: 'error',
        path,
        subject: node.id,
        message: `节点「${node.name ?? node.id}」的上级场景「${node.parent}」不存在。`,
        correction: '选一个存在的上级场景，或把它改为顶层节点。',
      });
      continue;
    }
    const admitted = ADMITTED_CHILD_SCALES[parent.scale];
    if (!admitted.includes(node.scale)) {
      findings.push({
        code: 'MAP_ILLEGAL_SCENE_NESTING',
        severity: 'error',
        path,
        subject: node.id,
        message:
          `${scaleName(parent.scale)}「${parent.name ?? parent.id}」不能直接包含`
          + `${scaleName(node.scale)}「${node.name ?? node.id}」。`,
        correction:
          admitted.length === 0
            ? `${scaleName(parent.scale)}是最小一级天然场景，不能再包含下级场景。`
            : `${scaleName(parent.scale)}的合法下级只有${admitted.map(scaleName).join('、')}。`
              + '在两者之间补一层，或改掉其中一个的尺度。',
      });
    }
  }

  findings.push(...detectParentCycles(map, nodeById));

  // ---- 连接 ---------------------------------------------------------------
  const degree = new Map<string, number>();
  const seenEdgeIds = new Set<string>();
  const seenPairs = new Map<string, string>();

  map.edges.forEach((edge, index) => {
    const path = `/edges/${index}`;
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

    // 这里曾经有一条 MAP_WEIGHT_OUT_OF_SCALE，校验作者逐边填的 1-5 通行代价。已删除：
    // 代价属于门户类型而非单条边（见 MapEdge 的注释与 L2/03 门户系统一节）。作者只选 def。
    findings.push(...validateEdgePath(map, index, nodeById));
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
          + `导致这个值被静默误解。换一个名字，例如「${key}Value」。`,
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

/** 父子链环检测。有环时每个环只报一次，报在环内 id 最小的那个节点上。 */
function detectParentCycles(
  map: MapData,
  nodeById: ReadonlyMap<string, MapNode>,
): readonly MapDiagnostic[] {
  const findings: MapDiagnostic[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const reported = new Set<string>();

  for (const node of map.nodes) {
    if (state.get(node.id) === 'done') continue;
    const chain: string[] = [];
    let cursor: string | undefined = node.id;

    while (cursor !== undefined && state.get(cursor) !== 'done') {
      if (state.get(cursor) === 'visiting') {
        const cycle = chain.slice(chain.indexOf(cursor));
        const anchor = [...cycle].sort((l, r) => l.localeCompare(r, 'en'))[0] as string;
        if (!reported.has(anchor)) {
          reported.add(anchor);
          const index = map.nodes.findIndex((candidate) => candidate.id === anchor);
          findings.push({
            code: 'MAP_PARENT_CYCLE',
            severity: 'error',
            path: `/nodes/${index}/parent`,
            subject: anchor,
            message: `这些场景的上级关系绕成了一个圈：${[...cycle, cursor].join(' → ')}。`,
            correction: '场景的上级关系必须是一棵树。把圈里其中一个节点的上级清空或改掉。',
          });
        }
        break;
      }
      state.set(cursor, 'visiting');
      chain.push(cursor);
      cursor = nodeById.get(cursor)?.parent;
    }

    for (const id of chain) state.set(id, 'done');
  }

  return findings;
}

function scaleName(scale: SceneScale): string {
  return scale === 'large' ? '大场景' : scale === 'medium' ? '中场景' : '小场景';
}

/** 基类层索引的最小接口。只要求能回答"这个 def 存在吗、它是什么尺度"。 */
export interface MapClassIndex {
  /** 已登记的场景 Def id → 尺度。 */
  readonly sceneDefs: ReadonlyMap<string, SceneScale>;
  /** 已登记的过渡连接 Def id 全集。 */
  readonly transitionDefs: ReadonlySet<string>;
  /** 可放置的实例 id 全集。 */
  readonly placeableInstances: ReadonlySet<string>;
}

/**
 * 跨目录引用校验。与结构校验分开调用，因为它需要加载基类层与玩法层目录。
 *
 * 这一层回答的是"引用的东西存在吗、尺度声明与 def 一致吗"。它不重复结构校验的任何判据。
 */
export function validateMapAgainstClasses(
  map: MapData,
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
    if (index.transitionDefs.has(edge.def)) return;
    findings.push({
      code: 'MAP_UNKNOWN_TRANSITION_DEF',
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
