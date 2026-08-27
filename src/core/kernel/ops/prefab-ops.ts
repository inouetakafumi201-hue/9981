/**
 * L3 Ops: prefab.spawn / prefab.despawn（design.md 3.2/3.4节 / 需求8.1-8.7, 16.6）。
 *
 * 缺失 Op 补齐（记录于 决策与风险记录.md）：design.md 3.4节 Op 全集清单与 tasks.md 第8步
 * 都把 prefab.spawn/despawn 列为公开 Op，此前实现只搭了 topology/prefab.ts 的纯函数 helper
 * （buildKeyToIdMap/remapLinks/resolveAttachToRoot），从未注册为真正可调用的 Op——
 * 意味着需求8.1-8.7（子图批量实例化与回收）此前完全没有端到端路径可测。这里补齐。
 */
import type { OpImpl, OpRegistry } from './registry';
import { ok, err } from './result';
import type { Id } from '../state/ids';
import { nextId } from '../state/ids';
import type { Def } from '../state/def';
import type { PrefabDef, PrefabHandle } from '../topology/prefab';
import { buildKeyToIdMap, remapLinks, resolveAttachToRoot } from '../topology/prefab';
import { createNodeShape, createLinkShape } from '../topology/types';
import { createEntityShape } from '../state/entity';
import { linksTouching, cascadeNodeDestroySet } from '../topology/graph';
import { checkInstantiable } from './def-guard';

export interface PrefabSpawnArgs {
  def: Id;
  attachTo?: Id; // 外部节点：预制结构 root 与之相连（需求8.3），覆盖 PrefabDef.attachTo 声明的 key 语义
}

export interface PrefabDespawnArgs {
  handle: PrefabHandle;
  /**
   * 疏散目标节点（需求8.5：占位者应被疏散至"有效位置"）。当回收的子图内存在非本次 spawn
   * 创建的占位者（如玩家走进了这个副本）时必须提供，且必须是不在本次回收范围内的已存在节点。
   *
   * 修正记录（决策与风险记录.md 记录7，用户复核指出"越级管理"问题）：早前实现在未提供疏散
   * 目标时，默认把占位者的 node 字段清空（"无位置状态"），这本身就是内核代内容作者做出的一项
   * 语义决定（"限定/虚空是一个可接受的落脚点"），而不是纯机械动作——且直接与需求8.5"疏散至
   * 有效位置"的字面表述矛盾（无位置显然不是"有效位置"）。这与 item.move 在找不到合法槎位时
   * 的既有纪律（需求10.10：不落地不吞掉，返回 ok:false）是同一类原则：找不到合法去处时，
   * 内核必须拒绝该 Op，不得替调用方决定一个"看起来安全"的默认去处。真正的疏散目标（最近安全点、
   * 重生点等）由玩法包的 before:prefab.despawn RuleDef 计算后通过本字段显式传入。
   */
  evacuateTo?: Id;
}

export interface PrefabOpsDeps {
  defLookup: (id: Id) => Def | null;
}

function makePrefabSpawn(deps: PrefabOpsDeps): OpImpl<PrefabSpawnArgs, PrefabHandle> {
  return (args, ctx) => {
    const prefabGuard = checkInstantiable(deps.defLookup, args.def, 'prefab');
    if (!prefabGuard.ok) return prefabGuard;
    const prefab = prefabGuard.value as PrefabDef;

    // 穷举校验（运行期严厉性缺口修补，见 决策与风险记录.md）：预制结构内部每个 node/entity 声明
    // 引用的 def 都必须独立通过 checkInstantiable——此前只校验了 PrefabDef 本身，预制结构内部
    // 各元素引用的 def（nodeSpec.def/entitySpec.def）完全没有被检查过，一个预制结构只要有一个
    // 节点引用了 abstract Def 或不存在的 Def，此前会在运行期静默创建出一个"没有对应 Def"的
    // 节点（createNodeShape 不检查 def 是否存在），直到某个后续依赖 Def.clamp/schema 的机制
    // 访问它时才可能出问题——这与本文档第8节"prop.set 对不存在宿主对象静默合成畸形状态"
    // 是同一类缺陷的另一种表现形式，预制结构展开必须在动手创建任何节点之前把全部引用检查完。
    for (const nodeSpec of prefab.nodes) {
      const guard = checkInstantiable(deps.defLookup, nodeSpec.def, 'node');
      if (!guard.ok) return guard;
    }
    for (const entitySpec of prefab.entities ?? []) {
      const guard = checkInstantiable(deps.defLookup, entitySpec.def, 'entity');
      if (!guard.ok) return guard;
    }
    for (const linkSpec of prefab.links) {
      const guard = checkInstantiable(deps.defLookup, linkSpec.def, 'link');
      if (!guard.ok) return guard;
    }

    const draft = ctx.tx.getDraft();
    if (args.attachTo !== undefined && !(args.attachTo in draft.nodes)) {
      return err('E_REF_MISSING', `attachTo 目标节点 ${args.attachTo} 不存在`);
    }

    // 需求8.2：预制结构内部 key -> 新分配 Id 的重映射（buildKeyToIdMap 已保证每个 key 分配唯一 Id）
    const keyToId = buildKeyToIdMap(prefab, () => nextId('n'));

    let nextNodes = { ...draft.nodes };
    for (const nodeSpec of prefab.nodes) {
      const id = keyToId.get(nodeSpec.key) as Id;
      // L-07 透传：parent 经 props 传入，prefab.spawn 传给 createNodeShape
      const parentStr = nodeSpec.props?.['parent'];
      const parent = typeof parentStr === 'string' ? (keyToId.get(parentStr) as Id | undefined) ?? parentStr as Id : undefined;
      nextNodes[id] = createNodeShape(id, nodeSpec.def, { parent });
    }

    let remappedLinks: { a: Id; b: Id; def: Id; directed?: boolean }[];
    try {
      remappedLinks = remapLinks(prefab, keyToId);
    } catch (e) {
      // remapLinks 对未声明的 key 引用抛异常（design.md 未要求这里是运行期防御路径，
      // 因为合法 PrefabDef 不应出现这种引用；装载期 Linter 才是真正的防线）——
      // 这里转成 Result 而不是让异常穿透 Op（需求16.2-16.3：Op 永不抛异常）。
      return err('E_LOAD_UNDEFINED_REF', e instanceof Error ? e.message : String(e));
    }

    let nextLinks = { ...draft.links };
    const linkIds: Id[] = [];
    for (const l of remappedLinks) {
      const linkId = nextId('l');
      linkIds.push(linkId);
      // L-07 透传：weight 经 PrefabDef.links[].weight 传入（若有）；direction 保持完整 token
      const linkSpec = prefab.links.find((pl) => pl.a === l.a && pl.b === l.b) ?? { weight: undefined, direction: undefined };
      nextLinks[linkId] = createLinkShape(linkId, l.a, l.b, {
        def: l.def,
        directed: l.directed,
        weight: (linkSpec as { weight?: number }).weight,
        direction: (linkSpec as { direction?: string }).direction,
      });
    }

    // 需求8.3：attachTo 接缝——预制结构 root 节点与外部指定节点相连
    const templateRoot = resolveAttachToRoot(prefab, keyToId);
    if (args.attachTo !== undefined && templateRoot !== null) {
      const seamLinkId = nextId('l');
      linkIds.push(seamLinkId);
      nextLinks[seamLinkId] = createLinkShape(seamLinkId, args.attachTo, templateRoot, { def: 'd:prefab-seam' });
    }

    // 需求8.1：批量创建实体（entities 字段声明的预制结构实体，overrides 的 Expr 求值留给完整
    // FlowInterpreter 接线场景使用，此处只处理静态 def，不对 overrides 做求值——
    // PrefabDef.entities[].overrides 是 Expr 而不是 Value，求值需要 EvalContext，
    // 这里的判断：Op 实现本身不持有 ExprEngine 依赖，overrides 求值留给调用方在
    // entities 声明之外通过后续 prop.set 完成，不在 spawn 内联求值）。
    let nextEntities = draft.entities;
    const entityIds: Id[] = [];
    for (const entitySpec of prefab.entities ?? []) {
      const hostNodeId = keyToId.get(entitySpec.at);
      if (hostNodeId === undefined) {
        return err('E_LOAD_UNDEFINED_REF', `prefab entity 引用了未声明的 key: ${entitySpec.at}`);
      }
      const entityId = nextId('e');
      entityIds.push(entityId);
      nextEntities = { ...nextEntities, [entityId]: { ...createEntityShape(entityId, entitySpec.def), node: hostNodeId } };
    }

    const rootId = templateRoot ?? (Array.from(keyToId.values())[0] as Id);
    const handle: PrefabHandle = { nodes: Array.from(keyToId.values()), links: linkIds, entities: entityIds, root: rootId };

    ctx.tx.setDraft({ ...draft, nodes: nextNodes, links: nextLinks, entities: nextEntities });
    ctx.tx.logOp('prefab.spawn', args, () => {});
    return ok(handle);
  };
}

/**
 * prefab.despawn：回收一次 spawn 创建的全部对象，回收前疏散占位者（需求8.4-8.5）。
 * 疏散纪律（决策与风险记录.md 记录7）：找不到合法疏散目标时拒绝整个 Op，不发明默认去处。
 */
const prefabDespawn: OpImpl<PrefabDespawnArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const { handle } = args;

  const nodeSet = new Set(handle.nodes);
  const strandedOccupants = Object.entries(draft.entities).filter(
    ([eid, e]) => e.node !== undefined && nodeSet.has(e.node) && !handle.entities.includes(eid),
  );

  if (strandedOccupants.length > 0) {
    // 需求8.5：存在非本次 spawn 创建的占位者（如玩家走进了这个副本），必须疏散至有效位置——
    // "有效"意味着：调用方显式提供了目标，且该目标不在本次即将回收的节点集合内（否则等于
    // 疏散到一个马上也会被销毁的地方，产生新的悬空引用）。
    if (args.evacuateTo === undefined) {
      return err('E_OP_NO_LEGAL_SLOT', `prefab.despawn: ${strandedOccupants.length} 个占位者需要疏散，但未提供 evacuateTo`);
    }
    if (!(args.evacuateTo in draft.nodes) || nodeSet.has(args.evacuateTo)) {
      return err('E_REF_MISSING', `prefab.despawn: evacuateTo ${args.evacuateTo} 不是有效的疏散目标`);
    }
  }

  let nextEntities = draft.entities;
  for (const [eid] of strandedOccupants) {
    const e = nextEntities[eid] as (typeof draft.entities)[string];
    nextEntities = { ...nextEntities, [eid]: { ...e, node: args.evacuateTo } };
  }

  // 销毁本次 spawn 创建的实体
  for (const eid of handle.entities) {
    const { [eid]: _removed, ...rest } = nextEntities;
    nextEntities = rest;
  }

  // 销毁 links（含 attachTo 接缝）
  let nextLinks = draft.links;
  for (const lid of handle.links) {
    const { [lid]: _removed, ...rest } = nextLinks;
    nextLinks = rest;
  }
  // 额外级联清理：任何仍然指向即将被销毁节点的残留 Link（如疏散未覆盖到的边）
  for (const nid of handle.nodes) {
    for (const lid of linksTouching(nextLinks, nid)) {
      const { [lid]: _l, ...rest } = nextLinks;
      nextLinks = rest;
    }
  }

  // 销毁 nodes（含级联子节点，覆盖微型场景在 prefab 内部嵌套的情形）
  let nextNodes = draft.nodes;
  const allToDestroy = new Set<Id>();
  for (const nid of handle.nodes) {
    for (const cascaded of cascadeNodeDestroySet(nextNodes, nid)) allToDestroy.add(cascaded);
  }
  // 注：despawn 是显式回收指令，不依赖占用者数量判定是否卸载（这与 entity.place 场景下
  // 微型场景"占用者归零才卸载"的隐式生命周期不同）——占用者数量只影响是否需要疏散，已在上方处理。
  for (const nid of allToDestroy) {
    const { [nid]: _n, ...rest } = nextNodes;
    nextNodes = rest;
  }

  ctx.tx.setDraft({ ...draft, nodes: nextNodes, links: nextLinks, entities: nextEntities });
  ctx.tx.logOp('prefab.despawn', args, () => {});
  return ok(undefined);
};

export function registerPrefabOps(registry: OpRegistry, deps: PrefabOpsDeps): void {
  registry.register('prefab.spawn', makePrefabSpawn(deps), { structural: true });
  registry.register('prefab.despawn', prefabDespawn, { structural: true });
}
