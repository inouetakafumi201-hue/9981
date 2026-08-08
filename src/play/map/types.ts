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
export type Directionality = 'bidirectional' | 'unidirectional';

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
  /** 所在楼层。同一底图上的地面层为 0。 */
  readonly floor: number;
  /**
   * 上级天然场景 id。缺省表示顶层。
   *
   * ⚠️ 未接通（见 docs/L3_玩法层/07_地图生产管线.md 第五节）：`PrefabDef.nodes[]` 没有 parent
   * 字段，`prefab.spawn` 建节点时不传，所以运行期所有场景都是平的。校验器仍然完整检查层级
   * （MAP_PARENT_NOT_FOUND / MAP_ILLEGAL_SCENE_NESTING / MAP_PARENT_CYCLE）——那些检查本身
   * 是对的，只是它们守的字段目前到不了运行期。
   *
   * 这不是小洞：L2/03 的距离公式建立在「同一天然场景 / 跨天然场景」之上，微型场景也靠
   * `Node.parent` 挂载（micro-scene.ts），`graph.ts` 按 parent 查子节点。层级塌平，距离模型
   * 就没有依据。`node.create` 本来接受 parent——只有预制结构这条批量路径表达不出来。
   */
  readonly parent?: string;
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
 * 宪法 1-5 约束，而作者画一条绕远的路不该因此变成 weight=47。本文件不 import curve.ts，
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

/** Expr 判别键。放置覆写的键名撞上其中任何一个都必须被拒绝。 */
export const EXPR_DISCRIMINANT_KEYS: readonly string[] = ['path', 'op', 'call', 'q', 'var'];
