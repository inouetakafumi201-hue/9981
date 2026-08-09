/**
 * scenes 目录装载桥（tasks.md D-5 的 scenes 切片）。
 *
 * 本文件现在只是通用桥 `catalog-activation.ts` 在"单个 scenes 目录"上的薄封装——真正的转换与
 * 装载逻辑只有一份实现（在 catalog-activation.ts 里），此处不重复任何职责，只提供 scenes 命名的
 * 便捷入口，保持既有 scenes 切片验收测试的稳定引用面。
 *
 * 详细的切片边界、两处自主映射判断与设计说明见 `catalog-activation.ts` 顶部注释。
 */

import type { CandidateDocumentInput, CompilationResult } from '../core/kernel/spec-compiler/index.js';
import type { ClassCatalog } from './class-contract.js';
import {
  CATALOG_CAPABILITY_FAMILY,
  CATALOG_COMPILER_SCHEMA_VERSION,
  type CatalogCompilerHost,
  type CatalogDocument,
  buildCatalogDocument,
  buildCatalogSchemaVersion,
  catalogDocumentInput,
  createCatalogCompilerHost,
} from './catalog-activation.js';
import type { SchemaVersion } from '../core/kernel/spec-compiler/index.js';

/** 编译器 schema 契约版本（与通用桥一致）。 */
export const SCENE_COMPILER_SCHEMA_VERSION = CATALOG_COMPILER_SCHEMA_VERSION;

/** 能力统一语义族（与通用桥一致）。 */
export const SCENE_CAPABILITY_FAMILY = CATALOG_CAPABILITY_FAMILY;

export type SceneCatalogDocument = CatalogDocument;
export type SceneCompilerHost = CatalogCompilerHost;

/** 为 scenes 目录构建编译器 SchemaVersion。 */
export function buildSceneSchemaVersion(catalog: ClassCatalog): SchemaVersion {
  return buildCatalogSchemaVersion([catalog]);
}

/** 把 scenes 目录转成编译器候选文档对象。 */
export function buildSceneDocument(catalog: ClassCatalog): SceneCatalogDocument {
  return buildCatalogDocument([catalog]);
}

/** 把候选文档对象包装成编译器输入。 */
export function sceneDocumentInput(
  document: unknown,
  overrides: Partial<CandidateDocumentInput> = {},
): CandidateDocumentInput {
  return catalogDocumentInput(document, overrides);
}

/** 组装一个只含 scenes 目录的隔离编译器主机。 */
export function createSceneCompilerHost(catalog: ClassCatalog): SceneCompilerHost {
  return createCatalogCompilerHost([catalog]);
}

/** 便捷入口：在全新主机上把 scenes 目录经生产模式原子激活。 */
export function activateSceneCatalog(catalog: ClassCatalog): Promise<CompilationResult> {
  const host = createSceneCompilerHost(catalog);
  return host.compiler.compileAndActivate(sceneDocumentInput(buildSceneDocument(catalog)));
}
