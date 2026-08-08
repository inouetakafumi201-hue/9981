/**
 * 任务 4 测试夹具：可信 Schema 目录、迁移边与规范化 Schema 视图的确定性替身。
 *
 * 这些替身只实现端口契约，不含任何 UGC 生产逻辑；它们让测试能通过**生产入口**驱动流水线，
 * 而不是绕过它（design.md Testing strategy：Fault injection is dependency injection at documented ports）。
 */
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog.js';
import { createDiagnosticFactory } from '../../diagnostics/factory.js';
import { candidateFromText, createCandidateSource } from '../../model/candidate.js';
import type { JsonAst, ParsedCandidateDocument } from '../../model/json-ast.js';
import { QUOTA_KINDS } from '../../model/quota-types.js';
import type { QuotaBudget, TrustedQuotaProfile } from '../../model/quota-types.js';
import { ugcOk } from '../../model/result.js';
import type { UgcResult } from '../../model/result.js';
import type {
  CanonicalizationSchemaView,
  SchemaMigrationGateway,
  SchemaVersionCatalog,
  TrustedSchemaMigration,
} from '../../ports/schema-ports.js';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway.js';
import { createQuotaBudget } from '../../quota/quota-budget.js';
import { createStrictJsonDecoder } from '../../codec/strict-json-decoder.js';

export const catalogFactory = createDiagnosticFactory(createDiagnosticCodeCatalog(sha256FingerprintGateway));
export const decoder = createStrictJsonDecoder(catalogFactory);
export const fingerprint = sha256FingerprintGateway;

export const source = createCandidateSource({
  kind: 'hand-authored',
  documentId: 'doc-1',
  packageId: 'pkg-1',
  sourceName: 'a.json',
  receivedAtSequence: 1,
});

export function budget(overrides: Partial<Record<string, number>> = {}): QuotaBudget {
  const base: Record<string, unknown> = { profileId: 'p1', version: 'v1' };
  for (const kind of QUOTA_KINDS) base[kind] = 100_000;
  return createQuotaBudget({ ...base, ...overrides } as unknown as TrustedQuotaProfile);
}

export function parse(text: string): ParsedCandidateDocument {
  const decoded = decoder.decode(candidateFromText(source, 'base-layer', text), budget());
  if (!decoded.ok) {
    throw new Error(`fixture failed to decode: ${decoded.diagnostics.map((entry) => entry.code).join(',')}`);
  }
  return decoded.value;
}

/** 语义化三段版本目录。`supported` 列出直接支持的版本。 */
export function versionCatalog(supported: readonly string[]): SchemaVersionCatalog {
  const parseVersion = (version: string): readonly number[] | null => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
    return version.split('.').map((part) => Number.parseInt(part, 10));
  };
  return {
    providerId: 'test.schema-catalog',
    catalogVersion: `schema-${supported.join('|')}`,
    isWellFormed(version: string): boolean {
      return parseVersion(version) !== null;
    },
    supports(version: string): boolean {
      return supported.includes(version);
    },
    supportedVersions(): readonly string[] {
      return supported;
    },
    compare(left: string, right: string): number {
      const leftParts = parseVersion(left) ?? [];
      const rightParts = parseVersion(right) ?? [];
      for (let index = 0; index < 3; index += 1) {
        const a = leftParts[index] ?? 0;
        const b = rightParts[index] ?? 0;
        if (a !== b) return a < b ? -1 : 1;
      }
      return 0;
    },
  };
}

/** 构造一条迁移边。默认转换是恒等（只改版本号由协调器负责）。 */
export function edge(
  id: string,
  from: string,
  to: string,
  transform: (ast: JsonAst) => UgcResult<JsonAst> = (ast) => ugcOk(ast),
): TrustedSchemaMigration {
  return { id, from, to, transform };
}

export function migrationGateway(edges: readonly TrustedSchemaMigration[]): SchemaMigrationGateway {
  return {
    providerId: 'test.migrations',
    registryVersion: `mig-${edges.map((entry) => entry.id).join('|')}`,
    edges: () => edges,
  };
}

/** 规范化 Schema 视图替身：按 path 前缀声明无序集合，并用元素下标之外的稳定身份排序。 */
export function canonicalSchema(options: {
  readonly unorderedPaths?: readonly string[];
  readonly identities?: Readonly<Record<string, readonly (string | null)[]>>;
} = {}): CanonicalizationSchemaView {
  const unorderedPaths = options.unorderedPaths ?? [];
  const identities = options.identities ?? {};
  return {
    providerId: 'test.canonical-schema',
    schemaCatalogVersion: 'schema-canonical-v1',
    isUnorderedCollection(jsonPath: string): boolean {
      return unorderedPaths.includes(jsonPath);
    },
    semanticIdentityOf(jsonPath: string, elementIndex: number): string | null {
      const table = identities[jsonPath];
      if (table === undefined) return null;
      return table[elementIndex] ?? null;
    },
  };
}
