/**
 * tasks.md D-5 验收测试：把 8 个统一形状基类层目录
 * （actions/attachments/containers/gateways/items/movement/scenes/skills）合并为一次装载，
 * 经 `SpecificationCompiler.compileAndActivate`（targetLayer: '基类层'）走真实的原子激活/回滚管线，
 * 并对该组合切片成立：
 *   - P8  引用图完整性与确定性拒绝：任意悬空组合引用 → 确定性 Structured_Rejection（E_REF_MISSING）。
 *   - P10 包激活、覆盖、删除的原子性与回滚：任一 Error → 零候选变更、活动快照不变。
 *
 * 切片边界（见 catalog-activation.ts 顶部注释）：只覆盖 8 个统一目录的"类 + 能力 + 组合边"，
 * 不覆盖结构边界数值、值集合、跨目录类引用/过渡端点具体引用、禁令规则，也不覆盖 5 个族特有目录。
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseClassCatalog } from '../class-contract.js';
import { parseClassJson } from '../catalog-loader.js';
import { catalogText, UNIFORM_CATALOG_DIRS } from './catalog-fixtures.js';
import type { CandidateDocumentInput, CompilationResult } from '../../core/kernel/spec-compiler/index.js';
import {
  CATALOG_COMPILER_SCHEMA_VERSION,
  activateCatalogs,
  buildCatalogDocument,
  catalogDocumentInput,
  createCatalogCompilerHost,
} from '../catalog-activation.js';
import type { ClassCatalog } from '../class-contract.js';

const UNIFORM_CATALOGS: readonly ClassCatalog[] = UNIFORM_CATALOG_DIRS.map((dir) =>
  parseClassCatalog(parseClassJson(catalogText(dir), `${dir}/index.json`), `${dir}/index.json`),
);

/** 深克隆合并文档，使每次注入违规都从干净副本开始。 */
function cloneDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(buildCatalogDocument(UNIFORM_CATALOGS))) as Record<string, unknown>;
}

/** 在全新主机上编译一个文档对象（生产模式）。 */
function compileFresh(document: unknown, overrides: Partial<CandidateDocumentInput> = {}): Promise<CompilationResult> {
  return createCatalogCompilerHost(UNIFORM_CATALOGS).compiler.compileAndActivate(
    catalogDocumentInput(document, overrides),
  );
}

/** 诊断的确定性投影：代码 + 阶段，顺序敏感（编译器已确定性排序诊断）。 */
function diagnosticSequence(result: CompilationResult): readonly string[] {
  return result.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.stage}`);
}

/** 定义数组中"带组合边"的定义（即类），用于选取悬空注入点。 */
function definitionsWithComponents(document: Record<string, unknown>): Record<string, unknown>[] {
  const definitions = document['definitions'] as Record<string, unknown>[];
  return definitions.filter(
    (definition) => Array.isArray(definition['components']) && (definition['components'] as unknown[]).length > 0,
  );
}

describe('8 个统一形状基类层目录合并经规范编译器原子激活（D-5）', () => {
  it('生产模式激活成功、无悬空引用、且产生确定性快照', async () => {
    const result = await activateCatalogs(UNIFORM_CATALOGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshotId).not.toBeNull();
    expect(result.canonicalSnapshot.generation).toBe(1);
    // 8 个目录合并后的组合引用全部可解析（跨目录能力引用闭合）：不应出现 E_REF_MISSING（P8 正例）。
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'E_REF_MISSING')).toBe(false);

    // 确定性：两个相互独立的主机产出字节相同的产物哈希与规范模型。
    const again = await activateCatalogs(UNIFORM_CATALOGS);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.artifactHash).toBe(result.artifactHash);
      expect(again.canonicalSnapshot.canonicalModel).toBe(result.canonicalSnapshot.canonicalModel);
    }
  });

  it('P10 回滚：后续包激活失败时，先前已激活的合并快照严格不变', async () => {
    const host = createCatalogCompilerHost(UNIFORM_CATALOGS);
    const first = await host.compiler.compileAndActivate(catalogDocumentInput(buildCatalogDocument(UNIFORM_CATALOGS)));
    expect(first.ok).toBe(true);
    const goodSnapshot = host.registry.canonicalSnapshot();
    expect(goodSnapshot.generation).toBe(1);

    const badDocument = {
      schemaVersion: CATALOG_COMPILER_SCHEMA_VERSION,
      targetLayer: '基类层',
      definitions: [
        {
          id: 'l2.class.bogus',
          kind: 'item',
          abstract: true,
          semanticFamily: 'weapon',
          components: ['l2.capability.does-not-exist'],
        },
      ],
    };
    const second = await host.compiler.compileAndActivate(
      catalogDocumentInput(badDocument, { sourceId: 'src:bad', sourcePackage: 'pkg.bad', documentUri: 'file:///bad.json' }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.unchangedState).toBe(true);
      expect(second.diagnostics.some((diagnostic) => diagnostic.code === 'E_REF_MISSING')).toBe(true);
    }

    const afterSnapshot = host.registry.canonicalSnapshot();
    expect(afterSnapshot.generation).toBe(1);
    expect(afterSnapshot.canonicalModel).toBe(goodSnapshot.canonicalModel);
  });

  it('P10: 任意单点违规都被原子拒绝，全新注册表零候选变更（fast-check，100 次生成）', async () => {
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
        const withComponents = definitionsWithComponents(document);

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
      { numRuns: 100 },
    );
  });

  it('P8: 任意悬空组合引用被确定性拒绝且诊断可复现（fast-check，100 次生成）', async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat(), fc.nat(), async (classPick, missingSalt) => {
        const document = cloneDocument();
        const withComponents = definitionsWithComponents(document);
        const target = withComponents[classPick % withComponents.length]!;
        const components = target['components'] as string[];
        components[classPick % components.length] = `l2.capability.missing-${missingSalt}`;

        const first = await compileFresh(document);
        const second = await compileFresh(document);

        expect(first.ok).toBe(false);
        expect(first.diagnostics.map((diagnostic) => diagnostic.code)).toContain('E_REF_MISSING');
        expect(
          first.diagnostics.some(
            (diagnostic) => diagnostic.code === 'E_REF_MISSING' && diagnostic.at?.def === target['id'],
          ),
        ).toBe(true);
        // 确定性：等价输入两次编译产出完全相同的诊断序列。
        expect(diagnosticSequence(second)).toEqual(diagnosticSequence(first));
        if (!first.ok) expect(first.canonicalSnapshot.generation).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
