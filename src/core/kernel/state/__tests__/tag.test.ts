import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hasTag } from '../tag.js';

describe('Tag 机制（需求4.1-4.4）', () => {
  it('hasTag 正确判断标签存在性', () => {
    expect(hasTag({ tags: ['flammable', 'metal'] }, 'metal')).toBe(true);
    expect(hasTag({ tags: ['flammable'] }, 'metal')).toBe(false);
    expect(hasTag(null, 'metal')).toBe(false);
    expect(hasTag({}, 'metal')).toBe(false);
  });

  it('架构测试：kernel/state 源码不存在硬编码分类联合类型（需求4.1）', () => {
    const stateDir = join(process.cwd(), 'src/core/kernel/state');
    const files = readdirSync(stateDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    // 扫描是否出现常见的"分类枚举"字面量模式：形如 'weapon'|'armor'|'consumable' 这类具体玩法词汇
    const forbiddenWords = ['weapon', 'armor', 'consumable', 'monster', 'npc_type', 'itemcategory'];
    for (const file of files) {
      const content = readFileSync(join(stateDir, file), 'utf-8').toLowerCase();
      for (const word of forbiddenWords) {
        expect(content.includes(word)).toBe(false);
      }
    }
  });
});
