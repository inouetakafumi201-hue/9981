/**
 * L12 变异测试驱动器（ESM 版；本包 package.json 为 "type": "module"）。
 *
 * 流程：
 *  1. 备份 src/
 *  2. 先确认基线全绿——基线不绿则任何"击杀"都无意义
 *  3. 逐个注入变异体，跑收缩后的套件；非零退出即记为"杀死"
 *     （含超时、栈溢出、编译失败——都算"测试发现了问题"）
 *  4. 无论成败，finally 中恢复 src/
 *
 * find 命中次数必须恰好为 1，否则记为 INVALID 并排除出得分，
 * 防止"改了个不存在的字符串"被静默算成击杀。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './mutants.js';
import type { Mutant } from './mutants.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * 向上逐级查找 vitest 的 JS 入口。
 * 本包没有本地 node_modules/vitest，实际由上级目录提供，故不能硬编码路径。
 */
function resolveVitestBin(): string {
  let dir = ROOT;
  for (;;) {
    for (const candidate of ['vitest.mjs', 'dist/cli.js', 'vitest.js']) {
      const full = path.join(dir, 'node_modules', 'vitest', candidate);
      if (fs.existsSync(full)) return full;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('未找到 vitest 入口；请确认依赖已安装');
    dir = parent;
  }
}

const SRC = path.join(ROOT, 'src');
const BACKUP = path.join(ROOT, 'mutation', '.src-backup');
const RESULT = path.join(ROOT, 'mutation', 'result.json');
const VITEST_BIN = resolveVitestBin();

type Status = 'killed' | 'survived' | 'invalid';

interface Outcome {
  id: string;
  file: string;
  desc: string;
  status: Status;
  expectEquivalent: boolean;
  detail: string;
}

function copyDir(from: string, to: string): void {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

function runSuite(): { ok: boolean; detail: string } {
  // 直接调用 vitest 的 JS 入口：Windows 上 spawnSync 对 .cmd 会报 EINVAL，
  // 而 shell: true 又带来参数转义问题。
  const result = spawnSync(
    process.execPath,
    [VITEST_BIN, 'run', '--config', 'vitest.mutation.config.ts'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, L12_RUNS: process.env.MUTATION_RUNS ?? '400' },
      timeout: 180_000,
      shell: false,
    },
  );

  if (result.error) return { ok: false, detail: `spawn error: ${result.error.message}` };
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const failLine =
    combined.split('\n').find((line) => /AssertionError|Tests {2}\d+ failed|× /.test(line)) ?? '';
  return {
    ok: result.status === 0,
    detail: result.status === 0 ? 'all green' : failLine.trim().slice(0, 220) || `exit ${result.status}`,
  };
}

function applyMutant(mutant: Mutant): { applied: boolean; reason: string } {
  const target = path.join(SRC, mutant.file);
  const original = fs.readFileSync(target, 'utf8');
  const occurrences = original.split(mutant.find).length - 1;
  if (occurrences !== 1) {
    return { applied: false, reason: `find 命中 ${occurrences} 次（要求恰好 1 次）` };
  }
  fs.writeFileSync(target, original.replace(mutant.find, mutant.replace), 'utf8');
  return { applied: true, reason: '' };
}

function main(): number {
  copyDir(SRC, BACKUP);
  const outcomes: Outcome[] = [];

  try {
    process.stdout.write('基线校验中...\n');
    const baseline = runSuite();
    if (!baseline.ok) {
      process.stdout.write(`基线未通过，中止：${baseline.detail}\n`);
      return 1;
    }
    process.stdout.write('基线全绿。\n\n');

    for (const mutant of MUTANTS) {
      copyDir(BACKUP, SRC);
      const applied = applyMutant(mutant);
      if (!applied.applied) {
        outcomes.push({
          id: mutant.id, file: mutant.file, desc: mutant.desc,
          status: 'invalid', expectEquivalent: Boolean(mutant.expectEquivalent),
          detail: applied.reason,
        });
        process.stdout.write(`${mutant.id} INVALID  ${applied.reason}\n`);
        continue;
      }

      const run = runSuite();
      const status: Status = run.ok ? 'survived' : 'killed';
      outcomes.push({
        id: mutant.id, file: mutant.file, desc: mutant.desc,
        status, expectEquivalent: Boolean(mutant.expectEquivalent), detail: run.detail,
      });

      const mark = status === 'killed'
        ? '杀死  '
        : mutant.expectEquivalent ? '存活(预期)' : '存活!!';
      process.stdout.write(`${mutant.id} ${mark} ${mutant.desc}\n`);
    }
  } finally {
    copyDir(BACKUP, SRC);
    fs.rmSync(BACKUP, { recursive: true, force: true });
  }

  const valid = outcomes.filter((o) => o.status !== 'invalid');
  const scored = valid.filter((o) => !o.expectEquivalent);
  const killed = scored.filter((o) => o.status === 'killed');
  const survivors = scored.filter((o) => o.status === 'survived');
  const equivalents = valid.filter((o) => o.expectEquivalent);
  const invalid = outcomes.filter((o) => o.status === 'invalid');
  const score = scored.length === 0 ? 0 : (killed.length / scored.length) * 100;

  fs.writeFileSync(
    RESULT,
    JSON.stringify(
      {
        total: MUTANTS.length, valid: valid.length, scored: scored.length,
        killed: killed.length, survived: survivors.length, invalid: invalid.length,
        expectEquivalent: equivalents.length, score: Number(score.toFixed(2)), outcomes,
      },
      null, 2,
    ),
    'utf8',
  );

  process.stdout.write('\n========================================\n');
  process.stdout.write(`变异体总数：${MUTANTS.length}\n`);
  process.stdout.write(`无效（find 未唯一命中）：${invalid.length}\n`);
  process.stdout.write(`计分变异体：${scored.length}  杀死：${killed.length}  存活：${survivors.length}\n`);
  process.stdout.write(`预期等价（存活为正确）：${equivalents.length}\n`);
  process.stdout.write(`变异得分：${score.toFixed(2)}%\n`);

  if (survivors.length > 0) {
    process.stdout.write('\n存活的计分变异体（测试盲区或契约过粗）：\n');
    for (const s of survivors) process.stdout.write(`  ${s.id}  ${s.desc}\n`);
  }
  if (invalid.length > 0) {
    process.stdout.write('\n无效变异体（find 未唯一命中，需修正清单）：\n');
    for (const s of invalid) process.stdout.write(`  ${s.id}  ${s.detail}  ${s.desc}\n`);
  }
  for (const e of equivalents) {
    if (e.status === 'killed') {
      process.stdout.write(`\n注意：${e.id} 标注为预期等价却被杀死，标注有误。\n`);
    }
  }

  return survivors.length === 0 && invalid.length === 0 ? 0 : 1;
}

process.exit(main());
