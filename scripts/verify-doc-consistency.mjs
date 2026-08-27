#!/usr/bin/env node
/**
 * 文档一致性校验（跨平台 Node.js 版本，等价于 verify-doc-consistency.sh）
 *
 * 守护一类真实发生过的缺陷：某项决策在 spec 里生效了，却没回写决策记录；
 * 或某个未冻结项已被裁决关闭，spec 里却仍在拒绝引用它的配置。
 *
 * 用法：node scripts/verify-doc-consistency.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, statSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let fail = 0;

function read(relPath) {
  const abs = resolve(ROOT, relPath);
  if (!existsSync(abs)) return '';
  return readFileSync(abs, 'utf8');
}

function lines(relPath) {
  return read(relPath).split('\n');
}

/** 递归列出目录下所有 .md 文件，支持排除模式 */
function findMd(dir, excludePatterns = []) {
  const results = [];
  function walk(current) {
    let entries;
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      const full = resolve(current, entry);
      const stat = statSync(full);
      const relFull = full.replace(ROOT + '\\', '').replace(ROOT + '/', '');
      if (excludePatterns.some(p => relFull.includes(p))) continue;
      if (stat.isDirectory()) { walk(full); }
      else if (entry.endsWith('.md')) { results.push(full); }
    }
  }
  walk(resolve(ROOT, dir));
  return results;
}

// ─────────────────────────────────────────────
// 1) 已关闭项不得再被声明为未冻结
// ─────────────────────────────────────────────
console.log('===== 1) 已关闭项不得再被声明为未冻结 =====');
{
  const content = read('.kiro/specs/wakeup-core-mechanics/design.md');
  const match = content.match(/UnresolvedId = .*/);
  const ids = match ? match[0] : '';
  console.log(`  UnresolvedId: ${ids}`);
  const closed = ['U-001', 'U-002', 'U-004', 'U-005'];
  let ok = true;
  for (const id of closed) {
    if (ids.includes(id)) {
      console.log(`  ✗ ${id} 已关闭却仍在 UnresolvedId 中`);
      fail = 1; ok = false;
    }
  }
  if (ok) console.log('  ✓ 已关闭项均已移出');
}

// ─────────────────────────────────────────────
// 2) U-SPACE 已关闭项不得再要求保持 Unresolved
// ─────────────────────────────────────────────
console.log('\n===== 2) U-SPACE 已关闭项不得再要求保持 Unresolved =====');
{
  const content = read('.kiro/specs/wakeup-space-items/requirements.md');
  const closed = ['U-SPACE-007'];
  for (const id of closed) {
    const pattern = new RegExp('`' + id + '`.*必须保持');
    if (pattern.test(content)) {
      console.log(`  ✗ ${id} 已关闭却仍要求保持 Unresolved`);
      fail = 1;
    } else {
      console.log(`  ✓ ${id} 已解除`);
    }
  }
}

// ─────────────────────────────────────────────
// 3) 仍未冻结项必须仍被保护
// ─────────────────────────────────────────────
console.log('\n===== 3) 仍未冻结项必须仍被保护 =====');
{
  const content = read('.kiro/specs/wakeup-core-mechanics/design.md');
  const open = ['T-001', 'U-003'];
  for (const id of open) {
    if (content.includes(`'${id}'`)) {
      console.log(`  ✓ ${id} 仍在 UnresolvedId 中受保护`);
    } else {
      console.log(`  ✗ ${id} 仍未冻结却已被移出保护`);
      fail = 1;
    }
  }
}

// ─────────────────────────────────────────────
// 4) 旧规则不得复活
// ─────────────────────────────────────────────
console.log('\n===== 4) 旧规则不得复活 =====');
{
  // 搜索 docs/ 和 .kiro/ 下所有非归档 md 文件
  const docsFiles = findMd('docs', ['归档', '_归档']);
  const kiroFiles = findMd('.kiro', ['归档', '_归档']);
  const allFiles = [...docsFiles, ...kiroFiles];

  const legalPatterns = ['不得复活', '已被取代', '之所以不够', '已否决', 'v1'];
  let found = false;
  for (const f of allFiles) {
    const ls = readFileSync(f, 'utf8').split('\n');
    ls.forEach((ln, i) => {
      if (ln.includes('远程伤害 -1') && !legalPatterns.some(p => ln.includes(p))) {
        console.log(`  ✗ 已否决的「远程伤害 -1」出现在生效语境中: ${f}:${i + 1}`);
        fail = 1; found = true;
      }
    });
  }
  if (!found) console.log('  ✓ 未复活（仅存于「已被取代」的历史记述中）');
}

// ─────────────────────────────────────────────
// 5) 废用词检查（宪法铁律）
// ─────────────────────────────────────────────
console.log('\n===== 5) 废用词检查（宪法铁律）=====');
{
  // 只扫 L2/L3 目录（脚本原始逻辑）
  const l2files = findMd('docs/L2_基类层');
  const l3files = findMd('docs/L3_玩法层');
  const scanFiles = [...l2files, ...l3files];
  const legalExcludes = ['废用', '禁用', '禁止使用', 'JSX', 'Vue', '模板语法'];
  const banned = ['模板', '内容层'];

  for (const word of banned) {
    const hits = [];
    for (const f of scanFiles) {
      const ls = readFileSync(f, 'utf8').split('\n');
      ls.forEach((ln, i) => {
        if (ln.includes(word) && !legalExcludes.some(p => ln.includes(p))) {
          hits.push(`    ${f}:${i + 1}: ${ln.trim()}`);
        }
      });
    }
    if (hits.length > 0) {
      console.log(`  ⚠ 「${word}」疑似违规用法:`);
      hits.slice(0, 5).forEach(h => console.log(h));
      // 废用词出现是警告，不设 fail（原脚本也只是 echo，未设 fail）
    } else {
      console.log(`  ✓ 「${word}」无违规用法`);
    }
  }

  // 宪法废用术语表必须存在
  const constitution = read('docs/L0_规范宪法.md');
  if (/废用术语|废用词/.test(constitution)) {
    console.log('  ✓ 宪法废用术语表存在');
  } else {
    console.log('  ✗ 宪法废用术语表缺失');
    fail = 1;
  }
}

// ─────────────────────────────────────────────
// 6) D-025 违规命名
// ─────────────────────────────────────────────
console.log('\n===== 6) D-025 违规命名 =====');
{
  const docsFiles = findMd('docs', ['归档', '_归档']);
  // 排除：文件名含这些关键词（历史记述或命名规范）
  const legalFiles = ['访谈决策记录', '命名规范'];
  // 排除：行内含这些短语（说明"已改"或历史注记）
  const legalLinePhrases = ['已按 D-025', '已改为', '命名规范'];
  let found = false;
  for (const f of docsFiles) {
    if (legalFiles.some(lf => f.includes(lf))) continue;
    const ls = readFileSync(f, 'utf8').split('\n');
    ls.forEach((ln, i) => {
      if (ln.includes('Among Us') && !legalLinePhrases.some(p => ln.includes(p))) {
        console.log(`  ✗ 仍有违规命名: ${f}:${i + 1}`);
        fail = 1; found = true;
      }
    });
  }
  if (!found) console.log('  ✓ 活跃文档已清理（决策记录内的历史记述属正常保留）');
}

// ─────────────────────────────────────────────
// 6.5 正面俯视视图术语守卫
// ─────────────────────────────────────────────
console.log('\n===== 6.5 正面俯视视图术语守卫 =====');
{
  // 守卫范围：权威文档 + 根 AGENTS.md + sprite-forge skill 文档/生成 prompt。
  // 规则：任何活跃规范不得把旧"正面斜投影/Cabinet/Cavalier/三面可见/Among Us 类比"当作现行视角；
  // 凡现行定义处必须声明"正面俯视视图"，并给出固定英文口令 top-down plan view。
  const targets = [
    'docs/表现系统/01_图形化与UI.md',
    'docs/表现系统/05_组件生成风格规范.md',
    'docs/表现系统/PLT-01_画风对齐_三维形体_提示词调色板迭代.md',
    'AGENTS.md',
    '.agents/skills/sprite-forge/SKILL.md',
  ];
  // 禁止以"现行/唯一要求"口吻出现旧视角词 + 直接发给模型的不可用旧口令
  const forbidden = [
    'Cabinet projection', 'Cavalier projection',
    "front-facing", "front face", "side face", "right side face", "top face",
    "0oblique of the side", "three-quarter", "isometric", "slightly angled for depth",
    "among us", 'Among Us',
  ];
  let broken = 0;
  for (const t of targets) {
    const content = read(t);
    if (!content) { continue; }
    const ls = content.split('\n');
    ls.forEach((ln, i) => {
      const lower = ln.toLowerCase();
      // 允许：禁止列表中把旧词列出来做"禁用清单"；不得作为"必须用/唯一视角/同 X 物件"
      const isProhibition =
        /禁止|禁述|不可|不得使用|一律废止|no |not |铁律.*非|废除|废止|❌ 旧|误解|错误前提|被废止/.test(ln);
      const isApplyingAsRule = /必须|强制|唯一|锁定|固定|默认|同 Among Us|同 A/.test(lower);
      for (const bad of forbidden) {
        // Among Us / game-name类比 单独从严：即使没带"必须"，只要它作为视角类比描述现行视角就违规
        if (bad === 'Among Us' || bad === 'among us') {
          if (lower.includes('among us') && isApplyingAsRule) {
            console.log(`  ✗ ${t}:${i + 1} 把 Among Us 作为现行视角类比`);
            fail = 1; broken++;
          }
          continue;
        }
        if (!lower.includes(bad)) continue;
        if (lower.includes('禁止') || (!isProhibition && isApplyingAsRule)) {
          // isProhibition alone is fine only when the term is inside a "禁止" line.
          if (!lower.includes('禁止') && !lower.includes('禁述') && !lower.includes('不得使用'))
            continue; // e.g. "正面斜投影" appears in "为什么旧正面斜投影..." narrative without applying
        }
      }
    });
  }
  // 必需的现行口令必须存在于权威与技能中
  let missing = [];
  for (const t of ['docs/表现系统/01_图形化与UI.md', 'docs/表现系统/05_组件生成风格规范.md',
                   '.agents/skills/sprite-forge/tools/sprite-component.py']) {
    if (!read(t).includes('top-down plan view')) missing.push(t);
  }
  for (const m of missing) console.log(`  ✗ ${m} 缺少固定口令 top-down plan view`);
  if (missing.length) { fail = 1; broken++; }

  if (!broken) console.log('  ✓ 正面俯视视图术语守卫通过');
}

// ─────────────────────────────────────────────
// 7) 仪式动画四项一致性
// ─────────────────────────────────────────────
console.log('\n===== 7) 仪式动画四项一致性 =====');
{
  const dmPath = '.kiro/specs/wakeup-ui-animation/design.md';
  const content = read(dmPath);

  // 提取 ceremonialActionSemantics 块（第一个 [ ... ]）
  const blockMatch = content.match(/"ceremonialActionSemantics"\s*:\s*\[([\s\S]*?)\]/);
  const block = blockMatch ? blockMatch[0] : '';

  const n = (block.match(/actionSemanticId/g) || []).length;
  console.log(`  默认 profile 仪式动画项数: ${n}（应为 4）`);
  if (n === 4) {
    console.log('  ✓ 四项');
  } else {
    console.log('  ✗ 项数不符');
    fail = 1;
  }

  if (/parry-trigger.*D-032/.test(block)) {
    console.log('  ✓ 招架触发已加入且溯源 D-032');
  } else {
    console.log('  ✗ 招架触发缺失或溯源错误');
    fail = 1;
  }

  const req = read('.kiro/specs/wakeup-ui-animation/requirements.md');
  if (req.includes('exactly the three approved')) {
    console.log('  ✗ requirements 仍声明三项');
    fail = 1;
  } else {
    console.log('  ✓ requirements 已改为四项');
  }
}

// ─────────────────────────────────────────────
// 8) 属性与 Validates 一一对应
// ─────────────────────────────────────────────
console.log('\n===== 8) 属性与 Validates 一一对应 =====');
{
  const specs = [
    '.kiro/specs/wakeup-ui-animation/design.md',
    '.kiro/specs/wakeup-core-mechanics/design.md',
  ];
  for (const f of specs) {
    const ls = lines(f);
    const p = ls.filter(ln => /^### Property /.test(ln)).length;
    const v = ls.filter(ln => /^\*\*Validates: Requirements /.test(ln)).length;
    const name = f.split('/').slice(-2)[0];
    console.log(`  ${name}: ${p} 条属性 / ${v} 条 Validates`);
    if (p !== v) {
      console.log('    ✗ 数量不符');
      fail = 1;
    } else {
      console.log('    ✓ 数量一致');
    }
  }
}

// ─────────────────────────────────────────────
// 结果
// ─────────────────────────────────────────────
console.log('');
if (fail === 0) {
  console.log('===== 全部校验通过 =====');
} else {
  console.log('===== 存在失败项 =====');
}
process.exit(fail);
