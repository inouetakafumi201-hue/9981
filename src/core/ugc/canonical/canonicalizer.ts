/**
 * Schema 感知的确定性规范化（design.md「Canonicalization Gateway」/ 需求 11.1-11.12、3.10、12.13）。
 *
 * 确定性来自四个决定：
 * 1. 对象键按 **Unicode code point 全序**排序，不用 `localeCompare`（locale 相关）也不用默认 `<`
 *    （按 UTF-16 code unit 比较，会把 BMP 外字符排错位置）。
 * 2. 数组**默认保序**；只有 Schema 明确声明无序且提供稳定身份的集合才排序。
 * 3. 数字用 ECMAScript `Number::toString` 的规范形式。该算法由标准完全指定、与 locale 无关，
 *    因此 `1.0`、`1e0`、`1` 归一为同一字节序列，而结果在任何机器上相同。
 * 4. 输出中**不注入**时间戳、随机 ID、宿主路径、Adapter 信息或 locale 相关数字（需求 11.5）。
 */
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import { documentAnchorSpan } from '../diagnostics/factory.js';
import type { CanonicalCandidate } from '../model/canonical-types.js';
import type { StableFingerprintGateway } from '../model/fingerprint.js';
import { compareCodePoints } from '../model/fingerprint.js';
import type { JsonAst, MigratedCandidateDocument } from '../model/json-ast.js';
import type { QuotaBudget } from '../model/quota-types.js';
import type { UgcResult } from '../model/result.js';
import { ugcOk, ugcReject } from '../model/result.js';
import type { CanonicalizationSchemaView } from '../ports/schema-ports.js';
import { isPortUnavailable } from '../ports/availability.js';
import { SCHEMA_CATALOG_EVIDENCE, unresolvedContractDiagnostic } from '../ports/unavailable.js';

const STAGE = 'canonicalize' as const;

export interface CanonicalizationGateway {
  canonicalize(
    candidate: MigratedCandidateDocument,
    budget: QuotaBudget,
  ): UgcResult<CanonicalCandidate>;
}

export interface CanonicalizationDeps {
  readonly schema: CanonicalizationSchemaView;
  readonly fingerprint: StableFingerprintGateway;
  readonly factory: UGCDiagnosticFactory;
}

/** JSON Pointer 转义（RFC 6901）。 */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

const SHORT_ESCAPES: Readonly<Record<number, string>> = Object.freeze({
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
});

/**
 * 规范化字符串字面量。
 *
 * 只转义 JSON 必须转义的内容：`"`、`\` 和 U+0000–U+001F 控制字符。非 ASCII 字符**原样输出**
 * （文档本身就是 UTF-8），不做 `\u` 转义——否则同一个字符会有两种合法写法，规范形式就不唯一了。
 */
function canonicalString(value: string): string {
  let out = '"';
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (char === '"') {
      out += '\\"';
    } else if (char === '\\') {
      out += '\\\\';
    } else if (codePoint < 0x20) {
      out += SHORT_ESCAPES[codePoint] ?? `\\u${codePoint.toString(16).padStart(4, '0')}`;
    } else {
      out += char;
    }
  }
  return `${out}"`;
}

/**
 * 规范化数字。
 *
 * 用 `value` 而非作者写下的 `lexical`：`1.0`、`1e0`、`1` 是同一个 JSON 数值，保留原文会让语义相同的
 * 候选产生不同字节，破坏需求 11.8 的等价归一。`Number::toString` 由 ECMAScript 完全指定且与 locale 无关。
 */
function canonicalNumber(value: number): string {
  // -0 与 0 在 JSON 语义上不可区分，统一输出 0，避免出现两种规范形式。
  return Object.is(value, -0) ? '0' : String(value);
}

type CanonicalFailure =
  | { readonly kind: 'quota'; readonly quotaKind: string; readonly limit: number; readonly observed: number }
  | { readonly kind: 'ambiguous'; readonly jsonPath: string; readonly detail: string };

interface Emitter {
  push(text: string): CanonicalFailure | null;
  result(): string;
}

/** 输出时按字节计入 outputBytes 配额，避免规范化本身变成放大攻击（需求 9.2）。 */
function createEmitter(budget: QuotaBudget): Emitter {
  const parts: string[] = [];
  const encoder = new TextEncoder();
  return {
    push(text: string): CanonicalFailure | null {
      const violation = budget.consume('outputBytes', encoder.encode(text).length);
      if (violation !== null) {
        return {
          kind: 'quota',
          quotaKind: violation.kind,
          limit: violation.limit,
          observed: violation.observed,
        };
      }
      parts.push(text);
      return null;
    },
    result(): string {
      return parts.join('');
    },
  };
}

type Task =
  | { readonly kind: 'emit'; readonly text: string }
  | { readonly kind: 'visit'; readonly node: JsonAst; readonly path: string };

/**
 * 迭代式输出（显式任务栈，零递归）。恶意嵌套只会耗尽配额，不会造成调用栈溢出（需求 9.5）。
 *
 * 任务按 LIFO 消费，因此压栈顺序与输出顺序相反：先压结束符，再倒序压元素与分隔符。
 */
function emitCanonical(
  root: JsonAst,
  rootPath: string,
  schema: CanonicalizationSchemaView,
  budget: QuotaBudget,
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly failure: CanonicalFailure } {
  const emitter = createEmitter(budget);
  const stack: Task[] = [{ kind: 'visit', node: root, path: rootPath }];

  while (stack.length > 0) {
    const work = budget.consume('traversalWork', 1);
    if (work !== null) {
      return {
        ok: false,
        failure: { kind: 'quota', quotaKind: work.kind, limit: work.limit, observed: work.observed },
      };
    }

    const task = stack.pop();
    if (task === undefined) break;

    if (task.kind === 'emit') {
      const failure = emitter.push(task.text);
      if (failure !== null) return { ok: false, failure };
      continue;
    }

    const ordered = planNode(task.node, task.path, schema);
    if (ordered.ok === false) return { ok: false, failure: ordered.failure };
    for (let index = ordered.tasks.length - 1; index >= 0; index -= 1) {
      const next = ordered.tasks[index];
      if (next !== undefined) stack.push(next);
    }
  }

  return { ok: true, text: emitter.result() };
}

/** 把单个节点展开为一串任务。对象排键、数组按 Schema 决定是否排序。 */
function planNode(
  node: JsonAst,
  path: string,
  schema: CanonicalizationSchemaView,
): { readonly ok: true; readonly tasks: readonly Task[] } | { readonly ok: false; readonly failure: CanonicalFailure } {
  if (node.kind === 'null') return { ok: true, tasks: [{ kind: 'emit', text: 'null' }] };
  if (node.kind === 'boolean') return { ok: true, tasks: [{ kind: 'emit', text: node.value ? 'true' : 'false' }] };
  if (node.kind === 'number') return { ok: true, tasks: [{ kind: 'emit', text: canonicalNumber(node.value) }] };
  if (node.kind === 'string') return { ok: true, tasks: [{ kind: 'emit', text: canonicalString(node.value) }] };

  if (node.kind === 'array') {
    const order = resolveArrayOrder(node, path, schema);
    if (order.ok === false) return { ok: false, failure: order.failure };
    const tasks: Task[] = [{ kind: 'emit', text: '[' }];
    order.indices.forEach((elementIndex, position) => {
      if (position > 0) tasks.push({ kind: 'emit', text: ',' });
      const element = node.elements[elementIndex];
      if (element !== undefined) {
        tasks.push({ kind: 'visit', node: element, path: `${path}/${String(elementIndex)}` });
      }
    });
    tasks.push({ kind: 'emit', text: ']' });
    return { ok: true, tasks };
  }

  // 对象：键按 code point 全序排序。解码器已保证同一对象内不存在重复成员名。
  const members = [...node.members].sort((left, right) => compareCodePoints(left.key, right.key));
  const tasks: Task[] = [{ kind: 'emit', text: '{' }];
  members.forEach((member, position) => {
    if (position > 0) tasks.push({ kind: 'emit', text: ',' });
    tasks.push({ kind: 'emit', text: `${canonicalString(member.key)}:` });
    tasks.push({ kind: 'visit', node: member.value, path: `${path}/${escapePointerToken(member.key)}` });
  });
  tasks.push({ kind: 'emit', text: '}' });
  return { ok: true, tasks };
}

/**
 * 决定数组元素的输出顺序。
 *
 * 默认返回输入顺序——语义数组的顺序差异必须被保留（需求 11.9）。只有 Schema 明确声明无序时才排序，
 * 且必须每个元素都有稳定语义身份、且身份互不重复；否则规范形式不唯一，按需求 11.4/11.12 拒绝。
 */
function resolveArrayOrder(
  node: Extract<JsonAst, { kind: 'array' }>,
  path: string,
  schema: CanonicalizationSchemaView,
): { readonly ok: true; readonly indices: readonly number[] } | { readonly ok: false; readonly failure: CanonicalFailure } {
  const naturalOrder = node.elements.map((_element, index) => index);
  if (!schema.isUnorderedCollection(path)) {
    return { ok: true, indices: naturalOrder };
  }

  const identities = new Map<string, number>();
  const keyed: { readonly identity: string; readonly index: number }[] = [];

  for (const index of naturalOrder) {
    const identity = schema.semanticIdentityOf(path, index);
    if (identity === null) {
      return {
        ok: false,
        failure: {
          kind: 'ambiguous',
          jsonPath: `${path}/${String(index)}`,
          detail: 'Schema 把该集合声明为无序，但没有为该元素定义稳定语义身份，因此规范化结果不唯一。',
        },
      };
    }
    const previous = identities.get(identity);
    if (previous !== undefined) {
      return {
        ok: false,
        failure: {
          kind: 'ambiguous',
          jsonPath: `${path}/${String(index)}`,
          detail: `无序集合中出现重复的语义身份 ${JSON.stringify(identity)}（首次出现在下标 ${String(previous)}），无法确定唯一顺序。`,
        },
      };
    }
    identities.set(identity, index);
    keyed.push({ identity, index });
  }

  keyed.sort((left, right) => compareCodePoints(left.identity, right.identity));
  return { ok: true, indices: keyed.map((entry) => entry.index) };
}

export function createCanonicalizationGateway(deps: CanonicalizationDeps): CanonicalizationGateway {
  const { schema, fingerprint, factory } = deps;

  return Object.freeze({
    canonicalize(candidate: MigratedCandidateDocument, budget: QuotaBudget): UgcResult<CanonicalCandidate> {
      const sourcePackage = candidate.source.packageId;
      const anchor = documentAnchorSpan(candidate.source.documentId);

      if (isPortUnavailable(schema)) {
        return ugcReject([unresolvedContractDiagnostic(factory, STAGE, sourcePackage, SCHEMA_CATALOG_EVIDENCE)]);
      }

      const emitted = emitCanonical(candidate.ast, '', schema, budget);
      if (emitted.ok === false) {
        const failure = emitted.failure;
        if (failure.kind === 'ambiguous') {
          return ugcReject([
            factory.changeSet({
              selector: { category: 'SCHEMA_CONTRACT', condition: 'canonical-ambiguous' },
              stage: STAGE,
              sourcePackage,
              sourceSpan: anchor,
              jsonPath: failure.jsonPath,
              message: `Canonicalization is not unique at ${failure.jsonPath}.`,
              reason: failure.detail,
              correctionSuggestion:
                '请为该无序集合的每个元素提供唯一的语义身份，或让 Schema 把该集合声明为有序数组。',
            }),
          ]);
        }
        return ugcReject([
          factory.changeSet({
            selector: { category: 'RESOURCE_LIMIT', condition: failure.quotaKind as 'outputBytes' },
            stage: STAGE,
            sourcePackage,
            sourceSpan: anchor,
            jsonPath: null,
            message: `Quota ${failure.quotaKind} exceeded during canonicalization.`,
            reason: `规范化输出超出可信配额 ${failure.quotaKind}（上限 ${String(failure.limit)}）。`,
            correctionSuggestion: '请缩减候选规模；配额由宿主配置，候选自身无法提高它。',
            expected: failure.limit,
            actual: failure.observed,
          }),
        ]);
      }

      const canonicalJson = emitted.text;
      return ugcOk({
        source: candidate.source,
        targetOwnership: candidate.targetOwnership,
        schemaVersion: candidate.schemaVersion,
        canonicalJson,
        canonicalFingerprint: fingerprint.fingerprintText(canonicalJson),
        // 二次物化：此时重复成员、非有限数字与禁止构造都已被拒绝，因此用标准解析器安全且能保证
        // decodedValue 与 canonicalJson 完全一致。这不是"首次物化路径"，不违反任务 3.2 的约束。
        decodedValue: JSON.parse(canonicalJson) as unknown,
        migrationIds: candidate.appliedMigrationIds,
      });
    },
  });
}
