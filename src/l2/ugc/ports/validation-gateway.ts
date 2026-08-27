/**
 * L2 → wakeup-ugc 端口：`DefinitionValidationGateway` 实现。
 *
 * 职责边界：本端口**不新增验证规则**。它做四件端口边界该做的事：
 * 1. 把封存的规范化请求映射为 l2 候选包（`package-mapping.ts`），并核对覆盖/删除授权；
 * 2. 补上 l2 解码器结构性缺失的封闭 Schema 检查（`closed-schema.ts`）；
 * 3. 用与 `registry/definition-registry.ts#activate` **完全相同**的输入调用 `validateFullPackage`，
 *    保证「端口验证通过」与「注册表激活通过」不会出现两套判定；
 * 4. 把 l2 诊断投影为内核诊断，并**如实**声明本次真正执行了哪些强制能力。
 *
 * 关于能力声明的诚实性：`coveredCapabilities` 只列出本次调用真正跑过的能力。提前退出
 * （层归属不符、配额超限、封闭 Schema 检查无法给出结论）时列表会变短，UGC 会因此失败关闭——
 * 而这些路径本身都已经带着错误级诊断返回 `validated: null`，所以不存在「因少报能力而放行」的口子，
 * 也不存在「为了让 UGC 放行而虚报能力」的动机。
 */

import type { Diagnostic as KernelDiagnostic } from '../../../core/kernel/state/diagnostic';
import type { DiagnosticCodeCatalog } from '../../../core/ugc/diagnostics/code-catalog';
import { createDiagnosticCodeCatalog } from '../../../core/ugc/diagnostics/code-catalog';
import { createDiagnosticFactory } from '../../../core/ugc/diagnostics/factory';
import type { UGCDiagnosticFactory } from '../../../core/ugc/diagnostics/factory';
import { sha256FingerprintGateway } from '../../../core/ugc/ports/sha256-fingerprint-gateway';
import type { StableFingerprintGateway } from '../../../core/ugc/model/fingerprint';
import type {
  DefinitionValidationContext,
  DefinitionValidationGateway,
  ValidationCapability,
  ValidationStageResult,
} from '../../../core/ugc/ports/definition-ports';
import { MANDATORY_VALIDATION_CAPABILITIES } from '../../../core/ugc/ports/definition-ports';
import type { CanonicalizedChangeRequest } from '../../../core/ugc/model/canonical-types';
import type { QuotaBudget } from '../../../core/ugc/model/quota-types';
import type { UpstreamValidatedCandidate } from '../../../core/ugc/model/upstream';
import { compareStrings } from '../../model/ordering';
import { joinJsonPath, ROOT_JSON_PATH } from '../../model/ids';
import type { DefinitionPackage } from '../../model/definition';
import { validateFullPackage } from '../../validation/package-validation';
import { DEFINITION_RULES } from '../../validation/validator';
import { activeReferenceMap, emptyRegistry } from '../../registry/definition-registry';
import type { ActiveRegistry } from '../../registry/definition-registry';
import { createSourceIndex, type SourceIndex } from './source-index';
import { projectL2Diagnostics, type DiagnosticProjectionContext } from './diagnostic-projection';
import { definitionAnchorsOf, mapCandidatePackage } from './package-mapping';
import { scanUnknownMembers } from './closed-schema';
import {
  L2_PORT_PROVIDER_ID,
  L2_PORT_VERSION,
  L2_VALIDATED_PAYLOAD_KIND,
  foreignPayloadDiagnostic,
  quotaDiagnostic,
  readSnapshotPayload,
  type L2ValidatedPayload,
  type PortDiagnosticEnvelope,
} from './port-common';

const VALIDATION_STAGE = 'definition-validation' as const;

/**
 * 由 `validateFullPackage` 一次调用覆盖的强制能力。
 *
 * 逐条对应关系（审查时可直接核对 l2 规则源码）：
 * - `required-and-type`        → codec/decode.ts 的 requireXxx 与 optionalXxx 取值器（缺失与损坏严格区分，不补造）
 * - `semantic-field-strictness`→ 同上：JSON_SEMANTIC_FIELD_MISSING / _DAMAGED，无静默强转
 * - `def-kind-registry`        → validation/classification-rules.ts#validateDefKind
 * - `identifier-uniqueness`    → validation/validator.ts#validatePackageShape（DEF_DUPLICATE_IDENTIFIER）
 * - `abstract-instantiation`   → classification-rules.ts#validateAbstractInstantiation + REF_ABSTRACT_TARGET
 * - `layer-ownership`          → classification-rules.ts（LAYER_L1_* / LAYER_L3_*）+ 本端口的目标层核对
 * - `numeric-classification`   → validation/parameter-rules.ts（SCHEMA_FIELD_MISSING_CLASSIFICATION 等）
 * - `gameplay-value-range`     → parameter-rules.ts（SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE）
 * - `cross-field-constraint`   → parameter-rules.ts（SCHEMA_CROSS_FIELD_CONSTRAINT_UNRESOLVED）
 * - `inheritance-cycle`        → validation/inheritance-composition-rules.ts（INHERIT_CYCLE）
 * - `composition-conflict`     → 同上（COMPOSE_* / INHERIT_FIELD_CONFLICT_WITHOUT_RULE）
 * - `order-declaration`        → 同上（COMPOSE_ORDER_DEPENDENCY_UNDECLARED）
 * - `error-aggregation`        → package-validation.ts 汇总四阶段诊断后统一 canonicalSort
 */
const PIPELINE_CAPABILITIES: readonly ValidationCapability[] = Object.freeze([
  'required-and-type',
  'semantic-field-strictness',
  'def-kind-registry',
  'identifier-uniqueness',
  'abstract-instantiation',
  'layer-ownership',
  'numeric-classification',
  'gameplay-value-range',
  'cross-field-constraint',
  'inheritance-cycle',
  'composition-conflict',
  'order-declaration',
  'error-aggregation',
]);

/** 由本端口的覆盖授权核对提供。 */
const AUTHORIZATION_CAPABILITIES: readonly ValidationCapability[] = Object.freeze(['authorized-override']);

/** 由本端口的封闭 Schema 扫描提供；两者同源，因此同时给出或同时缺席。 */
const CLOSED_SCHEMA_CAPABILITIES: readonly ValidationCapability[] = Object.freeze([
  'closed-schema',
  'open-property-map',
]);

/** 声明顺序固定为 `MANDATORY_VALIDATION_CAPABILITIES` 的顺序，使输出确定。 */
function orderCapabilities(covered: readonly ValidationCapability[]): readonly ValidationCapability[] {
  const present = new Set(covered);
  return Object.freeze(MANDATORY_VALIDATION_CAPABILITIES.filter((capability) => present.has(capability)));
}

export interface L2ValidationGatewayOptions {
  /** 指纹网关，用于构造 UGC 诊断代码目录。默认用 UGC 导出的 SHA-256 网关。 */
  readonly fingerprintGateway?: StableFingerprintGateway;
  /** 复用已有目录/工厂（三个端口共享同一份，避免各自派生出不同的目录版本）。 */
  readonly catalog?: DiagnosticCodeCatalog;
  readonly factory?: UGCDiagnosticFactory;
}

/** 从 JSON path 反查所属定义标识；不在 `/definitions/{index}` 之下时返回 undefined。 */
function definitionIdForPath(pkg: DefinitionPackage, jsonPath: string): string | undefined {
  const segments = jsonPath.split('/');
  // 形如 ['', 'definitions', '3', ...]
  if (segments.length < 3 || segments[1] !== 'definitions') {
    return undefined;
  }
  const index = Number(segments[2]);
  if (!Number.isInteger(index) || index < 0) {
    return undefined;
  }
  return pkg.definitions[index]?.id;
}

/** 未声明成员 → 内核诊断。有定义归属时用 definition scope，否则用 change-set scope。 */
function unknownMemberDiagnostics(
  envelope: PortDiagnosticEnvelope,
  index: SourceIndex,
  pkg: DefinitionPackage,
  members: readonly { readonly containerPath: string; readonly key: string; readonly jsonPath: string }[],
): readonly KernelDiagnostic[] {
  return members.map((member) => {
    const common = {
      selector: { category: 'SCHEMA_CONTRACT', condition: 'unknown-field' } as const,
      stage: envelope.stage,
      sourcePackage: envelope.sourcePackage,
      message: `unknown member ${member.key} at ${member.containerPath || '/'} is not declared by the base-layer schema`,
      reason:
        `成员 ${JSON.stringify(member.key)}（位于 ${member.containerPath || '/'}）不在基类层声明式 Schema 中。` +
        '封闭 Schema 不接受未声明字段：静默忽略它会让创作者以为该字段生效了。',
      correctionSuggestion:
        '删除该成员，或改用 Schema 中已声明的字段名；若确实需要新字段，须先在基类层 Schema 中声明。',
      rootCauseId: `l2-port/unknown-field${member.jsonPath}`,
      messageArgs: Object.freeze({ key: member.key, container: member.containerPath }),
      sourceSpan: index.anchor(),
    };
    const definitionId = definitionIdForPath(pkg, member.jsonPath);
    if (definitionId === undefined) {
      return envelope.factory.changeSet({ ...common, jsonPath: member.jsonPath });
    }
    return envelope.factory.definition({ ...common, definitionId, jsonPath: member.jsonPath });
  });
}

/**
 * 目标层核对（`layer-ownership` 能力在端口这一侧的部分）。
 *
 * 三处声明必须一致：候选自身声明的目标层、封存绑定里的目标层、被写入的注册表快照的目标层。
 * 任何不一致都表示这份变更被送到了错误的注册表，属于混层变更集（需求 1.4 / 14.4）。
 */
function checkTargetOwnership(
  envelope: PortDiagnosticEnvelope,
  index: SourceIndex,
  request: CanonicalizedChangeRequest,
  context: DefinitionValidationContext,
): readonly KernelDiagnostic[] {
  const candidateLayer = request.candidate.targetOwnership;
  const bindingLayer = request.binding.targetOwnership;
  const registryLayer = context.activeSnapshot.targetOwnership;
  if (candidateLayer === bindingLayer && bindingLayer === registryLayer) {
    return Object.freeze([]);
  }
  return Object.freeze([
    envelope.factory.changeSet({
      selector: { category: 'LAYER_L3_OWNERSHIP', condition: 'mixed-layer-change-set' },
      stage: envelope.stage,
      sourcePackage: envelope.sourcePackage,
      message:
        `target ownership mismatch: candidate=${candidateLayer}, binding=${bindingLayer}, ` +
        `registry=${registryLayer}`,
      reason:
        `目标层声明不一致：候选声明 ${candidateLayer}，变更请求绑定声明 ${bindingLayer}，` +
        `目标注册表是 ${registryLayer}。一个激活单元必须恰好属于一个目标层。`,
      correctionSuggestion: '把候选提交到与其目标层一致的注册表；不要在一个变更集里混合基类层与玩法层内容。',
      jsonPath: null,
      sourceSpan: index.anchor(),
      rootCauseId: 'l2-port/target-ownership-mismatch',
      messageArgs: Object.freeze({ candidateLayer, bindingLayer, registryLayer }),
    }),
  ]);
}

/** 配额消耗计划。全部在验证开始前一次性申报，超限即终止本次遍历（需求 9.x）。 */
function consumeValidationBudget(
  envelope: PortDiagnosticEnvelope,
  budget: QuotaBudget,
  index: SourceIndex,
  pkg: DefinitionPackage,
): readonly KernelDiagnostic[] {
  const sourceRecordCount =
    pkg.sourceRecords.length +
    pkg.definitions.reduce((total, definition) => total + definition.sourceRecords.length, 0);
  const plan: readonly (readonly [Parameters<QuotaBudget['consume']>[0], number])[] = [
    ['definitions', pkg.definitions.length],
    ['sourceRecords', sourceRecordCount],
    // 遍历工作量的诚实度量：每个定义都会被全部定义级规则各跑一次。
    ['traversalWork', pkg.definitions.length * DEFINITION_RULES.length],
  ];
  const diagnostics: KernelDiagnostic[] = [];
  for (const [kind, amount] of plan) {
    const violation = budget.consume(kind, amount, { sourceSpan: index.anchor(), jsonPath: ROOT_JSON_PATH });
    if (violation !== null) {
      diagnostics.push(quotaDiagnostic(envelope, violation));
      break;
    }
  }
  return Object.freeze(diagnostics);
}

/**
 * 按诊断配额裁剪输出。
 *
 * 超限时保留可容纳的前若干条并**只追加一条**终止性配额诊断——继续追加会让"诊断过多"本身
 * 变成新的对抗性放大面。裁剪前的顺序已由 l2 的 canonicalSort 固定，因此裁剪结果也是确定的。
 */
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

/** 创建 l2 的 `DefinitionValidationGateway`。 */
export function createL2DefinitionValidationGateway(
  options: L2ValidationGatewayOptions = {},
): DefinitionValidationGateway {
  const catalog =
    options.catalog ?? createDiagnosticCodeCatalog(options.fingerprintGateway ?? sha256FingerprintGateway);
  const factory = options.factory ?? createDiagnosticFactory(catalog);

  return Object.freeze({
    providerId: L2_PORT_PROVIDER_ID,
    version: L2_PORT_VERSION,
    validate(
      request: CanonicalizedChangeRequest,
      context: DefinitionValidationContext,
      budget: QuotaBudget,
    ): ValidationStageResult {
      const envelope: PortDiagnosticEnvelope = {
        factory,
        stage: VALIDATION_STAGE,
        sourcePackage: request.binding.sourcePackageId,
      };
      const index = createSourceIndex(request.candidate.source.documentId, request.candidate.canonicalJson);

      // 0. 活动快照必须由本提供方铸造，否则不消费。
      const snapshotPayload = readSnapshotPayload(context.activeSnapshot.payload, L2_PORT_PROVIDER_ID);
      if (snapshotPayload === undefined) {
        return {
          diagnostics: Object.freeze([
            foreignPayloadDiagnostic(envelope, 'activeSnapshot', 'l2/registry-snapshot/1'),
          ]),
          coveredCapabilities: Object.freeze([]),
          validated: null,
        };
      }
      const active: ActiveRegistry = snapshotPayload.registry;

      // 1. 目标层核对。不一致即停：把变更写进错误的注册表没有"部分正确"的可能。
      const layerProblems = checkTargetOwnership(envelope, index, request, context);
      if (layerProblems.length > 0) {
        return {
          diagnostics: applyDiagnosticQuota(envelope, budget, index, layerProblems),
          coveredCapabilities: Object.freeze([]),
          validated: null,
        };
      }

      // 2. 映射候选包 + 覆盖/删除授权核对。
      const activeDefinitionIds = new Set(active.definitions.keys());
      const mapping = mapCandidatePackage({
        request,
        activeDefinitionIds,
        factory,
        stage: VALIDATION_STAGE,
        index,
      });
      const anchorsForDiagnostics =
        mapping.package === null ? new Map<string, string>() : definitionAnchorsOf(mapping.package);
      const projection: DiagnosticProjectionContext = {
        factory,
        catalog,
        stage: VALIDATION_STAGE,
        sourcePackage: request.binding.sourcePackageId,
        index,
        definitionAnchors: anchorsForDiagnostics,
      };

      if (mapping.package === null) {
        const diagnostics = [
          ...mapping.portDiagnostics,
          ...projectL2Diagnostics(projection, mapping.l2Diagnostics),
        ];
        return {
          diagnostics: applyDiagnosticQuota(envelope, budget, index, diagnostics),
          // 解析/授权阶段就失败：真正跑过的只有覆盖授权核对本身。
          coveredCapabilities: orderCapabilities(AUTHORIZATION_CAPABILITIES),
          validated: null,
        };
      }
      const pkg = mapping.package;

      // 3. 配额。
      const quotaProblems = consumeValidationBudget(envelope, budget, index, pkg);
      if (quotaProblems.length > 0) {
        return {
          diagnostics: Object.freeze(quotaProblems),
          coveredCapabilities: orderCapabilities(AUTHORIZATION_CAPABILITIES),
          validated: null,
        };
      }

      // 4. 封闭 Schema 扫描。
      const closedSchema = scanUnknownMembers({
        canonicalJson: request.candidate.canonicalJson,
        sourceLocation: {
          sourceFile: request.candidate.source.documentId,
          section: request.candidate.source.sourceName,
        },
        ...(request.binding.sourcePackageId === undefined ? {} : { packageId: request.binding.sourcePackageId }),
      });
      const unknownDiagnostics = unknownMemberDiagnostics(envelope, index, pkg, closedSchema.unknownMembers);

      // 5. 全量验证。输入与 registry/definition-registry.ts#activate 完全一致。
      //    单调重定义（D-073）同 key 覆盖经 effectiveOverrides 折给依赖重验证，确保活动依赖不被破坏。
      const validation = validateFullPackage({
        package: pkg,
        activeNodes: active.nodes,
        activeInbound: active.inbound,
        activeFamilies: active.families,
        activeReferences: activeReferenceMap(active),
        effectiveOverrides: mapping.effectiveOverrides,
      });

      const projected = projectL2Diagnostics(projection, [
        ...mapping.l2Diagnostics,
        ...validation.diagnostics,
      ]);
      const allDiagnostics = [...mapping.portDiagnostics, ...unknownDiagnostics, ...projected];
      const capabilities = [
        ...PIPELINE_CAPABILITIES,
        ...AUTHORIZATION_CAPABILITIES,
        ...(closedSchema.conclusive ? CLOSED_SCHEMA_CAPABILITIES : []),
      ];

      const blocked =
        validation.hasError ||
        mapping.portDiagnostics.length > 0 ||
        unknownDiagnostics.length > 0 ||
        allDiagnostics.some((diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'fatal');

      if (blocked) {
        return {
          diagnostics: applyDiagnosticQuota(envelope, budget, index, allDiagnostics),
          coveredCapabilities: orderCapabilities(capabilities),
          validated: null,
        };
      }

      const validated: UpstreamValidatedCandidate = Object.freeze({
        providerId: L2_PORT_PROVIDER_ID,
        // 规范化排序而不是声明序：UGC 用它做计数与定位，稳定序必须与观察者无关。
        definitionIds: Object.freeze(pkg.definitions.map((definition) => definition.id).sort(compareStrings)),
        payload: Object.freeze({
          kind: L2_VALIDATED_PAYLOAD_KIND,
          providerId: L2_PORT_PROVIDER_ID,
          package: pkg,
          definitionAnchors: anchorsForDiagnostics,
        } satisfies L2ValidatedPayload),
      });

      return {
        diagnostics: applyDiagnosticQuota(envelope, budget, index, allDiagnostics),
        coveredCapabilities: orderCapabilities(capabilities),
        validated,
      };
    },
  });
}

/**
 * 便捷构造：空活动注册表 + 默认目录。
 *
 * 仅用于测试与首次装配；生产装配应由 `port-bundle.ts` 统一创建，使三个端口共享同一目录与状态。
 */
export function emptyL2Registry(): ActiveRegistry {
  return emptyRegistry();
}

/** 供 `port-bundle.ts` 复用的锚点推导（避免装配处再实现一遍）。 */
export { definitionAnchorsOf, joinJsonPath };
