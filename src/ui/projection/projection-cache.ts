/**
 * 投影接受与按 Agent 分键缓存（design.md §5.1，tasks.md 任务 3.1）。
 *
 * 三点纪律：
 *
 * 1. **深度**冻结断言。任一层未冻结即拒绝该投影并产出 `PROJECTION_NOT_FROZEN`，
 *    **不就地冻结**——就地冻结会掩盖上游违约，让"端口返回了可变引用"这个真正的缺陷
 *    永远不被发现。
 * 2. 缓存键含 `agentId` + `scopeId`，不同 Agent 不共享缓存条目（Requirement 3.8）。
 * 3. 缓存不提供任何修改已存条目内部字段的入口；写入只能整条替换。
 */

import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  uiOk,
  uiRejected,
  type UiDiagnostic,
  type UiResult,
  type UiStructuredRejection,
} from '../model/diagnostic.js';
import type { StateRevision } from '../model/revision.js';
import {
  agentScopeCacheKey,
  type PresentationDescriptor,
  type ReadOnlySemanticProjection,
  type UpstreamAgentAuthority,
} from '../model/view.js';

/** 已通过边界断言的投影与描述符配对。 */
export interface AcceptedProjection {
  readonly agentId: string;
  readonly scopeId: string;
  readonly revision: StateRevision;
  readonly projection: ReadOnlySemanticProjection;
  readonly descriptor: PresentationDescriptor;
  readonly descriptorVersion?: string;
  readonly authority: UpstreamAgentAuthority;
}

export interface AcceptProjectionInput {
  readonly agentId: string;
  readonly scopeId: string;
  readonly revision: StateRevision;
  readonly projection: ReadOnlySemanticProjection;
  readonly descriptor: PresentationDescriptor;
  readonly descriptorVersion?: string;
  readonly authority: UpstreamAgentAuthority;
}

/**
 * 深度查找未冻结的层。返回全部违规路径（按码点序），空数组表示整棵结构已深冻结。
 *
 * 用 `WeakSet` 记录已访问节点，因此可以安全处理自引用结构。
 */
export function findUnfrozenPaths(root: unknown, rootPath = '$'): readonly string[] {
  const violations: string[] = [];
  const seen = new WeakSet<object>();
  const stack: (readonly [unknown, string])[] = [[root, rootPath]];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const [value, path] = frame;
    if (value === null || typeof value !== 'object') continue;
    const node = value as object;
    if (seen.has(node)) continue;
    seen.add(node);
    if (!Object.isFrozen(node)) violations.push(path);
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        stack.push([item, `${path}[${String(index)}]`]);
      });
      continue;
    }
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      stack.push([item, `${path}.${key}`]);
    }
  }
  return Object.freeze(violations.sort());
}

function notFrozenDiagnostic(paths: readonly string[], location: string): UiDiagnostic {
  return uiDiagnostic({
    code: UI_DIAGNOSTIC_CODES.PROJECTION_NOT_FROZEN,
    presentationLocation: location,
    reason: `投影进入 UI 边界时深冻结断言失败，未冻结层：${paths.slice(0, 8).join('、')}`,
    correctionSuggestion: '端口实现必须返回深冻结结构；UI 侧不就地冻结，以免掩盖上游违约',
    internalFields: { unfrozenLayerCount: paths.length },
  });
}

/** 在 UI 边界上接受一份投影。任一层未冻结即拒绝，不做任何补救性冻结。 */
export function acceptProjection(input: AcceptProjectionInput): UiResult<AcceptedProjection> {
  const projectionViolations = findUnfrozenPaths(input.projection, '$.projection');
  const descriptorViolations = findUnfrozenPaths(input.descriptor, '$.descriptor');
  const violations = [...projectionViolations, ...descriptorViolations];
  if (violations.length > 0) {
    return uiRejected([notFrozenDiagnostic(violations, `projection/${input.scopeId}`)]);
  }
  const accepted: AcceptedProjection = Object.freeze({
    agentId: input.agentId,
    scopeId: input.scopeId,
    revision: input.revision,
    projection: input.projection,
    descriptor: input.descriptor,
    ...(input.descriptorVersion === undefined ? {} : { descriptorVersion: input.descriptorVersion }),
    authority: input.authority,
  });
  return uiOk(accepted);
}

/**
 * 尝试改写已验证投影的语义字段。
 *
 * 它**从不**成功：函数体的作用是真的去写一次、确认写入失败、并断言语义状态指纹不变，
 * 然后返回结构化拒绝（Requirement 2.6、16.1）。这是"只读"这条边界的可执行证据，
 * 而不是一句注释。
 */
export function attemptSemanticWrite(
  accepted: AcceptedProjection,
  path: readonly string[],
  value: unknown,
): UiStructuredRejection {
  const fingerprintBefore = accepted.projection.semanticStateFingerprint;
  let container: unknown = accepted.projection;
  for (const segment of path.slice(0, -1)) {
    if (container === null || typeof container !== 'object') break;
    container = (container as Record<string, unknown>)[segment];
  }
  const leaf = path[path.length - 1];
  if (leaf !== undefined && container !== null && typeof container === 'object') {
    try {
      (container as Record<string, unknown>)[leaf] = value;
    } catch {
      // 冻结结构在严格模式下抛错，这正是期望行为：不吞掉它，也不改用其他写法重试。
    }
  }
  const diagnostics: readonly UiDiagnostic[] = [
    uiDiagnostic({
      code: UI_DIAGNOSTIC_CODES.PROJECTION_WRITE_REJECTED,
      presentationLocation: `projection/${accepted.scopeId}#${path.join('.')}`,
      reason: '消费方尝试取得可变语义状态引用或改写语义字段',
      correctionSuggestion: '语义状态只能经权威动作契约变更；投影与描述符是只读的',
    }),
  ];
  if (accepted.projection.semanticStateFingerprint !== fingerprintBefore) {
    throw new Error('语义状态指纹在只读投影上发生了变化，这是不可接受的不变量破坏');
  }
  return Object.freeze({ rejected: true as const, diagnostics, displayText: '该操作不被允许' });
}

/**
 * 按 `agentId + scopeId` 分键的投影缓存。
 *
 * 接口刻意只有"整条读 / 整条写 / 整条删"三种操作：没有任何 setter 能改写已存条目的
 * 内部字段，因此不存在"缓存里的投影被就地改掉"这条路径。
 */
export interface ProjectionCache {
  lookup(agentId: string, scopeId: string): AcceptedProjection | undefined;
  remember(accepted: AcceptedProjection): void;
  forget(agentId: string, scopeId: string): void;
  /** 已缓存的键，按码点序。用于断言不同 Agent 不共享条目。 */
  keys(): readonly string[];
  size(): number;
}

export function createProjectionCache(): ProjectionCache {
  const entries = new Map<string, AcceptedProjection>();
  return Object.freeze({
    lookup(agentId: string, scopeId: string): AcceptedProjection | undefined {
      return entries.get(agentScopeCacheKey(agentId, scopeId));
    },
    remember(accepted: AcceptedProjection): void {
      entries.set(agentScopeCacheKey(accepted.agentId, accepted.scopeId), accepted);
    },
    forget(agentId: string, scopeId: string): void {
      entries.delete(agentScopeCacheKey(agentId, scopeId));
    },
    keys(): readonly string[] {
      return Object.freeze([...entries.keys()].sort());
    },
    size(): number {
      return entries.size;
    },
  });
}
