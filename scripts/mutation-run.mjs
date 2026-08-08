/**
 * 变异自检运行器。
 *
 * 用法：
 *   node scripts/mutation-run.mjs                    # 跑 scripts/mutants/ 下全部变异体集
 *   node scripts/mutation-run.mjs prohibited-construct-gate
 *   node scripts/mutation-run.mjs <set> --only "<变异体名>" --test "<测试名筛选>"
 *
 * 目的是排除"测试空转"——一条断言若在实现被破坏后依然通过，它就没有约束力。
 * 每个变异体单独应用、跑一次测试、然后无条件还原源文件。
 *
 * 关键防呆：`--test` 筛选若命中 0 条用例，vitest 仍以 0 退出。运行器因此先在**未变异**的
 * 源码上跑一次基线，确认筛选真的命中了用例；否则一律判为 HARNESS-ERROR，而不是 SURVIVED。
 * （这个坑真实发生过：筛选串少了一个空格，13 个变异体被误判为存活。）
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { locate, applyMutant } from './mutation-eol.mjs';

const MUTANTS_DIR = path.join(import.meta.dirname, 'mutants');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      flags[token.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function runVitest(testPath, nameFilter) {
  const filter = nameFilter === undefined ? '' : ` -t ${JSON.stringify(nameFilter)}`;
  const raw = execSync(`npx vitest run ${testPath}${filter} --reporter=json --outputFile.json=.mutation-report.json`, {
    stdio: 'pipe',
    timeout: 600_000,
  });
  void raw;
  return JSON.parse(readFileSync('.mutation-report.json', 'utf8'));
}

/** 跑一次测试，返回 {ran, failed}。vitest 非零退出仍要读报告，因为失败正是我们要的信号。 */
function measure(testPath, nameFilter) {
  try {
    const report = runVitest(testPath, nameFilter);
    return { ran: report.numTotalTests - (report.numPendingTests ?? 0), failed: report.numFailedTests };
  } catch {
    let report = null;
    try {
      report = JSON.parse(readFileSync('.mutation-report.json', 'utf8'));
    } catch {
      return { ran: 0, failed: -1 };
    }
    return { ran: report.numTotalTests - (report.numPendingTests ?? 0), failed: report.numFailedTests };
  }
}

async function loadSets(requested) {
  const files = readdirSync(MUTANTS_DIR).filter((name) => name.endsWith('.mjs'));
  const chosen = requested === undefined ? files : files.filter((name) => name === `${requested}.mjs`);
  if (chosen.length === 0) {
    throw new Error(`no mutant set matched ${String(requested)}; available: ${files.join(', ')}`);
  }
  const sets = [];
  for (const file of chosen) {
    const module = await import(pathToFileURL(path.join(MUTANTS_DIR, file)).href);
    sets.push({ name: file.replace(/\.mjs$/, ''), ...module });
  }
  return sets;
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const sets = await loadSets(positional[0]);

let totalSurvived = 0;
let totalRun = 0;

for (const set of sets) {
  const original = readFileSync(set.target, 'utf8');
  const selected = flags.only === undefined ? set.mutants : set.mutants.filter((m) => m.name === flags.only);
  if (selected.length === 0) {
    console.log(`\n[${set.name}] --only "${flags.only}" 未匹配任何变异体，跳过。`);
    continue;
  }

  // 基线：未变异源码 + 同样的筛选。必须"有用例跑到且全部通过"，否则后续判定无意义。
  const baseline = measure(set.test, flags.test);
  if (baseline.ran === 0) {
    console.log(`\n[${set.name}] HARNESS-ERROR：筛选命中 0 条用例，无法判定。检查 --test 串。`);
    process.exitCode = 1;
    continue;
  }
  if (baseline.failed !== 0) {
    console.log(`\n[${set.name}] HARNESS-ERROR：基线就有 ${baseline.failed} 条失败，先修好再跑变异自检。`);
    process.exitCode = 1;
    continue;
  }

  const results = [];
  try {
    for (const mutant of selected) {
      const site = locate(original, mutant.from);
      if (site === null) {
        results.push({ name: mutant.name, status: 'PATTERN-NOT-FOUND' });
        continue;
      }
      if (site.count > 1) {
        results.push({ name: mutant.name, status: 'PATTERN-AMBIGUOUS' });
        continue;
      }
      writeFileSync(set.target, applyMutant(original, site, mutant.to));
      const outcome = measure(set.test, flags.test);
      const status = outcome.ran === 0 ? 'HARNESS-ERROR' : outcome.failed > 0 ? 'KILLED' : 'SURVIVED';
      results.push({ name: mutant.name, status });
      writeFileSync(set.target, original);
    }
  } finally {
    // 无论中途抛什么，源码必须还原。
    writeFileSync(set.target, original);
  }

  console.log(`\n[${set.name}] 基线 ${String(baseline.ran)} 条用例通过。变异自检：\n`);
  let survived = 0;
  for (const result of results) {
    if (result.status !== 'KILLED') survived += 1;
    console.log(`  ${result.status === 'KILLED' ? '✓' : '✗'} ${result.status.padEnd(18)} ${result.name}`);
  }
  console.log(`  ${String(results.length - survived)}/${String(results.length)} 个变异体被杀死`);
  totalSurvived += survived;
  totalRun += results.length;
}

console.log(`\n合计 ${String(totalRun - totalSurvived)}/${String(totalRun)} 个变异体被杀死`);
if (totalSurvived > 0) {
  console.log('存活的变异体表示对应断言空转，必须补强测试（不是删掉变异体）。');
  process.exitCode = 1;
}
