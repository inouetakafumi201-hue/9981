/**
 * L2 Registry: 授权范围内深度不可变语义投影。
 *
 * 对应 Requirements 10.7–10.8、14.1–14.11 与 design.md `Read_Only_Semantic_Projection`、
 * `createProjection`、Property 11。
 *
 * 铁律：
 * - 投影只含授权认知（belief）与可见范围（visibility/entities）。
 * - 投影深度不可变；任何嵌套写入尝试都在统一运行时入口被拒绝。
 * - 投影不是活动对象的可写别名：所有内容都经深拷贝 + deepFreeze。
 */

import { deepClonePlain, deepFreeze } from '../model/immutable.js';
import { fingerprint } from '../model/ordering.js';
import { compareStrings } from '../model/ordering.js';
import type {
  AuthorizationScope,
  BeliefSlice,
  ReadOnlySemanticProjection,
  RuntimeSemanticState,
  SemanticStateEntry,
  VisibilityEntry,
} from '../model/projection.js';
import type { ReadOnlyResolvedDefinition } from '../model/definition.js';
import type { ActiveRegistry } from './definition-registry.js';

function projectEntities(
  state: RuntimeSemanticState,
  scope: AuthorizationScope,
): readonly SemanticStateEntry[] {
  const visible = new Set(scope.visibleEntityIds);
  const roleAllowed = new Set(scope.authorizedResourceRoles);
  return state.entities
    .filter((entry) => visible.has(entry.entityId))
    .map((entry) => ({
      entityId: entry.entityId,
      properties: entry.properties.filter((property) => {
        // 资源角色属性按授权资源角色裁剪；非资源属性保留。
        if (property.resourceRole === undefined) {
          return true;
        }
        return roleAllowed.has(property.resourceRole);
      }),
      statusIds: [...entry.statusIds].sort(compareStrings),
      ...(entry.definitionId === undefined ? {} : { definitionId: entry.definitionId }),
      ...(entry.locationNodeId === undefined ? {} : { locationNodeId: entry.locationNodeId }),
      ...(entry.posture === undefined ? {} : { posture: entry.posture }),
    }))
    .sort((left, right) => compareStrings(left.entityId, right.entityId));
}

function projectBeliefs(
  state: RuntimeSemanticState,
  scope: AuthorizationScope,
): readonly BeliefSlice[] {
  const authorized = new Set(scope.authorizedBeliefAgentIds);
  return state.beliefSlices
    .filter((slice) => authorized.has(slice.agentId))
    .map((slice) => ({
      agentId: slice.agentId,
      facts: [...slice.facts].sort((left, right) => compareStrings(left.factId, right.factId)),
    }))
    .sort((left, right) => compareStrings(left.agentId, right.agentId));
}

function projectVisibility(
  state: RuntimeSemanticState,
  scope: AuthorizationScope,
): readonly VisibilityEntry[] {
  const authorizedAgents = new Set([scope.agentId, ...scope.authorizedBeliefAgentIds].filter((id): id is string => id !== undefined));
  // 授权裁剪必须同时作用于"哪些条目可见"和"条目内部列出了什么"：
  // 只按 agent 过滤条目会把 scope 未授权的实体/节点标识透过 visibility 条目泄漏出去，
  // 违反 Requirements 10.7「投影只含授权的认知与可见信息」与 Property 11。
  const scopeEntityIds = new Set(scope.visibleEntityIds);
  const scopeNodeIds = new Set(scope.visibleNodeIds);
  return state.visibility
    .filter((entry) => authorizedAgents.has(entry.agentId))
    .map((entry) => ({
      agentId: entry.agentId,
      visibleEntityIds: [...entry.visibleEntityIds]
        .filter((entityId) => scopeEntityIds.has(entityId))
        .sort(compareStrings),
      visibleNodeIds: [...entry.visibleNodeIds]
        .filter((nodeId) => scopeNodeIds.has(nodeId))
        .sort(compareStrings),
    }))
    .sort((left, right) => compareStrings(left.agentId, right.agentId));
}

function projectDefinitions(
  active: ActiveRegistry,
  scope: AuthorizationScope,
): readonly ReadOnlyResolvedDefinition[] {
  const allowedFamilies = scope.authorizedDefinitionFamilies;
  const definitions = [...active.definitions.values()]
    .filter((definition) => allowedFamilies === undefined || allowedFamilies.includes(definition.semanticFamily))
    .sort((left, right) => compareStrings(left.id, right.id));
  return definitions;
}

/**
 * 从活动注册表与运行时语义状态构造只读投影。
 * 返回值深度冻结（含嵌套对象、数组、Map/Set）。
 */
export function createProjection(
  active: ActiveRegistry,
  state: RuntimeSemanticState,
  scope: AuthorizationScope,
): ReadOnlySemanticProjection {
  const entities = projectEntities(state, scope);
  const beliefSlices = projectBeliefs(state, scope);
  const visibility = projectVisibility(state, scope);
  const definitions = projectDefinitions(active, scope);

  // 深拷贝运行时状态部分（定义已在注册表内冻结，但仍拷贝以杜绝别名）。
  const projection: ReadOnlySemanticProjection = {
    scopeId: scope.scopeId,
    consumer: scope.consumer,
    turn: state.turn,
    definitions: deepClonePlain(definitions),
    entities: deepClonePlain(entities),
    beliefSlices: deepClonePlain(beliefSlices),
    visibility: deepClonePlain(visibility),
    semanticStateFingerprint: fingerprint({ turn: state.turn, entities: state.entities, beliefSlices: state.beliefSlices, visibility: state.visibility }),
  };
  return deepFreeze(projection) as ReadOnlySemanticProjection;
}
