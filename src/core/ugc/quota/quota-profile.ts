/**
 * 可信配额档案校验（design.md「Trusted quota profile」/ 需求 5.5-5.8、9.1-9.3、9.10）。
 *
 * 铁律：配额值来自**可信宿主配置**，与候选文档完全独立。候选不能通过自身字段提高、禁用或
 * 重新解释任何一项（需求 5.8）。因此本模块只接受一个已构造好的对象并校验其完整性与合法性，
 * 从不从候选 JSON 读取任何配额。
 *
 * 本设计**不设默认配额值**（design.md「Unresolved Integration Boundaries」第 5 条）：部署档案
 * 必须显式提供每一项。缺项即拒绝启动验证，而不是回退到某个"看起来安全"的猜测值。
 */
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import type { QuotaKind, TrustedQuotaProfile } from '../model/quota-types.js';
import { QUOTA_KINDS } from '../model/quota-types.js';
import type { UgcResult } from '../model/result.js';
import { ugcOk, ugcReject } from '../model/result.js';

export interface QuotaProfileProblem {
  readonly kind: QuotaKind | 'profileId' | 'version';
  readonly reason: 'missing' | 'not-a-number' | 'not-finite' | 'not-integer' | 'negative' | 'empty-identity';
  readonly actual: string;
}

function describeActual(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : String(value);
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return `${typeof value}`;
}

function inspectQuotaValue(value: unknown): QuotaProfileProblem['reason'] | null {
  if (value === undefined || value === null) return 'missing';
  if (typeof value !== 'number') return 'not-a-number';
  if (!Number.isFinite(value)) return 'not-finite';
  if (!Number.isSafeInteger(value)) return 'not-integer';
  if (value < 0) return 'negative';
  return null;
}

/** 纯校验：返回全部问题，不抛异常，也不修正任何值。 */
export function inspectQuotaProfile(candidate: unknown): readonly QuotaProfileProblem[] {
  const problems: QuotaProfileProblem[] = [];
  const record = (candidate ?? {}) as Record<string, unknown>;

  for (const identity of ['profileId', 'version'] as const) {
    const value = record[identity];
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
      problems.push({ kind: identity, reason: 'empty-identity', actual: describeActual(value) });
    }
  }

  for (const kind of QUOTA_KINDS) {
    const reason = inspectQuotaValue(record[kind]);
    if (reason !== null) {
      problems.push({ kind, reason, actual: describeActual(record[kind]) });
    }
  }

  return Object.freeze(problems);
}

const REASON_TEXT: Readonly<Record<QuotaProfileProblem['reason'], string>> = {
  'missing': '缺失',
  'not-a-number': '不是数字',
  'not-finite': '不是有限数',
  'not-integer': '不是安全整数',
  'negative': '为负数',
  'empty-identity': '不是非空且无前后空白的标识字符串',
};

/**
 * 校验并冻结配额档案。任何问题都使验证**无法启动**——这是需求 9.1 与
 * 「Missing quota profile or code mapping → Validation does not start」的直接编码：
 * 缺少安全配额时继续解析不可信输入，等于放弃全部资源上界。
 */
export function validateQuotaProfile(
  factory: UGCDiagnosticFactory,
  candidate: unknown,
  sourcePackage: string,
): UgcResult<TrustedQuotaProfile> {
  const problems = inspectQuotaProfile(candidate);
  if (problems.length > 0) {
    return ugcReject(
      problems.map((problem) =>
        factory.host({
          selector: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
          stage: 'baseline',
          sourcePackage,
          message: `Trusted quota profile entry ${problem.kind} is invalid: ${problem.reason}.`,
          reason: `可信配额档案的 ${problem.kind} ${REASON_TEXT[problem.reason]}，验证无法启动。`,
          correctionSuggestion:
            '这是宿主配置问题而非候选内容问题：请为该部署档案补齐全部配额项，每项都必须是非负安全整数。',
          expected: 'finite nonnegative safe integer',
          actual: problem.actual,
          sourceSpan: null,
          messageArgs: { entry: problem.kind, reason: problem.reason },
        }),
      ),
    );
  }

  const record = candidate as Record<string, unknown>;
  const frozen: Record<string, unknown> = {
    profileId: record['profileId'],
    version: record['version'],
  };
  for (const kind of QUOTA_KINDS) {
    frozen[kind] = record[kind];
  }
  return ugcOk(Object.freeze(frozen) as unknown as TrustedQuotaProfile);
}
