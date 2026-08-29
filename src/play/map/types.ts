/**
 * 玩法层地图数据契约。
 *
 * MapData 是地图编辑器的产出物，也是 `compile.ts` 的输入。它与 `PrefabDef`（引擎层）的关系是
 * **MapData = PrefabDef + 几何**：节点拓扑、连接、实体放置三者与 `PrefabDef.nodes/links/entities`
 * 一一对应，多出来的只有坐标、曲线与楼层这些渲染信息。因此"删掉几何，一局游戏照样跑"这条
 * 判据在类型层面就是成立的——`compile.ts` 丢弃全部几何字段后得到的 PrefabDef 仍然完整。
 *
 * 为什么放在 `src/play/map/` 而不是 `src/play/profiles/maps/`：
 * `profiles/catalog.ts` 的 `PROFILE_CATEGORIES` 是封闭列表，`categoryOf` 对未登记的一级目录
 * 直接 throw。地图不是 item/npc/status/vehicle/weapon 之一，塞进 profiles 树会让既有全部
 * profile 测试立刻失败。附带的正确后果是几何数值不进 `numeric-classification.ts` 的 1-5 审计
 * ——归一化坐标是几何而不是玩家可见玩法数值，本就不该受宪法刻度约束。
 *
 * 依赖：docs/L0_规范宪法.md（五并列原则）、docs/L2_基类层/03_空间系统.md（场景三档与连接数上限）、
 * src/class/scenes/index.json（结构边界与禁令）、docs/L3_玩法层/07_地图生产管线.md
 */

/** 归一化坐标。两轴都取 [0,1]，相对底图左上角。 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** 遮挡规格：描述视觉或物理遮挡的形状与范围。 */
export interface ObstructionSpec {
  readonly shape: 'box' | 'circle' | 'polygon';
  readonly bounds?: readonly Vec2[];
}

/** 过渡窗口的样条过渡点（平滑样条的外插补充定位点）。 */
export interface TransitionWindowPoints {
  readonly control: readonly Vec2[];
}

/**
 * 坐标一律归一化而非像素。
 *
 * 底图会被反复重绘与放大（BaseImage → Clarity 精修 → 切片重组），像素尺寸在管线里是会变的量。
 * 若坐标以像素记，每次换底图或改分辨率都要重算全图拓扑，等于每次美术迭代都作废一次拓扑工作。
 * 归一化后美术与拓扑彼此独立迭代：换一张同构图、把 1080P 升到 4K，拓扑数据字节不变。
 */
export const COORD_MIN = 0;
export const COORD_MAX = 1;

/** 天然场景的三档尺度。取自 `scene.valueset.scene_scales`。 */
export type SceneScale = 'large' | 'medium' | 'small';

/**
 * 各档场景的最大连接数（docs/L2_基类层/03_空间系统.md）。
 *
 * `src/class/scenes/index.json` 的 `structural-bound.scene.connection_limit` 取值 5，那是
 * 五并列原则给出的**天花板**；L2/03 按尺度进一步收紧。校验必须用这张更严的表，否则一张
 * 小场景连出 5 条边的地图能过校验却违反基类层规范。
 *
 * 宪法第十二条的五并列例外只覆盖**公共变量**（如 Boss 血量），不覆盖拓扑连接数，因此这里
 * 没有任何例外分支。
 */
export const CONNECTION_LIMIT: Readonly<Record<SceneScale, number>> = {
  large: 5,
  medium: 4,
  small: 3,
};

/** 合法的下级场景尺度。空数组表示该档不可再嵌套天然场景。 */
export const ADMITTED_CHILD_SCALES: Readonly<Record<SceneScale, readonly SceneScale[]>> = {
  large: ['medium'],
  medium: ['small'],
  small: [],
};

/** 过渡连接的方向性。取自 `scene.valueset.transition_directionalities`。 */
export type Directionality = 'bidirectional' | 'unidirectional' | 'one-way-down' | 'one-way-up';

/**
 * 一个天然场景节点。
 *
 * `def` 是要实例化的基类层 Def id；`scale` 是连接数与嵌套规则所依据的尺度。两者都留在数据里
 * 而不是从 def 反查，是为了让 `validateMapStructure` 在没有基类层索引时也能跑完结构校验
 * ——编辑器要在每次拖动后即时反馈，不能每帧去加载目录。`validateMapAgainstClasses` 再补上
 * "def 确实存在，且它声明的尺度与这里一致"这一层。
 */
export interface MapNode {
  readonly id: string;
  readonly def: string;
  readonly scale: SceneScale;
  /** 归一化坐标，渲染用。删掉它拓扑依然完整。 */
  readonly at: Vec2;
  /** Legacy v1 的楼层号；canonical v3 使用 layerId + 可空高度排序值。 */
  readonly floor: number;
  /** 玩家可见名称。`playerFacing` 的节点必须有。 */
  readonly name?: string;
}

/**
 * 一条过渡连接。
 *
 * **本类型故意没有 `weight` 字段。** 通行代价属于门户类型（走廊 1 AP、门锁 2 AP、跳窗 0 AP……
 * 见 docs/L2_基类层/03_空间系统.md 门户系统一节），不是地图作者逐边填的数。作者选 `def`，
 * 数值由该门户类型在基类层声明——否则同一类楼梯会在不同地图里代价不同，平衡数值就散了。
 *
 * 曲线更不参与代价：`metrics.ts` 的代价是 `link.weight * node.weight` 相乘，玩家可见刻度受
 * 宪法 1-5 约束，��作者画一条绕远的路不该因此变成 weight=47。本文件不 import curve.ts，
 * 这条由依赖结构保证。
 *
 * ⚠️ 未接通（见 docs/L3_玩法层/07_地图生产管线.md 第五节）：`PrefabDef.links[]` 没有 weight
 * 字段，`prefab.spawn` 调 `createLinkShape` 时不传，所以运行期所有连接的 weight 都是默认值 1。
 * 门户类型本身也还没在 src/class/ 登记（只有抽象的 transition.class.scene_link）。两件事要一起做。
 */
export interface MapEdge {
  readonly id: string;
  readonly def: string;
  readonly a: string;
  readonly b: string;
  readonly directionality: Directionality;
  /**
   * 手绘曲线，归一化坐标。至少两点，首尾分别贴合 a、b 的节点坐标。
   * 直接喂给运动核做沿路动画；为空时渲染层退化为直线。
   */
  readonly path: readonly Vec2[];
  /** 视觉遮挡规格（如墙、高草丛）：影响可见性渲染但不阻止通行。 */
  readonly visualObstruction?: ObstructionSpec;
  /** 物理遮挡规格（如路障）：影响通行判定。与门户 def 的 blocking 分离。 */
  readonly physicalObstruction?: ObstructionSpec;
  /** 过渡窗口样条过渡点：渲染层用于绘制进/出的动画窗口。 */
  readonly transitionWindow?: TransitionWindowPoints;
  /** 语义锚点（高低地）：影响战术语义，不参与代价。 */
  readonly semanticAnchor?: 'high' | 'low' | 'neutral';
}

/**
 * 一次实例放置：把仓库里的一个完整实例快照内联到某个节点上。
 *
 * 过地图边界一律内联而非引用（见 06_创作系统与产权 第四节），所以这里没有"引用外部实例库"的
 * 字段——`def` 与 `overrides` 合起来就是快照本身，地图自包含。
 */
export interface MapPlacement {
  readonly id: string;
  /** 宿主节点 id。 */
  readonly at: string;
  readonly def: string;
  /**
   * 放置参数覆写。值是字面量。
   *
   * 键名不得与 Expr 判别键（`path`/`op`/`call`/`q`/`var`）相同：`PrefabDef.entities[].overrides`
   * 的类型是 `Record<string, Expr>`，而 `Expr` 是**非判别联合**——含这些键名的字面对象会被
   * 求值器误读为 Expr 节点而不是数据（该歧义在 `kernel/state/expr-types.ts` 中已注明）。
   * `path` 尤其危险，它是地图语境下极自然的字段名。
   */
  readonly overrides?: Readonly<Record<string, unknown>>;
  /** 是否为地图自带的临时免费实例。随复制传染，不靠推导。 */
  readonly temporaryFree?: boolean;
}

/** 底图与切片清单。纯渲染信息。 */
export interface MapBackdrop {
  /** 底图资源相对路径。 */
  readonly image: string;
  /** 底图像素尺寸，仅供渲染层换算；拓扑不依赖它。 */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** 切片行列数。整图未切片时为 1×1。 */
  readonly tileRows: number;
  readonly tileCols: number;
}

/** 一张完整地图。 */
export interface MapData {
  readonly schemaVersion: '1.0';
  /** 玩家命名 + 随机 key。 */
  readonly id: string;
  readonly name: string;
  readonly backdrop: MapBackdrop;
  /** 声明用到的楼层号，升序。地面层为 0。 */
  readonly floors: readonly number[];
  readonly nodes: readonly MapNode[];
  readonly edges: readonly MapEdge[];
  readonly placements: readonly MapPlacement[];
}

// ---------------------------------------------------------------------------
// 图层 contract 扩展（Task 1：canonical layers/layerId + legacy 规范化入口）
//
// 旧的 `floor` / `floors` 只在导入边界出现；canonical 形状以 `layers` 列表 +
// 节点的 `layerId` 引用表达层级。`schemaVersion: '2.0'` 表示 **只含 canonical
// 字段**（无 floor / floors）；`'1.0'` 保留为 legacy 导入兼容版本，由
// `normalizeMapDocument` 规范化为 canonical 形状。独立层：`height` 省略，
// 不参与高度差比较且恒不透明（L.1-L.10 权威在 docs/创作系统/01 §九）。
// ---------------------------------------------------------------------------

/** 图层可选的背景图（全屏=固定比例尺铺满 / 局部=贴纸）。 */
export interface LayerBackdrop {
  readonly image: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/** 图层变换：缩放 + 平移，用于图层间对齐（候选 3：不承载边界）。 */
export interface LayerTransform {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly tx: number;
  readonly ty: number;
}

/** Zone 是互相独立的地图区域，不承载几何高度关系。 */
export interface MapLayer {
  readonly id: string;
  readonly name?: string;
  readonly backdrop?: LayerBackdrop;
  readonly transform?: LayerTransform;
  /** 未来有限视野扩展点；缺省等同 all。 */
  readonly visibilityScope?: 'all' | 'party' | 'self';
}

/** Canonical v3：layers 是 zone 列表；不携带 legacy floors。 */
export interface CanonicalMapData extends Omit<MapData, 'floors' | 'nodes' | 'schemaVersion'> {
  readonly schemaVersion: '3.0';
  readonly layers: readonly MapLayer[];
  readonly nodes: readonly CanonicalMapNode[];
}

/** Canonical 节点：layerId 选择 zone，floor 仅用于 zone 内高度排序。 */
export interface CanonicalMapNode extends Omit<MapNode, 'floor'> {
  readonly layerId: string;
  readonly floor: number | null;
}

/**
 * Legacy 地图 v1：仍使用 `floors` / `MapNode.floor`。只在导入边界出现，
 * 加载时经 `normalizeMapDocument` 规范化为 `CanonicalMapData`。
 */
export interface LegacyMapData extends MapData {
  readonly schemaVersion: '1.0';
  readonly nodes: readonly LegacyMapNode[];
}

/** Legacy 节点：用整数 `floor` 引用 `LegacyMapData.floors` 中的声明楼层。 */
export interface LegacyMapNode extends Omit<MapNode, 'floor'> {
  readonly floor: number;
}

/** 规范化入口的输入文档：legacy v1 或 canonical v3。 */
export type MapDataDocument = LegacyMapData | CanonicalMapData;

/** Expr 判别键。放置覆写的键名撞上其中任何一个都必须被拒绝。 */
export const EXPR_DISCRIMINANT_KEYS: readonly string[] = ['path', 'op', 'call', 'q', 'var'];

/** 把 legacy floor 编号映射到稳定的 canonical 图层 id，避免和手工 layerId 撞名。 */
export function deriveLayerId(floor: number): string {
  return `layer:floor:${floor}`;
}

/** Canonical/legacy 节点 zone 引用统一入口。 */
export function normalizeNodeLayerRef(node: { readonly layerId?: string; readonly floor?: number | null }): string {
  return node.layerId ?? deriveLayerId(node.floor ?? 0);
}

function clonePoint(point: Vec2): Vec2 {
  return { x: point.x, y: point.y };
}

function cloneLayerBackdrop(backdrop: LayerBackdrop): LayerBackdrop {
  return {
    image: backdrop.image,
    pixelWidth: backdrop.pixelWidth,
    pixelHeight: backdrop.pixelHeight,
  };
}

function cloneLayerTransform(transform: LayerTransform): LayerTransform {
  return {
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    tx: transform.tx,
    ty: transform.ty,
  };
}

function normalizeMapLayer(layer: MapLayer & { readonly height?: number }): MapLayer {
  return {
    id: layer.id,
    ...(layer.name !== undefined ? { name: layer.name } : {}),
    ...(layer.backdrop !== undefined ? { backdrop: cloneLayerBackdrop(layer.backdrop) } : {}),
    ...(layer.transform !== undefined ? { transform: cloneLayerTransform(layer.transform) } : {}),
    ...(layer.visibilityScope !== undefined ? { visibilityScope: layer.visibilityScope } : {}),
  };
}

function normalizeMapBackdrop(backdrop: MapBackdrop): MapBackdrop {
  return {
    image: backdrop.image,
    pixelWidth: backdrop.pixelWidth,
    pixelHeight: backdrop.pixelHeight,
    tileRows: backdrop.tileRows,
    tileCols: backdrop.tileCols,
  };
}

function normalizeMapNodeBase(node: {
  readonly id: string;
  readonly def: string;
  readonly scale: SceneScale;
  readonly at: Vec2;
  readonly name?: string;
}): Pick<MapNode, 'id' | 'def' | 'scale' | 'at' | 'name'> {
  return {
    id: node.id,
    def: node.def,
    scale: node.scale,
    at: clonePoint(node.at),
    ...(node.name !== undefined ? { name: node.name } : {}),
  };
}

function normalizeCanonicalNode(node: CanonicalMapNode): CanonicalMapNode {
  return {
    ...normalizeMapNodeBase(node),
    layerId: normalizeNodeLayerRef(node),
    floor: node.floor ?? null,
  };
}

function normalizeLegacyNode(node: LegacyMapNode): CanonicalMapNode {
  return {
    ...normalizeMapNodeBase(node),
    layerId: normalizeNodeLayerRef(node),
    floor: node.floor,
  };
}

function normalizeObstruction(spec: ObstructionSpec): ObstructionSpec {
  return {
    shape: spec.shape,
    ...(spec.bounds !== undefined ? { bounds: spec.bounds.map(clonePoint) } : {}),
  };
}

function normalizeTransitionWindow(window: TransitionWindowPoints): TransitionWindowPoints {
  return {
    control: window.control.map(clonePoint),
  };
}

function normalizeMapEdge(edge: MapEdge): MapEdge {
  return {
    id: edge.id,
    def: edge.def,
    a: edge.a,
    b: edge.b,
    directionality: edge.directionality,
    path: edge.path.map(clonePoint),
    ...(edge.visualObstruction !== undefined ? { visualObstruction: normalizeObstruction(edge.visualObstruction) } : {}),
    ...(edge.physicalObstruction !== undefined ? { physicalObstruction: normalizeObstruction(edge.physicalObstruction) } : {}),
    ...(edge.transitionWindow !== undefined ? { transitionWindow: normalizeTransitionWindow(edge.transitionWindow) } : {}),
    ...(edge.semanticAnchor !== undefined ? { semanticAnchor: edge.semanticAnchor } : {}),
  };
}

function normalizeMapPlacement(placement: MapPlacement): MapPlacement {
  return {
    id: placement.id,
    at: placement.at,
    def: placement.def,
    ...(placement.overrides !== undefined ? { overrides: { ...placement.overrides } } : {}),
    ...(placement.temporaryFree !== undefined ? { temporaryFree: placement.temporaryFree } : {}),
  };
}

function uniqueSortedFloors(values: readonly number[]): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function legacyFloors(document: LegacyMapData): readonly number[] {
  return uniqueSortedFloors([
    ...document.floors,
    ...document.nodes.map((node) => node.floor),
  ]);
}

function normalizeLegacyLayers(document: LegacyMapData): readonly MapLayer[] {
  return legacyFloors(document).map((floor) => normalizeMapLayer({ id: deriveLayerId(floor), name: `Zone ${floor}` }));
}

function normalizeCanonicalLayers(layers: readonly MapLayer[]): readonly MapLayer[] {
  return layers.map((layer) => normalizeMapLayer(layer));
}

function normalizeCanonicalNodes(nodes: readonly CanonicalMapNode[]): readonly CanonicalMapNode[] {
  return nodes.map((node) => normalizeCanonicalNode(node));
}

function normalizeLegacyNodes(nodes: readonly LegacyMapNode[]): readonly CanonicalMapNode[] {
  return nodes.map((node) => normalizeLegacyNode(node));
}

/** v1 → v3 单向迁移；canonical 输入保持 zone 顺序并清洗旧字段。 */
export function normalizeMapDocument(document: MapDataDocument): CanonicalMapData {
  const canonical = document.schemaVersion === '3.0';
  return {
    schemaVersion: '3.0',
    id: document.id,
    name: document.name,
    backdrop: normalizeMapBackdrop(document.backdrop),
    layers: canonical ? normalizeCanonicalLayers(document.layers) : normalizeLegacyLayers(document),
    nodes: canonical ? normalizeCanonicalNodes(document.nodes) : normalizeLegacyNodes(document.nodes),
    edges: document.edges.map(normalizeMapEdge),
    placements: document.placements.map(normalizeMapPlacement),
  };
}
