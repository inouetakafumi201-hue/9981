/**
 * 基类层收官轰炸 —— 属性 10/11：装载桥原子激活（生产模式成功 + 跨目录引用闭合 + 失败原子回滚 ≥500）。
 *
 * Feature: wakeup-base-layer-bombardment, Property 10/11
 * 验证：要求 5.1（激活失败原子回滚）、5.2（生产模式成功+确定性快照）、
 *       5.3（跨目录一个 class 引用另一目录能力 → 单次合并完整解析）。
 *
 * 复用既有 `catalog-activation.property.test.ts` 的 P8/P10 实现作为基线，本文件为
 * 收官轰炸补两件既有覆盖未达标的压力/闭合面：跨目录引用闭合的显式断言，与
 * 失败原子回滚在 500 次生成下的稳定性（既有实现为 100）。两者都用真实生产装载桥
 * `activateCatalogs` / `SpecificationCompiler.compileAndActivate`，不做 mock。
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseClassCatalog } from '../class-contract';
import { parseClassJson } from '../catalog-loader';
import type { CompilationResult, CandidateDocumentInput } from '../../core/kernel/spec-compiler/index';
import {
  CATALOG_COMPILER_SCHEMA_VERSION,
  activateCatalogs,
  buildCatalogDocument,
  catalogDocumentInput,
  createCatalogCompilerHost,
} from '../catalog-activation';
import type { ClassCatalog } from '../class-contract';
import { UNIFORM_CATALOG_DIRS, catalogText } from './catalog-fixtures';

const UNIFORM_CATALOGS: readonly ClassCatalog[] = UNIFORM_CATALOG_DIRS.map((dir) =>
  parseClassCatalog(parseClassJson(catalogText(dir), `${dir}/index.json`), `${dir}/index.json`),
);

function cloneDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(buildCatalogDocument(UNIFORM_CATALOGS))) as Record<string, unknown>;
}

function compileFresh(document: unknown, overrides: Partial<CandidateDocumentInput> = {}): Promise<CompilationResult> {
  return createCatalogCompilerHost(UNIFORM_CATALOGS).compiler.compileAndActivate(
    catalogDocumentInput(document, overrides),
  );
}

function diagnosticSequence(result: CompilationResult): readonly string[] {
  return result.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.stage}`);
}

describe('属性10：装载桥生产模式激活成功与跨目录引用闭合', () => {
  it('8 个统一目录合并激活成功、无悬空引用、产生确定性快照（跨目录 class→能力完全解析）', async () => {
    const result = await activateCatalogs(UNIFORM_CATALOGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshotId).not.toBeNull();
    expect(result.canonicalSnapshot.generation).toBe(1);
    // 跨目录组合引用闭合：合并文档里被 components 引用的每个 component 都指向真实 capability 定义。
    const document = cloneDocument()['definitions'] as Record<string, unknown>[];
    for (const definition of document) {
      const components = definition['components'];
      if (!Array.isArray(components)) continue;
      for (const componentRef of components) {
        if (typeof componentRef !== 'string') continue;
        const target = document.find((d) => d['id'] === componentRef);
        expect(target, `组件引用 ${componentRef} 必须在合并文档中解析到定义`).not.toBeUndefined();
      }
    }
  });

  it('同一组目录重复激活产出逐位一致的确定性快照 id', async () => {
    const first = await activateCatalogs(UNIFORM_CATALOGS);
    const second = await activateCatalogs(UNIFORM_CATALOGS);
    if (!first.ok || !second.ok) {
      throw new Error('重复激活必须成功');
    }
    expect(first.snapshotId).toBe(second.snapshotId);
    expect(first.artifactHash).toBe(second.artifactHash);
  });
});

describe('属性11：装载桥失败原子回滚（压力面 ≥500）', () => {
  it('任意单点违规注入 → compileAndActivate 失败且注册表零候选变更（500 次生成）', async () => {
    const corruptions = [
      'dangling-component',
      'duplicate-id',
      'bad-kind',
      'bad-family',
      'unknown-def-field',
      'unknown-top-field',
    ] as const;
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...corruptions), fc.nat(), async (corruption, pick) => {
        const document = cloneDocument();
        const definitions = document['definitions'] as Record<string, unknown>[];
        const withComponents = definitions.filter(
          (definition) => Array.isArray(definition['components']) && (definition['components'] as unknown[]).length > 0,
        );
        switch (corruption) {
          case 'dangling-component': {
            const target = withComponents[pick % withComponents.length]!;
            const components = target['components'] as string[];
            components[pick % components.length] = `l2.capability.missing-${pick}`;
            break;
          }
          case 'duplicate-id': {
            const source = definitions[pick % definitions.length]!;
            definitions.push(JSON.parse(JSON.stringify(source)) as Record<string, unknown>);
            break;
          }
          case 'bad-kind':
            definitions[pick % definitions.length]!['kind'] = 'wombat';
            break;
          case 'bad-family':
            definitions[pick % definitions.length]!['semanticFamily'] = 'no-such-family';
            break;
          case 'unknown-def-field':
            definitions[pick % definitions.length]!['mysteryField'] = 'unexpected';
            break;
          case 'unknown-top-field':
            document['mysteryTopLevel'] = 'unexpected';
            break;
        }
        const result = await compileFresh(document);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.unchangedState).toBe(true);
          expect(result.canonicalSnapshot.generation).toBe(0);
          expect(result.canonicalSnapshot.artifactHash).toBeNull();
          expect(result.diagnostics.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500, seed: 0x5eed_b00c },
    );
  });

  it('后续包激活失败时先前已激活快照严格不变（原子回滚前向）', async () => {
    const host = createCatalogCompilerHost(UNIFORM_CATALOGS);
    const first = await host.compiler.compileAndActivate(
      catalogDocumentInput(buildCatalogDocument(UNIFORM_CATALOGS)),
    );
    expect(first.ok).toBe(true);
    const before = first.canonicalSnapshot.generation;

    const badDocument = cloneDocument();
    const definitions = badDocument['definitions'] as Record<string, unknown>[];
    definitions[pick(definitions.length)]!['kind'] = 'wombat';
    const second = await host.compiler.compileAndActivate(
      catalogDocumentInput(badDocument),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.unchangedState).toBe(true);
      expect(second.canonicalSnapshot.generation).toBe(before);
    }
  });
});

function pick(max: number): number {
  return (Math.floor(Math.random() * max) + max) % max;
}
