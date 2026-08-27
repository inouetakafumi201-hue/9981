/**
 * L2 → wakeup-ugc 端口：跨领域提供方判定（`provider-domain` / `ambiguous-target` 能力）。
 *
 * ## 为什么这两项能力属于端口而不属于 l2 核心
 * l2 的 `TypedReference` 只有 `refId` / `role` / `expected`，**没有** `providerDomain` 概念——它也不该有：
 * 「这个定义由 core-mechanics 还是 space-items 还是 ai 提供」是跨领域契约目录（`IntegrationContractSnapshot`）
 * 说的事，而契约目录只存在于端口边界（由 wakeup-ugc 传入）。因此这里不是把 l2 的判定复制了一份，
 * 而是用 l2 拿不到的输入补上 l2 结构上无法回答的问题。
 *
 * ## 判定规则
 * 对每个引用目标，按它的语义族与 Def kind 去契约目录里找导出方：
 * - 恰好一个领域导出 → 该领域即提供领域；
 * - 多于一个领域导出同一身份 → **歧义**，无法确定提供方，报 `ambiguous-reference-target`；
 * - 没有领域导出 → 视为同层内部引用，`providerDomain` 为 null（不是错误：并非所有基类都跨领域导出）。
 *
 * 确定了提供领域之后再做一次契约核对：若目标由某领域提供，而该引用期望的 Def kind 不在这个领域
 * 导出的 Def kind 清单里，说明这条引用越过领域边界使用了未导出的身份 → `provider-contract`。
 */

import type { IntegrationContractSnapshot, IntegrationDomain } from '../../../core/ugc/model/contract-types';
import { compareStrings } from '../../model/ordering';

/** 某个身份（Def kind 或语义族）的导出方集合。 */
export interface ProviderIndex {
  /** Def kind → 导出它的领域（规范化排序、去重）。 */
  readonly byDefKind: ReadonlyMap<string, readonly IntegrationDomain[]>;
  /** 语义族 → 导出它的领域。 */
  readonly bySemanticFamily: ReadonlyMap<string, readonly IntegrationDomain[]>;
}

function addTo(map: Map<string, Set<IntegrationDomain>>, key: string, domain: IntegrationDomain): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, new Set([domain]));
    return;
  }
  existing.add(domain);
}

function freezeIndex(map: Map<string, Set<IntegrationDomain>>): ReadonlyMap<string, readonly IntegrationDomain[]> {
  const output = new Map<string, readonly IntegrationDomain[]>();
  for (const [key, domains] of map) {
    output.set(key, Object.freeze([...domains].sort(compareStrings)));
  }
  return output;
}

/** 由契约快照建立导出方索引。 */
export function buildProviderIndex(contracts: IntegrationContractSnapshot): ProviderIndex {
  const byDefKind = new Map<string, Set<IntegrationDomain>>();
  const bySemanticFamily = new Map<string, Set<IntegrationDomain>>();
  for (const contract of contracts.contracts) {
    for (const defKind of contract.exportedDefKinds) {
      addTo(byDefKind, defKind, contract.domain);
    }
    for (const family of contract.exportedSemanticFamilies) {
      addTo(bySemanticFamily, family, contract.domain);
    }
  }
  return Object.freeze({ byDefKind: freezeIndex(byDefKind), bySemanticFamily: freezeIndex(bySemanticFamily) });
}

/** 一次提供方判定的结论。 */
export type ProviderVerdict =
  | { readonly kind: 'internal' }
  | { readonly kind: 'resolved'; readonly domain: IntegrationDomain }
  | { readonly kind: 'ambiguous'; readonly domains: readonly IntegrationDomain[]; readonly identity: string };

/**
 * 判定某个目标定义的提供领域。
 *
 * 优先用语义族判定（族是基类层的组合单元，跨领域契约按族导出更精确），族无导出方时退到 Def kind。
 * 两者都无导出方即同层内部引用。
 */
export function resolveProviderDomain(
  index: ProviderIndex,
  target: { readonly defKind: string; readonly semanticFamily: string },
): ProviderVerdict {
  const byFamily = index.bySemanticFamily.get(target.semanticFamily);
  if (byFamily !== undefined && byFamily.length > 0) {
    if (byFamily.length > 1) {
      return { kind: 'ambiguous', domains: byFamily, identity: target.semanticFamily };
    }
    return { kind: 'resolved', domain: byFamily[0]! };
  }
  const byKind = index.byDefKind.get(target.defKind);
  if (byKind !== undefined && byKind.length > 0) {
    if (byKind.length > 1) {
      return { kind: 'ambiguous', domains: byKind, identity: target.defKind };
    }
    return { kind: 'resolved', domain: byKind[0]! };
  }
  return { kind: 'internal' };
}

/**
 * 目标所属领域是否导出了该引用期望的 Def kind。
 *
 * 引用未声明期望 Def kind 时返回 true：没有期望就没有可违反的契约，不臆造一个。
 */
export function domainExportsExpectedKind(
  contracts: IntegrationContractSnapshot,
  domain: IntegrationDomain,
  expectedDefKind: string | undefined,
): boolean {
  if (expectedDefKind === undefined) {
    return true;
  }
  return contracts.contracts
    .filter((contract) => contract.domain === domain)
    .some((contract) => contract.exportedDefKinds.includes(expectedDefKind));
}
