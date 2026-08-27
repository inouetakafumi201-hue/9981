/**
 * tasks.md D-5（scenes 切片）验收测试：证明 `src/class/scenes/index.json` 经
 * `SpecificationCompiler.compileAndActivate`（targetLayer: '基类层'）走真实的原子激活/回滚管线，
 * 并对该切片成立：
 *   - P8  引用图完整性与确定性拒绝：任意悬空组合引用 → 确定性 Structured_Rejection（E_REF_MISSING）。
 *   - P10 包激活、覆盖、删除的原子性与回滚：任一 Error → 零候选变更、活动快照不变。
 *
 * 切片边界（见 scene-catalog-activation.ts 顶部注释）：只覆盖 scenes 目录的
 * "类 + 能力 + 组合边"，不覆盖结构边界数值、值集合、过渡端点具体引用、禁令规则，
 * 也不覆盖其余 12 个基类层目录；D-5 全量仍未完成。
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseClassCatalog } from '../class-contract';
import { parseClassJson } from '../catalog-loader';
import { catalogText } from './catalog-fixtures';
import type { CandidateDocumentInput, CompilationResult } from '../../core/kernel/spec-compiler/index';
import {
  SCENE_COMPILER_SCHEMA_VERSION,
  activateSceneCatalog,
  buildSceneDocument,
  createSceneCompilerHost,
  sceneDocumentInput,
} from '../scene-catalog-activation';

const SCENE_CATALOG = parseClassCatalog(
  parseClassJson(catalogText('scenes'), 'scenes/index.json'),
  'scenes/index.json',
);

/** 深克隆纯 JSON 文档，使每次注入违规都从干净副本开始。 */
function cloneDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(buildSceneDocument(SCENE_CATALOG))) as Record<string, unknown>;
}

/** 把任意（可能被注入违规的）文档对象包装为编译器输入。 */
function inputFrom(document: unknown, overrides: Partial<CandidateDocumentInput> = {}): CandidateDocumentInput {
  return {
    sourceId: 'src:scene-corrupt',
    documentUri: 'file:///scene-corrupt.json',
    sourcePackage: 'wakeup-class-catalog',
    sourceText: JSON.stringify(document, null, 2),
    precedence: 100,
    owningLayer: '基类层',
    normativeStatus: 'normative',
    ...overrides,
  };
}

/** 在全新主机上编译一个文档对象（生产模式）。 */
function compileFresh(document: unknown, overrides: Partial<CandidateDocumentInput> = {}): Promise<CompilationResult> {
  return createSceneCompilerHost(SCENE_CATALOG).compiler.compileAndActivate(inputFrom(document, overrides));
}

/**
 * 诊断的确定性投影：代码 + 阶段，顺序敏感。
 *
 * 只取 code 与 stage 两个所有诊断（含基础设施诊断）都必有的字段，避免依赖仅候选诊断才带的
 * span/definitionId；编译器已对诊断做确定性排序，等价输入两次编译必须产出完全相同的序列。
 */
function diagnosticSequence(result: CompilationResult): readonly string[] {
  return result.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.stage}`);
}

describe('scenes 目录经规范编译器原子激活（D-5 scenes 切片）', () => {
  it('生产模式激活成功、无悬空引用、且产生确定性快照', async () => {
    const result = await activateSceneCatalog(SCENE_CATALOG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 成功激活推进一代并产生快照标识（Requirements 15.17 / P10 成功侧）。
    expect(result.snapshotId).not.toBeNull();
    expect(result.canonicalSnapshot.generation).toBe(1);
    // 真实目录内的组合引用全部可解析：不应出现任何 E_REF_MISSING（P8 正例）。
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'E_REF_MISSING')).toBe(false);

    // 确定性：两个相互独立的主机激活同一目录产出字节相同的产物哈希。
    const again = await activateSceneCatalog(SCENE_CATALOG);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.artifactHash).toBe(result.artifactHash);
      expect(again.canonicalSnapshot.canonicalModel).toBe(result.canonicalSnapshot.canonicalModel);
    }
  });

  it('P10 回滚：后续包激活失败时，先前已激活的 scenes 快照严格不变', async () => {
    const host = createSceneCompilerHost(SCENE_CATALOG);
    const first = await host.compiler.compileAndActivate(sceneDocumentInput(buildSceneDocument(SCENE_CATALOG)));
    expect(first.ok).toBe(true);
    const goodSnapshot = host.registry.canonicalSnapshot();
    expect(goodSnapshot.generation).toBe(1);

    // 第二个包：新增一个组合引用指向不存在能力的节点，作为独立包提交（不覆盖已激活定义）。
    const badDocument = {
      schemaVersion: SCENE_COMPILER_SCHEMA_VERSION,
      targetLayer: '基类层',
      definitions: [
        {
          id: 'scene.class.bogus',
          kind: 'node',
          abstract: true,
          semanticFamily: 'natural-scene',
          components: ['scene.capability.does-not-exist'],
        },
      ],
    };
    const second = await host.compiler.compileAndActivate(
      inputFrom(badDocument, { sourceId: 'src:bad', sourcePackage: 'pkg.scene.bad', documentUri: 'file:///bad.json' }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.unchangedState).toBe(true);
      expect(second.diagnostics.some((diagnostic) => diagnostic.code === 'E_REF_MISSING')).toBe(true);
    }

    // 先前已激活状态严格保持：代不变、规范模型字节不变。
    const afterSnapshot = host.registry.canonicalSnapshot();
    expect(afterSnapshot.generation).toBe(1);
    expect(afterSnapshot.canonicalModel).toBe(goodSnapshot.canonicalModel);
  });

  it('P10: 任意单点违规都被原子拒绝，全新注册表零候选变更（fast-check，100 次生成）', async () => {
    // 违规注入器：每个都必然导致拒绝。index 用于在定义数组内确定性选点。
    const corruptions = [
      'dangling-component',
      'duplicate-id',
      'bad-kind',
      'bad-family',
      'unknown-def-field',
      'unknown-top-field',
    ] as const;

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...corruptions),
        fc.nat(),
        async (corruption, pick) => {
          const document = cloneDocument();
          const definitions = document['definitions'] as Record<string, unknown>[];
          const withComponents = definitions.filter(
            (definition) => Array.isArray(definition['components']) && (definition['components'] as unknown[]).length > 0,
          );

          switch (corruption) {
            case 'dangling-component': {
              const target = withComponents[pick % withComponents.length]!;
              const components = target['components'] as string[];
              components[pick % components.length] = `scene.capability.missing-${pick}`;
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
          // 任一 Error → 拒绝、声明状态未变、零候选变更（全新注册表停留在第 0 代、无产物）。
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.unchangedState).toBe(true);
            expect(result.canonicalSnapshot.generation).toBe(0);
            expect(result.canonicalSnapshot.artifactHash).toBeNull();
            expect(result.diagnostics.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('P8: 任意悬空组合引用被确定性拒绝且诊断可复现（fast-check，100 次生成）', async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat(), fc.nat(), async (classPick, missingSalt) => {
        const document = cloneDocument();
        const definitions = document['definitions'] as Record<string, unknown>[];
        const withComponents = definitions.filter(
          (definition) => Array.isArray(definition['components']) && (definition['components'] as unknown[]).length > 0,
        );
        const target = withComponents[classPick % withComponents.length]!;
        const components = target['components'] as string[];
        components[classPick % components.length] = `scene.capability.missing-${missingSalt}`;

        const first = await compileFresh(document);
        const second = await compileFresh(document);

        // 悬空组合引用必须被拒绝，并给出 E_REF_MISSING。
        expect(first.ok).toBe(false);
        expect(first.diagnostics.map((diagnostic) => diagnostic.code)).toContain('E_REF_MISSING');
        // 受影响的宿主定义被点名。
        expect(
          first.diagnostics.some(
            (diagnostic) => diagnostic.code === 'E_REF_MISSING' && diagnostic.at?.def === target['id'],
          ),
        ).toBe(true);
        // 确定性：等价输入两次编译产出完全相同的诊断序列。
        expect(diagnosticSequence(second)).toEqual(diagnosticSequence(first));
        // 全新注册表未被触碰。
        if (!first.ok) expect(first.canonicalSnapshot.generation).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
