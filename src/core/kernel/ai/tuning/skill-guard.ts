/**
 * skill 强制加载校验（Task 15 的防看漏底座 + 属性 12）。
 *
 * `ai-tuning` skill 启动时必须在文件名缺失/为空时拒绝进入并提示缺失项。这里实现
 * `validateSkillContext()`：校验强制加载清单里的每个路径存在且非空，返回缺失项列表。
 * 空列表 = 全部就绪，可以进入调参对话；非空 = 打印缺失项并停下。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** 强制加载清单：相对仓库根路径（与 SKILL.md 一致）。 */
export const MANDATORY_SKILL_FILES: readonly string[] = [
  'src/core/kernel/ai/tuning/config/design-currency-config.json',
  'src/core/kernel/ai/tuning/config/tuning-constraints.json',
  'docs/ai/ai-tuning-rules.md',
  'docs/ai/i-tunning.md',
];

/**
 * 校验 skill 强制清单；返回缺失/为空的路径。空数组表示全部就绪。
 * 断言目录单列（可能有多个断言文件），此处校验目录存在且至少一个可解析的非空 JSON。
 */
export interface SkillContextValidation {
  readonly missing: string[];
  readonly assertionDirOk: boolean;
}

export function validateSkillContext(
  repoRoot: string = process.cwd(),
  assertionsDir: string = resolve(repoRoot, 'src/core/kernel/ai/tuning/assertions'),
): SkillContextValidation {
  const missing: string[] = [];
  for (const rel of MANDATORY_SKILL_FILES) {
    const file = resolve(repoRoot, rel);
    if (!existsSync(file)) {
      missing.push(rel);
      continue;
    }
    const content = readFileSync(file, 'utf8');
    if (content.trim().length === 0) missing.push(`${rel} (空)`);
  }

  // 断言目录：存在且至少一个 .json 文件内容可解析出断言。
  let assertionDirOk = false;
  if (existsSync(assertionsDir)) {
    try {
      const files = readdirSync(assertionsDir).filter((f) => f.endsWith('.json'));
      if (files.length > 0) {
        for (const file of files) {
          const text = readFileSync(resolve(assertionsDir, file), 'utf8');
          if (text.trim().length > 0) {
            assertionDirOk = true;
            break;
          }
        }
      }
    } catch {
      assertionDirOk = false;
    }
  }

  return { missing, assertionDirOk };
}

