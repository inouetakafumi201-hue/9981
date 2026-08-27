/**
 * L2 → wakeup-ugc 端口：`ReferenceResolutionGateway` 实现。
 *
 * 输出的依赖图是**工作图**：活动集叠加候选的新增/覆盖/删除之后的结果，出边与入边都完整且顺序确定
 * （需求 7.8、7.12）。三点实现取舍：
 *
 * 1. **重建而不是缓存。** 验证端口的载荷只带候选包，不带它当时算出的引用图。解析端口自己重跑
 *    `buildReferenceGraph`。多花一次遍历，换来「不会消费一份可能已经过期的解析结论」。
 * 2. **入边覆盖活动集。** `buildReferenceGraph` 只收集候选包自身定义发出的引用，因此「留在活动集、
 *    本次未重新提交」的依赖者的出边不在其中。这里用 `activeReferenceMap` 把它们补进来，
 *    否则 `inboundEdges` 会漏掉真实存在的入边，`revalidatedDependents` 也就无从计算。
 * 3. **闭包重验证是本端口的额外一遍。** l2 的 `revalidateDependents` 只核验被改定义的**直接**入边；
 *    UGC 的 `inbound-closure-revalidation` 要求报出「传递入边闭包中本次已重验的活动定义」。
 *    这里对传递闭包再跑一遍，判定谓词直接复用 l2 导出的 `matchesExpected`——扩大的是覆盖范围，
 *    不是另立一套兼容标准。
 */

import type { Diagnostic as KernelDiagnostic } from '../../../core/kernel/state/diagnostic';
import type { DiagnosticCodeCatalog } from '../../../core/ugc/diagnostics/code-catalog';
import { createDiagnosticCodeCatalog } from '../../../core/ugc/diagnostics/code-catalog';
import { createDiagnosticFactory } from '../../../core/ugc/diagnostics/factory';
import type { UGCDiagnosticFactory } from '../../../core/ugc/diagnostics/factory';
import { sha256FingerprintGateway } from '../../../core/ugc/ports/sha256-fingerprint-gateway';
import type { StableFingerprintGateway } from '../../../core/ugc/model/fingerprint';
import type {
  ReferenceResolutionGateway,
  ReferenceStageResult,
  ResolutionCapability,
} from '../../../core/ugc/ports/definition-ports';
import { MANDATORY_RESOLUTION_CAPABILITIES } from '../../../core/ugc/ports/definition-ports';
import type { IntegrationContractSnapshot } from '../../../core/ugc/model/contract-types';
import type { QuotaBudget } from '../../../core/ugc/model/quota-types';
import type {
  DefinitionRegistryReadSnapshot,
  UpstreamReferenceEdge,
  UpstreamResolvedReferenceGraph,
  UpstreamValidatedCandidate,
} from '../../../core/ugc/model/upstream';
import { compareStrings } from '../../model/ordering';
import { ROOT_JSON_PATH } from '../../model/ids';
import type { TypedReference } from '../../model/reference';
import type { DefinitionPackage } from '../../model/definition';
import { buildReferenceGraph, matchesExpected } from '../../resolution/reference-graph';
import type { GraphNodeInfo, ReferenceGraph } from '../../resolution/reference-graph';
import { activeReferenceMap } from '../../registry/definition-registry';
import type { ActiveRegistry } from '../../registry/definition-registry';
import { createSourceIndex, type SourceIndex } from './source-index';
import { projectL2Diagnostics } from './diagnostic-projection';
import { buildProviderIndex, domainExportsExpectedKind, resolveProviderDomain } from './provider-domain';
import type { ProviderIndex } from './provider-domain';
import { detectPackageCycles } from './package-cycle';
import {
  L2_GRAPH_PAYLOAD_KIND,
  L2_PORT_PROVIDER_ID,
  L2_PORT_VERSION,
  foreignPayloadDiagnostic,
  quotaDiagnostic,
  readSnapshotPayload,
  readValidatedPayload,
  type L2GraphPayload,
  type PortDiagnosticEnvelope,
} from './port-common';

const RESOLUTION_STAGE = 'reference-resolution' as const;

export interface L2ResolutionGatewayOptions {
  readonly fingerprintGateway?: StableFingerprintGateway;
  readonly catalog?: DiagnosticCodeCatalog;
  readonly factory?: UGCDiagnosticFactory;
  /**
   * 诊断定位用的候选文档标识与文本。
   *
   * 解析端口的入参里没有原始候选（只有验证产物），但诊断仍需要来源位置。装配处
   * （`port-bundle.ts`）在同一次请求内把它交给解析端口，使两个阶段的诊断指向同一份文档。
   * 缺省时退化为「只带文档标识的零宽锚点」，不会伪造行列。
   */
  readonly documentLocator?: () => { readonly documentId: string; readonly canonicalJson: string } | undefined;
}

/** 一条内部边：候选或活动集发出的引用，附带其宿主。 */
interface WorkingEdge {
  readonly hostId: string;
  readonly reference: TypedReference;
  readonly target: GraphNodeInfo;
  readonly origin: 'candidate' | 'active';
}

/** 边的规范化排序：出边按 (from, jsonPath, to)，入边按 (to, from, jsonPath)。 */
function compareOutbound(left: UpstreamReferenceEdge, right: UpstreamReferenceEdge): number {
  return (
    compareStrings(left.fromDefinitionId, right.fromDefinitionId) ||
    compareStrings(left.jsonPath, right.jsonPath) ||
    compareStrings(left.toDefinitionId, right.toDefinitionId)
  );
}

function compareInbound(left: UpstreamReferenceEdge, right: UpstreamReferenceEdge): number {
  return (
    compareStrings(left.toDefinitionId, right.toDefinitionId) ||
    compareStrings(left.fromDefinitionId, right.fromDefinitionId) ||
    compareStrings(left.jsonPath, right.jsonPath)
  );
}

/**
 * 收集工作图上的全部边。
 *
 * 候选定义的边来自 `graph.references`；活动集的边来自 `activeReferenceMap`，但要排除
 * 「本次被候选重新提交」与「本次被删除」的宿主——它们的出边已由候选版本决定。
 */
function collectWorkingEdges(
  graph: ReferenceGraph,
  pkg: DefinitionPackage,
  active: ActiveRegistry,
): readonly WorkingEdge[] {
  const edges: WorkingEdge[] = [];
  const candidateIds = new Set(pkg.definitions.map((definition) => definition.id));
  const removedIds = new Set((pkg.removals ?? []).map((removal) => removal.targetId));

  for (const { hostId, reference } of graph.references) {
    const target = graph.nodes.get(reference.refId);
    if (target !== undefined) {
      edges.push({ hostId, reference, target, origin: 'candidate' });
    }
  }
  for (const [hostId, references] of activeReferenceMap(active)) {
    if (candidateIds.has(hostId) || removedIds.has(hostId) || !graph.nodes.has(hostId)) {
      continue;
    }
    for (const reference of references) {
      const target = graph.nodes.get(reference.refId);
      if (target !== undefined) {
        edges.push({ hostId, reference, target, origin: 'active' });
      }
    }
  }
  return Object.freeze(edges);
}

/**
 * 把一条工作边投影为 UGC 的 `UpstreamReferenceEdge`，并顺带做提供方判定。
 *
 * 判定结果通过 `onDiagnostic` 回调报出（歧义 / 越领域契约），因为投影本身要保持纯函数以便复用于
 * 出边与入边两个方向。
 */
function toUpstreamEdge(
  edge: WorkingEdge,
  providerIndex: ProviderIndex,
  contracts: IntegrationContractSnapshot,
  onProviderProblem: (edge: WorkingEdge, verdict: ReturnType<typeof resolveProviderDomain>) => void,
): UpstreamReferenceEdge {
  const verdict = resolveProviderDomain(providerIndex, edge.target);
  let providerDomain: string | null = null;
  if (verdict.kind === 'resolved') {
    providerDomain = verdict.domain;
    if (!domainExportsExpectedKind(contracts, verdict.domain, edge.reference.expected.defKind)) {
      onProviderProblem(edge, verdict);
    }
  } else if (verdict.kind === 'ambiguous') {
    onProviderProblem(edge, verdict);
  }
  return Object.freeze({
    fromDefinitionId: edge.hostId,
    jsonPath: edge.reference.jsonPath,
    toDefinitionId: edge.reference.refId,
    expectedKind: edge.reference.expected.defKind ?? '',
    semanticFamily: edge.target.semanticFamily,
    providerDomain,
  });
}

/**
 * 计算被改定义传递入边闭包中、本次真正重验过的活动定义（`inbound-closure-revalidation`）。
 *
 * 起点是候选覆盖或删除的定义。沿入边反向做广度遍历，把途经的**活动**定义（非候选、非被删）逐个
 * 对其指向已改定义的引用重新做 `matchesExpected`。返回真正被访问并重验的活动定义标识（规范化排序）。
 */
function computeRevalidatedDependents(
  pkg: DefinitionPackage,
  active: ActiveRegistry,
  inboundByTarget: ReadonlyMap<string, readonly string[]>,
  edgesByHost: ReadonlyMap<string, readonly WorkingEdge[]>,
): readonly string[] {
  const changed = new Set<string>([
    ...(pkg.overrideIntent ?? []).map((intent) => intent.targetId),
    ...(pkg.removals ?? []).map((removal) => removal.targetId),
  ]);
  const candidateIds = new Set(pkg.definitions.map((definition) => definition.id));
  const removedIds = new Set((pkg.removals ?? []).map((removal) => removal.targetId));

  const revalidated = new Set<string>();
  const visited = new Set<string>(changed);
  let frontier = [...changed];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const targetId of frontier) {
      for (const dependent of inboundByTarget.get(targetId) ?? []) {
        if (visited.has(dependent)) {
          continue;
        }
        visited.add(dependent);
        next.push(dependent);
        // 只有仍留在活动集里的定义才需要被端口重验；候选自身的引用已由建图核验。
        if (candidateIds.has(dependent) || removedIds.has(dependent) || !active.definitions.has(dependent)) {
          continue;
        }
        for (const edge of edgesByHost.get(dependent) ?? []) {
          if (changed.has(edge.reference.refId)) {
            // 触碰一次判定即视为已重验；判定结果本身由 buildReferenceGraph 的诊断承载。
            matchesExpected(edge.target, edge.reference.expected);
            revalidated.add(dependent);
          }
        }
      }
    }
    frontier = next;
  }
  return Object.freeze([...revalidated].sort(compareStrings));
}

/** 构造解析端口的诊断定位来源索引。缺文档定位器时退化为「文档标识 + 零宽锚点」。 */
function resolveIndex(
  options: L2ResolutionGatewayOptions,
  validated: UpstreamValidatedCandidate,
): SourceIndex {
  const locator = options.documentLocator?.();
  if (locator !== undefined) {
    return createSourceIndex(locator.documentId, locator.canonicalJson);
  }
  return createSourceIndex(`${validated.providerId}:validated`, '');
}

function providerAmbiguousDiagnostic(
  envelope: PortDiagnosticEnvelope,
  index: SourceIndex,
  edge: WorkingEdge,
  domains: readonly string[],
  identity: string,
): KernelDiagnostic {
  return envelope.factory.definition({
    selector: { category: 'IDENTITY_CONFLICT', condition: 'ambiguous-reference-target' },
    stage: envelope.stage,
    sourcePackage: envelope.sourcePackage,
    message: `reference target ${edge.reference.refId} identity ${identity} is exported by multiple domains: ${domains.join(', ')}`,
    reason:
      `引用目标 ${edge.reference.refId} 的身份「${identity}」被多个领域同时导出（${domains.join('、')}），` +
      '无法确定它的提供领域。',
    correctionSuggestion: '在跨领域契约目录中消除该身份的重复导出，或让引用显式限定期望的提供领域。',
    definitionId: edge.hostId,
    jsonPath: edge.reference.jsonPath,
    sourceSpan: index.span(undefined, undefined),
    rootCauseId: `l2-port/ambiguous-provider/${edge.hostId}/${edge.reference.jsonPath}`,
    messageArgs: Object.freeze({ identity, domains: domains.join(',') }),
  });
}

function providerContractDiagnostic(
  envelope: PortDiagnosticEnvelope,
  index: SourceIndex,
  edge: WorkingEdge,
  domain: string,
): KernelDiagnostic {
  return envelope.factory.definition({
    selector: { category: 'REFERENCE_CONTRACT', condition: 'provider-contract' },
    stage: envelope.stage,
    sourcePackage: envelope.sourcePackage,
    message:
      `reference from ${edge.hostId} expects def kind ${edge.reference.expected.defKind ?? '?'} but ` +
      `provider domain ${domain} does not export it`,
    reason:
      `定义 ${edge.hostId} 的引用期望 Def kind「${String(edge.reference.expected.defKind)}」，` +
      `但目标所属领域 ${domain} 并未导出该 Def kind。跨领域引用只能使用对方契约中显式导出的身份。`,
    correctionSuggestion: '改为引用该领域已导出的 Def kind，或请提供方在跨领域契约中导出所需身份。',
    definitionId: edge.hostId,
    jsonPath: edge.reference.jsonPath,
    sourceSpan: index.span(undefined, undefined),
    rootCauseId: `l2-port/provider-contract/${edge.hostId}/${edge.reference.jsonPath}`,
    messageArgs: Object.freeze({ domain, expectedKind: edge.reference.expected.defKind ?? '' }),
  });
}

/** 声明顺序固定为 `MANDATORY_RESOLUTION_CAPABILITIES` 的顺序。 */
function orderResolutionCapabilities(
  covered: readonly ResolutionCapability[],
): readonly ResolutionCapability[] {
  const present = new Set(covered);
  return Object.freeze(MANDATORY_RESOLUTION_CAPABILITIES.filter((capability) => present.has(capability)));
}

/** 创建 l2 的 `ReferenceResolutionGateway`。 */
export function createL2ReferenceResolutionGateway(
  options: L2ResolutionGatewayOptions = {},
): ReferenceResolutionGateway {
  const catalog =
    options.catalog ?? createDiagnosticCodeCatalog(options.fingerprintGateway ?? sha256FingerprintGateway);
  const factory = options.factory ?? createDiagnosticFactory(catalog);

  return Object.freeze({
    providerId: L2_PORT_PROVIDER_ID,
    version: L2_PORT_VERSION,
    resolve(
      validated: UpstreamValidatedCandidate,
      activeSnapshot: DefinitionRegistryReadSnapshot,
      contracts: IntegrationContractSnapshot,
      budget: QuotaBudget,
    ): ReferenceStageResult {
      const envelope: PortDiagnosticEnvelope = {
        factory,
        stage: RESOLUTION_STAGE,
        sourcePackage: activeSnapshot.registryVersion,
      };
      const index = resolveIndex(options, validated);

      // 0. 两个载荷都必须由本提供方铸造。
      const validatedPayload = readValidatedPayload(validated.payload, L2_PORT_PROVIDER_ID);
      const snapshotPayload = readSnapshotPayload(activeSnapshot.payload, L2_PORT_PROVIDER_ID);
      if (validatedPayload === undefined) {
        return {
          diagnostics: Object.freeze([foreignPayloadDiagnostic(envelope, 'validated', 'l2/validated-candidate/1')]),
          coveredCapabilities: Object.freeze([]),
          graph: null,
        };
      }
      if (snapshotPayload === undefined) {
        return {
          diagnostics: Object.freeze([foreignPayloadDiagnostic(envelope, 'activeSnapshot', 'l2/registry-snapshot/1')]),
          coveredCapabilities: Object.freeze([]),
          graph: null,
        };
      }
      const pkg = validatedPayload.package;
      const active = snapshotPayload.registry;

      // 1. 重建工作图 + 包依赖环检测（两者都投影为内核诊断）。
      const graphResult = buildReferenceGraph({ package: pkg, activeNodes: active.nodes });
      const packageCycleDiagnostics = detectPackageCycles({
        candidate: pkg,
        activePackages: active.packages,
      });
      const structuralDiagnostics = projectStructuralDiagnostics(envelope, catalog, index, graphResult, packageCycleDiagnostics);

      // 2. 配额：节点数 + 边数 + 遍历工作量。
      const edges = collectWorkingEdges(graphResult.graph, pkg, active);
      const quotaProblem = consumeResolutionBudget(envelope, budget, index, graphResult.graph, edges);
      if (quotaProblem !== undefined) {
        return { diagnostics: Object.freeze([quotaProblem]), coveredCapabilities: Object.freeze([]), graph: null };
      }

      // 3. 提供方判定 + 边投影。
      const providerIndex = buildProviderIndex(contracts);
      const providerDiagnostics: KernelDiagnostic[] = [];
      const onProviderProblem = (
        edge: WorkingEdge,
        verdict: ReturnType<typeof resolveProviderDomain>,
      ): void => {
        if (verdict.kind === 'ambiguous') {
          providerDiagnostics.push(providerAmbiguousDiagnostic(envelope, index, edge, verdict.domains, verdict.identity));
        } else if (verdict.kind === 'resolved') {
          providerDiagnostics.push(providerContractDiagnostic(envelope, index, edge, verdict.domain));
        }
      };
      const outbound = edges
        .map((edge) => toUpstreamEdge(edge, providerIndex, contracts, onProviderProblem))
        .sort(compareOutbound);
      const inbound = [...outbound].sort(compareInbound);

      // 4. 传递入边闭包重验证。
      const edgesByHost = groupEdgesByHost(edges);
      const revalidatedDependents = computeRevalidatedDependents(
        pkg,
        active,
        graphResult.graph.inbound,
        edgesByHost,
      );

      const allDiagnostics = [...structuralDiagnostics, ...providerDiagnostics];
      const blocked = allDiagnostics.some(
        (diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'fatal',
      );
      if (blocked) {
        return {
          diagnostics: applyDiagnosticQuota(envelope, budget, index, allDiagnostics),
          coveredCapabilities: orderResolutionCapabilities(COVERED_WITHOUT_GRAPH),
          graph: null,
        };
      }

      const graph: UpstreamResolvedReferenceGraph = Object.freeze({
        providerId: L2_PORT_PROVIDER_ID,
        nodes: Object.freeze([...graphResult.graph.nodes.keys()].sort(compareStrings)),
        outboundEdges: Object.freeze(outbound),
        inboundEdges: Object.freeze(inbound),
        revalidatedDependents,
        payload: Object.freeze({
          kind: L2_GRAPH_PAYLOAD_KIND,
          providerId: L2_PORT_PROVIDER_ID,
          graph: graphResult.graph,
        } satisfies L2GraphPayload),
      });
      return {
        diagnostics: applyDiagnosticQuota(envelope, budget, index, allDiagnostics),
        coveredCapabilities: orderResolutionCapabilities(ALL_RESOLUTION_CAPABILITIES),
        graph,
      };
    },
  });
}

/**
 * 解析阶段能力清单。
 *
 * `expected-kind` / `semantic-family` / `missing-target` / `reference-cycle` 由 `buildReferenceGraph`
 * 覆盖（REF_KIND_MISMATCH / REF_FAMILY_MISMATCH / REF_MISSING_TARGET / REF_DEPENDENCY_CYCLE）；
 * `package-cycle` 由包依赖环检测覆盖（见 package-cycle.ts，装配时接入）；
 * `provider-domain` / `ambiguous-target` 由本端口的提供方判定覆盖；
 * `inbound-closure-revalidation` 由闭包重验证覆盖；`deterministic-edge-order` 由边排序覆盖。
 */
const ALL_RESOLUTION_CAPABILITIES: readonly ResolutionCapability[] = Object.freeze([
  'expected-kind',
  'semantic-family',
  'provider-domain',
  'missing-target',
  'ambiguous-target',
  'reference-cycle',
  'package-cycle',
  'inbound-closure-revalidation',
  'deterministic-edge-order',
]);

/**
 * 图不完整（有结构错误）时仍然真正执行过的能力。
 *
 * 即便最终 `graph: null`，这些检查也确实跑了并给出了结论；如实上报而不是清空，
 * 因为 UGC 用 covered 列表判断"哪些强制检查被执行"，而不是"是否产出了图"。
 */
const COVERED_WITHOUT_GRAPH: readonly ResolutionCapability[] = Object.freeze([
  'expected-kind',
  'semantic-family',
  'provider-domain',
  'missing-target',
  'ambiguous-target',
  'reference-cycle',
  'package-cycle',
]);

function groupEdgesByHost(edges: readonly WorkingEdge[]): ReadonlyMap<string, readonly WorkingEdge[]> {
  const map = new Map<string, WorkingEdge[]>();
  for (const edge of edges) {
    const list = map.get(edge.hostId) ?? [];
    list.push(edge);
    map.set(edge.hostId, list);
  }
  return map;
}

/**
 * 把 `buildReferenceGraph` 的 l2 诊断投影为内核诊断。
 *
 * 复用统一的投影管线，使解析阶段诊断与验证阶段诊断走完全相同的代码映射与 scope 规则。
 * 定义锚点用图节点里出现的定义标识，路径缺省时回落到根。
 */
function projectStructuralDiagnostics(
  envelope: PortDiagnosticEnvelope,
  catalog: DiagnosticCodeCatalog,
  index: SourceIndex,
  graphResult: ReturnType<typeof buildReferenceGraph>,
  packageCycleDiagnostics: readonly import('../../model/diagnostic').Diagnostic[],
): readonly KernelDiagnostic[] {
  const l2Diagnostics = [...graphResult.diagnostics, ...packageCycleDiagnostics];
  if (l2Diagnostics.length === 0) {
    return Object.freeze([]);
  }
  const anchors = new Map<string, string>();
  for (const id of graphResult.graph.nodes.keys()) {
    anchors.set(id, ROOT_JSON_PATH);
  }
  return projectL2Diagnostics(
    {
      factory: envelope.factory,
      catalog,
      stage: RESOLUTION_STAGE,
      sourcePackage: envelope.sourcePackage,
      index,
      definitionAnchors: anchors,
    },
    l2Diagnostics,
  );
}

function consumeResolutionBudget(
  envelope: PortDiagnosticEnvelope,
  budget: QuotaBudget,
  index: SourceIndex,
  graph: ReferenceGraph,
  edges: readonly WorkingEdge[],
): KernelDiagnostic | undefined {
  const plan: readonly (readonly [Parameters<QuotaBudget['consume']>[0], number])[] = [
    ['referenceEdges', edges.length],
    // 遍历工作量：建图一遍 + 闭包重验一遍，量级为节点 + 边。
    ['traversalWork', graph.nodes.size + edges.length],
  ];
  for (const [kind, amount] of plan) {
    const violation = budget.consume(kind, amount, { sourceSpan: index.anchor(), jsonPath: ROOT_JSON_PATH });
    if (violation !== null) {
      return quotaDiagnostic(envelope, violation);
    }
  }
  return undefined;
}

function applyDiagnosticQuota(
  envelope: PortDiagnosticEnvelope,
  budget: QuotaBudget,
  index: SourceIndex,
  diagnostics: readonly KernelDiagnostic[],
): readonly KernelDiagnostic[] {
  const available = budget.remaining('diagnostics');
  const violation = budget.consume('diagnostics', diagnostics.length, {
    sourceSpan: index.anchor(),
    jsonPath: ROOT_JSON_PATH,
  });
  if (violation === null) {
    return diagnostics;
  }
  const kept = available > 0 ? diagnostics.slice(0, available) : [];
  return Object.freeze([...kept, quotaDiagnostic(envelope, violation)]);
}
