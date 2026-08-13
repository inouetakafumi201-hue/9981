/**
 * 单元测试：五个领域模型的无死代码守卫。
 *
 * 实施前要求 1.6：导出的全部符号（常量、函数、类型）必须至少满足以下三种消费之一：
 * 1. 从 src/l2/model/index.ts 或 src/l2/index.ts 转出；
 * 2. 被其它生产代码 import（不计测试文件）；
 * 3. 是模块内的辅助纯函数，被同模块的已消费符号使用。
 *
 * 若增加新导出而未接入消费链，该测试必须失败。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = join(process.cwd(), 'src');
const L2_MODEL_DIR = join(SRC_DIR, 'l2', 'model');

const FIVE_MODELS = [
  'space-items-domain-ids.ts',
  'space-items-structural-bounds.ts',
  'space-items-numeric-ownership.ts',
  'space-items-diagnostic-categories.ts',
  'space-items-unresolved.ts',
] as const;

function extractExportedSymbols(filePath: string): Set<string> {
  const content = readFileSync(filePath, 'utf-8');
  const exports = new Set<string>();

  // export const/function/interface/type NAME
  const constExports = content.matchAll(/export\s+(?:const|function|interface|type)\s+(\w+)/g);
  for (const match of constExports) {
    exports.add(match[1]!);
  }

  // export { A, B, C }
  const namedExports = content.matchAll(/export\s+\{([^}]+)\}/g);
  for (const match of namedExports) {
    const names = match[1]!.split(',').map((s) => s.trim().split(/\s+/)[0]!);
    names.forEach((name) => exports.add(name));
  }

  return exports;
}

function isReExportedFromIndex(symbol: string): boolean {
  const modelIndexPath = join(L2_MODEL_DIR, 'index.ts');
  const l2IndexPath = join(SRC_DIR, 'l2', 'index.ts');

  const modelIndexContent = readFileSync(modelIndexPath, 'utf-8');
  const l2IndexContent = readFileSync(l2IndexPath, 'utf-8');

  // 检查 `export * from './space-items-XXX.js'` 这样的通配导出
  for (const model of FIVE_MODELS) {
    const moduleName = model.replace('.ts', '.js');
    const reExportPattern = new RegExp(`export\\s+\\*\\s+from\\s+['"]\\./${moduleName}['"]`);

    if (reExportPattern.test(modelIndexContent) || reExportPattern.test(l2IndexContent)) {
      // 该模块已被通配导出，其所有符号都被转出
      const originPath = join(L2_MODEL_DIR, model);
      const originContent = readFileSync(originPath, 'utf-8');

      const symbolPattern = new RegExp(`\\b${symbol}\\b`);
      if (symbolPattern.test(originContent)) {
        return true;
      }
    }
  }

  // 也检查具名转出
  const reExportPattern = new RegExp(`\\b${symbol}\\b`);
  return reExportPattern.test(modelIndexContent) || reExportPattern.test(l2IndexContent);
}

function isConsumedByProduction(symbol: string, originFile: string): boolean {
  // 简化实现：检查五个模型文件内部的互相消费
  for (const model of FIVE_MODELS) {
    if (model === originFile) continue;

    const path = join(L2_MODEL_DIR, model);
    const content = readFileSync(path, 'utf-8');

    const importPattern = new RegExp(`\\b${symbol}\\b`);
    if (importPattern.test(content)) {
      return true;
    }
  }

  return false;
}

describe('space-items 模型：无死代码守卫（实施前要求 1.6）', () => {
  for (const model of FIVE_MODELS) {
    it(`${model} 的全部导出符号被消费或转出`, () => {
      const filePath = join(L2_MODEL_DIR, model);
      const exports = extractExportedSymbols(filePath);

      expect(
        exports.size,
        `${model} 没有任何导出符号`,
      ).toBeGreaterThan(0);

      const unconsumed: string[] = [];

      for (const symbol of exports) {
        // 跳过 TypeScript 类型（仅编译期存在）
        if (symbol.startsWith('type ') || symbol.startsWith('interface ')) {
          continue;
        }

        const reExported = isReExportedFromIndex(symbol);
        const consumed = isConsumedByProduction(symbol, model);

        if (!reExported && !consumed) {
          unconsumed.push(symbol);
        }
      }

      expect(
        unconsumed,
        `${model} 有未消费的导出符号：${unconsumed.join(', ')}。` +
          `若这些符号确实需要导出，请确保它们被 src/l2/model/index.ts 或 src/l2/index.ts 转出，` +
          `或被其它生产代码 import。`,
      ).toHaveLength(0);
    });
  }
});

describe('space-items 模型：两级导出索引已接线（实施前要求 1.6）', () => {
  it('src/l2/model/index.ts 已导出五个模型', () => {
    const indexPath = join(L2_MODEL_DIR, 'index.ts');
    const content = readFileSync(indexPath, 'utf-8');

    for (const model of FIVE_MODELS) {
      const moduleName = model.replace('.ts', '.js');
      expect(
        content,
        `src/l2/model/index.ts 未导出 ${moduleName}`,
      ).toContain(moduleName);
    }
  });

  it('src/l2/index.ts 已导出五个模型', () => {
    const l2IndexPath = join(SRC_DIR, 'l2', 'index.ts');
    const content = readFileSync(l2IndexPath, 'utf-8');

    for (const model of FIVE_MODELS) {
      const moduleName = model.replace('.ts', '.js');
      expect(
        content,
        `src/l2/index.ts 未导出 ${moduleName}`,
      ).toContain(moduleName);
    }
  });
});
