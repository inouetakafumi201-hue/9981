/**
 * 禁止执行构造的**语义**门禁（design.md「Declarative JSON safety」/ 需求 2.2-2.7、13.9；tasks.md 3.3）。
 *
 * ## 为什么这里没有关键字黑名单
 *
 * 初稿曾写成"成员名命中 eval/exec/function/set/for 就拒绝"的表，随后作废。原因是它同时犯了两个错：
 *
 * 1. **误报合法声明式效果。** 本引擎的 Flow 契约里 `while` 是**已登记**构造（强制携带 `maxIter`，
 *    见 `kernel/safety/safety.ts` 的 Linter 第 3 项与 `E_FLOW_NO_MAXITER`），`set` 对应已登记的
 *    `prop.set` Op。把它们按名字拒绝会让完全合法的候选无法装载，而需求 2.3 明确允许候选描述
 *    "已被上游 Schema 接纳的效果组合"。
 * 2. **漏报真正的危险。** 攻击面不在名字里。同一个词换个拼写、换个嵌套位置就能绕过表，而表本身
 *    永远追不上上游 Schema 的演进。
 *
 * ## UGC 在这一层真正拥有的判断
 *
 * 纯 JSON **本身不含可执行构造**：解码器产出的 AST 只有 null/bool/number/string/array/object，
 * 没有任何东西会被求值（需求 2.6 已由"从不执行候选字段"结构性保证）。"禁止构造"这个概念只在
 * **相对某个把成员名赋予语义的 Schema/效果契约**时才成立。
 *
 * 因此本模块不自行判定，而是把"这个位置上的这个成员是否在请求代码执行/未登记表达式语言"交给
 * 注入的 `EffectContractView`（由上游 Schema 拥有）。契约不可用时**失败关闭**，而不是退化成猜测。
 * 这与 design.md「将具体效果、Expr 和 Flow 合法性转交上游 Schema/Definition Validator；
 * UGC 不实现求值器」完全一致。
 */
import type { SourceSpan } from '../../kernel/state/diagnostic.js';
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import type { JsonAst, ParsedCandidateDocument } from '../model/json-ast.js';
import type { QuotaBudget } from '../model/quota-types.js';
import { UNAVAILABLE_PROVIDER_ID } from '../ports/availability.js';

/** 上游对"某个位置上的某个成员意味着什么"的裁定。 */
export type MemberVerdict =
  | { readonly kind: 'admitted' }
  | { readonly kind: 'unknown-member' }
  | { readonly kind: 'execution-request'; readonly detail: ExecutionRequestKind }
  | { readonly kind: 'unregistered-expression-language'; readonly language: string };

export type ExecutionRequestKind =
  | 'code-string-evaluation'
  | 'function-definition'
  | 'imperative-loop'
  | 'variable-assignment'
  | 'external-command'
  | 'script-payload';

/**
 * 效果契约视图。由上游 Schema 提供，UGC 只查询。
 *
 * ## 两个方法收到的 path 不是同一个东西
 *
 * 这处不对称是刻意的，调用点见 `collectFindings`：
 *
 * | 方法 | 收到的 path | 例（成员 `eval` 位于 `/effects/0`） |
 * |------|-------------|--------------------------------------|
 * | `classifyMember` | **父容器**路径 + 独立的成员名 | `('/effects/0', 'eval')` |
 * | `isFreeTextRegion` | 该成员**自身**的完整路径 | `('/effects/0/eval')` |
 *
 * `classifyMember` 之所以拆开传，是因为契约要回答的问题本身就是"在容器 X 里，名为 N 的成员
 * 意味着什么"——拆开传让契约不必反解 JSON Pointer（成员名可能含 `/`，见 `escapePointerToken`）。
 * 位置必须参与判定：同一个成员名 `eval` 在 `/effects/0` 与在 `/params` 下完全可以得到不同裁定，
 * 这正是本门禁不退化为关键字黑名单的原因。
 *
 * 顶层成员的父路径为空串，归一化为 `'/'`，因此契约永远不会收到空字符串。
 */
export interface EffectContractView {
  readonly providerId: string;
  readonly contractVersion: string;
  /** @param parentPath 父容器的 JSON Pointer（顶层为 `'/'`），**不含** `memberName`。 */
  classifyMember(parentPath: string, memberName: string): MemberVerdict;
  /**
   * 该成员自身的完整路径是否位于自由文本区域（名称、描述、本地化）。
   * 命中则整棵子树跳过，不按效果契约解读。
   */
  isFreeTextRegion(memberPath: string): boolean;
}

export interface ProhibitedConstructFinding {
  readonly verdict: Exclude<MemberVerdict, { readonly kind: 'admitted' } | { readonly kind: 'unknown-member' }>;
  readonly memberName: string;
  readonly jsonPath: string;
  readonly span: SourceSpan;
}

export interface ProhibitedConstructGate {
  /**
   * 扫描候选。返回的诊断可能为空（全部合法）。
   *
   * 契约不可用时返回单条 `E_LOAD_UNRESOLVED_CONTRACT`，且**不**报告任何"合法"结论——
   * 这里不存在"契约没来就先放过"的通道。
   */
  scan(document: ParsedCandidateDocument, budget: QuotaBudget): readonly Diagnostic[];
}

/** JSON Pointer 风格路径转义（RFC 6901）：`~` → `~0`，`/` → `~1`。 */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

const EXECUTION_REQUEST_TEXT: Readonly<Record<ExecutionRequestKind, string>> = Object.freeze({
  'code-string-evaluation': '把字符串当作代码求值',
  'function-definition': '定义可执行函数',
  'imperative-loop': '命令式循环',
  'variable-assignment': '变量赋值',
  'external-command': '调用外部命令或进程',
  'script-payload': '嵌入脚本载荷',
});

export function createProhibitedConstructGate(
  factory: UGCDiagnosticFactory,
  contract: EffectContractView,
): ProhibitedConstructGate {
  return Object.freeze({
    scan(document: ParsedCandidateDocument, budget: QuotaBudget): readonly Diagnostic[] {
      const sourcePackage = document.source.packageId;

      if (contract.providerId === UNAVAILABLE_PROVIDER_ID) {
        return Object.freeze([
          factory.changeSet({
            selector: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
            stage: 'decode',
            sourcePackage,
            message: 'Effect contract view is unavailable; prohibited-construct screening fails closed.',
            reason:
              '上游效果契约尚未汇合，无法判定候选中的成员是否在请求代码执行。' +
              'UGC 不会用关键字猜测代替契约判定，因此该候选失败关闭。',
            correctionSuggestion:
              '这不是候选内容的问题：请等待上游效果契约冻结并注入后重新提交完整候选。',
            expected: 'effect contract available',
            actual: 'unavailable',
            sourceSpan: null,
            jsonPath: null,
          }),
        ]);
      }

      const findings = collectFindings(document.ast, contract, budget);
      if (findings.ok === false) {
        return Object.freeze([
          factory.changeSet({
            selector: { category: 'RESOURCE_LIMIT', condition: findings.violationKind },
            stage: 'decode',
            sourcePackage,
            message: `Quota ${findings.violationKind} exhausted while screening for prohibited constructs.`,
            reason: `扫描禁止构造时超出可信配额 ${findings.violationKind}，扫描已终止且不产出"合法"结论。`,
            correctionSuggestion: '请缩减候选规模或嵌套深度后重新提交。',
            sourceSpan: null,
            jsonPath: null,
          }),
        ]);
      }

      return Object.freeze(
        findings.value.map((finding) => toDiagnostic(finding, factory, sourcePackage)),
      );
    },
  });
}

function toDiagnostic(
  finding: ProhibitedConstructFinding,
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
): Diagnostic {
  if (finding.verdict.kind === 'unregistered-expression-language') {
    return factory.changeSet({
      selector: { category: 'PROHIBITED_CONSTRUCT', condition: 'unregistered-expression-language' },
      stage: 'decode',
      sourcePackage,
      sourceSpan: finding.span,
      jsonPath: finding.jsonPath,
      message: `Unregistered expression language requested at ${finding.jsonPath}: ${finding.verdict.language}.`,
      reason:
        `位置 ${finding.jsonPath} 请求使用表达式语言 ${JSON.stringify(finding.verdict.language)}，` +
        '但引擎层没有登记该语言。声明式候选只能使用已登记的表达式契约。',
      correctionSuggestion: '请改用引擎层已登记的表达式形式；不要引入自定义脚本语言。',
      actual: finding.verdict.language,
    });
  }

  const detail = finding.verdict.detail;
  return factory.changeSet({
    selector: { category: 'PROHIBITED_CONSTRUCT', condition: 'executable-construct' },
    stage: 'decode',
    sourcePackage,
    sourceSpan: finding.span,
    jsonPath: finding.jsonPath,
    message: `Prohibited execution request at ${finding.jsonPath} (${detail}).`,
    reason:
      `位置 ${finding.jsonPath} 的成员 ${JSON.stringify(finding.memberName)} 在效果契约中被判定为` +
      `"${EXECUTION_REQUEST_TEXT[detail]}"。声明式候选只能描述数据、条件、引用和已登记效果的组合，不能携带可执行内容。`,
    correctionSuggestion: '请删除该成员，改用已登记的声明式效果来表达同样的意图。',
    actual: detail,
  });
}

type CollectResult =
  | { readonly ok: true; readonly value: readonly ProhibitedConstructFinding[] }
  | { readonly ok: false; readonly violationKind: 'traversalWork' };

/**
 * 迭代遍历（显式栈，零递归）。恶意嵌套只会耗尽 traversalWork 配额，不会造成调用栈溢出（需求 9.5）。
 *
 * 自由文本区域整棵子树跳过：这是"普通描述里出现同名单词不得误报"的结构性保证，
 * 而不是逐条判断后再宽恕。
 */
function collectFindings(root: JsonAst, contract: EffectContractView, budget: QuotaBudget): CollectResult {
  const findings: ProhibitedConstructFinding[] = [];
  const stack: { readonly node: JsonAst; readonly path: string }[] = [{ node: root, path: '' }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    if (budget.consume('traversalWork', 1) !== null) {
      return { ok: false, violationKind: 'traversalWork' };
    }

    const { node, path } = frame;

    if (node.kind === 'array') {
      for (let index = node.elements.length - 1; index >= 0; index -= 1) {
        const element = node.elements[index];
        if (element !== undefined) stack.push({ node: element, path: `${path}/${String(index)}` });
      }
      continue;
    }

    if (node.kind !== 'object') continue;

    for (const member of node.members) {
      const memberPath = `${path}/${escapePointerToken(member.key)}`;
      if (contract.isFreeTextRegion(memberPath)) continue;

      const verdict = contract.classifyMember(path === '' ? '/' : path, member.key);
      if (verdict.kind === 'execution-request' || verdict.kind === 'unregistered-expression-language') {
        findings.push({ verdict, memberName: member.key, jsonPath: memberPath, span: member.keySpan });
        continue;
      }
      stack.push({ node: member.value, path: memberPath });
    }
  }

  return { ok: true, value: Object.freeze(findings) };
}
