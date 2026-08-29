/**
 * 地图管线契约测试。
 *
 * 结构与 `profile-field-ownership.test.ts` 一致：每条校验规则都配一个**能证伪它**的反向用例
 * ——放宽任何一条规则，对应用例必须失败。只断言"合法地图能过"是空转的，那种测试在校验器
 * 被整体注释掉后依然全绿。
 *
 * 另有一组属性测试钉住编译的确定性与几何函数的不变量。属性测试的输入必须真的能撞到被测判据
 * ——例如坐标生成器必须能产出越界值，否则"越界被拒绝"这条永远不会被执行到。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  canPublish,
  validateMapAgainstClasses,
  validateMapStructure,
  type MapClassIndex,
  type MapDiagnostic,
} from '../validate';
import { adjacencyOf, compileMap, connectedGroups } from '../compile';
import {
  distance,
  findSnapTarget,
  insertControlPoint,
  pathLength,
  perpendicularDistance,
  resamplePath,
  simplifyPath,
} from '../curve';
import type { MapData, MapEdge, MapNode, MapPlacement, Vec2 } from '../types';
import { CONNECTION_LIMIT } from '../types';

// ---------------------------------------------------------------------------
// 构造器
// ---------------------------------------------------------------------------

function node(id: string, overrides: Partial<MapNode> = {}): MapNode {
  return {
    id,
    def: 'd:scene/room',
    scale: 'medium',
    at: { x: 0.5, y: 0.5 },
    floor: 0,
    ...overrides,
  };
}

function edge(id: string, a: string, b: string, overrides: Partial<MapEdge> = {}): MapEdge {
  return {
    id,
    def: 'd:transition/door',
    a,
    b,
    directionality: 'bidirectional',
    path: [],
    ...overrides,
  };
}

function placement(id: string, at: string, overrides: Partial<MapPlacement> = {}): MapPlacement {
  return { id, at, def: 'inst_locker_7f3a', ...overrides };
}

function map(overrides: Partial<MapData> = {}): MapData {
  return {
    schemaVersion: '1.0',
    id: 'wushi_campus_7f3a',
    name: '测试校园',
    backdrop: { image: 'campus.png', pixelWidth: 1920, pixelHeight: 1080, tileRows: 1, tileCols: 1 },
    floors: [0],
    nodes: [],
    edges: [],
    placements: [],
    ...overrides,
  };
}

function codesOf(findings: readonly MapDiagnostic[]): readonly string[] {
  return findings.map((finding) => finding.code);
}

/** 一张最小的合法地图：两个中场景 + 一条双向连接。 */
function validMap(): MapData {
  return map({
    nodes: [
      node('n_hall', { at: { x: 0.2, y: 0.3 }, name: '门厅' }),
      node('n_lab', { at: { x: 0.7, y: 0.6 }, name: '实验室' }),
    ],
    edges: [
      edge('e_1', 'n_hall', 'n_lab', {
        path: [{ x: 0.2, y: 0.3 }, { x: 0.45, y: 0.4 }, { x: 0.7, y: 0.6 }],
      }),
    ],
    placements: [placement('p_1', 'n_lab')],
  });
}

// ---------------------------------------------------------------------------
// 基线
// ---------------------------------------------------------------------------

describe('地图校验：合法地图', () => {
  it('一张最小合法地图没有任何诊断，且可发布', () => {
    const findings = validateMapStructure(validMap());
    expect(findings).toEqual([]);
    expect(canPublish(findings)).toBe(true);
  });

  it('空地图合法——新建地图时的初始状态不该报错', () => {
    expect(validateMapStructure(map())).toEqual([]);
  });

  it('曲线留空合法：渲染层退化为直线，不是错误', () => {
    const data = map({
      nodes: [node('a', { at: { x: 0.1, y: 0.1 } }), node('b', { at: { x: 0.9, y: 0.9 } })],
      edges: [edge('e', 'a', 'b', { path: [] })],
    });
    expect(validateMapStructure(data)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 每条规则的反向用例
// ---------------------------------------------------------------------------

describe('地图校验：能证伪每条规则的反向用例', () => {
  it('拒绝越界坐标——归一化坐标是美术与拓扑解耦的前提', () => {
    const data = map({ nodes: [node('a', { at: { x: 1.4, y: 0.5 } })] });
    const findings = validateMapStructure(data);
    expect(codesOf(findings)).toEqual(['MAP_COORD_OUT_OF_RANGE']);
    expect(findings[0]?.message).toContain('0-1 之外');
  });

  it('拒绝 NaN 坐标——它会静默污染所有几何计算', () => {
    const data = map({ nodes: [node('a', { at: { x: Number.NaN, y: 0.5 } })] });
    expect(codesOf(validateMapStructure(data))).toEqual(['MAP_COORD_OUT_OF_RANGE']);
  });

  it('拒绝重复节点 id', () => {
    const data = map({ nodes: [node('dup'), node('dup')] });
    expect(codesOf(validateMapStructure(data))).toContain('MAP_DUPLICATE_NODE_ID');
  });

  it('拒绝未声明的楼层——避免节点落在渲染层不知道的层上', () => {
    const data = map({ floors: [0], nodes: [node('a', { floor: 3 })] });
    const findings = validateMapStructure(data);
    expect(codesOf(findings)).toEqual(['MAP_UNDECLARED_FLOOR']);
    expect(findings[0]?.correction).toContain('3');
  });

  it('MapNode 不再表达父子嵌套，场景拓扑只由边表达', () => {
    const data = map({ nodes: [node('big', { scale: 'large' }), node('small', { scale: 'small' })] });
    expect(validateMapStructure(data)).toEqual([]);
  });

  it('拒绝端点不存在的连接', () => {
    const data = map({ nodes: [node('a')], edges: [edge('e', 'a', 'ghost')] });
    expect(codesOf(validateMapStructure(data))).toEqual(['MAP_EDGE_ENDPOINT_NOT_FOUND']);
  });

  it('拒绝自环', () => {
    const data = map({ nodes: [node('a')], edges: [edge('e', 'a', 'a')] });
    expect(codesOf(validateMapStructure(data))).toEqual(['MAP_SELF_LOOP']);
  });

  // 这里曾经有两条 MAP_WEIGHT_OUT_OF_SCALE 的测试（代价超限、代价非整数），随 MapEdge.weight
  // 一起删除。通行代价属于门户类型（走廊 1 AP、门锁 2 AP、跳窗 0 AP……见 L2/03 门户系统一节），
  // 不是地图作者���边填的数——否则同一类楼梯会在不同地图里代价不同。作者只选 def。
  // 反向守卫在下面「编译产物里不出现 weight」：谁把逐边 weight 加回来，那条会红。

  it('拒绝没吸附上的曲线端点——浮点缝隙会让运行期判出端点不存在', () => {
    const data = map({
      nodes: [node('a', { at: { x: 0.1, y: 0.1 } }), node('b', { at: { x: 0.9, y: 0.9 } })],
      edges: [edge('e', 'a', 'b', { path: [{ x: 0.13, y: 0.1 }, { x: 0.9, y: 0.9 }] })],
    });
    const findings = validateMapStructure(data);
    expect(codesOf(findings)).toEqual(['MAP_PATH_ENDPOINT_NOT_SNAPPED']);
    expect(findings[0]?.message).toContain('起点');
  });

  it('容差内的端点视为已吸附——不能因为浮点尾数就报错', () => {
    const data = map({
      nodes: [node('a', { at: { x: 0.1, y: 0.1 } }), node('b', { at: { x: 0.9, y: 0.9 } })],
      edges: [edge('e', 'a', 'b', {
        path: [{ x: 0.100000001, y: 0.1 }, { x: 0.9, y: 0.900000001 }],
      })],
    });
    expect(validateMapStructure(data)).toEqual([]);
  });

  it('拒绝只有一个点的曲线', () => {
    const data = map({
      nodes: [node('a', { at: { x: 0.1, y: 0.1 } }), node('b', { at: { x: 0.9, y: 0.9 } })],
      edges: [edge('e', 'a', 'b', { path: [{ x: 0.1, y: 0.1 }] })],
    });
    expect(codesOf(validateMapStructure(data))).toContain('MAP_PATH_TOO_SHORT');
  });

  it('放置挂在不存在的节点上时报错', () => {
    const data = map({ placements: [placement('p', 'ghost')] });
    expect(codesOf(validateMapStructure(data))).toEqual(['MAP_PLACEMENT_HOST_NOT_FOUND']);
  });

  it('拒绝撞上 Expr 判别键的覆写键名——这是"不报错但静默误解"的形态', () => {
    const data = map({
      nodes: [node('a')],
      placements: [placement('p', 'a', { overrides: { path: 'corridor' } })],
    });
    const findings = validateMapStructure(data);
    expect(codesOf(findings)).toEqual(['MAP_OVERRIDE_KEY_SHADOWS_EXPR']);
    expect(findings[0]?.correction).toContain('pathValue');
  });

  it('五个 Expr 判别键每一个都被拦住', () => {
    for (const key of ['path', 'op', 'call', 'q', 'var']) {
      const data = map({
        nodes: [node('a')],
        placements: [placement('p', 'a', { overrides: { [key]: 1 } })],
      });
      expect(codesOf(validateMapStructure(data)), key).toContain('MAP_OVERRIDE_KEY_SHADOWS_EXPR');
    }
  });

  it('普通覆写键名不受影响', () => {
    const data = map({
      nodes: [node('a')],
      placements: [placement('p', 'a', { overrides: { locked: true, lockDC: 3 } })],
    });
    expect(validateMapStructure(data)).toEqual([]);
  });

  it('平行边只是警告，不阻止发布——一门一窗是合法设计', () => {
    const data = map({
      nodes: [node('a'), node('b')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'a', 'b')],
    });
    const findings = validateMapStructure(data);
    expect(codesOf(findings)).toEqual(['MAP_PARALLEL_EDGE']);
    expect(findings[0]?.severity).toBe('warning');
    expect(canPublish(findings)).toBe(true);
  });

  it('平行边判定不会被 id 里的分隔符伪造——节点 id 没有字符集限制', () => {
    // 若配对键用朴素分隔符拼接（如 '|'），("a|b","c") 与 ("a","b|c") 会算出同一个键，
    // 两条毫不相干的连接就被误报成平行边。这两条边各自连接不同的节点对。
    const data = map({
      nodes: [node('a|b'), node('c'), node('a'), node('b|c')],
      edges: [edge('e1', 'a|b', 'c'), edge('e2', 'a', 'b|c')],
    });
    expect(codesOf(validateMapStructure(data))).not.toContain('MAP_PARALLEL_EDGE');
  });

  it('id 含特殊字符时，真的平行边仍然报得出来', () => {
    const data = map({
      nodes: [node('a"|b'), node('c')],
      edges: [edge('e1', 'a"|b', 'c'), edge('e2', 'c', 'a"|b')],
    });
    expect(codesOf(validateMapStructure(data))).toContain('MAP_PARALLEL_EDGE');
  });

  it('一次报出全部问题，并按路径稳定排序', () => {
    const data = map({
      nodes: [node('a', { at: { x: 9, y: 9 } }), node('b', { floor: 7 })],
      edges: [edge('e', 'a', 'ghost')],
      placements: [placement('p', 'nowhere')],
    });
    const findings = validateMapStructure(data);
    // 数个数不够——4 条同码诊断也能凑够 4。这里钉住的是"四条不同规则同时开口"，
    // 校验器一旦改成遇错即返回（早退），这个集合会立刻缩水。
    expect(new Set(codesOf(findings))).toEqual(new Set([
      'MAP_COORD_OUT_OF_RANGE',
      'MAP_UNDECLARED_FLOOR',
      'MAP_EDGE_ENDPOINT_NOT_FOUND',
      'MAP_PLACEMENT_HOST_NOT_FOUND',
    ]));
    const paths = findings.map((f) => f.path);
    expect([...paths].sort((l, r) => l.localeCompare(r, 'en'))).toEqual(paths);
  });

  it('每条诊断都有面向创作者的说明与改法，不只有错误码', () => {
    const data = map({
      nodes: [node('a', { at: { x: 5, y: 5 }, floor: 9 })],
      edges: [edge('e', 'a', 'ghost')],
      placements: [placement('p', 'nowhere', { overrides: { op: 1 } })],
    });
    for (const finding of validateMapStructure(data)) {
      expect(finding.message.length, finding.code).toBeGreaterThan(0);
      expect(finding.correction.length, finding.code).toBeGreaterThan(0);
      expect(finding.message, finding.code).not.toMatch(/^[A-Z_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 连接数上限
// ---------------------------------------------------------------------------

describe('地图校验：五并列原则派生的连接数上限', () => {
  function starMap(scale: MapNode['scale'], spokes: number): MapData {
    return map({
      nodes: [
        node('hub', { scale }),
        ...Array.from({ length: spokes }, (_, i) => node(`leaf${i}`, { scale: 'small' })),
      ],
      edges: Array.from({ length: spokes }, (_, i) => edge(`e${i}`, 'hub', `leaf${i}`)),
    });
  }

  it('三档场景的上限各自生效：大 5、中 4、小 3', () => {
    for (const [scale, limit] of Object.entries(CONNECTION_LIMIT)) {
      const typed = scale as MapNode['scale'];
      const atLimit = validateMapStructure(starMap(typed, limit));
      expect(codesOf(atLimit), `${scale} 恰好 ${limit} 条应通过`)
        .not.toContain('MAP_CONNECTION_LIMIT_EXCEEDED');

      const overLimit = validateMapStructure(starMap(typed, limit + 1));
      expect(codesOf(overLimit), `${scale} 超过 ${limit} 条应被拒绝`)
        .toContain('MAP_CONNECTION_LIMIT_EXCEEDED');
    }
  });

  it('三档上限彼此不同——否则这张表退化成一个常量', () => {
    const values = new Set(Object.values(CONNECTION_LIMIT));
    expect(values.size).toBe(3);
  });

  it('上限报错说明为什么，而不只是报数字', () => {
    const findings = validateMapStructure(starMap('small', 4));
    const limit = findings.find((f) => f.code === 'MAP_CONNECTION_LIMIT_EXCEEDED');
    expect(limit?.message).toContain('小场景');
    expect(limit?.correction).toContain('五并列');
  });

  it('自环不计入连接数——它已被单独拒绝，不该重复计数', () => {
    const data = map({
      nodes: [node('a', { scale: 'small' })],
      edges: [edge('e1', 'a', 'a'), edge('e2', 'a', 'a')],
    });
    expect(codesOf(validateMapStructure(data))).not.toContain('MAP_CONNECTION_LIMIT_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// 跨目录引用
// ---------------------------------------------------------------------------

describe('地图校验：跨目录引用', () => {
  const index: MapClassIndex = {
    sceneDefs: new Map([
      ['d:scene/room', 'medium'],
      ['d:scene/yard', 'large'],
      ['d:scene/closet', 'small'],
    ]),
    transitionDefs: new Set(['d:transition/door']),
    placeableInstances: new Set(['inst_locker_7f3a']),
  };

  it('合法地图通过引用校验', () => {
    expect(validateMapAgainstClasses(validMap(), index)).toEqual([]);
  });

  it('拒绝未登记的场景类型，并说明不能在地图里现造', () => {
    const data = map({ nodes: [node('a', { def: 'd:scene/invented' })] });
    const findings = validateMapAgainstClasses(data, index);
    expect(codesOf(findings)).toEqual(['MAP_UNKNOWN_SCENE_DEF']);
    expect(findings[0]?.correction).toContain('不能在地图里现造');
  });

  it('拒绝尺度与 def 声明不一致——这是结构校验查不到的一类错', () => {
    const data = map({ nodes: [node('a', { def: 'd:scene/closet', scale: 'large' })] });
    // 结构校验对此无话可说，只有引用校验能发现。
    expect(codesOf(validateMapStructure(data))).toEqual([]);
    const findings = validateMapAgainstClasses(data, index);
    expect(codesOf(findings)).toEqual(['MAP_SCALE_MISMATCH']);
    expect(findings[0]?.message).toContain('小场景');
  });

  it('拒绝未登记的过渡类型', () => {
    const data = map({
      nodes: [node('a'), node('b')],
      edges: [edge('e', 'a', 'b', { def: 'd:transition/wormhole' })],
    });
    expect(codesOf(validateMapAgainstClasses(data, index))).toEqual(['MAP_EDGE_DEF_UNREGISTERED']);
  });

  it('拒绝不可放置的实例，并解释依附类要去工作台装插槽', () => {
    const data = map({
      nodes: [node('a')],
      placements: [placement('p', 'a', { def: 'status_poisoned' })],
    });
    const findings = validateMapAgainstClasses(data, index);
    expect(codesOf(findings)).toEqual(['MAP_UNKNOWN_INSTANCE']);
    expect(findings[0]?.correction).toContain('工作台');
  });
});

// ---------------------------------------------------------------------------
// 编译
// ---------------------------------------------------------------------------

describe('地图编译：MapData → PrefabDef', () => {
  it('编译产出可被 prefab.spawn 消费的形状', () => {
    const result = compileMap(validMap());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prefab.kind).toBe('prefab');
    expect(result.prefab.nodes.map((n) => n.key)).toEqual(['n_hall', 'n_lab']);
    expect(result.prefab.links).toEqual([
      { a: 'n_hall', b: 'n_lab', def: 'd:transition/door', directed: false, direction: 'bidirectional' },
    ]);
    expect(result.prefab.entities).toEqual([{ at: 'n_lab', def: 'inst_locker_7f3a' }]);
  });

  it('编译产物里没有任何几何——这就是"删掉几何照样跑"的可执行形式', () => {
    const result = compileMap(validMap());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.prefab);
    for (const geometryKey of ['at.x', 'floor', 'backdrop', 'pixelWidth', 'tileRows']) {
      expect(serialized, geometryKey).not.toContain(geometryKey);
    }
    // entities[].at 是宿主节点 key（拓扑），不是坐标——这一条确认它没被误当几何删掉。
    expect(result.prefab.entities?.[0]?.at).toBe('n_lab');
    expect(serialized).not.toContain('0.45');
  });

  it('单向连接编译为 directed:true', () => {
    const data = map({
      nodes: [node('a'), node('b')],
      edges: [edge('e', 'a', 'b', { directionality: 'unidirectional' })],
    });
    const result = compileMap(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prefab.links[0]?.directed).toBe(true);
  });

  it('有 error 时拒绝编译，不产出半成品', () => {
    const result = compileMap(map({ nodes: [node('a', { at: { x: 3, y: 3 } })] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.diagnostics)).toContain('MAP_COORD_OUT_OF_RANGE');
  });

  it('warning 不阻止编译，随成功结果一起返回', () => {
    const data = map({
      nodes: [node('a'), node('b')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'a', 'b')],
    });
    const result = compileMap(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codesOf(result.warnings)).toEqual(['MAP_PARALLEL_EDGE']);
  });

  it('编译产物里任何地方都不出现 weight——代价属于门户类型，不由地图数据携带', () => {
    // 这条同时守两件事：
    //   1. 作者填的逐边代价不会以实体覆写的形式偷偷进来（那会是静默无效的实体属性）；
    //   2. PrefabDef.links[] 里也不会出现 weight——它根本没这个字段，写了就是被丢弃。
    // 谁想恢复逐边 weight，必须先让门户类型这条路走通，而不是让这里悄悄通过。
    const result = compileMap(validMap());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.prefab)).not.toContain('weight');
  });

  it('temporaryFree 标记随编译保留——标记位靠数据传染而不是推导', () => {
    const data = map({
      nodes: [node('a')],
      placements: [placement('p', 'a', { temporaryFree: true })],
    });
    const result = compileMap(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prefab.entities?.[0]?.overrides?.['temporaryFree']).toBe(true);
  });

  it('编译是确定性的：同一输入编出字节相同的产物', () => {
    const data = validMap();
    expect(JSON.stringify(compileMap(data))).toBe(JSON.stringify(compileMap(data)));
  });
});

describe('地图编译：拓扑推演', () => {
  it('邻接表对双向边两侧都记，对单向边只记一侧', () => {
    const data = map({
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        edge('e1', 'a', 'b'),
        edge('e2', 'b', 'c', { directionality: 'unidirectional' }),
      ],
    });
    const adjacency = adjacencyOf(data);
    expect(adjacency.get('a')).toEqual(['b']);
    expect(adjacency.get('b')).toEqual(['a', 'c']);
    expect(adjacency.get('c')).toEqual([]);
  });

  it('孤岛被识别出来，但不是错误——拓扑允许不连通', () => {
    const data = map({
      nodes: [node('a'), node('b'), node('island')],
      edges: [edge('e', 'a', 'b')],
    });
    expect(connectedGroups(data)).toEqual([['a', 'b'], ['island']]);
    expect(canPublish(validateMapStructure(data))).toBe(true);
  });

  it('连通性判定忽略方向——单向边不该被算成孤岛', () => {
    const data = map({
      nodes: [node('a'), node('b')],
      edges: [edge('e', 'a', 'b', { directionality: 'unidirectional' })],
    });
    expect(connectedGroups(data)).toEqual([['a', 'b']]);
  });
});

// ---------------------------------------------------------------------------
// 几何
// ---------------------------------------------------------------------------

describe('曲线几何', () => {
  it('RDP 保留首尾点——它们已精确吸附节点，任何简化都不得移动', () => {
    const path: Vec2[] = [
      { x: 0, y: 0 }, { x: 0.25, y: 0.001 }, { x: 0.5, y: 0 },
      { x: 0.75, y: 0.001 }, { x: 1, y: 0 },
    ];
    const simplified = simplifyPath(path, 0.01);
    expect(simplified[0]).toEqual({ x: 0, y: 0 });
    expect(simplified[simplified.length - 1]).toEqual({ x: 1, y: 0 });
    expect(simplified.length).toBeLessThan(path.length);
  });

  it('RDP 保留真实的转折点', () => {
    const path: Vec2[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }];
    expect(simplifyPath(path, 0.01)).toHaveLength(3);
  });

  it('RDP 不因点数过多而爆栈——一次拖拽可能产出数千个采样点', () => {
    const path: Vec2[] = Array.from({ length: 20000 }, (_, i) => ({ x: i / 19999, y: 0 }));
    const simplified = simplifyPath(path, 0.001);
    expect(simplified).toHaveLength(2);
  });

  it('点到线段距离在端点外侧取端点距，不取无限延长线距离', () => {
    const start: Vec2 = { x: 0, y: 0 };
    const end: Vec2 = { x: 1, y: 0 };
    expect(perpendicularDistance({ x: 2, y: 0 }, start, end)).toBeCloseTo(1, 10);
    expect(perpendicularDistance({ x: 0.5, y: 0.3 }, start, end)).toBeCloseTo(0.3, 10);
    expect(perpendicularDistance({ x: 0.5, y: 0 }, start, start)).toBeCloseTo(0.5, 10);
  });

  it('重采样保端点、给定点数、且等距', () => {
    const path: Vec2[] = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 1, y: 0 }];
    const resampled = resamplePath(path, 5);
    expect(resampled).toHaveLength(5);
    expect(resampled[0]).toEqual({ x: 0, y: 0 });
    expect(resampled[4]).toEqual({ x: 1, y: 0 });
    for (let i = 1; i < resampled.length; i++) {
      expect(distance(resampled[i - 1] as Vec2, resampled[i] as Vec2)).toBeCloseTo(0.25, 6);
    }
  });

  it('重采样对退化输入返回原路径而不抛异常——一条畸形边不该崩掉整局', () => {
    expect(resamplePath([{ x: 0, y: 0 }], 5)).toHaveLength(1);
    expect(resamplePath([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }], 5)).toHaveLength(2);
  });

  it('插入控制点插在最近的线段上', () => {
    const path: Vec2[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    expect(insertControlPoint(path, { x: 1.05, y: 0.5 })[2]).toEqual({ x: 1.05, y: 0.5 });
    expect(insertControlPoint(path, { x: 0.5, y: 0.05 })[1]).toEqual({ x: 0.5, y: 0.05 });
  });

  it('吸附只在半径内命中，且取最近的一个', () => {
    const candidates = [
      { id: 'near', at: { x: 0.1, y: 0.1 } },
      { id: 'far', at: { x: 0.9, y: 0.9 } },
    ];
    expect(findSnapTarget(candidates, { x: 0.11, y: 0.1 }, 0.05)?.id).toBe('near');
    expect(findSnapTarget(candidates, { x: 0.5, y: 0.5 }, 0.05)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 属性
// ---------------------------------------------------------------------------

const vec2 = fc.record({
  x: fc.double({ min: -0.5, max: 1.5, noNaN: true }),
  y: fc.double({ min: -0.5, max: 1.5, noNaN: true }),
});

describe('地图管线：属性', () => {
  it('坐标生成器确实能产出越界值——否则越界那条判据永远不被执行', () => {
    const sample = fc.sample(vec2, { numRuns: 400, seed: 20260808 });
    expect(sample.some((p) => p.x > 1 || p.y > 1 || p.x < 0 || p.y < 0)).toBe(true);
    expect(sample.some((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
  });

  it('坐标越界 ⟺ 报 MAP_COORD_OUT_OF_RANGE（双向，不只是单向）', () => {
    fc.assert(fc.property(vec2, (at) => {
      const findings = validateMapStructure(map({ nodes: [node('a', { at })] }));
      const reported = codesOf(findings).includes('MAP_COORD_OUT_OF_RANGE');
      const outOfRange = at.x < 0 || at.x > 1 || at.y < 0 || at.y > 1;
      return reported === outOfRange;
    }), { numRuns: 2000 });
  });

  it('RDP 简化后的点始终是原点集的子序列，且端点不变', () => {
    fc.assert(fc.property(
      fc.array(vec2, { minLength: 2, maxLength: 60 }),
      fc.double({ min: 0.0001, max: 0.3, noNaN: true }),
      (path, epsilon) => {
        const simplified = simplifyPath(path, epsilon);
        if (simplified.length > path.length) return false;
        if (simplified[0] !== path[0]) return false;
        if (simplified[simplified.length - 1] !== path[path.length - 1]) return false;
        // 子序列性：简化结果按原顺序出现在原数组中。
        let cursor = 0;
        for (const point of simplified) {
          const found = path.indexOf(point, cursor);
          if (found === -1) return false;
          cursor = found + 1;
        }
        return true;
      },
    ), { numRuns: 1500 });
  });

  it('简化永不增长路径长度（几何长度意义上）', () => {
    fc.assert(fc.property(
      fc.array(vec2, { minLength: 2, maxLength: 40 }),
      (path) => pathLength(simplifyPath(path, 0.05)) <= pathLength(path) + 1e-9,
    ), { numRuns: 1000 });
  });

  it('重采样保持端点，且点数恰为请求值', () => {
    fc.assert(fc.property(
      fc.array(vec2, { minLength: 2, maxLength: 30 }),
      fc.integer({ min: 2, max: 40 }),
      (path, count) => {
        if (pathLength(path) === 0) return true;
        const resampled = resamplePath(path, count);
        return resampled.length === count
          && resampled[0] === path[0]
          && resampled[resampled.length - 1] === path[path.length - 1];
      },
    ), { numRuns: 1000 });
  });

  it('编译成功 ⟺ 没有 error 级诊断', () => {
    // 这条曾靠一个 weight: -2..9 的生成器制造 error，weight 删掉后唯一的 error 来源是越界坐标。
    // 所以下面必须数一遍两侧都真的出现过——只跑出一侧的话这个 ⟺ 是重言式。
    let compiled = 0;
    let refused = 0;
    fc.assert(fc.property(
      fc.array(vec2, { minLength: 1, maxLength: 6 }),
      (ats) => {
        const nodes = ats.map((at, i) => node(`n${i}`, { at }));
        const edges = ats.slice(1).map((_, i) => edge(`e${i}`, `n${i}`, `n${i + 1}`));
        const data = map({ nodes, edges });
        const hasError = validateMapStructure(data).some((f) => f.severity === 'error');
        if (hasError) refused += 1; else compiled += 1;
        return compileMap(data).ok === !hasError;
      },
    ), { numRuns: 1500 });
    expect(compiled).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  it('节点 id 在编译后与 PrefabDef 的 key 集合完全一致', () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 8 }),
      (ids) => {
        const data = map({ nodes: ids.map((id) => node(id)) });
        const result = compileMap(data);
        if (!result.ok) return false;
        const keys = result.prefab.nodes.map((n) => n.key);
        return keys.length === ids.length && ids.every((id) => keys.includes(id));
      },
    ), { numRuns: 800 });
  });

  it('连通分量是原节点集的一个划分：不重不漏', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 10 }),
      fc.array(fc.tuple(fc.nat({ max: 9 }), fc.nat({ max: 9 })), { maxLength: 15 }),
      (count, pairs) => {
        const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`));
        const edges = pairs
          .filter(([a, b]) => a < count && b < count && a !== b)
          .map(([a, b], i) => edge(`e${i}`, `n${a}`, `n${b}`));
        const groups = connectedGroups(map({ nodes, edges }));
        const flat = groups.flat();
        return flat.length === count && new Set(flat).size === count;
      },
    ), { numRuns: 1000 });
  });
});
