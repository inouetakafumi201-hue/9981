/**
 * 把 `vitest run --reporter=json` 的产物压缩成一份可读的小结：
 * 总数 + 失败文件清单 + 每条失败断言的首行原因。
 *
 * 存在理由：本仓库在 Windows PowerShell 下运行 vitest 时，控制台输出会被 GBK 代码页
 * 破坏（中文测试名变成乱码），且完整 JSON 报告有 45 万字符，无法直接阅读。
 * 用法：node scripts/summarize-vitest-json.mjs <report.json> [out.txt]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [reportPath, outPath] = process.argv.slice(2);
if (!reportPath) {
  console.error('用法: node scripts/summarize-vitest-json.mjs <report.json> [out.txt]');
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const lines = [];
lines.push(`suites: total=${report.numTotalTestSuites} passed=${report.numPassedTestSuites} failed=${report.numFailedTestSuites}`);
lines.push(`tests : total=${report.numTotalTests} passed=${report.numPassedTests} failed=${report.numFailedTests} pending=${report.numPendingTests}`);
lines.push('');

for (const file of report.testResults) {
  if (file.status === 'passed') continue;
  const name = String(file.name).replace(/^.*WakeUp[/\\]/, '');
  lines.push(`FAIL ${name}`);
  if (file.message) lines.push(`  file-level: ${file.message.split('\n')[0]}`);
  for (const assertion of file.assertionResults ?? []) {
    if (assertion.status !== 'failed') continue;
    const first = (assertion.failureMessages?.[0] ?? '').split('\n')[0];
    lines.push(`  - ${assertion.fullName}`);
    lines.push(`      ${first}`);
  }
}

const text = lines.join('\n');
if (outPath) writeFileSync(outPath, text, 'utf8');
else console.log(text);
