/**
 * 校验 / 编译 / Playtest 接线（任务 6，Design Components 4，要求 5）。
 *
 * 开发板把工作区 MapData 经 ports 桶只读消费既有契约端口：
 * - 结构校验（每次改动即时，无 IO，诊断列表）
 * - 带索引保存校验（导出前）
 * - compileMap → PrefabDef（纯函数、确定性、丢几何）
 * - Playtest：PrefabDef 喂给既有 spawn/装载冒烟；mermaid 可视化思路
 * 开发板不实现这些，只接线（import 消费）。
 */
import {
  validateMapStructure,
  validateMapAgainstClasses,
  canPublish,
  compileMap,
  connectedGroups,
  adjacencyOf,
} from '../ports/map-contracts';
import type { MapDiagnostic, MapData, MapClassIndex, CompileResult } from '../ports/map-contracts';

/** 每次改动即时结构校验：诊断按 path 稳定排序、列表、无自动 correction。 */
export function structureDiagnostics(map: MapData): readonly MapDiagnostic[] {
  return validateMapStructure(map);
}

/** 保存/导出前带索引校验；返回 error 级诊断（若可发布则由 canPublish 判定）。 */
export function publishDiagnostics(map: MapData, index: MapClassIndex): { readonly findings: readonly MapDiagnostic[]; readonly isPublishable: boolean } {
  const findings = validateMapAgainstClasses(map, index);
  return { findings, isPublishable: canPublish(findings) };
}

/** compileMap → PrefabDef。几何（坐标/曲线/图层/高度/变换）在此丢弃。 */
export function compileIntoPrefab(map: MapData, prefabId?: string): CompileResult {
  return compileMap(map, prefabId);
}

/** 连通分量与邻接，供 Playtest / 可视化冒烟。 */
export function topologySummary(map: MapData): { readonly adjacency: ReadonlyMap<string, readonly string[]>; readonly groups: readonly (readonly string[])[] } {
  return { adjacency: adjacencyOf(map), groups: connectedGroups(map) };
}

/**
 * Playtest 冒烟：结构校验 → 编译成 PrefabDef → 连通性检查。
 * `compileMap` 内部已跑结构校验（error 会阻断产物）；此处再对结果做健康判定。
 */
export function playtestSmoke(map: MapData, index: MapClassIndex | undefined): { readonly ok: boolean; readonly reason?: string; readonly prefab?: CompileResult } {
  if (index) {
    const pub = publishDiagnostics(map, index);
    if (!pub.isPublishable) {
      return { ok: false, reason: '保存校验未通过，不可发布' };
    }
  }
  const compiled = compileMap(map);
  return { ok: compiled.ok, reason: compiled.ok ? undefined : '编译失败，结构校验未通过', prefab: compiled };
}
