/**
 * 任务 4.1 / 4.2 验收测试：版本判定、唯一迁移路径、隔离且原子的可信迁移。
 */
import { describe, expect, it } from 'vitest';
import { ugcOk, ugcReject } from '../../model/result';
import type { JsonAst } from '../../model/json-ast';
import { createUnavailableSchemaMigrationGateway, createUnavailableSchemaVersionCatalog } from '../../ports/unavailable';
import { buildMigrationGraph, classifyVersion, resolveUniquePath } from '../schema-migration-graph';
import { createSchemaMigrationCoordinator } from '../schema-migration-coordinator';
import { budget, catalogFactory, edge, migrationGateway, parse, versionCatalog } from './fixtures';

function coordinator(options: {
  readonly supported: readonly string[];
  readonly edges: readonly ReturnType<typeof edge>[];
  readonly maxSteps?: number;
}) {
  return createSchemaMigrationCoordinator({
    catalog: versionCatalog(options.supported),
    gateway: migrationGateway(options.edges),
    factory: catalogFactory,
    maxSteps: options.maxSteps ?? 10,
  });
}

describe('Feature: wakeup-ugc, Task 4.1: version standing', () => {
  const catalog = versionCatalog(['2.0.0', '2.1.0']);

  it('separates malformed versions from old versions', () => {
    expect(classifyVersion(catalog, 'not-a-version').kind).toBe('malformed');
    expect(classifyVersion(catalog, '1').kind).toBe('malformed');
    expect(classifyVersion(catalog, '1.0.0').kind).toBe('older');
  });

  it('recognises a directly supported version without reinterpreting it', () => {
    expect(classifyVersion(catalog, '2.0.0')).toEqual({ kind: 'supported' });
    expect(classifyVersion(catalog, '2.1.0')).toEqual({ kind: 'supported' });
  });

  it('targets the newest supported version when migrating an older document', () => {
    expect(classifyVersion(catalog, '1.5.0')).toEqual({ kind: 'older', target: '2.1.0' });
  });

  it('treats a version newer than every supported version as unmigratable', () => {
    const standing = classifyVersion(catalog, '3.0.0');
    expect(standing.kind).toBe('newer');
    if (standing.kind === 'newer') expect(standing.supported).toEqual(['2.0.0', '2.1.0']);
  });
});

describe('Feature: wakeup-ugc, Task 4.1: migration graph integrity', () => {
  it('rejects duplicate edges between the same version pair', () => {
    const built = buildMigrationGraph(migrationGateway([edge('a', '1.0.0', '2.0.0'), edge('b', '1.0.0', '2.0.0')]));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.problem.kind).toBe('duplicate-edge');
  });

  it('rejects a self edge', () => {
    const built = buildMigrationGraph(migrationGateway([edge('a', '1.0.0', '1.0.0')]));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.problem.kind).toBe('self-edge');
  });

  it('rejects a cycle and reports a deterministic path', () => {
    const built = buildMigrationGraph(
      migrationGateway([edge('a', '1.0.0', '2.0.0'), edge('b', '2.0.0', '3.0.0'), edge('c', '3.0.0', '1.0.0')]),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.problem.kind).toBe('cycle');
    if (built.problem.kind !== 'cycle') return;
    expect(built.problem.path[0]).toBe(built.problem.path[built.problem.path.length - 1]);
  });

  it('detects an unmerged gateway distinctly from an empty graph', () => {
    const unmerged = buildMigrationGraph(createUnavailableSchemaMigrationGateway());
    expect(unmerged.ok).toBe(false);
    if (unmerged.ok) return;
    expect(unmerged.problem.kind).toBe('gateway-unavailable');

    const empty = buildMigrationGraph(migrationGateway([]));
    expect(empty.ok).toBe(true);
  });

  it('accepts a valid acyclic multi-step graph', () => {
    const built = buildMigrationGraph(
      migrationGateway([edge('a', '1.0.0', '1.1.0'), edge('b', '1.1.0', '2.0.0')]),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.graph.edgeCount).toBe(2);
  });
});

describe('Feature: wakeup-ugc, Task 4.1: unique path resolution', () => {
  function graphOf(edges: readonly ReturnType<typeof edge>[]) {
    const built = buildMigrationGraph(migrationGateway(edges));
    if (!built.ok) throw new Error('fixture graph is invalid');
    return built.graph;
  }

  it('resolves a single multi-step chain deterministically', () => {
    const graph = graphOf([edge('a', '1.0.0', '1.1.0'), edge('b', '1.1.0', '2.0.0')]);
    const first = resolveUniquePath(graph, '1.0.0', '2.0.0', 10, budget());
    const second = resolveUniquePath(graph, '1.0.0', '2.0.0', 10, budget());
    expect(first.kind).toBe('resolved');
    if (first.kind !== 'resolved' || second.kind !== 'resolved') return;
    expect(first.path.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(second.path.map((entry) => entry.id)).toEqual(first.path.map((entry) => entry.id));
  });

  it('reports ambiguity when two distinct chains reach the target', () => {
    // 1.0.0 → 2.0.0 既可直达，也可经 1.5.0；两条链可能产生不同结果，必须拒绝而非任选其一。
    const graph = graphOf([
      edge('direct', '1.0.0', '2.0.0'),
      edge('via-a', '1.0.0', '1.5.0'),
      edge('via-b', '1.5.0', '2.0.0'),
    ]);
    const resolution = resolveUniquePath(graph, '1.0.0', '2.0.0', 10, budget());
    expect(resolution.kind).toBe('ambiguous');
    if (resolution.kind !== 'ambiguous') return;
    expect(resolution.first).not.toEqual(resolution.second);
  });

  it('reports no path when the target is unreachable', () => {
    const graph = graphOf([edge('a', '1.0.0', '1.1.0')]);
    expect(resolveUniquePath(graph, '1.0.0', '9.0.0', 10, budget()).kind).toBe('no-path');
  });

  it('treats an identical from/to as a zero-step resolved path', () => {
    const graph = graphOf([edge('a', '1.0.0', '2.0.0')]);
    const resolution = resolveUniquePath(graph, '2.0.0', '2.0.0', 10, budget());
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind !== 'resolved') return;
    expect(resolution.path).toEqual([]);
  });

  it('enforces the maximum step count', () => {
    const graph = graphOf([
      edge('a', '1.0.0', '1.1.0'),
      edge('b', '1.1.0', '1.2.0'),
      edge('c', '1.2.0', '2.0.0'),
    ]);
    expect(resolveUniquePath(graph, '1.0.0', '2.0.0', 2, budget()).kind).toBe('step-limit');
    expect(resolveUniquePath(graph, '1.0.0', '2.0.0', 3, budget()).kind).toBe('resolved');
  });

  it('reports the migration-steps quota using the code registered in task 1.3', () => {
    const graph = graphOf([edge('a', '1.0.0', '1.1.0'), edge('b', '1.1.0', '2.0.0')]);
    const resolution = resolveUniquePath(graph, '1.0.0', '2.0.0', 10, budget({ migrationSteps: 1 }));
    expect(resolution.kind).toBe('quota');
    if (resolution.kind !== 'quota') return;
    expect(resolution.violation.kind).toBe('migrationSteps');
  });
});

describe('Feature: wakeup-ugc, Task 4.2: isolated, trusted, atomic migration', () => {
  const oldDoc = () => parse('{"schemaVersion":"1.0.0","name":"shotgun"}');

  it('passes a directly supported document through untouched', () => {
    const document = parse('{"schemaVersion":"2.0.0","name":"shotgun"}');
    const result = coordinator({ supported: ['2.0.0'], edges: [] }).migrate(document, budget());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appliedMigrationIds).toEqual([]);
    expect(result.value.ast).toBe(document.ast);
    expect(result.diagnostics).toEqual([]);
  });

  it('applies a unique chain and reports that positions were rebased', () => {
    const rename = (ast: JsonAst) => ugcOk(ast);
    const result = coordinator({
      supported: ['2.0.0'],
      edges: [edge('m1', '1.0.0', '1.5.0', rename), edge('m2', '1.5.0', '2.0.0', rename)],
    }).migrate(oldDoc(), budget());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe('2.0.0');
    expect(result.value.originalSchemaVersion).toBe('1.0.0');
    expect(result.value.appliedMigrationIds).toEqual(['m1', 'm2']);
    // 位置重基必须如实告知，否则创作者会按原文件行号去找问题（E_LOAD_MIGRATED_SOURCE_REBASED）。
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['E_LOAD_MIGRATED_SOURCE_REBASED']);
    expect(result.diagnostics[0]?.severity).toBe('warn');
  });

  it('discards all migration output and preserves the original when a step fails', () => {
    const document = oldDoc();
    const originalAst = document.ast;
    const result = coordinator({
      supported: ['2.0.0'],
      edges: [
        edge('m1', '1.0.0', '1.5.0', (ast) => ugcOk(ast)),
        edge('m2', '1.5.0', '2.0.0', () =>
          ugcReject([
            {
              code: 'E_MIG_FAILED',
              severity: 'error',
              message: 'step failed',
              phase: 0,
              at: null,
              path: null,
              sourcePackage: 'pkg-1',
              sourceSpan: null,
            },
          ]),
        ),
      ],
    }).migrate(document, budget());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((entry) => entry.code)).toContain('E_MIG_FAILED');
    expect(document.ast).toBe(originalAst);
    expect(document.schemaVersion).toBe('1.0.0');
  });

  it('converts a thrown host migration into a structured rejection without leaking the exception', () => {
    const document = oldDoc();
    const result = coordinator({
      supported: ['2.0.0'],
      edges: [
        edge('boom', '1.0.0', '2.0.0', () => {
          throw new Error('host migration crashed');
        }),
      ],
    }).migrate(document, budget());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_MIG_FAILED');
    expect(result.diagnostics[0]?.reason).toContain('boom');
    expect(document.schemaVersion).toBe('1.0.0');
  });

  it('rejects a migration that returns a malformed AST', () => {
    const result = coordinator({
      supported: ['2.0.0'],
      edges: [edge('bad', '1.0.0', '2.0.0', () => ugcOk({ notAnAst: true } as unknown as JsonAst))],
    }).migrate(oldDoc(), budget());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_MIG_FAILED');
  });
});

describe('Feature: wakeup-ugc, Task 4.2: version compatibility rejections', () => {
  it('rejects a malformed version with its own condition', () => {
    const result = coordinator({ supported: ['2.0.0'], edges: [] }).migrate(
      parse('{"schemaVersion":"v-two"}'),
      budget(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_SCHEMA_VERSION');
    expect(result.diagnostics[0]?.messageKey).toContain('malformed-version');
  });

  it('rejects a newer-than-supported document and reports the supported range', () => {
    const result = coordinator({ supported: ['2.0.0', '2.1.0'], edges: [] }).migrate(
      parse('{"schemaVersion":"9.0.0"}'),
      budget(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_SCHEMA_VERSION');
    expect(result.diagnostics[0]?.reason).toContain('2.0.0');
    expect(result.diagnostics[0]?.reason).toContain('2.1.0');
  });

  it('rejects a gap, an ambiguity and a cycle with distinct migration codes', () => {
    const gap = coordinator({ supported: ['2.0.0'], edges: [] }).migrate(parse('{"schemaVersion":"1.0.0"}'), budget());
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.diagnostics[0]?.code).toBe('E_MIG_NO_PATH');

    const ambiguous = coordinator({
      supported: ['2.0.0'],
      edges: [edge('d', '1.0.0', '2.0.0'), edge('a', '1.0.0', '1.5.0'), edge('b', '1.5.0', '2.0.0')],
    }).migrate(parse('{"schemaVersion":"1.0.0"}'), budget());
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.diagnostics[0]?.code).toBe('E_MIG_AMBIGUOUS_PATH');

    const cyclic = coordinator({
      supported: ['2.0.0'],
      edges: [edge('a', '1.0.0', '1.5.0'), edge('b', '1.5.0', '1.0.0')],
    }).migrate(parse('{"schemaVersion":"1.0.0"}'), budget());
    expect(cyclic.ok).toBe(false);
    if (!cyclic.ok) expect(cyclic.diagnostics[0]?.code).toBe('E_MIG_CYCLE');

    const duplicate = coordinator({
      supported: ['2.0.0'],
      edges: [edge('a', '1.0.0', '2.0.0'), edge('b', '1.0.0', '2.0.0')],
    }).migrate(parse('{"schemaVersion":"1.0.0"}'), budget());
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics[0]?.code).toBe('E_MIG_AMBIGUOUS_PATH');
  });

  it('fails closed when the schema catalog or migration registry is unmerged', () => {
    const noCatalog = createSchemaMigrationCoordinator({
      catalog: createUnavailableSchemaVersionCatalog(),
      gateway: migrationGateway([]),
      factory: catalogFactory,
      maxSteps: 10,
    }).migrate(parse('{"schemaVersion":"1.0.0"}'), budget());
    expect(noCatalog.ok).toBe(false);
    if (!noCatalog.ok) expect(noCatalog.diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');

    const noRegistry = createSchemaMigrationCoordinator({
      catalog: versionCatalog(['2.0.0']),
      gateway: createUnavailableSchemaMigrationGateway(),
      factory: catalogFactory,
      maxSteps: 10,
    }).migrate(parse('{"schemaVersion":"1.0.0"}'), budget());
    expect(noRegistry.ok).toBe(false);
    if (!noRegistry.ok) expect(noRegistry.diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
  });

  it('never routes a document migration through the runtime MigrationDef contract', () => {
    // 需求 12.8/13.9：候选 JSON 不得变成可执行的运行时迁移。这里断言迁移边只收到 AST。
    const seen: unknown[] = [];
    const result = coordinator({
      supported: ['2.0.0'],
      edges: [
        edge('m', '1.0.0', '2.0.0', (ast) => {
          seen.push(ast);
          return ugcOk(ast);
        }),
      ],
    }).migrate(parse('{"schemaVersion":"1.0.0"}'), budget());
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const received = seen[0] as { kind?: unknown; entities?: unknown; world?: unknown };
    expect(typeof received.kind).toBe('string');
    // WorldState 的标志性字段绝不应出现：迁移只看到 JSON AST。
    expect(received.entities).toBeUndefined();
    expect(received.world).toBeUndefined();
  });

  it('is deterministic for the same document and registry', () => {
    const run = () =>
      coordinator({
        supported: ['2.0.0'],
        edges: [edge('m1', '1.0.0', '1.5.0'), edge('m2', '1.5.0', '2.0.0')],
      }).migrate(parse('{"schemaVersion":"1.0.0","name":"shotgun"}'), budget());
    const first = run();
    const second = run();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.appliedMigrationIds).toEqual(first.value.appliedMigrationIds);
    expect(second.value.schemaVersion).toBe(first.value.schemaVersion);
  });
});
