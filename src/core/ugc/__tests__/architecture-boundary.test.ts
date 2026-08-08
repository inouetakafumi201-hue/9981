/**
 * 静态架构边界（tasks.md 2.4 / design.md Security invariants 1-4；需求 1.2-1.3、2.4-2.7、3.5、13.9）。
 *
 * 这些断言不是形式检查：`.eslintrc.cjs` 的分层 `no-restricted-imports` 只覆盖
 * `src/core/kernel/<dir>/**`，完全不覆盖 `src/core/ugc/**`（实施基线记录 §1.1.2）。
 * 因此 UGC 的运行时写入禁令、动态执行禁令和禁止导入清单**只由本文件强制**。
 *
 * 检查方式是读取源码文本做静态扫描，而不是运行期反射：运行期只能观察到被执行到的路径，
 * 而边界违规恰恰可能藏在没被测试覆盖的分支里。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const UGC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface SourceFile {
  readonly relativePath: string;
  readonly text: string;
  readonly isTest: boolean;
}

function collectSourceFiles(directory: string, accumulated: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      collectSourceFiles(absolute, accumulated);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    const relativePath = relative(UGC_ROOT, absolute).replace(/\\/g, '/');
    accumulated.push({
      relativePath,
      text: readFileSync(absolute, 'utf8'),
      isTest: relativePath.includes('__tests__') || relativePath.endsWith('.test.ts'),
    });
  }
  return accumulated;
}

const allFiles = collectSourceFiles(UGC_ROOT);
const productionFiles = allFiles.filter((file) => !file.isTest);

/** 去掉注释与字符串字面量，避免把文档说明或诊断文案误判为代码违规。 */
function stripCommentsAndStrings(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""');
}

function importedModules(text: string): string[] {
  const code = stripCommentsAndStrings(text);
  const specifiers: string[] = [];
  // 剥离字符串后 import 路径也被清空，因此这里回到原文只取 import/export ... from '...' 的路径。
  for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  void code;
  return specifiers;
}

/** UGC 允许从内核导入的模块白名单。全部是零运行时逻辑的**纯类型/纯数据**模块。 */
const ALLOWED_KERNEL_IMPORTS: readonly string[] = [
  '../../kernel/state/diagnostic.js',
  '../../kernel/state/error-codes.js',
  '../../kernel/state/value.js',
  '../../kernel/safety/safety.js',
];

const FORBIDDEN_KERNEL_SEGMENTS: readonly string[] = [
  'kernel/state/world-state',
  'kernel/state/def',
  'kernel/ops',
  'kernel/events',
  'kernel/flow',
  'kernel/actions',
  'kernel/decision',
  'kernel/attachment',
  'kernel/schedule',
  'kernel/random',
  'kernel/knowledge',
  'kernel/persistence',
  'kernel/topology',
  'kernel/expr',
  'kernel/spec-compiler',
  'kernel/ai',
];

describe('Feature: wakeup-ugc, architecture boundary', () => {
  it('scans a non-trivial number of production files', () => {
    // 防御性断言：若收集逻辑坏掉返回空集合，下面所有断言都会空转通过。
    expect(productionFiles.length).toBeGreaterThan(20);
  });

  it('never imports runtime-mutating kernel modules from production code', () => {
    const violations: string[] = [];
    for (const file of productionFiles) {
      for (const specifier of importedModules(file.text)) {
        const normalized = specifier.replace(/\\/g, '/');
        for (const forbidden of FORBIDDEN_KERNEL_SEGMENTS) {
          if (normalized.includes(forbidden)) {
            violations.push(`${file.relativePath} -> ${specifier}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('imports only the approved pure-type kernel modules', () => {
    const unexpected: string[] = [];
    for (const file of productionFiles) {
      for (const specifier of importedModules(file.text)) {
        const normalized = specifier.replace(/\\/g, '/');
        if (!normalized.includes('kernel/')) continue;
        if (!ALLOWED_KERNEL_IMPORTS.some((allowed) => normalized.endsWith(allowed.replace('../../', '')))) {
          unexpected.push(`${file.relativePath} -> ${specifier}`);
        }
      }
    }
    expect(unexpected).toEqual([]);
  });

  it('never imports the base layer while it is unfrozen', () => {
    // 实施基线记录 §1.2.5：src/l2 正在被并行会话写入，未冻结，禁止耦合。
    const violations = productionFiles
      .flatMap((file) => importedModules(file.text).map((specifier) => ({ file, specifier })))
      .filter(({ specifier }) => specifier.replace(/\\/g, '/').includes('/l2/'))
      .map(({ file, specifier }) => `${file.relativePath} -> ${specifier}`);
    expect(violations).toEqual([]);
  });
});

describe('Feature: wakeup-ugc, dynamic execution surface', () => {
  it('contains no dynamic code execution construct in production code', () => {
    const patterns: readonly { readonly name: string; readonly regex: RegExp }[] = [
      { name: 'eval call', regex: /\beval\s*\(/ },
      { name: 'Function constructor', regex: /\bnew\s+Function\s*\(/ },
      { name: 'Function call', regex: /\bFunction\s*\(/ },
      { name: 'dynamic import', regex: /\bimport\s*\(/ },
      { name: 'child_process', regex: /child_process/ },
      { name: 'process spawn/exec', regex: /\b(?:spawn|execSync|execFile|exec)\s*\(/ },
      { name: 'setTimeout with string', regex: /setTimeout\s*\(\s*["'`]/ },
      { name: 'indirect global eval', regex: /globalThis\s*\[\s*["'`]eval/ },
    ];

    const violations: string[] = [];
    for (const file of productionFiles) {
      const code = stripCommentsAndStrings(file.text);
      for (const pattern of patterns) {
        if (pattern.regex.test(code)) {
          violations.push(`${file.relativePath}: ${pattern.name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('never references WorldState, OpRegistry, Hook dispatch or persistence writers', () => {
    const forbiddenIdentifiers: readonly string[] = [
      'WorldState',
      'OpRegistry',
      'HookDispatcher',
      'takeSnapshot',
      'applyMigration',
      'CheckpointStore',
      'Journal',
      'MigrationDef',
      'DefRegistry',
    ];
    const violations: string[] = [];
    for (const file of productionFiles) {
      const code = stripCommentsAndStrings(file.text);
      for (const identifier of forbiddenIdentifiers) {
        if (new RegExp(`\\b${identifier}\\b`).test(code)) {
          violations.push(`${file.relativePath}: ${identifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('exposes no force/skip/trusted bypass in the public export root', () => {
    const rootFile = allFiles.find((file) => file.relativePath === 'index.ts');
    expect(rootFile).toBeDefined();
    const code = stripCommentsAndStrings(rootFile?.text ?? '');
    for (const forbidden of ['forceActivate', 'skipValidation', 'trustedSource', 'activateWithErrors']) {
      expect(code).not.toContain(forbidden);
    }
    // 铸造能力绝不从公共根导出（需求 3.9、13.1）。
    expect(code).not.toContain('createValidatedChangeSet');
    expect(code).not.toContain('mintValidatedChangeSet');
  });
});
