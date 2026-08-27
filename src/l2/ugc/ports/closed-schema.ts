/**
 * L2 → wakeup-ugc 端口：封闭 Schema 检查（`closed-schema` / `open-property-map` 能力）。
 *
 * ## 问题
 * l2 的解码器按字段名读取自己认识的成员，**忽略**不认识的成员。因此
 * `{"packageId":"p","typo":1}` 会被静默接受，而 wakeup-ugc 的 `closed-schema` 能力要求
 * 「未声明字段被拒绝」。
 *
 * ## 为什么不用「每种形状一张成员白名单」
 * 候选文档有几十种嵌套形状（包、定义、族契约的十余个 contractKind、参数 Schema、组合组件……，
 * 见 `src/l2/codec/family-decoder.ts` 一千余行）。手写白名单等于把「哪些成员是已声明的」
 * 这件事在解码器之外**复制一份**，两份必然漂移——正是《架构决策原则》§2 的职责重复反模式。
 *
 * ## 采用的做法：从解码器实际行为反推
 * 把从 JSON 物化出来的对象树用 `Proxy` 包一层，记录解码器**探测过**哪些成员名，然后跑一遍
 * l2 自己的 `decodePackage`。事后比对：某个对象实际拥有的成员减去被探测过的成员，就是解码器
 * 完全没看过的成员，即未声明字段。这份「已声明成员集合」始终由解码器自身定义，不会漂移。
 *
 * ## 消除误报的规则（误报比漏报危险得多：它会拒绝合法候选）
 * 1. **解码出现任何 Error 时不报未声明字段。** 形状已经坏了，解码器会中止子树，
 *    未被读到的兄弟成员不构成「未声明」的证据。
 * 2. **只检查对象成员，不检查数组下标。** 解码器可能在报错后停止遍历数组尾部元素。
 * 3. **只检查「至少被探测过一次」的对象。** 一个成员都没被探测的对象说明解码器根本没下降到
 *    这一层——那是开放 JSON 值（`gameplayValues[*].value`、`defaultValue` 等按 `JsonValue`
 *    原样保留的位置）。这条规则同时给出了 `open-property-map` 能力。
 * 4. **只检查「解码器把它当作封闭字段集」的结构层：包顶层与每个定义对象的直接成员。**
 *    这是本检查的作用域边界，也是它必须显式声明的**已知局限**：
 *    - `decodePackage` 与 `decodeDefinition` 在这两层各自读取一个**固定、封闭**的具名字段集合，
 *      因此这两层的未声明成员一定是拼写错误或幽灵字段，可放心拒绝；
 *    - 更深的嵌套结构（`sourceLocation`、`familyContract` 内部、参数 Schema……）里，解码器会
 *      **派生或忽略**某些已声明字段（例如 `sourceLocation.sourceFile` 由外层记录重建而从不探测
 *      内层同名字段）。在这些层用「探测过没有」判定会把合法的已声明字段误报为未声明。
 *      这些层的字段完整性由 l2 各自的 required/damaged 校验负责，本检查不介入。
 *
 * 换言之：封闭 Schema 检查覆盖「顶层 + 定义级」的封闭字段集，深层结构视为由 l2 自有校验守护。
 * 这不是妥协出来的特例，而是与 l2 解码器「哪几层是封闭字段集」的真实结构对齐。
 */

import { joinJsonPath, ROOT_JSON_PATH } from '../../model/ids';
import type { PackageId } from '../../model/ids';
import type { SourceLocation } from '../../model/source';
import { compareStrings } from '../../model/ordering';
import { isErrorDiagnostic } from '../../model/diagnostic';
import { scanJson, type JsonNode } from '../../codec/json-scanner';
import { createDecodeContext } from '../../codec/decode';
import { decodePackage } from '../../codec/definition-decoder';

/** 一处未声明成员。 */
export interface UnknownMember {
  /** 承载该成员的对象的 JSON path（RFC 6901 风格，根为空串）。 */
  readonly containerPath: string;
  readonly key: string;
  /** 该成员自身的 JSON path，用于诊断定位。 */
  readonly jsonPath: string;
}

/**
 * 判定某个容器路径是否是「解码器按封闭字段集处理」的层。
 *
 * - 根路径（空串）：包顶层，`decodePackage` 读取固定字段集。
 * - `/definitions/{index}`：定义对象，`decodeDefinition` 读取固定字段集。
 * 其余路径（更深的嵌套）返回 false，交由 l2 自有校验守护。
 */
function isClosedFieldContainer(path: string): boolean {
  if (path === ROOT_JSON_PATH) {
    return true;
  }
  return /^\/definitions\/\d+$/u.test(path);
}

interface TrackedObject {
  readonly path: string;
  readonly actualKeys: readonly string[];
  readonly probed: Set<string>;
}

interface Tracker {
  readonly objects: Map<string, TrackedObject>;
}

/**
 * 由扫描节点物化对象树，并为每个对象挂上探测追踪 `Proxy`。
 *
 * 与 `codec/json-codec.ts` 内部的 `nodeValue` 行为一致（同一套 kind 分支），差别只在于
 * 对象被包了一层记录探测的代理。这里不复用那个函数是因为它是模块私有的；行为一致性由
 * 本目录测试中的「代理树与普通树解码结果等价」断言保证。
 */
function materialize(node: JsonNode, path: string, tracker: Tracker): unknown {
  switch (node.kind) {
    case 'object': {
      const target: Record<string, unknown> = {};
      const actualKeys: string[] = [];
      for (const member of node.members) {
        // 扫描器已把重复成员登记为诊断；这里保留最后一个值，与 nodeValue 相同。
        if (!actualKeys.includes(member.key)) {
          actualKeys.push(member.key);
        }
        target[member.key] = materialize(member.value, joinJsonPath(path, member.key), tracker);
      }
      const tracked: TrackedObject = { path, actualKeys, probed: new Set<string>() };
      tracker.objects.set(path, tracked);
      return new Proxy(target, {
        get(holder, property, receiver): unknown {
          if (typeof property === 'string') {
            tracked.probed.add(property);
          }
          return Reflect.get(holder, property, receiver);
        },
        has(holder, property): boolean {
          if (typeof property === 'string') {
            tracked.probed.add(property);
          }
          return Reflect.has(holder, property);
        },
        ownKeys(holder): ArrayLike<string | symbol> {
          for (const key of actualKeys) {
            tracked.probed.add(key);
          }
          return Reflect.ownKeys(holder);
        },
        getOwnPropertyDescriptor(holder, property): PropertyDescriptor | undefined {
          if (typeof property === 'string') {
            tracked.probed.add(property);
          }
          return Reflect.getOwnPropertyDescriptor(holder, property);
        },
      });
    }
    case 'array':
      return node.elements.map((element, index) => materialize(element, joinJsonPath(path, index), tracker));
    case 'string':
    case 'number':
    case 'boolean':
      return node.value;
    case 'null':
      return null;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

export interface ClosedSchemaScanInput {
  readonly canonicalJson: string;
  readonly sourceLocation: SourceLocation;
  readonly packageId?: PackageId;
}

export interface ClosedSchemaScanResult {
  /** 未声明成员，按 (容器路径, 成员名) 规范化排序。 */
  readonly unknownMembers: readonly UnknownMember[];
  /**
   * 本次扫描是否给出了结论。
   *
   * 为 false 表示「无法判定」而不是「没有未声明字段」：JSON 无法扫描，或解码本身已产生
   * Error（形状已坏，未读成员不构成证据）。调用方据此决定是否声明覆盖了 `closed-schema` 能力
   * ——注意此时候选一定已被其他错误拒绝，因此不存在「因跳过检查而放行」的口子。
   */
  readonly conclusive: boolean;
}

/** 扫描规范化候选文档中的未声明成员。 */
export function scanUnknownMembers(input: ClosedSchemaScanInput): ClosedSchemaScanResult {
  const scan = scanJson(input.canonicalJson);
  if (!scan.ok) {
    return { unknownMembers: Object.freeze([]), conclusive: false };
  }
  if (scan.root.kind !== 'object') {
    return { unknownMembers: Object.freeze([]), conclusive: false };
  }

  const tracker: Tracker = { objects: new Map<string, TrackedObject>() };
  const proxiedRoot = materialize(scan.root, ROOT_JSON_PATH, tracker) as Record<string, unknown>;
  const ctx = createDecodeContext(scan.root, input.sourceLocation, input.packageId);
  decodePackage(ctx, scan.root, proxiedRoot);
  if (ctx.diagnostics.some(isErrorDiagnostic)) {
    return { unknownMembers: Object.freeze([]), conclusive: false };
  }

  const unknown: UnknownMember[] = [];
  for (const tracked of tracker.objects.values()) {
    if (tracked.probed.size === 0) {
      // 规则 3：解码器从未下降到这一层，视为开放 JSON 值。
      continue;
    }
    // 规则 4：只检查封闭字段集的两层（包顶层、定义直接成员）。
    if (!isClosedFieldContainer(tracked.path)) {
      continue;
    }
    for (const key of tracked.actualKeys) {
      if (!tracked.probed.has(key)) {
        unknown.push({
          containerPath: tracked.path,
          key,
          jsonPath: joinJsonPath(tracked.path, key),
        });
      }
    }
  }
  unknown.sort((left, right) => {
    const byContainer = compareStrings(left.containerPath, right.containerPath);
    return byContainer !== 0 ? byContainer : compareStrings(left.key, right.key);
  });
  return { unknownMembers: Object.freeze(unknown), conclusive: true };
}
