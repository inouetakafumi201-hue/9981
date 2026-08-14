#!/usr/bin/env node
/**
 * 素材工作流管线 · 样例地图生成器
 *
 * 开发期工具（不进产品区）：产出一份合法的 `MapData` 样例，作为「脚本生成 → 校验 → 编译 →
 * 自测」整条链路的输入。
 *
 * 为什么要程序化生成而不是手写：
 * - 它是「编辑器可选、数据契约必需」这条判据的可执行演示——脚本能产 JSON，LLM 能产 JSON，
 *   编辑器只是更舒服的输入方式，契约才是主权载体。
 * - 生成器刻意保持无 IO 纯函数 + 确定性（固定随机种子），这样才能在 CI 里被高频调用并断言
 *   字节可重放。
 *
 * 产出位置在 `tmp/asset-pipeline/`，明确不在 `src/**` 产品区内（呼应 D-075：地图是玩法层数据、
 * 样例归开发期验证，不污染 src）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const OUT_DIR = resolve(ROOT, 'tmp/asset-pipeline/maps');

/** 归一化坐标：两轴 [0,1]、有限值，落在 validateMapStructure 的 COORD 范围内。 */
export function v(x, y) {
  return { x, y };
}

/**
 * 一份绕开 Expr 判别键的放置覆写：value 是字面量，键名不撞
 * path/op/call/q/var（见 EXPR_DISCRIMINANT_KEYS，撞上会被 MAP_OVERRIDE_KEY_SHADOWS_EXPR 拦）。
 */
export function placement(id, at, def, overrides = {}) {
  return { id, at, def, ...(Object.keys(overrides).length ? { overrides } : {}) };
}

/** 稳定伪随机，保证确定性可重放（CI 断言字节相同需要）。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 生成一张「卧铺车厢」风格的连通地图：
 * - 一个大场景（车厢），下挂多个中/小场景（铺区 / 过道 / 洗手间）。
 * - 过渡连接覆盖 bidirectional 与 one-way-down/up 四值方向 token（D-074 数据面，linkSpecOf
 *   已保留完整 directionality 而非压成布尔 directed）。
 * - 放置若干仓库实例（这里用占位 def，跨目录校验那层在样品中用同一 index 满足）。
 * - 部分边带 visualObstruction / physicalObstruction / transitionWindow / semanticAnchor
 *   （MapData 新数据面字段，Property 7）。
 *
 * @param {string} mapId 地图 id（玩家命名 + 随机尾数风格）
 * @param {number} [coordJitter] 可选：给坐标加微扰，用于演示「同一拓扑不同几何」。
 */
export function generateSampleMap(mapId = 'wushi_sleeper_7f3a', coordJitter = 0) {
  const rng = mulberry32(0xc0ffee); // 固定种子 → 可重放
  const j = () => (coordJitter ? (rng() - 0.5) * coordJitter : 0);

  const nodes = [
    // 用可直接实例化的占位 def（与 map-spawn-e2e 一致），而非基类层 abstract 的 scene.class.*——
    // 基类层场景类全体 abstract（scene.class.large/medium/small 都不可直接 spawn），
    // 真实地图装载经由玩法层具体化；管线自测关心的是「结构合法 + 能 spawn」，用占位 def 即可。
    { id: 'carriage', def: 'd:scene/yard', scale: 'large', at: v(0.5 + j(), 0.5 + j()), floor: 0, name: '卧铺车厢' },
    { id: 'bunk_a', def: 'd:scene/room', scale: 'medium', at: v(0.2 + j(), 0.25 + j()), floor: 0, name: '铺区 A', parent: 'carriage' },
    { id: 'bunk_b', def: 'd:scene/room', scale: 'medium', at: v(0.8 + j(), 0.25 + j()), floor: 0, name: '铺区 B', parent: 'carriage' },
    // 大场景只能直接含 medium（ADMITTED_CHILD_SCALES.large = ['medium']）；medium 只能直接含
    // small（ADMITTED_CHILD_SCALES.medium = ['small']）。scale 必须与 def 在 index 里声明的尺度
    // 一致（MAP_SCALE_MISMATCH）：`d:scene/room`=medium、`d:scene/closet`=small。
    { id: 'corridor', def: 'd:scene/closet', scale: 'small', at: v(0.5 + j(), 0.72 + j()), floor: 0, name: '过道', parent: 'bunk_a' },
    { id: 'lavatory', def: 'd:scene/closet', scale: 'small', at: v(0.35 + j(), 0.78 + j()), floor: 0, name: '洗手间', parent: 'bunk_b' },
  ];

  // 曲线首尾必须贴合端点节点坐标（SNAP_TOLERANCE=0.005），否则 MAP_PATH_ENDPOINT_NOT_SNAPPED。
  const pA = v(0.2, 0.25); // bunk_a
  const pB = v(0.8, 0.25); // bunk_b
  const pCorridor = v(0.5, 0.72); // corridor
  const pCarriage = v(0.5, 0.5); // carriage
  const pLav = v(0.35, 0.78); // lavatory

  const edges = [
    {
      id: 'gate_a',
      def: 'd:transition/door',
      a: 'carriage', b: 'bunk_a',
      directionality: 'bidirectional',
      path: [pCarriage, v(0.35, 0.4), v(0.28, 0.33), pA],
      physicalObstruction: { shape: 'box', height: 1 },
    },
    {
      id: 'gate_b',
      def: 'd:transition/door',
      a: 'carriage', b: 'bunk_b',
      directionality: 'bidirectional',
      path: [pCarriage, v(0.65, 0.4), v(0.72, 0.33), pB],
    },
    {
      id: 'step_down',
      def: 'd:transition/door',
      a: 'corridor', b: 'carriage',
      directionality: 'one-way-down', // 高→低：从过道下到主车厢
      path: [pCorridor, v(0.52, 0.6), pCarriage],
      visualObstruction: { shape: 'circle', height: 2 },
    },
    {
      id: 'climb',
      def: 'd:transition/stairs',
      a: 'carriage', b: 'lavatory',
      directionality: 'one-way-up', // 低→高：进入洗手间，需消耗代价（L2/03 攀爬语义）
      path: [pCarriage, v(0.45, 0.62), pLav],
      semanticAnchor: 'low', // 洼地：表现层阶梯式轻微缩小，保留逻辑锚点
    },
  ];

  return {
    schemaVersion: '1.0',
    id: mapId,
    name: '卧铺车厢',
    backdrop: {
      image: 'tmp/asset-pipeline/sleeper.svg',
      pixelWidth: 1920,
      pixelHeight: 1080,
      tileRows: 1,
      tileCols: 1,
    },
    floors: [0],
    nodes,
    edges,
    // 只放仓库已有完整实例体（D-075）；这里用占位 def，用样品 index 满足跨目录校验。
    placements: [
      placement('locker_a', 'bunk_a', 'inst_locker_7f3a'),
      placement('cabinet_b', 'bunk_b', 'inst_locker_7f3a'),
    ],
    // 标记这是开发期样例，供工具消费方（map-to-mermaid、自测脚本）辨认，不属于 MapData 契约字段。
    _pipeline: { generated: true, targetOwnership: 'sample' },
  };
}

/** 直接命令行跑：写一份样例到 tmp/asset-pipeline/maps/。 */
function main() {
  const targetArg = process.argv[2];
  const outFile = resolve(OUT_DIR, `${targetArg ?? 'sample-sleeper'}.json`);
  mkdirSync(dirname(outFile), { recursive: true });
  const map = generateSampleMap();
  // 稳定 JSON 序列化（固定键序）→ CI 里可逐字节断言可重放。
  writeFileSync(outFile, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`[asset-pipeline] 样例地图已生成: ${outFile}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
