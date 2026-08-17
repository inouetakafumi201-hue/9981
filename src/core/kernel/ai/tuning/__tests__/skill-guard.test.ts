/**
 * Task 15 测试：skill 强制加载校验（属性 12）。
 *  - 全部强制项存在且非空 → 校验通过；
 *  - 断言目录缺文件/为空 → assertionDirOk=false（skill 应拒绝）；
 *  - 强制清单任一缺失/为空 → 列入 missing（skill 拒绝）。
 */
import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateSkillContext, MANDATORY_SKILL_FILES } from '../skill-guard.js';
import { projectRoot } from './_paths.js';

describe('skill-guard（Task15 / 属性12）', () => {
  it('强制加载清单包含费目配置/断言目录/禁碰清单/规则文档', () => {
    expect(MANDATORY_SKILL_FILES).toEqual(expect.arrayContaining([
      'src/core/kernel/ai/tuning/config/design-currency-config.json',
      'src/core/kernel/ai/tuning/config/tuning-constraints.json',
      'docs/ai/ai-tuning-rules.md',
      'docs/ai/i-tunning.md',
    ]));
  });

  it('仓库真实上下文通过校验（断言目录有非空 JSON）', () => {
    const result = validateSkillContext(projectRoot);
    expect(result.missing).toEqual([]);
    expect(result.assertionDirOk).toBe(true);
  });

  it('强制文件缺失 → 列入 missing（用临时根目录模拟仓库根）', () => {
    const tmp = join(projectRoot, 'tmp/ai-tuning-guard-test');
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(join(tmp, 'docs/ai'), { recursive: true });
    // 无 src/config/... 等 → 全部缺失
    const result = validateSkillContext(tmp, join(tmp, 'src/core/kernel/ai/tuning/assertions'));
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('断言目录为空 → assertionDirOk=false', () => {
    const tmp = join(projectRoot, 'tmp/ai-tuning-guard-empty-assertions');
    rmSync(tmp, { recursive: true, force: true });
    // 只造一个空断言目录，无任何 JSON 文件
    mkdirSync(join(tmp, 'src/core/kernel/ai/tuning/assertions'), { recursive: true });
    const result = validateSkillContext(tmp, join(tmp, 'src/core/kernel/ai/tuning/assertions'));
    expect(result.assertionDirOk).toBe(false);
  });
});

it('空文件列入 missing（带「(空)」标记）', () => {
  const tmp = join(projectRoot, 'tmp/ai-tuning-guard-empty-file');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'docs/ai'), { recursive: true });
  writeFileSync(join(tmp, 'docs/ai/ai-tuning-rules.md'), '   \n', 'utf8');
  const result = validateSkillContext(tmp, join(tmp, 'src/core/kernel/ai/tuning/assertions'));
  expect(result.missing).toContain('docs/ai/ai-tuning-rules.md (空)');
});
