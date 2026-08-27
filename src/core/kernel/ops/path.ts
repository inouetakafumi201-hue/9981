/**
 * L3 Ops: 全局路径寻址（design.md 需求1.5-1.7 / 3.12节 knowledge 写入示例）。
 *
 * 内核把每一处状态关联到唯一路径（需求1.5），路径是从 WorldState 根出发的点分字符串，
 * 如 `entities.e:1.props.hp`、`world.props.someGlobal`、`knowledge.a:1.facts.foo`。
 * prop.set/prop.del/prop.add 等属性类 Op 是这套寻址机制的唯一写入口——但它们不能变成绕过
 * "props 之外为结构区，只能通过 Op 修改"（需求1.7）这条边界的后门：因此这里的
 * assertWritablePath 强制要求路径必须落在允许自由写入的区域（各集合的 .props 子树，
 * Node/Link 的 .props，world.props，以及 knowledge.*.facts / knowledge.*.seen），
 * 任何指向结构区字段（如 entities.e:1.node、items.i:1.stack）的路径都被拒绝。
 */
import type { WorldState } from '../state/world-state';
import type { Value } from '../state/value';

const WRITABLE_PATH_PATTERNS: RegExp[] = [
  /^world\.props(\..+)?$/,
  /^entities\.[^.]+\.props(\..+)?$/,
  /^items\.[^.]+\.props(\..+)?$/,
  /^nodes\.[^.]+\.props(\..+)?$/,
  /^links\.[^.]+\.props(\..+)?$/,
  /^containers\.[^.]+\.props(\..+)?$/,
  /^world\.knowledge\.[^.]+\.(facts|seen)(\..+)?$/,
  /^knowledge\.[^.]+\.(facts|seen)(\..+)?$/,
  /^world\.attachments\.[^.]+\.props(\..+)?$/,
  /^world\.agents\.[^.]+\.props(\..+)?$/,
];

export function isWritablePropsPath(path: string): boolean {
  return WRITABLE_PATH_PATTERNS.some((re) => re.test(path));
}

/** 只读路径求值：越界或不存在时返回 null（需求12.3），供 ExprEngine.resolvePath 与诊断读路径使用。 */
export function getPath(state: WorldState, path: string): Value | null {
  const parts = path.split('.');
  let cur: unknown = state;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return (cur ?? null) as Value | null;
}

/** 不可变写入：返回新的 WorldState，原状态不变。path 必须先通过 isWritablePropsPath 校验。 */
export function setPath(state: WorldState, path: string, value: Value): WorldState {
  const parts = path.split('.');
  return setPathRecursive(state, parts, value) as WorldState;
}

function setPathRecursive(node: unknown, parts: string[], value: Value): unknown {
  if (parts.length === 0) return value;
  const [head, ...rest] = parts as [string, ...string[]];
  const container = (node ?? {}) as Record<string, unknown>;
  const child = container[head];
  const newChild = setPathRecursive(child, rest, value);
  return { ...container, [head]: newChild };
}

/** 不可变删除：把 path 指向的键从其父对象中移除。 */
export function deletePath(state: WorldState, path: string): WorldState {
  const parts = path.split('.');
  return deletePathRecursive(state, parts) as WorldState;
}

function deletePathRecursive(node: unknown, parts: string[]): unknown {
  if (node === null || typeof node !== 'object') return node;
  const container = node as Record<string, unknown>;
  if (parts.length === 1) {
    const { [parts[0] as string]: _removed, ...rest } = container;
    return rest;
  }
  const [head, ...restParts] = parts as [string, ...string[]];
  if (!(head in container)) return node;
  const child = container[head];
  const newChild = deletePathRecursive(child, restParts);
  return { ...container, [head]: newChild };
}
