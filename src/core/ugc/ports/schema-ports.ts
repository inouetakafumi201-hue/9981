/**
 * Schema 版本目录与可信文档迁移端口（design.md「Schema migration and canonicalization」/ 需求 12.1-12.7）。
 *
 * 铁律：迁移**转换函数由可信宿主提供**，候选 JSON 永远不能声明转换函数或注册新的迁移边。
 * 文档 Schema 迁移（本文件）与运行时状态迁移（引擎层 `MigrationDef`）是两条不可互通的路径。
 */
import type { JsonAst } from '../model/json-ast.js';
import type { UgcResult } from '../model/result.js';

export interface SchemaVersionCatalog {
  readonly providerId: string;
  readonly catalogVersion: string;
  /** 该版本是否被当前 Schema 直接支持。 */
  supports(version: string): boolean;
  /** 版本格式是否合法。非法格式与"旧版本"必须区分（需求 12.1）。 */
  isWellFormed(version: string): boolean;
  /** 全部直接支持的版本，按稳定顺序，用于"报告支持范围"（需求 12.4）。 */
  supportedVersions(): readonly string[];
  /** 版本比较：负数表示 left 更旧。 */
  compare(left: string, right: string): number;
}

/**
 * 一条可信迁移边。`transform` 必须是纯的、确定的，且不修改输入 AST。
 *
 * 注意与引擎层 `MigrationDef` 的区别：后者签名是 `(state: WorldState) => WorldState`，操作运行时状态；
 * 这里只做隔离 JSON AST 到 JSON AST 的转换，永远不接触 WorldState。
 */
export interface TrustedSchemaMigration {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  transform(ast: JsonAst): UgcResult<JsonAst>;
}

export interface SchemaMigrationGateway {
  readonly providerId: string;
  readonly registryVersion: string;
  /** 全部已注册迁移边，按稳定顺序。用于图完整性检查（重复边、分支歧义、环）。 */
  edges(): readonly TrustedSchemaMigration[];
}

/**
 * 规范化所需的 Schema 视图（需求 11.3、11.4、11.12）。
 *
 * 数组**默认有序**：顺序是语义的一部分，抹平它会改变含义。只有当 Schema 明确声明某个集合无序
 * **并且**为其元素提供稳定语义身份时，规范化才排序它。身份缺失或重复即无法唯一规范化，必须拒绝。
 */
export interface CanonicalizationSchemaView {
  readonly providerId: string;
  readonly schemaCatalogVersion: string;
  /** 该 JSON path 上的数组是否被 Schema 明确声明为无序集合。 */
  isUnorderedCollection(jsonPath: string): boolean;
  /**
   * 取某个无序集合元素的稳定语义身份。返回 `null` 表示 Schema 无法为该元素定义身份，
   * 此时规范化结果不唯一，必须以 `E_LOAD_CANONICAL_AMBIGUOUS` 拒绝。
   */
  semanticIdentityOf(jsonPath: string, elementIndex: number): string | null;
}
