# ORCA 寻路与移动系统设计补全

> **性质**：**表现层技术设计（可直接实现）**。本文补全 `01_图形化与UI.md` §前端动态图形化的数据契约、接口定义、算法伪代码、测试用例与实现里程碑，让实现者可直接按此写代码。
> **若干关键定位（本文档的立足点）**：
> - **这套系统全景属于表现层，与玩法层/引擎层完全解耦**。碰撞箱、可通行域、ORCA、恢复对峙、泛光圈、朝向全由表现层自己注册、自己管理、自己计算。
> - 表现层**不知道**玩法层的"微型场景"是什么，不感知其 Node、owner、生命周期；它只知道自己维护的**对峙群 / 微场景点（碰撞簇）**。
> - 表现层与玩法层之间**唯一的耦合点**：**不可动实体的微型场景归属静默迁移**。表现层只作"搭桥信号源"（识别归属脱节并上送信号），归属改写与静默放置归玩法层/数据层完成，表现层自身**不做归属改写、不播归位动画**。
> **最后更新**：2026-08-19
> **依赖**：`01_图形化与UI.md` §前端动态图形化（设计权威）、`09_图形化实现落点.md` §九（库选择）、`02_镜头动态设计.md`（镜头跟随）

---

## 一、总体架构

### 系统分层

```
┌─────────────────────────────────────────────────┐
│  表现层 UI                                       │
│  - 移动动画（Framer Motion）                     │
│  - 泛光圈渲染（SVG）                             │
│  - 朝向翻面（CSS scaleX）                        │
└─────────────────────────────────────────────────┘
                     ↓ 事件 / 编排
┌─────────────────────────────────────────────────┐
│  编排层（Choreography）                          │
│  - MoveChoreographer：移动演出编排               │
│  - AttackChoreographer：三动画攻击编排           │
│  - StandoffResolver：恢复对峙 / 传染调度         │
└─────────────────────────────────────────────────┘
                     ↓ 调用
┌─────────────────────────────────────────────────┐
│  空间计算层（Spatial）                           │
│  - CollisionRegistry：碰撞箱注册与查询           │
│  - TraversableComputer：可通行域预运算           │
│  - PathfindingService：A* 点对点寻路             │
│  - OrcaEngine：ORCA 避障                         │
│  - StandoffAlgorithm：恢复对峙算法               │
│  - ClusterStore：对峙群 / 微场景点 维护          │
└─────────────────────────────────────────────────┘
                     ↓ 读写
┌─────────────────────────────────────────────────┐
│  空间状态（zustand）                             │
│  - spatialStore：碰撞箱、可通行域、对峙群        │
│  - facingStore：朝向状态                         │
│  - glowStore：泛光圈半径                         │
└─────────────────────────────────────────────────┘
```

> 图中"对峙群 / 微场景点（ClusterStore）"是表现层自己的数据，**不是**玩法层的微型场景——表现层不知道后者。它只是"一群活体 + 一个中心锚点 + 一个泛光圈"的自洽概念。

### 关键数据流（一次移动）

```
用户点击移动目标
  ↓
段1：可通行判定（TraversableComputer.canTraverse）
  ├─ 可通行 → 提交意图
  └─ 不可通行 → 动作灰显 + 提示
       ↓
规则层结算（entity.place Op，属玩法/引擎层，表现层不感知）
  ↓
玩法层发出 after:entity.place 事件（表现层在此消费）
  ↓
MoveChoreographer 收到事件
  ↓
段2：实时寻路（PathfindingService.findPath + OrcaEngine.smooth）
  ├─ 成功 → 播放移动动画
  └─ 失败 → 提示"路径被活体阻挡"（不回滚规则）
       ↓
移动动画结束
  ↓
StandoffResolver.resolve（恢复对峙）
  ├─ 向心移位迭代松弛（以当前对峙群中心为锚）
  └─ 传染式连锁（挤到其他可动碰撞箱 → 传染其所在对峙群）
       ↓
恢复对峙动画结束
  ↓
若该实体触发行动轮结束 → 交权前等全部演出停（见 01 §并发权责）
```

---

## 二、核心数据结构

### 2.1 基础类型

```typescript
/** 二维向量（世界坐标，像素） */
interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** 实体 ID（引用玩法/引擎层 Id，仅作锚点，不承载玩法语义） */
type EntityId = string;
```

> 表现层只把 `EntityId` 当成**可区分的键**用它匹配 sprite 与碰撞箱；不解析其指向的玩法对象是什么。

### 2.2 碰撞箱

```typescript
/** 碰撞箱（圆形）。表现层自己注册、自管，独立于玩法层。 */
interface CollisionBox {
  /** 圆心位置（世界坐标，贴图最下方几何中心） */
  readonly center: Vec2;

  /** 半径（像素）= 贴图宽度之半的 80% */
  readonly radius: number;

  /** 可动性分类（决定是否纳入 ORCA / 是否被扰动） */
  readonly mobility: CollisionMobility;

  /** 关联实体 ID（表现层键） */
  readonly entityId: EntityId;

  /** 所属对峙群（微场景点）ID——表现层自管，非玩法层微型场景 */
  readonly clusterId: string;
}

type CollisionMobility =
  | 'movable-actor'      // 可动活体  （玩家、NPC）→ 参与 ORCA / 受扰动
  | 'movable-entity'     // 可动实体  （有人驾驶的车）→ 参与 ORCA / 受扰动
  | 'immovable-actor'    // 不可动活体（睡眠中玩家）→ 不参与 / 不受扰动
  | 'immovable-entity';  // 不可动实体（无人车、柜子）→ 仅作硬边界
```

### 2.3 可通行域

```typescript
/** 可通行域（栅格）——段1 预运算产物，全部障碍静态部分 */
interface TraversableDomain {
  readonly width: number;      // 栅格宽度（格子数）
  readonly height: number;     // 栅格高度（格子数）
  readonly cellSize: number;   // 格子大小（像素）
  readonly grid: ReadonlyArray<ReadonlyArray<boolean>>;  // true = 可通行
  readonly origin: Vec2;       // 世界坐标原点
}

function worldToGrid(world: Vec2, domain: TraversableDomain): { x: number; y: number } {
  return {
    x: Math.floor((world.x - domain.origin.x) / domain.cellSize),
    y: Math.floor((world.y - domain.origin.y) / domain.cellSize),
  };
}

function gridToWorld(grid: { x: number; y: number }, domain: TraversableDomain): Vec2 {
  return {
    x: domain.origin.x + grid.x * domain.cellSize + domain.cellSize / 2,
    y: domain.origin.y + grid.y * domain.cellSize + domain.cellSize / 2,
  };
}
```

### 2.4 对峙群 / 微场景点（表现层自洽概念）

```typescript
/** 对峙群（微场景点）。表现层自管，不等同玩法层微型场景。 */
interface Cluster {
  /** 对峙群 ID */
  readonly id: string;

  /** 中心锚点（恢复对峙向心移位、泛光圈圆心） */
  center: Vec2;

  /** 群内实体 ID 列表 */
  entityIds: ReadonlyArray<EntityId>;

  /** 泛光圈半径（像素） */
  glowRadius: number;
}
```

> **Cluster 与玩法层微型场景的关系**：Cluster 的**形态**受玩法层微型场景语义启发（一群活体 + 一个中心、点状扎堆），用于还原"同微型场景的人聚拢成一撮"的视觉。但表现层**只维护这份自洽数据**，不知道也不直接读取玩法层的微型场景 Node；它只是从 `after:*` 事件负载得知"哪些实体同群、中心在哪"。

---

## 三、碰撞箱注册系统（表现层自管）

### 3.1 接口定义

```typescript
/** 碰撞箱注册表（表现层专职） */
interface CollisionRegistry {
  /** 注册碰撞箱（实体 spawn / 出现在画面上时由表现层调用） */
  register(params: {
    entityId: EntityId;
    spriteWidth: number;
    spriteHeight: number;
    position: Vec2;
    mobility: CollisionMobility;
    clusterId: string;
  }): CollisionBox;

  /** 更新碰撞箱位置 */
  updatePosition(entityId: EntityId, newPosition: Vec2): void;

  /** 更新可动性（车辆上下车时由表现层调用） */
  updateMobility(entityId: EntityId, newMobility: CollisionMobility): void;

  /** 注销碰撞箱（实体 despawn / 从画面移除时调用） */
  unregister(entityId: EntityId): void;

  /** 查询单个 */
  get(entityId: EntityId): CollisionBox | null;

  /** 查询某对峙群内全部碰撞箱 */
  getByCluster(clusterId: string): ReadonlyArray<CollisionBox>;

  /** 查询全体 */
  getAll(): ReadonlyArray<CollisionBox>;

  /** 查询可动碰撞箱（用于 ORCA / 传染判断） */
  getMovable(): ReadonlyArray<CollisionBox>;
}
```

### 3.2 碰撞箱半径与中心

```typescript
/** 半径 = 贴图宽度之半的 80%（01 §碰撞箱，待调试可调） */
function calcCollisionRadius(spriteWidth: number): number {
  return (spriteWidth / 2) * 0.8;
}

/** 圆心 = 贴图最下方几何中心（01 §碰撞箱） */
function calcCollisionCenter(position: Vec2, spriteWidth: number, spriteHeight: number): Vec2 {
  return { x: position.x + spriteWidth / 2, y: position.y + spriteHeight };
}
```

### 3.3 可动性判定辅助函数

```typescript
/** 是否参与 ORCA / 是否被扰动（01 §碰撞箱分类） */
function isMovable(mobility: CollisionMobility): boolean {
  return mobility === 'movable-actor' || mobility === 'movable-entity';
}

/** 是否有朝向逻辑（仅可动活体） */
function hasFacing(mobility: CollisionMobility): boolean {
  return mobility === 'movable-actor';
}
```

### 3.4 车辆可动性动态切换

有人驾驶的车 = 可动实体；最后一人下车 = 不可动实体。由表现层监听上车/下车事件后调用 `updateMobility`。

---

## 四、可通行域预运算（段1）

### 4.1 接口

```typescript
interface TraversableComputer {
  /** 预运算可通行域（对局运行时启动，Web Worker 异步，不阻塞 UI）。只烘培静态几何。 */
  compute(params: {
    mapData: MapData;   // 表现层读到的地图数据（框组 / 物理遮挡 / 地形）
    cellSize: number;   // 栅格精度，推荐 16px
  }): Promise<TraversableDomain>;

  /**
   * 段1 判定两点是否可通行（移动命令灰显）。
   * 含动态碰撞箱：不假设它们避让，按当前位置当静态障碍算（01 §寻路失败机制的动态平衡）。
   */
  canTraverse(
    domain: TraversableDomain,
    from: Vec2,
    to: Vec2,
    moverRadius: number,                          // 移动者的碰撞箱半径
    collisionBoxes: ReadonlyArray<CollisionBox>,  // 全体碰撞箱（可动+不可动）；调用方排除移动者自身
  ): boolean;
}
```

### 4.2 预运算算法

```typescript
function computeTraversableDomain(mapData: MapData, cellSize: number): TraversableDomain {
  const bounds = calcWorldBounds(mapData);
  const width = Math.ceil(bounds.width / cellSize);
  const height = Math.ceil(bounds.height / cellSize);
  const grid = Array.from({ length: height }, () => Array(width).fill(true));

  // 只烘培静态几何（墙、地形、永久物理遮挡）
  for (const obstacle of mapData.obstacles) {
    markObstacle(grid, obstacle, cellSize, bounds.origin);
  }

  return { width, height, cellSize, grid, origin: bounds.origin };
}
```

> **注意**：**可通行域只烘培静态几何**（`01` §双段寻路段1"静态，障碍不动的部分"）。一切碰撞箱（可动 + 不可动）都**不烘培进域**，而是在每次 `canTraverse` / `findPath` 时按**移动者半径动态膨胀并入**：
> - 碰撞箱位置随对局变化（车辆可动性切换、活体移动），烘培进域会过期，违背"实时碰撞箱不可能靠编辑器预运算"的语义。
> - 每次判定按当前快照并入 = "不假设避让"：**堵死就是堵死**。这正是 `01` §ORCA 寻路失败机制的动态平衡——人群堵住路径 → 寻路失败 → 不再进入 → 不更挤。

### 4.3 可通行判定（胶囊扫掠 + 系数膨胀）

```typescript
/**
 * 段1：from→to 线段按 moverRadius 扫掠成胶囊，对几何与全体碰撞箱做判定。
 * 任何一处相交 → 不可通行。判定用"圆心点 + 膨胀半径"（配置空间）：
 * 几何按 moverRadius 膨胀；碰撞箱按 moverRadius + 碰撞箱半径 × 可调系数 膨胀。
 *
 * 膨胀系数 ROOM_FACTOR（默认 <1，待调试）：
 * - 不膨胀（0）= 只见"缝隙完全能穿"，稀疏场面一路行云流水，与挤拥画面脱节；
 * - 全膨胀（1）= 两人并肩堵住场景入口，正常玩家就觉得"几个人堵着我怎么过不去"，
 *   产生"同场景明明能穿过去"的违和感；
 * - 比例膨胀（默认 0.5 档）= 多数稀疏情形仍可穿（贴近自然），真正拥挤到"过分"才判不可通，
 *   守住 01 §寻路失败机制的动态平衡。系数留作调试参数，先粗调、再用例校准。
 */
function canTraverse(
  domain: TraversableDomain,
  from: Vec2,
  to: Vec2,
  moverRadius: number,
  collisionBoxes: ReadonlyArray<CollisionBox>,
  roomFactor = DEFAULT_ROOM_FACTOR,   // 待调试，默认 0.5
): boolean {
  const fromGrid = worldToGrid(from, domain);
  const toGrid = worldToGrid(to, domain);
  if (!isInGrid(fromGrid, domain) || !isInGrid(toGrid, domain)) return false;
  if (!domain.grid[fromGrid.y][fromGrid.x] || !domain.grid[toGrid.y][toGrid.x]) return false;

  // a) 几何障碍：Bresenham 采样障碍格，格子中心到线段距离 < moverRadius → 挡
  for (const cell of bresenhamLine(fromGrid, toGrid)) {
    if (domain.grid[cell.y][cell.x]) continue;
    const p = gridToWorld(cell, domain);
    if (distToSegment(p, from, to) < moverRadius) return false;
  }

  // b) 全体碰撞箱（可动 + 不可动）：圆心到线段距离 < moverRadius + box.radius × roomFactor → 挡
  for (const box of collisionBoxes) {
    if (distToSegment(box.center, from, to) < moverRadius + box.radius * roomFactor) return false;
  }

  return true;
}

/** 膨胀系数（待调试；<1 表示"不完全膨胀"——多数稀疏情形仍可穿） */
const DEFAULT_ROOM_FACTOR = 0.5;
```

> **"点判定 vs 身体判定"的答案**：判定用**点**（圆心），但点是**带系数的配置空间**里的点——几何按 `moverRadius` 膨胀、碰撞箱按 `moverRadius + box.radius × roomFactor` 膨胀。比例膨胀让"点可通行"近似等价于"身体不至于明显穿模"，同时给"稀疏可穿、过分才堵"留出余量。可动实体也被算进去，不假设它们会避让；堵死就是堵死。
>
> **系数怎么调**（先粗调、再用例校准）：默认从 `0.5` 起步——同场景移动绝大多数情况该能穿（贴合"同场景可穿"的常识），只有拥挤到"过分"才判不可通；如果出现"贴脸穿模"就把系数调高，如果出现"稀疏堵死"就把系数调低。每个地图包在发布前用一组固定回归用例压住这个系数，避免调参漂移。
>
> **快照来源**：判定用规则层的稳定位置（回合制下他人行动期间不移动，定态成立），不用演出中的半途视觉位置。

---

## 五、A* 点对点寻路（段2·路径骨架）

### 5.1 接口

```typescript
interface PathfindingService {
  /** 点对点寻路：返回路径点数组，失败 null */
  findPath(params: {
    domain: TraversableDomain;
    from: Vec2;
    to: Vec2;
    dynamicCollisionBoxes: ReadonlyArray<CollisionBox>;
  }): Vec2[] | null;
}
```

### 5.2 实现（`pathfinding` 库）

```typescript
import { Grid, AStarFinder } from 'pathfinding';

function findPath({ domain, from, to, dynamicCollisionBoxes }: {
  domain: TraversableDomain;
  from: Vec2;
  to: Vec2;
  dynamicCollisionBoxes: ReadonlyArray<CollisionBox>;
}): Vec2[] | null {
  const grid = new Grid(domain.width, domain.height);
  for (let y = 0; y < domain.height; y++)
    for (let x = 0; x < domain.width; x++)
      if (!domain.grid[y][x]) grid.setWalkableAt(x, y, false);

  // 把所有碰撞箱都标进来：可动实体、不可动实体都参与段2 的路径骨架判定
  // 这不假设它们会避让；如果当前快照下堵住，就直接找不到路
  for (const box of dynamicCollisionBoxes) {
    blockGridCircle(grid, worldToGrid(box.center, domain), box.radius, domain.cellSize);
  }

  const finder = new AStarFinder({ allowDiagonal: true, dontCrossCorners: true });
  const fromG = worldToGrid(from, domain);
  const toG = worldToGrid(to, domain);
  const path = finder.findPath(fromG.x, fromG.y, toG.x, toG.y, grid);

  return path.length === 0 ? null : path.map(([x, y]) => gridToWorld({ x, y }, domain));
}
```

> A* 管"静态障碍 + 不可动硬边界的粗略路径骨架"；可动活体间的实时避让交给 ORCA（`01` §双段寻路段2"活体-活体"）。

---

## 六、ORCA 避障（段2·实时挤压）

### 6.1 接口

```typescript
interface OrcaEngine {
  /** 初始化仿真器，纳入一批可动 agent */
  init(agents: ReadonlyArray<{ id: EntityId; position: Vec2; radius: number; maxSpeed: number }>): void;

  /** 设置某 agent 的目标速度 */
  setPreferredVelocity(agentId: EntityId, velocity: Vec2): void;

  /** 执行一步仿真，返回各 agent 新位置 */
  step(timeStep: number): Map<EntityId, Vec2>;

  /** 在 A* 路径上做 ORCA 平滑避让，返回平滑路径点 */
  smoothPath(params: {
    pathPoints: Vec2[];
    agent: { id: EntityId; radius: number; maxSpeed: number };
    otherAgents: ReadonlyArray<CollisionBox>;
    timeStep: number;
  }): Promise<Vec2[] | null>;
}
```

### 6.2 实现（`rvo2-js` 优先；自实现简化 ORCA 备选）

优先尝试 `rvo2-js`（见 `09` §九·二）。核心接入：

```typescript
import * as RVO from 'rvo2-js';

class Rvo2Orca implements OrcaEngine {
  private sim = new RVO.Simulator();
  private agentMap = new Map<EntityId, number>();

  init(agents) {
    this.sim = new RVO.Simulator();
    this.sim.setTimeStep(1 / 60);
    this.sim.setAgentDefaults(15, 10, 1.0, 1.0, 1.5, 100);
    for (const a of agents) {
      const id = this.sim.addAgent([a.position.x, a.position.y]);
      this.sim.setAgentRadius(id, a.radius);
      this.sim.setAgentMaxSpeed(id, a.maxSpeed);
      this.agentMap.set(a.id, id);
    }
  }

  setPreferredVelocity(agentId, velocity) {
    const id = this.agentMap.get(agentId);
    if (id !== undefined) this.sim.setAgentPrefVelocity(id, [velocity.x, velocity.y]);
  }

  step(timeStep) {
    this.sim.setTimeStep(timeStep);
    this.sim.doStep();
    const out = new Map();
    for (const [entityId, id] of this.agentMap) {
      const p = this.sim.getAgentPosition(id);
      out.set(entityId, { x: p[0], y: p[1] });
    }
    return out;
  }

  async smoothPath({ pathPoints, agent, otherAgents, timeStep }) {
    const agents = [
      { id: agent.id, position: pathPoints[0], radius: agent.radius, maxSpeed: agent.maxSpeed },
      ...otherAgents.filter(isMovable).map(b => ({
        id: b.entityId, position: b.center, radius: b.radius, maxSpeed: 0,
      })),
    ];
    this.init(agents);

    const smooth: Vec2[] = [pathPoints[0]];
    let current = pathPoints[0];
    for (let i = 1; i < pathPoints.length; i++) {
      const target = pathPoints[i];
      this.setPreferredVelocity(agent.id, scale(normalize(subtract(target, current)), agent.maxSpeed));
      let guard = 0;
      while (distance(current, target) > 5 && guard++ < 1000) {
        current = this.step(timeStep).get(agent.id)!;
        smooth.push(current);
      }
    }
    return smooth;
  }
}
```

> **传染式连锁的 ORCA 纳入**：当某个活体的行走被 ORCA 挤到**另一个可动碰撞箱**时，把那个碰撞箱对应的实体也 `init` 进仿真器（或触发它所在对峙群一次恢复对峙）。这正是 `01` §ORCA"单向传染"的落点——**纳入 ORCA + 触发一次恢复对峙**。

> **不用纯斥力**：本设计**只允许 ORCA**（`01` 明确拒绝纯斥力）。ORCA 每帧解可行速度，天然无冲突、无抖动、保证泛光圈不重叠。

---

## 七、恢复对峙算法

### 7.1 接口

```typescript
/** 恢复对峙：给定一个对峙群（微场景点），求每个活体的目标位 */
interface StandoffAlgorithm {
  resolve(params: {
    cluster: Cluster;                         // 表现层自管的对峙群（含中心锚）
    actors: ReadonlyArray<{ id: EntityId; pos: Vec2; box: CollisionBox }>;
    traversableDomain: TraversableDomain;
    allCollisionBoxes: ReadonlyArray<CollisionBox>;  // 全体碰撞箱并集（跨群）
  }): Map<EntityId, Vec2>;
}
```

### 7.2 向心移位迭代松弛

照搬 `01` §恢复对峙三步（可站性判定 → 向心移位 → 被卡兜底），**向心锚 = Cluster.center**：

```typescript
function resolveStandoff({ cluster, actors, traversableDomain, allCollisionBoxes }): Map<EntityId, Vec2> {
  const target = new Map<EntityId, Vec2>();

  for (const actor of actors) {
    // 1. 可站性：原位即可站 → 一步不走（"吃面包没人动"的 no-op 来源）
    if (canStandAt(actor.pos, actor.box, allCollisionBoxes, traversableDomain)) {
      target.set(actor.id, actor.pos);
      continue;
    }

    // 2. 向心移位：沿「当前位置 → 中心」方向试探，找最近合法可站位
    const toCenter = normalize(subtract(cluster.center, actor.pos));
    let candidate = actor.pos;
    let found = false;
    for (let step = 0; step < 50; step++) {
      candidate = add(candidate, scale(toCenter, 2));
      if (canStandAt(candidate, actor.box, allCollisionBoxes, traversableDomain)) {
        target.set(actor.id, candidate);
        found = true;
        break;
      }
    }

    // 3. 被卡兜底（模糊退让）：多方向微位移找最近可站位；真无解才回滚原位
    if (!found) {
      const dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},
                    {x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}];
      for (const d of dirs) {
        candidate = add(actor.pos, scale(d, 10));
        if (canStandAt(candidate, actor.box, allCollisionBoxes, traversableDomain)) {
          target.set(actor.id, candidate);
          found = true;
          break;
        }
      }
    }
    if (!found) target.set(actor.id, actor.pos);  // 死胡同回滚
  }
  return target;
}

/** 可站 = 在可通行域内，且不与任何碰撞箱重叠（跨群并集判定，见 01） */
function canStandAt(pos, actorBox, allCollisionBoxes, traversableDomain): boolean {
  const g = worldToGrid(pos, traversableDomain);
  if (!isInGrid(g, traversableDomain) || !traversableDomain.grid[g.y][g.x]) return false;
  for (const box of allCollisionBoxes) {
    if (box.entityId === actorBox.entityId) continue;
    if (distance(pos, box.center) < actorBox.radius + box.radius) return false;
  }
  return true;
}
```

**关键**：可站性判定与向心试探都对着**全体碰撞箱并集**——不管碰撞箱来自哪个对峙群（`01` §恢复对峙"跨微型场景的碰撞箱"）。表现层没有"微型场景"概念，但"全体碰撞箱并集"天然跨群，达成同样的效果。

---

## 八、传染式连锁

### 8.1 接口

```typescript
interface ContagionScheduler {
  /** 触发传染式连锁恢复对峙（以某对峙群为起点，单向传染） */
  triggerContagion(params: {
    initialClusterId: string;
    disturbedEntities: ReadonlyArray<EntityId>;
  }): Promise<void>;
}
```

### 8.2 单向传染算法

`01` §ORCA"单向传染"——`我挤它 → 它恢复 → 它可能再挤下一个`，不允许被传染者回头扰动发起者成环。表现层实现对峙群的调度：

```typescript
async function triggerContagion({ initialClusterId, disturbedEntities }): Promise<void> {
  const visited = new Set<string>();
  const queue: string[] = [initialClusterId];

  while (queue.length > 0) {
    const clusterId = queue.shift()!;
    if (visited.has(clusterId)) continue;
    visited.add(clusterId);

    const cluster = clusterStore.get(clusterId);
    const actors = cluster.entityIds.map(id => ({
      id, pos: spatialStore.getPosition(id), box: collisionRegistry.get(id)!,
    }));

    const targets = standoffAlgorithm.resolve({
      cluster,
      actors,
      traversableDomain: spatialStore.traversableDomain,
      allCollisionBoxes: collisionRegistry.getAll(),
    });

    // 播放恢复对峙位移动画
    await Promise.all([...targets.entries()].map(([id, p]) =>
      moveTo(getSprite(id), p)
    ));

    // 检测是否挤到其他对峙群的可动碰撞箱 → 传染（单向）
    const next: Set<string> = new Set();
    for (const [id, p] of targets) {
      const actorBox = collisionRegistry.get(id)!;
      for (const other of collisionRegistry.getMovable()) {
        if (other.entityId === id || other.clusterId === clusterId) continue;
        if (distance(p, other.center) < actorBox.radius + other.radius + 5) {
          next.add(other.clusterId);
        }
      }
    }
    for (const cid of next) if (!visited.has(cid)) queue.push(cid);

    if (visited.size > 10) {  // 有限步收敛护栏
      console.warn('传染式连锁超过 10 层，强制终止');
      break;
    }
  }
}
```

> **单向护栏**：只有当碰撞来自"未访问过的对峙群"才传染，已访问过的群不回头扰动（防环）。
>
> **交互与生命周期补充**：场景框/地面承载椭圆、空旷地自动容纳、Cluster/Footprint 注销、多人 3000ms 交权上限和单人非阻塞规则以 `15_表现层生命周期与交互桥设计.md` 为现行权威。

---

## 九、泛光圈动态（对峙群点层）

### 9.1 泛光圈的视觉语义与几何

泛光圈不是悬浮特效，也不是正圆形按钮。泛光圈是踩在所有实体脚底下的地面承载面，用来表达微型场景的空间范围和可点击移动目标。

```ts
interface GroundGlowFootprint {
  readonly center: Vec2
  readonly radiusX: number
  readonly radiusY: number
  readonly rotation: 0
  readonly occupantCount: number
  readonly interactive: boolean
}
```

- 形状为椭圆，`radiusX > radiusY`，模拟固定正面俯视镜头下的地面接触面。
- 椭圆中心落在实体脚底/微型场景地面锚点，不位于实体头顶或实体中心上方。
- 多实体微型场景的椭圆承载面由其 Cluster 地面中心派生；实体离开后中心和轴长重新投影。
- 椭圆可以使用柔和边缘、材质高光和低频呼吸，但这些是地面承载面的视觉表现，不得渲染成浮空圆形光圈。
- 作为交互目标时，命中测试使用椭圆区域；可访问性名称来自微型场景投影，不来自 CSS 特效名称。
- 当 `occupantIds.length === 0` 时，GroundGlowFootprint、Cluster 和 Glow projection 必须注销；不保留空椭圆。

### 9.2 半径

```typescript
const GLOW_BASE_RADIUS = 32;          // 像素，待调试
const GLOW_RADIUS_PER_ENTITY = 8;     // 每实体 +8px，待调试

function calcGlowRadius(entityCount: number): { radiusX: number; radiusY: number } {
  return {
    radiusX: GLOW_BASE_RADIUS + entityCount * GLOW_RADIUS_PER_ENTITY,
    radiusY: (GLOW_BASE_RADIUS + entityCount * GLOW_RADIUS_PER_ENTITY) * 0.48,
  };
}
```

### 9.3 重叠检测 + 传染

```typescript
function detectGlowOverlap(clusters: ReadonlyArray<Cluster>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < clusters.length; i++)
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i], b = clusters[j];
      if (distance(a.center, b.center) < a.glowRadius + b.glowRadius) pairs.push([a.id, b.id]);
    }
  return pairs;
}

/** 泛光圈重叠 → 触发两个对峙群的传染式 ORCA 相互排斥（01 §泛光圈） */
function handleGlowOverlap(): void {
  for (const [a, b] of detectGlowOverlap(clusterStore.getAll())) {
    contagionScheduler.triggerContagion({ initialClusterId: a, disturbedEntities: clusterStore.get(a).entityIds });
  }
}

/** 椭圆地面承载面的交互命中，不是按钮或浮空特效命中。 */
function hitGroundGlow(point: Vec2, footprint: GroundGlowFootprint): boolean {
  const dx = (point.x - footprint.center.x) / footprint.radiusX;
  const dy = (point.y - footprint.center.y) / footprint.radiusY;
  return dx * dx + dy * dy <= 1;
}
```

> "泛光圈不可重叠"由与实体层同一套传染机制守住（`01` §ORCA"传染同时作用实体层与微场景点层"）——表现层的对峙集群既是实体层也是点层，共用同一传染。

### 9.4 渲染

```tsx
function GroundGlowFootprintView({ footprint }: { footprint: GroundGlowFootprint }) {
  return (
    <ellipse
      cx={footprint.center.x}
      cy={footprint.center.y}
      rx={footprint.radiusX}
      ry={footprint.radiusY}
      fill="url(#ground-glow-gradient)"
      className="ground-glow-footprint transition-all duration-300 ease-out"
    />
  );
}
```

---

## 十、朝向视觉系统

单一左右朝向，纯画面因素（`01` §朝向）。

```typescript
type Facing = 'left' | 'right';
interface FacingStore { facings: Map<EntityId, Facing>; setFacing(id, f): void; getFacing(id): Facing; }

const calcFacing = (actor: Vec2, target: Vec2): Facing => target.x < actor.x ? 'left' : 'right';

/** 攻击后目标转向攻击者 */
function handleAttackFacing(actorId, targetId) {
  const a = spatialStore.getPosition(actorId), t = spatialStore.getPosition(targetId);
  facingStore.setFacing(targetId, calcFacing(t, a));
}

/** 新活体进入对峙群 → 随机 1-3 人转向它（绝不全员转向） */
function handleEntryFacing(newId, clusterId) {
  const others = clusterStore.get(clusterId).entityIds.filter(id => id !== newId);
  const turnCount = Math.floor(Math.random() * 3) + 1;
  const pos = spatialStore.getPosition(newId);
  for (const id of randomSample(others, turnCount)) facingStore.setFacing(id, calcFacing(spatialStore.getPosition(id), pos));
}
```

恢复对峙**不改朝向**（`01` §朝向）：恢复对峙只改位置，不触碰 `facingStore`。

---

## 十一、与玩法层的唯一耦合：不可动实体归属静默迁移（表现承接桥）

### 11.1 定位（本文档立足点）

这套系统与玩法层的**唯一耦合点**。其余全部自洽，表现层可独立实现。

### 11.2 各层权责（照 `01` §不可动实体归属静默归位）

| 层 | 角色 |
|---|---|
| **玩法层 / 数据层** | 归属改写逻辑：把"归属已脱节的不可动实体"改归到**距离它最近的同天然场景微场景点** |
| **表现层** | 只作**搭桥信号源**：识别"该不可动实体的点已飘得足够远"，上送一个"可归位"信号；**表现层自身不做归属改写、不播归位动画** |

### 11.3 表现层信号源

```typescript
const DRIFT_THRESHOLD = 100;  // 像素，待调试

/** 纯函数：识别归属已脱节的不可动实体 */
function detectDriftedImmovables(
  colliders: ReadonlyArray<CollisionBox>,
  clusters: ReadonlyArray<Cluster>,
): EntityId[] {
  const drifted: EntityId[] = [];
  for (const box of colliders) {
    if (box.mobility !== 'immovable-entity') continue;   // 只关心不可动实体
    const cluster = clusters.find(c => c.id === box.clusterId);
    if (cluster && distance(box.center, cluster.center) > DRIFT_THRESHOLD) {
      drifted.push(box.entityId);
    }
  }
  return drifted;
}

/** 表现承接桥：把"可归位"信号递交给玩法层/数据层（唯一耦合点） */
export function emitRelocatableSignal(): void {
  const drifted = detectDriftedImmovables(
    collisionRegistry.getAll(),
    clusterStore.getAll(),
  );
  if (drifted.length > 0) {
    eventBus.emit('presentation:immovable-relocatable', { entityIds: drifted });
  }
}
```

### 11.4 契机与静默性

- **契机**：`after:turn-end`（单玩家行动轮结束；NPC 每次行动完也暗中结算一次，`01` §静默归位）。
- **静默**：**没有任何归位动画**。归属改写后，表现层只在数据侧把该实体从旧对峙群挂到新对峙群（`collisionRegistry` 的 `clusterId` 更新），**不播放位置动画**——不可动实体本来就是停着的硬边界，改的是"它属于哪个群"这个归属，不是让它移动。
- **表现层不做逻辑改动**：归属改写由玩法层完成，表现层只是继承结果。（`01`：这一改动动的是数据层归属，表现层不动。）

> 这与 `01` §解耦约束一致——"表现层只作搭桥信号源，自身不做任何逻辑改动"。

---

## 十二、编排层（Choreography）

### 12.1 移动编排器

```typescript
export class MoveChoreographer {
  constructor(eventBus, pathfindingService, orcaEngine, standoffAlgorithm, contagionScheduler) {
    eventBus.on('after:entity.place', async (ev) => this.handleMove(ev.payload));
  }

  private async handleMove({ entityId, from, to, pathPoints }) {
    const myBox = collisionRegistry.get(entityId)!;

    // 段2 A* 骨架（动态碰撞箱也参与：不假设避让，堵死即无路）
    // 排除移动者自身参与阻塞；其余可动/不可动都参与
    const others = collisionRegistry.getAll().filter(b => b.entityId !== entityId);
    const path = pathPoints ?? this.pathfindingService.findPath({
      domain: spatialStore.traversableDomain,
      from, to,
      dynamicCollisionBoxes: others,
    });
    if (!path) { showToast('路径被活体阻挡'); return; }   // 寻路失败，不回滚规则

    // ORCA 平滑避让
    const smooth = await this.orcaEngine.smoothPath({
      pathPoints: path,
      agent: { id: entityId, radius: myBox.radius, maxSpeed: 100 },
      otherAgents: collisionRegistry.getMovable().filter(b => b.entityId !== entityId),
      timeStep: 1 / 60,
    });

    if (!smooth) await this.playLinearMove(entityId, path);   // 降级直线
    else await this.playMoveAnimation(entityId, smooth);

    // 移动结束 → 该对峙群恢复对峙 + 可能传染
    await this.contagionScheduler.triggerContagion({
      initialClusterId: myBox.clusterId,
      disturbedEntities: [entityId],
    });
  }

  private async playMoveAnimation(entityId, path) {
    const sprite = getSprite(entityId);
    await animate(sprite, {
      x: path.map(p => p.x),
      y: path.map((p, i) => p.y - 20 * Math.sin((i / (path.length - 1)) * Math.PI)),  // 跳跃曲线
    }, { duration: 0.3, ease: [0.4, 0, 0.2, 1] });
  }

  private async playLinearMove(entityId, path) {
    const sprite = getSprite(entityId);
    await animate(sprite, { x: path.map(p => p.x), y: path.map(p => p.y) },
      { duration: 0.3, ease: 'linear' });
  }
}
```

### 12.2 攻击编排器（三动画模型）

```typescript
export class AttackChoreographer {
  constructor(eventBus, contagionScheduler) {
    eventBus.on('after:attack', async (ev) => this.handleAttack(ev.payload));
  }

  private async handleAttack({ actorId, targetId, hitResult }) {
    // ① 快步跳移动
    await this.dashTo(actorId, targetId);
    // ② 攻击 + 受击 / 招架
    if (hitResult === 'hit') await Promise.all([this.attack(actorId), this.hit(targetId)]);
    else if (hitResult === 'parry') await this.parry(actorId, targetId);   // 走全屏演出
    // ③ 恢复对峙
    await this.contagionScheduler.triggerContagion({
      initialClusterId: collisionRegistry.get(actorId)!.clusterId,
      disturbedEntities: [actorId, targetId],
    });
    handleAttackFacing(actorId, targetId);
  }
  // dashTo / attack / hit / parry 为位移动画 + 受击帧，不赘述
}
```

> 编排层只监听 `after:*` 事件、重演规则结果（静止站位 / 位移结果），**不改变规则结算、不提交 AP / 状态**（`01` §实现约束）。

---

## 十三、性能监控与降级

| 指标 | 目标 | 降级 |
|---|---|---|
| ORCA 每帧 | < 5ms | 超时 → 直线位移（不避让） |
| 恢复对峙收敛 | < 16ms | 超时 → 回滚上一稳定态 |
| A* 寻路 | < 10ms | 超时 → "路径被阻挡" |
| 同屏活体 | < 20 | 超时 → 渲染剔除远处 |
| 同屏泛光圈 | < 15 | 超时 → 只渲染可交互圈 |

```typescript
const perf = { orca: 0, standoff: 0, path: 0 };
function sample(label, fn) {
  const t0 = performance.now(); fn();
  const ms = performance.now() - t0;
  perf[label] = ms;
  const limit = label === 'orca' ? 5 : label === 'standoff' ? 16 : 10;
  if (ms > limit) console.warn(`${label} 超时 ${ms.toFixed(2)}ms`);
}
```

同屏 > 20 → `cullDistantEntities()`（以镜头为中心 500px 外隐藏）。

---

## 十四、测试用例

### 14.1 碰撞箱

```typescript
describe('CollisionRegistry', () => {
  it('计算半径与圆心', () => {
    const r = new CollisionRegistry();
    const box = r.register({ entityId:'p1', spriteWidth:64, spriteHeight:64,
      position:{x:100,y:100}, mobility:'movable-actor', clusterId:'c1' });
    expect(box.radius).toBe((64/2)*0.8);
    expect(box.center).toEqual({ x:132, y:164 });
  });
  it('车辆可动性切换', () => {
    const r = new CollisionRegistry();
    r.register({ entityId:'car', spriteWidth:128, spriteHeight:128,
      position:{x:200,y:200}, mobility:'immovable-entity', clusterId:'c1' });
    r.updateMobility('car','movable-entity');
    expect(r.get('car')!.mobility).toBe('movable-entity');
  });
});
```

### 14.2 可通行判定（胶囊扫掠 + 动态碰撞箱 + 系数膨胀）

```typescript
describe('TraversableComputer', () => {
  it('几何障碍 + 配置空间膨胀拦截', () => {
    const domain = allWalkable(10,10,16);
    domain.grid[5][5] = false;
    const c = new TraversableComputer();
    // 无碰撞箱：直线不触碰障碍格 → 可通行
    expect(c.canTraverse(domain,{x:0,y:0},{x:100,y:100},20,[])).toBe(true);
    // 直线恰好穿过障碍中心（格子中心-线段距离<半径）→ 被 moverRadius 膨胀挡下
    expect(c.canTraverse(domain,{x:0,y:0},{x:88,y:88},20,[])).toBe(false);
  });

  it('动态碰撞箱参与段1：不假设避让，堵死即失败', () => {
    const domain = allWalkable(10,10,16);
    const c = new TraversableComputer();
    // 一辆可动车停在直线中点附近 → 即使它是可动（本可避让），段1 也判不可通行
    const car = { entityId:'car', center:{x:48,y:48}, radius:16,
                 mobility:'movable-entity', clusterId:'c1' };
    expect(c.canTraverse(domain,{x:0,y:0},{x:100,y:100},20,[car])).toBe(false);
    // 把它移开 → 恢复可通行
    const moved = { ...car, center:{x:200,y:200} };
    expect(c.canTraverse(domain,{x:0,y:0},{x:100,y:100},20,[moved])).toBe(true);
  });

  it('系数膨胀：roomFactor 越大越容易挡，越小越容易穿', () => {
    const domain = allWalkable(10,10,16);
    const c = new TraversableComputer();
    // 一个中等碰撞箱偏在线段一侧：距离 30，mover 半径 20
    // 系数 0.3 → 阈值 20+20*0.3=26 < 30 → 可穿
    const box = { entityId:'x', center:{x:50,y:30}, radius:20,
                 mobility:'movable-actor', clusterId:'c1' };
    expect(c.canTraverse(domain,{x:0,y:0},{x:100,y:100},20,[box],0.3)).toBe(true);
    // 系数 1.0 → 阈值 20+20*1.0=40 > 30 → 挡
    expect(c.canTraverse(domain,{x:0,y:0},{x:100,y:100},20,[box],1.0)).toBe(false);
  });
});
```

### 14.3 恢复对峙收敛

```typescript
describe('StandoffAlgorithm', () => {
  it('向中心收敛且互不重叠', () => {
    const cluster = { id:'c1', center:{x:100,y:100}, entityIds:['p1','p2'], glowRadius:48 };
    const actors = [
      { id:'p1', pos:{x:50,y:50}, box:box('p1',{x:50,y:50},'c1') },
      { id:'p2', pos:{x:150,y:150}, box:box('p2',{x:150,y:150},'c1') },
    ];
    const t = resolveStandoff({ cluster, actors,
      traversableDomain: allWalkable(20,20,10),
      allCollisionBoxes: actors.map(a=>a.box) });
    expect(t.get('p1')!.x).toBeGreaterThan(50);
    expect(t.get('p2')!.x).toBeLessThan(150);
  });
});
```

### 14.4 泛光圈重叠

```typescript
describe('detectGlowOverlap', () => {
  it('检测重叠与忽略分离', () => {
    const near = [cluster('a',{x:100,y:100},40), cluster('b',{x:150,y:100},40)];  // 距50<80
    const far  = [cluster('a',{x:100,y:100},40), cluster('b',{x:300,y:100},40)];  // 距200>80
    expect(detectGlowOverlap(near)).toHaveLength(1);
    expect(detectGlowOverlap(far)).toHaveLength(0);
  });
});
```

### 14.5 不可动实体脱节识别（表现承接桥信号源）

```typescript
describe('detectDriftedImmovables', () => {
  it('识别归属脱节的可动群中心、且不涉及可动实体', () => {
    const boxes = [
      immovable('car','c1',{x:300,y:300}),
      movable('p1','c1',{x:100,y:100}),
    ];
    const clusters = [ cluster('c1',{x:100,y:100},48) ];  // 中心距 car=282>100 → 脱节
    const drifted = detectDriftedImmovables(boxes, clusters);
    expect(drifted).toEqual(['car']);   // 只有不可动实体的 car，p1 是可动不判
  });
});
```

---

## 十五、实现里程碑（checkbox）

> 严格按"先让移动能看到 → 再加避让 → 补恢复对峙 → 再补泛光圈与承接桥"推进，每个里程碑走三命令门禁（`tsc --noEmit` / `vitest run` / `lint`）。

### 里程碑 1：最小移动动画（无 ORCA）
- [ ] `CollisionRegistry` 实现（碰撞箱注册 / 半径 / 圆心）
- [ ] `CollisionBox` / `Vec2` / 可动性类型
- [ ] `after:entity.place` 事件监听（移动演出入口）
- [ ] 直线位移动画（Framer Motion）
- [ ] 跳跃曲线配方（正常 / 重物 / 迟缓）
- [ ] 朝向翻面（CSS scaleX）
- [ ] 测试：碰撞箱注册 + 移动动画

### 里程碑 2：碰撞箱 + A* 寻路
- [ ] `TraversableComputer`（Web Worker 预运算可通行域）
- [ ] 段1 可通行判定（动作灰显）
- [ ] `PathfindingService`（`pathfinding` 库 A*）
- [ ] 不可动实体当作动态硬边界标记
- [ ] 测试：可通行判定 + A* 寻路

### 里程碑 3：ORCA 避让 + 恢复对峙 + 传染
- [ ] 引入 `rvo2-js` 或自实现简化 ORCA
- [ ] `OrcaEngine.smoothPath` 接入移动动画
- [ ] `StandoffAlgorithm`（向心移位 + 被卡兜底）
- [ ] `ContagionScheduler`（单向传染牧场层调度）
- [ ] 三动画攻击模型（`AttackChoreographer`）
- [ ] 测试：ORCA 避让 + 恢复对峙 + 传染

### 里程碑 4：泛光圈 + 不可动实体承接桥
- [ ] `ClusterStore` / 对峙群维护
- [ ] 泛光圈视觉（SVG + 半径动态）+ 重叠检测
- [ ] 泛光圈重叠触发传染式 ORCA
- [ ] 不可动实体脱节识别（`detectDriftedImmovables`）
- [ ] **表现承接桥**：`emitRelocatableSignal` 上送"可归位"信号（静默、无动画）
- [ ] 车辆可动性动态切换（上车/下车）
- [ ] 测试：泛光圈重叠 + 脱节识别

### 里程碑 5：性能优化 + 降级
- [ ] 性能监控（ORCA / 恢复对峙 / A* 耗时）
- [ ] 超时降级（ORCA → 直线位移）
- [ ] 渲染剔除（同屏活体 > 20）
- [ ] 压力测试（20+ 活体同屏）

---

## 十六、数学辅助函数

向量运算 / Bresenham / 随机采样 / 点在多边形内 见 `09` §九与 `src/ui/presentation` 常见工具，不重复：

```typescript
add / subtract / scale / distance / normalize / bresenhamLine / randomSample / pointInPolygon
```

---

## 十七、文件结构建议

```
src/
├── ui/presentation/
│   ├── spatial/
│   │   ├── collision-registry.ts      // 碰撞箱注册（表现层自管）
│   │   ├── traversable-computer.ts    // 可通行域预运算（段1）
│   │   ├── pathfinding-service.ts     // A* 点对点寻路（段2骨架）
│   │   ├── orca-engine.ts             // ORCA 避障（段2实时）
│   │   ├── standoff-algorithm.ts      // 恢复对峙
│   │   ├── contagion-scheduler.ts     // 传染式连锁
│   │   └── cluster-store.ts           // 对峙群 / 微场景点（表现层自管）
│   ├── choreography/
│   │   ├── move-choreographer.ts
│   │   ├── attack-choreographer.ts
│   │   └── immovable-relocate-bridge.ts   // 表现承接桥（唯一耦合点）
│   ├── components/
│   │   ├── GroundGlowFootprint.tsx
│   │   └── EntitySprite.tsx
│   └── stores/
│       ├── spatial-store.ts
│       ├── facing-store.ts
│       └── glow-store.ts
└── workers/
    └── traversable-domain.worker.ts
```

---

**本文档完成 ORCA 寻路与移动系统的表现层技术设计补全。立足点：全景自洽于表现层，唯一与玩法层耦合处为"不可动实体微型场景归属静默迁移"，表现层只作搭桥信号源、静默无动画。**
