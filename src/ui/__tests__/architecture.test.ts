import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEPRECATED_TERM_REPLACEMENTS,
  REJECTED_LAYER_TERMS,
} from '../../l2/model/constitution';
import {
  importSpecifiers,
  locate,
  scanUiSources,
  stripComments,
  type ScannedSource,
} from './support/source-scan';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(TEST_DIR, '..');
const THIS_TEST = '__tests__/architecture.test.ts';

const FORBIDDEN_WRITE_IDENTIFIERS = [
  'OpRegistry',
  'registerOp',
  'defineQuery',
  'invokeInline',
  'prop.set',
  'prop.add',
] as const;

const ALLOWED_L2_CONTRACT_MODULES = new Set([
  '../../l2/model/projection',
  '../../l2/model/family-contracts',
  '../../l2/model/diagnostic-codes',
  '../../l2/model/constitution',
]);

/**
 * 任务 7.2 明确要求 profile 装载器复用内核严格 JSON 链。该例外只允许这一个文件的两个
 * 稳定编译器契约模块；其余 core 具体模块仍一律拒绝。
 */
const ALLOWED_PROFILE_COMPILER_MODULES = new Set([
  '../../core/kernel/spec-compiler/json-codec',
  '../../core/kernel/spec-compiler/types',
]);

const ANIMATION_FORBIDDEN_IMPORT_NAMES = [
  'ActionPort',
  'KernelContract',
  'intent-factory',
  '/submit',
] as const;

export interface ArchitectureViolation {
  readonly rule: 'write-identifier' | 'concrete-upstream-import' | 'animation-import' | 'terminology';
  readonly location: string;
}

function literalPattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu');
}

function importClauses(code: string): readonly { readonly clause: string; readonly specifier: string; readonly index: number }[] {
  const clauses: Array<{ clause: string; specifier: string; index: number }> = [];
  const pattern = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gu;
  for (const match of code.matchAll(pattern)) {
    if (match[1] !== undefined && match[2] !== undefined && match.index !== undefined) {
      clauses.push({ clause: match[1], specifier: match[2], index: match.index });
    }
  }
  return clauses;
}

function isAllowedUpstreamContractImport(source: ScannedSource, specifier: string): boolean {
  const allowedL2 = [...ALLOWED_L2_CONTRACT_MODULES].some((allowed) =>
    specifier.endsWith(allowed.slice('../..'.length)),
  );
  if (allowedL2) return true;
  return (
    source.path === 'profile/profile-loader.ts' &&
    ALLOWED_PROFILE_COMPILER_MODULES.has(specifier)
  );
}

export function inspectUiArchitecture(
  sources: readonly ScannedSource[],
): readonly ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const obsoleteTerms = new Set<string>([
    ...REJECTED_LAYER_TERMS,
    ...DEPRECATED_TERM_REPLACEMENTS.keys(),
  ]);

  for (const source of sources) {
    if (source.path === THIS_TEST) continue;

    for (const identifier of FORBIDDEN_WRITE_IDENTIFIERS) {
      for (const match of source.code.matchAll(literalPattern(identifier))) {
        violations.push({
          rule: 'write-identifier',
          location: locate(source, match.index ?? 0, identifier),
        });
      }
    }

    for (const specifier of importSpecifiers(source.code)) {
      const isUpstream = specifier.includes('/l2/') || specifier.includes('/core/');
      if (isUpstream && !isAllowedUpstreamContractImport(source, specifier)) {
        const index = source.code.indexOf(specifier);
        violations.push({
          rule: 'concrete-upstream-import',
          location: locate(source, Math.max(index, 0), specifier),
        });
      }
    }

    if (source.path.startsWith('animation/')) {
      for (const clause of importClauses(source.code)) {
        const importText = `${clause.clause} from ${clause.specifier}`;
        for (const forbidden of ANIMATION_FORBIDDEN_IMPORT_NAMES) {
          if (importText.includes(forbidden)) {
            violations.push({
              rule: 'animation-import',
              location: locate(source, clause.index, forbidden),
            });
          }
        }
      }
    }

    for (const term of obsoleteTerms) {
      for (const match of source.code.matchAll(literalPattern(term))) {
        violations.push({
          rule: 'terminology',
          location: locate(source, match.index ?? 0, term),
        });
      }
    }
    const numberedLayer = new RegExp(`\\b${'Layer'}\\s+[123]\\b`, 'gu');
    for (const match of source.code.matchAll(numberedLayer)) {
      violations.push({
        rule: 'terminology',
        location: locate(source, match.index ?? 0, match[0]),
      });
    }
  }

  return Object.freeze(violations.map((violation) => Object.freeze(violation)));
}

function synthetic(path: string, raw: string): ScannedSource {
  return Object.freeze({
    path,
    absolutePath: `synthetic/${path}`,
    raw,
    code: stripComments(raw),
  });
}

describe('UI 架构约束', () => {
  const sources = scanUiSources(UI_ROOT);

  it('扫描覆盖 src/ui 下全部 TypeScript 文件，含测试支撑但排除本测试自身判定', () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.some((source) => source.path === 'model/view.ts')).toBe(true);
    expect(sources.some((source) => source.path === '__tests__/support/source-scan.ts')).toBe(true);
    expect(sources.some((source) => source.path === THIS_TEST)).toBe(true);
  });

  it('当前 UI 代码没有写入标识符或未批准的上游具体实现依赖', () => {
    const violations = inspectUiArchitecture(sources).filter(
      (violation) =>
        violation.rule === 'write-identifier' ||
        violation.rule === 'concrete-upstream-import',
    );
    expect(violations).toEqual([]);
  });

  it('动画目录不导入交互提交能力', () => {
    expect(
      inspectUiArchitecture(sources).filter((violation) => violation.rule === 'animation-import'),
    ).toEqual([]);
  });

  it('当前 UI 代码遵守宪法术语纪律', () => {
    expect(
      inspectUiArchitecture(sources).filter((violation) => violation.rule === 'terminology'),
    ).toEqual([]);
  });

  it('人为注入写入标识符或具体上游 import 时机械失败', () => {
    const injected = [
      synthetic('bad-write.ts', "const write = OpRegistry;\n"),
      synthetic('bad-import.ts', "import { World } from '../../core/kernel/world';\n"),
    ];
    expect(inspectUiArchitecture(injected).map((item) => item.rule)).toEqual([
      'write-identifier',
      'concrete-upstream-import',
    ]);
  });

  it('人为向动画目录注入提交能力 import 时机械失败', () => {
    const injected = synthetic(
      'animation/bad.ts',
      "import type { ActionPort } from '../ports/action-port';\n",
    );
    expect(inspectUiArchitecture([injected])).toEqual([
      expect.objectContaining({ rule: 'animation-import' }),
    ]);
  });

  it('人为注入废用词时机械失败', () => {
    const obsolete = [...DEPRECATED_TERM_REPLACEMENTS.keys()][0];
    expect(obsolete).toBeDefined();
    const injected = synthetic('bad-term.ts', `const label = '${String(obsolete)}';\n`);
    expect(inspectUiArchitecture([injected])).toEqual([
      expect.objectContaining({ rule: 'terminology' }),
    ]);
  });
});
