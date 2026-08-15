// 变异测试驱动器。
//
// 目的：证明测试套件不是空转的。基线实现带 9 个 bug 却通过了 10 万次属性测试，
// 说明"测试通过"和"覆盖率 100%"都不能证明测试有效。唯一的证明方式是注入故障，
// 验证测试必然失败。
//
// 流程：备份 src/topology.ts → 逐个应用变异 → 跑快速测试子集 → 记录是否被杀死 → 恢复原文件。
// find 字符串必须在源码中恰好出现一次，否则该变异标记为 INVALID（防止静默 no-op）。

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { MUTANTS, type Mutant } from './mutants';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'topology.ts');
const BACKUP = path.join(ROOT, 'src', 'topology.ts.orig');
const CONFIG = path.join(ROOT, 'vitest.mutation.config.ts');

function findVitestBin(): string {
  const candidates = [
    path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
    path.join(ROOT, 'node_modules', 'vitest', 'dist', 'cli.js'),
    path.join(ROOT, 'node_modules', 'vitest', 'dist', 'cli-wrapper.js')
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('找不到 vitest 可执行入口: ' + candidates.join(', '));
}

const VITEST = findVitestBin();

interface Result {
  mutant: Mutant;
  status: 'KILLED' | 'SURVIVED' | 'INVALID';
  killedBy: string[];
  note?: string;
}

/** 跑一次测试子集。返回 { failed, failedTests }。 */
function runTests(): { failed: boolean; failedTests: string[] } {
  const r = spawnSync(
    process.execPath,
    [VITEST, 'run', '--config', CONFIG, '--reporter=json', '--outputFile=mutation/.result.json'],
    {
      cwd: ROOT,
      env: { ...process.env, L7_RUNS: '600', CI: 'true' },
      encoding: 'utf8',
      timeout: 180_000
    }
  );

  const failedTests: string[] = [];
  const resultPath = path.join(ROOT, 'mutation', '.result.json');
  if (fs.existsSync(resultPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      for (const suite of json.testResults ?? []) {
        for (const t of suite.assertionResults ?? []) {
          if (t.status === 'failed') failedTests.push(t.title ?? t.fullName ?? '?');
        }
      }
    } catch {
      /* JSON 不完整（如进程崩溃），退回用 exit code 判断 */
    }
    fs.unlinkSync(resultPath);
  }

  // 非 0 退出即视为失败（包含栈溢出、超时、编译错等硬崩溃）
  const failed = r.status !== 0 || failedTests.length > 0;
  if (failed && failedTests.length === 0) {
    failedTests.push(`<进程异常退出 status=${r.status}${r.signal ? ' signal=' + r.signal : ''}>`);
  }
  return { failed, failedTests };
}

function main() {
  const original = fs.readFileSync(SRC, 'utf8');
  fs.writeFileSync(BACKUP, original, 'utf8');

  const results: Result[] = [];
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = only.length > 0 ? MUTANTS.filter((m) => only.includes(m.id)) : MUTANTS;

  console.log(`变异测试：${targets.length} 个变异体，逐个验证是否被测试杀死\n`);

  try {
    // 先确认原始代码是绿的，否则整轮结果无意义
    process.stdout.write('[基准] 未变异代码... ');
    const base = runTests();
    if (base.failed) {
      console.log('失败 —— 基准不绿，中止');
      console.log(base.failedTests.join('\n'));
      return;
    }
    console.log('通过\n');

    for (const m of targets) {
      const occurrences = original.split(m.find).length - 1;
      if (occurrences !== 1) {
        results.push({
          mutant: m,
          status: 'INVALID',
          killedBy: [],
          note: `find 字符串出现 ${occurrences} 次（需恰好 1 次）`
        });
        console.log(`${m.id.padEnd(4)} INVALID  ${m.desc}  [出现 ${occurrences} 次]`);
        continue;
      }

      fs.writeFileSync(SRC, original.replace(m.find, m.replace), 'utf8');
      const { failed, failedTests } = runTests();
      const status = failed ? 'KILLED' : 'SURVIVED';
      results.push({ mutant: m, status, killedBy: failedTests });

      const tag = status === 'KILLED' ? 'KILLED  ' : 'SURVIVED';
      const expected = m.expectEquivalent ? ' [预期等价]' : '';
      console.log(`${m.id.padEnd(4)} ${tag} ${m.desc}${expected}`);
      if (status === 'KILLED' && failedTests.length > 0) {
        console.log(`       ↳ ${failedTests.slice(0, 3).join(' | ')}`);
      }
    }
  } finally {
    fs.writeFileSync(SRC, original, 'utf8');
    fs.unlinkSync(BACKUP);
    console.log('\n已恢复 src/topology.ts');
  }

  // ---- 汇总 ----
  const real = results.filter((r) => !r.mutant.expectEquivalent && r.status !== 'INVALID');
  const killed = real.filter((r) => r.status === 'KILLED');
  const survived = real.filter((r) => r.status === 'SURVIVED');
  const equivalent = results.filter((r) => r.mutant.expectEquivalent);
  const invalid = results.filter((r) => r.status === 'INVALID');

  console.log('\n' + '='.repeat(70));
  console.log('变异测试汇总');
  console.log('='.repeat(70));
  console.log(`有效变异体：${real.length}`);
  console.log(`  被杀死：  ${killed.length}`);
  console.log(`  存活：    ${survived.length}`);
  const score = real.length > 0 ? ((killed.length / real.length) * 100).toFixed(2) : 'N/A';
  console.log(`变异得分：  ${score}%`);

  if (equivalent.length > 0) {
    console.log(`\n预期等价变异体（不计入得分）：${equivalent.length}`);
    for (const r of equivalent) {
      const ok = r.status === 'SURVIVED' ? '符合预期(存活)' : '意外被杀死';
      console.log(`  ${r.mutant.id} ${ok} — ${r.mutant.desc}`);
    }
  }
  if (invalid.length > 0) {
    console.log(`\nINVALID：${invalid.length}`);
    for (const r of invalid) console.log(`  ${r.mutant.id} ${r.note} — ${r.mutant.desc}`);
  }
  if (survived.length > 0) {
    console.log(`\n存活变异体（测试盲区，必须补测试）：`);
    for (const r of survived) console.log(`  ${r.mutant.id} — ${r.mutant.desc}`);
  }

  fs.writeFileSync(
    path.join(ROOT, 'mutation', 'result.json'),
    JSON.stringify(
      results.map((r) => ({
        id: r.mutant.id,
        desc: r.mutant.desc,
        status: r.status,
        expectEquivalent: !!r.mutant.expectEquivalent,
        killedBy: r.killedBy.slice(0, 5),
        note: r.note
      })),
      null,
      2
    ),
    'utf8'
  );
  console.log('\n明细已写入 mutation/result.json');

  if (survived.length > 0) process.exitCode = 1;
}

main();
