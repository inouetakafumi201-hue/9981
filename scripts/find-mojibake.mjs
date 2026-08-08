// 扫描源码树中的 mojibake（U+FFFD 替换字符）。
// 这类损坏通常来自 GBK/UTF-8 编码转换失误：多字节汉字被截断成 U+FFFD，
// 若恰好落在字符串字面量里就会导致 esbuild 解析失败。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) roots.push('src');

const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|json|md)$/.test(name)) scan(p);
  }
}

function scan(file) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('�')) return;
  const lines = text.split(/\r?\n/);
  const bad = [];
  lines.forEach((line, i) => {
    const n = (line.match(/�/g) ?? []).length;
    if (n > 0) bad.push({ line: i + 1, count: n, text: line.slice(0, 100) });
  });
  hits.push({ file, total: bad.reduce((s, b) => s + b.count, 0), bad });
}

for (const r of roots) {
  const st = statSync(r);
  if (st.isDirectory()) walk(r);
  else scan(r);
}

if (hits.length === 0) {
  console.log('✓ 未发现 mojibake');
  process.exit(0);
}

console.log(`✗ ${hits.length} 个文件含 mojibake\n`);
for (const h of hits) {
  console.log(`${h.file}  (${h.total} 处)`);
  for (const b of h.bad) console.log(`  L${b.line} ×${b.count}: ${b.text}`);
  console.log();
}
process.exit(1);
