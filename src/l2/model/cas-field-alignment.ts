/**
 * CaS 缝隙闭合：组件字段名 ↔ System 参数名 匹配判定的唯一权威实现。
 *
 * 背景：`wakeup-cas-gap-closure` Requirement 1.1/3.1。CaS 缝隙（component-slot gap）指
 * 组件的可配置字段名与对应 System 参数名同指一个取值、却无机器校验落到同一通路的现象。
 * 历史上该判定曾在 `src/play/profiles/audit.ts::auditKernelOpsAlignment`（宽松前缀匹配）
 * 与 `src/l2/validation/composition-alignment-rules.ts::validateCompositionAlignment`（仅名称
 * 形状检查，无字段↔参数同轨）两处各自实现、规则不同、来源不同。本模块把它收敛为全仓库
 * 唯一判定函数：任何层只调用它，禁止各自内联一套同一规则。
 *
 * 匹配规则沿用 `src/l2/决策与风险记录.md` §7.5 的 H-ECSP-01 意图并受测固化：`prop.<field>`、
 * `<field>.<nested>`、`<nested>.<field>` 与声明槽位视为同一通路；裸 Op（无括号或空字段）
 * 返回 `not-applicable`（不外报，避免误报——真实 capabilities 的 kernelOps 214 个零括号）。
 */
import type { DiagnosticCode } from './diagnostic-codes';

/** 匹配判定的明确三态，供属性测试断言（wakeup-cas-gap-closure Req 3.3）。 */
export const CA_SCHEMA_OUTCOMES = ['match', 'no-match', 'not-applicable'] as const;
export type CASchemaOutcome = (typeof CA_SCHEMA_OUTCOMES)[number];

/**
 * 判定一个 kernelOps scopeField 的字段引用是否落在能力声明的参数槽位集合内。
 *
 * @param scopeField 一个 kernelOps 条目，可能是裸 Op（`prop.set`）或携带字段引线（`prop.set(hp)`）。
 * @param declaredParams  能力声明的参数名集合（`parameters[*].key` ∪ `parameterNames`）。
 * @returns `match`（字段确在 D 的同义形态内）、`no-match`（带括号字段但不在 D 内，= CaS 缝隙）、
 *          `not-applicable`（裸 Op / 空字段，不外报）。
 */
export function caSFieldMatches(
  scopeField: string,
  declaredParams: ReadonlySet<string>,
): CASchemaOutcome {
  const openParen = scopeField.indexOf('(');
  if (openParen === -1 || !scopeField.endsWith(')')) return 'not-applicable';
  const fieldHint = scopeField.slice(openParen + 1, -1);
  if (fieldHint.trim().length === 0) return 'not-applicable';

  // H-ECSP-01 宽松前缀：`prop.<field>`、`<field>.<nested>`、`<nested>.<field>` 与声明槽位同义。
  const matches = [...declaredParams].some((declared) =>
    fieldHint === declared
    || fieldHint === `prop.${declared}`
    || fieldHint.startsWith(`${declared}.`)
    || fieldHint.endsWith(`.${declared}`));
  return matches ? 'match' : 'no-match';
}

/** CaS 缝隙诊断（wakeup-cas-gap-closure Req 1.3）：单一权威码 `CAS_FIELD_GAP`。 */
export const CAS_FIELD_GAP_CODE: DiagnosticCode = 'CAS_FIELD_GAP';

/** CaS 缝隙诊断的形状，与 `src/play/profiles/audit.ts` 的 `Finding` 一致。 */
export interface CaSFieldGapFinding {
  /** 稳定诊断码（进入 core diagnostic-codes，见 Req 1.3）。 */
  readonly code: typeof CAS_FIELD_GAP_CODE;
  readonly sourceId: string;
  readonly jsonPath: string;
  readonly reason: string;
}
