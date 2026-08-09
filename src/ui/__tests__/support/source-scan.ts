/**
 * 源文本扫描支撑：文件枚举与注释剥离。
 *
 * 为什么剥离注释：架构约束以源文本匹配实现（tasks.md T-7），而 design.md §3.2 要求在端口
 * 的文档注释里**写清**唯一写入链路（`ActionPort.submit` → … → `OpRegistry.invoke`）。
 * 如果扫描把注释一起匹配，就会出现"越把边界写清楚、越触发违规"的荒谬结果。
 * 因此扫描对象是**剥离注释后的代码**：注释可以自由讨论被禁标识符，代码不可以出现它们。
 *
 * 字符串字面量**不**剥离——用字符串绕过静态检查（例如动态取属性）正是要拦的形态。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export interface ScannedSource {
  /** 相对 `src/ui` 的正斜杠路径。 */
  readonly path: string;
  readonly absolutePath: string;
  readonly raw: string;
  /** 剥离注释后的代码。行数与 `raw` 一致，便于按行号定位。 */
  readonly code: string;
}

/** 剥离行注释与块注释，保留换行以维持行号对齐。 */
export function stripComments(source: string): string {
  let output = '';
  let index = 0;
  let mode: 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'backtick' = 'code';
  while (index < source.length) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line-comment';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        mode = 'block-comment';
        index += 2;
        continue;
      }
      if (char === "'") mode = 'single';
      else if (char === '"') mode = 'double';
      else if (char === '`') mode = 'backtick';
      output += char;
      index += 1;
      continue;
    }
    if (mode === 'line-comment') {
      if (char === '\n') {
        mode = 'code';
        output += char;
      }
      index += 1;
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        mode = 'code';
        index += 2;
        continue;
      }
      if (char === '\n') output += char;
      index += 1;
      continue;
    }
    // 字符串字面量：原样保留，但要正确跳过转义，避免把 \' 当成结束引号。
    output += char;
    if (char === '\\') {
      output += next;
      index += 2;
      continue;
    }
    if (
      (mode === 'single' && char === "'") ||
      (mode === 'double' && char === '"') ||
      (mode === 'backtick' && char === '`')
    ) {
      mode = 'code';
    }
    index += 1;
  }
  return output;
}

function walk(root: string, into: string[]): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      walk(path, into);
      continue;
    }
    if (entry.isFile() && (extname(entry.name) === '.ts' || extname(entry.name) === '.tsx')) {
      into.push(path);
    }
  }
}

/** 枚举 `src/ui` 下全部 TypeScript 源文件（含测试与测试支撑文件），按路径排序。 */
export function scanUiSources(uiRoot: string): readonly ScannedSource[] {
  const files: string[] = [];
  if (!statSync(uiRoot).isDirectory()) return Object.freeze([]);
  walk(uiRoot, files);
  return Object.freeze(
    files
      .map((absolutePath) => {
        const raw = readFileSync(absolutePath, 'utf8');
        return Object.freeze({
          path: relative(uiRoot, absolutePath).replaceAll('\\', '/'),
          absolutePath,
          raw,
          code: stripComments(raw),
        });
      })
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  );
}

/** 从剥离注释后的代码中抽取全部 import 说明符。 */
export function importSpecifiers(code: string): readonly string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu;
  for (const match of code.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return Object.freeze(specifiers);
}

/** 匹配结果的可读定位。 */
export function locate(source: ScannedSource, matchIndex: number, matched: string): string {
  const line = source.code.slice(0, matchIndex).split('\n').length;
  return `${source.path}:${String(line)}: ${matched}`;
}
