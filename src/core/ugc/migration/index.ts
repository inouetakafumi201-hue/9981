/**
 * UGC 文档迁移层导出根。
 */
export type { MigrationGraph, MigrationGraphProblem, PathResolution, VersionStanding } from './schema-migration-graph.js';
export { buildMigrationGraph, classifyVersion, resolveUniquePath } from './schema-migration-graph.js';

export type { SchemaMigrationCoordinator, SchemaMigrationCoordinatorDeps } from './schema-migration-coordinator.js';
export { createSchemaMigrationCoordinator } from './schema-migration-coordinator.js';
