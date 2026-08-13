/**
 * L2 Registry: Space-Items 投影引擎集成。
 *
 * 对应 Task 7 目标：将 space-items 规则与 L2 投影引擎集成。
 *
 * 将经过验证的 space-items 定义投影为只读运行时视图，供 AI、UI、UGC 消费。
 *
 * References:
 * - read-only-projection.ts 的投影框架
 * - space-items 的验证规则输出
 */

import type { CandidateDefinition } from '../model/definition.js';

/**
 * 空间与物品的投影条目。
 * 独立定义，不继承 SemanticStateEntry（后者用于 L1 运行时状态）。
 */
export interface SpaceItemsProjectionEntry {
  readonly entityId: string;
  readonly kind: 'container' | 'scene' | 'vehicle' | 'shield' | 'item';
  readonly properties: readonly (readonly [key: string, value: unknown])[];
}

/**
 * 空间与物品的投影视图。
 * 独立定义，用于领域级只读访问。
 */
export interface SpaceItemsProjection {
  readonly entries: readonly SpaceItemsProjectionEntry[];
  readonly relationships: readonly {
    readonly source: string;
    readonly target: string;
    readonly kind: 'contains' | 'hosts' | 'embeds' | 'references';
  }[];
}

/**
 * 将 space-items 定义投影为运行时视图。
 */
export function projectSpaceItemsDefinition(definition: CandidateDefinition): SpaceItemsProjectionEntry {
  const def = definition as unknown as Record<string, unknown>;
  const properties: Array<readonly [key: string, value: unknown]> = [];

  // 提取所有公开属性（不以下划线开头，非私有字段）
  for (const [key, value] of Object.entries(def)) {
    if (!key.startsWith('_')) {
      properties.push([key, value] as const);
    }
  }

  // 推导 kind
  let kind: 'container' | 'scene' | 'vehicle' | 'shield' | 'item' = 'item';
  if (def.kind === 'container' || def.containerRole) {
    kind = 'container';
  } else if (def.kind === 'scene' || def.scale) {
    kind = 'scene';
  } else if (def.kind === 'vehicle' || def.seatIds) {
    kind = 'vehicle';
  } else if (def.kind === 'shield' || def.blockingActionRef) {
    kind = 'shield';
  }

  return {
    entityId: definition.id,
    kind,
    properties: Object.freeze(properties),
  };
}

/**
 * 投影多个 space-items 定义为完整的空间与物品投影视图。
 */
export function projectSpaceItemsDefinitions(
  definitions: readonly CandidateDefinition[],
): SpaceItemsProjection {
  const entries: SpaceItemsProjectionEntry[] = [];
  const relationships: Array<{
    readonly source: string;
    readonly target: string;
    readonly kind: 'contains' | 'hosts' | 'embeds' | 'references';
  }> = [];

  for (const definition of definitions) {
    entries.push(projectSpaceItemsDefinition(definition));

    // 提取关系
    const def = definition as unknown as Record<string, unknown>;

    // 容器包含关系
    if (Array.isArray(def.containerIds)) {
      for (const containerId of def.containerIds) {
        if (typeof containerId === 'string') {
          relationships.push({
            source: definition.id,
            target: containerId,
            kind: 'contains',
          });
        }
      }
    }

    // 微型场景嵌入关系
    if (def.parentSceneRef && typeof def.parentSceneRef === 'object') {
      const ref = def.parentSceneRef as Record<string, unknown>;
      if (typeof ref.refId === 'string') {
        relationships.push({
          source: definition.id,
          target: ref.refId,
          kind: 'embeds',
        });
      }
    }

    // 载具托管关系
    if (Array.isArray(def.cargoContainerIds)) {
      for (const cargoId of def.cargoContainerIds) {
        if (typeof cargoId === 'string') {
          relationships.push({
            source: definition.id,
            target: cargoId,
            kind: 'hosts',
          });
        }
      }
    }
  }

  return {
    entries: Object.freeze(entries),
    relationships: Object.freeze(relationships),
  };
}

/**
 * 从投影条目查询特定属性。
 */
export function queryProjectionProperty(
  entry: SpaceItemsProjectionEntry,
  propertyName: string,
): unknown {
  for (const [key, value] of entry.properties) {
    if (key === propertyName) {
      return value;
    }
  }
  return undefined;
}
