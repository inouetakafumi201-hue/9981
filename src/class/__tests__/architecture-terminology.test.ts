import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(TEST_DIR, '../..');
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.json']);
const OBSOLETE_LAYER_TERM = '\u5185\u5bb9\u5c42';
const OBSOLETE_INSTANCE_WORD = '\u6a21\u677f';
const OLD_LAYER_PREFIX = 'Layer ';

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function withoutValidatorRejectionDictionary(path: string, source: string): string {
  const normalized = relative(SRC_ROOT, path).replaceAll('\\', '/');
  if (normalized !== 'core/kernel/spec-compiler/validator.ts') return source;
  const replacements = ['引擎层', '基类层', '玩法层'] as const;
  return replacements.reduce(
    (current, replacement, index) => current.replace(
      `  '${OLD_LAYER_PREFIX}${index + 1}': '${replacement}',`,
      '',
    ),
    source,
  );
}

describe('source architecture terminology', () => {
  it('contains no obsolete layer labels or architecture type identifiers', () => {
    const forbiddenPatterns = [
      { label: 'obsolete predecessor label for class layer', pattern: new RegExp(OBSOLETE_LAYER_TERM, 'g') },
      { label: 'standalone numbered layer label', pattern: new RegExp(`${OLD_LAYER_PREFIX}[123](?!\\d)`, 'g') },
      { label: 'architecture type identifier ending in Template', pattern: /\b[A-Za-z_$][\w$]*Template[\w$]*\b/g },
      { label: 'obsolete instance metadata field', pattern: /\btemplate(?:Id|Version)\b/g },
      { label: 'obsolete Chinese instance term', pattern: new RegExp(OBSOLETE_INSTANCE_WORD, 'g') },
    ] as const;
    const violations: string[] = [];

    for (const file of sourceFiles(SRC_ROOT)) {
      const source = withoutValidatorRejectionDictionary(file, readFileSync(file, 'utf8'));
      const normalized = relative(SRC_ROOT, file).replaceAll('\\', '/');
      for (const { label, pattern } of forbiddenPatterns) {
        for (const match of source.matchAll(pattern)) {
          const line = source.slice(0, match.index).split('\n').length;
          violations.push(`${normalized}:${line}: ${label}: ${match[0]}`);
        }
      }
      if (/template/i.test(file)) {
        violations.push(`${normalized}: obsolete architecture filename`);
      }
    }

    expect(violations).toEqual([]);
  });
});
