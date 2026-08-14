// 数据文件静态 JSON 可解析守卫。
// 目标：把"批次改坏 JSON 导致运行时崩溃"提前到静态就拦住——
// 现状 status_heavy.json / status_slowed.json 曾因未转义引号致依赖 suite 崩溃。
// 本脚本只管"严格 JSON.parse 通过 + 已知 JSON 陷阱"，不做任何数据内容校验（那是各契约测试的事）。
//
// 扫描范围：
//   - src/play/profiles/**/*.json
//   - src/class/**/*.json   （含各 index.json 与 status_*.json 等）
// 任何文件解析失败即 exit 1，列出错误文件与定位。
// 已知陷阱（本轮固定检查，防止复发）：
//   - 未转义的裸 ASCII 直引号包裹中文引述（"…" 应写作 \"…\" 或改用中文引号）
//   - 尾随逗号（JSON 不允许）
//   - UTF-8 BOM（BOM 会让严格 parse 对首字符报错，也属于已坏文件）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [join('src', 'play', 'profiles'), join('src', 'class')];

let filed = false;

function walk(dir, onFile) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // 目录尚未铺设时静默跳过
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, onFile);
    else if (p.endsWith('.json')) onFile(p);
  }
}

function collectJson(root) {
  const out = [];
  walk(root, (p) => out.push(p));
  return out;
}

// 提取 V8 SyntaxError 中"位置"的启发式解析：优先 line/column 字段，其次 position。
function locFromError(err) {
  const msg = err instanceof SyntaxError ? err.message : String(err);
  const p = msg.match(/position (\d+)/);
  return { msg: msg.replace(/\d+/, '') ? msg : msg, position: p ? Number(p[1]) : null };
}

const all = [];
for (const root of ROOTS) all.push(...collectJson(root));

const failures = [];

for (const file of all) {
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);

  // 陷阱 1：BOM —— 首字符 U+FEFF 使严格 parse 必然失败。
  if (raw.charCodeAt(0) === 0xfeff) {
    filed = true;
    failures.push(new Map([['file', file], ['kind', 'BOM'], ['detail', '文件以 UTF-8 BOM 开头，严格 JSON.parse 必然失败'], ['lines', lines]]));
    continue;
  }

  // 判据：严格 JSON.parse。
  try {
    JSON.parse(raw);
  } catch (err) {
    filed = true;
    const { msg, position } = locFromError(err);
    // position 是全局字符偏移，换算成行列便于定位。
    let line = 1, col = 1, acc = 0;
    if (position != null) {
      for (let i = 0; i < lines.length && acc + lines[i].length + 1 <= position; i++) {
        acc += lines[i].length + 1;
        line++;
      }
      col = position - acc + 1;
    }
    failures.push(new Map([
      ['file', file],
      ['kind', `JSON.parse 失败: ${msg}`],
      ['detail', `行列 ~L${line}:C${col}`],
      ['lines', lines],
    ]));
  }
}

if (!filed) {
  console.log(`✓ 全部 ${all.length} 份数据文件均可严格 JSON.parse：`);
  console.log(`  src/play/profiles/** (*.json) = ${all.filter((f) => f.includes('profiles')).length} 份；src/class/**/index.json + *.json = ${all.filter((f) => !f.includes('profiles')).length} 份`);
  process.exit(0);
}

console.log(`✗ ${failures.length} 处数据文件不可解析：\n`);
for (const f of failures) {
  console.log(`${f.get('file')}`);
  console.log(`    [${f.get('kind')}] ${f.get('detail')}`);
  // 从出错行回显（启发式：直接展示所有含直引号/尾随逗号的行，帮定位）。
  const lines = f.get('lines');
  lines.forEach((line, i) => {
    const trimmed = line.trimEnd();
    const isSuspect =
      trimmed.endsWith(',') ||                 // 尾随逗号
      ((line.match(/"/g) ?? []).length % 2 === 1); // 奇数个直引号（未转义）
    if (isSuspect) console.log(`    L${i + 1}: ${line.slice(0, 140)}`);
  });
  console.log();
}
process.exit(1);
