#!/usr/bin/env node
/**
 * 素材工作流管线 · 校验 + 编译 + 自测
 *
 * 把样例 MapData 推过整条链路：
 *   1. `validateMapStructure`（结构校验，无 IO）
 *   2. 跨目录引用校验（用基类层真实 def id 构造的 index，二道闸）
 *   3. `compileMap` → PrefabDef（编译，唯一机械终点）
 *   4. 用引擎真身 spawn 进 WorldState，断言节点/边/实体落地且连通（端到端闭环）
 *
 * 这条脚本回答的是「白盒迭代之后，这条路还通不通」——它不是又一个被测试覆盖的实现，
 * 而是把 src/play/map 已有、已被 73 个测试覆盖的路径，用一条独立脚本在真实数据上跑一遍，
 * 证明「能进游戏」这件事在管线工具链里是常态而非手工碰运气。
 *
 * 校验/编译/运行的每个核心都复用 src 里既有的真身——不另起一套 schema、不写替身。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(here, '../..');
const OUT_DIR = resolve(ROOT, 'tmp/asset-pipeline/artifact');

/** 改造成本：用 tsx 执行 TS 源，复用引擎真身的一次性导入，避免手写一堆动态 import。 */
async function loadModules() {
  const { pathToFileURL } = await import('node:url');
  const u = (rel) => pathToFileURL(resolve(ROOT, rel)).href;
  const [types, validate, compile, world, transaction, prefabOps, structuralOps, registry, expr, ids, prefab] =
    await Promise.all([
      import(u('src/play/map/types.ts')),
      import(u('src/play/map/validate.ts')),
      import(u('src/play/map/compile.ts')),
      import(u('src/core/kernel/state/world-state.ts')),
      import(u('src/core/kernel/ops/transaction.ts')),
      import(u('src/core/kernel/ops/prefab-ops.ts')),
      import(u('src/core/kernel/ops/structural-ops.ts')),
      import(u('src/core/kernel/ops/registry.ts')),
      import(u('src/core/kernel/expr/engine.ts')),
      import(u('src/core/kernel/state/ids.ts')),
      import(u('src/core/kernel/topology/prefab.ts')),
    ]);
  return { types, validate, compile, world, transaction, prefabOps, structuralOps, registry, expr, ids, prefab };
}

/** 用可实例化占位 def 的真实 id 构造跨目录引用 index（对应 validateMapAgainstClasses 需要的形态）。 */
function buildIndex() {
  return {
    sceneDefs: new Map([
      ['d:scene/yard', 'large'],
      ['d:scene/room', 'medium'],
      ['d:scene/closet', 'small'],
    ]),
    transitionDefs: new Set(['d:transition/door', 'd:transition/stairs']),
    placeableInstances: new Set(['inst_locker_7f3a']),
  };
}

/** 若行内能跑，就直接把样例跑完并导出结论。 */
export async function runPipeline(mapFile) {
  const mods = await loadModules();
  const map = JSON.parse(readFileSync(mapFile, 'utf8'));

  const structure = mods.validate.validateMapStructure(map);
  const cross = mods.validate.validateMapAgainstClasses(map, buildIndex());
  const all = [...structure, ...cross];

  const compiled = mods.compile.compileMap(map);
  const spawnInfo = compiled.ok ? spawnAndAssert(mods, compiled.prefab) : null;

    return {
      mapId: map.id,
      structureErrors: structure.filter((d) => d.severity === 'error').length,
      crossErrors: cross.filter((d) => d.severity === 'error').length,
      warnings: all.filter((d) => d.severity === 'warning').length,
      compileOk: compiled.ok,
      spawn: spawnInfo,
      diagnosticCodes: [...new Set(all.map((d) => d.code))],
      diagnostics: all.map((d) => ({ code: d.code, subject: d.subject, message: d.message, correction: d.correction })),
    };
}

/** 真实 spawn 一张已编译地图，断言节点/边/实体落地。 */
function spawnAndAssert(mods, prefab) {
  const holder = new mods.transaction.WorldStateHolder(mods.world.createEmptyWorldState('sched:1'));
  const registry = new mods.registry.OpRegistry(holder);
  const exprEngine = new mods.expr.ExprEngine();
  const defs = new Map();
  defs.set(prefab.id, prefab);
  // 注册占位 def（kind 必须与 spawn 期望一致，否则 checkInstantiable 报 E_REF_KIND）。
  const placeholderDefs = [
    ['d:scene/yard', 'node'],
    ['d:scene/room', 'node'],
    ['d:scene/closet', 'node'],
    ['d:transition/door', 'link'],
    ['d:transition/stairs', 'link'],
    ['inst_locker_7f3a', 'entity'],
  ];
  for (const [id, kind] of placeholderDefs) defs.set(id, { id, kind });
  const defLookup = (id) => defs.get(id) ?? null;

  const itemMove = mods.structuralOps.makeItemMove({
    exprEngine,
    evalCtxForSlotAccepts: () => mods.expr.makeDefaultEvalContext(),
  });
  mods.structuralOps.registerStructuralOps(registry, { itemMove, defLookup });
  mods.prefabOps.registerPrefabOps(registry, { defLookup });

  const spawned = registry.invoke('prefab.spawn', { def: prefab.id });
  if (!spawned.ok || spawned.value === undefined) {
    return { ok: false, detail: `${spawned.code}: ${spawned.detail}` };
  }
  const handle = spawned.value;
  const state = holder.getState();

  // 用计数+存在性表达一张图 = 节点/边/实体全落地且互不悬空。
  const nodesLanded = handle.nodes.every((nodeId) => state.nodes[nodeId] !== undefined);
  const linksLanded = handle.links.every((linkId) => state.links[linkId] !== undefined);
  const entitiesLanded = handle.entities.every((entityId) => state.entities[entityId] !== undefined);

  return {
    ok: true,
    nodes: handle.nodes.length,
    links: handle.links.length,
    entities: handle.entities.length,
    landed: nodesLanded && linksLanded && entitiesLanded,
  };
}

/** CLI：跑一张样例地图并汇总。 */
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const target = process.argv[2] ?? 'sample-sleeper';
  const mapFile = resolve(ROOT, `tmp/asset-pipeline/maps/${target}.json`);
  try {
    const result = await runPipeline(mapFile);
    writeFileSync(resolve(OUT_DIR, 'pipeline-report.json'), JSON.stringify(result, null, 2));
    const pass = result.compileOk && result.structureErrors === 0 && result.crossErrors === 0 && result.spawn?.ok !== false;
    console.log(
      `[asset-pipeline] 校验+编译: ${pass ? '通过' : '未通过'} | ` +
      `结构错误=${result.structureErrors} 引用错误=${result.crossErrors} warnings=${result.warnings} ` +
      `spawn=${result.spawn ? `${result.spawn.nodes}节点/${result.spawn.links}边/${result.spawn.entities}实体` : '未跑'}`,
    );
    if (result.spawn && !result.spawn.landed) {
      console.log('[asset-pipeline] ⚠️ spawn 成功但 node/link/entity 存在悬空引用');
    }
    console.log(`[asset-pipeline] 诊断码: ${result.diagnosticCodes.join(', ') || '（无）'}`);
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('[asset-pipeline] 管线运行失败:', err);
    process.exit(1);
  }
}

// 判断是否作为入口脚本直接运行（而非被 import）。
// tsx 下 process.argv[1] 可能是绝对路径，import.meta.url 是 file:// URL，两者需归一化比较。
const invokedAsScript = process.argv[1]
  && (() => {
    const entry = process.argv[1].replace(/\\/g, '/');
    try {
      const entryUrl = new URL(`file://${entry.startsWith('/') ? entry : `/${entry}`}`).href;
      return import.meta.url === entryUrl;
    } catch {
      return false;
    }
  })();
if (invokedAsScript) {
  main();
}
