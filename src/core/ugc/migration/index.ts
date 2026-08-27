/**
 * UGC 文档迁移层导出根。
 */
export type { MigrationGraph, MigrationGraphProblem, PathResolution, VersionStanding } from './schema-migration-graph';
export { buildMigrationGraph, classifyVersion, resolveUniquePath } from './schema-migration-graph';

export type { SchemaMigrationCoordinator, SchemaMigrationCoordinatorDeps } from './schema-migration-coordinator';
export { createSchemaMigrationCoordinator } from './schema-migration-coordinator';
