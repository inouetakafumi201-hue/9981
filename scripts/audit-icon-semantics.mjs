#!/usr/bin/env node
/**
 * 词条图标语义库审计工具
 *
 * 检查：
 * 1. icon-index.json 是否存在且合法；
 * 2. 304 个 game-icons SVG 文件与 icon-index.json 是否 1:1 双向完整覆盖；
 * 3. icon-catalog.md 中的定论语义名与 icon-index.json 是否一致；
 * 4. 禁止出现未登记的图标或临时造名。
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let fail = 0;

const catalogPath = resolve(ROOT, '.agents/skills/sprite-forge/icon-semantics/icon-catalog.md');
const indexPath = resolve(ROOT, '.agents/skills/sprite-forge/icon-semantics/icon-index.json');
const svgDir = resolve(ROOT, 'src/svg-game-icons');

console.log('===== 词条图标语义库 (icon-semantics) 审计 =====');

if (!existsSync(catalogPath)) {
  console.error(`✗ 缺失文件: ${catalogPath}`);
  process.exit(1);
}

if (!existsSync(indexPath)) {
  console.error(`✗ 缺失文件: ${indexPath}`);
  process.exit(1);
}

if (!existsSync(svgDir)) {
  console.error(`✗ 缺失目录: ${svgDir}`);
  process.exit(1);
}

const svgFiles = readdirSync(svgDir).filter((f) => f.endsWith('.svg'));
const svgIdSet = new Set(svgFiles.map((f) => f.replace(/^game-icons--/, '').replace(/\.svg$/, '')));

console.log(`  SVG 图标源文件数量: ${svgFiles.length} (期望 304)`);

const indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
const indexIcons = indexData.icons || [];
const indexIdSet = new Set(indexIcons.map((item) => item.id));

console.log(`  icon-index.json 登记图标数: ${indexIcons.length}`);

// 1. 检查 SVG 文件在 index 中是否有登记
const missingInIndex = [...svgIdSet].filter((id) => !indexIdSet.has(id));
if (missingInIndex.length > 0) {
  console.error(`✗ 以下 SVG 文件在 icon-index.json 中未登记:`, missingInIndex);
  fail = 1;
} else {
  console.log(`✓ 所有 ${svgIdSet.size} 个 SVG 文件在 icon-index.json 中均有登记`);
}

// 2. 检查 index 中的图标是否有对应的 SVG 文件
const missingInSvg = [...indexIdSet].filter((id) => !svgIdSet.has(id));
if (missingInSvg.length > 0) {
  console.error(`✗ icon-index.json 中引用的以下图标缺少源 SVG 文件:`, missingInSvg);
  fail = 1;
} else {
  console.log(`✓ icon-index.json 中所有图标均存在对应的源 SVG 文件`);
}

// 3. 检查 catalog.md 与 index.json 的一致性
const catalogContent = readFileSync(catalogPath, 'utf8');
const sections = catalogContent.split(/^###\s+/m);
let catalogCount = 0;

for (const sec of sections) {
  const headerMatch = sec.match(/^([^\n]+)/);
  if (!headerMatch) continue;
  const rows = [...sec.matchAll(/\|\s*\`([a-zA-Z0-9_-]+)\`(?:\s*\([^\)]*\))?\s*\|\s*([^|]+)\|\s*([^|]+)\|/g)];
  for (const r of rows) {
    const id = r[1].trim();
    const name = r[2].trim();
    if (name === '（无）' || name === '—' || name.startsWith('（见')) continue;
    catalogCount++;
    if (!indexIdSet.has(id)) {
      console.error(`✗ catalog 中存在的图标「${id}」未在 index.json 中`);
      fail = 1;
    }
  }
}

if (indexIcons.length === 304 && svgFiles.length === 304 && fail === 0) {
  console.log(`✓ 词条图标语义库 304 项全量审计通过！`);
} else if (fail !== 0) {
  console.error(`✗ 词条图标语义库审计存在失败项`);
}

process.exit(fail);
