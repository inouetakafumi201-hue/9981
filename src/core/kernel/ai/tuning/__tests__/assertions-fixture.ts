/**
 * 测试辅助：从 `tuning/assertions/*.json` 磁盘读取 golden 行为断言。
 *
 * 断言文件是 skill 强制加载项（`tuning/assertions/` 目录），必须存在且 ≥10 条 golden。
 * 这里把磁盘 JSON（每个文件是一个断言对象）解析成 `BehaviorAssertion` 供 runner 真跑。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAssertionsJson } from '../assertions';
import type { BehaviorAssertion } from '../assertions';

const here = dirname(fileURLToPath(import.meta.url));
/** 造断言文件夹（与本测试同位于 tuning/，相对上一级即 tuning/）。 */
const ASSERTIONS_DIR = join(here, '..', 'assertions');

/**
 * 从磁盘断言目录加载全部 golden 断言。
 * 目录缺失或为空按失败对待（断言目录是 skill 强制项）。
 */
export function loadGoldenAssertionsFile(): BehaviorAssertion[] {
  const out: BehaviorAssertion[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(ASSERTIONS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    // fallthrough
  }
  for (const file of entries) {
    const text = readFileSync(join(ASSERTIONS_DIR, file), 'utf8');
    out.push(...loadAssertionsJson(text));
  }
  if (out.length < 10) {
    throw new Error(`golden-assertions fixture requires the tuning/assertions directory (found ${out.length} assertions)`);
  }
  return out;
}
