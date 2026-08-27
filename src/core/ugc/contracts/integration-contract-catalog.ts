/**
 * 跨领域待汇合契约目录（design.md「Integration contract catalog」/ 需求 15.1-15.10）。
 *
 * 目录只保存提供方**导出的类型身份与引用约束指纹**，不保存也不执行领域内部语义：
 * core mechanics 的动作/规则/数值语义、space-items 的拓扑/容器/物品/转移机制、
 * AI 的查询/策略/搜索/可见性/决策机制一律留在各自领域（需求 15.6-15.8）。
 *
 * 一个关键的反直觉点：**登记新契约不会让此前被拒绝的候选自动激活**（需求 15.10）。
 * 本目录因此刻意不缓存任何候选结果——它没有"待重试队列"，也没有候选的引用。
 * 每个候选都必须针对新基线完整重验。
 */
import type { UGCDiagnosticFactory } from '../diagnostics/factory';
import type {
  ContractExportKind,
  IntegrationContract,
  IntegrationContractSnapshot,
  IntegrationDomain,
  ResolvedContractExport,
} from '../model/contract-types';
import { INTEGRATION_DOMAINS } from '../model/contract-types';
import type { StableFingerprintGateway } from '../model/fingerprint';
import { compareCodePoints, encodeFingerprintPayload } from '../model/fingerprint';
import type { UgcResult } from '../model/result';
import { ugcOk, ugcReject } from '../model/result';

const STAGE = 'baseline' as const;

export type CatalogProblem =
  | { readonly kind: 'duplicate-provider'; readonly domain: IntegrationDomain; readonly providerIds: readonly string[] }
  | {
      readonly kind: 'conflicting-export';
      readonly domain: IntegrationDomain;
      readonly identity: string;
      readonly providerIds: readonly string[];
    }
  | { readonly kind: 'empty-identity'; readonly domain: IntegrationDomain; readonly detail: string };

export interface IntegrationContractCatalog {
  snapshot(): IntegrationContractSnapshot;
  /** 某领域的契约。未汇合时返回 `E_LOAD_UNRESOLVED_CONTRACT`。 */
  resolve(domain: IntegrationDomain, sourcePackage: string): UgcResult<IntegrationContract>;
  /** 某领域导出的具体身份。不存在时给出 expected provider 与 capability 信息（需求 15.9）。 */
  resolveExport(
    domain: IntegrationDomain,
    identity: string,
    sourcePackage: string,
  ): UgcResult<ResolvedContractExport>;
}

/** 契约排序：domain → providerId。同一 domain 只允许一个 provider，排序仍显式给出以保证确定性。 */
function compareContracts(left: IntegrationContract, right: IntegrationContract): number {
  const byDomain = compareCodePoints(left.domain, right.domain);
  return byDomain !== 0 ? byDomain : compareCodePoints(left.providerId, right.providerId);
}

/** 结构性校验：重复 provider、冲突导出身份、空标识。任一问题都使目录无法构建。 */
export function inspectContracts(contracts: readonly IntegrationContract[]): readonly CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  const byDomain = new Map<IntegrationDomain, string[]>();

  for (const contract of contracts) {
    for (const [label, value] of [
      ['providerId', contract.providerId],
      ['version', contract.version],
      ['referenceConstraintsFingerprint', contract.referenceConstraintsFingerprint],
    ] as const) {
      if (value.length === 0 || value.trim() !== value) {
        problems.push({ kind: 'empty-identity', domain: contract.domain, detail: label });
      }
    }
    const bucket = byDomain.get(contract.domain);
    if (bucket === undefined) byDomain.set(contract.domain, [contract.providerId]);
    else bucket.push(contract.providerId);
  }

  for (const [domain, providerIds] of byDomain) {
    if (providerIds.length > 1) {
      problems.push({ kind: 'duplicate-provider', domain, providerIds: Object.freeze([...providerIds].sort(compareCodePoints)) });
    }
  }

  // 同一领域内同一导出身份被多次声明也是歧义：解析时无法确定用哪一条约束。
  for (const contract of contracts) {
    const seen = new Map<string, number>();
    for (const identity of [...contract.exportedDefKinds, ...contract.exportedSemanticFamilies]) {
      seen.set(identity, (seen.get(identity) ?? 0) + 1);
    }
    for (const [identity, count] of seen) {
      if (count > 1) {
        problems.push({
          kind: 'conflicting-export',
          domain: contract.domain,
          identity,
          providerIds: Object.freeze([contract.providerId]),
        });
      }
    }
  }

  return Object.freeze(problems);
}

function computeCatalogFingerprint(
  gateway: StableFingerprintGateway,
  contracts: readonly IntegrationContract[],
): string {
  const entries = contracts.map((contract) =>
    [
      contract.domain,
      contract.providerId,
      contract.version,
      [...contract.exportedDefKinds].sort(compareCodePoints).join(','),
      [...contract.exportedSemanticFamilies].sort(compareCodePoints).join(','),
      contract.referenceConstraintsFingerprint,
    ].join('\u0001'),
  );
  return gateway.fingerprintText(
    encodeFingerprintPayload('ugc.integration-contracts.v1', [{ label: 'contracts', value: entries.join('\u0002') }]),
  );
}

export interface CatalogDeps {
  readonly fingerprint: StableFingerprintGateway;
  readonly factory: UGCDiagnosticFactory;
}

/**
 * 构建目录。缺失的领域**不是错误**——目录可以只汇合了一部分领域；
 * 错误发生在候选真正**依赖**某个未汇合领域时（`resolve`/`resolveExport` 返回失败关闭）。
 */
export function createIntegrationContractCatalog(
  deps: CatalogDeps,
  contracts: readonly IntegrationContract[],
): UgcResult<IntegrationContractCatalog> {
  const problems = inspectContracts(contracts);
  if (problems.length > 0) {
    return ugcReject(
      problems.map((problem) =>
        deps.factory.changeSet({
          selector:
            problem.kind === 'empty-identity'
              ? { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' }
              : { category: 'IDENTITY_CONFLICT', condition: 'provider-identity-conflict' },
          stage: STAGE,
          sourcePackage: problem.domain,
          sourceSpan: null,
          jsonPath: null,
          message: `Integration contract catalog is invalid: ${problem.kind} in ${problem.domain}.`,
          reason: describeProblem(problem),
          correctionSuggestion:
            '请让该领域只声明一个提供方、且每个导出身份只声明一次；标识必须是非空且无前后空白的字符串。',
          actual: problem.kind,
        }),
      ),
    );
  }

  const ordered = Object.freeze([...contracts].sort(compareContracts));
  const fingerprint = computeCatalogFingerprint(deps.fingerprint, ordered);
  const snapshot: IntegrationContractSnapshot = Object.freeze({
    catalogVersion: `icat-${fingerprint}`,
    contracts: ordered,
    fingerprint,
  });

  const byDomain = new Map<IntegrationDomain, IntegrationContract>();
  for (const contract of ordered) byDomain.set(contract.domain, contract);

  const unresolved = (domain: IntegrationDomain, sourcePackage: string, detail: string, capability: string | null) =>
    ugcReject([
      deps.factory.changeSet({
        selector: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
        stage: STAGE,
        sourcePackage,
        sourceSpan: null,
        jsonPath: null,
        message: `Integration contract for ${domain} cannot satisfy the dependency.`,
        reason: detail,
        correctionSuggestion:
          '这不是候选内容的问题：请等待该领域导出对应能力并登记契约后，针对新基线重新完整验证候选。',
        expected: capability ?? `${domain} contract`,
        actual: 'unresolved',
        messageArgs: { domain, capability },
      }),
    ]);

  return ugcOk(
    Object.freeze({
      snapshot: () => snapshot,
      resolve(domain: IntegrationDomain, sourcePackage: string): UgcResult<IntegrationContract> {
        const contract = byDomain.get(domain);
        if (contract === undefined) {
          return unresolved(domain, sourcePackage, `领域 ${domain} 的集成契约尚未汇合登记。`, null);
        }
        return ugcOk(contract);
      },
      resolveExport(
        domain: IntegrationDomain,
        identity: string,
        sourcePackage: string,
      ): UgcResult<ResolvedContractExport> {
        const contract = byDomain.get(domain);
        if (contract === undefined) {
          return unresolved(domain, sourcePackage, `领域 ${domain} 的集成契约尚未汇合登记。`, identity);
        }
        const exportKind: ContractExportKind | null = contract.exportedDefKinds.includes(identity)
          ? 'def-kind'
          : contract.exportedSemanticFamilies.includes(identity)
            ? 'semantic-family'
            : null;
        if (exportKind === null) {
          return unresolved(
            domain,
            sourcePackage,
            `提供方 ${contract.providerId}（版本 ${contract.version}）没有导出能力 ${JSON.stringify(identity)}。`,
            identity,
          );
        }
        return ugcOk(
          Object.freeze({
            domain,
            providerId: contract.providerId,
            version: contract.version,
            exportKind,
            identity,
            sourceRecords: contract.sourceRecords,
          }),
        );
      },
    }),
  );
}

function describeProblem(problem: CatalogProblem): string {
  if (problem.kind === 'duplicate-provider') {
    return `领域 ${problem.domain} 被多个提供方同时声明（${problem.providerIds.join('、')}），无法确定权威契约。`;
  }
  if (problem.kind === 'conflicting-export') {
    return `领域 ${problem.domain} 的导出身份 ${JSON.stringify(problem.identity)} 被重复声明，解析时无法确定使用哪一条约束。`;
  }
  return `领域 ${problem.domain} 的契约字段 ${problem.detail} 不是合法的非空标识。`;
}

/** 全部已知领域，供追踪与测试枚举使用。 */
export const ALL_INTEGRATION_DOMAINS = INTEGRATION_DOMAINS;
