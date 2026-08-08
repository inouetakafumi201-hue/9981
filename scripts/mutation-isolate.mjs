/**
 * 单变异体 + 单测试名的隔离验证。
 *
 * 用途：确认某一条测试是**独立**杀死某个变异体的，而不是靠同文件里其他断言顺带杀死。
 * 用法：node scripts/mutation-isolate.mjs <变异体集名> "<变异体名>" "<-t 传给 vitest 的测试名片段>"
 *   例：node scripts/mutation-isolate.mjs strict-json-decoder "放行落单高位代理项（收进解码结果）" "解码成功的字符串永不含落单代理项"
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { locate, applyMutant } from './mutation-eol.mjs';

const [setName, mutantName, testName] = process.argv.slice(2);
if (setName === undefined || mutantName === undefined || testName === undefined) {
  console.error('用法：node scripts/mutation-isolate.mjs <变异体集名> "<变异体名>" "<测试名片段>"');
  process.exit(2);
}

const configPath = resolve(import.meta.dirname, 'mutants', `${setName}.mjs`);
const config = await import(pathToFileURL(configPath).href);
const { target: TARGET, test: TEST, mutants } = config;

const mutant = mutants.find((entry) => entry.name === mutantName);
if (mutant === undefined) {
  console.error(`找不到变异体：${mutantName}`);
  console.error(`可选：\n${mutants.map((entry) => `  ${entry.name}`).join('\n')}`);
  process.exit(2);
}

const original = readFileSync(TARGET, 'utf8');
const site = locate(original, mutant.from);
if (site === null) {
  console.error(`变异体锚点已失效，源码中找不到：\n${mutant.from}`);
  process.exit(2);
}
if (site.count > 1) {
  console.error(`变异体锚点在源码中出现 ${String(site.count)} 次，替换首处会得到语义不明的变异体：\n${mutant.from}`);
  process.exit(2);
}

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, '');
}

/**
 * 跑一次 vitest，返回 { failed, ran }。
 *
 * `ran` 必须单独判定：`-t` 筛选不到任何测试时 vitest 会把全部用例标记为 skipped 并以 0 退出，
 * 此时"没有失败"并不代表"变异体存活"，而代表这次验证根本没有发生。
 * 不区分这两种情况，本脚本自己就成了空转的检测器。
 */
function runFiltered() {
  let stdout = '';
  let failed = false;
  try {
    stdout = execSync(`npx vitest run ${TEST} -t ${JSON.stringify(testName)}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    failed = true;
    stdout = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  // 形如 "Tests  3 passed | 127 skipped (130)"：只要出现 passed/failed 计数即说明确有用例执行。
  const executed = /Tests\s+.*?(\d+)\s+(?:passed|failed)/.exec(stripAnsi(stdout));
  const ran = executed !== null && Number(executed[1]) > 0;
  return { failed, ran, stdout };
}

// 先在未变异的源码上确认筛选串真的命中了用例，否则后面的判定毫无意义。
const baseline = runFiltered();
if (!baseline.ran) {
  console.error(`测试筛选 ${JSON.stringify(testName)} 未命中任何用例，无法判定。`);
  console.error('（vitest 会把未命中的用例标记为 skipped 并以 0 退出，因此这里必须显式报错。）');
  process.exit(2);
}
if (baseline.failed) {
  console.error('基线（未注入变异）下该测试就是失败的，先修好它再做变异验证。');
  process.exit(2);
}

let killed = false;
let mutatedRan = false;
try {
  writeFileSync(TARGET, applyMutant(original, site, mutant.to), 'utf8');
  const mutated = runFiltered();
  killed = mutated.failed;
  mutatedRan = mutated.ran || mutated.failed;
} finally {
  writeFileSync(TARGET, original, 'utf8');
}

console.log(`变异体集：${setName}`);
console.log(`变异体：${mutant.name}`);
console.log(`测试筛选：${testName}（基线命中并通过）`);
if (!mutatedRan) {
  console.log('✗ 无法判定 —— 注入变异后没有用例执行');
  process.exit(2);
}
console.log(killed ? '✓ KILLED —— 该测试独立杀死此变异体' : '✗ SURVIVED —— 该测试无法独立杀死此变异体');
process.exit(killed ? 0 : 1);
