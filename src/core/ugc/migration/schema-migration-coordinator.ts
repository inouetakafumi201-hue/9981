/**
 * 隔离、可信、确定性的文档迁移协调器（design.md「Schema migration」/ 需求 12.3-12.13、13.9）。
 *
 * 三条铁律：
 * 1. **只执行宿主注册的转换**。候选无法声明转换函数，也无法注册迁移边——`TrustedSchemaMigration`
 *    只能来自 `SchemaMigrationGateway`，而该端口由可信宿主注入。
 * 2. **隔离且原子**。每一步在不可变 AST 上产生新值；任一步失败即丢弃全部迁移结果并保留原始候选。
 * 3. **与运行时迁移完全分离**。引擎层 `MigrationDef.transform` 操作 `WorldState`，本模块只做
 *    JSON AST → JSON AST。候选 JSON 永远不会变成可执行的运行时迁移。
 *
 * 迁移成功**不等于**获得激活资格：迁移后的候选必须重新走完整的当前 Schema 检查、验证与引用解析
 * （需求 12.7）。本模块只负责把文档搬到受支持版本，并如实报告位置已重基。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic';
import type { UGCDiagnosticFactory } from '../diagnostics/factory';
import { documentAnchorSpan } from '../diagnostics/factory';
import type { JsonAst, MigratedCandidateDocument, ParsedCandidateDocument } from '../model/json-ast';
import type { QuotaBudget } from '../model/quota-types';
import type { UgcResult } from '../model/result';
import { ugcOk, ugcReject } from '../model/result';
import type { SchemaMigrationGateway, SchemaVersionCatalog, TrustedSchemaMigration } from '../ports/schema-ports';
import { SCHEMA_CATALOG_EVIDENCE, SCHEMA_MIGRATION_EVIDENCE, unresolvedContractDiagnostic } from '../ports/unavailable';
import { isPortUnavailable } from '../ports/availability';
import type { MigrationGraphProblem } from './schema-migration-graph';
import { buildMigrationGraph, classifyVersion, resolveUniquePath } from './schema-migration-graph';

const STAGE = 'schema-migration' as const;

export interface SchemaMigrationCoordinator {
  /**
   * 把候选带到一个受支持的 Schema 版本。
   *
   * 已是受支持版本时原样通过（`appliedMigrationIds` 为空），不做任何无谓转换。
   */
  migrate(document: ParsedCandidateDocument, budget: QuotaBudget): UgcResult<MigratedCandidateDocument>;
}

export interface SchemaMigrationCoordinatorDeps {
  readonly catalog: SchemaVersionCatalog;
  readonly gateway: SchemaMigrationGateway;
  readonly factory: UGCDiagnosticFactory;
  /** 单条迁移链允许的最大步数。由可信宿主提供，与配额独立以便给出更清晰的诊断。 */
  readonly maxSteps: number;
}

/** 迁移后的 AST 必须仍是合法 JSON 形状；宿主转换出错不应被当作候选错误静默接受。 */
function isWellFormedAst(node: unknown): node is JsonAst {
  if (node === null || typeof node !== 'object') return false;
  const candidate = node as { kind?: unknown; span?: unknown };
  if (typeof candidate.kind !== 'string') return false;
  if (candidate.span === null || typeof candidate.span !== 'object') return false;
  return ['null', 'boolean', 'number', 'string', 'array', 'object'].includes(candidate.kind);
}

export function createSchemaMigrationCoordinator(
  deps: SchemaMigrationCoordinatorDeps,
): SchemaMigrationCoordinator {
  const { catalog, gateway, factory, maxSteps } = deps;

  return Object.freeze({
    migrate(document: ParsedCandidateDocument, budget: QuotaBudget): UgcResult<MigratedCandidateDocument> {
      const sourcePackage = document.source.packageId;
      const file = document.source.documentId;
      const anchor = documentAnchorSpan(file);

      const reject = (condition: MigrationCondition, reason: string, correction: string, extra?: {
        readonly expected?: string;
        readonly actual?: string;
      }): UgcResult<MigratedCandidateDocument> =>
        ugcReject([
          factory.document({
            selector: { category: 'VERSION_COMPATIBILITY', condition },
            stage: STAGE,
            sourcePackage,
            sourceSpan: anchor,
            message: `Schema migration rejected (${condition}).`,
            reason,
            correctionSuggestion: correction,
            ...(extra?.expected === undefined ? {} : { expected: extra.expected }),
            ...(extra?.actual === undefined ? {} : { actual: extra.actual }),
          }),
        ]);

      if (isPortUnavailable(catalog)) {
        return ugcReject([unresolvedContractDiagnostic(factory, STAGE, sourcePackage, SCHEMA_CATALOG_EVIDENCE)]);
      }

      const standing = classifyVersion(catalog, document.schemaVersion);

      if (standing.kind === 'malformed') {
        return reject(
          'malformed-version',
          `声明的 Schema 版本 ${JSON.stringify(document.schemaVersion)} 不符合已登记的版本格式契约。`,
          '请按 Schema 契约要求的版本格式声明版本，不要使用自定义写法。',
          { actual: document.schemaVersion },
        );
      }

      if (standing.kind === 'newer') {
        return reject(
          'document-newer-than-supported',
          `声明的 Schema 版本 ${document.schemaVersion} 比当前支持的全部版本都新；` +
            `当前支持范围：${standing.supported.length === 0 ? '（无）' : standing.supported.join('、')}。` +
            '不存在反向迁移。',
          '请使用当前支持范围内的 Schema 版本重新导出该文档，或升级宿主后再提交。',
          { expected: standing.supported.join('、'), actual: document.schemaVersion },
        );
      }

      if (standing.kind === 'supported') {
        return ugcOk({
          ...document,
          originalSchemaVersion: document.schemaVersion,
          appliedMigrationIds: Object.freeze([]),
        });
      }

      // 到这里确定是旧版本，需要一条唯一迁移链。
      if (isPortUnavailable(gateway)) {
        return ugcReject([unresolvedContractDiagnostic(factory, STAGE, sourcePackage, SCHEMA_MIGRATION_EVIDENCE)]);
      }

      const built = buildMigrationGraph(gateway);
      if (built.ok === false) {
        return rejectGraphProblem(built.problem, reject);
      }

      const resolved = resolveUniquePath(built.graph, document.schemaVersion, standing.target, maxSteps, budget);
      const pathRejection = rejectPathProblem(resolved, standing.target, document.schemaVersion, reject, factory, sourcePackage, anchor);
      if (pathRejection !== null) return pathRejection;
      if (resolved.kind !== 'resolved') return pathRejection ?? reject('no-migration-path', '无法解析迁移路径。', '请登记完整迁移链。');

      return applyPath(resolved.path, document, standing.target, budget, factory, sourcePackage, anchor, reject);
    },
  });
}

type MigrationCondition =
  | 'malformed-version'
  | 'document-newer-than-supported'
  | 'no-migration-path'
  | 'ambiguous-migration-path'
  | 'duplicate-migration-edge'
  | 'migration-cycle'
  | 'migration-failed';

type Rejector = (
  condition: MigrationCondition,
  reason: string,
  correction: string,
  extra?: { readonly expected?: string; readonly actual?: string },
) => UgcResult<MigratedCandidateDocument>;

function rejectGraphProblem(
  problem: MigrationGraphProblem,
  reject: Rejector,
): UgcResult<MigratedCandidateDocument> {
  if (problem.kind === 'duplicate-edge') {
    return reject(
      'duplicate-migration-edge',
      `迁移注册表中 ${problem.from} → ${problem.to} 存在多条边（${problem.edgeIds.join('、')}），无法确定使用哪一条。`,
      '请在迁移注册表中为每一对版本只保留一条迁移边。',
    );
  }
  if (problem.kind === 'self-edge') {
    return reject(
      'migration-cycle',
      `迁移边 ${problem.edgeId} 的起止版本相同（${problem.version}），构成自环。`,
      '请删除该自环迁移边。',
    );
  }
  if (problem.kind === 'cycle') {
    return reject(
      'migration-cycle',
      `迁移图中存在环：${problem.path.join(' → ')}。`,
      '请移除至少一条回指的迁移边，使迁移图成为有向无环图。',
    );
  }
  return reject('no-migration-path', '文档迁移注册表尚未汇合。', '请等待宿主注册文档迁移边后重新提交。');
}

function rejectPathProblem(
  resolution: ReturnType<typeof resolveUniquePath>,
  target: string,
  declared: string,
  reject: Rejector,
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
  anchor: ReturnType<typeof documentAnchorSpan>,
): UgcResult<MigratedCandidateDocument> | null {
  if (resolution.kind === 'resolved') return null;

  if (resolution.kind === 'no-path') {
    return reject(
      'no-migration-path',
      `没有任何已登记的迁移链能把 ${declared} 升级到受支持版本 ${target}。`,
      '请补齐缺失的迁移边，或用受支持版本重新导出该文档。',
      { expected: target, actual: declared },
    );
  }
  if (resolution.kind === 'ambiguous') {
    return reject(
      'ambiguous-migration-path',
      `从 ${declared} 到 ${target} 存在多条迁移链（例如 ${resolution.first.join('→')} 与 ${resolution.second.join('→')}），` +
        '不同链可能产生不同结果，因此不能自动选择。',
      '请调整迁移注册表，使任意两个版本之间只有一条迁移链。',
    );
  }
  if (resolution.kind === 'step-limit') {
    return reject(
      'no-migration-path',
      `从 ${declared} 到 ${target} 的迁移链超过允许的最大步数 ${String(resolution.maxSteps)}。`,
      '请提供更短的迁移链，或由宿主提高最大步数配置。',
    );
  }

  const violation = resolution.violation;
  return ugcReject([
    factory.changeSet({
      selector: { category: 'RESOURCE_LIMIT', condition: violation.kind },
      stage: STAGE,
      sourcePackage,
      sourceSpan: anchor,
      jsonPath: null,
      message: `Quota ${violation.kind} exceeded while resolving a migration path.`,
      reason: `解析迁移路径时超出可信配额 ${violation.kind}（上限 ${String(violation.limit)}）。`,
      correctionSuggestion: '请缩短迁移链，或由宿主调整配额配置。',
      expected: violation.limit,
      actual: violation.observed,
    }),
  ]);
}

/**
 * 逐步应用迁移链。
 *
 * 原子性由"只在全部步骤成功后才返回新文档"保证：中途任何失败都直接返回拒绝，
 * 调用方手里的原始 `document` 从未被触碰（AST 是不可变值，转换只产生新值）。
 */
function applyPath(
  path: readonly TrustedSchemaMigration[],
  document: ParsedCandidateDocument,
  target: string,
  budget: QuotaBudget,
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
  anchor: ReturnType<typeof documentAnchorSpan>,
  reject: Rejector,
): UgcResult<MigratedCandidateDocument> {
  const originalAst = document.ast;
  let currentAst: JsonAst = originalAst;
  const applied: string[] = [];

  for (const edge of path) {
    const work = budget.consume('traversalWork', 1);
    if (work !== null) {
      return reject('migration-failed', `应用迁移 ${edge.id} 时超出遍历配额。`, '请缩短迁移链或调整配额。');
    }

    let stepResult: UgcResult<JsonAst>;
    try {
      stepResult = edge.transform(currentAst);
    } catch (thrown) {
      // 宿主转换抛出异常不得逃逸公共边界，也不得被当成"迁移成功"。
      return ugcReject([
        factory.document({
          selector: { category: 'VERSION_COMPATIBILITY', condition: 'migration-failed' },
          stage: STAGE,
          sourcePackage,
          sourceSpan: anchor,
          message: `Migration ${edge.id} threw: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
          reason: `迁移步骤 ${edge.id}（${edge.from} → ${edge.to}）执行失败，已放弃全部迁移结果并保留原始文档。`,
          correctionSuggestion: '这是宿主迁移实现的问题而非候选内容问题：请向维护者报告该迁移边。',
          actual: edge.id,
        }),
      ]);
    }

    if (stepResult.ok === false) {
      return ugcReject(stepResult.diagnostics);
    }
    if (!isWellFormedAst(stepResult.value)) {
      return reject(
        'migration-failed',
        `迁移步骤 ${edge.id} 返回的不是合法的 JSON 语法树，已放弃全部迁移结果。`,
        '这是宿主迁移实现的问题：请向维护者报告该迁移边。',
        { actual: edge.id },
      );
    }
    currentAst = stepResult.value;
    applied.push(edge.id);
  }

  // 原始输入必须没有被任何一步就地修改（转换应当是纯的）。
  if (document.ast !== originalAst) {
    return reject(
      'migration-failed',
      '某个迁移步骤就地修改了原始候选 AST，违反纯转换约定。',
      '这是宿主迁移实现的问题：迁移必须返回新值而不是改写输入。',
    );
  }

  const migrated: MigratedCandidateDocument = {
    source: document.source,
    targetOwnership: document.targetOwnership,
    schemaVersion: target,
    ast: currentAst,
    originalSchemaVersion: document.schemaVersion,
    appliedMigrationIds: Object.freeze(applied),
  };

  // 位置已重基：后续诊断的行列对应升级后的内容，如实告知创作者（E_LOAD_MIGRATED_SOURCE_REBASED）。
  const rebased: Diagnostic = factory.document({
    selector: { category: 'VERSION_COMPATIBILITY', condition: 'migration-source-rebased' },
    stage: STAGE,
    sourcePackage,
    sourceSpan: anchor,
    message: `Document migrated ${document.schemaVersion} -> ${target}; reported positions are rebased.`,
    reason:
      `文档已自动从 ${document.schemaVersion} 升级到 ${target}（迁移步骤：${applied.join('→')}）。` +
      '之后报告的行号列号对应升级后的内容，不是你原始文件中的位置。',
    correctionSuggestion: '核对问题位置时请以升级后的内容为准。',
    expected: target,
    actual: document.schemaVersion,
  });

  return ugcOk(migrated, [rebased]);
}
