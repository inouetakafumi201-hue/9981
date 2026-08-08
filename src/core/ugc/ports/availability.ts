/**
 * 端口可用性判定（design.md「Unresolved Integration Boundaries」/ 需求 15.3）。
 *
 * 为什么需要显式判定，而不是"看端口返回空就当没有"：
 * 一个**空**的 Schema 迁移图和一个**不存在**的迁移注册表，对创作者是两种完全不同的情况——
 * 前者是"当前没有可用升级路径"，后者是"上游契约尚未汇合"。把它们混为一谈会让未汇合契约
 * 伪装成普通业务错误，正是需求 15.3 与 design.md 失败关闭原则要避免的。
 */

/** 全部 unavailable 适配器共用的提供方标识。 */
export const UNAVAILABLE_PROVIDER_ID = 'ugc.unavailable';

export interface UpstreamPortIdentity {
  readonly providerId: string;
}

export function isPortUnavailable(port: UpstreamPortIdentity): boolean {
  return port.providerId === UNAVAILABLE_PROVIDER_ID;
}

/** 一个未汇合端口的追踪信息。它进入诊断的 reason/correctionSuggestion，使阻塞项可审计。 */
export interface UnresolvedPortEvidence {
  readonly portName: string;
  /** 负责实现该端口的层或 Spec。 */
  readonly owner: string;
  /** 证据位置（Spec 路径、文档章节或代码路径）。 */
  readonly evidence: string;
  /** 该端口缺失所阻塞的 UGC 阶段。 */
  readonly blockedStages: readonly string[];
}

export function describeUnresolvedPort(evidence: UnresolvedPortEvidence): string {
  return [
    `端口 ${evidence.portName} 尚未汇合。`,
    `所有者：${evidence.owner}。`,
    `证据：${evidence.evidence}。`,
    `受阻阶段：${evidence.blockedStages.join('、')}。`,
  ].join('');
}

export const UNRESOLVED_PORT_CORRECTION =
  '这不是候选内容的问题：请等待上游端口冻结并注入真实实现后重新提交完整候选。' +
  '不要通过直接注册定义、局部 Linter 放行或替身实现绕过该门禁。';
